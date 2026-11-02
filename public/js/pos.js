// Teknons POS till: barcode scanner (USB/Bluetooth or phone camera), touch
// buttons, promotions, loyalty card, prepaid account, customer credit, split
// payments with MTN MoMo / Orange Money prompts, receipts, customer display,
// cash sessions with Z report. Keeps selling during internet cuts.
import { api, net } from './api.js';
import { state, L, esc, money, num, dt, icon, can, canAny, table, field, dialog, toast, showError, confirmDlg, pill, qs } from './ui.js';
import { priceCart, parseScaleCode, pointsFor } from './shop-pricing.js';

export const routes = [];
const R = (path, fn, live = false) => routes.push([path, fn, live]);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const methodLabel = (m) => { const x = state.shop?.methods?.[m]; return x ? L(x.fr, x.en) : m; };
const qtyFmt = (q) => (Number.isInteger(Number(q)) ? String(q) : Number(q).toFixed(3).replace(/0+$/, '').replace('.', ','));
const waNumber = (p) => String(p || '').replace(/\D/g, '').replace(/^(6\d{8})$/, '237$1');
const isManager = () => ['owner', 'admin', 'manager'].includes(state.me.user.role);

/** Runs fn(pin); if the server asks for the manager code, asks for it once and retries. */
export async function withPin(fn, pin) {
  try { return await fn(pin); } catch (e) {
    if (e.status !== 403 || !/code gérant/i.test(e.message) || pin) throw e;
    const v = await dialog({ title: L('Code gérant', 'Manager code'), submit: L('Valider', 'Confirm'),
      body: `<p class="muted" style="margin-top:0">${esc(e.message.replace(/ : code gérant incorrect$/, ''))}. ${L('Un gérant doit saisir son code.', 'A manager must type their code.')}</p>
      <label class="fld">${L('Code gérant', 'Manager code')}<input name="pin" type="password" inputmode="numeric" autocomplete="off" required autofocus></label>` });
    if (!v) throw Object.assign(new Error(L('Action annulée', 'Cancelled')), { quiet: true });
    return fn(v.pin);
  }
}
const fail = (e) => { if (!e?.quiet) showError(e); };

// ===================== Catalogue (cached for offline) =====================
let cat = null;
async function loadCatalog(force = false) {
  if (cat && !force && Date.now() - cat._loaded < 60_000) return cat;
  const storeId = state.shop.session?.store_id || state.shop.my_store;
  const c = await api.get(`/api/shop/catalog?store_id=${storeId}`);
  c.byId = {}; c.byBarcode = {}; c.byPlu = {}; c.byCard = {};
  for (const it of c.items) { c.byId[it.product_id] = it; if (it.barcode) c.byBarcode[it.barcode] = it; if (it.plu) c.byPlu[it.plu] = it; }
  for (const cu of c.customers) if (cu.card_no) c.byCard[cu.card_no.toUpperCase()] = cu;
  c._loaded = Date.now();
  cat = c;
  return c;
}
export const resetCatalog = () => { cat = null; };

// ===================== Basket =====================
const emptyCart = () => ({ lines: [], customer: null, points_used: 0, bonus_used: 0, discount_amount: 0, manager_pin: '', note: '' });
let cart = store.get('tk:cart', emptyCart());
const saveCart = () => { store.set('tk:cart', cart); pushDisplay(); };

function priced() {
  if (!cat) return null;
  const lines = cart.lines.filter((l) => cat.byId[l.product_id]);
  try {
    return priceCart({ lines, items: cat.byId, promos: cat.promos, level: cart.customer?.price_level || 'retail',
      vatDefault: state.me.company.vat_enabled ? state.me.company.vat_rate : 0, date: new Date().toISOString().slice(0, 10), settings: state.shop.settings,
      discount_amount: cart.discount_amount, points_used: cart.points_used, bonus_used: cart.bonus_used });
  } catch (e) { toast(e.message, 'err'); return null; }
}

function addItem(it, qty = 1) {
  if (!it) return;
  const same = cart.lines.find((l) => l.product_id === it.product_id && !l.price_override && !l.discount_pct && !it.by_weight);
  if (same) same.qty = Math.round((Number(same.qty) + qty) * 1000) / 1000;
  else cart.lines.push({ product_id: it.product_id, qty });
  lastAdded = it.product_id;
  beep();
  saveCart();
  drawCart();
}
let lastAdded = null;
let audioCtx = null;
function beep(ok = true) {
  if (store.get('tk:mute', false)) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 1250 : 220; o.type = 'square'; g.gain.value = 0.04;
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + (ok ? 0.07 : 0.25));
  } catch {}
}

/** Scanner, keyboard and camera all end here. Accepts "3*code" for quantities. */
async function handleCode(raw) {
  let code = String(raw || '').trim();
  if (!code) return;
  let mult = 1;
  const m = /^(\d+(?:[.,]\d+)?)\s*[*xX]\s*(.+)$/.exec(code);
  if (m) { mult = Number(m[1].replace(',', '.')); code = m[2].trim(); }
  const c = await loadCatalog();
  if (search) { search = ''; drawGrid(); }
  if (c.byBarcode[code]) return addItem(c.byBarcode[code], mult);
  const sc = parseScaleCode(code, state.shop.settings);
  if (sc && c.byPlu[sc.plu]) { const it = c.byPlu[sc.plu]; return addItem(it, sc.qty ?? Math.round(sc.amount / Math.max(1, it.retail_price) * 1000) / 1000); }
  if (c.byCard[code.toUpperCase()]) { setCustomer(c.byCard[code.toUpperCase()]); beep(); return; }
  try {
    const r = await api.get(`/api/shop/lookup?code=${encodeURIComponent(code)}`, { cache: false });
    if (r.type === 'item') { await loadCatalog(true); return addItem(cat.byId[r.item.id] || { ...r.item, product_id: r.item.id }, r.qty * mult); }
    if (r.type === 'customer') { setCustomer(r.customer); beep(); return; }
    if (r.type === 'sale') { location.hash = `#/pos/sale/${r.sale.id}`; return; }
  } catch (e) {
    // Not a code: search by name
    if (!/^\d+$/.test(code)) { search = code; drawGrid(); return; }
    beep(false);
    toast(e.status === 0 ? L('Code inconnu (hors ligne)', 'Unknown code (offline)') : e.message, 'err');
  }
}

function setCustomer(cu) {
  cart.customer = cu ? { partner_id: cu.partner_id, name: cu.name, phone: cu.phone, card_no: cu.card_no, price_level: cu.price_level, points: cu.points, wallet: cu.wallet, bonus: cu.bonus, credit_limit: cu.credit_limit, debt: cu.debt } : null;
  cart.points_used = 0; cart.bonus_used = 0;
  saveCart(); drawCart();
  if (cu) toast(`${L('Client', 'Customer')} : ${cu.name}`, 'ok');
}

// ===================== Customer display =====================
let bc = null;
try { bc = new BroadcastChannel('tk-display'); } catch {}
let displayTimer = null;
function displayState(extra = {}) {
  const p = priced();
  return {
    company: state.me.company.name, logo: state.me.company.logo || '', at: Date.now(), register_id: state.shop.session?.register_id || 0,
    status: cart.lines.length ? 'cart' : 'idle',
    lines: (p?.lines || []).map((l) => ({ d: l.description, q: l.qty, u: l.unit_price, t: l.total, promo: l.promo_name, pa: l.promo_amount })),
    total: p?.total || 0, savings: (p?.promo_total || 0) + (p?.discount_total || 0), customer: cart.customer ? { name: cart.customer.name, points: cart.customer.points } : null,
    last: cart.lines.length ? cat?.byId[lastAdded]?.name : '', ...extra,
  };
}
function pushDisplay(extra) {
  const s = displayState(extra);
  try { bc?.postMessage(s); } catch {}
  clearTimeout(displayTimer);
  displayTimer = setTimeout(() => { if (net.online && state.shop?.session) api.post('/api/shop/display', { register_id: s.register_id, state: s }).catch(() => {}); }, extra ? 0 : 500);
}

/** The screen facing the customer: same computer (second monitor) or a tablet signed in on the same account. */
export async function display(ctx) {
  const reg = Number(ctx.query.register) || 0;
  document.title = L('Écran client', 'Customer display');
  const el = ctx.el;
  const draw = (s) => {
    if (!s || s.status === 'idle') {
      el.innerHTML = `<div class="cd idle"><div class="cd-brand">${s?.logo ? `<img src="${esc(s.logo)}" alt="">` : ''}<h1>${esc(s?.company || state.me.company.name)}</h1></div>
        <p class="cd-hello">${L('Bienvenue !', 'Welcome!')}</p>${promoTicker()}</div>`;
      return;
    }
    if (s.status === 'paid') {
      el.innerHTML = `<div class="cd idle paid"><h1>${L('Merci !', 'Thank you!')}</h1><div class="cd-total"><span>${L('Total payé', 'Total paid')}</span><b>${money(s.total)}</b></div>
        ${s.change ? `<div class="cd-change">${L('Monnaie rendue', 'Your change')} <b>${money(s.change)}</b></div>` : ''}
        ${s.points_earned ? `<p class="cd-hello">+${s.points_earned} ${L('points fidélité', 'loyalty points')}</p>` : ''}<p class="muted">${L('À bientôt', 'See you soon')} · ${esc(s.company)}</p></div>`;
      return;
    }
    el.innerHTML = `<div class="cd"><div class="cd-head">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : ''}<b>${esc(s.company)}</b>${s.customer ? `<span class="cd-cust">${icon('star')} ${esc(s.customer.name)} · ${num(s.customer.points)} pts</span>` : ''}</div>
      ${s.last ? `<div class="cd-last">${esc(s.last)}</div>` : ''}
      <div class="cd-lines">${s.lines.slice().reverse().map((l) => `<div class="cd-l"><span>${esc(l.d)}${l.promo ? `<em>${esc(l.promo)} −${num(l.pa)}</em>` : ''}</span><span class="dim">${qtyFmt(l.q)} × ${num(l.u)}</span><b>${num(l.t)}</b></div>`).join('')}</div>
      ${s.savings ? `<div class="cd-save">${L('Vous économisez', 'You save')} ${money(s.savings)}</div>` : ''}
      <div class="cd-total"><span>${L('À payer', 'To pay')}</span><b>${money(s.total)}</b></div></div>`;
  };
  let promos = [];
  const promoTicker = () => (promos.length ? `<div class="cd-promos">${promos.slice(0, 6).map((p) => `<div>${icon('tag')} ${esc(p.name)}</div>`).join('')}</div>` : '');
  try { promos = (await loadCatalog()).promos; } catch {}
  draw(null);
  const onMsg = (s) => { if (!reg || !s.register_id || s.register_id === reg) draw(s); };
  if (bc) bc.onmessage = (e) => onMsg(e.data);
  const h = (e) => { if (e.detail?.state && (!reg || e.detail.register_id === reg)) draw(e.detail.state); };
  window.addEventListener('tk:display', h);
  window.addEventListener('hashchange', () => window.removeEventListener('tk:display', h), { once: true });
}
display.fullscreen = true;
R('/display', display);

// ===================== Camera scanning =====================
/** Opens the camera and calls onCode for each barcode read. continuous=false closes after the first. */
export async function cameraScan(onCode, { continuous = false, title } = {}) {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    const v = await dialog({ title: title || L('Scanner', 'Scan'), submit: L('Valider', 'OK'),
      body: `<p class="muted" style="margin-top:0">${L('Ce navigateur ne lit pas les codes-barres avec la caméra. Utilisez Chrome sur Android, ou un lecteur code-barres USB/Bluetooth. Vous pouvez aussi taper le code :', 'This browser cannot read barcodes with the camera. Use Chrome on Android or a USB/Bluetooth scanner. You can also type the code:')}</p>
      <label class="fld">${L('Code-barres', 'Barcode')}<input name="code" inputmode="numeric" required autofocus></label>` });
    if (v?.code) await onCode(v.code);
    return;
  }
  let stream, stop = false;
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
  let detector;
  try { detector = new window.BarcodeDetector({ formats: (await window.BarcodeDetector.getSupportedFormats()).filter((f) => formats.includes(f)) }); } catch { detector = new window.BarcodeDetector(); }
  const last = { code: '', at: 0 };
  await dialog({
    title: title || L('Scanner avec la caméra', 'Scan with the camera'), submit: null, cancel: L('Fermer', 'Close'),
    body: `<div class="cam"><video playsinline muted></video><div class="cam-frame"></div></div><p class="muted" id="camlast" style="margin:10px 0 0;text-align:center">${L('Visez le code-barres', 'Point at the barcode')}</p>`,
    onOpen: async (d) => {
      const video = d.querySelector('video');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
        video.srcObject = stream; await video.play();
      } catch (e) { d.querySelector('#camlast').textContent = L('Caméra refusée ou indisponible.', 'Camera denied or unavailable.'); return; }
      const tick = async () => {
        if (stop || !d.open) { stream?.getTracks().forEach((t) => t.stop()); return; }
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const code = codes[0].rawValue;
            if (code !== last.code || Date.now() - last.at > 2500) {
              last.code = code; last.at = Date.now();
              d.querySelector('#camlast').textContent = code;
              await onCode(code);
              if (!continuous) { stop = true; d.querySelector('[data-x]')?.click(); }
            }
          }
        } catch {}
        setTimeout(tick, 250);
      };
      tick();
      d.addEventListener('close', () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); });
    },
  });
  stop = true; stream?.getTracks().forEach((t) => t.stop());
}

// ===================== The till =====================
let search = '', catFilter = '', posEl = null;

export async function till(ctx) {
  document.title = `${L('Caisse', 'Till')} · ${state.brand?.name || 'Teknons POS'}`;
  state.shop = await api.get('/api/shop/meta');
  posEl = ctx.el;
  if (!state.shop.session) return openSessionScreen(ctx);
  try { await loadCatalog(true); } catch (e) { showError(e); }
  // the cached basket may refer to another store's articles
  cart.lines = cart.lines.filter((l) => cat?.byId[l.product_id]);
  const s = state.shop.session;
  ctx.el.innerHTML = `<div class="pos">
  <header class="pos-top">
    <a class="iconbtn dark" href="#/" aria-label="${L('Retour', 'Back')}">${icon('home')}</a>
    <div class="pos-id"><b>${esc(s.register_name)}</b><span>${esc(s.store_name)} · ${esc(state.me.user.name)} · ${esc(s.number)}</span></div>
    <span class="pos-net" id="posnet"></span>
    <div class="row" style="margin-left:auto;gap:6px">
      <button class="btn dark sm" id="bdisp" title="${L('Écran client', 'Customer display')}">${icon('monitor')}<span class="hide-m">${L('Écran client', 'Customer display')}</span></button>
      <a class="btn dark sm" href="#/pos/sales?session_id=${s.id}">${icon('receipt')}<span class="hide-m">${L('Tickets', 'Receipts')}</span></a>
      <button class="btn dark sm" id="bmenu">${icon('more')}<span class="hide-m">${L('Caisse', 'Till')}</span></button>
    </div>
  </header>
  <section class="pos-left">
    <form class="pos-scan" id="scanf" autocomplete="off">
      <span class="pos-scan-ic">${icon('scan')}</span>
      <input id="scan" placeholder="${L('Scanner ou taper un code-barres, un nom, « 3*code »…', 'Scan or type a barcode, a name, "3*code"…')}" autocomplete="off" enterkeyhint="enter">
      <button type="button" class="btn" id="bcam" aria-label="${L('Caméra', 'Camera')}">${icon('camera')}</button>
    </form>
    <div class="pos-cats" id="cats"></div>
    <div class="pos-grid" id="grid"></div>
  </section>
  <section class="pos-right">
    <div class="pos-cust" id="cust"></div>
    <div class="pos-lines" id="lines"></div>
    <div class="pos-tot" id="tot"></div>
    <div class="pos-act">
      <button class="btn" id="bclear">${icon('trash')}<span>${L('Vider', 'Clear')}</span></button>
      <button class="btn" id="bdisc">${icon('percent')}<span>${L('Remise', 'Discount')}</span></button>
      <button class="btn primary pay" id="bpay">${L('Encaisser', 'Pay')} <kbd>F4</kbd></button>
    </div>
  </section></div>`;
  const scan = ctx.el.querySelector('#scan');
  ctx.el.querySelector('#scanf').addEventListener('submit', async (e) => { e.preventDefault(); const v = scan.value; scan.value = ''; await handleCode(v); });
  scan.addEventListener('input', () => { if (!/^\d{5,}$/.test(scan.value) && scan.value.length >= 2) { search = scan.value; drawGrid(); } else if (!scan.value) { search = ''; drawGrid(); } });
  ctx.el.querySelector('#bcam').addEventListener('click', () => cameraScan(handleCode, { continuous: true }));
  ctx.el.querySelector('#bclear').addEventListener('click', async () => { if (cart.lines.length && await confirmDlg(L('Vider le panier', 'Clear basket'), L('Retirer tous les articles ?', 'Remove all items?'), L('Vider', 'Clear'), true)) { cart = emptyCart(); saveCart(); drawCart(); } });
  ctx.el.querySelector('#bdisc').addEventListener('click', basketDiscount);
  ctx.el.querySelector('#bpay').addEventListener('click', pay);
  ctx.el.querySelector('#bmenu').addEventListener('click', tillMenu);
  ctx.el.querySelector('#bdisp').addEventListener('click', () => {
    window.open(`/#/display?register=${s.register_id}`, 'tk-display', 'popup,width=1024,height=700');
    toast(L('Faites glisser la fenêtre sur l\'écran tourné vers le client (F11 pour plein écran). Sur une tablette : connectez-vous et ouvrez « Écran client ».', 'Drag the window to the customer-facing screen (F11 for full screen). On a tablet: sign in and open "Customer display".'));
  });
  drawCats(); drawGrid(); drawCart(); drawNet();
  net.on(drawNet);
  scan.focus();
  // A barcode scanner types fast then presses Enter: send keystrokes to the scan box when nothing else has focus.
  const onKey = (e) => {
    if (!document.body.contains(posEl.querySelector('.pos'))) { document.removeEventListener('keydown', onKey); return; }
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'F4') { e.preventDefault(); pay(); return; }
    if (e.key === 'F2') { e.preventDefault(); scan.focus(); return; }
    if (e.key === 'F8') { e.preventDefault(); pickCustomer(); return; }
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) scan.focus();
  };
  document.addEventListener('keydown', onKey);
  pushDisplay();
}
till.fullscreen = true;
till.noLiveRender = true;
R('/pos', till);

function drawNet() {
  const el = posEl?.querySelector('#posnet');
  if (!el) return;
  const n = net.outbox().filter((x) => x.path === '/api/shop/sales').length;
  el.innerHTML = net.online ? (n ? `<span class="pill warn">${n} ${L('ticket(s) à synchroniser', 'receipt(s) to sync')}</span>` : '') : `<span class="pill bad">${L('Hors ligne : la caisse continue', 'Offline: still selling')}</span>`;
}

function drawCats() {
  const el = posEl.querySelector('#cats');
  el.innerHTML = `<button class="${!catFilter ? 'on' : ''}" data-cat="">${L('Favoris', 'Favourites')}</button>${cat.categories.map((c) => `<button class="${String(catFilter) === String(c.id) ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}`;
  el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { catFilter = b.dataset.cat; search = ''; posEl.querySelector('#scan').value = ''; drawCats(); drawGrid(); }));
}
function drawGrid() {
  const el = posEl.querySelector('#grid');
  const s = search.toLowerCase();
  let items = cat.items;
  if (s) items = items.filter((i) => i.name.toLowerCase().includes(s) || (i.barcode || '').includes(s));
  else if (catFilter) items = items.filter((i) => String(i.category_id) === String(catFilter));
  else { const q = items.filter((i) => i.quick); items = q.length ? q : items; }
  items = items.slice(0, 120);
  const promoOf = (it) => cat.promos.find((p) => p.active && (Number(p.product_id) === it.product_id || (p.category_id && Number(p.category_id) === Number(it.category_id))));
  el.innerHTML = items.length ? items.map((i) => { const p = promoOf(i); return `<button class="pos-item ${i.qty <= 0 ? 'out' : ''}" data-id="${i.product_id}">
    ${p ? `<span class="pos-promo">${icon('tag')}</span>` : ''}<span class="nm">${esc(i.name)}</span><span class="pr">${num(i.retail_price)}${i.by_weight ? '<small>/kg</small>' : ''}</span><span class="st">${qtyFmt(i.qty)} ${esc(i.unit || '')}</span></button>`; }).join('')
    : `<div class="empty"><b>${L('Aucun article', 'No items')}</b>${s ? L('Aucun résultat pour cette recherche.', 'No match.') : L('Ajoutez des articles dans « Articles ».', 'Add items under "Items".')}</div>`;
  el.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
    const it = cat.byId[b.dataset.id];
    if (it.by_weight) {
      const v = await dialog({ title: it.name, submit: L('Ajouter', 'Add'), body: `<label class="fld">${L('Poids (kg)', 'Weight (kg)')}<input name="q" type="number" step="0.001" min="0.001" inputmode="decimal" required autofocus></label><p class="muted">${money(it.retail_price)} / kg</p>` });
      if (v?.q) addItem(it, Number(v.q));
    } else addItem(it, 1);
    posEl.querySelector('#scan').focus();
  }));
}

function drawCart() {
  if (!posEl?.querySelector('#lines')) return;
  const p = priced();
  const cu = cart.customer;
  posEl.querySelector('#cust').innerHTML = cu
    ? `<div class="pc-on"><span class="av">${icon('star')}</span><div><b>${esc(cu.name)}</b><small>${cu.price_level === 'wholesale' ? `<span class="pill info">${L('Prix de gros', 'Wholesale')}</span> ` : ''}${num(cu.points)} pts${cu.wallet ? ` · ${L('prépayé', 'prepaid')} ${num(cu.wallet)}` : ''}${cu.bonus ? ` · bonus ${num(cu.bonus)}` : ''}${cu.debt ? ` · <span style="color:var(--bad)">${L('doit', 'owes')} ${num(cu.debt)}</span>` : ''}</small></div>
       <button class="btn sm" id="bcust">${L('Changer', 'Change')}</button><button class="btn ghost sm" id="bnocust" aria-label="${L('Retirer le client', 'Remove customer')}">${icon('x')}</button></div>`
    : `<button class="pc-off" id="bcust">${icon('user')} ${L('Client / carte de fidélité', 'Customer / loyalty card')} <kbd>F8</kbd></button>`;
  posEl.querySelector('#bcust').addEventListener('click', pickCustomer);
  posEl.querySelector('#bnocust')?.addEventListener('click', () => setCustomer(null));
  const lines = posEl.querySelector('#lines');
  if (!cart.lines.length) {
    lines.innerHTML = `<div class="pos-empty">${icon('cart')}<b>${L('Panier vide', 'Empty basket')}</b><span>${L('Scannez un article ou touchez un bouton.', 'Scan an item or tap a button.')}</span></div>`;
  } else {
    lines.innerHTML = cart.lines.map((l, i) => {
      const pl = p?.lines[i]; const it = cat.byId[l.product_id];
      return `<div class="pl ${l.product_id === lastAdded && i === cart.lines.length - 1 ? 'new' : ''}" data-i="${i}">
        <div class="pl-d"><b>${esc(it?.name || '?')}</b><small>${qtyFmt(l.qty)} × ${num(pl?.unit_price ?? 0)}${pl?.unit_price !== it?.retail_price && !l.price_override ? ` <span class="pill info">${L('gros', 'wholesale')}</span>` : ''}${l.price_override ? ` <span class="pill warn">${L('prix modifié', 'price changed')}</span>` : ''}
        ${pl?.promo_amount ? `<span class="pl-promo">${icon('tag')} ${esc(pl.promo_name)} −${num(pl.promo_amount)}</span>` : ''}${l.discount_pct ? `<span class="pl-promo">−${l.discount_pct} %</span>` : ''}</small></div>
        <div class="pl-q">${it?.by_weight ? '' : `<button class="qb" data-dec="${i}" aria-label="−">${icon('minus')}</button>`}<span>${qtyFmt(l.qty)}</span>${it?.by_weight ? '' : `<button class="qb" data-inc="${i}" aria-label="+">${icon('plus')}</button>`}</div>
        <b class="pl-t num">${num(pl?.total ?? 0)}</b></div>`;
    }).join('');
    lines.querySelector('.pl.new')?.scrollIntoView({ block: 'nearest' });
    lines.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); cart.lines[b.dataset.inc].qty++; saveCart(); drawCart(); }));
    lines.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const l = cart.lines[b.dataset.dec]; if (l.qty > 1) l.qty--; else cart.lines.splice(b.dataset.dec, 1); saveCart(); drawCart(); }));
    lines.querySelectorAll('.pl').forEach((r) => r.addEventListener('click', () => editLine(Number(r.dataset.i))));
  }
  const items = cart.lines.reduce((t, l) => t + (cat.byId[l.product_id]?.by_weight ? 1 : Number(l.qty)), 0);
  posEl.querySelector('#tot').innerHTML = p ? `
    <div><span>${L('Articles', 'Items')}</span><span>${qtyFmt(items)}</span></div>
    ${p.promo_total ? `<div class="sv"><span>${L('Promotions', 'Promotions')}</span><span>−${num(p.promo_total)}</span></div>` : ''}
    ${p.discount_total ? `<div class="sv"><span>${L('Remises, points, bonus', 'Discounts, points, bonus')}</span><span>−${num(p.discount_total)}</span></div>` : ''}
    <div class="dim"><span>${L('dont TVA', 'incl. VAT')}</span><span>${num(p.vat_total)}</span></div>
    <div class="big"><span>${L('TOTAL', 'TOTAL')}</span><span>${money(p.total)}</span></div>` : '';
  posEl.querySelector('#bpay').disabled = !cart.lines.length;
}

async function editLine(i) {
  const l = cart.lines[i]; const it = cat.byId[l.product_id];
  const v = await dialog({ title: it.name, submit: L('Appliquer', 'Apply'), cancel: L('Annuler', 'Cancel'),
    body: `<div class="f2">${field({ name: 'qty', label: it.by_weight ? L('Poids (kg)', 'Weight (kg)') : L('Quantité', 'Quantity'), type: 'number', step: it.by_weight ? '0.001' : '1', min: 0, value: l.qty })}
      ${field({ name: 'price_override', label: L('Prix unitaire TTC (vide = normal)', 'Unit price (empty = normal)'), type: 'number', min: 0, value: l.price_override ?? '', placeholder: String(it.retail_price) })}
      ${field({ name: 'discount_pct', label: L('Remise (%)', 'Discount (%)'), type: 'number', step: '0.5', min: 0, value: l.discount_pct || '' })}</div>
      <p class="muted" style="margin-bottom:0">${L(`Prix modifié ou remise au-delà de ${state.shop.settings.max_discount_pct} % : le code gérant sera demandé à l'encaissement.`, `Changed price or discount above ${state.shop.settings.max_discount_pct}%: the manager code is asked at payment.`)}</p>
      <button type="button" class="btn danger" id="del" style="margin-top:12px">${icon('trash')} ${L('Retirer la ligne', 'Remove line')}</button>`,
    onOpen: (d) => d.querySelector('#del').addEventListener('click', () => { cart.lines.splice(i, 1); saveCart(); drawCart(); d.querySelector('[data-x]').click(); }) });
  if (!v || !cart.lines[i]) return;
  const q = Number(v.qty);
  if (!(q > 0)) cart.lines.splice(i, 1);
  else Object.assign(cart.lines[i], { qty: q, price_override: v.price_override === '' ? undefined : Number(v.price_override), discount_pct: Number(v.discount_pct) || 0 });
  saveCart(); drawCart();
}

async function basketDiscount() {
  const cu = cart.customer;
  const s = state.shop.settings;
  const v = await dialog({ title: L('Remise, points et bonus', 'Discount, points and bonus'), submit: L('Appliquer', 'Apply'),
    body: `<div class="form">${field({ name: 'discount_amount', label: L('Remise sur le ticket (FCFA)', 'Basket discount (FCFA)'), type: 'number', min: 0, value: cart.discount_amount || '' })}
      ${cu ? `${field({ name: 'points_used', label: `${L('Points à utiliser', 'Points to use')} (${L('solde', 'balance')} ${num(cu.points)}, 1 pt = ${s.point_value} FCFA, min ${s.min_points_redeem})`, type: 'number', min: 0, value: cart.points_used || '' })}
      ${field({ name: 'bonus_used', label: `${L('Bonus à utiliser (FCFA)', 'Bonus to use (FCFA)')} (${L('disponible', 'available')} ${num(cu.bonus)})`, type: 'number', min: 0, value: cart.bonus_used || '' })}
      <div class="row"><button type="button" class="btn sm" id="allpts">${L('Tous les points', 'All points')}</button><button type="button" class="btn sm" id="allbonus">${L('Tout le bonus', 'All bonus')}</button></div>`
    : `<p class="muted">${L('Choisissez un client pour utiliser ses points de fidélité ou son bonus.', 'Pick a customer to use their loyalty points or bonus.')}</p>`}</div>`,
    onOpen: (d) => {
      d.querySelector('#allpts')?.addEventListener('click', () => { d.querySelector('[name=points_used]').value = cu.points; });
      d.querySelector('#allbonus')?.addEventListener('click', () => { d.querySelector('[name=bonus_used]').value = cu.bonus; });
    } });
  if (!v) return;
  const pts = Math.floor(Number(v.points_used) || 0), bonus = Math.floor(Number(v.bonus_used) || 0);
  if (cu && pts > cu.points) return toast(L('Pas assez de points', 'Not enough points'), 'err');
  if (cu && pts && pts < s.min_points_redeem) return toast(`${L('Minimum', 'Minimum')} ${s.min_points_redeem} points`, 'err');
  if (cu && bonus > cu.bonus) return toast(L('Bonus insuffisant', 'Not enough bonus'), 'err');
  Object.assign(cart, { discount_amount: Math.floor(Number(v.discount_amount) || 0), points_used: pts, bonus_used: bonus });
  saveCart(); drawCart();
}

export async function pickCustomer(onPick) {
  const pick = typeof onPick === 'function' ? onPick : setCustomer;
  let list = cat?.customers || [];
  let chosen = null;
  const v = await dialog({ title: L('Client', 'Customer'), submit: L('Nouveau client', 'New customer'), cancel: L('Fermer', 'Close'), wide: true,
    body: `<div class="row" style="flex-wrap:nowrap"><input class="in" id="cq" placeholder="${L('Nom, téléphone ou n° de carte', 'Name, phone or card number')}" autofocus><button type="button" class="btn" id="ccam">${icon('camera')}</button></div>
      <div id="cres" class="cust-list"></div>`,
    onOpen: (d) => {
      const q = d.querySelector('#cq'), res = d.querySelector('#cres');
      const draw = () => {
        const s = q.value.toLowerCase().trim();
        const rows = (s ? list.filter((c) => c.name.toLowerCase().includes(s) || (c.phone || '').includes(s) || (c.card_no || '').toLowerCase().includes(s)) : list).slice(0, 40);
        res.innerHTML = rows.length ? rows.map((c) => `<button type="button" class="cust-it" data-id="${c.partner_id}"><b>${esc(c.name)}</b><span>${esc(c.phone || '')} · ${esc(c.card_no || '')}</span><span>${num(c.points)} pts${c.wallet ? ` · ${num(c.wallet)} ${L('prépayé', 'prepaid')}` : ''}</span></button>`).join('')
          : `<p class="muted">${L('Aucun client. Créez-le avec « Nouveau client ».', 'No customer. Create one with "New customer".')}</p>`;
        res.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
          chosen = list.find((c) => String(c.partner_id) === b.dataset.id);
          try { chosen = await api.get(`/api/shop/customers/${chosen.partner_id}`); } catch {}
          d.querySelector('[data-x]').click();
        }));
      };
      q.addEventListener('input', draw);
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const m = list.find((c) => (c.card_no || '').toUpperCase() === q.value.trim().toUpperCase()); if (m) { chosen = m; d.querySelector('[data-x]').click(); } } });
      d.querySelector('#ccam').addEventListener('click', () => cameraScan(async (code) => { const m = list.find((c) => (c.card_no || '').toUpperCase() === code.toUpperCase()); if (m) { chosen = m; d.querySelector('[data-x]').click(); } else toast(L('Carte inconnue', 'Unknown card'), 'err'); }));
      draw();
    },
    onSubmit: () => true });
  if (chosen) return pick(chosen);
  if (v) { const c = await customerDialog(); if (c) { if (cat) { cat.customers.push(c); } pick(c); } }
}

export function customerDialog(c) {
  const fields = [
    { name: 'name', label: L('Nom', 'Name'), required: true }, { name: 'phone', label: L('Téléphone (WhatsApp)', 'Phone (WhatsApp)') },
    { name: 'card_no', label: L('N° carte de fidélité (vide = automatique)', 'Loyalty card no. (empty = automatic)') }, { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'price_level', label: L('Tarif', 'Price level'), type: 'select', options: [['retail', L('Détail', 'Retail')], ['wholesale', L('Gros (revendeur)', 'Wholesale (reseller)')]] },
    { name: 'birthday', label: L('Anniversaire', 'Birthday'), type: 'date' },
  ];
  if (isManager()) fields.push({ name: 'credit_limit', label: L('Plafond de crédit (FCFA, 0 = pas de crédit)', 'Credit limit (FCFA, 0 = none)'), type: 'number', min: 0 });
  return dialog({ title: c ? L('Modifier le client', 'Edit customer') : L('Nouveau client', 'New customer'), body: `<div class="f2">${fields.map((f) => field(f, c || {})).join('')}</div>`,
    onSubmit: (v) => (c ? api.put(`/api/shop/customers/${c.partner_id}`, v) : api.post('/api/shop/customers', v)) });
}

// ===================== Payment =====================
async function pay() {
  const p = priced();
  if (!p || !cart.lines.length) return;
  const cu = cart.customer;
  const total = p.total;
  const pays = { cash: '', mtn_momo: '', orange_money: '', card: '', wallet: '', credit: '' };
  const refs = {}; const momoIds = {};
  const quick = [...new Set([total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000])].filter((x) => x >= total).slice(0, 4);
  const avail = (m) => (m === 'wallet' ? !!cu?.wallet : m === 'credit' ? !!cu : true);
  const res = await dialog({
    title: `${L('Encaisser', 'Payment')} · ${money(total)}`, submit: L('Valider la vente', 'Complete sale'), wide: true,
    body: `<div class="payg">
      <div class="pay-total"><span>${L('À payer', 'To pay')}</span><b>${money(total)}</b></div>
      ${['cash', 'mtn_momo', 'orange_money', 'card', 'wallet', 'credit'].filter(avail).map((m) => `<div class="pay-row" data-m="${m}">
        <span class="pay-m">${esc(methodLabel(m))}${m === 'wallet' ? `<small>${L('solde', 'balance')} ${num(cu.wallet)}</small>` : ''}${m === 'credit' ? `<small>${cu.credit_limit ? `${L('plafond', 'limit')} ${num(cu.credit_limit)} · ${L('dû', 'owed')} ${num(cu.debt || 0)}` : L('pas de crédit autorisé', 'no credit allowed')}</small>` : ''}</span>
        <input class="in num" type="number" min="0" inputmode="numeric" name="${m}" placeholder="0">
        <button type="button" class="btn sm" data-fill="${m}">${L('Le reste', 'Rest')}</button>
        ${['mtn_momo', 'orange_money'].includes(m) ? `<div class="pay-momo"><input class="in" name="ph_${m}" placeholder="${L('N° du client (demande sur son téléphone)', 'Customer number (prompt on their phone)')}" value="${esc(cu?.phone || '')}" inputmode="tel">
          <button type="button" class="btn sm primary" data-push="${m}">${icon('phone')} ${L('Envoyer la demande', 'Send prompt')}</button><span class="momo-st" id="st_${m}"></span>
          <input class="in" name="ref_${m}" placeholder="${L('ou n° de transaction (paiement sur le numéro marchand)', 'or transaction no. (paid to merchant number)')}"></div>` : ''}
        ${m === 'card' ? `<div class="pay-momo"><input class="in" name="ref_card" placeholder="${L('N° d\'autorisation TPE (optionnel)', 'Card terminal auth. no. (optional)')}"></div>` : ''}
      </div>`).join('')}
      <div class="pay-quick">${quick.map((q) => `<button type="button" class="btn" data-cash="${q}">${num(q)}</button>`).join('')}</div>
      <div class="pay-sum" id="psum"></div>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="autoprint" ${store.get('tk:autoprint', false) ? 'checked' : ''}> ${L('Imprimer le ticket automatiquement', 'Print receipt automatically')}</label>
    </div>`,
    onOpen: (d) => {
      const inp = (m) => d.querySelector(`[name=${m}]`);
      const sum = () => {
        let other = 0, cash = 0;
        for (const m of Object.keys(pays)) { const el = inp(m); if (!el) continue; const v = Math.max(0, Math.round(Number(el.value) || 0)); if (m === 'cash') cash = v; else other += v; }
        const left = total - other - cash;
        const change = Math.max(0, cash - Math.max(0, total - other));
        d.querySelector('#psum').innerHTML = other > total ? `<span class="bad">${L('Les paiements dépassent le total', 'Payments exceed the total')}</span>`
          : left > 0 ? `<span>${L('Reste à payer', 'Left to pay')}</span><b class="bad">${money(left)}</b>` : `<span>${L('Monnaie à rendre', 'Change')}</span><b class="ok">${money(change)}</b>`;
        d.querySelector('button[value=ok]').disabled = left > 0 || other > total;
        pushDisplay({ status: 'cart' });
      };
      d.querySelectorAll('input.num').forEach((i) => i.addEventListener('input', sum));
      d.querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', () => {
        let other = 0; for (const m of Object.keys(pays)) { if (m !== b.dataset.fill && inp(m)) other += Math.round(Number(inp(m).value) || 0); }
        const v = Math.max(0, total - other); inp(b.dataset.fill).value = b.dataset.fill === 'wallet' ? Math.min(v, cu.wallet) : v; sum();
      }));
      d.querySelectorAll('[data-cash]').forEach((b) => b.addEventListener('click', () => { inp('cash').value = b.dataset.cash; sum(); }));
      d.querySelectorAll('[data-push]').forEach((b) => b.addEventListener('click', async () => {
        const m = b.dataset.push; const st = d.querySelector(`#st_${m}`);
        let amount = Math.round(Number(inp(m).value) || 0);
        if (!amount) { let other = 0; for (const k of Object.keys(pays)) if (k !== m && inp(k)) other += Math.round(Number(inp(k).value) || 0); amount = Math.max(0, total - other); inp(m).value = amount; sum(); }
        if (!amount) return;
        b.disabled = true; st.innerHTML = `<span class="pill info">${L('Demande envoyée, le client confirme avec son code…', 'Prompt sent, customer confirms with PIN…')}</span>`;
        try {
          const r = await api.post('/api/shop/momo', { provider: m, phone: d.querySelector(`[name=ph_${m}]`).value, amount });
          inp(m).readOnly = true;
          for (let k = 0; k < 120 && d.open; k++) {
            await new Promise((x) => setTimeout(x, 2500));
            const s = await api.get(`/api/shop/momo/${r.id}`, { cache: false });
            if (s.status === 'successful') { momoIds[m] = r.id; refs[m] = s.transaction_id; st.innerHTML = `<span class="pill ok">${L('Payé', 'Paid')} · ${esc(s.transaction_id || '')}</span>`; beep(); return; }
            if (s.status === 'failed') { st.innerHTML = `<span class="pill bad">${L('Échec', 'Failed')} : ${esc(s.reason || '')}</span>`; inp(m).readOnly = false; b.disabled = false; return; }
          }
        } catch (e) { st.innerHTML = `<span class="pill bad">${esc(e.message)}</span>`; inp(m).readOnly = false; b.disabled = false; }
      }));
      inp('cash').focus();
      sum();
    },
    onSubmit: async (v) => {
      store.set('tk:autoprint', document.getElementById('autoprint')?.checked);
      for (const m of ['mtn_momo', 'orange_money']) if (Number(v[m]) > 0 && v[`ph_${m}`] && !momoIds[m] && !v[`ref_${m}`] && document.getElementById(`st_${m}`)?.textContent) throw new Error(L('Attendez la confirmation Mobile Money', 'Wait for the Mobile Money confirmation'));
      const payments = Object.keys(pays).filter((m) => Number(v[m]) > 0).map((m) => ({ method: m, amount: Math.round(Number(v[m])), reference: refs[m] || v[`ref_${m}`] || '', momo_id: momoIds[m] }));
      return payments;
    },
  });
  if (!res) { pushDisplay(); return; }
  await finishSale(res, p);
}

async function finishSale(payments, p) {
  const body = {
    session_id: state.shop.session.id, customer_id: cart.customer?.partner_id, lines: cart.lines, discount_amount: cart.discount_amount,
    points_used: cart.points_used, bonus_used: cart.bonus_used, payments, offline: !net.online || !!cat?._offline,
  };
  let sale;
  try {
    sale = await withPin((pin) => api.post('/api/shop/sales', { ...body, manager_pin: pin }, { label: `Ticket ${money(p.total)}` }));
  } catch (e) { fail(e); return; }
  const cash = payments.find((x) => x.method === 'cash')?.amount || 0;
  const other = payments.filter((x) => x.method !== 'cash').reduce((t, x) => t + x.amount, 0);
  const change = Math.max(0, cash - Math.max(0, p.total - other));
  const earned = cart.customer ? pointsFor(p.total - (payments.find((x) => x.method === 'credit')?.amount || 0), state.shop.settings) : 0;
  pushDisplay({ status: 'paid', total: p.total, change, points_earned: earned });
  // update the cached stock so the buttons stay right offline
  for (const l of p.lines) if (cat.byId[l.product_id]) cat.byId[l.product_id].qty -= l.qty;
  const snapshot = { ...cart, priced: p, payments, change };
  cart = emptyCart(); store.set('tk:cart', cart); drawCart(); // keep "Thank you" on the customer display for a few seconds
  setTimeout(() => { if (!cart.lines.length) pushDisplay(); }, 6000);
  if (sale._queued) {
    toast(L('Ticket enregistré sur cet appareil. Il sera envoyé au retour d\'internet.', 'Receipt saved on this device. It will sync when internet is back.'), 'ok');
    drawNet();
    await afterSaleDialog(null, snapshot);
    return;
  }
  if (store.get('tk:autoprint', false)) window.open(`/print/shop/receipt/${sale.id}?print=1`, '_blank');
  await afterSaleDialog(sale, snapshot);
  if (Date.now() - (cat?._loaded || 0) > 60_000) loadCatalog(true).catch(() => {});
}

async function afterSaleDialog(sale, snap) {
  const link = sale ? `${location.origin}/r/${sale.token}` : '';
  const phone = sale?.customer_phone || snap.customer?.phone || '';
  const msg = sale ? L(`Merci pour votre achat chez ${state.me.company.name} ! Votre ticket ${sale.number} de ${money(sale.total)} : ${link}${sale.customer ? `\nVos points fidélité : ${sale.customer.points}` : ''}`,
    `Thank you for shopping at ${state.me.company.name}! Your receipt ${sale.number} for ${money(sale.total)}: ${link}`) : '';
  await dialog({
    title: sale ? `${L('Vente enregistrée', 'Sale recorded')} · ${sale.number}` : L('Vente enregistrée (hors ligne)', 'Sale recorded (offline)'), submit: L('Nouvelle vente', 'New sale'), cancel: null,
    body: `<div class="done">${snap.change ? `<div class="done-change"><span>${L('Monnaie à rendre', 'Change to give')}</span><b>${money(snap.change)}</b></div>` : `<div class="done-change ok"><span>${L('Payé', 'Paid')}</span><b>${money(snap.priced.total)}</b></div>`}
      ${sale?.credit_amount ? `<p>${L('Mis sur le compte client', 'Put on account')} : <b>${money(sale.credit_amount)}</b> (${esc(sale.document?.number || '')})</p>` : ''}
      ${sale?.points_earned ? `<p>${icon('star')} +${sale.points_earned} ${L('points', 'points')} · ${L('solde', 'balance')} ${num(sale.customer?.points)}</p>` : ''}
      <div class="row" style="justify-content:center;margin-top:14px">
        ${sale ? `<a class="btn" href="/print/shop/receipt/${sale.id}?print=1" target="_blank" rel="noopener">${icon('print')} ${L('Imprimer', 'Print')}</a>
        <a class="btn" href="https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn" href="sms:${phone ? '+' + waNumber(phone) : ''}?body=${encodeURIComponent(msg)}">SMS</a>` : `<button type="button" class="btn" id="lprint">${icon('print')} ${L('Imprimer (provisoire)', 'Print (provisional)')}</button>`}
      </div></div>`,
    onOpen: (d) => {
      d.querySelector('#lprint')?.addEventListener('click', () => printLocal(snap));
      d.querySelector('button[value=ok]')?.focus();
    },
  });
  posEl?.querySelector('#scan')?.focus();
}

/** Provisional receipt printed without internet. */
function printLocal(snap) {
  const w = window.open('', '_blank');
  if (!w) return;
  const p = snap.priced;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Ticket</title><style>body{font:12px "Courier New",monospace;width:72mm;margin:0 auto}.r{text-align:right}table{width:100%}hr{border:0;border-top:1px dashed #000}</style>
    <h3 style="text-align:center">${esc(state.me.company.name)}</h3><div style="text-align:center">${L('TICKET PROVISOIRE (hors ligne)', 'PROVISIONAL RECEIPT (offline)')}<br>${new Date().toLocaleString('fr-FR')}</div><hr>
    <table>${p.lines.map((l) => `<tr><td>${esc(l.description)}<br>${qtyFmt(l.qty)} × ${num(l.unit_price)}</td><td class="r">${num(l.total)}</td></tr>`).join('')}</table><hr>
    <table><tr><td><b>TOTAL</b></td><td class="r"><b>${num(p.total)} FCFA</b></td></tr>${snap.payments.map((x) => `<tr><td>${esc(methodLabel(x.method))}</td><td class="r">${num(x.amount)}</td></tr>`).join('')}
    ${snap.change ? `<tr><td>${L('Monnaie', 'Change')}</td><td class="r">${num(snap.change)}</td></tr>` : ''}</table><hr><div style="text-align:center">${esc(state.shop.settings.receipt_footer || '')}</div>
    <script>print()<\/script>`);
  w.document.close();
}

// ===================== Session actions =====================
async function tillMenu() {
  const s = state.shop.session;
  const act = await new Promise((resolve) => {
    dialog({ title: `${s.register_name} · ${s.number}`, submit: null, cancel: L('Fermer', 'Close'),
      body: `<div class="menu-grid">
        <button type="button" data-a="return">${icon('undo')}<b>${L('Retour / échange', 'Return / exchange')}</b><span>${L('Lié au ticket d\'origine', 'Linked to the original receipt')}</span></button>
        <button type="button" data-a="topup">${icon('wallet')}<b>${L('Recharger un compte prépayé', 'Top up prepaid account')}</b><span>${L('Avec bonus', 'With bonus')}</span></button>
        <button type="button" data-a="repay">${icon('cash')}<b>${L('Remboursement de crédit', 'Credit repayment')}</b><span>${L('Le client paie sa dette', 'Customer pays their debt')}</span></button>
        <button type="button" data-a="in">${icon('plus')}<b>${L('Entrée de caisse', 'Cash in')}</b><span>${L('Fond complémentaire', 'Extra float')}</span></button>
        <button type="button" data-a="out">${icon('minus')}<b>${L('Sortie de caisse', 'Cash out')}</b><span>${L('Dépôt au coffre, banque', 'To safe, bank')}</span></button>
        <button type="button" data-a="x">${icon('print')}<b>${L('Rapport X', 'X report')}</b><span>${L('Point de caisse sans clôturer', 'Mid-day report')}</span></button>
        <button type="button" data-a="sound">${icon('bell')}<b>${store.get('tk:mute', false) ? L('Activer le bip', 'Turn beep on') : L('Couper le bip', 'Mute beep')}</b><span>${L('Son du scanner', 'Scanner sound')}</span></button>
        <button type="button" data-a="close" class="danger">${icon('lock')}<b>${L('Clôturer la caisse', 'Close the till')}</b><span>${L('Compter le tiroir, rapport Z', 'Count drawer, Z report')}</span></button>
      </div>`,
      onOpen: (d) => d.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { resolve(b.dataset.a); d.querySelector('[data-x]').click(); })),
    }).then(() => resolve(null));
  });
  try {
    if (act === 'return') await returnFlow();
    if (act === 'topup') await topupFlow();
    if (act === 'repay') await repayFlow();
    if (act === 'in' || act === 'out') await cashMoveFlow(act);
    if (act === 'x') window.open(`/print/shop/session/${s.id}`, '_blank');
    if (act === 'sound') { store.set('tk:mute', !store.get('tk:mute', false)); toast(L('Réglage enregistré', 'Saved'), 'ok'); }
    if (act === 'close') await closeFlow();
  } catch (e) { fail(e); }
}

async function returnFlow(saleArg) {
  let sale = saleArg;
  if (!sale) {
    const v = await dialog({ title: L('Retour / échange', 'Return / exchange'), submit: L('Chercher', 'Find'),
      body: `<label class="fld">${L('N° du ticket (scannez le code-barres du ticket)', 'Receipt no. (scan the receipt barcode)')}<input name="code" required autofocus placeholder="TK-2026-000123"></label>` });
    if (!v) return;
    const r = await api.get(`/api/shop/lookup?code=${encodeURIComponent(v.code.trim())}`, { cache: false });
    if (r.type !== 'sale') throw new Error(L('Ce code n\'est pas un ticket', 'This code is not a receipt'));
    sale = r.sale;
  }
  if (sale.kind !== 'sale' || sale.status !== 'completed') throw new Error(L('Ce ticket ne peut pas être retourné', 'This receipt cannot be returned'));
  const v = await dialog({ title: `${L('Retour sur', 'Return on')} ${sale.number}`, submit: L('Valider le retour', 'Confirm return'), wide: true,
    body: `<p class="muted" style="margin-top:0">${dt(sale.created_at)} · ${money(sale.total)}${sale.customer_name ? ' · ' + esc(sale.customer_name) : ''}</p>
      ${table({ rows: sale.lines, columns: [{ label: L('Article', 'Item'), render: (l) => `<b>${esc(l.description)}</b><div class="muted">${qtyFmt(l.qty)} × ${num(l.unit_price)} = ${num(l.total)}${l.returned_qty ? ` · ${L('déjà retourné', 'already returned')} ${qtyFmt(l.returned_qty)}` : ''}</div>` },
        { label: L('Qté retournée', 'Qty returned'), cls: 'r', render: (l) => `<input class="in num" style="width:90px" type="number" min="0" step="any" max="${l.qty - l.returned_qty}" name="q_${l.id}" value="0">` },
        { label: L('Remettre en stock', 'Back to stock'), cls: 'r', render: (l) => `<input type="checkbox" name="rs_${l.id}" checked>` }] })}
      <div class="f2" style="margin-top:12px">${field({ name: 'refund_method', label: L('Remboursement', 'Refund'), type: 'select', options: [['cash', L('Espèces', 'Cash')], ['mtn_momo', 'MTN MoMo'], ['orange_money', 'Orange Money'], ['card', L('Carte', 'Card')], ...(sale.customer_id ? [['wallet', L('Avoir sur compte prépayé', 'Store credit (prepaid)')]] : [])] })}
      ${field({ name: 'reason', label: L('Motif', 'Reason'), required: true, placeholder: L('Produit abîmé, erreur…', 'Damaged, mistake…') })}</div>
      ${sale.document_id ? `<p class="muted">${L('Ticket à crédit : le retour réduit la facture du client (avoir).', 'Credit sale: the return reduces the customer invoice (credit note).')}</p>` : ''}` });
  if (!v) return;
  const lines = sale.lines.map((l) => ({ line_id: l.id, qty: Number(v[`q_${l.id}`]) || 0, restock: v[`rs_${l.id}`] })).filter((l) => l.qty > 0);
  const r = await withPin((pin) => api.post(`/api/shop/sales/${sale.id}/return`, { lines, refund_method: v.refund_method, reason: v.reason, session_id: state.shop.session?.id, manager_pin: pin }));
  toast(`${L('Retour enregistré', 'Return recorded')} : ${money(-r.total)}`, 'ok');
  window.open(`/print/shop/receipt/${r.id}?print=1`, '_blank');
  resetCatalog();
  return r;
}
export { returnFlow };

async function topupFlow() {
  let cu = cart.customer;
  if (!cu) { await pickCustomer((c) => { cu = c; }); if (!cu) return; }
  const s = state.shop.settings;
  const v = await dialog({ title: `${L('Recharger le compte de', 'Top up')} ${cu.name}`, submit: L('Recharger', 'Top up'),
    body: `<p class="muted" style="margin-top:0">${L('Solde actuel', 'Current balance')} : <b>${money(cu.wallet || 0)}</b>${s.topup_bonus_pct ? ` · ${L(`Bonus de ${s.topup_bonus_pct} % offert dès ${num(s.topup_bonus_min)} FCFA`, `${s.topup_bonus_pct}% bonus from ${num(s.topup_bonus_min)} FCFA`)}` : ''}</p>
      <div class="f2">${field({ name: 'amount', label: L('Montant (FCFA)', 'Amount (FCFA)'), type: 'number', min: 100, required: true })}
      ${field({ name: 'method', label: L('Payé par', 'Paid with'), type: 'select', options: [['cash', L('Espèces', 'Cash')], ['mtn_momo', 'MTN MoMo'], ['orange_money', 'Orange Money'], ['card', L('Carte', 'Card')]] })}
      ${field({ name: 'reference', label: L('Référence (optionnel)', 'Reference (optional)'), span: true })}</div>` });
  if (!v) return;
  const r = await api.post('/api/shop/topups', { ...v, customer_id: cu.partner_id, session_id: state.shop.session.id });
  toast(`${L('Compte rechargé', 'Topped up')} : ${money(r.total)}${r.bonus_granted ? ` + bonus ${money(r.bonus_granted)}` : ''}`, 'ok');
  if (cart.customer?.partner_id === cu.partner_id) setCustomer(await api.get(`/api/shop/customers/${cu.partner_id}`));
  window.open(`/print/shop/receipt/${r.id}?print=1`, '_blank');
  resetCatalog();
}

async function repayFlow() {
  let cu = cart.customer;
  if (!cu) { await pickCustomer((c) => { cu = c; }); if (!cu) return; }
  cu = await api.get(`/api/shop/customers/${cu.partner_id}`);
  if (!cu.debt) { toast(`${cu.name} ${L('ne doit rien', 'owes nothing')}`, 'ok'); return; }
  const v = await dialog({ title: `${L('Remboursement de', 'Repayment by')} ${cu.name}`, submit: L('Encaisser', 'Collect'),
    body: `<p class="muted" style="margin-top:0">${L('Dette actuelle', 'Current debt')} : <b style="color:var(--bad)">${money(cu.debt)}</b>. ${L('Les factures les plus anciennes sont soldées en premier.', 'Oldest invoices are settled first.')}</p>
      <div class="f2">${field({ name: 'amount', label: L('Montant (FCFA)', 'Amount (FCFA)'), type: 'number', min: 1, value: cu.debt, required: true })}
      ${field({ name: 'method', label: L('Payé par', 'Paid with'), type: 'select', options: [['cash', L('Espèces', 'Cash')], ['mtn_momo', 'MTN MoMo'], ['orange_money', 'Orange Money'], ['card', L('Carte', 'Card')]] })}</div>` });
  if (!v) return;
  const r = await api.post('/api/shop/repayments', { ...v, customer_id: cu.partner_id, session_id: state.shop.session.id });
  toast(`${L('Remboursement enregistré. Reste dû', 'Repayment recorded. Still owed')} : ${money(r.debt)}`, 'ok');
  if (cart.customer?.partner_id === cu.partner_id) setCustomer(await api.get(`/api/shop/customers/${cu.partner_id}`));
}

async function cashMoveFlow(kind) {
  const v = await dialog({ title: kind === 'in' ? L('Entrée de caisse', 'Cash in') : L('Sortie de caisse', 'Cash out'), submit: L('Enregistrer', 'Save'),
    body: `<div class="form">${field({ name: 'amount', label: L('Montant (FCFA)', 'Amount (FCFA)'), type: 'number', min: 1, required: true })}${field({ name: 'reason', label: L('Motif', 'Reason'), required: true, placeholder: kind === 'in' ? L('Monnaie supplémentaire', 'Extra change') : L('Dépôt au coffre', 'Safe drop') })}</div>` });
  if (!v) return;
  await api.post('/api/shop/cash-moves', { ...v, kind, session_id: state.shop.session.id });
  toast(L('Enregistré', 'Saved'), 'ok');
}

const DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5];
async function closeFlow() {
  const s = state.shop.session;
  const sum = await api.get(`/api/shop/sessions/${s.id}`, { cache: false });
  const v = await dialog({ title: `${L('Clôturer', 'Close')} ${s.register_name}`, submit: L('Clôturer la caisse', 'Close the till'), danger: true, wide: true,
    body: `<div class="grid g2"><div><h3 style="margin-top:0">${L('Comptez le tiroir', 'Count the drawer')}</h3>
      <div class="denoms">${DENOMS.map((d) => `<label><span>${num(d)}</span><input class="in num" type="number" min="0" inputmode="numeric" data-d="${d}" placeholder="0"></label>`).join('')}</div></div>
      <div><h3 style="margin-top:0">${L('Résumé de la session', 'Session summary')}</h3>
      <div class="totals" style="min-width:0">
        <div><span>${L('Ventes', 'Sales')} (${sum.sales.n})</span><b>${money(sum.sales.total)}</b></div>
        ${sum.byMethod.map((m) => `<div><span>${esc(methodLabel(m.method))}</span><span>${money(m.amount)}</span></div>`).join('')}
        <div><span>${L('Fond de caisse', 'Opening float')}</span><span>${money(sum.cash.opening)}</span></div>
        <div><span>${L('Entrées / sorties', 'Cash in / out')}</span><span>${money(sum.cash.in - sum.cash.out)}</span></div>
        <div><span>${L('Remboursements de crédit', 'Credit repayments')}</span><span>${money(sum.cash.repayments)}</span></div>
        <div class="big"><span>${L('Espèces attendues', 'Expected cash')}</span><span>${money(sum.cash.expected)}</span></div>
      </div>
      <label class="fld" style="margin-top:12px">${L('Espèces comptées (FCFA)', 'Counted cash (FCFA)')}<input name="counted_cash" type="number" min="0" required class="num" id="counted"></label>
      <p id="var" class="muted"></p>${field({ name: 'note', label: L('Commentaire', 'Note'), type: 'textarea' })}</div></div>`,
    onOpen: (d) => {
      const c = d.querySelector('#counted');
      const upd = () => { const diff = (Number(c.value) || 0) - sum.cash.expected; d.querySelector('#var').innerHTML = c.value === '' ? '' : diff === 0 ? `<span class="pill ok">${L('Aucun écart', 'No difference')}</span>` : `<span class="pill ${diff < 0 ? 'bad' : 'warn'}">${L('Écart', 'Difference')} ${diff > 0 ? '+' : ''}${money(diff)}</span>`; };
      d.querySelectorAll('[data-d]').forEach((i) => i.addEventListener('input', () => { c.value = [...d.querySelectorAll('[data-d]')].reduce((t, x) => t + Number(x.dataset.d) * (Number(x.value) || 0), 0); upd(); }));
      c.addEventListener('input', upd);
    } });
  if (!v) return;
  if (net.outbox().some((x) => x.path === '/api/shop/sales')) throw new Error(L('Des tickets hors ligne ne sont pas encore synchronisés. Attendez le retour d\'internet.', 'Offline receipts are not synced yet. Wait for internet.'));
  const r = await api.post(`/api/shop/sessions/${s.id}/close`, v);
  toast(r.session.variance ? `${L('Caisse clôturée, écart', 'Till closed, difference')} ${money(r.session.variance)}` : L('Caisse clôturée sans écart', 'Till closed, no difference'), r.session.variance ? '' : 'ok');
  window.open(`/print/shop/session/${s.id}?print=1`, '_blank');
  state.shop.session = null;
  cart = emptyCart(); saveCart();
  location.hash = '#/pos/session/' + s.id;
}

async function openSessionScreen(ctx) {
  const regs = state.shop.registers.filter((r) => r.active);
  const mine = regs.filter((r) => !state.shop.my_store || r.store_id === state.shop.my_store);
  const list = mine.length ? mine : regs;
  ctx.el.innerHTML = `<div class="auth" style="background:var(--navy)"><div class="card"><div class="brand"><img src="/icon.svg" alt=""><div>${esc(state.brand?.name || 'Teknons POS')}<small>${esc(state.me.company.name)}</small></div></div>
    <h2 style="margin-top:0">${L('Ouvrir la caisse', 'Open the till')}</h2>
    <form id="of" class="form">
      <label class="fld">${L('Caisse', 'Till')}<select name="register_id">${list.map((r) => `<option value="${r.id}" ${r.busy_by ? 'disabled' : ''}>${esc(r.store_name)} · ${esc(r.name)}${r.busy_by ? ` (${L('ouverte par', 'open by')} ${esc(r.busy_by)})` : ''}</option>`).join('')}</select></label>
      <label class="fld">${L('Fond de caisse (FCFA)', 'Opening float (FCFA)')}<input name="opening_float" type="number" min="0" value="0" inputmode="numeric"></label>
      <button class="btn primary">${L('Ouvrir la session', 'Open session')}</button>
      <a class="btn ghost" href="#/">${L('Retour au tableau de bord', 'Back to dashboard')}</a>
    </form></div></div>`;
  ctx.el.querySelector('#of').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api.post('/api/shop/sessions', Object.fromEntries(new FormData(e.target))); ctx.rerender(); } catch (err) { showError(err); }
  });
}

// ===================== Tickets and sessions =====================
R('/pos/sales', async (ctx) => {
  ctx.title(L('Tickets de caisse', 'Receipts'));
  const q = { ...ctx.query };
  ctx.actions(`<a class="btn" href="/api/shop/sales${qs({ ...q, format: 'xlsx' })}">${icon('download')}<span class="hide-m">Excel</span></a><a class="btn primary" href="#/pos">${icon('cart')}${L('Caisse', 'Till')}</a>`);
  const rows = await api.get(`/api/shop/sales${qs(q)}`);
  ctx.el.innerHTML = `<form class="filters" id="f"><input type="search" class="in" name="q" placeholder="${L('N° de ticket ou client', 'Receipt no. or customer')}" value="${esc(q.q || '')}">
    <input type="date" class="in" name="from" value="${esc(q.from || '')}"><input type="date" class="in" name="to" value="${esc(q.to || '')}">
    <select class="in" name="store_id"><option value="">${L('Toutes les boutiques', 'All shops')}</option>${state.shop.stores.map((s) => `<option value="${s.id}" ${String(q.store_id) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <button class="btn">${L('Filtrer', 'Filter')}</button></form>` + table({ rows, href: (r) => `/pos/sale/${r.id}`, columns: [
    { label: L('Ticket', 'Receipt'), render: (r) => `<b class="mono">${esc(r.number)}</b><div class="muted">${new Date(r.created_at).toLocaleString('fr-FR')}</div>` },
    { label: L('Client', 'Customer'), render: (r) => esc(r.customer_name || '—') },
    { label: L('Caissier', 'Cashier'), hideM: true, render: (r) => esc(r.cashier || '') },
    { label: L('Paiement', 'Payment'), hideM: true, render: (r) => esc((r.methods || '').split(',').map(methodLabel).join(', ')) },
    { label: '', render: (r) => (r.status === 'voided' ? `<span class="pill bad">${L('Annulé', 'Voided')}</span>` : r.kind === 'return' ? `<span class="pill warn">${L('Retour', 'Return')}</span>` : r.kind === 'topup' ? `<span class="pill info">${L('Recharge', 'Top-up')}</span>` : r.credit_amount ? `<span class="pill warn">${L('Crédit', 'Credit')}</span>` : '') },
    { label: 'Total', cls: 'r num', render: (r) => `<b>${money(r.total)}</b>` }] });
  ctx.el.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/pos/sales' + qs(Object.fromEntries(new FormData(e.target))); });
}, true);

R('/pos/sale/:id', async (ctx) => {
  const s = await api.get(`/api/shop/sales/${ctx.params.id}`);
  ctx.title(`${s.kind === 'return' ? L('Retour', 'Return') : s.kind === 'topup' ? L('Recharge', 'Top-up') : L('Ticket', 'Receipt')} ${s.number}`);
  const link = `${location.origin}/r/${s.token}`;
  const msg = L(`Votre ticket ${s.number} (${state.me.company.name}) : ${link}`, `Your receipt ${s.number} (${state.me.company.name}): ${link}`);
  ctx.actions(`<a class="btn" href="/print/shop/receipt/${s.id}?print=1" target="_blank">${icon('print')}<span class="hide-m">${L('Imprimer', 'Print')}</span></a>
    <a class="btn" target="_blank" rel="noopener" href="https://wa.me/${waNumber(s.customer_phone)}?text=${encodeURIComponent(msg)}">WhatsApp</a>
    ${s.kind === 'sale' && s.status === 'completed' && can('pos') ? `<button class="btn" id="ret">${icon('undo')}<span class="hide-m">${L('Retour', 'Return')}</span></button>` : ''}
    ${s.kind === 'sale' && s.status === 'completed' && can('pos') && !s.document_id ? `<button class="btn danger" id="void">${L('Annuler', 'Void')}</button>` : ''}`);
  ctx.el.innerHTML = `<div class="grid g2" style="align-items:start"><div class="card">
    <div class="doc-head"><div><div class="muted">${new Date(s.created_at).toLocaleString('fr-FR')} · ${esc(s.store_name)} · ${esc(s.register_name)}</div>
      <div class="doc-amount">${money(s.total)}</div>${s.status === 'voided' ? `<span class="pill bad">${L('Annulé', 'Voided')} : ${esc(s.void_reason)}</span>` : ''}</div>
      <div class="r"><div>${L('Caissier', 'Cashier')} : <b>${esc(s.cashier)}</b></div>${s.customer_name ? `<div>${L('Client', 'Customer')} : <a href="#/shop/customer/${s.customer_id}"><b>${esc(s.customer_name)}</b></a></div>` : ''}
      ${s.document ? `<div><a href="#/doc/${s.document.id}">${esc(s.document.number)}</a> ${pill(s.document.status)}</div>` : ''}${s.ref_sale_id ? `<div><a href="#/pos/sale/${s.ref_sale_id}">${L('Ticket d\'origine', 'Original receipt')}</a></div>` : ''}</div></div>
    ${table({ rows: s.lines, columns: [{ label: L('Article', 'Item'), render: (l) => `<b>${esc(l.description)}</b>${l.promo_amount ? `<div class="muted">${icon('tag')} promo −${num(l.promo_amount)}</div>` : ''}${l.discount ? `<div class="muted">${L('remise', 'discount')} −${num(l.discount)}</div>` : ''}` },
      { label: L('Qté', 'Qty'), cls: 'r', render: (l) => qtyFmt(l.qty) }, { label: 'P.U.', cls: 'r num', render: (l) => num(l.unit_price) }, { label: 'Total', cls: 'r num', render: (l) => `<b>${num(l.total)}</b>` }] })}
    <div class="totals" style="margin-top:12px"><div><span>HT</span><span>${money(s.net_total)}</span></div><div><span>TVA</span><span>${money(s.vat_total)}</span></div>
      ${s.promo_total ? `<div><span>${L('Promotions', 'Promotions')}</span><span>−${money(s.promo_total)}</span></div>` : ''}<div class="big"><span>Total</span><span>${money(s.total)}</span></div></div></div>
    <div class="card"><h3>${L('Paiements', 'Payments')}</h3>${s.payments.map((p) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(methodLabel(p.method))} <span class="muted mono">${esc(p.reference || '')}</span></span><b class="num">${money(p.amount)}</b></div>`).join('')}
      ${s.change_given ? `<div class="row between" style="padding:6px 0"><span>${L('Monnaie rendue', 'Change given')}</span><b class="num">${money(s.change_given)}</b></div>` : ''}
      ${s.points_earned || s.points_used ? `<h3 style="margin-top:16px">${L('Fidélité', 'Loyalty')}</h3><p>${s.points_earned ? `+${s.points_earned} pts` : ''} ${s.points_used ? `· ${L('utilisés', 'used')} ${s.points_used} pts` : ''} ${s.bonus_used ? `· bonus ${money(s.bonus_used)}` : ''}</p>` : ''}
      ${s.returns.length ? `<h3 style="margin-top:16px">${L('Retours', 'Returns')}</h3>${s.returns.map((x) => `<div><a href="#/pos/sale/${x.id}">${esc(x.number)}</a> · ${money(x.total)}</div>`).join('')}` : ''}
      <p class="muted" style="margin-top:16px">${L('Marge', 'Margin')} : <b>${money(s.net_total - s.cost_total)}</b></p></div></div>`;
  document.getElementById('ret')?.addEventListener('click', async () => { try { state.shop = await api.get('/api/shop/meta'); if (!state.shop.session) throw new Error(L('Ouvrez d\'abord votre caisse', 'Open your till first')); const r = await returnFlow(s); if (r) location.hash = `#/pos/sale/${r.id}`; } catch (e) { fail(e); } });
  document.getElementById('void')?.addEventListener('click', async () => {
    const v = await dialog({ title: `${L('Annuler le ticket', 'Void receipt')} ${s.number}`, submit: L('Annuler le ticket', 'Void'), danger: true, body: field({ name: 'reason', label: L('Motif', 'Reason'), required: true }) });
    if (!v) return;
    try { await withPin((pin) => api.post(`/api/shop/sales/${s.id}/void`, { reason: v.reason, manager_pin: pin })); toast(L('Ticket annulé', 'Receipt voided'), 'ok'); ctx.rerender(); } catch (e) { fail(e); }
  });
});

R('/pos/sessions', async (ctx) => {
  ctx.title(L('Sessions de caisse', 'Till sessions'));
  const rows = await api.get('/api/shop/sessions');
  ctx.el.innerHTML = table({ rows, href: (r) => `/pos/session/${r.id}`, columns: [
    { label: 'Session', render: (r) => `<b class="mono">${esc(r.number)}</b><div class="muted">${esc(r.store_name)} · ${esc(r.register_name)}</div>` },
    { label: L('Caissier', 'Cashier'), render: (r) => esc(r.user_name) },
    { label: L('Ouverture', 'Opened'), hideM: true, render: (r) => new Date(r.opened_at).toLocaleString('fr-FR') },
    { label: L('Statut', 'Status'), render: (r) => (r.status === 'open' ? `<span class="pill ok">${L('Ouverte', 'Open')}</span>` : `<span class="pill">${L('Clôturée', 'Closed')}</span>`) },
    { label: L('Ventes', 'Sales'), cls: 'r num', render: (r) => money(r.sales) },
    { label: L('Écart', 'Difference'), cls: 'r num', render: (r) => (r.variance == null ? '' : `<b style="color:${r.variance < 0 ? 'var(--bad)' : r.variance > 0 ? 'var(--warn)' : 'var(--ok)'}">${r.variance > 0 ? '+' : ''}${money(r.variance)}</b>`) }] });
}, true);

R('/pos/session/:id', async (ctx) => {
  const sum = await api.get(`/api/shop/sessions/${ctx.params.id}`);
  const s = sum.session;
  ctx.title(`Session ${s.number}`);
  ctx.actions(`<a class="btn" href="/print/shop/session/${s.id}" target="_blank">${icon('print')}${s.status === 'closed' ? L('Rapport Z', 'Z report') : L('Rapport X', 'X report')}</a><a class="btn" href="#/pos/sales?session_id=${s.id}">${L('Tickets', 'Receipts')}</a>`);
  const k = (l, v, sub = '') => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  ctx.el.innerHTML = `<div class="grid g4">${k(L('Ventes', 'Sales'), money(sum.sales.total), `${sum.sales.n} tickets`)}${k(L('Marge', 'Margin'), money(sum.sales.net - sum.sales.cost), L('ventes HT − coût', 'net sales − cost'))}
    ${k(L('Espèces attendues', 'Expected cash'), money(sum.cash.expected), s.counted_cash != null ? `${L('compté', 'counted')} ${money(s.counted_cash)}` : L('session ouverte', 'session open'))}
    ${k(L('Écart', 'Difference'), s.variance == null ? '—' : `<span style="color:${s.variance < 0 ? 'var(--bad)' : 'inherit'}">${money(s.variance)}</span>`, `${sum.voids.n} ${L('annulation(s)', 'void(s)')} · ${sum.returns.n} ${L('retour(s)', 'return(s)')}`)}</div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>${L('Par mode de paiement', 'By payment method')}</h3>${sum.byMethod.map((m) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(methodLabel(m.method))}</span><b class="num">${money(m.amount)}</b></div>`).join('') || '<p class="muted">—</p>'}</div>
    <div class="card"><h3>${L('Tiroir-caisse', 'Cash drawer')}</h3>
      ${[[L('Fond de caisse', 'Opening float'), sum.cash.opening], [L('Ventes en espèces', 'Cash sales'), sum.cash.sales], [L('Entrées', 'Cash in'), sum.cash.in], [L('Sorties', 'Cash out'), -sum.cash.out], [L('Remboursements de crédit', 'Credit repayments'), sum.cash.repayments]].map(([l, v]) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${l}</span><span class="num">${money(v)}</span></div>`).join('')}
      <div class="row between" style="padding:8px 0"><b>${L('Attendu', 'Expected')}</b><b class="num">${money(sum.cash.expected)}</b></div>
      ${s.entry_id ? `<p class="muted">${L('Écriture comptable passée au journal de caisse.', 'Posted to the cash journal.')} <a href="#/entries?journal=CA">${L('Voir', 'View')}</a></p>` : ''}</div></div>`;
});
