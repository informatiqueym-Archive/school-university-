// Purchase orders (suggested from low stock), goods receipt with lots and expiry
// dates (creates the supplier bill in Teknons Compta), transfers between shops,
// stock adjustments and inventory counts done on the phone.
import { bad, notFound, conflict } from '../../core/errors.js';
import { str, int, date as vDate, addDays } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { raiseAlert, audit } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { DEFAULTS } from '../accounting/chart.js';
import { nextNumber } from '../accounting/ledger.js';
import * as docs from '../accounting/documents.js';
import { moveStock, stockOf, assertStore, assertQty, qtyRound } from './stock.js';

const sys = (ctx) => ({ ...ctx, user: { ...ctx.user, role: 'owner' } });
const item = (db, cid, pid) => {
  const it = db.get('SELECT p.id product_id, p.name, p.vat_rate, i.* FROM shop_items i JOIN products p ON p.id = i.product_id WHERE i.product_id = ? AND i.company_id = ?', pid, cid);
  if (!it) throw notFound('Article introuvable');
  return it;
};

// ---------------- Purchase orders ----------------
/** Articles under their minimum, grouped by usual supplier, with the quantity to order. */
export function reorderSuggestions(db, cid, storeId) {
  const rows = db.all(`SELECT p.id product_id, p.name, i.min_stock, i.reorder_qty, i.avg_cost, p.purchase_price, i.supplier_id, s.name supplier_name,
      COALESCE((SELECT qty FROM shop_stock WHERE store_id = ? AND product_id = p.id), 0) qty,
      COALESCE((SELECT SUM(l.qty - l.received_qty) FROM shop_po_lines l JOIN shop_pos o ON o.id = l.po_id WHERE o.status IN ('draft','sent') AND o.store_id = ? AND l.product_id = p.id), 0) on_order
    FROM shop_items i JOIN products p ON p.id = i.product_id LEFT JOIN partners s ON s.id = i.supplier_id
    WHERE i.company_id = ? AND p.active = 1 AND i.min_stock > 0`, storeId, storeId, cid);
  return rows.filter((r) => r.qty + r.on_order <= r.min_stock).map((r) => ({
    ...r, suggested: Math.max(r.reorder_qty || 0, Math.ceil(r.min_stock * 2 - r.qty - r.on_order)), unit_cost: Math.round(r.purchase_price || r.avg_cost || 0),
  }));
}

function poLines(db, cid, raw) {
  if (!Array.isArray(raw) || !raw.length) throw bad('lines', 'Ajoutez au moins un article');
  return raw.map((l) => { item(db, cid, l.product_id); return { product_id: Number(l.product_id), qty: assertQty(l.qty), unit_cost: int(l.unit_cost, 'unit_cost', { min: 0, def: 0 }) }; });
}

export function createPO(db, ctx, b) {
  const cid = ctx.user.company_id;
  const sup = db.get("SELECT * FROM partners WHERE id = ? AND company_id = ? AND kind = 'supplier'", b.supplier_id, cid);
  if (!sup) throw bad('supplier', 'Choisissez un fournisseur');
  assertStore(db, cid, b.store_id);
  const lines = poLines(db, cid, b.lines);
  return db.tx(() => {
    const d = vDate(b.date, 'date', today());
    const r = db.run('INSERT INTO shop_pos (company_id, number, supplier_id, store_id, status, date, expected_date, total, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      cid, nextNumber(db, cid, `BC-${d.slice(0, 4)}`), sup.id, b.store_id, b.send ? 'sent' : 'draft', d, b.expected_date ? vDate(b.expected_date, 'expected_date') : addDays(d, 7),
      lines.reduce((t, l) => t + Math.round(l.qty * l.unit_cost), 0), str(b.notes, 1000), ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    for (const l of lines) db.run('INSERT INTO shop_po_lines (po_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', id, l.product_id, l.qty, l.unit_cost);
    audit(db, ctx, 'create', 'purchase_order', id);
    return id;
  });
}

export function getPO(db, cid, id) {
  const o = db.get(`SELECT o.*, p.name supplier_name, p.phone supplier_phone, s.name store_name, d.number bill_number FROM shop_pos o JOIN partners p ON p.id = o.supplier_id
    JOIN shop_stores s ON s.id = o.store_id LEFT JOIN documents d ON d.id = o.document_id WHERE o.id = ? AND o.company_id = ?`, id, cid);
  if (!o) return null;
  o.lines = db.all('SELECT l.*, p.name, i.barcode, i.track_expiry FROM shop_po_lines l JOIN products p ON p.id = l.product_id JOIN shop_items i ON i.product_id = l.product_id WHERE l.po_id = ? ORDER BY l.id', id);
  return o;
}

export function updatePO(db, ctx, id, b) {
  const o = getPO(db, ctx.user.company_id, id);
  if (!o) throw notFound('Bon de commande introuvable');
  if (b.status === 'cancelled') { if (o.status === 'received') throw conflict('received', 'Commande déjà reçue'); db.run("UPDATE shop_pos SET status = 'cancelled' WHERE id = ?", id); return; }
  if (b.status === 'sent' && o.status === 'draft') { db.run("UPDATE shop_pos SET status = 'sent' WHERE id = ?", id); return; }
  if (o.status !== 'draft') throw conflict('locked', 'Seul un brouillon peut être modifié');
  const lines = poLines(db, ctx.user.company_id, b.lines);
  db.tx(() => {
    db.run('DELETE FROM shop_po_lines WHERE po_id = ?', id);
    for (const l of lines) db.run('INSERT INTO shop_po_lines (po_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', id, l.product_id, l.qty, l.unit_cost);
    db.run('UPDATE shop_pos SET total = ?, notes = ?, expected_date = COALESCE(?, expected_date) WHERE id = ?', lines.reduce((t, l) => t + Math.round(l.qty * l.unit_cost), 0), str(b.notes ?? o.notes, 1000), b.expected_date || null, id);
  });
}

/**
 * Goods receipt. lines: [{ line_id, qty, unit_cost, lot, expiry }]. Stock goes in, average costs are
 * updated and the supplier bill is created and posted in Teknons Compta (601 / 445 / 401).
 */
export function receivePO(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const o = getPO(db, cid, id);
  if (!o) throw notFound('Bon de commande introuvable');
  if (!['draft', 'sent'].includes(o.status)) throw conflict('state', 'Cette commande est déjà reçue ou annulée');
  const got = (Array.isArray(b.lines) ? b.lines : o.lines.map((l) => ({ line_id: l.id, qty: l.qty - l.received_qty }))).filter((l) => Number(l.qty) > 0);
  if (!got.length) throw bad('lines', 'Indiquez les quantités reçues');
  return db.tx(() => {
    const billLines = [];
    for (const g of got) {
      const l = o.lines.find((x) => x.id === Number(g.line_id));
      if (!l) throw bad('line', 'Ligne introuvable');
      const qty = assertQty(g.qty);
      const cost = int(g.unit_cost ?? l.unit_cost, 'unit_cost', { min: 0 });
      if (l.track_expiry && !g.expiry) throw bad('expiry', `${l.name} : indiquez la date de péremption`);
      moveStock(db, cid, o.store_id, l.product_id, qty, { kind: 'receipt', ref_type: 'po', ref_id: id, unit_cost: cost, userId: ctx.user.id, lot: g.lot, expiry: g.expiry ? vDate(g.expiry, 'expiry') : null });
      db.run('UPDATE shop_po_lines SET received_qty = received_qty + ?, unit_cost = ? WHERE id = ?', qty, cost, l.id);
      if (cost > 0) billLines.push({ description: `${l.name} (${qtyRound(qty)} × ${fcfa(cost)} HT)`, qty: 1, unit_price: Math.round(qty * cost), kind: 'good', account_code: DEFAULTS.purchases, product_id: null });
    }
    let docId = null;
    if (billLines.length && b.create_bill !== false) {
      docId = docs.createDocument(db, sys(ctx), company, { kind: 'bill', partner_id: o.supplier_id, date: today(), supplier_ref: str(b.supplier_ref, 60) || o.number, subject: `Réception ${o.number}`, lines: billLines, validate: true });
    }
    const total = db.get('SELECT COALESCE(SUM(qty*unit_cost),0) t FROM shop_po_lines WHERE po_id = ?', id).t;
    db.run("UPDATE shop_pos SET status = 'received', received_at = ?, document_id = COALESCE(?, document_id), total = ? WHERE id = ?", now(), docId, Math.round(total), id);
    audit(db, ctx, 'receive', 'purchase_order', id);
    bus.emit(cid, 'change', { entity: 'stock' });
    return { id, document_id: docId };
  });
}

// ---------------- Direct receipt and adjustments ----------------
export function adjustStock(db, bus, ctx, b) {
  const cid = ctx.user.company_id;
  assertStore(db, cid, b.store_id);
  const it = item(db, cid, b.product_id);
  const kind = ['receipt', 'adjust', 'loss'].includes(b.kind) ? b.kind : 'adjust';
  let qty = Number(b.qty);
  if (!Number.isFinite(qty) || qty === 0) throw bad('qty', 'Quantité invalide');
  if (kind === 'loss') qty = -Math.abs(qty);
  if (kind === 'receipt' && qty < 0) throw bad('qty', 'Une entrée doit être positive');
  if (kind !== 'receipt' && !str(b.note)) throw bad('note', 'Indiquez le motif (casse, vol, erreur…)');
  const after = moveStock(db, cid, b.store_id, it.product_id, qty, { kind: kind === 'loss' ? 'adjust' : kind, unit_cost: int(b.unit_cost, 'unit_cost', { min: 0, def: 0 }) || it.avg_cost, userId: ctx.user.id, note: str(b.note, 300) || '', lot: b.lot, expiry: b.expiry || null, ref_type: 'manual' });
  audit(db, ctx, 'stock_' + kind, 'product', it.product_id, { qty, note: b.note });
  if (kind !== 'receipt' && Math.abs(qty * it.avg_cost) >= 50000) {
    raiseAlert(db, bus, cid, { kind: 'stock_adjust', level: 'warning', title: `Ajustement de stock : ${it.name} ${qty > 0 ? '+' : ''}${qty}`, body: `${ctx.user.name} : ${b.note} (${fcfa(Math.abs(qty * it.avg_cost))}).` });
  }
  bus.emit(cid, 'change', { entity: 'stock' });
  return { qty: after };
}

// ---------------- Transfers ----------------
export function createTransfer(db, bus, ctx, b) {
  const cid = ctx.user.company_id;
  const from = assertStore(db, cid, b.from_store), to = assertStore(db, cid, b.to_store);
  if (from.id === to.id) throw bad('stores', 'Choisissez deux emplacements différents');
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad('lines', 'Ajoutez au moins un article');
  return db.tx(() => {
    const r = db.run('INSERT INTO shop_transfers (company_id, number, from_store, to_store, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
      cid, nextNumber(db, cid, `TR-${today().slice(0, 4)}`), from.id, to.id, str(b.notes, 500), ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    for (const l of b.lines) {
      const it = item(db, cid, l.product_id);
      const qty = assertQty(l.qty);
      if (qty > stockOf(db, from.id, it.product_id) + 1e-9) throw bad('qty', `${it.name} : stock insuffisant à ${from.name} (${stockOf(db, from.id, it.product_id)})`);
      db.run('INSERT INTO shop_transfer_lines (transfer_id, product_id, qty) VALUES (?,?,?)', id, it.product_id, qty);
      moveStock(db, cid, from.id, it.product_id, -qty, { kind: 'transfer_out', ref_type: 'transfer', ref_id: id, userId: ctx.user.id });
    }
    audit(db, ctx, 'create', 'transfer', id);
    bus.emit(cid, 'change', { entity: 'stock' });
    return id;
  });
}

export function getTransfer(db, cid, id) {
  const t = db.get(`SELECT t.*, a.name from_name, b.name to_name, u.name created_by_name FROM shop_transfers t JOIN shop_stores a ON a.id = t.from_store JOIN shop_stores b ON b.id = t.to_store
    LEFT JOIN users u ON u.id = t.created_by WHERE t.id = ? AND t.company_id = ?`, id, cid);
  if (!t) return null;
  t.lines = db.all('SELECT l.*, p.name FROM shop_transfer_lines l JOIN products p ON p.id = l.product_id WHERE l.transfer_id = ?', id);
  return t;
}

export function receiveTransfer(db, bus, ctx, id, b) {
  const cid = ctx.user.company_id;
  const t = getTransfer(db, cid, id);
  if (!t) throw notFound('Transfert introuvable');
  if (t.status !== 'sent') throw conflict('state', 'Transfert déjà reçu ou annulé');
  const got = Object.fromEntries((b.lines || []).map((l) => [Number(l.line_id), Number(l.qty)]));
  db.tx(() => {
    for (const l of t.lines) {
      const q = got[l.id] ?? l.qty;
      if (q < 0 || q > l.qty) throw bad('qty', `${l.name} : quantité reçue invalide`);
      db.run('UPDATE shop_transfer_lines SET received_qty = ? WHERE id = ?', q, l.id);
      if (q > 0) moveStock(db, cid, t.to_store, l.product_id, q, { kind: 'transfer_in', ref_type: 'transfer', ref_id: id, userId: ctx.user.id });
      if (q < l.qty) raiseAlert(db, bus, cid, { kind: 'transfer_gap', level: 'warning', title: `Transfert ${t.number} : ${l.name} manquant`, body: `Envoyé ${l.qty}, reçu ${q} à ${t.to_name}.`, entity: 'transfer', entity_id: id });
    }
    db.run("UPDATE shop_transfers SET status = 'received', received_by = ?, received_at = ? WHERE id = ?", ctx.user.id, now(), id);
  });
  bus.emit(cid, 'change', { entity: 'stock' });
}

// ---------------- Inventory counts ----------------
export function startCount(db, ctx, b) {
  const cid = ctx.user.company_id;
  const store = assertStore(db, cid, b.store_id);
  if (db.get("SELECT id FROM shop_counts WHERE store_id = ? AND status = 'open'", store.id)) throw conflict('open', 'Un inventaire est déjà en cours dans cet emplacement');
  return db.tx(() => {
    const r = db.run('INSERT INTO shop_counts (company_id, store_id, number, scope, created_by, created_at) VALUES (?,?,?,?,?,?)',
      cid, store.id, nextNumber(db, cid, `INV-${today().slice(0, 4)}`), str(b.scope, 100), ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    const where = b.category_id ? 'AND i.category_id = ?' : '';
    const prods = db.all(`SELECT i.product_id FROM shop_items i JOIN products p ON p.id = i.product_id WHERE i.company_id = ? AND p.active = 1 ${where}`, cid, ...(b.category_id ? [b.category_id] : []));
    for (const p of prods) db.run('INSERT INTO shop_count_lines (count_id, product_id, expected) VALUES (?,?,?)', id, p.product_id, stockOf(db, store.id, p.product_id));
    return id;
  });
}

export function getCount(db, cid, id) {
  const c = db.get('SELECT c.*, s.name store_name FROM shop_counts c JOIN shop_stores s ON s.id = c.store_id WHERE c.id = ? AND c.company_id = ?', id, cid);
  if (!c) return null;
  c.lines = db.all(`SELECT l.*, p.name, i.barcode, i.avg_cost, i.by_weight FROM shop_count_lines l JOIN products p ON p.id = l.product_id JOIN shop_items i ON i.product_id = l.product_id
    WHERE l.count_id = ? ORDER BY l.counted IS NOT NULL, p.name`, id);
  c.counted = c.lines.filter((l) => l.counted != null).length;
  return c;
}

/** Scanning on the phone adds 1 (or the given qty); "set" replaces the counted quantity. */
export function countLine(db, ctx, id, b) {
  const c = db.get("SELECT * FROM shop_counts WHERE id = ? AND company_id = ? AND status = 'open'", id, ctx.user.company_id);
  if (!c) throw notFound('Inventaire introuvable ou clôturé');
  let pid = b.product_id;
  if (!pid && b.barcode) pid = db.get('SELECT product_id FROM shop_items WHERE company_id = ? AND barcode = ?', ctx.user.company_id, String(b.barcode).trim())?.product_id;
  if (!pid) throw notFound('Code-barres inconnu');
  const l = db.get('SELECT * FROM shop_count_lines WHERE count_id = ? AND product_id = ?', id, pid);
  if (!l) {
    item(db, ctx.user.company_id, pid);
    db.run('INSERT INTO shop_count_lines (count_id, product_id, expected) VALUES (?,?,?)', id, pid, stockOf(db, c.store_id, pid));
  }
  const q = Number(b.qty ?? 1);
  if (!Number.isFinite(q) || q < 0) throw bad('qty', 'Quantité invalide');
  if (b.set) db.run('UPDATE shop_count_lines SET counted = ? WHERE count_id = ? AND product_id = ?', qtyRound(q), id, pid);
  else db.run('UPDATE shop_count_lines SET counted = COALESCE(counted, 0) + ? WHERE count_id = ? AND product_id = ?', qtyRound(q), id, pid);
  return db.get('SELECT l.*, p.name FROM shop_count_lines l JOIN products p ON p.id = l.product_id WHERE count_id = ? AND product_id = ?', id, pid);
}

/** Closes the count: every counted line becomes an adjustment; articles not counted keep their stock. */
export function closeCount(db, bus, ctx, id, b) {
  const cid = ctx.user.company_id;
  const c = getCount(db, cid, id);
  if (!c || c.status !== 'open') throw notFound('Inventaire introuvable ou clôturé');
  if (b.cancel) { db.run("UPDATE shop_counts SET status = 'cancelled', closed_at = ? WHERE id = ?", now(), id); return { cancelled: true }; }
  let value = 0;
  db.tx(() => {
    for (const l of c.lines) {
      if (l.counted == null) continue;
      // stock may have moved (sales) since the count started: apply the difference measured at count time
      const diff = qtyRound(l.counted - l.expected);
      if (!diff) continue;
      moveStock(db, cid, c.store_id, l.product_id, diff, { kind: 'count', ref_type: 'count', ref_id: id, userId: ctx.user.id, note: c.number });
      value += Math.round(diff * l.avg_cost);
    }
    db.run("UPDATE shop_counts SET status = 'closed', closed_at = ?, variance_value = ? WHERE id = ?", now(), value, id);
  });
  audit(db, ctx, 'close', 'count', id, { value });
  raiseAlert(db, bus, cid, { kind: 'count_closed', level: value < 0 ? 'warning' : 'info', title: `Inventaire ${c.number} clôturé`, body: `${c.store_name} : écart de valeur ${fcfa(value)}.`, entity: 'count', entity_id: id });
  bus.emit(cid, 'change', { entity: 'stock' });
  return { value };
}
