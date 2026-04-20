/**
 * Shared generation pipeline utilities used by all newsletter format generators.
 *
 * These helpers remove the boilerplate around:
 *   - resolving targetWords from input
 *   - resolving a named template
 *   - building the standard success/fallback return value
 *   - applying SEO fallbacks to a parsed result
 *   - running a best-of-N attempt loop with optional repair passes
 */
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';
import {
  instantiateNewsletterTemplate,
  getDefaultNewsletterTemplates,
} from '../defaultNewsletterTemplates';
import type { NewsletterGenerationRequest, NewsletterGenerationResult } from '../runNewsletterGeneration';
import type { ContentBlock } from '../../content/blockTypes';
import { stripHtml } from './blockHelpers';
import { enhanceNewsletterSystemPrompt } from './promptHelpers';
import type { CompanyContext } from '../../blog/blogRunnerTypes';
import { getProfile } from '../../../backend/services/companyProfileService';
import { extractStrategyProfile } from '../../content/companyStrategyPerspective';

// ── Newsletter company context cache (5-min TTL) ────────────────────────────
// Auto-fetches company profile so all newsletter AI calls get enforcement
// even when callers don't explicitly pass companyContext.
const _nlContextCache = new Map<string, { ctx: CompanyContext | undefined; at: number }>();

async function resolveNewsletterCompanyContext(companyId: string | undefined): Promise<CompanyContext | undefined> {
  if (!companyId) return undefined;
  const cached = _nlContextCache.get(companyId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.ctx;
  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) { _nlContextCache.set(companyId, { ctx: undefined, at: Date.now() }); return undefined; }
    const ctx: CompanyContext = {
      companyName: profile.name || undefined,
      industry: profile.industry || undefined,
      audience: profile.target_audience || undefined,
      brand_voice: profile.brand_voice || undefined,
      uniqueValue: profile.unique_value || undefined,
      coreProblemStatement: profile.core_problem_statement || undefined,
      painSymptoms: profile.pain_symptoms?.filter(Boolean) || undefined,
      authorityDomains: profile.authority_domains?.filter(Boolean) || undefined,
      productsServices: profile.products_services || undefined,
      desiredTransformation: profile.desired_transformation || undefined,
      strategyProfile: extractStrategyProfile(profile),
    };
    _nlContextCache.set(companyId, { ctx, at: Date.now() });
    return ctx;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Target-word resolution
// ---------------------------------------------------------------------------

export function resolveTargetWords(input: NewsletterGenerationRequest, defaultWords = 1200): number {
  const raw = input.answers?.target_word_count;
  return raw ? parseInt(String(raw), 10) || defaultWords : defaultWords;
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export function resolveTemplate(input: NewsletterGenerationRequest, templateName: string, targetWords: number): ContentBlock[] {
  if (Array.isArray(input.template_blocks) && input.template_blocks.length > 0) {
    return input.template_blocks as ContentBlock[];
  }
  const template = getDefaultNewsletterTemplates().find(
    (item) => item.name.toLowerCase() === templateName.toLowerCase(),
  );
  return template ? instantiateNewsletterTemplate(template, targetWords) : [];
}

// ---------------------------------------------------------------------------
// Parsed result shape
// ---------------------------------------------------------------------------

export interface ParsedResult {
  title: string;
  excerpt: string;
  content_html: string;
  tags: string[];
  category: string;
  seo_meta_title: string;
  seo_meta_description: string;
  key_insights: never[];
  content_blocks: ContentBlock[];
}

export function buildParsedResult(raw: any, contentBlocks: ContentBlock[]): ParsedResult {
  return {
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : '',
    content_html: '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag: unknown) => typeof tag === 'string') : [],
    category: typeof raw.category === 'string' ? raw.category : '',
    seo_meta_title: typeof raw.seo_meta_title === 'string' ? raw.seo_meta_title : '',
    seo_meta_description: typeof raw.seo_meta_description === 'string' ? raw.seo_meta_description : '',
    key_insights: [],
    content_blocks: contentBlocks,
  };
}

// ---------------------------------------------------------------------------
// SEO fallback patch
// ---------------------------------------------------------------------------

export interface SeoFallbackOptions {
  formatLabel: string;
  fallbackSources?: (string | undefined)[];
}

export function applySeoFallbacks(
  parsed: ParsedResult,
  options: SeoFallbackOptions,
): ParsedResult {
  const sources = options.fallbackSources ?? [];
  const fallback = sources.find((v) => typeof v === 'string' && v.trim().length > 0) ?? parsed.title;
  const cleanFallback = stripHtml(fallback).slice(0, 155).trim();

  if (parsed.title.trim().length > 0 && parsed.title.trim().length < 20) {
    parsed.title = `${parsed.title.trim()}: ${options.formatLabel}`;
  }
  if (!parsed.seo_meta_title || !parsed.seo_meta_title.trim()) {
    parsed.seo_meta_title = parsed.title.trim();
  }
  if (!parsed.excerpt || parsed.excerpt.trim().length < 70) {
    parsed.excerpt = cleanFallback;
  }
  if (!parsed.seo_meta_description || parsed.seo_meta_description.trim().length < 70) {
    parsed.seo_meta_description = cleanFallback;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Standard return builders
// ---------------------------------------------------------------------------

export function buildSuccessResult(parsed: ParsedResult, note: string): NewsletterGenerationResult {
  return {
    needs_clarification: false,
    mode: 'full',
    confidence: 'high',
    template_used: true,
    hook_assessment: { strength: 'moderate', note },
    result: parsed,
  };
}

export function buildFallbackResult(parsed: ParsedResult, note: string): NewsletterGenerationResult {
  return {
    needs_clarification: false,
    mode: 'full',
    confidence: 'medium',
    template_used: true,
    hook_assessment: { strength: 'moderate', note },
    result: parsed,
  };
}

// ---------------------------------------------------------------------------
// AI call helpers
// ---------------------------------------------------------------------------

export interface AiCallOptions {
  operation: 'newsletterGeneration';
  companyId: string | undefined;
  cacheVersion: string;
  model?: string;
  temperature?: number;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  /** When provided, system prompt is auto-enhanced with identity lock + anti-generic rules. */
  companyContext?: CompanyContext;
}

export async function callAI(opts: AiCallOptions): Promise<any | null> {
  // Auto-enhance system prompt with identity lock + anti-generic rules.
  // If caller provided companyContext, use it. Otherwise auto-fetch from DB.
  const companyCtx = opts.companyContext
    ?? await resolveNewsletterCompanyContext(opts.companyId);
  const effectiveSystemPrompt = companyCtx
    ? enhanceNewsletterSystemPrompt(opts.systemPrompt, companyCtx)
    : opts.systemPrompt;

  const completion = await runCompletionWithOperation({
    operation: opts.operation,
    companyId: opts.companyId,
    cache_version: opts.cacheVersion,
    model: opts.model ?? 'gpt-4o',
    temperature: opts.temperature ?? 0.25,
    response_format: { type: 'json_object' },
    max_tokens: opts.maxTokens,
    messages: [
      { role: 'system', content: effectiveSystemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
  });
  if (!completion.output) return null;
  try {
    return JSON.parse(completion.output);
  } catch {
    return null;
  }
}

/** Run a repair pass and return the raw JSON, swallowing errors (best-effort). */
export async function callRepairAI(opts: AiCallOptions): Promise<any | null> {
  try {
    return await callAI(opts);
  } catch {
    return null;
  }
}

/**
 * Enhance a system prompt with identity lock + anti-generic rules for a newsletter.
 * Use this in generators that call runCompletionWithOperation directly (not via callAI).
 *
 * Usage:
 *   const systemPrompt = await enhanceSystemPromptForNewsletter(
 *     'You are a market map strategist...',
 *     input.company_id,
 *     input.companyContext,
 *   );
 */
export async function enhanceSystemPromptForNewsletter(
  basePrompt: string,
  companyId: string | undefined,
  companyContext?: CompanyContext,
): Promise<string> {
  const ctx = companyContext ?? await resolveNewsletterCompanyContext(companyId);
  if (!ctx) return basePrompt;
  return enhanceNewsletterSystemPrompt(basePrompt, ctx);
}
