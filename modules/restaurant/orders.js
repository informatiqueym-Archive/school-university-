// Checks and service: menu with options and happy hour, dine-in / takeaway /
// delivery / bar checks, coursing (send starters, hold mains), kitchen and bar
// routing, voids and comps with manager code, split and merge, payments with
// tips (cash, card, MTN MoMo, Orange Money, company account), cash sessions
// per waiter and the SYSCOHADA entry written the moment a check is paid.
import crypto from 'node:crypto';
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, num, oneOf } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { raiseAlert, audit } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { hashPassword, verifyPassword } from '../../core/auth.js';
import { normalizePhone, PROVIDERS } from '../../core/payments/mobile-money.js';
import { DEFAULTS } from '../accounting/chart.js';
import { postEntry, nextNumber } from '../accounting/ledger.js';
import * as docs from '../accounting/documents.js';
import * as tr from '../accounting/treasury.js';
import { solveNet } from '../../public/js/shop-pricing.js';
import { consumeRecipe, restoreRecipe } from './stock.js';

export const MANAGERS = ['owner', 'admin', 'manager'];
export const sys = (ctx) => ({ ...ctx, user: { ...(ctx.user || {}), role: 'owner' } });
export const token = () => crypto.randomBytes(15).toString('base64url');

export const PAY = {
  cash: { account: DEFAULTS.cash, compta: 'cash', journal: 'CA', fr: 'Espèces', en: 'Cash' },
  card: { account: DEFAULTS.bank, compta: 'bank', journal: 'BQ', fr: 'Carte bancaire (TPE)', en: 'Card' },
  mtn_momo: { account: DEFAULTS.mtn_momo, compta: 'mtn_momo', journal: 'MM', fr: 'MTN MoMo', en: 'MTN MoMo' },
  orange_money: { account: DEFAULTS.orange_money, compta: 'orange_money', journal: 'MM', fr: 'Orange Money', en: 'Orange Money' },
  account: { account: DEFAULTS.clients, fr: 'Compte client (facture)', en: 'Customer account (invoice)' },
};
export const KINDS = { dine_in: { fr: 'Sur place', en: 'Dine-in' }, takeaway: { fr: 'À emporter', en: 'Takeaway' }, delivery: { fr: 'Livraison', en: 'Delivery' }, bar: { fr: 'Comptoir / bar', en: 'Bar tab' } };
const ACTIVE = "status <> 'void'";

// ---------------- Settings and manager code ----------------
export function settingsOf(db, companyId) {
  db.run('INSERT OR IGNORE INTO resto_settings (company_id) VALUES (?)', companyId);
  return db.get('SELECT * FROM resto_settings WHERE company_id = ?', companyId);
}
export const publicSettings = (s) => { const { manager_pin_hash, ...rest } = s; return { ...rest, has_pin: !!manager_pin_hash }; };
export function setManagerPin(db, companyId, pin) {
  const p = String(pin || '');
  if (!/^\d{4,8}$/.test(p)) throw bad('pin', 'Le code responsable doit avoir 4 à 8 chiffres');
  db.run('UPDATE resto_settings SET manager_pin_hash = ? WHERE company_id = ?', hashPassword(p), companyId);
}
/** Owners and managers pass; others need the manager code. */
export function checkManager(db, ctx, pin, what) {
  if (MANAGERS.includes(ctx.user.role)) return;
  const s = settingsOf(db, ctx.user.company_id);
  if (!s.manager_pin_hash) throw forbidden(`${what} : code responsable non configuré (Réglages du restaurant)`);
  if (!pin || !verifyPassword(String(pin), s.manager_pin_hash)) throw forbidden(`${what} : code responsable incorrect`);
}

// ---------------- Menu ----------------
const parseOpts = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Happy hour applies to drinks between two times (Douala time, UTC+1). */
export function happyHourActive(s, at = new Date()) {
  if (!s.happy_hour_pct || !s.happy_hour_from || !s.happy_hour_to) return false;
  const d = new Date(at.getTime() + 3600e3);
  const hm = d.toISOString().slice(11, 16);
  return s.happy_hour_from <= s.happy_hour_to ? hm >= s.happy_hour_from && hm < s.happy_hour_to : hm >= s.happy_hour_from || hm < s.happy_hour_to;
}

export function soldToday(db, companyId) {
  const out = {};
  for (const r of db.all(`SELECT l.product_id, SUM(l.qty) q FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND l.status <> 'void' AND substr(l.created_at,1,10) = ? GROUP BY l.product_id`, companyId, today())) out[r.product_id] = r.q;
  return out;
}

export function menu(db, companyId, { all = false, channel = '' } = {}) {
  const s = settingsOf(db, companyId);
  const hh = happyHourActive(s);
  const cats = db.all(`SELECT c.*, st.name station_name, st.kind station_kind FROM resto_categories c LEFT JOIN resto_stations st ON st.id = c.station_id WHERE c.company_id = ? ${all ? '' : 'AND c.active = 1'} ORDER BY c.position, c.name`, companyId);
  const where = ['i.company_id = ?'];
  if (!all) where.push('p.active = 1');
  if (channel === 'qr') where.push('i.qr = 1');
  if (channel === 'online') where.push('i.online = 1');
  const sold = soldToday(db, companyId);
  const costs = Object.fromEntries(db.all('SELECT r.product_id, SUM(r.qty * g.cost) c FROM resto_recipes r JOIN resto_ingredients g ON g.id = r.ingredient_id WHERE g.company_id = ? GROUP BY r.product_id', companyId).map((x) => [x.product_id, x.c]));
  const items = db.all(`SELECT p.id, p.name, p.description, p.vat_rate, p.active, p.sales_account, i.*, c.drinks, c.course
      FROM resto_items i JOIN products p ON p.id = i.product_id JOIN resto_categories c ON c.id = i.category_id WHERE ${where.join(' AND ')} ORDER BY c.position, i.position, p.name`, companyId)
    .map((x) => {
      const left = x.daily_limit > 0 ? Math.max(0, x.daily_limit - (sold[x.id] || 0)) : null;
      const fc = Math.round(costs[x.id] || 0); const net = x.price / (1 + (x.vat_rate ?? 19.25) / 100);
      return { ...x, options: parseOpts(x.options), left, food_cost: fc, food_cost_pct: fc && net ? Math.round((fc / net) * 1000) / 10 : 0, sold_out: !x.available || left === 0, happy: hh && x.drinks ? Math.round(x.price * (1 - s.happy_hour_pct / 100)) : null };
    });
  return { categories: cats, items, happy_hour: hh ? s.happy_hour_pct : 0 };
}

export function saveCategory(db, companyId, b, id = null) {
  const cur = id ? db.get('SELECT * FROM resto_categories WHERE id = ? AND company_id = ?', id, companyId) : null;
  if (id && !cur) throw notFound('Catégorie introuvable');
  const station = b.station_id === undefined ? cur?.station_id : (b.station_id || null);
  if (station && !db.get('SELECT 1 FROM resto_stations WHERE id = ? AND company_id = ?', station, companyId)) throw bad('station', 'Poste inconnu');
  const v = {
    name: str(b.name ?? cur?.name, 60), name_en: str(b.name_en ?? cur?.name_en, 60), station_id: station ?? null,
    course: Math.min(4, int(b.course ?? cur?.course, 'course', { min: 0, def: 2 })), drinks: b.drinks === undefined ? (cur?.drinks ?? 0) : (b.drinks ? 1 : 0),
    color: str(b.color ?? cur?.color, 20), position: int(b.position ?? cur?.position, 'position', { def: 0 }), active: b.active === undefined ? (cur?.active ?? 1) : (b.active ? 1 : 0),
  };
  if (!v.name) throw bad('name', 'Le nom est obligatoire');
  if (cur) db.run(`UPDATE resto_categories SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(v), cur.id);
  else id = Number(db.run(`INSERT INTO resto_categories (company_id, ${Object.keys(v).join(', ')}) VALUES (?, ${Object.keys(v).map(() => '?').join(', ')})`, companyId, ...Object.values(v)).lastInsertRowid);
  return db.get('SELECT * FROM resto_categories WHERE id = ?', id);
}

function cleanOptions(raw) {
  const list = typeof raw === 'string' ? parseOpts(raw) : Array.isArray(raw) ? raw : [];
  return list.slice(0, 8).map((g) => ({
    group: str(g.group, 40), required: !!g.required, multi: !!g.multi,
    choices: (Array.isArray(g.choices) ? g.choices : []).slice(0, 15).map((c) => ({ name: str(c.name, 40), price: int(c.price, 'price', { min: 0, def: 0 }) })).filter((c) => c.name),
  })).filter((g) => g.group && g.choices.length);
}

export function saveItem(db, company, b, id = null) {
  const cid = company.id;
  const cur = id ? db.get('SELECT p.*, i.* FROM products p JOIN resto_items i ON i.product_id = p.id WHERE p.id = ? AND p.company_id = ?', id, cid) : null;
  if (id && !cur) throw notFound('Plat introuvable');
  const catId = b.category_id ?? cur?.category_id;
  const cat = db.get('SELECT * FROM resto_categories WHERE id = ? AND company_id = ?', catId, cid);
  if (!cat) throw bad('category', 'Catégorie inconnue');
  const name = str(b.name ?? cur?.name, 120); if (!name) throw bad('name', 'Le nom est obligatoire');
  const price = int(b.price ?? cur?.price, 'price', { min: 0 });
  const vat = b.vat_rate === '' || (b.vat_rate === undefined && cur?.vat_rate == null) ? null : num(b.vat_rate ?? cur?.vat_rate, 'vat_rate', { min: 0 });
  const account = cat.drinks ? '7011' : '7021';
  const flag = (k, d) => (b[k] === undefined ? (cur ? cur[k] : d) : (b[k] && b[k] !== '0' ? 1 : 0));
  const net = solveNet(price, vat ?? (company.vat_enabled ? company.vat_rate : 0));
  return db.tx(() => {
    let pid = id;
    if (!cur) pid = Number(db.run("INSERT INTO products (company_id, kind, code, name, description, unit, price, vat_rate, sales_account, created_at) VALUES (?, 'good', ?, ?, ?, 'u', ?, ?, ?, ?)",
      cid, str(b.code, 40), name, str(b.description, 600), net, vat, account, now()).lastInsertRowid);
    else db.run('UPDATE products SET name = ?, description = ?, price = ?, vat_rate = ?, sales_account = ?, active = ? WHERE id = ?', name, str(b.description ?? cur.description, 600), net, vat, account,
      b.active === undefined ? cur.active : (b.active ? 1 : 0), pid);
    const v = {
      category_id: cat.id, price, name_en: str(b.name_en ?? cur?.name_en, 120), description_en: str(b.description_en ?? cur?.description_en, 600), image: str(b.image ?? cur?.image, 600),
      allergens: str(b.allergens ?? cur?.allergens, 200), tags: str(b.tags ?? cur?.tags, 200), options: JSON.stringify(cleanOptions(b.options ?? cur?.options)),
      prep_min: int(b.prep_min ?? cur?.prep_min, 'prep_min', { min: 0, def: 0 }), calories: int(b.calories ?? cur?.calories, 'calories', { min: 0, def: 0 }),
      available: flag('available', 1), daily_limit: int(b.daily_limit ?? cur?.daily_limit, 'daily_limit', { min: 0, def: 0 }), qr: flag('qr', 1), online: flag('online', 1),
      position: int(b.position ?? cur?.position, 'position', { def: 0 }),
    };
    if (cur) db.run(`UPDATE resto_items SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE product_id = ?`, ...Object.values(v), pid);
    else db.run(`INSERT INTO resto_items (product_id, company_id, ${Object.keys(v).join(', ')}) VALUES (?, ?, ${Object.keys(v).map(() => '?').join(', ')})`, pid, cid, ...Object.values(v));
    if (Array.isArray(b.recipe)) {
      db.run('DELETE FROM resto_recipes WHERE product_id = ?', pid);
      for (const r of b.recipe) {
        const q = num(r.qty, 'qty', { min: 0 });
        if (!q) continue;
        if (!db.get('SELECT 1 FROM resto_ingredients WHERE id = ? AND company_id = ?', r.ingredient_id, cid)) throw bad('ingredient', 'Ingrédient inconnu');
        db.run('INSERT OR REPLACE INTO resto_recipes (product_id, ingredient_id, qty) VALUES (?,?,?)', pid, r.ingredient_id, q);
      }
    }
    return itemDetail(db, cid, pid);
  });
}

export function itemDetail(db, companyId, id) {
  const it = db.get('SELECT p.id, p.name, p.description, p.vat_rate, p.active, i.* FROM products p JOIN resto_items i ON i.product_id = p.id WHERE p.id = ? AND p.company_id = ?', id, companyId);
  if (!it) throw notFound('Plat introuvable');
  it.options = parseOpts(it.options);
  it.recipe = db.all('SELECT r.ingredient_id, r.qty, g.name, g.unit, g.cost FROM resto_recipes r JOIN resto_ingredients g ON g.id = r.ingredient_id WHERE r.product_id = ?', id);
  it.food_cost = Math.round(it.recipe.reduce((t, r) => t + r.qty * r.cost, 0));
  return it;
}

// ---------------- Checks ----------------
const orderSql = `SELECT o.*, t.label table_label, a.name area_name, u.name server_name, p.name customer_name, p.phone customer_phone
  FROM resto_orders o LEFT JOIN resto_tables t ON t.id = o.table_id LEFT JOIN resto_areas a ON a.id = t.area_id LEFT JOIN users u ON u.id = o.server_id LEFT JOIN partners p ON p.id = o.customer_id`;

export function getOrder(db, companyId, id) {
  const o = db.get(`${orderSql} WHERE o.id = ? AND o.company_id = ?`, id, companyId);
  if (!o) throw notFound('Addition introuvable');
  o.lines = db.all('SELECT l.*, s.name station_name, s.kind station_kind FROM resto_lines l LEFT JOIN resto_stations s ON s.id = l.station_id WHERE l.order_id = ? ORDER BY l.course, l.id', id);
  o.payments = db.all('SELECT p.*, u.name user_name FROM resto_payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.order_id = ? ORDER BY p.id', id);
  o.due = Math.max(0, o.total - o.paid);
  if (o.customer_id) o.loyalty = db.get('SELECT * FROM resto_customers WHERE partner_id = ?', o.customer_id) || null;
  return o;
}

export function listOrders(db, companyId, q = {}) {
  const where = ['o.company_id = ?']; const a = [companyId];
  if (q.status) { const st = String(q.status).split(','); where.push(`o.status IN (${st.map(() => '?').join(',')})`); a.push(...st); }
  if (q.kind) { const k = String(q.kind).split(','); where.push(`o.kind IN (${k.map(() => '?').join(',')})`); a.push(...k); }
  if (q.date) { where.push('substr(o.opened_at,1,10) = ?'); a.push(q.date); }
  if (q.from) { where.push('substr(o.opened_at,1,10) >= ?'); a.push(q.from); }
  if (q.to) { where.push('substr(o.opened_at,1,10) <= ?'); a.push(q.to); }
  if (q.server_id) { where.push('o.server_id = ?'); a.push(q.server_id); }
  if (q.q) { where.push('(o.number LIKE ? OR o.guest_name LIKE ? OR o.phone LIKE ? OR t.label = ?)'); a.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, q.q); }
  const rows = db.all(`${orderSql} WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT ${Math.min(500, Number(q.limit) || 200)}`, ...a);
  for (const r of rows) {
    r.due = Math.max(0, r.total - r.paid);
    if (q.lines) r.lines = db.all("SELECT name, qty, status, options, note, course FROM resto_lines WHERE order_id = ? AND status <> 'void' ORDER BY course, id", r.id);
  }
  return rows;
}

/** Recomputes the check: subtotal, service charge, points, total, VAT split and food cost. */
export function recompute(db, company, orderId) {
  const o = db.get('SELECT * FROM resto_orders WHERE id = ?', orderId);
  const s = settingsOf(db, company.id);
  const lines = db.all(`SELECT * FROM resto_lines WHERE order_id = ? AND ${ACTIVE}`, orderId);
  const subtotal = lines.reduce((t, l) => t + l.total, 0);
  const discount = Math.min(o.discount, subtotal);
  const pointsValue = Math.min(o.points_used * s.point_value, subtotal - discount);
  const service = o.kind === 'dine_in' && s.service_pct > 0 ? Math.round((subtotal - discount) * s.service_pct / 100) : 0;
  const total = subtotal - discount - pointsValue + service + o.delivery_fee;
  const { net, vat } = allocate(company, lines, discount + pointsValue, service, o.delivery_fee).reduce((t, x) => ({ net: t.net + x.net, vat: t.vat + x.vat }), { net: 0, vat: 0 });
  const cost = lines.reduce((t, l) => t + l.cost, 0);
  db.run('UPDATE resto_orders SET subtotal = ?, discount = ?, service_charge = ?, total = ?, net_total = ?, vat_total = ?, cost_total = ? WHERE id = ?', subtotal, discount, service, total, net, vat, cost, orderId);
  return total;
}

/**
 * Splits the check into TTC amounts per sales account and VAT rate: line totals
 * minus their share of the discount, then service charge and delivery fee.
 */
export function allocate(company, lines, reduction, service, delivery) {
  const vatDef = company.vat_enabled ? company.vat_rate : 0;
  const subtotal = lines.reduce((t, l) => t + l.total, 0);
  const parts = lines.filter((l) => l.total > 0).map((l) => ({ account: l.account_code || '7021', rate: l.vat_rate, amount: subtotal ? Math.round(l.total * (1 - reduction / subtotal)) : 0, description: l.name, qty: l.qty }));
  const diff = (subtotal - reduction) - parts.reduce((t, p) => t + p.amount, 0);
  if (diff && parts.length) parts.sort((a, b) => b.amount - a.amount)[0].amount += diff;
  if (service) parts.push({ account: DEFAULTS.sales_services, rate: vatDef, amount: service, description: 'Service' });
  if (delivery) parts.push({ account: '7071', rate: vatDef, amount: delivery, description: 'Frais de livraison' });
  return parts.map((p) => { const n = solveNet(p.amount, p.rate); return { ...p, net: n, vat: p.amount - n }; });
}

function tableBusy(db, companyId, tableId, exceptId = 0) {
  return db.get("SELECT id, number FROM resto_orders WHERE company_id = ? AND table_id = ? AND status = 'open' AND id <> ? ORDER BY id LIMIT 1", companyId, tableId, exceptId);
}

export function customerOf(db, companyId, partnerId) {
  if (!partnerId) return null;
  const p = db.get("SELECT * FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", partnerId, companyId);
  if (!p) throw notFound('Client introuvable');
  db.run('INSERT OR IGNORE INTO resto_customers (partner_id, company_id) VALUES (?,?)', p.id, companyId);
  return { ...p, ...db.get('SELECT * FROM resto_customers WHERE partner_id = ?', p.id), partner_id: p.id };
}

/** Finds or creates the customer from a phone number (QR, online, delivery). */
export function customerByPhone(db, companyId, name, phone) {
  const tel = String(phone || '').replace(/\D/g, '').replace(/^237/, '');
  if (tel.length < 8) return null;
  let p = db.get("SELECT id FROM partners WHERE company_id = ? AND kind = 'client' AND replace(replace(replace(phone,' ',''),'+',''),'-','') LIKE ?", companyId, `%${tel}`);
  if (!p) p = { id: Number(db.run("INSERT INTO partners (company_id, kind, name, phone, created_at) VALUES (?, 'client', ?, ?, ?)", companyId, str(name, 100) || `Client ${tel}`, tel, now()).lastInsertRowid) };
  db.run('INSERT OR IGNORE INTO resto_customers (partner_id, company_id) VALUES (?,?)', p.id, companyId);
  return p.id;
}

export function openOrder(db, bus, ctx, company, b, { source = 'staff' } = {}) {
  const cid = company.id;
  const kind = oneOf(b.kind, Object.keys(KINDS), 'kind', b.table_id ? 'dine_in' : 'takeaway');
  let table = null;
  if (kind === 'dine_in') {
    table = db.get('SELECT * FROM resto_tables WHERE id = ? AND company_id = ? AND active = 1', b.table_id, cid);
    if (!table) throw bad('table', 'Choisissez une table');
    const busy = tableBusy(db, cid, table.id);
    if (busy && !b.allow_second) throw conflict('table_busy', `La table ${table.label} a déjà l'addition ${busy.number}`);
  }
  if (kind === 'delivery' && !str(b.address)) throw bad('address', 'Adresse de livraison obligatoire');
  const s = settingsOf(db, cid);
  let customerId = b.customer_id ? customerOf(db, cid, b.customer_id).partner_id : null;
  if (!customerId && b.phone && kind !== 'dine_in') customerId = customerByPhone(db, cid, b.guest_name, b.phone);
  return db.tx(() => {
    const number = nextNumber(db, cid, `R-${today().slice(0, 4)}`, 5);
    const r = db.run(`INSERT INTO resto_orders (company_id, number, kind, source, table_id, covers, server_id, customer_id, guest_name, phone, address, delivery_status, pickup_time, delivery_fee, note, token, reservation_id, opened_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, cid, number, kind, source, table?.id ?? null, int(b.covers, 'covers', { min: 0, def: kind === 'dine_in' ? 2 : 0 }),
    source === 'staff' ? (b.server_id || ctx.user?.id || null) : null, customerId, str(b.guest_name, 100), str(b.phone, 30), str(b.address, 300), kind === 'delivery' ? 'pending' : '',
    str(b.pickup_time, 5), kind === 'delivery' ? int(b.delivery_fee, 'delivery_fee', { min: 0, def: s.delivery_fee }) : 0, str(b.note, 300), token(), b.reservation_id || null, now(), ctx.user?.id ?? null);
    const id = Number(r.lastInsertRowid);
    if (Array.isArray(b.lines) && b.lines.length) addLines(db, bus, ctx, company, id, { lines: b.lines, send: b.send, hold_courses: b.hold_courses, manager_pin: b.manager_pin }, { source });
    if (ctx.user?.id) audit(db, ctx, 'open', 'resto_order', id, { kind, table: table?.label });
    bus.emit(cid, 'change', { entity: 'resto_order', id });
    return getOrder(db, cid, id);
  });
}

function editable(db, companyId, id) {
  const o = db.get('SELECT * FROM resto_orders WHERE id = ? AND company_id = ?', id, companyId);
  if (!o) throw notFound('Addition introuvable');
  if (o.status !== 'open') throw conflict('closed', o.status === 'paid' ? 'Cette addition est déjà réglée' : 'Cette addition est annulée');
  return o;
}

/** lines: [{ product_id, qty, options: ['À point', 'Frites'], note, seat, course }] */
export function addLines(db, bus, ctx, company, orderId, b, { source = 'staff' } = {}) {
  const cid = company.id;
  const o = editable(db, cid, orderId);
  const raw = Array.isArray(b.lines) ? b.lines : [];
  if (!raw.length) throw bad('lines', 'Ajoutez au moins un plat');
  if (raw.length > 80) throw bad('lines', 'Trop de lignes en une fois');
  const s = settingsOf(db, cid);
  const hh = happyHourActive(s);
  const sold = soldToday(db, cid);
  const vatDef = company.vat_enabled ? company.vat_rate : 0;
  const rows = raw.map((l) => {
    const it = db.get(`SELECT p.id, p.name, p.vat_rate, p.sales_account, p.active, i.*, c.station_id, c.course cat_course, c.drinks FROM products p JOIN resto_items i ON i.product_id = p.id
      JOIN resto_categories c ON c.id = i.category_id WHERE p.id = ? AND p.company_id = ?`, l.product_id, cid);
    if (!it || !it.active) throw bad('product', 'Plat introuvable');
    if (source !== 'staff' && (source === 'qr' ? !it.qr : !it.online)) throw forbidden(`${it.name} n'est pas disponible en ligne`);
    const qty = num(l.qty, 'qty', { min: 0.01, def: 1 });
    if (qty > 99) throw bad('qty', 'Quantité trop grande');
    if (!it.available) throw conflict('sold_out', `${it.name} est épuisé aujourd'hui`);
    if (it.daily_limit > 0 && (sold[it.id] || 0) + qty > it.daily_limit) throw conflict('sold_out', `${it.name} : plus que ${Math.max(0, it.daily_limit - (sold[it.id] || 0))} portion(s) aujourd'hui`);
    sold[it.id] = (sold[it.id] || 0) + qty;
    // Options: names chosen from the item's groups, each with its supplement.
    const groups = parseOpts(it.options);
    const chosen = (Array.isArray(l.options) ? l.options : String(l.options || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
    let extra = 0;
    for (const g of groups) {
      const picked = g.choices.filter((c) => chosen.includes(c.name));
      if (g.required && !picked.length) throw bad('options', `${it.name} : choisissez « ${g.group} »`);
      if (!g.multi && picked.length > 1) throw bad('options', `${it.name} : un seul choix pour « ${g.group} »`);
      extra += picked.reduce((t, c) => t + c.price, 0);
    }
    const valid = chosen.filter((c) => groups.some((g) => g.choices.some((x) => x.name === c)));
    const base = hh && it.drinks ? Math.round(it.price * (1 - s.happy_hour_pct / 100)) : it.price;
    const unit = base + extra;
    const course = l.course === undefined || l.course === '' ? (it.drinks ? 0 : it.cat_course) : Math.min(4, int(l.course, 'course', { min: 0 }));
    return { it, qty, unit, options: valid.join(', '), note: str(l.note, 200), seat: int(l.seat, 'seat', { min: 0, def: 0 }), course, rate: it.vat_rate ?? vatDef };
  });
  return db.tx(() => {
    const ids = [];
    for (const r of rows) {
      const res = db.run(`INSERT INTO resto_lines (order_id, product_id, name, qty, unit_price, options, note, seat, course, station_id, status, total, vat_rate, account_code, source, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?,?,?,?,?,?)`, orderId, r.it.id, r.it.name, r.qty, r.unit, r.options, r.note, r.seat, r.course, r.it.station_id,
      Math.round(r.qty * r.unit), r.rate, r.it.sales_account || (r.it.drinks ? '7011' : '7021'), source, ctx.user?.id ?? null, now());
      ids.push(Number(res.lastInsertRowid));
    }
    recompute(db, company, orderId);
    if (b.send) sendLines(db, bus, ctx, company, orderId, { line_ids: ids, hold_courses: b.hold_courses });
    bus.emit(cid, 'change', { entity: 'resto_order', id: orderId, table_id: o.table_id });
    return getOrder(db, cid, orderId);
  });
}

/**
 * Sends lines to their station (kitchen, bar...). Stock is taken from the recipe
 * at this moment. hold_courses: mains and desserts wait ("held") until fired.
 * fire_course: sends the held lines of that course.
 */
export function sendLines(db, bus, ctx, company, orderId, b = {}) {
  const cid = company.id;
  const o = editable(db, cid, orderId);
  let lines;
  if (b.fire_course != null) lines = db.all("SELECT * FROM resto_lines WHERE order_id = ? AND status = 'held' AND course = ?", orderId, int(b.fire_course, 'fire_course', { min: 0 }));
  else {
    lines = db.all("SELECT * FROM resto_lines WHERE order_id = ? AND status IN ('pending','held')", orderId);
    if (Array.isArray(b.line_ids) && b.line_ids.length) lines = lines.filter((l) => b.line_ids.map(Number).includes(l.id));
  }
  if (!lines.length) return getOrder(db, cid, orderId);
  // With coursing, the lowest food course goes now; later courses are held.
  const food = lines.filter((l) => l.course > 0 && l.status === 'pending');
  const first = b.hold_courses && food.length ? Math.min(...food.map((l) => l.course)) : null;
  return db.tx(() => {
    const at = now(); let sent = 0;
    for (const l of lines) {
      if (first != null && l.course > first && l.status === 'pending') { db.run("UPDATE resto_lines SET status = 'held' WHERE id = ?", l.id); continue; }
      const cost = consumeRecipe(db, cid, l.product_id, l.qty, { ref_id: l.id, userId: ctx.user?.id ?? null });
      db.run("UPDATE resto_lines SET status = 'sent', sent_at = ?, cost = ? WHERE id = ?", at, Math.round(cost), l.id);
      sent++;
    }
    recompute(db, company, orderId);
    if (sent) {
      if (o.kind === 'delivery' && o.delivery_status === 'pending') db.run("UPDATE resto_orders SET delivery_status = 'preparing' WHERE id = ?", orderId);
      bus.emit(cid, 'kitchen', { order_id: orderId });
    }
    bus.emit(cid, 'change', { entity: 'resto_order', id: orderId });
    return getOrder(db, cid, orderId);
  });
}

export function updateLine(db, bus, ctx, company, orderId, lineId, b) {
  const cid = company.id;
  editable(db, cid, orderId);
  const l = db.get('SELECT * FROM resto_lines WHERE id = ? AND order_id = ?', lineId, orderId);
  if (!l || l.status === 'void') throw notFound('Ligne introuvable');
  const s = settingsOf(db, cid);
  return db.tx(() => {
    if (b.qty !== undefined) {
      if (!['pending', 'held'].includes(l.status)) throw conflict('sent', 'Déjà envoyé en cuisine : annulez la ligne et ressaisissez');
      const qty = num(b.qty, 'qty', { min: 0.01 });
      db.run('UPDATE resto_lines SET qty = ?, total = ? WHERE id = ?', qty, Math.round(qty * l.unit_price * (l.comp ? 0 : 1 - l.discount_pct / 100)), l.id);
    }
    if (b.note !== undefined || b.seat !== undefined || b.course !== undefined) {
      db.run('UPDATE resto_lines SET note = ?, seat = ?, course = ? WHERE id = ?', str(b.note ?? l.note, 200), int(b.seat ?? l.seat, 'seat', { min: 0 }), int(b.course ?? l.course, 'course', { min: 0 }), l.id);
    }
    if (b.discount_pct !== undefined || b.comp !== undefined) {
      const pct = Math.min(100, num(b.discount_pct ?? l.discount_pct, 'discount_pct', { min: 0 }));
      const comp = b.comp === undefined ? l.comp : (b.comp ? 1 : 0);
      if (comp || pct > s.max_discount_pct) checkManager(db, ctx, b.manager_pin, comp ? 'Offrir un plat' : 'Remise importante');
      db.run('UPDATE resto_lines SET discount_pct = ?, comp = ?, total = ? WHERE id = ?', pct, comp, comp ? 0 : Math.round(l.qty * l.unit_price * (1 - pct / 100)), l.id);
      audit(db, ctx, comp ? 'comp' : 'discount', 'resto_line', l.id, { name: l.name, pct, reason: str(b.reason, 200) });
    }
    recompute(db, company, orderId);
    bus.emit(cid, 'change', { entity: 'resto_order', id: orderId });
    return getOrder(db, cid, orderId);
  });
}

/** Cancels a line. Once sent, a manager code is needed; food already cooked counts as waste. */
export function voidLine(db, bus, ctx, company, orderId, lineId, b = {}) {
  const cid = company.id;
  editable(db, cid, orderId);
  const l = db.get('SELECT * FROM resto_lines WHERE id = ? AND order_id = ?', lineId, orderId);
  if (!l || l.status === 'void') throw notFound('Ligne introuvable');
  const sent = !['pending', 'held'].includes(l.status);
  if (sent) checkManager(db, ctx, b.manager_pin, 'Annuler un plat déjà envoyé');
  const reason = str(b.reason, 200);
  if (sent && !reason) throw bad('reason', 'Indiquez le motif d\'annulation');
  return db.tx(() => {
    if (l.status === 'sent') restoreRecipe(db, cid, l.id, ctx.user?.id ?? null); // not started: back in stock
    db.run("UPDATE resto_lines SET status = 'void', void_reason = ?, voided_by = ?, total = 0 WHERE id = ?", reason, ctx.user?.id ?? null, l.id);
    recompute(db, company, orderId);
    if (sent) {
      audit(db, ctx, 'void', 'resto_line', l.id, { name: l.name, qty: l.qty, amount: Math.round(l.qty * l.unit_price), reason, was: l.status });
      if (l.qty * l.unit_price >= 10000) raiseAlert(db, null, cid, { kind: 'resto_void', level: 'warning', title: `Annulation : ${l.name} (${fcfa(l.qty * l.unit_price)})`, body: `${ctx.user?.name || ''} · ${reason}`, entity: 'resto_line', entity_id: l.id });
      bus.emit(cid, 'kitchen', { order_id: orderId });
    }
    bus.emit(cid, 'change', { entity: 'resto_order', id: orderId });
    return getOrder(db, cid, orderId);
  });
}

export function updateOrder(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const o = editable(db, cid, id);
  const s = settingsOf(db, cid);
  return db.tx(() => {
    if (b.table_id !== undefined && b.table_id !== o.table_id) {
      const t = db.get('SELECT * FROM resto_tables WHERE id = ? AND company_id = ? AND active = 1', b.table_id, cid);
      if (!t) throw bad('table', 'Table inconnue');
      const busy = tableBusy(db, cid, t.id, id);
      if (busy) throw conflict('table_busy', `La table ${t.label} est occupée (${busy.number}). Utilisez « Fusionner ».`);
      db.run("UPDATE resto_orders SET table_id = ?, kind = 'dine_in' WHERE id = ?", t.id, id);
    }
    if (b.covers !== undefined) db.run('UPDATE resto_orders SET covers = ? WHERE id = ?', int(b.covers, 'covers', { min: 0 }), id);
    if (b.server_id !== undefined) {
      if (!db.get('SELECT 1 FROM users WHERE id = ? AND company_id = ?', b.server_id, cid)) throw bad('server', 'Serveur inconnu');
      db.run('UPDATE resto_orders SET server_id = ? WHERE id = ?', b.server_id, id);
    }
    if (b.customer_id !== undefined) db.run('UPDATE resto_orders SET customer_id = ? WHERE id = ?', b.customer_id ? customerOf(db, cid, b.customer_id).partner_id : null, id);
    for (const k of ['guest_name', 'phone', 'address', 'note', 'courier', 'pickup_time']) if (b[k] !== undefined) db.run(`UPDATE resto_orders SET ${k} = ? WHERE id = ?`, str(b[k], 300), id);
    if (b.delivery_status !== undefined) {
      db.run('UPDATE resto_orders SET delivery_status = ? WHERE id = ?', oneOf(b.delivery_status, ['pending', 'preparing', 'ready', 'on_the_way', 'delivered'], 'delivery_status'), id);
    }
    if (b.discount !== undefined || b.discount_pct !== undefined) {
      const base = db.get(`SELECT COALESCE(SUM(total),0) s FROM resto_lines WHERE order_id = ? AND ${ACTIVE}`, id).s;
      const amount = b.discount_pct !== undefined && b.discount_pct !== '' ? Math.round(base * Math.min(100, num(b.discount_pct, 'discount_pct', { min: 0 })) / 100) : int(b.discount, 'discount', { min: 0 });
      if (amount > base * s.max_discount_pct / 100) checkManager(db, ctx, b.manager_pin, 'Remise sur l\'addition');
      db.run('UPDATE resto_orders SET discount = ?, discount_reason = ? WHERE id = ?', Math.min(amount, base), str(b.discount_reason, 200), id);
      if (amount) audit(db, ctx, 'discount', 'resto_order', id, { amount, reason: b.discount_reason });
    }
    if (b.points_used !== undefined) {
      const pts = int(b.points_used, 'points_used', { min: 0 });
      if (pts) {
        if (!o.customer_id) throw bad('customer', 'Choisissez le client fidèle');
        const c = customerOf(db, cid, o.customer_id);
        if (pts > c.points) throw bad('points', `Le client n'a que ${c.points} points`);
      }
      db.run('UPDATE resto_orders SET points_used = ? WHERE id = ?', pts, id);
    }
    if (b.bill_printed) db.run('UPDATE resto_orders SET bill_printed = 1 WHERE id = ?', id);
    recompute(db, company, id);
    bus.emit(cid, 'change', { entity: 'resto_order', id });
    return getOrder(db, cid, id);
  });
}

/** Moves lines (or a seat) to another check: split the bill, or a guest changes table. */
export function transferLines(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const from = editable(db, cid, id);
  let to;
  if (b.to_order_id) to = editable(db, cid, b.to_order_id);
  const ids = (Array.isArray(b.line_ids) ? b.line_ids : []).map(Number);
  const lines = db.all(`SELECT * FROM resto_lines WHERE order_id = ? AND ${ACTIVE}`, id).filter((l) => ids.includes(l.id) || (b.seat && l.seat === Number(b.seat)));
  if (!lines.length) throw bad('lines', 'Choisissez les plats à déplacer');
  if (from.paid > 0) throw conflict('paid', 'Un paiement partiel existe déjà : encaissez le reste sur cette addition');
  return db.tx(() => {
    if (!to) {
      const created = openOrder(db, bus, ctx, company, { kind: from.kind, table_id: from.table_id, covers: b.covers ?? 1, customer_id: b.customer_id, allow_second: true, guest_name: str(b.guest_name, 100) });
      to = created;
    }
    for (const l of lines) db.run('UPDATE resto_lines SET order_id = ? WHERE id = ?', to.id, l.id);
    recompute(db, company, id); recompute(db, company, to.id);
    audit(db, ctx, 'split', 'resto_order', id, { to: to.id, lines: lines.length });
    bus.emit(cid, 'change', { entity: 'resto_order', id });
    return { from: getOrder(db, cid, id), to: getOrder(db, cid, to.id) };
  });
}

/** Joins another check (another table) into this one. */
export function mergeOrders(db, bus, ctx, company, id, otherId) {
  const cid = company.id;
  const o = editable(db, cid, id), other = editable(db, cid, otherId);
  if (o.id === other.id) throw bad('same', 'Même addition');
  if (other.paid > 0) throw conflict('paid', 'L\'autre addition a déjà un paiement');
  return db.tx(() => {
    db.run('UPDATE resto_lines SET order_id = ? WHERE order_id = ?', o.id, other.id);
    db.run("UPDATE resto_orders SET status = 'void', void_reason = ?, closed_at = ? WHERE id = ?", `Fusionnée dans ${o.number}`, now(), other.id);
    db.run('UPDATE resto_orders SET covers = covers + ? WHERE id = ?', other.covers, o.id);
    recompute(db, company, o.id);
    audit(db, ctx, 'merge', 'resto_order', o.id, { merged: other.number });
    bus.emit(cid, 'change', { entity: 'resto_order', id });
    return getOrder(db, cid, o.id);
  });
}

export function voidOrder(db, bus, ctx, company, id, b = {}) {
  const cid = company.id;
  const o = editable(db, cid, id);
  if (o.paid > 0) throw conflict('paid', 'Des paiements existent : remboursez-les avant d\'annuler');
  const lines = db.all(`SELECT * FROM resto_lines WHERE order_id = ? AND ${ACTIVE}`, id);
  const sent = lines.some((l) => !['pending', 'held'].includes(l.status));
  if (sent) { checkManager(db, ctx, b.manager_pin, 'Annuler une addition envoyée en cuisine'); if (!str(b.reason)) throw bad('reason', 'Indiquez le motif'); }
  return db.tx(() => {
    for (const l of lines) { if (l.status === 'sent') restoreRecipe(db, cid, l.id, ctx.user?.id ?? null); }
    db.run("UPDATE resto_lines SET status = 'void', total = 0, void_reason = ?, voided_by = ? WHERE order_id = ? AND status <> 'void'", str(b.reason, 200) || 'Addition annulée', ctx.user?.id ?? null, id);
    db.run("UPDATE resto_orders SET status = 'void', void_reason = ?, closed_at = ?, subtotal = 0, total = 0, net_total = 0, vat_total = 0 WHERE id = ?", str(b.reason, 200), now(), id);
    if (sent) raiseAlert(db, bus, cid, { kind: 'resto_void', level: 'warning', title: `Addition ${o.number} annulée`, body: `${ctx.user?.name || ''} · ${str(b.reason, 200)}`, entity: 'resto_order', entity_id: id });
    audit(db, ctx, 'void', 'resto_order', id, { reason: b.reason });
    bus.emit(cid, 'change', { entity: 'resto_order', id });
    bus.emit(cid, 'kitchen', { order_id: id });
    return getOrder(db, cid, id);
  });
}

// ---------------- Kitchen display ----------------
/** Tickets for a station: one per check, with its lines in progress. */
export function kitchenTickets(db, companyId, q = {}) {
  const where = ['o.company_id = ?', "l.status IN ('sent','preparing','ready')"]; const a = [companyId];
  if (q.station_id) { where.push('l.station_id = ?'); a.push(q.station_id); }
  const rows = db.all(`SELECT l.*, o.number, o.kind, o.source, o.guest_name, o.covers, o.pickup_time, t.label table_label, u.name server_name, s.name station_name, s.kind station_kind
    FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id LEFT JOIN resto_tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.server_id LEFT JOIN resto_stations s ON s.id = l.station_id
    WHERE ${where.join(' AND ')} ORDER BY l.sent_at, l.id`, ...a);
  const tickets = new Map();
  for (const r of rows) {
    const k = `${r.order_id}|${r.station_id}|${r.sent_at}`;
    if (!tickets.has(k)) tickets.set(k, { key: k, order_id: r.order_id, number: r.number, kind: r.kind, source: r.source, table_label: r.table_label, guest_name: r.guest_name, covers: r.covers, server_name: r.server_name, station_id: r.station_id, station_name: r.station_name, sent_at: r.sent_at, pickup_time: r.pickup_time, lines: [] });
    tickets.get(k).lines.push({ id: r.id, name: r.name, qty: r.qty, options: r.options, note: r.note, seat: r.seat, course: r.course, status: r.status });
  }
  const list = [...tickets.values()].map((t) => ({ ...t, status: t.lines.every((l) => l.status === 'ready') ? 'ready' : t.lines.some((l) => l.status !== 'sent') ? 'preparing' : 'sent' }));
  // "All day": how many of each dish are waiting right now.
  const allDay = {};
  for (const r of rows) if (r.status !== 'ready') allDay[r.name] = (allDay[r.name] || 0) + r.qty;
  const held = db.all(`SELECT l.name, SUM(l.qty) qty, l.course FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND o.status = 'open' AND l.status = 'held' ${q.station_id ? 'AND l.station_id = ' + Number(q.station_id) : ''} GROUP BY l.name, l.course`, companyId);
  return { tickets: list, all_day: Object.entries(allDay).map(([name, qty]) => ({ name, qty })).sort((x, y) => y.qty - x.qty), held };
}

/** Bump: sent → preparing → ready → served, for some lines or a whole ticket. */
export function setLineStatus(db, bus, ctx, companyId, b) {
  const status = oneOf(b.status, ['preparing', 'ready', 'served', 'sent'], 'status');
  const ids = (Array.isArray(b.line_ids) ? b.line_ids : [b.line_id]).map(Number).filter(Boolean);
  if (!ids.length) throw bad('lines', 'Aucune ligne');
  const lines = db.all(`SELECT l.*, o.company_id, o.table_id, o.number, o.kind, o.server_id FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE l.id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (lines.some((l) => l.company_id !== companyId)) throw notFound();
  const at = now();
  db.tx(() => {
    for (const l of lines) {
      if (l.status === 'void') continue;
      db.run(`UPDATE resto_lines SET status = ?${status === 'ready' ? ', ready_at = ?' : status === 'served' ? ', served_at = ?' : ', sent_at = sent_at'} WHERE id = ?`, ...(status === 'ready' || status === 'served' ? [status, at, l.id] : [status, l.id]));
    }
  });
  const orders = [...new Set(lines.map((l) => l.order_id))];
  if (status === 'ready') {
    for (const oid of orders) {
      const o = db.get('SELECT o.*, t.label FROM resto_orders o LEFT JOIN resto_tables t ON t.id = o.table_id WHERE o.id = ?', oid);
      if (o.kind === 'delivery' && !db.get("SELECT 1 FROM resto_lines WHERE order_id = ? AND status IN ('pending','held','sent','preparing')", oid)) db.run("UPDATE resto_orders SET delivery_status = 'ready' WHERE id = ? AND delivery_status IN ('pending','preparing')", oid);
      bus.emit(companyId, 'ready', { order_id: oid, number: o.number, table: o.label || o.guest_name || o.number, server_id: o.server_id });
    }
  }
  bus.emit(companyId, 'kitchen', { orders });
  for (const oid of orders) bus.emit(companyId, 'change', { entity: 'resto_order', id: oid });
  return { ok: true, count: lines.length };
}

// ---------------- Cash sessions ----------------
export function openSessionFor(db, user) {
  return db.get("SELECT s.*, u.name user_name FROM resto_sessions s JOIN users u ON u.id = s.user_id WHERE s.company_id = ? AND s.user_id = ? AND s.status = 'open' ORDER BY s.id DESC LIMIT 1", user.company_id, user.id);
}
export function openSession(db, bus, ctx, b) {
  if (openSessionFor(db, ctx.user)) throw conflict('session_open', 'Vous avez déjà une caisse ouverte');
  const number = nextNumber(db, ctx.user.company_id, `CS-${today().slice(0, 4)}`);
  const r = db.run('INSERT INTO resto_sessions (company_id, user_id, number, opening_float, opened_at) VALUES (?,?,?,?,?)', ctx.user.company_id, ctx.user.id, number, int(b.opening_float, 'opening_float', { min: 0, def: 0 }), now());
  audit(db, ctx, 'open', 'resto_session', Number(r.lastInsertRowid));
  bus.emit(ctx.user.company_id, 'change', { entity: 'resto_session' });
  return openSessionFor(db, ctx.user);
}

export function sessionSummary(db, id) {
  const s = db.get('SELECT s.*, u.name user_name FROM resto_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?', id);
  if (!s) throw notFound('Session introuvable');
  const byMethod = db.all('SELECT method, SUM(amount) amount, SUM(tip) tips, COUNT(*) n FROM resto_payments WHERE session_id = ? GROUP BY method', id);
  const checks = db.get("SELECT COUNT(DISTINCT p.order_id) n, COALESCE(SUM(p.amount),0) total FROM resto_payments p WHERE p.session_id = ?", id);
  const moves = db.all('SELECT kind, SUM(amount) amount FROM resto_cash_moves WHERE session_id = ? GROUP BY kind', id);
  const mv = (k) => moves.find((m) => m.kind === k)?.amount || 0;
  const cash = byMethod.find((m) => m.method === 'cash');
  const expected = s.opening_float + (cash ? cash.amount + cash.tips : 0) + mv('in') - mv('out');
  const tips = byMethod.reduce((t, m) => t + m.tips, 0);
  return { session: s, byMethod, checks, tips, cash: { opening: s.opening_float, sales: cash?.amount || 0, tips: cash?.tips || 0, in: mv('in'), out: mv('out'), expected } };
}

export function cashMove(db, bus, ctx, b) {
  const s = openSessionFor(db, ctx.user);
  if (!s) throw conflict('no_session', 'Ouvrez votre caisse');
  const kind = oneOf(b.kind, ['in', 'out'], 'kind');
  const amount = int(b.amount, 'amount', { min: 1 });
  const reason = str(b.reason, 200);
  if (!reason) throw bad('reason', 'Indiquez le motif');
  db.tx(() => {
    db.run('INSERT INTO resto_cash_moves (company_id, session_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?,?)', ctx.user.company_id, s.id, kind, amount, reason, ctx.user.id, now());
    // Cash paid out (market purchase, tips handed to staff...) or brought in.
    const other = /pourboire|tip/i.test(reason) ? '4281' : kind === 'out' ? DEFAULTS.expenses : '758';
    postEntry(db, { companyId: ctx.user.company_id, journal: 'CA', date: today(), label: `${kind === 'out' ? 'Sortie' : 'Entrée'} de caisse ${s.number} – ${reason}`, ref: s.number, source_type: 'resto_cash', source_id: s.id, userId: ctx.user.id,
      lines: kind === 'out' ? [{ account: other, debit: amount }, { account: DEFAULTS.cash, credit: amount }] : [{ account: DEFAULTS.cash, debit: amount }, { account: other, credit: amount }] });
  });
  bus.emit(ctx.user.company_id, 'change', { entity: 'resto_session' });
  return sessionSummary(db, s.id);
}

/** Cash-up: counted vs expected. Sales are already in the books, only the difference is posted. */
export function closeSession(db, bus, ctx, id, b) {
  const s = db.get('SELECT * FROM resto_sessions WHERE id = ? AND company_id = ?', id, ctx.user.company_id);
  if (!s) throw notFound('Session introuvable');
  if (s.status !== 'open') throw conflict('closed', 'Cette caisse est déjà clôturée');
  if (s.user_id !== ctx.user.id && !MANAGERS.includes(ctx.user.role)) throw forbidden('Seul le titulaire ou un responsable peut clôturer');
  const open = db.get("SELECT COUNT(*) n FROM resto_orders WHERE company_id = ? AND server_id = ? AND status = 'open' AND total > 0", ctx.user.company_id, s.user_id).n;
  if (open && !b.force) throw conflict('open_checks', `${open} addition(s) encore ouverte(s) pour ce serveur. Encaissez-les ou transférez-les.`);
  const counted = int(b.counted_cash, 'counted_cash', { min: 0 });
  const sum = sessionSummary(db, id);
  const variance = counted - sum.cash.expected;
  return db.tx(() => {
    let entryId = null;
    if (variance) entryId = postEntry(db, { companyId: s.company_id, journal: 'CA', date: today(), label: `Écart de caisse ${s.number} (${sum.session.user_name})`, ref: s.number, source_type: 'resto_session', source_id: s.id, userId: ctx.user.id,
      lines: variance < 0 ? [{ account: '658', debit: -variance }, { account: DEFAULTS.cash, credit: -variance }] : [{ account: DEFAULTS.cash, debit: variance }, { account: '758', credit: variance }] });
    db.run("UPDATE resto_sessions SET status = 'closed', closed_at = ?, expected_cash = ?, counted_cash = ?, variance = ?, close_note = ?, entry_id = ? WHERE id = ?", now(), sum.cash.expected, counted, variance, str(b.note, 300), entryId, id);
    raiseAlert(db, bus, s.company_id, variance ? { kind: 'resto_variance', level: Math.abs(variance) >= 1000 ? 'danger' : 'warning', title: `Caisse ${sum.session.user_name} : écart ${variance > 0 ? '+' : ''}${fcfa(variance)}`, body: `Attendu ${fcfa(sum.cash.expected)}, compté ${fcfa(counted)}.`, entity: 'resto_session', entity_id: id }
      : { kind: 'resto_closed', level: 'success', title: `Caisse ${sum.session.user_name} clôturée sans écart`, body: `${sum.checks.n} addition(s), pourboires ${fcfa(sum.tips)}.`, entity: 'resto_session', entity_id: id });
    audit(db, ctx, 'close', 'resto_session', id, { expected: sum.cash.expected, counted, variance });
    bus.emit(s.company_id, 'change', { entity: 'resto_session', id });
    return sessionSummary(db, id);
  });
}

// ---------------- Payments ----------------
/**
 * Takes a payment on a check. body: { method, amount, tip, tendered, reference, payer, momo_id, partner_id }
 * When the check is fully paid it closes: accounting entry (or invoice for a
 * company account), loyalty points, table freed, reservation done.
 */
export function pay(db, bus, ctx, company, id, b, { source = 'staff', momoRow = null } = {}) {
  const cid = company.id;
  const o = editable(db, cid, id);
  const method = oneOf(b.method, Object.keys(PAY), 'method');
  const due = o.total - o.paid;
  if (due <= 0 && o.total > 0) throw conflict('paid', 'Rien à payer');
  let amount = b.amount === undefined || b.amount === '' ? due : int(b.amount, 'amount', { min: 0 });
  const tip = int(b.tip, 'tip', { min: 0, def: 0 });
  let tendered = 0, change = 0;
  if (method === 'cash') {
    tendered = b.tendered === undefined || b.tendered === '' ? amount + tip : int(b.tendered, 'tendered', { min: 0 });
    amount = Math.min(amount, due);
    if (tendered < amount + tip) throw bad('underpay', `Il manque ${fcfa(amount + tip - tendered)}`);
    change = tendered - amount - tip;
  } else if (amount > due) throw bad('overpay', `Le reste à payer est de ${fcfa(due)}`);
  if (amount <= 0 && o.total > 0) throw bad('amount', 'Montant invalide');
  if (method === 'account') {
    if (amount !== due) throw bad('account', 'Le compte client règle tout le reste de l\'addition');
    if (!b.partner_id && !o.customer_id) throw bad('partner', 'Choisissez l\'entreprise ou le client à facturer');
    if (!can(ctx.user, 'sales') && !MANAGERS.includes(ctx.user.role)) checkManager(db, ctx, b.manager_pin, 'Mettre sur le compte d\'un client');
  }
  let session = null;
  if (source === 'staff') {
    session = openSessionFor(db, ctx.user);
    if (!session && method === 'cash') throw conflict('no_session', 'Ouvrez votre caisse avant d\'encaisser des espèces');
  }
  let reference = str(b.reference, 80);
  if (['mtn_momo', 'orange_money'].includes(method) && b.momo_id && !momoRow) {
    const m = db.get('SELECT * FROM resto_momo WHERE id = ? AND company_id = ? AND order_id = ?', b.momo_id, cid, id);
    if (!m || m.status !== 'successful') throw conflict('momo', 'Paiement Mobile Money pas encore confirmé');
    if (m.amount !== amount + tip) throw bad('momo', 'Le montant Mobile Money ne correspond pas');
    reference = m.transaction_id || m.provider_ref;
    momoRow = m;
  }
  return db.tx(() => {
    if (momoRow) {
      const r = db.run("UPDATE resto_momo SET status = 'used' WHERE id = ? AND status = 'successful'", momoRow.id);
      if (!r.changes) throw conflict('momo', 'Ce paiement Mobile Money a déjà été utilisé');
    }
    if (method === 'account' && b.partner_id) {
      const p = db.get("SELECT id FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", b.partner_id, cid);
      if (!p) throw bad('partner', 'Client introuvable');
      db.run('UPDATE resto_orders SET customer_id = ? WHERE id = ?', p.id, id);
    }
    db.run('INSERT INTO resto_payments (company_id, order_id, method, amount, tip, tendered, change_given, reference, payer, session_id, user_id, source, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      cid, id, method, amount, tip, tendered, change, reference, str(b.payer, 60), session?.id ?? null, ctx.user?.id ?? null, source, now());
    db.run('UPDATE resto_orders SET paid = paid + ?, tips = tips + ? WHERE id = ?', amount, tip, id);
    const after = db.get('SELECT * FROM resto_orders WHERE id = ?', id);
    if (after.paid >= after.total) closeOrder(db, bus, ctx, company, id);
    bus.emit(cid, 'change', { entity: 'resto_order', id });
    const res = getOrder(db, cid, id);
    res.change = change;
    return res;
  });
}

function closeOrder(db, bus, ctx, company, id) {
  const cid = company.id;
  const o = db.get('SELECT * FROM resto_orders WHERE id = ?', id);
  // Anything not yet sent (drinks rung up at the bar, a forgotten line) is sent now so stock and cost follow.
  for (const l of db.all("SELECT * FROM resto_lines WHERE order_id = ? AND status IN ('pending','held')", id)) {
    const cost = consumeRecipe(db, cid, l.product_id, l.qty, { ref_id: l.id, userId: ctx.user?.id ?? null });
    db.run("UPDATE resto_lines SET status = 'served', sent_at = COALESCE(sent_at, ?), served_at = ?, cost = ? WHERE id = ?", now(), now(), Math.round(cost), l.id);
  }
  db.run("UPDATE resto_lines SET status = 'served', served_at = COALESCE(served_at, ?) WHERE order_id = ? AND status IN ('sent','preparing','ready')", now(), id);
  recompute(db, company, id);
  const fresh = db.get('SELECT * FROM resto_orders WHERE id = ?', id);
  const s = settingsOf(db, cid);
  const lines = db.all(`SELECT * FROM resto_lines WHERE order_id = ? AND ${ACTIVE}`, id);
  const parts = allocate(company, lines, fresh.discount + Math.min(fresh.points_used * s.point_value, fresh.subtotal - fresh.discount), fresh.service_charge, fresh.delivery_fee);
  const pays = db.all('SELECT * FROM resto_payments WHERE order_id = ?', id);
  const label = `${o.kind === 'dine_in' ? 'Restaurant' : KINDS[o.kind].fr} ${o.number}`;
  const onAccount = pays.find((p) => p.method === 'account');
  let entryId = null, docId = null;
  if (onAccount) {
    // Company account: a validated Compta invoice (statement, reminders, payment link); other payments settle part of it.
    docId = invoiceFromTtc(db, ctx, company, { partner_id: fresh.customer_id, subject: `${label}${fresh.covers ? ` – ${fresh.covers} couvert(s)` : ''}`, lines: parts.map((p) => ({ description: p.description + (p.qty && p.qty !== 1 ? ` × ${p.qty}` : ''), account_code: p.account, vat_rate: p.rate, net: p.net, vat: p.vat, amount: p.amount })) });
    for (const p of pays.filter((x) => x.method !== 'account' && x.amount > 0)) tr.recordPayment(db, sys(ctx), company, { document_id: docId, method: PAY[p.method].compta, amount: p.amount, reference: p.reference || o.number });
    const tips = pays.filter((p) => p.tip > 0 && p.method !== 'account');
    if (tips.length) entryId = postEntry(db, { companyId: cid, journal: 'CA', date: today(), label: `Pourboires ${o.number}`, ref: o.number, source_type: 'resto_order', source_id: id, userId: ctx.user?.id ?? null,
      lines: [...tips.map((p) => ({ account: PAY[p.method].account, debit: p.tip })), { account: '4281', credit: tips.reduce((t, p) => t + p.tip, 0) }] });
  } else if (fresh.total > 0 || fresh.tips > 0) {
    const acc = new Map();
    const add = (account, v) => { if (v) acc.set(account, (acc.get(account) || 0) + v); };
    for (const p of pays) add(PAY[p.method].account, p.amount + p.tip);
    for (const p of parts) { add(p.account, -p.net); add(p.account.startsWith('7011') || p.account.startsWith('7021') || p.account === '701' ? DEFAULTS.vat_collected : DEFAULTS.vat_collected_services, -p.vat); }
    add('4281', -fresh.tips);
    const overpaid = fresh.paid - fresh.total; // offline price change: keep the books balanced
    if (overpaid > 0) add('758', -overpaid); else if (overpaid < 0) add('658', -overpaid);
    const jl = [...acc.entries()].filter(([, v]) => v).map(([account, v]) => ({ account, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 }));
    if (jl.length >= 2) entryId = postEntry(db, { companyId: cid, journal: pays.every((p) => p.method === 'cash') ? 'CA' : 'VT', date: today(), label, ref: o.number, source_type: 'resto_order', source_id: id, userId: ctx.user?.id ?? null, lines: jl });
  }
  db.run("UPDATE resto_orders SET status = 'paid', closed_at = ?, entry_id = ?, document_id = ?, delivery_status = CASE WHEN kind = 'delivery' AND delivery_status <> 'delivered' THEN delivery_status ELSE delivery_status END WHERE id = ?", now(), entryId, docId, id);
  // Loyalty
  if (fresh.customer_id) {
    const earned = s.points_per_1000 > 0 ? Math.floor(Math.max(0, fresh.total) / 1000) * s.points_per_1000 : 0;
    db.run('INSERT OR IGNORE INTO resto_customers (partner_id, company_id) VALUES (?,?)', fresh.customer_id, cid);
    db.run('UPDATE resto_customers SET points = MAX(0, points - ? + ?), visits = visits + 1, spent = spent + ?, last_visit = ? WHERE partner_id = ?', fresh.points_used, earned, fresh.total, today(), fresh.customer_id);
  }
  if (fresh.reservation_id) db.run("UPDATE resto_reservations SET status = 'done' WHERE id = ?", fresh.reservation_id);
  db.run("UPDATE resto_calls SET status = 'done', done_at = ? WHERE order_id = ? AND status = 'open'", now(), id);
  bus.emit(cid, 'kitchen', { order_id: id });
}

/** A validated Compta invoice keeping the exact TTC amounts of the check. */
export function invoiceFromTtc(db, ctx, company, { partner_id, subject, lines }) {
  const docId = docs.createDocument(db, sys(ctx), company, { kind: 'invoice', partner_id, date: today(), subject,
    lines: lines.map((l) => ({ description: l.description, qty: 1, unit_price: l.net, vat_rate: l.vat_rate, account_code: l.account_code, kind: 'good' })) });
  const dl = db.all('SELECT id FROM document_lines WHERE document_id = ? ORDER BY position', docId);
  dl.forEach((x, i) => db.run('UPDATE document_lines SET vat = ?, total = ? WHERE id = ?', lines[i].vat, lines[i].amount, x.id));
  const t = db.get('SELECT SUM(net) net, SUM(vat) vat, SUM(total) total FROM document_lines WHERE document_id = ?', docId);
  db.run('UPDATE documents SET subtotal = ?, vat_total = ?, total = ? WHERE id = ?', t.net, t.vat, t.total, docId);
  docs.validateDocument(db, sys(ctx), company, docId);
  return docId;
}

// ---------------- Mobile Money ----------------
export async function momoRequest(db, momo, ctx, company, orderId, b, { source = 'staff' } = {}) {
  const o = editable(db, company.id, orderId);
  const provider = oneOf(b.provider, Object.keys(PROVIDERS), 'provider');
  if (!momo.configured(provider)) throw conflict('momo_config', `${PROVIDERS[provider].fr} n'est pas encore activé pour ce restaurant`);
  const tip = int(b.tip, 'tip', { min: 0, def: 0 });
  const due = o.total - o.paid;
  const amount = b.amount === undefined || b.amount === '' ? due : Math.min(due, int(b.amount, 'amount', { min: 1 }));
  if (amount <= 0) throw conflict('paid', 'Rien à payer');
  const phone = normalizePhone(b.phone);
  const res = await momo.requestPayment({ provider, phone, amount: amount + tip, reference: o.number, description: `${company.name} – addition ${o.number}` });
  const r = db.run('INSERT INTO resto_momo (company_id, order_id, provider, phone, amount, tip, payer, provider_ref, source, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    company.id, orderId, provider, phone, amount + tip, tip, str(b.payer, 60), res.providerRef, source, ctx.user?.id ?? null, now());
  return { id: Number(r.lastInsertRowid), status: 'pending', amount: amount + tip };
}

/** Checks a Mobile Money request; when confirmed, the payment is applied to the check automatically. */
export async function momoStatus(db, bus, momo, ctx, company, momoId) {
  const m = db.get('SELECT * FROM resto_momo WHERE id = ? AND company_id = ?', momoId, company.id);
  if (!m) throw notFound('Demande introuvable');
  if (m.status === 'pending') {
    let st;
    try { st = await momo.checkStatus(m.provider, m.provider_ref); } catch (e) { return { id: m.id, status: 'pending', note: e.message }; }
    if (st.status === 'successful') db.run("UPDATE resto_momo SET status = 'successful', transaction_id = ? WHERE id = ? AND status = 'pending'", st.transactionId || '', m.id);
    else if (st.status === 'failed') db.run("UPDATE resto_momo SET status = 'failed', reason = ? WHERE id = ?", String(st.reason || '').slice(0, 200), m.id);
    else if (Date.now() - Date.parse(m.created_at) > 5 * 60e3) db.run("UPDATE resto_momo SET status = 'failed', reason = 'Délai dépassé' WHERE id = ?", m.id);
  }
  let row = db.get('SELECT * FROM resto_momo WHERE id = ?', m.id);
  if (row.status === 'successful') {
    const o = db.get('SELECT * FROM resto_orders WHERE id = ?', row.order_id);
    const due = o.total - o.paid;
    if (o.status === 'open' && due > 0) {
      const amount = Math.min(due, row.amount - row.tip);
      const tip = row.amount - amount;
      const user = ctx.user || { id: row.user_id, company_id: company.id, name: 'Mobile Money', role: 'owner' };
      try {
        pay(db, bus, { ...ctx, user }, company, o.id, { method: row.provider, amount, tip, reference: row.transaction_id || row.provider_ref, payer: row.payer }, { source: row.source === 'staff' ? 'momo' : row.source, momoRow: row });
      } catch (e) { if (e.code !== 'momo') throw e; }
    } else {
      db.run("UPDATE resto_momo SET status = 'used', reason = 'Addition déjà soldée : à rembourser' WHERE id = ?", row.id);
      raiseAlert(db, bus, company.id, { kind: 'resto_momo_extra', level: 'warning', title: `Paiement Mobile Money en trop sur ${o.number}`, body: `${fcfa(row.amount)} reçu de ${row.phone} alors que l'addition était soldée.`, entity: 'resto_order', entity_id: o.id });
    }
    row = db.get('SELECT * FROM resto_momo WHERE id = ?', m.id);
  }
  return { id: row.id, status: row.status === 'used' ? 'successful' : row.status, reason: row.reason, amount: row.amount, transaction_id: row.transaction_id };
}
