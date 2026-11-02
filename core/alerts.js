import { now } from './schema.js';

/** Creates an alert unless the same unread alert already exists. */
export function raiseAlert(db, bus, companyId, { kind, level = 'info', title, body = '', entity = '', entity_id = null }) {
  if (entity_id != null) {
    const dup = db.get('SELECT id FROM alerts WHERE company_id = ? AND kind = ? AND entity_id = ? AND read = 0', companyId, kind, entity_id);
    if (dup) return dup.id;
  }
  const r = db.run('INSERT INTO alerts (company_id, kind, level, title, body, entity, entity_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
    companyId, kind, level, title, body, entity, entity_id, now());
  bus?.emit(companyId, 'alert', { id: Number(r.lastInsertRowid), kind, level, title, body });
  return Number(r.lastInsertRowid);
}

export function audit(db, ctx, action, entity, entity_id, detail) {
  db.run('INSERT INTO audit_log (company_id, user_id, user_name, action, entity, entity_id, detail, at) VALUES (?,?,?,?,?,?,?,?)',
    ctx.user.company_id, ctx.user.id, ctx.user.name, action, entity, entity_id ?? null,
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)), now());
}
