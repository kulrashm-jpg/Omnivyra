import {
  createEditorGradeResult,
  isBlockingSeverity,
  isRepairSeverity,
  mergeEditorGradeResults,
  normalizeEditorGradeSeverity,
  type EditorGradeCheck,
  type EditorGradePhase,
  type EditorGradeResult,
  type EditorGradeStatus,
} from './editorGradeReadiness';
import { normalizeLogicalContentType } from './contentTypeIntegrity';

export type GenerationAcceptanceInput = {
  content?: string | null;
  title?: string | null;
  logicalContentType?: string | null;
  publishContentType?: string | null;
  platform?: string | null;
  phase: Extract<EditorGradePhase, 'generation' | 'variant_generation' | 'scheduling'>;
  source?: string | null;
  editorGradeResults?: Array<EditorGradeResult | null | undefined>;
  metadata?: unknown;
};

export type GenerationAcceptanceResult = {
  editor_grade_status: EditorGradeStatus;
  editor_grade_score: number;
  failing_checks: string[];
  warnings: string[];
  check_details: EditorGradeCheck[];
  representation_warnings?: string[];
  recommended_actions: string[];
};

const PLACEHOLDER_PATTERNS = [
  /^\s*$/i,
  /\[MASTER GENERATION FAILED/i,
  /\[PLATFORM ADAPTATION FAILED/i,
  /\[PLATFORM MEDIA BLUEPRINT\]/i,
  /\[MEDIA BLUEPRINT\]/i,
  /\bplaceholder\b/i,
  /\btbd\b/i,
  /\bcoming soon\b/i,
  /^content for\b/i,
  /^execution job content placeholder\b/i,
];

const REPAIR_ACTIONS: Record<string, string> = {
  planner_title: 'Review planner title/topic repair suggestion before generation.',
  title: 'Repair title before treating content as editor-grade.',
  hook: 'Repair hook or opening sentence.',
  post: 'Review post body quality before treating content as editor-grade.',
  poll: 'Repair poll structure before publication.',
  story: 'Repair story structure before treating content as editor-grade.',
  article: 'Repair article structure before treating content as editor-grade.',
  thread: 'Repair thread structure before treating content as editor-grade.',
  content_type: 'Review logical content type versus publishing content type.',
  placeholder: 'Regenerate or replace placeholder content.',
  validation: 'Review existing validation warnings.',
};

const EXPECTED_PUBLISHING_REPRESENTATIONS: Record<string, Set<string>> = {
  article: new Set(['post', 'feed_post']),
  poll: new Set(['post', 'feed_post']),
  story: new Set(['post', 'feed_post']),
  thread: new Set(['post', 'tweet', 'feed_post']),
};

function isEditorGradeResult(value: unknown): value is EditorGradeResult {
  return !!value &&
    typeof value === 'object' &&
    Array.isArray((value as EditorGradeResult).checks) &&
    typeof (value as EditorGradeResult).score === 'number' &&
    typeof (value as EditorGradeResult).status === 'string';
}

function collectEditorGradeResults(value: unknown, acc: EditorGradeResult[] = []): EditorGradeResult[] {
  if (!value) return acc;
  if (isEditorGradeResult(value)) {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEditorGradeResults(item, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectEditorGradeResults(nested, acc);
    }
  }
  return acc;
}

function normalizeCheckId(id: string): string {
  return String(id || '').trim() || 'unknown_check';
}

function isPlaceholderContent(content: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(content));
}

function isExpectedPublishingRepresentation(logical: string, publish: string): boolean {
  if (!logical || !publish || logical === publish) return true;
  return EXPECTED_PUBLISHING_REPRESENTATIONS[logical]?.has(publish) ?? false;
}

function buildSyntheticChecks(input: GenerationAcceptanceInput): EditorGradeCheck[] {
  const checks: EditorGradeCheck[] = [];
  const content = String(input.content ?? '');
  const logical = normalizeLogicalContentType(input.logicalContentType, '');
  const publish = normalizeLogicalContentType(input.publishContentType, logical || 'post');
  const hasPlaceholder = isPlaceholderContent(content);
  const hasMismatch = !!logical && !!publish && logical !== publish;
  const expectedRepresentation = hasMismatch && isExpectedPublishingRepresentation(logical, publish);

  checks.push({
    id: 'acceptance.placeholder_content',
    phase: input.phase,
    passed: !hasPlaceholder,
    severity: hasPlaceholder ? 'blocking' : 'info',
    message: hasPlaceholder ? 'Generated content is empty, failed, or placeholder-like.' : undefined,
    score: hasPlaceholder ? 0 : 100,
  });

  checks.push({
    id: 'acceptance.logical_content_type_match',
    phase: input.phase,
    passed: true,
    severity: 'informational',
    message: hasMismatch ? `Logical content type "${logical}" differs from publishing content type "${publish}".` : undefined,
    score: 100,
    metadata: {
      logical_content_type: logical || null,
      publish_content_type: publish || null,
      classification: hasMismatch ? 'representation' : 'match',
      expected_publishing_representation: expectedRepresentation,
    },
  });

  return checks;
}

function recommendedActionsFor(checkIds: string[], status: EditorGradeStatus): string[] {
  if (status === 'approved') return ['Content is currently editor-grade by calibrated checks.'];
  const actions = new Set<string>();
  for (const id of checkIds) {
    if (id.includes('placeholder')) actions.add(REPAIR_ACTIONS.placeholder);
    else if (id.startsWith('planner_title') || id.startsWith('planner_topic')) actions.add(REPAIR_ACTIONS.planner_title);
    else if (id.startsWith('title.')) actions.add(REPAIR_ACTIONS.title);
    else if (id.startsWith('hook.')) actions.add(REPAIR_ACTIONS.hook);
    else if (id.startsWith('post.')) actions.add(REPAIR_ACTIONS.post);
    else if (id.startsWith('poll.')) actions.add(REPAIR_ACTIONS.poll);
    else if (id.startsWith('story.')) actions.add(REPAIR_ACTIONS.story);
    else if (id.startsWith('article.')) actions.add(REPAIR_ACTIONS.article);
    else if (id.startsWith('thread.')) actions.add(REPAIR_ACTIONS.thread);
    else if (id.includes('logical_content_type')) actions.add(REPAIR_ACTIONS.content_type);
    else actions.add(REPAIR_ACTIONS.validation);
  }
  return Array.from(actions);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueChecks(checks: EditorGradeCheck[]): EditorGradeCheck[] {
  const seen = new Set<string>();
  const result: EditorGradeCheck[] = [];
  for (const check of checks) {
    const key = `${check.phase}:${check.id}:${check.passed}:${check.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(check);
  }
  return result;
}

function isRepresentationCheck(check: EditorGradeCheck): boolean {
  return check.id === 'acceptance.logical_content_type_match' &&
    check.metadata?.classification === 'representation';
}

function deriveAcceptanceStatus(merged: EditorGradeResult): EditorGradeStatus {
  if (merged.checks.some((check) => !check.passed && isBlockingSeverity(check.severity))) return 'rejected';
  if (merged.status === 'rejected') return 'rejected';
  if (merged.checks.some((check) => !check.passed && !isRepresentationCheck(check) && isRepairSeverity(check.severity))) return 'repair_required';
  return 'approved';
}

function deriveQualityScore(merged: EditorGradeResult): number {
  const qualityChecks = merged.checks.filter((check) => !isRepresentationCheck(check));
  if (qualityChecks.length === 0) return 100;
  const total = qualityChecks.reduce((sum, check) => {
    if (normalizeEditorGradeSeverity(check.severity) === 'informational') return sum + 100;
    if (typeof check.score === 'number') return sum + Math.max(0, Math.min(100, Math.round(check.score)));
    if (check.passed) return sum + 100;
    if (isBlockingSeverity(check.severity)) return sum;
    if (isRepairSeverity(check.severity)) return sum + 65;
    return sum + 85;
  }, 0);
  return Math.max(0, Math.min(100, Math.round(total / qualityChecks.length)));
}

function collectRepresentationWarnings(checks: EditorGradeCheck[]): string[] {
  return unique(checks
    .filter((check) => check.id === 'acceptance.logical_content_type_match' && check.metadata?.classification === 'representation')
    .map((check) => normalizeCheckId(check.id)));
}

export function evaluateGenerationAcceptance(input: GenerationAcceptanceInput): GenerationAcceptanceResult {
  const results = [
    ...(input.editorGradeResults ?? []).filter(isEditorGradeResult),
    ...collectEditorGradeResults(input.metadata),
    createEditorGradeResult({ checks: buildSyntheticChecks(input) }),
  ];
  const merged = mergeEditorGradeResults(results);
  const qualityScore = deriveQualityScore(merged);
  const failed = merged.checks.filter((check) => !check.passed && !isRepresentationCheck(check));
  const failingChecks = unique(failed
    .filter((check) => isBlockingSeverity(check.severity) || isRepairSeverity(check.severity))
    .map((check) => normalizeCheckId(check.id)));
  const warnings = unique(failed
    .filter((check) => !(isBlockingSeverity(check.severity) || isRepairSeverity(check.severity)))
    .map((check) => normalizeCheckId(check.id)));
  const representationWarnings = collectRepresentationWarnings(merged.checks);
  const status = deriveAcceptanceStatus(merged);
  const score = status === 'rejected'
    ? Math.min(qualityScore, 25)
    : qualityScore;
  const checkDetails = uniqueChecks(merged.checks)
    .filter((check) => !isRepresentationCheck(check))
    .map((check) => ({
      ...check,
      severity: normalizeEditorGradeSeverity(check.severity),
    }));
  const result: GenerationAcceptanceResult = {
    editor_grade_status: status,
    editor_grade_score: Math.max(0, Math.min(100, Math.round(score))),
    failing_checks: failingChecks,
    warnings,
    check_details: checkDetails,
    ...(representationWarnings.length > 0 ? { representation_warnings: representationWarnings } : {}),
    recommended_actions: recommendedActionsFor([...failingChecks, ...warnings], status),
  };
  emitGenerationAcceptanceTelemetry(input, result, merged.reasons);
  return result;
}

export function emitGenerationAcceptanceTelemetry(
  input: GenerationAcceptanceInput,
  result: GenerationAcceptanceResult,
  reasons: string[],
): void {
  console.info('[editor-grade-readiness][warn-mode]', {
    phase: input.phase,
    source: input.source ?? null,
    content_type: normalizeLogicalContentType(input.logicalContentType, input.publishContentType || 'post'),
    publish_content_type: input.publishContentType ?? null,
    platform: input.platform ?? null,
    status: result.editor_grade_status,
    score: result.editor_grade_score,
    reasons: unique(reasons).slice(0, 12),
    failing_checks: result.failing_checks,
    warnings: result.warnings,
    representation_warnings: result.representation_warnings ?? [],
    recommended_actions: result.recommended_actions,
  });
}
