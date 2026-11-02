// Prices and availability: room rate per night (weekend rate, seasons, rate
// plans, corporate rates), breakfast and taxe de séjour, rooms free per type.
import { addDays } from '../../core/validate.js';
import { solveNet } from '../../public/js/shop-pricing.js';

export const LIVE = "('tentative','confirmed','in_house')";
export const nightsBetween = (a, d) => { const out = []; for (let x = a; x < d; x = addDays(x, 1)) out.push(x); return out; };
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const round100 = (v) => Math.round(v / 100) * 100;

export function settingsOf(db, companyId) {
  return db.get('SELECT * FROM hotel_settings WHERE company_id = ?', companyId);
}
export const businessDate = (db, companyId) => settingsOf(db, companyId)?.business_date;

/** Room price (TTC) for one night. booking may carry a fixed negotiated rate. */
export function nightRate(db, companyId, { type, plan, night, fixed }) {
  if (fixed != null && fixed !== '') return Number(fixed);
  let v = type.weekend_rate && [5, 6].includes(dow(night)) ? type.weekend_rate : type.base_rate;
  let adjusted = false;
  const season = db.get('SELECT * FROM hotel_seasons WHERE company_id = ? AND date_from <= ? AND date_to >= ? ORDER BY id DESC LIMIT 1', companyId, night, night);
  if (season?.adjust_pct) { v = v * (1 + season.adjust_pct / 100); adjusted = true; }
  if (plan?.adjust_pct) { v = v * (1 + plan.adjust_pct / 100); adjusted = true; }
  return adjusted ? round100(v) : Math.round(v);
}

/** Splits a TTC amount into net + VAT, whole francs. amount = net + vat. */
export function split(amount, rate) {
  const net = solveNet(amount, rate);
  return { net, vat: amount - net, amount };
}

/** Full price of a stay (for quotes, the booking engine and the deposit). */
export function quoteStay(db, company, s, { type, plan, arrival, departure, adults = 1, kind = 'night', fixed = null }) {
  const nights = kind === 'day_use' ? [] : nightsBetween(arrival, departure);
  const vatRate = company.vat_enabled ? company.vat_rate : 0;
  let room = 0, breakfast = 0, tax = 0;
  const perNight = [];
  if (kind === 'day_use') room = type.day_use_rate || Math.round(type.base_rate / 2);
  for (const n of nights) {
    const r = nightRate(db, company.id, { type, plan, night: n, fixed });
    perNight.push({ night: n, rate: r });
    room += r;
    if (plan?.breakfast) breakfast += s.breakfast_price * adults;
    tax += touristTax(s, adults);
  }
  if (kind === 'day_use') tax = 0;
  const total = room + breakfast + tax;
  return { nights: nights.length, perNight, room, breakfast, tax, total, vat_rate: vatRate, deposit: Math.round(total * (s.deposit_pct || 0) / 100) };
}
export const touristTax = (s, adults) => (s.tourist_tax_mode === 'none' ? 0 : s.tourist_tax_mode === 'person' ? s.tourist_tax * Math.max(1, adults) : s.tourist_tax);

/** Rooms of a type that can be sold (active, not out of order). */
export const sellableRooms = (db, companyId, typeId) => db.all('SELECT * FROM hotel_rooms WHERE company_id = ? AND type_id = ? AND active = 1 AND out_of_order = 0 ORDER BY number', companyId, typeId);

/** Rooms left per type for each night of [arrival, departure). */
export function availability(db, companyId, arrival, departure, { exceptBooking = null } = {}) {
  const types = db.all('SELECT * FROM hotel_room_types WHERE company_id = ? AND active = 1 ORDER BY position, base_rate', companyId);
  const nights = nightsBetween(arrival, departure);
  const bd = businessDate(db, companyId);
  return types.map((t) => {
    const rooms = sellableRooms(db, companyId, t.id).length;
    let min = rooms;
    const perNight = nights.map((n) => {
      const used = db.get(`SELECT COUNT(*) c FROM hotel_bookings WHERE company_id = ? AND room_type_id = ? AND kind = 'night' AND status IN ${LIVE}
        AND arrival <= ? AND (departure > ? OR (status = 'in_house' AND ? < ?)) AND id IS NOT ?`, companyId, t.id, n, n, n, addDays(bd, 1), exceptBooking).c;
      min = Math.min(min, rooms - used);
      return { night: n, free: rooms - used };
    });
    return { type: t, rooms, free: nights.length ? min : rooms, perNight };
  });
}

/** Is this room free for these nights? (another booking already assigned to it, or a guest still in it) */
export function roomFree(db, companyId, roomId, arrival, departure, exceptBooking = null) {
  const bd = businessDate(db, companyId);
  const end = departure > arrival ? departure : addDays(arrival, 1);
  const clash = db.get(`SELECT b.number, p.name FROM hotel_bookings b JOIN partners p ON p.id = b.guest_id WHERE b.company_id = ? AND b.room_id = ? AND b.status IN ${LIVE} AND b.id IS NOT ?
    AND b.arrival < ? AND (CASE WHEN b.status = 'in_house' AND b.departure <= ? THEN ? ELSE (CASE WHEN b.departure > b.arrival THEN b.departure ELSE date(b.arrival, '+1 day') END) END) > ?`,
  companyId, roomId, exceptBooking, end, bd, addDays(bd, 1), arrival);
  return clash || null;
}
