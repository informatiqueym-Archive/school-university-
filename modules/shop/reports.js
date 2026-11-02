// Teknons POS figures: live dashboard, margin per product, sales per hour,
// per cashier and per shop, stock value, and the daily expiry / low-stock checks.
// Hours are shown in Douala time (UTC+1, no daylight saving).
import { today } from '../../core/schema.js';
import { fcfa } from '../../core/format.js';
import { expiringLots, stockList } from './stock.js';

export function range(q) {
  const to = q.to || today();
  const from = q.from || to;
  return { from, to, a: from, b: to + 'T99' };
}
const storeSql = (q, alias = 'x') => (q.store_id ? ` AND ${alias}.store_id = ${Number(q.store_id)}` : '');

export function dashboard(db, cid, q = {}) {
  const t = today();
  const st = storeSql(q);
  const day = db.get(`SELECT COUNT(CASE WHEN kind='sale' THEN 1 END) tickets, COALESCE(SUM(CASE WHEN kind IN ('sale','return') THEN total END),0) sales,
      COALESCE(SUM(CASE WHEN kind IN ('sale','return') THEN net_total END),0) net, COALESCE(SUM(CASE WHEN kind IN ('sale','return') THEN cost_total END),0) cost,
      COALESCE(SUM(CASE WHEN kind='return' THEN -total END),0) returns, COALESCE(SUM(CASE WHEN kind='sale' THEN promo_total + discount_total END),0) discounts
    FROM shop_sales x WHERE company_id = ? AND status = 'completed' AND created_at >= ?${st}`, cid, t);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const prev = db.get(`SELECT COALESCE(SUM(total),0) sales FROM shop_sales x WHERE company_id = ? AND status = 'completed' AND kind IN ('sale','return') AND created_at >= ? AND created_at < ?${st}`, cid, yesterday, t);
  const hours = db.all(`SELECT CAST(strftime('%H', created_at, '+1 hour') AS INTEGER) h, COUNT(*) n, SUM(total) v FROM shop_sales x WHERE company_id = ? AND status = 'completed' AND kind IN ('sale','return') AND created_at >= ?${st} GROUP BY h ORDER BY h`, cid, t);
  const best = db.all(`SELECT l.product_id, l.description name, SUM(l.qty) qty, SUM(l.total) v FROM shop_sale_lines l JOIN shop_sales x ON x.id = l.sale_id
    WHERE x.company_id = ? AND x.status = 'completed' AND x.created_at >= ?${st} GROUP BY l.product_id ORDER BY v DESC LIMIT 8`, cid, t);
  const sessions = db.all(`SELECT s.id, s.number, s.status, s.opened_at, s.closed_at, s.variance, r.name register_name, st.name store_name, u.name user_name,
      COALESCE((SELECT SUM(total) FROM shop_sales WHERE session_id = s.id AND status = 'completed' AND kind IN ('sale','return')),0) sales
    FROM shop_sessions s JOIN shop_registers r ON r.id = s.register_id JOIN shop_stores st ON st.id = s.store_id JOIN users u ON u.id = s.user_id
    WHERE s.company_id = ? AND (s.status = 'open' OR s.closed_at >= ?)${storeSql(q, 's')} ORDER BY s.status DESC, s.id DESC LIMIT 20`, cid, t);
  const stores = db.all(`SELECT st.id, st.name, st.kind, COALESCE(SUM(CASE WHEN x.kind IN ('sale','return') THEN x.total END),0) sales, COUNT(CASE WHEN x.kind='sale' THEN 1 END) tickets
    FROM shop_stores st LEFT JOIN shop_sales x ON x.store_id = st.id AND x.status = 'completed' AND x.created_at >= ? WHERE st.company_id = ? AND st.active = 1 GROUP BY st.id ORDER BY st.kind, st.name`, t, cid);
  const s = db.get('SELECT expiry_alert_days FROM shop_settings WHERE company_id = ?', cid);
  const low = stockList(db, cid, { store_id: q.store_id, low: true });
  const exp = expiringLots(db, cid, s?.expiry_alert_days ?? 30, q.store_id);
  const credit = db.get(`SELECT COALESCE(SUM(d.total - d.paid - d.credited),0) v, COUNT(DISTINCT d.partner_id) n FROM documents d JOIN shop_customers c ON c.partner_id = d.partner_id
    WHERE d.company_id = ? AND d.kind = 'invoice' AND d.status IN ('open','partial')`, cid);
  const wallets = db.get('SELECT COALESCE(SUM(wallet),0) wallet, COALESCE(SUM(bonus),0) bonus, COALESCE(SUM(points),0) points, COUNT(*) n FROM shop_customers WHERE company_id = ?', cid);
  const methods = db.all(`SELECT p.method, SUM(p.amount) v FROM shop_sale_payments p JOIN shop_sales x ON x.id = p.sale_id WHERE x.company_id = ? AND x.status = 'completed' AND x.kind IN ('sale','return') AND x.created_at >= ?${st} GROUP BY p.method`, cid, t);
  return {
    date: t,
    kpi: { ...day, margin: day.net - day.cost, margin_pct: day.net ? Math.round((day.net - day.cost) * 1000 / day.net) / 10 : 0, basket: day.tickets ? Math.round(day.sales / day.tickets) : 0, yesterday: prev.sales },
    hours, best, sessions, stores, methods,
    low: { count: low.length, items: low.slice(0, 8) },
    expiring: { count: exp.length, items: exp.slice(0, 8) },
    credit, wallets,
  };
}

export function marginReport(db, cid, q) {
  const r = range(q);
  const rows = db.all(`SELECT l.product_id, l.description name, c.name category, SUM(l.qty) qty, SUM(l.total) sales, SUM(l.net) net, SUM(l.cost) cost, SUM(l.promo_amount + l.discount) discounts
    FROM shop_sale_lines l JOIN shop_sales x ON x.id = l.sale_id LEFT JOIN shop_items i ON i.product_id = l.product_id LEFT JOIN shop_categories c ON c.id = i.category_id
    WHERE x.company_id = ? AND x.status = 'completed' AND x.created_at BETWEEN ? AND ?${storeSql(q)} GROUP BY l.product_id ORDER BY (SUM(l.net) - SUM(l.cost)) DESC`, cid, r.a, r.b);
  for (const x of rows) { x.margin = x.net - x.cost; x.margin_pct = x.net ? Math.round(x.margin * 1000 / x.net) / 10 : 0; }
  const tot = rows.reduce((t, x) => ({ qty: 0, sales: t.sales + x.sales, net: t.net + x.net, cost: t.cost + x.cost, discounts: t.discounts + x.discounts }), { sales: 0, net: 0, cost: 0, discounts: 0 });
  tot.margin = tot.net - tot.cost; tot.margin_pct = tot.net ? Math.round(tot.margin * 1000 / tot.net) / 10 : 0;
  return { from: r.from, to: r.to, rows, totals: tot };
}

export function hourlyReport(db, cid, q) {
  const r = range(q);
  const rows = db.all(`SELECT CAST(strftime('%H', created_at, '+1 hour') AS INTEGER) hour, COUNT(CASE WHEN kind='sale' THEN 1 END) tickets, SUM(total) sales
    FROM shop_sales x WHERE company_id = ? AND status = 'completed' AND kind IN ('sale','return') AND created_at BETWEEN ? AND ?${storeSql(q)} GROUP BY hour ORDER BY hour`, cid, r.a, r.b);
  const days = db.all(`SELECT strftime('%w', created_at, '+1 hour') dow, SUM(total) sales, COUNT(CASE WHEN kind='sale' THEN 1 END) tickets FROM shop_sales x
    WHERE company_id = ? AND status = 'completed' AND kind IN ('sale','return') AND created_at BETWEEN ? AND ?${storeSql(q)} GROUP BY dow`, cid, r.a, r.b);
  return { from: r.from, to: r.to, rows, days };
}

export function cashierReport(db, cid, q) {
  const r = range(q);
  const rows = db.all(`SELECT u.id, u.name, COUNT(CASE WHEN x.kind='sale' AND x.status='completed' THEN 1 END) tickets,
      COALESCE(SUM(CASE WHEN x.status='completed' AND x.kind IN ('sale','return') THEN x.total END),0) sales,
      COUNT(CASE WHEN x.status='voided' THEN 1 END) voids, COALESCE(SUM(CASE WHEN x.status='voided' THEN x.total END),0) voided,
      COUNT(CASE WHEN x.kind='return' AND x.status='completed' THEN 1 END) returns,
      COALESCE(SUM(CASE WHEN x.status='completed' AND x.kind='sale' THEN x.discount_total END),0) discounts
    FROM shop_sales x JOIN users u ON u.id = x.created_by WHERE x.company_id = ? AND x.created_at BETWEEN ? AND ?${storeSql(q)} GROUP BY u.id ORDER BY sales DESC`, cid, r.a, r.b);
  const variances = db.all(`SELECT u.id, COALESCE(SUM(s.variance),0) variance, COUNT(*) sessions FROM shop_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.company_id = ? AND s.status = 'closed' AND s.closed_at BETWEEN ? AND ?${storeSql(q, 's')} GROUP BY u.id`, cid, r.a, r.b);
  for (const x of rows) { const v = variances.find((y) => y.id === x.id); x.variance = v?.variance || 0; x.sessions = v?.sessions || 0; }
  return { from: r.from, to: r.to, rows };
}

export function storeReport(db, cid, q) {
  const r = range(q);
  const rows = db.all(`SELECT st.id, st.name, COUNT(CASE WHEN x.kind='sale' THEN 1 END) tickets, COALESCE(SUM(x.total),0) sales, COALESCE(SUM(x.net_total),0) net, COALESCE(SUM(x.cost_total),0) cost
    FROM shop_stores st LEFT JOIN shop_sales x ON x.store_id = st.id AND x.status = 'completed' AND x.kind IN ('sale','return') AND x.created_at BETWEEN ? AND ?
    WHERE st.company_id = ? GROUP BY st.id ORDER BY sales DESC`, r.a, r.b, cid);
  for (const x of rows) {
    x.margin = x.net - x.cost;
    x.stock_value = Math.round(db.get('SELECT COALESCE(SUM(s.qty * i.avg_cost),0) v FROM shop_stock s JOIN shop_items i ON i.product_id = s.product_id WHERE s.store_id = ? AND s.qty > 0', x.id).v);
  }
  return { from: r.from, to: r.to, rows };
}

/** Hourly job: expiry and low-stock alerts (one unread alert per article). */
export function runShopChecks(db, bus, raiseAlert) {
  for (const c of db.all('SELECT company_id, expiry_alert_days FROM shop_settings')) {
    const lots = expiringLots(db, c.company_id, c.expiry_alert_days);
    const expired = lots.filter((l) => l.expiry < today());
    if (lots.length) {
      raiseAlert(db, bus, c.company_id, { kind: 'expiry', level: expired.length ? 'danger' : 'warning', entity: 'expiry', entity_id: Number(today().replace(/-/g, '')),
        title: `${lots.length} lot(s) expirent sous ${c.expiry_alert_days} jours`, body: `${expired.length ? `${expired.length} déjà périmé(s). ` : ''}${lots.slice(0, 4).map((l) => `${l.name} (${l.expiry.split('-').reverse().join('/')})`).join(', ')}` });
    }
    for (const it of stockList(db, c.company_id, { low: true }).slice(0, 50)) {
      raiseAlert(db, bus, c.company_id, { kind: 'low_stock', level: 'warning', title: `Stock bas : ${it.name}`, body: `Il reste ${it.qty} (seuil ${it.min_stock}). Proposé dans les bons de commande.`, entity: 'product', entity_id: it.product_id });
    }
  }
}

export { fcfa };
