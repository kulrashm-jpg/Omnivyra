/** Part 2/3 of longFormPlanningEngine.ts — verbatim split (barrel preserved; importers unchanged). */
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

import { type ContentPlanSection, type ContentPlan, type SectionGenerationResult, type LongFormQualityReport, type PlannedLongFormGenerationInput, isSeoDrivenContentType, stripCodeFence, stripHtml, countWords, escapeHtml, normalizeList, uniqueKeyPoints, pickSectionEntities, buildFallbackPlan, normalizeBlogSubject, excerptLimitForContentType, truncateAtSentence, sanitizeEditorialScaffoldingText, sanitizeStoryScaffoldingText, normalizeSectionText, tokenOverlap, paragraphTextsFromHtml, paragraphOpeningSignature, inferEditorialSectionLane, laneDirective, laneForbiddenFrames, buildSectionDepthExpansion } from './longFormPlanningEngineModel';

function buildStorySectionDepthExpansion(args: {
  sectionTitle: string;
  topic: string;
  formatType: string;
  index: number;
}): string {
  if (args.formatType === 'episodic_story') {
    return `<p>The last note from the previous episode still hangs in the room. Someone has moved on in public, but the unfinished question keeps shaping small choices: the message left unsent, the dashboard reopened after hours, the careful pause before a customer call.</p><p>This beat needs one new turn. A detail changes the pressure: a reply arrives later than expected, a draft comes back marked up, or a familiar phrase suddenly means something different. The episode should advance by consequence, not by explaining the premise again.</p>`;
  }
  if (args.formatType === 'long_story') {
    return `<p>The room does not change all at once. It changes in small signals: the question nobody answers quickly, the slide that stays open after the meeting, the quiet recognition that the old explanation no longer fits what people are seeing.</p><p>That is where the story earns its depth. A person or team has to choose what to carry forward and what to leave behind. The choice should feel visible in behavior, not announced as advice.</p>`;
  }
  return `<p>Someone notices the tension before they can explain it. It might be a customer question that lands too sharply, a team member rereading the same line, or a quiet moment after a meeting when the easy answer stops feeling true.</p><p>The turn comes through action: a pause, a revision, a different question, a decision made with less certainty but more honesty. The reader should remember the moment before they remember the lesson.</p>`;
}

function sanitizeSectionHtml(
  section: SectionGenerationResult,
  fallbackTitle: string,
  context: {
    topic: string;
    contentType: LongFormContentType;
    formatType: string;
    frameworkName: string;
    perspective: OrganizationPerspective;
    planSection?: ContentPlanSection;
    index: number;
  },
): SectionGenerationResult {
  const safeTitle = context.contentType === 'story'
    ? sanitizeStoryScaffoldingText(section.section_title, fallbackTitle)
    : sanitizeEditorialScaffoldingText(section.section_title, fallbackTitle);
  let html = section.html
    .replace(/<h2\b([^>]*)>[\s\S]*?<\/h2>/i, `<h2$1>${escapeHtml(safeTitle)}</h2>`)
    .replace(/<h[3-6]\b[^>]*>\s*(Opening\s+Thesis|Hook\s+Intro)\s*<\/h[3-6]>/gi, '')
    .replace(/\bOpening\s+Thesis\s*:?\s*/gi, '')
    .replace(/\bHook\s+Intro\s*:?\s*/gi, '')
    .replace(/\bH2-led\s+editorial\s+body\s+with\s+key\s+insights?(?:,\s*summary,\s*and\s*references)?\b/gi, 'executive thought-leadership argument')
    .replace(/\bA\s+Practical\s+H2-led\s+editorial\s+body\s+with\s+key\s+insights?(?:,\s*summary,\s*and\s*references)?\b/gi, 'An executive perspective');
  if (context.contentType === 'story') {
    html = sanitizeStoryScaffoldingText(html, html)
      .replace(/<p>[^<]*(?:Decision criteria|article asks leaders|executive standard|buyer urgency|operational ownership|proof requirements|downstream impact)[^<]*<\/p>/gi, '')
      .replace(/\bexecutive\s+decision\s+frame\b/gi, 'story beat')
      .replace(/\bleaders\s+to\s+act\b/gi, 'someone to choose');
  }
  const paragraphCount = (html.match(/<p\b/gi) ?? []).length;
  if (paragraphCount < 3 || countWords(html) < 280) {
    html += context.contentType === 'story'
      ? buildStorySectionDepthExpansion({
          sectionTitle: safeTitle,
          topic: context.topic,
          formatType: context.formatType,
          index: context.index,
        })
      : buildSectionDepthExpansion({ ...context, sectionTitle: safeTitle });
  }
  return {
    ...section,
    section_title: safeTitle,
    html,
  };
}

export function dedupeSectionsForPublication(
  input: PlannedLongFormGenerationInput,
  plan: ContentPlan,
  sections: SectionGenerationResult[],
): SectionGenerationResult[] {
  const kept: SectionGenerationResult[] = [];
  const seenTitles = new Set<string>();
  const seenBodies: Array<Set<string>> = [];
  const perspective = input.organizationPerspective ?? buildOrganizationPerspective({
    topic: input.topic,
    companyContext: input.companyContext,
    selectedAngle: input.selected_angle,
    answers: input.answers,
  });
  for (const section of sections) {
    const planSection = plan.sections.find((candidate) => (
      candidate.section_title.toLowerCase().trim() === section.section_title.toLowerCase().trim()
    )) ?? plan.sections[kept.length];
    const sanitized = sanitizeSectionHtml(section, `Section ${kept.length + 1}`, {
      topic: input.topic,
      contentType: input.contentType,
      formatType: input.formatType,
      frameworkName: plan.framework.name,
      perspective,
      planSection,
      index: kept.length,
    });
    const titleKey = sanitized.section_title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const tokens = normalizeSectionText(sanitized.html);
    const duplicateTitle = titleKey.length > 0 && seenTitles.has(titleKey);
    const duplicateBody = seenBodies.some((existing) => tokenOverlap(existing, tokens) >= 0.42);
    if (duplicateTitle || duplicateBody) continue;
    kept.push(sanitized);
    if (titleKey) seenTitles.add(titleKey);
    seenBodies.push(tokens);
  }
  return kept.length > 0
    ? kept
    : sections.map((section, index) => sanitizeSectionHtml(section, `Section ${index + 1}`, {
        topic: input.topic,
        contentType: input.contentType,
        formatType: input.formatType,
        frameworkName: plan.framework.name,
        perspective,
        planSection: plan.sections[index],
        index,
      }));
}

function buildSupplementalSection(input: PlannedLongFormGenerationInput, plan: ContentPlan, index: number): SectionGenerationResult {
  if (input.contentType === 'story') {
    const labels = input.formatType === 'episodic_story'
      ? ['Where We Left Off', 'The New Complication', 'What Remains Unanswered']
      : input.formatType === 'long_story'
      ? ['The Scene That Made It Real', 'The Pressure That Changed the Choice', 'What Stayed Afterward']
      : ['The Moment It Became Real', 'The Turn', 'What Stayed With Them'];
    const title = labels[index] || `Story Beat ${index + 1}`;
    const body = index === 0
      ? `<p>The first sign is small enough to miss: a pause after a customer question, a draft left open, a team member checking the same number twice. Nothing dramatic has happened yet, but the room already knows the easy answer will not hold.</p><p>That moment gives the story its weight. The reader should be able to picture who is there, what object or sentence carries the tension, and why nobody moves quite as quickly as they did before.</p>`
      : index === 1
        ? `<p>The turn arrives through recognition rather than announcement. Someone sees the cost of pretending the old path still works, and the next choice becomes smaller, clearer, and harder to avoid.</p><p>What changes is not only the plan. It is the way people speak, the question they ask first, or the detail they refuse to overlook again.</p>`
        : `<p>Afterward, the memory does not behave like a conclusion. It returns as a check on future choices: slower in the right places, sharper where the risk used to be hidden, and more honest about what the moment revealed.</p><p>The story closes best when the consequence is visible. A person acts differently because of what happened, and the reader understands why that difference matters.</p>`;
    return {
      section_title: title,
      html: `<h2>${title}</h2>${body}`,
    };
  }
  const normalizedSubject = normalizeBlogSubject(input.topic);
  const subject = escapeHtml(normalizedSubject.display.toLowerCase());
  const audience = escapeHtml(normalizedSubject.audience || 'the buyer');
  const framework = escapeHtml(plan.framework.name);
  const title = index === 0
    ? 'Decision Criteria'
    : index === 1
      ? 'Implementation Risks'
      : 'What Leaders Should Do Next';
  const body = index === 0
    ? `<p>Decision criteria make ${subject} concrete before the article asks leaders to act. Compare buyer urgency, cost of delay, operational ownership, proof requirements, and downstream impact so every option is judged against the same executive standard.</p><p>The practical test is whether the team can name what success looks like for ${audience}, who owns the next move, which tradeoff is acceptable, and what signal would change the recommendation. Without that discipline, the decision stays abstract and every option sounds equally reasonable.</p>`
    : index === 1
      ? `<p>${subject} often fails when teams treat buyer education as the whole strategy. The common failure mode is moving from awareness to execution without clarifying the constraints, proof standards, buying triggers, and operational risks that shape the decision.</p><p>Use the ${framework} to decide what must be sequenced first, what should be avoided, and which risks need executive attention before the work scales. The goal is to slow weak execution without slowing the larger market-entry decision.</p>`
      : `<p>The next move is to turn ${subject} into a short operating brief: the buyer decision to influence, the risk to manage, the proof standard to meet, and the owner responsible for the next iteration.</p><p>That keeps the work grounded in action rather than another generic overview. It also gives leaders a review mechanism, so progress can be inspected without reopening the entire strategy every week.</p>`;
  return {
    section_title: title,
    html: `<h2>${title}</h2>${body}`,
  };
}

export function ensureMinimumPublishableSections(
  input: PlannedLongFormGenerationInput,
  plan: ContentPlan,
  sections: SectionGenerationResult[],
): SectionGenerationResult[] {
  const next = [...sections];
  let guard = 0;
  while (next.length < 3 && guard < 3) {
    next.push(buildSupplementalSection(input, plan, guard));
    guard += 1;
  }
  return next;
}

function parsePlan(
  raw: string,
  input: PlannedLongFormGenerationInput,
  templateSpec: LongFormTemplateSpec | null,
  topicEntityMap: TopicEntityMap,
  searchIntent: SearchIntent,
  serpStructureHints: SerpStructureHints,
  contentPositioning: ContentPositioning,
  differentiationStrategy: DifferentiationStrategy,
): ContentPlan {
  try {
    const parsed = JSON.parse(stripCodeFence(raw));
    const fallback = buildFallbackPlan(input, templateSpec, topicEntityMap, searchIntent, serpStructureHints, contentPositioning, differentiationStrategy);
    const sections = normalizePlanSections(parsed.sections, fallback.sections, input, topicEntityMap);
    const framework = parsed.framework && typeof parsed.framework === 'object'
      ? {
          name: String(parsed.framework.name || fallback.framework.name),
          model_type: ['steps', 'layers', 'system', 'matrix'].includes(parsed.framework.model_type)
            ? parsed.framework.model_type
            : fallback.framework.model_type,
          components: normalizeList(parsed.framework.components, fallback.framework.components).slice(0, 6),
          section_title: String(parsed.framework.section_title || sections[1]?.section_title || fallback.framework.section_title),
        }
      : fallback.framework;
    const faq = Array.isArray(parsed.faq)
      ? parsed.faq
          .map((item: any) => ({
            question: String(item?.question || '').trim(),
            answer: String(item?.answer || '').trim(),
          }))
          .filter((item: { question: string; answer: string }) => item.question && item.answer)
          .slice(0, 6)
      : fallback.faq;

    return {
      title: String(parsed.title || fallback.title).slice(0, 140),
      excerpt: truncateAtSentence(String(parsed.excerpt || fallback.excerpt), excerptLimitForContentType(input.contentType)),
      key_insights: normalizeList(parsed.key_insights, fallback.key_insights).slice(0, 5),
      sections,
      framework,
      faq: faq.length >= 4 ? faq : fallback.faq,
      evidence_plan: normalizeList(parsed.evidence_plan, fallback.evidence_plan).slice(0, 6),
    };
  } catch {
    return buildFallbackPlan(input, templateSpec, topicEntityMap, searchIntent, serpStructureHints, contentPositioning, differentiationStrategy);
  }
}

function normalizePlanSections(
  rawSections: unknown,
  fallbackSections: ContentPlanSection[],
  input: PlannedLongFormGenerationInput,
  topicEntityMap: TopicEntityMap,
): ContentPlanSection[] {
  const targetWordCount = input.targetWordCount || Number(input.answers?.target_word_count) || 1200;
  const parsed = Array.isArray(rawSections) ? rawSections : [];
  const sections = parsed
    .map((section: any, index): ContentPlanSection => ({
      section_title: String(section?.section_title || fallbackSections[index]?.section_title || `Section ${index + 1}`).trim(),
      section_goal: String(section?.section_goal || fallbackSections[index]?.section_goal || 'Advance a distinct part of the argument.').trim(),
      unique_angle: String(section?.unique_angle || fallbackSections[index]?.unique_angle || 'Add new information not covered elsewhere.').trim(),
      key_points: normalizeList(section?.key_points, fallbackSections[index]?.key_points || ['Develop a distinct reader takeaway.']).slice(0, 6),
      content_type: String(section?.content_type || fallbackSections[index]?.content_type || 'explanation').trim(),
      depth_requirement: String(section?.depth_requirement || fallbackSections[index]?.depth_requirement || 'Provide specific, useful detail.').trim(),
      word_target: Math.max(120, Number(section?.word_target) || fallbackSections[index]?.word_target || Math.round(targetWordCount / Math.max(4, parsed.length || fallbackSections.length))),
      requires_direct_answer: Boolean(section?.requires_direct_answer ?? fallbackSections[index]?.requires_direct_answer),
      requires_opinionated_insight: Boolean(section?.requires_opinionated_insight ?? fallbackSections[index]?.requires_opinionated_insight),
      framework_role: ['introduce', 'apply', 'none'].includes(section?.framework_role)
        ? section.framework_role
        : fallbackSections[index]?.framework_role || 'none',
      target_entities: normalizeList(section?.target_entities, fallbackSections[index]?.target_entities || pickSectionEntities(topicEntityMap, index)).slice(0, 4),
    }))
    .filter((section) => section.section_title && section.section_goal)
    .slice(0, 8);

  return uniqueKeyPoints(sections.length >= 4 ? sections : fallbackSections);
}

export async function generateContentPlan(
  input: PlannedLongFormGenerationInput,
  templateSpec: LongFormTemplateSpec | null,
  searchIntent: SearchIntent,
  topicEntityMap: TopicEntityMap,
  serpStructureHints: SerpStructureHints,
  contentPositioning: ContentPositioning,
  competitorContentProfile: CompetitorContentProfile,
  differentiationStrategy: DifferentiationStrategy,
  performanceInsights: PerformanceInsights,
): Promise<ContentPlan> {
  const config = contentTypeConfig[input.contentType];
  const targetWordCount = input.targetWordCount || Number(input.answers?.target_word_count) || 1200;
  const fallback = buildFallbackPlan(input, templateSpec, topicEntityMap, searchIntent, serpStructureHints, contentPositioning, differentiationStrategy);
  const organizationPerspective = input.organizationPerspective ?? buildOrganizationPerspective({
    topic: input.topic,
    companyContext: input.companyContext,
    selectedAngle: input.selected_angle,
    answers: input.answers,
  });
  const planningRules = (() => {
    if (input.contentType === 'story') return `Story planning rules:
- Plan a narrative, not an article.
- Use story beat headings aligned to the selected format: scene, friction, turn, aftermath, reflection, or cliffhanger.
- Do not plan Key Insights, FAQ, References, executive thesis, decision framework, or generic advice sections.
- Every section must move the story forward through character/team, tension, choice, consequence, and meaning.
- Every story needs a believable protagonist or team: founder, operator, customer, buyer, manager, or internal team.
- Include anecdotal material: a small incident, observed detail, remembered line, mistake, hesitation, tradeoff, or moment after the meeting/call/campaign.
- Make the subject feel experienced by someone, not explained by an article narrator.
- The lesson should emerge from the narrative; do not make it sound like SEO content or a business guide.`;
    const shared = `Thought-leadership planning rules:
- The plan must cover explanation, application, examples, and insights.
- SEO-driven content requires 4-6 FAQ questions with direct concise answers.
- At least two sections must set requires_direct_answer=true.
- At least two sections must set requires_opinionated_insight=true.
- Include one named framework with model_type and components.
- The named framework must be proprietary to the organization. It cannot be a generic SEO structure or common best-practice list.
- Plan around the ORGANIZATIONAL POV LAYER. Every section must carry one of: company viewpoint, market observation, strategic recommendation, tradeoff analysis, proprietary insight.
- The primary reader must be one executive audience: Founder, CEO, CMO, VP, Director, Department Head, or Strategic Buyer.
- Reject generic educational explainers. The plan must read as company-authored thought leadership.
- The article must have an executive thesis before the first major section, then sections that develop one argument rather than a list of loosely related headings.
- Avoid duplicate section substance. Each section needs a distinct job: diagnosis, model, tradeoff, decision criteria, operating implication, or executive action.`;
    if (input.contentType === 'article') return `${shared}
Article-specific rules:
- Plan an editorial article, not a guide, newsletter, or blog template.
- Headings must sound like article sections: lede, context, analysis, counterpoint, implication, closing perspective.
- The title must be article-native and complete; do not use "guide", "playbook", "newsletter", "whitepaper", "executive perspective", or template labels unless the topic itself requires it.
- The excerpt must end on a complete sentence and preview the article angle, not truncate mid-thought.
- Use evidence-aware analysis and competing viewpoints where relevant.`;
    if (input.contentType === 'newsletter') return `${shared}
Newsletter-specific rules:
- Plan an inbox-native issue, not a blog article.
- Headings must sound like a newsletter: Opening Note, The Signal, Why It Matters, Operator Note, What to Watch, Signoff.
- Keep sections concise, forwardable, and useful on their own.
- The title must sound like a newsletter issue or brief; do not use article, guide, or whitepaper labels.
- The excerpt must be a complete issue preview, not a truncated SEO description.`;
    if (input.contentType === 'guide') return `${shared}
Guide-specific rules:
- Plan an instructional guide with prerequisites, framework, implementation, examples/checks, mistakes, and next steps.
- Headings must teach sequence, decisions, checks, and application. They cannot sound like opinion article headings.
- The title must be guide-native and useful, not "An Executive Perspective".
- The excerpt must explain what the guide helps the reader do and must end on a complete sentence.
- Each section should answer what to do, why it matters, how to check it, and what to avoid.`;
    if (input.contentType === 'whitepaper') return `${shared}
Whitepaper-specific rules:
- Plan a formal whitepaper with executive context, methodology/scope, evidence or findings, framework, risks, and recommendations.
- Headings must sound like a whitepaper, not a blog, newsletter, or casual guide.
- The title must be formal and complete; use "whitepaper" only when it clarifies the asset type.
- The excerpt must summarize evidence basis, strategic stakes, and recommendations without truncation.
- Include limitations, tradeoffs, and decision implications.`;
    return shared;
  })();
  const response = await runCompletionWithOperation({
    operation: 'blogGeneration',
    companyId: input.company_id,
    referenceType: input.correlation?.referenceType ?? null,
    referenceId: input.correlation?.referenceId ?? null,
    parentActivityId: input.correlation?.parentActivityId ?? null,
    cache_version: input.cache_version,
    model: 'gpt-4o-mini',
    temperature: 0.35,
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    messages: [
      {
        role: 'system',
        content: `You are the planning layer for Omnivera's unified long-form engine. Return JSON only. Create a contentPlan before drafting. Do not write the article body.

Rules:
- Every section must have section_title, section_goal, unique_angle, key_points, content_type, depth_requirement, word_target.
- No two sections can have the same section_goal.
- Do not repeat key_points across sections.
- ${planningRules}
- Every major section must cover at least one target entity from topicEntityMap.
- Avoid assigning the same target entity to adjacent sections.
- Adapt structure to searchIntent and SERP structure hints.
- Adapt to contentPositioning. If contrarian, challenge norms. If framework_first, introduce the model early. If data_driven, add more evidence sections. If comparison_heavy, add structured comparisons.
- At least two sections must fill competitor gaps or challenge common approaches.
- The introduction/hook must break common patterns and create curiosity or tension.
- Apply performance learning when available: prefer high-performing patterns, avoid weak patterns, and prioritize historically winning section types.
- Include at least two evidence_plan items using real examples, realistic use cases, or referenced insights. No fake references.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          topic: input.topic,
          contentType: input.contentType,
          formatType: input.formatType,
          targetWordCount,
          searchIntent,
          topicEntityMap,
          serpStructureHints,
          contentPositioning,
          competitorContentProfile,
          differentiationStrategy,
          performanceInsights,
          organizationPerspective,
          organizationPerspectivePrompt: renderOrganizationPerspectiveForPrompt(organizationPerspective),
          performancePlanningDirectives: buildPerformancePlanningDirectives(performanceInsights),
          tone: input.tone,
          intent: input.intent,
          seoContext: input.seoContext,
          companyContext: input.companyContext,
          answers: input.answers,
          contentTypeConfig: config,
          templateSpec: templateSpec
            ? {
                templateName: templateSpec.templateName,
                sections: templateSpec.sections
                  .filter((section) => section.id !== 'hook' && section.id !== 'intro')
                  .map((section) => ({
                    id: section.id,
                    label: section.label,
                    section_goal: section.section_goal,
                    content_type: section.content_type,
                    depth_requirement: section.depth_requirement,
                    intent: section.intent,
                    wordWeight: section.wordWeight,
                    outputConstraints: section.outputConstraints,
                  })),
              }
            : null,
          fallbackShape: fallback,
        }, null, 2),
      },
    ],
  });

  return parsePlan(response.output, input, templateSpec, topicEntityMap, searchIntent, serpStructureHints, contentPositioning, differentiationStrategy);
}

function buildCompanyPov(companyContext?: CompanyContext): string {
  if (!companyContext) return 'Use a specific, expert POV. Do not sound generic.';
  return [
    companyContext.companyName ? `Company: ${companyContext.companyName}` : '',
    companyContext.industry ? `Industry: ${companyContext.industry}` : '',
    companyContext.audience ? `Audience: ${companyContext.audience}` : '',
    companyContext.uniqueValue ? `Unique value: ${companyContext.uniqueValue}` : '',
    companyContext.competitiveAdvantages ? `Differentiators: ${companyContext.competitiveAdvantages}` : '',
    companyContext.coreProblemStatement ? `Core problem: ${companyContext.coreProblemStatement}` : '',
    companyContext.keyMessages ? `Key messages: ${companyContext.keyMessages}` : '',
    companyContext.brand_voice ? `Brand voice: ${companyContext.brand_voice}` : '',
  ].filter(Boolean).join('\n') || 'Use a specific, expert POV. Do not sound generic.';
}

export async function generateSection(input: {
  request: PlannedLongFormGenerationInput;
  plan: ContentPlan;
  section: ContentPlanSection;
  priorSections: SectionGenerationResult[];
  searchIntent: SearchIntent;
  serpStructureHints: SerpStructureHints;
  contentPositioning: ContentPositioning;
  differentiationStrategy: DifferentiationStrategy;
  repairReasons?: string[];
}): Promise<SectionGenerationResult> {
  const priorSummaries = input.priorSections.map((section) => ({
    title: section.section_title,
    summary: stripHtml(section.html).slice(0, 260),
    paragraph_opening_signatures: paragraphTextsFromHtml(section.html)
      .map(paragraphOpeningSignature)
      .filter(Boolean)
      .slice(0, 4),
  }));
  const organizationPerspective = input.request.organizationPerspective ?? buildOrganizationPerspective({
    topic: input.request.topic,
    companyContext: input.request.companyContext,
    selectedAngle: input.request.selected_angle,
    answers: input.request.answers,
  });
  const editorialLane = inferEditorialSectionLane(input.section, input.plan.sections.indexOf(input.section));
  const contentTypeSectionRules = (() => {
    if (input.request.contentType === 'story') return `
Story rules:
- This is a story, not an article. Write in scenes, tension, choice, consequence, and reflection.
- The H2 must be a narrative beat, not a business explainer or advice heading.
- Do not use Key Insights, Direct answer, FAQ, framework, executive decision, SEO, or thought-leadership section language.
- Do not write "this section" or explain what the story will do. Put the reader inside the moment.
- Include a believable protagonist or team experience. Use a person, founder, customer, operator, buyer, or team rather than an abstract "leaders" voice.
- Include at least one anecdotal detail in this section: a meeting moment, dashboard glance, customer question, draft revision, hallway comment, delayed launch, or similar lived moment.
- Use concrete action and emotional texture. A little dialogue-like remembered line is allowed when natural, but do not fabricate named real people or real companies.
- Let the brand lesson emerge through the scene and resolution, not through a recommendation paragraph.`;
    if (input.request.contentType === 'article') return `
Article rules:
- Write this as an editorial article section, not a guide, newsletter, whitepaper, or SEO blog.
- The H2 must sound like an article heading and must advance the article angle.
- Use article craft: lede logic, evidence-aware analysis, competing interpretations, implication, and closing judgment.
- Do not use step-by-step guide language unless the section explicitly evaluates an action.`;
    if (input.request.contentType === 'newsletter') return `
Newsletter rules:
- Write this as an inbox-native newsletter section.
- Keep the section concise, skimmable, and forwardable.
- Use newsletter section logic: signal, why it matters, operator note, watch item, or signoff.
- Do not build a long blog-style H2 body or generic SEO explanation.`;
    if (input.request.contentType === 'guide') return `
Guide rules:
- Write this as an instructional guide section.
- Teach sequence, decisions, checks, examples, and mistakes.
- The H2 must help the reader act or assess progress.
- Avoid opinion article framing unless it directly supports practical instruction.`;
    if (input.request.contentType === 'whitepaper') return `
Whitepaper rules:
- Write this as a formal whitepaper section.
- Use executive, evidence-aware, methodology-conscious language.
- Name assumptions, limitations, tradeoffs, and decision implications where relevant.
- Avoid casual blog, newsletter, or listicle phrasing.`;
    return '';
  })();
  const siblingLanes = input.plan.sections
    .filter((section) => section.section_title !== input.section.section_title)
    .map((section, index) => ({
      title: section.section_title,
      lane: inferEditorialSectionLane(section, index),
      unique_angle: section.unique_angle,
    }));
  const result = await runCompletionWithOperation({
    operation: 'blogGeneration',
    companyId: input.request.company_id,
    referenceType: input.request.correlation?.referenceType ?? null,
    referenceId: input.request.correlation?.referenceId ?? null,
    parentActivityId: input.request.correlation?.parentActivityId ?? null,
    cache_version: input.request.cache_version,
    model: 'gpt-4o-mini',
    temperature: input.repairReasons?.length ? 0.25 : 0.45,
    max_tokens: Math.min(5000, Math.max(1800, Math.round((input.section.word_target || 300) * 3.2))),
    messages: [
      {
        role: 'system',
        content: `Generate exactly one long-form section as clean HTML.

Hard rules:
- Start with <h2>${input.section.section_title}</h2>.
- Use only this section's section_goal, unique_angle, and key_points.
- ${contentTypeSectionRules}
- ${laneDirective(editorialLane)}
- ${laneForbiddenFrames(editorialLane)}
- Treat sibling sections as protected territory. Do not perform their editorial jobs.
- Add new information; do not reuse phrasing or examples from prior sections.
- Do not start paragraphs with the same structural signature as prior sections. Vary sentence architecture, not just nouns.
- Cover at least one target entity from this section's target_entities.
- Respect search intent: ${input.searchIntent}. ${input.serpStructureHints.intentGuidance}
- Respect positioning: primary=${input.contentPositioning.primary}, secondary=${input.contentPositioning.secondary}.
- Avoid competitor patterns: ${input.differentiationStrategy.avoid.slice(0, 3).join('; ')}.
- Emphasize differentiation gaps: ${input.differentiationStrategy.emphasize.slice(0, 3).join('; ')}.
- If this is the first section, use this hook strategy: ${input.differentiationStrategy.uniqueHookStrategy}
- Include What/How/Why/Examples coverage where it naturally fits.
- For comparison intent, include a compact HTML table when this section compares options.
- If requires_direct_answer=true, include a short <blockquote><strong>Direct answer:</strong> ...</blockquote> before elaboration.
- If framework_role is introduce/apply, name and explain the framework: ${input.plan.framework.name}.
- At least one section in the article must make ${input.plan.framework.name} feel like a proprietary framework, methodology, maturity model, diagnostic model, evaluation framework, or decision framework.
- If requires_opinionated_insight=true, challenge a common assumption with a non-obvious insight.
- Write for ${organizationPerspective.primaryAudience}. Explain the business implication, not only the concept.
- Use the organization perspective: ${organizationPerspective.companyViewpoint} ${organizationPerspective.marketObservation} ${organizationPerspective.strategicRecommendation} ${organizationPerspective.tradeoffAnalysis} ${organizationPerspective.proprietaryInsight}
- Never open with generic SEO language such as "In today's fast-paced landscape", "In the evolving world of", "Businesses today face", or "Navigating a complex environment".
- Do not repeat the same setup, definition, or recommendation from prior sections. If a sentence could appear under another H2 unchanged, rewrite it with this section's specific decision role.
- Only the article-level opening may hook the reader. Section openings must advance the argument from the prior section; do not restart with another broad hook, scene-setter, or "why this matters" introduction.
- Use realistic examples or referenced insights where relevant.
- Do not invent URLs, studies, brands, or placeholder citations.
- Naturally embed the company POV. No generic filler.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          topic: input.request.topic,
          contentType: input.request.contentType,
          formatType: input.request.formatType,
          section: input.section,
          targetEntities: input.section.target_entities || [],
          serpStructureHints: input.serpStructureHints,
          framework: input.plan.framework,
          evidencePlan: input.plan.evidence_plan,
          companyPov: buildCompanyPov(input.request.companyContext),
          organizationPerspective,
          editorialLane,
          editorialLaneDirective: laneDirective(editorialLane),
          protectedSiblingLanes: siblingLanes,
          tone: input.request.tone,
          intent: input.request.intent,
          priorSections: priorSummaries,
          forbiddenParagraphOpeningSignatures: priorSummaries.flatMap((section) => section.paragraph_opening_signatures).slice(-12),
          repairReasons: input.repairReasons,
        }, null, 2),
      },
    ],
  });

  return {
    section_title: input.section.section_title,
    html: result.output.trim(),
  };
}

function sectionNeedsRepair(
  section: ContentPlanSection,
  generated: SectionGenerationResult,
  report: LongFormQualityReport,
  plan: ContentPlan,
): string[] {
  const reasons: string[] = [];
  const sectionText = generated.html;
  if (report.lowVariationSections.some((issue) => issue.sectionId === section.section_title)) {
    reasons.push('Section is too similar to a previous section.');
  }
  if (section.framework_role !== 'none' && !sectionText.toLowerCase().includes(plan.framework.name.toLowerCase())) {
    reasons.push('Framework section needs clearer named model treatment.');
  }
  if (section.requires_direct_answer && !/direct answer|what is|how to/i.test(sectionText)) {
    reasons.push('Missing required direct answer block.');
  }
  if (section.requires_opinionated_insight && !/common assumption|most teams|mistake|miss|counterintuitive|non-obvious|instead/i.test(sectionText)) {
    reasons.push('Missing opinionated or non-obvious insight.');
  }
  return reasons;
}

// Phase 6.2 — Apply adaptive section sizing across the plan.
//
// For each section we derive `section_generation_profile.target_words`
// from topic complexity, narrative density, grounding density, and the
// article-level word target. Downstream consumers prefer this profile
// over the raw planner-emitted `word_target`. We also overwrite
// `word_target` so existing consumers that read it pick up the adapted
// value transparently.
export function applyAdaptiveSizingToPlan(plan: ContentPlan, ctx: {
  articleWordTarget: number;
  contentType: string;
  groundingFragmentCount: number;
}): ContentPlan {
  if (!plan?.sections?.length) return plan;
  const sections = plan.sections.length;
  const baselinePerSection = Math.max(60, Math.round(ctx.articleWordTarget / sections));

  // ── Phase 8.1 — Apply the content-type planning stabilizer.
  // The stabilizer modulates section count + per-section word target;
  // subsequent adaptive sizing tunes per-section based on complexity.
  const stab = applyPlanningStabilizer({
    contentType: ctx.contentType,
    baselineSectionCount: sections,
    baselinePerSectionWordTarget: baselinePerSection,
  });
  // Phase 9.1 — Active self-healing actions tighten the planner output.
  const healingTightenPlanner = hasActiveHealingAction('tighten_planner', ctx.contentType);
  const healingReduceSizing = hasActiveHealingAction('reduce_section_sizing', ctx.contentType);
  const healingCompressionBias = hasActiveHealingAction('increase_compression_bias', ctx.contentType);
  const healingSectionTrim = healingTightenPlanner ? 0.85 : 1; // shave 15% off section count
  const healingWordTrim = healingReduceSizing ? 0.85 : (healingCompressionBias ? 0.92 : 1);
  const stabilizedPerSection = Math.max(60, Math.round(stab.perSectionWordTarget * healingWordTrim));
  // If the stabilizer reduced section count below current plan length,
  // we cap; if it increased, we leave existing sections (the LLM
  // produced what it produced; we don't synthesize new sections).
  const targetSections = Math.min(sections, Math.max(2, Math.round(stab.sectionCount * healingSectionTrim)));
  const stabilizerProfile = getContentTypeStabilizer(ctx.contentType);
  // Per-section grounding density target from the stabilizer (whitepaper
  // wants 3 per section, newsletter wants 1, etc.). We surface this via
  // section_generation_profile so the runtime can preserve grounding
  // anchors accordingly.
  const stabilizerAnchorDensity = stabilizerProfile.planning.groundingAnchorsPerSection;
  const trimmedSections = targetSections < sections
    ? plan.sections.slice(0, targetSections)
    : plan.sections;
  const adapted = trimmedSections.map((s) => {
    // Use stabilizedPerSection as the new baseline (overriding the raw
    // planner-emitted word_target) when the planner output is wildly
    // off — but keep planner's intent when it's within ±25% of the
    // stabilized target.
    const plannerWordTarget = s.word_target ?? baselinePerSection;
    const baselineForSection = Math.abs(plannerWordTarget - stabilizedPerSection) / stabilizedPerSection > 0.25
      ? stabilizedPerSection
      : plannerWordTarget;
    return { ...s, word_target: baselineForSection };
  }).map((s) => {
    const complexity = estimateTopicComplexity({
      sectionTitle: s.section_title,
      keyPoints: s.key_points,
      requiresOpinionatedInsight: s.requires_opinionated_insight,
      requiresDirectAnswer: s.requires_direct_answer,
      frameworkRole: s.framework_role,
    });
    const narrative = estimateNarrativeDensity({
      sectionTitle: s.section_title,
      keyPoints: s.key_points,
      requiresOpinionatedInsight: s.requires_opinionated_insight,
      requiresDirectAnswer: s.requires_direct_answer,
      frameworkRole: s.framework_role,
    });
    const sized = computeAdaptiveSectionSize({
      baselineWordTarget: s.word_target ?? baselinePerSection,
      contentType: ctx.contentType,
      topicComplexity: complexity,
      groundingDensity: ctx.groundingFragmentCount,
      narrativeDensity: narrative,
      retryHistoryCount: 0,
      timeoutRisk: 0,
    });
    const compressionRisk: 'low' | 'moderate' | 'high' =
      sized.wordTarget >= 600 ? 'high'
      : sized.wordTarget >= 350 ? 'moderate'
      : 'low';
    // Phase 8.1: surface stabilizer-required anchor density per section
    // (whitepapers want ≥3 grounding anchors per section; newsletters 1).
    // Downstream consumers may use this to weight evidence requirements.
    const effectiveGroundingDensity = Math.max(
      ctx.groundingFragmentCount,
      Math.ceil(stabilizerAnchorDensity * Math.max(1, sections)),
    );
    return {
      ...s,
      word_target: sized.wordTarget,
      section_generation_profile: {
        target_words: sized.wordTarget,
        timeout_budget_ms: Math.min(sized.recommendedTimeoutMs, stabilizerProfile.runtime.timeoutBudgetCapMs),
        compression_risk: compressionRisk,
        grounding_density: effectiveGroundingDensity,
        strategic_density: complexity,
        retry_risk: 0,
      },
    };
  });
  return { ...plan, sections: adapted };
}

// Phase 3.3 — Run the semantic repetition detector across the generated
// sections. Returns the report block + the set of section indices the
// caller should regenerate selectively (NEVER the full article).
function runSemanticRepetitionCheck(
  sections: SectionGenerationResult[],
): {
  block: NonNullable<LongFormQualityReport['semanticRepetition']>;
  sectionsToRegenerate: number[];
  triggerIssue: string | null;
} {
  const detected = detectSemanticRepetition(
    sections.map((s, i) => ({ sectionIndex: i, sectionTitle: s.section_title, html: s.html })),
  );
  const block: NonNullable<LongFormQualityReport['semanticRepetition']> = {
    repetition_score: detected.repetitionScore,
    repeated_concepts: detected.repeatedConcepts,
    repeated_transitions: detected.repeatedTransitions,
    repeated_rhetorical_patterns: detected.repeatedRhetoricalPatterns,
    overlapping_sections: detected.overlappingSections.map((p) => ({
      sectionA: p.sectionA.index,
      sectionB: p.sectionB.index,
      overlapScore: p.overlapScore,
    })),
    verdict: detected.verdict,
    sections_regenerated: [],
  };
  let triggerIssue: string | null = null;
  if (detected.verdict !== 'pass') {
    const indices = detected.sectionsToRegenerate.join(', ');
    triggerIssue = `Semantic repetition detected (score ${detected.repetitionScore}). Selective regeneration targets: [${indices}].`;
  }
  return { block, sectionsToRegenerate: detected.sectionsToRegenerate, triggerIssue };
}

export function validateLongFormQuality(
  plan: ContentPlan,
  sections: SectionGenerationResult[],
  contentType: LongFormContentType,
): LongFormQualityReport {
  const variation = validateContentVariation(
    sections.map((section) => ({
      id: section.section_title,
      label: section.section_title,
      text: section.html,
    })),
    { contentType: contentType === 'case-study' ? 'case study' : contentType },
  );
  const fullHtml = sections.map((section) => section.html).join('\n').toLowerCase();
  const frameworkPresent = Boolean(plan.framework.name) && fullHtml.includes(plan.framework.name.toLowerCase());
  const faqPresent = !isSeoDrivenContentType(contentType) || plan.faq.length >= 4;
  const directAnswerBlocks = (fullHtml.match(/direct answer|what is |how to /g) || []).length;
  const opinionatedSections = sections.filter((section, index) => {
    const planned = plan.sections[index];
    return planned?.requires_opinionated_insight
      && /common assumption|most teams|mistake|miss|counterintuitive|non-obvious|instead/i.test(section.html);
  }).length;
  const requiredOpinionatedSections = Math.max(2, plan.sections.filter((section) => section.requires_opinionated_insight).length);
  const insightDensityScore = Math.min(1, opinionatedSections / requiredOpinionatedSections);
  const evidenceCount = (fullHtml.match(/for example|for instance|use case|case study|according to|in practice|scenario/g) || []).length;
  const sectionUniquenessScore = Number(Math.max(0, 1 - variation.maxSectionSimilarity).toFixed(2));
  const issues: string[] = [];

  if (variation.duplicateContentDetected || variation.lowVariationDetected) issues.push('Section repetition detected.');
  if (!frameworkPresent) issues.push('Named framework missing from generated content.');
  if (!faqPresent) issues.push('Required FAQ plan missing or too short.');
  if (isSeoDrivenContentType(contentType) && directAnswerBlocks < 2) issues.push('Direct answer block requirement not met.');
  if (insightDensityScore < 1) issues.push('Opinionated insight density requirement not met.');
  if (evidenceCount < 2) issues.push('Evidence requirement not met.');

  // Phase 3.3 — Semantic repetition pass (cross-section overlap detection).
  const repetition = runSemanticRepetitionCheck(sections);
  if (repetition.triggerIssue) issues.push(repetition.triggerIssue);

  return {
    sectionUniquenessScore,
    repeatedSectionPairs: variation.duplicateSectionPairs,
    lowVariationSections: variation.lowVariationSections,
    frameworkPresent,
    faqPresent,
    insightDensityScore,
    directAnswerBlocks,
    evidenceCount,
    issues,
    repairedSections: [],
    semanticRepetition: repetition.block,
  };
}

// Phase 4.1 — Classify quality issues into adaptive-budget IssueCategory.
function classifyIssue(issue: string): IssueCategory {
  const i = issue.toLowerCase();
  if (i.includes('alignment') || i.includes('icp') || i.includes('positioning') || i.includes('strategic perspective')) return 'alignment';
  if (i.includes('hallucination') || i.includes('factual') || i.includes('evidence') || i.includes('citation')) return 'factual';
  if (i.includes('repetition') || i.includes('overlap') || i.includes('semantic')) return 'repetition';
  if (i.includes('genericity') || i.includes('generic')) return 'genericity';
  if (i.includes('framework') || i.includes('continuity') || i.includes('opinionated insight') || i.includes('direct answer')) return 'continuity';
  if (i.includes('assignment')) return 'assignment';
  return 'unknown';
}

function severityForReport(report: LongFormQualityReport): IssueSeverity {
  const repScore = report.semanticRepetition?.repetition_score ?? 0;
  const issueCount = report.issues.length;
  if (issueCount >= 8 || repScore >= 75) return 'catastrophic';
  if (issueCount >= 5 || repScore >= 55) return 'severe';
  if (issueCount >= 2 || repScore >= 35) return 'moderate';
  return 'low';
}

/**
 * Phase 4.1 — Replaces the prior `repairedSections.length >= 3` ceiling.
 *
 * The repair loop now:
 *   1. Computes an `AdaptiveRecoveryBudget` from issue mix + severity +
 *      semantic-repetition score + elapsed duration.
 *   2. Allocates repairs up to `budget.maxRepairs` (NOT a hardcoded 3).
 *   3. Targets the sections flagged by semantic-repetition selectively
 *      (the budget's TARGETED_REPETITION mode caps this at 2 sections).
 *   4. Aborts early when the budget says EARLY_ABORT.
 *   5. Stops when the diminishing-return threshold isn't crossed by a
 *      repair attempt.
 */
export async function repairFailedSections(
  input: PlannedLongFormGenerationInput,
  plan: ContentPlan,
  sections: SectionGenerationResult[],
  report: LongFormQualityReport,
  searchIntent: SearchIntent,
  serpStructureHints: SerpStructureHints,
  contentPositioning: ContentPositioning,
  differentiationStrategy: DifferentiationStrategy,
  /** Phase 4.1 — Caller passes elapsed ms so the budget can shrink under time pressure. */
  generationStartMs: number,
): Promise<{ sections: SectionGenerationResult[]; report: LongFormQualityReport; recoveryBudget: AdaptiveRecoveryBudget }> {
  // Always compute the budget — even on a clean article — so the planner
  // returns a deterministic diagnostic shape.
  const failedSectionCount = report.semanticRepetition?.sections_regenerated.length ?? report.issues.length;
  const issueCategories: Partial<Record<IssueCategory, number>> = {};
  for (const issue of report.issues) {
    const cat = classifyIssue(issue);
    issueCategories[cat] = (issueCategories[cat] ?? 0) + 1;
  }
  const severityDistribution: Partial<Record<IssueSeverity, number>> = {
    [severityForReport(report)]: Math.min(plan.sections.length, Math.max(1, failedSectionCount)),
  };
  const budget = computeAdaptiveRecoveryBudget({
    total_sections: plan.sections.length,
    failed_sections: failedSectionCount,
    severity_distribution: severityDistribution,
    issue_categories: issueCategories,
    content_type: input.contentType,
    generation_duration_ms: Math.max(0, Date.now() - generationStartMs),
  });

  if (report.issues.length === 0 || budget.maxRepairs === 0) {
    return { sections, report, recoveryBudget: budget };
  }

  const repaired = [...sections];
  const repairedSections: string[] = [];

  // Phase 4.1 — Surface targeted-repetition selection so we don't burn
  // budget regenerating sections whose only issue is overlap with a
  // sibling section we ALREADY repaired.
  const repetitionTargets = new Set<number>(report.semanticRepetition?.sections_regenerated ?? []);

  for (let index = 0; index < plan.sections.length; index += 1) {
    if (repairedSections.length >= budget.maxRepairs) break;

    const planSection = plan.sections[index];
    const current = repaired[index];
    if (!current) continue;
    const reasons = sectionNeedsRepair(planSection, current, report, plan);

    // For TARGETED_REPETITION budgets, ONLY regenerate the indices the
    // semantic detector flagged.
    if (budget.escalationStrategy === 'TARGETED_REPETITION' && !repetitionTargets.has(index)) {
      continue;
    }

    if (reasons.length === 0 && report.issues.length > 0 && index !== plan.sections.length - 1) continue;
    if (reasons.length === 0 && repairedSections.length > 0) continue;

    repaired[index] = await generateSection({
      request: input,
      plan,
      section: planSection,
      priorSections: repaired.slice(0, index),
      searchIntent,
      serpStructureHints,
      contentPositioning,
      differentiationStrategy,
      repairReasons: reasons.length > 0 ? reasons : report.issues,
    });
    repairedSections.push(planSection.section_title);
  }

  const nextReport = validateLongFormQuality(plan, repaired, input.contentType);
  return {
    sections: repaired,
    report: {
      ...nextReport,
      repairedSections,
    },
    recoveryBudget: budget,
  };
}

