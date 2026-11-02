// Printable hotel pages: registration card (fiche de police) signed at check-in,
// guest folio (pro-forma bill), booking confirmation, police register, and the
// QR cards placed in each room to open the guest app.
import { fcfa } from '../../core/format.js';
import { PAY } from './front.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const d = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '');
const n = (v) => fcfa(v).replace(' FCFA', '');
const NAVY = '#0C2D3E', ACC = '#0E8F9B';
const page = (title, body, autoPrint, extra = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;font:12.5px/1.45 "Hanken Grotesk",system-ui,Arial,sans-serif;color:#0B1F2A;background:#eef3f5}
.sheet{background:#fff;max-width:800px;margin:16px auto;padding:34px 38px;box-shadow:0 6px 24px rgba(12,45,62,.12)}
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid ${NAVY};padding-bottom:12px;margin-bottom:16px}.head h1{margin:0;font-size:20px;color:${NAVY};letter-spacing:.02em}
.stars{color:#C9A34A;letter-spacing:2px}.muted{color:#5B6E78}h2{font-size:15px;margin:18px 0 8px;color:${NAVY};text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E1E8EB;vertical-align:top}th{background:#F1F6F7;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#3E5560}
.r{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}.grid div{padding:5px 0;border-bottom:1px dotted #C9D6DB}.grid b{display:inline-block;min-width:160px;color:#3E5560;font-weight:600}
.tot td{font-weight:700;border-top:2px solid ${NAVY}}.sign{display:flex;justify-content:space-between;margin-top:36px}.sign div{width:45%;border-top:1px solid #8AA0AA;padding-top:6px;text-align:center;color:#5B6E78}
.noprint{position:sticky;top:0;display:flex;gap:8px;justify-content:center;padding:10px;background:${NAVY}}.noprint button{border:0;border-radius:8px;padding:8px 14px;background:${ACC};color:#fff;font:600 14px system-ui;cursor:pointer}
.small{font-size:11px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}.qc{border:1px solid #CFDCE0;border-radius:14px;padding:18px;text-align:center;break-inside:avoid}.qc h3{margin:4px 0;color:${NAVY};font-size:18px}.qc .q{display:flex;justify-content:center;margin:10px 0}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;padding:14mm}.noprint{display:none}}${extra}</style></head><body><div class="noprint"><button onclick="print()">Imprimer / PDF</button></div>${body}${autoPrint ? '<script>addEventListener("load",()=>setTimeout(()=>print(),400))</script>' : ''}</body></html>`;
const header = (c, s, title, right = '') => `<div class="head"><div>${c.logo ? `<img src="${esc(c.logo)}" alt="" style="max-height:52px;margin-bottom:6px"><br>` : ''}<h1>${esc(c.name)}</h1><div class="stars">${'★'.repeat(s?.stars || 0)}</div>
  <div class="muted small">${esc([c.address, c.city].filter(Boolean).join(', '))}${c.phone ? ' · ' + esc(c.phone) : ''}${c.email ? ' · ' + esc(c.email) : ''}</div>${c.niu ? `<div class="muted small">NIU ${esc(c.niu)}${c.rccm ? ' · RCCM ' + esc(c.rccm) : ''}</div>` : ''}</div>
  <div style="text-align:right"><h1 style="font-size:17px">${esc(title)}</h1>${right}</div></div>`;

export function registrationCard(c, s, f, autoPrint) {
  const b = f.booking, g = f.guest;
  const row = (k, v) => `<div><b>${k}</b>${esc(v || '')}</div>`;
  return page(`Fiche ${b.number}`, `<div class="sheet">${header(c, s, 'FICHE DE POLICE', `<div>${esc(b.number)}</div><div class="muted">Chambre <b style="font-size:16px;color:${NAVY}">${esc(b.room_number || '—')}</b></div>`)}
  <h2>Identité du voyageur</h2><div class="grid">${row('Nom et prénoms', `${g.title ? g.title + ' ' : ''}${g.name}`)}${row('Nationalité', g.nationality)}${row('Né(e) le', d(g.birth_date))}${row('À', g.birth_place)}
  ${row('Profession', g.profession)}${row('Domicile habituel', g.home_address || g.address)}${row('Pièce d\'identité', g.id_type)}${row('Numéro', g.id_number)}${row('Délivrée le', d(g.id_issued_on))}${row('À', g.id_issued_at)}
  ${row('Téléphone', g.phone)}${row('E-mail', g.email)}</div>
  <h2>Séjour</h2><div class="grid">${row('Arrivée', `${d(b.arrival)} ${b.checked_in_at ? 'à ' + new Date(b.checked_in_at).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Douala', hour: '2-digit', minute: '2-digit' }) : ''}`)}${row('Départ prévu', d(b.departure))}
  ${row('Venant de', b.coming_from)}${row('Se rendant à', b.going_to)}${row('Motif du séjour', b.purpose)}${row('Personnes', `${b.adults} adulte(s)${b.children ? `, ${b.children} enfant(s)` : ''}`)}
  ${row('Type de chambre', b.type_name)}${row('Tarif', b.plan_name || 'Négocié')}${row('Véhicule', b.vehicle)}${row('Facturé à', b.bill_to_name)}</div>
  ${g.preferences ? `<p><b>Préférences :</b> ${esc(g.preferences)}</p>` : ''}
  <p class="small muted" style="margin-top:18px">Je certifie l'exactitude des renseignements ci-dessus et accepte le règlement intérieur de l'hôtel. Départ avant ${esc(s.checkout_time)}. Les objets de valeur doivent être déposés dans le coffre. Taxe de séjour perçue pour le compte de la commune.</p>
  <div class="sign"><div>Signature du client</div><div>Visa de la réception</div></div></div>`, autoPrint);
}

export function folioPage(c, s, f, autoPrint) {
  const b = f.booking;
  const lines = f.lines.filter((l) => !l.voided);
  const vat = lines.reduce((t, l) => t + l.vat, 0), net = lines.reduce((t, l) => t + l.net, 0);
  const pays = f.payments.map((p) => `<tr><td>${d(p.date)}</td><td>${p.pay_kind === 'refund' ? 'Remboursement' : 'Règlement'} ${esc(PAY[p.method]?.fr || p.method)} ${p.reference ? `<span class="muted">${esc(p.reference)}</span>` : ''}</td><td class="r">${p.pay_kind === 'refund' ? '' : '-'}${n(p.amount)}</td></tr>`).join('');
  return page(`Note ${b.number}`, `<div class="sheet">${header(c, s, f.invoice ? `FACTURE ${f.invoice.number}` : 'NOTE DE SÉJOUR', `<div>${esc(b.number)} · ch. <b>${esc(b.room_number || '—')}</b></div><div class="muted">${d(b.arrival)} → ${d(b.departure)}</div>`)}
  <div class="grid" style="margin-bottom:12px"><div><b>Client</b>${esc(b.guest_name)}</div><div><b>Facturé à</b>${esc(b.bill_to_name)}</div></div>
  <table><thead><tr><th>Date</th><th>Désignation</th><th class="r">Montant TTC</th></tr></thead><tbody>
  ${lines.map((l) => `<tr><td>${d(l.date)}</td><td>${esc(l.description)}</td><td class="r">${n(l.amount)}</td></tr>`).join('')}
  <tr class="tot"><td></td><td>Total des prestations</td><td class="r">${n(b.charges)}</td></tr>${pays}
  <tr class="tot"><td></td><td>${b.balance > 0 ? 'Reste à payer' : b.balance < 0 ? 'Avance du client' : 'Soldé'}</td><td class="r">${n(Math.abs(b.balance))} FCFA</td></tr></tbody></table>
  <p class="small muted">Dont hors taxes ${n(net)} · TVA ${n(vat)} · taxe de séjour incluse. ${f.invoice ? '' : 'Document provisoire : la facture définitive est émise au départ.'}</p>
  ${c.momo_number || c.om_number ? `<p class="small">Paiement Mobile Money : ${c.momo_number ? `MTN ${esc(c.momo_number)}` : ''} ${c.om_number ? `· Orange ${esc(c.om_number)}` : ''} (référence ${esc(b.number)})</p>` : ''}
  <p style="text-align:center;margin-top:24px;color:${NAVY};font-weight:600">Merci de votre séjour. À très bientôt !</p></div>`, autoPrint);
}

export function confirmationPage(c, s, f, quote, link, autoPrint) {
  const b = f.booking;
  return page(`Confirmation ${b.number}`, `<div class="sheet">${header(c, s, 'CONFIRMATION DE RÉSERVATION', `<div>${esc(b.number)}</div>`)}
  <p>Cher(e) ${esc(b.guest_name)},</p><p>Nous avons le plaisir de confirmer votre réservation et nous réjouissons de vous accueillir.</p>
  <div class="grid"><div><b>Arrivée</b>${d(b.arrival)} à partir de ${esc(s.checkin_time)}</div><div><b>Départ</b>${d(b.departure)} avant ${esc(s.checkout_time)}</div>
  <div><b>Chambre</b>${esc(b.type_name)}</div><div><b>Personnes</b>${b.adults} adulte(s)${b.children ? `, ${b.children} enfant(s)` : ''}</div>
  <div><b>Tarif</b>${esc(b.plan_name || 'Tarif négocié')}</div><div><b>Nuits</b>${quote.nights}</div>
  <div><b>Montant estimé</b>${fcfa(quote.total)}</div><div><b>Déjà réglé</b>${fcfa(b.paid)}</div></div>
  ${b.special_requests ? `<p><b>Vos demandes :</b> ${esc(b.special_requests)}</p>` : ''}
  <p>Votre espace client (facture, room service, spa, demandes) : <b>${esc(link)}</b></p>
  <p class="small muted">Montant TTC incluant la TVA et la taxe de séjour. Toute annulation doit nous parvenir 48 h avant l'arrivée.</p></div>`, autoPrint);
}

export function policeRegisterPage(c, s, rows, from, to, autoPrint) {
  return page('Registre de police', `<div class="sheet" style="max-width:1100px">${header(c, s, 'REGISTRE DES VOYAGEURS', `<div class="muted">du ${d(from)} au ${d(to)}</div>`)}
  <table class="small"><thead><tr><th>N°</th><th>Arrivée</th><th>Ch.</th><th>Nom et prénoms</th><th>Nationalité</th><th>Né(e) le / à</th><th>Profession</th><th>Pièce</th><th>Venant de → allant à</th><th>Départ</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${d(r.checked_in_at)}</td><td>${esc(r.room_number)}</td><td><b>${esc(r.name)}</b>${r.adults + r.children > 1 ? `<br><span class="muted">+${r.adults + r.children - 1} pers.</span>` : ''}</td><td>${esc(r.nationality)}</td>
  <td>${d(r.birth_date)}<br>${esc(r.birth_place)}</td><td>${esc(r.profession)}</td><td>${esc(r.id_type)} ${esc(r.id_number)}<br><span class="muted">${d(r.id_issued_on)} ${esc(r.id_issued_at)}</span></td><td>${esc(r.coming_from)} → ${esc(r.going_to)}</td><td>${d(r.checked_out_at || r.departure)}</td></tr>`).join('')}
  </tbody></table><p class="small muted">${rows.length} voyageur(s). Arrêté le ${new Date().toLocaleDateString('fr-FR')}.</p></div>`, autoPrint);
}

export function roomQrPage(c, s, rooms, base, autoPrint) {
  return page('QR des chambres', `<div class="sheet"><div class="cards">${rooms.map((r) => `<div class="qc"><div class="stars">${'★'.repeat(s.stars || 0)}</div><div class="muted">${esc(c.name)}</div><h3>Chambre ${esc(r.number)}</h3>
  <div class="q" data-url="${esc(`${base}/g/${r.portal_token}`)}"></div><b>Scannez pour commander, réserver le spa, nous écrire ou régler votre note.</b><div class="small muted">Scan to order room service, book the spa, chat with us or pay your bill.</div></div>`).join('')}</div></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>document.querySelectorAll('.q').forEach(function(e){try{new QRCode(e,{text:e.dataset.url,width:150,height:150,colorDark:'${NAVY}',correctLevel:QRCode.CorrectLevel.M})}catch(x){e.textContent=e.dataset.url}})</script>`, autoPrint);
}
