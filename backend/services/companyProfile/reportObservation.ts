/**
 * WP-11 (Track J) — Report 1 must not silently rewrite the Company Profile.
 *
 * THE DEFECT
 * `persistResolvedReportInputs` (reportInputResolver.ts) is called by every Report 1 generation
 * entry point — `pages/api/reports/generate.ts`, `reportCardServiceAssembly.ts` and the
 * `reportAutomationService` cron — and it wrote the report's RESOLVED inputs straight back onto the
 * company profile row through `saveProfile(..., { source: 'user' })`. That single call carried five
 * durable, unasked-for mutations:
 *
 *   1. `name`, `website_url`, `category`, `geography`, `geography_list`, `social_profiles` and
 *      `other_social_links` were overwritten with whatever the report form / stored report defaults
 *      happened to resolve to.
 *   2. `saveProfile` treats ANY of `industry | industry_list | category | category_list | ...`
 *      being present — and `category` always is on this path — as a reason to re-run
 *      `classifyCompanyBusiness`, which REPLACES `industry`, `industry_list`, `category` and
 *      `category_list`. `industry_list` is the field the ICP generator reads (d99cf962, "read the
 *      structured Company Profile industry, not its lossy mirror"), so a report run could silently
 *      alter the input ICP generation depends on.
 *   3. `saveProfile` re-runs `getFinalCompetitors({ useNetwork: true })` and overwrites
 *      `competitors` / `competitors_list` — a paid network re-discovery, as a report side effect.
 *   4. `{ source: 'user' }` made the write indistinguishable from a human edit, so a report run
 *      could add `competitors` to `user_locked_fields` and stamp `last_edited_by = 'user'`.
 *   5. Any profile column not supplied is re-asserted from `existing`, so the row is rewritten
 *      wholesale on every report run.
 *
 * WHAT REPLACES IT
 * Report generation may observe, infer, recommend and PROPOSE evolution — it may not ratify.
 * The guarded path writes exactly one column, `report_settings`, which is the report's own
 * bookkeeping namespace (`default_inputs` already takes priority over the durable columns in
 * `getDefaultInputs`, so report continuity is unaffected), and records everything it observed but
 * did NOT apply as a recommendation-only block. That block deliberately reuses the shape of the
 * existing `report_settings.industry_review` proposal — the codebase's established
 * "AI suggested X, the user's value is Y, conflict: bool" mechanism, surfaced by
 * `components/companyProfileFormController.tsx` — rather than inventing a second one.
 *
 * NOTHING HERE TOUCHES THE DATABASE. This module is pure: it builds the proposal block and it
 * enforces the write allowlist. The single caller is `reportInputResolver.ts`.
 */

import type { CompanyProfile } from './types';

/**
 * The ONLY company_profiles columns a report run may write.
 *
 * `updated_at` is deliberately absent: the durable profile did not change, so its freshness stamp
 * — read by onboarding/activation staleness logic — must not move because a report ran.
 */
export const REPORT_OBSERVATION_WRITABLE_COLUMNS: readonly string[] = ['company_id', 'report_settings'];

/** A field the report resolved differently from the durable profile. Proposal only — never applied. */
export type ReportInputObservationField = {
  /** The value stored on the durable Company Profile at the time the report ran. */
  profile_value: string | null;
  /** The value this report run resolved from its form / stored report defaults. */
  observed_value: string | null;
  /** True when the two differ and the durable profile already held a value. */
  conflict: boolean;
};

/**
 * Recommendation-only record of what a report run would have written to the Company Profile.
 * Stored under `report_settings.report_input_observation`; consumed by nothing that ratifies.
 */
export type ReportInputObservation = {
  source: 'report_input_resolution';
  report_category: string;
  updated_at: string;
  /** Keyed by durable profile field name. Only fields that actually differ are present. */
  fields: Record<string, ReportInputObservationField>;
  /** True when at least one durable field disagrees with what the report resolved. */
  conflict: boolean;
};

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const listText = (value: unknown): string | null =>
  Array.isArray(value) ? text(value.filter(Boolean).join(', ')) : text(value);

/**
 * Build the proposal block. Pure.
 *
 * A field is reported only when the report resolved a value AND that value differs from the
 * durable profile. `conflict` is true only when the profile already held something — a field the
 * profile has never had is a gap the report can fill by proposal, not a disagreement.
 */
export function buildReportInputObservation(params: {
  profile: CompanyProfile | null;
  reportCategory: string;
  resolved: {
    companyName?: string | null;
    websiteDomain?: string | null;
    businessType?: string | null;
    geography?: string | null;
    competitors?: string[] | null;
    socialLinks?: string[] | null;
  };
  now?: string;
}): ReportInputObservation | null {
  const profile = params.profile;
  const candidates: Array<[string, string | null, string | null]> = [
    ['name', text(profile?.name), text(params.resolved.companyName)],
    ['website_url', text(profile?.website_url), text(params.resolved.websiteDomain)],
    ['category', text(profile?.category), text(params.resolved.businessType)],
    ['geography', text(profile?.geography), text(params.resolved.geography)],
    ['competitors', listText(profile?.competitors_list ?? profile?.competitors), listText(params.resolved.competitors)],
    [
      'social_profiles',
      listText((profile?.social_profiles ?? []).map((entry) => entry?.url).filter(Boolean)),
      listText(params.resolved.socialLinks),
    ],
  ];

  const fields: Record<string, ReportInputObservationField> = {};
  for (const [field, profileValue, observedValue] of candidates) {
    if (observedValue === null) continue;
    if (profileValue === observedValue) continue;
    fields[field] = {
      profile_value: profileValue,
      observed_value: observedValue,
      conflict: profileValue !== null,
    };
  }

  if (Object.keys(fields).length === 0) return null;

  return {
    source: 'report_input_resolution',
    report_category: params.reportCategory,
    updated_at: params.now ?? new Date().toISOString(),
    fields,
    conflict: Object.values(fields).some((entry) => entry.conflict),
  };
}

/**
 * THE TRIPWIRE, enforced at runtime and not only in tests.
 *
 * Every payload a report run sends to `company_profiles` passes through here. If a durable column
 * is ever re-added to the report write — by a merge, a refactor or a revert — this throws instead
 * of silently mutating the profile the ICP generator reads.
 */
export function assertReportObservationPayload(payload: Record<string, unknown>): void {
  const allowed = new Set(REPORT_OBSERVATION_WRITABLE_COLUMNS);
  const forbidden = Object.keys(payload).filter((key) => !allowed.has(key));
  if (forbidden.length > 0) {
    throw new Error(
      `Report generation may not write durable Company Profile fields: ${forbidden.sort().join(', ')}. `
        + `Permitted columns: ${REPORT_OBSERVATION_WRITABLE_COLUMNS.join(', ')}.`,
    );
  }
}
