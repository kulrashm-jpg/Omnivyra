// Canonical provider registry. Returns `unavailable` adapters by default; real
// adapters register themselves at boot via `registerLLMProvider` etc. when their
// credentials are present.
//
// This is the single switchboard between the canonical report builder and every
// external integration. Phase 3 ships the architecture; real providers are wired
// when their respective env keys are configured (see `loadConfiguredProviders()`).

import type {
  AIProviderId,
  AIQueryClass,
  AIVisibilityProbe,
  AIVisibilityProbeResult,
  AuthorityInflowProvider,
  AuthorityInflowResult,
  AuthorityTrajectoryProvider,
  AuthorityTrajectoryResult,
  BenchmarkProvider,
  BenchmarkResult,
  CommercialProvider,
  CommercialResult,
  EntityIntelligenceResult,
  KnowledgeGraphProvider,
  LLMVisibilityProvider,
  TrustCoherenceProvider,
  TrustCoherenceResult,
} from './providerInterfaces';
import { AI_PROVIDERS, unavailableResult } from './providerInterfaces';
// E — READINESS VOCABULARY IS NOT INVENTED HERE. `ProviderAvailability` is the
// project's existing provider-readiness union (CPG-011 §3, registry/providerContract):
// LIVE / INACCESSIBLE / CREDENTIAL_REQUIRED / NOT_IMPLEMENTED. Imported as a TYPE
// ONLY — erased at compile time, so this adds no runtime dependency on the
// company-profile subsystem and cannot create an import cycle.
import type { ProviderAvailability } from '../companyProfile/grounding/registry/providerContract';

class UnavailableLLMProvider implements LLMVisibilityProvider {
  constructor(public readonly id: AIProviderId) {}
  /**
   * D1 — a provider that does not exist retrieves nothing. False here is not a
   * placeholder: it is what keeps the stub incapable of yielding `measured`.
   */
  public readonly retrieval_grounded = false;
  async isAvailable(): Promise<boolean> { return false; }
  async probe(probe: AIVisibilityProbe): Promise<AIVisibilityProbeResult> {
    return unavailableResult<AIVisibilityProbeResult>({
      provider: this.id,
      query_class: probe.query_class,
      // D1 — we never asked, which is a different finding from asking and failing.
      observation_outcome: 'no_provider',
      citation_rate: null,
      mean_prominence: null,
      mentions: [],
      // E — name the ACTUAL variable. "Set the corresponding API key" made the
      // operator guess which one, and the five differ (OPENAI_API_KEY,
      // ANTHROPIC_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY,
      // AZURE_COPILOT_API_KEY); the name is read from the slot declaration, so
      // it is the same variable the bootstrap gates on. The variable NAME only:
      // no value is read.
      reason: `${this.id} adapter is not configured — set ${
        slotEnvNames(`llm:${this.id}`).join(' / ')} in the environment to enable it.`,
    });
  }
}

/**
 * D2 — "configured but broken" is NOT "not configured".
 *
 * THE DEFECT. Every adapter registration below is a dynamic `require()` wrapped
 * in a `catch` with an empty body. When an LLM adapter's credential WAS set but
 * the module failed to load — a syntax error, a bad transitive import, a bundler
 * path that resolves at build time but not at runtime — the catch swallowed the
 * error and the slot kept `UnavailableLLMProvider`, whose probe reports
 * `observation_outcome: 'no_provider'` and the reason "adapter not configured —
 * set the corresponding API key in env to enable."
 *
 * That sentence is false in exactly the case that matters: the key IS set. An
 * operator reading it adds a credential that is already there, and a broken
 * build is indistinguishable from an unconfigured one. The load failure left no
 * trace anywhere — no log, no counter, no report field.
 *
 * THE FIX. The failure is recorded, and the slot is filled with a provider that
 * says what actually happened: `provider_failed`, naming the adapter module and
 * the error. The ScoreState is unchanged (`unavailable` either way) and no cell
 * becomes measurable as a result — only the diagnosis improves. The text is the
 * exception's own message; no environment value is ever read into it.
 */
// ── Declared slots: what this registry can register, and what gates each one ──
//
// E — THE DRIFT THIS REMOVES. Before, each registration's gate (`if
// (process.env.X)`), its module path and the env var named in its "not
// configured" message were three independent copies of the same fact, written
// in three places. They had already drifted: `UnavailableKnowledgeGraphProvider`
// told operators Wikidata "activates when WIKIDATA_ENABLED=true" when it in fact
// activates BY DEFAULT, and `UnavailableAuthorityInflowProvider` told them to
// "wire AHREFS_API_KEY / MOZ_API_KEY / MAJESTIC_API_KEY" when two of those three
// adapters do not exist in the repo at all, so setting them does nothing.
//
// The table below is the single declaration. `recordAdapterLoadFailure` accepts
// only a key from it, so a registration path that can fail is, by construction,
// a path `describeProviderReadiness()` knows about.

/** How a slot is turned on. Distinct kinds because the operator remedy differs. */
type SlotGate =
  /** Needs a value (a credential, or a dataset path) this environment does not have. */
  | { readonly kind: 'env_value'; readonly envNames: readonly string[] }
  /** Off until an operator opts in. Absence is a choice, not a missing credential. */
  | { readonly kind: 'enable_flag'; readonly flags: readonly string[] }
  /** On unless an operator switches it off (a kill switch). */
  | { readonly kind: 'default_on'; readonly disableFlag: string };

type SlotDeclaration = {
  readonly module: string;
  readonly gate: SlotGate;
  /** What Report 1 loses while this slot is not configured. Never a secret. */
  readonly capability: string;
};

export const PROVIDER_SLOTS = {
  // One slot per `AI_PROVIDERS` id. Written out rather than generated: the
  // require() paths in the bootstrap must stay STATIC string literals (a
  // variable path breaks the Next.js webpack build — see the Moz/Majestic note
  // below), so the declaration is kept in the same literal form.
  'llm:chatgpt': {
    module: './adapters/openaiAdapter',
    gate: { kind: 'env_value', envNames: ['OPENAI_API_KEY'] },
    capability: 'AI visibility probe (chatgpt)',
  },
  'llm:claude': {
    module: './adapters/anthropicAdapter',
    gate: { kind: 'env_value', envNames: ['ANTHROPIC_API_KEY'] },
    capability: 'AI visibility probe (claude)',
  },
  'llm:gemini': {
    module: './adapters/geminiAdapter',
    gate: { kind: 'env_value', envNames: ['GEMINI_API_KEY'] },
    capability: 'AI visibility probe (gemini)',
  },
  'llm:perplexity': {
    module: './adapters/perplexityAdapter',
    gate: { kind: 'env_value', envNames: ['PERPLEXITY_API_KEY'] },
    // The only retrieval-grounded engine in the repo, so the only slot through
    // which AI visibility can ever reach `measured`.
    capability: 'AI visibility probe (perplexity)',
  },
  'llm:copilot': {
    module: './adapters/copilotAdapter',
    gate: { kind: 'env_value', envNames: ['AZURE_COPILOT_API_KEY'] },
    capability: 'AI visibility probe (copilot)',
  },
  knowledge_graph: {
    module: './adapters/wikidataAdapter',
    // Wikidata is public and keyless, so it is ON by default and only a kill
    // switch turns it off. There is no `WIKIDATA_ENABLED=true` to set.
    gate: { kind: 'default_on', disableFlag: 'WIKIDATA_ENABLED' },
    capability: 'Knowledge-graph entity presence (Wikidata)',
  },
  authority_inflow: {
    module: './adapters/ahrefsAdapter',
    // Ahrefs is the ONLY implemented backlink provider. Moz and Majestic are
    // NOT_IMPLEMENTED — the adapter files are absent (see the bootstrap note),
    // so MOZ_API_KEY / MAJESTIC_API_KEY cannot enable anything and are
    // deliberately not named as prerequisites.
    gate: { kind: 'env_value', envNames: ['AHREFS_API_KEY'] },
    capability: 'Backlink / authority inflow (Ahrefs)',
  },
  trust_coherence: {
    module: './adapters/trustCoherenceAdapter',
    gate: { kind: 'enable_flag', flags: ['TRUST_COHERENCE_ENABLED'] },
    capability: 'Trust coherence (NAP / review parity)',
  },
  benchmark: {
    module: './adapters/benchmarkDatasetAdapter',
    // A dataset PATH, not a credential — but the operator remedy is the same
    // shape: supply a value this environment does not have.
    gate: { kind: 'env_value', envNames: ['BENCHMARK_DATASET_PATH'] },
    capability: 'Peer benchmark bands',
  },
  trajectory: {
    module: './adapters/reportScoreHistoryAdapter',
    gate: { kind: 'enable_flag', flags: ['AUTHORITY_TRAJECTORY_ENABLED'] },
    capability: 'Authority trajectory / velocity',
  },
  commercial: {
    module: './adapters/commercialAdapter',
    gate: { kind: 'enable_flag', flags: ['CRM_ENABLED', 'COMMERCIAL_EVIDENCE_ENABLED'] },
    capability: 'Commercial outcomes (ROI determinability)',
  },
  historical_store: {
    module: './supabaseHistoryStore',
    gate: { kind: 'enable_flag', flags: ['SUPABASE_HISTORY_ENABLED'] },
    capability: 'Durable score history (trajectory / forecast persistence)',
  },
} as const satisfies Record<string, SlotDeclaration>;

export type ProviderSlotKey = keyof typeof PROVIDER_SLOTS;

/**
 * E — the environment variable NAMES a slot's gate consults, whatever its kind.
 * NAMES ONLY: this function cannot return a credential, because it never reads
 * `process.env` at all.
 */
export function slotEnvNames(slot: ProviderSlotKey): readonly string[] {
  const gate: SlotGate = PROVIDER_SLOTS[slot].gate;
  switch (gate.kind) {
    case 'env_value': return gate.envNames;
    case 'enable_flag': return gate.flags;
    case 'default_on': return [gate.disableFlag];
  }
}

export type AdapterLoadFailure = {
  readonly slot: ProviderSlotKey;
  readonly module: string;
  readonly message: string;
  readonly at: string;
};

const _adapterLoadFailures: AdapterLoadFailure[] = [];

function recordAdapterLoadFailure(
  // E — a declared key, not a free string: a failure can only be recorded for a
  // slot `describeProviderReadiness()` reports on, so the two cannot drift.
  slot: ProviderSlotKey,
  moduleName: string,
  error: unknown,
): AdapterLoadFailure {
  const failure: AdapterLoadFailure = {
    slot,
    module: moduleName,
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  };
  _adapterLoadFailures.push(failure);
  // eslint-disable-next-line no-console
  console.warn('[intelligence-provider] adapter_load_failed', failure);
  return failure;
}

/** Load failures seen during bootstrap. Read-only; drives operator diagnosis and tests. */
export function getAdapterLoadFailures(): readonly AdapterLoadFailure[] {
  return [..._adapterLoadFailures];
}

class AdapterLoadFailedLLMProvider implements LLMVisibilityProvider {
  constructor(
    public readonly id: AIProviderId,
    private readonly failure: AdapterLoadFailure,
  ) {}
  /** A module that did not load retrieves nothing, so `measured` stays unreachable. */
  public readonly retrieval_grounded = false;
  async isAvailable(): Promise<boolean> { return false; }
  async probe(probe: AIVisibilityProbe): Promise<AIVisibilityProbeResult> {
    return unavailableResult<AIVisibilityProbeResult>({
      provider: this.id,
      query_class: probe.query_class,
      // We tried to wire it and it broke — categorically different from never
      // having been asked to.
      observation_outcome: 'provider_failed',
      citation_rate: null,
      mean_prominence: null,
      mentions: [],
      reason: `${this.id} adapter is configured but failed to load (${this.failure.module}): ${this.failure.message}`,
    });
  }
}

/**
 * Register an LLM adapter, or — when its module fails to load — a provider that
 * reports the load failure instead of impersonating an unconfigured slot.
 */
function registerLLMAdapterOrRecordFailure(
  id: AIProviderId,
  load: () => LLMVisibilityProvider,
): void {
  try {
    registerLLMProvider(load());
  } catch (error) {
    // E — the module path comes from the slot declaration, so the path in the
    // diagnosis is the same string `describeProviderReadiness()` reports.
    const failure = recordAdapterLoadFailure(`llm:${id}`, PROVIDER_SLOTS[`llm:${id}`].module, error);
    registerLLMProvider(new AdapterLoadFailedLLMProvider(id, failure));
  }
}

/**
 * E — THE HALF-FIXED DEFECT. D2 gave the five LLM slots a substitute provider
 * that reports `provider_failed`; the other six registration paths kept the bare
 * `recordAdapterLoadFailure(...)` in the catch and left the DEFAULT provider in
 * place. So for knowledge graph, authority inflow, trust coherence, benchmark,
 * trajectory and commercial, an adapter that was configured and then failed to
 * load still answered with the unconfigured provider's text — "No backlink/
 * authority API is configured. Set AHREFS_API_KEY…" to an operator whose
 * AHREFS_API_KEY is already set. The failure was recorded, but nothing a caller
 * could read said so, and `getAdapterLoadFailures()` has no production consumer.
 *
 * Each substitute below answers in that slot's own result shape with
 * `loadFailedReason(...)`. The ScoreState stays `unavailable`, exactly as the
 * default provider's was: nothing becomes measurable, only diagnosable.
 */
const LOAD_FAILURE_SUBSTITUTES: Partial<Record<ProviderSlotKey, (failure: AdapterLoadFailure) => void>> = {
  knowledge_graph: (failure) => registerKnowledgeGraphProvider({
    id: 'adapter_load_failed',
    isAvailable: async () => false,
    lookup: async () => unavailableResult<EntityIntelligenceResult>({
      entity: null, score: null, reason: loadFailedReason(failure),
    }),
  }),
  authority_inflow: (failure) => registerAuthorityInflowProvider({
    id: 'adapter_load_failed',
    isAvailable: async () => false,
    lookup: async () => unavailableResult<AuthorityInflowResult>({
      profile: null, score: null, reason: loadFailedReason(failure),
    }),
  }),
  trust_coherence: (failure) => registerTrustCoherenceProvider({
    id: 'adapter_load_failed',
    isAvailable: async () => false,
    lookup: async () => unavailableResult<TrustCoherenceResult>({
      signals: null, score: null, reason: loadFailedReason(failure),
    }),
  }),
  benchmark: (failure) => registerBenchmarkProvider({
    id: 'adapter_load_failed',
    isAvailable: async () => false,
    lookup: async () => unavailableResult<BenchmarkResult>({
      band: null, percentile: null, reason: loadFailedReason(failure),
    }),
  }),
  trajectory: (failure) => registerTrajectoryProvider({
    id: 'adapter_load_failed',
    isAvailable: async () => false,
    lookup: async () => unavailableResult<AuthorityTrajectoryResult>({
      snapshots: [],
      velocity: { authority_per_30d: null, ai_visibility_per_30d: null, classification: 'insufficient_history' },
      forecast: null,
      reason: loadFailedReason(failure),
    }),
  }),
  commercial: (failure) => registerCommercialProvider({
    id: 'adapter_load_failed',
    isAvailable: async () => false,
    lookup: async () => unavailableResult<CommercialResult>({
      quantified: null, measuredRevenue: false, reason: loadFailedReason(failure),
    }),
  }),
  // `historical_store` deliberately has NO substitute: it registers into
  // `historicalPersistence`, not into this registry, and the in-memory store it
  // falls back to is a working (if volatile) implementation rather than an
  // unavailable one. The failure is still recorded and still reported by
  // `describeProviderReadiness()`.
};

/**
 * E — register a non-LLM adapter, or the substitute that reports its load
 * failure. The module path comes from `PROVIDER_SLOTS`, so the path in the error
 * message cannot drift from the path that was required.
 */
function registerAdapterOrRecordFailure(slot: ProviderSlotKey, load: () => void): void {
  try {
    load();
  } catch (error) {
    const failure = recordAdapterLoadFailure(slot, PROVIDER_SLOTS[slot].module, error);
    LOAD_FAILURE_SUBSTITUTES[slot]?.(failure);
  }
}

class UnavailableKnowledgeGraphProvider implements KnowledgeGraphProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<EntityIntelligenceResult> {
    return unavailableResult<EntityIntelligenceResult>({
      entity: null,
      score: null,
      // E — the previous text ("Wikidata adapter activates when
      // WIKIDATA_ENABLED=true") was FALSE: the bootstrap registers Wikidata
      // unless WIKIDATA_ENABLED === 'false'. An operator who set it to `true`
      // changed nothing and had no way to tell. This slot is now only reachable
      // when the adapter neither loaded nor was switched off, and says so.
      reason: 'No knowledge-graph adapter is registered. Wikidata is keyless and active by default; it is off only when WIKIDATA_ENABLED=false.',
    });
  }
}

/**
 * E — a kill switch is not a missing credential.
 *
 * `WIKIDATA_ENABLED=false` is an operator DECISION to stop using a provider that
 * works. Reporting that as "no adapter is configured" sends the next operator
 * looking for a credential that does not exist, and hides the switch that is
 * actually responsible. The ScoreState is `unavailable` either way.
 */
class DisabledKnowledgeGraphProvider implements KnowledgeGraphProvider {
  public readonly id = 'disabled';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<EntityIntelligenceResult> {
    return unavailableResult<EntityIntelligenceResult>({
      entity: null,
      score: null,
      reason: 'Wikidata knowledge-graph lookups are switched OFF by WIKIDATA_ENABLED=false. Remove that setting to re-enable; no credential is required.',
    });
  }
}

/**
 * E — the one sentence every load-failure substitute says.
 *
 * "Configured but broken" must read differently from "not configured", in the
 * same words everywhere, so an operator can recognise it across slots. No
 * environment VALUE is ever read into it: the text is the slot key, the module
 * path and the exception's own message.
 */
function loadFailedReason(failure: AdapterLoadFailure): string {
  return `${failure.slot} adapter is configured but failed to load (${failure.module}): ${failure.message}`;
}

class UnavailableAuthorityInflowProvider implements AuthorityInflowProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<AuthorityInflowResult> {
    return unavailableResult<AuthorityInflowResult>({
      profile: null,
      score: null,
      // E — the previous text named three env vars, two of which cannot work:
      // the Moz and Majestic adapters are absent from the repo (see the
      // bootstrap note), so MOZ_API_KEY / MAJESTIC_API_KEY are NOT_IMPLEMENTED
      // and setting either one enables nothing. Only the implemented
      // prerequisite is named.
      reason: 'No backlink/authority API is configured. Set AHREFS_API_KEY to enable. (Moz and Majestic are not implemented — no adapter exists for either.)',
    });
  }
}

class UnavailableTrustCoherenceProvider implements TrustCoherenceProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<TrustCoherenceResult> {
    return unavailableResult<TrustCoherenceResult>({
      signals: null,
      score: null,
      reason: 'No review or reputation source is connected yet. Trust signals become measured once one is connected.',
    });
  }
}

class UnavailableBenchmarkProvider implements BenchmarkProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<BenchmarkResult> {
    return unavailableResult<BenchmarkResult>({
      band: null,
      percentile: null,
      reason: 'No benchmark dataset is loaded. Architecture-only in Phase 3 — fabricated benchmarks are explicitly disallowed.',
    });
  }
}

class UnavailableCommercialProvider implements CommercialProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<CommercialResult> {
    return unavailableResult<CommercialResult>({
      quantified: null,
      measuredRevenue: false,
      reason: 'No commercial provider is configured. Set CRM_ENABLED / COMMERCIAL_EVIDENCE_ENABLED and connect a commercial source to enable.',
    });
  }
}

class UnavailableTrajectoryProvider implements AuthorityTrajectoryProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<AuthorityTrajectoryResult> {
    return unavailableResult<AuthorityTrajectoryResult>({
      snapshots: [],
      velocity: { authority_per_30d: null, ai_visibility_per_30d: null, classification: 'insufficient_history' },
      forecast: null,
      reason: 'No trajectory provider is configured. Wire report_score_history persistence to enable.',
    });
  }
}

// ── Mutable registry ──────────────────────────────────────────────────────────

type RegistryShape = {
  llm: Map<AIProviderId, LLMVisibilityProvider>;
  knowledgeGraph: KnowledgeGraphProvider;
  authorityInflow: AuthorityInflowProvider;
  trustCoherence: TrustCoherenceProvider;
  benchmark: BenchmarkProvider;
  trajectory: AuthorityTrajectoryProvider;
  commercial: CommercialProvider;
};

function defaultRegistry(): RegistryShape {
  const llm = new Map<AIProviderId, LLMVisibilityProvider>();
  for (const id of AI_PROVIDERS) llm.set(id, new UnavailableLLMProvider(id));
  return {
    llm,
    knowledgeGraph: new UnavailableKnowledgeGraphProvider(),
    authorityInflow: new UnavailableAuthorityInflowProvider(),
    trustCoherence: new UnavailableTrustCoherenceProvider(),
    benchmark: new UnavailableBenchmarkProvider(),
    trajectory: new UnavailableTrajectoryProvider(),
    commercial: new UnavailableCommercialProvider(),
  };
}

let _registry: RegistryShape = defaultRegistry();
let _bootstrapped = false;

export function registerLLMProvider(provider: LLMVisibilityProvider): void {
  _registry.llm.set(provider.id, provider);
}

export function registerKnowledgeGraphProvider(provider: KnowledgeGraphProvider): void {
  _registry.knowledgeGraph = provider;
}

export function registerAuthorityInflowProvider(provider: AuthorityInflowProvider): void {
  _registry.authorityInflow = provider;
}

export function registerTrustCoherenceProvider(provider: TrustCoherenceProvider): void {
  _registry.trustCoherence = provider;
}

export function registerBenchmarkProvider(provider: BenchmarkProvider): void {
  _registry.benchmark = provider;
}

export function registerTrajectoryProvider(provider: AuthorityTrajectoryProvider): void {
  _registry.trajectory = provider;
}

export function registerCommercialProvider(provider: CommercialProvider): void {
  _registry.commercial = provider;
}

export function getLLMProvider(id: AIProviderId): LLMVisibilityProvider {
  ensureBootstrapped();
  return _registry.llm.get(id) ?? new UnavailableLLMProvider(id);
}

export function getAllLLMProviders(): LLMVisibilityProvider[] {
  ensureBootstrapped();
  return AI_PROVIDERS.map((id) => getLLMProvider(id));
}

export function getKnowledgeGraphProvider(): KnowledgeGraphProvider {
  ensureBootstrapped();
  return _registry.knowledgeGraph;
}

export function getAuthorityInflowProvider(): AuthorityInflowProvider {
  ensureBootstrapped();
  return _registry.authorityInflow;
}

export function getTrustCoherenceProvider(): TrustCoherenceProvider {
  ensureBootstrapped();
  return _registry.trustCoherence;
}

export function getBenchmarkProvider(): BenchmarkProvider {
  ensureBootstrapped();
  return _registry.benchmark;
}

export function getTrajectoryProvider(): AuthorityTrajectoryProvider {
  ensureBootstrapped();
  return _registry.trajectory;
}

export function getCommercialProvider(): CommercialProvider {
  ensureBootstrapped();
  return _registry.commercial;
}

// ── Readiness: what an operator needs to know, per slot ──────────────────────

/**
 * E — the readiness of one registry slot.
 *
 * VOCABULARY. `ProviderAvailability` is the project's existing readiness union
 * (CPG-011 §3). `LIVE` and `INACCESSIBLE` are EXCLUDED here, and that exclusion
 * is the point: both are claims about reachability, and reachability can only be
 * established by actually calling the provider. This descriptor is read-only and
 * calls nothing, so the type itself makes it impossible for it to claim a
 * provider works. Two terms are added because the existing union has no word for
 * them:
 *
 *   CONFIGURED           the credential/flag is present and the adapter LOADED.
 *                        Not a promise that a call will succeed.
 *   ADAPTER_LOAD_FAILED  the credential IS present and the module failed to load.
 *                        The case D2 exists for: never report this as
 *                        CREDENTIAL_REQUIRED.
 *   DISABLED             a working provider was switched off by an operator.
 *                        A decision, not a missing credential.
 *
 * `NOT_IMPLEMENTED` is inherited from the existing union and is correct for a
 * declared capability with no adapter (Moz, Majestic). No slot currently
 * declared here is in that state, because a slot is only declared once an
 * adapter exists for it.
 */
export type ProviderSlotAvailability =
  | Exclude<ProviderAvailability, 'LIVE' | 'INACCESSIBLE'>
  | 'CONFIGURED'
  | 'ADAPTER_LOAD_FAILED'
  | 'DISABLED';

export type ProviderSlotReadiness = {
  readonly slot: ProviderSlotKey;
  readonly module: string;
  readonly capability: string;
  readonly availability: ProviderSlotAvailability;
  /**
   * What an operator must do, as environment-variable NAMES only. Never a value,
   * never a fragment of one.
   */
  readonly prerequisite: readonly string[];
  readonly detail: string;
  readonly loadFailure: AdapterLoadFailure | null;
};

const anyEnvSet = (names: readonly string[]): boolean =>
  names.some((name) => Boolean(process.env[name]?.trim()));

/**
 * E — classify every declared slot. Read-only: it triggers the bootstrap (so the
 * answer describes the registry as it actually is) and then inspects recorded
 * state only. It performs NO provider call and NO network access, reads no
 * credential value, and cannot change any score.
 *
 * This is the first production consumer of `getAdapterLoadFailures()`, which
 * until now was recorded and read by nothing.
 */
export function describeProviderReadiness(): readonly ProviderSlotReadiness[] {
  ensureBootstrapped();
  const failures = getAdapterLoadFailures();

  return (Object.keys(PROVIDER_SLOTS) as ProviderSlotKey[]).map((slot) => {
    const declaration: SlotDeclaration = PROVIDER_SLOTS[slot];
    const loadFailure = failures.find((f) => f.slot === slot) ?? null;
    const base = { slot, module: declaration.module, capability: declaration.capability, loadFailure };

    if (loadFailure) {
      return {
        ...base,
        availability: 'ADAPTER_LOAD_FAILED' as const,
        // The remedy is NOT a credential — saying so would send the operator
        // back to a key that is already set.
        prerequisite: [],
        detail: loadFailedReason(loadFailure),
      };
    }

    switch (declaration.gate.kind) {
      case 'env_value': {
        const envNames = declaration.gate.envNames;
        return anyEnvSet(envNames)
          ? { ...base, availability: 'CONFIGURED' as const, prerequisite: [], detail: `${declaration.capability} is configured and its adapter loaded. Reachability is not asserted here — only a call can establish it.` }
          : { ...base, availability: 'CREDENTIAL_REQUIRED' as const, prerequisite: envNames, detail: `${declaration.capability} is unavailable because no value is set for ${envNames.join(' / ')}. This is a missing prerequisite, not a finding about the company.` };
      }
      case 'enable_flag': {
        const flags = declaration.gate.flags;
        return anyEnvSet(flags)
          ? { ...base, availability: 'CONFIGURED' as const, prerequisite: [], detail: `${declaration.capability} is switched on and its adapter loaded.` }
          : { ...base, availability: 'DISABLED' as const, prerequisite: flags, detail: `${declaration.capability} is off because none of ${flags.join(' / ')} is set. Off by default — this is a deliberate state, not a failure.` };
      }
      case 'default_on': {
        const flag = declaration.gate.disableFlag;
        return process.env[flag] === 'false'
          ? { ...base, availability: 'DISABLED' as const, prerequisite: [], detail: `${declaration.capability} is switched OFF by ${flag}=false. No credential is required; remove that setting to re-enable.` }
          : { ...base, availability: 'CONFIGURED' as const, prerequisite: [], detail: `${declaration.capability} is keyless and active by default.` };
      }
    }
  });
}

// ── Test helper ───────────────────────────────────────────────────────────────

/** Reset the registry to all-unavailable. Test-only. */
export function _resetIntelligenceRegistry(): void {
  _registry = defaultRegistry();
  _bootstrapped = false;
  // D2 — recorded load failures belong to a bootstrap, so they reset with it.
  _adapterLoadFailures.length = 0;
}

// ── Bootstrap: register real adapters when their env flags are set ────────────

function ensureBootstrapped(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;

  // ── Knowledge graph ─────────────────────────────────────────────────────────
  // Phase 0A: Wikidata is free + keyless → activated by default (disable with
  // WIKIDATA_ENABLED=false). Google KG still requires GOOGLE_KG_API_KEY.
  if (process.env.WIKIDATA_ENABLED !== 'false') {
    // D2 / E — a load failure is recorded AND the slot now answers with the
    // failure instead of the unconfigured provider's text.
    registerAdapterOrRecordFailure('knowledge_graph', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/wikidataAdapter');
      registerKnowledgeGraphProvider(new mod.WikidataAdapter());
    });
  } else {
    // E — switched off on purpose. Say that, rather than "not configured".
    registerKnowledgeGraphProvider(new DisabledKnowledgeGraphProvider());
  }

  // ── Authority trajectory ────────────────────────────────────────────────────
  if (process.env.AUTHORITY_TRAJECTORY_ENABLED === 'true') {
    registerAdapterOrRecordFailure('trajectory', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/reportScoreHistoryAdapter');
      // BETA-PHASE2-EXEC-001: back the adapter with the canonical historical
      // store (`getHistoricalStore()`) instead of the default NoopHistoryStore,
      // so trajectory reads the SAME persisted snapshots as change-intelligence
      // and forecast. Honest-empty until real snapshots exist; no synthesis.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeMod = require('./adapters/trajectoryHistoryStore');
      registerTrajectoryProvider(
        new mod.ReportScoreHistoryAdapter(new storeMod.CanonicalTrajectoryHistoryStore()),
      );
    });
  }

  // ── LLM providers ───────────────────────────────────────────────────────────
  // Each adapter activates only when its env key is present. The adapters
  // themselves return `state: 'unavailable'` if they boot without credentials,
  // so the registry safely registers them even if the env var arrives later.
  // D2 — a load failure here no longer disappears. Each slot either gets its real
  // adapter or a provider that reports `provider_failed` with the module and the
  // error, so "configured but broken" can never masquerade as "not configured".
  if (process.env.OPENAI_API_KEY) {
    registerLLMAdapterOrRecordFailure('chatgpt', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/openaiAdapter');
      return new mod.OpenAIChatGPTAdapter();
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    registerLLMAdapterOrRecordFailure('claude', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/anthropicAdapter');
      return new mod.AnthropicClaudeAdapter();
    });
  }
  if (process.env.GEMINI_API_KEY) {
    registerLLMAdapterOrRecordFailure('gemini', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/geminiAdapter');
      return new mod.GeminiAdapter();
    });
  }
  if (process.env.PERPLEXITY_API_KEY) {
    registerLLMAdapterOrRecordFailure('perplexity', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/perplexityAdapter');
      return new mod.PerplexityAdapter();
    });
  }
  if (process.env.AZURE_COPILOT_API_KEY) {
    registerLLMAdapterOrRecordFailure('copilot', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/copilotAdapter');
      return new mod.CopilotAdapter();
    });
  }

  // ── Authority inflow (backlinks) ────────────────────────────────────────────
  if (process.env.AHREFS_API_KEY) {
    registerAdapterOrRecordFailure('authority_inflow', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/ahrefsAdapter');
      registerAuthorityInflowProvider(new mod.AhrefsAdapter());
    });
  }
  // NOTE: mozAdapter / majesticAdapter conditional registrations were
  // removed because the adapter files are not present in the repo and
  // their static require() paths fail the Next.js webpack build. Restore
  // when (a) the adapter implementations are added under
  // backend/services/intelligence/adapters/ and (b) the corresponding
  // MOZ_API_KEY / MAJESTIC_API_KEY are set in the runtime environment.

  // ── Trust coherence (review aggregator + extraction) ────────────────────────
  if (process.env.TRUST_COHERENCE_ENABLED === 'true') {
    registerAdapterOrRecordFailure('trust_coherence', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/trustCoherenceAdapter');
      registerTrustCoherenceProvider(new mod.TrustCoherenceAdapter());
      // BETA-REPORT-EXEC-002 (Wave 1, Phase 4): wire the canonical reviews provider into the empty
      // ReviewAggregator slot — the one clean Evidence-Platform integration per BETA-REPORT-AUDIT-002.
      // Inert until REVIEWS_API_KEY is set AND a review-source loader is registered by an ingestion layer;
      // otherwise it returns null and trust_coherence falls back to today's behavior (zero regression).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const agg = require('./adapters/reputationReviewAggregator');
      mod.registerReviewAggregator(agg.createReputationReviewAggregator());
      // BETA-REPORT-EXEC-003: supply the ReviewAggregator with the canonical review-ingestion loader.
      // Durable/guarded persistence; returns null (trust unchanged) until reviews are ingested + the
      // review_sources migration is applied — zero regression otherwise.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ing = require('../reviewIngestionService');
      agg.registerReviewSourceLoader(ing.createCanonicalReviewSourceLoader());
    });
  }

  // ── Benchmark dataset ───────────────────────────────────────────────────────
  if (process.env.BENCHMARK_DATASET_PATH) {
    registerAdapterOrRecordFailure('benchmark', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/benchmarkDatasetAdapter');
      registerBenchmarkProvider(new mod.BenchmarkDatasetAdapter(process.env.BENCHMARK_DATASET_PATH));
    });
  }

  // ── Commercial outcomes (revenue / conversions) ─────────────────────────────
  // BETA-REPORT-EXEC-006: wire the canonical Commercial Adapter into Pipeline A so measured commercial
  // evidence can drive ROI determinability. Reuses the BETA-PROVIDER-008 commercial bridge; the default
  // loader reads the EXISTING `canonical_revenue_events` table (no new ingestion). Inert until CRM_ENABLED /
  // COMMERCIAL_EVIDENCE_ENABLED is set AND real commercial rows exist — ROI stays Not Quantifiable otherwise.
  if (process.env.CRM_ENABLED || process.env.COMMERCIAL_EVIDENCE_ENABLED) {
    registerAdapterOrRecordFailure('commercial', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/commercialAdapter');
      registerCommercialProvider(new mod.CommercialAdapter());
      mod.registerCommercialSourceLoader(mod.createCanonicalRevenueLoader());
    });
  }

  // ── Durable historical store (Authority Trajectory + change-intelligence + forecast) ──
  // BETA-PHASE2-EXEC-002: register the canonical Supabase-backed HistoricalStore so
  // trajectory / change-intelligence / forecast read+write DURABLE rows in
  // `report_score_history` (schema: migration 20260601000000_canonical_intelligence_platform.sql)
  // instead of the in-process `InMemoryHistoryStore` (which resets on every cold start).
  // Inert by default — activates ONLY when `SUPABASE_HISTORY_ENABLED=true` AND the admin
  // client resolves. Reuses the existing `SupabaseHistoryStore` + `registerHistoricalStore`
  // (exactly one store, no duplicate, no alternate implementation, no interface change).
  // No fabrication: an empty/absent table degrades to `insufficient_history` via the
  // adapter's own try/catch; the report post-processing already guards store failures.
  if (process.env.SUPABASE_HISTORY_ENABLED === 'true') {
    // Retain the in-memory store on failure (a working, volatile implementation
    // — hence no substitute provider), but record WHY the durable one did not
    // load so `describeProviderReadiness()` can report it.
    registerAdapterOrRecordFailure('historical_store', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const clientMod = require('../../db/supabaseClient');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeMod = require('./supabaseHistoryStore');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const histMod = require('./historicalPersistence');
      histMod.registerHistoricalStore(new storeMod.SupabaseHistoryStore(clientMod.supabase));
    });
  }
}
