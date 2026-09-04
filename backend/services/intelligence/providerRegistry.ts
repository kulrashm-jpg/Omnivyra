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
import { AI_PROVIDERS, isWikidataEnabled, unavailableResult } from './providerInterfaces';

// ── Phase 1A: STATIC adapter imports ─────────────────────────────────────────
//
// These were previously loaded with dynamic `require()` inside swallowed
// `catch {}` blocks. That worked under plain Node but did NOT survive the
// Next.js/Vercel server bundle: the modules were not reliably traced into the
// lambda, every `require()` threw MODULE_NOT_FOUND, the empty catch hid it, and
// the registry silently fell back to its `Unavailable*` defaults. The symptom in
// production was a report whose citation cells all read "chatgpt adapter not
// configured" even though OPENAI_API_KEY was set, and a knowledge_graph reading
// "No knowledge-graph adapter is configured" even though Wikidata is keyless.
//
// Static top-level imports are always bundled and traced, so the adapters are
// present at runtime. The env gates below are UNCHANGED — an adapter is still
// registered only when its credential/flag is present. Only the *loading*
// mechanism moved; the activation policy did not.
import { WikidataAdapter } from './adapters/wikidataAdapter';
import { ReportScoreHistoryAdapter } from './adapters/reportScoreHistoryAdapter';
import { CanonicalTrajectoryHistoryStore } from './adapters/trajectoryHistoryStore';
import { OpenAIChatGPTAdapter } from './adapters/openaiAdapter';
import { AnthropicClaudeAdapter } from './adapters/anthropicAdapter';
import { GeminiAdapter } from './adapters/geminiAdapter';
import { PerplexityAdapter } from './adapters/perplexityAdapter';
import { CopilotAdapter } from './adapters/copilotAdapter';
import { AhrefsAdapter } from './adapters/ahrefsAdapter';
import { BenchmarkDatasetAdapter } from './adapters/benchmarkDatasetAdapter';

class UnavailableLLMProvider implements LLMVisibilityProvider {
  constructor(public readonly id: AIProviderId) {}
  async isAvailable(): Promise<boolean> { return false; }
  async probe(probe: AIVisibilityProbe): Promise<AIVisibilityProbeResult> {
    return unavailableResult<AIVisibilityProbeResult>({
      provider: this.id,
      query_class: probe.query_class,
      citation_rate: null,
      mean_prominence: null,
      mentions: [],
      reason: `${this.id} adapter not configured — set the corresponding API key in env to enable.`,
    });
  }
}

class UnavailableKnowledgeGraphProvider implements KnowledgeGraphProvider {
  public readonly id = 'unavailable';
  async isAvailable(): Promise<boolean> { return false; }
  async lookup(): Promise<EntityIntelligenceResult> {
    return unavailableResult<EntityIntelligenceResult>({
      entity: null,
      score: null,
      // Phase 1A: Wikidata is keyless and ON by default (`isWikidataEnabled()`), so
      // reaching this default means either it was explicitly disabled with
      // WIKIDATA_ENABLED=false or the adapter failed to register — in which case
      // `[providerRegistry] adapter_registration_failed` names the real cause.
      reason: 'No knowledge-graph adapter is configured. Wikidata is keyless and enabled by default — '
        + 'it is off only when WIKIDATA_ENABLED=false, or when adapter registration failed (check logs).',
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
}

// ── Bootstrap: register real adapters when their env flags are set ────────────
// ── Bootstrap: register real adapters when their env flags are set ────────────

/**
 * Phase 1A — adapter registration diagnostics.
 *
 * Every registration below was previously wrapped in an EMPTY `catch {}`. When the
 * dynamic `require()` failed inside the serverless bundle the failure was invisible:
 * the registry fell back to its `Unavailable*` defaults and the report rendered
 * "adapter not configured", which is indistinguishable from "no credential set".
 * That ambiguity is what hid the defect in production.
 *
 * `register()` keeps the same fail-soft behaviour (a broken adapter must never take
 * the report down) but now emits a structured, greppable diagnostic so the two cases
 * can never be confused again.
 */
function register(providerId: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.error('[providerRegistry] adapter_registration_failed', {
      providerId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
      hint: 'The credential/flag gate PASSED but the adapter failed to load. This is a build/bundle '
        + 'or module-init failure, NOT a missing credential.',
    });
  }
}

function ensureBootstrapped(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;

  // ── Knowledge graph ─────────────────────────────────────────────────────────
  // Phase 0A: Wikidata is free + keyless → activated by default (disable with
  // WIKIDATA_ENABLED=false). Google KG still requires GOOGLE_KG_API_KEY.
  // Phase 1A: the gate is now the CANONICAL `isWikidataEnabled()` helper, shared
  // with `entityGraphProviderBridge` so the registry and the activation matrix
  // can no longer disagree about whether the adapter is live.
  if (isWikidataEnabled()) {
    register('wikidata', () => registerKnowledgeGraphProvider(new WikidataAdapter()));
  }

  // ── Authority trajectory ────────────────────────────────────────────────────
  if (process.env.AUTHORITY_TRAJECTORY_ENABLED === 'true') {
    // BETA-PHASE2-EXEC-001: back the adapter with the canonical historical
    // store (`getHistoricalStore()`) instead of the default NoopHistoryStore,
    // so trajectory reads the SAME persisted snapshots as change-intelligence
    // and forecast. Honest-empty until real snapshots exist; no synthesis.
    register('authority_trajectory', () =>
      registerTrajectoryProvider(
        new ReportScoreHistoryAdapter(new CanonicalTrajectoryHistoryStore()),
      ),
    );
  }

  // ── LLM providers ───────────────────────────────────────────────────────────
  // Each adapter activates only when its env key is present. The adapters
  // themselves return `state: 'unavailable'` if they boot without credentials,
  // so the registry safely registers them even if the env var arrives later.
  if (process.env.OPENAI_API_KEY) {
    register('chatgpt', () => registerLLMProvider(new OpenAIChatGPTAdapter()));
  }
  if (process.env.ANTHROPIC_API_KEY) {
    register('claude', () => registerLLMProvider(new AnthropicClaudeAdapter()));
  }
  if (process.env.GEMINI_API_KEY) {
    register('gemini', () => registerLLMProvider(new GeminiAdapter()));
  }
  if (process.env.PERPLEXITY_API_KEY) {
    register('perplexity', () => registerLLMProvider(new PerplexityAdapter()));
  }
  if (process.env.AZURE_COPILOT_API_KEY) {
    register('copilot', () => registerLLMProvider(new CopilotAdapter()));
  }

  // ── Authority inflow (backlinks) ────────────────────────────────────────────
  if (process.env.AHREFS_API_KEY) {
    register('backlink.authority', () => registerAuthorityInflowProvider(new AhrefsAdapter()));
  }
  // NOTE: mozAdapter / majesticAdapter conditional registrations were
  // removed because the adapter files are not present in the repo and
  // their static require() paths fail the Next.js webpack build. Restore
  // when (a) the adapter implementations are added under
  // backend/services/intelligence/adapters/ and (b) the corresponding
  // MOZ_API_KEY / MAJESTIC_API_KEY are set in the runtime environment.

  // ── Benchmark dataset ───────────────────────────────────────────────────────
  if (process.env.BENCHMARK_DATASET_PATH) {
    register('benchmark', () =>
      registerBenchmarkProvider(
        new BenchmarkDatasetAdapter(process.env.BENCHMARK_DATASET_PATH as string),
      ),
    );
  }

  // ── DB-coupled optional providers ───────────────────────────────────────────
  //
  // Phase 1A scope note: the three registrations below stay lazily required on
  // purpose. Unlike the pure adapters above they reach the Supabase client and the
  // review/commercial ingestion services, so hoisting them to static imports would
  // pull the DB client into every consumer of this registry (including the
  // evidence-platform bridges) and widen the module graph well beyond Phase 1A.
  // All four flags are OFF in production today (no TRUST_COHERENCE_ENABLED /
  // CRM_ENABLED / COMMERCIAL_EVIDENCE_ENABLED / SUPABASE_HISTORY_ENABLED), so none
  // of them is on the Report 1 evidence path. What DOES change is that their
  // failures are no longer silent — `register()` now reports them explicitly.

  // ── Trust coherence (review aggregator + extraction) ────────────────────────
  if (process.env.TRUST_COHERENCE_ENABLED === 'true') {
    register('trust_coherence', () => {
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

  // ── Commercial outcomes (revenue / conversions) ─────────────────────────────
  // BETA-REPORT-EXEC-006: wire the canonical Commercial Adapter into Pipeline A so measured commercial
  // evidence can drive ROI determinability. Reuses the BETA-PROVIDER-008 commercial bridge; the default
  // loader reads the EXISTING `canonical_revenue_events` table (no new ingestion). Inert until CRM_ENABLED /
  // COMMERCIAL_EVIDENCE_ENABLED is set AND real commercial rows exist — ROI stays Not Quantifiable otherwise.
  if (process.env.CRM_ENABLED || process.env.COMMERCIAL_EVIDENCE_ENABLED) {
    register('commercial', () => {
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
    register('historical_store', () => {
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
