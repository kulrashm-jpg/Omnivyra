type Primitive = string | number | boolean | null | undefined;

export interface StrategicContentTransformationValidationInput {
  strategic_source: unknown;
  final_content: unknown;
}

export interface StrategicContentTransformationValidationResult {
  signal_preservation: {
    retention_score: number;
    missing_signals: string[];
  };
  insight_transfer: {
    insight_transfer_score: number;
    flattened_sections: string[];
  };
  depth_execution: {
    depth_execution_score: number;
    missing_layers: string[];
  };
  decision_content: {
    decision_score: number;
    fake_or_missing_blocks: string[];
  };
  generic_content: {
    generic_ratio: number;
    generic_sections: string[];
  };
}

interface ExtractedSignal {
  label: string;
  text: string;
  tokens: string[];
  keyPath: string;
  priority: number;
}

interface ContentSection {
  heading: string;
  text: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'being', 'but', 'by',
  'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is', 'it', 'its', 'of',
  'on', 'or', 'that', 'the', 'their', 'there', 'these', 'this', 'those', 'to', 'was',
  'were', 'will', 'with', 'you', 'your', 'they', 'them', 'we', 'our',
]);

const PRIORITY_KEYS: Record<string, number> = {
  campaign_angle: 5,
  messaging_hooks: 5,
  why_now: 5,
  gap_being_filled: 5,
  problem_being_solved: 5,
  desired_transformation: 5,
  expected_transformation: 5,
  authority_reason: 4,
  audience_personas: 4,
  pain_symptoms: 4,
  execution_stage: 3,
  stage_objective: 4,
  narrative_direction: 5,
  psychological_goal: 4,
  brand_voice: 3,
  reader_emotion_target: 3,
  recommended_cta_style: 3,
};

const GENERIC_PHRASES = [
  'in today',
  'in today s',
  'businesses need to',
  'it is important to',
  'the key is to',
  'best practices',
  'unlock growth',
  'drive results',
  'stay ahead',
  'game changer',
  'ever evolving',
  'take your strategy',
  'next level',
  'valuable insights',
  'industry leaders',
  'modern business',
  'success in the market',
];

const INSIGHT_KEYS = new Set([
  'campaign_angle',
  'why_now',
  'gap_being_filled',
  'problem_being_solved',
  'desired_transformation',
  'expected_transformation',
  'authority_reason',
  'narrative_direction',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_#>[\](){}|~^]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(token: string): string {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
  return token;
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map(singularize)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function titleCase(value: string): string {
  return value
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function primitiveToString(value: Primitive): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function shouldIgnoreKey(key: string): boolean {
  return /(^id$|_id$|^uuid$|created_at|updated_at|timestamp|date|slug|url|link|html|markdown|json|meta|status|score|count)/i.test(key);
}

function collectSignals(
  value: unknown,
  path: string[] = [],
  bucket: ExtractedSignal[] = [],
): ExtractedSignal[] {
  if (value == null) return bucket;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = primitiveToString(value);
    const key = path[path.length - 1] ?? 'signal';
    const tokens = tokenize(text);
    if (text.length >= 10 && tokens.length >= 2) {
      bucket.push({
        label: titleCase(key),
        text,
        tokens,
        keyPath: path.join('.'),
        priority: PRIORITY_KEYS[key] ?? 1,
      });
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectSignals(item, path, bucket);
    return bucket;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (shouldIgnoreKey(key)) continue;
      collectSignals(nested, [...path, key], bucket);
    }
  }

  return bucket;
}

function dedupeSignals(signals: ExtractedSignal[]): ExtractedSignal[] {
  const seen = new Map<string, ExtractedSignal>();
  for (const signal of signals.sort((a, b) => b.priority - a.priority || b.text.length - a.text.length)) {
    const id = `${signal.label}::${normalizeText(signal.text)}`;
    if (!seen.has(id)) seen.set(id, signal);
  }
  return Array.from(seen.values()).slice(0, 30);
}

function extractSections(finalContent: unknown): ContentSection[] {
  if (typeof finalContent === 'string') {
    const raw = finalContent.trim();
    if (!raw) return [];
    const chunks = raw
      .split(/\n\s*\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    return chunks.map((chunk, index) => {
      const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
      const first = lines[0] ?? '';
      const heading = first.length <= 80 && lines.length > 1 ? first.replace(/^#+\s*/, '') : `Section ${index + 1}`;
      const text = lines.length > 1 && heading === first.replace(/^#+\s*/, '') ? lines.slice(1).join(' ') : chunk;
      return { heading, text: text.trim() || chunk };
    });
  }

  if (Array.isArray(finalContent)) {
    return finalContent.flatMap((item, index) => extractSections(item).map((section) => ({
      heading: section.heading || `Section ${index + 1}`,
      text: section.text,
    })));
  }

  if (finalContent && typeof finalContent === 'object') {
    const record = finalContent as Record<string, unknown>;
    if (Array.isArray(record.sections)) {
      return record.sections.map((section, index) => {
        if (typeof section === 'string') {
          return { heading: `Section ${index + 1}`, text: section };
        }
        const data = (section ?? {}) as Record<string, unknown>;
        const heading = primitiveToString(data.heading as Primitive) || primitiveToString(data.title as Primitive) || `Section ${index + 1}`;
        const text = primitiveToString(data.content as Primitive) || primitiveToString(data.text as Primitive) || JSON.stringify(section);
        return { heading, text };
      });
    }

    const merged = [
      primitiveToString(record.title as Primitive),
      primitiveToString(record.summary as Primitive),
      primitiveToString(record.content as Primitive),
      primitiveToString(record.body as Primitive),
      primitiveToString(record.text as Primitive),
    ].filter(Boolean).join('\n\n');

    if (merged) return extractSections(merged);
  }

  return [];
}

function overlapScore(signalTokens: string[], contentTokens: string[]): number {
  if (signalTokens.length === 0 || contentTokens.length === 0) return 0;
  const contentSet = new Set(contentTokens);
  let matches = 0;
  for (const token of signalTokens) {
    if (contentSet.has(token)) matches += 1;
  }
  return matches / signalTokens.length;
}

function sectionGenericity(section: ContentSection, globalSignalTokens: Set<string>): number {
  const normalized = normalizeText(`${section.heading} ${section.text}`);
  const tokens = tokenize(normalized);
  if (tokens.length === 0) return 1;
  const genericHits = GENERIC_PHRASES.filter((phrase) => normalized.includes(phrase)).length;
  const signalHits = tokens.filter((token) => globalSignalTokens.has(token)).length;
  const signalDensity = signalHits / tokens.length;
  const lengthPenalty = tokens.length < 35 ? 0.2 : 0;
  return Math.max(0, Math.min(1, genericHits * 0.25 + (0.22 - signalDensity > 0 ? 0.45 : 0) + lengthPenalty));
}

function findBestSection(signal: ExtractedSignal, sections: ContentSection[]): { section: ContentSection | null; score: number } {
  let bestSection: ContentSection | null = null;
  let bestScore = 0;
  for (const section of sections) {
    const score = overlapScore(signal.tokens, tokenize(`${section.heading} ${section.text}`));
    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
    }
  }
  return { section: bestSection, score: bestScore };
}

function evaluateDepth(section: ContentSection): { mechanism: boolean; example: boolean; insight: boolean } {
  const text = normalizeText(`${section.heading} ${section.text}`);
  return {
    mechanism: /(because|works|work by|process|system|sequence|driver|caus|mechanism|operat|step)/.test(text),
    example: /(for example|for instance|example|case|scenario|consider|imagine|at [a-z0-9]+|when [a-z0-9]+)/.test(text),
    insight: /(this means|which means|therefore|however|the implication|why this matters|so what|insight|lesson|trade off|vs |versus)/.test(text),
  };
}

function evaluateDecisionSection(section: ContentSection, globalSignalTokens: Set<string>): { real: boolean; fake: boolean } {
  const text = normalizeText(`${section.heading} ${section.text}`);
  const hasComparison = /( vs |versus|compare|comparison|rather than|instead of|trade off|tradeoff|when to use|when not to use)/.test(text);
  const tokens = tokenize(text);
  const signalHits = tokens.filter((token) => globalSignalTokens.has(token)).length;
  const real = hasComparison && signalHits >= 3;
  const fake = /decision|comparison|trade off|tradeoff|versus|vs /.test(text) && !real;
  return { real, fake };
}

export function validateStrategicContentTransformation(
  input: StrategicContentTransformationValidationInput,
): StrategicContentTransformationValidationResult {
  const sections = extractSections(input.final_content);
  const signals = dedupeSignals(collectSignals(input.strategic_source));
  const sectionCount = sections.length || 1;
  const globalSignalTokens = new Set(signals.flatMap((signal) => signal.tokens));
  const contentTokens = tokenize(sections.map((section) => `${section.heading} ${section.text}`).join(' '));

  const preservedSignals = signals.filter((signal) => {
    const score = overlapScore(signal.tokens, contentTokens);
    return score >= 0.6 || normalizeText(sections.map((section) => section.text).join(' ')).includes(normalizeText(signal.text));
  });
  const missingSignals = signals
    .filter((signal) => !preservedSignals.includes(signal))
    .map((signal) => signal.label);

  const retentionScore = signals.length === 0
    ? 0
    : Math.round((preservedSignals.length / signals.length) * 100);

  const insightSignals = signals.filter((signal) => {
    const key = signal.keyPath.split('.').slice(-1)[0] ?? '';
    return INSIGHT_KEYS.has(key) || signal.priority >= 4;
  });

  const flattenedSections = Array.from(new Set(insightSignals.flatMap((signal) => {
    const best = findBestSection(signal, sections);
    if (!best.section) return [signal.label];
    const genericity = sectionGenericity(best.section, globalSignalTokens);
    if (best.score < 0.75 || genericity >= 0.45) return [`${best.section.heading}`];
    return [];
  })));

  const robustInsights = insightSignals.filter((signal) => {
    const best = findBestSection(signal, sections);
    if (!best.section) return false;
    return best.score >= 0.75 && sectionGenericity(best.section, globalSignalTokens) < 0.45;
  });

  const insightTransferScore = insightSignals.length === 0
    ? 0
    : Math.round((robustInsights.length / insightSignals.length) * 100);

  const significantSections = sections.filter((section) => tokenize(section.text).length >= 18);
  const depthTargetSections = significantSections.length > 0 ? significantSections : sections;
  const missingLayers = depthTargetSections.flatMap((section) => {
    const depth = evaluateDepth(section);
    const missing = [
      !depth.mechanism ? 'mechanism' : '',
      !depth.example ? 'example' : '',
      !depth.insight ? 'insight' : '',
    ].filter(Boolean);
    return missing.length > 0 ? [`${section.heading}: ${missing.join(', ')}`] : [];
  });

  const totalDepthChecks = depthTargetSections.length * 3 || 1;
  const missingDepthChecks = missingLayers.reduce((sum, item) => sum + item.split(': ')[1].split(',').length, 0);
  const depthExecutionScore = Math.max(0, Math.round(((totalDepthChecks - missingDepthChecks) / totalDepthChecks) * 100));

  const decisionEvaluations = sections.map((section) => ({
    section,
    result: evaluateDecisionSection(section, globalSignalTokens),
  }));
  const realDecisionBlocks = decisionEvaluations.filter((item) => item.result.real);
  const fakeOrMissingBlocks = decisionEvaluations
    .filter((item) => item.result.fake)
    .map((item) => item.section.heading);
  if (realDecisionBlocks.length === 0) fakeOrMissingBlocks.unshift('No real comparison or trade-off block found');
  const decisionScore = realDecisionBlocks.length === 0
    ? 0
    : Math.min(100, Math.round((realDecisionBlocks.length / Math.max(1, Math.ceil(sectionCount / 4))) * 100));

  const genericSections = sections
    .filter((section) => sectionGenericity(section, globalSignalTokens) >= 0.45)
    .map((section) => section.heading);
  const genericRatio = Math.round((genericSections.length / sectionCount) * 100);

  return {
    signal_preservation: {
      retention_score: retentionScore,
      missing_signals: missingSignals,
    },
    insight_transfer: {
      insight_transfer_score: insightTransferScore,
      flattened_sections: flattenedSections,
    },
    depth_execution: {
      depth_execution_score: depthExecutionScore,
      missing_layers: missingLayers,
    },
    decision_content: {
      decision_score: decisionScore,
      fake_or_missing_blocks: Array.from(new Set(fakeOrMissingBlocks)),
    },
    generic_content: {
      generic_ratio: genericRatio,
      generic_sections: genericSections,
    },
  };
}
