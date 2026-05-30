/**
 * Strategy Governance Prompt Context (Creator Governance → Prompt
 * Composer Integration — Phase 1).
 *
 * Builds the `GovernancePromptContext` envelope the prompt composer
 * consumes. Pure helper — sits between the picker's resolved
 * (selectedStrategy, contentType, companyContext) and the composer's
 * additive governance layer.
 *
 * STRICT SCOPE:
 *   - PURE function. No I/O. No mutations.
 *   - Reads from the existing `strategyGovernancePolicyRegistry` only.
 *   - Does NOT call the recommendation engine, variant planner, winner
 *     engine, renderer, analytics, publishing, or campaign execution.
 *   - The composer integration treats the context as additive — no
 *     existing prompt sections are removed.
 */

import {
  type GovernanceContextInput,
  type GovernedIndustry,
  type GovernanceRiskLevel,
  type StrategyGovernancePolicy,
  resolveStrategyGovernancePolicy,
  suppressedStrategiesForContentType,
  deprioritizedStrategiesForContentType,
} from './strategyGovernancePolicyRegistry';
import type { CreatorTypeForVariant } from '../../../lib/variants/creatorStrategyMapping';

export type GovernancePromptContext = {
  /** Resolved industry — 'none' when no governance policy applies. */
  industry: GovernedIndustry;
  /** Risk band — 'none' / 'low' / 'medium' / 'high'. */
  riskLevel: GovernanceRiskLevel;
  /** Operator-facing inline warnings (mirrored from
   *  `policy.requiredWarnings`). The composer does NOT inject these
   *  into the prompt directly — they are surfaced in metadata only. */
  requiredWarnings: ReadonlyArray<string>;
  /** Selected strategy slug — when the operator picked a specific
   *  purpose key. Used for the "restricted strategy was selected"
   *  caution line and for explainability metadata. */
  selectedStrategy: string | null;
  /** True when the selected strategy is in the policy's suppressed
   *  list for the given content type (operator overrode the default
   *  hide via the "show restricted" toggle). */
  selectedStrategyIsRestricted: boolean;
  /** True when the selected strategy is in the policy's deprioritized
   *  list. */
  selectedStrategyIsDeprioritized: boolean;
  /** Restriction / deprioritization reason for the selected strategy
   *  (when applicable). Mirrors `applier.options[i].restriction_reason`. */
  selectedStrategyGovernanceReason: string | null;
  /** Operator-facing governance reason strings for the selected
   *  strategy. Concatenated from policy + selected-strategy state so
   *  callers can render "Restricted because: ..." without re-resolving. */
  governanceReasons: ReadonlyArray<string>;
  /** Compliance directive lines that the composer injects into a
   *  dedicated governance prompt layer. Empty array when industry =
   *  'none' (zero impact on the composed prompt). */
  compliancePromptDirectives: ReadonlyArray<string>;
};

/**
 * Canonical governance explainability envelope surfaced by creator/text/
 * long-form generation results. This is metadata only; prompt-time policy
 * details remain in GovernancePromptContext.
 */
export type GovernanceExplainabilityMetadata = {
  industry: GovernedIndustry;
  riskLevel: GovernanceRiskLevel;
  selectedStrategy: string | null;
  warningsApplied: number;
  selectedStrategyIsRestricted: boolean;
  selectedStrategyIsDeprioritized: boolean;
};

export type BuildGovernancePromptContextInput = {
  /** Company-profile signal subset used for industry detection. */
  companyContext: GovernanceContextInput | null | undefined;
  /** Content type the asset will be — image / carousel / infographic. */
  contentType: CreatorTypeForVariant;
  /** Slug of the strategy the operator picked, OR null when no
   *  strategy was explicitly picked. Accepts BOTH the short slug
   *  used by the picker (e.g. 'promotional') AND the long form used
   *  by the renderer's metadata pipeline (e.g. 'promotional-image').
   *  Internally normalized to the short slug for policy lookup. */
  selectedStrategy?: string | null;
};

/**
 * Normalizes the picker's short-form strategy slug + the renderer's
 * long-form purposeKey to the canonical short slug the policy
 * registry uses. Returns null when input is empty.
 *
 * Examples:
 *   normalizeStrategySlug('promotional-image', 'image')  → 'promotional'
 *   normalizeStrategySlug('story-carousel',  'carousel') → 'story'
 *   normalizeStrategySlug('stats',           'infographic') → 'stats'
 *   normalizeStrategySlug('promotional',     'image')  → 'promotional'
 */
export function normalizeStrategySlug(
  rawSlug: string | null | undefined,
  contentType: CreatorTypeForVariant,
): string | null {
  if (!rawSlug) return null;
  const slug = String(rawSlug).trim().toLowerCase();
  if (!slug) return null;
  // Strip trailing `-<contentType>` when present (image/carousel form).
  // Infographic keys are already short.
  const suffix = `-${contentType}`;
  if (slug.endsWith(suffix)) {
    return slug.slice(0, slug.length - suffix.length) || null;
  }
  return slug;
}

/**
 * Build the prompt-side governance context. Returns the empty
 * (industry='none') context when no governance policy applies, so the
 * composer's governance layer becomes a strict no-op for non-regulated
 * companies (no behavior change).
 */
export function buildGovernancePromptContext(
  input: BuildGovernancePromptContextInput,
): GovernancePromptContext {
  const policy = resolveStrategyGovernancePolicy(input.companyContext);
  return buildContextFromPolicy({
    policy,
    contentType: input.contentType,
    selectedStrategy: normalizeStrategySlug(input.selectedStrategy ?? null, input.contentType),
  });
}

/**
 * Variant entry point — accepts a pre-resolved policy. Used by the
 * picker / endpoint when the policy has already been computed and we
 * want to avoid re-resolving.
 */
export function buildContextFromPolicy(input: {
  policy: StrategyGovernancePolicy;
  contentType: CreatorTypeForVariant;
  selectedStrategy?: string | null;
}): GovernancePromptContext {
  const { policy, contentType, selectedStrategy } = input;
  const selected = selectedStrategy ?? null;

  const suppressed = new Map(
    suppressedStrategiesForContentType(policy, contentType).map((r) => [r.strategy, r.reason] as const),
  );
  const deprioritized = new Map(
    deprioritizedStrategiesForContentType(policy, contentType).map((r) => [r.strategy, r.reason] as const),
  );

  const isRestricted = selected !== null && suppressed.has(selected);
  const isDeprioritized = selected !== null && !isRestricted && deprioritized.has(selected);
  const governanceReason = selected !== null
    ? suppressed.get(selected) ?? deprioritized.get(selected) ?? null
    : null;

  const reasons: string[] = [];
  if (governanceReason) reasons.push(governanceReason);

  return {
    industry: policy.industry,
    riskLevel: policy.riskLevel,
    requiredWarnings: policy.requiredWarnings,
    selectedStrategy: selected,
    selectedStrategyIsRestricted: isRestricted,
    selectedStrategyIsDeprioritized: isDeprioritized,
    selectedStrategyGovernanceReason: governanceReason,
    governanceReasons: reasons,
    compliancePromptDirectives: policy.compliancePromptDirectives,
  };
}

/**
 * True when the context carries any directive or caution the composer
 * should inject. Allows the composer to skip its governance layer
 * branch entirely for non-regulated companies (zero touch).
 */
export function governanceContextHasAnyDirective(ctx: GovernancePromptContext): boolean {
  if (ctx.compliancePromptDirectives.length > 0) return true;
  if (ctx.selectedStrategyIsRestricted) return true;
  if (ctx.selectedStrategyIsDeprioritized) return true;
  return false;
}

/**
 * Build the stable public metadata envelope for governance explainability.
 * Always returns a value so result contracts do not need an "absent
 * governance" branch.
 */
export function buildGovernanceExplainabilityMetadata(
  ctx: GovernancePromptContext | null | undefined,
  warningsApplied?: number,
): GovernanceExplainabilityMetadata {
  if (!ctx) {
    return {
      industry: 'none',
      riskLevel: 'none',
      selectedStrategy: null,
      warningsApplied: 0,
      selectedStrategyIsRestricted: false,
      selectedStrategyIsDeprioritized: false,
    };
  }

  return {
    industry: ctx.industry,
    riskLevel: ctx.riskLevel,
    selectedStrategy: ctx.selectedStrategy,
    warningsApplied: warningsApplied ?? ctx.compliancePromptDirectives.length,
    selectedStrategyIsRestricted: ctx.selectedStrategyIsRestricted,
    selectedStrategyIsDeprioritized: ctx.selectedStrategyIsDeprioritized,
  };
}

/**
 * Creator System-Prompt Governance Integration.
 *
 * Build the system-prompt-level compliance preamble. Returns null
 * when no governance context is supplied, the context is empty
 * (industry='none'), or the policy carries zero directives — yielding
 * a strict no-op so non-regulated callers see byte-identical system
 * prompts vs. prior behavior.
 *
 * The preamble is phrased as a non-negotiable policy block. It is
 * intended to be PREPENDED to the existing system prompt at every
 * `runCompletion` site within the content-generation pipeline so the
 * model receives the constraints at the SAME priority as identity-lock
 * + anti-generic-rules text (also prepended to system prompts today).
 *
 * Distinct from `buildGovernancePromptContext` outputs that flow into
 * the user prompt (`extra_instruction`, theme-treatment user prompt)
 * — those still fire alongside this preamble for defense-in-depth.
 */
export function buildSystemPromptGovernancePreamble(
  ctx: GovernancePromptContext | null | undefined,
): string | null {
  if (!ctx) return null;
  if (!governanceContextHasAnyDirective(ctx)) return null;
  const lines: string[] = [];
  if (ctx.industry !== 'none' && ctx.compliancePromptDirectives.length > 0) {
    lines.push(`COMPLIANCE POLICY (${ctx.industry} industry, risk: ${ctx.riskLevel}) — non-negotiable:`);
    for (const directive of ctx.compliancePromptDirectives) lines.push(`- ${directive}`);
    lines.push(
      'Treat the above as constraints, not suggestions. If a brief asks for content that would violate any line, soften the framing or omit the offending element while still answering the brief.',
    );
  }
  if (ctx.selectedStrategyIsRestricted) {
    lines.push(
      `The operator selected the "${ctx.selectedStrategy ?? 'unknown'}" strategy despite it being restricted under this industry's policy (${ctx.selectedStrategyGovernanceReason ?? 'restricted by policy'}). Apply maximum compliance discipline.`,
    );
  } else if (ctx.selectedStrategyIsDeprioritized) {
    lines.push(
      `The selected "${ctx.selectedStrategy ?? 'unknown'}" strategy is deprioritized under this industry's policy (${ctx.selectedStrategyGovernanceReason ?? 'deprioritized by policy'}). Apply the constraints above with extra discipline.`,
    );
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Convenience helper for the pipeline's system-prompt construction
 * sites. Reads `item.governance` (set by the text orchestrator when
 * it threads `input.governance` through) and returns the preamble
 * string. The pipeline modules import this so they don't need to
 * know the governance context shape directly.
 */
export function buildSystemPromptGovernancePreambleFromItem(
  item: { governance?: GovernancePromptContext | null } | null | undefined,
): string | null {
  if (!item) return null;
  return buildSystemPromptGovernancePreamble(item.governance ?? null);
}

/**
 * Final Creator Governance Closure Pass — Phase 3 (rewriter
 * consistency).
 *
 * Canonical helper for prepending the governance preamble to a
 * caller-supplied base system prompt. Returns the base prompt
 * unchanged when no governance context applies — byte-identical to
 * legacy callers.
 *
 * All system-prompt construction sites (blueprint generator,
 * platform variant generator batch + rewriter, theme treatment, …)
 * are expected to call this single helper. Local `apply*` shims in
 * pipeline modules are thin wrappers that delegate here, preventing
 * divergent preamble formats from drifting in over time.
 */
export function applyGovernancePreambleToSystemPrompt(
  basePrompt: string,
  governance: GovernancePromptContext | null | undefined,
): string {
  const preamble = buildSystemPromptGovernancePreamble(governance ?? null);
  if (!preamble) return basePrompt;
  return `${preamble}\n\n${basePrompt}`;
}

/**
 * Variant of `applyGovernancePreambleToSystemPrompt` that reads
 * `item.governance` instead of taking the context directly. Convenience
 * for pipeline modules that operate on the `item` envelope.
 */
export function applyGovernancePreambleToSystemPromptFromItem(
  basePrompt: string,
  item: { governance?: GovernancePromptContext | null } | null | undefined,
): string {
  return applyGovernancePreambleToSystemPrompt(basePrompt, item?.governance ?? null);
}
