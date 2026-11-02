// Creates a demo 5-star hotel in Douala for Teknons Hôtel: 41 rooms in four
// categories, rate plans and seasons, restaurant, bars, room service, spa,
// laundry and transfers with their menus, staff accounts, VIP and corporate
// guests, two weeks of history (stays, consumptions, night audits) and a live
// day: guests in house, arrivals and departures, kitchen orders, spa,
// concierge requests, maintenance and reviews.
//   MODULES=hotel DATA_DIR=./data node scripts/seed-hotel.mjs   → demo@teknons.cm / demo1234
// Goes through the real HTTP API, so folios, invoices and accounting stay consistent.
import path from 'node:path';
import { createApp } from '../app.js';
import { createCompany } from '../core/routes.js';
import { hashPassword } from '../core/auth.js';
import { now, today } from '../core/schema.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const env = { ...process.env, MODULES: process.env.MODULES || 'hotel', MOMO_MODE: process.env.MOMO_MODE || 'simulation' };
const app = createApp({ dbFile: path.join(dataDir, 'teknons.db'), env, jobs: false });
const { db, modules } = app;
const email = process.env.DEMO_EMAIL || 'demo@teknons.cm';
const password = process.env.DEMO_PASSWORD || 'demo1234';
if (db.get('SELECT id FROM users WHERE email = ?', email)) { console.log('Demo company already exists:', email); process.exit(0); }

const { companyId } = createCompany(db, modules, { company: 'Palais des Palmiers', name: 'Franck Demo', email, password, phone: '673799674' });
db.run(`UPDATE companies SET legal_form = 'SA', niu = 'M112233445566P', rccm = 'RC/DLA/2016/B/2280', address = 'Boulevard de la République, Bonanjo', city = 'Douala',
  phone = '+237 673 799 674', website = 'palaisdespalmiers.cm', momo_number = '673 799 674', om_number = '691 23 45 67',
  invoice_footer = 'Palais des Palmiers Douala SA · NIU M112233445566P · Bonanjo, Douala · Merci de votre séjour' WHERE id = ?`, companyId);
const staff = [['Estelle Réception', 'reception@teknons.cm', 'receptionist'], ['Patrick Réception nuit', 'nuit@teknons.cm', 'receptionist'], ['Mireille Gouvernante', 'menage@teknons.cm', 'housekeeper'],
  ['Joseph Femme de chambre', 'menage2@teknons.cm', 'housekeeper'], ['Arnaud Maître d\'hôtel', 'bar@teknons.cm', 'waiter'], ['Carine Spa', 'spa@teknons.cm', 'waiter'],
  ['Nadège Directrice', 'gerant@teknons.cm', 'manager'], ['Aline Comptable', 'compta@teknons.cm', 'accountant']];
for (const [name, mail, role] of staff) db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)', companyId, name, mail, hashPassword(password), role, now());

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
const tryIt = async (fn) => { try { return await fn(); } catch (e) { if (process.env.DEBUG) console.warn(e.message); return null; } };
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

await post('/api/auth/login', { email, password });
let meta = await get('/api/hotel/meta');
await put('/api/hotel/settings', { stars: 5, checkin_time: '14:00', checkout_time: '12:00', tourist_tax: 1000, tourist_tax_mode: 'room', breakfast_price: 15000, deposit_pct: 30, late_checkout_fee: 35000,
  audit_hour: 4, eur_rate: 655.957, usd_rate: 600, points_per_1000: 1, wifi_name: 'Palmiers-Guest', wifi_password: 'Bienvenue2026', manager_pin: '2580',
  welcome_text: 'Bienvenue au Palais des Palmiers. Toute notre équipe est à votre service, jour et nuit : commandez, réservez le spa ou demandez ce qu\'il vous faut depuis cette page.' });

// ---------- Rooms ----------
const T = {};
for (const [code, name, capacity, base_rate, weekend_rate, day_use_rate, amenities, description, position] of [
  ['DLX', 'Chambre Deluxe', 2, 95000, 105000, 55000, 'Lit king size ou deux lits, 32 m², douche à l\'italienne, Nespresso, coffre-fort, TV 55", Wi-Fi fibre', 'Une chambre lumineuse et apaisante, parfaite pour les séjours d\'affaires comme de loisirs.', 1],
  ['EXE', 'Chambre Executive', 2, 140000, 150000, 80000, 'Lit king size, 40 m², vue sur le Wouri, accès Executive Lounge, bureau, baignoire, peignoirs', 'Étages élevés avec vue sur le fleuve et accès au salon Executive (petit-déjeuner, cocktails du soir).', 2],
  ['JRS', 'Suite Junior', 3, 220000, 230000, 0, 'Salon séparé, 60 m², baignoire et douche, minibar offert, majordome sur demande, vue panoramique', 'L\'espace et le calme d\'une suite, avec un salon pour recevoir ou travailler.', 3],
  ['PRS', 'Suite Présidentielle', 4, 650000, 650000, 0, '180 m², deux chambres, salle à manger, terrasse privée, majordome 24 h/24, transfert aéroport en berline offert', 'Notre adresse la plus exclusive, pour les chefs d\'État, dirigeants et grandes occasions.', 4]]) {
  T[code] = await post('/api/hotel/room-types', { code, name, capacity, base_rate, weekend_rate, day_use_rate, extra_person: 20000, amenities, description, position, online: 1 });
}
await post('/api/hotel/rooms', { type_id: T.DLX.id, from: 101, to: 112, view: 'Jardin' });
await post('/api/hotel/rooms', { type_id: T.DLX.id, from: 201, to: 212, view: 'Piscine' });
await post('/api/hotel/rooms', { type_id: T.EXE.id, from: 301, to: 312, view: 'Fleuve Wouri' });
await post('/api/hotel/rooms', { type_id: T.JRS.id, from: 401, to: 404, view: 'Panoramique' });
await post('/api/hotel/rooms', { type_id: T.PRS.id, number: '500', view: 'Panoramique', floor: '5' });

// ---------- Corporate clients, rate plans, seasons ----------
const corp = {};
for (const [k, name, phone] of [['petro', 'Société Pétrolière du Golfe SA', '233 43 20 00'], ['banque', 'Banque Atlantique Centrale', '233 42 55 10'], ['cabinet', 'Cabinet Ndoumbè & Associés', '699 40 50 60'], ['ong', 'ONG Santé Pour Tous', '677 21 43 65']]) {
  corp[k] = (await post('/api/partners', { kind: 'client', name, phone, city: 'Douala' })).id;
}
const plans = Object.fromEntries((await get('/api/hotel/meta')).plans.map((p) => [p.code, p]));
await put(`/api/hotel/rate-plans/${plans.BB.id}`, { adjust_pct: 0 });
plans.NR = await post('/api/hotel/rate-plans', { code: 'NR', name: 'Offre non remboursable -12 %', adjust_pct: -12, refundable: 0, online: 1 });
plans.LS = await post('/api/hotel/rate-plans', { code: 'LS', name: 'Long séjour (5 nuits et +) -18 %', adjust_pct: -18, min_nights: 5, breakfast: 1, online: 1 });
plans.CORP = await post('/api/hotel/rate-plans', { code: 'CORP', name: 'Tarif entreprise SPG -15 %', adjust_pct: -15, breakfast: 1, partner_id: corp.petro });
plans.BANK = await post('/api/hotel/rate-plans', { code: 'BAC', name: 'Tarif Banque Atlantique -10 %', adjust_pct: -10, partner_id: corp.banque });
const y = today().slice(0, 4);
await post('/api/hotel/seasons', { name: 'Fêtes de fin d\'année', date_from: `${y}-12-18`, date_to: `${Number(y) + 1}-01-03`, adjust_pct: 20 });
await post('/api/hotel/seasons', { name: 'Salon international (forte demande)', date_from: addDays(today(), 9), date_to: addDays(today(), 12), adjust_pct: 15 });

// ---------- Outlets & menus ----------
meta = await get('/api/hotel/meta');
const O = Object.fromEntries(meta.outlets.map((o) => [o.code, o]));
await put(`/api/hotel/outlets/${O.REST.id}`, { name: 'Restaurant Le Wouri' });
await put(`/api/hotel/outlets/${O.BAR.id}`, { name: 'Bar Le Baobab' });
const rooftop = await post('/api/hotel/outlets', { kind: 'bar', name: 'Rooftop Lounge', code: 'ROOF', kitchen: 1 });
const events = await post('/api/hotel/outlets', { kind: 'events', name: 'Salles de réunion et événements', code: 'EVT' });
const I = {};
const item = async (key, outlet, category, name, price, extra = {}) => { I[key] = await post('/api/hotel/items', { outlet_id: outlet, category, name, price, portal: 1, ...extra }); };
for (const [k, c, n, p, d] of [
  ['ndole', 'Plats', 'Ndolé aux crevettes, plantains mûrs', 14000, 'Spécialité de la maison'], ['dg', 'Plats', 'Poulet DG', 12000, 'Poulet fermier, plantains, légumes croquants'],
  ['bar_fish', 'Plats', 'Bar braisé, miondo et sauce pimentée', 16000, 'Poisson du jour, braisé au feu de bois'], ['filet', 'Plats', 'Filet de bœuf, sauce au poivre de Penja', 22000, 'Poivre blanc IGP de Penja'],
  ['caesar', 'Entrées', 'Salade César aux gambas', 9000, ''], ['velo', 'Entrées', 'Velouté de potiron au gingembre', 6500, ''],
  ['tiramisu', 'Desserts', 'Tiramisu au café de l\'Ouest', 6000, ''], ['fondant', 'Desserts', 'Fondant au chocolat camerounais', 6500, 'Cacao grand cru de la Sanaga'],
  ['buffet', 'Petit-déjeuner', 'Petit-déjeuner buffet', 15000, 'Viennoiseries, fruits, beignets-haricots, omelettes minute']]) await item(k, O.REST.id, c, n, p, { description: d });
for (const [k, c, n, p] of [['club', 'Snacks', 'Club sandwich, frites maison', 10000], ['burger', 'Snacks', 'Burger du Palais, cheddar, frites', 12000], ['omelette', 'Snacks', 'Omelette aux fines herbes', 6000],
  ['fruits', 'Douceurs', 'Assiette de fruits tropicaux', 6000], ['rs_ndole', 'Plats', 'Ndolé aux crevettes', 15000], ['rs_brk', 'Petit-déjeuner', 'Petit-déjeuner continental en chambre', 17000]]) await item(k, O.RS.id, c, n, p);
for (const [k, c, n, p] of [['beer', 'Bières', 'Bière locale 65 cl', 3000], ['soda', 'Softs', 'Soda', 2000], ['water', 'Softs', 'Eau minérale 1,5 L', 2000], ['juice', 'Softs', 'Jus frais (ananas, gingembre, bissap)', 4000],
  ['mojito', 'Cocktails', 'Mojito', 7000], ['palmier', 'Cocktails', 'Le Palmier (cocktail signature)', 9000], ['whisky', 'Spiritueux', 'Whisky 12 ans (4 cl)', 9000],
  ['wine', 'Vins', 'Vin rouge, verre', 7000], ['champ', 'Vins', 'Champagne brut, bouteille', 95000]]) await item(k, O.BAR.id, c, n, p);
for (const [k, c, n, p] of [['r_cocktail', 'Cocktails', 'Spritz du Rooftop', 8000], ['r_tapas', 'À partager', 'Plateau de tapas africains', 15000], ['r_champ', 'Bulles', 'Coupe de champagne', 12000]]) await item(k, rooftop.id, c, n, p);
for (const [k, n, p] of [['m_water', 'Eau minérale 50 cl', 1500], ['m_soda', 'Soda 33 cl', 2000], ['m_beer', 'Bière 33 cl', 3000], ['m_chips', 'Chips de plantain', 2500], ['m_choc', 'Chocolat', 3000], ['m_nuts', 'Noix de cajou', 3500]]) await item(k, O.MINI.id, 'Minibar', n, p, { portal: 0 });
for (const [k, n, p] of [['shirt', 'Chemise', 3000], ['trousers', 'Pantalon', 3500], ['suit', 'Costume (nettoyage à sec)', 9000], ['dress', 'Robe', 5000], ['express', 'Supplément express (3 h)', 5000]]) await item(k, O.LAV.id, 'Blanchisserie', n, p);
for (const [k, n, p, duration, d] of [['massage', 'Massage relaxant', 35000, 60, 'Huiles de karité et coco'], ['stones', 'Massage aux pierres chaudes', 50000, 90, ''], ['facial', 'Soin du visage éclat', 30000, 60, ''],
  ['hammam', 'Hammam et gommage', 22000, 45, ''], ['coach', 'Séance avec coach privé', 25000, 60, 'Salle de sport ou bord de piscine']]) await item(k, O.SPA.id, 'Soins', n, p, { duration, description: d });
for (const [k, n, p] of [['airport', 'Transfert aéroport en berline', 25000], ['driver', 'Voiture avec chauffeur (journée)', 95000], ['tour', 'Visite guidée de Douala (demi-journée)', 40000]]) await item(k, O.TRANS.id, 'Transport', n, p);
for (const [k, n, p] of [['room_half', 'Salle Sanaga, demi-journée', 250000], ['coffee', 'Pause-café par personne', 6000]]) await item(k, events.id, 'Séminaires', n, p, { portal: 0 });

// ---------- Guests ----------
const nat = ['Camerounaise', 'Camerounaise', 'Camerounaise', 'Française', 'Nigériane', 'Gabonaise', 'Américaine', 'Chinoise', 'Ivoirienne', 'Britannique', 'Tchadienne', 'Allemande'];
const first = ['Jean-Paul', 'Christelle', 'Samuel', 'Marie-Claire', 'Olivier', 'Fatima', 'Thierry', 'Aïcha', 'David', 'Sandrine', 'Emmanuel', 'Grace', 'Pierre', 'Laura', 'Michael', 'Wei', 'Hervé', 'Nadia', 'Yannick', 'Esther', 'Koffi', 'Sophie', 'Bertrand', 'Linda'];
const last = ['Mbarga', 'Ngo Bassa', 'Etoundi', 'Dupont', 'Okafor', 'Moussa', 'Kamga', 'Ndiaye', 'Smith', 'Fotso', 'Nkoulou', 'Abena', 'Martin', 'Tchoumi', 'Johnson', 'Zhang', 'Essomba', 'Bello', 'Manga', 'Ewane', 'Kouassi', 'Lefèvre', 'Atangana', 'Nana'];
let gi = 0;
const guest = (o = {}) => {
  const i = gi++;
  const n = nat[i % nat.length];
  return { name: `${first[i % first.length]} ${last[(i * 7) % last.length]}`, phone: `6${String(70000000 + i * 1234567).slice(0, 8)}`, nationality: n, id_type: n === 'Camerounaise' ? 'CNI' : 'Passeport',
    id_number: `${n === 'Camerounaise' ? '1' : 'P'}${String(10000000 + i * 7919).slice(0, 8)}`, profession: pick(['Ingénieur', 'Directrice commerciale', 'Consultant', 'Médecin', 'Avocate', 'Banquier', 'Entrepreneur', 'Diplomate', 'Architecte']),
    birth_date: `${1965 + (i % 30)}-0${1 + (i % 9)}-1${i % 9}`, birth_place: pick(['Douala', 'Yaoundé', 'Paris', 'Lagos', 'Libreville', 'Bafoussam', 'Abidjan', 'Londres']), coming_from: pick(['Yaoundé', 'Paris', 'Lagos', 'Libreville', 'Bruxelles', 'Abidjan', 'Kribi']), ...o };
};
const vipGuests = [
  guest({ name: 'S.E. Dr Albert Nkodo', vip: 2, preferences: 'Suite au calme, journaux Cameroon Tribune et Le Monde, eau gazeuse, oreillers fermes', profession: 'Ambassadeur' }),
  guest({ name: 'Mme Josiane Ekambi', vip: 1, preferences: 'Étage élevé, thé vert au réveil', allergies: 'Arachides', profession: 'Directrice générale' }),
  guest({ name: 'Mr Richard Whitmore', vip: 1, nationality: 'Britannique', id_type: 'Passeport', preferences: 'Late check-out when possible, gym at 6am', profession: 'Investment banker' }),
];

// ---------- Two weeks of history ----------
const start = addDays(today(), -14);
db.run('UPDATE hotel_settings SET business_date = ? WHERE company_id = ?', start, companyId);
meta = await get('/api/hotel/meta');
const sources = ['direct', 'direct', 'phone', 'whatsapp', 'booking', 'booking', 'expedia', 'web', 'agency', 'walk_in', 'corporate'];
const typeMix = ['DLX', 'DLX', 'DLX', 'DLX', 'EXE', 'EXE', 'EXE', 'JRS'];
const created = [];
async function book(arrival, nights, o = {}) {
  const tcode = o.type || pick(typeMix);
  const corpStay = !o.plan && rnd() < 0.15;
  const plan = o.plan || (corpStay ? plans.CORP : nights >= 5 && rnd() < 0.5 ? plans.LS : pick([plans.BAR, plans.BB, plans.BB, plans.NR]));
  const g = o.guest || guest();
  const body = { ...g, room_type_id: T[tcode].id, rate_plan_id: plan.id, arrival, departure: addDays(arrival, nights), adults: o.adults || (rnd() < 0.55 ? 2 : 1), source: o.source || (corpStay ? 'corporate' : pick(sources)),
    bill_to_id: corpStay || plan === plans.CORP ? corp.petro : o.bill_to_id, eta: pick(['13:00', '15:30', '18:00', '21:00', '']), status: 'confirmed', special_requests: o.special_requests || '', group_name: o.group_name, rooms: o.rooms };
  const r = await tryIt(() => post('/api/hotel/bookings', body));
  if (r) created.push(...r.ids);
  return r;
}
const pay = (id, amount, method) => (amount > 0 ? tryIt(() => post(`/api/hotel/bookings/${id}/payments`, { method: method || pick(['cash', 'card', 'card', 'mtn_momo', 'orange_money', 'bank']), amount, reference: `${1000 + Math.floor(rnd() * 9000)}` })) : null);
const items = await get('/api/hotel/items');
const of = (outlet) => items.filter((i) => i.outlet_id === outlet);

for (let d = 0; d < 14; d++) {
  const day = addDays(start, d);
  // New bookings arriving today (and a few future ones made today)
  const n = 5 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) await book(day, 2 + Math.floor(rnd() * 4));
  if (d === 2) await book(day, 4, { guest: vipGuests[1], type: 'JRS', plan: plans.BB, source: 'direct' });
  if (d === 5) await book(day, 3, { type: 'DLX', rooms: 4, group_name: 'Séminaire Banque Atlantique', plan: plans.BANK, bill_to_id: corp.banque, source: 'corporate', guest: guest({ name: 'Délégation Banque Atlantique' }) });
  // Morning: housekeeping cleans yesterday's departures and stayovers
  const board = await get('/api/hotel/rooms/board');
  for (const r of board.rooms.filter((x) => x.hk_status !== 'clean' && x.hk_status !== 'inspected')) await tryIt(() => put(`/api/hotel/rooms/${r.id}/status`, { hk_status: rnd() < 0.3 ? 'inspected' : 'clean' }));
  // Departures: settle and check out
  for (const b of await get('/api/hotel/bookings?status=in_house')) {
    if (b.departure > day) continue;
    const full = await get(`/api/hotel/bookings/${b.id}`);
    if (full.booking.bill_to_id === full.booking.guest_id) await pay(b.id, full.booking.balance);
    await tryIt(() => post(`/api/hotel/bookings/${b.id}/check-out`, {}));
  }
  // Arrivals: deposits for some, check-in with ID, key cards
  for (const b of await get(`/api/hotel/bookings?status=confirmed,tentative&arrival=${day}`)) {
    if (rnd() < 0.08) { await tryIt(() => post(`/api/hotel/bookings/${b.id}/no-show`, { reason: 'Client non venu' })); continue; }
    if (rnd() < 0.5) await pay(b.id, Math.round(b.charges || 50000), 'mtn_momo');
    const ci = await tryIt(() => post(`/api/hotel/bookings/${b.id}/check-in`, { guest: { id_number: `ID${b.id}${Math.floor(rnd() * 1e6)}` }, force_dirty: true }));
    if (ci) await tryIt(() => post(`/api/hotel/bookings/${b.id}/keys`, { copies: Math.min(2, b.adults), access: ['pool', 'gym', 'lift'] }));
  }
  // Life of the hotel: restaurant, bar, room service, spa, minibar, laundry
  const inHouse = await get('/api/hotel/in-house');
  for (const s of inHouse) {
    if (rnd() < 0.45) await tryIt(() => post('/api/hotel/orders', { outlet_id: O.REST.id, booking_id: s.id, covers: 2, table_label: `T${1 + Math.floor(rnd() * 20)}`, lines: [{ product_id: pick(of(O.REST.id)).id, qty: 2 }, { product_id: I.wine.id, qty: 2 }], settle: 'room' }));
    if (rnd() < 0.35) await tryIt(() => post('/api/hotel/orders', { outlet_id: O.BAR.id, booking_id: s.id, lines: [{ product_id: pick(of(O.BAR.id)).id, qty: 1 + Math.floor(rnd() * 3) }], settle: 'room' }));
    if (rnd() < 0.2) await tryIt(() => post('/api/hotel/orders', { outlet_id: O.RS.id, booking_id: s.id, lines: [{ product_id: pick(of(O.RS.id)).id, qty: 1 }], settle: 'room' }));
    if (rnd() < 0.15) await tryIt(() => post('/api/hotel/orders', { outlet_id: O.LAV.id, booking_id: s.id, lines: [{ product_id: I.shirt.id, qty: 3 }, { product_id: I.trousers.id, qty: 1 }], settle: 'room' }));
    if (rnd() < 0.12) {
      const ap = await tryIt(() => post('/api/hotel/appointments', { product_id: pick([I.massage, I.stones, I.facial, I.hammam]).id, booking_id: s.id, staff: pick(['Carine', 'Bérénice', 'Awa']), start_at: `${day}T${pick(['10', '11', '15', '16', '17'])}:00` }));
      if (ap) await tryIt(() => put(`/api/hotel/appointments/${ap.id}`, { status: 'done' }));
    }
    if (rnd() < 0.15) { const room = meta.rooms.find((r) => r.number === s.room_number); if (room) await tryIt(() => post(`/api/hotel/rooms/${room.id}/minibar`, { lines: [{ product_id: I.m_water.id, qty: 2 }, { product_id: pick([I.m_soda, I.m_beer, I.m_chips]).id, qty: 1 }] })); }
  }
  for (let i = 0; i < 4 + Math.floor(rnd() * 6); i++) await tryIt(() => post('/api/hotel/orders', { outlet_id: pick([O.BAR.id, O.REST.id, rooftop.id]), table_label: `T${1 + Math.floor(rnd() * 20)}`, lines: [{ product_id: pick([I.beer, I.mojito, I.palmier, I.r_cocktail, I.dg, I.ndole, I.juice]).id, qty: 1 + Math.floor(rnd() * 3) }], settle: 'paid', method: pick(['cash', 'card', 'mtn_momo', 'orange_money']) }));
  for (const o of await get('/api/hotel/orders?status=new,preparing,ready')) await tryIt(() => put(`/api/hotel/orders/${o.id}/status`, { status: 'delivered' }));
  // Night audit closes the day
  await post('/api/hotel/night-audit');
}

// ---------- Today ----------
const bd = today();
const vip0 = await book(bd, 3, { guest: vipGuests[0], type: 'PRS', plan: plans.BB, source: 'direct', special_requests: 'Accueil par la directrice, fleurs et corbeille de fruits en suite' });
const vip2 = await book(bd, 2, { guest: vipGuests[2], type: 'EXE', plan: plans.BAR, source: 'booking' });
for (let i = 0; i < 8; i++) await book(bd, 1 + Math.floor(rnd() * 4));
const g1 = await book(bd, 2, { type: 'DLX', rooms: 3, group_name: 'Mission ONG Santé Pour Tous', plan: plans.BB, bill_to_id: corp.ong, source: 'corporate', guest: guest({ name: 'Mission Santé Pour Tous' }) });
// Assign rooms to today's arrivals (room ready list for housekeeping), deposit for the VIPs
for (const b of await get(`/api/hotel/bookings?status=confirmed&arrival=${bd}`)) {
  const sug = await tryIt(() => get(`/api/hotel/bookings/${b.id}/suggest-room`));
  if (sug?.id) await tryIt(() => put(`/api/hotel/bookings/${b.id}`, { room_id: sug.id }));
}
if (vip0) await pay(vip0.ids[0], 600000, 'bank');
// Two arrivals already checked in this morning
let k = 0;
for (const b of await get(`/api/hotel/bookings?status=confirmed&arrival=${bd}`)) {
  if (b.guest_name.includes('Nkodo') || b.group_name || k >= 2) continue;
  if (await tryIt(() => post(`/api/hotel/bookings/${b.id}/check-in`, { guest: { id_number: `ID${b.id}77` }, force_dirty: true }))) { await tryIt(() => post(`/api/hotel/bookings/${b.id}/keys`, { copies: 2, access: ['pool', 'gym', 'lift', 'spa'] })); k++; }
}
// Some of today's departures already left
let gone = 0;
for (const b of await get('/api/hotel/bookings?status=in_house')) {
  if (b.departure > bd || gone >= 2) continue;
  const full = await get(`/api/hotel/bookings/${b.id}`);
  if (full.booking.bill_to_id !== full.booking.guest_id) continue;
  await pay(b.id, full.booking.balance, 'card');
  if (await tryIt(() => post(`/api/hotel/bookings/${b.id}/check-out`, {}))) gone++;
}
// Future bookings for the planning and the forecast
for (let d = 1; d <= 21; d++) for (let i = 0; i < 2 + Math.floor(rnd() * (d > 8 && d < 13 ? 7 : 3)); i++) await book(addDays(bd, d), 1 + Math.floor(rnd() * 5), { status: 'confirmed' });
await book(addDays(bd, 10), 3, { type: 'EXE', rooms: 6, group_name: 'Salon international : délégation SPG', plan: plans.CORP, bill_to_id: corp.petro, source: 'corporate', guest: guest({ name: 'Délégation SPG' }) });
for (const id of created.slice(-12, -8)) await tryIt(() => put(`/api/hotel/bookings/${id}`, { status: 'tentative' }));

// Rooms: today's housekeeping picture
const board = await get('/api/hotel/rooms/board');
const users = await get('/api/users');
const hk = users.filter((u) => u.role === 'housekeeper');
for (const [i, r] of board.rooms.entries()) {
  const st = r.occupancy !== 'vacant' ? pick(['dirty', 'dirty', 'cleaning', 'clean']) : r.arrival ? pick(['clean', 'inspected', 'dirty']) : pick(['clean', 'inspected', 'inspected', 'dirty']);
  await tryIt(() => put(`/api/hotel/rooms/${r.id}/status`, { hk_status: st, hk_user_id: hk[i % hk.length]?.id }));
}
const vacant = board.rooms.filter((r) => r.occupancy === 'vacant' && !r.arrival);
const ooo = vacant.find((r) => r.number === '112') || vacant[0];
await post('/api/hotel/maintenance', { room_id: ooo.id, title: 'Climatisation en panne : compresseur à remplacer', priority: 'high', blocks_room: true });
const inHouse = await get('/api/hotel/in-house');
const dndRoom = meta.rooms.find((r) => r.number === inHouse[0]?.room_number);
if (dndRoom) await put(`/api/hotel/rooms/${dndRoom.id}/status`, { dnd: true });
await post('/api/hotel/maintenance', { place: 'Piscine', title: 'Projecteur sous-marin n° 3 éteint', priority: 'normal' });
await post('/api/hotel/maintenance', { room_id: meta.rooms.find((r) => r.number === '207').id, title: 'Chasse d\'eau qui fuit', priority: 'urgent' });
await post('/api/hotel/lost-found', { room_id: meta.rooms.find((r) => r.number === '305').id, item: 'Montre en acier, bracelet noir', note: 'Coffre de la réception, enveloppe n° 14' });
await post('/api/hotel/lost-found', { place: 'Bar Le Baobab', item: 'Chargeur d\'ordinateur portable', note: 'Étagère de la réception' });

// Live service: kitchen orders, spa, concierge requests, guest app usage
for (const [i, s] of inHouse.slice(0, 5).entries()) {
  const o = await tryIt(() => post('/api/hotel/orders', { outlet_id: [O.RS.id, O.REST.id, O.BAR.id][i % 3], booking_id: s.id, table_label: i % 3 === 1 ? 'T7' : '', lines: [{ product_id: pick([I.club, I.burger, I.rs_ndole, I.ndole, I.mojito, I.fruits]).id, qty: 1 }, { product_id: I.juice.id, qty: 1 }], note: i === 0 ? 'Sans piment' : '' }));
  if (o && i % 2) await tryIt(() => put(`/api/hotel/orders/${o.id}/status`, { status: 'preparing' }));
}
for (const [i, s] of inHouse.slice(0, 4).entries()) await tryIt(() => post('/api/hotel/appointments', { product_id: [I.massage, I.stones, I.facial, I.coach][i].id, booking_id: s.id, staff: ['Carine', 'Bérénice', 'Awa', 'Steve'][i], start_at: `${bd}T${['10:00', '11:30', '15:00', '17:00'][i]}` }));
await tryIt(() => post('/api/hotel/appointments', { product_id: I.hammam.id, guest_name: 'Mme Ebongue (cliente extérieure)', staff: 'Awa', start_at: `${bd}T12:30` }));
for (const [i, s] of inHouse.slice(2, 8).entries()) {
  const f = await get(`/api/hotel/bookings/${s.id}`);
  const token = f.portal_url.split('/').pop();
  const kinds = [['airport', 'Transfert vers l\'aéroport demain 6 h 30, 2 valises'], ['towels', '2 serviettes de bain supplémentaires'], ['wakeup', 'Réveil à 5 h 45'], ['restaurant', 'Table pour 4 ce soir 20 h au Rooftop'], ['iron', ''], ['amenities', 'Brosse à dents']];
  await tryIt(() => post(`/api/portal/${token}/request`, { kind: kinds[i][0], detail: kinds[i][1] }));
  if (i === 1) await tryIt(() => post(`/api/portal/${token}/order`, { lines: [{ product_id: I.club.id, qty: 1 }, { product_id: I.water.id, qty: 1 }], note: 'Livrer à 13 h' }));
}
// Reviews from recent stays
const past = await get('/api/hotel/bookings?status=checked_out&limit=40');
const comments = ['Accueil exceptionnel, chambre impeccable. Le ndolé du restaurant est le meilleur de Douala !', 'Très bon séjour d\'affaires, Wi-Fi rapide et personnel attentionné.', 'Superbe vue sur le Wouri, le rooftop est magique au coucher du soleil.',
  'Spa remarquable, massage aux pierres chaudes à recommander.', 'Bon hôtel, mais attente un peu longue au check-in.', 'Parfait du début à la fin. Merci à Estelle à la réception.', 'Room service rapide, petit-déjeuner très varié.'];
for (const [i, b] of past.slice(0, 14).entries()) {
  const f = await get(`/api/hotel/bookings/${b.id}`);
  const r = i === 4 ? 3 : i % 5 === 0 ? 4 : 5;
  await tryIt(() => post(`/api/portal/${f.portal_url.split('/').pop()}/feedback`, { rating: r, cleanliness: Math.min(5, r + (i % 2)), service: r, food: Math.max(3, r - (i % 3 === 0 ? 1 : 0)), comment: comments[i % comments.length] }));
}

// Past stays get realistic check-in / check-out times (the API stamps the real clock).
db.run(`UPDATE hotel_bookings SET checked_in_at = arrival || 'T' || printf('%02d:%02d', 12 + id % 9, id % 60) || ':00.000Z' WHERE company_id = ? AND checked_in_at IS NOT NULL AND arrival < ?`, companyId, today());
db.run(`UPDATE hotel_bookings SET checked_out_at = departure || 'T' || printf('%02d:%02d', 8 + id % 4, (id * 7) % 60) || ':00.000Z' WHERE company_id = ? AND status = 'checked_out' AND departure < ?`, companyId, today());

const s = await get('/api/hotel/dashboard');
console.log(`Demo hotel ready: ${email} / ${password} · ${board.rooms.length} rooms, ${created.length} bookings, ${s.kpi.tonight} rooms sold tonight (${s.kpi.occupancy} %), ${inHouse.length} stays in house`);
console.log('Staff: reception@, nuit@, menage@, menage2@, bar@, spa@, gerant@, compta@teknons.cm (same password) · manager code 2580');
app.server.close();
process.exit(0);
