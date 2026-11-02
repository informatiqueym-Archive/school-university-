// School structure: years, levels, classes, subjects, the courses taught in
// each class (teacher, coefficient or credits), staff files and workload,
// timetable with clash detection, lesson log with homework, announcements,
// new school year and promotion of students.
import { bad, notFound, conflict } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { audit } from '../../core/alerts.js';
import { activeYear, settingsOf, defaultSeqDates } from './schema.js';
import { enroll } from './students.js';
import { MANAGERS } from './grades.js';

export const DAYS = { 1: ['Lundi', 'Monday'], 2: ['Mardi', 'Tuesday'], 3: ['Mercredi', 'Wednesday'], 4: ['Jeudi', 'Thursday'], 5: ['Vendredi', 'Friday'], 6: ['Samedi', 'Saturday'] };
const time = (v, f) => { const t = str(v, 5); if (!/^\d{2}:\d{2}$/.test(t)) throw bad('time', `Heure invalide (${f})`); return t; };

// ---------------- Classes ----------------
export function listClasses(db, companyId, yearId = activeYear(db, companyId)?.id) {
  return db.all(`SELECT c.*, l.name level_name, l.position level_pos, l.section, l.exam, u.name head_teacher,
      (SELECT COUNT(*) FROM school_enrollments e WHERE e.class_id = c.id AND e.status = 'enrolled') size,
      (SELECT COUNT(*) FROM school_enrollments e JOIN school_students s ON s.id = e.student_id WHERE e.class_id = c.id AND e.status = 'enrolled' AND s.sex = 'F') girls,
      (SELECT COUNT(*) FROM school_courses co WHERE co.class_id = c.id) courses
    FROM school_classes c JOIN school_levels l ON l.id = c.level_id LEFT JOIN users u ON u.id = c.head_teacher_id
    WHERE c.company_id = ? AND c.year_id = ? ORDER BY l.position, c.name`, companyId, yearId);
}

export function saveClass(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_classes WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const level = db.get('SELECT * FROM school_levels WHERE id = ? AND company_id = ?', b.level_id ?? cur?.level_id, cid); if (!level) throw bad('level', 'Choisissez le niveau');
  const name = str(b.name ?? cur?.name, 40) || level.name; const yearId = cur?.year_id ?? (b.year_id || activeYear(db, cid).id);
  const head = b.head_teacher_id === undefined ? cur?.head_teacher_id ?? null : (b.head_teacher_id ? Number(b.head_teacher_id) : null) ?? null;
  const vals = [level.id, name, str(b.room ?? cur?.room, 30), int(b.capacity ?? cur?.capacity, 'capacity', { min: 1, def: 50 }), head];
  if (cur) db.run('UPDATE school_classes SET level_id = ?, name = ?, room = ?, capacity = ?, head_teacher_id = ?, active = ? WHERE id = ?', ...vals, b.active === undefined ? cur.active : (b.active ? 1 : 0), id);
  else {
    id = Number(db.run('INSERT INTO school_classes (company_id, year_id, level_id, name, room, capacity, head_teacher_id) VALUES (?,?,?,?,?,?,?)', cid, yearId, ...vals).lastInsertRowid);
    // A new class gets the courses of another class of the same level, or every subject at coefficient 2.
    const twin = db.get('SELECT id FROM school_classes WHERE company_id = ? AND year_id = ? AND level_id = ? AND id != ? ORDER BY id LIMIT 1', cid, yearId, level.id, id);
    if (b.copy_courses !== false) {
      if (twin) for (const co of db.all('SELECT * FROM school_courses WHERE class_id = ?', twin.id)) db.run('INSERT OR IGNORE INTO school_courses (company_id, class_id, subject_id, teacher_id, coef, hours, semester, code) VALUES (?,?,?,?,?,?,?,?)', cid, id, co.subject_id, co.teacher_id, co.coef, co.hours, co.semester, co.code);
      else if (b.all_subjects) for (const s of db.all('SELECT id FROM school_subjects WHERE company_id = ? AND active = 1', cid)) db.run('INSERT OR IGNORE INTO school_courses (company_id, class_id, subject_id, coef, hours) VALUES (?,?,?,?,?)', cid, id, s.id, 2, 2);
    }
  }
  audit(db, ctx, cur ? 'update' : 'create', 'school_class', id, name);
  return db.get('SELECT * FROM school_classes WHERE id = ?', id);
}

export function classDetail(db, companyId, id) {
  const c = db.get('SELECT c.*, l.name level_name, l.exam, y.name year_name, u.name head_teacher FROM school_classes c JOIN school_levels l ON l.id = c.level_id JOIN school_years y ON y.id = c.year_id LEFT JOIN users u ON u.id = c.head_teacher_id WHERE c.id = ? AND c.company_id = ?', id, companyId);
  if (!c) throw notFound('Classe introuvable');
  c.courses = coursesOf(db, companyId, { class_id: id });
  c.students = db.all("SELECT s.id, s.matricule, s.last_name, s.first_name, s.sex, s.birth_date, e.repeating, p.name guardian_name, p.phone guardian_phone FROM school_enrollments e JOIN school_students s ON s.id = e.student_id LEFT JOIN partners p ON p.id = s.guardian_id WHERE e.class_id = ? AND e.status = 'enrolled' ORDER BY s.last_name, s.first_name", id);
  return c;
}

// ---------------- Subjects and courses ----------------
export function saveSubject(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_subjects WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const name = str(b.name ?? cur?.name, 80); if (!name) throw bad('name', 'Nom de la matière obligatoire');
  const v = [name, str(b.name_en ?? cur?.name_en, 80), str(b.code ?? cur?.code, 12).toUpperCase(), oneOf(b.grp ?? cur?.grp, ['lit', 'sci', 'general', 'tech', 'core', 'elective'], 'grp', 'general'), str(b.color ?? cur?.color, 9)];
  if (cur) db.run('UPDATE school_subjects SET name = ?, name_en = ?, code = ?, grp = ?, color = ?, active = ? WHERE id = ?', ...v, b.active === undefined ? cur.active : (b.active ? 1 : 0), id);
  else id = Number(db.run('INSERT INTO school_subjects (company_id, name, name_en, code, grp, color) VALUES (?,?,?,?,?,?)', cid, ...v).lastInsertRowid);
  return db.get('SELECT * FROM school_subjects WHERE id = ?', id);
}

export function coursesOf(db, companyId, q = {}) {
  const where = ['co.company_id = ?', 'cl.year_id = ?']; const p = [companyId, q.year_id || activeYear(db, companyId)?.id];
  if (q.class_id) { where.push('co.class_id = ?'); p.push(q.class_id); }
  if (q.teacher_id) { where.push('co.teacher_id = ?'); p.push(q.teacher_id); }
  return db.all(`SELECT co.*, sub.name subject, sub.name_en subject_en, sub.code subject_code, sub.grp, sub.color, cl.name class_name, u.name teacher_name,
      (SELECT COUNT(*) FROM school_enrollments e WHERE e.class_id = co.class_id AND e.status = 'enrolled') size
    FROM school_courses co JOIN school_subjects sub ON sub.id = co.subject_id JOIN school_classes cl ON cl.id = co.class_id LEFT JOIN users u ON u.id = co.teacher_id
    WHERE ${where.join(' AND ')} ORDER BY cl.name, sub.grp, sub.name`, ...p);
}

export function saveCourse(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_courses WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const cl = db.get('SELECT id FROM school_classes WHERE id = ? AND company_id = ?', b.class_id ?? cur?.class_id, cid); if (!cl) throw bad('class', 'Classe introuvable');
  const sub = db.get('SELECT id FROM school_subjects WHERE id = ? AND company_id = ?', b.subject_id ?? cur?.subject_id, cid); if (!sub) throw bad('subject', 'Matière introuvable');
  const teacher = b.teacher_id === undefined ? cur?.teacher_id ?? null : (b.teacher_id ? Number(b.teacher_id) : null);
  if (teacher && !db.get('SELECT 1 FROM users WHERE id = ? AND company_id = ?', teacher, cid)) throw bad('teacher', 'Enseignant introuvable');
  const v = [cl.id, sub.id, teacher, num(b.coef ?? cur?.coef, 'coef', { min: 0, def: 1 }), int(b.hours ?? cur?.hours, 'hours', { min: 0, def: 2 }), int(b.semester ?? cur?.semester, 'semester', { min: 0, def: 0 }), str(b.code ?? cur?.code, 20)];
  if (cur) db.run('UPDATE school_courses SET class_id = ?, subject_id = ?, teacher_id = ?, coef = ?, hours = ?, semester = ?, code = ? WHERE id = ?', ...v, id);
  else id = Number(db.run('INSERT INTO school_courses (company_id, class_id, subject_id, teacher_id, coef, hours, semester, code) VALUES (?,?,?,?,?,?,?,?)', cid, ...v).lastInsertRowid);
  audit(db, ctx, cur ? 'update' : 'create', 'school_course', id);
  return db.get('SELECT * FROM school_courses WHERE id = ?', id);
}

export function deleteCourse(db, ctx, id) {
  const co = db.get('SELECT * FROM school_courses WHERE id = ? AND company_id = ?', id, ctx.user.company_id); if (!co) throw notFound();
  if (db.get('SELECT 1 FROM school_marks WHERE course_id = ? AND mark IS NOT NULL', id)) throw conflict('has_marks', 'Ce cours a déjà des notes : modifiez-le au lieu de le supprimer');
  db.tx(() => { db.run('DELETE FROM school_timetable WHERE course_id = ?', id); db.run('DELETE FROM school_marks WHERE course_id = ?', id); db.run('DELETE FROM school_courses WHERE id = ?', id); });
  return { ok: true };
}

// ---------------- Staff ----------------
export function staffList(db, companyId) {
  const y = activeYear(db, companyId);
  return db.all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.last_login, f.title, f.position, f.speciality, f.diploma, f.status, f.hourly_rate, f.hire_date, f.orcid,
      (SELECT COUNT(*) FROM school_courses co JOIN school_classes cl ON cl.id = co.class_id WHERE co.teacher_id = u.id AND cl.year_id = ?) courses,
      (SELECT COALESCE(SUM(co.hours),0) FROM school_courses co JOIN school_classes cl ON cl.id = co.class_id WHERE co.teacher_id = u.id AND cl.year_id = ?) hours_week,
      (SELECT COUNT(*) FROM school_lessons l JOIN school_courses co ON co.id = l.course_id WHERE co.teacher_id = u.id AND l.date >= date('now','-30 day')) lessons_30d,
      (SELECT COUNT(*) FROM school_classes cl WHERE cl.head_teacher_id = u.id AND cl.year_id = ?) head_of
    FROM users u LEFT JOIN school_staff f ON f.user_id = u.id WHERE u.company_id = ? ORDER BY u.active DESC, u.role = 'teacher' DESC, u.name`, y?.id, y?.id, y?.id, companyId);
}

export function saveStaff(db, ctx, userId, b) {
  const u = db.get('SELECT id FROM users WHERE id = ? AND company_id = ?', userId, ctx.user.company_id); if (!u) throw notFound();
  const cur = db.get('SELECT * FROM school_staff WHERE user_id = ?', userId) || {};
  const v = (k, m = 120) => str(b[k] ?? cur[k], m);
  db.run(`INSERT INTO school_staff (user_id, company_id, title, position, speciality, diploma, status, hourly_rate, hire_date, bio, orcid) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET title = excluded.title, position = excluded.position, speciality = excluded.speciality, diploma = excluded.diploma, status = excluded.status, hourly_rate = excluded.hourly_rate, hire_date = excluded.hire_date, bio = excluded.bio, orcid = excluded.orcid`,
  userId, ctx.user.company_id, v('title', 10), v('position'), v('speciality'), v('diploma'), oneOf(b.status ?? cur.status, ['permanent', 'part_time', 'visiting'], 'status', 'permanent'),
  int(b.hourly_rate ?? cur.hourly_rate, 'hourly_rate', { min: 0, def: 0 }), v('hire_date', 10), v('bio', 2000), v('orcid', 30));
  return db.get('SELECT * FROM school_staff WHERE user_id = ?', userId);
}

/** Hours taught (lesson log) per teacher for a month, with the pay due to part-time teachers. */
export function workload(db, companyId, month = today().slice(0, 7)) {
  return db.all(`SELECT u.id, u.name, f.status, f.hourly_rate, COUNT(l.id) lessons,
      COALESCE(SUM((SELECT (CAST(substr(t.end,1,2) AS INTEGER)*60 + CAST(substr(t.end,4,2) AS INTEGER) - CAST(substr(t.start,1,2) AS INTEGER)*60 - CAST(substr(t.start,4,2) AS INTEGER)) / 60.0
        FROM school_timetable t WHERE t.course_id = co.id AND t.day = CAST(strftime('%w', l.date) AS INTEGER) LIMIT 1)),0) hours
    FROM users u LEFT JOIN school_staff f ON f.user_id = u.id JOIN school_courses co ON co.teacher_id = u.id JOIN school_lessons l ON l.course_id = co.id AND substr(l.date,1,7) = ?
    WHERE u.company_id = ? GROUP BY u.id ORDER BY u.name`, month, companyId).map((r) => {
    const hours = Math.round((r.hours || r.lessons) * 10) / 10;
    return { ...r, hours, pay: r.status === 'part_time' || r.status === 'visiting' ? Math.round(hours * (r.hourly_rate || 0)) : 0 };
  });
}

// ---------------- Timetable ----------------
export function timetable(db, companyId, q = {}) {
  const where = ['t.company_id = ?', 'cl.year_id = ?']; const p = [companyId, activeYear(db, companyId)?.id];
  if (q.class_id) { where.push('t.class_id = ?'); p.push(q.class_id); }
  if (q.teacher_id) { where.push('co.teacher_id = ?'); p.push(q.teacher_id); }
  if (q.room) { where.push('t.room = ?'); p.push(q.room); }
  if (q.day) { where.push('t.day = ?'); p.push(q.day); }
  return db.all(`SELECT t.*, sub.name subject, sub.code subject_code, sub.color, cl.name class_name, u.name teacher_name, co.teacher_id FROM school_timetable t JOIN school_courses co ON co.id = t.course_id
    JOIN school_subjects sub ON sub.id = co.subject_id JOIN school_classes cl ON cl.id = t.class_id LEFT JOIN users u ON u.id = co.teacher_id WHERE ${where.join(' AND ')} ORDER BY t.day, t.start`, ...p);
}

export function saveSlot(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const co = db.get('SELECT co.*, cl.room class_room FROM school_courses co JOIN school_classes cl ON cl.id = co.class_id WHERE co.id = ? AND co.company_id = ?', b.course_id, cid); if (!co) throw bad('course', 'Choisissez le cours');
  const day = int(b.day, 'day', { min: 1 }); if (day > 6) throw bad('day', 'Jour invalide');
  const start = time(b.start, 'début'), end = time(b.end, 'fin'); if (end <= start) throw bad('time', "L'heure de fin doit suivre l'heure de début");
  const room = str(b.room, 30) || co.class_room || '';
  const overlap = `t.day = ? AND t.start < ? AND t.end > ? AND t.id != ?`;
  const y = activeYear(db, cid).id;
  const clash = db.get(`SELECT t.*, cl.name class_name, sub.name subject FROM school_timetable t JOIN school_courses c2 ON c2.id = t.course_id JOIN school_classes cl ON cl.id = t.class_id JOIN school_subjects sub ON sub.id = c2.subject_id
    WHERE t.company_id = ? AND cl.year_id = ? AND ${overlap} AND (t.class_id = ? ${co.teacher_id ? 'OR c2.teacher_id = ' + Number(co.teacher_id) : ''} ${room ? 'OR t.room = ?' : ''}) LIMIT 1`,
  ...[cid, y, day, end, start, id || 0, co.class_id, ...(room ? [room] : [])]);
  if (clash) {
    const why = clash.class_id === co.class_id ? `la classe a déjà ${clash.subject}` : clash.room === room && room ? `la salle ${room} est prise par ${clash.class_name}` : `l'enseignant a cours en ${clash.class_name}`;
    throw conflict('clash', `Conflit d'emploi du temps : ${why} (${clash.start}–${clash.end})`);
  }
  if (id) db.run('UPDATE school_timetable SET course_id = ?, class_id = ?, day = ?, start = ?, end = ?, room = ? WHERE id = ? AND company_id = ?', co.id, co.class_id, day, start, end, room, id, cid);
  else id = Number(db.run('INSERT INTO school_timetable (company_id, class_id, course_id, day, start, end, room) VALUES (?,?,?,?,?,?,?)', cid, co.class_id, co.id, day, start, end, room).lastInsertRowid);
  return db.get('SELECT * FROM school_timetable WHERE id = ?', id);
}

// ---------------- Lesson log and homework ----------------
export function lessons(db, companyId, q = {}) {
  const where = ['l.company_id = ?']; const p = [companyId];
  if (q.class_id) { where.push('co.class_id = ?'); p.push(q.class_id); }
  if (q.course_id) { where.push('l.course_id = ?'); p.push(q.course_id); }
  if (q.teacher_id) { where.push('co.teacher_id = ?'); p.push(q.teacher_id); }
  if (q.homework) { where.push("l.homework != '' AND l.due_date >= ?"); p.push(today()); }
  return db.all(`SELECT l.*, sub.name subject, cl.name class_name, u.name teacher_name FROM school_lessons l JOIN school_courses co ON co.id = l.course_id JOIN school_subjects sub ON sub.id = co.subject_id
    JOIN school_classes cl ON cl.id = co.class_id LEFT JOIN users u ON u.id = co.teacher_id WHERE ${where.join(' AND ')} ORDER BY l.date DESC, l.id DESC LIMIT 300`, ...p);
}

export function saveLesson(db, bus, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_lessons WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const co = db.get('SELECT * FROM school_courses WHERE id = ? AND company_id = ?', b.course_id ?? cur?.course_id, cid); if (!co) throw bad('course', 'Choisissez le cours');
  if (!MANAGERS.includes(ctx.user.role) && co.teacher_id !== ctx.user.id) throw bad('course', "Ce cours n'est pas le vôtre");
  const title = str(b.title ?? cur?.title, 200); if (!title) throw bad('title', 'Indiquez le titre de la leçon');
  const due = b.due_date ?? cur?.due_date;
  const v = [co.id, vDate(b.date ?? cur?.date, 'date', today()), title, str(b.content ?? cur?.content, 4000), str(b.homework ?? cur?.homework, 2000), due ? vDate(due, 'due_date') : ''];
  if (cur) db.run('UPDATE school_lessons SET course_id = ?, date = ?, title = ?, content = ?, homework = ?, due_date = ? WHERE id = ?', ...v, id);
  else id = Number(db.run('INSERT INTO school_lessons (company_id, course_id, date, title, content, homework, due_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', cid, ...v, ctx.user.id, now()).lastInsertRowid);
  bus?.emit(cid, 'change', { entity: 'school_lesson', id });
  return db.get('SELECT * FROM school_lessons WHERE id = ?', id);
}

// ---------------- Announcements ----------------
export function announcements(db, companyId, classId = null) {
  return db.all(`SELECT a.*, c.name class_name, u.name author FROM school_announcements a LEFT JOIN school_classes c ON c.id = a.class_id LEFT JOIN users u ON u.id = a.created_by
    WHERE a.company_id = ? ${classId ? 'AND (a.class_id IS NULL OR a.class_id = ' + Number(classId) + ')' : ''} ORDER BY a.pinned DESC, a.id DESC LIMIT 100`, companyId);
}

// ---------------- New year and promotion ----------------
/** Opens a new school year: copies classes, courses, timetable and fees; the old year stays readable. */
export function newYear(db, ctx, b) {
  const cid = ctx.user.company_id;
  const cur = activeYear(db, cid);
  const y = Number(String(b.name || '').slice(0, 4)) || Number(cur.name.slice(0, 4)) + 1;
  const name = `${y}-${y + 1}`;
  if (db.get('SELECT 1 FROM school_years WHERE company_id = ? AND name = ?', cid, name)) throw conflict('exists', `L'année ${name} existe déjà`);
  return db.tx(() => {
    const yid = Number(db.run('INSERT INTO school_years (company_id, name, start_date, end_date, seq_dates) VALUES (?,?,?,?,?)', cid, name, `${y}-09-01`, `${y + 1}-06-30`, JSON.stringify(defaultSeqDates(y))).lastInsertRowid);
    const map = {};
    for (const c of db.all('SELECT * FROM school_classes WHERE company_id = ? AND year_id = ? AND active = 1', cid, cur.id)) {
      map[c.id] = Number(db.run('INSERT INTO school_classes (company_id, year_id, level_id, name, room, capacity, head_teacher_id) VALUES (?,?,?,?,?,?,?)', cid, yid, c.level_id, c.name, c.room, c.capacity, c.head_teacher_id).lastInsertRowid);
      for (const co of db.all('SELECT * FROM school_courses WHERE class_id = ?', c.id)) {
        const nid = Number(db.run('INSERT INTO school_courses (company_id, class_id, subject_id, teacher_id, coef, hours, semester, code) VALUES (?,?,?,?,?,?,?,?)', cid, map[c.id], co.subject_id, co.teacher_id, co.coef, co.hours, co.semester, co.code).lastInsertRowid);
        for (const t of db.all('SELECT * FROM school_timetable WHERE course_id = ?', co.id)) db.run('INSERT INTO school_timetable (company_id, class_id, course_id, day, start, end, room) VALUES (?,?,?,?,?,?,?)', cid, map[c.id], nid, t.day, t.start, t.end, t.room);
      }
    }
    const shift = (d) => `${Number(d.slice(0, 4)) + (y - Number(cur.name.slice(0, 4)))}${d.slice(4)}`;
    for (const f of db.all('SELECT * FROM school_fee_items WHERE company_id = ? AND year_id = ? AND active = 1', cid, cur.id)) {
      db.run('INSERT INTO school_fee_items (company_id, year_id, level_id, name, kind, amount, due_date, account_code, position) VALUES (?,?,?,?,?,?,?,?,?)', cid, yid, f.level_id, f.name, f.kind, f.amount, shift(f.due_date), f.account_code, f.position);
    }
    if (b.activate) db.run('UPDATE school_settings SET active_year_id = ? WHERE company_id = ?', yid, cid);
    audit(db, ctx, 'create', 'school_year', yid, name);
    return { id: yid, name, classes: Object.keys(map).length };
  });
}

/** Moves students into a class of another year (promotion or repeat), billing the new year. */
export function promote(db, bus, ctx, company, b) {
  const to = db.get('SELECT * FROM school_classes WHERE id = ? AND company_id = ?', b.to_class_id, company.id); if (!to) throw bad('class', 'Classe de destination introuvable');
  const ids = (Array.isArray(b.student_ids) ? b.student_ids : []).map(Number);
  if (!ids.length) throw bad('students', 'Choisissez les élèves');
  let n = 0;
  db.tx(() => {
    for (const id of ids) {
      const prev = db.get('SELECT e.*, c.level_id FROM school_enrollments e JOIN school_classes c ON c.id = e.class_id WHERE e.student_id = ? AND e.year_id != ? ORDER BY e.id DESC LIMIT 1', id, to.year_id);
      enroll(db, ctx, company, id, { class_id: to.id, repeating: prev ? prev.level_id === to.level_id : false, bill: b.bill !== false });
      n++;
    }
  });
  bus?.emit(company.id, 'change', { entity: 'school_class', id: to.id });
  return { moved: n };
}

export const yearsOf = (db, companyId) => db.all('SELECT y.*, (SELECT COUNT(*) FROM school_enrollments e WHERE e.year_id = y.id) students FROM school_years y WHERE y.company_id = ? ORDER BY y.start_date DESC', companyId);
export const levelsOf = (db, companyId) => db.all('SELECT * FROM school_levels WHERE company_id = ? ORDER BY position, name', companyId);
export { settingsOf };
