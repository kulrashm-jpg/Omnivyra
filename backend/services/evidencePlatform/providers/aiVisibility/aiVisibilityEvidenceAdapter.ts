/**
 * AI Visibility Evidence Adapter  (BETA-PROVIDER-007, Phase 4/6) — REFERENCE IMPLEMENTATION #7
 *
 * Converts OBSERVED answer-engine retrieval behaviour (ChatGPT · Gemini · Claude · Perplexity · Copilot)
 * into canonical Evidence via the BETA-ENGINE-004 `ProviderEvidenceAdapter` contract. It is the ONLY bridge
 * from an AI-visibility probe result to the canonical Evidence model — no engine consumes probe results
 * directly. Deterministic; emits ONLY behaviour that was genuinely observed (missing → omitted, failures →
 * UNAVAILABLE) — never fabricated.
 *
 * NON-NEGOTIABLE: no fabricated AI answers, no synthetic citations, no inferred retrieval, no LLM-generated
 * scoring. Every value traces to an actual probe observation. The upstream contract already forbids
 * `inferred` for AI visibility; this adapter only ever records `MEASURED` (observed) or `CALCULATED`
 * (deterministic aggregate of observations).
 *
 * Provider-agnostic + multi-ecosystem: consumes a normalised `AIVisibilityEvidenceInput` that the bridge
 * builds by DETERMINISTICALLY CONSOLIDATING probe results across ecosystems. The bridge owns probing +
 * consolidation; this adapter owns the canonical Evidence conversion.
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:llm_visibility';

/**
 * Normalised, provider-agnostic CONSOLIDATED AI-visibility observations (output of multi-ecosystem
 * consolidation). Every field nullable — only genuinely-observed behaviour passes through; nulls are
 * omitted by the adapter (never fabricated). `contributingProviders` lists the ecosystems that returned a
 * measured probe.
 */
export interface AIVisibilityEvidenceInput {
  subjectId: string;
  ecosystemsProbed: number | null; // AI ecosystems a probe was issued to
  ecosystemsResponding: number | null; // ecosystems that returned a MEASURED probe result (coverage)
  answerPresenceRate: number | null; // 0..1 fraction of responding ecosystems where the brand appeared
  citationRate: number | null; // 0..1 mean observed citation rate across responding ecosystems
  meanProminence: number | null; // 0..1 mean observed mention prominence
  citationCount: number | null; // total observed mentions where the brand appeared
  distinctCitations: number | null; // distinct citation excerpts (de-duplicated)
  queryCoverage: number | null; // distinct query classes probed
  topicCoverage: number | null; // distinct query classes where the brand appeared
  providerAgreement: number | null; // 0..1 cross-ecosystem agreement on brand appearance (CALCULATED)
  freshnessHours: number | null; // hours since the most recent observation (CALCULATED)
  observedAt: string | null;
  providerReliability: number | null;
  contributingProviders: string[];
}

/** The canonical evidence keys this adapter can emit (align with the Evidence Registry + descriptor). */
export const AI_VISIBILITY_EVIDENCE_KEYS = [
  'ai_answer_presence',
  'ai_citation_rate',
  'ai_mean_prominence',
  'ai_citation_count',
  'ai_distinct_citations',
  'ai_ecosystem_coverage',
  'ai_responding_ecosystems',
  'ai_query_coverage',
  'ai_topic_coverage',
  'ai_provider_agreement',
  'ai_freshness_hours',
] as const;

const round = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class AIVisibilityEvidenceAdapter implements ProviderEvidenceAdapter<AIVisibilityEvidenceInput> {
  readonly providerId = 'llm_visibility';
  readonly supportedEvidence = [...AI_VISIBILITY_EVIDENCE_KEYS];

  toEvidence(raw: AIVisibilityEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const providers = raw.contributingProviders ?? [];
    const prov = (extraOp: string | null = null) =>
      buildProvenance({
        origin: 'provider:llm_visibility',
        collector: 'ai_visibility_probe',
        engine: PROVIDER_ENGINE_ID,
        version: '1.0.0',
        timestamp: ts,
        calculationSteps: [
          { op: 'consolidate', detail: `ecosystems=${providers.join('+') || 'none'}` },
          ...(extraOp ? [{ op: extraOp }] : []),
        ],
      });

    // MEASURED — observed behaviour. Missing → skipped (no fabrication).
    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED',
        sourceSystem: 'ai_visibility_probe', sourceType: 'external_api', measurementType, observationType: 'aggregate',
        unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated',
      }));
    const calculated = (key: string, value: number, unit: string, measurementType: string, detail: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'CALCULATED',
        sourceSystem: 'ai_visibility_probe', sourceType: 'external_api', measurementType, observationType: 'aggregate',
        unit, observedAt: ts, collectedAt: ts, confidence: conf,
        provenance: prov(detail), validationStatus: 'validated',
      }));

    // answer_presence_rate is 0..1 — 0 (brand never appeared) is a genuine observed measurement, not a gap.
    if (raw.answerPresenceRate != null) measured('ai_answer_presence', round4(raw.answerPresenceRate), 'ratio', 'ratio');
    if (raw.citationRate != null) measured('ai_citation_rate', round4(raw.citationRate), 'ratio', 'ratio');
    if (raw.meanProminence != null) measured('ai_mean_prominence', round4(raw.meanProminence), 'ratio', 'ratio');
    if (raw.citationCount != null) measured('ai_citation_count', raw.citationCount, 'count', 'count');
    if (raw.distinctCitations != null) measured('ai_distinct_citations', raw.distinctCitations, 'count', 'count');
    if (raw.ecosystemsProbed != null) measured('ai_ecosystem_coverage', raw.ecosystemsProbed, 'count', 'count');
    if (raw.ecosystemsResponding != null) measured('ai_responding_ecosystems', raw.ecosystemsResponding, 'count', 'count');
    if (raw.queryCoverage != null) measured('ai_query_coverage', raw.queryCoverage, 'count', 'count');
    if (raw.topicCoverage != null) measured('ai_topic_coverage', raw.topicCoverage, 'count', 'count');

    if (raw.providerAgreement != null) calculated('ai_provider_agreement', round4(raw.providerAgreement), 'ratio', 'agreement', 'majority_appearance/responding_ecosystems');
    if (raw.freshnessHours != null) calculated('ai_freshness_hours', round(raw.freshnessHours), 'hours', 'age', 'now - most_recent_probe');
    return out;
  }

  onFailure(failure: ProviderFailure): Evidence[] {
    return baseAdapterFailure(failure);
  }
}

export const aiVisibilityEvidenceAdapter = new AIVisibilityEvidenceAdapter();
