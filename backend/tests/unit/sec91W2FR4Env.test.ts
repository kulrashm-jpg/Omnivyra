/**
 * STEP 3AH-91 (W2F-3) — R4-ENV: a secret check that is open outside
 * production.
 *
 * R4 (ROUTE-AUTH-001) flagged `if (secret) { check }` with nothing when the
 * secret is unset, but accepted the variant whose unset-branch rejects only in
 * production — `else if (NODE_ENV === 'production') reject`. Every other
 * process (`next dev`, scripts, workers — which in this project run on
 * production DB/Redis credentials) was open. SEC-C (C1-b) made the two known
 * instances (internal/metrics, internal/process-reminders) fail closed; this
 * rule keeps the shape out and surfaced a third instance
 * (whatsapp/webhook verifySignature — tracked KNOWN OPEN → SEC-B).
 */
export {};

/* eslint-disable @typescript-eslint/no-var-requires */
const gate = require('../../../scripts/check-route-auth.js');

const REL = 'pages/api/fixture/secret-route.ts';
const MS = { [REL]: { kind: 'machine-secret', env: ['CRON_SECRET'], reason: 'fixture scheduler endpoint authenticated by CRON_SECRET' } };
const rules = (src: string, allow: Record<string, unknown> = MS) =>
  gate.analyzeRoute(REL, src, allow, {}).violations.map((v: { rule: string }) => v.rule).sort();
const wrap = (body: string) => `export default async function handler(req, res) {\n  const s = process.env.CRON_SECRET;\n${body}\n  res.status(200).json({ ran: true });\n}`;

describe('W2F-3 — unset-secret branches that reject only in production → R4-ENV', () => {
  it('`if (s) { check } else if (NODE_ENV === "production") reject` (the pre-SEC-C internal/metrics shape)', () => {
    expect(rules(wrap(`  if (s) { if (req.headers['x-metrics-secret'] !== s) return res.status(401).end(); }
  else if (process.env.NODE_ENV === 'production') { return res.status(401).end(); }`))).toEqual(['R4-ENV']);
  });

  it('`else { if (NODE_ENV === "production") reject }` (the pre-SEC-C internal/process-reminders shape)', () => {
    expect(rules(wrap(`  if (s) {
    if (req.headers.authorization !== 'Bearer ' + s) { return res.status(401).json({ error: 'UNAUTHORIZED' }); }
  } else {
    if (process.env.NODE_ENV === 'production') {
      logger.error('no_secret_in_production');
      return res.status(401).json({ error: 'CRON_SECRET_NOT_CONFIGURED' });
    }
  }`))).toEqual(['R4-ENV']);
  });

  it('the non-production branch explicitly allows (`else if (NODE_ENV !== "production") { … } else reject`)', () => {
    expect(rules(wrap(`  if (s) { if (req.headers['x'] !== s) return res.status(401).end(); }
  else if (process.env.NODE_ENV !== 'production') { console.warn('dev: secret unset, allowing'); }
  else { return res.status(503).end(); }`))).toEqual(['R4-ENV']);
  });

  it('`if (!s && NODE_ENV === "production") reject` then a check that only runs when set', () => {
    expect(rules(wrap(`  if (!s && process.env.NODE_ENV === 'production') return res.status(503).end();
  if (s && req.headers['x'] !== s) return res.status(401).end();`))).toEqual(['R4', 'R4-ENV']);
  });

  it('`if (!s) { if (not production) return allow; return 503 }` — an early non-production allow', () => {
    expect(rules(wrap(`  if (!s) { if (process.env.NODE_ENV !== 'production') return res.status(200).json({ dev: true }); return res.status(503).end(); }
  if (req.headers['x'] !== s) return res.status(401).end();`))).toEqual(['R4-ENV']);
  });

  it('VERCEL_ENV and an isProd flag are environment conditions too', () => {
    expect(rules(wrap(`  if (s) { if (req.headers['x'] !== s) return res.status(401).end(); }
  else if (process.env.VERCEL_ENV === 'production') { return res.status(401).end(); }`))).toEqual(['R4-ENV']);
    expect(rules(wrap(`  const isProduction = process.env.NODE_ENV === 'production';
  if (s) { if (req.headers['x'] !== s) return res.status(401).end(); }
  else if (isProduction) { return res.status(401).end(); }`))).toEqual(['R4-ENV']);
  });

  it('a signature-verifier helper that returns true outside production when the secret is unset (whatsapp shape)', () => {
    const src = `const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? '';
function verifySignature(rawBody, signature) {
  if (!APP_SECRET) {
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export default async function handler(req, res) { if (!verifySignature(b, s)) return res.status(401).end(); res.status(200).end(); }`;
    expect(rules(src, { [REL]: { kind: 'webhook-signature', reason: 'fixture webhook verified by an HMAC signature' } })).toEqual(['R4-ENV']);
  });

  it('R4-ENV is distinct from R4 (it does reject in production)', () => {
    const src = wrap(`  if (s) { if (req.headers['x'] !== s) return res.status(401).end(); }
  else if (process.env.NODE_ENV === 'production') { return res.status(401).end(); }`);
    expect(gate.failOpenSecret(gate.executable(src))).toEqual(['CRON_SECRET (open outside production)']);
  });
});

describe('W2F-3 — fail-closed shapes stay green', () => {
  it('an unset secret rejects in every environment', () => {
    expect(rules(wrap(`  if (!s) return res.status(503).json({ error: 'not configured' });
  if (req.headers['x'] !== s) return res.status(401).end();`))).toEqual([]);
    expect(rules(wrap(`  if (s) { if (req.headers['x'] !== s) return res.status(401).end(); }
  else { return res.status(503).end(); }`))).toEqual([]);
  });

  it('environment-conditional LOGGING followed by an unconditional rejection', () => {
    expect(rules(wrap(`  if (s) { if (req.headers['x'] !== s) return res.status(401).end(); }
  else { if (process.env.NODE_ENV !== 'production') console.warn('CRON_SECRET unset'); return res.status(503).end(); }`))).toEqual([]);
    expect(rules(wrap(`  if (!s) { if (process.env.NODE_ENV === 'development') console.warn('unset'); return res.status(401).end(); }
  if (req.headers['x'] !== s) return res.status(401).end();`))).toEqual([]);
  });

  it('an environment check unrelated to the secret branch is not R4-ENV', () => {
    expect(rules(wrap(`  if (!s) return res.status(503).end();
  if (req.headers['x'] !== s) return res.status(401).end();
  if (process.env.NODE_ENV !== 'production') console.log('ran');`))).toEqual([]);
  });
});

describe('W2F-3 — the repository', () => {
  const { rows, knownOpen } = gate.scanRepo();
  const byRoute = new Map(rows.map((r: { route: string }) => [r.route, r]));

  it('no route carries an untracked R4 or R4-ENV', () => {
    const bad = rows.filter((r: { violations: Array<{ rule: string }> }) => r.violations.some((v) => v.rule === 'R4' || v.rule === 'R4-ENV'))
      .map((r: { route: string }) => r.route);
    expect(bad).toEqual([]);
  });

  it('the two SEC-C (C1-b) endpoints are fail-closed in every environment', () => {
    for (const route of ['pages/api/internal/metrics.ts', 'pages/api/internal/process-reminders.ts']) {
      const r = byRoute.get(route) as { violations: unknown[]; knownOpen: unknown[] };
      expect(r.violations).toEqual([]);
      expect(r.knownOpen).toEqual([]);
    }
  });

  it('no R4-ENV remains on the tree, tracked or not (SEC91-W2F-3a fixed at STEP 3AH-91 integration)', () => {
    const tracked = rows.flatMap((r: { route: string; knownOpen: Array<{ rule: string }> }) => r.knownOpen.filter((v) => v.rule === 'R4-ENV').map(() => r.route));
    expect(tracked).toEqual([]);
    expect((knownOpen as Record<string, unknown>)['pages/api/whatsapp/webhook/index.ts']).toBeUndefined();
    const wa = byRoute.get('pages/api/whatsapp/webhook/index.ts') as { violations: unknown[]; knownOpen: unknown[] };
    expect(wa.violations).toEqual([]);
    expect(wa.knownOpen).toEqual([]);
  });
});
