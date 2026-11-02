// Stock per shop/warehouse, to the unit: every change is a movement, lots with
// expiry dates are consumed first-expired-first-out, and the average purchase
// cost is kept up to date for margin reports.
import { bad, notFound } from '../../core/errors.js';
import { now } from '../../core/schema.js';

export const qtyRound = (q) => Math.round(Number(q) * 1000) / 1000;

export function stockOf(db, storeId, productId) {
  return db.get('SELECT qty FROM shop_stock WHERE store_id = ? AND product_id = ?', storeId, productId)?.qty ?? 0;
}

export function assertStore(db, companyId, storeId) {
  const s = db.get('SELECT * FROM shop_stores WHERE id = ? AND company_id = ?', storeId, companyId);
  if (!s) throw notFound('Boutique ou entrepôt introuvable');
  return s;
}

/**
 * Adds (qty > 0) or removes (qty < 0) stock. Returns the new quantity.
 * opts: { kind, ref_type, ref_id, unit_cost, note, userId, lot, expiry }
 */
export function moveStock(db, companyId, storeId, productId, qty, opts = {}) {
  qty = qtyRound(qty);
  if (!qty) return stockOf(db, storeId, productId);
  const item = db.get('SELECT * FROM shop_items WHERE product_id = ? AND company_id = ?', productId, companyId);
  if (!item) throw notFound('Article introuvable');
  const before = stockOf(db, storeId, productId);
  const after = qtyRound(before + qty);
  db.run(`INSERT INTO shop_stock (company_id, store_id, product_id, qty) VALUES (?,?,?,?)
    ON CONFLICT(store_id, product_id) DO UPDATE SET qty = excluded.qty`, companyId, storeId, productId, after);

  // Weighted average cost on receipts
  if (qty > 0 && opts.kind === 'receipt' && opts.unit_cost > 0) {
    const base = Math.max(0, before);
    const avg = base + qty > 0 ? (base * item.avg_cost + qty * opts.unit_cost) / (base + qty) : opts.unit_cost;
    db.run('UPDATE shop_items SET avg_cost = ? WHERE product_id = ?', Math.round(avg * 100) / 100, productId);
    db.run('UPDATE products SET purchase_price = ? WHERE id = ?', Math.round(opts.unit_cost), productId);
  }

  // Lots: new lot on entry, first-expired-first-out on exit
  if (item.track_expiry) {
    if (qty > 0) {
      db.run('INSERT INTO shop_lots (company_id, store_id, product_id, lot, expiry, qty, received_at) VALUES (?,?,?,?,?,?,?)',
        companyId, storeId, productId, String(opts.lot || '').slice(0, 40), opts.expiry || null, qty, now());
    } else {
      let left = -qty;
      const lots = db.all('SELECT * FROM shop_lots WHERE store_id = ? AND product_id = ? AND qty > 0 ORDER BY expiry IS NULL, expiry, id', storeId, productId);
      for (const l of lots) {
        if (left <= 0) break;
        const take = Math.min(l.qty, left);
        db.run('UPDATE shop_lots SET qty = ? WHERE id = ?', qtyRound(l.qty - take), l.id);
        left = qtyRound(left - take);
      }
    }
  }
  db.run(`INSERT INTO shop_moves (company_id, store_id, product_id, qty, kind, ref_type, ref_id, unit_cost, note, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    companyId, storeId, productId, qty, opts.kind || 'adjust', opts.ref_type || '', opts.ref_id ?? null,
    opts.unit_cost ?? item.avg_cost ?? 0, String(opts.note || '').slice(0, 300), opts.userId ?? null, now());
  return after;
}

export function stockList(db, companyId, { store_id, q, low, category_id } = {}) {
  const where = ['i.company_id = ?', 'p.active = 1']; const a = [companyId];
  if (q) { where.push('(p.name LIKE ? OR i.barcode LIKE ? OR p.code LIKE ?)'); a.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category_id) { where.push('i.category_id = ?'); a.push(category_id); }
  const storeFilter = store_id ? 'AND s.store_id = ?' : '';
  const rows = db.all(`SELECT p.id product_id, p.name, p.unit, i.barcode, i.category_id, c.name category, i.retail_price, i.wholesale_price, i.avg_cost, i.min_stock, i.reorder_qty, i.track_expiry, i.by_weight,
      COALESCE((SELECT SUM(s.qty) FROM shop_stock s WHERE s.product_id = p.id ${storeFilter}), 0) qty,
      (SELECT MIN(l.expiry) FROM shop_lots l WHERE l.product_id = p.id AND l.qty > 0 ${store_id ? 'AND l.store_id = ?' : ''}) next_expiry
    FROM shop_items i JOIN products p ON p.id = i.product_id LEFT JOIN shop_categories c ON c.id = i.category_id
    WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT 3000`, ...(store_id ? [store_id, store_id] : []), ...a);
  for (const r of rows) { r.value = Math.round(r.qty * r.avg_cost); r.low = r.min_stock > 0 && r.qty <= r.min_stock; }
  return low ? rows.filter((r) => r.low) : rows;
}

export function expiringLots(db, companyId, days, store_id) {
  const limit = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  return db.all(`SELECT l.*, p.name, s.name store_name FROM shop_lots l JOIN products p ON p.id = l.product_id JOIN shop_stores s ON s.id = l.store_id
    WHERE l.company_id = ? AND l.qty > 0 AND l.expiry IS NOT NULL AND l.expiry <= ? ${store_id ? 'AND l.store_id = ?' : ''} ORDER BY l.expiry`,
  companyId, limit, ...(store_id ? [store_id] : []));
}

export function assertQty(q, field = 'qty') {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) throw bad('qty', `Quantité invalide (${field})`);
  return qtyRound(n);
}
