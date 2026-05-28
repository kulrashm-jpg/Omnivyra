/**
 * Production SectionGenerator adapter backed by the aiGateway.
 *
 * Translates the SectionGenerationContract + optional recovery hint into a
 * system+user prompt, calls `runCompletionWithOperation`, and returns HTML.
 *
 * Operation name: `generateLongFormSection` — register in aiGateway
 * FEATURE_AREA_MAP under 'Activity Workspace' for cost attribution.
 *
 * NOTE: This module is intentionally thin. All governance lives in the
 * orchestrator + per-module validators. If the LLM returns weak prose, the
 * orchestrator's recovery loop handles it via the hint mechanism.
 */

import { runCompletionWithOperation } from '../aiGateway';
import type { SectionGenerator, SectionGenerationHint } from './longFormGenerationOrchestrator';
import type { SectionGenerationContract } from './longFormRecommendationTypes';
import {
  buildIdentityLock,
  buildAntiGenericRules,
  buildCompanyContextBlock,
  type CompanyIdentity,
} from '../../../lib/content/companyContextBlock';
import {
  computePromptBudgetReport,
  emitPromptBudgetTelemetry,
} from './promptBudgetTelemetry';
// Phase 4.5 — Dynamic execution strategy + section-timeout telemetry.
import {
  chooseSectionExecutionStrategy,
  emitSectionTimeoutTelemetry,
  type SectionExecutionDirectives,
  type SectionExecutionStrategy,
} from './sectionExecutionStrategy';
// Phase 5.3 — Deterministic prompt compression (replaces Boolean toggles
// when the strategy mode allows further token reduction).
import {
  selectCompressionMode,
  compressPrompt,
  makeSegment,
  buildCompressionEvent,
  triggerFromExecutionStrategy,
  type PromptSegment,
  type PromptCompressionMode,
  type CompressionEvent,
} from './promptCompressionEngine';
// Phase 7.2 — Per-article fragment cache for identity / anti-generic /
// assignment / compressed-prompt reuse across sections.
import {
  GenerationFragmentCache,
} from './runtimeEfficiencyOptimizer';

const RECOVERY_INSTRUCTIONS: Record<NonNullable<SectionGenerationHint>['recoveryAction'], string> = {
  regenerate_section: 'Regenerate this section from scratch. Honor every hard rule and target preservation listed above.',
  reinforce_terminology: 'Re-inject the domain vocabulary and strategic terminology listed below into the section text where it naturally fits. Use these exact phrases.',
  restore_operational_proof: 'Cite the operational proof items below as concrete decision points, named checkpoints, or steps. Do not paraphrase them into vague language.',
  restore_icp_specificity: 'Re-anchor every claim in the section to the named ICP and the specific pain points listed below.',
  restore_capability_emphasis: 'Make the primary capability the through-line of the section. Mention it by its exact name in the first paragraph and reference it again in the closing paragraph.',
  restore_strategic_narrative: 'Preserve the assertive sequencing tone of the strategic narrative. Use the connective phrases "only works when", "sequenced before", "requires" where they fit.',
  restore_sequencing_continuity: 'Restore the section\'s role in the staged progression. Reference what came before and set up what follows.',
};

export interface AiGatewaySectionGeneratorOptions {
  /** Default 'gpt-4o-mini'; override per environment. */
  model?: string;
  /** Lower temperature on retries (regeneration). */
  baseTemperature?: number;
  /** Cache-buster passed to the gateway. */
  cacheVersion?: string | null;
  /** Optional companyId override (defaults to contract's recommendationId company unknown). */
  companyId?: string | null;
}

// Phase 3.2 — Canonical identity lock injection.
//
// Returns the identity-lock + company-context block + anti-generic rules
// PRE-PENDED to the rest of the system prompt. When no identity is
// supplied (legacy callers, or sparse profiles) we silently fall through
// — the rest of the contract-driven prompt still applies.
//
// Phase 4.5 — When the execution strategy requests it, the identity lock
// is truncated to a single line ("MINIMAL_RECOVERY"). Anti-generic rules
// drop in the lowest two strategies.
function buildIdentityPreamble(
  identity: CompanyIdentity | null | undefined,
  contentType: string,
  pruning?: SectionExecutionDirectives['promptPruning'],
  cache?: GenerationFragmentCache,
): string {
  if (!identity) return '';
  if (pruning?.truncateIdentityLockToOneLine) {
    const name = identity.companyName ?? 'the company';
    return `You write AS ${name}. Every section must reflect this company's perspective.`;
  }
  // Phase 7.2 — Identity-lock and anti-generic rules don't vary across
  // sections in the same article. Cache them per-company key.
  const cacheKey = `${identity.companyName ?? 'noco'}::${contentType}`;
  let lockBlock: string;
  let antiGeneric: string;
  if (cache) {
    const cachedLock = cache.getIdentityLock(cacheKey);
    if (cachedLock) {
      lockBlock = cachedLock.systemBlock;
    } else {
      lockBlock = buildIdentityLock(identity, contentType);
      cache.setIdentityLock(cacheKey, lockBlock);
    }
    const cachedAnti = cache.getAntiGenericBlock(cacheKey);
    if (cachedAnti) {
      antiGeneric = cachedAnti.systemBlock;
    } else {
      antiGeneric = buildAntiGenericRules(identity);
      cache.setAntiGenericBlock(cacheKey, antiGeneric);
    }
  } else {
    lockBlock = buildIdentityLock(identity, contentType);
    antiGeneric = buildAntiGenericRules(identity);
  }
  const contextBlock = buildCompanyContextBlock(identity);
  const parts: string[] = [];
  if (lockBlock) parts.push(lockBlock);
  if (contextBlock) parts.push(`\nCOMPANY CONTEXT BLOCK:\n${contextBlock}`);
  if (antiGeneric) parts.push(antiGeneric);
  return parts.join('\n');
}

// Phase 3.5 — Strategic assignment rendering inside the section prompt.
function renderStrategicAssignment(contract: SectionGenerationContract): string {
  const a = contract.strategicAssignment;
  if (!a) return '';
  const lines: string[] = [];
  if (a.required_context.length) lines.push(`required context: ${a.required_context.join(' | ')}`);
  if (a.required_positioning.length) lines.push(`required positioning: ${a.required_positioning.join(' | ')}`);
  if (a.required_pain_points.length) lines.push(`required pain points: ${a.required_pain_points.join(' | ')}`);
  if (a.required_differentiators.length) lines.push(`required differentiators: ${a.required_differentiators.join(' | ')}`);
  if (lines.length === 0) return '';
  return `\nSTRATEGIC ASSIGNMENT FOR THIS SECTION (${a.section_role}, section_id=${a.section_id}):\n${lines.map((l) => `- ${l}`).join('\n')}\nEach assignment must be reflected in the section text — not paraphrased into vagueness, not collapsed into a one-line aside.`;
}

function buildSystemPrompt(
  contract: SectionGenerationContract,
  directives?: SectionExecutionDirectives,
  cache?: GenerationFragmentCache,
): string {
  // Phase 3.2 — Identity preamble (canonical) prepended; rest of contract
  // prompt unchanged.
  // Phase 4.5 — Identity may be truncated under MINIMAL_RECOVERY.
  // Phase 7.2 — Reuses cached identity/anti-generic blocks across sections.
  const identityPreamble = buildIdentityPreamble(
    contract.companyIdentity as CompanyIdentity | undefined,
    contract.contentType,
    directives?.promptPruning,
    cache,
  );

  // Phase 4.5 — Word target may be overridden by execution directives.
  const effectiveWordTarget = directives?.wordTargetOverride ?? contract.wordTarget;

  const contractBlock = [
    'You are the per-section writer for the long-form generation engine.',
    'Return exactly ONE long-form section as clean HTML.',
    '',
    'HARD RULES:',
    `- Begin with <h2>${contract.sectionTitle}</h2>.`,
    `- Honor the section_goal: ${contract.sectionGoal}`,
    `- Unique angle: ${contract.uniqueAngle}`,
    `- Content type: ${contract.contentType}`,
    `- Depth requirement: ${contract.depthRequirement}`,
    `- Word target: ~${effectiveWordTarget} words.`,
    contract.requiresDirectAnswer ? '- Begin with a one-sentence direct answer.' : '',
    contract.requiresOpinionatedInsight ? '- Include an opinionated, non-obvious insight that challenges a common assumption.' : '',
    contract.frameworkRole === 'introduce' ? `- Introduce the framework "${contract.frameworkName}" with components: ${contract.frameworkComponents.join(', ')}.` : '',
    contract.frameworkRole === 'apply' ? `- Apply the framework "${contract.frameworkName}" with concrete decision points.` : '',
    '',
    'STRATEGIC ANCHORS (must remain the through-line):',
    `- Editorial angle: ${contract.editorialAngle}`,
    `- Strategic narrative: ${contract.strategicNarrative}`,
    `- Target buyer stage: ${contract.targetBuyerStage}`,
    `- Content alignment mode: ${contract.contentAlignmentMode}`,
    contract.narrativeArchetype ? `- Narrative archetype: ${contract.narrativeArchetype}` : '',
    '',
    'ICP FRAMING:',
    contract.icpFraming.market ? `- Market: ${contract.icpFraming.market}` : '',
    `- ICPs: ${contract.icpFraming.icps.join('; ') || '—'}`,
    `- Pain points: ${contract.icpFraming.painPoints.slice(0, 4).join('; ') || '—'}`,
    `- ICP problem mapping: ${contract.icpFraming.icpProblemMapping}`,
    '',
    'CAPABILITY EMPHASIS (must surface):',
    `- Primary capability: ${contract.capabilityEmphasis.primaryCapability}`,
    contract.capabilityEmphasis.workflowCategory ? `- Workflow category: ${contract.capabilityEmphasis.workflowCategory}` : '',
    '',
    // Phase 4.5 — Terminology block can be dropped under EMERGENCY_REDUCTION
    // and below (model still knows the topic from the contract).
    ...(directives?.promptPruning.dropTerminologyEmphasis ? [] : [
      'TERMINOLOGY EMPHASIS (prefer these phrasings):',
      `- Domain vocabulary: ${contract.terminologyEmphasis.domainVocabulary.slice(0, 8).join(', ') || '—'}`,
      `- Strategic terminology: ${contract.terminologyEmphasis.strategicTerminology.slice(0, 8).join(', ') || '—'}`,
      '',
    ]),
    // Phase 4.5 — Avoid-patterns is the lowest-value boilerplate; drop on
    // first retry to save tokens.
    ...(directives?.promptPruning.dropAvoidPatterns ? [] : [
      'AVOID PATTERNS:',
      ...contract.avoidPatterns.map((p) => `- ${p}`),
      '',
      'AVOID (always):',
      '- Generic SaaS filler ("leveraging AI", "businesses today", "in today\'s fast-paced").',
      '- Empty best-practices framing.',
      '- "Ultimate guide" or "complete guide" phrasing inside the body.',
      '- More than 2 instances of moreover/furthermore/additionally per section.',
      '- Generic CTAs ("get started today", "contact us today").',
      '',
    ]),
    // Phase 4.5 — Factual-integrity block can be dropped under
    // MINIMAL_RECOVERY only (it is otherwise load-bearing).
    ...(directives?.promptPruning.dropFactualIntegritySection ? [] : [
      'FACTUAL INTEGRITY (hard constraints — section will be auto-rejected if violated):',
      `- Allowed evidence types: ${contract.evidenceRequirements.allowedEvidenceTypes.join(', ')}.`,
      `- Speculative language policy: ${contract.evidenceRequirements.speculativeLanguagePolicy}.`,
      `- Claim sensitivity profile: ${contract.evidenceRequirements.claimSensitivityProfile}.`,
      '- No invented statistics. NEVER write percentages, dollar figures, or multipliers unless they come from the recommendation\'s own data.',
      '- No fake benchmarks. NEVER claim "X% faster than competitors" without an attributed source.',
      '- No fake customer examples. NEVER fabricate company names like "ACME Corp saved 40%".',
      '- No fake research references. NEVER write "Gartner reports..." / "Forrester study shows..." unless explicitly cited in the prompt.',
      '- No unsupported authority appeals. NEVER write "studies show", "experts agree", "research proves" without attribution.',
      '- No fabricated operational certainty. NEVER write "guaranteed results", "this always works", "100% reliable".',
      '- No fake industry standards. NEVER write "the industry standard is..." or "industry-wide best practice is...".',
      '- Hedge uncertain claims. Use "typically", "often", "in our experience", "may", "depending on" when the claim is not verifiable.',
      '- Forbidden patterns (contract-specific):',
      ...contract.evidenceRequirements.forbiddenClaimPatterns.map((p) => `  · ${p}`),
      '',
    ]),
    // Phase 4.5 — Grounded-constraints block dropped under
    // EMERGENCY_REDUCTION/MINIMAL_RECOVERY (the brief citation guardrail
    // moves to a one-line directive instead).
    ...(directives?.promptPruning.dropGroundedConstraintsSection ? [
      '- NEVER invent a source name, customer name, statistic, or research firm citation.',
      '',
    ] : [
      'GROUNDED GENERATION CONSTRAINTS (citations + sources):',
      `- Citation requirement: ${contract.groundedConstraints.citationRequirements} (preferred = cite when possible; required = every factual claim cited; optional = no cite obligation).`,
      `- Minimum trust for citation: ${contract.groundedConstraints.sourceTrustThresholds.minimumTrustScoreForCitation} (0–100).`,
      `- Minimum trust for factual claim: ${contract.groundedConstraints.sourceTrustThresholds.minimumTrustScoreForFactualClaim} (0–100).`,
      `- Unsupported-claim escalation policy: ${contract.groundedConstraints.unsupportedClaimEscalationPolicy} (allow | soften | remove | reject_section).`,
      contract.groundedConstraints.allowedSourceIds.length > 0
        ? `- Allowed source IDs: ${contract.groundedConstraints.allowedSourceIds.join(', ')}. Do NOT invent or cite any source outside this list.`
        : '- No source whitelist supplied — only cite content that traces to context already provided.',
      contract.groundedConstraints.mandatoryEvidenceAnchors.length > 0
        ? `- Mandatory evidence anchors (must surface in the section text): ${contract.groundedConstraints.mandatoryEvidenceAnchors.join('; ')}`
        : '- No mandatory evidence anchors for this section.',
      '- NEVER invent a source name. NEVER cite a research firm, customer, or benchmark not in the allowed list.',
      '- If a claim cannot be grounded in an allowed source, either soften the claim ("in our experience"), remove it, or rewrite it as opinion — depending on the escalation policy above.',
      '',
    ]),
    'HARD RULES FROM ORCHESTRATION CONTRACT:',
    ...contract.hardRules.map((r) => `- ${r}`),
  ].filter(Boolean).join('\n');

  // Phase 4.5 — Skip strategic assignment under MINIMAL_RECOVERY only.
  const strategicAssignment = directives?.promptPruning.skipStrategicAssignment
    ? ''
    : renderStrategicAssignment(contract);
  return [identityPreamble, contractBlock, strategicAssignment]
    .filter((s) => s && s.length > 0)
    .join('\n\n');
}

function buildUserPayload(contract: SectionGenerationContract, hint?: SectionGenerationHint): string {
  const payload: Record<string, unknown> = {
    sectionContractId: contract.sectionContractId,
    sectionIndex: contract.sectionIndex,
    sectionTitle: contract.sectionTitle,
    key_points: contract.keyPoints,
    target_entities: contract.targetEntities,
    priorSectionSummaries: contract.priorSectionSummaries,
  };
  if (hint) {
    payload.recovery = {
      action: hint.recoveryAction,
      instruction: RECOVERY_INSTRUCTIONS[hint.recoveryAction],
      targets: hint.recoveryTargets,
      attemptNumber: hint.attemptNumber,
      previousAttemptExcerpt: hint.previousAttemptHtml
        ? hint.previousAttemptHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600)
        : null,
    };
  }
  return JSON.stringify(payload, null, 2);
}

// Phase 5.3 — Segment the assembled system prompt into named blocks the
// compression engine can rank. Recognizers run in order; the first match
// claims the lines up to the next recognized boundary.
const SEGMENT_RECOGNIZERS: Array<{
  startMarker: RegExp;
  endHint?: RegExp;
  kind: import('./promptCompressionEngine').PromptSegmentKind;
  label: string;
}> = [
  { startMarker: /You are the in-house content strategist for/, kind: 'identity', label: 'Identity lock' },
  { startMarker: /^CONTENT ENFORCEMENT RULES/m, kind: 'anti_generic', label: 'Anti-generic rules' },
  { startMarker: /^COMPANY CONTEXT BLOCK:/m, kind: 'icp_context', label: 'Company context block' },
  { startMarker: /^HARD RULES:/m, kind: 'hard_rules', label: 'Hard rules' },
  { startMarker: /^STRATEGIC ANCHORS/m, kind: 'strategic_anchors', label: 'Strategic anchors' },
  { startMarker: /^ICP FRAMING:/m, kind: 'icp_context', label: 'ICP framing' },
  { startMarker: /^CAPABILITY EMPHASIS/m, kind: 'capability_emphasis', label: 'Capability emphasis' },
  { startMarker: /^TERMINOLOGY EMPHASIS/m, kind: 'terminology', label: 'Terminology emphasis' },
  { startMarker: /^AVOID PATTERNS:/m, kind: 'avoid_patterns', label: 'Avoid patterns' },
  { startMarker: /^FACTUAL INTEGRITY/m, kind: 'factual_integrity', label: 'Factual integrity rules' },
  { startMarker: /^GROUNDED GENERATION CONSTRAINTS/m, kind: 'grounded_constraints', label: 'Grounded generation constraints' },
  { startMarker: /^STRATEGIC ASSIGNMENT FOR THIS SECTION/m, kind: 'assignment_anchors', label: 'Strategic assignment' },
  { startMarker: /^HARD RULES FROM ORCHESTRATION CONTRACT:/m, kind: 'hard_rules', label: 'Orchestration hard rules' },
];

function segmentSystemPrompt(systemText: string): PromptSegment[] {
  // Find all marker positions, then carve the prompt into ranges.
  const markers: Array<{
    pos: number;
    kind: import('./promptCompressionEngine').PromptSegmentKind;
    label: string;
  }> = [];
  for (const rec of SEGMENT_RECOGNIZERS) {
    const m = rec.startMarker.exec(systemText);
    if (m) markers.push({ pos: m.index, kind: rec.kind, label: rec.label });
  }
  markers.sort((a, b) => a.pos - b.pos);

  const segments: PromptSegment[] = [];
  // Leading region before any recognized marker is 'other' (compressible).
  if (markers.length === 0) {
    segments.push(makeSegment('other', 'unsegmented', systemText));
    return segments;
  }
  if (markers[0].pos > 0) {
    const leading = systemText.slice(0, markers[0].pos);
    if (leading.trim().length > 0) segments.push(makeSegment('other', 'preamble', leading));
  }
  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].pos;
    const end = i + 1 < markers.length ? markers[i + 1].pos : systemText.length;
    const body = systemText.slice(start, end);
    segments.push(makeSegment(markers[i].kind, markers[i].label, body));
  }
  return segments;
}

function unwrapHtml(raw: string): string {
  const trimmed = raw.trim();
  // Strip ```html or ```html fences if the model wrapped its output.
  const fenced = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function createAiGatewaySectionGenerator(options: AiGatewaySectionGeneratorOptions = {}): SectionGenerator {
  const model = options.model ?? 'gpt-4o-mini';
  const baseTemperature = options.baseTemperature ?? 0.45;
  return {
    async generate({ contract, hint, executionDirectives, fragmentCache }) {
      // Phase 4.5 — Resolve the execution strategy. The orchestrator may
      // pass directives in; otherwise we compute a NORMAL default based on
      // the hint (any hint implies a retry attempt).
      const directives: SectionExecutionDirectives = executionDirectives ?? chooseSectionExecutionStrategy({
        contract,
        attempt: hint?.attemptNumber ?? 1,
        timeoutFailureCount: 0,
        previousAttemptTimedOut: false,
        sectionElapsedMs: 0,
      });

      // Phase 7.2 — Build the system prompt with cache (if supplied) so
      // identity-lock + anti-generic blocks are reused across sections.
      const rawSystem = buildSystemPrompt(contract, directives, fragmentCache);
      const user = buildUserPayload(contract, hint);
      const isRetry = !!hint;
      const temperature = isRetry ? Math.max(0.2, baseTemperature - 0.2) : baseTemperature;
      // Phase 4.5 — Use the execution-strategy max_tokens override.
      const maxTokens = directives.maxTokens;

      // Phase 5.3 — Deterministic prompt compression layered on top of the
      // strategy's Boolean toggles. The strategy already dropped large
      // blocks (factual / grounded / avoid); the compression engine
      // ranks the REMAINING segments by load-bearingness and, if we're
      // still over budget OR the mode demands more aggressive shaving,
      // drops doctrine / formatting / boilerplate next.
      //
      // We segment the assembled `rawSystem` heuristically by canonical
      // markers; segments not recognized are tagged as 'other' (highest
      // drop priority among COMPRESSIBLE — first to go under any pressure).
      const compressionMode: PromptCompressionMode = selectCompressionMode({
        totalInputTokens: Math.ceil((rawSystem.length + user.length) / 4),
        modelInputLimit: 128_000,
        outputBudgetTokens: maxTokens,
        timeoutFailures: 0,
        previousAttemptTimedOut: !!hint && /timeout|deadline/i.test(hint.recoveryAction ?? ''),
        isRetry,
      });
      // Phase 7.2 — Per-article compression cache: identical segments+mode
      // pairs reuse the previous compressed result so we don't re-segment
      // and re-rank for every section.
      const segments: PromptSegment[] = segmentSystemPrompt(rawSystem);
      const compressionCacheKey = `${compressionMode}::${segments.length}::${rawSystem.length}`;
      let compressed = fragmentCache?.getCompressedPrompt(compressionCacheKey);
      if (!compressed) {
        compressed = compressPrompt({
          segments,
          mode: compressionMode,
          // Target: keep the system prompt under ~50% of input limit so
          // there's slack for the user prompt.
          targetTokens: Math.max(800, Math.floor(128_000 * 0.50)),
        });
        if (fragmentCache && compressionMode !== 'NONE') {
          fragmentCache.setCompressedPrompt(compressionCacheKey, compressed);
        }
      }
      const system = compressionMode === 'NONE' ? rawSystem : compressed.compressedPrompt;

      // Phase 7.6 — Build CompressionEvent record (when compression ran)
      // so the orchestrator can populate operationalExplainability.
      let compressionEvent: CompressionEvent | undefined;
      if (compressionMode !== 'NONE') {
        compressionEvent = buildCompressionEvent({
          sectionIndex: contract.sectionIndex,
          trigger: triggerFromExecutionStrategy(directives.strategy),
          result: compressed,
        });
      }

      // Phase 3.6 — Emit LONGFORM_PROMPT_BUDGET BEFORE the model call so the
      // telemetry surfaces budget pressure even if the call later errors.
      const budget = computePromptBudgetReport({
        operation: 'generateLongFormSection',
        model,
        companyId: options.companyId ?? null,
        systemPrompt: system,
        userPrompt: user,
        outputBudgetTokens: maxTokens,
      });
      emitPromptBudgetTelemetry(budget);

      const startedAt = Date.now();
      try {
        const response = await runCompletionWithOperation({
          operation: 'generateLongFormSection',
          companyId: options.companyId ?? null,
          cache_version: options.cacheVersion ?? null,
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        });
        return { html: unwrapHtml(response.output), executionStrategy: directives.strategy, compressionEvent };
      } catch (err) {
        // Phase 4.5 — Identify timeout errors and emit
        // LONGFORM_SECTION_TIMEOUT so operators can see which sections
        // burn time without delivering.
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = /timeout|timed out|abort|deadline/i.test(message);
        if (isTimeout) {
          emitSectionTimeoutTelemetry({
            company_id: options.companyId ?? null,
            content_type: contract.contentType,
            section_index: contract.sectionIndex,
            attempt_number: hint?.attemptNumber ?? 1,
            model,
            operation: 'generateLongFormSection',
            word_target: directives.wordTargetOverride ?? contract.wordTarget,
            prompt_tokens_estimate: budget.total_input_tokens,
            output_budget_tokens: maxTokens,
            timeout_ms: directives.timeoutMs,
            completion_phase: 'awaiting_response',
            provider_latency_ms: Date.now() - startedAt,
            strategy: directives.strategy,
          });
        }
        throw err;
      }
    },
  };
}
