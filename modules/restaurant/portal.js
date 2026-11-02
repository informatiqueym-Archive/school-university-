// Public pages, no account needed:
//   /m/:token   table QR: menu with photos and allergens, order, call the waiter, follow the kitchen, split and pay by MoMo, review
//   /order      takeaway and delivery ordering
//   /o/:token   follow an order, pay it, leave a review
//   /reserve    book a table
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bad, notFound, forbidden, HttpError } from '../../core/errors.js';
import { str, int, date as vDate } from '../../core/validate.js';
import { today } from '../../core/schema.js';
import { raiseAlert } from '../../core/alerts.js';
import { PROVIDERS } from '../../core/payments/mobile-money.js';
import { fcfa } from '../../core/format.js';
import { settingsOf, menu, openOrder, addLines, sendLines, getOrder, momoRequest, momoStatus } from './orders.js';
import { createCall, addFeedback, createReservation, freeTables, minutesOf } from './floor.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const page = () => fs.readFileSync(path.join(pub, 'resto.html'), 'utf8');

const hits = new Map();
function throttle(ctx, max = 30) {
  const ip = String(ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '').split(',')[0].trim();
  const key = `${ip}|${ctx.url.pathname.split('/').slice(0, 5).join('/')}|${ctx.url.pathname.split('/').pop()}`;
  const t = Date.now(); const h = hits.get(key);
  if (hits.size > 5000) hits.clear();
  if (!h || t - h.at > 60e3) { hits.set(key, { at: t, n: 1 }); return; }
  if (++h.n > max) throw new HttpError(429, 'rate', 'Trop de demandes, patientez une minute');
}

function restoCompany(db, id) {
  const c = id ? db.get('SELECT c.* FROM companies c JOIN resto_settings s ON s.company_id = c.id WHERE c.id = ?', id) : db.get('SELECT c.* FROM companies c JOIN resto_settings s ON s.company_id = c.id ORDER BY c.id LIMIT 1');
  if (!c) throw notFound('Restaurant introuvable');
  return c;
}
const publicInfo = (c, s, momo) => ({
  id: c.id, name: c.name, city: c.city, address: c.address, phone: c.phone, logo: c.logo, welcome: s.welcome_text, cuisine: s.cuisine, wifi_name: s.wifi_name, wifi_password: s.wifi_password,
  open_time: s.open_time, close_time: s.close_time, service_pct: s.service_pct, tips: String(s.tip_suggestions || '').split(',').map(Number).filter((x) => x > 0),
  qr_ordering: !!s.qr_ordering, qr_pay: !!s.qr_pay, online_orders: !!s.online_orders, online_reservations: !!s.online_reservations, delivery_fee: s.delivery_fee, min_delivery: s.min_delivery,
  point_value: s.point_value, momo: Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, momo.configured(p)])),
});

const LINE_STATE = { pending: 'received', held: 'received', sent: 'kitchen', preparing: 'cooking', ready: 'ready', served: 'served' };
function publicCheck(db, o) {
  const fb = db.get('SELECT rating FROM resto_feedback WHERE order_id = ?', o.id);
  return {
    token: o.token, number: o.number, kind: o.kind, status: o.status, table: o.table_label, covers: o.covers, opened_at: o.opened_at, delivery_status: o.delivery_status, pickup_time: o.pickup_time,
    guest_name: o.guest_name, address: o.address, server: o.server_name ? o.server_name.split(' ')[0] : '',
    lines: o.lines.filter((l) => l.status !== 'void').map((l) => ({ id: l.id, name: l.name, qty: l.qty, options: l.options, note: l.note, total: l.total, comp: l.comp, seat: l.seat, state: LINE_STATE[l.status] || l.status })),
    subtotal: o.subtotal, discount: o.discount, service_charge: o.service_charge, delivery_fee: o.delivery_fee, points_used: o.points_used, total: o.total, paid: o.paid, tips: o.tips, due: Math.max(0, o.total - o.paid),
    payments: o.payments.map((p) => ({ method: p.method, amount: p.amount, tip: p.tip, payer: p.payer, at: p.at })), reviewed: !!fb,
  };
}

export function registerPortal(r, { db, bus, momo }) {
  const guestCtx = (companyId) => ({ user: { id: null, company_id: companyId, name: 'Client (QR)', role: 'owner' } });
  for (const p of ['/m/:token', '/o/:token']) r.get(p, (ctx) => ctx.send(page()));
  r.get('/order', (ctx) => ctx.send(page()));
  r.get('/reserve', (ctx) => ctx.send(page()));

  const tableOf = (tok) => {
    const t = db.get('SELECT t.*, a.name area_name FROM resto_tables t JOIN resto_areas a ON a.id = t.area_id WHERE t.qr_token = ? AND t.active = 1', String(tok));
    if (!t) throw notFound('QR code inconnu. Demandez au serveur.');
    return t;
  };
  const openCheck = (t) => db.get("SELECT id FROM resto_orders WHERE company_id = ? AND table_id = ? AND status = 'open' ORDER BY id LIMIT 1", t.company_id, t.id);
  const checkOf = (tok) => {
    const o = db.get('SELECT id, company_id FROM resto_orders WHERE token = ?', String(tok));
    if (!o) throw notFound('Commande introuvable');
    return getOrder(db, o.company_id, o.id);
  };

  // ---------------- Info, menu ----------------
  r.get('/api/public/resto', (ctx) => {
    const c = restoCompany(db, ctx.query.c);
    const s = settingsOf(db, c.id);
    return { ...publicInfo(c, s, momo), menu: menu(db, c.id, { channel: 'online' }) };
  });

  // ---------------- Table QR ----------------
  r.get('/api/public/resto/table/:token', (ctx) => {
    const t = tableOf(ctx.params.token);
    const c = restoCompany(db, t.company_id); const s = settingsOf(db, c.id);
    const open = openCheck(t);
    return { ...publicInfo(c, s, momo), table: { label: t.label, area: t.area_name, seats: t.seats }, menu: menu(db, c.id, { channel: 'qr' }), check: open ? publicCheck(db, getOrder(db, c.id, open.id)) : null };
  });
  r.post('/api/public/resto/table/:token/order', (ctx) => {
    throttle(ctx, 12);
    const t = tableOf(ctx.params.token);
    const c = restoCompany(db, t.company_id); const s = settingsOf(db, c.id);
    if (!s.qr_ordering) throw forbidden('Commande par QR désactivée : appelez le serveur');
    const lines = Array.isArray(ctx.body.lines) ? ctx.body.lines.slice(0, 30) : [];
    if (!lines.length) throw bad('lines', 'Votre panier est vide');
    const g = guestCtx(c.id);
    const name = str(ctx.body.name, 60);
    return db.tx(() => {
      const open = openCheck(t);
      let o;
      if (open) o = addLines(db, bus, g, c, open.id, { lines }, { source: 'qr' });
      else o = openOrder(db, bus, g, c, { kind: 'dine_in', table_id: t.id, covers: int(ctx.body.covers, 'covers', { min: 1, def: Math.min(2, t.seats) }), guest_name: name, lines }, { source: 'qr' });
      if (s.qr_auto_send) o = sendLines(db, bus, g, c, o.id, { hold_courses: false });
      const total = o.lines.filter((l) => l.source === 'qr' && l.status === 'pending').reduce((x, l) => x + l.total, 0);
      bus.emit(c.id, 'call', { table: t.label, kind: 'order', title: `Table ${t.label} : nouvelle commande QR${total ? ` (${fcfa(total)})` : ''}${s.qr_auto_send ? ' envoyée en cuisine' : ' à valider'}` });
      return publicCheck(db, getOrder(db, c.id, o.id));
    });
  });
  r.post('/api/public/resto/table/:token/call', (ctx) => {
    throttle(ctx, 10);
    const t = tableOf(ctx.params.token);
    createCall(db, bus, t.company_id, { table_id: t.id, order_id: openCheck(t)?.id, kind: ctx.body.kind, note: ctx.body.note });
    return { ok: true };
  });

  // ---------------- Check: follow, pay, review ----------------
  r.get('/api/public/resto/check/:token', (ctx) => {
    const o = checkOf(ctx.params.token);
    const c = restoCompany(db, o.company_id); const s = settingsOf(db, c.id);
    return { ...publicInfo(c, s, momo), check: publicCheck(db, o) };
  });
  r.post('/api/public/resto/check/:token/pay', async (ctx) => {
    throttle(ctx, 8);
    const o = checkOf(ctx.params.token);
    const c = restoCompany(db, o.company_id); const s = settingsOf(db, c.id);
    if (o.source === 'staff' && !s.qr_pay) throw forbidden('Paiement par téléphone désactivé : demandez au serveur');
    if (o.status !== 'open') throw bad('closed', 'Cette addition est déjà réglée');
    const req = await momoRequest(db, momo, guestCtx(c.id), c, o.id, { provider: ctx.body.provider, phone: ctx.body.phone, amount: ctx.body.amount, tip: ctx.body.tip, payer: ctx.body.payer }, { source: o.source === 'online' ? 'online' : 'qr' });
    return { ...req, mode: momo.mode };
  });
  r.get('/api/public/resto/check/:token/pay/:id', async (ctx) => {
    const o = checkOf(ctx.params.token);
    const c = restoCompany(db, o.company_id);
    const m = db.get('SELECT id FROM resto_momo WHERE id = ? AND order_id = ?', ctx.params.id, o.id);
    if (!m) throw notFound('Demande introuvable');
    const st = await momoStatus(db, bus, momo, guestCtx(c.id), c, m.id);
    return { ...st, check: publicCheck(db, getOrder(db, c.id, o.id)) };
  });
  r.post('/api/public/resto/check/:token/call', (ctx) => {
    throttle(ctx, 10);
    const o = checkOf(ctx.params.token);
    createCall(db, bus, o.company_id, { table_id: o.table_id, order_id: o.id, kind: ctx.body.kind, note: ctx.body.note });
    return { ok: true };
  });
  r.post('/api/public/resto/check/:token/feedback', (ctx) => {
    throttle(ctx, 5);
    const o = checkOf(ctx.params.token);
    return addFeedback(db, bus, o.company_id, o.id, ctx.body);
  });

  // ---------------- Takeaway and delivery ----------------
  r.post('/api/public/resto/online-order', (ctx) => {
    throttle(ctx, 6);
    const b = ctx.body;
    const c = restoCompany(db, b.c); const s = settingsOf(db, c.id);
    if (!s.online_orders) throw forbidden('Commandes en ligne fermées pour le moment');
    const kind = b.kind === 'delivery' ? 'delivery' : 'takeaway';
    const name = str(b.name, 80), phone = str(b.phone, 30);
    if (!name || phone.replace(/\D/g, '').length < 8) throw bad('phone', 'Nom et téléphone obligatoires');
    if (kind === 'delivery' && !str(b.address)) throw bad('address', 'Adresse de livraison obligatoire');
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, 40) : [];
    if (!lines.length) throw bad('lines', 'Votre panier est vide');
    const g = guestCtx(c.id);
    return db.tx(() => {
      let o = openOrder(db, bus, g, c, { kind, guest_name: name, phone, address: b.address, pickup_time: b.pickup_time, note: b.note, lines }, { source: 'online' });
      const food = o.subtotal;
      if (kind === 'delivery' && food < s.min_delivery) throw bad('min', `Minimum de commande pour la livraison : ${fcfa(s.min_delivery)}`);
      o = sendLines(db, bus, g, c, o.id, {});
      raiseAlert(db, bus, c.id, { kind: 'resto_online', level: 'info', title: `${kind === 'delivery' ? 'Livraison' : 'À emporter'} en ligne : ${name} · ${fcfa(o.total)}`, body: `${o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}${kind === 'delivery' ? ` · ${str(b.address, 120)}` : ''}`, entity: 'resto_order', entity_id: o.id });
      return ctx.json({ token: o.token, number: o.number, total: o.total }, 201);
    });
  });

  // ---------------- Reservations ----------------
  r.get('/api/public/resto/slots', (ctx) => {
    const c = restoCompany(db, ctx.query.c); const s = settingsOf(db, c.id);
    const date = vDate(ctx.query.date, 'date', today());
    const covers = int(ctx.query.covers, 'covers', { min: 1, def: 2 });
    const out = [];
    const nowMin = date === today() ? minutesOf(new Date()) + 30 : 0;
    for (let m = minutesOf(s.open_time); m <= minutesOf(s.close_time) - 60; m += 30) {
      if (m < nowMin) continue;
      const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      out.push({ time, free: freeTables(db, c.id, date, time, covers).length > 0 });
    }
    return { date, covers, slots: out };
  });
  r.post('/api/public/resto/reserve', (ctx) => {
    throttle(ctx, 5);
    const c = restoCompany(db, ctx.body.c);
    const res = createReservation(db, bus, null, c.id, ctx.body, { source: 'web' });
    return ctx.json({ number: res.number, date: res.date, time: res.time, covers: res.covers, name: res.name }, 201);
  });
}
