// Tables shared by all 10 Teknons platforms: companies, users, sessions,
// clients/suppliers, products, alerts, audit log and offline replay keys.
export function migrateCore(db) {
  db.migrate('core-001', `
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      legal_form TEXT DEFAULT '',
      niu TEXT DEFAULT '',            -- Numéro d'Identifiant Unique (contribuable)
      rccm TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT 'Douala',
      country TEXT DEFAULT 'Cameroun',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      bank_details TEXT DEFAULT '',
      momo_number TEXT DEFAULT '',
      om_number TEXT DEFAULT '',
      logo TEXT DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'XAF',
      lang TEXT NOT NULL DEFAULT 'fr',
      vat_enabled INTEGER NOT NULL DEFAULT 1,
      vat_rate REAL NOT NULL DEFAULT 19.25,
      payment_terms_days INTEGER NOT NULL DEFAULT 30,
      quote_validity_days INTEGER NOT NULL DEFAULT 30,
      low_cash_threshold INTEGER NOT NULL DEFAULT 100000,
      large_expense_threshold INTEGER NOT NULL DEFAULT 500000,
      invoice_footer TEXT DEFAULT '',
      modules TEXT NOT NULL DEFAULT 'accounting',
      created_at TEXT NOT NULL
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      phone TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'fr',
      active INTEGER NOT NULL DEFAULT 1,
      last_login TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      kind TEXT NOT NULL CHECK (kind IN ('client','supplier')),
      name TEXT NOT NULL,
      contact TEXT DEFAULT '',
      niu TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX partners_company ON partners(company_id, kind);
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('good','service')),
      code TEXT DEFAULT '',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      unit TEXT DEFAULT 'u',
      price INTEGER NOT NULL DEFAULT 0,
      purchase_price INTEGER NOT NULL DEFAULT 0,
      vat_rate REAL,
      sales_account TEXT,
      purchase_account TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX products_company ON products(company_id);
    CREATE TABLE alerts (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      kind TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      entity TEXT DEFAULT '',
      entity_id INTEGER,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX alerts_company ON alerts(company_id, read);
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      detail TEXT,
      at TEXT NOT NULL
    );
    CREATE INDEX audit_company ON audit_log(company_id, at);
    CREATE TABLE idempotency (
      key TEXT NOT NULL,
      company_id INTEGER NOT NULL,
      status INTEGER NOT NULL,
      response TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (key, company_id)
    );
  `);
}

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
