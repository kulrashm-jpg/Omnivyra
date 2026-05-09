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
  EntityIntelligenceResult,
  KnowledgeGraphProvider,
  LLMVisibilityProvider,
  TrustCoherenceProvider,
  TrustCoherenceResult,
} from './providerInterfaces';
import { AI_PROVIDERS, unavailableResult } from './providerInterfaces';

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
      reason: 'No trust-coherence adapter is configured. Review aggregator + expertise extractor activate when their env flags are set.',
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

// ── Test helper ───────────────────────────────────────────────────────────────

/** Reset the registry to all-unavailable. Test-only. */
export function _resetIntelligenceRegistry(): void {
  _registry = defaultRegistry();
  _bootstrapped = false;
}

// ── Bootstrap: register real adapters when their env flags are set ────────────

function ensureBootstrapped(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;

  // ── Knowledge graph ─────────────────────────────────────────────────────────
  if (process.env.WIKIDATA_ENABLED === 'true') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/wikidataAdapter');
      registerKnowledgeGraphProvider(new mod.WikidataAdapter());
    } catch (error) {
      // Adapter not present yet; remain unavailable.
    }
  }

  // ── Authority trajectory ────────────────────────────────────────────────────
  if (process.env.AUTHORITY_TRAJECTORY_ENABLED === 'true') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/reportScoreHistoryAdapter');
      registerTrajectoryProvider(new mod.ReportScoreHistoryAdapter());
    } catch (error) {
      // Adapter not present yet; remain unavailable.
    }
  }

  // ── LLM providers ───────────────────────────────────────────────────────────
  // Each adapter activates only when its env key is present. The adapters
  // themselves return `state: 'unavailable'` if they boot without credentials,
  // so the registry safely registers them even if the env var arrives later.
  if (process.env.OPENAI_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/openaiAdapter');
      registerLLMProvider(new mod.OpenAIChatGPTAdapter());
    } catch (error) {
      /* unavailable */
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/anthropicAdapter');
      registerLLMProvider(new mod.AnthropicClaudeAdapter());
    } catch (error) {
      /* unavailable */
    }
  }
  if (process.env.GEMINI_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/geminiAdapter');
      registerLLMProvider(new mod.GeminiAdapter());
    } catch (error) {
      /* unavailable */
    }
  }
  if (process.env.PERPLEXITY_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/perplexityAdapter');
      registerLLMProvider(new mod.PerplexityAdapter());
    } catch (error) {
      /* unavailable */
    }
  }
  if (process.env.AZURE_COPILOT_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/copilotAdapter');
      registerLLMProvider(new mod.CopilotAdapter());
    } catch (error) {
      /* unavailable */
    }
  }

  // ── Authority inflow (backlinks) ────────────────────────────────────────────
  if (process.env.AHREFS_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/ahrefsAdapter');
      registerAuthorityInflowProvider(new mod.AhrefsAdapter());
    } catch (error) {
      /* unavailable */
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
    } catch (error) {
      /* unavailable */
    }
  }

  // ── Benchmark dataset ───────────────────────────────────────────────────────
  if (process.env.BENCHMARK_DATASET_PATH) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./adapters/benchmarkDatasetAdapter');
      registerBenchmarkProvider(new mod.BenchmarkDatasetAdapter(process.env.BENCHMARK_DATASET_PATH));
    } catch (error) {
      /* unavailable */
    }
  }
}
