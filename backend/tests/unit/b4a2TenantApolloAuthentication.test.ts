/**
 * B4-A2 — tenant-level Apollo authentication, composed with B4-A1 discovery.
 *
 * ─── WHY THIS FILE IS SMALL ───────────────────────────────────────────────
 * Almost everything Phase 1 and Phase 2 ask for is ALREADY proven by existing
 * suites, and duplicating them would add maintenance without adding evidence:
 *
 *   A3M (piA3mTenantCredentials)        tenant A resolves its own key; A can
 *                                       never reach B's; stored encrypted, never
 *                                       plaintext; revocation is tenant-scoped;
 *                                       "the port never consults the environment".
 *   A3P (piA3pLeadSourceCredentialApi)  a valid Apollo write returns 200; the
 *                                       response carries only a mask; no console
 *                                       output across a full lifecycle contains
 *                                       the secret; an unknown provider is refused.
 *   PHASE-1A (phase1aCredentialTenantIsolation)  cross-tenant reads and writes
 *                                       refused in both directions, carrying no secret.
 *   real schema (integration_credentials) the real table, real SQL, apollo
 *                                       explicitly, never storing plaintext.
 *
 * What NO existing suite covers is the COMPOSITION this gate is about: that
 * revoking a tenant's Apollo credential makes a B4-A1 discovery execution fail
 * CLOSED, and that nothing in the new discovery layer introduces a second
 * credential path or a tenant-specific branch. That is what this file tests.
 *
 * NO REAL APOLLO CREDENTIAL IS USED. Every secret here is synthetic and labelled
 * so. Nothing in this file authenticates an Apollo subscription or contacts Apollo.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { makeTenantCredentialPort, PROVIDER_API_KEY } from '../../services/enrichment/providers/credentials';
import { createDiscoveryExecution, type DiscoveryPorts } from '../../services/prospectDiscovery/discoveryExecutor';
import { OPEN_DISCOVERY_STATUSES } from '../../services/prospectDiscovery/contract';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const BOUNDS = { maxPages: 2, maxResults: 10, maxProviderCalls: 2 };

/** Synthetic. Not an Apollo key, and no Apollo account exists for it. */
const SYNTHETIC_A = 'synthetic-tenant-a-secret-not-an-apollo-key';
const SYNTHETIC_B = 'synthetic-tenant-b-secret-not-an-apollo-key';

/**
 * A mutable stand-in for `integration_credentials`, read through the REAL A3M
 * port. Only the store read is injected, so the port's own logic — the tenant
 * predicate, the refusal of a blank tenant, the absence of an environment
 * fallback — is the code under test rather than a stand-in for it.
 */
function credentialStore(initial: Record<string, string> = {}) {
  const rows = new Map<string, string>(Object.entries(initial));
  const key = (org: string, provider: string) => `${org}::${provider}`;
  return {
    put: (org: string, provider: string, secret: string) => rows.set(key(org, provider), secret),
    revoke: (org: string, provider: string) => rows.delete(key(org, provider)),
    port: makeTenantCredentialPort({
      read: async (companyId: string, providerKey: string) => {
        const found = rows.get(key(companyId, providerKey));
        return (found ? { [PROVIDER_API_KEY]: found } : {}) as Record<string, string>;
      },
    }),
  };
}

/** The minimum discovery ledger needed to observe what was recorded. */
function ledger() {
  const rows: Record<string, any>[] = [];
  let n = 0;
  const ports: DiscoveryPorts = {
    gate: (async () => ({ allowed: true })) as any,
    hasTranslator: () => true,
    hasProvider: () => true,
    authorizeCost: (async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } })) as any,
    now: () => '2026-10-06T00:00:00.000Z',
    nextAttemptNumber: async () => rows.length + 1,
    claim: (async (input: any) => {
      const live = rows.find((r) => r.organization_id === input.organizationId
        && r.search_digest === input.searchDigest && r.completed_at === null);
      if (live) return { claimed: false, reason: 'already_live', activeId: live.id };
      const row = {
        id: `exec-${++n}`, organization_id: input.organizationId,
        provider_key: input.providerKey, search_digest: input.searchDigest,
        execution_status: 'pending', provider_call_state: 'not_called',
        outcome: null, detail: null, completed_at: null, provider_calls_made: 0,
      };
      rows.push(row);
      return { claimed: true, id: row.id, attemptNumber: input.attemptNumber, reclaimed: false };
    }) as any,
    complete: (async (input: any) => {
      const r = rows.find((x) => x.id === input.id && x.organization_id === input.organizationId);
      if (!r) throw new Error('no open row');
      r.execution_status = input.executionStatus;
      r.provider_call_state = input.providerCallState;
      r.outcome = input.outcome;
      r.detail = input.detail ?? null;
      r.completed_at = input.completedAt;
    }) as any,
  };
  return { rows, ports };
}

const search = (organizationId: string) => ({
  organizationId, provider: 'apollo', filters: { segment: 'b4a2-synthetic' },
  bounds: BOUNDS, correlationId: 'b4a2',
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A2 — a tenant credential governs its OWN discovery, and only its own', () => {
  it('a tenant WITH a credential reaches a ready, pending execution', async () => {
    const store = credentialStore({ [`${ORG_A}::apollo`]: SYNTHETIC_A });
    const l = ledger();
    const r = await createDiscoveryExecution(search(ORG_A), { ...l.ports, credential: store.port }) as any;
    expect(r.created).toBe(true);
    expect(r.readyForProviderExecution).toBe(true);
    expect(r.refusal).toBeNull();
    expect(l.rows[0].execution_status).toBe('pending');
    expect(OPEN_DISCOVERY_STATUSES).toContain(l.rows[0].execution_status);
    // Ready is NOT running: nothing was contacted, and nothing could be.
    expect(l.rows[0].provider_call_state).toBe('not_called');
    expect(l.rows[0].provider_calls_made).toBe(0);
  });

  it('a tenant WITHOUT a credential fails closed as credential_missing', async () => {
    const store = credentialStore({ [`${ORG_A}::apollo`]: SYNTHETIC_A });
    const l = ledger();
    // Tenant B has configured nothing. It must not inherit A's subscription.
    const r = await createDiscoveryExecution(search(ORG_B), { ...l.ports, credential: store.port }) as any;
    expect(r.readyForProviderExecution).toBe(false);
    expect(r.refusal).toBe('credential_missing');
    expect(l.rows[0].execution_status).toBe('refused_pre_call');
    expect(l.rows[0].provider_call_state).toBe('not_called');
  });

  it('PHASE 2.4 — REVOKING the credential flips a previously-ready tenant to failing closed', async () => {
    const store = credentialStore({ [`${ORG_A}::apollo`]: SYNTHETIC_A });
    const l = ledger();

    const before = await createDiscoveryExecution(search(ORG_A), { ...l.ports, credential: store.port }) as any;
    expect(before.readyForProviderExecution).toBe(true);
    // Close it so the live slot is free and the second attempt is admissible.
    await l.ports.complete!({
      organizationId: ORG_A, id: before.executionId, executionStatus: 'cancelled',
      providerCallState: 'not_called', outcome: 'cancelled', completedAt: '2026-10-06T01:00:00.000Z',
    });

    store.revoke(ORG_A, 'apollo');

    const after = await createDiscoveryExecution(search(ORG_A), { ...l.ports, credential: store.port }) as any;
    expect(after.readyForProviderExecution).toBe(false);
    expect(after.refusal).toBe('credential_missing');
    // Fails CLOSED: the refusal is recorded, and no provider was contacted.
    expect(l.rows[1].execution_status).toBe('refused_pre_call');
    expect(l.rows[1].provider_calls_made).toBe(0);
  });

  it('two tenants each use THEIR OWN subscription — no sharing in either direction', async () => {
    const store = credentialStore({
      [`${ORG_A}::apollo`]: SYNTHETIC_A,
      [`${ORG_B}::apollo`]: SYNTHETIC_B,
    });
    expect(await store.port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' })).toBe(SYNTHETIC_A);
    expect(await store.port.resolveCredential({ organizationId: ORG_B, providerId: 'apollo' })).toBe(SYNTHETIC_B);
    store.revoke(ORG_A, 'apollo');
    // A's revocation leaves B untouched, and A does not fall back to B.
    expect(await store.port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' })).toBeNull();
    expect(await store.port.resolveCredential({ organizationId: ORG_B, providerId: 'apollo' })).toBe(SYNTHETIC_B);
  });

  it('the resolved secret never reaches the ledger or the caller\'s result', async () => {
    const store = credentialStore({ [`${ORG_A}::apollo`]: SYNTHETIC_A });
    const l = ledger();
    const r = await createDiscoveryExecution(search(ORG_A), { ...l.ports, credential: store.port });
    expect(JSON.stringify(r)).not.toContain(SYNTHETIC_A);
    expect(JSON.stringify(l.rows)).not.toContain(SYNTHETIC_A);
  });

  it('a blank tenant is never treated as a wildcard by the credential port', async () => {
    const store = credentialStore({ [`${ORG_A}::apollo`]: SYNTHETIC_A });
    expect(await store.port.resolveCredential({ organizationId: '   ', providerId: 'apollo' })).toBeNull();
    expect(await store.port.resolveCredential({ organizationId: ORG_A, providerId: '  ' })).toBeNull();
  });

  it('a store failure is a refusal, NOT a reason to look elsewhere', async () => {
    const port = makeTenantCredentialPort({
      read: async () => { throw new Error('store unreachable'); },
    });
    expect(await port.resolveCredential({ organizationId: ORG_A, providerId: 'apollo' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A2 — no environment, global or platform Apollo credential path', () => {
  const PRIOR = process.env.APOLLO_API_KEY;
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.APOLLO_API_KEY;
    else process.env.APOLLO_API_KEY = PRIOR;
  });

  it('a platform APOLLO_API_KEY in the environment does NOT make a tenant ready', async () => {
    process.env.APOLLO_API_KEY = 'synthetic-platform-key-must-never-be-used';
    const store = credentialStore();              // NO tenant has configured anything
    const l = ledger();
    const r = await createDiscoveryExecution(search(ORG_A), { ...l.ports, credential: store.port }) as any;
    expect(r.refusal).toBe('credential_missing');
    expect(JSON.stringify(l.rows)).not.toContain('synthetic-platform-key-must-never-be-used');
  });

  it('the discovery layer never reads process.env for a credential', () => {
    const dir = join(__dirname, '../../services/prospectDiscovery');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      // A READ, not the words. `process.env` followed by `.` or `[` is an access;
      // the contract's prose says an adapter must never read `process.env`, and
      // that sentence must not be what satisfies the assertion.
      expect(src).not.toMatch(/process\.env\s*[.[]/);
      expect(src).not.toMatch(/APOLLO_API_KEY/);
    }
  });

  it('the discovery layer has NO tenant-specific branch — Drishiq included', () => {
    const dir = join(__dirname, '../../services/prospectDiscovery');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).not.toMatch(/drishiq/i);
    }
    // And the route that records a search carries no tenant special case either.
    const route = readFileSync(join(__dirname, '../../../pages/api/prospect-sources/discovery.ts'), 'utf8');
    expect(route).not.toMatch(/drishiq/i);
  });

  it('the discovery layer introduces NO second credential store', () => {
    const dir = join(__dirname, '../../services/prospectDiscovery');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      // It may reference the A3M port; it must never reach the credential table
      // or the encryption primitive itself.
      expect(src).not.toMatch(/integration_credentials/);
      expect(src).not.toMatch(/encryptCredential|decryptCredential/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('B4-A2 — Apollo remains UNAUTHENTICATED and UNREACHABLE in this gate', () => {
  it('no Apollo discovery provider exists to be registered', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const {
      listDiscoveryProviders, hasDiscoveryProvider,
    } = require('../../services/prospectDiscovery/providerRegistry');
    /* eslint-enable @typescript-eslint/no-var-requires */
    expect(listDiscoveryProviders()).toEqual([]);
    expect(hasDiscoveryProvider('apollo')).toBe(false);
  });

  it('a tenant WITH a credential still cannot run discovery — no adapter exists', async () => {
    const store = credentialStore({ [`${ORG_A}::apollo`]: SYNTHETIC_A });
    const l = ledger();
    // `hasProvider` is the REAL registry here, not a stub: a credential alone must
    // not make a vendor reachable. This is what keeps the next gate's
    // authorization meaningful.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { hasDiscoveryProvider } = require('../../services/prospectDiscovery/providerRegistry');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const r = await createDiscoveryExecution(
      search(ORG_A),
      { ...l.ports, credential: store.port, hasProvider: hasDiscoveryProvider },
    ) as any;
    expect(r.readyForProviderExecution).toBe(false);
    expect(r.refusal).toBe('provider_not_registered');
    expect(l.rows[0].provider_call_state).toBe('not_called');
  });

  // A general "does any file hold a secret-shaped token" scan was WRITTEN AND
  // REMOVED rather than weakened. Every heuristic for it flagged ordinary
  // identifiers (`provider_not_registered`), and a guard that cries wolf gets
  // relaxed until it proves nothing. The real assurance is narrower and checked
  // above and in the gate's report: no `APOLLO_API_KEY` appears in this layer,
  // no credential is read from the environment, and a repository-wide scan for
  // an assigned Apollo key literal found none.
});
