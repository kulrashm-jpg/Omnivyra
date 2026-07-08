/** Part 1/3 of longFormPlanningEngine.ts — verbatim split (barrel preserved; importers unchanged). */
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


export type PlannedSectionContentType =
  | 'explanation'
  | 'framework'
  | 'example'
  | 'comparison'
  | 'application'
  | 'insight'
  | 'case_study'
  | 'faq'
  | 'summary';

export interface ContentPlanSection {
  section_title: string;
  section_goal: string;
  unique_angle: string;
  key_points: string[];
  content_type: PlannedSectionContentType | string;
  depth_requirement: string;
  word_target?: number;
  requires_direct_answer?: boolean;
  requires_opinionated_insight?: boolean;
  framework_role?: 'introduce' | 'apply' | 'none';
  target_entities?: string[];
  /**
   * Phase 6.2 — Per-section generation profile emitted by the adaptive
   * sizing pass. Downstream consumers (section generator, execution
   * strategy, planner stability validator) prefer these values over the
   * raw planner-emitted `word_target`.
   */
  section_generation_profile?: {
    target_words: number;
    timeout_budget_ms: number;
    compression_risk: 'low' | 'moderate' | 'high';
    grounding_density: number;       // count of fragments relevant to this section
    strategic_density: number;       // 0..1
    retry_risk: number;              // 0..1
  };
}

export interface ContentPlan {
  title: string;
  excerpt: string;
  key_insights: string[];
  sections: ContentPlanSection[];
  framework: {
    name: string;
    model_type: 'steps' | 'layers' | 'system' | 'matrix';
    components: string[];
    section_title: string;
  };
  faq: Array<{ question: string; answer: string }>;
  evidence_plan: string[];
}

export interface SectionGenerationResult {
  section_title: string;
  html: string;
  references?: Array<{ title: string; url: string; claim?: string }>;
}

export interface LongFormQualityReport {
  sectionUniquenessScore: number;
  repeatedSectionPairs: DuplicateSectionPair[];
  lowVariationSections: LowVariationSectionIssue[];
  frameworkPresent: boolean;
  faqPresent: boolean;
  insightDensityScore: number;
  directAnswerBlocks: number;
  evidenceCount: number;
  issues: string[];
  repairedSections: string[];
  /**
   * Phase 3.3 — Cross-section semantic repetition snapshot.
   * Driven by `detectSemanticRepetition`. The orchestrator selectively
   * regenerates the flagged sections (never the full article).
   */
  semanticRepetition?: {
    repetition_score: number;
    repeated_concepts: string[];
    repeated_transitions: string[];
    repeated_rhetorical_patterns: string[];
    overlapping_sections: Array<{
      sectionA: number;
      sectionB: number;
      overlapScore: number;
    }>;
    verdict: 'pass' | 'retry' | 'fail';
    sections_regenerated: number[];
  };
}

export interface PlannedLongFormGenerationInput
  extends Omit<BlogGenerationRequest, 'contentType' | 'formatType' | 'template_blocks' | 'target_words'> {
  contentType: LongFormContentType;
  formatType: string;
  templateBlocks?: BlogGenerationRequest['template_blocks'];
  targetWordCount?: number;
  seoContext?: string;
  contentPerformance?: ContentPerformance[];
  performanceFeatureSnapshots?: ContentPerformanceFeatureSnapshot[];
  performanceInsights?: PerformanceInsights;
  /**
   * Phase 4.3 — Activated grounding profile (built upstream from prior
   * company blogs / internal uploads / approved URLs / snippets). The
   * planning engine currently passes this through to its repair pass
   * unchanged; downstream factual/citation/source-integrity layers
   * consume it when present.
   */
  groundingProfile?: import('../../backend/services/longForm/longFormRecommendationTypes').RetrievalGroundingProfile;
}

export interface PlannedLongFormGenerationResult {
  generation: BlogGenerationResult;
  contentPlan: ContentPlan;
  qualityReport: LongFormQualityReport;
  searchIntent: SearchIntent;
  topicEntityMap: TopicEntityMap;
  serpStructureHints: SerpStructureHints;
  contentPositioning: ContentPositioning;
  competitorContentProfile: CompetitorContentProfile;
  differentiationStrategy: DifferentiationStrategy;
  contentScore: ContentScore;
  improvementHooks: ContentImprovementHooks;
  performanceInsights: PerformanceInsights;
  generatedFeatureSnapshot?: ContentPerformanceFeatureSnapshot;
}

export function isSeoDrivenContentType(contentType: LongFormContentType): boolean {
  return contentTypeConfig[contentType].seoPriority !== 'low';
}

export function stripCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function countWords(value: string): number {
  return stripHtml(value).split(/\s+/).filter(Boolean).length;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  const cleaned = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function uniqueKeyPoints(sections: ContentPlanSection[]): ContentPlanSection[] {
  const seen = new Set<string>();
  return sections.map((section) => {
    const keyPoints = section.key_points.filter((point) => {
      const normalized = point.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    return {
      ...section,
      key_points: keyPoints.length > 0 ? keyPoints : [`Develop the distinct angle: ${section.unique_angle}`],
    };
  });
}

export function pickSectionEntities(entityMap: TopicEntityMap, index: number): string[] {
  const entities = [
    entityMap.primaryTopic,
    ...entityMap.relatedEntities,
    ...entityMap.subtopics,
    ...entityMap.semanticVariations,
  ].filter(Boolean);
  if (entities.length === 0) return [];
  return [
    entities[index % entities.length],
    entities[(index + 3) % entities.length],
  ].filter(Boolean);
}

export function buildFallbackPlan(
  input: PlannedLongFormGenerationInput,
  templateSpec: LongFormTemplateSpec | null,
  topicEntityMap: TopicEntityMap,
  searchIntent: SearchIntent,
  serpStructureHints: SerpStructureHints,
  contentPositioning: ContentPositioning,
  differentiationStrategy: DifferentiationStrategy,
): ContentPlan {
  const company = input.companyContext?.companyName || 'the brand';
  const targetWordCount = input.targetWordCount || Number(input.answers?.target_word_count) || 1200;
  const normalizedSubject = normalizeBlogSubject(input.topic);
  if (input.contentType === 'story') {
    const storySections = (templateSpec?.sections.filter((section) => section.id !== 'references' && section.id !== 'key_insights') || [])
      .slice(0, input.formatType === 'short_story' ? 4 : 5);
    const sectionsSource = storySections.length >= 3 ? storySections : [
      { id: 'moment', label: 'The Moment Everything Shifted', section_goal: 'Open inside the moment where the tension becomes visible.', intent: 'Open inside a concrete moment instead of explaining the topic.', content_type: 'scene', depth_requirement: 'Use a specific person, team, or decision point.', wordWeight: 0.25, required: true, outputConstraints: [] },
      { id: 'friction', label: 'The Friction Underneath', section_goal: 'Reveal the conflict that makes the story matter.', intent: 'Build tension through pressure and consequence.', content_type: 'conflict', depth_requirement: 'Show what is at stake.', wordWeight: 0.30, required: true, outputConstraints: [] },
      { id: 'turn', label: 'The Turn', section_goal: 'Deliver the realization or decision that changes the direction.', intent: 'Make the insight emerge from action.', content_type: 'turning_point', depth_requirement: 'Show what changed.', wordWeight: 0.25, required: true, outputConstraints: [] },
      { id: 'meaning', label: 'What Stayed With Them', section_goal: 'Close with reflection and meaning.', intent: 'Resolve the story without a generic summary.', content_type: 'reflection', depth_requirement: 'Leave the reader with the lesson.', wordWeight: 0.20, required: true, outputConstraints: [] },
    ];
    const sections = sectionsSource.map((section, index): ContentPlanSection => ({
      section_title: section.label,
      section_goal: section.section_goal || section.intent,
      unique_angle: index === 0
        ? `Start with a concrete moment where ${input.topic} becomes personal and visible.`
        : index === 1
        ? `Show the pressure, doubt, or constraint underneath ${input.topic}.`
        : index === 2
        ? `Reveal the turning point that changes how the protagonist sees ${input.topic}.`
        : `End with the lesson ${company}'s audience should carry forward.`,
      key_points: [
        section.intent,
        'Use scene, tension, decision, and reflection instead of article advice.',
        'Include a believable protagonist, operator, founder, customer, or team experience.',
        'Add one concrete anecdote, remembered detail, or observed moment that makes the story feel lived.',
      ],
      content_type: section.content_type,
      depth_requirement: `${section.depth_requirement} Keep the writing narrative, sensory, and human. Include lived experience, anecdotal detail, personal/team stakes, and observable action. Do not use executive-summary, key-insight, framework, FAQ, or SEO explainer language.`,
      word_target: Math.max(120, Math.round(targetWordCount * section.wordWeight)),
      requires_direct_answer: false,
      requires_opinionated_insight: section.content_type === 'reflection' || section.content_type === 'turning_point',
      framework_role: 'none',
      target_entities: pickSectionEntities(topicEntityMap, index),
    }));
    return {
      title: buildStoryAlignedTitle(input.topic, input.formatType),
      excerpt: buildStoryAlignedExcerpt(input.topic, company),
      key_insights: [
        `Open with a human moment, not a concept definition.`,
        `Use anecdotes, observed details, and a believable protagonist or team experience.`,
        `Let the lesson emerge from conflict, choice, and consequence.`,
      ],
      sections,
      framework: {
        name: `${normalizedSubject.subject} Story Arc`,
        model_type: 'steps',
        components: ['Moment', 'Friction', 'Turn', 'Meaning'],
        section_title: 'The Turn',
      },
      faq: [],
      evidence_plan: ['Use a realistic scene or customer/team moment.', 'Make the brand lesson implicit in the story resolution.'],
    };
  }
  const baseSections = templateSpec?.sections.filter((section) => (
    section.id !== 'key_insights'
    && section.id !== 'references'
    && section.id !== 'hook'
    && section.id !== 'intro'
  ));
  const sectionsSource = baseSections && baseSections.length >= 3
    ? baseSections
    : [
        {
          id: 'context',
          label: 'What This Means Now',
          section_goal: 'Explain the topic and the current tension the reader needs to understand.',
          intent: 'Explain the topic and the current tension the reader needs to understand.',
          content_type: 'explanation',
          depth_requirement: 'Define the problem clearly and connect it to audience stakes.',
          wordWeight: 0.2,
          required: true,
          outputConstraints: [],
        },
        {
          id: 'framework',
          label: 'The Operating Framework',
          section_goal: 'Introduce a reusable model the reader can apply.',
          intent: 'Introduce a reusable model the reader can apply.',
          content_type: 'framework',
          depth_requirement: 'Name the framework, define each layer, and explain why the order matters.',
          wordWeight: 0.28,
          required: true,
          outputConstraints: [],
        },
        {
          id: 'application',
          label: 'How to Apply It',
          section_goal: 'Show practical application and implementation sequence.',
          intent: 'Show practical application and implementation sequence.',
          content_type: 'application',
          depth_requirement: 'Include concrete steps and failure modes.',
          wordWeight: 0.24,
          required: true,
          outputConstraints: [],
        },
        {
          id: 'examples',
          label: 'Examples and Use Cases',
          section_goal: 'Ground the argument in realistic examples and use cases.',
          intent: 'Ground the argument in realistic examples and use cases.',
          content_type: 'example',
          depth_requirement: 'Include at least two realistic scenarios or referenced insights.',
          wordWeight: 0.18,
          required: true,
          outputConstraints: [],
        },
        {
          id: 'insights',
          label: 'What Most Teams Miss',
          section_goal: 'Challenge a common assumption and add a non-obvious insight.',
          intent: 'Challenge a common assumption and add a non-obvious insight.',
          content_type: 'insight',
          depth_requirement: 'Be opinionated and tie the POV back to company context.',
          wordWeight: 0.1,
          required: true,
          outputConstraints: [],
        },
      ];

  const sections = sectionsSource.map((section, index): ContentPlanSection => ({
    section_title: section.label,
    section_goal: section.section_goal || section.intent,
    unique_angle: index === 0
      ? `Define why ${input.topic} matters for ${company}'s audience now.`
      : index === 1
      ? `Turn ${input.topic} into a named operating model instead of generic advice.`
      : index === 2
      ? `Translate the idea into decisions, actions, and checks.`
      : index === 3
      ? `Use concrete examples to prove the argument.`
      : `Challenge the default assumption around ${input.topic}.`,
    // key_points feed both the LLM prompt AND the depth-expansion fallback
    // (which renders key_points[0] verbatim into the body). They must read as
    // reader-facing substance, never as authoring/meta directives — a phrase
    // like "<section> must serve a separate reader job" leaks into the article
    // and trips the Publishing Readiness Gate (reader-job detector). Lead with
    // the section's actual intent instead.
    key_points: [
      section.intent,
      ...(section.outputConstraints || []).slice(0, 2),
    ].filter(Boolean),
    content_type: section.content_type,
    depth_requirement: `${section.depth_requirement} Intent adaptation: ${serpStructureHints.intentGuidance} Positioning: ${contentPositioning.primary} supported by ${contentPositioning.secondary}. Differentiation: ${differentiationStrategy.emphasize.slice(0, 2).join('; ')}.`,
    word_target: Math.max(120, Math.round(targetWordCount * section.wordWeight)),
    requires_direct_answer: isSeoDrivenContentType(input.contentType) && index < 2,
    requires_opinionated_insight: index >= sectionsSource.length - 2 || contentPositioning.primary === 'contrarian' || contentPositioning.secondary === 'opinionated',
    framework_role: contentPositioning.primary === 'framework_first' && index === 0 ? 'introduce' : index === 1 ? 'introduce' : index === 2 ? 'apply' : 'none',
    target_entities: pickSectionEntities(topicEntityMap, index),
  }));

  return {
    title: buildContentTypeAlignedTitle(input),
    excerpt: buildContentTypeAlignedExcerpt(input, company),
    key_insights: [
      `${input.topic} needs a differentiated ${searchIntent} plan with ${contentPositioning.primary} positioning, not another generic overview.`,
      `The strongest content separates explanation, application, examples, and insight.`,
      `${company}'s point of view should shape the recommendations readers act on.`,
    ],
    sections: uniqueKeyPoints(sections),
    framework: {
      name: frameworkNameForContentType(input),
      model_type: 'layers',
      components: ['Context', 'Criteria', 'Execution', 'Proof'],
      section_title: sections[1]?.section_title || 'The Operating Framework',
    },
    faq: buildFallbackFaq(input.topic),
    evidence_plan: [
      contentPositioning.primary === 'data_driven'
        ? 'Use a realistic benchmark, measurable consequence, or referenced insight.'
        : 'Use a realistic team workflow example.',
      contentPositioning.primary === 'comparison_heavy'
        ? 'Use a criteria-based option comparison scenario.'
        : 'Use a customer or buyer decision scenario.',
    ],
  };
}

function buildFallbackFaq(topic: string): ContentPlan['faq'] {
  return [
    { question: `What is ${topic}?`, answer: `${topic} is the strategic problem or opportunity this piece helps the reader understand and act on.` },
    { question: `How do you approach ${topic}?`, answer: `Start with the audience problem, choose a clear framework, apply it to a real workflow, and validate it with examples.` },
    { question: `Why does ${topic} matter?`, answer: `It matters because weak framing leads to generic execution, while clear structure helps teams make better decisions.` },
    { question: `What should teams avoid with ${topic}?`, answer: `Avoid repeating broad advice without a distinct point of view, evidence, or practical application path.` },
  ];
}

function titleCase(value: string): string {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && small.has(lower)) return lower;
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function normalizeBlogSubject(topic: string): { subject: string; audience: string | null; display: string } {
  const raw = String(topic || '').replace(/\s+/g, ' ').trim();
  const withoutScaffold = raw
    .replace(/\bcategory\s+entry\s+guide\b/gi, 'category entry')
    .replace(/\bguide\b/gi, '')
    .replace(/\bstrategy\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const forMatch = withoutScaffold.match(/^(.+?)\s+for\s+(.+)$/i);
  const subjectRaw = (forMatch ? forMatch[1] : withoutScaffold)
    .replace(/\bfirsttime\b/gi, 'first-time')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const audienceRaw = forMatch?.[2]
    ?.replace(/\bfirsttime\b/gi, 'first-time')
    .replace(/\s{2,}/g, ' ')
    .trim() || null;
  const subject = titleCase(subjectRaw || 'the category decision');
  const audience = audienceRaw ? titleCase(audienceRaw) : null;
  return {
    subject,
    audience,
    display: audience ? `${subject} for ${audience}` : subject,
  };
}

function normalizeStorySubject(topic: string): string {
  const cleaned = String(topic || '')
    .replace(/\s+/g, ' ')
    .replace(/^(short\s+story|long\s+story|episodic\s+story)\s*:\s*/i, '')
    .replace(/^story\s*:\s*/i, '')
    .replace(/\b(short\s+story|long\s+story|episodic\s+story)\s*:\s*/gi, '')
    .replace(/\bthe\s+moment\s+short\s+story\s*:\s*/gi, 'the moment ')
    .replace(/\bneeds\s+a\s+clearer\s+decision\s+framework\b/gi, 'became a turning point')
    .replace(/\bdecision\s+criteria\b/gi, 'the choice')
    .replace(/\barticle\b/gi, 'story')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([:,.])/g, '$1')
    .replace(/:\s*$/g, '')
    .trim();
  return titleCase(cleaned || 'the turning point');
}

function buildMemorableStoryTitle(topic: string, formatType?: string): string {
  const subject = normalizeStorySubject(topic)
    .replace(/\bThe\s+Turning\s+Point\s+That\s+Changed\s+Everything\b/gi, 'The Turning Point')
    .replace(/\bThat\s+Changed\s+Everything\b/gi, '')
    .replace(/\bBecame\s+Real\b/gi, '')
    .replace(/\bThe\s+Moment\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const core = titleCase(subject || 'The Turn');
  if (formatType === 'episodic_story') return `The Unanswered Turn`;
  if (formatType === 'long_story') return `The Choice That Changed the Room`;
  if (/turning point/i.test(core)) return 'The Turn in the Room';
  if (/campaign|launch/i.test(core)) return 'The Launch That Paused';
  if (/buyer|customer/i.test(core)) return 'The Question That Changed It';
  return core.length <= 48 ? core : 'The Moment It Changed';
}

function buildBlogAlignedTitle(topic: string): string {
  const normalized = normalizeBlogSubject(topic);
  const cleanTopic = normalized.display || 'the topic';
  const guideForMatch = cleanTopic.match(/^(.+?)\s+guide\s+for\s+(.+)$/i);
  if (guideForMatch) {
    const subject = titleCase(guideForMatch[1]);
    const audience = titleCase(guideForMatch[2]);
    return `${audience}: How to Evaluate ${subject} Before You Commit`;
  }
  const forMatch = cleanTopic.match(/^(.+?)\s+for\s+(.+)$/i);
  if (forMatch) {
    const subject = titleCase(forMatch[1]);
    const audience = titleCase(forMatch[2]);
    return `What ${audience} Need to Know About ${subject}`;
  }
  if (/^(how|why|what|when|where)\b/i.test(cleanTopic)) {
    return titleCase(cleanTopic);
  }
  return `Why ${titleCase(cleanTopic)} Needs a Clearer Decision Framework`;
}

function buildStoryAlignedTitle(topic: string, formatType?: string): string {
  return buildMemorableStoryTitle(topic, formatType);
}

function buildStoryAlignedExcerpt(topic: string, company: string): string {
  const subject = normalizeStorySubject(topic).toLowerCase();
  return `A story about ${subject} becoming real through a person, team, or customer moment. It follows the tension, the turn, and the lesson ${company}'s audience can carry into their own work.`;
}

function buildBlogAlignedExcerpt(topic: string, company: string): string {
  const cleanTitle = buildBlogAlignedTitle(topic).replace(/[.?!]+$/g, '');
  return `${cleanTitle} explains the decision criteria, tradeoffs, practical risks, and next steps leaders need before turning the idea into action. It uses ${company}'s point of view to move beyond generic advice and make the topic easier to evaluate.`;
}

function buildContentTypeAlignedTitle(input: PlannedLongFormGenerationInput): string {
  if (input.contentType === 'story') return buildStoryAlignedTitle(input.topic, input.formatType);
  if (input.contentType === 'blog' || input.contentType === 'case-study') return buildBlogAlignedTitle(input.topic);
  const normalized = normalizeBlogSubject(input.topic);
  const subject = normalized.display || titleCase(input.topic || 'the decision');
  const audience = normalized.audience || 'Leaders';
  if (input.contentType === 'article') {
    if (input.formatType === 'investigative') return `Inside the Real Problem Behind ${subject}`;
    if (input.formatType === 'opinion') return `The Case for Rethinking ${subject}`;
    return `How ${subject} Became a Strategic Question`;
  }
  if (input.contentType === 'newsletter') {
    if (input.formatType === 'digest' || input.formatType === 'curated') return `The ${subject} Brief: Signals Worth Watching`;
    if (input.formatType === 'action-letter' || input.formatType === 'operator playbook') return `The ${subject} Operator Note`;
    return `This Week in ${subject}: What Changed and What to Do`;
  }
  if (input.contentType === 'guide') {
    if (input.formatType === 'quickstart') return `How to Start With ${subject} Without Overbuilding`;
    if (input.formatType === 'reference') return `${subject} Reference Guide`;
    return `The Practical Guide to ${subject}`;
  }
  if (input.contentType === 'whitepaper') {
    if (input.formatType === 'technical') return `Technical Whitepaper: ${subject} Architecture and Risk Controls`;
    if (input.formatType === 'strategic') return `Strategic Whitepaper: ${subject} for ${audience}`;
    return `${subject}: Evidence, Tradeoffs, and Strategic Implications`;
  }
  return buildBlogAlignedTitle(input.topic);
}

function buildContentTypeAlignedExcerpt(input: PlannedLongFormGenerationInput, company: string): string {
  if (input.contentType === 'story') return buildStoryAlignedExcerpt(input.topic, company);
  if (input.contentType === 'blog' || input.contentType === 'case-study') return buildBlogAlignedExcerpt(input.topic, company);
  const normalized = normalizeBlogSubject(input.topic);
  const subject = (normalized.display || input.topic || 'the topic').toLowerCase();
  if (input.contentType === 'article') {
    return `An editorial article on ${subject} that develops a clear angle, weighs the available signals, and explains what the pattern changes for readers.`;
  }
  if (input.contentType === 'newsletter') {
    return `A concise newsletter issue on ${subject} with the signal readers should notice, why it matters, and one useful move to carry forward.`;
  }
  if (input.contentType === 'guide') {
    return `A practical guide to ${subject} with prerequisites, a working framework, examples, checks, and next steps the reader can apply.`;
  }
  if (input.contentType === 'whitepaper') {
    return `A formal whitepaper on ${subject} that defines the strategic context, evidence basis, decision framework, risks, and recommendations.`;
  }
  return buildBlogAlignedExcerpt(input.topic, company);
}

export function excerptLimitForContentType(contentType: LongFormContentType): number {
  if (contentType === 'story' || contentType === 'whitepaper' || contentType === 'guide') return 420;
  if (contentType === 'article' || contentType === 'newsletter') return 360;
  return 280;
}

function fallbackSectionHeading(input: PlannedLongFormGenerationInput, index: number): string {
  const article = ['The Editorial Lede', 'The Context Behind the Shift', 'What the Pattern Reveals', 'The Implication for Leaders', 'Closing Perspective'];
  const newsletter = ['Opening Note', 'The Signal', 'Why It Matters', 'Operator Note', 'What to Watch'];
  const guide = ['Before You Start', 'The Working Framework', 'How to Apply It', 'Examples and Decision Checks', 'Next Steps'];
  const whitepaper = ['Executive Summary', 'Methodology and Scope', 'Key Findings', 'Decision Framework', 'Recommendations'];
  if (input.contentType === 'article') return article[index] || `Article Section ${index + 1}`;
  if (input.contentType === 'newsletter') return newsletter[index] || `Newsletter Section ${index + 1}`;
  if (input.contentType === 'guide') return guide[index] || `Guide Section ${index + 1}`;
  if (input.contentType === 'whitepaper') return whitepaper[index] || `Whitepaper Section ${index + 1}`;
  return `Strategic Section ${index + 1}`;
}

function frameworkNameForContentType(input: PlannedLongFormGenerationInput): string {
  const normalizedSubject = normalizeBlogSubject(input.topic);
  if (input.contentType === 'guide') return `${normalizedSubject.subject} Application Framework`;
  if (input.contentType === 'whitepaper') return `${normalizedSubject.subject} Decision Model`;
  if (input.contentType === 'article') return `${normalizedSubject.subject} Editorial Lens`;
  if (input.contentType === 'newsletter') return `${normalizedSubject.subject} Signal Model`;
  return `${normalizedSubject.subject} Decision Framework`;
}

export function truncateAtSentence(value: string, maxLength: number): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const sliced = clean.slice(0, maxLength);
  const sentenceEnd = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf('!'), sliced.lastIndexOf('?'));
  if (sentenceEnd >= Math.floor(maxLength * 0.55)) return sliced.slice(0, sentenceEnd + 1).trim();
  const wordEnd = sliced.lastIndexOf(' ');
  return `${sliced.slice(0, wordEnd > 40 ? wordEnd : maxLength).trim()}...`;
}

export function sanitizeEditorialScaffoldingText(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .replace(/\bOpening\s+Thesis\b/gi, '')
    .replace(/\bHook\s+Intro\b/gi, '')
    .replace(/\bCategory\s+entry\s+guide\b/gi, 'Category entry')
    .replace(/\bA\s+Practical\s+H2-led\s+editorial\s+body\s+with\s+key\s+insights?(?:,\s*summary,\s*and\s*references)?\b/gi, '')
    .replace(/\bH2-led\s+editorial\s+body\s+with\s+key\s+insights?(?:,\s*summary,\s*and\s*references)?\b/gi, 'executive thought-leadership argument')
    .replace(/\bA\s+Practical\s+executive\s+thought-leadership\s+argument\b/gi, 'An executive perspective')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([:,.])/g, '$1')
    .replace(/:\s*$/g, '')
    .trim();
  return cleaned || fallback;
}

export function sanitizeGeneratedArticleHtml(value: string): string {
  return value
    .replace(/<h2\b[^>]*>\s*(Opening\s+Thesis|Hook\s+Intro)\s*<\/h2>/gi, '')
    .replace(/<h[3-6]\b[^>]*>\s*(Opening\s+Thesis|Hook\s+Intro)\s*<\/h[3-6]>/gi, '')
    .replace(/\bOpening\s+Thesis\s*:?\s*/gi, '')
    .replace(/\bHook\s+Intro\s*:?\s*/gi, '')
    .replace(/\bCategory\s+entry\s+guide\b/gi, 'category entry')
    .replace(/\bA\s+Practical\s+H2-led\s+editorial\s+body\s+with\s+key\s+insights?(?:,\s*summary,\s*and\s*references)?\b/gi, '')
    .replace(/\bH2-led\s+editorial\s+body\s+with\s+key\s+insights?(?:,\s*summary,\s*and\s*references)?\b/gi, 'executive thought-leadership argument')
    .replace(/\n{3,}/g, '\n\n');
}

export function sanitizeStoryScaffoldingText(value: string, fallback: string): string {
  const cleaned = sanitizeEditorialScaffoldingText(value, fallback)
    .replace(/^(The\s+Moment\s+)?Short\s+Story\s*:\s*/i, '$1')
    .replace(/^(The\s+Choice\s+That\s+Changed\s+)?Long\s+Story\s*:\s*/i, '$1')
    .replace(/^(Episode\s+One:\s+The\s+Moment\s+)?Episodic\s+Story\s*:\s*/i, '$1')
    .replace(/\bshort\s+story\s*:\s*/gi, '')
    .replace(/\blong\s+story\s*:\s*/gi, '')
    .replace(/\bepisodic\s+story\s*:\s*/gi, '')
    .replace(/\barticle\s+asks\s+leaders\b/gi, 'story reveals what changed')
    .replace(/\bexecutive\s+standard\b/gi, 'human standard')
    .replace(/\bbuyer\s+urgency\b/gi, 'felt urgency')
    .replace(/\boperational\s+ownership\b/gi, 'who had to carry the choice')
    .replace(/\bproof\s+requirements\b/gi, 'what made the moment believable')
    .replace(/\bdownstream\s+impact\b/gi, 'what changed afterward')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([:,.])/g, '$1')
    .trim();
  return cleaned || fallback;
}

export function sanitizeContentPlan(plan: ContentPlan, input: PlannedLongFormGenerationInput): ContentPlan {
  const fallbackTitle = buildContentTypeAlignedTitle(input);
  const sanitizedTitle = sanitizeEditorialScaffoldingText(plan.title, fallbackTitle)
    .replace(/:\s*An Executive Perspective$/i, '')
    .replace(/^Category\s+entry\s+strategy\s+for\s+first-time\s+buyers\s*:\s*/i, '')
    .trim();
  const title = sanitizedTitle === input.topic || sanitizedTitle.toLowerCase() === `${input.topic}: an executive perspective`.toLowerCase()
    ? fallbackTitle
    : sanitizedTitle;
  const company = input.companyContext?.companyName || 'the brand';
  return {
    ...plan,
    title,
    excerpt: truncateAtSentence(
      sanitizeEditorialScaffoldingText(plan.excerpt, buildContentTypeAlignedExcerpt(input, company)),
      excerptLimitForContentType(input.contentType),
    ),
    key_insights: plan.key_insights.map((insight) => sanitizeEditorialScaffoldingText(insight, `Make ${input.topic} specific, strategic, and action-oriented.`)),
    sections: plan.sections.map((section, index) => ({
      ...section,
      section_title: sanitizeEditorialScaffoldingText(section.section_title, fallbackSectionHeading(input, index)),
      section_goal: sanitizeEditorialScaffoldingText(section.section_goal, section.section_goal),
      unique_angle: sanitizeEditorialScaffoldingText(section.unique_angle, section.unique_angle),
      key_points: section.key_points.map((point) => sanitizeEditorialScaffoldingText(point, point)),
    })),
    framework: {
      ...plan.framework,
      name: sanitizeEditorialScaffoldingText(plan.framework.name, frameworkNameForContentType(input)),
      section_title: sanitizeEditorialScaffoldingText(plan.framework.section_title, fallbackSectionHeading(input, 1)),
    },
  };
}

export function sanitizeStoryContentPlan(plan: ContentPlan, topic: string, formatType: string, company: string): ContentPlan {
  const fallbackTitle = buildStoryAlignedTitle(topic, formatType);
  const sanitizedTitle = sanitizeStoryScaffoldingText(plan.title, fallbackTitle)
    .replace(/^Why\s+Short\s+Story:\s*/i, '')
    .replace(/^Short\s+Story:\s*/i, '')
    .replace(/\bNeeds a Clearer Decision Framework\b/gi, 'Became a Turning Point')
    .trim();
  const title = /short story\s*:|long story\s*:|episodic story\s*:|article asks leaders|decision criteria/i.test(sanitizedTitle)
    ? fallbackTitle
    : sanitizedTitle || fallbackTitle;
  const narrativeLabels = formatType === 'episodic_story'
    ? ['Cold Open', 'How They Got There', 'The Complication', 'The Unanswered Question']
    : formatType === 'long_story'
    ? ['The Scene', 'The Pressure Builds', 'The Choice', 'After the Turn', 'The Lesson That Remained']
    : ['The Moment Everything Shifted', 'The Friction Underneath', 'The Turn', 'What Stayed With Them'];
  return {
    ...plan,
    title,
    excerpt: truncateAtSentence(
      sanitizeStoryScaffoldingText(plan.excerpt, buildStoryAlignedExcerpt(topic, company)),
      420,
    ),
    key_insights: plan.key_insights.map((insight) => sanitizeStoryScaffoldingText(insight, `Keep ${normalizeStorySubject(topic)} grounded in story, tension, and consequence.`)),
    sections: plan.sections.map((section, index) => ({
      ...section,
      section_title: narrativeLabels[index] || sanitizeStoryScaffoldingText(section.section_title, `Story Beat ${index + 1}`),
      section_goal: sanitizeStoryScaffoldingText(section.section_goal, section.section_goal),
      unique_angle: sanitizeStoryScaffoldingText(section.unique_angle, section.unique_angle),
      key_points: section.key_points.map((point) => sanitizeStoryScaffoldingText(point, point)),
      requires_direct_answer: false,
      framework_role: 'none',
    })),
    faq: [],
    evidence_plan: plan.evidence_plan.length ? plan.evidence_plan : ['Use concrete narrative detail rather than citations.'],
  };
}

export function normalizeSectionText(value: string): Set<string> {
  const stop = new Set(['about', 'after', 'again', 'because', 'before', 'between', 'could', 'every', 'should', 'their', 'there', 'these', 'those', 'through', 'under', 'where', 'which', 'while', 'would']);
  return new Set(
    value
      .replace(/<[^>]+>/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 4 && !stop.has(token)),
  );
}

export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

export function paragraphTextsFromHtml(value: string): string[] {
  return [...value.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1] ?? ''))
    .filter((text) => text.length > 40);
}

export function paragraphOpeningSignature(value: string): string {
  const stop = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'their']);
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stop.has(token))
    .slice(0, 7)
    .join(' ');
}

function trimSentence(value: string, fallback: string): string {
  const sentence = stripHtml(value).split(/(?<=[.!?])\s+/)[0]?.trim();
  return sentence && sentence.length > 20 ? sentence : fallback;
}

type EditorialSectionLane =
  | 'diagnosis'
  | 'framework'
  | 'application'
  | 'evidence'
  | 'risk'
  | 'decision'
  | 'insight';

export function inferEditorialSectionLane(section: ContentPlanSection | undefined, index: number): EditorialSectionLane {
  const text = `${section?.section_title ?? ''} ${section?.content_type ?? ''} ${section?.section_goal ?? ''}`.toLowerCase();
  if (/\b(risk|mistake|avoid|failure|tradeoff)\b/.test(text)) return 'risk';
  if (/\b(framework|model|method|system|matrix|scorecard)\b/.test(text) || section?.framework_role === 'introduce') return 'framework';
  if (/\b(apply|implementation|next|action|execute|execution)\b/.test(text) || section?.framework_role === 'apply') return 'application';
  if (/\b(example|case|use case|scenario|evidence|proof)\b/.test(text) || section?.content_type === 'example' || section?.content_type === 'case_study') return 'evidence';
  if (/\b(criteria|decision|evaluate|compare|choose)\b/.test(text)) return 'decision';
  if (/\b(insight|miss|assumption|contrarian|observation)\b/.test(text) || section?.requires_opinionated_insight) return 'insight';
  return index === 0 ? 'diagnosis' : 'decision';
}

export function laneDirective(lane: EditorialSectionLane): string {
  switch (lane) {
    case 'diagnosis':
      return 'Editorial job: diagnose the market/customer pattern and name the strategic tension. Do not drift into implementation steps or decision criteria.';
    case 'framework':
      return 'Editorial job: introduce or explain the proprietary model. Focus on components, sequence, boundaries, and why the model changes judgment.';
    case 'application':
      return 'Editorial job: translate the model into operating moves. Focus on workflow, cadence, first action, and review loop.';
    case 'evidence':
      return 'Editorial job: prove the argument with scenarios or examples. Focus on before/after consequences and what the example demonstrates.';
    case 'risk':
      return 'Editorial job: expose failure modes and tradeoffs. Focus on what to avoid, early warning signals, and containment.';
    case 'decision':
      return 'Editorial job: help the reader choose. Focus on criteria, thresholds, options, and the decision rule.';
    case 'insight':
      return 'Editorial job: add the non-obvious viewpoint. Focus on what most teams misunderstand and the proprietary implication.';
  }
}

export function laneForbiddenFrames(lane: EditorialSectionLane): string {
  switch (lane) {
    case 'diagnosis':
      return 'Do not end with the standard owner/metric/risk checklist.';
    case 'framework':
      return 'Do not turn every component into the same owner/metric/risk checklist.';
    case 'application':
      return 'Do not restate the diagnosis or framework definition.';
    case 'evidence':
      return 'Do not summarize generic recommendations; show the scenario doing the work.';
    case 'risk':
      return 'Do not repeat the same action plan used in implementation sections.';
    case 'decision':
      return 'Do not restate broad strategic importance; give the decision logic.';
    case 'insight':
      return 'Do not repeat the article thesis; add a sharper inference.';
  }
}

export function buildSectionDepthExpansion(args: {
  sectionTitle: string;
  topic: string;
  frameworkName: string;
  perspective: OrganizationPerspective;
  planSection?: ContentPlanSection;
  index: number;
}): string {
  const title = escapeHtml(args.sectionTitle);
  const topic = escapeHtml(args.topic);
  const framework = escapeHtml(args.frameworkName);
  const audience = escapeHtml(args.perspective.primaryAudience);
  const viewpoint = escapeHtml(trimSentence(args.perspective.companyViewpoint, `${args.topic} needs a clearer operating point of view.`));
  const observation = escapeHtml(trimSentence(args.perspective.marketObservation, `The market pattern around ${args.topic} is uneven execution.`));
  const recommendation = escapeHtml(trimSentence(args.perspective.strategicRecommendation, `Leaders should convert ${args.topic} into owned decisions and measurable next steps.`));
  const tradeoff = escapeHtml(trimSentence(args.perspective.tradeoffAnalysis, `The tradeoff is avoiding generic advice that hides sequencing and ownership.`));
  const insight = escapeHtml(trimSentence(args.perspective.proprietaryInsight, `The useful insight is where ${args.topic} changes operating behavior.`));
  const lane = inferEditorialSectionLane(args.planSection, args.index);
  const uniqueAngle = escapeHtml(args.planSection?.unique_angle || `Make ${args.sectionTitle} distinct from the rest of the article.`);
  const keyPoint = escapeHtml(args.planSection?.key_points?.[0] || args.planSection?.section_goal || `Develop a specific reader takeaway for ${args.sectionTitle}.`);

  if (lane === 'risk') {
    return `<p>The risk lens in ${title.toLowerCase()} should stay focused on the failure pattern, not repeat the article's action plan. ${tradeoff} Tie that warning to ${uniqueAngle}, then explain which constraint makes the risk visible before it becomes expensive.</p><p>Use one concrete containment move: what leaders pause, what they inspect, and what boundary prevents the same mistake from scaling. ${keyPoint} This gives the section a distinct cautionary role rather than another version of the implementation guidance.</p>`;
  }
  if (lane === 'framework') {
    // Deliver the framework as a co-located enumerated structure (components →
    // sequence → boundary) rather than only *describing* one — a bare claim of
    // a model/framework with no adjacent steps/components fails the Framework
    // Delivery Gate. Reader-facing prose only; no authoring/meta directives.
    return `<p>${framework} changes how ${audience}s interpret ${topic}: instead of generic advice, it names the moving parts and the order they apply in. ${viewpoint}</p><ol><li><strong>Core components</strong> — the few elements that make ${framework} work, and what each one decides.</li><li><strong>Sequence</strong> — the order the components apply in, and why moving out of order breaks the model.</li><li><strong>Boundary</strong> — the conditions where ${framework} stops being useful and judgment takes over.</li></ol><p>${uniqueAngle} ${insight}</p>`;
  }
  if (lane === 'application') {
    return `<p>${title} should translate ${topic} into a visible operating change. ${recommendation} Keep the focus on the first workflow shift, the cadence that keeps it alive, and the handoff that prevents the recommendation from becoming a one-time content exercise.</p><p>Application depth comes from the review loop, not another restatement of why the topic matters. Use ${uniqueAngle} to define what changes next week, then use ${keyPoint} as the practical check that proves the work is moving.</p>`;
  }
  if (lane === 'evidence') {
    return `<p>Examples in ${title.toLowerCase()} should prove one claim rather than summarize the whole article again. ${observation} Show the scenario, the constraint, and the consequence so the reader sees the pattern instead of being told the recommendation twice.</p><p>The lesson should connect back to ${framework} through a specific component. Use ${uniqueAngle} to explain what the example demonstrates, and use ${keyPoint} to make the scenario operationally believable.</p>`;
  }
  if (lane === 'decision') {
    return `<p>${title} should help ${audience}s choose between credible options. Do that by naming the threshold, the comparison criteria, and the condition that changes the decision. ${uniqueAngle}</p><p>The decision logic should be narrower than the article thesis. Use ${framework} to show which criterion matters first, then connect ${keyPoint} to the choice the reader can actually make.</p>`;
  }
  if (lane === 'insight') {
    return `<p>${title} should add the article's non-obvious inference. ${insight} Make the insight sharper by contrasting what most teams assume with what the organization has learned about ${topic}.</p><p>The section should not become another recommendation list. Use ${uniqueAngle} to explain the implication, then connect ${keyPoint} to the belief or market pattern that only this organization is positioned to name.</p>`;
  }
  return `<p>${title} should diagnose the specific tension behind ${topic}. ${observation} Keep this section focused on what is happening in the market or customer environment before the article moves into models, examples, or action.</p><p>The point of the diagnosis is ${uniqueAngle}. Use ${keyPoint} to show why the default response is insufficient, then hand the reader to the next section with a sharper problem definition.</p>`;
}

