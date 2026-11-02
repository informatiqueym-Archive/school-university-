// Teknons Compta: accounting & billing module (SYSCOHADA, FCFA, TVA 19,25 %).
import { requirePerm, requireUser } from '../../core/auth.js';
import { bad, notFound, conflict, forbidden } from '../../core/errors.js';
import { str, date as vDate, oneOf } from '../../core/validate.js';
import { audit, raiseAlert } from '../../core/alerts.js';
import { fcfa } from '../../core/format.js';
import { today } from '../../core/schema.js';
import { can } from '../../core/roles.js';
import { sendXlsx } from '../../core/xlsx.js';
import { PROVIDERS } from '../../core/payments/mobile-money.js';
import { migrateAccounting, migrateAccounting2, seedCompanyAccounting } from './schema.js';
import { registerPayLink, payToken, baseUrl } from './paylink.js';
import { CLASSES, JOURNALS, METHODS, DEFAULTS, accountClass } from './chart.js';
import { postEntry, reverseEntry, getEntry, lockDate } from './ledger.js';
import * as docs from './documents.js';
import * as tr from './treasury.js';
import * as rep from './reports.js';
import { renderDocument, renderReport } from './print.js';
import { exportReport } from './exports.js';

export default {
  id: 'accounting',
  name: { fr: 'Teknons Compta', en: 'Teknons Accounting' },
  brand: { name: 'Teknons Compta', short: 'Compta', description: 'Comptabilité et facturation SYSCOHADA, FCFA, Mobile Money.', navy: '#0B1433', accent: '#2F6BFF' },
  migrate: (db) => { migrateAccounting(db); migrateAccounting2(db); },
  onCompanyCreated: seedCompanyAccounting,

  routes(r, { db, bus, momo, env }) {
    const company = (ctx) => db.get('SELECT * FROM companies WHERE id = ?', ctx.user.company_id);
    const cid = (ctx) => ctx.user.company_id;
    const changed = (ctx, entity, id) => bus.emit(cid(ctx), 'change', { entity, id });

    registerPayLink(r, { db, bus, momo, env });

    // ---- Reference data ----
    r.get('/api/accounting/meta', requireUser, (ctx) => ({
      classes: CLASSES, journals: JOURNALS, methods: METHODS, defaults: DEFAULTS, providers: PROVIDERS,
      momo: { mode: momo.mode, aggregator: momo.aggregator, mtn_momo: momo.configured('mtn_momo'), orange_money: momo.configured('orange_money') },
      treasury: tr.treasuryAccounts(db, cid(ctx)), lock_date: lockDate(db, cid(ctx)),
    }));
    r.get('/api/accounts', requirePerm('read'), (ctx) => {
      const rows = db.all(`SELECT a.*, COALESCE((SELECT SUM(debit) - SUM(credit) FROM journal_lines l WHERE l.company_id = a.company_id AND l.account_code = a.code), 0) balance
        FROM accounts a WHERE a.company_id = ? ${ctx.query.all ? '' : 'AND a.active = 1'} ORDER BY a.code`, cid(ctx));
      return rows;
    });
    r.post('/api/accounts', requirePerm('accounting'), (ctx) => {
      const code = str(ctx.body.code, 12);
      if (!/^[1-8]\d{1,7}$/.test(code)) throw bad('code', 'Numéro de compte invalide (2 à 8 chiffres, classes 1 à 8)');
      const name = str(ctx.body.name, 200);
      if (!name) throw bad('name', "L'intitulé est obligatoire");
      db.run('INSERT INTO accounts (company_id, code, name, class) VALUES (?,?,?,?)', cid(ctx), code, name, accountClass(code));
      audit(db, ctx, 'create', 'account', null, code);
      return ctx.json(db.get('SELECT * FROM accounts WHERE company_id = ? AND code = ?', cid(ctx), code), 201);
    });
    r.put('/api/accounts/:code', requirePerm('accounting'), (ctx) => {
      const a = db.get('SELECT * FROM accounts WHERE company_id = ? AND code = ?', cid(ctx), ctx.params.code);
      if (!a) throw notFound('Compte introuvable');
      const active = ctx.body.active === undefined ? a.active : (ctx.body.active ? 1 : 0);
      if (!active && Object.values(DEFAULTS).includes(a.code)) throw conflict('system', 'Ce compte est utilisé automatiquement et ne peut pas être désactivé');
      db.run('UPDATE accounts SET name = ?, active = ? WHERE company_id = ? AND code = ?', str(ctx.body.name, 200) || a.name, active, cid(ctx), a.code);
      return db.get('SELECT * FROM accounts WHERE company_id = ? AND code = ?', cid(ctx), a.code);
    });

    // ---- Quotes, invoices, credit notes, supplier bills ----
    r.get('/api/documents', requirePerm('read'), (ctx) => docs.listDocuments(db, cid(ctx), ctx.query));
    r.get('/api/documents/:id', requirePerm('read'), (ctx) => {
      const d = docs.getDocument(db, cid(ctx), ctx.params.id);
      if (!d) throw notFound('Document introuvable');
      return d;
    });
    r.post('/api/documents', requireUser, (ctx) => {
      const id = docs.createDocument(db, ctx, company(ctx), ctx.body);
      audit(db, ctx, 'create', ctx.body.kind, id);
      changed(ctx, 'document', id);
      return ctx.json(docs.getDocument(db, cid(ctx), id), 201);
    });
    r.put('/api/documents/:id', requireUser, (ctx) => {
      docs.updateDocument(db, ctx, company(ctx), Number(ctx.params.id), ctx.body);
      audit(db, ctx, 'update', 'document', Number(ctx.params.id));
      changed(ctx, 'document', ctx.params.id);
      return docs.getDocument(db, cid(ctx), ctx.params.id);
    });
    r.del('/api/documents/:id', requireUser, (ctx) => {
      docs.deleteDocument(db, ctx, company(ctx), Number(ctx.params.id));
      audit(db, ctx, 'delete', 'document', Number(ctx.params.id));
      changed(ctx, 'document', ctx.params.id);
      return { ok: true };
    });
    r.post('/api/documents/:id/validate', requireUser, (ctx) => {
      const number = docs.validateDocument(db, ctx, company(ctx), Number(ctx.params.id));
      audit(db, ctx, 'validate', 'document', Number(ctx.params.id), number);
      changed(ctx, 'document', ctx.params.id);
      return docs.getDocument(db, cid(ctx), ctx.params.id);
    });
    r.post('/api/documents/:id/status', requireUser, (ctx) => {
      docs.setQuoteStatus(db, ctx, company(ctx), Number(ctx.params.id), ctx.body.status);
      audit(db, ctx, 'status', 'document', Number(ctx.params.id), ctx.body.status);
      changed(ctx, 'document', ctx.params.id);
      return docs.getDocument(db, cid(ctx), ctx.params.id);
    });
    r.post('/api/documents/:id/convert', requireUser, (ctx) => {
      const id = docs.convertQuote(db, ctx, company(ctx), Number(ctx.params.id));
      audit(db, ctx, 'convert', 'document', Number(ctx.params.id), id);
      changed(ctx, 'document', id);
      return ctx.json(docs.getDocument(db, cid(ctx), id), 201);
    });
    r.post('/api/documents/:id/credit-note', requireUser, (ctx) => {
      docs.assertKindPerm(ctx.user, 'credit_note');
      const id = docs.creditNoteFor(db, ctx, company(ctx), Number(ctx.params.id));
      audit(db, ctx, 'create', 'credit_note', id);
      changed(ctx, 'document', id);
      return ctx.json(docs.getDocument(db, cid(ctx), id), 201);
    });
    r.post('/api/documents/:id/duplicate', requireUser, (ctx) => {
      const id = docs.duplicateDocument(db, ctx, company(ctx), Number(ctx.params.id));
      changed(ctx, 'document', id);
      return ctx.json(docs.getDocument(db, cid(ctx), id), 201);
    });

    // ---- Payments and Mobile Money ----
    r.get('/api/payments', requirePerm('read'), (ctx) => tr.listPayments(db, cid(ctx), ctx.query));
    r.post('/api/payments', requireUser, (ctx) => {
      const id = tr.recordPayment(db, ctx, company(ctx), ctx.body);
      const p = db.get('SELECT * FROM payments WHERE id = ?', id);
      audit(db, ctx, 'create', 'payment', id, { amount: p.amount, method: p.method });
      if (p.direction === 'in') raiseAlert(db, bus, cid(ctx), { kind: 'payment_in', level: 'success', title: `Paiement reçu : ${fcfa(p.amount)}`, body: `${METHODS[p.method].fr}, saisi par ${ctx.user.name}.`, entity: 'payment', entity_id: id });
      changed(ctx, 'payment', id);
      return ctx.json(p, 201);
    });
    r.post('/api/payments/momo-request', requireUser, async (ctx) => {
      const id = await tr.requestMobileMoney(db, ctx, company(ctx), momo, ctx.body);
      audit(db, ctx, 'momo_request', 'payment', id);
      changed(ctx, 'payment', id);
      return ctx.json(db.get('SELECT * FROM payments WHERE id = ?', id), 201);
    });
    r.post('/api/payments/:id/check', requirePerm('read'), async (ctx) => {
      const p = db.get('SELECT * FROM payments WHERE id = ? AND company_id = ?', ctx.params.id, cid(ctx));
      if (!p) throw notFound('Paiement introuvable');
      if (p.status === 'pending') await tr.checkPending(db, bus, momo, { paymentId: p.id });
      return db.get('SELECT * FROM payments WHERE id = ?', p.id);
    });
    r.post('/api/payments/:id/cancel', requireUser, (ctx) => {
      tr.cancelPayment(db, ctx, company(ctx), Number(ctx.params.id));
      audit(db, ctx, 'cancel', 'payment', Number(ctx.params.id));
      changed(ctx, 'payment', ctx.params.id);
      return db.get('SELECT * FROM payments WHERE id = ?', ctx.params.id);
    });
    // Operators call this when a payment finishes. We never trust the body: we ask the operator again.
    r.post('/api/momo/callback/:provider', async (ctx) => {
      const provider = oneOf(ctx.params.provider, Object.keys(PROVIDERS), 'provider');
      await tr.checkPending(db, bus, momo, { provider });
      return { ok: true };
    });

    // ---- Expenses and transfers ----
    r.get('/api/expenses', requirePerm('read'), (ctx) => {
      const { from, to } = rep.period(ctx.query);
      return db.all(`SELECT e.*, a.name account_name, p.name partner_name FROM expenses e LEFT JOIN accounts a ON a.company_id = e.company_id AND a.code = e.account_code
        LEFT JOIN partners p ON p.id = e.partner_id WHERE e.company_id = ? AND e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC LIMIT 2000`, cid(ctx), from, to);
    });
    r.post('/api/expenses', requireUser, (ctx) => {
      const id = tr.recordExpense(db, bus, ctx, company(ctx), ctx.body);
      audit(db, ctx, 'create', 'expense', id);
      changed(ctx, 'expense', id);
      return ctx.json(db.get('SELECT * FROM expenses WHERE id = ?', id), 201);
    });
    r.post('/api/expenses/:id/cancel', requireUser, (ctx) => {
      tr.cancelExpense(db, ctx, company(ctx), Number(ctx.params.id));
      audit(db, ctx, 'cancel', 'expense', Number(ctx.params.id));
      changed(ctx, 'expense', ctx.params.id);
      return { ok: true };
    });
    r.get('/api/transfers', requirePerm('read'), (ctx) => db.all('SELECT * FROM transfers WHERE company_id = ? ORDER BY date DESC, id DESC LIMIT 500', cid(ctx)));
    r.post('/api/transfers', requireUser, (ctx) => {
      const id = tr.recordTransfer(db, ctx, company(ctx), ctx.body);
      audit(db, ctx, 'create', 'transfer', id);
      changed(ctx, 'transfer', id);
      return ctx.json(db.get('SELECT * FROM transfers WHERE id = ?', id), 201);
    });
    r.get('/api/treasury', requirePerm('read'), (ctx) => tr.treasurySummary(db, cid(ctx), ctx.query.to));

    // ---- Journal entries ----
    r.get('/api/entries', requirePerm('read'), (ctx) => rep.journalReport(db, cid(ctx), ctx.query));
    r.get('/api/entries/:id', requirePerm('read'), (ctx) => {
      const e = getEntry(db, cid(ctx), ctx.params.id);
      if (!e) throw notFound('Écriture introuvable');
      return e;
    });
    r.post('/api/entries', requirePerm('accounting'), (ctx) => {
      const b = ctx.body;
      const journal = oneOf(b.journal, ['OD', 'AN', 'BQ', 'CA', 'MM'], 'journal', 'OD');
      const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ account: str(l.account, 12), partner_id: l.partner_id || null, label: str(l.label, 300), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
      for (const l of lines) {
        if (l.partner_id && !db.get('SELECT 1 FROM partners WHERE id = ? AND company_id = ?', l.partner_id, cid(ctx))) throw bad('partner', 'Tiers introuvable');
        if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit)) throw bad('amount', 'Les montants FCFA sont des nombres entiers');
      }
      const id = postEntry(db, { companyId: cid(ctx), journal, date: vDate(b.date, 'date', today()), label: str(b.label, 300), ref: str(b.ref, 60), source_type: 'manual', userId: ctx.user.id, lines });
      audit(db, ctx, 'create', 'entry', id);
      changed(ctx, 'entry', id);
      return ctx.json(getEntry(db, cid(ctx), id), 201);
    });
    r.post('/api/entries/:id/reverse', requirePerm('accounting'), (ctx) => {
      const e = getEntry(db, cid(ctx), ctx.params.id);
      if (!e) throw notFound('Écriture introuvable');
      if (e.source_type !== 'manual') throw conflict('source', 'Cette écriture vient d\'un document : annulez le paiement ou faites un avoir');
      const id = reverseEntry(db, { companyId: cid(ctx), entryId: e.id, date: vDate(ctx.body.date, 'date', today()), userId: ctx.user.id });
      audit(db, ctx, 'reverse', 'entry', e.id);
      changed(ctx, 'entry', id);
      return getEntry(db, cid(ctx), id);
    });

    // ---- Period lock and year-end closing ----
    r.put('/api/accounting/lock', requirePerm('accounting'), (ctx) => {
      if (!can(ctx.user, 'settings')) throw forbidden('Seul un administrateur peut clôturer une période');
      const d = ctx.body.lock_date ? vDate(ctx.body.lock_date, 'lock_date') : '';
      db.run('UPDATE acc_settings SET lock_date = ? WHERE company_id = ?', d, cid(ctx));
      audit(db, ctx, 'lock', 'period', null, d || 'unlock');
      return { lock_date: d };
    });
    r.post('/api/accounting/close-year', requirePerm('accounting'), (ctx) => {
      if (!can(ctx.user, 'settings')) throw forbidden('Seul un administrateur peut clôturer un exercice');
      const year = Number(ctx.body.year);
      if (!(year > 2000 && year < 2100)) throw bad('year', 'Exercice invalide');
      const end = `${year}-12-31`;
      if (db.get("SELECT 1 FROM journal_entries WHERE company_id = ? AND source_type = 'closing' AND date = ?", cid(ctx), end)) throw conflict('closed', `L'exercice ${year} est déjà clôturé`);
      const bal = db.all(`SELECT l.account_code code, SUM(l.debit) - SUM(l.credit) b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.company_id = ? AND e.date BETWEEN ? AND ? AND substr(l.account_code,1,1) IN ('6','7','8') GROUP BY l.account_code HAVING b != 0`, cid(ctx), `${year}-01-01`, end);
      const lines = bal.map((x) => (x.b > 0 ? { account: x.code, credit: x.b } : { account: x.code, debit: -x.b }));
      const result = -bal.reduce((s, x) => s + x.b, 0);
      if (result > 0) lines.push({ account: DEFAULTS.result_profit, credit: result });
      if (result < 0) lines.push({ account: DEFAULTS.result_loss, debit: -result });
      if (lines.length < 2) throw bad('empty', 'Aucun mouvement de gestion sur cet exercice');
      const id = postEntry(db, { companyId: cid(ctx), journal: 'OD', date: end, label: `Clôture de l'exercice ${year} : détermination du résultat`, source_type: 'closing', userId: ctx.user.id, lines });
      db.run('UPDATE acc_settings SET lock_date = ? WHERE company_id = ? AND (lock_date IS NULL OR lock_date < ?)', end, cid(ctx), end);
      audit(db, ctx, 'close_year', 'period', id, year);
      changed(ctx, 'entry', id);
      return { entry_id: id, result };
    });

    // Monthly VAT settlement: clears 443x and 445x into 4441 (VAT due) or 4449 (VAT credit).
    r.post('/api/accounting/vat-settlement', requirePerm('accounting'), (ctx) => {
      const to = vDate(ctx.body.to, 'to');
      const bal = db.all(`SELECT l.account_code code, SUM(l.debit) - SUM(l.credit) b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.company_id = ? AND e.date <= ? AND (l.account_code LIKE '443%' OR l.account_code LIKE '445%') GROUP BY l.account_code HAVING b != 0`, cid(ctx), to);
      if (!bal.length) throw bad('empty', 'Aucune TVA à liquider à cette date');
      const lines = bal.map((x) => (x.b > 0 ? { account: x.code, credit: x.b } : { account: x.code, debit: -x.b }));
      const net = bal.reduce((s, x) => s + x.b, 0); // negative = VAT due
      if (net < 0) lines.push({ account: DEFAULTS.vat_due, credit: -net });
      if (net > 0) lines.push({ account: DEFAULTS.vat_credit, debit: net });
      const id = postEntry(db, { companyId: cid(ctx), journal: 'OD', date: to, label: `Liquidation de la TVA au ${to}`, source_type: 'vat', userId: ctx.user.id, lines });
      audit(db, ctx, 'vat_settlement', 'entry', id);
      changed(ctx, 'entry', id);
      return { entry_id: id, due: Math.max(-net, 0), credit: Math.max(net, 0) };
    });

    // ---- Reports (JSON, Excel and printable) ----
    const REPORTS = {
      'dashboard': (ctx) => rep.dashboard(db, cid(ctx)),
      'trial-balance': (ctx) => rep.trialBalance(db, cid(ctx), ctx.query),
      'general-ledger': (ctx) => rep.generalLedger(db, cid(ctx), ctx.query),
      'journal': (ctx) => rep.journalReport(db, cid(ctx), ctx.query),
      'balance-sheet': (ctx) => rep.balanceSheet(db, cid(ctx), ctx.query),
      'income-statement': (ctx) => rep.incomeStatement(db, cid(ctx), ctx.query),
      'vat': (ctx) => rep.vatReport(db, cid(ctx), ctx.query),
      'aged-receivables': (ctx) => rep.agedBalance(db, cid(ctx), ctx.query, 'invoice'),
      'aged-payables': (ctx) => rep.agedBalance(db, cid(ctx), ctx.query, 'bill'),
    };
    r.get('/api/reports/:name', requirePerm('read'), (ctx) => {
      const fn = REPORTS[ctx.params.name];
      if (!fn) throw notFound('Rapport inconnu');
      if (ctx.params.name !== 'dashboard' && !can(ctx.user, 'reports') && !can(ctx.user, 'accounting')) throw forbidden('Votre rôle ne donne pas accès aux états comptables');
      const data = fn(ctx);
      if (ctx.query.format === 'xlsx') return exportReport(ctx, company(ctx), ctx.params.name, data);
      return data;
    });
    r.get('/api/statements/:id', requirePerm('read'), (ctx) => {
      const s = rep.partnerStatement(db, cid(ctx), ctx.params.id, ctx.query);
      if (!s) throw notFound('Tiers introuvable');
      if (ctx.query.format === 'xlsx') return exportReport(ctx, company(ctx), 'statement', s);
      return s;
    });
    r.get('/api/export/:list', requirePerm('read'), (ctx) => exportList(ctx));

    // Printable pages (open in a new tab, then "Enregistrer en PDF")
    r.get('/print/document/:id', requirePerm('read'), (ctx) => {
      const d = docs.getDocument(db, cid(ctx), ctx.params.id);
      if (!d) throw notFound('Document introuvable');
      const payUrl = d.kind === 'invoice' && ['open', 'partial'].includes(d.status) ? `${baseUrl(ctx, env)}/pay/${payToken(db, d.id)}` : null;
      ctx.send(renderDocument(company(ctx), d, { lang: ctx.query.lang === 'en' ? 'en' : 'fr', autoPrint: ctx.query.print === '1', payUrl }));
    });
    r.get('/print/report/:name', requirePerm('read'), (ctx) => {
      if (!can(ctx.user, 'reports') && !can(ctx.user, 'accounting')) throw forbidden();
      let data;
      if (ctx.params.name === 'statement') data = rep.partnerStatement(db, cid(ctx), ctx.query.partner_id, ctx.query);
      else if (ctx.params.name === 'payment') data = tr.listPayments(db, cid(ctx), {}).find((p) => String(p.id) === String(ctx.query.id));
      else data = REPORTS[ctx.params.name]?.(ctx);
      if (!data) throw notFound('Rapport inconnu');
      ctx.send(renderReport(company(ctx), ctx.params.name, data, { autoPrint: ctx.query.print === '1' }));
    });

    function exportList(ctx) {
      const c = company(ctx); const list = ctx.params.list;
      const money = (header, key) => ({ header, key, type: 'money' });
      if (['quote', 'invoice', 'credit_note', 'bill'].includes(list)) {
        const rows = docs.listDocuments(db, cid(ctx), { ...ctx.query, kind: list, limit: 2000 });
        return sendXlsx(ctx, `${list}s-${today()}.xlsx`, [{ name: docs.KIND_LABEL[list], title: `${c.name} – ${docs.KIND_LABEL[list]}s`, columns: [
          { header: 'Numéro', key: 'number', width: 16 }, { header: 'Date', key: 'date', width: 12 }, { header: 'Échéance', key: 'due_date', width: 12 },
          { header: 'Tiers', key: 'partner_name', width: 30 }, { header: 'Statut', key: 'status', width: 12 }, money('Total HT', 'subtotal'), money('TVA', 'vat_total'),
          money('Total TTC', 'total'), money('Payé', 'paid'), money('Reste dû', 'balance')], rows }]);
      }
      if (list === 'payments') {
        const rows = tr.listPayments(db, cid(ctx), ctx.query).map((p) => ({ ...p, method_label: METHODS[p.method]?.fr, dir: p.direction === 'in' ? 'Encaissement' : 'Décaissement' }));
        return sendXlsx(ctx, `paiements-${today()}.xlsx`, [{ name: 'Paiements', title: `${c.name} – Paiements`, columns: [
          { header: 'Date', key: 'date', width: 12 }, { header: 'Sens', key: 'dir', width: 14 }, { header: 'Tiers', key: 'partner_name', width: 28 }, { header: 'Facture', key: 'document_number', width: 16 },
          { header: 'Mode', key: 'method_label', width: 18 }, { header: 'Référence', key: 'reference', width: 18 }, { header: 'Statut', key: 'status', width: 12 }, money('Montant', 'amount')], rows }]);
      }
      if (list === 'expenses') {
        const { from, to } = rep.period(ctx.query);
        const rows = db.all(`SELECT e.*, a.name account_name FROM expenses e LEFT JOIN accounts a ON a.company_id = e.company_id AND a.code = e.account_code WHERE e.company_id = ? AND e.date BETWEEN ? AND ? ORDER BY e.date`, cid(ctx), from, to);
        return sendXlsx(ctx, `depenses-${today()}.xlsx`, [{ name: 'Dépenses', title: `${c.name} – Dépenses`, subtitle: `Du ${from} au ${to}`, columns: [
          { header: 'Date', key: 'date', width: 12 }, { header: 'Description', key: 'description', width: 36 }, { header: 'Compte', key: 'account_code', width: 10 }, { header: 'Intitulé', key: 'account_name', width: 30 },
          money('HT', 'net'), money('TVA', 'vat'), money('TTC', 'total'), { header: 'Mode', key: 'method', width: 14 }, { header: 'Statut', key: 'status', width: 10 }], rows }]);
      }
      if (list === 'partners') {
        const kind = ctx.query.kind === 'supplier' ? 'supplier' : 'client';
        const rows = db.all('SELECT * FROM partners WHERE company_id = ? AND kind = ? ORDER BY name', cid(ctx), kind);
        return sendXlsx(ctx, `${kind}s-${today()}.xlsx`, [{ name: kind === 'client' ? 'Clients' : 'Fournisseurs', columns: [
          { header: 'Nom', key: 'name', width: 30 }, { header: 'Contact', key: 'contact' }, { header: 'Téléphone', key: 'phone', width: 16 }, { header: 'E-mail', key: 'email', width: 26 },
          { header: 'NIU', key: 'niu', width: 16 }, { header: 'Adresse', key: 'address', width: 30 }, { header: 'Ville', key: 'city', width: 14 }], rows }]);
      }
      if (list === 'accounts') {
        const rows = db.all('SELECT code, name, class FROM accounts WHERE company_id = ? ORDER BY code', cid(ctx));
        return sendXlsx(ctx, `plan-comptable.xlsx`, [{ name: 'Plan comptable', title: 'Plan comptable SYSCOHADA', columns: [{ header: 'Compte', key: 'code', width: 10 }, { header: 'Intitulé', key: 'name', width: 60 }, { header: 'Classe', key: 'class', type: 'number', width: 8 }], rows }]);
      }
      throw notFound('Export inconnu');
    }
  },

  /** Background work: Mobile Money status polling and alert checks. */
  jobs({ db, bus, momo }) {
    const poll = setInterval(() => tr.checkPending(db, bus, momo).catch((e) => console.warn('momo poll', e.message)), 10_000);
    const checks = () => { try { rep.runAlertChecks(db, bus, raiseAlert, fcfa); } catch (e) { console.warn('alerts', e.message); } };
    const t = setTimeout(checks, 5_000);
    const alertsTimer = setInterval(checks, 30 * 60_000);
    return () => { clearInterval(poll); clearInterval(alertsTimer); clearTimeout(t); };
  },
};
