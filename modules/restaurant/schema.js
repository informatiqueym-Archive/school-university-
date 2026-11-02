// Teknons Resto tables: dining areas and tables (floor plan), preparation
// stations (kitchen, bar, grill, pastry), menu with options, allergens and
// recipes, ingredient stock, checks (dine-in, takeaway, delivery, QR), their
// lines with course and kitchen status, split payments with tips, cash
// sessions per waiter, reservations and waitlist, loyalty, guest calls from
// the table QR and reviews.
import { now } from '../../core/schema.js';

export function migrateResto(db) {
  db.migrate('resto-001', `
    CREATE TABLE resto_settings (
      company_id INTEGER PRIMARY KEY,
      manager_pin_hash TEXT DEFAULT '',
      service_pct REAL NOT NULL DEFAULT 0,             -- service charge added to dine-in checks (0 = none)
      tip_suggestions TEXT NOT NULL DEFAULT '5,10,15', -- % shown on the QR payment page
      qr_ordering INTEGER NOT NULL DEFAULT 1,          -- guests may order from the table QR
      qr_pay INTEGER NOT NULL DEFAULT 1,               -- guests may pay their bill from the table QR
      qr_auto_send INTEGER NOT NULL DEFAULT 0,         -- 1: QR orders go straight to the kitchen; 0: a waiter confirms
      online_orders INTEGER NOT NULL DEFAULT 1,        -- takeaway / delivery ordering page
      online_reservations INTEGER NOT NULL DEFAULT 1,
      delivery_fee INTEGER NOT NULL DEFAULT 1000,
      min_delivery INTEGER NOT NULL DEFAULT 5000,
      points_per_1000 INTEGER NOT NULL DEFAULT 1,      -- loyalty: points per 1 000 FCFA
      point_value INTEGER NOT NULL DEFAULT 10,         -- 1 point = 10 FCFA
      max_discount_pct REAL NOT NULL DEFAULT 10,       -- above this, manager code
      prep_target_min INTEGER NOT NULL DEFAULT 15,     -- kitchen ticket turns red after this
      reservation_minutes INTEGER NOT NULL DEFAULT 120,
      happy_hour_from TEXT DEFAULT '',                 -- 'HH:MM'
      happy_hour_to TEXT DEFAULT '',
      happy_hour_pct REAL NOT NULL DEFAULT 0,          -- discount on drinks during happy hour
      open_time TEXT NOT NULL DEFAULT '11:00',
      close_time TEXT NOT NULL DEFAULT '23:30',
      receipt_footer TEXT DEFAULT 'Merci et à bientôt !',
      welcome_text TEXT DEFAULT '',
      wifi_name TEXT DEFAULT '',
      wifi_password TEXT DEFAULT '',
      cuisine TEXT DEFAULT ''
    );
    CREATE TABLE resto_areas (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE resto_tables (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      area_id INTEGER NOT NULL REFERENCES resto_areas(id),
      label TEXT NOT NULL,
      seats INTEGER NOT NULL DEFAULT 4,
      shape TEXT NOT NULL DEFAULT 'square' CHECK (shape IN ('square','round','rect','booth')),
      x REAL NOT NULL DEFAULT 0,        -- position on the floor plan, 0-100 %
      y REAL NOT NULL DEFAULT 0,
      qr_token TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX resto_tables_label ON resto_tables(company_id, label);
    CREATE UNIQUE INDEX resto_tables_qr ON resto_tables(qr_token);
    CREATE TABLE resto_stations (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'kitchen' CHECK (kind IN ('kitchen','bar','grill','pastry','other')),
      position INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE resto_categories (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      name_en TEXT DEFAULT '',
      station_id INTEGER REFERENCES resto_stations(id),
      course INTEGER NOT NULL DEFAULT 2,    -- 1 starter, 2 main, 3 dessert, 0 drinks (sent at once)
      drinks INTEGER NOT NULL DEFAULT 0,    -- happy hour, 701 account
      color TEXT DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE resto_items (
      product_id INTEGER PRIMARY KEY REFERENCES products(id),
      company_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL REFERENCES resto_categories(id),
      price INTEGER NOT NULL DEFAULT 0,       -- TTC
      name_en TEXT DEFAULT '',
      description_en TEXT DEFAULT '',
      image TEXT DEFAULT '',
      allergens TEXT DEFAULT '',              -- comma list: gluten, lait, arachide, poisson, crustacés, œuf, soja, sésame...
      tags TEXT DEFAULT '',                   -- signature, épicé, végétarien, vegan, nouveau, sans gluten, halal
      options TEXT NOT NULL DEFAULT '[]',     -- JSON [{ group, required, multi, choices:[{ name, price }] }]
      prep_min INTEGER NOT NULL DEFAULT 0,
      calories INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 1,   -- 0 = sold out today ("86")
      daily_limit INTEGER NOT NULL DEFAULT 0, -- portions per day, 0 = no limit
      qr INTEGER NOT NULL DEFAULT 1,          -- shown on the QR / online menu
      online INTEGER NOT NULL DEFAULT 1,      -- available for takeaway / delivery
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE resto_ingredients (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'kg',
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,           -- weighted average cost per unit, FCFA HT
      supplier_id INTEGER REFERENCES partners(id),
      category TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX resto_ing_name ON resto_ingredients(company_id, name);
    CREATE TABLE resto_recipes (
      product_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL REFERENCES resto_ingredients(id),
      qty REAL NOT NULL,                      -- per portion, in the ingredient's unit
      PRIMARY KEY (product_id, ingredient_id)
    );
    CREATE TABLE resto_stock_moves (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      qty REAL NOT NULL,
      kind TEXT NOT NULL,                     -- sale, void, receipt, waste, adjust, count, staff_meal
      unit_cost REAL NOT NULL DEFAULT 0,
      ref_type TEXT DEFAULT '',
      ref_id INTEGER,
      note TEXT DEFAULT '',
      user_id INTEGER,
      at TEXT NOT NULL
    );
    CREATE INDEX resto_moves_i ON resto_stock_moves(company_id, ingredient_id, at);
    CREATE TABLE resto_sessions (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
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
    CREATE TABLE resto_customers (
      partner_id INTEGER PRIMARY KEY REFERENCES partners(id),
      company_id INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      visits INTEGER NOT NULL DEFAULT 0,
      spent INTEGER NOT NULL DEFAULT 0,
      last_visit TEXT,
      birthday TEXT DEFAULT '',
      allergies TEXT DEFAULT '',
      preferences TEXT DEFAULT '',
      vip INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE resto_orders (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'dine_in' CHECK (kind IN ('dine_in','takeaway','delivery','bar')),
      source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','qr','online','phone','app')),
      table_id INTEGER REFERENCES resto_tables(id),
      covers INTEGER NOT NULL DEFAULT 0,
      server_id INTEGER,
      customer_id INTEGER REFERENCES partners(id),
      guest_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      delivery_status TEXT DEFAULT '',        -- '', pending, preparing, on_the_way, delivered
      courier TEXT DEFAULT '',
      pickup_time TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','void')),
      subtotal INTEGER NOT NULL DEFAULT 0,    -- TTC of active lines (after line discounts)
      discount INTEGER NOT NULL DEFAULT 0,    -- check-level discount TTC
      discount_reason TEXT DEFAULT '',
      service_charge INTEGER NOT NULL DEFAULT 0,
      delivery_fee INTEGER NOT NULL DEFAULT 0,
      points_used INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,       -- to pay (excl. tips)
      paid INTEGER NOT NULL DEFAULT 0,
      tips INTEGER NOT NULL DEFAULT 0,
      net_total INTEGER NOT NULL DEFAULT 0,
      vat_total INTEGER NOT NULL DEFAULT 0,
      cost_total INTEGER NOT NULL DEFAULT 0,
      bill_printed INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      token TEXT NOT NULL,
      document_id INTEGER,
      entry_id INTEGER,
      reservation_id INTEGER,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      void_reason TEXT DEFAULT '',
      created_by INTEGER
    );
    CREATE INDEX resto_orders_st ON resto_orders(company_id, status);
    CREATE INDEX resto_orders_day ON resto_orders(company_id, opened_at);
    CREATE UNIQUE INDEX resto_orders_token ON resto_orders(token);
    CREATE TABLE resto_lines (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES resto_orders(id),
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      unit_price INTEGER NOT NULL,            -- TTC incl. options
      options TEXT DEFAULT '',                -- "À point, Frites"
      note TEXT DEFAULT '',
      seat INTEGER NOT NULL DEFAULT 0,
      course INTEGER NOT NULL DEFAULT 2,
      station_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','held','sent','preparing','ready','served','void')),
      discount_pct REAL NOT NULL DEFAULT 0,
      comp INTEGER NOT NULL DEFAULT 0,        -- offered (on the house)
      total INTEGER NOT NULL DEFAULT 0,       -- TTC after line discount / comp
      vat_rate REAL NOT NULL DEFAULT 0,
      account_code TEXT DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'staff',
      sent_at TEXT, ready_at TEXT, served_at TEXT,
      void_reason TEXT DEFAULT '',
      voided_by INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX resto_lines_o ON resto_lines(order_id);
    CREATE INDEX resto_lines_kds ON resto_lines(station_id, status);
    CREATE TABLE resto_payments (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL REFERENCES resto_orders(id),
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,                -- applied to the check
      tip INTEGER NOT NULL DEFAULT 0,
      tendered INTEGER NOT NULL DEFAULT 0,
      change_given INTEGER NOT NULL DEFAULT 0,
      reference TEXT DEFAULT '',
      payer TEXT DEFAULT '',                  -- split: "Siège 2", "Paul"...
      session_id INTEGER,
      user_id INTEGER,
      source TEXT NOT NULL DEFAULT 'staff',
      at TEXT NOT NULL
    );
    CREATE INDEX resto_pay_o ON resto_payments(order_id);
    CREATE INDEX resto_pay_s ON resto_payments(session_id);
    CREATE TABLE resto_cash_moves (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('in','out')),
      amount INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      user_id INTEGER,
      at TEXT NOT NULL
    );
    CREATE TABLE resto_momo (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      phone TEXT NOT NULL,
      amount INTEGER NOT NULL,
      tip INTEGER NOT NULL DEFAULT 0,
      payer TEXT DEFAULT '',
      provider_ref TEXT DEFAULT '',
      transaction_id TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'staff',
      user_id INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE resto_reservations (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      customer_id INTEGER REFERENCES partners(id),
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      covers INTEGER NOT NULL DEFAULT 2,
      table_id INTEGER REFERENCES resto_tables(id),
      status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('waiting','booked','confirmed','arrived','seated','done','no_show','cancelled')),
      source TEXT NOT NULL DEFAULT 'phone',
      occasion TEXT DEFAULT '',
      note TEXT DEFAULT '',
      deposit INTEGER NOT NULL DEFAULT 0,
      token TEXT NOT NULL,
      order_id INTEGER,
      created_at TEXT NOT NULL,
      seated_at TEXT
    );
    CREATE INDEX resto_res_day ON resto_reservations(company_id, date);
    CREATE TABLE resto_calls (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      table_id INTEGER,
      order_id INTEGER,
      kind TEXT NOT NULL,                     -- waiter, bill, water, other
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      at TEXT NOT NULL,
      done_by INTEGER,
      done_at TEXT
    );
    CREATE TABLE resto_feedback (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      order_id INTEGER,
      rating INTEGER NOT NULL,
      food INTEGER, service INTEGER, ambiance INTEGER,
      comment TEXT DEFAULT '',
      at TEXT NOT NULL
    );
  `);
}

export const STATION_KINDS = {
  kitchen: { fr: 'Cuisine', en: 'Kitchen' }, bar: { fr: 'Bar', en: 'Bar' }, grill: { fr: 'Grill / braise', en: 'Grill' },
  pastry: { fr: 'Pâtisserie', en: 'Pastry' }, other: { fr: 'Autre poste', en: 'Other station' },
};

export const ALLERGENS = ['gluten', 'lait', 'œuf', 'arachide', 'fruits à coque', 'poisson', 'crustacés', 'mollusques', 'soja', 'sésame', 'céleri', 'moutarde', 'sulfites'];

export function seedCompanyResto(db, companyId) {
  db.run('INSERT OR IGNORE INTO resto_settings (company_id) VALUES (?)', companyId);
  for (const [code, name, cls] of [['7011', 'Ventes de boissons', 7], ['7021', 'Ventes de plats et repas (restauration)', 7], ['4281', 'Pourboires dus au personnel', 4]]) {
    if (!db.get('SELECT 1 FROM accounts WHERE company_id = ? AND code = ?', companyId, code)) db.run('INSERT INTO accounts (company_id, code, name, class) VALUES (?,?,?,?)', companyId, code, name, cls);
  }
  if (!db.get('SELECT 1 FROM resto_stations WHERE company_id = ?', companyId)) {
    for (const [name, kind, pos] of [['Cuisine', 'kitchen', 1], ['Bar', 'bar', 2]]) db.run('INSERT INTO resto_stations (company_id, name, kind, position) VALUES (?,?,?,?)', companyId, name, kind, pos);
  }
  if (!db.get('SELECT 1 FROM resto_areas WHERE company_id = ?', companyId)) {
    db.run("INSERT INTO resto_areas (company_id, name, position) VALUES (?, 'Salle', 1)", companyId);
  }
  const by = db.get("SELECT id FROM partners WHERE company_id = ? AND kind = 'client' AND name = 'Clients de passage'", companyId);
  if (!by) db.run("INSERT INTO partners (company_id, kind, name, notes, created_at) VALUES (?, 'client', 'Clients de passage', 'Ventes comptoir payées sur place', ?)", companyId, now());
}
