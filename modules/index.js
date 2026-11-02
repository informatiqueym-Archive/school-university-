// The sector modules this server runs. The 10 Teknons platforms share the core
// and each adds its module here (restaurant, shop, school, hotel, clinic...).
// The first module in MODULES is the "main" one: it gives the app its name,
// colour and home screen. Modules listed in `requires` are added automatically.
import accounting from './accounting/index.js';
import shop from './shop/index.js';
import hotel from './hotel/index.js';
import restaurant from './restaurant/index.js';
import school from './school/index.js';

export const ALL_MODULES = { accounting, shop, hotel, restaurant, school };

export function loadModules(list = process.env.MODULES || 'accounting') {
  const ids = [];
  const add = (id) => {
    if (!ALL_MODULES[id]) throw new Error(`Unknown module: ${id}`);
    if (ids.includes(id)) return;
    ids.push(id);
    for (const dep of ALL_MODULES[id].requires || []) add(dep);
  };
  list.split(',').map((s) => s.trim()).filter(Boolean).forEach(add);
  // Dependencies migrate first, but the first listed module stays the main one.
  const main = ids[0];
  const ordered = [...ids].sort((a, b) => depth(b) - depth(a));
  const mods = ordered.map((id) => ALL_MODULES[id]);
  mods.main = ALL_MODULES[main];
  return mods;
}
const depth = (id) => (ALL_MODULES[id].requires || []).length ? 0 : 1;
