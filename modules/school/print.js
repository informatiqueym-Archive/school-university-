// Printable pages (A4, "save as PDF" from the browser): report cards with a QR
// verification code, fee receipts, student ID cards, certificate of
// enrolment, transcript, timetable and e-learning certificates.
import { fcfa, amountInWords } from '../../core/format.js';
import { DISTINCTIONS, appreciation, appreciationEn } from './grades.js';
import { DAYS } from './academics.js';

const NAVY = '#0F3B2C', ACC = '#15803D', GOLD = '#B8892B';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dfr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const n2 = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ','));
const QR = `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>document.querySelectorAll('.q').forEach(function(e){try{new QRCode(e,{text:e.dataset.url,width:+e.dataset.size||84,height:+e.dataset.size||84,colorDark:'${NAVY}',correctLevel:QRCode.CorrectLevel.M})}catch(x){e.textContent=e.dataset.url}})</script>`;

const CSS = `*{box-sizing:border-box}body{margin:0;background:#E8ECE9;font:11.5px/1.4 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#0F1D17}
.bar{position:sticky;top:0;background:${NAVY};color:#fff;padding:10px;display:flex;gap:12px;justify-content:center;z-index:3}.bar button{background:${ACC};color:#fff;border:0;border-radius:10px;padding:9px 18px;font:600 14px system-ui;cursor:pointer}
.page{width:210mm;min-height:297mm;margin:14px auto;background:#fff;padding:11mm 12mm;position:relative;box-shadow:0 4px 24px rgba(0,0,0,.1);page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
.wm{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;font:800 90px Georgia,serif;color:rgba(15,59,44,.035);transform:rotate(-24deg)}
.hd{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;border-bottom:2px solid ${NAVY};padding-bottom:8px}
.hd .l,.hd .r{font-size:9.5px;text-align:center;text-transform:uppercase;letter-spacing:.04em;line-height:1.35}.hd .c{text-align:center}.hd img{max-height:56px;max-width:120px}
.hd h1{margin:2px 0 0;font:700 15px Georgia,serif;color:${NAVY}}.hd .m{font-style:italic;color:${GOLD};font-size:10.5px}
.ttl{text-align:center;margin:10px 0 8px}.ttl h2{margin:0;font:700 17px Georgia,serif;letter-spacing:.06em;color:${NAVY};text-transform:uppercase}.ttl div{color:#5A6B63}
.id{display:grid;grid-template-columns:70px 1fr 1fr auto;gap:10px;border:1px solid #D5DDD8;border-radius:10px;padding:8px 10px;align-items:center}
.id .ph{width:66px;height:80px;border-radius:8px;background:#EEF3F0 center/cover;display:grid;place-items:center;font:700 22px Georgia,serif;color:${ACC}}
.id b{font-size:13px}.id small{color:#5A6B63;display:block}
table{width:100%;border-collapse:collapse}.g{margin-top:8px}.g th{background:${NAVY};color:#fff;font-weight:600;font-size:9.5px;padding:5px 4px;text-align:center}
.g td{border-bottom:1px solid #E3E9E5;padding:4px;text-align:center;font-variant-numeric:tabular-nums}.g td.s{text-align:left}.g td.s small{display:block;color:#7A8A82;font-size:9px}
.g tr.grp td{background:#EEF5F1;font-weight:700;text-align:left;font-size:10px;color:${NAVY}}.g tr.tot td{font-weight:700;border-top:2px solid ${NAVY};background:#F7FAF8}
.low{color:#B42318;font-weight:700}.hi{color:${ACC};font-weight:700}
.sum{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:8px;margin-top:8px}.box{border:1px solid #D5DDD8;border-radius:10px;padding:8px 10px}.box h4{margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5A6B63}
.big{font:700 22px Georgia,serif;color:${NAVY}}.kv{display:flex;justify-content:space-between;gap:6px;padding:1px 0}.kv span{color:#5A6B63}
.dist{display:inline-block;background:${GOLD};color:#fff;border-radius:99px;padding:2px 10px;font-weight:700;font-size:10.5px}.dist.w{background:#B42318}
.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}.sig div{border-top:1px dashed #B9C6BF;padding-top:4px;min-height:52px;font-size:10px;color:#5A6B63}
.ver{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:9.5px;color:#5A6B63;border-top:1px solid #E3E9E5;padding-top:8px}.ver .q{width:84px;height:84px;flex:none}.ver b{color:${NAVY};font-family:"IBM Plex Mono",monospace}
.rc h1{font:700 18px Georgia,serif;color:${NAVY};margin:0}.lines td{padding:6px;border-bottom:1px solid #E3E9E5}.r{text-align:right}
.cards{display:grid;grid-template-columns:repeat(2,85.6mm);gap:6mm;justify-content:center}.card{width:85.6mm;height:54mm;border-radius:10px;overflow:hidden;position:relative;background:linear-gradient(135deg,${NAVY},#164D3A 60%,${ACC});color:#fff;padding:9px 11px;break-inside:avoid;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.card .t{font:700 10px system-ui;letter-spacing:.08em;text-transform:uppercase;opacity:.9}.card .sc{font:700 12px Georgia,serif}.card .bd{display:grid;grid-template-columns:20mm 1fr 20mm;gap:7px;margin-top:6px;align-items:center}
.card .ph{width:20mm;height:24mm;border-radius:6px;background:#fff center/cover;display:grid;place-items:center;color:${NAVY};font:700 18px Georgia,serif}.card b{font-size:12px;display:block;line-height:1.15}.card small{display:block;font-size:8.5px;opacity:.85}
.card .q{background:#fff;padding:3px;border-radius:6px;width:20mm;height:20mm}.card .q img,.card .q canvas{width:100%!important;height:100%!important}.card .ft{position:absolute;bottom:6px;left:11px;right:11px;font-size:8px;opacity:.8;display:flex;justify-content:space-between}
.cert{border:10px double ${GOLD};padding:16mm;text-align:center;min-height:260mm;display:flex;flex-direction:column;justify-content:center;gap:12px}.cert h1{font:700 34px Georgia,serif;color:${NAVY};margin:0}.cert .nm{font:italic 700 28px Georgia,serif;color:${ACC}}
.tt td,.tt th{border:1px solid #D5DDD8;padding:5px;vertical-align:top;font-size:10px}.tt th{background:${NAVY};color:#fff}.tt .sl{background:#EEF5F1;border-radius:6px;padding:4px;margin-bottom:3px}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:0}@page{size:A4;margin:9mm}}
@media (max-width:820px){.page{width:auto;margin:0;padding:14px}.sum,.sig{grid-template-columns:1fr}}`;

function page(title, body, autoPrint, lang = 'fr') {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">${lang === 'en' ? 'Print / Save as PDF' : 'Imprimer / Enregistrer en PDF'}</button></div>${body}${QR}
${autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),600))</script>' : ''}</body></html>`;
}

function header(c, s, lang = 'fr') {
  const en = lang === 'en';
  const min = { MINEDUB: en ? 'Ministry of Basic Education' : "Ministère de l'Éducation de Base", MINESEC: en ? 'Ministry of Secondary Education' : 'Ministère des Enseignements Secondaires', MINESUP: en ? 'Ministry of Higher Education' : "Ministère de l'Enseignement Supérieur" }[s.ministry] || s.ministry || '';
  return `<div class="hd"><div class="l">République du Cameroun<br><small>Paix – Travail – Patrie</small><br>${esc(min)}</div>
  <div class="c">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : ''}<h1>${esc(c.name)}</h1>${s.motto ? `<div class="m">« ${esc(s.motto)} »</div>` : ''}<div style="font-size:9.5px;color:#5A6B63">${esc([c.address, c.city].filter(Boolean).join(', '))}${c.phone ? ` · ${esc(c.phone)}` : ''}</div></div>
  <div class="r">Republic of Cameroon<br><small>Peace – Work – Fatherland</small><br>${esc(c.email || c.website || '')}</div></div>`;
}

const initials = (st) => esc(`${(st.last_name || '')[0] || ''}${(st.first_name || '')[0] || ''}`);
const photo = (st) => (st.photo ? `style="background-image:url('${esc(st.photo)}')"` : '');

/** Report cards (one page per student). */
export function renderBulletins(company, s, data, baseUrl, { autoPrint = false, lang = 'fr' } = {}) {
  const en = lang === 'en';
  const lmd = data.grading === 'lmd';
  const groups = { lit: en ? 'Literary subjects' : 'Matières littéraires', sci: en ? 'Scientific subjects' : 'Matières scientifiques', general: en ? 'Other subjects' : 'Autres matières', tech: en ? 'Technical' : 'Matières techniques', core: en ? 'Core units' : 'UE fondamentales', elective: en ? 'Elective units' : 'UE optionnelles' };
  const pages = data.bulletins.map((b) => {
    let lastGrp = null;
    const rows = data.courses.map((c) => {
      const m = b.courses[c.id];
      const grp = c.grp !== lastGrp ? `<tr class="grp"><td colspan="${lmd ? 9 : data.period.slots.length + 6}">${esc(groups[c.grp] || c.grp)}</td></tr>` : '';
      lastGrp = c.grp;
      const cls = m.avg == null ? '' : m.avg < s.pass_mark ? 'low' : m.avg >= 14 ? 'hi' : '';
      if (lmd) return `${grp}<tr><td class="s">${esc(c.code ? c.code + ' · ' : '')}${esc(en && c.subject_en ? c.subject_en : c.subject)}<small>${esc(c.teacher || '')}</small></td><td>${c.coef}</td>${data.period.slots.slice(0, 3).map((q) => `<td>${n2(m.seqs[q.seq])}</td>`).join('')}<td class="${cls}">${n2(m.avg)}</td><td>${esc(m.grade || '')}</td><td>${m.avg != null && m.avg >= s.pass_mark ? c.coef : 0}</td><td>${esc(en ? appreciationEn(m.avg) : appreciation(m.avg))}</td></tr>`;
      return `${grp}<tr><td class="s">${esc(en && c.subject_en ? c.subject_en : c.subject)}<small>${esc(c.teacher || '')}</small></td>${data.period.slots.map((q) => `<td>${n2(m.seqs[q.seq])}</td>`).join('')}<td class="${cls}">${n2(m.avg)}</td><td>${c.coef}</td><td>${n2(m.points)}</td><td>${m.rank ?? '—'}</td><td>${esc(en ? appreciationEn(m.avg) : appreciation(m.avg))}</td></tr>`;
    }).join('');
    const head = lmd
      ? `<tr><th style="text-align:left">${en ? 'Course unit' : 'Unité d\'enseignement'}</th><th>${en ? 'Credits' : 'Crédits'}</th><th>CC</th><th>${en ? 'Exam' : 'Examen'}</th><th>${en ? 'Resit' : 'Ratt.'}</th><th>${en ? 'Avg' : 'Moy.'}</th><th>${en ? 'Grade' : 'Grade'}</th><th>${en ? 'Earned' : 'Acquis'}</th><th>${en ? 'Remark' : 'Appréciation'}</th></tr>`
      : `<tr><th style="text-align:left">${en ? 'Subject / teacher' : 'Matière / enseignant'}</th>${data.period.slots.map((q) => `<th>${esc(q.label.replace('Séquence ', 'Séq. ').replace('Sequence ', 'Seq. '))}</th>`).join('')}<th>${en ? 'Avg /20' : 'Moy. /20'}</th><th>Coef</th><th>${en ? 'Points' : 'Moy × coef'}</th><th>${en ? 'Rank' : 'Rang'}</th><th>${en ? 'Remark' : 'Appréciation'}</th></tr>`;
    const tot = lmd ? '' : `<tr class="tot"><td class="s">${en ? 'Totals' : 'Totaux'}</td>${data.period.slots.map(() => '<td></td>').join('')}<td></td><td>${b.total_coef}</td><td>${n2(b.total_points)}</td><td></td><td></td></tr>`;
    const dist = b.distinction ? `<span class="dist ${['warning', 'blame'].includes(b.distinction) ? 'w' : ''}">${esc(DISTINCTIONS[b.distinction]?.[en ? 1 : 0] || b.distinction)}</span>` : '';
    const decision = { promoted: en ? 'Promoted' : 'Admis(e) en classe supérieure', repeat: en ? 'Repeats the year' : 'Redouble', excluded: en ? 'Excluded' : 'Exclu(e)', graduated: en ? 'Graduated' : 'Diplômé(e)' }[b.decision] || '';
    const url = `${baseUrl}/v/${b.code}`;
    return `<div class="page"><div class="wm">${esc(company.name.split(' ')[0])}</div>${header(company, s, lang)}
    <div class="ttl"><h2>${lmd ? (en ? 'Academic transcript' : 'Relevé de notes') : (en ? 'Report card' : 'Bulletin de notes')} – ${esc(en ? data.period.en : data.period.fr)}</h2><div>${en ? 'School year' : 'Année scolaire'} ${esc(data.year.name)}</div></div>
    <div class="id"><div class="ph" ${photo(b)}>${b.photo ? '' : initials(b)}</div>
      <div><b>${esc(b.name)}</b><small>${en ? 'Student ID' : 'Matricule'} : ${esc(b.matricule)}</small><small>${en ? 'Born' : 'Né(e) le'} ${dfr(b.birth_date)}${b.birth_place ? ` ${en ? 'in' : 'à'} ${esc(b.birth_place)}` : ''} · ${b.sex === 'F' ? (en ? 'Female' : 'Féminin') : (en ? 'Male' : 'Masculin')}</small></div>
      <div><b>${esc(data.class.name)}</b><small>${en ? 'Size' : 'Effectif'} : ${data.stats.size}${data.class.head_teacher ? ` · ${en ? 'Form teacher' : 'Prof. principal'} : ${esc(data.class.head_teacher)}` : ''}</small><small>${b.repeating ? (en ? 'Repeating' : 'Redoublant(e)') : ''}</small></div>
      <div style="text-align:right">${dist}</div></div>
    <table class="g"><thead>${head}</thead><tbody>${rows}${tot}</tbody></table>
    <div class="sum"><div class="box"><h4>${en ? 'Results' : 'Résultats'}</h4>
      <div class="kv"><span>${en ? 'General average' : 'Moyenne générale'}</span><b class="big">${n2(b.average)}<small style="font-size:12px">/20</small></b></div>
      <div class="kv"><span>${en ? 'Rank' : 'Rang'}</span><b>${b.rank ?? '—'}${b.rank === 1 ? (b.sex === 'F' ? 're' : 'er') : 'e'} / ${data.stats.ranked}</b></div>
      ${lmd ? `<div class="kv"><span>${en ? 'Credits earned' : 'Crédits acquis'}</span><b>${b.credits} / ${b.credits_total}</b></div><div class="kv"><span>GPA</span><b>${b.gpa ?? '—'} / 4 (${esc(b.grade || '')})</b></div>` : ''}
      <div class="kv"><span>${en ? 'Remark' : 'Appréciation'}</span><b>${esc(en ? appreciationEn(b.average) : appreciation(b.average))}</b></div>
      ${b.previous ? `<div class="kv"><span>${en ? 'Previous term' : 'Trimestre précédent'}</span><b>${n2(b.previous.average)} (${b.previous.rank ?? '—'}e)</b></div>` : ''}</div>
      <div class="box"><h4>${en ? 'Class' : 'Classe'}</h4><div class="kv"><span>${en ? 'Class average' : 'Moyenne de la classe'}</span><b>${n2(data.stats.avg)}</b></div><div class="kv"><span>${en ? 'Highest' : 'Plus forte'}</span><b>${n2(data.stats.max)}</b></div>
        <div class="kv"><span>${en ? 'Lowest' : 'Plus faible'}</span><b>${n2(data.stats.min)}</b></div><div class="kv"><span>${en ? 'Pass rate' : 'Taux de réussite'}</span><b>${String(data.stats.pass_rate).replace('.', ',')} %</b></div></div>
      <div class="box"><h4>${en ? 'Attendance and conduct' : 'Assiduité et conduite'}</h4><div class="kv"><span>${en ? 'Absences' : 'Absences'}</span><b>${b.absences.hours} h</b></div><div class="kv"><span>${en ? 'of which excused' : 'dont justifiées'}</span><b>${b.absences.justified} h</b></div>
        <div class="kv"><span>${en ? 'Lates' : 'Retards'}</span><b>${b.absences.lates}</b></div><div class="kv"><span>${en ? 'Sanctions' : 'Sanctions'}</span><b>${b.sanctions.filter((x) => x.kind !== 'praise').length}</b></div>
        ${b.council?.conduct ? `<div class="kv"><span>${en ? 'Conduct' : 'Conduite'}</span><b>${esc(b.council.conduct)}</b></div>` : ''}</div></div>
    ${b.council?.remark || decision ? `<div class="box" style="margin-top:8px"><h4>${en ? 'Class council' : 'Conseil de classe'}</h4>${esc(b.council?.remark || '')}${decision ? `<div style="margin-top:4px"><b>${en ? 'Decision' : 'Décision'} : ${decision}</b></div>` : ''}</div>` : ''}
    <div class="sig"><div>${en ? 'Form teacher' : 'Le professeur principal'}</div><div>${en ? 'Parent / guardian' : 'Le parent / tuteur'}</div><div>${esc(s.principal_title || 'Le Principal')}<br><b style="color:#0F1D17">${esc(s.principal_name || '')}</b></div></div>
    <div class="ver"><div class="q" data-url="${esc(url)}"></div><div>${en ? 'Authenticity: scan the QR code or visit' : 'Authenticité : scannez le QR code ou ouvrez'} <b>${esc(url)}</b>.<br>${en ? 'Verification code' : 'Code de vérification'} : <b>${esc(b.code)}</b> · ${en ? 'Issued on' : 'Édité le'} ${dfr(new Date().toISOString())} · Teknons École</div></div></div>`;
  }).join('');
  return page(`${lmd ? 'Relevés' : 'Bulletins'} ${data.class.name} ${data.period.fr}`, pages || '<div class="page">Aucun élève</div>', autoPrint, lang);
}

export function renderReceipt(company, s, r, st, fees, { autoPrint = false } = {}) {
  const alloc = JSON.parse(r.allocations || '[]');
  const M = { cash: 'Espèces', bank: 'Virement', cheque: 'Chèque', mtn_momo: 'MTN Mobile Money', orange_money: 'Orange Money' };
  const one = (copy) => `<div class="rc" style="border:1px solid #D5DDD8;border-radius:12px;padding:12px 14px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><h1>${esc(company.name)}</h1><div style="color:#5A6B63">${esc([company.address, company.city, company.phone].filter(Boolean).join(' · '))}</div></div>
    <div style="text-align:right"><div style="font:700 15px Georgia,serif;color:${ACC}">REÇU DE PAIEMENT</div><div style="font-family:monospace;font-size:13px">${esc(r.number)}</div><div>${dfr(r.created_at)}</div><small style="color:#7A8A82">${copy}</small></div></div>
    <p style="margin:8px 0">Reçu de <b>${esc(r.payer || st.guardian_name || '')}</b> pour l'élève <b>${esc(st.last_name)} ${esc(st.first_name)}</b> (mat. ${esc(st.matricule)}${st.class_name ? `, ${esc(st.class_name)}` : ''}) la somme de :</p>
    <div style="font:700 20px Georgia,serif;color:${NAVY}">${fcfa(r.amount)}</div><div style="font-style:italic;color:#5A6B63">${esc(amountInWords(r.amount))}</div>
    <table class="lines" style="margin-top:8px">${alloc.map((a) => `<tr><td>${esc(a.label)}</td><td style="color:#7A8A82">${esc(a.number)}</td><td class="r">${fcfa(a.amount)}</td></tr>`).join('')}</table>
    <div style="display:flex;justify-content:space-between;margin-top:8px"><span>Mode : <b>${esc(M[r.method] || r.method)}</b>${r.reference ? ` · réf. ${esc(r.reference)}` : ''}</span><span>Reste à payer pour l'année : <b>${fcfa(fees.balance)}</b></span></div>
    <div style="display:flex;justify-content:space-between;margin-top:22px;color:#5A6B63"><span>Signature du parent</span><span>L'économe / le caissier</span></div></div>`;
  return page(`Reçu ${r.number}`, `<div class="page" style="min-height:auto">${one('Original – parent')}${one('Copie – établissement')}</div>`, autoPrint);
}

export function renderCards(company, s, year, students, baseUrl, { autoPrint = false } = {}) {
  const cards = students.map((st) => `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="sc">${esc(company.name)}</div><div class="t">Carte d'élève · Student ID</div></div><div class="t">${esc(year.name)}</div></div>
    <div class="bd"><div class="ph" ${photo(st)}>${st.photo ? '' : initials(st)}</div><div><b>${esc(st.last_name)}</b><b style="font-weight:500">${esc(st.first_name)}</b><small>Mat. ${esc(st.matricule)}</small><small>Classe : ${esc(st.class_name || '')}</small><small>Né(e) le ${dfr(st.birth_date)}</small>${st.blood_group ? `<small>Groupe sanguin : ${esc(st.blood_group)}</small>` : ''}</div>
    <div class="q" data-url="${esc(`${baseUrl}/v/c/${st.card_code}`)}" data-size="70"></div></div><div class="ft"><span>${esc(st.guardian_phone || company.phone || '')}</span><span>Si trouvée : ${esc(company.phone || company.city || '')}</span></div></div>`).join('');
  return page('Cartes d\'élèves', `<div class="page" style="min-height:auto"><div class="cards">${cards}</div></div>`, autoPrint);
}

export function renderCertificate(company, s, year, st, baseUrl, { autoPrint = false } = {}) {
  const url = `${baseUrl}/v/c/${st.card_code}`;
  return page('Certificat de scolarité', `<div class="page">${header(company, s)}<div class="ttl" style="margin:40px 0 30px"><h2 style="font-size:24px">Certificat de scolarité</h2><div>N° ${esc(st.matricule)}/${esc(year.name)}</div></div>
  <p style="font-size:14px;line-height:2">Je soussigné(e), <b>${esc(s.principal_name || '……………………')}</b>, ${esc((s.principal_title || 'le Principal').toLowerCase())} de <b>${esc(company.name)}</b>, certifie que l'élève <b>${esc(st.last_name)} ${esc(st.first_name)}</b>,
  né(e) le <b>${dfr(st.birth_date)}</b>${st.birth_place ? ` à <b>${esc(st.birth_place)}</b>` : ''}, matricule <b>${esc(st.matricule)}</b>, est régulièrement inscrit(e) dans notre établissement en classe de <b>${esc(st.class_name || '')}</b> pour l'année scolaire <b>${esc(year.name)}</b>.</p>
  <p style="font-size:14px;line-height:2">En foi de quoi le présent certificat lui est délivré pour servir et valoir ce que de droit.</p>
  <p style="text-align:right;margin-top:40px;font-size:14px">Fait à ${esc(company.city || 'Douala')}, le ${dfr(new Date().toISOString())}<br><br><b>${esc(s.principal_title || 'Le Principal')}</b><br><br><br>${esc(s.principal_name || '')}</p>
  <div class="ver" style="position:absolute;bottom:12mm;left:12mm;right:12mm"><div class="q" data-url="${esc(url)}"></div><div>Vérifiez ce document : <b>${esc(url)}</b></div></div></div>`, autoPrint);
}

export function renderTranscript(company, s, t, { autoPrint = false } = {}) {
  const st = t.student; const lmd = t.grading === 'lmd';
  const blocks = t.years.map((y) => `<h3 style="color:${NAVY};margin:14px 0 4px">${esc(y.year_name)} · ${esc(y.class_name)} ${y.decision ? `<span class="dist">${esc({ promoted: 'Admis', repeat: 'Redouble', graduated: 'Diplômé', excluded: 'Exclu' }[y.decision] || y.decision)}</span>` : ''}</h3>
    <table class="g"><thead><tr><th style="text-align:left">${lmd ? 'UE' : 'Matière'}</th>${y.results.map((r) => `<th>${esc(r.fr)}</th>`).join('')}</tr></thead><tbody>
    ${(y.results[0]?.courses || []).map((c, i) => `<tr><td class="s">${esc(c.code ? c.code + ' · ' : '')}${esc(c.subject)} <small>${lmd ? 'crédits' : 'coef'} ${c.coef}</small></td>${y.results.map((r) => `<td>${n2(r.courses[i]?.avg)}${r.courses[i]?.grade ? ` <small>${esc(r.courses[i].grade)}</small>` : ''}</td>`).join('')}</tr>`).join('')}
    <tr class="tot"><td class="s">Moyenne · rang</td>${y.results.map((r) => `<td>${n2(r.average)}${r.rank ? ` · ${r.rank}/${r.size}` : ''}${lmd && r.credits != null ? `<br><small>${r.credits}/${r.credits_total} cr. · GPA ${r.gpa ?? '—'}</small>` : ''}</td>`).join('')}</tr></tbody></table>`).join('');
  const exams = t.exams.length ? `<h3 style="color:${NAVY}">Examens officiels</h3><table class="g"><tr><th style="text-align:left">Examen</th><th>Session</th><th>Série</th><th>Résultat</th><th>Mention</th></tr>${t.exams.map((e) => `<tr><td class="s">${esc(e.exam)}</td><td>${esc(e.session)}</td><td>${esc(e.series)}</td><td>${esc({ passed: 'Admis', failed: 'Échec', absent: 'Absent', registered: 'Inscrit' }[e.result] || e.result)}</td><td>${esc(e.mention)}</td></tr>`).join('')}</table>` : '';
  return page(`Relevé ${st.last_name}`, `<div class="page">${header(company, s)}<div class="ttl"><h2>${lmd ? 'Relevé de notes cumulatif' : 'Dossier scolaire'}</h2><div>${esc(st.last_name)} ${esc(st.first_name)} · Mat. ${esc(st.matricule)} · né(e) le ${dfr(st.birth_date)}</div></div>${blocks}${exams}
  <div class="sig" style="margin-top:24px"><div></div><div></div><div>${esc(s.principal_title || 'Le Principal')}<br><b>${esc(s.principal_name || '')}</b></div></div></div>`, autoPrint);
}

export function renderTimetable(company, s, title, slots, { autoPrint = false } = {}) {
  const times = [...new Set(slots.map((x) => `${x.start}-${x.end}`))].sort();
  const body = times.map((t) => `<tr><th>${t.replace('-', '<br>')}</th>${[1, 2, 3, 4, 5, 6].map((d) => `<td>${slots.filter((x) => x.day === d && `${x.start}-${x.end}` === t).map((x) => `<div class="sl" style="border-left:3px solid ${esc(x.color || ACC)}"><b>${esc(x.subject)}</b><br><small>${esc(x.class_name)} · ${esc(x.teacher_name || '')}${x.room ? ` · ${esc(x.room)}` : ''}</small></div>`).join('')}</td>`).join('')}</tr>`).join('');
  return page(`Emploi du temps ${title}`, `<div class="page">${header(company, s)}<div class="ttl"><h2>Emploi du temps</h2><div>${esc(title)}</div></div><table class="tt"><tr><th></th>${[1, 2, 3, 4, 5, 6].map((d) => `<th>${DAYS[d][0]}</th>`).join('')}</tr>${body}</table></div>`, autoPrint);
}

export function renderCourseCertificate(company, cert, baseUrl) {
  const url = `${baseUrl}/v/cert/${cert.certificate_code}`;
  return page('Certificat', `<div class="page"><div class="cert"><div style="letter-spacing:.3em;color:${GOLD};font-weight:700">${esc(company.name.toUpperCase())}</div><h1>Certificat de réussite</h1><div>décerné à</div>
  <div class="nm">${esc(cert.first_name)} ${esc(cert.last_name)}</div><div style="font-size:14px">pour avoir suivi avec succès le cours en ligne</div><div style="font:700 20px Georgia,serif;color:${NAVY}">« ${esc(cert.course)} »</div>
  <div>${cert.minutes ? `${Math.round(cert.minutes / 60 * 10) / 10} heures de formation · ` : ''}terminé le ${dfr(cert.completed_at)}${cert.teacher_name ? ` · enseignant : ${esc(cert.teacher_name)}` : ''}</div>
  <div class="ver" style="justify-content:center;border:0"><div class="q" data-url="${esc(url)}"></div><div>Code : <b>${esc(cert.certificate_code)}</b><br>${esc(url)}</div></div></div></div>`);
}
