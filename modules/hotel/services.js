// Outlets and services: restaurant, bar, room service, minibar, laundry, spa,
// transfers. Orders go to the kitchen/bar screen, then are charged to the room
// (folio) or paid on the spot (Compta invoice to "Clients de passage" + payment).
// Also spa appointments, guest requests, housekeeping, maintenance, lost & found.
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, num, oneOf } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { audit, raiseAlert } from '../../core/alerts.js';
import { can } from '../../core/roles.js';
import { fcfa } from '../../core/format.js';
import { nextNumber } from '../accounting/ledger.js';
import * as docs from '../accounting/documents.js';
import * as tr from '../accounting/treasury.js';
import { solveNet } from '../../public/js/shop-pricing.js';
import { businessDate, split } from './rates.js';
import { getBooking, chargeLine, PAY, invoiceFromTtc, sys } from './front.js';
import { stayForCard } from './keys.js';

// ---------------- Catalogue ----------------
export function listItems(db, companyId, q = {}) {
  const where = ['i.company_id = ?']; const a = [companyId];
  if (!q.all) where.push('p.active = 1');
  if (q.outlet_id) { where.push('i.outlet_id = ?'); a.push(q.outlet_id); }
  if (q.portal) where.push('i.portal = 1');
  return db.all(`SELECT p.id, p.name, p.description, p.vat_rate, p.active, i.price, i.category, i.duration, i.portal, i.image, i.position, i.outlet_id, o.name outlet_name, o.kind outlet_kind
    FROM hotel_items i JOIN products p ON p.id = i.product_id JOIN hotel_outlets o ON o.id = i.outlet_id WHERE ${where.join(' AND ')} ORDER BY o.id, i.category, i.position, p.name`, ...a);
}

export function saveItem(db, company, b, id = null) {
  const outlet = db.get('SELECT * FROM hotel_outlets WHERE id = ? AND company_id = ?', b.outlet_id, company.id);
  const cur = id ? db.get('SELECT p.*, i.* FROM products p JOIN hotel_items i ON i.product_id = p.id WHERE p.id = ? AND p.company_id = ?', id, company.id) : null;
  if (id && !cur) throw notFound('Article introuvable');
  if (!outlet && !cur) throw bad('outlet', 'Point de vente inconnu');
  const o = outlet || db.get('SELECT * FROM hotel_outlets WHERE id = ?', cur.outlet_id);
  const name = str(b.name ?? cur?.name, 200); if (!name) throw bad('name', 'Le nom est obligatoire');
  const price = int(b.price ?? cur?.price, 'price', { min: 0 });
  const vat = b.vat_rate === '' || (b.vat_rate === undefined && cur?.vat_rate == null) ? null : num(b.vat_rate ?? cur?.vat_rate, 'vat_rate', { min: 0 });
  const ht = solveNet(price, vat ?? (company.vat_enabled ? company.vat_rate : 0));
  const flag = (k, d) => (b[k] === undefined ? (cur ? cur[k] : d) : (b[k] && b[k] !== '0' ? 1 : 0));
  return db.tx(() => {
    let pid = id;
    if (!cur) pid = Number(db.run("INSERT INTO products (company_id, kind, name, description, unit, price, vat_rate, sales_account, created_at) VALUES (?, 'service', ?, ?, 'u', ?, ?, ?, ?)",
      company.id, name, str(b.description, 1000), ht, vat, o.account_code, now()).lastInsertRowid);
    else db.run('UPDATE products SET name = ?, description = ?, price = ?, vat_rate = ?, sales_account = ?, active = ? WHERE id = ?', name, str(b.description ?? cur.description, 1000), ht, vat, o.account_code,
      b.active === undefined ? cur.active : (b.active ? 1 : 0), pid);
    db.run(`INSERT INTO hotel_items (product_id, company_id, outlet_id, category, price, duration, portal, image, position) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET outlet_id = excluded.outlet_id, category = excluded.category, price = excluded.price, duration = excluded.duration, portal = excluded.portal, image = excluded.image, position = excluded.position`,
    pid, company.id, o.id, str(b.category ?? cur?.category, 60), price, int(b.duration ?? cur?.duration, 'duration', { min: 0, def: 0 }), flag('portal', 1), str(b.image ?? cur?.image, 500), int(b.position ?? cur?.position, 'position', { def: 0 }));
    return listItems(db, company.id, { all: 1 }).find((x) => x.id === pid);
  });
}

// ---------------- Orders ----------------
export function getOrder(db, companyId, id) {
  const o = db.get(`SELECT o.*, h.name outlet_name, h.kind outlet_kind, r.number room_number, b.number booking_number, g.name guest_name FROM hotel_orders o JOIN hotel_outlets h ON h.id = o.outlet_id
    LEFT JOIN hotel_rooms r ON r.id = o.room_id LEFT JOIN hotel_bookings b ON b.id = o.booking_id LEFT JOIN partners g ON g.id = b.guest_id WHERE o.id = ? AND o.company_id = ?`, id, companyId);
  if (!o) throw notFound('Commande introuvable');
  o.lines = db.all('SELECT * FROM hotel_order_lines WHERE order_id = ? ORDER BY id', id);
  return o;
}
export function listOrders(db, companyId, q = {}) {
  const where = ['o.company_id = ?']; const a = [companyId];
  if (q.status) { where.push(`o.status IN (${q.status.split(',').map(() => '?').join(',')})`); a.push(...q.status.split(',')); }
  if (q.outlet_id) { where.push('o.outlet_id = ?'); a.push(q.outlet_id); }
  if (q.kitchen) where.push('h.kitchen = 1');
  if (q.date) { where.push('substr(o.created_at,1,10) = ?'); a.push(q.date); }
  if (q.booking_id) { where.push('o.booking_id = ?'); a.push(q.booking_id); }
  const rows = db.all(`SELECT o.*, h.name outlet_name, h.kind outlet_kind, r.number room_number, g.name guest_name FROM hotel_orders o JOIN hotel_outlets h ON h.id = o.outlet_id LEFT JOIN hotel_rooms r ON r.id = o.room_id
    LEFT JOIN hotel_bookings b ON b.id = o.booking_id LEFT JOIN partners g ON g.id = b.guest_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, ...a);
  for (const r of rows) r.lines = db.all('SELECT name, qty, note FROM hotel_order_lines WHERE order_id = ?', r.id);
  return rows;
}

/** Finds the in-house stay for a room number, a booking id or a key card tapped on the reader. */
export function resolveStay(db, companyId, b) {
  let bookingId = b.booking_id ? Number(b.booking_id) : null;
  if (!bookingId && b.card_uid) bookingId = stayForCard(db, companyId, b.card_uid).booking_id;
  if (!bookingId && b.room_id) bookingId = db.get("SELECT id FROM hotel_bookings WHERE company_id = ? AND room_id = ? AND status = 'in_house' ORDER BY id DESC LIMIT 1", companyId, b.room_id)?.id;
  if (!bookingId && b.room) bookingId = db.get("SELECT b.id FROM hotel_bookings b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.company_id = ? AND r.number = ? AND b.status = 'in_house' ORDER BY b.id DESC LIMIT 1", companyId, String(b.room))?.id;
  if (!bookingId) return null;
  const bk = getBooking(db, companyId, bookingId);
  if (bk.status !== 'in_house') throw conflict('state', 'Ce client n\'est plus à l\'hôtel');
  return bk;
}

export function createOrder(db, bus, ctx, company, b, { origin = 'staff' } = {}) {
  const cid = company.id;
  const outlet = db.get('SELECT * FROM hotel_outlets WHERE id = ? AND company_id = ? AND active = 1', b.outlet_id, cid);
  if (!outlet) throw bad('outlet', 'Point de vente inconnu');
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad('lines', 'Ajoutez au moins un article');
  const stay = resolveStay(db, cid, b);
  if (b.settle === 'room' && !stay) throw bad('room', 'Indiquez la chambre ou passez la carte du client');
  const lines = b.lines.map((l) => {
    const it = db.get('SELECT p.id, p.name, i.price, i.portal FROM products p JOIN hotel_items i ON i.product_id = p.id WHERE p.id = ? AND p.company_id = ? AND p.active = 1', l.product_id, cid);
    if (!it) throw bad('product', 'Article introuvable');
    if (origin === 'guest' && !it.portal) throw forbidden('Article non disponible en chambre');
    const qty = num(l.qty, 'qty', { min: 0.01, def: 1 });
    if (qty > 99) throw bad('qty', 'Quantité trop grande');
    return { ...it, qty, note: str(l.note, 200) };
  });
  const total = lines.reduce((t, l) => t + Math.round(l.qty * l.price), 0);
  return db.tx(() => {
    const number = nextNumber(db, cid, `CMD-${today().slice(0, 4)}`, 5);
    const status = outlet.kitchen ? 'new' : 'delivered';
    const r = db.run(`INSERT INTO hotel_orders (company_id, number, outlet_id, booking_id, room_id, table_label, covers, origin, status, total, note, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cid, number, outlet.id, stay?.id ?? null, stay?.room_id ?? null, str(b.table_label, 30), int(b.covers, 'covers', { min: 0, def: 0 }), origin, status, total, str(b.note, 500), ctx.user?.id ?? null, now(), now());
    const id = Number(r.lastInsertRowid);
    for (const l of lines) db.run('INSERT INTO hotel_order_lines (order_id, product_id, name, qty, price, note) VALUES (?,?,?,?,?,?)', id, l.id, l.name, l.qty, l.price, l.note);
    if (b.settle) settleOrder(db, bus, ctx, company, id, b);
    if (origin === 'guest') raiseAlert(db, bus, cid, { kind: 'guest_order', level: 'info', title: `Commande chambre ${stay?.room_number || ''} : ${fcfa(total)}`, body: lines.map((l) => `${l.qty} × ${l.name}`).join(', '), entity: 'order', entity_id: id });
    bus.emit(cid, 'change', { entity: 'order', id });
    return getOrder(db, cid, id);
  });
}

export function setOrderStatus(db, bus, ctx, company, id, status) {
  const o = getOrder(db, company.id, id);
  oneOf(status, ['new', 'preparing', 'ready', 'delivered', 'cancelled'], 'status');
  if (['settled', 'cancelled'].includes(o.status)) throw conflict('closed', 'Commande clôturée');
  if (status === 'cancelled' && o.origin === 'staff' && !['owner', 'admin', 'manager'].includes(ctx.user.role) && o.status !== 'new') throw forbidden('Seul un responsable peut annuler une commande en préparation');
  db.tx(() => {
    db.run('UPDATE hotel_orders SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
    // Room service and guest orders are charged to the room once delivered.
    if (status === 'delivered' && o.settlement) db.run("UPDATE hotel_orders SET status = 'settled' WHERE id = ?", id);
    else if (status === 'delivered' && o.booking_id && (o.origin === 'guest' || o.outlet_kind === 'room_service')) settleOrder(db, bus, ctx, company, id, { settle: 'room' });
  });
  audit(db, ctx, `order_${status}`, 'order', id);
  bus.emit(company.id, 'change', { entity: 'order', id });
  return getOrder(db, company.id, id);
}

/** Room: lines on the folio. Paid: a validated Compta invoice + payment, on "Clients de passage" or a named client. */
export function settleOrder(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const o = getOrder(db, cid, id);
  if (o.status === 'settled' || o.settlement) throw conflict('settled', 'Commande déjà réglée');
  if (o.status === 'cancelled') throw conflict('cancelled', 'Commande annulée');
  const mode = oneOf(b.settle, ['room', 'paid'], 'settle');
  return db.tx(() => {
    if (mode === 'room') {
      const stay = o.booking_id ? getBooking(db, cid, o.booking_id) : resolveStay(db, cid, b);
      if (!stay || stay.status !== 'in_house') throw bad('room', 'Chambre introuvable ou client parti');
      for (const l of o.lines) chargeLine(db, company, stay.id, { product_id: l.product_id, qty: l.qty, price: l.price }, ctx.user?.id ?? null, { order_id: o.id });
      db.run("UPDATE hotel_orders SET status = CASE WHEN status = 'delivered' THEN 'settled' ELSE status END, settlement = 'room', booking_id = ?, room_id = ?, updated_at = ? WHERE id = ?", stay.id, stay.room_id, now(), id);
      bus.emit(cid, 'change', { entity: 'folio', id: stay.id });
    } else {
      const way = oneOf(b.method, Object.keys(PAY), 'method', 'cash');
      const partner = b.partner_id ? db.get("SELECT id FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", b.partner_id, cid)
        : db.get("SELECT id FROM partners WHERE company_id = ? AND kind = 'client' AND name = 'Clients de passage'", cid);
      if (!partner) throw bad('partner', 'Client introuvable');
      const docId = invoiceFromTtc(db, ctx, company, { partner_id: partner.id, subject: `${o.outlet_name} – ${o.number}${o.table_label ? ' – table ' + o.table_label : ''}`,
        lines: o.lines.map((l) => {
          const it = db.get('SELECT p.vat_rate, p.sales_account FROM products p WHERE p.id = ?', l.product_id);
          const rate = it.vat_rate ?? (company.vat_enabled ? company.vat_rate : 0);
          return { product_id: l.product_id, description: l.qty !== 1 ? `${l.qty} × ${l.name}` : l.name, vat_rate: rate, account_code: it.sales_account || '7062', ...split(Math.round(l.qty * l.price), rate) };
        }) });
      const doc = db.get('SELECT total FROM documents WHERE id = ?', docId);
      tr.recordPayment(db, sys(ctx), company, { direction: 'in', document_id: docId, method: PAY[way].method, amount: doc.total, reference: `${way === 'card' ? 'Carte ' : ''}${str(b.reference, 60)}`.trim() });
      db.run("UPDATE hotel_orders SET status = CASE WHEN status = 'delivered' THEN 'settled' ELSE status END, settlement = 'paid', document_id = ?, total = ?, updated_at = ? WHERE id = ?", docId, doc.total, now(), id);
    }
    audit(db, ctx, 'order_settle', 'order', id, mode);
    bus.emit(cid, 'change', { entity: 'order', id });
    return getOrder(db, cid, id);
  });
}

// ---------------- Spa and activities ----------------
export function listAppointments(db, companyId, q = {}) {
  const day = q.date || businessDate(db, companyId);
  return db.all(`SELECT a.*, p.name service, i.price, r.number room_number FROM hotel_appointments a JOIN products p ON p.id = a.product_id JOIN hotel_items i ON i.product_id = p.id
    LEFT JOIN hotel_bookings b ON b.id = a.booking_id LEFT JOIN hotel_rooms r ON r.id = b.room_id WHERE a.company_id = ? AND substr(a.start_at,1,10) = ? ORDER BY a.start_at`, companyId, day);
}
export function createAppointment(db, bus, ctx, company, b, { origin = 'staff' } = {}) {
  const it = db.get('SELECT p.id, p.name, i.duration FROM products p JOIN hotel_items i ON i.product_id = p.id WHERE p.id = ? AND p.company_id = ?', b.product_id, company.id);
  if (!it) throw bad('product', 'Soin introuvable');
  const start = str(b.start_at, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) throw bad('start_at', 'Date et heure invalides');
  const stay = b.booking_id ? getBooking(db, company.id, b.booking_id) : resolveStay(db, company.id, b);
  const name = str(b.guest_name, 120) || stay?.guest_name;
  if (!name) throw bad('guest_name', 'Indiquez le nom du client');
  const staff = str(b.staff, 80);
  const dur = it.duration || 60;
  if (staff) {
    const end = new Date(Date.parse(start + ':00Z') + dur * 60e3).toISOString().slice(0, 16);
    const clash = db.get(`SELECT a.start_at FROM hotel_appointments a WHERE a.company_id = ? AND a.staff = ? AND a.status IN ('requested','booked') AND a.start_at < ?
      AND strftime('%Y-%m-%dT%H:%M', datetime(replace(a.start_at,'T',' '), '+' || a.duration || ' minutes')) > ?`, company.id, staff, end, start);
    if (clash) throw conflict('busy', `${staff} a déjà un soin à ${clash.start_at.slice(11)}`);
  }
  const r = db.run('INSERT INTO hotel_appointments (company_id, product_id, booking_id, guest_name, staff, start_at, duration, status, origin, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    company.id, it.id, stay?.id ?? null, name, staff, start, dur, origin === 'guest' ? 'requested' : 'booked', origin, str(b.note, 300), now());
  if (origin === 'guest') raiseAlert(db, bus, company.id, { kind: 'spa_request', level: 'info', title: `Demande spa ch. ${stay?.room_number || ''} : ${it.name}`, body: `Le ${start.replace('T', ' à ')}`, entity: 'appointment', entity_id: Number(r.lastInsertRowid) });
  bus.emit(company.id, 'change', { entity: 'appointment' });
  return db.get('SELECT * FROM hotel_appointments WHERE id = ?', r.lastInsertRowid);
}
export function updateAppointment(db, bus, ctx, company, id, b) {
  const a = db.get('SELECT * FROM hotel_appointments WHERE id = ? AND company_id = ?', id, company.id);
  if (!a) throw notFound('Rendez-vous introuvable');
  const status = oneOf(b.status ?? a.status, ['requested', 'booked', 'done', 'cancelled', 'no_show'], 'status');
  if (a.status === 'done' && status !== 'done') throw conflict('done', 'Soin déjà réalisé et facturé');
  return db.tx(() => {
    db.run('UPDATE hotel_appointments SET status = ?, staff = ?, start_at = ?, note = ? WHERE id = ?', status, str(b.staff ?? a.staff, 80), str(b.start_at ?? a.start_at, 16), str(b.note ?? a.note, 300), id);
    if (status === 'done' && a.status !== 'done') {
      const spa = db.get('SELECT outlet_id FROM hotel_items WHERE product_id = ?', a.product_id);
      const settle = a.booking_id && b.settle !== 'paid' ? 'room' : 'paid';
      const o = createOrder(db, bus, ctx, company, { outlet_id: spa.outlet_id, booking_id: settle === 'room' ? a.booking_id : undefined, lines: [{ product_id: a.product_id, qty: 1 }], settle, method: b.method, note: `Soin ${a.guest_name}` });
      db.run('UPDATE hotel_appointments SET order_id = ? WHERE id = ?', o.id, id);
    }
    bus.emit(company.id, 'change', { entity: 'appointment' });
    return db.get('SELECT * FROM hotel_appointments WHERE id = ?', id);
  });
}

// ---------------- Guest requests (concierge) ----------------
export const REQUEST_KINDS = {
  towels: 'Serviettes / linge', cleaning: 'Nettoyage de la chambre', amenities: 'Produits d\'accueil', wakeup: 'Réveil', taxi: 'Taxi / chauffeur', airport: 'Transfert aéroport',
  late_checkout: 'Départ tardif', maintenance: 'Problème technique', iron: 'Fer à repasser', baby_cot: 'Lit bébé', restaurant: 'Réservation restaurant', concierge: 'Conciergerie', other: 'Autre',
};
export function createRequest(db, bus, companyId, b, { origin = 'guest', bookingId = null, roomId = null, userId = null } = {}) {
  const kind = oneOf(b.kind, Object.keys(REQUEST_KINDS), 'kind', 'other');
  const r = db.run('INSERT INTO hotel_requests (company_id, booking_id, room_id, kind, detail, due_at, origin, created_at) VALUES (?,?,?,?,?,?,?,?)',
    companyId, bookingId, roomId, kind, str(b.detail, 500), str(b.due_at, 16), origin, now());
  const room = roomId ? db.get('SELECT number FROM hotel_rooms WHERE id = ?', roomId)?.number : '';
  raiseAlert(db, bus, companyId, { kind: 'guest_request', level: kind === 'maintenance' ? 'warning' : 'info', title: `${room ? `Chambre ${room} · ` : ''}${REQUEST_KINDS[kind]}`, body: str(b.detail, 200), entity: 'request', entity_id: Number(r.lastInsertRowid) });
  if (kind === 'maintenance' && roomId) db.run('INSERT INTO hotel_maintenance (company_id, room_id, title, priority, created_by, created_at) VALUES (?,?,?,?,?,?)', companyId, roomId, str(b.detail, 200) || 'Signalé par le client', 'high', userId, now());
  bus.emit(companyId, 'change', { entity: 'request' });
  return db.get('SELECT * FROM hotel_requests WHERE id = ?', r.lastInsertRowid);
}
export function listRequests(db, companyId, q = {}) {
  return db.all(`SELECT q.*, r.number room_number, g.name guest_name, u.name assigned_name FROM hotel_requests q LEFT JOIN hotel_rooms r ON r.id = q.room_id LEFT JOIN hotel_bookings b ON b.id = q.booking_id
    LEFT JOIN partners g ON g.id = b.guest_id LEFT JOIN users u ON u.id = q.assigned_to WHERE q.company_id = ? ${q.open ? "AND q.status IN ('open','in_progress')" : ''} ${q.booking_id ? 'AND q.booking_id = ' + Number(q.booking_id) : ''}
    ORDER BY CASE q.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, q.id DESC LIMIT 200`, companyId);
}

// ---------------- Housekeeping ----------------
export function roomBoard(db, companyId) {
  const bd = businessDate(db, companyId);
  const rooms = db.all(`SELECT r.*, t.name type_name, t.code type_code, u.name hk_user FROM hotel_rooms r JOIN hotel_room_types t ON t.id = r.type_id LEFT JOIN users u ON u.id = r.hk_user_id
    WHERE r.company_id = ? AND r.active = 1 ORDER BY r.floor, r.number`, companyId);
  const stays = db.all(`SELECT b.id, b.room_id, b.number, b.departure, b.arrival, b.adults, b.children, g.name guest_name, hg.vip FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id
    LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id WHERE b.company_id = ? AND b.status = 'in_house'`, companyId);
  const arriving = db.all(`SELECT b.id, b.room_id, b.number, g.name guest_name, b.eta, hg.vip FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id
    WHERE b.company_id = ? AND b.status IN ('confirmed','tentative') AND b.arrival = ? AND b.room_id IS NOT NULL`, companyId, bd);
  const seen = db.all("SELECT room_id, action, MAX(at) at FROM hotel_hk_log WHERE company_id = ? AND date = ? AND action IN ('occupied_seen','vacant_seen') GROUP BY room_id", companyId, bd);
  const maint = db.all("SELECT room_id, COUNT(*) n FROM hotel_maintenance WHERE company_id = ? AND status <> 'done' AND room_id IS NOT NULL GROUP BY room_id", companyId);
  for (const r of rooms) {
    r.stay = stays.find((s) => s.room_id === r.id) || null;
    r.arrival = arriving.find((s) => s.room_id === r.id) || null;
    r.occupancy = r.stay ? (r.stay.departure <= bd ? 'departure' : 'occupied') : 'vacant';
    r.seen = seen.find((s) => s.room_id === r.id)?.action || null;
    r.maintenance = maint.find((m) => m.room_id === r.id)?.n || 0;
    r.undeclared = r.seen === 'occupied_seen' && !r.stay;
  }
  return { business_date: bd, rooms };
}

export function setRoomStatus(db, bus, ctx, room, b) {
  const sets = []; const a = [];
  if (b.hk_status) { sets.push('hk_status = ?'); a.push(oneOf(b.hk_status, ['clean', 'dirty', 'inspected', 'cleaning'], 'hk_status')); }
  if (b.hk_user_id !== undefined) { sets.push('hk_user_id = ?'); a.push(b.hk_user_id || null); }
  if (b.dnd !== undefined) { sets.push('dnd = ?'); a.push(b.dnd ? 1 : 0); }
  if (b.out_of_order !== undefined) {
    if (!['owner', 'admin', 'manager'].includes(ctx.user.role) && !can(ctx.user, 'settings')) throw forbidden('Seul un responsable peut mettre une chambre hors service');
    const busy = db.get("SELECT number FROM hotel_bookings WHERE room_id = ? AND status = 'in_house'", room.id);
    if (b.out_of_order && busy) throw conflict('occupied', 'Chambre occupée : changez d\'abord le client de chambre');
    sets.push('out_of_order = ?', 'ooo_reason = ?'); a.push(b.out_of_order ? 1 : 0, str(b.ooo_reason, 200));
  }
  if (!sets.length && !b.seen) throw bad('nothing', 'Rien à changer');
  const bd = businessDate(db, ctx.user.company_id);
  db.tx(() => {
    if (sets.length) db.run(`UPDATE hotel_rooms SET ${sets.join(', ')} WHERE id = ?`, ...a, room.id);
    if (b.hk_status) db.run('INSERT INTO hotel_hk_log (company_id, room_id, user_id, action, detail, date, at) VALUES (?,?,?,?,?,?,?)', ctx.user.company_id, room.id, ctx.user.id, 'status', b.hk_status, bd, now());
    if (b.seen) {
      const action = oneOf(b.seen, ['occupied', 'vacant'], 'seen') + '_seen';
      db.run('INSERT INTO hotel_hk_log (company_id, room_id, user_id, action, date, at) VALUES (?,?,?,?,?,?)', ctx.user.company_id, room.id, ctx.user.id, action, bd, now());
      const stay = db.get("SELECT id FROM hotel_bookings WHERE room_id = ? AND status = 'in_house'", room.id);
      if (action === 'occupied_seen' && !stay) {
        raiseAlert(db, bus, ctx.user.company_id, { kind: 'undeclared', level: 'danger', title: `Chambre ${room.number} occupée sans client enregistré`, body: `Signalé par ${ctx.user.name} (gouvernante). Vérifiez s'il s'agit d'une nuitée non déclarée.`, entity: 'room', entity_id: room.id });
      }
    }
  });
  audit(db, ctx, 'room_status', 'room', room.id, b);
  bus.emit(ctx.user.company_id, 'change', { entity: 'room', id: room.id });
}

/** Minibar check by the housekeeper: the items go on the folio of the guest in the room. */
export function minibarCheck(db, bus, ctx, company, room, lines) {
  const stay = db.get("SELECT id FROM hotel_bookings WHERE company_id = ? AND room_id = ? AND status = 'in_house'", company.id, room.id);
  if (!stay) throw conflict('vacant', 'Aucun client dans cette chambre');
  const outlet = db.get("SELECT id FROM hotel_outlets WHERE company_id = ? AND kind = 'minibar' AND active = 1", company.id);
  if (!outlet) throw bad('outlet', 'Point de vente minibar absent');
  const o = createOrder(db, bus, ctx, company, { outlet_id: outlet.id, booking_id: stay.id, lines: lines.filter((l) => Number(l.qty) > 0), settle: 'room', note: `Contrôle minibar par ${ctx.user.name}` });
  db.run('INSERT INTO hotel_hk_log (company_id, room_id, user_id, action, detail, date, at) VALUES (?,?,?,?,?,?,?)', company.id, room.id, ctx.user.id, 'minibar', o.number, businessDate(db, company.id), now());
  return o;
}
