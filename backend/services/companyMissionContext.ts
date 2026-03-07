/**
 * Problem-Mission Intelligence Layer.
 * Replaces shallow profile string context with structured problem-domain alignment.
 */

import { getProfile } from './companyProfileService';
import type { CompanyProfile } from './companyProfileService';

export type ContextMode =
  | 'FULL'
  | 'BRAND_ONLY'
  | 'ICP_ONLY'
  | 'BRAND_ICP'
  | 'NONE';

export interface CampaignPurposeIntent {
  primary_objective?: string | null;
  campaign_intent?: string | null;
  monetization_intent?: string | null;
  dominant_problem_domains?: string[];
  brand_positioning_angle?: string | null;
}

export interface CompanyMissionContext {
  company_name: string;
  mission_statement: string;
  core_problem_domains: string[];
  target_persona: string;
  transformation_outcome: string;
  disqualified_signals: string[];
  opportunity_intent: string;
  geography?: string;
  strategic_purpose?: CampaignPurposeIntent | null;
}

const FALLBACK_MISSION =
  'This company exists to solve recurring decision and clarity problems within its target audience.';

const DEFAULT_DISQUALIFIED: string[] = [
  'Event announcements',
  'Generic motivational posts',
  'Industry news not tied to a user problem',
  'Educational seminars',
  'Surface-level keyword mentions',
];

const DEFAULT_OPPORTUNITY_INTENT =
  'Identify emerging or escalating user problems within the defined problem domains where timely intervention can create authority, trust, and demand.';

function parseList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return String(value)
    .split(/[,;\n|]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function deriveProblemDomains(profile: CompanyProfile): string[] {
  const sources: string[] = [];

  const campaignFocus = profile.campaign_focus ?? '';
  if (campaignFocus) {
    parseList(campaignFocus).forEach((s) => sources.push(s));
  }

  const contentThemes = profile.content_themes ?? '';
  if (contentThemes) {
    parseList(contentThemes).forEach((s) => sources.push(s));
  }

  const targetSegment = profile.target_customer_segment ?? profile.ideal_customer_profile ?? '';
  if (targetSegment) {
    sources.push(targetSegment.slice(0, 80));
  }

  const growthPriorities = profile.growth_priorities ?? '';
  if (growthPriorities) {
    parseList(growthPriorities).forEach((s) => sources.push(s));
  }

  const coreProblem = profile.core_problem_statement ?? '';
  if (coreProblem) {
    parseList(coreProblem).forEach((s) => sources.push(s));
  }

  const painSymptoms = profile.pain_symptoms;
  if (Array.isArray(painSymptoms)) {
    painSymptoms.forEach((s) => {
      if (typeof s === 'string' && s.trim()) sources.push(s.trim());
    });
  }

  const authorityDomains = profile.authority_domains;
  if (Array.isArray(authorityDomains)) {
    authorityDomains.forEach((s) => {
      if (typeof s === 'string' && s.trim()) sources.push(s.trim());
    });
  }

  const unique = Array.from(new Set(sources.map((s) => s.trim().toLowerCase()))).slice(0, 8);
  return unique.length > 0
    ? unique.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    : ['Decision uncertainty', 'Clarity gaps', 'Timing pressure'];
}

function deriveMissionStatement(profile: CompanyProfile): string {
  const positioning = profile.brand_positioning ?? '';
  const keyMessages = profile.key_messages ?? '';
  if (positioning && positioning.trim().length > 10) return positioning.trim();
  if (keyMessages && keyMessages.trim().length > 10) return keyMessages.trim();
  return FALLBACK_MISSION;
}

function deriveTransformationOutcome(profile: CompanyProfile): string {
  const desiredTransformation = profile.desired_transformation ?? '';
  if (desiredTransformation && desiredTransformation.trim().length > 15) {
    return desiredTransformation.trim().slice(0, 200);
  }
  const lifeAfterSolution = (profile as { life_after_solution?: string | null }).life_after_solution ?? '';
  if (lifeAfterSolution && lifeAfterSolution.trim().length > 15) {
    return lifeAfterSolution.trim().slice(0, 200);
  }
  const objectives = profile.campaign_focus ?? '';
  const valueProp = profile.unique_value ?? profile.competitive_advantages ?? '';
  if (objectives && objectives.trim().length > 15) return objectives.trim().slice(0, 200);
  if (valueProp && valueProp.trim().length > 15) return valueProp.trim().slice(0, 200);
  return 'Enable individuals to make confident decisions and restore clarity during uncertainty.';
}

export function deriveDisqualifiedSignals(profile: CompanyProfile): string[] {
  const result: string[] = [...DEFAULT_DISQUALIFIED];
  const addFrom = (value: string | string[] | null | undefined) => {
    const items = parseList(value);
    items.forEach((s) => {
      const lower = s.toLowerCase().trim();
      if (lower.length > 2 && !result.some((r) => r.toLowerCase() === lower)) {
        result.push(s.trim());
      }
    });
  };
  addFrom(profile.content_strategy);
  const identitySafe = (profile as { identity_safe_topics?: string | string[] | null }).identity_safe_topics;
  if (identitySafe) addFrom(identitySafe);
  return result;
}

export async function buildCompanyMissionContext(
  companyId: string,
  mode: ContextMode
): Promise<CompanyMissionContext | null> {
  if (mode === 'NONE') return null;

  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  if (!profile) return null;

  const cpi = profile.campaign_purpose_intent;
  const hasCpi = cpi && typeof cpi === 'object';

  const company_name = profile.name ?? profile.company_id ?? 'Company';
  const mission_statement = hasCpi && cpi.primary_objective
    ? String(cpi.primary_objective).trim()
    : deriveMissionStatement(profile);
  const core_problem_domains = hasCpi && Array.isArray(cpi.dominant_problem_domains) && cpi.dominant_problem_domains.length > 0
    ? cpi.dominant_problem_domains.filter((d): d is string => typeof d === 'string')
    : deriveProblemDomains(profile);
  const opportunity_intent = hasCpi && cpi.campaign_intent
    ? String(cpi.campaign_intent).trim()
    : DEFAULT_OPPORTUNITY_INTENT;
  const target_persona =
    profile.target_customer_segment ?? profile.ideal_customer_profile ?? profile.target_audience ?? 'Target audience';
  const transformation_outcome = deriveTransformationOutcome(profile);
  const disqualified_signals = deriveDisqualifiedSignals(profile);
  const geography =
    profile.geography ??
    (Array.isArray(profile.geography_list) && profile.geography_list.length > 0
      ? profile.geography_list.join(', ')
      : undefined);

  const full: CompanyMissionContext = {
    company_name,
    mission_statement,
    core_problem_domains,
    target_persona,
    transformation_outcome,
    disqualified_signals,
    opportunity_intent,
    geography,
    strategic_purpose: hasCpi ? cpi : null,
  };

  switch (mode) {
    case 'FULL':
      return full;
    case 'BRAND_ONLY': {
      const { core_problem_domains: _, opportunity_intent: __, ...rest } = full;
      return { ...rest, core_problem_domains: [], opportunity_intent: '' };
    }
    case 'ICP_ONLY':
      return {
        ...full,
        mission_statement: '',
        disqualified_signals: [],
        opportunity_intent: '',
      };
    case 'BRAND_ICP':
      return {
        company_name: full.company_name,
        mission_statement: full.mission_statement,
        core_problem_domains: full.core_problem_domains,
        target_persona: full.target_persona,
        transformation_outcome: full.transformation_outcome,
        disqualified_signals: [],
        opportunity_intent: full.opportunity_intent,
        geography: full.geography,
      };
    default:
      return null;
  }
}

export function formatMissionContextForPrompt(ctx: CompanyMissionContext | null): string {
  if (!ctx) return '';
  const parts: string[] = [];
  const sp = ctx.strategic_purpose;
  if (sp) {
    parts.push('STRATEGIC PURPOSE:');
    if (sp.primary_objective) parts.push(`Primary Objective: ${sp.primary_objective}`);
    if (sp.campaign_intent) parts.push(`Campaign Intent: ${sp.campaign_intent}`);
    if (sp.monetization_intent) parts.push(`Monetization Intent: ${sp.monetization_intent}`);
    if (Array.isArray(sp.dominant_problem_domains) && sp.dominant_problem_domains.length > 0) {
      parts.push(`Dominant Problems:\n${sp.dominant_problem_domains.map((d) => `- ${d}`).join('\n')}`);
    }
    if (sp.brand_positioning_angle) parts.push(`Positioning Angle: ${sp.brand_positioning_angle}`);
    parts.push('');
  }
  parts.push(`Company Mission: ${ctx.mission_statement}`);
  if (ctx.core_problem_domains.length > 0) {
    parts.push(`Core Problem Domains:\n${ctx.core_problem_domains.map((d) => `- ${d}`).join('\n')}`);
  }
  parts.push(`Target Persona: ${ctx.target_persona}`);
  parts.push(`Transformation Outcome: ${ctx.transformation_outcome}`);
  if (ctx.opportunity_intent) {
    parts.push(`Opportunity Intent: ${ctx.opportunity_intent}`);
  }
  if (ctx.disqualified_signals.length > 0) {
    parts.push(`Ignore Signals Such As:\n${ctx.disqualified_signals.map((s) => `- ${s}`).join('\n')}`);
  }
  if (ctx.geography) {
    parts.push(`Geography: ${ctx.geography}`);
  }
  return parts.join('\n\n');
}
