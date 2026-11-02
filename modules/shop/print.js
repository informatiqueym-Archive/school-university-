// Printable pages for the shop: 80 mm till receipt (also the public receipt
// link sent by WhatsApp), shelf labels with barcodes, Z report of a cash session,
// purchase order. Opened in a new tab, printed or saved as PDF.
import { fcfa } from '../../core/format.js';
import { barcodeSvg } from '../../public/js/barcode.js';
import { PAY_METHODS } from './sales.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => fcfa(v).replace(' FCFA', '');
const q = (v) => (Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(3).replace(/0+$/, '').replace('.', ','));
const when = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' })} ${d.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Douala', hour: '2-digit', minute: '2-digit' })}`; };
const page = (title, css, body, autoPrint) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;font:13px/1.35 "Hanken Grotesk",system-ui,Arial,sans-serif;color:#0A1A2F;background:#eef2f6}${css}
.noprint{position:sticky;top:0;display:flex;gap:8px;justify-content:center;padding:10px;background:#0A2540}.noprint button,.noprint a{border:0;border-radius:8px;padding:8px 14px;background:#0B8AC9;color:#fff;font:600 14px system-ui;cursor:pointer;text-decoration:none}
@media print{body{background:#fff}.noprint{display:none}}</style></head><body><div class="noprint"><button onclick="print()">Imprimer</button></div>${body}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),300))</script>' : ''}</body></html>`;

export function renderReceipt(company, s, { autoPrint = false, settings = {} } = {}) {
  const kindTitle = s.kind === 'return' ? 'RETOUR / AVOIR' : s.kind === 'topup' ? 'RECHARGE COMPTE PRÉPAYÉ' : 'TICKET DE CAISSE';
  const lines = s.lines.map((l) => `<tr><td colspan="2">${esc(l.description)}</td></tr>
    <tr class="sub"><td>${q(l.qty)} × ${n(l.unit_price)}${l.vat_rate ? '' : ' (exo.)'}</td><td class="r">${n(l.qty * l.unit_price)}</td></tr>
    ${l.promo_amount ? `<tr class="sub promo"><td>Promo</td><td class="r">-${n(l.promo_amount)}</td></tr>` : ''}${l.discount && s.kind === 'sale' ? `<tr class="sub promo"><td>Remise</td><td class="r">-${n(l.discount)}</td></tr>` : ''}`).join('');
  const vat = {};
  for (const l of s.lines) { vat[l.vat_rate] ??= { base: 0, vat: 0 }; vat[l.vat_rate].base += l.net; vat[l.vat_rate].vat += l.vat; }
  const pays = s.payments.map((p) => `<tr><td>${esc(PAY_METHODS[p.method]?.fr || p.method)}${p.reference ? ` <small>${esc(p.reference)}</small>` : ''}</td><td class="r">${n(p.amount)}</td></tr>`).join('');
  const body = `<div class="rc">
  ${company.logo ? `<img src="${esc(company.logo)}" alt="" class="logo">` : ''}
  <div class="c b big">${esc(company.name)}</div>
  <div class="c">${esc(s.store_name)}${company.address ? ' · ' + esc(company.address) : ''}${company.city ? ', ' + esc(company.city) : ''}</div>
  ${company.phone ? `<div class="c">Tél. ${esc(company.phone)}</div>` : ''}${company.niu ? `<div class="c">NIU ${esc(company.niu)}${company.rccm ? ' · RCCM ' + esc(company.rccm) : ''}</div>` : ''}
  <div class="hr"></div><div class="c b">${kindTitle}</div>
  <div class="row"><span>${esc(s.number)}</span><span>${when(s.created_at)}</span></div>
  <div class="row"><span>${esc(s.register_name)}</span><span>Caissier : ${esc(s.cashier || '')}</span></div>
  ${s.customer_name ? `<div class="row"><span>Client : ${esc(s.customer_name)}</span></div>` : ''}
  ${s.status === 'voided' ? '<div class="c b void">*** TICKET ANNULÉ ***</div>' : ''}
  <div class="hr"></div>
  <table>${lines || `<tr><td>Recharge du compte prépayé</td><td class="r">${n(s.total)}</td></tr>`}</table>
  <div class="hr"></div>
  <table>
    ${s.promo_total ? `<tr><td>Économies promotions</td><td class="r">-${n(s.promo_total)}</td></tr>` : ''}
    ${s.points_used ? `<tr><td>Points fidélité utilisés (${s.points_used})</td><td class="r"></td></tr>` : ''}
    ${s.bonus_used ? `<tr><td>Bonus utilisé</td><td class="r">-${n(s.bonus_used)}</td></tr>` : ''}
    <tr class="tot"><td>TOTAL TTC</td><td class="r">${n(s.total)} FCFA</td></tr>
    ${pays}
    ${s.change_given ? `<tr><td>Monnaie rendue</td><td class="r">${n(s.change_given)}</td></tr>` : ''}
    ${s.credit_amount ? `<tr class="b"><td>Reste à payer (crédit)</td><td class="r">${n(s.credit_amount)}</td></tr>` : ''}
  </table>
  ${s.kind !== 'topup' ? `<div class="hr"></div><table class="vat"><tr><td>TVA</td><td class="r">Base HT</td><td class="r">TVA</td></tr>${Object.entries(vat).map(([r, v]) => `<tr><td>${String(r).replace('.', ',')} %</td><td class="r">${n(v.base)}</td><td class="r">${n(v.vat)}</td></tr>`).join('')}</table>` : ''}
  ${s.customer ? `<div class="hr"></div><div class="row"><span>Points gagnés</span><span>+${s.points_earned}</span></div><div class="row"><span>Solde points</span><span>${s.customer.points}</span></div>
    ${s.customer.wallet ? `<div class="row"><span>Compte prépayé</span><span>${n(s.customer.wallet)}</span></div>` : ''}${s.customer.bonus ? `<div class="row"><span>Bonus disponible</span><span>${n(s.customer.bonus)}</span></div>` : ''}` : ''}
  ${s.note ? `<div class="c" style="margin-top:6px">${esc(s.note)}</div>` : ''}
  <div class="hr"></div>
  <div class="bc">${barcodeSvg(s.number, { height: 34, module: 1.2 })}</div>
  <div class="c">${esc(settings.receipt_footer || 'Merci de votre visite !')}</div>
  <div class="c small">Gardez ce ticket pour tout retour ou échange.</div>
  </div>`;
  const css = `.rc{width:80mm;margin:12px auto;background:#fff;padding:5mm 4mm;font:12px/1.35 "Courier New",ui-monospace,monospace;color:#000}
  .logo{display:block;max-width:40mm;max-height:18mm;margin:0 auto 4px}.c{text-align:center}.b{font-weight:700}.big{font-size:15px}.small{font-size:10px}
  .hr{border-top:1px dashed #000;margin:6px 0}.row{display:flex;justify-content:space-between;gap:6px}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}
  .r{text-align:right;white-space:nowrap}.sub td{padding-left:8px}.promo td{font-style:italic}.tot td{font-size:15px;font-weight:700;padding:4px 0}.vat td{font-size:11px}.void{font-size:14px;margin:6px 0}
  .bc{text-align:center}.bc svg{max-width:100%;height:auto}@media print{.rc{margin:0;width:auto;padding:0 2mm}@page{size:80mm auto;margin:2mm}}`;
  return page(s.number, css, body, autoPrint);
}

/** A4 sheet of shelf labels (3 × 8). items: [{ name, barcode, retail_price, wholesale_price, unit, by_weight, promo }] */
export function renderLabels(company, items, { autoPrint = false } = {}) {
  const cells = items.map((it) => `<div class="lb">
    <div class="nm">${esc(it.name)}</div>
    <div class="pr">${n(it.promo_price ?? it.retail_price)}<small> FCFA${it.by_weight ? '/kg' : ''}</small></div>
    ${it.promo_price != null ? `<div class="old">au lieu de ${n(it.retail_price)}</div>` : ''}
    ${it.wholesale_price ? `<div class="ws">Prix de gros : ${n(it.wholesale_price)}${it.wholesale_min_qty ? ` dès ${q(it.wholesale_min_qty)}` : ''}</div>` : ''}
    <div class="bc">${it.barcode ? barcodeSvg(it.barcode, { height: 30, module: 1.15 }) : ''}</div>
    <div class="co">${esc(company.name)}</div></div>`).join('');
  const css = `.sheet{width:210mm;margin:12px auto;background:#fff;padding:8mm 6mm;display:grid;grid-template-columns:repeat(3,1fr);gap:0}
  .lb{border:1px dashed #9BB0C8;height:34.6mm;padding:2.2mm 3mm;display:flex;flex-direction:column;overflow:hidden;position:relative}
  .nm{font-weight:700;font-size:11.5px;line-height:1.2;max-height:2.4em;overflow:hidden}.pr{font-size:21px;font-weight:800;color:#0A2540;line-height:1.1;margin-top:1mm}.pr small{font-size:10px;font-weight:600}
  .old{font-size:10px;text-decoration:line-through;color:#6B7A90}.ws{font-size:9.5px;color:#0B5F8C}.lb>*{flex:none}.lb>.bc{margin-top:auto;flex:1 1 0;min-height:7mm;display:flex;align-items:flex-end}.bc svg{height:100%;max-height:13mm;width:auto;max-width:100%}.co{position:absolute;right:3mm;top:2mm;font-size:7px;color:#8796AB;display:none}
  @media print{.sheet{margin:0;padding:6mm 4mm}@page{size:A4;margin:0}}`;
  return page('Étiquettes', css, `<div class="sheet">${cells}</div>`, autoPrint);
}

export function renderZReport(company, sum, { autoPrint = false } = {}) {
  const s = sum.session;
  const row = (l, v, b = false) => `<tr${b ? ' class="b"' : ''}><td>${l}</td><td class="r">${v}</td></tr>`;
  const body = `<div class="rc"><div class="c b big">${esc(company.name)}</div><div class="c">${esc(s.store_name)} · ${esc(s.register_name)}</div><div class="hr"></div>
  <div class="c b">${s.status === 'closed' ? 'RAPPORT Z (CLÔTURE)' : 'RAPPORT X (EN COURS)'}</div>
  <div class="row"><span>Session</span><span>${esc(s.number)}</span></div><div class="row"><span>Caissier</span><span>${esc(s.user_name)}</span></div>
  <div class="row"><span>Ouverture</span><span>${when(s.opened_at)}</span></div>${s.closed_at ? `<div class="row"><span>Clôture</span><span>${when(s.closed_at)}</span></div>` : ''}
  <div class="hr"></div><table>
  ${row(`Ventes (${sum.sales.n} tickets)`, n(sum.sales.total))}${row('Dont TVA', n(sum.sales.vat))}${row('Remises et promotions', n(sum.sales.discounts))}
  ${row(`Retours (${sum.returns.n})`, n(sum.returns.total))}${row(`Recharges prépayées (${sum.topups.n})`, n(sum.topups.total))}${row(`Tickets annulés (${sum.voids.n})`, n(sum.voids.total))}</table>
  <div class="hr"></div><div class="b">Par mode de paiement</div><table>${sum.byMethod.map((m) => row(esc(PAY_METHODS[m.method]?.fr || m.method), n(m.amount))).join('')}</table>
  <div class="hr"></div><div class="b">Tiroir-caisse (espèces)</div><table>
  ${row('Fond de caisse', n(sum.cash.opening))}${row('Ventes en espèces', n(sum.cash.sales))}${row('Entrées', n(sum.cash.in))}${row('Sorties', '-' + n(sum.cash.out))}${row('Remboursements de crédit', n(sum.cash.repayments))}
  ${row('ATTENDU', n(sum.cash.expected), true)}${s.counted_cash != null ? row('COMPTÉ', n(s.counted_cash), true) + row('ÉCART', (s.variance > 0 ? '+' : '') + n(s.variance), true) : ''}</table>
  ${s.close_note ? `<div class="hr"></div><div>${esc(s.close_note)}</div>` : ''}
  <div class="hr"></div><div class="row" style="margin-top:18px"><span>Signature caissier</span><span>Signature gérant</span></div><div style="height:40px"></div></div>`;
  const css = `.rc{width:80mm;margin:12px auto;background:#fff;padding:5mm 4mm;font:12px/1.4 "Courier New",ui-monospace,monospace}.c{text-align:center}.b{font-weight:700}.big{font-size:15px}
  .hr{border-top:1px dashed #000;margin:6px 0}.row{display:flex;justify-content:space-between}table{width:100%;border-collapse:collapse}.r{text-align:right}@media print{.rc{margin:0;width:auto}@page{size:80mm auto;margin:2mm}}`;
  return page(`Rapport ${s.number}`, css, body, autoPrint);
}

export function renderPO(company, o, { autoPrint = false } = {}) {
  const body = `<div class="a4"><div class="hd"><div>${company.logo ? `<img src="${esc(company.logo)}" alt="" style="max-height:52px">` : ''}<h2>${esc(company.name)}</h2>
  <div>${esc(company.address || '')} ${esc(company.city || '')}</div><div>${esc(company.phone || '')}</div>${company.niu ? `<div>NIU ${esc(company.niu)}</div>` : ''}</div>
  <div class="r"><h1>BON DE COMMANDE</h1><div><b>${esc(o.number)}</b></div><div>Date : ${o.date.split('-').reverse().join('/')}</div>${o.expected_date ? `<div>Livraison souhaitée : ${o.expected_date.split('-').reverse().join('/')}</div>` : ''}</div></div>
  <div class="to"><b>Fournisseur</b><div>${esc(o.supplier_name)}</div><div>${esc(o.supplier_phone || '')}</div><b style="margin-top:8px;display:block">Livrer à</b><div>${esc(o.store_name)}</div></div>
  <table><thead><tr><th>Article</th><th>Code-barres</th><th class="r">Qté</th><th class="r">P.U. HT</th><th class="r">Total HT</th></tr></thead><tbody>
  ${o.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.barcode || '')}</td><td class="r">${q(l.qty)}</td><td class="r">${n(l.unit_cost)}</td><td class="r">${n(l.qty * l.unit_cost)}</td></tr>`).join('')}
  <tr class="b"><td colspan="4" class="r">TOTAL HT</td><td class="r">${n(o.total)} FCFA</td></tr></tbody></table>
  ${o.notes ? `<p>${esc(o.notes)}</p>` : ''}<p style="margin-top:40px">Bon pour commande, le gérant :</p></div>`;
  const css = `.a4{width:210mm;min-height:280mm;margin:12px auto;background:#fff;padding:14mm}.hd{display:flex;justify-content:space-between;gap:20px}h1{font-size:20px;color:#0A2540;margin:0 0 6px}h2{margin:4px 0}
  .to{margin:18px 0;padding:10px 12px;background:#EEF5FB;border-radius:8px;max-width:90mm}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#0A2540;color:#fff;text-align:left;padding:6px}td{padding:6px;border-bottom:1px solid #DCE5F0}
  .r{text-align:right}.b td{font-weight:700}@media print{.a4{margin:0}@page{size:A4;margin:0}}`;
  return page(o.number, css, body, autoPrint);
}
