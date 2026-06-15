import {
  createEditorGradeResult,
  type EditorGradeCheck,
  type EditorGradePhase,
  type EditorGradeResult,
} from './editorGradeReadiness';
import { normalizeLogicalContentType } from './contentTypeIntegrity';
import { addEditorGradeCheck, wordCount } from './titleRuleCatalog';

export type PostBodyQualityValidationInput = {
  content?: string | null;
  title?: string | null;
  logicalContentType?: string | null;
  platform?: string | null;
  phase: EditorGradePhase;
  source?: string | null;
};

export type PostBodyQualityTelemetry = {
  score: number;
  issues: string[];
  warnings: string[];
  recommendation: 'use' | 'review' | 'repair';
};

type ParsedPostBody = {
  text: string;
  normalizedText: string;
  paragraphs: string[];
  sentences: string[];
  words: string[];
  wordCount: number;
  genericAdviceMatches: string[];
  fillerMatches: string[];
  aiPhrasingMatches: string[];
  vagueAdviceMatches: string[];
  unsupportedClaimMatches: string[];
};

const GENERIC_ADVICE_PATTERNS = [
  /\bprovide value\b/i,
  /\bbe consistent\b/i,
  /\bconsistency is key\b/i,
  /\bengage with your audience\b/i,
  /\bknow your audience\b/i,
  /\bfocus on quality\b/i,
  /\bbuild relationships\b/i,
  /\bstay authentic\b/i,
  /\btake your business to the next level\b/i,
  /\bunlock (?:the )?(?:power|potential)\b/i,
];

const FILLER_PATTERNS = [
  /\bin today'?s (?:fast-paced|digital|competitive) (?:world|landscape|environment)\b/i,
  /\bit'?s important to (?:note|remember|understand)\b/i,
  /\bat the end of the day\b/i,
  /\bwhen it comes to\b/i,
  /\bnow more than ever\b/i,
  /\bneedless to say\b/i,
  /\bin conclusion\b/i,
];

const GENERIC_AI_PHRASING_PATTERNS = [
  /\bdelve into\b/i,
  /\bleverage\b/i,
  /\bharness\b/i,
  /\bseamlessly\b/i,
  /\brobust\b/i,
  /\bgame[- ]changer\b/i,
  /\brevolutioni[sz]e\b/i,
  /\belevate your\b/i,
  /\bcutting-edge\b/i,
  /\btransformative\b/i,
];

const VAGUE_BUSINESS_ADVICE_PATTERNS = [
  /\bdrive growth\b/i,
  /\bboost engagement\b/i,
  /\bmaximize results\b/i,
  /\boptimi[sz]e performance\b/i,
  /\bdata-driven decisions\b/i,
  /\bscale your business\b/i,
  /\bimprove your strategy\b/i,
  /\bincrease visibility\b/i,
];

const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bguaranteed\b/i,
  /\balways\b/i,
  /\bnever\b/i,
  /\bbest\b/i,
  /\bproven\b/i,
  /\bdramatically\b/i,
  /\bsignificantly\b/i,
  /\bexponential(?:ly)?\b/i,
  /\bstudies show\b/i,
  /\bresearch proves\b/i,
];

const CTA_PATTERN =
  /\b(comment|reply|share|save|follow|dm|tell me|what would you|which one|try this|read more|learn more|book|download|subscribe|start)\b/i;
const WEAK_CTA_PATTERN = /^(thoughts\??|agree\??|what do you think\??|let me know\??)$/i;
const INSIGHT_PATTERN =
  /\b(because|why|how|instead|but|so|therefore|means|reveals|shows|signals|tradeoff|lesson|takeaway|example|metric|customer|campaign|revenue|pipeline|conversion|retention|cost)\b/i;
const TEMPLATE_PATTERN =
  /^(?:hook|headline|intro|body|cta|caption|post|content)[:.-]/i;

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function matchesFor(text: string, patterns: RegExp[]): string[] {
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
}

function parsePostBody(content: string): ParsedPostBody {
  const text = normalizeText(content);
  const normalizedText = compact(text);
  const paragraphs = text.split(/\n{2,}/).map((part) => compact(part)).filter(Boolean);
  const sentences = normalizedText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => compact(sentence))
    .filter(Boolean);
  const words = normalizedText.toLowerCase().match(/\b[a-z0-9][a-z0-9'-]*\b/g) ?? [];

  return {
    text,
    normalizedText,
    paragraphs,
    sentences,
    words,
    wordCount: words.length,
    genericAdviceMatches: matchesFor(normalizedText, GENERIC_ADVICE_PATTERNS),
    fillerMatches: matchesFor(normalizedText, FILLER_PATTERNS),
    aiPhrasingMatches: matchesFor(normalizedText, GENERIC_AI_PHRASING_PATTERNS),
    vagueAdviceMatches: matchesFor(normalizedText, VAGUE_BUSINESS_ADVICE_PATTERNS),
    unsupportedClaimMatches: matchesFor(normalizedText, UNSUPPORTED_CLAIM_PATTERNS),
  };
}

function uniqueWordRatio(words: string[]): number {
  if (words.length === 0) return 0;
  return new Set(words).size / words.length;
}

function hasExcessiveRepetition(parsed: ParsedPostBody): boolean {
  if (parsed.words.length < 20) return false;
  const ratio = uniqueWordRatio(parsed.words);
  const repeatedLongWords = parsed.words.filter((word, index, arr) =>
    word.length > 5 && arr.indexOf(word) !== index
  );
  return ratio < 0.58 || repeatedLongWords.length >= 8;
}

function hasParagraphQuality(parsed: ParsedPostBody): boolean {
  if (parsed.wordCount < 15) return false;
  if (parsed.paragraphs.length === 0) return false;
  return parsed.paragraphs.every((paragraph) => {
    const count = wordCount(paragraph);
    return count >= 5 && count <= 95;
  });
}

function hasReadableSentences(parsed: ParsedPostBody): boolean {
  if (parsed.sentences.length === 0) return false;
  const sentenceLengths = parsed.sentences.map(wordCount);
  const longest = Math.max(...sentenceLengths);
  const average = sentenceLengths.reduce((sum, count) => sum + count, 0) / sentenceLengths.length;
  return longest <= 42 && average <= 26;
}

function hasWeakTakeaway(parsed: ParsedPostBody): boolean {
  const lastParagraph = parsed.paragraphs[parsed.paragraphs.length - 1] ?? parsed.normalizedText;
  return wordCount(lastParagraph) < 6 ||
    (!INSIGHT_PATTERN.test(lastParagraph) && !CTA_PATTERN.test(lastParagraph));
}

function hasAbruptEnding(parsed: ParsedPostBody): boolean {
  return !parsed.normalizedText ||
    /[:,-]\s*$/.test(parsed.normalizedText) ||
    wordCount(parsed.paragraphs[parsed.paragraphs.length - 1] ?? '') < 4;
}

function hasCtaQuality(parsed: ParsedPostBody): boolean {
  const lastParagraph = parsed.paragraphs[parsed.paragraphs.length - 1] ?? '';
  if (!CTA_PATTERN.test(parsed.normalizedText)) return false;
  return !WEAK_CTA_PATTERN.test(lastParagraph.trim()) && wordCount(lastParagraph) >= 4;
}

function hasSpecificity(parsed: ParsedPostBody): boolean {
  return /\d|%|\$|\b(customer|campaign|pipeline|revenue|conversion|retention|cost|budget|audience|channel|message|founder|sales|marketing|linkedin|instagram|seo|crm|b2b|saas|ai)\b/i
    .test(parsed.normalizedText);
}

function hasMissingInsight(parsed: ParsedPostBody): boolean {
  return !INSIGHT_PATTERN.test(parsed.normalizedText) || !hasSpecificity(parsed);
}

function recommendationFor(result: EditorGradeResult): PostBodyQualityTelemetry['recommendation'] {
  if (
    result.score < 65 ||
    result.checks.some((check) =>
      !check.passed &&
      ['post.low_information_content', 'post.obvious_template_content', 'post.shallow_content'].includes(check.id)
    )
  ) {
    return 'repair';
  }
  if (result.status !== 'approved' || result.score < 85) return 'review';
  return 'use';
}

export function validatePostBodyQuality(input: PostBodyQualityValidationInput): EditorGradeResult | null {
  const logicalType = normalizeLogicalContentType(input.logicalContentType, '');
  if (logicalType !== 'post') return null;

  const parsed = parsePostBody(String(input.content ?? ''));
  const checks: EditorGradeCheck[] = [];
  const genericAdvice = parsed.genericAdviceMatches.length >= 2;
  const lowInformation = parsed.wordCount < 18 || (parsed.wordCount < 35 && !hasSpecificity(parsed));
  const excessiveRepetition = hasExcessiveRepetition(parsed);
  const fluff = parsed.fillerMatches.length >= 2 || parsed.fillerMatches.length + parsed.aiPhrasingMatches.length >= 3;
  const weakTakeaway = hasWeakTakeaway(parsed);
  const missingInsight = hasMissingInsight(parsed);
  const unsupportedClaimDensity = parsed.unsupportedClaimMatches.length >= 2 && !/\d|%|\$|source|report|survey|study/i.test(parsed.normalizedText);
  const shallowContent = parsed.wordCount < 45 && (genericAdvice || missingInsight || parsed.vagueAdviceMatches.length > 0);
  const paragraphQuality = hasParagraphQuality(parsed);
  const readable = hasReadableSentences(parsed);
  const abruptEnding = hasAbruptEnding(parsed);
  const ctaQuality = hasCtaQuality(parsed);
  const genericAiPhrasing = parsed.aiPhrasingMatches.length >= 2;
  const emptyMotivationalLanguage =
    /\b(dream big|believe in yourself|keep pushing|success starts|anything is possible|mindset is everything)\b/i.test(parsed.normalizedText) &&
    !hasSpecificity(parsed);
  const vagueBusinessAdvice = parsed.vagueAdviceMatches.length >= 2 && !hasSpecificity(parsed);
  const obviousTemplateContent = parsed.paragraphs.some((paragraph) => TEMPLATE_PATTERN.test(paragraph));

  addEditorGradeCheck(checks, {
    id: 'post.generic_advice',
    phase: input.phase,
    severity: 'important',
    passed: !genericAdvice,
    message: genericAdvice ? 'Post relies on generic advice without enough distinct editorial value.' : undefined,
    score: genericAdvice ? 50 : 100,
    metadata: { match_count: parsed.genericAdviceMatches.length },
  });
  addEditorGradeCheck(checks, {
    id: 'post.low_information_content',
    phase: input.phase,
    severity: 'important',
    passed: !lowInformation,
    message: lowInformation ? 'Post body is too low-information to be editor-grade.' : undefined,
    score: lowInformation ? 40 : 100,
    metadata: { word_count: parsed.wordCount },
  });
  addEditorGradeCheck(checks, {
    id: 'post.excessive_repetition',
    phase: input.phase,
    severity: 'minor',
    passed: !excessiveRepetition,
    message: excessiveRepetition ? 'Post repeats too many words or ideas.' : undefined,
    score: excessiveRepetition ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'post.fluff_filler',
    phase: input.phase,
    severity: 'minor',
    passed: !fluff,
    message: fluff ? 'Post contains excessive filler or padding phrases.' : undefined,
    score: fluff ? 60 : 100,
    metadata: { filler_count: parsed.fillerMatches.length, ai_phrase_count: parsed.aiPhrasingMatches.length },
  });
  addEditorGradeCheck(checks, {
    id: 'post.weak_takeaway',
    phase: input.phase,
    severity: 'minor',
    passed: !weakTakeaway,
    message: weakTakeaway ? 'Post lacks a clear takeaway or useful closing idea.' : undefined,
    score: weakTakeaway ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'post.missing_insight',
    phase: input.phase,
    severity: 'important',
    passed: !missingInsight,
    message: missingInsight ? 'Post is missing a concrete insight, reason, or specific angle.' : undefined,
    score: missingInsight ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'post.unsupported_claim_density',
    phase: input.phase,
    severity: 'minor',
    passed: !unsupportedClaimDensity,
    message: unsupportedClaimDensity ? 'Post makes multiple strong claims without support or specificity.' : undefined,
    score: unsupportedClaimDensity ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'post.shallow_content',
    phase: input.phase,
    severity: 'important',
    passed: !shallowContent,
    message: shallowContent ? 'Post is too shallow for editor-grade publication.' : undefined,
    score: shallowContent ? 50 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'post.paragraph_quality',
    phase: input.phase,
    severity: 'minor',
    passed: paragraphQuality,
    message: paragraphQuality ? undefined : 'Post paragraph structure is weak or hard to scan.',
    score: paragraphQuality ? 100 : 65,
    metadata: { paragraph_count: parsed.paragraphs.length },
  });
  addEditorGradeCheck(checks, {
    id: 'post.readability',
    phase: input.phase,
    severity: 'minor',
    passed: readable,
    message: readable ? undefined : 'Post sentence length or flow may hurt readability.',
    score: readable ? 100 : 65,
  });
  addEditorGradeCheck(checks, {
    id: 'post.abrupt_ending',
    phase: input.phase,
    severity: 'minor',
    passed: !abruptEnding,
    message: abruptEnding ? 'Post appears to end abruptly.' : undefined,
    score: abruptEnding ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'post.cta_quality',
    phase: input.phase,
    severity: 'minor',
    passed: ctaQuality,
    message: ctaQuality ? undefined : 'Post CTA is missing or too generic.',
    score: ctaQuality ? 100 : 70,
  });
  addEditorGradeCheck(checks, {
    id: 'post.generic_ai_phrasing',
    phase: input.phase,
    severity: 'minor',
    passed: !genericAiPhrasing,
    message: genericAiPhrasing ? 'Post uses generic AI-sounding phrasing.' : undefined,
    score: genericAiPhrasing ? 60 : 100,
    metadata: { match_count: parsed.aiPhrasingMatches.length },
  });
  addEditorGradeCheck(checks, {
    id: 'post.empty_motivational_language',
    phase: input.phase,
    severity: 'minor',
    passed: !emptyMotivationalLanguage,
    message: emptyMotivationalLanguage ? 'Post leans on motivational language without substance.' : undefined,
    score: emptyMotivationalLanguage ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'post.vague_business_advice',
    phase: input.phase,
    severity: 'minor',
    passed: !vagueBusinessAdvice,
    message: vagueBusinessAdvice ? 'Post gives vague business advice without a concrete angle.' : undefined,
    score: vagueBusinessAdvice ? 60 : 100,
    metadata: { match_count: parsed.vagueAdviceMatches.length },
  });
  addEditorGradeCheck(checks, {
    id: 'post.obvious_template_content',
    phase: input.phase,
    severity: 'important',
    passed: !obviousTemplateContent,
    message: obviousTemplateContent ? 'Post appears to include visible template labels.' : undefined,
    score: obviousTemplateContent ? 45 : 100,
  });

  const result = createEditorGradeResult({ checks });
  emitPostBodyQualityTelemetry(input, result);
  return result;
}

export function buildPostBodyQualityTelemetry(result: EditorGradeResult): PostBodyQualityTelemetry {
  const failed = result.checks.filter((check) => !check.passed);
  const issueSeverities = new Set(['blocking', 'critical', 'important']);
  return {
    score: result.score,
    issues: failed
      .filter((check) => issueSeverities.has(String(check.severity)))
      .map((check) => check.id.replace(/^post\./, '')),
    warnings: failed
      .filter((check) => !issueSeverities.has(String(check.severity)))
      .map((check) => check.id.replace(/^post\./, '')),
    recommendation: recommendationFor(result),
  };
}

export function emitPostBodyQualityTelemetry(
  input: PostBodyQualityValidationInput,
  result: EditorGradeResult,
): void {
  const telemetry = buildPostBodyQualityTelemetry(result);
  console.info('[post-body-quality][warn-mode]', {
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
