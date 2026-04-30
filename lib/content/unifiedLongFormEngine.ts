import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';
import { contentTypeConfig, isLongFormContentType, type LongFormContentType } from './longFormContentTypeConfig';
import {
  runPlannedLongFormGeneration,
  type ContentPlan,
  type LongFormQualityReport,
} from './longFormPlanningEngine';
import type {
  ContentImprovementHooks,
  ContentScore,
  SearchIntent,
  SerpStructureHints,
  TopicEntityMap,
} from './longFormSeoIntelligence';
import type {
  CompetitorContentProfile,
  ContentPositioning,
  DifferentiationStrategy,
} from './longFormDifferentiationIntelligence';
import type {
  ContentPerformance,
  ContentPerformanceFeatureSnapshot,
  PerformanceInsights,
} from './longFormPerformanceLearning';
import {
  evaluateLongFormContent,
  type LongFormContentEvaluationResult,
} from './longFormContentEvaluator';
import { getLongFormTemplateSpec } from './longFormTemplateSpecs';

export interface UnifiedLongFormGenerationInput
  extends Omit<BlogGenerationRequest, 'contentType' | 'formatType' | 'template_blocks' | 'target_words'> {
  contentType: LongFormContentType;
  formatType?: string;
  templateBlocks?: BlogGenerationRequest['template_blocks'];
  targetWordCount?: number;
  seoContext?: string;
  contentPerformance?: ContentPerformance[];
  performanceFeatureSnapshots?: ContentPerformanceFeatureSnapshot[];
  performanceInsights?: PerformanceInsights;
}

export interface UnifiedLongFormEngineTrace {
  engine: 'unifiedLongFormEngine';
  contentType: LongFormContentType;
  formatType: string;
  templateName?: string;
  targetWordCount?: number;
  configVersion: 'long-form-config-v1';
  templateSpecApplied: boolean;
  generationLogic: 'planned-sectionwise-v1' | 'compatibility-core';
  searchIntent?: SearchIntent;
  topicEntityMap?: TopicEntityMap;
  serpStructureHints?: SerpStructureHints;
  contentPositioning?: ContentPositioning;
  competitorContentProfile?: CompetitorContentProfile;
  differentiationStrategy?: DifferentiationStrategy;
  contentPlan?: ContentPlan;
  qualityReport?: LongFormQualityReport;
  contentScore?: ContentScore;
  improvementHooks?: ContentImprovementHooks;
  performanceInsights?: PerformanceInsights;
  generatedFeatureSnapshot?: ContentPerformanceFeatureSnapshot;
  contentEvaluation?: LongFormContentEvaluationResult;
  fallbackReason?: string;
}

export type UnifiedLongFormGenerationResult = BlogGenerationResult & {
  engine_trace?: UnifiedLongFormEngineTrace;
};

function normalizeContentType(contentType: LongFormContentType): BlogGenerationRequest['contentType'] {
  // Case studies are preserved as a user-facing content type, but the current
  // generation core represents them as the blog case-study format.
  return contentType === 'case-study' ? 'blog' : contentType;
}

function buildAnswers(input: UnifiedLongFormGenerationInput, configFormat: string): Record<string, string> | undefined {
  const answers = { ...(input.answers || {}) };

  if (input.targetWordCount && !answers.target_word_count) {
    answers.target_word_count = String(input.targetWordCount);
  }

  const config = contentTypeConfig[input.contentType];
  const templateSpec = getLongFormTemplateSpec(input.contentType, configFormat, input.template_name);
  const architectureDirectives: string[] = [
    `Content type configuration: ${config.structureStyle}.`,
    `Summary style: ${config.summaryStyle}.`,
    `Citation style: ${config.citationStyle}.`,
  ];

  if (templateSpec) {
    architectureDirectives.push(
      `Template sections: ${templateSpec.sections
        .map((section) => `${section.label} (${section.intent})`)
        .join(' -> ')}`,
    );
  }

  if (input.seoContext) architectureDirectives.push(input.seoContext);

  answers.unified_long_form_architecture = architectureDirectives.join(' ');
  return Object.keys(answers).length > 0 ? answers : undefined;
}

export async function runUnifiedLongFormGeneration(
  input: UnifiedLongFormGenerationInput,
): Promise<UnifiedLongFormGenerationResult> {
  if (!isLongFormContentType(input.contentType)) {
    throw new Error(`Unsupported long-form content type: ${input.contentType}`);
  }

  const config = contentTypeConfig[input.contentType];
  const requestedFormat = input.contentType === 'case-study'
    ? 'case-study'
    : input.formatType || config.defaultFormat;
  const formatType = config.allowedFormats.includes(requestedFormat)
    ? requestedFormat
    : config.defaultFormat;
  const normalizedContentType = normalizeContentType(input.contentType);
  const traceBase = {
    engine: 'unifiedLongFormEngine' as const,
    contentType: input.contentType,
    formatType,
    templateName: input.template_name,
    targetWordCount: input.targetWordCount,
    configVersion: 'long-form-config-v1' as const,
    templateSpecApplied: Boolean(getLongFormTemplateSpec(input.contentType, formatType, input.template_name)),
  };

  if ((input.mode || 'full') === 'full') {
    try {
      const planned = await runPlannedLongFormGeneration({
        ...input,
        formatType,
      });
      const contentEvaluation = planned.generation.needs_clarification === false && planned.generation.mode === 'full'
        ? evaluateLongFormContent({
            generatedContent: planned.generation.result.content_html,
            topic: input.topic,
            contentType: input.contentType,
            targetIntent: planned.searchIntent,
            engineTrace: {
              searchIntent: planned.searchIntent,
              topicEntityMap: planned.topicEntityMap,
              contentPositioning: planned.contentPositioning,
              differentiationStrategy: planned.differentiationStrategy,
              performanceInsights: planned.performanceInsights,
              contentPlan: planned.contentPlan,
            },
          })
        : undefined;

      return {
        ...planned.generation,
        engine_trace: {
          ...traceBase,
          generationLogic: 'planned-sectionwise-v1',
          searchIntent: planned.searchIntent,
          topicEntityMap: planned.topicEntityMap,
          serpStructureHints: planned.serpStructureHints,
          contentPositioning: planned.contentPositioning,
          competitorContentProfile: planned.competitorContentProfile,
          differentiationStrategy: planned.differentiationStrategy,
          contentPlan: planned.contentPlan,
          qualityReport: planned.qualityReport,
          contentScore: planned.contentScore,
          improvementHooks: planned.improvementHooks,
          performanceInsights: planned.performanceInsights,
          generatedFeatureSnapshot: planned.generatedFeatureSnapshot,
          contentEvaluation,
        },
      };
    } catch (error) {
      console.warn('[unifiedLongFormEngine] planned generation failed; falling back to compatibility core', error);
      const result = await runBlogGeneration({
        ...input,
        contentType: normalizedContentType,
        formatType: formatType as BlogGenerationRequest['formatType'],
        template_blocks: input.templateBlocks,
        answers: buildAnswers(input, formatType),
      });

      return {
        ...result,
        engine_trace: {
          ...traceBase,
          generationLogic: 'compatibility-core',
          fallbackReason: error instanceof Error ? error.message : 'Unknown planned-generation error',
        },
      };
    }
  }

  const result = await runBlogGeneration({
    ...input,
    contentType: normalizedContentType,
    formatType: formatType as BlogGenerationRequest['formatType'],
    template_blocks: input.templateBlocks,
    answers: buildAnswers(input, formatType),
  });

  return {
    ...result,
    engine_trace: {
      ...traceBase,
      generationLogic: 'compatibility-core',
    },
  };
}
