import type { CompanyContext } from '../blog/blogRunnerTypes';
import type { CompanyProfile } from '../../backend/services/companyProfile/types';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { buildFormattedStyleInstructions } from './writingStyleEngine';
import { computeCompanyContextCompleteness } from './companyContextCompleteness';

export interface BuiltContentContext {
  companyProfile?: Record<string, unknown>;
  writingStyleInstructions?: string;
  companyContext: CompanyContext;
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayField(source: Record<string, unknown>, key: string): string[] | undefined {
  const value = source[key];
  return Array.isArray(value) && value.length > 0
    ? value.filter((entry: unknown) => typeof entry === 'string') as string[]
    : undefined;
}

/**
 * Pass through a nested JSON object verbatim if it exists and is non-empty.
 *
 * Phase 2.4 requires that nested structures (recommendation_context,
 * report_settings, strategic_inputs) be preserved unmodified — no partial
 * mapping — because downstream identity extraction reads sub-keys directly.
 */
function passthroughObject<T>(source: Record<string, unknown>, key: string): T | undefined {
  const value = source[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (Object.keys(value as object).length === 0) return undefined;
  return value as T;
}

/**
 * Phase 2.4 — Expanded CompanyContext construction.
 *
 * Previously dropped 30+ DB columns; now passes through every strategic
 * field the audit identified as critical. Nested JSON structures
 * (`recommendation_context`, `report_settings`, `strategic_inputs`) are
 * preserved verbatim so that downstream identity extraction (which reads
 * `report_settings.entity_archetype`, `.competitor_intelligence`, and
 * `.user_guidance`) sees the full shape.
 *
 * Also computes a completeness score + missing-field list so generation
 * code can detect sparse profiles before producing weak output.
 */
export async function buildContentContext(companyId: string): Promise<BuiltContentContext> {
  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  const companyProfile = profile ? profile as Record<string, unknown> : undefined;
  const writingStyleInstructions = profile ? buildFormattedStyleInstructions(profile) : undefined;
  const p = companyProfile || {};

  const baseContext: CompanyContext = {
    // ── Original 17 fields (unchanged) ─────────────────────────────────────
    audience: stringField(p, 'target_audience') || stringField(p, 'audience'),
    brand_voice: stringField(p, 'brand_voice') || stringField(p, 'writing_style'),
    industry: stringField(p, 'industry'),
    writingStyleInstructions,
    companyName: stringField(p, 'name'),
    uniqueValue: stringField(p, 'unique_value'),
    competitiveAdvantages: stringField(p, 'competitive_advantages'),
    productsServices: stringField(p, 'products_services'),
    contentThemes: stringField(p, 'content_themes'),
    campaignFocus: stringField(p, 'campaign_focus'),
    growthPriorities: stringField(p, 'growth_priorities'),
    coreProblemStatement: stringField(p, 'core_problem_statement'),
    painSymptoms: stringArrayField(p, 'pain_symptoms'),
    authorityDomains: stringArrayField(p, 'authority_domains'),
    desiredTransformation: stringField(p, 'desired_transformation'),
    keyMessages: stringField(p, 'key_messages'),
    goals: stringField(p, 'goals'),
    geography: stringField(p, 'geography'),

    // ── Phase 2.4: strategic fields previously dropped ─────────────────────
    idealCustomerProfile: stringField(p, 'ideal_customer_profile'),
    problemImpact: stringField(p, 'problem_impact'),
    awarenessGap: stringField(p, 'awareness_gap'),
    lifeWithProblem: stringField(p, 'life_with_problem'),
    lifeAfterSolution: stringField(p, 'life_after_solution'),
    transformationMechanism: stringField(p, 'transformation_mechanism'),
    recommendationContext: passthroughObject<NonNullable<CompanyContext['recommendationContext']>>(p, 'recommendation_context'),
    marketingChannels: stringField(p, 'marketing_channels'),
    contentStrategy: stringField(p, 'content_strategy'),
    competitors: stringField(p, 'competitors'),
    salesMotion: stringField(p, 'sales_motion'),
    pricingModel: stringField(p, 'pricing_model'),
    avgDealSize: stringField(p, 'avg_deal_size'),
    salesCycle: stringField(p, 'sales_cycle'),
    reportSettings: passthroughObject<NonNullable<CompanyContext['reportSettings']>>(p, 'report_settings'),
    strategicInputs: passthroughObject<NonNullable<CompanyContext['strategicInputs']>>(p, 'strategic_inputs'),
  };

  // Completeness telemetry — computed AFTER all fields are populated.
  const completeness = computeCompanyContextCompleteness(baseContext);

  return {
    companyProfile,
    writingStyleInstructions,
    companyContext: {
      ...baseContext,
      context_completeness_score: completeness.score,
      missing_context_fields: completeness.missing_context_fields,
    },
  };
}

/**
 * Phase 2.5 helper — expose the raw profile so callers can build a
 * canonical CompanyIdentity via `extractCompanyIdentity(profile)`. Returning
 * the typed shape avoids forcing callers to re-fetch.
 */
export async function buildContentContextWithProfile(
  companyId: string,
): Promise<BuiltContentContext & { typedProfile?: CompanyProfile }> {
  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  const built = await buildContentContext(companyId);
  return { ...built, typedProfile: profile as CompanyProfile | undefined };
}
