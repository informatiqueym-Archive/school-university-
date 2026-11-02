// Shared UI helpers for every Teknons platform: language, formatting,
// tables, forms, dialogs, toasts and icons.
export const state = { lang: 'fr', me: null, meta: null };
export const L = (fr, en) => (state.lang === 'en' ? en ?? fr : fr);
export const can = (perm) => !!state.me?.perms?.includes(perm);
export const canAny = (...perms) => perms.some(can);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (n) => (Math.round(Number(n) || 0)).toLocaleString('fr-FR').replace(/ | /g, ' ');
export const money = (n) => `${num(n)} FCFA`;
export const moneyShort = (n) => {
  const v = Math.abs(n);
  if (v >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Md`;
  if (v >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  if (v >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(Math.round(n));
};
export const dt = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
export const today = () => new Date().toISOString().slice(0, 10);
export const yearStart = () => `${today().slice(0, 4)}-01-01`;
export const monthStart = () => `${today().slice(0, 7)}-01`;
export const qs = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString(); return s ? '?' + s : ''; };

export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3500);
}
export function showError(e) { toast(e?.message || L('Une erreur est survenue', 'Something went wrong'), 'err'); }

const STATUS = {
  draft: ['', 'Brouillon', 'Draft'], sent: ['info', 'Envoyé', 'Sent'], accepted: ['ok', 'Accepté', 'Accepted'], refused: ['bad', 'Refusé', 'Refused'],
  invoiced: ['ok', 'Facturé', 'Invoiced'], open: ['warn', 'À payer', 'Unpaid'], partial: ['info', 'Partiel', 'Partly paid'], paid: ['ok', 'Payée', 'Paid'],
  cancelled: ['', 'Annulé', 'Cancelled'], validated: ['ok', 'Validé', 'Posted'], pending: ['info', 'En attente', 'Pending'], completed: ['ok', 'Reçu', 'Completed'],
  failed: ['bad', 'Échoué', 'Failed'], posted: ['ok', 'Enregistrée', 'Posted'], overdue: ['bad', 'En retard', 'Overdue'],
};
export function pill(status, overdue) {
  const s = overdue ? STATUS.overdue : STATUS[status] || ['', status, status];
  return `<span class="pill ${s[0]}">${esc(L(s[1], s[2]))}</span>`;
}

// ---- Icons (inline SVG, stroke style) ----
const P = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  check: 'M4 12l5 5L20 6',
  quote: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  invoice: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  credit: 'M4 12h16M12 4v16',
  bill: 'M3 7h18v12H3zM3 11h18M7 15h3',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  truck: 'M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01',
  phone: 'M7 2h10v20H7zM11 18h2',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M17 14h.01',
  receipt: 'M4 2h16v20l-4-2-4 2-4-2-4 2zM8 8h8M8 12h8',
  book: 'M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM4 16a4 4 0 0 1 4-4h12',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  plus: 'M12 5v14M5 12h14',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  swap: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  x: 'M18 6L6 18M6 6l12 12',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  cart: 'M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  monitor: 'M2 4h20v13H2zM8 21h8M12 17v4',
  percent: 'M19 5L5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  clipboard: 'M9 2h6v4H9zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 13l2 2 4-4',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  card: 'M2 5h20v14H2zM2 10h20M6 15h4',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
  minus: 'M5 12h14',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  concierge: 'M3 18h18M5 18a7 7 0 0 1 14 0M12 8V6M10 6h4',
  key: 'M15 7a4 4 0 1 1-3.4 6.1L4 20.7V22h3v-2h2v-2h2l1.6-1.6A4 4 0 0 1 15 7zM16.5 9.5h.01',
  spa: 'M12 21c-5 0-9-3-9-8 3 0 6 1 9 4 3-3 6-4 9-4 0 5-4 8-9 8zM12 17c-2-3-2-7 0-11 2 4 2 8 0 11z',
  bed: 'M2 19V6M2 13h20v6M22 19v-4a3 3 0 0 0-3-3h-8v1M6 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  tool: 'M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3zM14.7 6.3L17 4l3 3-2.3 2.3',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.list}"/></svg>`;

// ---- Tables ----
/** columns: [{ label, key, render(row), cls, hideM }], rows, href(row) */
export function table({ columns, rows, href, empty, foot }) {
  if (!rows?.length) return `<div class="tbl-wrap"><div class="empty">${empty || `<b>${L('Rien pour le moment', 'Nothing yet')}</b>`}</div></div>`;
  const th = columns.map((c) => `<th class="${c.cls || ''} ${c.hideM ? 'hide-m' : ''}">${esc(c.label)}</th>`).join('');
  const tr = rows.map((r) => `<tr ${href ? `class="click" data-href="${esc(href(r))}"` : ''}>${columns.map((c) => `<td class="${c.cls || ''} ${c.hideM ? 'hide-m' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${th}</tr></thead><tbody>${tr}${foot || ''}</tbody></table></div>`;
}

// ---- Forms ----
/** f: { name, label, type, options:[[v,l]], value, required, hint, step, min, placeholder, span } */
export function field(f, values = {}) {
  const v = values[f.name] ?? f.value ?? '';
  const req = f.required ? 'required' : '';
  const attrs = `name="${f.name}" ${req} ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.readonly ? 'readonly' : ''} ${f.list ? `list="${f.list}"` : ''}`;
  let input;
  if (f.type === 'select') input = `<select ${attrs}>${(f.options || []).map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea ${attrs}>${esc(v)}</textarea>`;
  else if (f.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${f.name}" ${v && v !== '0' ? 'checked' : ''}> ${esc(f.label)}</label>`;
  else input = `<input type="${f.type || 'text'}" value="${esc(v)}" ${attrs} ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
  return `<label class="fld" ${f.span ? 'style="grid-column:1/-1"' : ''}>${esc(f.label)}${f.required ? ' *' : ''}${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
}
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}

// ---- Dialogs ----
export function dialog({ title, body, submit = L('Enregistrer', 'Save'), cancel = L('Annuler', 'Cancel'), danger = false, onSubmit, onOpen, wide }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    if (wide) d.style.maxWidth = 'min(820px, calc(100vw - 24px))';
    d.innerHTML = `<form method="dialog" novalidate><div class="dlg-h"><h3>${esc(title)}</h3><button type="button" class="btn ghost sm" data-x aria-label="${L('Fermer', 'Close')}">${icon('x')}</button></div>
      <div class="dlg-b">${body}</div><div class="dlg-f">${cancel ? `<button type="button" class="btn" data-x>${esc(cancel)}</button>` : ''}${submit ? `<button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(submit)}</button>` : ''}</div></form>`;
    document.body.append(d);
    const form = d.querySelector('form');
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => close(null)));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const btn = form.querySelector('button[value=ok]');
      btn.disabled = true;
      try { const r = onSubmit ? await onSubmit(formValues(form), form) : formValues(form); if (r !== false) close(r ?? true); }
      catch (err) { showError(err); }
      finally { btn.disabled = false; }
    });
    d.showModal();
    onOpen?.(d);
  });
}
export const confirmDlg = (title, text, ok = L('Confirmer', 'Confirm'), danger = false) => dialog({ title, body: `<p>${esc(text)}</p>`, submit: ok, danger });

export function offlineNote(data) {
  if (!data?._offline) return '';
  return `<div class="netbar" style="border-radius:10px;margin-bottom:12px">${L('Données hors ligne du', 'Offline data from')} ${new Date(data._at).toLocaleString(state.lang === 'en' ? 'en-GB' : 'fr-FR')}</div>`;
}
