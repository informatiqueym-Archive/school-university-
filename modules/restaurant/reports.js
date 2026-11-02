// Restaurant figures: live dashboard, sales by day / hour / channel, menu
// engineering (stars, plowhorses, puzzles, dogs), waiter performance with tips,
// kitchen speed, voids and comps, Z report, and the forecast engine: covers and
// portions expected for the next days, ingredients to buy, and plain-language
// insights for the owner.
import { today } from '../../core/schema.js';
import { addDays } from '../../core/validate.js';
import { fcfa } from '../../core/format.js';
import { settingsOf } from './orders.js';

export function range(q = {}) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : addDays(to, -29);
  return { from, to };
}
const PAID = "o.status = 'paid'";
const day = (col = 'o.closed_at') => `substr(${col},1,10)`;
const hour = (col = 'o.opened_at') => `CAST(substr(datetime(${col}, '+1 hour'),12,2) AS INTEGER)`;

export function dashboard(db, cid) {
  const d = today();
  const s = settingsOf(db, cid);
  const sales = db.get(`SELECT COUNT(*) checks, COALESCE(SUM(total),0) total, COALESCE(SUM(net_total),0) net, COALESCE(SUM(covers),0) covers, COALESCE(SUM(tips),0) tips, COALESCE(SUM(cost_total),0) cost
    FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} = ?`, cid, d);
  const yesterday = db.get(`SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(covers),0) covers FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} = ?`, cid, addDays(d, -1));
  const lastWeek = db.get(`SELECT COALESCE(SUM(total),0) total FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} = ?`, cid, addDays(d, -7));
  const open = db.get("SELECT COUNT(*) n, COALESCE(SUM(total - paid),0) due, COALESCE(SUM(covers),0) covers FROM resto_orders WHERE company_id = ? AND status = 'open'", cid);
  const tables = db.get('SELECT COUNT(*) n, COALESCE(SUM(seats),0) seats FROM resto_tables WHERE company_id = ? AND active = 1', cid);
  const busy = db.get("SELECT COUNT(DISTINCT table_id) n FROM resto_orders WHERE company_id = ? AND status = 'open' AND table_id IS NOT NULL", cid).n;
  const kitchen = db.get(`SELECT COUNT(*) n, AVG((julianday(ready_at) - julianday(sent_at)) * 1440) avg_min FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND l.ready_at IS NOT NULL AND substr(l.ready_at,1,10) = ?`, cid, d);
  const waiting = db.get("SELECT COUNT(*) n, MIN(l.sent_at) oldest FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND l.status IN ('sent','preparing')", cid);
  const hourly = db.all(`SELECT ${hour('o.closed_at')} h, SUM(total) v, SUM(covers) c FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} = ? GROUP BY h ORDER BY h`, cid, d);
  const top = db.all(`SELECT l.name, SUM(l.qty) qty, SUM(l.total) v FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND l.status <> 'void' AND substr(l.created_at,1,10) = ? GROUP BY l.product_id ORDER BY qty DESC LIMIT 6`, cid, d);
  const payments = db.all(`SELECT p.method, SUM(p.amount) v, SUM(p.tip) tips FROM resto_payments p WHERE p.company_id = ? AND substr(p.at,1,10) = ? GROUP BY p.method ORDER BY v DESC`, cid, d);
  const channels = db.all(`SELECT kind, source, COUNT(*) n, SUM(total) v FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} = ? GROUP BY kind, source`, cid, d);
  const reservations = db.all("SELECT r.id, r.name, r.time, r.covers, r.status, r.occasion, t.label table_label, rc.vip FROM resto_reservations r LEFT JOIN resto_tables t ON t.id = r.table_id LEFT JOIN resto_customers rc ON rc.partner_id = r.customer_id WHERE r.company_id = ? AND r.date = ? AND r.status IN ('booked','confirmed','arrived','waiting') ORDER BY r.time", cid, d);
  const low = db.all('SELECT id, name, stock, min_stock, unit FROM resto_ingredients WHERE company_id = ? AND active = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY stock / min_stock LIMIT 8', cid);
  const sold_out = db.all('SELECT p.name FROM resto_items i JOIN products p ON p.id = i.product_id WHERE i.company_id = ? AND p.active = 1 AND i.available = 0', cid).map((x) => x.name);
  const feedback = db.get("SELECT COUNT(*) n, AVG(rating) avg FROM resto_feedback WHERE company_id = ? AND at >= datetime('now','-30 days')", cid);
  const voids = db.get("SELECT COUNT(*) n, COALESCE(SUM(l.qty * l.unit_price),0) v FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND l.status = 'void' AND l.sent_at IS NOT NULL AND substr(l.created_at,1,10) = ?", cid, d);
  const calls = db.get("SELECT COUNT(*) n FROM resto_calls WHERE company_id = ? AND status = 'open'", cid).n;
  const deliveries = db.get("SELECT COUNT(*) n FROM resto_orders WHERE company_id = ? AND kind = 'delivery' AND delivery_status IN ('pending','preparing','ready','on_the_way') AND opened_at >= datetime('now','-1 day')", cid).n;
  const trend = db.all(`SELECT ${day()} d, SUM(total) v, SUM(covers) c FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} >= ? GROUP BY d ORDER BY d`, cid, addDays(d, -13));
  const fc = forecast(db, cid, 1)[0];
  return {
    date: d, sales: { ...sales, avg_check: sales.checks ? Math.round(sales.total / sales.checks) : 0, per_cover: sales.covers ? Math.round(sales.total / sales.covers) : 0, food_cost_pct: sales.net ? Math.round(sales.cost * 1000 / sales.net) / 10 : 0 },
    yesterday, last_week: lastWeek, open, tables: { ...tables, busy }, kitchen: { avg_min: kitchen.avg_min ? Math.round(kitchen.avg_min * 10) / 10 : null, done: kitchen.n, waiting: waiting.n, oldest: waiting.oldest, target: s.prep_target_min },
    hourly, top, payments, channels, reservations, low, sold_out, feedback: { n: feedback.n, avg: feedback.avg ? Math.round(feedback.avg * 10) / 10 : null }, voids, calls, deliveries, trend, forecast_today: fc,
    insights: insights(db, cid).slice(0, 4),
  };
}

export function salesReport(db, cid, q) {
  const { from, to } = range(q);
  const days = db.all(`SELECT ${day()} d, COUNT(*) checks, SUM(covers) covers, SUM(total) total, SUM(net_total) net, SUM(vat_total) vat, SUM(discount) discount, SUM(service_charge) service, SUM(tips) tips, SUM(cost_total) cost
    FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} BETWEEN ? AND ? GROUP BY d ORDER BY d`, cid, from, to);
  const tot = days.reduce((t, x) => { for (const k of ['checks', 'covers', 'total', 'net', 'vat', 'discount', 'service', 'tips', 'cost']) t[k] = (t[k] || 0) + (x[k] || 0); return t; }, {});
  const byHour = db.all(`SELECT ${hour()} h, COUNT(*) checks, SUM(total) total, SUM(covers) covers FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} BETWEEN ? AND ? GROUP BY h ORDER BY h`, cid, from, to);
  const byWeekday = db.all(`SELECT CAST(strftime('%w', ${day()}) AS INTEGER) wd, COUNT(DISTINCT ${day()}) days, SUM(total) total, SUM(covers) covers FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} BETWEEN ? AND ? GROUP BY wd ORDER BY wd`, cid, from, to);
  const byChannel = db.all(`SELECT kind, source, COUNT(*) checks, SUM(total) total FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} BETWEEN ? AND ? GROUP BY kind, source ORDER BY total DESC`, cid, from, to);
  const byCategory = db.all(`SELECT c.name, SUM(l.qty) qty, SUM(l.total) total, SUM(l.cost) cost FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id JOIN resto_items i ON i.product_id = l.product_id JOIN resto_categories c ON c.id = i.category_id
    WHERE o.company_id = ? AND ${PAID} AND l.status <> 'void' AND ${day()} BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`, cid, from, to);
  const byMethod = db.all(`SELECT p.method, COUNT(*) n, SUM(p.amount) amount, SUM(p.tip) tips FROM resto_payments p JOIN resto_orders o ON o.id = p.order_id WHERE o.company_id = ? AND ${day('p.at')} BETWEEN ? AND ? GROUP BY p.method ORDER BY amount DESC`, cid, from, to);
  return { from, to, days, total: { ...tot, avg_check: tot.checks ? Math.round(tot.total / tot.checks) : 0, per_cover: tot.covers ? Math.round(tot.total / tot.covers) : 0, food_cost_pct: tot.net ? Math.round(tot.cost * 1000 / tot.net) / 10 : 0 }, byHour, byWeekday, byChannel, byCategory, byMethod };
}

/** Menu engineering: popularity (share of portions) against unit margin. */
export function menuEngineering(db, cid, q) {
  const { from, to } = range(q);
  const rows = db.all(`SELECT l.product_id id, p.name, c.name category, SUM(l.qty) qty, SUM(l.total) revenue, SUM(l.cost) cost, i.price, p.vat_rate
    FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id JOIN products p ON p.id = l.product_id JOIN resto_items i ON i.product_id = p.id JOIN resto_categories c ON c.id = i.category_id
    WHERE o.company_id = ? AND ${PAID} AND l.status <> 'void' AND ${day()} BETWEEN ? AND ? GROUP BY l.product_id`, cid, from, to);
  const company = db.get('SELECT vat_enabled, vat_rate FROM companies WHERE id = ?', cid);
  const items = rows.map((r) => {
    const rate = r.vat_rate ?? (company.vat_enabled ? company.vat_rate : 0);
    const net = r.revenue / (1 + rate / 100);
    const unitCost = r.qty ? r.cost / r.qty : 0;
    return { ...r, net: Math.round(net), margin: Math.round(net - r.cost), unit_margin: r.qty ? Math.round((net - r.cost) / r.qty) : 0, unit_cost: Math.round(unitCost), food_cost_pct: net ? Math.round((r.cost / net) * 1000) / 10 : 0 };
  });
  const n = items.length || 1;
  const totalQty = items.reduce((t, x) => t + x.qty, 0) || 1;
  const avgMargin = items.reduce((t, x) => t + x.margin, 0) / totalQty;
  const popLine = (1 / n) * 0.7 * totalQty; // classic 70 % rule
  for (const x of items) {
    const popular = x.qty >= popLine, profitable = x.unit_margin >= avgMargin;
    x.class = popular && profitable ? 'star' : popular ? 'plowhorse' : profitable ? 'puzzle' : 'dog';
    x.mix_pct = Math.round((x.qty / totalQty) * 1000) / 10;
  }
  items.sort((a, b) => b.margin - a.margin);
  return { from, to, items, avg_margin: Math.round(avgMargin), pop_line: Math.round(popLine * 10) / 10 };
}

export function staffReport(db, cid, q) {
  const { from, to } = range(q);
  const servers = db.all(`SELECT u.id, u.name, COUNT(*) checks, SUM(o.covers) covers, SUM(o.total) total, SUM(o.tips) tips, AVG((julianday(o.closed_at) - julianday(o.opened_at)) * 1440) turn_min
    FROM resto_orders o JOIN users u ON u.id = o.server_id WHERE o.company_id = ? AND ${PAID} AND ${day()} BETWEEN ? AND ? GROUP BY u.id ORDER BY total DESC`, cid, from, to)
    .map((r) => ({ ...r, avg_check: r.checks ? Math.round(r.total / r.checks) : 0, per_cover: r.covers ? Math.round(r.total / r.covers) : 0, turn_min: r.turn_min ? Math.round(r.turn_min) : null }));
  const voids = db.all(`SELECT u.name, COUNT(*) n, SUM(l.qty * l.unit_price) v FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id LEFT JOIN users u ON u.id = l.voided_by
    WHERE o.company_id = ? AND l.status = 'void' AND l.sent_at IS NOT NULL AND substr(l.created_at,1,10) BETWEEN ? AND ? GROUP BY l.voided_by ORDER BY v DESC`, cid, from, to);
  const comps = db.all(`SELECT l.name, l.qty, l.unit_price, l.discount_pct, l.comp, o.number, l.created_at FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id
    WHERE o.company_id = ? AND l.status <> 'void' AND (l.comp = 1 OR l.discount_pct > 0) AND substr(l.created_at,1,10) BETWEEN ? AND ? ORDER BY l.id DESC LIMIT 100`, cid, from, to);
  const voidList = db.all(`SELECT l.name, l.qty, l.unit_price, l.void_reason, o.number, u.name user_name, l.created_at FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id LEFT JOIN users u ON u.id = l.voided_by
    WHERE o.company_id = ? AND l.status = 'void' AND l.sent_at IS NOT NULL AND substr(l.created_at,1,10) BETWEEN ? AND ? ORDER BY l.id DESC LIMIT 100`, cid, from, to);
  const kitchen = db.all(`SELECT s.name, COUNT(*) n, AVG((julianday(l.ready_at) - julianday(l.sent_at)) * 1440) avg_min, MAX((julianday(l.ready_at) - julianday(l.sent_at)) * 1440) max_min
    FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id JOIN resto_stations s ON s.id = l.station_id WHERE o.company_id = ? AND l.ready_at IS NOT NULL AND substr(l.created_at,1,10) BETWEEN ? AND ? GROUP BY s.id`, cid, from, to)
    .map((r) => ({ ...r, avg_min: Math.round(r.avg_min * 10) / 10, max_min: Math.round(r.max_min) }));
  const sessions = db.all(`SELECT s.*, u.name user_name FROM resto_sessions s JOIN users u ON u.id = s.user_id WHERE s.company_id = ? AND substr(s.opened_at,1,10) BETWEEN ? AND ? ORDER BY s.id DESC LIMIT 100`, cid, from, to);
  const feedback = db.all(`SELECT f.*, o.number, u.name server_name FROM resto_feedback f LEFT JOIN resto_orders o ON o.id = f.order_id LEFT JOIN users u ON u.id = o.server_id WHERE f.company_id = ? AND substr(f.at,1,10) BETWEEN ? AND ? ORDER BY f.id DESC LIMIT 100`, cid, from, to);
  return { from, to, servers, voids, voidList, comps, kitchen, sessions, feedback };
}

/** Z report: everything for one business day. */
export function zReport(db, cid, d = today()) {
  const r = salesReport(db, cid, { from: d, to: d });
  const voids = db.get(`SELECT COUNT(*) n, COALESCE(SUM(l.qty * l.unit_price),0) v FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND l.status = 'void' AND l.sent_at IS NOT NULL AND substr(l.created_at,1,10) = ?`, cid, d);
  const comps = db.get(`SELECT COUNT(*) n, COALESCE(SUM(l.qty * l.unit_price - l.total),0) v FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND l.status <> 'void' AND (l.comp = 1 OR l.discount_pct > 0) AND substr(l.created_at,1,10) = ?`, cid, d);
  const open = db.get("SELECT COUNT(*) n, COALESCE(SUM(total - paid),0) due FROM resto_orders WHERE company_id = ? AND status = 'open'", cid);
  const sessions = db.all('SELECT s.number, s.status, s.opening_float, s.expected_cash, s.counted_cash, s.variance, u.name FROM resto_sessions s JOIN users u ON u.id = s.user_id WHERE s.company_id = ? AND substr(s.opened_at,1,10) = ?', cid, d);
  const vat = db.all(`SELECT l.vat_rate rate, SUM(l.total) ttc FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id WHERE o.company_id = ? AND ${PAID} AND l.status <> 'void' AND ${day()} = ? GROUP BY l.vat_rate`, cid, d);
  return { date: d, ...r, voids, comps, open, sessions, vat };
}

// ---------------- Forecast and insights ----------------
/**
 * Covers and revenue expected for the next days: average of the same weekday
 * over the last 4 weeks, weighted to the most recent, plus reservations already
 * taken. Portions per dish follow each dish's share of covers.
 */
export function forecast(db, cid, days = 7) {
  const d0 = today();
  const hist = db.all(`SELECT ${day()} d, SUM(covers) covers, SUM(total) total, COUNT(*) checks FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} >= ? AND ${day()} < ? GROUP BY d`, cid, addDays(d0, -28), d0);
  const byDate = Object.fromEntries(hist.map((h) => [h.d, h]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(d0, i);
    let wSum = 0, covers = 0, total = 0;
    [1, 2, 3, 4].forEach((k, idx) => { const h = byDate[addDays(date, -7 * k)]; const w = [0.4, 0.3, 0.2, 0.1][idx]; if (h) { covers += h.covers * w; total += h.total * w; wSum += w; } });
    const booked = db.get("SELECT COALESCE(SUM(covers),0) c, COUNT(*) n FROM resto_reservations WHERE company_id = ? AND date = ? AND status IN ('booked','confirmed','arrived','seated','done')", cid, date);
    const base = wSum ? covers / wSum : 0;
    out.push({ date, covers: Math.round(Math.max(base, booked.c * 1.15)), revenue: Math.round(wSum ? total / wSum : 0) * (base ? Math.max(1, booked.c * 1.15 / base) : 1), booked: booked.c, reservations: booked.n, confidence: wSum >= 0.7 ? 'high' : wSum >= 0.3 ? 'medium' : 'low' });
  }
  return out.map((x) => ({ ...x, revenue: Math.round(x.revenue) }));
}

/** Ingredients to order to cover the forecast (with a safety margin) given current stock. */
export function purchasePlan(db, cid, days = 3) {
  const fc = forecast(db, cid, days);
  const coversAhead = fc.reduce((t, x) => t + x.covers, 0);
  const past = db.get(`SELECT COALESCE(SUM(covers),0) c FROM resto_orders o WHERE company_id = ? AND ${PAID} AND ${day()} >= ?`, cid, addDays(today(), -28)).c || 1;
  const usage = db.all(`SELECT m.ingredient_id id, -SUM(m.qty) used FROM resto_stock_moves m WHERE m.company_id = ? AND m.kind IN ('sale','void','waste') AND m.at >= datetime('now','-28 days') GROUP BY m.ingredient_id`, cid);
  const ing = Object.fromEntries(db.all('SELECT g.*, p.name supplier_name, p.phone supplier_phone FROM resto_ingredients g LEFT JOIN partners p ON p.id = g.supplier_id WHERE g.company_id = ? AND g.active = 1', cid).map((g) => [g.id, g]));
  const lines = [];
  for (const u of usage) {
    const g = ing[u.id]; if (!g || u.used <= 0) continue;
    const need = (u.used / past) * coversAhead * 1.15 + g.min_stock;
    const buy = Math.ceil((need - Math.max(0, g.stock)) * 10) / 10;
    if (buy > 0) lines.push({ ingredient_id: g.id, name: g.name, unit: g.unit, stock: Math.round(g.stock * 100) / 100, need: Math.round(need * 10) / 10, buy, cost: Math.round(buy * g.cost), supplier_id: g.supplier_id, supplier_name: g.supplier_name, supplier_phone: g.supplier_phone });
  }
  for (const g of Object.values(ing)) if (g.min_stock > 0 && g.stock < g.min_stock && !lines.some((l) => l.ingredient_id === g.id)) lines.push({ ingredient_id: g.id, name: g.name, unit: g.unit, stock: g.stock, need: g.min_stock, buy: Math.ceil((g.min_stock * 1.5 - g.stock) * 10) / 10, cost: Math.round((g.min_stock * 1.5 - g.stock) * g.cost), supplier_id: g.supplier_id, supplier_name: g.supplier_name, supplier_phone: g.supplier_phone });
  lines.sort((a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || '') || b.cost - a.cost);
  return { days, covers: coversAhead, forecast: fc, lines, total: lines.reduce((t, l) => t + l.cost, 0) };
}

/** Plain-language findings, most useful first. */
export function insights(db, cid) {
  const out = [];
  const d = today();
  const me = menuEngineering(db, cid, { from: addDays(d, -29), to: d });
  const dogs = me.items.filter((x) => x.class === 'dog' && x.qty > 0).slice(0, 3);
  const plow = me.items.filter((x) => x.class === 'plowhorse').sort((a, b) => b.qty - a.qty)[0];
  const highCost = me.items.filter((x) => x.food_cost_pct > 38 && x.qty >= 5).sort((a, b) => b.food_cost_pct - a.food_cost_pct)[0];
  if (plow) out.push({ level: 'info', icon: 'chart', title: `${plow.name} se vend très bien mais rapporte peu`, body: `${Math.round(plow.qty)} portions en 30 jours, marge de ${fcfa(plow.unit_margin)} par assiette. Une hausse de 500 FCFA rapporterait environ ${fcfa(Math.round(plow.qty * 500 / 1.1925))} de plus par mois.` });
  if (highCost) out.push({ level: 'warn', icon: 'percent', title: `Coût matière élevé : ${highCost.name} (${String(highCost.food_cost_pct).replace('.', ',')} %)`, body: 'La cible en restauration est de 28 à 35 %. Revoyez la fiche technique, la portion ou le prix.' });
  if (dogs.length) out.push({ level: 'info', icon: 'list', title: `${dogs.length} plat(s) à retravailler ou retirer`, body: `${dogs.map((x) => x.name).join(', ')} : peu commandés et peu rentables sur 30 jours.` });
  const fc = forecast(db, cid, 7);
  const peak = [...fc].sort((a, b) => b.covers - a.covers)[0];
  if (peak && peak.covers > 0) out.push({ level: 'ok', icon: 'calendar', title: `Pic attendu ${new Date(peak.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' })} : ~${peak.covers} couverts`, body: `${peak.booked} déjà réservés. Prévoyez le personnel et la mise en place en conséquence.` });
  const plan = purchasePlan(db, cid, 2);
  if (plan.lines.length) out.push({ level: 'warn', icon: 'truck', title: `${plan.lines.length} ingrédient(s) à commander pour les 2 prochains jours`, body: `${plan.lines.slice(0, 4).map((l) => `${l.name} ${String(l.buy).replace('.', ',')} ${l.unit}`).join(', ')}… budget ${fcfa(plan.total)}.` });
  const slow = db.get(`SELECT s.name, AVG((julianday(l.ready_at) - julianday(l.sent_at)) * 1440) m FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id JOIN resto_stations s ON s.id = l.station_id
    WHERE o.company_id = ? AND l.ready_at IS NOT NULL AND l.created_at >= datetime('now','-7 days') GROUP BY s.id ORDER BY m DESC LIMIT 1`, cid);
  const target = settingsOf(db, cid).prep_target_min;
  if (slow && slow.m > target) out.push({ level: 'warn', icon: 'monitor', title: `Poste ${slow.name} : ${Math.round(slow.m)} min en moyenne`, body: `Au-dessus de votre objectif de ${target} min sur 7 jours. Renforcez le poste aux heures de pointe.` });
  const voids = db.get(`SELECT u.name, COUNT(*) n FROM resto_lines l JOIN resto_orders o ON o.id = l.order_id JOIN users u ON u.id = l.voided_by WHERE o.company_id = ? AND l.status = 'void' AND l.sent_at IS NOT NULL AND l.created_at >= datetime('now','-7 days') GROUP BY l.voided_by ORDER BY n DESC LIMIT 1`, cid);
  if (voids && voids.n >= 5) out.push({ level: 'bad', icon: 'shield', title: `${voids.n} annulations après envoi par ${voids.name} cette semaine`, body: 'Vérifiez les motifs dans le rapport Équipe (annulations et gestes commerciaux).' });
  const lapsed = db.get("SELECT COUNT(*) n FROM resto_customers WHERE company_id = ? AND visits >= 3 AND last_visit < ?", cid, addDays(d, -30)).n;
  if (lapsed) out.push({ level: 'info', icon: 'users', title: `${lapsed} habitué(s) ne sont pas revenus depuis 30 jours`, body: 'Envoyez-leur une offre par WhatsApp depuis la page Clients fidèles.' });
  return out;
}

export { fcfa };
