/**
 * Closure-014A — the certification publish-worker launcher actually RUNS.
 *
 * Closure-014 tested the launcher only statically; the documented
 * `npx ts-node …` form could not start it (ESM resolution of its dynamic
 * imports). This executes the real launcher through its .cjs runner (what
 * `npm run cert:publish-worker` runs; ts-node in CommonJS mode) with `--check`, which
 * performs every guard and exits BEFORE any Worker or Redis connection is
 * created. Only loopback placeholder values are used; no service is contacted.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SAFE = {
  CERT_ENV: '1', CERT_FAKE_PUBLISHER: '1', NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  DATABASE_URL: 'postgresql://cert:placeholder@127.0.0.1:54322/postgres',
  REDIS_URL: 'redis://127.0.0.1:6390/3',
};

function runCheck(over: Record<string, string | undefined>) {
  const vars = { ...SAFE, ...over };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c14a-'));
  const envFile = path.join(dir, 'cert.env');
  fs.writeFileSync(envFile, Object.entries(vars).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  // Isolate the child from the jest process env: only what the launcher needs to boot.
  // NodeJS.ProcessEnv (Next.js declares NODE_ENV as required); never 'production' here.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'development', PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ENV_FILE: envFile };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  // The npm script must run exactly this runner (asserted), and the runner is what we execute.
  expect(pkg.scripts['cert:publish-worker']).toBe('node scripts/cert/publish-worker-cert.cjs');
  const r = spawnSync(process.execPath, ['scripts/cert/publish-worker-cert.cjs', '--check'], { cwd: ROOT, env, encoding: 'utf8', timeout: 180_000 });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

jest.setTimeout(400_000);

describe('scripts/cert/publish-worker-cert.ts --check (real execution)', () => {
  it('a loopback-only certification env passes every guard and starts NO worker', () => {
    const r = runCheck({});
    expect(r.out).toContain('plan: queue=publish prefix=omnivyra:local: consumers=1 provider=cert-fake egress=loopback-only');
    expect(r.out).toContain('--check OK; no worker started');
    expect(r.out).not.toContain('publish consumer started');
    expect(r.status).toBe(0);
  });
  const REFUSALS: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ['a non-loopback Redis', { REDIS_URL: 'redis://shared-redis.internal:6379/3' }, /non-loopback host "shared-redis\.internal"/],
    ['Redis DB 0', { REDIS_URL: 'redis://127.0.0.1:6390/0' }, /dedicated non-zero database index/],
    ['the fake provider disabled', { CERT_FAKE_PUBLISHER: undefined }, /CERT_FAKE_PUBLISHER is not 1/],
    ['the production project ref', { SUPABASE_URL: 'https://klkiseupptzbecbxwrky.supabase.co' }, /klkiseupptzbecbxwrky/],
  ];
  it.each(REFUSALS)('refuses %s (exit 1, no worker)', (_n, over, re) => {
    const r = runCheck(over);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(re);
    expect(r.out).not.toContain('publish consumer started');
  });
});
