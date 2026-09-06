/**
 * A3 — the enrichment provider boundary.
 *
 * The provider is doubled, so what is proven here is the EXECUTOR'S behaviour:
 * the order of its checks, and what it refuses to do.
 *
 * The load-bearing assertions are the ones a careless enrichment path would
 * fail: a paid call made before cost was authorised, a retry that multiplies
 * spend, an unrecognised error read as "the provider does not know this
 * person", and a failed enrichment that touches a canonical identity.
 */

import {
  executeEnrichment, registerProvider, unregisterProvider, listProviderStatus,
  providersFor, hasCredential, classifyEnrichmentError, defaultCostPort, wasFree,
  DECLARED_PROVIDERS,
  type EnrichmentProviderAdapter, type EnrichmentRequest, type ExecuteEnrichmentPorts,
  type ProviderResponse,
} from '../../services/enrichment/providers';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const OTHER_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ENTITY = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-05T00:00:00.000Z';

const request = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG,
  subject: 'person',
  entityId: ENTITY,
  attributes: ['job_title', 'department'],
  selectors: { email_domain: 'example.com' },
  purpose: 'icp evaluation',
  correlationId: 'corr-1',
  ...over,
});

/** A deterministic fake. No network, no credential, no invented provider shape. */
function fakeAdapter(over: Partial<EnrichmentProviderAdapter> & { response?: ProviderResponse } = {}): EnrichmentProviderAdapter {
  const calls: EnrichmentRequest[] = [];
  const adapter: EnrichmentProviderAdapter & { calls: EnrichmentRequest[] } = {
    id: over.id ?? 'fake',
    label: 'Fake provider',
    supports: over.supports ?? ['job_title', 'department', 'country_code'],
    credentialEnvVar: over.credentialEnvVar === undefined ? 'FAKE_API_KEY' : over.credentialEnvVar,
    isAvailable: over.isAvailable ?? (() => true),
    calls,
    async enrich(req) {
      calls.push(req);
      if (over.enrich) return over.enrich(req);
      return over.response ?? {
        outcome: 'enriched',
        fields: [{
          attribute: 'job_title', subject: 'person', value: 'Marketing Manager',
          observedAt: '2026-08-01T00:00:00.000Z', confidence: 0.9, providerInferred: false,
        }],
        notReturned: ['department'],
        payloadHash: 'hash-1',
        rawPayload: { title: 'Marketing Manager' },
      };
    },
  };
  return adapter;
}

interface Recorded { authorized: number; released: string[]; persisted: number }

function ports(over: Partial<ExecuteEnrichmentPorts> & { rec?: Recorded } = {}): ExecuteEnrichmentPorts {
  const rec = over.rec ?? { authorized: 0, released: [], persisted: 0 };
  return {
    authorizeCost: over.authorizeCost ?? (async () => {
      rec.authorized += 1;
      return { authorized: true, holdId: 'hold-1', cost: { kind: 'free' } };
    }),
    releaseCost: over.releaseCost ?? (async (_h, reason) => { rec.released.push(reason); }),
    // A3M: tenant-owned credential. Defaults to present so the tests below stay
    // about what they were about; the absence case has its own suite.
    resolveCredential: over.resolveCredential ?? (async () => 'tenant-scoped-test-secret'),
    findRecentObservation: over.findRecentObservation ?? (async () => null),
    persistObservation: over.persistObservation ?? (async () => {
      rec.persisted += 1;
      return { sourceRecordId: 'src-1', canonicalWithheld: [] };
    }),
    now: over.now ?? (() => NOW),
  };
}

// A3M changed what this env var is for. The EXECUTOR no longer consults it —
// it asks the tenant credential port — but the fake adapter's own
// `isAvailable()` and the registry's `hasCredential` still describe an
// adapter's configuration, and `listProviderStatus` reports on it. It is set
// here for those, never as evidence that a tenant may spend.
beforeEach(() => { process.env.FAKE_API_KEY = 'test-only-not-a-real-key'; });
afterEach(() => {
  delete process.env.FAKE_API_KEY;
  unregisterProvider('fake');
  unregisterProvider('other');
});

describe('A3 — registry tells the truth about what can be called', () => {
  it('reports every architecture-declared provider as declared, with no adapter', () => {
    const status = listProviderStatus();
    for (const declared of DECLARED_PROVIDERS) {
      const row = status.find((s) => s.id === declared.id);
      expect(row?.state).toBe('declared');
      expect(row?.callable).toBe(false);
    }
  });

  it('reports NO operational provider in this environment', () => {
    expect(listProviderStatus().filter((s) => s.callable)).toHaveLength(0);
    expect(providersFor(['job_title'])).toHaveLength(0);
  });

  it('distinguishes an adapter without a credential from an operational one', () => {
    registerProvider(fakeAdapter({ isAvailable: () => false }));
    expect(listProviderStatus().find((s) => s.id === 'fake')?.state).toBe('implemented');
    unregisterProvider('fake');

    registerProvider(fakeAdapter());
    expect(listProviderStatus().find((s) => s.id === 'fake')?.state).toBe('operational');
  });

  it('reads credential presence only, never the value', () => {
    process.env.A3_TEST_KEY = 'secret-value';
    expect(hasCredential('A3_TEST_KEY')).toBe(true);
    expect(hasCredential('A3_TEST_ABSENT')).toBe(false);
    expect(hasCredential('  ' as string)).toBe(false);
    delete process.env.A3_TEST_KEY;
  });
});

describe('A3 — cost is authorised BEFORE any provider call', () => {
  it('refuses and never calls the provider when cost is denied', async () => {
    const adapter = fakeAdapter() as EnrichmentProviderAdapter & { calls: unknown[] };
    const r = await executeEnrichment(request(), 'fake', ports({
      authorizeCost: async () => ({ authorized: false, reason: 'no credit action registered' }),
    }), { adapter });

    expect(r.outcome).toBe('cost_denied');
    expect(r.providerCalled).toBe(false);
    expect(adapter.calls).toHaveLength(0);       // the decisive assertion
    expect(r.reason).toContain('no credit action');
  });

  // A3X retargeted this. The default port used to RESERVE Omnivyra credits and
  // therefore refused, because no prospect-enrichment action was priced. Under
  // BYO-provider there is nothing of Omnivyra's to reserve: the tenant holds
  // the vendor subscription and is invoiced directly, so the port authorises
  // and takes no hold. The refusal that still matters — a tenant with no
  // credential — happens earlier, and is asserted above.
  it('the default port authorises tenant-funded execution and reserves nothing', async () => {
    const decision = await defaultCostPort.authorizeCost({
      organizationId: ORG, providerId: 'fake', attributes: ['job_title'], correlationId: 'c',
    });
    expect(decision.authorized).toBe(true);
    if (decision.authorized) {
      expect(decision.holdId).toBeNull();
      expect(decision.cost).toEqual({ kind: 'unknown' });
    }
  });

  it('releases the reservation when the provider errors', async () => {
    const rec: Recorded = { authorized: 0, released: [], persisted: 0 };
    const adapter = fakeAdapter({ enrich: async () => { throw new Error('ETIMEDOUT'); } });
    const r = await executeEnrichment(request(), 'fake', ports({ rec }), { adapter });
    expect(r.outcome).toBe('timeout');
    expect(rec.released[0]).toContain('timeout');
  });

  it('releases the reservation when the provider returns nothing usable', async () => {
    const rec: Recorded = { authorized: 0, released: [], persisted: 0 };
    const adapter = fakeAdapter({
      response: { outcome: 'no_match', fields: [], notReturned: ['job_title', 'department'] },
    });
    const r = await executeEnrichment(request(), 'fake', ports({ rec }), { adapter });
    expect(r.outcome).toBe('no_match');
    expect(rec.persisted).toBe(0);
    expect(rec.released).toHaveLength(1);
  });

  it('makes exactly ONE provider call per authorised request — retry cannot multiply spend', async () => {
    const rec: Recorded = { authorized: 0, released: [], persisted: 0 };
    const adapter = fakeAdapter() as EnrichmentProviderAdapter & { calls: unknown[] };
    await executeEnrichment(request(), 'fake', ports({ rec }), { adapter });
    expect(adapter.calls).toHaveLength(1);
    expect(rec.authorized).toBe(1);
  });
});

describe('A3 — refusals that cost nothing', () => {
  it('refuses when no adapter is registered', async () => {
    const r = await executeEnrichment(request(), 'apollo', ports());
    expect(r.outcome).toBe('not_implemented');
    expect(r.providerCalled).toBe(false);
    expect(wasFree(r.outcome)).toBe(true);
  });

  // A3M retargeted this at the condition that actually authorises a call. It
  // used to force `isAvailable() => false` and assert the reason named the ENV
  // VAR — i.e. it pinned "Omnivyra has no key" as the refusal. The refusal that
  // matters is "THIS TENANT has no credential", and the adapter below reports
  // itself perfectly available to prove the executor no longer cares.
  it('refuses when THIS TENANT has no credential, however available the adapter claims to be', async () => {
    const adapter = fakeAdapter({ isAvailable: () => true }) as EnrichmentProviderAdapter & { calls: unknown[] };
    const r = await executeEnrichment(
      request(), 'fake', ports({ resolveCredential: async () => null }), { adapter },
    );
    expect(r.outcome).toBe('credential_missing');
    expect(r.reason).toContain('this tenant');
    expect(adapter.calls).toHaveLength(0);
    expect(wasFree(r.outcome)).toBe(true);
  });

  it('refuses when the provider supplies none of the requested attributes', async () => {
    const adapter = fakeAdapter({ supports: ['annual_revenue'] }) as EnrichmentProviderAdapter & { calls: unknown[] };
    const r = await executeEnrichment(request(), 'fake', ports(), { adapter });
    expect(r.outcome).toBe('field_not_found');
    expect(adapter.calls).toHaveLength(0);
  });

  it('suppresses a duplicate before authorising cost', async () => {
    const rec: Recorded = { authorized: 0, released: [], persisted: 0 };
    const adapter = fakeAdapter() as EnrichmentProviderAdapter & { calls: unknown[] };
    const r = await executeEnrichment(request(), 'fake', ports({
      rec,
      findRecentObservation: async () => ({ observedAt: '2026-09-01T00:00:00.000Z' }),
    }), { adapter });

    expect(r.outcome).toBe('duplicate_suppressed');
    expect(rec.authorized).toBe(0);              // cheaper than a reservation
    expect(adapter.calls).toHaveLength(0);
  });

  it('does NOT suppress an observation older than the freshness window', async () => {
    const adapter = fakeAdapter() as EnrichmentProviderAdapter & { calls: unknown[] };
    const r = await executeEnrichment(request(), 'fake', ports({
      findRecentObservation: async () => ({ observedAt: '2026-01-01T00:00:00.000Z' }),
    }), { adapter });
    expect(r.outcome).toBe('enriched');
    expect(adapter.calls).toHaveLength(1);
  });
});

describe('A3 — failure classification never invents a negative fact', () => {
  it.each([
    ['ETIMEDOUT', 'timeout'],
    ['429 rate limit exceeded', 'rate_limited'],
    ['401 unauthorized', 'provider_declined'],
    ['404 not found', 'no_match'],
    ['unexpected token in JSON', 'malformed_response'],
    ['quota exhausted', 'quota_exceeded'],
  ])('classifies %s as %s', (message, expected) => {
    expect(classifyEnrichmentError(new Error(message))).toBe(expected);
  });

  it('classifies an UNRECOGNISED error as unavailable, never as no_match', () => {
    // Reading our own failure as "the provider does not know this person" would
    // write a negative fact about a real person out of an outage.
    expect(classifyEnrichmentError(new Error('something odd happened'))).toBe('provider_unavailable');
    expect(classifyEnrichmentError(null)).toBe('provider_unavailable');
  });
});

describe('A3 — provenance and non-fabrication', () => {
  it('persists an observation carrying the PROVIDER\'s timestamp, not ours', async () => {
    let persisted: Record<string, unknown> | null = null;
    const adapter = fakeAdapter();
    await executeEnrichment(request(), 'fake', ports({
      persistObservation: async (input) => {
        persisted = input as unknown as Record<string, unknown>;
        return { sourceRecordId: 'src-1', canonicalWithheld: [] };
      },
    }), { adapter });

    expect(persisted).not.toBeNull();
    expect((persisted as Record<string, unknown>).observedAt).toBe('2026-08-01T00:00:00.000Z');
    expect((persisted as Record<string, unknown>).observedAt).not.toBe(NOW);
    expect((persisted as Record<string, unknown>).providerId).toBe('fake');
    expect((persisted as Record<string, unknown>).payloadHash).toBe('hash-1');
  });

  it('records what the provider did NOT return rather than treating it as false', async () => {
    const r = await executeEnrichment(request(), 'fake', ports(), { adapter: fakeAdapter() });
    expect(r.attributesReturned).toEqual(['job_title']);
    expect(r.attributesNotReturned).toContain('department');
    expect(r.normalized?.apply.person).not.toHaveProperty('department');
  });

  it('drops empty provider values instead of writing them as observations', async () => {
    const rec: Recorded = { authorized: 0, released: [], persisted: 0 };
    const adapter = fakeAdapter({
      response: {
        outcome: 'enriched', notReturned: [],
        fields: [{ attribute: 'job_title', subject: 'person', value: '', observedAt: null, confidence: null, providerInferred: false }],
      },
    });
    const r = await executeEnrichment(request(), 'fake', ports({ rec }), { adapter });
    expect(r.outcome).toBe('field_not_found');
    expect(rec.persisted).toBe(0);
  });

  it('surfaces canonical values LI-2 withheld rather than claiming they applied', async () => {
    const r = await executeEnrichment(request(), 'fake', ports({
      persistObservation: async () => ({
        sourceRecordId: 'src-1',
        canonicalWithheld: [{ attribute: 'job_title', reason: 'sources_disagree' }],
      }),
    }), { adapter: fakeAdapter() });
    expect(r.canonicalWithheld).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
  });
});

describe('A3 — a failure never touches a canonical identity', () => {
  it.each([
    // A3M: "credential missing" is now a TENANT fact, so it is expressed
    // through the port rather than by crippling the adapter.
    ['credential missing', fakeAdapter(), { resolveCredential: async () => null }],
    ['provider error', fakeAdapter({ enrich: async () => { throw new Error('boom'); } }), {}],
    ['no match', fakeAdapter({ response: { outcome: 'no_match', fields: [], notReturned: [] } }), {}],
  ])('writes nothing on %s', async (_label, adapter, over) => {
    const rec: Recorded = { authorized: 0, released: [], persisted: 0 };
    await executeEnrichment(request(), 'fake', ports({ rec, ...(over as object) }), { adapter });
    expect(rec.persisted).toBe(0);
  });
});

describe('A3 — tenant isolation', () => {
  it('threads only the caller-verified tenant to the provider and the writer', async () => {
    let persistedOrg = ''; let calledOrg = '';
    const adapter = fakeAdapter({
      enrich: async (req) => {
        calledOrg = req.organizationId;
        return { outcome: 'enriched', notReturned: [], fields: [{ attribute: 'job_title', subject: 'person', value: 'X', observedAt: null, confidence: null, providerInferred: false }] };
      },
    });
    await executeEnrichment(request(), 'fake', ports({
      persistObservation: async (i) => { persistedOrg = i.organizationId; return { sourceRecordId: 's', canonicalWithheld: [] }; },
    }), { adapter });

    expect(calledOrg).toBe(ORG);
    expect(persistedOrg).toBe(ORG);
    expect(persistedOrg).not.toBe(OTHER_ORG);
  });

  it('refuses a tenant-less request before doing anything', async () => {
    const adapter = fakeAdapter() as EnrichmentProviderAdapter & { calls: unknown[] };
    const r = await executeEnrichment(request({ organizationId: '   ' }), 'fake', ports(), { adapter });
    expect(r.reason).toContain('never tenant-less');
    expect(adapter.calls).toHaveLength(0);
  });

  it('scopes the duplicate lookup to the requesting tenant', async () => {
    let seen = '';
    await executeEnrichment(request(), 'fake', ports({
      findRecentObservation: async (i) => { seen = i.organizationId; return null; },
    }), { adapter: fakeAdapter() });
    expect(seen).toBe(ORG);
  });
});

describe('A3 — GAP-3 attributes remain unsupported', () => {
  it.each(['seniority', 'authority', 'influence', 'buying_role'])(
    'no registered provider claims to supply %s', (attribute) => {
      expect(providersFor([attribute])).toHaveLength(0);
      for (const s of listProviderStatus()) expect(s.supports).not.toContain(attribute);
    });
});
