// Public pages (no account):
//   /p/:token      parent and student portal: marks and tests, report cards, attendance and gate
//                  arrivals, homework, timetable, fees with MTN MoMo / Orange Money, receipts,
//                  announcements, library (loans, holds), e-learning courses, siblings
//   /admission     online pre-registration
//   /learn         public catalogue of online courses (free or paid)
//   /research      open repository of publications, theses and dissertations
//   /v/:code, /v/c/:code, /v/cert/:code   verification of report cards, student cards, certificates
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notFound, HttpError, bad, conflict } from '../../core/errors.js';
import { str } from '../../core/validate.js';
import { today } from '../../core/schema.js';
import { normalizePhone, guessProvider, PROVIDERS } from '../../core/payments/mobile-money.js';
import { checkPending } from '../accounting/treasury.js';
import { baseUrl } from '../accounting/paylink.js';
import { settingsOf, activeYear } from './schema.js';
import * as ST from './students.js';
import * as G from './grades.js';
import * as A from './academics.js';
import * as LB from './library.js';
import * as LMS from './lms.js';
import * as PR from './print.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const page = () => fs.readFileSync(path.join(pub, 'school.html'), 'utf8');

const hits = new Map();
function throttle(ctx, key, max = 40, windowMs = 60e3) {
  const ip = String(ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '').split(',')[0].trim();
  const k = `${ip}|${key}`; const t = Date.now(); const h = hits.get(k);
  if (hits.size > 5000) hits.clear();
  if (!h || t - h.at > windowMs) { hits.set(k, { at: t, n: 1 }); return; }
  if (++h.n > max) throw new HttpError(429, 'rate', 'Trop de demandes, patientez une minute');
}
const schoolCompany = (db, id) => {
  const c = id ? db.get('SELECT c.* FROM companies c JOIN school_settings s ON s.company_id = c.id WHERE c.id = ?', id) : db.get('SELECT c.* FROM companies c JOIN school_settings s ON s.company_id = c.id ORDER BY c.id LIMIT 1');
  if (!c) throw notFound('Établissement introuvable');
  return c;
};
const guest = (companyId) => ({ user: { id: null, company_id: companyId, name: 'Portail parents', role: 'owner' } });

export function registerPortal(r, { db, bus, momo, env }) {
  for (const p of ['/p/:token', '/admission', '/learn', '/research', '/v/:code', '/v/c/:code', '/v/cert/:code']) r.get(p, (ctx) => ctx.send(page(), 'text/html; charset=utf-8', 200, { 'X-Robots-Tag': p.startsWith('/p/') ? 'noindex' : 'all', 'Referrer-Policy': 'no-referrer' }));

  const byToken = (tok) => {
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(tok || '')) throw notFound('Lien invalide');
    const st = db.get('SELECT * FROM school_students WHERE portal_token = ?', tok);
    if (!st) throw notFound('Lien introuvable. Demandez un nouveau lien au secrétariat.');
    return { st, company: db.get('SELECT * FROM companies WHERE id = ?', st.company_id) };
  };

  r.get('/api/public/school', (ctx) => {
    const c = schoolCompany(db, ctx.query.c); const s = settingsOf(db, c.id); const y = activeYear(db, c.id);
    return { id: c.id, name: c.name, logo: c.logo, city: c.city, address: c.address, phone: c.phone, email: c.email, motto: s.motto, welcome: s.welcome_text, grading: s.grading, kind: s.kind, year: y?.name,
      admissions_open: !!s.admissions_open, levels: A.levelsOf(db, c.id).filter((l) => l.active).map((l) => ({ id: l.id, name: l.name, cycle: l.cycle })) };
  });
  r.post('/api/public/school/apply', (ctx) => {
    throttle(ctx, 'apply', 5, 10 * 60e3);
    const c = schoolCompany(db, ctx.body.c);
    return ctx.json(ST.apply(db, bus, c.id, ctx.body), 201);
  });

  // ---------------- Portal ----------------
  r.get('/api/public/school/p/:token', (ctx) => {
    throttle(ctx, 'p:' + ctx.params.token, 60);
    const { st, company } = byToken(ctx.params.token);
    const s = settingsOf(db, company.id); const y = activeYear(db, company.id); const cid = company.id;
    const cls = db.get("SELECT c.*, u.name head_teacher FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id LEFT JOIN users u ON u.id = c.head_teacher_id WHERE e.student_id = ? AND e.year_id = ? AND e.status = 'enrolled'", st.id, y?.id);
    const g = db.get('SELECT name, phone, email FROM partners WHERE id = ?', st.guardian_id);
    const fees = ST.studentFees(db, cid, st.id);
    const gate = db.all('SELECT direction, at, late_minutes FROM school_gate WHERE student_id = ? ORDER BY id DESC LIMIT 10', st.id);
    const marks = G.studentMarks(db, cid, st.id);
    const reportable = marks.summary.filter((p) => p.locked).map((p) => ({ id: p.id, fr: p.fr, en: p.en }));
    const yearDone = cls && db.get("SELECT 1 FROM school_council WHERE class_id = ? AND period = 'year' AND student_id = ?", cls.id, st.id);
    if (yearDone) reportable.push({ id: 'year', fr: 'Année', en: 'Year' });
    return {
      school: { name: company.name, logo: company.logo, phone: company.phone, city: company.city, momo_number: company.momo_number, om_number: company.om_number, year: y?.name, grading: s.grading, pay: !!s.portal_pay,
        momo: { demo: momo.mode === 'simulation', mtn_momo: momo.configured('mtn_momo'), orange_money: momo.configured('orange_money') } },
      student: { id: st.id, matricule: st.matricule, last_name: st.last_name, first_name: st.first_name, sex: st.sex, birth_date: st.birth_date, photo: st.photo, allergies: st.allergies, class_name: cls?.name || '', head_teacher: cls?.head_teacher || '', status: st.status },
      guardian: g, siblings: st.guardian_id ? db.all("SELECT portal_token token, first_name, last_name FROM school_students WHERE guardian_id = ? AND id != ? AND status = 'active'", st.guardian_id, st.id) : [],
      marks, reportable, fees: { ...fees, items: fees.items.map(({ pay_token, ...x }) => x) },
      attendance: { list: ST.attendanceOf(db, cid, { student_id: st.id }).slice(0, 60).map((a) => ({ date: a.date, kind: a.kind, hours: a.hours, minutes: a.minutes, justified: a.justified, reason: a.reason, subject: a.subject })), totals: ST.absenceTotals(db, st.id, y?.start_date, y?.end_date), gate },
      discipline: db.all('SELECT date, kind, reason, hours, days FROM school_discipline WHERE student_id = ? ORDER BY date DESC LIMIT 30', st.id),
      homework: cls ? A.lessons(db, cid, { class_id: cls.id }).slice(0, 40).map((l) => ({ date: l.date, subject: l.subject, teacher: l.teacher_name, title: l.title, content: l.content, homework: l.homework, due_date: l.due_date })) : [],
      timetable: cls ? A.timetable(db, cid, { class_id: cls.id }).map((t) => ({ day: t.day, start: t.start, end: t.end, subject: t.subject, teacher: t.teacher_name, room: t.room, color: t.color })) : [],
      announcements: A.announcements(db, cid, cls?.id).slice(0, 20).map((a) => ({ title: a.title, body: a.body, date: a.created_at, class_name: a.class_name, pinned: a.pinned })),
      library: { loans: LB.loans(db, cid, { student_id: st.id }).slice(0, 20).map((l) => ({ title: l.title, authors: l.authors, borrowed_at: l.borrowed_at, due_date: l.due_date, returned_at: l.returned_at, overdue: l.overdue, fine_due: l.fine_due })),
        holds: db.all('SELECT h.status, h.created_at, b.title FROM school_holds h JOIN school_books b ON b.id = h.book_id WHERE h.student_id = ? AND h.status IN (\'waiting\',\'ready\')', st.id) },
      courses: LMS.myCourses(db, cid, st.id).map((c) => ({ id: c.id, title: c.title, subtitle: c.subtitle, teacher_name: c.teacher_name, cover_color: c.cover_color, pct: c.pct, done: c.done, total: c.total, certificate_code: c.certificate_code, access: c.access.ok, pending: !!c.access.pending })),
      exams: db.all('SELECT exam, session, series, result, mention FROM school_exam_results WHERE student_id = ? ORDER BY session DESC', st.id),
      today: today(),
    };
  });
  r.get('/p/:token/bulletin', (ctx) => {
    const { st, company } = byToken(ctx.params.token);
    const y = activeYear(db, company.id);
    const e = db.get("SELECT class_id FROM school_enrollments WHERE student_id = ? AND year_id = ? AND status = 'enrolled'", st.id, y?.id); if (!e) throw notFound();
    const s = settingsOf(db, company.id);
    const per = G.periods(s).find((p) => p.id === ctx.query.period); if (!per) throw notFound();
    const done = per.id === 'year' ? db.get("SELECT 1 FROM school_council WHERE class_id = ? AND period = 'year' AND student_id = ?", e.class_id, st.id) : per.seqs.every((q) => db.get('SELECT 1 FROM school_locks WHERE class_id = ? AND sequence = ?', e.class_id, q));
    if (!done) throw conflict('not_ready', 'Le bulletin sera disponible après le conseil de classe');
    ctx.send(PR.renderBulletins(company, s, G.bulletins(db, company.id, e.class_id, per.id, st.id), baseUrl(ctx, env), { lang: ctx.query.lang === 'en' ? 'en' : 'fr' }));
  });
  r.get('/p/:token/receipt/:id', (ctx) => {
    const { st, company } = byToken(ctx.params.token);
    const rc = db.get('SELECT * FROM school_receipts WHERE id = ? AND student_id = ?', ctx.params.id, st.id); if (!rc) throw notFound();
    ctx.send(PR.renderReceipt(company, settingsOf(db, company.id), rc, ST.getStudent(db, company.id, st.id), ST.studentFees(db, company.id, st.id)));
  });
  r.post('/api/public/school/p/:token/momo', async (ctx) => {
    const { st, company } = byToken(ctx.params.token);
    if (!settingsOf(db, company.id).portal_pay) throw conflict('off', 'Le paiement en ligne est désactivé : payez à l\'économat');
    throttle(ctx, 'pay:' + ctx.params.token, 6, 30 * 60e3);
    const phone = normalizePhone(ctx.body.phone);
    const provider = ctx.body.provider || guessProvider(phone);
    const r2 = await ST.momoForStudent(db, momo, company, st.id, { provider, phone, amount: ctx.body.amount, document_id: ctx.body.document_id, replaceStale: true });
    bus.emit(company.id, 'change', { entity: 'payment', id: r2.payment_id });
    return ctx.json(r2, 201);
  });
  r.get('/api/public/school/p/:token/momo/:id', async (ctx) => {
    const { st, company } = byToken(ctx.params.token);
    throttle(ctx, 'st:' + ctx.params.token, 40);
    const p = db.get('SELECT p.* FROM payments p JOIN school_student_fees f ON f.document_id = p.document_id WHERE p.id = ? AND f.student_id = ?', ctx.params.id, st.id)
      || db.get('SELECT p.* FROM payments p JOIN lms_enrollments e ON e.document_id = p.document_id WHERE p.id = ? AND e.student_id = ?', ctx.params.id, st.id);
    if (!p) throw notFound();
    if (p.status === 'pending') { try { await checkPending(db, bus, momo, { paymentId: p.id }); } catch { /* retry later */ } }
    const fresh = db.get('SELECT status, failure_reason, amount, reference FROM payments WHERE id = ?', p.id);
    return { ...fresh, balance: ST.studentFees(db, company.id, st.id).balance };
  });
  r.post('/api/public/school/p/:token/hold', (ctx) => {
    const { st, company } = byToken(ctx.params.token);
    throttle(ctx, 'hold:' + ctx.params.token, 10);
    return ctx.json(LB.hold(db, bus, company.id, Number(ctx.body.book_id), st.id), 201);
  });
  r.get('/api/public/school/p/:token/books', (ctx) => { const { company } = byToken(ctx.params.token); return LB.books(db, company.id, { q: str(ctx.query.q, 80), limit: 60 }).map(({ code, ...b }) => b); });

  // E-learning
  r.get('/api/public/school/p/:token/lms/:id', (ctx) => { const { st, company } = byToken(ctx.params.token); return LMS.learnerCourse(db, company.id, Number(ctx.params.id), st.id); });
  r.post('/api/public/school/p/:token/lms/lesson/:id', (ctx) => { const { st, company } = byToken(ctx.params.token); throttle(ctx, 'lms:' + ctx.params.token, 60); return LMS.completeLesson(db, company.id, Number(ctx.params.id), st.id, ctx.body); });
  r.post('/api/public/school/p/:token/lms/:id/enroll', (ctx) => {
    const { st, company } = byToken(ctx.params.token);
    const e = LMS.enrollCourse(db, guest(company.id), company, Number(ctx.params.id), st.id);
    return ctx.json({ ok: true, document_id: e.document_id }, 201);
  });
  r.post('/api/public/school/p/:token/lms/:id/pay', async (ctx) => {
    const { st, company } = byToken(ctx.params.token);
    throttle(ctx, 'pay:' + ctx.params.token, 6, 30 * 60e3);
    const e = db.get('SELECT * FROM lms_enrollments WHERE course_id = ? AND student_id = ?', ctx.params.id, st.id);
    if (!e?.document_id) throw bad('free', 'Ce cours ne demande pas de paiement');
    const phone = normalizePhone(ctx.body.phone);
    const { startMomo } = await import('../accounting/treasury.js');
    const id = await startMomo(db, momo, company, db.get('SELECT * FROM documents WHERE id = ?', e.document_id), { provider: ctx.body.provider || guessProvider(phone), phone, replaceStale: true });
    return ctx.json({ payment_id: id }, 201);
  });

  // Public course catalogue
  r.get('/api/public/school/learn', (ctx) => {
    const c = schoolCompany(db, ctx.query.c);
    return { school: { name: c.name, logo: c.logo, city: c.city }, courses: LMS.courses(db, c.id, { public: true }).map((x) => ({ id: x.id, title: x.title, subtitle: x.subtitle, description: x.description, teacher_name: x.teacher_name, price: x.price, lessons: x.lessons, minutes: x.minutes, enrolled: x.enrolled, category: x.category, level: x.level, cover_color: x.cover_color, certificate: x.certificate })) };
  });
  r.get('/api/public/school/learn/:id', (ctx) => {
    const c = schoolCompany(db, ctx.query.c);
    const d = LMS.courseDetail(db, c.id, Number(ctx.params.id));
    if (!d.public || !d.published) throw notFound();
    return { ...d, lessons_list: d.lessons_list.map((l) => ({ title: l.title, kind: l.kind, duration: l.duration, free_preview: l.free_preview })) };
  });
  r.post('/api/public/school/learn/:id/register', (ctx) => {
    throttle(ctx, 'learn', 6, 10 * 60e3);
    const c = schoolCompany(db, ctx.body.c);
    const course = db.get('SELECT * FROM lms_courses WHERE id = ? AND company_id = ? AND public = 1 AND published = 1', ctx.params.id, c.id); if (!course) throw notFound('Cours introuvable');
    const phone = normalizePhone(ctx.body.phone);
    const last = str(ctx.body.last_name, 80), first = str(ctx.body.first_name, 80);
    if (!last || !first) throw bad('name', 'Nom et prénom obligatoires');
    const g = ST.guardianFor(db, c.id, { name: `${last.toUpperCase()} ${first}`, phone, email: ctx.body.email });
    let st = db.get('SELECT * FROM school_students WHERE company_id = ? AND guardian_id = ? AND upper(last_name) = ? AND first_name = ?', c.id, g, last.toUpperCase(), first);
    if (!st) st = ST.createStudent(db, bus, guest(c.id), c, { last_name: last, first_name: first, guardian_id: g, guardian_relation: 'Lui-même / elle-même' });
    LMS.enrollCourse(db, guest(c.id), c, course.id, st.id);
    const tok = db.get('SELECT portal_token FROM school_students WHERE id = ?', st.id).portal_token;
    return ctx.json({ token: tok, url: `${baseUrl(ctx, env)}/p/${tok}#course-${course.id}` }, 201);
  });

  // Open research repository
  r.get('/api/public/school/research', (ctx) => {
    const c = schoolCompany(db, ctx.query.c);
    if (!settingsOf(db, c.id).repository_public) throw notFound('Dépôt non public');
    const list = LB.publications(db, c.id, ctx.query, { publicOnly: true });
    return { school: { name: c.name, logo: c.logo }, publications: list.map((p) => ({ ...p, cite: LB.cite(p) })),
      stats: { n: list.length, downloads: list.reduce((a, b) => a + b.downloads, 0), fields: [...new Set(list.map((p) => p.field).filter(Boolean))], years: [...new Set(list.map((p) => p.year))].sort((a, b) => b - a) },
      projects: LB.research(db, c.id).filter((x) => x.status === 'active').map((x) => ({ title: x.title, field: x.field, lab: x.lab, lead_name: x.lead_name, abstract: x.abstract })) };
  });
  r.post('/api/public/school/research/:code/view', (ctx) => { throttle(ctx, 'rv', 60); db.run("UPDATE school_publications SET views = views + 1 WHERE code = ? AND public = 1 AND status = 'published'", str(ctx.params.code, 20)); return { ok: true }; });
  r.get('/research/file/:code', (ctx) => {
    const p = db.get("SELECT file, title FROM school_publications WHERE code = ? AND public = 1 AND status = 'published'", str(ctx.params.code, 20));
    if (!p?.file) throw notFound('Fichier introuvable');
    db.run('UPDATE school_publications SET downloads = downloads + 1 WHERE code = ?', ctx.params.code);
    const buf = Buffer.from(p.file.split(',')[1], 'base64');
    ctx.send(buf, 'application/pdf', 200, { 'Content-Disposition': `inline; filename="${p.title.replace(/[^\w.-]+/g, '_').slice(0, 60)}.pdf"`, 'Cache-Control': 'public, max-age=3600' });
  });

  // Verification
  r.get('/api/public/school/verify/:code', (ctx) => {
    throttle(ctx, 'verify', 30);
    const code = str(ctx.params.code, 30).toUpperCase();
    const b = db.get(`SELECT b.*, s.last_name, s.first_name, s.matricule, c.name class_name, y.name year_name, co.name school FROM school_bulletins b JOIN school_students s ON s.id = b.student_id JOIN school_classes c ON c.id = b.class_id
      JOIN school_years y ON y.id = b.year_id JOIN companies co ON co.id = b.company_id WHERE b.code = ?`, code);
    if (b) {
      const s = settingsOf(db, b.company_id);
      const per = G.periods(s).find((p) => p.id === b.period);
      return { type: 'bulletin', valid: true, school: b.school, name: `${b.last_name} ${b.first_name}`, matricule: b.matricule, class_name: b.class_name, year: b.year_name, period: per?.fr || b.period, average: b.average, rank: b.rank, size: b.size, issued: b.created_at };
    }
    return { valid: false };
  });
  r.get('/api/public/school/verify-card/:code', (ctx) => {
    throttle(ctx, 'verify', 30);
    const st = db.get('SELECT s.*, co.name school FROM school_students s JOIN companies co ON co.id = s.company_id WHERE s.card_code = ?', str(ctx.params.code, 20).toUpperCase());
    if (!st) return { valid: false };
    const y = activeYear(db, st.company_id);
    const e = db.get("SELECT c.name FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id WHERE e.student_id = ? AND e.year_id = ? AND e.status = 'enrolled'", st.id, y?.id);
    return { type: 'card', valid: !!e && st.status === 'active', school: st.school, name: `${st.last_name} ${st.first_name}`, matricule: st.matricule, class_name: e?.name || '', year: y?.name, photo: st.photo };
  });
  r.get('/api/public/school/verify-cert/:code', (ctx) => {
    throttle(ctx, 'verify', 30);
    const c = LMS.certificate(db, ctx.params.code);
    if (!c) return { valid: false };
    return { type: 'certificate', valid: true, school: db.get('SELECT name FROM companies WHERE id = ?', c.company_id).name, name: `${c.first_name} ${c.last_name}`, course: c.course, completed_at: c.completed_at, teacher: c.teacher_name, code: c.certificate_code };
  });
  r.get('/v/cert/:code/print', (ctx) => {
    const c = LMS.certificate(db, ctx.params.code); if (!c) throw notFound('Certificat introuvable');
    ctx.send(PR.renderCourseCertificate(db.get('SELECT * FROM companies WHERE id = ?', c.company_id), c, baseUrl(ctx, env)));
  });
}

export { PROVIDERS };
