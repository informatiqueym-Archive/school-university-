// Customer payment page: each unpaid invoice gets a private link (and a QR code
// on the PDF). The customer opens it on their phone, picks MTN MoMo or Orange
// Money (guessed from their number), confirms with their PIN, and the invoice is
// settled automatically. If the prompt doesn't arrive, the page shows how to pay
// the merchant number by USSD and lets the customer declare the payment.
import crypto from 'node:crypto';
import { notFound, HttpError, bad } from '../../core/errors.js';
import { str, oneOf } from '../../core/validate.js';
import { raiseAlert } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { normalizePhone, guessProvider, PROVIDERS } from '../../core/payments/mobile-money.js';
import { startMomo, checkPending } from './treasury.js';
import { getDocument } from './documents.js';
import { renderDocument } from './print.js';

export function payToken(db, docId) {
  const d = db.get('SELECT pay_token FROM documents WHERE id = ?', docId);
  if (d?.pay_token) return d.pay_token;
  const t = crypto.randomBytes(18).toString('base64url');
  db.run('UPDATE documents SET pay_token = ? WHERE id = ?', t, docId);
  return t;
}

export function baseUrl(ctx, env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, '');
  const proto = String(ctx.req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host}`;
}

// Simple per-link throttle so a link can't be used to spam phones.
const hits = new Map();
function throttle(key, max, windowMs) {
  const now = Date.now();
  const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (h.length >= max) throw new HttpError(429, 'rate', 'Trop de tentatives. Patientez quelques minutes.');
  h.push(now); hits.set(key, h);
}

function load(db, token) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token || '')) throw notFound('Lien invalide');
  const row = db.get("SELECT id, company_id FROM documents WHERE pay_token = ? AND kind = 'invoice'", token);
  if (!row) throw notFound('Lien de paiement introuvable ou expiré');
  const company = db.get('SELECT * FROM companies WHERE id = ?', row.company_id);
  return { company, doc: getDocument(db, row.company_id, row.id) };
}

function publicView(db, company, d, momo) {
  const last = db.get("SELECT id, status, method, amount, failure_reason, created_at FROM payments WHERE document_id = ? AND (notes LIKE 'Payé par le client%' OR status = 'pending') ORDER BY id DESC LIMIT 1", d.id);
  return {
    company: { name: company.name, logo: company.logo, phone: company.phone, city: company.city, momo_number: company.momo_number, om_number: company.om_number },
    invoice: { number: d.number, date: d.date, due_date: d.due_date, subject: d.subject, partner_name: d.partner_name, partner_phone: d.partner_phone, total: d.total, balance: d.balance, status: d.status,
      lines: d.lines.map((l) => ({ description: l.description, qty: l.qty, total: l.total })) },
    last, momo: { demo: momo.mode === 'simulation', mtn_momo: momo.configured('mtn_momo'), orange_money: momo.configured('orange_money') },
  };
}

export function registerPayLink(r, { db, bus, momo, env }) {
  // Staff: create or fetch the link of an invoice
  r.post('/api/documents/:id/pay-link', (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'auth', 'Connexion requise');
    const d = db.get("SELECT * FROM documents WHERE id = ? AND company_id = ? AND kind = 'invoice'", ctx.params.id, ctx.user.company_id);
    if (!d) throw notFound('Facture introuvable');
    if (d.status === 'draft') throw bad('draft', 'Validez la facture avant de partager le lien de paiement');
    const token = payToken(db, d.id);
    return { token, url: `${baseUrl(ctx, env)}/pay/${token}` };
  });

  // Customer (no sign-in)
  r.get('/api/public/pay/:token', (ctx) => { const { company, doc } = load(db, ctx.params.token); return publicView(db, company, doc, momo); });
  r.get('/api/public/pay/:token/status', async (ctx) => {
    const { company, doc } = load(db, ctx.params.token);
    const pend = db.get("SELECT id FROM payments WHERE document_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1", doc.id);
    if (pend) { try { throttle('st:' + ctx.params.token, 30, 60e3); await checkPending(db, bus, momo, { paymentId: pend.id }); } catch {} }
    const fresh = load(db, ctx.params.token);
    return publicView(db, company, fresh.doc, momo);
  });
  r.post('/api/public/pay/:token/momo', async (ctx) => {
    const { company, doc } = load(db, ctx.params.token);
    throttle('pay:' + ctx.params.token, 6, 30 * 60e3);
    const phone = normalizePhone(ctx.body.phone);
    const provider = oneOf(ctx.body.provider || guessProvider(phone), Object.keys(PROVIDERS), 'provider');
    const id = await startMomo(db, momo, company, db.get('SELECT * FROM documents WHERE id = ?', doc.id), { provider, phone, replaceStale: true });
    bus.emit(company.id, 'change', { entity: 'payment', id });
    return ctx.json({ ok: true, payment_id: id }, 201);
  });
  r.post('/api/public/pay/:token/declare', (ctx) => {
    const { company, doc } = load(db, ctx.params.token);
    throttle('decl:' + ctx.params.token, 3, 60 * 60e3);
    const provider = oneOf(ctx.body.provider, Object.keys(PROVIDERS), 'provider');
    const reference = str(ctx.body.reference, 60);
    if (!reference) throw bad('reference', "Indiquez l'identifiant de la transaction reçu par SMS");
    raiseAlert(db, bus, company.id, {
      kind: 'payment_declared', level: 'warning', title: `${doc.partner_name} déclare avoir payé ${doc.number}`,
      body: `${PROVIDERS[provider].fr}, réf. ${reference}${ctx.body.phone ? `, depuis le ${str(ctx.body.phone, 20)}` : ''}${ctx.body.amount ? `, ${fcfa(Number(ctx.body.amount) || 0)}` : ''}. Vérifiez sur votre compte marchand puis enregistrez l'encaissement.`,
      entity: 'document', entity_id: doc.id,
    });
    return { ok: true };
  });
  r.get('/pay/:token/invoice', (ctx) => {
    const { company, doc } = load(db, ctx.params.token);
    ctx.send(renderDocument(company, doc, { lang: ctx.query.lang === 'en' ? 'en' : 'fr' }));
  });
  r.get('/pay/:token', (ctx) => {
    load(db, ctx.params.token);
    ctx.send(PAGE, 'text/html; charset=utf-8', 200, { 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  });
}

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Paiement de facture</title><meta name="theme-color" content="#0B1433">
<style>
:root{--navy:#0B1433;--blue:#2F6BFF;--ink:#0E1633;--muted:#58607A;--line:#E3E7F0;--bg:#F3F5FA;--ok:#14915F;--bad:#C93636;--mtn:#FFCC00;--orange:#FF7900}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink)}
.wrap{max-width:460px;margin:0 auto;padding:16px}
.hd{background:var(--navy);color:#fff;padding:22px 16px 64px;text-align:center}.hd img{max-height:44px;max-width:160px;background:#fff;border-radius:8px;padding:4px;margin-bottom:8px}
.hd b{display:block;font-size:18px}.hd small{color:#AFC0EE}
.card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px;margin-top:-48px;box-shadow:0 10px 30px rgba(11,20,51,.08)}
.amt{font-size:34px;font-weight:800;text-align:center;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.sub{text-align:center;color:var(--muted);font-size:14px}
.lines{margin:14px 0 0;padding:12px 0 0;border-top:1px dashed var(--line);font-size:14px}.lines div{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
h2{font-size:16px;margin:22px 0 10px}
.ops{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.op{border:2px solid var(--line);background:#fff;border-radius:14px;padding:14px 8px;font:700 15px system-ui;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px}
.op i{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-style:normal;font-weight:900;font-size:13px}
.op.mtn i{background:var(--mtn);color:#000}.op.om i{background:var(--orange);color:#fff}
.op.on{border-color:var(--blue);box-shadow:0 0 0 3px #DCE6FF}
label{display:block;font-size:14px;font-weight:600;color:var(--muted);margin:14px 0 6px}
input{width:100%;font-size:20px;padding:12px 14px;border:1px solid #CDD4E3;border-radius:12px;letter-spacing:.04em}
input:focus{outline:3px solid #DCE6FF;border-color:var(--blue)}
.btn{width:100%;margin-top:14px;border:0;border-radius:14px;padding:16px;font:700 17px system-ui;background:var(--blue);color:#fff;cursor:pointer}
.btn:disabled{opacity:.55}.btn.ghost{background:none;color:var(--blue);padding:10px;font-size:15px}
.note{font-size:13.5px;color:var(--muted);margin-top:10px;text-align:center}
.st{text-align:center;padding:10px 0}.st .big{font-size:20px;font-weight:800;margin:8px 0 4px}
.spin{width:44px;height:44px;border:4px solid #DCE6FF;border-top-color:var(--blue);border-radius:50%;margin:6px auto;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
.ok{color:var(--ok)}.err{color:var(--bad)}.box{background:#F7F8FC;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:14px;margin-top:10px}
.box code{font:700 15px ui-monospace,Menlo,monospace}.demo{background:#FFF4DE;color:#7A4800;border-radius:10px;padding:8px 12px;font-size:13px;margin-top:12px;text-align:center}
.foot{text-align:center;color:var(--muted);font-size:12.5px;margin:22px 0}.foot a{color:var(--blue)}
[hidden]{display:none!important}
</style></head><body>
<div class="hd" id="hd"></div>
<div class="wrap"><div class="card" id="app"><div class="spin"></div></div><div class="foot" id="foot"></div></div>
<script>
const T = location.pathname.split('/')[2];
const en = new URLSearchParams(location.search).get('lang') === 'en';
const L = (fr, e) => en ? e : fr;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n) => Math.round(n).toLocaleString('fr-FR').replace(/\\s/g, '\\u202f') + '\\u00a0FCFA';
const guess = (v) => { const n = v.replace(/\\D/g, '').replace(/^237/, ''); if (/^(69|65[5-9]|68[6-9])/.test(n)) return 'orange_money'; if (/^(67|65[0-4]|68[0-3])/.test(n)) return 'mtn_momo'; return null; };
let data, op = null, poll = null, retrying = false;
const api = async (p, body) => { const r = await fetch('/api/public/pay/' + T + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'Erreur'); return j; };
function head() {
  const c = data.company;
  document.getElementById('hd').innerHTML = (c.logo ? '<img src="' + esc(c.logo) + '" alt="">' : '') + '<b>' + esc(c.name) + '</b><small>' + L('Facture', 'Invoice') + ' ' + esc(data.invoice.number) + ' · ' + esc(data.invoice.partner_name) + '</small>';
  document.getElementById('foot').innerHTML = '<a href="/pay/' + T + '/invoice' + (en ? '?lang=en' : '') + '" target="_blank">' + L('Voir la facture (PDF)', 'View invoice (PDF)') + '</a> · <a href="?lang=' + (en ? 'fr' : 'en') + '">' + (en ? 'Français' : 'English') + '</a>' + (c.phone ? '<br>' + L('Une question ?', 'Questions?') + ' <a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a>' : '') + '<br>' + L('Paiement sécurisé par', 'Secure payment by') + ' Teknons';
}
function summary() {
  const i = data.invoice;
  return '<div class="sub">' + L('Montant à payer', 'Amount due') + '</div><div class="amt">' + money(i.balance) + '</div>' + (i.balance !== i.total ? '<div class="sub">' + L('sur', 'of') + ' ' + money(i.total) + '</div>' : '') +
    '<div class="lines">' + i.lines.slice(0, 6).map((l) => '<div><span>' + esc(l.description) + (l.qty != 1 ? ' × ' + (+l.qty) : '') + '</span><span>' + money(l.total) + '</span></div>').join('') + (i.lines.length > 6 ? '<div><span>…</span></div>' : '') + '</div>';
}
function render() {
  const i = data.invoice, el = document.getElementById('app');
  if (i.status === 'paid' || i.balance <= 0) { stop(); el.innerHTML = '<div class="st"><div style="font-size:54px">✅</div><div class="big ok">' + L('Facture payée', 'Invoice paid') + '</div><div class="sub">' + L('Merci ! ' + esc(data.company.name) + ' a bien reçu votre paiement.', 'Thank you! ' + esc(data.company.name) + ' has received your payment.') + '</div></div>'; return; }
  if (i.status === 'cancelled') { el.innerHTML = '<div class="st"><div class="big">' + L('Facture annulée', 'Invoice cancelled') + '</div></div>'; return; }
  const last = data.last;
  if (last && last.status === 'pending' && !retrying) return waiting(last);
  const phone = (document.getElementById('ph') || {}).value ?? (i.partner_phone || '');
  op = op || guess(phone);
  const avail = data.momo;
  el.innerHTML = summary() +
    (last && last.status === 'failed' && Date.now() - Date.parse(last.created_at) < 15 * 60e3 ? '<div class="box err">' + L('Le dernier paiement n\\'a pas abouti', 'The last payment did not go through') + (last.failure_reason ? ' : ' + esc(last.failure_reason) : '') + '. ' + L('Vous pouvez réessayer.', 'You can try again.') + '</div>' : '') +
    '<h2>' + L('Choisissez votre moyen de paiement', 'Choose how to pay') + '</h2><div class="ops">' +
    (avail.mtn_momo ? '<button class="op mtn ' + (op === 'mtn_momo' ? 'on' : '') + '" data-op="mtn_momo"><i>MTN</i>MTN MoMo</button>' : '') +
    (avail.orange_money ? '<button class="op om ' + (op === 'orange_money' ? 'on' : '') + '" data-op="orange_money"><i>OM</i>Orange Money</button>' : '') + '</div>' +
    '<label for="ph">' + L('Votre numéro Mobile Money', 'Your Mobile Money number') + '</label><input id="ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="6XX XX XX XX" value="' + esc(phone) + '">' +
    '<button class="btn" id="pay">' + L('Payer', 'Pay') + ' ' + money(i.balance) + '</button>' +
    '<div class="note">' + L('Vous recevrez une demande sur votre téléphone. Validez avec votre code secret.', 'You will get a prompt on your phone. Confirm with your PIN.') + '</div>' +
    (data.momo.demo ? '<div class="demo">' + L('Mode démonstration : aucun argent n\\'est prélevé.', 'Demo mode: no money is taken.') + '</div>' : '') +
    manual();
  el.querySelectorAll('[data-op]').forEach((b) => b.onclick = () => { op = b.dataset.op; render(); });
  const ph = el.querySelector('#ph');
  ph.oninput = () => { const g = guess(ph.value); if (g && g !== op) { op = g; const v = ph.value; render(); const n = document.getElementById('ph'); n.value = v; n.focus(); } };
  el.querySelector('#pay').onclick = pay;
  wireManual();
}
function manual() {
  const c = data.company;
  if (!c.momo_number && !c.om_number) return '';
  return '<button class="btn ghost" id="man">' + L('Pas de demande reçue ? Payer manuellement', 'No prompt? Pay manually') + '</button><div id="manbox" hidden>' +
    (c.momo_number ? '<div class="box"><b>MTN MoMo</b> : ' + L('composez', 'dial') + ' <code>*126#</code> → ' + L('transfert vers', 'transfer to') + ' <code>' + esc(c.momo_number) + '</code></div>' : '') +
    (c.om_number ? '<div class="box"><b>Orange Money</b> : ' + L('composez', 'dial') + ' <code>#150#</code> → ' + L('transfert vers', 'transfer to') + ' <code>' + esc(c.om_number) + '</code></div>' : '') +
    '<div class="box">' + L('Motif / référence', 'Reference') + ' : <code>' + esc(data.invoice.number) + '</code> · ' + L('Montant', 'Amount') + ' : <code>' + money(data.invoice.balance) + '</code></div>' +
    '<label for="ref">' + L('Après le transfert, entrez l\\'ID de transaction reçu par SMS', 'After the transfer, enter the transaction ID from the SMS') + '</label><input id="ref" placeholder="ex. 7845123690">' +
    '<button class="btn" id="decl">' + L('J\\'ai payé', 'I have paid') + '</button></div>';
}
function wireManual() {
  const m = document.getElementById('man'); if (!m) return;
  m.onclick = () => { document.getElementById('manbox').hidden = false; m.hidden = true; };
  document.getElementById('decl').onclick = async () => {
    const ref = document.getElementById('ref').value.trim(); if (!ref) return alert(L('Entrez l\\'ID de transaction', 'Enter the transaction ID'));
    try { await api('/declare', { provider: op || 'mtn_momo', reference: ref, phone: document.getElementById('ph').value, amount: data.invoice.balance });
      document.getElementById('app').innerHTML = '<div class="st"><div style="font-size:48px">📨</div><div class="big">' + L('Merci, c\\'est noté', 'Thanks, noted') + '</div><div class="sub">' + L(esc(data.company.name) + ' va vérifier la transaction et vous confirmer le règlement.', esc(data.company.name) + ' will check the transaction and confirm.') + '</div></div>';
    } catch (e) { alert(e.message); }
  };
}
async function pay() {
  const ph = document.getElementById('ph').value;
  if (!op) return alert(L('Choisissez MTN MoMo ou Orange Money', 'Choose MTN MoMo or Orange Money'));
  if (ph.replace(/\\D/g, '').replace(/^237/, '').length !== 9) return alert(L('Numéro invalide (9 chiffres, ex. 677123456)', 'Invalid number (9 digits)'));
  const b = document.getElementById('pay'); b.disabled = true; b.textContent = L('Envoi de la demande…', 'Sending request…');
  try { await api('/momo', { provider: op, phone: ph }); retrying = false; data = await api('/status'); render(); }
  catch (e) { alert(e.message); b.disabled = false; b.textContent = L('Payer', 'Pay') + ' ' + money(data.invoice.balance); }
}
function waiting(last) {
  const code = last.method === 'orange_money' ? '#150*50#' : '*126#';
  document.getElementById('app').innerHTML = summary() + '<div class="st"><div class="spin"></div><div class="big">' + L('Confirmez sur votre téléphone', 'Confirm on your phone') + '</div>' +
    '<div class="sub">' + L('Une demande de', 'A request for') + ' <b>' + money(last.amount) + '</b> ' + L('a été envoyée. Entrez votre code secret pour valider.', 'was sent. Enter your PIN to approve.') + '</div>' +
    '<div class="box">' + L('Pas de notification ? Composez', 'No notification? Dial') + ' <code>' + code + '</code> ' + L('pour voir les paiements en attente.', 'to see pending approvals.') + '</div></div>' +
    '<button class="btn ghost" id="retry">' + L('Changer de numéro ou réessayer', 'Use another number or retry') + '</button>';
  document.getElementById('retry').onclick = () => { retrying = true; stop(); render(); };
  start();
}
function start() { if (!poll) poll = setInterval(async () => { try { const d = await api('/status'); const was = data.last && data.last.status; data = d; if (!(data.last && data.last.status === 'pending' && was === 'pending')) render(); } catch {} }, 3000); }
function stop() { clearInterval(poll); poll = null; }
api('').then((d) => { data = d; head(); render(); }).catch((e) => { document.getElementById('app').innerHTML = '<div class="st"><div class="big err">' + esc(e.message) + '</div></div>'; });
</script></body></html>`;
