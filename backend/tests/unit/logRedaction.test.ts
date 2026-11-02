/**
 * SEC log-redaction — backend/security/logRedaction.ts and its wiring into
 * backend/services/logger.ts.
 *
 * Every credential-shaped fixture is GENERATED at runtime from a deterministic PRNG and
 * assembled from fragments, so this file never contains a literal the secret gates
 * (scripts/check-secrets.js, scan-staged-secrets.js, .gitleaks.toml) would flag. All
 * values are synthetic and carry a TESTONLY marker; none is a real credential.
 */
import { redact, redactString, isSecretKeyName, REDACTED } from '../../security/logRedaction';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require('../../../scripts/check-secrets.js') as {
  scanText: (text: string) => Array<{ line: number; pattern: string }>;
};

let seed = 0x5ec10a;
function noise(n: number, alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += alphabet[(seed >>> 16) % alphabet.length];
  }
  return s;
}
const hex = (n: number) => noise(n, '0123456789abcdef');
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${noise(43)}`;

const T = 'TESTONLY';
const FIX = {
  jwt: jwt({ role: 'service_role', iss: 'supabase', ref: noise(20) }),
  userJwt: jwt({ sub: noise(12), role: 'authenticated' }),
  sbSecret: 'sb' + '_secret_' + T + noise(30),
  sbp: 'sb' + 'p_' + T.toLowerCase() + hex(32),
  openai: 's' + 'k-proj-' + T + noise(44),
  openaiLegacy: 's' + 'k-' + T + noise(40),
  anthropic: 's' + 'k-ant-api03-' + T + noise(40),
  aws: 'AK' + 'IA' + 'TESTONLY' + 'QZ7W4XKV',
  gocspx: 'GOC' + 'SPX-' + T + noise(20),
  railway: 'r' + 'w_' + T + noise(24) + '7',
  bearer: T + noise(30) + '9',
  basic: Buffer.from(`svc:${T}${noise(16)}`).toString('base64'),
  dbPass: T + noise(18),
  hexBlob: hex(64),
  cookie: `sid=${T}${noise(24)}`,
};
const secretsIn = (s: string) => Object.values(FIX).filter((v) => s.includes(v));
const ser = (v: unknown) => JSON.stringify(v);

describe('redactString — token families', () => {
  const cases: Array<[string, string, string]> = [
    ['supabase service_role JWT', `token payload ${FIX.jwt} end`, FIX.jwt],
    ['user access JWT', `jwt=${FIX.userJwt}`, FIX.userJwt],
    ['supabase sb_secret_', `using key ${FIX.sbSecret}`, FIX.sbSecret],
    ['supabase sbp_ access token', `cli ${FIX.sbp}`, FIX.sbp],
    ['openai sk-proj-', `openai rejected ${FIX.openai}`, FIX.openai],
    ['openai legacy sk-', `openai rejected ${FIX.openaiLegacy}`, FIX.openaiLegacy],
    ['anthropic sk-ant-', `anthropic ${FIX.anthropic}`, FIX.anthropic],
    ['aws AKIA', `aws id ${FIX.aws} used`, FIX.aws],
    ['google GOCSPX-', `client ${FIX.gocspx}`, FIX.gocspx],
    ['railway rw_', `deploy with ${FIX.railway}`, FIX.railway],
    ['Authorization: Bearer', `Authorization: Bearer ${FIX.bearer}`, FIX.bearer],
    ['Authorization: Basic', `authorization=Basic ${FIX.basic}`, FIX.basic],
    ['bare Bearer', `sent Bearer ${FIX.bearer} upstream`, FIX.bearer],
    ['postgres URL password', `postgres://postgres.abc:${FIX.dbPass}@aws-0-eu.pooler.example.com:6543/postgres`, FIX.dbPass],
    ['postgresql URL password', `postgresql://admin:${FIX.dbPass}@db.internal:5432/x`, FIX.dbPass],
    ['password=', `login failed password=${FIX.dbPass}&user=a`, FIX.dbPass],
    ['"api_key": "…" JSON', `{"api_key":"${FIX.bearer}","n":1}`, FIX.bearer],
    ['client_secret query param', `GET /oauth?client_id=a&client_secret=${FIX.bearer}`, FIX.bearer],
    ['Set-Cookie header', `Set-Cookie: ${FIX.cookie}; Path=/; HttpOnly`, FIX.cookie],
    ['hex blob after secret word', `signing secret ${FIX.hexBlob}`, FIX.hexBlob],
    ['hex blob after key name with colon', `ENCRYPTION_KEY: ${FIX.hexBlob}`, FIX.hexBlob],
  ];
  it.each(cases)('%s', (_label, input, secret) => {
    const out = redactString(input);
    expect(out).not.toContain(secret);
    expect(out).toContain('REDACTED');
  });

  it('keeps the non-secret parts of a connection URL', () => {
    const out = redactString(`postgresql://admin:${FIX.dbPass}@db.internal:5432/x`);
    expect(out).toBe(`postgresql://admin:${REDACTED}@db.internal:5432/x`);
  });

  it('redacts PEM private key blocks', () => {
    const pem = ['-----BEGIN ', 'PRIVATE KEY-----\n', noise(64), '\n-----END ', 'PRIVATE KEY-----'].join('');
    const out = redactString(`key material: ${pem} done`);
    expect(out).not.toContain(pem.slice(30, 60));
    expect(out).toContain('[REDACTED:private-key]');
  });
});

describe('redactString — non-secret text untouched', () => {
  const plain = [
    'Basic plan selected for company 42',
    'Token refresh failed; will retry in 30s',
    'task-runner finished 12 jobs (max_tokens=4000, prompt_tokens=812)',
    'GET https://api.example.com/v1/items?page=2&limit=50',
    'user signed in via google; provider=google; status=200',
    'rw_lock_timeout_ms exceeded on queue publish',
    'postgres://localhost/db connected',
    'skipping sk-short value',
    'commit 5025f51d7bb1420e3d3c5ef4ed626c64b953b3b0 deployed',
    'request_id=4c1a7e9e-2b55-4a39-9d55-6c8e6b0b6f41 completed',
  ];
  it.each(plain)('%s', (s) => {
    expect(redactString(s)).toBe(s);
  });
});

describe('redact — structured payloads', () => {
  it('replaces values of secret-named keys at any depth, keeps descriptive keys and numbers', () => {
    const input = {
      event: 'provider_call',
      password: 'hunter2-not-a-secret-shape',
      headers: { Authorization: `Bearer ${FIX.bearer}`, cookie: FIX.cookie, 'set-cookie': [FIX.cookie, FIX.cookie], accept: 'application/json' },
      nested: { deeper: { client_secret: 'abc', api_key: 'plainvalue', apiKeyEnvName: 'OPENAI_API_KEY', token_type: 'bearer' } },
      usage: { max_tokens: 4000, prompt_tokens: 812, total_tokens: 900 },
      secret_present: true,
      credentials: { user: 'svc', pass: 'p' },
      list: [{ access_token: 'x1y2z3' }, { name: 'ok' }],
    };
    const out = redact(input) as any;
    expect(out.password).toBe(REDACTED);
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.headers.cookie).toBe(REDACTED);
    expect(out.headers['set-cookie']).toEqual([REDACTED, REDACTED]);
    expect(out.headers.accept).toBe('application/json');
    expect(out.nested.deeper.client_secret).toBe(REDACTED);
    expect(out.nested.deeper.api_key).toBe(REDACTED);
    expect(out.nested.deeper.apiKeyEnvName).toBe('OPENAI_API_KEY');
    expect(out.nested.deeper.token_type).toBe('bearer');
    expect(out.usage).toEqual({ max_tokens: 4000, prompt_tokens: 812, total_tokens: 900 });
    expect(out.secret_present).toBe(true);
    expect(out.credentials).toEqual({ user: REDACTED, pass: REDACTED });
    expect(out.list[0].access_token).toBe(REDACTED);
    expect(out.list[1].name).toBe('ok');
    expect(input.password).toBe('hunter2-not-a-secret-shape'); // input not mutated
  });

  it('scans free-text values under innocuous keys', () => {
    const out = ser(redact({ message: `upstream said ${FIX.openai}`, arr: [`x ${FIX.jwt}`, [`y ${FIX.aws}`]], url: `postgres://u:${FIX.dbPass}@h.example.com/db` }));
    expect(secretsIn(out)).toEqual([]);
  });

  it('serialises Errors (message, stack, cause, extra props) with redaction and drops request config', () => {
    const cause = new Error(`inner ${FIX.anthropic}`);
    const err: any = new Error(`provider failed with ${FIX.openai}`, { cause } as any);
    err.code = 'E_PROVIDER';
    err.config = { headers: { Authorization: `Bearer ${FIX.bearer}` }, data: `client_secret=${FIX.bearer}` };
    err.response = { status: 401, data: { echoed: FIX.sbSecret } };
    err.apiKey = FIX.gocspx;
    const out = redact({ err }) as any;
    const s = ser(out);
    expect(secretsIn(s)).toEqual([]);
    expect(out.err.name).toBe('Error');
    expect(out.err.message).toContain('[REDACTED:openai-api-key]');
    expect(out.err.code).toBe('E_PROVIDER');
    expect(out.err.status).toBe(401);
    expect(out.err.config).toBeUndefined();
    expect(out.err.apiKey).toBe(REDACTED);
    expect(out.err.cause.message).toContain('[REDACTED:anthropic-api-key]');
    expect(typeof out.err.stack).toBe('string');
  });

  it('is cycle-safe', () => {
    const a: any = { name: 'a', token: FIX.bearer };
    a.self = a;
    a.child = { parent: a };
    const out = redact(a) as any;
    expect(out.self).toBe('[Circular]');
    expect(out.child.parent).toBe('[Circular]');
    expect(out.token).toBe(REDACTED);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('repeated (non-cyclic) references are both serialised', () => {
    const shared = { v: 1 };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { v: 1 }, b: { v: 1 } });
  });

  it('bounds depth, keys, array items, string length and total nodes', () => {
    let deep: any = { leaf: true };
    for (let i = 0; i < 50; i++) deep = { next: deep };
    expect(ser(redact(deep))).toContain('[Truncated: depth]');

    const wide: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) wide[`k${i}`] = i;
    const w = redact(wide) as Record<string, unknown>;
    expect(Object.keys(w).length).toBeLessThanOrEqual(101);
    expect(w['[truncated]']).toBe('4900 more keys');

    const arr = redact(Array.from({ length: 10000 }, (_, i) => i)) as unknown[];
    expect(arr.length).toBe(101);

    const big = redact('a'.repeat(200000)) as string;
    expect(big.length).toBeLessThan(9000);

    const many = redact(Array.from({ length: 100 }, () => Array.from({ length: 100 }, (_, i) => ({ i })))) as unknown;
    expect(ser(many)).toContain('[Truncated: node budget]');
  });

  it('large adversarial strings complete quickly (no catastrophic backtracking)', () => {
    const inputs = [
      'password'.repeat(20000),
      `${'a'.repeat(60000)}=`,
      `postgres://${'u'.repeat(30000)}:${'p'.repeat(30000)}`,
      `eyJ${'A'.repeat(60000)}`,
      `Bearer ${'x'.repeat(60000)}`,
      `secret ${'f'.repeat(60000)}`,
      `cookie: ${'"'.repeat(30000)}`,
      `${'api_key_'.repeat(8000)}`,
      `authorization: ${'a,'.repeat(30000)}`,
    ];
    for (const s of inputs) {
      const t0 = Date.now();
      redactString(s);
      expect(Date.now() - t0).toBeLessThan(500);
    }
  });

  it('handles special values', () => {
    const out = redact({ d: new Date(0), b: Buffer.from('xyz'), n: null, u: undefined, big: BigInt(5), f: () => 1, m: new Map([['token', 'v']]), s: new Set(['a']) }) as any;
    expect(out.d).toBe('1970-01-01T00:00:00.000Z');
    expect(out.b).toBe('[Binary 3 bytes]');
    expect(out.n).toBeNull();
    expect(out.big).toBe('5');
    expect(out.f).toBe('[Function]');
    expect(out.m).toEqual({ token: REDACTED });
    expect(out.s).toEqual(['a']);
  });
});

describe('isSecretKeyName', () => {
  it.each(['password', 'db_password', 'clientSecret', 'access_token', 'refreshToken', 'api_key', 'x-api-key', 'Authorization', 'cookie', 'Set-Cookie', 'private_key', 'aws_secret_access_key', 'credentials', 'DATABASE_DSN'])('%s is secret', (k) => {
    expect(isSecretKeyName(k)).toBe(true);
  });
  it.each(['api_key_env_name', 'token_type', 'tokenCount', 'secret_present', 'password_set', 'token_expires_at', 'idempotency_key', 'request_id', 'author', 'keyword', 'monkey', 'max_tokens'])('%s is not secret', (k) => {
    expect(isSecretKeyName(k)).toBe(false);
  });
});

describe('parity with the commit-time secret gate', () => {
  // Every family the gate DETECTS in commits must also be REDACTED in logs.
  const shared: Array<[string, string]> = [
    ['openai-api-key', FIX.openai],
    ['anthropic-api-key', FIX.anthropic],
    ['supabase-secret-key', FIX.sbSecret],
    ['supabase-service-role-jwt', FIX.jwt],
    ['aws-access-key-id', FIX.aws],
    ['supabase-access-token', FIX.sbp],
    ['google-oauth-client-secret', FIX.gocspx],
    ['railway-token', FIX.railway],
    ['bearer-literal', `Bearer ${FIX.bearer}`],
  ];
  it.each(shared)('%s: detected by check-secrets and redacted by logRedaction', (pattern, sample) => {
    expect(gate.scanText(`value ${sample}`).map((f) => f.pattern)).toContain(pattern);
    expect(redactString(`value ${sample}`)).not.toContain(sample.replace(/^Bearer /, ''));
  });
});

describe('logger wiring', () => {
  it('every log level emits redacted JSON', () => {
    jest.isolateModules(() => {
      const prev = process.env.LOG_LEVEL;
      process.env.LOG_LEVEL = 'debug';
      const sinks = (['info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { logger } = require('../../services/logger');
        const err = new Error(`boom ${FIX.openai}`);
        logger.info('evt_info', { message: `key ${FIX.sbSecret}`, headers: { authorization: `Bearer ${FIX.bearer}` } });
        logger.warn('evt_warn', { db: `postgres://u:${FIX.dbPass}@h.example.com/db` });
        logger.error('evt_error', { error: err, nested: [{ refresh_token: FIX.userJwt }] });
        logger.debug(`evt_debug ${FIX.aws}`, { count: 3 });
        const lines = sinks.flatMap((s) => s.mock.calls.map((c) => String(c[0])));
        expect(lines).toHaveLength(4);
        for (const line of lines) {
          expect(secretsIn(line)).toEqual([]);
          const parsed = JSON.parse(line);
          expect(parsed.level).toBeDefined();
          expect(parsed.event).toMatch(/^evt_/);
        }
        const errorLine = JSON.parse(lines.find((l) => l.includes('evt_error'))!);
        expect(errorLine.error.message).toContain('boom');
        expect(JSON.parse(lines.find((l) => l.includes('evt_debug'))!).count).toBe(3);
      } finally {
        sinks.forEach((s) => s.mockRestore());
        if (prev === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = prev;
      }
    });
  });
});
