import type { PersistedDecisionObject } from './decisionObjectService';

export function nowIso(): string {
  return new Date().toISOString();
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function averageNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const NARRATIVE_INTENT = {
  unified: 'overall_market_direction',
  competitor: 'why_competitor_wins',
  opportunity: 'why_gap_exists',
} as const;

const SIGNAL_BUCKETS = {
  unified: ['authority_gap', 'visibility_loss', 'content_coverage'],
  competitor: ['authority_comparison', 'content_depth', 'positioning'],
  opportunity: ['keyword_gap', 'missing_pages', 'intent_mismatch'],
} as const;

type NarrativeSection = keyof typeof NARRATIVE_INTENT;
type NarrativeSignal = {
  key: string;
  text: string;
};
type NarrativeContext = {
  usedSignals: Set<string>;
  usedTemplateIds: Set<string>;
};

export function createNarrativeContext(): NarrativeContext {
  return {
    usedSignals: new Set<string>(),
    usedTemplateIds: new Set<string>(),
  };
}

const UNIFIED_TEMPLATES = [
  'You are currently {impact} due to {primary_signal}, with additional pressure from {secondary_signal}.',
  '{primary_signal} is driving your current performance, further affected by {secondary_signal}.',
  'Your visibility is being shaped by {primary_signal}, with noticeable influence from {secondary_signal}.',
] as const;

const COMPETITOR_TEMPLATES = [
  '{competitor} is ahead due to stronger {primary_signal}, particularly in {specific_area}.',
  '{competitor} maintains an advantage through better {primary_signal}, especially across {specific_area}.',
  '{competitor} outperforms by leading in {primary_signal}, with clear strength in {specific_area}.',
] as const;

const OPPORTUNITY_TEMPLATES = [
  'This gap exists because {primary_signal}, limiting your ability to capture {intent_type} traffic.',
  '{primary_signal} is creating this gap, reducing your visibility for {intent_type} queries.',
  'The absence of {primary_signal} is restricting your ability to capture {intent_type} demand.',
] as const;

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function pickTemplate(params: {
  section: NarrativeSection;
  templates: readonly string[];
  context: NarrativeContext;
  seed: string;
}): string {
  if (params.templates.length === 0) return '';
  const startIndex = hashString(params.seed) % params.templates.length;
  for (let offset = 0; offset < params.templates.length; offset += 1) {
    const idx = (startIndex + offset) % params.templates.length;
    const templateId = `${params.section}:${idx}`;
    if (params.context.usedTemplateIds.has(templateId)) continue;
    params.context.usedTemplateIds.add(templateId);
    return params.templates[idx];
  }
  return params.templates[startIndex];
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function compactNarrative(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  const trimmedSecondary = normalized.replace(/,\s*(with|further|especially).*?\.$/i, '.');
  return trimmedSecondary || normalized;
}

export function dedupeSentences(text: string): string {
  const fragments = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const fragment of fragments) {
    const key = fragment.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(fragment);
  }
  return unique.join(' ');
}

export function clampNarrativeLength(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  if (normalized.length <= maxChars) return normalized;

  const sentences = normalized
    .split(/[.!?]+\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/[.!?]$/.test(item) ? item : `${item}.`));

  const selected: string[] = [];
  for (const sentence of sentences) {
    const candidate = [...selected, sentence].join(' ').trim();
    if (candidate.length > maxChars && selected.length > 0) break;
    if (candidate.length > maxChars && selected.length === 0) {
      selected.push(sentence);
      break;
    }
    selected.push(sentence);
  }

  return selected.join(' ').trim();
}

export function hasConcreteSignal(text: string): boolean {
  const measurablePattern = /(\d+\/100|\d+\s*point|\d+%|score|gap|coverage|missing|authority|visibility|pages|intent)/i;
  return measurablePattern.test(text);
}

export function validateNarrative(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    text.length < 200 &&
    !normalized.includes('improve seo') &&
    !normalized.includes('optimize') &&
    !normalized.includes('enhance performance') &&
    hasConcreteSignal(text)
  );
}

export function getTone(severity: 'critical' | 'moderate' | 'low'): 'strong' | 'balanced' | 'positive' {
  if (severity === 'critical') return 'strong';
  if (severity === 'moderate') return 'balanced';
  return 'positive';
}

export function toneImpactWord(tone: 'strong' | 'balanced' | 'positive'): string {
  if (tone === 'strong') return 'losing visibility and falling behind';
  if (tone === 'balanced') return 'experiencing gaps';
  return 'seeing room to improve';
}

export function pickNarrativeSignals(params: {
  section: NarrativeSection;
  candidates: NarrativeSignal[];
  context: NarrativeContext;
}): { primary: NarrativeSignal | null; secondary: NarrativeSignal | null } {
  const intent = NARRATIVE_INTENT[params.section];
  const maxSignals = intent ? 2 : 2;
  const preferredKeys = SIGNAL_BUCKETS[params.section];
  const byKey = new Map(params.candidates.map((signal) => [signal.key, signal]));
  const picked: NarrativeSignal[] = [];

  for (const key of preferredKeys) {
    if (picked.length >= maxSignals) break;
    const signal = byKey.get(key);
    if (!signal) continue;
    if (params.context.usedSignals.has(signal.key)) continue;
    picked.push(signal);
  }

  if (picked.length === 0) {
    for (const signal of params.candidates) {
      if (params.context.usedSignals.has(signal.key)) continue;
      picked.push(signal);
      break;
    }
  }

  if (picked.length === 1) {
    for (const signal of params.candidates) {
      if (picked[0]?.key === signal.key) continue;
      if (params.context.usedSignals.has(signal.key)) continue;
      picked.push(signal);
      break;
    }
  }

  if (picked[0]) params.context.usedSignals.add(picked[0].key);
  if (picked[1]) params.context.usedSignals.add(picked[1].key);

  return {
    primary: picked[0] ?? null,
    secondary: picked[1] ?? null,
  };
}

export function inferDataSourceStrength(params: {
  available: boolean;
  sourceTags: string[] | null;
  confidence: 'high' | 'medium' | 'low';
  inferred?: boolean;
}): 'strong' | 'inferred' | 'weak' | 'missing' {
  if (!params.available) return 'missing';
  if (params.inferred) return 'inferred';
  if ((params.sourceTags?.includes('GSC') || params.sourceTags?.includes('crawler')) && params.confidence === 'high') {
    return 'strong';
  }
  if (params.confidence === 'low') return 'weak';
  return 'inferred';
}

export function createNarrativeTemplateSets() {
  return {
    unified: UNIFIED_TEMPLATES,
    competitor: COMPETITOR_TEMPLATES,
    opportunity: OPPORTUNITY_TEMPLATES,
  } as const;
}
