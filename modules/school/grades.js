// Assessments and results. Two grading systems share the same tables:
//   sequences: secondary school, marks /20 per sequence (6 sequences = 3 terms),
//     coefficients, term and annual averages, ranks, class council distinctions.
//   lmd: university (Licence-Master-Doctorat): per semester a continuous
//     assessment (CC), an exam and a resit; credits, letter grades and GPA.
// Every individual test (quiz, homework, practical, exam...) has its own record;
// the sequence mark is computed from them, or typed directly.
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, num, oneOf, date as vDate } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { audit } from '../../core/alerts.js';
import { settingsOf, activeYear, shortCode } from './schema.js';
import { absenceTotals } from './students.js';

export const MANAGERS = ['owner', 'admin', 'manager'];
export const ASSESS_KINDS = {
  quiz: ['Interrogation', 'Quiz'], test: ['Devoir surveillé', 'Test'], homework: ['Devoir maison', 'Homework'], practical: ['Travaux pratiques', 'Practical'], oral: ['Oral', 'Oral'],
  project: ['Projet / exposé', 'Project'], exam: ['Composition / examen', 'Exam'], mock: ['Examen blanc', 'Mock exam'], resit: ['Rattrapage', 'Resit'],
};
export const DISTINCTIONS = { congrats: ['Félicitations', 'Congratulations'], encourage: ['Encouragements', 'Encouragement'], honour: ["Tableau d'honneur", 'Honour roll'], warning: ['Avertissement travail', 'Academic warning'], blame: ['Blâme travail', 'Academic reprimand'] };

/** Slots (sequence numbers) and labels of each period for the school's grading system. */
export function periods(s) {
  if (s.grading === 'lmd') {
    return [
      { id: 'sem1', fr: 'Semestre 1', en: 'Semester 1', seqs: [1, 2, 3], semester: 1 }, { id: 'sem2', fr: 'Semestre 2', en: 'Semester 2', seqs: [4, 5, 6], semester: 2 },
      { id: 'year', fr: 'Année', en: 'Year', seqs: [1, 2, 3, 4, 5, 6] },
    ];
  }
  const n = s.sequences || 6; const per = Math.max(1, Math.round(n / 3));
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ id: `s${i}`, fr: n === 3 ? `Trimestre ${i}` : `Séquence ${i}`, en: n === 3 ? `Term ${i}` : `Sequence ${i}`, seqs: [i] });
  if (n !== 3) for (let t = 1; t <= 3; t++) out.push({ id: `t${t}`, fr: `Trimestre ${t}`, en: `Term ${t}`, seqs: Array.from({ length: per }, (_, k) => (t - 1) * per + k + 1) });
  out.push({ id: 'year', fr: 'Année', en: 'Year', seqs: Array.from({ length: n }, (_, k) => k + 1) });
  return out;
}
export const slotLabel = (s, seq) => (s.grading === 'lmd' ? `${['CC', 'Examen', 'Rattrapage'][(seq - 1) % 3]} S${seq <= 3 ? 1 : 2}` : (s.sequences === 3 ? `Trimestre ${seq}` : `Séquence ${seq}`));
const periodOf = (s, id) => { const p = periods(s).find((x) => x.id === id); if (!p) throw bad('period', 'Période inconnue'); return p; };

export function courseFor(db, ctx, courseId, { write = false } = {}) {
  const c = db.get(`SELECT co.*, sub.name subject, sub.name_en subject_en, cl.name class_name, cl.year_id, u.name teacher_name FROM school_courses co JOIN school_subjects sub ON sub.id = co.subject_id
    JOIN school_classes cl ON cl.id = co.class_id LEFT JOIN users u ON u.id = co.teacher_id WHERE co.id = ? AND co.company_id = ?`, courseId, ctx.user.company_id);
  if (!c) throw notFound('Cours introuvable');
  if (write && !MANAGERS.includes(ctx.user.role) && c.teacher_id !== ctx.user.id) throw forbidden(`Seul l'enseignant de ${c.subject} en ${c.class_name} ou la direction peut saisir ces notes`);
  return c;
}
const isLocked = (db, classId, seq) => !!db.get('SELECT 1 FROM school_locks WHERE class_id = ? AND sequence = ?', classId, seq);
function assertOpen(db, ctx, c, seq) {
  if (isLocked(db, c.class_id, seq) && !MANAGERS.includes(ctx.user.role)) throw conflict('locked', 'Ces notes sont verrouillées après le conseil de classe. Demandez à la direction.');
}
const students = (db, classId) => db.all("SELECT s.id, s.matricule, s.last_name, s.first_name, s.sex, s.birth_date FROM school_enrollments e JOIN school_students s ON s.id = e.student_id WHERE e.class_id = ? AND e.status = 'enrolled' ORDER BY s.last_name, s.first_name", classId);

// ---------------- Marks (sheet per course and slot) ----------------
export function markSheet(db, ctx, courseId, seq) {
  const c = courseFor(db, ctx, courseId);
  const s = settingsOf(db, ctx.user.company_id);
  const marks = Object.fromEntries(db.all('SELECT * FROM school_marks WHERE course_id = ? AND sequence = ?', c.id, seq).map((m) => [m.student_id, m]));
  const assessments = db.all('SELECT a.*, (SELECT COUNT(*) FROM school_scores x WHERE x.assessment_id = a.id AND (x.score IS NOT NULL OR x.absent = 1)) filled FROM school_assessments a WHERE a.course_id = ? AND a.sequence = ? ORDER BY a.date, a.id', c.id, seq);
  const list = students(db, c.class_id).map((st) => ({ ...st, mark: marks[st.id]?.mark ?? null, absent: marks[st.id]?.absent || 0, remark: marks[st.id]?.remark || '' }));
  const vals = list.filter((x) => x.mark != null).map((x) => x.mark);
  return { course: c, sequence: seq, label: slotLabel(s, seq), locked: isLocked(db, c.class_id, seq), assessments, students: list, derived: assessments.length > 0,
    stats: { n: vals.length, avg: vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null, max: vals.length ? Math.max(...vals) : null, min: vals.length ? Math.min(...vals) : null, pass: vals.filter((v) => v >= s.pass_mark).length } };
}

export function saveMarks(db, bus, ctx, b) {
  const c = courseFor(db, ctx, b.course_id, { write: true });
  const seq = Number(b.sequence); if (!(seq >= 1 && seq <= 6)) throw bad('sequence', 'Séquence invalide');
  assertOpen(db, ctx, c, seq);
  const ids = new Set(students(db, c.class_id).map((x) => x.id));
  let n = 0;
  db.tx(() => {
    for (const m of Array.isArray(b.marks) ? b.marks : []) {
      if (!ids.has(Number(m.student_id))) continue;
      const mark = m.mark === '' || m.mark == null ? null : num(String(m.mark).replace(',', '.'), 'mark', { min: 0 });
      if (mark != null && mark > 20) throw bad('mark', 'Une note est sur 20');
      db.run(`INSERT INTO school_marks (company_id, course_id, student_id, sequence, mark, absent, remark, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(course_id, student_id, sequence) DO UPDATE SET mark = excluded.mark, absent = excluded.absent, remark = excluded.remark, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      ctx.user.company_id, c.id, Number(m.student_id), seq, mark, m.absent ? 1 : 0, str(m.remark, 200), ctx.user.id, now());
      n++;
    }
  });
  audit(db, ctx, 'marks', 'school_course', c.id, `${c.subject} ${c.class_name} seq ${seq}: ${n}`);
  bus?.emit(ctx.user.company_id, 'change', { entity: 'school_marks', id: c.id });
  return markSheet(db, ctx, c.id, seq);
}

// ---------------- Assessments (individual tests and exams) ----------------
export function saveAssessment(db, bus, ctx, b, id = null) {
  const cur = id ? db.get('SELECT * FROM school_assessments WHERE id = ? AND company_id = ?', id, ctx.user.company_id) : null;
  if (id && !cur) throw notFound();
  const c = courseFor(db, ctx, cur?.course_id ?? b.course_id, { write: true });
  const seq = Number(b.sequence ?? cur?.sequence); if (!(seq >= 1 && seq <= 6)) throw bad('sequence', 'Séquence invalide');
  assertOpen(db, ctx, c, seq);
  const title = str(b.title ?? cur?.title, 120); if (!title) throw bad('title', "Donnez un titre à l'évaluation");
  const v = [seq, title, oneOf(b.kind ?? cur?.kind, Object.keys(ASSESS_KINDS), 'kind', 'test'), vDate(b.date ?? cur?.date, 'date', today()), num(b.max ?? cur?.max, 'max', { min: 1, def: 20 }), num(b.weight ?? cur?.weight, 'weight', { min: 0, def: 1 })];
  if (cur) db.run('UPDATE school_assessments SET sequence = ?, title = ?, kind = ?, date = ?, max = ?, weight = ? WHERE id = ?', ...v, cur.id);
  else id = Number(db.run('INSERT INTO school_assessments (company_id, course_id, sequence, title, kind, date, max, weight, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.user.company_id, c.id, ...v, ctx.user.id, now()).lastInsertRowid);
  if (Array.isArray(b.scores)) saveScores(db, bus, ctx, id, b.scores);
  else recomputeFromAssessments(db, ctx, c.id, seq);
  bus?.emit(ctx.user.company_id, 'change', { entity: 'school_marks', id: c.id });
  return assessment(db, ctx, id);
}

export function assessment(db, ctx, id) {
  const a = db.get('SELECT * FROM school_assessments WHERE id = ? AND company_id = ?', id, ctx.user.company_id); if (!a) throw notFound();
  const c = courseFor(db, ctx, a.course_id);
  const sc = Object.fromEntries(db.all('SELECT * FROM school_scores WHERE assessment_id = ?', id).map((x) => [x.student_id, x]));
  const list = students(db, c.class_id).map((st) => ({ ...st, score: sc[st.id]?.score ?? null, absent: sc[st.id]?.absent || 0, comment: sc[st.id]?.comment || '' }));
  const vals = list.filter((x) => x.score != null).map((x) => x.score);
  return { ...a, course: c, students: list, stats: { n: vals.length, avg: vals.length ? round2(vals.reduce((p, q) => p + q, 0) / vals.length) : null, max: vals.length ? Math.max(...vals) : null, min: vals.length ? Math.min(...vals) : null } };
}

export function saveScores(db, bus, ctx, id, scores) {
  const a = db.get('SELECT * FROM school_assessments WHERE id = ? AND company_id = ?', id, ctx.user.company_id); if (!a) throw notFound();
  const c = courseFor(db, ctx, a.course_id, { write: true });
  assertOpen(db, ctx, c, a.sequence);
  const ids = new Set(students(db, c.class_id).map((x) => x.id));
  db.tx(() => {
    for (const x of scores) {
      if (!ids.has(Number(x.student_id))) continue;
      const score = x.score === '' || x.score == null ? null : num(String(x.score).replace(',', '.'), 'score', { min: 0 });
      if (score != null && score > a.max) throw bad('score', `Une note dépasse le barème (/${a.max})`);
      db.run(`INSERT INTO school_scores (assessment_id, student_id, score, absent, comment) VALUES (?,?,?,?,?)
        ON CONFLICT(assessment_id, student_id) DO UPDATE SET score = excluded.score, absent = excluded.absent, comment = excluded.comment`, a.id, Number(x.student_id), score, x.absent ? 1 : 0, str(x.comment, 200));
    }
    recomputeFromAssessments(db, ctx, c.id, a.sequence);
  });
  bus?.emit(ctx.user.company_id, 'change', { entity: 'school_marks', id: c.id });
  return assessment(db, ctx, a.id);
}

export function deleteAssessment(db, ctx, id) {
  const a = db.get('SELECT * FROM school_assessments WHERE id = ? AND company_id = ?', id, ctx.user.company_id); if (!a) throw notFound();
  const c = courseFor(db, ctx, a.course_id, { write: true });
  assertOpen(db, ctx, c, a.sequence);
  db.tx(() => { db.run('DELETE FROM school_scores WHERE assessment_id = ?', id); db.run('DELETE FROM school_assessments WHERE id = ?', id); recomputeFromAssessments(db, ctx, c.id, a.sequence); });
  return { ok: true };
}

/** Sequence mark = weighted mean of the student's assessments of that sequence, brought to /20. */
function recomputeFromAssessments(db, ctx, courseId, seq) {
  const list = db.all('SELECT * FROM school_assessments WHERE course_id = ? AND sequence = ?', courseId, seq);
  if (!list.length) return;
  const c = db.get('SELECT class_id FROM school_courses WHERE id = ?', courseId);
  for (const st of students(db, c.class_id)) {
    let w = 0, t = 0, absentAll = true;
    for (const a of list) {
      const x = db.get('SELECT * FROM school_scores WHERE assessment_id = ? AND student_id = ?', a.id, st.id);
      if (!x || (x.score == null && !x.absent)) continue;
      absentAll = absentAll && !!x.absent;
      t += ((x.absent ? 0 : x.score) / a.max) * 20 * a.weight; w += a.weight;
    }
    const mark = w ? round2(t / w) : null;
    db.run(`INSERT INTO school_marks (company_id, course_id, student_id, sequence, mark, absent, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(course_id, student_id, sequence) DO UPDATE SET mark = excluded.mark, absent = excluded.absent, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ctx.user.company_id, courseId, st.id, seq, mark, w && absentAll ? 1 : 0, ctx.user.id, now());
  }
}

// ---------------- Results ----------------
export const round2 = (v) => Math.round(v * 100) / 100;
const LETTERS = [[16, 'A', 4], [15, 'A-', 3.7], [14, 'B+', 3.3], [13, 'B', 3], [12, 'B-', 2.7], [11, 'C+', 2.3], [10, 'C', 2], [9, 'C-', 1.7], [8, 'D+', 1.3], [7, 'D', 1], [0, 'F', 0]];
export const letter = (avg) => { const l = LETTERS.find(([m]) => avg >= m); return { grade: l[1], gp: l[2] }; };
export const appreciation = (v) => (v == null ? '' : v >= 18 ? 'Excellent' : v >= 16 ? 'Très bien' : v >= 14 ? 'Bien' : v >= 12 ? 'Assez bien' : v >= 10 ? 'Passable' : v >= 8 ? 'Insuffisant' : v >= 5 ? 'Faible' : 'Très faible');
export const appreciationEn = (v) => (v == null ? '' : v >= 18 ? 'Excellent' : v >= 16 ? 'Very good' : v >= 14 ? 'Good' : v >= 12 ? 'Fairly good' : v >= 10 ? 'Average' : v >= 8 ? 'Below average' : v >= 5 ? 'Weak' : 'Very weak');

function rankOf(list, key, out) {
  const sorted = list.filter((x) => x[key] != null).sort((a, b) => b[key] - a[key]);
  sorted.forEach((x, i) => { x[out] = i > 0 && sorted[i - 1][key] === x[key] ? sorted[i - 1][out] : i + 1; });
}

export function suggestDistinction(s, avg, conductBad = false) {
  if (avg == null) return '';
  if (avg >= s.congrats_mark && !conductBad) return 'congrats';
  if (avg >= s.encourage_mark && !conductBad) return 'encourage';
  if (avg >= s.honour_mark && !conductBad) return 'honour';
  if (avg < s.warning_mark - 2) return 'blame';
  if (avg < s.warning_mark) return 'warning';
  return '';
}

/** Results of a class for a period: per-course averages, general average, ranks, stats. */
export function classResults(db, companyId, classId, periodId) {
  const s = settingsOf(db, companyId);
  const cl = db.get('SELECT c.*, l.name level_name, l.exam, y.name year_name, y.start_date, y.end_date, u.name head_teacher FROM school_classes c JOIN school_levels l ON l.id = c.level_id JOIN school_years y ON y.id = c.year_id LEFT JOIN users u ON u.id = c.head_teacher_id WHERE c.id = ? AND c.company_id = ?', classId, companyId);
  if (!cl) throw notFound('Classe introuvable');
  const p = periodOf(s, periodId);
  const lmd = s.grading === 'lmd';
  let courses = db.all(`SELECT co.id, co.coef, co.semester, co.code, sub.name subject, sub.name_en subject_en, sub.grp, u.name teacher FROM school_courses co JOIN school_subjects sub ON sub.id = co.subject_id
    LEFT JOIN users u ON u.id = co.teacher_id WHERE co.class_id = ? ORDER BY sub.grp, sub.name`, classId);
  if (lmd && p.semester) courses = courses.filter((c) => !c.semester || c.semester === p.semester);
  const list = students(db, classId);
  const marks = db.all(`SELECT m.* FROM school_marks m JOIN school_courses co ON co.id = m.course_id WHERE co.class_id = ? AND m.sequence IN (${p.seqs.join(',')})`, classId);
  const M = new Map(); for (const m of marks) M.set(`${m.student_id}:${m.course_id}:${m.sequence}`, m);
  const val = (st, co, q) => { const m = M.get(`${st}:${co}:${q}`); return m ? (m.absent && m.mark == null ? 0 : m.mark) : null; };
  const council = Object.fromEntries(db.all('SELECT * FROM school_council WHERE class_id = ? AND period = ?', classId, periodId).map((r) => [r.student_id, r]));
  const rows = list.map((st) => {
    const r = { ...st, name: `${st.last_name} ${st.first_name}`, courses: {}, total_coef: 0, total_points: 0, credits: 0, credits_total: 0, gp_points: 0 };
    for (const co of courses) {
      let avg = null; const seqs = {};
      if (lmd) {
        const sems = p.semester ? [p.semester] : (co.semester ? [co.semester] : [1, 2]);
        const avgs = [];
        for (const k of sems) {
          const cc = val(st.id, co.id, 3 * k - 2), ex = val(st.id, co.id, 3 * k - 1), rs = val(st.id, co.id, 3 * k);
          seqs[3 * k - 2] = cc; seqs[3 * k - 1] = ex; seqs[3 * k] = rs;
          const exam = rs != null ? Math.max(rs, ex ?? 0) : ex;
          if (exam != null || cc != null) avgs.push(cc == null ? exam : exam == null ? cc : cc * s.cc_weight + exam * (1 - s.cc_weight));
        }
        if (avgs.length) avg = round2(avgs.reduce((a, b) => a + b, 0) / avgs.length);
      } else {
        const vs = [];
        for (const q of p.seqs) { const v = val(st.id, co.id, q); seqs[q] = v; if (v != null) vs.push(v); }
        if (vs.length) avg = round2(vs.reduce((a, b) => a + b, 0) / vs.length);
      }
      r.courses[co.id] = { avg, seqs, points: avg == null ? null : round2(avg * co.coef), appreciation: appreciation(avg) };
      if (avg != null) {
        r.total_coef += co.coef; r.total_points += avg * co.coef;
        if (lmd) { const L = letter(avg); r.courses[co.id].grade = L.grade; r.courses[co.id].gp = L.gp; r.gp_points += L.gp * co.coef; r.credits_total += co.coef; if (avg >= s.pass_mark) r.credits += co.coef; }
      }
    }
    r.average = r.total_coef ? round2(r.total_points / r.total_coef) : null;
    r.total_points = round2(r.total_points);
    if (lmd) {
      r.gpa = r.credits_total ? round2(r.gp_points / r.credits_total) : null;
      // Compensation: a semester with an average >= pass mark validates every course unit.
      if (r.average != null && r.average >= s.pass_mark) r.credits = r.credits_total;
      r.grade = r.average != null ? letter(r.average).grade : '';
    }
    const c = council[st.id];
    r.council = c || null;
    r.distinction = c?.distinction ?? suggestDistinction(s, r.average);
    r.decision = c?.decision || '';
    return r;
  });
  rankOf(rows, 'average', 'rank');
  for (const co of courses) {
    const tmp = rows.map((r) => ({ r, v: r.courses[co.id].avg }));
    const sorted = tmp.filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    sorted.forEach((x, i) => { x.r.courses[co.id].rank = i > 0 && sorted[i - 1].v === x.v ? sorted[i - 1].r.courses[co.id].rank : i + 1; });
    const vs = sorted.map((x) => x.v);
    co.stats = { avg: vs.length ? round2(vs.reduce((a, b) => a + b, 0) / vs.length) : null, max: vs[0] ?? null, min: vs.length ? vs[vs.length - 1] : null, pass: vs.length ? Math.round((vs.filter((v) => v >= s.pass_mark).length / vs.length) * 100) : 0 };
  }
  const avgs = rows.map((r) => r.average).filter((v) => v != null);
  const period = { id: p.id, fr: p.fr, en: p.en, seqs: p.seqs, slots: p.seqs.map((q) => ({ seq: q, label: slotLabel(s, q) })) };
  return {
    class: cl, period, grading: s.grading, settings: { pass_mark: s.pass_mark, cc_weight: s.cc_weight }, courses, students: rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name)),
    locked: p.seqs.every((q) => isLocked(db, classId, q)),
    stats: { size: rows.length, ranked: avgs.length, avg: avgs.length ? round2(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null, max: avgs.length ? Math.max(...avgs) : null, min: avgs.length ? Math.min(...avgs) : null,
      pass: avgs.filter((v) => v >= s.pass_mark).length, pass_rate: avgs.length ? Math.round((avgs.filter((v) => v >= s.pass_mark).length / avgs.length) * 1000) / 10 : 0,
      girls: rows.filter((r) => r.sex === 'F').length, boys: rows.filter((r) => r.sex === 'M').length },
  };
}

/** Class council: distinctions, conduct, remarks, end-of-year decisions; locks the marks. */
export function saveCouncil(db, bus, ctx, b) {
  const cl = db.get('SELECT * FROM school_classes WHERE id = ? AND company_id = ?', b.class_id, ctx.user.company_id); if (!cl) throw notFound();
  const s = settingsOf(db, ctx.user.company_id);
  const p = periodOf(s, b.period);
  const res = classResults(db, ctx.user.company_id, cl.id, p.id);
  const given = Object.fromEntries((Array.isArray(b.decisions) ? b.decisions : []).map((d) => [Number(d.student_id), d]));
  db.tx(() => {
    for (const r of res.students) {
      const d = given[r.id] || {};
      const decision = p.id === 'year' ? oneOf(d.decision ?? (r.average == null ? '' : r.average >= s.pass_mark ? 'promoted' : 'repeat'), ['', 'promoted', 'repeat', 'excluded', 'graduated'], 'decision') : '';
      db.run(`INSERT INTO school_council (company_id, class_id, period, student_id, distinction, conduct, remark, decision, at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(class_id, period, student_id) DO UPDATE SET distinction = excluded.distinction, conduct = excluded.conduct, remark = excluded.remark, decision = excluded.decision, at = excluded.at`,
      ctx.user.company_id, cl.id, p.id, r.id, oneOf(d.distinction ?? r.distinction ?? '', ['', ...Object.keys(DISTINCTIONS)], 'distinction'), str(d.conduct ?? r.council?.conduct ?? '', 40), str(d.remark ?? r.council?.remark ?? '', 300), decision, now());
      if (decision) db.run('UPDATE school_enrollments SET decision = ? WHERE student_id = ? AND year_id = ?', decision, r.id, cl.year_id);
    }
    if (b.lock !== false) for (const q of p.seqs) db.run('INSERT OR IGNORE INTO school_locks (class_id, sequence, locked_by, locked_at) VALUES (?,?,?,?)', cl.id, q, ctx.user.id, now());
  });
  audit(db, ctx, 'council', 'school_class', cl.id, p.id);
  bus?.emit(ctx.user.company_id, 'change', { entity: 'school_council', id: cl.id });
  return classResults(db, ctx.user.company_id, cl.id, p.id);
}

export function unlock(db, ctx, classId, seq) {
  if (!MANAGERS.includes(ctx.user.role)) throw forbidden('Réservé à la direction');
  db.run('DELETE FROM school_locks WHERE class_id = ? AND sequence = ?', classId, seq);
  audit(db, ctx, 'unlock', 'school_class', classId, `seq ${seq}`);
  return { ok: true };
}

/** Report cards for a class (or one student) with a verification code each. */
export function bulletins(db, companyId, classId, periodId, studentId = null) {
  const res = classResults(db, companyId, classId, periodId);
  const y = db.get('SELECT * FROM school_years WHERE id = ?', res.class.year_id);
  const s = settingsOf(db, companyId);
  const per = periods(s).find((x) => x.id === periodId);
  const range = bounds(y, per, s);
  const out = [];
  for (const r of res.students) {
    if (studentId && r.id !== Number(studentId)) continue;
    let b = db.get('SELECT code FROM school_bulletins WHERE student_id = ? AND year_id = ? AND period = ?', r.id, y.id, periodId);
    if (!b) { b = { code: shortCode() }; db.run('INSERT INTO school_bulletins (code, company_id, student_id, year_id, class_id, period, average, rank, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', b.code, companyId, r.id, y.id, classId, periodId, r.average, r.rank ?? null, res.stats.ranked, now()); }
    else db.run('UPDATE school_bulletins SET average = ?, rank = ?, size = ?, class_id = ? WHERE code = ?', r.average, r.rank ?? null, res.stats.ranked, classId, b.code);
    const st = db.get('SELECT birth_date, birth_place, photo, matricule FROM school_students WHERE id = ?', r.id);
    const prev = periodId.startsWith('t') && Number(periodId.slice(1)) > 1 ? db.get('SELECT average, rank FROM school_bulletins WHERE student_id = ? AND year_id = ? AND period = ?', r.id, y.id, `t${Number(periodId.slice(1)) - 1}`) : null;
    out.push({ ...r, ...st, code: b.code, absences: absenceTotals(db, r.id, range.from, range.to),
      sanctions: db.all('SELECT kind, date, reason FROM school_discipline WHERE student_id = ? AND date BETWEEN ? AND ?', r.id, range.from, range.to), previous: prev || null });
  }
  return { ...res, year: y, bulletins: out };
}

function bounds(y, per, s) {
  try {
    const sd = JSON.parse(y.seq_dates || '[]');
    const ds = sd.filter((x) => per.seqs.includes(x.seq) || (s.grading === 'lmd'));
    if (ds.length && s.grading !== 'lmd') return { from: ds[0].from, to: ds[ds.length - 1].to };
  } catch { /* default */ }
  return { from: y.start_date, to: y.end_date };
}

/** Full academic record of a student across years (transcript / relevé de notes). */
export function transcript(db, companyId, studentId) {
  const st = db.get('SELECT * FROM school_students WHERE id = ? AND company_id = ?', studentId, companyId); if (!st) throw notFound('Élève introuvable');
  const s = settingsOf(db, companyId);
  const years = db.all('SELECT e.*, y.name year_name, c.name class_name, l.name level_name FROM school_enrollments e JOIN school_years y ON y.id = e.year_id JOIN school_classes c ON c.id = e.class_id JOIN school_levels l ON l.id = c.level_id WHERE e.student_id = ? ORDER BY y.start_date', studentId);
  const out = years.map((e) => {
    const parts = periods(s).filter((p) => (s.grading === 'lmd' ? p.id !== 'year' : p.id.startsWith('t'))).concat(periods(s).filter((p) => p.id === 'year'));
    const res = parts.map((p) => {
      const r = classResults(db, companyId, e.class_id, p.id);
      const me = r.students.find((x) => x.id === studentId);
      return { period: p.id, fr: p.fr, en: p.en, average: me?.average ?? null, rank: me?.rank ?? null, size: r.stats.ranked, credits: me?.credits ?? null, credits_total: me?.credits_total ?? null, gpa: me?.gpa ?? null,
        courses: r.courses.map((c) => ({ subject: c.subject, code: c.code, coef: c.coef, avg: me?.courses[c.id]?.avg ?? null, grade: me?.courses[c.id]?.grade || '' })) };
    });
    return { ...e, results: res };
  });
  return { student: st, grading: s.grading, years: out, exams: db.all('SELECT * FROM school_exam_results WHERE student_id = ? ORDER BY session DESC', studentId) };
}

/** Marks of a student for the portal: every course, every slot of the year. */
export function studentMarks(db, companyId, studentId) {
  const y = activeYear(db, companyId);
  const e = db.get("SELECT class_id FROM school_enrollments WHERE student_id = ? AND year_id = ? AND status = 'enrolled'", studentId, y?.id);
  if (!e) return { courses: [], periods: [] };
  const s = settingsOf(db, companyId);
  const courses = db.all('SELECT co.id, co.coef, sub.name subject, u.name teacher FROM school_courses co JOIN school_subjects sub ON sub.id = co.subject_id LEFT JOIN users u ON u.id = co.teacher_id WHERE co.class_id = ? ORDER BY sub.grp, sub.name', e.class_id);
  const marks = db.all('SELECT course_id, sequence, mark, absent FROM school_marks WHERE student_id = ?', studentId);
  const tests = db.all(`SELECT a.id, a.course_id, a.sequence, a.title, a.kind, a.date, a.max, x.score, x.absent FROM school_assessments a LEFT JOIN school_scores x ON x.assessment_id = a.id AND x.student_id = ?
    JOIN school_courses co ON co.id = a.course_id WHERE co.class_id = ? AND a.published = 1 ORDER BY a.date DESC LIMIT 60`, studentId, e.class_id);
  const ps = periods(s).filter((p) => p.id !== 'year');
  const summary = ps.map((p) => {
    const r = classResults(db, companyId, e.class_id, p.id);
    const me = r.students.find((x) => x.id === studentId);
    return { id: p.id, fr: p.fr, en: p.en, average: me?.average ?? null, rank: me?.rank ?? null, size: r.stats.ranked, class_avg: r.stats.avg, distinction: me?.distinction || '', locked: r.locked, gpa: me?.gpa ?? null };
  }).filter((x) => x.average != null);
  return { class_id: e.class_id, grading: s.grading, courses: courses.map((c) => ({ ...c, marks: Object.fromEntries(marks.filter((m) => m.course_id === c.id).map((m) => [m.sequence, m.absent && m.mark == null ? 'abs' : m.mark])) })),
    slots: [1, 2, 3, 4, 5, 6].slice(0, s.grading === 'lmd' ? 6 : s.sequences).map((q) => ({ seq: q, label: slotLabel(s, q) })), tests, summary };
}
