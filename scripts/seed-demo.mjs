// Creates a realistic demo company (a Douala IT services SME) with 6 months of
// activity, so the platform can be shown to prospects straight away.
//   DATA_DIR=./data node scripts/seed-demo.mjs   → demo@teknons.cm / demo1234
import path from 'node:path';
import { createApp } from '../app.js';
import { createCompany } from '../core/routes.js';
import * as docs from '../modules/accounting/documents.js';
import * as tr from '../modules/accounting/treasury.js';
import { postEntry } from '../modules/accounting/ledger.js';
import { hashPassword } from '../core/auth.js';
import { now } from '../core/schema.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const { db, modules, bus } = createApp({ dbFile: path.join(dataDir, 'teknons.db'), jobs: false });
const email = process.env.DEMO_EMAIL || 'demo@teknons.cm';
if (db.get('SELECT id FROM users WHERE email = ?', email)) { console.log('Demo company already exists:', email); process.exit(0); }

const { companyId, userId } = createCompany(db, modules, { company: 'Kmer Digital Services SARL', name: 'Franck Demo', email, password: process.env.DEMO_PASSWORD || 'demo1234', phone: '673799674' });
db.run(`UPDATE companies SET legal_form = 'SARL au capital de 5 000 000 FCFA', niu = 'M012345678901X', rccm = 'RC/DLA/2021/B/1234', address = 'Rue Joss, Akwa', city = 'Douala',
  phone = '+237 673 799 674', website = 'kmerdigital.cm', momo_number = '673 799 674', om_number = '691 23 45 67', bank_details = 'Afriland First Bank – 10005 00001 01234567890 12',
  invoice_footer = 'Kmer Digital Services SARL · NIU M012345678901X · RCCM RC/DLA/2021/B/1234 · Akwa, Douala' WHERE id = ?`, companyId);
const company = () => db.get('SELECT * FROM companies WHERE id = ?', companyId);
const ctx = { user: { id: userId, company_id: companyId, role: 'owner', name: 'Franck Demo' } };
for (const [name, mail, role] of [['Aline Comptable', 'compta@teknons.cm', 'accountant'], ['Paul Commercial', 'vente@teknons.cm', 'sales'], ['Mireille Caisse', 'caisse@teknons.cm', 'cashier']]) {
  db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)', companyId, name, mail, hashPassword('demo1234'), role, now());
}

const P = (kind, name, phone, city = 'Douala', extra = {}) => Number(db.run('INSERT INTO partners (company_id, kind, name, phone, email, city, contact, niu, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  companyId, kind, name, phone, extra.email || '', city, extra.contact || '', extra.niu || '', now()).lastInsertRowid);
const clients = [
  P('client', 'Hôtel Akwa Palace', '677112233', 'Douala', { contact: 'M. Ngando', email: 'compta@akwapalace.cm' }),
  P('client', 'Pharmacie du Littoral', '699445566', 'Douala', { contact: 'Dr Eboa' }),
  P('client', 'Collège Saint-Michel', '655778899', 'Douala', { contact: 'Économe' }),
  P('client', 'Restaurant Le Wouri', '678990011', 'Douala'),
  P('client', 'Quincaillerie Bonabéri', '690123987', 'Douala'),
  P('client', 'Clinique Bonanjo', '670334455', 'Douala', { contact: 'Mme Tchakounte' }),
  P('client', 'Ets Fotso & Fils', '696556677', 'Yaoundé'),
];
const suppliers = [P('supplier', 'ENEO Cameroun', '', 'Douala'), P('supplier', 'CAMTEL', '', 'Douala'), P('supplier', 'Informatique Plus Akwa', '699001122', 'Douala'), P('supplier', 'SCI Joss Immobilier', '677889900', 'Douala')];
const prod = (kind, name, price, unit = 'u', cost = 0) => Number(db.run('INSERT INTO products (company_id, kind, name, price, purchase_price, unit, created_at) VALUES (?,?,?,?,?,?,?)', companyId, kind, name, price, cost, unit, now()).lastInsertRowid);
const products = {
  site: prod('service', 'Site web vitrine (5 pages)', 450000),
  shop: prod('service', 'Boutique en ligne avec Mobile Money', 1200000),
  app: prod('service', 'Application de gestion sur mesure', 2500000),
  maint: prod('service', 'Maintenance mensuelle', 75000, 'mois'),
  host: prod('service', 'Hébergement et nom de domaine (1 an)', 85000, 'an'),
  train: prod('service', 'Formation IA et prompt engineering', 150000, 'jour'),
  pc: prod('good', 'Ordinateur portable HP ProBook', 420000, 'u', 330000),
  router: prod('good', 'Routeur Wi-Fi + installation', 65000, 'u', 38000),
};

const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return ymd(d); };
const year = new Date().getUTCFullYear();
const safe = (n) => { const d = daysAgo(n); return d < `${year}-01-02` ? `${year}-01-0${2 + (n % 7)}` : d; };

// Opening: capital and bank balance
postEntry(db, { companyId, journal: 'AN', date: `${year}-01-01`, label: 'Soldes d\'ouverture', userId, lines: [
  { account: '5211', debit: 3_200_000 }, { account: '5711', debit: 250_000 }, { account: '5521', debit: 180_000 }, { account: '2442', debit: 1_370_000 }, { account: '101', credit: 5_000_000 },
] });

let seq = 0;
function invoice(clientIdx, items, ago, { pay = 1, method = 'bank', quoteFirst = false, payAgo } = {}) {
  const date = safe(ago);
  const c = company();
  let id;
  const lines = items.map(([p, qty, discount = 0]) => ({ product_id: products[p], qty, discount }));
  if (quoteFirst) {
    const q = docs.createDocument(db, ctx, c, { kind: 'quote', partner_id: clients[clientIdx], date, lines, subject: 'Proposition commerciale' });
    docs.setQuoteStatus(db, ctx, c, q, 'accepted');
    id = docs.convertQuote(db, ctx, c, q);
    db.run('UPDATE documents SET date = ?, due_date = ? WHERE id = ?', date, safe(ago - 30), id);
  } else id = docs.createDocument(db, ctx, c, { kind: 'invoice', partner_id: clients[clientIdx], date, lines });
  docs.validateDocument(db, ctx, c, id);
  const d = db.get('SELECT * FROM documents WHERE id = ?', id);
  if (pay > 0) {
    const amount = Math.round(d.total * pay);
    tr.recordPayment(db, ctx, c, { direction: 'in', document_id: id, amount, method, date: safe(payAgo ?? Math.max(ago - 12, 0)), reference: method === 'bank' ? `VIR${1000 + ++seq}` : method.includes('momo') || method.includes('orange') ? `MP${Date.now() % 1e8}${seq++}` : '' });
  }
  return id;
}
invoice(0, [['site', 1], ['host', 1]], 170, { quoteFirst: true });
invoice(1, [['shop', 1, 10]], 150, { method: 'mtn_momo' });
invoice(2, [['train', 3]], 130, { method: 'orange_money' });
invoice(3, [['site', 1], ['maint', 3]], 110, { method: 'cash' });
invoice(0, [['maint', 3]], 95, { method: 'mtn_momo' });
invoice(4, [['pc', 3], ['router', 2]], 80, { method: 'bank' });
invoice(5, [['app', 1, 5]], 65, { pay: 0.5, method: 'bank', quoteFirst: true });
invoice(6, [['site', 1], ['host', 1]], 50, { pay: 0 });
invoice(2, [['train', 2]], 40, { method: 'orange_money' });
invoice(1, [['maint', 2]], 35, { pay: 0 });
invoice(0, [['train', 1], ['pc', 2]], 20, { pay: 0.3, method: 'mtn_momo' });
invoice(3, [['maint', 1]], 8, { method: 'cash', payAgo: 0 });
invoice(4, [['router', 4]], 3, { pay: 0 });
// Open quotes
const c0 = company();
const q1 = docs.createDocument(db, ctx, c0, { kind: 'quote', partner_id: clients[5], date: daysAgo(6), subject: 'Dossier patient et facturation', lines: [{ product_id: products.app, qty: 1 }, { product_id: products.train, qty: 2 }] });
docs.setQuoteStatus(db, ctx, c0, q1, 'sent');
docs.createDocument(db, ctx, c0, { kind: 'quote', partner_id: clients[2], date: daysAgo(2), subject: 'Portail parents et paiement des frais', lines: [{ product_id: products.shop, qty: 1 }, { product_id: products.host, qty: 1 }] });

// Supplier bills and expenses, month by month
for (let m = 5; m >= 0; m--) {
  const base = m * 30 + 5;
  const c = company();
  const rent = docs.createDocument(db, ctx, c, { kind: 'bill', partner_id: suppliers[3], date: safe(base + 3), supplier_ref: `LOY-${m}`, lines: [{ description: 'Loyer bureau Akwa', qty: 1, unit_price: 250000, vat_rate: 0, account_code: '6222' }] });
  docs.validateDocument(db, ctx, c, rent);
  tr.recordPayment(db, ctx, c, { direction: 'out', document_id: rent, method: 'bank', date: safe(base + 1) });
  const power = docs.createDocument(db, ctx, c, { kind: 'bill', partner_id: suppliers[0], date: safe(base), supplier_ref: `ENEO-${77000 + m}`, lines: [{ description: 'Électricité', qty: 1, unit_price: 45000 + m * 3000, account_code: '6052' }] });
  docs.validateDocument(db, ctx, c, power);
  if (m > 0) tr.recordPayment(db, ctx, c, { direction: 'out', document_id: power, method: 'orange_money', date: safe(base - 4) });
  const net = docs.createDocument(db, ctx, c, { kind: 'bill', partner_id: suppliers[1], date: safe(base), supplier_ref: `CT-${m}`, lines: [{ description: 'Internet fibre 20 Mbps', qty: 1, unit_price: 55000, account_code: '6282' }] });
  docs.validateDocument(db, ctx, c, net);
  tr.recordPayment(db, ctx, c, { direction: 'out', document_id: net, method: 'mtn_momo', date: safe(base - 2) });
  tr.recordExpense(db, bus, ctx, c, { description: 'Carburant groupe électrogène', account_code: '6053', total: 35000 + m * 2500, method: 'cash', date: safe(base - 6) });
  tr.recordExpense(db, bus, ctx, c, { description: 'Transport et déplacements clients', account_code: '614', total: 18000, method: 'mtn_momo', date: safe(base - 9) });
  tr.recordExpense(db, bus, ctx, c, { description: 'Salaires du mois', account_code: '6611', total: 450000, method: 'bank', date: safe(base - 20 > 0 ? base - 20 : 0) });
  tr.recordExpense(db, bus, ctx, c, { description: 'Fournitures de bureau', account_code: '6055', total: 22500, vat_rate: 19.25, method: 'cash', date: safe(base - 12) });
}
const stock = docs.createDocument(db, ctx, company(), { kind: 'bill', partner_id: suppliers[2], date: safe(85), supplier_ref: 'IPA-5521', lines: [{ description: 'Ordinateurs HP ProBook', qty: 5, unit_price: 330000, kind: 'good' }, { description: 'Routeurs Wi-Fi', qty: 6, unit_price: 38000, kind: 'good' }] });
docs.validateDocument(db, ctx, company(), stock);
tr.recordPayment(db, ctx, company(), { direction: 'out', document_id: stock, amount: 1_500_000, method: 'bank', date: safe(80) });
tr.recordTransfer(db, ctx, company(), { from_account: '5711', to_account: '5211', amount: 300000, date: safe(60), label: 'Dépôt de la caisse en banque' });
tr.recordTransfer(db, ctx, company(), { from_account: '5521', to_account: '5711', amount: 150000, fees: 1500, date: safe(25), label: 'Retrait MTN MoMo' });

const { runAlertChecks } = await import('../modules/accounting/reports.js');
const { raiseAlert } = await import('../core/alerts.js');
const { fcfa } = await import('../core/format.js');
runAlertChecks(db, bus, raiseAlert, fcfa);
console.log(`Demo company ready. Sign in with ${email} / ${process.env.DEMO_PASSWORD || 'demo1234'} (also compta@, vente@, caisse@teknons.cm / demo1234).`);
