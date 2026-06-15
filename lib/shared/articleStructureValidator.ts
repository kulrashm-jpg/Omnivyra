import {
  createEditorGradeResult,
  type EditorGradeCheck,
  type EditorGradePhase,
  type EditorGradeResult,
} from './editorGradeReadiness';
import { normalizeLogicalContentType } from './contentTypeIntegrity';
import { addEditorGradeCheck } from './titleRuleCatalog';

export type ArticleStructureValidationInput = {
  content?: string | null;
  title?: string | null;
  logicalContentType?: string | null;
  platform?: string | null;
  phase: EditorGradePhase;
  source?: string | null;
};

export type ArticleStructureTelemetry = {
  score: number;
  issues: string[];
  warnings: string[];
  recommendation: 'use' | 'review' | 'repair';
};

type ParsedArticleStructure = {
  text: string;
  lines: string[];
  nonEmptyLines: string[];
  paragraphs: string[];
  headings: string[];
  bulletLines: string[];
  numberedLines: string[];
  intro: string;
  conclusion: string;
  wordCount: number;
  collapsed: boolean;
};

const GENERIC_HEADING_ONLY = /^(intro|introduction|body|section|main section|content|conclusion|summary)$/i;
const CONCLUSION_HINT = /^(conclusion|summary|takeaway|key takeaway|final thought|next step)s?[:.-]?$/i;
const ARTICLE_HINT = /\b(intro|introduction|framework|section|conclusion|takeaway|problem|solution|why it matters|the fix)\b/i;

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function wordCount(value: string): number {
  return compact(value).split(/\s+/).filter(Boolean).length;
}

function isBulletLine(line: string): boolean {
  return /^\s*(?:[-*\u2022]|\u2013|\u2014)\s+/.test(line);
}

function isNumberedLine(line: string): boolean {
  return /^\s*(?:\d+[\).:/-]|\d+\/)\s+/.test(line);
}

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || isBulletLine(trimmed) || isNumberedLine(trimmed)) return false;
  if (trimmed.length > 90 || wordCount(trimmed) > 9) return false;
  return (
    /^[A-Z][A-Z0-9\s&/-]{2,}:?$/.test(trimmed) ||
    /^(intro|introduction|problem|solution|framework|why it matters|the fix|takeaway|key takeaway|conclusion|summary|section \d+)[:.-]?$/i.test(trimmed)
  );
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => compact(part))
    .filter(Boolean);
}

function firstBodyParagraph(lines: string[]): string {
  for (const line of lines) {
    if (!isHeading(line) && !isBulletLine(line) && !isNumberedLine(line) && wordCount(line) >= 6) {
      return compact(line);
    }
  }
  return '';
}

function conclusionParagraph(lines: string[], paragraphs: string[]): string {
  const conclusionIndex = lines.findIndex((line) => CONCLUSION_HINT.test(line.trim()));
  if (conclusionIndex >= 0) {
    const after = lines.slice(conclusionIndex + 1)
      .find((line) => !isHeading(line) && wordCount(line) >= 5);
    if (after) return compact(after);
  }
  return paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : '';
}

function parseArticleStructure(content: string): ParsedArticleStructure {
  const text = normalizeText(content);
  const lines = text.split('\n');
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const paragraphs = paragraphsOf(text);
  const headings = nonEmptyLines.filter(isHeading);
  const bulletLines = nonEmptyLines.filter(isBulletLine);
  const numberedLines = nonEmptyLines.filter(isNumberedLine);
  const compacted = compact(text);
  const collapsed =
    nonEmptyLines.length <= 2 &&
    compacted.length > 260 &&
    (ARTICLE_HINT.test(compacted) || /\b[A-Z][A-Z\s]{3,}\b/.test(compacted));

  return {
    text,
    lines,
    nonEmptyLines,
    paragraphs,
    headings,
    bulletLines,
    numberedLines,
    intro: firstBodyParagraph(nonEmptyLines),
    conclusion: conclusionParagraph(nonEmptyLines, paragraphs),
    wordCount: wordCount(text),
    collapsed,
  };
}

function headingQuality(headings: string[]): boolean {
  if (headings.length === 0) return false;
  const generic = headings.filter((heading) => GENERIC_HEADING_ONLY.test(heading.trim())).length;
  return generic < headings.length;
}

function hasSectionBodySeparation(parsed: ParsedArticleStructure): boolean {
  if (parsed.headings.length === 0) return parsed.paragraphs.length >= 3;
  return parsed.headings.some((heading) => {
    const index = parsed.nonEmptyLines.indexOf(heading);
    const next = index >= 0 ? parsed.nonEmptyLines[index + 1] : '';
    return !!next && !isHeading(next) && wordCount(next) >= 5;
  });
}

function recommendationFor(result: EditorGradeResult): ArticleStructureTelemetry['recommendation'] {
  if (result.score < 65 || result.checks.some((check) => !check.passed && check.id === 'article.collapsed_article_structure')) {
    return 'repair';
  }
  if (result.status !== 'approved' || result.score < 85) return 'review';
  return 'use';
}

export function validateArticleStructure(input: ArticleStructureValidationInput): EditorGradeResult | null {
  const logicalType = normalizeLogicalContentType(input.logicalContentType, '');
  if (logicalType !== 'article') return null;

  const parsed = parseArticleStructure(String(input.content ?? ''));
  const checks: EditorGradeCheck[] = [];
  const hasContent = parsed.wordCount > 0;
  const hasLists = parsed.bulletLines.length + parsed.numberedLines.length > 0;
  const usefulConclusion =
    wordCount(parsed.conclusion) >= 6 &&
    !GENERIC_HEADING_ONLY.test(parsed.conclusion);

  addEditorGradeCheck(checks, {
    id: 'article.content_present',
    phase: input.phase,
    severity: 'critical',
    passed: hasContent,
    message: hasContent ? undefined : 'Article content is missing.',
    score: hasContent ? 100 : 10,
  });
  addEditorGradeCheck(checks, {
    id: 'article.minimum_length',
    phase: input.phase,
    severity: 'minor',
    passed: parsed.wordCount >= 80,
    message: parsed.wordCount >= 80 ? undefined : 'Article is too thin to evaluate as editor-grade long-form content.',
    score: parsed.wordCount >= 80 ? 100 : 65,
    metadata: { word_count: parsed.wordCount },
  });
  addEditorGradeCheck(checks, {
    id: 'article.intro_present',
    phase: input.phase,
    severity: 'important',
    passed: wordCount(parsed.intro) >= 8,
    message: wordCount(parsed.intro) >= 8 ? undefined : 'Article is missing a substantive introduction.',
    score: wordCount(parsed.intro) >= 8 ? 100 : 55,
  });
  addEditorGradeCheck(checks, {
    id: 'article.section_count_minimum',
    phase: input.phase,
    severity: 'important',
    passed: parsed.headings.length >= 2 || parsed.paragraphs.length >= 4,
    message: parsed.headings.length >= 2 || parsed.paragraphs.length >= 4 ? undefined : 'Article has too little section structure.',
    score: parsed.headings.length >= 2 || parsed.paragraphs.length >= 4 ? 100 : 55,
    metadata: { section_heading_count: parsed.headings.length, paragraph_count: parsed.paragraphs.length },
  });
  addEditorGradeCheck(checks, {
    id: 'article.heading_quality',
    phase: input.phase,
    severity: 'minor',
    passed: headingQuality(parsed.headings) || parsed.paragraphs.length >= 4,
    message: headingQuality(parsed.headings) || parsed.paragraphs.length >= 4 ? undefined : 'Article headings are missing or too generic.',
    score: headingQuality(parsed.headings) || parsed.paragraphs.length >= 4 ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'article.paragraph_structure',
    phase: input.phase,
    severity: 'minor',
    passed: parsed.paragraphs.length >= 3,
    message: parsed.paragraphs.length >= 3 ? undefined : 'Article does not preserve enough paragraph separation.',
    score: parsed.paragraphs.length >= 3 ? 100 : 55,
  });
  addEditorGradeCheck(checks, {
    id: 'article.conclusion_present',
    phase: input.phase,
    severity: 'important',
    passed: usefulConclusion,
    message: usefulConclusion ? undefined : 'Article is missing a clear conclusion or closing takeaway.',
    score: usefulConclusion ? 100 : 55,
  });
  addEditorGradeCheck(checks, {
    id: 'article.collapsed_article_structure',
    phase: input.phase,
    severity: 'critical',
    passed: !parsed.collapsed,
    message: parsed.collapsed ? 'Article sections appear collapsed into a single paragraph.' : undefined,
    score: parsed.collapsed ? 20 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'article.section_body_separation',
    phase: input.phase,
    severity: 'minor',
    passed: hasSectionBodySeparation(parsed),
    message: hasSectionBodySeparation(parsed) ? undefined : 'Article headings and body copy are not clearly separated.',
    score: hasSectionBodySeparation(parsed) ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'article.list_preservation',
    phase: input.phase,
    severity: 'minor',
    passed: !hasLists || parsed.bulletLines.length + parsed.numberedLines.length >= 2,
    message: !hasLists || parsed.bulletLines.length + parsed.numberedLines.length >= 2 ? undefined : 'Article list structure appears incomplete.',
    score: !hasLists || parsed.bulletLines.length + parsed.numberedLines.length >= 2 ? 100 : 70,
  });
  addEditorGradeCheck(checks, {
    id: 'article.generic_post_rendering',
    phase: input.phase,
    severity: 'critical',
    passed: parsed.wordCount >= 80 || parsed.headings.length >= 2 || parsed.paragraphs.length >= 4,
    message: parsed.wordCount >= 80 || parsed.headings.length >= 2 || parsed.paragraphs.length >= 4
      ? undefined
      : 'Article resembles a short generic post rather than structured article content.',
    score: parsed.wordCount >= 80 || parsed.headings.length >= 2 || parsed.paragraphs.length >= 4 ? 100 : 50,
  });

  const result = createEditorGradeResult({ checks });
  emitArticleStructureTelemetry(input, result);
  return result;
}

export function buildArticleStructureTelemetry(result: EditorGradeResult): ArticleStructureTelemetry {
  const failed = result.checks.filter((check) => !check.passed);
  const criticalIds = new Set([
    'article.content_present',
    'article.intro_present',
    'article.section_count_minimum',
    'article.conclusion_present',
    'article.collapsed_article_structure',
    'article.generic_post_rendering',
  ]);
  return {
    score: result.score,
    issues: failed
      .filter((check) => criticalIds.has(check.id))
      .map((check) => check.id.replace(/^article\./, '')),
    warnings: failed
      .filter((check) => !criticalIds.has(check.id))
      .map((check) => check.id.replace(/^article\./, '')),
    recommendation: recommendationFor(result),
  };
}

export function emitArticleStructureTelemetry(
  input: ArticleStructureValidationInput,
  result: EditorGradeResult,
): void {
  const telemetry = buildArticleStructureTelemetry(result);
  console.info('[article-structure][warn-mode]', {
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
