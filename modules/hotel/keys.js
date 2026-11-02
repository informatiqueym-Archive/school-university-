// Door key cards (RFID). The front desk encodes a card for the room and the stay
// dates; the card opens the room plus the shared doors chosen (pool, gym, spa,
// lift). Cards are cancelled at check-out, at a room move or when lost.
//
// Lock systems: LOCK_SYSTEM=simulation (default, no hardware) or bridge. With
// "bridge", a small program on the reception PC drives the encoder of the lock
// brand (Salto, Assa Abloy VingCard, dormakaba, Onity, Hune, Adel…) and exposes:
//   POST {LOCK_BRIDGE_URL}/encode  { room, from, to, access[], copies, card_uid? } → { card_uid, lock_ref }
//   POST {LOCK_BRIDGE_URL}/revoke  { card_uid, lock_ref, room }                    → { ok: true }
//   POST {LOCK_BRIDGE_URL}/read                                                    → { card_uid, room, to }
// Header Authorization: Bearer {LOCK_BRIDGE_TOKEN}. The same card UID is then
// read by the RFID reader at the bar, restaurant or spa to charge the room.
import crypto from 'node:crypto';
import { bad, notFound, conflict } from '../../core/errors.js';
import { str, int } from '../../core/validate.js';
import { now } from '../../core/schema.js';
import { audit, raiseAlert } from '../../core/alerts.js';

export const ACCESS = { pool: 'Piscine', gym: 'Salle de sport', spa: 'Spa', lift: 'Ascenseur', parking: 'Parking', lounge: 'Executive lounge', business: 'Business center' };

export function createLocks(env = process.env, fetchImpl = globalThis.fetch) {
  const mode = env.LOCK_SYSTEM === 'bridge' && env.LOCK_BRIDGE_URL ? 'bridge' : 'simulation';
  const call = async (path, body) => {
    const r = await fetchImpl(env.LOCK_BRIDGE_URL.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LOCK_BRIDGE_TOKEN || ''}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw conflict('lock', `Encodeur de cartes : ${j.error || r.status}`);
    return j;
  };
  return {
    mode,
    async encode(o) {
      if (mode === 'bridge') return call('/encode', o);
      return { card_uid: o.card_uid || crypto.randomBytes(4).toString('hex').toUpperCase(), lock_ref: 'SIM-' + crypto.randomBytes(3).toString('hex') };
    },
    async revoke(o) { if (mode === 'bridge') return call('/revoke', o); return { ok: true }; },
  };
}

const cleanUid = (v) => str(v, 40).replace(/[^0-9a-z]/gi, '').toUpperCase();

export async function issueKey(db, bus, locks, ctx, booking, settings, b) {
  if (booking.status !== 'in_house' && !(booking.status === 'confirmed' && booking.room_id)) throw conflict('state', 'Installez le client (check-in) ou attribuez une chambre avant d\'encoder une carte');
  const copies = int(b.copies, 'copies', { min: 1, def: 1 });
  if (copies > 4) throw bad('copies', '4 cartes maximum à la fois');
  const access = (Array.isArray(b.access) ? b.access : String(b.access || '').split(',')).map((x) => x.trim()).filter((x) => ACCESS[x]);
  const room = db.get('SELECT number FROM hotel_rooms WHERE id = ?', booking.room_id);
  const from = `${booking.arrival}T00:00`;
  const to = `${booking.departure > booking.arrival ? booking.departure : booking.arrival}T${booking.kind === 'day_use' ? '23:59' : booking.late_checkout || settings.checkout_time}`;
  const out = [];
  for (let i = 0; i < copies; i++) {
    const res = await locks.encode({ room: room.number, from, to, access, copies: 1, card_uid: i === 0 ? cleanUid(b.card_uid) || undefined : undefined });
    const uid = cleanUid(res.card_uid);
    if (!uid) throw conflict('lock', 'L\'encodeur n\'a pas renvoyé de numéro de carte');
    if (db.get("SELECT id FROM hotel_keys WHERE company_id = ? AND card_uid = ? AND status = 'active'", booking.company_id, uid)) {
      db.run("UPDATE hotel_keys SET status = 'revoked', revoked_at = ? WHERE company_id = ? AND card_uid = ? AND status = 'active'", now(), booking.company_id, uid);
    }
    const r = db.run('INSERT INTO hotel_keys (company_id, booking_id, room_id, card_uid, holder, valid_from, valid_to, access, lock_ref, issued_by, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      booking.company_id, booking.id, booking.room_id, uid, str(b.holder, 80) || booking.guest_name, from, to, access.join(','), str(res.lock_ref, 80), ctx.user.id, now());
    out.push(db.get('SELECT * FROM hotel_keys WHERE id = ?', r.lastInsertRowid));
  }
  audit(db, ctx, 'key_issue', 'booking', booking.id, { room: room.number, copies, access });
  bus.emit(booking.company_id, 'change', { entity: 'key', id: booking.id });
  return out;
}

export async function revokeKey(db, bus, locks, ctx, keyId, status = 'revoked') {
  const k = db.get('SELECT k.*, r.number room FROM hotel_keys k JOIN hotel_rooms r ON r.id = k.room_id WHERE k.id = ? AND k.company_id = ?', keyId, ctx.user.company_id);
  if (!k) throw notFound('Carte introuvable');
  if (k.status !== 'active') throw conflict('state', 'Cette carte est déjà désactivée');
  await locks.revoke({ card_uid: k.card_uid, lock_ref: k.lock_ref, room: k.room });
  db.run('UPDATE hotel_keys SET status = ?, revoked_at = ? WHERE id = ?', status, now(), k.id);
  audit(db, ctx, status === 'lost' ? 'key_lost' : 'key_revoke', 'booking', k.booking_id, { card: k.card_uid, room: k.room });
  if (status === 'lost') raiseAlert(db, bus, ctx.user.company_id, { kind: 'key_lost', level: 'warning', title: `Carte perdue · chambre ${k.room}`, body: `Carte ${k.card_uid} désactivée par ${ctx.user.name}. Encodez une nouvelle carte.`, entity: 'booking', entity_id: k.booking_id });
  bus.emit(ctx.user.company_id, 'change', { entity: 'key', id: k.booking_id });
  return db.get('SELECT * FROM hotel_keys WHERE id = ?', k.id);
}

/** Local cancellation (check-out, room move). The lock bridge also blocks the card when the next guest's card is used. */
export function revokeForBooking(db, companyId, bookingId, status = 'expired', roomId = null) {
  db.run(`UPDATE hotel_keys SET status = ?, revoked_at = ? WHERE company_id = ? AND booking_id = ? AND status = 'active' ${roomId ? 'AND room_id = ?' : ''}`, status, now(), companyId, bookingId, ...(roomId ? [roomId] : []));
}

/** The stay behind a card tapped on the RFID reader (bar, restaurant, spa: "charge to room"). */
export function stayForCard(db, companyId, uid) {
  const k = db.get(`SELECT k.*, b.status booking_status FROM hotel_keys k JOIN hotel_bookings b ON b.id = k.booking_id
    WHERE k.company_id = ? AND k.card_uid = ? AND k.status = 'active' ORDER BY k.id DESC LIMIT 1`, companyId, cleanUid(uid));
  if (!k) throw notFound('Carte inconnue ou désactivée');
  if (k.booking_status !== 'in_house') throw conflict('state', 'Le séjour de cette carte est terminé');
  return k;
}

export function expireKeys(db, companyId) {
  const stamp = new Date(Date.now() + 3600e3).toISOString().slice(0, 16); // Douala time
  return db.run("UPDATE hotel_keys SET status = 'expired', revoked_at = ? WHERE company_id = ? AND status = 'active' AND valid_to < ?", now(), companyId, stamp).changes;
}
