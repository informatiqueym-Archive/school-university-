// Routes every Teknons platform shares: sign-in, company settings, users and
// roles, clients/suppliers, products and services, alerts, audit log, live events.
import { hashPassword, verifyPassword, createSession, sessionCookie, requireUser, requirePerm, checkLoginRate, noteLoginFailure, clearLoginFailures, validatePassword, validateRole } from './auth.js';
import { ROLES, can } from './roles.js';
import { bad, notFound, forbidden, HttpError } from './errors.js';
import { str, required, int, num, oneOf } from './validate.js';
import { audit } from './alerts.js';
import { now } from './schema.js';

const COMPANY_FIELDS = ['name', 'legal_form', 'niu', 'rccm', 'address', 'city', 'country', 'phone', 'email', 'website', 'bank_details', 'momo_number', 'om_number', 'invoice_footer', 'lang'];

export function publicCompany(c) { return c; }

/** Creates a company with its owner, then lets each module seed its data. */
export function createCompany(db, modules, { company, name, email, password, phone }) {
  const companyName = required(company, 'company', "Le nom de l'entreprise");
  const userName = required(name, 'name', 'Votre nom');
  const mail = required(email, 'email', "L'e-mail").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw bad('email', 'E-mail invalide');
  validatePassword(password);
  return db.tx(() => {
    if (db.get('SELECT id FROM users WHERE email = ?', mail)) throw new HttpError(409, 'email_taken', 'Cet e-mail est déjà utilisé');
    const c = db.run('INSERT INTO companies (name, phone, email, created_at) VALUES (?,?,?,?)', companyName, str(phone), mail, now());
    const companyId = Number(c.lastInsertRowid);
    const u = db.run('INSERT INTO users (company_id, name, email, phone, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)',
      companyId, userName, mail, str(phone), hashPassword(password), 'owner', now());
    for (const m of modules) m.onCompanyCreated?.(db, companyId);
    return { companyId, userId: Number(u.lastInsertRowid) };
  });
}

export function registerCoreRoutes(r, { db, bus, modules, env = process.env }) {
  const signupOpen = () => env.ALLOW_SIGNUP === '1' || !db.get('SELECT id FROM companies LIMIT 1');
  const me = (ctx) => {
    const company = db.get('SELECT * FROM companies WHERE id = ?', ctx.user.company_id);
    return {
      user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role, lang: ctx.user.lang },
      company,
      perms: ROLES[ctx.user.role].perms,
      roles: Object.fromEntries(Object.entries(ROLES).filter(([, v]) => !v.only || v.only.some((m) => modules.some((x) => x.id === m))).map(([k, v]) => [k, { fr: v.fr, en: v.en, perms: v.perms }])),
      modules: modules.map((m) => m.id),
      main: (modules.main || modules[0])?.id,
      brand: (modules.main || modules[0])?.brand || null,
    };
  };

  // ---- Auth ----
  r.get('/api/auth/status', (ctx) => ({ signedIn: !!ctx.user, signupOpen: signupOpen(), brand: (modules.main || modules[0])?.brand || null }));
  r.post('/api/auth/signup', (ctx) => {
    if (!signupOpen()) throw forbidden("Les inscriptions sont fermées. Demandez un compte à l'administrateur.");
    const { userId } = createCompany(db, modules, ctx.body);
    const s = createSession(db, userId);
    ctx.user = db.get('SELECT * FROM users WHERE id = ?', userId);
    return ctx.json(me(ctx), 201, { 'Set-Cookie': sessionCookie(s.token, s.expires, ctx.req) });
  });
  r.post('/api/auth/login', (ctx) => {
    const email = str(ctx.body.email).toLowerCase();
    checkLoginRate(email);
    const u = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!u || !u.active || !verifyPassword(String(ctx.body.password || ''), u.password_hash)) {
      noteLoginFailure(email);
      throw new HttpError(401, 'login', 'E-mail ou mot de passe incorrect');
    }
    clearLoginFailures(email);
    const s = createSession(db, u.id);
    ctx.user = u;
    return ctx.json({ ...me(ctx), token: s.token }, 200, { 'Set-Cookie': sessionCookie(s.token, s.expires, ctx.req) });
  });
  r.post('/api/auth/logout', (ctx) => {
    if (ctx.token) db.run('DELETE FROM sessions WHERE token = ?', ctx.token);
    return ctx.json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(null, null, ctx.req) });
  });
  r.get('/api/me', requireUser, (ctx) => me(ctx));
  r.put('/api/me', requireUser, (ctx) => {
    const lang = oneOf(ctx.body.lang, ['fr', 'en'], 'lang', ctx.user.lang);
    db.run('UPDATE users SET name = ?, lang = ?, phone = ? WHERE id = ?', str(ctx.body.name) || ctx.user.name, lang, str(ctx.body.phone ?? ctx.user.phone), ctx.user.id);
    return { ok: true };
  });
  r.post('/api/me/password', requireUser, (ctx) => {
    const u = db.get('SELECT password_hash FROM users WHERE id = ?', ctx.user.id);
    if (!verifyPassword(String(ctx.body.current || ''), u.password_hash)) throw bad('password', 'Mot de passe actuel incorrect');
    validatePassword(ctx.body.password);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(ctx.body.password), ctx.user.id);
    db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', ctx.user.id, ctx.token || '');
    return { ok: true };
  });

  // ---- Company settings ----
  r.get('/api/company', requireUser, (ctx) => db.get('SELECT * FROM companies WHERE id = ?', ctx.user.company_id));
  r.put('/api/company', requirePerm('settings'), (ctx) => {
    const b = ctx.body; const id = ctx.user.company_id;
    const cur = db.get('SELECT * FROM companies WHERE id = ?', id);
    const v = Object.fromEntries(COMPANY_FIELDS.map((f) => [f, b[f] === undefined ? cur[f] : str(b[f], 2000)]));
    if (!v.name) throw bad('required', "Le nom de l'entreprise est obligatoire");
    if (b.logo !== undefined) {
      const logo = String(b.logo || '');
      if (logo && (!/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(logo) || logo.length > 400_000)) throw bad('logo', 'Logo invalide (PNG/JPG, 300 Ko max)');
      v.logo = logo;
    } else v.logo = cur.logo;
    db.run(`UPDATE companies SET ${COMPANY_FIELDS.map((f) => `${f} = ?`).join(', ')}, logo = ?, vat_enabled = ?, vat_rate = ?, payment_terms_days = ?, quote_validity_days = ?, low_cash_threshold = ?, large_expense_threshold = ? WHERE id = ?`,
      ...COMPANY_FIELDS.map((f) => v[f]), v.logo,
      b.vat_enabled === undefined ? cur.vat_enabled : (b.vat_enabled ? 1 : 0),
      num(b.vat_rate, 'vat_rate', { min: 0, def: cur.vat_rate }),
      int(b.payment_terms_days, 'payment_terms_days', { min: 0, def: cur.payment_terms_days }),
      int(b.quote_validity_days, 'quote_validity_days', { min: 1, def: cur.quote_validity_days }),
      int(b.low_cash_threshold, 'low_cash_threshold', { min: 0, def: cur.low_cash_threshold }),
      int(b.large_expense_threshold, 'large_expense_threshold', { min: 0, def: cur.large_expense_threshold }), id);
    audit(db, ctx, 'update', 'company', id);
    bus.emit(id, 'change', { entity: 'company' });
    return db.get('SELECT * FROM companies WHERE id = ?', id);
  });

  // ---- Users ----
  const userCols = 'id, name, email, phone, role, lang, active, last_login, created_at';
  r.get('/api/users', requirePerm('users'), (ctx) => db.all(`SELECT ${userCols} FROM users WHERE company_id = ? ORDER BY name`, ctx.user.company_id));
  r.post('/api/users', requirePerm('users'), (ctx) => {
    const b = ctx.body;
    validateRole(b.role);
    if (b.role === 'owner' && ctx.user.role !== 'owner') throw forbidden('Seul le propriétaire peut créer un autre propriétaire');
    validatePassword(b.password);
    const email = required(b.email, 'email', "L'e-mail").toLowerCase();
    if (db.get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'email_taken', 'Cet e-mail est déjà utilisé');
    const res = db.run('INSERT INTO users (company_id, name, email, phone, password_hash, role, lang, created_at) VALUES (?,?,?,?,?,?,?,?)',
      ctx.user.company_id, required(b.name, 'name', 'Le nom'), email, str(b.phone), hashPassword(b.password), b.role, oneOf(b.lang, ['fr', 'en'], 'lang', 'fr'), now());
    audit(db, ctx, 'create', 'user', Number(res.lastInsertRowid), { email, role: b.role });
    return ctx.json(db.get(`SELECT ${userCols} FROM users WHERE id = ?`, res.lastInsertRowid), 201);
  });
  r.put('/api/users/:id', requirePerm('users'), (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id = ? AND company_id = ?', ctx.params.id, ctx.user.company_id);
    if (!u) throw notFound();
    const b = ctx.body;
    const role = b.role ?? u.role; validateRole(role);
    if ((role === 'owner' || u.role === 'owner') && role !== u.role && ctx.user.role !== 'owner') throw forbidden('Seul le propriétaire peut changer ce rôle');
    const active = b.active === undefined ? u.active : (b.active ? 1 : 0);
    if (u.id === ctx.user.id && (!active || role !== u.role)) throw bad('self', 'Vous ne pouvez pas modifier votre propre rôle ou vous désactiver');
    db.run('UPDATE users SET name = ?, phone = ?, role = ?, active = ?, lang = ? WHERE id = ?', str(b.name) || u.name, str(b.phone ?? u.phone), role, active, oneOf(b.lang, ['fr', 'en'], 'lang', u.lang), u.id);
    if (b.password) { validatePassword(b.password); db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), u.id); }
    if (!active || b.password) db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    audit(db, ctx, 'update', 'user', u.id, { role, active });
    return db.get(`SELECT ${userCols} FROM users WHERE id = ?`, u.id);
  });

  // ---- Clients and suppliers ----
  const partnerPerm = (kind) => (kind === 'supplier' ? ['purchases', 'accounting'] : ['sales', 'treasury', 'accounting']);
  r.get('/api/partners', requirePerm('read'), (ctx) => {
    const kind = oneOf(ctx.query.kind, ['client', 'supplier'], 'kind', 'client');
    const q = `%${str(ctx.query.q)}%`;
    return db.all(`SELECT * FROM partners WHERE company_id = ? AND kind = ? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) ${ctx.query.all ? '' : 'AND active = 1'} ORDER BY name LIMIT 500`,
      ctx.user.company_id, kind, q, q, q);
  });
  r.get('/api/partners/:id', requirePerm('read'), (ctx) => {
    const p = db.get('SELECT * FROM partners WHERE id = ? AND company_id = ?', ctx.params.id, ctx.user.company_id);
    if (!p) throw notFound();
    return p;
  });
  const partnerValues = (b) => [required(b.name, 'name', 'Le nom'), str(b.contact), str(b.niu, 40), str(b.phone, 40), str(b.email), str(b.address), str(b.city), str(b.notes, 2000)];
  r.post('/api/partners', requireUser, (ctx) => {
    const kind = oneOf(ctx.body.kind, ['client', 'supplier'], 'kind');
    if (!partnerPerm(kind).some((p) => can(ctx.user, p))) throw forbidden();
    const res = db.run('INSERT INTO partners (company_id, kind, name, contact, niu, phone, email, address, city, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ctx.user.company_id, kind, ...partnerValues(ctx.body), now());
    audit(db, ctx, 'create', kind, Number(res.lastInsertRowid));
    return ctx.json(db.get('SELECT * FROM partners WHERE id = ?', res.lastInsertRowid), 201);
  });
  r.put('/api/partners/:id', requireUser, (ctx) => {
    const p = db.get('SELECT * FROM partners WHERE id = ? AND company_id = ?', ctx.params.id, ctx.user.company_id);
    if (!p) throw notFound();
    if (!partnerPerm(p.kind).some((x) => can(ctx.user, x))) throw forbidden();
    db.run('UPDATE partners SET name = ?, contact = ?, niu = ?, phone = ?, email = ?, address = ?, city = ?, notes = ?, active = ? WHERE id = ?',
      ...partnerValues({ ...p, ...ctx.body }), ctx.body.active === undefined ? p.active : (ctx.body.active ? 1 : 0), p.id);
    audit(db, ctx, 'update', p.kind, p.id);
    return db.get('SELECT * FROM partners WHERE id = ?', p.id);
  });

  // ---- Products and services ----
  r.get('/api/products', requirePerm('read'), (ctx) => {
    const q = `%${str(ctx.query.q)}%`;
    return db.all(`SELECT * FROM products WHERE company_id = ? AND (name LIKE ? OR code LIKE ?) ${ctx.query.all ? '' : 'AND active = 1'} ORDER BY name LIMIT 1000`, ctx.user.company_id, q, q);
  });
  const productValues = (b) => [
    oneOf(b.kind, ['good', 'service'], 'kind', 'service'), str(b.code, 40), required(b.name, 'name', 'Le nom'), str(b.description, 2000), str(b.unit, 20) || 'u',
    int(b.price, 'price', { min: 0, def: 0 }), int(b.purchase_price, 'purchase_price', { min: 0, def: 0 }),
    b.vat_rate === '' || b.vat_rate == null ? null : num(b.vat_rate, 'vat_rate', { min: 0 }),
    str(b.sales_account, 12) || null, str(b.purchase_account, 12) || null,
  ];
  r.post('/api/products', requirePerm('sales', 'purchases', 'accounting'), (ctx) => {
    const res = db.run('INSERT INTO products (company_id, kind, code, name, description, unit, price, purchase_price, vat_rate, sales_account, purchase_account, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ctx.user.company_id, ...productValues(ctx.body), now());
    audit(db, ctx, 'create', 'product', Number(res.lastInsertRowid));
    return ctx.json(db.get('SELECT * FROM products WHERE id = ?', res.lastInsertRowid), 201);
  });
  r.put('/api/products/:id', requirePerm('sales', 'purchases', 'accounting'), (ctx) => {
    const p = db.get('SELECT * FROM products WHERE id = ? AND company_id = ?', ctx.params.id, ctx.user.company_id);
    if (!p) throw notFound();
    db.run('UPDATE products SET kind = ?, code = ?, name = ?, description = ?, unit = ?, price = ?, purchase_price = ?, vat_rate = ?, sales_account = ?, purchase_account = ?, active = ? WHERE id = ?',
      ...productValues({ ...p, ...ctx.body }), ctx.body.active === undefined ? p.active : (ctx.body.active ? 1 : 0), p.id);
    audit(db, ctx, 'update', 'product', p.id);
    return db.get('SELECT * FROM products WHERE id = ?', p.id);
  });

  // ---- Alerts, audit, live events ----
  r.get('/api/alerts', requirePerm('read'), (ctx) => ({
    unread: db.get('SELECT COUNT(*) n FROM alerts WHERE company_id = ? AND read = 0', ctx.user.company_id).n,
    items: db.all('SELECT * FROM alerts WHERE company_id = ? ORDER BY read, id DESC LIMIT 100', ctx.user.company_id),
  }));
  r.post('/api/alerts/read-all', requirePerm('read'), (ctx) => { db.run('UPDATE alerts SET read = 1 WHERE company_id = ?', ctx.user.company_id); return { ok: true }; });
  r.post('/api/alerts/:id/read', requirePerm('read'), (ctx) => { db.run('UPDATE alerts SET read = 1 WHERE id = ? AND company_id = ?', ctx.params.id, ctx.user.company_id); return { ok: true }; });
  r.get('/api/audit', requirePerm('settings'), (ctx) => db.all('SELECT * FROM audit_log WHERE company_id = ? ORDER BY id DESC LIMIT 300', ctx.user.company_id));
  r.get('/api/events', requireUser, (ctx) => { bus.subscribe(ctx.user.company_id, ctx.res); });
  r.get('/api/health', () => ({ ok: true, time: now() }));

  // The installable app takes the name and colour of the main module.
  r.get('/manifest.webmanifest', (ctx) => {
    const b = (modules.main || modules[0])?.brand || {};
    ctx.send(JSON.stringify({
      name: b.name || 'Teknons', short_name: b.short || 'Teknons', description: b.description || '', start_url: '/', display: 'standalone',
      background_color: b.navy || '#0B1433', theme_color: b.navy || '#0B1433', lang: 'fr',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    }), 'application/manifest+json');
  });
}
