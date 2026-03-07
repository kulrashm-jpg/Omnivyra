/**
 * Company API config: polling allowed by plan, validation.
 * Does not modify signal pipeline or intelligence workers.
 *
 * Polling frequency is currently advisory and will be used in future adaptive polling scheduler.
 * It controls priority and API execution ordering only; worker intervals are not modified.
 */

import { resolveOrganizationPlanLimits } from './planResolutionService';

export const POLLING_OPTIONS = ['realtime', '2h', '6h', 'daily', 'weekly'] as const;
export type PollingOption = (typeof POLLING_OPTIONS)[number];

/** Allowed polling by plan_key: basic → daily/weekly, pro → 6h/daily/weekly, enterprise → realtime/2h/6h/daily */
const ALLOWED_POLLING_BY_PLAN: Record<string, PollingOption[]> = {
  basic: ['daily', 'weekly'],
  pro: ['6h', 'daily', 'weekly'],
  professional: ['6h', 'daily', 'weekly'],
  enterprise: ['realtime', '2h', '6h', 'daily'],
};

/**
 * Get allowed polling options for a company (by plan).
 * Uses organizationId = companyId for plan resolution.
 */
export async function getAllowedPollingForCompany(
  companyId: string
): Promise<PollingOption[]> {
  const resolved = await resolveOrganizationPlanLimits(companyId);
  const planKey = (resolved.plan_key ?? 'basic').toLowerCase();
  const allowed = ALLOWED_POLLING_BY_PLAN[planKey];
  return allowed ?? ALLOWED_POLLING_BY_PLAN.basic;
}

/**
 * Return true if the given polling_frequency is allowed for the company's plan.
 */
export async function isPollingAllowedForCompany(
  companyId: string,
  pollingFrequency: string | null | undefined
): Promise<boolean> {
  if (!pollingFrequency || !pollingFrequency.trim()) return true;
  const allowed = await getAllowedPollingForCompany(companyId);
  return allowed.includes(pollingFrequency.trim() as PollingOption);
}

export const FILTER_KEYS = [
  'keywords',
  'topics',
  'competitors',
  'industries',
  'companies',
  'influencers',
  'technologies',
  'geography',
] as const;

export const MAX_VALUES_PER_FILTER_TYPE = 50;

/**
 * Normalize filter arrays: trim, lowercase, remove duplicates.
 * Example: [" OpenAI ", "openai", "Anthropic"] → ["openai", "anthropic"]
 */
export function normalizeFilterRecord(
  obj: Record<string, unknown> | null | undefined
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const key of FILTER_KEYS) {
    const val = (obj as Record<string, unknown>)[key];
    if (!Array.isArray(val)) continue;
    const normalized = [
      ...new Set(
        val
          .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : String(v).trim().toLowerCase()))
          .filter(Boolean)
      ),
    ];
    out[key] = normalized;
  }
  return out;
}

/**
 * Validate filter payload: max 50 values per filter type. Throws if exceeded.
 */
export function validateFilterLimits(
  include: Record<string, string[]>,
  exclude: Record<string, string[]>
): { ok: true } | { ok: false; error: string } {
  for (const key of FILTER_KEYS) {
    const incLen = include[key]?.length ?? 0;
    const excLen = exclude[key]?.length ?? 0;
    if (incLen > MAX_VALUES_PER_FILTER_TYPE) {
      return {
        ok: false,
        error: `include_filters.${key} exceeds maximum of ${MAX_VALUES_PER_FILTER_TYPE} values`,
      };
    }
    if (excLen > MAX_VALUES_PER_FILTER_TYPE) {
      return {
        ok: false,
        error: `exclude_filters.${key} exceeds maximum of ${MAX_VALUES_PER_FILTER_TYPE} values`,
      };
    }
  }
  return { ok: true };
}
