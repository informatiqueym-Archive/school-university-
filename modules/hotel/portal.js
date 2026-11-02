// Public side of the hotel (no staff login):
//  • /book            direct booking engine: availability, price, deposit by MTN MoMo / Orange Money
//  • /g/<token>       guest app, opened from the QR code in the room or the WhatsApp link:
//                     stay and bill, room service and bar menu, spa booking, requests,
//                     late check-out, pay the bill by Mobile Money, Wi-Fi, feedback.
//  • /ical/...        availability feed for Booking.com, Airbnb, Expedia
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, oneOf, date as vDate, addDays } from '../../core/validate.js';
import { now } from '../../core/schema.js';
import { raiseAlert } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { PROVIDERS, guessProvider, normalizePhone } from '../../core/payments/mobile-money.js';
import { settingsOf, quoteStay, availability, nightsBetween } from './rates.js';
import * as F from './front.js';
import * as SV from './services.js';
import { exportIcal, parseIcal } from './audit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '../../public');
const page = (file) => fs.readFileSync(path.join(pub, file), 'utf8');

// Rate limit for public writes: 30 per minute per IP.
const hits = new Map();
function limit(ctx) {
  const ip = ctx.req?.socket?.remoteAddress || 'x';
  const h = hits.get(ip);
  const t = Date.now();
  if (!h || t - h.at > 60e3) { hits.set(ip, { at: t, n: 1 }); return; }
  if (++h.n > 30) throw forbidden('Trop de demandes, réessayez dans une minute');
}

const botCtx = (companyId, name = 'Client (application)') => ({ user: { id: null, company_id: companyId, name, role: 'owner' } });

function hotelCompany(db, h) {
  const row = h ? db.get('SELECT c.* FROM companies c JOIN hotel_settings s ON s.company_id = c.id WHERE c.id = ?', h) : db.get('SELECT c.* FROM companies c JOIN hotel_settings s ON s.company_id = c.id ORDER BY c.id LIMIT 1');
  if (!row) throw notFound('Hôtel introuvable');
  return row;
}

function stayByToken(db, token) {
  const t = str(token, 60);
  if (t.length < 16) throw notFound('Lien invalide');
  let b = db.get('SELECT * FROM hotel_bookings WHERE portal_token = ?', t);
  if (!b) {
    const room = db.get('SELECT * FROM hotel_rooms WHERE portal_token = ?', t);
    if (!room) throw notFound('Lien invalide ou expiré');
    b = db.get("SELECT * FROM hotel_bookings WHERE room_id = ? AND status = 'in_house' ORDER BY id DESC LIMIT 1", room.id);
    if (!b) return { company: db.get('SELECT * FROM companies WHERE id = ?', room.company_id), room, booking: null };
  }
  if (['cancelled', 'no_show'].includes(b.status)) throw notFound('Cette réservation est annulée');
  if (b.status === 'checked_out' && b.checked_out_at && Date.now() - Date.parse(b.checked_out_at) > 30 * 864e5) throw notFound('Lien expiré');
  return { company: db.get('SELECT * FROM companies WHERE id = ?', b.company_id), booking: b, room: b.room_id ? db.get('SELECT * FROM hotel_rooms WHERE id = ?', b.room_id) : null };
}
const mustBeIn = (st) => { if (!st.booking || st.booking.status !== 'in_house') throw conflict('state', 'Disponible pendant votre séjour uniquement'); };

export function registerPortal(r, { db, bus, momo }) {
  r.get('/book', (ctx) => ctx.send(page('book.html')));
  r.get('/g/:token', (ctx) => ctx.send(page('guest.html')));

  // ---------------- Booking engine ----------------
  r.get('/api/public/hotel', (ctx) => {
    const c = hotelCompany(db, ctx.query.h);
    const s = settingsOf(db, c.id);
    if (!s.online_booking) throw forbidden('Réservation en ligne fermée');
    return {
      id: c.id, name: c.name, city: c.city, address: c.address, phone: c.phone, email: c.email, stars: s.stars, checkin_time: s.checkin_time, checkout_time: s.checkout_time,
      business_date: s.business_date, deposit_pct: s.deposit_pct, welcome: s.welcome_text, tourist_tax: s.tourist_tax, tourist_tax_mode: s.tourist_tax_mode,
      types: db.all('SELECT id, name, description, amenities, capacity, base_rate, image FROM hotel_room_types WHERE company_id = ? AND active = 1 AND online = 1 ORDER BY position, base_rate', c.id),
      plans: db.all('SELECT id, code, name, breakfast, refundable, min_nights, adjust_pct FROM hotel_rate_plans WHERE company_id = ? AND active = 1 AND online = 1 AND partner_id IS NULL', c.id),
      momo: Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, momo.configured(p)])),
    };
  });
  r.get('/api/public/availability', (ctx) => {
    const c = hotelCompany(db, ctx.query.h);
    const s = settingsOf(db, c.id);
    const arrival = vDate(ctx.query.arrival, 'arrival'), departure = vDate(ctx.query.departure, 'departure');
    if (arrival < s.business_date) throw bad('arrival', 'Date d\'arrivée passée');
    if (departure <= arrival || nightsBetween(arrival, departure).length > 60) throw bad('departure', 'Dates invalides (60 nuits max)');
    const adults = int(ctx.query.adults, 'adults', { min: 1, def: 2 });
    const plans = db.all('SELECT * FROM hotel_rate_plans WHERE company_id = ? AND active = 1 AND online = 1 AND partner_id IS NULL', c.id);
    return availability(db, c.id, arrival, departure).filter((a) => a.type.online && a.type.capacity + 1 >= adults).map((a) => ({
      type_id: a.type.id, name: a.type.name, free: Math.max(0, a.free),
      offers: plans.filter((p) => nightsBetween(arrival, departure).length >= p.min_nights).map((p) => ({ plan_id: p.id, plan: p.name, breakfast: !!p.breakfast, refundable: !!p.refundable, ...quoteStay(db, c, s, { type: a.type, plan: p, arrival, departure, adults }) })),
    }));
  });
  r.post('/api/public/book', async (ctx) => {
    limit(ctx);
    const b = ctx.body;
    const c = hotelCompany(db, b.h);
    const s = settingsOf(db, c.id);
    if (!s.online_booking) throw forbidden('Réservation en ligne fermée');
    const type = db.get('SELECT * FROM hotel_room_types WHERE id = ? AND company_id = ? AND online = 1 AND active = 1', b.type_id, c.id);
    const plan = db.get('SELECT * FROM hotel_rate_plans WHERE id = ? AND company_id = ? AND online = 1 AND active = 1 AND partner_id IS NULL', b.plan_id, c.id);
    if (!type || !plan) throw bad('offer', 'Offre indisponible');
    const name = str(b.name, 120), phone = str(b.phone, 30);
    if (name.length < 3 || phone.replace(/\D/g, '').length < 8) throw bad('contact', 'Indiquez votre nom et votre numéro de téléphone');
    const ctxBot = botCtx(c.id, 'Réservation en ligne');
    const { ids } = F.createBooking(db, bus, ctxBot, c, { name, phone, email: str(b.email, 120), nationality: str(b.nationality, 60), room_type_id: type.id, rate_plan_id: plan.id,
      arrival: b.arrival, departure: b.departure, adults: b.adults, children: b.children, source: 'web', status: 'tentative', eta: str(b.eta, 5), special_requests: str(b.requests, 800) });
    const bk = F.getBooking(db, c.id, ids[0]);
    const q = quoteStay(db, c, s, { type, plan, arrival: bk.arrival, departure: bk.departure, adults: bk.adults });
    raiseAlert(db, bus, c.id, { kind: 'web_booking', level: 'info', title: `Nouvelle réservation en ligne : ${name}`, body: `${type.name}, ${q.nights} nuit(s) dès le ${bk.arrival} · ${fcfa(q.total)}`, entity: 'booking', entity_id: bk.id });
    let payment = null;
    if (b.pay && q.deposit > 0) {
      const provider = b.provider || guessProvider(normalizePhone(b.pay_phone || phone));
      if (provider && momo.configured(provider)) payment = await F.momoRequest(db, momo, ctxBot, c, bk.id, { provider, phone: b.pay_phone || phone, amount: q.deposit }, { online: true });
    }
    return ctx.json({ token: bk.portal_token, number: bk.number, total: q.total, deposit: q.deposit, payment }, 201);
  });

  // ---------------- Guest app ----------------
  r.get('/api/portal/:token', (ctx) => {
    const st = stayByToken(db, ctx.params.token);
    const s = settingsOf(db, st.company.id);
    const c = st.company;
    const base = { hotel: { name: c.name, phone: c.phone, address: c.address, city: c.city, stars: s.stars, welcome: s.welcome_text, checkout_time: s.checkout_time, checkin_time: s.checkin_time, momo: Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, momo.configured(p)])) } };
    if (!st.booking) return { ...base, room: st.room?.number, stay: null };
    const f = F.folio(db, c.id, st.booking.id);
    const inHouse = st.booking.status === 'in_house';
    return {
      ...base, room: f.booking.room_number,
      wifi: inHouse ? { name: s.wifi_name, password: s.wifi_password } : null,
      stay: { number: f.booking.number, status: f.booking.status, guest: f.booking.guest_name, arrival: f.booking.arrival, departure: f.booking.departure, type: f.booking.type_name, plan: f.booking.plan_name,
        adults: f.booking.adults, late_checkout: f.booking.late_checkout, charges: f.booking.charges, paid: f.booking.paid, balance: f.booking.balance, dnd: st.room?.dnd || 0 },
      lines: f.lines.filter((l) => !l.voided).map((l) => ({ date: l.date, description: l.description, amount: l.amount })),
      menu: inHouse ? SV.listItems(db, c.id, { portal: 1 }).map((i) => ({ id: i.id, name: i.name, description: i.description, price: i.price, category: i.category, outlet: i.outlet_name, outlet_kind: i.outlet_kind, outlet_id: i.outlet_id, duration: i.duration })) : [],
      orders: db.all("SELECT o.number, o.status, o.total, o.created_at, h.name outlet FROM hotel_orders o JOIN hotel_outlets h ON h.id = o.outlet_id WHERE o.booking_id = ? ORDER BY o.id DESC LIMIT 20", st.booking.id),
      requests: db.all('SELECT kind, detail, status, created_at FROM hotel_requests WHERE booking_id = ? ORDER BY id DESC LIMIT 20', st.booking.id),
      spa: db.all("SELECT a.start_at, a.status, p.name FROM hotel_appointments a JOIN products p ON p.id = a.product_id WHERE a.booking_id = ? ORDER BY a.start_at", st.booking.id),
      request_kinds: SV.REQUEST_KINDS, late_checkout_fee: s.late_checkout_fee,
      feedback: !!db.get('SELECT 1 FROM hotel_feedback WHERE booking_id = ?', st.booking.id),
    };
  });
  r.post('/api/portal/:token/order', (ctx) => {
    limit(ctx);
    const st = stayByToken(db, ctx.params.token); mustBeIn(st);
    const lines = (ctx.body.lines || []).slice(0, 30);
    const outlets = [...new Set(lines.map((l) => db.get('SELECT outlet_id FROM hotel_items WHERE product_id = ? AND company_id = ?', l.product_id, st.company.id)?.outlet_id))];
    if (!lines.length || outlets.includes(undefined)) throw bad('lines', 'Panier invalide');
    const out = outlets.map((o) => SV.createOrder(db, bus, botCtx(st.company.id), st.company, { outlet_id: o, booking_id: st.booking.id, lines: lines.filter((l) => db.get('SELECT outlet_id FROM hotel_items WHERE product_id = ?', l.product_id).outlet_id === o), note: str(ctx.body.note, 300) }, { origin: 'guest' }));
    return ctx.json(out.map((o) => ({ number: o.number, total: o.total, status: o.status })), 201);
  });
  r.post('/api/portal/:token/request', (ctx) => {
    limit(ctx);
    const st = stayByToken(db, ctx.params.token); mustBeIn(st);
    return ctx.json(SV.createRequest(db, bus, st.company.id, ctx.body, { bookingId: st.booking.id, roomId: st.booking.room_id }), 201);
  });
  r.post('/api/portal/:token/dnd', (ctx) => {
    const st = stayByToken(db, ctx.params.token); mustBeIn(st);
    db.run('UPDATE hotel_rooms SET dnd = ? WHERE id = ?', ctx.body.dnd ? 1 : 0, st.booking.room_id);
    bus.emit(st.company.id, 'change', { entity: 'room' });
    return { dnd: ctx.body.dnd ? 1 : 0 };
  });
  r.post('/api/portal/:token/spa', (ctx) => {
    limit(ctx);
    const st = stayByToken(db, ctx.params.token); mustBeIn(st);
    return ctx.json(SV.createAppointment(db, bus, botCtx(st.company.id), st.company, { product_id: ctx.body.product_id, start_at: ctx.body.start_at, booking_id: st.booking.id, note: ctx.body.note }, { origin: 'guest' }), 201);
  });
  r.post('/api/portal/:token/late-checkout', (ctx) => {
    const st = stayByToken(db, ctx.params.token); mustBeIn(st);
    const time = str(ctx.body.time, 5);
    if (!/^\d{2}:\d{2}$/.test(time)) throw bad('time', 'Heure invalide');
    return ctx.json(SV.createRequest(db, bus, st.company.id, { kind: 'late_checkout', detail: `Départ souhaité à ${time} le ${st.booking.departure}`, due_at: `${st.booking.departure}T${time}` }, { bookingId: st.booking.id, roomId: st.booking.room_id }), 201);
  });
  r.post('/api/portal/:token/feedback', (ctx) => {
    limit(ctx);
    const st = stayByToken(db, ctx.params.token);
    if (!st.booking || !['in_house', 'checked_out'].includes(st.booking.status)) throw conflict('state', 'Avis possible pendant ou après le séjour');
    const n = (k) => (ctx.body[k] == null || ctx.body[k] === '' ? null : Math.min(5, Math.max(1, int(ctx.body[k], k))));
    const rating = n('rating'); if (!rating) throw bad('rating', 'Donnez une note de 1 à 5');
    db.run('INSERT INTO hotel_feedback (company_id, booking_id, rating, cleanliness, service, food, comment, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(booking_id) DO UPDATE SET rating = excluded.rating, cleanliness = excluded.cleanliness, service = excluded.service, food = excluded.food, comment = excluded.comment',
      st.company.id, st.booking.id, rating, n('cleanliness'), n('service'), n('food'), str(ctx.body.comment, 2000), now());
    if (rating <= 2) raiseAlert(db, bus, st.company.id, { kind: 'bad_review', level: 'danger', title: `Client mécontent (${rating}/5) · ${db.get('SELECT name FROM partners WHERE id = ?', st.booking.guest_id).name}`, body: str(ctx.body.comment, 200), entity: 'booking', entity_id: st.booking.id });
    return ctx.json({ ok: true }, 201);
  });
  r.post('/api/portal/:token/pay', async (ctx) => {
    limit(ctx);
    const st = stayByToken(db, ctx.params.token);
    if (!st.booking || !['tentative', 'confirmed', 'in_house'].includes(st.booking.status)) throw conflict('state', 'Paiement impossible pour ce séjour');
    const bk = F.getBooking(db, st.company.id, st.booking.id);
    const s = settingsOf(db, st.company.id);
    let due = bk.balance;
    if (bk.status !== 'in_house') {
      const type = db.get('SELECT * FROM hotel_room_types WHERE id = ?', bk.room_type_id);
      const plan = bk.rate_plan_id ? db.get('SELECT * FROM hotel_rate_plans WHERE id = ?', bk.rate_plan_id) : null;
      const q = quoteStay(db, st.company, s, { type, plan, arrival: bk.arrival, departure: bk.departure, adults: bk.adults, kind: bk.kind, fixed: bk.rate });
      due = Math.max(0, (ctx.body.full ? q.total : q.deposit) - bk.paid);
    }
    if (due <= 0) throw conflict('nothing', 'Rien à payer pour le moment');
    const phone = ctx.body.phone;
    const provider = oneOf(ctx.body.provider || guessProvider(normalizePhone(phone)), Object.keys(PROVIDERS), 'provider');
    return ctx.json(await F.momoRequest(db, momo, botCtx(st.company.id), st.company, bk.id, { provider, phone, amount: due }, { online: true }), 201);
  });
  r.get('/api/portal/:token/pay/:id', async (ctx) => {
    const st = stayByToken(db, ctx.params.token);
    const m = db.get('SELECT * FROM hotel_momo WHERE id = ? AND booking_id = ?', ctx.params.id, st.booking?.id);
    if (!m) throw notFound();
    return F.momoStatus(db, bus, momo, botCtx(st.company.id, 'Paiement en ligne'), st.company, m.id);
  });

  // ---------------- iCal feeds ----------------
  r.get('/ical/hotel/:company/:type', (ctx) => {
    const typeId = String(ctx.params.type).replace(/\.ics$/, '');
    const t = db.get('SELECT * FROM hotel_room_types WHERE id = ? AND company_id = ?', typeId, ctx.params.company);
    if (!t || ctx.query.k !== icalKey(t)) throw notFound();
    ctx.send(exportIcal(db, t.company_id, t.id, availability), 'text/calendar; charset=utf-8');
  });
}

export const icalKey = (t) => Buffer.from(`${t.company_id}:${t.id}:${t.code}`).toString('base64url').slice(0, 16);

/** Pulls the iCal of a channel and creates/cancels the matching bookings. */
export async function syncIcal(db, bus, companyId, fetchImpl = globalThis.fetch, onlyId = null) {
  const feeds = db.all(`SELECT * FROM hotel_ical WHERE company_id = ? ${onlyId ? 'AND id = ' + Number(onlyId) : ''}`, companyId);
  const company = db.get('SELECT * FROM companies WHERE id = ?', companyId);
  const out = [];
  for (const f of feeds) {
    let created = 0, cancelled = 0, msg = '';
    try {
      const r = await fetchImpl(f.url, { headers: { Accept: 'text/calendar' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const events = parseIcal(await r.text());
      const source = ['booking', 'airbnb', 'expedia'].includes(f.channel) ? f.channel : 'other';
      const label = { booking: 'Booking.com', airbnb: 'Airbnb', expedia: 'Expedia' }[f.channel] || f.channel;
      const bd = settingsOf(db, companyId).business_date;
      for (const ev of events) {
        if (ev.end <= bd) continue;
        const ext = `${f.id}:${ev.uid}`.slice(0, 120);
        if (db.get('SELECT id FROM hotel_bookings WHERE company_id = ? AND source = ? AND external_ref = ?', companyId, source, ext)) continue;
        try {
          F.createBooking(db, bus, botCtx(companyId, `Synchro ${label}`), company, { name: (ev.summary && !/not available|closed|reserved|blocked/i.test(ev.summary) ? ev.summary : `Client ${label}`).slice(0, 120),
            room_type_id: f.room_type_id, arrival: ev.start < bd ? bd : ev.start, departure: ev.end, source, external_ref: ext, notes: `Importé de ${label} (iCal)`, overbook: false, import: true });
          created++;
        } catch (e) { msg += `${ev.start}: ${e.message}. `; }
      }
      const uids = new Set(events.map((e) => `${f.id}:${e.uid}`.slice(0, 120)));
      for (const b of db.all("SELECT id, external_ref FROM hotel_bookings WHERE company_id = ? AND source = ? AND external_ref LIKE ? AND status IN ('tentative','confirmed')", companyId, source, `${f.id}:%`)) {
        if (!uids.has(b.external_ref)) { db.run("UPDATE hotel_bookings SET status = 'cancelled', cancel_reason = ? WHERE id = ?", `Annulée sur ${label}`, b.id); cancelled++; }
      }
      if (created || cancelled) raiseAlert(db, bus, companyId, { kind: 'ical', level: 'info', title: `${label} : ${created} réservation(s) importée(s), ${cancelled} annulée(s)`, body: msg.slice(0, 300) });
      db.run('UPDATE hotel_ical SET last_sync = ?, last_result = ? WHERE id = ?', now(), `${created} créée(s), ${cancelled} annulée(s)${msg ? ' · ' + msg : ''}`.slice(0, 500), f.id);
    } catch (e) {
      db.run('UPDATE hotel_ical SET last_sync = ?, last_result = ? WHERE id = ?', now(), `Erreur : ${e.message}`.slice(0, 500), f.id);
      msg = e.message;
    }
    out.push({ id: f.id, created, cancelled, message: msg });
  }
  return out;
}
