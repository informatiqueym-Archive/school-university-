// Night audit: closes the hotel day. Posts every in-house night (room,
// breakfast, taxe de séjour), marks no-shows, flags rooms the housekeepers saw
// occupied with no guest registered ("nuitées non déclarées"), records the day's
// figures and moves the business date forward. Runs by itself at audit_hour.
import { conflict } from '../../core/errors.js';
import { addDays } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { raiseAlert } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { settingsOf } from './rates.js';
import { postNight } from './front.js';
import { expireKeys } from './keys.js';

export function runNightAudit(db, bus, companyId, userId = null, { force = false } = {}) {
  const s = settingsOf(db, companyId);
  const d = s.business_date;
  if (d > today() && !force) throw conflict('future', `La journée du ${d} n'est pas encore commencée`);
  const company = db.get('SELECT * FROM companies WHERE id = ?', companyId);
  return db.tx(() => {
    const inHouse = db.all("SELECT * FROM hotel_bookings WHERE company_id = ? AND status = 'in_house'", companyId);
    let posted = 0;
    const overstays = [];
    for (const b of inHouse) {
      if (b.kind === 'day_use') { overstays.push(b); continue; }
      if (postNight(db, company, b, d, userId)) posted++;
      if (b.departure <= d) overstays.push(b);
    }
    // Arrivals that never came
    const noShows = db.all("SELECT b.*, p.name guest_name FROM hotel_bookings b JOIN partners p ON p.id = b.guest_id WHERE b.company_id = ? AND b.status IN ('tentative','confirmed') AND b.arrival <= ?", companyId, d);
    for (const b of noShows) db.run("UPDATE hotel_bookings SET status = 'no_show', room_id = NULL WHERE id = ?", b.id);
    // Rooms seen occupied by housekeeping with nobody registered in them that day
    const undeclared = db.all(`SELECT DISTINCT r.id, r.number FROM hotel_hk_log h JOIN hotel_rooms r ON r.id = h.room_id WHERE h.company_id = ? AND h.date = ? AND h.action = 'occupied_seen'
      AND NOT EXISTS (SELECT 1 FROM hotel_bookings b WHERE b.room_id = r.id AND (b.status = 'in_house' OR (b.status = 'checked_out' AND substr(b.checked_out_at,1,10) >= ?)))`, companyId, d, d);
    // Stayover rooms need cleaning tomorrow
    db.run("UPDATE hotel_rooms SET hk_status = 'dirty' WHERE company_id = ? AND id IN (SELECT room_id FROM hotel_bookings WHERE company_id = ? AND status = 'in_house' AND room_id IS NOT NULL)", companyId, companyId);
    expireKeys(db, companyId);

    // Figures of the day
    const rooms = db.get('SELECT COUNT(*) n, SUM(out_of_order) ooo FROM hotel_rooms WHERE company_id = ? AND active = 1', companyId);
    const sold = db.get("SELECT COUNT(DISTINCT booking_id) n, COALESCE(SUM(CASE WHEN amount = 0 THEN 1 ELSE 0 END),0) comp, COALESCE(SUM(net),0) rev FROM hotel_folio_lines WHERE company_id = ? AND kind = 'room' AND night = ? AND voided = 0", companyId, d);
    const guests = db.get("SELECT COALESCE(SUM(adults + children),0) n FROM hotel_bookings WHERE company_id = ? AND id IN (SELECT booking_id FROM hotel_folio_lines WHERE company_id = ? AND kind = 'room' AND night = ? AND voided = 0)", companyId, companyId, d).n;
    const other = db.get("SELECT COALESCE(SUM(net),0) v FROM hotel_folio_lines WHERE company_id = ? AND date = ? AND kind IN ('extra','breakfast','fee') AND voided = 0", companyId, d).v
      + db.get("SELECT COALESCE(SUM(d.subtotal),0) v FROM hotel_orders o JOIN documents d ON d.id = o.document_id WHERE o.company_id = ? AND o.settlement = 'paid' AND substr(o.created_at,1,10) = ?", companyId, d).v;
    const payments = db.get(`SELECT COALESCE(SUM(CASE WHEN fp.kind = 'refund' THEN -p.amount ELSE p.amount END),0) v FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id
      WHERE fp.company_id = ? AND p.date = ? AND p.status = 'completed'`, companyId, d).v;
    const arrivals = db.get("SELECT COUNT(*) n FROM hotel_bookings WHERE company_id = ? AND substr(checked_in_at,1,10) = ?", companyId, d).n;
    const departures = db.get("SELECT COUNT(*) n FROM hotel_bookings WHERE company_id = ? AND status = 'checked_out' AND substr(checked_out_at,1,10) = ?", companyId, d).n;
    db.run(`INSERT INTO hotel_daily (company_id, date, rooms, ooo, sold, complimentary, guests, arrivals, departures, no_shows, room_revenue, other_revenue, payments, undeclared, by_user, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id, date) DO UPDATE SET sold = excluded.sold, room_revenue = excluded.room_revenue, other_revenue = excluded.other_revenue,
      payments = excluded.payments, guests = excluded.guests, no_shows = excluded.no_shows, undeclared = excluded.undeclared, at = excluded.at`,
    companyId, d, rooms.n, rooms.ooo || 0, sold.n, sold.comp, guests, arrivals, departures, noShows.length, sold.rev, other, payments, undeclared.length, userId, now());
    db.run('UPDATE hotel_settings SET business_date = ? WHERE company_id = ?', addDays(d, 1), companyId);

    const occ = rooms.n - (rooms.ooo || 0) ? Math.round(sold.n * 1000 / (rooms.n - (rooms.ooo || 0))) / 10 : 0;
    raiseAlert(db, bus, companyId, { kind: 'night_audit', level: undeclared.length ? 'danger' : 'success', title: `Audit de nuit du ${d.split('-').reverse().join('/')} : ${occ} % d'occupation`,
      body: `${sold.n} chambres vendues · CA hébergement ${fcfa(sold.rev)} HT · ${noShows.length} no-show(s)${undeclared.length ? ` · ${undeclared.length} chambre(s) occupée(s) sans client : ${undeclared.map((u) => u.number).join(', ')}` : ''}` });
    for (const u of undeclared) raiseAlert(db, bus, companyId, { kind: 'undeclared_audit', level: 'danger', title: `Nuitée non déclarée probable · chambre ${u.number}`, body: `Vue occupée par le ménage le ${d}, aucun client enregistré.`, entity: 'room', entity_id: u.id });
    for (const b of overstays) raiseAlert(db, bus, companyId, { kind: 'overstay', level: 'warning', title: `Départ dépassé : ${b.number}`, body: 'Le client est toujours enregistré dans la chambre après sa date de départ. Prolongez ou faites le check-out.', entity: 'booking', entity_id: b.id });
    bus?.emit(companyId, 'change', { entity: 'audit' });
    return { date: d, next: addDays(d, 1), posted, no_shows: noShows.map((b) => ({ id: b.id, number: b.number, guest: b.guest_name })), undeclared, overstays: overstays.map((b) => b.number), occupancy: occ, sold: sold.n, room_revenue: sold.rev };
  });
}

/** Hourly job: runs any missed audit once the local hour (Douala) has passed audit_hour. */
export function autoAudit(db, bus) {
  const local = new Date(Date.now() + 3600e3);
  const hour = local.getUTCHours();
  const day = local.toISOString().slice(0, 10);
  for (const s of db.all('SELECT * FROM hotel_settings')) {
    let guard = 0;
    let cur = s.business_date;
    while (cur && (cur < addDays(day, -1) || (cur === addDays(day, -1) && hour >= s.audit_hour)) && guard++ < 10) {
      try { cur = runNightAudit(db, bus, s.company_id).next; } catch (e) { console.warn('night audit', e.message); break; }
    }
  }
}

// ---------------- iCal (Booking.com, Airbnb, Expedia…) ----------------
const icsDate = (d) => d.replace(/-/g, '');
/** Export: nights where a room type is full, as busy events, for channels to block. */
export function exportIcal(db, companyId, typeId, availabilityFn) {
  const t = db.get('SELECT * FROM hotel_room_types WHERE id = ? AND company_id = ?', typeId, companyId);
  if (!t) return null;
  const from = settingsOf(db, companyId).business_date;
  const av = availabilityFn(db, companyId, from, addDays(from, 365)).find((x) => x.type.id === t.id);
  const ev = [];
  let start = null;
  const nights = av?.perNight || [];
  nights.forEach((n, i) => {
    const full = n.free <= 0;
    if (full && !start) start = n.night;
    if ((!full || i === nights.length - 1) && start) { ev.push([start, full ? addDays(n.night, 1) : n.night]); start = null; }
  });
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Teknons Hotel//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${t.name}`];
  for (const [a, b] of ev) lines.push('BEGIN:VEVENT', `UID:${t.id}-${a}@teknons`, `DTSTAMP:${now().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${icsDate(a)}`, `DTEND;VALUE=DATE:${icsDate(b)}`, 'SUMMARY:Complet', 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Import: parses VEVENTs (UID, DTSTART, DTEND, SUMMARY). */
export function parseIcal(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const get = (k) => { const m = new RegExp(`^${k}(?:;[^:]*)?:(.*)$`, 'm').exec(block); return m ? m[1].trim() : ''; };
    const d = (v) => (v ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : '');
    const ev = { uid: get('UID'), start: d(get('DTSTART')), end: d(get('DTEND')), summary: get('SUMMARY') };
    if (ev.uid && ev.start && ev.end && ev.end > ev.start) out.push(ev);
  }
  return out;
}
