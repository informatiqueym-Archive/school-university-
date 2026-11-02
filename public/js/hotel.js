// Teknons Hôtel: dashboard, front desk, planning, bookings, guest folio
// (check-in, payments, key cards, check-out), guests. Operations screens are
// in hotel-ops.js.
import { api } from './api.js';
import { state, L, esc, money, moneyShort, num, dt, today, qs, icon, can, canAny, table, field, dialog, toast, showError, confirmDlg, offlineNote } from './ui.js';

export const routes = [];
export const R = (path, fn, live = false) => routes.push([path, fn, live]);
export const H = () => state.hotel;
export const isManager = () => ['owner', 'admin', 'manager'].includes(state.me.user.role);
export const fail = (e) => { if (!e?.quiet) showError(e); };
export const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const bd = () => H()?.settings?.business_date || today();
export const kpi = (l, v, s = '', cls = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="card kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></${href ? 'a' : 'div'}>`;
export const waNumber = (p) => String(p || '').replace(/\D/g, '').replace(/^(6\d{8})$/, '237$1');
export const wa = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
export const dayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const sourceName = (s) => H()?.sources?.[s] || s;
export const payName = (m) => { const x = H()?.pay?.[m]; return x ? L(x.fr, x.en) : m; };
export const vipBadge = (v) => (v ? `<span class="pill vip">${v === 2 ? 'VVIP' : 'VIP'}</span>` : '');
export async function refreshMeta() { try { state.hotel = await api.get('/api/hotel/meta', { cache: false }); } catch {} }

const ST = {
  tentative: ['', 'Option', 'Tentative'], confirmed: ['info', 'Confirmée', 'Confirmed'], in_house: ['ok', 'En chambre', 'In house'], checked_out: ['', 'Partie', 'Checked out'],
  cancelled: ['bad', 'Annulée', 'Cancelled'], no_show: ['bad', 'No-show', 'No-show'],
};
export const bpill = (s) => { const x = ST[s] || ['', s, s]; return `<span class="pill ${x[0]}">${esc(L(x[1], x[2]))}</span>`; };
const HK = { clean: ['ok', 'Propre', 'Clean'], inspected: ['ok', 'Inspectée', 'Inspected'], dirty: ['warn', 'Sale', 'Dirty'], cleaning: ['info', 'En cours', 'Cleaning'] };
export const hkPill = (s) => { const x = HK[s] || ['', s, s]; return `<span class="pill ${x[0]}">${esc(L(x[1], x[2]))}</span>`; };

/** Runs fn(pin); if the server asks for the manager code, asks once and retries. */
export async function withPin(fn, pin) {
  try { return await fn(pin); } catch (e) {
    if (e.status !== 403 || !/code responsable/i.test(e.message) || pin) throw e;
    const v = await dialog({ title: L('Code responsable', 'Manager code'), submit: L('Valider', 'Confirm'),
      body: `<p class="muted" style="margin-top:0">${esc(e.message.replace(/ : code responsable incorrect$/, ''))}. ${L('Un responsable doit saisir son code.', 'A manager must type their code.')}</p>
      <label class="fld">${L('Code responsable', 'Manager code')}<input name="pin" type="password" inputmode="numeric" autocomplete="off" required autofocus></label>` });
    if (!v) throw Object.assign(new Error('cancelled'), { quiet: true });
    return fn(v.pin);
  }
}

// ===================== Navigation =====================
export function nav(item) {
  const fd = can('frontdesk'), hk = can('housekeeping'), out = can('outlet');
  return `<h6>${L('Réception', 'Front office')}</h6>
  ${item('/hotel/frontdesk', 'bell', 'Réception', 'Front desk', fd || can('read'))}
  ${item('/hotel/planning', 'calendar', 'Planning des chambres', 'Room planning')}
  ${item('/hotel/bookings', 'list', 'Réservations', 'Bookings')}
  ${item('/hotel/guests', 'users', 'Clients et VIP', 'Guests & VIP')}
  ${item('/hotel/requests', 'concierge', 'Conciergerie et demandes', 'Concierge & requests')}
  ${item('/hotel/keys', 'key', 'Cartes-clés', 'Key cards', fd)}
  <h6>${L('Restauration et services', 'F&B and services')}</h6>
  ${item('/hotel/outlet', 'cart', 'Restaurant, bar, services', 'Restaurant, bar, services', out || fd)}
  ${item('/hotel/kitchen', 'monitor', 'Écran cuisine et bar', 'Kitchen & bar screen', out || fd)}
  ${item('/hotel/spa', 'spa', 'Spa et activités', 'Spa & activities', out || fd || can('read'))}
  <h6>${L('Étages', 'Rooms division')}</h6>
  ${item('/hotel/housekeeping', 'bed', 'Ménage et chambres', 'Housekeeping', hk || fd || can('read'))}
  ${item('/hotel/maintenance', 'tool', 'Maintenance', 'Maintenance')}
  ${item('/hotel/lost-found', 'box', 'Objets trouvés', 'Lost & found')}
  <h6>${L('Direction', 'Management')}</h6>
  ${item('/hotel/audit', 'moon', 'Audit de nuit', 'Night audit', fd || can('reports'))}
  ${item('/hotel/reports', 'chart', 'Rapports hôteliers', 'Hotel reports', canAny('reports'))}
  ${item('/hotel/settings', 'gear', 'Réglages de l\'hôtel', 'Hotel settings', can('settings'))}`;
}
export function bottomNav() {
  if (can('housekeeping') && !can('frontdesk')) return `<a href="#/hotel/housekeeping" data-nav="/hotel/housekeeping">${icon('bed')}${L('Chambres', 'Rooms')}</a><a href="#/hotel/requests" data-nav="/hotel/requests">${icon('concierge')}${L('Demandes', 'Requests')}</a><a href="#/hotel/lost-found" data-nav="/hotel/lost-found">${icon('box')}${L('Objets', 'Items')}</a>`;
  if (can('outlet') && !can('frontdesk')) return `<a href="#/hotel/outlet" data-nav="/hotel/outlet">${icon('cart')}${L('Vente', 'Sell')}</a><a href="#/hotel/kitchen" data-nav="/hotel/kitchen">${icon('monitor')}${L('Cuisine', 'Kitchen')}</a><a href="#/hotel/spa" data-nav="/hotel/spa">${icon('spa')}Spa</a>`;
  return `<a href="#/" data-nav="/">${icon('home')}${L('Accueil', 'Home')}</a>
    <a href="#/hotel/frontdesk" data-nav="/hotel/frontdesk">${icon('bell')}${L('Réception', 'Desk')}</a>
    <a href="#/hotel/planning" data-nav="/hotel/planning">${icon('calendar')}${L('Planning', 'Planning')}</a>
    <a href="#/hotel/housekeeping" data-nav="/hotel/housekeeping">${icon('bed')}${L('Chambres', 'Rooms')}</a>`;
}

// ===================== Dashboard =====================
export async function dashboard(ctx) {
  ctx.title(L('Tableau de bord de l\'hôtel', 'Hotel dashboard'));
  if (can('frontdesk')) ctx.actions(`<button class="btn" id="walkin">${icon('user')}<span class="hide-m">${L('Client sans réservation', 'Walk-in')}</span></button><button class="btn primary" id="newb">${icon('plus')}<span class="hide-m">${L('Réservation', 'Booking')}</span></button>`);
  const d = await api.get('/api/hotel/dashboard');
  const k = d.kpi;
  const maxN = Math.max(1, k.sellable);
  const hist = d.history.slice(-21);
  const totalPay = d.payments.reduce((t, p) => t + p.v, 0) || 1;
  const outletName = (o) => { const x = H().outlet_kinds?.[o]; return x ? L(x.fr, x.en) : o === 'reception' ? L('Hébergement et réception', 'Rooms & desk') : o; };
  ctx.el.innerHTML = `${offlineNote(d)}
  ${d.audit_due ? `<div class="card banner warn"><b>${L('Audit de nuit en attente', 'Night audit pending')}</b> · ${L('date hôtelière', 'business date')} ${dt(d.business_date)}. <a href="#/hotel/audit">${L('Lancer l\'audit', 'Run the audit')}</a></div>` : ''}
  ${d.hk.undeclared ? `<div class="card banner bad"><b>${d.hk.undeclared} ${L('chambre(s) vue(s) occupée(s) sans client enregistré', 'room(s) seen occupied with no guest registered')}</b> · <a href="#/hotel/housekeeping">${L('Vérifier', 'Check')}</a></div>` : ''}
  <div class="grid g4">
    ${kpi(L('Occupation ce soir', 'Occupancy tonight'), `${String(k.occupancy).replace('.', ',')} %`, `${k.tonight} / ${k.sellable} ${L('chambres', 'rooms')}${k.ooo ? ` · ${k.ooo} ${L('hors service', 'out of order')}` : ''}`, 'accent', '#/hotel/planning')}
    ${kpi(L('Prix moyen (ADR)', 'ADR'), money(k.adr), `RevPAR ${money(k.revpar)} · ${L('hier', 'yesterday')}`, '', can('reports') ? '#/hotel/reports' : '')}
    ${kpi(L('Clients à l\'hôtel', 'Guests in house'), num(k.guests), `${k.occupied} ${L('chambres occupées', 'rooms occupied')}${k.vip ? ` · ${k.vip} VIP` : ''}`, '', '#/hotel/frontdesk?tab=inhouse')}
    ${kpi(L('À encaisser (en chambre)', 'In-house balance'), money(k.in_house_balance), `${d.keys} ${L('cartes actives', 'active key cards')}`)}
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>${icon('login')} ${L('Arrivées du jour', "Today's arrivals")} <span class="pill info">${d.arrivals.length}</span></h3>
      ${d.arrivals.slice(0, 8).map((a) => `<a class="row between lrow" href="#/hotel/booking/${a.id}"><span><b>${esc(a.guest_name)}</b> ${vipBadge(a.vip)}<div class="muted sm">${esc(a.type_name)}${a.room_number ? ` · ch. ${esc(a.room_number)}` : ''}${a.eta ? ` · ${esc(a.eta)}` : ''}${a.group_name ? ` · ${esc(a.group_name)}` : ''}</div></span><span class="pill">${esc(sourceName(a.source))}</span></a>`).join('') || `<p class="muted">${L('Aucune arrivée prévue.', 'No arrivals.')}</p>`}
      ${d.arrivals.length > 8 ? `<a class="btn sm" href="#/hotel/frontdesk">${L('Tout voir', 'See all')}</a>` : ''}</div>
    <div class="card"><h3>${icon('logout')} ${L('Départs du jour', "Today's departures")} <span class="pill warn">${d.departures.length}</span> ${k.checked_out ? `<span class="pill ok">${k.checked_out} ${L('partis', 'gone')}</span>` : ''}</h3>
      ${d.departures.slice(0, 8).map((a) => `<a class="row between lrow" href="#/hotel/booking/${a.id}"><span><b>${esc(a.guest_name)}</b><div class="muted sm">ch. ${esc(a.room_number || '')}${a.late_checkout ? ` · ${L('départ tardif', 'late check-out')} ${esc(a.late_checkout)}` : ''}</div></span><b class="num" style="color:${a.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${a.balance > 0 ? money(a.balance) : L('soldé', 'settled')}</b></a>`).join('') || `<p class="muted">${L('Aucun départ prévu.', 'No departures.')}</p>`}</div>
    <div class="card"><h3>${icon('bed')} ${L('Chambres', 'Rooms')}</h3>
      <div class="hkbar">${[['inspected', 'var(--ok)'], ['clean', '#4FB98A'], ['cleaning', 'var(--blue)'], ['dirty', '#E39B16'], ['ooo', 'var(--bad)']].map(([s, c]) => `<i style="flex:${d.hk[s] || 0};background:${c}" title="${s}"></i>`).join('')}</div>
      <div class="row between lrow"><span>${L('Propres / inspectées', 'Clean / inspected')}</span><b>${d.hk.clean + d.hk.inspected}</b></div>
      <div class="row between lrow"><span>${L('À nettoyer', 'To clean')}</span><b style="color:var(--warn)">${d.hk.dirty + d.hk.cleaning}</b></div>
      <div class="row between lrow"><span>${L('Hors service', 'Out of order')}</span><b>${d.hk.ooo}</b></div>
      <div class="row between lrow"><a href="#/hotel/requests">${L('Demandes clients ouvertes', 'Open guest requests')}</a><b>${d.requests}</b></div>
      <div class="row between lrow"><a href="#/hotel/kitchen">${L('Commandes en cuisine / bar', 'Kitchen & bar orders')}</a><b>${d.orders}</b></div>
      <div class="row between lrow"><a href="#/hotel/spa">${L('Soins spa aujourd\'hui', 'Spa today')}</a><b>${d.spa}</b></div>
      <div class="row between lrow"><a href="#/hotel/maintenance">${L('Interventions techniques', 'Maintenance jobs')}</a><b>${d.maintenance}</b></div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${L('Réservations sur 14 nuits', 'Bookings next 14 nights')}</h3>
      <div class="hbars">${d.next.map((n) => `<div class="hb" title="${dt(n.night)} : ${n.sold}/${k.sellable}"><i style="height:${Math.max(n.sold ? 4 : 0, (n.sold / maxN) * 100)}%"></i><span>${n.night.slice(8)}</span></div>`).join('')}</div>
      ${hist.length ? `<h3 style="margin-top:18px">${L('Occupation des derniers jours', 'Recent occupancy')}</h3><div class="hbars small">${hist.map((h) => { const o = h.rooms - h.ooo ? h.sold * 100 / (h.rooms - h.ooo) : 0; return `<div class="hb" title="${dt(h.date)} : ${Math.round(o)} % · ${money(h.room_revenue)}"><i style="height:${Math.max(o ? 3 : 0, o)}%;background:var(--navy)"></i><span>${h.date.slice(8)}</span></div>`; }).join('')}</div>` : ''}</div>
    <div class="card"><h3>${L('Chiffre d\'affaires du jour (HT)', "Today's revenue (excl. VAT)")}</h3>
      ${d.revenue.length ? `<div class="bar-list">${d.revenue.sort((a, b) => b.v - a.v).map((r) => `<div class="it"><span>${esc(outletName(r.outlet))}</span><b class="num">${money(r.v)}</b><div class="tr"><i style="width:${(r.v / Math.max(...d.revenue.map((x) => x.v), 1)) * 100}%"></i></div></div>`).join('')}</div>` : `<p class="muted">${L('Les nuitées sont comptées à l\'audit de nuit.', 'Room nights are counted at the night audit.')}</p>`}
      ${d.payments.length ? `<h3 style="margin-top:16px">${L('Encaissé aujourd\'hui', 'Collected today')}</h3><div class="stackbar">${d.payments.map((p) => `<i class="mm-${esc(p.method)}" style="width:${(p.v / totalPay) * 100}%"></i>`).join('')}</div>
        <div class="legend" style="flex-wrap:wrap;margin-top:8px">${d.payments.map((p) => `<span><i class="mm-${esc(p.method)}"></i>${esc(payName(p.method))} <b class="num">${money(p.v)}</b></span>`).join('')}</div>` : ''}
      ${d.birthdays.length ? `<div class="banner ok" style="margin-top:14px">🎂 ${L('Anniversaire aujourd\'hui', 'Birthday today')} : ${d.birthdays.map((b) => `<b>${esc(b.name)}</b> (ch. ${esc(b.room)})`).join(', ')}</div>` : ''}
      ${d.feedback.n ? `<p class="muted" style="margin-top:14px">${L('Satisfaction 30 jours', '30-day satisfaction')} : <b style="color:var(--ink)">${String(d.feedback.avg).replace('.', ',')} / 5</b> (${d.feedback.n} ${L('avis', 'reviews')})</p>` : ''}</div>
  </div>`;
  document.getElementById('newb')?.addEventListener('click', () => bookingDialog().catch(fail));
  document.getElementById('walkin')?.addEventListener('click', () => bookingDialog({ walk_in: true }).catch(fail));
}

// ===================== Front desk =====================
R('/hotel/frontdesk', async (ctx) => {
  ctx.title(L('Réception', 'Front desk'));
  const tab = ctx.query.tab || 'arrivals';
  if (can('frontdesk')) ctx.actions(`<button class="btn" id="walkin">${icon('user')}<span class="hide-m">${L('Sans réservation', 'Walk-in')}</span></button><button class="btn primary" id="newb">${icon('plus')}<span class="hide-m">${L('Réservation', 'Booking')}</span></button>`);
  const q = { arrivals: { status: 'tentative,confirmed', arrival: bd(), order: 'arrival' }, inhouse: { status: 'in_house', order: 'arrival' }, departures: { status: 'in_house', departure: bd() }, search: { q: ctx.query.q || '_' } }[tab];
  let rows = await api.get(`/api/hotel/bookings${qs(q)}`);
  if (tab === 'departures') rows = (await api.get('/api/hotel/bookings?status=in_house')).filter((b) => b.departure <= bd());
  const tabs = [['arrivals', L('Arrivées', 'Arrivals')], ['inhouse', L('En chambre', 'In house')], ['departures', L('Départs', 'Departures')], ['search', L('Rechercher', 'Search')]];
  ctx.el.innerHTML = `<div class="row between" style="margin-bottom:14px"><div class="tabs">${tabs.map(([k, l]) => `<a href="#/hotel/frontdesk?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <span class="muted">${L('Date hôtelière', 'Business date')} <b style="color:var(--ink)">${dayName(bd())}</b></span></div>
    ${tab === 'search' ? `<div class="filters"><input type="search" class="in" id="q" value="${esc(ctx.query.q || '')}" placeholder="${L('Nom, téléphone, n° réservation, chambre, groupe…', 'Name, phone, booking no., room, group…')}" autofocus></div>` : ''}
    ${table({ rows, href: (r) => `#/hotel/booking/${r.id}`, columns: [
      { label: L('Client', 'Guest'), render: (r) => `<b>${esc(r.guest_name)}</b> ${vipBadge(r.vip)}${r.blacklisted ? ' <span class="pill bad">!</span>' : ''}<div class="muted sm">${esc(r.number)}${r.group_name ? ` · ${esc(r.group_name)}` : ''}${r.bill_to_id !== r.guest_id ? ` · ${L('facturé à', 'billed to')} ${esc(r.bill_to_name)}` : ''}</div>` },
      { label: L('Chambre', 'Room'), render: (r) => (r.room_number ? `<b>${esc(r.room_number)}</b> ${r.status !== 'in_house' ? hkPill(r.hk_status) : ''}` : `<span class="muted">${L('à attribuer', 'to assign')}</span>`) + `<div class="muted sm">${esc(r.type_name)}</div>` },
      { label: L('Séjour', 'Stay'), hideM: true, render: (r) => `${dt(r.arrival)} → ${dt(r.departure)}<div class="muted sm">${r.kind === 'day_use' ? L('passage', 'day use') : `${r.nights} ${L('nuit(s)', 'night(s)')}`} · ${r.adults + r.children} pers.${r.eta ? ` · ${esc(r.eta)}` : ''}</div>` },
      { label: L('Statut', 'Status'), render: (r) => bpill(r.status) },
      { label: L('Solde', 'Balance'), cls: 'r num', render: (r) => `<b style="color:${r.balance > 0 ? 'var(--bad)' : r.balance < 0 ? 'var(--ok)' : 'inherit'}">${money(r.balance)}</b>` },
      { label: '', cls: 'r', render: (r) => (!can('frontdesk') ? '' : ['tentative', 'confirmed'].includes(r.status) && r.arrival <= bd() ? `<button class="btn sm primary" data-ci="${r.id}">${L('Check-in', 'Check in')}</button>`
        : r.status === 'in_house' && r.departure <= bd() ? `<button class="btn sm" data-co="${r.id}">${L('Check-out', 'Check out')}</button>` : '') }],
    empty: `<b>${tab === 'arrivals' ? L('Aucune arrivée aujourd\'hui', 'No arrivals today') : tab === 'search' ? L('Tapez pour rechercher', 'Type to search') : L('Personne pour le moment', 'Nobody yet')}</b>` })}`;
  let t; ctx.el.querySelector('#q')?.addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = '/hotel/frontdesk' + qs({ tab: 'search', q: e.target.value }); }, 450); });
  ctx.el.querySelectorAll('[data-ci]').forEach((b) => b.addEventListener('click', () => checkInDialog(Number(b.dataset.ci)).then((ok) => ok && (location.hash = `#/hotel/booking/${b.dataset.ci}`)).catch(fail)));
  ctx.el.querySelectorAll('[data-co]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/hotel/booking/${b.dataset.co}?checkout=1`; }));
  document.getElementById('newb')?.addEventListener('click', () => bookingDialog().catch(fail));
  document.getElementById('walkin')?.addEventListener('click', () => bookingDialog({ walk_in: true }).catch(fail));
}, true);

// ===================== Planning =====================
R('/hotel/planning', async (ctx) => {
  ctx.title(L('Planning des chambres', 'Room planning'));
  const days = Number(ctx.query.days || (window.innerWidth < 700 ? 7 : 14));
  const from = ctx.query.from || addDays(bd(), -1);
  ctx.actions(`<button class="btn" id="prev">‹</button><button class="btn" id="today">${L('Aujourd\'hui', 'Today')}</button><button class="btn" id="next">›</button>${can('frontdesk') ? `<button class="btn primary" id="newb">${icon('plus')}<span class="hide-m">${L('Réservation', 'Booking')}</span></button>` : ''}`);
  const p = await api.get(`/api/hotel/planning${qs({ from, days })}`);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const rooms = H().rooms.filter((r) => r.active);
  const types = H().types.filter((t) => t.active);
  const unassigned = p.bookings.filter((b) => !b.room_id && ['tentative', 'confirmed'].includes(b.status) && b.arrival <= addDays(p.business_date, 1));
  const cell = 100 / days;
  const bar = (b) => {
    const a = b.arrival < from ? from : b.arrival;
    const end = b.kind === 'day_use' ? addDays(b.arrival, 1) : (b.status === 'in_house' && b.departure <= p.business_date ? addDays(p.business_date, 1) : b.departure);
    const s = dates.indexOf(a); if (s < 0) return '';
    const e = Math.min(days, Math.max(s + 1, dates.indexOf(end) < 0 ? days : dates.indexOf(end)));
    return `<a class="pbar st-${b.status} src-${esc(b.source)}" href="#/hotel/booking/${b.id}" style="left:calc(${s * cell}% + ${b.arrival < from ? 0 : cell / 2}%);width:calc(${(e - s) * cell}% - ${b.arrival < from ? 0 : cell / 2}% + ${end > addDays(from, days - 1) ? 0 : cell / 2}% - 3px)" title="${esc(b.guest_name)} · ${dt(b.arrival)} → ${dt(b.departure)}${b.balance > 0 ? ' · ' + money(b.balance) : ''}">${b.vip ? '★ ' : ''}${esc(b.guest_name)}${b.balance > 0 && b.status === 'in_house' ? ' ·  ' + moneyShort(b.balance) : ''}</a>`;
  };
  ctx.el.innerHTML = `<div class="legend" style="flex-wrap:wrap">${[['confirmed', L('Confirmée', 'Confirmed')], ['tentative', L('Option', 'Tentative')], ['in_house', L('En chambre', 'In house')], ['checked_out', L('Partie', 'Checked out')]].map(([k, l]) => `<span><i class="st-${k}"></i>${l}</span>`).join('')}<span><i style="background:var(--bad-bg);border:1px solid var(--bad)"></i>${L('Hors service', 'Out of order')}</span></div>
  ${unassigned.length ? `<div class="card banner info" style="margin-bottom:12px"><b>${unassigned.length} ${L('réservation(s) sans chambre attribuée', 'booking(s) without a room')}</b> : ${unassigned.slice(0, 6).map((b) => `<a href="#/hotel/booking/${b.id}">${esc(b.guest_name)} (${dt(b.arrival)})</a>`).join(', ')}</div>` : ''}
  <div class="planning card"><div class="prow phead"><div class="pcol">${L('Chambre', 'Room')}</div><div class="pdays">${dates.map((d) => `<div class="${d === p.business_date ? 'today' : ''} ${[0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()) ? 'we' : ''}">${dayName(d)}</div>`).join('')}</div></div>
  ${types.map((t) => {
    const fr = p.free.find((f) => f.type_id === t.id);
    return `<div class="prow ptype"><div class="pcol"><b>${esc(t.name)}</b></div><div class="pdays">${dates.map((d) => { const x = fr?.perNight.find((n) => n.night === d); return `<div class="${x && x.free <= 0 ? 'full' : ''}">${x ? x.free : ''}</div>`; }).join('')}</div></div>
    ${rooms.filter((r) => r.type_id === t.id).map((r) => `<div class="prow"><div class="pcol"><b>${esc(r.number)}</b> <span class="dim sm">${esc(r.floor ? L('ét. ', 'fl. ') + r.floor : '')}</span></div>
      <div class="pdays pcells" data-room="${r.id}" data-type="${t.id}">${dates.map((d) => `<div data-d="${d}" class="${d === p.business_date ? 'today' : ''} ${r.out_of_order ? 'ooo' : ''}"></div>`).join('')}${p.bookings.filter((b) => b.room_id === r.id).map(bar).join('')}</div></div>`).join('')}`;
  }).join('')}</div>
  <p class="muted sm">${L('Touchez une case libre pour réserver cette chambre à cette date.', 'Tap a free cell to book that room on that date.')}</p>`;
  const go = (f) => { location.hash = '/hotel/planning' + qs({ from: f, days: ctx.query.days }); };
  document.getElementById('prev').onclick = () => go(addDays(from, -Math.max(1, days - 2)));
  document.getElementById('next').onclick = () => go(addDays(from, Math.max(1, days - 2)));
  document.getElementById('today').onclick = () => go(addDays(bd(), -1));
  document.getElementById('newb')?.addEventListener('click', () => bookingDialog().catch(fail));
  ctx.el.querySelectorAll('.pcells > div[data-d]').forEach((c) => c.addEventListener('click', () => {
    if (!can('frontdesk') || c.dataset.d < bd()) return;
    const row = c.parentElement;
    bookingDialog({ arrival: c.dataset.d, departure: addDays(c.dataset.d, 1), room_type_id: Number(row.dataset.type), room_id: Number(row.dataset.room) }).catch(fail);
  }));
}, true);

// ===================== Bookings list =====================
R('/hotel/bookings', async (ctx) => {
  ctx.title(L('Réservations', 'Bookings'));
  ctx.actions(`<a class="btn hide-m" href="/api/hotel/bookings${qs({ ...ctx.query, format: 'xlsx' })}">${icon('download')}Excel</a>${can('frontdesk') ? `<button class="btn primary" id="newb">${icon('plus')}<span class="hide-m">${L('Réservation', 'Booking')}</span></button>` : ''}`);
  const q = { status: ctx.query.status || '', from: ctx.query.from || '', to: ctx.query.to || '', q: ctx.query.q || '', limit: 500 };
  const rows = await api.get(`/api/hotel/bookings${qs(q)}`);
  const st = [['', L('Tous statuts', 'All statuses')], ['tentative,confirmed', L('À venir', 'Upcoming')], ['in_house', L('En chambre', 'In house')], ['checked_out', L('Partis', 'Checked out')], ['cancelled,no_show', L('Annulées / no-show', 'Cancelled / no-show')]];
  ctx.el.innerHTML = `<div class="filters"><input type="search" class="in" id="q" value="${esc(q.q)}" placeholder="${L('Nom, téléphone, n°, groupe…', 'Name, phone, no., group…')}">
    <select class="in" id="st">${st.map(([v, l]) => `<option value="${v}" ${v === q.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="row sm muted">${L('du', 'from')} <input type="date" class="in" id="from" value="${q.from}"></label><label class="row sm muted">${L('au', 'to')} <input type="date" class="in" id="to" value="${q.to}"></label></div>
    ${table({ rows, href: (r) => `#/hotel/booking/${r.id}`, columns: [
      { label: 'N°', render: (r) => `<span class="mono sm">${esc(r.number)}</span><div class="muted sm">${esc(sourceName(r.source))}</div>` },
      { label: L('Client', 'Guest'), render: (r) => `<b>${esc(r.guest_name)}</b> ${vipBadge(r.vip)}<div class="muted sm">${esc(r.guest_phone || '')}${r.group_name ? ' · ' + esc(r.group_name) : ''}</div>` },
      { label: L('Dates', 'Dates'), render: (r) => `${dt(r.arrival)} → ${dt(r.departure)}<div class="muted sm">${r.kind === 'day_use' ? L('passage', 'day use') : `${r.nights} ${L('nuit(s)', 'night(s)')}`}</div>` },
      { label: L('Chambre', 'Room'), hideM: true, render: (r) => `${esc(r.room_number || '—')}<div class="muted sm">${esc(r.type_name)} · ${esc(r.plan_code || L('négocié', 'negotiated'))}</div>` },
      { label: L('Statut', 'Status'), render: (r) => bpill(r.status) },
      { label: L('Montant', 'Amount'), cls: 'r num', hideM: true, render: (r) => money(r.charges) },
      { label: L('Solde', 'Balance'), cls: 'r num', render: (r) => `<b style="color:${r.balance > 0 ? 'var(--bad)' : 'inherit'}">${money(r.balance)}</b>` }] })}`;
  const go = (k, v) => { location.hash = '/hotel/bookings' + qs({ ...q, limit: undefined, [k]: v }); };
  let t; ctx.el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => go('q', e.target.value), 450); });
  ctx.el.querySelector('#st').addEventListener('change', (e) => go('status', e.target.value));
  ctx.el.querySelector('#from').addEventListener('change', (e) => go('from', e.target.value));
  ctx.el.querySelector('#to').addEventListener('change', (e) => go('to', e.target.value));
  document.getElementById('newb')?.addEventListener('click', () => bookingDialog().catch(fail));
}, true);

// ===================== Booking dialog =====================
async function guestPicker(d, initial) {
  const box = d.querySelector('#gpick');
  const input = box.querySelector('input');
  const list = box.querySelector('.cust-list');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    d.querySelector('[name=guest_id]').value = '';
    d.querySelector('#newguest').hidden = false;
    t = setTimeout(async () => {
      if (input.value.trim().length < 2) { list.innerHTML = ''; return; }
      const rows = await api.get(`/api/hotel/guests${qs({ q: input.value.trim() })}`, { cache: false }).catch(() => []);
      list.innerHTML = rows.slice(0, 6).map((g) => `<button type="button" class="cust-it" data-id="${g.id}" data-name="${esc(g.name)}"><b>${esc(g.name)}</b> ${vipBadge(g.vip)}${g.blacklisted ? ' <span class="pill bad">' + L('liste noire', 'blacklisted') + '</span>' : ''}<span class="muted sm">${esc(g.phone || '')} · ${g.stays} ${L('séjour(s)', 'stay(s)')}${g.points ? ` · ${g.points} pts` : ''}</span></button>`).join('');
    }, 300);
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    d.querySelector('[name=guest_id]').value = b.dataset.id;
    input.value = b.dataset.name; list.innerHTML = '';
    d.querySelector('#newguest').hidden = true;
  });
  if (initial) input.value = initial;
}

/** New booking (or walk-in). o: { arrival, departure, room_type_id, room_id, walk_in, guest_id, guest_name } */
export async function bookingDialog(o = {}, existing = null) {
  const h = H();
  const types = h.types.filter((t) => t.active);
  if (!types.length) { toast(L('Créez d\'abord vos types de chambres dans Réglages de l\'hôtel', 'Create your room types first in Hotel settings'), 'err'); location.hash = '#/hotel/settings?tab=rooms'; return; }
  const e = existing || {};
  const arrival = e.arrival || o.arrival || bd();
  const corp = await api.get('/api/partners?kind=client').catch(() => []);
  const v0 = { arrival, departure: e.departure || o.departure || addDays(arrival, 1), room_type_id: e.room_type_id || o.room_type_id || types[0].id, rate_plan_id: e.rate_plan_id ?? h.plans.find((p) => p.active && p.code === 'BAR')?.id ?? '',
    adults: e.adults || 1, children: e.children || 0, source: e.source || (o.walk_in ? 'walk_in' : 'direct'), rate: e.rate ?? '', kind: e.kind || 'night', bill_to_id: e.bill_to_id && e.bill_to_id !== e.guest_id ? e.bill_to_id : '',
    eta: e.eta || '', notes: e.notes || '', special_requests: e.special_requests || '', group_name: e.group_name || '', status: e.status || 'confirmed', rooms: 1, purpose: e.purpose || '' };
  const typeOpts = types.map((t) => [t.id, `${t.name} · ${money(t.base_rate)}`]);
  const planOpts = [['', L('— Tarif négocié —', '— Negotiated rate —')], ...h.plans.filter((p) => p.active).map((p) => [p.id, `${p.name}${p.partner_name ? ` (${p.partner_name})` : ''}`])];
  const billOpts = [['', L('Le client lui-même', 'The guest')], ...corp.filter((c) => c.name !== 'Clients de passage').map((c) => [c.id, c.name])];
  const body = `${existing ? '' : `<input type="hidden" name="guest_id" value="${esc(o.guest_id || '')}">
    <div id="gpick" class="fld" style="margin-bottom:12px"><span>${L('Client', 'Guest')} *</span><input class="in" name="name" required placeholder="${L('Nom du client (ou recherche)', 'Guest name (or search)')}" autocomplete="off"><div class="cust-list"></div></div>
    <div id="newguest" class="f2" ${o.guest_id ? 'hidden' : ''}>${field({ name: 'phone', label: L('Téléphone / WhatsApp', 'Phone / WhatsApp'), type: 'tel' })}${field({ name: 'email', label: 'E-mail', type: 'email' })}
      ${field({ name: 'nationality', label: L('Nationalité', 'Nationality'), value: 'Camerounaise' })}${field({ name: 'vip', label: 'VIP', type: 'select', options: [[0, L('Non', 'No')], [1, 'VIP'], [2, 'VVIP']] })}</div>`}
    <div class="f2" style="margin-top:12px">
    ${field({ name: 'kind', label: L('Type de séjour', 'Stay type'), type: 'select', options: [['night', L('Nuitée(s)', 'Night(s)')], ['day_use', L('Passage (day use)', 'Day use')]] }, v0)}
    ${field({ name: 'room_type_id', label: L('Type de chambre', 'Room type'), type: 'select', options: typeOpts, required: true }, v0)}
    ${field({ name: 'arrival', label: L('Arrivée', 'Arrival'), type: 'date', required: true, min: bd() }, v0)}${field({ name: 'departure', label: L('Départ', 'Departure'), type: 'date', required: true }, v0)}
    ${field({ name: 'adults', label: L('Adultes', 'Adults'), type: 'number', min: 1 }, v0)}${field({ name: 'children', label: L('Enfants', 'Children'), type: 'number', min: 0 }, v0)}
    ${field({ name: 'rate_plan_id', label: L('Tarif', 'Rate plan'), type: 'select', options: planOpts }, v0)}${field({ name: 'rate', label: L('Prix négocié par nuit TTC (optionnel)', 'Negotiated rate per night (optional)'), type: 'number', min: 0 }, v0)}
    ${field({ name: 'source', label: L('Origine', 'Source'), type: 'select', options: Object.entries(h.sources).map(([k, l]) => [k, l]) }, v0)}${field({ name: 'bill_to_id', label: L('Facturer à', 'Bill to'), type: 'select', options: billOpts }, v0)}
    ${existing ? '' : field({ name: 'rooms', label: L('Nombre de chambres (groupe)', 'Number of rooms (group)'), type: 'number', min: 1 }, v0)}${field({ name: 'group_name', label: L('Nom du groupe / événement', 'Group / event name') }, v0)}
    ${field({ name: 'eta', label: L('Heure d\'arrivée prévue', 'Expected arrival time'), type: 'time' }, v0)}${field({ name: 'status', label: L('Statut', 'Status'), type: 'select', options: [['confirmed', L('Confirmée', 'Confirmed')], ['tentative', L('Option (non garantie)', 'Tentative')]] }, v0)}
    ${field({ name: 'special_requests', label: L('Demandes du client (lit, étage, fleurs, gâteau…)', 'Guest requests (bed, floor, flowers, cake…)'), type: 'textarea', span: true }, v0)}
    ${field({ name: 'notes', label: L('Notes internes', 'Internal notes'), type: 'textarea', span: true }, v0)}</div>
    <div class="card quote" id="quote" style="margin-top:12px"></div>`;
  let lastQuote = null;
  const res = await dialog({ title: existing ? L('Modifier la réservation', 'Edit booking') : o.walk_in ? L('Client sans réservation', 'Walk-in guest') : L('Nouvelle réservation', 'New booking'), wide: true,
    submit: existing ? L('Enregistrer', 'Save') : o.walk_in ? L('Réserver et installer', 'Book and check in') : L('Réserver', 'Book'), body,
    onOpen: (d) => {
      if (!existing) guestPicker(d, o.guest_name);
      const f = d.querySelector('form');
      const kind = () => f.kind.value;
      const upd = async () => {
        f.departure.closest('label').style.display = kind() === 'day_use' ? 'none' : '';
        if (kind() === 'day_use') f.departure.value = f.arrival.value;
        else if (f.departure.value <= f.arrival.value) f.departure.value = addDays(f.arrival.value, 1);
        f.departure.min = addDays(f.arrival.value, kind() === 'day_use' ? 0 : 1);
        const box = d.querySelector('#quote');
        try {
          const [q, av] = await Promise.all([
            api.get(`/api/hotel/quote${qs({ room_type_id: f.room_type_id.value, rate_plan_id: f.rate_plan_id.value, arrival: f.arrival.value, departure: f.departure.value, adults: f.adults.value, kind: kind(), rate: f.rate.value })}`, { cache: false }),
            kind() === 'night' ? api.get(`/api/hotel/availability${qs({ arrival: f.arrival.value, departure: f.departure.value, except: existing?.id })}`, { cache: false }) : Promise.resolve([])]);
          lastQuote = q;
          const free = av.find((a) => String(a.type_id) === f.room_type_id.value)?.free;
          box.innerHTML = `<div class="row between"><span>${kind() === 'day_use' ? L('Passage', 'Day use') : `${q.nights} ${L('nuit(s)', 'night(s)')}`} · ${L('chambre', 'room')} ${money(q.room)}${q.breakfast ? ` · ${L('petit-déj.', 'breakfast')} ${money(q.breakfast)}` : ''}${q.tax ? ` · ${L('taxe de séjour', 'tourist tax')} ${money(q.tax)}` : ''}</span><b class="num" style="font-size:18px">${money(q.total * Number(f.rooms?.value || 1))}</b></div>
            ${free != null ? `<div class="sm ${free < Number(f.rooms?.value || 1) ? 'bad-t' : 'muted'}">${free <= 0 ? L('Complet sur ces dates', 'Fully booked on these dates') : `${free} ${L('chambre(s) libre(s) de ce type', 'room(s) of this type free')}`}</div>` : ''}
            ${q.perNight.length > 1 && new Set(q.perNight.map((n) => n.rate)).size > 1 ? `<div class="muted sm">${q.perNight.map((n) => `${n.night.slice(8)}/${n.night.slice(5, 7)} ${moneyShort(n.rate)}`).join(' · ')}</div>` : ''}`;
        } catch (err) { box.innerHTML = `<span class="muted">${esc(err.message)}</span>`; }
      };
      f.addEventListener('change', upd);
      upd();
    },
    onSubmit: async (v) => {
      const payload = { ...v, bill_to_id: v.bill_to_id || null, rate_plan_id: v.rate_plan_id || null };
      if (existing) return withPin((pin) => api.put(`/api/hotel/bookings/${existing.id}`, { ...payload, manager_pin: pin }));
      if (!v.guest_id) delete payload.guest_id;
      return withPin((pin) => api.post('/api/hotel/bookings', { ...payload, manager_pin: pin }));
    } });
  if (!res) return null;
  if (existing) { toast(L('Réservation modifiée', 'Booking updated'), 'ok'); return res; }
  const id = res.ids[0];
  toast(`${L('Réservation', 'Booking')} ${res.booking.number} ${L('enregistrée', 'saved')}${res.ids.length > 1 ? ` (${res.ids.length} ${L('chambres', 'rooms')})` : ''}`, 'ok');
  if (o.walk_in || (res.booking.arrival === bd() && o.room_id)) {
    const ok = await checkInDialog(id).catch((e) => { fail(e); return false; });
    if (ok) await payDialog(res.booking.id, lastQuote?.total).catch(fail);
  }
  location.hash = `#/hotel/booking/${id}`;
  return res;
}

// ===================== Check-in =====================
export async function checkInDialog(id) {
  const [f, sug] = await Promise.all([api.get(`/api/hotel/bookings/${id}`, { cache: false }), api.get(`/api/hotel/bookings/${id}/suggest-room`, { cache: false })]);
  const g = f.guest, b = f.booking;
  const free = sug.rooms.filter((r) => r.free);
  const roomOpts = free.map((r) => [r.id, `${r.number} · ${r.type_name}${r.type_id !== b.room_type_id ? ' ↑' : ''} · ${L({ clean: 'propre', inspected: 'inspectée', dirty: 'SALE', cleaning: 'en ménage' }[r.hk_status], r.hk_status)}`]);
  if (!roomOpts.length) throw new Error(L('Aucune chambre libre pour ce séjour', 'No free room for this stay'));
  const ids = [['CNI', L('Carte nationale d\'identité', 'National ID card')], ['Passeport', L('Passeport', 'Passport')], ['Carte de séjour', L('Carte de séjour', 'Residence permit')], ['Permis', L('Permis de conduire', 'Driving licence')], ['Récépissé', L('Récépissé CNI', 'ID receipt')]];
  const v = await dialog({ title: `${L('Check-in', 'Check-in')} · ${b.guest_name}`, wide: true, submit: L('Installer le client', 'Check in'),
    body: `${g.blacklisted ? `<div class="banner bad">${L('Client sur liste noire', 'Blacklisted guest')} : ${esc(g.blacklist_reason)}</div>` : ''}${g.preferences ? `<div class="banner info">${L('Préférences', 'Preferences')} : ${esc(g.preferences)}</div>` : ''}${b.special_requests ? `<div class="banner info">${L('Demandes', 'Requests')} : ${esc(b.special_requests)}</div>` : ''}
    <div class="f2">${field({ name: 'room_id', label: L('Chambre', 'Room'), type: 'select', options: roomOpts, value: b.room_id || sug.suggested })}
    <label class="check" style="align-self:end"><input type="checkbox" name="upgrade"> ${L('Surclassement offert (si autre type)', 'Free upgrade (if another type)')}</label></div>
    <h3 style="margin:16px 0 8px">${L('Fiche de police', 'Police registration')}</h3>
    <div class="f3">${field({ name: 'title', label: L('Civilité', 'Title'), type: 'select', options: [['', ''], ['M.', 'M.'], ['Mme', 'Mme'], ['Dr', 'Dr'], ['Pr', 'Pr'], ['Me', 'Me'], ['S.E.', 'S.E.']] }, g)}
    ${field({ name: 'nationality', label: L('Nationalité', 'Nationality'), required: true }, g)}${field({ name: 'profession', label: L('Profession', 'Profession') }, g)}
    ${field({ name: 'id_type', label: L('Pièce d\'identité', 'ID document'), type: 'select', options: ids }, g)}${field({ name: 'id_number', label: L('Numéro de la pièce', 'ID number'), required: true }, g)}
    ${field({ name: 'id_issued_on', label: L('Délivrée le', 'Issued on'), type: 'date' }, g)}${field({ name: 'id_issued_at', label: L('Délivrée à', 'Issued at') }, g)}
    ${field({ name: 'birth_date', label: L('Date de naissance', 'Date of birth'), type: 'date' }, g)}${field({ name: 'birth_place', label: L('Lieu de naissance', 'Place of birth') }, g)}
    ${field({ name: 'home_address', label: L('Domicile habituel', 'Home address') }, g)}${field({ name: 'coming_from', label: L('Venant de', 'Coming from') }, b)}${field({ name: 'going_to', label: L('Se rendant à', 'Going to') }, b)}
    ${field({ name: 'purpose', label: L('Motif du séjour', 'Purpose of stay'), type: 'select', options: [['', ''], ['Affaires', L('Affaires', 'Business')], ['Tourisme', L('Tourisme', 'Leisure')], ['Séminaire', L('Séminaire / conférence', 'Conference')], ['Famille', L('Famille', 'Family')], ['Transit', 'Transit']] }, b)}
    ${field({ name: 'vehicle', label: L('Véhicule (immatriculation)', 'Vehicle (plate)') }, b)}</div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn sm" id="scanid">${icon('camera')}${L('Photographier la pièce', 'Photo of ID')}</button><span class="muted sm" id="scanst"></span></div>`,
    onOpen: (d) => {
      d.querySelector('#scanid').addEventListener('click', () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
        inp.onchange = () => { if (inp.files[0]) d.querySelector('#scanst').textContent = L('Photo prise : recopiez le numéro et les dates ci-dessus.', 'Photo taken: copy the number and dates above.'); };
        inp.click();
      });
    },
    onSubmit: async (val) => {
      const guest = Object.fromEntries(['title', 'nationality', 'profession', 'id_type', 'id_number', 'id_issued_on', 'id_issued_at', 'birth_date', 'birth_place', 'home_address'].map((k) => [k, val[k]]));
      await api.put(`/api/hotel/bookings/${id}`, { coming_from: val.coming_from, going_to: val.going_to, purpose: val.purpose, vehicle: val.vehicle });
      const go = (extra = {}) => withPin((pin) => api.post(`/api/hotel/bookings/${id}/check-in`, { room_id: val.room_id, guest, upgrade: val.upgrade, manager_pin: pin, ...extra }));
      try { return await go(); } catch (e) {
        if (e.status === 409 && /propre|clean/i.test(e.message) && await confirmDlg(L('Chambre pas encore propre', 'Room not clean yet'), `${e.message} ${L('Installer quand même ?', 'Check in anyway?')}`)) return go({ force_dirty: true });
        if (e.status === 409 && /surclassement/i.test(e.message) && await confirmDlg(L('Surclassement', 'Upgrade'), e.message)) return go({ upgrade: true });
        throw e;
      }
    } });
  if (!v) return false;
  toast(`${b.guest_name} ${L('installé(e) en chambre', 'checked in to room')} ${v.booking.room_number}`, 'ok');
  if (await confirmDlg(L('Carte-clé', 'Key card'), L('Encoder les cartes-clés de la chambre maintenant ?', 'Encode the room key cards now?'), L('Encoder', 'Encode'))) await keyDialog(v.booking).catch(fail);
  return true;
}

// ===================== Payments =====================
export async function payDialog(id, suggested) {
  const f = await api.get(`/api/hotel/bookings/${id}`, { cache: false });
  const s = H().settings;
  const due = suggested ?? Math.max(0, f.booking.balance);
  const methods = Object.keys(H().pay);
  let momoBox = null;
  const v = await dialog({ title: `${L('Encaisser', 'Take payment')} · ${f.booking.guest_name}`, submit: L('Encaisser', 'Take payment'),
    body: `<p class="muted" style="margin-top:0">${L('Solde actuel', 'Current balance')} <b style="color:var(--ink)">${money(f.booking.balance)}</b>${f.pending_nights.length ? ` · ${f.pending_nights.length} ${L('nuit(s) pas encore comptée(s)', 'night(s) not yet posted')}` : ''}${f.booking.bill_to_id !== f.booking.guest_id ? ` · ${L('payé au nom de', 'paid for')} ${esc(f.booking.bill_to_name)}` : ''}</p>
    <div class="pay-m">${methods.map((m, i) => `<label class="pm"><input type="radio" name="method" value="${m}" ${i === 0 ? 'checked' : ''}><span>${esc(payName(m))}</span></label>`).join('')}</div>
    <div class="f2" style="margin-top:12px">${field({ name: 'currency', label: L('Devise', 'Currency'), type: 'select', options: [['XAF', 'FCFA'], ['EUR', `EUR (${String(s.eur_rate).replace('.', ',')})`], ['USD', `USD (${String(s.usd_rate).replace('.', ',')})`]] })}
    ${field({ name: 'amount', label: L('Montant FCFA', 'Amount FCFA'), type: 'number', min: 1, value: due || '' })}
    ${field({ name: 'foreign_amount', label: L('Montant en devise', 'Foreign amount'), type: 'number', min: 0, step: 'any' })}
    ${field({ name: 'phone', label: L('N° Mobile Money du client', 'Customer Mobile Money no.'), type: 'tel', value: f.booking.guest_phone || '' })}
    ${field({ name: 'reference', label: L('Référence (n° transaction, ticket TPE…)', 'Reference (transaction no., card slip…)'), span: true })}</div>
    <div id="momo" class="momo-st" hidden></div>`,
    onOpen: (d) => {
      const form = d.querySelector('form');
      momoBox = d.querySelector('#momo');
      const upd = () => {
        const m = form.method.value, cur = form.currency.value;
        form.currency.closest('label').style.display = m === 'cash' ? '' : 'none';
        if (m !== 'cash') form.currency.value = 'XAF';
        form.foreign_amount.closest('label').style.display = form.currency.value !== 'XAF' ? '' : 'none';
        form.amount.closest('label').style.display = form.currency.value === 'XAF' ? '' : 'none';
        form.phone.closest('label').style.display = ['mtn_momo', 'orange_money'].includes(m) ? '' : 'none';
        const btn = form.querySelector('button[value=ok]');
        btn.textContent = ['mtn_momo', 'orange_money'].includes(m) && H().momo[m] ? L('Envoyer la demande sur le téléphone', 'Send the request to the phone') : L('Encaisser', 'Take payment');
        if (cur !== 'XAF' && form.foreign_amount.value) momoBox.hidden = true;
      };
      form.addEventListener('change', upd); upd();
    },
    onSubmit: async (val) => {
      if (['mtn_momo', 'orange_money'].includes(val.method) && H().momo[val.method] && !val.reference) {
        const req = await api.post(`/api/hotel/bookings/${id}/momo`, { provider: val.method, phone: val.phone, amount: val.amount });
        momoBox.hidden = false;
        momoBox.innerHTML = `<b>${L('Demande envoyée', 'Request sent')}</b> · ${L('le client confirme avec son code secret…', 'the guest confirms with their PIN…')}`;
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const st = await api.get(`/api/hotel/momo/${req.id}`, { cache: false });
          if (st.status === 'successful') { toast(`${money(st.amount)} ${L('reçus par Mobile Money', 'received by Mobile Money')}`, 'ok'); return true; }
          if (st.status === 'failed') throw new Error(`${L('Paiement refusé', 'Payment declined')} : ${st.reason || ''}`);
        }
        throw new Error(L('Pas de réponse du client. Réessayez ou saisissez la référence.', 'No answer. Try again or type the reference.'));
      }
      await api.post(`/api/hotel/bookings/${id}/payments`, val);
      toast(L('Paiement enregistré', 'Payment recorded'), 'ok');
      return true;
    } });
  return v;
}

// ===================== Key cards =====================
export async function keyDialog(b) {
  const access = H().access;
  const v = await dialog({ title: `${L('Encoder des cartes', 'Encode key cards')} · ${L('chambre', 'room')} ${b.room_number}`, submit: L('Encoder', 'Encode'),
    body: `<p class="muted" style="margin-top:0">${H().settings.lock_mode === 'simulation' ? L('Mode démonstration : aucune serrure n\'est encore reliée. Avec l\'encodeur de votre marque de serrures (Salto, VingCard, dormakaba, Onity…), la carte est écrite ici.', 'Demo mode: no lock system connected yet. With your lock brand\'s encoder, the card is written here.') : L('Posez la carte vierge sur l\'encodeur.', 'Place a blank card on the encoder.')}</p>
    <div class="f2">${field({ name: 'copies', label: L('Nombre de cartes', 'Number of cards'), type: 'number', min: 1, value: Math.min(4, b.adults || 1) })}${field({ name: 'holder', label: L('Titulaire', 'Holder'), value: b.guest_name })}
    ${field({ name: 'card_uid', label: L('N° de carte (lecteur RFID, optionnel)', 'Card no. (RFID reader, optional)'), placeholder: L('Passez la carte sur le lecteur', 'Tap the card on the reader'), span: true })}</div>
    <div class="fld"><span>${L('Accès inclus', 'Included access')}</span><div class="row">${Object.entries(access).map(([k, l]) => `<label class="check"><input type="checkbox" name="acc_${k}" ${['pool', 'gym', 'lift'].includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>`,
    onSubmit: (val) => api.post(`/api/hotel/bookings/${b.id}/keys`, { copies: val.copies, holder: val.holder, card_uid: val.card_uid, access: Object.keys(access).filter((k) => val['acc_' + k]) }) });
  if (v) toast(`${v.length} ${L('carte(s) encodée(s)', 'card(s) encoded')} : ${v.map((k) => k.card_uid).join(', ')}`, 'ok');
  return v;
}

// ===================== Booking / folio page =====================
R('/hotel/booking/:id', async (ctx) => {
  const f = await api.get(`/api/hotel/bookings/${ctx.params.id}`);
  const b = f.booking, g = f.guest;
  const fd = can('frontdesk');
  ctx.title(`${b.guest_name} · ${b.number}`);
  const live = f.lines.filter((l) => !l.voided);
  const est = f.pending_nights.length && live.find((l) => l.kind === 'room') ? f.pending_nights.length * live.find((l) => l.kind === 'room').amount : 0;
  const acts = [];
  if (fd && ['tentative', 'confirmed'].includes(b.status)) acts.push(b.arrival <= bd() ? `<button class="btn primary" data-a="checkin">${icon('login')}${L('Check-in', 'Check in')}</button>` : '', `<button class="btn" data-a="edit">${L('Modifier', 'Edit')}</button>`, `<button class="btn" data-a="pay">${icon('cash')}${L('Acompte', 'Deposit')}</button>`);
  if (fd && b.status === 'in_house') acts.push(`<button class="btn primary" data-a="checkout">${icon('logout')}${L('Check-out', 'Check out')}</button>`, `<button class="btn" data-a="pay">${icon('cash')}${L('Encaisser', 'Payment')}</button>`, `<button class="btn" data-a="charge">${icon('plus')}${L('Prestation', 'Charge')}</button>`);
  ctx.actions(acts.join(''));
  const whatsapp = b.guest_phone ? wa(b.guest_phone, b.status === 'in_house' || b.status === 'checked_out'
    ? `${L('Bonjour', 'Hello')} ${b.guest_name}, ${L('votre espace client', 'your guest app')} ${state.me.company.name} : ${f.portal_url}`
    : `${L('Bonjour', 'Hello')} ${b.guest_name}, ${L('votre réservation', 'your booking')} ${b.number} ${L('est confirmée du', 'is confirmed from')} ${dt(b.arrival)} ${L('au', 'to')} ${dt(b.departure)} (${b.type_name}). ${L('Détails, paiement et demandes', 'Details, payment and requests')} : ${f.portal_url}`) : '';
  ctx.el.innerHTML = `
  ${g.blacklisted ? `<div class="card banner bad"><b>${L('Liste noire', 'Blacklisted')}</b> : ${esc(g.blacklist_reason)}</div>` : ''}
  ${b.status === 'in_house' && b.departure <= bd() ? `<div class="card banner warn">${L('Départ prévu aujourd\'hui', 'Due out today')}${b.departure < bd() ? ` (${L('dépassé depuis le', 'overdue since')} ${dt(b.departure)})` : ''}${b.late_checkout ? ` · ${L('départ tardif accordé à', 'late check-out at')} ${esc(b.late_checkout)}` : ''}</div>` : ''}
  <div class="grid g3 folio-top">
    <div class="card"><div class="row between"><h3 style="margin:0">${esc(b.guest_name)} ${vipBadge(b.vip)}</h3>${bpill(b.status)}</div>
      <div class="muted sm" style="margin:4px 0 10px">${esc(b.number)} · ${esc(sourceName(b.source))}${b.external_ref ? ` · ${esc(b.external_ref.split(':').pop())}` : ''}</div>
      <div class="row between lrow"><span>${L('Chambre', 'Room')}</span><b>${esc(b.room_number || '—')} <span class="muted sm">${esc(b.type_name)}</span></b></div>
      <div class="row between lrow"><span>${L('Séjour', 'Stay')}</span><b>${dt(b.arrival)} → ${dt(b.departure)}</b></div>
      <div class="row between lrow"><span>${L('Personnes', 'Guests')}</span><b>${b.adults}${b.children ? ` + ${b.children} ${L('enf.', 'ch.')}` : ''}</b></div>
      <div class="row between lrow"><span>${L('Tarif', 'Rate')}</span><b>${esc(b.plan_name || L('Négocié', 'Negotiated'))}${b.rate != null ? ` · ${money(b.rate)}` : ''}</b></div>
      ${b.bill_to_id !== b.guest_id ? `<div class="row between lrow"><span>${L('Facturé à', 'Billed to')}</span><b>${esc(b.bill_to_name)}</b></div>` : ''}
      ${b.group_name ? `<div class="row between lrow"><span>${L('Groupe', 'Group')}</span><b>${esc(b.group_name)}${f.group.length > 1 ? ` (${f.group.length} ${L('ch.', 'rooms')})` : ''}</b></div>` : ''}
      <div class="row" style="margin-top:12px">${b.guest_phone ? `<a class="btn sm" href="tel:${esc(b.guest_phone)}">${icon('phone')}${L('Appeler', 'Call')}</a><a class="btn sm" target="_blank" rel="noopener" href="${esc(whatsapp)}">WhatsApp</a>` : ''}<a class="btn sm" href="#/hotel/guest/${b.guest_id}">${icon('user')}${L('Fiche client', 'Guest file')}</a></div></div>
    <div class="card"><h3>${L('Note du client', 'Guest bill')}</h3>
      <div class="row between lrow"><span>${L('Prestations', 'Charges')}</span><b class="num">${money(b.charges)}</b></div>
      ${est ? `<div class="row between lrow"><span class="muted">${L('Nuits à venir (estimation)', 'Nights to come (estimate)')}</span><span class="num muted">${money(est)}</span></div>` : ''}
      <div class="row between lrow"><span>${L('Payé', 'Paid')}</span><b class="num" style="color:var(--ok)">${money(b.paid)}</b></div>
      <div class="row between lrow big"><span>${b.balance >= 0 ? L('Reste à payer', 'Balance due') : L('Avance du client', 'Guest credit')}</span><b class="num" style="color:${b.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(Math.abs(b.balance))}</b></div>
      ${f.invoice ? `<a class="btn sm" style="margin-top:10px" href="#/doc/${f.invoice.id}">${icon('invoice')}${L('Facture', 'Invoice')} ${esc(f.invoice.number)}</a>` : ''}
      <div class="row" style="margin-top:10px"><a class="btn sm" target="_blank" href="/print/hotel/folio/${b.id}">${icon('print')}${L('Note', 'Bill')}</a>${b.status !== 'tentative' ? `<a class="btn sm" target="_blank" href="/print/hotel/registration/${b.id}">${icon('print')}${L('Fiche de police', 'Registration card')}</a>` : ''}<a class="btn sm" target="_blank" href="/print/hotel/confirmation/${b.id}">${icon('print')}${L('Confirmation', 'Confirmation')}</a></div></div>
    <div class="card"><h3>${icon('key')} ${L('Cartes-clés', 'Key cards')}</h3>
      ${f.keys.length ? f.keys.slice(0, 6).map((k) => `<div class="row between lrow"><span><span class="mono">${esc(k.card_uid)}</span><div class="muted sm">${esc(k.holder)} · ch. ${esc(k.room_number)}${k.access ? ' · ' + esc(k.access.split(',').map((a) => H().access[a] || a).join(', ')) : ''}</div></span>${k.status === 'active' ? (fd ? `<span class="row"><button class="btn sm" data-revoke="${k.id}">${L('Désactiver', 'Revoke')}</button><button class="btn sm danger" data-lost="${k.id}">${L('Perdue', 'Lost')}</button></span>` : '<span class="pill ok">active</span>') : `<span class="pill">${esc(k.status)}</span>`}</div>`).join('') : `<p class="muted">${L('Aucune carte encodée.', 'No card encoded.')}</p>`}
      ${fd && b.room_id && ['in_house', 'confirmed'].includes(b.status) ? `<button class="btn sm primary" data-a="key" style="margin-top:8px">${icon('key')}${L('Encoder une carte', 'Encode a card')}</button>` : ''}
      <h3 style="margin-top:16px">${L('Espace client (QR)', 'Guest app (QR)')}</h3><div class="row"><input class="in mono sm" readonly value="${esc(f.portal_url)}" style="flex:1"><button class="btn sm" data-a="copy">${L('Copier', 'Copy')}</button></div>
      ${f.feedback ? `<p class="sm" style="margin-top:10px">${L('Avis', 'Review')} : <b>${'★'.repeat(f.feedback.rating)}${'☆'.repeat(5 - f.feedback.rating)}</b> ${esc(f.feedback.comment || '')}</p>` : ''}</div>
  </div>
  ${b.special_requests || b.notes || g.preferences || g.allergies ? `<div class="card" style="margin-top:16px">${b.special_requests ? `<div><b>${L('Demandes', 'Requests')} :</b> ${esc(b.special_requests)}</div>` : ''}${g.preferences ? `<div><b>${L('Préférences', 'Preferences')} :</b> ${esc(g.preferences)}</div>` : ''}${g.allergies ? `<div style="color:var(--bad)"><b>${L('Allergies', 'Allergies')} :</b> ${esc(g.allergies)}</div>` : ''}${b.notes ? `<div class="muted"><b>${L('Notes', 'Notes')} :</b> ${esc(b.notes)}</div>` : ''}</div>` : ''}
  <div class="row between" style="margin:20px 0 10px"><h3 style="margin:0">${L('Détail de la note', 'Folio')}</h3>
    ${fd && b.status === 'in_house' ? `<div class="row"><button class="btn sm" data-a="move">${icon('swap')}${L('Changer de chambre', 'Move room')}</button><button class="btn sm" data-a="extend">${L('Prolonger', 'Extend')}</button><button class="btn sm" data-a="late">${L('Départ tardif', 'Late check-out')}</button>${g.points >= 100 ? `<button class="btn sm" data-a="points">${icon('star')}${g.points} pts</button>` : ''}</div>` : ''}</div>
  ${table({ rows: f.lines, columns: [
    { label: 'Date', render: (l) => `${dt(l.date)}` },
    { label: L('Désignation', 'Description'), render: (l) => `${l.voided ? '<s>' : ''}${esc(l.description)}${l.voided ? `</s> <span class="pill bad">${L('annulée', 'void')}</span> <span class="muted sm">${esc(l.void_reason)}</span>` : ''}<div class="muted sm">${esc(l.user_name || '')}${l.vat ? ` · TVA ${money(l.vat)}` : ''}</div>` },
    { label: L('Montant TTC', 'Amount'), cls: 'r num', render: (l) => (l.voided ? `<s class="muted">${money(l.amount)}</s>` : money(l.amount)) },
    { label: '', cls: 'r', render: (l) => (fd && !l.voided && b.status !== 'checked_out' ? `<button class="btn sm ghost" data-void="${l.id}" title="${L('Annuler la ligne', 'Void line')}">${icon('x')}</button>` : '') }],
  empty: `<b>${L('Rien sur la note', 'Nothing on the bill')}</b>${b.status === 'in_house' ? L('Les nuits sont ajoutées par l\'audit de nuit ou au départ.', 'Nights are added by the night audit or at check-out.') : ''}` })}
  ${f.payments.length ? `<h3 style="margin:20px 0 10px">${L('Paiements', 'Payments')}</h3>${table({ rows: f.payments, columns: [
    { label: 'Date', render: (p) => dt(p.date) },
    { label: L('Mode', 'Method'), render: (p) => `${p.pay_kind === 'refund' ? `<span class="pill warn">${L('Remboursement', 'Refund')}</span> ` : p.pay_kind === 'deposit' ? `<span class="pill info">${L('Acompte', 'Deposit')}</span> ` : ''}${esc(p.method === 'bank' && /^Carte/.test(p.reference) ? payName('card') : payName(p.method))}<div class="muted sm">${esc(p.reference || '')} · ${esc(p.user_name || L('en ligne', 'online'))}</div>` },
    { label: L('Montant', 'Amount'), cls: 'r num', render: (p) => `${p.pay_kind === 'refund' ? '−' : ''}${money(p.amount)}` }] })}` : ''}
  ${fd && b.balance < 0 && b.status !== 'tentative' ? `<button class="btn sm" data-a="refund" style="margin-top:10px">${L('Rembourser l\'avance', 'Refund the credit')}</button>` : ''}
  ${f.orders.length ? `<h3 style="margin:20px 0 10px">${L('Commandes', 'Orders')}</h3>${table({ rows: f.orders, columns: [
    { label: 'N°', render: (o) => `<span class="mono sm">${esc(o.number)}</span><div class="muted sm">${esc(o.outlet_name)}</div>` },
    { label: L('Articles', 'Items'), render: (o) => esc(o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')) },
    { label: L('Statut', 'Status'), render: (o) => `<span class="pill">${esc(o.status)}</span>` }, { label: '', cls: 'r num', render: (o) => money(o.total) }] })}` : ''}
  ${f.requests.length ? `<h3 style="margin:20px 0 10px">${L('Demandes', 'Requests')}</h3>${table({ rows: f.requests, columns: [
    { label: '', render: (q) => `<b>${esc(H().request_kinds[q.kind] || q.kind)}</b><div class="muted sm">${esc(q.detail)}</div>` }, { label: '', cls: 'r', render: (q) => `<span class="pill ${q.status === 'done' ? 'ok' : 'warn'}">${esc(q.status)}</span>` }] })}` : ''}
  ${fd && ['tentative', 'confirmed'].includes(b.status) ? `<div class="row" style="margin-top:20px"><button class="btn danger" data-a="cancel">${L('Annuler la réservation', 'Cancel booking')}</button>${b.arrival <= bd() ? `<button class="btn" data-a="noshow">No-show</button>` : ''}</div>` : ''}
  ${fd && ['cancelled', 'no_show'].includes(b.status) ? `<div class="row" style="margin-top:20px"><button class="btn" data-a="reinstate">${L('Rétablir la réservation', 'Reinstate booking')}</button>${b.paid > 0 ? `<button class="btn" data-a="refund">${L('Rembourser l\'acompte', 'Refund the deposit')}</button>` : ''}</div>` : ''}`;
  const run = async (fn) => { try { await fn(); ctx.rerender(); } catch (e) { fail(e); } };
  const A = {
    checkin: () => run(() => checkInDialog(b.id)),
    edit: () => run(() => bookingDialog({}, b)),
    pay: () => run(() => payDialog(b.id, b.status === 'in_house' ? undefined : 0)),
    charge: () => run(() => chargeDialog(b)),
    key: () => run(() => keyDialog(b)),
    copy: () => { navigator.clipboard?.writeText(f.portal_url); toast(L('Lien copié', 'Link copied'), 'ok'); },
    checkout: () => run(() => checkoutDialog(b.id)),
    move: () => run(() => moveDialog(b)),
    extend: () => run(async () => { const v = await dialog({ title: L('Prolonger le séjour', 'Extend stay'), body: field({ name: 'departure', label: L('Nouvelle date de départ', 'New departure date'), type: 'date', value: addDays(b.departure, 1), min: bd() }), onSubmit: (x) => withPin((pin) => api.put(`/api/hotel/bookings/${b.id}`, { departure: x.departure, manager_pin: pin })) }); if (v) toast(L('Séjour prolongé, cartes mises à jour', 'Stay extended, cards updated'), 'ok'); }),
    late: () => run(async () => { const v = await dialog({ title: L('Départ tardif', 'Late check-out'), body: `${field({ name: 'time', label: L('Heure de départ accordée', 'Granted departure time'), type: 'time', value: b.late_checkout || '16:00' })}<p class="muted sm">${L('Les cartes-clés restent actives jusqu\'à cette heure. Les frais éventuels sont ajoutés au check-out.', 'Key cards stay active until then. Any fee is added at check-out.')}</p>`, onSubmit: (x) => api.post(`/api/hotel/bookings/${b.id}/late-checkout`, x) }); if (v) toast(L('Départ tardif enregistré', 'Late check-out saved'), 'ok'); }),
    points: () => run(async () => {
      const nights = f.lines.filter((l) => l.kind === 'room' && !l.voided);
      const v = await dialog({ title: L('Offrir une nuit avec les points', 'Free night with points'), body: `<p class="muted">${g.points} ${L('points disponibles (100 FCFA de nuit = 1 point)', 'points available (100 FCFA = 1 point)')}</p>${field({ name: 'line_id', label: L('Nuit à offrir', 'Night to offer'), type: 'select', options: nights.map((l) => [l.id, `${l.description} · ${Math.ceil(l.amount / 100)} pts`]) })}`, onSubmit: (x) => api.post(`/api/hotel/bookings/${b.id}/redeem-points`, x) });
      if (v) toast(L('Nuit offerte', 'Night offered'), 'ok');
    }),
    refund: () => run(async () => { const v = await dialog({ title: L('Rembourser', 'Refund'), body: `<div class="f2">${field({ name: 'amount', label: L('Montant', 'Amount'), type: 'number', value: Math.max(0, b.paid - b.charges) })}${field({ name: 'method', label: L('Mode', 'Method'), type: 'select', options: [['cash', payName('cash')], ['mtn_momo', 'MTN MoMo'], ['orange_money', 'Orange Money'], ['bank', payName('bank')]] })}${field({ name: 'reference', label: L('Référence', 'Reference'), span: true })}</div>`, onSubmit: (x) => withPin((pin) => api.post(`/api/hotel/bookings/${b.id}/refund`, { ...x, manager_pin: pin })) }); if (v) toast(L('Remboursement enregistré', 'Refund recorded'), 'ok'); }),
    cancel: () => run(async () => { const v = await dialog({ title: L('Annuler la réservation', 'Cancel booking'), danger: true, submit: L('Annuler la réservation', 'Cancel booking'), body: `${field({ name: 'reason', label: L('Motif', 'Reason'), required: true })}${b.paid ? `<p class="muted sm">${L('L\'acompte reste au crédit du client : remboursez-le ou gardez-le selon vos conditions.', 'The deposit stays as guest credit: refund or keep it per your policy.')}</p>` : ''}`, onSubmit: (x) => api.post(`/api/hotel/bookings/${b.id}/cancel`, x) }); if (v) toast(L('Réservation annulée', 'Booking cancelled'), 'ok'); }),
    noshow: () => run(async () => { if (await confirmDlg('No-show', L('Le client n\'est pas venu ?', 'The guest did not show up?'))) await api.post(`/api/hotel/bookings/${b.id}/no-show`, { reason: 'No-show' }); }),
    reinstate: () => run(() => api.post(`/api/hotel/bookings/${b.id}/reinstate`, {})),
  };
  ctx.el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (a && A[a]) { e.preventDefault(); A[a](); return; }
    const vd = e.target.closest('[data-void]')?.dataset.void;
    if (vd) run(async () => { const v = await dialog({ title: L('Annuler une ligne', 'Void a line'), danger: true, submit: L('Annuler la ligne', 'Void'), body: field({ name: 'reason', label: L('Motif (tracé dans le journal)', 'Reason (logged)'), required: true }), onSubmit: (x) => withPin((pin) => api.post(`/api/hotel/bookings/${b.id}/lines/${vd}/void`, { ...x, manager_pin: pin })) }); if (v) toast(L('Ligne annulée', 'Line voided'), 'ok'); });
    const rk = e.target.closest('[data-revoke],[data-lost]');
    if (rk) run(() => api.post(`/api/hotel/keys/${rk.dataset.revoke || rk.dataset.lost}/revoke`, { lost: !!rk.dataset.lost }));
  });
  document.getElementById('actions').onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a && A[a]) A[a](); };
  if (ctx.query.checkout && b.status === 'in_house') { history.replaceState(null, '', `#/hotel/booking/${b.id}`); A.checkout(); }
}, true);

async function chargeDialog(b) {
  const items = await api.get('/api/hotel/items');
  const v = await dialog({ title: `${L('Ajouter une prestation', 'Add a charge')} · ch. ${b.room_number}`,
    body: `<div class="f2">${field({ name: 'product_id', label: L('Article', 'Item'), type: 'select', options: [['', L('— Montant libre —', '— Free amount —')], ...items.filter((i) => i.active).map((i) => [i.id, `${i.outlet_name} · ${i.name} · ${money(i.price)}`])], span: true })}
    ${field({ name: 'qty', label: L('Quantité', 'Quantity'), type: 'number', min: 0.01, step: 'any', value: 1 })}${field({ name: 'amount', label: L('Prix TTC (montant libre)', 'Price incl. VAT (free amount)'), type: 'number', min: 1 })}
    ${field({ name: 'description', label: L('Désignation (montant libre)', 'Description (free amount)'), span: true })}</div>`,
    onSubmit: (x) => api.post(`/api/hotel/bookings/${b.id}/charges`, x.product_id ? { product_id: x.product_id, qty: x.qty } : { description: x.description, unit_price: x.amount, qty: x.qty }) });
  if (v) toast(L('Prestation ajoutée', 'Charge added'), 'ok');
}

async function moveDialog(b) {
  const s = await api.get(`/api/hotel/bookings/${b.id}/suggest-room`, { cache: false });
  const v = await dialog({ title: L('Changer de chambre', 'Move room'),
    body: `${field({ name: 'room_id', label: L('Nouvelle chambre', 'New room'), type: 'select', options: s.rooms.filter((r) => r.free && r.id !== b.room_id).map((r) => [r.id, `${r.number} · ${r.type_name} · ${r.hk_status}`]) })}
    ${field({ name: 'reason', label: L('Motif', 'Reason'), placeholder: L('Climatisation en panne, surclassement…', 'A/C failure, upgrade…') })}
    <label class="check"><input type="checkbox" name="keep_rate" checked> ${L('Garder le tarif actuel', 'Keep current rate')}</label><p class="muted sm">${L('Les cartes de l\'ancienne chambre sont désactivées : encodez de nouvelles cartes.', 'Old room cards are revoked: encode new cards.')}</p>`,
    onSubmit: (x) => api.post(`/api/hotel/bookings/${b.id}/move`, x) });
  if (v) { toast(`${L('Client déplacé en chambre', 'Guest moved to room')} ${v.booking.room_number}`, 'ok'); await keyDialog(v.booking).catch(fail); }
}

async function checkoutDialog(id) {
  let f = await api.get(`/api/hotel/bookings/${id}`, { cache: false });
  const b = f.booking;
  const city = b.bill_to_id !== b.guest_id;
  const lateFee = H().settings.late_checkout_fee;
  const v = await dialog({ title: `${L('Check-out', 'Check-out')} · ${b.guest_name} · ch. ${b.room_number}`, submit: L('Clôturer le séjour', 'Close the stay'),
    body: `<div class="row between lrow"><span>${L('Prestations', 'Charges')}</span><b>${money(b.charges)}</b></div>
    ${f.pending_nights.length ? `<div class="row between lrow"><span>${L('Nuits encore à compter', 'Nights still to post')}</span><b>${f.pending_nights.length}</b></div>` : ''}
    <div class="row between lrow"><span>${L('Payé', 'Paid')}</span><b>${money(b.paid)}</b></div>
    ${city ? `<div class="banner info">${L('Le solde sera facturé à', 'The balance is invoiced to')} <b>${esc(b.bill_to_name)}</b> (${L('compte société', 'company account')}).</div>` : ''}
    ${b.late_checkout ? `<label class="check"><input type="checkbox" name="late_checkout_fee"> ${L('Facturer le départ tardif', 'Charge late check-out')} (${money(lateFee)})</label>` : ''}
    <p class="muted sm">${L('Les nuits non comptées sont ajoutées, la facture est créée dans Compta, les cartes-clés sont désactivées et la chambre passe « à nettoyer ».', 'Unposted nights are added, the invoice is created in Compta, key cards are revoked and the room goes to housekeeping.')}</p>`,
    onSubmit: async (x) => {
      const go = (extra = {}) => withPin((pin) => api.post(`/api/hotel/bookings/${id}/check-out`, { late_checkout_fee: x.late_checkout_fee || undefined, manager_pin: pin, ...extra }));
      try { return await go(); } catch (e) {
        if (e.status !== 409 || !/Reste à payer/.test(e.message)) throw e;
        f = await api.get(`/api/hotel/bookings/${id}`, { cache: false });
        const choice = await dialog({ title: L('Solde à régler', 'Balance due'), submit: L('Encaisser le solde', 'Collect the balance'), cancel: isManager() ? L('Partir avec la dette', 'Leave with debt') : L('Annuler', 'Cancel'),
          body: `<p>${L('Reste à payer', 'Balance due')} : <b style="font-size:20px">${money(f.booking.balance)}</b></p>` });
        if (choice) { const p = await payDialog(id, f.booking.balance); if (!p) return false; return go(); }
        if (isManager() && await confirmDlg(L('Départ avec dette', 'Leave with debt'), L('Le client part sans payer le solde. Une facture ouverte reste dans Compta.', 'The guest leaves without paying. An open invoice stays in Compta.'), L('Confirmer', 'Confirm'), true)) return go({ allow_debt: true });
        return false;
      }
    } });
  if (!v) return;
  toast(`${L('Séjour clôturé', 'Stay closed')} · ${L('facture', 'invoice')} ${v.invoice_number || '—'}${v.points ? ` · +${v.points} pts` : ''}`, 'ok');
  if (v.booking.guest_phone) {
    const msg = `${L('Merci', 'Thank you')} ${v.booking.guest_name} ${L('pour votre séjour au', 'for staying at')} ${state.me.company.name} ! ${L('Votre facture et votre avis', 'Your invoice and review')} : ${H().public_url}/g/${v.booking.portal_token}`;
    if (await confirmDlg(L('Remercier le client', 'Thank the guest'), L('Envoyer la facture et la demande d\'avis par WhatsApp ?', 'Send the invoice and review link by WhatsApp?'), 'WhatsApp')) window.open(wa(v.booking.guest_phone, msg), '_blank');
  }
}

// ===================== Guests =====================
R('/hotel/guests', async (ctx) => {
  ctx.title(L('Clients et VIP', 'Guests & VIP'));
  if (can('frontdesk')) ctx.actions(`<button class="btn primary" id="newg">${icon('plus')}<span class="hide-m">${L('Client', 'Guest')}</span></button>`);
  const rows = await api.get(`/api/hotel/guests${qs({ q: ctx.query.q, vip: ctx.query.vip })}`);
  ctx.el.innerHTML = `<div class="filters"><input type="search" class="in" id="q" value="${esc(ctx.query.q || '')}" placeholder="${L('Nom, téléphone, e-mail, n° de pièce…', 'Name, phone, e-mail, ID no.…')}">
    <label class="check"><input type="checkbox" id="vip" ${ctx.query.vip ? 'checked' : ''}> ${L('VIP seulement', 'VIP only')}</label></div>
    ${table({ rows, href: (r) => `#/hotel/guest/${r.id}`, columns: [
      { label: L('Client', 'Guest'), render: (r) => `<b>${esc(r.name)}</b> ${vipBadge(r.vip)}${r.blacklisted ? ` <span class="pill bad">${L('liste noire', 'blacklisted')}</span>` : ''}${r.in_house ? ` <span class="pill ok">${L('à l\'hôtel', 'in house')}</span>` : ''}<div class="muted sm">${esc(r.phone || '')} ${esc(r.email || '')}</div>` },
      { label: L('Nationalité', 'Nationality'), hideM: true, render: (r) => esc(r.nationality || '') },
      { label: L('Séjours', 'Stays'), cls: 'r num', render: (r) => num(r.stays) },
      { label: L('Points', 'Points'), cls: 'r num', hideM: true, render: (r) => num(r.points || 0) },
      { label: L('Dernier séjour', 'Last stay'), hideM: true, render: (r) => dt(r.last_stay) }] })}`;
  let t; ctx.el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = '/hotel/guests' + qs({ ...ctx.query, q: e.target.value }); }, 450); });
  ctx.el.querySelector('#vip').addEventListener('change', (e) => { location.hash = '/hotel/guests' + qs({ ...ctx.query, vip: e.target.checked ? 1 : '' }); });
  document.getElementById('newg')?.addEventListener('click', async () => { const g = await guestDialog(); if (g) location.hash = `#/hotel/guest/${g.partner_id}`; });
});

async function guestDialog(g = {}) {
  const ids = ['CNI', 'Passeport', 'Carte de séjour', 'Permis', 'Récépissé'].map((x) => [x, x]);
  return dialog({ title: g.partner_id ? L('Fiche client', 'Guest file') : L('Nouveau client', 'New guest'), wide: true,
    body: `<div class="f3">${field({ name: 'title', label: L('Civilité', 'Title'), type: 'select', options: [['', ''], ['M.', 'M.'], ['Mme', 'Mme'], ['Dr', 'Dr'], ['Pr', 'Pr'], ['Me', 'Me'], ['S.E.', 'S.E.']] }, g)}${field({ name: 'name', label: L('Nom et prénoms', 'Full name'), required: true }, g)}${field({ name: 'phone', label: L('Téléphone', 'Phone'), type: 'tel' }, g)}
    ${field({ name: 'email', label: 'E-mail', type: 'email' }, g)}${field({ name: 'nationality', label: L('Nationalité', 'Nationality') }, g)}${field({ name: 'city', label: L('Ville', 'City') }, g)}
    ${field({ name: 'id_type', label: L('Pièce', 'ID'), type: 'select', options: ids }, g)}${field({ name: 'id_number', label: L('N° de pièce', 'ID number') }, g)}${field({ name: 'id_issued_on', label: L('Délivrée le', 'Issued on'), type: 'date' }, g)}
    ${field({ name: 'birth_date', label: L('Né(e) le', 'Born on'), type: 'date' }, g)}${field({ name: 'birth_place', label: L('À', 'At') }, g)}${field({ name: 'profession', label: L('Profession', 'Profession') }, g)}
    ${field({ name: 'vip', label: 'VIP', type: 'select', options: [[0, L('Non', 'No')], [1, 'VIP'], [2, 'VVIP']] }, g)}</div>
    ${field({ name: 'preferences', label: L('Préférences (oreiller, étage, boisson d\'accueil, journal…)', 'Preferences (pillow, floor, welcome drink, newspaper…)'), type: 'textarea' }, g)}
    ${field({ name: 'allergies', label: L('Allergies et régime', 'Allergies & diet') }, g)}
    ${isManager() ? `<div class="f2">${field({ name: 'blacklisted', label: L('Liste noire', 'Blacklisted'), type: 'checkbox' }, g)}${field({ name: 'blacklist_reason', label: L('Motif liste noire', 'Reason') }, g)}</div>` : ''}`,
    onSubmit: (v) => (g.partner_id ? api.put(`/api/hotel/guests/${g.partner_id}`, v) : api.post('/api/hotel/guests', v)) });
}

R('/hotel/guest/:id', async (ctx) => {
  const g = await api.get(`/api/hotel/guests/${ctx.params.id}`);
  ctx.title(g.name);
  ctx.actions(`${can('frontdesk') ? `<button class="btn" id="edit">${L('Modifier', 'Edit')}</button><button class="btn primary" id="book">${icon('plus')}${L('Réserver', 'Book')}</button>` : ''}`);
  const spent = g.bookings.filter((b) => b.status === 'checked_out').reduce((t, b) => t + b.charges, 0);
  ctx.el.innerHTML = `${g.blacklisted ? `<div class="card banner bad"><b>${L('Liste noire', 'Blacklisted')}</b> : ${esc(g.blacklist_reason)}</div>` : ''}
  <div class="grid g4">${kpi(L('Séjours', 'Stays'), num(g.stays), `${num(g.nights)} ${L('nuits', 'nights')}`, 'accent')}${kpi(L('Dépensé', 'Spent'), money(spent))}${kpi(L('Points fidélité', 'Loyalty points'), num(g.points))}${kpi(L('Statut', 'Status'), g.vip ? (g.vip === 2 ? 'VVIP' : 'VIP') : L('Standard', 'Standard'))}</div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${L('Identité', 'Identity')}</h3>
    ${[[L('Téléphone', 'Phone'), g.phone], ['E-mail', g.email], [L('Nationalité', 'Nationality'), g.nationality], [L('Pièce', 'ID'), `${g.id_type || ''} ${g.id_number || ''}`], [L('Né(e) le', 'Born'), `${dt(g.birth_date)} ${g.birth_place || ''}`], [L('Profession', 'Profession'), g.profession]].map(([k, v]) => `<div class="row between lrow"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('')}</div>
    <div class="card"><h3>${L('Préférences', 'Preferences')}</h3><p>${esc(g.preferences || L('Aucune préférence notée.', 'No preference noted.'))}</p>${g.allergies ? `<p style="color:var(--bad)"><b>${L('Allergies', 'Allergies')} :</b> ${esc(g.allergies)}</p>` : ''}
    ${g.lost_found.length ? `<h3>${L('Objets trouvés', 'Lost & found')}</h3>${g.lost_found.map((l) => `<div class="lrow">${esc(l.item)} · <span class="pill">${esc(l.status)}</span></div>`).join('')}` : ''}</div></div>
  <h3 style="margin:20px 0 10px">${L('Historique des séjours', 'Stay history')}</h3>
  ${table({ rows: g.bookings, href: (r) => `#/hotel/booking/${r.id}`, columns: [{ label: 'N°', render: (r) => esc(r.number) }, { label: L('Dates', 'Dates'), render: (r) => `${dt(r.arrival)} → ${dt(r.departure)}` }, { label: L('Chambre', 'Room'), render: (r) => `${esc(r.room_number || '')} ${esc(r.type_name)}` }, { label: L('Statut', 'Status'), render: (r) => bpill(r.status) }, { label: L('Montant', 'Amount'), cls: 'r num', render: (r) => money(r.charges) }] })}`;
  document.getElementById('edit')?.addEventListener('click', async () => { if (await guestDialog(g)) ctx.rerender(); });
  document.getElementById('book')?.addEventListener('click', () => bookingDialog({ guest_id: g.partner_id, guest_name: g.name }).catch(fail));
});
