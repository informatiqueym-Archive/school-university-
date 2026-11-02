// FCFA amounts are whole numbers. Helpers to round, format and write them in
// French words ("Arrêtée la présente facture à la somme de ...").
export const roundFcfa = (n) => Math.round(Number(n) || 0);

export function fcfa(n) {
  const v = roundFcfa(n);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (v < 0 ? '-' : '') + s + ' FCFA';
}

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

function below100(n) {
  if (n <= 16) return UNITS[n];
  if (n < 20) return 'dix-' + UNITS[n - 10];
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7) return 'soixante' + (u === 1 ? '-et-' : '-') + below100(10 + u);
  if (t === 8) return 'quatre-vingt' + (u === 0 ? 's' : '-' + UNITS[u]);
  if (t === 9) return 'quatre-vingt-' + below100(10 + u);
  return TENS[t] + (u === 0 ? '' : u === 1 ? '-et-un' : '-' + UNITS[u]);
}
function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  let s = '';
  if (h > 0) s = (h > 1 ? UNITS[h] + '-cent' : 'cent') + (h > 1 && r === 0 ? 's' : '');
  if (r > 0) s += (s ? '-' : '') + below100(r);
  return s;
}
/** French words for a whole number (1990 spelling, hyphens everywhere). */
export function toFrenchWords(num) {
  let n = Math.abs(Math.round(num));
  if (n === 0) return 'zéro';
  const parts = [];
  const scales = [[1e9, 'milliard'], [1e6, 'million'], [1e3, 'mille']];
  for (const [v, name] of scales) {
    const q = Math.floor(n / v);
    if (q > 0) {
      if (name === 'mille') parts.push(q === 1 ? 'mille' : below1000(q).replace(/s$/, '') + '-mille');
      else parts.push(below1000(q) + '-' + name + (q > 1 ? 's' : ''));
      n %= v;
    }
  }
  if (n > 0) parts.push(below1000(n));
  return (num < 0 ? 'moins-' : '') + parts.join('-');
}
export const amountInWords = (n) => {
  const w = toFrenchWords(n);
  return w.charAt(0).toUpperCase() + w.slice(1) + ' francs CFA';
};
