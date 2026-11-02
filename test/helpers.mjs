import { createApp } from '../app.js';

export async function startApp(env = {}) {
  const app = createApp({ env: { MOMO_MODE: 'simulation', ...env }, jobs: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : type.includes('sheet') ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
  const api = {
    get: (p) => call('GET', p), post: (p, b, h) => call('POST', p, b || {}, h), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p),
    setCookie: (c) => { cookie = c; }, getCookie: () => cookie,
  };
  return { app, base, api, close: () => new Promise((r) => { app.server.closeAllConnections?.(); app.server.close(r); }) };
}

export async function signup(api) {
  const r = await api.post('/api/auth/signup', { company: 'Boulangerie Akwa SARL', name: 'Franck', email: 'franck@test.cm', password: 'motdepasse1' });
  if (r.status !== 201) throw new Error(JSON.stringify(r.data));
  return r.data;
}
