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

function isSeoDrivenContentType(contentType: LongFormContentType): boolean {
  return contentTypeConfig[contentType].seoPriority !== 'low';
}

function stripCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(value: string): number {
  return stripHtml(value).split(/\s+/).filter(Boolean).length;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  const cleaned = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  return cleaned.length > 0 ? cleaned : fallback;
}

function uniqueKeyPoints(sections: ContentPlanSection[]): ContentPlanSection[] {
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

function pickSectionEntities(entityMap: TopicEntityMap, index: number): string[] {
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

function buildFallbackPlan(
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

function normalizeBlogSubject(topic: string): { subject: string; audience: string | null; display: string } {
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

function excerptLimitForContentType(contentType: LongFormContentType): number {
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

function truncateAtSentence(value: string, maxLength: number): string {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const sliced = clean.slice(0, maxLength);
  const sentenceEnd = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf('!'), sliced.lastIndexOf('?'));
  if (sentenceEnd >= Math.floor(maxLength * 0.55)) return sliced.slice(0, sentenceEnd + 1).trim();
  const wordEnd = sliced.lastIndexOf(' ');
  return `${sliced.slice(0, wordEnd > 40 ? wordEnd : maxLength).trim()}...`;
}

function sanitizeEditorialScaffoldingText(value: string, fallback: string): string {
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

function sanitizeGeneratedArticleHtml(value: string): string {
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

function sanitizeStoryScaffoldingText(value: string, fallback: string): string {
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

function sanitizeContentPlan(plan: ContentPlan, input: PlannedLongFormGenerationInput): ContentPlan {
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

function sanitizeStoryContentPlan(plan: ContentPlan, topic: string, formatType: string, company: string): ContentPlan {
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

function normalizeSectionText(value: string): Set<string> {
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

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

function paragraphTextsFromHtml(value: string): string[] {
  return [...value.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1] ?? ''))
    .filter((text) => text.length > 40);
}

function paragraphOpeningSignature(value: string): string {
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

function inferEditorialSectionLane(section: ContentPlanSection | undefined, index: number): EditorialSectionLane {
  const text = `${section?.section_title ?? ''} ${section?.content_type ?? ''} ${section?.section_goal ?? ''}`.toLowerCase();
  if (/\b(risk|mistake|avoid|failure|tradeoff)\b/.test(text)) return 'risk';
  if (/\b(framework|model|method|system|matrix|scorecard)\b/.test(text) || section?.framework_role === 'introduce') return 'framework';
  if (/\b(apply|implementation|next|action|execute|execution)\b/.test(text) || section?.framework_role === 'apply') return 'application';
  if (/\b(example|case|use case|scenario|evidence|proof)\b/.test(text) || section?.content_type === 'example' || section?.content_type === 'case_study') return 'evidence';
  if (/\b(criteria|decision|evaluate|compare|choose)\b/.test(text)) return 'decision';
  if (/\b(insight|miss|assumption|contrarian|observation)\b/.test(text) || section?.requires_opinionated_insight) return 'insight';
  return index === 0 ? 'diagnosis' : 'decision';
}

function laneDirective(lane: EditorialSectionLane): string {
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

function laneForbiddenFrames(lane: EditorialSectionLane): string {
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

function buildSectionDepthExpansion(args: {
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

function dedupeSectionsForPublication(
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

function ensureMinimumPublishableSections(
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

async function generateContentPlan(
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

async function generateSection(input: {
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
function applyAdaptiveSizingToPlan(plan: ContentPlan, ctx: {
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

function validateLongFormQuality(
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
async function repairFailedSections(
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
