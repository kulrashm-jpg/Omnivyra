/**
 * companyContextCompleteness.ts
 *
 * Phase 2.4 — Strategic-field completeness scoring for CompanyContext.
 *
 * The audit found that `buildContentContext` was loading 68 columns from the
 * DB but exposing only 17 of them. Even after the Phase 2.4 expansion, most
 * production profiles will populate only a subset of fields. This module
 * computes a deterministic completeness score plus the list of missing
 * fields so generation code and telemetry can:
 *
 *   - detect sparse profiles before they produce weak output
 *   - surface which strategic anchors are unavailable for prompt injection
 *   - drive the LONGFORM_CONTEXT_USAGE_REPORT telemetry event
 */

import type { CompanyContext, ContextCompletenessReport } from '../blog/blogRunnerTypes';

/**
 * The strategic field set. Each entry is `(name, isCritical, isPresent)`.
 * `isCritical` flags fields whose absence is the single strongest predictor
 * of generic output (per the audit, §4.1 missing-fields table).
 */
type FieldSpec = readonly [name: string, isCritical: boolean, isPresent: (ctx: CompanyContext) => boolean];

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
function nonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}
function nonEmptyObject(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0;
}

const STRATEGIC_FIELDS: readonly FieldSpec[] = [
  // ── Critical: identity & audience ────────────────────────────────────────
  ['companyName',           true,  (c) => nonEmptyString(c.companyName)],
  ['industry',              true,  (c) => nonEmptyString(c.industry)],
  ['audience',              true,  (c) => nonEmptyString(c.audience)],
  ['idealCustomerProfile',  true,  (c) => nonEmptyString(c.idealCustomerProfile)],
  // ── Critical: problem & transformation ───────────────────────────────────
  ['coreProblemStatement',  true,  (c) => nonEmptyString(c.coreProblemStatement)],
  ['painSymptoms',          true,  (c) => nonEmptyArray(c.painSymptoms)],
  ['desiredTransformation', true,  (c) => nonEmptyString(c.desiredTransformation)],
  ['transformationMechanism', true, (c) => nonEmptyString(c.transformationMechanism)],
  ['uniqueValue',           true,  (c) => nonEmptyString(c.uniqueValue)],
  ['competitiveAdvantages', true,  (c) => nonEmptyString(c.competitiveAdvantages)],
  // ── Important: positioning & messaging ───────────────────────────────────
  ['productsServices',      false, (c) => nonEmptyString(c.productsServices)],
  ['keyMessages',           false, (c) => nonEmptyString(c.keyMessages)],
  ['authorityDomains',      false, (c) => nonEmptyArray(c.authorityDomains)],
  ['brand_voice',           false, (c) => nonEmptyString(c.brand_voice)],
  ['contentThemes',         false, (c) => nonEmptyString(c.contentThemes)],
  // ── Important: strategic depth ───────────────────────────────────────────
  ['problemImpact',         false, (c) => nonEmptyString(c.problemImpact)],
  ['awarenessGap',          false, (c) => nonEmptyString(c.awarenessGap)],
  ['lifeWithProblem',       false, (c) => nonEmptyString(c.lifeWithProblem)],
  ['lifeAfterSolution',     false, (c) => nonEmptyString(c.lifeAfterSolution)],
  ['recommendationContext', false, (c) => nonEmptyObject(c.recommendationContext)],
  ['strategyProfile',       false, (c) => nonEmptyObject(c.strategyProfile)],
  // ── Useful: commercial + market ──────────────────────────────────────────
  ['campaignFocus',         false, (c) => nonEmptyString(c.campaignFocus)],
  ['growthPriorities',      false, (c) => nonEmptyString(c.growthPriorities)],
  ['goals',                 false, (c) => nonEmptyString(c.goals)],
  ['geography',             false, (c) => nonEmptyString(c.geography)],
  ['marketingChannels',     false, (c) => nonEmptyString(c.marketingChannels)],
  ['contentStrategy',       false, (c) => nonEmptyString(c.contentStrategy)],
  ['competitors',           false, (c) => nonEmptyString(c.competitors)],
  ['salesMotion',           false, (c) => nonEmptyString(c.salesMotion)],
  ['pricingModel',          false, (c) => nonEmptyString(c.pricingModel)],
  ['avgDealSize',           false, (c) => nonEmptyString(c.avgDealSize)],
  ['salesCycle',            false, (c) => nonEmptyString(c.salesCycle)],
  ['reportSettings',        false, (c) => nonEmptyObject(c.reportSettings)],
  ['strategicInputs',       false, (c) => nonEmptyObject(c.strategicInputs)],
];

export function computeCompanyContextCompleteness(ctx: CompanyContext | undefined | null): ContextCompletenessReport {
  if (!ctx) {
    return {
      score: 0,
      missing_context_fields: STRATEGIC_FIELDS.map(([n]) => n),
      populated_context_fields: [],
      critical_fields_missing: STRATEGIC_FIELDS.filter(([, c]) => c).map(([n]) => n),
    };
  }

  const populated: string[] = [];
  const missing: string[] = [];
  const criticalMissing: string[] = [];

  for (const [name, isCritical, isPresent] of STRATEGIC_FIELDS) {
    if (isPresent(ctx)) {
      populated.push(name);
    } else {
      missing.push(name);
      if (isCritical) criticalMissing.push(name);
    }
  }

  const score = Math.round((populated.length / STRATEGIC_FIELDS.length) * 100);

  return {
    score,
    missing_context_fields: missing,
    populated_context_fields: populated,
    critical_fields_missing: criticalMissing,
  };
}

export const TOTAL_STRATEGIC_FIELDS = STRATEGIC_FIELDS.length;
export const STRATEGIC_FIELD_NAMES = STRATEGIC_FIELDS.map(([n]) => n);
