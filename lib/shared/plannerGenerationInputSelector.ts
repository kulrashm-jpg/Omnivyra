import type { PlannerTitleSanitizerResult } from './plannerTitleSanitizer';
import { normalizeLogicalContentType } from './contentTypeIntegrity';

export type PlannerGenerationInputSelection = {
  original_title: string;
  generation_input_title: string;
  original_topic: string;
  generation_input_topic: string;
  title_selected_from: 'original' | 'sanitized';
  topic_selected_from: 'original' | 'sanitized';
  reason: string[];
  confidence: number;
};

export type PlannerGenerationInputSelectorInput = {
  originalTitle?: string | null;
  originalTopic?: string | null;
  contentType?: string | null;
  platform?: string | null;
  sanitizerResult?: PlannerTitleSanitizerResult | null;
  metadata?: unknown;
  source?: string | null;
};

const HIGH_CONFIDENCE_THRESHOLD = 0.72;
const CRITICAL_TITLE_REASONS = new Set([
  'template_collision',
  'malformed_headline_wrapper',
  'broken_grammar_pattern',
  'duplicate_determiner',
  'incomplete_headline',
]);
const USEFUL_TITLE_REASONS = new Set([
  'weak_generic_title',
  'clickbait_stacking',
]);
const TOPIC_REPAIR_REASONS = new Set([
  'vague_topic',
  'overly_broad_topic',
  'duplicate_topic',
  'unsupported_content_type_topic_pairing',
  'low_information_topic',
]);

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\b(the|a|an|and|or|to|of|for|with|your|our|this|that)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.99, Math.round(value * 100) / 100));
}

function hasChanged(original: string, suggested: string): boolean {
  return !!suggested && normalizeKey(original) !== normalizeKey(suggested);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function readSanitizerResult(metadata: unknown): PlannerTitleSanitizerResult | null {
  const root = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : null;
  const candidate = root?.planner_title_sanitizer ??
    (root?.editor_grade_results && typeof root.editor_grade_results === 'object'
      ? (root.editor_grade_results as Record<string, unknown>).planner_title_sanitizer
      : null);
  if (!candidate || typeof candidate !== 'object') return null;
  const obj = candidate as Partial<PlannerTitleSanitizerResult>;
  if (typeof obj.sanitized_title === 'string' || typeof obj.sanitized_topic === 'string') {
    return obj as PlannerTitleSanitizerResult;
  }
  return null;
}

function titleConfidence(result: PlannerTitleSanitizerResult | null, original: string, suggested: string): number {
  if (!result || !hasChanged(original, suggested)) return 0;
  const reasons = result.title_repair_reason ?? [];
  const hasCritical = reasons.some((reason) => CRITICAL_TITLE_REASONS.has(reason));
  const hasUseful = reasons.some((reason) => USEFUL_TITLE_REASONS.has(reason));
  const deltaBoost = Math.min(0.25, Math.max(0, Number(result.score_delta ?? 0)) / 100);
  return clampConfidence(0.48 + deltaBoost + (hasCritical ? 0.28 : 0) + (hasUseful ? 0.14 : 0));
}

function topicConfidence(result: PlannerTitleSanitizerResult | null, original: string, suggested: string): number {
  if (!result || !hasChanged(original, suggested)) return 0;
  const reasons = result.topic_repair_reason ?? [];
  const hasRepairReason = reasons.some((reason) => TOPIC_REPAIR_REASONS.has(reason));
  const deltaBoost = Math.min(0.22, Math.max(0, Number(result.score_delta ?? 0)) / 100);
  return clampConfidence(0.5 + deltaBoost + (hasRepairReason ? 0.24 : 0));
}

export function selectPlannerGenerationInput(input: PlannerGenerationInputSelectorInput): PlannerGenerationInputSelection {
  const sanitizerResult = input.sanitizerResult ?? readSanitizerResult(input.metadata);
  const originalTitle = clean(input.originalTitle) || clean(sanitizerResult?.original_title);
  const originalTopic = clean(input.originalTopic) || clean(sanitizerResult?.original_topic) || originalTitle;
  const sanitizedTitle = clean(sanitizerResult?.sanitized_title) || originalTitle;
  const sanitizedTopic = clean(sanitizerResult?.sanitized_topic) || originalTopic;
  const titleScore = titleConfidence(sanitizerResult, originalTitle, sanitizedTitle);
  const topicScore = topicConfidence(sanitizerResult, originalTopic, sanitizedTopic);
  const useSanitizedTitle = titleScore >= HIGH_CONFIDENCE_THRESHOLD;
  const topicMirrorsTitle = normalizeKey(originalTopic) === normalizeKey(originalTitle);
  const useSanitizedTopic = topicScore >= HIGH_CONFIDENCE_THRESHOLD || (useSanitizedTitle && topicMirrorsTitle);
  const selectedTopic = topicScore >= HIGH_CONFIDENCE_THRESHOLD
    ? sanitizedTopic
    : useSanitizedTitle && topicMirrorsTitle
      ? sanitizedTitle
      : originalTopic;
  const selection: PlannerGenerationInputSelection = {
    original_title: originalTitle,
    generation_input_title: useSanitizedTitle ? sanitizedTitle : originalTitle,
    original_topic: originalTopic,
    generation_input_topic: selectedTopic,
    title_selected_from: useSanitizedTitle ? 'sanitized' : 'original',
    topic_selected_from: useSanitizedTopic ? 'sanitized' : 'original',
    reason: unique([
      ...(useSanitizedTitle ? sanitizerResult?.title_repair_reason ?? [] : []),
      ...(useSanitizedTopic ? sanitizerResult?.topic_repair_reason ?? [] : []),
      ...(useSanitizedTopic && topicScore < HIGH_CONFIDENCE_THRESHOLD ? sanitizerResult?.title_repair_reason ?? [] : []),
    ]),
    confidence: Math.max(titleScore, topicScore),
  };
  emitGenerationInputSelectionTelemetry(input, selection);
  return selection;
}

export function emitGenerationInputSelectionTelemetry(
  input: PlannerGenerationInputSelectorInput,
  selection: PlannerGenerationInputSelection,
): void {
  console.info('[generation-input-selection]', {
    source: input.source ?? null,
    content_type: normalizeLogicalContentType(input.contentType, 'post'),
    platform: input.platform ?? null,
    original: {
      title: selection.original_title,
      topic: selection.original_topic,
    },
    selected: {
      title: selection.generation_input_title,
      topic: selection.generation_input_topic,
    },
    reason: selection.reason,
    confidence: selection.confidence,
    title_selected_from: selection.title_selected_from,
    topic_selected_from: selection.topic_selected_from,
  });
}
