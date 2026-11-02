// Excel versions of every report.
import { sendXlsx } from '../../core/xlsx.js';

const money = (header, key) => ({ header, key, type: 'money' });

export function exportReport(ctx, company, name, data) {
  const per = data.from ? `Du ${data.from} au ${data.to}` : `Au ${data.to || data.at}`;
  const title = (t) => `${company.name} – ${t}`;
  let sheets;
  switch (name) {
    case 'trial-balance':
      sheets = [{ name: 'Balance', title: title('Balance générale'), subtitle: per, columns: [
        { header: 'Compte', key: 'code', width: 10 }, { header: 'Intitulé', key: 'name', width: 40 }, money('Solde initial D', 'open_debit'), money('Solde initial C', 'open_credit'),
        money('Mouvements D', 'debit'), money('Mouvements C', 'credit'), money('Solde final D', 'close_debit'), money('Solde final C', 'close_credit')],
        rows: data.rows, totals: { code: 'TOTAL', ...data.total } }];
      break;
    case 'general-ledger':
      sheets = [{ name: 'Grand livre', title: title('Grand livre'), subtitle: per, columns: [
        { header: 'Compte', key: 'code', width: 10 }, { header: 'Date', key: 'date', width: 12 }, { header: 'Journal', key: 'journal', width: 8 }, { header: 'Pièce', key: 'number', width: 16 },
        { header: 'Libellé', key: 'label', width: 44 }, { header: 'Tiers', key: 'partner_name', width: 24 }, money('Débit', 'debit'), money('Crédit', 'credit'), money('Solde', 'balance')],
        rows: data.accounts.flatMap((a) => [
          { code: a.code, label: a.name, _bold: true, balance: a.opening || null },
          ...a.lines.map((l) => ({ ...l, code: a.code })),
          { code: '', label: `Total ${a.code}`, debit: a.debit, credit: a.credit, balance: a.balance, _bold: true },
        ]) }];
      break;
    case 'journal':
      sheets = [{ name: 'Journal', title: title('Journal'), subtitle: per, columns: [
        { header: 'Date', key: 'date', width: 12 }, { header: 'Journal', key: 'journal', width: 8 }, { header: 'N°', key: 'number', width: 16 }, { header: 'Compte', key: 'account_code', width: 10 },
        { header: 'Libellé', key: 'label', width: 50 }, { header: 'Tiers', key: 'partner_name', width: 24 }, money('Débit', 'debit'), money('Crédit', 'credit')],
        rows: data.entries.slice().reverse().flatMap((e) => e.lines.map((l) => ({ date: e.date, journal: e.journal, number: e.number, account_code: l.account_code, label: l.label, partner_name: l.partner_name, debit: l.debit, credit: l.credit }))) }];
      break;
    case 'balance-sheet': {
      const side = (secs) => secs.flatMap((s) => [{ label: s.section, value: s.total, _bold: true }, ...s.items.map((i) => ({ label: '   ' + i.label, value: i.value }))]);
      const cols = [{ header: 'Poste', key: 'label', width: 50 }, money('Net (FCFA)', 'value')];
      sheets = [
        { name: 'Actif', title: title('Bilan – Actif'), subtitle: per, columns: cols, rows: side(data.actif), totals: { label: 'TOTAL ACTIF', value: data.total_actif } },
        { name: 'Passif', title: title('Bilan – Passif'), subtitle: per, columns: cols, rows: side(data.passif), totals: { label: 'TOTAL PASSIF', value: data.total_passif } },
      ];
      break;
    }
    case 'income-statement': {
      const t = data.totals;
      const rows = [...data.lines.map((l) => ({ ref: l.ref, label: l.label, value: l.value })),
        { label: 'Marge commerciale', value: t.margin, _bold: true }, { label: 'Valeur ajoutée', value: t.added_value, _bold: true },
        { label: "Excédent brut d'exploitation", value: t.ebe, _bold: true }, { label: "Résultat d'exploitation", value: t.operating, _bold: true },
        { label: 'Résultat financier', value: t.financial, _bold: true }, { label: 'Résultat HAO', value: t.hao, _bold: true }];
      sheets = [{ name: 'Compte de résultat', title: title('Compte de résultat'), subtitle: per, columns: [{ header: 'Comptes', key: 'ref', width: 14 }, { header: 'Libellé', key: 'label', width: 50 }, money('Montant', 'value')], rows, totals: { label: 'RÉSULTAT NET', value: t.net } }];
      break;
    }
    case 'vat':
      sheets = [{ name: 'TVA', title: title('Déclaration de TVA'), subtitle: per, columns: [{ header: 'Rubrique', key: 'label', width: 44 }, money('Montant', 'value')], rows: [
        { label: 'TVA collectée', value: data.collected }, { label: '  dont principal 17,5 %', value: data.collected_split.principal }, { label: '  dont CAC', value: data.collected_split.cac },
        { label: 'TVA déductible', value: data.deductible }, { label: 'TVA à payer', value: data.due, _bold: true }, { label: 'Crédit de TVA', value: data.credit, _bold: true },
        ...data.sales.map((s) => ({ label: `Ventes à ${s.rate} % – base HT`, value: s.base })), ...data.purchases.map((s) => ({ label: `Achats à ${s.rate} % – base HT`, value: s.base })),
      ] }];
      break;
    case 'aged-receivables': case 'aged-payables':
      sheets = [{ name: 'Balance âgée', title: title(name === 'aged-receivables' ? 'Balance âgée clients' : 'Balance âgée fournisseurs'), subtitle: per, columns: [
        { header: 'Tiers', key: 'partner_name', width: 32 }, { header: 'Téléphone', key: 'partner_phone', width: 16 }, money('Non échu', 'current'), money('1–30 j', 'd30'), money('31–60 j', 'd60'),
        money('61–90 j', 'd90'), money('+90 j', 'over90'), money('Total', 'total')], rows: data.rows, totals: { partner_name: 'TOTAL', ...data.total } }];
      break;
    case 'statement':
      sheets = [{ name: 'Relevé', title: title(`Relevé – ${data.partner.name}`), subtitle: per, columns: [
        { header: 'Date', key: 'date', width: 12 }, { header: 'Pièce', key: 'number', width: 16 }, { header: 'Libellé', key: 'label', width: 50 }, money('Débit', 'debit'), money('Crédit', 'credit'), money('Solde', 'balance')],
        rows: data.lines, totals: { label: 'Solde dû', balance: data.balance } }];
      break;
    case 'dashboard':
      sheets = [{ name: 'Tableau de bord', title: title('Tableau de bord'), columns: [{ header: 'Mois', key: 'month', width: 10 }, money('Ventes HT', 'sales'), money('Encaissements', 'cash_in'), money('Décaissements', 'cash_out')], rows: data.series }];
      break;
    default:
      sheets = [{ name: 'Données', columns: [{ header: 'JSON', key: 'v', width: 100 }], rows: [{ v: JSON.stringify(data) }] }];
  }
  return sendXlsx(ctx, `${name}-${(data.to || data.at || '').slice(0, 10)}.xlsx`, sheets);
}
