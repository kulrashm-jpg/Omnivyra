/** Part 3/3 of longFormPlanningEngine.ts — verbatim split (barrel preserved; importers unchanged). */
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { htmlToBlocks } from '../blog/htmlToBlocks';
import type { BlogGenerationRequest, BlogGenerationResult, CompanyContext } from '../blog/runBlogGeneration';
import { injectInternalLinks } from '../blog/runBlogGenerationDataAccess';
import { buildGovernanceExplainabilityMetadata } from '../../backend/services/creator/strategyGovernancePromptContext';
import {
  validateContentVariation,
  type DuplicateSectionPair,
  type LowVariationSectionIssue,
} from './contentVariationValidator';
import { contentTypeConfig, type LongFormContentType } from './longFormContentTypeConfig';
import {
  DEFAULT_CONTENT_SCORE_THRESHOLDS,
  buildSerpStructureHints,
  classifySearchIntent,
  expandTopicEntities,
  scoreLongFormContent,
  scoreNeedsRepair,
  type ContentImprovementHooks,
  type ContentScore,
  type SearchIntent,
  type SerpStructureHints,
  type TopicEntityMap,
} from './longFormSeoIntelligence';
import {
  buildDifferentiationStrategy,
  deriveContentPositioning,
  scoreDifferentiation,
  simulateCompetitorContentProfile,
  type CompetitorContentProfile,
  type ContentPositioning,
  type DifferentiationStrategy,
} from './longFormDifferentiationIntelligence';
import {
  applyPerformanceToDifferentiationStrategy,
  applyPerformanceToPositioning,
  buildPerformancePlanningDirectives,
  derivePerformanceInsights,
  extractFeatureSnapshot,
  type ContentPerformance,
  type ContentPerformanceFeatureSnapshot,
  type PerformanceInsights,
} from './longFormPerformanceLearning';
import { getLongFormTemplateSpec, type LongFormTemplateSpec } from './longFormTemplateSpecs';
// Phase 3.3 + 3.7 — Semantic repetition detection + planned-engine stability telemetry.
import { detectSemanticRepetition } from '../../backend/services/longForm/semanticRepetitionDetector';
import {
  emitPlannedEngineSuccess,
  emitPlannedEngineFailure,
  recordPlannedEngineAttempt,
  recordPlannedEngineSuccess as recordSuccessBucket,
  recordPlannedEngineFailure as recordFailureBucket,
} from '../../backend/services/longForm/plannedEngineStabilityTelemetry';
// Phase 4.1 — Adaptive recovery budget (replaces `repairedSections.length >= 3`).
import {
  computeAdaptiveRecoveryBudget,
  type AdaptiveRecoveryBudget,
  type IssueCategory,
  type IssueSeverity,
} from '../../backend/services/longForm/adaptiveRecoveryBudget';
// Phase 6.2 — Adaptive section sizing applied at plan emission time.
import {
  computeAdaptiveSectionSize,
  estimateTopicComplexity,
  estimateNarrativeDensity,
} from '../../backend/services/longForm/adaptiveSectionSizing';
// Phase 6.3 — Planner stability validation BEFORE generation begins.
import {
  validatePlannerStability,
  type PlannerStabilityResult,
} from '../../backend/services/longForm/plannerStabilityValidator';
// Phase 8.1 — Content-type stabilizer applied at planning.
import {
  getContentTypeStabilizer,
  applyPlanningStabilizer,
} from '../../backend/services/longForm/contentTypeStabilizers';
// Phase 9.1 — Self-healing actions consumed at planning.
import {
  hasActiveAction as hasActiveHealingAction,
  getActiveHealingActionsForContentType,
} from '../../backend/services/longForm/selfHealingCoordinator';
import {
  buildOrganizationPerspective,
  renderOrganizationPerspectiveForPrompt,
  type OrganizationPerspective,
} from '../../backend/services/longForm/organizationPerspectiveEngine';
import {
  validateContentDuplication,
  type ContentDuplicationValidationResult,
} from '../../backend/services/longForm/contentDuplicationValidator';

import { type ContentPlan, type SectionGenerationResult, type PlannedLongFormGenerationInput, type PlannedLongFormGenerationResult, isSeoDrivenContentType, escapeHtml, truncateAtSentence, sanitizeGeneratedArticleHtml, sanitizeContentPlan, sanitizeStoryContentPlan, inferEditorialSectionLane, laneDirective, laneForbiddenFrames } from './longFormPlanningEngineModel';
import { dedupeSectionsForPublication, ensureMinimumPublishableSections, generateContentPlan, generateSection, applyAdaptiveSizingToPlan, validateLongFormQuality, repairFailedSections } from './longFormPlanningEnginePlanning';

function buildFaqHtml(faq: ContentPlan['faq']): string {
  if (faq.length === 0) return '';
  return [
    '<h2>FAQ</h2>',
    ...faq.slice(0, 6).map((item) => (
      `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`
    )),
  ].join('\n');
}

function buildKeyInsightsHtml(items: string[]): string {
  return `<div class="key-insights"><ul>${items
    .slice(0, 5)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('')}</ul></div>`;
}

function buildReferencesHtml(sections: SectionGenerationResult[]): string {
  const references = sections.flatMap((section) => section.references || []);
  const realReferences = references.filter((reference) => reference.url && /^https?:\/\//i.test(reference.url));
  const fallbackReferences = [
    { title: 'Google Search Central: Creating helpful, reliable, people-first content', url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content' },
    { title: 'Nielsen Norman Group: Writing for the Web', url: 'https://www.nngroup.com/articles/writing-for-the-web/' },
    { title: 'McKinsey Insights: Strategy and corporate finance', url: 'https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights' },
  ];
  const outputReferences = realReferences.length >= 3
    ? realReferences
    : [...realReferences, ...fallbackReferences].filter((reference, index, all) => (
        all.findIndex((candidate) => candidate.url === reference.url) === index
      ));
  return `<h2>References</h2><ol>${outputReferences
    .slice(0, 5)
    .map((reference) => `<li><a href="${escapeHtml(reference.url)}">${escapeHtml(reference.title)}</a></li>`)
    .join('')}</ol>`;
}

function buildSeoTitle(plan: ContentPlan, topic: string): string {
  const title = plan.title || topic;
  return title.length <= 60 ? title : `${title.slice(0, 57).trim()}...`;
}

function buildSeoDescription(plan: ContentPlan): string {
  const description = plan.excerpt || plan.key_insights[0] || '';
  return description.length <= 155 ? description : `${description.slice(0, 152).trim()}...`;
}

function buildTags(input: PlannedLongFormGenerationInput): string[] {
  const fromTopic = input.topic
    .split(/\s+/)
    .map((token) => token.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter((token) => token.length > 3)
    .slice(0, 3);
  return Array.from(new Set([input.contentType, input.formatType, ...fromTopic])).slice(0, 6);
}

function closingHeadingForContentType(input: PlannedLongFormGenerationInput): string {
  if (input.contentType === 'article') return 'Closing Perspective';
  if (input.contentType === 'newsletter') return input.formatType === 'digest' || input.formatType === 'curated' ? 'Reader Takeaway' : 'What to Watch';
  if (input.contentType === 'guide') return 'Next Steps';
  if (input.contentType === 'whitepaper') return 'Executive Synthesis';
  return 'Summary';
}

function buildContentHtml(input: PlannedLongFormGenerationInput, plan: ContentPlan, sections: SectionGenerationResult[]): string {
  if (input.contentType === 'story') {
    const storyClose = input.formatType === 'episodic_story' ? 'Next' : 'Reflection';
    return sanitizeGeneratedArticleHtml([
      ...sections.map((section) => section.html),
      `<h2>${storyClose}</h2>`,
      `<p>${escapeHtml(truncateAtSentence(plan.excerpt, 420))}</p>`,
    ].filter(Boolean).join('\n\n'));
  }
  const perspective = input.organizationPerspective ?? buildOrganizationPerspective({
    topic: input.topic,
    companyContext: input.companyContext,
    selectedAngle: input.selected_angle,
    answers: input.answers,
  });
  const executiveThesis = [
    '<p>',
    escapeHtml(`${perspective.marketObservation} ${perspective.companyViewpoint}`),
    '</p>',
    '<p>',
    escapeHtml(`${perspective.strategicRecommendation} ${perspective.tradeoffAnalysis}`),
    '</p>',
    '<p>',
    escapeHtml(`For ${perspective.primaryAudience}s, the decision is not whether the topic deserves more content; it is how to turn it into clearer priorities, sharper resource allocation, measurable impact, stronger governance, and fewer execution risks. The practical implication is to decide what to stop, what to sequence, what to measure, and which operating model will make the recommendation repeatable.`),
    '</p>',
  ].join('');
  return sanitizeGeneratedArticleHtml([
    buildKeyInsightsHtml(plan.key_insights),
    executiveThesis,
    ...sections.map((section) => section.html),
    isSeoDrivenContentType(input.contentType) ? buildFaqHtml(plan.faq) : '',
    `<h2>${closingHeadingForContentType(input)}</h2>`,
    `<p>${escapeHtml(plan.excerpt)}</p>`,
    buildReferencesHtml(sections),
  ].filter(Boolean).join('\n\n'));
}

async function buildContentBlocks(input: PlannedLongFormGenerationInput, contentHtml: string): Promise<ReturnType<typeof htmlToBlocks>> {
  let contentBlocks = htmlToBlocks(contentHtml);
  contentBlocks = await injectInternalLinks(
    contentBlocks,
    input.topic.trim(),
    input.company_id,
    input.blogTable || 'blogs',
  );
  const hasInternalLinks = contentBlocks.some((block) => block.type === 'internal_link' && typeof block.slug === 'string' && block.slug.trim());
  if (!hasInternalLinks && input.contentType === 'blog') {
    contentBlocks = [
      ...contentBlocks,
      {
        id: `internal-${Date.now()}-strategy`,
        type: 'internal_link',
        slug: 'blogs',
        title: 'Related blog resources',
        excerpt: 'Connect this draft to a related Omnivyra article before publishing.',
      },
      {
        id: `internal-${Date.now()}-planning`,
        type: 'internal_link',
        slug: 'blog',
        title: 'Supporting editorial context',
        excerpt: 'Use this slot to link readers to a relevant supporting article.',
      },
    ];
  }
  return contentBlocks;
}

async function repairScoredSections(input: {
  request: PlannedLongFormGenerationInput;
  plan: ContentPlan;
  sections: SectionGenerationResult[];
  improvementHooks: ContentImprovementHooks;
  searchIntent: SearchIntent;
  serpStructureHints: SerpStructureHints;
  contentPositioning: ContentPositioning;
  differentiationStrategy: DifferentiationStrategy;
  differentiationWeakSections?: string[];
}): Promise<SectionGenerationResult[]> {
  if (input.improvementHooks.weak_sections.length === 0 && !input.differentiationWeakSections?.length) return input.sections;

  const repaired = [...input.sections];
  const strategicTitles = input.differentiationWeakSections || [];
  const fallbackStrategicTitles = input.plan.sections
    .filter((section, index) => (
      index === 0
      || section.framework_role !== 'none'
      || section.requires_opinionated_insight
      || /intro|hook|framework|model|insight|miss|mistake|verdict|implication/i.test(section.section_title)
    ))
    .map((section) => section.section_title);
  const weakTitles = new Set([
    ...input.improvementHooks.weak_sections.slice(0, 3).map((section) => section.section_title),
    ...strategicTitles,
    ...(input.differentiationWeakSections && input.differentiationWeakSections.length === 0 ? fallbackStrategicTitles.slice(0, 3) : []),
  ]);
  for (let index = 0; index < input.plan.sections.length; index += 1) {
    const planSection = input.plan.sections[index];
    if (!weakTitles.has(planSection.section_title)) continue;
    const weakHook = input.improvementHooks.weak_sections.find((section) => section.section_title === planSection.section_title);
    repaired[index] = await generateSection({
      request: input.request,
      plan: input.plan,
      section: planSection,
      priorSections: repaired.slice(0, index),
      searchIntent: input.searchIntent,
      serpStructureHints: input.serpStructureHints,
      contentPositioning: input.contentPositioning,
      differentiationStrategy: input.differentiationStrategy,
      repairReasons: [
        ...(weakHook?.reasons || []),
        input.differentiationWeakSections?.includes(planSection.section_title)
          ? 'Low differentiation: strengthen positioning, contrast, hook, framework, or insight.'
          : '',
        input.improvementHooks.missing_entities.length
          ? `Add missing entity coverage where relevant: ${input.improvementHooks.missing_entities.slice(0, 4).join(', ')}`
          : '',
      ].filter(Boolean),
    });
  }
  return repaired;
}

// Phase 7.5 — Planner-generation wrapper supporting tightening hints.
//
// The first attempt calls `generateContentPlan` unchanged. Subsequent
// attempts inject a tightening hint into the planner's `input.answers`
// so the LLM produces a cleaner plan on the retry. Hints stay within
// the existing planner contract — no provider redesign.
function duplicateRepairTargets(
  report: ContentDuplicationValidationResult,
  sections: SectionGenerationResult[],
): number[] {
  const titleToIndex = new Map<string, number>();
  sections.forEach((section, index) => titleToIndex.set(section.section_title.toLowerCase().trim(), index));
  const targets = new Set<number>();

  for (const pair of report.repeatedParagraphPairs) {
    const index = titleToIndex.get(pair.b.toLowerCase().trim());
    if (index != null) targets.add(index);
  }
  for (const pair of report.repeatedSectionPairs) {
    const index = titleToIndex.get(pair.b.toLowerCase().trim());
    if (index != null) targets.add(index);
  }
  for (const frame of report.repeatedConceptFrames) {
    for (const title of frame.sections.slice(1)) {
      const index = titleToIndex.get(title.toLowerCase().trim());
      if (index != null) targets.add(index);
    }
  }
  for (const group of report.repeatedParagraphStemGroups) {
    for (const title of group.sections.slice(1)) {
      const index = titleToIndex.get(title.toLowerCase().trim());
      if (index != null) targets.add(index);
    }
  }
  for (const restart of report.repeatedHookRestarts) {
    const index = titleToIndex.get(restart.section.toLowerCase().trim());
    if (index != null) targets.add(index);
  }

  return [...targets]
    .filter((index) => index >= 0 && index < sections.length)
    .sort((a, b) => a - b)
    .slice(0, 3);
}

async function repairDuplicateOutcomeSections(input: {
  request: PlannedLongFormGenerationInput;
  plan: ContentPlan;
  sections: SectionGenerationResult[];
  duplication: ContentDuplicationValidationResult;
  searchIntent: SearchIntent;
  serpStructureHints: SerpStructureHints;
  contentPositioning: ContentPositioning;
  differentiationStrategy: DifferentiationStrategy;
}): Promise<SectionGenerationResult[]> {
  const targets = duplicateRepairTargets(input.duplication, input.sections);
  if (targets.length === 0) return input.sections;

  const repaired = [...input.sections];
  for (const index of targets) {
    const planSection = input.plan.sections[index];
    if (!planSection) continue;
    const lane = inferEditorialSectionLane(planSection, index);
    repaired[index] = await generateSection({
      request: input.request,
      plan: input.plan,
      section: planSection,
      priorSections: repaired.slice(0, index),
      searchIntent: input.searchIntent,
      serpStructureHints: input.serpStructureHints,
      contentPositioning: input.contentPositioning,
      differentiationStrategy: input.differentiationStrategy,
      repairReasons: [
        'Final publication duplication gate failed.',
        `Rewrite this section as a distinct ${lane} section.`,
        laneDirective(lane),
        laneForbiddenFrames(lane),
        input.duplication.repeatedParagraphStems.length
          ? `Avoid these repeated paragraph opening signatures: ${input.duplication.repeatedParagraphStems.slice(0, 5).join(' | ')}.`
          : '',
        'Do not reuse the same idea, paragraph role, example pattern, or executive decision frame from earlier sections.',
      ].filter(Boolean),
    });
  }

  return dedupeSectionsForPublication(input.request, input.plan, repaired);
}

async function attemptPlannerGeneration(args: {
  input: PlannedLongFormGenerationInput;
  templateSpec: LongFormTemplateSpec | null;
  searchIntent: SearchIntent;
  topicEntityMap: TopicEntityMap;
  serpStructureHints: SerpStructureHints;
  contentPositioning: ContentPositioning;
  competitorContentProfile: CompetitorContentProfile;
  differentiationStrategy: DifferentiationStrategy;
  performanceInsights: PerformanceInsights;
  tighteningHint?: {
    fewerSections: boolean;
    reduceOverlap: boolean;
    tighterComplexity: boolean;
    previousIssues?: string[];
  };
}): Promise<ContentPlan> {
  if (!args.tighteningHint) {
    return await generateContentPlan(
      args.input,
      args.templateSpec,
      args.searchIntent,
      args.topicEntityMap,
      args.serpStructureHints,
      args.contentPositioning,
      args.competitorContentProfile,
      args.differentiationStrategy,
      args.performanceInsights,
    );
  }
  // Inject tightening into answers so the planner's prompt sees them.
  const hint = args.tighteningHint;
  const tighteningLines: string[] = [];
  if (hint.fewerSections) tighteningLines.push('Emit fewer, more focused sections than your typical default.');
  if (hint.reduceOverlap) tighteningLines.push('Each section must address a distinct angle — no two sections may share more than 25% of their key_points.');
  if (hint.tighterComplexity) tighteningLines.push('Keep each section\'s key_points concise (3–5 points max). Avoid over-loading a single section.');
  if (hint.previousIssues && hint.previousIssues.length > 0) {
    tighteningLines.push(`The previous plan failed validation with: ${hint.previousIssues.slice(0, 4).join(' | ')}. Avoid these specific failure modes.`);
  }
  const augmentedInput: PlannedLongFormGenerationInput = {
    ...args.input,
    answers: {
      ...(args.input.answers ?? {}),
      planner_regeneration_hint: tighteningLines.join(' '),
    },
  };
  return await generateContentPlan(
    augmentedInput,
    args.templateSpec,
    args.searchIntent,
    args.topicEntityMap,
    args.serpStructureHints,
    args.contentPositioning,
    args.competitorContentProfile,
    args.differentiationStrategy,
    args.performanceInsights,
  );
}

export async function runPlannedLongFormGeneration(
  input: PlannedLongFormGenerationInput,
): Promise<PlannedLongFormGenerationResult> {
  // Phase 3.7 — Stability telemetry instrumentation (start).
  const __plannedStart = Date.now();
  recordPlannedEngineAttempt(input.contentType);
  let __failurePhase: 'planning' | 'section_generation' | 'quality_validation' | 'post_integrity' | 'unknown' = 'planning';
  let __partialSectionsCompleted = 0;

  try {
  const templateSpec = getLongFormTemplateSpec(input.contentType, input.formatType, input.template_name);
  const searchIntent = classifySearchIntent({
    topic: input.topic,
    contentType: input.contentType,
    formatType: input.formatType,
    intent: input.intent,
    goalType: input.goal_type,
  });
  const topicEntityMap = expandTopicEntities({
    topic: input.topic,
    contentType: input.contentType,
    formatType: input.formatType,
    cluster: input.cluster,
    seoContext: input.seoContext,
    companyContext: input.companyContext,
  });
  const serpStructureHints = buildSerpStructureHints(searchIntent);
  const performanceInsights = input.performanceInsights || derivePerformanceInsights({
    performance: input.contentPerformance || [],
    featureSnapshots: input.performanceFeatureSnapshots || [],
  });
  const contentPositioning = applyPerformanceToPositioning(deriveContentPositioning({
    topic: input.topic,
    contentType: input.contentType,
    formatType: input.formatType,
    searchIntent,
    companyContext: input.companyContext,
  }), performanceInsights);
  const competitorContentProfile = simulateCompetitorContentProfile({
    topic: input.topic,
    searchIntent,
    positioning: contentPositioning,
  });
  const differentiationStrategy = applyPerformanceToDifferentiationStrategy(buildDifferentiationStrategy({
    topic: input.topic,
    positioning: contentPositioning,
    competitorProfile: competitorContentProfile,
    companyContext: input.companyContext,
  }), performanceInsights);
  // ── Phase 7.5 — Plan generation with auto-regeneration on instability ──
  // Wrap the planner LLM call + adaptive sizing + stability check in a
  // bounded retry loop. Up to MAX_PLANNER_REGENERATIONS attempts are made
  // with tightened prompts; only after the budget is exhausted do we
  // throw and let the facade fall back.
  const MAX_PLANNER_REGENERATIONS = 2;
  const articleWordTarget = (() => {
    const tw = input.answers?.target_word_count ?? input.targetWordCount;
    if (typeof tw === 'string') return Number.parseInt(tw, 10) || 1200;
    if (typeof tw === 'number') return tw;
    return 1200;
  })();
  const groundingFragmentCount = input.groundingProfile?.approvedSources.reduce(
    (sum, src) => sum + src.contentFragments.length,
    0,
  ) ?? 0;

  let plan: ContentPlan | null = null;
  let stability: PlannerStabilityResult | null = null;
  const plannerAttemptHistory: Array<{
    attempt: number;
    stabilityScore: number;
    recommendation: PlannerStabilityResult['recommendation'];
    reasoning: string;
  }> = [];

  for (let plannerAttempt = 0; plannerAttempt <= MAX_PLANNER_REGENERATIONS; plannerAttempt += 1) {
    // The first attempt uses the base planner; subsequent attempts apply
    // tightening (fewer sections, reduced overlap, lower complexity).
    const tighteningHint = plannerAttempt === 0
      ? undefined
      : {
          fewerSections: true,
          reduceOverlap: true,
          tighterComplexity: true,
          previousIssues: stability?.invalidSections.map((s) => `${s.sectionTitle}: ${s.reasons.join(', ')}`)
            .concat(stability?.sequencingIssues ?? []),
        };
    const rawPlan = await attemptPlannerGeneration({
      input,
      templateSpec,
      searchIntent,
      topicEntityMap,
      serpStructureHints,
      contentPositioning,
      competitorContentProfile,
      differentiationStrategy,
      performanceInsights,
      tighteningHint,
    });

    // Apply adaptive section sizing on each attempt.
    const sizedPlan = applyAdaptiveSizingToPlan(rawPlan, {
      articleWordTarget,
      contentType: input.contentType,
      groundingFragmentCount,
    });
    plan = input.contentType === 'story'
      ? sanitizeStoryContentPlan(sizedPlan, input.topic, input.formatType, input.companyContext?.companyName || 'the brand')
      : sanitizeContentPlan(sizedPlan, input);

    // Stability check.
    stability = validatePlannerStability({
      plan,
      contentType: input.contentType,
      articleTargetWords: articleWordTarget,
    });
    plannerAttemptHistory.push({
      attempt: plannerAttempt + 1,
      stabilityScore: stability.stabilityScore,
      recommendation: stability.recommendation,
      reasoning: stability.reasoning.join(' '),
    });

    if (stability.recommendation === 'accept' || stability.recommendation === 'accept_with_warnings') {
      break; // good plan; proceed to section generation
    }

    if (stability.recommendation === 'reject') {
      recordFailureBucket(input.contentType, `planner stability reject (attempt ${plannerAttempt + 1}): ${stability.reasoning.join(' ')}`);
      emitPlannedEngineFailure({
        company_id: input.company_id ?? null,
        content_type: input.contentType,
        topic: input.topic,
        failure_phase: 'planning',
        reason: `planner_stability_reject_after_${plannerAttempt + 1}_attempts: ${stability.reasoning.join(' ')}`,
        partial_sections_completed: 0,
        duration_ms: Math.max(0, Date.now() - __plannedStart),
      });
      throw new Error(
        `[longFormPlanningEngine] Plan rejected by stability validator after ${plannerAttempt + 1} attempt(s): ${stability.reasoning.join(' ')}`,
      );
    }

    // regenerate_plan: try again if budget allows.
    if (plannerAttempt >= MAX_PLANNER_REGENERATIONS) {
      recordFailureBucket(input.contentType, `planner stability exhausted after ${MAX_PLANNER_REGENERATIONS + 1} attempts`);
      emitPlannedEngineFailure({
        company_id: input.company_id ?? null,
        content_type: input.contentType,
        topic: input.topic,
        failure_phase: 'planning',
        reason: `planner_stability_exhausted_after_${MAX_PLANNER_REGENERATIONS + 1}_attempts: ${stability.reasoning.join(' ')}`,
        partial_sections_completed: 0,
        duration_ms: Math.max(0, Date.now() - __plannedStart),
      });
      throw new Error(
        `[longFormPlanningEngine] Plan regeneration budget exhausted after ${MAX_PLANNER_REGENERATIONS + 1} attempt(s): ${stability.reasoning.join(' ')}`,
      );
    }
  }
  // The loop guarantees `plan` is non-null on a clean exit.
  if (!plan || !stability) {
    throw new Error('[longFormPlanningEngine] Planner loop exited without a plan (should not happen).');
  }

  __failurePhase = 'section_generation';
  const generatedSections: SectionGenerationResult[] = [];

  for (const section of plan.sections) {
    generatedSections.push(await generateSection({
      request: input,
      plan,
      section,
      priorSections: generatedSections,
      searchIntent,
      serpStructureHints,
      contentPositioning,
      differentiationStrategy,
    }));
    __partialSectionsCompleted = generatedSections.length;
  }

  __failurePhase = 'quality_validation';
  const initialReport = validateLongFormQuality(plan, generatedSections, input.contentType);
  // Phase 4.1 — Adaptive recovery budget replaces the prior fixed
  // `repairedSections.length >= 3` cap. Budget is shared back into the
  // quality report's repairedSections field for telemetry visibility.
  let { sections, report } = await repairFailedSections(
    input,
    plan,
    generatedSections,
    initialReport,
    searchIntent,
    serpStructureHints,
    contentPositioning,
    differentiationStrategy,
    __plannedStart,
  );
  sections = dedupeSectionsForPublication(input, plan, ensureMinimumPublishableSections(
    input,
    plan,
    dedupeSectionsForPublication(input, plan, sections),
  ));
  let contentHtml = buildContentHtml(input, plan, sections);
  let contentBlocks = await buildContentBlocks(input, contentHtml);
  let scoring = scoreLongFormContent({
    plan,
    sections,
    contentHtml,
    contentBlocks,
    contentType: input.contentType,
    searchIntent,
    topicEntityMap,
    companyContext: input.companyContext,
    performanceInsights,
  });
  let differentiation = scoreDifferentiation({
    plan,
    sections,
    positioning: contentPositioning,
    competitorProfile: competitorContentProfile,
    differentiationStrategy,
  });
  scoring = {
    ...scoring,
    contentScore: {
      ...scoring.contentScore,
      differentiation: differentiation.score,
      overall: Math.round((scoring.contentScore.overall * 0.9) + (differentiation.score * scoring.contentScore.performanceWeight.differentiation)),
    },
  };

  if (scoreNeedsRepair(scoring.contentScore, DEFAULT_CONTENT_SCORE_THRESHOLDS) || scoring.contentScore.differentiation < 72) {
    sections = await repairScoredSections({
      request: input,
      plan,
      sections,
      improvementHooks: scoring.improvementHooks,
      searchIntent,
      serpStructureHints,
      contentPositioning,
      differentiationStrategy,
      differentiationWeakSections: scoring.contentScore.differentiation < 72 ? differentiation.weakSections : undefined,
    });
    sections = dedupeSectionsForPublication(input, plan, ensureMinimumPublishableSections(
      input,
      plan,
      dedupeSectionsForPublication(input, plan, sections),
    ));
    contentHtml = buildContentHtml(input, plan, sections);
    contentBlocks = await buildContentBlocks(input, contentHtml);
    report = {
      ...validateLongFormQuality(plan, sections, input.contentType),
      repairedSections: [
        ...report.repairedSections,
        ...scoring.improvementHooks.weak_sections.slice(0, 3).map((section) => section.section_title),
      ],
    };
    scoring = scoreLongFormContent({
      plan,
      sections,
      contentHtml,
      contentBlocks,
      contentType: input.contentType,
      searchIntent,
      topicEntityMap,
      companyContext: input.companyContext,
      performanceInsights,
    });
    differentiation = scoreDifferentiation({
      plan,
      sections,
      positioning: contentPositioning,
      competitorProfile: competitorContentProfile,
      differentiationStrategy,
    });
    scoring = {
      ...scoring,
      contentScore: {
        ...scoring.contentScore,
        differentiation: differentiation.score,
        overall: Math.round((scoring.contentScore.overall * 0.9) + (differentiation.score * scoring.contentScore.performanceWeight.differentiation)),
      },
    };
  }
  __failurePhase = 'post_integrity';
  let finalDuplication = validateContentDuplication(contentHtml);
  if (!finalDuplication.passed) {
    sections = await repairDuplicateOutcomeSections({
      request: input,
      plan,
      sections,
      duplication: finalDuplication,
      searchIntent,
      serpStructureHints,
      contentPositioning,
      differentiationStrategy,
    });
    contentHtml = buildContentHtml(input, plan, sections);
    contentBlocks = await buildContentBlocks(input, contentHtml);
    report = {
      ...validateLongFormQuality(plan, sections, input.contentType),
      repairedSections: [
        ...report.repairedSections,
        'final duplicate outcome repair',
      ],
    };
    scoring = scoreLongFormContent({
      plan,
      sections,
      contentHtml,
      contentBlocks,
      contentType: input.contentType,
      searchIntent,
      topicEntityMap,
      companyContext: input.companyContext,
      performanceInsights,
    });
    differentiation = scoreDifferentiation({
      plan,
      sections,
      positioning: contentPositioning,
      competitorProfile: competitorContentProfile,
      differentiationStrategy,
    });
    scoring = {
      ...scoring,
      contentScore: {
        ...scoring.contentScore,
        differentiation: differentiation.score,
        overall: Math.round((scoring.contentScore.overall * 0.9) + (differentiation.score * scoring.contentScore.performanceWeight.differentiation)),
      },
    };
    finalDuplication = validateContentDuplication(contentHtml);
  }
  if (!finalDuplication.passed) {
    throw new Error(
      `[longFormPlanningEngine] Publication blocked: duplicate sections remain (${finalDuplication.issues.join('; ') || 'duplication score above threshold'}).`,
    );
  }
  const generatedFeatureSnapshot = extractFeatureSnapshot({
    content_id: `${input.contentType}:${input.topic}`,
    plan,
    sections,
    positioning: contentPositioning,
  });

  // Phase 3.7 — Stability telemetry: planned-engine success.
  const sectionsFailed = 0; // planner-path doesn't track this directly; the orchestrator does.
  recordSuccessBucket(input.contentType);
  emitPlannedEngineSuccess({
    company_id: input.company_id ?? null,
    content_type: input.contentType,
    topic: input.topic,
    total_sections: sections.length,
    sections_passed: sections.length - sectionsFailed,
    sections_failed: sectionsFailed,
    total_retries: report.repairedSections.length,
    avg_retries_per_section: sections.length > 0
      ? Number((report.repairedSections.length / sections.length).toFixed(3))
      : 0,
    duration_ms: Math.max(0, Date.now() - __plannedStart),
    final_lifecycle_state: report.issues.length === 0 ? 'article_completed' : 'article_recovered',
  });

  return {
    contentPlan: plan,
    qualityReport: report,
    searchIntent,
    topicEntityMap,
    serpStructureHints,
    contentPositioning,
    competitorContentProfile,
    differentiationStrategy,
    contentScore: scoring.contentScore,
    improvementHooks: scoring.improvementHooks,
    performanceInsights,
    generatedFeatureSnapshot,
    generation: {
      needs_clarification: false,
      mode: 'full',
      confidence: report.issues.length === 0 ? 'high' : 'medium',
      result: {
        title: plan.title,
        excerpt: plan.excerpt,
        content_html: contentHtml,
        tags: buildTags(input),
        category: input.contentType,
        seo_meta_title: buildSeoTitle(plan, input.topic),
        seo_meta_description: buildSeoDescription(plan),
        key_insights: plan.key_insights,
        content_blocks: contentBlocks,
      },
      hook_assessment: {
        strength: report.issues.length === 0 ? 'strong' : 'moderate',
        note: report.issues.length === 0
          ? 'Generated section-by-section from a validated content plan.'
          : `Generated with quality repairs; review remaining issues: ${report.issues.join('; ')}`,
      },
      template_used: Boolean(templateSpec),
      governance: buildGovernanceExplainabilityMetadata(null),
    },
  };
  } catch (error) {
    // Phase 3.7 — Stability telemetry: planned-engine failure.
    const reason = error instanceof Error ? error.message : String(error);
    const reasonStack = error instanceof Error ? error.stack : undefined;
    recordFailureBucket(input.contentType, reason);
    emitPlannedEngineFailure({
      company_id: input.company_id ?? null,
      content_type: input.contentType,
      topic: input.topic,
      failure_phase: __failurePhase,
      reason,
      reason_stack: reasonStack,
      partial_sections_completed: __partialSectionsCompleted,
      duration_ms: Math.max(0, Date.now() - __plannedStart),
    });
    throw error;
  }
}

