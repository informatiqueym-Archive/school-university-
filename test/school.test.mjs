import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signup } from './helpers.mjs';

const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };
const okAny = (r) => { assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const ip = (n) => ({ 'X-Forwarded-For': `10.9.0.${n}` });

async function school(api) {
  const me = await signup(api);
  okAny(await api.put('/api/school/settings', { kind: 'secondary', grading: 'sequences', sequences: 6, matricule_prefix: 'TST', late_after: '07:40', admissions_open: true, portal_pay: true, repository_public: true, loan_days: 14, max_loans: 2, fine_per_day: 100 }));
  const meta = ok(await api.get('/api/school/meta'));
  const level = meta.levels.find((l) => l.name === 'Tle') || meta.levels.at(-1);
  const cls = okAny(await api.post('/api/school/classes', { level_id: level.id, name: 'Tle C', room: 'Salle 1', capacity: 40, all_subjects: true }));
  const courses = ok(await api.get(`/api/school/courses?class_id=${cls.id}`));
  return { me, meta, cls, courses };
}

test('school cycle: enrolment, fees in Compta, marks, council, bulletins, attendance, gate, discipline', async (t) => {
  const { api, close } = await startApp({ MODULES: 'school' });
  t.after(close);
  const { me, meta, cls, courses } = await school(api);
  assert.equal(me.main, 'school');
  assert.ok(meta.year && meta.fee_items.length, 'a school year and a fee schedule are created with the company');
  assert.ok(courses.length >= 5, 'all subjects of the level become courses');

  // Enrol three pupils; fees are billed as VAT-exempt invoices
  const kids = [];
  for (const [last, first, sex] of [['MBALLA', 'Grâce', 'F'], ['FOTSO', 'Brice', 'M'], ['NJOYA', 'Inès', 'F']]) {
    kids.push(okAny(await api.post('/api/school/students', { last_name: last, first_name: first, sex, birth_date: '2008-03-14', guardian_name: `M. ${last} Paul`, guardian_phone: '677000111', class_id: cls.id })));
  }
  assert.match(kids[0].matricule, /^TST/);
  const fees = ok(await api.get(`/api/school/fees/student/${kids[0].id}`));
  assert.ok(fees.total > 0 && fees.balance === fees.total);
  assert.ok(fees.items.every((i) => i.status === 'open'));

  // Cash collection is allocated to the oldest instalments and posted in Compta
  const first = fees.items[0];
  const rc = okAny(await api.post('/api/school/fees/collect', { student_id: kids[0].id, amount: first.balance + 5000, method: 'cash', payer: 'M. MBALLA Paul' }));
  assert.equal(rc.amount, first.balance + 5000);
  assert.ok(rc.allocations.length >= 2);
  const after = ok(await api.get(`/api/school/fees/student/${kids[0].id}`));
  assert.equal(after.balance, fees.balance - rc.amount);
  assert.equal(after.items[0].status, 'paid');
  const status = ok(await api.get('/api/school/fees/status'));
  assert.ok(JSON.stringify(status).includes('Tle C'));

  // Marks of sequence 1 for two courses, then results with ranks
  const [maths, phys] = courses;
  okAny(await api.post('/api/school/marks', { course_id: maths.id, sequence: 1, marks: [{ student_id: kids[0].id, mark: 16 }, { student_id: kids[1].id, mark: 9.5 }, { student_id: kids[2].id, mark: 12 }] }));
  okAny(await api.post('/api/school/marks', { course_id: phys.id, sequence: 1, marks: [{ student_id: kids[0].id, mark: 14 }, { student_id: kids[1].id, mark: 8 }, { student_id: kids[2].id, mark: 13 }] }));
  const bad = await api.post('/api/school/marks', { course_id: maths.id, sequence: 1, marks: [{ student_id: kids[0].id, mark: 23 }] });
  assert.equal(bad.status, 400, 'a mark above 20 is refused');

  // A test and a quiz feed sequence 2 of the maths course
  const a1 = okAny(await api.post('/api/school/assessments', { course_id: maths.id, sequence: 2, title: 'Interrogation', kind: 'quiz', max: 10, weight: 1, date: '2026-10-20' }));
  okAny(await api.post(`/api/school/assessments/${a1.id}/scores`, { scores: [{ student_id: kids[0].id, score: 9 }, { student_id: kids[1].id, score: 4 }, { student_id: kids[2].id, score: '', absent: true }] }));
  const a2 = okAny(await api.post('/api/school/assessments', { course_id: maths.id, sequence: 2, title: 'Devoir surveillé', kind: 'test', max: 20, weight: 2, date: '2026-10-28' }));
  okAny(await api.post(`/api/school/assessments/${a2.id}/scores`, { scores: [{ student_id: kids[0].id, score: 15 }, { student_id: kids[1].id, score: 10 }, { student_id: kids[2].id, score: 12 }] }));
  const m2 = ok(await api.get(`/api/school/marks?course_id=${maths.id}&sequence=2`));
  assert.equal(m2.derived, true, 'the sequence mark comes from the assessments');
  const mk = (id) => m2.students.find((x) => x.id === id);
  assert.equal(mk(kids[0].id).mark, 16, '(18 + 2 × 15) / 3 = 16');

  const res = ok(await api.get(`/api/school/results?class_id=${cls.id}&period=s1`));
  const top = res.students.find((s) => s.id === kids[0].id);
  assert.equal(top.rank, 1);
  assert.ok(top.average > 14 && top.average < 16);
  assert.equal(res.students.find((s) => s.id === kids[1].id).rank, 3);

  // Council: locks the sequence, makes the bulletin available, codes are verifiable
  okAny(await api.post('/api/school/council', { class_id: cls.id, period: 's1', decisions: kids.map((k) => ({ student_id: k.id, conduct: 'Bonne', remark: 'Bon travail' })) }));
  assert.equal(ok(await api.get(`/api/school/marks?course_id=${maths.id}&sequence=1`)).locked, true, 'marks are locked after the council');
  const bul = await api.get(`/api/school/bulletins?class_id=${cls.id}&period=s1`);
  assert.equal(bul.status, 200);
  assert.match(bul.data, /MBALLA/);
  const code = bul.data.match(/\/v\/([A-Z0-9]{8,})/)[1];
  const v = ok(await api.get(`/api/public/school/verify/${code}`, {}));
  assert.equal(v.valid, true); assert.equal(v.rank, 1);
  assert.equal(ok(await api.get('/api/public/school/verify/NOPE0000')).valid, false);

  // Roll call, absence report, gate with lateness, discipline
  okAny(await api.post('/api/school/attendance', { class_id: cls.id, date: '2026-10-30', absent: [kids[1].id], late: [{ student_id: kids[2].id, minutes: 15 }], hours: 4 }));
  const att = ok(await api.get(`/api/school/attendance?student_id=${kids[1].id}`));
  assert.equal(att.filter((a) => a.kind === 'absent').length, 1);
  const g1 = okAny(await api.post('/api/school/gate', { code: kids[0].matricule, direction: 'in', at: '2026-10-30T06:20:00.000Z' }));
  assert.equal(g1.late_minutes, 0);
  const g2 = okAny(await api.post('/api/school/gate', { code: kids[1].matricule, direction: 'in', at: '2026-10-30T07:05:00.000Z' }));
  assert.equal(g2.late_minutes, 25, '08:05 local, late after 07:40');
  assert.ok('overdue' in g2, 'the gate shows the fee status');
  const unknown = await api.post('/api/school/gate', { code: 'XXXX', direction: 'in' });
  assert.equal(unknown.status, 404);
  okAny(await api.post('/api/school/discipline', { student_id: kids[1].id, kind: 'detention', reason: 'Devoir non fait', date: '2026-10-30', hours: 2 }));
  const file = ok(await api.get(`/api/school/students/${kids[1].id}`));
  assert.ok(JSON.stringify(file).includes('Devoir non fait'));

  // Parents' portal: marks, fees, attendance, bulletin of the locked period
  const token = ok(await api.post(`/api/school/students/${kids[0].id}/portal-link`, {})).url.split('/p/')[1];
  const p = ok(await api.get(`/api/public/school/p/${token}`));
  assert.ok(p.reportable.some((r) => r.id === 's1'));
  assert.equal(p.fees.balance, after.balance);
  assert.ok(p.marks.summary.length);
  const dash = ok(await api.get('/api/school/dashboard'));
  assert.equal(dash.students.n ?? dash.students.total ?? dash.students.count, 3);
});

test('library, research repository, LMS quiz with certificate, online admission', async (t) => {
  const { api, close } = await startApp({ MODULES: 'school' });
  t.after(close);
  const { me, cls } = await school(api);
  const pupil = okAny(await api.post('/api/school/students', { last_name: 'EBOA', first_name: 'Kelly', sex: 'F', birth_date: '2008-05-01', guardian_name: 'Mme EBOA Rose', guardian_phone: '699000222', class_id: cls.id }));

  // Library: lend, refuse beyond copies, return with a fine
  const book = okAny(await api.post('/api/school/books', { title: 'Une vie de boy', authors: 'Ferdinand Oyono', category: 'Littérature africaine', copies: 1 }));
  const loan = okAny(await api.post('/api/school/loans', { book_id: book.id, student_code: pupil.matricule }));
  const again = await api.post('/api/school/loans', { book_id: book.id, user_id: me.user?.id || 1 });
  assert.ok(again.status >= 400, 'no copy left');
  const lib = ok(await api.get('/api/school/library'));
  assert.ok(JSON.stringify(lib).length > 2);
  okAny(await api.post(`/api/school/loans/${loan.id}/return`, { paid: true }));
  const loans = ok(await api.get('/api/school/loans'));
  assert.ok(loans.find((l) => l.id === loan.id).returned_at);

  // Research: project and public publication
  const proj = okAny(await api.post('/api/school/research', { title: 'Qualité de l\'eau du Wouri', field: 'SVT', status: 'active', budget: 500000, milestones: [{ title: 'Protocole', due: '2026-12-01', done: false }] }));
  const pub = okAny(await api.post('/api/school/publications', { kind: 'article', title: 'Le téléphone en classe de maths', authors: 'Ngo Biyong, S.', year: 2026, field: 'Didactique', research_id: proj.id, public: true }));
  assert.ok(pub.id);
  const repo = ok(await api.get(`/api/public/school/research?c=${me.company?.id || me.company_id || 1}`));
  assert.ok(JSON.stringify(repo).includes('Le téléphone en classe'));

  // E-learning: class course with a quiz, completed from the portal, certificate verifiable
  const course = okAny(await api.post('/api/school/lms/courses', { title: 'Suites numériques', class_id: cls.id, published: true, certificate: true, pass_score: 60 }));
  okAny(await api.post('/api/school/lms/lessons', { course_id: course.id, title: 'Cours', kind: 'text', content: 'u(n+1) = u(n) + r' }));
  const full = okAny(await api.post('/api/school/lms/lessons', { course_id: course.id, title: 'Quiz', kind: 'quiz', quiz: [{ q: '1 + 1 ?', choices: ['1', '2'], answer: 1 }, { q: '2 × 3 ?', choices: ['6', '5'], answer: 0 }] }));
  const [l1, l2] = full.lessons_list;
  assert.equal(l2.kind, 'quiz');
  const token = ok(await api.post(`/api/school/students/${pupil.id}/portal-link`, {})).url.split('/p/')[1];
  okAny(await api.post(`/api/public/school/p/${token}/lms/lesson/${l1.id}`, {}, ip(1)));
  const fail = okAny(await api.post(`/api/public/school/p/${token}/lms/lesson/${l2.id}`, { answers: [0, 1] }, ip(1)));
  assert.equal(fail.passed, false); assert.ok(!fail.certificate_code);
  const pass = okAny(await api.post(`/api/public/school/p/${token}/lms/lesson/${l2.id}`, { answers: [1, 0] }, ip(1)));
  assert.equal(pass.passed, true); assert.ok(pass.certificate_code);
  const cert = ok(await api.get(`/api/public/school/verify-cert/${pass.certificate_code}`));
  assert.equal(cert.valid, true);

  // Online admission: public application, accepted into a class, billed
  const pub0 = ok(await api.get(`/api/public/school?c=${me.company?.id || me.company_id || 1}`));
  const appl = okAny(await api.post('/api/public/school/apply', { c: me.company?.id || me.company_id || 1, last_name: 'NDOUMBE', first_name: 'Kelly', sex: 'F', level_id: pub0.levels.at(-1).id, guardian_name: 'M. NDOUMBE Pierre', guardian_phone: '677123456', birth_date: '2009-04-12' }, ip(2)));
  void appl;
  const apps = ok(await api.get('/api/school/applications'));
  assert.equal(apps.length, 1);
  const stu = okAny(await api.post(`/api/school/applications/${apps[0].id}/accept`, { class_id: cls.id }));
  assert.ok(stu.matricule);
  const f = ok(await api.get(`/api/school/fees/student/${stu.id}`));
  assert.ok(f.total > 0);
  assert.equal((await api.post(`/api/school/applications/${apps[0].id}/accept`, { class_id: cls.id })).status, 409);
});

test('teacher accounts only see and mark their own courses', async (t) => {
  const { api, close } = await startApp({ MODULES: 'school' });
  t.after(close);
  const { cls, courses } = await school(api);
  const pupil = okAny(await api.post('/api/school/students', { last_name: 'TAMBA', first_name: 'Loïc', sex: 'M', birth_date: '2008-01-01', guardian_name: 'M. TAMBA', guardian_phone: '677555444', class_id: cls.id }));
  const u = okAny(await api.post('/api/users', { name: 'Solange Ngo Biyong', email: 'prof@test.cm', password: 'motdepasse1', role: 'teacher' }));
  okAny(await api.put(`/api/school/courses/${courses[0].id}`, { teacher_id: u.id }));
  okAny(await api.post('/api/school/council', { class_id: cls.id, period: 's1', decisions: [] }));
  ok(await api.post('/api/auth/logout'));
  ok(await api.post('/api/auth/login', { email: 'prof@test.cm', password: 'motdepasse1' }));
  assert.equal((await api.post('/api/school/marks', { course_id: courses[0].id, sequence: 1, marks: [{ student_id: pupil.id, mark: 15 }] })).status, 409, 'locked after the council');
  okAny(await api.post('/api/school/marks', { course_id: courses[0].id, sequence: 2, marks: [{ student_id: pupil.id, mark: 15 }] }));
  const other = await api.post('/api/school/marks', { course_id: courses[1].id, sequence: 2, marks: [{ student_id: pupil.id, mark: 15 }] });
  assert.equal(other.status, 403);
  assert.equal((await api.post('/api/school/fees/collect', { student_id: pupil.id, amount: 1000, method: 'cash' })).status, 403);
  assert.equal((await api.post('/api/school/council', { class_id: cls.id, period: 's1', decisions: [] })).status, 403);
});
