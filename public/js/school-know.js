// Teknons École, knowledge and management: library, research and publications,
// thesis supervision, e-learning (courses, quizzes, assignments, live classes,
// certificates), teachers and staff files with workload, and school settings.
import { api } from './api.js';
import { state, L, esc, money, num, dt, today, icon, can, canAny, table, field, dialog, toast, confirmDlg, offlineNote, qs } from './ui.js';
import { R, S, fail, refreshMeta, kpi, dec, isManager, isTeacher, lmd } from './school.js';

const go = (path, q) => { location.hash = path + qs(q); };
const tabs = (base, list, cur) => `<div class="tabs" style="margin-bottom:14px">${list.map(([k, l]) => `<a href="#${base}${base.includes('?') ? '&' : '?'}tab=${k}" class="${cur === k ? 'on' : ''}">${l}</a>`).join('')}</div>`;
const studentPicker = (name = 'student_id', label = L('Élève', 'Student')) => `<label class="fld" style="grid-column:1/-1">${label}<input name="${name}_q" list="${name}_l" placeholder="${L('Nom ou matricule', 'Name or ID')}" autocomplete="off"><datalist id="${name}_l"></datalist><input type="hidden" name="${name}"></label>`;
async function wirePicker(d, name = 'student_id') {
  const list = await api.get('/api/school/students');
  const dl = d.querySelector(`#${name}_l`); const q = d.querySelector(`[name=${name}_q]`); const h = d.querySelector(`[name=${name}]`);
  dl.innerHTML = list.map((x) => `<option value="${esc(`${x.last_name} ${x.first_name} · ${x.matricule}`)}">${esc(x.class_name || '')}</option>`).join('');
  q.addEventListener('input', () => { const m = list.find((x) => `${x.last_name} ${x.first_name} · ${x.matricule}` === q.value || x.matricule === q.value.trim()); h.value = m ? m.id : ''; });
}
const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

// ===================== Library =====================
R('/school/library', async (ctx) => {
  ctx.title(L('Bibliothèque', 'Library'));
  const tab = ctx.query.tab || 'catalogue';
  const lib = canAny('library', 'schooloffice');
  ctx.actions(lib ? `<button class="btn" id="ret">${icon('undo')}<span class="hide-m">${L('Retour', 'Return')}</span></button><button class="btn" id="add">${icon('plus')}<span class="hide-m">${L('Ouvrage', 'Book')}</span></button><button class="btn primary" id="lend">${icon('book')}<span class="hide-m">${L('Prêter', 'Lend')}</span></button>` : '');
  const st = await api.get('/api/school/library');
  const head = `<div class="grid g4" style="margin-bottom:14px">${kpi(L('Titres', 'Titles'), num(st.titles), `${num(st.copies)} ${L('exemplaires', 'copies')} · ${st.ebooks} ${L('numériques', 'e-books')}`, 'accent')}${kpi(L('En prêt', 'On loan'), st.out, `${st.month} ${L('prêts ce mois', 'loans this month')}`)}
    ${kpi(L('En retard', 'Overdue'), st.overdue, '', st.overdue ? 'warn' : '', '#/school/library?tab=loans&overdue=1')}${kpi(L('Réservations', 'Holds'), st.holds, '', '', '#/school/library?tab=holds')}</div>
    ${tabs('/school/library', [['catalogue', L('Catalogue', 'Catalogue')], ['loans', L('Prêts', 'Loans')], ...(lib ? [['holds', L('Réservations', 'Holds')]] : []), ['stats', L('Statistiques', 'Statistics')]], tab)}`;
  if (tab === 'catalogue') {
    const q = ctx.query.q || '';
    const books = await api.get(`/api/school/books${qs({ q })}`);
    ctx.el.innerHTML = `${head}<form id="sf" class="card filters"><div class="row" style="gap:8px"><input name="q" value="${esc(q)}" placeholder="${L('Titre, auteur, ISBN, code, rayon…', 'Title, author, ISBN, code, shelf…')}" style="flex:1"><button class="btn">${L('Chercher', 'Search')}</button></div></form>
      <div class="sc-books">${books.map((b) => `<div class="card sc-book" data-id="${b.id}"><div class="sc-cover" style="--c:${esc(b.cover_color || '#0F3B2C')}"><b>${esc(b.title.slice(0, 60))}</b><span>${esc((b.authors || '').split(',')[0])}</span></div>
        <div><b>${esc(b.title)}</b><div class="muted sm">${esc(b.authors || '')}${b.year ? ` · ${b.year}` : ''}</div><div class="muted sm">${esc(b.category || '')}${b.location ? ` · ${L('rayon', 'shelf')} ${esc(b.location)}` : ''} · <span class="mono">${esc(b.code)}</span></div>
        <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap"><span class="pill ${b.available ? 'ok' : 'bad'}">${b.available}/${b.copies} ${L('dispo.', 'avail.')}</span>${b.holds ? `<span class="pill warn">${b.holds} ${L('en attente', 'waiting')}</span>` : ''}${b.ebook_url ? `<a class="pill info" target="_blank" href="${esc(b.ebook_url)}">${L('Lire en ligne', 'Read online')}</a>` : ''}</div></div></div>`).join('') || `<div class="card empty"><b>${L('Aucun ouvrage', 'No book')}</b></div>`}</div>`;
    document.getElementById('sf').addEventListener('submit', (e) => { e.preventDefault(); go('/school/library', { q: e.target.q.value }); });
    if (lib) ctx.el.querySelectorAll('.sc-book').forEach((c) => c.addEventListener('click', async (e) => { if (e.target.closest('a')) return; if (await bookDialog(books.find((b) => b.id === Number(c.dataset.id)))) ctx.rerender(); }));
  } else if (tab === 'loans') {
    const loans = await api.get(`/api/school/loans${qs({ open: ctx.query.all ? '' : 1, overdue: ctx.query.overdue || '' })}`);
    ctx.el.innerHTML = `${head}<div class="row" style="gap:6px;margin-bottom:10px"><a class="btn sm ${!ctx.query.overdue && !ctx.query.all ? 'primary' : ''}" href="#/school/library?tab=loans">${L('En cours', 'Open')}</a><a class="btn sm ${ctx.query.overdue ? 'primary' : ''}" href="#/school/library?tab=loans&overdue=1">${L('En retard', 'Overdue')}</a><a class="btn sm ${ctx.query.all ? 'primary' : ''}" href="#/school/library?tab=loans&all=1">${L('Historique', 'History')}</a></div>
      ${table({ rows: loans, columns: [{ label: L('Ouvrage', 'Book'), render: (l) => `<b>${esc(l.title)}</b><div class="muted sm mono">${esc(l.book_code)}</div>` }, { label: L('Lecteur', 'Borrower'), render: (l) => `${l.student_id ? `<a href="#/school/student/${l.student_id}">${esc(l.borrower)}</a>` : esc(l.borrower)}<div class="muted sm">${esc(l.class_name || (l.user_id ? L('Personnel', 'Staff') : ''))}</div>` },
        { label: L('Prêté le', 'Borrowed'), render: (l) => dt(l.borrowed_at), hideM: true }, { label: L('Retour prévu', 'Due'), render: (l) => (l.returned_at ? `<span class="pill">${L('rendu', 'returned')} ${dt(l.returned_at)}</span>` : `<span class="pill ${l.overdue ? 'bad' : 'info'}">${dt(l.due_date)}</span>${l.renewals ? ` <span class="muted sm">↻${l.renewals}</span>` : ''}`) },
        { label: L('Amende', 'Fine'), cls: 'r', render: (l) => (l.fine_due > 0 ? `<b class="bad-t">${money(l.fine_due)}</b>` : '—') },
        ...(lib ? [{ label: '', cls: 'r', render: (l) => (l.returned_at ? '' : `<button class="btn sm" data-renew="${l.id}">${L('Prolonger', 'Renew')}</button> <button class="btn sm primary" data-back="${l.id}">${L('Retour', 'Return')}</button>`) }] : [])] })}`;
    ctx.el.querySelectorAll('[data-renew]').forEach((b) => b.addEventListener('click', async () => { try { const r = await api.post(`/api/school/loans/${b.dataset.renew}/renew`, {}); toast(`${L('Prolongé jusqu\'au', 'Renewed until')} ${dt(r.due_date)}`, 'ok'); ctx.rerender(); } catch (err) { fail(err); } }));
    ctx.el.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', async () => { if (await returnDialog(loans.find((l) => l.id === Number(b.dataset.back)))) ctx.rerender(); }));
  } else if (tab === 'holds') {
    const holds = await api.get('/api/school/holds');
    ctx.el.innerHTML = `${head}${table({ rows: holds, empty: `<b>${L('Aucune réservation', 'No hold')}</b><p>${L('Les élèves réservent depuis leur portail un livre déjà prêté ; ils sont prévenus quand il revient.', 'Students hold a book from their portal and are told when it is back.')}</p>`,
      columns: [{ label: L('Ouvrage', 'Book'), key: 'title' }, { label: L('Élève', 'Student'), render: (h) => `<a href="#/school/student/${h.student_id}">${esc(h.last_name)} ${esc(h.first_name)}</a>` }, { label: L('Depuis', 'Since'), render: (h) => dt(h.created_at) },
        { label: L('État', 'Status'), render: (h) => `<span class="pill ${h.status === 'ready' ? 'ok' : 'warn'}">${h.status === 'ready' ? L('Prêt à retirer', 'Ready to collect') : L('En attente', 'Waiting')}</span>` }] })}`;
  } else {
    const mx = Math.max(1, ...st.top.map((x) => x.n));
    ctx.el.innerHTML = `${head}<div class="grid g3"><div class="card"><h3>${L('Les plus empruntés', 'Most borrowed')}</h3><div class="bar-list">${st.top.map((b) => `<div class="it"><span>${esc(b.title)}</span><b class="num">${b.n}</b><div class="tr"><i style="width:${(b.n / mx) * 100}%"></i></div></div>`).join('') || '<p class="muted">—</p>'}</div></div>
      <div class="card"><h3>${L('Meilleurs lecteurs', 'Top readers')}</h3>${st.readers.map((r, i) => `<div class="lrow row between"><span>${['🥇', '🥈', '🥉'][i] || ''} ${esc(r.name)}</span><b>${r.n}</b></div>`).join('') || '<p class="muted">—</p>'}</div>
      <div class="card"><h3>${L('Fonds par catégorie', 'Collection by category')}</h3>${st.categories.map((c) => `<div class="lrow row between"><span>${esc(c.category)}</span><b>${c.n}</b></div>`).join('')}</div></div>`;
  }
  document.getElementById('add')?.addEventListener('click', async () => { if (await bookDialog()) ctx.rerender(); });
  document.getElementById('lend')?.addEventListener('click', async () => { if (await lendDialog()) ctx.rerender(); });
  document.getElementById('ret')?.addEventListener('click', async () => {
    const code = await dialog({ title: L('Retour d\'un livre', 'Return a book'), submit: L('Chercher', 'Find'), body: field({ name: 'code', label: L('Code du livre (étiquette)', 'Book code (label)'), required: true }), onSubmit: (b) => b.code.trim().toUpperCase() });
    if (!code) return;
    const open = await api.get('/api/school/loans?open=1'); const l = open.find((x) => x.book_code === code);
    if (!l) return toast(L('Aucun prêt en cours pour ce code', 'No open loan for this code'), 'err');
    if (await returnDialog(l)) ctx.rerender();
  });
}, true);

function bookDialog(b = {}) {
  return dialog({ title: b.id ? b.title : L('Nouvel ouvrage', 'New book'), wide: true, body: `<div class="form f3">${field({ name: 'title', label: L('Titre', 'Title'), required: true, span: true }, b)}${field({ name: 'authors', label: L('Auteur(s)', 'Author(s)') }, b)}
    ${field({ name: 'publisher', label: L('Éditeur', 'Publisher') }, b)}${field({ name: 'year', label: L('Année', 'Year'), type: 'number' }, b)}${field({ name: 'isbn', label: 'ISBN' }, b)}${field({ name: 'category', label: L('Catégorie', 'Category'), list: 'bcat' }, b)}
    <datalist id="bcat">${['Littérature africaine', 'Roman', 'Mathématiques', 'Physique-Chimie', 'SVT', 'Histoire-Géographie', 'Philosophie', 'Anglais', 'Informatique', 'Droit', 'Économie', 'Médecine', 'Dictionnaires', 'Jeunesse'].map((x) => `<option value="${x}">`).join('')}</datalist>
    ${field({ name: 'dewey', label: 'Cote / Dewey' }, b)}${field({ name: 'copies', label: L('Exemplaires', 'Copies'), type: 'number', min: 0, value: 1 }, b)}${field({ name: 'location', label: L('Rayon', 'Shelf') }, b)}${field({ name: 'language', label: L('Langue', 'Language'), type: 'select', options: [['fr', 'Français'], ['en', 'English'], ['other', L('Autre', 'Other')]] }, b)}
    ${field({ name: 'ebook_url', label: L('Lien du livre numérique (facultatif)', 'E-book link (optional)'), placeholder: 'https://', span: true }, b)}${field({ name: 'summary', label: L('Résumé', 'Summary'), type: 'textarea', span: true }, b)}</div>`,
  onSubmit: (v) => (b.id ? api.put(`/api/school/books/${b.id}`, v) : api.post('/api/school/books', v)) });
}

function lendDialog() {
  return dialog({ title: L('Prêter un livre', 'Lend a book'), submit: L('Prêter', 'Lend'), body: `<div class="form f2">${field({ name: 'code', label: L('Code ou ISBN du livre', 'Book code or ISBN'), required: true, span: true })}
    ${field({ name: 'who', label: L('Lecteur', 'Borrower'), type: 'select', options: [['student', lmd() ? L('Étudiant', 'Student') : L('Élève', 'Student')], ['staff', L('Personnel', 'Staff')]], span: true })}
    ${studentPicker('student_id', L('Élève (ou scannez sa carte)', 'Student (or scan their card)'))}<label class="fld" style="grid-column:1/-1;display:none" id="stf">${L('Membre du personnel', 'Staff member')}<select name="user_id">${S().teachers.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    ${field({ name: 'days', label: L('Durée (jours)', 'Days'), type: 'number', min: 1, value: S().settings.loan_days })}</div>`,
  onOpen: async (d) => { const who = d.querySelector('[name=who]'); who.onchange = () => { d.querySelector('#stf').style.display = who.value === 'staff' ? '' : 'none'; d.querySelector('[name=student_id_q]').closest('label').style.display = who.value === 'staff' ? 'none' : ''; }; await wirePicker(d); },
  onSubmit: async (b) => { const body = { code: b.code, days: b.days, ...(b.who === 'staff' ? { user_id: b.user_id } : b.student_id ? { student_id: b.student_id } : { student_code: b.student_id_q.trim() }) }; const r = await api.post('/api/school/loans', body); toast(`${L('Prêté jusqu\'au', 'Due')} ${dt(r.due_date)}`, 'ok'); return r; } });
}

function returnDialog(l) {
  return dialog({ title: `${L('Retour', 'Return')} · ${l.title}`, submit: L('Enregistrer le retour', 'Record return'), body: `<p>${esc(l.borrower)} · ${L('prévu le', 'due')} ${dt(l.due_date)}</p>
    ${l.fine_due > 0 ? `<div class="banner warn">${L('Retard : amende de', 'Late: fine of')} <b>${money(l.fine_due)}</b></div>${field({ name: 'paid', label: L('Amende payée maintenant', 'Fine paid now'), type: 'checkbox' })}${field({ name: 'waive', label: L('Annuler l\'amende', 'Waive the fine'), type: 'checkbox' })}` : `<p class="muted">${L('Rendu à temps, pas d\'amende.', 'Returned on time, no fine.')}</p>`}`,
  onSubmit: async (b) => { const r = await api.post(`/api/school/loans/${l.id}/return`, b); if (r.hold_ready) toast(L('Un autre lecteur attendait ce livre : mettez-le de côté', 'Someone was waiting for this book: set it aside'), 'ok'); return r; } });
}

// ===================== Research, publications, theses =====================
R('/school/research', async (ctx) => {
  ctx.title(L('Recherche et publications', 'Research & publications'));
  const tab = ctx.query.tab || 'publications';
  const can_ = canAny('teaching', 'library', 'settings');
  const pubUrl = `${S().public_url}/research`;
  ctx.actions(`${S().settings.repository_public ? `<a class="btn" target="_blank" href="${esc(pubUrl)}">${icon('globe')}<span class="hide-m">${L('Dépôt public', 'Public repository')}</span></a>` : ''}${can_ ? `<button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${tab === 'projects' ? L('Projet', 'Project') : tab === 'theses' ? L('Mémoire / thèse', 'Thesis') : L('Publication', 'Publication')}</span></button>` : ''}`);
  const head = tabs('/school/research', [['publications', L('Publications', 'Publications')], ['projects', L('Projets de recherche', 'Research projects')], ['theses', L('Mémoires et thèses', 'Theses & dissertations')]], tab);
  if (tab === 'publications') {
    const q = ctx.query.q || '';
    const list = await api.get(`/api/school/publications${qs({ q })}`);
    const views = list.reduce((a, b) => a + b.views, 0), dl = list.reduce((a, b) => a + b.downloads, 0);
    ctx.el.innerHTML = `${head}<div class="grid g4" style="margin-bottom:14px">${kpi(L('Publications', 'Publications'), list.length, `${list.filter((p) => p.kind === 'article').length} ${L('articles', 'articles')}`, 'accent')}${kpi(L('Consultations', 'Views'), num(views))}${kpi(L('Téléchargements', 'Downloads'), num(dl))}${kpi(L('En libre accès', 'Open access'), list.filter((p) => p.public).length)}</div>
      <form id="sf" class="card filters"><div class="row" style="gap:8px"><input name="q" value="${esc(q)}" placeholder="${L('Titre, auteur, mot-clé…', 'Title, author, keyword…')}" style="flex:1"><button class="btn">${L('Chercher', 'Search')}</button></div></form>
      ${list.map((p) => `<div class="card sc-pub" data-id="${p.id}"><div class="row between" style="gap:8px"><span class="pill">${esc(L(...(S().pub_kinds[p.kind] || [p.kind, p.kind])))}</span><span class="muted sm">${p.views} ${L('vues', 'views')} · ${p.downloads} ${L('téléch.', 'downloads')} ${p.public ? '' : `· ${L('privé', 'private')}`}</span></div>
        <h4 style="margin:6px 0 2px">${esc(p.title)}</h4><div class="muted">${esc(p.authors)} · ${p.year}${p.venue ? ` · <i>${esc(p.venue)}</i>` : ''}</div>
        ${p.abstract ? `<p class="sm" style="margin:6px 0">${esc(p.abstract.slice(0, 260))}${p.abstract.length > 260 ? '…' : ''}</p>` : ''}
        <div class="row" style="gap:6px;flex-wrap:wrap">${p.doi ? `<a class="pill info" target="_blank" href="https://doi.org/${esc(p.doi.replace(/^https?:\/\/doi.org\//, ''))}">DOI</a>` : ''}${p.has_file ? `<a class="pill ok" target="_blank" href="/research/file/${esc(p.code)}">PDF</a>` : ''}${p.url ? `<a class="pill" target="_blank" href="${esc(p.url)}">${L('Lien', 'Link')}</a>` : ''}<button type="button" class="pill" data-cite="${p.id}">${L('Citer (APA)', 'Cite (APA)')}</button></div></div>`).join('') || `<div class="card empty"><b>${L('Aucune publication', 'No publication')}</b><p>${L('Articles, communications, ouvrages, mémoires et jeux de données de vos enseignants-chercheurs et étudiants, avec une page publique en libre accès.', 'Articles, papers, books, dissertations and datasets of your faculty and students, with an open-access public page.')}</p></div>`}`;
    document.getElementById('sf').addEventListener('submit', (e) => { e.preventDefault(); go('/school/research', { q: e.target.q.value }); });
    ctx.el.querySelectorAll('[data-cite]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const p = list.find((x) => x.id === Number(b.dataset.cite)); navigator.clipboard?.writeText(p.cite); toast(L('Citation copiée', 'Citation copied'), 'ok'); }));
    if (can_) ctx.el.querySelectorAll('.sc-pub').forEach((c) => c.addEventListener('click', async (e) => { if (e.target.closest('a,button')) return; if (await pubDialog(list.find((p) => p.id === Number(c.dataset.id)))) ctx.rerender(); }));
    document.getElementById('add')?.addEventListener('click', async () => { if (await pubDialog()) ctx.rerender(); });
  } else if (tab === 'projects') {
    const list = await api.get('/api/school/research');
    const ST = { proposal: L('Proposition', 'Proposal'), active: L('En cours', 'Active'), completed: L('Terminé', 'Completed'), suspended: L('Suspendu', 'Suspended') };
    ctx.el.innerHTML = `${head}<div class="grid g3" style="margin-bottom:14px">${kpi(L('Projets actifs', 'Active projects'), list.filter((r) => r.status === 'active').length, '', 'accent')}${kpi(L('Budget total', 'Total budget'), money(list.reduce((a, b) => a + b.budget, 0)))}${kpi(L('Dépensé', 'Spent'), money(list.reduce((a, b) => a + b.spent, 0)))}</div>
      <div class="grid g2">${list.map((r) => { const done = r.milestones.filter((m) => m.done).length; return `<div class="card sc-pub" data-id="${r.id}"><div class="row between"><span class="pill ${r.status === 'active' ? 'ok' : ''}">${esc(ST[r.status])}</span><span class="muted sm">${esc(r.field || '')}</span></div>
        <h4 style="margin:6px 0 2px">${esc(r.title)}</h4><div class="muted sm">${esc(r.lead_name || '')}${r.lab ? ` · ${esc(r.lab)}` : ''}${r.funding_source ? ` · ${esc(r.funding_source)}` : ''}</div>
        ${r.budget ? `<div class="sc-fill" style="margin-top:8px"><i style="width:${Math.min(100, (r.spent / r.budget) * 100)}%"></i></div><div class="muted sm">${money(r.spent)} / ${money(r.budget)}</div>` : ''}
        ${r.milestones.length ? `<div class="muted sm" style="margin-top:6px">${L('Jalons', 'Milestones')} ${done}/${r.milestones.length} · ${r.milestones.map((m) => `${m.done ? '✓' : '○'} ${esc(m.title)}`).join(' · ')}</div>` : ''}<div class="muted sm">${r.publications} ${L('publication(s)', 'publication(s)')}</div></div>`; }).join('') || `<div class="card empty"><b>${L('Aucun projet', 'No project')}</b></div>`}</div>`;
    if (can_) ctx.el.querySelectorAll('.sc-pub').forEach((c) => c.addEventListener('click', async () => { if (await projectDialog(list.find((r) => r.id === Number(c.dataset.id)))) ctx.rerender(); }));
    document.getElementById('add')?.addEventListener('click', async () => { if (await projectDialog()) ctx.rerender(); });
  } else {
    const list = await api.get('/api/school/theses');
    const SG = { proposal: L('Sujet déposé', 'Proposal'), writing: L('Rédaction', 'Writing'), submitted: L('Déposé', 'Submitted'), defense: L('Soutenance programmée', 'Defence scheduled'), defended: L('Soutenu', 'Defended') };
    const LV = { licence: 'Licence', master: 'Master', phd: L('Doctorat', 'PhD') };
    ctx.el.innerHTML = `${head}<div class="sc-kanban">${Object.keys(SG).map((k) => `<div class="sc-col"><h4>${esc(SG[k])} <span class="muted">${list.filter((t) => t.stage === k).length}</span></h4>${list.filter((t) => t.stage === k).map((t) => `<div class="card sc-pub" data-id="${t.id}"><span class="pill">${esc(LV[t.level])}</span><b style="display:block;margin:4px 0">${esc(t.title)}</b>
      <div class="muted sm">${esc(t.last_name)} ${esc(t.first_name)} · ${L('dir.', 'sup.')} ${esc(t.supervisor_name || '—')}</div>${t.defense_date ? `<div class="sm">📅 ${dt(t.defense_date)}</div>` : ''}${t.grade != null ? `<div class="sm"><b>${dec(t.grade)}/20</b></div>` : ''}</div>`).join('')}</div>`).join('')}</div>`;
    if (can_) ctx.el.querySelectorAll('.sc-pub').forEach((c) => c.addEventListener('click', async () => { if (await thesisDialog(list.find((t) => t.id === Number(c.dataset.id)))) ctx.rerender(); }));
    document.getElementById('add')?.addEventListener('click', async () => { if (await thesisDialog()) ctx.rerender(); });
  }
});

function pubDialog(p = {}) {
  return dialog({ title: p.id ? L('Publication', 'Publication') : L('Nouvelle publication', 'New publication'), wide: true, body: `<div class="form f3">
    ${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: Object.entries(S().pub_kinds).map(([k, v]) => [k, L(v[0], v[1])]) }, p)}${field({ name: 'year', label: L('Année', 'Year'), type: 'number', value: today().slice(0, 4) }, p)}
    ${field({ name: 'status', label: L('Statut', 'Status'), type: 'select', options: [['published', L('Publié', 'Published')], ['review', L('En évaluation', 'Under review')], ['submitted', L('Soumis', 'Submitted')]] }, p)}
    ${field({ name: 'title', label: L('Titre', 'Title'), required: true, span: true }, p)}${field({ name: 'authors', label: L('Auteurs (Nom, I., Nom, I.)', 'Authors (Last, I., Last, I.)'), required: true, span: true }, p)}
    ${field({ name: 'venue', label: L('Revue / conférence / éditeur', 'Journal / conference / publisher') }, p)}${field({ name: 'doi', label: 'DOI' }, p)}${field({ name: 'field', label: L('Domaine', 'Field') }, p)}
    ${field({ name: 'keywords', label: L('Mots-clés', 'Keywords'), span: true }, p)}${field({ name: 'abstract', label: L('Résumé', 'Abstract'), type: 'textarea', span: true }, p)}
    ${field({ name: 'url', label: L('Lien externe', 'External link'), placeholder: 'https://' }, p)}<label class="fld">PDF (≤ 1,4 Mo)<input type="file" name="pdf" accept="application/pdf"></label>${field({ name: 'public', label: L('Publier en libre accès', 'Open access'), type: 'checkbox', value: p.id ? p.public : true })}</div>`,
  onSubmit: async (b, form) => { const f = form.querySelector('[name=pdf]').files[0]; delete b.pdf; if (f) { if (f.size > 1.4e6) throw new Error(L('PDF trop lourd (1,4 Mo maximum) : donnez plutôt un lien.', 'PDF too large (1.4 MB max): give a link instead.')); b.file = await readFile(f); } return p.id ? api.put(`/api/school/publications/${p.id}`, b) : api.post('/api/school/publications', b); } });
}

function projectDialog(r = {}) {
  const ms = r.milestones || [];
  return dialog({ title: r.id ? r.title : L('Nouveau projet de recherche', 'New research project'), wide: true, body: `<div class="form f3">${field({ name: 'title', label: L('Titre', 'Title'), required: true, span: true }, r)}
    ${field({ name: 'field', label: L('Domaine', 'Field') }, r)}${field({ name: 'lab', label: L('Laboratoire / équipe', 'Lab / team') }, r)}${field({ name: 'lead_id', label: L('Responsable', 'Lead'), type: 'select', options: S().teachers.map((t) => [t.id, t.name]), value: state.me.user.id }, r)}
    ${field({ name: 'status', label: L('Statut', 'Status'), type: 'select', options: [['active', L('En cours', 'Active')], ['proposal', L('Proposition', 'Proposal')], ['completed', L('Terminé', 'Completed')], ['suspended', L('Suspendu', 'Suspended')]] }, r)}
    ${field({ name: 'funding_source', label: L('Financement', 'Funding') }, r)}${field({ name: 'budget', label: L('Budget (FCFA)', 'Budget (FCFA)'), type: 'number', min: 0 }, r)}${field({ name: 'spent', label: L('Dépensé', 'Spent'), type: 'number', min: 0 }, r)}
    ${field({ name: 'start_date', label: L('Début', 'Start'), type: 'date' }, r)}${field({ name: 'end_date', label: L('Fin', 'End'), type: 'date' }, r)}${field({ name: 'members', label: L('Membres', 'Members'), span: true }, r)}${field({ name: 'abstract', label: L('Résumé', 'Abstract'), type: 'textarea', span: true }, r)}</div>
    <h4>${L('Jalons', 'Milestones')}</h4><div id="ms">${[...ms, {}, {}].map((m) => `<div class="row ms" style="gap:6px;margin-bottom:6px"><input type="checkbox" class="md" ${m.done ? 'checked' : ''}><input class="mt" value="${esc(m.title || '')}" placeholder="${L('Jalon', 'Milestone')}" style="flex:1"><input type="date" class="mdue" value="${esc(m.due || '')}"></div>`).join('')}</div>`,
  onSubmit: (b, form) => { b.milestones = [...form.querySelectorAll('.ms')].map((x) => ({ title: x.querySelector('.mt').value, due: x.querySelector('.mdue').value, done: x.querySelector('.md').checked })).filter((m) => m.title.trim()); return r.id ? api.put(`/api/school/research/${r.id}`, b) : api.post('/api/school/research', b); } });
}

function thesisDialog(t = {}) {
  return dialog({ title: t.id ? t.title : L('Mémoire ou thèse', 'Thesis or dissertation'), wide: true, body: `<div class="form f3">${t.id ? `<input type="hidden" name="student_id" value="${t.student_id}">` : studentPicker('student_id', L('Étudiant', 'Student'))}
    ${field({ name: 'title', label: L('Sujet', 'Topic'), required: true, span: true }, t)}${field({ name: 'level', label: L('Niveau', 'Level'), type: 'select', options: [['master', 'Master'], ['licence', 'Licence'], ['phd', L('Doctorat', 'PhD')]] }, t)}
    ${field({ name: 'supervisor_id', label: L('Directeur', 'Supervisor'), type: 'select', options: S().teachers.map((x) => [x.id, x.name]) }, t)}${field({ name: 'stage', label: L('Étape', 'Stage'), type: 'select', options: [['proposal', L('Sujet déposé', 'Proposal')], ['writing', L('Rédaction', 'Writing')], ['submitted', L('Déposé', 'Submitted')], ['defense', L('Soutenance programmée', 'Defence scheduled')], ['defended', L('Soutenu', 'Defended')]] }, t)}
    ${field({ name: 'defense_date', label: L('Date de soutenance', 'Defence date'), type: 'date' }, t)}${field({ name: 'grade', label: L('Note /20', 'Grade /20'), type: 'number', step: '0.25' }, t)}${field({ name: 'jury', label: 'Jury', span: true }, t)}${field({ name: 'notes', label: L('Notes de suivi', 'Supervision notes'), type: 'textarea', span: true }, t)}</div>`,
  onOpen: (d) => (t.id ? null : wirePicker(d)),
  onSubmit: (b) => { if (!b.student_id) throw new Error(L('Choisissez l\'étudiant dans la liste', 'Pick the student from the list')); return t.id ? api.put(`/api/school/theses/${t.id}`, b) : api.post('/api/school/theses', b); } });
}

// ===================== E-learning =====================
const LK = (k) => L(...(S().lesson_kinds[k] || [k, k]));
const KIND_ICON = { video: '▶', text: '📄', pdf: '📑', quiz: '✔', assignment: '✍', live: '●' };

R('/school/elearning', async (ctx) => {
  ctx.title(L('Cours en ligne', 'E-learning'));
  const tab = ctx.query.tab || 'courses';
  ctx.actions(can('teaching') ? `<button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${L('Nouveau cours', 'New course')}</span></button>` : '');
  const head = tabs('/school/elearning', [['courses', L('Cours', 'Courses')], ...(can('teaching') ? [['grading', L('Devoirs à corriger', 'To grade')]] : [])], tab);
  if (tab === 'grading') {
    const subs = await api.get('/api/school/lms/submissions');
    ctx.el.innerHTML = `${head}${table({ rows: subs, empty: `<b>${L('Aucun devoir rendu', 'Nothing submitted')}</b>`, columns: [{ label: L('Élève', 'Student'), render: (s) => `<b>${esc(s.last_name)}</b> ${esc(s.first_name)}` }, { label: L('Devoir', 'Assignment'), render: (s) => `${esc(s.lesson)}<div class="muted sm">${esc(s.course)}</div>` },
      { label: L('Rendu le', 'Submitted'), render: (s) => dt(s.done_at) }, { label: L('Note', 'Score'), cls: 'r', render: (s) => (s.graded_at ? `<b>${dec(s.score)}</b>/${s.max_score}` : `<button class="btn sm primary" data-g="${s.lesson_id}:${s.student_id}">${L('Corriger', 'Grade')}</button>`) }] })}`;
    ctx.el.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', async () => {
      const [lid, sid] = b.dataset.g.split(':').map(Number); const s = subs.find((x) => x.lesson_id === lid && x.student_id === sid);
      const v = await dialog({ title: `${s.lesson} · ${s.last_name} ${s.first_name}`, wide: true, body: `<div class="card" style="white-space:pre-wrap;max-height:40vh;overflow:auto">${esc(s.answer || '')}</div><div class="form f2" style="margin-top:12px">${field({ name: 'score', label: `${L('Note', 'Score')} /${s.max_score}`, type: 'number', step: '0.25', min: 0, required: true })}${field({ name: 'feedback', label: L('Commentaire', 'Feedback'), type: 'textarea', span: true })}</div>`,
        onSubmit: (x) => api.post('/api/school/lms/grade', { lesson_id: lid, student_id: sid, ...x }) });
      if (v) ctx.rerender();
    }));
    return;
  }
  const list = await api.get('/api/school/lms/courses');
  ctx.el.innerHTML = `${head}${offlineNote(list)}<div class="sc-lms">${list.map((c) => `<a class="card sc-course" href="#/school/course/${c.id}"><div class="sc-cover" style="--c:${esc(c.cover_color || '#15803D')}"><b>${esc(c.title)}</b><span>${esc(c.category || '')}</span>${c.published ? '' : `<em>${L('Brouillon', 'Draft')}</em>`}</div>
    <div class="muted sm">${esc(c.teacher_name || '')}${c.class_name ? ` · ${esc(c.class_name)}` : ''}</div><div class="row between sm" style="margin-top:6px"><span>${c.lessons} ${L('leçons', 'lessons')} · ${Math.round(c.minutes / 60 * 10) / 10} h</span><b>${c.price ? money(c.price) : L('Gratuit', 'Free')}</b></div>
    <div class="row between sm muted"><span>${c.class_id ? c.class_size : c.enrolled} ${L('apprenants', 'learners')}</span><span>${c.completed} ${L('certifiés', 'certified')}</span>${c.public ? `<span class="pill info">${L('Catalogue public', 'Public catalogue')}</span>` : ''}</div></a>`).join('') || `<div class="card empty"><b>${L('Aucun cours en ligne', 'No online course')}</b><p>${L('Vidéos, leçons écrites, PDF, quiz corrigés automatiquement, devoirs à rendre, classes en direct et certificats vérifiables. Réservez un cours à une classe ou vendez-le au public.', 'Videos, readings, PDFs, auto-graded quizzes, assignments, live classes and verifiable certificates. Keep a course for a class or sell it to the public.')}</p></div>`}</div>`;
  document.getElementById('add')?.addEventListener('click', async () => { const v = await courseDialog(); if (v) location.hash = `/school/course/${v.id}`; });
});

function courseDialog(c = {}) {
  return dialog({ title: c.id ? c.title : L('Nouveau cours en ligne', 'New online course'), wide: true, body: `<div class="form f3">${field({ name: 'title', label: L('Titre', 'Title'), required: true, span: true }, c)}${field({ name: 'subtitle', label: L('Sous-titre', 'Subtitle'), span: true }, c)}
    ${field({ name: 'class_id', label: L('Réservé à la classe', 'For class'), type: 'select', options: [['', L('Aucune (ouvert)', 'None (open)')], ...S().classes.map((x) => [x.id, x.name])] }, c)}${field({ name: 'category', label: L('Catégorie', 'Category') }, c)}${field({ name: 'level', label: L('Niveau', 'Level') }, c)}
    ${field({ name: 'price', label: L('Prix (FCFA, 0 = gratuit)', 'Price (FCFA, 0 = free)'), type: 'number', min: 0, value: 0 }, c)}${field({ name: 'pass_score', label: L('Score de réussite aux quiz (%)', 'Quiz pass score (%)'), type: 'number', min: 0, value: 60 }, c)}${field({ name: 'cover_color', label: L('Couleur', 'Colour'), type: 'color', value: '#15803D' }, c)}
    ${field({ name: 'description', label: L('Description', 'Description'), type: 'textarea', span: true }, c)}
    ${field({ name: 'published', label: L('Publié (visible des élèves)', 'Published (visible to students)'), type: 'checkbox' }, c)}${field({ name: 'public', label: L('Dans le catalogue public (vente en ligne)', 'In the public catalogue (sold online)'), type: 'checkbox' }, c)}${field({ name: 'certificate', label: L('Certificat à la fin', 'Certificate on completion'), type: 'checkbox', value: c.id ? c.certificate : true }, c)}</div>`,
  onSubmit: (b) => (c.id ? api.put(`/api/school/lms/courses/${c.id}`, b) : api.post('/api/school/lms/courses', b)) });
}

R('/school/course/:id', async (ctx) => {
  const tab = ctx.query.tab || 'lessons';
  const c = await api.get(`/api/school/lms/courses/${ctx.params.id}`);
  ctx.title(c.title);
  const mine = can('teaching') && (isManager() || c.teacher_id === state.me.user.id);
  ctx.actions(`${c.public && c.published ? `<a class="btn" target="_blank" href="${esc(S().public_url)}/learn#${c.id}">${icon('globe')}<span class="hide-m">${L('Page publique', 'Public page')}</span></a>` : ''}${mine ? `<button class="btn" id="ed">${icon('edit')}<span class="hide-m">${L('Réglages', 'Settings')}</span></button><button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${L('Leçon', 'Lesson')}</span></button>` : ''}`);
  const head = `<div class="card sc-head" style="border-left:6px solid ${esc(c.cover_color || '#15803D')}"><div class="row between" style="flex-wrap:wrap;gap:8px"><div><h2 style="margin:0">${esc(c.title)}</h2><div class="muted">${esc(c.subtitle || '')}</div>
    <div class="muted sm">${esc(c.teacher_name || '')} · ${c.lessons} ${L('leçons', 'lessons')} · ${c.price ? money(c.price) : L('Gratuit', 'Free')}${c.class_name ? ` · ${esc(c.class_name)}` : ''}</div></div><span class="pill ${c.published ? 'ok' : ''}">${c.published ? L('Publié', 'Published') : L('Brouillon', 'Draft')}</span></div></div>
    <div style="margin-top:14px">${tabs(`/school/course/${c.id}`, [['lessons', L('Programme', 'Curriculum')], ['progress', L('Progression des apprenants', 'Learner progress')]], tab)}</div>`;
  if (tab === 'progress') {
    const p = await api.get(`/api/school/lms/courses/${c.id}/progress`);
    ctx.actions(`${mine && !c.class_id ? `<button class="btn primary" id="enr">${icon('plus')} ${L('Inscrire', 'Enrol')}</button>` : ''}`);
    ctx.el.innerHTML = `${head}${table({ rows: p.learners, empty: `<b>${L('Aucun apprenant', 'No learner yet')}</b>`, columns: [{ label: L('Apprenant', 'Learner'), render: (s) => `<a href="#/school/student/${s.id}"><b>${esc(s.last_name)}</b> ${esc(s.first_name)}</a>` },
      { label: L('Progression', 'Progress'), render: (s) => `<div class="sc-fill" style="width:120px;display:inline-block"><i style="width:${s.pct}%"></i></div> ${s.pct} %` }, { label: 'Quiz', cls: 'r', render: (s) => (s.quiz_avg == null ? '—' : `${s.quiz_avg} %`) },
      { label: L('Certificat', 'Certificate'), render: (s) => (s.certificate_code ? `<a class="pill ok" target="_blank" href="/v/cert/${esc(s.certificate_code)}">${esc(s.certificate_code)}</a>` : s.completed_at ? `<span class="pill ok">${L('Terminé', 'Done')}</span>` : '—') }] })}`;
    document.getElementById('enr')?.addEventListener('click', async () => {
      const v = await dialog({ title: L('Inscrire un apprenant', 'Enrol a learner'), body: `<div class="form">${studentPicker()}</div>${c.price ? `<p class="muted sm">${L('Une facture de', 'An invoice of')} ${money(c.price)} ${L('est créée ; le cours s\'ouvre quand elle est payée.', 'is created; the course opens once paid.')}</p>` : ''}`,
        onOpen: (d) => wirePicker(d), onSubmit: (b) => { if (!b.student_id) throw new Error(L('Choisissez dans la liste', 'Pick from the list')); return api.post(`/api/school/lms/courses/${c.id}/enroll`, { student_id: b.student_id }); } });
      if (v) ctx.rerender();
    });
    return;
  }
  ctx.el.innerHTML = `${head}${c.lessons_list.map((l, i) => `<div class="card sc-lrow" data-id="${l.id}"><span class="sc-kind k-${l.kind}">${KIND_ICON[l.kind] || '•'}</span><div style="flex:1"><b>${i + 1}. ${esc(l.title)}</b><div class="muted sm">${esc(LK(l.kind))}${l.duration ? ` · ${l.duration} min` : ''}${l.kind === 'quiz' ? ` · ${l.quiz.length} ${L('questions', 'questions')}` : ''}${l.kind === 'assignment' && l.due_date ? ` · ${L('pour le', 'due')} ${dt(l.due_date)}` : ''}${l.kind === 'live' && l.starts_at ? ` · ${esc(l.starts_at.replace('T', ' '))}` : ''}${l.free_preview ? ` · <span class="pill info">${L('aperçu gratuit', 'free preview')}</span>` : ''}</div></div>
    ${l.kind === 'live' ? `<a class="btn sm primary" target="_blank" href="${esc(l.room)}">${L('Ouvrir la salle', 'Open room')}</a>` : ''}</div>`).join('') || `<div class="card empty"><b>${L('Programme vide', 'Empty curriculum')}</b><p>${L('Ajoutez des leçons : vidéo (YouTube, Vimeo…), texte, PDF, quiz, devoir ou classe en direct.', 'Add lessons: video, reading, PDF, quiz, assignment or live class.')}</p></div>`}`;
  document.getElementById('ed')?.addEventListener('click', async () => { if (await courseDialog(c)) ctx.rerender(); });
  document.getElementById('add')?.addEventListener('click', async () => { if (await lessonDialog(c)) ctx.rerender(); });
  if (mine) ctx.el.querySelectorAll('.sc-lrow').forEach((r) => r.addEventListener('click', async (e) => { if (e.target.closest('a')) return; if (await lessonDialog(c, c.lessons_list.find((l) => l.id === Number(r.dataset.id)))) ctx.rerender(); }));
});

function quizRow(q = {}, i = 0) {
  const ch = [...(q.choices || []), '', '', '', ''].slice(0, Math.max(4, (q.choices || []).length));
  return `<div class="card sc-q" style="margin-bottom:8px"><div class="row between"><b>Q${i + 1}</b><button type="button" class="btn ghost sm" data-rmq>${icon('trash')}</button></div>
    <input class="qq" value="${esc(q.q || '')}" placeholder="${L('Énoncé de la question', 'Question')}" style="width:100%;margin:6px 0">
    ${ch.map((c, k) => `<label class="row" style="gap:6px;margin:3px 0"><input type="radio" name="ans${i}_${Math.random().toString(36).slice(2, 6)}" class="qa" ${q.answer === k ? 'checked' : ''}><input class="qc" value="${esc(c)}" placeholder="${L('Choix', 'Choice')} ${k + 1}" style="flex:1"></label>`).join('')}
    <input class="qe" value="${esc(q.explain || '')}" placeholder="${L('Explication affichée après la réponse (facultatif)', 'Explanation shown after answering (optional)')}" style="width:100%;margin-top:4px"></div>`;
}

function lessonDialog(c, l = { kind: 'video' }) {
  return dialog({ title: l.id ? l.title : L('Nouvelle leçon', 'New lesson'), wide: true, body: `<div class="form f3">${field({ name: 'title', label: L('Titre', 'Title'), required: true, span: true }, l)}
    ${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: Object.keys(S().lesson_kinds).map((k) => [k, LK(k)]) }, l)}${field({ name: 'duration', label: L('Durée (min)', 'Duration (min)'), type: 'number', min: 0 }, l)}${field({ name: 'position', label: L('Ordre', 'Order'), type: 'number', min: 0 }, l)}
    <div class="k k-video k-pdf k-live" style="grid-column:1/-1">${field({ name: 'video_url', label: L('Lien (vidéo YouTube/Vimeo, PDF, ou votre salle Zoom/Meet ; vide = salle Jitsi automatique)', 'Link (YouTube/Vimeo video, PDF, or your Zoom/Meet room; empty = automatic Jitsi room)'), placeholder: 'https://' }, l)}</div>
    <div class="k k-live">${field({ name: 'starts_at', label: L('Date et heure', 'Date & time'), type: 'datetime-local' }, l)}</div>
    <div class="k k-assignment">${field({ name: 'due_date', label: L('À rendre pour le', 'Due'), type: 'date' }, l)}</div><div class="k k-assignment">${field({ name: 'max_score', label: L('Noté sur', 'Out of'), type: 'number', min: 1, value: 20 }, l)}</div>
    <div style="grid-column:1/-1">${field({ name: 'content', label: L('Contenu / consignes', 'Content / instructions'), type: 'textarea' }, l)}</div>${field({ name: 'free_preview', label: L('Aperçu gratuit', 'Free preview'), type: 'checkbox' }, l)}</div>
    <div class="k k-quiz"><h4>${L('Questions du quiz (cochez la bonne réponse)', 'Quiz questions (tick the right answer)')}</h4><div id="qs">${(l.quiz?.length ? l.quiz : [{}]).map((q, i) => quizRow(q, i)).join('')}</div><button type="button" class="btn sm" id="addq">${icon('plus')} ${L('Question', 'Question')}</button></div>`,
  onOpen: (d) => {
    const kind = d.querySelector('[name=kind]');
    const show = () => d.querySelectorAll('.k').forEach((x) => { x.style.display = x.classList.contains(`k-${kind.value}`) ? '' : 'none'; });
    kind.onchange = show; show();
    const bind = () => d.querySelectorAll('[data-rmq]').forEach((b) => { b.onclick = () => b.closest('.sc-q').remove(); });
    d.querySelector('#addq').onclick = () => { d.querySelector('#qs').insertAdjacentHTML('beforeend', quizRow({}, d.querySelectorAll('.sc-q').length)); bind(); };
    bind();
  },
  onSubmit: (b, form) => {
    if (b.kind === 'quiz') b.quiz = [...form.querySelectorAll('.sc-q')].map((x) => { const cs = [...x.querySelectorAll('.qc')]; const filled = cs.map((cc, k) => ({ v: cc.value.trim(), ok: x.querySelectorAll('.qa')[k].checked })).filter((o) => o.v); return { q: x.querySelector('.qq').value, choices: filled.map((o) => o.v), answer: filled.findIndex((o) => o.ok), explain: x.querySelector('.qe').value }; }).filter((q) => q.q.trim());
    return l.id ? api.put(`/api/school/lms/lessons/${l.id}`, b) : api.post('/api/school/lms/lessons', { ...b, course_id: c.id });
  } });
}

// ===================== Teachers and staff =====================
R('/school/staff', async (ctx) => {
  ctx.title(L('Enseignants et personnel', 'Teachers & staff'));
  const tab = ctx.query.tab || 'staff';
  const admin = can('users');
  ctx.actions(admin ? `<a class="btn primary" href="#/users">${icon('plus')}<span class="hide-m">${L('Créer un compte', 'Create an account')}</span></a>` : '');
  const head = tabs('/school/staff', [['staff', L('Équipe', 'Team')], ...(canAny('reports', 'users') ? [['workload', L('Heures et vacations', 'Hours & pay')]] : [])], tab);
  if (tab === 'workload') {
    const month = ctx.query.month || today().slice(0, 7);
    const w = await api.get(`/api/school/workload?month=${month}`);
    ctx.actions(`<a class="btn" href="/api/school/workload?month=${month}&format=xlsx">${icon('download')}<span class="hide-m">Excel</span></a>`);
    ctx.el.innerHTML = `${head}<div class="card filters"><label class="fld">${L('Mois', 'Month')}<input type="month" id="fm" value="${month}"></label></div>
      <div class="grid g3" style="margin:14px 0">${kpi(L('Heures enseignées', 'Hours taught'), num(w.rows.reduce((a, b) => a + b.hours, 0)), `${w.rows.reduce((a, b) => a + b.lessons, 0)} ${L('séances au cahier de textes', 'logged lessons')}`, 'accent')}${kpi(L('Vacations à payer', 'Part-time pay due'), money(w.rows.reduce((a, b) => a + b.pay, 0)))}${kpi(L('Enseignants actifs', 'Active teachers'), w.rows.length)}</div>
      ${table({ rows: w.rows, columns: [{ label: L('Enseignant', 'Teacher'), key: 'name' }, { label: L('Statut', 'Status'), render: (r) => esc(STATUS()[r.status] || STATUS().permanent) }, { label: L('Séances', 'Lessons'), cls: 'r', key: 'lessons' }, { label: L('Heures', 'Hours'), cls: 'r', key: 'hours' }, { label: L('Taux', 'Rate'), cls: 'r', render: (r) => (r.hourly_rate ? money(r.hourly_rate) : '—'), hideM: true }, { label: L('À payer', 'Pay'), cls: 'r', render: (r) => (r.pay ? `<b>${money(r.pay)}</b>` : '—') }] })}`;
    document.getElementById('fm').onchange = (e) => go('/school/staff', { tab: 'workload', month: e.target.value });
    return;
  }
  const list = await api.get('/api/school/staff');
  const roleName = (r) => ({ owner: L('Fondateur', 'Owner'), admin: 'Admin', manager: L('Direction', 'Management'), teacher: L('Enseignant', 'Teacher'), registrar: L('Scolarité', 'Registrar'), supervisor: L('Surveillant', 'Supervisor'), librarian: L('Bibliothécaire', 'Librarian'), cashier: L('Économat', 'Bursar'), accountant: L('Comptable', 'Accountant') }[r] || r);
  ctx.el.innerHTML = `${head}<div class="grid g4" style="margin-bottom:14px">${kpi(L('Enseignants', 'Teachers'), list.filter((u) => u.role === 'teacher' && u.active).length, '', 'accent')}${kpi(L('Personnel', 'Staff'), list.filter((u) => u.role !== 'teacher' && u.active).length)}${kpi(L('Heures / semaine', 'Hours / week'), num(list.reduce((a, b) => a + (b.hours_week || 0), 0)))}${kpi(L('Vacataires', 'Part-time'), list.filter((u) => u.status === 'part_time' || u.status === 'visiting').length)}</div>
    ${table({ rows: list, columns: [{ label: L('Nom', 'Name'), render: (u) => `<b>${esc(u.title ? `${u.title} ` : '')}${esc(u.name)}</b>${u.active ? '' : ` <span class="pill">${L('inactif', 'inactive')}</span>`}<div class="muted sm">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ''}</div>` },
      { label: L('Fonction', 'Role'), render: (u) => `${esc(roleName(u.role))}${u.position ? `<div class="muted sm">${esc(u.position)}</div>` : ''}` }, { label: L('Spécialité', 'Speciality'), render: (u) => `${esc(u.speciality || '')}<div class="muted sm">${esc(u.diploma || '')}</div>`, hideM: true },
      { label: L('Statut', 'Status'), render: (u) => (u.status ? esc(STATUS()[u.status]) : '—'), hideM: true }, { label: L('Cours', 'Courses'), cls: 'r', render: (u) => (u.courses ? `${u.courses} · ${u.hours_week} h/${L('sem', 'wk')}${u.head_of ? `<div class="muted sm">${L('prof. principal', 'form teacher')}</div>` : ''}` : '—') },
      { label: L('Cahier 30 j', 'Log 30 d'), cls: 'r', render: (u) => (u.role === 'teacher' ? `<span class="${u.courses && !u.lessons_30d ? 'bad-t' : ''}">${u.lessons_30d}</span>` : ''), hideM: true },
      ...(admin ? [{ label: '', cls: 'r', render: (u) => `<button class="btn sm" data-ed="${u.id}">${icon('edit')}</button>` }] : [])] })}`;
  ctx.el.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', async () => {
    const u = list.find((x) => x.id === Number(b.dataset.ed));
    const v = await dialog({ title: u.name, wide: true, body: `<div class="form f3">${field({ name: 'title', label: L('Titre (Dr, Pr, M., Mme)', 'Title (Dr, Prof, Mr, Mrs)') }, u)}${field({ name: 'position', label: L('Poste', 'Position') }, u)}${field({ name: 'speciality', label: L('Spécialité / matières', 'Speciality / subjects') }, u)}
      ${field({ name: 'diploma', label: L('Diplôme', 'Degree') }, u)}${field({ name: 'status', label: L('Statut', 'Status'), type: 'select', options: Object.entries(STATUS()) }, u)}${field({ name: 'hourly_rate', label: L('Taux horaire (vacataire)', 'Hourly rate (part-time)'), type: 'number', min: 0 }, u)}
      ${field({ name: 'hire_date', label: L('Date d\'embauche', 'Hire date'), type: 'date' }, u)}${field({ name: 'orcid', label: 'ORCID' }, u)}${field({ name: 'bio', label: 'Bio', type: 'textarea', span: true }, u)}</div>`,
    onSubmit: (x) => api.put(`/api/school/staff/${u.id}`, x) });
    if (v) ctx.rerender();
  }));
});
const STATUS = () => ({ permanent: L('Permanent', 'Full-time'), part_time: L('Vacataire', 'Part-time'), visiting: L('Missionnaire / invité', 'Visiting') });

// ===================== Settings =====================
R('/school/settings', async (ctx) => {
  ctx.title(L('Réglages de l\'établissement', 'School settings'));
  await refreshMeta();
  const s = S().settings; const tab = ctx.query.tab || 'general';
  const head = tabs('/school/settings', [['general', L('Général', 'General')], ['grading', L('Notation', 'Grading')], ['levels', L('Niveaux', 'Levels')], ['years', L('Années et passage', 'Years & promotion')]], tab);
  if (tab === 'levels') {
    ctx.el.innerHTML = `${head}<div class="card"><div class="row between"><h3>${L('Niveaux', 'Levels')}</h3><span class="row" style="gap:6px"><select id="pr">${Object.entries(S().presets).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button class="btn sm" id="addp">${L('Ajouter ce cycle', 'Add this cycle')}</button><button class="btn sm primary" id="addl">${icon('plus')}</button></span></div>
      ${table({ rows: S().levels, columns: [{ label: L('Niveau', 'Level'), render: (l) => `<b>${esc(l.name)}</b>` }, { label: L('Cycle', 'Cycle'), key: 'cycle' }, { label: L('Section', 'Section'), render: (l) => (l.section === 'en' ? 'Anglophone' : 'Francophone') }, { label: L('Examen', 'Exam'), key: 'exam' },
        { label: L('Niveau suivant', 'Next level'), render: (l) => esc(S().levels.find((x) => x.id === l.next_level_id)?.name || '—') }, { label: '', cls: 'r', render: (l) => `<button class="btn sm" data-lv="${l.id}">${icon('edit')}</button>` }] })}</div>`;
    document.getElementById('addp').onclick = async () => { try { const r = await api.post('/api/school/levels/preset', { preset: document.getElementById('pr').value }); toast(`${r.added} ${L('niveau(x) ajouté(s)', 'level(s) added')}`, 'ok'); ctx.rerender(); } catch (err) { fail(err); } };
    const lvDialog = (l = {}) => dialog({ title: l.name || L('Nouveau niveau', 'New level'), body: `<div class="form f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true }, l)}${field({ name: 'cycle', label: L('Cycle', 'Cycle') }, l)}
      ${field({ name: 'section', label: L('Section', 'Section'), type: 'select', options: [['fr', 'Francophone'], ['en', 'Anglophone']] }, l)}${field({ name: 'exam', label: L('Examen de fin', 'Final exam') }, l)}${field({ name: 'position', label: L('Ordre', 'Order'), type: 'number' }, l)}
      ${field({ name: 'next_level_id', label: L('Niveau suivant', 'Next level'), type: 'select', options: [['', '—'], ...S().levels.filter((x) => x.id !== l.id).map((x) => [x.id, x.name])] }, l)}</div>`,
    onSubmit: (b) => (l.id ? api.put(`/api/school/levels/${l.id}`, b) : api.post('/api/school/levels', b)) });
    document.getElementById('addl').onclick = async () => { if (await lvDialog()) ctx.rerender(); };
    ctx.el.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', async () => { if (await lvDialog(S().levels.find((x) => x.id === Number(b.dataset.lv)))) ctx.rerender(); }));
    return;
  }
  if (tab === 'years') {
    ctx.el.innerHTML = `${head}<div class="grid g2"><div class="card"><div class="row between"><h3>${L('Années scolaires', 'School years')}</h3><button class="btn sm primary" id="ny">${icon('plus')} ${L('Préparer l\'année suivante', 'Prepare next year')}</button></div>
      ${S().years.map((y) => `<div class="lrow row between"><span><b>${esc(y.name)}</b> <span class="muted sm">${dt(y.start_date)} → ${dt(y.end_date)} · ${y.students} ${L('inscrits', 'enrolled')}</span></span>${y.id === S().year.id ? `<span class="pill ok">${L('active', 'active')}</span>` : `<button class="btn sm" data-act="${y.id}">${L('Activer', 'Activate')}</button>`}</div>`).join('')}
      <p class="muted sm">${L('Préparer l\'année suivante copie les classes, matières, coefficients, emplois du temps et frais. L\'ancienne année reste consultable.', 'Preparing next year copies classes, subjects, coefficients, timetables and fees. The old year stays readable.')}</p></div>
      <div class="card"><h3>${L('Passage en classe supérieure', 'Promotion')}</h3><p class="muted sm">${L('Après le conseil de fin d\'année, inscrivez les élèves admis (ou redoublants) dans leur classe de l\'année suivante. Les frais de la nouvelle année sont facturés.', 'After the end-of-year council, move promoted (or repeating) students into next year\'s class. The new year\'s fees are billed.')}</p>
        <div class="form f2"><label class="fld">${L('Depuis la classe', 'From class')}<select id="pf">${S().classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><label class="fld">${L('Décision', 'Decision')}<select id="pd"><option value="promoted">${L('Admis', 'Promoted')}</option><option value="repeat">${L('Redoublants', 'Repeating')}</option></select></label></div>
        <button class="btn primary" id="pgo" style="margin-top:10px">${L('Choisir la classe d\'arrivée', 'Pick the destination class')}</button></div></div>`;
    document.getElementById('ny').onclick = async () => {
      const v = await dialog({ title: L('Préparer l\'année suivante', 'Prepare next year'), body: `${field({ name: 'name', label: L('Année (ex. 2027-2028)', 'Year (e.g. 2027-2028)'), value: `${Number(S().year.name.slice(0, 4)) + 1}-${Number(S().year.name.slice(0, 4)) + 2}` })}${field({ name: 'activate', label: L('L\'activer tout de suite', 'Activate it now'), type: 'checkbox' })}`, onSubmit: (b) => api.post('/api/school/years', b) });
      if (v) { toast(`${v.name} : ${v.classes} ${L('classes copiées', 'classes copied')}`, 'ok'); await refreshMeta(); ctx.rerender(); }
    };
    ctx.el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => { try { await api.put('/api/school/settings', { active_year_id: Number(b.dataset.act) }); await refreshMeta(); location.reload(); } catch (err) { fail(err); } }));
    document.getElementById('pgo').onclick = async () => {
      const from = Number(document.getElementById('pf').value); const decision = document.getElementById('pd').value;
      const other = S().years.filter((y) => y.id !== S().year.id);
      if (!other.length) return toast(L('Préparez d\'abord l\'année suivante', 'Prepare next year first'), 'err');
      const [r, targets] = await Promise.all([api.get(`/api/school/results?class_id=${from}&period=year`), api.get(`/api/school/classes?year_id=${other[0].id}`)]);
      const picked = r.students.filter((x) => (x.decision || (x.average != null && x.average >= S().settings.pass_mark ? 'promoted' : 'repeat')) === decision);
      const v = await dialog({ title: `${L('Passage', 'Promotion')} · ${r.class.name} → ${other[0].name}`, wide: true, submit: L('Inscrire', 'Enrol'), body: `<label class="fld">${L('Classe d\'arrivée', 'Destination class')}<select name="to_class_id">${targets.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.level_name)})</option>`).join('')}</select></label>
        <div style="max-height:40vh;overflow:auto;margin-top:10px">${picked.map((x) => `<label class="check"><input type="checkbox" class="ps" value="${x.id}" checked> ${esc(x.last_name)} ${esc(x.first_name)} <span class="muted sm">${dec(x.average)}</span></label>`).join('') || `<p class="muted">${L('Personne dans cette catégorie', 'Nobody in this group')}</p>`}</div>${field({ name: 'bill', label: L('Facturer les frais de la nouvelle année', 'Bill next year\'s fees'), type: 'checkbox', value: true })}`,
      onSubmit: (b, form) => api.post('/api/school/promote', { to_class_id: b.to_class_id, bill: b.bill, student_ids: [...form.querySelectorAll('.ps:checked')].map((x) => Number(x.value)) }) });
      if (v) toast(`${v.moved} ${L('élève(s) inscrit(s)', 'student(s) enrolled')}`, 'ok');
    };
    return;
  }
  const general = `<div class="form f3">${field({ name: 'kind', label: L('Type d\'établissement', 'Type of school'), type: 'select', options: [['nursery', L('Maternelle', 'Nursery')], ['primary', L('Primaire', 'Primary')], ['secondary', L('Secondaire', 'Secondary')], ['both', L('Primaire et secondaire', 'Primary & secondary')], ['university', L('Université / grande école', 'University / college')], ['training', L('Centre de formation', 'Training centre')]] }, s)}
    ${field({ name: 'system', label: L('Sous-système', 'Sub-system'), type: 'select', options: [['fr', 'Francophone'], ['en', 'Anglophone'], ['bilingual', L('Bilingue', 'Bilingual')]] }, s)}${field({ name: 'ministry', label: L('Tutelle', 'Ministry'), type: 'select', options: ['MINEDUB', 'MINESEC', 'MINESUP', 'MINEFOP', 'Privé'].map((x) => [x, x]) }, s)}
    ${field({ name: 'principal_name', label: L('Chef d\'établissement', 'Head of school') }, s)}${field({ name: 'principal_title', label: L('Titre (Principal, Proviseur, Recteur…)', 'Title (Principal, Rector…)') }, s)}${field({ name: 'matricule_prefix', label: L('Préfixe des matricules', 'ID prefix') }, s)}
    ${field({ name: 'motto', label: L('Devise', 'Motto'), span: true }, s)}${field({ name: 'day_start', label: L('Début des cours', 'School starts'), type: 'time' }, s)}${field({ name: 'late_after', label: L('En retard après', 'Late after'), type: 'time' }, s)}${field({ name: 'absence_alert_hours', label: L('Alerte après (h d\'absence)', 'Alert after (hours absent)'), type: 'number', min: 1 }, s)}
    ${field({ name: 'loan_days', label: L('Durée de prêt (jours)', 'Loan period (days)'), type: 'number', min: 1 }, s)}${field({ name: 'max_loans', label: L('Livres par lecteur', 'Books per reader'), type: 'number', min: 1 }, s)}${field({ name: 'fine_per_day', label: L('Amende par jour de retard', 'Fine per day late'), type: 'number', min: 0 }, s)}
    ${field({ name: 'welcome_text', label: L('Texte d\'accueil (admissions)', 'Welcome text (admissions)'), type: 'textarea', span: true }, s)}
    ${field({ name: 'admissions_open', label: L('Admissions en ligne ouvertes', 'Online admissions open'), type: 'checkbox' }, s)}${field({ name: 'portal_pay', label: L('Paiement MoMo sur le portail parents', 'MoMo payment on the parents\' portal'), type: 'checkbox' }, s)}${field({ name: 'repository_public', label: L('Dépôt de publications public', 'Public publications repository'), type: 'checkbox' }, s)}</div>`;
  const grading = `<div class="form f3">${field({ name: 'grading', label: L('Système de notation', 'Grading system'), type: 'select', options: [['sequences', L('Séquences / trimestres (/20, coefficients, rangs)', 'Sequences / terms (/20, coefficients, ranks)')], ['lmd', L('LMD : CC, examen, rattrapage, crédits, GPA', 'LMD: CA, exam, resit, credits, GPA')]] }, s)}
    ${field({ name: 'sequences', label: L('Découpage', 'Periods'), type: 'select', options: [['6', L('6 séquences (3 trimestres)', '6 sequences (3 terms)')], ['3', L('3 trimestres', '3 terms')]] }, s)}${field({ name: 'cc_weight', label: L('Poids du contrôle continu (LMD, 0 à 1)', 'Continuous assessment weight (LMD, 0 to 1)'), type: 'number', step: '0.05', min: 0 }, s)}
    ${field({ name: 'pass_mark', label: L('Moyenne de passage', 'Pass mark'), type: 'number', step: '0.5' }, s)}${field({ name: 'honour_mark', label: L('Tableau d\'honneur dès', 'Honour roll from'), type: 'number', step: '0.5' }, s)}${field({ name: 'encourage_mark', label: L('Encouragements dès', 'Encouragement from'), type: 'number', step: '0.5' }, s)}
    ${field({ name: 'congrats_mark', label: L('Félicitations dès', 'Congratulations from'), type: 'number', step: '0.5' }, s)}${field({ name: 'warning_mark', label: L('Avertissement sous', 'Warning below'), type: 'number', step: '0.5' }, s)}</div>`;
  ctx.el.innerHTML = `${head}<form id="sf" class="card">${tab === 'grading' ? grading : general}<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary">${L('Enregistrer', 'Save')}</button></div></form>`;
  document.getElementById('sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = {}; for (const el of e.target.elements) if (el.name) b[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    try { await api.put('/api/school/settings', b); await refreshMeta(); toast(L('Réglages enregistrés', 'Settings saved'), 'ok'); } catch (err) { fail(err); }
  });
});
