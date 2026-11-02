// Teknons École: schools and universities (nursery to doctorate, francophone and
// anglophone systems). Students and guardians, admissions, classes, teachers'
// files and workload, timetable, lesson log and homework, roll call from the
// phone and gate scanning, discipline, tests and exams with full records,
// report cards and transcripts with QR verification, LMD credits and GPA,
// official exam results, fees billed in Teknons Compta and paid by MTN MoMo /
// Orange Money from the parents' portal, library, research and publications,
// e-learning with quizzes and certificates, and early-warning insights.
import { requirePerm, requireUser } from '../../core/auth.js';
import { bad, notFound, forbidden } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate } from '../../core/validate.js';
import { audit } from '../../core/alerts.js';
import { now, today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { sendXlsx } from '../../core/xlsx.js';
import { normalizePhone, guessProvider } from '../../core/payments/mobile-money.js';
import { baseUrl } from '../accounting/paylink.js';
import { migrateSchool, seedCompanySchool, settingsOf, activeYear, addLevels, PRESETS } from './schema.js';
import * as ST from './students.js';
import * as G from './grades.js';
import * as A from './academics.js';
import * as LB from './library.js';
import * as LMS from './lms.js';
import * as IN from './insights.js';
import * as PR from './print.js';
import { registerPortal } from './portal.js';

export default {
  id: 'school',
  requires: ['accounting'],
  name: { fr: 'Teknons École', en: 'Teknons School' },
  brand: { name: 'Teknons École', short: 'École', description: 'Écoles, collèges, lycées et universités : élèves, notes et bulletins vérifiables, LMD, frais payés par MTN MoMo / Orange Money, portail parents, bibliothèque, recherche et cours en ligne.', navy: '#0F3B2C', accent: '#15803D' },
  migrate: migrateSchool,
  onCompanyCreated: seedCompanySchool,

  routes(r, { db, bus, momo, env }) {
    const cid = (ctx) => ctx.user.company_id;
    const company = (ctx) => db.get('SELECT * FROM companies WHERE id = ?', cid(ctx));
    const changed = (ctx, entity, id) => bus.emit(cid(ctx), 'change', { entity, id });
    const office = requirePerm('schooloffice', 'settings');
    const teach = requirePerm('teaching', 'schooloffice');
    const disc = requirePerm('discipline', 'teaching', 'schooloffice');
    const bursar = requirePerm('treasury', 'sales');
    const lib = requirePerm('library', 'schooloffice');
    const research = requirePerm('teaching', 'library', 'settings');
    const html = (ctx, body) => ctx.send(body);
    const isTeacherOnly = (ctx) => ctx.user.role === 'teacher';

    registerPortal(r, { db, bus, momo, env });

    // ---------------- Reference data ----------------
    r.get('/api/school/meta', requireUser, (ctx) => {
      const c = cid(ctx);
      seedCompanySchool(db, c);
      const s = settingsOf(db, c); const y = activeYear(db, c);
      return {
        settings: { ...s, }, year: y, years: A.yearsOf(db, c), levels: A.levelsOf(db, c), classes: A.listClasses(db, c),
        subjects: db.all('SELECT * FROM school_subjects WHERE company_id = ? ORDER BY grp, name', c), periods: G.periods(s),
        slots: [1, 2, 3, 4, 5, 6].slice(0, s.grading === 'lmd' ? 6 : s.sequences).map((q) => ({ seq: q, label: G.slotLabel(s, q) })),
        fee_items: ST.feeItems(db, c, y.id), presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
        teachers: db.all("SELECT id, name, role FROM users WHERE company_id = ? AND active = 1 AND role IN ('teacher','manager','owner','admin') ORDER BY name", c),
        my_courses: A.coursesOf(db, c, { teacher_id: ctx.user.id }), assess_kinds: G.ASSESS_KINDS, distinctions: G.DISTINCTIONS, discipline: ST.DISCIPLINE,
        pub_kinds: LB.PUB_KINDS, lesson_kinds: LMS.LESSON_KINDS, days: A.DAYS, public_url: baseUrl(ctx, env),
        momo: { mode: momo.mode, mtn_momo: momo.configured('mtn_momo'), orange_money: momo.configured('orange_money') },
      };
    });

    r.put('/api/school/settings', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const c = cid(ctx); const s = settingsOf(db, c);
      const t = (k) => { const v = str(b[k] ?? s[k], 5); if (!/^\d{2}:\d{2}$/.test(v)) throw bad('time', 'Heure invalide (HH:MM)'); return v; };
      const n = (k, min = 0, max = 1e9) => Math.max(min, Math.min(max, Number(b[k] === undefined || b[k] === '' ? s[k] : b[k]) || 0));
      const f = (k) => (b[k] === undefined ? s[k] : (b[k] ? 1 : 0));
      db.run(`UPDATE school_settings SET kind = ?, system = ?, grading = ?, sequences = ?, pass_mark = ?, honour_mark = ?, encourage_mark = ?, congrats_mark = ?, warning_mark = ?, cc_weight = ?, day_start = ?, late_after = ?, absence_alert_hours = ?,
        admissions_open = ?, portal_pay = ?, repository_public = ?, principal_name = ?, principal_title = ?, motto = ?, ministry = ?, matricule_prefix = ?, welcome_text = ?, loan_days = ?, max_loans = ?, fine_per_day = ? WHERE company_id = ?`,
      oneOf(b.kind ?? s.kind, ['nursery', 'primary', 'secondary', 'both', 'university', 'training'], 'kind'), oneOf(b.system ?? s.system, ['fr', 'en', 'bilingual'], 'system'), oneOf(b.grading ?? s.grading, ['sequences', 'lmd'], 'grading'),
      oneOf(Number(b.sequences ?? s.sequences), [3, 6], 'sequences'), n('pass_mark', 0, 20), n('honour_mark', 0, 20), n('encourage_mark', 0, 20), n('congrats_mark', 0, 20), n('warning_mark', 0, 20), n('cc_weight', 0, 1),
      t('day_start'), t('late_after'), Math.round(n('absence_alert_hours', 1, 500)), f('admissions_open'), f('portal_pay'), f('repository_public'), str(b.principal_name ?? s.principal_name, 120), str(b.principal_title ?? s.principal_title, 60),
      str(b.motto ?? s.motto, 160), oneOf(b.ministry ?? s.ministry, ['MINEDUB', 'MINESEC', 'MINESUP', 'MINEFOP', 'Privé'], 'ministry'), str(b.matricule_prefix ?? s.matricule_prefix, 6).toUpperCase(), str(b.welcome_text ?? s.welcome_text, 1500),
      Math.round(n('loan_days', 1, 120)), Math.round(n('max_loans', 1, 50)), Math.round(n('fine_per_day', 0, 100000)), c);
      if (b.active_year_id && db.get('SELECT 1 FROM school_years WHERE id = ? AND company_id = ?', b.active_year_id, c)) db.run('UPDATE school_settings SET active_year_id = ? WHERE company_id = ?', b.active_year_id, c);
      audit(db, ctx, 'update', 'school_settings', c);
      changed(ctx, 'school_settings');
      return settingsOf(db, c);
    });
    r.post('/api/school/levels/preset', requirePerm('settings'), (ctx) => ({ added: addLevels(db, cid(ctx), oneOf(ctx.body.preset, Object.keys(PRESETS), 'preset')) }));
    r.post('/api/school/levels', requirePerm('settings'), (ctx) => {
      const name = str(ctx.body.name, 40); if (!name) throw bad('name', 'Nom du niveau obligatoire');
      const id = Number(db.run('INSERT INTO school_levels (company_id, name, cycle, section, exam, position) VALUES (?,?,?,?,?,?)', cid(ctx), name, str(ctx.body.cycle, 40), oneOf(ctx.body.section, ['fr', 'en'], 'section', 'fr'), str(ctx.body.exam, 40), int(ctx.body.position, 'position', { def: 99 })).lastInsertRowid);
      return ctx.json(db.get('SELECT * FROM school_levels WHERE id = ?', id), 201);
    });
    r.put('/api/school/levels/:id', requirePerm('settings'), (ctx) => {
      const l = db.get('SELECT * FROM school_levels WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!l) throw notFound();
      const b = ctx.body;
      db.run('UPDATE school_levels SET name = ?, cycle = ?, section = ?, exam = ?, position = ?, next_level_id = ?, active = ? WHERE id = ?', str(b.name ?? l.name, 40), str(b.cycle ?? l.cycle, 40), oneOf(b.section ?? l.section, ['fr', 'en'], 'section'), str(b.exam ?? l.exam, 40),
        int(b.position ?? l.position, 'position', { def: 0 }), b.next_level_id === undefined ? l.next_level_id : (Number(b.next_level_id) || null), b.active === undefined ? l.active : (b.active ? 1 : 0), l.id);
      return db.get('SELECT * FROM school_levels WHERE id = ?', l.id);
    });
    r.post('/api/school/years', requirePerm('settings'), (ctx) => ctx.json(A.newYear(db, ctx, ctx.body), 201));
    r.put('/api/school/years/:id', requirePerm('settings'), (ctx) => {
      const y = db.get('SELECT * FROM school_years WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!y) throw notFound();
      const sd = Array.isArray(ctx.body.seq_dates) ? ctx.body.seq_dates.map((x) => ({ seq: Number(x.seq), from: vDate(x.from, 'from'), to: vDate(x.to, 'to') })) : JSON.parse(y.seq_dates || '[]');
      db.run('UPDATE school_years SET start_date = ?, end_date = ?, seq_dates = ? WHERE id = ?', vDate(ctx.body.start_date ?? y.start_date), vDate(ctx.body.end_date ?? y.end_date), JSON.stringify(sd), y.id);
      return db.get('SELECT * FROM school_years WHERE id = ?', y.id);
    });

    // ---------------- Classes, subjects, courses ----------------
    r.get('/api/school/classes', requireUser, (ctx) => A.listClasses(db, cid(ctx), ctx.query.year_id));
    r.get('/api/school/classes/:id', requireUser, (ctx) => A.classDetail(db, cid(ctx), Number(ctx.params.id)));
    r.post('/api/school/classes', requirePerm('settings', 'schooloffice'), (ctx) => { const x = A.saveClass(db, ctx, ctx.body); changed(ctx, 'school_class', x.id); return ctx.json(x, 201); });
    r.put('/api/school/classes/:id', requirePerm('settings', 'schooloffice'), (ctx) => { const x = A.saveClass(db, ctx, ctx.body, Number(ctx.params.id)); changed(ctx, 'school_class', x.id); return x; });
    r.post('/api/school/subjects', requirePerm('settings', 'schooloffice'), (ctx) => ctx.json(A.saveSubject(db, ctx, ctx.body), 201));
    r.put('/api/school/subjects/:id', requirePerm('settings', 'schooloffice'), (ctx) => A.saveSubject(db, ctx, ctx.body, Number(ctx.params.id)));
    r.get('/api/school/courses', requireUser, (ctx) => A.coursesOf(db, cid(ctx), isTeacherOnly(ctx) && !ctx.query.class_id ? { teacher_id: ctx.user.id } : ctx.query));
    r.post('/api/school/courses', requirePerm('settings', 'schooloffice'), (ctx) => ctx.json(A.saveCourse(db, ctx, ctx.body), 201));
    r.put('/api/school/courses/:id', requirePerm('settings', 'schooloffice'), (ctx) => A.saveCourse(db, ctx, ctx.body, Number(ctx.params.id)));
    r.del('/api/school/courses/:id', requirePerm('settings', 'schooloffice'), (ctx) => A.deleteCourse(db, ctx, Number(ctx.params.id)));

    // ---------------- Staff ----------------
    r.get('/api/school/staff', requireUser, (ctx) => A.staffList(db, cid(ctx)).map((u) => (can(ctx.user, 'users') ? u : { ...u, hourly_rate: undefined, last_login: undefined })));
    r.put('/api/school/staff/:id', requirePerm('users'), (ctx) => A.saveStaff(db, ctx, Number(ctx.params.id), ctx.body));
    r.get('/api/school/workload', requirePerm('reports', 'users'), (ctx) => {
      const month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : today().slice(0, 7);
      const rows = A.workload(db, cid(ctx), month);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `heures-enseignants-${month}.xlsx`, [{ name: 'Heures', columns: [{ header: 'Enseignant', key: 'name' }, { header: 'Statut', key: 'status' }, { header: 'Leçons', key: 'lessons' }, { header: 'Heures', key: 'hours' }, { header: 'Taux horaire', key: 'hourly_rate', type: 'money' }, { header: 'À payer', key: 'pay', type: 'money' }], rows }]);
      return { month, rows };
    });
    r.get('/api/school/my-day', requireUser, (ctx) => IN.teacherDay(db, cid(ctx), ctx.user.id));

    // ---------------- Students ----------------
    r.get('/api/school/students', requireUser, (ctx) => {
      const rows = ST.listStudents(db, cid(ctx), { ...ctx.query, balances: can(ctx.user, 'treasury') || can(ctx.user, 'sales') || can(ctx.user, 'schooloffice') });
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, 'eleves.xlsx', [{ name: 'Élèves', columns: [{ header: 'Matricule', key: 'matricule' }, { header: 'Nom', key: 'last_name' }, { header: 'Prénom', key: 'first_name' }, { header: 'Sexe', key: 'sex' }, { header: 'Né(e) le', key: 'birth_date' }, { header: 'Classe', key: 'class_name' }, { header: 'Parent', key: 'guardian_name' }, { header: 'Téléphone', key: 'guardian_phone' }, { header: 'Reste à payer', key: 'due', type: 'money' }], rows }]);
      return rows;
    });
    r.get('/api/school/students/:id', requireUser, (ctx) => {
      const s = ST.getStudent(db, cid(ctx), Number(ctx.params.id));
      const y = activeYear(db, cid(ctx));
      const money = can(ctx.user, 'treasury') || can(ctx.user, 'sales') || can(ctx.user, 'schooloffice');
      return { ...s, portal_url: can(ctx.user, 'schooloffice') || money ? `${baseUrl(ctx, env)}/p/${s.portal_token}` : undefined, portal_token: undefined,
        fees: money ? ST.studentFees(db, cid(ctx), s.id) : null, marks: G.studentMarks(db, cid(ctx), s.id), attendance: ST.attendanceOf(db, cid(ctx), { student_id: s.id }).slice(0, 80),
        absences: ST.absenceTotals(db, s.id, y.start_date, y.end_date), discipline: db.all('SELECT d.*, u.name by_name FROM school_discipline d LEFT JOIN users u ON u.id = d.recorded_by WHERE d.student_id = ? ORDER BY d.date DESC', s.id),
        exams: db.all('SELECT * FROM school_exam_results WHERE student_id = ? ORDER BY session DESC', s.id), loans: LB.loans(db, cid(ctx), { student_id: s.id }).slice(0, 20),
        courses: LMS.myCourses(db, cid(ctx), s.id), gate: db.all('SELECT * FROM school_gate WHERE student_id = ? ORDER BY id DESC LIMIT 20', s.id),
        risk: IN.atRisk(db, cid(ctx), { class_id: s.class_id }).find((x) => x.id === s.id) || null };
    });
    r.post('/api/school/students', requirePerm('schooloffice', 'settings'), (ctx) => ctx.json(ST.createStudent(db, bus, ctx, company(ctx), ctx.body), 201));
    r.put('/api/school/students/:id', requirePerm('schooloffice', 'settings'), (ctx) => ST.updateStudent(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.post('/api/school/students/:id/enroll', requirePerm('schooloffice', 'settings'), (ctx) => { const c = db.tx(() => ST.enroll(db, ctx, company(ctx), Number(ctx.params.id), ctx.body)); changed(ctx, 'school_student', Number(ctx.params.id)); return { ok: true, class: c }; });
    r.post('/api/school/students/:id/portal-link', requirePerm('schooloffice', 'settings'), (ctx) => {
      const st = db.get('SELECT * FROM school_students WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!st) throw notFound();
      if (ctx.body.renew) { const t = (globalThis.crypto?.randomUUID?.() || String(Math.random())).replace(/-/g, '').slice(0, 24); db.run('UPDATE school_students SET portal_token = ? WHERE id = ?', t, st.id); audit(db, ctx, 'renew_link', 'school_student', st.id); }
      return { url: `${baseUrl(ctx, env)}/p/${db.get('SELECT portal_token FROM school_students WHERE id = ?', st.id).portal_token}` };
    });
    r.get('/api/school/students/:id/transcript', requireUser, (ctx) => html(ctx, PR.renderTranscript(company(ctx), settingsOf(db, cid(ctx)), G.transcript(db, cid(ctx), Number(ctx.params.id)), { autoPrint: ctx.query.print === '1' })));
    r.get('/api/school/students/:id/certificate', requirePerm('schooloffice', 'settings'), (ctx) => {
      const s = ST.getStudent(db, cid(ctx), Number(ctx.params.id)); if (!s.class_id) throw bad('enrolled', "L'élève n'est pas inscrit cette année");
      html(ctx, PR.renderCertificate(company(ctx), settingsOf(db, cid(ctx)), activeYear(db, cid(ctx)), { ...s, card_code: db.get('SELECT card_code FROM school_students WHERE id = ?', s.id).card_code }, baseUrl(ctx, env), { autoPrint: ctx.query.print === '1' }));
    });
    r.get('/api/school/cards', requirePerm('schooloffice', 'settings'), (ctx) => {
      const y = activeYear(db, cid(ctx));
      const ids = ctx.query.student_id ? [Number(ctx.query.student_id)] : null;
      const list = db.all(`SELECT s.*, c.name class_name, p.phone guardian_phone FROM school_students s JOIN school_enrollments e ON e.student_id = s.id AND e.year_id = ? AND e.status = 'enrolled' JOIN school_classes c ON c.id = e.class_id LEFT JOIN partners p ON p.id = s.guardian_id
        WHERE s.company_id = ? ${ctx.query.class_id ? 'AND c.id = ' + Number(ctx.query.class_id) : ''} ORDER BY c.name, s.last_name`, y.id, cid(ctx)).filter((s) => !ids || ids.includes(s.id));
      html(ctx, PR.renderCards(company(ctx), settingsOf(db, cid(ctx)), y, list, baseUrl(ctx, env), { autoPrint: ctx.query.print === '1' }));
    });
    r.post('/api/school/students/:id/exams', requirePerm('schooloffice', 'settings'), (ctx) => {
      const st = db.get('SELECT id FROM school_students WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!st) throw notFound();
      const b = ctx.body; const exam = str(b.exam, 60); if (!exam) throw bad('exam', "Nom de l'examen obligatoire");
      const id = Number(db.run('INSERT INTO school_exam_results (company_id, student_id, exam, session, series, center, candidate_no, result, mention, score, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', cid(ctx), st.id, exam, str(b.session, 20) || today().slice(0, 4),
        str(b.series, 20), str(b.center, 80), str(b.candidate_no, 30), oneOf(b.result, ['registered', 'passed', 'failed', 'absent'], 'result', 'registered'), str(b.mention, 40), str(b.score, 20), str(b.notes, 500), now()).lastInsertRowid);
      return ctx.json(db.get('SELECT * FROM school_exam_results WHERE id = ?', id), 201);
    });
    r.put('/api/school/exams/:id', requirePerm('schooloffice', 'settings'), (ctx) => {
      const e = db.get('SELECT * FROM school_exam_results WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!e) throw notFound(); const b = ctx.body;
      db.run('UPDATE school_exam_results SET result = ?, mention = ?, score = ?, center = ?, candidate_no = ?, notes = ? WHERE id = ?', oneOf(b.result ?? e.result, ['registered', 'passed', 'failed', 'absent'], 'result'), str(b.mention ?? e.mention, 40), str(b.score ?? e.score, 20), str(b.center ?? e.center, 80), str(b.candidate_no ?? e.candidate_no, 30), str(b.notes ?? e.notes, 500), e.id);
      return db.get('SELECT * FROM school_exam_results WHERE id = ?', e.id);
    });
    r.get('/api/school/exams', requireUser, (ctx) => db.all(`SELECT x.*, s.last_name, s.first_name, s.matricule FROM school_exam_results x JOIN school_students s ON s.id = x.student_id WHERE x.company_id = ? ${ctx.query.session ? 'AND x.session = ?' : ''} ORDER BY x.session DESC, x.exam, s.last_name`, cid(ctx), ...(ctx.query.session ? [ctx.query.session] : [])));

    // ---------------- Admissions ----------------
    r.get('/api/school/applications', requirePerm('schooloffice', 'settings'), (ctx) => db.all('SELECT a.*, l.name level_name FROM school_applications a LEFT JOIN school_levels l ON l.id = a.level_id WHERE a.company_id = ? ORDER BY a.status = \'new\' DESC, a.id DESC LIMIT 300', cid(ctx)));
    r.put('/api/school/applications/:id', requirePerm('schooloffice', 'settings'), (ctx) => {
      const a = db.get('SELECT * FROM school_applications WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!a) throw notFound();
      db.run('UPDATE school_applications SET status = ?, interview_at = ?, notes = ? WHERE id = ?', oneOf(ctx.body.status ?? a.status, ['new', 'interview', 'rejected'], 'status'), str(ctx.body.interview_at ?? a.interview_at, 16), str(ctx.body.notes ?? a.notes, 1000), a.id);
      changed(ctx, 'school_application', a.id);
      return db.get('SELECT * FROM school_applications WHERE id = ?', a.id);
    });
    r.post('/api/school/applications/:id/accept', requirePerm('schooloffice', 'settings'), (ctx) => ST.acceptApplication(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));

    // ---------------- Fees ----------------
    r.get('/api/school/fees/items', requireUser, (ctx) => ST.feeItems(db, cid(ctx), ctx.query.year_id || activeYear(db, cid(ctx)).id));
    const feeVals = (b, cur = {}) => {
      const name = str(b.name ?? cur.name, 80); if (!name) throw bad('name', 'Nom du frais obligatoire');
      return [Number(b.level_id ?? cur.level_id) || null, name, oneOf(b.kind ?? cur.kind, ['registration', 'tuition', 'other', 'optional'], 'kind', 'tuition'), int(b.amount ?? cur.amount, 'amount', { min: 0 }), vDate(b.due_date ?? cur.due_date, 'due_date'),
        oneOf(String(b.account_code ?? cur.account_code ?? '7061'), ['7061', '7062', '7068', '706'], 'account_code'), int(b.position ?? cur.position, 'position', { def: 0 })];
    };
    r.post('/api/school/fees/items', requirePerm('settings'), (ctx) => {
      const id = Number(db.run('INSERT INTO school_fee_items (company_id, year_id, level_id, name, kind, amount, due_date, account_code, position) VALUES (?,?,?,?,?,?,?,?,?)', cid(ctx), activeYear(db, cid(ctx)).id, ...feeVals(ctx.body)).lastInsertRowid);
      audit(db, ctx, 'create', 'school_fee_item', id); return ctx.json(db.get('SELECT * FROM school_fee_items WHERE id = ?', id), 201);
    });
    r.put('/api/school/fees/items/:id', requirePerm('settings'), (ctx) => {
      const f = db.get('SELECT * FROM school_fee_items WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!f) throw notFound();
      db.run('UPDATE school_fee_items SET level_id = ?, name = ?, kind = ?, amount = ?, due_date = ?, account_code = ?, position = ?, active = ? WHERE id = ?', ...feeVals(ctx.body, f), ctx.body.active === undefined ? f.active : (ctx.body.active ? 1 : 0), f.id);
      audit(db, ctx, 'update', 'school_fee_item', f.id); return db.get('SELECT * FROM school_fee_items WHERE id = ?', f.id);
    });
    /** Bills every enrolled student for any instalment they don't have yet (after adding a fee). */
    r.post('/api/school/fees/bill-all', requirePerm('settings', 'accounting'), (ctx) => {
      const y = activeYear(db, cid(ctx)); let n = 0;
      db.tx(() => { for (const e of db.all("SELECT student_id FROM school_enrollments WHERE company_id = ? AND year_id = ? AND status = 'enrolled'", cid(ctx), y.id)) n += ST.billStudent(db, ctx, company(ctx), e.student_id, y.id); });
      changed(ctx, 'school_fee'); return { invoices: n };
    });
    r.get('/api/school/fees/student/:id', bursar, (ctx) => ({ student: ST.getStudent(db, cid(ctx), Number(ctx.params.id)), ...ST.studentFees(db, cid(ctx), Number(ctx.params.id)) }));
    r.post('/api/school/fees/collect', bursar, (ctx) => ctx.json(ST.collect(db, bus, ctx, company(ctx), ctx.body), 201));
    r.post('/api/school/fees/momo', bursar, async (ctx) => {
      const phone = normalizePhone(ctx.body.phone);
      return ctx.json(await ST.momoForStudent(db, momo, company(ctx), Number(ctx.body.student_id), { provider: ctx.body.provider || guessProvider(phone), phone, amount: ctx.body.amount, document_id: ctx.body.document_id, userId: ctx.user.id }), 201);
    });
    r.get('/api/school/receipts', bursar, (ctx) => db.all(`SELECT r.*, s.last_name, s.first_name, s.matricule, u.name by_name FROM school_receipts r JOIN school_students s ON s.id = r.student_id LEFT JOIN users u ON u.id = r.created_by WHERE r.company_id = ? ${ctx.query.date ? 'AND substr(r.created_at,1,10) = ?' : ''} ORDER BY r.id DESC LIMIT 300`, cid(ctx), ...(ctx.query.date ? [ctx.query.date] : [])));
    r.get('/api/school/receipts/:id', bursar, (ctx) => {
      const rc = db.get('SELECT * FROM school_receipts WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!rc) throw notFound();
      html(ctx, PR.renderReceipt(company(ctx), settingsOf(db, cid(ctx)), rc, ST.getStudent(db, cid(ctx), rc.student_id), ST.studentFees(db, cid(ctx), rc.student_id), { autoPrint: ctx.query.print === '1' }));
    });
    r.get('/api/school/fees/status', requirePerm('reports', 'treasury', 'sales'), (ctx) => {
      const y = activeYear(db, cid(ctx));
      const by = ST.feeStatusByClass(db, cid(ctx), y.id);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `frais-par-classe-${y.name}.xlsx`, [{ name: 'Par classe', columns: [{ header: 'Classe', key: 'name' }, { header: 'Élèves', key: 'students' }, { header: 'Facturé', key: 'billed', type: 'money' }, { header: 'Encaissé', key: 'paid', type: 'money' }, { header: 'Reste', key: 'due', type: 'money' }, { header: 'En retard', key: 'overdue', type: 'money' }, { header: 'Taux %', key: 'rate' }], rows: by }]);
      const items = db.all(`SELECT i.id, i.name, i.due_date, i.kind, COUNT(f.id) n, COALESCE(SUM(d.total),0) billed, COALESCE(SUM(d.paid + d.credited),0) paid FROM school_fee_items i LEFT JOIN school_student_fees f ON f.fee_item_id = i.id LEFT JOIN documents d ON d.id = f.document_id
        WHERE i.company_id = ? AND i.year_id = ? GROUP BY i.id ORDER BY i.due_date, i.position`, cid(ctx), y.id);
      return { classes: by, items };
    });
    r.get('/api/school/fees/debtors', requirePerm('reports', 'treasury', 'sales'), (ctx) => {
      const y = activeYear(db, cid(ctx));
      const rows = ST.debtors(db, cid(ctx), y.id, { overdueOnly: ctx.query.all !== '1', class_id: ctx.query.class_id }).map((d) => ({ ...d, portal_url: `${baseUrl(ctx, env)}/p/${d.portal_token}`, portal_token: undefined }));
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `impayes-${today()}.xlsx`, [{ name: 'Impayés', columns: [{ header: 'Matricule', key: 'matricule' }, { header: 'Nom', key: 'last_name' }, { header: 'Prénom', key: 'first_name' }, { header: 'Classe', key: 'class_name' }, { header: 'Parent', key: 'guardian_name' }, { header: 'Téléphone', key: 'guardian_phone' }, { header: 'Reste à payer', key: 'due', type: 'money' }, { header: 'En retard', key: 'overdue', type: 'money' }, { header: 'Plus ancienne échéance', key: 'oldest' }], rows }]);
      return rows;
    });

    // ---------------- Marks, tests and results ----------------
    r.get('/api/school/marks', teach, (ctx) => G.markSheet(db, ctx, Number(ctx.query.course_id), Number(ctx.query.sequence)));
    r.post('/api/school/marks', requirePerm('teaching'), (ctx) => G.saveMarks(db, bus, ctx, ctx.body));
    r.get('/api/school/assessments', requireUser, (ctx) => db.all(`SELECT a.*, sub.name subject, cl.name class_name, u.name teacher_name, (SELECT ROUND(AVG(score * 20.0 / a.max), 2) FROM school_scores x WHERE x.assessment_id = a.id AND x.score IS NOT NULL) avg20,
        (SELECT COUNT(*) FROM school_scores x WHERE x.assessment_id = a.id AND (x.score IS NOT NULL OR x.absent = 1)) filled
      FROM school_assessments a JOIN school_courses co ON co.id = a.course_id JOIN school_subjects sub ON sub.id = co.subject_id JOIN school_classes cl ON cl.id = co.class_id LEFT JOIN users u ON u.id = co.teacher_id
      WHERE a.company_id = ? AND cl.year_id = ? ${ctx.query.course_id ? 'AND a.course_id = ' + Number(ctx.query.course_id) : ''} ${ctx.query.class_id ? 'AND co.class_id = ' + Number(ctx.query.class_id) : ''} ${ctx.query.kind ? 'AND a.kind = ?' : ''} ${isTeacherOnly(ctx) ? 'AND co.teacher_id = ' + Number(ctx.user.id) : ''}
      ORDER BY a.date DESC, a.id DESC LIMIT 500`, cid(ctx), activeYear(db, cid(ctx)).id, ...(ctx.query.kind ? [ctx.query.kind] : [])));
    r.get('/api/school/assessments/:id', teach, (ctx) => G.assessment(db, ctx, Number(ctx.params.id)));
    r.post('/api/school/assessments', requirePerm('teaching'), (ctx) => ctx.json(G.saveAssessment(db, bus, ctx, ctx.body), 201));
    r.put('/api/school/assessments/:id', requirePerm('teaching'), (ctx) => G.saveAssessment(db, bus, ctx, ctx.body, Number(ctx.params.id)));
    r.post('/api/school/assessments/:id/scores', requirePerm('teaching'), (ctx) => G.saveScores(db, bus, ctx, Number(ctx.params.id), ctx.body.scores || []));
    r.del('/api/school/assessments/:id', requirePerm('teaching'), (ctx) => G.deleteAssessment(db, ctx, Number(ctx.params.id)));
    r.get('/api/school/results', requirePerm('teaching', 'schooloffice', 'reports'), (ctx) => {
      const data = G.classResults(db, cid(ctx), Number(ctx.query.class_id), ctx.query.period || 'year');
      if (ctx.query.format === 'xlsx') {
        const cols = [{ header: 'Rang', key: 'rank' }, { header: 'Matricule', key: 'matricule' }, { header: 'Nom', key: 'name' }, ...data.courses.map((c) => ({ header: `${c.subject} (${c.coef})`, key: 'c' + c.id })), { header: 'Moyenne', key: 'average' }, ...(data.grading === 'lmd' ? [{ header: 'Crédits', key: 'credits' }, { header: 'GPA', key: 'gpa' }] : [])];
        return sendXlsx(ctx, `resultats-${data.class.name}-${data.period.id}.xlsx`, [{ name: 'Résultats', columns: cols, rows: data.students.map((s) => ({ ...s, ...Object.fromEntries(data.courses.map((c) => ['c' + c.id, s.courses[c.id].avg])) })) }]);
      }
      return data;
    });
    r.post('/api/school/council', requirePerm('schooloffice', 'settings'), (ctx) => {
      if (!G.MANAGERS.includes(ctx.user.role) && !can(ctx.user, 'schooloffice')) throw forbidden();
      return G.saveCouncil(db, bus, ctx, ctx.body);
    });
    r.post('/api/school/unlock', requirePerm('settings'), (ctx) => G.unlock(db, ctx, Number(ctx.body.class_id), Number(ctx.body.sequence)));
    r.get('/api/school/bulletins', requirePerm('teaching', 'schooloffice', 'reports'), (ctx) => html(ctx, PR.renderBulletins(company(ctx), settingsOf(db, cid(ctx)), G.bulletins(db, cid(ctx), Number(ctx.query.class_id), ctx.query.period || 'year', ctx.query.student_id), baseUrl(ctx, env), { autoPrint: ctx.query.print === '1', lang: ctx.query.lang === 'en' ? 'en' : 'fr' })));

    // ---------------- Attendance, gate, discipline ----------------
    r.get('/api/school/roll', requirePerm('teaching', 'discipline', 'schooloffice'), (ctx) => {
      const c = A.classDetail(db, cid(ctx), Number(ctx.query.class_id)); const date = ctx.query.date || today();
      const slot = ctx.query.course_id ? `c${Number(ctx.query.course_id)}` : 'day';
      const marked = ST.attendanceOf(db, cid(ctx), { class_id: c.id, date }).filter((a) => (Number(ctx.query.course_id) || null) === (a.course_id || null) || a.source === 'gate');
      return { class: { id: c.id, name: c.name }, date, students: c.students, done: db.get('SELECT * FROM school_rolls WHERE class_id = ? AND date = ? AND slot = ?', c.id, date, slot) || null, marked,
        arrivals: Object.fromEntries(db.all("SELECT student_id, MIN(at) at FROM school_gate WHERE date = ? AND direction = 'in' GROUP BY student_id", date).map((g) => [g.student_id, g.at])) };
    });
    r.post('/api/school/attendance', requirePerm('teaching', 'discipline', 'schooloffice'), (ctx) => ST.rollCall(db, bus, ctx, company(ctx), ctx.body));
    r.get('/api/school/attendance', requireUser, (ctx) => ST.attendanceOf(db, cid(ctx), ctx.query));
    r.put('/api/school/attendance/:id', disc, (ctx) => {
      const a = db.get('SELECT * FROM school_attendance WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!a) throw notFound();
      db.run('UPDATE school_attendance SET justified = ?, reason = ? WHERE id = ?', ctx.body.justified ? 1 : 0, str(ctx.body.reason ?? a.reason, 300), a.id);
      changed(ctx, 'school_attendance', a.id); return db.get('SELECT * FROM school_attendance WHERE id = ?', a.id);
    });
    r.get('/api/school/attendance-report', requirePerm('reports', 'discipline', 'schooloffice'), (ctx) => {
      const from = ctx.query.from || activeYear(db, cid(ctx)).start_date, to = ctx.query.to || today();
      const rows = db.all(`SELECT s.id, s.matricule, s.last_name, s.first_name, c.name class_name, SUM(CASE WHEN a.kind='absent' THEN a.hours ELSE 0 END) hours, SUM(CASE WHEN a.kind='absent' AND a.justified=1 THEN a.hours ELSE 0 END) justified,
          SUM(CASE WHEN a.kind='late' THEN 1 ELSE 0 END) lates FROM school_attendance a JOIN school_students s ON s.id = a.student_id JOIN school_classes c ON c.id = a.class_id
        WHERE a.company_id = ? AND a.date BETWEEN ? AND ? ${ctx.query.class_id ? 'AND a.class_id = ' + Number(ctx.query.class_id) : ''} GROUP BY s.id ORDER BY hours - justified DESC`, cid(ctx), from, to);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `absences-${from}-${to}.xlsx`, [{ name: 'Absences', columns: [{ header: 'Matricule', key: 'matricule' }, { header: 'Nom', key: 'last_name' }, { header: 'Prénom', key: 'first_name' }, { header: 'Classe', key: 'class_name' }, { header: 'Heures', key: 'hours' }, { header: 'Justifiées', key: 'justified' }, { header: 'Retards', key: 'lates' }], rows }]);
      return { from, to, rows };
    });
    r.post('/api/school/gate', requirePerm('discipline', 'schooloffice'), (ctx) => ctx.json(ST.gateScan(db, bus, ctx, company(ctx), ctx.body), 201));
    r.get('/api/school/gate', requirePerm('discipline', 'schooloffice', 'reports'), (ctx) => ST.gateToday(db, cid(ctx)));
    r.get('/api/school/discipline', requireUser, (ctx) => db.all(`SELECT d.*, s.last_name, s.first_name, s.matricule, c.name class_name, u.name by_name FROM school_discipline d JOIN school_students s ON s.id = d.student_id
      LEFT JOIN school_enrollments e ON e.student_id = s.id AND e.year_id = ? AND e.status = 'enrolled' LEFT JOIN school_classes c ON c.id = e.class_id LEFT JOIN users u ON u.id = d.recorded_by
      WHERE d.company_id = ? ${ctx.query.class_id ? 'AND c.id = ' + Number(ctx.query.class_id) : ''} ${ctx.query.kind ? 'AND d.kind = ?' : ''} ORDER BY d.date DESC, d.id DESC LIMIT 500`, activeYear(db, cid(ctx)).id, cid(ctx), ...(ctx.query.kind ? [ctx.query.kind] : [])));
    r.post('/api/school/discipline', disc, (ctx) => ctx.json(ST.addDiscipline(db, bus, ctx, company(ctx), ctx.body), 201));
    r.del('/api/school/discipline/:id', requirePerm('discipline', 'settings'), (ctx) => { db.run('DELETE FROM school_discipline WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); audit(db, ctx, 'delete', 'school_discipline', Number(ctx.params.id)); return { ok: true }; });

    // ---------------- Timetable, lesson log, announcements ----------------
    r.get('/api/school/timetable', requireUser, (ctx) => {
      const q = isTeacherOnly(ctx) && !ctx.query.class_id ? { teacher_id: ctx.user.id } : ctx.query;
      const slots = A.timetable(db, cid(ctx), q);
      if (ctx.query.format === 'html') {
        const title = q.class_id ? db.get('SELECT name FROM school_classes WHERE id = ?', q.class_id)?.name : q.teacher_id ? db.get('SELECT name FROM users WHERE id = ?', q.teacher_id)?.name : q.room ? `Salle ${q.room}` : 'Établissement';
        return html(ctx, PR.renderTimetable(company(ctx), settingsOf(db, cid(ctx)), title || '', slots, { autoPrint: ctx.query.print === '1' }));
      }
      return slots;
    });
    r.post('/api/school/timetable', requirePerm('settings', 'schooloffice'), (ctx) => { const x = A.saveSlot(db, ctx, ctx.body); changed(ctx, 'school_timetable'); return ctx.json(x, 201); });
    r.put('/api/school/timetable/:id', requirePerm('settings', 'schooloffice'), (ctx) => { const x = A.saveSlot(db, ctx, ctx.body, Number(ctx.params.id)); changed(ctx, 'school_timetable'); return x; });
    r.del('/api/school/timetable/:id', requirePerm('settings', 'schooloffice'), (ctx) => { db.run('DELETE FROM school_timetable WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); changed(ctx, 'school_timetable'); return { ok: true }; });
    r.get('/api/school/lessons', requireUser, (ctx) => A.lessons(db, cid(ctx), isTeacherOnly(ctx) && !ctx.query.class_id ? { ...ctx.query, teacher_id: ctx.user.id } : ctx.query));
    r.post('/api/school/lessons', requirePerm('teaching'), (ctx) => ctx.json(A.saveLesson(db, bus, ctx, ctx.body), 201));
    r.put('/api/school/lessons/:id', requirePerm('teaching'), (ctx) => A.saveLesson(db, bus, ctx, ctx.body, Number(ctx.params.id)));
    r.get('/api/school/announcements', requireUser, (ctx) => A.announcements(db, cid(ctx), ctx.query.class_id));
    r.post('/api/school/announcements', requirePerm('schooloffice', 'settings', 'teaching'), (ctx) => {
      const b = ctx.body; const title = str(b.title, 160), body = str(b.body, 4000);
      if (!title || !body) throw bad('required', 'Titre et message obligatoires');
      if (ctx.user.role === 'teacher' && !b.class_id) throw forbidden('Un enseignant publie pour une classe');
      const id = Number(db.run('INSERT INTO school_announcements (company_id, class_id, title, body, pinned, created_by, created_at) VALUES (?,?,?,?,?,?,?)', cid(ctx), Number(b.class_id) || null, title, body, b.pinned ? 1 : 0, ctx.user.id, now()).lastInsertRowid);
      changed(ctx, 'school_announcement', id);
      return ctx.json(db.get('SELECT * FROM school_announcements WHERE id = ?', id), 201);
    });
    r.del('/api/school/announcements/:id', requirePerm('schooloffice', 'settings'), (ctx) => { db.run('DELETE FROM school_announcements WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); return { ok: true }; });
    r.post('/api/school/promote', requirePerm('settings', 'schooloffice'), (ctx) => A.promote(db, bus, ctx, company(ctx), ctx.body));

    // ---------------- Library ----------------
    r.get('/api/school/books', requireUser, (ctx) => LB.books(db, cid(ctx), ctx.query));
    r.post('/api/school/books', lib, (ctx) => ctx.json(LB.saveBook(db, ctx, ctx.body), 201));
    r.put('/api/school/books/:id', lib, (ctx) => LB.saveBook(db, ctx, ctx.body, Number(ctx.params.id)));
    r.get('/api/school/loans', requireUser, (ctx) => LB.loans(db, cid(ctx), ctx.query));
    r.post('/api/school/loans', lib, (ctx) => ctx.json(LB.borrow(db, bus, ctx, ctx.body), 201));
    r.post('/api/school/loans/:id/return', lib, (ctx) => LB.giveBack(db, bus, ctx, Number(ctx.params.id), ctx.body));
    r.post('/api/school/loans/:id/renew', lib, (ctx) => LB.renew(db, ctx, Number(ctx.params.id)));
    r.get('/api/school/holds', lib, (ctx) => db.all("SELECT h.*, b.title, s.last_name, s.first_name FROM school_holds h JOIN school_books b ON b.id = h.book_id JOIN school_students s ON s.id = h.student_id WHERE h.company_id = ? AND h.status IN ('waiting','ready') ORDER BY h.status = 'ready' DESC, h.id", cid(ctx)));
    r.get('/api/school/library', requireUser, (ctx) => LB.libraryStats(db, cid(ctx)));

    // ---------------- Research and publications ----------------
    r.get('/api/school/research', requireUser, (ctx) => LB.research(db, cid(ctx)));
    r.post('/api/school/research', research, (ctx) => ctx.json(LB.saveResearch(db, ctx, ctx.body), 201));
    r.put('/api/school/research/:id', research, (ctx) => LB.saveResearch(db, ctx, ctx.body, Number(ctx.params.id)));
    r.get('/api/school/publications', requireUser, (ctx) => LB.publications(db, cid(ctx), ctx.query).map((p) => ({ ...p, cite: LB.cite(p) })));
    r.post('/api/school/publications', research, (ctx) => ctx.json(LB.savePublication(db, ctx, ctx.body), 201));
    r.put('/api/school/publications/:id', research, (ctx) => LB.savePublication(db, ctx, ctx.body, Number(ctx.params.id)));
    r.get('/api/school/theses', requireUser, (ctx) => LB.theses(db, cid(ctx)));
    r.post('/api/school/theses', research, (ctx) => ctx.json(LB.saveThesis(db, ctx, ctx.body), 201));
    r.put('/api/school/theses/:id', research, (ctx) => LB.saveThesis(db, ctx, ctx.body, Number(ctx.params.id)));

    // ---------------- E-learning ----------------
    r.get('/api/school/lms/courses', requireUser, (ctx) => LMS.courses(db, cid(ctx), isTeacherOnly(ctx) ? { teacher_id: ctx.user.id } : {}));
    r.get('/api/school/lms/courses/:id', requireUser, (ctx) => LMS.courseDetail(db, cid(ctx), Number(ctx.params.id)));
    r.get('/api/school/lms/courses/:id/progress', requirePerm('teaching', 'schooloffice'), (ctx) => LMS.courseProgress(db, cid(ctx), Number(ctx.params.id)));
    r.post('/api/school/lms/courses', requirePerm('teaching'), (ctx) => ctx.json(LMS.saveCourse(db, ctx, ctx.body), 201));
    r.put('/api/school/lms/courses/:id', requirePerm('teaching'), (ctx) => LMS.saveCourse(db, ctx, ctx.body, Number(ctx.params.id)));
    r.post('/api/school/lms/lessons', requirePerm('teaching'), (ctx) => ctx.json(LMS.saveLesson(db, ctx, ctx.body), 201));
    r.put('/api/school/lms/lessons/:id', requirePerm('teaching'), (ctx) => LMS.saveLesson(db, ctx, ctx.body, Number(ctx.params.id)));
    r.get('/api/school/lms/submissions', requirePerm('teaching'), (ctx) => LMS.submissions(db, cid(ctx), { pending: ctx.query.pending === '1', teacher_id: isTeacherOnly(ctx) ? ctx.user.id : null }));
    r.post('/api/school/lms/grade', requirePerm('teaching'), (ctx) => LMS.grade(db, ctx, Number(ctx.body.lesson_id), Number(ctx.body.student_id), ctx.body));
    r.post('/api/school/lms/courses/:id/enroll', requirePerm('schooloffice', 'teaching'), (ctx) => ctx.json(LMS.enrollCourse(db, ctx, company(ctx), Number(ctx.params.id), Number(ctx.body.student_id)), 201));

    // ---------------- Dashboard and insights ----------------
    r.get('/api/school/dashboard', requireUser, (ctx) => IN.dashboard(db, cid(ctx)));
    r.get('/api/school/risk', requirePerm('teaching', 'schooloffice', 'reports'), (ctx) => IN.atRisk(db, cid(ctx), { limit: 300, class_id: ctx.query.class_id }));
  },
};
