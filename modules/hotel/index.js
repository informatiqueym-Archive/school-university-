// Teknons Hôtel: property management for hotels, from guesthouses to 5-star
// resorts. Bookings and online booking engine, front desk, door key cards,
// folios, restaurant/bar/room service/spa, housekeeping, night audit, guest app,
// channel sync and reports. Teknons Compta runs underneath for invoices,
// payments and the SYSCOHADA books.
import { requirePerm, requireUser } from '../../core/auth.js';
import { bad, notFound, conflict } from '../../core/errors.js';
import { str, int, num, oneOf, date as vDate, addDays } from '../../core/validate.js';
import { audit } from '../../core/alerts.js';
import { now, today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { sendXlsx } from '../../core/xlsx.js';
import { PROVIDERS } from '../../core/payments/mobile-money.js';
import { baseUrl } from '../accounting/paylink.js';
import { migrateHotel, seedCompanyHotel, OUTLET_KINDS } from './schema.js';
import { settingsOf, quoteStay, availability, nightsBetween, LIVE } from './rates.js';
import * as F from './front.js';
import * as SV from './services.js';
import * as RP from './reports.js';
import { createLocks, issueKey, revokeKey, stayForCard, ACCESS } from './keys.js';
import { runNightAudit, autoAudit } from './audit.js';
import { registerPortal, syncIcal, icalKey } from './portal.js';
import * as PR from './print.js';

const MANAGERS = ['owner', 'admin', 'manager'];

export default {
  id: 'hotel',
  requires: ['accounting'],
  name: { fr: 'Teknons Hôtel', en: 'Teknons Hotel' },
  brand: { name: 'Teknons Hôtel', short: 'Hôtel', description: 'Gestion hôtelière complète : réservations, réception, cartes-clés, restaurant, spa, ménage, audit de nuit. FCFA, MTN MoMo, Orange Money.', navy: '#0C2D3E', accent: '#0E8F9B' },
  migrate: migrateHotel,
  onCompanyCreated: seedCompanyHotel,

  routes(r, { db, bus, momo, env }) {
    const locks = createLocks(env);
    const cid = (ctx) => ctx.user.company_id;
    const company = (ctx) => db.get('SELECT * FROM companies WHERE id = ?', cid(ctx));
    const changed = (ctx, entity, id) => bus.emit(cid(ctx), 'change', { entity, id });
    const isManager = (ctx) => MANAGERS.includes(ctx.user.role);
    const room = (ctx, id) => { const x = db.get('SELECT * FROM hotel_rooms WHERE id = ? AND company_id = ?', id, cid(ctx)); if (!x) throw notFound('Chambre introuvable'); return x; };
    const range = (q, days = 30) => { const to = vDate(q.to, 'to', today()); return { from: vDate(q.from, 'from', addDays(to, -days)), to }; };

    registerPortal(r, { db, bus, momo });

    // ---------------- Reference data ----------------
    r.get('/api/hotel/meta', requireUser, (ctx) => {
      const c = cid(ctx);
      seedCompanyHotel(db, c);
      const s = settingsOf(db, c);
      const { manager_pin_hash, ...pub } = s;
      return {
        settings: { ...pub, has_pin: !!manager_pin_hash, lock_mode: locks.mode },
        types: db.all('SELECT * FROM hotel_room_types WHERE company_id = ? ORDER BY active DESC, position, base_rate', c),
        rooms: db.all('SELECT r.id, r.number, r.type_id, r.floor, r.view, r.active, r.out_of_order, r.ooo_reason, r.notes, t.name type_name FROM hotel_rooms r JOIN hotel_room_types t ON t.id = r.type_id WHERE r.company_id = ? ORDER BY r.floor, r.number', c),
        plans: db.all('SELECT p.*, x.name partner_name FROM hotel_rate_plans p LEFT JOIN partners x ON x.id = p.partner_id WHERE p.company_id = ? ORDER BY p.active DESC, p.id', c),
        seasons: db.all('SELECT * FROM hotel_seasons WHERE company_id = ? ORDER BY date_from', c),
        outlets: db.all('SELECT * FROM hotel_outlets WHERE company_id = ? ORDER BY id', c),
        outlet_kinds: OUTLET_KINDS, sources: F.SOURCES, pay: Object.fromEntries(Object.entries(F.PAY).map(([k, v]) => [k, { fr: v.fr, en: v.en }])),
        request_kinds: SV.REQUEST_KINDS, access: ACCESS, public_url: baseUrl(ctx, env),
        momo: { mode: momo.mode, mtn_momo: momo.configured('mtn_momo'), orange_money: momo.configured('orange_money') },
        staff: db.all("SELECT id, name, role FROM users WHERE company_id = ? AND active = 1 AND role IN ('housekeeper','manager','owner','admin','receptionist','waiter') ORDER BY name", c),
        ical: can(ctx.user, 'settings') ? db.all('SELECT i.*, t.name type_name FROM hotel_ical i JOIN hotel_room_types t ON t.id = i.room_type_id WHERE i.company_id = ?', c) : [],
        ical_export: can(ctx.user, 'settings') ? db.all('SELECT * FROM hotel_room_types WHERE company_id = ? AND active = 1', c).map((t) => ({ type_id: t.id, name: t.name, url: `${baseUrl(ctx, env)}/ical/hotel/${c}/${t.id}.ics?k=${icalKey(t)}` })) : [],
      };
    });

    r.put('/api/hotel/settings', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const c = cid(ctx); const s = settingsOf(db, c);
      const time = (v, d) => { const t = str(v ?? d, 5); if (!/^\d{2}:\d{2}$/.test(t)) throw bad('time', 'Heure invalide (HH:MM)'); return t; };
      db.run(`UPDATE hotel_settings SET stars = ?, checkin_time = ?, checkout_time = ?, audit_hour = ?, tourist_tax = ?, tourist_tax_mode = ?, breakfast_price = ?, deposit_pct = ?, late_checkout_fee = ?,
          eur_rate = ?, usd_rate = ?, points_per_1000 = ?, online_booking = ?, welcome_text = ?, wifi_name = ?, wifi_password = ? WHERE company_id = ?`,
      Math.min(5, int(b.stars, 'stars', { min: 0, def: s.stars })), time(b.checkin_time, s.checkin_time), time(b.checkout_time, s.checkout_time), Math.min(23, int(b.audit_hour, 'audit_hour', { min: 0, def: s.audit_hour })),
      int(b.tourist_tax, 'tourist_tax', { min: 0, def: s.tourist_tax }), oneOf(b.tourist_tax_mode, ['room', 'person', 'none'], 'tourist_tax_mode', s.tourist_tax_mode), int(b.breakfast_price, 'breakfast_price', { min: 0, def: s.breakfast_price }),
      Math.min(100, int(b.deposit_pct, 'deposit_pct', { min: 0, def: s.deposit_pct })), int(b.late_checkout_fee, 'late_checkout_fee', { min: 0, def: s.late_checkout_fee }),
      num(b.eur_rate, 'eur_rate', { min: 1, def: s.eur_rate }), num(b.usd_rate, 'usd_rate', { min: 1, def: s.usd_rate }), int(b.points_per_1000, 'points_per_1000', { min: 0, def: s.points_per_1000 }),
      b.online_booking === undefined ? s.online_booking : (b.online_booking ? 1 : 0), str(b.welcome_text ?? s.welcome_text, 1500), str(b.wifi_name ?? s.wifi_name, 60), str(b.wifi_password ?? s.wifi_password, 60), c);
      if (b.manager_pin) F.setManagerPin(db, c, b.manager_pin);
      audit(db, ctx, 'update', 'hotel_settings', c);
      changed(ctx, 'hotel_settings');
      return { ok: true };
    });

    // Room types, rooms, rate plans, seasons
    const typeVals = (b, cur = {}) => ({
      code: str(b.code ?? cur.code, 10).toUpperCase(), name: str(b.name ?? cur.name, 80), description: str(b.description ?? cur.description, 1500), amenities: str(b.amenities ?? cur.amenities, 800),
      capacity: int(b.capacity ?? cur.capacity, 'capacity', { min: 1, def: 2 }), base_rate: int(b.base_rate ?? cur.base_rate, 'base_rate', { min: 0 }), weekend_rate: int(b.weekend_rate ?? cur.weekend_rate, 'weekend_rate', { min: 0, def: 0 }),
      day_use_rate: int(b.day_use_rate ?? cur.day_use_rate, 'day_use_rate', { min: 0, def: 0 }), extra_person: int(b.extra_person ?? cur.extra_person, 'extra_person', { min: 0, def: 0 }), image: str(b.image ?? cur.image, 500),
      position: int(b.position ?? cur.position, 'position', { def: 0 }), online: b.online === undefined ? (cur.online ?? 1) : (b.online ? 1 : 0), active: b.active === undefined ? (cur.active ?? 1) : (b.active ? 1 : 0),
    });
    r.post('/api/hotel/room-types', requirePerm('settings'), (ctx) => {
      const v = typeVals(ctx.body); if (!v.name || !v.code) throw bad('name', 'Code et nom obligatoires');
      const res = db.run(`INSERT INTO hotel_room_types (company_id, ${Object.keys(v).join(', ')}) VALUES (?, ${Object.keys(v).map(() => '?').join(', ')})`, cid(ctx), ...Object.values(v));
      changed(ctx, 'room_type');
      return ctx.json(db.get('SELECT * FROM hotel_room_types WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/hotel/room-types/:id', requirePerm('settings'), (ctx) => {
      const cur = db.get('SELECT * FROM hotel_room_types WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!cur) throw notFound();
      const v = typeVals(ctx.body, cur);
      db.run(`UPDATE hotel_room_types SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(v), cur.id);
      audit(db, ctx, 'update', 'room_type', cur.id, { base_rate: v.base_rate });
      changed(ctx, 'room_type');
      return db.get('SELECT * FROM hotel_room_types WHERE id = ?', cur.id);
    });
    r.post('/api/hotel/rooms', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const c = cid(ctx);
      if (!db.get('SELECT id FROM hotel_room_types WHERE id = ? AND company_id = ?', b.type_id, c)) throw bad('type', 'Type de chambre inconnu');
      const numbers = b.from && b.to ? Array.from({ length: Math.max(0, int(b.to, 'to') - int(b.from, 'from') + 1) }, (_, i) => String(int(b.from, 'from') + i)) : [str(b.number, 10)];
      if (!numbers.length || numbers.length > 300 || numbers.some((x) => !x)) throw bad('number', 'Numéro(s) de chambre invalide(s)');
      db.tx(() => { for (const nb of numbers) {
        if (db.get('SELECT 1 FROM hotel_rooms WHERE company_id = ? AND number = ?', c, nb)) throw conflict('exists', `La chambre ${nb} existe déjà`);
        db.run('INSERT INTO hotel_rooms (company_id, number, type_id, floor, view, notes, portal_token) VALUES (?,?,?,?,?,?,?)', c, nb, b.type_id, str(b.floor, 10) || (nb.length >= 3 ? nb.slice(0, -2) : ''), str(b.view, 40), str(b.notes, 300), F.token());
      } });
      changed(ctx, 'room');
      return ctx.json({ created: numbers.length }, 201);
    });
    r.put('/api/hotel/rooms/:id', requirePerm('settings'), (ctx) => {
      const x = room(ctx, ctx.params.id); const b = ctx.body;
      if (b.type_id && !db.get('SELECT id FROM hotel_room_types WHERE id = ? AND company_id = ?', b.type_id, cid(ctx))) throw bad('type', 'Type inconnu');
      db.run('UPDATE hotel_rooms SET number = ?, type_id = ?, floor = ?, view = ?, notes = ?, active = ? WHERE id = ?', str(b.number ?? x.number, 10) || x.number, b.type_id || x.type_id, str(b.floor ?? x.floor, 10), str(b.view ?? x.view, 40), str(b.notes ?? x.notes, 300), b.active === undefined ? x.active : (b.active ? 1 : 0), x.id);
      if (b.new_qr) db.run('UPDATE hotel_rooms SET portal_token = ? WHERE id = ?', F.token(), x.id);
      changed(ctx, 'room');
      return db.get('SELECT * FROM hotel_rooms WHERE id = ?', x.id);
    });
    const planVals = (c, b, cur = {}) => {
      const partner = b.partner_id === undefined ? (cur.partner_id ?? null) : (b.partner_id || null);
      if (partner && !db.get("SELECT id FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", partner, c)) throw bad('partner', 'Entreprise inconnue');
      return { code: str(b.code ?? cur.code, 12).toUpperCase(), name: str(b.name ?? cur.name, 100), adjust_pct: num(b.adjust_pct ?? cur.adjust_pct, 'adjust_pct', { min: -90, def: 0 }), breakfast: b.breakfast === undefined ? (cur.breakfast ?? 0) : (b.breakfast ? 1 : 0),
        refundable: b.refundable === undefined ? (cur.refundable ?? 1) : (b.refundable ? 1 : 0), min_nights: int(b.min_nights ?? cur.min_nights, 'min_nights', { min: 1, def: 1 }), partner_id: partner,
        online: b.online === undefined ? (cur.online ?? 0) : (b.online ? 1 : 0), active: b.active === undefined ? (cur.active ?? 1) : (b.active ? 1 : 0) };
    };
    r.post('/api/hotel/rate-plans', requirePerm('settings'), (ctx) => {
      const v = planVals(cid(ctx), ctx.body); if (!v.code || !v.name) throw bad('name', 'Code et nom obligatoires');
      const res = db.run(`INSERT INTO hotel_rate_plans (company_id, ${Object.keys(v).join(', ')}) VALUES (?, ${Object.keys(v).map(() => '?').join(', ')})`, cid(ctx), ...Object.values(v));
      return ctx.json(db.get('SELECT * FROM hotel_rate_plans WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/hotel/rate-plans/:id', requirePerm('settings'), (ctx) => {
      const cur = db.get('SELECT * FROM hotel_rate_plans WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!cur) throw notFound();
      const v = planVals(cid(ctx), ctx.body, cur);
      db.run(`UPDATE hotel_rate_plans SET ${Object.keys(v).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(v), cur.id);
      return db.get('SELECT * FROM hotel_rate_plans WHERE id = ?', cur.id);
    });
    r.post('/api/hotel/seasons', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const from = vDate(b.date_from, 'date_from'), to = vDate(b.date_to, 'date_to');
      if (to < from) throw bad('date_to', 'La fin doit être après le début');
      const res = db.run('INSERT INTO hotel_seasons (company_id, name, date_from, date_to, adjust_pct) VALUES (?,?,?,?,?)', cid(ctx), str(b.name, 80) || 'Saison', from, to, num(b.adjust_pct, 'adjust_pct', { min: -90 }));
      return ctx.json(db.get('SELECT * FROM hotel_seasons WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.del('/api/hotel/seasons/:id', requirePerm('settings'), (ctx) => { db.run('DELETE FROM hotel_seasons WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); return { ok: true }; });

    // Outlets and their menus
    r.post('/api/hotel/outlets', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const kind = oneOf(b.kind, Object.keys(OUTLET_KINDS), 'kind', 'other');
      const res = db.run('INSERT INTO hotel_outlets (company_id, code, name, kind, account_code, kitchen) VALUES (?,?,?,?,?,?)', cid(ctx), str(b.code, 10).toUpperCase() || kind.toUpperCase().slice(0, 6), str(b.name, 60) || OUTLET_KINDS[kind].fr, kind,
        ['restaurant', 'bar', 'room_service', 'minibar'].includes(kind) ? '7062' : '7063', b.kitchen ? 1 : 0);
      return ctx.json(db.get('SELECT * FROM hotel_outlets WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/hotel/outlets/:id', requirePerm('settings'), (ctx) => {
      const o = db.get('SELECT * FROM hotel_outlets WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!o) throw notFound();
      db.run('UPDATE hotel_outlets SET name = ?, kitchen = ?, active = ? WHERE id = ?', str(ctx.body.name ?? o.name, 60), ctx.body.kitchen === undefined ? o.kitchen : (ctx.body.kitchen ? 1 : 0), ctx.body.active === undefined ? o.active : (ctx.body.active ? 1 : 0), o.id);
      return db.get('SELECT * FROM hotel_outlets WHERE id = ?', o.id);
    });
    r.get('/api/hotel/items', requirePerm('read'), (ctx) => SV.listItems(db, cid(ctx), ctx.query));
    r.post('/api/hotel/items', requirePerm('settings'), (ctx) => ctx.json(SV.saveItem(db, company(ctx), ctx.body), 201));
    r.put('/api/hotel/items/:id', requirePerm('settings'), (ctx) => SV.saveItem(db, company(ctx), ctx.body, Number(ctx.params.id)));

    // ---------------- Availability, planning ----------------
    r.get('/api/hotel/availability', requirePerm('read'), (ctx) => {
      const a = vDate(ctx.query.arrival, 'arrival'), d = vDate(ctx.query.departure, 'departure', addDays(a, 1));
      return availability(db, cid(ctx), a, d > a ? d : addDays(a, 1), { exceptBooking: ctx.query.except || null }).map((x) => ({ type_id: x.type.id, name: x.type.name, rooms: x.rooms, free: x.free }));
    });
    r.get('/api/hotel/quote', requirePerm('read'), (ctx) => {
      const q = ctx.query; const c = company(ctx);
      const type = db.get('SELECT * FROM hotel_room_types WHERE id = ? AND company_id = ?', q.room_type_id, c.id); if (!type) throw bad('type', 'Type inconnu');
      const plan = q.rate_plan_id ? db.get('SELECT * FROM hotel_rate_plans WHERE id = ? AND company_id = ?', q.rate_plan_id, c.id) : null;
      const kind = q.kind === 'day_use' ? 'day_use' : 'night';
      const arrival = vDate(q.arrival, 'arrival'); const departure = kind === 'day_use' ? arrival : vDate(q.departure, 'departure');
      if (kind === 'night' && departure <= arrival) throw bad('departure', 'Dates invalides');
      return quoteStay(db, c, settingsOf(db, c.id), { type, plan, arrival, departure, adults: int(q.adults, 'adults', { min: 1, def: 1 }), kind, fixed: q.rate === '' || q.rate == null ? null : int(q.rate, 'rate', { min: 0 }) });
    });
    r.get('/api/hotel/planning', requirePerm('read'), (ctx) => {
      const c = cid(ctx); const s = settingsOf(db, c);
      const from = vDate(ctx.query.from, 'from', addDays(s.business_date, -1)); const days = Math.min(62, int(ctx.query.days, 'days', { min: 1, def: 14 }));
      const to = addDays(from, days);
      const bookings = db.all(`SELECT b.id, b.number, b.room_id, b.room_type_id, b.arrival, b.departure, b.status, b.kind, b.source, b.adults, b.children, b.group_name, g.name guest_name, hg.vip,
          COALESCE((SELECT SUM(amount) FROM hotel_folio_lines l WHERE l.booking_id = b.id AND l.voided = 0),0) - COALESCE((SELECT SUM(CASE WHEN fp.kind = 'refund' THEN -p.amount ELSE p.amount END) FROM hotel_folio_payments fp JOIN payments p ON p.id = fp.payment_id WHERE fp.booking_id = b.id AND p.status = 'completed'),0) balance
        FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id
        WHERE b.company_id = ? AND b.status IN ('tentative','confirmed','in_house','checked_out') AND b.arrival < ? AND (b.departure >= ? OR b.status = 'in_house')`, c, to, from);
      const av = availability(db, c, from, to);
      return { from, days, business_date: s.business_date, bookings, free: av.map((a) => ({ type_id: a.type.id, perNight: a.perNight })) };
    });

    // ---------------- Guests ----------------
    r.get('/api/hotel/guests', requirePerm('read'), (ctx) => {
      const q = ctx.query; const where = ["p.company_id = ?", "p.kind = 'client'", "p.name <> 'Clients de passage'"]; const a = [cid(ctx)];
      if (q.q) { where.push('(p.name LIKE ? OR p.phone LIKE ? OR p.email LIKE ? OR hg.id_number LIKE ?)'); a.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
      if (q.vip) where.push('hg.vip > 0');
      return db.all(`SELECT p.id, p.name, p.phone, p.email, p.city, hg.nationality, hg.vip, hg.points, hg.blacklisted, hg.id_number,
          (SELECT COUNT(*) FROM hotel_bookings b WHERE b.guest_id = p.id AND b.status = 'checked_out') stays, (SELECT MAX(departure) FROM hotel_bookings b WHERE b.guest_id = p.id) last_stay,
          (SELECT status FROM hotel_bookings b WHERE b.guest_id = p.id AND b.status = 'in_house' LIMIT 1) in_house
        FROM partners p LEFT JOIN hotel_guests hg ON hg.partner_id = p.id WHERE ${where.join(' AND ')} ORDER BY in_house IS NULL, hg.vip DESC, p.name LIMIT ${q.q ? 30 : 500}`, ...a);
    });
    r.get('/api/hotel/guests/:id', requirePerm('read'), (ctx) => {
      const g = F.getGuest(db, cid(ctx), ctx.params.id);
      g.bookings = F.listBookings(db, cid(ctx), { guest_id: g.partner_id, limit: 100 });
      g.lost_found = db.all('SELECT * FROM hotel_lost_found WHERE guest_id = ? ORDER BY id DESC', g.partner_id);
      return g;
    });
    r.post('/api/hotel/guests', requirePerm('frontdesk'), (ctx) => ctx.json(F.saveGuest(db, ctx, ctx.body), 201));
    r.put('/api/hotel/guests/:id', requirePerm('frontdesk'), (ctx) => { const g = F.saveGuest(db, ctx, ctx.body, Number(ctx.params.id)); audit(db, ctx, 'update', 'guest', g.partner_id); return g; });

    // ---------------- Bookings and folios ----------------
    r.get('/api/hotel/bookings', requirePerm('read'), (ctx) => {
      const rows = F.listBookings(db, cid(ctx), ctx.query);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `reservations-${today()}.xlsx`, [{ name: 'Réservations', title: `${company(ctx).name} – Réservations`, columns: [
        { header: 'N°', key: 'number', width: 16 }, { header: 'Client', key: 'guest_name', width: 28 }, { header: 'Arrivée', key: 'arrival', type: 'date' }, { header: 'Départ', key: 'departure', type: 'date' },
        { header: 'Chambre', key: 'room_number', width: 9 }, { header: 'Type', key: 'type_name', width: 18 }, { header: 'Source', key: 'source', width: 12 }, { header: 'Statut', key: 'status', width: 12 },
        { header: 'Prestations', key: 'charges', type: 'money' }, { header: 'Payé', key: 'paid', type: 'money' }, { header: 'Solde', key: 'balance', type: 'money' }], rows }]);
      return rows;
    });
    r.post('/api/hotel/bookings', requirePerm('frontdesk'), (ctx) => ctx.json(F.createBooking(db, bus, ctx, company(ctx), ctx.body), 201));
    r.get('/api/hotel/bookings/:id', requirePerm('read'), (ctx) => {
      const f = F.folio(db, cid(ctx), ctx.params.id);
      f.orders = SV.listOrders(db, cid(ctx), { booking_id: f.booking.id });
      f.requests = SV.listRequests(db, cid(ctx), { booking_id: f.booking.id });
      f.group = f.booking.group_id ? F.listBookings(db, cid(ctx), { group_id: f.booking.group_id }) : [];
      f.feedback = db.get('SELECT * FROM hotel_feedback WHERE booking_id = ?', f.booking.id) || null;
      f.portal_url = `${baseUrl(ctx, env)}/g/${f.booking.portal_token}`;
      return f;
    });
    r.put('/api/hotel/bookings/:id', requirePerm('frontdesk'), (ctx) => F.updateBooking(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.post('/api/hotel/bookings/:id/cancel', requirePerm('frontdesk'), (ctx) => F.cancelBooking(db, bus, ctx, Number(ctx.params.id), ctx.body));
    r.post('/api/hotel/bookings/:id/no-show', requirePerm('frontdesk'), (ctx) => F.cancelBooking(db, bus, ctx, Number(ctx.params.id), ctx.body, 'no_show'));
    r.post('/api/hotel/bookings/:id/reinstate', requirePerm('frontdesk'), (ctx) => {
      const b = F.getBooking(db, cid(ctx), ctx.params.id);
      if (!['cancelled', 'no_show'].includes(b.status)) throw conflict('state', 'Réservation active');
      const av = availability(db, cid(ctx), b.arrival, b.departure > b.arrival ? b.departure : addDays(b.arrival, 1)).find((x) => x.type.id === b.room_type_id);
      if (b.kind === 'night' && (!av || av.free < 1)) throw conflict('full', 'Plus de chambre libre sur ces dates');
      db.run("UPDATE hotel_bookings SET status = 'confirmed', cancel_reason = '' WHERE id = ?", b.id);
      audit(db, ctx, 'reinstate', 'booking', b.id); changed(ctx, 'booking', b.id);
      return F.getBooking(db, cid(ctx), b.id);
    });
    r.get('/api/hotel/bookings/:id/suggest-room', requirePerm('read'), (ctx) => {
      const b = F.getBooking(db, cid(ctx), ctx.params.id); const bd = settingsOf(db, cid(ctx)).business_date;
      const rooms = db.all('SELECT r.*, t.name type_name FROM hotel_rooms r JOIN hotel_room_types t ON t.id = r.type_id WHERE r.company_id = ? AND r.active = 1 AND r.out_of_order = 0 ORDER BY r.type_id = ? DESC, r.number', cid(ctx), b.room_type_id);
      const arrival = b.status === 'in_house' ? bd : (b.arrival < bd ? bd : b.arrival);
      const departure = b.departure > arrival ? b.departure : addDays(arrival, 1);
      return { suggested: F.suggestRoom(db, cid(ctx), { ...b, arrival })?.id || null, rooms: rooms.map((x) => ({ id: x.id, number: x.number, type_id: x.type_id, type_name: x.type_name, hk_status: x.hk_status, floor: x.floor, free: !F.roomFree(db, cid(ctx), x.id, arrival, departure, b.id) })) };
    });
    r.post('/api/hotel/bookings/:id/check-in', requirePerm('frontdesk'), (ctx) => F.checkIn(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.post('/api/hotel/bookings/:id/charges', requirePerm('frontdesk', 'outlet'), (ctx) => F.addCharge(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.post('/api/hotel/bookings/:id/lines/:line/void', requirePerm('frontdesk'), (ctx) => F.voidLine(db, bus, ctx, company(ctx), Number(ctx.params.id), Number(ctx.params.line), ctx.body));
    r.post('/api/hotel/bookings/:id/payments', requirePerm('frontdesk'), (ctx) => ctx.json(F.takePayment(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body).folio, 201));
    r.post('/api/hotel/bookings/:id/refund', requirePerm('frontdesk'), (ctx) => F.refund(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.post('/api/hotel/bookings/:id/momo', requirePerm('frontdesk'), async (ctx) => ctx.json(await F.momoRequest(db, momo, ctx, company(ctx), Number(ctx.params.id), ctx.body), 201));
    r.get('/api/hotel/momo/:id', requirePerm('frontdesk'), (ctx) => F.momoStatus(db, bus, momo, ctx, company(ctx), Number(ctx.params.id)));
    r.post('/api/hotel/bookings/:id/move', requirePerm('frontdesk'), (ctx) => F.moveRoom(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.post('/api/hotel/bookings/:id/check-out', requirePerm('frontdesk'), (ctx) => F.checkOut(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.post('/api/hotel/bookings/:id/late-checkout', requirePerm('frontdesk'), (ctx) => {
      const b = F.getBooking(db, cid(ctx), ctx.params.id); const t = str(ctx.body.time, 5);
      if (t && !/^\d{2}:\d{2}$/.test(t)) throw bad('time', 'Heure invalide');
      db.run('UPDATE hotel_bookings SET late_checkout = ? WHERE id = ?', t, b.id);
      if (t) db.run("UPDATE hotel_keys SET valid_to = ? WHERE booking_id = ? AND status = 'active'", `${b.departure}T${t}`, b.id);
      db.run("UPDATE hotel_requests SET status = 'done', done_at = ? WHERE booking_id = ? AND kind = 'late_checkout' AND status IN ('open','in_progress')", now(), b.id);
      audit(db, ctx, 'late_checkout', 'booking', b.id, t); changed(ctx, 'booking', b.id);
      return F.getBooking(db, cid(ctx), b.id);
    });
    r.post('/api/hotel/bookings/:id/redeem-points', requirePerm('frontdesk'), (ctx) => {
      const b = F.getBooking(db, cid(ctx), ctx.params.id);
      const line = db.get("SELECT * FROM hotel_folio_lines WHERE id = ? AND booking_id = ? AND kind = 'room' AND voided = 0", ctx.body.line_id, b.id);
      if (!line) throw bad('line', 'Choisissez une nuit à offrir');
      const g = F.getGuest(db, cid(ctx), b.guest_id); const cost = line.amount;
      if (g.points < cost / 100) throw conflict('points', `Il faut ${Math.ceil(cost / 100)} points (le client en a ${g.points})`);
      db.tx(() => {
        db.run("UPDATE hotel_folio_lines SET voided = 1, void_reason = 'Nuit offerte (points fidélité)' WHERE id = ?", line.id);
        db.run('UPDATE hotel_guests SET points = points - ? WHERE partner_id = ?', Math.ceil(cost / 100), b.guest_id);
      });
      audit(db, ctx, 'redeem_points', 'booking', b.id, Math.ceil(cost / 100)); changed(ctx, 'folio', b.id);
      return F.folio(db, cid(ctx), b.id);
    });

    // Key cards
    r.post('/api/hotel/bookings/:id/keys', requirePerm('frontdesk'), async (ctx) => {
      const b = F.getBooking(db, cid(ctx), ctx.params.id);
      return ctx.json(await issueKey(db, bus, locks, ctx, b, settingsOf(db, cid(ctx)), ctx.body), 201);
    });
    r.post('/api/hotel/keys/:id/revoke', requirePerm('frontdesk'), async (ctx) => revokeKey(db, bus, locks, ctx, Number(ctx.params.id), ctx.body.lost ? 'lost' : 'revoked'));
    r.get('/api/hotel/keys/lookup', requirePerm('frontdesk', 'outlet'), (ctx) => {
      const k = stayForCard(db, cid(ctx), ctx.query.uid);
      const b = F.getBooking(db, cid(ctx), k.booking_id);
      return { booking_id: b.id, number: b.number, guest_name: b.guest_name, room_number: b.room_number, balance: b.balance, vip: b.vip };
    });
    r.get('/api/hotel/keys', requirePerm('frontdesk'), (ctx) => db.all(`SELECT k.*, r.number room_number, b.number booking_number, g.name guest_name, u.name issued_by_name FROM hotel_keys k JOIN hotel_rooms r ON r.id = k.room_id
      JOIN hotel_bookings b ON b.id = k.booking_id JOIN partners g ON g.id = b.guest_id LEFT JOIN users u ON u.id = k.issued_by WHERE k.company_id = ? ORDER BY k.id DESC LIMIT 300`, cid(ctx)));

    // ---------------- Outlets: orders ----------------
    r.get('/api/hotel/orders', requirePerm('outlet', 'frontdesk', 'reports'), (ctx) => SV.listOrders(db, cid(ctx), ctx.query));
    r.post('/api/hotel/orders', requirePerm('outlet', 'frontdesk'), (ctx) => ctx.json(SV.createOrder(db, bus, ctx, company(ctx), ctx.body), 201));
    r.put('/api/hotel/orders/:id/status', requirePerm('outlet', 'frontdesk'), (ctx) => SV.setOrderStatus(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body.status));
    r.post('/api/hotel/orders/:id/settle', requirePerm('outlet', 'frontdesk'), (ctx) => SV.settleOrder(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.get('/api/hotel/in-house', requirePerm('outlet', 'frontdesk', 'housekeeping'), (ctx) => db.all(`SELECT b.id, b.number, r.number room_number, g.name guest_name, hg.vip, hg.allergies FROM hotel_bookings b JOIN partners g ON g.id = b.guest_id
      LEFT JOIN hotel_rooms r ON r.id = b.room_id LEFT JOIN hotel_guests hg ON hg.partner_id = b.guest_id WHERE b.company_id = ? AND b.status = 'in_house' ORDER BY r.number`, cid(ctx)));

    // Spa & activities
    r.get('/api/hotel/appointments', requirePerm('outlet', 'frontdesk', 'read'), (ctx) => SV.listAppointments(db, cid(ctx), ctx.query));
    r.post('/api/hotel/appointments', requirePerm('outlet', 'frontdesk'), (ctx) => ctx.json(SV.createAppointment(db, bus, ctx, company(ctx), ctx.body), 201));
    r.put('/api/hotel/appointments/:id', requirePerm('outlet', 'frontdesk'), (ctx) => SV.updateAppointment(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));

    // Guest requests
    r.get('/api/hotel/requests', requirePerm('read'), (ctx) => SV.listRequests(db, cid(ctx), ctx.query));
    r.post('/api/hotel/requests', requirePerm('frontdesk', 'housekeeping', 'outlet'), (ctx) => {
      const stay = ctx.body.booking_id ? F.getBooking(db, cid(ctx), ctx.body.booking_id) : null;
      return ctx.json(SV.createRequest(db, bus, cid(ctx), ctx.body, { origin: 'staff', bookingId: stay?.id ?? null, roomId: stay?.room_id ?? (ctx.body.room_id || null), userId: ctx.user.id }), 201);
    });
    r.put('/api/hotel/requests/:id', requirePerm('frontdesk', 'housekeeping', 'outlet'), (ctx) => {
      const q = db.get('SELECT * FROM hotel_requests WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!q) throw notFound();
      const status = oneOf(ctx.body.status ?? q.status, ['open', 'in_progress', 'done', 'refused'], 'status');
      db.run('UPDATE hotel_requests SET status = ?, assigned_to = ?, done_at = ? WHERE id = ?', status, ctx.body.assigned_to === undefined ? (q.assigned_to ?? ctx.user.id) : (ctx.body.assigned_to || null), ['done', 'refused'].includes(status) ? now() : null, q.id);
      changed(ctx, 'request', q.id);
      return db.get('SELECT * FROM hotel_requests WHERE id = ?', q.id);
    });

    // ---------------- Housekeeping, maintenance, lost & found ----------------
    r.get('/api/hotel/rooms/board', requirePerm('read'), (ctx) => SV.roomBoard(db, cid(ctx)));
    r.put('/api/hotel/rooms/:id/status', requirePerm('housekeeping', 'frontdesk'), (ctx) => { SV.setRoomStatus(db, bus, ctx, room(ctx, ctx.params.id), ctx.body); return { ok: true }; });
    r.post('/api/hotel/rooms/:id/minibar', requirePerm('housekeeping', 'outlet', 'frontdesk'), (ctx) => ctx.json(SV.minibarCheck(db, bus, ctx, company(ctx), room(ctx, ctx.params.id), ctx.body.lines || []), 201));
    r.get('/api/hotel/maintenance', requirePerm('read'), (ctx) => db.all(`SELECT m.*, r.number room_number, u.name created_by_name FROM hotel_maintenance m LEFT JOIN hotel_rooms r ON r.id = m.room_id LEFT JOIN users u ON u.id = m.created_by
      WHERE m.company_id = ? ${ctx.query.all ? '' : "AND (m.status <> 'done' OR m.done_at >= date('now','-7 day'))"} ORDER BY m.status = 'done', CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, m.id DESC LIMIT 300`, cid(ctx)));
    r.post('/api/hotel/maintenance', requirePerm('housekeeping', 'frontdesk', 'outlet'), (ctx) => {
      const b = ctx.body; if (b.room_id) room(ctx, b.room_id);
      const title = str(b.title, 200); if (!title) throw bad('title', 'Décrivez le problème');
      const res = db.run('INSERT INTO hotel_maintenance (company_id, room_id, place, title, priority, blocks_room, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', cid(ctx), b.room_id || null, str(b.place, 80), title,
        oneOf(b.priority, ['low', 'normal', 'high', 'urgent'], 'priority', 'normal'), b.blocks_room ? 1 : 0, ctx.user.id, now());
      if (b.blocks_room && b.room_id && isManager(ctx)) SV.setRoomStatus(db, bus, ctx, room(ctx, b.room_id), { out_of_order: true, ooo_reason: title });
      changed(ctx, 'maintenance');
      return ctx.json(db.get('SELECT * FROM hotel_maintenance WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/hotel/maintenance/:id', requirePerm('housekeeping', 'frontdesk', 'settings'), (ctx) => {
      const m = db.get('SELECT * FROM hotel_maintenance WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!m) throw notFound();
      const status = oneOf(ctx.body.status ?? m.status, ['open', 'in_progress', 'done'], 'status');
      db.run('UPDATE hotel_maintenance SET status = ?, cost = ?, done_at = ? WHERE id = ?', status, int(ctx.body.cost ?? m.cost, 'cost', { min: 0, def: 0 }), status === 'done' ? now() : null, m.id);
      if (status === 'done' && m.room_id && m.blocks_room) {
        const other = db.get("SELECT 1 FROM hotel_maintenance WHERE room_id = ? AND blocks_room = 1 AND status <> 'done' AND id <> ?", m.room_id, m.id);
        if (!other) db.run("UPDATE hotel_rooms SET out_of_order = 0, ooo_reason = '', hk_status = 'dirty' WHERE id = ? AND out_of_order = 1", m.room_id);
      }
      changed(ctx, 'maintenance');
      return db.get('SELECT * FROM hotel_maintenance WHERE id = ?', m.id);
    });
    r.get('/api/hotel/lost-found', requirePerm('read'), (ctx) => db.all(`SELECT l.*, r.number room_number, g.name guest_name FROM hotel_lost_found l LEFT JOIN hotel_rooms r ON r.id = l.room_id LEFT JOIN partners g ON g.id = l.guest_id
      WHERE l.company_id = ? ORDER BY l.status = 'stored' DESC, l.id DESC LIMIT 300`, cid(ctx)));
    r.post('/api/hotel/lost-found', requirePerm('housekeeping', 'frontdesk', 'outlet'), (ctx) => {
      const b = ctx.body; const item = str(b.item, 200); if (!item) throw bad('item', 'Décrivez l\'objet');
      let guest = null;
      if (b.room_id) { room(ctx, b.room_id); guest = db.get("SELECT guest_id FROM hotel_bookings WHERE room_id = ? AND status IN ('in_house','checked_out') ORDER BY COALESCE(checked_out_at, '9999') DESC, id DESC LIMIT 1", b.room_id)?.guest_id ?? null; }
      const res = db.run('INSERT INTO hotel_lost_found (company_id, room_id, place, item, found_by, guest_id, note, found_at) VALUES (?,?,?,?,?,?,?,?)', cid(ctx), b.room_id || null, str(b.place, 80), item, ctx.user.name, guest, str(b.note, 300), now());
      changed(ctx, 'lost_found');
      return ctx.json(db.get('SELECT * FROM hotel_lost_found WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/hotel/lost-found/:id', requirePerm('housekeeping', 'frontdesk'), (ctx) => {
      const l = db.get('SELECT * FROM hotel_lost_found WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!l) throw notFound();
      const status = oneOf(ctx.body.status, ['stored', 'returned', 'disposed'], 'status');
      db.run('UPDATE hotel_lost_found SET status = ?, note = ?, closed_at = ? WHERE id = ?', status, str(ctx.body.note ?? l.note, 300), status === 'stored' ? null : now(), l.id);
      return db.get('SELECT * FROM hotel_lost_found WHERE id = ?', l.id);
    });

    // ---------------- Night audit ----------------
    r.get('/api/hotel/night-audit', requirePerm('frontdesk', 'reports'), (ctx) => {
      const c = cid(ctx); const s = settingsOf(db, c); const d = s.business_date;
      return {
        business_date: d, can_run: d <= today(), audit_hour: s.audit_hour,
        pending_arrivals: F.listBookings(db, c, { status: 'tentative,confirmed', to: d }).filter((b) => b.arrival <= d),
        overstays: F.listBookings(db, c, { status: 'in_house' }).filter((b) => b.departure <= d),
        in_house: db.get("SELECT COUNT(*) n FROM hotel_bookings WHERE company_id = ? AND status = 'in_house'", c).n,
        undeclared: SV.roomBoard(db, c).rooms.filter((x) => x.undeclared).map((x) => x.number),
        open_orders: db.get("SELECT COUNT(*) n FROM hotel_orders WHERE company_id = ? AND status IN ('new','preparing','ready','delivered') AND settlement = ''", c).n,
        history: db.all('SELECT d.*, u.name user_name FROM hotel_daily d LEFT JOIN users u ON u.id = d.by_user WHERE d.company_id = ? ORDER BY d.date DESC LIMIT 60', c),
      };
    });
    r.post('/api/hotel/night-audit', requirePerm('frontdesk', 'settings'), (ctx) => {
      if (!isManager(ctx) && ctx.user.role !== 'receptionist') throw bad('role', 'Réservé à la réception de nuit ou au responsable');
      const res = runNightAudit(db, bus, cid(ctx), ctx.user.id);
      audit(db, ctx, 'night_audit', 'hotel', null, res.date);
      return res;
    });

    // ---------------- Reports ----------------
    r.get('/api/hotel/dashboard', requirePerm('read'), (ctx) => RP.dashboard(db, cid(ctx)));
    r.get('/api/hotel/reports/occupancy', requirePerm('reports'), (ctx) => {
      const { from, to } = range(ctx.query);
      const d = RP.occupancy(db, cid(ctx), from, to);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `occupation-${from}-${to}.xlsx`, [{ name: 'Occupation', title: `${company(ctx).name} – Occupation du ${from} au ${to}`, columns: [
        { header: 'Date', key: 'date', type: 'date' }, { header: 'Chambres dispo', key: 'rooms', type: 'number' }, { header: 'Hors service', key: 'ooo', type: 'number' }, { header: 'Vendues', key: 'sold', type: 'number' },
        { header: 'Occupation %', key: 'occupancy', type: 'number' }, { header: 'Prix moyen (ADR)', key: 'adr', type: 'money' }, { header: 'RevPAR', key: 'revpar', type: 'money' }, { header: 'CA hébergement HT', key: 'room_revenue', type: 'money' },
        { header: 'Autres CA HT', key: 'other_revenue', type: 'money' }, { header: 'Encaissé', key: 'payments', type: 'money' }, { header: 'Clients', key: 'guests', type: 'number' }, { header: 'No-shows', key: 'no_shows', type: 'number' }], rows: d.days }]);
      return d;
    });
    r.get('/api/hotel/reports/police', requirePerm('frontdesk', 'reports'), (ctx) => {
      const { from, to } = range(ctx.query, 7);
      const rows = RP.policeRegister(db, cid(ctx), from, to);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `registre-police-${from}-${to}.xlsx`, [{ name: 'Registre', title: `${company(ctx).name} – Registre des voyageurs`, columns: [
        { header: 'Arrivée', key: 'checked_in_at', width: 18 }, { header: 'Chambre', key: 'room_number', width: 8 }, { header: 'Nom', key: 'name', width: 28 }, { header: 'Nationalité', key: 'nationality', width: 14 },
        { header: 'Né(e) le', key: 'birth_date', width: 12 }, { header: 'À', key: 'birth_place', width: 14 }, { header: 'Profession', key: 'profession', width: 16 }, { header: 'Pièce', key: 'id_type', width: 10 },
        { header: 'Numéro', key: 'id_number', width: 16 }, { header: 'Venant de', key: 'coming_from', width: 14 }, { header: 'Allant à', key: 'going_to', width: 14 }, { header: 'Départ', key: 'departure', type: 'date' }], rows }]);
      return { from, to, rows };
    });
    r.get('/api/hotel/reports/cashier', requirePerm('reports', 'frontdesk'), (ctx) => { const { from, to } = range(ctx.query, 0); return { from, to, rows: RP.cashierReport(db, cid(ctx), from, to) }; });

    // ---------------- Channel sync (iCal) ----------------
    r.post('/api/hotel/ical', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const url = str(b.url, 800);
      if (!/^https:\/\//.test(url)) throw bad('url', 'Collez le lien iCal https:// fourni par le site');
      if (!db.get('SELECT id FROM hotel_room_types WHERE id = ? AND company_id = ?', b.room_type_id, cid(ctx))) throw bad('type', 'Type inconnu');
      const res = db.run('INSERT INTO hotel_ical (company_id, room_type_id, channel, url) VALUES (?,?,?,?)', cid(ctx), b.room_type_id, oneOf(b.channel, ['booking', 'airbnb', 'expedia', 'other'], 'channel', 'other'), url);
      return ctx.json(db.get('SELECT * FROM hotel_ical WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.del('/api/hotel/ical/:id', requirePerm('settings'), (ctx) => { db.run('DELETE FROM hotel_ical WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); return { ok: true }; });
    r.post('/api/hotel/ical/:id/sync', requirePerm('settings', 'frontdesk'), async (ctx) => syncIcal(db, bus, cid(ctx), globalThis.fetch, Number(ctx.params.id)));

    // ---------------- Printing ----------------
    const sOf = (ctx) => settingsOf(db, cid(ctx));
    r.get('/print/hotel/registration/:id', requirePerm('frontdesk', 'read'), (ctx) => ctx.send(PR.registrationCard(company(ctx), sOf(ctx), F.folio(db, cid(ctx), ctx.params.id), ctx.query.print === '1')));
    r.get('/print/hotel/folio/:id', requirePerm('frontdesk', 'read'), (ctx) => ctx.send(PR.folioPage(company(ctx), sOf(ctx), F.folio(db, cid(ctx), ctx.params.id), ctx.query.print === '1')));
    r.get('/print/hotel/confirmation/:id', requirePerm('frontdesk', 'read'), (ctx) => {
      const f = F.folio(db, cid(ctx), ctx.params.id); const c = company(ctx); const b = f.booking;
      const q = quoteStay(db, c, sOf(ctx), { type: db.get('SELECT * FROM hotel_room_types WHERE id = ?', b.room_type_id), plan: b.rate_plan_id ? db.get('SELECT * FROM hotel_rate_plans WHERE id = ?', b.rate_plan_id) : null, arrival: b.arrival, departure: b.departure, adults: b.adults, kind: b.kind, fixed: b.rate });
      ctx.send(PR.confirmationPage(c, sOf(ctx), f, q, `${baseUrl(ctx, env)}/g/${b.portal_token}`, ctx.query.print === '1'));
    });
    r.get('/print/hotel/police', requirePerm('frontdesk', 'reports'), (ctx) => { const { from, to } = range(ctx.query, 0); ctx.send(PR.policeRegisterPage(company(ctx), sOf(ctx), RP.policeRegister(db, cid(ctx), from, to), from, to, ctx.query.print === '1')); });
    r.get('/print/hotel/room-qr', requirePerm('settings'), (ctx) => {
      const ids = String(ctx.query.ids || '').split(',').map(Number).filter(Boolean);
      const rooms = db.all(`SELECT * FROM hotel_rooms WHERE company_id = ? AND active = 1 ${ids.length ? `AND id IN (${ids.join(',')})` : ''} ORDER BY number`, cid(ctx));
      ctx.send(PR.roomQrPage(company(ctx), sOf(ctx), rooms, baseUrl(ctx, env), ctx.query.print === '1'));
    });
  },

  /** Night audit at audit_hour, online Mobile Money payments, channel sync. */
  jobs({ db, bus, momo }) {
    const audit = () => { try { autoAudit(db, bus); } catch (e) { console.warn('night audit', e.message); } };
    const pay = async () => {
      for (const m of db.all("SELECT * FROM hotel_momo WHERE status = 'pending' LIMIT 50")) {
        try { await F.momoStatus(db, bus, momo, { user: { id: null, company_id: m.company_id, name: 'Paiement Mobile Money', role: 'owner' } }, db.get('SELECT * FROM companies WHERE id = ?', m.company_id), m.id); } catch (e) { console.warn('hotel momo', e.message); }
      }
    };
    const ical = async () => { for (const c of db.all('SELECT DISTINCT company_id FROM hotel_ical')) { try { await syncIcal(db, bus, c.company_id); } catch (e) { console.warn('ical', e.message); } } };
    const t = setTimeout(audit, 15_000);
    const i1 = setInterval(audit, 15 * 60_000);
    const i2 = setInterval(pay, 15_000);
    const i3 = setInterval(ical, 30 * 60_000);
    return () => { clearTimeout(t); clearInterval(i1); clearInterval(i2); clearInterval(i3); };
  },
};
