import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signup } from './helpers.mjs';
import { priceCart, solveNet, parseScaleCode, eanCheck, internalBarcode, isValidEan } from '../public/js/shop-pricing.js';
import { barcodeSvg } from '../public/js/barcode.js';

const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };

test('pricing rules', () => {
  assert.equal(eanCheck('400638133393'), '1');
  assert.ok(isValidEan('4006381333931'));
  assert.ok(isValidEan(internalBarcode(42)));
  for (const ttc of [1, 99, 500, 1193, 2500, 12345, 999999]) { const n = solveNet(ttc, 19.25); assert.ok(Math.abs(n + Math.round(n * 0.1925) - ttc) <= 1, `ttc ${ttc}`); }
  assert.equal(solveNet(1193, 19.25), 1000);
  const scale = '21' + '00012' + '01250'; const code = scale + eanCheck(scale);
  assert.deepEqual(parseScaleCode(code, { scale_prefix: '21', scale_mode: 'weight' }), { plu: '00012', qty: 1.25 });
  assert.equal(parseScaleCode('4006381333931', {}), null);
  const items = { 1: { product_id: 1, name: 'Savon', retail_price: 400, wholesale_price: 350, wholesale_min_qty: 12, vat_rate: null, category_id: 1 } };
  const promos = [{ id: 1, name: '3 pour 1000', kind: 'bundle', product_id: 1, value: 1000, qty: 3, active: 1 }];
  const c = priceCart({ lines: [{ product_id: 1, qty: 7 }], items, promos, date: '2026-11-01' });
  assert.equal(c.total, 2 * 1000 + 400); // two bundles + one at 400
  const w = priceCart({ lines: [{ product_id: 1, qty: 12 }], items, promos: [], date: '2026-11-01' });
  assert.equal(w.total, 12 * 350); // wholesale price from 12 units
  const d = priceCart({ lines: [{ product_id: 1, qty: 1 }], items, promos: [], date: '2026-11-01', points_used: 20, settings: { point_value: 5 } });
  assert.equal(d.total, 300);
  assert.equal(d.net_total + d.vat_total, d.total);
  assert.match(barcodeSvg('4006381333931'), /<svg/);
  assert.match(barcodeSvg('ABC-12'), /<rect/);
});

test('full shop cycle: stock, till, loyalty, prepaid, credit, returns, closing, accounting', async (t) => {
  const { api, close } = await startApp({ MODULES: 'shop' });
  t.after(close);
  const me = await signup(api);
  assert.equal(me.main, 'shop');
  assert.ok(me.modules.includes('accounting'));
  const meta = ok(await api.get('/api/shop/meta'));
  const store = meta.stores[0], register = meta.registers[0];
  assert.equal(store.name, 'Boutique principale');
  ok(await api.put('/api/shop/settings', { manager_pin: '4321', points_per_amount: 1000, point_value: 5, min_points_redeem: 10, topup_bonus_pct: 5, topup_bonus_min: 10000 }));

  const cat = ok(await api.post('/api/shop/categories', { name: 'Épicerie' }), 201);
  const sup = ok(await api.post('/api/partners', { kind: 'supplier', name: 'Grossiste Akwa' }), 201);
  const rice = ok(await api.post('/api/shop/items', { name: 'Riz 25 kg', barcode: '6151100000017', category_id: cat.id, retail_price: 18500, wholesale_price: 17500, supplier_id: sup.id, min_stock: 5, reorder_qty: 20 }), 201);
  const soap = ok(await api.post('/api/shop/items', { name: 'Savon de Marseille', generate_barcode: true, category_id: cat.id, retail_price: 400, vat_rate: 19.25 }), 201);
  const milk = ok(await api.post('/api/shop/items', { name: 'Lait en poudre 400 g', barcode: '6151100000024', retail_price: 2500, track_expiry: true }), 201);
  const meat = ok(await api.post('/api/shop/items', { name: 'Viande de bœuf', by_weight: true, plu: '12', retail_price: 4000, vat_rate: 0 }), 201);
  assert.ok(isValidEan(soap.barcode));
  assert.equal(meat.unit, 'kg');

  // Purchase order → receipt with expiry → supplier bill in Compta
  const sugg = ok(await api.get(`/api/shop/purchase-orders/suggest?store_id=${store.id}`));
  assert.ok(sugg.some((s) => s.product_id === rice.id));
  const po = ok(await api.post('/api/shop/purchase-orders', { supplier_id: sup.id, store_id: store.id, lines: [
    { product_id: rice.id, qty: 20, unit_cost: 14000 }, { product_id: soap.id, qty: 100, unit_cost: 250 }, { product_id: milk.id, qty: 30, unit_cost: 1800 }, { product_id: meat.id, qty: 15, unit_cost: 3000 }] }), 201);
  const noExp = await api.post(`/api/shop/purchase-orders/${po.id}/receive`, {});
  assert.equal(noExp.status, 400); // milk needs an expiry date
  const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const recv = ok(await api.post(`/api/shop/purchase-orders/${po.id}/receive`, { lines: po.lines.map((l) => ({ line_id: l.id, qty: l.qty, expiry: l.product_id === milk.id ? soon : undefined, lot: 'L1' })) }));
  assert.equal(recv.status, 'received');
  assert.ok(recv.bill_number?.startsWith('ACH-'));
  const stock = ok(await api.get(`/api/shop/stock?store_id=${store.id}`));
  assert.equal(stock.find((s) => s.product_id === rice.id).qty, 20);
  assert.equal(ok(await api.get(`/api/shop/expiring`)).length, 1);

  // Scanner lookups
  assert.equal(ok(await api.get('/api/shop/lookup?code=6151100000017')).item.id, rice.id);
  const sc = '21' + '00012' + '00750'; const scaleCode = sc + eanCheck(sc);
  const lk = ok(await api.get(`/api/shop/lookup?code=${scaleCode}`));
  assert.equal(lk.item.id, meat.id); assert.equal(lk.qty, 0.75);

  // Promotion: 3 soaps for 1 000
  ok(await api.post('/api/shop/promos', { name: '3 savons pour 1 000', kind: 'bundle', product_id: soap.id, qty: 3, value: 1000 }), 201);

  // Selling needs an open session
  assert.equal((await api.post('/api/shop/sales', { lines: [{ product_id: soap.id, qty: 1 }], payments: [{ method: 'cash', amount: 400 }] })).status, 409);
  const sess = ok(await api.post('/api/shop/sessions', { register_id: register.id, opening_float: 20000 }), 201);

  // Cash sale with change: 3 soaps (promo) + 0.75 kg meat (exempt)
  const s1 = ok(await api.post('/api/shop/sales', { session_id: sess.id, lines: [{ product_id: soap.id, qty: 3 }, { product_id: meat.id, qty: 0.75 }], payments: [{ method: 'cash', amount: 5000 }] }), 201);
  assert.equal(s1.total, 1000 + 3000);
  assert.equal(s1.change_given, 1000);
  assert.equal(s1.promo_total, 200);
  assert.equal(s1.net_total + s1.vat_total, s1.total);

  // Underpaid is refused
  assert.equal((await api.post('/api/shop/sales', { lines: [{ product_id: rice.id, qty: 1 }], payments: [{ method: 'cash', amount: 1000 }] })).status, 400);

  // Loyalty customer: wholesale price level, card, points
  const cust = ok(await api.post('/api/shop/customers', { name: 'Mama Ngono', phone: '677000111', price_level: 'wholesale', card_no: 'FID0001', credit_limit: 50000 }), 201);
  assert.equal(ok(await api.get('/api/shop/lookup?code=FID0001')).customer.partner_id, cust.partner_id);
  const s2 = ok(await api.post('/api/shop/sales', { customer_id: cust.partner_id, lines: [{ product_id: rice.id, qty: 2 }], payments: [{ method: 'mtn_momo', amount: 35000, reference: 'MP123' }] }), 201);
  assert.equal(s2.total, 35000); // wholesale price
  assert.equal(s2.points_earned, 35);

  // Price override needs the manager code (owner doesn't, so test with a cashier)
  ok(await api.post('/api/users', { name: 'Caissière', email: 'caisse@test.cm', password: 'caisse123', role: 'cashier' }), 201);

  // Prepaid account: top-up 20 000 → bonus 1 000, then pay with wallet + bonus
  const tp = ok(await api.post('/api/shop/topups', { customer_id: cust.partner_id, amount: 20000, method: 'cash' }), 201);
  assert.equal(tp.bonus_granted, 1000);
  let c = ok(await api.get(`/api/shop/customers/${cust.partner_id}`));
  assert.equal(c.wallet, 20000); assert.equal(c.bonus, 1000); assert.equal(c.points, 35);
  const s3 = ok(await api.post('/api/shop/sales', { customer_id: cust.partner_id, lines: [{ product_id: milk.id, qty: 4 }], bonus_used: 1000, points_used: 20,
    payments: [{ method: 'wallet', amount: 10000 - 1000 - 100 }] }), 201);
  assert.equal(s3.total, 8900);
  c = ok(await api.get(`/api/shop/customers/${cust.partner_id}`));
  assert.equal(c.wallet, 11100); assert.equal(c.bonus, 0); assert.equal(c.points, 35 - 20 + 8);

  // Credit sale: becomes an invoice in Compta; over the limit needs the manager code
  const s4 = ok(await api.post('/api/shop/sales', { customer_id: cust.partner_id, lines: [{ product_id: rice.id, qty: 2 }], payments: [{ method: 'cash', amount: 5000 }, { method: 'credit', amount: 30000 }] }), 201);
  assert.ok(s4.document?.number?.startsWith('FAC-'));
  assert.equal(s4.document.total - s4.document.paid, 30000);
  c = ok(await api.get(`/api/shop/customers/${cust.partner_id}`));
  assert.equal(c.debt, 30000);
  // repayment at the till
  const rep = ok(await api.post('/api/shop/repayments', { customer_id: cust.partner_id, amount: 10000, method: 'cash' }));
  assert.equal(rep.debt, 20000);

  // Cashier: credit beyond limit / price override refused without code
  ok(await api.post('/api/shop/registers', { store_id: store.id, name: 'Caisse 2' }), 201);
  const cookieOwner = api.getCookie();
  const login = await api.post('/api/auth/login', { email: 'caisse@test.cm', password: 'caisse123' });
  assert.equal(login.status, 200);
  const regs = ok(await api.get('/api/shop/meta')).registers;
  const sessC = ok(await api.post('/api/shop/sessions', { register_id: regs.find((x) => x.name === 'Caisse 2').id, opening_float: 0 }), 201);
  const over = await api.post('/api/shop/sales', { customer_id: cust.partner_id, lines: [{ product_id: rice.id, qty: 2 }], payments: [{ method: 'credit', amount: 35000 }] });
  assert.equal(over.status, 403);
  const withPin = await api.post('/api/shop/sales', { customer_id: cust.partner_id, lines: [{ product_id: soap.id, qty: 1, price_override: 300 }], payments: [{ method: 'cash', amount: 300 }], manager_pin: '4321' });
  assert.equal(withPin.status, 201, JSON.stringify(withPin.data));
  assert.equal((await api.post('/api/shop/sales', { lines: [{ product_id: soap.id, qty: 1, price_override: 100 }], payments: [{ method: 'cash', amount: 100 }], manager_pin: '0000' })).status, 403);
  // void by cashier needs the code
  assert.equal((await api.post(`/api/shop/sales/${withPin.data.id}/void`, { reason: 'erreur' })).status, 403);
  ok(await api.post(`/api/shop/sales/${withPin.data.id}/void`, { reason: 'erreur', manager_pin: '4321' }));
  const closeC = ok(await api.post(`/api/shop/sessions/${sessC.id}/close`, { counted_cash: 0 }));
  assert.equal(closeC.session.variance, 0);
  api.setCookie(cookieOwner);

  // Return of 1 rice from s2 → refund to the prepaid account
  const ret = ok(await api.post(`/api/shop/sales/${s2.id}/return`, { lines: [{ line_id: s2.lines[0].id, qty: 1 }], refund_method: 'wallet', reason: 'sac abîmé' }), 201);
  assert.equal(ret.total, -17500);
  c = ok(await api.get(`/api/shop/customers/${cust.partner_id}`));
  assert.equal(c.wallet, 11100 + 17500);

  // Cash out and close with a 500 shortage
  ok(await api.post('/api/shop/cash-moves', { kind: 'out', amount: 5000, reason: 'Dépôt au coffre' }));
  const x = ok(await api.get(`/api/shop/sessions/${sess.id}`));
  // float 20000 + s1 4000 + topup 20000 + s4 cash 5000 + repayment 10000 - out 5000
  assert.equal(x.cash.expected, 54000);
  const closed = ok(await api.post(`/api/shop/sessions/${sess.id}/close`, { counted_cash: 53500 }));
  assert.equal(closed.session.variance, -500);
  assert.ok(closed.session.entry_id);

  // Accounting: trial balance balanced, revenue and VAT posted, 419 holds the prepaid money
  const tb = ok(await api.get('/api/reports/trial-balance'));
  assert.ok(tb.balanced);
  const bal = (code) => { const r = tb.rows.find((a) => a.code === code); return r ? r.close_debit - r.close_credit : 0; };
  assert.equal(bal('5711'), 4000 + 20000 + 5000 + 10000 - 500); // cash sales, top-up, credit-sale cash part, repayment, shortage
  assert.equal(bal('419'), -(20000 - 8900 + 17500)); // prepaid money owed to customers = wallet balance
  assert.equal(bal('411'), 20000); // credit still owed
  assert.equal(bal('658'), 500); // cash shortage
  const entries = ok(await api.get('/api/entries?journal=CA'));
  assert.ok(JSON.stringify(entries).includes('Ventes caisse'));
  const alerts = ok(await api.get('/api/alerts'));
  assert.ok(alerts.items.some((a) => a.kind === 'pos_variance'));
  assert.ok(alerts.items.some((a) => a.kind === 'pos_void'));

  // Transfer to a new warehouse and an inventory count
  const wh = ok(await api.post('/api/shop/stores', { name: 'Entrepôt Bonabéri', kind: 'warehouse' }), 201);
  const tf = ok(await api.post('/api/shop/transfers', { from_store: store.id, to_store: wh.id, lines: [{ product_id: soap.id, qty: 10 }] }), 201);
  ok(await api.post(`/api/shop/transfers/${tf.id}/receive`, { lines: [{ line_id: tf.lines[0].id, qty: 9 }] }));
  const whStock = ok(await api.get(`/api/shop/stock?store_id=${wh.id}`));
  assert.equal(whStock.find((s) => s.product_id === soap.id).qty, 9);
  const cnt = ok(await api.post('/api/shop/counts', { store_id: wh.id }), 201);
  ok(await api.post(`/api/shop/counts/${cnt.id}/lines`, { barcode: soap.barcode }));
  ok(await api.post(`/api/shop/counts/${cnt.id}/lines`, { barcode: soap.barcode, qty: 6 }));
  const cl = ok(await api.post(`/api/shop/counts/${cnt.id}/close`, {}));
  assert.ok(cl.value < 0);
  assert.equal(ok(await api.get(`/api/shop/stock?store_id=${wh.id}`)).find((s) => s.product_id === soap.id).qty, 7);

  // Reports, exports and printed pages
  const dash = ok(await api.get('/api/shop/reports/dashboard'));
  assert.ok(dash.kpi.tickets >= 4);
  assert.ok(dash.best.length);
  const margin = ok(await api.get('/api/shop/reports/margin'));
  assert.ok(margin.totals.margin > 0);
  ok(await api.get('/api/shop/reports/cashiers'));
  const xl = await api.get('/api/shop/reports/margin?format=xlsx');
  assert.equal(xl.status, 200); assert.equal(xl.data.readUInt32LE(0), 0x04034b50);
  const rc = await api.get(`/print/shop/receipt/${s3.id}`);
  assert.match(rc.data, /TICKET DE CAISSE/);
  const pub = await api.get(`/r/${s3.token}`);
  assert.match(pub.data, /Lait en poudre/);
  const lb = await api.get(`/print/shop/labels?ids=${soap.id},${rice.id}`);
  assert.match(lb.data, /<svg/);
  const z = await api.get(`/print/shop/session/${sess.id}`);
  assert.match(z.data, /RAPPORT Z/);
  const man = await api.get('/manifest.webmanifest');
  assert.match(typeof man.data === 'string' ? man.data : JSON.stringify(man.data), /Teknons POS/);
});

test('MoMo push at the till (simulation)', async (t) => {
  const { api, close } = await startApp({ MODULES: 'shop' });
  t.after(close);
  await signup(api);
  const meta = ok(await api.get('/api/shop/meta'));
  const it = ok(await api.post('/api/shop/items', { name: 'Huile 1 L', retail_price: 1500, barcode: '6151100000031' }), 201);
  ok(await api.post('/api/shop/sessions', { register_id: meta.registers[0].id }), 201);
  const m = ok(await api.post('/api/shop/momo', { provider: 'mtn_momo', phone: '677123456', amount: 1500 }));
  const early = await api.post('/api/shop/sales', { lines: [{ product_id: it.id, qty: 1 }], payments: [{ method: 'mtn_momo', amount: 1500, momo_id: m.id }] });
  assert.equal(early.status, 409); // not confirmed yet
  await new Promise((r) => setTimeout(r, 5200));
  assert.equal(ok(await api.get(`/api/shop/momo/${m.id}`)).status, 'successful');
  const s = ok(await api.post('/api/shop/sales', { lines: [{ product_id: it.id, qty: 1 }], payments: [{ method: 'mtn_momo', amount: 1500, momo_id: m.id }] }), 201);
  assert.match(s.payments[0].reference, /^SIM/);
  assert.equal((await api.post('/api/shop/sales', { lines: [{ product_id: it.id, qty: 1 }], payments: [{ method: 'mtn_momo', amount: 1500, momo_id: m.id }] })).status, 409);
});
