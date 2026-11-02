import { SYSCOHADA_ACCOUNTS, accountClass } from './chart.js';

export function migrateAccounting(db) {
  db.migrate('acc-001', `
    CREATE TABLE accounts (
      company_id INTEGER NOT NULL REFERENCES companies(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      class INTEGER NOT NULL,
      system INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (company_id, code)
    );
    CREATE TABLE acc_settings (
      company_id INTEGER PRIMARY KEY REFERENCES companies(id),
      lock_date TEXT DEFAULT '',
      fiscal_year_start TEXT NOT NULL DEFAULT '01-01'
    );
    CREATE TABLE sequences (
      company_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      next INTEGER NOT NULL,
      PRIMARY KEY (company_id, key)
    );
    CREATE TABLE journal_entries (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      journal TEXT NOT NULL,
      number TEXT NOT NULL,
      date TEXT NOT NULL,
      label TEXT NOT NULL,
      ref TEXT DEFAULT '',
      source_type TEXT DEFAULT 'manual',
      source_id INTEGER,
      reversal_of INTEGER,
      reversed_by INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE (company_id, number)
    );
    CREATE INDEX je_company_date ON journal_entries(company_id, date);
    CREATE INDEX je_source ON journal_entries(company_id, source_type, source_id);
    CREATE TABLE journal_lines (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
      company_id INTEGER NOT NULL,
      account_code TEXT NOT NULL,
      partner_id INTEGER REFERENCES partners(id),
      label TEXT DEFAULT '',
      debit INTEGER NOT NULL DEFAULT 0,
      credit INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX jl_account ON journal_lines(company_id, account_code);
    CREATE INDEX jl_entry ON journal_lines(entry_id);
    CREATE INDEX jl_partner ON journal_lines(company_id, partner_id);
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      kind TEXT NOT NULL CHECK (kind IN ('quote','invoice','credit_note','bill')),
      number TEXT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      date TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL,
      supplier_ref TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_total INTEGER NOT NULL DEFAULT 0,
      vat_total INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      credited INTEGER NOT NULL DEFAULT 0,
      ref_doc_id INTEGER REFERENCES documents(id),
      entry_id INTEGER REFERENCES journal_entries(id),
      created_by INTEGER,
      created_at TEXT NOT NULL,
      validated_at TEXT
    );
    CREATE INDEX docs_company ON documents(company_id, kind, status);
    CREATE UNIQUE INDEX docs_number ON documents(company_id, kind, number) WHERE number IS NOT NULL;
    CREATE TABLE document_lines (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      product_id INTEGER REFERENCES products(id),
      description TEXT NOT NULL,
      qty REAL NOT NULL,
      unit TEXT DEFAULT '',
      unit_price INTEGER NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      vat_rate REAL NOT NULL DEFAULT 0,
      account_code TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'service',
      net INTEGER NOT NULL,
      vat INTEGER NOT NULL,
      total INTEGER NOT NULL
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      partner_id INTEGER REFERENCES partners(id),
      document_id INTEGER REFERENCES documents(id),
      date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL,
      account_code TEXT NOT NULL,
      reference TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      provider_ref TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed','cancelled')),
      failure_reason TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      entry_id INTEGER REFERENCES journal_entries(id),
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX pay_company ON payments(company_id, date);
    CREATE INDEX pay_doc ON payments(document_id);
    CREATE INDEX pay_pending ON payments(status) WHERE status = 'pending';
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      date TEXT NOT NULL,
      partner_id INTEGER REFERENCES partners(id),
      description TEXT NOT NULL,
      account_code TEXT NOT NULL,
      net INTEGER NOT NULL,
      vat_rate REAL NOT NULL DEFAULT 0,
      vat INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      method TEXT NOT NULL,
      reference TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'posted',
      entry_id INTEGER REFERENCES journal_entries(id),
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE transfers (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      date TEXT NOT NULL,
      from_account TEXT NOT NULL,
      to_account TEXT NOT NULL,
      amount INTEGER NOT NULL,
      fees INTEGER NOT NULL DEFAULT 0,
      label TEXT DEFAULT '',
      entry_id INTEGER REFERENCES journal_entries(id),
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
  `);
}

export function migrateAccounting2(db) {
  db.migrate('acc-002-paylink', `
    ALTER TABLE documents ADD COLUMN pay_token TEXT;
    CREATE UNIQUE INDEX docs_pay_token ON documents(pay_token) WHERE pay_token IS NOT NULL;
  `);
}

export function seedCompanyAccounting(db, companyId) {
  for (const [code, name] of SYSCOHADA_ACCOUNTS) {
    db.run('INSERT OR IGNORE INTO accounts (company_id, code, name, class, system) VALUES (?,?,?,?,1)', companyId, code, name, accountClass(code));
  }
  db.run('INSERT OR IGNORE INTO acc_settings (company_id) VALUES (?)', companyId);
}
