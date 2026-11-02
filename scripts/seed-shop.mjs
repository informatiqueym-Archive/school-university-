// Creates a demo supermarket in Douala for Teknons POS: two shops and a
// warehouse, 60 articles with barcodes, promotions, loyalty customers, a week
// of till sessions with realistic sales, a few expiring lots and low stock.
//   MODULES=shop DATA_DIR=./data node scripts/seed-shop.mjs   → demo@teknons.cm / demo1234
// Goes through the real HTTP API, so everything (stock, points, accounting) is consistent.
import path from 'node:path';
import { createApp } from '../app.js';
import { createCompany } from '../core/routes.js';
import { hashPassword } from '../core/auth.js';
import { now } from '../core/schema.js';
import { eanCheck, priceCart } from '../public/js/shop-pricing.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const env = { ...process.env, MODULES: process.env.MODULES || 'shop', MOMO_MODE: process.env.MOMO_MODE || 'simulation' };
const app = createApp({ dbFile: path.join(dataDir, 'teknons.db'), env, jobs: false });
const { db, modules } = app;
const email = process.env.DEMO_EMAIL || 'demo@teknons.cm';
const password = process.env.DEMO_PASSWORD || 'demo1234';
if (db.get('SELECT id FROM users WHERE email = ?', email)) { console.log('Demo company already exists:', email); process.exit(0); }

const { companyId } = createCompany(db, modules, { company: 'Supermarché Le Wouri SARL', name: 'Franck Demo', email, password, phone: '673799674' });
db.run(`UPDATE companies SET legal_form = 'SARL', niu = 'M098765432101Z', rccm = 'RC/DLA/2019/B/4521', address = 'Boulevard de la Liberté, Akwa', city = 'Douala',
  phone = '+237 673 799 674', momo_number = '673 799 674', om_number = '691 23 45 67', invoice_footer = 'Supermarché Le Wouri SARL · NIU M098765432101Z · Akwa, Douala' WHERE id = ?`, companyId);
for (const [name, mail, role] of [['Grâce Caissière', 'caisse@teknons.cm', 'cashier'], ['Serge Caissier', 'caisse2@teknons.cm', 'cashier'], ['Nadège Gérante', 'gerant@teknons.cm', 'manager'], ['Ibrahim Magasinier', 'stock@teknons.cm', 'storekeeper'], ['Aline Comptable', 'compta@teknons.cm', 'accountant']]) {
  db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)', companyId, name, mail, hashPassword(password), role, now());
}

await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
let cookie = '';
async function call(method, p, body) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => null);
  if (res.status >= 300) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const get = (p) => call('GET', p), post = (p, b) => call('POST', p, b || {}), put = (p, b) => call('PUT', p, b);
const login = (mail) => post('/api/auth/login', { email: mail, password });

await login(email);
let meta = await get('/api/shop/meta');
const akwa = meta.stores[0];
await put(`/api/shop/stores/${akwa.id}`, { name: 'Le Wouri Akwa', address: 'Bd de la Liberté, Akwa', phone: '233 42 10 10' });
const bonamoussadi = await post('/api/shop/stores', { name: 'Le Wouri Bonamoussadi', kind: 'shop', address: 'Carrefour Kotto, Bonamoussadi' });
const depot = await post('/api/shop/stores', { name: 'Dépôt Bonabéri', kind: 'warehouse', address: 'Zone industrielle, Bonabéri' });
await post('/api/shop/registers', { store_id: akwa.id, name: 'Caisse 2' });
await put('/api/shop/settings', { manager_pin: '2580', points_per_amount: 1000, point_value: 5, min_points_redeem: 100, topup_bonus_pct: 5, topup_bonus_min: 10000, max_discount_pct: 10,
  receipt_footer: 'Merci de votre visite ! Échange sous 7 jours avec ce ticket. Suivez-nous sur WhatsApp : 673 799 674' });
const users = await get('/api/users');
const uid = (m) => users.find((u) => u.email === m).id;
await put('/api/shop/user-store', { user_id: uid('caisse2@teknons.cm'), store_id: bonamoussadi.id });
await put('/api/shop/user-store', { user_id: uid('stock@teknons.cm'), store_id: depot.id });

// Suppliers
const sup = {};
for (const [k, name, phone] of [['sabc', 'SABC – Brasseries du Cameroun', '233 42 31 31'], ['grossiste', 'Grossiste Akwa Distribution', '699 11 22 33'], ['pasta', 'Panzani Cameroun', '677 45 67 89'],
  ['frais', 'Ferme Avicole de Logbessou', '655 22 33 44'], ['hygiene', 'Hygiène Plus Douala', '691 55 66 77'], ['boucherie', 'Boucherie Centrale Mboppi', '670 88 99 00']]) {
  sup[k] = (await post('/api/partners', { kind: 'supplier', name, phone, city: 'Douala' })).id;
}

// Categories (till buttons)
const cats = {};
for (const [k, name, color, pos] of [['bois', 'Boissons', '#0B8AC9', 1], ['epi', 'Épicerie', '#F2B705', 2], ['frais', 'Frais & laitiers', '#1BAF7A', 3], ['bouch', 'Boucherie & poisson', '#C93636', 4],
  ['hyg', 'Hygiène & entretien', '#7A5AF8', 5], ['bebe', 'Bébé', '#FF7900', 6], ['pain', 'Boulangerie', '#A66300', 7]]) {
  cats[k] = (await post('/api/shop/categories', { name, color, position: pos })).id;
}

// Articles: [category, name, retail TTC, cost HT, supplier, extra]
const ean = (n) => { const b = '615' + String(1000000000 + n).slice(1); return b + eanCheck(b); };
let n = 0;
const ITEMS = [
  ['bois', '33 Export 65 cl', 650, 420, 'sabc', { quick: 1, min: 48, reorder: 144, wholesale: 600, wmin: 12 }],
  ['bois', 'Castel Beer 65 cl', 650, 420, 'sabc', { quick: 1, min: 48, reorder: 144, wholesale: 600, wmin: 12 }],
  ['bois', 'Guinness 65 cl', 900, 610, 'sabc', { quick: 1, min: 24, reorder: 96 }],
  ['bois', 'Top Pamplemousse 1 L', 600, 380, 'sabc', { quick: 1, min: 24, reorder: 72 }],
  ['bois', 'Coca-Cola 1,5 L', 1000, 660, 'sabc', { quick: 1, min: 24, reorder: 72, wholesale: 900, wmin: 6 }],
  ['bois', 'Eau minérale Supermont 1,5 L', 400, 250, 'sabc', { quick: 1, min: 60, reorder: 180, wholesale: 350, wmin: 12 }],
  ['bois', 'Eau Tangui 1,5 L', 450, 290, 'sabc', { min: 36, reorder: 120 }],
  ['bois', 'Jus Foster Clark\'s orange 1 L', 1500, 1000, 'grossiste', { min: 12, reorder: 36 }],
  ['bois', 'Malta Guinness 33 cl', 500, 320, 'sabc', { quick: 1, min: 24, reorder: 72 }],
  ['bois', 'Whisky Johnnie Walker Red 70 cl', 14500, 10500, 'grossiste', { min: 3, reorder: 6 }],
  ['epi', 'Riz parfumé Uncle Ben\'s 5 kg', 6500, 4800, 'grossiste', { min: 10, reorder: 40, wholesale: 6000, wmin: 5 }],
  ['epi', 'Riz Mémé Cassé 25 kg', 18500, 14000, 'grossiste', { min: 5, reorder: 20, wholesale: 17500, wmin: 3 }],
  ['epi', 'Huile Diamaor 1 L', 1600, 1150, 'grossiste', { quick: 1, min: 24, reorder: 72, wholesale: 1500, wmin: 12 }],
  ['epi', 'Huile Mayor 5 L', 7800, 5900, 'grossiste', { min: 6, reorder: 24 }],
  ['epi', 'Sucre en morceaux Sosucam 1 kg', 1100, 780, 'grossiste', { quick: 1, min: 24, reorder: 72 }],
  ['epi', 'Spaghetti Panzani 500 g', 650, 430, 'pasta', { quick: 1, min: 36, reorder: 120, wholesale: 600, wmin: 20 }],
  ['epi', 'Macaroni Panzani 500 g', 650, 430, 'pasta', { min: 24, reorder: 96 }],
  ['epi', 'Tomate concentrée Gino 400 g', 750, 480, 'grossiste', { min: 24, reorder: 72 }],
  ['epi', 'Cube Maggi (boîte de 100)', 2500, 1800, 'grossiste', { min: 12, reorder: 48, wholesale: 2300, wmin: 5 }],
  ['epi', 'Sel de cuisine La Baleine 1 kg', 400, 240, 'grossiste', { min: 24, reorder: 48 }],
  ['epi', 'Chocolat Mambo 200 g', 1200, 800, 'grossiste', { min: 12, reorder: 48 }],
  ['epi', 'Café Arabica Moungo 250 g', 2200, 1500, 'grossiste', { min: 6, reorder: 24 }],
  ['epi', 'Lait en poudre Nido 400 g', 3500, 2600, 'grossiste', { min: 12, reorder: 36, expiry: true }],
  ['epi', 'Corned beef Exeter 340 g', 2100, 1500, 'grossiste', { min: 12, reorder: 36 }],
  ['epi', 'Sardines Titus 125 g', 600, 390, 'grossiste', { quick: 1, min: 48, reorder: 144 }],
  ['epi', 'Farine de blé La Pelle 1 kg', 750, 520, 'grossiste', { min: 12, reorder: 48 }],
  ['frais', 'Œufs frais (plateau de 30)', 3000, 2200, 'frais', { quick: 1, min: 10, reorder: 30, expiry: true, vat: 0 }],
  ['frais', 'Yaourt Dolait nature 125 g', 300, 190, 'grossiste', { min: 48, reorder: 120, expiry: true }],
  ['frais', 'Lait frais Dolait 1 L', 1300, 900, 'grossiste', { min: 12, reorder: 36, expiry: true }],
  ['frais', 'Beurre Président 250 g', 2400, 1700, 'grossiste', { min: 10, reorder: 30, expiry: true }],
  ['frais', 'Fromage La Vache qui rit (16 portions)', 2000, 1400, 'grossiste', { min: 10, reorder: 30, expiry: true }],
  ['frais', 'Plantain mûr (régime)', 2500, 1700, 'frais', { by_weight: 0, min: 5, reorder: 15, vat: 0 }],
  ['frais', 'Tomates fraîches', 1200, 700, 'frais', { by_weight: 1, plu: '101', min: 10, reorder: 30, vat: 0 }],
  ['frais', 'Oignons', 900, 550, 'frais', { by_weight: 1, plu: '102', min: 10, reorder: 30, vat: 0 }],
  ['bouch', 'Viande de bœuf (avec os)', 3800, 2900, 'boucherie', { by_weight: 1, plu: '12', min: 10, reorder: 30, vat: 0, quick: 1 }],
  ['bouch', 'Poulet de chair entier', 4500, 3300, 'frais', { by_weight: 0, min: 10, reorder: 30, vat: 0, quick: 1, expiry: true }],
  ['bouch', 'Poisson bar (frais)', 3500, 2500, 'boucherie', { by_weight: 1, plu: '21', min: 8, reorder: 20, vat: 0 }],
  ['bouch', 'Maquereau congelé (carton 20 kg)', 26000, 21000, 'boucherie', { min: 2, reorder: 6, vat: 0 }],
  ['hyg', 'Savon Azur 200 g', 350, 220, 'hygiene', { quick: 1, min: 48, reorder: 144, wholesale: 300, wmin: 12 }],
  ['hyg', 'Lessive OMO 1 kg', 1800, 1250, 'hygiene', { min: 12, reorder: 36 }],
  ['hyg', 'Eau de Javel La Croix 1 L', 750, 480, 'hygiene', { min: 12, reorder: 36 }],
  ['hyg', 'Dentifrice Signal 100 ml', 1100, 720, 'hygiene', { min: 12, reorder: 36 }],
  ['hyg', 'Papier toilette Lotus (x4)', 1500, 1000, 'hygiene', { min: 12, reorder: 36 }],
  ['hyg', 'Insecticide Rambo 400 ml', 2300, 1600, 'hygiene', { min: 6, reorder: 24 }],
  ['hyg', 'Pâte à tartiner Nutella 400 g', 3900, 2800, 'grossiste', { min: 6, reorder: 24, expiry: true }],
  ['bebe', 'Couches Pampers taille 4 (x50)', 9500, 7200, 'hygiene', { min: 6, reorder: 18 }],
  ['bebe', 'Lait infantile Guigoz 1er âge 400 g', 6200, 4700, 'grossiste', { min: 6, reorder: 18, expiry: true }],
  ['bebe', 'Lingettes bébé (x72)', 1800, 1200, 'hygiene', { min: 6, reorder: 24 }],
  ['pain', 'Baguette', 150, 100, 'frais', { quick: 1, min: 20, reorder: 150, vat: 0, nocode: 1 }],
  ['pain', 'Pain de mie complet', 1000, 650, 'frais', { min: 6, reorder: 20, expiry: true }],
  ['pain', 'Croissant beurre', 300, 180, 'frais', { quick: 1, min: 10, reorder: 80, nocode: 1 }],
];
const soon = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const items = [];
for (const [c, name, retail, cost, s, x] of ITEMS) {
  n++;
  const it = await post('/api/shop/items', {
    name, category_id: cats[c], retail_price: retail, purchase_price: cost, supplier_id: sup[s], barcode: x.nocode || x.by_weight ? '' : ean(n), generate_barcode: !!x.nocode,
    wholesale_price: x.wholesale || 0, wholesale_min_qty: x.wmin || 0, min_stock: x.min, reorder_qty: x.reorder, track_expiry: !!x.expiry, by_weight: !!x.by_weight, plu: x.plu || '', quick: !!x.quick,
    vat_rate: x.vat === 0 ? 0 : '', unit: x.by_weight ? 'kg' : 'u',
  });
  items.push({ ...it, cost, x });
}
const byName = (s) => items.find((i) => i.name.startsWith(s));

// Opening stock through purchase orders (creates the supplier bills in Compta)
async function receiveAll(store, factor, expiryDays) {
  const bySup = {};
  for (const it of items) (bySup[it.supplier_id] ||= []).push(it);
  for (const [s, list] of Object.entries(bySup)) {
    const po = await post('/api/shop/purchase-orders', { supplier_id: Number(s), store_id: store, send: true, lines: list.map((it) => ({ product_id: it.id, qty: Math.max(4, Math.round((it.x.reorder || 30) * factor)), unit_cost: it.cost })) });
    await post(`/api/shop/purchase-orders/${po.id}/receive`, { supplier_ref: `BL-${po.number.slice(-4)}`, lines: po.lines.map((l) => ({ line_id: l.id, qty: l.qty, expiry: l.track_expiry ? soon(expiryDays(l)) : undefined, lot: l.track_expiry ? `L${l.id}` : undefined })) });
  }
}
await receiveAll(akwa.id, 3, (l) => 40 + (l.id % 90));
await receiveAll(bonamoussadi.id, 2, (l) => 60 + (l.id % 60));
await receiveAll(depot.id, 2, (l) => 90 + (l.id % 120));
// a few lots close to expiry (for the alerts) and a couple of low stocks
for (const [name, days, qty] of [['Yaourt', 6, 18], ['Lait frais', 3, 8], ['Pain de mie', 2, 5], ['Beurre', 20, 6]]) {
  await post('/api/shop/stock/adjust', { store_id: akwa.id, product_id: byName(name).id, kind: 'receipt', qty, unit_cost: byName(name).cost, expiry: soon(days), lot: 'PROMO' });
}
for (const name of ['Whisky', 'Café Arabica', 'Insecticide']) {
  const it = await get(`/api/shop/items/${byName(name).id}`);
  const q = it.stock.find((s) => s.store_id === akwa.id).qty;
  await post('/api/shop/stock/adjust', { store_id: akwa.id, product_id: it.id, kind: 'loss', qty: Math.max(0, q - 1), note: 'Ajustement démo' });
}

// Promotions
await post('/api/shop/promos', { name: '3 Spaghetti pour 1 800', kind: 'bundle', product_id: byName('Spaghetti').id, qty: 3, value: 1800 });
await post('/api/shop/promos', { name: 'Hygiène −10 % ce mois', kind: 'percent', category_id: cats.hyg, value: 10, start_date: soon(-10), end_date: soon(20) });
await post('/api/shop/promos', { name: 'Coca 1,5 L à 900', kind: 'price', product_id: byName('Coca-Cola').id, value: 900, start_date: soon(-3), end_date: soon(11) });
await post('/api/shop/promos', { name: '5 Savons Azur = 1 offert', kind: 'buy_get', product_id: byName('Savon Azur').id, qty: 5, free_qty: 1 });
await post('/api/shop/promos', { name: 'Happy week-end : Guinness −15 %', kind: 'percent', product_id: byName('Guinness').id, value: 15, days: '6,0' });
await post('/api/shop/promos', { name: 'Yaourt bientôt périmé −30 %', kind: 'percent', product_id: byName('Yaourt').id, value: 30, end_date: soon(6) });

// Loyalty customers
const custs = [];
for (const [name, phone, card, level, limit, bday] of [
  ['Mama Ngono (revendeuse)', '677000111', 'FID000101', 'wholesale', 150000, ''], ['Jean-Paul Mbarga', '699223344', 'FID000102', 'retail', 0, '1985-11-04'],
  ['Hôtel Akwa Palace', '677112233', 'FID000103', 'wholesale', 500000, ''], ['Aïcha Bello', '655667788', 'FID000104', 'retail', 0, '1992-03-15'],
  ['Restaurant Chez Wou', '678990011', 'FID000105', 'wholesale', 250000, ''], ['Christelle Ekambi', '690456123', 'FID000106', 'retail', 20000, '1990-11-02'],
  ['Famille Tchoupo', '696112244', 'FID000107', 'retail', 0, ''], ['Boutique Ndokoti', '670332211', 'FID000108', 'wholesale', 100000, ''],
]) custs.push(await post('/api/shop/customers', { name, phone, card_no: card, price_level: level, credit_limit: limit, birthday: bday }));

// A week of selling: each day, each till opens, sells, closes (with a small variance now and then)
const regs = (await get('/api/shop/meta')).registers;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const weighted = items.filter((i) => i.x.quick).concat(items);
const hourW = [7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 15, 16, 17, 17, 18, 18, 18, 19, 19, 20];
const methods = ['cash', 'cash', 'cash', 'cash', 'mtn_momo', 'mtn_momo', 'orange_money', 'card'];
const shifts = [[regs.find((r) => r.store_id === akwa.id && r.name === 'Caisse 1'), 'caisse@teknons.cm'], [regs.find((r) => r.store_id === akwa.id && r.name === 'Caisse 2'), email], [regs.find((r) => r.store_id === bonamoussadi.id), 'caisse2@teknons.cm']];
let topups = 0;
const me = await get('/api/me');
const vat = me.company.vat_enabled ? me.company.vat_rate : 0;
const settings = (await get('/api/shop/meta')).settings;
const catalogs = {};
async function catalogFor(storeId) {
  const c = await get(`/api/shop/catalog?store_id=${storeId}`);
  c.byId = Object.fromEntries(c.items.map((i) => [i.product_id, i]));
  return (catalogs[storeId] = c);
}
for (let day = 6; day >= 0; day--) {
  const date = new Date(Date.now() - day * 864e5).toISOString().slice(0, 10);
  for (const [reg, mail] of shifts) {
    await login(mail);
    const sess = await post('/api/shop/sessions', { register_id: reg.id, opening_float: 25000 });
    const catalog = await catalogFor(reg.store_id);
    const nSales = rnd(day === 0 ? 8 : 18, day === 0 ? 14 : 32) + (new Date(date).getUTCDay() === 6 ? 10 : 0);
    const ids = [];
    for (let k = 0; k < nSales; k++) {
      const lines = [];
      for (let j = rnd(1, 6); j > 0; j--) {
        const it = pick(weighted);
        if (lines.some((l) => l.product_id === it.id)) continue;
        lines.push({ product_id: it.id, qty: it.by_weight ? rnd(3, 25) / 10 : it.name.startsWith('Spaghetti') ? pick([1, 3, 3]) : rnd(1, it.retail_price < 1000 ? 4 : 2) });
      }
      const cu = Math.random() < 0.35 ? pick(custs) : null;
      const body = { session_id: sess.id, customer_id: cu?.partner_id, lines };
      // price the basket exactly as the till does (shared pricing rules)
      const pr = priceCart({ lines, items: catalog.byId, promos: catalog.promos, level: cu?.price_level || 'retail', vatDefault: vat, date, settings });
      const total = pr.total;
      if (!total) continue;
      try {
        const m = cu && cu.credit_limit && Math.random() < 0.15 ? 'credit' : pick(methods);
        const pay = m === 'cash' ? [{ method: 'cash', amount: Math.ceil(total / 1000) * 1000 }] : [{ method: m, amount: total, reference: m === 'mtn_momo' || m === 'orange_money' ? `MP${rnd(10000000, 99999999)}` : '' }];
        const done = await post('/api/shop/sales', { ...body, payments: pay });
        ids.push(done.id);
      } catch (e) { /* stock or limit edge cases: skip that basket */ }
    }
    if (day < 3 && topups < 4) { const c = pick(custs); await post('/api/shop/topups', { customer_id: c.partner_id, amount: pick([10000, 20000, 50000]), method: pick(['cash', 'mtn_momo']) }); topups++; }
    // spread the tickets over the opening hours of that day
    for (const id of ids) {
      const h = pick(hourW); const t = `${date}T${String(h).padStart(2, '0')}:${String(rnd(0, 59)).padStart(2, '0')}:${String(rnd(0, 59)).padStart(2, '0')}.000Z`;
      db.run('UPDATE shop_sales SET created_at = ? WHERE id = ?', t, id);
      db.run('UPDATE shop_customer_moves SET at = ? WHERE sale_id = ?', t, id);
    }
    if (day === 0 && reg.name !== 'Caisse 2') continue; // today: two tills still open
    const sum = await get(`/api/shop/sessions/${sess.id}`);
    const expected = sum.summary?.cash?.expected ?? sum.cash?.expected ?? 0;
    const variance = Math.random() < 0.25 ? -pick([500, 1000, 2500]) : 0;
    const closed = await post(`/api/shop/sessions/${sess.id}/close`, { counted_cash: Math.max(0, expected + variance), note: variance ? 'Écart constaté au comptage' : '' });
    db.run('UPDATE shop_sessions SET opened_at = ?, closed_at = ? WHERE id = ?', `${date}T06:45:00.000Z`, `${date}T21:${String(rnd(5, 40)).padStart(2, '0')}:00.000Z`, sess.id);
    if (closed?.session?.entry_id) db.run('UPDATE journal_entries SET date = ? WHERE id = ?', date, closed.session.entry_id);
  }
}
await login(email);
// a transfer in transit from the warehouse
await post('/api/shop/transfers', { from_store: depot.id, to_store: akwa.id, notes: 'Camion Isuzu · chauffeur Alain', lines: [{ product_id: byName('33 Export').id, qty: 96 }, { product_id: byName('Eau minérale').id, qty: 120 }, { product_id: byName('Riz Mémé').id, qty: 10 }] });

const stats = db.get("SELECT COUNT(*) n, SUM(total) v FROM shop_sales WHERE company_id = ? AND status = 'completed' AND kind = 'sale'", companyId);
console.log(`Demo supermarket created: ${email} / ${password} · ${items.length} articles · ${stats.n} tickets · ${stats.v} FCFA`);
console.log('Other logins (same password): caisse@teknons.cm, caisse2@teknons.cm, gerant@teknons.cm, stock@teknons.cm, compta@teknons.cm · manager code 2580');
app.server.closeAllConnections?.();
app.server.close();
process.exit(0);
