import path from 'node:path';
import { createApp } from './app.js';
import { createCompany } from './core/routes.js';
import { hashPassword } from './core/auth.js';
import { now } from './core/schema.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const { server, momo, modules, db } = createApp({ dbFile: path.join(dataDir, 'teknons.db') });

// ADMIN_EMAIL + ADMIN_PASSWORD: creates this owner account on start if it doesn't exist yet.
// It joins the first company on the server (e.g. the demo), or creates ADMIN_COMPANY.
const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_COMPANY } = process.env;
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  const email = ADMIN_EMAIL.trim().toLowerCase();
  if (!db.get('SELECT id FROM users WHERE email = ?', email)) {
    const first = db.get('SELECT id FROM companies ORDER BY id LIMIT 1');
    try {
      if (first) {
        if (ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must have at least 8 characters');
        db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)',
          first.id, ADMIN_NAME || 'Administrateur', email, hashPassword(ADMIN_PASSWORD), 'owner', now());
      } else {
        createCompany(db, modules, { company: ADMIN_COMPANY || 'Teknons', name: ADMIN_NAME || 'Administrateur', email, password: ADMIN_PASSWORD });
      }
      console.log(`Admin account created: ${email}`);
    } catch (e) { console.error('Admin account not created:', e.message); }
  }
}

const port = Number(process.env.PORT || 3100);
server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Teknons platform (${modules.map((m) => m.id).join(', ')}) on http://localhost:${port} · Mobile Money: ${momo.mode}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
