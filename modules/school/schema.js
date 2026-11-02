// Teknons École tables: school years, levels (francophone and anglophone
// systems), classes, subjects and the courses taught in each class, students
// and their guardians, enrolments, fee schedule (each instalment becomes a
// Compta invoice), receipts, marks per sequence, class councils, verifiable
// report cards, attendance and gate scans, discipline, timetable, lesson log
// with homework, announcements and online admissions.
import crypto from 'node:crypto';
import { now } from '../../core/schema.js';

export const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
export const shortCode = () => crypto.randomBytes(6).toString('hex').toUpperCase();

export function migrateSchool(db) {
  db.migrate('school-001', `
    CREATE TABLE school_settings (
      company_id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'secondary',        -- nursery, primary, secondary, both, university
      system TEXT NOT NULL DEFAULT 'fr',             -- fr (francophone), en (anglophone), bilingual
      active_year_id INTEGER,
      sequences INTEGER NOT NULL DEFAULT 6,          -- 6 sequences = 3 terms of 2 (Cameroon secondary)
      pass_mark REAL NOT NULL DEFAULT 10,
      honour_mark REAL NOT NULL DEFAULT 12,          -- tableau d'honneur
      encourage_mark REAL NOT NULL DEFAULT 14,       -- encouragements
      congrats_mark REAL NOT NULL DEFAULT 16,        -- félicitations
      warning_mark REAL NOT NULL DEFAULT 8,          -- avertissement travail below this
      day_start TEXT NOT NULL DEFAULT '07:30',
      late_after TEXT NOT NULL DEFAULT '07:40',
      absence_alert_hours INTEGER NOT NULL DEFAULT 10,
      admissions_open INTEGER NOT NULL DEFAULT 1,
      portal_pay INTEGER NOT NULL DEFAULT 1,
      principal_name TEXT DEFAULT '',
      principal_title TEXT DEFAULT 'Le Principal',
      motto TEXT DEFAULT '',
      ministry TEXT DEFAULT 'MINESEC',               -- MINEDUB, MINESEC, MINESUP
      matricule_prefix TEXT DEFAULT 'TKS',
      welcome_text TEXT DEFAULT ''
    );
    CREATE TABLE school_years (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      seq_dates TEXT NOT NULL DEFAULT '[]'           -- JSON [{seq, from, to}]
    );
    CREATE UNIQUE INDEX school_years_name ON school_years(company_id, name);
    CREATE TABLE school_levels (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      cycle TEXT DEFAULT '',
      section TEXT NOT NULL DEFAULT 'fr',
      exam TEXT DEFAULT '',                          -- CEP, BEPC, Probatoire, BAC, GCE O/L, GCE A/L
      position INTEGER NOT NULL DEFAULT 0,
      next_level_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE school_classes (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      year_id INTEGER NOT NULL REFERENCES school_years(id),
      level_id INTEGER NOT NULL REFERENCES school_levels(id),
      name TEXT NOT NULL,
      room TEXT DEFAULT '',
      capacity INTEGER NOT NULL DEFAULT 50,
      head_teacher_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX school_classes_name ON school_classes(company_id, year_id, name);
    CREATE TABLE school_subjects (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      name_en TEXT DEFAULT '',
      code TEXT DEFAULT '',
      grp TEXT NOT NULL DEFAULT 'general',           -- lit, sci, general (groups on the report card)
      color TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX school_subjects_name ON school_subjects(company_id, name);
    CREATE TABLE school_courses (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL REFERENCES school_classes(id),
      subject_id INTEGER NOT NULL REFERENCES school_subjects(id),
      teacher_id INTEGER,
      coef REAL NOT NULL DEFAULT 1,
      hours INTEGER NOT NULL DEFAULT 2              -- hours per week
    );
    CREATE UNIQUE INDEX school_courses_u ON school_courses(class_id, subject_id);
    CREATE TABLE school_students (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      matricule TEXT NOT NULL,
      last_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      sex TEXT NOT NULL DEFAULT 'M',
      birth_date TEXT DEFAULT '',
      birth_place TEXT DEFAULT '',
      nationality TEXT DEFAULT 'Camerounaise',
      photo TEXT DEFAULT '',
      guardian_id INTEGER REFERENCES partners(id),   -- paying parent / guardian (Compta customer)
      guardian_relation TEXT DEFAULT 'Parent',
      guardian2_name TEXT DEFAULT '',
      guardian2_phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      blood_group TEXT DEFAULT '',
      allergies TEXT DEFAULT '',
      medical_notes TEXT DEFAULT '',
      previous_school TEXT DEFAULT '',
      discount_pct REAL NOT NULL DEFAULT 0,          -- scholarship / siblings / staff child, on tuition
      discount_reason TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','graduated')),
      portal_token TEXT NOT NULL,
      card_code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX school_students_mat ON school_students(company_id, matricule);
    CREATE UNIQUE INDEX school_students_tok ON school_students(portal_token);
    CREATE UNIQUE INDEX school_students_card ON school_students(card_code);
    CREATE INDEX school_students_guard ON school_students(guardian_id);
    CREATE TABLE school_enrollments (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL REFERENCES school_students(id),
      year_id INTEGER NOT NULL REFERENCES school_years(id),
      class_id INTEGER NOT NULL REFERENCES school_classes(id),
      repeating INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','left')),
      decision TEXT DEFAULT '',                      -- end of year: promoted, repeat, excluded, graduated
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX school_enr_u ON school_enrollments(student_id, year_id);
    CREATE INDEX school_enr_class ON school_enrollments(class_id);
    CREATE TABLE school_fee_items (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      year_id INTEGER NOT NULL,
      level_id INTEGER,                              -- null = every level
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'tuition' CHECK (kind IN ('registration','tuition','other','optional')),
      amount INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      account_code TEXT NOT NULL DEFAULT '7061',
      position INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE school_student_fees (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      year_id INTEGER NOT NULL,
      fee_item_id INTEGER NOT NULL,
      document_id INTEGER REFERENCES documents(id),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX school_sf_u ON school_student_fees(student_id, fee_item_id);
    CREATE TABLE school_subscriptions (               -- optional services (canteen, transport, clubs)
      student_id INTEGER NOT NULL,
      fee_item_id INTEGER NOT NULL,
      PRIMARY KEY (student_id, fee_item_id)
    );
    CREATE TABLE school_receipts (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      student_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      reference TEXT DEFAULT '',
      payer TEXT DEFAULT '',
      allocations TEXT NOT NULL DEFAULT '[]',        -- JSON [{document_id, number, label, amount, payment_id}]
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE school_marks (
      company_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      mark REAL,
      absent INTEGER NOT NULL DEFAULT 0,
      remark TEXT DEFAULT '',
      updated_by INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (course_id, student_id, sequence)
    );
    CREATE INDEX school_marks_st ON school_marks(student_id, sequence);
    CREATE TABLE school_locks (
      class_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      locked_by INTEGER,
      locked_at TEXT NOT NULL,
      PRIMARY KEY (class_id, sequence)
    );
    CREATE TABLE school_council (
      company_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      period TEXT NOT NULL,                          -- s1..s6, t1..t3, year
      student_id INTEGER NOT NULL,
      distinction TEXT DEFAULT '',                   -- congrats, encourage, honour, warning, blame
      conduct TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      decision TEXT DEFAULT '',                      -- year only: promoted, repeat, excluded
      at TEXT NOT NULL,
      PRIMARY KEY (class_id, period, student_id)
    );
    CREATE TABLE school_bulletins (
      code TEXT PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      year_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      average REAL,
      rank INTEGER,
      size INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX school_bull_u ON school_bulletins(student_id, year_id, period);
    CREATE TABLE school_attendance (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      course_id INTEGER,
      date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('absent','late')),
      hours REAL NOT NULL DEFAULT 0,
      minutes INTEGER NOT NULL DEFAULT 0,
      justified INTEGER NOT NULL DEFAULT 0,
      reason TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'roll',           -- roll, gate
      recorded_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX school_att_st ON school_attendance(student_id, date);
    CREATE INDEX school_att_class ON school_attendance(class_id, date);
    CREATE TABLE school_rolls (                       -- a roll call was taken (even with nobody absent)
      class_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      slot TEXT NOT NULL DEFAULT 'day',
      course_id INTEGER,
      present INTEGER NOT NULL DEFAULT 0,
      absent INTEGER NOT NULL DEFAULT 0,
      by_user INTEGER,
      at TEXT NOT NULL,
      PRIMARY KEY (class_id, date, slot)
    );
    CREATE TABLE school_gate (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      at TEXT NOT NULL,
      date TEXT NOT NULL,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      by_user INTEGER
    );
    CREATE INDEX school_gate_d ON school_gate(company_id, date);
    CREATE TABLE school_discipline (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,                            -- praise, warning, detention, blame, suspension, exclusion
      hours REAL NOT NULL DEFAULT 0,
      days INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0,
      recorded_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX school_disc_st ON school_discipline(student_id);
    CREATE TABLE school_timetable (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL REFERENCES school_courses(id),
      day INTEGER NOT NULL,                          -- 1 Monday .. 6 Saturday
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      room TEXT DEFAULT ''
    );
    CREATE INDEX school_tt_class ON school_timetable(class_id, day);
    CREATE TABLE school_lessons (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      homework TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX school_lessons_c ON school_lessons(course_id, date);
    CREATE TABLE school_announcements (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      class_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE school_applications (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      year_id INTEGER,
      level_id INTEGER,
      last_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      sex TEXT DEFAULT 'M',
      birth_date TEXT DEFAULT '',
      previous_school TEXT DEFAULT '',
      last_average REAL,
      guardian_name TEXT NOT NULL,
      guardian_phone TEXT NOT NULL,
      guardian_email TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','interview','accepted','rejected')),
      interview_at TEXT DEFAULT '',
      student_id INTEGER,
      token TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.migrate('school-002', `
    ALTER TABLE school_settings ADD COLUMN grading TEXT NOT NULL DEFAULT 'sequences';   -- sequences (secondary /20) or lmd (university: CC + exam, credits, GPA)
    ALTER TABLE school_settings ADD COLUMN cc_weight REAL NOT NULL DEFAULT 0.3;         -- LMD: share of continuous assessment
    ALTER TABLE school_settings ADD COLUMN loan_days INTEGER NOT NULL DEFAULT 14;
    ALTER TABLE school_settings ADD COLUMN max_loans INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE school_settings ADD COLUMN fine_per_day INTEGER NOT NULL DEFAULT 100;
    ALTER TABLE school_settings ADD COLUMN repository_public INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE school_courses ADD COLUMN semester INTEGER NOT NULL DEFAULT 0;            -- LMD: 1 or 2 (0 = whole year)
    ALTER TABLE school_courses ADD COLUMN code TEXT DEFAULT '';                           -- LMD: course unit code (UE)
    CREATE TABLE school_assessments (                 -- every test, quiz, homework, practical, exam with its own record
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL REFERENCES school_courses(id),
      sequence INTEGER NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'test',              -- quiz, test, homework, practical, oral, project, exam, mock, resit
      date TEXT NOT NULL,
      max REAL NOT NULL DEFAULT 20,
      weight REAL NOT NULL DEFAULT 1,
      published INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX school_ass_c ON school_assessments(course_id, sequence);
    CREATE TABLE school_scores (
      assessment_id INTEGER NOT NULL REFERENCES school_assessments(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL,
      score REAL,
      absent INTEGER NOT NULL DEFAULT 0,
      comment TEXT DEFAULT '',
      PRIMARY KEY (assessment_id, student_id)
    );
    CREATE TABLE school_exam_results (               -- official exams: CEP, BEPC, Probatoire, BAC, GCE, entrance exams, TOEFL...
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      exam TEXT NOT NULL,
      session TEXT NOT NULL,
      series TEXT DEFAULT '',
      center TEXT DEFAULT '',
      candidate_no TEXT DEFAULT '',
      result TEXT NOT NULL DEFAULT 'registered',       -- registered, passed, failed, absent
      mention TEXT DEFAULT '',
      score TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE school_staff (                        -- teacher / staff file, linked to the user account
      user_id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      title TEXT DEFAULT '',                           -- M., Mme, Dr, Pr
      position TEXT DEFAULT '',                        -- Professeur certifié, Vacataire, Chef de département...
      speciality TEXT DEFAULT '',
      diploma TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'permanent',        -- permanent, part_time (vacataire), visiting
      hourly_rate INTEGER NOT NULL DEFAULT 0,
      hire_date TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      orcid TEXT DEFAULT '',
      photo TEXT DEFAULT ''
    );
    CREATE TABLE school_books (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      isbn TEXT DEFAULT '',
      title TEXT NOT NULL,
      authors TEXT DEFAULT '',
      publisher TEXT DEFAULT '',
      year INTEGER,
      category TEXT DEFAULT '',
      dewey TEXT DEFAULT '',
      language TEXT DEFAULT 'fr',
      copies INTEGER NOT NULL DEFAULT 1,
      location TEXT DEFAULT '',
      cover_color TEXT DEFAULT '',
      ebook_url TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      code TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX school_books_code ON school_books(company_id, code);
    CREATE TABLE school_loans (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL REFERENCES school_books(id),
      student_id INTEGER,
      user_id INTEGER,
      borrowed_at TEXT NOT NULL,
      due_date TEXT NOT NULL,
      returned_at TEXT,
      renewals INTEGER NOT NULL DEFAULT 0,
      fine INTEGER NOT NULL DEFAULT 0,
      fine_paid INTEGER NOT NULL DEFAULT 0,
      by_user INTEGER
    );
    CREATE INDEX school_loans_open ON school_loans(company_id, returned_at);
    CREATE TABLE school_holds (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting'          -- waiting, ready, done, cancelled
    );
    CREATE TABLE school_research (                    -- research projects and laboratories
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      field TEXT DEFAULT '',
      lab TEXT DEFAULT '',
      lead_id INTEGER,
      members TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',           -- proposal, active, completed, suspended
      funding_source TEXT DEFAULT '',
      budget INTEGER NOT NULL DEFAULT 0,
      spent INTEGER NOT NULL DEFAULT 0,
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      abstract TEXT DEFAULT '',
      milestones TEXT NOT NULL DEFAULT '[]',          -- JSON [{title, due, done}]
      created_at TEXT NOT NULL
    );
    CREATE TABLE school_publications (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'article',            -- article, conference, book, chapter, thesis, dissertation, report, dataset, poster
      title TEXT NOT NULL,
      authors TEXT NOT NULL,
      year INTEGER NOT NULL,
      venue TEXT DEFAULT '',                           -- journal, conference, publisher
      doi TEXT DEFAULT '',
      url TEXT DEFAULT '',
      file TEXT DEFAULT '',                            -- data: URL (PDF, small)
      abstract TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      field TEXT DEFAULT '',
      research_id INTEGER,
      student_id INTEGER,
      user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'published',        -- submitted, review, published
      public INTEGER NOT NULL DEFAULT 1,
      views INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE school_theses (                       -- mémoires and theses supervision
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      supervisor_id INTEGER,
      title TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'master',            -- licence, master, phd
      stage TEXT NOT NULL DEFAULT 'proposal',           -- proposal, writing, submitted, defense, defended
      defense_date TEXT DEFAULT '',
      jury TEXT DEFAULT '',
      grade REAL,
      publication_id INTEGER,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE lms_courses (                         -- e-learning: online courses
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      description TEXT DEFAULT '',
      teacher_id INTEGER,
      class_id INTEGER,                                -- null = open course
      category TEXT DEFAULT '',
      level TEXT DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      public INTEGER NOT NULL DEFAULT 0,               -- listed on the public catalogue /learn
      published INTEGER NOT NULL DEFAULT 0,
      cover_color TEXT DEFAULT '',
      certificate INTEGER NOT NULL DEFAULT 1,
      pass_score REAL NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL
    );
    CREATE TABLE lms_lessons (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL REFERENCES lms_courses(id),
      position INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'video',              -- video, text, pdf, quiz, assignment, live
      video_url TEXT DEFAULT '',
      content TEXT DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,             -- minutes
      quiz TEXT NOT NULL DEFAULT '[]',                 -- JSON [{q, choices:[...], answer:index, explain}]
      starts_at TEXT DEFAULT '',                       -- live class
      due_date TEXT DEFAULT '',                        -- assignment
      max_score REAL NOT NULL DEFAULT 20,
      free_preview INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE lms_enrollments (
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      document_id INTEGER,                             -- invoice when the course is paid
      started_at TEXT NOT NULL,
      completed_at TEXT,
      certificate_code TEXT,
      PRIMARY KEY (course_id, student_id)
    );
    CREATE UNIQUE INDEX lms_cert ON lms_enrollments(certificate_code);
    CREATE TABLE lms_progress (
      lesson_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      done_at TEXT NOT NULL,
      score REAL,                                      -- quiz %, or assignment mark
      answer TEXT DEFAULT '',                          -- assignment text / link, or quiz answers JSON
      feedback TEXT DEFAULT '',
      graded_at TEXT,
      PRIMARY KEY (lesson_id, student_id)
    );
  `);
}

// Level presets (Cameroon): francophone and anglophone sub-systems.
export const PRESETS = {
  fr_nursery: { label: 'Maternelle (francophone)', section: 'fr', cycle: 'Maternelle', levels: [['Petite section', ''], ['Moyenne section', ''], ['Grande section', '']] },
  fr_primary: { label: 'Primaire (francophone)', section: 'fr', cycle: 'Primaire', levels: [['SIL', ''], ['CP', ''], ['CE1', ''], ['CE2', ''], ['CM1', ''], ['CM2', 'CEP']] },
  fr_secondary: { label: 'Secondaire général (francophone)', section: 'fr', levels: [['6e', '', 'Premier cycle'], ['5e', '', 'Premier cycle'], ['4e', '', 'Premier cycle'], ['3e', 'BEPC', 'Premier cycle'], ['2nde', '', 'Second cycle'], ['1ère', 'Probatoire', 'Second cycle'], ['Tle', 'Baccalauréat', 'Second cycle']] },
  univ_lmd: { label: 'Université / grande école (LMD)', section: 'fr', levels: [['Licence 1', '', 'Licence'], ['Licence 2', '', 'Licence'], ['Licence 3', 'Licence', 'Licence'], ['Master 1', '', 'Master'], ['Master 2', 'Master', 'Master'], ['Doctorat', 'PhD', 'Doctorat']] },
  en_nursery: { label: 'Nursery (anglophone)', section: 'en', cycle: 'Nursery', levels: [['Nursery 1', ''], ['Nursery 2', '']] },
  en_primary: { label: 'Primary (anglophone)', section: 'en', cycle: 'Primary', levels: [['Class 1', ''], ['Class 2', ''], ['Class 3', ''], ['Class 4', ''], ['Class 5', ''], ['Class 6', 'FSLC']] },
  en_secondary: { label: 'Secondary (anglophone)', section: 'en', levels: [['Form 1', '', 'Secondary'], ['Form 2', '', 'Secondary'], ['Form 3', '', 'Secondary'], ['Form 4', '', 'Secondary'], ['Form 5', 'GCE O/L', 'Secondary'], ['Lower Sixth', '', 'High school'], ['Upper Sixth', 'GCE A/L', 'High school']] },
};

export const SUBJECTS_FR = [
  ['Français', 'French', 'FRA', 'lit'], ['Anglais', 'English', 'ANG', 'lit'], ['Histoire-Géographie', 'History-Geography', 'HG', 'lit'], ['Éducation à la citoyenneté', 'Citizenship', 'ECM', 'lit'],
  ['Langue vivante 2 (Allemand / Espagnol)', 'Second language', 'LV2', 'lit'], ['Langues et cultures nationales', 'National languages', 'LCN', 'lit'], ['Philosophie', 'Philosophy', 'PHI', 'lit'],
  ['Mathématiques', 'Mathematics', 'MAT', 'sci'], ['Physique-Chimie-Technologie', 'Physics-Chemistry', 'PCT', 'sci'], ['Sciences de la vie et de la Terre', 'Biology', 'SVT', 'sci'], ['Informatique', 'Computer science', 'INF', 'sci'],
  ['Éducation physique et sportive', 'Physical education', 'EPS', 'general'], ['Travail manuel / ESF', 'Manual work', 'TM', 'general'],
];

export function schoolYearFor(date = new Date()) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1;
  const start = m >= 8 ? y : y - 1;
  return { name: `${start}-${start + 1}`, start_date: `${start}-09-01`, end_date: `${start + 1}-06-30`, y: start };
}

/** Default sequence windows for a year starting in September (6 sequences). */
export function defaultSeqDates(y) {
  return [
    { seq: 1, from: `${y}-09-07`, to: `${y}-10-10` }, { seq: 2, from: `${y}-10-12`, to: `${y}-11-28` },
    { seq: 3, from: `${y}-12-01`, to: `${y + 1}-01-30` }, { seq: 4, from: `${y + 1}-02-02`, to: `${y + 1}-03-13` },
    { seq: 5, from: `${y + 1}-03-30`, to: `${y + 1}-05-08` }, { seq: 6, from: `${y + 1}-05-11`, to: `${y + 1}-06-05` },
  ];
}

export function addLevels(db, companyId, preset) {
  const p = PRESETS[preset];
  if (!p) return 0;
  const base = db.get('SELECT COALESCE(MAX(position),0) m FROM school_levels WHERE company_id = ?', companyId).m;
  let prev = null, n = 0;
  p.levels.forEach(([name, exam, cycle], i) => {
    if (db.get('SELECT 1 FROM school_levels WHERE company_id = ? AND name = ?', companyId, name)) return;
    const r = db.run('INSERT INTO school_levels (company_id, name, cycle, section, exam, position) VALUES (?,?,?,?,?,?)', companyId, name, cycle || p.cycle || '', p.section, exam || '', base + i + 1);
    const id = Number(r.lastInsertRowid);
    if (prev) db.run('UPDATE school_levels SET next_level_id = ? WHERE id = ?', id, prev);
    prev = id; n++;
  });
  return n;
}

export function seedCompanySchool(db, companyId) {
  db.run('INSERT OR IGNORE INTO school_settings (company_id) VALUES (?)', companyId);
  for (const [code, name] of [['7061', 'Frais de scolarité'], ['7062', "Frais d'inscription et d'examen"], ['7068', 'Services scolaires (cantine, transport, tenues, activités)']]) {
    if (!db.get('SELECT 1 FROM accounts WHERE company_id = ? AND code = ?', companyId, code)) db.run('INSERT INTO accounts (company_id, code, name, class) VALUES (?,?,?,7)', companyId, code, name);
  }
  const s = db.get('SELECT * FROM school_settings WHERE company_id = ?', companyId);
  if (!s.active_year_id) {
    const y = schoolYearFor();
    let row = db.get('SELECT id FROM school_years WHERE company_id = ? AND name = ?', companyId, y.name);
    if (!row) row = { id: Number(db.run('INSERT INTO school_years (company_id, name, start_date, end_date, seq_dates) VALUES (?,?,?,?,?)', companyId, y.name, y.start_date, y.end_date, JSON.stringify(defaultSeqDates(y.y))).lastInsertRowid) };
    db.run('UPDATE school_settings SET active_year_id = ? WHERE company_id = ?', row.id, companyId);
    if (!db.get('SELECT 1 FROM school_levels WHERE company_id = ?', companyId)) addLevels(db, companyId, 'fr_secondary');
    if (!db.get('SELECT 1 FROM school_subjects WHERE company_id = ?', companyId)) {
      for (const [name, en, code, grp] of SUBJECTS_FR) db.run('INSERT INTO school_subjects (company_id, name, name_en, code, grp) VALUES (?,?,?,?,?)', companyId, name, en, code, grp);
    }
    if (!db.get('SELECT 1 FROM school_fee_items WHERE company_id = ?', companyId)) {
      const yy = y.y;
      const items = [
        ['Inscription', 'registration', 25000, `${yy}-09-05`, '7062', 1], ['Scolarité – 1re tranche', 'tuition', 60000, `${yy}-10-05`, '7061', 2],
        ['Scolarité – 2e tranche', 'tuition', 50000, `${yy + 1}-01-15`, '7061', 3], ['Scolarité – 3e tranche', 'tuition', 40000, `${yy + 1}-04-10`, '7061', 4],
        ['APE (association des parents)', 'other', 10000, `${yy}-10-05`, '7068', 5], ['Cantine (année)', 'optional', 90000, `${yy}-10-05`, '7068', 6], ['Transport scolaire (année)', 'optional', 120000, `${yy}-10-05`, '7068', 7],
      ];
      for (const [name, kind, amount, due, acc, pos] of items) db.run('INSERT INTO school_fee_items (company_id, year_id, name, kind, amount, due_date, account_code, position) VALUES (?,?,?,?,?,?,?,?)', companyId, row.id, name, kind, amount, due, acc, pos);
    }
  }
}

export const settingsOf = (db, companyId) => db.get('SELECT * FROM school_settings WHERE company_id = ?', companyId);
export const activeYear = (db, companyId) => db.get('SELECT y.* FROM school_years y JOIN school_settings s ON s.active_year_id = y.id WHERE s.company_id = ?', companyId);
export const stamp = now;
