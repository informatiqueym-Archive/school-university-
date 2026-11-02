// Front desk: guests, bookings, groups, check-in, folio charges, payments
// (cash, card, MTN MoMo, Orange Money, foreign currency), room moves and
// check-out. The check-out turns the folio into a Teknons Compta invoice.
import crypto from 'node:crypto';
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate, addDays } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { audit, raiseAlert } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { hashPassword, verifyPassword } from '../../core/auth.js';
import { normalizePhone, PROVIDERS } from '../../core/payments/mobile-money.js';
import { DEFAULTS } from '../accounting/chart.js';
import { postEntry, nextNumber } from '../accounting/ledger.js';
import * as docs from '../accounting/documents.js';
import * as tr from '../accounting/treasury.js';
import { settingsOf, businessDate, nightRate, split, quoteStay, availability, roomFree, nightsBetween, touristTax, LIVE } from './rates.js';
import { revokeForBooking } from './keys.js';

export const token = () => crypto.randomBytes(18).toString('base64url');
// Internal calls into Teknons Compta run with full rights: the hotel route already checked the user's.
export const sys = (ctx) => ({ ...ctx, user: { ...ctx.user, role: 'owner' } });
export const SOURCES = {
  direct: 'Réception (direct)', phone: 'Téléphone', whatsapp: 'WhatsApp', web: 'Site web (réservation en ligne)', walk_in: 'Client sans réservation',
  booking: 'Booking.com', expedia: 'Expedia', airbnb: 'Airbnb', agency: 'Agence de voyage', corporate: 'Entreprise', other: 'Autre',
};
export const PAY = {
  cash: { method: 'cash', fr: 'Espèces', en: 'Cash' },
  card: { method: 'bank', fr: 'Carte bancaire (TPE)', en: 'Card (terminal)' },
  mtn_momo: { method: 'mtn_momo', fr: 'MTN MoMo', en: 'MTN MoMo' },
  orange_money: { method: 'orange_money', fr: 'Orange Money', en: 'Orange Money' },
  bank: { method: 'bank', fr: 'Virement bancaire', en: 'Bank transfer' },
  cheque: { method: 'cheque', fr: 'Chèque', en: 'Cheque' },
};

// ---------------- Manager code ----------------
export function setManagerPin(db, companyId, pin) {
  const p = String(pin || '');
  if (!/^\d{4,8}$/.test(p)) throw bad('pin', 'Le code responsable doit avoir 4 à 8 chiffres');
  db.run('UPDATE hotel_settings SET manager_pin_hash = ? WHERE company_id = ?', hashPassword(p), companyId);
}
export function checkManager(db, ctx, pin, what) {
  if (['owner', 'admin', 'manager'].includes(ctx.user.role)) return;
  const s = settingsOf(db, ctx.user.company_id);
  if (!s.manager_pin_hash) throw forbidden(`${what} : code responsable non configuré (Réglages hôtel).`);
  if (!pin || !verifyPassword(String(pin), s.manager_pin_hash)) throw forbidden(`${what} : code responsable incorrect`);
}

// ---------------- Guests ----------------
const GUEST_FIELDS = ['title', 'nationality', 'id_type', 'id_number', 'id_issued_at', 'id_issued_on', 'birth_date', 'birth_place', 'profession', 'home_address', 'preferences', 'allergies'];

export function getGuest(db, companyId, partnerId) {
  const p = db.get("SELECT * FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", partnerId, companyId);
  if (!p) throw notFound('Client introuvable');
  db.run('INSERT OR IGNORE INTO hotel_guests (partner_id, company_id) VALUES (?,?)', p.id, companyId);
  const g = db.get('SELECT * FROM hotel_guests WHERE partner_id = ?', p.id);
  const stats = db.get("SELECT COUNT(*) stays, COALESCE(SUM(julianday(departure) - julianday(arrival)),0) nights, MAX(departure) last_stay FROM hotel_bookings WHERE guest_id = ? AND status = 'checked_out'", p.id);
  return { ...p, ...g, partner_id: p.id, ...stats };
}

/** Creates or updates the guest's file (partner + police/ID details + preferences). */
export function saveGuest(db, ctx, b, existingId = null) {
  const cid = ctx.user.company_id;
  let id = existingId || b.guest_id || null;
  if (id) getGuest(db, cid, id);
  else {
    const name = str(b.name, 200);
    if (!name) throw bad('name', 'Le nom du client est obligatoire');
    const phone = str(b.phone, 40);
    const same = phone && db.get("SELECT id FROM partners WHERE company_id = ? AND kind = 'client' AND phone = ? AND name = ?", cid, phone, name);
    id = same?.id || Number(db.run("INSERT INTO partners (company_id, kind, name, phone, email, city, address, created_at) VALUES (?, 'client', ?, ?, ?, ?, ?, ?)",
      cid, name, phone, str(b.email, 200), str(b.city, 80), str(b.address, 300), now()).lastInsertRowid);
  }
  db.run('INSERT OR IGNORE INTO hotel_guests (partner_id, company_id) VALUES (?,?)', id, cid);
  if (existingId || b.guest_id) {
    const p = db.get('SELECT * FROM partners WHERE id = ?', id);
    db.run('UPDATE partners SET name = ?, phone = ?, email = ?, city = ? WHERE id = ?', str(b.name ?? p.name, 200) || p.name, str(b.phone ?? p.phone, 40), str(b.email ?? p.email, 200), str(b.city ?? p.city, 80), id);
  }
  const g = db.get('SELECT * FROM hotel_guests WHERE partner_id = ?', id);
  const v = Object.fromEntries(GUEST_FIELDS.map((k) => [k, str(b[k] ?? g[k], k === 'preferences' || k === 'allergies' ? 1000 : 200)]));
  for (const k of ['birth_date', 'id_issued_on']) if (v[k] && !/^\d{4}-\d{2}-\d{2}$/.test(v[k])) throw bad(k, 'Date invalide');
  const vip = b.vip === undefined ? g.vip : int(b.vip, 'vip', { min: 0 });
  db.run(`UPDATE hotel_guests SET ${GUEST_FIELDS.map((k) => `${k} = ?`).join(', ')}, vip = ? WHERE partner_id = ?`, ...GUEST_FIELDS.map((k) => v[k]), Math.min(2, vip), id);
  if (b.blacklisted !== undefined && ['owner', 'admin', 'manager'].includes(ctx.user.role)) {
    db.run('UPDATE hotel_guests SET blacklisted = ?, blacklist_reason = ? WHERE partner_id = ?', b.blacklisted ? 1 : 0, str(b.blacklist_reason, 300), id);
  }
  return getGuest(db, cid, id);
}

// ---------------- Bookings ----------------
const bookingSql = `SELECT b.*, g.name guest_name, g.phone guest_phone, g.email guest_email, bt.name bill_to_name, t.name type_name, t.code type_code,
    r.number room_number, r.hk_status, rp.name plan_name, rp.code plan_code, rp.breakfast, hg.vip, hg.blacklisted,
    COALESCE((SELECT SUM(amount) FROM hotel_folio_lines l WHERE l.booking_id = b.id AND l.voided = 0),0) charges,
    COALESCE((SELECT SUM(CASE WHEN fp.kind = 'refund' THEN -p.amount ELSE p.amount END) FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id WHERE fp.booking_id = b.id AND p.status = 'completed'),0) paid
  FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id JOIN partners bt ON bt.id = b.bill_to_id JOIN hotel_room_types t ON t.id = b.room_type_id
  LEFT JOIN hotel_rooms r ON r.id = b.room_id LEFT JOIN hotel_rate_plans rp ON rp.id = b.rate_plan_id LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id`;
const withBalance = (b) => (b ? { ...b, balance: b.charges - b.paid, nights: Math.max(0, (Date.parse(b.departure) - Date.parse(b.arrival)) / 864e5) } : b);

export function getBooking(db, companyId, id) {
  const b = withBalance(db.get(`${bookingSql} WHERE b.id = ? AND b.company_id = ?`, id, companyId));
  if (!b) throw notFound('Réservation introuvable');
  return b;
}
export function listBookings(db, companyId, q = {}) {
  const where = ['b.company_id = ?']; const a = [companyId];
  if (q.status) { where.push(`b.status IN (${q.status.split(',').map(() => '?').join(',')})`); a.push(...q.status.split(',')); }
  if (q.from) { where.push('b.departure >= ?'); a.push(q.from); }
  if (q.to) { where.push('b.arrival <= ?'); a.push(q.to); }
  if (q.arrival) { where.push('b.arrival = ?'); a.push(q.arrival); }
  if (q.departure) { where.push('b.departure = ?'); a.push(q.departure); }
  if (q.guest_id) { where.push('(b.guest_id = ? OR b.bill_to_id = ?)'); a.push(q.guest_id, q.guest_id); }
  if (q.group_id) { where.push('b.group_id = ?'); a.push(q.group_id); }
  if (q.q) { where.push('(g.name LIKE ? OR b.number LIKE ? OR g.phone LIKE ? OR r.number = ? OR b.group_name LIKE ? OR b.external_ref LIKE ?)'); a.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, q.q, `%${q.q}%`, `%${q.q}%`); }
  const order = q.order === 'arrival' ? 'b.arrival, g.name' : 'b.arrival DESC, b.id DESC';
  return db.all(`${bookingSql} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${Math.min(Number(q.limit) || 300, 2000)}`, ...a).map(withBalance);
}

function refs(db, companyId, b, cur = {}) {
  const type = db.get('SELECT * FROM hotel_room_types WHERE id = ? AND company_id = ? AND active = 1', b.room_type_id ?? cur.room_type_id, companyId);
  if (!type) throw bad('room_type', 'Type de chambre inconnu');
  const planId = b.rate_plan_id === undefined ? cur.rate_plan_id : b.rate_plan_id;
  const plan = planId ? db.get('SELECT * FROM hotel_rate_plans WHERE id = ? AND company_id = ?', planId, companyId) : null;
  if (planId && !plan) throw bad('rate_plan', 'Tarif inconnu');
  return { type, plan };
}

/**
 * New booking (or several rooms for a group).
 * body: { guest_id | name, phone…, bill_to_id, room_type_id, room_id, rate_plan_id, arrival, departure, kind, adults, children, rate, source, rooms, group_name, status, notes, … }
 */
export function createBooking(db, bus, ctx, company, b) {
  const cid = company.id;
  const s = settingsOf(db, cid);
  const bd = s.business_date;
  const kind = oneOf(b.kind, ['night', 'day_use'], 'kind', 'night');
  const arrival = vDate(b.arrival, 'arrival', bd);
  const departure = kind === 'day_use' ? arrival : vDate(b.departure, 'departure');
  if (arrival < bd && !b.import) throw bad('arrival', `L'arrivée ne peut pas être avant la date hôtelière (${bd})`);
  if (kind === 'night' && departure <= arrival) throw bad('departure', 'Le départ doit être après l\'arrivée');
  if (kind === 'night' && nightsBetween(arrival, departure).length > 365) throw bad('departure', 'Séjour trop long (365 nuits max)');
  const { type, plan } = refs(db, cid, b);
  if (plan?.min_nights > 1 && nightsBetween(arrival, departure).length < plan.min_nights) throw bad('min_nights', `Ce tarif demande au moins ${plan.min_nights} nuits`);
  const adults = int(b.adults, 'adults', { min: 1, def: 1 }), children = int(b.children, 'children', { min: 0, def: 0 });
  if (adults + children > type.capacity + 1) throw bad('capacity', `${type.name} : ${type.capacity} personnes maximum (+1 lit d'appoint)`);
  const rooms = int(b.rooms, 'rooms', { min: 1, def: 1 });
  if (rooms > 50) throw bad('rooms', '50 chambres maximum par groupe');
  if (kind === 'night' && !b.overbook) {
    const av = availability(db, cid, arrival, departure).find((x) => x.type.id === type.id);
    if (!av || av.free < rooms) throw conflict('full', `${type.name} : plus que ${Math.max(0, av?.free || 0)} chambre(s) libre(s) sur ces dates`);
  } else if (b.overbook) checkManager(db, ctx, b.manager_pin, 'Surréservation');
  const guest = b.guest_id ? getGuest(db, cid, b.guest_id) : saveGuest(db, ctx, b);
  if (guest.blacklisted && !b.manager_pin && !['owner', 'admin', 'manager'].includes(ctx.user.role)) throw forbidden(`Client sur liste noire : ${guest.blacklist_reason || 'voir la fiche client'}`);
  if (guest.blacklisted) checkManager(db, ctx, b.manager_pin, 'Client sur liste noire');
  const billTo = b.bill_to_id ? db.get("SELECT id FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", b.bill_to_id, cid) : { id: guest.partner_id };
  if (!billTo) throw bad('bill_to', 'Société à facturer introuvable');
  let rate = b.rate === '' || b.rate == null ? null : int(b.rate, 'rate', { min: 0 });
  if (rate != null && rate < Math.round(type.base_rate * 0.7)) checkManager(db, ctx, b.manager_pin, 'Tarif négocié à plus de 30 % de remise');
  if (rate == null && kind === 'day_use') rate = null;
  const roomId = b.room_id ? Number(b.room_id) : null;
  if (roomId) {
    const room = db.get('SELECT * FROM hotel_rooms WHERE id = ? AND company_id = ?', roomId, cid);
    if (!room || room.type_id !== type.id) throw bad('room', 'Chambre introuvable pour ce type');
    const clash = roomFree(db, cid, roomId, arrival, departure);
    if (clash) throw conflict('room_busy', `Chambre ${room.number} déjà prise (${clash.number}, ${clash.name})`);
  }
  const source = oneOf(b.source, Object.keys(SOURCES), 'source', 'direct');
  const status = oneOf(b.status, ['tentative', 'confirmed'], 'status', 'confirmed');
  return db.tx(() => {
    let groupId = null;
    const ids = [];
    for (let i = 0; i < rooms; i++) {
      const number = nextNumber(db, cid, `RES-${arrival.slice(0, 4)}`);
      const r = db.run(`INSERT INTO hotel_bookings (company_id, number, guest_id, bill_to_id, room_type_id, room_id, rate_plan_id, group_id, group_name, kind, arrival, departure, adults, children, rate,
          source, external_ref, status, eta, purpose, coming_from, going_to, vehicle, notes, special_requests, portal_token, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cid, number, guest.partner_id, billTo.id, type.id, i === 0 ? roomId : null, plan?.id ?? null, groupId, str(b.group_name, 120), kind, arrival, departure, adults, children, rate,
      source, str(b.external_ref, 120), status, str(b.eta, 10), str(b.purpose, 120), str(b.coming_from, 120), str(b.going_to, 120), str(b.vehicle, 40), str(b.notes, 2000), str(b.special_requests, 1000), token(), ctx.user.id, now());
      const id = Number(r.lastInsertRowid);
      if (rooms > 1 && !groupId) { groupId = id; db.run('UPDATE hotel_bookings SET group_id = ? WHERE id = ?', id, id); }
      ids.push(id);
    }
    audit(db, ctx, 'create', 'booking', ids[0], { rooms, arrival, departure, guest: guest.name });
    bus.emit(cid, 'change', { entity: 'booking', id: ids[0] });
    const g = guest.vip ? `VIP ${guest.vip === 2 ? 'VVIP ' : ''}` : '';
    if (guest.vip) raiseAlert(db, bus, cid, { kind: 'vip_booking', level: 'info', title: `Réservation ${g}: ${guest.name}`, body: `${type.name} du ${arrival} au ${departure}.`, entity: 'booking', entity_id: ids[0] });
    return { ids, booking: getBooking(db, cid, ids[0]) };
  });
}

export function updateBooking(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const cur = getBooking(db, cid, id);
  if (['checked_out', 'cancelled', 'no_show'].includes(cur.status)) throw conflict('closed', 'Cette réservation est clôturée');
  const bd = businessDate(db, cid);
  const arrival = cur.status === 'in_house' ? cur.arrival : vDate(b.arrival ?? cur.arrival, 'arrival');
  const departure = cur.kind === 'day_use' ? arrival : vDate(b.departure ?? cur.departure, 'departure');
  if (cur.kind === 'night' && departure <= arrival) throw bad('departure', 'Le départ doit être après l\'arrivée');
  if (cur.status === 'in_house' && departure < bd) throw bad('departure', 'Le départ ne peut pas être avant la date hôtelière');
  const { type, plan } = refs(db, cid, b, cur);
  if (cur.status === 'in_house' && type.id !== cur.room_type_id) throw bad('room_type', 'Utilisez « Changer de chambre » pour un client déjà installé');
  const changedDates = arrival !== cur.arrival || departure !== cur.departure || type.id !== cur.room_type_id;
  if (changedDates && cur.kind === 'night' && !b.overbook) {
    const av = availability(db, cid, arrival, departure, { exceptBooking: cur.id }).find((x) => x.type.id === type.id);
    if (!av || av.free < 1) throw conflict('full', `${type.name} complet sur ces dates`);
    if (cur.room_id) { const clash = roomFree(db, cid, cur.room_id, arrival, departure, cur.id); if (clash) throw conflict('room_busy', `La chambre ${cur.room_number} est réservée ensuite (${clash.number}, ${clash.name}). Changez de chambre.`); }
  }
  let rate = b.rate === undefined ? cur.rate : (b.rate === '' || b.rate == null ? null : int(b.rate, 'rate', { min: 0 }));
  if (rate != null && rate !== cur.rate && rate < Math.round(type.base_rate * 0.7)) checkManager(db, ctx, b.manager_pin, 'Tarif négocié à plus de 30 % de remise');
  const billTo = b.bill_to_id ? db.get("SELECT id FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", b.bill_to_id, cid) : { id: cur.bill_to_id };
  if (!billTo) throw bad('bill_to', 'Société à facturer introuvable');
  if (billTo.id !== cur.bill_to_id && cur.paid) throw conflict('bill_to', 'Des paiements sont déjà enregistrés au nom du payeur actuel : changez le payeur avant d\'encaisser.');
  const adults = int(b.adults ?? cur.adults, 'adults', { min: 1 });
  db.run(`UPDATE hotel_bookings SET arrival = ?, departure = ?, room_type_id = ?, rate_plan_id = ?, rate = ?, bill_to_id = ?, adults = ?, children = ?, room_id = ?, eta = ?, purpose = ?, coming_from = ?, going_to = ?,
      vehicle = ?, notes = ?, special_requests = ?, status = ?, group_name = ? WHERE id = ?`,
  arrival, departure, type.id, plan?.id ?? null, rate, billTo.id, adults, int(b.children ?? cur.children, 'children', { min: 0 }), type.id !== cur.room_type_id ? null : cur.room_id,
  str(b.eta ?? cur.eta, 10), str(b.purpose ?? cur.purpose, 120), str(b.coming_from ?? cur.coming_from, 120), str(b.going_to ?? cur.going_to, 120), str(b.vehicle ?? cur.vehicle, 40),
  str(b.notes ?? cur.notes, 2000), str(b.special_requests ?? cur.special_requests, 1000),
  cur.status === 'in_house' ? 'in_house' : oneOf(b.status ?? cur.status, ['tentative', 'confirmed'], 'status'), str(b.group_name ?? cur.group_name, 120), id);
  if (cur.status === 'in_house' && departure !== cur.departure) {
    db.run("UPDATE hotel_keys SET valid_to = ? WHERE booking_id = ? AND status = 'active'", `${departure}T${settingsOf(db, cid).checkout_time}`, id);
  }
  audit(db, ctx, 'update', 'booking', id, changedDates ? { arrival, departure } : undefined);
  bus.emit(cid, 'change', { entity: 'booking', id });
  return getBooking(db, cid, id);
}

export function cancelBooking(db, bus, ctx, id, b, status = 'cancelled') {
  const cid = ctx.user.company_id;
  const cur = getBooking(db, cid, id);
  if (!['tentative', 'confirmed'].includes(cur.status)) throw conflict('state', 'Seule une réservation non arrivée peut être annulée');
  db.run('UPDATE hotel_bookings SET status = ?, cancel_reason = ?, room_id = NULL WHERE id = ?', status, str(b.reason, 300), id);
  audit(db, ctx, status, 'booking', id, b.reason);
  bus.emit(cid, 'change', { entity: 'booking', id });
  return getBooking(db, cid, id);
}

/** Picks a free, clean room of the right type (inspected first). */
export function suggestRoom(db, companyId, booking) {
  const rooms = db.all("SELECT * FROM hotel_rooms WHERE company_id = ? AND type_id = ? AND active = 1 AND out_of_order = 0 ORDER BY CASE hk_status WHEN 'inspected' THEN 0 WHEN 'clean' THEN 1 ELSE 2 END, number", companyId, booking.room_type_id);
  return rooms.find((r) => !roomFree(db, companyId, r.id, booking.arrival, booking.departure, booking.id)) || null;
}

// ---------------- Folio ----------------
function addLine(db, { companyId, bookingId, date, kind, outlet = 'reception', night = null, product_id = null, order_id = null, description, qty = 1, unit_price, vat_rate, account_code, userId }) {
  const amount = Math.round(qty * unit_price);
  const sp = split(amount, vat_rate);
  const r = db.run(`INSERT INTO hotel_folio_lines (company_id, booking_id, date, kind, outlet, night, product_id, order_id, description, qty, unit_price, amount, vat_rate, net, vat, account_code, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, companyId, bookingId, date, kind, outlet, night, product_id, order_id, description, qty, unit_price, sp.amount, vat_rate, sp.net, sp.vat, account_code, userId, now());
  return Number(r.lastInsertRowid);
}
const vatOf = (company) => (company.vat_enabled ? company.vat_rate : 0);
const dfr = (d) => d.split('-').reverse().join('/');

/** Posts the room, breakfast and taxe de séjour of one night. Does nothing if already posted. */
export function postNight(db, company, booking, night, userId = null) {
  if (db.get("SELECT 1 FROM hotel_folio_lines WHERE booking_id = ? AND kind = 'room' AND night = ? AND voided = 0", booking.id, night)) return false;
  const s = settingsOf(db, company.id);
  const type = db.get('SELECT * FROM hotel_room_types WHERE id = ?', booking.room_type_id);
  const plan = booking.rate_plan_id ? db.get('SELECT * FROM hotel_rate_plans WHERE id = ?', booking.rate_plan_id) : null;
  const room = booking.room_id ? db.get('SELECT number FROM hotel_rooms WHERE id = ?', booking.room_id) : null;
  const rate = nightRate(db, company.id, { type, plan, night, fixed: booking.rate });
  const base = { companyId: company.id, bookingId: booking.id, date: businessDate(db, company.id), night, userId };
  addLine(db, { ...base, kind: 'room', description: `Hébergement ${type.name}${room ? ` ch. ${room.number}` : ''} – nuit du ${dfr(night)}`, unit_price: rate, vat_rate: vatOf(company), account_code: '7061' });
  if (plan?.breakfast) addLine(db, { ...base, kind: 'breakfast', outlet: 'restaurant', description: `Petit-déjeuner – ${dfr(night)}`, qty: booking.adults, unit_price: s.breakfast_price, vat_rate: vatOf(company), account_code: '7062' });
  const tax = touristTax(s, booking.adults);
  if (tax) addLine(db, { ...base, kind: 'tax', description: `Taxe de séjour – ${dfr(night)}`, unit_price: tax, vat_rate: 0, account_code: '4428' });
  return true;
}

function postDayUse(db, company, booking, userId) {
  if (db.get("SELECT 1 FROM hotel_folio_lines WHERE booking_id = ? AND kind = 'room' AND voided = 0", booking.id)) return;
  const type = db.get('SELECT * FROM hotel_room_types WHERE id = ?', booking.room_type_id);
  const room = db.get('SELECT number FROM hotel_rooms WHERE id = ?', booking.room_id);
  addLine(db, { companyId: company.id, bookingId: booking.id, date: businessDate(db, company.id), kind: 'room', night: booking.arrival, description: `Passage (day use) ${type.name} ch. ${room.number}`,
    unit_price: booking.rate ?? (type.day_use_rate || Math.round(type.base_rate / 2)), vat_rate: vatOf(company), account_code: '7061', userId });
}

/** Charge on the folio: an article (bar, restaurant, laundry…) or a free amount (TTC). */
export function addCharge(db, bus, ctx, company, id, b) {
  const bk = getBooking(db, company.id, id);
  if (bk.status !== 'in_house') throw conflict('state', 'Le client doit être installé (check-in) pour recevoir des consommations');
  const lines = Array.isArray(b.lines) ? b.lines : [b];
  return db.tx(() => {
    for (const l of lines) chargeLine(db, company, bk.id, l, ctx.user.id);
    audit(db, ctx, 'charge', 'booking', id, lines.length);
    bus.emit(company.id, 'change', { entity: 'folio', id });
    return folio(db, company.id, id);
  });
}

export function chargeLine(db, company, bookingId, l, userId, extra = {}) {
  const qty = num(l.qty, 'qty', { min: 0.01, def: 1 });
  let description = str(l.description, 300), unit_price, account_code, outlet = str(l.outlet, 20) || 'reception', product_id = null, vat_rate = vatOf(company);
  if (l.product_id) {
    const it = db.get('SELECT p.*, i.price, o.account_code, o.kind outlet_kind FROM products p JOIN hotel_items i ON i.product_id = p.id JOIN hotel_outlets o ON o.id = i.outlet_id WHERE p.id = ? AND p.company_id = ?', l.product_id, company.id);
    if (!it) throw bad('product', 'Article introuvable');
    description ||= it.name; unit_price = l.price != null && l.price !== '' ? int(l.price, 'price', { min: 0 }) : it.price;
    account_code = it.account_code; outlet = it.outlet_kind; product_id = it.id; if (it.vat_rate != null) vat_rate = it.vat_rate;
  } else {
    if (!description) throw bad('description', 'Indiquez la désignation');
    unit_price = int(l.unit_price ?? l.amount, 'amount', { min: 1 });
    account_code = l.kind === 'fee' ? '7061' : '7063';
  }
  return addLine(db, { companyId: company.id, bookingId, date: businessDate(db, company.id), kind: l.kind === 'fee' ? 'fee' : 'extra', outlet, product_id, description: qty !== 1 && !l.description ? `${qty} × ${description}` : description,
    qty, unit_price, vat_rate, account_code, userId, ...extra });
}

export function voidLine(db, bus, ctx, company, bookingId, lineId, b) {
  const bk = getBooking(db, company.id, bookingId);
  if (bk.status === 'checked_out') throw conflict('closed', 'Folio clôturé : faites un avoir dans Compta');
  const l = db.get('SELECT * FROM hotel_folio_lines WHERE id = ? AND booking_id = ?', lineId, bookingId);
  if (!l || l.voided) throw notFound('Ligne introuvable');
  const reason = str(b.reason, 200);
  if (!reason) throw bad('reason', 'Indiquez le motif de l\'annulation');
  checkManager(db, ctx, b.manager_pin, 'Annulation de ligne');
  db.run('UPDATE hotel_folio_lines SET voided = 1, void_reason = ? WHERE id = ?', reason, l.id);
  audit(db, ctx, 'void_line', 'booking', bookingId, { line: l.description, amount: l.amount, reason });
  if (l.amount >= 20000) raiseAlert(db, bus, company.id, { kind: 'folio_void', level: 'warning', title: `Ligne annulée sur ${bk.number} : ${fcfa(l.amount)}`, body: `${l.description} · ${reason} · par ${ctx.user.name}`, entity: 'booking', entity_id: bookingId });
  bus.emit(company.id, 'change', { entity: 'folio', id: bookingId });
  return folio(db, company.id, bookingId);
}

export function folio(db, companyId, id) {
  const b = getBooking(db, companyId, id);
  const lines = db.all('SELECT l.*, u.name user_name FROM hotel_folio_lines l LEFT JOIN users u ON u.id = l.created_by WHERE l.booking_id = ? ORDER BY l.date, l.id', id);
  const payments = db.all(`SELECT p.*, fp.kind pay_kind, fp.currency, fp.foreign_amount, u.name user_name FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id LEFT JOIN users u ON u.id = p.created_by
    WHERE fp.booking_id = ? ORDER BY p.id`, id);
  const keys = db.all('SELECT k.*, r.number room_number FROM hotel_keys k JOIN hotel_rooms r ON r.id = k.room_id WHERE k.booking_id = ? ORDER BY k.id DESC', id);
  const guest = getGuest(db, companyId, b.guest_id);
  const bd = businessDate(db, companyId);
  const pending = b.status === 'in_house' && b.kind === 'night'
    ? nightsBetween(b.arrival, b.departure > bd ? b.departure : bd).filter((n) => !lines.some((l) => l.kind === 'room' && l.night === n && !l.voided)) : [];
  return { booking: b, guest, lines, payments, keys, pending_nights: pending, invoice: b.invoice_id ? db.get('SELECT id, number, status, total, paid FROM documents WHERE id = ?', b.invoice_id) : null };
}

// ---------------- Check-in / payments / check-out ----------------
export function checkIn(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const bk = getBooking(db, cid, id);
  if (!['tentative', 'confirmed'].includes(bk.status)) throw conflict('state', 'Cette réservation n\'attend pas d\'arrivée');
  const bd = businessDate(db, cid);
  if (bk.arrival > bd) throw conflict('early', `Arrivée prévue le ${dfr(bk.arrival)} : modifiez la date d'arrivée pour l'installer aujourd'hui`);
  if (b.guest) saveGuest(db, ctx, b.guest, bk.guest_id);
  const g = getGuest(db, cid, bk.guest_id);
  if (g.blacklisted) checkManager(db, ctx, b.manager_pin, 'Client sur liste noire');
  if (!g.id_number) throw bad('id_number', 'Fiche de police : le numéro de la pièce d\'identité est obligatoire');
  const roomId = Number(b.room_id || bk.room_id || suggestRoom(db, cid, { ...bk, arrival: bd })?.id || 0);
  const room = db.get('SELECT * FROM hotel_rooms WHERE id = ? AND company_id = ?', roomId, cid);
  if (!room) throw conflict('no_room', 'Aucune chambre libre de ce type : choisissez une autre chambre');
  if (room.out_of_order) throw conflict('ooo', `Chambre ${room.number} hors service : ${room.ooo_reason}`);
  const clash = roomFree(db, cid, room.id, bd, bk.departure > bd ? bk.departure : addDays(bd, 1), bk.id);
  if (clash) throw conflict('room_busy', `Chambre ${room.number} occupée ou réservée (${clash.number}, ${clash.name})`);
  if (!['clean', 'inspected'].includes(room.hk_status) && !b.force_dirty) throw conflict('dirty', `La chambre ${room.number} n'est pas encore propre. Choisissez-en une autre ou confirmez.`);
  const typeChanged = room.type_id !== bk.room_type_id;
  if (typeChanged) {
    const nt = db.get('SELECT name FROM hotel_room_types WHERE id = ?', room.type_id);
    if (!b.upgrade) throw conflict('type', `La chambre ${room.number} est de type ${nt.name}. Cochez « surclassement » pour confirmer.`);
  }
  return db.tx(() => {
    const frozen = typeChanged && !b.upgrade_charge && bk.rate == null
      ? nightRate(db, cid, { type: db.get('SELECT * FROM hotel_room_types WHERE id = ?', bk.room_type_id), plan: bk.rate_plan_id ? db.get('SELECT * FROM hotel_rate_plans WHERE id = ?', bk.rate_plan_id) : null, night: bd }) : bk.rate;
    db.run("UPDATE hotel_bookings SET status = 'in_house', room_id = ?, room_type_id = ?, arrival = ?, checked_in_at = ?, rate = ? WHERE id = ?",
      room.id, room.type_id, bk.arrival < bd ? bk.arrival : bd, now(), frozen, id);
    if (bk.kind === 'day_use') postDayUse(db, company, getBooking(db, cid, id), ctx.user.id);
    audit(db, ctx, 'check_in', 'booking', id, { room: room.number });
    bus.emit(cid, 'change', { entity: 'booking', id });
    if (g.vip) raiseAlert(db, bus, cid, { kind: 'vip_arrival', level: 'success', title: `Arrivée ${g.vip === 2 ? 'VVIP' : 'VIP'} : ${g.name} · ch. ${room.number}`, body: g.preferences ? `Préférences : ${g.preferences}` : '', entity: 'booking', entity_id: id });
    return folio(db, cid, id);
  });
}

/** Takes a payment on the folio. It is posted at once in Compta (D 57/552/521, C 411 payer). */
export function takePayment(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const bk = getBooking(db, cid, id);
  if (['cancelled', 'no_show'].includes(bk.status) && !b.allow_closed) throw conflict('state', 'Réservation annulée');
  if (bk.status === 'checked_out' && bk.invoice_id) throw conflict('closed', 'Séjour clôturé : encaissez la facture dans Compta');
  const way = oneOf(b.method, Object.keys(PAY), 'method', 'cash');
  const s = settingsOf(db, cid);
  const currency = oneOf(b.currency, ['XAF', 'EUR', 'USD'], 'currency', 'XAF');
  let amount, foreign = null, ref = str(b.reference, 80);
  if (currency !== 'XAF') {
    if (way !== 'cash') throw bad('currency', 'Les devises sont acceptées en espèces uniquement');
    foreign = num(b.foreign_amount, 'foreign_amount', { min: 0.01 });
    const rate = currency === 'EUR' ? s.eur_rate : s.usd_rate;
    amount = Math.round(foreign * rate);
    ref = `${foreign} ${currency} × ${rate}${ref ? ' · ' + ref : ''}`;
  } else amount = int(b.amount, 'amount', { min: 1 });
  if (way === 'card') ref = `Carte${ref ? ' ' + ref : ''}`;
  return db.tx(() => {
    const pid = tr.recordPayment(db, sys(ctx), company, { direction: 'in', partner_id: bk.bill_to_id, method: PAY[way].method, amount, reference: ref, phone: str(b.phone, 30),
      notes: `${b.deposit ? 'Acompte' : 'Règlement'} séjour ${bk.number}${bk.room_number ? ' ch. ' + bk.room_number : ''}` });
    db.run('INSERT INTO hotel_folio_payments (payment_id, booking_id, company_id, currency, foreign_amount, kind) VALUES (?,?,?,?,?,?)', pid, id, cid, currency, foreign, bk.status === 'in_house' ? 'payment' : 'deposit');
    if (bk.status === 'tentative') db.run("UPDATE hotel_bookings SET status = 'confirmed' WHERE id = ?", id);
    audit(db, ctx, 'payment', 'booking', id, { amount, method: way });
    bus.emit(cid, 'change', { entity: 'folio', id });
    return { payment_id: pid, folio: folio(db, cid, id) };
  });
}

/** Gives back money the guest overpaid (cash or Mobile Money): D 411 payer / C treasury. */
export function refund(db, bus, ctx, company, id, b) {
  const bk = getBooking(db, company.id, id);
  const amount = int(b.amount, 'amount', { min: 1 });
  if (amount > bk.paid - bk.charges) throw bad('amount', `Le client n'a que ${fcfa(Math.max(0, bk.paid - bk.charges))} d'avance`);
  checkManager(db, ctx, b.manager_pin, 'Remboursement');
  const way = oneOf(b.method, ['cash', 'mtn_momo', 'orange_money', 'bank'], 'method', 'cash');
  const m = PAY[way].method;
  const account = { cash: DEFAULTS.cash, mtn_momo: DEFAULTS.mtn_momo, orange_money: DEFAULTS.orange_money, bank: DEFAULTS.bank }[m];
  return db.tx(() => {
    const r = db.run(`INSERT INTO payments (company_id, direction, partner_id, date, amount, method, account_code, reference, status, notes, created_by, created_at) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      company.id, bk.bill_to_id, today(), amount, m, account, str(b.reference, 80), `Remboursement séjour ${bk.number}`, ctx.user.id, now());
    const pid = Number(r.lastInsertRowid);
    const entry = postEntry(db, { companyId: company.id, journal: m === 'cash' ? 'CA' : m === 'bank' ? 'BQ' : 'MM', date: today(), label: `Remboursement client ${bk.guest_name} – ${bk.number}`, ref: bk.number,
      source_type: 'payment', source_id: pid, userId: ctx.user.id, lines: [{ account: DEFAULTS.clients, partner_id: bk.bill_to_id, debit: amount }, { account, credit: amount }] });
    db.run('UPDATE payments SET entry_id = ? WHERE id = ?', entry, pid);
    db.run("INSERT INTO hotel_folio_payments (payment_id, booking_id, company_id, kind) VALUES (?,?,?,'refund')", pid, id, company.id);
    audit(db, ctx, 'refund', 'booking', id, amount);
    bus.emit(company.id, 'change', { entity: 'folio', id });
    return folio(db, company.id, id);
  });
}

export async function momoRequest(db, momo, ctx, company, id, b, { online = false } = {}) {
  const bk = getBooking(db, company.id, id);
  const provider = oneOf(b.provider, Object.keys(PROVIDERS), 'provider');
  if (!momo.configured(provider)) throw conflict('momo_config', `${PROVIDERS[provider].fr} n'est pas encore activé pour cet hôtel`);
  const amount = int(b.amount, 'amount', { min: 1 });
  const phone = normalizePhone(b.phone);
  const res = await momo.requestPayment({ provider, phone, amount, reference: bk.number, description: `${company.name} – séjour ${bk.number}` });
  const r = db.run('INSERT INTO hotel_momo (company_id, booking_id, provider, phone, amount, provider_ref, online, created_at) VALUES (?,?,?,?,?,?,?,?)', company.id, id, provider, phone, amount, res.providerRef, online ? 1 : 0, now());
  return { id: Number(r.lastInsertRowid), status: 'pending', amount, provider };
}

/** Checks a Mobile Money prompt; when paid, the payment goes on the folio. */
export async function momoStatus(db, bus, momo, ctx, company, momoId) {
  const m = db.get('SELECT * FROM hotel_momo WHERE id = ? AND company_id = ?', momoId, company.id);
  if (!m) throw notFound('Demande introuvable');
  if (m.status === 'pending') {
    let st;
    try { st = await momo.checkStatus(m.provider, m.provider_ref); } catch (e) { return { id: m.id, status: 'pending', note: e.message }; }
    if (st.status === 'successful') {
      db.tx(() => {
        const cur = db.get('SELECT status FROM hotel_momo WHERE id = ?', m.id);
        if (cur.status !== 'pending') return;
        const r = takePayment(db, bus, ctx, company, m.booking_id, { method: m.provider, amount: m.amount, reference: st.transactionId || m.provider_ref, phone: m.phone, allow_closed: true });
        db.run("UPDATE hotel_momo SET status = 'successful', transaction_id = ?, payment_id = ? WHERE id = ?", st.transactionId || '', r.payment_id, m.id);
        if (m.online) raiseAlert(db, bus, company.id, { kind: 'online_payment', level: 'success', title: `Paiement en ligne reçu : ${fcfa(m.amount)}`, body: `${PROVIDERS[m.provider].fr} · ${db.get('SELECT number FROM hotel_bookings WHERE id = ?', m.booking_id).number}`, entity: 'booking', entity_id: m.booking_id });
      });
    } else if (st.status === 'failed') db.run("UPDATE hotel_momo SET status = 'failed', reason = ? WHERE id = ?", String(st.reason || '').slice(0, 200), m.id);
    else if (Date.now() - Date.parse(m.created_at) > 5 * 60e3) db.run("UPDATE hotel_momo SET status = 'failed', reason = 'Délai dépassé' WHERE id = ?", m.id);
  }
  return db.get('SELECT id, booking_id, provider, amount, status, reason, transaction_id FROM hotel_momo WHERE id = ?', m.id);
}

export function moveRoom(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const bk = getBooking(db, cid, id);
  if (bk.status !== 'in_house') throw conflict('state', 'Seul un client installé peut changer de chambre');
  const room = db.get('SELECT * FROM hotel_rooms WHERE id = ? AND company_id = ? AND active = 1', b.room_id, cid);
  if (!room || room.id === bk.room_id) throw bad('room', 'Choisissez une autre chambre');
  if (room.out_of_order) throw conflict('ooo', `Chambre ${room.number} hors service`);
  const bd = businessDate(db, cid);
  const clash = roomFree(db, cid, room.id, bd, bk.departure > bd ? bk.departure : addDays(bd, 1), bk.id);
  if (clash) throw conflict('room_busy', `Chambre ${room.number} occupée ou réservée (${clash.number}, ${clash.name})`);
  const reason = str(b.reason, 200);
  return db.tx(() => {
    if (room.type_id !== bk.room_type_id && b.keep_rate !== false && bk.rate == null) {
      const t = db.get('SELECT * FROM hotel_room_types WHERE id = ?', bk.room_type_id);
      db.run('UPDATE hotel_bookings SET rate = ? WHERE id = ?', nightRate(db, cid, { type: t, plan: bk.rate_plan_id ? db.get('SELECT * FROM hotel_rate_plans WHERE id = ?', bk.rate_plan_id) : null, night: bd }), id);
    }
    db.run('UPDATE hotel_bookings SET room_id = ?, room_type_id = ? WHERE id = ?', room.id, room.type_id, id);
    db.run("UPDATE hotel_rooms SET hk_status = 'dirty' WHERE id = ?", bk.room_id);
    revokeForBooking(db, cid, id, 'revoked', bk.room_id);
    audit(db, ctx, 'move', 'booking', id, { from: bk.room_number, to: room.number, reason });
    bus.emit(cid, 'change', { entity: 'booking', id });
    return folio(db, cid, id);
  });
}

/**
 * Validated Compta invoice whose lines keep the exact TTC prices of the hotel
 * (95 000 stays 95 000): VAT = TTC − HT on each line, then posted as usual.
 * lines: [{ description, amount (TTC), net, vat, vat_rate, account_code, product_id? }]
 */
export function invoiceFromTtc(db, ctx, company, { partner_id, subject, notes = '', lines }) {
  let rows = lines.map((l) => ({ ...l, qty: 1 }));
  if (rows.length > 200) {
    rows = Object.values(rows.reduce((m, l) => {
      const k = `${l.group || l.description}|${l.account_code}|${l.vat_rate}`;
      m[k] ??= { description: l.group || l.description, account_code: l.account_code, vat_rate: l.vat_rate, net: 0, vat: 0, amount: 0, qty: 1 };
      m[k].net += l.net; m[k].vat += l.vat; m[k].amount += l.amount; return m;
    }, {}));
  }
  const id = docs.createDocument(db, sys(ctx), company, { kind: 'invoice', partner_id, date: today(), subject, notes,
    lines: rows.map((l) => ({ product_id: l.product_id, description: l.description, qty: 1, unit_price: l.net, vat_rate: l.vat_rate, account_code: l.account_code, kind: 'service' })) });
  const dl = db.all('SELECT id, position FROM document_lines WHERE document_id = ? ORDER BY position', id);
  dl.forEach((x, i) => db.run('UPDATE document_lines SET vat = ?, total = ? WHERE id = ?', rows[i].vat, rows[i].amount, x.id));
  const t = db.get('SELECT SUM(net) net, SUM(vat) vat, SUM(total) total FROM document_lines WHERE document_id = ?', id);
  db.run('UPDATE documents SET subtotal = ?, vat_total = ?, total = ? WHERE id = ?', t.net, t.vat, t.total, id);
  docs.validateDocument(db, sys(ctx), company, id);
  return id;
}
const groupOf = (l) => ({ room: 'Hébergement (nuitées)', tax: 'Taxe de séjour', breakfast: 'Petits-déjeuners' }[l.kind] || null);

export function checkOut(db, bus, ctx, company, id, b = {}) {
  const cid = company.id;
  const bk = getBooking(db, cid, id);
  if (bk.status !== 'in_house') throw conflict('state', 'Ce client n\'est pas installé');
  const bd = businessDate(db, cid);
  const s = settingsOf(db, cid);
  // Every night slept is charged, even if the night audit has not run yet (kept even if the check-out stops on the balance).
  if (bk.kind === 'night') db.tx(() => { for (const n of nightsBetween(bk.arrival, bd > bk.arrival ? bd : addDays(bk.arrival, 1))) postNight(db, company, bk, n, ctx.user.id); });
  return db.tx(() => {
    if (b.late_checkout_fee) chargeLine(db, company, id, { description: 'Départ tardif (late check-out)', unit_price: int(b.late_checkout_fee === true ? s.late_checkout_fee : b.late_checkout_fee, 'late_checkout_fee', { min: 1 }), kind: 'fee' }, ctx.user.id);
    const f = folio(db, cid, id);
    const balance = f.booking.balance;
    const cityLedger = bk.bill_to_id !== bk.guest_id;
    if (balance > 0 && !cityLedger && !b.allow_debt) throw conflict('balance', `Reste à payer : ${fcfa(balance)}. Encaissez le solde ou autorisez le départ avec dette.`);
    if (balance > 0 && !cityLedger && b.allow_debt) checkManager(db, ctx, b.manager_pin, 'Départ avec un solde impayé');
    let invoiceId = null, invoiceNumber = null;
    const lines = f.lines.filter((l) => !l.voided && l.amount > 0).map((l) => ({ ...l, group: groupOf(l) }));
    if (lines.length) {
      invoiceId = invoiceFromTtc(db, ctx, company, { partner_id: bk.bill_to_id,
        subject: `Séjour ${bk.number} – ${bk.guest_name}${bk.room_number ? ', chambre ' + bk.room_number : ''} – du ${dfr(bk.arrival)} au ${dfr(bd > bk.arrival ? bd : bk.departure)}`,
        notes: cityLedger ? `Facturé à ${bk.bill_to_name} pour le compte de ${bk.guest_name}.` : '', lines });
      for (const p of f.payments.filter((p) => p.pay_kind !== 'refund' && p.status === 'completed')) db.run('UPDATE payments SET document_id = ? WHERE id = ? AND document_id IS NULL', invoiceId, p.id);
      docs.refreshStatus(db, invoiceId);
      invoiceNumber = db.get('SELECT number FROM documents WHERE id = ?', invoiceId).number;
    }
    const points = Math.floor(f.booking.charges / 1000) * (s.points_per_1000 || 0);
    if (points) db.run('UPDATE hotel_guests SET points = points + ? WHERE partner_id = ?', points, bk.guest_id);
    db.run("UPDATE hotel_bookings SET status = 'checked_out', checked_out_at = ?, invoice_id = ?, departure = ? WHERE id = ?", now(), invoiceId, bk.kind === 'night' ? (bd > bk.arrival ? bd : addDays(bk.arrival, 1)) : bk.departure, id);
    db.run("UPDATE hotel_rooms SET hk_status = 'dirty', dnd = 0 WHERE id = ?", bk.room_id);
    revokeForBooking(db, cid, id, 'expired');
    db.run("UPDATE hotel_requests SET status = 'done', done_at = ? WHERE booking_id = ? AND status IN ('open','in_progress')", now(), id);
    audit(db, ctx, 'check_out', 'booking', id, { invoice: invoiceNumber, balance });
    if (balance > 0) raiseAlert(db, bus, cid, { kind: cityLedger ? 'city_ledger' : 'checkout_debt', level: cityLedger ? 'info' : 'danger',
      title: cityLedger ? `${bk.bill_to_name} : ${fcfa(balance)} à facturer (séjour ${bk.guest_name})` : `Départ avec ${fcfa(balance)} impayés : ${bk.guest_name}`, body: `Facture ${invoiceNumber}`, entity: 'document', entity_id: invoiceId });
    bus.emit(cid, 'change', { entity: 'booking', id });
    return { ...folio(db, cid, id), points, invoice_number: invoiceNumber };
  });
}

export { quoteStay, availability, roomFree, LIVE };
