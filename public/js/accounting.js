// Teknons Compta screens: dashboard, quotes/invoices/credit notes/bills,
// payments (cash, bank, MTN MoMo, Orange Money), expenses, treasury,
// journal entries, chart of accounts and SYSCOHADA reports.
import { api } from './api.js';
import { state, L, esc, money, moneyShort, num, dt, today, yearStart, monthStart, icon, can, canAny, pill, table, field, dialog, toast, showError, confirmDlg, offlineNote, qs } from './ui.js';
import { partnerDialog, productDialog } from './core-pages.js';

const KIND = {
  quote: { fr: 'Devis', en: 'Quotes', one: ['Devis', 'Quote'], neu: ['Nouveau devis', 'New quote'], perm: ['sales', 'accounting'] },
  invoice: { fr: 'Factures', en: 'Invoices', one: ['Facture', 'Invoice'], neu: ['Nouvelle facture', 'New invoice'], perm: ['sales', 'accounting'] },
  credit_note: { fr: 'Avoirs', en: 'Credit notes', one: ['Avoir', 'Credit note'], neu: ['Nouvel avoir', 'New credit note'], perm: ['sales', 'accounting'] },
  bill: { fr: 'Factures fournisseurs', en: 'Supplier bills', one: ['Facture fournisseur', 'Supplier bill'], neu: ['Nouvelle facture fournisseur', 'New supplier bill'], perm: ['purchases', 'accounting'] },
};
const methodLabel = (m) => { const x = state.meta?.methods?.[m]; return x ? L(x.fr, x.en) : m; };
const METHOD_OPTS = () => Object.entries(state.meta?.methods || {}).map(([k, v]) => [k, L(v.fr, v.en)]);
const isOverdue = (d) => ['open', 'partial'].includes(d.status) && d.due_date && d.due_date < today();

// ===================== Payment link (share / remind) =====================
const waNumber = (p) => String(p || '').replace(/\D/g, '').replace(/^(6\d{8})$/, '237$1');
export async function payLinkDialog(d, { reminder = false } = {}) {
  let link;
  try { link = await api.post(`/api/documents/${d.id}/pay-link`); } catch (e) { showError(e); return; }
  const co = state.me.company.name;
  const due = d.balance ?? d.total;
  const late = reminder || (d.due_date && d.due_date < today());
  const msg = late
    ? L(`Bonjour ${d.partner_name}, sauf erreur de notre part, la facture ${d.number} de ${money(due)} (échue le ${dt(d.due_date)}) reste à régler. Vous pouvez payer en 1 minute par MTN MoMo ou Orange Money ici : ${link.url}\nMerci, ${co}`,
      `Hello ${d.partner_name}, invoice ${d.number} for ${money(due)} (due ${dt(d.due_date)}) is still unpaid. You can pay in 1 minute with MTN MoMo or Orange Money here: ${link.url}\nThank you, ${co}`)
    : L(`Bonjour ${d.partner_name}, voici votre facture ${d.number} de ${money(due)}. Payez en 1 minute par MTN MoMo ou Orange Money : ${link.url}\nMerci, ${co}`,
      `Hello ${d.partner_name}, here is your invoice ${d.number} for ${money(due)}. Pay in 1 minute with MTN MoMo or Orange Money: ${link.url}\nThank you, ${co}`);
  const wa = `https://wa.me/${waNumber(d.partner_phone)}?text=${encodeURIComponent(msg)}`;
  const sms = `sms:${d.partner_phone ? '+' + waNumber(d.partner_phone) : ''}?body=${encodeURIComponent(msg)}`;
  await dialog({
    title: late ? L('Relancer le client', 'Send a reminder') : L('Lien de paiement', 'Payment link'), submit: null, cancel: L('Fermer', 'Close'),
    body: `<p class="muted" style="margin-top:0">${L('Le client ouvre le lien, choisit MTN MoMo ou Orange Money et valide avec son code. La facture se solde toute seule et vous recevez une alerte.', 'The customer opens the link, picks MTN MoMo or Orange Money and confirms with their PIN. The invoice settles itself and you get an alert.')}</p>
      <label class="fld">${L('Message', 'Message')}<textarea class="in" id="plmsg" rows="5">${esc(msg)}</textarea></label>
      <div class="row" style="margin-top:12px"><a class="btn primary" id="plwa" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn" id="plsms" href="${esc(sms)}">SMS</a>
      <button type="button" class="btn" id="plcopy">${L('Copier le lien', 'Copy link')}</button><a class="btn ghost" href="${esc(link.url)}" target="_blank" rel="noopener">${L('Voir la page', 'Open page')}</a></div>`,
    onOpen: (dlg) => {
      const ta = dlg.querySelector('#plmsg');
      ta.addEventListener('input', () => { dlg.querySelector('#plwa').href = `https://wa.me/${waNumber(d.partner_phone)}?text=${encodeURIComponent(ta.value)}`; dlg.querySelector('#plsms').href = `sms:${d.partner_phone ? '+' + waNumber(d.partner_phone) : ''}?body=${encodeURIComponent(ta.value)}`; });
      dlg.querySelector('#plcopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(link.url); toast(L('Lien copié', 'Link copied'), 'ok'); } catch { ta.select(); } });
    },
  });
}

// ===================== Dashboard =====================
export async function dashboard(ctx) {
  ctx.title(L('Tableau de bord', 'Dashboard'));
  if (canAny('sales', 'accounting')) ctx.actions(`<a class="btn primary" href="#/doc/new/invoice">${icon('plus')}<span class="hide-m">${L('Facture', 'Invoice')}</span></a>`);
  const d = await api.get('/api/reports/dashboard');
  const k = d.kpi;
  const month = new Date(d.date).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric' });
  const kpi = (l, v, s, cls = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="card kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></${href ? 'a' : 'div'}>`;
  const maxExp = Math.max(1, ...d.expensesMonth.map((e) => e.v));
  const maxCli = Math.max(1, ...d.topClients.map((e) => e.v));
  ctx.el.innerHTML = `${offlineNote(d)}
  <div class="grid g4">
    ${kpi(L('Trésorerie disponible', 'Cash available'), money(d.treasury.total), L('caisse, banque, Mobile Money', 'cash, bank, Mobile Money'), 'accent', '#/treasury')}
    ${kpi(L("Encaissé aujourd'hui", 'Received today'), money(k.today_in), `${k.today_in_count} ${L('paiement(s)', 'payment(s)')}`, '', '#/payments')}
    ${kpi(L('Ventes du mois (HT)', 'Sales this month'), money(k.sales_month), month)}
    ${kpi(L('Résultat de l\'année', 'Profit this year'), money(k.result_year), L('produits − charges', 'income − expenses'), '', canAny('reports', 'accounting') ? '#/report/income-statement' : '')}
    ${kpi(L('Clients : reste à encaisser', 'Receivables'), money(k.receivable), `${k.receivable_count} ${L('facture(s)', 'invoice(s)')}`, '', '#/documents/invoice?status=unpaid')}
    ${kpi(L('Dont en retard', 'Overdue'), `<span style="color:${k.overdue ? 'var(--bad)' : 'inherit'}">${money(k.overdue)}</span>`, `${k.overdue_count} ${L('facture(s)', 'invoice(s)')}`, '', '#/documents/invoice?status=overdue')}
    ${kpi(L('Fournisseurs à payer', 'Payables'), money(k.payable), `${k.payable_count} ${L('facture(s)', 'bill(s)')}`, '', '#/documents/bill?status=unpaid')}
    ${kpi(L('Dépenses du mois', 'Spending this month'), money(k.cash_out_month), `${L('Encaissements', 'Receipts')} : ${money(k.cash_in_month)}`, '', '#/expenses')}
  </div>
  ${k.pending_momo_count ? `<div class="card" style="margin-top:16px;background:var(--info-bg);border-color:#CFDBFF">${icon('phone')} <b>${k.pending_momo_count} ${L('paiement(s) Mobile Money en attente de confirmation', 'Mobile Money payment(s) awaiting confirmation')}</b> · ${money(k.pending_momo)} · <a href="#/payments?status=pending">${L('voir', 'view')}</a></div>` : ''}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>${L('Ventes et encaissements sur 12 mois', 'Sales and receipts, last 12 months')}</h3>${barChart(d.series)}</div>
    <div class="card"><h3>${L('Comptes de trésorerie', 'Cash accounts')}</h3>
      ${d.treasury.accounts.map((a) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${esc(a.name)} <span class="dim mono">${a.code}</span></span><b class="num">${money(a.balance)}</b></div>`).join('')}
      <div class="row between" style="padding-top:10px"><b>Total</b><b class="num">${money(d.treasury.total)}</b></div>
      ${d.byMethod.length ? `<h3 style="margin-top:18px">${L('Encaissements du mois par mode', 'This month\'s receipts by method')}</h3><div class="bar-list">${d.byMethod.map((m) => `<div class="it"><span>${esc(methodLabel(m.method))} <span class="dim">(${m.n})</span></span><b class="num">${money(m.v)}</b><div class="tr"><i style="width:${Math.max(3, (m.v / k.cash_in_month) * 100)}%"></i></div></div>`).join('')}</div>` : ''}
    </div>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>${L('Factures en retard', 'Overdue invoices')}</h3>${d.overdueList.length ? d.overdueList.map((x) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap"><a href="#/doc/${x.id}" style="color:inherit;min-width:0"><b>${esc(x.partner_name)}</b><div class="muted" style="font-size:13px">${esc(x.number)} · ${L('échue le', 'due')} ${dt(x.due_date)}</div><b class="num" style="color:var(--bad)">${money(x.balance)}</b></a>${canAny('sales', 'treasury', 'accounting') ? `<button class="btn sm" data-remind="${x.id}">${L('Relancer', 'Remind')}</button>` : ''}</div>`).join('') : `<p class="muted">${L('Aucune facture en retard.', 'No overdue invoices.')}</p>`}</div>
    <div class="card"><h3>${L('Derniers mouvements', 'Latest payments')}</h3>${d.recent.length ? d.recent.map((p) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span><b>${esc(p.partner_name || '')}</b><div class="muted" style="font-size:13px">${dt(p.date)} · ${esc(methodLabel(p.method))} ${p.status !== 'completed' ? pill(p.status) : ''}</div></span><b class="num" style="color:${p.direction === 'in' ? 'var(--ok)' : 'var(--ink)'}">${p.direction === 'in' ? '+' : '−'}${money(p.amount)}</b></div>`).join('') : `<p class="muted">${L('Aucun paiement.', 'No payments yet.')}</p>`}</div>
    <div class="card"><h3>${L('Meilleurs clients de l\'année', 'Top customers this year')}</h3>${d.topClients.length ? `<div class="bar-list">${d.topClients.map((c) => `<div class="it"><a href="#/partner/${c.id}">${esc(c.name)}</a><b class="num">${money(c.v)}</b><div class="tr"><i style="width:${(c.v / maxCli) * 100}%"></i></div></div>`).join('')}</div>` : `<p class="muted">—</p>`}
      ${d.expensesMonth.length ? `<h3 style="margin-top:18px">${L('Dépenses du mois', 'This month\'s expenses')}</h3><div class="bar-list">${d.expensesMonth.map((c) => `<div class="it"><span>${esc(c.name || c.account_code)}</span><b class="num">${money(c.v)}</b><div class="tr"><i style="width:${(c.v / maxExp) * 100}%;background:var(--s2)"></i></div></div>`).join('')}</div>` : ''}</div>
  </div>`;
  wireChart(ctx.el);
  ctx.el.querySelectorAll('[data-remind]').forEach((b) => b.addEventListener('click', () => { const x = d.overdueList.find((o) => String(o.id) === b.dataset.remind); payLinkDialog({ ...x, total: x.balance }, { reminder: true }); }));
}

function barChart(series) {
  const W = 640, H = 240, pl = 44, pb = 26, pt = 10, pr = 8;
  const max = Math.max(1, ...series.flatMap((s) => [s.sales, s.cash_in]));
  const step = (W - pl - pr) / series.length;
  const bw = Math.max(4, Math.min(16, step / 2 - 4));
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((t) => max * t);
  const mlabel = (m) => new Date(m + '-01').toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'fr-FR', { month: 'short' }).replace('.', '');
  const bar = (x, v, color) => { const top = y(v), h = Math.max(0, H - pb - top); return h ? `<path d="M${x},${H - pb} V${top + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H - pb} Z" fill="${color}"/>` : ''; };
  return `<div class="legend"><span><i style="background:var(--s1)"></i>${L('Ventes HT', 'Sales')}</span><span><i style="background:var(--s2)"></i>${L('Encaissements', 'Receipts')}</span></div>
  <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('Ventes et encaissements par mois', 'Sales and receipts by month')}">
  ${ticks.map((t) => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="#E3E7F0"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#8A90A3">${moneyShort(t)}</text>`).join('')}
  ${series.map((s, i) => { const x0 = pl + i * step + step / 2 - bw - 1; return `<g data-tip="${esc(`${mlabel(s.month)} ${s.month.slice(0, 4)} — ${L('Ventes', 'Sales')} : ${money(s.sales)} · ${L('Encaissé', 'Received')} : ${money(s.cash_in)}`)}">
    <rect x="${pl + i * step}" y="${pt}" width="${step}" height="${H - pt - pb}" fill="transparent"/>${bar(x0, s.sales, 'var(--s1)')}${bar(x0 + bw + 2, s.cash_in, 'var(--s2)')}
    <text x="${pl + i * step + step / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8A90A3">${mlabel(s.month)}</text></g>`; }).join('')}
  </svg><div class="tip" hidden></div></div>`;
}
function wireChart(el) {
  el.querySelectorAll('.chart').forEach((c) => {
    const tip = c.querySelector('.tip');
    c.querySelectorAll('[data-tip]').forEach((g) => {
      const show = (e) => { const r = c.getBoundingClientRect(); const b = g.getBoundingClientRect(); tip.textContent = g.dataset.tip; tip.hidden = false; tip.style.left = Math.min(Math.max(b.left - r.left + b.width / 2, 120), r.width - 120) + 'px'; tip.style.top = '40px'; };
      g.addEventListener('mouseenter', show); g.addEventListener('click', show);
      g.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  });
}

// ===================== Documents =====================
export async function documentList(ctx) {
  const kind = KIND[ctx.params.kind] ? ctx.params.kind : 'invoice';
  const K = KIND[kind];
  ctx.title(L(K.fr, K.en));
  const q = { kind, status: ctx.query.status || '', q: ctx.query.q || '', from: ctx.query.from || '', to: ctx.query.to || '' };
  ctx.actions(`<a class="btn hide-m" href="/api/export/${kind}${qs({ status: q.status, from: q.from, to: q.to })}">${icon('download')}Excel</a>${canAny(...K.perm) ? `<a class="btn primary" href="#/doc/new/${kind}">${icon('plus')}<span class="hide-m">${L(...K.neu)}</span></a>` : ''}`);
  const statuses = kind === 'quote' ? [['', L('Tous', 'All')], ['draft', L('Brouillons', 'Drafts')], ['sent', L('Envoyés', 'Sent')], ['accepted', L('Acceptés', 'Accepted')], ['invoiced', L('Facturés', 'Invoiced')], ['refused', L('Refusés', 'Refused')]]
    : kind === 'credit_note' ? [['', L('Tous', 'All')], ['draft', L('Brouillons', 'Drafts')], ['validated', L('Validés', 'Posted')]]
      : [['', L('Toutes', 'All')], ['unpaid', L('À payer', 'Unpaid')], ['overdue', L('En retard', 'Overdue')], ['paid', L('Payées', 'Paid')], ['draft', L('Brouillons', 'Drafts')]];
  const rows = await api.get(`/api/documents${qs(q)}`);
  const sum = rows.filter((r) => r.status !== 'draft').reduce((s, r) => s + r.total, 0);
  const bal = rows.reduce((s, r) => s + (['open', 'partial'].includes(r.status) ? r.balance : 0), 0);
  ctx.el.innerHTML = `${offlineNote(rows)}<div class="filters"><div class="tabs">${statuses.map(([v, l]) => `<a href="#${ctx.path}${qs({ ...ctx.query, status: v })}" class="${q.status === v ? 'on' : ''}">${l}</a>`).join('')}</div>
    <input type="search" class="in" id="q" value="${esc(q.q)}" placeholder="${L('N°, client, objet…', 'No., customer, subject…')}"></div>
    ${table({ rows, href: (r) => `/doc/${r.id}`,
      columns: [
        { label: L('N°', 'No.'), render: (r) => `<span class="mono">${esc(r.number || L('Brouillon', 'Draft'))}</span>${r.supplier_ref ? `<div class="muted">${esc(r.supplier_ref)}</div>` : ''}` },
        { label: kind === 'bill' ? L('Fournisseur', 'Supplier') : L('Client', 'Customer'), render: (r) => `<b>${esc(r.partner_name)}</b>${r.subject ? `<div class="muted">${esc(r.subject)}</div>` : ''}` },
        { label: L('Date', 'Date'), render: (r) => dt(r.date), hideM: true },
        { label: kind === 'quote' ? L('Validité', 'Valid until') : L('Échéance', 'Due'), render: (r) => dt(r.due_date), hideM: true },
        { label: L('Total TTC', 'Total'), cls: 'r num', render: (r) => money(r.total) },
        ...(kind === 'invoice' || kind === 'bill' ? [{ label: L('Reste dû', 'Balance'), cls: 'r num', hideM: true, render: (r) => (['open', 'partial'].includes(r.status) ? `<b>${money(r.balance)}</b>` : '') }] : []),
        { label: L('Statut', 'Status'), render: (r) => pill(r.status, isOverdue(r)) }],
      foot: rows.length ? `<tr class="tot"><td colspan="2">${rows.length} ${L('document(s)', 'document(s)')}</td><td class="hide-m"></td><td class="hide-m"></td><td class="r num">${money(sum)}</td>${kind === 'invoice' || kind === 'bill' ? `<td class="r num hide-m">${money(bal)}</td>` : ''}<td></td></tr>` : '',
      empty: `<b>${L('Aucun document', 'No documents')}</b>${canAny(...K.perm) ? `<a href="#/doc/new/${kind}">${L(...K.neu)}</a>` : ''}` })}`;
  let t; ctx.el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = ctx.path + qs({ ...ctx.query, q: e.target.value }); }, 500); });
}

export async function documentEditor(ctx) {
  const editing = !!ctx.params.id;
  let doc = editing ? await api.get(`/api/documents/${ctx.params.id}`) : null;
  const kind = doc?.kind || (KIND[ctx.params.kind] ? ctx.params.kind : 'invoice');
  const K = KIND[kind];
  ctx.title(editing ? `${L(...K.one)} ${doc.number || L('(brouillon)', '(draft)')}` : L(...K.neu));
  const pkind = kind === 'bill' ? 'supplier' : 'client';
  let [partners, products, accounts] = await Promise.all([api.get(`/api/partners?kind=${pkind}`), api.get('/api/products'), api.get('/api/accounts')]);
  const company = state.me.company;
  const defRate = company.vat_enabled ? company.vat_rate : 0;
  const accOpts = accounts.filter((a) => (kind === 'bill' ? /^[26]/.test(a.code) : /^7/.test(a.code)) && a.code.length >= 3);
  let lines = doc ? doc.lines.map((l) => ({ ...l })) : [{ description: '', qty: 1, unit_price: 0, discount: 0, vat_rate: defRate, kind: 'service' }];
  if (!doc && ctx.query.partner) doc = { partner_id: Number(ctx.query.partner) };
  const v = doc || {};

  const lineHtml = (l, i) => `<div class="line" data-i="${i}">
    <div class="desc stack" style="gap:6px"><select class="in" data-k="product_id"><option value="">${L('— Article (optionnel) —', '— Product (optional) —')}</option>${products.map((p) => `<option value="${p.id}" ${String(p.id) === String(l.product_id) ? 'selected' : ''}>${esc(p.name)} · ${num(kind === 'bill' ? p.purchase_price : p.price)}</option>`).join('')}</select>
      <input class="in" data-k="description" value="${esc(l.description)}" placeholder="${L('Désignation', 'Description')}" required></div>
    <label class="fld">${L('Qté', 'Qty')}<input class="in" type="number" step="any" min="0" data-k="qty" value="${l.qty}" inputmode="decimal"></label>
    <label class="fld">${L('P.U. HT', 'Unit price')}<input class="in" type="number" step="1" min="0" data-k="unit_price" value="${l.unit_price}" inputmode="numeric"></label>
    <label class="fld">${L('Remise %', 'Disc. %')}<input class="in" type="number" step="any" min="0" max="100" data-k="discount" value="${l.discount || 0}"></label>
    <label class="fld">${L('TVA %', 'VAT %')}<input class="in" type="number" step="0.01" min="0" data-k="vat_rate" value="${l.vat_rate}"></label>
    <div class="tot num" data-tot>${money(0)}</div>
    <button type="button" class="btn ghost sm" data-del="${i}" aria-label="${L('Supprimer la ligne', 'Remove line')}">${icon('x')}</button>
    <details style="grid-column:1/-1"><summary class="muted" style="font-size:12.5px;cursor:pointer">${L('Compte comptable', 'Ledger account')} : <span data-acc>${esc(l.account_code || L('automatique', 'automatic'))}</span></summary>
      <select class="in" data-k="account_code" style="margin-top:6px"><option value="">${L('Automatique', 'Automatic')} (${kind === 'bill' ? '601 / 605' : '701 / 706'})</option>${accOpts.map((a) => `<option value="${a.code}" ${a.code === l.account_code ? 'selected' : ''}>${a.code} – ${esc(a.name)}</option>`).join('')}</select>
      <select class="in" data-k="kind" style="margin-top:6px"><option value="service" ${l.kind !== 'good' ? 'selected' : ''}>${L('Service', 'Service')}</option><option value="good" ${l.kind === 'good' ? 'selected' : ''}>${L('Marchandise', 'Goods')}</option></select></details></div>`;

  ctx.el.innerHTML = `<form id="df" class="stack" novalidate>
    <div class="card"><div class="f3">
      <label class="fld">${kind === 'bill' ? L('Fournisseur', 'Supplier') : L('Client', 'Customer')} *<div class="row" style="flex-wrap:nowrap"><select class="in" name="partner_id" required><option value="">—</option>${partners.map((p) => `<option value="${p.id}" ${String(p.id) === String(v.partner_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><button type="button" class="btn" id="newp" title="${L('Nouveau', 'New')}">${icon('plus')}</button></div></label>
      ${field({ name: 'date', label: L('Date', 'Date'), type: 'date', required: true, value: today() }, v)}
      ${kind !== 'credit_note' ? field({ name: 'due_date', label: kind === 'quote' ? L("Valable jusqu'au", 'Valid until') : L('Échéance', 'Due date'), type: 'date', hint: L('Vide = délai par défaut', 'Empty = default terms') }, v) : '<div></div>'}
      ${field({ name: 'subject', label: L('Objet', 'Subject'), span: kind !== 'bill' }, v)}
      ${kind === 'bill' ? field({ name: 'supplier_ref', label: L('N° de la facture du fournisseur', "Supplier's invoice no.") }, v) : ''}
    </div></div>
    <div class="card"><div class="row between" style="margin-bottom:10px"><h3 style="margin:0">${L('Lignes', 'Lines')}</h3><div class="row"><button type="button" class="btn sm" id="newprod">${icon('box')}${L('Nouvel article', 'New product')}</button><button type="button" class="btn sm primary" id="add">${icon('plus')}${L('Ajouter une ligne', 'Add line')}</button></div></div>
      <div class="lines" id="lines"></div>
      <div class="row" style="margin-top:16px;align-items:flex-start">${field({ name: 'notes', label: L('Notes / conditions', 'Notes / terms'), type: 'textarea' }, v)}<div class="totals" id="totals"></div></div></div>
    <div class="row" style="justify-content:flex-end">
      <a class="btn" href="${editing ? `#/doc/${doc.id}` : `#/documents/${kind}`}">${L('Annuler', 'Cancel')}</a>
      <button class="btn" value="draft">${kind === 'quote' ? L('Enregistrer', 'Save') : L('Enregistrer le brouillon', 'Save draft')}</button>
      ${kind !== 'quote' ? `<button class="btn primary" value="validate">${L('Enregistrer et valider', 'Save and post')}</button>` : ''}
    </div></form>`;
  const form = ctx.el.querySelector('#df');
  const linesEl = form.querySelector('#lines');
  const calc = () => {
    let ht = 0, tva = 0, disc = 0;
    linesEl.querySelectorAll('.line').forEach((row) => {
      const l = lines[row.dataset.i];
      const gross = Math.round((+l.qty || 0) * (+l.unit_price || 0));
      const net = Math.round(gross * (1 - (+l.discount || 0) / 100));
      const vat = Math.round(net * (+l.vat_rate || 0) / 100);
      ht += net; tva += vat; disc += gross - net;
      row.querySelector('[data-tot]').textContent = money(net);
    });
    form.querySelector('#totals').innerHTML = `<div><span>${L('Total HT', 'Net total')}</span><b class="num">${money(ht)}</b></div>${disc ? `<div class="muted"><span>${L('dont remises', 'incl. discounts')}</span><span class="num">${money(disc)}</span></div>` : ''}
      <div><span>${L('TVA', 'VAT')}</span><b class="num">${money(tva)}</b></div><div class="big"><span>${L('Total TTC', 'Total')}</span><span class="num">${money(ht + tva)}</span></div>`;
  };
  const draw = () => { linesEl.innerHTML = lines.map(lineHtml).join(''); calc(); };
  linesEl.addEventListener('input', (e) => {
    const row = e.target.closest('.line'); const k = e.target.dataset.k; if (!row || !k) return;
    const l = lines[row.dataset.i];
    l[k] = e.target.value;
    if (k === 'product_id') {
      const p = products.find((x) => String(x.id) === e.target.value);
      if (p) { l.description = p.name; l.unit_price = kind === 'bill' ? p.purchase_price : p.price; l.vat_rate = p.vat_rate ?? defRate; l.kind = p.kind; l.unit = p.unit; l.account_code = (kind === 'bill' ? p.purchase_account : p.sales_account) || ''; draw(); return; }
    }
    if (k === 'account_code') row.querySelector('[data-acc]').textContent = e.target.value || L('automatique', 'automatic');
    calc();
  });
  linesEl.addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b && lines.length > 1) { lines.splice(+b.dataset.del, 1); draw(); } });
  form.querySelector('#add').addEventListener('click', () => { lines.push({ description: '', qty: 1, unit_price: 0, discount: 0, vat_rate: defRate, kind: 'service' }); draw(); linesEl.querySelector('.line:last-child [data-k=description]').focus(); });
  form.querySelector('#newp').addEventListener('click', async () => {
    const p = await partnerDialog(pkind); if (!p) return;
    partners = [...partners, p];
    const sel = form.partner_id; sel.insertAdjacentHTML('beforeend', `<option value="${esc(p.id)}">${esc(p.name)}</option>`); sel.value = p.id;
  });
  form.querySelector('#newprod').addEventListener('click', async () => { const p = await productDialog(); if (p) { products = [...products, p]; draw(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || 'draft';
    if (!form.partner_id.value) { toast(kind === 'bill' ? L('Choisissez un fournisseur', 'Choose a supplier') : L('Choisissez un client', 'Choose a customer'), 'err'); return; }
    if (lines.some((l) => !String(l.description).trim())) { toast(L('Chaque ligne doit avoir une désignation', 'Each line needs a description'), 'err'); return; }
    const body = { kind, partner_id: form.partner_id.value, date: form.date.value, due_date: form.due_date?.value || '', subject: form.subject.value, supplier_ref: form.supplier_ref?.value || '', notes: form.notes.value,
      lines: lines.map((l) => ({ product_id: l.product_id || null, description: l.description, qty: +l.qty || 0, unit: l.unit || '', unit_price: Math.round(+l.unit_price || 0), discount: +l.discount || 0, vat_rate: +l.vat_rate || 0, account_code: l.account_code || '', kind: l.kind || 'service' })) };
    e.submitter && (e.submitter.disabled = true);
    try {
      let r;
      if (editing) { r = await api.put(`/api/documents/${doc.id}`, body); if (mode === 'validate') r = await api.post(`/api/documents/${doc.id}/validate`); }
      else r = await api.post('/api/documents', { ...body, validate: mode === 'validate' }, { label: `${L(...K.one)} – ${partners.find((p) => String(p.id) === String(body.partner_id))?.name || ''}` });
      if (r._queued) { toast(L('Enregistré sur le téléphone. Le document sera créé au retour du réseau.', 'Saved on this device. It will be created when back online.'), 'ok'); location.hash = `#/documents/${kind}`; return; }
      toast(mode === 'validate' ? `${L(...K.one)} ${r.number} ${L('validée', 'posted')}` : L('Enregistré', 'Saved'), 'ok');
      location.hash = `#/doc/${r.id}`;
    } catch (err) { showError(err); } finally { e.submitter && (e.submitter.disabled = false); }
  });
  draw();
}

export async function documentView(ctx) {
  const d = await api.get(`/api/documents/${ctx.params.id}`);
  const K = KIND[d.kind];
  const canEdit = canAny(...K.perm);
  ctx.title(`${L(...K.one)} ${d.number || L('(brouillon)', '(draft)')}`);
  const btn = (id, label, cls = '', ic = '') => `<button class="btn ${cls}" data-a="${id}">${ic ? icon(ic) : ''}${label}</button>`;
  const acts = [];
  acts.push(`<a class="btn" href="/print/document/${d.id}" target="_blank" rel="noopener">${icon('print')}PDF</a>`);
  if (canEdit) {
    if (d.status === 'draft' || (d.kind === 'quote' && d.status === 'sent')) acts.push(`<a class="btn" href="#/doc/${d.id}/edit">${L('Modifier', 'Edit')}</a>`);
    if (d.kind !== 'quote' && d.status === 'draft') acts.push(btn('validate', L('Valider', 'Post'), 'primary'));
    if (d.kind === 'quote' && d.status === 'draft') acts.push(btn('sent', L('Marquer envoyé', 'Mark sent')));
    if (d.kind === 'quote' && ['draft', 'sent'].includes(d.status)) acts.push(btn('accepted', L('Accepté', 'Accepted')), btn('refused', L('Refusé', 'Refused'), 'danger'));
    if (d.kind === 'quote' && ['draft', 'sent', 'accepted'].includes(d.status)) acts.push(btn('convert', L('Transformer en facture', 'Convert to invoice'), 'primary'));
    if (d.kind === 'invoice' && ['open', 'partial'].includes(d.status)) acts.push(btn('credit', L('Faire un avoir', 'Credit note')));
    if (d.kind !== 'credit_note') acts.push(btn('dup', L('Dupliquer', 'Duplicate')));
    if (d.status === 'draft' || (d.kind === 'quote' && d.status !== 'invoiced')) acts.push(btn('delete', L('Supprimer', 'Delete'), 'danger'));
  }
  const canPay = ['open', 'partial'].includes(d.status) && (d.kind === 'invoice' ? canAny('sales', 'treasury', 'accounting') : d.kind === 'bill' && canAny('purchases', 'treasury', 'accounting'));
  const share = d.kind === 'quote' && d.partner_phone ? `https://wa.me/${waNumber(d.partner_phone)}?text=${encodeURIComponent(`${state.me.company.name} – ${L(...K.one)} ${d.number || ''} : ${money(d.total)}.`)}` : '';
  ctx.el.innerHTML = `<div class="stack">
    <div class="card"><div class="doc-head"><div><div class="muted">${d.kind === 'bill' ? L('Fournisseur', 'Supplier') : L('Client', 'Customer')}</div><a href="#/partner/${d.partner_id}"><b style="font-size:18px">${esc(d.partner_name)}</b></a>
      <div class="muted">${esc([d.partner_phone, d.partner_email].filter(Boolean).join(' · '))}</div>${d.subject ? `<div style="margin-top:6px">${esc(d.subject)}</div>` : ''}</div>
      <div style="text-align:right"><div class="doc-amount">${money(d.total)}</div>${pill(d.status, isOverdue(d))}
      <div class="muted" style="margin-top:6px">${L('Date', 'Date')} ${dt(d.date)}${d.due_date ? ` · ${d.kind === 'quote' ? L('valable jusqu\'au', 'valid until') : L('échéance', 'due')} ${dt(d.due_date)}` : ''}</div>
      ${d.kind === 'invoice' || d.kind === 'bill' ? `<div style="margin-top:4px">${L('Reste dû', 'Balance')} : <b class="num">${money(d.balance)}</b></div>` : ''}</div></div>
      <div class="row" style="margin-top:14px">${acts.join('')}${share ? `<a class="btn" href="${share}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div></div>
    ${canPay ? `<div class="card" style="background:var(--info-bg);border-color:#CFDBFF"><div class="row between"><b>${d.kind === 'invoice' ? L('Encaisser cette facture', 'Collect this invoice') : L('Payer cette facture', 'Pay this bill')}</b>
      <div class="row">${d.kind === 'invoice' ? btn('link', L('Envoyer le lien de paiement', 'Send payment link'), 'primary', 'phone') + btn('momo', L('Demande directe MoMo', 'Direct MoMo request')) : ''}${btn('pay', L('Enregistrer un paiement reçu', 'Record a payment'), d.kind === 'invoice' ? '' : 'primary', 'cash')}</div></div></div>` : ''}
    ${table({ rows: d.lines, columns: [
      { label: L('Désignation', 'Description'), render: (l) => `${esc(l.description)}<div class="dim mono" style="font-size:12px">${l.account_code}</div>` },
      { label: L('Qté', 'Qty'), cls: 'r', render: (l) => `${+l.qty} ${esc(l.unit || '')}` }, { label: L('P.U. HT', 'Unit'), cls: 'r num', render: (l) => num(l.unit_price) },
      { label: L('Rem.', 'Disc.'), cls: 'r', hideM: true, render: (l) => (l.discount ? `${+l.discount} %` : '') }, { label: L('TVA', 'VAT'), cls: 'r', hideM: true, render: (l) => `${+l.vat_rate} %` },
      { label: L('Montant HT', 'Net'), cls: 'r num', render: (l) => num(l.net) }],
      foot: `<tr><td colspan="3" class="hide-m"></td><td colspan="2" class="r">${L('Total HT', 'Net total')}</td><td class="r num">${money(d.subtotal)}</td></tr><tr><td colspan="3" class="hide-m"></td><td colspan="2" class="r">${L('TVA', 'VAT')}</td><td class="r num">${money(d.vat_total)}</td></tr><tr class="tot"><td colspan="3" class="hide-m"></td><td colspan="2" class="r">${L('Total TTC', 'Total')}</td><td class="r num">${money(d.total)}</td></tr>` })}
    ${d.notes ? `<div class="card"><div class="muted">${esc(d.notes).replace(/\n/g, '<br>')}</div></div>` : ''}
    ${d.payments.length ? `<div class="card"><h3>${L('Paiements', 'Payments')}</h3>${table({ rows: d.payments, columns: [
      { label: L('Date', 'Date'), render: (p) => dt(p.date) }, { label: L('Mode', 'Method'), render: (p) => `${esc(methodLabel(p.method))}${p.reference ? `<div class="muted">${esc(p.reference)}</div>` : ''}${p.failure_reason ? `<div class="muted">${esc(p.failure_reason)}</div>` : ''}` },
      { label: L('Montant', 'Amount'), cls: 'r num', render: (p) => money(p.amount) }, { label: L('Statut', 'Status'), render: (p) => pill(p.status) },
      { label: '', cls: 'r', render: (p) => `${p.status === 'pending' ? `<button class="btn sm" data-check="${p.id}">${L('Vérifier', 'Check')}</button>` : ''}${p.status === 'completed' ? `<a class="btn sm" target="_blank" href="/print/report/payment?id=${p.id}">${L('Reçu', 'Receipt')}</a>` : ''}` }] })}</div>` : ''}
    ${d.related.length ? `<div class="card"><h3>${L('Documents liés', 'Related documents')}</h3>${d.related.map((r) => `<a href="#/doc/${r.id}" class="row between" style="padding:6px 0;color:inherit"><span>${esc(L(...KIND[r.kind].one))} <span class="mono">${esc(r.number || L('brouillon', 'draft'))}</span></span><span>${money(r.total)} ${pill(r.status)}</span></a>`).join('')}</div>` : ''}
  </div>`;
  ctx.el.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', async () => { try { const p = await api.post(`/api/payments/${b.dataset.check}/check`); toast(p.status === 'completed' ? L('Paiement confirmé', 'Payment confirmed') : p.status === 'failed' ? L('Paiement échoué', 'Payment failed') : L('Toujours en attente du client', 'Still waiting for the customer')); ctx.rerender(); } catch (e) { showError(e); } }));
  ctx.el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.a;
    try {
      if (a === 'validate') {
        if (!await confirmDlg(L('Valider le document', 'Post document'), L('Un numéro définitif sera attribué et l\'écriture comptable passée. Le document ne pourra plus être modifié.', 'A final number is assigned and the entry posted. The document can no longer be edited.'), L('Valider', 'Post'))) return;
        await api.post(`/api/documents/${d.id}/validate`); toast(L('Validé', 'Posted'), 'ok'); ctx.rerender();
      } else if (['sent', 'accepted', 'refused'].includes(a)) { await api.post(`/api/documents/${d.id}/status`, { status: a }); ctx.rerender(); }
      else if (a === 'convert') { const r = await api.post(`/api/documents/${d.id}/convert`); toast(L('Facture créée en brouillon', 'Draft invoice created'), 'ok'); location.hash = `#/doc/${r.id}`; }
      else if (a === 'credit') { const r = await api.post(`/api/documents/${d.id}/credit-note`); toast(L('Avoir créé en brouillon : vérifiez-le puis validez', 'Draft credit note created: check it, then post'), 'ok'); location.hash = `#/doc/${r.id}/edit`; }
      else if (a === 'dup') { const r = await api.post(`/api/documents/${d.id}/duplicate`); location.hash = `#/doc/${r.id}/edit`; }
      else if (a === 'delete') { if (!await confirmDlg(L('Supprimer', 'Delete'), L('Supprimer définitivement ce document ?', 'Delete this document for good?'), L('Supprimer', 'Delete'), true)) return; await api.del(`/api/documents/${d.id}`); location.hash = `#/documents/${d.kind}`; }
      else if (a === 'pay') { if (await paymentDialog({ document: d })) ctx.rerender(); }
      else if (a === 'momo') { if (await momoDialog(d)) ctx.rerender(); }
      else if (a === 'link') { await payLinkDialog(d); }
    } catch (e) { showError(e); }
  }));
}

// ===================== Payments =====================
export function paymentDialog({ document: d, direction }) {
  const dir = d ? (d.kind === 'bill' ? 'out' : 'in') : direction || 'in';
  const tre = state.meta?.treasury || [];
  return new Promise(async (resolve) => {
    let partners = [];
    if (!d) partners = await api.get(`/api/partners?kind=${dir === 'in' ? 'client' : 'supplier'}`).catch(() => []);
    const r = await dialog({
      title: dir === 'in' ? L('Encaissement', 'Receive payment') : L('Paiement fournisseur', 'Pay supplier'),
      body: `<div class="f2">
        ${d ? `<div style="grid-column:1/-1" class="muted">${esc(d.partner_name)} · ${esc(d.number)} · ${L('reste dû', 'balance')} <b>${money(d.balance)}</b></div>` : field({ name: 'partner_id', label: dir === 'in' ? L('Client', 'Customer') : L('Fournisseur', 'Supplier'), type: 'select', required: true, span: true, options: [['', '—'], ...partners.map((p) => [p.id, p.name])] })}
        ${field({ name: 'amount', label: L('Montant (FCFA)', 'Amount (FCFA)'), type: 'number', min: 1, required: true, value: d ? d.balance : '' })}
        ${field({ name: 'date', label: L('Date', 'Date'), type: 'date', value: today(), required: true })}
        ${field({ name: 'method', label: L('Mode de paiement', 'Method'), type: 'select', options: METHOD_OPTS(), value: 'cash' })}
        ${field({ name: 'account_code', label: L('Compte de trésorerie', 'Cash account'), type: 'select', options: [['', L('Selon le mode', 'From method')], ...tre.map((a) => [a.code, `${a.code} – ${a.name}`])] })}
        ${field({ name: 'reference', label: L('Référence (n° transaction, chèque…)', 'Reference (transaction no., cheque…)'), span: true })}
        ${field({ name: 'notes', label: L('Note', 'Note'), span: true })}</div>`,
      onSubmit: async (v) => {
        const res = await api.post('/api/payments', { ...v, direction: dir, document_id: d?.id }, { label: `${dir === 'in' ? 'Encaissement' : 'Paiement'} ${money(v.amount)}` });
        toast(res._queued ? L('Enregistré sur le téléphone, sera envoyé au retour du réseau', 'Saved on this device, will sync later') : L('Paiement enregistré', 'Payment recorded'), 'ok');
        return res;
      },
    });
    resolve(r);
  });
}

function momoDialog(d) {
  const m = state.meta?.momo || {};
  return dialog({
    title: L('Demande de paiement Mobile Money', 'Mobile Money payment request'),
    body: `<p class="muted" style="margin-top:0">${L('Le client reçoit une demande sur son téléphone et confirme avec son code secret. La facture est soldée automatiquement dès la confirmation.', 'The customer gets a prompt on their phone and confirms with their PIN. The invoice is settled automatically once confirmed.')}</p>
      ${m.mode === 'simulation' ? `<div class="netbar" style="border-radius:10px;margin-bottom:12px">${L('Mode démonstration : aucun argent réel. Le paiement est confirmé après 5 secondes (numéro finissant par 0000 = échec).', 'Demo mode: no real money. Payment confirms after 5 seconds (number ending 0000 = failure).')}</div>` : ''}
      <div class="f2">${field({ name: 'provider', label: L('Opérateur', 'Operator'), type: 'select', options: [['mtn_momo', 'MTN Mobile Money'], ['orange_money', 'Orange Money']] })}
      ${field({ name: 'phone', label: L('Téléphone du client', "Customer's phone"), type: 'tel', required: true, value: d.partner_phone || '', placeholder: '6XX XX XX XX' })}
      ${field({ name: 'amount', label: L('Montant (FCFA)', 'Amount (FCFA)'), type: 'number', min: 1, required: true, value: d.balance })}</div>`,
    submit: L('Envoyer la demande', 'Send request'),
    onOpen: (dlg) => {
      const ph = dlg.querySelector('[name=phone]'), pr = dlg.querySelector('[name=provider]');
      const guess = () => { const n = ph.value.replace(/\D/g, '').replace(/^237/, ''); if (/^(69|65[5-9]|68[6-9])/.test(n)) pr.value = 'orange_money'; else if (/^(67|65[0-4]|68[0-3])/.test(n)) pr.value = 'mtn_momo'; };
      ph.addEventListener('input', guess); guess();
    },
    onSubmit: async (v) => { const r = await api.post('/api/payments/momo-request', { ...v, document_id: d.id }); toast(L('Demande envoyée. En attente de la confirmation du client…', 'Request sent. Waiting for the customer to confirm…')); return r; },
  });
}

export async function paymentList(ctx) {
  ctx.title(L('Paiements', 'Payments'));
  const q = { direction: ctx.query.direction || '', method: ctx.query.method || '', status: ctx.query.status || '', from: ctx.query.from || monthStart(), to: ctx.query.to || today() };
  const acts = [`<a class="btn hide-m" href="/api/export/payments${qs(q)}">${icon('download')}Excel</a>`];
  if (canAny('sales', 'treasury', 'accounting')) acts.push(`<button class="btn primary" id="pin">${icon('plus')}<span class="hide-m">${L('Encaissement', 'Receipt')}</span></button>`);
  if (canAny('purchases', 'treasury', 'accounting')) acts.push(`<button class="btn" id="pout">${L('Décaissement', 'Payment out')}</button>`);
  ctx.actions(acts.join(''));
  const rows = await api.get(`/api/payments${qs(q)}`);
  const tin = rows.filter((r) => r.direction === 'in' && r.status === 'completed').reduce((s, r) => s + r.amount, 0);
  const tout = rows.filter((r) => r.direction === 'out' && r.status === 'completed').reduce((s, r) => s + r.amount, 0);
  ctx.el.innerHTML = `${offlineNote(rows)}${periodFilter(ctx, q, `<select class="in" name="direction"><option value="">${L('Tous les sens', 'All')}</option><option value="in" ${q.direction === 'in' ? 'selected' : ''}>${L('Encaissements', 'Received')}</option><option value="out" ${q.direction === 'out' ? 'selected' : ''}>${L('Décaissements', 'Paid out')}</option></select>
    <select class="in" name="method"><option value="">${L('Tous les modes', 'All methods')}</option>${METHOD_OPTS().map(([k, l]) => `<option value="${k}" ${q.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select class="in" name="status"><option value="">${L('Tous les statuts', 'All statuses')}</option>${['completed', 'pending', 'failed', 'cancelled'].map((s) => `<option value="${s}" ${q.status === s ? 'selected' : ''}>${pill(s).replace(/<[^>]+>/g, '')}</option>`).join('')}</select>`)}
    <div class="grid g2" style="margin-bottom:14px"><div class="card kpi"><div class="l">${L('Encaissé sur la période', 'Received in period')}</div><div class="v" style="color:var(--ok)">${money(tin)}</div></div><div class="card kpi"><div class="l">${L('Décaissé sur la période', 'Paid out in period')}</div><div class="v">${money(tout)}</div></div></div>
    ${table({ rows, columns: [
      { label: L('Date', 'Date'), render: (r) => dt(r.date) },
      { label: L('Tiers', 'Party'), render: (r) => `<b>${esc(r.partner_name || '')}</b>${r.document_number ? `<div><a href="#/doc/${r.document_id}" class="mono">${esc(r.document_number)}</a></div>` : ''}` },
      { label: L('Mode', 'Method'), render: (r) => `${esc(methodLabel(r.method))}${r.reference ? `<div class="muted">${esc(r.reference)}</div>` : ''}${r.phone ? `<div class="muted">${esc(r.phone)}</div>` : ''}` },
      { label: L('Montant', 'Amount'), cls: 'r num', render: (r) => `<b style="color:${r.direction === 'in' ? 'var(--ok)' : 'inherit'}">${r.direction === 'in' ? '+' : '−'}${money(r.amount)}</b>` },
      { label: L('Statut', 'Status'), render: (r) => pill(r.status) },
      { label: '', cls: 'r nowrap', render: (r) => `${r.status === 'pending' ? `<button class="btn sm" data-check="${r.id}">${L('Vérifier', 'Check')}</button>` : ''}${r.status === 'completed' ? `<a class="btn sm" target="_blank" href="/print/report/payment?id=${r.id}">${L('Reçu', 'Receipt')}</a> <button class="btn sm ghost" data-cancel="${r.id}">${L('Annuler', 'Cancel')}</button>` : ''}` }],
      empty: `<b>${L('Aucun paiement sur la période', 'No payments in this period')}</b>` })}`;
  wirePeriod(ctx);
  document.getElementById('pin')?.addEventListener('click', async () => { if (await paymentDialog({ direction: 'in' })) ctx.rerender(); });
  document.getElementById('pout')?.addEventListener('click', async () => { if (await paymentDialog({ direction: 'out' })) ctx.rerender(); });
  ctx.el.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', async () => { try { await api.post(`/api/payments/${b.dataset.check}/check`); ctx.rerender(); } catch (e) { showError(e); } }));
  ctx.el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDlg(L('Annuler le paiement', 'Cancel payment'), L('Une écriture inverse sera passée et la facture redeviendra à payer.', 'A reversing entry is posted and the invoice becomes unpaid again.'), L('Annuler le paiement', 'Cancel payment'), true)) return;
    try { await api.post(`/api/payments/${b.dataset.cancel}/cancel`); toast(L('Paiement annulé', 'Payment cancelled'), 'ok'); ctx.rerender(); } catch (e) { showError(e); }
  }));
}

function periodFilter(ctx, q, extra = '') {
  return `<form class="filters" id="pf">${extra}<input class="in" type="date" name="from" value="${esc(q.from)}" aria-label="${L('Du', 'From')}"><input class="in" type="date" name="to" value="${esc(q.to)}" aria-label="${L('Au', 'To')}">
    <div class="tabs">${[[monthStart(), today(), L('Ce mois', 'This month')], [yearStart(), today(), L('Cette année', 'This year')], [`${+today().slice(0, 4) - 1}-01-01`, `${+today().slice(0, 4) - 1}-12-31`, L('Année dernière', 'Last year')]].map(([f, t, l]) => `<a href="#${ctx.path}${qs({ ...ctx.query, from: f, to: t })}" class="${q.from === f && q.to === t ? 'on' : ''}">${l}</a>`).join('')}</div></form>`;
}
function wirePeriod(ctx) {
  const f = ctx.el.querySelector('#pf'); if (!f) return;
  f.addEventListener('change', () => { const v = Object.fromEntries(new FormData(f)); location.hash = ctx.path + qs({ ...ctx.query, ...v }); });
}

// ===================== Expenses =====================
export async function expenseList(ctx) {
  ctx.title(L('Dépenses', 'Expenses'));
  const q = { from: ctx.query.from || monthStart(), to: ctx.query.to || today() };
  const canAdd = canAny('purchases', 'treasury', 'accounting');
  ctx.actions(`<a class="btn hide-m" href="/api/export/expenses${qs(q)}">${icon('download')}Excel</a>${canAdd ? `<button class="btn primary" id="add">${icon('plus')}${L('Dépense', 'Expense')}</button>` : ''}`);
  const rows = await api.get(`/api/expenses${qs(q)}`);
  const total = rows.filter((r) => r.status === 'posted').reduce((s, r) => s + r.total, 0);
  ctx.el.innerHTML = `${offlineNote(rows)}${periodFilter(ctx, q)}<div class="card kpi" style="margin-bottom:14px"><div class="l">${L('Total des dépenses sur la période', 'Total spending in period')}</div><div class="v">${money(total)}</div></div>
    ${table({ rows, columns: [
      { label: L('Date', 'Date'), render: (r) => dt(r.date) },
      { label: L('Description', 'Description'), render: (r) => `<b>${esc(r.description)}</b><div class="muted">${r.account_code} · ${esc(r.account_name || '')}${r.partner_name ? ` · ${esc(r.partner_name)}` : ''}</div>` },
      { label: L('Mode', 'Method'), hideM: true, render: (r) => esc(methodLabel(r.method)) },
      { label: 'TTC', cls: 'r num', render: (r) => `<b>${money(r.total)}</b>${r.vat ? `<div class="muted">${L('dont TVA', 'incl. VAT')} ${num(r.vat)}</div>` : ''}` },
      { label: '', cls: 'r', render: (r) => (r.status === 'cancelled' ? pill('cancelled') : canAdd ? `<button class="btn sm ghost" data-cancel="${r.id}">${L('Annuler', 'Cancel')}</button>` : '') }],
      empty: `<b>${L('Aucune dépense sur la période', 'No expenses in this period')}</b>${L('Carburant, loyer, électricité, transport… notez chaque sortie d\'argent.', 'Fuel, rent, power, transport… record every outflow.')}` })}`;
  wirePeriod(ctx);
  document.getElementById('add')?.addEventListener('click', async () => { if (await expenseDialog()) ctx.rerender(); });
  ctx.el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDlg(L('Annuler la dépense', 'Cancel expense'), L('Une écriture inverse sera passée.', 'A reversing entry will be posted.'), L('Annuler la dépense', 'Cancel expense'), true)) return;
    try { await api.post(`/api/expenses/${b.dataset.cancel}/cancel`); ctx.rerender(); } catch (e) { showError(e); }
  }));
}

const EXPENSE_ACCOUNTS = ['6053', '6052', '6051', '6055', '6054', '6056', '605', '601', '604', '6222', '624', '625', '627', '6281', '6282', '631', '6324', '614', '618', '6384', '6385', '638', '6411', '6412', '6611', '6641', '658', '2441', '2442', '2444', '2451'];
async function expenseDialog() {
  const accounts = await api.get('/api/accounts');
  const by = Object.fromEntries(accounts.map((a) => [a.code, a]));
  const common = EXPENSE_ACCOUNTS.filter((c) => by[c]).map((c) => [c, `${c} – ${by[c].name}`]);
  const others = accounts.filter((a) => /^6/.test(a.code) && !EXPENSE_ACCOUNTS.includes(a.code)).map((a) => [a.code, `${a.code} – ${a.name}`]);
  const tre = state.meta?.treasury || [];
  return dialog({
    title: L('Nouvelle dépense', 'New expense'),
    body: `<div class="f2">${field({ name: 'description', label: L('Description', 'Description'), required: true, span: true, placeholder: L('Ex. carburant groupe électrogène', 'e.g. generator fuel') })}
      ${field({ name: 'total', label: L('Montant payé TTC (FCFA)', 'Amount paid incl. VAT (FCFA)'), type: 'number', min: 1, required: true })}
      ${field({ name: 'date', label: L('Date', 'Date'), type: 'date', value: today(), required: true })}
      ${field({ name: 'account_code', label: L('Nature de la dépense', 'Expense type'), type: 'select', span: true, options: [...common, ...others], value: '605' })}
      ${field({ name: 'vat_rate', label: L('TVA incluse (%)', 'VAT included (%)'), type: 'number', step: '0.01', value: 0, hint: L('19,25 si le reçu mentionne la TVA, sinon 0', '19.25 if the receipt shows VAT, else 0') })}
      ${field({ name: 'method', label: L('Payé par', 'Paid with'), type: 'select', options: METHOD_OPTS(), value: 'cash' })}
      ${field({ name: 'treasury_account', label: L('Compte de trésorerie', 'Cash account'), type: 'select', options: [['', L('Selon le mode', 'From method')], ...tre.map((a) => [a.code, `${a.code} – ${a.name}`])] })}
      ${field({ name: 'reference', label: L('N° de reçu', 'Receipt no.') })}</div>`,
    onSubmit: async (v) => { const r = await api.post('/api/expenses', v, { label: `Dépense ${v.description}` }); toast(r._queued ? L('Enregistrée sur le téléphone, sera envoyée au retour du réseau', 'Saved on this device, will sync later') : L('Dépense enregistrée', 'Expense recorded'), 'ok'); return r; },
  });
}

// ===================== Treasury =====================
export async function treasury(ctx) {
  ctx.title(L('Caisse, banque et Mobile Money', 'Cash, bank and Mobile Money'));
  const canMove = canAny('treasury', 'accounting');
  ctx.actions(canMove ? `<button class="btn primary" id="tr">${icon('swap')}${L('Virement interne', 'Transfer')}</button>` : '');
  const [t, transfers] = await Promise.all([api.get('/api/treasury'), api.get('/api/transfers')]);
  const name = (code) => t.accounts.find((a) => a.code === code)?.name || code;
  ctx.el.innerHTML = `${offlineNote(t)}<div class="grid g4">${t.accounts.map((a) => `<a class="card kpi" href="#/report/general-ledger?account=${a.code}"><div class="l">${esc(a.name)} <span class="mono dim">${a.code}</span></div><div class="v">${money(a.balance)}</div><div class="s">${L('voir les mouvements', 'see movements')} →</div></a>`).join('')}
    <div class="card kpi accent"><div class="l">${L('Total disponible', 'Total available')}</div><div class="v">${money(t.total)}</div></div></div>
    <p class="muted">${L('Ajoutez un compte (2e banque, 2e caisse…) dans le plan comptable, par exemple 5212 ou 5712.', 'Add an account (second bank, second till…) in the chart of accounts, e.g. 5212 or 5712.')}</p>
    <h3>${L('Virements internes', 'Transfers')}</h3>
    ${table({ rows: transfers, columns: [{ label: L('Date', 'Date'), render: (r) => dt(r.date) }, { label: L('De', 'From'), render: (r) => esc(name(r.from_account)) }, { label: L('Vers', 'To'), render: (r) => esc(name(r.to_account)) },
      { label: L('Libellé', 'Label'), key: 'label', hideM: true }, { label: L('Montant', 'Amount'), cls: 'r num', render: (r) => money(r.amount) }, { label: L('Frais', 'Fees'), cls: 'r num', hideM: true, render: (r) => (r.fees ? money(r.fees) : '') }],
      empty: `<b>${L('Aucun virement', 'No transfers')}</b>${L('Ex. dépôt de la caisse à la banque, retrait Mobile Money.', 'e.g. depositing cash at the bank, Mobile Money withdrawal.')}` })}`;
  document.getElementById('tr')?.addEventListener('click', async () => {
    const opts = t.accounts.map((a) => [a.code, `${a.code} – ${a.name}`]);
    const ok = await dialog({ title: L('Virement interne', 'Internal transfer'), body: `<div class="f2">${field({ name: 'from_account', label: L('Depuis', 'From'), type: 'select', options: opts, value: '5711' })}${field({ name: 'to_account', label: L('Vers', 'To'), type: 'select', options: opts, value: '5211' })}
      ${field({ name: 'amount', label: L('Montant (FCFA)', 'Amount (FCFA)'), type: 'number', min: 1, required: true })}${field({ name: 'fees', label: L('Frais (FCFA)', 'Fees (FCFA)'), type: 'number', min: 0, value: 0, hint: L('Ex. frais de retrait Mobile Money', 'e.g. Mobile Money withdrawal fee') })}
      ${field({ name: 'date', label: L('Date', 'Date'), type: 'date', value: today() })}${field({ name: 'label', label: L('Libellé', 'Label'), placeholder: L('Dépôt en banque', 'Bank deposit') })}</div>`,
      onSubmit: (v) => api.post('/api/transfers', v, { label: `Virement ${money(v.amount)}` }) });
    if (ok) { toast(L('Virement enregistré', 'Transfer recorded'), 'ok'); ctx.rerender(); }
  });
}

// ===================== Partner detail =====================
export async function partnerDetail(ctx) {
  const p = await api.get(`/api/partners/${ctx.params.id}`);
  ctx.title(p.name);
  const isClient = p.kind === 'client';
  const canEdit = isClient ? canAny('sales', 'treasury', 'accounting') : canAny('purchases', 'accounting');
  ctx.actions(`${canEdit ? `<button class="btn" id="edit">${L('Modifier', 'Edit')}</button>` : ''}${isClient && canAny('sales', 'accounting') ? `<a class="btn primary" href="#/doc/new/invoice?partner=${p.id}">${icon('plus')}<span class="hide-m">${L('Facture', 'Invoice')}</span></a>` : ''}`);
  const [docs, st] = await Promise.all([api.get(`/api/documents?partner_id=${p.id}`), canAny('reports', 'accounting', 'read') ? api.get(`/api/statements/${p.id}?from=2000-01-01`).catch(() => null) : null]);
  ctx.el.innerHTML = `<div class="grid g3"><div class="card"><div class="muted">${isClient ? L('Client', 'Customer') : L('Fournisseur', 'Supplier')}</div><b style="font-size:18px">${esc(p.name)}</b>
    <div class="muted">${esc([p.contact, p.phone, p.email].filter(Boolean).join(' · '))}</div><div class="muted">${esc([p.address, p.city].filter(Boolean).join(', '))}</div>${p.niu ? `<div class="muted">NIU ${esc(p.niu)}</div>` : ''}
    ${p.phone ? `<div class="row" style="margin-top:10px"><a class="btn sm" href="tel:${esc(p.phone)}">${L('Appeler', 'Call')}</a><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${String(p.phone).replace(/\D/g, '').replace(/^(6\d{8})$/, '237$1')}">WhatsApp</a></div>` : ''}</div>
    <div class="card kpi"><div class="l">${isClient ? L('Il vous doit', 'Owes you') : L('Vous lui devez', 'You owe')}</div><div class="v">${money(st?.balance || 0)}</div>
    ${st ? `<div class="row" style="margin-top:8px"><a class="btn sm" target="_blank" href="/print/report/statement?partner_id=${p.id}&from=2000-01-01">${icon('print')}${L('Relevé PDF', 'Statement PDF')}</a><a class="btn sm" href="/api/statements/${p.id}?from=2000-01-01&format=xlsx">Excel</a></div>` : ''}</div>
    <div class="card kpi"><div class="l">${L('Total facturé', 'Total invoiced')}</div><div class="v">${money(docs.filter((d) => (d.kind === 'invoice' || d.kind === 'bill') && d.status !== 'draft').reduce((s, d) => s + d.total, 0))}</div><div class="s">${docs.length} ${L('document(s)', 'document(s)')}</div></div></div>
    <h3 style="margin-top:18px">${L('Documents', 'Documents')}</h3>
    ${table({ rows: docs, href: (r) => `/doc/${r.id}`, columns: [{ label: L('Type', 'Type'), render: (r) => esc(L(...KIND[r.kind].one)) }, { label: L('N°', 'No.'), render: (r) => `<span class="mono">${esc(r.number || L('Brouillon', 'Draft'))}</span>` },
      { label: L('Date', 'Date'), render: (r) => dt(r.date) }, { label: 'Total', cls: 'r num', render: (r) => money(r.total) }, { label: L('Reste dû', 'Balance'), cls: 'r num', hideM: true, render: (r) => (['open', 'partial'].includes(r.status) ? money(r.balance) : '') }, { label: L('Statut', 'Status'), render: (r) => pill(r.status, isOverdue(r)) }] })}
    ${p.notes ? `<div class="card" style="margin-top:16px">${esc(p.notes)}</div>` : ''}`;
  document.getElementById('edit')?.addEventListener('click', async () => { if (await partnerDialog(p.kind, p)) ctx.rerender(); });
}

// ===================== Journal entries & chart of accounts =====================
export async function entryList(ctx) {
  ctx.title(L('Journaux et écritures', 'Journals & entries'));
  const q = { journal: ctx.query.journal || '', from: ctx.query.from || monthStart(), to: ctx.query.to || today(), q: ctx.query.q || '' };
  ctx.actions(`<a class="btn hide-m" target="_blank" href="/print/report/journal${qs(q)}">${icon('print')}PDF</a><a class="btn hide-m" href="/api/reports/journal${qs({ ...q, format: 'xlsx' })}">${icon('download')}Excel</a>${can('accounting') ? `<a class="btn primary" href="#/entry/new">${icon('plus')}<span class="hide-m">${L('Écriture', 'Entry')}</span></a>` : ''}`);
  const data = await api.get(`/api/entries${qs(q)}`);
  const J = state.meta?.journals || {};
  ctx.el.innerHTML = `${periodFilter(ctx, q, `<select class="in" name="journal"><option value="">${L('Tous les journaux', 'All journals')}</option>${Object.entries(J).map(([k, v]) => `<option value="${k}" ${q.journal === k ? 'selected' : ''}>${k} – ${esc(L(v.fr, v.en))}</option>`).join('')}</select>`)}
    ${data.entries.length ? data.entries.map((e) => `<div class="card" style="margin-bottom:10px;padding:14px"><div class="row between"><div><span class="pill info mono">${esc(e.number)}</span> <b>${esc(e.label)}</b>${e.reversed_by ? ` ${pill('cancelled')}` : ''}<div class="muted" style="font-size:13px">${dt(e.date)} · ${esc(e.user_name || '')}${e.ref ? ` · ${esc(e.ref)}` : ''}</div></div>
      <div class="row"><b class="num">${money(e.amount)}</b>${can('accounting') && e.source_type === 'manual' && !e.reversed_by && !e.reversal_of ? `<button class="btn sm ghost" data-rev="${e.id}">${L('Contre-passer', 'Reverse')}</button>` : ''}</div></div>
      <table class="tbl" style="margin-top:8px">${e.lines.map((l) => `<tr><td class="mono" style="width:80px">${l.account_code}</td><td>${esc(l.account_name || '')}${l.partner_name ? ` <span class="muted">· ${esc(l.partner_name)}</span>` : ''}</td><td class="r num" style="width:130px">${l.debit ? num(l.debit) : ''}</td><td class="r num" style="width:130px">${l.credit ? num(l.credit) : ''}</td></tr>`).join('')}</table></div>`).join('')
      : `<div class="card empty"><b>${L('Aucune écriture sur la période', 'No entries in this period')}</b>${L('Les factures, paiements et dépenses passent leurs écritures automatiquement.', 'Invoices, payments and expenses post their entries automatically.')}</div>`}`;
  wirePeriod(ctx);
  ctx.el.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDlg(L('Contre-passer', 'Reverse'), L('Une écriture inverse sera passée à la date du jour.', 'A mirror entry will be posted today.'), L('Contre-passer', 'Reverse'), true)) return;
    try { await api.post(`/api/entries/${b.dataset.rev}/reverse`, {}); ctx.rerender(); } catch (e) { showError(e); }
  }));
}

export async function entryEditor(ctx) {
  ctx.title(L('Nouvelle écriture', 'New entry'));
  const [accounts, clients, suppliers] = await Promise.all([api.get('/api/accounts'), api.get('/api/partners?kind=client'), api.get('/api/partners?kind=supplier')]);
  const partners = [...clients, ...suppliers];
  let lines = [{ account: '', debit: '', credit: '' }, { account: '', debit: '', credit: '' }];
  ctx.el.innerHTML = `<datalist id="accs">${accounts.map((a) => `<option value="${a.code}">${a.code} – ${esc(a.name)}</option>`).join('')}</datalist>
  <form id="ef" class="stack"><div class="card"><div class="f3">
    ${field({ name: 'journal', label: L('Journal', 'Journal'), type: 'select', options: [['OD', L('OD – Opérations diverses', 'OD – Miscellaneous')], ['AN', L('AN – À-nouveaux (soldes d\'ouverture)', 'AN – Opening balances')], ['BQ', 'BQ – Banque'], ['CA', 'CA – Caisse'], ['MM', 'MM – Mobile Money']] })}
    ${field({ name: 'date', label: L('Date', 'Date'), type: 'date', value: today(), required: true })}${field({ name: 'ref', label: L('Pièce / référence', 'Reference') })}
    ${field({ name: 'label', label: L('Libellé', 'Label'), required: true, span: true, placeholder: L('Ex. Apport en capital, dotation aux amortissements…', 'e.g. Capital contribution, depreciation…') })}</div></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>${L('Compte', 'Account')}</th><th class="hide-m">${L('Tiers', 'Party')}</th><th>${L('Libellé', 'Label')}</th><th class="r">${L('Débit', 'Debit')}</th><th class="r">${L('Crédit', 'Credit')}</th><th></th></tr></thead><tbody id="el"></tbody>
    <tfoot><tr class="tot"><td colspan="2" class="hide-m"></td><td id="diff"></td><td class="r num" id="td"></td><td class="r num" id="tc"></td><td></td></tr></tfoot></table></div>
    <div class="row" style="margin-top:10px"><button type="button" class="btn sm" id="add">${icon('plus')}${L('Ligne', 'Line')}</button></div></div>
    <div class="row" style="justify-content:flex-end"><a class="btn" href="#/entries">${L('Annuler', 'Cancel')}</a><button class="btn primary">${L('Passer l\'écriture', 'Post entry')}</button></div></form>`;
  const tb = ctx.el.querySelector('#el');
  const draw = () => {
    tb.innerHTML = lines.map((l, i) => `<tr data-i="${i}"><td><input class="in mono" list="accs" data-k="account" value="${esc(l.account)}" style="min-width:90px" required></td>
      <td class="hide-m"><select class="in" data-k="partner_id"><option value="">—</option>${partners.map((p) => `<option value="${p.id}" ${String(p.id) === String(l.partner_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
      <td><input class="in" data-k="label" value="${esc(l.label || '')}"></td><td><input class="in r" type="number" min="0" step="1" data-k="debit" value="${esc(l.debit)}" style="min-width:100px"></td>
      <td><input class="in r" type="number" min="0" step="1" data-k="credit" value="${esc(l.credit)}" style="min-width:100px"></td><td><button type="button" class="btn ghost sm" data-del="${i}">${icon('x')}</button></td></tr>`).join('');
    sum();
  };
  const sum = () => {
    const d = lines.reduce((s, l) => s + (+l.debit || 0), 0), c = lines.reduce((s, l) => s + (+l.credit || 0), 0);
    ctx.el.querySelector('#td').textContent = num(d); ctx.el.querySelector('#tc').textContent = num(c);
    ctx.el.querySelector('#diff').innerHTML = d === c ? `<span class="pill ok">${L('Équilibrée', 'Balanced')}</span>` : `<span class="pill bad">${L('Écart', 'Difference')} ${num(d - c)}</span>`;
  };
  tb.addEventListener('input', (e) => { const tr = e.target.closest('tr'); lines[tr.dataset.i][e.target.dataset.k] = e.target.value; sum(); });
  tb.addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b && lines.length > 2) { lines.splice(+b.dataset.del, 1); draw(); } });
  ctx.el.querySelector('#add').addEventListener('click', () => { lines.push({ account: '', debit: '', credit: '' }); draw(); });
  ctx.el.querySelector('#ef').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api.post('/api/entries', { journal: f.journal.value, date: f.date.value, ref: f.ref.value, label: f.label.value, lines: lines.map((l) => ({ ...l, debit: Math.round(+l.debit || 0), credit: Math.round(+l.credit || 0) })) }, { label: `Écriture ${f.label.value}` });
      toast(r._queued ? L('Enregistrée sur le téléphone', 'Saved on this device') : `${L('Écriture', 'Entry')} ${r.number}`, 'ok');
      location.hash = '#/entries';
    } catch (err) { showError(err); }
  });
  draw();
}

export async function accountList(ctx) {
  ctx.title(L('Plan comptable SYSCOHADA', 'SYSCOHADA chart of accounts'));
  ctx.actions(`<a class="btn hide-m" href="/api/export/accounts">${icon('download')}Excel</a>${can('accounting') ? `<button class="btn primary" id="add">${icon('plus')}${L('Compte', 'Account')}</button>` : ''}`);
  const rows = await api.get('/api/accounts');
  const classes = state.meta?.classes || {};
  const draw = (q = '') => {
    const f = rows.filter((a) => !q || a.code.startsWith(q) || a.name.toLowerCase().includes(q.toLowerCase()));
    let html = '', cur = null;
    for (const a of f) {
      if (a.class !== cur) { cur = a.class; html += `<tr class="sec"><td colspan="3">${L('Classe', 'Class')} ${cur} – ${esc(classes[cur] || '')}</td></tr>`; }
      html += `<tr><td class="mono">${a.code}</td><td>${esc(a.name)}</td><td class="r num">${a.balance ? `<a href="#/report/general-ledger?account=${a.code}&from=2000-01-01">${num(a.balance)}</a>` : ''}</td></tr>`;
    }
    ctx.el.querySelector('#t').innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${L('Compte', 'Account')}</th><th>${L('Intitulé', 'Name')}</th><th class="r">${L('Solde (D − C)', 'Balance (D − C)')}</th></tr></thead><tbody>${html}</tbody></table></div>`;
  };
  ctx.el.innerHTML = `<div class="filters"><input type="search" class="in" id="q" placeholder="${L('N° ou intitulé', 'Number or name')}"></div><div id="t"></div>`;
  ctx.el.querySelector('#q').addEventListener('input', (e) => draw(e.target.value));
  document.getElementById('add')?.addEventListener('click', async () => {
    const ok = await dialog({ title: L('Nouveau compte', 'New account'), body: `<div class="form">${field({ name: 'code', label: L('Numéro', 'Number'), required: true, hint: L('Sous-compte d\'un compte existant, ex. 5212 (2e banque), 4111 (client important)', 'Sub-account of an existing one, e.g. 5212 (2nd bank)') })}${field({ name: 'name', label: L('Intitulé', 'Name'), required: true })}</div>`, onSubmit: (v) => api.post('/api/accounts', v) });
    if (ok) { state.meta = await api.get('/api/accounting/meta'); ctx.rerender(); }
  });
  draw();
}

// ===================== Reports =====================
const REPORTS = [
  ['balance-sheet', 'Bilan', 'Balance sheet', 'Actif et passif à une date', 'Assets and liabilities at a date'],
  ['income-statement', 'Compte de résultat', 'Income statement', 'Produits, charges et résultat net', 'Income, expenses and net result'],
  ['trial-balance', 'Balance générale', 'Trial balance', 'Soldes de tous les comptes (6 colonnes)', 'All account balances (6 columns)'],
  ['general-ledger', 'Grand livre', 'General ledger', 'Détail des mouvements par compte', 'Movements by account'],
  ['journal', 'Journaux', 'Journals', 'Écritures par journal (VT, AC, BQ, CA, MM, OD)', 'Entries by journal'],
  ['vat', 'Déclaration de TVA', 'VAT return', 'TVA collectée, déductible, à payer (17,5 % + CAC)', 'VAT collected, deductible, due'],
  ['aged-receivables', 'Balance âgée clients', 'Aged receivables', 'Qui vous doit, et depuis combien de temps', 'Who owes you and for how long'],
  ['aged-payables', 'Balance âgée fournisseurs', 'Aged payables', 'Ce que vous devez à vos fournisseurs', 'What you owe suppliers'],
];
export async function reportsHub(ctx) {
  ctx.title(L('États financiers', 'Financial reports'));
  ctx.el.innerHTML = `<div class="grid g3">${REPORTS.map(([id, fr, en, dfr, den]) => `<a class="card" href="#/report/${id}"><h3 style="margin-bottom:4px">${esc(L(fr, en))}</h3><div class="muted">${esc(L(dfr, den))}</div></a>`).join('')}</div>
  <p class="muted" style="margin-top:16px">${L('Chaque état s\'exporte en Excel et en PDF pour votre expert-comptable ou la DSF.', 'Every report exports to Excel and PDF for your accountant or the annual tax filing (DSF).')}</p>`;
}

export async function reportView(ctx) {
  const name = ctx.params.name;
  const R = REPORTS.find((r) => r[0] === name);
  if (!R) { location.hash = '#/reports'; return; }
  ctx.title(L(R[1], R[2]));
  const atDate = ['balance-sheet', 'aged-receivables', 'aged-payables'].includes(name);
  const q = { from: ctx.query.from || yearStart(), to: ctx.query.to || today(), account: ctx.query.account || '', journal: ctx.query.journal || '' };
  const params = atDate ? { to: q.to } : { from: q.from, to: q.to, account: q.account, journal: q.journal };
  ctx.actions(`<a class="btn" target="_blank" href="/print/report/${name}${qs(params)}">${icon('print')}PDF</a><a class="btn" href="/api/reports/${name}${qs({ ...params, format: 'xlsx' })}">${icon('download')}Excel</a>`);
  const d = await api.get(`/api/reports/${name}${qs(params)}`);
  const filt = atDate ? `<form class="filters" id="pf"><label class="fld">${L('Au', 'As at')}<input class="in" type="date" name="to" value="${esc(q.to)}"></label></form>`
    : periodFilter(ctx, q, name === 'general-ledger' ? `<input class="in mono" name="account" value="${esc(q.account)}" placeholder="${L('Compte (ex. 411)', 'Account (e.g. 411)')}" style="width:150px">` : '');
  let body = '';
  if (name === 'trial-balance') {
    body = `${d.balanced ? `<span class="pill ok">${L('Balance équilibrée', 'Balanced')}</span>` : `<span class="pill bad">${L('Déséquilibre', 'Out of balance')}</span>`}<div style="height:10px"></div>` + table({ rows: d.rows, columns: [
      { label: L('Compte', 'Account'), render: (r) => `<a class="mono" href="#/report/general-ledger${qs({ account: r.code, from: q.from, to: q.to })}">${r.code}</a>` }, { label: L('Intitulé', 'Name'), key: 'name' },
      { label: L('Débit', 'Debit'), cls: 'r num', render: (r) => num(r.debit) }, { label: L('Crédit', 'Credit'), cls: 'r num', render: (r) => num(r.credit) },
      { label: L('Solde D', 'Bal. D'), cls: 'r num', render: (r) => (r.close_debit ? num(r.close_debit) : '') }, { label: L('Solde C', 'Bal. C'), cls: 'r num', render: (r) => (r.close_credit ? num(r.close_credit) : '') }],
      foot: `<tr class="tot"><td colspan="2">Total</td><td class="r num">${num(d.total.debit)}</td><td class="r num">${num(d.total.credit)}</td><td class="r num">${num(d.total.close_debit)}</td><td class="r num">${num(d.total.close_credit)}</td></tr>` });
  } else if (name === 'general-ledger') {
    body = d.accounts.length ? d.accounts.map((a) => `<h3>${a.code} – ${esc(a.name)}</h3>` + table({ rows: a.lines, columns: [
      { label: L('Date', 'Date'), render: (l) => dt(l.date) }, { label: L('Pièce', 'Ref'), render: (l) => `<span class="mono">${esc(l.number)}</span>` },
      { label: L('Libellé', 'Label'), render: (l) => `${esc(l.label)}${l.partner_name ? ` <span class="muted">· ${esc(l.partner_name)}</span>` : ''}` },
      { label: L('Débit', 'Debit'), cls: 'r num', render: (l) => (l.debit ? num(l.debit) : '') }, { label: L('Crédit', 'Credit'), cls: 'r num', render: (l) => (l.credit ? num(l.credit) : '') }, { label: L('Solde', 'Balance'), cls: 'r num', render: (l) => num(l.balance) }],
      foot: `${a.opening ? `<tr><td colspan="5" class="muted">${L('Solde à nouveau', 'Opening balance')}</td><td class="r num">${num(a.opening)}</td></tr>` : ''}<tr class="tot"><td colspan="3">Total ${a.code}</td><td class="r num">${num(a.debit)}</td><td class="r num">${num(a.credit)}</td><td class="r num">${num(a.balance)}</td></tr>` })).join('<div style="height:12px"></div>')
      : `<div class="card empty"><b>${L('Aucun mouvement', 'No movements')}</b></div>`;
  } else if (name === 'journal') {
    location.hash = `#/entries${qs({ from: q.from, to: q.to })}`; return;
  } else if (name === 'balance-sheet') {
    const side = (secs, label, total) => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${label}</th><th class="r">Net (FCFA)</th></tr></thead><tbody>${secs.map((s) => `<tr class="sec"><td>${esc(s.section)}</td><td class="r num">${num(s.total)}</td></tr>${s.items.filter((i) => i.value).map((i) => `<tr><td style="padding-left:24px">${esc(i.label)}</td><td class="r num">${num(i.value)}</td></tr>`).join('')}`).join('')}<tr class="tot"><td>Total</td><td class="r num">${num(total)}</td></tr></tbody></table></div>`;
    body = `${d.balanced ? `<span class="pill ok">${L('Actif = Passif', 'Assets = Liabilities')}</span>` : `<span class="pill bad">${L('Écart', 'Difference')}</span>`} <span class="muted">${L('Résultat de la période (non clôturé)', 'Result not yet closed')} : <b>${money(d.result)}</b></span>
      <div class="grid g2" style="margin-top:12px">${side(d.actif, L('Actif', 'Assets'), d.total_actif)}${side(d.passif, L('Passif', 'Liabilities & equity'), d.total_passif)}</div>`;
  } else if (name === 'income-statement') {
    const t = d.totals; const Lk = Object.fromEntries(d.lines.map((l) => [l.key, l]));
    const row = (k) => (Lk[k].value ? `<tr><td class="mono dim">${Lk[k].ref}</td><td>${esc(Lk[k].label)}</td><td class="r num">${num(Lk[k].value)}</td></tr>` : '');
    const tot = (l, v) => `<tr class="sec"><td></td><td>${l}</td><td class="r num">${num(v)}</td></tr>`;
    body = `<div class="grid g4" style="margin-bottom:14px"><div class="card kpi"><div class="l">${L("Chiffre d'affaires", 'Revenue')}</div><div class="v">${money(t.revenue)}</div></div><div class="card kpi"><div class="l">${L('Valeur ajoutée', 'Value added')}</div><div class="v">${money(t.added_value)}</div></div>
      <div class="card kpi"><div class="l">EBE</div><div class="v">${money(t.ebe)}</div></div><div class="card kpi accent"><div class="l">${L('Résultat net', 'Net result')}</div><div class="v">${money(t.net)}</div></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${L('Comptes', 'Accounts')}</th><th>${L('Libellé', 'Line')}</th><th class="r">FCFA</th></tr></thead><tbody>
      ${['TA', 'RA', 'RB'].map(row).join('')}${tot(L('Marge commerciale', 'Gross margin'), t.margin)}${['TB', 'TC', 'TD', 'TDR', 'TF', 'TG', 'RC', 'RE', 'RF', 'RG', 'RH'].map(row).join('')}${tot(L('Valeur ajoutée', 'Value added'), t.added_value)}
      ${row('RI')}${tot(L("Excédent brut d'exploitation", 'EBITDA'), t.ebe)}${['TJ', 'RL'].map(row).join('')}${tot(L("Résultat d'exploitation", 'Operating result'), t.operating)}${['TK', 'RM'].map(row).join('')}${tot(L('Résultat financier', 'Financial result'), t.financial)}
      ${['TN', 'RO'].map(row).join('')}${tot(L('Résultat HAO', 'Non-ordinary result'), t.hao)}${row('RS')}<tr class="tot"><td></td><td>${L('Résultat net', 'Net result')}</td><td class="r num">${num(t.net)}</td></tr></tbody></table></div>`;
  } else if (name === 'vat') {
    body = `<div class="grid g3"><div class="card kpi"><div class="l">${L('TVA collectée', 'VAT collected')}</div><div class="v">${money(d.collected)}</div><div class="s">${L('dont principal', 'principal')} ${num(d.collected_split.principal)} · CAC ${num(d.collected_split.cac)}</div></div>
      <div class="card kpi"><div class="l">${L('TVA déductible', 'VAT deductible')}</div><div class="v">${money(d.deductible)}</div></div>
      <div class="card kpi accent"><div class="l">${d.credit ? L('Crédit de TVA', 'VAT credit') : L('TVA à payer', 'VAT due')}</div><div class="v">${money(d.credit || d.due)}</div>${d.due ? `<div class="s">${L('principal', 'principal')} ${num(d.due_split.principal)} · CAC ${num(d.due_split.cac)}</div>` : ''}</div></div>
      <h3 style="margin-top:18px">${L('Ventes par taux', 'Sales by rate')}</h3>${table({ rows: d.sales, columns: [{ label: L('Taux', 'Rate'), render: (s) => `${+s.rate} %` }, { label: L('Base HT', 'Net base'), cls: 'r num', render: (s) => num(s.base) }, { label: 'TVA', cls: 'r num', render: (s) => num(s.vat) }] })}
      <h3 style="margin-top:18px">${L('Achats par taux', 'Purchases by rate')}</h3>${table({ rows: [...d.purchases.map((s) => ({ ...s, o: L('Factures fournisseurs', 'Supplier bills') })), { o: L('Dépenses', 'Expenses'), rate: '', ...d.expenses }], columns: [{ label: L('Origine', 'Source'), key: 'o' }, { label: L('Taux', 'Rate'), render: (s) => (s.rate === '' ? '' : `${+s.rate} %`) }, { label: L('Base HT', 'Net base'), cls: 'r num', render: (s) => num(s.base) }, { label: 'TVA', cls: 'r num', render: (s) => num(s.vat) }] })}
      <p class="muted">${L('À reporter sur votre déclaration mensuelle (avant le 15 du mois suivant). Vérifiez avec votre centre des impôts.', 'Report on your monthly return (before the 15th of the next month). Check with your tax office.')}</p>
      ${can('accounting') ? `<button class="btn" id="vatset">${L('Passer l\'écriture de liquidation au', 'Post the VAT settlement at')} ${dt(q.to)}</button> <span class="muted">${L('Solde les comptes 443 et 445 vers 4441 (TVA due) ou 4449 (crédit). Payez ensuite la TVA par une écriture de banque.', 'Clears 443 and 445 into 4441 (due) or 4449 (credit).')}</span>` : ''}`;
  } else {
    const B = [['current', L('Non échu', 'Not due')], ['d30', '1–30 j'], ['d60', '31–60 j'], ['d90', '61–90 j'], ['over90', '+90 j']];
    body = table({ rows: d.rows, href: (r) => `/partner/${r.partner_id}`, columns: [{ label: L('Tiers', 'Party'), render: (r) => `<b>${esc(r.partner_name)}</b><div class="muted">${esc(r.partner_phone || '')}</div>` },
      ...B.map(([k, l]) => ({ label: l, cls: 'r num', hideM: k !== 'over90', render: (r) => (r[k] ? num(r[k]) : '') })), { label: 'Total', cls: 'r num', render: (r) => `<b>${num(r.total)}</b>` }],
      foot: `<tr class="tot"><td>Total</td>${B.map(([k]) => `<td class="r num ${k !== 'over90' ? 'hide-m' : ''}">${num(d.total[k])}</td>`).join('')}<td class="r num">${num(d.total.total)}</td></tr>`,
      empty: `<b>${L('Rien d\'impayé', 'Nothing outstanding')}</b>` });
  }
  ctx.el.innerHTML = filt + body;
  wirePeriod(ctx);
  ctx.el.querySelector('#vatset')?.addEventListener('click', async () => {
    if (!await confirmDlg(L('Liquidation de la TVA', 'VAT settlement'), L('Une écriture OD soldera la TVA collectée et déductible à cette date.', 'An OD entry will clear collected and deductible VAT at this date.'), L('Passer l\'écriture', 'Post entry'))) return;
    try { const r = await api.post('/api/accounting/vat-settlement', { to: q.to }); toast(`${L('TVA à payer', 'VAT due')} : ${money(r.due)}${r.credit ? ` · ${L('crédit', 'credit')} ${money(r.credit)}` : ''}`, 'ok'); } catch (e) { showError(e); }
  });
}
