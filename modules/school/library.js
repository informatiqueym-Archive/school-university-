// Library (catalogue, copies, loans, renewals, holds, overdue fines, e-books),
// research (projects, laboratories, budgets, milestones), the publications
// repository (open access page with views and downloads) and thesis supervision.
import { bad, notFound, conflict } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate, addDays } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { raiseAlert, audit } from '../../core/alerts.js';
import { settingsOf, shortCode } from './schema.js';

// ---------------- Catalogue ----------------
export function books(db, companyId, q = {}) {
  const where = ['b.company_id = ?', 'b.active = 1']; const p = [companyId];
  if (q.q) { where.push('(b.title LIKE ? OR b.authors LIKE ? OR b.isbn LIKE ? OR b.code = ? OR b.category LIKE ?)'); const s = `%${q.q}%`; p.push(s, s, s, String(q.q).toUpperCase(), s); }
  if (q.category) { where.push('b.category = ?'); p.push(q.category); }
  if (q.ebook) where.push("b.ebook_url != ''");
  return db.all(`SELECT b.*, (SELECT COUNT(*) FROM school_loans l WHERE l.book_id = b.id AND l.returned_at IS NULL) out,
      (SELECT COUNT(*) FROM school_loans l WHERE l.book_id = b.id) loans_total,
      (SELECT COUNT(*) FROM school_holds h WHERE h.book_id = b.id AND h.status = 'waiting') holds
    FROM school_books b WHERE ${where.join(' AND ')} ORDER BY b.title LIMIT ${Math.min(Number(q.limit) || 500, 2000)}`, ...p).map((b) => ({ ...b, available: Math.max(0, b.copies - b.out) }));
}

export function saveBook(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_books WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const title = str(b.title ?? cur?.title, 250); if (!title) throw bad('title', 'Titre obligatoire');
  const url = str(b.ebook_url ?? cur?.ebook_url, 500);
  if (url && !/^https?:\/\//.test(url)) throw bad('url', 'Lien du livre numérique invalide (https://...)');
  const v = [str(b.isbn ?? cur?.isbn, 20), title, str(b.authors ?? cur?.authors, 250), str(b.publisher ?? cur?.publisher, 120), b.year ?? cur?.year ? int(b.year ?? cur?.year, 'year', { min: 0 }) : null,
    str(b.category ?? cur?.category, 60), str(b.dewey ?? cur?.dewey, 20), str(b.language ?? cur?.language, 10) || 'fr', int(b.copies ?? cur?.copies, 'copies', { min: 0, def: 1 }), str(b.location ?? cur?.location, 60),
    str(b.cover_color ?? cur?.cover_color, 9), url, str(b.summary ?? cur?.summary, 2000)];
  if (cur) db.run('UPDATE school_books SET isbn = ?, title = ?, authors = ?, publisher = ?, year = ?, category = ?, dewey = ?, language = ?, copies = ?, location = ?, cover_color = ?, ebook_url = ?, summary = ?, active = ? WHERE id = ?', ...v, b.active === undefined ? cur.active : (b.active ? 1 : 0), id);
  else id = Number(db.run('INSERT INTO school_books (company_id, isbn, title, authors, publisher, year, category, dewey, language, copies, location, cover_color, ebook_url, summary, code, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cid, ...v, 'LIV' + shortCode().slice(0, 7), now()).lastInsertRowid);
  audit(db, ctx, cur ? 'update' : 'create', 'school_book', id, title);
  return db.get('SELECT * FROM school_books WHERE id = ?', id);
}

// ---------------- Loans ----------------
const fineOf = (s, l, at = today()) => { if (l.returned_at) return l.fine; const late = Math.floor((Date.parse(at) - Date.parse(l.due_date)) / 864e5); return late > 0 ? late * s.fine_per_day : 0; };

export function loans(db, companyId, q = {}) {
  const s = settingsOf(db, companyId);
  const where = ['l.company_id = ?']; const p = [companyId];
  if (q.open) where.push('l.returned_at IS NULL');
  if (q.overdue) { where.push('l.returned_at IS NULL AND l.due_date < ?'); p.push(today()); }
  if (q.student_id) { where.push('l.student_id = ?'); p.push(q.student_id); }
  if (q.book_id) { where.push('l.book_id = ?'); p.push(q.book_id); }
  return db.all(`SELECT l.*, b.title, b.authors, b.code book_code, s.last_name, s.first_name, s.matricule, u.name user_name, c.name class_name
    FROM school_loans l JOIN school_books b ON b.id = l.book_id LEFT JOIN school_students s ON s.id = l.student_id LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN school_enrollments e ON e.student_id = s.id AND e.status = 'enrolled' AND e.year_id = (SELECT active_year_id FROM school_settings WHERE company_id = l.company_id) LEFT JOIN school_classes c ON c.id = e.class_id
    WHERE ${where.join(' AND ')} ORDER BY l.returned_at IS NOT NULL, l.due_date LIMIT 1000`, ...p).map((l) => ({ ...l, borrower: l.student_id ? `${l.last_name} ${l.first_name}` : l.user_name, fine_due: fineOf(s, l) - l.fine_paid, overdue: !l.returned_at && l.due_date < today() }));
}

export function borrow(db, bus, ctx, b) {
  const cid = ctx.user.company_id; const s = settingsOf(db, cid);
  const book = db.get('SELECT * FROM school_books WHERE company_id = ? AND (id = ? OR code = ? OR (isbn != \'\' AND isbn = ?)) AND active = 1', cid, Number(b.book_id) || 0, str(b.code, 20).toUpperCase(), str(b.code, 20)); if (!book) throw notFound('Livre introuvable');
  const out = db.get('SELECT COUNT(*) n FROM school_loans WHERE book_id = ? AND returned_at IS NULL', book.id).n;
  if (out >= book.copies) throw conflict('unavailable', `Tous les exemplaires de « ${book.title} » sont prêtés. Réservez-le pour l'élève.`);
  let studentId = null, userId = null;
  if (b.student_id || b.student_code) {
    const st = db.get('SELECT * FROM school_students WHERE company_id = ? AND (id = ? OR matricule = ? OR card_code = ?)', cid, Number(b.student_id) || 0, str(b.student_code, 30), str(b.student_code, 30).toUpperCase());
    if (!st) throw notFound('Lecteur introuvable');
    if (st.status !== 'active') throw conflict('inactive', 'Cet élève ne fait plus partie de l\'établissement');
    const n = db.get('SELECT COUNT(*) n FROM school_loans WHERE student_id = ? AND returned_at IS NULL', st.id).n;
    if (n >= s.max_loans) throw conflict('max', `Déjà ${n} livre(s) en prêt (maximum ${s.max_loans})`);
    const late = db.get('SELECT COUNT(*) n FROM school_loans WHERE student_id = ? AND returned_at IS NULL AND due_date < ?', st.id, today()).n;
    if (late) throw conflict('late', 'Ce lecteur a un livre en retard : il doit d\'abord le rendre');
    studentId = st.id;
  } else if (b.user_id) {
    userId = db.get('SELECT id FROM users WHERE id = ? AND company_id = ?', b.user_id, cid)?.id; if (!userId) throw notFound('Membre du personnel introuvable');
  } else throw bad('borrower', 'Choisissez le lecteur');
  const days = int(b.days, 'days', { min: 1, def: userId ? s.loan_days * 2 : s.loan_days });
  const id = Number(db.run('INSERT INTO school_loans (company_id, book_id, student_id, user_id, borrowed_at, due_date, by_user) VALUES (?,?,?,?,?,?,?)', cid, book.id, studentId, userId, now(), addDays(today(), days), ctx.user.id).lastInsertRowid);
  if (studentId) db.run("UPDATE school_holds SET status = 'done' WHERE book_id = ? AND student_id = ? AND status IN ('waiting','ready')", book.id, studentId);
  bus?.emit(cid, 'change', { entity: 'school_loan', id });
  return loans(db, cid, {}).find((l) => l.id === id);
}

export function giveBack(db, bus, ctx, id, b = {}) {
  const cid = ctx.user.company_id; const s = settingsOf(db, cid);
  const l = db.get('SELECT * FROM school_loans WHERE id = ? AND company_id = ?', id, cid); if (!l) throw notFound();
  if (l.returned_at) throw conflict('done', 'Déjà rendu');
  const fine = b.waive ? 0 : fineOf(s, l);
  db.run('UPDATE school_loans SET returned_at = ?, fine = ?, fine_paid = ? WHERE id = ?', now(), fine, b.paid ? fine : 0, id);
  // First hold in line is now ready.
  const hold = db.get("SELECT h.*, s.last_name, s.first_name FROM school_holds h JOIN school_students s ON s.id = h.student_id WHERE h.book_id = ? AND h.status = 'waiting' ORDER BY h.id LIMIT 1", l.book_id);
  if (hold) {
    db.run("UPDATE school_holds SET status = 'ready' WHERE id = ?", hold.id);
    const book = db.get('SELECT title FROM school_books WHERE id = ?', l.book_id);
    raiseAlert(db, bus, cid, { kind: 'library_hold', level: 'info', title: `Réservation prête : « ${book.title} » pour ${hold.last_name} ${hold.first_name}`, entity: 'school_hold', entity_id: hold.id });
  }
  bus?.emit(cid, 'change', { entity: 'school_loan', id });
  return { ok: true, fine, hold_ready: !!hold };
}

export function renew(db, ctx, id) {
  const cid = ctx.user.company_id; const s = settingsOf(db, cid);
  const l = db.get('SELECT * FROM school_loans WHERE id = ? AND company_id = ?', id, cid); if (!l || l.returned_at) throw notFound();
  if (l.renewals >= 2) throw conflict('max', 'Déjà prolongé deux fois');
  if (db.get("SELECT 1 FROM school_holds WHERE book_id = ? AND status = 'waiting'", l.book_id)) throw conflict('hold', 'Un autre lecteur attend ce livre');
  const due = addDays(l.due_date > today() ? l.due_date : today(), s.loan_days);
  db.run('UPDATE school_loans SET due_date = ?, renewals = renewals + 1 WHERE id = ?', due, id);
  return { ok: true, due_date: due };
}

export function hold(db, bus, companyId, bookId, studentId) {
  const book = db.get('SELECT * FROM school_books WHERE id = ? AND company_id = ?', bookId, companyId); if (!book) throw notFound('Livre introuvable');
  if (db.get("SELECT 1 FROM school_holds WHERE book_id = ? AND student_id = ? AND status IN ('waiting','ready')", bookId, studentId)) throw conflict('already', 'Déjà réservé');
  const id = Number(db.run('INSERT INTO school_holds (company_id, book_id, student_id, created_at) VALUES (?,?,?,?)', companyId, bookId, studentId, now()).lastInsertRowid);
  bus?.emit(companyId, 'change', { entity: 'school_hold', id });
  return { id, position: db.get("SELECT COUNT(*) n FROM school_holds WHERE book_id = ? AND status = 'waiting'", bookId).n };
}

export function libraryStats(db, companyId) {
  const t = today();
  return {
    titles: db.get('SELECT COUNT(*) n FROM school_books WHERE company_id = ? AND active = 1', companyId).n,
    copies: db.get('SELECT COALESCE(SUM(copies),0) n FROM school_books WHERE company_id = ? AND active = 1', companyId).n,
    ebooks: db.get("SELECT COUNT(*) n FROM school_books WHERE company_id = ? AND active = 1 AND ebook_url != ''", companyId).n,
    out: db.get('SELECT COUNT(*) n FROM school_loans WHERE company_id = ? AND returned_at IS NULL', companyId).n,
    overdue: db.get('SELECT COUNT(*) n FROM school_loans WHERE company_id = ? AND returned_at IS NULL AND due_date < ?', companyId, t).n,
    month: db.get("SELECT COUNT(*) n FROM school_loans WHERE company_id = ? AND borrowed_at >= date('now','start of month')", companyId).n,
    holds: db.get("SELECT COUNT(*) n FROM school_holds WHERE company_id = ? AND status IN ('waiting','ready')", companyId).n,
    top: db.all('SELECT b.title, b.authors, COUNT(*) n FROM school_loans l JOIN school_books b ON b.id = l.book_id WHERE l.company_id = ? GROUP BY b.id ORDER BY n DESC LIMIT 6', companyId),
    readers: db.all("SELECT s.last_name || ' ' || s.first_name name, COUNT(*) n FROM school_loans l JOIN school_students s ON s.id = l.student_id WHERE l.company_id = ? GROUP BY s.id ORDER BY n DESC LIMIT 6", companyId),
    categories: db.all("SELECT COALESCE(NULLIF(category,''),'—') category, COUNT(*) n FROM school_books WHERE company_id = ? AND active = 1 GROUP BY 1 ORDER BY n DESC", companyId),
  };
}

// ---------------- Research ----------------
export function research(db, companyId) {
  return db.all(`SELECT r.*, u.name lead_name, (SELECT COUNT(*) FROM school_publications p WHERE p.research_id = r.id) publications FROM school_research r LEFT JOIN users u ON u.id = r.lead_id
    WHERE r.company_id = ? ORDER BY r.status = 'active' DESC, r.id DESC`, companyId).map((r) => ({ ...r, milestones: safe(r.milestones) }));
}
const safe = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

export function saveResearch(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_research WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const title = str(b.title ?? cur?.title, 250); if (!title) throw bad('title', 'Titre du projet obligatoire');
  const ms = Array.isArray(b.milestones) ? b.milestones.slice(0, 30).map((m) => ({ title: str(m.title, 120), due: str(m.due, 10), done: !!m.done })).filter((m) => m.title) : safe(cur?.milestones);
  const v = [title, str(b.field ?? cur?.field, 80), str(b.lab ?? cur?.lab, 120), b.lead_id === undefined ? cur?.lead_id ?? ctx.user.id : (Number(b.lead_id) || null), str(b.members ?? cur?.members, 500),
    oneOf(b.status ?? cur?.status, ['proposal', 'active', 'completed', 'suspended'], 'status', 'active'), str(b.funding_source ?? cur?.funding_source, 160), int(b.budget ?? cur?.budget, 'budget', { min: 0, def: 0 }),
    int(b.spent ?? cur?.spent, 'spent', { min: 0, def: 0 }), str(b.start_date ?? cur?.start_date, 10), str(b.end_date ?? cur?.end_date, 10), str(b.abstract ?? cur?.abstract, 4000), JSON.stringify(ms)];
  if (cur) db.run('UPDATE school_research SET title = ?, field = ?, lab = ?, lead_id = ?, members = ?, status = ?, funding_source = ?, budget = ?, spent = ?, start_date = ?, end_date = ?, abstract = ?, milestones = ? WHERE id = ?', ...v, id);
  else id = Number(db.run('INSERT INTO school_research (company_id, title, field, lab, lead_id, members, status, funding_source, budget, spent, start_date, end_date, abstract, milestones, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cid, ...v, now()).lastInsertRowid);
  audit(db, ctx, cur ? 'update' : 'create', 'school_research', id, title);
  return research(db, cid).find((r) => r.id === id);
}

// ---------------- Publications ----------------
export const PUB_KINDS = { article: ['Article de revue', 'Journal article'], conference: ['Communication', 'Conference paper'], book: ['Ouvrage', 'Book'], chapter: ["Chapitre d'ouvrage", 'Book chapter'],
  thesis: ['Thèse de doctorat', 'PhD thesis'], dissertation: ['Mémoire', 'Dissertation'], report: ['Rapport', 'Report'], dataset: ['Jeu de données', 'Dataset'], poster: ['Poster', 'Poster'] };

export function publications(db, companyId, q = {}, { publicOnly = false } = {}) {
  const where = ['p.company_id = ?']; const pr = [companyId];
  if (publicOnly) where.push("p.public = 1 AND p.status = 'published'");
  if (q.q) { where.push('(p.title LIKE ? OR p.authors LIKE ? OR p.keywords LIKE ? OR p.abstract LIKE ?)'); const s = `%${q.q}%`; pr.push(s, s, s, s); }
  if (q.kind) { where.push('p.kind = ?'); pr.push(q.kind); }
  if (q.year) { where.push('p.year = ?'); pr.push(Number(q.year)); }
  if (q.field) { where.push('p.field = ?'); pr.push(q.field); }
  return db.all(`SELECT p.id, p.kind, p.title, p.authors, p.year, p.venue, p.doi, p.url, (p.file != '') has_file, p.abstract, p.keywords, p.field, p.research_id, p.student_id, p.user_id, p.status, p.public, p.views, p.downloads, p.code, p.created_at, r.title research_title
    FROM school_publications p LEFT JOIN school_research r ON r.id = p.research_id WHERE ${where.join(' AND ')} ORDER BY p.year DESC, p.id DESC LIMIT 500`, ...pr);
}

export function savePublication(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_publications WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const title = str(b.title ?? cur?.title, 300), authors = str(b.authors ?? cur?.authors, 500);
  if (!title || !authors) throw bad('title', 'Titre et auteurs obligatoires');
  const file = b.file === undefined ? cur?.file || '' : String(b.file || '');
  if (file && (!/^data:application\/pdf;base64,/.test(file) || file.length > 1_900_000)) throw bad('file', 'Fichier PDF invalide (1,4 Mo maximum ; au-delà, donnez un lien)');
  const url = str(b.url ?? cur?.url, 500); if (url && !/^https?:\/\//.test(url)) throw bad('url', 'Lien invalide');
  const v = [oneOf(b.kind ?? cur?.kind, Object.keys(PUB_KINDS), 'kind', 'article'), title, authors, int(b.year ?? cur?.year, 'year', { min: 1900, def: Number(today().slice(0, 4)) }), str(b.venue ?? cur?.venue, 250),
    str(b.doi ?? cur?.doi, 120), url, file, str(b.abstract ?? cur?.abstract, 6000), str(b.keywords ?? cur?.keywords, 300), str(b.field ?? cur?.field, 80), Number(b.research_id ?? cur?.research_id) || null,
    Number(b.student_id ?? cur?.student_id) || null, oneOf(b.status ?? cur?.status, ['submitted', 'review', 'published'], 'status', 'published'), (b.public ?? cur?.public ?? 1) ? 1 : 0];
  if (cur) db.run('UPDATE school_publications SET kind = ?, title = ?, authors = ?, year = ?, venue = ?, doi = ?, url = ?, file = ?, abstract = ?, keywords = ?, field = ?, research_id = ?, student_id = ?, status = ?, public = ? WHERE id = ?', ...v, id);
  else id = Number(db.run('INSERT INTO school_publications (company_id, kind, title, authors, year, venue, doi, url, file, abstract, keywords, field, research_id, student_id, status, public, user_id, code, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cid, ...v, ctx.user.id, shortCode(), now()).lastInsertRowid);
  audit(db, ctx, cur ? 'update' : 'create', 'school_publication', id, title);
  return publications(db, cid, {}).find((p) => p.id === id);
}

/** Citation in APA style, used on the repository and in exports. */
export function cite(p) {
  return `${p.authors} (${p.year}). ${p.title}.${p.venue ? ` ${p.venue}.` : ''}${p.doi ? ` https://doi.org/${p.doi.replace(/^https?:\/\/doi.org\//, '')}` : ''}`;
}

// ---------------- Theses ----------------
export function theses(db, companyId) {
  return db.all(`SELECT t.*, s.last_name, s.first_name, s.matricule, u.name supervisor_name FROM school_theses t JOIN school_students s ON s.id = t.student_id LEFT JOIN users u ON u.id = t.supervisor_id
    WHERE t.company_id = ? ORDER BY t.stage = 'defended', t.defense_date, t.id DESC`, companyId);
}
export function saveThesis(db, ctx, b, id = null) {
  const cid = ctx.user.company_id;
  const cur = id ? db.get('SELECT * FROM school_theses WHERE id = ? AND company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound();
  const st = db.get('SELECT id FROM school_students WHERE id = ? AND company_id = ?', b.student_id ?? cur?.student_id, cid); if (!st) throw bad('student', 'Choisissez l\'étudiant');
  const title = str(b.title ?? cur?.title, 300); if (!title) throw bad('title', 'Sujet obligatoire');
  const grade = b.grade ?? cur?.grade;
  const v = [st.id, Number(b.supervisor_id ?? cur?.supervisor_id) || null, title, oneOf(b.level ?? cur?.level, ['licence', 'master', 'phd'], 'level', 'master'),
    oneOf(b.stage ?? cur?.stage, ['proposal', 'writing', 'submitted', 'defense', 'defended'], 'stage', 'proposal'), b.defense_date ?? cur?.defense_date ? vDate(b.defense_date ?? cur?.defense_date, 'defense_date') : '',
    str(b.jury ?? cur?.jury, 500), grade === '' || grade == null ? null : num(grade, 'grade', { min: 0 }), str(b.notes ?? cur?.notes, 2000)];
  if (cur) db.run('UPDATE school_theses SET student_id = ?, supervisor_id = ?, title = ?, level = ?, stage = ?, defense_date = ?, jury = ?, grade = ?, notes = ? WHERE id = ?', ...v, id);
  else id = Number(db.run('INSERT INTO school_theses (company_id, student_id, supervisor_id, title, level, stage, defense_date, jury, grade, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', cid, ...v, now()).lastInsertRowid);
  return theses(db, cid).find((t) => t.id === id);
}
