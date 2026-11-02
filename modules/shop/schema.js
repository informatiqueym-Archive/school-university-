// Teknons POS tables: shops and warehouses, tills and cash sessions, articles
// (barcodes, two price levels, scale items), stock per location with lots and
// expiry dates, sales and returns, promotions, loyalty and prepaid accounts,
// purchase orders, transfers and inventory counts.
import { now } from '../../core/schema.js';

export function migrateShop(db) {
  db.migrate('shop-001', `
    CREATE TABLE shop_settings (
      company_id INTEGER PRIMARY KEY REFERENCES companies(id),
      manager_pin_hash TEXT DEFAULT '',
      points_per_amount INTEGER NOT NULL DEFAULT 1000,   -- 1 point for every 1 000 FCFA spent
      point_value INTEGER NOT NULL DEFAULT 5,            -- 1 point = 5 FCFA off
      min_points_redeem INTEGER NOT NULL DEFAULT 100,
      topup_bonus_pct REAL NOT NULL DEFAULT 5,           -- prepaid account: +5 % bonus...
      topup_bonus_min INTEGER NOT NULL DEFAULT 10000,    -- ...for top-ups of 10 000 FCFA or more
      expiry_alert_days INTEGER NOT NULL DEFAULT 30,
      scale_prefix TEXT NOT NULL DEFAULT '21',           -- EAN-13 from the scale: 21 + PLU(5) + weight g(5) + check
      scale_mode TEXT NOT NULL DEFAULT 'weight',         -- 'weight' (grams) or 'price' (FCFA)
      receipt_footer TEXT DEFAULT 'Merci de votre visite !',
      max_discount_pct REAL NOT NULL DEFAULT 10          -- above this, a manager code is needed
    );
    CREATE TABLE shop_stores (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'shop' CHECK (kind IN ('shop','warehouse')),
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE shop_registers (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL REFERENCES shop_stores(id),
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE shop_user_store (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      store_id INTEGER NOT NULL REFERENCES shop_stores(id)
    );
    CREATE TABLE shop_categories (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE shop_items (
      product_id INTEGER PRIMARY KEY REFERENCES products(id),
      company_id INTEGER NOT NULL,
      barcode TEXT DEFAULT '',
      category_id INTEGER REFERENCES shop_categories(id),
      retail_price INTEGER NOT NULL DEFAULT 0,      -- TTC, per unit or per kg
      wholesale_price INTEGER NOT NULL DEFAULT 0,   -- TTC; 0 = same as retail
      wholesale_min_qty REAL NOT NULL DEFAULT 0,    -- retail customers also get the wholesale price from this quantity
      by_weight INTEGER NOT NULL DEFAULT 0,
      plu TEXT DEFAULT '',                          -- 5-digit scale code
      min_stock REAL NOT NULL DEFAULT 0,
      reorder_qty REAL NOT NULL DEFAULT 0,
      track_expiry INTEGER NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,             -- weighted average purchase cost HT
      supplier_id INTEGER REFERENCES partners(id),
      quick INTEGER NOT NULL DEFAULT 0              -- shown as a button on the till
    );
    CREATE UNIQUE INDEX shop_items_barcode ON shop_items(company_id, barcode) WHERE barcode != '';
    CREATE INDEX shop_items_plu ON shop_items(company_id, plu);
    CREATE TABLE shop_stock (
      company_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (store_id, product_id)
    );
    CREATE TABLE shop_lots (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      lot TEXT DEFAULT '',
      expiry TEXT,
      qty REAL NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE INDEX shop_lots_p ON shop_lots(store_id, product_id, expiry);
    CREATE TABLE shop_moves (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty REAL NOT NULL,
      kind TEXT NOT NULL,       -- sale, return, receipt, transfer_out, transfer_in, adjust, count, void
      ref_type TEXT DEFAULT '',
      ref_id INTEGER,
      unit_cost REAL DEFAULT 0,
      note TEXT DEFAULT '',
      user_id INTEGER,
      at TEXT NOT NULL
    );
    CREATE INDEX shop_moves_p ON shop_moves(company_id, product_id, at);
    CREATE TABLE shop_sessions (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      register_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      opening_float INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      expected_cash INTEGER,
      counted_cash INTEGER,
      variance INTEGER,
      close_note TEXT DEFAULT '',
      entry_id INTEGER
    );
    CREATE INDEX shop_sessions_open ON shop_sessions(company_id, status);
    CREATE TABLE shop_customers (
      partner_id INTEGER PRIMARY KEY REFERENCES partners(id),
      company_id INTEGER NOT NULL,
      card_no TEXT DEFAULT '',
      price_level TEXT NOT NULL DEFAULT 'retail' CHECK (price_level IN ('retail','wholesale')),
      credit_limit INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      wallet INTEGER NOT NULL DEFAULT 0,     -- prepaid money (customer deposit, account 419)
      bonus INTEGER NOT NULL DEFAULT 0,      -- free bonus credit, used as a discount
      birthday TEXT DEFAULT ''
    );
    CREATE UNIQUE INDEX shop_customers_card ON shop_customers(company_id, card_no) WHERE card_no != '';
    CREATE TABLE shop_customer_moves (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      partner_id INTEGER NOT NULL,
      kind TEXT NOT NULL,         -- points_earned, points_used, wallet_topup, wallet_used, wallet_refund, bonus_granted, bonus_used, adjust
      points INTEGER NOT NULL DEFAULT 0,
      wallet INTEGER NOT NULL DEFAULT 0,
      bonus INTEGER NOT NULL DEFAULT 0,
      sale_id INTEGER,
      session_id INTEGER,
      method TEXT DEFAULT '',
      note TEXT DEFAULT '',
      user_id INTEGER,
      at TEXT NOT NULL
    );
    CREATE TABLE shop_promos (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('percent','price','bundle','buy_get')),
      product_id INTEGER,          -- one article...
      category_id INTEGER,         -- ...or a whole category
      value REAL NOT NULL DEFAULT 0,   -- percent off, promo unit price, bundle price
      qty REAL NOT NULL DEFAULT 0,     -- bundle size (3 for 1 000) or "buy X"
      free_qty REAL NOT NULL DEFAULT 0, -- "get Y free"
      start_date TEXT,
      end_date TEXT,
      days TEXT DEFAULT '',            -- happy days, e.g. '6,0' (Saturday, Sunday); empty = every day
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE shop_sales (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale','return','topup')),
      customer_id INTEGER REFERENCES partners(id),
      price_level TEXT NOT NULL DEFAULT 'retail',
      gross INTEGER NOT NULL DEFAULT 0,          -- before promotions and discounts (TTC)
      promo_total INTEGER NOT NULL DEFAULT 0,
      discount_total INTEGER NOT NULL DEFAULT 0, -- manual, points and bonus
      total INTEGER NOT NULL DEFAULT 0,          -- TTC to pay
      net_total INTEGER NOT NULL DEFAULT 0,      -- HT
      vat_total INTEGER NOT NULL DEFAULT 0,
      cost_total INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      change_given INTEGER NOT NULL DEFAULT 0,
      credit_amount INTEGER NOT NULL DEFAULT 0,  -- left on the customer's account (invoice in Teknons Compta)
      points_earned INTEGER NOT NULL DEFAULT 0,
      points_used INTEGER NOT NULL DEFAULT 0,
      bonus_used INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
      ref_sale_id INTEGER,
      document_id INTEGER,
      token TEXT,
      offline INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      voided_by INTEGER,
      void_reason TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX shop_sales_c ON shop_sales(company_id, created_at);
    CREATE INDEX shop_sales_s ON shop_sales(session_id);
    CREATE UNIQUE INDEX shop_sales_token ON shop_sales(token) WHERE token IS NOT NULL;
    CREATE TABLE shop_sale_lines (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES shop_sales(id),
      product_id INTEGER,
      description TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price INTEGER NOT NULL,     -- TTC before promotion
      promo_id INTEGER,
      promo_amount INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,          -- TTC after promotion and discounts
      vat_rate REAL NOT NULL,
      net INTEGER NOT NULL,
      vat INTEGER NOT NULL,
      cost INTEGER NOT NULL DEFAULT 0,
      returned_qty REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX shop_sale_lines_s ON shop_sale_lines(sale_id);
    CREATE INDEX shop_sale_lines_p ON shop_sale_lines(product_id);
    CREATE TABLE shop_sale_payments (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES shop_sales(id),
      method TEXT NOT NULL,            -- cash, mtn_momo, orange_money, card, wallet, credit
      amount INTEGER NOT NULL,
      reference TEXT DEFAULT ''
    );
    CREATE TABLE shop_cash_moves (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      kind TEXT NOT NULL,              -- in, out, credit_repayment
      method TEXT NOT NULL DEFAULT 'cash',
      amount INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      partner_id INTEGER,
      payment_id INTEGER,
      user_id INTEGER,
      at TEXT NOT NULL
    );
    CREATE TABLE shop_momo (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      session_id INTEGER,
      provider TEXT NOT NULL,
      phone TEXT NOT NULL,
      amount INTEGER NOT NULL,
      provider_ref TEXT DEFAULT '',
      transaction_id TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT DEFAULT '',
      used_by_sale INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE shop_pos (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      supplier_id INTEGER NOT NULL REFERENCES partners(id),
      store_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
      date TEXT NOT NULL,
      expected_date TEXT,
      total INTEGER NOT NULL DEFAULT 0,
      document_id INTEGER,
      notes TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      received_at TEXT
    );
    CREATE TABLE shop_po_lines (
      id INTEGER PRIMARY KEY,
      po_id INTEGER NOT NULL REFERENCES shop_pos(id),
      product_id INTEGER NOT NULL,
      qty REAL NOT NULL,
      unit_cost INTEGER NOT NULL DEFAULT 0,
      received_qty REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE shop_transfers (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      from_store INTEGER NOT NULL,
      to_store INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','received','cancelled')),
      notes TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      received_by INTEGER,
      received_at TEXT
    );
    CREATE TABLE shop_transfer_lines (
      id INTEGER PRIMARY KEY,
      transfer_id INTEGER NOT NULL REFERENCES shop_transfers(id),
      product_id INTEGER NOT NULL,
      qty REAL NOT NULL,
      received_qty REAL
    );
    CREATE TABLE shop_counts (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
      scope TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      closed_at TEXT,
      variance_value INTEGER
    );
    CREATE TABLE shop_count_lines (
      count_id INTEGER NOT NULL REFERENCES shop_counts(id),
      product_id INTEGER NOT NULL,
      expected REAL NOT NULL,
      counted REAL,
      PRIMARY KEY (count_id, product_id)
    );
  `);
}

export function seedCompanyShop(db, companyId) {
  db.run('INSERT OR IGNORE INTO shop_settings (company_id) VALUES (?)', companyId);
  if (!db.get('SELECT id FROM shop_stores WHERE company_id = ?', companyId)) {
    const s = db.run("INSERT INTO shop_stores (company_id, name, kind, created_at) VALUES (?, 'Boutique principale', 'shop', ?)", companyId, now());
    db.run("INSERT INTO shop_registers (company_id, store_id, name) VALUES (?, ?, 'Caisse 1')", companyId, s.lastInsertRowid);
  }
}
