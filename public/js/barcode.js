// Barcode drawing for shelf and product labels: EAN-13 for 13-digit codes,
// Code 128 for anything else. Returns an SVG string (works in the browser and on the server).
import { isValidEan } from './shop-pricing.js';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Bits(code) {
  const d = code.split('').map(Number);
  let bits = '101';
  const par = PARITY[d[0]];
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

// Code 128 patterns (bar/space widths) for values 0..106
const C128 = '212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112'.split(',');

function code128Bits(text) {
  const vals = [104]; // Start B
  for (const ch of String(text)) {
    const c = ch.charCodeAt(0);
    vals.push(c >= 32 && c <= 126 ? c - 32 : 0);
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  let bits = '';
  for (const v of vals) {
    const w = C128[v];
    for (let i = 0; i < w.length; i++) bits += (i % 2 === 0 ? '1' : '0').repeat(Number(w[i]));
  }
  return bits;
}

const escXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** SVG barcode with the human-readable code under it. */
export function barcodeSvg(code, { height = 46, module = 1.6, text = true } = {}) {
  const c = String(code || '').trim();
  if (!c) return '';
  const bits = /^\d{13}$/.test(c) && isValidEan(c) ? ean13Bits(c) : code128Bits(c);
  const quiet = 10;
  const w = (bits.length + quiet * 2) * module;
  const h = height + (text ? 14 : 0);
  let rects = '';
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i; while (j < bits.length && bits[j] === '1') j++;
      rects += `<rect x="${((i + quiet) * module).toFixed(2)}" y="0" width="${((j - i) * module).toFixed(2)}" height="${height}"/>`;
      i = j;
    } else i++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h}" width="${w.toFixed(1)}" height="${h}" role="img" aria-label="${escXml(c)}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${text ? `<text x="${(w / 2).toFixed(1)}" y="${h - 2}" font-family="monospace" font-size="11" text-anchor="middle">${escXml(c)}</text>` : ''}</svg>`;
}
