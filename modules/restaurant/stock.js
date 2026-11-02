// Ingredient stock driven by recipes: every dish sent to the kitchen takes its
// ingredients out of stock at their average cost, so food cost and margin are
// known per plate. Deliveries (optionally booked as a Compta supplier bill),
// waste, staff meals, stock counts and purchase suggestions from the forecast.
import { bad, notFound } from '../../core/errors.js';
import { str, num, int, oneOf } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { raiseAlert, audit } from '../../core/alerts.js';
import * as docs from '../accounting/documents.js';

const q3 = (v) => Math.round(Number(v) * 1000) / 1000;

function move(db, companyId, ingId, qty, { kind, unit_cost = 0, ref_type = '', ref_id = null, note = '', userId = null }) {
  db.run('UPDATE resto_ingredients SET stock = round(stock + ?, 3) WHERE id = ?', qty, ingId);
  db.run('INSERT INTO resto_stock_moves (company_id, ingredient_id, qty, kind, unit_cost, ref_type, ref_id, note, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    companyId, ingId, q3(qty), kind, unit_cost, ref_type, ref_id, note, userId, now());
}

/** Takes a dish's ingredients out of stock. Returns the cost of the portion(s). */
export function consumeRecipe(db, companyId, productId, qty, { ref_id, userId } = {}) {
  let cost = 0;
  for (const r of db.all('SELECT r.qty, g.id, g.cost, g.stock, g.min_stock, g.name, g.unit FROM resto_recipes r JOIN resto_ingredients g ON g.id = r.ingredient_id WHERE r.product_id = ?', productId)) {
    const used = q3(r.qty * qty);
    move(db, companyId, r.id, -used, { kind: 'sale', unit_cost: r.cost, ref_type: 'line', ref_id, userId });
    cost += used * r.cost;
    const left = r.stock - used;
    if (r.min_stock > 0 && left <= r.min_stock && r.stock > r.min_stock) {
      raiseAlert(db, null, companyId, { kind: 'resto_low_stock', level: 'warning', title: `Stock bas : ${r.name}`, body: `Il reste ${q3(left)} ${r.unit} (seuil ${r.min_stock}).`, entity: 'ingredient', entity_id: r.id });
    }
  }
  return cost;
}

/** A line cancelled before the kitchen started: its ingredients go back. */
export function restoreRecipe(db, companyId, lineId, userId) {
  for (const m of db.all("SELECT * FROM resto_stock_moves WHERE company_id = ? AND ref_type = 'line' AND ref_id = ? AND kind = 'sale'", companyId, lineId)) {
    move(db, companyId, m.ingredient_id, -m.qty, { kind: 'void', unit_cost: m.unit_cost, ref_type: 'line', ref_id: lineId, userId });
  }
}

export function listIngredients(db, companyId, q = {}) {
  const where = ['g.company_id = ?']; const a = [companyId];
  if (!q.all) where.push('g.active = 1');
  if (q.low) where.push('g.min_stock > 0 AND g.stock <= g.min_stock');
  if (q.q) { where.push('g.name LIKE ?'); a.push(`%${q.q}%`); }
  return db.all(`SELECT g.*, p.name supplier_name, (SELECT COUNT(*) FROM resto_recipes r WHERE r.ingredient_id = g.id) dishes,
      (SELECT COALESCE(-SUM(qty),0) FROM resto_stock_moves m WHERE m.ingredient_id = g.id AND m.kind IN ('sale','void') AND m.at >= datetime('now','-7 days')) used_7d
    FROM resto_ingredients g LEFT JOIN partners p ON p.id = g.supplier_id WHERE ${where.join(' AND ')} ORDER BY g.category, g.name`, ...a)
    .map((g) => ({ ...g, value: Math.round(g.stock * g.cost), days_left: g.used_7d > 0 ? Math.round((g.stock / (g.used_7d / 7)) * 10) / 10 : null }));
}

export function saveIngredient(db, companyId, b, id = null) {
  const cur = id ? db.get('SELECT * FROM resto_ingredients WHERE id = ? AND company_id = ?', id, companyId) : null;
  if (id && !cur) throw notFound('Ingrédient introuvable');
  const supplier = b.supplier_id === undefined ? cur?.supplier_id : (b.supplier_id || null);
  if (supplier && !db.get("SELECT 1 FROM partners WHERE id = ? AND company_id = ? AND kind = 'supplier'", supplier, companyId)) throw bad('supplier', 'Fournisseur inconnu');
  const v = { name: str(b.name ?? cur?.name, 80), unit: str(b.unit ?? cur?.unit, 10) || 'kg', min_stock: num(b.min_stock ?? cur?.min_stock, 'min_stock', { min: 0, def: 0 }),
    cost: num(b.cost ?? cur?.cost, 'cost', { min: 0, def: 0 }), supplier_id: supplier ?? null, category: str(b.category ?? cur?.category, 40), active: b.active === undefined ? (cur?.active ?? 1) : (b.active ? 1 : 0) };
  if (!v.name) throw bad('name', 'Le nom est obligatoire');
  return db.tx(() => {
    if (cur) db.run(`UPDATE resto_ingredients SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(v), cur.id);
    else {
      id = Number(db.run(`INSERT INTO resto_ingredients (company_id, ${Object.keys(v).join(', ')}) VALUES (?, ${Object.keys(v).map(() => '?').join(', ')})`, companyId, ...Object.values(v)).lastInsertRowid);
      const start = num(b.stock, 'stock', { min: 0, def: 0 });
      if (start) move(db, companyId, id, start, { kind: 'adjust', unit_cost: v.cost, note: 'Stock initial' });
    }
    return db.get('SELECT * FROM resto_ingredients WHERE id = ?', id);
  });
}

/**
 * A delivery: lines [{ ingredient_id, qty, unit_cost }] (cost HT per unit).
 * Updates the weighted average cost; with create_bill, books the supplier bill in Compta.
 */
export function receive(db, bus, ctx, company, b) {
  const cid = company.id;
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => {
    const g = db.get('SELECT * FROM resto_ingredients WHERE id = ? AND company_id = ?', l.ingredient_id, cid);
    if (!g) throw bad('ingredient', 'Ingrédient inconnu');
    return { g, qty: num(l.qty, 'qty', { min: 0.001 }), cost: num(l.unit_cost ?? g.cost, 'unit_cost', { min: 0 }) };
  });
  if (!lines.length) throw bad('lines', 'Ajoutez au moins un article');
  const supplier = b.supplier_id ? db.get("SELECT * FROM partners WHERE id = ? AND company_id = ? AND kind = 'supplier'", b.supplier_id, cid) : null;
  if (b.create_bill && !supplier) throw bad('supplier', 'Choisissez le fournisseur pour enregistrer sa facture');
  return db.tx(() => {
    for (const l of lines) {
      const stock = Math.max(0, l.g.stock);
      const avg = stock + l.qty > 0 ? (stock * l.g.cost + l.qty * l.cost) / (stock + l.qty) : l.cost;
      db.run('UPDATE resto_ingredients SET cost = ?, supplier_id = COALESCE(?, supplier_id) WHERE id = ?', Math.round(avg * 100) / 100, supplier?.id ?? null, l.g.id);
      move(db, cid, l.g.id, l.qty, { kind: 'receipt', unit_cost: l.cost, ref_type: 'receipt', note: str(b.reference, 60) || (supplier ? supplier.name : ''), userId: ctx.user.id });
    }
    let docId = null;
    if (b.create_bill) {
      docId = docs.createDocument(db, { ...ctx, user: { ...ctx.user, role: 'owner' } }, company, {
        kind: 'bill', partner_id: supplier.id, date: today(), supplier_ref: str(b.reference, 60), subject: 'Achats cuisine et bar', validate: true,
        lines: lines.map((l) => ({ description: `${l.g.name} (${q3(l.qty)} ${l.g.unit})`, qty: 1, unit_price: Math.round(l.qty * l.cost), vat_rate: b.vat ? (company.vat_enabled ? company.vat_rate : 0) : 0, account_code: '602', kind: 'good' })),
      });
    }
    audit(db, ctx, 'receive', 'resto_stock', null, { lines: lines.length, supplier: supplier?.name, bill: docId });
    bus.emit(cid, 'change', { entity: 'resto_stock' });
    return { ok: true, document_id: docId };
  });
}

/** Waste, staff meal or manual correction (qty may be negative for adjust). */
export function adjust(db, bus, ctx, companyId, b) {
  const g = db.get('SELECT * FROM resto_ingredients WHERE id = ? AND company_id = ?', b.ingredient_id, companyId);
  if (!g) throw notFound('Ingrédient introuvable');
  const kind = oneOf(b.kind, ['waste', 'staff_meal', 'adjust'], 'kind');
  let qty = num(b.qty, 'qty');
  if (kind !== 'adjust') qty = -Math.abs(qty);
  if (!qty) throw bad('qty', 'Quantité invalide');
  if (kind === 'waste' && !str(b.note)) throw bad('note', 'Indiquez la raison de la perte');
  db.tx(() => move(db, companyId, g.id, qty, { kind, unit_cost: g.cost, note: str(b.note, 200), userId: ctx.user.id }));
  audit(db, ctx, kind, 'ingredient', g.id, { qty, value: Math.round(qty * g.cost) });
  bus.emit(companyId, 'change', { entity: 'resto_stock' });
  return db.get('SELECT * FROM resto_ingredients WHERE id = ?', g.id);
}

/** Stock count: counts: [{ ingredient_id, counted }]. The difference is logged as 'count'. */
export function count(db, bus, ctx, companyId, b) {
  const counts = Array.isArray(b.counts) ? b.counts : [];
  let value = 0;
  db.tx(() => {
    for (const c of counts) {
      if (c.counted === '' || c.counted == null) continue;
      const g = db.get('SELECT * FROM resto_ingredients WHERE id = ? AND company_id = ?', c.ingredient_id, companyId);
      if (!g) continue;
      const diff = q3(num(c.counted, 'counted', { min: 0 }) - g.stock);
      if (diff) { move(db, companyId, g.id, diff, { kind: 'count', unit_cost: g.cost, note: 'Inventaire', userId: ctx.user.id }); value += diff * g.cost; }
    }
  });
  audit(db, ctx, 'count', 'resto_stock', null, { lines: counts.length, value: Math.round(value) });
  if (value < -10000) raiseAlert(db, bus, companyId, { kind: 'resto_count', level: 'warning', title: `Inventaire : écart de ${Math.round(value).toLocaleString('fr-FR')} FCFA`, body: 'Vérifiez les pertes, les portions et les sorties non enregistrées.', entity: 'resto_stock', entity_id: null });
  bus.emit(companyId, 'change', { entity: 'resto_stock' });
  return { ok: true, value: Math.round(value) };
}

export function moves(db, companyId, q = {}) {
  const where = ['m.company_id = ?']; const a = [companyId];
  if (q.ingredient_id) { where.push('m.ingredient_id = ?'); a.push(q.ingredient_id); }
  if (q.kind) { where.push('m.kind = ?'); a.push(q.kind); }
  return db.all(`SELECT m.*, g.name, g.unit, u.name user_name FROM resto_stock_moves m JOIN resto_ingredients g ON g.id = m.ingredient_id LEFT JOIN users u ON u.id = m.user_id
    WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ${Math.min(500, int(q.limit, 'limit', { min: 1, def: 200 }))}`, ...a);
}
