/**
 * CompanyContextFoundation
 *
 * Normalized reasoning abstraction over CompanyContext + CompanyProfile.
 * Purpose: long-form recommendation generation must reason from business
 * capability, ICP pain, strategic POV, and category expertise — not raw
 * memory strings. This module synthesizes those abstractions deterministically.
 *
 * Shared module: designed to be adopted later by the existing short-form
 * recommendationEngine.ts. No raw profile fields are exposed downstream.
 */

import type { CompanyProfile } from '../companyProfileService';
import type { CompanyContext } from '../companyContextService';
import { buildCompanyContext } from '../companyContextService';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface BusinessIdentity {
  companyCategory: string | null;
  positioning: string | null;
  productServiceCategories: string[];
  operationalModel: string | null;
  archetype: string | null;
}

export interface MarketUnderstanding {
  targetMarket: string | null;
  icps: string[];
  buyerMaturity: 'early' | 'evaluation' | 'committed' | 'mixed' | 'unknown';
  marketPainPoints: string[];
  operationalFrictionAreas: string[];
}

export interface StrategicPov {
  transformationNarrative: string | null;
  philosophy: string | null;
  differentiation: string[];
  antiPatterns: string[];
  preferredApproaches: string[];
}

export interface CapabilityMapping {
  enables: string[];
  workflowCategories: string[];
  executionLayers: string[];
  measurableOutcomes: string[];
}

export interface TerminologyLayer {
  domainVocabulary: string[];
  industryWording: string[];
  strategicTerminology: string[];
}

export interface CompanyContextFoundation {
  /** Stable hash for cache keys / drift detection comparison. */
  signature: string;
  /** Overall completion (0–100) of the underlying CompanyContext. */
  completion: number;
  businessIdentity: BusinessIdentity;
  marketUnderstanding: MarketUnderstanding;
  strategicPov: StrategicPov;
  capabilityMapping: CapabilityMapping;
  terminologyLayer: TerminologyLayer;
  /** Which sections have at least one populated reasoning signal. */
  populatedSections: Array<
    'businessIdentity' | 'marketUnderstanding' | 'strategicPov' | 'capabilityMapping' | 'terminologyLayer'
  >;
}

export interface FoundationStripped {
  /** Foundation with ALL company-derived signals removed — used for drift detection. */
  empty: true;
  signature: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function trimToString(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(value);
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function splitToList(value: unknown, max = 12): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => trimToString(v))
      .filter((v): v is string => v !== null)
      .slice(0, max);
  }
  const s = trimToString(value);
  if (!s) return [];
  return s
    .split(/[\n,;|•·]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
    .slice(0, max);
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function hashSignature(input: unknown): string {
  const s = JSON.stringify(input);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return `ccf_${(h >>> 0).toString(16)}`;
}

function inferBuyerMaturity(
  context: CompanyContext,
  profile: CompanyProfile | null,
): MarketUnderstanding['buyerMaturity'] {
  const haystack = [
    context.customer.target_audience,
    context.customer.ideal_customer_profile,
    context.customer.target_customer_segment,
    context.commercial.sales_motion,
    context.commercial.sales_cycle,
    context.problem_transformation.awareness_gap,
    profile?.campaign_purpose_intent?.primary_objective,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!haystack) return 'unknown';

  const earlySignals = ['awareness', 'discovery', 'unaware', 'education', 'introduction', 'top of funnel', 'tofu'];
  const evalSignals = ['evaluation', 'comparison', 'consideration', 'shortlist', 'rfp', 'demo', 'pilot', 'mofu'];
  const committedSignals = ['expansion', 'renewal', 'retention', 'enterprise', 'committed', 'existing customer', 'bofu'];

  const hasAny = (signals: string[]) => signals.some((s) => haystack.includes(s));
  const matched = [hasAny(earlySignals), hasAny(evalSignals), hasAny(committedSignals)];
  const count = matched.filter(Boolean).length;
  if (count >= 2) return 'mixed';
  if (matched[0]) return 'early';
  if (matched[1]) return 'evaluation';
  if (matched[2]) return 'committed';
  return 'unknown';
}

function inferOperationalModel(profile: CompanyProfile | null): string | null {
  const classification = profile?.business_classification;
  if (classification?.level_2) return classification.level_2;
  if (classification?.level_1) return classification.level_1;
  const salesMotion = trimToString(profile?.sales_motion);
  if (salesMotion) return salesMotion;
  return null;
}

function deriveOperationalFriction(context: CompanyContext): string[] {
  const fromPain = splitToList(context.problem_transformation.pain_symptoms, 8);
  const fromImpact = splitToList(context.problem_transformation.problem_impact, 4);
  const fromLife = splitToList(context.problem_transformation.life_with_problem, 4);
  return dedupeCaseInsensitive([...fromPain, ...fromImpact, ...fromLife]).slice(0, 8);
}

function deriveAntiPatterns(profile: CompanyProfile | null, context: CompanyContext): string[] {
  const recCtx = profile?.recommendation_context;
  const explicit = recCtx?.contrarian_beliefs ?? [];
  const fromAdvantage = splitToList(context.brand.competitive_advantages, 4);
  // Anti-patterns are inverse of stated advantages: what the company explicitly avoids.
  const inverted = fromAdvantage.map((adv) => `Avoid: opposite of "${adv}"`);
  return dedupeCaseInsensitive([...explicit.map(String), ...inverted]).slice(0, 6);
}

function derivePreferredApproaches(profile: CompanyProfile | null, context: CompanyContext): string[] {
  const angles = splitToList(profile?.recommendation_context?.typical_angles, 6);
  const themes = splitToList(context.campaign.content_themes, 6);
  const mechanism = trimToString(context.problem_transformation.transformation_mechanism);
  return dedupeCaseInsensitive([...angles, ...themes, ...(mechanism ? [mechanism] : [])]).slice(0, 8);
}

function deriveWorkflowCategories(profile: CompanyProfile | null, context: CompanyContext): string[] {
  const products = splitToList(profile?.products_services_list ?? profile?.products_services, 8);
  const offerings = splitToList(profile?.strategic_inputs?.strategic_aspects, 6);
  const focus = splitToList(context.campaign.campaign_focus, 4);
  return dedupeCaseInsensitive([...products, ...offerings, ...focus]).slice(0, 10);
}

function deriveExecutionLayers(profile: CompanyProfile | null): string[] {
  const aspects = profile?.strategic_inputs?.offerings_by_aspect ?? null;
  if (!aspects || typeof aspects !== 'object') return [];
  const layers = Object.values(aspects).flat();
  return dedupeCaseInsensitive(layers.map(String).map((s) => s.trim()).filter(Boolean)).slice(0, 12);
}

function deriveMeasurableOutcomes(context: CompanyContext, profile: CompanyProfile | null): string[] {
  const metrics = splitToList(context.commercial.key_metrics, 6);
  const objectives = splitToList(profile?.strategic_inputs?.strategic_objectives, 6);
  const transformation = trimToString(context.problem_transformation.desired_transformation);
  return dedupeCaseInsensitive([...metrics, ...objectives, ...(transformation ? [transformation] : [])]).slice(0, 8);
}

function deriveDomainVocabulary(context: CompanyContext, profile: CompanyProfile | null): string[] {
  const authorityDomains = splitToList(context.problem_transformation.authority_domains, 6);
  const categories = splitToList(profile?.category_list ?? profile?.category, 4);
  return dedupeCaseInsensitive([...authorityDomains, ...categories]).slice(0, 10);
}

function deriveIndustryWording(profile: CompanyProfile | null): string[] {
  const industries = splitToList(profile?.industry_list ?? profile?.industry, 6);
  const segments = splitToList(profile?.target_customer_segment, 3);
  return dedupeCaseInsensitive([...industries, ...segments]).slice(0, 8);
}

function deriveStrategicTerminology(context: CompanyContext): string[] {
  const messages = splitToList(context.brand.key_messages, 6);
  const positioning = splitToList(context.brand.brand_positioning, 4);
  const valueWords = splitToList(context.brand.unique_value, 4);
  return dedupeCaseInsensitive([...messages, ...positioning, ...valueWords]).slice(0, 10);
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function buildCompanyContextFoundation(
  profile: CompanyProfile | null,
  contextOverride?: CompanyContext,
): CompanyContextFoundation {
  const context = contextOverride ?? buildCompanyContext(profile, { includeEmpty: true });

  const businessIdentity: BusinessIdentity = {
    companyCategory: trimToString(context.identity.category) ?? trimToString(context.identity.industry),
    positioning: trimToString(context.brand.brand_positioning) ?? trimToString(context.brand.unique_value),
    productServiceCategories: splitToList(profile?.products_services_list ?? profile?.products_services, 8),
    operationalModel: inferOperationalModel(profile),
    archetype:
      trimToString((profile?.report_settings?.entity_archetype?.primary_archetype as string | undefined) ?? null),
  };

  const marketUnderstanding: MarketUnderstanding = {
    targetMarket: trimToString(context.customer.target_audience) ?? trimToString(context.customer.target_customer_segment),
    icps: dedupeCaseInsensitive([
      ...splitToList(context.customer.ideal_customer_profile, 5),
      ...splitToList(profile?.target_audience_list, 5),
    ]).slice(0, 6),
    buyerMaturity: inferBuyerMaturity(context, profile),
    marketPainPoints: dedupeCaseInsensitive([
      ...(trimToString(context.problem_transformation.core_problem_statement)
        ? [context.problem_transformation.core_problem_statement as string]
        : []),
      ...splitToList(context.problem_transformation.pain_symptoms, 6),
    ]).slice(0, 8),
    operationalFrictionAreas: deriveOperationalFriction(context),
  };

  const strategicPov: StrategicPov = {
    transformationNarrative:
      trimToString(context.problem_transformation.desired_transformation)
      ?? trimToString(context.problem_transformation.transformation_mechanism),
    philosophy: trimToString(profile?.recommendation_context?.strategic_focus) ?? trimToString(context.brand.brand_voice),
    differentiation: splitToList(context.brand.competitive_advantages, 6),
    antiPatterns: deriveAntiPatterns(profile, context),
    preferredApproaches: derivePreferredApproaches(profile, context),
  };

  const capabilityMapping: CapabilityMapping = {
    enables: dedupeCaseInsensitive([
      ...(trimToString(context.brand.unique_value) ? [context.brand.unique_value as string] : []),
      ...splitToList(profile?.products_services, 4),
    ]).slice(0, 6),
    workflowCategories: deriveWorkflowCategories(profile, context),
    executionLayers: deriveExecutionLayers(profile),
    measurableOutcomes: deriveMeasurableOutcomes(context, profile),
  };

  const terminologyLayer: TerminologyLayer = {
    domainVocabulary: deriveDomainVocabulary(context, profile),
    industryWording: deriveIndustryWording(profile),
    strategicTerminology: deriveStrategicTerminology(context),
  };

  const populatedSections: CompanyContextFoundation['populatedSections'] = [];
  if (
    businessIdentity.companyCategory
    || businessIdentity.positioning
    || businessIdentity.productServiceCategories.length > 0
  ) populatedSections.push('businessIdentity');
  if (
    marketUnderstanding.targetMarket
    || marketUnderstanding.icps.length > 0
    || marketUnderstanding.marketPainPoints.length > 0
  ) populatedSections.push('marketUnderstanding');
  if (
    strategicPov.transformationNarrative
    || strategicPov.differentiation.length > 0
    || strategicPov.preferredApproaches.length > 0
  ) populatedSections.push('strategicPov');
  if (
    capabilityMapping.enables.length > 0
    || capabilityMapping.workflowCategories.length > 0
    || capabilityMapping.measurableOutcomes.length > 0
  ) populatedSections.push('capabilityMapping');
  if (
    terminologyLayer.domainVocabulary.length > 0
    || terminologyLayer.industryWording.length > 0
    || terminologyLayer.strategicTerminology.length > 0
  ) populatedSections.push('terminologyLayer');

  // Reuse existing completion math by counting populated CompanyContext sections.
  const sectionKeys = ['identity', 'brand', 'customer', 'problem_transformation', 'campaign', 'commercial'] as const;
  let filled = 0;
  for (const key of sectionKeys) {
    const section = (context as unknown as Record<string, Record<string, unknown>>)[key] ?? {};
    if (Object.values(section).some((v) => v != null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ''))) {
      filled += 1;
    }
  }
  const completion = Math.round((filled / sectionKeys.length) * 100);

  const foundation: CompanyContextFoundation = {
    signature: '',
    completion,
    businessIdentity,
    marketUnderstanding,
    strategicPov,
    capabilityMapping,
    terminologyLayer,
    populatedSections,
  };
  foundation.signature = hashSignature({
    businessIdentity,
    marketUnderstanding,
    strategicPov,
    capabilityMapping,
    terminologyLayer,
  });
  return foundation;
}

/**
 * Returns the foundation with all company-derived signals stripped to empty.
 * Used by drift detection: regenerate a recommendation with the stripped
 * foundation and compare. If the recommendation does not materially change,
 * it is GENERIC_DRIFT (company context had no influence).
 */
export function stripCompanyContextFoundation(
  foundation: CompanyContextFoundation,
): CompanyContextFoundation {
  const empty: CompanyContextFoundation = {
    signature: 'ccf_stripped',
    completion: 0,
    businessIdentity: {
      companyCategory: null,
      positioning: null,
      productServiceCategories: [],
      operationalModel: null,
      archetype: null,
    },
    marketUnderstanding: {
      targetMarket: null,
      icps: [],
      buyerMaturity: 'unknown',
      marketPainPoints: [],
      operationalFrictionAreas: [],
    },
    strategicPov: {
      transformationNarrative: null,
      philosophy: null,
      differentiation: [],
      antiPatterns: [],
      preferredApproaches: [],
    },
    capabilityMapping: {
      enables: [],
      workflowCategories: [],
      executionLayers: [],
      measurableOutcomes: [],
    },
    terminologyLayer: {
      domainVocabulary: [],
      industryWording: [],
      strategicTerminology: [],
    },
    populatedSections: [],
  };
  void foundation;
  return empty;
}

/**
 * Lightweight check used before recommendation generation: a foundation
 * with too few populated sections will produce generic output and should
 * trigger a hard error from the engine rather than silently degrading.
 */
export function foundationIsSufficient(foundation: CompanyContextFoundation): boolean {
  return foundation.populatedSections.length >= 3;
}
