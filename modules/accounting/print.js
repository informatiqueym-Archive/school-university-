// Printable A4 pages for documents and reports. "Télécharger PDF" opens one
// of these and the browser saves it as PDF (works on Android and desktop).
import { fcfa, amountInWords } from '../../core/format.js';
import { METHODS } from './chart.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => (v == null ? '' : Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
const dfr = (d) => (d ? d.split('-').reverse().join('/') : '');

const T = {
  fr: { quote: 'DEVIS', invoice: 'FACTURE', credit_note: 'AVOIR', bill: 'FACTURE FOURNISSEUR', draft: 'BROUILLON', date: 'Date', due: 'Échéance', valid: "Valable jusqu'au",
    client: 'Client', supplier: 'Fournisseur', desc: 'Désignation', qty: 'Qté', pu: 'P.U. HT', disc: 'Rem.', vat: 'TVA', amount: 'Montant HT', subtotal: 'Total HT', discount: 'dont remises',
    vat_total: 'TVA', total: 'Total TTC', paid: 'Déjà payé', balance: 'Reste à payer', words_invoice: 'Arrêtée la présente facture à la somme de', words_quote: 'Arrêté le présent devis à la somme de',
    words_credit: 'Arrêté le présent avoir à la somme de', pay: 'Modes de paiement', base: 'Base HT', rate: 'Taux', ref: 'Réf.', origin: 'Facture d\'origine', subject: 'Objet',
    sign_client: 'Bon pour accord (date, signature et cachet)', sign_company: 'Pour la société', print: 'Imprimer / Enregistrer en PDF', niu: 'NIU', rccm: 'RCCM', page: 'Page', generated: 'Édité le' },
  en: { quote: 'QUOTE', invoice: 'INVOICE', credit_note: 'CREDIT NOTE', bill: 'SUPPLIER BILL', draft: 'DRAFT', date: 'Date', due: 'Due date', valid: 'Valid until',
    client: 'Customer', supplier: 'Supplier', desc: 'Description', qty: 'Qty', pu: 'Unit price', disc: 'Disc.', vat: 'VAT', amount: 'Net amount', subtotal: 'Net total', discount: 'incl. discounts',
    vat_total: 'VAT', total: 'Total incl. VAT', paid: 'Already paid', balance: 'Balance due', words_invoice: 'This invoice amounts to', words_quote: 'This quote amounts to',
    words_credit: 'This credit note amounts to', pay: 'Payment methods', base: 'Net base', rate: 'Rate', ref: 'Ref.', origin: 'Original invoice', subject: 'Subject',
    sign_client: 'Approved (date, signature and stamp)', sign_company: 'For the company', print: 'Print / Save as PDF', niu: 'Tax ID', rccm: 'Trade reg.', page: 'Page', generated: 'Printed on' },
};

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#E9ECF3;font:13px/1.45 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#0E1633}
.page{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:16mm 15mm;box-shadow:0 4px 30px rgba(14,22,51,.12);position:relative}
.bar{position:sticky;top:0;background:#0B1433;color:#fff;padding:10px 16px;display:flex;gap:12px;justify-content:center;z-index:2}
.bar button{background:#2F6BFF;color:#fff;border:0;border-radius:10px;padding:10px 18px;font:600 14px system-ui;cursor:pointer}
.bar a{color:#C9D6FF;align-self:center}
header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #2F6BFF;padding-bottom:14px}
.co h1{font-size:20px;margin:0 0 4px;color:#0B1433}.co img{max-height:64px;max-width:180px;display:block;margin-bottom:8px}.co div{color:#58607A;font-size:12px}
.title{text-align:right}.title h2{margin:0;font-size:26px;letter-spacing:.06em;color:#2F6BFF}.title .num{font:600 15px "IBM Plex Mono",monospace;margin-top:4px}
.title table{margin-left:auto;margin-top:8px}.title td{padding:1px 0 1px 12px;font-size:12px}.title td:first-child{color:#58607A}
.parties{display:flex;justify-content:flex-end;margin:18px 0}.box{border:1px solid #DADFEA;border-radius:10px;padding:12px 14px;min-width:46%}
.box .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#58607A}.box b{font-size:15px}
.subject{margin:4px 0 12px}
table.lines{width:100%;border-collapse:collapse;margin-top:8px}.lines th{background:#0B1433;color:#fff;font-weight:600;font-size:11.5px;text-align:left;padding:8px}
.lines td{padding:7px 8px;border-bottom:1px solid #ECEEF3;vertical-align:top}.r{text-align:right;white-space:nowrap}
.sum{display:flex;justify-content:space-between;gap:24px;margin-top:14px}.sum table{border-collapse:collapse}.sum td{padding:4px 8px}
.tot td{font-size:13px}.tot tr.big td{font-size:16px;font-weight:700;background:#EEF3FF;color:#0B1433}.vatb td,.vatb th{font-size:11.5px;padding:3px 8px;border-bottom:1px solid #ECEEF3}
.words{margin:16px 0;padding:10px 14px;background:#F5F7FB;border-left:3px solid #2F6BFF;border-radius:6px}
.paywrap{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-top:12px}.pay{font-size:12px;color:#3A4360}.qr{display:flex;gap:12px;align-items:center;max-width:330px;font-size:11.5px;color:#3A4360;border:1px solid #DADFEA;border-radius:10px;padding:10px}.qr #qr{flex:none;width:104px;height:104px}.qr b{color:#0B1433;font-size:13px}.pay b{color:#0E1633}
.sign{display:flex;justify-content:space-between;margin-top:28px;gap:24px}.sign div{flex:1;border-top:1px dashed #C8CFDF;padding-top:6px;font-size:11.5px;color:#58607A;min-height:70px}
footer{position:absolute;left:15mm;right:15mm;bottom:10mm;border-top:1px solid #DADFEA;padding-top:6px;font-size:10.5px;color:#7581A3;text-align:center}
.stamp{position:absolute;top:110mm;left:50%;transform:translateX(-50%) rotate(-18deg);font:800 64px system-ui;color:rgba(230,70,70,.14);border:6px solid rgba(230,70,70,.14);padding:4px 24px;border-radius:12px}
.stamp.paid{color:rgba(47,203,139,.18);border-color:rgba(47,203,139,.18)}
h3{margin:18px 0 6px;font-size:14px;color:#0B1433}.rep{width:100%;border-collapse:collapse}.rep th{background:#0B1433;color:#fff;font-size:11px;text-align:left;padding:6px}
.rep td{padding:5px 6px;border-bottom:1px solid #ECEEF3;font-size:11.5px}.rep tr.sec td{background:#EEF3FF;font-weight:700}.rep tr.tot td{font-weight:700;border-top:2px solid #0B1433}
.muted{color:#7581A3}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:0}@page{size:A4;margin:12mm}footer{position:fixed;bottom:0;left:0;right:0}}
@media (max-width:820px){.page{width:auto;margin:0;padding:18px}header,.sum{flex-direction:column}.title{text-align:left}.title table{margin-left:0}}
`;

function shell(title, body, lang, autoPrint) {
  const t = T[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="bar"><button onclick="window.print()">${t.print}</button><a href="javascript:history.back()">←</a></div>${body}
${autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300))</script>' : ''}</body></html>`;
}

function companyBlock(c, t) {
  return `<div class="co">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : ''}<h1>${esc(c.name)}</h1>
<div>${esc([c.legal_form, c.address, c.city, c.country].filter(Boolean).join(' · '))}</div>
<div>${esc([c.phone, c.email, c.website].filter(Boolean).join(' · '))}</div>
<div>${c.niu ? `${t.niu} : ${esc(c.niu)}` : ''}${c.niu && c.rccm ? ' · ' : ''}${c.rccm ? `${t.rccm} : ${esc(c.rccm)}` : ''}</div></div>`;
}

export function renderDocument(company, d, { lang = 'fr', autoPrint = false, payUrl = null } = {}) {
  const t = T[lang] || T.fr;
  const title = `${t[d.kind]} ${d.number || t.draft}`;
  const isSale = d.kind !== 'bill';
  const lines = d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${+l.qty} ${esc(l.unit || '')}</td><td class="r">${n(l.unit_price)}</td>
    <td class="r">${l.discount ? +l.discount + ' %' : ''}</td><td class="r">${+l.vat_rate} %</td><td class="r">${n(l.net)}</td></tr>`).join('');
  const vatb = d.vat_breakdown.filter((v) => v.base).map((v) => `<tr><td>${+v.rate} %</td><td class="r">${n(v.base)}</td><td class="r">${n(v.vat)}</td></tr>`).join('');
  const words = d.kind === 'quote' ? t.words_quote : d.kind === 'credit_note' ? t.words_credit : t.words_invoice;
  const payMethods = [];
  if (company.momo_number) payMethods.push(`<b>MTN MoMo</b> : ${esc(company.momo_number)}`);
  if (company.om_number) payMethods.push(`<b>Orange Money</b> : ${esc(company.om_number)}`);
  if (company.bank_details) payMethods.push(`<b>Banque</b> : ${esc(company.bank_details)}`);
  const stamp = d.status === 'draft' ? `<div class="stamp">${t.draft}</div>` : d.status === 'paid' ? `<div class="stamp paid">${lang === 'en' ? 'PAID' : 'PAYÉE'}</div>` : '';
  const body = `<div class="page">${stamp}
<header>${companyBlock(company, t)}<div class="title"><h2>${t[d.kind]}</h2><div class="num">${esc(d.number || t.draft)}</div>
<table><tr><td>${t.date}</td><td>${dfr(d.date)}</td></tr>${d.due_date ? `<tr><td>${d.kind === 'quote' ? t.valid : t.due}</td><td>${dfr(d.due_date)}</td></tr>` : ''}
${d.supplier_ref ? `<tr><td>${t.ref}</td><td>${esc(d.supplier_ref)}</td></tr>` : ''}${d.kind === 'credit_note' && d.related[0] ? `<tr><td>${t.origin}</td><td>${esc(d.related[0].number)}</td></tr>` : ''}</table></div></header>
<div class="parties"><div class="box"><div class="lbl">${isSale ? t.client : t.supplier}</div><b>${esc(d.partner_name)}</b>
<div>${esc([d.partner_address, d.partner_city].filter(Boolean).join(', '))}</div><div>${esc([d.partner_phone, d.partner_email].filter(Boolean).join(' · '))}</div>
${d.partner_niu ? `<div>${t.niu} : ${esc(d.partner_niu)}</div>` : ''}</div></div>
${d.subject ? `<div class="subject"><b>${t.subject} :</b> ${esc(d.subject)}</div>` : ''}
<table class="lines"><thead><tr><th>${t.desc}</th><th class="r">${t.qty}</th><th class="r">${t.pu}</th><th class="r">${t.disc}</th><th class="r">${t.vat}</th><th class="r">${t.amount}</th></tr></thead><tbody>${lines}</tbody></table>
<div class="sum"><table class="vatb"><tr><th>${t.rate}</th><th class="r">${t.base}</th><th class="r">${t.vat}</th></tr>${vatb}</table>
<table class="tot"><tr><td>${t.subtotal}</td><td class="r">${n(d.subtotal)} FCFA</td></tr>${d.discount_total ? `<tr><td class="muted">${t.discount}</td><td class="r muted">${n(d.discount_total)} FCFA</td></tr>` : ''}
<tr><td>${t.vat_total}</td><td class="r">${n(d.vat_total)} FCFA</td></tr><tr class="big"><td>${t.total}</td><td class="r">${n(d.total)} FCFA</td></tr>
${(d.kind === 'invoice' || d.kind === 'bill') && d.paid + d.credited > 0 ? `<tr><td>${t.paid}</td><td class="r">${n(d.paid + d.credited)} FCFA</td></tr><tr><td><b>${t.balance}</b></td><td class="r"><b>${n(d.balance)} FCFA</b></td></tr>` : ''}</table></div>
<div class="words">${words} : <b>${esc(amountInWords(d.total))}</b> TTC.</div>
${d.notes ? `<div>${esc(d.notes).replace(/\n/g, '<br>')}</div>` : ''}
<div class="paywrap">${isSale && d.kind !== 'credit_note' && payMethods.length ? `<div class="pay"><b>${t.pay}</b><br>${payMethods.join('<br>')}<br>${t.ref} : ${esc(d.number || '')}</div>` : '<div></div>'}
${payUrl ? `<div class="qr"><div id="qr"></div><div><b>${lang === 'en' ? 'Pay by phone' : 'Payez par téléphone'}</b><br>${lang === 'en' ? 'Scan with your camera, choose MTN MoMo or Orange Money.' : 'Scannez avec l\'appareil photo, choisissez MTN MoMo ou Orange Money.'}<br><span class="muted" style="word-break:break-all">${esc(payUrl)}</span></div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" onerror="document.getElementById('qr').remove()"></script><script>try{new QRCode(document.getElementById('qr'),{text:${JSON.stringify(payUrl)},width:104,height:104,correctLevel:QRCode.CorrectLevel.M})}catch(e){}</script>` : ''}</div>
${d.kind === 'quote' ? `<div class="sign"><div>${t.sign_client}</div><div>${t.sign_company}</div></div>` : ''}
<footer>${esc(company.invoice_footer || `${company.name}${company.niu ? ' · NIU ' + company.niu : ''}${company.rccm ? ' · RCCM ' + company.rccm : ''}`)}</footer></div>`;
  return shell(title, body, lang, autoPrint);
}

// ---- Reports ----
const head = (company, title, sub) => `<header>${companyBlock(company, T.fr)}<div class="title"><h2 style="font-size:20px">${esc(title)}</h2><div class="muted">${esc(sub)}</div></div></header>`;

export function renderReport(company, name, data, { autoPrint = false } = {}) {
  let title = '', sub = '', body = '';
  const per = data.from ? `Du ${dfr(data.from)} au ${dfr(data.to)}` : `Au ${dfr(data.to || data.at)}`;
  if (name === 'trial-balance') {
    title = 'Balance générale'; sub = per;
    body = `<table class="rep"><thead><tr><th>Compte</th><th>Intitulé</th><th class="r">Solde initial D</th><th class="r">Solde initial C</th><th class="r">Mouv. débit</th><th class="r">Mouv. crédit</th><th class="r">Solde final D</th><th class="r">Solde final C</th></tr></thead><tbody>
${data.rows.map((r) => `<tr><td>${r.code}</td><td>${esc(r.name)}</td><td class="r">${n(r.open_debit) || ''}</td><td class="r">${n(r.open_credit) || ''}</td><td class="r">${n(r.debit)}</td><td class="r">${n(r.credit)}</td><td class="r">${n(r.close_debit) || ''}</td><td class="r">${n(r.close_credit) || ''}</td></tr>`).join('')}
<tr class="tot"><td colspan="2">Totaux</td>${['open_debit', 'open_credit', 'debit', 'credit', 'close_debit', 'close_credit'].map((k) => `<td class="r">${n(data.total[k])}</td>`).join('')}</tr></tbody></table>`;
  } else if (name === 'general-ledger') {
    title = 'Grand livre'; sub = per;
    body = data.accounts.map((a) => `<h3>${a.code} – ${esc(a.name)}</h3><table class="rep"><thead><tr><th>Date</th><th>Pièce</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th><th class="r">Solde</th></tr></thead><tbody>
${a.opening ? `<tr><td></td><td></td><td class="muted">Solde à nouveau</td><td></td><td></td><td class="r">${n(a.opening)}</td></tr>` : ''}
${a.lines.map((l) => `<tr><td>${dfr(l.date)}</td><td>${esc(l.number)}</td><td>${esc(l.label)}${l.partner_name ? ` <span class="muted">(${esc(l.partner_name)})</span>` : ''}</td><td class="r">${n(l.debit) || ''}</td><td class="r">${n(l.credit) || ''}</td><td class="r">${n(l.balance)}</td></tr>`).join('')}
<tr class="tot"><td colspan="3">Total ${a.code}</td><td class="r">${n(a.debit)}</td><td class="r">${n(a.credit)}</td><td class="r">${n(a.balance)}</td></tr></tbody></table>`).join('');
  } else if (name === 'journal') {
    title = data.journal ? (data.journals[data.journal]?.fr || 'Journal') : 'Journal général'; sub = per;
    body = `<table class="rep"><thead><tr><th>Date</th><th>N°</th><th>Compte</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th></tr></thead><tbody>
${data.entries.slice().reverse().map((e) => `<tr class="sec"><td>${dfr(e.date)}</td><td>${esc(e.number)}</td><td colspan="4">${esc(e.label)}</td></tr>` + e.lines.map((l) => `<tr><td></td><td></td><td>${l.account_code}</td><td>${esc(l.account_name || '')}${l.partner_name ? ` – ${esc(l.partner_name)}` : ''}</td><td class="r">${n(l.debit) || ''}</td><td class="r">${n(l.credit) || ''}</td></tr>`).join('')).join('')}</tbody></table>`;
  } else if (name === 'balance-sheet') {
    title = 'Bilan'; sub = per;
    const side = (secs, label, total) => `<table class="rep"><thead><tr><th>${label}</th><th class="r">Net (FCFA)</th></tr></thead><tbody>${secs.map((s) => `<tr class="sec"><td>${esc(s.section)}</td><td class="r">${n(s.total)}</td></tr>${s.items.map((i) => `<tr><td>${esc(i.label)}</td><td class="r">${n(i.value)}</td></tr>`).join('')}`).join('')}<tr class="tot"><td>Total ${label.toLowerCase()}</td><td class="r">${n(total)}</td></tr></tbody></table>`;
    body = `${side(data.actif, 'Actif', data.total_actif)}<br>${side(data.passif, 'Passif', data.total_passif)}`;
  } else if (name === 'income-statement') {
    title = 'Compte de résultat'; sub = per;
    const t = data.totals;
    const L = Object.fromEntries(data.lines.map((l) => [l.key, l]));
    const row = (k) => `<tr><td>${L[k].ref}</td><td>${esc(L[k].label)}</td><td class="r">${n(L[k].value)}</td></tr>`;
    const tot = (label, v) => `<tr class="sec"><td></td><td>${label}</td><td class="r">${n(v)}</td></tr>`;
    body = `<table class="rep"><thead><tr><th>Comptes</th><th>Libellé</th><th class="r">Montant (FCFA)</th></tr></thead><tbody>
${['TA', 'RA', 'RB'].map(row).join('')}${tot('Marge commerciale', t.margin)}${['TB', 'TC', 'TD', 'TDR', 'TF', 'TG', 'RC', 'RE', 'RF', 'RG', 'RH'].map(row).join('')}${tot('Valeur ajoutée', t.added_value)}
${row('RI')}${tot("Excédent brut d'exploitation", t.ebe)}${['TJ', 'RL'].map(row).join('')}${tot("Résultat d'exploitation", t.operating)}${['TK', 'RM'].map(row).join('')}${tot('Résultat financier', t.financial)}
${tot('Résultat des activités ordinaires', t.ordinary)}${['TN', 'RO'].map(row).join('')}${tot('Résultat hors activités ordinaires', t.hao)}${row('RS')}
<tr class="tot"><td></td><td>Résultat net</td><td class="r">${n(t.net)}</td></tr></tbody></table><p class="muted">Chiffre d'affaires : ${fcfa(t.revenue)}</p>`;
  } else if (name === 'vat') {
    title = 'Déclaration de TVA'; sub = per;
    body = `<table class="rep"><tbody><tr><td>TVA collectée</td><td class="r">${n(data.collected)}</td></tr><tr><td class="muted">dont TVA principale 17,5 %</td><td class="r muted">${n(data.collected_split.principal)}</td></tr>
<tr><td class="muted">dont CAC 10 % (1,75 %)</td><td class="r muted">${n(data.collected_split.cac)}</td></tr><tr><td>TVA déductible</td><td class="r">${n(data.deductible)}</td></tr>
<tr class="tot"><td>TVA à payer</td><td class="r">${n(data.due)}</td></tr>${data.credit ? `<tr class="tot"><td>Crédit de TVA à reporter</td><td class="r">${n(data.credit)}</td></tr>` : ''}</tbody></table>
<h3>Ventes par taux</h3><table class="rep"><thead><tr><th>Taux</th><th class="r">Base HT</th><th class="r">TVA</th></tr></thead><tbody>${data.sales.map((s) => `<tr><td>${+s.rate} %</td><td class="r">${n(s.base)}</td><td class="r">${n(s.vat)}</td></tr>`).join('')}</tbody></table>
<h3>Achats et dépenses</h3><table class="rep"><thead><tr><th>Origine</th><th class="r">Base HT</th><th class="r">TVA</th></tr></thead><tbody>${data.purchases.map((s) => `<tr><td>Factures fournisseurs ${+s.rate} %</td><td class="r">${n(s.base)}</td><td class="r">${n(s.vat)}</td></tr>`).join('')}<tr><td>Dépenses</td><td class="r">${n(data.expenses.base)}</td><td class="r">${n(data.expenses.vat)}</td></tr></tbody></table>`;
  } else if (name === 'aged-receivables' || name === 'aged-payables') {
    title = name === 'aged-receivables' ? 'Balance âgée clients' : 'Balance âgée fournisseurs'; sub = per;
    body = `<table class="rep"><thead><tr><th>Tiers</th><th class="r">Non échu</th><th class="r">1–30 j</th><th class="r">31–60 j</th><th class="r">61–90 j</th><th class="r">+90 j</th><th class="r">Total</th></tr></thead><tbody>
${data.rows.map((r) => `<tr><td>${esc(r.partner_name)}</td>${['current', 'd30', 'd60', 'd90', 'over90', 'total'].map((k) => `<td class="r">${n(r[k]) || ''}</td>`).join('')}</tr>`).join('')}
<tr class="tot"><td>Total</td>${['current', 'd30', 'd60', 'd90', 'over90', 'total'].map((k) => `<td class="r">${n(data.total[k])}</td>`).join('')}</tr></tbody></table>`;
  } else if (name === 'statement') {
    title = `Relevé de compte – ${data.partner.name}`; sub = per;
    body = `<table class="rep"><thead><tr><th>Date</th><th>Pièce</th><th>Libellé</th><th class="r">Débit</th><th class="r">Crédit</th><th class="r">Solde</th></tr></thead><tbody>
${data.lines.map((l) => `<tr><td>${dfr(l.date)}</td><td>${esc(l.number)}</td><td>${esc(l.label)}</td><td class="r">${n(l.debit) || ''}</td><td class="r">${n(l.credit) || ''}</td><td class="r">${n(l.balance)}</td></tr>`).join('')}
<tr class="tot"><td colspan="5">Solde dû</td><td class="r">${fcfa(data.balance)}</td></tr></tbody></table>`;
  } else if (name === 'payment') {
    title = data.direction === 'in' ? 'Reçu de paiement' : 'Bon de décaissement'; sub = `N° ${data.id} · ${dfr(data.date)}`;
    body = `<table class="rep" style="margin-top:20px"><tbody><tr><td>${data.direction === 'in' ? 'Reçu de' : 'Payé à'}</td><td><b>${esc(data.partner_name || '')}</b></td></tr>
<tr><td>Montant</td><td><b>${fcfa(data.amount)}</b> (${esc(amountInWords(data.amount))})</td></tr><tr><td>Mode</td><td>${esc(METHODS[data.method]?.fr || data.method)}</td></tr>
${data.document_number ? `<tr><td>Facture</td><td>${esc(data.document_number)}</td></tr>` : ''}${data.reference ? `<tr><td>Référence</td><td>${esc(data.reference)}</td></tr>` : ''}</tbody></table>
<div class="sign"><div>Signature du client</div><div>Pour ${esc(company.name)}</div></div>`;
  }
  const page = `<div class="page">${head(company, title, sub)}${body}<footer>${esc(company.name)} · ${T.fr.generated} ${dfr(new Date().toISOString().slice(0, 10))}</footer></div>`;
  return shell(title, page, 'fr', autoPrint);
}
