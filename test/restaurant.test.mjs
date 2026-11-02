import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signup } from './helpers.mjs';
import { addDays } from '../core/validate.js';

const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(api) {
  const me = await signup(api);
  let meta = ok(await api.get('/api/resto/meta'));
  ok(await api.put('/api/resto/settings', { manager_pin: '2580', service_pct: 0, tip_suggestions: '5,10' }));
  const kitchen = meta.stations.find((s) => s.kind === 'kitchen'), bar = meta.stations.find((s) => s.kind === 'bar');
  const area = meta.areas[0];
  ok(await api.post('/api/resto/tables', { area_id: area.id, from: 1, to: 6, seats: 4 }), 201);
  const starters = ok(await api.post('/api/resto/categories', { name: 'Entrées', station_id: kitchen.id, course: 1 }), 201);
  const mains = ok(await api.post('/api/resto/categories', { name: 'Plats', station_id: kitchen.id, course: 2 }), 201);
  const drinks = ok(await api.post('/api/resto/categories', { name: 'Boissons', station_id: bar.id, course: 0, drinks: 1 }), 201);
  const fish = ok(await api.post('/api/resto/ingredients', { name: 'Bar (poisson)', unit: 'kg', cost: 4000, stock: 10, min_stock: 2 }), 201);
  const plantain = ok(await api.post('/api/resto/ingredients', { name: 'Plantain', unit: 'kg', cost: 500, stock: 20 }), 201);
  const beerIng = ok(await api.post('/api/resto/ingredients', { name: 'Bière 65 cl', unit: 'u', cost: 450, stock: 48, min_stock: 12 }), 201);
  const salad = ok(await api.post('/api/resto/items', { category_id: starters.id, name: 'Salade d\'avocat', price: 3500 }), 201);
  const braise = ok(await api.post('/api/resto/items', { category_id: mains.id, name: 'Poisson braisé', price: 9000, allergens: 'poisson', tags: 'signature',
    options: [{ group: 'Accompagnement', required: true, choices: [{ name: 'Plantain frit', price: 0 }, { name: 'Bâton de manioc', price: 0 }, { name: 'Frites', price: 500 }] }],
    recipe: [{ ingredient_id: fish.id, qty: 0.5 }, { ingredient_id: plantain.id, qty: 0.3 }] }), 201);
  const beer = ok(await api.post('/api/resto/items', { category_id: drinks.id, name: 'Bière 65 cl', price: 1500, recipe: [{ ingredient_id: beerIng.id, qty: 1 }] }), 201);
  assert.equal(braise.food_cost, 2150);
  meta = ok(await api.get('/api/resto/meta'));
  return { me, meta, kitchen, bar, salad, braise, beer, fish, plantain, beerIng, tables: meta.tables };
}

test('restaurant cycle: table, coursing, kitchen, split bill, tips, payments, accounting, stock, Z', async (t) => {
  const { app, api, close } = await startApp({ MODULES: 'restaurant' });
  t.after(close);
  const S = await setup(api);
  assert.equal(S.me.main, 'restaurant');
  assert.ok(S.me.roles.server && S.me.roles.cook && !S.me.roles.housekeeper);
  assert.equal(S.tables.length, 6);

  // Open table 1, 3 covers, order with coursing: starters + drinks go, mains are held
  const t1 = S.tables.find((x) => x.label === '1');
  let o = ok(await api.post('/api/resto/orders', { table_id: t1.id, covers: 3 }), 201);
  assert.equal((await api.post('/api/resto/orders', { table_id: t1.id })).status, 409);
  const missing = await api.post(`/api/resto/orders/${o.id}/lines`, { lines: [{ product_id: S.braise.id }] });
  assert.equal(missing.status, 400); // side dish is required
  o = ok(await api.post(`/api/resto/orders/${o.id}/lines`, { send: true, hold_courses: true, lines: [
    { product_id: S.salad.id, qty: 2 }, { product_id: S.braise.id, qty: 2, options: ['Frites'], note: 'bien cuit' }, { product_id: S.braise.id, options: ['Plantain frit'], seat: 3 },
    { product_id: S.beer.id, qty: 3 }] }), 201);
  const st = (name) => o.lines.filter((l) => l.name === name).map((l) => l.status);
  assert.deepEqual(st('Salade d\'avocat'), ['sent']);
  assert.deepEqual(st('Poisson braisé'), ['held', 'held']);
  assert.deepEqual(st('Bière 65 cl'), ['sent']);
  assert.equal(o.subtotal, 2 * 3500 + 2 * 9500 + 9000 + 3 * 1500);

  // Kitchen screen: starters at the kitchen, beers at the bar; held mains listed
  let k = ok(await api.get(`/api/resto/kitchen?station_id=${S.kitchen.id}`));
  assert.equal(k.tickets.length, 1);
  assert.equal(k.held.reduce((x, h) => x + h.qty, 0), 3);
  ok(await api.post('/api/resto/kitchen/bump', { line_ids: k.tickets[0].lines.map((l) => l.id), status: 'ready' }));
  const kb = ok(await api.get(`/api/resto/kitchen?station_id=${S.bar.id}`));
  ok(await api.post('/api/resto/kitchen/bump', { line_ids: kb.tickets[0].lines.map((l) => l.id), status: 'ready' }));
  let fl = ok(await api.get('/api/resto/floor'));
  assert.equal(fl.tables.find((x) => x.id === t1.id).state, 'ready');
  o = ok(await api.post(`/api/resto/orders/${o.id}/served`, {}));
  o = ok(await api.post(`/api/resto/orders/${o.id}/send`, { fire_course: 2 }));
  assert.ok(o.lines.filter((l) => l.name === 'Poisson braisé').every((l) => l.status === 'sent'));
  // Stock taken from recipes when sent: 3 × 0.5 kg fish, 3 beers
  let ing = ok(await api.get('/api/resto/ingredients'));
  assert.equal(ing.find((x) => x.id === S.fish.id).stock, 8.5);
  assert.equal(ing.find((x) => x.id === S.beerIng.id).stock, 45);

  // Void after sending needs the manager code for a waiter; comp a beer
  ok(await api.post('/api/users', { name: 'Paul Serveur', email: 'paul@test.cm', password: 'motdepasse1', role: 'server' }), 201);
  const owner = api.getCookie();
  ok(await api.post('/api/auth/login', { email: 'paul@test.cm', password: 'motdepasse1' }));
  const fishLine = o.lines.find((l) => l.name === 'Poisson braisé' && l.seat === 3);
  assert.equal((await api.post(`/api/resto/orders/${o.id}/lines/${fishLine.id}/void`, { reason: 'Client a changé d\'avis' })).status, 403); // not his table... or no code
  api.setCookie(owner);
  ok(await api.put(`/api/resto/orders/${o.id}`, { server_id: (await api.get('/api/users')).data.find((u) => u.email === 'paul@test.cm').id }));
  ok(await api.post('/api/auth/login', { email: 'paul@test.cm', password: 'motdepasse1' }));
  assert.equal((await api.post(`/api/resto/orders/${o.id}/lines/${fishLine.id}/void`, { reason: 'Client a changé d\'avis' })).status, 403);
  o = ok(await api.post(`/api/resto/orders/${o.id}/lines/${fishLine.id}/void`, { reason: 'Client a changé d\'avis', manager_pin: '2580' }));
  ing = ok(await api.get('/api/resto/ingredients'));
  assert.equal(ing.find((x) => x.id === S.fish.id).stock, 8.5 + 0.5); // not started: back in stock
  const beerLine = o.lines.find((l) => l.name === 'Bière 65 cl');
  o = ok(await api.put(`/api/resto/orders/${o.id}/lines/${beerLine.id}`, { discount_pct: 50, manager_pin: '2580', reason: 'Attente' }));
  const expected = 7000 + 19000 + Math.round(4500 * 0.5);
  assert.equal(o.total, expected);

  // Split: seat-less move of the salads to a second check for the same table
  const salads = o.lines.filter((l) => l.name === 'Salade d\'avocat').map((l) => l.id);
  const sp = ok(await api.post(`/api/resto/orders/${o.id}/transfer`, { line_ids: salads, guest_name: 'Marie' }));
  assert.equal(sp.to.total, 7000);
  assert.equal(sp.from.total, expected - 7000);

  // Cash needs an open session; pay check 2 in cash with tip and change
  assert.equal((await api.post(`/api/resto/orders/${sp.to.id}/pay`, { method: 'cash', tendered: 10000 })).status, 409);
  ok(await api.post('/api/resto/sessions', { opening_float: 20000 }), 201);
  let p = ok(await api.post(`/api/resto/orders/${sp.to.id}/pay`, { method: 'cash', tendered: 10000, tip: 500 }), 201);
  assert.equal(p.status, 'paid');
  assert.equal(p.change, 2500);

  // Check 1: half by card (with tip), the rest by MTN MoMo (simulation)
  const half = Math.round(sp.from.total / 2);
  p = ok(await api.post(`/api/resto/orders/${o.id}/pay`, { method: 'card', amount: half, tip: 1000, payer: 'Jean' }), 201);
  assert.equal(p.status, 'open');
  const req = ok(await api.post(`/api/resto/orders/${o.id}/momo`, { provider: 'mtn_momo', phone: '677123456', payer: 'Aline' }));
  let ms = ok(await api.get(`/api/resto/momo/${req.id}`));
  assert.equal(ms.status, 'pending');
  await wait(5200);
  ms = ok(await api.get(`/api/resto/momo/${req.id}`));
  assert.equal(ms.status, 'successful');
  p = ok(await api.get(`/api/resto/orders/${o.id}`));
  assert.equal(p.status, 'paid');
  assert.equal(p.tips, 1000);

  // Books: sales entries balanced, revenue on 7021/7011, tips on 4281
  const lines = app.db.all("SELECT account_code, SUM(debit) d, SUM(credit) c FROM journal_lines WHERE company_id = 1 GROUP BY account_code");
  const acc = Object.fromEntries(lines.map((x) => [x.account_code, x]));
  assert.equal(lines.reduce((t, x) => t + x.d - x.c, 0), 0);
  assert.equal(acc['4281'].c, 1500);
  assert.ok(acc['7021'].c > 0 && acc['7011'].c > 0 && acc['4431'].c > 0);
  const sales = (acc['7021'].c || 0) + (acc['7011'].c || 0) + (acc['4431'].c || 0);
  assert.equal(sales, expected);

  // Cash-up: expected = float + cash + cash tips
  ok(await api.post('/api/resto/cash-moves', { kind: 'out', amount: 2000, reason: 'Achat glace au marché' }), 201);
  const cur = ok(await api.get('/api/resto/sessions/current'));
  assert.equal(cur.cash.expected, 20000 + 7000 + 500 - 2000);
  const closed = ok(await api.post(`/api/resto/sessions/${cur.session.id}/close`, { counted_cash: 25000 }));
  assert.equal(closed.session.variance, -500);

  // Z report and dashboards
  api.setCookie(owner);
  const z = ok(await api.get('/api/resto/reports/z'));
  assert.equal(z.total.checks, 2);
  assert.equal(z.total.total, expected);
  assert.equal(z.voids.n, 1);
  const html = await api.get('/api/resto/reports/z?format=html');
  assert.match(html.data, /RAPPORT Z/);
  const d = ok(await api.get('/api/resto/dashboard'));
  assert.equal(d.sales.checks, 2);
  assert.ok(d.sales.food_cost_pct > 0);
  const me = ok(await api.get('/api/resto/reports/menu'));
  assert.ok(me.items.find((x) => x.name === 'Poisson braisé').class);
  const staff = ok(await api.get('/api/resto/reports/staff'));
  assert.equal(staff.servers[0].name, 'Paul Serveur');
  ok(await api.get('/api/resto/reports/forecast'));
  const plan = ok(await api.get('/api/resto/stock/plan'));
  assert.ok(Array.isArray(plan.lines));
  const bill = await api.get(`/api/resto/orders/${o.id}/receipt`);
  assert.match(bill.data, /REÇU/);
});

test('table QR: guest orders, waiter validates, guest pays by MoMo with tip, reviews; delivery and reservations', async (t) => {
  const { app, api, close } = await startApp({ MODULES: 'restaurant' });
  t.after(close);
  const S = await setup(api);
  const t2 = S.tables.find((x) => x.label === '2');
  const pub = (m, p, b) => fetch(new URL(p, `http://127.0.0.1:${app.server.address().port}`), { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

  let info = ok(await pub('GET', `/api/public/resto/table/${t2.qr_token}`));
  assert.equal(info.table.label, '2');
  assert.ok(info.menu.items.length >= 3);
  assert.equal(info.check, null);
  let chk = ok(await pub('POST', `/api/public/resto/table/${t2.qr_token}/order`, { covers: 2, lines: [{ product_id: S.braise.id, options: ['Bâton de manioc'] }, { product_id: S.beer.id, qty: 2 }] }));
  assert.equal(chk.lines.length, 2);
  assert.ok(chk.lines.every((l) => l.state === 'received'));
  let fl = ok(await api.get('/api/resto/floor'));
  assert.equal(fl.tables.find((x) => x.id === t2.id).state, 'qr');
  // Sold out dish cannot be ordered
  ok(await api.post(`/api/resto/items/${S.salad.id}/availability`, { available: false }));
  assert.equal((await pub('POST', `/api/public/resto/table/${t2.qr_token}/order`, { lines: [{ product_id: S.salad.id }] })).status, 409);
  // Waiter validates → kitchen
  const oid = fl.tables.find((x) => x.id === t2.id).orders[0].id;
  ok(await api.post(`/api/resto/orders/${oid}/send`, {}));
  chk = ok(await pub('GET', `/api/public/resto/check/${chk.token}`)).check;
  assert.ok(chk.lines.every((l) => l.state === 'kitchen'));
  ok(await pub('POST', `/api/public/resto/table/${t2.qr_token}/call`, { kind: 'bill' }));
  fl = ok(await api.get('/api/resto/floor'));
  assert.equal(fl.tables.find((x) => x.id === t2.id).state, 'bill');
  // Guest pays from the phone, 10 % tip
  const due = chk.due;
  const pr = ok(await pub('POST', `/api/public/resto/check/${chk.token}/pay`, { provider: 'orange_money', phone: '699112233', tip: 1200 }));
  assert.equal(pr.amount, due + 1200);
  await wait(5200);
  const ps = ok(await pub('GET', `/api/public/resto/check/${chk.token}/pay/${pr.id}`));
  assert.equal(ps.status, 'successful');
  assert.equal(ps.check.status, 'paid');
  assert.equal(ps.check.tips, 1200);
  ok(await pub('POST', `/api/public/resto/check/${chk.token}/feedback`, { rating: 5, food: 5, service: 4, comment: 'Excellent poisson' }));
  assert.equal((await pub('POST', `/api/public/resto/check/${chk.token}/feedback`, { rating: 4 })).status, 409);
  fl = ok(await api.get('/api/resto/floor'));
  assert.equal(fl.tables.find((x) => x.id === t2.id).state, 'free');
  assert.equal(fl.all_calls.length, 0);

  // Online delivery order, below minimum refused, then accepted and tracked
  ok(await api.put('/api/resto/settings', { min_delivery: 5000, delivery_fee: 1000 }));
  assert.equal((await pub('POST', '/api/public/resto/online-order', { kind: 'delivery', name: 'Rita', phone: '690000001', address: 'Bonapriso', lines: [{ product_id: S.beer.id }] })).status, 400);
  const on = ok(await pub('POST', '/api/public/resto/online-order', { kind: 'delivery', name: 'Rita', phone: '690000001', address: 'Bonapriso, rue Tokoto', lines: [{ product_id: S.braise.id, options: ['Frites'] }] }), 201);
  assert.equal(on.total, 9500 + 1000);
  let tr = ok(await pub('GET', `/api/public/resto/check/${on.token}`)).check;
  assert.equal(tr.delivery_status, 'preparing');
  const k = ok(await api.get(`/api/resto/kitchen?station_id=${S.kitchen.id}`));
  ok(await api.post('/api/resto/kitchen/bump', { line_ids: k.tickets.flatMap((x) => x.lines.map((l) => l.id)), status: 'ready' }));
  tr = ok(await pub('GET', `/api/public/resto/check/${on.token}`)).check;
  assert.equal(tr.delivery_status, 'ready');

  // Reservations: slot search, booking, double booking refused, seating opens a check
  const day = addDays(new Date().toISOString().slice(0, 10), 1);
  const slots = ok(await pub('GET', `/api/public/resto/slots?date=${day}&covers=4`));
  assert.ok(slots.slots.some((s) => s.free));
  const r1 = ok(await pub('POST', '/api/public/resto/reserve', { date: day, time: '20:00', covers: 4, name: 'Famille Ekane', phone: '677998877', occasion: 'Anniversaire' }), 201);
  assert.ok(r1.number);
  const list = ok(await api.get(`/api/resto/reservations?date=${day}`));
  assert.equal(list.length, 1);
  assert.ok(list[0].table_id);
  const taken = await api.post('/api/resto/reservations', { date: day, time: '20:30', covers: 2, name: 'X', table_id: list[0].table_id });
  assert.equal(taken.status, 409);
  const w = ok(await api.post('/api/resto/reservations', { waitlist: true, name: 'Walk-in Tchoupo', covers: 2, phone: '670000002' }), 201);
  assert.equal(w.status, 'waiting');
  const seated = ok(await api.put(`/api/resto/reservations/${w.id}`, { status: 'seated', table_id: S.tables.find((x) => x.label === '5').id }));
  assert.equal(seated.status, 'seated');
  assert.ok(seated.order_id);

  // Loyalty: the QR guest is not known, the reservation customer is
  const cust = ok(await api.get('/api/resto/customers'));
  assert.ok(cust.find((c) => c.name === 'Famille Ekane'));
});

test('company account check becomes a Compta invoice; merge and void', async (t) => {
  const { app, api, close } = await startApp({ MODULES: 'restaurant' });
  t.after(close);
  const S = await setup(api);
  const corp = ok(await api.post('/api/partners', { kind: 'client', name: 'Orange Cameroun SA' }), 201);
  const a = ok(await api.post('/api/resto/orders', { table_id: S.tables[2].id, covers: 2, lines: [{ product_id: S.braise.id, qty: 2, options: ['Plantain frit'] }], send: true }), 201);
  const b = ok(await api.post('/api/resto/orders', { table_id: S.tables[3].id, covers: 1, lines: [{ product_id: S.beer.id, qty: 2 }] }), 201);
  const m = ok(await api.post(`/api/resto/orders/${a.id}/merge`, { other_id: b.id }));
  assert.equal(m.total, 18000 + 3000);
  assert.equal(m.covers, 3);
  ok(await api.post('/api/resto/sessions', { opening_float: 0 }), 201);
  const p = ok(await api.post(`/api/resto/orders/${a.id}/pay`, { method: 'account', partner_id: corp.id }), 201);
  assert.equal(p.status, 'paid');
  assert.ok(p.document_id);
  const doc = ok(await api.get(`/api/documents/${p.document_id}`));
  assert.equal(doc.total, 21000);
  assert.equal(doc.status, 'open');
  // Void a check that was sent: manager reason required
  const c = ok(await api.post('/api/resto/orders', { kind: 'takeaway', guest_name: 'Test', lines: [{ product_id: S.salad.id }], send: true }), 201);
  assert.equal((await api.post(`/api/resto/orders/${c.id}/void`, {})).status, 400);
  const v = ok(await api.post(`/api/resto/orders/${c.id}/void`, { reason: 'Erreur de saisie' }));
  assert.equal(v.status, 'void');
});
