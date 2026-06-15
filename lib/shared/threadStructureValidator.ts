import {
  createEditorGradeResult,
  type EditorGradeCheck,
  type EditorGradePhase,
  type EditorGradeResult,
} from './editorGradeReadiness';
import { normalizeLogicalContentType } from './contentTypeIntegrity';
import { addEditorGradeCheck, wordCount } from './titleRuleCatalog';

export type ThreadStructureValidationInput = {
  content?: string | null;
  title?: string | null;
  logicalContentType?: string | null;
  platform?: string | null;
  phase: EditorGradePhase;
  source?: string | null;
};

export type ThreadStructureTelemetry = {
  score: number;
  issues: string[];
  warnings: string[];
  recommendation: 'use' | 'review' | 'repair';
};

type ThreadSegment = {
  index: number;
  marker?: number;
  text: string;
  sourceLine: number;
};

type ParsedThreadStructure = {
  text: string;
  normalizedText: string;
  lines: string[];
  paragraphs: string[];
  segments: ThreadSegment[];
  numberedSegments: ThreadSegment[];
  inlineMarkerCount: number;
  collapsed: boolean;
  numberingCorrupt: boolean;
  emptyNumberedMarkers: number;
  hasNumbering: boolean;
};

const NUMBERED_SEGMENT_PATTERN = /^\s*(\d+)(?:\/\d+|\/|[\).:-])\s*(.*)$/;
const INLINE_MARKER_PATTERN = /(?:^|\s)\d+(?:\/\d+|\/|[\).:-])\s+\S/g;
const CTA_PATTERN =
  /\b(comment|reply|share|save|follow|dm|tell me|what would you|which one|try this|read more|learn more|drop your|send this)\b/i;
const CONCLUSION_PATTERN =
  /\b(finally|bottom line|takeaway|in short|so here'?s|the point|this is why|start by|try this|next step|that'?s the lesson)\b/i;
const PROGRESSION_PATTERN =
  /\b(first|second|third|next|then|because|but|so|finally|step|lesson|takeaway|now|after that|from there|here'?s why)\b/i;
const LOW_INFO_PATTERN = /^(tip|point|step|lesson|idea|insight|thread|more)\s*\d*[:.-]?$/i;

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => compact(part))
    .filter(Boolean);
}

function normalizedSegmentKey(value: string): string {
  return compact(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\b(the|a|an|and|or|to|of|for|with|your|our|this|that|is|are|be)\b/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10)
    .join(' ');
}

function parseThreadStructure(content: string): ParsedThreadStructure {
  const text = normalizeText(content);
  const normalizedText = compact(text);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const paragraphs = paragraphsOf(text);
  const inlineMarkerCount = (normalizedText.match(INLINE_MARKER_PATTERN) ?? []).length;
  const numberedSegments: ThreadSegment[] = [];
  let emptyNumberedMarkers = 0;

  lines.forEach((line, index) => {
    const match = line.match(NUMBERED_SEGMENT_PATTERN);
    if (!match) return;
    const marker = Number(match[1]);
    const segmentText = compact(match[2] ?? '');
    if (!segmentText) emptyNumberedMarkers += 1;
    numberedSegments.push({
      index: numberedSegments.length,
      marker,
      text: segmentText,
      sourceLine: index + 1,
    });
  });

  const segments =
    numberedSegments.length >= 2
      ? numberedSegments
      : paragraphs.map((paragraph, index) => ({
          index,
          text: paragraph,
          sourceLine: index + 1,
        }));

  const markerValues = numberedSegments
    .map((segment) => segment.marker)
    .filter((marker): marker is number => Number.isFinite(marker));
  const hasNumbering = markerValues.length >= 2;
  const numberingCorrupt =
    hasNumbering &&
    (markerValues.some((marker, index) => marker !== index + 1) ||
      new Set(markerValues).size !== markerValues.length ||
      emptyNumberedMarkers > 0);
  const collapsed =
    lines.length <= 2 &&
    inlineMarkerCount >= 3 &&
    numberedSegments.length < inlineMarkerCount;

  return {
    text,
    normalizedText,
    lines,
    paragraphs,
    segments,
    numberedSegments,
    inlineMarkerCount,
    collapsed,
    numberingCorrupt,
    emptyNumberedMarkers,
    hasNumbering,
  };
}

function duplicateSegmentCount(segments: ThreadSegment[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const key of segments.map((segment) => normalizedSegmentKey(segment.text)).filter(Boolean)) {
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

function repetitiveSegmentCount(segments: ThreadSegment[]): number {
  return segments.filter((segment) => {
    const words = compact(segment.text).toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length < 6) return false;
    const unique = new Set(words);
    return unique.size / words.length < 0.55;
  }).length;
}

function hasOpeningHook(parsed: ParsedThreadStructure): boolean {
  const opening = parsed.segments[0]?.text ?? '';
  return wordCount(opening) >= 5 && !LOW_INFO_PATTERN.test(opening) && !/[:,-]\s*$/.test(opening);
}

function hasConclusion(parsed: ParsedThreadStructure): boolean {
  const last = parsed.segments[parsed.segments.length - 1]?.text ?? '';
  return wordCount(last) >= 5 && (CONCLUSION_PATTERN.test(last) || CTA_PATTERN.test(last) || parsed.segments.length >= 5);
}

function hasAbruptTermination(parsed: ParsedThreadStructure): boolean {
  const last = parsed.segments[parsed.segments.length - 1]?.text ?? '';
  return !last || wordCount(last) < 4 || /[:,-]\s*$/.test(last) || LOW_INFO_PATTERN.test(last);
}

function hasWeakNarrativeFlow(parsed: ParsedThreadStructure): boolean {
  if (!hasOpeningHook(parsed)) return true;
  const body = parsed.segments.map((segment) => segment.text).join(' ');
  return parsed.segments.length < 4 && !PROGRESSION_PATTERN.test(body);
}

function hasLowProgressionValue(parsed: ParsedThreadStructure): boolean {
  const informative = parsed.segments.filter((segment) => wordCount(segment.text) >= 6 && !LOW_INFO_PATTERN.test(segment.text));
  return informative.length < Math.min(3, parsed.segments.length);
}

function recommendationFor(result: EditorGradeResult): ThreadStructureTelemetry['recommendation'] {
  if (
    result.score < 65 ||
    result.checks.some((check) =>
      !check.passed &&
      ['thread.collapsed_thread_structure', 'thread.generic_post_rendering', 'thread.single_post_disguised_as_thread'].includes(check.id)
    )
  ) {
    return 'repair';
  }
  if (result.status !== 'approved' || result.score < 85) return 'review';
  return 'use';
}

export function validateThreadStructure(input: ThreadStructureValidationInput): EditorGradeResult | null {
  const logicalType = normalizeLogicalContentType(input.logicalContentType, '');
  if (logicalType !== 'thread') return null;

  const parsed = parseThreadStructure(String(input.content ?? ''));
  const checks: EditorGradeCheck[] = [];
  const segmentCount = parsed.segments.length;
  const duplicates = duplicateSegmentCount(parsed.segments);
  const repetitiveSegments = repetitiveSegmentCount(parsed.segments);
  const hasCta = CTA_PATTERN.test(parsed.normalizedText);
  const openingHook = hasOpeningHook(parsed);
  const conclusion = hasConclusion(parsed);
  const abruptTermination = hasAbruptTermination(parsed);
  const lowProgressionValue = hasLowProgressionValue(parsed);
  const weakNarrativeFlow = hasWeakNarrativeFlow(parsed);
  const singlePostDisguised = segmentCount < 3 || (!parsed.hasNumbering && parsed.paragraphs.length < 3);
  const genericPostRendering = !parsed.hasNumbering && parsed.paragraphs.length <= 2 && segmentCount < 3;
  const sectionSeparationMissing = parsed.collapsed || (parsed.hasNumbering && parsed.numberedSegments.length < segmentCount);
  const sequentialProgression =
    segmentCount >= 3 &&
    !parsed.numberingCorrupt &&
    duplicates === 0 &&
    !lowProgressionValue;

  addEditorGradeCheck(checks, {
    id: 'thread.opening_hook_present',
    phase: input.phase,
    severity: 'important',
    passed: openingHook,
    message: openingHook ? undefined : 'Thread is missing a substantive opening hook.',
    score: openingHook ? 100 : 45,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.minimum_length',
    phase: input.phase,
    severity: 'important',
    passed: segmentCount >= 3,
    message: segmentCount >= 3 ? undefined : 'Thread has fewer than 3 substantive segments.',
    score: segmentCount >= 3 ? 100 : 35,
    metadata: { segment_count: segmentCount },
  });
  addEditorGradeCheck(checks, {
    id: 'thread.sequential_progression',
    phase: input.phase,
    severity: 'important',
    passed: sequentialProgression,
    message: sequentialProgression ? undefined : 'Thread does not show clear sequential progression.',
    score: sequentialProgression ? 100 : 55,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.numbering_continuity',
    phase: input.phase,
    severity: 'important',
    passed: !parsed.numberingCorrupt,
    message: parsed.numberingCorrupt ? 'Thread numbering is missing, duplicated, empty, or out of sequence.' : undefined,
    score: parsed.numberingCorrupt ? 35 : 100,
    metadata: { empty_numbered_markers: parsed.emptyNumberedMarkers },
  });
  addEditorGradeCheck(checks, {
    id: 'thread.duplicate_segments',
    phase: input.phase,
    severity: 'important',
    passed: duplicates === 0,
    message: duplicates > 0 ? 'Thread contains duplicate or near-duplicate segments.' : undefined,
    score: duplicates === 0 ? 100 : 45,
    metadata: { duplicate_count: duplicates },
  });
  addEditorGradeCheck(checks, {
    id: 'thread.abrupt_termination',
    phase: input.phase,
    severity: 'minor',
    passed: !abruptTermination,
    message: abruptTermination ? 'Thread appears to end abruptly.' : undefined,
    score: abruptTermination ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.conclusion_present',
    phase: input.phase,
    severity: 'minor',
    passed: conclusion,
    message: conclusion ? undefined : 'Thread is missing a clear conclusion or takeaway.',
    score: conclusion ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.cta_present',
    phase: input.phase,
    severity: 'minor',
    passed: hasCta,
    message: hasCta ? undefined : 'Thread CTA is missing.',
    score: hasCta ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.collapsed_thread_structure',
    phase: input.phase,
    severity: 'critical',
    passed: !parsed.collapsed,
    message: parsed.collapsed ? 'Thread segments appear collapsed into a single paragraph.' : undefined,
    score: parsed.collapsed ? 10 : 100,
    metadata: { inline_marker_count: parsed.inlineMarkerCount, line_count: parsed.lines.length },
  });
  addEditorGradeCheck(checks, {
    id: 'thread.numbering_corruption',
    phase: input.phase,
    severity: 'important',
    passed: !parsed.numberingCorrupt,
    message: parsed.numberingCorrupt ? 'Thread numbering appears corrupt.' : undefined,
    score: parsed.numberingCorrupt ? 35 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.generic_post_rendering',
    phase: input.phase,
    severity: 'critical',
    passed: !genericPostRendering,
    message: genericPostRendering ? 'Thread resembles a generic post rather than structured thread content.' : undefined,
    score: genericPostRendering ? 35 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.section_separation',
    phase: input.phase,
    severity: 'minor',
    passed: !sectionSeparationMissing,
    message: sectionSeparationMissing ? 'Thread segment separation is missing or unclear.' : undefined,
    score: sectionSeparationMissing ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.repetitive_segments',
    phase: input.phase,
    severity: 'minor',
    passed: repetitiveSegments === 0,
    message: repetitiveSegments > 0 ? 'Thread segments repeat too much phrasing.' : undefined,
    score: repetitiveSegments === 0 ? 100 : 60,
    metadata: { repetitive_segment_count: repetitiveSegments },
  });
  addEditorGradeCheck(checks, {
    id: 'thread.low_progression_value',
    phase: input.phase,
    severity: 'minor',
    passed: !lowProgressionValue,
    message: lowProgressionValue ? 'Thread segments do not add enough new value as the sequence progresses.' : undefined,
    score: lowProgressionValue ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.weak_narrative_flow',
    phase: input.phase,
    severity: 'minor',
    passed: !weakNarrativeFlow,
    message: weakNarrativeFlow ? 'Thread narrative flow is weak or underdeveloped.' : undefined,
    score: weakNarrativeFlow ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'thread.single_post_disguised_as_thread',
    phase: input.phase,
    severity: 'important',
    passed: !singlePostDisguised,
    message: singlePostDisguised ? 'Content is marked as a thread but reads like a single post.' : undefined,
    score: singlePostDisguised ? 45 : 100,
  });

  const result = createEditorGradeResult({ checks });
  emitThreadStructureTelemetry(input, result);
  return result;
}

export function buildThreadStructureTelemetry(result: EditorGradeResult): ThreadStructureTelemetry {
  const failed = result.checks.filter((check) => !check.passed);
  const issueSeverities = new Set(['blocking', 'critical', 'important']);
  return {
    score: result.score,
    issues: failed
      .filter((check) => issueSeverities.has(String(check.severity)))
      .map((check) => check.id.replace(/^thread\./, '')),
    warnings: failed
      .filter((check) => !issueSeverities.has(String(check.severity)))
      .map((check) => check.id.replace(/^thread\./, '')),
    recommendation: recommendationFor(result),
  };
}

export function emitThreadStructureTelemetry(
  input: ThreadStructureValidationInput,
  result: EditorGradeResult,
): void {
  const telemetry = buildThreadStructureTelemetry(result);
  console.info('[thread-structure][warn-mode]', {
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
