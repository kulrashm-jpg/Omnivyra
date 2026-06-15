import {
  createEditorGradeResult,
  type EditorGradeCheck,
  type EditorGradeResult,
} from './editorGradeReadiness';
import { normalizeLogicalContentType } from './contentTypeIntegrity';
import {
  BROKEN_NOUN_PHRASE_WRAPPER_WITH_SUBJECT,
  DUPLICATE_DETERMINER,
  DUPLICATE_DETERMINER_GLOBAL,
  GENERIC_TITLE_PATTERNS,
  INCOMPLETE_HEADLINE,
  NOUN_PHRASE_OPENING,
  TITLE_CLICKBAIT_PATTERNS,
  UNSUPPORTED_TITLE_TOPIC_PAIRINGS,
  addEditorGradeCheck,
  cleanTitleRuleText,
  countRuleMatches,
  normalizeTitleRuleKey,
  titleTopicSimilarity,
  wordCount,
} from './titleRuleCatalog';

export type PlannerTitleSanitizerInput = {
  title?: string | null;
  topic?: string | null;
  contentType?: string | null;
  platform?: string | null;
  objective?: string | null;
  peerTopics?: string[];
  source?: string | null;
};

export type PlannerSanitizedField = {
  original: string;
  sanitized: string;
  repair_reason: string[];
  changed: boolean;
};

export type PlannerTitleSanitizerResult = {
  original_title: string;
  sanitized_title: string;
  title_repair_reason: string[];
  original_topic: string;
  sanitized_topic: string;
  topic_repair_reason: string[];
  score_delta: number;
  editor_grade_result: EditorGradeResult;
};

function clean(value: unknown): string {
  return cleanTitleRuleText(value);
}

function titleCase(value: string): string {
  const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  const capitalizeToken = (token: string) => {
    if (/^[A-Z]{2,}$/.test(token) || /\d/.test(token)) return token;
    const lower = token.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  const words = clean(value).split(' ');
  return words
    .map((word, index) => {
      if (/^[A-Z]{2,}$/.test(word) || /\d/.test(word)) return word;
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return lower.split('-').map(capitalizeToken).join('-');
    })
    .join(' ')
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bAi-/g, 'AI-')
    .replace(/\bSeo\b/g, 'SEO')
    .replace(/\bCrm\b/g, 'CRM')
    .replace(/\bB2b\b/g, 'B2B')
    .replace(/\bSaas\b/g, 'SaaS')
    .replace(/\bLinkedin\b/g, 'LinkedIn');
}

function sentenceCase(value: string): string {
  const text = clean(value);
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeKey(value: string): string {
  return normalizeTitleRuleKey(value);
}

function similarity(a: string, b: string): number {
  return titleTopicSimilarity(a, b);
}

function uniqueReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons.filter(Boolean)));
}

function removeClickbaitWrappers(value: string, reasons: string[]): string {
  let next = clean(value);
  const broken = next.match(BROKEN_NOUN_PHRASE_WRAPPER_WITH_SUBJECT);
  if (broken?.[2]) {
    reasons.push('template_collision', 'malformed_headline_wrapper');
    return `Using ${clean(broken[2])} More Effectively`;
  }

  if (/\bstop doing\b/i.test(next) && /\bthe hard way\b/i.test(next)) {
    reasons.push('clickbait_stacking');
    next = next
      .replace(/\bstop doing\b/i, 'Improve')
      .replace(/\bthe hard way\b/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (/\bnobody talks about\b/i.test(next)) {
    reasons.push('clickbait_stacking');
    next = next.replace(/\bnobody talks about\b/i, 'Understanding').trim();
  }

  const stopMaking = next.match(/^stop making this\s+(.+?)\s+mistake$/i);
  if (stopMaking?.[1]) {
    reasons.push('weak_generic_title');
    next = `Fixing ${clean(stopMaking[1])} Mistakes`;
  }

  const avoidCommon = next.match(/^avoid these common\s+(.+?)\s+(errors|mistakes)$/i);
  if (avoidCommon?.[1] && avoidCommon?.[2]) {
    reasons.push('weak_generic_title');
    next = `Avoiding Common ${clean(avoidCommon[1])} ${clean(avoidCommon[2])}`;
  }

  return next;
}

function sanitizeNounPhraseOpening(value: string, reasons: string[]): string {
  const match = clean(value).match(NOUN_PHRASE_OPENING);
  if (!match?.[2]) return value;
  reasons.push('malformed_headline_wrapper');
  const subject = clean(match[2]);
  if (/^(ai|seo|crm|b2b|saas)\b/i.test(subject) || subject.split(/\s+/).length <= 5) {
    return `Using ${subject} Effectively`;
  }
  return subject;
}

function sanitizeTitleValue(value: string): PlannerSanitizedField {
  const original = clean(value);
  const reasons: string[] = [];
  let sanitized = original;

  if (!sanitized) {
    return { original, sanitized, repair_reason: ['missing_title'], changed: false };
  }

  if (DUPLICATE_DETERMINER.test(sanitized)) {
    reasons.push('duplicate_determiner');
    sanitized = sanitized.replace(DUPLICATE_DETERMINER_GLOBAL, '$1');
  }

  sanitized = removeClickbaitWrappers(sanitized, reasons);
  sanitized = sanitizeNounPhraseOpening(sanitized, reasons);

  if (countRuleMatches(original, TITLE_CLICKBAIT_PATTERNS) > 1) reasons.push('clickbait_stacking');
  if (GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(original))) reasons.push('weak_generic_title');

  if (/\beverything you need to know\b/i.test(sanitized)) {
    reasons.push('weak_generic_title');
    sanitized = sanitized
      .replace(/\s*[—-]\s*everything you need to know(?: about)?\s*/i, ' ')
      .replace(/\beverything you need to know(?: about)?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (INCOMPLETE_HEADLINE.test(sanitized)) {
    reasons.push('incomplete_headline');
    sanitized = sanitized.replace(INCOMPLETE_HEADLINE, '').trim();
  }

  if (/\b(the|a|an)\s+(power|importance|value|future|role|impact)\s+of\b/i.test(original)) {
    reasons.push('broken_grammar_pattern');
  }

  sanitized = titleCase(sanitized);
  return {
    original,
    sanitized,
    repair_reason: uniqueReasons(reasons),
    changed: normalizeKey(original) !== normalizeKey(sanitized),
  };
}

function sanitizeTopicValue(input: {
  topic: string;
  contentType: string;
  peerTopics: string[];
}): PlannerSanitizedField {
  const original = clean(input.topic);
  const reasons: string[] = [];
  let sanitized = original;
  const words = wordCount(original);
  const normalized = normalizeKey(original);

  if (!original) {
    return { original, sanitized, repair_reason: ['missing_topic'], changed: false };
  }

  if (words < 3 || /^(ai|marketing|sales|content|growth|strategy|social media)$/i.test(original)) {
    reasons.push('vague_topic', 'low_information_topic');
    sanitized = `Practical ${original} Decisions`;
  }

  if (words > 16 || /\beverything\b|\ball about\b|\bcomplete guide\b/i.test(original)) {
    reasons.push('overly_broad_topic');
    sanitized = sanitized
      .replace(/\beverything (you need to know )?(about )?/i, '')
      .replace(/\ball about\b/i, '')
      .replace(/\bcomplete guide to\b/i, '')
      .trim();
  }

  const duplicateCount = input.peerTopics
    .map(normalizeKey)
    .filter((topic) => topic && topic === normalized).length;
  if (duplicateCount > 1) reasons.push('duplicate_topic');

  const unsupported = UNSUPPORTED_TITLE_TOPIC_PAIRINGS[input.contentType] ?? [];
  if (unsupported.some((pattern) => pattern.test(original))) reasons.push('unsupported_content_type_topic_pairing');

  sanitized = sentenceCase(sanitized);
  return {
    original,
    sanitized,
    repair_reason: uniqueReasons(reasons),
    changed: normalizeKey(original) !== normalizeKey(sanitized),
  };
}

function buildChecks(input: PlannerTitleSanitizerInput, title: PlannerSanitizedField, topic: PlannerSanitizedField): EditorGradeCheck[] {
  const checks: EditorGradeCheck[] = [];
  const originalTitle = title.original;
  const originalTopic = topic.original;
  const contentType = normalizeLogicalContentType(input.contentType, 'post');
  const titleTopicMismatch = !!originalTitle && !!originalTopic && similarity(originalTitle, originalTopic) < 0.25;

  const titleReasons = new Set(title.repair_reason);
  const topicReasons = new Set(topic.repair_reason);
  addEditorGradeCheck(checks, {
    id: 'planner_title.malformed_wrapper',
    phase: 'planner',
    severity: 'critical',
    passed: !titleReasons.has('malformed_headline_wrapper'),
    message: titleReasons.has('malformed_headline_wrapper') ? 'Planner title uses a malformed headline wrapper.' : undefined,
    score: titleReasons.has('malformed_headline_wrapper') ? 20 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_title.duplicate_determiner',
    phase: 'planner',
    severity: 'important',
    passed: !titleReasons.has('duplicate_determiner'),
    message: titleReasons.has('duplicate_determiner') ? 'Planner title contains duplicate determiners.' : undefined,
    score: titleReasons.has('duplicate_determiner') ? 45 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_title.template_collision',
    phase: 'planner',
    severity: 'critical',
    passed: !titleReasons.has('template_collision'),
    message: titleReasons.has('template_collision') ? 'Planner title combines incompatible headline templates.' : undefined,
    score: titleReasons.has('template_collision') ? 10 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_title.clickbait_stacking',
    phase: 'planner',
    severity: 'important',
    passed: !titleReasons.has('clickbait_stacking'),
    message: titleReasons.has('clickbait_stacking') ? 'Planner title stacks multiple clickbait patterns.' : undefined,
    score: titleReasons.has('clickbait_stacking') ? 40 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_title.weak_generic_title',
    phase: 'planner',
    severity: 'minor',
    passed: !titleReasons.has('weak_generic_title'),
    message: titleReasons.has('weak_generic_title') ? 'Planner title is generic and should be made more specific.' : undefined,
    score: titleReasons.has('weak_generic_title') ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_title.incomplete_headline',
    phase: 'planner',
    severity: 'important',
    passed: !titleReasons.has('incomplete_headline'),
    message: titleReasons.has('incomplete_headline') ? 'Planner title appears incomplete.' : undefined,
    score: titleReasons.has('incomplete_headline') ? 35 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_title.broken_grammar_pattern',
    phase: 'planner',
    severity: 'important',
    passed: !titleReasons.has('broken_grammar_pattern'),
    message: titleReasons.has('broken_grammar_pattern') ? 'Planner title has a broken grammar pattern.' : undefined,
    score: titleReasons.has('broken_grammar_pattern') ? 40 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_title.topic_mismatch',
    phase: 'planner',
    severity: 'minor',
    passed: !titleTopicMismatch,
    message: titleTopicMismatch ? 'Planner title and topic appear mismatched.' : undefined,
    score: titleTopicMismatch ? 50 : 100,
    metadata: { similarity: similarity(originalTitle, originalTopic) },
  });
  addEditorGradeCheck(checks, {
    id: 'planner_topic.vague_topic',
    phase: 'planner',
    severity: 'minor',
    passed: !topicReasons.has('vague_topic'),
    message: topicReasons.has('vague_topic') ? 'Planner topic is vague.' : undefined,
    score: topicReasons.has('vague_topic') ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_topic.overly_broad_topic',
    phase: 'planner',
    severity: 'minor',
    passed: !topicReasons.has('overly_broad_topic'),
    message: topicReasons.has('overly_broad_topic') ? 'Planner topic is overly broad.' : undefined,
    score: topicReasons.has('overly_broad_topic') ? 60 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_topic.duplicate_topic',
    phase: 'planner',
    severity: 'minor',
    passed: !topicReasons.has('duplicate_topic'),
    message: topicReasons.has('duplicate_topic') ? 'Planner topic duplicates another planned item.' : undefined,
    score: topicReasons.has('duplicate_topic') ? 65 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_topic.unsupported_content_type_pairing',
    phase: 'planner',
    severity: 'important',
    passed: !topicReasons.has('unsupported_content_type_topic_pairing'),
    message: topicReasons.has('unsupported_content_type_topic_pairing') ? `Planner topic may not fit content type "${contentType}".` : undefined,
    score: topicReasons.has('unsupported_content_type_topic_pairing') ? 55 : 100,
  });
  addEditorGradeCheck(checks, {
    id: 'planner_topic.low_information_topic',
    phase: 'planner',
    severity: 'minor',
    passed: !topicReasons.has('low_information_topic'),
    message: topicReasons.has('low_information_topic') ? 'Planner topic is low-information.' : undefined,
    score: topicReasons.has('low_information_topic') ? 50 : 100,
  });

  return checks;
}

function estimateScoreDelta(originalChecks: EditorGradeCheck[], title: PlannerSanitizedField, topic: PlannerSanitizedField): number {
  const originalScore = createEditorGradeResult({ checks: originalChecks }).score;
  const repairedTitle = sanitizeTitleValue(title.sanitized);
  const repairedTopic = sanitizeTopicValue({
    topic: topic.sanitized,
    contentType: 'post',
    peerTopics: [topic.sanitized],
  });
  const repairedScore = createEditorGradeResult({
    checks: buildChecks({}, repairedTitle, repairedTopic),
  }).score;
  return Math.max(0, repairedScore - originalScore);
}

export function sanitizePlannerTitle(input: PlannerTitleSanitizerInput): PlannerTitleSanitizerResult {
  const contentType = normalizeLogicalContentType(input.contentType, 'post');
  const originalTitle = clean(input.title);
  const originalTopic = clean(input.topic || input.title);
  const title = sanitizeTitleValue(originalTitle);
  const topic = sanitizeTopicValue({
    topic: originalTopic,
    contentType,
    peerTopics: input.peerTopics ?? [originalTopic],
  });
  const checks = buildChecks(input, title, topic);
  const result: PlannerTitleSanitizerResult = {
    original_title: title.original,
    sanitized_title: title.sanitized,
    title_repair_reason: title.repair_reason,
    original_topic: topic.original,
    sanitized_topic: topic.sanitized,
    topic_repair_reason: topic.repair_reason,
    score_delta: estimateScoreDelta(checks, title, topic),
    editor_grade_result: createEditorGradeResult({ checks }),
  };
  emitPlannerSanitizerTelemetry(input, result);
  return result;
}

export function emitPlannerSanitizerTelemetry(
  input: PlannerTitleSanitizerInput,
  result: PlannerTitleSanitizerResult,
): void {
  const titleChanged = normalizeKey(result.original_title) !== normalizeKey(result.sanitized_title);
  const topicChanged = normalizeKey(result.original_topic) !== normalizeKey(result.sanitized_topic);
  if (!titleChanged && !topicChanged && result.title_repair_reason.length === 0 && result.topic_repair_reason.length === 0) {
    return;
  }
  console.info('[planner-sanitizer][warn-mode]', {
    source: input.source ?? null,
    content_type: normalizeLogicalContentType(input.contentType, 'post'),
    platform: input.platform ?? null,
    original: {
      title: result.original_title,
      topic: result.original_topic,
    },
    suggested: {
      title: result.sanitized_title,
      topic: result.sanitized_topic,
    },
    score_delta: result.score_delta,
    repair_reason: uniqueReasons([
      ...result.title_repair_reason,
      ...result.topic_repair_reason,
    ]),
  });
}
