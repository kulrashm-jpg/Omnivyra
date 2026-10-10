/**
 * E — PROVIDER READINESS IS EXPLICIT, AND NEVER OVERSTATED.
 *
 * WHY THIS SUITE EXISTS. `providerRegistry` could tell a caller only that a slot
 * was `unavailable`. The four states that must never collapse —
 *
 *   a missing credential      (nothing was asked)
 *   an adapter load failure   (we tried to wire it and it broke)
 *   an operator kill switch   (someone chose to stop using a working provider)
 *   a measured zero           (we asked and the answer was zero)
 *
 * — all presented identically, and the prose that did distinguish them had
 * already drifted from the code: the knowledge-graph slot told operators Wikidata
 * "activates when WIKIDATA_ENABLED=true" (it activates BY DEFAULT), the
 * authority slot told them to wire MOZ_API_KEY / MAJESTIC_API_KEY (neither
 * adapter exists), and the LLM slots told them to set "the corresponding API
 * key" without saying which of five.
 *
 * NOTHING HERE MAKES ANYTHING MEASURABLE. Every assertion is about diagnosis.
 *
 * SECRETS. No credential value is read, asserted on, or printed. The only real
 * key in this environment (OPENAI_API_KEY, supplied by .env.test as a
 * placeholder) is used exclusively to prove that its VALUE never reaches a
 * readiness row.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import {
  PROVIDER_SLOTS,
  _resetIntelligenceRegistry,
  describeProviderReadiness,
  getAuthorityInflowProvider,
  getKnowledgeGraphProvider,
  getLLMProvider,
  slotEnvNames,
  type ProviderSlotAvailability,
  type ProviderSlotKey,
} from '../../services/intelligence/providerRegistry';
import { AI_PROVIDERS } from '../../services/intelligence/providerInterfaces';

/** Provider-gating variables this suite controls. Values are never asserted on. */
const GATED_VARS = [
  'PERPLEXITY_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'AZURE_COPILOT_API_KEY',
  'AHREFS_API_KEY',
  'WIKIDATA_ENABLED',
  'TRUST_COHERENCE_ENABLED',
  'BENCHMARK_DATASET_PATH',
  'AUTHORITY_TRAJECTORY_ENABLED',
  'CRM_ENABLED',
  'COMMERCIAL_EVIDENCE_ENABLED',
  'SUPABASE_HISTORY_ENABLED',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of GATED_VARS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  _resetIntelligenceRegistry();
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
  _resetIntelligenceRegistry();
});

const rowFor = (slot: ProviderSlotKey) => {
  const row = describeProviderReadiness().find((r) => r.slot === slot);
  expect(row).toBeDefined();
  return row!;
};

describe('E — every registration path is a declared, reportable slot', () => {
  it('declares a slot for every AI provider id', () => {
    // The drift guard: a sixth provider added to AI_PROVIDERS without a slot
    // would be registered by nothing and reported by nothing.
    for (const id of AI_PROVIDERS) {
      expect(PROVIDER_SLOTS[`llm:${id}`]).toBeDefined();
      expect(slotEnvNames(`llm:${id}`).length).toBeGreaterThan(0);
    }
  });

  it('reports one row per declared slot, and nothing else', () => {
    const rows = describeProviderReadiness();
    expect(rows.map((r) => r.slot).sort()).toEqual(Object.keys(PROVIDER_SLOTS).sort());
  });

  it('never claims a provider is reachable', () => {
    // THE HONESTY CONSTRAINT, checked at runtime as well as in the type: this
    // descriptor performs no provider call, so it may not report LIVE.
    const allowed: ProviderSlotAvailability[] = [
      'CONFIGURED', 'CREDENTIAL_REQUIRED', 'ADAPTER_LOAD_FAILED', 'DISABLED', 'NOT_IMPLEMENTED',
    ];
    for (const row of describeProviderReadiness()) {
      expect(allowed).toContain(row.availability);
      expect(row.availability).not.toBe('LIVE');
    }
  });
});

describe('E — Perplexity readiness: unconfigured is a prerequisite, not a finding', () => {
  it('classifies the slot CREDENTIAL_REQUIRED and names the exact variable', () => {
    const row = rowFor('llm:perplexity');
    expect(row.availability).toBe<ProviderSlotAvailability>('CREDENTIAL_REQUIRED');
    expect(row.prerequisite).toEqual(['PERPLEXITY_API_KEY']);
    expect(row.loadFailure).toBeNull();
    // The distinction that matters to the reader of a report.
    expect(row.detail).toContain('not a finding about the company');
  });

  it('the probe names PERPLEXITY_API_KEY instead of "the corresponding API key"', async () => {
    // NEGATIVE CONTROL for the vague message. Restoring the old text ("set the
    // corresponding API key in env to enable") fails the first assertion: an
    // operator had to guess which of five variables was meant.
    const result = await getLLMProvider('perplexity').probe({
      provider: 'perplexity',
      query_class: 'branded',
      queries: ['What is Northwind Analytics?'],
      brandName: 'Northwind Analytics',
      domain: 'northwind.test',
    } as never);
    expect(result.reason_unavailable).toContain('PERPLEXITY_API_KEY');
    expect(result.reason_unavailable).toContain('not configured');
    // Still unmeasurable: this is a diagnosis fix, not a promotion.
    expect(result.state).toBe('unavailable');
    expect(result.observation_outcome).toBe('no_provider');
    expect(result.citation_rate).toBeNull();
  });

  it('a configured LLM slot still reports CONFIGURED — the NON-VACUITY control', () => {
    // OPENAI_API_KEY is present in this environment (placeholder), so the
    // chatgpt slot is genuinely configured and its adapter genuinely loads. If
    // this suite could only ever say "not configured" it would prove nothing.
    expect(process.env.OPENAI_API_KEY).toBeTruthy();
    const row = rowFor('llm:chatgpt');
    expect(row.availability).toBe<ProviderSlotAvailability>('CONFIGURED');
    expect(row.prerequisite).toEqual([]);
    expect(row.loadFailure).toBeNull();
  });
});

describe('E — Ahrefs readiness: only the implemented prerequisite is named', () => {
  it('classifies the slot CREDENTIAL_REQUIRED on AHREFS_API_KEY alone', () => {
    const row = rowFor('authority_inflow');
    expect(row.availability).toBe<ProviderSlotAvailability>('CREDENTIAL_REQUIRED');
    expect(row.prerequisite).toEqual(['AHREFS_API_KEY']);
    expect(row.prerequisite).not.toContain('MOZ_API_KEY');
    expect(row.prerequisite).not.toContain('MAJESTIC_API_KEY');
  });

  it('the unconfigured reason no longer points at two providers that do not exist', async () => {
    // NEGATIVE CONTROL. The previous text was "Wire AHREFS_API_KEY /
    // MOZ_API_KEY / MAJESTIC_API_KEY to enable", and the last two cannot enable
    // anything — the adapters are absent from the repo. Restoring it fails the
    // two `not.toContain` assertions below.
    const result = await getAuthorityInflowProvider().lookup({ domain: 'northwind.test' });
    expect(result.state).toBe('unavailable');
    expect(result.reason_unavailable).toContain('AHREFS_API_KEY');
    expect(result.reason_unavailable).not.toContain('MOZ_API_KEY');
    expect(result.reason_unavailable).not.toContain('MAJESTIC_API_KEY');
    expect(result.reason_unavailable).toContain('not implemented');
    // Not a measured zero: no profile, no score.
    expect(result.profile).toBeNull();
    expect(result.score).toBeNull();
  });

  it('becomes CONFIGURED once the key is present — NON-VACUITY', () => {
    process.env.AHREFS_API_KEY = 'placeholder-not-a-real-credential';
    _resetIntelligenceRegistry();
    const row = rowFor('authority_inflow');
    // The adapter is loadable: were `ahrefsAdapter` broken this would read
    // ADAPTER_LOAD_FAILED instead, which is the point of keeping them distinct.
    expect(row.availability).toBe<ProviderSlotAvailability>('CONFIGURED');
    expect(row.loadFailure).toBeNull();
  });
});

describe('E — Wikidata readiness: keyless and on by default, off only by kill switch', () => {
  it('is CONFIGURED with no prerequisite when nothing is set', () => {
    const row = rowFor('knowledge_graph');
    expect(row.availability).toBe<ProviderSlotAvailability>('CONFIGURED');
    expect(row.prerequisite).toEqual([]);
    expect(row.detail).toContain('keyless');
  });

  it('WIKIDATA_ENABLED=false reports DISABLED, not "not configured"', async () => {
    // NEGATIVE CONTROL for the kill-switch collapse. Before this, the slot kept
    // `UnavailableKnowledgeGraphProvider`, whose reason claimed no adapter was
    // configured and told the operator the switch worked the other way round
    // ("activates when WIKIDATA_ENABLED=true"). Both assertions on the reason
    // below fail if that provider is restored to this branch.
    process.env.WIKIDATA_ENABLED = 'false';
    _resetIntelligenceRegistry();

    const row = rowFor('knowledge_graph');
    expect(row.availability).toBe<ProviderSlotAvailability>('DISABLED');
    expect(row.prerequisite).toEqual([]);

    const result = await getKnowledgeGraphProvider().lookup({ brandName: 'Northwind', domain: 'northwind.test' });
    expect(result.state).toBe('unavailable');
    expect(result.reason_unavailable).toContain('WIKIDATA_ENABLED=false');
    expect(result.reason_unavailable).toContain('no credential is required');
    // A switched-off provider measures nothing — it does not measure zero.
    expect(result.entity).toBeNull();
    expect(result.score).toBeNull();
  });

  it('no setting of WIKIDATA_ENABLED=true is ever demanded', () => {
    // The old message instructed an operator to set a variable that does
    // nothing. Neither the readiness row nor its detail may say so.
    const row = rowFor('knowledge_graph');
    expect(row.detail).not.toContain('WIKIDATA_ENABLED=true');
    expect(row.prerequisite).not.toContain('WIKIDATA_ENABLED');
  });
});

describe('E — opt-in capabilities report DISABLED, not a missing credential', () => {
  it.each([
    ['trust_coherence', 'TRUST_COHERENCE_ENABLED'],
    ['trajectory', 'AUTHORITY_TRAJECTORY_ENABLED'],
    ['commercial', 'CRM_ENABLED'],
    ['historical_store', 'SUPABASE_HISTORY_ENABLED'],
  ] as Array<[ProviderSlotKey, string]>)('%s is DISABLED until %s is set', (slot, flag) => {
    const row = rowFor(slot);
    expect(row.availability).toBe<ProviderSlotAvailability>('DISABLED');
    expect(row.prerequisite).toContain(flag);
    expect(row.detail).toContain('deliberate state, not a failure');
  });
});

describe('E — readiness can never leak a credential', () => {
  it('reports variable NAMES only — no value reaches a row', () => {
    const value = process.env.OPENAI_API_KEY;
    expect(value).toBeTruthy();
    const serialized = JSON.stringify(describeProviderReadiness());
    // Names of the unmet prerequisites ARE reported — that is the whole point.
    expect(serialized).toContain('PERPLEXITY_API_KEY');
    expect(serialized).toContain('AHREFS_API_KEY');
    // The value of the one credential this environment does hold is not, and a
    // CONFIGURED slot does not even echo its variable name as a prerequisite.
    expect(serialized).not.toContain(value!);
  });

  it('slotEnvNames reads no environment at all', () => {
    // It returns names from the declaration, so it cannot return a secret even
    // if every gating variable is set.
    process.env.PERPLEXITY_API_KEY = 'placeholder-not-a-real-credential';
    expect(slotEnvNames('llm:perplexity')).toEqual(['PERPLEXITY_API_KEY']);
  });
});
