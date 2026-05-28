/**
 * Creative Variant Orchestrator (Phases 2 + 6).
 *
 * Produces a small set of MEANINGFULLY DIFFERENT prompt variants
 * from a single `CreativeDirectionPlan`. Each variant is a distinct
 * compositional / emotional / framing exploration — not a trivial
 * permutation of the same prompt.
 *
 * Cost governance is built in:
 *   - max 3 variants total
 *   - exploration depth scales with input richness (single variant
 *     when grounding is weak; 2-3 only when brand grounding is strong
 *     AND the surface is a high-stakes campaign anchor)
 *   - never emits two variants that resolve to the same template
 *
 * Variants are PROMPT-LEVEL only. The renderer still calls the
 * provider ONCE — with the winning variant's prompt. This satisfies
 * "multi-variant creative exploration" without doubling provider cost.
 */

import type {
  ComposeOptions,
  CreatorPromptInput,
  CreativeDirectionTemplate,
} from './creatorPromptComposer';
import {
  CREATIVE_STRATEGY_PROFILES,
  type CreativeDirectionPlan,
  type CreativeStrategyId,
  type CreativeStrategyProfile,
} from './creativeDirectorEngine';

/* ── Variant spec ───────────────────────────────────────────────────── */

export type VariantId = 'A_primary' | 'B_compositional_sibling' | 'C_emotional_contrast';

export type VariantSpec = {
  id: VariantId;
  label: string;
  /** Compose-time mutations applied on top of the base composer input. */
  inputMutations: Partial<CreatorPromptInput>;
  /** Compose-time options that drive template selection. */
  composeOptions: ComposeOptions;
  /** Audit metadata so dashboards can pivot variant performance. */
  audit: {
    template: CreativeDirectionTemplate;
    explorationVector: 'primary' | 'compositional' | 'emotional';
    rationale: string;
  };
};

export type VariantOrchestrationConfig = {
  maxVariants?: number;
  /** When false, the orchestrator returns a single primary variant
   *  regardless of plan signals (cost governance). */
  allowExploration?: boolean;
  /** Strict cap regardless of plan — for high-cost contexts. */
  hardCapToOne?: boolean;
  /**
   * Phase 6 — campaign DNA constraint. When set, variant exploration is
   * restricted to templates the DNA explicitly approves. Variants that
   * would diverge from the campaign's visual lane are filtered out
   * BEFORE they're emitted, preserving cross-asset coherence.
   */
  campaignApprovedTemplates?: ReadonlyArray<CreativeDirectionTemplate>;
};

export type VariantOrchestrationResult = {
  variants: VariantSpec[];
  /** Total variants emitted — never exceeds 3. */
  count: number;
  /** Why the orchestrator chose this exploration depth. */
  rationale: string[];
};

/* ── Exploration depth governance ───────────────────────────────────── */

function decideExplorationDepth(input: {
  plan: CreativeDirectionPlan;
  hasBrandGrounding: boolean;
  hasProductGrounding: boolean;
  config?: VariantOrchestrationConfig;
}): { depth: 1 | 2 | 3; rationale: string[] } {
  const rationale: string[] = [];
  const cfg = input.config ?? {};

  // Hard caps always win.
  if (cfg.hardCapToOne) {
    rationale.push('hard_cap_to_one');
    return { depth: 1, rationale };
  }
  if (cfg.allowExploration === false) {
    rationale.push('exploration_disabled');
    return { depth: 1, rationale };
  }
  const max = Math.max(1, Math.min(3, cfg.maxVariants ?? 3));
  if (max === 1) {
    rationale.push('cost_governance:max_variants_1');
    return { depth: 1, rationale };
  }

  // Cost-aware exploration depth based on plan + grounding signals.
  if (!input.hasBrandGrounding) {
    rationale.push('weak_brand_grounding:single_variant');
    return { depth: 1, rationale };
  }
  if (input.plan.premiumBias && (input.hasBrandGrounding && input.hasProductGrounding)) {
    rationale.push('premium_bias + full_grounding:three_variants');
    return { depth: Math.min(3, max) as 1 | 2 | 3, rationale };
  }
  if (input.plan.premiumBias || input.hasBrandGrounding) {
    rationale.push('partial_premium_or_brand:two_variants');
    return { depth: Math.min(2, max) as 1 | 2 | 3, rationale };
  }
  rationale.push('default:single_variant');
  return { depth: 1, rationale };
}

/* ── Variant construction ───────────────────────────────────────────── */

function buildPrimaryVariant(profile: CreativeStrategyProfile, brandPreference: CreativeDirectionTemplate | null | undefined): VariantSpec {
  return {
    id: 'A_primary',
    label: `Primary — ${profile.id}`,
    inputMutations: {},
    composeOptions: {
      premium: true,
      forceTemplate: profile.preferredTemplate,
      brandPreference: brandPreference ?? null,
    },
    audit: {
      template: profile.preferredTemplate,
      explorationVector: 'primary',
      rationale: `strategy_profile_primary:${profile.id}`,
    },
  };
}

function buildCompositionalSiblingVariant(profile: CreativeStrategyProfile, alreadyUsed: ReadonlySet<CreativeDirectionTemplate>): VariantSpec | null {
  // First sibling that hasn't been used yet.
  const candidate = profile.variantTemplates.find((t) => !alreadyUsed.has(t));
  if (!candidate) return null;
  return {
    id: 'B_compositional_sibling',
    label: `Compositional sibling — ${candidate}`,
    inputMutations: {},
    composeOptions: {
      premium: true,
      forceTemplate: candidate,
    },
    audit: {
      template: candidate,
      explorationVector: 'compositional',
      rationale: `sibling_of:${profile.id}`,
    },
  };
}

function buildEmotionalContrastVariant(
  profile: CreativeStrategyProfile,
  alreadyUsed: ReadonlySet<CreativeDirectionTemplate>,
): VariantSpec | null {
  // The "emotional contrast" is the FURTHEST-emphasis variant: if the
  // primary leans product-first, contrast leans human-first (or
  // ambient if no human emphasis available); if primary is editorial
  // restraint, contrast is documentary realism. Selection picks the
  // last template in the sibling list that hasn't been used.
  const reversed = [...profile.variantTemplates].reverse();
  const candidate = reversed.find((t) => !alreadyUsed.has(t));
  if (!candidate) return null;
  // Mutate the brandMode to nudge brand layer when the primary may
  // have suppressed it (a real emotional contrast — different brand
  // emphasis intensity).
  return {
    id: 'C_emotional_contrast',
    label: `Emotional contrast — ${candidate}`,
    inputMutations: {
      brandMode: 'brand-aware',
    },
    composeOptions: {
      premium: profile.realismLevel === 'cinematic' ? false : true,
      forceTemplate: candidate,
    },
    audit: {
      template: candidate,
      explorationVector: 'emotional',
      rationale: `contrast_of:${profile.id}`,
    },
  };
}

/* ── Public entry point ─────────────────────────────────────────────── */

export function orchestrateCreativeVariants(input: {
  plan: CreativeDirectionPlan;
  hasBrandGrounding: boolean;
  hasProductGrounding: boolean;
  brandPreference?: CreativeDirectionTemplate | null;
  config?: VariantOrchestrationConfig;
}): VariantOrchestrationResult {
  const profile = CREATIVE_STRATEGY_PROFILES[input.plan.strategyProfile];
  const { depth, rationale } = decideExplorationDepth({
    plan: input.plan,
    hasBrandGrounding: input.hasBrandGrounding,
    hasProductGrounding: input.hasProductGrounding,
    config: input.config,
  });

  // Phase 6 — DNA-constrained filter. When the renderer has provided
  // the campaign's approved templates, drop any variant whose template
  // falls outside the lane. This preserves cross-asset coherence while
  // still allowing exploration WITHIN the legal lane.
  const approved = input.config?.campaignApprovedTemplates;
  const isApproved = (t: CreativeDirectionTemplate): boolean =>
    !approved || approved.length === 0 || approved.includes(t);

  const used = new Set<CreativeDirectionTemplate>();
  const variants: VariantSpec[] = [];

  // Variant A — primary. When the primary isn't approved by DNA, fall
  // back to the first approved sibling (DNA short-circuit).
  const primaryCandidate = buildPrimaryVariant(profile, input.brandPreference);
  if (isApproved(primaryCandidate.audit.template)) {
    variants.push(primaryCandidate);
    used.add(primaryCandidate.audit.template);
  } else {
    // Find first DNA-approved sibling and promote it as primary.
    const dnaAllowedSibling = profile.variantTemplates.find(isApproved);
    if (dnaAllowedSibling) {
      variants.push({
        id: 'A_primary',
        label: `Primary (DNA-promoted) — ${dnaAllowedSibling}`,
        inputMutations: {},
        composeOptions: {
          premium: true,
          forceTemplate: dnaAllowedSibling,
          brandPreference: input.brandPreference ?? null,
        },
        audit: {
          template: dnaAllowedSibling,
          explorationVector: 'primary',
          rationale: `dna_constrained_primary:${input.plan.strategyProfile}`,
        },
      });
      used.add(dnaAllowedSibling);
      rationale.push(`dna_promoted_sibling:${dnaAllowedSibling}`);
    } else {
      // No DNA-approved variant available — emit primary as-is and
      // record the divergence for downstream governance to flag.
      variants.push(primaryCandidate);
      used.add(primaryCandidate.audit.template);
      rationale.push(`dna_no_match:emit_primary_as_is`);
    }
  }
  if (depth === 1) return { variants, count: 1, rationale };

  // Variant B — compositional sibling, DNA-filtered.
  const siblingCandidate = buildCompositionalSiblingVariant(profile, used);
  if (siblingCandidate && isApproved(siblingCandidate.audit.template)) {
    variants.push(siblingCandidate);
    used.add(siblingCandidate.audit.template);
  } else if (siblingCandidate) {
    rationale.push(`dna_filtered:sibling_dropped:${siblingCandidate.audit.template}`);
  }
  if (depth === 2 || variants.length >= 2 === false) {
    return { variants, count: variants.length, rationale };
  }

  // Variant C — emotional contrast, DNA-filtered.
  const contrastCandidate = buildEmotionalContrastVariant(profile, used);
  if (contrastCandidate && isApproved(contrastCandidate.audit.template)) {
    variants.push(contrastCandidate);
    used.add(contrastCandidate.audit.template);
  } else if (contrastCandidate) {
    rationale.push(`dna_filtered:contrast_dropped:${contrastCandidate.audit.template}`);
  }

  return { variants, count: variants.length, rationale };
}

/** Public lookup — diagnostics only. */
export function listStrategyVariantTemplates(strategy: CreativeStrategyId): ReadonlyArray<CreativeDirectionTemplate> {
  const profile = CREATIVE_STRATEGY_PROFILES[strategy];
  return [profile.preferredTemplate, ...profile.variantTemplates];
}
