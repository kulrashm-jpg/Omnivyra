/**
 * Market Pulse charging (owner ruling via e9, 2026-11-13): each region LLM call is charged as ONE
 * `insight_generation` - token-priced through runBilledAiCompletion (hold -> execute -> confirm_partial), so the
 * charge is max(cost_usd x multiplier, minimum_charge_usd) / the org's credit_rate_usd: the 8-credit floor at the
 * standard $0.01 rate. Rates are resolved by pricingService exactly as every other token-priced billed path; this
 * module never reads a rate itself.
 *
 *  - whole-scan PRE-CHECK: regions x the floor credits (resolveActivityCreditRange, the same math as the hold) must
 *    be available, else the scan is skipped (no LLM call, nothing charged) and the company admins are notified.
 *    If the shared pricing resolver itself fails, the scan fails CLOSED (skipped, never run uncharged).
 *  - per-region idempotency: (job, region) -> a retried region is never double-charged, and two different regions
 *    are never deduplicated against each other. (The 3600s smart-mode dedup lives only in the legacy deduct path,
 *    not in the orchestrator this uses.)
 *  - settlement: the credits actually charged per region are recorded on the job's region_results and summed into
 *    market_pulse_runs.credits_consumed by syncLegacyJobIntoRun.
 *  - never negative: confirm_partial's underfunded case pulls only what the wallet holds (no negative carry).
 */
import { ownedDbTable } from '../../db/writeOwner';
import { resolveActivityCreditRange } from '../pricingService';
import { getTotalAvailable } from '../creditPriorityService';

export const MARKET_PULSE_CREDIT_ACTION = 'insight_generation' as const;

export type MarketPulseScanPrecheck =
  | { ok: true; perRegionCredits: number; requiredCredits: number; availableCredits: number }
  | { ok: false; reason: 'insufficient_credits'; perRegionCredits: number; requiredCredits: number; availableCredits: number }
  | { ok: false; reason: 'no_credit_account' | 'pricing_unavailable'; detail?: string };

/** The refusal arm (an explicit type: `!check.ok` does not narrow without strictNullChecks). */
export type MarketPulseScanShortfall = Exclude<MarketPulseScanPrecheck, { ok: true }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The billing actor: the triggering user when it is a real user id, else the org itself (system sentinel). */
export function resolveMarketPulseBillingUser(companyId: string, triggeredByUserId: unknown): string {
  return typeof triggeredByUserId === 'string' && UUID_RE.test(triggeredByUserId) ? triggeredByUserId : companyId;
}

export async function precheckMarketPulseScan(companyId: string, regionCount: number): Promise<MarketPulseScanPrecheck> {
  let perRegionCredits: number;
  try {
    const range = await resolveActivityCreditRange(MARKET_PULSE_CREDIT_ACTION, companyId);
    perRegionCredits = range.minCredits;
  } catch (err) {
    return { ok: false, reason: 'pricing_unavailable', detail: err instanceof Error ? err.message : String(err) };
  }
  const available = await getTotalAvailable(companyId);
  if (available == null) return { ok: false, reason: 'no_credit_account' };
  const requiredCredits = perRegionCredits * Math.max(1, regionCount);
  if (available < requiredCredits) {
    return { ok: false, reason: 'insufficient_credits', perRegionCredits, requiredCredits, availableCredits: available };
  }
  return { ok: true, perRegionCredits, requiredCredits, availableCredits: available };
}

export function describeMarketPulseShortfall(check: MarketPulseScanShortfall): string {
  if (check.reason === 'insufficient_credits') {
    return `insufficient_credits: Market Pulse needs ${check.requiredCredits} credits (${check.perRegionCredits} per region) but ${check.availableCredits} are available`;
  }
  if (check.reason === 'no_credit_account') return 'no_credit_account: this company has no credit account';
  return 'pricing_unavailable: Market Pulse pricing could not be resolved; the scan was not run and nothing was charged';
}

/** In-app notice to the company's admins (same notifications row shape as credit alerts). Never throws. */
export async function notifyMarketPulseSkipped(companyId: string, message: string): Promise<void> {
  try {
    await ownedDbTable('notifications').insert({
      organization_id: companyId,
      type:            'credit_alert',
      category:        'market_pulse_skipped',
      message:         `Market Pulse scan skipped - ${message}`,
      read:            false,
      created_at:      new Date().toISOString(),
    });
  } catch {
    console.warn(`[marketPulse] skipped-scan notification failed for org ${companyId}`);
  }
}

export type MarketPulseRegionIssueCode = 'INSUFFICIENT_CREDITS' | 'CHARGED_NO_OUTPUT' | 'ALREADY_RELEASED';
export type MarketPulseRegionIssue = {
  region: string;
  code: MarketPulseRegionIssueCode | null;
  charged: boolean;
  message: string | null;
};

const ISSUE_CODES: ReadonlySet<string> = new Set(['INSUFFICIENT_CREDITS', 'CHARGED_NO_OUTPUT', 'ALREADY_RELEASED']);

/**
 * The failed regions of a job's region_results, for the run view (UI tab, 2026-11-13): only error entries, with the
 * same codes the processor writes (null for an uncoded failure such as an LLM error). Successful regions are omitted.
 */
export function extractRegionIssues(regionResults: unknown): MarketPulseRegionIssue[] {
  if (!regionResults || typeof regionResults !== 'object') return [];
  const issues: MarketPulseRegionIssue[] = [];
  for (const [region, entry] of Object.entries(regionResults as Record<string, unknown>)) {
    const e = entry as { error?: unknown; code?: unknown; charged?: unknown; message?: unknown } | null;
    if (!e || e.error !== true) continue;
    issues.push({
      region,
      code: typeof e.code === 'string' && ISSUE_CODES.has(e.code) ? (e.code as MarketPulseRegionIssueCode) : null,
      charged: e.charged === true,
      message: typeof e.message === 'string' ? e.message : null,
    });
  }
  return issues;
}

/** Sum of credits charged across a job's region_results (entries without credits_charged count 0). */
export function sumRegionCreditsCharged(regionResults: unknown): number {
  if (!regionResults || typeof regionResults !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(regionResults as Record<string, unknown>)) {
    const n = Number((entry as { credits_charged?: unknown } | null)?.credits_charged ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}
