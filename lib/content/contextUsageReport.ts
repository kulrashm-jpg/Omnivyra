/**
 * contextUsageReport.ts
 *
 * Phase 2.8 — Generation telemetry for context fidelity.
 *
 * Detects:
 *   - wasted context (fields populated on the profile but never appearing
 *     in the prompt — `unused_context_fields`)
 *   - sparse profiles (many fields empty — drives `ignored_critical_fields`)
 *   - heavily-used fields (the model only sees a narrow slice)
 *
 * This is observability, not enforcement. The numbers feed
 * LONGFORM_CONTEXT_USAGE_REPORT events so operators can correlate prompt
 * shape with output quality.
 */

import type { CompanyContext } from '../blog/blogRunnerTypes';
import { computeCompanyContextCompleteness } from './companyContextCompleteness';
import { emitContextUsageReport } from './longFormEngineTelemetry';

export interface ContextUsageReport {
  total_context_fields: number;
  utilized_context_fields: number;
  unused_context_fields: string[];
  heavily_used_fields: string[];
  ignored_critical_fields: string[];
}

const FIELD_PROMPT_TOKENS: Array<readonly [keyof CompanyContext, string[]]> = [
  ['companyName',           ['Company:', 'COMPANY:', 'in-house content strategist for']],
  ['industry',              ['Industry:', 'INDUSTRY:', 'YOUR INDUSTRY']],
  ['audience',              ['audience:', 'AUDIENCE:', 'TARGET AUDIENCE']],
  ['idealCustomerProfile',  ['ICP:', 'IDEAL CUSTOMER', 'Ideal Customer']],
  ['coreProblemStatement',  ['CORE PROBLEM', 'core problem', 'Core problem']],
  ['painSymptoms',          ['pain point', 'PAIN POINTS', 'Key pain']],
  ['uniqueValue',           ['UNIQUE VALUE', 'unique value', 'Unique value']],
  ['competitiveAdvantages', ['DIFFERENTIATORS', 'differentiat', 'competitive']],
  ['productsServices',      ['Products/services', 'PRODUCTS/SERVICES']],
  ['desiredTransformation', ['Transformation', 'TRANSFORMATION']],
  ['transformationMechanism', ['transformation mechanism', 'Transformation mechanism']],
  ['authorityDomains',      ['Authority', 'AUTHORITY DOMAINS', 'authority lens']],
  ['keyMessages',           ['Key messages', 'KEY MESSAGES']],
  ['brand_voice',           ['brand voice', 'Brand voice', 'BRAND VOICE']],
  ['contentThemes',         ['Key themes', 'content themes']],
  ['problemImpact',         ['Problem impact', 'problem impact']],
  ['awarenessGap',          ['Awareness gap', 'awareness gap']],
  ['lifeWithProblem',       ['Life with problem']],
  ['lifeAfterSolution',     ['Life after solution']],
  ['recommendationContext', ['contrarian', 'key threat', 'strategic_focus']],
  ['strategyProfile',       ['worldview', 'contrarian belief', 'differentiation']],
  ['campaignFocus',         ['Campaign focus', 'CAMPAIGN OBJECTIVE']],
  ['growthPriorities',      ['Growth priorities']],
  ['goals',                 ['Goals:']],
  ['geography',             ['Geography:', 'GEO:']],
  ['marketingChannels',     ['marketing channels']],
  ['contentStrategy',       ['content strategy']],
  ['competitors',           ['Competitors:', 'competitor:']],
  ['salesMotion',           ['sales motion']],
  ['pricingModel',          ['pricing model']],
  ['avgDealSize',           ['avg deal']],
  ['salesCycle',            ['sales cycle']],
  ['reportSettings',        ['archetype', 'PEER INTELLIGENCE', 'USER-APPROVED IDENTITY']],
  ['strategicInputs',       ['strategic aspect']],
];

const CRITICAL_FOR_USAGE = new Set<keyof CompanyContext>([
  'companyName',
  'idealCustomerProfile',
  'coreProblemStatement',
  'painSymptoms',
  'uniqueValue',
  'competitiveAdvantages',
  'desiredTransformation',
  'reportSettings',
]);

function fieldIsPopulated(ctx: CompanyContext, key: keyof CompanyContext): boolean {
  const v = ctx[key];
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return false;
}

function fieldAppearsInPrompt(promptText: string, tokens: readonly string[]): boolean {
  for (const t of tokens) {
    if (t && promptText.includes(t)) return true;
  }
  return false;
}

/**
 * Compute and emit a context-usage report.
 *
 * `assembledPrompt` is the rendered prompt text (system + user concatenated)
 * the model received. We grep it for canonical prompt markers per field —
 * if a field is populated but its marker is absent, the field is "wasted".
 */
export function computeContextUsageReport(input: {
  context: CompanyContext | undefined | null;
  assembledPrompt: string;
}): ContextUsageReport {
  const populated: Array<keyof CompanyContext> = [];
  const unused: string[] = [];
  const heavilyUsed: string[] = [];

  if (!input.context) {
    return {
      total_context_fields: FIELD_PROMPT_TOKENS.length,
      utilized_context_fields: 0,
      unused_context_fields: FIELD_PROMPT_TOKENS.map(([n]) => String(n)),
      heavily_used_fields: [],
      ignored_critical_fields: Array.from(CRITICAL_FOR_USAGE).map(String),
    };
  }

  for (const [key, tokens] of FIELD_PROMPT_TOKENS) {
    if (!fieldIsPopulated(input.context, key)) continue;
    populated.push(key);
    const appears = fieldAppearsInPrompt(input.assembledPrompt, tokens);
    if (!appears) {
      unused.push(String(key));
    } else {
      // "Heavily used" heuristic: token appears at least 3 times.
      let occurrences = 0;
      for (const t of tokens) {
        let idx = -1;
        while ((idx = input.assembledPrompt.indexOf(t, idx + 1)) !== -1) occurrences++;
        if (occurrences >= 3) break;
      }
      if (occurrences >= 3) heavilyUsed.push(String(key));
    }
  }

  const ignoredCritical = Array.from(CRITICAL_FOR_USAGE)
    .filter((k) => !fieldIsPopulated(input.context!, k))
    .map(String);

  return {
    total_context_fields: FIELD_PROMPT_TOKENS.length,
    utilized_context_fields: populated.length - unused.length,
    unused_context_fields: unused,
    heavily_used_fields: heavilyUsed,
    ignored_critical_fields: ignoredCritical,
  };
}

/**
 * Convenience: compute and emit the usage report in one call.
 */
export function recordContextUsageReport(input: {
  context: CompanyContext | undefined | null;
  assembledPrompt: string;
  source: string;
  companyId?: string;
  contentType?: string;
}): ContextUsageReport {
  const report = computeContextUsageReport({
    context: input.context,
    assembledPrompt: input.assembledPrompt,
  });
  const completeness = computeCompanyContextCompleteness(input.context);
  emitContextUsageReport({
    source: input.source,
    company_id: input.companyId,
    content_type: input.contentType,
    completeness_score: completeness.score,
    critical_missing: completeness.critical_fields_missing,
    ...report,
  });
  return report;
}
