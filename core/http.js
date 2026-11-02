// Small HTTP layer: routing, JSON bodies, cookies, static files, idempotent
// writes (needed for the offline queue) and uniform error replies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

export function createRouter() {
  const routes = [];
  const add = (method, pattern, ...handlers) => {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, rx, keys, handlers });
  };
  return {
    routes,
    get: (p, ...h) => add('GET', p, ...h),
    post: (p, ...h) => add('POST', p, ...h),
    put: (p, ...h) => add('PUT', p, ...h),
    del: (p, ...h) => add('DELETE', p, ...h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.rx.exec(pathname);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
          return { handlers: r.handlers, params };
        }
      }
      return null;
    },
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req, limit = 2_000_000) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'too_large', 'Requête trop volumineuse');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'bad_json', 'JSON invalide'); }
}

export function createServer({ router, db, publicDir, authenticate, log = console }) {
  const publicRoot = path.resolve(publicDir);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const ctx = {
      req, res, db, url, query: Object.fromEntries(url.searchParams), params: {}, body: {},
      cookies: parseCookies(req.headers.cookie),
      json(data, status = 200, headers = {}) {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
        res.end(JSON.stringify(data));
      },
      send(body, type = 'text/html; charset=utf-8', status = 200, headers = {}) {
        if (res.headersSent) return;
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
        res.end(body);
      },
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const m = router.match(req.method, url.pathname);
      if (!m) {
        if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Route inconnue');
        if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(publicRoot, url.pathname, res);
        throw new HttpError(405, 'method', 'Méthode non autorisée');
      }
      ctx.params = m.params;
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) ctx.body = await readBody(req);
      await authenticate(ctx);
      // Replays of an offline write carry the same key: answer with the stored result.
      const key = req.headers['idempotency-key'];
      if (key && req.method !== 'GET' && ctx.user) {
        const prev = db.get('SELECT status, response FROM idempotency WHERE key = ? AND company_id = ?', key, ctx.user.company_id);
        if (prev) return ctx.json(JSON.parse(prev.response), prev.status, { 'Idempotent-Replay': 'true' });
        const origJson = ctx.json;
        ctx.json = (data, status = 200, headers) => {
          if (status < 500) {
            try { db.run('INSERT OR IGNORE INTO idempotency (key, company_id, status, response, at) VALUES (?,?,?,?,?)', key, ctx.user.company_id, status, JSON.stringify(data), new Date().toISOString()); } catch {}
          }
          origJson(data, status, headers);
        };
      }
      for (const h of m.handlers) {
        const r = await h(ctx);
        if (res.headersSent || res.writableEnded) return;
        if (r !== undefined) return ctx.json(r);
      }
      if (!res.headersSent) ctx.json({ ok: true });
    } catch (e) {
      if (e instanceof HttpError) return ctx.json({ error: e.code, message: e.message, details: e.details }, e.status);
      if (e?.code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(e.message)) return ctx.json({ error: 'duplicate', message: 'Cet élément existe déjà' }, 409);
      log.error(e);
      ctx.json({ error: 'server', message: 'Erreur interne du serveur' }, 500);
    }
  });
}

function serveStatic(root, pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html'); // SPA fallback
  const ext = path.extname(file);
  const noCache = ext === '.html' || file.endsWith('sw.js');
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}
