import type { ResolvedReportInput } from '../reportInputResolver';
import type { CompanyNarrativeContext, NarrativeContext } from './types';

export function createNarrativeContext(): NarrativeContext {
  return {
    usedSignals: new Set<string>(),
    usedTemplateIds: new Set<string>(),
  };
}

export function splitCandidates(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitCandidates(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    const candidates = splitCandidates(value);
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

export function extractCompanyNarrativeContext(params: {
  resolvedInput?: ResolvedReportInput | null;
}): CompanyNarrativeContext {
  const profile = params.resolvedInput?.profile;
  const companyName = firstNonEmpty(params.resolvedInput?.resolved.companyName, profile?.name) || null;
  const domain = firstNonEmpty(params.resolvedInput?.resolved.websiteDomain, profile?.website_url)
    ?.replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase() || null;
  const positioning = firstNonEmpty(profile?.brand_positioning, profile?.competitive_advantages);
  const tagline = firstNonEmpty(profile?.unique_value);
  const homepageHeadline = firstNonEmpty(profile?.key_messages, profile?.campaign_focus);
  const primaryOffering = firstNonEmpty(profile?.products_services, profile?.products_services_list);
  const businessType = firstNonEmpty(params.resolvedInput?.resolved.businessType, profile?.category, profile?.industry);
  const geography = firstNonEmpty(params.resolvedInput?.resolved.geography, profile?.geography);
  const marketFocus = firstNonEmpty(
    params.resolvedInput?.resolved.companyContext.marketFocus,
    businessType,
    geography,
  );
  const productServices = splitCandidates(
    params.resolvedInput?.resolved.companyContext.productServices.length
      ? params.resolvedInput?.resolved.companyContext.productServices
      : [profile?.products_services, profile?.products_services_list],
  );
  const marketContext = businessType && geography
    ? `${businessType} in ${geography}`
    : businessType || geography || null;
  return {
    companyName,
    domain,
    homepageHeadline,
    tagline,
    primaryOffering,
    positioning,
    marketContext,
    marketFocus,
    productServices,
    geography,
  };
}

export function normalizePageLabel(value: string | null | undefined): string {
  const lower = String(value ?? '').toLowerCase();
  if (!lower) return '';
  if (/(^|\/)pricing/.test(lower)) return 'pricing';
  if (/(^|\/)(faq|faqs)/.test(lower)) return 'FAQ';
  if (/(^|\/)blog/.test(lower)) return 'blog';
  if (/(compare|comparison|\/vs\/|versus|alternative)/.test(lower)) return 'comparison';
  if (/(product|feature|solution)/.test(lower)) return 'product';
  if (/(home|homepage)/.test(lower)) return 'homepage';
  return '';
}

export function recommendationTimeline(effortLevel: 'low' | 'medium' | 'high', confidence: number): {
  short: string;
  mid: string;
  long: string;
} {
  const confidenceLabel = confidence >= 70 ? 'with measurable' : confidence >= 45 ? 'with directional' : 'with early';
  if (effortLevel === 'low') {
    return {
      short: `2-4 weeks: ${confidenceLabel} movement should appear on the target pages first.`,
      mid: '1-3 months: stronger click quality and page-level engagement should become visible.',
      long: '3-6 months: the change should compound into better qualified discovery and conversion readiness.',
    };
  }
  if (effortLevel === 'high') {
    return {
      short: '2-4 weeks: implementation signals should appear after the first page set is shipped.',
      mid: '1-3 months: coverage and trust signals should begin lifting the target cluster.',
      long: '3-6 months: the full content and authority program should translate into stronger market capture.',
    };
  }
  return {
    short: '2-4 weeks: initial signal improvement should appear on the first upgraded pages.',
    mid: '1-3 months: stronger visibility, trust, and engagement should show across the target cluster.',
    long: '3-6 months: sustained execution should improve qualified traffic and conversion progression.',
  };
}

export function confidencePercent(decision: { confidence_score?: number | null }): number {
  return Math.round(Number(decision.confidence_score ?? 0) * 100);
}

export function personalizeEntityReferences(text: string, context?: CompanyNarrativeContext): string {
  if (!text || !context) return text;
  let next = text;
  if (context.companyName) {
    next = next.replace(/\bthe business\b/gi, context.companyName);
    next = next.replace(/\bthe brand\b/gi, context.companyName);
  }
  if (context.domain) {
    next = next.replace(/\bthe site\b/gi, context.domain);
    next = next.replace(/\byour site\b/gi, context.domain);
  }
  return next.replace(/\s+/g, ' ').trim();
}
