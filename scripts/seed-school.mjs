// Creates two demo campuses for Teknons École, through the real HTTP API so that
// fees, accounting entries, marks and ranks stay consistent:
//   1. Collège Bilingue Les Lauréats (Douala), secondary school, 9 classes and
//      about 250 pupils, sequences 1 and 2 marked (council of sequence 1 held),
//      fees partly paid by cash / MTN MoMo / Orange Money, absences and today's
//      gate scans, discipline, timetable, lesson log, library, online courses,
//      admissions and official exams.                  → demo@teknons.cm / demo1234
//   2. Institut Universitaire Les Lauréats, LMD university: cohorts from
//      Licence 1 to Master 2, credits and GPA, research projects, an open
//      publications repository, theses, paid online courses.  → univ@teknons.cm / demo1234
// Other accounts (password demo1234): directeur@, secretariat@, econome@,
// surveillant@, biblio@, compta@, prof@ (maths teacher) and the other teachers.
//   MODULES=school DATA_DIR=./data node scripts/seed-school.mjs
import path from 'node:path';
import { createApp } from '../app.js';
import { createCompany } from '../core/routes.js';
import { hashPassword } from '../core/auth.js';
import { now } from '../core/schema.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const env = { ...process.env, MODULES: process.env.MODULES || 'school', MOMO_MODE: process.env.MOMO_MODE || 'simulation' };
const app = createApp({ dbFile: path.join(dataDir, 'teknons.db'), env, jobs: false });
const { db, modules } = app;
const email = process.env.DEMO_EMAIL || 'demo@teknons.cm';
const password = process.env.DEMO_PASSWORD || 'demo1234';
if (db.get('SELECT id FROM users WHERE email = ?', email)) { console.log('Demo school already exists:', email); process.exit(0); }

await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
let cookie = '';
async function call(method, p, body, headers = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie'); if (set && !p.startsWith('/api/public')) cookie = set.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (res.status >= 300) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const get = (p) => call('GET', p), post = (p, b) => call('POST', p, b || {}), put = (p, b) => call('PUT', p, b), del = (p) => call('DELETE', p);
let ipN = 1;
const guest = (m, p, b) => call(m, p, b, { 'X-Forwarded-For': `10.7.${Math.floor(ipN / 250) % 250}.${(ipN++ % 250) + 1}` });
const tryIt = async (fn) => { try { return await fn(); } catch (e) { if (process.env.DEBUG) console.warn(e.message); return null; } };
let seed = 2026;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const q4 = (v) => Math.round(v * 4) / 4;
const todayStr = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const schoolDays = (n) => { const out = []; let d = todayStr; while (out.length < n) { d = addDays(d, -1); const w = new Date(d + 'T12:00:00Z').getUTCDay(); if (w >= 1 && w <= 5) out.push(d); } return out; };
const phone = () => `6${pick(['5', '7', '8', '9'])}${String(Math.floor(rnd() * 1e7)).padStart(7, '0')}`;
const tinyPdf = (title) => {
  const t = title.replace(/[()\\]/g, '').slice(0, 70);
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${60 + t.length}>>stream\nBT /F1 16 Tf 60 780 Td (${t}) Tj 0 -30 Td (Teknons Ecole - depot ouvert) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  return 'data:application/pdf;base64,' + Buffer.from(body).toString('base64');
};

const LAST = ['MBALLA', 'NGONO', 'ETOUNDI', 'FOTSO', 'KAMGA', 'TCHOUPO', 'NJOYA', 'ABENA', 'ATANGANA', 'ESSOMBA', 'NKOULOU', 'BELLA', 'OWONA', 'MBARGA', 'EKOTTO', 'EBOA', 'NDJOCK', 'TAMBA', 'NANA', 'KENGNE', 'TCHAMBA', 'FOKOU', 'WAMBA', 'NJIKE', 'SIMO', 'MOUKOKO', 'EPANDA', 'NGUE', 'MANGA', 'MOUSSA', 'ABOUBAKAR', 'HAMADOU', 'BOUBA', 'NGOUFACK', 'TAGNE', 'DJOMO', 'MEKA', 'ONANA', 'EYENGA', 'NDONGO', 'TCHINDA', 'FONKOU', 'NGASSA', 'KOUAM', 'YOUMBI', 'ELOUNDOU', 'ZAMBO', 'ASSOMO'];
const FIRST_M = ['Junior', 'Brice', 'Kevin', 'Arnaud', 'Yannick', 'Cédric', 'Franck', 'Loïc', 'Ulrich', 'Steve', 'Hervé', 'Ryan', 'Ethan', 'Christian', 'Samuel', 'Daniel', 'Idriss', 'Ibrahim', 'Stéphane', 'Boris', 'Emmanuel', 'Joël', 'William', 'Nathan'];
const FIRST_F = ['Grâce', 'Ornella', 'Larissa', 'Michelle', 'Christelle', 'Nadège', 'Sandrine', 'Merveille', 'Prisca', 'Audrey', 'Laura', 'Inès', 'Danielle', 'Joëlle', 'Patricia', 'Blessing', 'Aïcha', 'Mariam', 'Estelle', 'Floriane', 'Divine', 'Raïssa', 'Kelly', 'Vanessa'];
const PARENT = ['Paul', 'Jean', 'Martin', 'Joseph', 'André', 'Pierre', 'Emmanuel', 'Thomas', 'Bernard', 'Simon', 'Marie', 'Hélène', 'Odile', 'Pauline', 'Rose', 'Thérèse'];

async function addStaff(companyId, list) {
  const out = {};
  for (const [name, mail, role] of list) out[mail] = Number(db.run('INSERT INTO users (company_id, name, email, password_hash, role, phone, created_at) VALUES (?,?,?,?,?,?,?)', companyId, name, mail, hashPassword(password), role, phone(), now()).lastInsertRowid);
  return out;
}

/** Students of a class with an ability profile (some in decline, to feed the early-warning list). */
async function fillClass(cls, n, { birthYear, subs = {}, families }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const sex = chance(0.52) ? 'F' : 'M';
    let last = pick(LAST), guardian = null;
    if (families.length && chance(0.07)) { guardian = pick(families); last = guardian.last; }
    if (!guardian) guardian = { last, name: `${chance(0.7) ? 'M.' : 'Mme'} ${last} ${pick(PARENT)}`, phone: phone() };
    families.push(guardian);
    const first = sex === 'F' ? pick(FIRST_F) : pick(FIRST_M);
    const b = { last_name: last, first_name: first + (chance(0.25) ? ` ${sex === 'F' ? pick(FIRST_F) : pick(FIRST_M)}` : ''), sex, birth_date: `${birthYear + (chance(0.25) ? -1 : 0)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`,
      birth_place: pick(['Douala', 'Douala', 'Yaoundé', 'Bafoussam', 'Nkongsamba', 'Edéa', 'Limbé', 'Buea', 'Kribi', 'Garoua']), guardian_name: guardian.name, guardian_phone: guardian.phone, guardian_relation: pick(['Père', 'Mère', 'Père', 'Mère', 'Tuteur']),
      class_id: cls.id, blood_group: pick(['O+', 'A+', 'B+', 'O+', 'AB+', '']), allergies: chance(0.05) ? pick(['Arachides', 'Pénicilline', 'Lactose']) : '', previous_school: chance(0.3) ? pick(['École publique de Bonamoussadi', 'Collège Libermann', 'Lycée de Makepe', 'Groupe scolaire Les Anges']) : '',
      discount_pct: chance(0.06) ? pick([25, 50]) : 0, discount_reason: '', repeating: chance(0.08),
      subscriptions: [...(subs.canteen && chance(0.3) ? [subs.canteen] : []), ...(subs.bus && chance(0.15) ? [subs.bus] : [])] };
    if (b.discount_pct) b.discount_reason = pick(['Enfant du personnel', 'Fratrie (3e enfant)', 'Bourse d\'excellence']);
    const s = await post('/api/school/students', b);
    out.push({ ...s, ability: clamp(11.2 + gauss() * 2.6, 3, 18.5), decline: chance(0.07) ? 3.2 : 0, guardian });
  }
  return out;
}

async function payFees(students, profile = 'school') {
  for (const s of students) {
    const f = await get(`/api/school/fees/student/${s.id}`);
    const open = f.items.filter((x) => ['open', 'partial'].includes(x.status));
    if (!open.length) continue;
    const r = rnd(); let target = 0;
    const reg = open.filter((x) => x.kind === 'registration' || x.kind === 'other').reduce((a, b) => a + b.balance, 0);
    const t1 = open.find((x) => x.kind === 'tuition')?.balance || 0;
    if (r < 0.16) target = f.balance; else if (r < 0.62) target = reg + t1; else if (r < 0.86) target = reg + Math.round((t1 * (0.3 + rnd() * 0.5)) / 5000) * 5000; else if (r < 0.94) target = reg; else target = 0;
    target = Math.min(target, f.balance);
    let left = target; let k = 0;
    while (left > 0 && k < 3) {
      const amount = k === 0 && left > 60000 && chance(0.5) ? Math.round(left / 2 / 5000) * 5000 || left : left;
      const method = pick(['cash', 'cash', 'cash', 'mtn_momo', 'mtn_momo', 'orange_money', 'orange_money', profile === 'univ' ? 'bank' : 'cash']);
      const rc = await tryIt(() => post('/api/school/fees/collect', { student_id: s.id, amount, method, reference: method === 'cash' ? '' : `TX${Math.floor(rnd() * 1e9)}`, payer: s.guardian?.name || '' }));
      if (!rc) break;
      left -= rc.amount; k++;
      // Spread the receipts over the last two months.
      const d = addDays(todayStr, -Math.floor(rnd() * (k === 1 ? 58 : 25)) - (k === 1 ? 2 : 0));
      const at = `${d}T${String(7 + Math.floor(rnd() * 9)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00.000Z`;
      db.run('UPDATE school_receipts SET created_at = ? WHERE id = ?', at, rc.id);
      for (const a of rc.allocations) db.run('UPDATE payments SET date = ?, created_at = ? WHERE id = ?', d, at, a.payment_id);
    }
  }
}

// =====================================================================
// 1. Collège Bilingue Les Lauréats
// =====================================================================
const { companyId } = createCompany(db, modules, { company: 'Collège Bilingue Les Lauréats', name: 'Dr Armand Ngando', email, password, phone: '673799674' });
db.run(`UPDATE companies SET legal_form = 'SARL', niu = 'M092215478963L', rccm = 'RC/DLA/2012/B/2210', address = 'Carrefour Bonamoussadi, face Santa Lucia', city = 'Douala', phone = '+237 673 799 674',
  email = 'contact@leslaureats.cm', website = 'leslaureats.cm', momo_number = '673 799 674', om_number = '691 45 22 10',
  invoice_footer = 'Collège Bilingue Les Lauréats · Autorisation MINESEC n° 241/12 · Bonamoussadi, Douala' WHERE id = ?`, companyId);
const U = await addStaff(companyId, [
  ['Mme Béatrice Ekwalla', 'directeur@teknons.cm', 'manager'], ['Sylvie Moukouri', 'secretariat@teknons.cm', 'registrar'], ['Roger Kounou', 'econome@teknons.cm', 'cashier'],
  ['Alain Bekolo', 'surveillant@teknons.cm', 'supervisor'], ['Thérèse Mbock', 'biblio@teknons.cm', 'librarian'], ['Aline Compta', 'compta@teknons.cm', 'accountant'],
  ['Solange Ngo Biyong', 'prof@teknons.cm', 'teacher'], ['Paul Ndzana', 'maths2@teknons.cm', 'teacher'], ['Jean-Pierre Fotso', 'pct@teknons.cm', 'teacher'], ['Clarisse Ewane', 'svt@teknons.cm', 'teacher'],
  ['Achille Mbarga', 'francais@teknons.cm', 'teacher'], ['Grace Tanyi', 'anglais@teknons.cm', 'teacher'], ['Hervé Nkoulou', 'hg@teknons.cm', 'teacher'], ['Bertille Kamga', 'langues@teknons.cm', 'teacher'],
  ['Désiré Atangana', 'philo@teknons.cm', 'teacher'], ['Ulrich Tchoupo', 'info@teknons.cm', 'teacher'], ['Serge Abena', 'eps@teknons.cm', 'teacher'],
]);
await post('/api/auth/login', { email, password });
await put('/api/school/settings', { kind: 'secondary', system: 'bilingual', grading: 'sequences', sequences: 6, ministry: 'MINESEC', principal_name: 'Dr Armand Ngando', principal_title: 'Principal', matricule_prefix: 'CBL',
  motto: 'Discipline · Travail · Excellence', day_start: '07:30', late_after: '07:40', absence_alert_hours: 12, admissions_open: true, portal_pay: true, repository_public: true, loan_days: 14, max_loans: 3, fine_per_day: 100,
  welcome_text: 'Bienvenue au Collège Bilingue Les Lauréats. Établissement privé laïc d\'enseignement général, de la 6e à la Terminale, sections francophone et anglophone. 98 % de réussite au Baccalauréat en 2026. Préinscrivez votre enfant en ligne : le secrétariat vous rappelle sous 48 heures pour l\'entretien et le test de niveau.' });
let meta = await get('/api/school/meta');
const T = (mail) => U[mail];
const staffFiles = [['prof@teknons.cm', 'Mme', 'Professeure de mathématiques, coordinatrice', 'Mathématiques', 'DIPES II Mathématiques (ENS Yaoundé)', 'permanent', 0], ['maths2@teknons.cm', 'M.', 'Professeur de mathématiques', 'Mathématiques', 'Master Mathématiques (Univ. Douala)', 'part_time', 3500],
  ['pct@teknons.cm', 'M.', 'Professeur de physique-chimie', 'Physique-Chimie', 'DIPES II Physique', 'permanent', 0], ['svt@teknons.cm', 'Mme', 'Professeure de SVT', 'SVT', 'DIPES II Sciences naturelles', 'permanent', 0],
  ['francais@teknons.cm', 'M.', 'Professeur de français', 'Lettres modernes', 'DIPES II Lettres', 'permanent', 0], ['anglais@teknons.cm', 'Mrs', 'English teacher', 'English', 'DIPES II Bilingual Studies', 'permanent', 0],
  ['hg@teknons.cm', 'M.', 'Professeur d\'histoire-géographie', 'Histoire-Géographie, ECM', 'DIPES II Histoire', 'permanent', 0], ['langues@teknons.cm', 'Mme', 'Professeure de langues', 'Allemand, espagnol, langues nationales', 'Licence LEA', 'part_time', 3000],
  ['philo@teknons.cm', 'M.', 'Professeur de philosophie', 'Philosophie', 'DIPES II Philosophie', 'visiting', 4000], ['info@teknons.cm', 'M.', 'Professeur d\'informatique', 'Informatique, travail manuel', 'Ingénieur informaticien', 'part_time', 3500], ['eps@teknons.cm', 'M.', 'Professeur d\'EPS', 'EPS', 'DIPEPS (INJS)', 'permanent', 0]];
for (const [mail, title, position, speciality, diploma, status, rate] of staffFiles) await put(`/api/school/staff/${T(mail)}`, { title, position, speciality, diploma, status, hourly_rate: rate, hire_date: `20${10 + Math.floor(rnd() * 14)}-09-01` });

// Subject colours for the timetable.
const COLORS = { FRA: '#2563EB', ANG: '#7C3AED', HG: '#B45309', ECM: '#0E7490', LV2: '#DB2777', LCN: '#9333EA', PHI: '#4B5563', MAT: '#15803D', PCT: '#DC2626', SVT: '#65A30D', INF: '#0891B2', EPS: '#EA580C', TM: '#A16207' };
for (const s of meta.subjects) if (COLORS[s.code]) await put(`/api/school/subjects/${s.id}`, { color: COLORS[s.code] });
const sub = Object.fromEntries(meta.subjects.map((s) => [s.code, s.id]));
const lvl = Object.fromEntries(meta.levels.map((l) => [l.name, l.id]));

// Classes
const CLASSES = [['6e', '6e A', 'prof@teknons.cm', '101', 'col', 2014], ['6e', '6e B', 'francais@teknons.cm', '102', 'col', 2014], ['5e', '5e A', 'anglais@teknons.cm', '103', 'col', 2013], ['4e', '4e A', 'hg@teknons.cm', '104', 'col', 2012],
  ['3e', '3e A', 'svt@teknons.cm', '105', 'col', 2011], ['2nde', '2nde C', 'pct@teknons.cm', '201', 'C', 2010], ['1ère', '1ère D', 'svt@teknons.cm', '202', 'D', 2009], ['Tle', 'Tle C', 'prof@teknons.cm', '203', 'C', 2008], ['Tle', 'Tle D', 'philo@teknons.cm', '204', 'D', 2008]];
const COEF = {
  col: { FRA: [3, 5], ANG: [2, 3], HG: [2, 2], ECM: [1, 1], LV2: [2, 2], LCN: [1, 1], MAT: [4, 5], PCT: [2, 3], SVT: [2, 2], INF: [1, 1], EPS: [1, 2], TM: [1, 1] },
  C: { FRA: [2, 3], ANG: [2, 3], HG: [2, 2], ECM: [1, 1], PHI: [2, 3], MAT: [5, 6], PCT: [5, 5], SVT: [2, 2], INF: [1, 1], EPS: [1, 2] },
  D: { FRA: [2, 3], ANG: [2, 3], HG: [2, 2], ECM: [1, 1], PHI: [2, 3], MAT: [4, 5], PCT: [4, 4], SVT: [4, 4], INF: [1, 1], EPS: [1, 2] },
};
const teacherOf = (code, cls) => ({ FRA: 'francais@teknons.cm', ANG: 'anglais@teknons.cm', HG: 'hg@teknons.cm', ECM: 'hg@teknons.cm', LV2: 'langues@teknons.cm', LCN: 'langues@teknons.cm', PHI: 'philo@teknons.cm',
  MAT: ['6e A', '6e B', '5e A', '4e A'].includes(cls) ? 'maths2@teknons.cm' : 'prof@teknons.cm', PCT: 'pct@teknons.cm', SVT: 'svt@teknons.cm', INF: 'info@teknons.cm', EPS: 'eps@teknons.cm', TM: 'info@teknons.cm' }[code]);
const DIFF = { MAT: -1.1, PCT: -0.9, PHI: -1.4, SVT: -0.2, FRA: -0.3, ANG: 0.3, HG: 0, ECM: 1.2, LV2: 0.4, LCN: 1.4, INF: 1, EPS: 2.2, TM: 1.6 };
const classes = [];
for (const [level, name, head, room, track, birthYear] of CLASSES) {
  const c = await post('/api/school/classes', { level_id: lvl[level], name, room: `Salle ${room}`, capacity: 45, head_teacher_id: T(head), all_subjects: true });
  const courses = await get(`/api/school/courses?class_id=${c.id}`);
  const keep = COEF[track];
  for (const co of courses) {
    const code = co.subject_code;
    if (!keep[code] || (code === 'LV2' && ['6e', '5e'].includes(level)) || (code === 'PHI' && level === '2nde')) { await del(`/api/school/courses/${co.id}`); continue; }
    await put(`/api/school/courses/${co.id}`, { teacher_id: T(teacherOf(code, name)), coef: keep[code][0], hours: keep[code][1] });
  }
  classes.push({ ...c, level, track, birthYear, courses: await get(`/api/school/courses?class_id=${c.id}`) });
}
meta = await get('/api/school/meta');
const canteen = meta.fee_items.find((f) => f.name.startsWith('Cantine'))?.id; const bus = meta.fee_items.find((f) => f.name.startsWith('Transport'))?.id;

// Students and fees
console.log('Pupils…');
const families = []; const all = [];
for (const c of classes) { c.students = await fillClass(c, 26 + Math.floor(rnd() * 5), { birthYear: c.birthYear, subs: { canteen, bus }, families }); all.push(...c.students); }
// Invoices were issued at enrolment, in September, with the instalment due dates of the fee schedule.
const backdate = (cid, d) => db.run(`UPDATE documents SET date = ?, due_date = (SELECT i.due_date FROM school_student_fees f JOIN school_fee_items i ON i.id = f.fee_item_id WHERE f.document_id = documents.id)
  WHERE id IN (SELECT document_id FROM school_student_fees WHERE company_id = ?)`, d, cid);
backdate(companyId, meta.year.start_date);
console.log(`  ${all.length} pupils, paying fees…`);
await payFees(all);

// Marks: sequence 1 complete, sequence 2 mostly entered (some through individual tests).
console.log('Marks…');
const markFor = (s, code, seq) => clamp(q4(s.ability + (DIFF[code] || 0) + gauss() * 1.8 - (seq === 2 ? s.decline : 0)), 0, 20);
for (const c of classes) {
  for (const co of c.courses) {
    await post('/api/school/marks', { course_id: co.id, sequence: 1, marks: c.students.map((s) => ({ student_id: s.id, mark: chance(0.015) ? '' : markFor(s, co.subject_code, 1), absent: false })) });
    const viaTests = (c.name === 'Tle C' && co.subject_code === 'MAT') || (c.name === '3e A' && co.subject_code === 'FRA') || (c.name === '6e A' && co.subject_code === 'MAT');
    if (viaTests) {
      const tests = c.name === 'Tle C' ? [['Interrogation n°1 : limites et continuité', 'quiz', 10, 1, -24], ['Devoir surveillé n°1 : suites numériques', 'test', 20, 2, -10]] : c.name === '3e A' ? [['Dictée et questions', 'quiz', 20, 1, -20], ['Rédaction : le récit', 'test', 20, 2, -8]] : [['Interrogation : nombres décimaux', 'quiz', 10, 1, -15], ['Devoir : fractions', 'homework', 20, 1, -6]];
      for (const [title, kind, max, weight, off] of tests) {
        const a = await post('/api/school/assessments', { course_id: co.id, sequence: 2, title, kind, max, weight, date: addDays(todayStr, off) });
        await post(`/api/school/assessments/${a.id}/scores`, { scores: c.students.map((s) => { const ab = chance(0.03); return { student_id: s.id, score: ab ? '' : Math.round((markFor(s, co.subject_code, 2) / 20) * max * 4) / 4, absent: ab }; }) });
      }
    } else if (chance(0.72)) {
      await post('/api/school/marks', { course_id: co.id, sequence: 2, marks: c.students.map((s) => ({ student_id: s.id, mark: markFor(s, co.subject_code, 2) })) });
    }
  }
  await post('/api/school/council', { class_id: c.id, period: 's1', decisions: c.students.map((s) => ({ student_id: s.id, conduct: s.ability > 9 ? pick(['Très bonne', 'Bonne', 'Bonne']) : pick(['Passable', 'Bonne']), remark: s.ability >= 14 ? 'Excellent début d\'année, continuez ainsi.' : s.ability >= 10 ? 'Résultats satisfaisants, peut mieux faire.' : 'Travail insuffisant, doit redoubler d\'efforts.' })) });
}

// Timetable (no clash: class, teacher and room are checked by the server).
console.log('Timetable…');
const SLOTS = [['07:30', '09:20'], ['09:40', '11:30'], ['11:30', '12:25'], ['13:30', '15:20'], ['15:20', '16:15']];
for (const c of classes) {
  const queue = []; for (const co of c.courses) for (let h = 0; h < Math.max(1, Math.round(co.hours / 2)); h++) queue.push(co);
  queue.sort(() => rnd() - 0.5);
  const spots = []; for (const [start, end] of SLOTS) for (let day = 1; day <= 5; day++) spots.push([day, start, end]);
  for (const [day, start, end] of spots) {
    if (!queue.length) break;
    for (let k = 0; k < queue.length; k++) {
      if (queue.slice(0, k).some((x) => x.id === queue[k].id)) continue;
      const ok = await tryIt(() => post('/api/school/timetable', { course_id: queue[k].id, day, start, end }));
      if (ok) { queue.splice(k, 1); break; }
    }
  }
}

// Lesson log and homework, last two weeks.
console.log('Lesson log, attendance, gate…');
const TOPICS = { MAT: ['Suites arithmétiques', 'Limites de fonctions', 'Fractions et décimaux', 'Théorème de Pythagore', 'Équations du second degré', 'Statistiques'], PCT: ['Mouvement rectiligne', 'Les solutions aqueuses', 'Circuits électriques', 'Énergie cinétique'], SVT: ['La cellule', 'La photosynthèse', 'Génétique : lois de Mendel', 'Le système nerveux'],
  FRA: ['Le récit fantastique', 'L\'argumentation', 'Étude de « Une vie de boy »', 'Le résumé de texte'], ANG: ['Reported speech', 'Essay writing', 'Reading: Things Fall Apart', 'The passive voice'], HG: ['La colonisation allemande au Kamerun', 'Les climats du Cameroun', 'La guerre froide'], PHI: ['La conscience', 'Le travail', 'La liberté'],
  INF: ['Algorithmique : les boucles', 'Tableur : formules', 'Réseaux informatiques'], EPS: ['Endurance', 'Handball'], ECM: ['Les droits de l\'enfant'], LV2: ['Die Familie', 'En el mercado'], LCN: ['Contes du Littoral'], TM: ['Couture : ourlet'] };
const days10 = schoolDays(10);
for (const c of classes) {
  for (const d of days10.slice(0, 8)) {
    for (const co of c.courses.filter(() => chance(0.28))) {
      const topic = pick(TOPICS[co.subject_code] || ['Cours']);
      await tryIt(() => post('/api/school/lessons', { course_id: co.id, date: d, title: topic, content: `${topic} : cours, exemples et exercices d'application en classe.`, homework: chance(0.45) ? `Exercices ${1 + Math.floor(rnd() * 8)} à ${9 + Math.floor(rnd() * 6)} page ${20 + Math.floor(rnd() * 180)}` : '', due_date: addDays(todayStr, 1 + Math.floor(rnd() * 5)) }));
    }
  }
}
// Attendance: roll calls of the last 10 school days (absences concentrated on struggling pupils), and today.
for (const c of classes) {
  for (const d of [...days10, todayStr]) {
    if (d === todayStr && chance(0.3)) continue;
    const absent = c.students.filter((s) => chance(s.ability < 8 ? 0.12 : s.decline ? 0.1 : 0.02)).map((s) => s.id);
    const late = c.students.filter((s) => !absent.includes(s.id) && chance(0.025)).map((s) => ({ student_id: s.id, minutes: 5 + Math.floor(rnd() * 25) }));
    await post('/api/school/attendance', { class_id: c.id, date: d, absent, late, hours: 4 });
  }
}
for (const a of db.all("SELECT id FROM school_attendance WHERE company_id = ? AND kind = 'absent'", companyId)) if (chance(0.35)) await put(`/api/school/attendance/${a.id}`, { justified: true, reason: pick(['Certificat médical', 'Paludisme, certificat du centre de santé', 'Deuil familial', 'Rendez-vous médical']) });
// Gate: this morning's arrivals (Douala time = UTC+1).
const absentToday = new Set(db.all("SELECT student_id FROM school_attendance WHERE company_id = ? AND date = ? AND kind = 'absent'", companyId, todayStr).map((r) => r.student_id));
for (const s of all) {
  if (absentToday.has(s.id) || chance(0.04)) continue;
  const mins = 6 * 60 + 40 + Math.floor(Math.abs(gauss()) * 18) + (chance(0.09) ? 58 + Math.floor(rnd() * 22) : 0) - 60; // local 06:40 onwards
  const at = `${todayStr}T${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}.000Z`;
  await tryIt(() => post('/api/school/gate', { code: s.matricule, direction: 'in', at }));
}

// Discipline
const REASONS = { praise: ['Excellent comportement et entraide en classe', 'Premier du concours de mathématiques'], warning: ['Bavardages répétés en cours', 'Tenue non réglementaire', 'Retards répétés'], detention: ['Devoir non fait trois fois', 'Insolence envers un camarade'], blame: ['Bagarre dans la cour de récréation', 'Fraude pendant le devoir surveillé'], suspension: ['Insulte envers un enseignant'] };
for (let i = 0; i < 24; i++) {
  const s = pick(all.filter((x) => x.ability < 11 || chance(0.2))); const kind = pick(['praise', 'warning', 'warning', 'warning', 'detention', 'detention', 'blame', 'suspension']);
  await post('/api/school/discipline', { student_id: s.id, kind, reason: pick(REASONS[kind]), date: addDays(todayStr, -Math.floor(rnd() * 45)), hours: kind === 'detention' ? 2 : 0, days: kind === 'suspension' ? 2 : 0 });
}

// Announcements, admissions, official exams
console.log('Announcements, admissions, exams, library, e-learning…');
await post('/api/school/announcements', { title: 'Bulletins de la 1re séquence disponibles', body: 'Les conseils de classe de la 1re séquence se sont tenus. Les bulletins sont consultables et imprimables sur votre espace parent. Chaque bulletin porte un QR code de vérification.', pinned: true });
await post('/api/school/announcements', { title: '2e tranche de scolarité', body: 'La 2e tranche est attendue avant le 15 janvier. Payez en un clic par MTN MoMo ou Orange Money depuis votre espace parent, ou à l\'économat de 7 h 30 à 15 h 30. Le reçu est disponible immédiatement.' });
await post('/api/school/announcements', { title: 'Journée portes ouvertes et kermesse', body: 'Samedi 21 novembre de 9 h à 16 h : visite des laboratoires, démonstrations du club robotique, kermesse de l\'APE et inscriptions pour l\'année prochaine.' });
await post('/api/school/announcements', { class_id: classes.find((c) => c.name === 'Tle C').id, title: 'Sortie pédagogique au port de Douala', body: 'Les élèves de Tle C visiteront le port autonome jeudi prochain (physique : mécanique des fluides). Autorisation parentale à rendre au professeur principal.' });
const lev = Object.fromEntries((await get('/api/public/school')).levels.map((l) => [l.name, l.id]));
for (const [last, first, sex, level, avg, gname] of [['NDOUMBE', 'Kelly', 'F', '6e', 15.2, 'M. NDOUMBE Pierre'], ['TANKEU', 'Wilfried', 'M', '2nde', 12.8, 'Mme TANKEU Odile'], ['EBANGA', 'Marie-Claire', 'F', '6e', 16.4, 'M. EBANGA Joseph'], ['MOUAFO', 'Ryan', 'M', '4e', 11.1, 'M. MOUAFO Thomas'], ['SIKALI', 'Pauline', 'F', '1ère', 13.6, 'Mme SIKALI Rose'], ['DIKONGUE', 'Nathan', 'M', '6e', 14, 'M. DIKONGUE André']]) {
  await guest('POST', '/api/public/school/apply', { c: companyId, last_name: last, first_name: first, sex, level_id: lev[level], last_average: avg, guardian_name: gname, guardian_phone: phone(), previous_school: pick(['École publique de Kotto', 'Groupe scolaire Bilingue Les Pionniers', 'Collège Saint-Michel']), birth_date: `${2014 - ['6e', '5e', '4e', '3e', '2nde', '1ère'].indexOf(level)}-04-12` });
}
for (const c of classes.filter((x) => x.level === 'Tle')) for (const s of c.students) {
  await post(`/api/school/students/${s.id}/exams`, { exam: 'Probatoire', session: '2026', series: c.track, center: 'Lycée de Japoma', result: s.ability > 8.5 || chance(0.5) ? 'passed' : 'failed', mention: s.ability > 15 ? 'Très bien' : s.ability > 13 ? 'Bien' : s.ability > 11.5 ? 'Assez bien' : 'Passable' });
  await post(`/api/school/students/${s.id}/exams`, { exam: 'Baccalauréat', session: '2027', series: c.track, center: 'Lycée de Japoma', candidate_no: `BAC27-${Math.floor(100000 + rnd() * 899999)}` });
}
for (const s of classes.find((c) => c.level === '3e').students) await post(`/api/school/students/${s.id}/exams`, { exam: 'BEPC', session: '2027', center: 'CES de Bonamoussadi', candidate_no: `BEPC27-${Math.floor(10000 + rnd() * 89999)}` });

// Library
const BOOKS = [['Une vie de boy', 'Ferdinand Oyono', 'Julliard', 1956, 'Littérature africaine', 6, '#7C2D12'], ['Ville cruelle', 'Mongo Beti', 'Présence Africaine', 1954, 'Littérature africaine', 4, '#9A3412'], ['Le vieux nègre et la médaille', 'Ferdinand Oyono', 'Julliard', 1956, 'Littérature africaine', 5, '#B45309'],
  ['L\'enfant noir', 'Camara Laye', 'Plon', 1953, 'Littérature africaine', 5, '#92400E'], ['Les soleils des indépendances', 'Ahmadou Kourouma', 'Seuil', 1970, 'Littérature africaine', 3, '#A16207'], ['Things Fall Apart', 'Chinua Achebe', 'Heinemann', 1958, 'English literature', 6, '#1E3A8A'],
  ['The Lion and the Jewel', 'Wole Soyinka', 'OUP', 1963, 'English literature', 3, '#1E40AF'], ['Trois prétendants… un mari', 'Guillaume Oyônô Mbia', 'CLE', 1964, 'Théâtre', 4, '#6D28D9'], ['Le Cid', 'Pierre Corneille', 'Hachette', 1637, 'Théâtre', 4, '#5B21B6'],
  ['Germinal', 'Émile Zola', 'Le Livre de Poche', 1885, 'Roman', 3, '#374151'], ['Les Misérables (abrégé)', 'Victor Hugo', 'Hachette', 1862, 'Roman', 3, '#1F2937'], ['L\'Étranger', 'Albert Camus', 'Gallimard', 1942, 'Roman', 4, '#0F766E'],
  ['Mathématiques Terminale C – Collection Inter Africaine', 'CIAM', 'EDICEF', 2019, 'Mathématiques', 8, '#15803D'], ['Mathématiques 3e – Majors', 'Collectif', 'Hachette Afrique', 2020, 'Mathématiques', 6, '#166534'], ['Annales du Baccalauréat C et E', 'Collectif', 'Éditions Clé', 2025, 'Mathématiques', 5, '#14532D'],
  ['Physique Terminale C et E', 'Collectif', 'Nathan Afrique', 2018, 'Physique-Chimie', 6, '#B91C1C'], ['Chimie 1ère C et D', 'Collectif', 'EDICEF', 2017, 'Physique-Chimie', 4, '#991B1B'], ['SVT Terminale D', 'Collectif', 'Hatier International', 2019, 'SVT', 5, '#4D7C0F'],
  ['Atlas du Cameroun', 'Collectif', 'Jeune Afrique', 2018, 'Histoire-Géographie', 3, '#B45309'], ['Histoire du Cameroun', 'Engelbert Mveng', 'CEPER', 1985, 'Histoire-Géographie', 2, '#78350F'], ['Le Petit Robert de la langue française', 'Le Robert', 'Le Robert', 2024, 'Dictionnaires', 3, '#DC2626'],
  ['Oxford Advanced Learner\'s Dictionary', 'Oxford', 'OUP', 2020, 'Dictionnaires', 3, '#1D4ED8'], ['Initiation à la programmation avec Python', 'Gérard Swinnen', 'Eyrolles', 2012, 'Informatique', 3, '#0369A1'], ['Le Petit Prince', 'Antoine de Saint-Exupéry', 'Gallimard', 1943, 'Jeunesse', 6, '#0EA5E9'],
  ['Kirikou et la sorcière', 'Michel Ocelot', 'Milan', 1998, 'Jeunesse', 4, '#F59E0B'], ['Philosophie Terminale – Manuel', 'Collectif', 'Hatier', 2016, 'Philosophie', 3, '#4B5563'], ['Sous l\'orage', 'Seydou Badian', 'Présence Africaine', 1957, 'Littérature africaine', 4, '#C2410C'],
  ['Le monde s\'effondre', 'Chinua Achebe', 'Présence Africaine', 1966, 'Littérature africaine', 1, '#7C2D12'], ['Petit pays', 'Gaël Faye', 'Grasset', 2016, 'Roman', 2, '#BE185D'], ['Wikimedia Commons : atlas du corps humain (numérique)', 'Collectif', 'Wikimedia', 2023, 'SVT', 1, '#16A34A']];
const books = [];
for (const [title, authors, publisher, year, category, copies, color] of BOOKS) books.push(await post('/api/school/books', { title, authors, publisher, year, category, copies, cover_color: color, location: `${category.slice(0, 3).toUpperCase()}-${1 + Math.floor(rnd() * 9)}`, language: category === 'English literature' ? 'en' : 'fr', ebook_url: title.includes('numérique') ? 'https://commons.wikimedia.org/wiki/Category:Human_anatomy' : '' }));
const readers = all.filter(() => chance(0.16));
for (const s of readers) {
  const b = pick(books);
  const l = await tryIt(() => post('/api/school/loans', { book_id: b.id, student_code: s.matricule }));
  if (!l) continue;
  const back = Math.floor(rnd() * 30);
  db.run('UPDATE school_loans SET borrowed_at = ?, due_date = ? WHERE id = ?', `${addDays(todayStr, -back)}T10:00:00.000Z`, addDays(todayStr, 14 - back), l.id);
  if (back > 20 && chance(0.6)) await tryIt(() => post(`/api/school/loans/${l.id}/return`, { paid: true }));
}
await tryIt(() => post('/api/school/loans', { book_id: books.find((b) => b.copies === 1).id, user_id: T('francais@teknons.cm') }));
const tokOf = (id) => db.get('SELECT portal_token FROM school_students WHERE id = ?', id).portal_token;
for (const s of all.slice(3, 5)) await tryIt(() => guest('POST', `/api/public/school/p/${tokOf(s.id)}/hold`, { book_id: books.find((b) => b.copies === 1).id }));

// E-learning
const tleC = classes.find((c) => c.name === 'Tle C');
await post('/api/auth/login', { email: 'prof@teknons.cm', password });
const lms1 = await post('/api/school/lms/courses', { title: 'Réussir le Bac C : suites et fonctions', subtitle: 'Cours, méthodes, quiz corrigés et devoir type Bac', description: 'Programme complet de Terminale C sur les suites numériques et l\'étude de fonctions, avec des méthodes pas à pas, des quiz corrigés automatiquement et un devoir corrigé par votre professeure.', class_id: tleC.id, category: 'Mathématiques', level: 'Terminale', published: true, certificate: true, pass_score: 60, cover_color: '#15803D' });
const L1 = [
  { title: 'Introduction : à quoi servent les suites ?', kind: 'video', video_url: 'https://www.youtube.com/watch?v=TwKpj2ISQAc', duration: 12, content: 'Intérêts composés, croissance d\'une population, remboursement d\'un prêt : les suites modélisent tout ce qui évolue par étapes.', free_preview: true },
  { title: 'Suites arithmétiques et géométriques', kind: 'text', duration: 20, content: 'Une suite arithmétique vérifie u(n+1) = u(n) + r ; son terme général est u(n) = u(0) + n·r.\nUne suite géométrique vérifie u(n+1) = q·u(n) ; son terme général est u(n) = u(0)·qⁿ.\n\nSomme des termes :\n• arithmétique : S = (nombre de termes) × (premier + dernier) / 2\n• géométrique : S = premier × (1 − q^(nombre de termes)) / (1 − q)' },
  { title: 'Quiz : reconnaître une suite', kind: 'quiz', duration: 10, quiz: [{ q: 'u(n+1) = u(n) + 5 et u(0) = 2. Que vaut u(10) ?', choices: ['50', '52', '57', '12'], answer: 1, explain: 'u(10) = 2 + 10 × 5 = 52.' }, { q: 'Une suite géométrique de raison 0,5 et de premier terme 8 est…', choices: ['croissante', 'décroissante', 'constante', 'ni l\'un ni l\'autre'], answer: 1, explain: '0 < q < 1 et u(0) > 0 : la suite décroît.' }, { q: 'La somme 1 + 2 + … + 100 vaut :', choices: ['5 000', '5 050', '10 100', '4 950'], answer: 1, explain: '100 × (1 + 100) / 2 = 5 050.' }] },
  { title: 'Limites de fonctions : méthode en 4 étapes', kind: 'pdf', video_url: 'https://www.math.univ-toulouse.fr/~jroyer/TD/2014-15-L1PS/L1PS-limites.pdf', duration: 15, content: 'Fiche méthode à télécharger et à garder dans votre classeur.' },
  { title: 'Classe en direct : correction du devoir surveillé', kind: 'live', starts_at: `${addDays(todayStr, 3)}T16:00`, duration: 60, content: 'Préparez vos questions. La salle s\'ouvre 10 minutes avant.' },
  { title: 'Devoir type Bac : étude d\'une suite récurrente', kind: 'assignment', due_date: addDays(todayStr, 6), max_score: 20, content: 'On considère u(0) = 1 et u(n+1) = (2u(n) + 3) / (u(n) + 2).\n1) Montrer que la suite est bien définie et positive.\n2) Étudier sa monotonie.\n3) Montrer qu\'elle converge et calculer sa limite.\nRédigez votre réponse ici ou collez le lien de votre copie scannée.' },
];
for (const l of L1) await post('/api/school/lms/lessons', { ...l, course_id: lms1.id });
await post('/api/auth/login', { email: 'info@teknons.cm', password });
const lms2 = await post('/api/school/lms/courses', { title: 'Initiation à la programmation avec Python', subtitle: 'Gratuit et ouvert à tous, de 12 à 99 ans', description: 'Variables, conditions, boucles et premiers jeux en Python, à votre rythme. Certificat vérifiable à la fin.', category: 'Informatique', level: 'Débutant', public: true, published: true, certificate: true, cover_color: '#0369A1' });
for (const l of [{ title: 'Installer Python et écrire son premier programme', kind: 'text', duration: 15, content: 'Téléchargez Python sur python.org ou utilisez un éditeur en ligne, puis tapez : print("Bonjour le Cameroun !")', free_preview: true },
  { title: 'Variables et conditions', kind: 'text', duration: 20, content: 'age = 15\nif age >= 18:\n    print("Majeur")\nelse:\n    print("Mineur")' },
  { title: 'Quiz : les bases', kind: 'quiz', duration: 8, quiz: [{ q: 'Que affiche print(2 + 3 * 2) ?', choices: ['10', '8', '12', '7'], answer: 1, explain: 'La multiplication passe avant l\'addition.' }, { q: 'Quel mot-clé crée une boucle ?', choices: ['if', 'for', 'def', 'print'], answer: 1 }] }]) await post('/api/school/lms/lessons', { ...l, course_id: lms2.id });
await post('/api/auth/login', { email: 'anglais@teknons.cm', password });
const lms3 = await post('/api/school/lms/courses', { title: 'Speak English with confidence', subtitle: 'Anglais oral pour francophones, niveau A2 à B1', description: '12 leçons courtes pour parler anglais au quotidien et réussir l\'oral du GCE et du Bac. Classes en direct chaque samedi.', category: 'Langues', level: 'A2-B1', price: 15000, public: true, published: true, certificate: true, cover_color: '#7C3AED' });
for (const l of [{ title: 'Greetings and introductions', kind: 'text', duration: 10, content: 'Hello! My name is… I am from Douala. Nice to meet you!', free_preview: true }, { title: 'Live speaking club', kind: 'live', starts_at: `${addDays(todayStr, 5)}T10:00`, duration: 60 }, { title: 'Quiz: everyday English', kind: 'quiz', duration: 5, quiz: [{ q: 'How do you answer « How do you do? »', choices: ['Fine, thanks', 'How do you do?', 'I do well'], answer: 1 }] }]) await post('/api/school/lms/lessons', { ...l, course_id: lms3.id });
// Pupils of Tle C working through the course
const c1 = await get(`/api/school/lms/courses/${lms1.id}`);
for (const [i, s] of tleC.students.entries()) {
  const tok = tokOf(s.id); const steps = i < 6 ? 6 : i < 16 ? 3 + Math.floor(rnd() * 3) : Math.floor(rnd() * 3);
  for (const l of c1.lessons_list.slice(0, steps)) {
    const body = l.kind === 'quiz' ? { answers: l.quiz.map((q) => (chance(s.ability / 18) ? q.answer : (q.answer + 1) % q.choices.length)) } : l.kind === 'assignment' ? { answer: 'Voir ma copie : 1) u(n) > 0 par récurrence. 2) La suite est croissante. 3) Elle converge vers √3.' } : {};
    await tryIt(() => guest('POST', `/api/public/school/p/${tok}/lms/lesson/${l.id}`, body));
  }
}
await post('/api/auth/login', { email: 'prof@teknons.cm', password });
for (const sb of (await get('/api/school/lms/submissions')).slice(0, 3)) await post('/api/school/lms/grade', { lesson_id: sb.lesson_id, student_id: sb.student_id, score: 12 + Math.floor(rnd() * 7), feedback: 'Bonne démarche. Soignez la rédaction de la récurrence.' });

// Research club and publications of the college
await post('/api/auth/login', { email, password });
const club = await post('/api/school/research', { title: 'Qualité de l\'eau du Wouri à Bonabéri', field: 'Sciences de la vie et de la Terre', lab: 'Club scientifique du collège', lead_id: T('svt@teknons.cm'), members: 'Mme Ewane et 14 élèves de 1ère D et Tle D', status: 'active', funding_source: 'APE et Fondation Orange Cameroun', budget: 850000, spent: 340000, start_date: '2026-10-01', end_date: '2027-05-30', abstract: 'Mesures de pH, turbidité et coliformes en six points du fleuve, comparaison saison sèche / saison des pluies, et campagne de sensibilisation des riverains.', milestones: [{ title: 'Protocole validé', due: '2026-10-15', done: true }, { title: 'Prélèvements saison sèche', due: '2026-12-20', done: false }, { title: 'Rapport et exposition', due: '2027-05-15', done: false }] });
await post('/api/school/publications', { kind: 'report', title: 'Rapport du club scientifique 2025-2026 : les déchets plastiques à Bonamoussadi', authors: 'Ewane, C., Ngono, G., Fotso, B., Club scientifique CBL', year: 2026, field: 'Environnement', research_id: club.id, abstract: 'Inventaire des déchets plastiques dans le quartier, propositions de tri à l\'école et bilan de la campagne « Zéro bouteille ».', keywords: 'plastique, Douala, éco-citoyenneté', public: true, file: tinyPdf('Rapport du club scientifique 2025-2026') });
await post('/api/school/publications', { kind: 'article', title: 'Utiliser le téléphone portable pour enseigner les fonctions en Terminale', authors: 'Ngo Biyong, S.', year: 2025, venue: 'Revue camerounaise de didactique des mathématiques', field: 'Didactique', abstract: 'Retour d\'expérience sur l\'usage d\'une calculatrice graphique gratuite sur téléphone dans deux classes de Terminale C.', keywords: 'didactique, mathématiques, numérique', public: true });

// =====================================================================
// 2. Institut Universitaire Les Lauréats (LMD)
// =====================================================================
console.log('University…');
const uni = createCompany(db, modules, { company: 'Institut Universitaire Les Lauréats', name: 'Pr Marie-Thérèse Abena', email: 'univ@teknons.cm', password, phone: '699112233' });
const ucid = uni.companyId;
db.run(`UPDATE companies SET legal_form = 'SA', address = 'Campus de Logbessou, PK 14', city = 'Douala', phone = '+237 699 11 22 33', email = 'scolarite@iul.cm', website = 'iul.cm', momo_number = '699 11 22 33', om_number = '655 44 33 22',
  invoice_footer = 'Institut Universitaire Les Lauréats · Arrêté MINESUP n° 18/0457 · Logbessou, Douala' WHERE id = ?`, ucid);
const UU = await addStaff(ucid, [['Dr Patrick Kemayou', 'univ.scolarite@teknons.cm', 'registrar'], ['Hortense Ebelle', 'univ.biblio@teknons.cm', 'librarian'], ['Dr Eric Fonkou', 'univ.prof@teknons.cm', 'teacher'], ['Pr Alice Ndongo', 'univ.data@teknons.cm', 'teacher'],
  ['Dr Samuel Tchakounte', 'univ.reseaux@teknons.cm', 'teacher'], ['Dr Josiane Mbouda', 'univ.finance@teknons.cm', 'teacher'], ['Dr Arnaud Essomba', 'univ.eco@teknons.cm', 'teacher'], ['Mrs Linda Fon', 'univ.english@teknons.cm', 'teacher']]);
await post('/api/auth/login', { email: 'univ@teknons.cm', password });
await put('/api/school/settings', { kind: 'university', system: 'bilingual', grading: 'lmd', ministry: 'MINESUP', principal_name: 'Pr Marie-Thérèse Abena', principal_title: 'Directrice générale', matricule_prefix: 'IUL', cc_weight: 0.4, pass_mark: 10,
  motto: 'Savoir · Innover · Servir', admissions_open: true, portal_pay: true, repository_public: true, loan_days: 21, max_loans: 5, fine_per_day: 200,
  welcome_text: 'Licences et masters en informatique, data science, finance et management, système LMD, cours bilingues et stages en entreprise. Candidatez en ligne.' });
let um = await get('/api/school/meta');
await post('/api/school/levels/preset', { preset: 'univ_lmd' });
for (const l of um.levels) await put(`/api/school/levels/${l.id}`, { active: false });
for (const s of um.subjects) await put(`/api/school/subjects/${s.id}`, { active: false });
const UFEES = { Inscription: 50000, 'Scolarité – 1re tranche': 300000, 'Scolarité – 2e tranche': 250000, 'Scolarité – 3e tranche': 200000 };
for (const f of um.fee_items) await put(`/api/school/fees/items/${f.id}`, UFEES[f.name] ? { amount: UFEES[f.name] } : { active: false });
await post('/api/school/fees/items', { name: 'Assurance et carte étudiant', kind: 'other', amount: 15000, due_date: `${todayStr.slice(0, 4)}-10-15`, account_code: '7068', position: 5 });
um = await get('/api/school/meta');
const ulvl = Object.fromEntries(um.levels.map((l) => [l.name, l.id]));
const USUB = [['Algorithmique et programmation', 'Algorithms & programming', 'ALGO', 'core', '#15803D'], ['Mathématiques discrètes', 'Discrete mathematics', 'MDIS', 'core', '#0E7490'], ['Architecture des ordinateurs', 'Computer architecture', 'ARCH', 'core', '#7C3AED'],
  ['Bases de données', 'Databases', 'BDD', 'core', '#2563EB'], ['Réseaux informatiques', 'Computer networks', 'RES', 'core', '#DC2626'], ['Génie logiciel', 'Software engineering', 'GL', 'core', '#EA580C'], ['Développement web et mobile', 'Web & mobile development', 'WEB', 'core', '#0891B2'],
  ['Apprentissage automatique', 'Machine learning', 'ML', 'core', '#9333EA'], ['Statistique inférentielle', 'Inferential statistics', 'STAT', 'core', '#B45309'], ['Big data et cloud', 'Big data & cloud', 'BIG', 'elective', '#0369A1'],
  ['Finance d\'entreprise', 'Corporate finance', 'FIN', 'core', '#166534'], ['Marchés financiers', 'Financial markets', 'MKT', 'core', '#4D7C0F'], ['Comptabilité OHADA approfondie', 'Advanced OHADA accounting', 'CPT', 'core', '#A16207'], ['Économétrie', 'Econometrics', 'ECO', 'core', '#BE185D'],
  ['Anglais scientifique', 'Scientific English', 'ANGS', 'elective', '#6D28D9'], ['Méthodologie de la recherche', 'Research methods', 'METH', 'elective', '#4B5563'], ['Entrepreneuriat', 'Entrepreneurship', 'ENT', 'elective', '#C2410C']];
const us = {}; for (const [name, name_en, code, grp, color] of USUB) us[code] = (await post('/api/school/subjects', { name, name_en, code, grp, color })).id;
const t = (k) => UU[k];
const COHORTS = [
  ['Licence 1', 'L1 Informatique', 'univ.prof@teknons.cm', 'Amphi A', 2007, 26, [['ALGO', 6, 1, 'univ.prof@teknons.cm'], ['MDIS', 5, 1, 'univ.data@teknons.cm'], ['ARCH', 4, 1, 'univ.reseaux@teknons.cm'], ['ANGS', 2, 1, 'univ.english@teknons.cm'], ['BDD', 6, 2, 'univ.prof@teknons.cm'], ['WEB', 5, 2, 'univ.prof@teknons.cm'], ['STAT', 4, 2, 'univ.data@teknons.cm'], ['ENT', 2, 2, 'univ.finance@teknons.cm']]],
  ['Licence 3', 'L3 Génie logiciel', 'univ.reseaux@teknons.cm', 'Salle B12', 2005, 22, [['GL', 6, 1, 'univ.prof@teknons.cm'], ['RES', 5, 1, 'univ.reseaux@teknons.cm'], ['WEB', 5, 1, 'univ.prof@teknons.cm'], ['METH', 2, 1, 'univ.data@teknons.cm'], ['BDD', 5, 2, 'univ.prof@teknons.cm'], ['ML', 5, 2, 'univ.data@teknons.cm'], ['ENT', 3, 2, 'univ.finance@teknons.cm']]],
  ['Master 1', 'M1 Data Science', 'univ.data@teknons.cm', 'Lab Data', 2003, 16, [['ML', 6, 1, 'univ.data@teknons.cm'], ['STAT', 6, 1, 'univ.data@teknons.cm'], ['BIG', 5, 1, 'univ.reseaux@teknons.cm'], ['ANGS', 2, 1, 'univ.english@teknons.cm'], ['METH', 3, 2, 'univ.data@teknons.cm'], ['ECO', 5, 2, 'univ.eco@teknons.cm']]],
  ['Master 2', 'M2 Finance et banque', 'univ.finance@teknons.cm', 'Salle C3', 2002, 14, [['FIN', 6, 1, 'univ.finance@teknons.cm'], ['MKT', 6, 1, 'univ.finance@teknons.cm'], ['CPT', 5, 1, 'univ.eco@teknons.cm'], ['ECO', 5, 1, 'univ.eco@teknons.cm'], ['METH', 3, 2, 'univ.data@teknons.cm']]],
];
const UDIFF = { ALGO: -0.6, MDIS: -1, ARCH: 0, BDD: 0.2, RES: -0.3, GL: 0.4, WEB: 0.8, ML: -0.8, STAT: -0.9, BIG: 0.2, FIN: -0.4, MKT: -0.2, CPT: 0, ECO: -1, ANGS: 1, METH: 1.2, ENT: 1.5 };
const cohorts = []; const ufam = []; const uall = [];
for (const [level, name, head, room, by, n, units] of COHORTS) {
  const c = await post('/api/school/classes', { level_id: ulvl[level], name, room, capacity: 60, head_teacher_id: t(head), copy_courses: false });
  let k = 1;
  for (const [code, credits, semester, teacher] of units) await post('/api/school/courses', { class_id: c.id, subject_id: us[code], teacher_id: t(teacher), coef: credits, hours: Math.max(2, Math.round(credits * 0.8)), semester, code: `${code}${level.includes('Master') ? 4 : level.slice(-1)}${semester}${k++}` });
  c.courses = await get(`/api/school/courses?class_id=${c.id}`);
  c.students = await fillClass(c, n, { birthYear: by, families: ufam });
  for (const s of c.students) s.ability = clamp(s.ability - 0.4, 4, 18.5);
  cohorts.push(c); uall.push(...c.students);
}
backdate(ucid, um.year.start_date);
await payFees(uall, 'univ');
// Semester 1: continuous assessment and exam, resit for those who failed; council held.
for (const c of cohorts) {
  for (const co of c.courses.filter((x) => x.semester === 1)) {
    const code = co.subject_code;
    const mk = (s, extra = 0) => clamp(q4(s.ability + (UDIFF[code] || 0) + gauss() * 2 + extra), 0, 20);
    const cc = Object.fromEntries(c.students.map((s) => [s.id, mk(s, 0.6)]));
    const ex = Object.fromEntries(c.students.map((s) => [s.id, mk(s, -0.3)]));
    await post('/api/school/marks', { course_id: co.id, sequence: 1, marks: c.students.map((s) => ({ student_id: s.id, mark: cc[s.id] })) });
    await post('/api/school/marks', { course_id: co.id, sequence: 2, marks: c.students.map((s) => ({ student_id: s.id, mark: ex[s.id], absent: false })) });
    const fails = c.students.filter((s) => cc[s.id] * 0.4 + ex[s.id] * 0.6 < 10);
    if (fails.length) await post('/api/school/marks', { course_id: co.id, sequence: 3, marks: fails.map((s) => ({ student_id: s.id, mark: clamp(q4(ex[s.id] + rnd() * 3.5), 0, 20) })) });
  }
  // Semester 2 has started: first continuous-assessment marks.
  for (const co of c.courses.filter((x) => x.semester === 2).slice(0, 2)) await post('/api/school/marks', { course_id: co.id, sequence: 4, marks: c.students.map((s) => ({ student_id: s.id, mark: clamp(q4(s.ability + (UDIFF[co.subject_code] || 0) + gauss() * 2), 0, 20) })) });
  await post('/api/school/council', { class_id: c.id, period: 'sem1', decisions: [] });
}
// Timetable
for (const c of cohorts) {
  const queue = c.courses.filter((x) => x.semester === 2 || x.semester === 1).flatMap((co) => Array.from({ length: Math.max(1, Math.round(co.hours / 2)) }, () => co)).sort(() => rnd() - 0.5);
  for (let day = 1; day <= 6 && queue.length; day++) for (const [start, end] of [['08:00', '10:00'], ['10:15', '12:15'], ['13:30', '15:30'], ['15:45', '17:45']]) {
    for (let k = 0; k < queue.length; k++) { const ok = await tryIt(() => post('/api/school/timetable', { course_id: queue[k].id, day, start, end })); if (ok) { queue.splice(k, 1); break; } }
  }
}
// Research projects, publications and theses
const P1 = await post('/api/school/research', { title: 'Détection précoce du paludisme par apprentissage automatique sur frottis sanguins', field: 'Intelligence artificielle', lab: 'Laboratoire Data & Santé (LDS)', lead_id: t('univ.data@teknons.cm'), members: 'Pr Ndongo, Dr Fonkou, 3 doctorants, Hôpital Laquintinie', status: 'active', funding_source: 'AUF et ministère de la Santé publique', budget: 18500000, spent: 7200000, start_date: '2025-11-01', end_date: '2027-10-31',
  abstract: 'Constitution d\'un jeu de 40 000 images annotées de frottis, entraînement d\'un réseau de neurones embarqué sur smartphone et validation clinique dans trois hôpitaux du Littoral.', milestones: [{ title: 'Jeu de données annoté', due: '2026-04-30', done: true }, { title: 'Modèle v1 (précision > 92 %)', due: '2026-09-30', done: true }, { title: 'Essai clinique', due: '2027-04-30', done: false }, { title: 'Application mobile publique', due: '2027-09-30', done: false }] });
const P2 = await post('/api/school/research', { title: 'Inclusion financière et Mobile Money dans les PME de Douala', field: 'Finance', lab: 'Centre de recherche en économie et finance (CREF)', lead_id: t('univ.finance@teknons.cm'), members: 'Dr Mbouda, Dr Essomba, 6 étudiants de M2', status: 'active', funding_source: 'Fonds propres IUL', budget: 6500000, spent: 2900000, start_date: '2026-02-01', end_date: '2027-06-30',
  abstract: 'Enquête auprès de 600 PME sur l\'usage de MTN MoMo et Orange Money pour les paiements fournisseurs, l\'épargne et le crédit, et effet sur la croissance du chiffre d\'affaires.', milestones: [{ title: 'Questionnaire validé', due: '2026-03-15', done: true }, { title: 'Collecte terrain', due: '2026-12-15', done: false }] });
await post('/api/school/research', { title: 'Réseaux maillés à bas coût pour les campus en zone de coupures', field: 'Réseaux', lab: 'Laboratoire réseaux et systèmes', lead_id: t('univ.reseaux@teknons.cm'), status: 'proposal', funding_source: 'Appel à projets AUF 2027', budget: 9000000, abstract: 'Routeurs solaires et protocole de synchronisation hors ligne pour garder l\'intranet du campus actif pendant les délestages.' });
const PUBS = [['article', 'Lightweight convolutional networks for malaria parasite detection on smartphone-captured blood smears', 'Ndongo, A., Fonkou, E., Tagne, L.', 2026, 'African Journal of Computing & ICT', 'Intelligence artificielle', P1.id, true],
  ['conference', 'Un jeu de données ouvert de frottis sanguins annotés au Cameroun', 'Fonkou, E., Ndongo, A.', 2026, 'Colloque CARI 2026, Yaoundé', 'Intelligence artificielle', P1.id, true],
  ['dataset', 'MALARIA-CM-40K : images de frottis annotées (version 1)', 'Laboratoire Data & Santé', 2026, 'Dépôt IUL', 'Intelligence artificielle', P1.id, false],
  ['article', 'Mobile Money et accès au crédit des PME : premiers résultats d\'enquête à Douala', 'Mbouda, J., Essomba, A.', 2026, 'Revue d\'économie et de gestion d\'Afrique centrale', 'Finance', P2.id, true],
  ['chapter', 'La comptabilité OHADA face à la numérisation des paiements', 'Essomba, A.', 2025, 'Mélanges en l\'honneur du Pr Kamdem, Presses universitaires de Douala', 'Comptabilité', null, false],
  ['dissertation', 'Conception d\'une plateforme de télémédecine hors ligne pour les districts ruraux', 'Kouam, B. (dir. Fonkou, E.)', 2026, 'Mémoire de Master, IUL', 'Génie logiciel', null, true],
  ['dissertation', 'Prévision de la demande d\'électricité à Douala par réseaux récurrents', 'Ngassa, I. (dir. Ndongo, A.)', 2026, 'Mémoire de Master, IUL', 'Data science', null, true],
  ['report', 'Rapport annuel de la recherche 2025-2026', 'Direction de la recherche, IUL', 2026, 'IUL', 'Institution', null, true],
  ['poster', 'Routeurs solaires et réseaux maillés : prototype de campus résilient', 'Tchakounte, S.', 2026, 'Journées scientifiques de l\'IUL', 'Réseaux', null, false]];
for (const [kind, title, authors, year, venue, field, rid, pdf] of PUBS) {
  const p = await post('/api/school/publications', { kind, title, authors, year, venue, field, research_id: rid, public: true, status: 'published', keywords: field.toLowerCase(), abstract: `${title}. Résumé : objectifs, méthode, principaux résultats et perspectives. Travail mené à l'Institut Universitaire Les Lauréats, Douala.`, ...(pdf ? { file: tinyPdf(title) } : {}) });
  db.run('UPDATE school_publications SET views = ?, downloads = ? WHERE id = ?', 20 + Math.floor(rnd() * 600), pdf ? 5 + Math.floor(rnd() * 180) : 0, p.id);
}
const m1 = cohorts.find((c) => c.name.startsWith('M1')).students, m2 = cohorts.find((c) => c.name.startsWith('M2')).students, l3 = cohorts.find((c) => c.name.startsWith('L3')).students;
const THESES = [[m2[0], 'Impact du Mobile Money sur la gestion de trésorerie des PME camerounaises', 'master', 'univ.finance@teknons.cm', 'defense', addDays(todayStr, 12)], [m2[1], 'Risque de crédit et scoring alternatif par les données de téléphonie', 'master', 'univ.finance@teknons.cm', 'writing', ''],
  [m2[2], 'Normes OHADA et cryptoactifs : quel traitement comptable ?', 'master', 'univ.eco@teknons.cm', 'submitted', ''], [m1[0], 'Détection de fraude sur les transactions Mobile Money', 'master', 'univ.data@teknons.cm', 'proposal', ''],
  [m1[1], 'Traduction automatique français-ewondo par réseaux de neurones', 'master', 'univ.data@teknons.cm', 'writing', ''], [l3[0], 'Application de gestion de cantine scolaire avec paiement MoMo', 'licence', 'univ.prof@teknons.cm', 'defended', addDays(todayStr, -20)]];
for (const [s, title, level, sup, stage, date] of THESES) await post('/api/school/theses', { student_id: s.id, title, level, supervisor_id: t(sup), stage, defense_date: date, jury: stage === 'defense' || stage === 'defended' ? 'Pr Ndongo (présidente), Dr Mbouda, Dr Essomba' : '', grade: stage === 'defended' ? 15.5 : '' });
// Library and online courses
for (const [title, authors, publisher, year, category, copies, color] of [['Introduction à l\'algorithmique', 'T. Cormen et al.', 'Dunod', 2010, 'Informatique', 6, '#15803D'], ['Deep Learning', 'I. Goodfellow, Y. Bengio, A. Courville', 'MIT Press', 2016, 'Informatique', 3, '#111827'],
  ['Bases de données relationnelles', 'G. Gardarin', 'Eyrolles', 2003, 'Informatique', 4, '#2563EB'], ['Réseaux', 'A. Tanenbaum', 'Pearson', 2011, 'Informatique', 4, '#DC2626'], ['Finance d\'entreprise', 'J. Berk, P. DeMarzo', 'Pearson', 2020, 'Finance', 5, '#166534'],
  ['Acte uniforme OHADA relatif au droit comptable', 'OHADA', 'OHADA', 2017, 'Comptabilité', 6, '#A16207'], ['Économétrie', 'R. Bourbonnais', 'Dunod', 2021, 'Économie', 3, '#BE185D'], ['The Elements of Statistical Learning', 'T. Hastie et al.', 'Springer', 2009, 'Statistique', 2, '#B45309'],
  ['Méthodologie de la recherche en sciences de gestion', 'Collectif', 'Pearson', 2018, 'Méthodologie', 4, '#4B5563'], ['Clean Code', 'R. C. Martin', 'Prentice Hall', 2008, 'Informatique', 3, '#0369A1']]) {
  const b = await post('/api/school/books', { title, authors, publisher, year, category, copies, cover_color: color, location: `U-${category.slice(0, 3).toUpperCase()}` });
  for (let i = 0; i < Math.min(copies - 1, 2); i++) await tryIt(() => post('/api/school/loans', { book_id: b.id, student_code: pick(uall).matricule }));
}
await post('/api/auth/login', { email: 'univ.data@teknons.cm', password });
const dsc = await post('/api/school/lms/courses', { title: 'Data science avec Python', subtitle: 'Certificat professionnel en 8 semaines', description: 'Pandas, visualisation, statistiques et premiers modèles de machine learning sur des données camerounaises réelles. Projet final corrigé et certificat vérifiable.', category: 'Data science', level: 'Intermédiaire', price: 45000, public: true, published: true, certificate: true, cover_color: '#9333EA' });
for (const l of [{ title: 'Bienvenue et installation de Jupyter', kind: 'video', video_url: 'https://www.youtube.com/watch?v=HW29067qVWk', duration: 14, free_preview: true }, { title: 'Pandas : lire et nettoyer un fichier', kind: 'text', duration: 35, content: 'import pandas as pd\ndf = pd.read_csv("ventes_douala.csv")\ndf.describe()' },
  { title: 'Quiz : manipuler un DataFrame', kind: 'quiz', duration: 10, quiz: [{ q: 'Quelle méthode affiche les 5 premières lignes ?', choices: ['df.top()', 'df.head()', 'df.first()', 'df.show()'], answer: 1 }, { q: 'Pour filtrer les ventes > 10 000 :', choices: ['df[df.ventes > 10000]', 'df.filter(10000)', 'df.where(ventes>10000)'], answer: 0 }] },
  { title: 'Projet : prévoir les ventes d\'une boutique', kind: 'assignment', duration: 120, max_score: 20, due_date: addDays(todayStr, 20), content: 'Déposez le lien de votre notebook.' }, { title: 'Session live : questions-réponses', kind: 'live', duration: 60, starts_at: `${addDays(todayStr, 2)}T18:00` }]) await post('/api/school/lms/lessons', { ...l, course_id: dsc.id });
await post('/api/auth/login', { email: 'univ.finance@teknons.cm', password });
const xl = await post('/api/school/lms/courses', { title: 'Excel pour la finance et la comptabilité', subtitle: 'Tableaux de bord, TCD et modèles financiers', category: 'Finance', level: 'Tous niveaux', price: 20000, public: true, published: true, certificate: true, cover_color: '#166534', description: 'Maîtrisez Excel pour piloter une PME : tableaux croisés, prévisions de trésorerie, amortissements et tableaux de bord.' });
for (const l of [{ title: 'Les formules indispensables', kind: 'text', duration: 25, free_preview: true, content: 'SOMME.SI, RECHERCHEX, INDEX/EQUIV, SI imbriqués.' }, { title: 'Quiz : formules', kind: 'quiz', duration: 6, quiz: [{ q: 'Quelle fonction remplace RECHERCHEV ?', choices: ['RECHERCHEX', 'TROUVE', 'CHERCHE'], answer: 0 }] }]) await post('/api/school/lms/lessons', { ...l, course_id: xl.id });
await post('/api/auth/login', { email: 'univ@teknons.cm', password });
await post('/api/school/announcements', { title: 'Résultats du semestre 1 publiés', body: 'Les relevés de notes du semestre 1 sont disponibles sur votre espace étudiant. Les demandes de révision sont reçues à la scolarité pendant 7 jours.', pinned: true });
await post('/api/school/announcements', { title: 'Soutenances de master', body: 'Les soutenances de M2 Finance se tiennent en salle C3. Calendrier détaillé à la scolarité.' });

// Showcase pupil for the parents' portal
const star = tleC.students.slice().sort((a, b) => b.ability - a.ability)[2];
db.run('UPDATE school_students SET allergies = ? WHERE id = ?', '', star.id);
console.log('\nDemo ready.');
console.log('  Secondary school: demo@teknons.cm / demo1234 (also directeur@, secretariat@, econome@, surveillant@, biblio@, compta@, prof@ …)');
console.log('  University:       univ@teknons.cm / demo1234 (also univ.prof@, univ.data@, univ.scolarite@ …)');
console.log(`  Parents' portal:  /p/${tokOf(star.id)}`);
console.log('  Public pages:     /admission  /learn  /research');
app.server.close();
process.exit(0);
