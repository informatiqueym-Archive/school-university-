// Money in and out: customer receipts, supplier payments, Mobile Money
// requests, quick expenses and transfers between cash, bank and wallets.
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, num, date as vDate, oneOf } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { raiseAlert } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { normalizePhone, PROVIDERS } from '../../core/payments/mobile-money.js';
import { DEFAULTS, METHODS } from './chart.js';
import { postEntry, reverseEntry, accountExists, balanceOf } from './ledger.js';
import { refreshStatus } from './documents.js';

const methodKeys = Object.keys(METHODS);

export function treasuryAccounts(db, companyId) {
  return db.all("SELECT code, name FROM accounts WHERE company_id = ? AND active = 1 AND (code LIKE '52%' OR code LIKE '53%' OR code LIKE '55%' OR code LIKE '57%') AND length(code) >= 4 ORDER BY code", companyId);
}

function payPerm(user, direction) {
  const ok = direction === 'in' ? ['sales', 'treasury', 'accounting'] : ['purchases', 'treasury', 'accounting'];
  if (!ok.some((p) => can(user, p))) throw forbidden('Votre rôle ne permet pas d\'enregistrer ce paiement');
}

function resolveTarget(db, companyId, b) {
  let doc = null, partner = null;
  if (b.document_id) {
    doc = db.get('SELECT * FROM documents WHERE id = ? AND company_id = ?', b.document_id, companyId);
    if (!doc) throw notFound('Document introuvable');
    if (!['invoice', 'bill'].includes(doc.kind)) throw bad('doc_kind', 'Un paiement se rattache à une facture');
    if (!['open', 'partial'].includes(doc.status)) throw conflict('doc_state', doc.status === 'draft' ? 'Validez la facture avant d\'enregistrer un paiement' : 'Cette facture est déjà soldée');
  }
  const partnerId = doc?.partner_id ?? b.partner_id;
  if (partnerId) {
    partner = db.get('SELECT * FROM partners WHERE id = ? AND company_id = ?', partnerId, companyId);
    if (!partner) throw notFound('Tiers introuvable');
  }
  return { doc, partner };
}

/** Writes the journal entry for a completed payment and updates the invoice. */
function postPayment(db, companyId, p, userId) {
  const m = METHODS[p.method];
  const doc = p.document_id ? db.get('SELECT number FROM documents WHERE id = ?', p.document_id) : null;
  const partner = p.partner_id ? db.get('SELECT name FROM partners WHERE id = ?', p.partner_id) : null;
  const label = `${p.direction === 'in' ? 'Encaissement' : 'Paiement'} ${m.fr}${doc ? ' – ' + doc.number : ''}${partner ? ' – ' + partner.name : ''}`;
  const third = p.direction === 'in' ? DEFAULTS.clients : DEFAULTS.suppliers;
  const lines = p.direction === 'in'
    ? [{ account: p.account_code, debit: p.amount }, { account: third, partner_id: p.partner_id, credit: p.amount }]
    : [{ account: third, partner_id: p.partner_id, debit: p.amount }, { account: p.account_code, credit: p.amount }];
  const entryId = postEntry(db, { companyId, journal: m.journal, date: p.date, label, ref: p.reference || doc?.number || '', source_type: 'payment', source_id: p.id, userId, lines });
  db.run("UPDATE payments SET entry_id = ?, status = 'completed' WHERE id = ?", entryId, p.id);
  if (p.document_id) refreshStatus(db, p.document_id);
  return entryId;
}

export function recordPayment(db, ctx, company, b) {
  const direction = oneOf(b.direction, ['in', 'out'], 'direction', 'in');
  payPerm(ctx.user, direction);
  const { doc, partner } = resolveTarget(db, company.id, b);
  if (!partner) throw bad('partner', 'Choisissez un client ou un fournisseur');
  if (doc && (doc.kind === 'invoice') !== (direction === 'in')) throw bad('direction', 'Sens du paiement incohérent avec le document');
  const method = oneOf(b.method, methodKeys, 'method', 'cash');
  const account_code = str(b.account_code, 12) || METHODS[method].account;
  if (!accountExists(db, company.id, account_code) || !/^5/.test(account_code)) throw bad('account', 'Compte de trésorerie invalide');
  const amount = int(b.amount ?? (doc ? doc.total - doc.paid - doc.credited : 0), 'amount', { min: 1 });
  if (doc && amount > doc.total - doc.paid - doc.credited) throw bad('overpay', `Le montant dépasse le reste à payer (${fcfa(doc.total - doc.paid - doc.credited)})`);
  const date = vDate(b.date, 'date', today());
  return db.tx(() => {
    const r = db.run(`INSERT INTO payments (company_id, direction, partner_id, document_id, date, amount, method, account_code, reference, phone, status, notes, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, company.id, direction, partner.id, doc?.id ?? null, date, amount, method, account_code, str(b.reference, 80), str(b.phone, 30), 'pending', str(b.notes, 1000), ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    postPayment(db, company.id, db.get('SELECT * FROM payments WHERE id = ?', id), ctx.user.id);
    return id;
  });
}

/** Sends a Mobile Money payment prompt to the customer's phone for an invoice (staff screen). */
export async function requestMobileMoney(db, ctx, company, momo, b) {
  payPerm(ctx.user, 'in');
  const { doc } = resolveTarget(db, company.id, b);
  if (!doc || doc.kind !== 'invoice') throw bad('document', 'Choisissez une facture client');
  return startMomo(db, momo, company, doc, { ...b, userId: ctx.user.id });
}

/**
 * Shared by the staff screen and the customer payment page. When replaceStale is set,
 * a request left unanswered for 90 s is dropped so the customer can try again.
 */
export async function startMomo(db, momo, company, doc, { provider, phone, amount, userId = null, replaceStale = false }) {
  provider = oneOf(provider, Object.keys(PROVIDERS), 'provider');
  if (!momo.configured(provider)) throw conflict('momo_config', `${PROVIDERS[provider].fr} n'est pas encore activé pour ce marchand`);
  if (!['open', 'partial'].includes(doc.status)) throw conflict('doc_state', 'Cette facture est déjà réglée');
  const partner = db.get('SELECT * FROM partners WHERE id = ?', doc.partner_id);
  const balance = doc.total - doc.paid - doc.credited;
  const value = int(amount ?? balance, 'amount', { min: 1 });
  if (value > balance) throw bad('overpay', `Le montant dépasse le reste à payer (${fcfa(balance)})`);
  const msisdn = normalizePhone(phone || partner.phone);
  if (replaceStale) {
    db.run("UPDATE payments SET status = 'failed', failure_reason = 'Remplacée par une nouvelle demande' WHERE document_id = ? AND status = 'pending' AND created_at < ?",
      doc.id, new Date(Date.now() - 90e3).toISOString());
  }
  const pending = db.get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE document_id = ? AND status = 'pending'", doc.id).s;
  if (pending + value > balance) throw conflict('pending', 'Une demande de paiement est déjà en attente : confirmez-la sur le téléphone ou réessayez dans une minute');
  const res = await momo.requestPayment({ provider, phone: msisdn, amount: value, reference: doc.number, description: `${company.name} – Facture ${doc.number}` });
  const r = db.run(`INSERT INTO payments (company_id, direction, partner_id, document_id, date, amount, method, account_code, phone, provider_ref, status, notes, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, company.id, 'in', partner.id, doc.id, today(), value, provider, METHODS[provider].account, msisdn, res.providerRef, 'pending',
    userId ? '' : 'Payé par le client depuis le lien de paiement', userId, now());
  return Number(r.lastInsertRowid);
}

/** Asks the operator for the result of pending Mobile Money requests. */
export async function checkPending(db, bus, momo, { paymentId, provider } = {}) {
  const where = ["status = 'pending'", "provider_ref != ''"]; const p = [];
  if (paymentId) { where.push('id = ?'); p.push(paymentId); }
  if (provider) { where.push('method = ?'); p.push(provider); }
  const list = db.all(`SELECT * FROM payments WHERE ${where.join(' AND ')} LIMIT 50`, ...p);
  for (const pay of list) {
    let st;
    try { st = await momo.checkStatus(pay.method, pay.provider_ref); } catch (e) { console.warn('momo status', e.message); continue; }
    const fresh = db.get('SELECT status FROM payments WHERE id = ?', pay.id);
    if (fresh.status !== 'pending') continue;
    const partner = db.get('SELECT name FROM partners WHERE id = ?', pay.partner_id);
    const doc = pay.document_id ? db.get('SELECT number FROM documents WHERE id = ?', pay.document_id) : null;
    if (st.status === 'successful') {
      db.tx(() => {
        db.run('UPDATE payments SET reference = ?, date = ? WHERE id = ?', st.transactionId || pay.provider_ref, today(), pay.id);
        postPayment(db, pay.company_id, db.get('SELECT * FROM payments WHERE id = ?', pay.id), pay.created_by);
      });
      raiseAlert(db, bus, pay.company_id, { kind: 'momo_received', level: 'success', title: `${PROVIDERS[pay.method].fr} reçu : ${fcfa(pay.amount)}`, body: `${partner?.name || ''} a payé la facture ${doc?.number || ''}.`, entity: 'payment', entity_id: pay.id });
      bus.emit(pay.company_id, 'change', { entity: 'payment', id: pay.id });
    } else if (st.status === 'failed') {
      db.run("UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?", String(st.reason || '').slice(0, 300), pay.id);
      raiseAlert(db, bus, pay.company_id, { kind: 'momo_failed', level: 'warning', title: `Paiement ${PROVIDERS[pay.method].fr} échoué`, body: `${partner?.name || ''}, facture ${doc?.number || ''} : ${st.reason || 'refusé'}.`, entity: 'payment', entity_id: pay.id });
      bus.emit(pay.company_id, 'change', { entity: 'payment', id: pay.id });
    } else if (Date.now() - Date.parse(pay.created_at) > 30 * 60e3) {
      db.run("UPDATE payments SET status = 'failed', failure_reason = 'Délai dépassé (30 min)' WHERE id = ?", pay.id);
      bus.emit(pay.company_id, 'change', { entity: 'payment', id: pay.id });
    }
  }
  return list.length;
}

export function cancelPayment(db, ctx, company, id) {
  const p = db.get('SELECT * FROM payments WHERE id = ? AND company_id = ?', id, company.id);
  if (!p) throw notFound('Paiement introuvable');
  payPerm(ctx.user, p.direction);
  if (p.status === 'cancelled') throw conflict('already', 'Paiement déjà annulé');
  db.tx(() => {
    if (p.entry_id) reverseEntry(db, { companyId: company.id, entryId: p.entry_id, date: today(), userId: ctx.user.id });
    db.run("UPDATE payments SET status = 'cancelled' WHERE id = ?", id);
    if (p.document_id) refreshStatus(db, p.document_id);
  });
}

export function listPayments(db, companyId, q) {
  const where = ['p.company_id = ?']; const a = [companyId];
  if (q.direction) { where.push('p.direction = ?'); a.push(q.direction); }
  if (q.method) { where.push('p.method = ?'); a.push(q.method); }
  if (q.status) { where.push('p.status = ?'); a.push(q.status); }
  if (q.from) { where.push('p.date >= ?'); a.push(q.from); }
  if (q.to) { where.push('p.date <= ?'); a.push(q.to); }
  if (q.document_id) { where.push('p.document_id = ?'); a.push(q.document_id); }
  return db.all(`SELECT p.*, pa.name partner_name, d.number document_number FROM payments p LEFT JOIN partners pa ON pa.id = p.partner_id
    LEFT JOIN documents d ON d.id = p.document_id WHERE ${where.join(' AND ')} ORDER BY p.date DESC, p.id DESC LIMIT 1000`, ...a);
}

// ---- Expenses ----
export function recordExpense(db, bus, ctx, company, b) {
  if (!['purchases', 'treasury', 'accounting'].some((p) => can(ctx.user, p))) throw forbidden();
  const description = str(b.description, 300);
  if (!description) throw bad('description', 'Décrivez la dépense');
  const account_code = str(b.account_code, 12) || DEFAULTS.expenses;
  if (!/^[26]/.test(account_code) || !accountExists(db, company.id, account_code)) throw bad('account', 'Choisissez un compte de charge (classe 6) ou d\'immobilisation (classe 2)');
  const method = oneOf(b.method, methodKeys, 'method', 'cash');
  const treasury = str(b.treasury_account, 12) || METHODS[method].account;
  if (!/^5/.test(treasury) || !accountExists(db, company.id, treasury)) throw bad('account', 'Compte de trésorerie invalide');
  const vat_rate = num(b.vat_rate, 'vat_rate', { min: 0, def: 0 });
  let net, vat, total;
  if (b.total != null && b.total !== '') { // amount entered TTC (as on the receipt)
    total = int(b.total, 'total', { min: 1 });
    net = Math.round(total / (1 + vat_rate / 100)); vat = total - net;
  } else {
    net = int(b.net, 'net', { min: 1 }); vat = Math.round(net * vat_rate / 100); total = net + vat;
  }
  const date = vDate(b.date, 'date', today());
  const partner = b.partner_id ? db.get("SELECT * FROM partners WHERE id = ? AND company_id = ?", b.partner_id, company.id) : null;
  const id = db.tx(() => {
    const r = db.run(`INSERT INTO expenses (company_id, date, partner_id, description, account_code, net, vat_rate, vat, total, method, reference, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, company.id, date, partner?.id ?? null, description, account_code, net, vat_rate, vat, total, method, str(b.reference, 80), ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    const vatAccount = account_code.startsWith('2') ? '4451' : (account_code.startsWith('60') ? DEFAULTS.vat_deductible : DEFAULTS.vat_deductible_services);
    const entryId = postEntry(db, {
      companyId: company.id, journal: METHODS[method].journal, date, label: `Dépense : ${description}`, ref: str(b.reference, 80), source_type: 'expense', source_id: id, userId: ctx.user.id,
      lines: [{ account: account_code, debit: net }, { account: vatAccount, debit: vat }, { account: treasury, credit: total }],
    });
    db.run('UPDATE expenses SET entry_id = ? WHERE id = ?', entryId, id);
    return id;
  });
  if (total >= company.large_expense_threshold) {
    raiseAlert(db, bus, company.id, { kind: 'large_expense', level: 'warning', title: `Dépense importante : ${fcfa(total)}`, body: `${description} (saisie par ${ctx.user.name}).`, entity: 'expense', entity_id: id });
  }
  return id;
}

export function cancelExpense(db, ctx, company, id) {
  const e = db.get('SELECT * FROM expenses WHERE id = ? AND company_id = ?', id, company.id);
  if (!e) throw notFound('Dépense introuvable');
  if (!['purchases', 'treasury', 'accounting'].some((p) => can(ctx.user, p))) throw forbidden();
  if (e.status === 'cancelled') throw conflict('already', 'Dépense déjà annulée');
  db.tx(() => {
    reverseEntry(db, { companyId: company.id, entryId: e.entry_id, date: today(), userId: ctx.user.id });
    db.run("UPDATE expenses SET status = 'cancelled' WHERE id = ?", id);
  });
}

// ---- Transfers between cash, bank and Mobile Money wallets ----
export function recordTransfer(db, ctx, company, b) {
  if (!['treasury', 'accounting'].some((p) => can(ctx.user, p))) throw forbidden();
  const from = str(b.from_account, 12), to = str(b.to_account, 12);
  for (const a of [from, to]) if (!/^5/.test(a) || !accountExists(db, company.id, a)) throw bad('account', 'Compte de trésorerie invalide');
  if (from === to) throw bad('same', 'Choisissez deux comptes différents');
  const amount = int(b.amount, 'amount', { min: 1 });
  const fees = int(b.fees, 'fees', { min: 0, def: 0 });
  const date = vDate(b.date, 'date', today());
  const label = str(b.label, 200) || 'Virement interne';
  return db.tx(() => {
    const r = db.run('INSERT INTO transfers (company_id, date, from_account, to_account, amount, fees, label, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      company.id, date, from, to, amount, fees, label, ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    const journal = from.startsWith('55') || to.startsWith('55') ? 'MM' : from.startsWith('57') || to.startsWith('57') ? 'CA' : 'BQ';
    const entryId = postEntry(db, {
      companyId: company.id, journal, date, label, source_type: 'transfer', source_id: id, userId: ctx.user.id,
      lines: [{ account: to, debit: amount }, { account: '631', debit: fees, label: 'Frais de transfert' }, { account: from, credit: amount + fees }],
    });
    db.run('UPDATE transfers SET entry_id = ? WHERE id = ?', entryId, id);
    return id;
  });
}

export function treasurySummary(db, companyId, to) {
  const accounts = treasuryAccounts(db, companyId).map((a) => ({ ...a, balance: balanceOf(db, companyId, a.code, { to }) }));
  return { accounts, total: accounts.reduce((s, a) => s + a.balance, 0) };
}
