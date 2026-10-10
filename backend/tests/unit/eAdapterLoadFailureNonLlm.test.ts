/**
 * E — A LOAD FAILURE IS NOT "NOT CONFIGURED", IN EVERY SLOT.
 *
 * WHAT WAS HALF-FIXED. D2 established the rule and applied it to the five LLM
 * slots: when an adapter's credential IS set and its module fails to load, the
 * slot is filled with a provider that says so. The other six registration paths
 * in `providerRegistry` kept `recordAdapterLoadFailure(...)` alone in the catch
 * and left the DEFAULT provider in place. The consequence, for an operator whose
 * AHREFS_API_KEY was set and whose ahrefs adapter was broken:
 *
 *     "No backlink/authority API is configured. Set AHREFS_API_KEY to enable."
 *
 * The failure was recorded in `_adapterLoadFailures` — and `getAdapterLoadFailures()`
 * had no production consumer, so nothing a caller could read ever mentioned it.
 * The operator was told to add a credential that was already there, and a broken
 * build was indistinguishable from an unconfigured one in six of eleven slots.
 *
 * THE SCORE IS UNCHANGED. `unavailable` before, `unavailable` after; no profile,
 * no entity, no score. Only the diagnosis improves.
 *
 * SECRETS. The gating variables are set to synthetic placeholders and no VALUE
 * reaches any assertion.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// Both adapters are forced to fail at require time — the exact production
// failure mode (a bad transitive import, a path that resolves at build time and
// not at runtime) that the bare catch used to hide.
jest.mock('../../services/intelligence/adapters/ahrefsAdapter', () => {
  throw new Error('Cannot find module ../productionPrimitives');
});
jest.mock('../../services/intelligence/adapters/wikidataAdapter', () => {
  throw new Error('Cannot find module ../../../../lib/platform/cacheClient');
});

import {
  _resetIntelligenceRegistry,
  describeProviderReadiness,
  getAdapterLoadFailures,
  getAuthorityInflowProvider,
  getKnowledgeGraphProvider,
  type ProviderSlotAvailability,
  type ProviderSlotKey,
} from '../../services/intelligence/providerRegistry';

const PLACEHOLDER = 'placeholder-not-a-real-credential';

let warn: jest.SpyInstance;

beforeEach(() => {
  // The harness runs with restoreMocks, so the spy is installed per test.
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  _resetIntelligenceRegistry();
  process.env.AHREFS_API_KEY = PLACEHOLDER;
  delete process.env.WIKIDATA_ENABLED;
});

afterEach(() => {
  delete process.env.AHREFS_API_KEY;
  _resetIntelligenceRegistry();
});

const rowFor = (slot: ProviderSlotKey) => {
  const row = describeProviderReadiness().find((r) => r.slot === slot);
  expect(row).toBeDefined();
  return row!;
};

describe('E — authority inflow: configured but broken', () => {
  it('records the failure against the declared slot', async () => {
    await getAuthorityInflowProvider().lookup({ domain: 'northwind.test' });
    const failure = getAdapterLoadFailures().find((f) => f.slot === 'authority_inflow');
    expect(failure).toBeDefined();
    expect(failure!.module).toContain('ahrefsAdapter');
    expect(failure!.message).toContain('productionPrimitives');
    expect(warn).toHaveBeenCalled();
  });

  it('the lookup reports the load failure instead of asking for a key that is set', async () => {
    // THE NEGATIVE CONTROL for the uncovered registration path. Restore the old
    // catch body — `recordAdapterLoadFailure('authority_inflow', …)` with no
    // substitute — and the slot keeps `UnavailableAuthorityInflowProvider`: the
    // first two assertions fail and the third passes, which is precisely the
    // lie being removed.
    const result = await getAuthorityInflowProvider().lookup({ domain: 'northwind.test' });
    expect(result.reason_unavailable).toContain('configured but failed to load');
    expect(result.reason_unavailable).toContain('ahrefsAdapter');
    expect(result.reason_unavailable).not.toContain('Set AHREFS_API_KEY to enable');
  });

  it('readiness classifies it ADAPTER_LOAD_FAILED and asks for no credential', async () => {
    const row = rowFor('authority_inflow');
    expect(row.availability).toBe<ProviderSlotAvailability>('ADAPTER_LOAD_FAILED');
    // Naming a prerequisite here would send the operator back to a variable
    // that is already set — the original defect, one level up.
    expect(row.prerequisite).toEqual([]);
    expect(row.loadFailure).not.toBeNull();
    expect(row.loadFailure!.module).toContain('ahrefsAdapter');
  });

  it('is still unmeasurable — a diagnosis fix, never a promotion', async () => {
    const provider = getAuthorityInflowProvider();
    expect(await provider.isAvailable()).toBe(false);
    const result = await provider.lookup({ domain: 'northwind.test' });
    expect(result.state).toBe('unavailable');
    expect(result.profile).toBeNull();
    expect(result.score).toBeNull();
    // A broken adapter is not a site with no backlinks.
    expect(result.score).not.toBe(0);
  });
});

describe('E — knowledge graph: configured but broken', () => {
  it('reports the load failure, not "active by default" and not a kill switch', async () => {
    // NEGATIVE CONTROL. With the old catch the slot kept
    // `UnavailableKnowledgeGraphProvider`, so an operator saw "No
    // knowledge-graph adapter is registered…" for an adapter that is keyless,
    // enabled, and simply broken.
    const result = await getKnowledgeGraphProvider().lookup({ brandName: 'Northwind', domain: 'northwind.test' });
    expect(result.reason_unavailable).toContain('configured but failed to load');
    expect(result.reason_unavailable).toContain('wikidataAdapter');
    expect(result.reason_unavailable).not.toContain('active by default');
    expect(result.reason_unavailable).not.toContain('WIKIDATA_ENABLED=false');
    expect(result.state).toBe('unavailable');
    // NOT a measured zero: a module that did not load observed nothing.
    expect(result.entity).toBeNull();
    expect(result.score).toBeNull();
  });

  it('readiness classifies it ADAPTER_LOAD_FAILED, distinct from DISABLED', () => {
    const row = rowFor('knowledge_graph');
    expect(row.availability).toBe<ProviderSlotAvailability>('ADAPTER_LOAD_FAILED');
    expect(row.availability).not.toBe('DISABLED');
    expect(row.availability).not.toBe('CREDENTIAL_REQUIRED');
  });
});

describe('E — the four states stay distinct in one readiness report', () => {
  it('a broken slot, an unconfigured slot and a switched-off slot read differently', () => {
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.TRUST_COHERENCE_ENABLED;
    _resetIntelligenceRegistry();
    const rows = describeProviderReadiness();
    const by = (slot: ProviderSlotKey) => rows.find((r) => r.slot === slot)!.availability;

    expect(by('authority_inflow')).toBe<ProviderSlotAvailability>('ADAPTER_LOAD_FAILED');
    expect(by('llm:perplexity')).toBe<ProviderSlotAvailability>('CREDENTIAL_REQUIRED');
    expect(by('trust_coherence')).toBe<ProviderSlotAvailability>('DISABLED');
    // NON-VACUITY: the one genuinely working slot in this environment is still
    // reported as configured, so this is not blanket suppression.
    expect(process.env.OPENAI_API_KEY).toBeTruthy();
    expect(by('llm:chatgpt')).toBe<ProviderSlotAvailability>('CONFIGURED');
  });

  it('no credential value appears in any failure record or reason', async () => {
    const secret = process.env.AHREFS_API_KEY!;
    const result = await getAuthorityInflowProvider().lookup({ domain: 'northwind.test' });
    expect(JSON.stringify(getAdapterLoadFailures())).not.toContain(secret);
    expect(JSON.stringify(describeProviderReadiness())).not.toContain(secret);
    expect(result.reason_unavailable ?? '').not.toContain(secret);
  });
});
