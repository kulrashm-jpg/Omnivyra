/**
 * STEP 3AH-91 (SEC-F, F4) — secret-pattern gate (scripts/check-secrets.js).
 *
 * Every credential-shaped fixture below is GENERATED at runtime from a
 * deterministic PRNG and assembled from fragments, so this file itself never
 * contains a string the gate would flag (the gate scans tracked test files).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require('../../../scripts/check-secrets.js') as {
  scanText: (text: string, rel?: string, allow?: unknown[], used?: Set<unknown>) => Array<{ line: number; pattern: string; fp: string }>;
  isTrivial: (v: string) => boolean;
  fingerprint: (v: string) => string;
  isTrackedDotenv: (rel: string) => boolean;
};

const REPO = path.resolve(__dirname, '../../..');

// Deterministic base62 noise (never a real credential).
let seed = 0x3a9100;
function noise(n: number, alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += alphabet[seed % alphabet.length];
  }
  return s;
}
const hex = (n: number) => noise(n, '0123456789abcdef');
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${noise(43)}`;
const patterns = (text: string) => gate.scanText(text).map((f) => f.pattern);

const FIX = {
  openai: 's' + 'k-proj-' + noise(48),
  anthropic: 's' + 'k-ant-api03-' + noise(40),
  sbSecret: 'sb_' + 'secret_' + noise(32),
  github: 'gh' + 'p_' + noise(36),
  githubPat: 'github' + '_pat_' + noise(60, 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789_'),
  slack: 'xo' + 'xb-' + noise(12, '0123456789') + '-' + noise(24),
  aws: 'AK' + 'IA' + noise(16, 'ABCDEFGHJKLMNPQRSTUVWXYZ234567'),
  pem: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  stripe: 's' + 'k_live_' + noise(32),
  whsec: 'wh' + 'sec_' + noise(32),
  pg: 'postgres' + 'ql://postgres.' + noise(12) + ':' + noise(20) + '@aws-0-eu-west-1.pooler.' + 'supabase.com:6543/postgres',
  railway: 'RAILWAY' + '_TOKEN=' + noise(8) + '-' + noise(4) + '-' + noise(4) + '-' + noise(12),
  encKey: 'CREDENTIAL' + '_ENCRYPTION_KEY=' + hex(64),
  bearer: 'Authorization: Bear' + 'er ' + noise(40) + '9',
  serviceJwt: jwt({ iss: 'supabase', ref: noise(20, 'abcdefghijklmnopqrst'), role: 'service_role', iat: 1700000000, exp: 2000000000 }),
};

describe('each high-confidence pattern is detected', () => {
  it.each([
    ['openai', 'openai-api-key'],
    ['anthropic', 'anthropic-api-key'],
    ['sbSecret', 'supabase-secret-key'],
    ['github', 'github-token'],
    ['githubPat', 'github-fine-grained-pat'],
    ['slack', 'slack-token'],
    ['aws', 'aws-access-key-id'],
    ['pem', 'private-key-pem'],
    ['stripe', 'stripe-live-secret'],
    ['whsec', 'webhook-signing-secret'],
    ['pg', 'postgres-url-with-password'],
    ['railway', 'railway-token-assignment'],
    ['encKey', 'encryption-key-assignment'],
    ['bearer', 'bearer-literal'],
    ['serviceJwt', 'supabase-service-role-jwt'],
  ])('%s → %s', (key, pattern) => {
    const v = FIX[key as keyof typeof FIX];
    expect(patterns(`const x = '${v}';`)).toContain(pattern);
  });
});

describe('reviewed placeholders and public values are not findings', () => {
  it('placeholder words, templates, repeated and sequential values', () => {
    expect(patterns("OPENAI_API_KEY='s" + "k-your-openai-api-key-goes-here-000000000'")).toEqual([]);
    expect(patterns("const k = 's" + "k-proj-" + 'x'.repeat(48) + "';")).toEqual([]);
    expect(patterns('Authorization: `Bear' + 'er ${token}`')).toEqual([]);
    expect(patterns('WEBHOOK=wh' + 'sec_local' + noise(24))).toEqual([]);
    expect(patterns('ENCRYPTION' + '_KEY=' + '0'.repeat(64))).toEqual([]);
    expect(patterns('TOKEN_ENCRYPTION' + '_KEY=' + '0123456789abcdef'.repeat(4))).toEqual([]);
    expect(gate.isTrivial('ABCDEFGHIJKLmnop')).toBe(true);
  });
  it('localhost / docker-service DB URLs and URLs without a password', () => {
    const pg = 'postgres' + 'ql://postgres:' + noise(16);
    expect(patterns(`${pg}@127.0.0.1:54322/postgres`)).toEqual([]);
    expect(patterns(`${pg}@localhost:5432/postgres`)).toEqual([]);
    expect(patterns(`${pg}@db:5432/postgres`)).toEqual([]);
    expect(patterns('postgres' + 'ql://readonly@prod-host.internal/db')).toEqual([]);
    expect(patterns('postgres' + 'ql://user:password@host:5432/db')).toEqual([]);
  });
  it('publishable (anon) JWTs and the public supabase-demo service key are not flagged', () => {
    expect(patterns(jwt({ iss: 'supabase', role: 'anon' }))).toEqual([]);
    expect(patterns(jwt({ iss: 'supabase-demo', role: 'service_role' }))).toEqual([]);
  });
  it('PEM markers inside detection code (not a key) are not flagged', () => {
    expect(patterns("if (pem.startsWith('-----BEGIN " + "PRIVATE KEY-----')) parse(pem);")).toEqual([]);
  });
  it('tracked dotenv files are findings; *.example / *.sample are not', () => {
    expect(gate.isTrackedDotenv('.env')).toBe(true);
    expect(gate.isTrackedDotenv('apps/web/.env.production')).toBe(true);
    expect(gate.isTrackedDotenv('.env.local')).toBe(true);
    expect(gate.isTrackedDotenv('.env.cert.example')).toBe(false);
    expect(gate.isTrackedDotenv('jest.env.js')).toBe(false);
  });
});

describe('allowlist entries are pinned by fingerprint', () => {
  it('an entry for the exact value suppresses it; a different value in the same file is still flagged', () => {
    const allow = [{ file: 'a.ts', pattern: 'github-token', fingerprint: gate.fingerprint(FIX.github), reason: 'reviewed synthetic fixture for a redaction test' }];
    const used = new Set<unknown>();
    expect(gate.scanText(`x='${FIX.github}'`, 'a.ts', allow, used)).toEqual([]);
    expect(used.size).toBe(1);
    const other = 'gh' + 'p_' + noise(36);
    expect(gate.scanText(`x='${other}'`, 'a.ts', allow, new Set()).map((f) => f.pattern)).toEqual(['github-token']);
    expect(gate.scanText(`x='${FIX.github}'`, 'b.ts', allow, new Set()).map((f) => f.pattern)).toEqual(['github-token']);
  });
});

describe('the CLI never prints a matched value', () => {
  it('reports file:line + pattern only, and exits 1', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec91secrets-'));
    try {
      fs.mkdirSync(path.join(tmp, 'scripts', 'security'), { recursive: true });
      fs.copyFileSync(path.join(REPO, 'scripts/check-secrets.js'), path.join(tmp, 'scripts/check-secrets.js'));
      fs.writeFileSync(path.join(tmp, 'leak.ts'), `// fixture\nexport const k = '${FIX.stripe}';\nexport const j = '${FIX.serviceJwt}';\n`);
      execFileSync('git', ['init', '-q'], { cwd: tmp });
      execFileSync('git', ['add', 'leak.ts'], { cwd: tmp });
      const r = spawnSync('node', [path.join(tmp, 'scripts/check-secrets.js'), '--fingerprints'], { cwd: tmp, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('leak.ts:2  [stripe-live-secret]');
      expect(r.stdout).toContain('leak.ts:3  [supabase-service-role-jwt]');
      expect(r.stdout).not.toContain(FIX.stripe);
      expect(r.stdout).not.toContain(FIX.serviceJwt.split('.')[1]);
      expect(r.stdout + r.stderr).not.toContain(FIX.stripe.slice(8));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('the repository itself', () => {
  it('check-secrets passes on the tracked tree (with its reviewed allowlist, no stale entries)', () => {
    const out = execFileSync('node', [path.join(REPO, 'scripts/check-secrets.js')], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('RESULT: PASS');
  });
});
