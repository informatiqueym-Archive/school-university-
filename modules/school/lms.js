// E-learning (Scholar LMS from the Teknons catalogue): online courses with
// video, text and PDF lessons, auto-graded quizzes, assignments marked by the
// teacher, live classes (video room link), progress tracking, verifiable
// certificates, and paid courses sold on the public catalogue /learn (the fee
// is a Compta invoice paid by Mobile Money).
import crypto from 'node:crypto';
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, num, oneOf } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { audit } from '../../core/alerts.js';
import * as docs from '../accounting/documents.js';
import { activeYear, shortCode } from './schema.js';
import { sys } from './students.js';
import { MANAGERS } from './grades.js';

const parse = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export const LESSON_KINDS = { video: ['Vidéo', 'Video'], text: ['Leçon écrite', 'Reading'], pdf: ['Document PDF', 'PDF'], quiz: ['Quiz', 'Quiz'], assignment: ['Devoir à rendre', 'Assignment'], live: ['Classe en direct', 'Live class'] };

/** Live classes use a private Jitsi Meet room (free, no account); a school may paste its own Zoom / Meet link instead. */
export const liveRoom = (companyId, lesson) => lesson.video_url || `https://meet.jit.si/teknons-${companyId}-${crypto.createHash('sha1').update(`${companyId}:${lesson.id}:${lesson.course_id}`).digest('hex').slice(0, 12)}`;

export function courses(db, companyId, q = {}) {
  const where = ['c.company_id = ?']; const p = [companyId];
  if (q.teacher_id) { where.push('c.teacher_id = ?'); p.push(q.teacher_id); }
  if (q.public) where.push('c.public = 1 AND c.published = 1');
  return db.all(`SELECT c.*, u.name teacher_name, cl.name class_name,
      (SELECT COUNT(*) FROM lms_lessons l WHERE l.course_id = c.id) lessons, (SELECT COALESCE(SUM(duration),0) FROM lms_lessons l WHERE l.course_id = c.id) minutes,
      (SELECT COUNT(*) FROM lms_enrollments e WHERE e.course_id = c.id) enrolled, (SELECT COUNT(*) FROM lms_enrollments e WHERE e.course_id = c.id AND e.completed_at IS NOT NULL) completed,
      (CASE WHEN c.class_id IS NOT NULL THEN (SELECT COUNT(*) FROM school_enrollments e WHERE e.class_id = c.class_id AND e.status = 'enrolled') ELSE 0 END) class_size
    FROM lms_courses c LEFT JOIN users u ON u.id = c.teacher_id LEFT JOIN school_classes cl ON cl.id = c.class_id WHERE ${where.join(' AND ')} ORDER BY c.published DESC, c.id DESC`, ...p);
}

export function saveCourse(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM lms_courses WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  if (cur && !MANAGERS.includes(ctx.user.role) && cur.teacher_id !== ctx.user.id) throw forbidden('Ce cours en ligne appartient à un autre enseignant');
  const title = str(b.title ?? cur?.title, 160); if (!title) throw bad('title', 'Titre du cours obligatoire');
  const classId = b.class_id === undefined ? cur?.class_id ?? null : (Number(b.class_id) || null);
  if (classId && !db.get('SELECT 1 FROM school_classes WHERE id = ? AND company_id = ?', classId, cid)) throw bad('class', 'Classe introuvable');
  const v = [title, str(b.subtitle ?? cur?.subtitle, 200), str(b.description ?? cur?.description, 5000), b.teacher_id === undefined ? cur?.teacher_id ?? ctx.user.id : (Number(b.teacher_id) || null), classId,
    str(b.category ?? cur?.category, 60), str(b.level ?? cur?.level, 40), int(b.price ?? cur?.price, 'price', { min: 0, def: 0 }), (b.public ?? cur?.public) ? 1 : 0, (b.published ?? cur?.published) ? 1 : 0,
    str(b.cover_color ?? cur?.cover_color, 9), (b.certificate ?? cur?.certificate ?? 1) ? 1 : 0, num(b.pass_score ?? cur?.pass_score, 'pass_score', { min: 0, def: 60 })];
  if (cur) db.run('UPDATE lms_courses SET title = ?, subtitle = ?, description = ?, teacher_id = ?, class_id = ?, category = ?, level = ?, price = ?, public = ?, published = ?, cover_color = ?, certificate = ?, pass_score = ? WHERE id = ?', ...v, id);
  else id = Number(db.run('INSERT INTO lms_courses (company_id, title, subtitle, description, teacher_id, class_id, category, level, price, public, published, cover_color, certificate, pass_score, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cid, ...v, now()).lastInsertRowid);
  audit(db, ctx, cur ? 'update' : 'create', 'lms_course', id, title);
  return courseDetail(db, cid, id);
}

export function courseDetail(db, companyId, id) {
  const c = courses(db, companyId).find((x) => x.id === Number(id)); if (!c) throw notFound('Cours en ligne introuvable');
  c.lessons_list = db.all('SELECT * FROM lms_lessons WHERE course_id = ? ORDER BY position, id', c.id).map((l) => ({ ...l, quiz: parse(l.quiz), room: l.kind === 'live' ? liveRoom(companyId, l) : '' }));
  return c;
}

export function saveLesson(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM lms_lessons WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const course = db.get('SELECT * FROM lms_courses WHERE id = ? AND company_id = ?', b.course_id ?? cur?.course_id, cid); if (!course) throw bad('course', 'Cours introuvable');
  if (!MANAGERS.includes(ctx.user.role) && course.teacher_id !== ctx.user.id) throw forbidden('Ce cours en ligne appartient à un autre enseignant');
  const kind = oneOf(b.kind ?? cur?.kind, Object.keys(LESSON_KINDS), 'kind', 'video');
  const title = str(b.title ?? cur?.title, 200); if (!title) throw bad('title', 'Titre obligatoire');
  const url = str(b.video_url ?? cur?.video_url, 500); if (url && !/^https?:\/\//.test(url)) throw bad('url', 'Lien invalide (https://...)');
  let quiz = b.quiz === undefined ? parse(cur?.quiz) : b.quiz;
  if (kind === 'quiz') {
    if (!Array.isArray(quiz) || !quiz.length) throw bad('quiz', 'Ajoutez au moins une question');
    quiz = quiz.slice(0, 50).map((x, i) => {
      const choices = (Array.isArray(x.choices) ? x.choices : []).map((c) => str(c, 200)).filter(Boolean);
      const answer = Number(x.answer);
      if (!str(x.q, 500) || choices.length < 2 || !(answer >= 0 && answer < choices.length)) throw bad('quiz', `Question ${i + 1} : énoncé, au moins 2 choix et la bonne réponse`);
      return { q: str(x.q, 500), choices, answer, explain: str(x.explain, 500) };
    });
  } else quiz = [];
  const pos = b.position ?? cur?.position ?? (db.get('SELECT COALESCE(MAX(position),0)+1 p FROM lms_lessons WHERE course_id = ?', course.id).p);
  const v = [course.id, int(pos, 'position', { min: 0, def: 0 }), title, kind, url, str(b.content ?? cur?.content, 20000), int(b.duration ?? cur?.duration, 'duration', { min: 0, def: 0 }), JSON.stringify(quiz),
    str(b.starts_at ?? cur?.starts_at, 16), str(b.due_date ?? cur?.due_date, 10), num(b.max_score ?? cur?.max_score, 'max_score', { min: 1, def: 20 }), (b.free_preview ?? cur?.free_preview) ? 1 : 0];
  if (cur) db.run('UPDATE lms_lessons SET course_id = ?, position = ?, title = ?, kind = ?, video_url = ?, content = ?, duration = ?, quiz = ?, starts_at = ?, due_date = ?, max_score = ?, free_preview = ? WHERE id = ?', ...v, id);
  else id = Number(db.run('INSERT INTO lms_lessons (company_id, course_id, position, title, kind, video_url, content, duration, quiz, starts_at, due_date, max_score, free_preview) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', cid, ...v).lastInsertRowid);
  return courseDetail(db, cid, course.id);
}

// ---------------- Learner side (portal) ----------------
const classOf = (db, companyId, studentId) => db.get("SELECT class_id FROM school_enrollments WHERE student_id = ? AND year_id = ? AND status = 'enrolled'", studentId, activeYear(db, companyId)?.id)?.class_id;

function access(db, companyId, course, studentId) {
  if (course.class_id && course.class_id === classOf(db, companyId, studentId)) return { ok: true, via: 'class' };
  const e = db.get('SELECT e.*, d.status doc_status FROM lms_enrollments e LEFT JOIN documents d ON d.id = e.document_id WHERE e.course_id = ? AND e.student_id = ?', course.id, studentId);
  if (!e) return { ok: false };
  if (e.document_id && e.doc_status !== 'paid') return { ok: false, pending: true, document_id: e.document_id };
  return { ok: true, via: 'enrolled' };
}

export function myCourses(db, companyId, studentId) {
  const cls = classOf(db, companyId, studentId);
  const list = db.all(`SELECT c.*, u.name teacher_name FROM lms_courses c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.company_id = ? AND c.published = 1
    AND (c.class_id = ? OR c.id IN (SELECT course_id FROM lms_enrollments WHERE student_id = ?)) ORDER BY c.title`, companyId, cls || -1, studentId);
  return list.map((c) => ({ ...c, ...progressOf(db, c.id, studentId), access: access(db, companyId, c, studentId) }));
}

function progressOf(db, courseId, studentId) {
  const n = db.get('SELECT COUNT(*) n FROM lms_lessons WHERE course_id = ?', courseId).n;
  const done = db.get('SELECT COUNT(*) n FROM lms_progress p JOIN lms_lessons l ON l.id = p.lesson_id WHERE l.course_id = ? AND p.student_id = ?', courseId, studentId).n;
  const e = db.get('SELECT completed_at, certificate_code FROM lms_enrollments WHERE course_id = ? AND student_id = ?', courseId, studentId);
  return { total: n, done, pct: n ? Math.round((done / n) * 100) : 0, completed_at: e?.completed_at || null, certificate_code: e?.certificate_code || null };
}

export function learnerCourse(db, companyId, courseId, studentId) {
  const c = db.get('SELECT c.*, u.name teacher_name FROM lms_courses c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.id = ? AND c.company_id = ? AND c.published = 1', courseId, companyId);
  if (!c) throw notFound('Cours introuvable');
  const acc = access(db, companyId, c, studentId);
  const prog = Object.fromEntries(db.all('SELECT * FROM lms_progress WHERE student_id = ? AND lesson_id IN (SELECT id FROM lms_lessons WHERE course_id = ?)', studentId, c.id).map((p) => [p.lesson_id, p]));
  const lessons = db.all('SELECT * FROM lms_lessons WHERE course_id = ? ORDER BY position, id', c.id).map((l) => {
    const open = acc.ok || l.free_preview;
    const p = prog[l.id];
    const quiz = parse(l.quiz).map((q) => ({ q: q.q, choices: q.choices, ...(p ? { answer: q.answer, explain: q.explain } : {}) }));
    return { id: l.id, title: l.title, kind: l.kind, duration: l.duration, starts_at: l.starts_at, due_date: l.due_date, max_score: l.max_score, free_preview: l.free_preview, locked: !open,
      video_url: open && l.kind !== 'live' ? l.video_url : '', content: open ? l.content : '', quiz: open ? quiz : [], room: open && l.kind === 'live' ? liveRoom(companyId, l) : '',
      done: !!p, score: p?.score ?? null, answer: p?.answer || '', feedback: p?.feedback || '', graded: !!p?.graded_at };
  });
  return { course: { id: c.id, title: c.title, subtitle: c.subtitle, description: c.description, teacher_name: c.teacher_name, price: c.price, certificate: c.certificate, pass_score: c.pass_score, cover_color: c.cover_color, category: c.category, level: c.level },
    access: acc, lessons, progress: progressOf(db, c.id, studentId) };
}

function lessonFor(db, companyId, lessonId, studentId) {
  const l = db.get('SELECT l.*, c.class_id, c.id cid FROM lms_lessons l JOIN lms_courses c ON c.id = l.course_id WHERE l.id = ? AND l.company_id = ? AND c.published = 1', lessonId, companyId);
  if (!l) throw notFound('Leçon introuvable');
  const c = db.get('SELECT * FROM lms_courses WHERE id = ?', l.course_id);
  if (!access(db, companyId, c, studentId).ok && !l.free_preview) throw forbidden("Inscrivez-vous au cours (et réglez-le s'il est payant) pour accéder à cette leçon");
  return { l, c };
}

export function completeLesson(db, companyId, lessonId, studentId, b = {}) {
  const { l, c } = lessonFor(db, companyId, lessonId, studentId);
  let score = null, answer = '';
  if (l.kind === 'quiz') {
    const qs = parse(l.quiz); const ans = Array.isArray(b.answers) ? b.answers.map(Number) : [];
    if (ans.length !== qs.length) throw bad('answers', 'Répondez à toutes les questions');
    score = Math.round((qs.filter((q, i) => q.answer === ans[i]).length / qs.length) * 100);
    answer = JSON.stringify(ans);
    const prev = db.get('SELECT score FROM lms_progress WHERE lesson_id = ? AND student_id = ?', l.id, studentId);
    if (prev && prev.score >= score) { checkCompletion(db, companyId, c, studentId); return { score, best: prev.score, passed: prev.score >= c.pass_score }; }
  } else if (l.kind === 'assignment') {
    answer = str(b.answer, 10000); if (!answer) throw bad('answer', 'Écrivez votre réponse ou collez le lien de votre travail');
    const prev = db.get('SELECT graded_at FROM lms_progress WHERE lesson_id = ? AND student_id = ?', l.id, studentId);
    if (prev?.graded_at) throw conflict('graded', 'Ce devoir est déjà corrigé');
  }
  db.run(`INSERT INTO lms_progress (lesson_id, student_id, done_at, score, answer) VALUES (?,?,?,?,?)
    ON CONFLICT(lesson_id, student_id) DO UPDATE SET done_at = excluded.done_at, score = excluded.score, answer = excluded.answer`, l.id, studentId, now(), score, answer);
  db.run('INSERT OR IGNORE INTO lms_enrollments (course_id, student_id, company_id, started_at) VALUES (?,?,?,?)', c.id, studentId, companyId, now());
  const cert = checkCompletion(db, companyId, c, studentId);
  return { score, passed: score == null ? null : score >= c.pass_score, certificate_code: cert };
}

/** All lessons done and quiz average above the pass score: course completed, certificate issued. */
function checkCompletion(db, companyId, c, studentId) {
  const p = progressOf(db, c.id, studentId);
  if (p.completed_at) return p.certificate_code;
  if (!p.total || p.done < p.total) return null;
  const q = db.get("SELECT AVG(p.score) a FROM lms_progress p JOIN lms_lessons l ON l.id = p.lesson_id WHERE l.course_id = ? AND p.student_id = ? AND l.kind = 'quiz'", c.id, studentId).a;
  if (q != null && q < c.pass_score) return null;
  if (db.get("SELECT 1 FROM lms_progress p JOIN lms_lessons l ON l.id = p.lesson_id WHERE l.course_id = ? AND p.student_id = ? AND l.kind = 'assignment' AND p.graded_at IS NULL", c.id, studentId)) return null;
  const code = c.certificate ? 'CERT-' + shortCode() : null;
  db.run('UPDATE lms_enrollments SET completed_at = ?, certificate_code = ? WHERE course_id = ? AND student_id = ?', now(), code, c.id, studentId);
  return code;
}

export function submissions(db, companyId, q = {}) {
  return db.all(`SELECT p.*, l.title lesson, l.max_score, l.course_id, c.title course, s.last_name, s.first_name, s.matricule FROM lms_progress p JOIN lms_lessons l ON l.id = p.lesson_id JOIN lms_courses c ON c.id = l.course_id
    JOIN school_students s ON s.id = p.student_id WHERE l.company_id = ? AND l.kind = 'assignment' ${q.pending ? 'AND p.graded_at IS NULL' : ''} ${q.teacher_id ? 'AND c.teacher_id = ' + Number(q.teacher_id) : ''} ORDER BY p.graded_at IS NOT NULL, p.done_at DESC LIMIT 300`, companyId);
}

export function grade(db, ctx, lessonId, studentId, b) {
  const l = db.get('SELECT l.*, c.teacher_id FROM lms_lessons l JOIN lms_courses c ON c.id = l.course_id WHERE l.id = ? AND l.company_id = ?', lessonId, ctx.user.company_id); if (!l) throw notFound();
  if (!MANAGERS.includes(ctx.user.role) && l.teacher_id !== ctx.user.id) throw forbidden();
  const score = num(b.score, 'score', { min: 0 }); if (score > l.max_score) throw bad('score', `Note sur ${l.max_score}`);
  const r = db.run('UPDATE lms_progress SET score = ?, feedback = ?, graded_at = ? WHERE lesson_id = ? AND student_id = ?', score, str(b.feedback, 2000), now(), lessonId, studentId);
  if (!r.changes) throw notFound('Aucun rendu pour cet élève');
  checkCompletion(db, ctx.user.company_id, db.get('SELECT * FROM lms_courses WHERE id = ?', l.course_id), studentId);
  return { ok: true };
}

export function courseProgress(db, companyId, courseId) {
  const c = courseDetail(db, companyId, courseId);
  const learners = c.class_id
    ? db.all("SELECT s.id, s.last_name, s.first_name, s.matricule FROM school_enrollments e JOIN school_students s ON s.id = e.student_id WHERE e.class_id = ? AND e.status = 'enrolled' ORDER BY s.last_name", c.class_id)
    : db.all('SELECT s.id, s.last_name, s.first_name, s.matricule FROM lms_enrollments e JOIN school_students s ON s.id = e.student_id WHERE e.course_id = ? ORDER BY s.last_name', c.id);
  return { course: c, learners: learners.map((s) => ({ ...s, ...progressOf(db, c.id, s.id), quiz_avg: db.get("SELECT ROUND(AVG(p.score)) a FROM lms_progress p JOIN lms_lessons l ON l.id = p.lesson_id WHERE l.course_id = ? AND p.student_id = ? AND l.kind = 'quiz'", c.id, s.id).a })) };
}

/** Enrols a learner in an open course; a paid course creates an invoice that unlocks it when paid. */
export function enrollCourse(db, ctx, company, courseId, studentId) {
  const c = db.get('SELECT * FROM lms_courses WHERE id = ? AND company_id = ? AND published = 1', courseId, company.id); if (!c) throw notFound('Cours introuvable');
  const st = db.get('SELECT * FROM school_students WHERE id = ? AND company_id = ?', studentId, company.id); if (!st) throw notFound('Apprenant introuvable');
  const ex = db.get('SELECT * FROM lms_enrollments WHERE course_id = ? AND student_id = ?', c.id, st.id);
  if (ex) return { ...ex, existing: true };
  let docId = null;
  if (c.price > 0 && !(c.class_id && c.class_id === classOf(db, company.id, st.id))) {
    docId = docs.createDocument(db, sys(ctx), company, { kind: 'invoice', partner_id: st.guardian_id, date: today(), due_date: today(), validate: true, subject: `Cours en ligne : ${c.title} – ${st.last_name} ${st.first_name}`,
      lines: [{ description: `Cours en ligne « ${c.title} »`, qty: 1, unit_price: c.price, vat_rate: 0, account_code: '7068', kind: 'service' }] });
  }
  db.run('INSERT INTO lms_enrollments (course_id, student_id, company_id, document_id, started_at) VALUES (?,?,?,?,?)', c.id, st.id, company.id, docId, now());
  return db.get('SELECT * FROM lms_enrollments WHERE course_id = ? AND student_id = ?', c.id, st.id);
}

export function certificate(db, code) {
  return db.get(`SELECT e.*, c.title course, c.company_id, u.name teacher_name, s.last_name, s.first_name, s.matricule, (SELECT COALESCE(SUM(duration),0) FROM lms_lessons l WHERE l.course_id = c.id) minutes
    FROM lms_enrollments e JOIN lms_courses c ON c.id = e.course_id JOIN school_students s ON s.id = e.student_id LEFT JOIN users u ON u.id = c.teacher_id WHERE e.certificate_code = ?`, String(code || '').toUpperCase());
}
