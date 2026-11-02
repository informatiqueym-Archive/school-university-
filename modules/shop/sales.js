// The till: cash sessions, sales, returns, voids, prepaid top-ups, cash in/out,
// credit repayments, Mobile Money prompts, and the accounting entry posted when
// a session closes (SYSCOHADA: 57/552/521/419 against 701 and 443).
import crypto from 'node:crypto';
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, int, oneOf } from '../../core/validate.js';
import { now, today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { raiseAlert, audit } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { hashPassword, verifyPassword } from '../../core/auth.js';
import { normalizePhone, PROVIDERS } from '../../core/payments/mobile-money.js';
import { DEFAULTS } from '../accounting/chart.js';
import { postEntry, nextNumber } from '../accounting/ledger.js';
import * as docs from '../accounting/documents.js';
import * as tr from '../accounting/treasury.js';
import { priceCart, pointsFor, topupBonus, round } from '../../public/js/shop-pricing.js';
import { moveStock, stockOf, qtyRound } from './stock.js';

export const PAY_METHODS = {
  cash: { account: DEFAULTS.cash, fr: 'Espèces', en: 'Cash', acc: 'cash' },
  mtn_momo: { account: DEFAULTS.mtn_momo, fr: 'MTN MoMo', en: 'MTN MoMo', acc: 'mtn_momo' },
  orange_money: { account: DEFAULTS.orange_money, fr: 'Orange Money', en: 'Orange Money', acc: 'orange_money' },
  card: { account: DEFAULTS.bank, fr: 'Carte bancaire', en: 'Card', acc: 'bank' },
  wallet: { account: DEFAULTS.client_advances, fr: 'Compte prépayé', en: 'Prepaid account' },
  credit: { account: DEFAULTS.clients, fr: 'Crédit client', en: 'Customer credit' },
};

// Internal calls into Teknons Compta run with full rights: the till already checked the cashier's.
const sys = (ctx) => ({ ...ctx, user: { ...ctx.user, role: 'owner' } });

export function settingsOf(db, companyId) {
  db.run('INSERT OR IGNORE INTO shop_settings (company_id) VALUES (?)', companyId);
  return db.get('SELECT * FROM shop_settings WHERE company_id = ?', companyId);
}
export const publicSettings = (s) => { const { manager_pin_hash, ...rest } = s; return { ...rest, has_pin: !!manager_pin_hash }; };

export function setManagerPin(db, companyId, pin) {
  const p = String(pin || '');
  if (!/^\d{4,8}$/.test(p)) throw bad('pin', 'Le code gérant doit avoir 4 à 8 chiffres');
  db.run('UPDATE shop_settings SET manager_pin_hash = ? WHERE company_id = ?', hashPassword(p), companyId);
}

/** Owners, admins and managers don't need the code; others must type it. */
export function checkManager(db, ctx, pin, what) {
  if (['owner', 'admin', 'manager'].includes(ctx.user.role)) return;
  const s = settingsOf(db, ctx.user.company_id);
  if (!s.manager_pin_hash) throw forbidden(`${what} : code gérant non configuré. Demandez au gérant de le définir dans Paramètres POS.`);
  if (!pin || !verifyPassword(String(pin), s.manager_pin_hash)) throw forbidden(`${what} : code gérant incorrect`);
}

export function customerOf(db, companyId, partnerId) {
  if (!partnerId) return null;
  const p = db.get("SELECT * FROM partners WHERE id = ? AND company_id = ? AND kind = 'client'", partnerId, companyId);
  if (!p) throw notFound('Client introuvable');
  db.run('INSERT OR IGNORE INTO shop_customers (partner_id, company_id) VALUES (?,?)', p.id, companyId);
  const c = db.get('SELECT * FROM shop_customers WHERE partner_id = ?', p.id);
  const debt = db.get("SELECT COALESCE(SUM(total - paid - credited),0) s FROM documents WHERE company_id = ? AND partner_id = ? AND kind = 'invoice' AND status IN ('open','partial')", companyId, p.id).s;
  return { ...p, ...c, partner_id: p.id, debt };
}

export function itemsFor(db, companyId, ids) {
  const out = {};
  if (!ids.length) return out;
  const rows = db.all(`SELECT p.id product_id, p.name, p.vat_rate, p.sales_account, p.active, i.* FROM products p JOIN shop_items i ON i.product_id = p.id
    WHERE p.company_id = ? AND p.id IN (${ids.map(() => '?').join(',')})`, companyId, ...ids);
  for (const r of rows) out[r.product_id] = r;
  return out;
}
export const activePromos = (db, companyId) => db.all('SELECT * FROM shop_promos WHERE company_id = ? AND active = 1', companyId);

// ---------------- Sessions ----------------
export function openSessionFor(db, user) {
  return db.get("SELECT s.*, r.name register_name, st.name store_name FROM shop_sessions s JOIN shop_registers r ON r.id = s.register_id JOIN shop_stores st ON st.id = s.store_id WHERE s.company_id = ? AND s.user_id = ? AND s.status = 'open' ORDER BY s.id DESC LIMIT 1", user.company_id, user.id);
}

export function openSession(db, bus, ctx, b) {
  const cid = ctx.user.company_id;
  if (openSessionFor(db, ctx.user)) throw conflict('session_open', 'Vous avez déjà une session de caisse ouverte');
  const reg = db.get('SELECT r.*, s.kind FROM shop_registers r JOIN shop_stores s ON s.id = r.store_id WHERE r.id = ? AND r.company_id = ? AND r.active = 1', b.register_id, cid);
  if (!reg) throw notFound('Caisse introuvable');
  const busy = db.get("SELECT u.name FROM shop_sessions s JOIN users u ON u.id = s.user_id WHERE s.register_id = ? AND s.status = 'open'", reg.id);
  if (busy) throw conflict('register_busy', `${reg.name} est déjà ouverte par ${busy.name}`);
  const number = nextNumber(db, cid, `SC-${today().slice(0, 4)}`);
  const r = db.run('INSERT INTO shop_sessions (company_id, store_id, register_id, user_id, number, opening_float, opened_at) VALUES (?,?,?,?,?,?,?)',
    cid, reg.store_id, reg.id, ctx.user.id, number, int(b.opening_float, 'opening_float', { min: 0, def: 0 }), now());
  audit(db, ctx, 'open', 'pos_session', Number(r.lastInsertRowid), { register: reg.name });
  bus.emit(cid, 'change', { entity: 'pos_session' });
  return openSessionFor(db, ctx.user);
}

function sessionFor(db, ctx, id) {
  const s = db.get('SELECT * FROM shop_sessions WHERE id = ? AND company_id = ?', id, ctx.user.company_id);
  if (!s) throw notFound('Session de caisse introuvable');
  return s;
}

/** Totals of a session: by payment method, expected cash in the drawer, sales, returns, voids. */
export function sessionSummary(db, sessionId) {
  const s = db.get(`SELECT s.*, u.name user_name, r.name register_name, st.name store_name FROM shop_sessions s JOIN users u ON u.id = s.user_id
    JOIN shop_registers r ON r.id = s.register_id JOIN shop_stores st ON st.id = s.store_id WHERE s.id = ?`, sessionId);
  const byMethod = db.all(`SELECT p.method, SUM(p.amount) amount FROM shop_sale_payments p JOIN shop_sales x ON x.id = p.sale_id
    WHERE x.session_id = ? AND x.status = 'completed' GROUP BY p.method`, sessionId);
  const sales = db.get("SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(discount_total + promo_total),0) discounts, COALESCE(SUM(net_total),0) net, COALESCE(SUM(vat_total),0) vat, COALESCE(SUM(cost_total),0) cost FROM shop_sales WHERE session_id = ? AND kind = 'sale' AND status = 'completed'", sessionId);
  const returns = db.get("SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM shop_sales WHERE session_id = ? AND kind = 'return' AND status = 'completed'", sessionId);
  const topups = db.get("SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM shop_sales WHERE session_id = ? AND kind = 'topup' AND status = 'completed'", sessionId);
  const voids = db.get("SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM shop_sales WHERE session_id = ? AND status = 'voided'", sessionId);
  const moves = db.all('SELECT kind, method, SUM(amount) amount FROM shop_cash_moves WHERE session_id = ? GROUP BY kind, method', sessionId);
  const cashSales = byMethod.find((m) => m.method === 'cash')?.amount || 0;
  const mv = (kind, method = 'cash') => moves.filter((m) => m.kind === kind && m.method === method).reduce((t, m) => t + m.amount, 0);
  const expected = s.opening_float + cashSales + mv('in') - mv('out') + mv('credit_repayment');
  return { session: s, byMethod, sales, returns, topups, voids, moves, cash: { opening: s.opening_float, sales: cashSales, in: mv('in'), out: mv('out'), repayments: mv('credit_repayment'), expected } };
}

/** Closes a session: counted cash vs expected, variance alert, one accounting entry for the session. */
export function closeSession(db, bus, ctx, id, b) {
  const s = sessionFor(db, ctx, id);
  if (s.status !== 'open') throw conflict('closed', 'Cette session est déjà clôturée');
  if (s.user_id !== ctx.user.id && !can(ctx.user, 'settings') && ctx.user.role !== 'manager') throw forbidden('Seul le caissier de la session ou un gérant peut la clôturer');
  const counted = int(b.counted_cash, 'counted_cash', { min: 0 });
  const sum = sessionSummary(db, id);
  const variance = counted - sum.cash.expected;
  const cid = ctx.user.company_id;
  return db.tx(() => {
    const entryId = postSessionEntry(db, cid, s, variance, ctx.user.id, `${sum.session.register_name} · ${s.number}`);
    db.run("UPDATE shop_sessions SET status = 'closed', closed_at = ?, expected_cash = ?, counted_cash = ?, variance = ?, close_note = ?, entry_id = ? WHERE id = ?",
      now(), sum.cash.expected, counted, variance, str(b.note, 500), entryId, id);
    audit(db, ctx, 'close', 'pos_session', id, { expected: sum.cash.expected, counted, variance });
    if (variance !== 0) {
      raiseAlert(db, bus, cid, { kind: 'pos_variance', level: Math.abs(variance) >= 1000 ? 'danger' : 'warning',
        title: `${sum.session.register_name} clôturée · écart de ${variance > 0 ? '+' : ''}${fcfa(variance)}`,
        body: `${sum.session.user_name}, session ${s.number} : attendu ${fcfa(sum.cash.expected)}, compté ${fcfa(counted)}.`, entity: 'pos_session', entity_id: id });
    } else {
      raiseAlert(db, bus, cid, { kind: 'pos_closed', level: 'success', title: `${sum.session.register_name} clôturée sans écart`, body: `${sum.session.user_name} · ventes ${fcfa(sum.sales.total)}.`, entity: 'pos_session', entity_id: id });
    }
    bus.emit(cid, 'change', { entity: 'pos_session', id });
    return sessionSummary(db, id);
  });
}

function postSessionEntry(db, companyId, s, variance, userId, label) {
  const acc = new Map();
  const add = (account, amount, partner_id = null) => { if (!amount) return; const k = `${account}|${partner_id ?? ''}`; acc.set(k, (acc.get(k) || 0) + amount); };
  const sales = db.all("SELECT * FROM shop_sales WHERE session_id = ? AND status = 'completed' AND document_id IS NULL", s.id);
  for (const x of sales) {
    for (const p of db.all('SELECT * FROM shop_sale_payments WHERE sale_id = ?', x.id)) {
      add(PAY_METHODS[p.method].account, p.amount, p.method === 'wallet' ? x.customer_id : null);
    }
    if (x.kind === 'topup') { add(DEFAULTS.client_advances, -x.total, x.customer_id); continue; }
    for (const l of db.all('SELECT l.*, pr.sales_account FROM shop_sale_lines l LEFT JOIN products pr ON pr.id = l.product_id WHERE l.sale_id = ?', x.id)) {
      add(l.sales_account || DEFAULTS.sales_goods, -l.net);
      add(DEFAULTS.vat_collected, -l.vat);
    }
  }
  if (variance < 0) { add('658', -variance); add(DEFAULTS.cash, variance); }
  if (variance > 0) { add(DEFAULTS.cash, variance); add('758', -variance); }
  const lines = [...acc.entries()].filter(([, v]) => v !== 0).map(([k, v]) => {
    const [account, partner] = k.split('|');
    return { account, partner_id: partner ? Number(partner) : null, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 };
  });
  if (lines.length < 2) return null;
  return postEntry(db, { companyId, journal: 'CA', date: today(), label: `Ventes caisse ${label}`, ref: s.number, source_type: 'pos_session', source_id: s.id, userId, lines });
}

// ---------------- Sales ----------------
function resolveSession(db, ctx, sessionId) {
  let s = sessionId ? db.get('SELECT * FROM shop_sessions WHERE id = ? AND company_id = ?', sessionId, ctx.user.company_id) : null;
  if (s && s.status !== 'open') s = null; // offline sale synced after the close: goes into the cashier's current session
  if (s && s.user_id !== ctx.user.id) s = null;
  s ||= openSessionFor(db, ctx.user);
  if (!s) throw conflict('no_session', 'Ouvrez une session de caisse avant de vendre');
  return s;
}

/**
 * Records a sale. body: { session_id, customer_id, lines: [{ product_id, qty, price_override, discount_pct }],
 *   discount_amount, points_used, bonus_used, payments: [{ method, amount, reference, momo_id }], manager_pin, note, offline }
 */
export function createSale(db, bus, ctx, company, b) {
  const cid = company.id;
  const session = resolveSession(db, ctx, b.session_id);
  const settings = settingsOf(db, cid);
  const customer = customerOf(db, cid, b.customer_id);
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  if (!rawLines.length) throw bad('lines', 'Le panier est vide');
  if (rawLines.length > 300) throw bad('lines', 'Panier trop grand (300 lignes max)');
  const items = itemsFor(db, cid, [...new Set(rawLines.map((l) => Number(l.product_id)))]);
  const pointsUsed = int(b.points_used, 'points_used', { min: 0, def: 0 });
  const bonusUsed = int(b.bonus_used, 'bonus_used', { min: 0, def: 0 });
  const discountAmount = int(b.discount_amount, 'discount_amount', { min: 0, def: 0 });
  if ((pointsUsed || bonusUsed) && !customer) throw bad('customer', 'Choisissez le client pour utiliser ses points ou son bonus');
  if (pointsUsed && pointsUsed > customer.points) throw bad('points', `Le client n'a que ${customer.points} points`);
  if (pointsUsed && pointsUsed < settings.min_points_redeem) throw bad('points', `Minimum ${settings.min_points_redeem} points pour payer avec des points`);
  if (bonusUsed && bonusUsed > customer.bonus) throw bad('bonus', `Bonus disponible : ${fcfa(customer.bonus)}`);

  let cart;
  try {
    cart = priceCart({ lines: rawLines, items, promos: activePromos(db, cid), level: customer?.price_level || 'retail', vatDefault: company.vat_enabled ? company.vat_rate : 0,
      date: today(), settings, discount_amount: discountAmount, points_used: pointsUsed, bonus_used: bonusUsed });
  } catch (e) { throw bad('cart', e.message); }

  const needsManager = cart.lines.some((l) => l.override) || cart.lines.some((l) => l.discount_pct > settings.max_discount_pct)
    || (discountAmount > 0 && discountAmount > (cart.total + discountAmount) * settings.max_discount_pct / 100);
  if (needsManager) checkManager(db, ctx, b.manager_pin, 'Prix modifié ou remise importante');

  // ---- Payments ----
  const pays = (Array.isArray(b.payments) ? b.payments : []).map((p) => ({ method: oneOf(p.method, Object.keys(PAY_METHODS), 'method'), amount: int(p.amount, 'amount', { min: 0 }), reference: str(p.reference, 80), momo_id: p.momo_id }))
    .filter((p) => p.amount > 0);
  if (!pays.length && cart.total > 0) throw bad('payments', 'Indiquez le paiement');
  const nonCash = pays.filter((p) => p.method !== 'cash').reduce((t, p) => t + p.amount, 0);
  const tendered = pays.filter((p) => p.method === 'cash').reduce((t, p) => t + p.amount, 0);
  if (nonCash > cart.total) throw bad('overpay', `Les paiements hors espèces (${fcfa(nonCash)}) dépassent le total (${fcfa(cart.total)})`);
  let cashApplied = Math.min(tendered, cart.total - nonCash);
  let shortfall = cart.total - nonCash - cashApplied;
  if (shortfall > 0) {
    if (!b.offline) throw bad('underpay', `Il manque ${fcfa(shortfall)}`);
    cashApplied += shortfall; // sold offline at an older price: the drawer shows the difference at closing
  }
  const change = Math.max(0, tendered - cashApplied);
  const credit = pays.filter((p) => p.method === 'credit').reduce((t, p) => t + p.amount, 0);
  const walletPay = pays.filter((p) => p.method === 'wallet').reduce((t, p) => t + p.amount, 0);
  if ((credit || walletPay) && !customer) throw bad('customer', 'Choisissez le client pour un paiement à crédit ou par compte prépayé');
  if (walletPay > (customer?.wallet || 0)) throw bad('wallet', `Solde du compte prépayé : ${fcfa(customer?.wallet || 0)}`);
  if (credit && walletPay) throw bad('mix', 'Un même ticket ne peut pas mélanger crédit et compte prépayé');
  if (credit) {
    if (customer.credit_limit <= 0) checkManager(db, ctx, b.manager_pin, `${customer.name} n'a pas de crédit autorisé`);
    else if (customer.debt + credit > customer.credit_limit) checkManager(db, ctx, b.manager_pin, `Plafond de crédit dépassé (${fcfa(customer.debt)} dû sur ${fcfa(customer.credit_limit)})`);
  }
  const momoUsed = [];
  for (const p of pays) {
    if (!['mtn_momo', 'orange_money'].includes(p.method) || !p.momo_id) continue;
    const m = db.get('SELECT * FROM shop_momo WHERE id = ? AND company_id = ?', p.momo_id, cid);
    if (!m || m.status !== 'successful') throw conflict('momo', 'Le paiement Mobile Money n\'est pas encore confirmé');
    if (m.used_by_sale) throw conflict('momo', 'Ce paiement Mobile Money a déjà servi pour un autre ticket');
    if (m.amount !== p.amount || m.provider !== p.method) throw bad('momo', 'Le montant Mobile Money ne correspond pas');
    p.reference = m.transaction_id || m.provider_ref;
    momoUsed.push(m.id);
  }

  return db.tx(() => {
    const number = nextNumber(db, cid, `TK-${today().slice(0, 4)}`, 6);
    const cost = (l) => Math.round(l.qty * (items[l.product_id]?.avg_cost || 0));
    const costTotal = cart.lines.reduce((t, l) => t + cost(l), 0);
    const pointsEarned = customer ? pointsFor(cart.total - credit, settings) : 0;
    const r = db.run(`INSERT INTO shop_sales (company_id, store_id, session_id, number, kind, customer_id, price_level, gross, promo_total, discount_total, total, net_total, vat_total, cost_total,
        paid, change_given, credit_amount, points_earned, points_used, bonus_used, token, offline, note, created_by, created_at) VALUES (?,?,?,?,'sale',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    cid, session.store_id, session.id, number, customer?.partner_id ?? null, customer?.price_level || 'retail', cart.gross, cart.promo_total, cart.discount_total, cart.total,
    cart.net_total, cart.vat_total, costTotal, cart.total - credit, change, credit, pointsEarned, pointsUsed, bonusUsed, crypto.randomBytes(12).toString('base64url'),
    b.offline ? 1 : 0, str(b.note, 300), ctx.user.id, now());
    const saleId = Number(r.lastInsertRowid);
    for (const l of cart.lines) {
      db.run(`INSERT INTO shop_sale_lines (sale_id, product_id, description, qty, unit_price, promo_id, promo_amount, discount, total, vat_rate, net, vat, cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        saleId, l.product_id, l.description, l.qty, l.unit_price, l.promo_id, l.promo_amount, l.discount, l.total, l.vat_rate, l.net, l.vat, cost(l));
      const left = moveStock(db, cid, session.store_id, l.product_id, -l.qty, { kind: 'sale', ref_type: 'sale', ref_id: saleId, userId: ctx.user.id });
      const it = items[l.product_id];
      if (it.min_stock > 0 && left <= it.min_stock && left + l.qty > it.min_stock) {
        raiseAlert(db, bus, cid, { kind: 'low_stock', level: 'warning', title: `Stock bas : ${it.name}`, body: `Il reste ${left} ${it.by_weight ? 'kg' : ''} (seuil ${it.min_stock}).`, entity: 'product', entity_id: l.product_id });
      }
    }
    for (const p of pays) {
      const amount = p.method === 'cash' ? cashApplied : p.amount;
      if (amount > 0) db.run('INSERT INTO shop_sale_payments (sale_id, method, amount, reference) VALUES (?,?,?,?)', saleId, p.method, amount, p.reference);
    }
    if (shortfall > 0) raiseAlert(db, bus, cid, { kind: 'pos_offline_diff', level: 'warning', title: `Ticket ${number} : prix changé pendant la coupure`, body: `Vendu hors ligne ${fcfa(shortfall)} de moins que le prix actuel.`, entity: 'sale', entity_id: saleId });
    for (const m of momoUsed) db.run('UPDATE shop_momo SET used_by_sale = ? WHERE id = ?', saleId, m);

    if (customer) {
      db.run('UPDATE shop_customers SET points = points - ? + ?, wallet = wallet - ?, bonus = bonus - ? WHERE partner_id = ?', pointsUsed, pointsEarned, walletPay, bonusUsed, customer.partner_id);
      const mv = (kind, o) => db.run('INSERT INTO shop_customer_moves (company_id, partner_id, kind, points, wallet, bonus, sale_id, session_id, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        cid, customer.partner_id, kind, o.points || 0, o.wallet || 0, o.bonus || 0, saleId, session.id, ctx.user.id, now());
      if (pointsEarned) mv('points_earned', { points: pointsEarned });
      if (pointsUsed) mv('points_used', { points: -pointsUsed });
      if (walletPay) mv('wallet_used', { wallet: -walletPay });
      if (bonusUsed) mv('bonus_used', { bonus: -bonusUsed });
    }

    // Credit: the whole ticket becomes an invoice in Teknons Compta (statement, reminders, payment link)
    if (credit) {
      const docId = docs.createDocument(db, sys(ctx), company, {
        kind: 'invoice', partner_id: customer.partner_id, date: today(), subject: `Ticket de caisse ${number}`, validate: true,
        lines: cart.lines.map((l) => ({ description: `${l.description} (${qtyRound(l.qty)} × ${fcfa(l.unit_price)} TTC)`, qty: 1, unit_price: l.net, vat_rate: l.vat_rate, kind: 'good', account_code: items[l.product_id].sales_account || DEFAULTS.sales_goods })),
      });
      db.run('UPDATE shop_sales SET document_id = ? WHERE id = ?', docId, saleId);
      for (const p of pays) {
        if (p.method === 'credit') continue;
        const amount = p.method === 'cash' ? cashApplied : p.amount;
        const inv = db.get('SELECT total, paid, credited FROM documents WHERE id = ?', docId);
        const pay = Math.min(amount, inv.total - inv.paid - inv.credited);
        if (pay > 0) tr.recordPayment(db, sys(ctx), company, { document_id: docId, method: PAY_METHODS[p.method].acc, amount: pay, reference: p.reference || number, date: today() });
      }
    }
    if (needsManager) audit(db, ctx, 'override', 'sale', saleId, { lines: cart.lines.filter((l) => l.override || l.discount_pct).map((l) => [l.description, l.unit_price, l.discount_pct]), discountAmount });
    bus.emit(cid, 'change', { entity: 'sale', id: saleId, store_id: session.store_id });
    return saleId;
  });
}

export function getSale(db, companyId, id) {
  const s = db.get(`SELECT x.*, p.name customer_name, p.phone customer_phone, u.name cashier, st.name store_name, ss.number session_number, r.name register_name
    FROM shop_sales x LEFT JOIN partners p ON p.id = x.customer_id LEFT JOIN users u ON u.id = x.created_by JOIN shop_stores st ON st.id = x.store_id
    JOIN shop_sessions ss ON ss.id = x.session_id JOIN shop_registers r ON r.id = ss.register_id WHERE x.id = ? AND x.company_id = ?`, id, companyId);
  if (!s) return null;
  s.lines = db.all('SELECT l.*, i.barcode FROM shop_sale_lines l LEFT JOIN shop_items i ON i.product_id = l.product_id WHERE l.sale_id = ? ORDER BY l.id', id);
  s.payments = db.all('SELECT * FROM shop_sale_payments WHERE sale_id = ? ORDER BY id', id);
  s.returns = db.all("SELECT id, number, total, created_at FROM shop_sales WHERE ref_sale_id = ? AND status = 'completed'", id);
  if (s.customer_id) s.customer = db.get('SELECT points, wallet, bonus, card_no FROM shop_customers WHERE partner_id = ?', s.customer_id);
  if (s.document_id) s.document = db.get('SELECT id, number, kind, status, total, paid, credited FROM documents WHERE id = ?', s.document_id);
  return s;
}

export function listSales(db, companyId, q) {
  const where = ['x.company_id = ?']; const a = [companyId];
  if (q.store_id) { where.push('x.store_id = ?'); a.push(q.store_id); }
  if (q.session_id) { where.push('x.session_id = ?'); a.push(q.session_id); }
  if (q.customer_id) { where.push('x.customer_id = ?'); a.push(q.customer_id); }
  if (q.kind) { where.push('x.kind = ?'); a.push(q.kind); }
  if (q.from) { where.push('x.created_at >= ?'); a.push(q.from); }
  if (q.to) { where.push('x.created_at < ?'); a.push(q.to + 'T99'); }
  if (q.q) { where.push('(x.number LIKE ? OR p.name LIKE ?)'); a.push(`%${q.q}%`, `%${q.q}%`); }
  return db.all(`SELECT x.id, x.number, x.kind, x.status, x.total, x.credit_amount, x.created_at, x.store_id, st.name store_name, p.name customer_name, u.name cashier,
      (SELECT group_concat(method) FROM shop_sale_payments WHERE sale_id = x.id) methods
    FROM shop_sales x LEFT JOIN partners p ON p.id = x.customer_id LEFT JOIN users u ON u.id = x.created_by JOIN shop_stores st ON st.id = x.store_id
    WHERE ${where.join(' AND ')} ORDER BY x.id DESC LIMIT ${Math.min(Number(q.limit) || 300, 2000)}`, ...a);
}

/** Cancels a ticket of the open session (wrong scan, customer changed their mind). Manager code needed. */
export function voidSale(db, bus, ctx, id, b) {
  const cid = ctx.user.company_id;
  const s = db.get('SELECT * FROM shop_sales WHERE id = ? AND company_id = ?', id, cid);
  if (!s) throw notFound('Ticket introuvable');
  if (s.status === 'voided') throw conflict('already', 'Ticket déjà annulé');
  if (s.kind !== 'sale') throw bad('kind', 'Seule une vente peut être annulée');
  const sess = db.get('SELECT * FROM shop_sessions WHERE id = ?', s.session_id);
  if (sess.status !== 'open') throw conflict('closed', 'La session est clôturée : faites un retour à la place');
  if (s.document_id) throw conflict('credit', 'Ticket à crédit : faites un retour (avoir) à la place');
  if (db.get("SELECT id FROM shop_sales WHERE ref_sale_id = ? AND status = 'completed'", id)) throw conflict('returned', 'Ce ticket a déjà un retour');
  checkManager(db, ctx, b.manager_pin, 'Annulation de ticket');
  const reason = str(b.reason, 200) || 'Annulation';
  db.tx(() => {
    for (const l of db.all('SELECT * FROM shop_sale_lines WHERE sale_id = ?', id)) {
      if (l.product_id) moveStock(db, cid, s.store_id, l.product_id, l.qty, { kind: 'void', ref_type: 'sale', ref_id: id, userId: ctx.user.id, note: reason });
    }
    if (s.customer_id) {
      const wallet = db.get("SELECT COALESCE(SUM(amount),0) a FROM shop_sale_payments WHERE sale_id = ? AND method = 'wallet'", id).a;
      db.run('UPDATE shop_customers SET points = points + ? - ?, wallet = wallet + ?, bonus = bonus + ? WHERE partner_id = ?', s.points_used, s.points_earned, wallet, s.bonus_used, s.customer_id);
      db.run("INSERT INTO shop_customer_moves (company_id, partner_id, kind, points, wallet, bonus, sale_id, note, user_id, at) VALUES (?,?,'void',?,?,?,?,?,?,?)",
        cid, s.customer_id, s.points_used - s.points_earned, wallet, s.bonus_used, id, reason, ctx.user.id, now());
    }
    db.run("UPDATE shop_sales SET status = 'voided', voided_by = ?, void_reason = ? WHERE id = ?", ctx.user.id, reason, id);
    db.run('UPDATE shop_momo SET used_by_sale = NULL WHERE used_by_sale = ?', id);
  });
  audit(db, ctx, 'void', 'sale', id, { number: s.number, total: s.total, reason });
  raiseAlert(db, bus, cid, { kind: 'pos_void', level: 'warning', title: `Ticket ${s.number} annulé (${fcfa(s.total)})`, body: `Par ${ctx.user.name} : ${reason}.`, entity: 'sale', entity_id: id });
  bus.emit(cid, 'change', { entity: 'sale', id });
}

/**
 * Return or exchange linked to the original ticket. lines: [{ line_id, qty }]; refund_method: cash,
 * mtn_momo, orange_money, card or wallet (store credit). A ticket sold on credit is reduced by a credit note.
 */
export function returnSale(db, bus, ctx, company, id, b) {
  const cid = company.id;
  const orig = getSale(db, cid, id);
  if (!orig) throw notFound('Ticket introuvable');
  if (orig.kind !== 'sale' || orig.status !== 'completed') throw bad('kind', 'Ce ticket ne peut pas être retourné');
  checkManager(db, ctx, b.manager_pin, 'Retour de marchandise');
  const session = resolveSession(db, ctx, b.session_id);
  const wanted = (Array.isArray(b.lines) ? b.lines : []).filter((l) => Number(l.qty) > 0);
  if (!wanted.length) throw bad('lines', 'Choisissez les articles retournés');
  const lines = wanted.map((w) => {
    const l = orig.lines.find((x) => x.id === Number(w.line_id));
    if (!l) throw bad('line', 'Ligne introuvable sur le ticket');
    const qty = qtyRound(Number(w.qty));
    if (qty > qtyRound(l.qty - l.returned_qty)) throw bad('qty', `${l.description} : au plus ${qtyRound(l.qty - l.returned_qty)} à retourner`);
    const share = qty / l.qty;
    const total = Math.round(l.total * share), net = Math.round(l.net * share);
    return { l, qty, total, net, vat: total - net, cost: Math.round(l.cost * share), restock: w.restock !== false };
  });
  const value = lines.reduce((t, x) => t + x.total, 0);
  let method = oneOf(b.refund_method, ['cash', 'mtn_momo', 'orange_money', 'card', 'wallet'], 'refund_method', 'cash');
  let creditNote = null;
  const inv = orig.document_id ? db.get('SELECT * FROM documents WHERE id = ?', orig.document_id) : null;
  const useCreditNote = inv && ['open', 'partial'].includes(inv.status) && inv.total - inv.paid - inv.credited >= value;
  if (method === 'wallet' && !orig.customer_id) throw bad('customer', 'Avoir sur compte prépayé : le ticket doit avoir un client');

  return db.tx(() => {
    const number = nextNumber(db, cid, `RT-${today().slice(0, 4)}`, 5);
    const pointsBack = orig.points_earned ? Math.round(orig.points_earned * value / Math.max(1, orig.total)) : 0;
    const r = db.run(`INSERT INTO shop_sales (company_id, store_id, session_id, number, kind, customer_id, price_level, gross, total, net_total, vat_total, cost_total, paid, points_earned, ref_sale_id, note, created_by, created_at, token)
      VALUES (?,?,?,?,'return',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, cid, session.store_id, session.id, number, orig.customer_id, orig.price_level, -value, -value,
    -lines.reduce((t, x) => t + x.net, 0), -lines.reduce((t, x) => t + x.vat, 0), -lines.reduce((t, x) => t + x.cost, 0), useCreditNote ? 0 : -value, -pointsBack, orig.id,
    str(b.reason, 200), ctx.user.id, now(), crypto.randomBytes(12).toString('base64url'));
    const retId = Number(r.lastInsertRowid);
    for (const x of lines) {
      db.run(`INSERT INTO shop_sale_lines (sale_id, product_id, description, qty, unit_price, discount, total, vat_rate, net, vat, cost) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        retId, x.l.product_id, x.l.description, -x.qty, x.l.unit_price, 0, -x.total, x.l.vat_rate, -x.net, -x.vat, -x.cost);
      db.run('UPDATE shop_sale_lines SET returned_qty = returned_qty + ? WHERE id = ?', x.qty, x.l.id);
      if (x.l.product_id && x.restock) moveStock(db, cid, session.store_id, x.l.product_id, x.qty, { kind: 'return', ref_type: 'sale', ref_id: retId, userId: ctx.user.id });
    }
    if (useCreditNote) {
      const docId = docs.createDocument(db, sys(ctx), company, {
        kind: 'credit_note', partner_id: orig.customer_id, ref_doc_id: inv.id, date: today(), subject: `Retour ${number} sur ticket ${orig.number}`, validate: true,
        lines: lines.map((x) => ({ description: `${x.l.description} (retour ${x.qty})`, qty: 1, unit_price: x.net, vat_rate: x.l.vat_rate, kind: 'good', account_code: DEFAULTS.sales_goods })),
      });
      creditNote = docId;
      db.run('UPDATE shop_sales SET document_id = ? WHERE id = ?', docId, retId);
      method = 'credit';
    }
    db.run('INSERT INTO shop_sale_payments (sale_id, method, amount, reference) VALUES (?,?,?,?)', retId, method, -value, orig.number);
    if (orig.customer_id) {
      const wallet = method === 'wallet' ? value : 0;
      db.run('UPDATE shop_customers SET points = MAX(0, points - ?), wallet = wallet + ? WHERE partner_id = ?', pointsBack, wallet, orig.customer_id);
      db.run("INSERT INTO shop_customer_moves (company_id, partner_id, kind, points, wallet, sale_id, session_id, user_id, at) VALUES (?,?,'return',?,?,?,?,?,?)",
        cid, orig.customer_id, -pointsBack, wallet, retId, session.id, ctx.user.id, now());
    }
    audit(db, ctx, 'return', 'sale', retId, { original: orig.number, value, method });
    raiseAlert(db, bus, cid, { kind: 'pos_return', level: 'info', title: `Retour ${number} : ${fcfa(value)}`, body: `Ticket ${orig.number}, remboursé ${PAY_METHODS[method].fr.toLowerCase()} par ${ctx.user.name}.`, entity: 'sale', entity_id: retId });
    bus.emit(cid, 'change', { entity: 'sale', id: retId });
    return { id: retId, credit_note: creditNote };
  });
}

/** Prepaid account top-up, with the bonus rule (e.g. +5 % from 10 000 FCFA). */
export function topup(db, bus, ctx, b) {
  const cid = ctx.user.company_id;
  const session = resolveSession(db, ctx, b.session_id);
  const customer = customerOf(db, cid, b.customer_id);
  if (!customer) throw bad('customer', 'Choisissez le client');
  const amount = int(b.amount, 'amount', { min: 100 });
  const method = oneOf(b.method, ['cash', 'mtn_momo', 'orange_money', 'card'], 'method', 'cash');
  const settings = settingsOf(db, cid);
  const bonus = topupBonus(amount, settings);
  return db.tx(() => {
    const number = nextNumber(db, cid, `RC-${today().slice(0, 4)}`, 5);
    const r = db.run(`INSERT INTO shop_sales (company_id, store_id, session_id, number, kind, customer_id, gross, total, net_total, paid, token, note, created_by, created_at)
      VALUES (?,?,?,?,'topup',?,?,?,0,?,?,?,?,?)`, cid, session.store_id, session.id, number, customer.partner_id, amount, amount, amount, crypto.randomBytes(12).toString('base64url'),
    bonus ? `Bonus offert : ${fcfa(bonus)}` : '', ctx.user.id, now());
    const id = Number(r.lastInsertRowid);
    db.run('INSERT INTO shop_sale_payments (sale_id, method, amount, reference) VALUES (?,?,?,?)', id, method, amount, str(b.reference, 80));
    db.run('UPDATE shop_customers SET wallet = wallet + ?, bonus = bonus + ? WHERE partner_id = ?', amount, bonus, customer.partner_id);
    db.run("INSERT INTO shop_customer_moves (company_id, partner_id, kind, wallet, bonus, sale_id, session_id, method, user_id, at) VALUES (?,?,'wallet_topup',?,?,?,?,?,?,?)",
      cid, customer.partner_id, amount, bonus, id, session.id, method, ctx.user.id, now());
    bus.emit(cid, 'change', { entity: 'customer', id: customer.partner_id });
    return { id, bonus };
  });
}

export function cashMove(db, bus, ctx, b) {
  const session = resolveSession(db, ctx, b.session_id);
  const kind = oneOf(b.kind, ['in', 'out'], 'kind');
  const amount = int(b.amount, 'amount', { min: 1 });
  const reason = str(b.reason, 200);
  if (!reason) throw bad('reason', 'Indiquez le motif');
  if (kind === 'out') {
    const sum = sessionSummary(db, session.id);
    if (amount > sum.cash.expected) throw bad('amount', `Il n'y a que ${fcfa(sum.cash.expected)} dans le tiroir`);
  }
  db.run('INSERT INTO shop_cash_moves (company_id, session_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?,?)', ctx.user.company_id, session.id, kind, amount, reason, ctx.user.id, now());
  audit(db, ctx, 'cash_' + kind, 'pos_session', session.id, { amount, reason });
  bus.emit(ctx.user.company_id, 'change', { entity: 'pos_session', id: session.id });
}

/** A customer pays back part of their credit at the till: settles their oldest invoices first. */
export function creditRepayment(db, bus, ctx, company, b) {
  const session = resolveSession(db, ctx, b.session_id);
  const customer = customerOf(db, company.id, b.customer_id);
  if (!customer) throw bad('customer', 'Choisissez le client');
  const method = oneOf(b.method, ['cash', 'mtn_momo', 'orange_money', 'card'], 'method', 'cash');
  let left = int(b.amount, 'amount', { min: 1 });
  if (left > customer.debt) throw bad('amount', `Le client ne doit que ${fcfa(customer.debt)}`);
  return db.tx(() => {
    const invs = db.all("SELECT * FROM documents WHERE company_id = ? AND partner_id = ? AND kind = 'invoice' AND status IN ('open','partial') ORDER BY date, id", company.id, customer.partner_id);
    const ids = [];
    for (const inv of invs) {
      if (left <= 0) break;
      const pay = Math.min(left, inv.total - inv.paid - inv.credited);
      const pid = tr.recordPayment(db, sys(ctx), company, { document_id: inv.id, method: PAY_METHODS[method].acc, amount: pay, reference: str(b.reference, 80) || 'Remboursement en caisse', date: today() });
      db.run('INSERT INTO shop_cash_moves (company_id, session_id, kind, method, amount, reason, partner_id, payment_id, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        company.id, session.id, 'credit_repayment', method, pay, `Facture ${inv.number}`, customer.partner_id, pid, ctx.user.id, now());
      ids.push(pid); left -= pay;
    }
    bus.emit(company.id, 'change', { entity: 'payment' });
    return { payments: ids, debt: customerOf(db, company.id, customer.partner_id).debt };
  });
}

// ---------------- Mobile Money at the till ----------------
export async function momoRequest(db, momo, ctx, company, b) {
  const provider = oneOf(b.provider, Object.keys(PROVIDERS), 'provider');
  if (!momo.configured(provider)) throw conflict('momo_config', `${PROVIDERS[provider].fr} n'est pas encore activé pour ce marchand`);
  const amount = int(b.amount, 'amount', { min: 1 });
  const phone = normalizePhone(b.phone);
  const session = openSessionFor(db, ctx.user);
  const res = await momo.requestPayment({ provider, phone, amount, reference: `POS-${session?.number || ''}`, description: `${company.name} – achat en caisse` });
  const r = db.run('INSERT INTO shop_momo (company_id, session_id, provider, phone, amount, provider_ref, created_at) VALUES (?,?,?,?,?,?,?)', company.id, session?.id ?? null, provider, phone, amount, res.providerRef, now());
  return { id: Number(r.lastInsertRowid), status: 'pending' };
}

export async function momoStatus(db, momo, ctx, id) {
  const m = db.get('SELECT * FROM shop_momo WHERE id = ? AND company_id = ?', id, ctx.user.company_id);
  if (!m) throw notFound('Demande introuvable');
  if (m.status === 'pending') {
    let st;
    try { st = await momo.checkStatus(m.provider, m.provider_ref); } catch (e) { return { id: m.id, status: 'pending', note: e.message }; }
    if (st.status === 'successful') db.run("UPDATE shop_momo SET status = 'successful', transaction_id = ? WHERE id = ?", st.transactionId || '', m.id);
    else if (st.status === 'failed') db.run("UPDATE shop_momo SET status = 'failed', reason = ? WHERE id = ?", String(st.reason || '').slice(0, 200), m.id);
    else if (Date.now() - Date.parse(m.created_at) > 5 * 60e3) db.run("UPDATE shop_momo SET status = 'failed', reason = 'Délai dépassé' WHERE id = ?", m.id);
  }
  const f = db.get('SELECT id, provider, amount, status, reason, transaction_id FROM shop_momo WHERE id = ?', m.id);
  return f;
}

export { stockOf, round };
