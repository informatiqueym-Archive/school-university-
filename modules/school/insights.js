// Dashboard and "Teknons Insight": early-warning score for each student
// (falling marks, absences, unpaid fees, sanctions), class and subject
// performance, fee collection forecast, enrolment mix.
import { today } from '../../core/schema.js';
import { addDays } from '../../core/validate.js';
import { settingsOf, activeYear } from './schema.js';
import { classResults, periods, round2 } from './grades.js';
import { gateToday, feeStatusByClass } from './students.js';
import { libraryStats } from './library.js';

/** Latest period with marks, used by the dashboard. */
function lastPeriods(db, companyId, s) {
  const seqs = db.all('SELECT DISTINCT m.sequence FROM school_marks m WHERE m.company_id = ? AND m.mark IS NOT NULL ORDER BY m.sequence', companyId).map((r) => r.sequence);
  const ps = periods(s).filter((p) => p.id !== 'year' && (s.grading === 'lmd' || p.id.startsWith('s')));
  const withMarks = ps.filter((p) => p.seqs.some((q) => seqs.includes(q)));
  return { last: withMarks[withMarks.length - 1] || null, prev: withMarks[withMarks.length - 2] || null };
}

export function atRisk(db, companyId, { limit = 50, class_id } = {}) {
  const s = settingsOf(db, companyId); const y = activeYear(db, companyId);
  if (!y) return [];
  const { last, prev } = lastPeriods(db, companyId, s);
  const classes = db.all('SELECT id, name FROM school_classes WHERE company_id = ? AND year_id = ?' + (class_id ? ' AND id = ' + Number(class_id) : ''), companyId, y.id);
  const out = [];
  const t = today();
  for (const c of classes) {
    const rNow = last ? classResults(db, companyId, c.id, last.id) : null;
    const rPrev = prev ? classResults(db, companyId, c.id, prev.id) : null;
    const prevMap = new Map((rPrev?.students || []).map((x) => [x.id, x.average]));
    for (const st of rNow?.students || db.all("SELECT s.id, s.last_name, s.first_name, s.matricule, s.sex, s.last_name || ' ' || s.first_name name FROM school_enrollments e JOIN school_students s ON s.id = e.student_id WHERE e.class_id = ? AND e.status = 'enrolled'", c.id)) {
      const reasons = []; let score = 0;
      const avg = st.average ?? null, before = prevMap.get(st.id);
      if (avg != null && avg < s.pass_mark) { score += avg < s.warning_mark ? 35 : 22; reasons.push({ k: 'marks', fr: `Moyenne ${String(avg).replace('.', ',')}/20`, en: `Average ${avg}/20` }); }
      if (avg != null && before != null && before - avg >= 2) { score += 18; reasons.push({ k: 'drop', fr: `En baisse de ${String(round2(before - avg)).replace('.', ',')} pts`, en: `Down ${round2(before - avg)} pts` }); }
      const failing = st.courses ? Object.values(st.courses).filter((x) => x.avg != null && x.avg < 8).length : 0;
      if (failing >= 3) { score += 10; reasons.push({ k: 'subjects', fr: `${failing} matières sous 8`, en: `${failing} subjects below 8` }); }
      const abs = db.get("SELECT COALESCE(SUM(CASE WHEN kind='absent' AND justified=0 THEN hours END),0) h, COUNT(CASE WHEN kind='late' THEN 1 END) l FROM school_attendance WHERE student_id = ? AND date >= ?", st.id, addDays(t, -30));
      if (abs.h >= 6) { score += Math.min(25, abs.h * 2); reasons.push({ k: 'absence', fr: `${abs.h} h d'absence injustifiée (30 j)`, en: `${abs.h} h unexcused absence (30 d)` }); }
      if (abs.l >= 4) { score += 6; reasons.push({ k: 'late', fr: `${abs.l} retards (30 j)`, en: `${abs.l} lates (30 d)` }); }
      const due = db.get("SELECT COALESCE(SUM(d.total - d.paid - d.credited),0) v FROM school_student_fees f JOIN documents d ON d.id = f.document_id WHERE f.student_id = ? AND f.year_id = ? AND d.status IN ('open','partial') AND d.due_date < ?", st.id, y.id, t).v;
      if (due > 0) { score += due >= 50000 ? 14 : 8; reasons.push({ k: 'fees', fr: `${due.toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA en retard`, en: `${due} FCFA overdue`, amount: due }); }
      const sanc = db.get("SELECT COUNT(*) n FROM school_discipline WHERE student_id = ? AND kind IN ('warning','blame','suspension','detention') AND date >= ?", st.id, y.start_date).n;
      if (sanc >= 2) { score += 10; reasons.push({ k: 'conduct', fr: `${sanc} sanctions`, en: `${sanc} sanctions` }); }
      if (score >= 20) out.push({ id: st.id, name: st.name || `${st.last_name} ${st.first_name}`, matricule: st.matricule, class_id: c.id, class_name: c.name, average: avg, previous: before ?? null, score: Math.min(100, score), level: score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low', reasons });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function dashboard(db, companyId) {
  const s = settingsOf(db, companyId); const y = activeYear(db, companyId); const t = today();
  const count = (sql, ...p) => db.get(sql, ...p).n;
  const students = db.get(`SELECT COUNT(*) n, SUM(CASE WHEN s.sex='F' THEN 1 ELSE 0 END) girls, SUM(e.repeating) repeating FROM school_enrollments e JOIN school_students s ON s.id = e.student_id
    WHERE e.company_id = ? AND e.year_id = ? AND e.status = 'enrolled' AND s.status = 'active'`, companyId, y.id);
  const fees = feeStatusByClass(db, companyId, y.id);
  const billed = fees.reduce((a, b) => a + b.billed, 0), paid = fees.reduce((a, b) => a + b.paid, 0), due = fees.reduce((a, b) => a + b.due, 0), overdue = fees.reduce((a, b) => a + b.overdue, 0);
  const daily = db.all("SELECT r.created_at d, r.amount v FROM school_receipts r WHERE r.company_id = ? AND r.created_at >= ?", companyId, addDays(t, -29));
  const byDay = {}; for (const r of daily) { const k = r.d.slice(0, 10); byDay[k] = (byDay[k] || 0) + r.v; }
  const momo = db.all(`SELECT p.date d, SUM(p.amount) v FROM payments p JOIN school_student_fees f ON f.document_id = p.document_id WHERE p.company_id = ? AND p.status = 'completed' AND p.date >= ? AND p.method IN ('mtn_momo','orange_money') AND p.notes LIKE 'Payé par le client%' GROUP BY p.date`, companyId, addDays(t, -29));
  for (const r of momo) byDay[r.d] = (byDay[r.d] || 0) + r.v;
  const trend = Array.from({ length: 30 }, (_, i) => { const d = addDays(t, i - 29); return { d, v: byDay[d] || 0 }; });
  const methods = db.all(`SELECT p.method, SUM(p.amount) v FROM payments p JOIN school_student_fees f ON f.document_id = p.document_id WHERE p.company_id = ? AND p.status = 'completed' AND f.year_id = ? GROUP BY p.method ORDER BY v DESC`, companyId, y.id);
  const upcoming = db.all(`SELECT i.name, i.due_date, SUM(d.total - d.paid - d.credited) v, COUNT(*) n FROM school_student_fees f JOIN documents d ON d.id = f.document_id JOIN school_fee_items i ON i.id = f.fee_item_id
    WHERE f.company_id = ? AND f.year_id = ? AND d.status IN ('open','partial') AND i.due_date >= ? GROUP BY i.id ORDER BY i.due_date LIMIT 4`, companyId, y.id, t);
  const absentToday = db.all(`SELECT a.student_id, s.last_name, s.first_name, c.name class_name, SUM(a.hours) hours, MAX(a.justified) justified FROM school_attendance a JOIN school_students s ON s.id = a.student_id JOIN school_classes c ON c.id = a.class_id
    WHERE a.company_id = ? AND a.date = ? AND a.kind = 'absent' GROUP BY a.student_id ORDER BY c.name`, companyId, t);
  const rolls = db.get('SELECT COUNT(DISTINCT r.class_id) n FROM school_rolls r JOIN school_classes c ON c.id = r.class_id WHERE c.company_id = ? AND r.date = ?', companyId, t).n;
  const classes = db.all('SELECT id, name FROM school_classes WHERE company_id = ? AND year_id = ? AND active = 1 ORDER BY name', companyId, y.id);
  const { last } = lastPeriods(db, companyId, s);
  const perf = last ? classes.map((c) => { const r = classResults(db, companyId, c.id, last.id); return { id: c.id, name: c.name, avg: r.stats.avg, pass_rate: r.stats.pass_rate, size: r.stats.size, best: r.students[0]?.average != null ? { name: r.students[0].name, avg: r.students[0].average } : null }; }) : [];
  const ranked = perf.filter((p) => p.avg != null);
  const schoolAvg = ranked.length ? round2(ranked.reduce((a, b) => a + b.avg * b.size, 0) / Math.max(1, ranked.reduce((a, b) => a + b.size, 0))) : null;
  const passRate = ranked.length ? Math.round(ranked.reduce((a, b) => a + b.pass_rate * b.size, 0) / Math.max(1, ranked.reduce((a, b) => a + b.size, 0)) * 10) / 10 : null;
  const subjects = last ? db.all(`SELECT sub.name, ROUND(AVG(m.mark), 2) avg, COUNT(*) n FROM school_marks m JOIN school_courses co ON co.id = m.course_id JOIN school_subjects sub ON sub.id = co.subject_id JOIN school_classes cl ON cl.id = co.class_id
    WHERE m.company_id = ? AND cl.year_id = ? AND m.sequence IN (${last.seqs.join(',')}) AND m.mark IS NOT NULL GROUP BY sub.id ORDER BY avg`, companyId, y.id) : [];
  const birthdays = db.all("SELECT s.id, s.last_name, s.first_name, c.name class_name FROM school_students s JOIN school_enrollments e ON e.student_id = s.id AND e.year_id = ? AND e.status = 'enrolled' JOIN school_classes c ON c.id = e.class_id WHERE s.company_id = ? AND substr(s.birth_date, 6, 5) = ?", y.id, companyId, t.slice(5));
  const risk = atRisk(db, companyId, { limit: 8 });
  const insights = [];
  if (overdue > 0) insights.push({ level: 'warn', title: `${(overdue / 1e6).toFixed(1).replace('.', ',')} M FCFA de frais en retard`, body: `${count("SELECT COUNT(DISTINCT f.student_id) n FROM school_student_fees f JOIN documents d ON d.id = f.document_id WHERE f.company_id = ? AND f.year_id = ? AND d.status IN ('open','partial') AND d.due_date < ?", companyId, y.id, t)} familles concernées. Envoyez les rappels WhatsApp avec le lien de paiement MoMo depuis « Frais et recouvrement ».` });
  if (subjects.length && subjects[0].avg < s.pass_mark) insights.push({ level: 'warn', title: `${subjects[0].name} : matière la plus faible (${String(subjects[0].avg).replace('.', ',')}/20)`, body: 'Prévoyez du soutien ou des séances de remédiation, et vérifiez la progression du programme dans le cahier de textes.' });
  const highRisk = risk.filter((r) => r.level === 'high').length;
  if (highRisk) insights.push({ level: 'bad', title: `${highRisk} élève(s) en risque élevé de décrochage`, body: 'Notes en baisse, absences et impayés combinés. Convoquez les parents avant le prochain conseil de classe.' });
  if (upcoming[0]) insights.push({ level: 'info', title: `Prochaine échéance : ${upcoming[0].name} le ${upcoming[0].due_date.split('-').reverse().join('/')}`, body: `${upcoming[0].n} élèves, ${Math.round(upcoming[0].v).toLocaleString('fr-FR')} FCFA attendus. Un rappel automatique part dans le portail des parents.` });
  if (rolls < classes.length && new Date().getUTCDay() !== 0) insights.push({ level: 'info', title: `Appel fait dans ${rolls} classe(s) sur ${classes.length} aujourd'hui`, body: 'Les enseignants font l\'appel depuis leur téléphone, même sans réseau.' });
  return {
    year: y, settings: { grading: s.grading, pass_mark: s.pass_mark }, students: { n: students.n || 0, girls: students.girls || 0, boys: (students.n || 0) - (students.girls || 0), repeating: students.repeating || 0 },
    classes: classes.length, teachers: count("SELECT COUNT(*) n FROM users WHERE company_id = ? AND role = 'teacher' AND active = 1", companyId),
    fees: { billed, paid, due, overdue, rate: billed ? Math.round((paid / billed) * 1000) / 10 : 0, by_class: fees, trend, methods, upcoming, today: trend[29].v },
    attendance: { absent: absentToday, rolls, gate: gateToday(db, companyId) }, results: { period: last ? { id: last.id, fr: last.fr, en: last.en } : null, avg: schoolAvg, pass_rate: passRate, classes: perf, subjects },
    risk, insights, birthdays, applications: count("SELECT COUNT(*) n FROM school_applications WHERE company_id = ? AND status IN ('new','interview')", companyId),
    library: libraryStats(db, companyId), lms: { courses: count('SELECT COUNT(*) n FROM lms_courses WHERE company_id = ? AND published = 1', companyId), pending: count("SELECT COUNT(*) n FROM lms_progress p JOIN lms_lessons l ON l.id = p.lesson_id WHERE l.company_id = ? AND l.kind = 'assignment' AND p.graded_at IS NULL", companyId) },
    research: { projects: count("SELECT COUNT(*) n FROM school_research WHERE company_id = ? AND status = 'active'", companyId), publications: count('SELECT COUNT(*) n FROM school_publications WHERE company_id = ?', companyId) },
    discipline: db.all("SELECT d.*, s.last_name, s.first_name FROM school_discipline d JOIN school_students s ON s.id = d.student_id WHERE d.company_id = ? ORDER BY d.id DESC LIMIT 5", companyId),
  };
}

/** Teacher's day: their courses today, roll calls to take, marks to enter, homework to correct. */
export function teacherDay(db, companyId, userId) {
  const y = activeYear(db, companyId); const day = new Date().getUTCDay() || 7;
  const today_ = db.all(`SELECT t.*, sub.name subject, cl.name class_name, co.id course_id, (SELECT 1 FROM school_rolls r WHERE r.class_id = t.class_id AND r.date = ? AND r.course_id = co.id) roll_done
    FROM school_timetable t JOIN school_courses co ON co.id = t.course_id JOIN school_subjects sub ON sub.id = co.subject_id JOIN school_classes cl ON cl.id = t.class_id
    WHERE co.teacher_id = ? AND t.day = ? AND cl.year_id = ? ORDER BY t.start`, today(), userId, day, y?.id);
  const courses = db.all(`SELECT co.id, sub.name subject, cl.name class_name, co.class_id, (SELECT COUNT(*) FROM school_enrollments e WHERE e.class_id = co.class_id AND e.status = 'enrolled') size,
      (SELECT COUNT(*) FROM school_marks m WHERE m.course_id = co.id AND m.mark IS NOT NULL) marks FROM school_courses co JOIN school_subjects sub ON sub.id = co.subject_id JOIN school_classes cl ON cl.id = co.class_id
    WHERE co.teacher_id = ? AND cl.year_id = ? ORDER BY cl.name`, userId, y?.id);
  return { today: today_, courses };
}
