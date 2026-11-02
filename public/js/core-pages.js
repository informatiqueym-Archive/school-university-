// Screens shared by every platform: sign-in, clients/suppliers, products,
// users and roles, company settings, alerts, activity log, sync queue.
import { api, net, flush, clearFailed } from './api.js';
import { state, L, esc, money, dt, icon, can, canAny, table, field, dialog, toast, showError, confirmDlg, offlineNote, qs } from './ui.js';

// ---- Sign in / create company ----
export async function authPage(root, done) {
  let status = { signupOpen: false };
  try { status = await api.get('/api/auth/status', { cache: false }); } catch {}
  // Each Teknons product signs in with its own name and shade of marine blue.
  const b = status.brand || {};
  if (b.navy) document.documentElement.style.setProperty('--navy', b.navy);
  if (b.accent) { document.documentElement.style.setProperty('--blue', b.accent); document.documentElement.style.setProperty('--blue-d', b.accent); }
  const TAG = { Compta: ['Comptabilité et facturation', 'Accounting & invoicing'], POS: ['Caisse, stock et fidélité', 'Till, stock & loyalty'], 'Hôtel': ['Gestion hôtelière', 'Hotel management'] };
  const tag = TAG[b.short] || TAG.Compta;
  const draw = (mode) => {
    root.innerHTML = `<div class="auth"><div class="card">
      <div class="brand"><img src="/icon.svg" alt="" width="40"><div>${esc((b.name || 'Teknons').toUpperCase())}<small>${L(tag[0], tag[1])}</small></div></div>
      <h2 style="margin:0 0 6px">${mode === 'login' ? L('Connexion', 'Sign in') : L('Créer votre entreprise', 'Create your company')}</h2>
      <p class="muted" style="margin:0 0 18px">${mode === 'login' ? (b.short && b.short !== 'Compta' ? L('Accédez à votre espace depuis votre téléphone, votre tablette ou votre ordinateur.', 'Sign in from your phone, tablet or computer.') : L('Accédez à votre comptabilité depuis votre téléphone ou votre ordinateur.', 'Reach your books from your phone or computer.')) : L('Vous serez le propriétaire du compte.', 'You will own the account.')}</p>
      <form class="form" id="authf">
        ${mode === 'signup' ? field({ name: 'company', label: L("Nom de l'entreprise", 'Company name'), required: true }) + field({ name: 'name', label: L('Votre nom', 'Your name'), required: true }) + field({ name: 'phone', label: L('Téléphone', 'Phone'), type: 'tel' }) : ''}
        ${field({ name: 'email', label: 'E-mail', type: 'email', required: true })}
        ${field({ name: 'password', label: L('Mot de passe', 'Password'), type: 'password', required: true, hint: mode === 'signup' ? L('8 caractères minimum', 'At least 8 characters') : '' })}
        <button class="btn primary">${mode === 'login' ? L('Se connecter', 'Sign in') : L('Créer le compte', 'Create account')}</button>
        ${status.signupOpen ? `<button type="button" class="btn ghost" id="sw">${mode === 'login' ? L('Nouvelle entreprise ? Créer un compte', 'New company? Create an account') : L("J'ai déjà un compte", 'I already have an account')}</button>` : ''}
        <button type="button" class="btn ghost sm" id="lg">${state.lang === 'fr' ? 'English' : 'Français'}</button>
      </form></div></div>`;
    root.querySelector('#sw')?.addEventListener('click', () => draw(mode === 'login' ? 'signup' : 'login'));
    root.querySelector('#lg').addEventListener('click', () => { state.lang = state.lang === 'fr' ? 'en' : 'fr'; try { localStorage.setItem('tk:lang', state.lang); } catch {} draw(mode); });
    root.querySelector('#authf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { done(await api.post(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', f)); }
      catch (err) { showError(err); }
    });
  };
  draw(status.signupOpen && location.hash.includes('signup') ? 'signup' : 'login');
}

// ---- Clients and suppliers ----
export async function partnerList(ctx) {
  const kind = ctx.params.kind === 'supplier' ? 'supplier' : 'client';
  ctx.title(kind === 'client' ? L('Clients', 'Customers') : L('Fournisseurs', 'Suppliers'));
  const canEdit = kind === 'client' ? canAny('sales', 'treasury', 'accounting') : canAny('purchases', 'accounting');
  ctx.actions(`<a class="btn hide-m" href="/api/export/partners?kind=${kind}">${icon('download')}Excel</a>${canEdit ? `<button class="btn primary" id="add">${icon('plus')}${L('Nouveau', 'New')}</button>` : ''}`);
  const draw = async (q = '') => {
    const rows = await api.get(`/api/partners${qs({ kind, q })}`);
    ctx.el.querySelector('#list').innerHTML = offlineNote(rows) + table({
      rows, href: (r) => `/partner/${r.id}`,
      columns: [{ label: L('Nom', 'Name'), render: (r) => `<b>${esc(r.name)}</b>${r.contact ? `<div class="muted">${esc(r.contact)}</div>` : ''}` },
        { label: L('Téléphone', 'Phone'), key: 'phone' }, { label: 'E-mail', key: 'email', hideM: true }, { label: L('Ville', 'City'), key: 'city', hideM: true }, { label: 'NIU', key: 'niu', hideM: true }],
      empty: `<b>${L('Aucun tiers', 'No records yet')}</b>${L('Ajoutez votre premier', 'Add your first')} ${kind === 'client' ? L('client', 'customer') : L('fournisseur', 'supplier')}.`,
    });
  };
  ctx.el.innerHTML = `<div class="filters"><input type="search" class="in" id="q" placeholder="${L('Rechercher un nom, téléphone, e-mail', 'Search name, phone, email')}"></div><div id="list"></div>`;
  let t; ctx.el.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => draw(e.target.value), 250); });
  document.getElementById('add')?.addEventListener('click', async () => { if (await partnerDialog(kind)) draw(); });
  await draw();
}

export function partnerFields() {
  return [
    { name: 'name', label: L('Nom ou raison sociale', 'Name'), required: true, span: true },
    { name: 'contact', label: L('Personne à contacter', 'Contact person') }, { name: 'phone', label: L('Téléphone (Mobile Money)', 'Phone (Mobile Money)'), type: 'tel' },
    { name: 'email', label: 'E-mail', type: 'email' }, { name: 'niu', label: L('NIU (numéro contribuable)', 'Tax ID (NIU)') },
    { name: 'address', label: L('Adresse', 'Address') }, { name: 'city', label: L('Ville', 'City'), value: 'Douala' },
    { name: 'notes', label: L('Notes', 'Notes'), type: 'textarea', span: true },
  ];
}
export function partnerDialog(kind, p) {
  return dialog({
    title: p ? L('Modifier', 'Edit') : kind === 'client' ? L('Nouveau client', 'New customer') : L('Nouveau fournisseur', 'New supplier'),
    body: `<div class="f2">${partnerFields().map((f) => field(f, p || {})).join('')}</div>`,
    onSubmit: async (v) => {
      const r = p ? await api.put(`/api/partners/${p.id}`, v) : await api.post('/api/partners', { ...v, kind }, { label: `${kind === 'client' ? 'Client' : 'Fournisseur'} ${v.name}` });
      toast(r._queued ? L('Enregistré sur le téléphone, sera envoyé au retour du réseau', 'Saved on this device, will sync later') : L('Enregistré', 'Saved'), 'ok');
      return r;
    },
  });
}

// ---- Products and services ----
export async function productList(ctx) {
  ctx.title(L('Articles et services', 'Products & services'));
  const canEdit = canAny('sales', 'purchases', 'accounting');
  ctx.actions(canEdit ? `<button class="btn primary" id="add">${icon('plus')}${L('Nouveau', 'New')}</button>` : '');
  const draw = async () => {
    const rows = await api.get('/api/products');
    ctx.el.innerHTML = offlineNote(rows) + table({
      rows,
      columns: [{ label: L('Désignation', 'Name'), render: (r) => `<b>${esc(r.name)}</b>${r.code ? ` <span class="muted mono">${esc(r.code)}</span>` : ''}<div class="muted">${r.kind === 'good' ? L('Marchandise', 'Goods') : L('Service', 'Service')} · ${esc(r.unit)}</div>` },
        { label: L('Prix de vente HT', 'Sale price'), cls: 'r num', render: (r) => money(r.price) }, { label: L("Prix d'achat", 'Cost'), cls: 'r num', hideM: true, render: (r) => (r.purchase_price ? money(r.purchase_price) : '') },
        { label: L('TVA', 'VAT'), cls: 'r', render: (r) => (r.vat_rate == null ? L('par défaut', 'default') : `${r.vat_rate} %`) },
        { label: '', cls: 'r', render: (r) => (canEdit ? `<button class="btn sm" data-edit="${r.id}">${L('Modifier', 'Edit')}</button>` : '') }],
      empty: `<b>${L('Aucun article', 'No products yet')}</b>${L('Ajoutez vos produits et services pour facturer plus vite.', 'Add products and services to invoice faster.')}`,
    });
    ctx.el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => { if (await productDialog(rows.find((r) => String(r.id) === b.dataset.edit))) draw(); }));
  };
  document.getElementById('add')?.addEventListener('click', async () => { if (await productDialog()) draw(); });
  await draw();
}
export function productDialog(p) {
  const fields = [
    { name: 'name', label: L('Désignation', 'Name'), required: true, span: true },
    { name: 'kind', label: L('Type', 'Type'), type: 'select', options: [['service', L('Service', 'Service')], ['good', L('Marchandise', 'Goods')]] },
    { name: 'code', label: L('Code', 'Code') },
    { name: 'price', label: L('Prix de vente HT (FCFA)', 'Sale price excl. VAT (FCFA)'), type: 'number', min: 0, required: true },
    { name: 'purchase_price', label: L("Prix d'achat HT (FCFA)", 'Cost price (FCFA)'), type: 'number', min: 0 },
    { name: 'unit', label: L('Unité', 'Unit'), value: 'u', placeholder: 'u, h, jour, kg' },
    { name: 'vat_rate', label: L('TVA (%)', 'VAT (%)'), type: 'number', step: '0.01', min: 0, hint: L('Vide = taux de l\'entreprise (19,25 %). 0 si exonéré.', 'Empty = company rate (19.25%). 0 if exempt.') },
    { name: 'description', label: 'Description', type: 'textarea', span: true },
  ];
  if (p) fields.push({ name: 'active', label: L('Actif', 'Active'), type: 'checkbox', value: p.active });
  return dialog({
    title: p ? L('Modifier l\'article', 'Edit product') : L('Nouvel article', 'New product'),
    body: `<div class="f2">${fields.map((f) => field(f, p || {})).join('')}</div>`,
    onSubmit: async (v) => { const r = p ? await api.put(`/api/products/${p.id}`, v) : await api.post('/api/products', v, { label: `Article ${v.name}` }); toast(L('Enregistré', 'Saved'), 'ok'); return r; },
  });
}

// ---- Users and roles ----
export async function userList(ctx) {
  ctx.title(L('Utilisateurs et rôles', 'Users & roles'));
  ctx.actions(`<button class="btn primary" id="add">${icon('plus')}${L('Ajouter', 'Add')}</button>`);
  const roles = state.me.roles;
  const roleOpts = Object.entries(roles).filter(([k]) => k !== 'owner' || state.me.user.role === 'owner').map(([k, v]) => [k, L(v.fr, v.en)]);
  const draw = async () => {
    const rows = await api.get('/api/users');
    ctx.el.innerHTML = `<div class="card" style="margin-bottom:16px"><h3>${L('Ce que chaque rôle peut faire', 'What each role can do')}</h3>
      <div class="muted" style="font-size:14px">${[
        [L('Propriétaire / Administrateur', 'Owner / Admin'), L('tout, y compris les utilisateurs et les paramètres', 'everything, including users and settings')],
        [L('Comptable', 'Accountant'), L('ventes, achats, trésorerie, écritures et états financiers', 'sales, purchases, cash, entries and reports')],
        [L('Commercial', 'Sales'), L('clients, devis, factures et encaissements', 'customers, quotes, invoices and receipts')],
        [L('Caissier', 'Cashier'), L('encaissements, dépenses et virements', 'receipts, expenses and transfers')],
        [L('Lecture seule', 'Read only'), L('consulte tout, ne modifie rien', 'sees everything, changes nothing')]].map(([a, b]) => `<div><b style="color:var(--ink)">${a}</b> : ${b}</div>`).join('')}</div></div>` +
      table({ rows, columns: [
        { label: L('Nom', 'Name'), render: (r) => `<b>${esc(r.name)}</b><div class="muted">${esc(r.email)}</div>` },
        { label: L('Rôle', 'Role'), render: (r) => esc(L(roles[r.role]?.fr, roles[r.role]?.en)) },
        { label: L('Statut', 'Status'), render: (r) => (r.active ? `<span class="pill ok">${L('Actif', 'Active')}</span>` : `<span class="pill">${L('Désactivé', 'Disabled')}</span>`) },
        { label: L('Dernière connexion', 'Last sign-in'), hideM: true, render: (r) => (r.last_login ? new Date(r.last_login).toLocaleString('fr-FR') : '') },
        { label: '', cls: 'r', render: (r) => `<button class="btn sm" data-edit="${r.id}">${L('Modifier', 'Edit')}</button>` }] });
    ctx.el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const u = rows.find((r) => String(r.id) === b.dataset.edit);
      const ok = await dialog({ title: u.name, body: `<div class="form">${field({ name: 'name', label: L('Nom', 'Name'), required: true }, u)}${field({ name: 'phone', label: L('Téléphone', 'Phone') }, u)}
        ${field({ name: 'role', label: L('Rôle', 'Role'), type: 'select', options: roleOpts }, u)}${field({ name: 'password', label: L('Nouveau mot de passe (optionnel)', 'New password (optional)'), type: 'password' })}
        ${field({ name: 'active', label: L('Compte actif', 'Account active'), type: 'checkbox' }, u)}</div>`,
        onSubmit: (v) => { if (!v.password) delete v.password; return api.put(`/api/users/${u.id}`, v); } });
      if (ok) { toast(L('Enregistré', 'Saved'), 'ok'); draw(); }
    }));
  };
  document.getElementById('add').addEventListener('click', async () => {
    const ok = await dialog({ title: L('Nouvel utilisateur', 'New user'), body: `<div class="form">${field({ name: 'name', label: L('Nom', 'Name'), required: true })}${field({ name: 'email', label: 'E-mail', type: 'email', required: true })}
      ${field({ name: 'phone', label: L('Téléphone', 'Phone') })}${field({ name: 'role', label: L('Rôle', 'Role'), type: 'select', options: roleOpts, value: 'sales' })}
      ${field({ name: 'password', label: L('Mot de passe provisoire', 'Temporary password'), type: 'password', required: true, hint: L('8 caractères minimum. Communiquez-le à la personne.', 'At least 8 characters. Share it with the person.') })}</div>`,
      onSubmit: (v) => api.post('/api/users', v) });
    if (ok) { toast(L('Utilisateur créé', 'User created'), 'ok'); draw(); }
  });
  await draw();
}

export async function profile(ctx) {
  ctx.title(L('Mon compte', 'My account'));
  ctx.el.innerHTML = `<div class="grid g2"><div class="card"><h3>${L('Mes informations', 'My details')}</h3><form class="form" id="pf">${field({ name: 'name', label: L('Nom', 'Name'), required: true }, state.me.user)}
    <p class="muted">${esc(state.me.user.email)} · ${esc(L(state.me.roles[state.me.user.role].fr, state.me.roles[state.me.user.role].en))}</p><button class="btn primary">${L('Enregistrer', 'Save')}</button></form></div>
    <div class="card"><h3>${L('Changer le mot de passe', 'Change password')}</h3><form class="form" id="pw">${field({ name: 'current', label: L('Mot de passe actuel', 'Current password'), type: 'password', required: true })}
    ${field({ name: 'password', label: L('Nouveau mot de passe', 'New password'), type: 'password', required: true })}<button class="btn primary">${L('Changer', 'Change')}</button></form></div></div>`;
  ctx.el.querySelector('#pf').addEventListener('submit', async (e) => { e.preventDefault(); try { await api.put('/api/me', Object.fromEntries(new FormData(e.target))); state.me.user.name = e.target.name.value; toast(L('Enregistré', 'Saved'), 'ok'); } catch (err) { showError(err); } });
  ctx.el.querySelector('#pw').addEventListener('submit', async (e) => { e.preventDefault(); try { await api.post('/api/me/password', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast(L('Mot de passe changé', 'Password changed'), 'ok'); } catch (err) { showError(err); } });
}

// ---- Company settings ----
export async function settings(ctx) {
  ctx.title(L('Paramètres de l\'entreprise', 'Company settings'));
  const c = await api.get('/api/company');
  const meta = state.meta || {};
  ctx.el.innerHTML = `<form id="cf" class="stack">
  <div class="card"><h3>${L('Identité (apparaît sur les factures)', 'Identity (shown on invoices)')}</h3><div class="f2">
    ${[{ name: 'name', label: L('Raison sociale', 'Company name'), required: true }, { name: 'legal_form', label: L('Forme juridique', 'Legal form'), placeholder: 'SARL, SA, Ets…' },
      { name: 'niu', label: L('NIU (numéro contribuable)', 'Tax ID (NIU)') }, { name: 'rccm', label: 'RCCM' }, { name: 'address', label: L('Adresse', 'Address') }, { name: 'city', label: L('Ville', 'City') },
      { name: 'phone', label: L('Téléphone', 'Phone') }, { name: 'email', label: 'E-mail', type: 'email' }, { name: 'website', label: L('Site internet', 'Website') }].map((f) => field(f, c)).join('')}
    <label class="fld">${L('Logo (PNG/JPG, 300 Ko max)', 'Logo (PNG/JPG, 300 KB max)')}<input type="file" accept="image/png,image/jpeg,image/webp" id="logo">${c.logo ? `<img src="${esc(c.logo)}" alt="" style="max-height:48px;margin-top:6px;align-self:flex-start">` : ''}</label>
  </div></div>
  <div class="card"><h3>${L('Paiements acceptés (imprimés sur les factures)', 'Accepted payments (printed on invoices)')}</h3><div class="f3">
    ${field({ name: 'momo_number', label: L('Numéro MTN MoMo', 'MTN MoMo number') }, c)}${field({ name: 'om_number', label: L('Numéro Orange Money', 'Orange Money number') }, c)}${field({ name: 'bank_details', label: L('Banque et RIB', 'Bank details') }, c)}</div>
    <p class="muted" style="margin:10px 0 0">${L('Demandes de paiement Mobile Money depuis l\'application :', 'Mobile Money payment requests from the app:')} <b>${meta.momo?.mode === 'simulation' ? L('mode démonstration (aucun argent réel)', 'demo mode (no real money)') : meta.momo?.mode}</b>. ${L('Les clés MTN et Orange se configurent sur le serveur.', 'MTN and Orange keys are set on the server.')}</p></div>
  <div class="card"><h3>${L('TVA, échéances et alertes', 'VAT, terms and alerts')}</h3><div class="f3">
    ${field({ name: 'vat_enabled', label: L('Assujetti à la TVA', 'VAT registered'), type: 'checkbox' }, c)}
    ${field({ name: 'vat_rate', label: L('Taux de TVA (%)', 'VAT rate (%)'), type: 'number', step: '0.01', hint: L('Cameroun : 19,25 % (17,5 % + CAC 10 %)', 'Cameroon: 19.25% (17.5% + 10% CAC)') }, c)}
    ${field({ name: 'payment_terms_days', label: L('Délai de paiement (jours)', 'Payment terms (days)'), type: 'number', min: 0 }, c)}
    ${field({ name: 'quote_validity_days', label: L('Validité des devis (jours)', 'Quote validity (days)'), type: 'number', min: 1 }, c)}
    ${field({ name: 'low_cash_threshold', label: L('Alerte trésorerie basse (FCFA)', 'Low cash alert (FCFA)'), type: 'number', min: 0 }, c)}
    ${field({ name: 'large_expense_threshold', label: L('Alerte grosse dépense (FCFA)', 'Large expense alert (FCFA)'), type: 'number', min: 0 }, c)}
    ${field({ name: 'invoice_footer', label: L('Pied de page des factures', 'Invoice footer'), type: 'textarea', span: true }, c)}</div></div>
  <div class="row"><button class="btn primary">${L('Enregistrer', 'Save')}</button></div></form>
  <div class="card" style="margin-top:16px"><h3>${L('Clôture comptable', 'Period closing')}</h3>
    <p class="muted">${L('Une période clôturée ne peut plus recevoir d\'écritures. La clôture d\'exercice solde les comptes de charges et produits dans le résultat (131 / 139).', 'A locked period accepts no entries. Year-end closing moves income and expenses into the result (131 / 139).')}</p>
    <div class="row"><label class="fld">${L('Période verrouillée jusqu\'au', 'Locked until')}<input type="date" class="in" id="lock" value="${esc(meta.lock_date || '')}"></label><button class="btn" id="setlock">${L('Appliquer', 'Apply')}</button>
    <span style="flex:1"></span><button class="btn danger" id="close">${L('Clôturer l\'exercice', 'Close the year')} ${new Date().getFullYear() - 1}</button></div></div>`;
  let logo;
  ctx.el.querySelector('#logo').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 300_000) { toast(L('Logo trop lourd (300 Ko max)', 'Logo too large (300 KB max)'), 'err'); return; }
    const rd = new FileReader(); rd.onload = () => { logo = rd.result; }; rd.readAsDataURL(f);
  });
  ctx.el.querySelector('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = {}; for (const el of e.target.elements) if (el.name) v[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    if (logo) v.logo = logo;
    try { const r = await api.put('/api/company', v); state.me.company = r; toast(L('Paramètres enregistrés', 'Settings saved'), 'ok'); } catch (err) { showError(err); }
  });
  ctx.el.querySelector('#setlock').addEventListener('click', async () => { try { await api.put('/api/accounting/lock', { lock_date: ctx.el.querySelector('#lock').value }); state.meta = await api.get('/api/accounting/meta'); toast(L('Enregistré', 'Saved'), 'ok'); } catch (err) { showError(err); } });
  ctx.el.querySelector('#close').addEventListener('click', async () => {
    const y = new Date().getFullYear() - 1;
    if (!await confirmDlg(L('Clôturer l\'exercice', 'Close the year') + ' ' + y, L(`Le résultat ${y} sera passé en 131/139 et la période jusqu'au 31/12/${y} sera verrouillée. Continuer ?`, `The ${y} result will be posted to 131/139 and the period up to 31/12/${y} locked. Continue?`), L('Clôturer', 'Close'), true)) return;
    try { const r = await api.post('/api/accounting/close-year', { year: y }); toast(`${L('Résultat', 'Result')} : ${money(r.result)}`, 'ok'); } catch (err) { showError(err); }
  });
}

// ---- Alerts ----
export async function alertList(ctx) {
  ctx.title(L('Alertes', 'Alerts'));
  ctx.actions(`<button class="btn" id="all">${L('Tout marquer comme lu', 'Mark all read')}</button>`);
  const a = await api.get('/api/alerts');
  const href = (x) => (x.entity === 'document' ? `#/doc/${x.entity_id}` : x.entity === 'payment' ? '#/payments' : x.entity === 'expense' ? '#/expenses' : x.kind === 'low_cash' ? '#/treasury' : '');
  ctx.el.innerHTML = `<div class="card" style="padding:0">${a.items.length ? a.items.map((x) => `<div class="alert-it ${esc(x.level)} ${x.read ? 'read' : ''}"><span class="dot"></span><div style="flex:1">
    <b>${esc(x.title)}</b><div class="muted">${esc(x.body)}</div><div class="dim" style="font-size:12px">${new Date(x.created_at).toLocaleString('fr-FR')}</div></div>
    <div class="row">${href(x) ? `<a class="btn sm" href="${href(x)}" data-read="${x.id}">${L('Voir', 'Open')}</a>` : ''}${x.read ? '' : `<button class="btn sm ghost" data-read="${x.id}">${L('Lu', 'Read')}</button>`}</div></div>`).join('')
    : `<div class="empty"><b>${L('Aucune alerte', 'No alerts')}</b>${L('Les retards de paiement, paiements Mobile Money et grosses dépenses apparaîtront ici.', 'Late invoices, Mobile Money payments and large expenses will show here.')}</div>`}</div>`;
  ctx.el.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => { await api.post(`/api/alerts/${b.dataset.read}/read`).catch(() => {}); if (b.tagName === 'BUTTON') ctx.rerender(); }));
  document.getElementById('all').addEventListener('click', async () => { await api.post('/api/alerts/read-all'); ctx.rerender(); });
  (await import('./app.js')).refreshBadge();
}

export async function auditList(ctx) {
  ctx.title(L("Journal d'activité", 'Activity log'));
  const rows = await api.get('/api/audit');
  const A = { create: L('Création', 'Created'), update: L('Modification', 'Updated'), delete: L('Suppression', 'Deleted'), validate: L('Validation', 'Posted'), cancel: L('Annulation', 'Cancelled'), convert: L('Conversion', 'Converted'), status: L('Statut', 'Status'), momo_request: L('Demande Mobile Money', 'Mobile Money request'), reverse: L('Contre-passation', 'Reversal'), lock: L('Verrouillage', 'Lock'), close_year: L('Clôture', 'Year close') };
  ctx.el.innerHTML = table({ rows, columns: [
    { label: L('Date', 'Date'), render: (r) => new Date(r.at).toLocaleString('fr-FR') }, { label: L('Utilisateur', 'User'), key: 'user_name' },
    { label: L('Action', 'Action'), render: (r) => esc(A[r.action] || r.action) }, { label: L('Objet', 'Item'), render: (r) => `${esc(r.entity || '')} ${r.entity_id ? '#' + r.entity_id : ''}` },
    { label: L('Détail', 'Detail'), hideM: true, render: (r) => `<span class="muted mono" style="font-size:12px">${esc(r.detail || '')}</span>` }] });
}

export async function syncPage(ctx) {
  ctx.title(L('Synchronisation', 'Sync'));
  const draw = () => {
    const box = net.outbox(), failed = net.failed();
    ctx.el.innerHTML = `<div class="stack"><div class="card"><div class="row between"><h3 style="margin:0">${L('En attente d\'envoi', 'Waiting to send')} (${box.length})</h3>
      <button class="btn primary" id="go" ${box.length ? '' : 'disabled'}>${L('Envoyer maintenant', 'Send now')}</button></div>
      ${box.map((b) => `<div class="alert-it"><span class="dot"></span><div><b>${esc(b.label)}</b><div class="dim">${new Date(b.at).toLocaleString('fr-FR')}</div></div></div>`).join('') || `<p class="muted">${L('Tout est synchronisé.', 'Everything is synced.')}</p>`}</div>
      ${failed.length ? `<div class="card"><div class="row between"><h3 style="margin:0">${L('Refusées par le serveur', 'Rejected by the server')}</h3><button class="btn" id="clr">${L('Effacer', 'Clear')}</button></div>
      ${failed.map((b) => `<div class="alert-it danger"><span class="dot"></span><div><b>${esc(b.label)}</b><div class="muted">${esc(b.error)}</div></div></div>`).join('')}</div>` : ''}</div>`;
    ctx.el.querySelector('#go')?.addEventListener('click', async () => { await flush(); draw(); });
    ctx.el.querySelector('#clr')?.addEventListener('click', () => { clearFailed(); draw(); });
  };
  draw();
}
