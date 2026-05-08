// Production query orchestrator.
//
// Owns the canonical query set for a brand. Same brand context produces the
// same queries every run — that's how snapshots remain comparable across time.

import type { AIQueryClass, AIProviderId } from './providerInterfaces';

export type BrandQueryContext = {
  brandName: string | null;
  domain: string | null;
  category: string | null;
  competitors: string[];
  productServices: string[];
  geography: string | null;
};

export type CanonicalQuery = {
  /** Deterministic id derived from brand context — stable across runs. */
  id: string;
  text: string;
  query_class: AIQueryClass;
};

const BRAND_QUERY_TEMPLATES = [
  'What is {brand}?',
  'Tell me about {brand}.',
  'Who founded {brand}?',
  'Is {brand} legitimate?',
] as const;

const CATEGORY_QUERY_TEMPLATES = [
  'What are the best {category} solutions in 2026?',
  'Top {category} companies.',
  'How do I choose a {category} provider?',
  'Recommended {category} platforms.',
] as const;

const COMPETITIVE_QUERY_TEMPLATES = [
  'Compare {brand} vs {competitor}.',
  'How does {brand} differ from {competitor}?',
  'Is {brand} or {competitor} better for {category}?',
] as const;

const EXPERTISE_QUERY_TEMPLATES = [
  'What expertise does {brand} bring to {service}?',
  'How experienced is {brand} in {service}?',
  'What are {brand}\'s strengths in {service}?',
] as const;

const LONG_TAIL_TEMPLATES = [
  'Who can help me with {service} in {geography}?',
  'Best {service} provider for a {category} business.',
] as const;

function hashId(input: string): string {
  // Lightweight deterministic hash — stable across runs of the same string.
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function fill(template: string, vars: Record<string, string>): string | null {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    if (!value) return null;
    out = out.replaceAll(`{${key}}`, value);
  }
  return /\{[a-z_]+\}/.test(out) ? null : normalize(out);
}

/**
 * Build the canonical query set for a brand. Deterministic — same input =
 * same output every time. Enables historical comparability without storing
 * the queries themselves.
 */
export function buildCanonicalQuerySet(ctx: BrandQueryContext): CanonicalQuery[] {
  const queries: CanonicalQuery[] = [];
  const seen = new Set<string>();

  const push = (text: string | null, queryClass: AIQueryClass) => {
    if (!text) return;
    const normalized = normalize(text);
    const dedupeKey = `${queryClass}:${normalized.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    queries.push({
      id: hashId(dedupeKey),
      text: normalized,
      query_class: queryClass,
    });
  };

  if (ctx.brandName) {
    for (const template of BRAND_QUERY_TEMPLATES) {
      push(fill(template, { brand: ctx.brandName }), 'branded');
    }
  }

  if (ctx.category) {
    for (const template of CATEGORY_QUERY_TEMPLATES) {
      push(fill(template, { category: ctx.category }), 'category');
    }
  }

  if (ctx.brandName && ctx.competitors.length > 0) {
    for (const competitor of ctx.competitors.slice(0, 4)) {
      for (const template of COMPETITIVE_QUERY_TEMPLATES) {
        push(
          fill(template, {
            brand: ctx.brandName,
            competitor,
            category: ctx.category ?? 'this category',
          }),
          'competitive',
        );
      }
    }
  }

  if (ctx.brandName && ctx.productServices.length > 0) {
    for (const service of ctx.productServices.slice(0, 4)) {
      for (const template of EXPERTISE_QUERY_TEMPLATES) {
        push(fill(template, { brand: ctx.brandName, service }), 'expertise');
      }
    }
  }

  // Long-tail conversational queries fold into the most-relevant existing class.
  if (ctx.productServices.length > 0 && ctx.geography) {
    for (const service of ctx.productServices.slice(0, 2)) {
      for (const template of LONG_TAIL_TEMPLATES) {
        push(
          fill(template, {
            service,
            geography: ctx.geography,
            category: ctx.category ?? 'general',
          }),
          'expertise',
        );
      }
    }
  }

  return queries;
}

export function groupQueriesByClass(
  queries: CanonicalQuery[],
): Partial<Record<AIQueryClass, string[]>> {
  const groups: Partial<Record<AIQueryClass, string[]>> = {};
  for (const q of queries) {
    if (!groups[q.query_class]) groups[q.query_class] = [];
    groups[q.query_class]!.push(q.text);
  }
  return groups;
}

/**
 * Provider-specific query formatting. Some providers prefer system prompts,
 * some prefer single-turn user messages. Each adapter calls this to get a
 * provider-shaped query payload from the canonical text.
 */
export function formatQueryForProvider(query: string, provider: AIProviderId): {
  system: string | null;
  user: string;
} {
  const systemBase =
    'Answer the question accurately. If you cite a brand, name it explicitly. If you do not know, say so.';
  if (provider === 'perplexity') {
    return { system: null, user: query };
  }
  return { system: systemBase, user: query };
}
