import type { ResolvedReportInput } from '../reportInputResolver';
import type { CompanyNarrativeContext, NarrativeContext } from './types';
import { isNonSpecificTaxonomyLabel } from '../companyContextTaxonomy';

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

/**
 * Like `firstNonEmpty`, but skips terminal taxonomy buckets and placeholders.
 *
 * `report_settings.default_inputs` persists the classifier's fallback ("Other") for
 * business_type/geography, and that value OUTRANKED the real profile columns here -- so a
 * richly populated profile still rendered "for Other in Other". Falling through to the profile
 * is the fix; returning null (and abstaining) is correct when nothing meaningful exists.
 */
export function firstMeaningful(...values: Array<unknown>): string | null {
  for (const value of values) {
    for (const candidate of splitCandidates(value)) {
      if (!isNonSpecificTaxonomyLabel(candidate)) return candidate;
    }
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
  const extended = profile as {
    category_list?: unknown; industry_list?: unknown; geography_list?: unknown;
    competitors_list?: unknown; competitors?: unknown;
  } | null | undefined;
  const businessType = firstMeaningful(
    params.resolvedInput?.resolved.businessType,
    profile?.category,
    profile?.industry,
    extended?.category_list,
    extended?.industry_list,
  );
  const geography = firstMeaningful(
    params.resolvedInput?.resolved.geography,
    profile?.geography,
    extended?.geography_list,
  );
  // Company-DECLARED competitors. These are profile context, never public observations: they are
  // deliberately kept out of `detected_competitors`, which is populated only by public discovery.
  const declaredCompetitors = Array.from(new Set([
    ...splitCandidates(params.resolvedInput?.resolved.competitors),
    ...splitCandidates(extended?.competitors_list),
    ...splitCandidates(extended?.competitors),
  ].filter((name) => !isNonSpecificTaxonomyLabel(name))));
  // G4A: `resolved.companyContext` is typed non-optional but is absent at runtime on some resolver
  // paths, so the plain chain threw before any external dependency was reached. Guarded with the
  // same `?.` style the sibling consumer already uses
  // (competitorEngineServiceEngineDiscovery.ts:555 reads `context?.productServices?.[0]`).
  // Behaviour is unchanged whenever `companyContext` exists: an absent field already fell through
  // to the next `firstNonEmpty` candidate, and an absent array already fell through to the profile.
  const marketFocus = firstMeaningful(
    params.resolvedInput?.resolved.companyContext?.marketFocus,
    businessType,
    geography,
  );
  const productServices = splitCandidates(
    params.resolvedInput?.resolved.companyContext?.productServices?.length
      ? params.resolvedInput?.resolved.companyContext?.productServices
      : [profile?.products_services, profile?.products_services_list],
  );
  const marketContext = businessType && geography
    ? `${businessType} in ${geography}`
    : businessType || geography || null;
  const logoUrl = firstNonEmpty(
    (profile as { logo_url?: string | null } | null | undefined)?.logo_url,
    (profile as { brand_logo_url?: string | null } | null | undefined)?.brand_logo_url,
    (profile as { company_logo_url?: string | null } | null | undefined)?.company_logo_url,
  );
  const faviconUrl = firstNonEmpty(
    (profile as { favicon_url?: string | null } | null | undefined)?.favicon_url,
  );
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
    logoUrl,
    faviconUrl,
    declaredCompetitors,
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
