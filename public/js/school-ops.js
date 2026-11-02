// Teknons École, daily academic work: marks and assessments, results and class
// councils, report cards, roll call, gate check-in, discipline, timetable,
// lesson log, official exams, announcements and the early-warning list.
import { api } from './api.js';
import { state, L, esc, money, num, dt, today, icon, can, canAny, table, field, dialog, toast, confirmDlg, offlineNote, qs } from './ui.js';
import { R, S, fail, refreshMeta, kpi, dec, avgCls, wa, avatar, classOpts, periodName, distName, DISC, isManager, isTeacher, lmd, disciplineDialog } from './school.js';

const kindName = (k) => L(...(S().assess_kinds[k] || [k, k]));
const slotLabel = (q) => S().slots.find((x) => x.seq === Number(q))?.label || `S${q}`;
const slotShort = (q) => slotLabel(q).replace('Séquence ', 'Séq. ').replace('Rattrapage', 'Ratt.');
const go = (path, q) => { location.hash = path + qs(q); };
const sel = (id, opts, v) => `<select id="${id}">${opts.map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(v ?? '') ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;

/** Courses the user may grade: their own for a teacher, every course for the office. */
async function myCourses() {
  if (isTeacher()) return S().my_courses;
  return api.get('/api/school/courses');
}
const courseLabel = (c) => `${c.class_name} · ${c.subject}${c.teacher_name && !isTeacher() ? ` (${c.teacher_name})` : ''}`;

// ===================== Marks (grade sheet) =====================
R('/school/marks', async (ctx) => {
  ctx.title(L('Saisie des notes', 'Enter marks'));
  const courses = await myCourses();
  const course = Number(ctx.query.course_id) || courses[0]?.id;
  const seq = Number(ctx.query.sequence) || 1;
  if (!course) { ctx.el.innerHTML = `<div class="card empty"><b>${L('Aucun cours ne vous est attribué', 'No course assigned to you')}</b><p>${L('La direction vous attribue vos cours dans Classes et matières.', 'The office assigns courses in Classes & subjects.')}</p></div>`; return; }
  const m = await api.get(`/api/school/marks${qs({ course_id: course, sequence: seq })}`);
  ctx.actions(`<a class="btn" href="#/school/assessments?course_id=${course}">${icon('clipboard')}<span class="hide-m">${L('Évaluations', 'Assessments')}</span></a>`);
  const pass = S().settings.pass_mark;
  ctx.el.innerHTML = `${offlineNote(m)}<div class="card filters"><div class="row" style="gap:10px;flex-wrap:wrap">
      <label class="fld">${L('Cours', 'Course')}${sel('fc', courses.map((c) => [c.id, courseLabel(c)]), course)}</label>
      <label class="fld">${lmd() ? L('Épreuve', 'Component') : L('Période', 'Period')}${sel('fs', S().slots.map((q) => [q.seq, q.label]), seq)}</label></div></div>
    <div class="grid g4" style="margin:14px 0">${kpi(L('Moyenne de la classe', 'Class average'), `<span id="k-avg">${dec(m.stats.avg)}</span>`, `${m.course.class_name} · ${m.course.subject}`, 'accent')}
      ${kpi(L('Notes saisies', 'Marks entered'), `<span id="k-n">${m.stats.n}</span>/${m.students.length}`)}${kpi(L('Au-dessus de', 'At or above') + ` ${pass}`, `<span id="k-p">${m.stats.pass}</span>`)}${kpi(L('Écart', 'Range'), `<span id="k-r">${dec(m.stats.min)} – ${dec(m.stats.max)}</span>`)}</div>
    ${m.locked ? `<div class="banner warn">${icon('lock')} ${L('Notes verrouillées après le conseil de classe.', 'Marks locked after the class council.')} ${isManager() ? L('Vous pouvez les modifier (direction).', 'You can still edit them (management).') : ''}</div>` : ''}
    ${m.derived ? `<div class="banner info">${L(`Ces notes sont calculées à partir de ${m.assessments.length} évaluation(s) pondérée(s). Modifiez les copies dans Évaluations ; une note tapée ici sera remplacée au prochain calcul.`, `These marks are computed from ${m.assessments.length} weighted assessment(s). Edit scores in Assessments.`)}</div>` : ''}
    <form id="sheet" class="card" style="padding:0"><div class="tbl-wrap"><table class="tbl sc-sheet"><thead><tr><th>#</th><th>${lmd() ? L('Étudiant', 'Student') : L('Élève', 'Student')}</th><th class="r">/20</th><th>${L('Abs.', 'Abs.')}</th><th class="hide-m">${L('Observation', 'Remark')}</th></tr></thead><tbody>
    ${m.students.map((s, i) => `<tr data-id="${s.id}"><td class="muted">${i + 1}</td><td><span class="row" style="gap:8px">${avatar(s, 28)}<span><b>${esc(s.last_name)}</b> ${esc(s.first_name)}<div class="muted sm mono">${esc(s.matricule)}</div></span></span></td>
      <td class="r"><input class="mk ${avgCls(s.mark)}" inputmode="decimal" value="${s.mark == null ? '' : dec(s.mark)}" ${m.locked && !isManager() ? 'disabled' : ''} aria-label="${L('Note', 'Mark')}"></td>
      <td><input type="checkbox" class="ab" ${s.absent ? 'checked' : ''}></td><td class="hide-m"><input class="rm" value="${esc(s.remark)}" placeholder="—"></td></tr>`).join('')}
    </tbody></table></div>${m.students.length ? `<div class="row between" style="padding:12px 16px"><span class="muted sm">${L('Entrée = élève suivant · la virgule est acceptée', 'Enter = next student · comma accepted')}</span><button class="btn primary" ${m.locked && !isManager() ? 'disabled' : ''}>${icon('check')} ${L('Enregistrer les notes', 'Save marks')}</button></div>` : ''}</form>`;
  document.getElementById('fc').onchange = (e) => go('/school/marks', { course_id: e.target.value, sequence: seq });
  document.getElementById('fs').onchange = (e) => go('/school/marks', { course_id: course, sequence: e.target.value });
  const inputs = [...ctx.el.querySelectorAll('.mk')];
  const stats = () => {
    const v = inputs.map((x) => x.value.trim().replace(',', '.')).filter((x) => x !== '').map(Number).filter((x) => !Number.isNaN(x));
    document.getElementById('k-avg').textContent = v.length ? dec(v.reduce((a, b) => a + b, 0) / v.length) : '—';
    document.getElementById('k-n').textContent = v.length;
    document.getElementById('k-p').textContent = v.filter((x) => x >= pass).length;
    document.getElementById('k-r').textContent = v.length ? `${dec(Math.min(...v))} – ${dec(Math.max(...v))}` : '—';
  };
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => { const n = Number(inp.value.replace(',', '.')); inp.classList.toggle('bad', inp.value !== '' && (Number.isNaN(n) || n < 0 || n > 20)); inp.classList.toggle('bad-t', !Number.isNaN(n) && inp.value !== '' && n < pass); inp.classList.toggle('ok-t', n >= 14); stats(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (inputs[i + 1] || inp).focus(); inputs[i + 1]?.select(); } });
  });
  document.getElementById('sheet').addEventListener('submit', async (e) => {
    e.preventDefault();
    const marks = [...ctx.el.querySelectorAll('tr[data-id]')].map((tr) => ({ student_id: Number(tr.dataset.id), mark: tr.querySelector('.mk').value.trim(), absent: tr.querySelector('.ab').checked, remark: tr.querySelector('.rm').value }));
    if (marks.some((x) => x.mark !== '' && (Number.isNaN(Number(x.mark.replace(',', '.'))) || Number(x.mark.replace(',', '.')) > 20))) return toast(L('Une note n\'est pas valide (0 à 20)', 'A mark is invalid (0 to 20)'), 'err');
    try {
      const r = await api.post('/api/school/marks', { course_id: course, sequence: seq, marks });
      toast(r?._queued ? L('Hors ligne : notes gardées, envoi automatique au retour du réseau', 'Offline: marks saved and will sync') : L('Notes enregistrées', 'Marks saved'), 'ok');
      if (!r?._queued) ctx.rerender();
    } catch (err) { fail(err); }
  });
});

// ===================== Assessments =====================
R('/school/assessments', async (ctx) => {
  ctx.title(L('Évaluations et examens', 'Tests & exams'));
  const q = { class_id: ctx.query.class_id || '', course_id: ctx.query.course_id || '', kind: ctx.query.kind || '' };
  const [list, courses] = await Promise.all([api.get(`/api/school/assessments${qs(q)}`), can('teaching') ? myCourses() : []]);
  ctx.actions(can('teaching') ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Nouvelle évaluation', 'New assessment')}</span></button>` : '');
  const byKind = {}; for (const a of list) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
  ctx.el.innerHTML = `${offlineNote(list)}<div class="card filters"><div class="row" style="gap:10px;flex-wrap:wrap">
    <label class="fld">${L('Classe', 'Class')}${sel('fcl', classOpts(), q.class_id)}</label>
    <label class="fld">${L('Type', 'Type')}${sel('fk', [['', L('Tous', 'All')], ...Object.keys(S().assess_kinds).map((k) => [k, kindName(k)])], q.kind)}</label></div></div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:12px 0">${Object.entries(byKind).map(([k, n]) => `<span class="pill">${esc(kindName(k))} · ${n}</span>`).join('')}</div>
    ${table({ rows: list, href: (a) => `#/school/assessment/${a.id}`, empty: `<b>${L('Aucune évaluation', 'No assessment yet')}</b><p>${L('Chaque interrogation, devoir, TP ou examen a sa fiche ; la note de la période est calculée automatiquement.', 'Each quiz, test, practical or exam has its own record; the period mark is computed automatically.')}</p>`,
      columns: [{ label: 'Date', render: (a) => dt(a.date) }, { label: L('Évaluation', 'Assessment'), render: (a) => `<b>${esc(a.title)}</b><div class="muted sm">${esc(a.class_name)} · ${esc(a.subject)}</div>` },
        { label: L('Type', 'Type'), render: (a) => `<span class="pill ${['exam', 'mock', 'resit'].includes(a.kind) ? 'info' : ''}">${esc(kindName(a.kind))}</span>` }, { label: L('Période', 'Period'), render: (a) => esc(slotShort(a.sequence)), hideM: true },
        { label: L('Barème', 'Out of'), cls: 'r', render: (a) => `/${a.max} <span class="muted sm">×${a.weight}</span>`, hideM: true }, { label: L('Copies', 'Scripts'), cls: 'r', render: (a) => `${a.filled}` },
        { label: L('Moyenne', 'Average'), cls: 'r', render: (a) => (a.avg20 == null ? '—' : `<b class="num ${avgCls(a.avg20)}">${dec(a.avg20)}</b><span class="muted sm">/20</span>`) }] })}`;
  ctx.el.querySelector('#fcl').onchange = (e) => go('/school/assessments', { ...q, class_id: e.target.value, course_id: '' });
  ctx.el.querySelector('#fk').onchange = (e) => go('/school/assessments', { ...q, kind: e.target.value });
  document.getElementById('new')?.addEventListener('click', async () => {
    const v = await assessmentDialog(courses, { course_id: q.course_id || courses[0]?.id });
    if (v) location.hash = `/school/assessment/${v.id}`;
  });
});

function assessmentDialog(courses, a = {}) {
  return dialog({ title: a.id ? a.title : L('Nouvelle évaluation', 'New assessment'), body: `<div class="form f2">
    ${a.id ? '' : field({ name: 'course_id', label: L('Cours', 'Course'), type: 'select', options: courses.map((c) => [c.id, courseLabel(c)]), required: true, span: true }, a)}
    ${field({ name: 'title', label: L('Intitulé', 'Title'), required: true, placeholder: L('ex. Interrogation n°2 : fractions', 'e.g. Quiz 2: fractions'), span: true }, a)}
    ${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: Object.keys(S().assess_kinds).map((k) => [k, kindName(k)]) }, a)}
    ${field({ name: 'sequence', label: lmd() ? L('Épreuve', 'Component') : L('Période', 'Period'), type: 'select', options: S().slots.map((q) => [q.seq, q.label]) }, a)}
    ${field({ name: 'date', label: 'Date', type: 'date', value: today() }, a)}${field({ name: 'max', label: L('Noté sur', 'Out of'), type: 'number', min: 1, value: 20 }, a)}
    ${field({ name: 'weight', label: L('Poids dans la moyenne', 'Weight'), type: 'number', min: 0, step: '0.5', value: 1, hint: L('ex. 2 pour un devoir surveillé', 'e.g. 2 for a test') }, a)}</div>`,
  onSubmit: (b) => (a.id ? api.put(`/api/school/assessments/${a.id}`, b) : api.post('/api/school/assessments', b)) });
}

R('/school/assessment/:id', async (ctx) => {
  const a = await api.get(`/api/school/assessments/${ctx.params.id}`);
  ctx.title(a.title);
  const mine = can('teaching') && (isManager() || a.course.teacher_id === state.me.user.id);
  ctx.actions(mine ? `<button class="btn" id="ed">${icon('edit')}<span class="hide-m">${L('Modifier', 'Edit')}</span></button><button class="btn" id="del">${icon('trash')}</button>` : '');
  ctx.el.innerHTML = `<div class="card sc-head"><div class="row between" style="flex-wrap:wrap;gap:10px"><div><h2 style="margin:0">${esc(a.title)}</h2><div class="muted">${esc(a.course.class_name)} · ${esc(a.course.subject)} · ${esc(kindName(a.kind))} · ${dt(a.date)} · ${esc(slotLabel(a.sequence))} · /${a.max} ×${a.weight}</div></div>
    <div class="row" style="gap:16px"><div class="r"><small class="muted">${L('Moyenne', 'Average')}</small><div style="font-size:22px;font-weight:700" id="avg">${a.stats.avg == null ? '—' : dec(a.stats.avg)}</div></div><div class="r"><small class="muted">Max / min</small><div style="font-size:22px;font-weight:700">${a.stats.max ?? '—'} / ${a.stats.min ?? '—'}</div></div></div></div></div>
    <form id="sc" class="card" style="padding:0;margin-top:14px"><div class="tbl-wrap"><table class="tbl sc-sheet"><thead><tr><th>#</th><th>${L('Nom', 'Name')}</th><th class="r">/${a.max}</th><th>${L('Abs.', 'Abs.')}</th><th class="hide-m">${L('Commentaire', 'Comment')}</th></tr></thead><tbody>
    ${a.students.map((s, i) => `<tr data-id="${s.id}"><td class="muted">${i + 1}</td><td><b>${esc(s.last_name)}</b> ${esc(s.first_name)}</td><td class="r"><input class="mk" inputmode="decimal" value="${s.score == null ? '' : dec(s.score)}" ${mine ? '' : 'disabled'}></td><td><input type="checkbox" class="ab" ${s.absent ? 'checked' : ''}></td><td class="hide-m"><input class="rm" value="${esc(s.comment)}"></td></tr>`).join('')}
    </tbody></table></div>${mine ? `<div class="row between" style="padding:12px 16px"><span class="muted sm">${L('La note de la période est recalculée à l\'enregistrement.', 'The period mark is recomputed on save.')}</span><button class="btn primary">${icon('check')} ${L('Enregistrer', 'Save')}</button></div>` : ''}</form>`;
  const inputs = [...ctx.el.querySelectorAll('.mk')];
  inputs.forEach((inp, i) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inputs[i + 1]?.focus(); inputs[i + 1]?.select(); } }));
  document.getElementById('sc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const scores = [...ctx.el.querySelectorAll('tr[data-id]')].map((tr) => ({ student_id: Number(tr.dataset.id), score: tr.querySelector('.mk').value.trim(), absent: tr.querySelector('.ab').checked, comment: tr.querySelector('.rm').value }));
    try { await api.post(`/api/school/assessments/${a.id}/scores`, { scores }); toast(L('Copies enregistrées, moyenne de période mise à jour', 'Scores saved, period mark updated'), 'ok'); ctx.rerender(); } catch (err) { fail(err); }
  });
  document.getElementById('ed')?.addEventListener('click', async () => { if (await assessmentDialog([], a)) ctx.rerender(); });
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!(await confirmDlg(L('Supprimer l\'évaluation', 'Delete assessment'), L('Les copies saisies seront supprimées et la note de la période recalculée.', 'Scores will be deleted and the period mark recomputed.'), L('Supprimer', 'Delete'), true))) return;
    try { await api.del(`/api/school/assessments/${a.id}`); location.hash = '/school/assessments'; } catch (err) { fail(err); }
  });
});

// ===================== Results, councils, report cards =====================
R('/school/results', async (ctx) => {
  ctx.title(lmd() ? L('Résultats et relevés', 'Results & transcripts') : L('Résultats et bulletins', 'Results & report cards'));
  const classes = S().classes;
  const classId = Number(ctx.query.class_id) || classes[0]?.id;
  const period = ctx.query.period || S().periods[0]?.id;
  if (!classId) { ctx.el.innerHTML = `<div class="card empty"><b>${L('Aucune classe', 'No class')}</b></div>`; return; }
  const r = await api.get(`/api/school/results${qs({ class_id: classId, period })}`);
  const office = canAny('schooloffice', 'settings');
  const base = `class_id=${classId}&period=${period}`;
  ctx.actions(`<a class="btn" href="/api/school/results?${base}&format=xlsx">${icon('download')}<span class="hide-m">Excel</span></a>
    <a class="btn" target="_blank" href="/api/school/bulletins?${base}&lang=${state.lang}">${icon('print')}<span class="hide-m">${lmd() ? L('Relevés', 'Transcripts') : L('Bulletins', 'Report cards')}</span></a>
    ${office ? `<button class="btn primary" id="council">${icon('users')}<span class="hide-m">${L('Conseil de classe', 'Class council')}</span></button>` : ''}`);
  const st = r.stats; const lm = r.grading === 'lmd';
  ctx.el.innerHTML = `${offlineNote(r)}<div class="card filters"><div class="row" style="gap:10px;flex-wrap:wrap">
      <label class="fld">${L('Classe', 'Class')}${sel('fc', classOpts(false), classId)}</label><label class="fld">${L('Période', 'Period')}${sel('fp', S().periods.map((p) => [p.id, L(p.fr, p.en)]), period)}</label>
      ${r.locked ? `<span class="pill" style="align-self:flex-end">${icon('lock')} ${L('Conseil tenu, notes verrouillées', 'Council held, marks locked')}</span>${can('settings') && isManager() ? `<button class="btn sm" id="unl" style="align-self:flex-end">${L('Déverrouiller', 'Unlock')}</button>` : ''}` : ''}</div></div>
    <div class="grid g4" style="margin:14px 0">${kpi(L('Moyenne de la classe', 'Class average'), dec(st.avg), `max ${dec(st.max)} · min ${dec(st.min)}`, 'accent')}
      ${kpi(L('Taux de réussite', 'Pass rate'), `${dec(st.pass_rate, 1)} %`, `${st.pass}/${st.ranked} ${L('admis', 'passed')}`)}${kpi(L('Effectif', 'Size'), st.size, `${st.girls} F · ${st.boys} M`)}
      ${kpi(L('Professeur principal', 'Form teacher'), `<span style="font-size:16px">${esc(r.class.head_teacher || '—')}</span>`, esc(r.class.level_name))}</div>
    <div class="card" style="padding:0"><div class="tbl-wrap"><table class="tbl sc-results"><thead><tr><th>${L('Rang', 'Rank')}</th><th>${L('Nom', 'Name')}</th>
      ${r.courses.map((c) => `<th class="r hide-m" title="${esc(c.subject)} · ${esc(c.teacher || '')}">${esc((c.code || c.subject).slice(0, 10))}<div class="muted sm">${lm ? `${c.coef} cr.` : `coef ${c.coef}`}</div></th>`).join('')}
      <th class="r">${L('Moy.', 'Avg')}</th>${lm ? `<th class="r">${L('Crédits', 'Credits')}</th><th class="r">GPA</th>` : ''}<th>${L('Mention', 'Distinction')}</th>${period === 'year' ? `<th>${L('Décision', 'Decision')}</th>` : ''}</tr></thead><tbody>
      ${r.students.map((s) => `<tr class="click" data-href="#/school/student/${s.id}"><td><b>${s.rank ?? '—'}</b>${s.rank && s.rank <= 3 ? ` ${['🥇', '🥈', '🥉'][s.rank - 1]}` : ''}</td><td><b>${esc(s.last_name)}</b> ${esc(s.first_name)}</td>
        ${r.courses.map((c) => { const x = s.courses[c.id]; return `<td class="r hide-m"><span class="num ${avgCls(x.avg)}">${dec(x.avg)}</span>${lm && x.grade ? `<div class="muted sm">${x.grade}</div>` : ''}</td>`; }).join('')}
        <td class="r"><b class="num ${avgCls(s.average)}">${dec(s.average)}</b></td>${lm ? `<td class="r">${s.credits}/${s.credits_total}</td><td class="r">${s.gpa ?? '—'}</td>` : ''}
        <td>${s.distinction ? `<span class="pill ${['warning', 'blame'].includes(s.distinction) ? 'bad' : 'ok'}">${esc(distName(s.distinction))}</span>` : ''}</td>
        ${period === 'year' ? `<td>${s.decision ? `<span class="pill ${s.decision === 'promoted' || s.decision === 'graduated' ? 'ok' : 'bad'}">${esc(decisionName(s.decision))}</span>` : '<span class="muted sm">—</span>'}</td>` : ''}</tr>`).join('')}
      </tbody><tfoot><tr><td></td><td class="muted">${L('Moyenne · réussite', 'Average · pass')}</td>${r.courses.map((c) => `<td class="r hide-m"><b class="num ${avgCls(c.stats.avg)}">${dec(c.stats.avg)}</b><div class="muted sm">${c.stats.pass} %</div></td>`).join('')}<td class="r"><b>${dec(st.avg)}</b></td>${lm ? '<td></td><td></td>' : ''}<td></td>${period === 'year' ? '<td></td>' : ''}</tr></tfoot></table></div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${L('Matières de la classe', 'Subjects of the class')}</h3><div class="bar-list">${[...r.courses].filter((c) => c.stats.avg != null).sort((a, b) => b.stats.avg - a.stats.avg).map((c) => `<div class="it"><span>${esc(c.subject)} <span class="muted sm">${esc(c.teacher || '')}</span></span><b class="num ${avgCls(c.stats.avg)}">${dec(c.stats.avg)}</b><div class="tr"><i style="width:${(c.stats.avg / 20) * 100}%;background:${c.stats.avg < S().settings.pass_mark ? 'var(--bad)' : 'var(--blue)'}"></i></div></div>`).join('') || '<p class="muted">—</p>'}</div></div>
      <div class="card"><h3>${L('Répartition des moyennes', 'Spread of averages')}</h3>${spread(r.students.map((s) => s.average).filter((v) => v != null))}</div></div>`;
  ctx.el.querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href.slice(1); }));
  document.getElementById('fc').onchange = (e) => go('/school/results', { class_id: e.target.value, period });
  document.getElementById('fp').onchange = (e) => go('/school/results', { class_id: classId, period: e.target.value });
  document.getElementById('council')?.addEventListener('click', async () => { if (await councilDialog(r, period)) ctx.rerender(); });
  document.getElementById('unl')?.addEventListener('click', async () => {
    if (!(await confirmDlg(L('Déverrouiller les notes', 'Unlock marks'), L('Les enseignants pourront de nouveau modifier les notes de cette période.', 'Teachers will be able to edit the marks of this period again.')))) return;
    try { for (const q of r.period.seqs) await api.post('/api/school/unlock', { class_id: classId, sequence: q }); ctx.rerender(); } catch (err) { fail(err); }
  });
});
const decisionName = (d) => ({ promoted: L('Admis(e) en classe supérieure', 'Promoted'), repeat: L('Redouble', 'Repeats'), excluded: L('Exclu(e)', 'Excluded'), graduated: L('Diplômé(e)', 'Graduated') }[d] || d);

function spread(vals) {
  const bins = [[0, 5], [5, 8], [8, 10], [10, 12], [12, 14], [14, 16], [16, 20.01]];
  const counts = bins.map(([a, b]) => vals.filter((v) => v >= a && v < b).length);
  const max = Math.max(1, ...counts);
  return `<div class="hbars">${bins.map(([a, b], i) => `<div class="hb" title="${a}–${Math.floor(b)} : ${counts[i]}"><i style="height:${Math.max(2, (counts[i] / max) * 100)}%;background:${a < 10 ? 'var(--bad)' : a >= 14 ? 'var(--ok)' : 'var(--blue)'}"></i><span>${a}-${Math.floor(b)}</span></div>`).join('')}</div>`;
}

function councilDialog(r, period) {
  const D = S().distinctions; const year = period === 'year';
  return dialog({ title: `${L('Conseil de classe', 'Class council')} · ${r.class.name} · ${periodName(period)}`, wide: true, submit: L('Valider le conseil et verrouiller', 'Confirm and lock marks'),
    body: `<p class="muted sm">${L('Les mentions sont proposées d\'après les moyennes ; ajustez-les, ajoutez la conduite et l\'appréciation. La validation verrouille les notes de la période et alimente les bulletins.', 'Distinctions are suggested from averages; adjust them, add conduct and remarks. Confirming locks the period\'s marks and feeds the report cards.')}</p>
    <div class="tbl-wrap" style="max-height:55vh;overflow:auto"><table class="tbl"><thead><tr><th>#</th><th>${L('Nom', 'Name')}</th><th class="r">${L('Moy.', 'Avg')}</th><th>${L('Mention', 'Distinction')}</th><th>${L('Conduite', 'Conduct')}</th><th>${L('Appréciation', 'Remark')}</th>${year ? `<th>${L('Décision', 'Decision')}</th>` : ''}</tr></thead><tbody>
    ${r.students.map((s) => `<tr data-id="${s.id}"><td>${s.rank ?? ''}</td><td>${esc(s.last_name)} ${esc(s.first_name)}</td><td class="r"><b class="${avgCls(s.average)}">${dec(s.average)}</b></td>
      <td><select class="d">${[['', '—'], ...Object.entries(D).map(([k, v]) => [k, L(v[0], v[1])])].map(([k, l]) => `<option value="${k}" ${k === (s.distinction || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
      <td><select class="c">${['', 'Très bonne', 'Bonne', 'Passable', 'Mauvaise'].map((k) => `<option ${k === (s.council?.conduct || '') ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
      <td><input class="m" value="${esc(s.council?.remark || '')}" placeholder="${L('ex. Bon trimestre, poursuivez', 'e.g. Good term')}"></td>
      ${year ? `<td><select class="x">${[['', '—'], ['promoted', L('Admis', 'Promoted')], ['repeat', L('Redouble', 'Repeats')], ['graduated', L('Diplômé', 'Graduated')], ['excluded', L('Exclu', 'Excluded')]].map(([k, l]) => `<option value="${k}" ${k === (s.decision || (s.average == null ? '' : s.average >= S().settings.pass_mark ? 'promoted' : 'repeat')) ? 'selected' : ''}>${l}</option>`).join('')}</select></td>` : ''}</tr>`).join('')}</tbody></table></div>`,
    onSubmit: (_, form) => api.post('/api/school/council', { class_id: r.class.id, period, decisions: [...form.querySelectorAll('tr[data-id]')].map((tr) => ({ student_id: Number(tr.dataset.id), distinction: tr.querySelector('.d').value, conduct: tr.querySelector('.c').value, remark: tr.querySelector('.m').value, ...(year ? { decision: tr.querySelector('.x').value } : {}) })) }) });
}

// ===================== Roll call =====================
R('/school/roll', async (ctx) => {
  ctx.title(L('Appel et absences', 'Roll call & absences'));
  const mine = isTeacher() ? S().my_courses : [];
  const classes = isTeacher() ? [...new Map(mine.map((c) => [c.class_id, { id: c.class_id, name: c.class_name }])).values()] : S().classes;
  const classId = Number(ctx.query.class_id) || classes[0]?.id;
  const date = ctx.query.date || today();
  if (!classId) { ctx.el.innerHTML = `<div class="card empty"><b>${L('Aucune classe', 'No class')}</b></div>`; return; }
  const courses = isTeacher() ? mine.filter((c) => c.class_id === classId) : await api.get(`/api/school/courses?class_id=${classId}`);
  const courseId = ctx.query.course_id || (isTeacher() ? courses[0]?.id || '' : '');
  const r = await api.get(`/api/school/roll${qs({ class_id: classId, date, course_id: courseId })}`);
  ctx.actions(canAny('reports', 'discipline', 'schooloffice') ? `<a class="btn" href="#/school/absences">${icon('chart')}<span class="hide-m">${L('Rapport des absences', 'Absence report')}</span></a>` : '');
  const absent = new Set(r.marked.filter((a) => a.kind === 'absent' && a.source !== 'gate').map((a) => a.student_id));
  const late = new Map(r.marked.filter((a) => a.kind === 'late').map((a) => [a.student_id, a.minutes]));
  const state_ = Object.fromEntries(r.students.map((s) => [s.id, absent.has(s.id) ? 'a' : late.has(s.id) ? 'l' : 'p']));
  const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });
  ctx.el.innerHTML = `${offlineNote(r)}<div class="card filters"><div class="row" style="gap:10px;flex-wrap:wrap">
      <label class="fld">${L('Classe', 'Class')}${sel('fc', classes.map((c) => [c.id, c.name]), classId)}</label>
      <label class="fld">${L('Cours', 'Lesson')}${sel('fco', [...(isTeacher() ? [] : [['', L('Journée entière', 'Whole day')]]), ...courses.map((c) => [c.id, c.subject])], courseId)}</label>
      <label class="fld">Date<input type="date" id="fd" value="${date}" max="${today()}"></label></div></div>
    ${r.done ? `<div class="banner ok" style="margin-top:12px">${icon('check')} ${L('Appel déjà fait', 'Roll already taken')} · ${r.done.present} ${L('présents', 'present')}, ${r.done.absent} ${L('absents', 'absent')}. ${L('Vous pouvez le corriger.', 'You can correct it.')}</div>` : ''}
    <div class="row between" style="margin:14px 0 8px"><span class="muted">${L('Touchez un nom : présent → absent → en retard', 'Tap a name: present → absent → late')}</span><span id="cnt" class="pill"></span></div>
    <div class="sc-roll">${r.students.map((s) => `<button type="button" class="sc-st" data-id="${s.id}">${avatar(s, 40)}<span><b>${esc(s.last_name)}</b><br>${esc(s.first_name)}${r.arrivals[s.id] ? `<small class="muted"> · ${L('portail', 'gate')} ${time(r.arrivals[s.id])}</small>` : ''}</span><i></i></button>`).join('')}</div>
    <div class="sc-rollbar"><button class="btn" id="allp">${L('Tous présents', 'All present')}</button><button class="btn primary" id="save">${icon('check')} ${L('Valider l\'appel', 'Submit roll')}</button></div>`;
  const paint = () => {
    ctx.el.querySelectorAll('.sc-st').forEach((b) => { const v = state_[b.dataset.id]; b.dataset.s = v; b.querySelector('i').textContent = v === 'a' ? L('Absent', 'Absent') : v === 'l' ? L('Retard', 'Late') : L('Présent', 'Present'); });
    const vals = Object.values(state_);
    document.getElementById('cnt').textContent = `${vals.filter((v) => v !== 'a').length} ${L('présents', 'present')} · ${vals.filter((v) => v === 'a').length} ${L('absents', 'absent')} · ${vals.filter((v) => v === 'l').length} ${L('retards', 'late')}`;
  };
  paint();
  ctx.el.querySelectorAll('.sc-st').forEach((b) => b.addEventListener('click', () => { const v = state_[b.dataset.id]; state_[b.dataset.id] = v === 'p' ? 'a' : v === 'a' ? 'l' : 'p'; navigator.vibrate?.(10); paint(); }));
  document.getElementById('allp').onclick = () => { for (const k of Object.keys(state_)) state_[k] = 'p'; paint(); };
  document.getElementById('fc').onchange = (e) => go('/school/roll', { class_id: e.target.value, date });
  document.getElementById('fco').onchange = (e) => go('/school/roll', { class_id: classId, course_id: e.target.value, date });
  document.getElementById('fd').onchange = (e) => go('/school/roll', { class_id: classId, course_id: courseId, date: e.target.value });
  document.getElementById('save').onclick = async () => {
    const ids = Object.entries(state_);
    try {
      const res = await api.post('/api/school/attendance', { class_id: classId, course_id: courseId || null, date, hours: courseId ? 1 : 4,
        absent: ids.filter(([, v]) => v === 'a').map(([k]) => Number(k)), late: ids.filter(([, v]) => v === 'l').map(([k]) => ({ student_id: Number(k), minutes: late.get(Number(k)) || 10 })) });
      toast(res?._queued ? L('Hors ligne : appel gardé, envoi au retour du réseau', 'Offline: roll saved, will sync') : `${L('Appel enregistré', 'Roll saved')} · ${res.absent} ${L('absent(s)', 'absent')}`, 'ok');
      if (!res?._queued) ctx.rerender();
    } catch (err) { fail(err); }
  };
});

R('/school/absences', async (ctx) => {
  ctx.title(L('Rapport des absences', 'Absence report'));
  const q = { class_id: ctx.query.class_id || '', from: ctx.query.from || '', to: ctx.query.to || '' };
  const r = await api.get(`/api/school/attendance-report${qs(q)}`);
  ctx.actions(`<a class="btn" href="/api/school/attendance-report${qs({ ...q, format: 'xlsx' })}">${icon('download')}<span class="hide-m">Excel</span></a>`);
  const tot = r.rows.reduce((a, b) => ({ h: a.h + b.hours, j: a.j + b.justified, l: a.l + b.lates }), { h: 0, j: 0, l: 0 });
  ctx.el.innerHTML = `<div class="card filters"><div class="row" style="gap:10px;flex-wrap:wrap"><label class="fld">${L('Classe', 'Class')}${sel('fc', classOpts(), q.class_id)}</label>
    <label class="fld">${L('Du', 'From')}<input type="date" id="ff" value="${r.from}"></label><label class="fld">${L('Au', 'To')}<input type="date" id="ft" value="${r.to}"></label></div></div>
    <div class="grid g3" style="margin:14px 0">${kpi(L('Heures d\'absence', 'Hours absent'), num(tot.h), `${num(tot.h - tot.j)} h ${L('non justifiées', 'unexcused')}`, 'accent')}${kpi(L('Justifiées', 'Excused'), `${num(tot.j)} h`)}${kpi(L('Retards', 'Lates'), num(tot.l))}</div>
    ${table({ rows: r.rows, href: (x) => `#/school/student/${x.id}`, columns: [{ label: L('Nom', 'Name'), render: (x) => `<b>${esc(x.last_name)}</b> ${esc(x.first_name)}<div class="muted sm mono">${esc(x.matricule)}</div>` }, { label: L('Classe', 'Class'), key: 'class_name' },
      { label: L('Heures', 'Hours'), cls: 'r', render: (x) => `<b>${x.hours}</b>` }, { label: L('Non justifiées', 'Unexcused'), cls: 'r', render: (x) => `<span class="${x.hours - x.justified >= S().settings.absence_alert_hours ? 'bad-t' : ''}"><b>${x.hours - x.justified}</b></span>` }, { label: L('Retards', 'Lates'), cls: 'r', key: 'lates' }] })}`;
  const upd = () => go('/school/absences', { class_id: document.getElementById('fc').value, from: document.getElementById('ff').value, to: document.getElementById('ft').value });
  ['fc', 'ff', 'ft'].forEach((id) => { document.getElementById(id).onchange = upd; });
});

// ===================== Gate check-in =====================
let camStop = null;
R('/school/gate', async (ctx) => {
  ctx.title(L('Portail : entrées et sorties', 'Gate check-in'));
  camStop?.();
  const g = await api.get('/api/school/gate');
  ctx.actions(`<button class="btn" id="cam">${icon('camera')}<span class="hide-m">${L('Caméra', 'Camera')}</span></button>`);
  const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' });
  ctx.el.innerHTML = `<div class="grid g4">${kpi(L('Arrivés', 'Arrived'), `${g.arrived}<small style="font-size:14px">/${g.total}</small>`, `${g.total ? Math.round((g.arrived / g.total) * 100) : 0} %`, 'accent')}${kpi(L('Sur place', 'On site'), g.inside)}${kpi(L('En retard', 'Late'), g.late, '', g.late ? 'warn' : '')}${kpi(L('Pas encore arrivés', 'Not yet arrived'), Math.max(0, g.total - g.arrived))}</div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><form id="scan" class="sc-scan"><input id="code" autocomplete="off" autofocus placeholder="${L('Scannez la carte ou tapez le matricule', 'Scan the card or type the ID')}"><button class="btn primary">${icon('scan')}</button></form>
      <div class="row" style="gap:6px;margin-top:8px"><label class="check"><input type="radio" name="dir" value="" checked> ${L('Auto', 'Auto')}</label><label class="check"><input type="radio" name="dir" value="in"> ${L('Entrée', 'In')}</label><label class="check"><input type="radio" name="dir" value="out"> ${L('Sortie', 'Out')}</label></div>
      <video id="vid" playsinline muted style="display:none;width:100%;border-radius:12px;margin-top:10px;background:#000"></video>
      <div id="res" class="sc-gate-res"><p class="muted">${L('Un lecteur de codes QR USB ou la caméra du téléphone scanne la carte. Les retards sont notés et les parents voient l\'heure d\'arrivée sur leur portail.', 'A USB QR reader or the phone camera scans the card. Lateness is recorded and parents see the arrival time on their portal.')}</p></div></div>
    <div class="card"><h3>${L('Derniers passages', 'Latest scans')}</h3><div id="recent">${g.recent.map((x) => `<a class="lrow row between" href="#/school/student/${x.student_id}"><span>${esc(x.last_name)} ${esc(x.first_name)} <span class="muted sm">${esc(x.class_name || '')}</span></span><span><span class="pill ${x.direction === 'in' ? 'ok' : ''}">${x.direction === 'in' ? L('entrée', 'in') : L('sortie', 'out')} ${time(x.at)}</span>${x.late_minutes ? ` <span class="pill warn">+${x.late_minutes} min</span>` : ''}</span></a>`).join('') || `<p class="muted">—</p>`}</div></div></div>`;
  const input = document.getElementById('code'); const res = document.getElementById('res');
  let busy = false, lastCode = '', lastAt = 0;
  const scan = async (code) => {
    if (!code || busy) return; if (code === lastCode && Date.now() - lastAt < 3000) return;
    busy = true; lastCode = code; lastAt = Date.now();
    try {
      const r = await api.post('/api/school/gate', { code, direction: ctx.el.querySelector('input[name=dir]:checked').value || undefined });
      const s = r.student; const warn = r.late_minutes > 0; const bad = r.overdue > 0;
      res.innerHTML = `<div class="sc-gate ${warn ? 'late' : 'ok'} ${r.direction}"><div style="font-size:42px">${r.direction === 'in' ? (warn ? '⏰' : '✅') : '👋'}</div><div><h2>${esc(s.name)}</h2><div>${esc(s.class_name)} · <span class="mono">${esc(s.matricule)}</span></div>
        <b>${r.direction === 'in' ? L('Entrée', 'In') : L('Sortie', 'Out')} ${esc(r.time)}${warn ? ` · ${L('retard de', 'late by')} ${r.late_minutes} min` : ''}</b>
        ${s.allergies ? `<div class="pill bad">${L('Allergie', 'Allergy')} : ${esc(s.allergies)}</div>` : ''}${bad ? `<div class="pill warn">${L('Frais en retard', 'Fees overdue')} : ${money(r.overdue)}</div>` : ''}</div></div>`;
      navigator.vibrate?.(warn ? [60, 40, 60] : 30);
      setTimeout(() => ctx.rerender(), 2500);
    } catch (err) { res.innerHTML = `<div class="sc-gate bad"><div style="font-size:42px">⛔</div><div><h2>${esc(err.message)}</h2><div class="mono">${esc(code)}</div></div></div>`; navigator.vibrate?.([200]); }
    finally { busy = false; input.value = ''; input.focus(); }
  };
  document.getElementById('scan').addEventListener('submit', (e) => { e.preventDefault(); scan(input.value.trim()); });
  document.getElementById('cam').onclick = async () => {
    if (camStop) { camStop(); return; }
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return toast(L('Ce navigateur ne lit pas les QR codes : utilisez Chrome sur Android ou un lecteur USB.', 'This browser cannot read QR codes: use Chrome on Android or a USB reader.'), 'err');
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = document.getElementById('vid'); v.srcObject = stream; v.style.display = 'block'; await v.play();
      let on = true;
      camStop = () => { on = false; stream.getTracks().forEach((t) => t.stop()); v.style.display = 'none'; camStop = null; };
      const loop = async () => { if (!on || !document.body.contains(v)) return camStop?.(); try { const c = await det.detect(v); if (c[0]) scan(c[0].rawValue); } catch {} setTimeout(loop, 350); };
      loop();
    } catch (err) { fail(err); }
  };
}, true);

// ===================== Discipline =====================
R('/school/discipline', async (ctx) => {
  ctx.title(L('Discipline', 'Discipline'));
  const q = { class_id: ctx.query.class_id || '', kind: ctx.query.kind || '' };
  const list = await api.get(`/api/school/discipline${qs(q)}`);
  ctx.actions(canAny('discipline', 'schooloffice', 'teaching') ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Nouvelle entrée', 'New record')}</span></button>` : '');
  const count = (k) => list.filter((d) => d.kind === k).length;
  ctx.el.innerHTML = `${offlineNote(list)}<div class="card filters"><div class="row" style="gap:10px;flex-wrap:wrap"><label class="fld">${L('Classe', 'Class')}${sel('fc', classOpts(), q.class_id)}</label>
    <label class="fld">${L('Mesure', 'Measure')}${sel('fk', [['', L('Toutes', 'All')], ...Object.keys(S().discipline).map((k) => [k, DISC(k)])], q.kind)}</label></div></div>
    <div class="grid g4" style="margin:14px 0">${kpi(L('Félicitations', 'Praise'), count('praise'), '', 'accent')}${kpi(L('Avertissements', 'Warnings'), count('warning'))}${kpi(L('Consignes', 'Detentions'), count('detention'), `${list.filter((d) => d.kind === 'detention').reduce((a, b) => a + b.hours, 0)} h`)}${kpi(L('Blâmes et exclusions', 'Reprimands & suspensions'), count('blame') + count('suspension') + count('exclusion'), '', count('suspension') + count('exclusion') ? 'warn' : '')}</div>
    ${table({ rows: list, columns: [{ label: 'Date', render: (d) => dt(d.date) }, { label: L('Nom', 'Name'), render: (d) => `<a href="#/school/student/${d.student_id}"><b>${esc(d.last_name)}</b> ${esc(d.first_name)}</a><div class="muted sm">${esc(d.class_name || '')}</div>` },
      { label: L('Mesure', 'Measure'), render: (d) => `<span class="pill ${d.kind === 'praise' ? 'ok' : ['suspension', 'exclusion', 'blame'].includes(d.kind) ? 'bad' : 'warn'}">${esc(DISC(d.kind))}</span>${d.hours ? ` ${d.hours} h` : ''}${d.days ? ` ${d.days} ${L('j', 'd')}` : ''}` },
      { label: L('Motif', 'Reason'), key: 'reason' }, { label: L('Par', 'By'), key: 'by_name', hideM: true }, ...(canAny('discipline', 'settings') ? [{ label: '', cls: 'r', render: (d) => `<button class="btn ghost sm" data-del="${d.id}" aria-label="${L('Supprimer', 'Delete')}">${icon('trash')}</button>` }] : [])] })}`;
  ctx.el.querySelector('#fc').onchange = (e) => go('/school/discipline', { ...q, class_id: e.target.value });
  ctx.el.querySelector('#fk').onchange = (e) => go('/school/discipline', { ...q, kind: e.target.value });
  document.getElementById('new')?.addEventListener('click', async () => { if (await disciplineDialog()) ctx.rerender(); });
  ctx.el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDlg(L('Supprimer cette entrée', 'Delete this record'), L('L\'entrée disparaît du dossier de l\'élève.', 'The record is removed from the student file.'), L('Supprimer', 'Delete'), true))) return;
    try { await api.del(`/api/school/discipline/${b.dataset.del}`); ctx.rerender(); } catch (err) { fail(err); }
  }));
}, true);

// ===================== Timetable =====================
R('/school/timetable', async (ctx) => {
  ctx.title(L('Emploi du temps', 'Timetable'));
  const view = ctx.query.view || (isTeacher() ? 'teacher' : 'class');
  const classId = ctx.query.class_id || (view === 'class' ? S().classes[0]?.id : '');
  const teacherId = ctx.query.teacher_id || (view === 'teacher' ? state.me.user.id : '');
  const room = ctx.query.room || '';
  const q = view === 'class' ? { class_id: classId } : view === 'teacher' ? { teacher_id: teacherId } : { room };
  const slots = await api.get(`/api/school/timetable${qs(q)}`);
  const edit = canAny('settings', 'schooloffice');
  ctx.actions(`<a class="btn" target="_blank" href="/api/school/timetable${qs({ ...q, format: 'html' })}">${icon('print')}<span class="hide-m">${L('Imprimer', 'Print')}</span></a>${edit && view === 'class' ? `<button class="btn primary" id="add">${icon('plus')}<span class="hide-m">${L('Ajouter un cours', 'Add a slot')}</span></button>` : ''}`);
  const days = Object.keys(S().days).map(Number).filter((d) => d <= 5 || slots.some((s) => s.day === d));
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const start = Math.min(7 * 60 + 30, ...slots.map((s) => toMin(s.start))); const end = Math.max(17 * 60 + 30, ...slots.map((s) => toMin(s.end)));
  const H = (end - start) * 1.1;
  const hours = []; for (let h = Math.ceil(start / 60); h * 60 <= end; h++) hours.push(h);
  ctx.el.innerHTML = `${offlineNote(slots)}<div class="card filters"><div class="row" style="gap:10px;flex-wrap:wrap">
      <label class="fld">${L('Vue', 'View')}${sel('fv', [['class', L('Par classe', 'By class')], ['teacher', L('Par enseignant', 'By teacher')], ['room', L('Par salle', 'By room')]], view)}</label>
      ${view === 'class' ? `<label class="fld">${L('Classe', 'Class')}${sel('fx', classOpts(false), classId)}</label>` : view === 'teacher' ? `<label class="fld">${L('Enseignant', 'Teacher')}${sel('fx', S().teachers.map((t) => [t.id, t.name]), teacherId)}</label>` : `<label class="fld">${L('Salle', 'Room')}<input id="fx" value="${esc(room)}" placeholder="ex. B12"></label>`}</div></div>
    <div class="card sc-tt-wrap" style="margin-top:14px"><div class="sc-tt" style="--cols:${days.length}"><div class="sc-tt-h"></div>${days.map((d) => `<div class="sc-tt-h">${esc(L(...S().days[d]))}</div>`).join('')}
      <div class="sc-tt-axis" style="height:${H}px">${hours.map((h) => `<span style="top:${(h * 60 - start) * 1.1}px">${String(h).padStart(2, '0')}:00</span>`).join('')}</div>
      ${days.map((d) => `<div class="sc-tt-day" style="height:${H}px">${hours.map((h) => `<i style="top:${(h * 60 - start) * 1.1}px"></i>`).join('')}${slots.filter((s) => s.day === d).map((s) => `<button type="button" class="sc-slot" data-id="${s.id}" style="top:${(toMin(s.start) - start) * 1.1}px;height:${(toMin(s.end) - toMin(s.start)) * 1.1 - 3}px;--c:${esc(s.color || '#15803D')}">
        <b>${esc(view === 'class' ? s.subject : `${s.class_name} · ${s.subject}`)}</b><span>${esc(s.start)}–${esc(s.end)}${s.room ? ` · ${esc(s.room)}` : ''}</span><span>${esc(view === 'teacher' ? '' : s.teacher_name || '')}</span></button>`).join('')}</div>`).join('')}</div>
      ${slots.length ? '' : `<p class="muted" style="text-align:center;padding:20px">${L('Aucun cours placé.', 'No slot yet.')} ${edit ? L('Ajoutez les cours : les conflits de classe, d\'enseignant et de salle sont refusés automatiquement.', 'Add slots: class, teacher and room clashes are refused automatically.') : ''}</p>`}</div>`;
  document.getElementById('fv').onchange = (e) => go('/school/timetable', { view: e.target.value });
  document.getElementById('fx').onchange = (e) => go('/school/timetable', { view, [view === 'class' ? 'class_id' : view === 'teacher' ? 'teacher_id' : 'room']: e.target.value });
  const slotDialog = async (s = {}) => {
    const courses = await api.get(`/api/school/courses?class_id=${s.class_id || classId}`);
    return dialog({ title: s.id ? `${s.subject} · ${s.class_name}` : L('Nouveau cours', 'New slot'), submit: L('Enregistrer', 'Save'), body: `<div class="form f2">
      ${field({ name: 'course_id', label: L('Matière', 'Subject'), type: 'select', options: courses.map((c) => [c.id, `${c.subject}${c.teacher_name ? ` · ${c.teacher_name}` : ''}`]), required: true, span: true }, s)}
      ${field({ name: 'day', label: L('Jour', 'Day'), type: 'select', options: Object.entries(S().days).map(([k, v]) => [k, L(...v)]) }, s)}${field({ name: 'room', label: L('Salle', 'Room') }, s)}
      ${field({ name: 'start', label: L('Début', 'Start'), type: 'time', value: '07:30', required: true }, s)}${field({ name: 'end', label: L('Fin', 'End'), type: 'time', value: '09:20', required: true }, s)}</div>
      ${s.id ? `<button type="button" class="btn danger sm" id="delslot">${icon('trash')} ${L('Retirer ce cours', 'Remove this slot')}</button>` : ''}`,
    onOpen: (d) => d.querySelector('#delslot')?.addEventListener('click', async () => { try { await api.del(`/api/school/timetable/${s.id}`); d.querySelector('[data-x]').click(); ctx.rerender(); } catch (err) { fail(err); } }),
    onSubmit: (b) => (s.id ? api.put(`/api/school/timetable/${s.id}`, b) : api.post('/api/school/timetable', b)) });
  };
  document.getElementById('add')?.addEventListener('click', async () => { if (await slotDialog()) ctx.rerender(); });
  ctx.el.querySelectorAll('.sc-slot').forEach((b) => b.addEventListener('click', async () => {
    const s = slots.find((x) => x.id === Number(b.dataset.id));
    if (edit) { if (await slotDialog(s)) ctx.rerender(); } else if (s.teacher_id === state.me.user.id) location.hash = `/school/roll?class_id=${s.class_id}&course_id=${s.course_id}`;
  }));
}, true);

// ===================== Lesson log and homework =====================
R('/school/lessons', async (ctx) => {
  ctx.title(L('Cahier de textes et devoirs', 'Lesson log & homework'));
  const q = { class_id: ctx.query.class_id || '', course_id: ctx.query.course_id || '' };
  const [list, courses] = await Promise.all([api.get(`/api/school/lessons${qs(q)}`), can('teaching') ? myCourses() : []]);
  ctx.actions(can('teaching') ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Nouvelle séance', 'New lesson')}</span></button>` : '');
  const byDate = {}; for (const l of list) (byDate[l.date] ||= []).push(l);
  ctx.el.innerHTML = `${offlineNote(list)}${isTeacher() ? '' : `<div class="card filters"><div class="row" style="gap:10px"><label class="fld">${L('Classe', 'Class')}${sel('fc', classOpts(), q.class_id)}</label></div></div>`}
    ${Object.entries(byDate).map(([d, ls]) => `<h3 class="sc-h">${esc(new Date(d + 'T12:00:00').toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>
      ${ls.map((l) => `<div class="card sc-lesson" data-id="${l.id}"><div class="row between"><span><b>${esc(l.subject)}</b> · ${esc(l.class_name)} <span class="muted sm">${esc(l.teacher_name || '')}</span></span>${l.homework ? `<span class="pill ${l.due_date && l.due_date < today() ? '' : 'info'}">${L('Devoir pour le', 'Due')} ${dt(l.due_date)}</span>` : ''}</div>
        <h4 style="margin:6px 0">${esc(l.title)}</h4>${l.content ? `<p class="muted" style="white-space:pre-wrap;margin:0">${esc(l.content)}</p>` : ''}${l.homework ? `<div class="sc-hw">📝 ${esc(l.homework)}</div>` : ''}</div>`).join('')}`).join('') || `<div class="card empty"><b>${L('Cahier de textes vide', 'Lesson log is empty')}</b><p>${L('Chaque séance notée ici apparaît sur le portail des parents avec les devoirs, et compte dans les heures des enseignants vacataires.', 'Each lesson logged here shows on the parents\' portal with homework and counts in part-time teachers\' hours.')}</p></div>`}`;
  ctx.el.querySelector('#fc')?.addEventListener('change', (e) => go('/school/lessons', { class_id: e.target.value }));
  const lessonDialog = (l = {}) => dialog({ title: l.id ? l.title : L('Nouvelle séance', 'New lesson'), body: `<div class="form f2">
    ${field({ name: 'course_id', label: L('Cours', 'Course'), type: 'select', options: courses.map((c) => [c.id, courseLabel(c)]), required: true, span: true }, l)}${field({ name: 'date', label: 'Date', type: 'date', value: today() }, l)}
    ${field({ name: 'title', label: L('Titre de la leçon', 'Lesson title'), required: true }, l)}${field({ name: 'content', label: L('Contenu traité', 'Content covered'), type: 'textarea', span: true }, l)}
    ${field({ name: 'homework', label: L('Devoir à faire', 'Homework'), type: 'textarea', span: true }, l)}${field({ name: 'due_date', label: L('Pour le', 'Due'), type: 'date' }, l)}</div>`,
  onSubmit: (b) => (l.id ? api.put(`/api/school/lessons/${l.id}`, b) : api.post('/api/school/lessons', b)) });
  document.getElementById('new')?.addEventListener('click', async () => { if (await lessonDialog({ course_id: ctx.query.new || q.course_id })) { location.hash = '/school/lessons'; ctx.rerender(); } });
  if (ctx.query.new && can('teaching')) setTimeout(() => document.getElementById('new')?.click(), 50);
  if (can('teaching')) ctx.el.querySelectorAll('.sc-lesson').forEach((c) => c.addEventListener('click', async () => { const l = list.find((x) => x.id === Number(c.dataset.id)); if ((isManager() || courses.some((x) => x.id === l.course_id)) && await lessonDialog(l)) ctx.rerender(); }));
}, true);

// ===================== Official exams =====================
R('/school/exams', async (ctx) => {
  ctx.title(L('Examens officiels', 'Official exams'));
  const session = ctx.query.session || '';
  const list = await api.get(`/api/school/exams${qs({ session })}`);
  const office = canAny('schooloffice', 'settings');
  ctx.actions(office ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Inscrire un candidat', 'Register a candidate')}</span></button>` : '');
  const groups = {}; for (const x of list) { const k = `${x.exam} ${x.session}`; (groups[k] ||= []).push(x); }
  const resName = (r) => ({ passed: L('Admis', 'Passed'), failed: L('Échec', 'Failed'), absent: 'Absent', registered: L('Inscrit', 'Registered') }[r]);
  ctx.el.innerHTML = `<div class="grid g4" style="margin-bottom:14px">${Object.entries(groups).slice(0, 4).map(([k, xs]) => { const done = xs.filter((x) => ['passed', 'failed'].includes(x.result)); const ok = xs.filter((x) => x.result === 'passed').length; return kpi(esc(k), done.length ? `${Math.round((ok / done.length) * 100)} %` : '—', `${ok}/${done.length || xs.length} ${L('admis', 'passed')} · ${xs.length} ${L('candidats', 'candidates')}`, 'accent'); }).join('')}</div>
    ${table({ rows: list, empty: `<b>${L('Aucun candidat inscrit', 'No candidate registered')}</b><p>${L('Suivez le CEP, BEPC, Probatoire, Bac, GCE et concours : candidats, centres et résultats, avec le taux de réussite de l\'établissement.', 'Track CEP, BEPC, Probatoire, Bac, GCE and entrance exams with the school\'s pass rate.')}</p>`,
      columns: [{ label: L('Examen', 'Exam'), render: (x) => `<b>${esc(x.exam)}</b> ${esc(x.session)}${x.series ? ` · ${esc(x.series)}` : ''}` }, { label: L('Candidat', 'Candidate'), render: (x) => `<a href="#/school/student/${x.student_id}">${esc(x.last_name)} ${esc(x.first_name)}</a><div class="muted sm mono">${esc(x.candidate_no || x.matricule)}</div>` },
        { label: L('Centre', 'Centre'), key: 'center', hideM: true }, { label: L('Résultat', 'Result'), render: (x) => `<span class="pill ${x.result === 'passed' ? 'ok' : x.result === 'failed' ? 'bad' : 'info'}">${esc(resName(x.result))}</span>${x.mention ? ` ${esc(x.mention)}` : ''}${x.score ? ` <span class="muted sm">${esc(x.score)}</span>` : ''}` },
        ...(office ? [{ label: '', cls: 'r', render: (x) => `<button class="btn sm" data-ed="${x.id}">${icon('edit')}</button>` }] : [])] })}`;
  const form = (x = {}) => `<div class="form f2">${field({ name: 'result', label: L('Résultat', 'Result'), type: 'select', options: [['registered', L('Inscrit', 'Registered')], ['passed', L('Admis', 'Passed')], ['failed', L('Échec', 'Failed')], ['absent', 'Absent']] }, x)}${field({ name: 'mention', label: 'Mention' }, x)}
    ${field({ name: 'score', label: L('Note / points', 'Score') }, x)}${field({ name: 'center', label: L('Centre', 'Centre') }, x)}${field({ name: 'candidate_no', label: L('N° de candidat', 'Candidate no.') }, x)}</div>`;
  ctx.el.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', async () => { const x = list.find((y) => y.id === Number(b.dataset.ed)); if (await dialog({ title: `${x.exam} · ${x.last_name} ${x.first_name}`, body: form(x), onSubmit: (v) => api.put(`/api/school/exams/${x.id}`, v) })) ctx.rerender(); }));
  document.getElementById('new')?.addEventListener('click', async () => {
    const v = await dialog({ title: L('Inscrire un candidat', 'Register a candidate'), body: `<div class="form f2"><label class="fld" style="grid-column:1/-1">${L('Élève', 'Student')}<select name="student_id" id="exs" required></select></label>
      ${field({ name: 'exam', label: L('Examen', 'Exam'), required: true, list: 'exl' })}<datalist id="exl">${['CEP', 'BEPC', 'Probatoire', 'Baccalauréat', 'GCE O/L', 'GCE A/L', 'FSLC', 'BTS', 'HND', 'TOEFL', 'DELF'].map((x) => `<option value="${x}">`).join('')}</datalist>
      ${field({ name: 'session', label: 'Session', value: today().slice(0, 4) })}${field({ name: 'series', label: L('Série', 'Series') })}${field({ name: 'center', label: L('Centre', 'Centre') })}${field({ name: 'candidate_no', label: L('N° de candidat', 'Candidate no.') })}</div>`,
    onOpen: async (d) => { const l = await api.get('/api/school/students'); d.querySelector('#exs').innerHTML = l.map((x) => `<option value="${x.id}">${esc(x.last_name)} ${esc(x.first_name)} · ${esc(x.class_name || '')}</option>`).join(''); },
    onSubmit: (b) => api.post(`/api/school/students/${b.student_id}/exams`, b) });
    if (v) ctx.rerender();
  });
});

// ===================== Announcements =====================
R('/school/announcements', async (ctx) => {
  ctx.title(L('Annonces aux parents et élèves', 'Announcements'));
  const list = await api.get('/api/school/announcements');
  const canPost = canAny('schooloffice', 'settings', 'teaching'); const canDel = canAny('schooloffice', 'settings');
  ctx.actions(canPost ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Nouvelle annonce', 'New announcement')}</span></button>` : '');
  ctx.el.innerHTML = `${offlineNote(list)}<p class="muted">${L('Les annonces apparaissent sur le portail de chaque parent et élève concerné (toute l\'école ou une classe).', 'Announcements show on the portal of each parent and student concerned (whole school or one class).')}</p>
    ${list.map((a) => `<div class="card sc-ann ${a.pinned ? 'pinned' : ''}"><div class="row between"><span>${a.pinned ? '📌 ' : ''}<b>${esc(a.title)}</b></span><span class="row" style="gap:6px"><span class="pill">${esc(a.class_name || L('Toute l\'école', 'Whole school'))}</span>${canDel ? `<button class="btn ghost sm" data-del="${a.id}">${icon('trash')}</button>` : ''}</span></div>
      <p style="white-space:pre-wrap">${esc(a.body)}</p><div class="muted sm">${esc(a.author || '')} · ${dt(a.created_at)}</div></div>`).join('') || `<div class="card empty"><b>${L('Aucune annonce', 'No announcement')}</b></div>`}`;
  document.getElementById('new')?.addEventListener('click', async () => {
    const classes = isTeacher() ? [...new Map(S().my_courses.map((c) => [c.class_id, [c.class_id, c.class_name]])).values()] : [['', L('Toute l\'école', 'Whole school')], ...S().classes.map((c) => [c.id, c.name])];
    const v = await dialog({ title: L('Nouvelle annonce', 'New announcement'), body: `<div class="form">${field({ name: 'class_id', label: L('Destinataires', 'Audience'), type: 'select', options: classes })}${field({ name: 'title', label: L('Titre', 'Title'), required: true })}
      ${field({ name: 'body', label: 'Message', type: 'textarea', required: true })}${isTeacher() ? '' : field({ name: 'pinned', label: L('Épingler en haut du portail', 'Pin at the top of the portal'), type: 'checkbox' })}</div>`,
    onSubmit: (b) => api.post('/api/school/announcements', b) });
    if (v) ctx.rerender();
  });
  ctx.el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { try { await api.del(`/api/school/announcements/${b.dataset.del}`); ctx.rerender(); } catch (err) { fail(err); } }));
});

// ===================== Early warning =====================
R('/school/insights', async (ctx) => {
  ctx.title(L('Alertes précoces', 'Early warning'));
  const classId = ctx.query.class_id || '';
  const list = await api.get(`/api/school/risk${qs({ class_id: classId })}`);
  const lv = (l) => list.filter((x) => x.level === l).length;
  const reasonsCount = {}; for (const r of list) for (const x of r.reasons) reasonsCount[x.k] = (reasonsCount[x.k] || 0) + 1;
  const RN = { marks: L('Moyenne faible', 'Low average'), drop: L('Résultats en baisse', 'Falling results'), subjects: L('Matières en échec', 'Failing subjects'), absence: L('Absences', 'Absences'), late: L('Retards', 'Lateness'), fees: L('Frais en retard', 'Overdue fees'), conduct: L('Conduite', 'Conduct') };
  ctx.el.innerHTML = `<div class="card sc-hello"><div><span class="ai-tag">✦ Teknons Insight</span><h2>${list.length} ${lmd() ? L('étudiants à accompagner', 'students who need support') : L('élèves à accompagner', 'students who need support')}</h2>
    <p>${L('Le score croise les notes, leur évolution, les absences des 30 derniers jours, les retards, les sanctions et les frais en retard. Agissez tôt : un appel au parent ou un tutorat change la fin d\'année.', 'The score combines marks, their trend, absences over 30 days, lateness, sanctions and overdue fees. Act early: a call to the parent or tutoring changes the end of the year.')}</p></div></div>
    <div class="card filters" style="margin-top:14px"><div class="row" style="gap:10px;flex-wrap:wrap"><label class="fld">${L('Classe', 'Class')}${sel('fc', classOpts(), classId)}</label>
      <span class="sc-risk high" style="align-self:center">${lv('high')}</span> ${L('élevé', 'high')} <span class="sc-risk medium" style="align-self:center">${lv('medium')}</span> ${L('moyen', 'medium')} <span class="sc-risk low" style="align-self:center">${lv('low')}</span> ${L('faible', 'low')}</div>
      <div class="sc-tags" style="margin-top:10px">${Object.entries(reasonsCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<i class="${k}">${esc(RN[k] || k)} · ${n}</i>`).join('')}</div></div>
    ${table({ rows: list, href: (r) => `#/school/student/${r.id}`, empty: `<b>${L('Aucun signal', 'No signal')}</b>`, columns: [{ label: L('Score', 'Score'), render: (r) => `<span class="sc-risk ${r.level}">${r.score}</span>` },
      { label: L('Nom', 'Name'), render: (r) => `<b>${esc(r.name)}</b><div class="muted sm">${esc(r.class_name)}</div>` }, { label: L('Moyenne', 'Average'), cls: 'r', render: (r) => `<b class="${avgCls(r.average)}">${dec(r.average)}</b>${r.previous != null ? `<div class="muted sm">${L('avant', 'before')} ${dec(r.previous)}</div>` : ''}` },
      { label: L('Signaux', 'Signals'), render: (r) => `<div class="sc-tags">${r.reasons.map((x) => `<i class="${x.k}">${esc(L(x.fr, x.en))}</i>`).join('')}</div>` }] })}`;
  document.getElementById('fc').onchange = (e) => go('/school/insights', { class_id: e.target.value });
});
