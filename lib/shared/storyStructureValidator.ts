import {
  createEditorGradeResult,
  type EditorGradeCheck,
  type EditorGradePhase,
  type EditorGradeResult,
} from './editorGradeReadiness';
import { normalizeLogicalContentType } from './contentTypeIntegrity';
import { addEditorGradeCheck, wordCount } from './titleRuleCatalog';

export type StoryStructureValidationInput = {
  content?: string | null;
  title?: string | null;
  logicalContentType?: string | null;
  platform?: string | null;
  phase: EditorGradePhase;
  source?: string | null;
};

export type StoryStructureTelemetry = {
  score: number;
  issues: string[];
  warnings: string[];
  recommendation: 'use' | 'review' | 'repair';
};

type StoryFrame = {
  index: number;
  text: string;
  sourceLine: number;
};

type ParsedStoryStructure = {
  text: string;
  normalizedText: string;
  lines: string[];
  paragraphs: string[];
  frames: StoryFrame[];
  frameMarkerCount: number;
  collapsed: boolean;
};

const FRAME_MARKER_PATTERN = /^\s*(?:frame|scene|slide|story)\s*\d+\s*[:.-]\s*(.*)$/i;
const INLINE_FRAME_MARKER_PATTERN = /(?:^|\s)(?:frame|scene|slide|story)\s*\d+\s*[:.-]\s+\S/gi;
const PROGRESSION_PATTERN =
  /\b(then|next|after|before|until|instead|but|so|because|when|while|finally|later|realized|noticed|learned|asked|found|changed|shifted)\b/i;
const PAYOFF_PATTERN =
  /\b(lesson|takeaway|resolved|resolution|answer|result|changed|shifted|learned|realized|finally|in the end|the point|that is why)\b/i;
const CONFLICT_PATTERN =
  /\b(problem|challenge|risk|mistake|missed|slipping|failed|blocked|stuck|conflict|tension|pressure|deadline|tradeoff|but|instead|however)\b/i;
const RESOLUTION_PATTERN =
  /\b(resolved|fixed|solved|learned|realized|answered|shifted|changed|decided|chose|turned|improved|won|recovered|found)\b/i;
const SPECIFICITY_PATTERN =
  /\d|%|\$|\b(customer|campaign|dashboard|budget|audience|channel|message|founder|sales|pipeline|revenue|conversion|team|client|meeting|deadline|launch|week|monday|maya|alex|manager|buyer)\b/i;
const GENERIC_MOTIVATIONAL_PATTERN =
  /\b(believe in yourself|keep going|never give up|dream big|anything is possible|success starts|mindset is everything|you can do it)\b/i;
const GENERIC_INSPIRATIONAL_TEMPLATE_PATTERN =
  /\b(one day everything changed|and then everything changed|little did .* know|from struggle to success|against all odds|the rest is history)\b/i;
const CLICHE_PATTERN =
  /\b(journey of a thousand miles|light at the end of the tunnel|follow your dreams|rise above|turn pain into power|every cloud has a silver lining)\b/i;
const EMPTY_EMOTIONAL_LANGUAGE_PATTERN =
  /\b(amazing|incredible|powerful|inspiring|beautiful|heartwarming|emotional|life-changing)\b/i;
const TEMPLATE_PATTERN = /^(?:frame|scene|story|setup|conflict|resolution|takeaway)[:.-]\s*$/i;

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

function stripFrameMarker(value: string): string {
  return compact(value.replace(FRAME_MARKER_PATTERN, '$1'));
}

function sentenceParts(value: string): string[] {
  return compact(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => compact(part))
    .filter(Boolean);
}

function parseInlineFrames(normalizedText: string): StoryFrame[] {
  const regex = /(?:^|\s)(?:frame|scene|slide|story)\s*(\d+)\s*[:.-]\s+(.+?)(?=\s+(?:frame|scene|slide|story)\s*\d+\s*[:.-]\s+|$)/gi;
  const frames: StoryFrame[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalizedText)) !== null) {
    frames.push({
      index: frames.length,
      text: compact(match[2] ?? ''),
      sourceLine: 1,
    });
  }
  return frames;
}

function parseStoryStructure(content: string): ParsedStoryStructure {
  const text = normalizeText(content);
  const normalizedText = compact(text);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const paragraphs = paragraphsOf(text);
  const frameMarkerCount = (normalizedText.match(INLINE_FRAME_MARKER_PATTERN) ?? []).length;
  const lineFrames: StoryFrame[] = [];

  lines.forEach((line, index) => {
    const match = line.match(FRAME_MARKER_PATTERN);
    if (!match) return;
    lineFrames.push({
      index: lineFrames.length,
      text: compact(match[1] ?? ''),
      sourceLine: index + 1,
    });
  });

  const inlineFrames = lineFrames.length >= 2 ? [] : parseInlineFrames(normalizedText);
  const frames =
    lineFrames.length >= 2
      ? lineFrames
      : inlineFrames.length >= 2
        ? inlineFrames
        : paragraphs.length >= 2
          ? paragraphs.map((paragraph, index) => ({ index, text: stripFrameMarker(paragraph), sourceLine: index + 1 }))
          : sentenceParts(normalizedText).map((sentence, index) => ({ index, text: stripFrameMarker(sentence), sourceLine: index + 1 }));
  const collapsed = lines.length <= 1 && frameMarkerCount >= 2;

  return {
    text,
    normalizedText,
    lines,
    paragraphs,
    frames,
    frameMarkerCount,
    collapsed,
  };
}

function normalizedFrameKey(value: string): string {
  return compact(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\b(the|a|an|and|or|to|of|for|with|your|our|this|that|is|are|was|were|be)\b/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10)
    .join(' ');
}

function duplicateFrameCount(frames: StoryFrame[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const key of frames.map((frame) => normalizedFrameKey(frame.text)).filter(Boolean)) {
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

function hasOpeningScene(parsed: ParsedStoryStructure): boolean {
  const opening = parsed.frames[0]?.text ?? '';
  return wordCount(opening) >= 6 && SPECIFICITY_PATTERN.test(opening) && !TEMPLATE_PATTERN.test(opening);
}

function hasNarrativeProgression(parsed: ParsedStoryStructure): boolean {
  return parsed.frames.length >= 3 && PROGRESSION_PATTERN.test(parsed.normalizedText);
}

function hasSceneContinuity(parsed: ParsedStoryStructure): boolean {
  if (parsed.frames.length < 2) return false;
  const joined = parsed.frames.map((frame) => frame.text).join(' ');
  return /\b(he|she|they|it|the team|the customer|the campaign|maya|alex|client|manager)\b/i.test(joined) ||
    duplicateFrameCount(parsed.frames) === 0;
}

function hasNarrativeCompleteness(parsed: ParsedStoryStructure): boolean {
  return hasOpeningScene(parsed) &&
    hasNarrativeProgression(parsed) &&
    CONFLICT_PATTERN.test(parsed.normalizedText) &&
    RESOLUTION_PATTERN.test(parsed.normalizedText);
}

function hasPayoff(parsed: ParsedStoryStructure): boolean {
  const last = parsed.frames[parsed.frames.length - 1]?.text ?? '';
  return wordCount(last) >= 6 && (PAYOFF_PATTERN.test(last) || RESOLUTION_PATTERN.test(last));
}

function hasAbruptEnding(parsed: ParsedStoryStructure): boolean {
  const last = parsed.frames[parsed.frames.length - 1]?.text ?? '';
  return !last || wordCount(last) < 4 || /[:,-]\s*$/.test(last);
}

function hasMissingSpecificity(parsed: ParsedStoryStructure): boolean {
  return !SPECIFICITY_PATTERN.test(parsed.normalizedText);
}

function isGenericPostRendering(parsed: ParsedStoryStructure): boolean {
  return parsed.frames.length < 2 && parsed.frameMarkerCount === 0 && parsed.paragraphs.length <= 1;
}

function recommendationFor(result: EditorGradeResult): StoryStructureTelemetry['recommendation'] {
  if (
    result.score < 65 ||
    result.checks.some((check) =>
      !check.passed &&
      ['story.collapsed_story_structure', 'story.generic_post_rendering', 'story.narrative_completeness'].includes(check.id)
    )
  ) {
    return 'repair';
  }
  if (result.status !== 'approved' || result.score < 85) return 'review';
  return 'use';
}

export function validateStoryStructure(input: StoryStructureValidationInput): EditorGradeResult | null {
  const logicalType = normalizeLogicalContentType(input.logicalContentType, '');
  if (logicalType !== 'story' && logicalType !== 'short_story') return null;

  const parsed = parseStoryStructure(String(input.content ?? ''));
  const checks: EditorGradeCheck[] = [];
  const duplicateFrames = duplicateFrameCount(parsed.frames);
  const openingScene = hasOpeningScene(parsed);
  const progression = hasNarrativeProgression(parsed);
  const continuity = hasSceneContinuity(parsed);
  const completeness = hasNarrativeCompleteness(parsed);
  const payoff = hasPayoff(parsed);
  const abruptEnding = hasAbruptEnding(parsed);
  const genericMotivational = GENERIC_MOTIVATIONAL_PATTERN.test(parsed.normalizedText) && hasMissingSpecificity(parsed);
  const genericInspirational = GENERIC_INSPIRATIONAL_TEMPLATE_PATTERN.test(parsed.normalizedText);
  const vagueNarrative = parsed.frames.length < 3 || hasMissingSpecificity(parsed);
  const missingConflict = !CONFLICT_PATTERN.test(parsed.normalizedText);
  const missingResolution = !RESOLUTION_PATTERN.test(parsed.normalizedText);
  const frameProgression = parsed.frames.length >= 3 && progression && duplicateFrames === 0;
  const frameSeparation = !parsed.collapsed && (parsed.frames.length >= 2 || parsed.paragraphs.length >= 2);
  const genericPostRendering = isGenericPostRendering(parsed);
  const clicheNarrative = CLICHE_PATTERN.test(parsed.normalizedText);
  const emptyEmotionalLanguage = EMPTY_EMOTIONAL_LANGUAGE_PATTERN.test(parsed.normalizedText) && hasMissingSpecificity(parsed);
  const genericLifeLesson =
    /\b(the lesson is|lesson:|moral of the story|life lesson)\b/i.test(parsed.normalizedText) &&
    !SPECIFICITY_PATTERN.test(parsed.frames[0]?.text ?? '');
  const obviousTemplateStorytelling = parsed.frames.some((frame) => TEMPLATE_PATTERN.test(frame.text));

  addEditorGradeCheck(checks, {
    id: 'story.opening_scene_present',
    phase: input.phase,
    severity: 'important',
    passed: openingScene,
    message: openingScene ? undefined : 'Story is missing a specific opening scene.',
    score: openingScene ? 100 : 45,
  });
  addEditorGradeCheck(checks, {
    id: 'story.narrative_progression',
    phase: input.phase,
    severity: 'important',
    passed: progression,
    message: progression ? undefined : 'Story lacks clear narrative progression.',
    score: progression ? 100 : 50,
  });
  addEditorGradeCheck(checks, {
    id: 'story.scene_continuity',
    phase: input.phase,
    severity: 'minor',
    passed: continuity,
    message: continuity ? undefined : 'Story scenes do not connect clearly.',
    score: continuity ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'story.narrative_completeness',
    phase: input.phase,
    severity: 'important',
    passed: completeness,
    message: completeness ? undefined : 'Story is missing setup, tension, progression, or resolution.',
    score: completeness ? 100 : 45,
  });
  addEditorGradeCheck(checks, {
    id: 'story.ending_payoff_present',
    phase: input.phase,
    severity: 'important',
    passed: payoff,
    message: payoff ? undefined : 'Story is missing an ending, payoff, or takeaway.',
    score: payoff ? 100 : 50,
  });
  addEditorGradeCheck(checks, {
    id: 'story.abrupt_ending',
    phase: input.phase,
    severity: 'minor',
    passed: !abruptEnding,
    message: abruptEnding ? 'Story appears to end abruptly.' : undefined,
    score: abruptEnding ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.generic_motivational_story',
    phase: input.phase,
    severity: 'important',
    passed: !genericMotivational,
    message: genericMotivational ? 'Story is generic motivational copy rather than a concrete narrative.' : undefined,
    score: genericMotivational ? 45 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.generic_inspirational_template',
    phase: input.phase,
    severity: 'important',
    passed: !genericInspirational,
    message: genericInspirational ? 'Story uses a generic inspirational template.' : undefined,
    score: genericInspirational ? 45 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.vague_narrative',
    phase: input.phase,
    severity: 'important',
    passed: !vagueNarrative,
    message: vagueNarrative ? 'Story is too vague or thin to evaluate as editor-grade.' : undefined,
    score: vagueNarrative ? 50 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.missing_specificity',
    phase: input.phase,
    severity: 'important',
    passed: !hasMissingSpecificity(parsed),
    message: hasMissingSpecificity(parsed) ? 'Story lacks specific people, context, stakes, or details.' : undefined,
    score: hasMissingSpecificity(parsed) ? 50 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.missing_conflict_tension',
    phase: input.phase,
    severity: 'important',
    passed: !missingConflict,
    message: missingConflict ? 'Story is missing conflict, tension, or a meaningful problem.' : undefined,
    score: missingConflict ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.missing_resolution',
    phase: input.phase,
    severity: 'important',
    passed: !missingResolution,
    message: missingResolution ? 'Story is missing a resolution or changed outcome.' : undefined,
    score: missingResolution ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.frame_progression',
    phase: input.phase,
    severity: 'important',
    passed: frameProgression,
    message: frameProgression ? undefined : 'Story frames do not progress enough.',
    score: frameProgression ? 100 : 55,
    metadata: { frame_count: parsed.frames.length },
  });
  addEditorGradeCheck(checks, {
    id: 'story.frame_separation',
    phase: input.phase,
    severity: 'minor',
    passed: frameSeparation,
    message: frameSeparation ? undefined : 'Story frame separation is missing or unclear.',
    score: frameSeparation ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'story.repeated_frames',
    phase: input.phase,
    severity: 'minor',
    passed: duplicateFrames === 0,
    message: duplicateFrames > 0 ? 'Story contains repeated or near-duplicate frames.' : undefined,
    score: duplicateFrames === 0 ? 100 : 60,
    metadata: { duplicate_count: duplicateFrames },
  });
  addEditorGradeCheck(checks, {
    id: 'story.collapsed_story_structure',
    phase: input.phase,
    severity: 'critical',
    passed: !parsed.collapsed,
    message: parsed.collapsed ? 'Story frames appear collapsed into one paragraph.' : undefined,
    score: parsed.collapsed ? 15 : 100,
    metadata: { frame_marker_count: parsed.frameMarkerCount, line_count: parsed.lines.length },
  });
  addEditorGradeCheck(checks, {
    id: 'story.generic_post_rendering',
    phase: input.phase,
    severity: 'critical',
    passed: !genericPostRendering,
    message: genericPostRendering ? 'Story resembles a generic post rather than structured story content.' : undefined,
    score: genericPostRendering ? 35 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.cliche_narrative_patterns',
    phase: input.phase,
    severity: 'minor',
    passed: !clicheNarrative,
    message: clicheNarrative ? 'Story uses cliché narrative phrasing.' : undefined,
    score: clicheNarrative ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.empty_emotional_language',
    phase: input.phase,
    severity: 'minor',
    passed: !emptyEmotionalLanguage,
    message: emptyEmotionalLanguage ? 'Story leans on emotional language without concrete narrative detail.' : undefined,
    score: emptyEmotionalLanguage ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.generic_life_lesson',
    phase: input.phase,
    severity: 'minor',
    passed: !genericLifeLesson,
    message: genericLifeLesson ? 'Story closes with a generic life lesson.' : undefined,
    score: genericLifeLesson ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'story.obvious_template_storytelling',
    phase: input.phase,
    severity: 'important',
    passed: !obviousTemplateStorytelling,
    message: obviousTemplateStorytelling ? 'Story appears to include visible template labels.' : undefined,
    score: obviousTemplateStorytelling ? 45 : 100,
  });

  const result = createEditorGradeResult({ checks });
  emitStoryStructureTelemetry(input, result);
  return result;
}

export function buildStoryStructureTelemetry(result: EditorGradeResult): StoryStructureTelemetry {
  const failed = result.checks.filter((check) => !check.passed);
  const issueSeverities = new Set(['blocking', 'critical', 'important']);
  return {
    score: result.score,
    issues: failed
      .filter((check) => issueSeverities.has(String(check.severity)))
      .map((check) => check.id.replace(/^story\./, '')),
    warnings: failed
      .filter((check) => !issueSeverities.has(String(check.severity)))
      .map((check) => check.id.replace(/^story\./, '')),
    recommendation: recommendationFor(result),
  };
}

export function emitStoryStructureTelemetry(
  input: StoryStructureValidationInput,
  result: EditorGradeResult,
): void {
  const telemetry = buildStoryStructureTelemetry(result);
  console.info('[story-structure][warn-mode]', {
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
