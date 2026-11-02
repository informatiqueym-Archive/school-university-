import { bad } from './errors.js';

export const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
export function required(v, field, label) {
  const s = str(v);
  if (!s) throw bad('required', `${label || field} est obligatoire`, { field });
  return s;
}
export function int(v, field, { min = -Infinity, def } = {}) {
  if ((v === '' || v == null) && def !== undefined) return def;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min) throw bad('number', `Montant invalide (${field})`, { field });
  return n;
}
export function num(v, field, { min = -Infinity, def } = {}) {
  if ((v === '' || v == null) && def !== undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw bad('number', `Valeur invalide (${field})`, { field });
  return n;
}
export function date(v, field = 'date', def) {
  if (!v && def) return def;
  const s = str(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad('date', `Date invalide (${field})`, { field });
  return s;
}
export function oneOf(v, list, field, def) {
  if ((v == null || v === '') && def !== undefined) return def;
  if (!list.includes(v)) throw bad('choice', `Valeur non autorisée (${field})`, { field });
  return v;
}
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
