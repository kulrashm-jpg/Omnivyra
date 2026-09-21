/**
 * Release provenance must not be defeated by an EMPTY environment variable.
 *
 * Vercel defines VERCEL_GIT_COMMIT_SHA as an empty string on CLI deploys. With
 * `??` the empty value won the chain and `/api/health/version` served
 * `build: ""` — indistinguishable from "no provenance", and silently wrong.
 */
import { firstNonEmptyEnv } from '../../../config/provenanceEnv';
import { WORKER_PROVENANCE } from '../../../observability/runtime/workerProvenance';

const SHA = 'a'.repeat(40);
const env = process.env as Record<string, string | undefined>;
const KEYS = [
  'VERCEL_GIT_COMMIT_SHA', 'RAILWAY_DEPLOYMENT_ID', 'GIT_COMMIT_SHA',
  'RAILWAY_GIT_COMMIT_SHA', 'GIT_COMMIT', 'PROV_A', 'PROV_B', 'PROV_C',
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => { saved = {}; for (const k of KEYS) { saved[k] = env[k]; delete env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k]; } });

describe('firstNonEmptyEnv — empty is ABSENT, not a value', () => {
  it('returns a declared value', () => {
    env.PROV_A = SHA;
    expect(firstNonEmptyEnv('PROV_A', 'PROV_B')).toBe(SHA);
  });

  it('THE BUG: an empty first source must not win the chain', () => {
    env.PROV_A = '';
    env.PROV_B = SHA;
    expect(firstNonEmptyEnv('PROV_A', 'PROV_B')).toBe(SHA);
  });

  it('treats a whitespace-only value as absent', () => {
    env.PROV_A = '   ';
    env.PROV_B = SHA;
    expect(firstNonEmptyEnv('PROV_A', 'PROV_B')).toBe(SHA);
  });

  it('trims a padded value rather than returning it verbatim', () => {
    env.PROV_A = `  ${SHA}  `;
    expect(firstNonEmptyEnv('PROV_A')).toBe(SHA);
  });

  it('returns null when every source is unset or empty', () => {
    env.PROV_A = '';
    env.PROV_B = '  ';
    expect(firstNonEmptyEnv('PROV_A', 'PROV_B', 'PROV_C')).toBeNull();
  });

  it('honours declaration order among non-empty sources', () => {
    env.PROV_A = 'first';
    env.PROV_B = 'second';
    expect(firstNonEmptyEnv('PROV_A', 'PROV_B')).toBe('first');
  });

  it('returns the stringified env value (process.env coerces on assignment)', () => {
    (env as Record<string, unknown>).PROV_A = 123;
    // Node stringifies anything assigned to process.env, so this is '123' —
    // non-empty, and therefore a legitimate winner. The typeof guard in
    // firstNonEmptyEnv exists for callers that replace process.env wholesale.
    expect(firstNonEmptyEnv('PROV_A', 'PROV_B')).toBe('123');
  });
});

describe('bootFingerprint deployment provenance', () => {
  const load = () => {
    jest.resetModules();
    return require('../../security/startup/bootFingerprint');
  };

  it('reports the real SHA when the platform declares one', () => {
    env.VERCEL_GIT_COMMIT_SHA = SHA;
    const m = load();
    m.resetBootFingerprint();
    expect(m.emitBootFingerprint().deploymentId).toBe(SHA);
  });

  it('THE BUG: an empty VERCEL_GIT_COMMIT_SHA falls through to the next source', () => {
    env.VERCEL_GIT_COMMIT_SHA = '';
    env.RAILWAY_DEPLOYMENT_ID = 'railway-deploy-1';
    const m = load();
    m.resetBootFingerprint();
    expect(m.emitBootFingerprint().deploymentId).toBe('railway-deploy-1');
  });

  it('reports null — never an empty string — when nothing is declared', () => {
    env.VERCEL_GIT_COMMIT_SHA = '';
    const m = load();
    m.resetBootFingerprint();
    const id = m.emitBootFingerprint().deploymentId;
    expect(id).toBeNull();
    expect(id).not.toBe('');
  });
});

describe('WORKER_PROVENANCE chains', () => {
  // WORKER_PROVENANCE is frozen at first import, so each case re-imports it
  // with the environment already arranged.
  const load = () => {
    jest.resetModules();
    return require('../../../observability/runtime/workerProvenance').WORKER_PROVENANCE;
  };

  it('resolves every field without leaking an empty string', () => {
    for (const v of Object.values(WORKER_PROVENANCE)) {
      if (typeof v === 'string') expect(v).not.toBe('');
    }
  });

  it('THE BUG: an empty RAILWAY_GIT_COMMIT_SHA falls through to the next source', () => {
    env.RAILWAY_GIT_COMMIT_SHA = '';
    env.VERCEL_GIT_COMMIT_SHA = SHA;
    expect(load().gitSha).toBe(SHA);
  });

  it('reports unknown — never an empty string — when every source is empty', () => {
    env.RAILWAY_GIT_COMMIT_SHA = '';
    env.VERCEL_GIT_COMMIT_SHA = '';
    env.GIT_COMMIT_SHA = '';
    const sha = load().gitSha;
    expect(sha).toBe('unknown');
    expect(sha).not.toBe('');
  });
});
