import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signup } from './helpers.mjs';
import { parseIcal } from '../modules/hotel/audit.js';
import { addDays } from '../core/validate.js';

const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('ical parsing', () => {
  const ev = parseIcal('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc@booking.com\r\nDTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261208\r\nSUMMARY:CLOSED - Not available\r\nEND:VEVENT\r\nEND:VCALENDAR');
  assert.deepEqual(ev, [{ uid: 'abc@booking.com', start: '2026-12-05', end: '2026-12-08', summary: 'CLOSED - Not available' }]);
});

test('full hotel cycle: booking, check-in, key card, folio, outlets, audit, check-out, accounting', async (t) => {
  const { app, api, close } = await startApp({ MODULES: 'hotel' });
  t.after(close);
  const me = await signup(api);
  assert.equal(me.main, 'hotel');
  assert.ok(me.roles.receptionist && me.roles.housekeeper);
  let meta = ok(await api.get('/api/hotel/meta'));
  const bd = meta.settings.business_date;
  ok(await api.put('/api/hotel/settings', { manager_pin: '2580', tourist_tax: 1000, breakfast_price: 8000, deposit_pct: 30, eur_rate: 655.957 }));

  const deluxe = ok(await api.post('/api/hotel/room-types', { code: 'DLX', name: 'Deluxe', capacity: 2, base_rate: 95000, weekend_rate: 95000, day_use_rate: 45000 }), 201);
  const suite = ok(await api.post('/api/hotel/room-types', { code: 'STE', name: 'Suite Junior', capacity: 3, base_rate: 180000 }), 201);
  ok(await api.post('/api/hotel/rooms', { type_id: deluxe.id, from: 101, to: 103 }), 201);
  ok(await api.post('/api/hotel/rooms', { type_id: suite.id, number: '501' }), 201);
  meta = ok(await api.get('/api/hotel/meta'));
  assert.equal(meta.rooms.length, 4);
  const bb = meta.plans.find((p) => p.code === 'BB');
  const bar = meta.outlets.find((o) => o.kind === 'bar');
  const rs = meta.outlets.find((o) => o.kind === 'room_service');
  const spa = meta.outlets.find((o) => o.kind === 'spa');
  const beer = ok(await api.post('/api/hotel/items', { outlet_id: bar.id, name: 'Bière 65 cl', price: 2500, category: 'Bières' }), 201);
  const club = ok(await api.post('/api/hotel/items', { outlet_id: rs.id, name: 'Club sandwich', price: 9000 }), 201);
  const massage = ok(await api.post('/api/hotel/items', { outlet_id: spa.id, name: 'Massage 60 min', price: 35000, duration: 60 }), 201);

  // Availability and quote: 2 nights, B&B, 2 adults
  const dep = addDays(bd, 2);
  const av = ok(await api.get(`/api/hotel/availability?arrival=${bd}&departure=${dep}`));
  assert.equal(av.find((a) => a.type_id === deluxe.id).free, 3);
  const q = ok(await api.get(`/api/hotel/quote?room_type_id=${deluxe.id}&rate_plan_id=${bb.id}&arrival=${bd}&departure=${dep}&adults=2`));
  assert.equal(q.total, 2 * 95000 + 2 * 2 * 8000 + 2 * 1000);

  // Company account (city ledger) and group booking that fills the type
  const corp = ok(await api.post('/api/partners', { kind: 'client', name: 'MTN Cameroon SA' }), 201);
  const grp = ok(await api.post('/api/hotel/bookings', { name: 'Séminaire MTN', phone: '677000001', room_type_id: deluxe.id, arrival: addDays(bd, 10), departure: addDays(bd, 12), rooms: 3, group_name: 'Séminaire MTN', bill_to_id: corp.id }), 201);
  assert.equal(grp.ids.length, 3);
  const full = await api.post('/api/hotel/bookings', { name: 'Paul', phone: '677000002', room_type_id: deluxe.id, arrival: addDays(bd, 11), departure: addDays(bd, 13) });
  assert.equal(full.status, 409);

  // Booking → deposit → check-in (ID required) → key card
  const res = ok(await api.post('/api/hotel/bookings', { name: 'Aïcha Mbarga', phone: '699112233', email: 'aicha@test.cm', vip: 1, room_type_id: deluxe.id, rate_plan_id: bb.id, arrival: bd, departure: dep, adults: 2, source: 'whatsapp' }), 201);
  const id = res.ids[0];
  ok(await api.post(`/api/hotel/bookings/${id}/payments`, { method: 'mtn_momo', amount: 50000, reference: 'MP123' }), 201);
  const noId = await api.post(`/api/hotel/bookings/${id}/check-in`, {});
  assert.equal(noId.status, 400);
  let f = ok(await api.post(`/api/hotel/bookings/${id}/check-in`, { guest: { id_type: 'CNI', id_number: '112233445', nationality: 'Camerounaise', birth_date: '1990-04-12', profession: 'Ingénieure' } }));
  assert.equal(f.booking.status, 'in_house');
  assert.ok(f.booking.room_number);
  const keys = ok(await api.post(`/api/hotel/bookings/${id}/keys`, { copies: 2, access: ['pool', 'gym'] }), 201);
  assert.equal(keys.length, 2);
  const look = ok(await api.get(`/api/hotel/keys/lookup?uid=${keys[0].card_uid}`));
  assert.equal(look.booking_id, id);

  // Bar: tap the key card to charge the room; counter sale paid in cash
  const o1 = ok(await api.post('/api/hotel/orders', { outlet_id: bar.id, card_uid: keys[1].card_uid, lines: [{ product_id: beer.id, qty: 2 }], settle: 'room' }), 201);
  assert.equal(o1.settlement, 'room');
  const o2 = ok(await api.post('/api/hotel/orders', { outlet_id: bar.id, table_label: 'T4', lines: [{ product_id: beer.id, qty: 3 }], settle: 'paid', method: 'cash' }), 201);
  assert.equal(o2.settlement, 'paid');
  assert.equal(o2.total, 7500);
  assert.ok(o2.document_id);
  // Room service via the kitchen screen: charged when delivered, once
  const o3 = ok(await api.post('/api/hotel/orders', { outlet_id: rs.id, booking_id: id, lines: [{ product_id: club.id, qty: 1 }] }), 201);
  assert.equal(o3.status, 'new');
  ok(await api.put(`/api/hotel/orders/${o3.id}/status`, { status: 'preparing' }));
  const o3b = ok(await api.put(`/api/hotel/orders/${o3.id}/status`, { status: 'delivered' }));
  assert.equal(o3b.status, 'settled');
  // Spa appointment done → charged to the room
  const ap = ok(await api.post('/api/hotel/appointments', { product_id: massage.id, booking_id: id, staff: 'Carine', start_at: `${bd}T16:00` }), 201);
  const clash = await api.post('/api/hotel/appointments', { product_id: massage.id, guest_name: 'X', staff: 'Carine', start_at: `${bd}T16:30` });
  assert.equal(clash.status, 409);
  ok(await api.put(`/api/hotel/appointments/${ap.id}`, { status: 'done' }));

  // Guest app: room QR / link, order and request
  f = ok(await api.get(`/api/hotel/bookings/${id}`));
  const token = f.portal_url.split('/g/')[1];
  const portal = ok(await api.get(`/api/portal/${token}`));
  assert.equal(portal.stay.status, 'in_house');
  assert.ok(portal.menu.some((m) => m.id === club.id));
  ok(await api.post(`/api/portal/${token}/order`, { lines: [{ product_id: club.id, qty: 1 }] }), 201);
  ok(await api.post(`/api/portal/${token}/request`, { kind: 'towels', detail: '2 serviettes' }), 201);
  ok(await api.post(`/api/portal/${token}/feedback`, { rating: 5, comment: 'Parfait' }), 201);

  // Housekeeper sees an occupied room with nobody registered → alert
  const board = ok(await api.get('/api/hotel/rooms/board'));
  const empty = board.rooms.find((r) => !r.stay);
  ok(await api.put(`/api/hotel/rooms/${empty.id}/status`, { seen: 'occupied' }));
  const alerts = ok(await api.get('/api/alerts'));
  assert.ok(alerts.items.some((a) => a.kind === 'undeclared'));

  // Night audit: night 1 posted, business date moves on
  const audit1 = ok(await api.post('/api/hotel/night-audit', {}));
  assert.equal(audit1.date, bd);
  assert.equal(audit1.posted, 1);
  assert.deepEqual(audit1.undeclared.map((u) => u.number), [empty.number]);
  app.db.run('UPDATE hotel_settings SET business_date = ?', dep); // two days later
  f = ok(await api.get(`/api/hotel/bookings/${id}`));
  assert.deepEqual(f.pending_nights, [addDays(bd, 1)]);

  // Void a line needs the manager code (owner doesn't) and a reason
  const beerLine = f.lines.find((l) => l.description.includes('Bière'));
  assert.equal((await api.post(`/api/hotel/bookings/${id}/lines/${beerLine.id}/void`, {})).status, 400);

  // Check-out refuses an unpaid balance, then pays (part in euros) and closes
  const co = await api.post(`/api/hotel/bookings/${id}/check-out`, {});
  assert.equal(co.status, 409);
  f = ok(await api.get(`/api/hotel/bookings/${id}`));
  ok(await api.post(`/api/hotel/bookings/${id}/payments`, { method: 'cash', currency: 'EUR', foreign_amount: 100 }), 201);
  // remaining nights not yet posted: compute through check-out
  const done = await api.post(`/api/hotel/bookings/${id}/check-out`, {});
  assert.equal(done.status, 409); // still due after night 2 is posted
  f = ok(await api.get(`/api/hotel/bookings/${id}`));
  assert.equal(f.pending_nights.length, 0);
  ok(await api.post(`/api/hotel/bookings/${id}/payments`, { method: 'card', amount: f.booking.balance }), 201);
  const out = ok(await api.post(`/api/hotel/bookings/${id}/check-out`, {}));
  assert.equal(out.booking.status, 'checked_out');
  assert.equal(out.booking.balance, 0);
  assert.ok(out.invoice_number.startsWith('FAC-'));
  const inv = ok(await api.get(`/api/documents/${out.booking.invoice_id}`));
  assert.equal(inv.status, 'paid');
  assert.equal(inv.total, out.booking.charges);
  assert.ok(out.keys.every((k) => k.status !== 'active'));
  // 2 nights × (95 000 + 2 × 8 000 + 1 000) + 2 beers + club + massage (the app order is not delivered yet: not charged)
  assert.equal(out.booking.charges, 2 * (95000 + 16000 + 1000) + 5000 + 9000 + 35000);
  const g = ok(await api.get(`/api/hotel/guests/${out.booking.guest_id}`));
  assert.ok(g.points > 0);

  // Group billed to the company: check-in one room, check-out on the city ledger
  app.db.run('UPDATE hotel_settings SET business_date = ?', addDays(bd, 10));
  const gid = grp.ids[0];
  ok(await api.post(`/api/hotel/bookings/${gid}/check-in`, { guest: { id_number: 'P0012345' }, force_dirty: true }));
  app.db.run('UPDATE hotel_settings SET business_date = ?', addDays(bd, 12));
  const corpOut = ok(await api.post(`/api/hotel/bookings/${gid}/check-out`, {}));
  assert.equal(corpOut.invoice.status, 'open');
  assert.equal(corpOut.invoice.total, 2 * (95000 + 1000));

  // Accounting: the books balance, room revenue in 7061, taxe de séjour in 4428
  const bal = app.db.get('SELECT SUM(debit) d, SUM(credit) c FROM journal_lines');
  assert.ok(bal.d > 0);
  assert.equal(bal.d, bal.c);
  const clients = app.db.get("SELECT SUM(debit) - SUM(credit) v FROM journal_lines WHERE account_code = '411'").v;
  assert.equal(clients, corpOut.invoice.total); // only the company invoice is still owed
  const ledger = app.db.all("SELECT account_code, SUM(credit) - SUM(debit) v FROM journal_lines WHERE account_code IN ('7061','4428','7062','7063') GROUP BY account_code");
  const v = Object.fromEntries(ledger.map((x) => [x.account_code, x.v]));
  assert.ok(v['7061'] > 0 && v['4428'] === 4000 && v['7062'] > 0 && v['7063'] > 0);

  // Reports and prints
  const occ = ok(await api.get(`/api/hotel/reports/occupancy?from=${bd}&to=${addDays(bd, 12)}`));
  assert.equal(occ.days.length, 1);
  const pol = ok(await api.get(`/api/hotel/reports/police?from=${bd}&to=${addDays(bd, 12)}`));
  assert.equal(pol.rows.length, 2);
  const cash = ok(await api.get(`/api/hotel/reports/cashier?from=${bd}&to=${addDays(bd, 30)}`));
  assert.ok(cash.rows[0].eur === 100);
  const dash = ok(await api.get('/api/hotel/dashboard'));
  assert.ok(dash.kpi.rooms === 4);
  for (const p of [`/print/hotel/registration/${id}`, `/print/hotel/folio/${id}`, `/print/hotel/confirmation/${id}`, `/print/hotel/police?from=${bd}&to=${dep}`, '/print/hotel/room-qr']) {
    const r = await api.get(p); assert.equal(r.status, 200, p); assert.match(r.data, /<html/);
  }
});

test('online booking engine with Mobile Money deposit', async (t) => {
  const { api, close } = await startApp({ MODULES: 'hotel' });
  t.after(close);
  await signup(api);
  const ty = ok(await api.post('/api/hotel/room-types', { code: 'SUP', name: 'Supérieure', capacity: 2, base_rate: 60000 }), 201);
  ok(await api.post('/api/hotel/rooms', { type_id: ty.id, from: 201, to: 202 }), 201);
  const hotel = ok(await api.get('/api/public/hotel'));
  const a = addDays(hotel.business_date, 3), d = addDays(a, 2);
  const offers = ok(await api.get(`/api/public/availability?arrival=${a}&departure=${d}&adults=2`));
  const off = offers[0].offers.find((o) => !o.breakfast);
  assert.equal(off.total, 2 * 60000 + 2 * 1000);
  const b = ok(await api.post('/api/public/book', { type_id: ty.id, plan_id: off.plan_id, arrival: a, departure: d, adults: 2, name: 'John Smith', phone: '677123456', pay: true }), 201);
  assert.equal(b.deposit, Math.round(off.total * 0.3));
  assert.ok(b.payment?.id);
  await wait(5200);
  const st = ok(await api.get(`/api/portal/${b.token}/pay/${b.payment.id}`));
  assert.equal(st.status, 'successful');
  const p = ok(await api.get(`/api/portal/${b.token}`));
  assert.equal(p.stay.status, 'confirmed');
  assert.equal(p.stay.paid, b.deposit);
});
