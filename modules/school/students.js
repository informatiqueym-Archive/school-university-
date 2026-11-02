// Students, guardians and enrolment; fees (each instalment is a Compta
// invoice, VAT-exempt) and the bursar's till with receipts and Mobile Money;
// attendance roll calls, gate scans and discipline; online admissions.
import { bad, notFound, conflict } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { raiseAlert, audit } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { normalizePhone, PROVIDERS } from '../../core/payments/mobile-money.js';
import { nextNumber } from '../accounting/ledger.js';
import * as docs from '../accounting/documents.js';
import * as tr from '../accounting/treasury.js';
import { token, shortCode, settingsOf, activeYear } from './schema.js';

export const sys = (ctx) => ({ ...ctx, user: { ...(ctx.user || {}), role: 'owner' } });
const nameOf = (s) => `${s.last_name} ${s.first_name}`;

// ---------------- Students ----------------
const studentSql = `SELECT s.*, p.name guardian_name, p.phone guardian_phone, p.email guardian_email,
  e.class_id, c.name class_name, c.level_id, e.repeating, e.id enrollment_id
  FROM school_students s LEFT JOIN partners p ON p.id = s.guardian_id
  LEFT JOIN school_enrollments e ON e.student_id = s.id AND e.year_id = ? AND e.status = 'enrolled'
  LEFT JOIN school_classes c ON c.id = e.class_id`;

export function listStudents(db, companyId, q = {}) {
  const y = q.year_id || activeYear(db, companyId)?.id;
  const where = ['s.company_id = ?']; const p = [y, companyId];
  if (q.class_id) { where.push('e.class_id = ?'); p.push(q.class_id); }
  else if (!q.all) where.push('e.id IS NOT NULL');
  if (q.status) { where.push('s.status = ?'); p.push(q.status); }
  if (q.q) { where.push('(s.last_name LIKE ? OR s.first_name LIKE ? OR s.matricule LIKE ? OR p.name LIKE ? OR p.phone LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s, s, s); }
  const rows = db.all(`${studentSql} WHERE ${where.join(' AND ')} ORDER BY c.name, s.last_name, s.first_name LIMIT 3000`, ...p);
  if (q.balances) {
    const bal = Object.fromEntries(db.all(`SELECT f.student_id, SUM(d.total - d.paid - d.credited) due, SUM(CASE WHEN d.due_date < ? THEN d.total - d.paid - d.credited ELSE 0 END) overdue
      FROM school_student_fees f JOIN documents d ON d.id = f.document_id WHERE f.company_id = ? AND f.year_id = ? AND d.status IN ('open','partial') GROUP BY f.student_id`, today(), companyId, y).map((r) => [r.student_id, r]));
    for (const r of rows) { r.due = bal[r.id]?.due || 0; r.overdue = bal[r.id]?.overdue || 0; }
  }
  for (const r of rows) delete r.photo_full;
  return rows.map(({ photo, ...r }) => ({ ...r, has_photo: !!photo }));
}

export function getStudent(db, companyId, id) {
  const y = activeYear(db, companyId);
  const s = db.get(`${studentSql} WHERE s.id = ? AND s.company_id = ?`, y?.id, id, companyId);
  if (!s) throw notFound('Élève introuvable');
  s.year = y;
  s.history = db.all('SELECT e.*, y.name year_name, c.name class_name FROM school_enrollments e JOIN school_years y ON y.id = e.year_id JOIN school_classes c ON c.id = e.class_id WHERE e.student_id = ? ORDER BY y.start_date DESC', id);
  s.siblings = s.guardian_id ? db.all('SELECT id, last_name, first_name, matricule FROM school_students WHERE guardian_id = ? AND id != ? AND status = ?', s.guardian_id, id, 'active') : [];
  s.subscriptions = db.all('SELECT fee_item_id FROM school_subscriptions WHERE student_id = ?', id).map((r) => r.fee_item_id);
  return s;
}

/** Finds the guardian (Compta customer) by phone, or creates them. */
export function guardianFor(db, companyId, { name, phone, email, address }) {
  const n = str(name, 120); if (!n) throw bad('guardian', 'Le nom du parent / tuteur est obligatoire');
  let ph = str(phone, 30);
  if (ph) { try { ph = normalizePhone(ph); } catch { /* keep as typed */ } }
  const found = ph ? db.get("SELECT id FROM partners WHERE company_id = ? AND kind = 'client' AND phone = ?", companyId, ph) : null;
  if (found) {
    if (email) db.run("UPDATE partners SET email = CASE WHEN email = '' THEN ? ELSE email END WHERE id = ?", str(email, 120), found.id);
    return found.id;
  }
  return Number(db.run("INSERT INTO partners (company_id, kind, name, phone, email, address, city, notes, created_at) VALUES (?, 'client', ?, ?, ?, ?, '', 'Parent / tuteur (Teknons École)', ?)",
    companyId, n, ph, str(email, 120), str(address, 300), now()).lastInsertRowid);
}

function nextMatricule(db, companyId) {
  const s = settingsOf(db, companyId); const y = activeYear(db, companyId);
  return nextNumber(db, companyId, `${(s.matricule_prefix || 'TKS').toUpperCase()}${(y?.name || '').slice(2, 4)}`, 4).replace('-', '');
}

function studentValues(b, cur = {}) {
  const v = (k, max = 200) => str(b[k] ?? cur[k], max);
  const last = v('last_name', 80).toUpperCase(), first = v('first_name', 80);
  if (!last || !first) throw bad('name', "Le nom et le prénom de l'élève sont obligatoires");
  const photo = b.photo === undefined ? cur.photo || '' : String(b.photo || '');
  if (photo && (!/^data:image\/(png|jpeg|webp);base64,/.test(photo) || photo.length > 300_000)) throw bad('photo', 'Photo invalide (JPG/PNG, 200 Ko max)');
  const birth = b.birth_date ?? cur.birth_date; if (birth) vDate(birth, 'birth_date');
  return { last_name: last, first_name: first, sex: oneOf(b.sex ?? cur.sex, ['M', 'F'], 'sex', 'M'), birth_date: birth || '', birth_place: v('birth_place', 80), nationality: v('nationality', 60) || 'Camerounaise',
    photo, guardian_relation: v('guardian_relation', 40) || 'Parent', guardian2_name: v('guardian2_name', 120), guardian2_phone: v('guardian2_phone', 30), address: v('address', 300),
    blood_group: v('blood_group', 5), allergies: v('allergies', 300), medical_notes: v('medical_notes', 1000), previous_school: v('previous_school', 160),
    discount_pct: Math.max(0, Math.min(100, num(b.discount_pct ?? cur.discount_pct, 'discount_pct', { def: 0 }))), discount_reason: v('discount_reason', 120) };
}

export function createStudent(db, bus, ctx, company, b) {
  const v = studentValues(b);
  return db.tx(() => {
    const guardian_id = b.guardian_id ? db.get("SELECT id FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", b.guardian_id, company.id)?.id : guardianFor(db, company.id, { name: b.guardian_name, phone: b.guardian_phone, email: b.guardian_email, address: b.address });
    if (!guardian_id) throw bad('guardian', 'Parent / tuteur introuvable');
    const matricule = str(b.matricule, 30) || nextMatricule(db, company.id);
    const r = db.run(`INSERT INTO school_students (company_id, matricule, last_name, first_name, sex, birth_date, birth_place, nationality, photo, guardian_id, guardian_relation, guardian2_name, guardian2_phone, address, blood_group, allergies, medical_notes, previous_school, discount_pct, discount_reason, portal_token, card_code, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, company.id, matricule, v.last_name, v.first_name, v.sex, v.birth_date, v.birth_place, v.nationality, v.photo, guardian_id, v.guardian_relation, v.guardian2_name, v.guardian2_phone,
    v.address, v.blood_group, v.allergies, v.medical_notes, v.previous_school, v.discount_pct, v.discount_reason, token(), shortCode(), now());
    const id = Number(r.lastInsertRowid);
    for (const f of Array.isArray(b.subscriptions) ? b.subscriptions : []) db.run('INSERT OR IGNORE INTO school_subscriptions (student_id, fee_item_id) VALUES (?,?)', id, Number(f));
    if (b.class_id) enroll(db, ctx, company, id, { class_id: b.class_id, repeating: b.repeating, bill: b.bill !== false });
    audit(db, ctx, 'create', 'student', id, `${matricule} ${v.last_name} ${v.first_name}`);
    bus?.emit(company.id, 'change', { entity: 'school_student', id });
    return getStudent(db, company.id, id);
  });
}

export function updateStudent(db, bus, ctx, company, id, b) {
  const cur = db.get('SELECT * FROM school_students WHERE id = ? AND company_id = ?', id, company.id); if (!cur) throw notFound('Élève introuvable');
  const v = studentValues(b, cur);
  db.tx(() => {
    db.run(`UPDATE school_students SET last_name = ?, first_name = ?, sex = ?, birth_date = ?, birth_place = ?, nationality = ?, photo = ?, guardian_relation = ?, guardian2_name = ?, guardian2_phone = ?, address = ?, blood_group = ?, allergies = ?, medical_notes = ?, previous_school = ?, discount_pct = ?, discount_reason = ?, status = ? WHERE id = ?`,
      v.last_name, v.first_name, v.sex, v.birth_date, v.birth_place, v.nationality, v.photo, v.guardian_relation, v.guardian2_name, v.guardian2_phone, v.address, v.blood_group, v.allergies, v.medical_notes, v.previous_school, v.discount_pct, v.discount_reason,
      oneOf(b.status ?? cur.status, ['active', 'left', 'graduated'], 'status'), id);
    if (b.guardian_name || b.guardian_phone) {
      const g = db.get('SELECT * FROM partners WHERE id = ?', cur.guardian_id);
      if (g) db.run('UPDATE partners SET name = ?, phone = ?, email = ? WHERE id = ?', str(b.guardian_name ?? g.name, 120), str(b.guardian_phone ?? g.phone, 30), str(b.guardian_email ?? g.email, 120), g.id);
    }
    if (Array.isArray(b.subscriptions)) {
      db.run('DELETE FROM school_subscriptions WHERE student_id = ?', id);
      for (const f of b.subscriptions) db.run('INSERT OR IGNORE INTO school_subscriptions (student_id, fee_item_id) VALUES (?,?)', id, Number(f));
      billStudent(db, ctx, company, id);
    }
    if (b.status === 'left') db.run("UPDATE school_enrollments SET status = 'left' WHERE student_id = ? AND year_id = ?", id, activeYear(db, company.id)?.id);
  });
  audit(db, ctx, 'update', 'student', id);
  bus?.emit(company.id, 'change', { entity: 'school_student', id });
  return getStudent(db, company.id, id);
}

export function enroll(db, ctx, company, studentId, { class_id, repeating = false, bill = true }) {
  const c = db.get('SELECT * FROM school_classes WHERE id = ? AND company_id = ?', class_id, company.id); if (!c) throw bad('class', 'Classe introuvable');
  const size = db.get("SELECT COUNT(*) n FROM school_enrollments WHERE class_id = ? AND status = 'enrolled' AND student_id != ?", c.id, studentId).n;
  if (size >= c.capacity) throw conflict('full', `La classe ${c.name} est complète (${c.capacity} places)`);
  const ex = db.get('SELECT * FROM school_enrollments WHERE student_id = ? AND year_id = ?', studentId, c.year_id);
  if (ex) db.run("UPDATE school_enrollments SET class_id = ?, repeating = ?, status = 'enrolled' WHERE id = ?", c.id, repeating ? 1 : 0, ex.id);
  else db.run('INSERT INTO school_enrollments (company_id, student_id, year_id, class_id, repeating, created_at) VALUES (?,?,?,?,?,?)', company.id, studentId, c.year_id, c.id, repeating ? 1 : 0, now());
  db.run("UPDATE school_students SET status = 'active' WHERE id = ?", studentId);
  if (bill) billStudent(db, ctx, company, studentId, c.year_id);
  return c;
}

// ---------------- Fees ----------------
export function feeItems(db, companyId, yearId) {
  return db.all('SELECT f.*, l.name level_name FROM school_fee_items f LEFT JOIN school_levels l ON l.id = f.level_id WHERE f.company_id = ? AND f.year_id = ? ORDER BY f.position, f.due_date, f.id', companyId, yearId);
}

/** Creates the invoices a student owes for the year (each instalment once). Returns how many were created. */
export function billStudent(db, ctx, company, studentId, yearId = activeYear(db, company.id)?.id) {
  const st = db.get('SELECT * FROM school_students WHERE id = ?', studentId);
  const enr = db.get("SELECT e.*, c.level_id, c.name class_name FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id WHERE e.student_id = ? AND e.year_id = ? AND e.status = 'enrolled'", studentId, yearId);
  if (!st || !enr || !st.guardian_id) return 0;
  const year = db.get('SELECT * FROM school_years WHERE id = ?', yearId);
  const subs = new Set(db.all('SELECT fee_item_id FROM school_subscriptions WHERE student_id = ?', studentId).map((r) => r.fee_item_id));
  const items = db.all('SELECT * FROM school_fee_items WHERE company_id = ? AND year_id = ? AND active = 1 AND (level_id IS NULL OR level_id = ?) ORDER BY due_date, position', company.id, yearId, enr.level_id);
  // A level-specific item replaces the general one with the same name.
  const named = new Map();
  for (const it of items) if (!named.has(it.name) || it.level_id) named.set(it.name, it);
  let n = 0;
  for (const it of named.values()) {
    if (it.kind === 'optional' && !subs.has(it.id)) continue;
    if (db.get('SELECT 1 FROM school_student_fees WHERE student_id = ? AND fee_item_id = ?', studentId, it.id)) continue;
    const t = today(); const date = t; const due = it.due_date < t ? t : it.due_date;
    const discount = it.kind === 'tuition' ? st.discount_pct : 0;
    const docId = docs.createDocument(db, sys(ctx), company, {
      kind: 'invoice', partner_id: st.guardian_id, date, due_date: due, validate: true,
      subject: `${it.name} ${year.name} – ${nameOf(st)} (${enr.class_name}) – Mat. ${st.matricule}`,
      notes: discount ? `Réduction ${discount} % : ${st.discount_reason || 'bourse'}` : '',
      lines: [{ description: `${it.name} – ${nameOf(st)} (${enr.class_name})`, qty: 1, unit_price: it.amount, discount, vat_rate: 0, account_code: it.account_code, kind: 'service' }],
    });
    db.run('INSERT INTO school_student_fees (company_id, student_id, year_id, fee_item_id, document_id, created_at) VALUES (?,?,?,?,?,?)', company.id, studentId, yearId, it.id, docId, now());
    n++;
  }
  return n;
}

/** Fee situation of a student: every instalment with its invoice, paid and due. */
export function studentFees(db, companyId, studentId, yearId = activeYear(db, companyId)?.id) {
  const rows = db.all(`SELECT f.id, f.fee_item_id, i.name, i.kind, d.id document_id, d.number, d.date, d.due_date, d.total, d.paid, d.credited, d.status, d.pay_token,
      (d.total - d.paid - d.credited) balance, CASE WHEN d.status IN ('open','partial') AND d.due_date < ? THEN 1 ELSE 0 END overdue
    FROM school_student_fees f JOIN school_fee_items i ON i.id = f.fee_item_id JOIN documents d ON d.id = f.document_id
    WHERE f.student_id = ? AND f.year_id = ? AND f.company_id = ? ORDER BY d.due_date, i.position`, today(), studentId, yearId, companyId);
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return { items: rows, total: sum('total'), paid: sum('paid'), credited: sum('credited'), balance: rows.filter((r) => ['open', 'partial'].includes(r.status)).reduce((s, r) => s + r.balance, 0),
    overdue: rows.filter((r) => r.overdue).reduce((s, r) => s + r.balance, 0),
    receipts: db.all('SELECT id, number, amount, method, reference, created_at FROM school_receipts WHERE student_id = ? AND company_id = ? ORDER BY id DESC', studentId, companyId) };
}

/** Bursar's till: one amount, spread over the oldest unpaid instalments; one receipt. */
export function collect(db, bus, ctx, company, b) {
  const st = db.get('SELECT * FROM school_students WHERE id = ? AND company_id = ?', b.student_id, company.id); if (!st) throw notFound('Élève introuvable');
  const method = oneOf(b.method, ['cash', 'bank', 'cheque', 'mtn_momo', 'orange_money'], 'method', 'cash');
  let left = int(b.amount, 'amount', { min: 1 });
  const fees = studentFees(db, company.id, st.id);
  const open = fees.items.filter((r) => ['open', 'partial'].includes(r.status) && (!b.document_ids?.length || b.document_ids.includes(r.document_id)));
  const due = open.reduce((s, r) => s + r.balance, 0);
  if (!due) throw conflict('nothing_due', 'Cet élève ne doit rien pour le moment');
  if (left > due) throw bad('overpay', `Le montant dépasse le reste à payer (${fcfa(due)})`);
  return db.tx(() => {
    const allocations = [];
    for (const r of open) {
      if (left <= 0) break;
      const a = Math.min(left, r.balance);
      const pid = tr.recordPayment(db, sys(ctx), company, { direction: 'in', document_id: r.document_id, amount: a, method, reference: str(b.reference, 80), phone: str(b.phone, 30), notes: `Teknons École – ${nameOf(st)}` });
      allocations.push({ document_id: r.document_id, number: r.number, label: r.name, amount: a, payment_id: pid });
      left -= a;
    }
    const total = allocations.reduce((s, x) => s + x.amount, 0);
    const number = nextNumber(db, company.id, `REC-${today().slice(0, 4)}`, 5);
    const rid = Number(db.run('INSERT INTO school_receipts (company_id, number, student_id, amount, method, reference, payer, allocations, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      company.id, number, st.id, total, method, str(b.reference, 80), str(b.payer, 120), JSON.stringify(allocations), ctx.user?.id ?? null, now()).lastInsertRowid);
    audit(db, ctx, 'collect', 'school_receipt', rid, `${number} ${fcfa(total)} ${nameOf(st)}`);
    bus?.emit(company.id, 'change', { entity: 'school_fee', id: st.id });
    return { id: rid, number, amount: total, allocations, balance: studentFees(db, company.id, st.id).balance };
  });
}

/** Mobile Money prompt on the parent's phone for the oldest unpaid instalment (staff or portal). */
export async function momoForStudent(db, momo, company, studentId, { provider, phone, amount, document_id, userId = null, replaceStale = false }) {
  const fees = studentFees(db, company.id, studentId);
  const open = fees.items.filter((r) => ['open', 'partial'].includes(r.status));
  const target = document_id ? open.find((r) => r.document_id === Number(document_id)) : open[0];
  if (!target) throw conflict('nothing_due', 'Rien à payer pour le moment');
  const doc = db.get('SELECT * FROM documents WHERE id = ?', target.document_id);
  provider = provider || null;
  const id = await tr.startMomo(db, momo, company, doc, { provider: oneOf(provider, Object.keys(PROVIDERS), 'provider'), phone, amount: amount ? Math.min(Number(amount), target.balance) : target.balance, userId, replaceStale });
  return { payment_id: id, document: target.number, amount: amount ? Math.min(Number(amount), target.balance) : target.balance };
}

export function feeStatusByClass(db, companyId, yearId) {
  return db.all(`SELECT c.id, c.name, COUNT(DISTINCT e.student_id) students,
      COALESCE(SUM(d.total),0) billed, COALESCE(SUM(d.paid + d.credited),0) paid,
      COALESCE(SUM(CASE WHEN d.status IN ('open','partial') THEN d.total - d.paid - d.credited ELSE 0 END),0) due,
      COALESCE(SUM(CASE WHEN d.status IN ('open','partial') AND d.due_date < ? THEN d.total - d.paid - d.credited ELSE 0 END),0) overdue
    FROM school_classes c LEFT JOIN school_enrollments e ON e.class_id = c.id AND e.status = 'enrolled'
    LEFT JOIN school_student_fees f ON f.student_id = e.student_id AND f.year_id = c.year_id LEFT JOIN documents d ON d.id = f.document_id
    WHERE c.company_id = ? AND c.year_id = ? GROUP BY c.id ORDER BY c.name`, today(), companyId, yearId).map((r) => ({ ...r, rate: r.billed ? Math.round((r.paid / r.billed) * 1000) / 10 : 0 }));
}

export function debtors(db, companyId, yearId, { overdueOnly = true, class_id } = {}) {
  return db.all(`SELECT s.id, s.matricule, s.last_name, s.first_name, c.name class_name, p.name guardian_name, p.phone guardian_phone, s.portal_token,
      SUM(d.total - d.paid - d.credited) due, SUM(CASE WHEN d.due_date < ? THEN d.total - d.paid - d.credited ELSE 0 END) overdue, MIN(d.due_date) oldest
    FROM school_student_fees f JOIN documents d ON d.id = f.document_id JOIN school_students s ON s.id = f.student_id
    JOIN school_enrollments e ON e.student_id = s.id AND e.year_id = f.year_id AND e.status = 'enrolled' JOIN school_classes c ON c.id = e.class_id
    LEFT JOIN partners p ON p.id = s.guardian_id
    WHERE f.company_id = ? AND f.year_id = ? AND d.status IN ('open','partial') ${class_id ? 'AND c.id = ' + Number(class_id) : ''}
    GROUP BY s.id ${overdueOnly ? 'HAVING overdue > 0' : ''} ORDER BY overdue DESC, due DESC`, today(), companyId, yearId);
}

// ---------------- Attendance ----------------
export function rollCall(db, bus, ctx, company, b) {
  const c = db.get('SELECT * FROM school_classes WHERE id = ? AND company_id = ?', b.class_id, company.id); if (!c) throw notFound('Classe introuvable');
  const date = vDate(b.date, 'date', today());
  const slot = str(b.slot, 20) || (b.course_id ? `c${Number(b.course_id)}` : 'day');
  const hours = num(b.hours, 'hours', { min: 0, def: b.course_id ? 1 : 4 });
  const enrolled = new Set(db.all("SELECT student_id FROM school_enrollments WHERE class_id = ? AND status = 'enrolled'", c.id).map((r) => r.student_id));
  const absent = (Array.isArray(b.absent) ? b.absent : []).map(Number).filter((id) => enrolled.has(id));
  const late = (Array.isArray(b.late) ? b.late : []).filter((x) => enrolled.has(Number(x.student_id)));
  const s = settingsOf(db, company.id);
  db.tx(() => {
    db.run("DELETE FROM school_attendance WHERE class_id = ? AND date = ? AND source = 'roll' AND COALESCE(course_id,0) = ? AND justified = 0", c.id, date, Number(b.course_id) || 0);
    for (const id of absent) {
      if (db.get("SELECT 1 FROM school_attendance WHERE student_id = ? AND date = ? AND kind = 'absent' AND COALESCE(course_id,0) = ? AND source = 'roll'", id, date, Number(b.course_id) || 0)) continue;
      db.run("INSERT INTO school_attendance (company_id, student_id, class_id, course_id, date, kind, hours, recorded_by, created_at) VALUES (?,?,?,?,?, 'absent', ?, ?, ?)", company.id, id, c.id, Number(b.course_id) || null, date, hours, ctx.user.id, now());
    }
    for (const l of late) db.run("INSERT INTO school_attendance (company_id, student_id, class_id, course_id, date, kind, minutes, recorded_by, created_at) VALUES (?,?,?,?,?, 'late', ?, ?, ?)", company.id, Number(l.student_id), c.id, Number(b.course_id) || null, date, int(l.minutes, 'minutes', { min: 0, def: 10 }), ctx.user.id, now());
    db.run('INSERT OR REPLACE INTO school_rolls (class_id, date, slot, course_id, present, absent, by_user, at) VALUES (?,?,?,?,?,?,?,?)', c.id, date, slot, Number(b.course_id) || null, enrolled.size - absent.length, absent.length, ctx.user.id, now());
  });
  // Alert once a student passes the unjustified-hours threshold.
  for (const id of absent) {
    const h = db.get("SELECT COALESCE(SUM(hours),0) h FROM school_attendance WHERE student_id = ? AND kind = 'absent' AND justified = 0 AND date >= (SELECT start_date FROM school_years WHERE id = ?)", id, c.year_id).h;
    if (h >= s.absence_alert_hours) {
      const st = db.get('SELECT last_name, first_name FROM school_students WHERE id = ?', id);
      raiseAlert(db, bus, company.id, { kind: 'school_absence', level: 'warning', title: `${st.last_name} ${st.first_name} (${c.name}) : ${h} h d'absence non justifiée`, body: 'Convoquez le parent ou saisissez les justificatifs.', entity: 'school_student', entity_id: id });
    }
  }
  bus?.emit(company.id, 'change', { entity: 'school_attendance', id: c.id });
  return { ok: true, absent: absent.length, late: late.length, present: enrolled.size - absent.length };
}

export function attendanceOf(db, companyId, q = {}) {
  const where = ['a.company_id = ?']; const p = [companyId];
  if (q.class_id) { where.push('a.class_id = ?'); p.push(q.class_id); }
  if (q.student_id) { where.push('a.student_id = ?'); p.push(q.student_id); }
  if (q.date) { where.push('a.date = ?'); p.push(q.date); }
  if (q.from) { where.push('a.date >= ?'); p.push(q.from); }
  if (q.to) { where.push('a.date <= ?'); p.push(q.to); }
  if (q.unjustified) where.push("a.justified = 0 AND a.kind = 'absent'");
  return db.all(`SELECT a.*, s.last_name, s.first_name, s.matricule, c.name class_name, sub.name subject FROM school_attendance a JOIN school_students s ON s.id = a.student_id JOIN school_classes c ON c.id = a.class_id
    LEFT JOIN school_courses co ON co.id = a.course_id LEFT JOIN school_subjects sub ON sub.id = co.subject_id WHERE ${where.join(' AND ')} ORDER BY a.date DESC, s.last_name LIMIT 2000`, ...p);
}

export function absenceTotals(db, studentId, from = '0000', to = '9999') {
  const r = db.get(`SELECT COALESCE(SUM(CASE WHEN kind='absent' THEN hours END),0) hours, COALESCE(SUM(CASE WHEN kind='absent' AND justified=1 THEN hours END),0) justified,
    COALESCE(SUM(CASE WHEN kind='late' THEN 1 END),0) lates FROM school_attendance WHERE student_id = ? AND date BETWEEN ? AND ?`, studentId, from, to);
  return { hours: r.hours, justified: r.justified, unjustified: r.hours - r.justified, lates: r.lates };
}

// ---------------- Gate ----------------
/** Scan of a student card at the gate (QR or matricule). Arrival after the bell = lateness. */
export function gateScan(db, bus, ctx, company, b) {
  const raw = str(b.code, 200);
  const code = (raw.match(/\/v\/c\/([A-Z0-9]+)/i)?.[1] || raw).trim().toUpperCase();
  const st = db.get("SELECT * FROM school_students WHERE company_id = ? AND (card_code = ? OR UPPER(matricule) = ?)", company.id, code, code);
  if (!st) throw notFound('Carte inconnue');
  const y = activeYear(db, company.id);
  const enr = db.get("SELECT e.class_id, c.name class_name FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id WHERE e.student_id = ? AND e.year_id = ? AND e.status = 'enrolled'", st.id, y?.id);
  if (!enr || st.status !== 'active') throw conflict('not_enrolled', `${nameOf(st)} n'est pas inscrit(e) cette année`);
  const d = today();
  const last = db.get('SELECT direction FROM school_gate WHERE student_id = ? AND date = ? ORDER BY id DESC LIMIT 1', st.id, d);
  const direction = oneOf(b.direction, ['in', 'out'], 'direction', last?.direction === 'in' ? 'out' : 'in');
  const s = settingsOf(db, company.id);
  const at = b.at ? new Date(b.at) : new Date();
  const local = new Date(at.getTime() + 3600e3).toISOString().slice(11, 16); // Africa/Douala = UTC+1
  const [lh, lm] = s.late_after.split(':').map(Number); const [h, m] = local.split(':').map(Number);
  const late = direction === 'in' && !last ? Math.max(0, (h * 60 + m) - (lh * 60 + lm)) : 0;
  db.tx(() => {
    db.run('INSERT INTO school_gate (company_id, student_id, direction, at, date, late_minutes, by_user) VALUES (?,?,?,?,?,?,?)', company.id, st.id, direction, at.toISOString(), d, late, ctx.user?.id ?? null);
    if (late > 0) db.run("INSERT INTO school_attendance (company_id, student_id, class_id, date, kind, minutes, source, recorded_by, created_at) VALUES (?,?,?,?, 'late', ?, 'gate', ?, ?)", company.id, st.id, enr.class_id, d, late, ctx.user?.id ?? null, now());
  });
  const unpaid = studentFees(db, company.id, st.id).overdue;
  bus?.emit(company.id, 'change', { entity: 'school_gate', id: st.id });
  return { student: { id: st.id, name: nameOf(st), matricule: st.matricule, class_name: enr.class_name, has_photo: !!st.photo, allergies: st.allergies }, direction, time: local, late_minutes: late, overdue: unpaid };
}

export function gateToday(db, companyId) {
  const d = today();
  const y = activeYear(db, companyId);
  const total = db.get("SELECT COUNT(*) n FROM school_enrollments e JOIN school_students s ON s.id = e.student_id WHERE e.company_id = ? AND e.year_id = ? AND e.status = 'enrolled' AND s.status = 'active'", companyId, y?.id).n;
  const inside = db.get("SELECT COUNT(*) n FROM (SELECT student_id, direction FROM school_gate g WHERE company_id = ? AND date = ? AND id = (SELECT MAX(id) FROM school_gate WHERE student_id = g.student_id AND date = g.date)) WHERE direction = 'in'", companyId, d).n;
  const arrived = db.get("SELECT COUNT(DISTINCT student_id) n FROM school_gate WHERE company_id = ? AND date = ? AND direction = 'in'", companyId, d).n;
  const late = db.get('SELECT COUNT(DISTINCT student_id) n FROM school_gate WHERE company_id = ? AND date = ? AND late_minutes > 0', companyId, d).n;
  const recent = db.all('SELECT g.*, s.last_name, s.first_name, s.matricule, c.name class_name FROM school_gate g JOIN school_students s ON s.id = g.student_id LEFT JOIN school_enrollments e ON e.student_id = s.id AND e.year_id = ? LEFT JOIN school_classes c ON c.id = e.class_id WHERE g.company_id = ? AND g.date = ? ORDER BY g.id DESC LIMIT 40', y?.id, companyId, d);
  return { total, inside, arrived, late, recent };
}

// ---------------- Discipline ----------------
export const DISCIPLINE = {
  praise: { fr: 'Félicitations / encouragement', en: 'Praise' }, warning: { fr: 'Avertissement', en: 'Warning' }, detention: { fr: 'Consigne (heures de colle)', en: 'Detention' },
  blame: { fr: 'Blâme', en: 'Reprimand' }, suspension: { fr: 'Exclusion temporaire', en: 'Suspension' }, exclusion: { fr: 'Exclusion définitive', en: 'Expulsion' },
};
export function addDiscipline(db, bus, ctx, company, b) {
  const st = db.get('SELECT * FROM school_students WHERE id = ? AND company_id = ?', b.student_id, company.id); if (!st) throw notFound('Élève introuvable');
  const kind = oneOf(b.kind, Object.keys(DISCIPLINE), 'kind');
  const reason = str(b.reason, 500); if (!reason) throw bad('reason', 'Indiquez le motif');
  const id = Number(db.run('INSERT INTO school_discipline (company_id, student_id, date, kind, hours, days, reason, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    company.id, st.id, vDate(b.date, 'date', today()), kind, num(b.hours, 'hours', { min: 0, def: 0 }), int(b.days, 'days', { min: 0, def: 0 }), reason, ctx.user.id, now()).lastInsertRowid);
  if (['blame', 'suspension', 'exclusion'].includes(kind)) raiseAlert(db, bus, company.id, { kind: 'school_discipline', level: 'warning', title: `${DISCIPLINE[kind].fr} : ${nameOf(st)}`, body: reason, entity: 'school_discipline', entity_id: id });
  audit(db, ctx, 'create', 'school_discipline', id, `${kind} ${nameOf(st)}`);
  bus?.emit(company.id, 'change', { entity: 'school_discipline', id });
  return db.get('SELECT * FROM school_discipline WHERE id = ?', id);
}

// ---------------- Admissions ----------------
export function apply(db, bus, companyId, b) {
  const s = settingsOf(db, companyId);
  if (!s?.admissions_open) throw conflict('closed', 'Les préinscriptions en ligne sont fermées pour le moment');
  const last = str(b.last_name, 80).toUpperCase(), first = str(b.first_name, 80), g = str(b.guardian_name, 120), ph = str(b.guardian_phone, 30);
  if (!last || !first || !g || !ph) throw bad('required', "Nom et prénom de l'enfant, nom et téléphone du parent sont obligatoires");
  normalizePhone(ph);
  const level = b.level_id ? db.get('SELECT id, name FROM school_levels WHERE id = ? AND company_id = ?', b.level_id, companyId) : null;
  const y = activeYear(db, companyId);
  const tok = token(12);
  const id = Number(db.run(`INSERT INTO school_applications (company_id, year_id, level_id, last_name, first_name, sex, birth_date, previous_school, last_average, guardian_name, guardian_phone, guardian_email, notes, token, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, companyId, y?.id, level?.id ?? null, last, first, oneOf(b.sex, ['M', 'F'], 'sex', 'M'), b.birth_date ? vDate(b.birth_date, 'birth_date') : '', str(b.previous_school, 160),
  b.last_average === '' || b.last_average == null ? null : Math.max(0, Math.min(20, Number(b.last_average) || 0)), g, ph, str(b.guardian_email, 120), str(b.notes, 1000), tok, now()).lastInsertRowid);
  raiseAlert(db, bus, companyId, { kind: 'school_application', level: 'info', title: `Nouvelle préinscription : ${last} ${first}${level ? ` (${level.name})` : ''}`, body: `${g} · ${ph}`, entity: 'school_application', entity_id: id });
  bus?.emit(companyId, 'change', { entity: 'school_application', id });
  return { id, token: tok, reference: `PRE-${String(id).padStart(5, '0')}` };
}

export function acceptApplication(db, bus, ctx, company, id, b) {
  const a = db.get('SELECT * FROM school_applications WHERE id = ? AND company_id = ?', id, company.id); if (!a) throw notFound();
  if (a.status === 'accepted') throw conflict('already', 'Dossier déjà accepté');
  if (!b.class_id) throw bad('class', 'Choisissez la classe');
  const st = createStudent(db, bus, ctx, company, { last_name: a.last_name, first_name: a.first_name, sex: a.sex, birth_date: a.birth_date, previous_school: a.previous_school,
    guardian_name: a.guardian_name, guardian_phone: a.guardian_phone, guardian_email: a.guardian_email, class_id: b.class_id, subscriptions: b.subscriptions || [] });
  db.run("UPDATE school_applications SET status = 'accepted', student_id = ? WHERE id = ?", st.id, a.id);
  return st;
}
