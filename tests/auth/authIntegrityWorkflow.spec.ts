import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Static lock on .github/workflows/auth-integrity.yml: the live E2E half must
 * source its Supabase / session / encryption values ONLY from E2E_-prefixed
 * repository secrets.
 *
 * WHY: platform-parity.yml consumes the plain names (SUPABASE_URL,
 * SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_*,
 * SESSION_COOKIE_SECRET) to audit the PRODUCTION deployment. If the E2E job read
 * those names it would either run against production (it creates and deletes
 * real users) or force the owner to repoint platform-parity at the E2E project.
 *
 * Hermetic: reads one file from disk and parses it. js-yaml is resolved from the
 * lockfile's hoisted dev tree; if it ever disappears this spec fails loudly
 * rather than skipping.
 */
const yaml = createRequire(__filename)('js-yaml') as { load(source: string): unknown };

const WORKFLOW_PATH = path.join(__dirname, '..', '..', '.github', 'workflows', 'auth-integrity.yml');
const E2E_JOB = 'auth-integrity';
const PREFLIGHT_JOB = 'e2e-secrets-preflight';
const STATIC_JOB = 'auth-invariants-static';
const STATIC_JOB_REQUIRED_CONTEXT = 'Static auth invariants (hermetic, no secrets)';

/** Plain secret names that belong to production (platform-parity.yml). */
const PLAIN_PRODUCTION_SECRET_NAMES = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SESSION_COOKIE_SECRET',
  'ENCRYPTION_KEY',
  'REDIS_URL',
];

type Step = { name?: string; run?: string; uses?: string; env?: Record<string, unknown> };
type Job = {
  name?: string;
  if?: string;
  needs?: string | string[];
  env?: Record<string, unknown>;
  steps?: Step[];
  services?: Record<string, { image?: string; ports?: string[] }>;
};
type Workflow = { on?: Record<string, unknown>; jobs: Record<string, Job> };

function loadWorkflow(source = fs.readFileSync(WORKFLOW_PATH, 'utf8')): Workflow {
  const parsed = yaml.load(source) as Workflow;
  assert.ok(parsed && parsed.jobs, 'auth-integrity.yml did not parse into a workflow with jobs');
  return parsed;
}

/**
 * Every secret name a job references, in any position (job env, step env,
 * `with:`, `run:` bodies, `if:`), in both `secrets.NAME` and `secrets['NAME']`
 * forms.
 */
function referencedSecretNames(job: unknown): string[] {
  const text = JSON.stringify(job);
  const names = new Set<string>();
  for (const m of text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
  for (const m of text.matchAll(/secrets\[\s*\\?['"]([^'"\\]+)\\?['"]\s*\]/g)) names.add(m[1]);
  return [...names].sort();
}

function nonE2ESecrets(job: unknown): string[] {
  return referencedSecretNames(job).filter((name) => !name.startsWith('E2E_'));
}

test('the workflow parses and keeps its three jobs', () => {
  const wf = loadWorkflow();
  for (const job of [STATIC_JOB, PREFLIGHT_JOB, E2E_JOB]) {
    assert.ok(wf.jobs[job], `job "${job}" is missing from auth-integrity.yml`);
  }
});

test('the E2E job references ONLY E2E_-prefixed secrets', () => {
  const job = loadWorkflow().jobs[E2E_JOB];
  assert.deepEqual(
    nonE2ESecrets(job),
    [],
    'the E2E job must not read plain repository secrets; platform-parity.yml owns those production values',
  );
  for (const plain of PLAIN_PRODUCTION_SECRET_NAMES) {
    assert.ok(
      !referencedSecretNames(job).includes(plain),
      `the E2E job references the production secret name "${plain}"`,
    );
  }
});

test('the provisioning preflight tests the E2E_-prefixed secrets only', () => {
  const wf = loadWorkflow();
  const preflight = wf.jobs[PREFLIGHT_JOB];
  const names = referencedSecretNames(preflight);
  assert.ok(names.length > 0, 'the preflight must test at least one E2E secret');
  assert.deepEqual(nonE2ESecrets(preflight), [], 'the preflight must test E2E_ secrets, not plain names');
  // The E2E job must still be gated on that preflight.
  const e2e = wf.jobs[E2E_JOB];
  assert.equal(e2e.needs, PREFLIGHT_JOB);
  assert.match(String(e2e.if), /needs\.e2e-secrets-preflight\.outputs\.provisioned == 'true'/);
});

test('the preflight and the job require the same secret set', () => {
  const wf = loadWorkflow();
  assert.deepEqual(
    referencedSecretNames(wf.jobs[PREFLIGHT_JOB]),
    referencedSecretNames(wf.jobs[E2E_JOB]),
    'a secret the job consumes but the preflight does not test would let the job start half-provisioned',
  );
});

test('the canonical runtime env names are bound from E2E_ secrets', () => {
  const env = loadWorkflow().jobs[E2E_JOB].env ?? {};
  for (const name of [
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SESSION_COOKIE_SECRET',
    'ENCRYPTION_KEY',
    'E2E_SUPABASE_URL',
    'E2E_SUPABASE_SECRET_KEY',
  ]) {
    const value = env[name];
    assert.equal(typeof value, 'string', `job env ${name} must be set`);
    const refs = referencedSecretNames(value);
    assert.ok(refs.length > 0, `job env ${name} must come from a repository secret`);
    assert.deepEqual(
      refs.filter((ref) => !ref.startsWith('E2E_')),
      [],
      `job env ${name} must be bound from an E2E_ secret only`,
    );
  }
});

test('Redis is the ephemeral loopback service, never a secret', () => {
  const job = loadWorkflow().jobs[E2E_JOB];
  assert.match(String(job.env?.REDIS_URL), /^redis:\/\/(127\.0\.0\.1|localhost):6379$/);
  assert.equal(job.services?.redis?.image, 'redis:7-alpine');
  assert.ok(
    (job.services?.redis?.ports ?? []).every((port) => String(port).startsWith('127.0.0.1:')),
    'the Redis service must be published on loopback only',
  );
});

test('the production refusals run before the app server starts', () => {
  const steps = loadWorkflow().jobs[E2E_JOB].steps ?? [];
  const indexOf = (predicate: (step: Step) => boolean) => steps.findIndex(predicate);
  const refuse = indexOf((s) => s.name === 'Refuse to run against production');
  const target = indexOf((s) => /npm run check:auth-e2e-target/.test(String(s.run)));
  const server = indexOf((s) => /npm run dev/.test(String(s.run)));
  const suite = indexOf((s) => /npm run test:auth-integrity/.test(String(s.run)));
  assert.ok(refuse >= 0, 'production-refusal step is missing');
  assert.ok(target >= 0, 'check:auth-e2e-target step is missing');
  assert.ok(server >= 0 && suite >= 0, 'server start / suite steps are missing');
  assert.ok(refuse < server && target < server, 'production refusals must precede the app server');
  assert.ok(server < suite);
  assert.match(String(steps[refuse].run), /klkiseupptzbecbxwrky/);
});

test('the required static job stays hermetic and keeps its required name', () => {
  const wf = loadWorkflow();
  const job = wf.jobs[STATIC_JOB];
  assert.equal(job.name, STATIC_JOB_REQUIRED_CONTEXT);
  assert.deepEqual(referencedSecretNames(job), [], 'the static job must read no secrets');
  assert.ok(wf.on && 'pull_request' in wf.on, 'the pull_request trigger feeds a required check');
});

// ------------------------------------------------------------ MUTATION TEST
test('MUTATION: reintroducing a plain production secret name is caught', () => {
  const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  // Anchored at line start so it hits the job's SUPABASE_URL binding, not the
  // E2E_SUPABASE_URL line that contains the same text as a suffix.
  const mutated = source.replace(
    /^(\s+)SUPABASE_URL: \$\{\{ secrets\.E2E_SUPABASE_URL \}\}/m,
    '$1SUPABASE_URL: ${{ secrets.SUPABASE_URL }}',
  );
  assert.notEqual(mutated, source, 'mutation anchor not found — update this test with the workflow');
  const job = loadWorkflow(mutated).jobs[E2E_JOB];
  assert.deepEqual(nonE2ESecrets(job), ['SUPABASE_URL']);

  // Bracket form, and a reference buried in a run: body, are caught too.
  assert.deepEqual(referencedSecretNames({ run: "echo ${{ secrets['SESSION_COOKIE_SECRET'] }}" }), [
    'SESSION_COOKIE_SECRET',
  ]);
  assert.deepEqual(
    referencedSecretNames({ steps: [{ run: 'x=${{ secrets.SUPABASE_SECRET_KEY || secrets.E2E_SUPABASE_SECRET_KEY }}' }] }),
    ['E2E_SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEY'],
  );
});
