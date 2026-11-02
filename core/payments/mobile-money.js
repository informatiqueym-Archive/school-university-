// MTN Mobile Money and Orange Money collections, shared by all platforms.
//
// MOMO_MODE=simulation (default): no network call. A request succeeds after
//   ~5 s, or fails when the phone number ends in 0000. Good for demos.
// MOMO_MODE=sandbox | live: calls the operators' APIs with the keys below.
//
// MTN MoMo Collections API (momodeveloper.mtn.com):
//   MTN_MOMO_SUBSCRIPTION_KEY, MTN_MOMO_API_USER, MTN_MOMO_API_KEY,
//   MTN_MOMO_TARGET_ENV (sandbox | mtncameroon), MTN_MOMO_BASE_URL (optional)
// Orange Money Cameroon merchant payment API (from the Orange merchant contract):
//   ORANGE_MONEY_BASE_URL, ORANGE_MONEY_CONSUMER_KEY, ORANGE_MONEY_CONSUMER_SECRET,
//   ORANGE_MONEY_API_USERNAME, ORANGE_MONEY_API_PASSWORD, ORANGE_MONEY_MERCHANT_NUMBER,
//   ORANGE_MONEY_PIN
// Aggregator (one account for both operators, fastest to open):
//   MOMO_AGGREGATOR=campay, CAMPAY_USERNAME, CAMPAY_PASSWORD, CAMPAY_BASE_URL (optional;
//   https://demo.campay.net in sandbox, https://www.campay.net in live)
// PUBLIC_URL is used to build the operators' callback addresses.
import crypto from 'node:crypto';
import { bad } from '../errors.js';

export const PROVIDERS = {
  mtn_momo: { fr: 'MTN Mobile Money', en: 'MTN Mobile Money' },
  orange_money: { fr: 'Orange Money', en: 'Orange Money' },
};

/** Normalises a Cameroon mobile number to 2376XXXXXXXX. */
export function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = '237' + d;
  if (!/^2376\d{8}$/.test(d)) throw bad('phone', 'Numéro de téléphone invalide (ex. 6 77 12 34 56)');
  return d;
}

/** Best guess of the operator from the number prefix (the user can override). */
export function guessProvider(phone) {
  const n = normalizePhone(phone).slice(3);
  const p2 = n.slice(0, 2), p3 = n.slice(0, 3);
  if (p2 === '67' || ['650', '651', '652', '653', '654', '680', '681', '682', '683'].includes(p3)) return 'mtn_momo';
  if (p2 === '69' || ['655', '656', '657', '658', '659', '686', '687', '688', '689'].includes(p3)) return 'orange_money';
  return null;
}

export function createMobileMoney(env = process.env, fetchImpl = globalThis.fetch) {
  const mode = env.MOMO_MODE || 'simulation';
  const sim = new Map();

  const simulation = {
    async request({ phone }) {
      const ref = crypto.randomUUID();
      sim.set(ref, { at: Date.now(), fail: phone.endsWith('0000') });
      return { providerRef: ref, status: 'pending' };
    },
    async status(ref) {
      const s = sim.get(ref);
      if (!s) return { status: 'failed', reason: 'Référence inconnue' };
      if (Date.now() - s.at < 5000) return { status: 'pending' };
      return s.fail ? { status: 'failed', reason: 'Solde insuffisant (simulation)' } : { status: 'successful', transactionId: 'SIM' + ref.slice(0, 8).toUpperCase() };
    },
  };

  // ---- MTN MoMo ----
  let mtnToken = null;
  const mtnBase = env.MTN_MOMO_BASE_URL || (mode === 'live' ? 'https://proxy.momoapi.mtn.com' : 'https://sandbox.momodeveloper.mtn.com');
  const mtnTarget = env.MTN_MOMO_TARGET_ENV || (mode === 'live' ? 'mtncameroon' : 'sandbox');
  async function mtnAuth() {
    if (mtnToken && mtnToken.exp > Date.now() + 60e3) return mtnToken.value;
    const basic = Buffer.from(`${env.MTN_MOMO_API_USER}:${env.MTN_MOMO_API_KEY}`).toString('base64');
    const r = await fetchImpl(`${mtnBase}/collection/token/`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': env.MTN_MOMO_SUBSCRIPTION_KEY } });
    if (!r.ok) throw new Error(`MTN token ${r.status}`);
    const j = await r.json();
    mtnToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return mtnToken.value;
  }
  const mtn = {
    async request({ phone, amount, reference, description }) {
      const ref = crypto.randomUUID();
      const headers = {
        Authorization: `Bearer ${await mtnAuth()}`, 'X-Reference-Id': ref, 'X-Target-Environment': mtnTarget,
        'Ocp-Apim-Subscription-Key': env.MTN_MOMO_SUBSCRIPTION_KEY, 'Content-Type': 'application/json',
      };
      if (env.PUBLIC_URL) headers['X-Callback-Url'] = `${env.PUBLIC_URL}/api/momo/callback/mtn_momo`;
      const r = await fetchImpl(`${mtnBase}/collection/v1_0/requesttopay`, {
        method: 'POST', headers,
        body: JSON.stringify({
          amount: String(amount), currency: mtnTarget === 'sandbox' ? 'EUR' : 'XAF', externalId: reference,
          payer: { partyIdType: 'MSISDN', partyId: phone }, payerMessage: description.slice(0, 160), payeeNote: reference,
        }),
      });
      if (r.status !== 202) throw new Error(`MTN requesttopay ${r.status}: ${await r.text()}`);
      return { providerRef: ref, status: 'pending' };
    },
    async status(ref) {
      const r = await fetchImpl(`${mtnBase}/collection/v1_0/requesttopay/${ref}`, { headers: { Authorization: `Bearer ${await mtnAuth()}`, 'X-Target-Environment': mtnTarget, 'Ocp-Apim-Subscription-Key': env.MTN_MOMO_SUBSCRIPTION_KEY } });
      if (!r.ok) throw new Error(`MTN status ${r.status}`);
      const j = await r.json();
      if (j.status === 'SUCCESSFUL') return { status: 'successful', transactionId: j.financialTransactionId };
      if (j.status === 'FAILED' || j.status === 'REJECTED' || j.status === 'TIMEOUT') return { status: 'failed', reason: j.reason?.message || j.reason || j.status };
      return { status: 'pending' };
    },
  };

  // ---- Orange Money Cameroon ----
  let omToken = null;
  const omBase = env.ORANGE_MONEY_BASE_URL || 'https://api-s1.orange.cm';
  async function omAuth() {
    if (omToken && omToken.exp > Date.now() + 60e3) return omToken.value;
    const basic = Buffer.from(`${env.ORANGE_MONEY_CONSUMER_KEY}:${env.ORANGE_MONEY_CONSUMER_SECRET}`).toString('base64');
    const r = await fetchImpl(`${omBase}/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!r.ok) throw new Error(`Orange token ${r.status}`);
    const j = await r.json();
    omToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return omToken.value;
  }
  const omHeaders = async () => ({
    Authorization: `Bearer ${await omAuth()}`, 'Content-Type': 'application/json',
    'X-AUTH-TOKEN': Buffer.from(`${env.ORANGE_MONEY_API_USERNAME}:${env.ORANGE_MONEY_API_PASSWORD}`).toString('base64'),
  });
  const orange = {
    async request({ phone, amount, reference, description }) {
      const h = await omHeaders();
      const init = await fetchImpl(`${omBase}/omcoreapis/1.0.2/mp/init`, { method: 'POST', headers: h });
      if (!init.ok) throw new Error(`Orange init ${init.status}`);
      const payToken = (await init.json())?.data?.payToken;
      const r = await fetchImpl(`${omBase}/omcoreapis/1.0.2/mp/pay`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          notifUrl: env.PUBLIC_URL ? `${env.PUBLIC_URL}/api/momo/callback/orange_money` : '',
          channelUserMsisdn: env.ORANGE_MONEY_MERCHANT_NUMBER, amount: String(amount), subscriberMsisdn: phone.slice(3),
          pin: env.ORANGE_MONEY_PIN, orderId: reference, description: description.slice(0, 120), payToken,
        }),
      });
      if (!r.ok) throw new Error(`Orange pay ${r.status}: ${await r.text()}`);
      return { providerRef: payToken, status: 'pending' };
    },
    async status(ref) {
      const r = await fetchImpl(`${omBase}/omcoreapis/1.0.2/mp/paymentstatus/${ref}`, { headers: await omHeaders() });
      if (!r.ok) throw new Error(`Orange status ${r.status}`);
      const s = String((await r.json())?.data?.status || '').toUpperCase();
      if (s.startsWith('SUCCESS')) return { status: 'successful', transactionId: ref };
      if (s === 'FAILED' || s === 'CANCELLED' || s === 'EXPIRED') return { status: 'failed', reason: s };
      return { status: 'pending' };
    },
  };

  // ---- Campay (MTN + Orange through one merchant account) ----
  let cpToken = null;
  const cpBase = env.CAMPAY_BASE_URL || (mode === 'live' ? 'https://www.campay.net' : 'https://demo.campay.net');
  async function cpAuth() {
    if (cpToken && cpToken.exp > Date.now() + 60e3) return cpToken.value;
    const r = await fetchImpl(`${cpBase}/api/token/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: env.CAMPAY_USERNAME, password: env.CAMPAY_PASSWORD }) });
    if (!r.ok) throw new Error(`Campay token ${r.status}`);
    const j = await r.json();
    cpToken = { value: j.token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return cpToken.value;
  }
  const campay = {
    async request({ phone, amount, reference, description }) {
      const r = await fetchImpl(`${cpBase}/api/collect/`, {
        method: 'POST', headers: { Authorization: `Token ${await cpAuth()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: String(amount), currency: 'XAF', from: phone, description: description.slice(0, 120), external_reference: reference }),
      });
      if (!r.ok) throw new Error(`Campay collect ${r.status}: ${await r.text()}`);
      const j = await r.json();
      return { providerRef: j.reference, status: 'pending', ussd: j.ussd_code };
    },
    async status(ref) {
      const r = await fetchImpl(`${cpBase}/api/transaction/${ref}/`, { headers: { Authorization: `Token ${await cpAuth()}` } });
      if (!r.ok) throw new Error(`Campay status ${r.status}`);
      const j = await r.json();
      if (j.status === 'SUCCESSFUL') return { status: 'successful', transactionId: j.operator_reference || ref };
      if (j.status === 'FAILED') return { status: 'failed', reason: j.reason || 'FAILED' };
      return { status: 'pending' };
    },
  };
  const aggregator = env.MOMO_AGGREGATOR === 'campay' ? campay : null;

  const impl = (provider) => {
    if (!PROVIDERS[provider]) throw bad('provider', 'Opérateur inconnu');
    if (mode === 'simulation') return simulation;
    if (aggregator) return aggregator;
    return provider === 'mtn_momo' ? mtn : orange;
  };

  return {
    mode,
    aggregator: aggregator ? env.MOMO_AGGREGATOR : null,
    configured(provider) {
      if (mode === 'simulation') return true;
      if (aggregator) return !!(env.CAMPAY_USERNAME && env.CAMPAY_PASSWORD);
      return provider === 'mtn_momo'
        ? !!(env.MTN_MOMO_SUBSCRIPTION_KEY && env.MTN_MOMO_API_USER && env.MTN_MOMO_API_KEY)
        : !!(env.ORANGE_MONEY_CONSUMER_KEY && env.ORANGE_MONEY_API_USERNAME && env.ORANGE_MONEY_MERCHANT_NUMBER);
    },
    /** Sends a payment prompt to the customer's phone. */
    async requestPayment({ provider, phone, amount, reference, description }) {
      if (!(amount > 0)) throw bad('amount', 'Montant invalide');
      return impl(provider).request({ phone: normalizePhone(phone), amount: Math.round(amount), reference, description: description || reference });
    },
    checkStatus: (provider, ref) => impl(provider).status(ref),
  };
}
