/**
 * e9 ruling (e1, 2026-11-13; no CAPTCHA anywhere): POST /api/auth/login no longer reveals whether an account exists.
 * It used to answer INVALID_CREDENTIALS (unknown / deleted address) vs NO_PASSWORD (existing account, no password).
 * Now every well-formed request gets the SAME 200 and the route reads NOTHING; the login page shows one neutral
 * credential message that points a passwordless user to the magic link.
 */
export {};
import * as fs from 'fs';
import * as path from 'path';
const mockReads: string[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => { mockReads.push(t); throw new Error('the login pre-check must not read'); },
    rpc: (n: string) => { mockReads.push(`rpc:${n}`); throw new Error('the login pre-check must not call RPCs'); },
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }), LOGIN_LIMIT: {} }));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/auth/login').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function post(email: unknown) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await route({ method: 'POST', headers: {}, body: { email } }, res);
  return res;
}

it('existing, unknown, deleted and passwordless-looking addresses all get the SAME 200 - and nothing is read', async () => {
  const outs = [];
  for (const email of ['owner@acme.com', 'nobody@nowhere.test', 'deleted@acme.com', 'magiclink-only@acme.com']) {
    const r = await post(email);
    outs.push(JSON.stringify([r.statusCode, r.body]));
  }
  expect(new Set(outs)).toEqual(new Set([JSON.stringify([200, { proceed: true }])]));
  expect(mockReads).toEqual([]);
});

it('the login page no longer branches on NO_PASSWORD and shows ONE neutral credential message with the magic-link path', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'pages/login.tsx'), 'utf8');
  expect(src).not.toMatch(/NO_PASSWORD/);
  expect(src).toContain('Incorrect email or password. No password on your account? Use "Send me a magic link" below.');
});
