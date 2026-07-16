/**
 * Phase 3 — Recommendation engine refactor.
 *
 * Replaces the old "SEO Topic → Generic Framing → Brand Injection" pattern with:
 *   Company Context → Market Narrative → ICP Problems → Capability Mapping
 *   → Editorial Angle → Topic Framing → Recommendation
 *
 * Hybrid generator: deterministic heuristic seeds (Cartesian ICP × capability)
 * are produced first, then refined in a single batched LLM call to write
 * editorialAngle / whyThisFitsCompany / strategicNarrative. Output is scored,
 * drift-detected, and validated. Validation failures hard-reject and trigger
 * a bounded retry round (max MAX_RETRY_ROUNDS).
 *
 * Phases 4, 6, 7 are orchestrated here: scoring, drift detection, observability
 * traces, retry policy.
 */

import { runCompletionWithOperation } from '../aiGateway';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import {
  type CompanyContextFoundation,
  buildCompanyContextFoundation,
  foundationIsSufficient,
} from './companyContextFoundation';
import { contentTypeConfig, type LongFormContentType } from '../../../lib/content/longFormContentTypeConfig';
import {
  type AlignmentDecisionTrace,
  type ContentAlignmentMode,
  type GenerateLongFormRecommendationsRequest,
  type GenerateLongFormRecommendationsResponse,
  type LongFormRecommendation,
  type RecommendationOriginTrace,
  type TargetBuyerStage,
  ALIGNMENT_MODE_RULES,
  CASE_STUDY_FORCED_MODE,
  DEFAULT_RECOMMENDATION_LIMIT,
  MAX_RECOMMENDATION_LIMIT,
  MAX_RETRY_ROUNDS,
} from './longFormRecommendationTypes';
import {
  type RecommendationCandidate,
  finalizeCandidate,
} from './longFormRecommendationScoring';
import {
  validateRecommendationCandidate,
  type ValidationResult,
} from './longFormRecommendationValidator';
import { groupRecommendationsByFamily } from './recommendationFamilyClustering';
import { applyNarrativeShapeGuard } from './narrativeShapeGuard';
import { balanceRecommendationSet, reportRecommendationSetCoverage } from './recommendationSetBalancer';
import {
  buildFingerprintFromRecommendation,
  getDefaultRecommendationMemory,
  scoreRecommendationNovelty,
} from './recommendationMemory';
import { buildBatchDiagnostics } from './recommendationBatchDiagnostics';
import type { RecommendationMemoryProvider } from './longFormRecommendationTypes';
import { computeRecommendationConfidence } from './recommendationConfidenceModel';
import { analyzeRecommendationSuitability } from './recommendationSuitabilityAnalyzer';
import { composeRecommendationExplanation } from './recommendationExplanationComposer';
import { stabilizeBatchEntropy } from './recommendationEntropyStabilization';
import {
  getDefaultRecommendationLifecycleRegistry,
  type RecommendationLifecycleRegistry,
} from './recommendationLifecycle';
import { buildLifecycleDiagnostics } from './recommendationLifecycleDiagnostics';

// ────────────────────────────────────────────────────────────────────────────
// Heuristic seed generation
// ────────────────────────────────────────────────────────────────────────────

interface HeuristicSeed {
  seedId: string;
  contentType: LongFormContentType;
  alignmentMode: ContentAlignmentMode;
  targetBuyerStage: TargetBuyerStage;
  icpProblem: string;
  capabilityFocus: string;
  workflowCategory: string | null;
  /** Optional user-supplied seed topic to reframe; not the title. */
  seedTopic?: string;
  /** Heuristic-built skeleton title — LLM may rewrite. */
  draftTitle: string;
}

function stageFromMaturity(maturity: CompanyContextFoundation['marketUnderstanding']['buyerMaturity']): TargetBuyerStage {
  switch (maturity) {
    case 'early': return 'awareness';
    case 'evaluation': return 'evaluation';
    case 'committed': return 'expansion';
    case 'mixed': return 'consideration';
    default: return 'consideration';
  }
}

function pickContentTypeForSeed(
  index: number,
  allowed: LongFormContentType[],
  capability: string | undefined,
): LongFormContentType {
  // Rotate through allowed types but bias case-study toward capability-anchored seeds.
  if (capability && allowed.includes('case-study') && index % 3 === 2) return 'case-study';
  return allowed[index % allowed.length];
}

function buildHeuristicSeeds(
  foundation: CompanyContextFoundation,
  request: GenerateLongFormRecommendationsRequest,
): HeuristicSeed[] {
  const limit = Math.min(request.limit ?? DEFAULT_RECOMMENDATION_LIMIT, MAX_RECOMMENDATION_LIMIT);
  // Over-generate so validation pruning leaves enough candidates.
  const targetSeedCount = Math.max(limit * 2, limit + 4);

  const allowedTypes: LongFormContentType[] =
    request.contentTypes && request.contentTypes.length > 0
      ? request.contentTypes
      : (Object.keys(contentTypeConfig) as LongFormContentType[]);

  const icpProblems = foundation.marketUnderstanding.marketPainPoints.length > 0
    ? foundation.marketUnderstanding.marketPainPoints
    : foundation.marketUnderstanding.operationalFrictionAreas;
  const fallbackProblem = foundation.businessIdentity.positioning
    ?? foundation.businessIdentity.companyCategory
    ?? 'core operational friction';

  const capabilities = [
    ...foundation.capabilityMapping.workflowCategories,
    ...foundation.capabilityMapping.enables,
  ];
  const fallbackCapability = foundation.businessIdentity.productServiceCategories[0]
    ?? foundation.businessIdentity.positioning
    ?? 'operational capability';

  const baseStage = stageFromMaturity(foundation.marketUnderstanding.buyerMaturity);
  const stageRotation: TargetBuyerStage[] = ['awareness', 'consideration', 'evaluation', 'decision', 'expansion'];
  // Bias rotation toward the inferred stage but vary across cards.
  const stageOrder = [baseStage, ...stageRotation.filter((s) => s !== baseStage)];

  const seedTopics = request.seedTopics && request.seedTopics.length > 0 ? request.seedTopics : [undefined];

  const seeds: HeuristicSeed[] = [];
  let counter = 0;
  while (seeds.length < targetSeedCount && counter < targetSeedCount * 4) {
    const icp = icpProblems[counter % Math.max(icpProblems.length, 1)] ?? fallbackProblem;
    const cap = capabilities[counter % Math.max(capabilities.length, 1)] ?? fallbackCapability;
    const stage = stageOrder[counter % stageOrder.length];
    const seedTopic = seedTopics[counter % seedTopics.length];
    const contentType = pickContentTypeForSeed(counter, allowedTypes, cap);
    const workflowCategory = foundation.capabilityMapping.workflowCategories[counter % Math.max(foundation.capabilityMapping.workflowCategories.length, 1)] ?? null;

    const draftTitle = seedTopic
      ? `${seedTopic} — through the lens of ${cap}`
      : `How ${cap} resolves ${icp.slice(0, 64)} for ${foundation.marketUnderstanding.targetMarket ?? foundation.marketUnderstanding.icps[0] ?? 'teams in this category'}`;

    // Case-study override per Phase 1 rule.
    const effectiveMode: ContentAlignmentMode = contentType === 'case-study'
      ? CASE_STUDY_FORCED_MODE
      : request.requestedMode;

    seeds.push({
      seedId: `seed_${counter}`,
      contentType,
      alignmentMode: effectiveMode,
      targetBuyerStage: stage,
      icpProblem: icp,
      capabilityFocus: cap,
      workflowCategory,
      seedTopic,
      draftTitle,
    });
    counter += 1;
  }
  return seeds;
}

// ────────────────────────────────────────────────────────────────────────────
// LLM refinement
// ────────────────────────────────────────────────────────────────────────────

interface RefinedCandidateRaw {
  seedId: string;
  recommendationTitle: string;
  editorialAngle: string;
  strategicNarrative: string;
  whyThisFitsCompany: {
    summary: string;
    icpProblemMapping: string;
    capabilityConnection: string;
    businessContextOrigin: string;
  };
  recommendedContentDirection: {
    primaryAngle: string;
    operationalProof: string[];
    avoidPatterns: string[];
  };
}

function buildRefinementSystemPrompt(mode: ContentAlignmentMode): string {
  const rule = ALIGNMENT_MODE_RULES[mode];
  const modeGuidance: Record<ContentAlignmentMode, string> = {
    company_context_led:
      'Recommendations MUST emerge from company business capability + ICP pain. Examples/workflows align with company operations. Commercially intelligent without sounding promotional.',
    hybrid_editorial:
      'Educational/editorial first. Company context still shapes perspective and terminology. Moderate company influence.',
    independent_editorial:
      'Broad educational category content. Minimal company influence. Aware of domain expertise. Must NOT become generic internet filler.',
  };

  return [
    'You are the long-form recommendation refinement layer for Omnivyra.',
    'You receive (a) a normalized CompanyContextFoundation and (b) heuristic seed candidates.',
    'For each seed, produce ONE refined recommendation card. Return JSON only.',
    '',
    `Content alignment mode: ${mode}.`,
    `Mode rule: ${modeGuidance[mode]}`,
    `companyWeight=${rule.companyWeight}, minCompanyAlignment=${rule.minCompanyAlignment}, requiresStrategicNarrative=${rule.requiresStrategicNarrative}.`,
    '',
    'HARD RULES (validator will reject violations):',
    '1. recommendationTitle must NOT be a generic SaaS phrase (no "ultimate guide", "boost productivity", "leverage AI", etc.).',
    '2. recommendationTitle must NOT mirror the seed topic verbatim — add a specific angle.',
    '3. whyThisFitsCompany.icpProblemMapping must reference a concrete ICP from the foundation (≥25 chars).',
    '4. whyThisFitsCompany.capabilityConnection must reference a concrete capability/workflow from the foundation.',
    '5. strategicNarrative must be ≥40 chars and tie to the company\'s transformation narrative or differentiation.',
    '6. recommendedContentDirection.operationalProof must contain ≥2 concrete, realistic proof items (workflow specifics, decision steps, measurable outcomes).',
    '7. recommendedContentDirection.avoidPatterns must list 2–3 generic patterns the article must avoid.',
    '',
    'Return shape per seed:',
    '{ seedId, recommendationTitle, editorialAngle, strategicNarrative, whyThisFitsCompany: { summary, icpProblemMapping, capabilityConnection, businessContextOrigin }, recommendedContentDirection: { primaryAngle, operationalProof: string[], avoidPatterns: string[] } }',
    '',
    'Return: { "refined": [ ...one entry per seed ] }.',
  ].join('\n');
}

function summarizeFoundationForPrompt(foundation: CompanyContextFoundation) {
  return {
    businessIdentity: foundation.businessIdentity,
    marketUnderstanding: foundation.marketUnderstanding,
    strategicPov: foundation.strategicPov,
    capabilityMapping: foundation.capabilityMapping,
    terminologyLayer: foundation.terminologyLayer,
    populatedSections: foundation.populatedSections,
  };
}

async function refineSeedsWithLlm(
  foundation: CompanyContextFoundation,
  seeds: HeuristicSeed[],
  mode: ContentAlignmentMode,
  request: GenerateLongFormRecommendationsRequest,
  retryFeedback: string[] = [],
): Promise<{ refined: RefinedCandidateRaw[]; raw: string }> {
  if (seeds.length === 0) return { refined: [], raw: '' };

  const messages = [
    { role: 'system' as const, content: buildRefinementSystemPrompt(mode) },
    {
      role: 'user' as const,
      content: JSON.stringify({
        foundation: summarizeFoundationForPrompt(foundation),
        seeds: seeds.map((s) => ({
          seedId: s.seedId,
          contentType: s.contentType,
          contentTypeRules: {
            depthLevel: contentTypeConfig[s.contentType].depthLevel,
            insightDensity: contentTypeConfig[s.contentType].insightDensity,
            structureStyle: contentTypeConfig[s.contentType].structureStyle,
          },
          alignmentMode: s.alignmentMode,
          targetBuyerStage: s.targetBuyerStage,
          icpProblem: s.icpProblem,
          capabilityFocus: s.capabilityFocus,
          workflowCategory: s.workflowCategory,
          seedTopic: s.seedTopic ?? null,
          draftTitle: s.draftTitle,
        })),
        retryFeedback: retryFeedback.length > 0 ? retryFeedback : undefined,
      }, null, 2),
    },
  ];

  let raw = '';
  try {
    const response = await runCompletionWithOperation({
      operation: 'generateLongFormRecommendations',
      companyId: request.companyId,
      cache_version: request.cacheVersion,
      model: 'gpt-4o-mini',
      temperature: retryFeedback.length > 0 ? 0.25 : 0.35,
      response_format: { type: 'json_object' },
      max_tokens: Math.min(6000, 500 + seeds.length * 450),
      messages,
    });
    raw = response.output;
  } catch (err) {
    return { refined: [], raw: `LLM_ERROR:${err instanceof Error ? err.message : 'unknown'}` };
  }

  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    const refined = Array.isArray(parsed?.refined) ? parsed.refined : [];
    return { refined: refined as RefinedCandidateRaw[], raw };
  } catch {
    return { refined: [], raw };
  }
}

function fallbackRefinementFromSeed(seed: HeuristicSeed, foundation: CompanyContextFoundation): RefinedCandidateRaw {
  const icpName = foundation.marketUnderstanding.icps[0] ?? foundation.marketUnderstanding.targetMarket ?? 'this audience';
  const transformation = foundation.strategicPov.transformationNarrative ?? 'the desired operational outcome';
  const diff = foundation.strategicPov.differentiation[0] ?? 'our operational approach';
  return {
    seedId: seed.seedId,
    recommendationTitle: seed.draftTitle.slice(0, 110),
    editorialAngle: `Frame ${seed.capabilityFocus} not as a feature but as the operating mechanism that resolves ${seed.icpProblem} for ${icpName}.`,
    strategicNarrative: `${diff} only works when ${seed.capabilityFocus} is sequenced before generic best-practice advice. This piece walks through that sequence for ${icpName}, ending in ${transformation}.`,
    whyThisFitsCompany: {
      summary: `Topic emerges from how we operationalize ${seed.capabilityFocus} against ${seed.icpProblem}.`,
      icpProblemMapping: `Maps directly to ${icpName}: ${seed.icpProblem}.`,
      capabilityConnection: `Anchored in ${seed.capabilityFocus}${seed.workflowCategory ? ` within the ${seed.workflowCategory} workflow` : ''}.`,
      businessContextOrigin: `Derived from ${foundation.businessIdentity.companyCategory ?? 'our category'} positioning and the ${foundation.populatedSections.length} populated context sections.`,
    },
    recommendedContentDirection: {
      primaryAngle: `Operational walk-through of ${seed.capabilityFocus} applied to ${seed.icpProblem}.`,
      operationalProof: [
        `Concrete decision sequence inside ${seed.workflowCategory ?? seed.capabilityFocus}.`,
        `Failure mode when teams skip this sequence and the visible symptom (${seed.icpProblem}).`,
      ],
      avoidPatterns: [
        'Generic "best practices" framing.',
        'Vendor-neutral overview that could describe any tool.',
      ],
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate assembly & finalization
// ────────────────────────────────────────────────────────────────────────────

function buildOriginTrace(seed: HeuristicSeed, foundation: CompanyContextFoundation): RecommendationOriginTrace {
  const sigs: RecommendationOriginTrace['companySignalsUsed'] = [
    { section: 'marketUnderstanding', signal: seed.icpProblem, influence: 'primary' },
    { section: 'capabilityMapping', signal: seed.capabilityFocus, influence: 'primary' },
  ];
  if (foundation.businessIdentity.positioning) {
    sigs.push({ section: 'businessIdentity', signal: foundation.businessIdentity.positioning, influence: 'supporting' });
  }
  if (foundation.strategicPov.transformationNarrative) {
    sigs.push({ section: 'strategicPov', signal: foundation.strategicPov.transformationNarrative, influence: 'supporting' });
  }
  if (seed.workflowCategory) {
    sigs.push({ section: 'capabilityMapping', signal: seed.workflowCategory, influence: 'context' });
  }
  return {
    companySignalsUsed: sigs,
    icpPainInfluences: [seed.icpProblem],
    capabilityClustersContributed: [seed.capabilityFocus, ...(seed.workflowCategory ? [seed.workflowCategory] : [])],
    selectionReason: `Seed paired ICP problem "${seed.icpProblem.slice(0, 60)}" with capability "${seed.capabilityFocus.slice(0, 60)}" at ${seed.targetBuyerStage} stage.`,
  };
}

function buildAlignmentTrace(args: {
  seed: HeuristicSeed;
  validation: ValidationResult;
  scoringSummary: string;
  retriedFrom?: ContentAlignmentMode;
}): AlignmentDecisionTrace {
  return {
    selectedMode: args.seed.alignmentMode,
    selectedModeReason: args.seed.contentType === 'case-study'
      ? 'Case-study content type forces company_context_led per Phase 1 rule.'
      : `Caller requested ${args.seed.alignmentMode}; case-study override not applicable.`,
    caseStudyOverride: args.seed.contentType === 'case-study',
    scoringPassed: args.validation.passed,
    scoringSummary: args.scoringSummary,
    retriedFrom: args.retriedFrom,
  };
}

function makeRecommendationId(seedId: string, attempt: number): string {
  return `lfr_${Date.now().toString(36)}_${seedId}_${attempt}`;
}

function assembleCandidate(
  seed: HeuristicSeed,
  refined: RefinedCandidateRaw,
): RecommendationCandidate {
  return {
    recommendationTitle: refined.recommendationTitle?.trim() || seed.draftTitle,
    editorialAngle: refined.editorialAngle?.trim() ?? '',
    contentAlignmentMode: seed.alignmentMode,
    targetBuyerStage: seed.targetBuyerStage,
    strategicNarrative: refined.strategicNarrative?.trim() ?? '',
    whyThisFitsCompany: {
      summary: refined.whyThisFitsCompany?.summary?.trim() ?? '',
      icpProblemMapping: refined.whyThisFitsCompany?.icpProblemMapping?.trim() ?? '',
      capabilityConnection: refined.whyThisFitsCompany?.capabilityConnection?.trim() ?? '',
      businessContextOrigin: refined.whyThisFitsCompany?.businessContextOrigin?.trim() ?? '',
    },
    recommendedContentDirection: {
      primaryAngle: refined.recommendedContentDirection?.primaryAngle?.trim() ?? '',
      operationalProof: Array.isArray(refined.recommendedContentDirection?.operationalProof)
        ? refined.recommendedContentDirection!.operationalProof.map((s) => String(s ?? '').trim()).filter(Boolean)
        : [],
      avoidPatterns: Array.isArray(refined.recommendedContentDirection?.avoidPatterns)
        ? refined.recommendedContentDirection!.avoidPatterns.map((s) => String(s ?? '').trim()).filter(Boolean)
        : [],
    },
    seedTopic: seed.seedTopic,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Engine entry point
// ────────────────────────────────────────────────────────────────────────────

export class InsufficientFoundationError extends Error {
  constructor(public foundation: CompanyContextFoundation) {
    super(`CompanyContextFoundation has only ${foundation.populatedSections.length} populated sections (minimum 3). Cannot generate company-context-aware recommendations.`);
    this.name = 'InsufficientFoundationError';
  }
}

export async function generateLongFormRecommendations(
  request: GenerateLongFormRecommendationsRequest,
  options?: {
    /** Override the memory provider (defaults to volatile singleton). */
    memoryProvider?: RecommendationMemoryProvider;
    /** Apply novelty penalty if recent fingerprints overlap. Default true. */
    applyMemoryNoveltyPenalty?: boolean;
    /** Override the lifecycle registry (defaults to in-process singleton). */
    lifecycleRegistry?: RecommendationLifecycleRegistry;
    /** Skip lifecycle registration (for stateless callers or tests). */
    skipLifecycleRegistration?: boolean;
  },
): Promise<GenerateLongFormRecommendationsResponse> {
  const limit = Math.min(request.limit ?? DEFAULT_RECOMMENDATION_LIMIT, MAX_RECOMMENDATION_LIMIT);
  const memory = options?.memoryProvider ?? getDefaultRecommendationMemory();
  const applyNoveltyPenalty = options?.applyMemoryNoveltyPenalty !== false;
  const lifecycle = options?.lifecycleRegistry ?? getDefaultRecommendationLifecycleRegistry();
  const skipLifecycle = options?.skipLifecycleRegistration === true;

  // Phase 2 — build foundation from canonical profile + context.
  // autoRefine: false keeps this endpoint read-only; recommendation generation
  // should never trigger profile re-extraction as a side effect.
  const profile = await getProfile(request.companyId, { autoRefine: false });
  const foundation = buildCompanyContextFoundation(profile);

  if (!foundationIsSufficient(foundation)) {
    throw new InsufficientFoundationError(foundation);
  }

  let seeds = buildHeuristicSeeds(foundation, request);
  const accepted: LongFormRecommendation[] = [];
  const rejected: GenerateLongFormRecommendationsResponse['rejected'] = [];
  let llmRefinementCalls = 0;
  let retryUsed = false;
  let retryFeedback: string[] = [];
  const candidatesPerRound: number[] = [];
  const acceptedPerRound: number[] = [];

  // Target the candidate pool size — over-generate so the balancer has choices.
  const candidatePoolTarget = Math.max(limit * 2, limit + 4);

  for (let round = 0; round <= MAX_RETRY_ROUNDS; round += 1) {
    if (accepted.length >= candidatePoolTarget) break;
    if (seeds.length === 0) break;

    // Refine in batch (one LLM call per round).
    const { refined } = await refineSeedsWithLlm(foundation, seeds, request.requestedMode, request, retryFeedback);
    llmRefinementCalls += 1;
    if (round > 0) retryUsed = true;

    const refinedById = new Map<string, RefinedCandidateRaw>();
    for (const r of refined) {
      if (r?.seedId) refinedById.set(r.seedId, r);
    }

    const failedThisRound: Array<{ seed: HeuristicSeed; reasons: string[] }> = [];
    let acceptedThisRound = 0;
    const candidatesThisRound = seeds.length;

    for (const seed of seeds) {
      const refinedRaw = refinedById.get(seed.seedId) ?? fallbackRefinementFromSeed(seed, foundation);
      const candidate = assembleCandidate(seed, refinedRaw);
      const { drift, scores } = finalizeCandidate(candidate, foundation, {
        recommendationId: makeRecommendationId(seed.seedId, round),
        recommendationTitle: candidate.recommendationTitle,
        editorialAngle: candidate.editorialAngle,
        contentAlignmentMode: candidate.contentAlignmentMode,
        recommendedContentType: seed.contentType,
        whyThisFitsCompany: candidate.whyThisFitsCompany,
        targetBuyerStage: candidate.targetBuyerStage,
        strategicNarrative: candidate.strategicNarrative,
        recommendedContentDirection: candidate.recommendedContentDirection,
      });

      const validation = validateRecommendationCandidate({
        candidate,
        foundation,
        scores,
        drift,
        mode: seed.alignmentMode,
      });

      const scoringSummary = `align=${scores.companyAlignmentScore} auth=${scores.authorityBuildingScore} comm=${scores.commercialRelevanceScore} op=${scores.operationalDepthScore} seo=${scores.seoOpportunityScore} overall=${scores.overallRecommendationStrength} drift=${drift.riskLevel}`;

      if (!validation.passed) {
        rejected.push({
          candidateTitle: candidate.recommendationTitle,
          reason: validation.rejections.map((r) => `${r.rule}: ${r.detail}`).join(' | '),
          mode: seed.alignmentMode,
        });
        failedThisRound.push({
          seed,
          reasons: validation.rejections.map((r) => `${r.rule}: ${r.detail}`),
        });
        continue;
      }

      const finalized: LongFormRecommendation = {
        recommendationId: makeRecommendationId(seed.seedId, round),
        recommendationTitle: candidate.recommendationTitle,
        editorialAngle: candidate.editorialAngle,
        contentAlignmentMode: candidate.contentAlignmentMode,
        recommendedContentType: seed.contentType,
        companyAlignmentScore: scores.companyAlignmentScore,
        commercialRelevanceScore: scores.commercialRelevanceScore,
        authorityBuildingScore: scores.authorityBuildingScore,
        operationalDepthScore: scores.operationalDepthScore,
        seoOpportunityScore: scores.seoOpportunityScore,
        overallRecommendationStrength: scores.overallRecommendationStrength,
        whyThisFitsCompany: candidate.whyThisFitsCompany,
        targetBuyerStage: candidate.targetBuyerStage,
        strategicNarrative: candidate.strategicNarrative,
        recommendedContentDirection: candidate.recommendedContentDirection,
        originTrace: buildOriginTrace(seed, foundation),
        alignmentDecisionTrace: buildAlignmentTrace({
          seed,
          validation,
          scoringSummary,
          retriedFrom: round > 0 ? seed.alignmentMode : undefined,
        }),
        genericityRiskLevel: drift.riskLevel,
      };
      accepted.push(finalized);
      acceptedThisRound += 1;
    }

    candidatesPerRound.push(candidatesThisRound);
    acceptedPerRound.push(acceptedThisRound);

    if (accepted.length >= candidatePoolTarget) break;

    // Retry only the failed seeds, with feedback strings the LLM can act on.
    seeds = failedThisRound.map((f) => f.seed);
    retryFeedback = failedThisRound.flatMap((f) =>
      f.reasons.map((r) => `Seed ${f.seed.seedId}: ${r}`),
    );
    if (seeds.length === 0) break;
  }

  // ────────────────────────────────────────────────────────────────────
  // Hardening pipeline — runs after the validation loop on the candidate
  // pool. Steps:
  //   1. Cluster → suppress near-duplicates per family.
  //   2. Narrative-shape guard → penalize banned/repeating shapes.
  //   3. Balance → pick `limit` candidates maximizing diversity.
  //   4. Memory novelty → score + soft-penalize repetitive structure
  //      against recent fingerprints for this company.
  //   5. Re-rank, record fingerprints, build diagnostics, return.
  // ────────────────────────────────────────────────────────────────────

  // 1. Family clustering. Keep up to one strong secondary per cluster to give
  //    the balancer flexibility when the pool is thin.
  const clusterResult = groupRecommendationsByFamily(accepted, { keepSecondarySimilarity: 0.05 });

  // 2. Narrative shape guard. Mutates overallRecommendationStrength.
  const shapeResult = applyNarrativeShapeGuard(clusterResult.enriched);

  // 3. Diversity balancer.
  const balanceResult = balanceRecommendationSet(shapeResult.recommendations, limit);

  // 4. Memory novelty scoring against recent fingerprints for THIS company.
  const recentFingerprints = await memory.recentFingerprints(request.companyId, 24);
  const withNovelty = balanceResult.selected.map((rec) => {
    const candidateFp = buildFingerprintFromRecommendation(request.companyId, rec);
    const novelty = scoreRecommendationNovelty(candidateFp, recentFingerprints);
    const novelyPenalty = applyNoveltyPenalty && novelty < 35 ? Math.round((35 - novelty) * 0.3) : 0;
    return {
      ...rec,
      recommendationNoveltyScore: novelty,
      overallRecommendationStrength: Math.max(0, rec.overallRecommendationStrength - novelyPenalty),
    } satisfies LongFormRecommendation;
  });

  // 5. Final ranking after all penalties.
  withNovelty.sort((a, b) => b.overallRecommendationStrength - a.overallRecommendationStrength);

  // Record fingerprints for future calls (fire-and-forget on persistence, but
  // we await the volatile adapter — it's synchronous in practice).
  try {
    await memory.recordBatch(
      request.companyId,
      withNovelty.map((rec) => buildFingerprintFromRecommendation(request.companyId, rec)),
    );
  } catch (err) {
    // Memory failure should not break the response.
    console.warn('LONG_FORM_RECOMMENDATIONS_MEMORY_WRITE_FAILED', err);
  }

  const setCoverage = reportRecommendationSetCoverage(withNovelty);
  // Pre-balance diversity = coverage of the full candidate pool BEFORE balancing.
  const preBalanceDiversity = reportRecommendationSetCoverage(shapeResult.recommendations).overallDiversityScore;
  const batchDiagnostics = buildBatchDiagnostics({
    recommendations: withNovelty,
    clusterReport: clusterResult.report,
    diversitySuppressionCount: balanceResult.diversitySuppressionCount,
    shapeDistribution: shapeResult.shapeDistribution,
    retry: {
      roundsUsed: candidatesPerRound.length,
      candidatesPerRound,
      acceptedPerRound,
    },
  });

  // ────────────────────────────────────────────────────────────────────
  // Finalization pipeline — per-recommendation enrichment, lifecycle
  // registration, then batch-level entropy + lifecycle diagnostics.
  // ────────────────────────────────────────────────────────────────────

  // Round IDs of recommendations that needed retry (round > 0).
  // (We don't track per-id rounds, so retried = retryUsed && roundsUsed > 1.)
  const recommendationRetried = retryUsed && candidatesPerRound.length > 1;

  // 1. Confidence per recommendation.
  const withConfidence = withNovelty.map((rec) => {
    const cluster = clusterResult.report.clusters.find((c) => c.familyClusterId === rec.familyClusterId) ?? null;
    const confidence = computeRecommendationConfidence({
      recommendation: rec,
      foundation,
      cluster,
      clusterReport: clusterResult.report,
      retryUsed,
      recommendationRetried,
      continuityStability: null,
    });
    return { ...rec, confidence } satisfies LongFormRecommendation;
  });

  // 2. Suitability per recommendation.
  const withSuitability = withConfidence.map((rec) => ({
    ...rec,
    suitability: analyzeRecommendationSuitability(rec),
  } satisfies LongFormRecommendation));

  // 3. Explanation per recommendation (uses confidence + suitability).
  const withExplanation = withSuitability.map((rec) => ({
    ...rec,
    explanation: composeRecommendationExplanation({
      recommendation: rec,
      foundation,
      confidence: rec.confidence,
      suitability: rec.suitability,
      siblings: withSuitability,
    }),
  } satisfies LongFormRecommendation));

  // 4. Lifecycle registration — register, then transition to validated → selected.
  const withLifecycle = withExplanation.map((rec) => {
    if (skipLifecycle) {
      return { ...rec, lifecycleState: 'selected' as const } satisfies LongFormRecommendation;
    }
    let lineage = lifecycle.register(rec, request.companyId, foundation.signature);
    lineage = lifecycle.transition(rec.recommendationId, 'validated');
    lineage = lifecycle.transition(rec.recommendationId, 'selected');
    return {
      ...rec,
      lifecycleState: 'selected' as const,
      lineageMetadata: lineage,
    } satisfies LongFormRecommendation;
  });

  // 5. Entropy stabilization (batch-level).
  const entropyStabilization = stabilizeBatchEntropy({
    recommendations: withLifecycle,
    setCoverage,
    diagnostics: batchDiagnostics,
    preBalanceDiversityScore: preBalanceDiversity,
  });

  // 6. Lifecycle diagnostics — walks the registry plus any inflight items.
  const lifecycleDiagnostics = buildLifecycleDiagnostics({
    registry: lifecycle,
    companyId: request.companyId,
    inflightRecommendations: skipLifecycle ? withLifecycle : undefined,
    preBalanceDiversity,
    postBalanceDiversity: setCoverage.overallDiversityScore,
  });

  return {
    recommendations: withLifecycle,
    rejected,
    foundationSignature: foundation.signature,
    foundationCompletion: foundation.completion,
    retryUsed,
    llmRefinementCalls,
    clusterDiversityReport: clusterResult.report,
    setCoverage,
    batchDiagnostics,
    entropyStabilization,
    lifecycleDiagnostics,
  };
}
