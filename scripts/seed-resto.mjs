// Creates a demo upscale restaurant and lounge in Douala for Teknons Resto:
// four rooms and 27 tables, kitchen / grill / bar stations, a Cameroonian menu
// with options and recipes, ingredients and suppliers, staff accounts, loyal
// guests, three weeks of service history (checks, tips, cash-ups, reviews) and a
// live evening: seated tables, dishes cooking and ready, a QR order waiting,
// table calls, online deliveries and tonight's bookings.
//   MODULES=restaurant DATA_DIR=./data node scripts/seed-resto.mjs   → demo@teknons.cm / demo1234
// Goes through the real HTTP API, so checks, stock and accounting stay consistent;
// only the clock is moved back afterwards for past days.
import path from 'node:path';
import { createApp } from '../app.js';
import { createCompany } from '../core/routes.js';
import { hashPassword } from '../core/auth.js';
import { now, today } from '../core/schema.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const env = { ...process.env, MODULES: process.env.MODULES || 'restaurant', MOMO_MODE: process.env.MOMO_MODE || 'simulation' };
const app = createApp({ dbFile: path.join(dataDir, 'teknons.db'), env, jobs: false });
const { db, modules } = app;
const email = process.env.DEMO_EMAIL || 'demo@teknons.cm';
const password = process.env.DEMO_PASSWORD || 'demo1234';
if (db.get('SELECT id FROM users WHERE email = ?', email)) { console.log('Demo company already exists:', email); process.exit(0); }

const { companyId } = createCompany(db, modules, { company: 'Maison Ébène', name: 'Franck Demo', email, password, phone: '673799674' });
db.run(`UPDATE companies SET legal_form = 'SARL', niu = 'M062418273645K', rccm = 'RC/DLA/2019/B/4471', address = 'Rue Njo-Njo, Bonapriso', city = 'Douala',
  phone = '+237 673 799 674', website = 'maisonebene.cm', momo_number = '673 799 674', om_number = '691 23 45 67',
  invoice_footer = 'Maison Ébène SARL · NIU M062418273645K · Bonapriso, Douala · Merci de votre visite' WHERE id = ?`, companyId);
const STAFF = [['Arielle Mbappe', 'serveur@teknons.cm', 'server'], ['Junior Ekambi', 'serveur2@teknons.cm', 'server'], ['Prisca Ngo Bayiha', 'serveur3@teknons.cm', 'server'],
  ['Chef Samuel Eboa', 'chef@teknons.cm', 'cook'], ['Ludovic Barman', 'bar@teknons.cm', 'cook'], ['Nadège Directrice', 'gerant@teknons.cm', 'manager'],
  ['Brice Caisse', 'caisse@teknons.cm', 'cashier'], ['Aline Comptable', 'compta@teknons.cm', 'accountant']];
const uid = {};
for (const [name, mail, role] of STAFF) uid[mail] = Number(db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)', companyId, name, mail, hashPassword(password), role, now()).lastInsertRowid);
const servers = [uid['serveur@teknons.cm'], uid['serveur2@teknons.cm'], uid['serveur3@teknons.cm']];

await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
let cookie = '';
async function call(method, p, body, headers = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie'); if (set && !p.startsWith('/api/public')) cookie = set.split(';')[0];
  const data = await res.json().catch(() => null);
  if (res.status >= 300) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const get = (p) => call('GET', p), post = (p, b) => call('POST', p, b || {}), put = (p, b) => call('PUT', p, b);
let ipN = 1;
const guest = (p, b) => call('POST', p, b, { 'X-Forwarded-For': `10.9.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}` });
const tryIt = async (fn) => { try { return await fn(); } catch (e) { if (process.env.DEBUG) console.warn(e.message); return null; } };
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const iso = (ms) => new Date(ms).toISOString();

await post('/api/auth/login', { email, password });
await put('/api/resto/settings', { service_pct: 0, tip_suggestions: '5,10,15', delivery_fee: 1500, min_delivery: 8000, points_per_1000: 1, point_value: 100, max_discount_pct: 10, prep_target_min: 18,
  reservation_minutes: 120, happy_hour_from: '17:00', happy_hour_to: '19:00', happy_hour_pct: 30, open_time: '11:30', close_time: '23:30', qr_ordering: 1, qr_pay: 1, qr_auto_send: 0, online_orders: 1, online_reservations: 1,
  cuisine: 'Cuisine camerounaise revisitée · grillades · cocktails', wifi_name: 'Ebene-Guest', wifi_password: 'Ndole2026', manager_pin: '2580',
  receipt_footer: 'Merci de votre visite ! Réservez votre prochaine table sur maisonebene.cm',
  welcome_text: 'Bienvenue à la Maison Ébène. Parcourez notre carte, commandez quand vous le souhaitez, appelez votre serveur ou réglez l\'addition depuis votre téléphone. Bon appétit !' });
let meta = await get('/api/resto/meta');

// ---------- Rooms, tables, stations ----------
const salle = meta.areas[0];
await put(`/api/resto/areas/${salle.id}`, { name: 'Salle principale', position: 1 });
const terrasse = await post('/api/resto/areas', { name: 'Terrasse', position: 2 });
const lounge = await post('/api/resto/areas', { name: 'Lounge VIP', position: 3 });
const bar = await post('/api/resto/areas', { name: 'Bar', position: 4 });
const layout = [
  [salle.id, 'T', [[1, 8, 14, 'square', 4], [2, 24, 14, 'square', 4], [3, 40, 14, 'square', 2], [4, 56, 14, 'square', 2], [5, 74, 12, 'rect', 6], [6, 8, 44, 'round', 4], [7, 26, 44, 'round', 4], [8, 44, 44, 'round', 4], [9, 62, 44, 'square', 4], [10, 80, 44, 'square', 4], [11, 12, 74, 'booth', 6], [12, 38, 74, 'booth', 6]]],
  [terrasse.id, 'P', [[1, 8, 12, 'round', 2], [2, 26, 12, 'round', 2], [3, 44, 12, 'round', 4], [4, 62, 12, 'round', 4], [5, 80, 12, 'square', 4], [6, 14, 52, 'rect', 8], [7, 46, 52, 'square', 4], [8, 70, 52, 'square', 4]]],
  [lounge.id, 'V', [[1, 12, 20, 'booth', 6], [2, 44, 20, 'booth', 8], [3, 76, 20, 'round', 4]]],
  [bar.id, 'B', [[1, 10, 20, 'square', 2], [2, 30, 20, 'square', 2], [3, 50, 20, 'square', 2], [4, 70, 20, 'square', 2]]]];
const tables = [];
for (const [area_id, prefix, list] of layout) for (const [n, x, y, shape, seats] of list) tables.push(await post('/api/resto/tables', { area_id, label: `${prefix}${n}`, x, y, shape, seats }));
meta = await get('/api/resto/meta');
const st = Object.fromEntries(meta.stations.map((s) => [s.kind === 'bar' ? 'bar' : 'kitchen', s.id]));
st.grill = (await post('/api/resto/stations', { name: 'Grill', kind: 'kitchen', position: 2 })).id;
st.pastry = (await post('/api/resto/stations', { name: 'Pâtisserie', kind: 'kitchen', position: 3 })).id;

// ---------- Suppliers and ingredients ----------
const sup = {};
for (const [k, name, phone] of [['market', 'Marché Sandaga – Mama Odile', '677 45 12 90'], ['fish', 'Poissonnerie de Youpwé', '699 11 22 33'], ['meat', 'Boucherie Moderne d\'Akwa', '655 34 56 78'],
  ['drinks', 'SABC – Dépôt Bonapriso', '233 42 18 00'], ['wine', 'Cave des Palmiers', '690 87 65 43']]) sup[k] = (await post('/api/partners', { kind: 'supplier', name, phone, city: 'Douala' })).id;
const G = {};
for (const [k, name, unit, cost, min_stock, category, s] of [
  ['shrimp', 'Crevettes fraîches', 'kg', 9000, 4, 'Poissons', 'fish'], ['bar', 'Bar (poisson entier)', 'kg', 5200, 6, 'Poissons', 'fish'], ['cod', 'Morue salée', 'kg', 6500, 1, 'Poissons', 'fish'],
  ['ndole', 'Feuilles de ndolé', 'kg', 2500, 3, 'Légumes', 'market'], ['peanut', 'Arachides', 'kg', 1500, 3, 'Épicerie', 'market'], ['eru', 'Feuilles d\'eru', 'kg', 2200, 2, 'Légumes', 'market'],
  ['chicken', 'Poulet fermier', 'kg', 3200, 8, 'Viandes', 'meat'], ['beef', 'Filet de bœuf', 'kg', 9500, 3, 'Viandes', 'meat'], ['ribeye', 'Entrecôte', 'kg', 11500, 4, 'Viandes', 'meat'],
  ['goat', 'Viande de chèvre', 'kg', 5000, 3, 'Viandes', 'meat'], ['mince', 'Bœuf haché', 'kg', 6000, 2, 'Viandes', 'meat'],
  ['plantain', 'Plantain mûr', 'kg', 600, 15, 'Légumes', 'market'], ['miondo', 'Miondo', 'u', 100, 40, 'Épicerie', 'market'], ['rice', 'Riz parfumé', 'kg', 900, 10, 'Épicerie', 'market'],
  ['potato', 'Pommes de terre', 'kg', 800, 12, 'Légumes', 'market'], ['avocado', 'Avocats', 'u', 300, 15, 'Légumes', 'market'], ['tomato', 'Tomates', 'kg', 800, 6, 'Légumes', 'market'],
  ['onion', 'Oignons', 'kg', 700, 5, 'Légumes', 'market'], ['oil', 'Huile végétale', 'l', 1600, 10, 'Épicerie', 'market'], ['pumpkin', 'Potiron', 'kg', 700, 3, 'Légumes', 'market'],
  ['bun', 'Pain burger brioché', 'u', 300, 20, 'Épicerie', 'market'], ['choco', 'Chocolat noir 70 %', 'kg', 6500, 1, 'Épicerie', 'market'], ['pineapple', 'Ananas', 'u', 700, 8, 'Légumes', 'market'],
  ['icecream', 'Crème glacée', 'l', 4000, 3, 'Laitier', 'market'], ['bissap', 'Fleurs de bissap', 'kg', 2000, 1, 'Épicerie', 'market'], ['ginger', 'Gingembre frais', 'kg', 1500, 1, 'Légumes', 'market'],
  ['lime', 'Citrons verts', 'kg', 1200, 2, 'Légumes', 'market'], ['rum', 'Rhum blanc', 'l', 12000, 2, 'Boissons', 'wine'], ['gin', 'Gin premium', 'l', 18000, 1, 'Boissons', 'wine'],
  ['bourbon', 'Bourbon', 'l', 22000, 1, 'Boissons', 'wine'], ['aperol', 'Apéritif italien', 'l', 15000, 1, 'Boissons', 'wine'],
  ['castel', 'Castel 65 cl', 'btl', 650, 48, 'Boissons', 'drinks'], ['export33', '33 Export 65 cl', 'btl', 650, 48, 'Boissons', 'drinks'], ['guinness', 'Guinness 33 cl', 'btl', 900, 24, 'Boissons', 'drinks'],
  ['water', 'Eau minérale 1,5 l', 'btl', 350, 36, 'Boissons', 'drinks'], ['coke', 'Coca-Cola 33 cl', 'btl', 400, 24, 'Boissons', 'drinks'],
  ['redwine', 'Vin rouge (verre, bouteille ouverte)', 'btl', 9000, 6, 'Boissons', 'wine'], ['bordeaux', 'Bordeaux Saint-Émilion', 'btl', 14000, 4, 'Boissons', 'wine'], ['champagne', 'Champagne Brut', 'btl', 38000, 3, 'Boissons', 'wine']]) {
  G[k] = (await post('/api/resto/ingredients', { name, unit, cost, min_stock, category, supplier_id: sup[s], stock: min_stock * 40 + 20 })).id;
}

// ---------- Menu ----------
const C = {};
for (const [k, name, name_en, station, course, drinks, position] of [
  ['cocktails', 'Cocktails signature', 'Signature cocktails', 'bar', 0, 1, 1], ['beers', 'Bières et softs', 'Beers & soft drinks', 'bar', 0, 1, 2], ['wines', 'Vins et champagnes', 'Wines & champagne', 'bar', 0, 1, 3],
  ['starters', 'Entrées', 'Starters', 'kitchen', 1, 0, 4], ['mains', 'Plats de la Maison', 'House mains', 'kitchen', 2, 0, 5], ['grill', 'Grillades', 'From the grill', 'grill', 2, 0, 6],
  ['sides', 'Accompagnements', 'Sides', 'kitchen', 2, 0, 7], ['desserts', 'Desserts', 'Desserts', 'pastry', 3, 0, 8]]) {
  C[k] = (await post('/api/resto/categories', { name, name_en, station_id: st[station], course, drinks, position })).id;
}
const SIDE = { group: 'Accompagnement', required: true, choices: [{ name: 'Miondo' }, { name: 'Plantain mûr frit' }, { name: 'Riz parfumé' }, { name: 'Frites maison', price: 500 }] };
const CHILI = { group: 'Piment', choices: [{ name: 'Sans piment' }, { name: 'Doux' }, { name: 'Bien relevé' }] };
const DONE = { group: 'Cuisson', required: true, choices: [{ name: 'Saignant' }, { name: 'À point' }, { name: 'Bien cuit' }] };
const I = {};
for (const [k, cat, name, name_en, price, description, extra, recipe] of [
  ['mojito', 'cocktails', 'Mojito Bissap', 'Bissap Mojito', 5500, 'Rhum blanc, fleurs de bissap infusées, menthe fraîche, citron vert.', { tags: 'Signature' }, [['rum', 0.05], ['bissap', 0.01], ['lime', 0.04]]],
  ['mule', 'cocktails', 'Ginger Mule de Douala', 'Douala Ginger Mule', 6000, 'Gin, gingembre frais pressé, citron vert, eau gazeuse.', {}, [['gin', 0.05], ['ginger', 0.03], ['lime', 0.03]]],
  ['spritz', 'cocktails', 'Spritz Wouri', 'Wouri Spritz', 6500, 'Apéritif italien, vin pétillant, orange, une touche de bissap.', {}, [['aperol', 0.06]]],
  ['oldfash', 'cocktails', 'Old Fashioned Cacao', 'Cocoa Old Fashioned', 8000, 'Bourbon, bitter cacao du Cameroun, zeste d\'orange.', { tags: 'Signature' }, [['bourbon', 0.06]]],
  ['virgin', 'cocktails', 'Virgin Bissap Gingembre', 'Virgin Bissap Ginger', 3500, 'Sans alcool : bissap, gingembre, citron vert, menthe.', { tags: 'Sans alcool' }, [['bissap', 0.01], ['ginger', 0.02], ['lime', 0.03]]],
  ['castel', 'beers', 'Castel 65 cl', 'Castel 65 cl', 2000, '', {}, [['castel', 1]]], ['export', 'beers', '33 Export 65 cl', '33 Export 65 cl', 2000, '', {}, [['export33', 1]]],
  ['guinness', 'beers', 'Guinness', 'Guinness', 2500, '', {}, [['guinness', 1]]], ['water', 'beers', 'Eau minérale 1,5 l', 'Still water 1.5 l', 1500, '', {}, [['water', 1]]],
  ['coke', 'beers', 'Coca-Cola', 'Coca-Cola', 1500, '', {}, [['coke', 1]]], ['jusbissap', 'beers', 'Jus de bissap maison', 'Homemade bissap juice', 2000, 'Infusé chaque matin, peu sucré.', { tags: 'Maison' }, [['bissap', 0.01]]],
  ['wineglass', 'wines', 'Verre de vin rouge', 'Glass of red wine', 5000, 'Sélection du sommelier.', {}, [['redwine', 0.2]]],
  ['bordeaux', 'wines', 'Saint-Émilion (bouteille)', 'Saint-Émilion (bottle)', 38000, '', {}, [['bordeaux', 1]]],
  ['champagne', 'wines', 'Champagne Brut (bouteille)', 'Brut champagne (bottle)', 85000, 'Servi avec seau à glace.', { tags: 'Célébration' }, [['champagne', 1]]],
  ['avocado', 'starters', 'Avocat crevettes, sauce agrumes', 'Avocado & shrimp, citrus dressing', 7500, 'Avocat de l\'Ouest, crevettes de Youpwé sautées, vinaigrette agrumes.', { allergens: 'Crustacés' }, [['avocado', 1], ['shrimp', 0.08]]],
  ['accras', 'starters', 'Accras de morue, piment doux', 'Salt-cod fritters', 5000, 'Six accras croustillants, sauce piment doux maison.', { allergens: 'Poisson, Gluten' }, [['cod', 0.08], ['oil', 0.05]]],
  ['soya', 'starters', 'Soya de filet de bœuf', 'Beef filet suya skewers', 6500, 'Brochettes de filet au poivre de Penja et épices soya, oignons croquants.', { tags: 'Épicé', allergens: 'Arachides' }, [['beef', 0.12], ['onion', 0.03]]],
  ['velute', 'starters', 'Velouté de potiron au gingembre', 'Pumpkin & ginger velouté', 5000, '', { tags: 'Végétarien', allergens: 'Lait' }, [['pumpkin', 0.25], ['ginger', 0.01]]],
  ['ndole', 'mains', 'Ndolé aux crevettes', 'Ndolé with shrimp', 12000, 'Le plat national revisité : feuilles de ndolé, pâte d\'arachide, crevettes géantes.', { tags: 'Signature', allergens: 'Arachides, Crustacés', options: [SIDE], prep_min: 15 }, [['ndole', 0.15], ['peanut', 0.1], ['shrimp', 0.12], ['plantain', 0.25]]],
  ['dg', 'mains', 'Poulet DG', 'Chicken DG', 11000, 'Poulet fermier sauté aux plantains mûrs, carottes, haricots verts et poivrons.', { tags: 'Populaire', prep_min: 18 }, [['chicken', 0.45], ['plantain', 0.3], ['tomato', 0.05], ['oil', 0.04]]],
  ['eru', 'mains', 'Eru et water fufu', 'Eru & water fufu', 9000, 'Feuilles d\'eru et waterleaf mijotées, peau de bœuf, huile rouge.', { prep_min: 12 }, [['eru', 0.15], ['beef', 0.05], ['oil', 0.05]]],
  ['kondre', 'mains', 'Kondrè de chèvre', 'Goat kondrè', 13000, 'Ragoût de chèvre aux plantains et épices de l\'Ouest, cuit 4 heures.', { prep_min: 15, daily_limit: 12, options: [CHILI] }, [['goat', 0.3], ['plantain', 0.3], ['tomato', 0.05]]],
  ['burger', 'mains', 'Burger Ébène', 'Ébène burger', 10000, 'Bœuf haché du jour, cheddar, oignons confits, sauce poivre de Penja, frites maison.', { prep_min: 14, allergens: 'Gluten, Lait, Œuf', options: [DONE, { group: 'Suppléments', multi: true, choices: [{ name: 'Œuf au plat', price: 500 }, { name: 'Bacon', price: 1000 }, { name: 'Double cheddar', price: 500 }] }] }, [['mince', 0.18], ['bun', 1], ['potato', 0.25], ['oil', 0.05]]],
  ['barbraise', 'grill', 'Bar braisé entier', 'Whole grilled sea bass', 15000, 'Bar de Youpwé braisé au feu de bois, marinade ail-gingembre, sauce tomate pimentée.', { tags: 'Signature', prep_min: 22, options: [SIDE, CHILI] }, [['bar', 0.7], ['plantain', 0.3], ['ginger', 0.01], ['tomato', 0.05]]],
  ['entrecote', 'grill', 'Entrecôte grillée 300 g', 'Grilled rib-eye 300 g', 18000, 'Entrecôte maturée, beurre maître d\'hôtel, légumes grillés.', { prep_min: 18, options: [DONE, { group: 'Sauce', choices: [{ name: 'Poivre de Penja' }, { name: 'Béarnaise' }, { name: 'Moambé', price: 500 }] }, { ...SIDE, choices: [{ name: 'Frites maison' }, { name: 'Plantain mûr frit' }, { name: 'Légumes grillés' }] }] }, [['ribeye', 0.3], ['potato', 0.2], ['oil', 0.05]]],
  ['brochettes', 'grill', 'Brochettes de gambas', 'King prawn skewers', 16000, 'Gambas marinées citron vert et piment, riz parfumé.', { allergens: 'Crustacés', prep_min: 14 }, [['shrimp', 0.25], ['rice', 0.1], ['lime', 0.03]]],
  ['poulet', 'grill', 'Demi-poulet braisé', 'Half grilled chicken', 9500, 'Poulet fermier mariné 24 h, braisé, sauce piment vert.', { prep_min: 20, options: [SIDE] }, [['chicken', 0.6], ['plantain', 0.25]]],
  ['frites', 'sides', 'Frites maison', 'Hand-cut fries', 2500, '', {}, [['potato', 0.3], ['oil', 0.05]]], ['plantain', 'sides', 'Plantain mûr frit', 'Fried ripe plantain', 2500, '', {}, [['plantain', 0.35], ['oil', 0.04]]],
  ['miondo', 'sides', 'Miondo (3 bâtons)', 'Miondo (3 sticks)', 1500, '', {}, [['miondo', 3]]],
  ['fondant', 'desserts', 'Fondant au chocolat du Cameroun', 'Cameroon chocolate fondant', 5000, 'Cœur coulant, glace vanille.', { tags: 'Signature', allergens: 'Gluten, Œuf, Lait', prep_min: 10 }, [['choco', 0.05], ['icecream', 0.05]]],
  ['ananas', 'desserts', 'Ananas rôti au caramel de gingembre', 'Roasted pineapple, ginger caramel', 4500, '', {}, [['pineapple', 0.4], ['ginger', 0.01]]],
  ['glace', 'desserts', 'Glaces artisanales (2 boules)', 'Artisan ice cream (2 scoops)', 3500, '', { allergens: 'Lait' }, [['icecream', 0.1]]]]) {
  I[k] = (await post('/api/resto/items', { category_id: C[cat], name, name_en, price, description, ...extra, recipe: recipe.map(([g, qty]) => ({ ingredient_id: G[g], qty })) }));
  I[k].cat = cat;
}
const drinks = ['castel', 'export', 'guinness', 'water', 'coke', 'jusbissap', 'mojito', 'mule', 'spritz', 'virgin', 'wineglass', 'oldfash'];
const drinkW = [5, 4, 2, 4, 2, 3, 3, 2, 2, 1, 2, 1];
const mains = ['ndole', 'dg', 'eru', 'kondre', 'burger', 'barbraise', 'entrecote', 'brochettes', 'poulet'];
const mainW = [6, 6, 2, 2, 3, 6, 3, 2, 3];
const starters = ['avocado', 'accras', 'soya', 'velute'];
const desserts = ['fondant', 'ananas', 'glace'];
const wpick = (list, w) => { const t = w.reduce((a, b) => a + b, 0); let x = rnd() * t; for (let i = 0; i < list.length; i++) { x -= w[i]; if (x <= 0) return list[i]; } return list[0]; };
const optFor = (k) => (I[k].options || []).flatMap((g) => (g.required ? [g.choices[Math.floor(rnd() * g.choices.length)].name] : g.multi ? (chance(0.3) ? [g.choices[0].name] : []) : chance(0.4) ? [pick(g.choices).name] : []));
const line = (k, qty = 1, extra = {}) => ({ product_id: I[k].id, qty, options: optFor(k), ...extra });
function meal(covers, { lunch = false } = {}) {
  const out = [];
  for (let i = 0; i < covers; i++) {
    out.push(line(wpick(drinks, drinkW)));
    if (chance(lunch ? 0.2 : 0.4)) out.push(line(pick(starters)));
    if (chance(0.9)) out.push(line(wpick(mains, mainW)));
    if (chance(0.2)) out.push(line(pick(['frites', 'plantain', 'miondo'])));
    if (chance(lunch ? 0.15 : 0.3)) out.push(line(pick(desserts)));
    if (!lunch && chance(0.45)) out.push(line(wpick(drinks, drinkW)));
  }
  if (!lunch && covers >= 4 && chance(0.25)) out.push(line(chance(0.6) ? 'bordeaux' : 'champagne'));
  return out;
}

// ---------- Loyal guests ----------
const regulars = [];
for (const [name, phone, extra] of [['Me Jacqueline Ndoumbè', '699405060', { vip: 1, preferences: 'Table V1, Saint-Émilion', birthday: '1979-' + addDays(today(), 5).slice(5) }], ['Dr Paul Essomba', '677214365', { allergies: 'Arachides', preferences: 'Terrasse' }],
  ['Famille Kotto', '655123987', { preferences: 'Chaise haute pour bébé' }], ['M. Hervé Tchinda', '690778899', { vip: 1, preferences: 'Champagne bien frais' }], ['Mme Carine Bell', '691556677', {}],
  ['M. Olivier Mbarga', '677889900', { allergies: 'Crustacés' }], ['Mlle Sandrine Ewane', '699887766', {}], ['M. Didier Fotso', '655443322', {}], ['Mme Grace Atangana', '694332211', { vip: 1 }],
  ['M. Kevin Nana', '681223344', {}], ['Mme Florence Mvondo', '675667788', {}], ['M. Serge Ondoa', '696554433', {}]]) {
  const c = await post('/api/resto/customers', { name, phone, ...extra });
  regulars.push(c.partner_id ?? c.id);
}
const corp = (await post('/api/partners', { kind: 'client', name: 'Société Pétrolière du Golfe SA', phone: '233 43 20 00', city: 'Douala' })).id;

// ---------- History: three weeks of service ----------
const dineTables = tables.filter((t) => t.label[0] !== 'B');
const prepOf = (k) => (I[k]?.cat && ['cocktails', 'beers', 'wines'].includes(I[k].cat) ? 3 + Math.floor(rnd() * 4) : (I[k]?.prep_min || 12) + Math.floor(rnd() * 8) - 2);
const COVERS = [34, 20, 22, 26, 32, 52, 60]; // Sunday → Saturday
const reviews = ['Le ndolé est exceptionnel, service attentionné. Nous reviendrons !', 'Bar braisé parfait, ambiance lounge superbe le samedi soir.', 'Très bon dîner d\'affaires, calme et efficace.', 'Cocktails au bissap à tomber.', 'Un peu d\'attente pour les plats ce vendredi, mais tout était délicieux.',
  'Accueil chaleureux d\'Arielle, merci !', 'Payer depuis la table avec MoMo, c\'est top.', 'Entrecôte cuite à la perfection.', 'Bon rapport qualité-prix pour Bonapriso.'];
let stats = { checks: 0, covers: 0 };

async function serveCheck({ date, startMs, durMin, kind = 'dine_in', table, covers, lunch, customer, method, server, comp, voidOne, account }) {
  const moveFrom = db.get('SELECT COALESCE(MAX(id),0) m FROM resto_stock_moves').m;
  const lines = kind === 'dine_in' ? meal(covers, { lunch }) : meal(Math.max(1, covers), { lunch: true }).filter((l) => !['bordeaux', 'champagne', 'wineglass'].includes(Object.keys(I).find((k) => I[k].id === l.product_id)));
  if (!lines.length) lines.push(line('dg'));
  const body = kind === 'dine_in' ? { table_id: table.id, covers, server_id: server, customer_id: customer || undefined, lines, send: true } : { kind, guest_name: pick(['Yannick', 'Mireille', 'Boris', 'Clarisse', 'Stéphane', 'Laure']), phone: `6${Math.floor(70000000 + rnd() * 29999999)}`, address: kind === 'delivery' ? pick(['Bonapriso, rue Tokoto', 'Akwa, boulevard de la Liberté', 'Bonanjo, près de la Poste', 'Deido, carrefour Shell']) : '', server_id: server, lines, send: true };
  let o = await post('/api/resto/orders', body);
  if (voidOne && o.lines.length > 2) { const l = o.lines.find((x) => x.status === 'sent'); if (l) o = await tryIt(() => post(`/api/resto/orders/${o.id}/lines/${l.id}/void`, { reason: pick(['Client a changé d\'avis', 'Erreur de saisie', 'Plat renvoyé']), manager_pin: '2580' })) || o; }
  if (comp) { const l = o.lines.find((x) => x.status !== 'void' && I.fondant && x.product_id !== I.champagne.id); if (l) o = await tryIt(() => put(`/api/resto/orders/${o.id}/lines/${l.id}`, { comp: true, manager_pin: '2580' })) || o; }
  const live = o.lines.filter((l) => l.status !== 'void').map((l) => l.id);
  if (live.length) await post('/api/resto/kitchen/bump', { line_ids: live, status: 'ready' });
  o = await post(`/api/resto/orders/${o.id}/served`, {});
  const due = o.total - o.paid;
  if (due > 0) {
    if (account) await post(`/api/resto/orders/${o.id}/pay`, { method: 'account', partner_id: corp });
    else {
      const tip = chance(0.55) ? Math.round(due * pick([0.05, 0.1, 0.1, 0.15]) / 500) * 500 : 0;
      if (covers >= 4 && chance(0.3) && kind === 'dine_in') {
        const half = Math.ceil(due / 2 / 25) * 25;
        await post(`/api/resto/orders/${o.id}/pay`, { method: 'mtn_momo', amount: half, tip: Math.round(tip / 2), reference: `MP${Math.floor(rnd() * 1e9)}`, payer: 'Siège 1' });
        await post(`/api/resto/orders/${o.id}/pay`, { method: 'cash', amount: due - half, tip: tip - Math.round(tip / 2), tendered: Math.ceil((due - half + tip) / 5000) * 5000, payer: 'Siège 2' });
      } else if (method === 'cash') await post(`/api/resto/orders/${o.id}/pay`, { method, amount: due, tip, tendered: Math.ceil((due + tip) / 5000) * 5000 });
      else await post(`/api/resto/orders/${o.id}/pay`, { method, amount: due, tip, reference: method === 'card' ? '' : `${method === 'mtn_momo' ? 'MP' : 'OM'}${Math.floor(rnd() * 1e9)}` });
    }
  }
  // Move the clock back to when this check really happened.
  const closeMs = startMs + durMin * 60e3;
  for (const l of db.all('SELECT id, product_id, sent_at, ready_at, served_at FROM resto_lines WHERE order_id = ?', o.id)) {
    const k = Object.keys(I).find((x) => I[x].id === l.product_id);
    const sent = startMs + (3 + Math.floor(rnd() * 4)) * 60e3, ready = sent + prepOf(k) * 60e3;
    db.run('UPDATE resto_lines SET created_at = ?, sent_at = CASE WHEN sent_at IS NULL THEN NULL ELSE ? END, ready_at = CASE WHEN ready_at IS NULL THEN NULL ELSE ? END, served_at = CASE WHEN served_at IS NULL THEN NULL ELSE ? END WHERE id = ?',
      iso(startMs + 2 * 60e3), iso(sent), iso(ready), iso(ready + 2 * 60e3), l.id);
  }
  db.run('UPDATE resto_orders SET opened_at = ?, closed_at = CASE WHEN closed_at IS NULL THEN NULL ELSE ? END WHERE id = ?', iso(startMs), iso(closeMs), o.id);
  db.run('UPDATE resto_payments SET at = ? WHERE order_id = ?', iso(closeMs), o.id);
  db.run("UPDATE journal_entries SET date = ? WHERE company_id = ? AND source_type = 'resto_order' AND source_id = ?", date, companyId, o.id);
  db.run('UPDATE resto_stock_moves SET at = ? WHERE id > ? AND company_id = ?', iso(startMs + 5 * 60e3), moveFrom, companyId);
  if (o.document_id || account) { const d = db.get('SELECT document_id FROM resto_orders WHERE id = ?', o.id).document_id; if (d) { db.run('UPDATE documents SET date = ?, due_date = ? WHERE id = ?', date, addDays(date, 30), d); db.run("UPDATE journal_entries SET date = ? WHERE source_type = 'document' AND source_id = ?", date, d); } }
  stats.checks++; stats.covers += covers;
  return o;
}

const t0 = today();
for (let back = 21; back >= 1; back--) {
  const date = addDays(t0, -back);
  const wd = new Date(date + 'T12:00:00Z').getUTCDay();
  const dayStart = Date.parse(date + 'T00:00:00Z');
  const sess = await post('/api/resto/sessions', { opening_float: 30000 });
  let covers = Math.round(COVERS[wd] * (0.85 + rnd() * 0.3) * (back > 14 ? 0.92 : 1));
  const used = new Map();
  const bookTable = (startMs, n) => {
    const free = dineTables.filter((t) => t.seats >= n && (used.get(t.id) || 0) <= startMs);
    return free.length ? free.sort((a, b) => a.seats - b.seats)[Math.floor(rnd() * Math.min(3, free.length))] : null;
  };
  while (covers > 0) {
    const n = Math.min(covers, pick([1, 2, 2, 2, 3, 4, 4, 5, 6]));
    covers -= n;
    const lunch = chance(0.3);
    const hourLocal = lunch ? 12 + rnd() * 2.2 : 19 + rnd() * 3.2;
    const startMs = dayStart + (hourLocal - 1) * 3600e3; // Douala is UTC+1
    const table = bookTable(startMs, n); if (!table) continue;
    const dur = lunch ? 45 + Math.floor(rnd() * 30) : 70 + Math.floor(rnd() * 70);
    used.set(table.id, startMs + dur * 60e3);
    const earlyRegular = back > 15 ? regulars.slice(0, 3) : regulars.slice(3);
    const customer = chance(0.22) ? pick(back > 15 ? regulars : earlyRegular) : null;
    const method = wpick(['cash', 'mtn_momo', 'orange_money', 'card'], [4, 4, 2, 2]);
    const server = servers[Math.floor(rnd() * (wd === 5 || wd === 6 ? 3 : 2))];
    const o = await tryIt(() => serveCheck({ date, startMs, durMin: dur, table, covers: n, lunch, customer, method, server, comp: chance(0.03), voidOne: chance(0.04), account: back === 3 && n >= 4 && !stats.acc && (stats.acc = true) }));
    if (o && chance(0.28)) {
      const r = chance(0.08) ? 2 : chance(0.2) ? 4 : 5;
      db.run('INSERT INTO resto_feedback (company_id, order_id, rating, food, service, ambiance, comment, at) VALUES (?,?,?,?,?,?,?,?)', companyId, o.id, r, Math.min(5, r + (chance(0.3) ? 0 : 0)), r, Math.max(3, r), chance(0.6) ? pick(reviews) : '', iso(startMs + (dur + 20) * 60e3));
    }
  }
  // Takeaway and delivery
  for (let i = 0; i < 3 + Math.floor(rnd() * 4); i++) {
    const startMs = dayStart + (chance(0.5) ? 11.5 + rnd() * 2.5 : 18.5 + rnd() * 3) * 3600e3 - 3600e3;
    await tryIt(() => serveCheck({ date, startMs, durMin: 35, kind: chance(0.55) ? 'delivery' : 'takeaway', covers: 1 + Math.floor(rnd() * 3), method: wpick(['cash', 'mtn_momo', 'orange_money'], [3, 4, 2]), server: servers[0] }));
  }
  // Paid-outs and cash-up
  if (chance(0.4)) await tryIt(() => post('/api/resto/cash-moves', { kind: 'out', amount: pick([3500, 6000, 12500]), reason: pick(['Achat au marché (citrons, menthe)', 'Gaz de cuisine', 'Transport livreur']) }));
  const sum = await get('/api/resto/sessions/current');
  const variance = back === 6 ? -2000 : back === 13 ? 500 : 0;
  await post(`/api/resto/sessions/${sess.id}/close`, { counted_cash: sum.cash.expected + variance, force: true, note: variance ? 'Recompté deux fois' : '' });
  db.run('UPDATE resto_sessions SET opened_at = ?, closed_at = ? WHERE id = ?', iso(dayStart + 10 * 3600e3), iso(dayStart + 22.9 * 3600e3), sess.id);
  db.run("UPDATE journal_entries SET date = ? WHERE company_id = ? AND source_type IN ('resto_session','resto_cash') AND source_id = ?", date, companyId, sess.id);
  db.run("UPDATE resto_cash_moves SET at = ? WHERE session_id = ?", iso(dayStart + 15 * 3600e3), sess.id);
  if (back % 7 === 0) await tryIt(() => post('/api/resto/stock/receive', { supplier_id: sup.fish, reference: `BL-${date}`, lines: [{ ingredient_id: G.shrimp, qty: 6 }, { ingredient_id: G.bar, qty: 12, unit_cost: 5400 }] }));
}
// Loyalty "last visit" follows the backdated checks.
db.run("UPDATE resto_customers SET last_visit = (SELECT MAX(closed_at) FROM resto_orders o WHERE o.customer_id = resto_customers.partner_id AND o.status = 'paid') WHERE company_id = ?", companyId);
db.run("UPDATE resto_stock_moves SET at = ? WHERE company_id = ? AND kind = 'receipt' AND at > ?", iso(Date.parse(addDays(t0, -1) + 'T07:00:00Z')), companyId, iso(Date.parse(t0 + 'T00:00:00Z')));

// ---------- Today: a live service ----------
const nowMs = Date.now();
const todayStart = Date.parse(t0 + 'T00:00:00Z');
await post('/api/resto/sessions', { opening_float: 30000 });
const earlier = [];
for (let i = 0; i < 9; i++) {
  const startMs = Math.max(todayStart + 30 * 60e3, nowMs - (60 + i * 25) * 60e3);
  earlier.push(await tryIt(() => serveCheck({ date: t0, startMs, durMin: 50, table: dineTables[(i * 5) % dineTables.length], covers: pick([2, 2, 3, 4]), lunch: true, method: wpick(['cash', 'mtn_momo', 'card'], [3, 4, 2]), server: servers[i % 3], customer: i === 2 ? regulars[4] : null })));
}
for (const o of earlier.filter(Boolean).slice(0, 3)) db.run('INSERT INTO resto_feedback (company_id, order_id, rating, food, service, ambiance, comment, at) VALUES (?,?,?,?,?,?,?,?)', companyId, o.id, 5, 5, 5, 5, pick(reviews), now());

const T = Object.fromEntries(tables.map((t) => [t.label, t]));
const openLive = async (label, covers, server, ageMin, opts = {}) => {
  const o = await post('/api/resto/orders', { table_id: T[label].id, covers, server_id: server, customer_id: opts.customer, guest_name: opts.name, lines: opts.lines || meal(covers), send: true, hold_courses: !!opts.hold });
  db.run('UPDATE resto_orders SET opened_at = ? WHERE id = ?', iso(nowMs - ageMin * 60e3), o.id);
  db.run('UPDATE resto_lines SET created_at = ?, sent_at = CASE WHEN sent_at IS NULL THEN NULL ELSE ? END WHERE order_id = ?', iso(nowMs - (ageMin - 1) * 60e3), iso(nowMs - Math.max(1, ageMin - 3) * 60e3), o.id);
  return post('/api/resto/orders/' + o.id + '/send', {}).catch(() => get(`/api/resto/orders/${o.id}`)).then(() => get(`/api/resto/orders/${o.id}`));
};
const bumpWhere = async (o, test, status) => { const ids = o.lines.filter(test).map((l) => l.id); if (ids.length) await post('/api/resto/kitchen/bump', { line_ids: ids, status }); };
const isDrink = (l) => ['cocktails', 'beers', 'wines'].includes(I[Object.keys(I).find((k) => I[k].id === l.product_id)]?.cat);
// T2: just seated, everything in the kitchen. T6: drinks served, mains cooking (one late).
const o1 = await openLive('T2', 2, servers[0], 6);
const o2 = await openLive('T6', 4, servers[1], 32, { customer: regulars[1] });
await bumpWhere(o2, isDrink, 'served'); await bumpWhere(o2, (l) => !isDrink(l) && l.course === 1, 'ready');
await bumpWhere(o2, (l) => !isDrink(l) && l.course >= 2, 'preparing');
// V1: VIP table with champagne, starters served, mains held until the waiter fires them.
const o3 = await post('/api/resto/orders', { table_id: T.V1.id, covers: 6, server_id: servers[0], customer_id: regulars[0], lines: [line('champagne'), line('avocado', 2), line('soya', 2), line('accras', 2), line('ndole', 2), line('barbraise', 2), line('entrecote', 2), line('water', 2)], send: true, hold_courses: true });
db.run('UPDATE resto_orders SET opened_at = ? WHERE id = ?', iso(nowMs - 41 * 60e3), o3.id);
db.run("UPDATE resto_lines SET sent_at = ? WHERE order_id = ? AND sent_at IS NOT NULL", iso(nowMs - 38 * 60e3), o3.id);
await bumpWhere(o3, (l) => l.status === 'sent', 'served');
// P3: food ready to pick up. T9: bill printed. T11: big table, mixed progress.
const o4 = await openLive('P3', 3, servers[2], 27);
await bumpWhere(o4, () => true, 'ready');
const o5 = await openLive('T9', 2, servers[1], 74);
await bumpWhere(o5, () => true, 'served');
await tryIt(() => call('GET', `/api/resto/orders/${o5.id}/bill`));
const o6 = await openLive('T11', 6, servers[2], 19);
await bumpWhere(o6, isDrink, 'ready'); await bumpWhere(o6, (l) => !isDrink(l), 'preparing');
db.run("UPDATE resto_lines SET sent_at = ? WHERE order_id = ? AND status = 'preparing'", iso(nowMs - 24 * 60e3), o6.id);
const o7 = await openLive('B2', 2, servers[0], 12, { lines: [line('mojito'), line('oldfash'), line('accras')] });
await bumpWhere(o7, isDrink, 'served');
// Guests at P5 ordered from the QR code; T4 is calling the waiter; T9 wants the bill.
await tryIt(() => guest(`/api/public/resto/table/${T.P5.qr_token}/order`, { covers: 2, name: 'Clarisse', lines: [line('spritz'), line('jusbissap'), line('brochettes'), line('dg')] }));
const o8 = await openLive('T4', 2, servers[1], 15);
await tryIt(() => guest(`/api/public/resto/table/${T.T4.qr_token}/call`, { kind: 'waiter' }));
await tryIt(() => guest(`/api/public/resto/table/${T.T9.qr_token}/call`, { kind: 'bill' }));
// Online orders
for (const [k, name, phone, address, ls] of [['delivery', 'Stéphane Moukoko', '677001122', 'Bonapriso, rue Tokoto, immeuble Bleu, 3e étage', [line('ndole'), line('poulet'), line('jusbissap', 2)]],
  ['takeaway', 'Laure Njoh', '699002233', '', [line('burger'), line('frites'), line('coke')]], ['delivery', 'Boris Fouda', '655003344', 'Akwa, rue Joffre, face pharmacie du Centre', [line('dg', 2), line('plantain'), line('fondant', 2)]]]) {
  const r = await tryIt(() => guest('/api/public/resto/online-order', { c: companyId, kind: k, name, phone, address, pickup_time: '', lines: ls }));
  if (r && k === 'delivery' && name.startsWith('Boris')) { const o = db.get('SELECT id FROM resto_orders WHERE token = ?', r.token); const full = await get(`/api/resto/orders/${o.id}`); await bumpWhere(full, () => true, 'preparing'); }
}
// Tonight's and upcoming bookings
const hh = (m) => { const local = new Date(nowMs + 3600e3 + m * 60e3); return `${String(local.getUTCHours()).padStart(2, '0')}:${String(Math.floor(local.getUTCMinutes() / 15) * 15).padStart(2, '0')}`; };
const sameDay = (m) => new Date(nowMs + 3600e3 + m * 60e3).toISOString().slice(0, 10) === new Date(nowMs + 3600e3).toISOString().slice(0, 10);
for (const [m, name, phone, covers, table, occasion, note] of [[30, 'M. et Mme Tchinda', '690778899', 2, 'V3', 'Anniversaire de mariage', 'Bougie sur le dessert'], [45, 'Dr Essomba et invités', '677214365', 4, 'P4', 'Repas d\'affaires', ''],
  [75, 'Famille Kotto', '655123987', 5, 'T5', 'Famille', 'Chaise haute'], [90, 'Mme Grace Atangana', '694332211', 2, '', '', 'Terrasse si possible'], [120, 'Groupe Orange Business', '699555111', 8, 'P6', 'Afterwork', '']]) {
  if (!sameDay(m)) continue;
  await tryIt(() => post('/api/resto/reservations', { name, phone, covers, date: new Date(nowMs + 3600e3).toISOString().slice(0, 10), time: hh(m), table_id: table ? T[table].id : null, occasion, note }));
}
await tryIt(() => post('/api/resto/reservations', { name: 'M. Kevin Nana', phone: '681223344', covers: 3, waitlist: true }));
await tryIt(() => post('/api/resto/reservations', { name: 'Mlle Ewane', phone: '699887766', covers: 2, waitlist: true }));
for (let d = 1; d <= 6; d++) for (let i = 0; i < 2 + Math.floor(rnd() * 5); i++) {
  await tryIt(() => post('/api/resto/reservations', { name: pick(['M. Abena', 'Mme Ngo Nlend', 'M. Tagne', 'Mme Ekwalla', 'M. Biya Essono', 'Mme Fokou', 'M. Djeumo', 'Mme Sone']), phone: `69${Math.floor(1000000 + rnd() * 8999999)}`,
    covers: pick([2, 2, 3, 4, 6]), date: addDays(t0, d), time: pick(['12:30', '13:00', '19:30', '20:00', '20:30', '21:00']), occasion: chance(0.2) ? pick(['Anniversaire', 'Repas d\'affaires']) : '' }));
}
// This morning's stock count: a few items fall under their minimum so the purchase plan has work to do.
const ings = await get('/api/resto/ingredients');
await post('/api/resto/stock/count', { counts: ings.map((g, i) => ({ ingredient_id: g.id, counted: ((v) => (['u', 'btl'].includes(g.unit) ? Math.round(v) : Math.round(v * 10) / 10))(g.min_stock * (i % 6 === 0 ? 0.6 : i % 4 === 0 ? 1.2 : 1.6 + rnd() * 2)) })) });
db.run("UPDATE resto_stock_moves SET at = ? WHERE company_id = ? AND kind = 'count'", iso(Math.min(nowMs - 3600e3, Date.parse(t0 + 'T07:00:00Z'))), companyId);
await tryIt(() => post('/api/resto/stock/receive', { supplier_id: sup.drinks, reference: 'BL SABC 88213', create_bill: true, lines: [{ ingredient_id: G.castel, qty: 48 }, { ingredient_id: G.export33, qty: 48 }, { ingredient_id: G.water, qty: 36 }] }));
await post('/api/resto/stock/adjust', { ingredient_id: G.bar, kind: 'waste', qty: 0.8, note: 'Poisson non conforme à la livraison' });

const d = await get('/api/resto/dashboard');
console.log(`Demo restaurant ready: ${email} / ${password} · ${tables.length} tables, ${Object.keys(I).length} dishes, ${stats.checks} checks (${stats.covers} covers) over 3 weeks, ${d.tables.busy} tables seated now`);
console.log('Staff: serveur@, serveur2@, serveur3@, chef@, bar@, gerant@, caisse@, compta@teknons.cm (same password) · manager code 2580');
app.server.close();
process.exit(0);
