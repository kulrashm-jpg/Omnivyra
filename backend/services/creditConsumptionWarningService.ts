/**
 * creditConsumptionWarningService.ts
 *
 * Consumption-based credit warnings per approved policy:
 *  • Session warnings at 80% / 90% / 95% consumed — once per threshold per billing cycle.
 *  • Low-credit forecast EMAIL when consumed ≥ 85% AND the forecast predicts insufficient credits
 *    before period end — once per billing cycle, idempotent.
 *
 * Reuses the EXISTING forecast engine (`creditAdvisor/creditForecastService`) — no second
 * forecasting system. In-app warnings reuse the `creditAlertService` notification + dedup pattern
 * (`credit_alert_log`). Pure decision helpers are hermetically testable; the orchestrator wires
 * loaders + the existing alert/email sinks.
 */

export const CONSUMPTION_THRESHOLDS = [80, 90, 95] as const;
export type ConsumptionThreshold = (typeof CONSUMPTION_THRESHOLDS)[number];

export const EMAIL_MIN_CONSUMED_PCT = 85;

/**
 * PURE: which 80/90/95 thresholds are NEWLY crossed (not previously fired this cycle).
 * `alreadyFired` = thresholds already alerted in the current billing cycle.
 */
export function newlyCrossedThresholds(consumedPct: number, alreadyFired: number[]): ConsumptionThreshold[] {
  const fired = new Set(alreadyFired);
  return CONSUMPTION_THRESHOLDS.filter((t) => consumedPct >= t && !fired.has(t));
}

/** PURE: the highest single threshold to SHOW this session (avoid stacking 80+90+95 at once). */
export function sessionWarningToShow(consumedPct: number, alreadyFired: number[]): ConsumptionThreshold | null {
  const newly = newlyCrossedThresholds(consumedPct, alreadyFired);
  return newly.length ? newly[newly.length - 1] : null; // highest newly-crossed
}

export interface ForecastSignal {
  /** the existing engine's verdict: will remaining credits run out before period end? */
  insufficientBeforePeriodEnd: boolean;
}

/**
 * PURE: should the low-credit forecast EMAIL fire? consumed ≥ 85% AND forecast insufficient AND
 * not already sent this cycle. (Not merely 80% reached — requires the forecast conjunction.)
 */
export function shouldSendLowCreditEmail(
  consumedPct: number,
  forecast: ForecastSignal,
  alreadySentThisCycle: boolean,
): boolean {
  return consumedPct >= EMAIL_MIN_CONSUMED_PCT && forecast.insufficientBeforePeriodEnd && !alreadySentThisCycle;
}

// ── Orchestrator (loaders + sinks injected) ──────────────────────────────────
export interface WarningDeps {
  /** current cycle consumption percentage (0–100) */
  getConsumedPct: (orgId: string) => Promise<number>;
  /** thresholds already fired this cycle (from credit_alert_log / equivalent) */
  getFiredThresholds: (orgId: string) => Promise<number[]>;
  /** existing forecast engine verdict */
  getForecast: (orgId: string) => Promise<ForecastSignal>;
  /** whether the low-credit email already went out this cycle */
  emailAlreadySent: (orgId: string) => Promise<boolean>;
  /** emit an in-app warning (creditAlertService-style insert + dedup record) */
  emitInApp: (orgId: string, threshold: ConsumptionThreshold, consumedPct: number) => Promise<void>;
  /** send the low-credit forecast email (idempotent per cycle) */
  sendEmail: (orgId: string, consumedPct: number) => Promise<void>;
}

export interface WarningOutcome {
  consumedPct: number;
  inAppFired: ConsumptionThreshold[];
  emailSent: boolean;
}

/** Evaluate + emit warnings for one org. In-app: each newly-crossed threshold once; email: gated. */
export async function evaluateConsumptionWarnings(orgId: string, deps: WarningDeps): Promise<WarningOutcome> {
  const consumedPct = await deps.getConsumedPct(orgId);
  const fired = await deps.getFiredThresholds(orgId);

  const toFire = newlyCrossedThresholds(consumedPct, fired);
  for (const t of toFire) await deps.emitInApp(orgId, t, consumedPct);

  let emailSent = false;
  const forecast = await deps.getForecast(orgId);
  if (shouldSendLowCreditEmail(consumedPct, forecast, await deps.emailAlreadySent(orgId))) {
    await deps.sendEmail(orgId, consumedPct);
    emailSent = true;
  }

  return { consumedPct, inAppFired: toFire, emailSent };
}

// ── Runtime wiring (real deps) ───────────────────────────────────────────────
// Lazy/defensive imports so a failure here never affects the deduction path.

function daysLeftInMonth(now: Date): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(0, end - now.getDate());
}

/**
 * RUNTIME entry: compute real consumption % + reuse the existing forecast engine, then emit
 * warnings. Per-cycle dedup (calendar month) via `creditAlertService`. Best-effort — callers
 * (e.g. the post-deduction hook) should swallow errors. Reuses
 * `consumptionMetricsService` + `creditForecastService` (NO new forecaster). No balance writes.
 */
export async function notifyConsumptionWarnings(orgId: string): Promise<WarningOutcome> {
  const { getWalletOverview, computeConsumptionMetrics } = await import('./creditAdvisor/consumptionMetricsService');
  const { computeForecast } = await import('./creditAdvisor/creditForecastService');
  const alert = await import('./creditAlertService');
  const { sendCreditAlert } = await import('./emailService');
  const { supabase } = await import('../db/supabaseClient');
  const { config } = await import('@/config');

  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const overview: any = await getWalletOverview(orgId);
  const metrics: any = await computeConsumptionMetrics(orgId);
  const remaining: number = Number(metrics?.credits_remaining ?? overview?.remaining ?? 0);
  const used: number = Number(metrics?.credits_used_30d ?? 0);
  const consumedPct = used + remaining > 0 ? (used / (used + remaining)) * 100 : 0;

  const forecast: any = computeForecast(metrics, used);
  const insufficient = Number(forecast?.projected_month_end_balance ?? 0) < 0;

  const appUrl = (config.NEXT_PUBLIC_APP_URL || config.APP_URL || 'https://www.omnivyra.com').replace(/\/$/, '');

  const resolveAdminEmail = async (): Promise<string | null> => {
    const roles = (await supabase.from('user_company_roles').select('user_id, role, created_at').eq('company_id', orgId).eq('status', 'active')).data ?? [];
    const sorted = roles.slice().sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    const admin = sorted.find((r: any) => /owner|admin/i.test(String(r.role ?? ''))) ?? sorted[0];
    if (!admin?.user_id) return null;
    const u = (await supabase.from('users').select('email').eq('id', admin.user_id).maybeSingle()).data;
    return (u as any)?.email ?? null;
  };

  const deps: WarningDeps = {
    getConsumedPct: async () => consumedPct,
    getFiredThresholds: async () => alert.getFiredConsumptionThresholds(orgId, cycleStart),
    getForecast: async () => ({ insufficientBeforePeriodEnd: insufficient }),
    emailAlreadySent: async () => alert.wasForecastEmailSent(orgId, cycleStart),
    emitInApp: async (_o, t, pct) => alert.emitConsumptionAlert(orgId, t, pct),
    sendEmail: async (_o, pct) => {
      const recipient = await resolveAdminEmail();
      if (!recipient) return;
      await alert.recordForecastEmail(orgId, pct); // dedup BEFORE send (idempotent per cycle)
      const projectedRequired = Math.max(0, Math.round(Number(metrics?.daily_burn_rate ?? 0) * daysLeftInMonth(now)));
      await sendCreditAlert(
        { recipientEmail: recipient, companyName: null, consumedPercent: Math.round(pct), remainingCredits: Math.round(remaining), projectedRequiredCredits: projectedRequired, ctaUrl: `${appUrl}/company/billing` },
        `credit_alert:${orgId}:${cycleStart.slice(0, 7)}`,
      );
    },
  };

  return evaluateConsumptionWarnings(orgId, deps);
}
