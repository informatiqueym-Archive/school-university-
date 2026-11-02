// Teknons POS pricing rules, shared by the till (browser, also offline) and the
// server, so the price the customer sees is the price that is recorded.
// All amounts are whole FCFA, prices are TTC (VAT included, as shown in shops).

export const round = (n) => Math.round(Number(n) || 0);

/** EAN-13 / EAN-8 / UPC check digit for the digits without their check digit. */
export function eanCheck(digits) {
  let sum = 0;
  const s = String(digits);
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[s.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return String((10 - (sum % 10)) % 10);
}
export const isValidEan = (code) => /^(\d{8}|\d{12}|\d{13})$/.test(code) && eanCheck(code.slice(0, -1)) === code.slice(-1);

/** In-store barcode for an article that has none: 200 + 9-digit id + check digit. */
export const internalBarcode = (id) => { const base = '200' + String(id).padStart(9, '0'); return base + eanCheck(base); };

/**
 * Barcodes printed by a shop scale: prefix (2 digits) + PLU (5) + weight in grams or
 * price in FCFA (5) + check digit. Returns null for ordinary barcodes.
 */
export function parseScaleCode(code, { scale_prefix = '21', scale_mode = 'weight' } = {}) {
  const c = String(code || '').trim();
  if (!/^\d{13}$/.test(c) || !c.startsWith(scale_prefix) || !isValidEan(c)) return null;
  const plu = c.slice(2, 7);
  const value = Number(c.slice(7, 12));
  return scale_mode === 'price' ? { plu, amount: value } : { plu, qty: value / 1000 };
}

/** HT amount whose VAT, rounded to the franc, gives back exactly the TTC amount. */
export function solveNet(ttc, rate) {
  ttc = round(ttc);
  if (!rate) return ttc;
  const n0 = Math.round(ttc / (1 + rate / 100));
  for (const n of [n0, n0 - 1, n0 + 1, n0 - 2, n0 + 2]) if (n + Math.round(n * rate / 100) === ttc) return n;
  return n0;
}

const isoDay = (d) => new Date(d + 'T12:00:00Z').getUTCDay();

/** Is this promotion valid on this date for this article? */
export function promoApplies(p, item, date) {
  if (!p.active) return false;
  if (p.start_date && date < p.start_date) return false;
  if (p.end_date && date > p.end_date) return false;
  if (p.days && !String(p.days).split(',').map(Number).includes(isoDay(date))) return false;
  if (p.product_id) return Number(p.product_id) === Number(item.product_id);
  if (p.category_id) return Number(p.category_id) === Number(item.category_id);
  return true; // whole shop
}

/** FCFA saved by one promotion on a line. */
export function promoAmount(p, qty, unit) {
  const gross = round(qty * unit);
  switch (p.kind) {
    case 'percent': return Math.min(gross, round(gross * p.value / 100));
    case 'price': return Math.max(0, gross - round(qty * p.value));
    case 'bundle': { // "3 for 1 000"
      if (!(p.qty > 0)) return 0;
      const n = Math.floor(qty / p.qty + 1e-9);
      return Math.max(0, round(n * p.qty * unit) - round(n * p.value));
    }
    case 'buy_get': { // "buy 2, get 1 free"
      const group = Number(p.qty) + Number(p.free_qty);
      if (!(p.qty > 0) || !(p.free_qty > 0)) return 0;
      const n = Math.floor(qty / group + 1e-9);
      return Math.min(gross, round(n * p.free_qty * unit));
    }
    default: return 0;
  }
}

/** Retail or wholesale unit price for this customer and quantity. */
export function unitPrice(item, qty, level) {
  const w = Number(item.wholesale_price) || 0;
  if (w > 0 && (level === 'wholesale' || (item.wholesale_min_qty > 0 && qty >= item.wholesale_min_qty))) return w;
  return Number(item.retail_price) || 0;
}

/**
 * Prices a whole basket.
 * lines: [{ product_id, qty, price_override?, discount_pct? }]
 * items: { [product_id]: { product_id, name, retail_price, wholesale_price, wholesale_min_qty, vat_rate, category_id } }
 * extra: { discount_amount, points_used, bonus_used } are spread over the lines in proportion.
 */
export function priceCart({ lines, items, promos = [], level = 'retail', vatDefault = 19.25, date, settings = {}, discount_amount = 0, points_used = 0, bonus_used = 0 }) {
  const out = [];
  for (const l of lines) {
    const item = items[l.product_id];
    if (!item) throw new Error(`Article ${l.product_id} introuvable`);
    const qty = Number(l.qty);
    if (!(qty > 0)) throw new Error(`Quantité invalide pour ${item.name}`);
    const override = l.price_override != null && l.price_override !== '';
    const unit = override ? round(l.price_override) : unitPrice(item, qty, level);
    const gross = round(qty * unit);
    let promo = null, promo_amount = 0;
    if (!override) {
      for (const p of promos) {
        if (!promoApplies(p, item, date)) continue;
        const a = promoAmount(p, qty, unit);
        if (a > promo_amount) { promo_amount = a; promo = p; }
      }
    }
    const pct = Math.min(100, Math.max(0, Number(l.discount_pct) || 0));
    const discount = round((gross - promo_amount) * pct / 100);
    const vat_rate = item.vat_rate == null || item.vat_rate === '' ? vatDefault : Number(item.vat_rate);
    out.push({ product_id: item.product_id, description: item.name, qty, unit_price: unit, promo_id: promo?.id ?? null, promo_name: promo?.name || '',
      promo_amount, discount, discount_pct: pct, total: gross - promo_amount - discount, vat_rate, gross, override });
  }
  const sub = out.reduce((s, l) => s + l.total, 0);
  const pointsValue = round(points_used) * (Number(settings.point_value) || 0);
  let extra = Math.min(sub, round(discount_amount) + pointsValue + round(bonus_used));
  const extraTotal = extra;
  // spread the basket discount over the lines (largest line takes the rounding)
  if (extra > 0 && sub > 0) {
    const order = out.map((l, i) => i).sort((a, b) => out[b].total - out[a].total);
    let left = extra;
    order.forEach((i, k) => {
      const share = k === order.length - 1 ? left : Math.min(out[i].total, Math.floor(extra * out[i].total / sub));
      out[i].discount += share; out[i].total -= share; left -= share;
    });
  }
  for (const l of out) { l.net = solveNet(l.total, l.vat_rate); l.vat = l.total - l.net; }
  return {
    lines: out,
    gross: out.reduce((s, l) => s + l.gross, 0),
    promo_total: out.reduce((s, l) => s + l.promo_amount, 0),
    discount_total: out.reduce((s, l) => s + l.discount, 0),
    basket_discount: extraTotal,
    points_value: pointsValue,
    total: out.reduce((s, l) => s + l.total, 0),
    net_total: out.reduce((s, l) => s + l.net, 0),
    vat_total: out.reduce((s, l) => s + l.vat, 0),
  };
}

/** Loyalty points earned on an amount actually paid. */
export const pointsFor = (amount, settings) => (settings.points_per_amount > 0 ? Math.floor(Math.max(0, amount) / settings.points_per_amount) : 0);
/** Bonus credited on a prepaid top-up. */
export const topupBonus = (amount, settings) => (amount >= (settings.topup_bonus_min || 0) ? Math.floor(amount * (settings.topup_bonus_pct || 0) / 100) : 0);
