// Teknons POS back office: dashboard, articles and barcodes, stock per shop,
// expiry lots, customers and loyalty, promotions, purchase orders, transfers,
// phone inventory counts, reports and till settings.
import { api } from './api.js';
import { state, L, esc, money, moneyShort, num, dt, today, monthStart, qs, icon, can, canAny, table, field, dialog, toast, showError, confirmDlg, pill, offlineNote } from './ui.js';
import { barcodeSvg } from './barcode.js';
import { cameraScan, customerDialog, withPin, resetCatalog } from './pos.js';

export const routes = [];
const R = (path, fn, live = false) => routes.push([path, fn, live]);
const isManager = () => ['owner', 'admin', 'manager'].includes(state.me.user.role);
const qtyFmt = (q) => (Number.isInteger(Number(q)) ? num(q) : Number(q).toFixed(3).replace(/0+$/, '').replace('.', ','));
const stores = () => state.shop?.stores || [];
const storeOpts = (all = true) => [...(all ? [['', L('Tous les emplacements', 'All locations')]] : []), ...stores().filter((s) => s.active).map((s) => [s.id, `${s.name}${s.kind === 'warehouse' ? ` (${L('dépôt', 'warehouse')})` : ''}`])];
const catOpts = () => [['', L('— Aucune —', '— None —')], ...(state.shop?.categories || []).map((c) => [c.id, c.name])];
const fail = (e) => { if (!e?.quiet) showError(e); };
async function refreshMeta() { try { state.shop = await api.get('/api/shop/meta', { cache: false }); } catch {} }
const kpi = (l, v, s = '', cls = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="card kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></${href ? 'a' : 'div'}>`;
const storeSelect = (ctx, id = 'store') => `<select class="in" id="${id}" style="width:auto;max-width:240px">${storeOpts().map(([v, l]) => `<option value="${v}" ${String(ctx.query.store_id || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const wireStore = (ctx, id = 'store') => ctx.el.querySelector('#' + id)?.addEventListener('change', (e) => { location.hash = ctx.path + qs({ ...ctx.query, store_id: e.target.value }); });

// ===================== Navigation =====================
export function nav(item) {
  const stock = canAny('stock', 'settings');
  const buy = canAny('stock', 'purchases');
  const reports = can('reports') || state.me.user.role === 'manager';
  return `<h6>${L('Caisse', 'Till')}</h6>
  ${item('/pos', 'cart', 'Ouvrir la caisse', 'Open the till', can('pos'))}
  ${item('/display', 'monitor', 'Écran client', 'Customer display', can('pos'))}
  ${item('/pos/sales', 'receipt', 'Tickets', 'Receipts', canAny('pos', 'reports'))}
  ${item('/pos/sessions', 'clipboard', 'Sessions et Z de caisse', 'Sessions & Z reports', canAny('pos', 'reports'))}
  <h6>${L('Magasin', 'Store')}</h6>
  ${item('/shop/items', 'tag', 'Articles et codes-barres', 'Products & barcodes')}
  ${item('/shop/stock', 'box', 'Stock et péremptions', 'Stock & expiry')}
  ${item('/shop/promos', 'percent', 'Promotions', 'Promotions')}
  ${item('/shop/customers', 'star', 'Clients et fidélité', 'Customers & loyalty', canAny('pos', 'sales', 'read'))}
  ${item('/shop/orders', 'truck', 'Commandes fournisseurs', 'Purchase orders', buy)}
  ${item('/shop/transfers', 'swap', 'Transferts', 'Transfers', stock || can('read'))}
  ${item('/shop/counts', 'scan', 'Inventaires', 'Stock counts', can('stock'))}
  ${item('/shop/reports', 'chart', 'Rapports de ventes', 'Sales reports', reports)}
  ${item('/shop/settings', 'gear', 'Réglages caisse', 'Till settings', can('settings'))}`;
}
export function bottomNav() {
  return `<a href="#/" data-nav="/">${icon('home')}${L('Accueil', 'Home')}</a>
    <a href="#/pos" data-nav="/pos">${icon('cart')}${L('Caisse', 'Till')}</a>
    <a href="#/shop/items" data-nav="/shop/items">${icon('tag')}${L('Articles', 'Products')}</a>
    <a href="#/shop/stock" data-nav="/shop/stock">${icon('box')}Stock</a>`;
}

// ===================== Dashboard =====================
export async function dashboard(ctx) {
  ctx.title(L('Tableau de bord', 'Dashboard'));
  ctx.actions(`${storeOpts().length > 2 ? `<span class="hide-m">${storeSelect(ctx, 'dstore')}</span>` : ''}${can('pos') ? `<a class="btn primary" href="#/pos">${icon('cart')}<span class="hide-m">${L('Ouvrir la caisse', 'Open the till')}</span></a>` : ''}`);
  document.getElementById('dstore')?.addEventListener('change', (e) => { location.hash = '/' + qs({ store_id: e.target.value }); });
  const d = await api.get(`/api/shop/reports/dashboard${qs({ store_id: ctx.query.store_id })}`);
  const k = d.kpi;
  const diff = k.yesterday ? Math.round((k.sales - k.yesterday) * 100 / k.yesterday) : null;
  const maxH = Math.max(1, ...d.hours.map((h) => h.v));
  const hours = Array.from({ length: 16 }, (_, i) => i + 6).map((h) => ({ h, v: d.hours.find((x) => x.h === h)?.v || 0, n: d.hours.find((x) => x.h === h)?.n || 0 }));
  const maxB = Math.max(1, ...d.best.map((b) => b.v));
  const totalM = d.methods.reduce((t, m) => t + m.v, 0) || 1;
  const mName = (m) => { const x = state.shop?.methods?.[m]; return x ? L(x.fr, x.en) : m; };
  ctx.el.innerHTML = `${offlineNote(d)}
  <div class="grid g4">
    ${kpi(L("Ventes du jour (TTC)", "Today's sales"), money(k.sales), diff == null ? L('première journée', 'first day') : `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} % ${L('vs hier', 'vs yesterday')}`, 'accent', canAny('pos', 'reports') ? '#/pos/sales' : '')}
    ${kpi(L('Tickets', 'Receipts'), num(k.tickets), `${L('panier moyen', 'average basket')} ${money(k.basket)}`)}
    ${kpi(L('Marge brute', 'Gross margin'), money(k.margin), `${String(k.margin_pct).replace('.', ',')} % ${L('des ventes HT', 'of net sales')}`, '', '#/shop/reports')}
    ${kpi(L('Remises et promos', 'Discounts & promos'), money(k.discounts), `${L('retours', 'returns')} ${money(k.returns)}`)}
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${L('Ventes par heure', 'Sales per hour')}</h3>
      <div class="hbars">${hours.map((h) => `<div class="hb" title="${h.h} h : ${money(h.v)} · ${h.n} ${L('tickets', 'receipts')}"><i style="height:${Math.max(h.v ? 4 : 0, (h.v / maxH) * 100)}%"></i><span>${h.h}</span></div>`).join('')}</div>
      ${d.methods.length ? `<h3 style="margin-top:18px">${L('Encaissements par mode', 'Payments by method')}</h3><div class="stackbar">${d.methods.map((m) => `<i class="mm-${esc(m.method)}" style="width:${(m.v / totalM) * 100}%" title="${esc(mName(m.method))}"></i>`).join('')}</div>
        <div class="legend" style="flex-wrap:wrap;margin-top:8px">${d.methods.map((m) => `<span><i class="mm-${esc(m.method)}"></i>${esc(mName(m.method))} <b class="num">${money(m.v)}</b></span>`).join('')}</div>` : ''}
    </div>
    <div class="card"><h3>${L('Meilleures ventes du jour', "Today's best sellers")}</h3>${d.best.length ? `<div class="bar-list">${d.best.map((b) => `<div class="it"><a href="#/shop/item/${b.product_id}">${esc(b.name)}</a><b class="num">${money(b.v)}</b><div class="tr"><i style="width:${(b.v / maxB) * 100}%"></i></div></div>`).join('')}</div>` : `<p class="muted">${L('Aucune vente aujourd\'hui pour le moment.', 'No sales yet today.')}</p>`}</div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>${L('Caisses', 'Tills')}</h3>${d.sessions.length ? d.sessions.map((s) => `<a class="row between lrow" href="#/pos/session/${s.id}"><span><b>${esc(s.register_name)}</b> · ${esc(s.user_name)}<div class="muted sm">${esc(s.store_name)} · ${s.status === 'open' ? `<span class="pill ok">${L('ouverte', 'open')}</span>` : `${L('fermée', 'closed')}${s.variance ? ` · <b style="color:${s.variance < 0 ? 'var(--bad)' : 'var(--warn)'}">${L('écart', 'variance')} ${money(s.variance)}</b>` : ''}`}</div></span><b class="num">${money(s.sales)}</b></a>`).join('') : `<p class="muted">${L('Aucune caisse ouverte aujourd\'hui.', 'No till opened today.')}</p>`}
      ${d.stores.length > 1 ? `<h3 style="margin-top:16px">${L('Par boutique', 'Per shop')}</h3>${d.stores.filter((s) => s.kind === 'shop').map((s) => `<div class="row between lrow"><span>${esc(s.name)} <span class="dim">(${s.tickets})</span></span><b class="num">${money(s.sales)}</b></div>`).join('')}` : ''}</div>
    <div class="card"><h3>${icon('box')} ${L('Stock bas', 'Low stock')} <span class="pill ${d.low.count ? 'warn' : 'ok'}">${d.low.count}</span></h3>${d.low.items.map((x) => `<a class="row between lrow" href="#/shop/item/${x.product_id}"><span>${esc(x.name)}</span><b class="num" style="color:var(--warn)">${qtyFmt(x.qty)} / ${qtyFmt(x.min_stock)}</b></a>`).join('') || `<p class="muted">${L('Tout est au-dessus du seuil.', 'Everything is above minimum.')}</p>`}
      ${d.low.count && canAny('stock', 'purchases') ? `<a class="btn sm" style="margin-top:10px" href="#/shop/orders?suggest=1">${L('Préparer les commandes', 'Prepare purchase orders')}</a>` : ''}
      <h3 style="margin-top:16px">${L('Péremptions sous', 'Expiring within')} ${state.shop?.settings?.expiry_alert_days || 30} ${L('jours', 'days')} <span class="pill ${d.expiring.count ? 'bad' : 'ok'}">${d.expiring.count}</span></h3>${d.expiring.items.map((x) => `<div class="row between lrow"><span>${esc(x.name)} <span class="dim sm">${esc(x.store_name)}</span></span><b class="num" style="color:${x.expiry < today() ? 'var(--bad)' : 'var(--warn)'}">${dt(x.expiry)} · ${qtyFmt(x.qty)}</b></div>`).join('') || `<p class="muted">${L('Aucun lot à surveiller.', 'Nothing to watch.')}</p>`}</div>
    <div class="card"><h3>${L('Clients', 'Customers')}</h3>
      <div class="row between lrow"><span>${L('Crédit client à encaisser', 'Customer credit outstanding')}</span><b class="num" style="color:${d.credit.v ? 'var(--bad)' : 'inherit'}">${money(d.credit.v)}</b></div>
      <div class="row between lrow"><span>${L('Comptes prépayés (dû aux clients)', 'Prepaid accounts (owed to customers)')}</span><b class="num">${money(d.wallets.wallet)}</b></div>
      <div class="row between lrow"><span>${L('Bonus offerts non utilisés', 'Unused bonus')}</span><b class="num">${money(d.wallets.bonus)}</b></div>
      <div class="row between lrow"><span>${L('Points de fidélité en circulation', 'Loyalty points outstanding')}</span><b class="num">${num(d.wallets.points)} pts</b></div>
      <div class="row between lrow"><span>${L('Clients fidélité', 'Loyalty members')}</span><b class="num">${num(d.wallets.n)}</b></div>
      <a class="btn sm" style="margin-top:10px" href="#/shop/customers">${L('Voir les clients', 'View customers')}</a></div>
  </div>`;
}
dashboard.noLiveRender = false;

// ===================== Articles =====================
R('/shop/items', async (ctx) => {
  ctx.title(L('Articles et codes-barres', 'Products & barcodes'));
  const edit = canAny('stock', 'settings');
  ctx.actions(`<a class="btn hide-m" href="/api/shop/items${qs({ format: 'xlsx', store_id: ctx.query.store_id })}">${icon('download')}Excel</a>${edit ? `<button class="btn" id="cats">${icon('list')}<span class="hide-m">${L('Catégories', 'Categories')}</span></button><button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Article', 'Product')}</span></button>` : ''}`);
  const rows = await api.get(`/api/shop/items${qs({ q: ctx.query.q, category_id: ctx.query.category_id, store_id: ctx.query.store_id })}`);
  ctx.el.innerHTML = `${offlineNote(rows)}<div class="filters">
    <input type="search" class="in" id="q" value="${esc(ctx.query.q || '')}" placeholder="${L('Nom, code-barres, PLU…', 'Name, barcode, PLU…')}">
    <button class="btn" id="cam" title="${L('Scanner avec la caméra', 'Scan with camera')}">${icon('camera')}</button>
    <select class="in" id="cat">${[['', L('Toutes catégories', 'All categories')], ...(state.shop.categories || []).map((c) => [c.id, c.name])].map(([v, l]) => `<option value="${v}" ${String(ctx.query.category_id || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    ${storeSelect(ctx)}
    <button class="btn" id="labels" disabled>${icon('print')}${L('Étiquettes', 'Labels')} <span id="nsel"></span></button></div>
  ${table({ rows, columns: [
    { label: '', render: (r) => `<input type="checkbox" class="sel" value="${r.id}" aria-label="${L('Choisir', 'Select')}">` },
    { label: L('Article', 'Product'), render: (r) => `<a href="#/shop/item/${r.id}"><b>${esc(r.name)}</b></a>${r.by_weight ? ` <span class="pill info">${L('au poids', 'by weight')}</span>` : ''}${r.quick ? ` <span class="pill">${L('touche rapide', 'quick key')}</span>` : ''}<div class="muted mono sm">${esc(r.barcode || L('sans code-barres', 'no barcode'))}${r.plu ? ` · PLU ${r.plu}` : ''}</div>` },
    { label: L('Catégorie', 'Category'), render: (r) => esc(r.category || ''), hideM: true },
    { label: L('Prix détail', 'Retail'), cls: 'r num', render: (r) => `<b>${money(r.retail_price)}</b>${r.by_weight ? '/kg' : ''}` },
    { label: L('Prix gros', 'Wholesale'), cls: 'r num', hideM: true, render: (r) => (r.wholesale_price ? `${money(r.wholesale_price)}${r.wholesale_min_qty ? `<div class="muted sm">${L('dès', 'from')} ${qtyFmt(r.wholesale_min_qty)}</div>` : ''}` : '') },
    { label: L('Coût HT', 'Cost'), cls: 'r num', hideM: true, render: (r) => money(r.avg_cost) },
    { label: 'Stock', cls: 'r num', render: (r) => `<b style="color:${r.min_stock && r.qty <= r.min_stock ? 'var(--warn)' : r.qty < 0 ? 'var(--bad)' : 'inherit'}">${qtyFmt(r.qty)}</b> <span class="dim">${esc(r.unit)}</span>` }],
  empty: `<b>${L('Aucun article', 'No products')}</b>${edit ? L('Ajoutez votre premier article ou importez votre liste.', 'Add your first product.') : ''}` })}`;
  let t; ctx.el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = ctx.path + qs({ ...ctx.query, q: e.target.value }); }, 450); });
  ctx.el.querySelector('#cat').addEventListener('change', (e) => { location.hash = ctx.path + qs({ ...ctx.query, category_id: e.target.value }); });
  wireStore(ctx);
  ctx.el.querySelector('#cam').addEventListener('click', () => cameraScan((code) => { location.hash = ctx.path + qs({ ...ctx.query, q: code }); }));
  const sel = () => [...ctx.el.querySelectorAll('.sel:checked')].map((c) => c.value);
  ctx.el.addEventListener('change', (e) => { if (!e.target.classList.contains('sel')) return; const n = sel().length; ctx.el.querySelector('#labels').disabled = !n; ctx.el.querySelector('#nsel').textContent = n ? `(${n})` : ''; });
  ctx.el.querySelector('#labels').addEventListener('click', () => labelsDialog(sel()));
  document.getElementById('new')?.addEventListener('click', async () => { const it = await itemDialog(); if (it) location.hash = `#/shop/item/${it.id}`; });
  document.getElementById('cats')?.addEventListener('click', () => categoriesDialog().then(() => ctx.rerender()));
}, true);

async function labelsDialog(ids) {
  const v = await dialog({ title: L('Imprimer des étiquettes', 'Print labels'), submit: L('Imprimer', 'Print'),
    body: `<p class="muted" style="margin-top:0">${ids.length} ${L('article(s). Planche A4 de 24 étiquettes (3 × 8) avec nom, prix et code-barres.', 'product(s). A4 sheet of 24 labels (3 × 8) with name, price and barcode.')}</p>${field({ name: 'copies', label: L('Exemplaires par article', 'Copies per product'), type: 'number', min: 1, value: 1 })}` });
  if (v) window.open(`/print/shop/labels${qs({ ids: ids.join(','), copies: v.copies, print: 1 })}`, '_blank');
}

function itemFields(it = {}) {
  const sup = itemFields.suppliers || [];
  return [
    { name: 'name', label: L('Nom de l\'article', 'Product name'), required: true, span: true },
    { name: 'barcode', label: L('Code-barres (EAN)', 'Barcode (EAN)'), placeholder: L('Scannez ou laissez vide', 'Scan or leave empty') },
    { name: 'category_id', label: L('Catégorie', 'Category'), type: 'select', options: catOpts() },
    { name: 'retail_price', label: L('Prix de vente détail TTC (FCFA)', 'Retail price incl. VAT (FCFA)'), type: 'number', min: 0, required: true },
    { name: 'purchase_price', label: L('Prix d\'achat HT (FCFA)', 'Purchase cost excl. VAT'), type: 'number', min: 0, value: it.avg_cost },
    { name: 'wholesale_price', label: L('Prix de gros TTC (0 = aucun)', 'Wholesale price (0 = none)'), type: 'number', min: 0 },
    { name: 'wholesale_min_qty', label: L('Prix de gros à partir de (qté)', 'Wholesale from qty'), type: 'number', min: 0, step: 'any', hint: L('0 = seulement pour les clients « gros »', '0 = wholesale customers only') },
    { name: 'vat_rate', label: L('TVA % (vide = taux de l\'entreprise)', 'VAT % (empty = company rate)'), type: 'number', min: 0, step: 'any' },
    { name: 'unit', label: L('Unité', 'Unit'), placeholder: 'u, kg, L, carton' },
    { name: 'min_stock', label: L('Seuil d\'alerte stock', 'Low-stock threshold'), type: 'number', min: 0, step: 'any' },
    { name: 'reorder_qty', label: L('Quantité à commander', 'Reorder quantity'), type: 'number', min: 0, step: 'any' },
    { name: 'supplier_id', label: L('Fournisseur habituel', 'Usual supplier'), type: 'select', options: [['', '—'], ...sup.map((s) => [s.id, s.name])] },
    { name: 'plu', label: L('Code balance (PLU)', 'Scale code (PLU)'), placeholder: '00042' },
    { name: 'by_weight', label: L('Vendu au poids (kg)', 'Sold by weight (kg)'), type: 'checkbox' },
    { name: 'track_expiry', label: L('Suivre les dates de péremption (lots)', 'Track expiry dates (lots)'), type: 'checkbox' },
    { name: 'quick', label: L('Touche rapide sur la caisse', 'Quick key on the till'), type: 'checkbox' },
  ];
}
async function itemDialog(it) {
  try { itemFields.suppliers = await api.get('/api/partners?kind=supplier'); } catch { itemFields.suppliers = []; }
  const fields = itemFields(it || {});
  const extra = it ? '' : `<div class="f2" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
    ${field({ name: 'initial_qty', label: L('Stock initial (optionnel)', 'Opening stock (optional)'), type: 'number', min: 0, step: 'any' })}
    ${field({ name: 'store_id', label: L('Dans', 'In'), type: 'select', options: storeOpts(false), value: state.shop.my_store })}
    ${field({ name: 'expiry', label: L('Péremption du stock initial', 'Opening stock expiry'), type: 'date' })}
    ${field({ name: 'generate_barcode', label: L('Créer un code-barres interne si vide', 'Create an internal barcode if empty'), type: 'checkbox', value: true })}</div>`;
  return dialog({ title: it ? L('Modifier l\'article', 'Edit product') : L('Nouvel article', 'New product'), wide: true,
    body: `<div class="f2">${fields.map((f) => field(f, it || { vat_rate: '' })).join('')}</div>${it && !it.barcode ? `<div style="margin-top:10px">${field({ name: 'generate_barcode', label: L('Créer un code-barres interne', 'Create an internal barcode'), type: 'checkbox' })}</div>` : ''}${extra}`,
    onOpen: (d) => {
      const bc = d.querySelector('[name=barcode]');
      bc.insertAdjacentHTML('afterend', `<button type="button" class="btn sm" id="bccam" style="margin-top:4px">${icon('camera')}${L('Scanner', 'Scan')}</button>`);
      d.querySelector('#bccam').addEventListener('click', () => cameraScan((code) => { bc.value = code; }));
      bc.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    },
    onSubmit: async (v) => { const r = it ? await api.put(`/api/shop/items/${it.id}`, v) : await api.post('/api/shop/items', v); resetCatalog(); toast(L('Article enregistré', 'Product saved'), 'ok'); return r; } });
}

async function categoriesDialog() {
  const cats = state.shop.categories || [];
  await dialog({ title: L('Catégories (touches de la caisse)', 'Categories (till buttons)'), submit: L('Ajouter', 'Add'), cancel: L('Fermer', 'Close'),
    body: `<div class="stack" style="gap:8px">${cats.map((c) => `<div class="row" style="flex-wrap:nowrap"><input class="in" data-cat="${c.id}" value="${esc(c.name)}"><input type="color" class="in" data-col="${c.id}" value="${esc(c.color || '#0B8AC9')}" style="width:56px;padding:4px"></div>`).join('')}
      <div class="row" style="flex-wrap:nowrap;margin-top:8px"><input class="in" name="name" placeholder="${L('Nouvelle catégorie', 'New category')}"><input type="color" class="in" name="color" value="#0B8AC9" style="width:56px;padding:4px"></div></div>`,
    onOpen: (d) => d.querySelectorAll('[data-cat],[data-col]').forEach((el) => el.addEventListener('change', () => {
      const id = el.dataset.cat || el.dataset.col;
      api.put(`/api/shop/categories/${id}`, { name: d.querySelector(`[data-cat="${id}"]`).value, color: d.querySelector(`[data-col="${id}"]`).value }).then(() => toast(L('Enregistré', 'Saved'), 'ok')).catch(showError);
    })),
    onSubmit: async (v) => { if (v.name) await api.post('/api/shop/categories', v); return true; } });
  await refreshMeta(); resetCatalog();
}

R('/shop/item/:id', async (ctx) => {
  const it = await api.get(`/api/shop/items/${ctx.params.id}`);
  ctx.title(it.name);
  const edit = canAny('stock', 'settings');
  ctx.actions(`${edit ? `<button class="btn" id="adj">${icon('box')}<span class="hide-m">${L('Ajuster le stock', 'Adjust stock')}</span></button><button class="btn" id="edit">${L('Modifier', 'Edit')}</button>` : ''}<button class="btn primary" id="lbl">${icon('print')}<span class="hide-m">${L('Étiquettes', 'Labels')}</span></button>`);
  const margin = it.retail_price ? Math.round((1 - (it.avg_cost * (1 + (it.vat_rate ?? state.me.company.vat_rate) / 100)) / it.retail_price) * 1000) / 10 : 0;
  const MK = { receipt: L('Réception', 'Receipt'), sale: L('Vente', 'Sale'), return: L('Retour client', 'Return'), adjust: L('Ajustement', 'Adjustment'), transfer_out: L('Transfert sortant', 'Transfer out'), transfer_in: L('Transfert entrant', 'Transfer in'), count: L('Inventaire', 'Count'), void: L('Annulation', 'Void') };
  ctx.el.innerHTML = `<div class="grid g4">
    ${kpi(L('Prix détail TTC', 'Retail price'), money(it.retail_price), it.wholesale_price ? `${L('gros', 'wholesale')} ${money(it.wholesale_price)}${it.wholesale_min_qty ? ` ${L('dès', 'from')} ${qtyFmt(it.wholesale_min_qty)}` : ''}` : L('pas de prix de gros', 'no wholesale price'), 'accent')}
    ${kpi(L('Coût moyen HT', 'Average cost'), money(it.avg_cost), `${L('marge', 'margin')} ≈ ${String(margin).replace('.', ',')} %`)}
    ${kpi(L('Stock total', 'Total stock'), `${qtyFmt(it.stock.reduce((t, s) => t + s.qty, 0))} ${esc(it.unit)}`, `${L('seuil', 'min')} ${qtyFmt(it.min_stock)}`)}
    ${kpi(L('Ventes 30 jours', 'Sales 30 days'), money(it.sales30.v), `${qtyFmt(it.sales30.qty)} ${esc(it.unit)} · ${L('marge', 'margin')} ${money(it.sales30.margin)}`)}
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${L('Code-barres', 'Barcode')}</h3>${it.barcode ? `<div class="bc">${barcodeSvg(it.barcode, { height: 60, module: 2 })}</div>` : `<p class="muted">${L('Pas encore de code-barres. Modifiez l\'article pour en créer un.', 'No barcode yet. Edit the product to create one.')}</p>`}
      <div class="row between lrow"><span>${L('Catégorie', 'Category')}</span><b>${esc(it.category || '—')}</b></div>
      <div class="row between lrow"><span>${L('Fournisseur', 'Supplier')}</span><b>${esc(it.supplier_name || '—')}</b></div>
      <div class="row between lrow"><span>TVA</span><b>${it.vat_rate == null ? `${state.me.company.vat_rate} %` : `${it.vat_rate} %`}</b></div>
      ${it.plu ? `<div class="row between lrow"><span>${L('Code balance (PLU)', 'Scale PLU')}</span><b class="mono">${it.plu}</b></div>` : ''}
      ${it.promos.length ? `<h3 style="margin-top:14px">${L('Promotions actives', 'Active promotions')}</h3>${it.promos.map((p) => `<div class="lrow"><span class="pill info">${esc(p.name)}</span></div>`).join('')}` : ''}</div>
    <div class="card"><h3>${L('Stock par emplacement', 'Stock per location')}</h3>${it.stock.map((s) => `<div class="row between lrow"><span>${esc(s.name)}</span><b class="num">${qtyFmt(s.qty)} ${esc(it.unit)}</b></div>`).join('')}
      ${it.lots.length ? `<h3 style="margin-top:14px">${L('Lots et péremptions', 'Lots & expiry')}</h3>${table({ rows: it.lots, columns: [{ label: L('Péremption', 'Expiry'), render: (l) => `<b style="color:${l.expiry && l.expiry < today() ? 'var(--bad)' : 'inherit'}">${dt(l.expiry) || '—'}</b>` }, { label: L('Lot', 'Lot'), render: (l) => esc(l.lot || '') }, { label: L('Emplacement', 'Location'), key: 'store_name' }, { label: L('Qté', 'Qty'), cls: 'r num', render: (l) => qtyFmt(l.qty) }] })}` : ''}</div>
  </div>
  <h3 style="margin:18px 0 10px">${L('Mouvements de stock', 'Stock movements')}</h3>
  ${table({ rows: it.moves, columns: [
    { label: L('Date', 'Date'), render: (m) => `${dt(m.at)} <span class="dim">${m.at ? new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>` },
    { label: L('Type', 'Type'), render: (m) => esc(MK[m.kind] || m.kind) },
    { label: L('Emplacement', 'Location'), key: 'store_name', hideM: true },
    { label: L('Qté', 'Qty'), cls: 'r num', render: (m) => `<b style="color:${m.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${qtyFmt(m.qty)}</b>` },
    { label: L('Note', 'Note'), render: (m) => `${esc(m.note || '')}<div class="muted sm">${esc(m.user_name || '')}</div>`, hideM: true }],
  empty: `<b>${L('Aucun mouvement', 'No movements')}</b>` })}`;
  document.getElementById('edit')?.addEventListener('click', async () => { if (await itemDialog(it)) ctx.rerender(); });
  document.getElementById('lbl').addEventListener('click', () => labelsDialog([it.id]));
  document.getElementById('adj')?.addEventListener('click', async () => { if (await adjustDialog(it)) ctx.rerender(); });
}, true);

function adjustDialog(it) {
  return dialog({ title: `${L('Ajuster le stock', 'Adjust stock')} · ${it.name}`,
    body: `<div class="f2">${field({ name: 'store_id', label: L('Emplacement', 'Location'), type: 'select', options: storeOpts(false), value: state.shop.my_store })}
      ${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: [['receipt', L('Entrée (réception hors commande)', 'Receipt (no PO)')], ['loss', L('Perte, casse, vol, périmé', 'Loss, breakage, theft, expired')], ['adjust', L('Correction (+ ou −)', 'Correction (+ or −)')]] })}
      ${field({ name: 'qty', label: L('Quantité (négative pour retirer en correction)', 'Quantity (negative to remove)'), type: 'number', step: 'any', required: true })}
      ${field({ name: 'unit_cost', label: L('Coût unitaire HT (entrée)', 'Unit cost (receipt)'), type: 'number', min: 0, value: it.avg_cost })}
      ${it.track_expiry ? field({ name: 'expiry', label: L('Date de péremption', 'Expiry date'), type: 'date' }) + field({ name: 'lot', label: L('N° de lot', 'Lot no.') }) : ''}
      ${field({ name: 'note', label: L('Motif', 'Reason'), span: true, placeholder: L('ex. casse en rayon', 'e.g. broken on shelf') })}</div>`,
    onSubmit: async (v) => { await api.post('/api/shop/stock/adjust', { ...v, product_id: it.id }); toast(L('Stock mis à jour', 'Stock updated'), 'ok'); return true; } });
}

// ===================== Stock =====================
R('/shop/stock', async (ctx) => {
  ctx.title(L('Stock et péremptions', 'Stock & expiry'));
  const tab = ctx.query.tab || 'stock';
  ctx.actions(`<a class="btn" href="/api/shop/stock${qs({ format: 'xlsx', store_id: ctx.query.store_id })}">${icon('download')}Excel</a>${can('stock') ? `<a class="btn primary" href="#/shop/counts">${icon('scan')}<span class="hide-m">${L('Inventaire', 'Count')}</span></a>` : ''}`);
  const tabs = [['stock', L('Tout le stock', 'All stock')], ['low', L('Stock bas', 'Low stock')], ['expiring', L('Péremptions', 'Expiry')], ...(canAny('stock', 'reports') ? [['moves', L('Mouvements', 'Movements')]] : [])];
  const head = `<div class="filters"><div class="tabs">${tabs.map(([v, l]) => `<a href="#${ctx.path}${qs({ ...ctx.query, tab: v })}" class="${tab === v ? 'on' : ''}">${l}</a>`).join('')}</div>${tab !== 'moves' ? storeSelect(ctx) : ''}${tab === 'stock' ? `<input type="search" class="in" id="q" value="${esc(ctx.query.q || '')}" placeholder="${L('Rechercher…', 'Search…')}">` : ''}</div>`;
  let body = '';
  if (tab === 'expiring') {
    const days = Number(ctx.query.days) || state.shop.settings.expiry_alert_days || 30;
    const rows = await api.get(`/api/shop/expiring${qs({ days, store_id: ctx.query.store_id })}`);
    const value = rows.reduce((t, r) => t + r.qty, 0);
    body = `<p class="muted">${L('Lots qui expirent dans les', 'Lots expiring within')} <select class="in" id="days" style="width:auto;display:inline-block">${[7, 15, 30, 60, 90].map((d) => `<option ${d === days ? 'selected' : ''}>${d}</option>`).join('')}</select> ${L('jours. Vendez-les en priorité (promotion) ou retirez-les du rayon.', 'days. Sell them first (promotion) or take them off the shelf.')} · ${qtyFmt(value)} ${L('unités', 'units')}</p>` + table({ rows, href: (r) => `/shop/item/${r.product_id}`, columns: [
      { label: L('Péremption', 'Expiry'), render: (r) => `<b style="color:${r.expiry < today() ? 'var(--bad)' : 'var(--warn)'}">${dt(r.expiry)}</b>${r.expiry < today() ? ` <span class="pill bad">${L('périmé', 'expired')}</span>` : ''}` },
      { label: L('Article', 'Product'), render: (r) => `<b>${esc(r.name)}</b>${r.lot ? `<div class="muted sm">${L('lot', 'lot')} ${esc(r.lot)}</div>` : ''}` },
      { label: L('Emplacement', 'Location'), key: 'store_name', hideM: true }, { label: L('Qté', 'Qty'), cls: 'r num', render: (r) => qtyFmt(r.qty) }],
    empty: `<b>${L('Aucun lot proche de la péremption', 'Nothing expiring soon')}</b>` });
  } else if (tab === 'moves') {
    const rows = await api.get(`/api/shop/moves${qs({ kind: ctx.query.kind })}`);
    body = table({ rows, href: (r) => `/shop/item/${r.product_id}`, columns: [
      { label: L('Date', 'Date'), render: (m) => `${dt(m.at)} <span class="dim">${m.at ? new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>` }, { label: L('Article', 'Product'), render: (m) => `<b>${esc(m.name)}</b>` },
      { label: L('Type', 'Type'), render: (m) => esc(m.kind), hideM: true }, { label: L('Emplacement', 'Location'), key: 'store_name', hideM: true },
      { label: L('Qté', 'Qty'), cls: 'r num', render: (m) => `<b style="color:${m.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${qtyFmt(m.qty)}</b>` },
      { label: L('Par', 'By'), render: (m) => `${esc(m.user_name || '')}<div class="muted sm">${esc(m.note || '')}</div>`, hideM: true }] });
  } else {
    const rows = await api.get(`/api/shop/stock${qs({ store_id: ctx.query.store_id, q: ctx.query.q, low: tab === 'low' ? 1 : '' })}`);
    const value = rows.reduce((t, r) => t + r.value, 0);
    body = `<div class="grid g3" style="margin-bottom:14px">${kpi(L('Valeur du stock (coût HT)', 'Stock value (cost)'), money(value), `${rows.length} ${L('article(s)', 'product(s)')}`, 'accent')}${kpi(L('Sous le seuil', 'Below minimum'), num(rows.filter((r) => r.low).length), L('à commander', 'to reorder'), '', '#/shop/orders?suggest=1')}${kpi(L('Stock négatif', 'Negative stock'), num(rows.filter((r) => r.qty < 0).length), L('à vérifier par inventaire', 'check with a count'))}</div>` + table({ rows, href: (r) => `/shop/item/${r.product_id}`, columns: [
      { label: L('Article', 'Product'), render: (r) => `<b>${esc(r.name)}</b><div class="muted mono sm">${esc(r.barcode || '')}</div>` },
      { label: L('Catégorie', 'Category'), render: (r) => esc(r.category || ''), hideM: true },
      { label: L('Qté', 'Qty'), cls: 'r num', render: (r) => `<b style="color:${r.qty < 0 ? 'var(--bad)' : r.low ? 'var(--warn)' : 'inherit'}">${qtyFmt(r.qty)}</b> <span class="dim">${esc(r.unit)}</span>` },
      { label: L('Seuil', 'Min'), cls: 'r num', hideM: true, render: (r) => (r.min_stock ? qtyFmt(r.min_stock) : '') },
      { label: L('Valeur', 'Value'), cls: 'r num', hideM: true, render: (r) => money(r.value) },
      { label: L('Péremption', 'Expiry'), render: (r) => (r.next_expiry ? `<span style="color:${r.next_expiry < today() ? 'var(--bad)' : 'inherit'}">${dt(r.next_expiry)}</span>` : ''), hideM: true }],
    empty: `<b>${tab === 'low' ? L('Rien sous le seuil', 'Nothing below minimum') : L('Aucun article', 'No products')}</b>` });
  }
  ctx.el.innerHTML = head + body;
  wireStore(ctx);
  ctx.el.querySelector('#days')?.addEventListener('change', (e) => { location.hash = ctx.path + qs({ ...ctx.query, days: e.target.value }); });
  let t; ctx.el.querySelector('#q')?.addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = ctx.path + qs({ ...ctx.query, q: e.target.value }); }, 450); });
}, true);

// ===================== Customers & loyalty =====================
R('/shop/customers', async (ctx) => {
  ctx.title(L('Clients et fidélité', 'Customers & loyalty'));
  ctx.actions(`<a class="btn hide-m" href="/api/shop/customers${qs({ format: 'xlsx' })}">${icon('download')}Excel</a>${canAny('pos', 'sales') ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Client', 'Customer')}</span></button>` : ''}`);
  const rows = await api.get(`/api/shop/customers${qs({ q: ctx.query.q })}`);
  const s = state.shop.settings;
  ctx.el.innerHTML = `<div class="card info-card" style="margin-bottom:14px">${icon('star')} <span>${L('Programme', 'Programme')} : <b>1 point / ${num(s.points_per_amount)} FCFA</b>, 1 point = <b>${num(s.point_value)} FCFA</b> ${L('dès', 'from')} ${num(s.min_points_redeem)} pts · ${L('Compte prépayé', 'Prepaid account')} : <b>+${String(s.topup_bonus_pct).replace('.', ',')} % ${L('de bonus', 'bonus')}</b> ${L('pour les recharges dès', 'on top-ups from')} ${money(s.topup_bonus_min)}${can('settings') ? ` · <a href="#/shop/settings">${L('modifier', 'change')}</a>` : ''}</span></div>
  <div class="filters"><input type="search" class="in" id="q" value="${esc(ctx.query.q || '')}" placeholder="${L('Nom, téléphone, n° de carte…', 'Name, phone, card no.…')}"></div>
  ${table({ rows, href: (r) => `/shop/customer/${r.id}`, columns: [
    { label: L('Client', 'Customer'), render: (r) => `<b>${esc(r.name)}</b>${r.price_level === 'wholesale' ? ` <span class="pill info">${L('gros', 'wholesale')}</span>` : ''}<div class="muted sm">${esc(r.phone || '')} · <span class="mono">${esc(r.card_no || '')}</span></div>` },
    { label: 'Points', cls: 'r num', render: (r) => num(r.points) },
    { label: L('Prépayé', 'Prepaid'), cls: 'r num', render: (r) => (r.wallet ? money(r.wallet) : '') },
    { label: 'Bonus', cls: 'r num', hideM: true, render: (r) => (r.bonus ? money(r.bonus) : '') },
    { label: L('Crédit', 'Credit'), cls: 'r num', render: (r) => (r.debt ? `<b style="color:var(--bad)">${money(r.debt)}</b>` : '') + (r.credit_limit ? `<div class="muted sm">${L('plafond', 'limit')} ${money(r.credit_limit)}</div>` : '') },
    { label: L('Dernière visite', 'Last visit'), render: (r) => dt(r.last_visit), hideM: true }],
  empty: `<b>${L('Aucun client fidélité', 'No loyalty customers')}</b>` })}`;
  let t; ctx.el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = ctx.path + qs({ q: e.target.value }); }, 450); });
  document.getElementById('new')?.addEventListener('click', async () => { const c = await customerDialog(); if (c) { resetCatalog(); location.hash = `#/shop/customer/${c.partner_id}`; } });
}, true);

R('/shop/customer/:id', async (ctx) => {
  const c = await api.get(`/api/shop/customers/${ctx.params.id}`);
  ctx.title(c.name);
  const s = state.shop.settings;
  ctx.actions(`<button class="btn" id="card">${icon('card')}<span class="hide-m">${L('Carte de fidélité', 'Loyalty card')}</span></button>${canAny('pos', 'sales') ? `<button class="btn" id="adj">${icon('gift')}<span class="hide-m">${L('Offrir points / bonus', 'Gift points / bonus')}</span></button><button class="btn" id="edit">${L('Modifier', 'Edit')}</button>` : ''}`);
  const MV = { points_earned: L('Points gagnés', 'Points earned'), points_used: L('Points utilisés', 'Points used'), wallet_topup: L('Recharge du compte', 'Account top-up'), wallet_used: L('Paiement avec le compte prépayé', 'Paid from prepaid account'), bonus_used: L('Bonus utilisé', 'Bonus used'), adjust: L('Geste commercial', 'Manual adjustment'), return: L('Retour d\'article', 'Return'), void: L('Ticket annulé', 'Receipt voided') };
  const sgn = (v, suffix = '') => (v ? `<span style="color:${v < 0 ? 'var(--bad)' : 'var(--ok)'}">${v > 0 ? '+' : ''}${num(v)}${suffix}</span>` : '');
  ctx.el.innerHTML = `<div class="grid g4">
    ${kpi(L('Points de fidélité', 'Loyalty points'), `${num(c.points)} pts`, `= ${money(c.points * s.point_value)} ${L('de remise', 'off')}`, 'accent')}
    ${kpi(L('Compte prépayé', 'Prepaid account'), money(c.wallet), `${L('+ bonus', '+ bonus')} ${money(c.bonus)}`)}
    ${kpi(L('Crédit en cours', 'Credit outstanding'), `<span style="color:${c.debt ? 'var(--bad)' : 'inherit'}">${money(c.debt)}</span>`, c.credit_limit ? `${L('plafond', 'limit')} ${money(c.credit_limit)}` : L('pas de crédit autorisé', 'no credit allowed'))}
    ${kpi(L('Visites', 'Visits'), num(c.stats.visits), `${L('dépensé', 'spent')} ${money(c.stats.spent)}`)}
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${L('Fiche', 'Details')}</h3>
      <div class="row between lrow"><span>${L('Téléphone', 'Phone')}</span><b>${esc(c.phone || '—')}</b></div>
      <div class="row between lrow"><span>${L('N° de carte', 'Card no.')}</span><b class="mono">${esc(c.card_no || '')}</b></div>
      <div class="row between lrow"><span>${L('Tarif', 'Price level')}</span><b>${c.price_level === 'wholesale' ? L('Gros', 'Wholesale') : L('Détail', 'Retail')}</b></div>
      <div class="row between lrow"><span>${L('Anniversaire', 'Birthday')}</span><b>${dt(c.birthday) || '—'}</b></div>
      ${c.invoices.length ? `<h3 style="margin-top:14px">${L('Factures à crédit', 'Credit invoices')}</h3>${c.invoices.map((i) => `<a class="row between lrow" href="#/doc/${i.id}"><span class="mono">${esc(i.number)} <span class="dim">${dt(i.date)}</span></span><span>${['open', 'partial'].includes(i.status) ? `<b class="num" style="color:var(--bad)">${money(i.balance)}</b>` : pill(i.status)}</span></a>`).join('')}<p class="muted sm">${L('Le client rembourse à la caisse (menu ⋯ › Remboursement crédit).', 'The customer repays at the till (menu ⋯ › Credit repayment).')}</p>` : ''}</div>
    <div class="card"><h3>${L('Historique fidélité et prépayé', 'Loyalty & prepaid history')}</h3>${c.moves.length ? c.moves.map((m) => `<div class="row between lrow" style="flex-wrap:nowrap"><span>${esc(MV[m.kind] || m.kind)}<div class="muted sm">${dt(m.at)} ${m.sale_number ? `· ${esc(m.sale_number)}` : ''} ${m.note ? `· ${esc(m.note)}` : ''}</div></span><span class="r num">${sgn(m.points, ' pts')} ${sgn(m.wallet, ' F')} ${sgn(m.bonus, ' F bonus')}</span></div>`).join('') : `<p class="muted">—</p>`}</div>
  </div>
  <h3 style="margin:18px 0 10px">${L('Derniers achats', 'Recent purchases')}</h3>
  ${table({ rows: c.sales, href: (x) => `/pos/sale/${x.id}`, columns: [{ label: L('Ticket', 'Receipt'), render: (x) => `<span class="mono">${esc(x.number)}</span>` }, { label: L('Date', 'Date'), render: (x) => dt(x.created_at) }, { label: L('Type', 'Type'), render: (x) => (x.kind === 'return' ? L('Retour', 'Return') : x.kind === 'topup' ? L('Recharge', 'Top-up') : L('Vente', 'Sale')) + (x.status === 'voided' ? ` ${pill('cancelled')}` : '') }, { label: 'Total', cls: 'r num', render: (x) => money(x.total) }] })}`;
  document.getElementById('edit')?.addEventListener('click', async () => { if (await customerDialog(c)) { resetCatalog(); ctx.rerender(); } });
  document.getElementById('card').addEventListener('click', () => printCard(c));
  document.getElementById('adj')?.addEventListener('click', async () => {
    const r = await dialog({ title: L('Offrir des points ou du bonus', 'Gift points or bonus'), submit: L('Valider', 'Confirm'),
      body: `<p class="muted" style="margin-top:0">${L('Anniversaire, geste commercial, correction. Un code gérant est demandé et l\'opération est tracée.', 'Birthday, goodwill, correction. Needs a manager code and is logged.')}</p><div class="f2">${field({ name: 'points', label: L('Points (+ / −)', 'Points (+/−)'), type: 'number' })}${field({ name: 'bonus', label: L('Bonus FCFA (+ / −)', 'Bonus FCFA (+/−)'), type: 'number' })}${field({ name: 'note', label: L('Motif', 'Reason'), required: true, span: true })}</div>`,
      onSubmit: (v) => withPin((pin) => api.post(`/api/shop/customers/${c.partner_id}/adjust`, { ...v, manager_pin: pin })) });
    if (r) { resetCatalog(); toast(L('Compte client mis à jour', 'Customer account updated'), 'ok'); ctx.rerender(); }
  });
}, true);

function printCard(c) {
  const w = window.open('', '_blank');
  if (!w) return toast(L('Autorisez les fenêtres pour imprimer', 'Allow pop-ups to print'), 'err');
  const b = state.brand || {};
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.name)}</title><style>
    body{font-family:system-ui,Arial,sans-serif;margin:24px}.cc{width:85.6mm;height:54mm;border-radius:4mm;background:linear-gradient(135deg,${b.navy || '#0A2540'},${b.accent || '#0B8AC9'});color:#fff;padding:5mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .t{display:flex;justify-content:space-between;font-weight:800;letter-spacing:.06em;font-size:11pt}.t small{font-weight:500;opacity:.8}.n{font-size:12pt;font-weight:700}.bc{background:#fff;border-radius:2mm;padding:1.5mm 2mm 0;text-align:center}.bc svg{max-width:100%;height:13mm}
    @media print{body{margin:0}.no{display:none}}</style></head><body>
    <div class="cc"><div class="t"><span>${esc(state.me.company.name.toUpperCase())}</span><small>${L('CARTE FIDÉLITÉ', 'LOYALTY CARD')}</small></div><div class="n">${esc(c.name)}</div><div class="bc">${barcodeSvg(c.card_no, { height: 40, module: 1.4 })}</div></div>
    <p class="no"><button onclick="print()">${L('Imprimer', 'Print')}</button></p><script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

// ===================== Promotions =====================
const DAYS = [[1, L('Lun', 'Mon')], [2, L('Mar', 'Tue')], [3, L('Mer', 'Wed')], [4, L('Jeu', 'Thu')], [5, L('Ven', 'Fri')], [6, L('Sam', 'Sat')], [0, L('Dim', 'Sun')]];
const promoText = (p) => ({
  percent: `−${p.value} %`, price: `${L('prix promo', 'promo price')} ${money(p.value)}`,
  bundle: `${p.qty} ${L('pour', 'for')} ${money(p.value)}`, buy_get: `${p.qty} ${L('achetés', 'bought')} = ${p.free_qty} ${L('offert(s)', 'free')}`,
}[p.kind] || p.kind);
R('/shop/promos', async (ctx) => {
  ctx.title(L('Promotions', 'Promotions'));
  const edit = canAny('stock', 'settings');
  ctx.actions(edit ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Promotion', 'Promotion')}</span></button>` : '');
  const rows = await api.get('/api/shop/promos');
  const t = today();
  const status = (p) => (!p.active ? ['', L('Arrêtée', 'Stopped')] : p.end_date && p.end_date < t ? ['', L('Terminée', 'Ended')] : p.start_date && p.start_date > t ? ['info', L('À venir', 'Upcoming')] : ['ok', L('En cours', 'Running')]);
  ctx.el.innerHTML = `<p class="muted" style="margin-top:0">${L('Les promotions s\'appliquent toutes seules à la caisse et s\'affichent sur l\'écran client. Types : remise en %, prix promo, lot (3 pour 1 000), X achetés = Y offerts. Jours possibles : « happy days ».', 'Promotions apply automatically at the till and show on the customer display.')}</p>
  ${table({ rows, columns: [
    { label: L('Promotion', 'Promotion'), render: (p) => `<b>${esc(p.name)}</b><div class="muted sm">${esc(p.product_name || p.category_name || L('Tout le magasin', 'Whole store'))}</div>` },
    { label: L('Offre', 'Offer'), render: (p) => `<span class="pill info">${esc(promoText(p))}</span>` },
    { label: L('Période', 'Period'), hideM: true, render: (p) => `${p.start_date ? dt(p.start_date) : '…'} → ${p.end_date ? dt(p.end_date) : '…'}${p.days ? `<div class="muted sm">${String(p.days).split(',').map((d) => DAYS.find((x) => String(x[0]) === d)?.[1]).join(', ')}</div>` : ''}` },
    { label: L('Statut', 'Status'), render: (p) => { const [c, l] = status(p); return `<span class="pill ${c}">${l}</span>`; } },
    { label: '', cls: 'r', render: (p) => (edit ? `<button class="btn sm" data-edit="${p.id}">${L('Modifier', 'Edit')}</button> <button class="btn sm" data-tog="${p.id}">${p.active ? L('Arrêter', 'Stop') : L('Relancer', 'Restart')}</button>` : '') }],
  empty: `<b>${L('Aucune promotion', 'No promotions')}</b>` })}`;
  const find = (id) => rows.find((p) => String(p.id) === id);
  document.getElementById('new')?.addEventListener('click', async () => { if (await promoDialog()) { resetCatalog(); ctx.rerender(); } });
  ctx.el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => { if (await promoDialog(find(b.dataset.edit))) { resetCatalog(); ctx.rerender(); } }));
  ctx.el.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', async () => { const p = find(b.dataset.tog); try { await api.put(`/api/shop/promos/${p.id}`, { active: !p.active }); resetCatalog(); ctx.rerender(); } catch (e) { showError(e); } }));
}, true);

async function promoDialog(p) {
  const items = await api.get('/api/shop/items');
  const v = p || { kind: 'percent', start_date: today() };
  const days = String(v.days || '').split(',').filter(Boolean);
  return dialog({ title: p ? L('Modifier la promotion', 'Edit promotion') : L('Nouvelle promotion', 'New promotion'), wide: true,
    body: `<div class="f2">
      ${field({ name: 'name', label: L('Nom (affiché sur le ticket)', 'Name (shown on receipt)'), required: true, span: true, placeholder: L('ex. Fête des mères −10 %', 'e.g. Mother\'s Day −10 %') }, v)}
      ${field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: [['percent', L('Remise en %', 'Percent off')], ['price', L('Prix promo (par unité)', 'Promo unit price')], ['bundle', L('Lot : N pour un prix', 'Bundle: N for a price')], ['buy_get', L('N achetés = M offerts', 'Buy N get M free')]] }, v)}
      ${field({ name: 'product_id', label: L('Article', 'Product'), type: 'select', options: [['', L('— Aucun (catégorie ou tout) —', '— None (category or all) —')], ...items.map((i) => [i.id, `${i.name} · ${num(i.retail_price)}`])] }, v)}
      ${field({ name: 'category_id', label: L('ou catégorie (remise %)', 'or category (percent)'), type: 'select', options: catOpts() }, v)}
      ${field({ name: 'value', label: L('Valeur : % ou prix FCFA', 'Value: % or FCFA price'), type: 'number', min: 0, step: 'any' }, v)}
      ${field({ name: 'qty', label: L('Quantité du lot / achetés', 'Bundle size / bought'), type: 'number', min: 0, step: 'any' }, v)}
      ${field({ name: 'free_qty', label: L('Offerts', 'Free'), type: 'number', min: 0, step: 'any' }, v)}
      ${field({ name: 'start_date', label: L('Début', 'Start'), type: 'date' }, v)}
      ${field({ name: 'end_date', label: L('Fin', 'End'), type: 'date' }, v)}
      <div class="fld" style="grid-column:1/-1">${L('Jours (aucun = tous les jours)', 'Days (none = every day)')}<div class="row">${DAYS.map(([d, l]) => `<label class="check"><input type="checkbox" data-day="${d}" ${days.includes(String(d)) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div></div>`,
    onSubmit: (val, form) => {
      const d = [...form.querySelectorAll('[data-day]:checked')].map((c) => c.dataset.day).join(',');
      Object.keys(val).filter((k) => k.startsWith('day')).forEach((k) => delete val[k]);
      return p ? api.put(`/api/shop/promos/${p.id}`, { ...val, days: d }) : api.post('/api/shop/promos', { ...val, days: d });
    } });
}

// ===================== Lines editor (orders, transfers) =====================
function linePicker(items, lines, { cost = false, onChange }) {
  const wrap = document.createElement('div');
  const byCode = Object.fromEntries(items.filter((i) => i.barcode).map((i) => [i.barcode, i]));
  const draw = () => {
    wrap.innerHTML = `<div class="row" style="flex-wrap:nowrap;margin-bottom:10px"><input class="in" id="lp" list="lpl" placeholder="${L('Scannez ou tapez le nom de l\'article', 'Scan or type the product name')}"><button type="button" class="btn" id="lpc">${icon('camera')}</button></div>
      <datalist id="lpl">${items.map((i) => `<option value="${esc(i.name)}">`).join('')}</datalist>
      ${lines.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${L('Article', 'Product')}</th><th class="r">${L('Qté', 'Qty')}</th>${cost ? `<th class="r">${L('Coût HT', 'Cost')}</th>` : ''}<th></th></tr></thead><tbody>
      ${lines.map((l, i) => `<tr><td>${esc(l.name)}${l.hint ? `<div class="muted sm">${esc(l.hint)}</div>` : ''}</td><td class="r"><input class="in r" type="number" step="any" min="0" data-q="${i}" value="${l.qty}" style="width:90px"></td>${cost ? `<td class="r"><input class="in r" type="number" min="0" data-c="${i}" value="${l.unit_cost}" style="width:110px"></td>` : ''}<td class="r"><button type="button" class="btn sm ghost" data-rm="${i}">${icon('x')}</button></td></tr>`).join('')}
      </tbody></table></div>${cost ? `<p class="r"><b>${L('Total HT', 'Total')} : ${money(lines.reduce((t, l) => t + Math.round(l.qty * l.unit_cost), 0))}</b></p>` : ''}` : `<p class="muted">${L('Aucune ligne.', 'No lines.')}</p>`}`;
    const add = (it) => { if (!it) return toast(L('Article introuvable', 'Product not found'), 'err'); const ex = lines.find((l) => l.product_id === it.id); if (ex) ex.qty = Number(ex.qty) + 1; else lines.push({ product_id: it.id, name: it.name, qty: 1, unit_cost: Math.round(it.avg_cost || 0) }); onChange?.(); draw(); wrap.querySelector('#lp').focus(); };
    const inp = wrap.querySelector('#lp');
    inp.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const v = inp.value.trim(); add(byCode[v] || items.find((i) => i.name.toLowerCase() === v.toLowerCase()) || items.find((i) => i.name.toLowerCase().includes(v.toLowerCase()))); });
    inp.addEventListener('change', () => { const it = items.find((i) => i.name === inp.value); if (it) add(it); });
    wrap.querySelector('#lpc').addEventListener('click', () => cameraScan((code) => add(byCode[code]), { continuous: true, title: L('Scanner les articles', 'Scan products') }));
    wrap.querySelectorAll('[data-q]').forEach((el) => el.addEventListener('change', () => { lines[el.dataset.q].qty = Number(el.value); onChange?.(); draw(); }));
    wrap.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => { lines[el.dataset.c].unit_cost = Number(el.value); onChange?.(); draw(); }));
    wrap.querySelectorAll('[data-rm]').forEach((el) => el.addEventListener('click', () => { lines.splice(Number(el.dataset.rm), 1); onChange?.(); draw(); }));
  };
  draw();
  return wrap;
}

// ===================== Purchase orders =====================
R('/shop/orders', async (ctx) => {
  ctx.title(L('Commandes fournisseurs', 'Purchase orders'));
  ctx.actions(`<a class="btn" href="#/shop/orders?suggest=1">${icon('list')}<span class="hide-m">${L('Suggestions', 'Suggestions')}</span></a><a class="btn primary" href="#/shop/order/new">${icon('plus')}<span class="hide-m">${L('Commande', 'Order')}</span></a>`);
  if (ctx.query.suggest) {
    const store = ctx.query.store_id || state.shop.my_store;
    const rows = await api.get(`/api/shop/purchase-orders/suggest${qs({ store_id: store })}`);
    const groups = {};
    for (const r of rows) (groups[r.supplier_id || 0] ||= { id: r.supplier_id, name: r.supplier_name || L('Sans fournisseur', 'No supplier'), rows: [] }).rows.push(r);
    ctx.el.innerHTML = `<div class="filters"><a class="btn sm" href="#/shop/orders">← ${L('Commandes', 'Orders')}</a>${storeSelect({ ...ctx, query: { store_id: store } })}</div>
      <p class="muted">${L('Articles sous le seuil d\'alerte (en tenant compte des commandes déjà passées), regroupés par fournisseur habituel.', 'Products under minimum (after open orders), grouped by usual supplier.')}</p>
      ${Object.values(groups).map((g) => `<div class="card" style="margin-bottom:14px"><div class="row between"><h3 style="margin:0">${esc(g.name)}</h3>${g.id ? `<button class="btn primary sm" data-sup="${g.id}">${L('Créer la commande', 'Create order')} (${money(g.rows.reduce((t, r) => t + r.suggested * r.unit_cost, 0))})</button>` : `<span class="muted sm">${L('Indiquez le fournisseur sur la fiche article', 'Set the supplier on the product')}</span>`}</div>
        ${table({ rows: g.rows, columns: [{ label: L('Article', 'Product'), render: (r) => `<a href="#/shop/item/${r.product_id}">${esc(r.name)}</a>` }, { label: 'Stock', cls: 'r num', render: (r) => `${qtyFmt(r.qty)} / ${qtyFmt(r.min_stock)}` }, { label: L('En commande', 'On order'), cls: 'r num', hideM: true, render: (r) => qtyFmt(r.on_order) }, { label: L('À commander', 'To order'), cls: 'r num', render: (r) => `<b>${qtyFmt(r.suggested)}</b>` }, { label: L('Coût', 'Cost'), cls: 'r num', hideM: true, render: (r) => money(r.unit_cost) }] })}</div>`).join('') || `<div class="card empty"><b>${L('Rien à commander', 'Nothing to order')}</b>${L('Tous les articles suivis sont au-dessus du seuil.', 'All tracked products are above minimum.')}</div>`}`;
    wireStore(ctx);
    ctx.el.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', async () => {
      const g = groups[b.dataset.sup];
      try { const o = await api.post('/api/shop/purchase-orders', { supplier_id: g.id, store_id: store, lines: g.rows.map((r) => ({ product_id: r.product_id, qty: r.suggested, unit_cost: r.unit_cost })) }); location.hash = `#/shop/order/${o.id}`; } catch (e) { showError(e); }
    }));
    return;
  }
  const rows = await api.get('/api/shop/purchase-orders');
  const ST = { draft: ['', L('Brouillon', 'Draft')], sent: ['info', L('Envoyée', 'Sent')], received: ['ok', L('Reçue', 'Received')], cancelled: ['', L('Annulée', 'Cancelled')] };
  ctx.el.innerHTML = table({ rows, href: (r) => `/shop/order/${r.id}`, columns: [
    { label: L('N°', 'No.'), render: (r) => `<span class="mono">${esc(r.number)}</span>` }, { label: L('Fournisseur', 'Supplier'), render: (r) => `<b>${esc(r.supplier_name)}</b><div class="muted sm">${esc(r.store_name)} · ${r.n_lines} ${L('ligne(s)', 'line(s)')}</div>` },
    { label: L('Date', 'Date'), render: (r) => dt(r.date), hideM: true }, { label: L('Livraison prévue', 'Expected'), render: (r) => dt(r.expected_date), hideM: true },
    { label: L('Total HT', 'Total'), cls: 'r num', render: (r) => money(r.total) }, { label: L('Statut', 'Status'), render: (r) => `<span class="pill ${ST[r.status]?.[0]}">${ST[r.status]?.[1] || r.status}</span>` }],
  empty: `<b>${L('Aucune commande', 'No orders')}</b><a href="#/shop/orders?suggest=1">${L('Voir les suggestions de réapprovisionnement', 'See reorder suggestions')}</a>` });
}, true);

R('/shop/order/new', async (ctx) => {
  ctx.title(L('Nouvelle commande fournisseur', 'New purchase order'));
  const [sups, items] = await Promise.all([api.get('/api/partners?kind=supplier'), api.get('/api/shop/items')]);
  const lines = [];
  ctx.el.innerHTML = `<div class="card"><form id="f" class="f3">${field({ name: 'supplier_id', label: L('Fournisseur', 'Supplier'), type: 'select', required: true, options: [['', '—'], ...sups.map((s) => [s.id, s.name])] })}
    ${field({ name: 'store_id', label: L('Livrer à', 'Deliver to'), type: 'select', options: storeOpts(false), value: state.shop.my_store })}${field({ name: 'expected_date', label: L('Livraison prévue', 'Expected date'), type: 'date' })}
    ${field({ name: 'notes', label: L('Notes', 'Notes'), span: true })}</form>
    ${sups.length ? '' : `<p class="muted">${L('Ajoutez d\'abord un fournisseur', 'Add a supplier first')} : <a href="#/partners/supplier">${L('Fournisseurs', 'Suppliers')}</a></p>`}
    <h3 style="margin-top:16px">${L('Articles', 'Products')}</h3><div id="lines"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="save">${L('Enregistrer en brouillon', 'Save draft')}</button><button class="btn primary" id="send">${L('Enregistrer et envoyer', 'Save and send')}</button></div></div>`;
  const f = ctx.el.querySelector('#f');
  f.supplier_id.addEventListener('change', () => { if (lines.length) return; items.filter((i) => String(i.supplier_id) === f.supplier_id.value && i.min_stock && i.qty <= i.min_stock).forEach((i) => lines.push({ product_id: i.id, name: i.name, qty: i.reorder_qty || 1, unit_cost: Math.round(i.avg_cost) })); ctx.el.querySelector('#lines').replaceChildren(linePicker(items, lines, { cost: true })); });
  ctx.el.querySelector('#lines').append(linePicker(items, lines, { cost: true }));
  const save = async (send) => { if (!f.reportValidity()) return; try { const o = await api.post('/api/shop/purchase-orders', { supplier_id: f.supplier_id.value, store_id: f.store_id.value, expected_date: f.expected_date.value, notes: f.notes.value, send, lines }); location.hash = `#/shop/order/${o.id}`; } catch (e) { showError(e); } };
  ctx.el.querySelector('#save').addEventListener('click', () => save(false));
  ctx.el.querySelector('#send').addEventListener('click', () => save(true));
});

R('/shop/order/:id', async (ctx) => {
  const o = await api.get(`/api/shop/purchase-orders/${ctx.params.id}`);
  ctx.title(`${L('Commande', 'Order')} ${o.number}`);
  const open = ['draft', 'sent'].includes(o.status);
  const wa = String(o.supplier_phone || '').replace(/\D/g, '').replace(/^(6\d{8})$/, '237$1');
  ctx.actions(`<a class="btn" target="_blank" href="/print/shop/po/${o.id}">${icon('print')}PDF</a>${open && wa ? `<a class="btn hide-m" target="_blank" href="https://wa.me/${wa}?text=${encodeURIComponent(`${L('Bonjour, voici notre commande', 'Hello, here is our order')} ${o.number} :\n${o.lines.map((l) => `- ${l.name} × ${qtyFmt(l.qty)}`).join('\n')}\n${state.me.company.name}`)}">WhatsApp</a>` : ''}${open && o.status === 'draft' ? `<button class="btn" id="sent">${L('Marquer envoyée', 'Mark sent')}</button>` : ''}${open ? `<button class="btn danger" id="cancel">${L('Annuler', 'Cancel')}</button>` : ''}`);
  ctx.el.innerHTML = `<div class="card"><div class="doc-head"><div><div class="muted">${L('Fournisseur', 'Supplier')}</div><h2 style="margin:2px 0">${esc(o.supplier_name)}</h2><div class="muted">${esc(o.store_name)} · ${dt(o.date)} · ${L('livraison prévue', 'expected')} ${dt(o.expected_date)}</div></div>
    <div class="r"><div class="doc-amount">${money(o.total)}</div><div class="muted">HT</div>${o.document_id ? `<a href="#/doc/${o.document_id}">${L('Facture fournisseur', 'Supplier bill')} ${esc(o.bill_number || '')}</a>` : ''}</div></div>
    ${o.notes ? `<p class="muted">${esc(o.notes)}</p>` : ''}</div>
  ${open && can('stock') ? `<h3 style="margin:18px 0 10px">${L('Réception de la marchandise', 'Goods receipt')}</h3><p class="muted" style="margin-top:0">${L('Indiquez ce qui est réellement livré, le coût sur la facture et la date de péremption des produits frais. Le stock, le coût moyen et la facture fournisseur (Compta) sont mis à jour.', 'Enter what was actually delivered, the invoiced cost and expiry dates. Stock, average cost and the supplier bill are updated.')}</p>` : '<div style="height:16px"></div>'}
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${L('Article', 'Product')}</th><th class="r">${L('Commandé', 'Ordered')}</th><th class="r">${L('Reçu', 'Received')}</th>${open ? `<th class="r">${L('Livré', 'Delivered')}</th><th class="r">${L('Coût HT', 'Cost')}</th><th>${L('Péremption / lot', 'Expiry / lot')}</th>` : `<th class="r">${L('Coût HT', 'Cost')}</th>`}</tr></thead><tbody>
  ${o.lines.map((l) => `<tr><td><b>${esc(l.name)}</b><div class="muted mono sm">${esc(l.barcode || '')}</div></td><td class="r num">${qtyFmt(l.qty)}</td><td class="r num">${qtyFmt(l.received_qty)}</td>
    ${open ? `<td class="r"><input class="in r" type="number" step="any" min="0" data-rq="${l.id}" value="${Math.max(0, l.qty - l.received_qty)}" style="width:90px"></td><td class="r"><input class="in r" type="number" min="0" data-rc="${l.id}" value="${l.unit_cost}" style="width:110px"></td>
      <td>${l.track_expiry ? `<div class="row" style="flex-wrap:nowrap"><input class="in" type="date" data-re="${l.id}" required style="width:150px"><input class="in" data-rl="${l.id}" placeholder="${L('lot', 'lot')}" style="width:90px"></div>` : '<span class="dim">—</span>'}</td>` : `<td class="r num">${money(l.unit_cost)}</td>`}</tr>`).join('')}
  </tbody></table></div>
  ${open && can('stock') ? `<div class="row" style="justify-content:flex-end;margin-top:12px"><input class="in" id="sref" placeholder="${L('N° facture / BL fournisseur', 'Supplier invoice / delivery no.')}" style="max-width:260px"><button class="btn primary" id="recv">${icon('box')}${L('Réceptionner', 'Receive')}</button></div>` : ''}`;
  document.getElementById('sent')?.addEventListener('click', async () => { try { await api.put(`/api/shop/purchase-orders/${o.id}`, { status: 'sent' }); ctx.rerender(); } catch (e) { showError(e); } });
  document.getElementById('cancel')?.addEventListener('click', async () => { if (!await confirmDlg(L('Annuler la commande', 'Cancel order'), L('La commande ne pourra plus être reçue.', 'The order can no longer be received.'), L('Annuler la commande', 'Cancel order'), true)) return; try { await api.put(`/api/shop/purchase-orders/${o.id}`, { status: 'cancelled' }); ctx.rerender(); } catch (e) { showError(e); } });
  ctx.el.querySelector('#recv')?.addEventListener('click', async () => {
    const lines = o.lines.map((l) => ({ line_id: l.id, qty: Number(ctx.el.querySelector(`[data-rq="${l.id}"]`).value), unit_cost: Number(ctx.el.querySelector(`[data-rc="${l.id}"]`).value), expiry: ctx.el.querySelector(`[data-re="${l.id}"]`)?.value || undefined, lot: ctx.el.querySelector(`[data-rl="${l.id}"]`)?.value || undefined })).filter((l) => l.qty > 0);
    try { await api.post(`/api/shop/purchase-orders/${o.id}/receive`, { lines, supplier_ref: ctx.el.querySelector('#sref').value }); resetCatalog(); toast(L('Marchandise réceptionnée, stock et facture fournisseur à jour', 'Goods received; stock and supplier bill updated'), 'ok'); ctx.rerender(); } catch (e) { showError(e); }
  });
});

// ===================== Transfers =====================
R('/shop/transfers', async (ctx) => {
  ctx.title(L('Transferts entre emplacements', 'Transfers between locations'));
  ctx.actions(can('stock') && stores().length > 1 ? `<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Transfert', 'Transfer')}</span></button>` : '');
  const rows = await api.get('/api/shop/transfers');
  ctx.el.innerHTML = `${stores().length < 2 ? `<div class="card info-card" style="margin-bottom:14px">${L('Ajoutez un dépôt ou une deuxième boutique dans les', 'Add a warehouse or a second shop in')} <a href="#/shop/settings">${L('réglages caisse', 'till settings')}</a> ${L('pour transférer du stock.', 'to move stock.')}</div>` : ''}
  ${table({ rows, href: (r) => `/shop/transfer/${r.id}`, columns: [{ label: L('N°', 'No.'), render: (r) => `<span class="mono">${esc(r.number)}</span>` }, { label: L('De → vers', 'From → to'), render: (r) => `<b>${esc(r.from_name)}</b> → <b>${esc(r.to_name)}</b><div class="muted sm">${r.n_lines} ${L('ligne(s)', 'line(s)')}</div>` }, { label: L('Date', 'Date'), render: (r) => dt(r.created_at) }, { label: L('Statut', 'Status'), render: (r) => (r.status === 'received' ? `<span class="pill ok">${L('Reçu', 'Received')}</span>` : `<span class="pill warn">${L('En route', 'In transit')}</span>`) }],
    empty: `<b>${L('Aucun transfert', 'No transfers')}</b>` })}`;
  document.getElementById('new')?.addEventListener('click', async () => {
    const items = await api.get('/api/shop/items');
    const lines = [];
    const r = await dialog({ title: L('Nouveau transfert', 'New transfer'), wide: true, submit: L('Envoyer la marchandise', 'Send goods'),
      body: `<div class="f2">${field({ name: 'from_store', label: L('De', 'From'), type: 'select', options: storeOpts(false), value: stores().find((s) => s.kind === 'warehouse')?.id })}${field({ name: 'to_store', label: L('Vers', 'To'), type: 'select', options: storeOpts(false), value: state.shop.my_store })}${field({ name: 'notes', label: L('Notes (chauffeur, véhicule…)', 'Notes (driver, vehicle…)'), span: true })}</div><div id="tl" style="margin-top:14px"></div>`,
      onOpen: (d) => d.querySelector('#tl').append(linePicker(items, lines, {})),
      onSubmit: (v) => api.post('/api/shop/transfers', { ...v, lines }) });
    if (r) location.hash = `#/shop/transfer/${r.id}`;
  });
}, true);

R('/shop/transfer/:id', async (ctx) => {
  const t = await api.get(`/api/shop/transfers/${ctx.params.id}`);
  ctx.title(`${L('Transfert', 'Transfer')} ${t.number}`);
  const open = t.status !== 'received';
  ctx.el.innerHTML = `<div class="card"><h2 style="margin:0">${esc(t.from_name)} → ${esc(t.to_name)}</h2><div class="muted">${dt(t.created_at)} · ${esc(t.created_by_name || '')} ${t.notes ? `· ${esc(t.notes)}` : ''}</div>
    <p>${open ? `<span class="pill warn">${L('En route : sorti du stock de départ, pas encore entré à l\'arrivée', 'In transit: out of the source, not yet in the destination')}</span>` : `<span class="pill ok">${L('Reçu le', 'Received on')} ${dt(t.received_at)}</span>`}</p></div>
  <div class="tbl-wrap" style="margin-top:16px"><table class="tbl"><thead><tr><th>${L('Article', 'Product')}</th><th class="r">${L('Envoyé', 'Sent')}</th><th class="r">${L('Reçu', 'Received')}</th></tr></thead><tbody>
  ${t.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r num">${qtyFmt(l.qty)}</td><td class="r">${open ? `<input class="in r" type="number" step="any" min="0" data-tq="${l.id}" value="${l.qty}" style="width:90px">` : `<span class="num" style="color:${l.received_qty < l.qty ? 'var(--bad)' : 'inherit'}">${qtyFmt(l.received_qty)}</span>`}</td></tr>`).join('')}
  </tbody></table></div>
  ${open && can('stock') ? `<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" id="recv">${L('Confirmer la réception', 'Confirm receipt')}</button></div><p class="muted r sm">${L('Un manquant crée une alerte pour le gérant.', 'A shortfall alerts the manager.')}</p>` : ''}`;
  ctx.el.querySelector('#recv')?.addEventListener('click', async () => {
    try { await api.post(`/api/shop/transfers/${t.id}/receive`, { lines: t.lines.map((l) => ({ line_id: l.id, qty: Number(ctx.el.querySelector(`[data-tq="${l.id}"]`).value) })) }); toast(L('Transfert reçu', 'Transfer received'), 'ok'); ctx.rerender(); } catch (e) { showError(e); }
  });
});

// ===================== Inventory counts =====================
R('/shop/counts', async (ctx) => {
  ctx.title(L('Inventaires', 'Stock counts'));
  ctx.actions(`<button class="btn primary" id="new">${icon('plus')}<span class="hide-m">${L('Nouvel inventaire', 'New count')}</span></button>`);
  const rows = await api.get('/api/shop/counts');
  ctx.el.innerHTML = `<p class="muted" style="margin-top:0">${L('Comptez avec le téléphone : scannez chaque article avec la caméra ou une douchette, la quantité s\'ajoute toute seule. À la clôture, les écarts corrigent le stock et sont valorisés.', 'Count with a phone: scan each product with the camera or a scanner. On closing, differences fix the stock and are valued.')}</p>
  ${table({ rows, href: (r) => `/shop/count/${r.id}`, columns: [{ label: L('N°', 'No.'), render: (r) => `<span class="mono">${esc(r.number)}</span>` }, { label: L('Emplacement', 'Location'), render: (r) => `<b>${esc(r.store_name)}</b><div class="muted sm">${esc(r.scope || L('Tout le stock', 'All stock'))}</div>` },
    { label: L('Avancement', 'Progress'), render: (r) => `${r.counted} / ${r.n_lines}` }, { label: L('Écart', 'Variance'), cls: 'r num', render: (r) => (r.status === 'closed' ? `<b style="color:${r.variance_value < 0 ? 'var(--bad)' : 'inherit'}">${money(r.variance_value)}</b>` : '') },
    { label: L('Statut', 'Status'), render: (r) => (r.status === 'open' ? `<span class="pill info">${L('En cours', 'Open')}</span>` : r.status === 'closed' ? `<span class="pill ok">${L('Clôturé', 'Closed')}</span>` : `<span class="pill">${L('Annulé', 'Cancelled')}</span>`) }],
  empty: `<b>${L('Aucun inventaire', 'No counts yet')}</b>` })}`;
  document.getElementById('new').addEventListener('click', async () => {
    const r = await dialog({ title: L('Nouvel inventaire', 'New count'), submit: L('Commencer', 'Start'),
      body: `<div class="f2">${field({ name: 'store_id', label: L('Emplacement', 'Location'), type: 'select', options: storeOpts(false), value: state.shop.my_store })}${field({ name: 'category_id', label: L('Catégorie (vide = tout)', 'Category (empty = all)'), type: 'select', options: catOpts() })}${field({ name: 'scope', label: L('Description', 'Description'), span: true, placeholder: L('ex. Rayon boissons', 'e.g. Drinks aisle') })}</div>`,
      onSubmit: (v) => api.post('/api/shop/counts', v) });
    if (r) location.hash = `#/shop/count/${r.id}`;
  });
}, true);

R('/shop/count/:id', async (ctx) => {
  const c = await api.get(`/api/shop/counts/${ctx.params.id}`);
  ctx.title(`${L('Inventaire', 'Count')} ${c.number}`);
  const open = c.status === 'open';
  const counted = c.lines.filter((l) => l.counted != null);
  const value = counted.reduce((t, l) => t + Math.round((l.counted - l.expected) * l.avg_cost), 0);
  const filter = ctx.query.f || 'all';
  const shown = c.lines.filter((l) => (filter === 'todo' ? l.counted == null : filter === 'diff' ? l.counted != null && l.counted !== l.expected : true));
  ctx.el.innerHTML = `<div class="grid g3">${kpi(L('Emplacement', 'Location'), esc(c.store_name), esc(c.scope || ''))}${kpi(L('Comptés', 'Counted'), `${counted.length} / ${c.lines.length}`, L('articles', 'products'))}${kpi(L('Écart valorisé', 'Valued variance'), `<span style="color:${value < 0 ? 'var(--bad)' : 'inherit'}">${money(c.status === 'closed' ? c.variance_value : value)}</span>`, L('au coût moyen HT', 'at average cost'), 'accent')}</div>
  ${open ? `<div class="card scanbox" style="margin-top:16px"><div class="row" style="flex-wrap:nowrap"><input class="in" id="code" placeholder="${L('Scannez un code-barres (douchette) puis Entrée', 'Scan a barcode then Enter')}" autofocus inputmode="numeric"><input class="in" id="qty" type="number" step="any" value="1" style="width:90px" title="${L('Quantité', 'Quantity')}"><button class="btn primary" id="cam">${icon('camera')}<span class="hide-m">${L('Caméra', 'Camera')}</span></button></div><div class="muted sm" id="last" style="margin-top:8px">${L('Chaque scan ajoute la quantité. Pour corriger, tapez directement le total dans la colonne « Compté ».', 'Each scan adds the quantity. To correct, type the total in the “Counted” column.')}</div></div>` : ''}
  <div class="filters" style="margin-top:16px"><div class="tabs">${[['all', L('Tout', 'All')], ['todo', L('À compter', 'To count')], ['diff', L('Écarts', 'Differences')]].map(([v, l]) => `<a href="#${ctx.path}?f=${v}" class="${filter === v ? 'on' : ''}">${l}</a>`).join('')}</div></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${L('Article', 'Product')}</th><th class="r">${L('Théorique', 'Expected')}</th><th class="r">${L('Compté', 'Counted')}</th><th class="r">${L('Écart', 'Diff')}</th></tr></thead><tbody>
  ${shown.map((l) => { const d = l.counted == null ? null : l.counted - l.expected; return `<tr><td><b>${esc(l.name)}</b><div class="muted mono sm">${esc(l.barcode || '')}</div></td><td class="r num">${qtyFmt(l.expected)}</td>
    <td class="r">${open ? `<input class="in r" type="number" step="any" min="0" data-set="${l.product_id}" value="${l.counted ?? ''}" style="width:90px">` : qtyFmt(l.counted ?? '')}</td><td class="r num">${d == null ? '' : `<b style="color:${d < 0 ? 'var(--bad)' : d > 0 ? 'var(--ok)' : 'inherit'}">${d > 0 ? '+' : ''}${qtyFmt(Math.round(d * 1000) / 1000)}</b>`}</td></tr>`; }).join('')}
  </tbody></table></div>
  ${open ? `<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn danger" id="cancel">${L('Abandonner', 'Cancel')}</button><button class="btn primary" id="close">${L('Clôturer et corriger le stock', 'Close and fix stock')}</button></div>` : ''}`;
  if (!open) return;
  const send = async (body) => {
    try { const l = await api.post(`/api/shop/counts/${c.id}/lines`, body); const last = ctx.el.querySelector('#last'); if (l?.name) { last.innerHTML = `✓ <b>${esc(l.name)}</b> : ${qtyFmt(l.counted)}`; beep(); } else last.textContent = L('Enregistré hors ligne, envoyé au retour du réseau', 'Saved offline'); return l; }
    catch (e) { showError(e); beep(true); }
  };
  const code = ctx.el.querySelector('#code'); const qty = ctx.el.querySelector('#qty');
  code.addEventListener('keydown', async (e) => { if (e.key !== 'Enter' || !code.value.trim()) return; e.preventDefault(); await send({ barcode: code.value.trim(), qty: Number(qty.value) || 1 }); code.value = ''; qty.value = 1; });
  ctx.el.querySelector('#cam').addEventListener('click', () => cameraScan((v) => send({ barcode: v, qty: 1 }), { continuous: true, title: L('Inventaire : scannez les articles', 'Count: scan products') }).then(() => ctx.rerender()));
  ctx.el.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => { if (el.value !== '') send({ product_id: Number(el.dataset.set), qty: Number(el.value), set: true }); }));
  ctx.el.querySelector('#close').addEventListener('click', async () => {
    if (!await confirmDlg(L('Clôturer l\'inventaire', 'Close count'), `${counted.length} ${L('article(s) compté(s). Les articles non comptés ne changent pas. Écart estimé', 'product(s) counted. Uncounted products stay unchanged. Estimated variance')} : ${money(value)}.`, L('Clôturer', 'Close'))) return;
    try { const r = await api.post(`/api/shop/counts/${c.id}/close`, {}); toast(`${L('Inventaire clôturé, écart', 'Count closed, variance')} ${money(r.value)}`, 'ok'); resetCatalog(); ctx.rerender(); } catch (e) { showError(e); }
  });
  ctx.el.querySelector('#cancel').addEventListener('click', async () => { if (!await confirmDlg(L('Abandonner l\'inventaire', 'Cancel count'), L('Aucun stock ne sera modifié.', 'No stock will change.'), L('Abandonner', 'Cancel count'), true)) return; await api.post(`/api/shop/counts/${c.id}/close`, { cancel: true }); location.hash = '#/shop/counts'; });
  setTimeout(() => code.focus(), 50);
});

let actx;
function beep(bad = false) {
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(); const g = actx.createGain(); o.frequency.value = bad ? 220 : 1400; g.gain.value = 0.08; o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + (bad ? 0.25 : 0.08)); } catch {}
}

// ===================== Reports =====================
const REPS = [['margin', L('Marge par article', 'Margin per product')], ['hourly', L('Ventes par heure', 'Sales per hour')], ['cashiers', L('Caissiers', 'Cashiers')], ['stores', L('Boutiques', 'Shops')]];
R('/shop/reports', async (ctx) => {
  const name = REPS.some((r) => r[0] === ctx.query.r) ? ctx.query.r : 'margin';
  ctx.title(L('Rapports de ventes', 'Sales reports'));
  const q = { from: ctx.query.from || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10), to: ctx.query.to || today(), store_id: ctx.query.store_id || '' };
  ctx.actions(`<a class="btn" href="/api/shop/reports/${name}${qs({ ...q, format: 'xlsx' })}">${icon('download')}Excel</a>`);
  const d = await api.get(`/api/shop/reports/${name}${qs(q)}`);
  const head = `<div class="filters"><div class="tabs">${REPS.map(([v, l]) => `<a href="#${ctx.path}${qs({ ...ctx.query, r: v })}" class="${name === v ? 'on' : ''}">${l}</a>`).join('')}</div></div>
  <form class="filters" id="pf"><label class="fld">${L('Du', 'From')}<input class="in" type="date" name="from" value="${q.from}"></label><label class="fld">${L('Au', 'To')}<input class="in" type="date" name="to" value="${q.to}"></label>${name !== 'stores' ? `<label class="fld">${L('Boutique', 'Shop')}${storeSelect(ctx)}</label>` : ''}
    <div class="row" style="align-self:flex-end">${[['today', L("Aujourd'hui", 'Today')], ['week', L('7 jours', '7 days')], ['month', L('Ce mois', 'This month')], ['d30', L('30 jours', '30 days')]].map(([k, l]) => `<button type="button" class="btn sm" data-p="${k}">${l}</button>`).join('')}</div></form>`;
  let body = '';
  if (name === 'margin') {
    const t = d.totals;
    body = `<div class="grid g4" style="margin-bottom:14px">${kpi(L('Ventes TTC', 'Sales'), money(t.sales))}${kpi(L('Ventes HT', 'Net sales'), money(t.net))}${kpi(L('Coût des ventes', 'Cost of sales'), money(t.cost))}${kpi(L('Marge brute', 'Gross margin'), money(t.margin), `${String(t.margin_pct).replace('.', ',')} %`, 'accent')}</div>` + table({ rows: d.rows, href: (r) => `/shop/item/${r.product_id}`, columns: [
      { label: L('Article', 'Product'), render: (r) => `<b>${esc(r.name)}</b><div class="muted sm">${esc(r.category || '')}</div>` }, { label: L('Qté', 'Qty'), cls: 'r num', render: (r) => qtyFmt(Math.round(r.qty * 1000) / 1000) },
      { label: L('Ventes HT', 'Net'), cls: 'r num', render: (r) => money(r.net) }, { label: L('Coût', 'Cost'), cls: 'r num', hideM: true, render: (r) => money(r.cost) },
      { label: L('Marge', 'Margin'), cls: 'r num', render: (r) => `<b style="color:${r.margin < 0 ? 'var(--bad)' : 'inherit'}">${money(r.margin)}</b>` }, { label: '%', cls: 'r num', render: (r) => `<span style="color:${r.margin_pct < 10 ? 'var(--warn)' : 'inherit'}">${String(r.margin_pct).replace('.', ',')} %</span>` },
      { label: L('Remises', 'Discounts'), cls: 'r num', hideM: true, render: (r) => (r.discounts ? money(r.discounts) : '') }], empty: `<b>${L('Aucune vente sur la période', 'No sales in this period')}</b>` });
  } else if (name === 'hourly') {
    const max = Math.max(1, ...d.rows.map((r) => r.sales));
    const dn = [L('Dim', 'Sun'), L('Lun', 'Mon'), L('Mar', 'Tue'), L('Mer', 'Wed'), L('Jeu', 'Thu'), L('Ven', 'Fri'), L('Sam', 'Sat')];
    const maxD = Math.max(1, ...d.days.map((r) => r.sales));
    const peak = d.rows.reduce((a, r) => (r.sales > (a?.sales || 0) ? r : a), null);
    body = `<div class="grid g2"><div class="card"><h3>${L('Par heure', 'Per hour')}${peak ? ` <span class="pill info">${L('pic', 'peak')} ${peak.hour} h</span>` : ''}</h3>
      <div class="hbars tall">${Array.from({ length: 17 }, (_, i) => i + 6).map((h) => { const r = d.rows.find((x) => x.hour === h); return `<div class="hb" title="${h} h : ${money(r?.sales || 0)} · ${r?.tickets || 0} ${L('tickets', 'receipts')}"><i style="height:${((r?.sales || 0) / max) * 100}%"></i><span>${h}</span></div>`; }).join('')}</div>
      <p class="muted sm">${L('Utile pour placer les caissiers aux heures de pointe.', 'Use it to staff the tills at peak hours.')}</p></div>
      <div class="card"><h3>${L('Par jour de la semaine', 'Per weekday')}</h3><div class="bar-list">${[1, 2, 3, 4, 5, 6, 0].map((i) => { const r = d.days.find((x) => Number(x.dow) === i); return `<div class="it"><span>${dn[i]} <span class="dim">(${r?.tickets || 0})</span></span><b class="num">${money(r?.sales || 0)}</b><div class="tr"><i style="width:${((r?.sales || 0) / maxD) * 100}%"></i></div></div>`; }).join('')}</div></div></div>`;
  } else if (name === 'cashiers') {
    body = table({ rows: d.rows, columns: [{ label: L('Caissier', 'Cashier'), render: (r) => `<b>${esc(r.name)}</b><div class="muted sm">${r.sessions} ${L('session(s)', 'session(s)')}</div>` }, { label: L('Tickets', 'Receipts'), cls: 'r num', render: (r) => num(r.tickets) },
      { label: L('Ventes', 'Sales'), cls: 'r num', render: (r) => money(r.sales) }, { label: L('Annulations', 'Voids'), cls: 'r num', render: (r) => (r.voids ? `<b style="color:var(--warn)">${r.voids}</b> <span class="dim">${money(r.voided)}</span>` : '0') },
      { label: L('Retours', 'Returns'), cls: 'r num', hideM: true, render: (r) => num(r.returns) }, { label: L('Remises', 'Discounts'), cls: 'r num', hideM: true, render: (r) => money(r.discounts) },
      { label: L('Écarts de caisse', 'Cash variance'), cls: 'r num', render: (r) => `<b style="color:${r.variance < 0 ? 'var(--bad)' : r.variance > 0 ? 'var(--warn)' : 'var(--ok)'}">${money(r.variance)}</b>` }], empty: `<b>${L('Aucune vente', 'No sales')}</b>` });
  } else {
    body = table({ rows: d.rows, columns: [{ label: L('Boutique', 'Shop'), render: (r) => `<b>${esc(r.name)}</b>` }, { label: L('Tickets', 'Receipts'), cls: 'r num', render: (r) => num(r.tickets) }, { label: L('Ventes TTC', 'Sales'), cls: 'r num', render: (r) => money(r.sales) },
      { label: L('Marge', 'Margin'), cls: 'r num', render: (r) => money(r.margin) }, { label: L('Valeur du stock', 'Stock value'), cls: 'r num', render: (r) => money(r.stock_value) }] });
  }
  ctx.el.innerHTML = head + body;
  const f = ctx.el.querySelector('#pf');
  f.addEventListener('change', (e) => { if (e.target.id === 'store') return; location.hash = ctx.path + qs({ ...ctx.query, from: f.from.value, to: f.to.value }); });
  wireStore(ctx);
  f.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    const t = today(); const from = b.dataset.p === 'today' ? t : b.dataset.p === 'week' ? new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10) : b.dataset.p === 'd30' ? new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10) : monthStart();
    location.hash = ctx.path + qs({ ...ctx.query, from, to: t });
  }));
});

// ===================== Till settings =====================
R('/shop/settings', async (ctx) => {
  ctx.title(L('Réglages caisse', 'Till settings'));
  await refreshMeta();
  const s = state.shop.settings;
  const users = can('users') ? await api.get('/api/users').catch(() => []) : [];
  const us = Object.fromEntries((state.shop.user_stores || []).map((x) => [x.user_id, x.store_id]));
  ctx.el.innerHTML = `<div class="grid g2">
  <form class="card form" id="sf"><h3>${L('Fidélité et compte prépayé', 'Loyalty & prepaid account')}</h3>
    <div class="f2">${field({ name: 'points_per_amount', label: L('1 point tous les … FCFA', '1 point every … FCFA'), type: 'number', min: 0, hint: L('0 = pas de points', '0 = no points') }, s)}
    ${field({ name: 'point_value', label: L('Valeur d\'un point (FCFA)', 'Point value (FCFA)'), type: 'number', min: 0 }, s)}
    ${field({ name: 'min_points_redeem', label: L('Points minimum pour utiliser', 'Minimum points to redeem'), type: 'number', min: 0 }, s)}
    ${field({ name: 'topup_bonus_pct', label: L('Bonus sur recharge (%)', 'Top-up bonus (%)'), type: 'number', min: 0, step: 'any' }, s)}
    ${field({ name: 'topup_bonus_min', label: L('Recharge minimum pour le bonus', 'Minimum top-up for bonus'), type: 'number', min: 0 }, s)}</div>
    <h3>${L('Contrôle', 'Control')}</h3>
    <div class="f2">${field({ name: 'max_discount_pct', label: L('Remise max sans code gérant (%)', 'Max discount without manager code (%)'), type: 'number', min: 0, step: 'any' }, s)}
    ${field({ name: 'manager_pin', label: s.has_pin ? L('Nouveau code gérant (vide = inchangé)', 'New manager code (empty = unchanged)') : L('Code gérant (4 à 8 chiffres)', 'Manager code (4–8 digits)'), type: 'password', placeholder: '••••', hint: L('Demandé pour les annulations, retours, remises fortes, crédit au-delà du plafond', 'Asked for voids, returns, large discounts, credit beyond the limit') })}
    ${field({ name: 'expiry_alert_days', label: L('Alerte péremption (jours avant)', 'Expiry alert (days before)'), type: 'number', min: 1 }, s)}</div>
    <h3>${L('Balance et ticket', 'Scale & receipt')}</h3>
    <div class="f2">${field({ name: 'scale_prefix', label: L('Préfixe des étiquettes balance', 'Scale label prefix'), hint: L('Code EAN-13 : préfixe + PLU (5) + poids/prix (5) + clé', 'EAN-13: prefix + PLU (5) + weight/price (5) + check') }, s)}
    ${field({ name: 'scale_mode', label: L('La balance code', 'The scale encodes'), type: 'select', options: [['weight', L('le poids en grammes', 'weight in grams')], ['price', L('le prix en FCFA', 'price in FCFA')]] }, s)}
    ${field({ name: 'receipt_footer', label: L('Bas du ticket', 'Receipt footer'), type: 'textarea', span: true }, s)}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary">${L('Enregistrer', 'Save')}</button></div></form>
  <div class="stack">
    <div class="card"><div class="row between"><h3 style="margin:0">${L('Boutiques et dépôts', 'Shops & warehouses')}</h3><button class="btn sm" id="nst">${icon('plus')}${L('Ajouter', 'Add')}</button></div>
      ${stores().map((x) => `<div class="row between lrow"><span><b>${esc(x.name)}</b> <span class="pill ${x.kind === 'warehouse' ? '' : 'info'}">${x.kind === 'warehouse' ? L('Dépôt', 'Warehouse') : L('Boutique', 'Shop')}</span>${x.active ? '' : ` <span class="pill">${L('fermé', 'closed')}</span>`}<div class="muted sm">${esc(x.address || '')} ${esc(x.phone || '')}</div></span><button class="btn sm" data-st="${x.id}">${L('Modifier', 'Edit')}</button></div>`).join('')}</div>
    <div class="card"><div class="row between"><h3 style="margin:0">${L('Caisses', 'Tills')}</h3><button class="btn sm" id="nrg">${icon('plus')}${L('Ajouter', 'Add')}</button></div>
      ${(state.shop.registers || []).map((g) => `<div class="row between lrow"><span><b>${esc(g.name)}</b> <span class="muted">· ${esc(g.store_name)}</span>${g.busy_by ? ` <span class="pill ok">${L('ouverte par', 'open by')} ${esc(g.busy_by)}</span>` : ''}${g.active ? '' : ` <span class="pill">${L('désactivée', 'disabled')}</span>`}</span><button class="btn sm" data-rg="${g.id}">${L('Renommer', 'Rename')}</button></div>`).join('')}</div>
    ${users.length ? `<div class="card"><h3>${L('Boutique de chaque employé', 'Each employee\'s shop')}</h3><p class="muted sm" style="margin-top:0">${L('La caisse et le stock affichés par défaut.', 'Default till and stock shown.')}</p>
      ${users.filter((u) => u.active !== 0).map((u) => `<div class="row between lrow" style="flex-wrap:nowrap"><span>${esc(u.name)} <span class="dim sm">${esc(u.role)}</span></span><select class="in" data-us="${u.id}" style="width:auto">${[['', '—'], ...storeOpts(false)].map(([v, l]) => `<option value="${v}" ${String(us[u.id] || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`).join('')}</div>` : ''}
    <div class="card"><h3>${L('Matériel conseillé', 'Recommended hardware')}</h3><ul class="muted" style="margin:0;padding-left:18px">
      <li>${L('Douchette code-barres USB ou Bluetooth (mode clavier) : elle marche directement, rien à installer.', 'USB or Bluetooth barcode scanner (keyboard mode): works straight away.')}</li>
      <li>${L('Écran client : un 2ᵉ écran ou une tablette ouverte sur', 'Customer display: a 2nd screen or a tablet open on')} <a href="#/display">/display</a>.</li>
      <li>${L('Imprimante ticket 80 mm (USB ou réseau) via le navigateur.', '80 mm receipt printer through the browser.')}</li>
      <li>${L('Balance étiqueteuse EAN-13 (préfixe ci-contre).', 'Label scale with EAN-13 (prefix on the left).')}</li>
      <li>${L('Sans douchette : la caméra du téléphone scanne les codes.', 'No scanner: the phone camera scans codes.')}</li></ul></div>
  </div></div>`;
  ctx.el.querySelector('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    try { state.shop.settings = await api.put('/api/shop/settings', v); toast(L('Réglages enregistrés', 'Settings saved'), 'ok'); resetCatalog(); ctx.rerender(); } catch (err) { showError(err); }
  });
  const storeDlg = (x) => dialog({ title: x ? L('Modifier', 'Edit') : L('Nouvel emplacement', 'New location'),
    body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, placeholder: 'Akwa, Bonamoussadi…' }, x || {})}${x ? field({ name: 'active', label: L('Ouvert', 'Open'), type: 'checkbox' }, x) : field({ name: 'kind', label: L('Type', 'Type'), type: 'select', options: [['shop', L('Boutique (avec caisse)', 'Shop (with till)')], ['warehouse', L('Dépôt / entrepôt', 'Warehouse')]] })}${field({ name: 'address', label: L('Adresse', 'Address') }, x || {})}${field({ name: 'phone', label: L('Téléphone', 'Phone') }, x || {})}</div>`,
    onSubmit: (v) => (x ? api.put(`/api/shop/stores/${x.id}`, v) : api.post('/api/shop/stores', v)) });
  ctx.el.querySelector('#nst').addEventListener('click', async () => { if (await storeDlg()) ctx.rerender(); });
  ctx.el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => { if (await storeDlg(stores().find((x) => String(x.id) === b.dataset.st))) ctx.rerender(); }));
  ctx.el.querySelector('#nrg').addEventListener('click', async () => {
    if (await dialog({ title: L('Nouvelle caisse', 'New till'), body: `<div class="f2">${field({ name: 'name', label: L('Nom', 'Name'), required: true, value: `Caisse ${(state.shop.registers || []).length + 1}` })}${field({ name: 'store_id', label: L('Boutique', 'Shop'), type: 'select', options: stores().filter((x) => x.kind === 'shop').map((x) => [x.id, x.name]) })}</div>`, onSubmit: (v) => api.post('/api/shop/registers', v) })) ctx.rerender();
  });
  ctx.el.querySelectorAll('[data-rg]').forEach((b) => b.addEventListener('click', async () => {
    const g = state.shop.registers.find((x) => String(x.id) === b.dataset.rg);
    if (await dialog({ title: L('Caisse', 'Till'), body: `${field({ name: 'name', label: L('Nom', 'Name'), required: true }, g)}${field({ name: 'active', label: L('Active', 'Active'), type: 'checkbox' }, g)}`, onSubmit: (v) => api.put(`/api/shop/registers/${g.id}`, v) })) ctx.rerender();
  }));
  ctx.el.querySelectorAll('[data-us]').forEach((el) => el.addEventListener('change', () => api.put('/api/shop/user-store', { user_id: Number(el.dataset.us), store_id: el.value ? Number(el.value) : null }).then(() => toast(L('Enregistré', 'Saved'), 'ok')).catch(showError)));
});


