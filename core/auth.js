import crypto from 'node:crypto';
import { HttpError, forbidden, bad } from './errors.js';
import { ROLES, can } from './roles.js';
import { now } from './schema.js';

const COOKIE = 'tk_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, got);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.run('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)', token, userId, expires, now());
  db.run('UPDATE users SET last_login = ? WHERE id = ?', now(), userId);
  return { token, expires };
}

/**
 * The Secure flag follows the protocol the browser actually used: behind a proxy
 * (Coolify/Traefik) we trust X-Forwarded-Proto, so an http:// test address still
 * keeps its session cookie. COOKIE_SECURE=1 only applies when no proxy header exists.
 */
export function isHttps(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto) return proto === 'https';
  if (req?.socket?.encrypted) return true;
  return process.env.COOKIE_SECURE === '1';
}

export function sessionCookie(token, expires, req) {
  const secure = isHttps(req) ? '; Secure' : '';
  if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure}`;
}

/** Loads the signed-in user (cookie or Bearer token) onto ctx.user. */
export function authenticator(db) {
  return async (ctx) => {
    const h = ctx.req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : ctx.cookies[COOKIE];
    if (!token) return;
    const row = db.get(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token);
    if (!row || row.expires_at < now() || !row.active) return;
    delete row.password_hash;
    ctx.user = row;
    ctx.token = token;
  };
}

export const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'auth', 'Connexion requise'); };
export const requirePerm = (...perms) => (ctx) => {
  requireUser(ctx);
  if (!perms.some((p) => can(ctx.user, p))) throw forbidden("Votre rôle ne permet pas cette action");
};

// Very small brute-force guard: 8 failed attempts per email per 15 minutes.
const failures = new Map();
export function checkLoginRate(email) {
  const k = String(email).toLowerCase();
  const f = failures.get(k);
  if (f && f.count >= 8 && Date.now() - f.first < 15 * 60e3) throw new HttpError(429, 'rate', 'Trop de tentatives. Réessayez dans 15 minutes.');
}
export function noteLoginFailure(email) {
  const k = String(email).toLowerCase();
  const f = failures.get(k);
  if (!f || Date.now() - f.first > 15 * 60e3) failures.set(k, { count: 1, first: Date.now() });
  else f.count++;
}
export const clearLoginFailures = (email) => failures.delete(String(email).toLowerCase());

export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw bad('weak_password', 'Le mot de passe doit contenir au moins 8 caractères');
}
export function validateRole(role) {
  if (!ROLES[role]) throw bad('role', 'Rôle inconnu');
}
