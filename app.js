// Builds the application (database, routes, jobs). Used by server.mjs and tests.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './core/db.js';
import { migrateCore } from './core/schema.js';
import { createRouter, createServer } from './core/http.js';
import { authenticator } from './core/auth.js';
import { registerCoreRoutes } from './core/routes.js';
import { createEventBus } from './core/events.js';
import { createMobileMoney } from './core/payments/mobile-money.js';
import { loadModules } from './modules/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ dbFile = ':memory:', env = process.env, jobs = true, fetchImpl } = {}) {
  const db = openDb(dbFile);
  migrateCore(db);
  const modules = loadModules(env.MODULES);
  for (const m of modules) m.migrate(db);
  const bus = createEventBus();
  const momo = createMobileMoney(env, fetchImpl);
  const router = createRouter();
  registerCoreRoutes(router, { db, bus, modules, env });
  for (const m of modules) m.routes(router, { db, bus, momo, env });
  const server = createServer({ router, db, publicDir: path.join(here, 'public'), authenticate: authenticator(db) });
  const stops = jobs ? modules.map((m) => m.jobs?.({ db, bus, momo })).filter(Boolean) : [];
  server.on('close', () => stops.forEach((s) => s()));
  return { db, server, bus, momo, modules };
}
