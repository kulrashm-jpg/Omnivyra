import type { EditorGradeCheck, EditorGradePhase } from './editorGradeReadiness';

export const TITLE_CLICKBAIT_PATTERNS = [
  /\bstop doing\b/i,
  /\bthe hard way\b/i,
  /\bnobody talks about\b/i,
  /\bstop making this\b/i,
  /\bavoid these common\b/i,
  /\bsecret\b/i,
  /\bshocking\b/i,
  /\byou won'?t believe\b/i,
  /\bthis changes everything\b/i,
  /\btruth about\b/i,
  /\beverything you know\b/i,
  /\bhot take\b/i,
  /\bwarning\b/i,
];

export const GENERIC_TITLE_PATTERNS = [
  /^(?:the\s+)?(power|importance|future|ultimate guide|complete guide|value|role|impact|benefits?) of\b/i,
  /^(tips|strategies|best practices|insights) for\b/i,
  /\bthings you need to know\b/i,
  /\beverything you need to know\b/i,
  /\bthis\b.+\bmistake\b/i,
  /^avoid these common\b/i,
];

export const GENERIC_HOOK_PATTERNS = [
  /^want to\b/i,
  /^are you ready\b/i,
  /^did you know\b/i,
  /^in today's (world|digital world|fast-paced world)\b/i,
  /^let'?s talk about\b/i,
  /^here'?s what you need to know\b/i,
  /^this is for you\b/i,
  /^quick question\b/i,
  /^what do you think\b/i,
];

export const DUPLICATE_DETERMINER = /\b(the|a|an|this|that|these|those|your|our)\s+\1\b/i;
export const DUPLICATE_DETERMINER_GLOBAL = /\b(the|a|an|this|that|these|those|your|our)\s+\1\b/gi;
export const BROKEN_NOUN_PHRASE_WRAPPER =
  /\bstop doing\s+(?:the\s+)?(power|importance|value|future|role|impact|benefits?)\s+of\b/i;
export const BROKEN_NOUN_PHRASE_WRAPPER_WITH_SUBJECT =
  /\bstop doing\s+(?:the\s+)?(power|importance|value|future|role|impact|benefits?)\s+of\s+(.+?)\s+the hard way$/i;
export const NOUN_PHRASE_OPENING =
  /^(?:the\s+)?(power|importance|value|future|role|impact|benefits?)\s+of\s+(.+)$/i;
export const MALFORMED_OPENING =
  /\b(the|a|an)\s+(power|importance|value|future|role|impact)\s+of\b/i;
export const TEMPLATE_COLLISION = /\bstop doing\b.+\b(the hard way)\b/i;
export const INCOMPLETE_HEADLINE = /\b(of|for|with|to|from|by|about|and|or)$/i;

export const UNSUPPORTED_TITLE_TOPIC_PAIRINGS: Record<string, RegExp[]> = {
  poll: [/\bultimate guide\b/i, /\bcomplete guide\b/i, /\bdeep dive\b/i, /\blong-form\b/i],
  thread: [/\bone-word\b/i, /\byes\/no\b/i],
  article: [/\bquick poll\b/i, /\bvote\b/i],
  newsletter: [/\bquick poll\b/i, /\bvote\b/i],
};

export function cleanTitleRuleText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function countRuleMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function wordCount(value: string): number {
  return cleanTitleRuleText(value).split(/\s+/).filter(Boolean).length;
}

export function normalizeTitleRuleKey(value: string): string {
  return cleanTitleRuleText(value)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\b(the|a|an|and|or|to|of|for|with|your|our|this|that)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTopicSimilarity(a: string, b: string): number {
  const aWords = new Set(normalizeTitleRuleKey(a).split(/\s+/).filter(Boolean));
  const bWords = new Set(normalizeTitleRuleKey(b).split(/\s+/).filter(Boolean));
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let shared = 0;
  for (const word of aWords) if (bWords.has(word)) shared += 1;
  return shared / Math.max(aWords.size, bWords.size);
}

export function addEditorGradeCheck(
  checks: EditorGradeCheck[],
  args: Omit<EditorGradeCheck, 'severity'> & { severity?: EditorGradeCheck['severity'] },
): void {
  checks.push({
    ...args,
    severity: args.passed ? 'informational' : args.severity ?? 'minor',
  });
}

export function buildTitleEditorialChecks(title: string, phase: EditorGradePhase): EditorGradeCheck[] {
  const checks: EditorGradeCheck[] = [];
  const normalized = cleanTitleRuleText(title);
  if (!normalized) return checks;

  const words = wordCount(normalized);
  const clickbaitCount = countRuleMatches(normalized, TITLE_CLICKBAIT_PATTERNS);
  const genericCount = countRuleMatches(normalized, GENERIC_TITLE_PATTERNS);
  const malformedWrapper = BROKEN_NOUN_PHRASE_WRAPPER.test(normalized);
  const templateCollision = TEMPLATE_COLLISION.test(normalized) && MALFORMED_OPENING.test(normalized);
  const duplicateDeterminer = DUPLICATE_DETERMINER.test(normalized);
  const naturalLength = words >= 4 && words <= 14;
  const specific = /\b(ai|seo|crm|b2b|saas|linkedin|instagram|revenue|pipeline|campaign|customer|founder|marketing|sales|content)\b/i.test(normalized) || /\d/.test(normalized);
  const editorialTone = clickbaitCount <= 1 && !/\b(secret|shocking|you won'?t believe)\b/i.test(normalized);

  addEditorGradeCheck(checks, {
    id: 'title.malformed_headline_wrapper',
    phase,
    severity: 'critical',
    passed: !malformedWrapper,
    message: malformedWrapper ? 'Title uses a headline wrapper around an incompatible noun phrase.' : undefined,
    score: malformedWrapper ? 15 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'title.duplicate_determiner',
    phase,
    severity: 'important',
    passed: !duplicateDeterminer,
    message: duplicateDeterminer ? 'Title contains duplicate determiners.' : undefined,
    score: duplicateDeterminer ? 35 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'title.template_collision',
    phase,
    severity: 'critical',
    passed: !templateCollision,
    message: templateCollision ? 'Title appears to combine a clickbait wrapper with a noun-phrase template.' : undefined,
    score: templateCollision ? 10 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'title.clickbait_excess',
    phase,
    severity: 'important',
    passed: clickbaitCount <= 1,
    message: clickbaitCount > 1 ? 'Title relies on multiple clickbait signals.' : undefined,
    score: clickbaitCount > 1 ? 45 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'title.generic_weak_title',
    phase,
    severity: 'minor',
    passed: genericCount === 0 || specific,
    message: genericCount > 0 && !specific ? 'Title is generic and lacks a concrete editorial angle.' : undefined,
    score: genericCount > 0 && !specific ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'title.natural_language_flow',
    phase,
    severity: 'minor',
    passed: naturalLength && !malformedWrapper && !templateCollision,
    message: !naturalLength ? 'Title length or phrasing may not read naturally.' : undefined,
    score: naturalLength && !malformedWrapper && !templateCollision ? 100 : 60,
  });
  addEditorGradeCheck(checks, {
    id: 'title.publication_readiness',
    phase,
    severity: 'minor',
    passed: specific && editorialTone && !malformedWrapper && !templateCollision,
    message: specific && editorialTone ? undefined : 'Title may need editorial review before publication.',
    score: specific && editorialTone && !malformedWrapper && !templateCollision ? 100 : 65,
  });

  return checks;
}
