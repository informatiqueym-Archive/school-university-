// Talks to the server. When the connection drops (common during power cuts),
// reads come from the last saved copy and writes wait in an outbox that is sent
// automatically when the network is back. Each write carries an
// Idempotency-Key, so a write is never recorded twice.

const CACHE_PREFIX = 'tk:cache:';
const OUTBOX_KEY = 'tk:outbox';
const MAP_KEY = 'tk:tmpmap';
const listeners = new Set();
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export class ApiError extends Error {
  constructor(status, data) { super(data?.message || `Erreur ${status}`); this.status = status; this.data = data; }
}

export const net = {
  online: navigator.onLine,
  outbox: () => store.get(OUTBOX_KEY, []),
  failed: () => store.get(OUTBOX_KEY + ':failed', []),
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { for (const fn of listeners) fn(net); },
};

// Writes that make sense offline. Mobile Money prompts and validations need the server.
const QUEUEABLE = [/^\/api\/partners$/, /^\/api\/products$/, /^\/api\/documents$/, /^\/api\/payments$/, /^\/api\/expenses$/, /^\/api\/transfers$/, /^\/api\/entries$/, /^\/api\/shop\/sales$/, /^\/api\/shop\/counts\/[^/]+\/lines$/, /^\/api\/school\/marks$/, /^\/api\/school\/attendance$/];

async function raw(method, path, body, key) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

function setOnline(v) { if (net.online !== v) { net.online = v; net.emit(); if (v) flush(); } }

export async function get(path, { cache = true } = {}) {
  try {
    const data = await raw('GET', path);
    setOnline(true);
    if (cache) store.set(CACHE_PREFIX + path, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    setOnline(false);
    const hit = store.get(CACHE_PREFIX + path);
    if (hit) return Object.assign(Array.isArray(hit.data) ? [...hit.data] : { ...hit.data }, { _offline: true, _at: hit.at });
    throw new ApiError(0, { message: 'Hors ligne : ces données ne sont pas encore enregistrées sur cet appareil.' });
  }
}

/** Writes. Returns the server's answer, or { _queued: true, _tmp } when saved for later. */
export async function send(method, path, body = {}, { label } = {}) {
  const key = uid();
  try {
    const data = await raw(method, path, body, key);
    setOnline(true);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    setOnline(false);
    if (method === 'POST' && QUEUEABLE.some((rx) => rx.test(path))) {
      const tmp = 'tmp:' + key;
      const box = net.outbox();
      box.push({ key, tmp, method, path, body, label: label || path, at: new Date().toISOString() });
      store.set(OUTBOX_KEY, box);
      net.emit();
      return { _queued: true, _tmp: tmp, id: tmp, ...body };
    }
    throw new ApiError(0, { message: 'Hors ligne : cette action a besoin d\'internet. Réessayez quand la connexion revient.' });
  }
}

// Replace temporary ids (records created offline) with the real ones.
function swapTmp(v, map) {
  if (typeof v === 'string' && v.startsWith('tmp:')) return map[v] ?? v;
  if (Array.isArray(v)) return v.map((x) => swapTmp(x, map));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapTmp(x, map)]));
  return v;
}

let flushing = false;
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    let box = net.outbox();
    const had = box.length;
    const map = store.get(MAP_KEY, {});
    while (box.length) {
      const item = box[0];
      try {
        const res = await raw(item.method, item.path, swapTmp(item.body, map), item.key);
        if (res?.id) map[item.tmp] = res.id;
        store.set(MAP_KEY, map);
      } catch (e) {
        if (!(e instanceof ApiError)) { setOnline(false); break; } // still offline
        const failed = net.failed(); failed.push({ ...item, error: e.message }); store.set(OUTBOX_KEY + ':failed', failed);
      }
      box = net.outbox().slice(1);
      store.set(OUTBOX_KEY, box);
      net.emit();
    }
    if (!box.length && had) { setOnline(true); net.emit(); window.dispatchEvent(new CustomEvent('tk:synced')); }
  } finally { flushing = false; }
}
export const clearFailed = () => { store.del(OUTBOX_KEY + ':failed'); net.emit(); };
export const clearCache = () => { try { Object.keys(localStorage).filter((k) => k.startsWith('tk:')).forEach((k) => localStorage.removeItem(k)); } catch {} };

window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));
setInterval(() => { if (net.outbox().length) flush(); }, 30000);

export const api = {
  get, send, flush,
  post: (p, b, o) => send('POST', p, b, o),
  put: (p, b) => send('PUT', p, b),
  del: (p) => send('DELETE', p),
};
