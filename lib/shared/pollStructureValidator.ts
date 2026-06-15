import {
  createEditorGradeResult,
  type EditorGradeCheck,
  type EditorGradePhase,
  type EditorGradeResult,
} from './editorGradeReadiness';
import { normalizeLogicalContentType } from './contentTypeIntegrity';
import { addEditorGradeCheck } from './titleRuleCatalog';

export type PollStructureValidationInput = {
  content?: string | null;
  title?: string | null;
  logicalContentType?: string | null;
  platform?: string | null;
  phase: EditorGradePhase;
  source?: string | null;
};

export type PollStructureTelemetry = {
  score: number;
  issues: string[];
  warnings: string[];
  recommendation: 'use' | 'review' | 'repair';
};

type ParsedPollStructure = {
  text: string;
  normalizedText: string;
  lines: string[];
  question: string;
  options: string[];
  lineOptionCount: number;
  inlineOptionCount: number;
  hasCta: boolean;
  hasClosing: boolean;
  collapsed: boolean;
  numberingCorrupt: boolean;
};

const GENERIC_QUESTION_PATTERNS = [
  /^what do you think\??$/i,
  /^which one (do you )?(prefer|choose|pick)\??$/i,
  /^what'?s your choice\??$/i,
  /^thoughts\??$/i,
  /^agree or disagree\??$/i,
  /^quick question\??$/i,
];

const CTA_PATTERN =
  /\b(vote|choose|pick|select|share your choice|comment|reply|tell us|drop your answer|cast your vote)\b/i;

const LEADING_QUESTION_PATTERN =
  /\b(don'?t you agree|isn'?t it true|obviously|clearly|everyone knows|the only right answer)\b/i;

const OPTION_BIAS_PATTERN =
  /\b(best|worst|wrong|right answer|obvious|clearly|smart|dumb|bad|superior)\b/i;

const BINARY_QUESTION_PATTERN = /^(do|does|did|are|is|was|were|can|could|should|would|will|have|has)\b/i;

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function wordCount(value: string): number {
  return compact(value).split(/\s+/).filter(Boolean).length;
}

function normalizeOption(value: string): string {
  return compact(value)
    .toLowerCase()
    .replace(/^[\dA-Fa-f][\).:-]?\s+/, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\b(the|a|an|and|or|to|of|for|with|your|our)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionLineMatch(line: string): RegExpMatchArray | null {
  return line.match(/^\s*(?:option\s*)?(\d+|[A-Fa-f])[\).:-]?\s+(.{2,})$/i);
}

function inlineOptionMatches(text: string): Array<{ marker: string; value: string }> {
  const matches: Array<{ marker: string; value: string }> = [];
  const regex = /(?:^|\s)(?:option\s*)?([1-6])[\).:-]?\s+(.+?)(?=\s+(?:option\s*)?[1-6][\).:-]?\s+|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ marker: match[1], value: compact(match[2]) });
  }
  return matches;
}

function parsePollStructure(content: string, title?: string | null): ParsedPollStructure {
  const text = normalizeText(content);
  const normalizedText = compact(text);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const inlineMatches = inlineOptionMatches(normalizedText);
  const options: string[] = [];
  const optionMarkers: string[] = [];
  let lineOptionCount = 0;

  for (const line of lines) {
    const match = optionLineMatch(line);
    if (match) {
      lineOptionCount += 1;
      optionMarkers.push(match[1]);
      options.push(compact(match[2]));
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.{2,})$/);
    if (bullet && options.length > 0) {
      options.push(compact(bullet[1]));
    }
  }

  if (options.length === 0 && inlineMatches.length > 0) {
    for (const match of inlineMatches) {
      optionMarkers.push(match.marker);
      options.push(match.value);
    }
  }

  const firstQuestionLine =
    lines.find((line) => line.includes('?') && !optionLineMatch(line)) ||
    compact(String(title ?? '')) ||
    lines.find((line) => !optionLineMatch(line) && !CTA_PATTERN.test(line)) ||
    '';

  const hasCta = lines.some((line) => CTA_PATTERN.test(line)) || CTA_PATTERN.test(normalizedText);
  const optionEndIndex = Math.max(
    ...lines.map((line, index) => (optionLineMatch(line) ? index : -1)),
    -1,
  );
  const closingCandidates = optionEndIndex >= 0 ? lines.slice(optionEndIndex + 1) : [];
  const hasClosing = closingCandidates.some((line) => !CTA_PATTERN.test(line) && wordCount(line) >= 6);

  const collapsed =
    lines.length <= 2 &&
    inlineMatches.length >= 3 &&
    /\b1[\).:-]?\s+\S.+\b2[\).:-]?\s+\S.+\b3[\).:-]?\s+\S+/i.test(normalizedText);

  const numericMarkers = optionMarkers.map((marker) => Number(marker)).filter((n) => Number.isFinite(n));
  const numberingCorrupt =
    numericMarkers.length > 0 &&
    numericMarkers.some((marker, index) => marker !== index + 1);

  return {
    text,
    normalizedText,
    lines,
    question: compact(firstQuestionLine),
    options,
    lineOptionCount,
    inlineOptionCount: inlineMatches.length,
    hasCta,
    hasClosing,
    collapsed,
    numberingCorrupt,
  };
}

function duplicateOptionCount(options: string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const option of options.map(normalizeOption).filter(Boolean)) {
    if (seen.has(option)) duplicates += 1;
    seen.add(option);
  }
  return duplicates;
}

function hasLengthImbalance(options: string[]): boolean {
  if (options.length < 2) return false;
  const lengths = options.map((option) => wordCount(option));
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  return max >= 10 && max >= Math.max(3, min) * 3;
}

function hasPoorDiversity(options: string[]): boolean {
  const normalized = options.map(normalizeOption).filter(Boolean);
  if (normalized.length < 3) return false;
  const stems = normalized.map((option) => option.split(/\s+/).slice(0, 2).join(' '));
  return new Set(stems).size <= Math.ceil(normalized.length / 2);
}

function recommendationFor(result: EditorGradeResult): PollStructureTelemetry['recommendation'] {
  if (result.score < 60 || result.checks.some((check) => !check.passed && check.id === 'poll.collapsed_poll_structure')) {
    return 'repair';
  }
  if (result.status !== 'approved' || result.score < 82) return 'review';
  return 'use';
}

export function validatePollStructure(input: PollStructureValidationInput): EditorGradeResult | null {
  const logicalType = normalizeLogicalContentType(input.logicalContentType, '');
  if (logicalType !== 'poll') return null;

  const parsed = parsePollStructure(String(input.content ?? ''), input.title);
  const checks: EditorGradeCheck[] = [];
  const optionCount = parsed.options.length;
  const duplicates = duplicateOptionCount(parsed.options);
  const questionWords = wordCount(parsed.question);
  const weakQuestion =
    !parsed.question ||
    questionWords < 4 ||
    GENERIC_QUESTION_PATTERNS.some((pattern) => pattern.test(parsed.question));
  const binaryDisguised =
    BINARY_QUESTION_PATTERN.test(parsed.question) &&
    (optionCount <= 2 || parsed.options.some((option) => /^(yes|no|maybe)$/i.test(compact(option))));
  const biased =
    LEADING_QUESTION_PATTERN.test(parsed.question) ||
    parsed.options.some((option) => OPTION_BIAS_PATTERN.test(option));

  addEditorGradeCheck(checks, {
    id: 'poll.question_present',
    phase: input.phase,
    severity: 'critical',
    passed: !!parsed.question,
    message: parsed.question ? undefined : 'Poll is missing a clear question.',
    score: parsed.question ? 100 : 15,
    metadata: { question: parsed.question || null },
  });
  addEditorGradeCheck(checks, {
    id: 'poll.question_strength',
    phase: input.phase,
    severity: 'minor',
    passed: !weakQuestion,
    message: weakQuestion ? 'Poll question is too weak, generic, or thin.' : undefined,
    score: weakQuestion ? 45 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.options_present',
    phase: input.phase,
    severity: 'critical',
    passed: optionCount > 0,
    message: optionCount > 0 ? undefined : 'Poll options are missing.',
    score: optionCount > 0 ? 100 : 10,
    metadata: { option_count: optionCount },
  });
  addEditorGradeCheck(checks, {
    id: 'poll.option_count_minimum',
    phase: input.phase,
    severity: 'important',
    passed: optionCount >= 3,
    message: optionCount < 3 ? 'Poll has fewer than 3 options.' : undefined,
    score: optionCount >= 3 ? 100 : 35,
    metadata: { option_count: optionCount },
  });
  addEditorGradeCheck(checks, {
    id: 'poll.option_count_maximum',
    phase: input.phase,
    severity: 'important',
    passed: optionCount <= 6,
    message: optionCount > 6 ? 'Poll has more than 6 options.' : undefined,
    score: optionCount <= 6 ? 100 : 65,
    metadata: { option_count: optionCount },
  });
  addEditorGradeCheck(checks, {
    id: 'poll.duplicate_options',
    phase: input.phase,
    severity: 'important',
    passed: duplicates === 0,
    message: duplicates > 0 ? 'Poll contains duplicate or near-duplicate options.' : undefined,
    score: duplicates === 0 ? 100 : 45,
    metadata: { duplicate_count: duplicates },
  });
  addEditorGradeCheck(checks, {
    id: 'poll.option_length_balance',
    phase: input.phase,
    severity: 'minor',
    passed: !hasLengthImbalance(parsed.options),
    message: hasLengthImbalance(parsed.options) ? 'Poll option lengths are imbalanced.' : undefined,
    score: hasLengthImbalance(parsed.options) ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.cta_present',
    phase: input.phase,
    severity: 'minor',
    passed: parsed.hasCta,
    message: parsed.hasCta ? undefined : 'Poll CTA is missing.',
    score: parsed.hasCta ? 100 : 55,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.closing_present',
    phase: input.phase,
    severity: 'minor',
    passed: parsed.hasClosing,
    message: parsed.hasClosing ? undefined : 'Poll engagement or closing paragraph is missing.',
    score: parsed.hasClosing ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.collapsed_poll_structure',
    phase: input.phase,
    severity: 'critical',
    passed: !parsed.collapsed,
    message: parsed.collapsed ? 'Poll question and options appear collapsed into a single paragraph.' : undefined,
    score: parsed.collapsed ? 10 : 100,
    metadata: { inline_option_count: parsed.inlineOptionCount, line_option_count: parsed.lineOptionCount },
  });
  addEditorGradeCheck(checks, {
    id: 'poll.numbering_corruption',
    phase: input.phase,
    severity: 'important',
    passed: !parsed.numberingCorrupt,
    message: parsed.numberingCorrupt ? 'Poll option numbering appears corrupt or out of sequence.' : undefined,
    score: parsed.numberingCorrupt ? 35 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.whitespace_collapse',
    phase: input.phase,
    severity: 'important',
    passed: !(parsed.lines.length <= 2 && parsed.normalizedText.length > 180 && optionCount >= 3),
    message: parsed.lines.length <= 2 && parsed.normalizedText.length > 180 && optionCount >= 3
      ? 'Poll whitespace appears collapsed.'
      : undefined,
    score: parsed.lines.length <= 2 && parsed.normalizedText.length > 180 && optionCount >= 3 ? 35 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.option_separation_missing',
    phase: input.phase,
    severity: 'important',
    passed: !(parsed.inlineOptionCount >= 3 && parsed.lineOptionCount === 0),
    message: parsed.inlineOptionCount >= 3 && parsed.lineOptionCount === 0
      ? 'Poll options are not separated onto distinct lines.'
      : undefined,
    score: parsed.inlineOptionCount >= 3 && parsed.lineOptionCount === 0 ? 20 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.generic_post_rendering',
    phase: input.phase,
    severity: 'critical',
    passed: optionCount >= 3 || parsed.inlineOptionCount >= 3,
    message: optionCount < 3 && parsed.inlineOptionCount < 3 ? 'Poll resembles a generic post rather than structured poll content.' : undefined,
    score: optionCount >= 3 || parsed.inlineOptionCount >= 3 ? 100 : 40,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.low_interest_question',
    phase: input.phase,
    severity: 'minor',
    passed: !weakQuestion,
    message: weakQuestion ? 'Poll question is unlikely to generate meaningful responses.' : undefined,
    score: weakQuestion ? 50 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.binary_question_disguised_as_poll',
    phase: input.phase,
    severity: 'minor',
    passed: !binaryDisguised,
    message: binaryDisguised ? 'Poll appears to be a binary question disguised as a multi-option poll.' : undefined,
    score: binaryDisguised ? 45 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.obvious_answer_bias',
    phase: input.phase,
    severity: 'minor',
    passed: !biased,
    message: biased ? 'Poll wording or options appear biased toward an obvious answer.' : undefined,
    score: biased ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'poll.option_diversity',
    phase: input.phase,
    severity: 'minor',
    passed: !hasPoorDiversity(parsed.options),
    message: hasPoorDiversity(parsed.options) ? 'Poll options lack enough diversity.' : undefined,
    score: hasPoorDiversity(parsed.options) ? 55 : 100,
  });

  const result = createEditorGradeResult({ checks });
  emitPollStructureTelemetry(input, result);
  return result;
}

export function buildPollStructureTelemetry(result: EditorGradeResult): PollStructureTelemetry {
  const failed = result.checks.filter((check) => !check.passed);
  const criticalIds = new Set([
    'poll.question_present',
    'poll.options_present',
    'poll.option_count_minimum',
    'poll.collapsed_poll_structure',
    'poll.option_separation_missing',
    'poll.generic_post_rendering',
  ]);
  return {
    score: result.score,
    issues: failed
      .filter((check) => criticalIds.has(check.id))
      .map((check) => check.id.replace(/^poll\./, '')),
    warnings: failed
      .filter((check) => !criticalIds.has(check.id))
      .map((check) => check.id.replace(/^poll\./, '')),
    recommendation: recommendationFor(result),
  };
}

export function emitPollStructureTelemetry(
  input: PollStructureValidationInput,
  result: EditorGradeResult,
): void {
  const telemetry = buildPollStructureTelemetry(result);
  console.info('[poll-structure][warn-mode]', {
    phase: input.phase,
    source: input.source ?? null,
    logical_content_type: normalizeLogicalContentType(input.logicalContentType, ''),
    platform: input.platform ?? null,
    score: telemetry.score,
    issues: telemetry.issues,
    warnings: telemetry.warnings,
    recommendation: telemetry.recommendation,
  });
}
