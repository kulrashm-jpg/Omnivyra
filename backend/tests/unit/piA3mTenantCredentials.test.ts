/**
 * A3M — PI resolves provider credentials from the TENANT, never the platform.
 *
 * A3L found that both credential resolvers in the enrichment path read
 * `process.env` and nothing else. That is a question about Omnivyra, not about
 * the tenant: a tenant which had authorised nothing would have passed the gate
 * on the strength of a key it never supplied, spending one shared key against
 * one shared bill and one shared rate limit. It was not exploitable only
 * because no provider key was configured anywhere — meaning it would have gone
 * live on the day someone set one.
 *
 * The test that matters most here is the environment one: it configures a fake
 * global key AND leaves the tenant without a credential, and requires that the
 * attempt still ends at `credential_missing` with no provider contacted. If
 * anyone reintroduces a fallback, that test fails and nothing else needs to.
 *
 * SECRETS: every value below is a synthetic string invented for this file. No
 * real credential is read, referenced or reproduced anywhere.
 */

const rows: Record<string, unknown[]> = {};
const captured: { table: string; op: string; payload?: unknown }[] = [];

/**
 * The fake encryptor base64-encodes rather than wrapping the plaintext.
 *
 * That matters: a fake of the form `enc(<plaintext>)` CONTAINS the plaintext,
 * so "the stored value does not contain the secret" would pass against the
 * mock's shape rather than against the code. Real AES-256-GCM output contains
 * no plaintext, and the fake has to share that property or the assertions
 * below prove nothing.
 */
jest.mock('../../auth/credentialEncryption', () => ({
  encryptCredential: (v: string) => `enc:${Buffer.from(String(v), 'utf8').toString('base64')}`,
  decryptCredential: (v: string) => {
    const m = /^enc:(.*)$/.exec(String(v));
    if (!m) throw new Error('not decryptable');
    return Buffer.from(m[1], 'base64').toString('utf8');
  },
}));

/**
 * A builder that models the two ownership paths the table now has.
 *
 * The website path filters on `connection_id` after a `maybeSingle()` ownership
 * lookup; the provider path filters on `company_id` AND `provider_key` in the
 * query itself. The mock keeps them distinct on purpose — collapsing them
 * would hide the very property under test.
 */
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Record<string, string> = {};
    let mode: 'select' | 'delete' = 'select';

    const result = () => {
      const matched = (rows[table] ?? []).filter((r) =>
        Object.entries(filters).every(([col, val]) => (r as Record<string, unknown>)[col] === val));
      if (mode === 'delete') {
        rows[table] = (rows[table] ?? []).filter((r) => !matched.includes(r));
        captured.push({ table, op: 'delete', payload: { ...filters } });
        return { data: null, error: null };
      }
      return { data: matched, error: null };
    };

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.delete = () => { mode = 'delete'; return q; };
    q.eq = (col: string, val: string) => { filters[col] = val; return q; };
    q.maybeSingle = async () => {
      const found = (rows[table] ?? []).find((r) => (r as { id?: string }).id === filters.id);
      return { data: found ?? null, error: null };
    };
    q.upsert = async (payload: unknown) => {
      captured.push({ table, op: 'upsert', payload });
      for (const row of payload as Record<string, unknown>[]) {
        rows[table] = (rows[table] ?? []).filter((r) => !(
          (r as Record<string, unknown>).company_id === row.company_id
          && (r as Record<string, unknown>).provider_key === row.provider_key
          && (r as Record<string, unknown>).credential_key === row.credential_key));
        (rows[table] ??= []).push(row);
      }
      return { error: null };
    };
    // Awaiting the builder runs the filtered query — the shape the provider
    // path uses (`select().eq().eq()` with no `maybeSingle`).
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
}));

import {
  getProviderCredentials,
  upsertProviderCredentials,
  deleteProviderCredentials,
  getConnectionCredentials,
  CrossTenantCredentialError,
} from '../../services/integrationCredentialService';
import { makeTenantCredentialPort, PROVIDER_API_KEY } from '../../services/enrichment/providers/credentials';
import { executeEnrichment, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter } from '../../services/enrichment/providers/contract';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const CONN_A = 'conn-a';
const CONN_B = 'conn-b';
const NOW = '2026-09-05T00:00:00.000Z';

/** Synthetic. Not a credential for anything that exists. */
const SECRET_A = 'synthetic-tenant-a-secret';
const SECRET_B = 'synthetic-tenant-b-secret';

/** Mirrors the fake encryptor above, so fixtures are stored the way code stores. */
const enc = (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`;

beforeEach(() => {
  captured.length = 0;
  rows.website_connections = [
    { id: CONN_A, websites: { company_id: ORG_A } },
    { id: CONN_B, websites: { company_id: ORG_B } },
  ];
  rows.integration_credentials = [
    // provider path — one per tenant, same provider
    { company_id: ORG_A, provider_key: 'apollo', connection_id: null, credential_key: 'api_key', encrypted_value: enc(SECRET_A) },
    { company_id: ORG_B, provider_key: 'apollo', connection_id: null, credential_key: 'api_key', encrypted_value: enc(SECRET_B) },
    // website path — untouched legacy rows
    { company_id: null, provider_key: null, connection_id: CONN_A, credential_key: 'api_key', encrypted_value: enc('legacy-a') },
    { company_id: null, provider_key: null, connection_id: CONN_B, credential_key: 'api_key', encrypted_value: enc('legacy-b') },
  ];
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3M — the store resolves a credential to exactly one tenant', () => {
  it('Tenant A resolves ITS OWN Apollo credential', async () => {
    await expect(getProviderCredentials(ORG_A, 'apollo')).resolves.toEqual({ api_key: SECRET_A });
  });

  it('Tenant B resolves ITS OWN Apollo credential — same provider, different secret', async () => {
    await expect(getProviderCredentials(ORG_B, 'apollo')).resolves.toEqual({ api_key: SECRET_B });
  });

  it('Tenant A can never reach Tenant B’s credential — the tenant IS the predicate', async () => {
    const a = await getProviderCredentials(ORG_A, 'apollo');
    expect(a.api_key).toBe(SECRET_A);
    expect(JSON.stringify(a)).not.toContain(SECRET_B);
  });

  it('a provider the tenant has not configured yields nothing, not another provider’s key', async () => {
    await expect(getProviderCredentials(ORG_A, 'rapidapi')).resolves.toEqual({});
  });

  it('refuses a tenant-less lookup rather than returning every row', async () => {
    await expect(getProviderCredentials('', 'apollo')).rejects.toThrow(/tenant-less/);
    await expect(getProviderCredentials('   ', 'apollo')).rejects.toThrow(/tenant-less/);
  });

  it('refuses a provider-less lookup for the same reason', async () => {
    await expect(getProviderCredentials(ORG_A, '')).rejects.toThrow(/provider-less/);
  });

  it('stores encrypted, never plaintext', async () => {
    await upsertProviderCredentials(ORG_A, 'clearbit', { api_key: 'synthetic-new-secret' });
    const write = captured.find((c) => c.op === 'upsert');
    expect(JSON.stringify(write)).not.toContain('synthetic-new-secret');
    expect(JSON.stringify(write)).toContain(enc('synthetic-new-secret'));
  });

  it('rotation replaces the secret in place and leaves no earlier value readable', async () => {
    await upsertProviderCredentials(ORG_A, 'apollo', { api_key: 'synthetic-rotated' });
    await expect(getProviderCredentials(ORG_A, 'apollo')).resolves.toEqual({ api_key: 'synthetic-rotated' });
    expect(JSON.stringify(rows.integration_credentials)).not.toContain(SECRET_A);
  });

  it('rotation for one tenant does not touch the other tenant’s row', async () => {
    await upsertProviderCredentials(ORG_A, 'apollo', { api_key: 'synthetic-rotated' });
    await expect(getProviderCredentials(ORG_B, 'apollo')).resolves.toEqual({ api_key: SECRET_B });
  });

  it('revocation deletes rather than blanking — nothing is left at rest', async () => {
    await deleteProviderCredentials(ORG_A, 'apollo');
    await expect(getProviderCredentials(ORG_A, 'apollo')).resolves.toEqual({});
    expect(JSON.stringify(rows.integration_credentials)).not.toContain(SECRET_A);
  });

  it('revocation is tenant-scoped — B survives A’s revocation', async () => {
    await deleteProviderCredentials(ORG_A, 'apollo');
    await expect(getProviderCredentials(ORG_B, 'apollo')).resolves.toEqual({ api_key: SECRET_B });
  });

  it('a value that cannot be decrypted is absent, never a guess', async () => {
    rows.integration_credentials = [
      { company_id: ORG_A, provider_key: 'apollo', connection_id: null, credential_key: 'api_key', encrypted_value: 'corrupt' },
    ];
    await expect(getProviderCredentials(ORG_A, 'apollo')).resolves.toEqual({ api_key: '' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3M — the existing website-connection path is unchanged', () => {
  it('still resolves a legacy credential through its connection', async () => {
    await expect(getConnectionCredentials(ORG_A, CONN_A)).resolves.toEqual({ api_key: 'legacy-a' });
  });

  it('still raises CrossTenantCredentialError across tenants', async () => {
    await expect(getConnectionCredentials(ORG_A, CONN_B)).rejects.toBeInstanceOf(CrossTenantCredentialError);
  });

  it('the legacy refusal still carries no secret', async () => {
    const err = await getConnectionCredentials(ORG_A, CONN_B).catch((e) => e);
    expect(String(err?.message ?? '')).not.toContain('legacy-b');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3M — the port never consults the environment', () => {
  const ENV_KEY = 'A3M_FAKE_GLOBAL_KEY';
  afterEach(() => { delete process.env[ENV_KEY]; delete process.env.APOLLO_API_KEY; });

  it('returns the tenant’s own credential', async () => {
    const port = makeTenantCredentialPort();
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' }))
      .resolves.toBe(SECRET_A);
  });

  it('returns null — not another tenant’s value — when this tenant has none', async () => {
    const port = makeTenantCredentialPort();
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'clearbit' }))
      .resolves.toBeNull();
  });

  it('A GLOBAL ENV KEY DOES NOT RESCUE A TENANT WITH NO CREDENTIAL', async () => {
    process.env.APOLLO_API_KEY = 'synthetic-global-key-that-must-never-be-used';
    const port = makeTenantCredentialPort();
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'clearbit' }))
      .resolves.toBeNull();
    // and the global value never leaks out under any provider id
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' }))
      .resolves.toBe(SECRET_A);
  });

  it('a store failure returns null rather than looking elsewhere', async () => {
    process.env[ENV_KEY] = 'synthetic-global-key';
    const port = makeTenantCredentialPort({
      read: async () => { throw new Error('store unavailable'); },
    });
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' }))
      .resolves.toBeNull();
  });

  it('refuses a blank tenant or provider without reaching the store', async () => {
    let reached = false;
    const port = makeTenantCredentialPort({ read: async () => { reached = true; return {}; } });
    await expect(port.resolveCredential({ organizationId: '', providerId: 'apollo' })).resolves.toBeNull();
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: '' })).resolves.toBeNull();
    expect(reached).toBe(false);
  });

  it('an empty stored value is not a credential', async () => {
    const port = makeTenantCredentialPort({ read: async () => ({ [PROVIDER_API_KEY]: '   ' }) });
    await expect(port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' }))
      .resolves.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3M — the executor gates on the tenant credential, before egress', () => {
  const request = {
    organizationId: ORG_A, subject: 'person' as const, entityId: 'person-1',
    attributes: ['job_title'], selectors: { email_domain: 'example.com' },
    purpose: 'icp', correlationId: 'corr-a3m',
  };

  function adapterSpy() {
    const calls: unknown[] = [];
    const adapter = {
      id: 'fake', label: 'Fake', supports: ['job_title'], credentialEnvVar: 'A3M_FAKE_GLOBAL_KEY',
      isAvailable: () => true,
      enrich: async (req: unknown) => {
        calls.push(req);
        return {
          outcome: 'enriched' as const, notReturned: [],
          fields: [{ attribute: 'job_title', subject: 'person' as const, value: 'Head of Growth', observedAt: null, confidence: null, providerInferred: false }],
        };
      },
      calls,
    };
    return adapter as unknown as EnrichmentProviderAdapter & { calls: unknown[] };
  }

  function ports(over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts & { costCalls: number } {
    const state = { costCalls: 0 };
    const base: ExecuteEnrichmentPorts = {
      authorizeCost: over.authorizeCost ?? (async () => {
        state.costCalls += 1;
        return { authorized: true, holdId: 'hold-1', cost: { kind: 'free' } };
      }),
      releaseCost: over.releaseCost ?? (async () => { /* noop */ }),
      resolveCredential: over.resolveCredential ?? (async () => SECRET_A),
      findRecentObservation: over.findRecentObservation ?? (async () => null),
      persistObservation: over.persistObservation ?? (async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] })),
      now: over.now ?? (() => NOW),
    };
    return Object.assign(base, { get costCalls() { return state.costCalls; } });
  }

  afterEach(() => { delete process.env.A3M_FAKE_GLOBAL_KEY; });

  it('no tenant credential ⇒ credential_missing, and the provider is never called', async () => {
    const adapter = adapterSpy();
    const p = ports({ resolveCredential: async () => null });
    const result = await executeEnrichment(request, 'fake', p, { adapter });

    expect(result.outcome).toBe('credential_missing');
    expect(result.providerCalled).toBe(false);
    expect(adapter.calls).toHaveLength(0);
  });

  it('A GLOBAL ENV KEY DOES NOT RESCUE THE EXECUTOR EITHER', async () => {
    // The adapter reports itself available and its env var is set — exactly the
    // two conditions that USED to open the gate. Neither may matter now.
    process.env.A3M_FAKE_GLOBAL_KEY = 'synthetic-global-key-that-must-never-be-used';
    const adapter = adapterSpy();
    const result = await executeEnrichment(request, 'fake', ports({ resolveCredential: async () => null }), { adapter });

    expect(result.outcome).toBe('credential_missing');
    expect(result.providerCalled).toBe(false);
    expect(adapter.calls).toHaveLength(0);
  });

  it('the credential is resolved BEFORE cost — a missing one costs nothing', async () => {
    const adapter = adapterSpy();
    const p = ports({ resolveCredential: async () => null });
    await executeEnrichment(request, 'fake', p, { adapter });
    expect(p.costCalls).toBe(0);
  });

  it('a resolved credential is handed to the adapter and to nothing else', async () => {
    const adapter = adapterSpy();
    const result = await executeEnrichment(request, 'fake', ports(), { adapter });

    expect(result.outcome).toBe('enriched');
    expect((adapter.calls[0] as { credential?: string }).credential).toBe(SECRET_A);
    // The secret must not survive into anything a caller stores or logs.
    expect(JSON.stringify(result)).not.toContain(SECRET_A);
  });

  it('the tenant asked for is the tenant resolved — no other org id reaches the port', async () => {
    const seen: string[] = [];
    const adapter = adapterSpy();
    await executeEnrichment(request, 'fake', ports({
      resolveCredential: async ({ organizationId }) => { seen.push(organizationId); return SECRET_A; },
    }), { adapter });

    expect(seen).toEqual([ORG_A]);
  });

  it('the provider asked for is the provider resolved — Apollo never resolves RapidAPI', async () => {
    const seen: string[] = [];
    const adapter = adapterSpy();
    await executeEnrichment(request, 'fake', ports({
      resolveCredential: async ({ providerId }) => { seen.push(providerId); return SECRET_A; },
    }), { adapter });

    expect(seen).toEqual(['fake']);
    expect(seen).not.toContain('rapidapi');
  });

  it('cost still refuses independently — a valid credential is not economic permission', async () => {
    const adapter = adapterSpy();
    const result = await executeEnrichment(request, 'fake', ports({
      authorizeCost: async () => ({ authorized: false, reason: 'no credit action registered' }),
    }), { adapter });

    expect(result.outcome).toBe('cost_denied');
    expect(result.providerCalled).toBe(false);
    expect(adapter.calls).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3M — the source no longer reads the environment for a PI credential', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8');
  /** Comments quote the removed code, so they must not be searched. */
  const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the executor contains no process.env credential read', () => {
    expect(code('backend/services/enrichment/providers/execute.ts')).not.toContain('process.env');
  });

  it('the credential port contains no process.env read at all', () => {
    expect(code('backend/services/enrichment/providers/credentials.ts')).not.toContain('process.env');
  });

  it('the executor no longer imports hasCredential', () => {
    expect(code('backend/services/enrichment/providers/execute.ts')).not.toContain('hasCredential');
  });
});
