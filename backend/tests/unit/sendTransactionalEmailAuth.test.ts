/**
 * send-transactional-email — caller authorization.
 *
 * The platform verify_jwt gate lets the PUBLIC publishable key through to the
 * function, so the function itself must accept only the project's secret keys
 * (platform-injected as SUPABASE_SECRET_KEYS). Pins:
 *   1. Only a secret key authorizes; the publishable key, junk and a missing
 *      credential are refused.
 *   2. Fail closed: a missing or malformed key set refuses every request.
 *   3. The handler authorizes before it reads the body or sends anything.
 *
 * Key values below are inert test strings, not real keys.
 */
import fs from 'fs';
import path from 'path';

import {
  authorizeServiceCaller,
  parseSecretKeys,
} from '../../../supabase/functions/send-transactional-email/auth';

const SECRET_DEFAULT = 'test-secret-key-default-0000';
const SECRET_BACKEND = 'test-secret-key-backend-1111';
const PUBLISHABLE = 'test-publishable-key-2222';
const KEY_SET = JSON.stringify({ default: SECRET_DEFAULT, backend: SECRET_BACKEND });

const headers = (h: Record<string, string>) => new Headers(h);

describe('send-transactional-email authorizeServiceCaller', () => {
  it('accepts a secret key on the apikey header', async () => {
    expect(await authorizeServiceCaller(headers({ apikey: SECRET_DEFAULT }), KEY_SET)).toEqual({ ok: true });
  });

  it('accepts any named secret key, as supabase-js sends it (apikey + Bearer)', async () => {
    const h = headers({ apikey: SECRET_BACKEND, Authorization: `Bearer ${SECRET_BACKEND}` });
    expect(await authorizeServiceCaller(h, KEY_SET)).toEqual({ ok: true });
  });

  it('accepts a secret key presented only as the Bearer token', async () => {
    expect(await authorizeServiceCaller(headers({ Authorization: `Bearer ${SECRET_DEFAULT}` }), KEY_SET)).toEqual({ ok: true });
  });

  it('refuses the publishable key', async () => {
    const h = headers({ apikey: PUBLISHABLE, Authorization: `Bearer ${PUBLISHABLE}` });
    expect(await authorizeServiceCaller(h, KEY_SET)).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
  });

  it('refuses any Bearer value that is not a secret key (the old check accepted this)', async () => {
    expect(await authorizeServiceCaller(headers({ Authorization: 'Bearer anything' }), KEY_SET)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a missing credential', async () => {
    expect(await authorizeServiceCaller(headers({}), KEY_SET)).toEqual({ ok: false, status: 401, error: 'Missing API key' });
    expect(await authorizeServiceCaller(headers({ Authorization: 'Bearer ' }), KEY_SET)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses prefixes, suffixes and case variants of a secret key', async () => {
    for (const v of [SECRET_DEFAULT.slice(0, -1), `${SECRET_DEFAULT}x`, SECRET_DEFAULT.toUpperCase()]) {
      expect(await authorizeServiceCaller(headers({ apikey: v }), KEY_SET)).toMatchObject({ ok: false, status: 401 });
    }
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['malformed JSON', '{not json'],
    ['a JSON array', JSON.stringify([SECRET_DEFAULT])],
    ['an object with no usable values', JSON.stringify({ default: '', other: 42 })],
  ])('fails closed when SUPABASE_SECRET_KEYS is %s', async (_label, raw) => {
    // Even a request carrying what would be a valid key is refused.
    expect(await authorizeServiceCaller(headers({ apikey: SECRET_DEFAULT }), raw)).toEqual({
      ok: false,
      status: 500,
      error: 'AUTH_NOT_CONFIGURED',
    });
  });

  it('parseSecretKeys keeps only non-empty string values', () => {
    expect(parseSecretKeys(JSON.stringify({ a: 'x', b: '', c: null, d: 7, e: 'y' }))).toEqual(['x', 'y']);
  });
});

describe('send-transactional-email handler wiring', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/functions/send-transactional-email/index.ts'),
    'utf8',
  );

  it('authorizes against SUPABASE_SECRET_KEYS before reading the body', () => {
    const authAt = src.indexOf('authorizeServiceCaller(req.headers, Deno.env.get("SUPABASE_SECRET_KEYS"))');
    const bodyAt = src.indexOf('await req.json()');
    expect(authAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(authAt);
  });

  it('no longer treats any Bearer header as authorization, and never accepts the legacy service_role key', () => {
    expect(src).not.toMatch(/Missing bearer token/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY/);
  });
});
