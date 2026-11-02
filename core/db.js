// SQLite access shared by every Teknons platform. Uses Node's built-in driver,
// so the app has no native dependency to compile on the server.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, at TEXT NOT NULL)');
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  const api = {
    raw: db,
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    exec: (sql) => db.exec(sql),
    /** Runs fn inside a transaction (nested calls join the outer one). */
    tx(fn) {
      if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
      db.exec('BEGIN IMMEDIATE');
      depth = 1;
      try { const r = fn(); db.exec('COMMIT'); return r; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      finally { depth = 0; }
    },
    migrate(id, sql) {
      if (stmt('SELECT id FROM _migrations WHERE id = ?').get(id)) return false;
      api.tx(() => {
        if (typeof sql === 'function') sql(api); else db.exec(sql);
        stmt('INSERT INTO _migrations (id, at) VALUES (?, ?)').run(id, new Date().toISOString());
      });
      return true;
    },
    close: () => db.close(),
  };
  return api;
}
