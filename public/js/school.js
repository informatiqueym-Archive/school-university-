// Teknons École (schools and universities): navigation, dashboard, students
// and their 360° file, classes, admissions, fees and the bursar's till.
// Marks, results, attendance, timetable, library, research, e-learning, staff
// and settings are in school-ops.js.
import { api } from './api.js';
import { state, L, esc, money, moneyShort, num, dt, today, icon, can, canAny, table, field, dialog, toast, showError, confirmDlg, offlineNote, qs } from './ui.js';

export const routes = [];
export const R = (path, fn, live = false) => routes.push([path, fn, live]);
export const S = () => state.school;
export const fail = (e) => { if (!e?.quiet) showError(e); };
export const isManager = () => ['owner', 'admin', 'manager'].includes(state.me.user.role);
export const isTeacher = () => state.me.user.role === 'teacher';
export const lmd = () => S()?.settings?.grading === 'lmd';
export async function refreshMeta() { try { state.school = await api.get('/api/school/meta', { cache: false }); } catch {} }
export const kpi = (l, v, s = '', cls = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="card kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></${href ? 'a' : 'div'}>`;
export const dec = (n, d = 2) => (n == null || n === '' ? '—' : String(Math.round(Number(n) * 10 ** d) / 10 ** d).replace('.', state.lang === 'en' ? '.' : ','));
export const avgCls = (v) => (v == null ? '' : v < (S()?.settings?.pass_mark ?? 10) ? 'bad-t' : v >= 14 ? 'ok-t' : '');
export const waNumber = (p) => String(p || '').replace(/\D/g, '').replace(/^(6\d{8})$/, '237$1');
export const wa = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
export const avatar = (s, size = 36) => `<span class="sc-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px" data-sex="${esc(s.sex || '')}">${esc(((s.last_name || s.name || '?')[0] || '') + ((s.first_name || '')[0] || ''))}</span>`;
export const classOpts = (all = true) => [...(all ? [['', L('Toutes les classes', 'All classes')]] : []), ...(S()?.classes || []).map((c) => [c.id, c.name])];
export const periodName = (p) => { const x = S()?.periods?.find((y) => y.id === p); return x ? L(x.fr, x.en) : p; };
export const distName = (d) => { const x = S()?.distinctions?.[d]; return x ? L(x[0], x[1]) : ''; };
export const DISC = (k) => { const x = S()?.discipline?.[k]; return x ? L(x.fr, x.en) : k; };
const METHODS = { cash: ['Espèces', 'Cash'], mtn_momo: ['MTN MoMo', 'MTN MoMo'], orange_money: ['Orange Money', 'Orange Money'], bank: ['Virement', 'Bank transfer'], cheque: ['Chèque', 'Cheque'] };
export const methodName = (m) => L(...(METHODS[m] || [m, m]));

// ===================== Navigation =====================
export function nav(item) {
  const office = canAny('schooloffice', 'settings'), teach = can('teaching'), money_ = canAny('treasury', 'sales');
  return `<h6>${L('Vie scolaire', 'School life')}</h6>
  ${item('/school/students', 'users', lmd() ? 'Étudiants' : 'Élèves', lmd() ? 'Students' : 'Students', can('read'))}
  ${item('/school/classes', 'store', lmd() ? 'Promotions et UE' : 'Classes et matières', lmd() ? 'Cohorts & units' : 'Classes & subjects')}
  ${item('/school/admissions', 'clipboard', 'Admissions', 'Admissions', office)}
  ${item('/school/roll', 'check', "Appel et absences", 'Roll call & absences', canAny('teaching', 'discipline', 'schooloffice'))}
  ${item('/school/gate', 'scan', 'Portail (entrées)', 'Gate check-in', canAny('discipline', 'schooloffice'))}
  ${item('/school/discipline', 'shield', 'Discipline', 'Discipline', canAny('discipline', 'schooloffice', 'teaching'))}
  ${item('/school/timetable', 'calendar', 'Emploi du temps', 'Timetable')}
  <h6>${L('Pédagogie', 'Teaching')}</h6>
  ${item('/school/marks', 'edit', 'Saisie des notes', 'Enter marks', teach)}
  ${item('/school/assessments', 'clipboard', 'Évaluations et examens', 'Tests & exams', canAny('teaching', 'schooloffice'))}
  ${item('/school/results', 'star', lmd() ? 'Résultats et relevés' : 'Résultats et bulletins', lmd() ? 'Results & transcripts' : 'Results & report cards', canAny('teaching', 'schooloffice', 'reports'))}
  ${item('/school/lessons', 'book', 'Cahier de textes', 'Lesson log', canAny('teaching', 'schooloffice'))}
  ${item('/school/elearning', 'monitor', 'Cours en ligne', 'E-learning', canAny('teaching', 'schooloffice'))}
  ${item('/school/exams', 'gift', 'Examens officiels', 'Official exams', office)}
  <h6>${L('Savoir', 'Knowledge')}</h6>
  ${item('/school/library', 'book', 'Bibliothèque', 'Library')}
  ${item('/school/research', 'globe', 'Recherche et publications', 'Research & publications')}
  <h6>${L('Gestion', 'Management')}</h6>
  ${item('/school/fees', 'cash', 'Frais et recouvrement', 'Fees & collection', money_ || can('reports'))}
  ${item('/school/staff', 'user', 'Enseignants et personnel', 'Teachers & staff', canAny('users', 'schooloffice', 'reports'))}
  ${item('/school/insights', 'chart', 'Alertes précoces', 'Early warning', canAny('teaching', 'schooloffice', 'reports'))}
  ${item('/school/announcements', 'bell', 'Annonces aux parents', 'Announcements', canAny('schooloffice', 'settings', 'teaching'))}
  ${item('/school/settings', 'gear', "Réglages de l'établissement", 'School settings', can('settings'))}`;
}
export function bottomNav() {
  if (isTeacher()) return `<a href="#/" data-nav="/">${icon('home')}${L('Ma journée', 'My day')}</a><a href="#/school/roll" data-nav="/school/roll">${icon('check')}${L('Appel', 'Roll')}</a><a href="#/school/marks" data-nav="/school/marks">${icon('edit')}${L('Notes', 'Marks')}</a><a href="#/school/lessons" data-nav="/school/lessons">${icon('book')}${L('Cahier', 'Log')}</a>`;
  return `<a href="#/" data-nav="/">${icon('home')}${L('Accueil', 'Home')}</a><a href="#/school/students" data-nav="/school/students">${icon('users')}${L('Élèves', 'Students')}</a>
    <a href="#/school/fees" data-nav="/school/fees">${icon('cash')}${L('Frais', 'Fees')}</a><a href="#/school/results" data-nav="/school/results">${icon('star')}${L('Notes', 'Results')}</a>`;
}

// ===================== Dashboard =====================
export async function dashboard(ctx) {
  if (isTeacher()) return teacherHome(ctx);
  ctx.title(L(`Tableau de bord · ${S().year?.name || ''}`, `Dashboard · ${S().year?.name || ''}`));
  ctx.actions(`${canAny('treasury', 'sales') ? `<a class="btn" href="#/school/fees?tab=till">${icon('cash')}<span class="hide-m">${L('Encaisser', 'Collect fees')}</span></a>` : ''}${canAny('schooloffice', 'settings') ? `<button class="btn primary" id="newst">${icon('plus')}<span class="hide-m">${L('Inscrire', 'Enrol')}</span></button>` : ''}`);
  const d = await api.get('/api/school/dashboard');
  document.getElementById('newst')?.addEventListener('click', () => studentDialog());
  const f = d.fees; const st = d.students;
  const maxT = Math.max(1, ...f.trend.map((x) => x.v));
  const totalM = f.methods.reduce((a, b) => a + b.v, 0) || 1;
  const g = d.attendance.gate;
  ctx.el.innerHTML = `${offlineNote(d)}
  ${d.applications ? `<div class="card banner info"><b>${d.applications} ${L('dossier(s) d\'admission à traiter', 'admission file(s) to review')}</b> · <a href="#/school/admissions">${L('Ouvrir', 'Open')}</a></div>` : ''}
  <div class="grid g4">
    ${kpi(lmd() ? L('Étudiants inscrits', 'Enrolled students') : L('Élèves inscrits', 'Enrolled students'), num(st.n), `${st.girls} ${L('filles', 'girls')} · ${st.boys} ${L('garçons', 'boys')} · ${d.classes} ${L('classes', 'classes')}`, 'accent', '#/school/students')}
    ${kpi(L('Frais encaissés', 'Fees collected'), money(f.paid), `${dec(f.rate, 1)} % ${L('de', 'of')} ${moneyShort(f.billed)} · ${L('aujourd\'hui', 'today')} ${money(f.today)}`, '', '#/school/fees')}
    ${kpi(L('Impayés en retard', 'Overdue fees'), money(f.overdue), `${L('reste à encaisser', 'still to collect')} ${moneyShort(f.due)}`, f.overdue ? 'warn' : '', '#/school/fees?tab=debtors')}
    ${kpi(d.results.period ? `${L('Moyenne', 'Average')} · ${esc(L(d.results.period.fr, d.results.period.en))}` : L('Résultats', 'Results'), d.results.avg != null ? `${dec(d.results.avg)}<small style="font-size:14px">/20</small>` : '—', d.results.pass_rate != null ? `${dec(d.results.pass_rate, 1)} % ${L('de réussite', 'pass rate')}` : L('Pas encore de notes', 'No marks yet'), '', '#/school/results')}
  </div>
  ${d.insights.length ? `<div class="card" style="margin-top:16px"><div class="row between" style="margin-bottom:10px"><span class="ai-tag">✦ Teknons Insight</span><a class="btn sm" href="#/school/insights">${L('Alertes précoces', 'Early warning')}</a></div>
    <div class="rs-ins">${d.insights.map((i) => `<div class="ins ${i.level}"><b>${esc(i.title)}</b><p>${esc(i.body)}</p></div>`).join('')}</div></div>` : ''}
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>${icon('scan')} ${L('Aujourd\'hui à l\'établissement', 'Today on campus')}</h3>
      <div class="sc-ring-row"><div class="sc-ring" style="--p:${g.total ? Math.round((g.arrived / g.total) * 100) : 0}"><b>${g.arrived}</b><small>/ ${g.total}</small></div>
      <div><div class="lrow row between"><span>${L('Arrivés (portail)', 'Arrived (gate)')}</span><b>${g.arrived}</b></div><div class="lrow row between"><span>${L('Présents maintenant', 'On site now')}</span><b>${g.inside}</b></div>
      <div class="lrow row between"><span>${L('Retards', 'Late')}</span><b style="color:var(--warn)">${g.late}</b></div><div class="lrow row between"><span>${L('Absents signalés', 'Reported absent')}</span><b style="color:var(--bad)">${d.attendance.absent.length}</b></div>
      <div class="lrow row between"><span>${L('Appels faits', 'Roll calls done')}</span><b>${d.attendance.rolls} / ${d.classes}</b></div></div></div>
      ${d.attendance.absent.slice(0, 5).map((a) => `<a class="lrow row between" href="#/school/student/${a.student_id}"><span>${esc(a.last_name)} ${esc(a.first_name)} <span class="muted sm">${esc(a.class_name)}</span></span><span class="pill ${a.justified ? 'ok' : 'bad'}">${a.hours} h</span></a>`).join('')}
      ${d.birthdays.length ? `<p class="muted sm" style="margin-top:10px">🎂 ${L('Anniversaires', 'Birthdays')} : ${d.birthdays.map((b) => `<a href="#/school/student/${b.id}">${esc(b.first_name)}</a> (${esc(b.class_name)})`).join(', ')}</p>` : ''}</div>
    <div class="card"><h3>${L('Encaissements des 30 derniers jours', 'Collections, last 30 days')}</h3>
      <div class="hbars small">${f.trend.map((t, i) => `<div class="hb" title="${dt(t.d)} : ${money(t.v)}"><i style="height:${Math.max(2, (t.v / maxT) * 100)}%"></i><span>${i % 5 === 0 || i === f.trend.length - 1 ? t.d.slice(8) : ''}</span></div>`).join('')}</div>
      ${f.methods.length ? `<div class="stackbar" style="margin-top:14px">${f.methods.map((m) => `<i class="mm-${esc(m.method)}" style="width:${(m.v / totalM) * 100}%"></i>`).join('')}</div>
      <div class="legend" style="flex-wrap:wrap;margin-top:8px">${f.methods.map((m) => `<span><i class="mm-${esc(m.method)}"></i>${esc(methodName(m.method))} <b class="num">${moneyShort(m.v)}</b></span>`).join('')}</div>` : ''}
      ${f.upcoming.length ? `<h3 style="margin-top:14px">${L('Prochaines échéances', 'Upcoming due dates')}</h3>${f.upcoming.map((u) => `<div class="lrow row between"><span>${esc(u.name)}<div class="muted sm">${dt(u.due_date)} · ${u.n} ${L('élèves', 'students')}</div></span><b class="num">${moneyShort(u.v)}</b></div>`).join('')}` : ''}</div>
    <div class="card"><h3>${L('Élèves à accompagner', 'Students who need support')}</h3>
      ${d.risk.length ? d.risk.map((r) => `<a class="lrow row between" href="#/school/student/${r.id}"><span>${esc(r.name)} <span class="muted sm">${esc(r.class_name)}</span><div class="sc-tags">${r.reasons.slice(0, 3).map((x) => `<i class="${x.k}">${esc(L(x.fr, x.en))}</i>`).join('')}</div></span><span class="sc-risk ${r.level}">${r.score}</span></a>`).join('') : `<p class="muted">${L('Aucun signal pour le moment. Les alertes apparaissent dès les premières notes et absences.', 'No signals yet.')}</p>`}</div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${L('Résultats par classe', 'Results by class')}${d.results.period ? ` · ${esc(L(d.results.period.fr, d.results.period.en))}` : ''}</h3>
      ${d.results.classes.filter((c) => c.avg != null).length ? `<div class="bar-list">${d.results.classes.filter((c) => c.avg != null).sort((a, b) => b.avg - a.avg).map((c) => `<a class="it" href="#/school/results?class_id=${c.id}&period=${d.results.period.id}"><span>${esc(c.name)} <span class="muted sm">${dec(c.pass_rate, 0)} % ${L('réussite', 'pass')}</span></span><b class="num ${avgCls(c.avg)}">${dec(c.avg)}</b><div class="tr"><i style="width:${(c.avg / 20) * 100}%"></i></div></a>`).join('')}</div>` : `<p class="muted">${L('Les moyennes apparaissent dès la saisie des notes.', 'Averages appear once marks are entered.')}</p>`}</div>
    <div class="card"><h3>${L('Matières', 'Subjects')}</h3>
      ${d.results.subjects.length ? `<div class="bar-list">${d.results.subjects.slice(0, 10).map((s) => `<div class="it"><span>${esc(s.name)}</span><b class="num ${avgCls(s.avg)}">${dec(s.avg)}</b><div class="tr"><i style="width:${(s.avg / 20) * 100}%;background:${s.avg < 10 ? 'var(--bad)' : 'var(--blue)'}"></i></div></div>`).join('')}</div>` : `<p class="muted">—</p>`}
      <div class="grid g3" style="margin-top:14px;gap:8px">
        <a class="sc-mini" href="#/school/library">${icon('book')}<b>${num(d.library.titles)}</b><span>${L('titres', 'titles')} · ${d.library.out} ${L('prêtés', 'on loan')}</span></a>
        <a class="sc-mini" href="#/school/elearning">${icon('monitor')}<b>${d.lms.courses}</b><span>${L('cours en ligne', 'online courses')}${d.lms.pending ? ` · ${d.lms.pending} ${L('à corriger', 'to grade')}` : ''}</span></a>
        <a class="sc-mini" href="#/school/research">${icon('globe')}<b>${d.research.publications}</b><span>${L('publications', 'publications')} · ${d.research.projects} ${L('projets', 'projects')}</span></a></div></div>
  </div>`;
}

async function teacherHome(ctx) {
  ctx.title(L('Ma journée', 'My day'));
  const d = await api.get('/api/school/my-day');
  const DAYS = S().days;
  ctx.el.innerHTML = `<div class="card sc-hello"><div><small>${esc(new Date().toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</small><h2>${L('Bonjour', 'Hello')} ${esc(state.me.user.name.split(' ')[0])}</h2>
    <p>${d.today.length ? `${d.today.length} ${L('cours aujourd\'hui', 'classes today')}` : L('Pas de cours aujourd\'hui.', 'No classes today.')}</p></div></div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${icon('calendar')} ${L('Aujourd\'hui', 'Today')}</h3>
    ${d.today.map((t) => `<div class="lrow row between"><span><b>${esc(t.start)}–${esc(t.end)}</b> · ${esc(t.subject)} <div class="muted sm">${esc(t.class_name)}${t.room ? ` · ${esc(t.room)}` : ''}</div></span>
      <span class="row" style="gap:6px">${t.roll_done ? `<span class="pill ok">${L('Appel fait', 'Roll done')}</span>` : `<a class="btn sm primary" href="#/school/roll?class_id=${t.class_id}&course_id=${t.course_id}">${L('Faire l\'appel', 'Take roll')}</a>`}
      <a class="btn sm" href="#/school/lessons?new=${t.course_id}">${icon('book')}</a></span></div>`).join('') || `<p class="muted">—</p>`}</div>
    <div class="card"><h3>${icon('edit')} ${L('Mes classes', 'My classes')}</h3>${d.courses.map((c) => `<div class="lrow row between"><span>${esc(c.class_name)} · ${esc(c.subject)}<div class="muted sm">${c.size} ${L('élèves', 'students')} · ${c.marks} ${L('notes saisies', 'marks entered')}</div></span>
      <span class="row" style="gap:6px"><a class="btn sm" href="#/school/marks?course_id=${c.id}">${L('Notes', 'Marks')}</a><a class="btn sm" href="#/school/assessments?course_id=${c.id}">${L('Évaluations', 'Tests')}</a></span></div>`).join('') || `<p class="muted">${L('Aucune classe attribuée.', 'No class assigned.')}</p>`}</div></div>`;
  void DAYS;
}

// ===================== Students =====================
R('/school/students', async (ctx) => {
  ctx.title(lmd() ? L('Étudiants', 'Students') : L('Élèves', 'Students'));
  const q = ctx.query;
  ctx.actions(`<a class="btn" href="/api/school/students${qs({ ...q, format: 'xlsx' })}">${icon('download')}<span class="hide-m">Excel</span></a>${canAny('schooloffice', 'settings') ? `<a class="btn" target="_blank" href="/api/school/cards${qs({ class_id: q.class_id })}">${icon('card')}<span class="hide-m">${L('Cartes', 'ID cards')}</span></a><button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${L('Inscrire', 'Enrol')}</span></button>` : ''}`);
  const rows = await api.get('/api/school/students' + qs({ class_id: q.class_id, q: q.q, all: q.all }));
  document.getElementById('add')?.addEventListener('click', () => studentDialog({ class_id: q.class_id }));
  const showDue = rows.some((r) => r.due !== undefined);
  ctx.el.innerHTML = `${offlineNote(rows)}<form class="filters" id="f"><select class="in" name="class_id">${classOpts().map(([v, l]) => `<option value="${v}" ${String(v) === String(q.class_id || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <input class="in" type="search" name="q" placeholder="${L('Nom, matricule, parent, téléphone…', 'Name, ID, parent, phone…')}" value="${esc(q.q || '')}"><label class="check"><input type="checkbox" name="all" ${q.all ? 'checked' : ''}> ${L('Inclure les anciens', 'Include former')}</label></form>
    <p class="muted sm">${rows.length} ${L('résultat(s)', 'result(s)')} · ${rows.filter((r) => r.sex === 'F').length} ${L('filles', 'girls')}</p>
    ${table({ rows, href: (r) => `#/school/student/${r.id}`, columns: [
      { label: '', render: (r) => avatar(r, 32) },
      { label: L('Nom', 'Name'), render: (r) => `<b>${esc(r.last_name)}</b> ${esc(r.first_name)}${r.repeating ? ` <span class="pill">${L('red.', 'rep.')}</span>` : ''}${r.status !== 'active' ? ` <span class="pill">${esc(r.status)}</span>` : ''}<div class="muted sm mono">${esc(r.matricule)}</div>` },
      { label: L('Classe', 'Class'), key: 'class_name' },
      { label: L('Parent / tuteur', 'Guardian'), render: (r) => `${esc(r.guardian_name || '')}<div class="muted sm">${esc(r.guardian_phone || '')}</div>`, hideM: true },
      { label: L('Né(e) le', 'Born'), render: (r) => dt(r.birth_date), hideM: true },
      ...(showDue ? [{ label: L('Reste à payer', 'Balance'), cls: 'r', render: (r) => (r.due ? `<b class="num" style="color:${r.overdue ? 'var(--bad)' : 'inherit'}">${money(r.due)}</b>` : `<span class="pill ok">${L('À jour', 'Paid')}</span>`) }] : []),
    ] })}`;
  const f = document.getElementById('f');
  f.onchange = () => { location.hash = '/school/students' + qs({ class_id: f.class_id.value, q: f.q.value, all: f.all.checked ? 1 : '' }); };
  f.onsubmit = (e) => { e.preventDefault(); f.onchange(); };
});

export async function studentDialog(st = {}) {
  const edit = !!st.id;
  const fees = (S().fee_items || []).filter((x) => x.kind === 'optional');
  const subs = st.subscriptions || [];
  const v = await dialog({ title: edit ? `${st.last_name} ${st.first_name}` : (lmd() ? L('Inscrire un étudiant', 'Enrol a student') : L('Inscrire un élève', 'Enrol a student')), wide: true, submit: edit ? L('Enregistrer', 'Save') : L('Inscrire et facturer', 'Enrol and bill'),
    body: `<div class="form f3">
      ${field({ name: 'last_name', label: L('Nom', 'Last name'), required: true }, st)}${field({ name: 'first_name', label: L('Prénom(s)', 'First name(s)'), required: true }, st)}
      ${field({ name: 'sex', label: L('Sexe', 'Sex'), type: 'select', options: [['M', L('Masculin', 'Male')], ['F', L('Féminin', 'Female')]] }, st)}
      ${field({ name: 'birth_date', label: L('Date de naissance', 'Date of birth'), type: 'date' }, st)}${field({ name: 'birth_place', label: L('Lieu de naissance', 'Place of birth') }, st)}${field({ name: 'nationality', label: L('Nationalité', 'Nationality') }, st)}
      ${edit ? '' : field({ name: 'class_id', label: L('Classe', 'Class'), type: 'select', options: classOpts(false), required: true }, st)}
      ${field({ name: 'previous_school', label: L('Établissement d\'origine', 'Previous school') }, st)}${field({ name: 'blood_group', label: L('Groupe sanguin', 'Blood group') }, st)}
    </div><h4 style="margin:14px 0 6px">${L('Parent / tuteur payeur', 'Paying guardian')}</h4><div class="form f3">
      ${field({ name: 'guardian_name', label: L('Nom complet', 'Full name'), required: !edit }, st)}${field({ name: 'guardian_phone', label: L('Téléphone (WhatsApp, MoMo)', 'Phone (WhatsApp, MoMo)'), required: !edit, placeholder: '6 77 12 34 56' }, st)}${field({ name: 'guardian_email', label: 'E-mail', type: 'email' }, st)}
      ${field({ name: 'guardian_relation', label: L('Lien', 'Relation'), type: 'select', options: ['Parent', 'Père', 'Mère', 'Tuteur', 'Tutrice', 'Oncle', 'Tante', 'Lui-même / elle-même'].map((x) => [x, x]) }, st)}
      ${field({ name: 'guardian2_name', label: L('Second contact', 'Second contact') }, st)}${field({ name: 'guardian2_phone', label: L('Téléphone 2', 'Phone 2') }, st)}
      ${field({ name: 'address', label: L('Adresse / quartier', 'Address'), span: true }, st)}</div>
    <h4 style="margin:14px 0 6px">${L('Santé, bourse et services', 'Health, scholarship & services')}</h4><div class="form f3">
      ${field({ name: 'allergies', label: L('Allergies', 'Allergies') }, st)}${field({ name: 'discount_pct', label: L('Réduction sur la scolarité (%)', 'Tuition discount (%)'), type: 'number', min: 0, step: 'any' }, st)}${field({ name: 'discount_reason', label: L('Motif (bourse, fratrie…)', 'Reason') }, st)}
      ${field({ name: 'medical_notes', label: L('Notes médicales', 'Medical notes'), type: 'textarea', span: true }, st)}</div>
    ${fees.length ? `<div class="chips" style="margin-top:8px">${fees.map((x) => `<label class="check"><input type="checkbox" name="sub_${x.id}" ${subs.includes(x.id) ? 'checked' : ''}> ${esc(x.name)} (${money(x.amount)})</label>`).join('')}</div>` : ''}
    <label class="fld" style="margin-top:10px">${L('Photo', 'Photo')}<input type="file" accept="image/*" id="ph"></label>`,
    onSubmit: async (v2, form) => {
      const file = form.querySelector('#ph').files[0];
      if (file) v2.photo = await shrink(file);
      v2.subscriptions = fees.filter((x) => v2[`sub_${x.id}`]).map((x) => x.id);
      return edit ? api.put(`/api/school/students/${st.id}`, v2) : api.post('/api/school/students', v2);
    } });
  if (v?.id) { toast(edit ? L('Fiche enregistrée', 'Saved') : `${L('Inscrit(e)', 'Enrolled')} : ${v.matricule}`, 'ok'); location.hash = `/school/student/${v.id}`; }
  return v;
}

/** Resizes a photo to a small JPEG data URL (ID card quality, ~40 KB). */
export function shrink(file, max = 360) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82)); };
    img.onerror = rej; img.src = url;
  });
}

R('/school/student/:id', async (ctx) => {
  const s = await api.get(`/api/school/students/${ctx.params.id}`);
  ctx.title(`${s.last_name} ${s.first_name}`);
  const tab = ctx.query.tab || 'overview';
  const office = canAny('schooloffice', 'settings');
  ctx.actions(`${office ? `<button class="btn" id="edit">${icon('edit')}<span class="hide-m">${L('Modifier', 'Edit')}</span></button>` : ''}
    <a class="btn" target="_blank" href="/api/school/students/${s.id}/transcript">${icon('print')}<span class="hide-m">${L('Dossier scolaire', 'Transcript')}</span></a>
    ${s.fees && canAny('treasury', 'sales') ? `<a class="btn primary" href="#/school/fees?tab=till&student=${s.id}">${icon('cash')}<span class="hide-m">${L('Encaisser', 'Collect')}</span></a>` : ''}`);
  const marks = s.marks;
  const tabs = [['overview', L('Vue d\'ensemble', 'Overview')], ['marks', L('Notes', 'Marks')], ['attendance', L('Assiduité', 'Attendance')], ['discipline', L('Discipline', 'Discipline')], ...(s.fees ? [['fees', L('Frais', 'Fees')]] : []), ['more', L('Examens, bibliothèque, cours', 'Exams, library, courses')]];
  const fees = s.fees;
  const body = {
    overview: () => `<div class="grid g2"><div class="card"><h3>${L('Identité', 'Identity')}</h3>
      ${[[L('Matricule', 'ID'), `<span class="mono">${esc(s.matricule)}</span>`], [L('Classe', 'Class'), `${esc(s.class_name || '—')}${s.repeating ? ` <span class="pill">${L('redoublant', 'repeating')}</span>` : ''}`], [L('Né(e) le', 'Born'), `${dt(s.birth_date)} ${s.birth_place ? `à ${esc(s.birth_place)}` : ''}`],
        [L('Sexe', 'Sex'), s.sex === 'F' ? L('Féminin', 'Female') : L('Masculin', 'Male')], [L('Nationalité', 'Nationality'), esc(s.nationality)], [L('Établissement d\'origine', 'Previous school'), esc(s.previous_school || '—')],
        [L('Groupe sanguin', 'Blood group'), esc(s.blood_group || '—')], [L('Allergies', 'Allergies'), s.allergies ? `<b style="color:var(--bad)">${esc(s.allergies)}</b>` : '—'], [L('Réduction', 'Discount'), s.discount_pct ? `${s.discount_pct} % · ${esc(s.discount_reason)}` : '—']]
        .map(([k, v]) => `<div class="lrow row between"><span class="muted">${k}</span><span>${v}</span></div>`).join('')}
      ${s.history.length > 1 ? `<h3 style="margin-top:14px">${L('Parcours', 'History')}</h3>${s.history.map((h) => `<div class="lrow row between"><span>${esc(h.year_name)}</span><span>${esc(h.class_name)} ${h.decision ? `<span class="pill">${esc(h.decision)}</span>` : ''}</span></div>`).join('')}` : ''}</div>
      <div class="card"><h3>${L('Famille', 'Family')}</h3><div class="lrow row between"><span><b>${esc(s.guardian_name || '')}</b><div class="muted sm">${esc(s.guardian_relation)} · ${esc(s.guardian_phone || '')}</div></span>
        ${s.guardian_phone ? `<a class="btn sm" target="_blank" href="${wa(s.guardian_phone, `Bonjour ${s.guardian_name}, ${state.me.company.name} vous contacte au sujet de ${s.first_name}.`)}">WhatsApp</a>` : ''}</div>
        ${s.guardian2_name ? `<div class="lrow row between"><span>${esc(s.guardian2_name)}</span><span class="muted">${esc(s.guardian2_phone)}</span></div>` : ''}
        ${s.siblings.length ? `<p class="muted sm">${L('Frères et sœurs', 'Siblings')} : ${s.siblings.map((x) => `<a href="#/school/student/${x.id}">${esc(x.first_name)}</a>`).join(', ')}</p>` : ''}
        ${s.portal_url ? `<h3 style="margin-top:14px">${L('Portail parents et élève', 'Parent & student portal')}</h3><p class="muted sm">${L('Notes, bulletins, absences, devoirs, emploi du temps, paiement MoMo, cours en ligne.', 'Marks, report cards, absences, homework, timetable, MoMo payment, e-learning.')}</p>
          <div class="row" style="flex-wrap:wrap;gap:6px"><a class="btn sm" target="_blank" href="${esc(s.portal_url)}">${icon('globe')} ${L('Ouvrir', 'Open')}</a><button class="btn sm" id="copy">${L('Copier le lien', 'Copy link')}</button>
          ${s.guardian_phone ? `<a class="btn sm primary" target="_blank" href="${wa(s.guardian_phone, `Bonjour ${s.guardian_name}, voici l'espace de ${s.first_name} sur ${state.me.company.name} : notes, bulletins, absences, devoirs et paiement des frais par MoMo. ${s.portal_url}`)}">${L('Envoyer par WhatsApp', 'Send via WhatsApp')}</a>` : ''}
          ${office ? `<a class="btn sm" target="_blank" href="/api/school/cards?student_id=${s.id}">${icon('card')} ${L('Carte', 'ID card')}</a><a class="btn sm" target="_blank" href="/api/school/students/${s.id}/certificate">${L('Certificat de scolarité', 'Enrolment certificate')}</a>` : ''}</div>` : ''}
        ${s.risk ? `<div class="banner ${s.risk.level === 'high' ? 'bad' : 'warn'}" style="margin-top:14px"><b>${L('Alerte précoce', 'Early warning')} · ${s.risk.score}/100</b><div class="sc-tags">${s.risk.reasons.map((x) => `<i class="${x.k}">${esc(L(x.fr, x.en))}</i>`).join('')}</div></div>` : ''}
        <div class="grid g3" style="margin-top:14px;gap:8px">${kpi(L('Moyenne', 'Average'), marks.summary.length ? dec(marks.summary[marks.summary.length - 1].average) : '—', marks.summary.length ? `${esc(L(marks.summary[marks.summary.length - 1].fr, marks.summary[marks.summary.length - 1].en))} · ${marks.summary[marks.summary.length - 1].rank}/${marks.summary[marks.summary.length - 1].size}` : '')}
          ${kpi(L('Absences', 'Absences'), `${s.absences.hours} h`, `${s.absences.unjustified} h ${L('non justifiées', 'unexcused')}`)}${fees ? kpi(L('Reste à payer', 'Balance'), money(fees.balance), fees.overdue ? `<b style="color:var(--bad)">${money(fees.overdue)} ${L('en retard', 'overdue')}</b>` : L('à jour', 'up to date')) : ''}</div></div></div>`,
    marks: () => `${marks.summary.length ? `<div class="grid g4" style="margin-bottom:14px">${marks.summary.map((p) => kpi(esc(L(p.fr, p.en)), `<span class="${avgCls(p.average)}">${dec(p.average)}</span>`, `${L('rang', 'rank')} ${p.rank}/${p.size} · ${L('classe', 'class')} ${dec(p.class_avg)}${p.gpa != null ? ` · GPA ${p.gpa}` : ''}${p.distinction ? ` · ${esc(distName(p.distinction))}` : ''}`)).join('')}</div>` : ''}
      ${table({ rows: marks.courses, columns: [{ label: L('Matière', 'Subject'), render: (c) => `<b>${esc(c.subject)}</b><div class="muted sm">${esc(c.teacher || '')} · coef ${c.coef}</div>` }, ...marks.slots.map((q) => ({ label: q.label.replace('Séquence ', 'S').replace('Sequence ', 'S'), cls: 'r', render: (c) => { const v = c.marks[q.seq]; return v === 'abs' ? '<span class="pill bad">abs</span>' : v == null ? '<span class="dim">·</span>' : `<span class="num ${avgCls(v)}">${dec(v)}</span>`; } }))] })}
      <h3 style="margin:16px 0 8px">${L('Toutes les évaluations', 'Every assessment')}</h3>
      ${table({ rows: marks.tests, columns: [{ label: L('Date', 'Date'), render: (t) => dt(t.date) }, { label: L('Matière', 'Subject'), render: (t) => esc(marks.courses.find((c) => c.id === t.course_id)?.subject || '') }, { label: L('Évaluation', 'Assessment'), render: (t) => `${esc(t.title)} <span class="pill">${esc(L(...(S().assess_kinds[t.kind] || [t.kind, t.kind])))}</span>` }, { label: L('Note', 'Score'), cls: 'r', render: (t) => (t.absent ? '<span class="pill bad">abs</span>' : t.score == null ? '—' : `<b class="num">${dec(t.score)}</b>/${t.max}`) }] })}`,
    attendance: () => table({ rows: s.attendance, empty: `<b>${L('Aucune absence ni retard', 'No absence or lateness')} 👏</b>`, columns: [{ label: 'Date', render: (a) => dt(a.date) }, { label: L('Type', 'Type'), render: (a) => (a.kind === 'absent' ? `<span class="pill bad">${L('Absence', 'Absent')} ${a.hours} h</span>` : `<span class="pill warn">${L('Retard', 'Late')} ${a.minutes} min</span>`) + (a.source === 'gate' ? ` <span class="pill">${L('portail', 'gate')}</span>` : '') }, { label: L('Cours', 'Class'), render: (a) => esc(a.subject || '—') },
      { label: L('Justification', 'Excuse'), render: (a) => (a.justified ? `<span class="pill ok">${L('Justifiée', 'Excused')}</span> ${esc(a.reason)}` : canAny('discipline', 'schooloffice') ? `<button class="btn sm" data-just="${a.id}">${L('Justifier', 'Excuse')}</button>` : '—') }] }),
    discipline: () => `${canAny('discipline', 'schooloffice', 'teaching') ? `<button class="btn primary" id="dsc" style="margin-bottom:12px">${icon('plus')} ${L('Nouvelle entrée', 'New record')}</button>` : ''}${table({ rows: s.discipline, empty: `<b>${L('Rien à signaler', 'Nothing to report')}</b>`, columns: [{ label: 'Date', render: (d) => dt(d.date) }, { label: L('Mesure', 'Measure'), render: (d) => `<span class="pill ${d.kind === 'praise' ? 'ok' : ['suspension', 'exclusion', 'blame'].includes(d.kind) ? 'bad' : 'warn'}">${esc(DISC(d.kind))}</span>${d.hours ? ` ${d.hours} h` : ''}${d.days ? ` ${d.days} j` : ''}` }, { label: L('Motif', 'Reason'), key: 'reason' }, { label: L('Par', 'By'), key: 'by_name', hideM: true }] })}`,
    fees: () => `<div class="grid g4" style="margin-bottom:14px">${kpi(L('Total de l\'année', 'Year total'), money(fees.total))}${kpi(L('Payé', 'Paid'), money(fees.paid))}${kpi(L('Reste', 'Balance'), money(fees.balance), '', 'accent')}${kpi(L('En retard', 'Overdue'), money(fees.overdue), '', fees.overdue ? 'warn' : '')}</div>
      ${feeTable(fees.items)}<h3 style="margin:16px 0 8px">${L('Reçus', 'Receipts')}</h3>${table({ rows: fees.receipts, columns: [{ label: 'N°', render: (r) => `<a target="_blank" href="/api/school/receipts/${r.id}" class="mono">${esc(r.number)}</a>` }, { label: 'Date', render: (r) => dt(r.created_at) }, { label: L('Mode', 'Method'), render: (r) => esc(methodName(r.method)) }, { label: L('Montant', 'Amount'), cls: 'r', render: (r) => `<b class="num">${money(r.amount)}</b>` }] })}`,
    more: () => `<div class="grid g2"><div class="card"><div class="row between"><h3>${L('Examens officiels', 'Official exams')}</h3>${office ? `<button class="btn sm" id="exam">${icon('plus')}</button>` : ''}</div>${s.exams.map((e) => `<div class="lrow row between"><span><b>${esc(e.exam)}</b> ${esc(e.session)} ${e.series ? `· ${esc(e.series)}` : ''}<div class="muted sm">${esc(e.center || '')} ${e.candidate_no ? `· n° ${esc(e.candidate_no)}` : ''}</div></span><span class="pill ${e.result === 'passed' ? 'ok' : e.result === 'failed' ? 'bad' : 'info'}">${esc({ passed: L('Admis', 'Passed'), failed: L('Échec', 'Failed'), absent: 'Absent', registered: L('Inscrit', 'Registered') }[e.result])}${e.mention ? ` · ${esc(e.mention)}` : ''}</span></div>`).join('') || `<p class="muted">—</p>`}</div>
      <div class="card"><h3>${L('Bibliothèque', 'Library')}</h3>${s.loans.map((l) => `<div class="lrow row between"><span>${esc(l.title)}<div class="muted sm">${dt(l.borrowed_at)} → ${dt(l.due_date)}</div></span>${l.returned_at ? `<span class="pill">${L('rendu', 'returned')}</span>` : `<span class="pill ${l.overdue ? 'bad' : 'info'}">${l.overdue ? L('en retard', 'overdue') : L('en prêt', 'on loan')}</span>`}</div>`).join('') || `<p class="muted">—</p>`}
      <h3 style="margin-top:14px">${L('Cours en ligne', 'Online courses')}</h3>${s.courses.map((c) => `<div class="lrow row between"><span>${esc(c.title)}</span><span class="pill ${c.completed_at ? 'ok' : 'info'}">${c.pct} %</span></div>`).join('') || `<p class="muted">—</p>`}
      <h3 style="margin-top:14px">${L('Passages au portail', 'Gate log')}</h3>${s.gate.map((g) => `<div class="lrow row between"><span>${dt(g.at)} ${new Date(g.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' })}</span><span class="pill ${g.direction === 'in' ? 'ok' : ''}">${g.direction === 'in' ? L('entrée', 'in') : L('sortie', 'out')}${g.late_minutes ? ` · +${g.late_minutes} min` : ''}</span></div>`).join('') || `<p class="muted">—</p>`}</div></div>`,
  };
  ctx.el.innerHTML = `<div class="card sc-head"><div class="row" style="gap:16px">${s.has_photo || s.photo ? `<img class="sc-photo" src="${esc(s.photo)}" alt="">` : avatar(s, 72)}<div><h2 style="margin:0">${esc(s.last_name)} ${esc(s.first_name)}</h2><div class="muted"><span class="mono">${esc(s.matricule)}</span> · ${esc(s.class_name || L('non inscrit', 'not enrolled'))} · ${esc(s.year?.name || '')}</div>
    ${s.status !== 'active' ? `<span class="pill bad">${esc(s.status)}</span>` : ''}</div></div></div>
    <div class="tabs" style="margin:14px 0">${tabs.map(([k, l]) => `<a href="#/school/student/${s.id}?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>${(body[tab] || body.overview)()}`;
  document.getElementById('edit')?.addEventListener('click', async () => { const full = { ...s, subscriptions: s.subscriptions }; await studentDialog(full); ctx.rerender(); });
  document.getElementById('copy')?.addEventListener('click', () => { navigator.clipboard?.writeText(s.portal_url); toast(L('Lien copié', 'Link copied'), 'ok'); });
  document.getElementById('dsc')?.addEventListener('click', async () => { if (await disciplineDialog(s.id)) ctx.rerender(); });
  document.getElementById('exam')?.addEventListener('click', async () => {
    const v = await dialog({ title: L('Examen officiel', 'Official exam'), body: `<div class="form f2">${field({ name: 'exam', label: L('Examen', 'Exam'), required: true, list: 'exl' })}<datalist id="exl">${['CEP', 'BEPC', 'Probatoire', 'Baccalauréat', 'GCE O/L', 'GCE A/L', 'FSLC', 'Concours ENS', 'Concours Polytechnique', 'TOEFL', 'DELF'].map((x) => `<option value="${x}">`).join('')}</datalist>
      ${field({ name: 'session', label: 'Session', value: today().slice(0, 4) })}${field({ name: 'series', label: L('Série', 'Series') })}${field({ name: 'center', label: L('Centre', 'Centre') })}${field({ name: 'candidate_no', label: L('N° de candidat', 'Candidate no.') })}
      ${field({ name: 'result', label: L('Résultat', 'Result'), type: 'select', options: [['registered', L('Inscrit', 'Registered')], ['passed', L('Admis', 'Passed')], ['failed', L('Échec', 'Failed')], ['absent', 'Absent']] })}${field({ name: 'mention', label: 'Mention' })}</div>`,
      onSubmit: (b) => api.post(`/api/school/students/${s.id}/exams`, b) });
    if (v) ctx.rerender();
  });
  ctx.el.querySelectorAll('[data-just]').forEach((b) => b.addEventListener('click', async () => {
    const v = await dialog({ title: L('Justifier l\'absence', 'Excuse absence'), body: field({ name: 'reason', label: L('Motif (certificat médical…)', 'Reason'), required: true }), onSubmit: (x) => api.put(`/api/school/attendance/${b.dataset.just}`, { justified: true, reason: x.reason }) });
    if (v) ctx.rerender();
  }));
});

export function feeTable(items) {
  return table({ rows: items, columns: [{ label: L('Frais', 'Fee'), render: (f) => `<b>${esc(f.name)}</b><div class="muted sm mono">${esc(f.number || '')}</div>` }, { label: L('Échéance', 'Due'), render: (f) => `${dt(f.due_date)}${f.overdue ? ` <span class="pill bad">${L('retard', 'late')}</span>` : ''}` },
    { label: L('Montant', 'Amount'), cls: 'r', render: (f) => `<span class="num">${money(f.total)}</span>` }, { label: L('Payé', 'Paid'), cls: 'r', render: (f) => `<span class="num">${money(f.paid + f.credited)}</span>`, hideM: true },
    { label: L('Reste', 'Balance'), cls: 'r', render: (f) => (f.status === 'paid' ? `<span class="pill ok">${L('Payé', 'Paid')}</span>` : `<b class="num">${money(f.balance)}</b>`) }] });
}

export async function disciplineDialog(studentId) {
  return dialog({ title: L('Discipline', 'Discipline'), body: `<div class="form f2">${studentId ? '' : `<label class="fld" style="grid-column:1/-1">${lmd() ? L('Étudiant', 'Student') : L('Élève', 'Student')}<select name="student_id" required id="dst"></select></label>`}
    ${field({ name: 'kind', label: L('Mesure', 'Measure'), type: 'select', options: Object.keys(S().discipline).map((k) => [k, DISC(k)]) })}${field({ name: 'date', label: 'Date', type: 'date', value: today() })}
    ${field({ name: 'hours', label: L('Heures de consigne', 'Detention hours'), type: 'number', min: 0 })}${field({ name: 'days', label: L('Jours d\'exclusion', 'Suspension days'), type: 'number', min: 0 })}
    ${field({ name: 'reason', label: L('Motif', 'Reason'), type: 'textarea', required: true, span: true })}</div>`,
  onOpen: async (d) => { const sel = d.querySelector('#dst'); if (!sel) return; const list = await api.get('/api/school/students'); sel.innerHTML = list.map((x) => `<option value="${x.id}">${esc(x.last_name)} ${esc(x.first_name)} · ${esc(x.class_name || '')}</option>`).join(''); },
  onSubmit: (b) => api.post('/api/school/discipline', { ...b, student_id: studentId || b.student_id }) });
}

// ===================== Classes =====================
R('/school/classes', async (ctx) => {
  ctx.title(lmd() ? L('Promotions et unités d\'enseignement', 'Cohorts & course units') : L('Classes et matières', 'Classes & subjects'));
  const set = canAny('settings', 'schooloffice');
  ctx.actions(set ? `<button class="btn" id="sub">${icon('book')}<span class="hide-m">${L('Matières', 'Subjects')}</span></button><button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${L('Nouvelle classe', 'New class')}</span></button>` : '');
  const list = await api.get('/api/school/classes');
  const byLevel = {};
  for (const c of list) (byLevel[c.level_name] ||= []).push(c);
  ctx.el.innerHTML = `${offlineNote(list)}${Object.entries(byLevel).map(([lv, cs]) => `<h3 class="sc-h">${esc(lv)} <span class="muted sm">${cs.reduce((a, b) => a + b.size, 0)} ${L('élèves', 'students')}${cs[0].exam ? ` · ${esc(cs[0].exam)}` : ''}</span></h3>
    <div class="sc-classes">${cs.map((c) => `<a class="card sc-class" href="#/school/class/${c.id}"><div class="row between"><b>${esc(c.name)}</b><span class="pill">${c.size}/${c.capacity}</span></div>
      <div class="muted sm">${esc(c.head_teacher || L('Pas de professeur principal', 'No form teacher'))}${c.room ? ` · ${L('salle', 'room')} ${esc(c.room)}` : ''}</div>
      <div class="sc-fill"><i style="width:${Math.min(100, (c.size / c.capacity) * 100)}%"></i></div><div class="muted sm">${c.girls} ${L('filles', 'girls')} · ${c.size - c.girls} ${L('garçons', 'boys')} · ${c.courses} ${lmd() ? 'UE' : L('matières', 'subjects')}</div></a>`).join('')}</div>`).join('') || `<div class="card empty"><b>${L('Aucune classe pour cette année', 'No class this year')}</b><p>${L('Créez vos classes : chaque niveau reçoit toutes les matières, à ajuster ensuite.', 'Create your classes.')}</p></div>`}`;
  document.getElementById('add')?.addEventListener('click', async () => { const v = await classDialog(); if (v) { await refreshMeta(); location.hash = `/school/class/${v.id}`; } });
  document.getElementById('sub')?.addEventListener('click', () => subjectsDialog());
});

async function classDialog(c = {}) {
  const teachers = S().teachers.map((t) => [t.id, t.name]);
  return dialog({ title: c.id ? c.name : L('Nouvelle classe', 'New class'), body: `<div class="form f2">${field({ name: 'level_id', label: L('Niveau', 'Level'), type: 'select', options: S().levels.filter((l) => l.active).map((l) => [l.id, l.name]), required: true }, c)}
    ${field({ name: 'name', label: L('Nom (ex. 6e A, L1 Informatique)', 'Name'), required: true }, c)}${field({ name: 'room', label: L('Salle', 'Room') }, c)}${field({ name: 'capacity', label: L('Places', 'Capacity'), type: 'number', min: 1, value: 50 }, c)}
    ${field({ name: 'head_teacher_id', label: L('Professeur principal', 'Form teacher'), type: 'select', options: [['', '—'], ...teachers] }, c)}${c.id ? '' : field({ name: 'all_subjects', label: L('Ajouter toutes les matières', 'Add every subject'), type: 'checkbox', value: true })}</div>`,
  onSubmit: (b) => (c.id ? api.put(`/api/school/classes/${c.id}`, b) : api.post('/api/school/classes', b)) });
}

async function subjectsDialog() {
  const rows = S().subjects;
  const v = await dialog({ title: L('Matières', 'Subjects'), wide: true, submit: L('Ajouter', 'Add'), body: `<div class="tbl-wrap" style="max-height:300px;overflow:auto"><table class="tbl">${rows.map((s) => `<tr><td><b>${esc(s.name)}</b> <span class="muted sm">${esc(s.code)}</span></td><td class="muted">${esc(s.name_en)}</td><td><span class="pill">${esc(s.grp)}</span></td></tr>`).join('')}</table></div>
    <h4>${L('Nouvelle matière', 'New subject')}</h4><div class="form f3">${field({ name: 'name', label: L('Nom', 'Name'), required: true })}${field({ name: 'name_en', label: L('Nom anglais', 'English name') })}${field({ name: 'code', label: 'Code' })}
    ${field({ name: 'grp', label: L('Groupe', 'Group'), type: 'select', options: [['lit', L('Littéraire', 'Literary')], ['sci', L('Scientifique', 'Scientific')], ['general', L('Autres', 'Other')], ['tech', L('Technique', 'Technical')], ['core', L('UE fondamentale', 'Core unit')], ['elective', L('UE optionnelle', 'Elective')]] })}</div>`,
  onSubmit: (b) => api.post('/api/school/subjects', b) });
  if (v) { await refreshMeta(); toast(L('Matière ajoutée', 'Subject added'), 'ok'); }
}

R('/school/class/:id', async (ctx) => {
  const c = await api.get(`/api/school/classes/${ctx.params.id}`);
  ctx.title(`${c.name} · ${c.year_name}`);
  const set = canAny('settings', 'schooloffice');
  ctx.actions(`<a class="btn" href="#/school/results?class_id=${c.id}">${icon('star')}<span class="hide-m">${L('Résultats', 'Results')}</span></a><a class="btn" target="_blank" href="/api/school/timetable?class_id=${c.id}&format=html">${icon('calendar')}<span class="hide-m">${L('Emploi du temps', 'Timetable')}</span></a>
    ${set ? `<button class="btn" id="edit">${icon('edit')}</button><button class="btn primary" id="course">${icon('plus')}<span class="hide-m">${lmd() ? L('Ajouter une UE', 'Add unit') : L('Ajouter une matière', 'Add subject')}</span></button>` : ''}`);
  const tot = c.courses.reduce((a, b) => a + b.coef, 0), hrs = c.courses.reduce((a, b) => a + b.hours, 0);
  ctx.el.innerHTML = `<div class="grid g4">${kpi(L('Effectif', 'Students'), `${c.students.length}<small style="font-size:14px">/${c.capacity}</small>`, `${c.students.filter((s) => s.sex === 'F').length} ${L('filles', 'girls')}`, 'accent')}${kpi(lmd() ? L('Crédits', 'Credits') : L('Total coefficients', 'Total coefficients'), num(tot))}${kpi(L('Heures / semaine', 'Hours / week'), num(hrs))}${kpi(L('Professeur principal', 'Form teacher'), `<span style="font-size:16px">${esc(c.head_teacher || '—')}</span>`, c.room ? `${L('Salle', 'Room')} ${esc(c.room)}` : '')}</div>
  <div class="grid g2" style="margin-top:16px"><div><h3 class="sc-h">${lmd() ? L('Unités d\'enseignement', 'Course units') : L('Matières et enseignants', 'Subjects & teachers')}</h3>
    ${table({ rows: c.courses, columns: [{ label: L('Matière', 'Subject'), render: (x) => `<b>${esc(x.subject)}</b>${x.code ? ` <span class="muted sm mono">${esc(x.code)}</span>` : ''}${x.semester ? ` <span class="pill">S${x.semester}</span>` : ''}` }, { label: L('Enseignant', 'Teacher'), render: (x) => esc(x.teacher_name || '—') }, { label: lmd() ? L('Crédits', 'Credits') : 'Coef', cls: 'r', key: 'coef' }, { label: 'h/sem', cls: 'r', key: 'hours', hideM: true },
      ...(set ? [{ label: '', render: (x) => `<button class="btn sm ghost" data-co="${x.id}">${icon('edit')}</button>` }] : [])] })}</div>
    <div><h3 class="sc-h">${L('Liste de la classe', 'Class list')}</h3>${table({ rows: c.students, href: (s) => `#/school/student/${s.id}`, columns: [{ label: '#', render: (s) => c.students.indexOf(s) + 1 }, { label: L('Nom', 'Name'), render: (s) => `<b>${esc(s.last_name)}</b> ${esc(s.first_name)}${s.repeating ? ` <span class="pill">${L('red.', 'rep.')}</span>` : ''}` }, { label: L('Sexe', 'Sex'), key: 'sex' }, { label: L('Parent', 'Guardian'), render: (s) => `<span class="muted sm">${esc(s.guardian_phone || '')}</span>`, hideM: true }] })}</div></div>`;
  const courseDlg = async (co = {}) => {
    const v = await dialog({ title: co.id ? co.subject : L('Ajouter une matière', 'Add a subject'), body: `<div class="form f2">${field({ name: 'subject_id', label: L('Matière', 'Subject'), type: 'select', options: S().subjects.map((s) => [s.id, s.name]) }, co)}
      ${field({ name: 'teacher_id', label: L('Enseignant', 'Teacher'), type: 'select', options: [['', '—'], ...S().teachers.map((t) => [t.id, t.name])] }, co)}${field({ name: 'coef', label: lmd() ? L('Crédits ECTS', 'Credits') : 'Coefficient', type: 'number', min: 0, step: 'any', value: 2 }, co)}${field({ name: 'hours', label: L('Heures par semaine', 'Hours per week'), type: 'number', min: 0, value: 2 }, co)}
      ${lmd() ? `${field({ name: 'semester', label: L('Semestre', 'Semester'), type: 'select', options: [[1, 'Semestre 1'], [2, 'Semestre 2'], [0, L('Annuel', 'Full year')]] }, co)}${field({ name: 'code', label: L('Code UE', 'Unit code') }, co)}` : ''}</div>`,
    onSubmit: (b) => (co.id ? api.put(`/api/school/courses/${co.id}`, b) : api.post('/api/school/courses', { ...b, class_id: c.id })) });
    if (v) { await refreshMeta(); ctx.rerender(); }
  };
  document.getElementById('course')?.addEventListener('click', () => courseDlg());
  document.getElementById('edit')?.addEventListener('click', async () => { if (await classDialog(c)) { await refreshMeta(); ctx.rerender(); } });
  ctx.el.querySelectorAll('[data-co]').forEach((b) => b.addEventListener('click', () => courseDlg(c.courses.find((x) => x.id === Number(b.dataset.co)))));
});

// ===================== Admissions =====================
R('/school/admissions', async (ctx) => {
  ctx.title(L('Admissions et préinscriptions', 'Admissions'));
  const url = `${S().public_url}/admission`;
  ctx.actions(`<button class="btn" id="cp">${icon('globe')}<span class="hide-m">${L('Lien du formulaire', 'Form link')}</span></button><button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${L('Inscription directe', 'Direct enrolment')}</span></button>`);
  const rows = await api.get('/api/school/applications');
  const ST_ = { new: ['info', 'Nouveau', 'New'], interview: ['warn', 'Entretien / test', 'Interview'], accepted: ['ok', 'Accepté', 'Accepted'], rejected: ['bad', 'Refusé', 'Rejected'] };
  const filter = ctx.query.status || '';
  const shown = rows.filter((r) => !filter || r.status === filter);
  ctx.el.innerHTML = `<div class="card banner info">${L('Les familles se préinscrivent en ligne', 'Families apply online at')} : <a target="_blank" href="${esc(url)}"><b>${esc(url)}</b></a>. ${L('Partagez-le sur WhatsApp, Facebook et votre site.', 'Share it on WhatsApp, Facebook and your website.')}</div>
  <div class="chips" style="margin-bottom:12px"><a href="#/school/admissions" class="${!filter ? 'on' : ''}">${L('Tous', 'All')} <b>${rows.length}</b></a>${Object.entries(ST_).map(([k, v]) => `<a href="#/school/admissions?status=${k}" class="${filter === k ? 'on' : ''}">${L(v[1], v[2])} <b>${rows.filter((r) => r.status === k).length}</b></a>`).join('')}</div>
  ${table({ rows: shown, columns: [{ label: L('Candidat', 'Applicant'), render: (r) => `<b>${esc(r.last_name)}</b> ${esc(r.first_name)}<div class="muted sm">PRE-${String(r.id).padStart(5, '0')} · ${dt(r.created_at)}</div>` }, { label: L('Niveau', 'Level'), render: (r) => esc(r.level_name || '—') },
    { label: L('Dernière moyenne', 'Last average'), cls: 'r', render: (r) => (r.last_average != null ? `<b class="${avgCls(r.last_average)}">${dec(r.last_average)}</b>` : '—'), hideM: true }, { label: L('Parent', 'Parent'), render: (r) => `${esc(r.guardian_name)}<div class="muted sm">${esc(r.guardian_phone)}</div>` },
    { label: L('Statut', 'Status'), render: (r) => `<span class="pill ${ST_[r.status][0]}">${L(ST_[r.status][1], ST_[r.status][2])}</span>${r.interview_at ? `<div class="muted sm">${esc(r.interview_at.replace('T', ' '))}</div>` : ''}` },
    { label: '', render: (r) => (r.status === 'accepted' ? `<a class="btn sm" href="#/school/student/${r.student_id}">${L('Fiche', 'File')}</a>` : `<span class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm primary" data-acc="${r.id}">${L('Accepter', 'Accept')}</button><button class="btn sm" data-int="${r.id}">${L('Entretien', 'Interview')}</button><a class="btn sm" target="_blank" href="${wa(r.guardian_phone, `Bonjour ${r.guardian_name}, ${state.me.company.name} a bien reçu la préinscription de ${r.first_name}.`)}">WA</a></span>`) }] })}`;
  document.getElementById('cp').onclick = () => { navigator.clipboard?.writeText(url); toast(L('Lien copié', 'Link copied'), 'ok'); };
  document.getElementById('add').onclick = () => studentDialog();
  ctx.el.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', async () => {
    const a = rows.find((x) => x.id === Number(b.dataset.acc));
    const opts = (S().classes || []).filter((c) => !a.level_id || c.level_id === a.level_id);
    const v = await dialog({ title: `${L('Accepter', 'Accept')} ${a.last_name} ${a.first_name}`, submit: L('Inscrire et facturer', 'Enrol and bill'), body: `${field({ name: 'class_id', label: L('Classe', 'Class'), type: 'select', options: (opts.length ? opts : S().classes).map((c) => [c.id, `${c.name} (${c.size}/${c.capacity})`]) })}
      ${(S().fee_items || []).filter((x) => x.kind === 'optional').map((x) => `<label class="check"><input type="checkbox" name="sub_${x.id}"> ${esc(x.name)} (${money(x.amount)})</label>`).join('')}`,
    onSubmit: (x) => api.post(`/api/school/applications/${a.id}/accept`, { class_id: x.class_id, subscriptions: Object.keys(x).filter((k) => k.startsWith('sub_') && x[k]).map((k) => Number(k.slice(4))) }) });
    if (v?.id) { toast(`${L('Inscrit(e)', 'Enrolled')} : ${v.matricule}`, 'ok'); location.hash = `/school/student/${v.id}`; }
  }));
  ctx.el.querySelectorAll('[data-int]').forEach((b) => b.addEventListener('click', async () => {
    const a = rows.find((x) => x.id === Number(b.dataset.int));
    const v = await dialog({ title: L('Entretien / test d\'entrée', 'Interview / entrance test'), body: `<div class="form f2">${field({ name: 'interview_at', label: L('Date et heure', 'Date & time'), type: 'datetime-local' }, a)}${field({ name: 'status', label: L('Statut', 'Status'), type: 'select', options: [['interview', L('Entretien prévu', 'Interview set')], ['new', L('Nouveau', 'New')], ['rejected', L('Refusé', 'Rejected')]] }, { status: 'interview' })}${field({ name: 'notes', label: 'Notes', type: 'textarea', span: true }, a)}</div>`,
      onSubmit: (x) => api.put(`/api/school/applications/${a.id}`, x) });
    if (v) ctx.rerender();
  }));
}, true);

// ===================== Fees =====================
R('/school/fees', async (ctx) => {
  ctx.title(L('Frais de scolarité et recouvrement', 'Fees & collection'));
  const tab = ctx.query.tab || (canAny('treasury', 'sales') ? 'till' : 'status');
  const tabs = [...(canAny('treasury', 'sales') ? [['till', L('Caisse (économat)', 'Bursar till')], ['receipts', L('Reçus du jour', 'Today\'s receipts')]] : []), ['status', L('Situation par classe', 'By class')], ['debtors', L('Impayés et relances', 'Debtors & reminders')], ['items', L('Grille des frais', 'Fee schedule')]];
  ctx.actions('');
  const head = `<div class="tabs" style="margin-bottom:14px">${tabs.map(([k, l]) => `<a href="#/school/fees?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  if (tab === 'till') return till(ctx, head);
  if (tab === 'receipts') {
    const d = ctx.query.date || today();
    const rows = await api.get('/api/school/receipts' + qs({ date: d }));
    const tot = {}; for (const r of rows) tot[r.method] = (tot[r.method] || 0) + r.amount;
    ctx.el.innerHTML = `${head}<div class="row" style="margin-bottom:12px"><input type="date" class="in" id="d" value="${d}"></div><div class="grid g4" style="margin-bottom:14px">${kpi(L('Total', 'Total'), money(rows.reduce((a, b) => a + b.amount, 0)), `${rows.length} ${L('reçus', 'receipts')}`, 'accent')}${Object.entries(tot).map(([m, v]) => kpi(esc(methodName(m)), money(v))).join('')}</div>
      ${table({ rows, columns: [{ label: 'N°', render: (r) => `<a class="mono" target="_blank" href="/api/school/receipts/${r.id}">${esc(r.number)}</a>` }, { label: L('Élève', 'Student'), render: (r) => `<a href="#/school/student/${r.student_id}">${esc(r.last_name)} ${esc(r.first_name)}</a>` }, { label: L('Mode', 'Method'), render: (r) => esc(methodName(r.method)) }, { label: L('Par', 'By'), key: 'by_name', hideM: true }, { label: L('Montant', 'Amount'), cls: 'r', render: (r) => `<b class="num">${money(r.amount)}</b>` }] })}`;
    document.getElementById('d').onchange = (e) => { location.hash = `/school/fees?tab=receipts&date=${e.target.value}`; };
    return;
  }
  if (tab === 'items') return feeItems(ctx, head);
  if (tab === 'debtors') {
    const cls = ctx.query.class_id || '';
    const rows = await api.get('/api/school/fees/debtors' + qs({ class_id: cls, all: ctx.query.all }));
    ctx.actions(`<a class="btn" href="/api/school/fees/debtors${qs({ class_id: cls, all: ctx.query.all, format: 'xlsx' })}">${icon('download')}<span class="hide-m">Excel</span></a>`);
    const total = rows.reduce((a, b) => a + b.overdue, 0);
    ctx.el.innerHTML = `${head}<form class="filters" id="f"><select class="in" name="class_id">${classOpts().map(([v, l]) => `<option value="${v}" ${String(v) === String(cls) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><label class="check"><input type="checkbox" name="all" ${ctx.query.all ? 'checked' : ''}> ${L('Inclure les soldes non échus', 'Include not yet due')}</label></form>
      <div class="card banner warn"><b>${rows.length} ${L('famille(s)', 'family(ies)')} · ${money(total)} ${L('en retard', 'overdue')}</b> · ${L('Chaque bouton WhatsApp envoie le montant et le lien de paiement MoMo / Orange Money du portail.', 'Each WhatsApp button sends the amount and the MoMo payment link.')}</div>
      ${table({ rows, columns: [{ label: L('Élève', 'Student'), render: (r) => `<a href="#/school/student/${r.id}"><b>${esc(r.last_name)}</b> ${esc(r.first_name)}</a><div class="muted sm">${esc(r.class_name)}</div>` }, { label: L('Parent', 'Parent'), render: (r) => `${esc(r.guardian_name || '')}<div class="muted sm">${esc(r.guardian_phone || '')}</div>` },
        { label: L('Depuis', 'Since'), render: (r) => dt(r.oldest), hideM: true }, { label: L('En retard', 'Overdue'), cls: 'r', render: (r) => `<b class="num" style="color:var(--bad)">${money(r.overdue)}</b><div class="muted sm">${L('total', 'total')} ${money(r.due)}</div>` },
        { label: '', render: (r) => (r.guardian_phone ? `<a class="btn sm primary" target="_blank" href="${wa(r.guardian_phone, `Bonjour ${r.guardian_name}, sauf erreur de notre part, ${money(r.overdue)} restent dus pour la scolarité de ${r.first_name} (${r.class_name}). Vous pouvez payer par MTN MoMo ou Orange Money ici : ${r.portal_url} . Merci. ${state.me.company.name}`)}">${L('Relancer', 'Remind')}</a>` : '') }] })}`;
    const f = document.getElementById('f'); f.onchange = () => { location.hash = '/school/fees' + qs({ tab: 'debtors', class_id: f.class_id.value, all: f.all.checked ? 1 : '' }); };
    return;
  }
  const d = await api.get('/api/school/fees/status');
  ctx.actions(`<a class="btn" href="/api/school/fees/status?format=xlsx">${icon('download')}<span class="hide-m">Excel</span></a>`);
  const T = d.classes.reduce((a, b) => ({ billed: a.billed + b.billed, paid: a.paid + b.paid, due: a.due + b.due, overdue: a.overdue + b.overdue }), { billed: 0, paid: 0, due: 0, overdue: 0 });
  ctx.el.innerHTML = `${head}<div class="grid g4" style="margin-bottom:14px">${kpi(L('Facturé', 'Billed'), money(T.billed))}${kpi(L('Encaissé', 'Collected'), money(T.paid), `${dec(T.billed ? (T.paid / T.billed) * 100 : 0, 1)} %`, 'accent')}${kpi(L('Reste', 'Outstanding'), money(T.due))}${kpi(L('En retard', 'Overdue'), money(T.overdue), '', T.overdue ? 'warn' : '')}</div>
    <div class="grid g2"><div>${table({ rows: d.classes, columns: [{ label: L('Classe', 'Class'), render: (c) => `<b>${esc(c.name)}</b><div class="muted sm">${c.students} ${L('élèves', 'students')}</div>` }, { label: L('Encaissé', 'Collected'), cls: 'r', render: (c) => `<span class="num">${money(c.paid)}</span><div class="sc-fill"><i style="width:${c.rate}%"></i></div>` }, { label: '%', cls: 'r', render: (c) => `<b>${dec(c.rate, 0)}</b>` }, { label: L('Retard', 'Overdue'), cls: 'r', render: (c) => (c.overdue ? `<a class="num" style="color:var(--bad)" href="#/school/fees?tab=debtors&class_id=${c.id}">${money(c.overdue)}</a>` : '—') }] })}</div>
    <div>${table({ rows: d.items, columns: [{ label: L('Échéance', 'Instalment'), render: (i) => `<b>${esc(i.name)}</b><div class="muted sm">${dt(i.due_date)} · ${i.n} ${L('factures', 'invoices')}</div>` }, { label: L('Facturé', 'Billed'), cls: 'r', render: (i) => `<span class="num">${money(i.billed)}</span>` }, { label: L('Encaissé', 'Collected'), cls: 'r', render: (i) => `<span class="num">${money(i.paid)}</span><div class="sc-fill"><i style="width:${i.billed ? (i.paid / i.billed) * 100 : 0}%"></i></div>` }] })}</div></div>`;
});

async function feeItems(ctx, head) {
  const items = await api.get('/api/school/fees/items');
  const levels = S().levels;
  const set = can('settings');
  ctx.actions(set ? `<button class="btn" id="bill">${icon('invoice')}<span class="hide-m">${L('Facturer les nouveaux frais', 'Bill new fees')}</span></button><button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${L('Ajouter un frais', 'Add a fee')}</span></button>` : '');
  const K = { registration: L('Inscription', 'Registration'), tuition: L('Scolarité', 'Tuition'), other: L('Autre obligatoire', 'Other required'), optional: L('Service optionnel', 'Optional service') };
  ctx.el.innerHTML = `${head}<div class="card banner info">${L('Chaque frais devient une facture Teknons Compta (exonérée de TVA) au nom du parent, à l\'inscription. Les réductions (bourses, fratrie) s\'appliquent à la scolarité. Les services optionnels (cantine, transport) ne sont facturés qu\'aux élèves abonnés.', 'Each fee becomes a VAT-exempt Compta invoice to the guardian at enrolment.')}</div>
  ${table({ rows: items, columns: [{ label: L('Frais', 'Fee'), render: (i) => `<b>${esc(i.name)}</b>${i.active ? '' : ` <span class="pill">${L('inactif', 'inactive')}</span>`}` }, { label: L('Type', 'Type'), render: (i) => esc(K[i.kind]) }, { label: L('Niveau', 'Level'), render: (i) => esc(i.level_name || L('Tous', 'All')) }, { label: L('Échéance', 'Due'), render: (i) => dt(i.due_date) }, { label: L('Compte', 'Account'), render: (i) => `<span class="mono">${esc(i.account_code)}</span>`, hideM: true }, { label: L('Montant', 'Amount'), cls: 'r', render: (i) => `<b class="num">${money(i.amount)}</b>` }, ...(set ? [{ label: '', render: (i) => `<button class="btn sm ghost" data-ed="${i.id}">${icon('edit')}</button>` }] : [])] })}`;
  const dlg = async (it = {}) => {
    const v = await dialog({ title: it.id ? it.name : L('Nouveau frais', 'New fee'), body: `<div class="form f2">${field({ name: 'name', label: L('Libellé', 'Label'), required: true }, it)}${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: Object.entries(K) }, it)}
      ${field({ name: 'amount', label: L('Montant (FCFA)', 'Amount (FCFA)'), type: 'number', min: 0, required: true }, it)}${field({ name: 'due_date', label: L('Échéance', 'Due date'), type: 'date', required: true }, it)}
      ${field({ name: 'level_id', label: L('Niveau', 'Level'), type: 'select', options: [['', L('Tous les niveaux', 'Every level')], ...levels.map((l) => [l.id, l.name])] }, it)}${field({ name: 'account_code', label: L('Compte de produit', 'Revenue account'), type: 'select', options: [['7061', '7061 Scolarité'], ['7062', '7062 Inscription / examens'], ['7068', '7068 Services scolaires']] }, it)}
      ${it.id ? field({ name: 'active', label: L('Actif', 'Active'), type: 'checkbox' }, it) : ''}</div>`,
    onSubmit: (b) => (it.id ? api.put(`/api/school/fees/items/${it.id}`, b) : api.post('/api/school/fees/items', b)) });
    if (v) { await refreshMeta(); ctx.rerender(); }
  };
  document.getElementById('add')?.addEventListener('click', () => dlg());
  document.getElementById('bill')?.addEventListener('click', async () => { if (!(await confirmDlg(L('Facturer', 'Bill'), L('Créer les factures manquantes pour tous les élèves inscrits ?', 'Create missing invoices for every enrolled student?')))) return; try { const r = await api.post('/api/school/fees/bill-all'); toast(`${r.invoices} ${L('facture(s) créée(s)', 'invoice(s) created')}`, 'ok'); } catch (e) { fail(e); } });
  ctx.el.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', () => dlg(items.find((x) => x.id === Number(b.dataset.ed)))));
}

async function till(ctx, head) {
  const sid = ctx.query.student;
  ctx.el.innerHTML = `${head}<div class="sc-till"><div class="card"><h3>${icon('scan')} ${lmd() ? L('Étudiant', 'Student') : L('Élève', 'Student')}</h3><input class="in" id="q" type="search" placeholder="${L('Nom, matricule ou carte (scanner)', 'Name, ID or card scan')}" autofocus style="width:100%"><div id="res" class="cust-list" style="margin-top:8px"></div></div><div id="pane"></div></div>`;
  const q = document.getElementById('q'), res = document.getElementById('res'), pane = document.getElementById('pane');
  let timer;
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (q.value.trim().length < 2) { res.innerHTML = ''; return; }
    const code = q.value.match(/\/v\/c\/([A-Z0-9]+)/i)?.[1];
    const list = await api.get('/api/school/students' + qs({ q: code || q.value.trim() }), { cache: false }).catch(() => []);
    res.innerHTML = list.slice(0, 8).map((s) => `<button class="cust-it" data-s="${s.id}"><span>${avatar(s, 28)} <b>${esc(s.last_name)}</b> ${esc(s.first_name)} <span class="muted sm">${esc(s.class_name || '')}</span></span><span class="num ${s.due ? '' : 'muted'}">${s.due ? money(s.due) : L('à jour', 'paid')}</span></button>`).join('') || `<p class="muted">${L('Aucun résultat', 'No match')}</p>`;
    res.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => show(b.dataset.s)));
  }, 250); };
  const show = async (id) => {
    res.innerHTML = '';
    const d = await api.get(`/api/school/fees/student/${id}`, { cache: false });
    const s = d.student; const open = d.items.filter((x) => ['open', 'partial'].includes(x.status));
    pane.innerHTML = `<div class="card"><div class="row between"><div class="row">${avatar(s, 44)}<div><b style="font-size:17px">${esc(s.last_name)} ${esc(s.first_name)}</b><div class="muted sm">${esc(s.matricule)} · ${esc(s.class_name || '')} · ${esc(s.guardian_name || '')} ${esc(s.guardian_phone || '')}</div></div></div><a class="btn sm" href="#/school/student/${s.id}?tab=fees">${L('Fiche', 'File')}</a></div>
      <div class="grid g3" style="margin:12px 0;gap:8px">${kpi(L('Total année', 'Year total'), money(d.total))}${kpi(L('Reste à payer', 'Balance'), money(d.balance), '', 'accent')}${kpi(L('En retard', 'Overdue'), money(d.overdue), '', d.overdue ? 'warn' : '')}</div>
      ${feeTable(d.items)}
      ${open.length ? `<form id="pay" class="form f3" style="margin-top:14px"><label class="fld">${L('Montant reçu', 'Amount received')}<input name="amount" type="number" min="1" max="${d.balance}" value="${open[0].balance}" required class="num" style="font-size:20px;font-weight:800"></label>
        <label class="fld">${L('Mode', 'Method')}<select name="method">${Object.keys(METHODS).map((m) => `<option value="${m}">${esc(methodName(m))}</option>`).join('')}</select></label>
        <label class="fld">${L('Référence (MoMo, chèque…)', 'Reference')}<input name="reference"></label><label class="fld">${L('Payé par', 'Paid by')}<input name="payer" value="${esc(s.guardian_name || '')}"></label>
        <div class="row" style="grid-column:1/-1;gap:6px;flex-wrap:wrap">${[...new Set([open[0].balance, d.overdue, d.balance].filter((x) => x > 0))].map((v) => `<button type="button" class="btn sm" data-amt="${v}">${money(v)}</button>`).join('')}</div>
        <div class="row" style="grid-column:1/-1;gap:8px"><button class="btn primary" style="flex:1">${icon('cash')} ${L('Encaisser et imprimer le reçu', 'Collect and print receipt')}</button><button type="button" class="btn" id="momo">📲 ${L('Demande MoMo', 'MoMo request')}</button></div></form>
        <p class="muted sm">${L('Le montant est réparti sur les échéances les plus anciennes. L\'écriture comptable est passée immédiatement.', 'The amount settles the oldest instalments first and is posted to the books at once.')}</p>` : `<div class="banner ok" style="margin-top:12px"><b>${L('Rien à payer : élève à jour.', 'Nothing due.')}</b></div>`}</div>`;
    const f = document.getElementById('pay');
    f?.querySelectorAll('[data-amt]').forEach((b) => b.addEventListener('click', () => { f.amount.value = b.dataset.amt; }));
    f?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api.post('/api/school/fees/collect', { student_id: s.id, amount: Number(f.amount.value), method: f.method.value, reference: f.reference.value, payer: f.payer.value });
        toast(`${r.number} · ${money(r.amount)}`, 'ok'); window.open(`/api/school/receipts/${r.id}?print=1`, '_blank'); show(s.id);
      } catch (err) { fail(err); }
    });
    document.getElementById('momo')?.addEventListener('click', async () => {
      const v = await dialog({ title: L('Demande de paiement Mobile Money', 'Mobile Money request'), submit: L('Envoyer', 'Send'), body: `${field({ name: 'phone', label: L('Téléphone du payeur', 'Payer phone'), value: s.guardian_phone || '', required: true })}${field({ name: 'amount', label: L('Montant', 'Amount'), type: 'number', value: f.amount.value })}<p class="muted sm">${L('Le parent valide avec son code secret ; le paiement est enregistré automatiquement.', 'The parent confirms with their PIN; the payment is recorded automatically.')}</p>`,
        onSubmit: (b) => api.post('/api/school/fees/momo', { student_id: s.id, phone: b.phone, amount: Number(b.amount) }) });
      if (v) toast(`${L('Demande envoyée', 'Request sent')} : ${money(v.amount)} (${v.document})`, 'ok');
    });
  };
  if (sid) show(sid);
}
