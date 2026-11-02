// SYSCOHADA reports: balance générale, grand livre, journaux, bilan, compte de
// résultat, déclaration de TVA, balances âgées and the live dashboard.
import { today } from '../../core/schema.js';
import { addDays } from '../../core/validate.js';
import { treasurySummary } from './treasury.js';
import { JOURNALS } from './chart.js';

export function period(q) {
  const y = new Date().getFullYear();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : `${y}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : today();
  return { from, to };
}

function sums(db, companyId, { from, to, before } = {}) {
  const where = ['l.company_id = ?']; const p = [companyId];
  if (before) { where.push('e.date < ?'); p.push(before); }
  if (from) { where.push('e.date >= ?'); p.push(from); }
  if (to) { where.push('e.date <= ?'); p.push(to); }
  const rows = db.all(`SELECT l.account_code code, SUM(l.debit) d, SUM(l.credit) c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE ${where.join(' AND ')} GROUP BY l.account_code`, ...p);
  return Object.fromEntries(rows.map((r) => [r.code, r]));
}

/** Balance générale à 6 colonnes. */
export function trialBalance(db, companyId, q) {
  const { from, to } = period(q);
  const opening = sums(db, companyId, { before: from });
  const moves = sums(db, companyId, { from, to });
  const names = Object.fromEntries(db.all('SELECT code, name FROM accounts WHERE company_id = ?', companyId).map((a) => [a.code, a.name]));
  const codes = [...new Set([...Object.keys(opening), ...Object.keys(moves)])].sort();
  const rows = codes.map((code) => {
    const ob = (opening[code]?.d || 0) - (opening[code]?.c || 0);
    const md = moves[code]?.d || 0, mc = moves[code]?.c || 0;
    const cb = ob + md - mc;
    return { code, name: names[code] || '', class: Number(code[0]), open_debit: ob > 0 ? ob : 0, open_credit: ob < 0 ? -ob : 0, debit: md, credit: mc, close_debit: cb > 0 ? cb : 0, close_credit: cb < 0 ? -cb : 0 };
  }).filter((r) => r.open_debit || r.open_credit || r.debit || r.credit);
  const total = rows.reduce((t, r) => { for (const k of ['open_debit', 'open_credit', 'debit', 'credit', 'close_debit', 'close_credit']) t[k] += r[k]; return t; },
    { open_debit: 0, open_credit: 0, debit: 0, credit: 0, close_debit: 0, close_credit: 0 });
  return { from, to, rows, total, balanced: total.debit === total.credit && total.close_debit === total.close_credit };
}

/** Grand livre: each account's lines with a running balance. */
export function generalLedger(db, companyId, q) {
  const { from, to } = period(q);
  const where = ['l.company_id = ?', 'e.date >= ?', 'e.date <= ?']; const p = [companyId, from, to];
  if (q.account) { where.push('l.account_code LIKE ?'); p.push(q.account + '%'); }
  if (q.partner_id) { where.push('l.partner_id = ?'); p.push(q.partner_id); }
  const lines = db.all(`SELECT l.account_code, e.date, e.journal, e.number, e.id entry_id, l.label, l.debit, l.credit, pa.name partner_name
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id LEFT JOIN partners pa ON pa.id = l.partner_id
    WHERE ${where.join(' AND ')} ORDER BY l.account_code, e.date, e.id, l.id LIMIT 20000`, ...p);
  const opening = sums(db, companyId, { before: from });
  const names = Object.fromEntries(db.all('SELECT code, name FROM accounts WHERE company_id = ?', companyId).map((a) => [a.code, a.name]));
  const accounts = [];
  let cur = null;
  for (const l of lines) {
    if (!cur || cur.code !== l.account_code) {
      const ob = q.partner_id ? 0 : (opening[l.account_code]?.d || 0) - (opening[l.account_code]?.c || 0);
      cur = { code: l.account_code, name: names[l.account_code] || '', opening: ob, debit: 0, credit: 0, balance: ob, lines: [] };
      accounts.push(cur);
    }
    cur.debit += l.debit; cur.credit += l.credit; cur.balance += l.debit - l.credit;
    cur.lines.push({ ...l, balance: cur.balance });
  }
  return { from, to, accounts };
}

export function journalReport(db, companyId, q) {
  const { from, to } = period(q);
  const where = ['e.company_id = ?', 'e.date >= ?', 'e.date <= ?']; const p = [companyId, from, to];
  if (q.journal) { where.push('e.journal = ?'); p.push(q.journal); }
  if (q.q) { where.push('(e.label LIKE ? OR e.number LIKE ? OR e.ref LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s); }
  const entries = db.all(`SELECT e.*, (SELECT SUM(debit) FROM journal_lines WHERE entry_id = e.id) amount, u.name user_name
    FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 2000`, ...p);
  const ids = entries.map((e) => e.id);
  const lines = ids.length ? db.all(`SELECT l.*, a.name account_name, pa.name partner_name FROM journal_lines l LEFT JOIN accounts a ON a.company_id = l.company_id AND a.code = l.account_code
    LEFT JOIN partners pa ON pa.id = l.partner_id WHERE l.entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.id`, ...ids) : [];
  const byEntry = {};
  for (const l of lines) (byEntry[l.entry_id] ||= []).push(l);
  for (const e of entries) e.lines = byEntry[e.id] || [];
  return { from, to, journal: q.journal || '', journals: JOURNALS, entries };
}

// ---- Balance sheet and income statement ----
const sumWhere = (bal, test, sign = 1) => Object.entries(bal).reduce((s, [code, v]) => (test(code) ? s + sign * v : s), 0);

function balancesAt(db, companyId, { from, to }) {
  const r = sums(db, companyId, { from, to });
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.d - v.c]));
}

/** Compte de résultat (système normal simplifié) for a period. */
export function incomeStatement(db, companyId, q) {
  const { from, to } = period(q);
  const b = balancesAt(db, companyId, { from, to });
  const pre = (...ps) => (code) => ps.some((p) => code.startsWith(p));
  const prod = (...ps) => sumWhere(b, pre(...ps), -1); // products are credit balances
  const chg = (...ps) => sumWhere(b, pre(...ps), 1);
  const lines = [
    { key: 'TA', label: 'Ventes de marchandises', ref: '701', value: prod('701') },
    { key: 'RA', label: 'Achats de marchandises', ref: '601', value: -chg('601') },
    { key: 'RB', label: 'Variation de stocks de marchandises', ref: '6031', value: -chg('6031') },
    { key: 'TB', label: 'Ventes de produits fabriqués', ref: '702-704', value: prod('702', '703', '704') },
    { key: 'TC', label: 'Travaux, services vendus', ref: '705-706', value: prod('705', '706') },
    { key: 'TD', label: 'Produits accessoires', ref: '707', value: prod('707') },
    { key: 'TDR', label: 'Rabais, remises accordés', ref: '709', value: prod('709') },
    { key: 'TF', label: "Subventions d'exploitation", ref: '71', value: prod('71') },
    { key: 'TG', label: 'Autres produits', ref: '72,75', value: prod('72', '73', '75') },
    { key: 'RC', label: 'Achats de matières et fournitures', ref: '602-608', value: -chg('602', '604', '605', '608') },
    { key: 'RE', label: 'Transports', ref: '61', value: -chg('61') },
    { key: 'RF', label: 'Services extérieurs', ref: '62-63', value: -chg('62', '63') },
    { key: 'RG', label: 'Impôts et taxes', ref: '64', value: -chg('64') },
    { key: 'RH', label: 'Autres charges', ref: '65', value: -chg('65') },
    { key: 'RI', label: 'Charges de personnel', ref: '66', value: -chg('66') },
    { key: 'TJ', label: 'Reprises et transferts de charges', ref: '78-79', value: prod('78', '79') },
    { key: 'RL', label: 'Dotations aux amortissements et provisions', ref: '68-69', value: -chg('68', '69') },
    { key: 'TK', label: 'Revenus financiers', ref: '77', value: prod('77') },
    { key: 'RM', label: 'Frais financiers', ref: '67', value: -chg('67') },
    { key: 'TN', label: 'Produits HAO', ref: '82,84,86,88', value: prod('82', '84', '86', '88') },
    { key: 'RO', label: 'Charges HAO', ref: '81,83,85,87', value: -chg('81', '83', '85', '87') },
    { key: 'RS', label: 'Impôts sur le résultat', ref: '89', value: -chg('89') },
  ];
  const v = Object.fromEntries(lines.map((l) => [l.key, l.value]));
  const margin = v.TA + v.RA + v.RB;
  const revenue = v.TA + v.TB + v.TC + v.TD + v.TDR;
  const added = margin + v.TB + v.TC + v.TD + v.TDR + v.TF + v.TG + v.RC + v.RE + v.RF + v.RG + v.RH;
  const ebe = added + v.RI;
  const operating = ebe + v.TJ + v.RL;
  const financial = v.TK + v.RM;
  const ordinary = operating + financial;
  const hao = v.TN + v.RO;
  const net = ordinary + hao + v.RS;
  return {
    from, to, lines,
    totals: { revenue, margin, added_value: added, ebe, operating, financial, ordinary, hao, net,
      products: prod('7', '82', '84', '86', '88'), charges: chg('6', '81', '83', '85', '87', '89') },
  };
}

/** Bilan (actif / passif) at a date. Every account balance lands exactly once. */
export function balanceSheet(db, companyId, q) {
  const { to } = period(q);
  const b = balancesAt(db, companyId, { to });
  const p = (...ps) => (c) => ps.some((x) => c.startsWith(x));
  const not = (t) => (c) => !t(c);
  const and = (...ts) => (c) => ts.every((t) => t(c));
  const net = (test) => sumWhere(b, test);
  const deb = (test) => Object.entries(b).reduce((s, [c, v]) => (test(c) && v > 0 ? s + v : s), 0);
  const cre = (test) => Object.entries(b).reduce((s, [c, v]) => (test(c) && v < 0 ? s - v : s), 0);
  const result = -sumWhere(b, p('6', '7', '8')); // profit if positive, until the year is closed
  const intangible = net(p('21', '281', '291')), land = net(p('22', '282', '292')), buildings = net(p('23', '283', '293')), equipment = net(p('24', '284', '294'));
  const advancesFA = net(p('25'));
  const financialFA = net(p('2')) - intangible - land - buildings - equipment - advancesFA;
  const treasury = and(p('5'), not(p('56')));
  const actif = [
    { section: 'Actif immobilisé', items: [
      { label: 'Immobilisations incorporelles', value: intangible },
      { label: 'Terrains', value: land },
      { label: 'Bâtiments, installations, agencements', value: buildings },
      { label: 'Matériel, mobilier et transport', value: equipment },
      { label: 'Avances et acomptes sur immobilisations', value: advancesFA },
      { label: 'Immobilisations financières', value: financialFA },
    ] },
    { section: 'Actif circulant', items: [
      { label: 'Stocks et en-cours', value: net(p('3')) },
      { label: 'Fournisseurs, avances versées', value: deb(p('40')) },
      { label: 'Clients', value: deb(p('41')) + net(p('491')) },
      { label: 'Autres créances', value: deb((c) => /^4[2-8]/.test(c)) + net(and(p('49'), not(p('491')))) },
    ] },
    { section: 'Trésorerie-actif', items: [
      { label: 'Banques, caisse, Mobile Money', value: deb(treasury) },
    ] },
  ];
  const passif = [
    { section: 'Capitaux propres et ressources assimilées', items: [
      { label: 'Capital', value: -net(and(p('10'), not(p('105', '106')))) },
      { label: 'Primes et écarts de réévaluation', value: -net(p('105', '106')) },
      { label: 'Réserves', value: -net(p('11')) },
      { label: 'Report à nouveau', value: -net(p('12')) },
      { label: "Résultat net de l'exercice", value: -net(p('13')) + result },
      { label: "Subventions d'investissement", value: -net(p('14')) },
      { label: 'Provisions réglementées', value: -net(p('15')) },
    ] },
    { section: 'Dettes financières et ressources assimilées', items: [
      { label: 'Emprunts et dettes financières', value: -net(p('16', '18')) },
      { label: 'Dettes de location-acquisition', value: -net(p('17')) },
      { label: 'Provisions pour risques et charges', value: -net(p('19')) },
    ] },
    { section: 'Passif circulant', items: [
      { label: 'Clients, avances reçues', value: cre(p('41')) },
      { label: 'Fournisseurs', value: cre(p('40')) },
      { label: 'Dettes fiscales et sociales', value: cre(p('42', '43', '44')) },
      { label: 'Autres dettes', value: cre((c) => /^4[5-8]/.test(c)) },
    ] },
    { section: 'Trésorerie-passif', items: [
      { label: 'Crédits de trésorerie, découverts', value: -net(p('56')) + cre(treasury) },
    ] },
  ];
  for (const s of [...actif, ...passif]) s.total = s.items.reduce((t, i) => t + i.value, 0);
  const ta = actif.reduce((s, x) => s + x.total, 0), tp = passif.reduce((s, x) => s + x.total, 0);
  return { to, actif, passif, total_actif: ta, total_passif: tp, result, balanced: ta === tp };
}

/** TVA: collected vs deductible for the period, with the Cameroon split 17.5 % + 10 % CAC. */
export function vatReport(db, companyId, q) {
  const { from, to } = period(q);
  const b = balancesAt(db, companyId, { from, to });
  const collected = -sumWhere(b, (c) => c.startsWith('443'));
  const deductible = sumWhere(b, (c) => c.startsWith('445'));
  const due = collected - deductible;
  const split = (v) => { const principal = Math.round(v * 17.5 / 19.25); return { principal, cac: v - principal }; };
  const sales = db.all(`SELECT dl.vat_rate rate, SUM(CASE WHEN d.kind = 'credit_note' THEN -dl.net ELSE dl.net END) base, SUM(CASE WHEN d.kind = 'credit_note' THEN -dl.vat ELSE dl.vat END) vat
    FROM document_lines dl JOIN documents d ON d.id = dl.document_id
    WHERE d.company_id = ? AND d.kind IN ('invoice','credit_note') AND d.status != 'draft' AND d.date BETWEEN ? AND ? GROUP BY dl.vat_rate ORDER BY dl.vat_rate DESC`, companyId, from, to);
  const purchases = db.all(`SELECT dl.vat_rate rate, SUM(dl.net) base, SUM(dl.vat) vat FROM document_lines dl JOIN documents d ON d.id = dl.document_id
    WHERE d.company_id = ? AND d.kind = 'bill' AND d.status != 'draft' AND d.date BETWEEN ? AND ? GROUP BY dl.vat_rate ORDER BY dl.vat_rate DESC`, companyId, from, to);
  const expenses = db.get("SELECT COALESCE(SUM(net),0) base, COALESCE(SUM(vat),0) vat FROM expenses WHERE company_id = ? AND status = 'posted' AND date BETWEEN ? AND ?", companyId, from, to);
  return { from, to, collected, deductible, due: Math.max(due, 0), credit: Math.max(-due, 0), collected_split: split(collected), due_split: split(Math.max(due, 0)), sales, purchases, expenses };
}

/** Balance âgée: open invoices (or bills) by client and by age past the due date. */
export function agedBalance(db, companyId, q, kind = 'invoice') {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : today();
  const docs = db.all(`SELECT d.id, d.number, d.date, d.due_date, d.partner_id, p.name partner_name, p.phone partner_phone, (d.total - d.paid - d.credited) balance
    FROM documents d JOIN partners p ON p.id = d.partner_id WHERE d.company_id = ? AND d.kind = ? AND d.status IN ('open','partial') ORDER BY p.name, d.due_date`, companyId, kind);
  const buckets = ['current', 'd30', 'd60', 'd90', 'over90'];
  const byPartner = {};
  const total = Object.fromEntries([...buckets, 'total'].map((k) => [k, 0]));
  for (const d of docs) {
    const days = Math.floor((Date.parse(at) - Date.parse(d.due_date || d.date)) / 864e5);
    const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'over90';
    d.days_overdue = Math.max(days, 0); d.bucket = bucket;
    const p = (byPartner[d.partner_id] ||= { partner_id: d.partner_id, partner_name: d.partner_name, partner_phone: d.partner_phone, ...Object.fromEntries([...buckets, 'total'].map((k) => [k, 0])), docs: [] });
    p[bucket] += d.balance; p.total += d.balance; p.docs.push(d);
    total[bucket] += d.balance; total.total += d.balance;
  }
  return { at, kind, rows: Object.values(byPartner).sort((a, b) => b.total - a.total), total };
}

/** Relevé de compte d'un client ou fournisseur. */
export function partnerStatement(db, companyId, partnerId, q) {
  const partner = db.get('SELECT * FROM partners WHERE id = ? AND company_id = ?', partnerId, companyId);
  if (!partner) return null;
  const gl = generalLedger(db, companyId, { ...q, partner_id: partnerId, account: partner.kind === 'client' ? '41' : '40' });
  const lines = gl.accounts.flatMap((a) => a.lines).sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0; for (const l of lines) { bal += l.debit - l.credit; l.balance = bal; }
  return { partner, from: gl.from, to: gl.to, lines, balance: partner.kind === 'client' ? bal : -bal };
}

/** Everything the owner wants to see on the phone, in one call. */
export function dashboard(db, companyId) {
  const t = today();
  const month = t.slice(0, 7);
  const year = t.slice(0, 4);
  const one = (sql, ...p) => db.get(sql, ...p);
  const salesMonth = one("SELECT COALESCE(SUM(CASE WHEN kind='credit_note' THEN -subtotal ELSE subtotal END),0) v FROM documents WHERE company_id = ? AND kind IN ('invoice','credit_note') AND status NOT IN ('draft') AND substr(date,1,7) = ?", companyId, month).v;
  const salesYear = one("SELECT COALESCE(SUM(CASE WHEN kind='credit_note' THEN -subtotal ELSE subtotal END),0) v FROM documents WHERE company_id = ? AND kind IN ('invoice','credit_note') AND status NOT IN ('draft') AND substr(date,1,4) = ?", companyId, year).v;
  const inMonth = one("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE company_id = ? AND direction = 'in' AND status = 'completed' AND substr(date,1,7) = ?", companyId, month).v;
  const outMonth = one("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE company_id = ? AND direction = 'out' AND status = 'completed' AND substr(date,1,7) = ?", companyId, month).v
    + one("SELECT COALESCE(SUM(total),0) v FROM expenses WHERE company_id = ? AND status = 'posted' AND substr(date,1,7) = ?", companyId, month).v;
  const todayIn = one("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM payments WHERE company_id = ? AND direction = 'in' AND status = 'completed' AND date = ?", companyId, t);
  const receivable = one("SELECT COALESCE(SUM(total - paid - credited),0) v, COUNT(*) n FROM documents WHERE company_id = ? AND kind = 'invoice' AND status IN ('open','partial')", companyId);
  const overdue = one("SELECT COALESCE(SUM(total - paid - credited),0) v, COUNT(*) n FROM documents WHERE company_id = ? AND kind = 'invoice' AND status IN ('open','partial') AND due_date < ?", companyId, t);
  const payable = one("SELECT COALESCE(SUM(total - paid - credited),0) v, COUNT(*) n FROM documents WHERE company_id = ? AND kind = 'bill' AND status IN ('open','partial')", companyId);
  const quotesOpen = one("SELECT COALESCE(SUM(total),0) v, COUNT(*) n FROM documents WHERE company_id = ? AND kind = 'quote' AND status IN ('draft','sent','accepted')", companyId);
  const pendingMomo = one("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM payments WHERE company_id = ? AND status = 'pending'", companyId);
  // 12 months of sales (HT) and cash in/out
  const months = [];
  const d0 = new Date(t + 'T00:00:00Z'); d0.setUTCDate(1);
  for (let i = 11; i >= 0; i--) { const d = new Date(d0); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const since = months[0] + '-01';
  const salesBy = Object.fromEntries(db.all("SELECT substr(date,1,7) m, SUM(CASE WHEN kind='credit_note' THEN -subtotal ELSE subtotal END) v FROM documents WHERE company_id = ? AND kind IN ('invoice','credit_note') AND status != 'draft' AND date >= ? GROUP BY m", companyId, since).map((r) => [r.m, r.v]));
  const inBy = Object.fromEntries(db.all("SELECT substr(date,1,7) m, SUM(amount) v FROM payments WHERE company_id = ? AND direction = 'in' AND status = 'completed' AND date >= ? GROUP BY m", companyId, since).map((r) => [r.m, r.v]));
  const outBy = {};
  for (const r of db.all("SELECT substr(date,1,7) m, SUM(amount) v FROM payments WHERE company_id = ? AND direction = 'out' AND status = 'completed' AND date >= ? GROUP BY m", companyId, since)) outBy[r.m] = (outBy[r.m] || 0) + r.v;
  for (const r of db.all("SELECT substr(date,1,7) m, SUM(total) v FROM expenses WHERE company_id = ? AND status = 'posted' AND date >= ? GROUP BY m", companyId, since)) outBy[r.m] = (outBy[r.m] || 0) + r.v;
  const series = months.map((m) => ({ month: m, sales: salesBy[m] || 0, cash_in: inBy[m] || 0, cash_out: outBy[m] || 0 }));
  const byMethod = db.all("SELECT method, SUM(amount) v, COUNT(*) n FROM payments WHERE company_id = ? AND direction = 'in' AND status = 'completed' AND substr(date,1,7) = ? GROUP BY method ORDER BY v DESC", companyId, month);
  const topClients = db.all(`SELECT p.id, p.name, SUM(d.subtotal) v FROM documents d JOIN partners p ON p.id = d.partner_id WHERE d.company_id = ? AND d.kind = 'invoice' AND d.status != 'draft' AND substr(d.date,1,4) = ? GROUP BY p.id ORDER BY v DESC LIMIT 5`, companyId, year);
  const recent = db.all(`SELECT p.id, p.direction, p.date, p.amount, p.method, p.status, pa.name partner_name, d.number document_number FROM payments p LEFT JOIN partners pa ON pa.id = p.partner_id LEFT JOIN documents d ON d.id = p.document_id
    WHERE p.company_id = ? ORDER BY p.id DESC LIMIT 8`, companyId);
  const overdueList = db.all(`SELECT d.id, d.number, d.due_date, (d.total - d.paid - d.credited) balance, p.name partner_name, p.phone partner_phone FROM documents d JOIN partners p ON p.id = d.partner_id
    WHERE d.company_id = ? AND d.kind = 'invoice' AND d.status IN ('open','partial') AND d.due_date < ? ORDER BY d.due_date LIMIT 8`, companyId, t);
  const expensesMonth = db.all("SELECT e.account_code, a.name, SUM(e.total) v FROM expenses e LEFT JOIN accounts a ON a.company_id = e.company_id AND a.code = e.account_code WHERE e.company_id = ? AND e.status = 'posted' AND substr(e.date,1,7) = ? GROUP BY e.account_code ORDER BY v DESC LIMIT 6", companyId, month);
  const result = incomeStatement(db, companyId, { from: `${year}-01-01`, to: t }).totals.net;
  return {
    date: t, month,
    kpi: { sales_month: salesMonth, sales_year: salesYear, cash_in_month: inMonth, cash_out_month: outMonth, today_in: todayIn.v, today_in_count: todayIn.n,
      receivable: receivable.v, receivable_count: receivable.n, overdue: overdue.v, overdue_count: overdue.n, payable: payable.v, payable_count: payable.n,
      quotes_open: quotesOpen.v, quotes_open_count: quotesOpen.n, pending_momo: pendingMomo.v, pending_momo_count: pendingMomo.n, result_year: result },
    treasury: treasurySummary(db, companyId),
    series, byMethod, topClients, recent, overdueList, expensesMonth,
  };
}

/** Background checks that raise alerts (run every 30 minutes). */
export function runAlertChecks(db, bus, raiseAlert, fcfa) {
  const t = today();
  for (const c of db.all('SELECT id, low_cash_threshold FROM companies')) {
    for (const d of db.all(`SELECT d.id, d.number, d.due_date, (d.total - d.paid - d.credited) bal, p.name FROM documents d JOIN partners p ON p.id = d.partner_id
      WHERE d.company_id = ? AND d.kind = 'invoice' AND d.status IN ('open','partial') AND d.due_date < ?`, c.id, t)) {
      raiseAlert(db, bus, c.id, { kind: 'invoice_overdue', level: 'warning', title: `Facture ${d.number} en retard`, body: `${d.name} doit ${fcfa(d.bal)} depuis le ${d.due_date}.`, entity: 'document', entity_id: d.id });
    }
    for (const d of db.all(`SELECT d.id, d.number, d.due_date, (d.total - d.paid - d.credited) bal, p.name FROM documents d JOIN partners p ON p.id = d.partner_id
      WHERE d.company_id = ? AND d.kind = 'bill' AND d.status IN ('open','partial') AND d.due_date BETWEEN ? AND ?`, c.id, t, addDays(t, 3))) {
      raiseAlert(db, bus, c.id, { kind: 'bill_due', level: 'info', title: `Facture fournisseur à payer bientôt`, body: `${d.name} : ${fcfa(d.bal)} avant le ${d.due_date}.`, entity: 'document', entity_id: d.id });
    }
    for (const d of db.all(`SELECT d.id, d.number, d.due_date, p.name FROM documents d JOIN partners p ON p.id = d.partner_id
      WHERE d.company_id = ? AND d.kind = 'quote' AND d.status = 'sent' AND d.due_date BETWEEN ? AND ?`, c.id, t, addDays(t, 3))) {
      raiseAlert(db, bus, c.id, { kind: 'quote_expiring', level: 'info', title: `Devis ${d.number} expire bientôt`, body: `Relancez ${d.name} avant le ${d.due_date}.`, entity: 'document', entity_id: d.id });
    }
    const cash = treasurySummary(db, c.id).total;
    if (c.low_cash_threshold > 0 && cash < c.low_cash_threshold) {
      raiseAlert(db, bus, c.id, { kind: 'low_cash', level: 'danger', title: 'Trésorerie basse', body: `Total disponible : ${fcfa(cash)} (seuil ${fcfa(c.low_cash_threshold)}).`, entity: 'company', entity_id: Number(t.replaceAll('-', '')) });
    }
  }
}
