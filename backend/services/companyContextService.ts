/**
 * Canonical Company Context Layer.
 * Single deterministic context used across recommendation, campaign, and content flows.
 * Builds on existing context builders. No refactor of existing pipelines.
 */

import type { CompanyProfile } from './companyProfileService';

export type CompanyContextIdentity = {
  name?: string | null;
  industry?: string | null;
  industry_list?: string[] | null;
  category?: string | null;
  category_list?: string[] | null;
  geography?: string | null;
  geography_list?: string[] | null;
};

export type CompanyContextBrand = {
  brand_voice?: string | null;
  brand_positioning?: string | null;
  unique_value?: string | null;
  key_messages?: string | null;
  competitive_advantages?: string | null;
};

export type CompanyContextCustomer = {
  target_audience?: string | null;
  ideal_customer_profile?: string | null;
  target_customer_segment?: string | null;
};

export type CompanyContextProblemTransformation = {
  core_problem_statement?: string | null;
  pain_symptoms?: string[] | null;
  awareness_gap?: string | null;
  problem_impact?: string | null;
  life_with_problem?: string | null;
  life_after_solution?: string | null;
  desired_transformation?: string | null;
  transformation_mechanism?: string | null;
  authority_domains?: string[] | null;
};

export type CompanyContextCampaign = {
  campaign_focus?: string | null;
  content_themes?: string | null;
  growth_priorities?: string | null;
  goals?: string | null;
  campaign_purpose_intent?: CompanyProfile['campaign_purpose_intent'];
  /** Target emotional state we want the reader to feel (from profile.campaign_purpose_intent). */
  reader_emotion_target?: string | null;
  /** Narrative progression seed for weekly planning (from profile.campaign_purpose_intent). */
  narrative_flow_seed?: NonNullable<CompanyProfile['campaign_purpose_intent']>['narrative_flow_seed'];
  /** Recommended CTA style aligned to campaign type (from profile.campaign_purpose_intent or derived). */
  recommended_cta_style?: string | null;
};

export type CompanyContextCommercial = {
  pricing_model?: string | null;
  sales_motion?: string | null;
  avg_deal_size?: string | null;
  sales_cycle?: string | null;
  key_metrics?: string | null;
};

export type CompanyContext = {
  identity: CompanyContextIdentity;
  brand: CompanyContextBrand;
  customer: CompanyContextCustomer;
  problem_transformation: CompanyContextProblemTransformation;
  campaign: CompanyContextCampaign;
  commercial: CompanyContextCommercial;
};

export type BuildCompanyContextOptions = {
  /** Include empty sections (default: true). Set false to omit empty sections. */
  includeEmpty?: boolean;
};

export function buildCompanyContext(
  profile: CompanyProfile | null,
  options?: BuildCompanyContextOptions
): CompanyContext {
  const includeEmpty = options?.includeEmpty !== false;
  const cpi = (profile?.campaign_purpose_intent ?? null) as
    | (NonNullable<CompanyProfile['campaign_purpose_intent']> & Record<string, unknown>)
    | null;

  const coerceNonEmptyString = (value: unknown): string | null => {
    if (value == null) return null;
    const s = typeof value === 'string' ? value : String(value);
    const t = s.trim();
    return t ? t : null;
  };

  const hasMeaningfulNarrativeSeed = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value !== 'object') return false;
    const pattern = coerceNonEmptyString((value as any)?.pattern);
    const steps = Array.isArray((value as any)?.steps)
      ? (value as any).steps.map((s: any) => String(s ?? '').trim()).filter(Boolean)
      : [];
    return !!pattern || steps.length > 0;
  };

  const deriveRecommendedCtaStyle = (): string | null => {
    const raw = [
      coerceNonEmptyString((cpi as any)?.primary_objective),
      coerceNonEmptyString((cpi as any)?.campaign_intent),
      coerceNonEmptyString((cpi as any)?.monetization_intent),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!raw) return null;
    if (raw.includes('lead') || raw.includes('conversion') || raw.includes('book') || raw.includes('demo') || raw.includes('sign up') || raw.includes('download')) {
      return 'Direct';
    }
    if (raw.includes('awareness') || raw.includes('brand')) return 'Soft';
    if (raw.includes('authority') || raw.includes('thought leadership') || raw.includes('credibility')) return 'Light';
    if (raw.includes('engagement') || raw.includes('network') || raw.includes('community') || raw.includes('connect')) return 'Engagement';
    if (raw.includes('product') || raw.includes('promotion') || raw.includes('launch')) return 'Direct promotional push';
    return null;
  };

  const identity: CompanyContextIdentity = {
    name: includeEmpty || profile?.name ? (profile?.name ?? null) : undefined,
    industry: includeEmpty || profile?.industry ? (profile?.industry ?? null) : undefined,
    industry_list: includeEmpty || (profile?.industry_list?.length ?? 0) > 0
      ? (profile?.industry_list ?? null)
      : undefined,
    category: includeEmpty || profile?.category ? (profile?.category ?? null) : undefined,
    category_list: includeEmpty || (profile?.category_list?.length ?? 0) > 0
      ? (profile?.category_list ?? null)
      : undefined,
    geography: includeEmpty || profile?.geography ? (profile?.geography ?? null) : undefined,
    geography_list: includeEmpty || (profile?.geography_list?.length ?? 0) > 0
      ? (profile?.geography_list ?? null)
      : undefined,
  };

  const brand: CompanyContextBrand = {
    brand_voice: includeEmpty || profile?.brand_voice ? (profile?.brand_voice ?? null) : undefined,
    brand_positioning: includeEmpty || profile?.brand_positioning ? (profile?.brand_positioning ?? null) : undefined,
    unique_value: includeEmpty || profile?.unique_value ? (profile?.unique_value ?? null) : undefined,
    key_messages: includeEmpty || profile?.key_messages ? (profile?.key_messages ?? null) : undefined,
    competitive_advantages: includeEmpty || profile?.competitive_advantages ? (profile?.competitive_advantages ?? null) : undefined,
  };

  const customer: CompanyContextCustomer = {
    target_audience: includeEmpty || profile?.target_audience ? (profile?.target_audience ?? null) : undefined,
    ideal_customer_profile: includeEmpty || profile?.ideal_customer_profile ? (profile?.ideal_customer_profile ?? null) : undefined,
    target_customer_segment: includeEmpty || profile?.target_customer_segment ? (profile?.target_customer_segment ?? null) : undefined,
  };

  const problem_transformation: CompanyContextProblemTransformation = {
    core_problem_statement: includeEmpty || profile?.core_problem_statement ? (profile?.core_problem_statement ?? null) : undefined,
    pain_symptoms: includeEmpty || (profile?.pain_symptoms?.length ?? 0) > 0 ? (profile?.pain_symptoms ?? null) : undefined,
    awareness_gap: includeEmpty || profile?.awareness_gap ? (profile?.awareness_gap ?? null) : undefined,
    problem_impact: includeEmpty || profile?.problem_impact ? (profile?.problem_impact ?? null) : undefined,
    life_with_problem: includeEmpty || (profile as { life_with_problem?: string | null })?.life_with_problem
      ? ((profile as { life_with_problem?: string | null })?.life_with_problem ?? null)
      : undefined,
    life_after_solution: includeEmpty || (profile as { life_after_solution?: string | null })?.life_after_solution
      ? ((profile as { life_after_solution?: string | null })?.life_after_solution ?? null)
      : undefined,
    desired_transformation: includeEmpty || profile?.desired_transformation ? (profile?.desired_transformation ?? null) : undefined,
    transformation_mechanism: includeEmpty || profile?.transformation_mechanism ? (profile?.transformation_mechanism ?? null) : undefined,
    authority_domains: includeEmpty || (profile?.authority_domains?.length ?? 0) > 0 ? (profile?.authority_domains ?? null) : undefined,
  };

  const campaign: CompanyContextCampaign = {
    campaign_focus: includeEmpty || profile?.campaign_focus ? (profile?.campaign_focus ?? null) : undefined,
    content_themes: includeEmpty || profile?.content_themes ? (profile?.content_themes ?? null) : undefined,
    growth_priorities: includeEmpty || profile?.growth_priorities ? (profile?.growth_priorities ?? null) : undefined,
    goals: includeEmpty || profile?.goals ? (profile?.goals ?? null) : undefined,
    campaign_purpose_intent: includeEmpty || profile?.campaign_purpose_intent ? (profile?.campaign_purpose_intent ?? null) : undefined,
    reader_emotion_target:
      includeEmpty || coerceNonEmptyString((cpi as any)?.reader_emotion_target)
        ? (coerceNonEmptyString((cpi as any)?.reader_emotion_target) ?? null)
        : undefined,
    narrative_flow_seed:
      includeEmpty || hasMeaningfulNarrativeSeed((cpi as any)?.narrative_flow_seed)
        ? (((cpi as any)?.narrative_flow_seed ?? null) as any)
        : undefined,
    recommended_cta_style: (() => {
      const explicit =
        coerceNonEmptyString((cpi as any)?.recommended_cta_style) ??
        coerceNonEmptyString((profile as any)?.recommended_cta_style);
      const derived = deriveRecommendedCtaStyle();
      const value = explicit ?? derived;
      if (includeEmpty) return value ?? null;
      return value ? value : undefined;
    })(),
  };

  const commercial: CompanyContextCommercial = {
    pricing_model: includeEmpty || profile?.pricing_model ? (profile?.pricing_model ?? null) : undefined,
    sales_motion: includeEmpty || profile?.sales_motion ? (profile?.sales_motion ?? null) : undefined,
    avg_deal_size: includeEmpty || profile?.avg_deal_size ? (profile?.avg_deal_size ?? null) : undefined,
    sales_cycle: includeEmpty || profile?.sales_cycle ? (profile?.sales_cycle ?? null) : undefined,
    key_metrics: includeEmpty || profile?.key_metrics ? (profile?.key_metrics ?? null) : undefined,
  };

  return {
    identity,
    brand,
    customer,
    problem_transformation,
    campaign,
    commercial,
  };
}

/** Map forced_context_fields keys to section/field paths in CompanyContext. */
const FORCED_FIELD_MAP: Record<string, { section: keyof CompanyContext; field: string }> = {
  brand_voice: { section: 'brand', field: 'brand_voice' },
  brand_positioning: { section: 'brand', field: 'brand_positioning' },
  key_messages: { section: 'brand', field: 'key_messages' },
  competitive_advantages: { section: 'brand', field: 'competitive_advantages' },
  geography: { section: 'identity', field: 'geography' },
  geography_list: { section: 'identity', field: 'geography_list' },
  content_themes: { section: 'campaign', field: 'content_themes' },
  problem_transformation: { section: 'problem_transformation', field: '_section' },
  campaign_focus: { section: 'campaign', field: 'campaign_focus' },
  growth_priorities: { section: 'campaign', field: 'growth_priorities' },
  target_audience: { section: 'customer', field: 'target_audience' },
  ideal_customer_profile: { section: 'customer', field: 'ideal_customer_profile' },
  core_problem_statement: { section: 'problem_transformation', field: 'core_problem_statement' },
  pain_symptoms: { section: 'problem_transformation', field: 'pain_symptoms' },
  authority_domains: { section: 'problem_transformation', field: 'authority_domains' },
  awareness_gap: { section: 'problem_transformation', field: 'awareness_gap' },
  problem_impact: { section: 'problem_transformation', field: 'problem_impact' },
  desired_transformation: { section: 'problem_transformation', field: 'desired_transformation' },
  transformation_mechanism: { section: 'problem_transformation', field: 'transformation_mechanism' },
  life_with_problem: { section: 'problem_transformation', field: 'life_with_problem' },
  life_after_solution: { section: 'problem_transformation', field: 'life_after_solution' },
};

export type ForcedContextFields = Record<string, boolean>;

export type ForcedCompanyContextResult = {
  forced_context: Record<string, unknown>;
  forced_context_enabled_fields: string[];
};

export function buildForcedCompanyContext(
  companyContext: CompanyContext,
  forcedContextFields: ForcedContextFields | null | undefined
): ForcedCompanyContextResult {
  const forced_context: Record<string, unknown> = {};
  const forced_context_enabled_fields: string[] = [];

  if (!forcedContextFields || typeof forcedContextFields !== 'object') {
    return { forced_context, forced_context_enabled_fields };
  }

  for (const [key, enabled] of Object.entries(forcedContextFields)) {
    if (!enabled) continue;

    const mapping = FORCED_FIELD_MAP[key];
    if (!mapping) continue;

    const section = companyContext[mapping.section] as Record<string, unknown> | undefined;
    if (!section) continue;

    if (mapping.field === '_section') {
      const sectionData = section as Record<string, unknown>;
      const hasAny = Object.values(sectionData).some(
        (v) => v != null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== '')
      );
      if (hasAny) {
        forced_context[key] = sectionData;
        forced_context_enabled_fields.push(key);
      }
    } else {
      const value = section[mapping.field];
      if (value != null && (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '')) {
        forced_context[key] = value;
        forced_context_enabled_fields.push(key);
      }
    }
  }

  return { forced_context, forced_context_enabled_fields };
}

/** Format forced_context as a string block for AI prompts. */
export function formatForcedContextForPrompt(forcedContext: Record<string, unknown>): string {
  if (Object.keys(forcedContext).length === 0) return '';

  const lines: string[] = ['FORCED COMPANY CONTEXT (must be respected):'];
  for (const [key, value] of Object.entries(forcedContext)) {
    if (value == null) continue;
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (Array.isArray(value)) {
      lines.push(`${label}: ${value.join(', ')}`);
    } else if (typeof value === 'object') {
      lines.push(`${label}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${label}: ${value}`);
    }
  }
  return lines.join('\n');
}

/** Display labels for forced context fields (for dashboard). */
export const FORCED_CONTEXT_FIELD_LABELS: Record<string, string> = {
  brand_voice: 'Brand Voice',
  brand_positioning: 'Brand Positioning',
  key_messages: 'Key Messages',
  competitive_advantages: 'Competitive Advantages',
  geography: 'Regions',
  geography_list: 'Regions',
  content_themes: 'Themes',
  problem_transformation: 'Problem Intelligence',
  campaign_focus: 'Campaign Focus',
  growth_priorities: 'Growth Priorities',
  target_audience: 'Target Audience',
  ideal_customer_profile: 'Ideal Customer Profile',
  core_problem_statement: 'Core Problem',
  pain_symptoms: 'Pain Symptoms',
  authority_domains: 'Authority Domains',
  awareness_gap: 'Awareness Gap',
  problem_impact: 'Problem Impact',
  desired_transformation: 'Desired Transformation',
  transformation_mechanism: 'Transformation Mechanism',
  life_with_problem: 'Life With Problem',
  life_after_solution: 'Life After Solution',
};

/** Compute company context completion (0-100) based on non-empty sections. */
export function computeCompanyContextCompletion(companyContext: CompanyContext): number {
  const sections = ['identity', 'brand', 'customer', 'problem_transformation', 'campaign', 'commercial'] as const;
  let filled = 0;
  for (const sectionKey of sections) {
    const section = companyContext[sectionKey] as Record<string, unknown>;
    const hasAny = Object.values(section || {}).some(
      (v) => v != null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== '')
    );
    if (hasAny) filled++;
  }
  return Math.round((filled / sections.length) * 100);
}
