/**
 * Canonical AI Visibility Provider Bridge  (BETA-PROVIDER-007) — REFERENCE IMPLEMENTATION #7
 *
 * Wires the SEVENTH real external evidence provider — AI Visibility / LLM Retrieval — into the canonical
 * BETA-ENGINE-004 framework by REUSING the existing production LLM adapters
 * (`intelligence/adapters/{openai,anthropic,gemini,perplexity,copilot}Adapter.ts` via `getAllLLMProviders()`)
 * and the existing probe contract (`AIVisibilityProbe` / `AIVisibilityProbeResult` / `CitationMention`) —
 * no provider code is duplicated. It answers "can AI systems discover, understand, trust, retrieve, and
 * recommend this company?" by MEASURING (not estimating) answer-engine retrieval.
 *
 * It provides:
 *   • a DETERMINISTIC, versioned probe framework (query registry → probes) — Phase 5,
 *   • DETERMINISTIC multi-ecosystem consolidation of probe results — Phase 7,
 *   • registration of the canonical `llm_visibility` provider,
 *   • canonical-Evidence conversion via `aiVisibilityEvidenceAdapter`,
 *   • honest failure governance (every failure → canonical Evidence).
 *
 * AUDIT NOTE (honest): the LLM adapters + probe/citation infra already exist and are REUSED. Their genuine
 * consumer today is the REPORT's AI-visibility dimension (`canonicalReportBuilder` / `aiCitationMatrix
 * Service`), NOT a decision engine's confidence — the descriptor records "GEO/AEO scores are structural
 * proxies — no live answer-engine querying" (BETA-AUDIT-004). This bridge canonicalises the reused providers
 * + produces canonical Evidence; it does NOT fabricate a confidence flip in an engine that does not read AI
 * -visibility data. Decision-engine adoption is the honest remaining gap.
 *
 * NON-NEGOTIABLE: no fabricated answers, no synthetic citations, no inferred retrieval, no LLM-generated
 * scoring. The upstream contract forbids `inferred`; with no LLM credential the provider is UNAVAILABLE and
 * nothing changes.
 */
import {
  registerProvider, getProvider, isProviderAvailable, ANTICIPATED_PROVIDERS,
  PROVIDER_FAILURE, unavailableFailure, type EvidenceProviderDescriptor, type Evidence,
} from './evidencePlatform';
import {
  aiVisibilityEvidenceAdapter, type AIVisibilityEvidenceInput,
} from './evidencePlatform/providers/aiVisibility/aiVisibilityEvidenceAdapter';
import { getAllLLMProviders } from './intelligence/providerRegistry';
import {
  AI_QUERY_CLASSES, type AIVisibilityProbe, type AIVisibilityProbeResult, type AIProviderId, type AIQueryClass,
} from './intelligence/providerInterfaces';

const PROVIDER_ID = 'llm_visibility';
const ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'AZURE_COPILOT_API_KEY'];

/** Versioned prompt-set identifier — bump when the query registry changes (deterministic reproducibility). */
export const AI_VISIBILITY_PROMPT_SET_VERSION = '1.0.0';

/** True when at least one AI-ecosystem credential is present. */
export function isAIVisibilityProviderConfigured(): boolean {
  return ENV_KEYS.some((k) => Boolean(process.env[k]));
}

/** Register the canonical llm_visibility provider with auth/connection derived from env (idempotent). */
export function registerAIVisibilityProvider(): EvidenceProviderDescriptor {
  const base = ANTICIPATED_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
  if (!base) throw new Error('llm_visibility descriptor missing from anticipated providers');
  const configured = isAIVisibilityProviderConfigured();
  return registerProvider({
    ...base,
    authStatus: configured ? 'authenticated' : 'unauthenticated',
    connectionStatus: configured ? 'connected' : 'disconnected',
    health: configured ? 'healthy' : 'unknown',
    failureState: configured ? null : PROVIDER_FAILURE.UNAVAILABLE,
  });
}

/** Deterministic availability signal. */
export function isAIVisibilityProviderAvailable(): boolean {
  registerAIVisibilityProvider();
  return isProviderAvailable(PROVIDER_ID);
}

export function aiVisibilityProviderReliability(): number | null {
  return getProvider(PROVIDER_ID)?.providerReliability ?? null;
}

// ── Phase 5: Deterministic, versioned probe framework ─────────────────────────────────────────────────

const norm = (s: string): string => (s ?? '').trim();

/**
 * DETERMINISTIC query registry. Given brand + category, returns a fixed, versioned prompt set per query
 * class. Pure — no randomness, no LLM generation of queries; the same inputs always yield the same probes.
 */
export function buildAIVisibilityQueryRegistry(brandName: string, category: string | null): Record<AIQueryClass, string[]> {
  const b = norm(brandName);
  const c = norm(category ?? '') || 'its industry';
  return {
    branded: [`What is ${b}?`, `Is ${b} a reputable company and what do they offer?`],
    category: [`What are the best companies for ${c}?`, `Recommend top providers for ${c}.`],
    competitive: [`Who are the main competitors and alternatives to ${b}?`, `How does ${b} compare to others in ${c}?`],
    expertise: [`Is ${b} considered an authority or expert in ${c}?`],
  };
}

/**
 * Build the deterministic probe set: one probe per (ecosystem × query class), carrying the versioned
 * queries. The provider decides nothing about query content (contract). Deterministic + ordered.
 */
export function buildAIVisibilityProbes(
  providerIds: AIProviderId[],
  brandName: string,
  category: string | null,
): AIVisibilityProbe[] {
  const registry = buildAIVisibilityQueryRegistry(brandName, category);
  const probes: AIVisibilityProbe[] = [];
  for (const provider of providerIds) {
    for (const query_class of AI_QUERY_CLASSES) {
      probes.push({ provider, query_class, queries: registry[query_class] });
    }
  }
  return probes;
}

// ── Phase 7: Deterministic multi-ecosystem consolidation ──────────────────────────────────────────────

/**
 * DETERMINISTIC multi-ecosystem consolidation. Consolidates AIVisibilityProbeResult[] (across ecosystems ×
 * query classes) into a single normalised input. Rules — all deterministic + explainable:
 *   • Only MEASURED results contribute; `unavailable` results are excluded from the observed aggregates but
 *     counted toward `ecosystemsProbed` (coverage) so missing retrieval is visible, not hidden.
 *   • An ecosystem "appeared" if ANY of its mentions has `appeared === true`.
 *   • answer_presence_rate = appeared ecosystems ÷ responding ecosystems (0 is a genuine observed absence).
 *   • citation_rate / mean_prominence = mean of the per-result observed values (measured, non-null).
 *   • citation_count = total mentions observed to have appeared; distinct_citations = de-duplicated excerpts.
 *   • query_coverage = distinct query classes probed; topic_coverage = distinct classes where brand appeared.
 *   • provider_agreement = majority-appearance ÷ responding ecosystems (cross-ecosystem agreement; disagreement
 *     surfaced, not hidden).
 *   • freshness = hours between the most recent observation and observedAt.
 * Pure; no clock/random (timestamps compared are passed in).
 */
export function consolidateProbeResults(
  results: AIVisibilityProbeResult[],
  observedAt: string | null,
): AIVisibilityEvidenceInput {
  const probedProviders = new Set<string>();
  const measured = results.filter((r) => {
    probedProviders.add(r.provider);
    return r.state === 'measured';
  });

  if (measured.length === 0) {
    return {
      subjectId: '', ecosystemsProbed: probedProviders.size > 0 ? probedProviders.size : null,
      ecosystemsResponding: 0, answerPresenceRate: null, citationRate: null, meanProminence: null,
      citationCount: null, distinctCitations: null, queryCoverage: null, topicCoverage: null,
      providerAgreement: null, freshnessHours: null, observedAt,
      providerReliability: aiVisibilityProviderReliability(), contributingProviders: [],
    };
  }

  const respondingProviders = new Set<string>();
  const appearedProviders = new Set<string>();
  const queryClasses = new Set<string>();
  const topicClasses = new Set<string>();
  const citationExcerpts = new Set<string>();
  const citationRates: number[] = [];
  const prominences: number[] = [];
  let citationCount = 0;
  let mostRecentMs: number | null = null;

  for (const r of measured) {
    respondingProviders.add(r.provider);
    queryClasses.add(r.query_class);
    if (r.citation_rate != null) citationRates.push(r.citation_rate);
    if (r.mean_prominence != null) prominences.push(r.mean_prominence);
    for (const m of r.mentions ?? []) {
      if (m.appeared) {
        appearedProviders.add(r.provider);
        topicClasses.add(r.query_class);
        citationCount += 1;
        const ex = norm(m.evidence_excerpt ?? '').toLowerCase();
        if (ex) citationExcerpts.add(ex);
      }
      if (m.observed_at) { const ms = Date.parse(m.observed_at); if (Number.isFinite(ms)) mostRecentMs = mostRecentMs == null ? ms : Math.max(mostRecentMs, ms); }
    }
  }

  const responding = respondingProviders.size;
  const appeared = appearedProviders.size;
  const notAppeared = responding - appeared;
  const observedMs = observedAt ? Date.parse(observedAt) : NaN;
  const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    subjectId: '',
    ecosystemsProbed: probedProviders.size,
    ecosystemsResponding: responding,
    answerPresenceRate: responding > 0 ? appeared / responding : null,
    citationRate: mean(citationRates),
    meanProminence: mean(prominences),
    citationCount,
    distinctCitations: citationExcerpts.size,
    queryCoverage: queryClasses.size,
    topicCoverage: topicClasses.size,
    providerAgreement: responding > 0 ? Math.max(appeared, notAppeared) / responding : null,
    freshnessHours: mostRecentMs != null && Number.isFinite(observedMs) ? Math.max(0, (observedMs - mostRecentMs) / 3_600_000) : null,
    observedAt,
    providerReliability: aiVisibilityProviderReliability(),
    contributingProviders: [...respondingProviders],
  };
}

/**
 * Reference fetch → canonical Evidence. REUSES the existing LLM adapters via `getAllLLMProviders()`, issues
 * the deterministic probe set, consolidates the observed results, and converts through the canonical
 * adapter. Every failure (no credential, provider unavailable, timeout, quota, prompt rejected, no answer,
 * rate limit, invalid response) becomes canonical Evidence — never throws, never fabricates. `nowIso` is
 * passed in (deterministic; no clock access).
 *
 * With no LLM credential every adapter is UNAVAILABLE and this returns a single UNAVAILABLE Evidence without
 * performing a live probe (backward-compatible, test-verified).
 */
export async function fetchAIVisibilityEvidence(
  brandName: string,
  category: string | null,
  nowIso: string,
): Promise<Evidence[]> {
  registerAIVisibilityProvider();
  if (!isAIVisibilityProviderConfigured()) {
    return aiVisibilityEvidenceAdapter.onFailure(unavailableFailure(
      PROVIDER_ID, 'ai_answer_presence',
      'AI visibility provider not connected. Set an LLM credential (OPENAI/ANTHROPIC/GEMINI/PERPLEXITY/AZURE_COPILOT).',
    ));
  }
  const providers = getAllLLMProviders(); // reuse existing real LLM adapters
  const providerIds = providers.map((p) => p.id);
  const probes = buildAIVisibilityProbes(providerIds, brandName, category);
  const results: AIVisibilityProbeResult[] = [];
  for (const probe of probes) {
    const provider = providers.find((p) => p.id === probe.provider);
    if (!provider) continue;
    // Each provider returns `unavailable` when not configured — never synthesizes numbers (contract).
    results.push(await provider.probe(probe));
  }
  const consolidated = consolidateProbeResults(results, nowIso);
  if (!consolidated.ecosystemsResponding || consolidated.ecosystemsResponding === 0) {
    return aiVisibilityEvidenceAdapter.onFailure({
      providerId: PROVIDER_ID,
      state: PROVIDER_FAILURE.UNAVAILABLE,
      reason: 'AI visibility providers are configured but none returned a measured probe (no answer / all unavailable).',
      evidenceKey: 'ai_answer_presence',
      observedAt: nowIso,
    });
  }
  return aiVisibilityEvidenceAdapter.toEvidence({ ...consolidated, subjectId: brandName }, { observedAt: nowIso, subjectId: brandName });
}
