// Teknons Resto: dashboard, live floor plan, the waiter's order screen
// (coursing, options, split, transfer), payments with tips and Mobile Money,
// and the takeaway / delivery board. Kitchen screen, reservations, menu,
// stock, reports, cash-up and settings are in resto-ops.js.
import { api } from './api.js';
import { state, L, esc, money, moneyShort, num, dt, today, icon, can, canAny, field, dialog, toast, showError, confirmDlg, offlineNote } from './ui.js';

export const routes = [];
export const R = (path, fn, live = false) => routes.push([path, fn, live]);
export const M = () => state.resto;
export const isManager = () => ['owner', 'admin', 'manager'].includes(state.me.user.role);
export const fail = (e) => { if (!e?.quiet) showError(e); };
export async function refreshMeta() { try { state.resto = await api.get('/api/resto/meta', { cache: false }); } catch {} }
export const kpi = (l, v, s = '', cls = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="card kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></${href ? 'a' : 'div'}>`;
export const mins = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)) : 0);
export const ago = (iso) => { const m = mins(iso); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
export const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' }) : '');
export const waNumber = (p) => String(p || '').replace(/\D/g, '').replace(/^(6\d{8})$/, '237$1');
export const wa = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
export const payName = (m) => { const x = M()?.pay?.[m]; return x ? L(x.fr, x.en) : m; };
export const kindName = (k) => { const x = M()?.kinds?.[k]; return x ? L(x.fr, x.en) : k; };
export const COURSES = { 0: ['Boissons', 'Drinks'], 1: ['Entrées', 'Starters'], 2: ['Plats', 'Mains'], 3: ['Desserts', 'Desserts'], 4: ['Après', 'After'] };
export const courseName = (c) => L(...(COURSES[c] || COURSES[2]));
const LS = { pending: ['À envoyer', 'Not sent'], held: ['En attente', 'Held'], sent: ['En cuisine', 'Sent'], preparing: ['En préparation', 'Cooking'], ready: ['Prêt !', 'Ready!'], served: ['Servi', 'Served'], void: ['Annulé', 'Void'] };
export const lsPill = (s) => `<span class="ls ${s}">${esc(L(...(LS[s] || [s, s])))}</span>`;
export const emojiFor = (name = '', cat = '') => {
  const s = `${cat} ${name}`.toLowerCase();
  if (/bi[eè]re|beer|castel|33|guinness/.test(s)) return '🍺'; if (/vin|wine|champagne/.test(s)) return '🍷'; if (/cocktail|mojito|spritz|gin|whisky|rhum/.test(s)) return '🍸';
  if (/jus|juice|soda|eau|water|coca|boisson|drink|café|coffee|thé|tea/.test(s)) return '🥤'; if (/dessert|g[aâ]teau|tarte|glace|cake|fondant|crème/.test(s)) return '🍰';
  if (/poisson|fish|bar|capitaine|crevette|gambas|sole/.test(s)) return '🐟'; if (/poulet|chicken|dg/.test(s)) return '🍗'; if (/b[oœ]uf|steak|entrec[oô]te|filet|brochette|soya|viande/.test(s)) return '🥩';
  if (/salade|entr[ée]e|avocat|starter/.test(s)) return '🥗'; if (/pizza/.test(s)) return '🍕'; if (/burger/.test(s)) return '🍔'; if (/ndol[eé]|eru|okok|kondr[eé]|sauce|plat/.test(s)) return '🍲';
  if (/frite|plantain|miondo|b[aâ]ton|riz|accompagnement|side/.test(s)) return '🍟';
  return '🍽️';
};

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
  const svc = canAny('service', 'pos'), kit = canAny('kitchen', 'service');
  return `<h6>${L('Service', 'Service')}</h6>
  ${item('/resto/floor', 'store', 'Plan de salle', 'Floor plan', svc || can('read'))}
  ${item('/resto/takeaway', 'truck', 'Emporter et livraison', 'Takeaway & delivery', svc || can('read'))}
  ${item('/resto/kitchen', 'monitor', 'Écran cuisine et bar', 'Kitchen & bar screen', kit)}
  ${item('/resto/reservations', 'calendar', 'Réservations', 'Reservations')}
  ${item('/resto/cash', 'cash', 'Ma caisse', 'My cash drawer', canAny('service', 'pos', 'treasury'))}
  <h6>${L('Carte et cuisine', 'Menu & kitchen')}</h6>
  ${item('/resto/menu', 'book', 'Carte et recettes', 'Menu & recipes')}
  ${item('/resto/stock', 'box', 'Stock et achats', 'Stock & purchasing', canAny('stock', 'purchases', 'kitchen', 'read'))}
  ${item('/resto/customers', 'star', 'Clients fidèles', 'Loyal guests')}
  <h6>${L('Pilotage', 'Management')}</h6>
  ${item('/resto/insights', 'chart', 'Prévisions et conseils', 'Forecast & insights', canAny('reports', 'service'))}
  ${item('/resto/reports', 'chart', 'Rapports du restaurant', 'Restaurant reports', can('reports'))}
  ${item('/resto/checks', 'receipt', 'Historique des additions', 'Check history', canAny('reports', 'service', 'pos'))}
  ${item('/resto/settings', 'gear', 'Réglages du restaurant', 'Restaurant settings', can('settings'))}`;
}
export function bottomNav() {
  if (can('kitchen') && !can('service')) return `<a href="#/resto/kitchen" data-nav="/resto/kitchen">${icon('monitor')}${L('Cuisine', 'Kitchen')}</a><a href="#/resto/stock" data-nav="/resto/stock">${icon('box')}Stock</a><a href="#/resto/menu" data-nav="/resto/menu">${icon('book')}${L('Carte', 'Menu')}</a>`;
  return `<a href="#/resto/floor" data-nav="/resto/floor">${icon('store')}${L('Salle', 'Floor')}</a>
    <a href="#/resto/takeaway" data-nav="/resto/takeaway">${icon('truck')}${L('Emporter', 'To go')}</a>
    <a href="#/resto/kitchen" data-nav="/resto/kitchen">${icon('monitor')}${L('Cuisine', 'Kitchen')}</a>
    <a href="#/resto/reservations" data-nav="/resto/reservations">${icon('calendar')}${L('Résa', 'Bookings')}</a>`;
}

// ===================== Dashboard =====================
export async function dashboard(ctx) {
  ctx.title(L('Tableau de bord du restaurant', 'Restaurant dashboard'));
  if (canAny('service', 'pos')) ctx.actions(`<a class="btn" href="#/resto/takeaway">${icon('truck')}<span class="hide-m">${L('À emporter', 'Takeaway')}</span></a><a class="btn primary" href="#/resto/floor">${icon('store')}<span class="hide-m">${L('Plan de salle', 'Floor plan')}</span></a>`);
  const d = await api.get('/api/resto/dashboard');
  const s = d.sales;
  const vs = (a, b) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round((a - b) * 100 / b))} %` : '');
  const maxH = Math.max(1, ...d.hourly.map((h) => h.v));
  const maxT = Math.max(1, ...d.trend.map((h) => h.v));
  const totalPay = d.payments.reduce((t, p) => t + p.v, 0) || 1;
  const k = d.kitchen;
  ctx.el.innerHTML = `${offlineNote(d)}
  ${d.calls ? `<div class="card banner warn"><b>${d.calls} ${L('appel(s) de table en attente', 'table call(s) waiting')}</b> · <a href="#/resto/floor">${L('Voir la salle', 'Open floor')}</a></div>` : ''}
  <div class="grid g4">
    ${kpi(L('Chiffre du jour', "Today's sales"), money(s.total), `${vs(s.total, d.last_week.total)} ${d.last_week.total ? L('vs même jour sem. dernière', 'vs same day last week') : `${L('hier', 'yesterday')} ${money(d.yesterday.total)}`}`, 'accent', can('reports') ? '#/resto/reports' : '')}
    ${kpi(L('Couverts', 'Covers'), num(s.covers), `${s.checks} ${L('additions', 'checks')} · ${L('ticket moyen', 'avg check')} ${money(s.avg_check)}`)}
    ${kpi(L('En salle maintenant', 'Seated now'), `${d.tables.busy} / ${d.tables.n}`, `${d.open.covers} ${L('couverts', 'covers')} · ${money(d.open.due)} ${L('à encaisser', 'to collect')}`, '', '#/resto/floor')}
    ${kpi(L('Cuisine', 'Kitchen'), k.avg_min != null ? `${String(k.avg_min).replace('.', ',')} min` : '—', `${k.waiting} ${L('plat(s) en cours', 'dish(es) cooking')}${k.oldest ? ` · ${L('le plus ancien', 'oldest')} ${ago(k.oldest)}` : ''} · ${L('objectif', 'target')} ${k.target} min`, k.avg_min > k.target ? 'warn' : '', '#/resto/kitchen')}
  </div>
  ${d.insights.length ? `<div class="card" style="margin-top:16px"><div class="row between" style="margin-bottom:10px"><span class="ai-tag">✦ Teknons Insight</span><a class="btn sm" href="#/resto/insights">${L('Prévisions détaillées', 'Full forecast')}</a></div>
    <div class="rs-ins">${d.insights.map((i) => `<div class="ins ${i.level}"><b>${esc(i.title)}</b><p>${esc(i.body)}</p></div>`).join('')}</div></div>` : ''}
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>${L('Service du jour par heure', 'Today by hour')}</h3>
      ${d.hourly.length ? `<div class="hbars">${((lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => i + lo))(Math.min(9, ...d.hourly.map((h) => h.h)), Math.max(23, ...d.hourly.map((h) => h.h))).map((h) => { const x = d.hourly.find((y) => y.h === h); return `<div class="hb" title="${h} h : ${money(x?.v || 0)}"><i style="height:${x ? Math.max(4, (x.v / maxH) * 100) : 0}%"></i><span>${h}</span></div>`; }).join('')}</div>` : `<p class="muted">${L('Pas encore d\'addition réglée aujourd\'hui.', 'No paid check yet today.')}</p>`}
      <h3 style="margin-top:16px">${L('14 derniers jours', 'Last 14 days')}</h3>
      <div class="hbars small">${d.trend.map((t) => `<div class="hb" title="${dt(t.d)} : ${money(t.v)} · ${t.c} couv."><i style="height:${Math.max(3, (t.v / maxT) * 100)}%;background:var(--navy)"></i><span>${t.d.slice(8)}</span></div>`).join('')}</div>
      ${d.forecast_today ? `<p class="muted sm" style="margin-top:10px">${L('Prévision du jour', "Today's forecast")} : <b style="color:var(--ink)">~${d.forecast_today.covers} ${L('couverts', 'covers')}</b> · ${money(d.forecast_today.revenue)}</p>` : ''}</div>
    <div class="card"><h3>${L('Plats les plus vendus aujourd\'hui', "Today's best sellers")}</h3>
      ${d.top.length ? `<div class="bar-list">${d.top.map((t) => `<div class="it"><span>${emojiFor(t.name)} ${esc(t.name)}</span><b class="num">${num(t.qty)}</b><div class="tr"><i style="width:${(t.qty / d.top[0].qty) * 100}%"></i></div></div>`).join('')}</div>` : `<p class="muted">${L('Rien vendu pour l\'instant.', 'Nothing sold yet.')}</p>`}
      ${d.payments.length ? `<h3 style="margin-top:16px">${L('Encaissements', 'Payments')}</h3><div class="stackbar">${d.payments.map((p) => `<i class="mm-${esc(p.method === 'card' ? 'bank' : p.method)}" style="width:${(p.v / totalPay) * 100}%"></i>`).join('')}</div>
        <div class="legend" style="flex-wrap:wrap;margin-top:8px">${d.payments.map((p) => `<span><i class="mm-${esc(p.method === 'card' ? 'bank' : p.method)}"></i>${esc(payName(p.method))} <b class="num">${money(p.v)}</b></span>`).join('')}</div>
        <p class="muted sm">${L('Pourboires du jour', "Today's tips")} : <b style="color:var(--ink)">${money(s.tips)}</b> · ${L('coût matière', 'food cost')} ${String(s.food_cost_pct).replace('.', ',')} %</p>` : ''}</div>
    <div class="card"><h3>${icon('calendar')} ${L('Réservations du jour', "Today's bookings")} <span class="pill info">${d.reservations.length}</span></h3>
      ${d.reservations.slice(0, 7).map((r) => `<a class="row between lrow" href="#/resto/reservations"><span><b>${esc(r.time)}</b> · ${esc(r.name)} ${r.vip ? '<span class="pill vip">VIP</span>' : ''}<div class="muted sm">${r.covers} pers.${r.table_label ? ` · table ${esc(r.table_label)}` : ''}${r.occasion ? ` · ${esc(r.occasion)}` : ''}</div></span><span class="pill ${r.status === 'arrived' || r.status === 'seated' ? 'ok' : r.status === 'waiting' ? 'warn' : 'info'}">${esc(L(...({ waiting: ['attente', 'waiting'], booked: ['réservée', 'booked'], confirmed: ['confirmée', 'confirmed'], arrived: ['arrivée', 'arrived'], seated: ['installée', 'seated'], done: ['terminée', 'done'], no_show: ['absente', 'no-show'], cancelled: ['annulée', 'cancelled'] }[r.status] || [r.status, r.status])))}</span></a>`).join('') || `<p class="muted">${L('Aucune réservation aujourd\'hui.', 'No bookings today.')}</p>`}
      ${d.low.length || d.sold_out.length ? `<h3 style="margin-top:14px">${L('À surveiller', 'Watch list')}</h3>` : ''}
      ${d.sold_out.length ? `<div class="banner bad sm">${L('Épuisé', 'Sold out')} : ${d.sold_out.map(esc).join(', ')}</div>` : ''}
      ${d.low.map((g) => `<a class="row between lrow" href="#/resto/stock"><span>${esc(g.name)}</span><b style="color:var(--warn)">${num(g.stock)} ${esc(g.unit)}</b></a>`).join('')}
      ${d.feedback.n ? `<p class="muted" style="margin-top:12px">${L('Satisfaction 30 jours', '30-day rating')} : <b style="color:var(--ink)">${String(d.feedback.avg).replace('.', ',')} / 5</b> (${d.feedback.n} ${L('avis', 'reviews')})</p>` : ''}
      ${d.voids.n ? `<p class="muted sm">${L('Annulations après envoi', 'Voids after sending')} : <b style="color:var(--bad)">${d.voids.n} · ${money(d.voids.v)}</b></p>` : ''}</div>
  </div>`;
}

// ===================== Floor plan =====================
const STATE_L = { free: ['Libre', 'Free'], seated: ['Occupée', 'Seated'], ready: ['Plats prêts', 'Food ready'], bill: ['Addition', 'Bill'], qr: ['Commande QR', 'QR order'], reserved: ['Réservée', 'Reserved'] };
function tableTile(t, edit) {
  const o = t.orders[0];
  const total = t.orders.reduce((x, y) => x + y.total, 0);
  const late = t.orders.some((x) => x.oldest && mins(x.oldest) > (M().settings.prep_target_min || 15));
  const pos = edit !== 'grid' ? `style="left:${t.x}%;top:${t.y}%"` : '';
  const dot = t.calls.length ? `<span class="dot" style="background:var(--bad)">${t.calls.length}</span>` : o?.ready ? `<span class="dot" style="background:var(--ok)">${o.ready}</span>` : o?.qr_pending ? '<span class="dot" style="background:#7C3AED">QR</span>' : '';
  return `<div class="tb ${t.shape} ${t.state} ${late ? 'late' : ''}" data-t="${t.id}" ${pos}>${dot}
    <span class="lb">${esc(t.label)}</span>
    ${o ? `<span class="am">${moneyShort(total)}</span><span class="sm">${o.covers} ${L('couv.', 'cov.')} · ${ago(o.opened_at)}</span><span class="sm">${esc((o.server_name || '').split(' ')[0])}${o.vip ? ' ★' : ''}</span>`
    : t.next_reservation ? `<span class="sm">${esc(t.next_reservation.time)} · ${esc(t.next_reservation.name.split(' ')[0])}</span><span class="sm">${t.next_reservation.covers} pers.</span>` : `<span class="sm">${t.seats} ${L('places', 'seats')}</span>`}</div>`;
}

R('/resto/floor', async (ctx) => {
  ctx.title(L('Plan de salle', 'Floor plan'));
  const f = await api.get('/api/resto/floor', { cache: true });
  const area = ctx.query.area || (f.areas[0] && String(f.areas[0].id));
  const view = ctx.query.view || (matchMedia('(max-width:700px)').matches ? 'grid' : 'plan');
  ctx.actions(`<a class="btn" href="#/resto/floor?area=${area}&view=${view === 'plan' ? 'grid' : 'plan'}">${icon(view === 'plan' ? 'list' : 'store')}<span class="hide-m">${view === 'plan' ? L('Grille', 'Grid') : L('Plan', 'Plan')}</span></a>
    ${canAny('service', 'pos') ? `<button class="btn" id="bar">${icon('cart')}<span class="hide-m">${L('Vente comptoir', 'Bar tab')}</span></button><button class="btn primary" id="walk">${icon('plus')}<span class="hide-m">${L('Nouvelle table', 'Seat guests')}</span></button>` : ''}`);
  const tables = f.tables.filter((t) => String(t.area_id) === area || !area);
  const counts = Object.fromEntries(Object.keys(STATE_L).map((k) => [k, f.tables.filter((t) => t.state === k).length]));
  ctx.el.innerHTML = `${offlineNote(f)}<div class="row between" style="margin-bottom:12px"><div class="tabs">${f.areas.map((a) => `<a href="#/resto/floor?area=${a.id}&view=${view}" class="${String(a.id) === area ? 'on' : ''}">${esc(a.name)} <b>${f.tables.filter((t) => t.area_id === a.id && t.orders.length).length}/${f.tables.filter((t) => t.area_id === a.id).length}</b></a>`).join('')}</div>
    <div class="fp-count">${Object.entries(STATE_L).filter(([k]) => counts[k]).map(([k, v]) => `<span>${esc(L(...v))}<b>${counts[k]}</b></span>`).join('')}</div></div>
  <div class="fp-wrap"><div>
    ${!f.tables.length ? `<div class="card empty"><b>${L('Aucune table', 'No tables yet')}</b><p>${can('settings') ? `<a href="#/resto/settings?tab=floor">${L('Créez vos salles et tables', 'Create your rooms and tables')}</a>` : ''}</p></div>` : view === 'plan'
    ? `<div class="fp" id="fp">${tables.map((t) => tableTile(t)).join('')}</div>` : `<div class="fp-grid">${tables.map((t) => tableTile(t, 'grid')).join('')}</div>`}
    <div class="fp-legend"><span><i style="border-color:var(--line2);border-style:dashed"></i>${L('Libre', 'Free')}</span><span><i style="border-color:var(--blue);background:var(--blue-l)"></i>${L('Occupée', 'Seated')}</span><span><i style="border-color:#8B5CF6;background:#F3EEFF"></i>${L('Commande QR à valider', 'QR order to confirm')}</span><span><i style="border-color:var(--ok);background:var(--ok-bg)"></i>${L('Plats prêts', 'Food ready')}</span><span><i style="border-color:#C9A227;background:#FFF8E1"></i>${L('Addition demandée', 'Bill asked')}</span><span><i style="border-color:#E39B16;background:var(--warn-bg)"></i>${L('Réservée bientôt', 'Reserved soon')}</span></div>
  </div><div class="rs-side">
    ${f.all_calls.length ? `<div class="card"><h3>${icon('bell')} ${L('Appels des tables', 'Table calls')}</h3>${f.all_calls.map((c) => { const t = f.tables.find((x) => x.id === c.table_id); return `<div class="call-it ${c.kind}"><span><b>${t ? `${L('Table', 'Table')} ${esc(t.label)}` : '—'}</b> · ${esc(L(M().call_kinds[c.kind]?.fr || c.kind, M().call_kinds[c.kind]?.en))} <span class="muted sm">${ago(c.at)}</span></span><button class="btn sm" data-call="${c.id}">OK</button></div>`; }).join('')}</div>` : ''}
    <div class="card"><h3>${icon('cart')} ${L('Comptoir, emporter, livraison', 'Bar, takeaway, delivery')} <span class="pill">${f.counter.length}</span></h3>
      ${f.counter.map((o) => `<a class="row between lrow" href="#/resto/order/${o.id}"><span><b>${esc(o.guest_name || o.number)}</b><div class="muted sm">${esc(kindName(o.kind))}${o.source !== 'staff' ? ` · ${esc(o.source)}` : ''} · ${ago(o.opened_at)}${o.ready ? ` · <span style="color:var(--ok)">${L('prêt', 'ready')}</span>` : ''}</div></span><b class="num">${money(o.total - o.paid)}</b></a>`).join('') || `<p class="muted sm">${L('Aucune commande en cours.', 'No open order.')}</p>`}
      <a class="btn sm" href="#/resto/takeaway" style="margin-top:8px">${L('Tableau emporter et livraison', 'Takeaway board')}</a></div>
  </div></div>`;
  const openTable = async (t) => {
    if (t.orders.length === 1) return (location.hash = `#/resto/order/${t.orders[0].id}`);
    if (t.orders.length > 1) {
      const v = await dialog({ title: `${L('Table', 'Table')} ${t.label}`, submit: null, body: `<div class="stack">${t.orders.map((o) => `<a class="btn" href="#/resto/order/${o.id}" data-x>${esc(o.number)} · ${money(o.total)}</a>`).join('')}<button class="btn primary" type="button" id="another">${L('Nouvelle addition sur cette table', 'New check on this table')}</button></div>`,
        onOpen: (d) => { d.querySelectorAll('a[data-x]').forEach((a) => a.addEventListener('click', () => d.querySelector('[data-x]').click())); d.querySelector('#another').onclick = () => { d.querySelector('[data-x]').click(); seat(t, true); }; } });
      return v;
    }
    if (!canAny('service', 'pos')) return;
    return seat(t);
  };
  const seat = async (t, second = false) => {
    const v = await dialog({ title: `${L('Installer la table', 'Seat table')} ${t.label}`, submit: L('Ouvrir l\'addition', 'Open check'),
      body: `<label class="fld">${L('Nombre de couverts', 'Covers')}<div class="pay-m" style="margin:6px 0 0">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<label class="pm"><input type="radio" name="covers" value="${n}" ${n === Math.min(t.seats, 2) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></label>
      ${t.next_reservation ? `<div class="banner warn sm">${L('Réservée à', 'Reserved at')} ${esc(t.next_reservation.time)} : ${esc(t.next_reservation.name)} (${t.next_reservation.covers} pers.)</div>` : ''}
      ${field({ name: 'guest_name', label: L('Nom (facultatif)', 'Name (optional)') })}`,
      onSubmit: (x) => api.post('/api/resto/orders', { table_id: t.id, covers: Number(x.covers) || 2, guest_name: x.guest_name, allow_second: second }) });
    if (v) location.hash = `#/resto/order/${v.id}`;
  };
  ctx.el.querySelectorAll('[data-t]').forEach((el) => el.addEventListener('click', () => openTable(f.tables.find((t) => t.id === Number(el.dataset.t))).catch(fail)));
  ctx.el.querySelectorAll('[data-call]').forEach((b) => b.onclick = () => api.post(`/api/resto/calls/${b.dataset.call}/done`).then(() => ctx.rerender()).catch(fail));
  document.getElementById('walk')?.addEventListener('click', async () => {
    const free = f.tables.filter((t) => t.state === 'free' || t.state === 'reserved');
    const v = await dialog({ title: L('Installer des clients', 'Seat guests'), submit: L('Ouvrir', 'Open'), body: `<div class="f2">${field({ name: 'table_id', label: L('Table', 'Table'), type: 'select', options: free.map((t) => [t.id, `${t.label} · ${t.seats} pl. · ${t.area_name}`]) })}${field({ name: 'covers', label: L('Couverts', 'Covers'), type: 'number', value: 2, min: 1 })}</div>`,
      onSubmit: (x) => api.post('/api/resto/orders', { table_id: Number(x.table_id), covers: Number(x.covers) }) }).catch(fail);
    if (v) location.hash = `#/resto/order/${v.id}`;
  });
  document.getElementById('bar')?.addEventListener('click', () => newCounter('bar').catch(fail));
}, true);

export async function newCounter(kind = 'takeaway') {
  const v = await dialog({ title: kind === 'bar' ? L('Vente au comptoir / bar', 'Bar tab') : kind === 'delivery' ? L('Nouvelle livraison', 'New delivery') : L('Nouvelle commande à emporter', 'New takeaway order'), submit: L('Commencer', 'Start'),
    body: `<div class="f2">${field({ name: 'guest_name', label: L('Nom du client', 'Customer name'), required: kind === 'delivery' })}${field({ name: 'phone', label: L('Téléphone', 'Phone'), type: 'tel', required: kind === 'delivery' })}
      ${kind === 'delivery' ? field({ name: 'address', label: L('Adresse de livraison', 'Delivery address'), required: true, span: true, placeholder: 'Bonapriso, rue Tokoto, immeuble bleu' }) : ''}
      ${kind !== 'bar' ? field({ name: 'pickup_time', label: kind === 'delivery' ? L('Heure souhaitée', 'Wanted time') : L('Heure de retrait', 'Pick-up time'), type: 'time' }) : ''}</div>`,
    onSubmit: (x) => api.post('/api/resto/orders', { ...x, kind }) });
  if (v) location.hash = `#/resto/order/${v.id}`;
}

// ===================== Order screen =====================
let menuCache = null;
async function loadMenu(force) { if (!menuCache || force) menuCache = await api.get('/api/resto/menu'); return menuCache; }
window.addEventListener('tk:change', (e) => { try { if (JSON.parse(e.detail).entity === 'resto_menu') menuCache = null; } catch {} });

async function optionDialog(item, preset = {}) {
  const groups = item.options || [];
  return dialog({ title: `${emojiFor(item.name)} ${item.name}`, submit: L('Ajouter', 'Add'), wide: groups.length > 1,
    body: `${item.description ? `<p class="muted" style="margin-top:0">${esc(item.description)}</p>` : ''}${item.allergens ? `<div class="banner warn sm" style="margin-bottom:10px">${L('Allergènes', 'Allergens')} : ${esc(item.allergens)}</div>` : ''}
    ${groups.map((g, gi) => `<div class="opt-g"><h4>${esc(g.group)} ${g.required ? `<span class="pill bad">${L('obligatoire', 'required')}</span>` : ''} ${g.multi ? `<span class="pill">${L('plusieurs choix', 'multiple')}</span>` : ''}</h4>
      <div class="opt-c pay-m">${g.choices.map((c, ci) => `<label class="pm"><input type="${g.multi ? 'checkbox' : 'radio'}" name="g${gi}" value="${esc(c.name)}" ${g.required && !g.multi && ci === 0 ? 'checked' : ''}><span>${esc(c.name)}${c.price ? ` +${num(c.price)}` : ''}</span></label>`).join('')}</div></div>`).join('')}
    <div class="f3">${field({ name: 'qty', label: L('Quantité', 'Qty'), type: 'number', value: preset.qty || 1, min: 1, step: 1 })}${field({ name: 'seat', label: L('Siège', 'Seat'), type: 'number', value: preset.seat || '', min: 0, placeholder: '—' })}
    ${field({ name: 'course', label: L('Envoi', 'Course'), type: 'select', value: item.drinks ? 0 : item.course, options: Object.keys(COURSES).map((c) => [c, courseName(c)]) })}</div>
    ${field({ name: 'note', label: L('Note pour la cuisine', 'Note for the kitchen'), placeholder: L('sans piment, allergie arachide…', 'no chili, peanut allergy…') })}`,
    onSubmit: (x, form) => {
      const opts = [];
      groups.forEach((g, gi) => form.querySelectorAll(`[name=g${gi}]:checked`).forEach((i) => opts.push(i.value)));
      return { qty: Number(x.qty) || 1, seat: Number(x.seat) || 0, course: Number(x.course), note: x.note, options: opts };
    } });
}

R('/resto/order/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const [m, first] = await Promise.all([loadMenu(), api.get(`/api/resto/orders/${id}`, { cache: false })]);
  let o = first;
  let draft = [];
  let cat = ctx.query.cat || 'all';
  let q = '';
  let holdCourses = true;
  const svc = canAny('service', 'pos');
  const itemOf = (pid) => m.items.find((x) => x.id === pid);
  const catOf = (cid) => m.categories.find((c) => c.id === cid);
  const title = () => ctx.title(o.table_label ? `${L('Table', 'Table')} ${o.table_label} · ${o.number}` : `${kindName(o.kind)} · ${o.guest_name || o.number}`);
  title();
  ctx.actions(`<a class="btn" href="#/resto/floor">${icon('store')}<span class="hide-m">${L('Salle', 'Floor')}</span></a>`);
  ctx.el.innerHTML = `<div class="op"><div class="op-menu card">
    <div class="row between"><input type="search" class="in" id="q" placeholder="${L('Rechercher un plat, une boisson…', 'Search a dish, a drink…')}" style="flex:1;min-width:180px">${m.happy_hour ? `<span class="pill warn">🍹 Happy hour −${m.happy_hour} %</span>` : ''}</div>
    <div class="pos-cats" id="cats"></div><div class="op-grid" id="grid"></div></div>
    <div class="card chk" id="chk"></div></div>`;
  const cats = ctx.el.querySelector('#cats'), grid = ctx.el.querySelector('#grid'), chk = ctx.el.querySelector('#chk');
  const drawCats = () => { cats.innerHTML = [['all', L('Tout', 'All')], ...m.categories.map((c) => [String(c.id), L(c.name, c.name_en || c.name)])].map(([k, l]) => `<button class="${k === cat ? 'on' : ''}" data-c="${k}">${esc(l)}</button>`).join(''); };
  const drawGrid = () => {
    const ql = q.toLowerCase();
    const list = m.items.filter((x) => (cat === 'all' || String(x.category_id) === cat) && (!ql || x.name.toLowerCase().includes(ql)));
    grid.innerHTML = list.map((x) => {
      const inDraft = draft.filter((d) => d.product_id === x.id).reduce((t, d) => t + d.qty, 0);
      const tags = String(x.tags || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2);
      return `<button class="dish ${x.sold_out ? 'out' : ''}" data-i="${x.id}"><div class="ph" ${x.image ? `style="background-image:url('${esc(x.image)}')"` : ''}>${x.image ? '' : `<span>${emojiFor(x.name, catOf(x.category_id)?.name)}</span>`}</div>
        ${tags.length ? `<div class="tg">${tags.map((t) => `<i>${esc(t)}</i>`).join('')}</div>` : ''}${inDraft ? `<span class="qtyb">${inDraft}</span>` : ''}
        <div class="bd"><span class="nm">${esc(L(x.name, x.name_en || x.name))}</span>${x.left != null && !x.sold_out ? `<span class="sm" style="color:var(--warn)">${L('reste', 'left')} ${x.left}</span>` : ''}
        <span class="pr">${x.happy ? `<s>${num(x.price)}</s>${num(x.happy)}` : num(x.price)}${x.options.length ? ' <small class="muted">+</small>' : ''}</span></div></button>`;
    }).join('') || `<p class="muted">${L('Aucun plat.', 'No dish.')}</p>`;
  };
  const drawCheck = () => {
    title();
    const open = o.status === 'open';
    const active = o.lines.filter((l) => l.status !== 'void');
    const byCourse = {};
    for (const l of o.lines) (byCourse[l.course] ||= []).push(l);
    for (const d of draft) (byCourse[d.course] ||= []).push({ ...d, draft: true });
    const held = o.lines.filter((l) => l.status === 'held');
    const heldCourses = [...new Set(held.map((l) => l.course))].sort();
    const pending = o.lines.filter((l) => l.status === 'pending');
    const ready = o.lines.filter((l) => l.status === 'ready');
    const draftTotal = draft.reduce((t, d) => t + d.qty * d.unit, 0);
    chk.innerHTML = `<div class="chk-h"><div><h2>${o.table_label ? `${L('Table', 'Table')} ${esc(o.table_label)}` : esc(kindName(o.kind))}</h2>
        <div class="muted sm">${esc(o.number)} · ${o.covers ? `${o.covers} ${L('couverts', 'covers')} · ` : ''}${ago(o.opened_at)}${o.server_name ? ` · ${esc(o.server_name)}` : ''}${o.source !== 'staff' ? ` · <span class="pill info">${esc(o.source)}</span>` : ''}</div>
        ${o.customer_name || o.guest_name ? `<div class="sm">${icon('user')} <b>${esc(o.customer_name || o.guest_name)}</b>${o.loyalty ? ` · ${o.loyalty.points} pts · ${o.loyalty.visits} ${L('visites', 'visits')}${o.loyalty.vip ? ' · <span class="pill vip">VIP</span>' : ''}` : ''}${o.loyalty?.allergies ? `<div class="banner bad sm" style="margin-top:4px">⚠ ${esc(o.loyalty.allergies)}</div>` : ''}</div>` : ''}
        ${o.kind === 'delivery' ? `<div class="sm muted">${esc(o.address)} · ${esc(o.phone)}</div>` : ''}</div>
        ${open && svc ? `<button class="btn sm" id="more">${icon('more')}</button>` : `<span class="pill ${o.status === 'paid' ? 'ok' : 'bad'}">${o.status === 'paid' ? L('Réglée', 'Paid') : L('Annulée', 'Void')}</span>`}</div>
      <div class="chk-lines">${Object.keys(byCourse).sort().map((c) => `<div class="crs"><span>${esc(courseName(c))}</span>${open && heldCourses.includes(Number(c)) ? `<button class="btn sm violet" data-fire="${c}">${L('Lancer', 'Fire')} ${esc(courseName(c).toLowerCase())}</button>` : ''}</div>
        ${byCourse[c].map((l, i) => `<div class="cl ${l.draft ? 'draft' : ''} ${l.status === 'void' ? 'void' : ''}" ${l.draft ? `data-d="${draft.indexOf(draft.find((d) => d === draft.filter((x) => x.course === Number(c))[i]))}"` : `data-l="${l.id}"`}>
          <span class="q">${num(l.qty)}×</span><span><span class="n">${esc(l.name)}</span>${l.options ? `<div class="o">${esc(l.options)}</div>` : ''}${l.note ? `<div class="o" style="color:var(--bad)">⚠ ${esc(l.note)}</div>` : ''}${l.seat ? `<div class="o">${L('Siège', 'Seat')} ${l.seat}</div>` : ''}
          <div>${l.draft ? `<span class="ls held">${L('nouveau', 'new')}</span>` : lsPill(l.status)}${l.comp ? ` <span class="ls ready">${L('offert', 'comp')}</span>` : l.discount_pct ? ` <span class="ls">-${num(l.discount_pct)} %</span>` : ''}${l.source === 'qr' && l.status === 'pending' ? ' <span class="ls held">QR</span>' : ''}</div></span>
          <span class="t">${l.draft ? num(l.qty * l.unit) : l.comp ? '0' : num(l.total)}</span></div>`).join('')}`).join('') || `<div class="empty" style="padding:30px 0"><b>${L('Addition vide', 'Empty check')}</b><p class="muted">${L('Touchez les plats à gauche.', 'Tap dishes on the left.')}</p></div>`}</div>
      <div class="chk-tot">
        <div><span>${L('Sous-total', 'Subtotal')}</span><b class="num">${money(o.subtotal)}</b></div>
        ${o.discount ? `<div><span>${L('Remise', 'Discount')}${o.discount_reason ? ` (${esc(o.discount_reason)})` : ''}</span><b class="num">−${money(o.discount)}</b></div>` : ''}
        ${o.points_used ? `<div><span>${L('Points fidélité', 'Loyalty points')} (${o.points_used})</span><b class="num">−${money(o.points_used * M().settings.point_value)}</b></div>` : ''}
        ${o.service_charge ? `<div><span>Service ${num(M().settings.service_pct)} %</span><b class="num">${money(o.service_charge)}</b></div>` : ''}
        ${o.delivery_fee ? `<div><span>${L('Livraison', 'Delivery')}</span><b class="num">${money(o.delivery_fee)}</b></div>` : ''}
        ${o.paid ? `<div><span>${L('Déjà payé', 'Paid')}</span><b class="num" style="color:var(--ok)">${money(o.paid)}</b></div>` : ''}
        <div class="big"><span>${o.paid ? L('Reste', 'Due') : 'Total'}</span><span class="num">${money(o.total - o.paid)}</span></div>
        ${draft.length ? `<div style="color:#6D28D9"><span>${L('Nouveaux plats', 'New items')} (${draft.length})</span><b class="num">+${money(draftTotal)}</b></div>` : ''}
      </div>
      ${open && svc ? `<div class="chk-act">
        ${draft.length ? `<label class="check wide" style="justify-content:center"><input type="checkbox" id="hold" ${holdCourses ? 'checked' : ''}> ${L('Envoyer les entrées d\'abord, garder les plats', 'Send starters first, hold mains')}</label>
          <button class="btn primary wide" id="send">${icon('monitor')} ${L('Envoyer en cuisine', 'Send to kitchen')} · ${money(draftTotal)}</button><button class="btn" id="save">${L('Garder sans envoyer', 'Save, don\'t send')}</button><button class="btn danger" id="clear">${L('Effacer', 'Clear')}</button>`
        : `${pending.length ? `<button class="btn primary wide" id="sendp">${icon('monitor')} ${L('Valider et envoyer', 'Confirm & send')} (${pending.length})</button>` : ''}
          ${ready.length ? `<button class="btn wide" id="served" style="border-color:var(--ok);color:var(--ok)">✓ ${L('Servi', 'Served')} (${ready.length} ${L('prêt(s)', 'ready')})</button>` : ''}
          <a class="btn" href="/api/resto/orders/${o.id}/bill?print=1" target="_blank" id="bill">${icon('print')} ${L('Addition', 'Bill')}</a>
          <button class="btn primary" id="pay" ${active.length || o.total ? '' : 'disabled'}>${icon('cash')} ${L('Encaisser', 'Pay')}</button>`}
      </div>` : o.status === 'paid' ? `<div class="chk-act"><a class="btn wide" href="/api/resto/orders/${o.id}/receipt?print=1" target="_blank">${icon('print')} ${L('Imprimer le reçu', 'Print receipt')}</a>${o.phone || o.customer_phone ? `<a class="btn wide" target="_blank" href="${wa(o.phone || o.customer_phone, `${state.me.company.name} : merci ! Votre reçu ${o.number} (${money(o.total)}) et votre avis : ${M().public_url}/o/${o.token}`)}">WhatsApp</a>` : ''}</div>` : ''}
      ${o.payments.length ? `<div class="sm muted" style="margin-top:10px">${o.payments.map((p) => `${esc(payName(p.method))} ${money(p.amount)}${p.tip ? ` + ${L('pourboire', 'tip')} ${money(p.tip)}` : ''}${p.payer ? ` (${esc(p.payer)})` : ''}`).join(' · ')}</div>` : ''}`;
    wire();
  };
  const reload = async () => { o = await api.get(`/api/resto/orders/${id}`, { cache: false }); drawCheck(); };
  const addItem = async (pid) => {
    if (o.status !== 'open' || !svc) return;
    const it = itemOf(pid); if (!it || it.sold_out) return;
    let extra = { qty: 1, options: [], course: it.drinks ? 0 : it.course, seat: 0, note: '' };
    if (it.options.length || it.allergens) { const v = await optionDialog(it); if (!v) return; extra = v; }
    const optPrice = (it.options || []).flatMap((g) => g.choices).filter((c) => extra.options.includes(c.name)).reduce((t, c) => t + c.price, 0);
    const same = draft.find((d) => d.product_id === pid && !extra.options.length && !d.options.length && !extra.note && !d.note && d.seat === extra.seat && d.course === extra.course);
    if (same) same.qty += extra.qty;
    else draft.push({ product_id: pid, name: it.name, unit: (it.happy ?? it.price) + optPrice, qty: extra.qty, options: extra.options.join(', '), optList: extra.options, note: extra.note, seat: extra.seat, course: extra.course });
    drawGrid(); drawCheck();
  };
  const pushDraft = async (send) => {
    const lines = draft.map((d) => ({ product_id: d.product_id, qty: d.qty, options: d.optList, note: d.note, seat: d.seat, course: d.course }));
    o = await api.post(`/api/resto/orders/${id}/lines`, { lines, send, hold_courses: send && holdCourses });
    draft = []; drawGrid(); drawCheck();
    toast(send ? L('Envoyé en cuisine et au bar', 'Sent to kitchen and bar') : L('Enregistré', 'Saved'), 'ok');
  };
  function wire() {
    chk.querySelector('#hold')?.addEventListener('change', (e) => { holdCourses = e.target.checked; });
    chk.querySelector('#send')?.addEventListener('click', (e) => { e.target.disabled = true; pushDraft(true).catch(fail).finally(() => { e.target.disabled = false; }); });
    chk.querySelector('#save')?.addEventListener('click', () => pushDraft(false).catch(fail));
    chk.querySelector('#clear')?.addEventListener('click', () => { draft = []; drawGrid(); drawCheck(); });
    chk.querySelector('#sendp')?.addEventListener('click', () => api.post(`/api/resto/orders/${id}/send`, {}).then((x) => { o = x; drawCheck(); toast(L('Envoyé', 'Sent'), 'ok'); }).catch(fail));
    chk.querySelector('#served')?.addEventListener('click', () => api.post(`/api/resto/orders/${id}/served`, {}).then((x) => { o = x; drawCheck(); }).catch(fail));
    chk.querySelector('#bill')?.addEventListener('click', () => setTimeout(reload, 800));
    chk.querySelector('#pay')?.addEventListener('click', () => payDialog(o).then((r) => { if (r) { o = r; drawCheck(); if (r.status === 'paid') { toast(L('Addition réglée', 'Check paid'), 'ok'); } } }).catch(fail));
    chk.querySelectorAll('[data-fire]').forEach((b) => b.onclick = () => api.post(`/api/resto/orders/${id}/send`, { fire_course: Number(b.dataset.fire) }).then((x) => { o = x; drawCheck(); toast(L('C\'est parti en cuisine', 'Fired'), 'ok'); }).catch(fail));
    chk.querySelectorAll('[data-d]').forEach((el) => el.onclick = () => { const i = Number(el.dataset.d); if (draft[i]) { draft[i].qty > 1 ? draft[i].qty-- : draft.splice(i, 1); drawGrid(); drawCheck(); } });
    chk.querySelectorAll('[data-l]').forEach((el) => el.onclick = () => { const l = o.lines.find((x) => x.id === Number(el.dataset.l)); if (l && l.status !== 'void' && o.status === 'open' && svc) lineMenu(l).catch(fail); });
    chk.querySelector('#more')?.addEventListener('click', () => moreMenu().catch(fail));
  }
  const lineMenu = async (l) => {
    const editable = ['pending', 'held'].includes(l.status);
    const v = await dialog({ title: `${num(l.qty)} × ${l.name}`, submit: L('Enregistrer', 'Save'),
      body: `<p class="muted" style="margin-top:0">${lsPill(l.status)} ${l.sent_at ? `${L('envoyé à', 'sent at')} ${hm(l.sent_at)}` : ''}${l.options ? ` · ${esc(l.options)}` : ''}</p>
      <div class="f3">${field({ name: 'qty', label: L('Quantité', 'Qty'), type: 'number', value: l.qty, min: 1, readonly: !editable })}${field({ name: 'seat', label: L('Siège', 'Seat'), type: 'number', value: l.seat || '' })}${field({ name: 'course', label: L('Envoi', 'Course'), type: 'select', value: l.course, options: Object.keys(COURSES).map((c) => [c, courseName(c)]) })}</div>
      ${field({ name: 'note', label: L('Note cuisine', 'Kitchen note'), value: l.note })}
      <div class="f2">${field({ name: 'discount_pct', label: L('Remise %', 'Discount %'), type: 'number', value: l.discount_pct || '', min: 0 })}${field({ name: 'comp', label: L('Offert par la maison', 'On the house'), type: 'checkbox', value: l.comp })}</div>
      <div class="row" style="margin-top:6px"><button type="button" class="btn danger" id="vd">${icon('trash')} ${L('Annuler ce plat', 'Void this item')}</button></div>`,
      onOpen: (d) => d.querySelector('#vd').onclick = async () => {
        const reason = editable ? '' : (await dialog({ title: L('Motif d\'annulation', 'Void reason'), submit: L('Annuler le plat', 'Void'), danger: true, body: `<div class="pay-m">${[L('Erreur de saisie', 'Entry error'), L('Client a changé d\'avis', 'Guest changed mind'), L('Plat raté / renvoyé', 'Dish sent back'), L('Trop long', 'Too slow'), L('Rupture', 'Out of stock')].map((r, i) => `<label class="pm"><input type="radio" name="reason" value="${esc(r)}" ${i ? '' : 'checked'}><span>${esc(r)}</span></label>`).join('')}</div>` }))?.reason;
        if (!editable && !reason) return;
        try { o = await withPin((pin) => api.post(`/api/resto/orders/${id}/lines/${l.id}/void`, { reason, manager_pin: pin })); d.querySelector('[data-x]').click(); drawCheck(); toast(L('Plat annulé', 'Item voided'), 'ok'); } catch (e) { fail(e); }
      },
      onSubmit: async (x) => {
        const body = {};
        if (editable && Number(x.qty) !== l.qty) body.qty = Number(x.qty);
        if (x.note !== l.note || Number(x.seat || 0) !== l.seat || Number(x.course) !== l.course) Object.assign(body, { note: x.note, seat: Number(x.seat) || 0, course: Number(x.course) });
        if (Number(x.discount_pct || 0) !== l.discount_pct || (x.comp ? 1 : 0) !== l.comp) Object.assign(body, { discount_pct: Number(x.discount_pct) || 0, comp: x.comp });
        if (!Object.keys(body).length) return true;
        o = await withPin((pin) => api.put(`/api/resto/orders/${id}/lines/${l.id}`, { ...body, manager_pin: pin }));
        drawCheck();
        return true;
      } });
    return v;
  };
  const moreMenu = async () => {
    const acts = [
      ['split', 'swap', L('Partager / séparer l\'addition', 'Split the check')], ['move', 'store', L('Changer de table', 'Move table')], ['merge', 'plus', L('Fusionner avec une table', 'Merge with a table')],
      ['covers', 'users', L('Couverts et serveur', 'Covers & waiter')], ['customer', 'star', L('Client fidèle / points', 'Loyal guest / points')], ['discount', 'percent', L('Remise sur l\'addition', 'Check discount')],
      ...(o.kind === 'delivery' ? [['delivery', 'truck', L('Livreur et statut', 'Courier & status')]] : []), ['void', 'trash', L('Annuler l\'addition', 'Void the check')]];
    const pick = await new Promise((resolve) => {
      dialog({ title: L('Actions', 'Actions'), submit: null, body: `<div class="menu-grid">${acts.map(([k, ic, l]) => `<button type="button" data-a="${k}" class="${k === 'void' ? 'danger' : ''}">${icon(ic)}<span>${esc(l)}</span></button>`).join('')}</div>`,
        onOpen: (d) => d.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => { resolve(b.dataset.a); d.querySelector('[data-x]').click(); }) }).then(() => resolve(null));
    });
    if (!pick) return;
    const fl = pick === 'move' || pick === 'merge' ? await api.get('/api/resto/floor', { cache: false }) : null;
    if (pick === 'split') {
      const lines = o.lines.filter((l) => l.status !== 'void');
      const v = await dialog({ title: L('Séparer l\'addition', 'Split the check'), submit: L('Créer une addition séparée', 'Create separate check'),
        body: `<p class="muted" style="margin-top:0">${L('Cochez ce que la personne paie. Pour partager à parts égales, utilisez plutôt « Encaisser » → ÷2, ÷3…', 'Tick what this guest pays. For equal shares use Pay → ÷2, ÷3…')}</p>
        ${lines.map((l) => `<label class="check"><input type="checkbox" name="l${l.id}"> ${num(l.qty)} × ${esc(l.name)}${l.seat ? ` (${L('siège', 'seat')} ${l.seat})` : ''} · <b>${money(l.total)}</b></label>`).join('')}${field({ name: 'guest_name', label: L('Nom de la personne', 'Guest name') })}`,
        onSubmit: (x) => api.post(`/api/resto/orders/${id}/transfer`, { line_ids: lines.filter((l) => x['l' + l.id]).map((l) => l.id), guest_name: x.guest_name }) });
      if (v) { toast(`${L('Addition séparée', 'Separate check')} ${v.to.number}`, 'ok'); location.hash = `#/resto/order/${v.to.id}`; }
    } else if (pick === 'move') {
      const free = fl.tables.filter((t) => !t.orders.length);
      const v = await dialog({ title: L('Changer de table', 'Move table'), body: field({ name: 'table_id', label: L('Nouvelle table', 'New table'), type: 'select', options: free.map((t) => [t.id, `${t.label} · ${t.area_name} · ${t.seats} pl.`]) }), onSubmit: (x) => api.put(`/api/resto/orders/${id}`, { table_id: Number(x.table_id) }) });
      if (v) { o = v; drawCheck(); }
    } else if (pick === 'merge') {
      const others = fl.tables.flatMap((t) => t.orders.filter((x) => x.id !== o.id).map((x) => [x.id, `${L('Table', 'Table')} ${t.label} · ${x.number} · ${money(x.total)}`])).concat(fl.counter.filter((x) => x.id !== o.id).map((x) => [x.id, `${x.guest_name || x.number} · ${money(x.total)}`]));
      const v = await dialog({ title: L('Fusionner', 'Merge'), body: field({ name: 'other', label: L('Addition à rattacher ici', 'Check to bring here'), type: 'select', options: others }), onSubmit: (x) => api.post(`/api/resto/orders/${id}/merge`, { other_id: Number(x.other) }) });
      if (v) { o = v; drawCheck(); }
    } else if (pick === 'covers') {
      const v = await dialog({ title: L('Couverts et serveur', 'Covers & waiter'), body: `<div class="f2">${field({ name: 'covers', label: L('Couverts', 'Covers'), type: 'number', value: o.covers, min: 0 })}${field({ name: 'server_id', label: L('Serveur', 'Waiter'), type: 'select', value: o.server_id, options: M().staff.map((s) => [s.id, s.name]) })}${field({ name: 'note', label: L('Note', 'Note'), value: o.note, span: true })}</div>`,
        onSubmit: (x) => api.put(`/api/resto/orders/${id}`, { covers: Number(x.covers), server_id: Number(x.server_id), note: x.note, take_over: true }) });
      if (v) { o = v; drawCheck(); }
    } else if (pick === 'customer') {
      const list = await api.get('/api/resto/customers?sort=recent');
      const v = await dialog({ title: L('Client fidèle', 'Loyal guest'), body: `<datalist id="cl">${list.map((c) => `<option value="${esc(c.phone || c.name)}">${esc(c.name)} · ${c.points} pts</option>`).join('')}</datalist>
        <div class="f2">${field({ name: 'phone', label: L('Téléphone ou nom', 'Phone or name'), list: 'cl', value: o.customer_phone || '' })}${field({ name: 'name', label: L('Nom (nouveau client)', 'Name (new guest)') })}</div>
        ${o.loyalty ? field({ name: 'points_used', label: `${L('Utiliser des points', 'Use points')} (${o.loyalty.points} ${L('dispo', 'available')}, 1 pt = ${M().settings.point_value} F)`, type: 'number', value: o.points_used || '', min: 0 }) : ''}`,
        onSubmit: async (x) => {
          let cust = list.find((c) => c.phone === x.phone || c.name === x.phone);
          if (!cust && x.phone) cust = await api.post('/api/resto/customers', { name: x.name || x.phone, phone: /\d{8}/.test(x.phone) ? x.phone : '' });
          return api.put(`/api/resto/orders/${id}`, { customer_id: cust?.id ?? cust?.partner_id ?? null, ...(x.points_used !== undefined ? { points_used: Number(x.points_used) || 0 } : {}) });
        } });
      if (v) { o = v; drawCheck(); }
    } else if (pick === 'discount') {
      const v = await dialog({ title: L('Remise sur l\'addition', 'Check discount'), body: `<div class="f2">${field({ name: 'discount_pct', label: L('Remise en %', 'Discount %'), type: 'number', min: 0 })}${field({ name: 'discount', label: L('ou montant FCFA', 'or amount'), type: 'number', min: 0, value: o.discount || '' })}${field({ name: 'discount_reason', label: L('Motif', 'Reason'), span: true, value: o.discount_reason, placeholder: L('Client régulier, anniversaire, attente…', 'Regular, birthday, wait…') })}</div>`,
        onSubmit: (x) => withPin((pin) => api.put(`/api/resto/orders/${id}`, { ...(x.discount_pct ? { discount_pct: Number(x.discount_pct) } : { discount: Number(x.discount) || 0 }), discount_reason: x.discount_reason, manager_pin: pin })) });
      if (v) { o = v; drawCheck(); }
    } else if (pick === 'delivery') {
      const v = await dialog({ title: L('Livraison', 'Delivery'), body: `<div class="f2">${field({ name: 'courier', label: L('Livreur', 'Courier'), value: o.courier })}${field({ name: 'delivery_status', label: L('Statut', 'Status'), type: 'select', value: o.delivery_status, options: DL.map(([k, f, e]) => [k, L(f, e)]) })}${field({ name: 'address', label: L('Adresse', 'Address'), value: o.address, span: true })}</div>`,
        onSubmit: (x) => api.put(`/api/resto/orders/${id}`, x) });
      if (v) { o = v; drawCheck(); }
    } else if (pick === 'void') {
      const v = await dialog({ title: L('Annuler l\'addition', 'Void the check'), danger: true, submit: L('Annuler l\'addition', 'Void'), body: field({ name: 'reason', label: L('Motif', 'Reason'), required: o.lines.some((l) => !['pending', 'held', 'void'].includes(l.status)) }),
        onSubmit: (x) => withPin((pin) => api.post(`/api/resto/orders/${id}/void`, { reason: x.reason, manager_pin: pin })) });
      if (v) { toast(L('Addition annulée', 'Check voided'), 'ok'); location.hash = '#/resto/floor'; }
    }
  };
  ctx.el.querySelector('#q').addEventListener('input', (e) => { q = e.target.value; drawGrid(); });
  cats.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { cat = b.dataset.c; drawCats(); drawGrid(); } });
  grid.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) addItem(Number(b.dataset.i)).catch(fail); });
  drawCats(); drawGrid(); drawCheck();
  // Live: kitchen progress and QR additions refresh the check without losing the draft.
  const onLive = () => { if (!document.body.contains(chk) || document.querySelector('dialog[open]')) return; reload().catch(() => {}); };
  window.addEventListener('tk:change', onLive);
  window.addEventListener('tk:kitchen', onLive);
  const stop = () => { if (!document.body.contains(chk)) { window.removeEventListener('tk:change', onLive); window.removeEventListener('tk:kitchen', onLive); window.removeEventListener('hashchange', stop); } };
  window.addEventListener('hashchange', stop);
});
routes[routes.length - 1][1].noLiveRender = true;

// ===================== Payment =====================
export async function payDialog(o) {
  const due = o.total - o.paid;
  const s = M().settings;
  const tips = String(s.tip_suggestions || '5,10,15').split(',').map(Number).filter(Boolean);
  const methods = ['cash', 'card', 'mtn_momo', 'orange_money', 'account'];
  const partners = await api.get('/api/partners?kind=client').catch(() => []);
  let poll = null;
  const r = await dialog({ title: `${L('Encaisser', 'Take payment')} · ${money(due)}`, submit: L('Encaisser', 'Take payment'), wide: true,
    body: `<div class="pay-total" style="margin-bottom:10px">${L('Reste à payer', 'Due')} <b>${money(due)}</b>${o.paid ? ` <span class="muted sm">(${L('déjà payé', 'paid')} ${money(o.paid)})</span>` : ''}</div>
    <div class="row" style="margin-bottom:10px"><span class="muted sm">${L('Partager', 'Split')} :</span>${[1, 2, 3, 4, 5, 6].map((n) => `<button type="button" class="btn sm" data-split="${n}">${n === 1 ? L('Tout', 'All') : `÷${n}`}</button>`).join('')}</div>
    <div class="pay-m">${methods.map((m, i) => `<label class="pm"><input type="radio" name="method" value="${m}" ${i ? '' : 'checked'}><span>${esc(payName(m))}</span></label>`).join('')}</div>
    <div class="f3">${field({ name: 'amount', label: L('Montant de cette part', 'Amount of this share'), type: 'number', value: due, min: 0 })}
      <label class="fld">${L('Pourboire', 'Tip')}<input name="tip" type="number" min="0" value="" class="num" inputmode="numeric"><small>${tips.map((p) => `<a href="#" data-tip="${p}">${p} %</a>`).join(' · ')}</small></label>
      ${field({ name: 'payer', label: L('Qui paie (facultatif)', 'Who pays (optional)'), placeholder: L('Siège 2, Paul…', 'Seat 2, Paul…') })}</div>
    <div id="cashbox"><div class="f2">${field({ name: 'tendered', label: L('Somme remise par le client', 'Cash given'), type: 'number', min: 0 })}<div><div class="muted sm">${L('À rendre', 'Change')}</div><div class="done-change" id="change" style="font-size:22px;font-weight:800">—</div></div></div>
      <div class="row" id="denoms">${[1000, 2000, 5000, 10000, 20000, 50000].map((d) => `<button type="button" class="btn sm" data-den="${d}">${num(d)}</button>`).join('')}</div></div>
    <div id="phonebox" hidden>${field({ name: 'phone', label: L('Téléphone Mobile Money du client', 'Customer Mobile Money number'), type: 'tel', placeholder: '6XX XX XX XX' })}${field({ name: 'reference', label: L('ou référence déjà reçue', 'or reference already received') })}</div>
    <div id="accbox" hidden>${field({ name: 'partner_id', label: L('Entreprise / client à facturer', 'Company / customer to invoice'), type: 'select', value: o.customer_id || '', options: [['', '—'], ...partners.filter((p) => p.name !== 'Clients de passage').map((p) => [p.id, p.name])] })}<p class="muted sm">${L('Une facture Teknons Compta est créée pour tout le reste de l\'addition.', 'A Teknons Compta invoice is created for the whole balance.')}</p></div>
    <div id="momo" class="momo-st" hidden></div>`,
    onOpen: (d) => {
      const f = d.querySelector('form');
      const upd = () => {
        const m = f.method.value;
        d.querySelector('#cashbox').hidden = m !== 'cash';
        d.querySelector('#phonebox').hidden = !['mtn_momo', 'orange_money'].includes(m);
        d.querySelector('#accbox').hidden = m !== 'account';
        f.amount.readOnly = m === 'account'; if (m === 'account') f.amount.value = due;
        const ch = (Number(f.tendered.value) || 0) - (Number(f.amount.value) || 0) - (Number(f.tip.value) || 0);
        d.querySelector('#change').textContent = f.tendered.value ? (ch >= 0 ? money(ch) : `${L('manque', 'short')} ${money(-ch)}`) : '—';
        d.querySelector('#change').style.color = ch < 0 ? 'var(--bad)' : 'var(--ok)';
        d.querySelector('button[value=ok]').textContent = ['mtn_momo', 'orange_money'].includes(m) && M().momo[m] && !f.reference.value ? L('Envoyer la demande au téléphone', 'Send request to phone') : `${L('Encaisser', 'Take')} ${money((Number(f.amount.value) || 0) + (Number(f.tip.value) || 0))}`;
      };
      f.addEventListener('input', upd); f.addEventListener('change', upd);
      d.querySelectorAll('[data-split]').forEach((b) => b.onclick = () => { f.amount.value = Math.ceil(due / Number(b.dataset.split) / 25) * 25 > due ? due : Math.ceil(due / Number(b.dataset.split) / 25) * 25; upd(); });
      d.querySelectorAll('[data-tip]').forEach((a) => a.onclick = (e) => { e.preventDefault(); f.tip.value = Math.round((Number(f.amount.value) || 0) * Number(a.dataset.tip) / 100 / 50) * 50; upd(); });
      d.querySelectorAll('[data-den]').forEach((b) => b.onclick = () => { f.tendered.value = (Number(f.tendered.value) || 0) + Number(b.dataset.den); upd(); });
      upd();
    },
    onSubmit: async (x, form) => {
      const body = { method: x.method, amount: Number(x.amount), tip: Number(x.tip) || 0, payer: x.payer, reference: x.reference };
      if (x.method === 'cash') body.tendered = x.tendered === '' ? undefined : Number(x.tendered);
      if (x.method === 'account') { body.partner_id = Number(x.partner_id) || undefined; delete body.amount; }
      if (['mtn_momo', 'orange_money'].includes(x.method) && M().momo[x.method] && !x.reference) {
        const req = await api.post(`/api/resto/orders/${o.id}/momo`, { provider: x.method, phone: x.phone, amount: body.amount, tip: body.tip, payer: x.payer });
        const box = form.querySelector('#momo'); box.hidden = false;
        box.innerHTML = `<b>${L('Demande envoyée', 'Request sent')} · ${money(req.amount)}</b> · ${L('le client confirme avec son code secret…', 'the guest confirms with their PIN…')}`;
        return new Promise((resolve, reject) => {
          poll = setInterval(async () => {
            try {
              const st = await api.get(`/api/resto/momo/${req.id}`, { cache: false });
              if (st.status === 'successful') { clearInterval(poll); resolve(await api.get(`/api/resto/orders/${o.id}`, { cache: false })); }
              else if (st.status === 'failed') { clearInterval(poll); box.innerHTML = `<b style="color:var(--bad)">${L('Échec', 'Failed')}</b> · ${esc(st.reason || '')}`; resolve(false); }
            } catch (e) { clearInterval(poll); reject(e); }
          }, 2500);
        });
      }
      const res = await withPin((pin) => api.post(`/api/resto/orders/${o.id}/pay`, { ...body, manager_pin: pin }));
      if (res.change) toast(`${L('Rendre la monnaie', 'Give change')} : ${money(res.change)}`, 'ok');
      return res;
    } });
  clearInterval(poll);
  if (r && r.status === 'paid' && r.change) await dialog({ title: L('Monnaie à rendre', 'Change to give'), submit: L('OK', 'OK'), cancel: null, body: `<div class="done-change ok" style="font-size:34px;text-align:center"><b>${money(r.change)}</b></div>` });
  return r;
}

// ===================== Takeaway and delivery board =====================
export const DL = [['pending', 'Reçue', 'Received'], ['preparing', 'En préparation', 'Preparing'], ['ready', 'Prête', 'Ready'], ['on_the_way', 'En route', 'On the way'], ['delivered', 'Livrée', 'Delivered']];
R('/resto/takeaway', async (ctx) => {
  ctx.title(L('À emporter et livraison', 'Takeaway & delivery'));
  if (canAny('service', 'pos')) ctx.actions(`<button class="btn" id="nt">${icon('cart')}<span class="hide-m">${L('À emporter', 'Takeaway')}</span></button><button class="btn primary" id="nd">${icon('truck')}<span class="hide-m">${L('Livraison', 'Delivery')}</span></button>`);
  const rows = await api.get(`/api/resto/orders?kind=takeaway,delivery,bar&from=${today()}&lines=1`);
  const live = rows.filter((o) => o.status === 'open' || (o.kind === 'delivery' && o.status === 'paid' && o.delivery_status !== 'delivered'));
  const col = (title, list, cls = '') => `<div class="dl-col"><h3>${title} <span class="pill">${list.length}</span></h3>${list.map((o) => {
    const ready = o.lines?.every((l) => ['ready', 'served'].includes(l.status));
    return `<a class="card kt ${cls} ${ready ? 'ready' : ''}" href="#/resto/order/${o.id}" style="margin-bottom:10px;color:inherit">
      <div class="kt-h"><b>${esc(o.guest_name || o.number)}</b><span class="mono">${o.pickup_time ? esc(o.pickup_time) : ago(o.opened_at)}</span></div>
      <div class="sm muted">${esc(kindName(o.kind))}${o.source !== 'staff' ? ` · ${esc(o.source === 'online' ? L('en ligne', 'online') : o.source)}` : ''}${o.phone ? ` · ${esc(o.phone)}` : ''}</div>
      ${o.kind === 'delivery' ? `<div class="sm">📍 ${esc(o.address)}${o.courier ? ` · 🛵 ${esc(o.courier)}` : ''}</div>` : ''}
      <ul>${(o.lines || []).map((l) => `<li style="font-size:14px;padding:3px 0">${num(l.qty)}× ${esc(l.name)} ${lsPill(l.status)}</li>`).join('')}</ul>
      <div class="row between"><b class="num">${money(o.total)}</b>${o.status === 'paid' ? `<span class="pill ok">${L('payée', 'paid')}</span>` : o.paid ? `<span class="pill info">${L('acompte', 'part paid')}</span>` : `<span class="pill warn">${L('à payer', 'unpaid')}</span>`}</div></a>`;
  }).join('') || `<p class="muted sm">—</p>`}</div>`;
  const kitchen = live.filter((o) => o.lines?.some((l) => !['ready', 'served'].includes(l.status)) && o.delivery_status !== 'on_the_way');
  const ready = live.filter((o) => !kitchen.includes(o) && o.delivery_status !== 'on_the_way');
  const road = live.filter((o) => o.delivery_status === 'on_the_way');
  ctx.el.innerHTML = `<div class="grid g3">${col(L('En cuisine', 'In the kitchen'), kitchen)}${col(L('Prêtes : retrait ou départ', 'Ready: pick-up or dispatch'), ready, 'ready')}${col(L('En route', 'On the way'), road)}</div>
    <div class="card" style="margin-top:16px"><h3>${L('Votre page de commande en ligne', 'Your online ordering page')}</h3><p class="muted">${L('Partagez ce lien sur WhatsApp, Instagram et Google : vos clients commandent à emporter ou en livraison, et paient par MoMo ou à la livraison.', 'Share this link on WhatsApp, Instagram and Google: guests order takeaway or delivery and pay by MoMo or on delivery.')}</p>
    <div class="row"><code class="mono">${esc(M().public_url)}/order</code><a class="btn sm" target="_blank" href="/order">${L('Ouvrir', 'Open')}</a><a class="btn sm" target="_blank" href="https://wa.me/?text=${encodeURIComponent(`${L('Commandez chez', 'Order from')} ${state.me.company.name} : ${M().public_url}/order`)}">WhatsApp</a></div></div>`;
  document.getElementById('nt')?.addEventListener('click', () => newCounter('takeaway').catch(fail));
  document.getElementById('nd')?.addEventListener('click', () => newCounter('delivery').catch(fail));
}, true);

export { confirmDlg };
