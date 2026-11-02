// Teknons Resto, back-of-house: kitchen and bar screen (KDS), reservations and
// waitlist, cash drawer, menu and recipes, stock and purchasing, loyal guests,
// forecast and insights, reports, check history and settings (floor editor, QR).
import { api } from './api.js';
import { state, L, esc, money, num, dt, today, icon, can, canAny, table, field, dialog, toast } from './ui.js';
import { R, M, fail, refreshMeta, kpi, ago, hm, wa, payName, kindName, emojiFor, withPin, courseName, isManager } from './resto.js';

const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dec = (n, d = 1) => String(Math.round((Number(n) || 0) * 10 ** d) / 10 ** d).replace('.', state.lang === 'en' ? '.' : ',');
const rangeBar = (ctx, path, extra = '') => {
  const to = ctx.query.to || today(), from = ctx.query.from || addDays(to, -29);
  const presets = [[L('Aujourd\'hui', 'Today'), today(), today()], [L('7 jours', '7 days'), addDays(today(), -6), today()], [L('30 jours', '30 days'), addDays(today(), -29), today()], [L('Ce mois', 'This month'), today().slice(0, 8) + '01', today()]];
  return { from, to, html: `<div class="row rs-range" style="margin-bottom:14px;flex-wrap:wrap">${presets.map(([l, f, t]) => `<a class="btn sm ${f === from && t === to ? 'primary' : ''}" href="#${path}?from=${f}&to=${t}${extra}">${esc(l)}</a>`).join('')}
    <input type="date" class="in" id="rf" value="${from}"><span class="muted">→</span><input type="date" class="in" id="rt" value="${to}"></div>`,
  wire: () => { const go = () => { location.hash = `${path}?from=${document.getElementById('rf').value}&to=${document.getElementById('rt').value}${extra}`; }; document.getElementById('rf').onchange = go; document.getElementById('rt').onchange = go; } };
};

// ===================== Kitchen & bar screen (KDS) =====================
let soundOn = true;
const beep = () => { if (!soundOn) return; try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.frequency.setValueAtTime(1175, a.currentTime + 0.12); o.stop(a.currentTime + 0.28); } catch {} };

const kds = async (ctx) => {
  const stations = M().stations.filter((s) => s.active !== 0);
  let st = ctx.query.station || localStorage.getItem('tk:kds') || '';
  ctx.title(L('Écran cuisine et bar', 'Kitchen & bar screen'));
  ctx.actions(`<button class="btn" id="snd">${icon('bell')}<span class="hide-m">${soundOn ? L('Son activé', 'Sound on') : L('Son coupé', 'Muted')}</span></button><button class="btn" id="fs">${icon('monitor')}<span class="hide-m">${L('Plein écran', 'Full screen')}</span></button>`);
  ctx.el.innerHTML = `<div class="row between" style="margin-bottom:12px"><div class="tabs" id="stt"></div><div class="row" id="sum"></div></div><div class="kds2"><div class="kgrid" id="kg"></div><div id="side"></div></div>`;
  let lastKeys = null;
  const target = M().settings.prep_target_min || 15;
  const draw = async () => {
    if (!document.body.contains(ctx.el.querySelector('#kg'))) return stop();
    const d = await api.get(`/api/resto/kitchen${st ? `?station_id=${st}` : ''}`, { cache: false });
    const keys = new Set(d.tickets.filter((t) => t.status === 'sent').map((t) => t.key));
    if (lastKeys && [...keys].some((k) => !lastKeys.has(k))) beep();
    lastKeys = keys;
    ctx.el.querySelector('#stt').innerHTML = [['', L('Tous les postes', 'All stations')], ...stations.map((s) => [String(s.id), s.name])].map(([k, l]) => `<a href="#" data-st="${k}" class="${k === st ? 'on' : ''}">${esc(l)}</a>`).join('');
    const cooking = d.tickets.filter((t) => t.status !== 'ready'), ready = d.tickets.filter((t) => t.status === 'ready');
    const late = cooking.filter((t) => (Date.now() - Date.parse(t.sent_at)) / 60000 > target).length;
    ctx.el.querySelector('#sum').innerHTML = `<span class="pill info">${cooking.length} ${L('en cours', 'cooking')}</span>${late ? `<span class="pill bad">${late} ${L('en retard', 'late')}</span>` : ''}<span class="pill ok">${ready.length} ${L('prêts', 'ready')}</span>`;
    const ticket = (t) => {
      const m = Math.floor((Date.now() - Date.parse(t.sent_at)) / 60000);
      const isLate = t.status !== 'ready' && m > target;
      return `<div class="kt ${t.status} ${isLate ? 'late' : ''}">
        <div class="kt-h"><b>${t.table_label ? `${L('Table', 'Table')} ${esc(t.table_label)}` : esc(t.guest_name || t.number)}</b><span class="mono">${m}′</span></div>
        <div class="sm muted">${esc(t.station_name || '')} · ${esc(kindName(t.kind))}${t.covers ? ` · ${t.covers} ${L('couv.', 'cov.')}` : ''}${t.server_name ? ` · ${esc(t.server_name.split(' ')[0])}` : ''}${t.source === 'qr' ? ' · <span class="pill info">QR</span>' : t.source === 'online' ? ` · <span class="pill info">${L('en ligne', 'online')}</span>` : ''}${t.pickup_time ? ` · ⏰ ${esc(t.pickup_time)}` : ''}</div>
        <ul>${t.lines.map((l) => `<li data-l="${l.id}" data-s="${l.status}" class="${l.status === 'ready' ? 'done' : ''}"><b>${num(l.qty)}×</b>${esc(l.name)}${l.status === 'preparing' ? ' <span class="ls preparing">●</span>' : ''}
          ${l.options ? `<small>${esc(l.options)}</small>` : ''}${l.note ? `<small class="nt">⚠ ${esc(l.note)}</small>` : ''}${l.seat ? `<small>${L('Siège', 'Seat')} ${l.seat} · ${esc(courseName(l.course))}</small>` : ''}</li>`).join('')}</ul>
        ${t.status === 'ready' ? `<button class="btn" data-served="${t.lines.map((l) => l.id).join(',')}">✓ ${L('Envoyé en salle', 'Picked up')}</button>`
        : `<div class="row" style="flex-wrap:nowrap">${t.status === 'sent' ? `<button class="btn" data-start="${t.lines.map((l) => l.id).join(',')}">${L('Commencer', 'Start')}</button>` : ''}<button class="btn primary" data-ready="${t.lines.filter((l) => l.status !== 'ready').map((l) => l.id).join(',')}">${L('Tout est prêt', 'All ready')}</button></div>`}
        <a class="muted sm" target="_blank" href="/api/resto/kitchen/ticket?key=${encodeURIComponent(t.key)}${st ? `&station_id=${st}` : ''}&print=1">${icon('print')} ${L('Imprimer le bon', 'Print ticket')}</a></div>`;
    };
    ctx.el.querySelector('#kg').innerHTML = [...cooking, ...ready].map(ticket).join('') || `<div class="card empty" style="grid-column:1/-1"><b>${L('Rien en attente', 'Nothing waiting')}</b><p class="muted">${L('Les nouveaux bons s\'affichent ici instantanément, avec un signal sonore.', 'New tickets appear here instantly, with a chime.')}</p></div>`;
    ctx.el.querySelector('#side').innerHTML = `<div class="card"><h3>${L('Total à produire', 'All day')}</h3>${d.all_day.map((x) => `<div class="ad"><span>${emojiFor(x.name)} ${esc(x.name)}</span><b>${num(x.qty)}</b></div>`).join('') || `<p class="muted sm">—</p>`}</div>
      ${d.held.length ? `<div class="card" style="margin-top:12px"><h3>${L('En attente du serveur', 'Held by waiters')}</h3><p class="muted sm">${L('Plats déjà commandés, pas encore lancés : préparez la mise en place.', 'Ordered but not fired yet: prep ahead.')}</p>${d.held.map((x) => `<div class="ad"><span>${esc(x.name)} <span class="muted sm">${esc(courseName(x.course))}</span></span><b>${num(x.qty)}</b></div>`).join('')}</div>` : ''}
      <div class="card" style="margin-top:12px"><h3>${L('Rupture (86)', 'Sold out (86)')}</h3><p class="muted sm">${L('Un plat n\'est plus disponible ? Il disparaît aussitôt des tablettes des serveurs et du menu QR.', 'A dish ran out? It vanishes from waiter tablets and the QR menu at once.')}</p><button class="btn sm" id="e86">${L('Gérer les ruptures', 'Manage sold-out')}</button></div>`;
    wire();
  };
  const bump = (ids, status) => api.post('/api/resto/kitchen/bump', { line_ids: ids.split(',').map(Number).filter(Boolean), status }).then(draw).catch(fail);
  function wire() {
    ctx.el.querySelectorAll('[data-st]').forEach((a) => a.onclick = (e) => { e.preventDefault(); st = a.dataset.st; try { localStorage.setItem('tk:kds', st); } catch {} lastKeys = null; draw().catch(fail); });
    ctx.el.querySelectorAll('li[data-l]').forEach((li) => li.onclick = () => bump(li.dataset.l, li.dataset.s === 'sent' ? 'preparing' : li.dataset.s === 'preparing' ? 'ready' : 'preparing'));
    ctx.el.querySelectorAll('[data-start]').forEach((b) => b.onclick = () => bump(b.dataset.start, 'preparing'));
    ctx.el.querySelectorAll('[data-ready]').forEach((b) => b.onclick = () => bump(b.dataset.ready, 'ready'));
    ctx.el.querySelectorAll('[data-served]').forEach((b) => b.onclick = () => bump(b.dataset.served, 'served'));
    ctx.el.querySelector('#e86')?.addEventListener('click', () => soldOut().then(draw).catch(fail));
  }
  const onLive = () => { if (!document.querySelector('dialog[open]')) draw().catch(() => {}); };
  const tick = setInterval(onLive, 30000);
  window.addEventListener('tk:kitchen', onLive); window.addEventListener('tk:change', onLive);
  function stop() { clearInterval(tick); window.removeEventListener('tk:kitchen', onLive); window.removeEventListener('tk:change', onLive); }
  window.addEventListener('hashchange', function h() { if (!location.hash.startsWith('#/resto/kitchen')) { stop(); window.removeEventListener('hashchange', h); } });
  document.getElementById('snd').onclick = (e) => { soundOn = !soundOn; e.currentTarget.querySelector('span').textContent = soundOn ? L('Son activé', 'Sound on') : L('Son coupé', 'Muted'); if (soundOn) beep(); };
  document.getElementById('fs').onclick = () => { document.body.classList.toggle('fullscreen'); if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.(); };
  await draw();
};
kds.noLiveRender = true;
R('/resto/kitchen', kds);

async function soldOut() {
  const m = await api.get('/api/resto/menu', { cache: false });
  await dialog({ title: L('Ruptures du jour (86)', "Today's sold-out (86)"), submit: null, cancel: L('Fermer', 'Close'), wide: true,
    body: `<input class="in" type="search" id="q86" placeholder="${L('Rechercher…', 'Search…')}" style="width:100%;margin-bottom:10px"><div id="l86" style="max-height:60vh;overflow:auto">${m.items.map((x) => `<label class="check" data-n="${esc(x.name.toLowerCase())}" style="justify-content:space-between;width:100%;padding:6px 0;border-bottom:1px solid var(--line)"><span>${emojiFor(x.name)} ${esc(x.name)}</span><span><input type="checkbox" data-av="${x.id}" ${x.available ? 'checked' : ''}> ${L('disponible', 'available')}</span></label>`).join('')}</div>`,
    onOpen: (d) => {
      d.querySelector('#q86').oninput = (e) => d.querySelectorAll('[data-n]').forEach((r) => { r.hidden = !r.dataset.n.includes(e.target.value.toLowerCase()); });
      d.querySelectorAll('[data-av]').forEach((c) => c.onchange = () => api.post(`/api/resto/items/${c.dataset.av}/availability`, { available: c.checked }).then(() => toast(c.checked ? L('De nouveau disponible', 'Available again') : L('Marqué épuisé', 'Marked sold out'), 'ok')).catch(fail));
    } });
}

// ===================== Reservations and waitlist =====================
const RST = { waiting: ['warn', 'Liste d\'attente', 'Waitlist'], booked: ['info', 'Réservée', 'Booked'], confirmed: ['info', 'Confirmée', 'Confirmed'], arrived: ['warn', 'Arrivée', 'Arrived'], seated: ['ok', 'Installée', 'Seated'], done: ['', 'Terminée', 'Done'], no_show: ['bad', 'Absente', 'No-show'], cancelled: ['', 'Annulée', 'Cancelled'] };
const rPill = (s) => `<span class="pill ${RST[s]?.[0] || ''}">${esc(L(RST[s]?.[1] || s, RST[s]?.[2] || s))}</span>`;

async function resDialog(r = {}, waitlist = false) {
  const tables = M().tables;
  return dialog({ title: r.id ? `${L('Réservation', 'Booking')} ${r.number}` : waitlist ? L('Ajouter à la liste d\'attente', 'Add to waitlist') : L('Nouvelle réservation', 'New booking'), submit: L('Enregistrer', 'Save'),
    body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: r.name })}${field({ name: 'phone', label: L('Téléphone', 'Phone'), type: 'tel', value: r.phone })}
    ${waitlist ? '' : `${field({ name: 'date', label: 'Date', type: 'date', value: r.date || today(), required: true })}${field({ name: 'time', label: L('Heure', 'Time'), type: 'time', value: r.time || '20:00', required: true })}`}
    ${field({ name: 'covers', label: L('Personnes', 'Guests'), type: 'number', value: r.covers || 2, min: 1 })}
    ${field({ name: 'table_id', label: L('Table', 'Table'), type: 'select', value: r.table_id || '', options: [['', L('— auto / plus tard —', '— auto / later —')], ...tables.map((t) => [t.id, `${t.label} · ${t.seats} pl. · ${t.area_name}`])] })}
    ${field({ name: 'occasion', label: L('Occasion', 'Occasion'), value: r.occasion, list: 'occ' })}${field({ name: 'note', label: L('Note (allergies, préférence…)', 'Note (allergies, preference…)'), value: r.note })}</div>
    <datalist id="occ">${[L('Anniversaire', 'Birthday'), L('Repas d\'affaires', 'Business dinner'), L('Demande en mariage', 'Proposal'), L('Rendez-vous galant', 'Date night'), L('Famille', 'Family')].map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`,
    onSubmit: (x) => { const b = { ...x, covers: Number(x.covers), table_id: Number(x.table_id) || null, waitlist }; return r.id ? api.put(`/api/resto/reservations/${r.id}`, b) : api.post('/api/resto/reservations', b); } });
}

R('/resto/reservations', async (ctx) => {
  const day = ctx.query.d || today();
  const go = (d) => { location.hash = '/resto/reservations?d=' + d; };
  ctx.title(L('Réservations et liste d\'attente', 'Bookings & waitlist'));
  const svc = canAny('service', 'pos');
  ctx.actions(`<button class="btn" id="prev">‹</button><input type="date" class="in" id="day" value="${day}"><button class="btn" id="next">›</button>${svc ? `<button class="btn" id="wl">${icon('users')}<span class="hide-m">${L('Attente', 'Waitlist')}</span></button><button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Réserver', 'Book')}</span></button>` : ''}`);
  const [rows, fc] = await Promise.all([api.get(`/api/resto/reservations?date=${day}`, { cache: false }), api.get('/api/resto/reports/forecast?days=7').catch(() => null)]);
  const live = rows.filter((r) => !['cancelled', 'no_show'].includes(r.status));
  const waiting = rows.filter((r) => r.status === 'waiting');
  const booked = rows.filter((r) => r.status !== 'waiting');
  const covers = live.reduce((t, r) => t + r.covers, 0);
  const f = fc?.days.find((x) => x.date === day);
  const byHour = {};
  for (const r of live) { const h = r.time.slice(0, 2); byHour[h] = (byHour[h] || 0) + r.covers; }
  const maxH = Math.max(1, ...Object.values(byHour));
  ctx.el.innerHTML = `<p class="muted" style="margin-top:0;text-transform:capitalize">${esc(dayName(day))}</p>
  <div class="grid g4">${kpi(L('Réservations', 'Bookings'), booked.filter((r) => !['cancelled', 'no_show'].includes(r.status)).length, `${covers} ${L('couverts attendus', 'expected covers')}`)}
    ${kpi(L('Liste d\'attente', 'Waitlist'), waiting.length, waiting.length ? `${L('la plus ancienne', 'oldest')} ${ago(waiting[0].created_at)}` : '—', waiting.length ? 'warn' : '')}
    ${kpi(L('Prévision', 'Forecast'), f ? `~${f.covers}` : '—', f ? `${L('couverts', 'covers')} · ${money(f.revenue)}` : '', 'accent')}
    ${kpi(L('Absences', 'No-shows'), rows.filter((r) => r.status === 'no_show').length, L('marquées automatiquement après 30 min', 'auto-marked after 30 min'))}</div>
  <div class="grid g3" style="margin-top:16px;grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
    <div><div class="tl">${booked.map((r) => `<div class="tl-it ${r.status}"><span class="tm">${esc(r.time)}</span>
      <span><b>${esc(r.name)}</b> ${r.vip ? '<span class="pill vip">VIP</span>' : ''} ${rPill(r.status)}<div class="muted sm">${r.covers} pers.${r.table_label ? ` · table ${esc(r.table_label)}` : ''}${r.phone ? ` · ${esc(r.phone)}` : ''}${r.source && r.source !== 'staff' ? ` · ${esc(r.source === 'online' ? L('en ligne', 'online') : r.source)}` : ''}${r.visits ? ` · ${r.visits} ${L('visites', 'visits')}` : ''}</div>
      ${r.occasion || r.note || r.allergies ? `<div class="sm">${r.occasion ? `🎉 ${esc(r.occasion)} ` : ''}${r.note ? esc(r.note) : ''}${r.allergies ? ` <span style="color:var(--bad)">⚠ ${esc(r.allergies)}</span>` : ''}</div>` : ''}</span>
      <span class="row" style="flex-wrap:wrap;justify-content:flex-end">${svc ? actions(r) : ''}</span></div>`).join('') || `<div class="card empty"><b>${L('Aucune réservation ce jour', 'No bookings that day')}</b><p class="muted">${L('Vos clients peuvent réserver eux-mêmes en ligne :', 'Guests can book online themselves:')} <a href="/reserve" target="_blank">${esc(M().public_url)}/reserve</a></p></div>`}</div></div>
    <div><div class="card"><h3>${L('Liste d\'attente', 'Waitlist')} <span class="pill">${waiting.length}</span></h3>${waiting.map((r) => `<div class="wl"><b>${esc(r.name)}</b> · ${r.covers} pers.<div class="muted sm">${L('attend depuis', 'waiting')} ${ago(r.created_at)}${r.phone ? ` · ${esc(r.phone)}` : ''}</div><div class="row" style="flex-wrap:wrap;margin-top:6px">${svc ? actions(r) : ''}</div></div>`).join('') || `<p class="muted sm">${L('Personne n\'attend.', 'Nobody waiting.')}</p>`}</div>
      <div class="card" style="margin-top:12px"><h3>${L('Couverts par heure', 'Covers by hour')}</h3>${Object.keys(byHour).sort().map((h) => `<div class="ad"><span>${h} h</span><span style="flex:1;margin:0 10px;align-self:center"><i style="display:block;height:8px;border-radius:9px;background:var(--blue);width:${(byHour[h] / maxH) * 100}%"></i></span><b>${byHour[h]}</b></div>`).join('') || '<p class="muted sm">—</p>'}</div></div>
  </div>`;
  function actions(r) {
    const msg = `${state.me.company.name} : ${L('bonjour', 'hello')} ${r.name}, ${r.status === 'waiting' ? L('votre table est prête ! Présentez-vous à l\'accueil.', 'your table is ready! Please come to the host stand.') : `${L('nous vous confirmons votre table pour', 'we confirm your table for')} ${r.covers} ${L('le', 'on')} ${dt(r.date)} ${L('à', 'at')} ${r.time}.`}`;
    const b = [];
    if (['waiting', 'booked', 'confirmed', 'arrived'].includes(r.status)) b.push(`<button class="btn sm primary" data-seat="${r.id}">${L('Installer', 'Seat')}</button>`);
    if (r.status === 'booked') b.push(`<button class="btn sm" data-st="confirmed" data-id="${r.id}">${L('Confirmée', 'Confirmed')}</button>`);
    if (['booked', 'confirmed'].includes(r.status)) b.push(`<button class="btn sm" data-st="arrived" data-id="${r.id}">${L('Arrivée', 'Arrived')}</button>`);
    if (r.status === 'seated' && r.order_id) b.push(`<a class="btn sm" href="#/resto/order/${r.order_id}">${L('Addition', 'Check')}</a>`);
    if (r.phone) b.push(`<a class="btn sm" target="_blank" href="${wa(r.phone, msg)}">WhatsApp</a>`);
    if (['waiting', 'booked', 'confirmed'].includes(r.status)) b.push(`<button class="btn sm" data-edit="${r.id}">${icon('edit')}</button><button class="btn sm" data-st="${r.status === 'waiting' ? 'cancelled' : 'no_show'}" data-id="${r.id}" title="${r.status === 'waiting' ? L('Retirer', 'Remove') : L('Absent', 'No-show')}">${icon('x')}</button>`);
    return b.join('');
  }
  const put = (id, body) => api.put(`/api/resto/reservations/${id}`, body).then((x) => { ctx.rerender(); return x; });
  ctx.el.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => put(b.dataset.id, { status: b.dataset.st }).catch(fail));
  ctx.el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => resDialog(rows.find((r) => r.id === Number(b.dataset.edit)), false).then((v) => v && ctx.rerender()).catch(fail));
  ctx.el.querySelectorAll('[data-seat]').forEach((b) => b.onclick = async () => {
    const r = rows.find((x) => x.id === Number(b.dataset.seat));
    const free = await api.get(`/api/resto/free-tables?date=${today()}&time=${new Date().toTimeString().slice(0, 5)}&covers=${r.covers}&except=${r.id}`, { cache: false });
    const fl = await api.get('/api/resto/floor', { cache: false });
    const busy = new Set(fl.tables.filter((t) => t.orders.length).map((t) => t.id));
    const opts = free.filter((t) => !busy.has(t.id));
    const v = await dialog({ title: `${L('Installer', 'Seat')} ${r.name} · ${r.covers} pers.`, submit: L('Installer et ouvrir l\'addition', 'Seat & open check'),
      body: field({ name: 'table_id', label: L('Table libre', 'Free table'), type: 'select', value: r.table_id && !busy.has(r.table_id) ? r.table_id : opts[0]?.id, options: (opts.length ? opts : fl.tables.filter((t) => !busy.has(t.id))).map((t) => [t.id, `${t.label} · ${t.seats} pl. · ${t.area_name}`]) }),
      onSubmit: (x) => api.put(`/api/resto/reservations/${r.id}`, { status: 'seated', table_id: Number(x.table_id) }) }).catch(fail);
    if (v?.order_id) location.hash = `#/resto/order/${v.order_id}`; else if (v) ctx.rerender();
  });
  document.getElementById('prev').onclick = () => go(addDays(day, -1));
  document.getElementById('next').onclick = () => go(addDays(day, 1));
  document.getElementById('day').onchange = (e) => go(e.target.value);
  document.getElementById('new')?.addEventListener('click', () => resDialog({ date: day }).then((v) => v && ctx.rerender()).catch(fail));
  document.getElementById('wl')?.addEventListener('click', () => resDialog({}, true).then((v) => v && ctx.rerender()).catch(fail));
}, true);

// ===================== Cash drawer =====================
R('/resto/cash', async (ctx) => {
  ctx.title(L('Ma caisse', 'My cash drawer'));
  const [cur, list] = await Promise.all([api.get('/api/resto/sessions/current', { cache: false }), api.get('/api/resto/sessions', { cache: false })]);
  ctx.actions(`${canAny('reports', 'service', 'pos') ? `<a class="btn" target="_blank" href="/api/resto/reports/z?format=html&print=1">${icon('print')}<span class="hide-m">${L('Rapport Z du jour', "Today's Z report")}</span></a>` : ''}`);
  const s = cur.session;
  ctx.el.innerHTML = `${s ? `<div class="grid g4">
      ${kpi(L('Espèces attendues', 'Expected cash'), money(cur.cash.expected), `${L('fond', 'float')} ${money(cur.cash.opening)} + ${L('ventes', 'sales')} ${money(cur.cash.sales)} + ${L('pourboires', 'tips')} ${money(cur.cash.tips)}`, 'accent')}
      ${kpi(L('Additions encaissées', 'Checks paid'), cur.checks.n, money(cur.checks.total))}
      ${kpi(L('Pourboires', 'Tips'), money(cur.tips), L('tous moyens confondus', 'all methods'))}
      ${kpi(L('Entrées / sorties', 'Paid in / out'), `${money(cur.cash.in)} / ${money(cur.cash.out)}`, `${L('ouverte à', 'opened at')} ${hm(s.opened_at)}`)}</div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${L('Par moyen de paiement', 'By payment method')}</h3>
      ${table({ rows: cur.byMethod, columns: [{ label: L('Moyen', 'Method'), render: (m) => esc(payName(m.method)) }, { label: L('Paiements', 'Payments'), key: 'n', cls: 'r' }, { label: L('Montant', 'Amount'), cls: 'r', render: (m) => money(m.amount) }, { label: L('Pourboires', 'Tips'), cls: 'r', render: (m) => money(m.tips) }], empty: L('Aucun paiement encore', 'No payment yet') })}</div>
      <div class="card"><h3>${s.number}</h3><p class="muted">${L('Enregistrez chaque sortie (achat au marché, pourboires reversés) pour que votre caisse tombe juste.', 'Record every paid-out (market purchase, tips handed out) so your drawer balances.')}</p>
        <div class="row"><button class="btn" id="in">${icon('plus')} ${L('Entrée', 'Paid in')}</button><button class="btn" id="out">${icon('minus')} ${L('Sortie', 'Paid out')}</button><button class="btn primary" id="close">${icon('lock')} ${L('Clôturer ma caisse', 'Close my drawer')}</button></div></div></div>`
  : `<div class="card empty"><b>${L('Votre caisse est fermée', 'Your drawer is closed')}</b><p class="muted">${L('Ouvrez-la avec votre fond de caisse pour encaisser en espèces.', 'Open it with your float to take cash.')}</p><button class="btn primary" id="open">${icon('cash')} ${L('Ouvrir ma caisse', 'Open my drawer')}</button></div>`}
  <h3 style="margin-top:20px">${L('Historique des caisses', 'Drawer history')}</h3>
  ${table({ rows: list, columns: [{ label: 'N°', render: (x) => `<b>${esc(x.number)}</b>` }, { label: L('Serveur / caissier', 'Staff'), key: 'user_name' }, { label: L('Ouverture', 'Opened'), render: (x) => `${dt(x.opened_at)} ${hm(x.opened_at)}` },
    { label: L('Fermeture', 'Closed'), hideM: true, render: (x) => (x.closed_at ? hm(x.closed_at) : `<span class="pill ok">${L('ouverte', 'open')}</span>`) }, { label: L('Attendu', 'Expected'), cls: 'r', hideM: true, render: (x) => (x.expected_cash != null ? money(x.expected_cash) : '') },
    { label: L('Compté', 'Counted'), cls: 'r', render: (x) => (x.counted_cash != null ? money(x.counted_cash) : '') }, { label: L('Écart', 'Variance'), cls: 'r', render: (x) => (x.variance ? `<b style="color:${x.variance < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(x.variance)}</b>` : x.status === 'closed' ? '✓' : '') }] })}`;
  document.getElementById('open')?.addEventListener('click', async () => {
    const v = await dialog({ title: L('Ouvrir ma caisse', 'Open my drawer'), body: field({ name: 'opening_float', label: L('Fond de caisse (FCFA)', 'Float (FCFA)'), type: 'number', value: 20000, min: 0 }), onSubmit: (x) => api.post('/api/resto/sessions', { opening_float: Number(x.opening_float) }) }).catch(fail);
    if (v) { await refreshMeta(); ctx.rerender(); }
  });
  const move = (kind) => dialog({ title: kind === 'in' ? L('Entrée d\'espèces', 'Paid in') : L('Sortie d\'espèces', 'Paid out'), body: `<div class="f2">${field({ name: 'amount', label: L('Montant', 'Amount'), type: 'number', min: 1, required: true })}${field({ name: 'reason', label: L('Motif', 'Reason'), required: true, list: 'rs', placeholder: kind === 'out' ? L('Achat marché, pourboires reversés…', 'Market, tips handed out…') : '' })}</div><datalist id="rs">${(kind === 'out' ? [L('Achat au marché', 'Market purchase'), L('Pourboires reversés au personnel', 'Tips handed to staff'), L('Gaz', 'Gas'), L('Transport', 'Transport')] : [L('Complément de fond', 'Float top-up')]).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`,
    onSubmit: (x) => api.post('/api/resto/cash-moves', { kind, amount: Number(x.amount), reason: x.reason }) }).then((v) => v && ctx.rerender()).catch(fail);
  document.getElementById('in')?.addEventListener('click', () => move('in'));
  document.getElementById('out')?.addEventListener('click', () => move('out'));
  document.getElementById('close')?.addEventListener('click', async () => {
    const den = [10000, 5000, 2000, 1000, 500, 100, 50, 25];
    const v = await dialog({ title: L('Clôturer ma caisse', 'Close my drawer'), submit: L('Clôturer', 'Close'), wide: true,
      body: `<p class="muted" style="margin-top:0">${L('Comptez vos espèces billet par billet. Teknons calcule l\'écart et le passe en comptabilité.', 'Count your cash note by note. Teknons works out the variance and posts it to the books.')}</p>
      <div class="f3">${den.map((d) => field({ name: 'd' + d, label: `${num(d)} F`, type: 'number', min: 0, placeholder: '0' })).join('')}</div>
      <div class="pay-total">${L('Total compté', 'Counted')} <b id="ct">0 F</b> · ${L('attendu', 'expected')} ${money(cur.cash.expected)} · <span id="vr"></span></div>
      ${field({ name: 'note', label: L('Commentaire', 'Note') })}`,
      onOpen: (d) => { const f = d.querySelector('form'); const upd = () => { const t = den.reduce((s2, x) => s2 + (Number(f['d' + x].value) || 0) * x, 0); d.querySelector('#ct').textContent = money(t); const va = t - cur.cash.expected; d.querySelector('#vr').innerHTML = va ? `<b style="color:${va < 0 ? 'var(--bad)' : 'var(--ok)'}">${L('écart', 'variance')} ${money(va)}</b>` : `<b style="color:var(--ok)">${L('juste', 'balanced')} ✓</b>`; }; f.addEventListener('input', upd); upd(); },
      onSubmit: async (x) => {
        const counted = den.reduce((t, d) => t + (Number(x['d' + d]) || 0) * d, 0);
        try { return await api.post(`/api/resto/sessions/${s.id}/close`, { counted_cash: counted, note: x.note }); } catch (e) {
          if (e.status === 409 && /ouverte/.test(e.message) && confirm(`${e.message}\n\n${L('Clôturer quand même ?', 'Close anyway?')}`)) return api.post(`/api/resto/sessions/${s.id}/close`, { counted_cash: counted, note: x.note, force: true });
          throw e;
        }
      } }).catch(fail);
    if (v) { toast(L('Caisse clôturée', 'Drawer closed'), 'ok'); await refreshMeta(); ctx.rerender(); }
  });
}, true);

// ===================== Menu and recipes =====================
const optsToText = (opts) => (opts || []).map((g) => `${g.group}${g.required ? '*' : ''}${g.multi ? '+' : ''}: ${g.choices.map((c) => `${c.name}${c.price ? ` +${c.price}` : ''}`).join(', ')}`).join('\n');
const textToOpts = (t) => String(t || '').split('\n').map((l) => l.trim()).filter((l) => l.includes(':')).map((l) => {
  const [head, ...rest] = l.split(':'); const h = head.trim();
  return { group: h.replace(/[*+]+$/, '').trim(), required: /\*/.test(h), multi: /\+$|\+\*|\*\+/.test(h),
    choices: rest.join(':').split(',').map((c) => c.trim()).filter(Boolean).map((c) => { const m = c.match(/^(.*?)\s*\+\s*(\d[\d\s]*)$/); return m ? { name: m[1].trim(), price: Number(m[2].replace(/\s/g, '')) } : { name: c, price: 0 }; }) };
});

R('/resto/menu', async (ctx) => {
  ctx.title(L('Carte et recettes', 'Menu & recipes'));
  const edit = can('settings');
  if (edit) ctx.actions(`<button class="btn" id="e86">${L('Ruptures (86)', 'Sold out (86)')}</button><button class="btn" id="nc">${icon('plus')}<span class="hide-m">${L('Famille', 'Category')}</span></button><button class="btn primary" id="ni">${icon('plus')}<span class="hide-m">${L('Plat ou boisson', 'Dish or drink')}</span></button>`);
  else if (canAny('service', 'kitchen')) ctx.actions(`<button class="btn" id="e86">${L('Ruptures (86)', 'Sold out (86)')}</button>`);
  const [m, me] = await Promise.all([api.get('/api/resto/menu?all=1', { cache: false }), can('reports') ? api.get('/api/resto/reports/menu').catch(() => null) : null]);
  const cls = Object.fromEntries((me?.items || []).map((x) => [x.id, x]));
  const CL = { star: ['⭐', 'Star', 'Star'], plowhorse: ['🐴', 'Populaire, peu rentable', 'Plowhorse'], puzzle: ['🧩', 'Rentable, peu vendu', 'Puzzle'], dog: ['⚠', 'À revoir', 'Dog'] };
  const cat = ctx.query.cat || 'all';
  const items = m.items.filter((x) => cat === 'all' || String(x.category_id) === cat);
  ctx.el.innerHTML = `<div class="tabs" style="margin-bottom:12px;flex-wrap:wrap"><a href="#/resto/menu" class="${cat === 'all' ? 'on' : ''}">${L('Tout', 'All')} <b>${m.items.length}</b></a>${m.categories.map((c) => `<a href="#/resto/menu?cat=${c.id}" class="${String(c.id) === cat ? 'on' : ''}">${esc(c.name)} <b>${m.items.filter((x) => x.category_id === c.id).length}</b></a>`).join('')}</div>
  ${cat !== 'all' && edit ? (() => { const c = m.categories.find((x) => String(x.id) === cat); return c ? `<div class="card row between" style="margin-bottom:12px;padding:12px 14px"><span><b>${esc(c.name)}</b> <span class="muted sm">· ${esc(c.station_name || L('aucun poste', 'no station'))} · ${esc(courseName(c.course))}${c.drinks ? ` · ${L('boissons', 'drinks')}` : ''}${c.active ? '' : ` · <span class="pill">${L('masquée', 'hidden')}</span>`}</span></span><button class="btn sm" data-ec="${c.id}">${icon('edit')} ${L('Modifier la famille', 'Edit category')}</button></div>` : ''; })() : ''}
  ${table({ rows: items, columns: [
    { label: L('Plat', 'Item'), render: (x) => `<span style="font-size:20px;margin-right:6px">${emojiFor(x.name, m.categories.find((c) => c.id === x.category_id)?.name)}</span><b>${esc(x.name)}</b>${x.active === 0 ? ` <span class="pill">${L('masqué', 'hidden')}</span>` : ''}${x.sold_out ? ` <span class="pill bad">${L('épuisé', 'sold out')}</span>` : ''}<div class="muted sm">${esc(x.tags || '')}${x.allergens ? ` · ⚠ ${esc(x.allergens)}` : ''}${x.options.length ? ` · ${x.options.length} ${L('option(s)', 'option group(s)')}` : ''}</div>` },
    { label: L('Prix TTC', 'Price'), cls: 'r', render: (x) => `<b class="num">${money(x.price)}</b>` },
    { label: L('Coût matière', 'Food cost'), cls: 'r', hideM: true, render: (x) => (x.food_cost ? `${money(x.food_cost)} <span class="muted sm">(${dec(x.food_cost_pct)} %)</span>` : `<span class="muted sm">${L('pas de recette', 'no recipe')}</span>`) },
    { label: L('Ventes 30 j', '30-day sales'), cls: 'r', hideM: true, render: (x) => (cls[x.id] ? `${num(cls[x.id].qty)} <span title="${esc(L(CL[cls[x.id].class]?.[1], CL[cls[x.id].class]?.[2]))}">${CL[cls[x.id].class]?.[0] || ''}</span>` : '—') },
    { label: L('Dispo', 'Avail.'), cls: 'r', render: (x) => `<label class="switch"><input type="checkbox" data-av="${x.id}" ${x.available ? 'checked' : ''} ${canAny('service', 'kitchen', 'settings') ? '' : 'disabled'}><span></span></label>` },
    ...(edit ? [{ label: '', cls: 'r', render: (x) => `<button class="btn sm" data-ei="${x.id}">${icon('edit')}</button>` }] : [])],
  empty: `<b>${L('Aucun plat dans cette famille', 'No item in this category')}</b>` })}`;
  ctx.el.querySelectorAll('[data-av]').forEach((c) => c.onchange = () => api.post(`/api/resto/items/${c.dataset.av}/availability`, { available: c.checked }).then(() => toast(c.checked ? L('Disponible', 'Available') : L('Épuisé (86)', 'Sold out (86)'), 'ok')).catch(fail));
  ctx.el.querySelectorAll('[data-ei]').forEach((b) => b.onclick = () => itemDialog(m, Number(b.dataset.ei)).then((v) => v && ctx.rerender()).catch(fail));
  ctx.el.querySelectorAll('[data-ec]').forEach((b) => b.onclick = () => catDialog(m.categories.find((c) => c.id === Number(b.dataset.ec))).then((v) => v && ctx.rerender()).catch(fail));
  document.getElementById('ni')?.addEventListener('click', () => itemDialog(m, null, cat !== 'all' ? Number(cat) : null).then((v) => v && ctx.rerender()).catch(fail));
  document.getElementById('nc')?.addEventListener('click', () => catDialog().then((v) => v && ctx.rerender()).catch(fail));
  document.getElementById('e86')?.addEventListener('click', () => soldOut().then(() => ctx.rerender()).catch(fail));
}, true);

function catDialog(c = {}) {
  return dialog({ title: c.id ? c.name : L('Nouvelle famille', 'New category'),
    body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: c.name })}${field({ name: 'name_en', label: L('Nom en anglais', 'English name'), value: c.name_en })}
    ${field({ name: 'station_id', label: L('Poste de préparation', 'Prep station'), type: 'select', value: c.station_id || '', options: [['', L('— aucun (pas de bon) —', '— none (no ticket) —')], ...M().stations.map((s) => [s.id, s.name])] })}
    ${field({ name: 'course', label: L('Envoi par défaut', 'Default course'), type: 'select', value: c.course ?? 2, options: [0, 1, 2, 3, 4].map((x) => [x, courseName(x)]) })}
    ${field({ name: 'position', label: L('Ordre d\'affichage', 'Display order'), type: 'number', value: c.position || 0 })}<div>${field({ name: 'drinks', label: L('Boissons (happy hour, TVA boissons)', 'Drinks (happy hour, drinks VAT)'), type: 'checkbox', value: c.drinks })}${field({ name: 'active', label: L('Visible', 'Visible'), type: 'checkbox', value: c.id ? c.active : 1 })}</div></div>`,
    onSubmit: (x) => { const b = { ...x, station_id: Number(x.station_id) || null, course: Number(x.course), position: Number(x.position) || 0 }; return c.id ? api.put(`/api/resto/categories/${c.id}`, b) : api.post('/api/resto/categories', b); } });
}

async function itemDialog(m, id, catId) {
  const [it, ings] = await Promise.all([id ? api.get(`/api/resto/items/${id}`, { cache: false }) : {}, api.get('/api/resto/ingredients', { cache: false })]);
  let recipe = (it.recipe || []).map((r) => ({ ...r }));
  const al = M().allergens || [];
  const drawRecipe = (d) => {
    const box = d.querySelector('#rcp');
    const cost = recipe.reduce((t, r) => t + (Number(r.qty) || 0) * (ings.find((g) => g.id === Number(r.ingredient_id))?.cost || 0), 0);
    const price = Number(d.querySelector('[name=price]').value) || 0;
    const net = price / 1.1925;
    box.innerHTML = `${recipe.map((r, i) => `<div class="row" style="flex-wrap:nowrap;margin-bottom:6px"><select class="in" data-ri="${i}" style="flex:1">${ings.map((g) => `<option value="${g.id}" ${g.id === Number(r.ingredient_id) ? 'selected' : ''}>${esc(g.name)} (${esc(g.unit)})</option>`).join('')}</select><input class="in num" type="number" step="0.001" min="0" data-rq="${i}" value="${r.qty}" style="width:90px"><button type="button" class="btn sm" data-rx="${i}">${icon('x')}</button></div>`).join('')}
      <div class="row between"><button type="button" class="btn sm" id="ra" ${ings.length ? '' : 'disabled'}>${icon('plus')} ${L('Ingrédient', 'Ingredient')}</button><span class="sm">${L('Coût portion', 'Plate cost')} <b>${money(cost)}</b>${price ? ` · <b style="color:${cost / net > 0.35 ? 'var(--bad)' : 'var(--ok)'}">${dec(net ? (cost / net) * 100 : 0)} %</b> ${L('du prix HT', 'of net price')} · ${L('marge', 'margin')} <b>${money(net - cost)}</b>` : ''}</span></div>`;
    box.querySelectorAll('[data-ri]').forEach((s) => s.onchange = () => { recipe[s.dataset.ri].ingredient_id = Number(s.value); drawRecipe(d); });
    box.querySelectorAll('[data-rq]').forEach((s) => s.onchange = () => { recipe[s.dataset.rq].qty = Number(s.value); drawRecipe(d); });
    box.querySelectorAll('[data-rx]').forEach((s) => s.onclick = () => { recipe.splice(Number(s.dataset.rx), 1); drawRecipe(d); });
    box.querySelector('#ra').onclick = () => { recipe.push({ ingredient_id: ings[0].id, qty: 0.1 }); drawRecipe(d); };
  };
  return dialog({ title: id ? it.name : L('Nouveau plat ou boisson', 'New dish or drink'), wide: true,
    body: `<div class="f3">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: it.name })}${field({ name: 'name_en', label: L('Nom en anglais', 'English name'), value: it.name_en })}
    ${field({ name: 'category_id', label: L('Famille', 'Category'), type: 'select', value: it.category_id || catId || m.categories[0]?.id, options: m.categories.map((c) => [c.id, c.name]) })}
    ${field({ name: 'price', label: L('Prix TTC (FCFA)', 'Price incl. VAT'), type: 'number', min: 0, required: true, value: it.price })}${field({ name: 'prep_min', label: L('Temps de préparation (min)', 'Prep time (min)'), type: 'number', min: 0, value: it.prep_min || '' })}
    ${field({ name: 'daily_limit', label: L('Portions max par jour', 'Max portions a day'), type: 'number', min: 0, value: it.daily_limit || '', hint: L('0 = illimité', '0 = unlimited') })}</div>
    ${field({ name: 'description', label: L('Description (menu QR et en ligne)', 'Description (QR and online menu)'), type: 'textarea', value: it.description })}
    <div class="f2">${field({ name: 'tags', label: L('Étiquettes', 'Tags'), value: it.tags, placeholder: L('Signature, Épicé, Végétarien', 'Signature, Spicy, Vegetarian') })}${field({ name: 'image', label: L('Photo (lien)', 'Photo (URL)'), value: it.image, placeholder: 'https://…' })}</div>
    <label class="fld">${L('Allergènes', 'Allergens')}<div class="pay-m" style="margin-top:6px">${al.map((a) => `<label class="pm"><input type="checkbox" name="al_${esc(a)}" ${String(it.allergens || '').split(',').map((s) => s.trim()).includes(a) ? 'checked' : ''}><span>${esc(a)}</span></label>`).join('')}</div></label>
    ${field({ name: 'options', label: L('Options et suppléments', 'Options & add-ons'), type: 'textarea', value: optsToText(it.options), placeholder: L('Cuisson*: Saignant, À point, Bien cuit\nAccompagnement*: Frites, Plantain mûr, Miondo +300\nSuppléments+: Œuf +300, Fromage +500', 'Doneness*: Rare, Medium, Well done\nSide*: Fries, Ripe plantain, Miondo +300\nExtras+: Egg +300, Cheese +500'), hint: L('Une ligne par groupe. * = obligatoire, + = plusieurs choix, « +500 » = supplément payant.', 'One line per group. * = required, + = several choices, "+500" = paid extra.') })}
    <h4 style="margin:14px 0 6px">${L('Fiche technique (déduite du stock à chaque envoi en cuisine)', 'Recipe (taken from stock each time it is sent)')}</h4><div id="rcp"></div>
    <div class="row" style="margin-top:10px">${field({ name: 'qr', label: L('Sur le menu QR', 'On QR menu'), type: 'checkbox', value: id ? it.qr : 1 })}${field({ name: 'online', label: L('Commande en ligne', 'Online ordering'), type: 'checkbox', value: id ? it.online : 1 })}${field({ name: 'active', label: L('Actif', 'Active'), type: 'checkbox', value: id ? it.active : 1 })}</div>`,
    onOpen: (d) => { drawRecipe(d); d.querySelector('[name=price]').addEventListener('input', () => drawRecipe(d)); },
    onSubmit: (x) => {
      const body = { name: x.name, name_en: x.name_en, category_id: Number(x.category_id), price: Number(x.price), prep_min: Number(x.prep_min) || 0, daily_limit: Number(x.daily_limit) || 0, description: x.description, tags: x.tags, image: x.image,
        allergens: al.filter((a) => x['al_' + a]).join(', '), options: textToOpts(x.options), qr: x.qr, online: x.online, active: x.active, recipe: recipe.filter((r) => Number(r.qty) > 0).map((r) => ({ ingredient_id: Number(r.ingredient_id), qty: Number(r.qty) })) };
      return id ? api.put(`/api/resto/items/${id}`, body) : api.post('/api/resto/items', body);
    } });
}

// ===================== Stock and purchasing =====================
R('/resto/stock', async (ctx) => {
  ctx.title(L('Stock et achats', 'Stock & purchasing'));
  const tab = ctx.query.tab || 'stock';
  const sp = canAny('stock', 'purchases');
  ctx.actions(`${canAny('stock', 'purchases', 'kitchen') ? `<button class="btn" id="waste">${icon('trash')}<span class="hide-m">${L('Perte', 'Waste')}</span></button>` : ''}${sp ? `<button class="btn" id="cnt">${icon('list')}<span class="hide-m">${L('Inventaire', 'Count')}</span></button><button class="btn" id="ng">${icon('plus')}<span class="hide-m">${L('Ingrédient', 'Ingredient')}</span></button><button class="btn primary" id="rcv">${icon('truck')}<span class="hide-m">${L('Réception', 'Receive')}</span></button>` : ''}`);
  const [ings, plan, moves] = await Promise.all([api.get('/api/resto/ingredients', { cache: false }), tab === 'plan' ? api.get(`/api/resto/stock/plan?days=${ctx.query.days || 3}`) : null, tab === 'moves' ? api.get('/api/resto/stock/moves') : null]);
  const value = ings.reduce((t, g) => t + Math.max(0, g.stock) * g.cost, 0);
  const low = ings.filter((g) => g.min_stock > 0 && g.stock <= g.min_stock);
  const MK = { receipt: L('Réception', 'Received'), sale: L('Vente', 'Sale'), void: L('Annulation', 'Void'), waste: L('Perte', 'Waste'), staff_meal: L('Repas personnel', 'Staff meal'), adjust: L('Ajustement', 'Adjustment'), count: L('Inventaire', 'Count'), opening: L('Stock initial', 'Opening') };
  ctx.el.innerHTML = `<div class="grid g4">${kpi(L('Valeur du stock', 'Stock value'), money(value), `${ings.length} ${L('ingrédients', 'ingredients')}`, 'accent')}${kpi(L('Sous le minimum', 'Below minimum'), low.length, low.slice(0, 3).map((g) => g.name).join(', ') || '—', low.length ? 'warn' : '')}
    ${kpi(L('Consommé 7 jours', 'Used 7 days'), money(ings.reduce((t, g) => t + g.used_7d * g.cost, 0)), L('d\'après les recettes', 'from recipes'))}${kpi(L('À commander', 'To order'), plan ? money(plan.total) : '…', `<a href="#/resto/stock?tab=plan">${L('voir le plan d\'achat', 'see purchase plan')}</a>`)}</div>
  <div class="tabs" style="margin:16px 0 12px"><a href="#/resto/stock" class="${tab === 'stock' ? 'on' : ''}">${L('Ingrédients', 'Ingredients')}</a><a href="#/resto/stock?tab=plan" class="${tab === 'plan' ? 'on' : ''}">✦ ${L('Plan d\'achat intelligent', 'Smart purchase plan')}</a><a href="#/resto/stock?tab=moves" class="${tab === 'moves' ? 'on' : ''}">${L('Mouvements', 'Movements')}</a></div>
  ${tab === 'stock' ? table({ rows: ings, columns: [
    { label: L('Ingrédient', 'Ingredient'), render: (g) => `<b>${esc(g.name)}</b><div class="muted sm">${esc(g.category || '')}${g.supplier_name ? ` · ${esc(g.supplier_name)}` : ''} · ${g.dishes} ${L('plat(s)', 'dish(es)')}</div>` },
    { label: L('En stock', 'In stock'), cls: 'r', render: (g) => `<b style="color:${g.min_stock > 0 && g.stock <= g.min_stock ? 'var(--bad)' : 'inherit'}">${dec(g.stock, 2)} ${esc(g.unit)}</b>${g.min_stock ? `<div class="muted sm">min ${dec(g.min_stock, 2)}</div>` : ''}` },
    { label: L('Conso. 7 j', '7-day use'), cls: 'r', hideM: true, render: (g) => `${dec(g.used_7d, 2)} ${esc(g.unit)}<div class="muted sm">${g.used_7d > 0 ? `≈ ${dec(g.stock / (g.used_7d / 7), 0)} ${L('jours', 'days')}` : ''}</div>` },
    { label: L('Coût moyen', 'Avg cost'), cls: 'r', hideM: true, render: (g) => `${money(g.cost)} / ${esc(g.unit)}` },
    { label: L('Valeur', 'Value'), cls: 'r', render: (g) => money(Math.max(0, g.stock) * g.cost) },
    ...(sp ? [{ label: '', cls: 'r', render: (g) => `<button class="btn sm" data-eg="${g.id}">${icon('edit')}</button>` }] : [])], empty: `<b>${L('Aucun ingrédient', 'No ingredients yet')}</b><p class="muted">${L('Ajoutez vos ingrédients puis les fiches techniques dans Carte et recettes.', 'Add ingredients, then recipes in Menu & recipes.')}</p>` })
  : tab === 'plan' ? `<div class="card"><div class="row between"><span><span class="ai-tag">✦ Teknons Insight</span> <b>${L('Prévu', 'Forecast')} : ~${plan.covers} ${L('couverts sur', 'covers over')} ${plan.days} ${L('jours', 'days')}</b></span><span class="row">${[1, 2, 3, 7].map((dd) => `<a class="btn sm ${Number(plan.days) === dd ? 'primary' : ''}" href="#/resto/stock?tab=plan&days=${dd}">${dd} j</a>`).join('')}</span></div>
      <p class="muted sm">${L('Calculé à partir de votre consommation réelle par couvert (28 jours), de la prévision de fréquentation et des réservations, plus 15 % de sécurité et votre stock minimum.', 'Based on your real usage per cover (28 days), the covers forecast and bookings, plus 15 % safety and your minimum stock.')}</p></div>
    ${table({ rows: plan.lines, columns: [{ label: L('Fournisseur', 'Supplier'), render: (l) => esc(l.supplier_name || '—') }, { label: L('Ingrédient', 'Ingredient'), render: (l) => `<b>${esc(l.name)}</b>` }, { label: L('Stock', 'Stock'), cls: 'r', render: (l) => `${dec(l.stock, 2)} ${esc(l.unit)}` }, { label: L('Besoin', 'Need'), cls: 'r', hideM: true, render: (l) => `${dec(l.need, 1)} ${esc(l.unit)}` }, { label: L('À acheter', 'To buy'), cls: 'r', render: (l) => `<b>${dec(l.buy, 1)} ${esc(l.unit)}</b>` }, { label: L('Coût estimé', 'Est. cost'), cls: 'r', render: (l) => money(l.cost) }],
      empty: `<b>${L('Rien à commander', 'Nothing to order')}</b>`, foot: plan.lines.length ? `<tr><td colspan="5"><b>Total</b></td><td class="r"><b>${money(plan.total)}</b></td></tr>` : '' })}
    ${plan.lines.length ? `<div class="row" style="margin-top:12px">${[...new Set(plan.lines.map((l) => l.supplier_name || ''))].map((sn) => { const ls = plan.lines.filter((l) => (l.supplier_name || '') === sn); const ph = ls[0].supplier_phone; return ph ? `<a class="btn" target="_blank" href="${wa(ph, `${L('Bonjour, commande pour', 'Hello, order for')} ${state.me.company.name} :\n${ls.map((l) => `- ${l.name} : ${dec(l.buy, 1)} ${l.unit}`).join('\n')}\n${L('Merci !', 'Thanks!')}`)}">WhatsApp ${esc(sn)}</a>` : ''; }).join('')}</div>` : ''}`
  : table({ rows: moves, columns: [{ label: 'Date', render: (x) => `${dt(x.at)} ${hm(x.at)}` }, { label: L('Ingrédient', 'Ingredient'), render: (x) => `<b>${esc(x.name)}</b>` }, { label: L('Type', 'Type'), render: (x) => esc(MK[x.kind] || x.kind) }, { label: L('Quantité', 'Qty'), cls: 'r', render: (x) => `<b style="color:${x.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${x.qty > 0 ? '+' : ''}${dec(x.qty, 3)} ${esc(x.unit)}</b>` }, { label: L('Note', 'Note'), hideM: true, render: (x) => esc(x.note || x.ref || '') }, { label: L('Par', 'By'), hideM: true, render: (x) => esc(x.user_name || '') }] })}`;
  const ingOpts = ings.map((g) => [g.id, `${g.name} (${g.unit})`]);
  ctx.el.querySelectorAll('[data-eg]').forEach((b) => b.onclick = () => ingDialog(ings.find((g) => g.id === Number(b.dataset.eg))).then((v) => v && ctx.rerender()).catch(fail));
  document.getElementById('ng')?.addEventListener('click', () => ingDialog().then((v) => v && ctx.rerender()).catch(fail));
  document.getElementById('waste')?.addEventListener('click', () => dialog({ title: L('Perte ou repas du personnel', 'Waste or staff meal'), body: `<div class="f2">${field({ name: 'ingredient_id', label: L('Ingrédient', 'Ingredient'), type: 'select', options: ingOpts, span: true })}${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: [['waste', L('Perte / casse / périmé', 'Waste / spoiled')], ['staff_meal', L('Repas du personnel', 'Staff meal')]] })}${field({ name: 'qty', label: L('Quantité', 'Qty'), type: 'number', step: '0.001', min: 0, required: true })}${field({ name: 'note', label: L('Raison', 'Reason'), span: true, required: true })}</div>`,
    onSubmit: (x) => api.post('/api/resto/stock/adjust', { ingredient_id: Number(x.ingredient_id), kind: x.kind, qty: -Math.abs(Number(x.qty)), note: x.note }) }).then((v) => v && ctx.rerender()).catch(fail));
  document.getElementById('cnt')?.addEventListener('click', () => dialog({ title: L('Inventaire physique', 'Stock count'), wide: true, submit: L('Valider l\'inventaire', 'Post count'),
    body: `<p class="muted" style="margin-top:0">${L('Saisissez ce que vous comptez réellement. Les écarts sont enregistrés et valorisés.', 'Type what you actually count. Differences are recorded and valued.')}</p><div style="max-height:60vh;overflow:auto">${ings.map((g) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(g.name)} <span class="muted sm">(${L('théorique', 'book')} ${dec(g.stock, 2)} ${esc(g.unit)})</span></span><input class="in num" type="number" step="0.001" min="0" name="c${g.id}" style="width:110px" placeholder="${dec(g.stock, 2)}"></div>`).join('')}</div>`,
    onSubmit: (x) => api.post('/api/resto/stock/count', { counts: ings.filter((g) => x['c' + g.id] !== '').map((g) => ({ ingredient_id: g.id, counted: Number(x['c' + g.id]) })) }) }).then((v) => v && (toast(L('Inventaire enregistré', 'Count posted'), 'ok'), ctx.rerender())).catch(fail));
  document.getElementById('rcv')?.addEventListener('click', async () => {
    const sups = await api.get('/api/partners?kind=supplier').catch(() => []);
    const pre = plan?.lines || [];
    let n = Math.max(3, pre.length);
    const row = (i, l = {}) => `<div class="row" style="flex-wrap:nowrap;margin-bottom:6px"><select class="in" name="g${i}" style="flex:1"><option value="">—</option>${ings.map((g) => `<option value="${g.id}" ${g.id === l.ingredient_id ? 'selected' : ''}>${esc(g.name)} (${esc(g.unit)})</option>`).join('')}</select><input class="in num" type="number" step="0.001" min="0" name="q${i}" placeholder="${L('qté', 'qty')}" value="${l.buy || ''}" style="width:90px"><input class="in num" type="number" min="0" name="u${i}" placeholder="${L('prix unit.', 'unit cost')}" value="${l.ingredient_id ? ings.find((g) => g.id === l.ingredient_id)?.cost || '' : ''}" style="width:110px"></div>`;
    const v = await dialog({ title: L('Réception de marchandises', 'Goods received'), wide: true, submit: L('Entrer en stock', 'Receive'),
      body: `<div class="f2">${field({ name: 'supplier_id', label: L('Fournisseur', 'Supplier'), type: 'select', options: [['', '—'], ...sups.map((s2) => [s2.id, s2.name])] })}${field({ name: 'ref', label: L('N° bon / facture', 'Delivery note / invoice no.') })}</div>
      <div id="rl">${Array.from({ length: n }, (_, i) => row(i, pre[i])).join('')}</div><button type="button" class="btn sm" id="more">${icon('plus')} ${L('Ligne', 'Line')}</button>
      <div class="row" style="margin-top:10px">${field({ name: 'create_bill', label: L('Enregistrer la facture fournisseur dans Teknons Compta', 'Record the supplier bill in Teknons Compta'), type: 'checkbox', value: 1 })}</div>`,
      onOpen: (d) => { d.querySelector('#more').onclick = () => { d.querySelector('#rl').insertAdjacentHTML('beforeend', row(n++)); }; },
      onSubmit: (x) => api.post('/api/resto/stock/receive', { supplier_id: Number(x.supplier_id) || null, reference: x.ref, create_bill: x.create_bill && !!x.supplier_id,
        lines: Array.from({ length: n }, (_, i) => i).filter((i) => x['g' + i] && Number(x['q' + i]) > 0).map((i) => ({ ingredient_id: Number(x['g' + i]), qty: Number(x['q' + i]), unit_cost: x['u' + i] === '' ? undefined : Number(x['u' + i]) })) }) }).catch(fail);
    if (v) { toast(L('Stock mis à jour', 'Stock updated'), 'ok'); ctx.rerender(); }
  });
}, true);

async function ingDialog(g = {}) {
  const sups = await api.get('/api/partners?kind=supplier').catch(() => []);
  return dialog({ title: g.id ? g.name : L('Nouvel ingrédient', 'New ingredient'),
    body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: g.name })}${field({ name: 'category', label: L('Rayon', 'Category'), value: g.category, list: 'gcat' })}
    ${field({ name: 'unit', label: L('Unité', 'Unit'), type: 'select', value: g.unit || 'kg', options: ['kg', 'g', 'l', 'cl', 'u', 'btl', 'botte', 'sac'].map((u) => [u, u]) })}${field({ name: 'cost', label: L('Coût par unité (FCFA)', 'Cost per unit'), type: 'number', min: 0, step: '0.01', value: g.cost })}
    ${field({ name: 'min_stock', label: L('Stock minimum', 'Minimum stock'), type: 'number', step: '0.001', min: 0, value: g.min_stock })}${g.id ? '' : field({ name: 'stock', label: L('Stock de départ', 'Opening stock'), type: 'number', step: '0.001', min: 0 })}
    ${field({ name: 'supplier_id', label: L('Fournisseur habituel', 'Usual supplier'), type: 'select', value: g.supplier_id || '', options: [['', '—'], ...sups.map((s) => [s.id, s.name])] })}</div>
    <datalist id="gcat">${['Viandes', 'Poissons', 'Légumes', 'Épicerie', 'Boissons', 'Laitier'].map((c) => `<option value="${c}">`).join('')}</datalist>`,
    onSubmit: (x) => { const b = { ...x, supplier_id: Number(x.supplier_id) || null }; return g.id ? api.put(`/api/resto/ingredients/${g.id}`, b) : api.post('/api/resto/ingredients', b); } });
}

// ===================== Loyal guests =====================
R('/resto/customers', async (ctx) => {
  ctx.title(L('Clients fidèles', 'Loyal guests'));
  const q = ctx.query.q || '';
  if (canAny('service', 'pos')) ctx.actions(`<button class="btn primary" id="nc">${icon('plus')}<span class="hide-m">${L('Client', 'Guest')}</span></button>`);
  const rows = await api.get(`/api/resto/customers?q=${encodeURIComponent(q)}`, { cache: false });
  const lapsed = rows.filter((c) => c.visits >= 3 && c.last_visit && c.last_visit.slice(0, 10) < addDays(today(), -30));
  const bdays = rows.filter((c) => c.birthday && c.birthday.slice(5) >= today().slice(5) && c.birthday.slice(5) <= addDays(today(), 14).slice(5));
  ctx.el.innerHTML = `<div class="grid g4">${kpi(L('Clients', 'Guests'), rows.length, `${rows.filter((c) => c.vip).length} VIP`)}${kpi(L('Panier moyen par client', 'Avg spend per guest'), money(rows.length ? rows.reduce((t, c) => t + c.spent, 0) / Math.max(1, rows.reduce((t, c) => t + c.visits, 0)) : 0), L('par visite', 'per visit'))}
    ${kpi(L('Anniversaires (14 j)', 'Birthdays (14 d)'), bdays.length, bdays.slice(0, 3).map((c) => c.name).join(', ') || '—', bdays.length ? 'accent' : '')}${kpi(L('Habitués à relancer', 'Regulars to win back'), lapsed.length, L('3 visites et plus, absents 30 j', '3+ visits, away 30 days'), lapsed.length ? 'warn' : '')}</div>
  <div class="row" style="margin:16px 0 12px"><input class="in" type="search" id="q" value="${esc(q)}" placeholder="${L('Nom ou téléphone…', 'Name or phone…')}" style="flex:1;max-width:360px"></div>
  ${table({ rows, columns: [
    { label: L('Client', 'Guest'), render: (c) => `<b>${esc(c.name)}</b> ${c.vip ? '<span class="pill vip">VIP</span>' : ''}<div class="muted sm">${esc(c.phone || '')}${c.allergies ? ` · <span style="color:var(--bad)">⚠ ${esc(c.allergies)}</span>` : ''}${c.preferences ? ` · ${esc(c.preferences)}` : ''}</div>` },
    { label: L('Visites', 'Visits'), cls: 'r', key: 'visits' }, { label: L('Dépensé', 'Spent'), cls: 'r', render: (c) => money(c.spent) }, { label: 'Points', cls: 'r', hideM: true, render: (c) => num(c.points) },
    { label: L('Dernière visite', 'Last visit'), hideM: true, render: (c) => (c.last_visit ? dt(c.last_visit) : '—') },
    { label: '', cls: 'r', render: (c) => `${c.phone ? `<a class="btn sm" target="_blank" href="${wa(c.phone, `${state.me.company.name} : ${L('bonjour', 'hello')} ${c.name.split(' ')[0]} ! ${L('Vous nous manquez. Votre table vous attend, et vous avez', 'We miss you. Your table is waiting, and you have')} ${c.points} ${L('points fidélité. Réservez ici', 'loyalty points. Book here')} : ${M().public_url}/reserve`)}">WhatsApp</a>` : ''}<button class="btn sm" data-ec="${c.id}">${icon('edit')}</button>` }],
  empty: `<b>${L('Aucun client fidèle pour le moment', 'No loyal guests yet')}</b><p class="muted">${L('Ajoutez le téléphone du client sur l\'addition : il gagne des points à chaque visite.', 'Add the guest\'s phone to the check: they earn points on every visit.')}</p>` })}`;
  let t; ctx.el.querySelector('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = `/resto/customers?q=${encodeURIComponent(e.target.value)}`; }, 400); };
  const edit = (c = {}) => dialog({ title: c.id ? c.name : L('Nouveau client', 'New guest'), body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: c.name })}${field({ name: 'phone', label: L('Téléphone', 'Phone'), type: 'tel', value: c.phone })}${field({ name: 'birthday', label: L('Anniversaire', 'Birthday'), type: 'date', value: c.birthday })}${field({ name: 'allergies', label: L('Allergies', 'Allergies'), value: c.allergies })}${field({ name: 'preferences', label: L('Préférences (table, vin…)', 'Preferences (table, wine…)'), value: c.preferences, span: true })}${field({ name: 'vip', label: 'VIP', type: 'checkbox', value: c.vip })}</div>`,
    onSubmit: (x) => (c.id ? api.put(`/api/resto/customers/${c.id}`, x) : api.post('/api/resto/customers', x)) }).then((v) => v && ctx.rerender()).catch(fail);
  ctx.el.querySelectorAll('[data-ec]').forEach((b) => b.onclick = () => edit(rows.find((c) => c.id === Number(b.dataset.ec))));
  document.getElementById('nc')?.addEventListener('click', () => edit());
});

// ===================== Forecast and insights =====================
R('/resto/insights', async (ctx) => {
  ctx.title(L('Prévisions et conseils', 'Forecast & insights'));
  const [f, plan] = await Promise.all([api.get('/api/resto/reports/forecast?days=14', { cache: false }), api.get('/api/resto/stock/plan?days=2').catch(() => null)]);
  const max = Math.max(1, ...f.days.map((d) => d.covers));
  const wk = f.days.slice(0, 7);
  ctx.el.innerHTML = `<div class="card" style="background:linear-gradient(135deg,var(--navy),#6B2236);color:#fff;border:0"><span class="ai-tag" style="background:rgba(255,255,255,.14);color:#fff">✦ Teknons Insight</span>
    <h2 style="margin:10px 0 4px;color:#fff">${L('Les 7 prochains jours', 'The next 7 days')} : ~${wk.reduce((t, d) => t + d.covers, 0)} ${L('couverts', 'covers')} · ${money(wk.reduce((t, d) => t + d.revenue, 0))}</h2>
    <p style="opacity:.8;margin:0">${L('Prévision calculée sur vos 4 dernières semaines (même jour de la semaine, plus de poids aux semaines récentes), corrigée par les réservations déjà prises.', 'Forecast from your last 4 weeks (same weekday, recent weeks weigh more), adjusted for bookings already taken.')}</p></div>
  <div class="grid g2" style="margin-top:16px;grid-template-columns:minmax(0,3fr) minmax(0,2fr)">
    <div class="card"><h3>${L('Couverts prévus par jour', 'Forecast covers per day')}</h3><div class="fc-bars">${f.days.map((d) => `<div class="b" title="${esc(dayName(d.date))} : ~${d.covers} ${L('couverts', 'covers')}, ${d.booked} ${L('réservés', 'booked')}, ${money(d.revenue)}"><em>${d.covers}</em><div style="width:100%;flex:1;display:flex;flex-direction:column;justify-content:flex-end"><i style="height:${Math.max(3, ((d.covers - d.booked) / max) * 100)}%;border-radius:8px 8px 0 0"></i><i class="bk" style="height:${(d.booked / max) * 100}%;border-radius:0 0 3px 3px"></i></div><span>${new Date(d.date + 'T12:00:00Z').toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'short', timeZone: 'UTC' })} ${d.date.slice(8)}</span></div>`).join('')}</div>
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--navy)"></i>${L('Prévision', 'Forecast')}</span><span><i style="background:#C9A227"></i>${L('Déjà réservé', 'Already booked')}</span></div>
      ${table({ rows: wk, columns: [{ label: L('Jour', 'Day'), render: (d) => `<span style="text-transform:capitalize">${esc(dayName(d.date))}</span>` }, { label: L('Couverts', 'Covers'), cls: 'r', render: (d) => `<b>~${d.covers}</b>` }, { label: L('Réservés', 'Booked'), cls: 'r', render: (d) => `${d.booked} <span class="muted sm">(${d.reservations})</span>` }, { label: L('CA prévu', 'Revenue'), cls: 'r', render: (d) => money(d.revenue) }, { label: L('Fiabilité', 'Confidence'), hideM: true, render: (d) => `<span class="pill ${d.confidence === 'high' ? 'ok' : d.confidence === 'medium' ? 'info' : ''}">${esc({ high: L('élevée', 'high'), medium: L('moyenne', 'medium'), low: L('faible', 'low') }[d.confidence] || d.confidence)}</span>` }] })}</div>
    <div><div class="card"><h3>${L('Ce que Teknons a remarqué', 'What Teknons noticed')}</h3><div class="rs-ins" style="grid-template-columns:1fr">${f.insights.map((i) => `<div class="ins ${i.level}"><b>${esc(i.title)}</b><p>${esc(i.body)}</p></div>`).join('') || `<p class="muted">${L('Pas assez d\'historique pour l\'instant : revenez après quelques jours de service.', 'Not enough history yet: come back after a few days of service.')}</p>`}</div></div>
    ${plan?.lines.length ? `<div class="card" style="margin-top:12px"><h3>${L('À commander pour 2 jours', 'To order for 2 days')}</h3>${plan.lines.slice(0, 8).map((l) => `<div class="ad"><span>${esc(l.name)}</span><b>${dec(l.buy, 1)} ${esc(l.unit)}</b></div>`).join('')}<a class="btn sm" style="margin-top:10px" href="#/resto/stock?tab=plan&days=2">${L('Plan d\'achat complet', 'Full purchase plan')} · ${money(plan.total)}</a></div>` : ''}</div>
  </div>`;
});

// ===================== Reports =====================
const WD = () => (state.lang === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']);
R('/resto/reports', async (ctx) => {
  ctx.title(L('Rapports du restaurant', 'Restaurant reports'));
  const tab = ctx.query.tab || 'sales';
  const rb = rangeBar(ctx, '/resto/reports', `&tab=${tab}`);
  const qs = `from=${rb.from}&to=${rb.to}`;
  ctx.actions(tab === 'sales' || tab === 'menu' ? `<a class="btn" href="/api/resto/reports/${tab}?${qs}&format=xlsx">${icon('download')}<span class="hide-m">Excel</span></a>` : tab === 'z' ? `<a class="btn" target="_blank" href="/api/resto/reports/z?date=${ctx.query.d || today()}&format=html&print=1">${icon('print')}<span class="hide-m">${L('Imprimer', 'Print')}</span></a>` : '');
  const tabs = `<div class="tabs" style="margin-bottom:12px">${[['sales', L('Ventes', 'Sales')], ['menu', L('Ingénierie du menu', 'Menu engineering')], ['staff', L('Équipe et contrôle', 'Team & control')], ['z', L('Rapport Z', 'Z report')]].map(([k, l]) => `<a href="#/resto/reports?tab=${k}&from=${rb.from}&to=${rb.to}" class="${tab === k ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;
  if (tab === 'sales') {
    const d = await api.get(`/api/resto/reports/sales?${qs}`);
    const t = d.total; const maxD = Math.max(1, ...d.days.map((x) => x.total)); const maxH = Math.max(1, ...d.byHour.map((x) => x.total));
    const wdAvg = d.byWeekday.map((w) => ({ ...w, avg: w.days ? w.total / w.days : 0 })); const maxW = Math.max(1, ...wdAvg.map((w) => w.avg));
    ctx.el.innerHTML = `${tabs}${rb.html}<div class="grid g4">${kpi(L('Chiffre d\'affaires TTC', 'Revenue incl. VAT'), money(t.total || 0), `HT ${money(t.net || 0)} · TVA ${money(t.vat || 0)}`, 'accent')}${kpi(L('Couverts', 'Covers'), num(t.covers || 0), `${num(t.checks || 0)} ${L('additions', 'checks')}`)}
      ${kpi(L('Ticket moyen', 'Avg check'), money(t.avg_check), `${money(t.per_cover)} ${L('par couvert', 'per cover')}`)}${kpi(L('Coût matière', 'Food cost'), `${dec(t.food_cost_pct)} %`, `${money(t.cost || 0)} · ${L('pourboires', 'tips')} ${money(t.tips || 0)}`, t.food_cost_pct > 35 ? 'warn' : '')}</div>
    <div class="card" style="margin-top:16px"><h3>${L('Chiffre par jour', 'Revenue per day')}</h3><div class="hbars">${d.days.map((x) => `<div class="hb" title="${dt(x.d)} : ${money(x.total)} · ${x.covers} couv."><i style="height:${Math.max(3, (x.total / maxD) * 100)}%"></i><span>${x.d.slice(8)}</span></div>`).join('') || '<p class="muted">—</p>'}</div></div>
    <div class="grid g3" style="margin-top:16px">
      <div class="card"><h3>${L('Par heure', 'By hour')}</h3><div class="hbars small">${d.byHour.map((x) => `<div class="hb" title="${x.h} h : ${money(x.total)}"><i style="height:${Math.max(3, (x.total / maxH) * 100)}%"></i><span>${x.h}</span></div>`).join('')}</div>
        <h3 style="margin-top:14px">${L('Moyenne par jour de semaine', 'Average per weekday')}</h3><div class="bar-list">${wdAvg.map((w) => `<div class="it"><span>${WD()[w.wd]}</span><b class="num">${money(w.avg)}</b><div class="tr"><i style="width:${(w.avg / maxW) * 100}%"></i></div></div>`).join('')}</div></div>
      <div class="card"><h3>${L('Par famille', 'By category')}</h3><div class="bar-list">${d.byCategory.map((c) => `<div class="it"><span>${esc(c.name)}</span><b class="num">${money(c.total)}</b><div class="tr"><i style="width:${(c.total / (d.byCategory[0]?.total || 1)) * 100}%"></i></div></div>`).join('')}</div></div>
      <div class="card"><h3>${L('Par canal', 'By channel')}</h3>${d.byChannel.map((c) => `<div class="ad"><span>${esc(kindName(c.kind))}${c.source !== 'staff' ? ` · ${esc(c.source)}` : ''} <span class="muted sm">${c.checks}</span></span><b>${money(c.total)}</b></div>`).join('')}
        <h3 style="margin-top:14px">${L('Encaissements', 'Payments')}</h3>${d.byMethod.map((m) => `<div class="ad"><span>${esc(payName(m.method))} <span class="muted sm">${m.n}</span></span><b>${money(m.amount)}</b></div>`).join('')}</div></div>`;
  } else if (tab === 'menu') {
    const d = await api.get(`/api/resto/reports/menu?${qs}`);
    const CL = { star: [L('⭐ Stars', '⭐ Stars'), L('Populaires et rentables : mettez-les en avant.', 'Popular and profitable: feature them.')], plowhorse: [L('🐴 Chevaux de labour', '🐴 Plowhorses'), L('Populaires, peu rentables : augmentez le prix ou baissez le coût.', 'Popular, low margin: raise price or cut cost.')], puzzle: [L('🧩 Énigmes', '🧩 Puzzles'), L('Rentables mais peu vendus : faites-les recommander.', 'Profitable but slow: get waiters to push them.')], dog: [L('⚠ Poids morts', '⚠ Dogs'), L('Ni populaires ni rentables : à retravailler ou retirer.', 'Neither: rework or remove.')] };
    ctx.el.innerHTML = `${tabs}${rb.html}<div class="card"><p class="muted" style="margin-top:0">${L('Chaque plat est classé selon sa popularité (au-dessus de', 'Each dish is ranked by popularity (above')} ${dec(d.pop_line)} ${L('portions) et sa marge unitaire (au-dessus de', 'portions) and unit margin (above')} ${money(d.avg_margin)}).</p>
      <div class="mx">${Object.entries(CL).map(([k, [h, s]]) => `<div class="${k}"><h4>${h}</h4><p class="muted sm" style="margin:0 0 6px">${s}</p>${d.items.filter((x) => x.class === k).map((x) => `<span>${esc(x.name)}</span>`).join('') || '—'}</div>`).join('')}</div></div>
    <div style="margin-top:16px">${table({ rows: d.items, columns: [{ label: L('Plat', 'Item'), render: (x) => `<b>${esc(x.name)}</b><div class="muted sm">${esc(x.category || '')}</div>` }, { label: L('Portions', 'Sold'), cls: 'r', render: (x) => num(x.qty) }, { label: L('CA TTC', 'Revenue'), cls: 'r', render: (x) => money(x.revenue) }, { label: L('Coût / portion', 'Unit cost'), cls: 'r', hideM: true, render: (x) => money(x.unit_cost) }, { label: L('Marge / portion', 'Unit margin'), cls: 'r', render: (x) => money(x.unit_margin) }, { label: L('Coût matière', 'Food cost'), cls: 'r', hideM: true, render: (x) => `<span style="color:${x.food_cost_pct > 35 ? 'var(--bad)' : 'inherit'}">${dec(x.food_cost_pct)} %</span>` }, { label: L('Marge totale', 'Total margin'), cls: 'r', render: (x) => `<b>${money(x.margin)}</b>` }] })}</div>`;
  } else if (tab === 'staff') {
    const d = await api.get(`/api/resto/reports/staff?${qs}`);
    ctx.el.innerHTML = `${tabs}${rb.html}<h3>${L('Serveurs', 'Waiters')}</h3>${table({ rows: d.servers, columns: [{ label: L('Serveur', 'Waiter'), render: (x) => `<b>${esc(x.name)}</b>` }, { label: L('Additions', 'Checks'), cls: 'r', key: 'checks' }, { label: L('Couverts', 'Covers'), cls: 'r', key: 'covers' }, { label: L('Ventes', 'Sales'), cls: 'r', render: (x) => money(x.total) }, { label: L('Par couvert', 'Per cover'), cls: 'r', hideM: true, render: (x) => money(x.per_cover) }, { label: L('Pourboires', 'Tips'), cls: 'r', render: (x) => money(x.tips) }, { label: L('Durée moy.', 'Avg turn'), cls: 'r', hideM: true, render: (x) => (x.turn_min ? `${x.turn_min} min` : '—') }] })}
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${L('Temps en cuisine par poste', 'Kitchen time per station')}</h3>${d.kitchen.map((k) => `<div class="ad"><span>${esc(k.name)} <span class="muted sm">${k.n} ${L('plats', 'dishes')} · max ${k.max_min} min</span></span><b style="color:${k.avg_min > (M().settings.prep_target_min || 15) ? 'var(--bad)' : 'var(--ok)'}">${dec(k.avg_min)} min</b></div>`).join('') || '<p class="muted sm">—</p>'}
      <h3 style="margin-top:14px">${L('Avis clients', 'Guest reviews')}</h3>${d.feedback.slice(0, 8).map((f) => `<div class="ad" style="display:block"><b>${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</b> <span class="muted sm">${esc(f.number || '')}${f.server_name ? ` · ${esc(f.server_name)}` : ''}</span>${f.comment ? `<div class="sm">${esc(f.comment)}</div>` : ''}</div>`).join('') || '<p class="muted sm">—</p>'}</div>
      <div class="card"><h3>${L('Annulations après envoi', 'Voids after sending')}</h3>${d.voids.map((v) => `<div class="ad"><span>${esc(v.name || '—')} <span class="muted sm">${v.n}</span></span><b style="color:var(--bad)">${money(v.v)}</b></div>`).join('') || `<p class="muted sm">${L('Aucune', 'None')} ✓</p>`}
        ${d.voidList.slice(0, 10).map((v) => `<div class="sm muted" style="padding:3px 0">${esc(v.number)} · ${num(v.qty)}× ${esc(v.name)} · ${esc(v.void_reason || '')} · ${esc(v.user_name || '')}</div>`).join('')}
        <h3 style="margin-top:14px">${L('Offerts et remises', 'Comps & discounts')}</h3>${d.comps.slice(0, 10).map((c) => `<div class="sm" style="padding:3px 0">${esc(c.number)} · ${num(c.qty)}× ${esc(c.name)} · ${c.comp ? L('offert', 'comp') : `-${num(c.discount_pct)} %`}</div>`).join('') || `<p class="muted sm">${L('Aucun', 'None')}</p>`}</div></div>`;
  } else {
    const day = ctx.query.d || today();
    const z = await api.get(`/api/resto/reports/z?date=${day}`, { cache: false });
    const t = z.total;
    ctx.el.innerHTML = `${tabs}<div class="row" style="margin-bottom:14px"><input type="date" class="in" id="zd" value="${day}"></div>
      <div class="grid g4">${kpi(L('Total TTC', 'Total'), money(t.total || 0), `${num(t.checks || 0)} ${L('additions', 'checks')} · ${num(t.covers || 0)} ${L('couverts', 'covers')}`, 'accent')}${kpi('TVA', money(t.vat || 0), `HT ${money(t.net || 0)}`)}${kpi(L('Annulations', 'Voids'), money(z.voids.v), `${z.voids.n} ${L('ligne(s)', 'line(s)')}`, z.voids.n ? 'warn' : '')}${kpi(L('Encore ouvertes', 'Still open'), z.open.n, money(z.open.due), z.open.n ? 'warn' : '')}</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${L('Encaissements', 'Payments')}</h3>${z.byMethod.map((m) => `<div class="ad"><span>${esc(payName(m.method))} <span class="muted sm">${m.n}</span></span><b>${money(m.amount)}</b></div>`).join('') || '—'}<div class="ad"><span>${L('Pourboires', 'Tips')}</span><b>${money(t.tips || 0)}</b></div><div class="ad"><span>${L('Remises et offerts', 'Discounts & comps')}</span><b>${money((t.discount || 0) + z.comps.v)}</b></div></div>
      <div class="card"><h3>${L('Caisses', 'Drawers')}</h3>${z.sessions.map((s) => `<div class="ad"><span>${esc(s.number)} · ${esc(s.name)} ${s.status === 'open' ? `<span class="pill ok">${L('ouverte', 'open')}</span>` : ''}</span><b style="color:${s.variance < 0 ? 'var(--bad)' : 'inherit'}">${s.variance != null ? `${L('écart', 'var.')} ${money(s.variance)}` : money(s.opening_float)}</b></div>`).join('') || '—'}
        <h3 style="margin-top:14px">TVA</h3>${z.vat.map((v) => `<div class="ad"><span>${v.rate == null ? L('taux standard', 'standard rate') : `${dec(v.rate)} %`}</span><b>${money(v.ttc)}</b></div>`).join('')}</div></div>`;
    document.getElementById('zd').onchange = (e) => { location.hash = `/resto/reports?tab=z&d=${e.target.value}`; };
    return;
  }
  rb.wire();
});

// ===================== Check history =====================
R('/resto/checks', async (ctx) => {
  ctx.title(L('Historique des additions', 'Check history'));
  const rb = rangeBar(ctx, '/resto/checks', ctx.query.q ? `&q=${encodeURIComponent(ctx.query.q)}` : '');
  const from = ctx.query.from || today(), to = ctx.query.to || today();
  const rows = await api.get(`/api/resto/orders?from=${from}&to=${to}${ctx.query.q ? `&q=${encodeURIComponent(ctx.query.q)}` : ''}&limit=500`, { cache: false });
  const paid = rows.filter((o) => o.status === 'paid');
  ctx.el.innerHTML = `${rb.html.replace(`value="${rb.from}"`, `value="${from}"`).replace(`value="${rb.to}"`, `value="${to}"`)}<div class="row" style="margin-bottom:12px"><input class="in" type="search" id="q" value="${esc(ctx.query.q || '')}" placeholder="${L('N°, table, nom, téléphone…', 'No., table, name, phone…')}" style="flex:1;max-width:360px"><span class="muted">${paid.length} ${L('réglées', 'paid')} · ${money(paid.reduce((t, o) => t + o.total, 0))}</span></div>
  ${table({ rows, href: (o) => `#/resto/order/${o.id}`, columns: [{ label: 'N°', render: (o) => `<b>${esc(o.number)}</b><div class="muted sm">${dt(o.opened_at)} ${hm(o.opened_at)}</div>` }, { label: L('Table / client', 'Table / guest'), render: (o) => (o.table_label ? `${L('Table', 'Table')} ${esc(o.table_label)}` : esc(o.guest_name || kindName(o.kind))) + `<div class="muted sm">${esc(kindName(o.kind))}${o.source !== 'staff' ? ` · ${esc(o.source)}` : ''}</div>` },
    { label: L('Serveur', 'Waiter'), hideM: true, render: (o) => esc(o.server_name || '') }, { label: L('Couv.', 'Cov.'), cls: 'r', hideM: true, key: 'covers' }, { label: 'Total', cls: 'r', render: (o) => `<b>${money(o.total)}</b>${o.tips ? `<div class="muted sm">+ ${money(o.tips)}</div>` : ''}` },
    { label: L('Statut', 'Status'), render: (o) => `<span class="pill ${o.status === 'paid' ? 'ok' : o.status === 'void' ? 'bad' : 'info'}">${esc({ open: L('ouverte', 'open'), paid: L('réglée', 'paid'), void: L('annulée', 'void') }[o.status])}</span>` }],
  empty: `<b>${L('Aucune addition sur la période', 'No checks in this period')}</b>` })}`;
  rb.wire();
  let t; ctx.el.querySelector('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = `/resto/checks?from=${from}&to=${to}&q=${encodeURIComponent(e.target.value)}`; }, 400); };
});

// ===================== Settings =====================
R('/resto/settings', async (ctx) => {
  ctx.title(L('Réglages du restaurant', 'Restaurant settings'));
  await refreshMeta();
  const tab = ctx.query.tab || 'general';
  const s = M().settings;
  const tabs = `<div class="tabs" style="margin-bottom:14px">${[['general', L('Général', 'General')], ['floor', L('Salles et tables', 'Rooms & tables')], ['stations', L('Postes cuisine et bar', 'Kitchen & bar stations')], ['links', L('QR et liens clients', 'QR & guest links')]].map(([k, l]) => `<a href="#/resto/settings?tab=${k}" class="${tab === k ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;
  if (tab === 'general') {
    ctx.el.innerHTML = `${tabs}<form class="card" id="f"><h3>${L('Service et paiement', 'Service & payment')}</h3><div class="f3">
      ${field({ name: 'service_pct', label: L('Service ajouté en salle (%)', 'Service charge dine-in (%)'), type: 'number', min: 0, step: '0.5', value: s.service_pct })}${field({ name: 'tip_suggestions', label: L('Pourboires suggérés (%)', 'Suggested tips (%)'), value: s.tip_suggestions })}${field({ name: 'max_discount_pct', label: L('Remise max sans code (%)', 'Max discount without code (%)'), type: 'number', min: 0, value: s.max_discount_pct })}
      ${field({ name: 'prep_target_min', label: L('Objectif temps cuisine (min)', 'Kitchen time target (min)'), type: 'number', min: 1, value: s.prep_target_min })}${field({ name: 'open_time', label: L('Ouverture', 'Opens'), type: 'time', value: s.open_time })}${field({ name: 'close_time', label: L('Fermeture', 'Closes'), type: 'time', value: s.close_time })}
      ${field({ name: 'manager_pin', label: L('Nouveau code responsable', 'New manager code'), type: 'password', placeholder: s.has_pin ? '••••' : L('aucun', 'none'), hint: L('Demandé pour annuler un plat envoyé, offrir ou faire une grosse remise.', 'Asked to void a sent item, comp or give a big discount.') })}${field({ name: 'cuisine', label: L('Type de cuisine', 'Cuisine'), value: s.cuisine })}</div>
      <h3>${L('Happy hour (boissons)', 'Happy hour (drinks)')}</h3><div class="f3">${field({ name: 'happy_hour_from', label: L('De', 'From'), type: 'time', value: s.happy_hour_from })}${field({ name: 'happy_hour_to', label: L('À', 'To'), type: 'time', value: s.happy_hour_to })}${field({ name: 'happy_hour_pct', label: L('Réduction (%)', 'Discount (%)'), type: 'number', min: 0, value: s.happy_hour_pct })}</div>
      <h3>${L('Fidélité', 'Loyalty')}</h3><div class="f3">${field({ name: 'points_per_1000', label: L('Points par 1 000 FCFA', 'Points per 1,000 FCFA'), type: 'number', min: 0, value: s.points_per_1000 })}${field({ name: 'point_value', label: L('Valeur d\'un point (FCFA)', 'Point value (FCFA)'), type: 'number', min: 0, value: s.point_value })}</div>
      <h3>${L('Commandes et réservations en ligne', 'Online orders & bookings')}</h3><div class="row" style="flex-wrap:wrap">${field({ name: 'qr_ordering', label: L('Commande depuis le QR de table', 'Ordering from the table QR'), type: 'checkbox', value: s.qr_ordering })}${field({ name: 'qr_auto_send', label: L('Envoi direct en cuisine (sans validation serveur)', 'Straight to kitchen (no waiter check)'), type: 'checkbox', value: s.qr_auto_send })}${field({ name: 'qr_pay', label: L('Paiement à table par QR', 'Pay at table by QR'), type: 'checkbox', value: s.qr_pay })}${field({ name: 'online_orders', label: L('Emporter et livraison en ligne', 'Online takeaway & delivery'), type: 'checkbox', value: s.online_orders })}${field({ name: 'online_reservations', label: L('Réservation en ligne', 'Online booking'), type: 'checkbox', value: s.online_reservations })}</div>
      <div class="f3">${field({ name: 'delivery_fee', label: L('Frais de livraison', 'Delivery fee'), type: 'number', min: 0, value: s.delivery_fee })}${field({ name: 'min_delivery', label: L('Minimum de commande livraison', 'Delivery minimum'), type: 'number', min: 0, value: s.min_delivery })}${field({ name: 'reservation_minutes', label: L('Durée d\'une réservation (min)', 'Booking length (min)'), type: 'number', min: 30, value: s.reservation_minutes })}
      ${field({ name: 'wifi_name', label: L('Wi-Fi (nom)', 'Wi-Fi name'), value: s.wifi_name })}${field({ name: 'wifi_password', label: L('Wi-Fi (mot de passe)', 'Wi-Fi password'), value: s.wifi_password })}</div>
      ${field({ name: 'welcome_text', label: L('Mot d\'accueil sur le menu QR', 'Welcome text on QR menu'), type: 'textarea', value: s.welcome_text })}${field({ name: 'receipt_footer', label: L('Pied de reçu', 'Receipt footer'), value: s.receipt_footer })}
      <button class="btn primary" style="margin-top:10px">${L('Enregistrer', 'Save')}</button></form>`;
    ctx.el.querySelector('#f').onsubmit = (e) => { e.preventDefault(); const f = e.target; const b = {}; for (const el of f.elements) if (el.name) b[el.name] = el.type === 'checkbox' ? el.checked : el.value; if (!b.manager_pin) delete b.manager_pin;
      api.put('/api/resto/settings', b).then(() => { toast(L('Réglages enregistrés', 'Settings saved'), 'ok'); refreshMeta(); }).catch(fail); };
  } else if (tab === 'floor') {
    const area = ctx.query.area || String(M().areas[0]?.id || '');
    const tables = M().tables.filter((t) => String(t.area_id) === area);
    ctx.el.innerHTML = `${tabs}<div class="row between" style="margin-bottom:12px"><div class="tabs">${M().areas.map((a) => `<a href="#/resto/settings?tab=floor&area=${a.id}" class="${String(a.id) === area ? 'on' : ''}">${esc(a.name)}</a>`).join('')}</div>
      <div class="row"><button class="btn" id="na">${icon('plus')} ${L('Salle', 'Room')}</button>${area ? `<button class="btn" id="ea">${icon('edit')}</button><button class="btn" id="nr">${icon('plus')} ${L('Plusieurs tables', 'Several tables')}</button><button class="btn primary" id="nt">${icon('plus')} ${L('Table', 'Table')}</button>` : ''}</div></div>
      <p class="muted sm">${L('Glissez les tables pour reproduire votre salle, puis enregistrez. Touchez une table pour la modifier.', 'Drag tables to match your room, then save. Tap a table to edit it.')}</p>
      <div class="fp edit" id="fp">${tables.map((t) => `<div class="tb ${t.shape} free" data-t="${t.id}" style="left:${t.x}%;top:${t.y}%"><span class="lb">${esc(t.label)}</span><span class="sm">${t.seats} ${L('places', 'seats')}</span>${t.active ? '' : `<span class="sm">${L('inactive', 'inactive')}</span>`}</div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="sv" disabled>${L('Enregistrer la disposition', 'Save layout')}</button><a class="btn" target="_blank" href="/api/resto/qr?print=1">${icon('print')} ${L('Imprimer tous les QR de table', 'Print all table QR codes')}</a></div>`;
    const fp = ctx.el.querySelector('#fp'); const moved = new Map(); let drag = null, sx = 0, sy = 0, ox = 0, oy = 0, didMove = false;
    fp.querySelectorAll('.tb').forEach((el) => {
      el.addEventListener('pointerdown', (e) => { drag = el; didMove = false; el.setPointerCapture(e.pointerId); sx = e.clientX; sy = e.clientY; ox = parseFloat(el.style.left); oy = parseFloat(el.style.top); });
      el.addEventListener('pointermove', (e) => { if (drag !== el) return; const r = fp.getBoundingClientRect(); const dx = ((e.clientX - sx) / r.width) * 100, dy = ((e.clientY - sy) / r.height) * 100; if (Math.abs(dx) + Math.abs(dy) > 0.6) didMove = true; const x = Math.max(0, Math.min(92, ox + dx)), y = Math.max(0, Math.min(88, oy + dy)); el.style.left = x + '%'; el.style.top = y + '%'; moved.set(Number(el.dataset.t), { id: Number(el.dataset.t), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); ctx.el.querySelector('#sv').disabled = false; });
      el.addEventListener('pointerup', () => { const was = drag; drag = null; if (was === el && !didMove) tableDialog(M().tables.find((t) => t.id === Number(el.dataset.t))).then((v) => v && ctx.rerender()).catch(fail); });
    });
    ctx.el.querySelector('#sv').onclick = () => api.put('/api/resto/layout', { tables: [...moved.values()] }).then(() => { toast(L('Disposition enregistrée', 'Layout saved'), 'ok'); ctx.rerender(); }).catch(fail);
    const areaDlg = (a = {}) => dialog({ title: a.id ? a.name : L('Nouvelle salle', 'New room'), body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: a.name, placeholder: L('Terrasse, Lounge, VIP…', 'Terrace, Lounge, VIP…') })}${field({ name: 'position', label: L('Ordre', 'Order'), type: 'number', value: a.position || 0 })}${a.id ? field({ name: 'active', label: L('Active', 'Active'), type: 'checkbox', value: a.active }) : ''}</div>`,
      onSubmit: (x) => (a.id ? api.put(`/api/resto/areas/${a.id}`, x) : api.post('/api/resto/areas', x)) }).then((v) => v && ctx.rerender()).catch(fail);
    document.getElementById('na').onclick = () => areaDlg();
    document.getElementById('ea')?.addEventListener('click', () => areaDlg(M().areas.find((a) => String(a.id) === area)));
    document.getElementById('nt')?.addEventListener('click', () => tableDialog({ area_id: Number(area) }).then((v) => v && ctx.rerender()).catch(fail));
    document.getElementById('nr')?.addEventListener('click', () => dialog({ title: L('Créer plusieurs tables', 'Create several tables'), body: `<div class="f3">${field({ name: 'prefix', label: L('Préfixe', 'Prefix'), placeholder: 'T' })}${field({ name: 'from', label: L('De', 'From'), type: 'number', value: 1, min: 1 })}${field({ name: 'to', label: L('À', 'To'), type: 'number', value: 10, min: 1 })}${field({ name: 'seats', label: L('Places', 'Seats'), type: 'number', value: 4, min: 1 })}${field({ name: 'shape', label: L('Forme', 'Shape'), type: 'select', options: SHAPES() })}</div>`,
      onSubmit: (x) => api.post('/api/resto/tables', { ...x, area_id: Number(area), from: Number(x.from), to: Number(x.to), seats: Number(x.seats) }) }).then((v) => v && ctx.rerender()).catch(fail));
  } else if (tab === 'stations') {
    ctx.el.innerHTML = `${tabs}<p class="muted">${L('Chaque famille de la carte est envoyée à un poste : chaque poste a son propre écran ou son imprimante de bons.', 'Each menu category goes to one station: each station has its own screen or ticket printer.')}</p>
      ${table({ rows: M().stations, columns: [{ label: L('Poste', 'Station'), render: (x) => `<b>${esc(x.name)}</b>` }, { label: L('Type', 'Type'), render: (x) => esc(L(M().station_kinds[x.kind]?.fr || x.kind, M().station_kinds[x.kind]?.en || x.kind)) }, { label: L('Actif', 'Active'), render: (x) => (x.active ? '✓' : '—') }, { label: '', cls: 'r', render: (x) => `<a class="btn sm" href="#/resto/kitchen?station=${x.id}">${icon('monitor')}</a><button class="btn sm" data-es="${x.id}">${icon('edit')}</button>` }] })}
      <button class="btn primary" id="ns" style="margin-top:12px">${icon('plus')} ${L('Poste', 'Station')}</button>`;
    const stDlg = (x = {}) => dialog({ title: x.id ? x.name : L('Nouveau poste', 'New station'), body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: x.name, placeholder: L('Grill, Pâtisserie, Bar terrasse…', 'Grill, Pastry, Terrace bar…') })}${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', value: x.kind, options: Object.entries(M().station_kinds).map(([k, v]) => [k, L(v.fr, v.en)]) })}${x.id ? field({ name: 'active', label: L('Actif', 'Active'), type: 'checkbox', value: x.active }) : ''}</div>`,
      onSubmit: (b) => (x.id ? api.put(`/api/resto/stations/${x.id}`, b) : api.post('/api/resto/stations', b)) }).then((v) => v && ctx.rerender()).catch(fail);
    ctx.el.querySelectorAll('[data-es]').forEach((b) => b.onclick = () => stDlg(M().stations.find((x) => x.id === Number(b.dataset.es))));
    document.getElementById('ns').onclick = () => stDlg();
  } else {
    const u = M().public_url;
    const link = (title, desc, path) => `<div class="card"><h3>${title}</h3><p class="muted">${desc}</p><div class="row" style="flex-wrap:wrap"><code class="mono">${esc(u + path)}</code><a class="btn sm" target="_blank" href="${path}">${L('Ouvrir', 'Open')}</a><button class="btn sm" data-cp="${esc(u + path)}">${L('Copier', 'Copy')}</button><a class="btn sm" target="_blank" href="https://wa.me/?text=${encodeURIComponent(`${state.me.company.name} : ${u + path}`)}">WhatsApp</a></div></div>`;
    ctx.el.innerHTML = `${tabs}<div class="grid g2">
      ${link(L('Commande à emporter et livraison', 'Takeaway & delivery ordering'), L('À mettre dans votre bio Instagram, votre statut WhatsApp et votre fiche Google.', 'Put it in your Instagram bio, WhatsApp status and Google listing.'), '/order')}
      ${link(L('Réservation en ligne', 'Online booking'), L('Vos clients choisissent un créneau libre et reçoivent la confirmation.', 'Guests pick a free slot and get a confirmation.'), '/reserve')}
      <div class="card"><h3>${L('QR codes des tables', 'Table QR codes')}</h3><p class="muted">${L('Un QR unique par table : le client voit le menu, commande, appelle le serveur, demande l\'addition et paie par MoMo avec pourboire, sans installer d\'application.', 'One QR per table: guests see the menu, order, call the waiter, ask for the bill and pay by MoMo with a tip, no app needed.')}</p>
        <div class="row"><a class="btn primary" target="_blank" href="/api/resto/qr?print=1">${icon('print')} ${L('Imprimer tous les QR', 'Print all QR codes')}</a>${M().tables[0] ? `<a class="btn" target="_blank" href="/m/${M().tables[0].qr_token}">${L('Tester avec la table', 'Try with table')} ${esc(M().tables[0].label)}</a>` : ''}</div></div>
      <div class="card"><h3>${L('Mobile Money', 'Mobile Money')}</h3><p class="muted">${M().momo.mode === 'simulation' ? L('Mode démonstration : les paiements MoMo sont simulés (confirmés après 5 s). Ajoutez vos clés MTN et Orange dans les variables d\'environnement pour encaisser pour de vrai.', 'Demo mode: MoMo payments are simulated (confirmed after 5 s). Add your MTN and Orange keys in the environment variables to take real payments.') : `MTN MoMo ${M().momo.mtn_momo ? '✓' : '—'} · Orange Money ${M().momo.orange_money ? '✓' : '—'}`}</p></div></div>`;
    ctx.el.querySelectorAll('[data-cp]').forEach((b) => b.onclick = () => navigator.clipboard?.writeText(b.dataset.cp).then(() => toast(L('Lien copié', 'Link copied'), 'ok')));
  }
});
const SHAPES = () => [['square', L('Carrée', 'Square')], ['round', L('Ronde', 'Round')], ['rect', L('Rectangulaire', 'Long')], ['booth', L('Banquette', 'Booth')]];
function tableDialog(t = {}) {
  return dialog({ title: t.id ? `${L('Table', 'Table')} ${t.label}` : L('Nouvelle table', 'New table'),
    body: `<div class="f2">${field({ name: 'label', label: L('Nom / numéro', 'Name / number'), required: true, value: t.label })}${field({ name: 'seats', label: L('Places', 'Seats'), type: 'number', min: 1, value: t.seats || 4 })}
    ${field({ name: 'shape', label: L('Forme', 'Shape'), type: 'select', value: t.shape, options: SHAPES() })}${field({ name: 'area_id', label: L('Salle', 'Room'), type: 'select', value: t.area_id, options: M().areas.map((a) => [a.id, a.name]) })}
    ${t.id ? field({ name: 'active', label: L('Active', 'Active'), type: 'checkbox', value: t.active }) : ''}</div>
    ${t.id ? `<div class="row" style="margin-top:8px"><a class="btn sm" target="_blank" href="/api/resto/qr?table=${t.id}&print=1">${icon('print')} ${L('QR de cette table', 'This table\'s QR')}</a><a class="btn sm" target="_blank" href="/m/${t.qr_token}">${L('Voir la page client', 'See guest page')}</a></div>` : ''}`,
    onSubmit: (x) => { const b = { ...x, seats: Number(x.seats), area_id: Number(x.area_id) }; return t.id ? api.put(`/api/resto/tables/${t.id}`, b) : api.post('/api/resto/tables', { ...b, x: 40, y: 40 }); } });
}

export { isManager };
