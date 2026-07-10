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
  // Absolute low-balance ladder (owner policy 2026-07-10): <100 / <50 / <20.
  | 'low_100' | 'low_50' | 'low_20'
  // Burn-velocity email (owner policy 2026-07-10): balance < 200 AND ≥ 100
  // credits consumed in the past 7 days — top-up nudge BEFORE disruption.
  | 'velocity_200'
  // Legacy types — retained for credit_alert_log history/dedup continuity.
  | 'low_20pct' | 'low_10pct'
  | 'depleted' | 'auto_topup'
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
/**
 * ABSOLUTE low-balance ladder (owner policy 2026-07-10):
 *   low_100  → balance < 100 credits  (early warning)
 *   low_50   → balance <  50 credits
 *   low_20   → balance <  20 credits  (last warning before depletion)
 *   depleted → balance <=  0
 * NO alert at 200 (explicitly removed). Thresholds are absolute credit
 * counts, not percentages of an allotment.
 *
 * Ordered MOST-SEVERE-FIRST: the loop below sends only the first breached
 * alert, so severity order guarantees a balance of e.g. 15 sends the
 * "below 20" warning — not a milder one. (The original mildest-first order
 * meant the severest alert could never fire: any low balance was swallowed
 * by the mildest notice + 24h dedup.)
 */
const THRESHOLDS: Array<{ type: AlertType; credits: number; breached: (balance: number, threshold: number) => boolean; message: string }> = [
  { type: 'depleted', credits: 0,   breached: (b, t) => b <= t, message: 'Credits depleted. Autonomous campaign system is paused.' },
  { type: 'low_20',   credits: 20,  breached: (b, t) => b < t,  message: 'Your credits are below 20 — top up now to keep content and campaigns running.' },
  { type: 'low_50',   credits: 50,  breached: (b, t) => b < t,  message: 'Your credits are below 50 — top up soon to avoid interruptions.' },
  { type: 'low_100',  credits: 100, breached: (b, t) => b < t,  message: 'Your credits are below 100 — consider topping up.' },
];

const DEDUP_HOURS = 24;

// ── Email escalation (owner policy 2026-07-10) ───────────────────────────────
/** Ladder levels that ALSO send an email to the company admin (not just in-app). */
const EMAIL_LEVELS: ReadonlySet<AlertType> = new Set(['low_20', 'depleted']);
/** Velocity email: balance below this … */
const VELOCITY_BALANCE_THRESHOLD = 200;
/** … while at least this many credits were consumed in the past 7 days. */
const VELOCITY_WEEKLY_CONSUMPTION = 100;
/** Velocity email fires at most once per week per org. */
const VELOCITY_DEDUP_HOURS = 7 * 24;

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

async function wasAlertRecentlySent(orgId: string, alertType: AlertType, dedupHours = DEDUP_HOURS): Promise<boolean> {
  const since = new Date(Date.now() - dedupHours * 3600_000).toISOString();
  const { data } = await ownedDbTable('credit_alert_log')
    .select('id')
    .eq('organization_id', orgId)
    .eq('alert_type', alertType)
    .gte('notified_at', since)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/** Company-admin email (oldest owner/admin role; same resolution as the forecast email). */
async function resolveAdminEmail(orgId: string): Promise<string | null> {
  const { data: roles } = await ownedDbTable('user_company_roles')
    .select('user_id, role, created_at')
    .eq('company_id', orgId)
    .eq('status', 'active');
  const list = (roles ?? []) as Array<{ user_id: string; role: string; created_at: string }>;
  if (list.length === 0) return null;
  const sorted = list.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const admin = sorted.find((r) => /owner|admin/i.test(String(r.role ?? ''))) ?? sorted[0];
  if (!admin?.user_id) return null;
  const { data: u } = await ownedDbTable('users')
    .select('email')
    .eq('id', admin.user_id)
    .maybeSingle();
  return (u as { email?: string } | null)?.email ?? null;
}

/** Actual credits consumed in the past 7 days (settled amounts: confirm-phase rows). */
async function getWeeklyConsumption(orgId: string): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data } = await ownedDbTable('credit_transactions')
    .select('credits_delta, free_delta, paid_delta, incentive_delta')
    .eq('organization_id', orgId)
    .eq('execution_phase', 'confirm')
    .gte('created_at', since);
  let total = 0;
  for (const row of (data ?? []) as Array<Record<string, number | null>>) {
    // Confirm rows record the ACTUAL settled cost; bucket deltas are the
    // authoritative amounts (credits_delta can be 0 on remainder-only settles).
    const byBuckets = Math.abs(row.free_delta ?? 0) + Math.abs(row.paid_delta ?? 0) + Math.abs(row.incentive_delta ?? 0);
    total += byBuckets > 0 ? byBuckets : Math.abs(row.credits_delta ?? 0);
  }
  return total;
}

/** Best-effort admin email for an alert level — never blocks or throws. */
async function sendAlertEmail(orgId: string, alertType: AlertType, balance: number, weeklyConsumed: number): Promise<void> {
  try {
    const recipient = await resolveAdminEmail(orgId);
    if (!recipient) return;
    const { sendCreditAlert } = await import('./emailService');
    const pool = weeklyConsumed + Math.max(0, balance);
    await sendCreditAlert(
      {
        recipientEmail: recipient,
        companyName: null,
        consumedPercent: pool > 0 ? Math.min(100, Math.round((weeklyConsumed / pool) * 100)) : 100,
        remainingCredits: Math.max(0, Math.round(balance)),
        projectedRequiredCredits: Math.round(weeklyConsumed),
        ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://www.omnivyra.com'}/company/billing`,
      },
      `credit_alert:${orgId}:${alertType}:${new Date().toISOString().slice(0, 10)}`,
    );
  } catch (err) {
    console.warn(`[creditAlert] email send failed for org ${orgId} / ${alertType}`, (err as Error)?.message);
  }
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
 * `_referenceAllotment` is retained for caller compatibility but unused:
 * thresholds are absolute credit counts (owner policy 2026-07-10).
 */
export async function checkCreditAlerts(
  orgId: string,
  _referenceAllotment?: number,
): Promise<CreditAlertResult> {
  const balance = await getBalance(orgId);
  if (balance === null) {
    return { balance: 0, alerts_fired: [], alerts_suppressed: [] };
  }

  const fired:      AlertType[] = [];
  const suppressed: AlertType[] = [];

  for (const { type, credits, breached, message } of THRESHOLDS) {
    if (!breached(balance, credits)) continue;

    const alreadySent = await wasAlertRecentlySent(orgId, type);
    if (alreadySent) {
      // The most severe breached alert was already sent within the dedup
      // window — do NOT fall through and fire a MILDER one on top of it.
      suppressed.push(type);
      break;
    }

    await recordAlert(orgId, type, balance);
    await sendAlert(orgId, type, message);
    // Escalation levels (below 20 / depleted) ALSO email the company admin.
    if (EMAIL_LEVELS.has(type)) {
      await sendAlertEmail(orgId, type, balance, await getWeeklyConsumption(orgId).catch(() => 0));
    }
    fired.push(type);

    // Send only the most severe newly-breached alert (list is severity-ordered).
    break;
  }

  // ── Burn-velocity email (owner policy 2026-07-10) ─────────────────────────
  // Balance below 200 AND ≥ 100 credits consumed in the past 7 days → email
  // the admin so they can top up BEFORE the ladder alerts start firing.
  // Independent of the ladder (in-app) alerts; at most once per week per org.
  if (balance > 0 && balance < VELOCITY_BALANCE_THRESHOLD) {
    try {
      const alreadySent = await wasAlertRecentlySent(orgId, 'velocity_200', VELOCITY_DEDUP_HOURS);
      if (!alreadySent) {
        const weeklyConsumed = await getWeeklyConsumption(orgId);
        if (weeklyConsumed >= VELOCITY_WEEKLY_CONSUMPTION) {
          await recordAlert(orgId, 'velocity_200', balance); // dedup BEFORE send
          await sendAlertEmail(orgId, 'velocity_200', balance, weeklyConsumed);
          fired.push('velocity_200');
        }
      }
    } catch (err) {
      console.warn(`[creditAlert] velocity check failed for org ${orgId}`, (err as Error)?.message);
    }
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
