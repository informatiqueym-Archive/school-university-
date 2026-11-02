// Teknons POS: point of sale and stock for shops, supermarkets, hardware stores
// and wholesalers. Uses Teknons Compta for invoices on credit, supplier bills,
// customer statements and the general ledger.
import { requirePerm, requireUser } from '../../core/auth.js';
import { bad, notFound, forbidden } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate } from '../../core/validate.js';
import { audit, raiseAlert } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { now, today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { sendXlsx } from '../../core/xlsx.js';
import { PROVIDERS } from '../../core/payments/mobile-money.js';
import { internalBarcode, parseScaleCode, solveNet } from '../../public/js/shop-pricing.js';
import { migrateShop, seedCompanyShop } from './schema.js';
import * as S from './sales.js';
import * as P from './purchasing.js';
import * as R from './reports.js';
import { stockList, expiringLots, assertStore } from './stock.js';
import { renderReceipt, renderLabels, renderZReport, renderPO } from './print.js';

export default {
  id: 'shop',
  requires: ['accounting'],
  name: { fr: 'Teknons POS', en: 'Teknons POS' },
  brand: { name: 'Teknons POS', short: 'POS', description: 'Caisse, stock et fidélité pour boutiques et supermarchés. FCFA, MTN MoMo, Orange Money.', navy: '#0A2540', accent: '#0B8AC9' },
  migrate: migrateShop,
  onCompanyCreated: seedCompanyShop,

  routes(r, { db, bus, momo }) {
    const cid = (ctx) => ctx.user.company_id;
    const company = (ctx) => db.get('SELECT * FROM companies WHERE id = ?', cid(ctx));
    const changed = (ctx, entity, id) => bus.emit(cid(ctx), 'change', { entity, id });
    const userStore = (ctx) => db.get('SELECT store_id FROM shop_user_store WHERE user_id = ?', ctx.user.id)?.store_id
      || db.get("SELECT id FROM shop_stores WHERE company_id = ? AND active = 1 ORDER BY kind = 'warehouse', id LIMIT 1", cid(ctx))?.id;

    // ---------------- Reference data ----------------
    r.get('/api/shop/meta', requireUser, (ctx) => {
      const c = cid(ctx);
      seedCompanyShop(db, c);
      return {
        settings: S.publicSettings(S.settingsOf(db, c)),
        stores: db.all('SELECT * FROM shop_stores WHERE company_id = ? ORDER BY kind, name', c),
        registers: db.all('SELECT r.*, s.name store_name, (SELECT u.name FROM shop_sessions x JOIN users u ON u.id = x.user_id WHERE x.register_id = r.id AND x.status = \'open\') busy_by FROM shop_registers r JOIN shop_stores s ON s.id = r.store_id WHERE r.company_id = ? ORDER BY s.name, r.name', c),
        categories: db.all('SELECT * FROM shop_categories WHERE company_id = ? ORDER BY position, name', c),
        my_store: userStore(ctx),
        session: S.openSessionFor(db, ctx.user),
        methods: Object.fromEntries(Object.entries(S.PAY_METHODS).map(([k, v]) => [k, { fr: v.fr, en: v.en }])),
        momo: { mode: momo.mode, mtn_momo: momo.configured('mtn_momo'), orange_money: momo.configured('orange_money') },
        user_stores: can(ctx.user, 'users') ? db.all('SELECT * FROM shop_user_store WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)', c) : [],
      };
    });

    r.put('/api/shop/settings', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const c = cid(ctx); const cur = S.settingsOf(db, c);
      const prefix = str(b.scale_prefix ?? cur.scale_prefix, 2);
      if (!/^2\d$/.test(prefix)) throw bad('scale_prefix', 'Le préfixe balance doit être 20 à 29');
      db.run(`UPDATE shop_settings SET points_per_amount = ?, point_value = ?, min_points_redeem = ?, topup_bonus_pct = ?, topup_bonus_min = ?, expiry_alert_days = ?,
          scale_prefix = ?, scale_mode = ?, receipt_footer = ?, max_discount_pct = ? WHERE company_id = ?`,
      int(b.points_per_amount, 'points_per_amount', { min: 0, def: cur.points_per_amount }), int(b.point_value, 'point_value', { min: 0, def: cur.point_value }),
      int(b.min_points_redeem, 'min_points_redeem', { min: 0, def: cur.min_points_redeem }), num(b.topup_bonus_pct, 'topup_bonus_pct', { min: 0, def: cur.topup_bonus_pct }),
      int(b.topup_bonus_min, 'topup_bonus_min', { min: 0, def: cur.topup_bonus_min }), int(b.expiry_alert_days, 'expiry_alert_days', { min: 1, def: cur.expiry_alert_days }),
      prefix, oneOf(b.scale_mode, ['weight', 'price'], 'scale_mode', cur.scale_mode), str(b.receipt_footer ?? cur.receipt_footer, 300),
      num(b.max_discount_pct, 'max_discount_pct', { min: 0, def: cur.max_discount_pct }), c);
      if (b.manager_pin) S.setManagerPin(db, c, b.manager_pin);
      audit(db, ctx, 'update', 'pos_settings', c);
      changed(ctx, 'pos_settings');
      return S.publicSettings(S.settingsOf(db, c));
    });

    // Shops, warehouses and tills
    r.post('/api/shop/stores', requirePerm('settings'), (ctx) => {
      const res = db.run('INSERT INTO shop_stores (company_id, name, kind, address, phone, created_at) VALUES (?,?,?,?,?,?)', cid(ctx),
        str(ctx.body.name, 80) || (() => { throw bad('name', 'Le nom est obligatoire'); })(), oneOf(ctx.body.kind, ['shop', 'warehouse'], 'kind', 'shop'), str(ctx.body.address, 200), str(ctx.body.phone, 40), now());
      const id = Number(res.lastInsertRowid);
      if (ctx.body.kind !== 'warehouse') db.run("INSERT INTO shop_registers (company_id, store_id, name) VALUES (?, ?, 'Caisse 1')", cid(ctx), id);
      audit(db, ctx, 'create', 'store', id);
      return ctx.json(db.get('SELECT * FROM shop_stores WHERE id = ?', id), 201);
    });
    r.put('/api/shop/stores/:id', requirePerm('settings'), (ctx) => {
      const s = assertStore(db, cid(ctx), ctx.params.id); const b = ctx.body;
      db.run('UPDATE shop_stores SET name = ?, address = ?, phone = ?, active = ? WHERE id = ?', str(b.name ?? s.name, 80) || s.name, str(b.address ?? s.address, 200), str(b.phone ?? s.phone, 40), b.active === undefined ? s.active : (b.active ? 1 : 0), s.id);
      return db.get('SELECT * FROM shop_stores WHERE id = ?', s.id);
    });
    r.post('/api/shop/registers', requirePerm('settings'), (ctx) => {
      assertStore(db, cid(ctx), ctx.body.store_id);
      const res = db.run('INSERT INTO shop_registers (company_id, store_id, name) VALUES (?,?,?)', cid(ctx), ctx.body.store_id, str(ctx.body.name, 40) || 'Caisse');
      return ctx.json(db.get('SELECT * FROM shop_registers WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/shop/registers/:id', requirePerm('settings'), (ctx) => {
      const g = db.get('SELECT * FROM shop_registers WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx));
      if (!g) throw notFound();
      db.run('UPDATE shop_registers SET name = ?, active = ? WHERE id = ?', str(ctx.body.name ?? g.name, 40), ctx.body.active === undefined ? g.active : (ctx.body.active ? 1 : 0), g.id);
      return { ok: true };
    });
    r.put('/api/shop/user-store', requirePerm('users'), (ctx) => {
      const u = db.get('SELECT id FROM users WHERE id = ? AND company_id = ?', ctx.body.user_id, cid(ctx));
      if (!u) throw notFound('Utilisateur introuvable');
      if (!ctx.body.store_id) { db.run('DELETE FROM shop_user_store WHERE user_id = ?', u.id); return { ok: true }; }
      assertStore(db, cid(ctx), ctx.body.store_id);
      db.run('INSERT INTO shop_user_store (user_id, store_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET store_id = excluded.store_id', u.id, ctx.body.store_id);
      return { ok: true };
    });

    // Categories
    r.post('/api/shop/categories', requirePerm('stock', 'settings'), (ctx) => {
      const name = str(ctx.body.name, 60); if (!name) throw bad('name', 'Le nom est obligatoire');
      const res = db.run('INSERT INTO shop_categories (company_id, name, color, position) VALUES (?,?,?,?)', cid(ctx), name, str(ctx.body.color, 20), int(ctx.body.position, 'position', { def: 0 }));
      return ctx.json(db.get('SELECT * FROM shop_categories WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/shop/categories/:id', requirePerm('stock', 'settings'), (ctx) => {
      const c = db.get('SELECT * FROM shop_categories WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx));
      if (!c) throw notFound();
      db.run('UPDATE shop_categories SET name = ?, color = ?, position = ? WHERE id = ?', str(ctx.body.name ?? c.name, 60), str(ctx.body.color ?? c.color, 20), int(ctx.body.position, 'position', { def: c.position }), c.id);
      return { ok: true };
    });

    // ---------------- Articles ----------------
    const itemSql = `SELECT p.id, p.id product_id, p.name, p.code, p.unit, p.vat_rate, p.active, p.description, i.barcode, i.category_id, i.retail_price, i.wholesale_price, i.wholesale_min_qty,
        i.by_weight, i.plu, i.min_stock, i.reorder_qty, i.track_expiry, i.avg_cost, i.supplier_id, i.quick, c.name category, s.name supplier_name
      FROM shop_items i JOIN products p ON p.id = i.product_id LEFT JOIN shop_categories c ON c.id = i.category_id LEFT JOIN partners s ON s.id = i.supplier_id`;
    const getItem = (c, id) => db.get(`${itemSql} WHERE p.id = ? AND i.company_id = ?`, id, c);

    function itemValues(c, b, cur = {}) {
      const name = str(b.name ?? cur.name, 200); if (!name) throw bad('name', 'Le nom est obligatoire');
      const retail = int(b.retail_price ?? cur.retail_price, 'retail_price', { min: 0, def: 0 });
      const vat = b.vat_rate === '' || (b.vat_rate === undefined && cur.vat_rate == null) ? null : num(b.vat_rate ?? cur.vat_rate, 'vat_rate', { min: 0 });
      const barcode = str(b.barcode ?? cur.barcode, 40).replace(/\s/g, '');
      const plu = str(b.plu ?? cur.plu, 5);
      if (plu && !/^\d{1,5}$/.test(plu)) throw bad('plu', 'Le code balance (PLU) a 1 à 5 chiffres');
      const cat = b.category_id ?? cur.category_id;
      if (cat && !db.get('SELECT id FROM shop_categories WHERE id = ? AND company_id = ?', cat, c)) throw bad('category', 'Catégorie inconnue');
      const sup = b.supplier_id ?? cur.supplier_id;
      if (sup && !db.get("SELECT id FROM partners WHERE id = ? AND company_id = ? AND kind = 'supplier'", sup, c)) throw bad('supplier', 'Fournisseur inconnu');
      const flag = (k) => (b[k] === undefined ? (cur[k] ? 1 : 0) : (b[k] && b[k] !== '0' ? 1 : 0));
      return {
        name, retail, vat, barcode, plu: plu ? plu.padStart(5, '0') : '', category_id: cat || null, supplier_id: sup || null,
        wholesale: int(b.wholesale_price ?? cur.wholesale_price, 'wholesale_price', { min: 0, def: 0 }), wmin: num(b.wholesale_min_qty ?? cur.wholesale_min_qty, 'wholesale_min_qty', { min: 0, def: 0 }),
        by_weight: flag('by_weight'), track_expiry: flag('track_expiry'), quick: flag('quick'),
        min_stock: num(b.min_stock ?? cur.min_stock, 'min_stock', { min: 0, def: 0 }), reorder_qty: num(b.reorder_qty ?? cur.reorder_qty, 'reorder_qty', { min: 0, def: 0 }),
        unit: str(b.unit ?? cur.unit, 10) || (flag('by_weight') ? 'kg' : 'u'), code: str(b.code ?? cur.code, 40), description: str(b.description ?? cur.description, 1000),
        cost: int(b.purchase_price ?? b.avg_cost, 'purchase_price', { min: 0, def: 0 }),
      };
    }
    // products.price stays HT so quotes and invoices in Teknons Compta use the right price
    const htPrice = (c, v) => solveNet(v.retail, v.vat ?? (company({ user: { company_id: c } }).vat_enabled ? company({ user: { company_id: c } }).vat_rate : 0));

    r.get('/api/shop/items', requirePerm('read'), (ctx) => {
      const q = ctx.query; const where = ['i.company_id = ?']; const a = [cid(ctx)];
      if (!q.all) where.push('p.active = 1');
      if (q.q) { where.push('(p.name LIKE ? OR i.barcode LIKE ? OR p.code LIKE ? OR i.plu = ?)'); a.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, q.q.padStart(5, '0')); }
      if (q.category_id) { where.push('i.category_id = ?'); a.push(q.category_id); }
      const rows = db.all(`${itemSql} WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT 3000`, ...a);
      const stock = db.all('SELECT product_id, SUM(qty) qty FROM shop_stock WHERE company_id = ? ' + (q.store_id ? 'AND store_id = ? ' : '') + 'GROUP BY product_id', cid(ctx), ...(q.store_id ? [q.store_id] : []));
      const map = Object.fromEntries(stock.map((s) => [s.product_id, s.qty]));
      for (const x of rows) x.qty = map[x.id] || 0;
      if (q.format === 'xlsx') {
        return sendXlsx(ctx, `articles-${today()}.xlsx`, [{ name: 'Articles', title: `${company(ctx).name} – Articles`, columns: [
          { header: 'Article', key: 'name', width: 34 }, { header: 'Code-barres', key: 'barcode', width: 16 }, { header: 'Catégorie', key: 'category', width: 16 },
          { header: 'Prix détail TTC', key: 'retail_price', type: 'money' }, { header: 'Prix gros TTC', key: 'wholesale_price', type: 'money' }, { header: 'Coût moyen HT', key: 'avg_cost', type: 'money' },
          { header: 'Stock', key: 'qty', type: 'number' }, { header: 'Seuil', key: 'min_stock', type: 'number' }], rows }]);
      }
      return rows;
    });
    r.get('/api/shop/items/:id', requirePerm('read'), (ctx) => {
      const it = getItem(cid(ctx), ctx.params.id);
      if (!it) throw notFound('Article introuvable');
      it.stock = db.all('SELECT st.id store_id, st.name, COALESCE(s.qty,0) qty FROM shop_stores st LEFT JOIN shop_stock s ON s.store_id = st.id AND s.product_id = ? WHERE st.company_id = ? ORDER BY st.kind, st.name', it.id, cid(ctx));
      it.lots = db.all('SELECT l.*, st.name store_name FROM shop_lots l JOIN shop_stores st ON st.id = l.store_id WHERE l.product_id = ? AND l.qty > 0 ORDER BY l.expiry', it.id);
      it.moves = db.all('SELECT m.*, st.name store_name, u.name user_name FROM shop_moves m JOIN shop_stores st ON st.id = m.store_id LEFT JOIN users u ON u.id = m.user_id WHERE m.product_id = ? AND m.company_id = ? ORDER BY m.id DESC LIMIT 100', it.id, cid(ctx));
      it.promos = db.all('SELECT * FROM shop_promos WHERE company_id = ? AND active = 1 AND (product_id = ? OR (category_id IS NOT NULL AND category_id = ?))', cid(ctx), it.id, it.category_id ?? -1);
      it.sales30 = db.get("SELECT COALESCE(SUM(l.qty),0) qty, COALESCE(SUM(l.total),0) v, COALESCE(SUM(l.net - l.cost),0) margin FROM shop_sale_lines l JOIN shop_sales x ON x.id = l.sale_id WHERE l.product_id = ? AND x.status = 'completed' AND x.created_at >= ?", it.id, new Date(Date.now() - 30 * 864e5).toISOString());
      return it;
    });
    r.post('/api/shop/items', requirePerm('stock', 'settings'), (ctx) => {
      const c = cid(ctx); const v = itemValues(c, ctx.body);
      const id = db.tx(() => {
        const p = db.run('INSERT INTO products (company_id, kind, code, name, description, unit, price, purchase_price, vat_rate, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          c, 'good', v.code, v.name, v.description, v.unit, htPrice(c, v), v.cost, v.vat, now());
        const pid = Number(p.lastInsertRowid);
        const barcode = v.barcode || (ctx.body.generate_barcode ? internalBarcode(pid) : '');
        db.run(`INSERT INTO shop_items (product_id, company_id, barcode, category_id, retail_price, wholesale_price, wholesale_min_qty, by_weight, plu, min_stock, reorder_qty, track_expiry, avg_cost, supplier_id, quick)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, pid, c, barcode, v.category_id, v.retail, v.wholesale, v.wmin, v.by_weight, v.plu, v.min_stock, v.reorder_qty, v.track_expiry, v.cost, v.supplier_id, v.quick);
        const qty = Number(ctx.body.initial_qty) || 0;
        const store = ctx.body.store_id || userStore(ctx);
        if (qty > 0 && store) P.adjustStock(db, bus, ctx, { store_id: store, product_id: pid, qty, kind: 'receipt', unit_cost: v.cost, note: 'Stock initial', expiry: ctx.body.expiry || null });
        return pid;
      });
      audit(db, ctx, 'create', 'product', id);
      changed(ctx, 'product', id);
      return ctx.json(getItem(c, id), 201);
    });
    r.put('/api/shop/items/:id', requirePerm('stock', 'settings'), (ctx) => {
      const c = cid(ctx); const cur = getItem(c, ctx.params.id);
      if (!cur) throw notFound('Article introuvable');
      const v = itemValues(c, ctx.body, cur);
      const barcode = v.barcode || (ctx.body.generate_barcode ? internalBarcode(cur.id) : '');
      db.tx(() => {
        db.run('UPDATE products SET name = ?, code = ?, unit = ?, description = ?, vat_rate = ?, price = ?, active = ? WHERE id = ?', v.name, v.code, v.unit, v.description, v.vat, htPrice(c, v),
          ctx.body.active === undefined ? cur.active : (ctx.body.active ? 1 : 0), cur.id);
        db.run(`UPDATE shop_items SET barcode = ?, category_id = ?, retail_price = ?, wholesale_price = ?, wholesale_min_qty = ?, by_weight = ?, plu = ?, min_stock = ?, reorder_qty = ?, track_expiry = ?, supplier_id = ?, quick = ? WHERE product_id = ?`,
          barcode, v.category_id, v.retail, v.wholesale, v.wmin, v.by_weight, v.plu, v.min_stock, v.reorder_qty, v.track_expiry, v.supplier_id, v.quick, cur.id);
      });
      if (v.retail !== cur.retail_price || v.wholesale !== cur.wholesale_price) {
        audit(db, ctx, 'price_change', 'product', cur.id, { from: [cur.retail_price, cur.wholesale_price], to: [v.retail, v.wholesale] });
        raiseAlert(db, bus, c, { kind: 'price_change', level: 'info', title: `Changement de prix : ${v.name}`, body: `${fcfa(cur.retail_price)} → ${fcfa(v.retail)}${v.wholesale !== cur.wholesale_price ? ` (gros ${fcfa(cur.wholesale_price)} → ${fcfa(v.wholesale)})` : ''}, par ${ctx.user.name}.` });
      }
      changed(ctx, 'product', cur.id);
      return getItem(c, cur.id);
    });

    /** Scanner / keyboard lookup: article barcode, scale barcode, PLU, loyalty card or receipt number. */
    r.get('/api/shop/lookup', requirePerm('read'), (ctx) => {
      const c = cid(ctx); const code = str(ctx.query.code, 60).replace(/\s/g, '');
      if (!code) throw bad('code', 'Code vide');
      const it = db.get(`${itemSql} WHERE i.company_id = ? AND i.barcode = ? AND p.active = 1`, c, code);
      if (it) return { type: 'item', item: it, qty: 1 };
      const sc = parseScaleCode(code, S.settingsOf(db, c));
      if (sc) {
        const w = db.get(`${itemSql} WHERE i.company_id = ? AND i.plu = ? AND p.active = 1`, c, sc.plu);
        if (w) return { type: 'item', item: w, qty: sc.qty ?? Math.round(sc.amount / Math.max(1, w.retail_price) * 1000) / 1000, scale: true };
      }
      const cust = db.get('SELECT partner_id FROM shop_customers WHERE company_id = ? AND card_no = ?', c, code);
      if (cust) return { type: 'customer', customer: S.customerOf(db, c, cust.partner_id) };
      const sale = db.get('SELECT id FROM shop_sales WHERE company_id = ? AND number = ?', c, code);
      if (sale) return { type: 'sale', sale: S.getSale(db, c, sale.id) };
      throw notFound(`Code inconnu : ${code}`);
    });

    /** Everything the till needs to keep selling without internet. */
    r.get('/api/shop/catalog', requirePerm('pos', 'read'), (ctx) => {
      const c = cid(ctx); const store = Number(ctx.query.store_id) || userStore(ctx);
      const items = db.all(`SELECT p.id product_id, p.name, p.unit, p.vat_rate, i.barcode, i.category_id, i.retail_price, i.wholesale_price, i.wholesale_min_qty, i.by_weight, i.plu, i.quick,
          COALESCE((SELECT qty FROM shop_stock WHERE store_id = ? AND product_id = p.id), 0) qty
        FROM shop_items i JOIN products p ON p.id = i.product_id WHERE i.company_id = ? AND p.active = 1 ORDER BY p.name`, store, c);
      return { store_id: store, at: now(), items, promos: S.activePromos(db, c), categories: db.all('SELECT * FROM shop_categories WHERE company_id = ? ORDER BY position, name', c),
        customers: db.all(`SELECT p.id partner_id, p.name, p.phone, sc.card_no, sc.price_level, sc.points, sc.wallet, sc.bonus, sc.credit_limit FROM partners p JOIN shop_customers sc ON sc.partner_id = p.id
          WHERE p.company_id = ? AND p.active = 1 ORDER BY p.name LIMIT 5000`, c) };
    });

    // ---------------- Customers (loyalty, prepaid, credit) ----------------
    r.get('/api/shop/customers', requirePerm('read'), (ctx) => {
      const q = `%${str(ctx.query.q)}%`;
      const rows = db.all(`SELECT p.id, p.id partner_id, p.name, p.phone, p.email, sc.card_no, sc.price_level, sc.points, sc.wallet, sc.bonus, sc.credit_limit,
          COALESCE((SELECT SUM(total - paid - credited) FROM documents d WHERE d.partner_id = p.id AND d.kind = 'invoice' AND d.status IN ('open','partial')), 0) debt,
          (SELECT MAX(created_at) FROM shop_sales x WHERE x.customer_id = p.id) last_visit
        FROM partners p JOIN shop_customers sc ON sc.partner_id = p.id WHERE p.company_id = ? AND p.active = 1 AND (p.name LIKE ? OR p.phone LIKE ? OR sc.card_no LIKE ?) ORDER BY p.name LIMIT 1000`, cid(ctx), q, q, q);
      if (ctx.query.format === 'xlsx') {
        return sendXlsx(ctx, `clients-fidelite-${today()}.xlsx`, [{ name: 'Clients', columns: [{ header: 'Client', key: 'name', width: 28 }, { header: 'Téléphone', key: 'phone', width: 14 },
          { header: 'Carte', key: 'card_no', width: 16 }, { header: 'Tarif', key: 'price_level' }, { header: 'Points', key: 'points', type: 'number' }, { header: 'Compte prépayé', key: 'wallet', type: 'money' },
          { header: 'Bonus', key: 'bonus', type: 'money' }, { header: 'Plafond crédit', key: 'credit_limit', type: 'money' }, { header: 'Dette', key: 'debt', type: 'money' }], rows }]);
      }
      return rows;
    });
    r.get('/api/shop/customers/:id', requirePerm('read'), (ctx) => {
      const c = S.customerOf(db, cid(ctx), ctx.params.id);
      c.moves = db.all('SELECT m.*, x.number sale_number, u.name user_name FROM shop_customer_moves m LEFT JOIN shop_sales x ON x.id = m.sale_id LEFT JOIN users u ON u.id = m.user_id WHERE m.partner_id = ? ORDER BY m.id DESC LIMIT 100', c.partner_id);
      c.sales = S.listSales(db, cid(ctx), { customer_id: c.partner_id, limit: 50 });
      c.invoices = db.all("SELECT id, number, date, due_date, total, paid, credited, status, (total - paid - credited) balance FROM documents WHERE partner_id = ? AND kind = 'invoice' AND status != 'draft' ORDER BY date DESC LIMIT 50", c.partner_id);
      c.stats = db.get("SELECT COUNT(*) visits, COALESCE(SUM(total),0) spent FROM shop_sales WHERE customer_id = ? AND kind = 'sale' AND status = 'completed'", c.partner_id);
      return c;
    });
    const customerExtra = (b, cur = {}) => {
      const card = str(b.card_no ?? cur.card_no, 30).replace(/\s/g, '');
      return [card, oneOf(b.price_level ?? cur.price_level, ['retail', 'wholesale'], 'price_level', 'retail'), int(b.credit_limit ?? cur.credit_limit, 'credit_limit', { min: 0, def: 0 }), str(b.birthday ?? cur.birthday, 10)];
    };
    r.post('/api/shop/customers', requirePerm('pos', 'sales'), (ctx) => {
      const b = ctx.body; const c = cid(ctx);
      const name = str(b.name, 120); if (!name) throw bad('name', 'Le nom est obligatoire');
      if (Number(b.credit_limit) > 0 && !['owner', 'admin', 'manager'].includes(ctx.user.role)) throw forbidden('Seul un gérant peut accorder du crédit');
      const id = db.tx(() => {
        const p = db.run("INSERT INTO partners (company_id, kind, name, phone, email, address, city, created_at) VALUES (?, 'client', ?,?,?,?,?,?)", c, name, str(b.phone, 30), str(b.email, 120), str(b.address, 200), str(b.city, 60) || 'Douala', now());
        const pid = Number(p.lastInsertRowid);
        const [card, level, limit, bday] = customerExtra(b);
        db.run('INSERT INTO shop_customers (partner_id, company_id, card_no, price_level, credit_limit, birthday) VALUES (?,?,?,?,?,?)', pid, c, card || `C${String(pid).padStart(7, '0')}`, level, limit, bday);
        return pid;
      });
      audit(db, ctx, 'create', 'client', id);
      changed(ctx, 'customer', id);
      return ctx.json(S.customerOf(db, c, id), 201);
    });
    r.put('/api/shop/customers/:id', requirePerm('pos', 'sales'), (ctx) => {
      const c = cid(ctx); const cur = S.customerOf(db, c, ctx.params.id); const b = ctx.body;
      if (b.credit_limit !== undefined && Number(b.credit_limit) !== cur.credit_limit && !['owner', 'admin', 'manager'].includes(ctx.user.role)) throw forbidden('Seul un gérant peut changer le plafond de crédit');
      const [card, level, limit, bday] = customerExtra(b, cur);
      db.tx(() => {
        db.run('UPDATE partners SET name = ?, phone = ?, email = ? WHERE id = ?', str(b.name ?? cur.name, 120), str(b.phone ?? cur.phone, 30), str(b.email ?? cur.email, 120), cur.partner_id);
        db.run('UPDATE shop_customers SET card_no = ?, price_level = ?, credit_limit = ?, birthday = ? WHERE partner_id = ?', card, level, limit, bday, cur.partner_id);
      });
      audit(db, ctx, 'update', 'client', cur.partner_id, { credit_limit: limit, price_level: level });
      changed(ctx, 'customer', cur.partner_id);
      return S.customerOf(db, c, cur.partner_id);
    });
    /** Manual points or bonus gift (birthday, complaint…). Manager only. */
    r.post('/api/shop/customers/:id/adjust', requirePerm('pos', 'sales'), (ctx) => {
      const c = cid(ctx); const cur = S.customerOf(db, c, ctx.params.id);
      S.checkManager(db, ctx, ctx.body.manager_pin, 'Ajustement fidélité');
      const points = int(ctx.body.points, 'points', { def: 0 }), bonus = int(ctx.body.bonus, 'bonus', { def: 0 });
      if (cur.points + points < 0 || cur.bonus + bonus < 0) throw bad('negative', 'Le solde ne peut pas devenir négatif');
      const note = str(ctx.body.note, 200); if (!note) throw bad('note', 'Indiquez le motif');
      db.run('UPDATE shop_customers SET points = points + ?, bonus = bonus + ? WHERE partner_id = ?', points, bonus, cur.partner_id);
      db.run("INSERT INTO shop_customer_moves (company_id, partner_id, kind, points, bonus, note, user_id, at) VALUES (?,?,'adjust',?,?,?,?,?)", c, cur.partner_id, points, bonus, note, ctx.user.id, now());
      audit(db, ctx, 'loyalty_adjust', 'client', cur.partner_id, { points, bonus, note });
      return S.customerOf(db, c, cur.partner_id);
    });

    // ---------------- Promotions ----------------
    r.get('/api/shop/promos', requirePerm('read'), (ctx) => db.all(`SELECT pr.*, p.name product_name, c.name category_name FROM shop_promos pr LEFT JOIN products p ON p.id = pr.product_id
      LEFT JOIN shop_categories c ON c.id = pr.category_id WHERE pr.company_id = ? ORDER BY pr.active DESC, pr.end_date IS NULL, pr.end_date DESC, pr.id DESC`, cid(ctx)));
    const promoValues = (c, b, cur = {}) => {
      const kind = oneOf(b.kind ?? cur.kind, ['percent', 'price', 'bundle', 'buy_get'], 'kind');
      const name = str(b.name ?? cur.name, 100); if (!name) throw bad('name', 'Donnez un nom à la promotion');
      const product_id = (b.product_id ?? cur.product_id) || null, category_id = (b.category_id ?? cur.category_id) || null;
      if (product_id && !db.get('SELECT 1 FROM shop_items WHERE product_id = ? AND company_id = ?', product_id, c)) throw bad('product', 'Article inconnu');
      const value = num(b.value ?? cur.value, 'value', { min: 0, def: 0 }), qty = num(b.qty ?? cur.qty, 'qty', { min: 0, def: 0 }), free = num(b.free_qty ?? cur.free_qty, 'free_qty', { min: 0, def: 0 });
      if (kind === 'percent' && (value <= 0 || value > 90)) throw bad('value', 'Pourcentage entre 1 et 90');
      if (kind === 'bundle' && (qty < 2 || value <= 0)) throw bad('value', 'Lot : quantité 2 ou plus et prix du lot');
      if (kind === 'buy_get' && (qty < 1 || free < 1)) throw bad('value', 'Indiquez « acheté » et « offert »');
      if (kind === 'price' && value <= 0) throw bad('value', 'Indiquez le prix promotionnel');
      if (kind !== 'percent' && !product_id) throw bad('product', 'Ce type de promotion se fait sur un article');
      const start = b.start_date ?? cur.start_date, end = b.end_date ?? cur.end_date;
      if (start && end && end < start) throw bad('dates', 'La fin doit être après le début');
      return [name, kind, product_id, category_id, value, qty, free, start ? vDate(start, 'start_date') : null, end ? vDate(end, 'end_date') : null,
        str(b.days ?? cur.days, 20), b.active === undefined ? (cur.active ?? 1) : (b.active ? 1 : 0)];
    };
    r.post('/api/shop/promos', requirePerm('stock', 'settings'), (ctx) => {
      const res = db.run('INSERT INTO shop_promos (company_id, name, kind, product_id, category_id, value, qty, free_qty, start_date, end_date, days, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        cid(ctx), ...promoValues(cid(ctx), ctx.body), now());
      audit(db, ctx, 'create', 'promo', Number(res.lastInsertRowid));
      changed(ctx, 'promo');
      return ctx.json(db.get('SELECT * FROM shop_promos WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/shop/promos/:id', requirePerm('stock', 'settings'), (ctx) => {
      const cur = db.get('SELECT * FROM shop_promos WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx));
      if (!cur) throw notFound();
      db.run('UPDATE shop_promos SET name = ?, kind = ?, product_id = ?, category_id = ?, value = ?, qty = ?, free_qty = ?, start_date = ?, end_date = ?, days = ?, active = ? WHERE id = ?', ...promoValues(cid(ctx), ctx.body, cur), cur.id);
      changed(ctx, 'promo');
      return db.get('SELECT * FROM shop_promos WHERE id = ?', cur.id);
    });

    // ---------------- Till ----------------
    r.get('/api/shop/session', requirePerm('pos'), (ctx) => {
      const s = S.openSessionFor(db, ctx.user);
      return s ? S.sessionSummary(db, s.id) : { session: null };
    });
    r.post('/api/shop/sessions', requirePerm('pos'), (ctx) => ctx.json(S.openSession(db, bus, ctx, ctx.body), 201));
    r.get('/api/shop/sessions', requirePerm('pos', 'reports'), (ctx) => {
      const own = !can(ctx.user, 'reports') && !['manager'].includes(ctx.user.role);
      return db.all(`SELECT s.*, r.name register_name, st.name store_name, u.name user_name,
          COALESCE((SELECT SUM(total) FROM shop_sales WHERE session_id = s.id AND status = 'completed' AND kind IN ('sale','return')),0) sales
        FROM shop_sessions s JOIN shop_registers r ON r.id = s.register_id JOIN shop_stores st ON st.id = s.store_id JOIN users u ON u.id = s.user_id
        WHERE s.company_id = ? ${own ? 'AND s.user_id = ' + Number(ctx.user.id) : ''} ${ctx.query.store_id ? 'AND s.store_id = ' + Number(ctx.query.store_id) : ''} ORDER BY s.id DESC LIMIT 200`, cid(ctx));
    });
    r.get('/api/shop/sessions/:id', requirePerm('pos', 'reports'), (ctx) => {
      const s = db.get('SELECT * FROM shop_sessions WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx));
      if (!s) throw notFound();
      return S.sessionSummary(db, s.id);
    });
    r.post('/api/shop/sessions/:id/close', requirePerm('pos'), (ctx) => S.closeSession(db, bus, ctx, ctx.params.id, ctx.body));
    r.post('/api/shop/cash-moves', requirePerm('pos'), (ctx) => { S.cashMove(db, bus, ctx, ctx.body); return { ok: true }; });

    r.get('/api/shop/sales', requirePerm('pos', 'reports'), (ctx) => {
      const rows = S.listSales(db, cid(ctx), ctx.query);
      if (ctx.query.format === 'xlsx') {
        return sendXlsx(ctx, `ventes-${today()}.xlsx`, [{ name: 'Tickets', title: `${company(ctx).name} – Tickets de caisse`, columns: [{ header: 'Numéro', key: 'number', width: 18 },
          { header: 'Date', key: 'created_at', width: 20 }, { header: 'Type', key: 'kind' }, { header: 'Statut', key: 'status' }, { header: 'Boutique', key: 'store_name', width: 18 },
          { header: 'Client', key: 'customer_name', width: 24 }, { header: 'Caissier', key: 'cashier', width: 18 }, { header: 'Paiement', key: 'methods', width: 18 }, { header: 'Total TTC', key: 'total', type: 'money' }], rows }]);
      }
      return rows;
    });
    r.get('/api/shop/sales/:id', requirePerm('pos', 'read'), (ctx) => {
      const s = S.getSale(db, cid(ctx), ctx.params.id);
      if (!s) throw notFound('Ticket introuvable');
      return s;
    });
    r.post('/api/shop/sales', requirePerm('pos'), (ctx) => {
      const id = S.createSale(db, bus, ctx, company(ctx), ctx.body);
      return ctx.json(S.getSale(db, cid(ctx), id), 201);
    });
    r.post('/api/shop/sales/:id/void', requirePerm('pos'), (ctx) => { S.voidSale(db, bus, ctx, ctx.params.id, ctx.body); return S.getSale(db, cid(ctx), ctx.params.id); });
    r.post('/api/shop/sales/:id/return', requirePerm('pos'), (ctx) => {
      const res = S.returnSale(db, bus, ctx, company(ctx), ctx.params.id, ctx.body);
      return ctx.json(S.getSale(db, cid(ctx), res.id), 201);
    });
    r.post('/api/shop/topups', requirePerm('pos'), (ctx) => { const res = S.topup(db, bus, ctx, ctx.body); return ctx.json({ ...S.getSale(db, cid(ctx), res.id), bonus_granted: res.bonus }, 201); });
    r.post('/api/shop/repayments', requirePerm('pos'), (ctx) => S.creditRepayment(db, bus, ctx, company(ctx), ctx.body));
    r.post('/api/shop/momo', requirePerm('pos'), (ctx) => S.momoRequest(db, momo, ctx, company(ctx), ctx.body));
    r.get('/api/shop/momo/:id', requirePerm('pos'), (ctx) => S.momoStatus(db, momo, ctx, ctx.params.id));

    /** Customer display: the till pushes the basket, the screen facing the customer shows it live. */
    r.post('/api/shop/display', requirePerm('pos'), (ctx) => {
      const reg = Number(ctx.body.register_id) || 0;
      bus.emit(cid(ctx), 'display', { register_id: reg, state: ctx.body.state || null });
      return { ok: true };
    });

    // ---------------- Stock ----------------
    r.get('/api/shop/stock', requirePerm('read'), (ctx) => {
      const rows = stockList(db, cid(ctx), ctx.query);
      if (ctx.query.format === 'xlsx') {
        const st = ctx.query.store_id ? db.get('SELECT name FROM shop_stores WHERE id = ?', ctx.query.store_id)?.name : 'Tous les emplacements';
        return sendXlsx(ctx, `stock-${today()}.xlsx`, [{ name: 'Stock', title: `${company(ctx).name} – Stock`, subtitle: `${st} au ${today()}`, columns: [{ header: 'Article', key: 'name', width: 32 },
          { header: 'Code-barres', key: 'barcode', width: 16 }, { header: 'Catégorie', key: 'category', width: 16 }, { header: 'Quantité', key: 'qty', type: 'number' }, { header: 'Seuil', key: 'min_stock', type: 'number' },
          { header: 'Coût moyen HT', key: 'avg_cost', type: 'money' }, { header: 'Valeur', key: 'value', type: 'money' }, { header: 'Prochaine péremption', key: 'next_expiry', width: 14 }], rows,
        totals: { name: 'TOTAL', value: rows.reduce((t, x) => t + x.value, 0) } }]);
      }
      return rows;
    });
    r.post('/api/shop/stock/adjust', requirePerm('stock'), (ctx) => P.adjustStock(db, bus, ctx, ctx.body));
    r.get('/api/shop/expiring', requirePerm('read'), (ctx) => expiringLots(db, cid(ctx), Number(ctx.query.days) || S.settingsOf(db, cid(ctx)).expiry_alert_days, ctx.query.store_id));
    r.get('/api/shop/moves', requirePerm('stock', 'reports'), (ctx) => db.all(`SELECT m.*, p.name, st.name store_name, u.name user_name FROM shop_moves m JOIN products p ON p.id = m.product_id
      JOIN shop_stores st ON st.id = m.store_id LEFT JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ${ctx.query.kind ? 'AND m.kind = ?' : ''} ORDER BY m.id DESC LIMIT 500`,
    cid(ctx), ...(ctx.query.kind ? [ctx.query.kind] : [])));

    // Purchase orders
    r.get('/api/shop/purchase-orders', requirePerm('stock', 'purchases'), (ctx) => db.all(`SELECT o.*, p.name supplier_name, s.name store_name, (SELECT COUNT(*) FROM shop_po_lines WHERE po_id = o.id) n_lines
      FROM shop_pos o JOIN partners p ON p.id = o.supplier_id JOIN shop_stores s ON s.id = o.store_id WHERE o.company_id = ? ORDER BY o.id DESC LIMIT 300`, cid(ctx)));
    r.get('/api/shop/purchase-orders/suggest', requirePerm('stock', 'purchases'), (ctx) => P.reorderSuggestions(db, cid(ctx), Number(ctx.query.store_id) || userStore(ctx)));
    r.post('/api/shop/purchase-orders', requirePerm('stock', 'purchases'), (ctx) => ctx.json(P.getPO(db, cid(ctx), P.createPO(db, ctx, ctx.body)), 201));
    r.get('/api/shop/purchase-orders/:id', requirePerm('stock', 'purchases'), (ctx) => P.getPO(db, cid(ctx), ctx.params.id) || (() => { throw notFound(); })());
    r.put('/api/shop/purchase-orders/:id', requirePerm('stock', 'purchases'), (ctx) => { P.updatePO(db, ctx, ctx.params.id, ctx.body); return P.getPO(db, cid(ctx), ctx.params.id); });
    r.post('/api/shop/purchase-orders/:id/receive', requirePerm('stock'), (ctx) => { P.receivePO(db, bus, ctx, company(ctx), ctx.params.id, ctx.body); return P.getPO(db, cid(ctx), ctx.params.id); });

    // Transfers
    r.get('/api/shop/transfers', requirePerm('stock', 'read'), (ctx) => db.all(`SELECT t.*, a.name from_name, b.name to_name, (SELECT COUNT(*) FROM shop_transfer_lines WHERE transfer_id = t.id) n_lines
      FROM shop_transfers t JOIN shop_stores a ON a.id = t.from_store JOIN shop_stores b ON b.id = t.to_store WHERE t.company_id = ? ORDER BY t.id DESC LIMIT 300`, cid(ctx)));
    r.post('/api/shop/transfers', requirePerm('stock'), (ctx) => ctx.json(P.getTransfer(db, cid(ctx), P.createTransfer(db, bus, ctx, ctx.body)), 201));
    r.get('/api/shop/transfers/:id', requirePerm('stock', 'read'), (ctx) => P.getTransfer(db, cid(ctx), ctx.params.id) || (() => { throw notFound(); })());
    r.post('/api/shop/transfers/:id/receive', requirePerm('stock'), (ctx) => { P.receiveTransfer(db, bus, ctx, ctx.params.id, ctx.body); return P.getTransfer(db, cid(ctx), ctx.params.id); });

    // Inventory counts
    r.get('/api/shop/counts', requirePerm('stock'), (ctx) => db.all(`SELECT c.*, s.name store_name, (SELECT COUNT(*) FROM shop_count_lines WHERE count_id = c.id AND counted IS NOT NULL) counted,
      (SELECT COUNT(*) FROM shop_count_lines WHERE count_id = c.id) n_lines FROM shop_counts c JOIN shop_stores s ON s.id = c.store_id WHERE c.company_id = ? ORDER BY c.id DESC LIMIT 100`, cid(ctx)));
    r.post('/api/shop/counts', requirePerm('stock'), (ctx) => ctx.json(P.getCount(db, cid(ctx), P.startCount(db, ctx, ctx.body)), 201));
    r.get('/api/shop/counts/:id', requirePerm('stock'), (ctx) => P.getCount(db, cid(ctx), ctx.params.id) || (() => { throw notFound(); })());
    r.post('/api/shop/counts/:id/lines', requirePerm('stock'), (ctx) => P.countLine(db, ctx, ctx.params.id, ctx.body));
    r.post('/api/shop/counts/:id/close', requirePerm('stock'), (ctx) => P.closeCount(db, bus, ctx, ctx.params.id, ctx.body));

    // ---------------- Reports ----------------
    const REPORTS = { dashboard: R.dashboard, margin: R.marginReport, hourly: R.hourlyReport, cashiers: R.cashierReport, stores: R.storeReport };
    r.get('/api/shop/reports/:name', requirePerm('read'), (ctx) => {
      const fn = REPORTS[ctx.params.name];
      if (!fn) throw notFound('Rapport inconnu');
      if (ctx.params.name !== 'dashboard' && !can(ctx.user, 'reports') && ctx.user.role !== 'manager') throw forbidden('Votre rôle ne donne pas accès aux rapports');
      const data = fn(db, cid(ctx), ctx.query);
      if (ctx.query.format === 'xlsx') {
        const c = company(ctx); const sub = `Du ${data.from} au ${data.to}`;
        const m = (header, key) => ({ header, key, type: 'money' });
        const sheets = {
          margin: [{ name: 'Marge par article', title: `${c.name} – Marge par article`, subtitle: sub, columns: [{ header: 'Article', key: 'name', width: 32 }, { header: 'Catégorie', key: 'category', width: 16 },
            { header: 'Qté', key: 'qty', type: 'number' }, m('Ventes TTC', 'sales'), m('Ventes HT', 'net'), m('Coût', 'cost'), m('Marge', 'margin'), { header: 'Marge %', key: 'margin_pct', type: 'number' }, m('Remises', 'discounts')],
          rows: data.rows, totals: { name: 'TOTAL', ...data.totals } }],
          hourly: [{ name: 'Ventes par heure', title: `${c.name} – Ventes par heure`, subtitle: sub, columns: [{ header: 'Heure', key: 'hour', type: 'number' }, { header: 'Tickets', key: 'tickets', type: 'number' }, m('Ventes', 'sales')], rows: data.rows }],
          cashiers: [{ name: 'Caissiers', title: `${c.name} – Ventes par caissier`, subtitle: sub, columns: [{ header: 'Caissier', key: 'name', width: 24 }, { header: 'Tickets', key: 'tickets', type: 'number' }, m('Ventes', 'sales'),
            { header: 'Annulations', key: 'voids', type: 'number' }, m('Montant annulé', 'voided'), { header: 'Retours', key: 'returns', type: 'number' }, m('Remises', 'discounts'), m('Écarts de caisse', 'variance')], rows: data.rows }],
          stores: [{ name: 'Boutiques', title: `${c.name} – Ventes par boutique`, subtitle: sub, columns: [{ header: 'Boutique', key: 'name', width: 24 }, { header: 'Tickets', key: 'tickets', type: 'number' }, m('Ventes TTC', 'sales'),
            m('Ventes HT', 'net'), m('Marge', 'margin'), m('Valeur du stock', 'stock_value')], rows: data.rows }],
        }[ctx.params.name];
        if (!sheets) throw bad('format', 'Export non disponible');
        return sendXlsx(ctx, `${ctx.params.name}-${data.from}-${data.to}.xlsx`, sheets);
      }
      return data;
    });

    // ---------------- Printing ----------------
    r.get('/print/shop/receipt/:id', requirePerm('pos', 'read'), (ctx) => {
      const s = S.getSale(db, cid(ctx), ctx.params.id);
      if (!s) throw notFound('Ticket introuvable');
      ctx.send(renderReceipt(company(ctx), s, { autoPrint: ctx.query.print === '1', settings: S.settingsOf(db, cid(ctx)) }));
    });
    r.get('/r/:token', (ctx) => { // public receipt sent by WhatsApp: no sign-in, unguessable token
      const row = db.get('SELECT id, company_id FROM shop_sales WHERE token = ?', ctx.params.token);
      if (!row) return ctx.send('<p style="font-family:system-ui;padding:24px">Ticket introuvable.</p>', 'text/html; charset=utf-8', 404);
      const co = db.get('SELECT * FROM companies WHERE id = ?', row.company_id);
      ctx.send(renderReceipt(co, S.getSale(db, row.company_id, row.id), { settings: S.settingsOf(db, row.company_id) }));
    });
    r.get('/print/shop/labels', requirePerm('read'), (ctx) => {
      const ids = String(ctx.query.ids || '').split(',').map(Number).filter(Boolean);
      const copies = Math.min(Math.max(Number(ctx.query.copies) || 1, 1), 50);
      if (!ids.length) throw bad('ids', 'Choisissez les articles');
      const promos = S.activePromos(db, cid(ctx));
      const list = [];
      for (const id of ids.slice(0, 300)) {
        const it = getItem(cid(ctx), id);
        if (!it) continue;
        const p = promos.find((x) => x.kind === 'price' && Number(x.product_id) === it.id && (!x.start_date || x.start_date <= today()) && (!x.end_date || x.end_date >= today()));
        for (let k = 0; k < copies; k++) list.push({ ...it, promo_price: p ? p.value : undefined });
      }
      ctx.send(renderLabels(company(ctx), list, { autoPrint: ctx.query.print === '1' }));
    });
    r.get('/print/shop/session/:id', requirePerm('pos', 'reports'), (ctx) => {
      const s = db.get('SELECT id FROM shop_sessions WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx));
      if (!s) throw notFound();
      ctx.send(renderZReport(company(ctx), S.sessionSummary(db, s.id), { autoPrint: ctx.query.print === '1' }));
    });
    r.get('/print/shop/po/:id', requirePerm('stock', 'purchases'), (ctx) => {
      const o = P.getPO(db, cid(ctx), ctx.params.id);
      if (!o) throw notFound();
      ctx.send(renderPO(company(ctx), o, { autoPrint: ctx.query.print === '1' }));
    });
  },

  jobs({ db, bus }) {
    const run = () => { try { R.runShopChecks(db, bus, raiseAlert); } catch (e) { console.warn('shop checks', e.message); } };
    const t = setTimeout(run, 8_000);
    const iv = setInterval(run, 60 * 60_000);
    return () => { clearTimeout(t); clearInterval(iv); };
  },
};
