// Floor plan, reservations and waitlist, guest calls from the table QR, and
// reviews. The floor shows every table live: free, reserved soon, seated,
// food ready, bill asked, with the check total and time at the table.
import { bad, notFound, conflict } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { raiseAlert, audit } from '../../core/alerts.js';
import { nextNumber } from '../accounting/ledger.js';
import { settingsOf, token, openOrder, customerByPhone } from './orders.js';

// ---------------- Areas and tables ----------------
export function saveArea(db, companyId, b, id = null) {
  const name = str(b.name, 60); if (!name) throw bad('name', 'Le nom est obligatoire');
  if (id) {
    if (!db.get('SELECT 1 FROM resto_areas WHERE id = ? AND company_id = ?', id, companyId)) throw notFound();
    db.run('UPDATE resto_areas SET name = ?, position = ?, active = ? WHERE id = ?', name, int(b.position, 'position', { def: 0 }), b.active === undefined ? 1 : (b.active ? 1 : 0), id);
  } else id = Number(db.run('INSERT INTO resto_areas (company_id, name, position) VALUES (?,?,?)', companyId, name, int(b.position, 'position', { def: 0 })).lastInsertRowid);
  return db.get('SELECT * FROM resto_areas WHERE id = ?', id);
}

export function saveTable(db, companyId, b, id = null) {
  const cur = id ? db.get('SELECT * FROM resto_tables WHERE id = ? AND company_id = ?', id, companyId) : null;
  if (id && !cur) throw notFound('Table introuvable');
  const area = b.area_id ?? cur?.area_id;
  if (!db.get('SELECT 1 FROM resto_areas WHERE id = ? AND company_id = ?', area, companyId)) throw bad('area', 'Salle inconnue');
  const v = { area_id: area, label: str(b.label ?? cur?.label, 12), seats: int(b.seats ?? cur?.seats, 'seats', { min: 1, def: 4 }), shape: oneOf(b.shape ?? cur?.shape, ['square', 'round', 'rect', 'booth'], 'shape', 'square'),
    x: Math.max(0, Math.min(100, num(b.x ?? cur?.x, 'x', { def: 0 }))), y: Math.max(0, Math.min(100, num(b.y ?? cur?.y, 'y', { def: 0 }))), active: b.active === undefined ? (cur?.active ?? 1) : (b.active ? 1 : 0) };
  if (!v.label) throw bad('label', 'Numéro de table obligatoire');
  if (cur) {
    db.run(`UPDATE resto_tables SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(v), cur.id);
    if (b.new_qr) db.run('UPDATE resto_tables SET qr_token = ? WHERE id = ?', token(), cur.id);
  } else {
    if (db.get('SELECT 1 FROM resto_tables WHERE company_id = ? AND label = ?', companyId, v.label)) throw conflict('exists', `La table ${v.label} existe déjà`);
    id = Number(db.run(`INSERT INTO resto_tables (company_id, ${Object.keys(v).join(', ')}, qr_token) VALUES (?, ${Object.keys(v).map(() => '?').join(', ')}, ?)`, companyId, ...Object.values(v), token()).lastInsertRowid);
  }
  return db.get('SELECT * FROM resto_tables WHERE id = ?', id);
}

/** Live floor: tables with their open check, upcoming reservation and open calls. */
export function floor(db, companyId) {
  const s = settingsOf(db, companyId);
  const tables = db.all('SELECT t.*, a.name area_name FROM resto_tables t JOIN resto_areas a ON a.id = t.area_id WHERE t.company_id = ? AND t.active = 1 AND a.active = 1 ORDER BY a.position, t.label', companyId);
  const orders = db.all(`SELECT o.id, o.number, o.table_id, o.covers, o.total, o.paid, o.opened_at, o.bill_printed, o.server_id, u.name server_name, o.customer_id, p.name customer_name, rc.vip,
      (SELECT COUNT(*) FROM resto_lines l WHERE l.order_id = o.id AND l.status = 'ready') ready,
      (SELECT COUNT(*) FROM resto_lines l WHERE l.order_id = o.id AND l.status IN ('sent','preparing')) cooking,
      (SELECT COUNT(*) FROM resto_lines l WHERE l.order_id = o.id AND l.status = 'held') held,
      (SELECT COUNT(*) FROM resto_lines l WHERE l.order_id = o.id AND l.status = 'pending') pending,
      (SELECT COUNT(*) FROM resto_lines l WHERE l.order_id = o.id AND l.status = 'pending' AND l.source = 'qr') qr_pending,
      (SELECT MIN(sent_at) FROM resto_lines l WHERE l.order_id = o.id AND l.status IN ('sent','preparing')) oldest
    FROM resto_orders o LEFT JOIN users u ON u.id = o.server_id LEFT JOIN partners p ON p.id = o.customer_id LEFT JOIN resto_customers rc ON rc.partner_id = o.customer_id
    WHERE o.company_id = ? AND o.status = 'open' AND o.table_id IS NOT NULL`, companyId);
  const nowMin = minutesOf(new Date());
  const res = db.all("SELECT * FROM resto_reservations WHERE company_id = ? AND date = ? AND status IN ('booked','confirmed','arrived') AND table_id IS NOT NULL ORDER BY time", companyId, today());
  const calls = db.all("SELECT * FROM resto_calls WHERE company_id = ? AND status = 'open' ORDER BY id", companyId);
  const out = tables.map((t) => {
    const o = orders.filter((x) => x.table_id === t.id);
    const next = res.find((r) => r.table_id === t.id && minutesOf(r.time) + 30 >= nowMin);
    const c = calls.filter((x) => x.table_id === t.id);
    let state = 'free';
    if (o.length) state = c.some((x) => x.kind === 'bill') || o.some((x) => x.bill_printed) ? 'bill' : o.some((x) => x.ready) ? 'ready' : o.some((x) => x.qr_pending) ? 'qr' : 'seated';
    else if (next && minutesOf(next.time) - nowMin <= 60) state = 'reserved';
    return { ...t, state, orders: o, next_reservation: next || null, calls: c };
  });
  const areas = db.all('SELECT * FROM resto_areas WHERE company_id = ? AND active = 1 ORDER BY position, name', companyId);
  const other = db.all(`SELECT o.id, o.number, o.kind, o.source, o.guest_name, o.phone, o.total, o.paid, o.opened_at, o.delivery_status, o.pickup_time, o.courier,
      (SELECT COUNT(*) FROM resto_lines l WHERE l.order_id = o.id AND l.status = 'ready') ready, (SELECT COUNT(*) FROM resto_lines l WHERE l.order_id = o.id AND l.status IN ('sent','preparing','pending','held')) cooking
    FROM resto_orders o WHERE o.company_id = ? AND o.status = 'open' AND o.table_id IS NULL ORDER BY o.id`, companyId);
  const deliveries = db.all(`SELECT o.id, o.number, o.guest_name, o.phone, o.address, o.total, o.delivery_status, o.courier, o.opened_at FROM resto_orders o
    WHERE o.company_id = ? AND o.kind = 'delivery' AND o.status = 'paid' AND o.delivery_status NOT IN ('delivered','') AND o.opened_at >= datetime('now','-1 day')`, companyId);
  return { areas, tables: out, counter: other, deliveries, calls: calls.filter((c) => !c.table_id || !tables.some((t) => t.id === c.table_id)), all_calls: calls, prep_target: s.prep_target_min };
}

// Minutes since midnight, Douala time.
export function minutesOf(v) {
  if (typeof v === 'string') { const [h, m] = v.split(':').map(Number); return h * 60 + m; }
  const d = new Date(v.getTime() + 3600e3);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// ---------------- Reservations and waitlist ----------------
const resSql = 'SELECT r.*, t.label table_label, rc.vip, rc.visits, rc.allergies FROM resto_reservations r LEFT JOIN resto_tables t ON t.id = r.table_id LEFT JOIN resto_customers rc ON rc.partner_id = r.customer_id';

export function listReservations(db, companyId, q = {}) {
  const where = ['r.company_id = ?']; const a = [companyId];
  if (q.date) { where.push('r.date = ?'); a.push(q.date); }
  if (q.from) { where.push('r.date >= ?'); a.push(q.from); }
  if (q.status) { const st = String(q.status).split(','); where.push(`r.status IN (${st.map(() => '?').join(',')})`); a.push(...st); }
  return db.all(`${resSql} WHERE ${where.join(' AND ')} ORDER BY r.date, r.time, r.id LIMIT 500`, ...a);
}

/** Tables free for a time slot (no other reservation overlapping, enough seats). */
export function freeTables(db, companyId, date, time, covers, exceptId = 0) {
  const s = settingsOf(db, companyId);
  const start = minutesOf(time), dur = s.reservation_minutes;
  const taken = new Set(db.all("SELECT table_id, time FROM resto_reservations WHERE company_id = ? AND date = ? AND status IN ('booked','confirmed','arrived','seated') AND table_id IS NOT NULL AND id <> ?", companyId, date, exceptId)
    .filter((r) => Math.abs(minutesOf(r.time) - start) < dur).map((r) => r.table_id));
  return db.all('SELECT t.*, a.name area_name FROM resto_tables t JOIN resto_areas a ON a.id = t.area_id WHERE t.company_id = ? AND t.active = 1 AND t.seats >= ? ORDER BY t.seats, a.position, t.label', companyId, covers)
    .filter((t) => !taken.has(t.id));
}

export function createReservation(db, bus, ctx, companyId, b, { source = 'staff' } = {}) {
  const status = b.waitlist ? 'waiting' : 'booked';
  const date = status === 'waiting' ? today() : vDate(b.date, 'date');
  const time = status === 'waiting' ? new Date(Date.now() + 3600e3).toISOString().slice(11, 16) : str(b.time, 5);
  if (!/^\d{2}:\d{2}$/.test(time)) throw bad('time', 'Heure invalide (HH:MM)');
  if (status !== 'waiting' && date < today()) throw bad('date', 'Date passée');
  const covers = int(b.covers, 'covers', { min: 1, def: 2 });
  if (covers > 60) throw bad('covers', 'Pour plus de 60 couverts, contactez-nous (privatisation)');
  const name = str(b.name, 100); if (!name) throw bad('name', 'Le nom est obligatoire');
  const s = settingsOf(db, companyId);
  if (source !== 'staff') {
    if (!s.online_reservations) throw bad('closed', 'Réservation en ligne fermée');
    if (time < s.open_time || time > s.close_time) throw bad('time', `Nous servons de ${s.open_time} à ${s.close_time}`);
    if (!str(b.phone)) throw bad('phone', 'Le téléphone est obligatoire');
  }
  let tableId = b.table_id || null;
  if (tableId) {
    if (!freeTables(db, companyId, date, time, 1).some((t) => t.id === Number(tableId))) throw conflict('table_taken', 'Cette table est déjà réservée sur ce créneau');
  } else if (status !== 'waiting') {
    const free = freeTables(db, companyId, date, time, covers);
    if (!free.length && source !== 'staff') throw conflict('full', 'Complet sur ce créneau. Essayez une autre heure.');
    tableId = free[0]?.id ?? null;
  }
  const customer = b.phone ? customerByPhone(db, companyId, name, b.phone) : null;
  const r = db.run(`INSERT INTO resto_reservations (company_id, number, customer_id, name, phone, email, date, time, covers, table_id, status, source, occasion, note, deposit, token, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, companyId, nextNumber(db, companyId, `RS-${date.slice(0, 4)}`), customer, name, str(b.phone, 30), str(b.email, 120), date, time, covers, tableId,
  status, source === 'staff' ? oneOf(b.source, ['phone', 'whatsapp', 'walk_in', 'web', 'event', 'other'], 'source', status === 'waiting' ? 'walk_in' : 'phone') : 'web', str(b.occasion, 60), str(b.note, 500),
  int(b.deposit, 'deposit', { min: 0, def: 0 }), token(), now());
  const id = Number(r.lastInsertRowid);
  if (source !== 'staff') raiseAlert(db, bus, companyId, { kind: 'resto_booking', level: 'info', title: `Réservation en ligne : ${name}, ${covers} pers.`, body: `${date.split('-').reverse().join('/')} à ${time}${b.occasion ? ` · ${b.occasion}` : ''}`, entity: 'reservation', entity_id: id });
  else audit(db, ctx, 'create', 'reservation', id, { date, time, covers });
  bus.emit(companyId, 'change', { entity: 'reservation', id });
  return db.get(`${resSql} WHERE r.id = ?`, id);
}

export function updateReservation(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const r = db.get('SELECT * FROM resto_reservations WHERE id = ? AND company_id = ?', id, cid);
  if (!r) throw notFound('Réservation introuvable');
  return db.tx(() => {
    const date = b.date ? vDate(b.date, 'date') : r.date, time = b.time ? str(b.time, 5) : r.time;
    const tableId = b.table_id === undefined ? r.table_id : (b.table_id || null);
    if (tableId && (tableId !== r.table_id || date !== r.date || time !== r.time) && !freeTables(db, cid, date, time, 1, id).some((t) => t.id === Number(tableId))) throw conflict('table_taken', 'Table déjà réservée sur ce créneau');
    db.run('UPDATE resto_reservations SET name = ?, phone = ?, date = ?, time = ?, covers = ?, table_id = ?, occasion = ?, note = ? WHERE id = ?', str(b.name ?? r.name, 100), str(b.phone ?? r.phone, 30), date, time,
      int(b.covers ?? r.covers, 'covers', { min: 1 }), tableId, str(b.occasion ?? r.occasion, 60), str(b.note ?? r.note, 500), id);
    if (b.status && b.status !== r.status) {
      const st = oneOf(b.status, ['waiting', 'booked', 'confirmed', 'arrived', 'seated', 'done', 'no_show', 'cancelled'], 'status');
      if (st === 'seated') {
        const t = tableId || b.table_id;
        if (!t) throw bad('table', 'Choisissez la table');
        const o = openOrder(db, bus, ctx, company, { kind: 'dine_in', table_id: t, covers: r.covers, customer_id: r.customer_id, reservation_id: r.id, guest_name: r.name });
        db.run("UPDATE resto_reservations SET status = 'seated', table_id = ?, seated_at = ?, order_id = ? WHERE id = ?", t, now(), o.id, id);
      } else db.run('UPDATE resto_reservations SET status = ? WHERE id = ?', st, id);
      audit(db, ctx, `reservation_${st}`, 'reservation', id);
    }
    bus.emit(cid, 'change', { entity: 'reservation', id });
    return db.get(`${resSql} WHERE r.id = ?`, id);
  });
}

/** Marks reservations 30 minutes late as no-shows. */
export function markNoShows(db, bus) {
  const nowMin = minutesOf(new Date());
  for (const r of db.all("SELECT * FROM resto_reservations WHERE date = ? AND status IN ('booked','confirmed')", today())) {
    if (nowMin - minutesOf(r.time) > 30) {
      db.run("UPDATE resto_reservations SET status = 'no_show' WHERE id = ?", r.id);
      bus?.emit(r.company_id, 'change', { entity: 'reservation', id: r.id });
    }
  }
  for (const r of db.all("SELECT * FROM resto_reservations WHERE date < ? AND status IN ('booked','confirmed','waiting','arrived')", today())) db.run("UPDATE resto_reservations SET status = CASE WHEN status = 'waiting' THEN 'cancelled' ELSE 'no_show' END WHERE id = ?", r.id);
}

// ---------------- Calls and reviews ----------------
export const CALL_KINDS = { waiter: { fr: 'Appel serveur', en: 'Call waiter' }, bill: { fr: 'Demande l\'addition', en: 'Asks for the bill' }, water: { fr: 'Eau / pain', en: 'Water / bread' }, other: { fr: 'Autre demande', en: 'Other request' } };

export function createCall(db, bus, companyId, { table_id, order_id, kind, note }) {
  const k = oneOf(kind, Object.keys(CALL_KINDS), 'kind');
  const dup = db.get("SELECT id FROM resto_calls WHERE company_id = ? AND table_id IS ? AND kind = ? AND status = 'open'", companyId, table_id ?? null, k);
  if (dup) return dup.id;
  const r = db.run('INSERT INTO resto_calls (company_id, table_id, order_id, kind, note, at) VALUES (?,?,?,?,?,?)', companyId, table_id ?? null, order_id ?? null, k, str(note, 200), now());
  const t = table_id ? db.get('SELECT label FROM resto_tables WHERE id = ?', table_id) : null;
  bus.emit(companyId, 'call', { id: Number(r.lastInsertRowid), table: t?.label || '', kind: k, title: `Table ${t?.label || ''} : ${CALL_KINDS[k].fr}` });
  bus.emit(companyId, 'change', { entity: 'resto_call' });
  return Number(r.lastInsertRowid);
}

export function closeCall(db, bus, ctx, id) {
  db.run("UPDATE resto_calls SET status = 'done', done_by = ?, done_at = ? WHERE id = ? AND company_id = ?", ctx.user.id, now(), id, ctx.user.company_id);
  bus.emit(ctx.user.company_id, 'change', { entity: 'resto_call' });
  return { ok: true };
}

export function addFeedback(db, bus, companyId, orderId, b) {
  const rating = int(b.rating, 'rating', { min: 1 });
  if (rating > 5) throw bad('rating', 'Note de 1 à 5');
  if (orderId && db.get('SELECT 1 FROM resto_feedback WHERE order_id = ?', orderId)) throw conflict('done', 'Merci, votre avis est déjà enregistré');
  const n = (v) => (v == null || v === '' ? null : Math.min(5, int(v, 'note', { min: 1 })));
  db.run('INSERT INTO resto_feedback (company_id, order_id, rating, food, service, ambiance, comment, at) VALUES (?,?,?,?,?,?,?,?)', companyId, orderId, rating, n(b.food), n(b.service), n(b.ambiance), str(b.comment, 1000), now());
  if (rating <= 2) raiseAlert(db, bus, companyId, { kind: 'resto_feedback', level: 'danger', title: `Avis ${rating}/5 d'un client`, body: str(b.comment, 300) || 'Sans commentaire. Rappelez le client si possible.', entity: 'resto_order', entity_id: orderId });
  return { ok: true };
}
