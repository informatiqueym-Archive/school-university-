// Teknons Resto: restaurants, bars, lounges, cafés and dark kitchens. Live
// floor plan, waiter phone app with coursing, kitchen and bar screens, table QR
// (menu, ordering, waiter call, split bill and Mobile Money payment), takeaway
// and delivery, reservations and waitlist, recipes and ingredient stock,
// loyalty, cash-up per waiter, menu engineering and forecasts. Teknons Compta
// runs underneath: every paid check is in the SYSCOHADA books at once.
import { requirePerm, requireUser } from '../../core/auth.js';
import { bad, notFound, forbidden } from '../../core/errors.js';
import { str, int, oneOf } from '../../core/validate.js';
import { audit } from '../../core/alerts.js';
import { today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { sendXlsx } from '../../core/xlsx.js';
import { baseUrl } from '../accounting/paylink.js';
import { migrateResto, seedCompanyResto, STATION_KINDS, ALLERGENS } from './schema.js';
import * as O from './orders.js';
import * as FL from './floor.js';
import * as ST from './stock.js';
import * as RP from './reports.js';
import * as PR from './print.js';
import { registerPortal } from './portal.js';

export default {
  id: 'restaurant',
  requires: ['accounting'],
  name: { fr: 'Teknons Resto', en: 'Teknons Resto' },
  brand: { name: 'Teknons Resto', short: 'Resto', description: 'Restaurant, bar et lounge : plan de salle, commande par QR, écrans cuisine et bar, paiement à table MTN MoMo / Orange Money, stock par recettes, réservations, livraison.', navy: '#3A0F1C', accent: '#C2681E' },
  migrate: migrateResto,
  onCompanyCreated: seedCompanyResto,

  routes(r, { db, bus, momo, env }) {
    const cid = (ctx) => ctx.user.company_id;
    const company = (ctx) => db.get('SELECT * FROM companies WHERE id = ?', cid(ctx));
    const changed = (ctx, entity, id) => bus.emit(cid(ctx), 'change', { entity, id });
    const svc = requirePerm('service', 'pos');
    const cashier = requirePerm('service', 'pos', 'treasury');
    const kitchen = requirePerm('kitchen', 'service');
    const stockPerm = requirePerm('stock', 'purchases');
    const owns = (ctx, o) => { if (ctx.user.role === 'server' && o.server_id && o.server_id !== ctx.user.id && !ctx.body?.take_over) return false; return true; };

    registerPortal(r, { db, bus, momo });

    // ---------------- Reference data ----------------
    r.get('/api/resto/meta', requireUser, (ctx) => {
      const c = cid(ctx);
      seedCompanyResto(db, c);
      return {
        settings: { ...O.publicSettings(O.settingsOf(db, c)), happy_now: O.happyHourActive(O.settingsOf(db, c)) },
        areas: db.all('SELECT * FROM resto_areas WHERE company_id = ? ORDER BY position, name', c),
        tables: db.all('SELECT t.*, a.name area_name FROM resto_tables t JOIN resto_areas a ON a.id = t.area_id WHERE t.company_id = ? ORDER BY a.position, t.label', c),
        stations: db.all('SELECT * FROM resto_stations WHERE company_id = ? ORDER BY position, id', c),
        station_kinds: STATION_KINDS, allergens: ALLERGENS, kinds: O.KINDS,
        pay: Object.fromEntries(Object.entries(O.PAY).map(([k, v]) => [k, { fr: v.fr, en: v.en }])),
        call_kinds: FL.CALL_KINDS, public_url: baseUrl(ctx, env),
        momo: { mode: momo.mode, mtn_momo: momo.configured('mtn_momo'), orange_money: momo.configured('orange_money') },
        staff: db.all("SELECT id, name, role FROM users WHERE company_id = ? AND active = 1 AND role NOT IN ('viewer','accountant') ORDER BY name", c),
        session: O.openSessionFor(db, ctx.user) || null,
      };
    });

    r.put('/api/resto/settings', requirePerm('settings'), (ctx) => {
      const b = ctx.body; const c = cid(ctx); const s = O.settingsOf(db, c);
      const time = (v, d, allowEmpty) => { const t = str(v ?? d, 5); if (allowEmpty && !t) return ''; if (!/^\d{2}:\d{2}$/.test(t)) throw bad('time', 'Heure invalide (HH:MM)'); return t; };
      const flag = (k) => (b[k] === undefined ? s[k] : (b[k] ? 1 : 0));
      const n = (k, max = 1e9) => Math.min(max, Number(b[k] === undefined || b[k] === '' ? s[k] : b[k]) || 0);
      db.run(`UPDATE resto_settings SET service_pct = ?, tip_suggestions = ?, qr_ordering = ?, qr_pay = ?, qr_auto_send = ?, online_orders = ?, online_reservations = ?, delivery_fee = ?, min_delivery = ?,
          points_per_1000 = ?, point_value = ?, max_discount_pct = ?, prep_target_min = ?, reservation_minutes = ?, happy_hour_from = ?, happy_hour_to = ?, happy_hour_pct = ?, open_time = ?, close_time = ?,
          receipt_footer = ?, welcome_text = ?, wifi_name = ?, wifi_password = ?, cuisine = ? WHERE company_id = ?`,
      Math.max(0, n('service_pct', 30)), str(b.tip_suggestions ?? s.tip_suggestions, 40), flag('qr_ordering'), flag('qr_pay'), flag('qr_auto_send'), flag('online_orders'), flag('online_reservations'),
      Math.max(0, Math.round(n('delivery_fee'))), Math.max(0, Math.round(n('min_delivery'))), Math.max(0, Math.round(n('points_per_1000', 100))), Math.max(0, Math.round(n('point_value', 1000))),
      Math.max(0, n('max_discount_pct', 100)), Math.max(1, Math.round(n('prep_target_min', 180))), Math.max(30, Math.round(n('reservation_minutes', 600))),
      time(b.happy_hour_from, s.happy_hour_from, true), time(b.happy_hour_to, s.happy_hour_to, true), Math.max(0, n('happy_hour_pct', 90)), time(b.open_time, s.open_time), time(b.close_time, s.close_time),
      str(b.receipt_footer ?? s.receipt_footer, 300), str(b.welcome_text ?? s.welcome_text, 1500), str(b.wifi_name ?? s.wifi_name, 60), str(b.wifi_password ?? s.wifi_password, 60), str(b.cuisine ?? s.cuisine, 120), c);
      if (b.manager_pin) O.setManagerPin(db, c, b.manager_pin);
      audit(db, ctx, 'update', 'resto_settings', c);
      changed(ctx, 'resto_settings');
      return { ok: true };
    });

    // Areas, tables, stations
    r.post('/api/resto/areas', requirePerm('settings'), (ctx) => ctx.json(FL.saveArea(db, cid(ctx), ctx.body), 201));
    r.put('/api/resto/areas/:id', requirePerm('settings'), (ctx) => FL.saveArea(db, cid(ctx), ctx.body, Number(ctx.params.id)));
    r.post('/api/resto/tables', requirePerm('settings'), (ctx) => {
      const b = ctx.body;
      if (b.from && b.to) {
        const from = int(b.from, 'from', { min: 1 }), to = int(b.to, 'to', { min: from });
        if (to - from > 100) throw bad('range', '100 tables maximum à la fois');
        const made = db.tx(() => Array.from({ length: to - from + 1 }, (_, i) => FL.saveTable(db, cid(ctx), { ...b, label: `${str(b.prefix, 4)}${from + i}`, x: ((i % 6) * 16) + 4, y: Math.floor(i / 6) * 22 + 6 })));
        changed(ctx, 'resto_table');
        return ctx.json({ created: made.length }, 201);
      }
      const t = FL.saveTable(db, cid(ctx), b); changed(ctx, 'resto_table'); return ctx.json(t, 201);
    });
    r.put('/api/resto/tables/:id', requirePerm('settings'), (ctx) => { const t = FL.saveTable(db, cid(ctx), ctx.body, Number(ctx.params.id)); changed(ctx, 'resto_table'); return t; });
    r.put('/api/resto/layout', requirePerm('settings'), (ctx) => {
      const list = Array.isArray(ctx.body.tables) ? ctx.body.tables : [];
      db.tx(() => { for (const t of list) db.run('UPDATE resto_tables SET x = ?, y = ? WHERE id = ? AND company_id = ?', Math.max(0, Math.min(100, Number(t.x) || 0)), Math.max(0, Math.min(100, Number(t.y) || 0)), t.id, cid(ctx)); });
      changed(ctx, 'resto_table');
      return { ok: true };
    });
    r.post('/api/resto/stations', requirePerm('settings'), (ctx) => {
      const name = str(ctx.body.name, 40); if (!name) throw bad('name', 'Nom obligatoire');
      const res = db.run('INSERT INTO resto_stations (company_id, name, kind, position) VALUES (?,?,?,?)', cid(ctx), name, oneOf(ctx.body.kind, Object.keys(STATION_KINDS), 'kind', 'kitchen'), int(ctx.body.position, 'position', { def: 0 }));
      return ctx.json(db.get('SELECT * FROM resto_stations WHERE id = ?', res.lastInsertRowid), 201);
    });
    r.put('/api/resto/stations/:id', requirePerm('settings'), (ctx) => {
      const s = db.get('SELECT * FROM resto_stations WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!s) throw notFound();
      db.run('UPDATE resto_stations SET name = ?, kind = ?, active = ? WHERE id = ?', str(ctx.body.name ?? s.name, 40), oneOf(ctx.body.kind ?? s.kind, Object.keys(STATION_KINDS), 'kind'), ctx.body.active === undefined ? s.active : (ctx.body.active ? 1 : 0), s.id);
      return db.get('SELECT * FROM resto_stations WHERE id = ?', s.id);
    });
    r.get('/api/resto/qr', requirePerm('settings'), (ctx) => {
      const tables = db.all('SELECT * FROM resto_tables WHERE company_id = ? AND active = 1 ORDER BY label', cid(ctx));
      ctx.send(PR.renderTableQr(company(ctx), ctx.query.table ? tables.filter((t) => String(t.id) === ctx.query.table) : tables, baseUrl(ctx, env), { autoPrint: ctx.query.print === '1' }));
    });

    // ---------------- Menu ----------------
    r.get('/api/resto/menu', requireUser, (ctx) => O.menu(db, cid(ctx), { all: !!ctx.query.all }));
    r.post('/api/resto/categories', requirePerm('settings'), (ctx) => { const x = O.saveCategory(db, cid(ctx), ctx.body); changed(ctx, 'resto_menu'); return ctx.json(x, 201); });
    r.put('/api/resto/categories/:id', requirePerm('settings'), (ctx) => { const x = O.saveCategory(db, cid(ctx), ctx.body, Number(ctx.params.id)); changed(ctx, 'resto_menu'); return x; });
    r.get('/api/resto/items/:id', requireUser, (ctx) => O.itemDetail(db, cid(ctx), Number(ctx.params.id)));
    r.post('/api/resto/items', requirePerm('settings'), (ctx) => { const x = O.saveItem(db, company(ctx), ctx.body); changed(ctx, 'resto_menu'); return ctx.json(x, 201); });
    r.put('/api/resto/items/:id', requirePerm('settings'), (ctx) => { const x = O.saveItem(db, company(ctx), ctx.body, Number(ctx.params.id)); changed(ctx, 'resto_menu'); return x; });
    // "86": a dish runs out during service. Waiters and the kitchen can switch it.
    r.post('/api/resto/items/:id/availability', requirePerm('service', 'kitchen', 'settings'), (ctx) => {
      const it = db.get('SELECT i.*, p.name FROM resto_items i JOIN products p ON p.id = i.product_id WHERE i.product_id = ? AND i.company_id = ?', ctx.params.id, cid(ctx)); if (!it) throw notFound();
      db.run('UPDATE resto_items SET available = ? WHERE product_id = ?', ctx.body.available ? 1 : 0, it.product_id);
      audit(db, ctx, ctx.body.available ? 'available' : 'sold_out', 'resto_item', it.product_id, it.name);
      bus.emit(cid(ctx), 'call', { kind: 'sold_out', title: ctx.body.available ? `${it.name} de nouveau disponible` : `${it.name} épuisé (86)` });
      changed(ctx, 'resto_menu');
      return { ok: true };
    });

    // ---------------- Floor and checks ----------------
    r.get('/api/resto/floor', requireUser, (ctx) => FL.floor(db, cid(ctx)));
    r.get('/api/resto/orders', requireUser, (ctx) => O.listOrders(db, cid(ctx), ctx.query));
    r.get('/api/resto/orders/:id', requireUser, (ctx) => O.getOrder(db, cid(ctx), Number(ctx.params.id)));
    r.post('/api/resto/orders', svc, (ctx) => ctx.json(O.openOrder(db, bus, ctx, company(ctx), ctx.body), 201));
    const mine = (ctx) => {
      const o = O.getOrder(db, cid(ctx), Number(ctx.params.id));
      if (!owns(ctx, o)) throw forbidden(`Cette table est servie par ${o.server_name}. Demandez-lui ou à un responsable.`);
      return o;
    };
    r.put('/api/resto/orders/:id', svc, (ctx) => { mine(ctx); return O.updateOrder(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body); });
    r.post('/api/resto/orders/:id/lines', svc, (ctx) => { mine(ctx); return ctx.json(O.addLines(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body), 201); });
    r.put('/api/resto/orders/:id/lines/:line', svc, (ctx) => { mine(ctx); return O.updateLine(db, bus, ctx, company(ctx), Number(ctx.params.id), Number(ctx.params.line), ctx.body); });
    r.post('/api/resto/orders/:id/lines/:line/void', svc, (ctx) => { mine(ctx); return O.voidLine(db, bus, ctx, company(ctx), Number(ctx.params.id), Number(ctx.params.line), ctx.body); });
    r.post('/api/resto/orders/:id/send', svc, (ctx) => { mine(ctx); return O.sendLines(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body); });
    r.post('/api/resto/orders/:id/transfer', svc, (ctx) => { mine(ctx); return O.transferLines(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body); });
    r.post('/api/resto/orders/:id/merge', svc, (ctx) => { mine(ctx); return O.mergeOrders(db, bus, ctx, company(ctx), Number(ctx.params.id), Number(ctx.body.other_id)); });
    r.post('/api/resto/orders/:id/void', svc, (ctx) => { mine(ctx); return O.voidOrder(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body); });
    r.post('/api/resto/orders/:id/served', svc, (ctx) => {
      const o = mine(ctx);
      const ids = o.lines.filter((l) => l.status === 'ready' && (!ctx.body.line_ids || ctx.body.line_ids.includes(l.id))).map((l) => l.id);
      if (ids.length) O.setLineStatus(db, bus, ctx, cid(ctx), { line_ids: ids, status: 'served' });
      return O.getOrder(db, cid(ctx), o.id);
    });
    r.post('/api/resto/orders/:id/pay', cashier, (ctx) => ctx.json(O.pay(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body), 201));
    r.post('/api/resto/orders/:id/momo', cashier, async (ctx) => O.momoRequest(db, momo, ctx, company(ctx), Number(ctx.params.id), ctx.body));
    r.get('/api/resto/momo/:id', cashier, async (ctx) => O.momoStatus(db, bus, momo, ctx, company(ctx), Number(ctx.params.id)));
    r.get('/api/resto/orders/:id/bill', requireUser, (ctx) => {
      const o = O.getOrder(db, cid(ctx), Number(ctx.params.id));
      if (o.status === 'open') db.run('UPDATE resto_orders SET bill_printed = 1 WHERE id = ?', o.id);
      bus.emit(cid(ctx), 'change', { entity: 'resto_order', id: o.id });
      const s = O.settingsOf(db, cid(ctx));
      ctx.send(PR.renderBill(company(ctx), o, s, s.qr_pay ? `${baseUrl(ctx, env)}/o/${o.token}` : null, { autoPrint: ctx.query.print === '1' }));
    });
    r.get('/api/resto/orders/:id/receipt', requireUser, (ctx) => {
      const o = O.getOrder(db, cid(ctx), Number(ctx.params.id));
      ctx.send(PR.renderReceipt(company(ctx), o, O.settingsOf(db, cid(ctx)), { autoPrint: ctx.query.print === '1', reviewUrl: `${baseUrl(ctx, env)}/o/${o.token}` }));
    });

    // ---------------- Kitchen and bar ----------------
    r.get('/api/resto/kitchen', kitchen, (ctx) => O.kitchenTickets(db, cid(ctx), ctx.query));
    r.post('/api/resto/kitchen/bump', kitchen, (ctx) => O.setLineStatus(db, bus, ctx, cid(ctx), ctx.body));
    r.get('/api/resto/kitchen/ticket', kitchen, (ctx) => {
      const t = O.kitchenTickets(db, cid(ctx), { station_id: ctx.query.station_id }).tickets.find((x) => x.key === ctx.query.key);
      if (!t) throw notFound('Bon introuvable');
      ctx.send(PR.renderTicket(company(ctx), t, { autoPrint: ctx.query.print === '1' }));
    });

    // ---------------- Calls ----------------
    r.get('/api/resto/calls', requireUser, (ctx) => db.all("SELECT c.*, t.label table_label FROM resto_calls c LEFT JOIN resto_tables t ON t.id = c.table_id WHERE c.company_id = ? AND c.status = 'open' ORDER BY c.id", cid(ctx)));
    r.post('/api/resto/calls/:id/done', svc, (ctx) => FL.closeCall(db, bus, ctx, Number(ctx.params.id)));

    // ---------------- Cash sessions ----------------
    r.get('/api/resto/sessions', cashier, (ctx) => db.all(`SELECT s.*, u.name user_name FROM resto_sessions s JOIN users u ON u.id = s.user_id WHERE s.company_id = ? ${O.MANAGERS.includes(ctx.user.role) || can(ctx.user, 'treasury') ? '' : `AND s.user_id = ${Number(ctx.user.id)}`} ORDER BY s.id DESC LIMIT 100`, cid(ctx)));
    r.get('/api/resto/sessions/current', cashier, (ctx) => { const s = O.openSessionFor(db, ctx.user); return s ? O.sessionSummary(db, s.id) : { session: null }; });
    r.get('/api/resto/sessions/:id', cashier, (ctx) => {
      const s = db.get('SELECT * FROM resto_sessions WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx)); if (!s) throw notFound();
      if (s.user_id !== ctx.user.id && !O.MANAGERS.includes(ctx.user.role) && !can(ctx.user, 'treasury')) throw forbidden();
      return O.sessionSummary(db, s.id);
    });
    r.post('/api/resto/sessions', cashier, (ctx) => ctx.json(O.openSession(db, bus, ctx, ctx.body), 201));
    r.post('/api/resto/sessions/:id/close', cashier, (ctx) => O.closeSession(db, bus, ctx, Number(ctx.params.id), ctx.body));
    r.post('/api/resto/cash-moves', cashier, (ctx) => ctx.json(O.cashMove(db, bus, ctx, ctx.body), 201));

    // ---------------- Reservations ----------------
    r.get('/api/resto/reservations', requireUser, (ctx) => FL.listReservations(db, cid(ctx), ctx.query));
    r.get('/api/resto/free-tables', requireUser, (ctx) => FL.freeTables(db, cid(ctx), ctx.query.date || today(), str(ctx.query.time, 5) || '20:00', int(ctx.query.covers, 'covers', { min: 1, def: 1 }), Number(ctx.query.except) || 0));
    r.post('/api/resto/reservations', svc, (ctx) => ctx.json(FL.createReservation(db, bus, ctx, cid(ctx), ctx.body), 201));
    r.put('/api/resto/reservations/:id', svc, (ctx) => FL.updateReservation(db, bus, ctx, company(ctx), Number(ctx.params.id), ctx.body));

    // ---------------- Customers (loyalty) ----------------
    r.get('/api/resto/customers', requireUser, (ctx) => {
      const q = `%${str(ctx.query.q)}%`;
      return db.all(`SELECT p.id, p.name, p.phone, p.email, c.points, c.visits, c.spent, c.last_visit, c.birthday, c.allergies, c.preferences, c.vip FROM partners p JOIN resto_customers c ON c.partner_id = p.id
        WHERE p.company_id = ? AND (p.name LIKE ? OR p.phone LIKE ?) ORDER BY ${ctx.query.sort === 'recent' ? 'c.last_visit DESC' : 'c.spent DESC'} LIMIT 300`, cid(ctx), q, q);
    });
    r.post('/api/resto/customers', svc, (ctx) => {
      const b = ctx.body;
      const name = str(b.name, 100); if (!name) throw bad('name', 'Nom obligatoire');
      const id = b.phone ? O.customerByPhone(db, cid(ctx), name, b.phone) : Number(db.run("INSERT INTO partners (company_id, kind, name, created_at) VALUES (?, 'client', ?, datetime('now'))", cid(ctx), name).lastInsertRowid);
      db.run('INSERT OR IGNORE INTO resto_customers (partner_id, company_id) VALUES (?,?)', id, cid(ctx));
      db.run('UPDATE resto_customers SET birthday = ?, allergies = ?, preferences = ?, vip = ? WHERE partner_id = ?', str(b.birthday, 10), str(b.allergies, 200), str(b.preferences, 300), b.vip ? 1 : 0, id);
      return ctx.json(O.customerOf(db, cid(ctx), id), 201);
    });
    r.put('/api/resto/customers/:id', svc, (ctx) => {
      const c = O.customerOf(db, cid(ctx), Number(ctx.params.id)); const b = ctx.body;
      db.run('UPDATE resto_customers SET birthday = ?, allergies = ?, preferences = ?, vip = ? WHERE partner_id = ?', str(b.birthday ?? c.birthday, 10), str(b.allergies ?? c.allergies, 200), str(b.preferences ?? c.preferences, 300), b.vip === undefined ? c.vip : (b.vip ? 1 : 0), c.partner_id);
      if (b.name || b.phone) db.run('UPDATE partners SET name = ?, phone = ? WHERE id = ?', str(b.name ?? c.name, 100), str(b.phone ?? c.phone, 30), c.partner_id);
      return O.customerOf(db, cid(ctx), c.partner_id);
    });

    // ---------------- Stock ----------------
    r.get('/api/resto/ingredients', requireUser, (ctx) => ST.listIngredients(db, cid(ctx), ctx.query));
    r.post('/api/resto/ingredients', stockPerm, (ctx) => ctx.json(ST.saveIngredient(db, cid(ctx), ctx.body), 201));
    r.put('/api/resto/ingredients/:id', stockPerm, (ctx) => ST.saveIngredient(db, cid(ctx), ctx.body, Number(ctx.params.id)));
    r.post('/api/resto/stock/receive', stockPerm, (ctx) => ctx.json(ST.receive(db, bus, ctx, company(ctx), ctx.body), 201));
    r.post('/api/resto/stock/adjust', requirePerm('stock', 'purchases', 'kitchen'), (ctx) => ctx.json(ST.adjust(db, bus, ctx, cid(ctx), ctx.body), 201));
    r.post('/api/resto/stock/count', stockPerm, (ctx) => ST.count(db, bus, ctx, cid(ctx), ctx.body));
    r.get('/api/resto/stock/moves', requireUser, (ctx) => ST.moves(db, cid(ctx), ctx.query));
    r.get('/api/resto/stock/plan', requireUser, (ctx) => RP.purchasePlan(db, cid(ctx), Math.min(14, int(ctx.query.days, 'days', { min: 1, def: 3 }))));

    // ---------------- Reports ----------------
    r.get('/api/resto/dashboard', requireUser, (ctx) => RP.dashboard(db, cid(ctx)));
    r.get('/api/resto/reports/sales', requirePerm('reports'), (ctx) => {
      const data = RP.salesReport(db, cid(ctx), ctx.query);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `ventes-restaurant-${data.from}-${data.to}.xlsx`, [{ name: 'Ventes', columns: [
        { header: 'Date', key: 'd' }, { header: 'Additions', key: 'checks' }, { header: 'Couverts', key: 'covers' }, { header: 'Total TTC', key: 'total', type: 'money' }, { header: 'HT', key: 'net', type: 'money' },
        { header: 'TVA', key: 'vat', type: 'money' }, { header: 'Remises', key: 'discount', type: 'money' }, { header: 'Service', key: 'service', type: 'money' }, { header: 'Pourboires', key: 'tips', type: 'money' }, { header: 'Coût matière', key: 'cost', type: 'money' }], rows: data.days }]);
      return data;
    });
    r.get('/api/resto/reports/menu', requirePerm('reports'), (ctx) => {
      const data = RP.menuEngineering(db, cid(ctx), ctx.query);
      if (ctx.query.format === 'xlsx') return sendXlsx(ctx, `ingenierie-menu-${data.from}-${data.to}.xlsx`, [{ name: 'Menu', columns: [
        { header: 'Plat', key: 'name' }, { header: 'Famille', key: 'category' }, { header: 'Portions', key: 'qty' }, { header: 'CA TTC', key: 'revenue', type: 'money' }, { header: 'Coût', key: 'cost', type: 'money' },
        { header: 'Marge', key: 'margin', type: 'money' }, { header: 'Coût matière %', key: 'food_cost_pct' }, { header: 'Classe', key: 'class' }], rows: data.items }]);
      return data;
    });
    r.get('/api/resto/reports/staff', requirePerm('reports'), (ctx) => RP.staffReport(db, cid(ctx), ctx.query));
    r.get('/api/resto/reports/forecast', requireUser, (ctx) => ({ days: RP.forecast(db, cid(ctx), Math.min(14, int(ctx.query.days, 'days', { min: 1, def: 7 }))), insights: RP.insights(db, cid(ctx)) }));
    r.get('/api/resto/reports/z', requirePerm('reports', 'service', 'pos'), (ctx) => {
      const z = RP.zReport(db, cid(ctx), /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date || '') ? ctx.query.date : today());
      if (ctx.query.format === 'html') return ctx.send(PR.renderZ(company(ctx), z, { autoPrint: ctx.query.print === '1' }));
      return z;
    });
    r.get('/api/resto/feedback', requirePerm('reports'), (ctx) => db.all('SELECT f.*, o.number, o.table_id, t.label table_label, u.name server_name FROM resto_feedback f LEFT JOIN resto_orders o ON o.id = f.order_id LEFT JOIN resto_tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.server_id WHERE f.company_id = ? ORDER BY f.id DESC LIMIT 200', cid(ctx)));
  },

  jobs({ db, bus, momo }) {
    const pay = async () => {
      for (const m of db.all("SELECT * FROM resto_momo WHERE status IN ('pending','successful') AND created_at >= datetime('now','-1 day') LIMIT 50")) {
        try { await O.momoStatus(db, bus, momo, { user: { id: m.user_id, company_id: m.company_id, name: 'Mobile Money', role: 'owner' } }, db.get('SELECT * FROM companies WHERE id = ?', m.company_id), m.id); } catch (e) { console.warn('resto momo', e.message); }
      }
    };
    const noShows = () => { try { FL.markNoShows(db, bus); } catch (e) { console.warn('no-shows', e.message); } };
    const i1 = setInterval(pay, 10_000);
    const i2 = setInterval(noShows, 5 * 60_000);
    return () => { clearInterval(i1); clearInterval(i2); };
  },
};
