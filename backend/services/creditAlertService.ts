import { ownedDbTable } from '../db/writeOwner';
/**
 * Credit Alert Service — Step 8
 *
 * Monitors organization credit balances and sends alerts at thresholds.
 * Deduplicates using the `credit_alert_log` table — each alert type
 * fires at most once per day per organization.
 *
 * Alert levels:
 *   - low_20pct   → balance < 20% of the organization's starting/purchased credits
 *   - low_10pct   → balance < 10% (critical — take action now)
 *   - depleted    → balance = 0 (autonomous system pauses)
 *   - auto_topup  → fired when auto top-up purchase is triggered (placeholder hook)
 *
 * Integration:
 *   Call `checkCreditAlerts(orgId)` from the autonomous scheduler or after
 *   each credit deduction. It is fast (reads one row, inserts at most once)
 *   and safe to call frequently.
 */

import { supabase } from '../db/supabaseClient';

export type AlertType =
  | 'low_20pct' | 'low_10pct' | 'depleted' | 'auto_topup'
  // Consumption-based warnings (approved policy) — deduped per billing cycle.
  | 'consumed_80' | 'consumed_90' | 'consumed_95' | 'forecast_insufficient_85';

const CONSUMED_ALERT_BY_THRESHOLD: Record<number, AlertType> = { 80: 'consumed_80', 90: 'consumed_90', 95: 'consumed_95' };

/** Which consumed_80/90/95 alerts have already fired for this org since `sinceIso` (cycle start). */
export async function getFiredConsumptionThresholds(orgId: string, sinceIso: string): Promise<number[]> {
  const { data } = await ownedDbTable('credit_alert_log')
    .select('alert_type')
    .eq('organization_id', orgId)
    .in('alert_type', ['consumed_80', 'consumed_90', 'consumed_95'])
    .gte('notified_at', sinceIso);
  const fired = new Set((data ?? []).map((r: any) => r.alert_type));
  return [80, 90, 95].filter((t) => fired.has(CONSUMED_ALERT_BY_THRESHOLD[t]));
}

/** Emit a consumption in-app warning + record it (dedup). */
export async function emitConsumptionAlert(orgId: string, threshold: number, consumedPct: number): Promise<void> {
  const type = CONSUMED_ALERT_BY_THRESHOLD[threshold];
  if (!type) return;
  await ownedDbTable('credit_alert_log').insert({ organization_id: orgId, alert_type: type, balance_at_alert: Math.round(consumedPct), notified_at: new Date().toISOString() });
  try {
    await ownedDbTable('notifications').insert({
      organization_id: orgId, type: 'credit_alert', category: type,
      message: `You have used ${threshold}% of this cycle's credits.`, read: false, created_at: new Date().toISOString(),
    });
  } catch { /* notifications table optional */ }
}

/** Whether the low-credit forecast email already went out this cycle. */
export async function wasForecastEmailSent(orgId: string, sinceIso: string): Promise<boolean> {
  const { data } = await ownedDbTable('credit_alert_log')
    .select('id').eq('organization_id', orgId).eq('alert_type', 'forecast_insufficient_85').gte('notified_at', sinceIso).limit(1).maybeSingle();
  return !!data;
}

/** Record that the forecast email fired (per-cycle dedup). */
export async function recordForecastEmail(orgId: string, consumedPct: number): Promise<void> {
  await ownedDbTable('credit_alert_log').insert({ organization_id: orgId, alert_type: 'forecast_insufficient_85', balance_at_alert: Math.round(consumedPct), notified_at: new Date().toISOString() });
}

export type CreditAlertResult = {
  balance: number;
  alerts_fired: AlertType[];
  alerts_suppressed: AlertType[]; // already sent today
};

// ── Configurable thresholds ───────────────────────────────────────────────────

/** Credits considered a "full" allotment — alerts are percentage-based. */
const REFERENCE_CREDIT_ALLOTMENT = 1000;

const THRESHOLDS: Array<{ type: AlertType; pct: number; message: string }> = [
  { type: 'low_20pct', pct: 0.20, message: 'Credit balance is below 20% — consider topping up.' },
  { type: 'low_10pct', pct: 0.10, message: 'Credit balance is critically low (<10%)! Autonomous features may be limited.' },
  { type: 'depleted',  pct: 0.00, message: 'Credits depleted. Autonomous campaign system is paused.' },
];

const DEDUP_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getBalance(orgId: string): Promise<number | null> {
  const { data } = await ownedDbTable('organization_credits')
    .select('free_balance, paid_balance, incentive_balance')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!data) return null;
  const d = data as any;
  return (d.free_balance ?? 0) + (d.paid_balance ?? 0) + (d.incentive_balance ?? 0);
}

async function wasAlertRecentlySent(orgId: string, alertType: AlertType): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_HOURS * 3600_000).toISOString();
  const { data } = await ownedDbTable('credit_alert_log')
    .select('id')
    .eq('organization_id', orgId)
    .eq('alert_type', alertType)
    .gte('notified_at', since)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function recordAlert(orgId: string, alertType: AlertType, balance: number): Promise<void> {
  await ownedDbTable('credit_alert_log').insert({
    organization_id: orgId,
    alert_type:      alertType,
    balance_at_alert: balance,
    notified_at:     new Date().toISOString(),
  });
}

/** Send an in-app notification for a credit alert. */
async function sendAlert(orgId: string, alertType: AlertType, message: string): Promise<void> {
  try {
    await ownedDbTable('notifications').insert({
      organization_id: orgId,
      type:            'credit_alert',
      category:        alertType,
      message,
      read:            false,
      created_at:      new Date().toISOString(),
    });
  } catch {
    // Non-fatal — notifications table may not exist yet
    console.warn(`[creditAlert] Notification insert failed for org ${orgId} / ${alertType}`);
  }
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Check credit balance for an org and fire alerts if thresholds are crossed.
 * Safe to call frequently — deduplicates within a 24-hour window.
 */
export async function checkCreditAlerts(
  orgId: string,
  referenceAllotment = REFERENCE_CREDIT_ALLOTMENT,
): Promise<CreditAlertResult> {
  const balance = await getBalance(orgId);
  if (balance === null) {
    return { balance: 0, alerts_fired: [], alerts_suppressed: [] };
  }

  const fired:      AlertType[] = [];
  const suppressed: AlertType[] = [];

  for (const { type, pct, message } of THRESHOLDS) {
    const threshold = Math.floor(referenceAllotment * pct);
    if (balance > threshold) continue; // not breached

    const alreadySent = await wasAlertRecentlySent(orgId, type);
    if (alreadySent) {
      suppressed.push(type);
      continue;
    }

    await recordAlert(orgId, type, balance);
    await sendAlert(orgId, type, message);
    fired.push(type);

    // Stop after the first new alert (depleted implies low_10pct implies low_20pct)
    break;
  }

  return { balance, alerts_fired: fired, alerts_suppressed: suppressed };
}

/**
 * Fire an auto_topup alert (called by billing service when purchase is triggered).
 */
export async function recordAutoTopup(orgId: string, balance: number): Promise<void> {
  await recordAlert(orgId, 'auto_topup', balance);
  await sendAlert(orgId, 'auto_topup', 'Credits auto-topped up successfully.');
}
