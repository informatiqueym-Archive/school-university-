import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signup } from './helpers.mjs';
import { toFrenchWords, amountInWords } from '../core/format.js';
import { buildXlsx } from '../core/xlsx.js';

const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.data)); return r.data; };

test('French amounts in words', () => {
  assert.equal(toFrenchWords(0), 'zéro');
  assert.equal(toFrenchWords(71), 'soixante-et-onze');
  assert.equal(toFrenchWords(80), 'quatre-vingts');
  assert.equal(toFrenchWords(91), 'quatre-vingt-onze');
  assert.equal(toFrenchWords(200), 'deux-cents');
  assert.equal(toFrenchWords(1000), 'mille');
  assert.equal(toFrenchWords(80000), 'quatre-vingt-mille');
  assert.equal(toFrenchWords(1_192_500), 'un-million-cent-quatre-vingt-douze-mille-cinq-cents');
  assert.equal(amountInWords(2_000_000), 'Deux-millions francs CFA');
});

test('xlsx is a valid zip', () => {
  const b = buildXlsx([{ name: 'A', columns: [{ header: 'x', key: 'x', type: 'money' }], rows: [{ x: 1 }] }]);
  assert.equal(b.readUInt32LE(0), 0x04034b50);
  assert.equal(b.readUInt32LE(b.length - 22), 0x06054b50);
});

test('full accounting cycle', async (t) => {
  const { api, close, app } = await startApp();
  t.after(close);
  const me = await signup(api);
  assert.equal(me.user.role, 'owner');
  assert.equal(me.company.vat_rate, 19.25);

  // second signup is closed
  const s2 = await api.post('/api/auth/signup', { company: 'X', name: 'Y', email: 'y@y.cm', password: '12345678' });
  assert.equal(s2.status, 403);

  const client = ok(await api.post('/api/partners', { kind: 'client', name: 'Hôtel Akwa Palace', phone: '677123456' }), 201);
  const supplier = ok(await api.post('/api/partners', { kind: 'supplier', name: 'ENEO Cameroun' }), 201);
  const prod = ok(await api.post('/api/products', { name: 'Site vitrine', kind: 'service', price: 500000 }), 201);

  // Quote → invoice
  const quote = ok(await api.post('/api/documents', { kind: 'quote', partner_id: client.id, lines: [{ product_id: prod.id, qty: 2, discount: 10 }, { description: 'Hébergement 1 an', qty: 1, unit_price: 60000, kind: 'service' }] }), 201);
  assert.match(quote.number, /^DEV-\d{4}-0001$/);
  // 2*500000*0.9 = 900000 + 60000 = 960000 HT; TVA 19.25% = 173250 + 11550 = 184800; TTC 1144800
  assert.equal(quote.subtotal, 960000);
  assert.equal(quote.vat_total, 184800);
  assert.equal(quote.total, 1144800);
  ok(await api.post(`/api/documents/${quote.id}/status`, { status: 'accepted' }));
  const inv = ok(await api.post(`/api/documents/${quote.id}/convert`), 201);
  assert.equal(inv.status, 'draft');
  assert.equal(inv.number, null);
  const v = ok(await api.post(`/api/documents/${inv.id}/validate`));
  assert.match(v.number, /^FAC-\d{4}-0001$/);
  assert.equal(v.status, 'open');
  // validated invoices are locked
  assert.equal((await api.put(`/api/documents/${inv.id}`, { notes: 'x' })).status, 409);

  // Partial cash payment then overpay refused
  ok(await api.post('/api/payments', { direction: 'in', document_id: inv.id, amount: 144800, method: 'cash' }), 201);
  let d = ok(await api.get(`/api/documents/${inv.id}`));
  assert.equal(d.status, 'partial');
  assert.equal(d.balance, 1000000);
  assert.equal((await api.post('/api/payments', { direction: 'in', document_id: inv.id, amount: 2000000, method: 'cash' })).status, 400);

  // Mobile Money (simulation): pending, then completed by the poller
  const mm = ok(await api.post('/api/payments/momo-request', { document_id: inv.id, provider: 'mtn_momo', phone: '677123456', amount: 400000 }), 201);
  assert.equal(mm.status, 'pending');
  const { checkPending } = await import('../modules/accounting/treasury.js');
  app.db.run("UPDATE payments SET created_at = ? WHERE id = ?", new Date().toISOString(), mm.id);
  // pretend 6 s passed by re-requesting the simulator state
  const simRef = app.db.get('SELECT provider_ref FROM payments WHERE id = ?', mm.id).provider_ref;
  const origStatus = app.momo.checkStatus;
  app.momo.checkStatus = async () => ({ status: 'successful', transactionId: 'MP123' });
  await checkPending(app.db, app.bus, app.momo);
  app.momo.checkStatus = origStatus;
  assert.ok(simRef);
  d = ok(await api.get(`/api/documents/${inv.id}`));
  assert.equal(d.paid, 544800);
  const alerts = ok(await api.get('/api/alerts'));
  assert.ok(alerts.items.some((a) => a.kind === 'momo_received'));

  // Credit note for part of the rest
  const cn = ok(await api.post('/api/documents', { kind: 'credit_note', partner_id: client.id, ref_doc_id: inv.id, lines: [{ description: 'Geste commercial', qty: 1, unit_price: 100000, kind: 'service' }] }), 201);
  ok(await api.post(`/api/documents/${cn.id}/validate`));
  d = ok(await api.get(`/api/documents/${inv.id}`));
  assert.equal(d.credited, 119250);
  assert.equal(d.balance, 1144800 - 544800 - 119250);
  // Pay the rest by bank → paid
  ok(await api.post('/api/payments', { direction: 'in', document_id: inv.id, method: 'bank', reference: 'VIR 001' }), 201);
  d = ok(await api.get(`/api/documents/${inv.id}`));
  assert.equal(d.status, 'paid');

  // Supplier bill + payment by Orange Money, and an expense
  const bill = ok(await api.post('/api/documents', { kind: 'bill', partner_id: supplier.id, supplier_ref: 'ENEO-778', validate: true, lines: [{ description: 'Électricité octobre', qty: 1, unit_price: 80000, account_code: '6052' }] }), 201);
  assert.equal(bill.status, 'open');
  assert.equal(bill.total, 95400);
  ok(await api.post('/api/payments', { direction: 'out', document_id: bill.id, method: 'orange_money' }), 201);
  ok(await api.post('/api/expenses', { description: 'Carburant groupe électrogène', account_code: '6053', total: 25000, method: 'cash' }), 201);
  // Capital contribution (manual entry)
  ok(await api.post('/api/entries', { journal: 'OD', label: 'Apport en capital', lines: [{ account: '5211', debit: 1000000 }, { account: '101', credit: 1000000 }] }), 201);
  assert.equal((await api.post('/api/entries', { label: 'faux', lines: [{ account: '5211', debit: 10 }, { account: '101', credit: 9 }] })).status, 400);
  ok(await api.post('/api/transfers', { from_account: '5211', to_account: '5711', amount: 50000, fees: 500 }), 201);

  // Reports
  const tb = ok(await api.get('/api/reports/trial-balance'));
  assert.ok(tb.balanced, 'trial balance balanced');
  const bs = ok(await api.get('/api/reports/balance-sheet'));
  assert.equal(bs.total_actif, bs.total_passif, 'balance sheet balanced');
  const is = ok(await api.get('/api/reports/income-statement'));
  // Sales 960000 - credit 100000 = 860000; charges 80000 + 25000/1.1925... expense TTC 25000 at 0% VAT → 25000; fees 500
  assert.equal(is.totals.revenue, 860000);
  assert.equal(is.totals.net, 860000 - 80000 - 25000 - 500);
  assert.equal(bs.result, is.totals.net);
  const vat = ok(await api.get('/api/reports/vat'));
  assert.equal(vat.collected, 184800 - 19250);
  assert.equal(vat.deductible, 15400);
  const dash = ok(await api.get('/api/reports/dashboard'));
  assert.equal(dash.kpi.sales_year, 860000);
  assert.ok(dash.treasury.total > 0);
  const gl = ok(await api.get('/api/reports/general-ledger?account=411'));
  assert.equal(gl.accounts[0].balance, 0);
  const xl = await api.get('/api/reports/trial-balance?format=xlsx');
  assert.equal(xl.status, 200);
  assert.equal(xl.data.readUInt32LE(0), 0x04034b50);
  const html = await api.get(`/print/document/${inv.id}`);
  assert.match(html.data, /Arrêtée la présente facture/);
  assert.match(html.data, /FAC-/);

  // Cancel a payment reverses its entry
  const pays = ok(await api.get('/api/payments?direction=in'));
  const cash = pays.find((p) => p.method === 'cash');
  ok(await api.post(`/api/payments/${cash.id}/cancel`));
  d = ok(await api.get(`/api/documents/${inv.id}`));
  assert.equal(d.status, 'partial');
  assert.ok(ok(await api.get('/api/reports/trial-balance')).balanced);

  // Year-end closing
  const year = new Date().getFullYear();
  const close1 = ok(await api.post('/api/accounting/close-year', { year }));
  assert.equal(close1.result, is.totals.net);
  const bs2 = ok(await api.get('/api/reports/balance-sheet'));
  assert.equal(bs2.total_actif, bs2.total_passif);
  // period now locked
  assert.equal((await api.post('/api/expenses', { description: 'x', total: 1000, method: 'cash', date: `${year}-06-01` })).status, 409);
});

test('roles and permissions', async (t) => {
  const { api, close } = await startApp();
  t.after(close);
  await signup(api);
  const owner = api.getCookie();
  ok(await api.post('/api/users', { name: 'Caissière', email: 'caisse@test.cm', password: 'caisse123', role: 'cashier' }), 201);
  ok(await api.post('/api/users', { name: 'Lecteur', email: 'lect@test.cm', password: 'lecteur12', role: 'viewer' }), 201);
  const client = ok(await api.post('/api/partners', { kind: 'client', name: 'Client A' }), 201);
  api.setCookie('');
  ok(await api.post('/api/auth/login', { email: 'caisse@test.cm', password: 'caisse123' }));
  assert.equal((await api.post('/api/documents', { kind: 'invoice', partner_id: client.id, lines: [{ description: 'x', unit_price: 1 }] })).status, 403);
  assert.equal((await api.get('/api/users')).status, 403);
  ok(await api.post('/api/expenses', { description: 'Taxi', total: 2000, method: 'cash' }), 201);
  assert.equal((await api.get('/api/reports/trial-balance')).status, 403);
  api.setCookie('');
  ok(await api.post('/api/auth/login', { email: 'lect@test.cm', password: 'lecteur12' }));
  assert.equal((await api.post('/api/expenses', { description: 'Taxi', total: 2000, method: 'cash' })).status, 403);
  ok(await api.get('/api/reports/trial-balance'));
  api.setCookie('');
  assert.equal((await api.post('/api/auth/login', { email: 'lect@test.cm', password: 'mauvais' })).status, 401);
  api.setCookie(owner);
  ok(await api.get('/api/users'));
});

test('offline replay is idempotent', async (t) => {
  const { api, close } = await startApp();
  t.after(close);
  await signup(api);
  const h = { 'Idempotency-Key': 'offline-123' };
  const a = await api.post('/api/expenses', { description: 'Eau', total: 5000, method: 'cash' }, h);
  const b = await api.post('/api/expenses', { description: 'Eau', total: 5000, method: 'cash' }, h);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal(a.data.id, b.data.id);
  const list = ok(await api.get('/api/expenses'));
  assert.equal(list.length, 1);
});

test('VAT settlement clears 443/445', async (t) => {
  const { api, close } = await startApp();
  t.after(close);
  await signup(api);
  const c = ok(await api.post('/api/partners', { kind: 'client', name: 'C' }), 201);
  ok(await api.post('/api/documents', { kind: 'invoice', partner_id: c.id, validate: true, lines: [{ description: 'x', unit_price: 100000, kind: 'good' }] }), 201);
  ok(await api.post('/api/expenses', { description: 'Fournitures', account_code: '6055', net: 10000, vat_rate: 19.25, method: 'cash' }), 201);
  const r = ok(await api.post('/api/accounting/vat-settlement', { to: new Date().toISOString().slice(0, 10) }));
  assert.equal(r.due, 19250 - 1925);
  const tb = ok(await api.get('/api/reports/trial-balance'));
  assert.ok(tb.balanced);
  assert.equal(tb.rows.find((x) => x.code === '4441').close_credit, 17325);
  assert.ok(!tb.rows.some((x) => /^44[35]/.test(x.code) && (x.close_debit || x.close_credit)));
});

test('customer payment link: choose operator, pay, invoice settled', async (t) => {
  const { api, close, app, base } = await startApp();
  t.after(close);
  await signup(api);
  const c = ok(await api.post('/api/partners', { kind: 'client', name: 'Client Lien', phone: '699112233' }), 201);
  const inv = ok(await api.post('/api/documents', { kind: 'invoice', partner_id: c.id, validate: true, lines: [{ description: 'Service', unit_price: 50000 }] }), 201);
  const link = ok(await api.post(`/api/documents/${inv.id}/pay-link`));
  assert.match(link.url, /\/pay\/[A-Za-z0-9_-]{20,}$/);
  const again = ok(await api.post(`/api/documents/${inv.id}/pay-link`));
  assert.equal(again.token, link.token);
  const pub = (p, body) => fetch(`${base}/api/public/pay/${link.token}${p}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).then(async (r) => ({ status: r.status, data: await r.json() }));
  const view = await pub('');
  assert.equal(view.status, 200);
  assert.equal(view.data.invoice.balance, 59625);
  assert.equal(view.data.company.name, 'Boulangerie Akwa SARL');
  assert.equal(view.data.invoice.partner_phone, '699112233');
  assert.equal((await fetch(`${base}/api/public/pay/xxxxxxxxxxxxxxxxxxxxxxxx`)).status, 404);
  // Operator guessed from the number (69x = Orange)
  const req = await pub('/momo', { phone: '699 11 22 33' });
  assert.equal(req.status, 201);
  const p = app.db.get('SELECT * FROM payments WHERE id = ?', req.data.payment_id);
  assert.equal(p.method, 'orange_money');
  assert.equal(p.status, 'pending');
  app.momo.checkStatus = async () => ({ status: 'successful', transactionId: 'OM42' });
  const st = await pub('/status');
  assert.equal(st.data.invoice.status, 'paid');
  assert.equal((await pub('/momo', { phone: '677000000' })).status, 409);
  const page = await fetch(`${base}/pay/${link.token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Choisissez votre moyen de paiement/);
});

test('manual declaration raises an alert', async (t) => {
  const { api, close, base } = await startApp();
  t.after(close);
  await signup(api);
  const c = ok(await api.post('/api/partners', { kind: 'client', name: 'Client M' }), 201);
  const inv = ok(await api.post('/api/documents', { kind: 'invoice', partner_id: c.id, validate: true, lines: [{ description: 'x', unit_price: 1000 }] }), 201);
  const { token } = ok(await api.post(`/api/documents/${inv.id}/pay-link`));
  const r = await fetch(`${base}/api/public/pay/${token}/declare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'mtn_momo', reference: 'MP123456' }) });
  assert.equal(r.status, 200);
  const alerts = ok(await api.get('/api/alerts'));
  assert.ok(alerts.items.some((a) => a.kind === 'payment_declared' && /MP123456/.test(a.body)));
});

test('Campay aggregator adapter', async () => {
  const { createMobileMoney } = await import('../core/payments/mobile-money.js');
  const calls = [];
  const fake = async (url, opt = {}) => {
    calls.push([url, opt.method || 'GET', opt.body]);
    const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (url.endsWith('/api/token/')) return json({ token: 'TK', expires_in: 3600 });
    if (url.endsWith('/api/collect/')) return json({ reference: 'REF1', ussd_code: '*126#', operator: 'MTN' });
    if (url.includes('/api/transaction/REF1/')) return json({ status: 'SUCCESSFUL', operator_reference: 'MP99' });
    return { ok: false, status: 404, text: async () => '' };
  };
  const m = createMobileMoney({ MOMO_MODE: 'sandbox', MOMO_AGGREGATOR: 'campay', CAMPAY_USERNAME: 'u', CAMPAY_PASSWORD: 'p' }, fake);
  assert.equal(m.configured('orange_money'), true);
  const r = await m.requestPayment({ provider: 'orange_money', phone: '699112233', amount: 1500, reference: 'FAC-1' });
  assert.equal(r.providerRef, 'REF1');
  const body = JSON.parse(calls.find((c) => c[0].endsWith('/api/collect/'))[2]);
  assert.deepEqual(body, { amount: '1500', currency: 'XAF', from: '237699112233', description: 'FAC-1', external_reference: 'FAC-1' });
  assert.ok(calls[0][0].startsWith('https://demo.campay.net'));
  assert.deepEqual(await m.checkStatus('orange_money', 'REF1'), { status: 'successful', transactionId: 'MP99' });
  const off = createMobileMoney({ MOMO_MODE: 'live', MOMO_AGGREGATOR: 'campay' }, fake);
  assert.equal(off.configured('mtn_momo'), false);
});
