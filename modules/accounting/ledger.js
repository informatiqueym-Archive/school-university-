// Double-entry core: every business event becomes a balanced journal entry.
// Entries are never edited or deleted; a mistake is cancelled by a reversal.
import { bad, conflict } from '../../core/errors.js';
import { now } from '../../core/schema.js';
import { JOURNALS } from './chart.js';

export function nextNumber(db, companyId, key, width = 4) {
  const row = db.get('SELECT next FROM sequences WHERE company_id = ? AND key = ?', companyId, key);
  const n = row ? row.next : 1;
  if (row) db.run('UPDATE sequences SET next = ? WHERE company_id = ? AND key = ?', n + 1, companyId, key);
  else db.run('INSERT INTO sequences (company_id, key, next) VALUES (?,?,?)', companyId, key, 2);
  return `${key}-${String(n).padStart(width, '0')}`;
}

export function lockDate(db, companyId) {
  return db.get('SELECT lock_date FROM acc_settings WHERE company_id = ?', companyId)?.lock_date || '';
}

export function assertOpenPeriod(db, companyId, date) {
  const lock = lockDate(db, companyId);
  if (lock && date <= lock) throw conflict('period_locked', `La période est clôturée jusqu'au ${lock}. Choisissez une date postérieure.`);
}

export function accountExists(db, companyId, code) {
  return !!db.get('SELECT 1 FROM accounts WHERE company_id = ? AND code = ? AND active = 1', companyId, code);
}

/**
 * Posts a balanced entry. lines: [{ account, debit?, credit?, partner_id?, label? }]
 * Lines with zero amounts are dropped. Returns the entry id.
 */
export function postEntry(db, { companyId, journal, date, label, ref = '', source_type = 'manual', source_id = null, userId = null, lines, reversal_of = null }) {
  if (!JOURNALS[journal]) throw bad('journal', 'Journal inconnu');
  if (!label) throw bad('label', "Le libellé de l'écriture est obligatoire");
  assertOpenPeriod(db, companyId, date);
  const clean = lines
    .map((l) => ({ ...l, debit: Math.round(l.debit || 0), credit: Math.round(l.credit || 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  if (clean.length < 2) throw bad('entry_lines', 'Une écriture doit comporter au moins deux lignes');
  let d = 0, c = 0;
  for (const l of clean) {
    if (l.debit < 0 || l.credit < 0) throw bad('negative', 'Les montants doivent être positifs');
    if (l.debit && l.credit) throw bad('both', 'Une ligne ne peut pas être à la fois au débit et au crédit');
    if (!accountExists(db, companyId, l.account)) throw bad('account', `Compte ${l.account} inexistant dans le plan comptable`);
    d += l.debit; c += l.credit;
  }
  if (d !== c) throw bad('unbalanced', `Écriture déséquilibrée : débit ${d} ≠ crédit ${c}`);
  return db.tx(() => {
    const number = nextNumber(db, companyId, `${journal}-${date.slice(0, 4)}`, 5);
    const r = db.run(`INSERT INTO journal_entries (company_id, journal, number, date, label, ref, source_type, source_id, reversal_of, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, companyId, journal, number, date, label.slice(0, 300), ref, source_type, source_id, reversal_of, userId, now());
    const id = Number(r.lastInsertRowid);
    for (const l of clean) {
      db.run('INSERT INTO journal_lines (entry_id, company_id, account_code, partner_id, label, debit, credit) VALUES (?,?,?,?,?,?,?)',
        id, companyId, l.account, l.partner_id ?? null, (l.label || label).slice(0, 300), l.debit, l.credit);
    }
    return id;
  });
}

/** Cancels an entry by posting its mirror image (contre-passation). */
export function reverseEntry(db, { companyId, entryId, date, userId, label }) {
  const e = db.get('SELECT * FROM journal_entries WHERE id = ? AND company_id = ?', entryId, companyId);
  if (!e) throw bad('entry', 'Écriture introuvable');
  if (e.reversed_by) throw conflict('already_reversed', 'Cette écriture est déjà annulée');
  const lines = db.all('SELECT * FROM journal_lines WHERE entry_id = ?', entryId);
  return db.tx(() => {
    const id = postEntry(db, {
      companyId, journal: e.journal, date: date > e.date ? date : e.date, label: label || `Annulation ${e.number} – ${e.label}`,
      ref: e.number, source_type: e.source_type, source_id: e.source_id, userId, reversal_of: e.id,
      lines: lines.map((l) => ({ account: l.account_code, partner_id: l.partner_id, label: `Annulation : ${l.label}`, debit: l.credit, credit: l.debit })),
    });
    db.run('UPDATE journal_entries SET reversed_by = ? WHERE id = ?', id, e.id);
    return id;
  });
}

export function getEntry(db, companyId, id) {
  const e = db.get('SELECT * FROM journal_entries WHERE id = ? AND company_id = ?', id, companyId);
  if (!e) return null;
  e.lines = db.all(`SELECT l.*, a.name account_name, p.name partner_name FROM journal_lines l
    LEFT JOIN accounts a ON a.company_id = l.company_id AND a.code = l.account_code
    LEFT JOIN partners p ON p.id = l.partner_id WHERE l.entry_id = ? ORDER BY l.id`, id);
  return e;
}

/** Balance (debit − credit) of accounts whose code starts with prefix, up to a date. */
export function balanceOf(db, companyId, prefix, { from, to } = {}) {
  const where = ['l.company_id = ?', 'l.account_code LIKE ?']; const p = [companyId, prefix + '%'];
  if (from) { where.push('e.date >= ?'); p.push(from); }
  if (to) { where.push('e.date <= ?'); p.push(to); }
  const r = db.get(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE ${where.join(' AND ')}`, ...p);
  return r.d - r.c;
}
