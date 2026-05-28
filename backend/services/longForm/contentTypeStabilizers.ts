/**
 * contentTypeStabilizers.ts
 *
 * Phase 7.7 — Per-content-type stabilizers applied at three points:
 *   - PLANNING:  modulates section count, word distribution, anchor density
 *   - RUNTIME:   modulates execution-strategy biases (timeout, compression)
 *   - RECOVERY:  modulates recovery-action preferences
 *
 * Targets the four currently-unstable content types: blog, article,
 * whitepaper, newsletter. Other types use the `default` profile.
 *
 * No external dependencies. Stabilizers are pure data + small
 * computation; engines consume them via `getContentTypeStabilizer()`.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export interface PlanningStabilizer {
  /** Multiplier on the planner-emitted section count. */
  sectionCountMultiplier: number;
  /** Max sections after stabilizer (soft cap). */
  maxSectionsAfter: number;
  /** Min sections after stabilizer (soft floor). */
  minSectionsAfter: number;
  /** Multiplier on per-section word target. */
  perSectionWordMultiplier: number;
  /** Required grounding anchors per section (advisory). */
  groundingAnchorsPerSection: number;
  /** Prefer narrative continuity over depth. */
  preferNarrativeContinuity: boolean;
  /** Prefer evidence-first ordering. */
  preferEvidenceFirst: boolean;
}

export interface RuntimeStabilizer {
  /** Force timeout budget into a smaller bucket. */
  timeoutBudgetCapMs: number;
  /** Bias the compression mode threshold. */
  compressionAggressivenessBias: 'tighter' | 'normal' | 'looser';
  /** Preserved-segment overrides — never drop these. */
  alwaysPreserveSegments: string[];
  /** Compressed-first segments — drop these first. */
  compressFirstSegments: string[];
  /** Token-budget ceiling override (per article, ratio of model input limit). */
  inputBudgetRatio: number;
}

export interface RecoveryStabilizer {
  /** Prefer this recovery action when alignment fails. */
  alignmentFailureAction: 'restore_capability_emphasis' | 'restore_strategic_narrative' | 'restore_icp_specificity';
  /** Prefer this recovery action when factual fails. */
  factualFailureAction: 'soften_claims' | 'restore_operational_proof' | 'regenerate_section';
  /** Prefer this action when timeout-dominant. */
  timeoutAction: 'compact_retry' | 'minimal_recovery';
  /** Lower this if we should abandon faster on this type. */
  abandonmentSeverityFloor: number;
}

export interface ContentTypeStabilizer {
  contentType: string;
  planning: PlanningStabilizer;
  runtime: RuntimeStabilizer;
  recovery: RecoveryStabilizer;
  reasoning: string;
}

// ── Per-type profiles ────────────────────────────────────────────────────────

const BLOG_STABILIZER: ContentTypeStabilizer = {
  contentType: 'blog',
  reasoning: 'Tighter narrative continuity, reduced section count, stronger anti-generic weighting.',
  planning: {
    sectionCountMultiplier: 0.85,           // reduce section sprawl
    maxSectionsAfter: 6,
    minSectionsAfter: 3,
    perSectionWordMultiplier: 1.08,         // slightly bigger sections
    groundingAnchorsPerSection: 1,
    preferNarrativeContinuity: true,
    preferEvidenceFirst: false,
  },
  runtime: {
    timeoutBudgetCapMs: 120_000,
    compressionAggressivenessBias: 'normal',
    alwaysPreserveSegments: ['identity', 'strategic_anchors', 'strategic_differentiators', 'anti_generic'],
    compressFirstSegments: ['avoid_patterns', 'doctrine', 'formatting_guidance', 'examples'],
    inputBudgetRatio: 0.45,
  },
  recovery: {
    alignmentFailureAction: 'restore_strategic_narrative',
    factualFailureAction: 'soften_claims',
    timeoutAction: 'compact_retry',
    abandonmentSeverityFloor: 70,
  },
};

const ARTICLE_STABILIZER: ContentTypeStabilizer = {
  contentType: 'article',
  reasoning: 'Stronger grounding enforcement, reduced rhetorical inflation.',
  planning: {
    sectionCountMultiplier: 0.90,
    maxSectionsAfter: 8,
    minSectionsAfter: 4,
    perSectionWordMultiplier: 1.00,
    groundingAnchorsPerSection: 2,
    preferNarrativeContinuity: true,
    preferEvidenceFirst: true,
  },
  runtime: {
    timeoutBudgetCapMs: 150_000,
    compressionAggressivenessBias: 'normal',
    alwaysPreserveSegments: ['identity', 'grounding_evidence', 'strategic_anchors'],
    compressFirstSegments: ['avoid_patterns', 'doctrine', 'examples'],
    inputBudgetRatio: 0.50,
  },
  recovery: {
    alignmentFailureAction: 'restore_icp_specificity',
    factualFailureAction: 'soften_claims',
    timeoutAction: 'compact_retry',
    abandonmentSeverityFloor: 75,
  },
};

const WHITEPAPER_STABILIZER: ContentTypeStabilizer = {
  contentType: 'whitepaper',
  reasoning: 'Smaller grounded sections, stronger timeout budgeting, evidence-first execution.',
  planning: {
    sectionCountMultiplier: 1.10,             // more, smaller sections
    maxSectionsAfter: 12,
    minSectionsAfter: 5,
    perSectionWordMultiplier: 0.80,           // smaller sections
    groundingAnchorsPerSection: 3,
    preferNarrativeContinuity: false,
    preferEvidenceFirst: true,
  },
  runtime: {
    timeoutBudgetCapMs: 120_000,             // KEY: cap timeout aggressively
    compressionAggressivenessBias: 'tighter', // shave boilerplate early
    alwaysPreserveSegments: ['identity', 'grounding_evidence', 'hard_rules', 'capability_emphasis'],
    compressFirstSegments: ['avoid_patterns', 'doctrine', 'formatting_guidance', 'examples', 'terminology'],
    inputBudgetRatio: 0.40,
  },
  recovery: {
    alignmentFailureAction: 'restore_capability_emphasis',
    factualFailureAction: 'restore_operational_proof',
    timeoutAction: 'compact_retry',
    abandonmentSeverityFloor: 80,
  },
};

const NEWSLETTER_STABILIZER: ContentTypeStabilizer = {
  contentType: 'newsletter',
  reasoning: 'Compressed narrative planner, reduced grounding overhead, stronger transition preservation.',
  planning: {
    sectionCountMultiplier: 0.75,
    maxSectionsAfter: 5,
    minSectionsAfter: 2,
    perSectionWordMultiplier: 0.85,
    groundingAnchorsPerSection: 1,
    preferNarrativeContinuity: true,
    preferEvidenceFirst: false,
  },
  runtime: {
    timeoutBudgetCapMs: 90_000,
    compressionAggressivenessBias: 'tighter',
    alwaysPreserveSegments: ['identity', 'strategic_anchors'],
    compressFirstSegments: ['avoid_patterns', 'doctrine', 'formatting_guidance', 'examples', 'terminology', 'grounded_constraints'],
    inputBudgetRatio: 0.40,
  },
  recovery: {
    alignmentFailureAction: 'restore_strategic_narrative',
    factualFailureAction: 'soften_claims',
    timeoutAction: 'minimal_recovery',
    abandonmentSeverityFloor: 65,
  },
};

const DEFAULT_STABILIZER: ContentTypeStabilizer = {
  contentType: 'default',
  reasoning: 'Default profile for content types not yet individually stabilized.',
  planning: {
    sectionCountMultiplier: 1.0,
    maxSectionsAfter: 10,
    minSectionsAfter: 3,
    perSectionWordMultiplier: 1.0,
    groundingAnchorsPerSection: 1,
    preferNarrativeContinuity: false,
    preferEvidenceFirst: false,
  },
  runtime: {
    timeoutBudgetCapMs: 180_000,
    compressionAggressivenessBias: 'normal',
    alwaysPreserveSegments: ['identity', 'strategic_anchors'],
    compressFirstSegments: ['avoid_patterns', 'doctrine', 'formatting_guidance', 'examples'],
    inputBudgetRatio: 0.50,
  },
  recovery: {
    alignmentFailureAction: 'restore_strategic_narrative',
    factualFailureAction: 'soften_claims',
    timeoutAction: 'compact_retry',
    abandonmentSeverityFloor: 75,
  },
};

const REGISTRY: Record<string, ContentTypeStabilizer> = {
  blog: BLOG_STABILIZER,
  article: ARTICLE_STABILIZER,
  whitepaper: WHITEPAPER_STABILIZER,
  newsletter: NEWSLETTER_STABILIZER,
  default: DEFAULT_STABILIZER,
};

// ── Public API ───────────────────────────────────────────────────────────────

export function getContentTypeStabilizer(contentType: string): ContentTypeStabilizer {
  return REGISTRY[contentType] ?? REGISTRY.default;
}

/** All registered profiles — used by admin endpoints / governance. */
export function listContentTypeStabilizers(): ContentTypeStabilizer[] {
  return Object.values(REGISTRY);
}

/**
 * Apply the planning stabilizer to a baseline section count + per-section
 * word target. Returns the stabilized values + a reasoning string.
 */
export function applyPlanningStabilizer(input: {
  contentType: string;
  baselineSectionCount: number;
  baselinePerSectionWordTarget: number;
}): {
  sectionCount: number;
  perSectionWordTarget: number;
  reasoning: string[];
} {
  const stab = getContentTypeStabilizer(input.contentType);
  const reasoning: string[] = [];
  const desiredSections = Math.round(input.baselineSectionCount * stab.planning.sectionCountMultiplier);
  const clampedSections = Math.max(stab.planning.minSectionsAfter, Math.min(stab.planning.maxSectionsAfter, desiredSections));
  if (clampedSections !== input.baselineSectionCount) {
    reasoning.push(`Section count ${input.baselineSectionCount} → ${clampedSections} via ${stab.contentType} stabilizer (mul ${stab.planning.sectionCountMultiplier}).`);
  }
  const wordTarget = Math.round(input.baselinePerSectionWordTarget * stab.planning.perSectionWordMultiplier);
  if (wordTarget !== input.baselinePerSectionWordTarget) {
    reasoning.push(`Per-section words ${input.baselinePerSectionWordTarget} → ${wordTarget} via ${stab.contentType} stabilizer (mul ${stab.planning.perSectionWordMultiplier}).`);
  }
  return { sectionCount: clampedSections, perSectionWordTarget: wordTarget, reasoning };
}
