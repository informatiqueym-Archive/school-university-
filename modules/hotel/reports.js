// Hotel figures: live dashboard, occupancy / ADR / RevPAR, revenue per outlet
// and per source, police register, cashier report, guest satisfaction.
import { addDays } from '../../core/validate.js';
import { today } from '../../core/schema.js';
import { settingsOf } from './rates.js';
import { roomBoard } from './services.js';

const r1 = (v) => Math.round(v * 10) / 10;

export function dashboard(db, companyId) {
  const s = settingsOf(db, companyId);
  const bd = s.business_date;
  const rooms = db.get('SELECT COUNT(*) n, COALESCE(SUM(out_of_order),0) ooo FROM hotel_rooms WHERE company_id = ? AND active = 1', companyId);
  const sellable = rooms.n - rooms.ooo;
  const inHouse = db.all(`SELECT b.id, b.number, b.departure, b.adults, b.children, b.rate, b.room_type_id, b.rate_plan_id, r.number room_number, g.name guest_name, hg.vip, hg.birth_date
    FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id LEFT JOIN hotel_rooms r ON r.id = b.room_id LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id WHERE b.company_id = ? AND b.status = 'in_house'`, companyId);
  const arrivals = db.all(`SELECT b.id, b.number, b.eta, b.adults, b.children, b.source, b.group_name, r.number room_number, t.name type_name, g.name guest_name, hg.vip FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id
    JOIN hotel_room_types t ON t.id = b.room_type_id LEFT JOIN hotel_rooms r ON r.id = b.room_id LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id
    WHERE b.company_id = ? AND b.status IN ('tentative','confirmed') AND b.arrival = ? ORDER BY hg.vip DESC, b.eta, g.name`, companyId, bd);
  const departures = db.all(`SELECT b.id, b.number, r.number room_number, g.name guest_name, b.late_checkout,
      COALESCE((SELECT SUM(amount) FROM hotel_folio_lines l WHERE l.booking_id = b.id AND l.voided = 0),0) - COALESCE((SELECT SUM(CASE WHEN fp.kind = 'refund' THEN -p.amount ELSE p.amount END) FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id WHERE fp.booking_id = b.id AND p.status = 'completed'),0) balance
    FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id LEFT JOIN hotel_rooms r ON r.id = b.room_id WHERE b.company_id = ? AND b.status = 'in_house' AND b.departure <= ? ORDER BY r.number`, companyId, bd);
  const checkedOut = db.get("SELECT COUNT(*) n FROM hotel_bookings WHERE company_id = ? AND status = 'checked_out' AND substr(checked_out_at,1,10) = ?", companyId, today()).n;
  const occupied = inHouse.length;
  const tonight = db.get(`SELECT COUNT(*) n FROM hotel_bookings WHERE company_id = ? AND kind = 'night' AND ((status = 'in_house' AND departure > ?) OR (status IN ('tentative','confirmed') AND arrival <= ? AND departure > ?))`, companyId, bd, bd, bd).n;
  const roomRev = db.get("SELECT COALESCE(SUM(net),0) v, COUNT(*) n FROM hotel_folio_lines WHERE company_id = ? AND kind = 'room' AND night = ? AND voided = 0", companyId, addDays(bd, -1));
  const revenue = db.all(`SELECT outlet, COALESCE(SUM(net),0) v FROM hotel_folio_lines WHERE company_id = ? AND date = ? AND voided = 0 AND kind <> 'tax' GROUP BY outlet`, companyId, bd);
  for (const x of db.all(`SELECT h.kind outlet, COALESCE(SUM(d.subtotal),0) v FROM hotel_orders o JOIN hotel_outlets h ON h.id = o.outlet_id JOIN documents d ON d.id = o.document_id
    WHERE o.company_id = ? AND o.settlement = 'paid' AND substr(o.created_at,1,10) = ? GROUP BY h.kind`, companyId, today())) {
    const e = revenue.find((r) => r.outlet === x.outlet); if (e) e.v += x.v; else revenue.push(x);
  }
  const payments = db.all(`SELECT p.method, p.reference, SUM(CASE WHEN fp.kind = 'refund' THEN -p.amount ELSE p.amount END) v FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id
    WHERE fp.company_id = ? AND p.date = ? AND p.status = 'completed' GROUP BY p.method, (p.reference LIKE 'Carte%')`, companyId, today());
  const pay = {};
  for (const p of payments) { const k = p.method === 'bank' && /^Carte/.test(p.reference || '') ? 'card' : p.method; pay[k] = (pay[k] || 0) + p.v; }
  for (const p of db.all(`SELECT p.method, p.reference, p.amount FROM hotel_orders o JOIN payments p ON p.document_id = o.document_id WHERE o.company_id = ? AND o.settlement = 'paid' AND p.date = ? AND p.status = 'completed'`, companyId, today())) {
    const k = p.method === 'bank' && /^Carte/.test(p.reference || '') ? 'card' : p.method; pay[k] = (pay[k] || 0) + p.amount;
  }
  const board = roomBoard(db, companyId);
  const hk = { clean: 0, dirty: 0, inspected: 0, cleaning: 0, ooo: rooms.ooo, undeclared: board.rooms.filter((r) => r.undeclared).length };
  for (const r of board.rooms) if (!r.out_of_order) hk[r.hk_status]++;
  const balance = db.get(`SELECT COALESCE(SUM(l.amount),0) - COALESCE((SELECT SUM(CASE WHEN fp.kind = 'refund' THEN -p.amount ELSE p.amount END) FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id JOIN hotel_bookings b2 ON b2.id = fp.booking_id WHERE b2.company_id = ? AND b2.status = 'in_house' AND p.status = 'completed'),0) v
    FROM hotel_folio_lines l JOIN hotel_bookings b ON b.id = l.booking_id WHERE b.company_id = ? AND b.status = 'in_house' AND l.voided = 0`, companyId, companyId).v;
  const history = db.all('SELECT * FROM hotel_daily WHERE company_id = ? AND date >= ? ORDER BY date', companyId, addDays(bd, -30));
  const next = [];
  for (let i = 0; i < 14; i++) {
    const n = addDays(bd, i);
    next.push({ night: n, sold: db.get(`SELECT COUNT(*) c FROM hotel_bookings WHERE company_id = ? AND kind = 'night' AND status IN ('tentative','confirmed','in_house') AND arrival <= ? AND departure > ?`, companyId, n, n).c });
  }
  const md = bd.slice(5);
  const birthdays = inHouse.filter((g) => g.birth_date && g.birth_date.slice(5) === md).map((g) => ({ name: g.guest_name, room: g.room_number }));
  const feedback = db.get("SELECT COUNT(*) n, AVG(rating) avg FROM hotel_feedback WHERE company_id = ? AND created_at >= ?", companyId, addDays(today(), -30));
  return {
    business_date: bd, audit_due: bd < today(), settings: { stars: s.stars },
    kpi: {
      rooms: rooms.n, ooo: rooms.ooo, sellable, occupied, tonight, occupancy: sellable ? r1(tonight * 100 / sellable) : 0,
      adr: roomRev.n ? Math.round(roomRev.v / roomRev.n) : 0, revpar: sellable ? Math.round(roomRev.v / sellable) : 0,
      guests: inHouse.reduce((t, g) => t + g.adults + g.children, 0), arrivals: arrivals.length, departures: departures.length, checked_out: checkedOut,
      in_house_balance: balance, vip: inHouse.filter((g) => g.vip).length,
    },
    arrivals, departures, revenue, payments: Object.entries(pay).map(([method, v]) => ({ method, v })), hk, history, next, birthdays,
    requests: db.get("SELECT COUNT(*) n FROM hotel_requests WHERE company_id = ? AND status IN ('open','in_progress')", companyId).n,
    orders: db.get("SELECT COUNT(*) n FROM hotel_orders o JOIN hotel_outlets h ON h.id = o.outlet_id WHERE o.company_id = ? AND o.status IN ('new','preparing','ready')", companyId).n,
    maintenance: db.get("SELECT COUNT(*) n FROM hotel_maintenance WHERE company_id = ? AND status <> 'done'", companyId).n,
    spa: db.get("SELECT COUNT(*) n FROM hotel_appointments WHERE company_id = ? AND substr(start_at,1,10) = ? AND status IN ('requested','booked')", companyId, bd).n,
    keys: db.get("SELECT COUNT(*) n FROM hotel_keys WHERE company_id = ? AND status = 'active'", companyId).n,
    feedback: { n: feedback.n, avg: feedback.avg ? r1(feedback.avg) : null },
  };
}

export function occupancy(db, companyId, from, to) {
  const days = db.all('SELECT * FROM hotel_daily WHERE company_id = ? AND date BETWEEN ? AND ? ORDER BY date', companyId, from, to).map((d) => {
    const avail = d.rooms - d.ooo;
    return { ...d, occupancy: avail ? r1(d.sold * 100 / avail) : 0, adr: d.sold ? Math.round(d.room_revenue / d.sold) : 0, revpar: avail ? Math.round(d.room_revenue / avail) : 0 };
  });
  const t = days.reduce((a, d) => ({ avail: a.avail + d.rooms - d.ooo, sold: a.sold + d.sold, rev: a.rev + d.room_revenue, other: a.other + d.other_revenue, no_shows: a.no_shows + d.no_shows, undeclared: a.undeclared + d.undeclared, guests: a.guests + d.guests }),
    { avail: 0, sold: 0, rev: 0, other: 0, no_shows: 0, undeclared: 0, guests: 0 });
  const bySource = db.all(`SELECT b.source, COUNT(DISTINCT b.id) bookings, COUNT(*) nights, SUM(l.net) revenue FROM hotel_folio_lines l JOIN hotel_bookings b ON b.id = l.booking_id
    WHERE l.company_id = ? AND l.kind = 'room' AND l.voided = 0 AND l.night BETWEEN ? AND ? GROUP BY b.source ORDER BY revenue DESC`, companyId, from, to);
  const byType = db.all(`SELECT t.name, COUNT(*) nights, SUM(l.net) revenue FROM hotel_folio_lines l JOIN hotel_bookings b ON b.id = l.booking_id JOIN hotel_room_types t ON t.id = b.room_type_id
    WHERE l.company_id = ? AND l.kind = 'room' AND l.voided = 0 AND l.night BETWEEN ? AND ? GROUP BY t.id ORDER BY revenue DESC`, companyId, from, to);
  const byOutlet = db.all(`SELECT outlet, SUM(net) revenue, COUNT(*) n FROM hotel_folio_lines WHERE company_id = ? AND voided = 0 AND kind <> 'tax' AND date BETWEEN ? AND ? GROUP BY outlet`, companyId, from, to);
  for (const x of db.all(`SELECT h.kind outlet, SUM(d.subtotal) revenue, COUNT(*) n FROM hotel_orders o JOIN hotel_outlets h ON h.id = o.outlet_id JOIN documents d ON d.id = o.document_id
    WHERE o.company_id = ? AND o.settlement = 'paid' AND substr(o.created_at,1,10) BETWEEN ? AND ? GROUP BY h.kind`, companyId, from, to)) {
    const e = byOutlet.find((r) => r.outlet === x.outlet); if (e) { e.revenue += x.revenue; e.n += x.n; } else byOutlet.push(x);
  }
  byOutlet.sort((a, b) => b.revenue - a.revenue);
  const nat = db.all(`SELECT COALESCE(NULLIF(hg.nationality,''),'—') nationality, COUNT(*) stays FROM hotel_bookings b LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id
    WHERE b.company_id = ? AND b.status IN ('in_house','checked_out') AND b.arrival BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, companyId, from, to);
  const tax = db.get("SELECT COALESCE(SUM(amount),0) v FROM hotel_folio_lines WHERE company_id = ? AND kind = 'tax' AND voided = 0 AND night BETWEEN ? AND ?", companyId, from, to).v;
  const fb = db.get('SELECT COUNT(*) n, AVG(rating) rating, AVG(cleanliness) cleanliness, AVG(service) service, AVG(food) food FROM hotel_feedback WHERE company_id = ? AND substr(created_at,1,10) BETWEEN ? AND ?', companyId, from, to);
  const comments = db.all(`SELECT f.*, g.name guest_name, r.number room_number FROM hotel_feedback f JOIN hotel_bookings b ON b.id = f.booking_id JOIN partners g ON g.id = b.guest_id LEFT JOIN hotel_rooms r ON r.id = b.room_id
    WHERE f.company_id = ? AND substr(f.created_at,1,10) BETWEEN ? AND ? ORDER BY f.id DESC LIMIT 30`, companyId, from, to);
  return {
    from, to, days, bySource, byType, byOutlet, nationalities: nat, tourist_tax: tax,
    totals: { ...t, occupancy: t.avail ? r1(t.sold * 100 / t.avail) : 0, adr: t.sold ? Math.round(t.rev / t.sold) : 0, revpar: t.avail ? Math.round(t.rev / t.avail) : 0 },
    feedback: { n: fb.n, rating: fb.rating && r1(fb.rating), cleanliness: fb.cleanliness && r1(fb.cleanliness), service: fb.service && r1(fb.service), food: fb.food && r1(fb.food), comments },
  };
}

/** Registre de police: every guest who checked in over the period, with ID details. */
export function policeRegister(db, companyId, from, to) {
  return db.all(`SELECT b.number, b.arrival, b.departure, b.checked_in_at, b.checked_out_at, b.adults, b.children, b.coming_from, b.going_to, b.purpose, b.vehicle, r.number room_number,
      g.name, g.phone, hg.title, hg.nationality, hg.id_type, hg.id_number, hg.id_issued_at, hg.id_issued_on, hg.birth_date, hg.birth_place, hg.profession, hg.home_address
    FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id LEFT JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.company_id = ? AND b.checked_in_at IS NOT NULL AND substr(b.checked_in_at,1,10) BETWEEN ? AND ? ORDER BY b.checked_in_at`, companyId, from, to);
}

/** Money taken by each receptionist/cashier, per method (folios + counter sales). */
export function cashierReport(db, companyId, from, to) {
  const rows = db.all(`SELECT u.name user_name, p.method, p.reference, fp.kind, fp.currency, fp.foreign_amount, p.amount FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id LEFT JOIN users u ON u.id = p.created_by
    WHERE fp.company_id = ? AND p.date BETWEEN ? AND ? AND p.status = 'completed'`, companyId, from, to);
  for (const p of db.all(`SELECT u.name user_name, p.method, p.reference, 'counter' kind, 'XAF' currency, NULL foreign_amount, p.amount FROM hotel_orders o JOIN payments p ON p.document_id = o.document_id LEFT JOIN users u ON u.id = p.created_by
    WHERE o.company_id = ? AND o.settlement = 'paid' AND p.date BETWEEN ? AND ? AND p.status = 'completed'`, companyId, from, to)) rows.push(p);
  const by = {};
  for (const r of rows) {
    const m = r.method === 'bank' && /^Carte/.test(r.reference || '') ? 'card' : r.method;
    const k = r.user_name || '—';
    by[k] ??= { user: k, total: 0, refunds: 0, methods: {}, eur: 0, usd: 0, count: 0 };
    const v = r.kind === 'refund' ? -r.amount : r.amount;
    by[k].total += v; by[k].count++;
    if (r.kind === 'refund') by[k].refunds += r.amount;
    by[k].methods[m] = (by[k].methods[m] || 0) + v;
    if (r.currency === 'EUR') by[k].eur += r.foreign_amount; if (r.currency === 'USD') by[k].usd += r.foreign_amount;
  }
  return Object.values(by).sort((a, b) => b.total - a.total);
}
