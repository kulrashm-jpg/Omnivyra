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
      reason: `${this.id} adapter not configured — set the corresponding API key in env to enable.`,
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
export type AdapterLoadFailure = {
  readonly slot: string;
  readonly module: string;
  readonly message: string;
  readonly at: string;
};

const _adapterLoadFailures: AdapterLoadFailure[] = [];

function recordAdapterLoadFailure(
  slot: string,
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
  moduleName: string,
  load: () => LLMVisibilityProvider,
): void {
  try {
    registerLLMProvider(load());
  } catch (error) {
    const failure = recordAdapterLoadFailure(`llm:${id}`, moduleName, error);
    registerLLMProvider(new AdapterLoadFailedLLMProvider(id, failure));
  }
}

class UnavailableKnowledgeGraphProvider implements KnowledgeGraphProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<EntityIntelligenceResult> {
    return unavailableResult<EntityIntelligenceResult>({
      entity: null,
      score: null,
      reason: 'No knowledge-graph adapter is configured. Wikidata adapter activates when WIKIDATA_ENABLED=true.',
    });
  }
}

class UnavailableAuthorityInflowProvider implements AuthorityInflowProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<AuthorityInflowResult> {
    return unavailableResult<AuthorityInflowResult>({
      profile: null,
      score: null,
      reason: 'No backlink/authority API is configured. Wire AHREFS_API_KEY / MOZ_API_KEY / MAJESTIC_API_KEY to enable.',
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
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/wikidataAdapter');
      registerKnowledgeGraphProvider(new mod.WikidataAdapter());
    } catch (error) {
      // D2 — still unavailable, but no longer silent: a load failure is recorded so it
      // cannot be mistaken for an adapter that was never configured.
      recordAdapterLoadFailure('knowledge_graph', './adapters/wikidataAdapter', error);
    }
  }

  // ── Authority trajectory ────────────────────────────────────────────────────
  if (process.env.AUTHORITY_TRAJECTORY_ENABLED === 'true') {
    try {
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
    } catch (error) {
      recordAdapterLoadFailure('trajectory', './adapters/reportScoreHistoryAdapter', error);
    }
  }

  // ── LLM providers ───────────────────────────────────────────────────────────
  // Each adapter activates only when its env key is present. The adapters
  // themselves return `state: 'unavailable'` if they boot without credentials,
  // so the registry safely registers them even if the env var arrives later.
  // D2 — a load failure here no longer disappears. Each slot either gets its real
  // adapter or a provider that reports `provider_failed` with the module and the
  // error, so "configured but broken" can never masquerade as "not configured".
  if (process.env.OPENAI_API_KEY) {
    registerLLMAdapterOrRecordFailure('chatgpt', './adapters/openaiAdapter', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/openaiAdapter');
      return new mod.OpenAIChatGPTAdapter();
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    registerLLMAdapterOrRecordFailure('claude', './adapters/anthropicAdapter', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/anthropicAdapter');
      return new mod.AnthropicClaudeAdapter();
    });
  }
  if (process.env.GEMINI_API_KEY) {
    registerLLMAdapterOrRecordFailure('gemini', './adapters/geminiAdapter', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/geminiAdapter');
      return new mod.GeminiAdapter();
    });
  }
  if (process.env.PERPLEXITY_API_KEY) {
    registerLLMAdapterOrRecordFailure('perplexity', './adapters/perplexityAdapter', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/perplexityAdapter');
      return new mod.PerplexityAdapter();
    });
  }
  if (process.env.AZURE_COPILOT_API_KEY) {
    registerLLMAdapterOrRecordFailure('copilot', './adapters/copilotAdapter', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/copilotAdapter');
      return new mod.CopilotAdapter();
    });
  }

  // ── Authority inflow (backlinks) ────────────────────────────────────────────
  if (process.env.AHREFS_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/ahrefsAdapter');
      registerAuthorityInflowProvider(new mod.AhrefsAdapter());
    } catch (error) {
      recordAdapterLoadFailure('authority_inflow', './adapters/ahrefsAdapter', error);
    }
  }
  // NOTE: mozAdapter / majesticAdapter conditional registrations were
  // removed because the adapter files are not present in the repo and
  // their static require() paths fail the Next.js webpack build. Restore
  // when (a) the adapter implementations are added under
  // backend/services/intelligence/adapters/ and (b) the corresponding
  // MOZ_API_KEY / MAJESTIC_API_KEY are set in the runtime environment.

  // ── Trust coherence (review aggregator + extraction) ────────────────────────
  if (process.env.TRUST_COHERENCE_ENABLED === 'true') {
    try {
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
    } catch (error) {
      recordAdapterLoadFailure('trust_coherence', './adapters/trustCoherenceAdapter', error);
    }
  }

  // ── Benchmark dataset ───────────────────────────────────────────────────────
  if (process.env.BENCHMARK_DATASET_PATH) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/benchmarkDatasetAdapter');
      registerBenchmarkProvider(new mod.BenchmarkDatasetAdapter(process.env.BENCHMARK_DATASET_PATH));
    } catch (error) {
      recordAdapterLoadFailure('benchmark', './adapters/benchmarkDatasetAdapter', error);
    }
  }

  // ── Commercial outcomes (revenue / conversions) ─────────────────────────────
  // BETA-REPORT-EXEC-006: wire the canonical Commercial Adapter into Pipeline A so measured commercial
  // evidence can drive ROI determinability. Reuses the BETA-PROVIDER-008 commercial bridge; the default
  // loader reads the EXISTING `canonical_revenue_events` table (no new ingestion). Inert until CRM_ENABLED /
  // COMMERCIAL_EVIDENCE_ENABLED is set AND real commercial rows exist — ROI stays Not Quantifiable otherwise.
  if (process.env.CRM_ENABLED || process.env.COMMERCIAL_EVIDENCE_ENABLED) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/commercialAdapter');
      registerCommercialProvider(new mod.CommercialAdapter());
      mod.registerCommercialSourceLoader(mod.createCanonicalRevenueLoader());
    } catch (error) {
      recordAdapterLoadFailure('commercial', './adapters/commercialAdapter', error);
    }
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
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const clientMod = require('../../db/supabaseClient');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const storeMod = require('./supabaseHistoryStore');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const histMod = require('./historicalPersistence');
      histMod.registerHistoricalStore(new storeMod.SupabaseHistoryStore(clientMod.supabase));
    } catch (error) {
      // Retain the in-memory store, but record WHY the durable one did not load.
      recordAdapterLoadFailure('historical_store', './supabaseHistoryStore', error);
    }
  }
}
