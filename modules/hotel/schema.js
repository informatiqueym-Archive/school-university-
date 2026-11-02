// Teknons Hôtel tables. A stay is a booking whose status is in_house; its folio
// is the list of hotel_folio_lines plus the Compta payments linked to it.
import { now, today } from '../../core/schema.js';

export function migrateHotel(db) {
  db.migrate('hotel-001', `
    CREATE TABLE hotel_settings (
      company_id INTEGER PRIMARY KEY,
      stars INTEGER NOT NULL DEFAULT 5,
      checkin_time TEXT NOT NULL DEFAULT '14:00',
      checkout_time TEXT NOT NULL DEFAULT '12:00',
      business_date TEXT,
      audit_hour INTEGER NOT NULL DEFAULT 4,
      tourist_tax INTEGER NOT NULL DEFAULT 1000,         -- taxe de séjour, FCFA
      tourist_tax_mode TEXT NOT NULL DEFAULT 'room' CHECK (tourist_tax_mode IN ('room','person','none')),
      breakfast_price INTEGER NOT NULL DEFAULT 10000,    -- per person per night when a plan includes it
      deposit_pct INTEGER NOT NULL DEFAULT 30,           -- online bookings
      late_checkout_fee INTEGER NOT NULL DEFAULT 25000,
      eur_rate REAL NOT NULL DEFAULT 655.957,
      usd_rate REAL NOT NULL DEFAULT 600,
      points_per_1000 INTEGER NOT NULL DEFAULT 1,
      lock_system TEXT NOT NULL DEFAULT 'simulation',
      online_booking INTEGER NOT NULL DEFAULT 1,
      welcome_text TEXT DEFAULT '',
      wifi_name TEXT DEFAULT '',
      wifi_password TEXT DEFAULT '',
      manager_pin_hash TEXT
    );
    CREATE TABLE hotel_room_types (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      amenities TEXT DEFAULT '',
      capacity INTEGER NOT NULL DEFAULT 2,
      base_rate INTEGER NOT NULL DEFAULT 0,      -- TTC per night
      weekend_rate INTEGER NOT NULL DEFAULT 0,   -- Friday and Saturday nights, 0 = base
      day_use_rate INTEGER NOT NULL DEFAULT 0,   -- passage / day use
      extra_person INTEGER NOT NULL DEFAULT 0,
      image TEXT DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      online INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE hotel_rooms (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      type_id INTEGER NOT NULL REFERENCES hotel_room_types(id),
      floor TEXT DEFAULT '',
      view TEXT DEFAULT '',
      hk_status TEXT NOT NULL DEFAULT 'clean' CHECK (hk_status IN ('clean','dirty','inspected','cleaning')),
      hk_user_id INTEGER,
      out_of_order INTEGER NOT NULL DEFAULT 0,
      ooo_reason TEXT DEFAULT '',
      dnd INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      portal_token TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE (company_id, number)
    );
    CREATE TABLE hotel_rate_plans (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      adjust_pct REAL NOT NULL DEFAULT 0,        -- -15 = 15 % below the room rate
      breakfast INTEGER NOT NULL DEFAULT 0,      -- breakfast included (charged per person per night)
      refundable INTEGER NOT NULL DEFAULT 1,
      min_nights INTEGER NOT NULL DEFAULT 1,
      partner_id INTEGER,                        -- corporate rate for one company
      online INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE hotel_seasons (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,                     -- inclusive
      adjust_pct REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE hotel_guests (
      partner_id INTEGER PRIMARY KEY REFERENCES partners(id),
      company_id INTEGER NOT NULL,
      title TEXT DEFAULT '',
      nationality TEXT DEFAULT 'Camerounaise',
      id_type TEXT DEFAULT 'CNI',
      id_number TEXT DEFAULT '',
      id_issued_at TEXT DEFAULT '',
      id_issued_on TEXT DEFAULT '',
      birth_date TEXT DEFAULT '',
      birth_place TEXT DEFAULT '',
      profession TEXT DEFAULT '',
      home_address TEXT DEFAULT '',
      vip INTEGER NOT NULL DEFAULT 0,            -- 0 none, 1 VIP, 2 VVIP
      preferences TEXT DEFAULT '',
      allergies TEXT DEFAULT '',
      birthday_reminder INTEGER NOT NULL DEFAULT 1,
      points INTEGER NOT NULL DEFAULT 0,
      blacklisted INTEGER NOT NULL DEFAULT 0,
      blacklist_reason TEXT DEFAULT ''
    );
    CREATE TABLE hotel_bookings (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      guest_id INTEGER NOT NULL REFERENCES partners(id),
      bill_to_id INTEGER NOT NULL REFERENCES partners(id),
      room_type_id INTEGER NOT NULL REFERENCES hotel_room_types(id),
      room_id INTEGER REFERENCES hotel_rooms(id),
      rate_plan_id INTEGER REFERENCES hotel_rate_plans(id),
      group_id INTEGER,
      group_name TEXT DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'night' CHECK (kind IN ('night','day_use')),
      arrival TEXT NOT NULL,
      departure TEXT NOT NULL,
      adults INTEGER NOT NULL DEFAULT 1,
      children INTEGER NOT NULL DEFAULT 0,
      rate INTEGER,                               -- fixed TTC per night (negotiated); null = rate plan
      source TEXT NOT NULL DEFAULT 'direct',
      external_ref TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative','confirmed','in_house','checked_out','cancelled','no_show')),
      eta TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      coming_from TEXT DEFAULT '',
      going_to TEXT DEFAULT '',
      vehicle TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      special_requests TEXT DEFAULT '',
      portal_token TEXT NOT NULL,
      late_checkout TEXT DEFAULT '',
      invoice_id INTEGER,
      cancel_reason TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      checked_in_at TEXT,
      checked_out_at TEXT
    );
    CREATE INDEX hotel_bookings_dates ON hotel_bookings(company_id, arrival, departure);
    CREATE INDEX hotel_bookings_status ON hotel_bookings(company_id, status);
    CREATE UNIQUE INDEX hotel_bookings_ext ON hotel_bookings(company_id, source, external_ref) WHERE external_ref <> '';
    CREATE TABLE hotel_folio_lines (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL REFERENCES hotel_bookings(id),
      date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('room','tax','breakfast','extra','fee')),
      outlet TEXT NOT NULL DEFAULT 'reception',
      night TEXT,                                -- room/tax/breakfast: the night it belongs to
      product_id INTEGER,
      order_id INTEGER,
      description TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      unit_price INTEGER NOT NULL,               -- TTC
      amount INTEGER NOT NULL,                   -- TTC = net + vat
      vat_rate REAL NOT NULL DEFAULT 0,
      net INTEGER NOT NULL,
      vat INTEGER NOT NULL,
      account_code TEXT NOT NULL,
      voided INTEGER NOT NULL DEFAULT 0,
      void_reason TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX hotel_folio_booking ON hotel_folio_lines(booking_id);
    CREATE UNIQUE INDEX hotel_folio_night ON hotel_folio_lines(booking_id, kind, night) WHERE night IS NOT NULL AND voided = 0;
    CREATE TABLE hotel_folio_payments (
      payment_id INTEGER PRIMARY KEY,            -- Compta payments.id
      booking_id INTEGER NOT NULL REFERENCES hotel_bookings(id),
      company_id INTEGER NOT NULL,
      currency TEXT DEFAULT 'XAF',
      foreign_amount REAL,
      kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','deposit','refund')),
      refunded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE hotel_momo (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      phone TEXT NOT NULL,
      amount INTEGER NOT NULL,
      provider_ref TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT DEFAULT '',
      transaction_id TEXT DEFAULT '',
      payment_id INTEGER,
      online INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE hotel_keys (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL REFERENCES hotel_bookings(id),
      room_id INTEGER NOT NULL,
      card_uid TEXT NOT NULL,
      holder TEXT DEFAULT '',
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL,
      access TEXT DEFAULT '',                    -- extra doors: pool, gym, spa, lift
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','lost','expired')),
      lock_ref TEXT DEFAULT '',
      issued_by INTEGER,
      issued_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX hotel_keys_uid ON hotel_keys(company_id, card_uid, status);
    CREATE TABLE hotel_outlets (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'restaurant',   -- restaurant, bar, room_service, minibar, laundry, spa, transport, other
      account_code TEXT NOT NULL DEFAULT '706',
      kitchen INTEGER NOT NULL DEFAULT 0,        -- orders go to the kitchen/bar screen
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE (company_id, code)
    );
    CREATE TABLE hotel_items (
      product_id INTEGER PRIMARY KEY REFERENCES products(id),
      company_id INTEGER NOT NULL,
      outlet_id INTEGER NOT NULL REFERENCES hotel_outlets(id),
      category TEXT DEFAULT '',
      price INTEGER NOT NULL,                    -- TTC
      duration INTEGER NOT NULL DEFAULT 0,       -- minutes (spa, activities)
      portal INTEGER NOT NULL DEFAULT 1,         -- orderable by guests from the room
      image TEXT DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE hotel_orders (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      outlet_id INTEGER NOT NULL,
      booking_id INTEGER,
      room_id INTEGER,
      table_label TEXT DEFAULT '',
      covers INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL DEFAULT 'staff' CHECK (origin IN ('staff','guest')),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','ready','delivered','settled','cancelled')),
      settlement TEXT DEFAULT '',                -- room, paid
      document_id INTEGER,
      total INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX hotel_orders_status ON hotel_orders(company_id, status);
    CREATE TABLE hotel_order_lines (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES hotel_orders(id),
      product_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      price INTEGER NOT NULL,
      note TEXT DEFAULT ''
    );
    CREATE TABLE hotel_appointments (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      booking_id INTEGER,
      guest_name TEXT NOT NULL,
      staff TEXT DEFAULT '',
      start_at TEXT NOT NULL,                    -- YYYY-MM-DDTHH:MM
      duration INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('requested','booked','done','cancelled','no_show')),
      origin TEXT NOT NULL DEFAULT 'staff',
      order_id INTEGER,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE hotel_requests (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      booking_id INTEGER,
      room_id INTEGER,
      kind TEXT NOT NULL,                        -- towels, cleaning, taxi, wakeup, late_checkout, maintenance, concierge, other
      detail TEXT DEFAULT '',
      due_at TEXT DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'guest',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','refused')),
      assigned_to INTEGER,
      created_at TEXT NOT NULL,
      done_at TEXT
    );
    CREATE TABLE hotel_maintenance (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      room_id INTEGER,
      place TEXT DEFAULT '',
      title TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
      blocks_room INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      done_at TEXT
    );
    CREATE TABLE hotel_hk_log (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,                      -- status change, occupied_seen, vacant_seen, minibar
      detail TEXT DEFAULT '',
      date TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX hotel_hk_log_day ON hotel_hk_log(company_id, date);
    CREATE TABLE hotel_lost_found (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      room_id INTEGER,
      place TEXT DEFAULT '',
      item TEXT NOT NULL,
      found_by TEXT DEFAULT '',
      guest_id INTEGER,
      status TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','returned','disposed')),
      note TEXT DEFAULT '',
      found_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE hotel_feedback (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL UNIQUE,
      rating INTEGER NOT NULL,
      cleanliness INTEGER, service INTEGER, food INTEGER,
      comment TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE hotel_daily (
      company_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      rooms INTEGER NOT NULL,
      ooo INTEGER NOT NULL,
      sold INTEGER NOT NULL,
      complimentary INTEGER NOT NULL DEFAULT 0,
      guests INTEGER NOT NULL,
      arrivals INTEGER NOT NULL,
      departures INTEGER NOT NULL,
      no_shows INTEGER NOT NULL,
      room_revenue INTEGER NOT NULL,             -- HT
      other_revenue INTEGER NOT NULL,            -- HT
      payments INTEGER NOT NULL,
      undeclared INTEGER NOT NULL DEFAULT 0,
      by_user INTEGER,
      at TEXT NOT NULL,
      PRIMARY KEY (company_id, date)
    );
    CREATE TABLE hotel_ical (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      room_type_id INTEGER NOT NULL,
      channel TEXT NOT NULL,                     -- booking, airbnb, expedia...
      url TEXT NOT NULL,
      last_sync TEXT,
      last_result TEXT DEFAULT ''
    );
  `);
}

export const OUTLET_KINDS = {
  restaurant: { fr: 'Restaurant', en: 'Restaurant' }, bar: { fr: 'Bar', en: 'Bar' }, room_service: { fr: 'Room service', en: 'Room service' },
  minibar: { fr: 'Minibar', en: 'Minibar' }, laundry: { fr: 'Blanchisserie', en: 'Laundry' }, spa: { fr: 'Spa et bien-être', en: 'Spa & wellness' },
  transport: { fr: 'Transferts et voiture', en: 'Transfers & car' }, events: { fr: 'Salles et événements', en: 'Meeting & events' }, other: { fr: 'Autres services', en: 'Other services' },
};

export function seedCompanyHotel(db, companyId) {
  db.run('INSERT OR IGNORE INTO hotel_settings (company_id, business_date) VALUES (?, ?)', companyId, today());
  if (!db.get("SELECT 1 FROM accounts WHERE company_id = ? AND code = '4428'", companyId)) {
    db.run("INSERT INTO accounts (company_id, code, name, class) VALUES (?, '4428', 'Taxe de séjour collectée à reverser', 4)", companyId);
  }
  for (const [code, name] of [['7061', 'Hébergement (nuitées)'], ['7062', 'Restauration et bar'], ['7063', 'Spa, blanchisserie et autres services hôteliers']]) {
    if (!db.get('SELECT 1 FROM accounts WHERE company_id = ? AND code = ?', companyId, code)) db.run('INSERT INTO accounts (company_id, code, name, class) VALUES (?,?,?,7)', companyId, code, name);
  }
  if (!db.get('SELECT 1 FROM hotel_outlets WHERE company_id = ?', companyId)) {
    for (const [code, name, kind, acc, kitchen] of [
      ['REST', 'Restaurant', 'restaurant', '7062', 1], ['BAR', 'Bar', 'bar', '7062', 1], ['RS', 'Room service', 'room_service', '7062', 1],
      ['MINI', 'Minibar', 'minibar', '7062', 0], ['LAV', 'Blanchisserie', 'laundry', '7063', 0], ['SPA', 'Spa', 'spa', '7063', 0],
      ['TRANS', 'Transferts', 'transport', '7063', 0]]) {
      db.run('INSERT INTO hotel_outlets (company_id, code, name, kind, account_code, kitchen) VALUES (?,?,?,?,?,?)', companyId, code, name, kind, acc, kitchen);
    }
  }
  if (!db.get('SELECT 1 FROM hotel_rate_plans WHERE company_id = ?', companyId)) {
    db.run("INSERT INTO hotel_rate_plans (company_id, code, name, online) VALUES (?, 'BAR', 'Tarif public (chambre seule)', 1)", companyId);
    db.run("INSERT INTO hotel_rate_plans (company_id, code, name, breakfast, online) VALUES (?, 'BB', 'Chambre et petit-déjeuner', 1, 1)", companyId);
  }
  const by = db.get("SELECT id FROM partners WHERE company_id = ? AND kind = 'client' AND name = 'Clients de passage'", companyId);
  if (!by) db.run("INSERT INTO partners (company_id, kind, name, notes, created_at) VALUES (?, 'client', 'Clients de passage', 'Ventes comptoir payées sur place (restaurant, bar, spa)', ?)", companyId, now());
}
