// Teknons Hôtel operations: housekeeping, maintenance, lost & found,
// restaurant/bar/service outlets, kitchen screen, spa, concierge requests,
// key cards, night audit, reports and hotel settings.
import { api } from './api.js';
import { state, L, esc, money, num, dt, today, qs, icon, can, table, field, dialog, toast, confirmDlg, offlineNote } from './ui.js';
import { R, H, isManager, fail, addDays, bd, kpi, dayName, sourceName, payName, vipBadge, refreshMeta, hkPill, withPin } from './hotel.js';

const outletName = (o) => { const x = H().outlet_kinds?.[o]; return x ? L(x.fr, x.en) : o === 'reception' ? L('Hébergement et réception', 'Rooms & desk') : o; };
const reqName = (k) => H().request_kinds?.[k] || k;
const time = (s) => (s ? String(s).slice(11, 16) : '');
const ago = (s) => { const m = Math.max(0, Math.round((Date.now() - new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).getTime()) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
const staffOpts = (role) => [['', L('— personne —', '— nobody —')], ...H().staff.filter((u) => !role || u.role === role || ['manager', 'owner', 'admin'].includes(u.role)).map((u) => [u.id, u.name])];
const inHouse = () => api.get('/api/hotel/in-house', { cache: false }).catch(() => []);
const stayOpts = (rows, first = L('— choisir —', '— choose —')) => [['', first], ...rows.map((s) => [s.id, `${s.room_number || '?'} · ${s.guest_name}${s.vip ? ' ★' : ''}`])];
const roomOpts = (first = L('— aucune —', '— none —')) => [['', first], ...H().rooms.filter((r) => r.active).map((r) => [r.id, `${r.number} · ${r.type_name}`])];

// ===================== Housekeeping =====================
const OCC = { occupied: ['info', 'Occupée', 'Occupied'], departure: ['warn', 'Départ', 'Due out'], vacant: ['', 'Libre', 'Vacant'] };
R('/hotel/housekeeping', async (ctx) => {
  ctx.title(L('Ménage et chambres', 'Housekeeping'));
  const f = { floor: ctx.query.floor || '', st: ctx.query.st || '', mine: ctx.query.mine || '' };
  ctx.actions(`<a class="btn" href="#/hotel/lost-found">${icon('box')}<span class="hide-m">${L('Objet trouvé', 'Found item')}</span></a><button class="btn" id="mt">${icon('tool')}<span class="hide-m">${L('Signaler un problème', 'Report a problem')}</span></button>`);
  const b = await api.get('/api/hotel/rooms/board');
  let rooms = b.rooms;
  const floors = [...new Set(rooms.map((r) => r.floor).filter(Boolean))];
  const cnt = (fn) => rooms.filter(fn).length;
  const counts = { dirty: cnt((r) => r.hk_status === 'dirty' && !r.out_of_order), cleaning: cnt((r) => r.hk_status === 'cleaning'), clean: cnt((r) => r.hk_status === 'clean' && !r.out_of_order), inspected: cnt((r) => r.hk_status === 'inspected' && !r.out_of_order), ooo: cnt((r) => r.out_of_order), dep: cnt((r) => r.occupancy === 'departure'), arr: cnt((r) => r.arrival) };
  if (f.floor) rooms = rooms.filter((r) => r.floor === f.floor);
  if (f.st === 'ooo') rooms = rooms.filter((r) => r.out_of_order); else if (f.st === 'arr') rooms = rooms.filter((r) => r.arrival); else if (f.st === 'dep') rooms = rooms.filter((r) => r.occupancy === 'departure'); else if (f.st) rooms = rooms.filter((r) => r.hk_status === f.st && !r.out_of_order);
  if (f.mine) rooms = rooms.filter((r) => r.hk_user_id === state.me.user.id);
  const chip = (k, l, n) => `<a class="${f.st === k ? 'on' : ''}" href="#/hotel/housekeeping${qs({ ...f, st: f.st === k ? '' : k })}">${l} <b>${n}</b></a>`;
  ctx.el.innerHTML = `${offlineNote(b)}
  ${rooms.some((r) => r.undeclared) ? `<div class="card banner bad"><b>${L('Attention', 'Warning')}</b> : ${L('chambre(s) vue(s) occupée(s) sans client enregistré', 'room(s) seen occupied with no registered guest')} : ${rooms.filter((r) => r.undeclared).map((r) => `<b>${esc(r.number)}</b>`).join(', ')}. ${L('Le gérant a été alerté.', 'The manager was alerted.')}</div>` : ''}
  <div class="row between" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
    <div class="chips">${chip('dirty', L('À faire', 'To clean'), counts.dirty)}${chip('cleaning', L('En cours', 'In progress'), counts.cleaning)}${chip('clean', L('Propres', 'Clean'), counts.clean)}${chip('inspected', L('Inspectées', 'Inspected'), counts.inspected)}${chip('dep', L('Départs', 'Due out'), counts.dep)}${chip('arr', L('Arrivées', 'Arrivals'), counts.arr)}${chip('ooo', L('Hors service', 'Out of order'), counts.ooo)}</div>
    <div class="row"><select class="in" id="fl"><option value="">${L('Tous les étages', 'All floors')}</option>${floors.map((x) => `<option ${x === f.floor ? 'selected' : ''} value="${esc(x)}">${L('Étage', 'Floor')} ${esc(x)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="mine" ${f.mine ? 'checked' : ''}> ${L('Mes chambres', 'My rooms')}</label></div></div>
  <div class="hk-grid">${rooms.map((r) => `<button class="hk-tile hk-${r.out_of_order ? 'ooo' : r.hk_status} ${r.undeclared ? 'alarm' : ''}" data-room="${r.id}">
      <div class="row between"><b class="hk-n">${esc(r.number)}</b>${r.stay?.vip || r.arrival?.vip ? '<span class="pill vip">VIP</span>' : ''}</div>
      <div class="sm muted">${esc(r.type_code || r.type_name)}</div>
      <div class="hk-st">${r.out_of_order ? `<span class="pill bad">${L('Hors service', 'OOO')}</span>` : hkPill(r.hk_status)} <span class="pill ${OCC[r.occupancy][0]}">${L(OCC[r.occupancy][1], OCC[r.occupancy][2])}</span></div>
      <div class="sm hk-f">${r.dnd ? `<b style="color:var(--bad)">${L('Ne pas déranger', 'Do not disturb')}</b>` : r.arrival ? `${icon('login')} ${esc(r.arrival.guest_name)}${r.arrival.eta ? ' · ' + esc(r.arrival.eta) : ''}` : r.stay ? esc(r.stay.guest_name) : '&nbsp;'}</div>
      <div class="sm muted hk-f">${r.hk_user ? esc(r.hk_user) : ''}${r.maintenance ? ` · ${icon('tool')}${r.maintenance}` : ''}${r.seen ? ` · ${r.seen === 'occupied_seen' ? L('vue occupée', 'seen occupied') : L('vue libre', 'seen vacant')}` : ''}</div></button>`).join('') || `<div class="card empty"><b>${L('Aucune chambre', 'No rooms')}</b></div>`}</div>`;
  const go = (k, v) => { location.hash = '/hotel/housekeeping' + qs({ ...f, [k]: v }); };
  ctx.el.querySelector('#fl').onchange = (e) => go('floor', e.target.value);
  ctx.el.querySelector('#mine').onchange = (e) => go('mine', e.target.checked ? '1' : '');
  document.getElementById('mt').onclick = () => maintenanceDialog().then((x) => x && ctx.rerender()).catch(fail);
  ctx.el.querySelectorAll('[data-room]').forEach((t) => t.addEventListener('click', () => roomDialog(b.rooms.find((r) => r.id === Number(t.dataset.room))).then((x) => x && ctx.rerender()).catch(fail)));
}, true);

async function roomDialog(r) {
  const manager = isManager();
  const set = (body) => api.put(`/api/hotel/rooms/${r.id}/status`, body);
  const hk = [['cleaning', L('Je commence', 'Start cleaning'), ''], ['clean', L('Propre', 'Clean'), 'primary'], ['inspected', L('Inspectée', 'Inspected'), ''], ['dirty', L('Sale', 'Dirty'), '']];
  let done = false;
  await dialog({ title: `${L('Chambre', 'Room')} ${r.number} · ${r.type_name}`, submit: '', cancel: L('Fermer', 'Close'),
    body: `<div class="row between lrow"><span>${L('État', 'Status')}</span><span>${r.out_of_order ? `<span class="pill bad">${L('Hors service', 'Out of order')}</span> ${esc(r.ooo_reason || '')}` : hkPill(r.hk_status)}</span></div>
    ${r.stay ? `<div class="row between lrow"><span>${L('Client', 'Guest')}</span><b>${esc(r.stay.guest_name)} ${vipBadge(r.stay.vip)}<div class="muted sm">${L('départ', 'leaves')} ${dt(r.stay.departure)} · ${r.stay.adults + r.stay.children} pers.</div></b></div>` : ''}
    ${r.arrival ? `<div class="row between lrow"><span>${L('Arrivée du jour', 'Arriving today')}</span><b>${esc(r.arrival.guest_name)} ${vipBadge(r.arrival.vip)}</b></div>` : ''}
    <div class="row" style="flex-wrap:wrap;margin:12px 0">${hk.map(([k, l, c]) => `<button type="button" class="btn ${c}" data-hk="${k}" ${r.hk_status === k ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <h4>${L('Contrôle de présence', 'Occupancy check')}</h4><p class="muted sm" style="margin-top:0">${L('Indiquez ce que vous voyez dans la chambre. Une chambre occupée sans client enregistré déclenche une alerte au gérant.', 'Say what you see in the room. An occupied room with no registered guest alerts the manager.')}</p>
    <div class="row"><button type="button" class="btn" data-seen="occupied">${L('Vue occupée', 'Seen occupied')}</button><button type="button" class="btn" data-seen="vacant">${L('Vue libre', 'Seen vacant')}</button><button type="button" class="btn" data-dnd>${r.dnd ? L('Lever « Ne pas déranger »', 'Clear DND') : L('« Ne pas déranger »', 'Do not disturb')}</button></div>
    <h4>${L('Affectation', 'Assigned to')}</h4><div class="row"><select class="in" id="hku" style="flex:1">${staffOpts('housekeeper').map(([v, l]) => `<option value="${v}" ${String(v) === String(r.hk_user_id || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="row" style="flex-wrap:wrap;margin-top:14px">${r.stay ? `<button type="button" class="btn" data-mini>${L('Minibar consommé', 'Minibar used')}</button>` : ''}<button type="button" class="btn" data-mt>${icon('tool')}${L('Problème technique', 'Maintenance')}</button><button type="button" class="btn" data-lf>${icon('box')}${L('Objet trouvé', 'Found item')}</button>
      ${manager || can('settings') ? `<button type="button" class="btn ${r.out_of_order ? '' : 'danger'}" data-ooo>${r.out_of_order ? L('Remettre en service', 'Back in service') : L('Mettre hors service', 'Out of order')}</button>` : ''}</div>`,
    onOpen: (d) => {
      const after = (msg) => { done = true; toast(msg, 'ok'); d.querySelector('[data-x]').click(); };
      d.querySelectorAll('[data-hk]').forEach((x) => x.onclick = () => set({ hk_status: x.dataset.hk }).then(() => after(`${r.number} : ${x.textContent}`)).catch(fail));
      d.querySelectorAll('[data-seen]').forEach((x) => x.onclick = () => set({ seen: x.dataset.seen }).then(() => after(L('Contrôle enregistré', 'Check saved'))).catch(fail));
      d.querySelector('[data-dnd]').onclick = () => set({ dnd: !r.dnd }).then(() => after(L('Enregistré', 'Saved'))).catch(fail);
      d.querySelector('#hku').onchange = (e) => set({ hk_user_id: Number(e.target.value) || null }).then(() => { done = true; toast(L('Affectée', 'Assigned'), 'ok'); }).catch(fail);
      d.querySelector('[data-mini]')?.addEventListener('click', () => { d.querySelector('[data-x]').click(); minibarDialog(r).catch(fail); });
      d.querySelector('[data-mt]').onclick = () => { d.querySelector('[data-x]').click(); maintenanceDialog({ room_id: r.id }).catch(fail); };
      d.querySelector('[data-lf]').onclick = () => { d.querySelector('[data-x]').click(); lostDialog({ room_id: r.id }).catch(fail); };
      d.querySelector('[data-ooo]')?.addEventListener('click', async () => {
        let reason = '';
        if (!r.out_of_order) { const v = await dialog({ title: L('Mettre hors service', 'Out of order'), danger: true, submit: L('Confirmer', 'Confirm'), body: field({ name: 'r', label: L('Raison', 'Reason'), required: true, placeholder: L('Climatisation en panne, peinture…', 'AC broken, painting…') }) }); if (!v) return; reason = v.r; }
        set({ out_of_order: !r.out_of_order, ooo_reason: reason }).then(() => after(L('Enregistré', 'Saved'))).catch(fail);
      });
    } });
  return done;
}

async function minibarDialog(r) {
  const items = (await api.get('/api/hotel/items')).filter((i) => i.outlet_kind === 'minibar');
  if (!items.length) return toast(L('Ajoutez les articles du minibar dans Réglages de l\'hôtel', 'Add minibar items in Hotel settings'), 'err');
  const o = await dialog({ title: `${L('Minibar', 'Minibar')} · ${L('chambre', 'room')} ${r.number}`, submit: L('Facturer sur la chambre', 'Charge to room'),
    body: `<p class="muted sm" style="margin-top:0">${L('Indiquez les quantités consommées : elles sont ajoutées à la note du client.', 'Enter what was consumed: it goes on the guest bill.')}</p>
    ${items.map((i) => `<div class="row between lrow"><span>${esc(i.name)} <span class="muted sm">${money(i.price)}</span></span><input class="in" type="number" min="0" step="1" name="q_${i.id}" value="0" style="width:80px"></div>`).join('')}`,
    onSubmit: (v) => {
      const lines = items.map((i) => ({ product_id: i.id, qty: Number(v['q_' + i.id]) || 0 })).filter((l) => l.qty > 0);
      if (!lines.length) throw new Error(L('Aucune consommation saisie', 'Nothing entered'));
      return api.post(`/api/hotel/rooms/${r.id}/minibar`, { lines });
    } });
  if (o) toast(`${L('Minibar facturé', 'Minibar charged')} : ${money(o.total)}`, 'ok');
}

// ===================== Maintenance =====================
const PRIO = { urgent: ['bad', 'Urgent', 'Urgent'], high: ['warn', 'Haute', 'High'], normal: ['info', 'Normale', 'Normal'], low: ['', 'Basse', 'Low'] };
const MST = { open: ['warn', 'À faire', 'Open'], in_progress: ['info', 'En cours', 'In progress'], done: ['ok', 'Terminé', 'Done'] };
const p2 = (m, x) => `<span class="pill ${m[x][0]}">${L(m[x][1], m[x][2])}</span>`;
async function maintenanceDialog(o = {}) {
  return dialog({ title: L('Signaler un problème technique', 'Report a maintenance issue'), submit: L('Envoyer', 'Send'),
    body: `<div class="f2">${field({ name: 'room_id', label: L('Chambre', 'Room'), type: 'select', options: roomOpts(L('— lieu commun —', '— public area —')), value: o.room_id || '' })}${field({ name: 'place', label: L('ou lieu', 'or place'), placeholder: L('Piscine, hall, cuisine…', 'Pool, lobby, kitchen…') })}
    ${field({ name: 'title', label: L('Problème', 'Issue'), required: true, span: true, placeholder: L('La climatisation ne refroidit plus', 'AC not cooling') })}
    ${field({ name: 'priority', label: L('Priorité', 'Priority'), type: 'select', value: 'normal', options: Object.entries(PRIO).map(([k, v]) => [k, L(v[1], v[2])]) })}
    ${isManager() ? field({ name: 'blocks_room', label: L('La chambre ne peut pas être vendue', 'Room cannot be sold'), type: 'checkbox' }) : ''}</div>`,
    onSubmit: (v) => api.post('/api/hotel/maintenance', { ...v, room_id: Number(v.room_id) || null }) });
}
R('/hotel/maintenance', async (ctx) => {
  ctx.title(L('Maintenance', 'Maintenance'));
  ctx.actions(`<a class="btn" href="#/hotel/maintenance${ctx.query.all ? '' : '?all=1'}">${ctx.query.all ? L('En cours', 'Open') : L('Historique', 'History')}</a><button class="btn primary" id="new">${icon('plus')}${L('Signaler', 'Report')}</button>`);
  const rows = await api.get(`/api/hotel/maintenance${qs({ all: ctx.query.all })}`);
  ctx.el.innerHTML = table({ rows, columns: [
    { label: L('Problème', 'Issue'), render: (m) => `<b>${esc(m.title)}</b><div class="muted sm">${m.room_number ? `${L('Chambre', 'Room')} ${esc(m.room_number)}` : esc(m.place || '—')}${m.blocks_room ? ` · <b style="color:var(--bad)">${L('chambre bloquée', 'room blocked')}</b>` : ''} · ${esc(m.created_by_name || '')} · ${dt(m.created_at)} ${time(m.created_at)}</div>` },
    { label: L('Priorité', 'Priority'), render: (m) => p2(PRIO, m.priority) },
    { label: L('Statut', 'Status'), render: (m) => p2(MST, m.status) },
    { label: L('Coût', 'Cost'), cls: 'r num', hideM: true, render: (m) => (m.cost ? money(m.cost) : '') },
    { label: '', cls: 'r', render: (m) => (m.status === 'done' ? '' : `${m.status === 'open' ? `<button class="btn sm" data-s="in_progress" data-id="${m.id}">${L('Je m\'en occupe', 'Take it')}</button>` : ''}<button class="btn sm primary" data-s="done" data-id="${m.id}">${L('Réparé', 'Fixed')}</button>`) }],
  empty: `<b>${L('Aucune intervention en cours', 'Nothing to fix')}</b><p class="muted">${L('Tout fonctionne.', 'All good.')}</p>` });
  ctx.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => {
    let cost;
    if (b.dataset.s === 'done') { const v = await dialog({ title: L('Intervention terminée', 'Job done'), submit: L('Clôturer', 'Close job'), body: field({ name: 'cost', label: L('Coût des pièces / prestataire (optionnel)', 'Parts / contractor cost (optional)'), type: 'number', min: 0 }) }); if (!v) return; cost = Number(v.cost) || 0; }
    api.put(`/api/hotel/maintenance/${b.dataset.id}`, { status: b.dataset.s, cost }).then(() => ctx.rerender()).catch(fail);
  });
  document.getElementById('new').onclick = () => maintenanceDialog().then((x) => x && ctx.rerender()).catch(fail);
}, true);

// ===================== Lost & found =====================
async function lostDialog(o = {}) {
  return dialog({ title: L('Objet trouvé', 'Found item'), submit: L('Enregistrer', 'Save'),
    body: `<div class="f2">${field({ name: 'item', label: L('Objet', 'Item'), required: true, span: true, placeholder: L('Montre noire, chargeur…', 'Black watch, charger…') })}
    ${field({ name: 'room_id', label: L('Chambre', 'Room'), type: 'select', options: roomOpts(), value: o.room_id || '' })}${field({ name: 'place', label: L('ou lieu', 'or place') })}
    ${field({ name: 'note', label: L('Rangé où ?', 'Stored where?'), span: true, placeholder: L('Coffre de la réception, étagère 2', 'Front desk safe, shelf 2') })}</div>`,
    onSubmit: (v) => api.post('/api/hotel/lost-found', { ...v, room_id: Number(v.room_id) || null }) });
}
R('/hotel/lost-found', async (ctx) => {
  ctx.title(L('Objets trouvés', 'Lost & found'));
  ctx.actions(`<button class="btn primary" id="new">${icon('plus')}${L('Objet trouvé', 'Found item')}</button>`);
  const rows = await api.get('/api/hotel/lost-found');
  const LS = { stored: ['warn', 'En garde', 'Stored'], returned: ['ok', 'Rendu', 'Returned'], disposed: ['', 'Donné / jeté', 'Disposed'] };
  ctx.el.innerHTML = table({ rows, columns: [
    { label: L('Objet', 'Item'), render: (l) => `<b>${esc(l.item)}</b><div class="muted sm">${esc(l.note || '')}</div>` },
    { label: L('Trouvé', 'Found'), render: (l) => `${l.room_number ? `${L('Ch.', 'Rm')} ${esc(l.room_number)}` : esc(l.place || '—')}<div class="muted sm">${dt(l.found_at)} · ${esc(l.found_by)}</div>` },
    { label: L('Client probable', 'Likely owner'), hideM: true, render: (l) => esc(l.guest_name || '—') },
    { label: L('Statut', 'Status'), render: (l) => p2(LS, l.status) },
    { label: '', cls: 'r', render: (l) => (l.status === 'stored' && can('frontdesk') || l.status === 'stored' && can('housekeeping') ? `<button class="btn sm primary" data-s="returned" data-id="${l.id}">${L('Rendu', 'Returned')}</button><button class="btn sm" data-s="disposed" data-id="${l.id}">${L('Clôturer', 'Close')}</button>` : '') }],
  empty: `<b>${L('Aucun objet en garde', 'Nothing stored')}</b>` });
  ctx.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => api.put(`/api/hotel/lost-found/${b.dataset.id}`, { status: b.dataset.s }).then(() => ctx.rerender()).catch(fail));
  document.getElementById('new').onclick = () => lostDialog().then((x) => x && ctx.rerender()).catch(fail);
}, true);

// ===================== Outlets: restaurant, bar, services =====================
const cart = { outlet: null, lines: [], stay: null, table: '', covers: '' };
R('/hotel/outlet', async (ctx) => {
  const outlets = H().outlets.filter((o) => o.active && o.kind !== 'minibar');
  if (!outlets.length) { ctx.el.innerHTML = `<div class="card empty"><b>${L('Aucun point de vente', 'No outlet')}</b></div>`; return; }
  const oid = Number(ctx.query.o || cart.outlet || outlets[0].id);
  if (cart.outlet !== oid) Object.assign(cart, { outlet: oid, lines: [] });
  const outlet = outlets.find((o) => o.id === oid) || outlets[0];
  ctx.title(outlet.name);
  const [items, open] = await Promise.all([api.get(`/api/hotel/items?outlet_id=${outlet.id}`), api.get(`/api/hotel/orders${qs({ outlet_id: outlet.id, status: 'new,preparing,ready,delivered' })}`, { cache: false }).catch(() => [])]);
  const unsettled = open.filter((o) => !o.settlement);
  const ORDER = ['Petit-déjeuner', 'Entrées', 'Plats', 'Snacks', 'Desserts', 'Douceurs'];
  const rank = (c) => (ORDER.indexOf(c) < 0 ? 99 : ORDER.indexOf(c));
  const cats = [...new Set(items.map((i) => i.category || L('Carte', 'Menu')))].sort((a, b) => rank(a) - rank(b));
  let cat = ctx.query.c || cats[0];
  ctx.el.innerHTML = `<div class="tabs" style="margin-bottom:12px;overflow-x:auto">${outlets.map((o) => `<a href="#/hotel/outlet?o=${o.id}" class="${o.id === outlet.id ? 'on' : ''}">${esc(o.name)}</a>`).join('')}</div>
  <div class="ho-pos">
    <div><div class="pos-cats">${cats.map((c) => `<button data-c="${esc(c)}" class="${c === cat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
      <div class="ho-items" id="items"></div>
      ${unsettled.length ? `<h3 style="margin-top:18px">${L('Commandes ouvertes', 'Open orders')}</h3>${unsettled.map((o) => `<div class="card ho-open"><div class="row between"><b>${esc(o.number)}</b>${statusPill(o.status)}</div>
        <div class="sm">${o.lines.map((l) => `${num(l.qty)} × ${esc(l.name)}`).join(', ')}</div>
        <div class="row between" style="margin-top:6px"><span class="muted sm">${o.room_number ? `${L('Ch.', 'Rm')} ${esc(o.room_number)} · ${esc(o.guest_name || '')}` : esc(o.table_label || '')} · ${ago(o.created_at)}</span><b class="num">${money(o.total)}</b></div>
        <div class="row" style="margin-top:8px">${o.booking_id ? `<button class="btn sm primary" data-room-o="${o.id}">${L('Sur la chambre', 'To room')}</button>` : ''}<button class="btn sm" data-pay-o="${o.id}" data-total="${o.total}">${icon('cash')}${L('Encaisser', 'Collect')}</button>${o.status !== 'delivered' ? `<button class="btn sm" data-deliver="${o.id}">${L('Servie', 'Served')}</button>` : ''}</div></div>`).join('')}` : ''}</div>
    <div class="card ho-cart">
      <h3 style="margin-top:0">${L('Commande', 'Order')}</h3>
      <div class="row" style="gap:6px"><input class="in" id="room" placeholder="${L('N° chambre ou carte-clé', 'Room no. or key card')}" style="flex:1" value="${esc(cart.stay ? cart.stay.room_number : '')}"><button class="btn" id="find">${icon('key')}</button></div>
      <div id="stay" class="sm" style="margin:6px 0 4px">${cart.stay ? stayLine(cart.stay) : `<span class="muted">${L('Client extérieur : encaissement direct.', 'Walk-in customer: pay now.')}</span>`}</div>
      <div class="row" style="gap:6px"><input class="in" id="tbl" placeholder="${L('Table', 'Table')}" value="${esc(cart.table)}" style="flex:1"><input class="in" id="cov" type="number" min="0" placeholder="${L('Couverts', 'Covers')}" value="${esc(cart.covers)}" style="width:96px"></div>
      <div id="lines" class="ho-lines"></div>
      <div class="row between ho-tot"><span>Total TTC</span><b class="num" id="tot"></b></div>
      <div class="ho-btns">
        ${outlet.kitchen ? `<button class="btn" id="send">${icon('monitor')}${L('Envoyer en préparation', 'Send to kitchen')}</button>` : ''}
        <button class="btn primary" id="toroom">${icon('bed')}${L('Sur la chambre', 'Charge to room')}</button>
        <button class="btn primary" id="paid">${icon('cash')}${L('Encaisser', 'Collect')}</button></div>
    </div></div>`;
  const drawItems = () => {
    ctx.el.querySelector('#items').innerHTML = items.filter((i) => (i.category || L('Carte', 'Menu')) === cat).map((i) => `<button class="ho-item" data-id="${i.id}"><b>${esc(i.name)}</b><span class="muted sm">${esc(i.description || '').slice(0, 60)}</span><span class="num">${money(i.price)}</span></button>`).join('') || `<p class="muted">${L('Aucun article. Ajoutez la carte dans Réglages de l\'hôtel.', 'No items. Add the menu in Hotel settings.')}</p>`;
    ctx.el.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === cat));
  };
  const drawCart = () => {
    ctx.el.querySelector('#lines').innerHTML = cart.lines.map((l, i) => `<div class="ho-line"><span>${esc(l.name)}${l.note ? `<div class="muted sm">${esc(l.note)}</div>` : ''}</span><span class="row" style="gap:4px"><button class="btn sm" data-m="${i}">−</button><b>${num(l.qty)}</b><button class="btn sm" data-p="${i}">+</button></span><b class="num">${money(l.qty * l.price)}</b></div>`).join('') || `<p class="muted sm">${L('Touchez les articles pour les ajouter.', 'Tap items to add them.')}</p>`;
    ctx.el.querySelector('#tot').textContent = money(cart.lines.reduce((t, l) => t + l.qty * l.price, 0));
    ctx.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { const l = cart.lines[b.dataset.m]; l.qty--; if (l.qty <= 0) cart.lines.splice(b.dataset.m, 1); drawCart(); });
    ctx.el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { cart.lines[b.dataset.p].qty++; drawCart(); });
  };
  drawItems(); drawCart();
  ctx.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cat = b.dataset.c; drawItems(); });
  ctx.el.querySelector('#items').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const it = items.find((i) => i.id === Number(b.dataset.id));
    const l = cart.lines.find((x) => x.product_id === it.id && !x.note);
    if (l) l.qty++; else cart.lines.push({ product_id: it.id, name: it.name, price: it.price, qty: 1 });
    drawCart();
  });
  ctx.el.querySelector('#tbl').oninput = (e) => { cart.table = e.target.value; };
  ctx.el.querySelector('#cov').oninput = (e) => { cart.covers = e.target.value; };
  const find = async () => {
    const v = ctx.el.querySelector('#room').value.trim();
    if (!v) { cart.stay = null; ctx.el.querySelector('#stay').innerHTML = `<span class="muted">${L('Client extérieur : encaissement direct.', 'Walk-in customer: pay now.')}</span>`; return; }
    const rows = await inHouse();
    let s = rows.find((x) => String(x.room_number) === v);
    if (!s) { const k = await api.get(`/api/hotel/keys/lookup?uid=${encodeURIComponent(v)}`, { cache: false }).catch(() => null); if (k) s = { id: k.booking_id, room_number: k.room_number, guest_name: k.guest_name, vip: k.vip }; }
    if (!s) { cart.stay = null; ctx.el.querySelector('#stay').innerHTML = `<b style="color:var(--bad)">${L('Aucun client en chambre pour', 'No in-house guest for')} « ${esc(v)} »</b>`; return; }
    const full = rows.find((x) => x.id === s.id) || s;
    cart.stay = full; ctx.el.querySelector('#room').value = full.room_number;
    ctx.el.querySelector('#stay').innerHTML = stayLine(full);
  };
  ctx.el.querySelector('#find').onclick = () => find().catch(fail);
  ctx.el.querySelector('#room').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find().catch(fail); } });
  ctx.el.querySelector('#room').addEventListener('change', () => find().catch(fail));
  const body = (extra) => ({ outlet_id: outlet.id, lines: cart.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, note: l.note })), booking_id: cart.stay?.id, table_label: cart.table, covers: Number(cart.covers) || 0, ...extra });
  const finish = (o, msg) => { toast(`${o.number} · ${msg}`, 'ok'); Object.assign(cart, { lines: [], stay: null, table: '', covers: '' }); ctx.rerender(); };
  const need = () => { if (!cart.lines.length) throw new Error(L('Ajoutez des articles', 'Add items')); };
  ctx.el.querySelector('#send')?.addEventListener('click', () => { try { need(); } catch (e) { return fail(e); } api.post('/api/hotel/orders', body()).then((o) => finish(o, L('envoyée en préparation', 'sent to kitchen'))).catch(fail); });
  ctx.el.querySelector('#toroom').onclick = () => { try { need(); if (!cart.stay) throw new Error(L('Indiquez la chambre ou passez la carte-clé du client', 'Enter the room or tap the guest key card')); } catch (e) { return fail(e); } api.post('/api/hotel/orders', body({ settle: 'room' })).then((o) => finish(o, `${L('sur la chambre', 'charged to room')} ${cart.stay?.room_number || ''}`)).catch(fail); };
  ctx.el.querySelector('#paid').onclick = async () => {
    try { need(); } catch (e) { return fail(e); }
    const total = cart.lines.reduce((t, l) => t + l.qty * l.price, 0);
    const p = await payMethod(total); if (!p) return;
    api.post('/api/hotel/orders', body({ booking_id: undefined, settle: 'paid', ...p })).then((o) => finish(o, L('encaissée', 'paid'))).catch(fail);
  };
  ctx.el.querySelectorAll('[data-room-o]').forEach((b) => b.onclick = () => api.post(`/api/hotel/orders/${b.dataset.roomO}/settle`, { settle: 'room' }).then(() => ctx.rerender()).catch(fail));
  ctx.el.querySelectorAll('[data-deliver]').forEach((b) => b.onclick = () => api.put(`/api/hotel/orders/${b.dataset.deliver}/status`, { status: 'delivered' }).then(() => ctx.rerender()).catch(fail));
  ctx.el.querySelectorAll('[data-pay-o]').forEach((b) => b.onclick = async () => { const p = await payMethod(Number(b.dataset.total)); if (p) api.post(`/api/hotel/orders/${b.dataset.payO}/settle`, { settle: 'paid', ...p }).then(() => ctx.rerender()).catch(fail); });
});
const stayLine = (s) => `${icon('bed')} <b>${L('Ch.', 'Rm')} ${esc(s.room_number)}</b> · ${esc(s.guest_name)} ${vipBadge(s.vip)}${s.allergies ? `<div style="color:var(--bad)"><b>${L('Allergies', 'Allergies')}</b> : ${esc(s.allergies)}</div>` : ''}`;
const OST = { new: ['warn', 'Nouvelle', 'New'], preparing: ['info', 'En préparation', 'Preparing'], ready: ['ok', 'Prête', 'Ready'], delivered: ['', 'Servie', 'Served'], settled: ['ok', 'Réglée', 'Settled'], cancelled: ['bad', 'Annulée', 'Cancelled'] };
const statusPill = (s) => p2(OST, s);
async function payMethod(total) {
  const methods = Object.keys(H().pay).filter((m) => m !== 'cheque');
  return dialog({ title: `${L('Encaisser', 'Collect')} ${money(total)}`, submit: L('Encaisser', 'Collect'),
    body: `<div class="pay-m">${methods.map((m, i) => `<label class="pm"><input type="radio" name="method" value="${m}" ${i ? '' : 'checked'}><span>${esc(payName(m))}</span></label>`).join('')}</div>
    ${field({ name: 'reference', label: L('Référence (n° transaction, ticket TPE)', 'Reference (transaction, card slip)') })}` });
}

// ===================== Kitchen & bar screen =====================
const kitchen = async (ctx) => {
  ctx.title(L('Écran cuisine et bar', 'Kitchen & bar screen'));
  const rows = (await api.get('/api/hotel/orders?status=new,preparing,ready', { cache: false })).reverse();
  const col = (st, l) => { const list = rows.filter((o) => o.status === st); return `<div class="kds-col"><h3>${l} <span class="pill">${list.length}</span></h3>${list.map((o) => `<div class="card kds k-${st} ${ago(o.created_at).includes('h') || parseInt(ago(o.created_at), 10) > 20 ? 'late' : ''}">
      <div class="row between"><b>${esc(o.outlet_name)}</b><span class="mono sm">${ago(o.created_at)}</span></div>
      <div class="sm muted">${o.room_number ? `${L('Chambre', 'Room')} <b style="color:var(--ink)">${esc(o.room_number)}</b>` : esc(o.table_label ? `${L('Table', 'Table')} ${o.table_label}` : o.number)}${o.origin === 'guest' ? ` · <span class="pill info">${L('appli client', 'guest app')}</span>` : ''}</div>
      <ul>${o.lines.map((l) => `<li><b>${num(l.qty)}×</b> ${esc(l.name)}${l.note ? ` <i>(${esc(l.note)})</i>` : ''}</li>`).join('')}</ul>${o.note ? `<div class="sm"><i>${esc(o.note)}</i></div>` : ''}
      <div class="row">${st === 'new' ? `<button class="btn primary" data-s="preparing" data-id="${o.id}">${L('Commencer', 'Start')}</button>` : st === 'preparing' ? `<button class="btn primary" data-s="ready" data-id="${o.id}">${L('Prête', 'Ready')}</button>` : `<button class="btn primary" data-s="delivered" data-id="${o.id}">${L('Servie / livrée', 'Served')}</button>`}</div></div>`).join('')}</div>`; };
  ctx.el.innerHTML = `<div class="kds-wrap">${col('new', L('Nouvelles', 'New'))}${col('preparing', L('En préparation', 'Preparing'))}${col('ready', L('Prêtes à servir', 'Ready'))}</div>`;
  ctx.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { b.disabled = true; api.put(`/api/hotel/orders/${b.dataset.id}/status`, { status: b.dataset.s }).then(() => ctx.rerender()).catch(fail); });
  if (rows.some((o) => o.status === 'new')) { try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(() => {}); } catch {} }
};
R('/hotel/kitchen', kitchen, true);

// ===================== Spa & activities =====================
const AST = { requested: ['warn', 'Demandé', 'Requested'], booked: ['info', 'Réservé', 'Booked'], done: ['ok', 'Fait', 'Done'], cancelled: ['', 'Annulé', 'Cancelled'], no_show: ['bad', 'Absent', 'No-show'] };
R('/hotel/spa', async (ctx) => {
  ctx.title(L('Spa et activités', 'Spa & activities'));
  const day = ctx.query.d || bd();
  const go = (d) => { location.hash = '/hotel/spa?d=' + d; };
  ctx.actions(`<button class="btn" id="prev">‹</button><input type="date" class="in" id="day" value="${day}"><button class="btn" id="next">›</button>${can('outlet') || can('frontdesk') ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Rendez-vous', 'Appointment')}</span></button>` : ''}`);
  const [rows, items] = await Promise.all([api.get(`/api/hotel/appointments?date=${day}`, { cache: false }), api.get('/api/hotel/items')]);
  const services = items.filter((i) => i.outlet_kind === 'spa' || i.duration > 0);
  const staff = [...new Set(rows.map((a) => a.staff).filter(Boolean))];
  ctx.el.innerHTML = `<p class="muted">${dayName(day)} · ${rows.filter((a) => ['booked', 'requested'].includes(a.status)).length} ${L('rendez-vous', 'appointments')}${staff.length ? ` · ${staff.map(esc).join(', ')}` : ''}</p>
  ${table({ rows, columns: [
    { label: L('Heure', 'Time'), render: (a) => `<b class="mono">${time(a.start_at)}</b><div class="muted sm">${a.duration} min</div>` },
    { label: L('Soin', 'Treatment'), render: (a) => `<b>${esc(a.service)}</b><div class="muted sm">${money(a.price)}${a.staff ? ' · ' + esc(a.staff) : ''}</div>` },
    { label: L('Client', 'Guest'), render: (a) => `${esc(a.guest_name)}<div class="muted sm">${a.room_number ? `${L('Ch.', 'Rm')} ${esc(a.room_number)}` : L('extérieur', 'outside guest')}${a.origin === 'guest' ? ` · ${L('appli client', 'guest app')}` : ''}</div>` },
    { label: L('Statut', 'Status'), render: (a) => p2(AST, a.status) },
    { label: '', cls: 'r', render: (a) => (['requested', 'booked'].includes(a.status) && (can('outlet') || can('frontdesk')) ? `${a.status === 'requested' ? `<button class="btn sm" data-s="booked" data-id="${a.id}">${L('Confirmer', 'Confirm')}</button>` : ''}<button class="btn sm primary" data-s="done" data-id="${a.id}" data-room="${a.booking_id ? 1 : ''}" data-price="${a.price}">${L('Terminé', 'Done')}</button><button class="btn sm" data-s="no_show" data-id="${a.id}">${L('Absent', 'No-show')}</button><button class="btn sm" data-s="cancelled" data-id="${a.id}">${icon('x')}</button>` : '') }],
  empty: `<b>${L('Aucun rendez-vous ce jour', 'No appointments that day')}</b>` })}`;
  document.getElementById('prev').onclick = () => go(addDays(day, -1));
  document.getElementById('next').onclick = () => go(addDays(day, 1));
  document.getElementById('day').onchange = (e) => go(e.target.value);
  ctx.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => {
    const body = { status: b.dataset.s };
    if (b.dataset.s === 'done') {
      if (b.dataset.room) body.settle = 'room';
      else { const p = await payMethod(Number(b.dataset.price)); if (!p) return; Object.assign(body, { settle: 'paid', ...p }); }
    }
    api.put(`/api/hotel/appointments/${b.dataset.id}`, body).then(() => { toast(body.settle === 'room' ? L('Soin ajouté à la note de la chambre', 'Treatment added to the room bill') : L('Enregistré', 'Saved'), 'ok'); ctx.rerender(); }).catch(fail);
  });
  document.getElementById('new')?.addEventListener('click', async () => {
    if (!services.length) return toast(L('Ajoutez vos soins (avec une durée) dans Réglages de l\'hôtel', 'Add treatments (with a duration) in Hotel settings'), 'err');
    const stays = await inHouse();
    const v = await dialog({ title: L('Nouveau rendez-vous', 'New appointment'), submit: L('Réserver', 'Book'),
      body: `<div class="f2">${field({ name: 'product_id', label: L('Soin / activité', 'Treatment / activity'), type: 'select', span: true, options: services.map((s) => [s.id, `${s.name} · ${s.duration} min · ${money(s.price)}`]) })}
      ${field({ name: 'booking_id', label: L('Client de l\'hôtel', 'Hotel guest'), type: 'select', options: stayOpts(stays, L('— client extérieur —', '— outside guest —')) })}${field({ name: 'guest_name', label: L('ou nom du client', 'or guest name') })}
      ${field({ name: 'date', label: L('Date', 'Date'), type: 'date', value: day, required: true })}${field({ name: 'time', label: L('Heure', 'Time'), type: 'time', value: '10:00', required: true })}
      ${field({ name: 'staff', label: L('Thérapeute / coach', 'Therapist / coach'), list: 'staffl' })}${field({ name: 'note', label: L('Note', 'Note') })}</div><datalist id="staffl">${staff.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`,
      onSubmit: (x) => api.post('/api/hotel/appointments', { product_id: Number(x.product_id), booking_id: Number(x.booking_id) || undefined, guest_name: x.guest_name, start_at: `${x.date}T${x.time}`, staff: x.staff, note: x.note }) });
    if (v) ctx.rerender();
  });
}, true);

// ===================== Concierge & guest requests =====================
const QST = { open: ['warn', 'À traiter', 'Open'], in_progress: ['info', 'En cours', 'In progress'], done: ['ok', 'Fait', 'Done'], refused: ['', 'Refusé', 'Refused'] };
R('/hotel/requests', async (ctx) => {
  ctx.title(L('Conciergerie et demandes', 'Concierge & requests'));
  const all = ctx.query.all === '1';
  ctx.actions(`<a class="btn" href="#/hotel/requests${all ? '' : '?all=1'}">${all ? L('À traiter', 'Open') : L('Historique', 'History')}</a><button class="btn primary" id="new">${icon('plus')}${L('Demande', 'Request')}</button>`);
  const rows = await api.get(`/api/hotel/requests${qs({ open: all ? '' : 1 })}`, { cache: false });
  ctx.el.innerHTML = table({ rows, columns: [
    { label: L('Demande', 'Request'), render: (q) => `<b>${esc(reqName(q.kind))}</b>${q.detail ? `<div class="sm">${esc(q.detail)}</div>` : ''}<div class="muted sm">${q.origin === 'guest' ? `<span class="pill info">${L('appli client', 'guest app')}</span> ` : ''}${dt(q.created_at)} ${time(q.created_at)} · ${ago(q.created_at)}${q.due_at ? ` · ${L('pour', 'for')} ${esc(q.due_at.replace('T', ' '))}` : ''}</div>` },
    { label: L('Chambre', 'Room'), render: (q) => (q.room_number ? `<b>${esc(q.room_number)}</b><div class="muted sm">${esc(q.guest_name || '')}</div>` : '—') },
    { label: L('Statut', 'Status'), render: (q) => `${p2(QST, q.status)}${q.assigned_name ? `<div class="muted sm">${esc(q.assigned_name)}</div>` : ''}` },
    { label: '', cls: 'r', render: (q) => (['open', 'in_progress'].includes(q.status) ? `${q.status === 'open' ? `<button class="btn sm" data-s="in_progress" data-id="${q.id}">${L('Je prends', 'Take')}</button>` : ''}<button class="btn sm primary" data-s="done" data-id="${q.id}">${L('Fait', 'Done')}</button><button class="btn sm" data-s="refused" data-id="${q.id}">${icon('x')}</button>` : '') }],
  empty: `<b>${L('Aucune demande en attente', 'No pending request')}</b><p class="muted">${L('Les demandes envoyées depuis l\'appli client (QR en chambre) arrivent ici en direct.', 'Requests from the guest app (QR in room) arrive here live.')}</p>` });
  ctx.el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => api.put(`/api/hotel/requests/${b.dataset.id}`, { status: b.dataset.s }).then(() => ctx.rerender()).catch(fail));
  document.getElementById('new').onclick = async () => {
    const stays = await inHouse();
    const v = await dialog({ title: L('Nouvelle demande', 'New request'), submit: L('Enregistrer', 'Save'),
      body: `<div class="f2">${field({ name: 'booking_id', label: L('Client', 'Guest'), type: 'select', options: stayOpts(stays, L('— sans chambre —', '— no room —')) })}${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: Object.entries(H().request_kinds) })}
      ${field({ name: 'detail', label: L('Détail', 'Detail'), type: 'textarea', span: true, placeholder: L('Taxi pour l\'aéroport à 6 h, 2 valises', 'Airport taxi at 6am, 2 bags') })}${field({ name: 'due_at', label: L('Pour quand', 'When'), type: 'datetime-local' })}</div>`,
      onSubmit: (x) => api.post('/api/hotel/requests', { ...x, booking_id: Number(x.booking_id) || undefined }) });
    if (v) ctx.rerender();
  };
}, true);

// ===================== Key cards =====================
R('/hotel/keys', async (ctx) => {
  ctx.title(L('Cartes-clés', 'Key cards'));
  const rows = await api.get('/api/hotel/keys', { cache: false });
  const mode = H().settings.lock_mode;
  const KS = { active: ['ok', 'Active', 'Active'], revoked: ['', 'Désactivée', 'Revoked'], lost: ['bad', 'Perdue', 'Lost'], expired: ['', 'Expirée', 'Expired'] };
  ctx.el.innerHTML = `<div class="grid g2">
    <div class="card"><h3>${icon('scan')} ${L('Lire une carte', 'Read a card')}</h3><p class="muted sm" style="margin-top:0">${L('Passez la carte sur le lecteur RFID (ou tapez son numéro) pour retrouver le client, sa chambre et son solde.', 'Tap the card on the RFID reader (or type its number) to find the guest, room and balance.')}</p>
      <div class="row"><input class="in mono" id="uid" placeholder="${L('N° de carte', 'Card no.')}" style="flex:1" autofocus><button class="btn primary" id="read">${L('Lire', 'Read')}</button></div><div id="res" style="margin-top:10px"></div></div>
    <div class="card"><h3>${icon('lock')} ${L('Serrures', 'Door locks')}</h3>
      <p>${mode === 'bridge' ? `<span class="pill ok">${L('Connecté', 'Connected')}</span> ${L('Les cartes sont écrites par l\'encodeur de votre système de serrures.', 'Cards are written by your lock system encoder.')}` : `<span class="pill warn">${L('Démonstration', 'Demo')}</span> ${L('Aucun encodeur relié : les cartes sont simulées. Reliez Salto, VingCard / ASSA ABLOY, dormakaba, Onity ou tout système à pont HTTP en renseignant LOCK_SYSTEM=bridge.', 'No encoder linked: cards are simulated. Link Salto, VingCard / ASSA ABLOY, dormakaba, Onity or any HTTP bridge with LOCK_SYSTEM=bridge.')}`}</p>
      <p class="muted sm">${L('Chaque carte s\'ouvre uniquement pour la chambre et la durée du séjour, avec les accès choisis (piscine, salle de sport, ascenseur…). Elle est désactivée automatiquement au départ ou en cas de perte.', 'Each card opens only its room for the stay, plus chosen access (pool, gym, lift…). It is disabled automatically at check-out or when lost.')}</p></div></div>
  <h3 style="margin-top:18px">${L('Dernières cartes encodées', 'Recent key cards')}</h3>
  ${table({ rows, href: (k) => `#/hotel/booking/${k.booking_id}`, columns: [
    { label: L('Carte', 'Card'), render: (k) => `<span class="mono">${esc(k.card_uid)}</span><div class="muted sm">${esc(k.holder || '')}</div>` },
    { label: L('Chambre', 'Room'), render: (k) => `<b>${esc(k.room_number)}</b><div class="muted sm">${esc(k.guest_name)}</div>` },
    { label: L('Validité', 'Valid'), hideM: true, render: (k) => `${dt(k.valid_from)} → ${dt(k.valid_to)} ${time(k.valid_to)}<div class="muted sm">${esc((k.access || '').split(',').filter(Boolean).map((a) => H().access[a] || a).join(', '))}</div>` },
    { label: L('Statut', 'Status'), render: (k) => p2(KS, k.status) },
    { label: '', cls: 'r', render: (k) => (k.status === 'active' ? `<button class="btn sm" data-rv="${k.id}">${L('Désactiver', 'Revoke')}</button><button class="btn sm danger" data-lost="${k.id}">${L('Perdue', 'Lost')}</button>` : '') }] })}`;
  const read = async () => {
    const uid = ctx.el.querySelector('#uid').value.trim(); if (!uid) return;
    const res = ctx.el.querySelector('#res');
    try {
      const k = await api.get(`/api/hotel/keys/lookup?uid=${encodeURIComponent(uid)}`, { cache: false });
      res.innerHTML = `<a class="card row between" href="#/hotel/booking/${k.booking_id}" style="margin:0"><span><b>${L('Chambre', 'Room')} ${esc(k.room_number)}</b> · ${esc(k.guest_name)} ${vipBadge(k.vip)}<div class="muted sm">${esc(k.number)}</div></span><b class="num" style="color:${k.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(k.balance)}</b></a>`;
    } catch (e) { res.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  };
  ctx.el.querySelector('#read').onclick = read;
  ctx.el.querySelector('#uid').addEventListener('keydown', (e) => { if (e.key === 'Enter') read(); });
  ctx.el.querySelectorAll('[data-rv],[data-lost]').forEach((b) => b.onclick = async () => {
    const lost = !!b.dataset.lost;
    if (!(await confirmDlg(lost ? L('Carte perdue', 'Lost card') : L('Désactiver la carte', 'Revoke card'), lost ? L('La carte n\'ouvrira plus aucune porte. Encodez-en une nouvelle pour le client.', 'The card will open no door. Encode a new one for the guest.') : L('La carte n\'ouvrira plus la chambre.', 'The card will no longer open the room.'), L('Confirmer', 'Confirm'), true))) return;
    api.post(`/api/hotel/keys/${b.dataset.rv || b.dataset.lost}/revoke`, { lost }).then(() => ctx.rerender()).catch(fail);
  });
});

// ===================== Night audit =====================
R('/hotel/audit', async (ctx) => {
  ctx.title(L('Audit de nuit', 'Night audit'));
  const a = await api.get('/api/hotel/night-audit', { cache: false });
  const issues = [
    [a.pending_arrivals.length, L('arrivée(s) non enregistrée(s) : elles passeront en no-show (sauf réservations garanties à vérifier)', 'arrival(s) not checked in: they will become no-shows'), a.pending_arrivals.map((b) => `<a href="#/hotel/booking/${b.id}">${esc(b.guest_name)}</a>`).join(', ')],
    [a.overstays.length, L('départ(s) dépassé(s) : la nuit sera facturée', 'overdue departure(s): the night will be charged'), a.overstays.map((b) => `<a href="#/hotel/booking/${b.id}">${esc(b.room_number)} ${esc(b.guest_name)}</a>`).join(', ')],
    [a.undeclared.length, L('chambre(s) vue(s) occupée(s) sans client', 'room(s) seen occupied without guest'), a.undeclared.map(esc).join(', ')],
    [a.open_orders, L('commande(s) restaurant / bar non réglée(s)', 'unsettled restaurant / bar order(s)'), `<a href="#/hotel/outlet">${L('Voir', 'View')}</a>`],
  ];
  ctx.el.innerHTML = `<div class="grid g2">
    <div class="card"><h3>${icon('moon')} ${L('Clôture de la journée du', 'Close the day of')} ${dayName(a.business_date)}</h3>
      <p class="muted">${L('L\'audit facture la nuit de chaque client en chambre (hébergement, petit-déjeuner, taxe de séjour), passe les absents en no-show, remet les chambres occupées en « à faire », désactive les cartes expirées, calcule occupation, prix moyen et RevPAR, puis passe à la date suivante. Il se lance aussi tout seul à', 'The audit charges every in-house night (room, breakfast, tourist tax), marks no-shows, sets stayovers to clean, expires key cards, computes occupancy, ADR and RevPAR, then moves to the next date. It also runs by itself at')} ${a.audit_hour} h.</p>
      ${issues.map(([n, l, x]) => `<div class="row between lrow"><span>${n ? `<b style="color:var(--warn)">${n}</b>` : '<b style="color:var(--ok)">0</b>'} ${l}</span><span class="sm">${n ? x : ''}</span></div>`).join('')}
      <div class="row between lrow"><span>${L('Clients en chambre', 'In-house stays')}</span><b>${a.in_house}</b></div>
      ${a.can_run ? `<button class="btn primary" id="run" style="margin-top:14px">${icon('moon')}${L('Lancer l\'audit et passer au', 'Run audit and move to')} ${dt(addDays(a.business_date, 1))}</button>` : `<p class="banner info" style="margin-top:14px">${L('La journée du', 'The day of')} ${dt(a.business_date)} ${L('n\'est pas encore terminée.', 'has not finished yet.')}</p>`}
      <div id="out"></div></div>
    <div class="card"><h3>${L('Journées clôturées', 'Closed days')}</h3>
      ${table({ rows: a.history.slice(0, 20), columns: [
        { label: L('Date', 'Date'), render: (d) => `${dt(d.date)}<div class="muted sm">${esc(d.user_name || L('automatique', 'automatic'))}</div>` },
        { label: 'Occ.', cls: 'r', render: (d) => `${d.rooms - d.ooo ? Math.round(d.sold * 100 / (d.rooms - d.ooo)) : 0} %<div class="muted sm">${d.sold}/${d.rooms - d.ooo}</div>` },
        { label: 'ADR', cls: 'r num', hideM: true, render: (d) => money(d.sold ? d.room_revenue / d.sold : 0) },
        { label: L('CA HT', 'Revenue'), cls: 'r num', render: (d) => money(d.room_revenue + d.other_revenue) },
        { label: L('Encaissé', 'Collected'), cls: 'r num', hideM: true, render: (d) => money(d.payments) }] })}</div></div>`;
  document.getElementById('run')?.addEventListener('click', async () => {
    if (!(await confirmDlg(L('Audit de nuit', 'Night audit'), `${L('Clôturer la journée du', 'Close the day of')} ${dt(a.business_date)} ?`))) return;
    try {
      const r = await api.post('/api/hotel/night-audit');
      await refreshMeta();
      toast(`${L('Journée clôturée', 'Day closed')} · ${r.posted} ${L('nuitée(s)', 'night(s)')} · ${r.occupancy} %`, 'ok');
      ctx.rerender();
    } catch (e) { fail(e); }
  });
}, true);

// ===================== Reports =====================
R('/hotel/reports', async (ctx) => {
  ctx.title(L('Rapports hôteliers', 'Hotel reports'));
  const tab = ctx.query.tab || 'occupancy';
  const to = ctx.query.to || bd(), from = ctx.query.from || addDays(to, tab === 'occupancy' ? -30 : tab === 'police' ? -7 : 0);
  const tabs = [['occupancy', L('Occupation et revenus', 'Occupancy & revenue')], ['police', L('Registre de police', 'Police register')], ['cashier', L('Caisses', 'Cashiers')], ['feedback', L('Avis clients', 'Guest reviews')]];
  ctx.el.innerHTML = `<div class="row between" style="margin-bottom:14px;flex-wrap:wrap;gap:8px"><div class="tabs">${tabs.map(([k, l]) => `<a class="${k === tab ? 'on' : ''}" href="#/hotel/reports?tab=${k}">${l}</a>`).join('')}</div>
    <div class="row"><input type="date" class="in" id="from" value="${from}"><input type="date" class="in" id="to" value="${to}"></div></div><div id="rep"></div>`;
  const go = (k, v) => { location.hash = '/hotel/reports' + qs({ tab, from, to, [k]: v }); };
  ctx.el.querySelector('#from').onchange = (e) => go('from', e.target.value);
  ctx.el.querySelector('#to').onchange = (e) => go('to', e.target.value);
  const el = ctx.el.querySelector('#rep');
  if (tab === 'police') {
    ctx.actions(`<a class="btn" target="_blank" href="/print/hotel/police${qs({ from, to })}">${icon('print')}${L('Imprimer', 'Print')}</a><a class="btn" href="/api/hotel/reports/police${qs({ from, to, format: 'xlsx' })}">${icon('download')}Excel</a>`);
    const p = await api.get(`/api/hotel/reports/police${qs({ from, to })}`);
    el.innerHTML = `<p class="muted">${L('Fiche des voyageurs à présenter aux autorités : identité, pièce, provenance et destination de chaque client enregistré.', 'Traveller register for the authorities: identity, ID, origin and destination of every registered guest.')}</p>` + table({ rows: p.rows, columns: [
      { label: L('Arrivée', 'Arrival'), render: (r) => `${dt(r.checked_in_at)} ${time(r.checked_in_at)}<div class="muted sm">${L('Ch.', 'Rm')} ${esc(r.room_number || '')}</div>` },
      { label: L('Nom', 'Name'), render: (r) => `<b>${esc(r.name)}</b><div class="muted sm">${esc(r.nationality || '')}${r.birth_date ? ` · ${L('né(e) le', 'born')} ${dt(r.birth_date)}` : ''}${r.profession ? ` · ${esc(r.profession)}` : ''}</div>` },
      { label: L('Pièce', 'ID'), render: (r) => `${esc(r.id_type || '')} <span class="mono">${esc(r.id_number || '')}</span>` },
      { label: L('Provenance → destination', 'From → to'), hideM: true, render: (r) => `${esc(r.coming_from || '—')} → ${esc(r.going_to || '—')}` },
      { label: L('Départ', 'Departure'), hideM: true, render: (r) => dt(r.checked_out_at || r.departure) }] });
    return;
  }
  if (tab === 'cashier') {
    const c = await api.get(`/api/hotel/reports/cashier${qs({ from, to })}`);
    const methods = [...new Set(c.rows.flatMap((r) => Object.keys(r.methods)))];
    el.innerHTML = table({ rows: c.rows, columns: [
      { label: L('Caissier', 'Cashier'), render: (r) => `<b>${esc(r.user)}</b><div class="muted sm">${r.count} ${L('opération(s)', 'operation(s)')}${r.eur ? ` · ${num(r.eur)} EUR` : ''}${r.usd ? ` · ${num(r.usd)} USD` : ''}</div>` },
      ...methods.map((m) => ({ label: payName(m), cls: 'r num', render: (r) => (r.methods[m] ? money(r.methods[m]) : '') })),
      { label: L('Remboursé', 'Refunded'), cls: 'r num', hideM: true, render: (r) => (r.refunds ? money(r.refunds) : '') },
      { label: 'Total', cls: 'r num', render: (r) => `<b>${money(r.total)}</b>` }],
    empty: `<b>${L('Aucun encaissement sur la période', 'No payments in this period')}</b>` });
    return;
  }
  ctx.actions(`<a class="btn" href="/api/hotel/reports/occupancy${qs({ from, to, format: 'xlsx' })}">${icon('download')}Excel</a>`);
  const o = await api.get(`/api/hotel/reports/occupancy${qs({ from, to })}`);
  if (tab === 'feedback') {
    const f = o.feedback; const st = (v) => (v ? `${String(v).replace('.', ',')} / 5` : '—');
    el.innerHTML = `<div class="grid g4">${kpi(L('Note globale', 'Overall'), st(f.rating), `${f.n} ${L('avis', 'reviews')}`, 'accent')}${kpi(L('Propreté', 'Cleanliness'), st(f.cleanliness))}${kpi(L('Service', 'Service'), st(f.service))}${kpi(L('Restauration', 'Food'), st(f.food))}</div>
    <div class="card" style="margin-top:16px">${f.comments.map((c) => `<div class="lrow"><div class="row between"><b>${esc(c.guest_name)} <span class="muted sm">${L('ch.', 'rm')} ${esc(c.room_number || '')}</span></b><span style="color:#E3A008">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span></div>${c.comment ? `<p style="margin:4px 0">${esc(c.comment)}</p>` : ''}<div class="muted sm">${dt(c.created_at)}</div></div>`).join('') || `<p class="muted">${L('Aucun avis sur la période. Les clients notent leur séjour depuis l\'appli client.', 'No reviews in this period. Guests rate their stay from the guest app.')}</p>`}</div>`;
    return;
  }
  const t = o.totals; const maxR = Math.max(1, ...o.days.map((d) => d.room_revenue + d.other_revenue));
  const list = (rows, label, val, sub) => (rows.length ? `<div class="bar-list">${rows.map((r) => `<div class="it"><span>${label(r)}</span><b class="num">${money(val(r))}</b><div class="tr"><i style="width:${(val(r) / Math.max(1, ...rows.map(val))) * 100}%"></i></div>${sub ? `<div class="muted sm">${sub(r)}</div>` : ''}</div>`).join('')}</div>` : `<p class="muted">${L('Pas encore de données', 'No data yet')}</p>`);
  el.innerHTML = `<div class="grid g4">
    ${kpi(L('Taux d\'occupation', 'Occupancy'), `${String(t.occupancy).replace('.', ',')} %`, `${num(t.sold)} / ${num(t.avail)} ${L('nuitées', 'room nights')}`, 'accent')}
    ${kpi(L('Prix moyen (ADR)', 'ADR'), money(t.adr), L('par chambre vendue, HT', 'per sold room, excl. VAT'))}
    ${kpi('RevPAR', money(t.revpar), L('par chambre disponible', 'per available room'))}
    ${kpi(L('Chiffre d\'affaires HT', 'Revenue excl. VAT'), money(t.rev + t.other), `${L('hébergement', 'rooms')} ${money(t.rev)}`)}</div>
  <div class="card" style="margin-top:16px"><h3>${L('Chiffre d\'affaires par jour', 'Daily revenue')}</h3>
    <div class="hbars">${o.days.map((d) => `<div class="hb" title="${dt(d.date)} : ${d.occupancy} % · ${money(d.room_revenue)} + ${money(d.other_revenue)}"><i style="height:${((d.room_revenue + d.other_revenue) / maxR) * 100}%"></i><span>${d.date.slice(8)}</span></div>`).join('') || `<p class="muted">${L('Les chiffres apparaissent après chaque audit de nuit.', 'Figures appear after each night audit.')}</p>`}</div></div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>${L('Par canal de réservation', 'By booking channel')}</h3>${list(o.bySource, (r) => esc(sourceName(r.source)), (r) => r.revenue, (r) => `${r.bookings} ${L('réservation(s)', 'booking(s)')} · ${r.nights} ${L('nuits', 'nights')}`)}</div>
    <div class="card"><h3>${L('Par type de chambre', 'By room type')}</h3>${list(o.byType, (r) => esc(r.name), (r) => r.revenue, (r) => `${r.nights} ${L('nuits', 'nights')} · ADR ${money(r.revenue / r.nights)}`)}</div>
    <div class="card"><h3>${L('Par service', 'By department')}</h3>${list(o.byOutlet, (r) => esc(outletName(r.outlet)), (r) => r.revenue)}</div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${L('Nationalités', 'Nationalities')}</h3>${o.nationalities.map((n) => `<div class="row between lrow"><span>${esc(n.nationality)}</span><b>${n.stays}</b></div>`).join('') || `<p class="muted">—</p>`}</div>
    <div class="card"><h3>${L('Autres indicateurs', 'Other figures')}</h3>
      <div class="row between lrow"><span>${L('Clients hébergés (nuitées-personnes)', 'Guest nights')}</span><b>${num(t.guests)}</b></div>
      <div class="row between lrow"><span>No-shows</span><b>${num(t.no_shows)}</b></div>
      <div class="row between lrow"><span>${L('Taxe de séjour collectée (à reverser)', 'Tourist tax collected')}</span><b class="num">${money(o.tourist_tax)}</b></div>
      <div class="row between lrow"><span>${L('Chambres vues occupées sans client', 'Rooms seen occupied without guest')}</span><b style="color:${t.undeclared ? 'var(--bad)' : 'inherit'}">${num(t.undeclared)}</b></div>
      <div class="row between lrow"><span>${L('Satisfaction', 'Satisfaction')}</span><b>${o.feedback.rating ? `${String(o.feedback.rating).replace('.', ',')} / 5` : '—'}</b></div></div></div>`;
});

// ===================== Hotel settings =====================
R('/hotel/settings', async (ctx) => {
  ctx.title(L('Réglages de l\'hôtel', 'Hotel settings'));
  await refreshMeta();
  const h = H(), s = h.settings;
  const tab = ctx.query.tab || 'general';
  const tabs = [['general', L('Général', 'General')], ['rooms', L('Chambres', 'Rooms')], ['rates', L('Tarifs et saisons', 'Rates & seasons')], ['outlets', L('Restaurant, bar, spa', 'F&B, spa')], ['channels', L('Réservation en ligne', 'Online booking')]];
  ctx.el.innerHTML = `<div class="tabs" style="margin-bottom:14px;overflow-x:auto">${tabs.map(([k, l]) => `<a class="${k === tab ? 'on' : ''}" href="#/hotel/settings?tab=${k}">${l}</a>`).join('')}</div><div id="set"></div>`;
  const el = ctx.el.querySelector('#set');
  const again = () => refreshMeta().then(() => ctx.rerender());
  if (tab === 'general') {
    el.innerHTML = `<form class="card" id="f"><div class="f3">
      ${field({ name: 'stars', label: L('Étoiles', 'Stars'), type: 'number', min: 0, value: s.stars })}${field({ name: 'checkin_time', label: L('Heure d\'arrivée', 'Check-in time'), type: 'time', value: s.checkin_time })}${field({ name: 'checkout_time', label: L('Heure de départ', 'Check-out time'), type: 'time', value: s.checkout_time })}
      ${field({ name: 'tourist_tax', label: L('Taxe de séjour (FCFA)', 'Tourist tax (FCFA)'), type: 'number', min: 0, value: s.tourist_tax })}${field({ name: 'tourist_tax_mode', label: L('Calculée par', 'Charged per'), type: 'select', value: s.tourist_tax_mode, options: [['room', L('chambre et nuit', 'room per night')], ['person', L('personne et nuit', 'person per night')], ['none', L('pas de taxe', 'no tax')]] })}
      ${field({ name: 'breakfast_price', label: L('Petit-déjeuner par personne', 'Breakfast per person'), type: 'number', min: 0, value: s.breakfast_price })}
      ${field({ name: 'deposit_pct', label: L('Acompte demandé (%)', 'Deposit (%)'), type: 'number', min: 0, value: s.deposit_pct })}${field({ name: 'late_checkout_fee', label: L('Départ tardif (FCFA)', 'Late check-out fee'), type: 'number', min: 0, value: s.late_checkout_fee })}
      ${field({ name: 'audit_hour', label: L('Audit de nuit automatique à (heure)', 'Automatic night audit at (hour)'), type: 'number', min: 0, value: s.audit_hour })}
      ${field({ name: 'eur_rate', label: '1 EUR = FCFA', type: 'number', step: '0.001', value: s.eur_rate })}${field({ name: 'usd_rate', label: '1 USD = FCFA', type: 'number', step: '0.01', value: s.usd_rate })}
      ${field({ name: 'points_per_1000', label: L('Points fidélité par 1 000 FCFA', 'Loyalty points per 1,000 FCFA'), type: 'number', min: 0, value: s.points_per_1000 })}
      ${field({ name: 'wifi_name', label: L('Nom du Wi-Fi', 'Wi-Fi name'), value: s.wifi_name })}${field({ name: 'wifi_password', label: L('Mot de passe Wi-Fi', 'Wi-Fi password'), value: s.wifi_password })}
      ${field({ name: 'manager_pin', label: s.has_pin ? L('Nouveau code responsable', 'New manager code') : L('Code responsable (4 à 8 chiffres)', 'Manager code (4–8 digits)'), type: 'password', hint: L('Demandé pour les remises, annulations de prestations, surréservations et départs sans paiement.', 'Required for discounts, voids, overbooking and unpaid departures.') })}
      ${field({ name: 'welcome_text', label: L('Message de bienvenue (appli client)', 'Welcome message (guest app)'), type: 'textarea', span: true, value: s.welcome_text })}</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary">${L('Enregistrer', 'Save')}</button></div></form>`;
    el.querySelector('#f').onsubmit = (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); if (!v.manager_pin) delete v.manager_pin; api.put('/api/hotel/settings', v).then(() => { toast(L('Enregistré', 'Saved'), 'ok'); again(); }).catch(fail); };
    return;
  }
  if (tab === 'rooms') {
    ctx.actions(`<a class="btn" target="_blank" href="/print/hotel/room-qr">${icon('print')}<span class="hide-m">${L('QR codes des chambres', 'Room QR codes')}</span></a><button class="btn" id="nt">${icon('plus')}${L('Type', 'Type')}</button><button class="btn primary" id="nr">${icon('plus')}${L('Chambres', 'Rooms')}</button>`);
    el.innerHTML = `<h3>${L('Types de chambres', 'Room types')}</h3>${table({ rows: h.types, columns: [
      { label: L('Type', 'Type'), render: (t) => `<b>${esc(t.name)}</b> <span class="muted sm">${esc(t.code)}</span>${t.active ? '' : ` <span class="pill">${L('inactif', 'inactive')}</span>`}<div class="muted sm">${esc((t.amenities || '').slice(0, 90))}</div>` },
      { label: L('Capacité', 'Capacity'), render: (t) => `${t.capacity} pers.` },
      { label: L('Prix nuit TTC', 'Nightly rate'), cls: 'r num', render: (t) => `${money(t.base_rate)}${t.weekend_rate ? `<div class="muted sm">${L('week-end', 'weekend')} ${money(t.weekend_rate)}</div>` : ''}` },
      { label: L('Passage', 'Day use'), cls: 'r num', hideM: true, render: (t) => (t.day_use_rate ? money(t.day_use_rate) : '—') },
      { label: L('Chambres', 'Rooms'), cls: 'r', render: (t) => h.rooms.filter((r) => r.type_id === t.id && r.active).length },
      { label: '', cls: 'r', render: (t) => `<button class="btn sm" data-t="${t.id}">${L('Modifier', 'Edit')}</button>` }] })}
    <h3 style="margin-top:18px">${L('Chambres', 'Rooms')}</h3>${table({ rows: h.rooms, columns: [
      { label: 'N°', render: (r) => `<b>${esc(r.number)}</b>${r.active ? '' : ` <span class="pill">${L('inactive', 'inactive')}</span>`}${r.out_of_order ? ` <span class="pill bad">${L('hors service', 'OOO')}</span>` : ''}` },
      { label: L('Type', 'Type'), render: (r) => esc(r.type_name) },
      { label: L('Étage', 'Floor'), render: (r) => esc(r.floor) },
      { label: L('Vue', 'View'), hideM: true, render: (r) => esc(r.view) },
      { label: '', cls: 'r', render: (r) => `<a class="btn sm" target="_blank" href="/print/hotel/room-qr?ids=${r.id}">QR</a><button class="btn sm" data-r="${r.id}">${L('Modifier', 'Edit')}</button>` }] })}`;
    const typeDlg = (t = {}) => dialog({ title: t.id ? t.name : L('Nouveau type de chambre', 'New room type'), wide: true,
      body: `<div class="f3">${field({ name: 'code', label: 'Code', required: true, value: t.code, placeholder: 'DLX' })}${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: t.name, placeholder: 'Chambre Deluxe' })}${field({ name: 'capacity', label: L('Personnes max', 'Max guests'), type: 'number', min: 1, value: t.capacity || 2 })}
      ${field({ name: 'base_rate', label: L('Prix nuit TTC', 'Nightly rate incl. VAT'), type: 'number', min: 0, required: true, value: t.base_rate })}${field({ name: 'weekend_rate', label: L('Prix week-end (ven., sam.)', 'Weekend rate (Fri, Sat)'), type: 'number', min: 0, value: t.weekend_rate })}${field({ name: 'day_use_rate', label: L('Prix passage (journée)', 'Day-use rate'), type: 'number', min: 0, value: t.day_use_rate })}
      ${field({ name: 'extra_person', label: L('Personne supplémentaire / nuit', 'Extra person / night'), type: 'number', min: 0, value: t.extra_person })}${field({ name: 'position', label: L('Ordre', 'Order'), type: 'number', value: t.position || 0 })}${field({ name: 'image', label: L('Photo (lien https)', 'Photo (https link)'), value: t.image })}
      ${field({ name: 'amenities', label: L('Équipements', 'Amenities'), span: true, value: t.amenities, placeholder: 'Lit king size, vue mer, baignoire, Nespresso, coffre-fort, Wi-Fi fibre' })}
      ${field({ name: 'description', label: L('Description (site de réservation)', 'Description (booking site)'), type: 'textarea', span: true, value: t.description })}
      ${field({ name: 'online', label: L('Vendue en ligne', 'Sold online'), type: 'checkbox', value: t.id ? t.online : 1 })}${field({ name: 'active', label: L('Active', 'Active'), type: 'checkbox', value: t.id ? t.active : 1 })}</div>`,
      onSubmit: (v) => (t.id ? api.put(`/api/hotel/room-types/${t.id}`, v) : api.post('/api/hotel/room-types', v)) });
    document.getElementById('nt').onclick = () => typeDlg().then((x) => x && again()).catch(fail);
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => typeDlg(h.types.find((t) => t.id === Number(b.dataset.t))).then((x) => x && again()).catch(fail));
    document.getElementById('nr').onclick = () => {
      if (!h.types.length) return toast(L('Créez d\'abord un type de chambre', 'Create a room type first'), 'err');
      dialog({ title: L('Ajouter des chambres', 'Add rooms'),
        body: `<p class="muted sm" style="margin-top:0">${L('Une chambre (numéro) ou une série : de 101 à 120.', 'One room (number) or a range: 101 to 120.')}</p><div class="f2">${field({ name: 'type_id', label: L('Type', 'Type'), type: 'select', span: true, options: h.types.map((t) => [t.id, t.name]) })}
        ${field({ name: 'from', label: L('De', 'From'), type: 'number' })}${field({ name: 'to', label: L('À', 'To'), type: 'number' })}${field({ name: 'number', label: L('ou numéro', 'or number') })}${field({ name: 'view', label: L('Vue', 'View'), placeholder: L('Mer, piscine, ville', 'Sea, pool, city') })}</div>`,
        onSubmit: (v) => api.post('/api/hotel/rooms', v.from && v.to ? { type_id: Number(v.type_id), from: v.from, to: v.to, view: v.view } : { type_id: Number(v.type_id), number: v.number, view: v.view }) })
        .then((x) => { if (x) { toast(`${x.created} ${L('chambre(s) créée(s)', 'room(s) created')}`, 'ok'); again(); } }).catch(fail);
    };
    el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { const r = h.rooms.find((x) => x.id === Number(b.dataset.r));
      dialog({ title: `${L('Chambre', 'Room')} ${r.number}`, body: `<div class="f2">${field({ name: 'number', label: 'N°', value: r.number })}${field({ name: 'type_id', label: L('Type', 'Type'), type: 'select', options: h.types.map((t) => [t.id, t.name]), value: r.type_id })}
        ${field({ name: 'floor', label: L('Étage', 'Floor'), value: r.floor })}${field({ name: 'view', label: L('Vue', 'View'), value: r.view })}${field({ name: 'notes', label: L('Notes', 'Notes'), span: true, value: r.notes })}
        ${field({ name: 'active', label: L('Active', 'Active'), type: 'checkbox', value: r.active })}${field({ name: 'new_qr', label: L('Générer un nouveau QR code (l\'ancien ne marche plus)', 'New QR code (old one stops working)'), type: 'checkbox' })}</div>`,
        onSubmit: (v) => api.put(`/api/hotel/rooms/${r.id}`, { ...v, type_id: Number(v.type_id) }) }).then((x) => x && again()).catch(fail); });
    return;
  }
  if (tab === 'rates') {
    ctx.actions(`<button class="btn" id="ns">${icon('plus')}${L('Saison', 'Season')}</button><button class="btn primary" id="np">${icon('plus')}${L('Tarif', 'Rate plan')}</button>`);
    el.innerHTML = `<h3>${L('Plans tarifaires', 'Rate plans')}</h3><p class="muted sm">${L('Un plan applique un pourcentage au prix de la chambre : -15 % pour un tarif entreprise, +10 % pour une offre avec petit-déjeuner, etc. Liez-le à une entreprise pour un tarif négocié.', 'A plan applies a percentage to the room price: -15% corporate, +10% with breakfast, etc. Link it to a company for a negotiated rate.')}</p>
    ${table({ rows: h.plans, columns: [
      { label: L('Plan', 'Plan'), render: (p) => `<b>${esc(p.name)}</b> <span class="muted sm">${esc(p.code)}</span>${p.active ? '' : ` <span class="pill">${L('inactif', 'inactive')}</span>`}${p.partner_name ? `<div class="muted sm">${esc(p.partner_name)}</div>` : ''}` },
      { label: L('Ajustement', 'Adjustment'), cls: 'r', render: (p) => `${p.adjust_pct > 0 ? '+' : ''}${p.adjust_pct} %` },
      { label: L('Conditions', 'Terms'), render: (p) => [p.breakfast ? L('petit-déj. inclus', 'breakfast incl.') : '', p.refundable ? L('remboursable', 'refundable') : L('non remboursable', 'non-refundable'), p.min_nights > 1 ? `${p.min_nights} ${L('nuits min.', 'nights min')}` : '', p.online ? L('en ligne', 'online') : ''].filter(Boolean).join(' · ') },
      { label: '', cls: 'r', render: (p) => `<button class="btn sm" data-p="${p.id}">${L('Modifier', 'Edit')}</button>` }] })}
    <h3 style="margin-top:18px">${L('Saisons', 'Seasons')}</h3>${table({ rows: h.seasons, columns: [
      { label: L('Saison', 'Season'), render: (x) => `<b>${esc(x.name)}</b>` }, { label: L('Dates', 'Dates'), render: (x) => `${dt(x.date_from)} → ${dt(x.date_to)}` },
      { label: L('Ajustement', 'Adjustment'), cls: 'r', render: (x) => `${x.adjust_pct > 0 ? '+' : ''}${x.adjust_pct} %` }, { label: '', cls: 'r', render: (x) => `<button class="btn sm" data-ds="${x.id}">${icon('trash')}</button>` }],
    empty: `<b>${L('Aucune saison', 'No season')}</b><p class="muted">${L('Ex. : haute saison +20 % en décembre, fêtes de fin d\'année, grands événements.', 'E.g. high season +20% in December, major events.')}</p>` })}`;
    const partners = await api.get('/api/partners?kind=client').catch(() => []);
    const planDlg = (p = {}) => dialog({ title: p.id ? p.name : L('Nouveau plan tarifaire', 'New rate plan'),
      body: `<div class="f2">${field({ name: 'code', label: 'Code', required: true, value: p.code, placeholder: 'CORP' })}${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: p.name, placeholder: L('Tarif entreprise', 'Corporate rate') })}
      ${field({ name: 'adjust_pct', label: L('Ajustement (%)', 'Adjustment (%)'), type: 'number', step: '0.1', value: p.adjust_pct || 0 })}${field({ name: 'min_nights', label: L('Nuits minimum', 'Minimum nights'), type: 'number', min: 1, value: p.min_nights || 1 })}
      ${field({ name: 'partner_id', label: L('Réservé à l\'entreprise', 'Reserved for company'), type: 'select', span: true, value: p.partner_id || '', options: [['', L('— tous —', '— everyone —')], ...partners.map((x) => [x.id, x.name])] })}
      ${field({ name: 'breakfast', label: L('Petit-déjeuner inclus', 'Breakfast included'), type: 'checkbox', value: p.breakfast })}${field({ name: 'refundable', label: L('Remboursable', 'Refundable'), type: 'checkbox', value: p.id ? p.refundable : 1 })}
      ${field({ name: 'online', label: L('Proposé sur le site', 'Offered online'), type: 'checkbox', value: p.online })}${field({ name: 'active', label: L('Actif', 'Active'), type: 'checkbox', value: p.id ? p.active : 1 })}</div>`,
      onSubmit: (v) => { v.partner_id = Number(v.partner_id) || null; return p.id ? api.put(`/api/hotel/rate-plans/${p.id}`, v) : api.post('/api/hotel/rate-plans', v); } });
    document.getElementById('np').onclick = () => planDlg().then((x) => x && again()).catch(fail);
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => planDlg(h.plans.find((p) => p.id === Number(b.dataset.p))).then((x) => x && again()).catch(fail));
    document.getElementById('ns').onclick = () => dialog({ title: L('Nouvelle saison', 'New season'), body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, span: true, placeholder: L('Fêtes de fin d\'année', 'Festive season') })}${field({ name: 'date_from', label: L('Du', 'From'), type: 'date', required: true })}${field({ name: 'date_to', label: L('Au', 'To'), type: 'date', required: true })}${field({ name: 'adjust_pct', label: L('Ajustement (%)', 'Adjustment (%)'), type: 'number', value: 20 })}</div>`,
      onSubmit: (v) => api.post('/api/hotel/seasons', v) }).then((x) => x && again()).catch(fail);
    el.querySelectorAll('[data-ds]').forEach((b) => b.onclick = () => api.del(`/api/hotel/seasons/${b.dataset.ds}`).then(again).catch(fail));
    return;
  }
  if (tab === 'outlets') {
    ctx.actions(`<button class="btn" id="no">${icon('plus')}${L('Point de vente', 'Outlet')}</button><button class="btn primary" id="ni">${icon('plus')}${L('Article', 'Item')}</button>`);
    const items = await api.get('/api/hotel/items?all=1');
    const oid = Number(ctx.query.o || h.outlets[0]?.id);
    el.innerHTML = `<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:12px">${h.outlets.map((o) => `<a class="btn sm ${o.id === oid ? 'primary' : ''}" href="#/hotel/settings?tab=outlets&o=${o.id}">${esc(o.name)} <span class="muted sm">${items.filter((i) => i.outlet_id === o.id).length}</span></a>`).join('')}</div>
    ${(() => { const o = h.outlets.find((x) => x.id === oid); return o ? `<div class="card row between" style="margin-bottom:12px"><span><b>${esc(o.name)}</b> · ${esc(outletName(o.kind))} · ${L('compte', 'account')} ${esc(o.account_code)}${o.kitchen ? ` · ${L('passe par l\'écran cuisine', 'goes to kitchen screen')}` : ''}${o.active ? '' : ` · <span class="pill">${L('inactif', 'inactive')}</span>`}</span><button class="btn sm" id="eo">${L('Modifier', 'Edit')}</button></div>` : ''; })()}
    ${table({ rows: items.filter((i) => i.outlet_id === oid), columns: [
      { label: L('Article', 'Item'), render: (i) => `<b>${esc(i.name)}</b>${i.active ? '' : ` <span class="pill">${L('inactif', 'inactive')}</span>`}<div class="muted sm">${esc(i.category || '')}${i.duration ? ` · ${i.duration} min` : ''}</div>` },
      { label: L('Prix TTC', 'Price'), cls: 'r num', render: (i) => money(i.price) },
      { label: L('Appli client', 'Guest app'), hideM: true, render: (i) => (i.portal ? '✓' : '') },
      { label: '', cls: 'r', render: (i) => `<button class="btn sm" data-i="${i.id}">${L('Modifier', 'Edit')}</button>` }],
    empty: `<b>${L('Aucun article', 'No items')}</b>` })}`;
    const itemDlg = (i = {}) => dialog({ title: i.id ? i.name : L('Nouvel article', 'New item'),
      body: `<div class="f2">${field({ name: 'outlet_id', label: L('Point de vente', 'Outlet'), type: 'select', options: h.outlets.map((o) => [o.id, o.name]), value: i.outlet_id || oid })}${field({ name: 'category', label: L('Catégorie', 'Category'), value: i.category, placeholder: L('Plats, Vins, Massages…', 'Mains, Wines, Massages…') })}
      ${field({ name: 'name', label: L('Nom', 'Name'), required: true, span: true, value: i.name })}${field({ name: 'price', label: L('Prix TTC', 'Price incl. VAT'), type: 'number', min: 0, required: true, value: i.price })}
      ${field({ name: 'duration', label: L('Durée en minutes (soins, activités)', 'Duration in minutes (treatments)'), type: 'number', min: 0, value: i.duration || 0 })}
      ${field({ name: 'description', label: L('Description', 'Description'), span: true, value: i.description })}${field({ name: 'image', label: L('Photo (lien https)', 'Photo (https link)'), span: true, value: i.image })}
      ${field({ name: 'portal', label: L('Commandable depuis l\'appli client', 'Orderable from the guest app'), type: 'checkbox', value: i.id ? i.portal : 1 })}${i.id ? field({ name: 'active', label: L('Actif', 'Active'), type: 'checkbox', value: i.active }) : ''}</div>`,
      onSubmit: (v) => { v.outlet_id = Number(v.outlet_id); return i.id ? api.put(`/api/hotel/items/${i.id}`, v) : api.post('/api/hotel/items', v); } });
    document.getElementById('ni').onclick = () => itemDlg().then((x) => x && ctx.rerender()).catch(fail);
    el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => itemDlg(items.find((i) => i.id === Number(b.dataset.i))).then((x) => x && ctx.rerender()).catch(fail));
    document.getElementById('no').onclick = () => dialog({ title: L('Nouveau point de vente', 'New outlet'), body: `<div class="f2">${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: Object.entries(h.outlet_kinds).map(([k, v]) => [k, L(v.fr, v.en)]) })}${field({ name: 'name', label: L('Nom', 'Name'), required: true, placeholder: 'Rooftop Lounge' })}${field({ name: 'code', label: 'Code' })}${field({ name: 'kitchen', label: L('Les commandes passent par l\'écran cuisine / bar', 'Orders go to the kitchen / bar screen'), type: 'checkbox' })}</div>`,
      onSubmit: (v) => api.post('/api/hotel/outlets', v) }).then((x) => x && again()).catch(fail);
    document.getElementById('eo')?.addEventListener('click', () => { const o = h.outlets.find((x) => x.id === oid);
      dialog({ title: o.name, body: `${field({ name: 'name', label: L('Nom', 'Name'), value: o.name })}${field({ name: 'kitchen', label: L('Les commandes passent par l\'écran cuisine / bar', 'Orders go to the kitchen / bar screen'), type: 'checkbox', value: o.kitchen })}${field({ name: 'active', label: L('Actif', 'Active'), type: 'checkbox', value: o.active })}`,
        onSubmit: (v) => api.put(`/api/hotel/outlets/${o.id}`, v) }).then((x) => x && again()).catch(fail); });
    return;
  }
  // channels: website booking engine, iCal import/export
  const book = `${h.public_url}/book?h=${state.me.company.id}`;
  el.innerHTML = `<div class="card"><h3>${icon('globe')} ${L('Votre moteur de réservation', 'Your booking engine')}</h3>
    <p class="muted">${L('Une page de réservation à votre nom, sans commission : le client choisit ses dates et sa chambre, paie l\'acompte par MTN MoMo ou Orange Money et reçoit le lien de son espace client. Mettez le lien sur votre site, Instagram, Facebook et WhatsApp Business.', 'A commission-free booking page in your name: the guest picks dates and room, pays the deposit by MTN MoMo or Orange Money and receives the guest app link. Put the link on your website, Instagram, Facebook and WhatsApp Business.')}</p>
    <div class="row"><input class="in mono" readonly value="${esc(book)}" style="flex:1"><a class="btn" target="_blank" href="${esc(book)}">${L('Ouvrir', 'Open')}</a></div>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="ob" ${s.online_booking ? 'checked' : ''}> ${L('Réservation en ligne ouverte', 'Online booking open')}</label></div>
  <div class="card" style="margin-top:16px"><h3>${L('Booking.com, Airbnb, Expedia (calendriers iCal)', 'Booking.com, Airbnb, Expedia (iCal calendars)')}</h3>
    <p class="muted sm">${L('1. Importez : collez le lien iCal donné par le site, les réservations arrivent toutes seules (toutes les 30 min). 2. Exportez : donnez au site le lien ci-dessous pour fermer les dates déjà vendues chez vous. Fini les doubles réservations.', '1. Import: paste the iCal link from the site, bookings arrive every 30 min. 2. Export: give the site the link below so it closes dates you have sold. No more double bookings.')}</p>
    ${table({ rows: h.ical, columns: [
      { label: L('Site', 'Channel'), render: (i) => `<b>${esc(i.channel)}</b><div class="muted sm">${esc(i.type_name)}</div>` },
      { label: L('Dernière synchro', 'Last sync'), render: (i) => `${i.last_sync ? `${dt(i.last_sync)} ${time(i.last_sync)}` : '—'}<div class="muted sm">${esc(i.last_result || '')}</div>` },
      { label: '', cls: 'r', render: (i) => `<button class="btn sm" data-sy="${i.id}">${L('Synchroniser', 'Sync')}</button><button class="btn sm" data-di="${i.id}">${icon('trash')}</button>` }],
    empty: `<b>${L('Aucun calendrier importé', 'No calendar imported')}</b>` })}
    <button class="btn" id="ai" style="margin-top:10px">${icon('plus')}${L('Importer un calendrier', 'Import a calendar')}</button>
    <h4 style="margin-top:18px">${L('Liens à donner aux sites (export)', 'Links to give the channels (export)')}</h4>
    ${h.ical_export.map((x) => `<div class="row lrow"><span style="min-width:140px">${esc(x.name)}</span><input class="in mono sm" readonly value="${esc(x.url)}" style="flex:1"></div>`).join('')}</div>`;
  el.querySelector('#ob').onchange = (e) => api.put('/api/hotel/settings', { online_booking: e.target.checked }).then(() => toast(L('Enregistré', 'Saved'), 'ok')).catch(fail);
  el.querySelector('#ai').onclick = () => dialog({ title: L('Importer un calendrier', 'Import a calendar'), body: `<div class="f2">${field({ name: 'channel', label: L('Site', 'Channel'), type: 'select', options: [['booking', 'Booking.com'], ['airbnb', 'Airbnb'], ['expedia', 'Expedia'], ['other', L('Autre', 'Other')]] })}${field({ name: 'room_type_id', label: L('Type de chambre', 'Room type'), type: 'select', options: h.types.map((t) => [t.id, t.name]) })}${field({ name: 'url', label: L('Lien iCal (https://…)', 'iCal link (https://…)'), required: true, span: true })}</div>`,
    onSubmit: (v) => api.post('/api/hotel/ical', { ...v, room_type_id: Number(v.room_type_id) }) }).then((x) => x && again()).catch(fail);
  el.querySelectorAll('[data-sy]').forEach((b) => b.onclick = () => api.post(`/api/hotel/ical/${b.dataset.sy}/sync`).then((r) => { toast(`${r[0]?.created ?? 0} ${L('nouvelle(s) réservation(s)', 'new booking(s)')}`, 'ok'); again(); }).catch(fail));
  el.querySelectorAll('[data-di]').forEach((b) => b.onclick = () => api.del(`/api/hotel/ical/${b.dataset.di}`).then(again).catch(fail));
});

