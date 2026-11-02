// Quotes (devis), sales invoices (factures), credit notes (avoirs) and
// supplier bills (factures fournisseurs).
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, num, date as vDate, addDays } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { DEFAULTS } from './chart.js';
import { postEntry, nextNumber, assertOpenPeriod, accountExists } from './ledger.js';

export const PREFIX = { quote: 'DEV', invoice: 'FAC', credit_note: 'AV', bill: 'ACH' };
export const KIND_LABEL = { quote: 'Devis', invoice: 'Facture', credit_note: 'Avoir', bill: 'Facture fournisseur' };

export const permFor = (kind) => (kind === 'bill' ? ['purchases', 'accounting'] : ['sales', 'accounting']);
export function assertKindPerm(user, kind) {
  if (!permFor(kind).some((p) => can(user, p))) throw forbidden('Votre rôle ne permet pas de gérer ce type de document');
}

/** Computes each line's net, VAT and total in whole FCFA. */
export function computeLines(db, company, kind, rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw bad('lines', 'Ajoutez au moins une ligne');
  if (rawLines.length > 200) throw bad('lines', 'Trop de lignes (200 max)');
  const purchase = kind === 'bill';
  return rawLines.map((l, i) => {
    const product = l.product_id ? db.get('SELECT * FROM products WHERE id = ? AND company_id = ?', l.product_id, company.id) : null;
    if (l.product_id && !product) throw bad('product', `Ligne ${i + 1} : article introuvable`);
    const itemKind = product?.kind || (l.kind === 'good' ? 'good' : 'service');
    const description = str(l.description ?? product?.name, 1000);
    if (!description) throw bad('description', `Ligne ${i + 1} : la désignation est obligatoire`);
    const qty = num(l.qty, 'qty', { min: 0, def: 1 });
    const unit_price = int(l.unit_price ?? (purchase ? product?.purchase_price : product?.price), 'unit_price', { min: 0, def: 0 });
    const discount = num(l.discount, 'discount', { min: 0, def: 0 });
    if (discount > 100) throw bad('discount', `Ligne ${i + 1} : remise supérieure à 100 %`);
    const defaultRate = company.vat_enabled ? company.vat_rate : 0;
    const vat_rate = num(l.vat_rate ?? product?.vat_rate ?? defaultRate, 'vat_rate', { min: 0 });
    if (vat_rate > 100) throw bad('vat_rate', `Ligne ${i + 1} : taux de TVA invalide`);
    const account_code = str(l.account_code, 12) || (purchase
      ? product?.purchase_account || (itemKind === 'good' ? DEFAULTS.purchases : DEFAULTS.expenses)
      : product?.sales_account || (itemKind === 'good' ? DEFAULTS.sales_goods : DEFAULTS.sales_services));
    if (!accountExists(db, company.id, account_code)) throw bad('account', `Ligne ${i + 1} : compte ${account_code} inexistant`);
    const gross = Math.round(qty * unit_price);
    const net = Math.round(gross * (1 - discount / 100));
    const vat = Math.round(net * vat_rate / 100);
    return { position: i + 1, product_id: product?.id ?? null, description, qty, unit: str(l.unit ?? product?.unit, 20), unit_price, discount, vat_rate, account_code, kind: itemKind, net, vat, total: net + vat, gross };
  });
}

const totals = (lines) => ({
  subtotal: lines.reduce((s, l) => s + l.net, 0),
  discount_total: lines.reduce((s, l) => s + (l.gross - l.net), 0),
  vat_total: lines.reduce((s, l) => s + l.vat, 0),
  total: lines.reduce((s, l) => s + l.total, 0),
});

function writeLines(db, docId, lines) {
  db.run('DELETE FROM document_lines WHERE document_id = ?', docId);
  for (const l of lines) {
    db.run(`INSERT INTO document_lines (document_id, position, product_id, description, qty, unit, unit_price, discount, vat_rate, account_code, kind, net, vat, total)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, docId, l.position, l.product_id, l.description, l.qty, l.unit, l.unit_price, l.discount, l.vat_rate, l.account_code, l.kind, l.net, l.vat, l.total);
  }
}

export function getDocument(db, companyId, id) {
  const d = db.get(`SELECT d.*, p.name partner_name, p.phone partner_phone, p.email partner_email, p.address partner_address, p.city partner_city, p.niu partner_niu
    FROM documents d JOIN partners p ON p.id = d.partner_id WHERE d.id = ? AND d.company_id = ?`, id, companyId);
  if (!d) return null;
  d.lines = db.all('SELECT * FROM document_lines WHERE document_id = ? ORDER BY position', id);
  d.balance = d.kind === 'invoice' || d.kind === 'bill' ? d.total - d.paid - d.credited : 0;
  d.payments = db.all("SELECT * FROM payments WHERE document_id = ? ORDER BY date, id", id);
  d.related = db.all('SELECT id, kind, number, status, total, date FROM documents WHERE (ref_doc_id = ? OR id = ?) AND id != ? AND company_id = ?', id, d.ref_doc_id ?? -1, id, companyId);
  // VAT breakdown by rate, for the printed document
  const byRate = {};
  for (const l of d.lines) { byRate[l.vat_rate] ??= { rate: l.vat_rate, base: 0, vat: 0 }; byRate[l.vat_rate].base += l.net; byRate[l.vat_rate].vat += l.vat; }
  d.vat_breakdown = Object.values(byRate);
  return d;
}

export function listDocuments(db, companyId, q) {
  const where = ['d.company_id = ?']; const p = [companyId];
  if (q.kind) { where.push('d.kind = ?'); p.push(q.kind); }
  if (q.status === 'unpaid') where.push("d.status IN ('open','partial')");
  else if (q.status === 'overdue') { where.push("d.status IN ('open','partial') AND d.due_date < ?"); p.push(today()); }
  else if (q.status) { where.push('d.status = ?'); p.push(q.status); }
  if (q.partner_id) { where.push('d.partner_id = ?'); p.push(q.partner_id); }
  if (q.from) { where.push('d.date >= ?'); p.push(q.from); }
  if (q.to) { where.push('d.date <= ?'); p.push(q.to); }
  if (q.q) { where.push('(d.number LIKE ? OR p.name LIKE ? OR d.subject LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s); }
  return db.all(`SELECT d.id, d.kind, d.number, d.partner_id, p.name partner_name, d.date, d.due_date, d.status, d.subject, d.subtotal, d.vat_total, d.total, d.paid, d.credited,
      (d.total - d.paid - d.credited) balance, d.ref_doc_id, d.supplier_ref
    FROM documents d JOIN partners p ON p.id = d.partner_id WHERE ${where.join(' AND ')} ORDER BY d.date DESC, d.id DESC LIMIT ${Math.min(Number(q.limit) || 500, 2000)}`, ...p);
}

function header(db, company, kind, b, existing) {
  const partner = db.get('SELECT * FROM partners WHERE id = ? AND company_id = ?', b.partner_id ?? existing?.partner_id, company.id);
  const wantKind = kind === 'bill' ? 'supplier' : 'client';
  if (!partner) throw bad('partner', kind === 'bill' ? 'Choisissez un fournisseur' : 'Choisissez un client');
  if (partner.kind !== wantKind) throw bad('partner', kind === 'bill' ? 'Ce tiers n\'est pas un fournisseur' : 'Ce tiers n\'est pas un client');
  const date = vDate(b.date ?? existing?.date, 'date', today());
  let due = b.due_date ?? existing?.due_date;
  if (kind === 'quote') due = due ? vDate(due, 'due_date') : addDays(date, company.quote_validity_days);
  else if (kind === 'credit_note') due = null;
  else due = due ? vDate(due, 'due_date') : addDays(date, company.payment_terms_days);
  if (due && due < date) throw bad('due_date', "L'échéance doit être après la date du document");
  return { partner, date, due_date: due, subject: str(b.subject ?? existing?.subject, 300), notes: str(b.notes ?? existing?.notes, 4000), supplier_ref: str(b.supplier_ref ?? existing?.supplier_ref, 60) };
}

export function createDocument(db, ctx, company, b) {
  const kind = b.kind;
  if (!PREFIX[kind]) throw bad('kind', 'Type de document inconnu');
  assertKindPerm(ctx.user, kind);
  const h = header(db, company, kind, b);
  const lines = computeLines(db, company, kind, b.lines);
  const t = totals(lines);
  let ref_doc_id = null;
  if (kind === 'credit_note') {
    if (b.ref_doc_id) {
      const inv = db.get("SELECT * FROM documents WHERE id = ? AND company_id = ? AND kind = 'invoice'", b.ref_doc_id, company.id);
      if (!inv) throw bad('ref_doc', 'Facture d\'origine introuvable');
      if (inv.partner_id !== h.partner.id) throw bad('ref_doc', 'L\'avoir doit concerner le même client que la facture');
      ref_doc_id = inv.id;
    }
  }
  return db.tx(() => {
    const number = kind === 'quote' ? nextNumber(db, company.id, `${PREFIX.quote}-${h.date.slice(0, 4)}`) : null;
    const r = db.run(`INSERT INTO documents (company_id, kind, number, partner_id, date, due_date, status, supplier_ref, subject, notes, subtotal, discount_total, vat_total, total, ref_doc_id, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, company.id, kind, number, h.partner.id, h.date, h.due_date, 'draft', h.supplier_ref, h.subject, h.notes,
      t.subtotal, t.discount_total, t.vat_total, t.total, ref_doc_id, ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    writeLines(db, id, lines);
    if (b.validate && kind !== 'quote') validateDocument(db, ctx, company, id);
    return id;
  });
}

export function updateDocument(db, ctx, company, id, b) {
  const d = db.get('SELECT * FROM documents WHERE id = ? AND company_id = ?', id, company.id);
  if (!d) throw notFound('Document introuvable');
  assertKindPerm(ctx.user, d.kind);
  const editable = d.status === 'draft' || (d.kind === 'quote' && d.status === 'sent');
  if (!editable) throw conflict('locked', 'Un document validé ne peut plus être modifié. Faites un avoir ou annulez le paiement.');
  const h = header(db, company, d.kind, b, d);
  const lines = b.lines ? computeLines(db, company, d.kind, b.lines) : null;
  db.tx(() => {
    db.run('UPDATE documents SET partner_id = ?, date = ?, due_date = ?, subject = ?, notes = ?, supplier_ref = ? WHERE id = ?', h.partner.id, h.date, h.due_date, h.subject, h.notes, h.supplier_ref, id);
    if (lines) {
      const t = totals(lines);
      writeLines(db, id, lines);
      db.run('UPDATE documents SET subtotal = ?, discount_total = ?, vat_total = ?, total = ? WHERE id = ?', t.subtotal, t.discount_total, t.vat_total, t.total, id);
    }
  });
  return id;
}

export function deleteDocument(db, ctx, company, id) {
  const d = db.get('SELECT * FROM documents WHERE id = ? AND company_id = ?', id, company.id);
  if (!d) throw notFound('Document introuvable');
  assertKindPerm(ctx.user, d.kind);
  if (d.status !== 'draft' && !(d.kind === 'quote' && d.status !== 'invoiced')) throw conflict('locked', 'Seuls les brouillons peuvent être supprimés');
  db.tx(() => {
    db.run('UPDATE documents SET ref_doc_id = NULL WHERE ref_doc_id = ? AND company_id = ?', id, company.id);
    db.run('DELETE FROM document_lines WHERE document_id = ?', id);
    db.run('DELETE FROM documents WHERE id = ?', id);
  });
}

/** Recomputes the status of an invoice or bill from its payments and credit notes. */
export function refreshStatus(db, id) {
  const d = db.get('SELECT * FROM documents WHERE id = ?', id);
  if (!d || !['invoice', 'bill'].includes(d.kind) || d.status === 'draft') return;
  const paid = db.get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE document_id = ? AND status = 'completed'", id).s;
  const credited = db.get("SELECT COALESCE(SUM(total),0) s FROM documents WHERE ref_doc_id = ? AND kind = 'credit_note' AND status = 'validated'", id).s;
  const balance = d.total - paid - credited;
  let status = 'open';
  if (balance <= 0) status = paid === 0 && credited > 0 ? 'cancelled' : 'paid';
  else if (paid > 0 || credited > 0) status = 'partial';
  db.run('UPDATE documents SET paid = ?, credited = ?, status = ? WHERE id = ?', paid, credited, status, id);
}

/**
 * Validates an invoice, credit note or bill: gives it its final number and posts it
 * to the sales (VT) or purchases (AC) journal.
 */
export function validateDocument(db, ctx, company, id) {
  const d = getDocument(db, company.id, id);
  if (!d) throw notFound('Document introuvable');
  assertKindPerm(ctx.user, d.kind);
  if (d.kind === 'quote') throw bad('kind', 'Un devis ne se valide pas : convertissez-le en facture');
  if (d.status !== 'draft') throw conflict('already', 'Ce document est déjà validé');
  if (d.total <= 0) throw bad('total', 'Le montant du document doit être supérieur à zéro');
  assertOpenPeriod(db, company.id, d.date);
  const byAccount = {}; let vatGoods = 0, vatServices = 0;
  for (const l of d.lines) {
    byAccount[l.account_code] = (byAccount[l.account_code] || 0) + l.net;
    if (l.kind === 'good') vatGoods += l.vat; else vatServices += l.vat;
  }
  return db.tx(() => {
    const number = nextNumber(db, company.id, `${PREFIX[d.kind]}-${d.date.slice(0, 4)}`);
    let lines, journal, label;
    if (d.kind === 'invoice') {
      journal = 'VT'; label = `Facture ${number} – ${d.partner_name}`;
      lines = [
        { account: DEFAULTS.clients, partner_id: d.partner_id, debit: d.total },
        ...Object.entries(byAccount).map(([account, v]) => ({ account, credit: v })),
        { account: DEFAULTS.vat_collected, credit: vatGoods },
        { account: DEFAULTS.vat_collected_services, credit: vatServices },
      ];
    } else if (d.kind === 'credit_note') {
      if (d.ref_doc_id) {
        const inv = db.get('SELECT * FROM documents WHERE id = ?', d.ref_doc_id);
        if (!['open', 'partial'].includes(inv.status)) throw conflict('ref_doc', 'La facture d\'origine est déjà soldée ou annulée');
        const bal = inv.total - inv.paid - inv.credited;
        if (d.total > bal) throw bad('credit_too_big', `L'avoir (${d.total}) dépasse le reste à payer de la facture (${bal})`);
      }
      journal = 'VT'; label = `Avoir ${number} – ${d.partner_name}`;
      lines = [
        ...Object.entries(byAccount).map(([account, v]) => ({ account, debit: v })),
        { account: DEFAULTS.vat_collected, debit: vatGoods },
        { account: DEFAULTS.vat_collected_services, debit: vatServices },
        { account: DEFAULTS.clients, partner_id: d.partner_id, credit: d.total },
      ];
    } else {
      journal = 'AC'; label = `Facture fournisseur ${d.supplier_ref || number} – ${d.partner_name}`;
      lines = [
        ...Object.entries(byAccount).map(([account, v]) => ({ account, debit: v })),
        { account: DEFAULTS.vat_deductible, debit: vatGoods },
        { account: DEFAULTS.vat_deductible_services, debit: vatServices },
        { account: DEFAULTS.suppliers, partner_id: d.partner_id, credit: d.total },
      ];
    }
    const entryId = postEntry(db, { companyId: company.id, journal, date: d.date, label, ref: number, source_type: d.kind, source_id: d.id, userId: ctx.user.id, lines });
    const status = d.kind === 'credit_note' ? 'validated' : 'open';
    db.run('UPDATE documents SET number = ?, status = ?, entry_id = ?, validated_at = ? WHERE id = ?', number, status, entryId, now(), d.id);
    if (d.kind === 'credit_note' && d.ref_doc_id) refreshStatus(db, d.ref_doc_id);
    return number;
  });
}

export function setQuoteStatus(db, ctx, company, id, status) {
  const d = db.get("SELECT * FROM documents WHERE id = ? AND company_id = ? AND kind = 'quote'", id, company.id);
  if (!d) throw notFound('Devis introuvable');
  assertKindPerm(ctx.user, 'quote');
  if (!['draft', 'sent', 'accepted', 'refused'].includes(status)) throw bad('status', 'Statut invalide');
  if (d.status === 'invoiced') throw conflict('locked', 'Ce devis est déjà facturé');
  db.run('UPDATE documents SET status = ? WHERE id = ?', status, id);
}

/** Turns an accepted (or sent) quote into a draft invoice with the same lines. */
export function convertQuote(db, ctx, company, id) {
  const q = getDocument(db, company.id, id);
  if (!q || q.kind !== 'quote') throw notFound('Devis introuvable');
  assertKindPerm(ctx.user, 'invoice');
  if (q.status === 'invoiced') throw conflict('already', 'Ce devis est déjà facturé');
  if (q.status === 'refused') throw conflict('refused', 'Ce devis a été refusé');
  return db.tx(() => {
    const invId = createDocument(db, ctx, company, {
      kind: 'invoice', partner_id: q.partner_id, date: today(), subject: q.subject, notes: q.notes,
      lines: q.lines.map((l) => ({ product_id: l.product_id, description: l.description, qty: l.qty, unit: l.unit, unit_price: l.unit_price, discount: l.discount, vat_rate: l.vat_rate, account_code: l.account_code, kind: l.kind })),
    });
    db.run('UPDATE documents SET ref_doc_id = ? WHERE id = ?', q.id, invId);
    db.run("UPDATE documents SET status = 'invoiced' WHERE id = ?", q.id);
    return invId;
  });
}

/** Prepares a draft credit note for the unpaid part of an invoice. */
export function creditNoteFor(db, ctx, company, id) {
  const inv = getDocument(db, company.id, id);
  if (!inv || inv.kind !== 'invoice') throw notFound('Facture introuvable');
  if (!['open', 'partial'].includes(inv.status)) throw conflict('state', 'Seule une facture non soldée peut recevoir un avoir');
  const full = inv.balance === inv.total;
  const lines = full
    ? inv.lines.map((l) => ({ product_id: l.product_id, description: l.description, qty: l.qty, unit: l.unit, unit_price: l.unit_price, discount: l.discount, vat_rate: l.vat_rate, account_code: l.account_code, kind: l.kind }))
    : [{ description: `Avoir sur facture ${inv.number}`, qty: 1, unit_price: Math.floor(inv.balance / (1 + (inv.lines[0]?.vat_rate || 0) / 100)), vat_rate: inv.lines[0]?.vat_rate || 0, account_code: inv.lines[0]?.account_code, kind: inv.lines[0]?.kind }];
  return createDocument(db, ctx, company, { kind: 'credit_note', partner_id: inv.partner_id, date: today(), subject: `Avoir sur facture ${inv.number}`, ref_doc_id: inv.id, lines });
}

export function duplicateDocument(db, ctx, company, id) {
  const d = getDocument(db, company.id, id);
  if (!d) throw notFound('Document introuvable');
  return createDocument(db, ctx, company, {
    kind: d.kind === 'credit_note' ? 'invoice' : d.kind, partner_id: d.partner_id, date: today(), subject: d.subject, notes: d.notes,
    lines: d.lines.map((l) => ({ product_id: l.product_id, description: l.description, qty: l.qty, unit: l.unit, unit_price: l.unit_price, discount: l.discount, vat_rate: l.vat_rate, account_code: l.account_code, kind: l.kind })),
  });
}
