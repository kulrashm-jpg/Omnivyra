import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { htmlToBlocks } from '../blog/htmlToBlocks';
import type { BlogGenerationRequest, BlogGenerationResult, CompanyContext } from '../blog/runBlogGeneration';
import { injectInternalLinks } from '../blog/runBlogGenerationDataAccess';
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
  const baseSections = templateSpec?.sections.filter((section) => section.id !== 'key_insights' && section.id !== 'references');
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
    key_points: [
      `${section.label} must serve a separate reader job.`,
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
    title: `${input.topic}: A Practical ${contentTypeConfig[input.contentType].structureStyle}`,
    excerpt: `A structured, brand-led perspective on ${input.topic} with a reusable framework, examples, and practical next steps.`,
    key_insights: [
      `${input.topic} needs a differentiated ${searchIntent} plan with ${contentPositioning.primary} positioning, not another generic overview.`,
      `The strongest content separates explanation, application, examples, and insight.`,
      `${company}'s point of view should shape the recommendations readers act on.`,
    ],
    sections: uniqueKeyPoints(sections),
    framework: {
      name: `${input.topic.replace(/[^\w\s]/g, '').trim() || 'Authority'} Readiness Framework`,
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
      excerpt: String(parsed.excerpt || fallback.excerpt).slice(0, 280),
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
  const response = await runCompletionWithOperation({
    operation: 'blogGeneration',
    companyId: input.company_id,
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
- The plan must cover explanation, application, examples, and insights.
- SEO-driven content requires 4-6 FAQ questions with direct concise answers.
- At least two sections must set requires_direct_answer=true.
- At least two sections must set requires_opinionated_insight=true.
- Include one named framework with model_type and components.
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
                sections: templateSpec.sections.map((section) => ({
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
  }));
  const result = await runCompletionWithOperation({
    operation: 'blogGeneration',
    companyId: input.request.company_id,
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
- Add new information; do not reuse phrasing or examples from prior sections.
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
- If requires_opinionated_insight=true, challenge a common assumption with a non-obvious insight.
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
          tone: input.request.tone,
          intent: input.request.intent,
          priorSections: priorSummaries,
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
  };
}

async function repairFailedSections(
  input: PlannedLongFormGenerationInput,
  plan: ContentPlan,
  sections: SectionGenerationResult[],
  report: LongFormQualityReport,
  searchIntent: SearchIntent,
  serpStructureHints: SerpStructureHints,
  contentPositioning: ContentPositioning,
  differentiationStrategy: DifferentiationStrategy,
): Promise<{ sections: SectionGenerationResult[]; report: LongFormQualityReport }> {
  if (report.issues.length === 0) return { sections, report };

  const repaired = [...sections];
  const repairedSections: string[] = [];
  for (let index = 0; index < plan.sections.length; index += 1) {
    const planSection = plan.sections[index];
    const current = repaired[index];
    if (!current) continue;
    const reasons = sectionNeedsRepair(planSection, current, report, plan);
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

    if (repairedSections.length >= 3) break;
  }

  const nextReport = validateLongFormQuality(plan, repaired, input.contentType);
  return {
    sections: repaired,
    report: {
      ...nextReport,
      repairedSections,
    },
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
  if (realReferences.length === 0) return '';
  return `<h2>References</h2><ol>${realReferences
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

function buildContentHtml(input: PlannedLongFormGenerationInput, plan: ContentPlan, sections: SectionGenerationResult[]): string {
  return [
    buildKeyInsightsHtml(plan.key_insights),
    ...sections.map((section) => section.html),
    isSeoDrivenContentType(input.contentType) ? buildFaqHtml(plan.faq) : '',
    '<h2>Summary</h2>',
    `<p>${escapeHtml(plan.excerpt)}</p>`,
    buildReferencesHtml(sections),
  ].filter(Boolean).join('\n\n');
}

async function buildContentBlocks(input: PlannedLongFormGenerationInput, contentHtml: string): Promise<ReturnType<typeof htmlToBlocks>> {
  let contentBlocks = htmlToBlocks(contentHtml);
  contentBlocks = await injectInternalLinks(
    contentBlocks,
    input.topic.trim(),
    input.company_id,
    input.blogTable || 'blogs',
  );
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

export async function runPlannedLongFormGeneration(
  input: PlannedLongFormGenerationInput,
): Promise<PlannedLongFormGenerationResult> {
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
  const plan = await generateContentPlan(
    input,
    templateSpec,
    searchIntent,
    topicEntityMap,
    serpStructureHints,
    contentPositioning,
    competitorContentProfile,
    differentiationStrategy,
    performanceInsights,
  );
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
  }

  const initialReport = validateLongFormQuality(plan, generatedSections, input.contentType);
  let { sections, report } = await repairFailedSections(
    input,
    plan,
    generatedSections,
    initialReport,
    searchIntent,
    serpStructureHints,
    contentPositioning,
    differentiationStrategy,
  );
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
  const generatedFeatureSnapshot = extractFeatureSnapshot({
    content_id: `${input.contentType}:${input.topic}`,
    plan,
    sections,
    positioning: contentPositioning,
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
        category: contentTypeConfig[input.contentType].structureStyle,
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
    },
  };
}
