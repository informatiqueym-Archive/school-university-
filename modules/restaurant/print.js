// Printable pages: 80 mm bill (with a QR code to pay from the phone), paid
// receipt, kitchen ticket, Z report of the day, and the QR cards for tables.
import { fcfa } from '../../core/format.js';
import { PAY, KINDS } from './orders.js';

const NAVY = '#3A0F1C', ACCENT = '#C2681E';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => fcfa(v).replace(' FCFA', '');
const q = (v) => (Number.isInteger(Number(v)) ? String(v) : String(Number(v).toFixed(2)).replace('.', ','));
const when = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' })} ${d.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Douala', hour: '2-digit', minute: '2-digit' })}`; };
const QR = `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>document.querySelectorAll('.q').forEach(function(e){try{new QRCode(e,{text:e.dataset.url,width:+e.dataset.size||120,height:+e.dataset.size||120,colorDark:'${NAVY}',correctLevel:QRCode.CorrectLevel.M})}catch(x){e.textContent=e.dataset.url}})</script>`;
const page = (title, css, body, autoPrint) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;font:13px/1.35 "Hanken Grotesk",system-ui,Arial,sans-serif;color:#12163A;background:#eef0f7}${css}
.noprint{position:sticky;top:0;display:flex;gap:8px;justify-content:center;padding:10px;background:${NAVY};z-index:2}.noprint button{border:0;border-radius:8px;padding:8px 14px;background:${ACCENT};color:#fff;font:600 14px system-ui;cursor:pointer}
@media print{body{background:#fff}.noprint{display:none}}</style></head><body><div class="noprint"><button onclick="print()">Imprimer</button></div>${body}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),500))</script>' : ''}</body></html>`;

const RC = `.rc{width:80mm;margin:12px auto;background:#fff;padding:10px 12px 16px}.c{text-align:center}.b{font-weight:700}.big{font-size:17px}.hr{border-top:1px dashed #999;margin:8px 0}
.row{display:flex;justify-content:space-between;gap:8px}table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}.sub td{color:#555;font-size:12px}
.tot td{font-weight:800;font-size:16px;padding-top:4px}.logo{display:block;max-width:46mm;max-height:22mm;margin:0 auto 6px}.q{display:flex;justify-content:center;margin:8px 0}.void{color:#c00;font-size:15px}
@media print{.rc{margin:0;width:auto;padding:0}}`;

function head(company, o) {
  return `${company.logo ? `<img src="${esc(company.logo)}" alt="" class="logo">` : ''}<div class="c b big">${esc(company.name)}</div>
  <div class="c">${esc([company.address, company.city].filter(Boolean).join(', '))}</div>
  ${company.phone ? `<div class="c">Tél. ${esc(company.phone)}</div>` : ''}${company.niu ? `<div class="c">NIU ${esc(company.niu)}${company.rccm ? ' · RCCM ' + esc(company.rccm) : ''}</div>` : ''}
  <div class="hr"></div>
  <div class="row"><span class="b">${esc(o.number)}</span><span>${when(o.closed_at || o.opened_at)}</span></div>
  <div class="row"><span>${o.table_label ? `Table ${esc(o.table_label)}${o.covers ? ` · ${o.covers} couv.` : ''}` : esc(KINDS[o.kind]?.fr || '')}</span><span>${o.server_name ? `Serveur : ${esc(o.server_name)}` : ''}</span></div>
  ${o.customer_name || o.guest_name ? `<div>Client : ${esc(o.customer_name || o.guest_name)}${o.phone ? ' · ' + esc(o.phone) : ''}</div>` : ''}
  ${o.kind === 'delivery' && o.address ? `<div>Livraison : ${esc(o.address)}</div>` : ''}`;
}

function body(o, settings) {
  const lines = o.lines.filter((l) => l.status !== 'void').map((l) => `<tr><td>${q(l.qty)} × ${esc(l.name)}${l.options ? `<br><small>${esc(l.options)}</small>` : ''}</td><td class="r">${l.comp ? 'Offert' : n(l.total)}</td></tr>${l.discount_pct && !l.comp ? `<tr class="sub"><td>Remise ${q(l.discount_pct)} %</td><td></td></tr>` : ''}`).join('');
  const vat = {};
  for (const l of o.lines.filter((x) => x.status !== 'void')) { vat[l.vat_rate] = (vat[l.vat_rate] || 0) + l.total; }
  return `<table>${lines}</table><div class="hr"></div><table>
    <tr><td>Sous-total</td><td class="r">${n(o.subtotal)}</td></tr>
    ${o.discount ? `<tr><td>Remise${o.discount_reason ? ` (${esc(o.discount_reason)})` : ''}</td><td class="r">-${n(o.discount)}</td></tr>` : ''}
    ${o.points_used ? `<tr><td>Points fidélité (${o.points_used})</td><td class="r">-${n(o.points_used * settings.point_value)}</td></tr>` : ''}
    ${o.service_charge ? `<tr><td>Service ${q(settings.service_pct)} %</td><td class="r">${n(o.service_charge)}</td></tr>` : ''}
    ${o.delivery_fee ? `<tr><td>Livraison</td><td class="r">${n(o.delivery_fee)}</td></tr>` : ''}
    <tr class="tot"><td>TOTAL TTC</td><td class="r">${n(o.total)} F</td></tr>
    ${Object.entries(vat).filter(([r]) => Number(r) > 0).map(([r, ttc]) => { const ht = Math.round(ttc / (1 + r / 100)); return `<tr class="sub"><td>dont TVA ${q(r)} % sur ${n(ht)}</td><td class="r">${n(ttc - ht)}</td></tr>`; }).join('')}
  </table>`;
}

/** Bill brought to the table: total, QR code to pay by MoMo / Orange Money, tip suggestions. */
export function renderBill(company, o, settings, payUrl, { autoPrint = false } = {}) {
  return page(`Addition ${o.number}`, RC, `<div class="rc">${head(company, o)}<div class="hr"></div><div class="c b">ADDITION</div><div class="hr"></div>${body(o, settings)}
  ${o.paid ? `<div class="hr"></div><table><tr><td>Déjà réglé</td><td class="r">${n(o.paid)}</td></tr><tr class="tot"><td>RESTE À PAYER</td><td class="r">${n(o.total - o.paid)} F</td></tr></table>` : ''}
  ${!o.service_charge ? `<div class="hr"></div><div class="c sub">Service non compris. Pourboire suggéré : ${(settings.tip_suggestions || '5,10').split(',').map((p) => `${p.trim()} % = ${n(Math.round(o.total * Number(p) / 100 / 50) * 50)}`).join(' · ')}</div>` : ''}
  ${payUrl ? `<div class="hr"></div><div class="c b">Payez depuis votre téléphone</div><div class="c sub">MTN MoMo · Orange Money · partage de l'addition</div><div class="q" data-url="${esc(payUrl)}" data-size="130"></div>` : ''}
  <div class="hr"></div><div class="c">${esc(settings.receipt_footer || '')}</div></div>${payUrl ? QR : ''}`, autoPrint);
}

export function renderReceipt(company, o, settings, { autoPrint = false, reviewUrl = null } = {}) {
  const pays = o.payments.map((p) => `<tr><td>${esc(PAY[p.method]?.fr || p.method)}${p.payer ? ` (${esc(p.payer)})` : ''}${p.reference ? `<br><small>${esc(p.reference)}</small>` : ''}</td><td class="r">${n(p.amount)}</td></tr>${p.tip ? `<tr class="sub"><td>Pourboire</td><td class="r">${n(p.tip)}</td></tr>` : ''}${p.change_given ? `<tr class="sub"><td>Rendu</td><td class="r">${n(p.change_given)}</td></tr>` : ''}`).join('');
  const pts = o.loyalty ? `<div class="hr"></div><div class="c">Fidélité : <b>${o.loyalty.points} points</b> (${o.loyalty.visits} visite(s))</div>` : '';
  return page(`Reçu ${o.number}`, RC, `<div class="rc">${head(company, o)}<div class="hr"></div><div class="c b">${o.status === 'void' ? '<span class="void">*** ANNULÉ ***</span>' : o.status === 'paid' ? 'REÇU / TICKET' : 'NOTE PROVISOIRE'}</div><div class="hr"></div>
  ${body(o, settings)}<div class="hr"></div><table>${pays}</table>${pts}
  ${reviewUrl ? `<div class="hr"></div><div class="c b">Votre avis compte</div><div class="q" data-url="${esc(reviewUrl)}" data-size="96"></div>` : ''}
  <div class="hr"></div><div class="c">${esc(settings.receipt_footer || '')}</div></div>${reviewUrl ? QR : ''}`, autoPrint);
}

/** Kitchen / bar ticket for printers that sit at the station. */
export function renderTicket(company, t, { autoPrint = false } = {}) {
  return page(`Bon ${t.number}`, `${RC}.rc{font-size:16px}.it{font-size:19px;font-weight:800}.opt{font-size:14px;padding-left:18px}`, `<div class="rc"><div class="c b big">${esc(t.station_name || 'Cuisine')}</div><div class="hr"></div>
  <div class="row big b"><span>${t.table_label ? `TABLE ${esc(t.table_label)}` : esc(KINDS[t.kind]?.fr.toUpperCase() || '')}</span><span>${esc(t.number)}</span></div>
  <div class="row"><span>${t.covers ? `${t.covers} couverts` : esc(t.guest_name || '')}</span><span>${when(t.sent_at)}</span></div>${t.server_name ? `<div>Serveur : ${esc(t.server_name)}</div>` : ''}<div class="hr"></div>
  ${t.lines.map((l) => `<div class="it">${q(l.qty)} × ${esc(l.name)}</div>${l.options ? `<div class="opt">${esc(l.options)}</div>` : ''}${l.note ? `<div class="opt"><b>⚠ ${esc(l.note)}</b></div>` : ''}${l.seat ? `<div class="opt">Siège ${l.seat}</div>` : ''}`).join('')}
  </div>`, autoPrint);
}

export function renderZ(company, z, { autoPrint = false } = {}) {
  const t = z.total;
  const row = (l, v, b) => `<tr${b ? ' class="tot"' : ''}><td>${l}</td><td class="r">${v}</td></tr>`;
  return page(`Rapport Z ${z.date}`, RC, `<div class="rc"><div class="c b big">${esc(company.name)}</div><div class="c b">RAPPORT Z · ${z.date.split('-').reverse().join('/')}</div><div class="hr"></div>
  <table>${row('Additions', t.checks || 0)}${row('Couverts', t.covers || 0)}${row('Ticket moyen', n(t.avg_check))}${row('Par couvert', n(t.per_cover))}</table><div class="hr"></div>
  <table>${row('Chiffre d\'affaires HT', n(t.net || 0))}${row('TVA', n(t.vat || 0))}${row('Total TTC', n(t.total || 0) + ' F', true)}${row('dont service', n(t.service || 0))}${row('Remises', n(t.discount || 0))}${row('Pourboires (hors CA)', n(t.tips || 0))}</table><div class="hr"></div>
  <div class="b">Encaissements</div><table>${z.byMethod.map((m) => row(esc(PAY[m.method]?.fr || m.method), n(m.amount))).join('')}</table><div class="hr"></div>
  <div class="b">Par canal</div><table>${z.byChannel.map((c) => row(`${esc(KINDS[c.kind]?.fr || c.kind)}${c.source !== 'staff' ? ` (${esc(c.source)})` : ''}`, n(c.total))).join('')}</table><div class="hr"></div>
  <div class="b">Par famille</div><table>${z.byCategory.map((c) => row(`${esc(c.name)} (${q(c.qty)})`, n(c.total))).join('')}</table><div class="hr"></div>
  <table>${row(`Annulations après envoi (${z.voids.n})`, n(z.voids.v))}${row(`Offerts et remises (${z.comps.n})`, n(z.comps.v))}${row(`Additions encore ouvertes (${z.open.n})`, n(z.open.due))}</table><div class="hr"></div>
  <div class="b">Caisses</div><table>${z.sessions.map((s) => row(`${esc(s.name)} ${esc(s.number)}`, s.status === 'closed' ? `${n(s.counted_cash)} (écart ${n(s.variance)})` : 'ouverte')).join('')}</table>
  <div class="hr"></div><div class="c sub">Édité le ${when(new Date().toISOString())}</div></div>`, autoPrint);
}

export function renderTableQr(company, tables, base, { autoPrint = false } = {}) {
  return page('QR des tables', `.sheet{max-width:900px;margin:12px auto}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.qc{background:#fff;border:1px solid #dde;border-radius:14px;padding:14px;text-align:center;break-inside:avoid}
  .qc h3{margin:4px 0 8px;font-size:22px;color:${NAVY}}.q{display:flex;justify-content:center;margin:8px 0}.small{font-size:11px;color:#555}.brand{font-weight:800;letter-spacing:.08em;color:${ACCENT};font-size:11px;text-transform:uppercase}`,
  `<div class="sheet"><div class="cards">${tables.map((t) => `<div class="qc"><div class="brand">${esc(company.name)}</div><h3>Table ${esc(t.label)}</h3><div class="q" data-url="${esc(`${base}/m/${t.qr_token}`)}" data-size="150"></div>
  <b>Scannez : menu, commande, appel du serveur et paiement</b><div class="small">Scan for the menu, to order, call your waiter and pay · MTN MoMo · Orange Money</div></div>`).join('')}</div></div>${QR}`, autoPrint);
}
