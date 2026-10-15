/**
 * Closure-014C (Finding C) — the certification publish-worker launcher must
 * get past module resolution on a REAL start, not only in --check.
 *
 * Closure-014B: `scripts/cert/publish-worker-cert.cjs` registered
 * tsconfig-paths without a baseUrl (the root tsconfig declares `paths` only),
 * so every real start died on `Cannot find module '@/lib/runtime/guard'`
 * (lib/redis/instrumentation.ts, imported by bullmqClient). --check returned
 * before that import graph and passed.
 *
 * Both tests execute the real runner in a child process (ts-node, CommonJS),
 * the way `npm run cert:publish-worker` does. Only loopback placeholder values
 * are used. The real start points Redis at a CLOSED loopback port, so no
 * service exists to talk to; the child is terminated as soon as the single
 * publish consumer has been constructed.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const RUNNER = 'scripts/cert/publish-worker-cert.cjs';

function envFile(redisUrl: string): { file: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c14c-'));
  const file = path.join(dir, 'cert.env');
  fs.writeFileSync(file, [
    'CERT_ENV=1', 'CERT_FAKE_PUBLISHER=1', 'NODE_ENV=development',
    'SUPABASE_URL=http://127.0.0.1:54321', 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
    'DATABASE_URL=postgresql://cert:placeholder@127.0.0.1:54322/postgres',
    `REDIS_URL=${redisUrl}`,
    // Non-secret placeholders: a real start validates config at import (a cert env carries local values).
    'SUPABASE_SECRET_KEY=cert-placeholder-not-a-key', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=cert-placeholder-not-a-key',
    'OPENAI_API_KEY=cert-placeholder-not-a-key', `ENCRYPTION_KEY=${'0'.repeat(64)}`,
  ].join('\n') + '\n');
  return { file, dir };
}
const childEnv = (file: string): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development', PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ENV_FILE: file,
});

jest.setTimeout(400_000);

it('--check resolves the same worker modules a real start imports (and still starts nothing)', () => {
  const { file, dir } = envFile('redis://127.0.0.1:6390/3');
  const r = spawnSync(process.execPath, [RUNNER, '--check'], { cwd: ROOT, env: childEnv(file), encoding: 'utf8', timeout: 300_000 });
  fs.rmSync(dir, { recursive: true, force: true });
  const out = `${r.stdout}\n${r.stderr}`;
  expect(out).not.toMatch(/Cannot find module/);
  expect(out).toContain('[cert-publish-worker] worker modules resolved (bullmqClient, publishProcessor)');
  expect(out).toContain('--check OK; no worker started');
  expect(out).not.toContain('publish consumer started');
  expect(r.status).toBe(0);
});

it('a real start constructs exactly the one publish consumer (Redis = closed loopback port; terminated right after)', async () => {
  const { file, dir } = envFile('redis://127.0.0.1:1/3');
  const child = spawn(process.execPath, [RUNNER], { cwd: ROOT, env: childEnv(file) });
  let out = '';
  const started = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 300_000);
    const on = (d: Buffer) => {
      out += d.toString();
      if (out.includes('publish consumer started') || /failed:|Cannot find module/.test(out)) { clearTimeout(timer); resolve(out.includes('publish consumer started')); }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('exit', () => { clearTimeout(timer); resolve(out.includes('publish consumer started')); });
  });
  child.kill();
  await new Promise((r) => { if (child.exitCode !== null || child.signalCode !== null) r(null); else child.on('exit', () => r(null)); });
  fs.rmSync(dir, { recursive: true, force: true });
  expect(out).not.toMatch(/Cannot find module/);
  expect(started).toBe(true);
  expect(out.match(/publish consumer started/g)).toHaveLength(1);
  // Nothing else the full worker entry points start may appear.
  expect(out).not.toMatch(/startWorkers|cron scheduler|Starting cron|engagement polling|token refresh|intelligence polling/i);
});
