/**
 * Phase 9B — company credit experience: PURE presentation transforms.
 *
 * No React, no I/O — derives display values from data already returned by the
 * existing company billing services (no duplicated accounting). Importable by
 * the page and by unit tests under either tsconfig project.
 *
 * Customer-facing vocabulary only: Available / Reserved (Provisional) /
 * Consumed / Settled. No HOLD/CONFIRM/RELEASE jargon.
 */

export interface WalletLike {
  freeBalance: number;
  paidBalance: number;
  incentiveBalance: number;
  reservedFree: number;
  reservedPaid: number;
  reservedIncentive: number;
  lifetimePurchased: number;
  lifetimeConsumed: number;
  totalAvailable?: number;
}

export interface CompanyCreditSummary {
  /** Spendable balance the org holds (free + paid + bonus). */
  availableCredits: number;
  /** Provisional, in-flight reservations — not yet a firm charge. */
  reservedCredits: number;
  /** Lifetime settled consumption. */
  consumedCredits: number;
  /** Lifetime purchased. */
  totalPurchasedCredits: number;
  /** Bonus / promotional credit balance. */
  totalBonusCredits: number;
  /** What can actually start NEW work: available − reserved (admission basis). */
  effectiveCredits: number;
}

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Task 1 — derive the company credit summary from the billing-summary wallet. */
export function summarizeCompanyCredits(w: WalletLike): CompanyCreditSummary {
  const reserved = n(w.reservedFree) + n(w.reservedPaid) + n(w.reservedIncentive);
  const grossBalance = n(w.freeBalance) + n(w.paidBalance) + n(w.incentiveBalance);
  return {
    availableCredits: grossBalance,
    reservedCredits: reserved,
    consumedCredits: n(w.lifetimeConsumed),
    totalPurchasedCredits: n(w.lifetimePurchased),
    totalBonusCredits: n(w.incentiveBalance),
    effectiveCredits: Math.max(0, grossBalance - reserved),
  };
}

export interface LedgerRowLike {
  execution_phase: string;
  credits_delta: number;
  reference_type: string | null;
}

export interface ActivityHistoryGroup {
  activity: string;
  /** Credits consumed (settled charges). */
  consumed: number;
  /** Credits currently reserved (provisional). */
  reserved: number;
  /** Credits released back to the wallet. */
  released: number;
  /** Number of settlement events. */
  settlements: number;
  events: number;
}

/**
 * Task 4 — group ledger rows by activity into consumption / reservations /
 * releases / settlements. Phases map to customer terms:
 *   confirm → consumed (settled)   hold → reserved (provisional)   release → released
 */
export function groupCreditHistoryByActivity(rows: LedgerRowLike[]): ActivityHistoryGroup[] {
  const m = new Map<string, ActivityHistoryGroup>();
  for (const r of rows) {
    const activity = r.reference_type ?? 'unknown';
    const g = m.get(activity) ?? { activity, consumed: 0, reserved: 0, released: 0, settlements: 0, events: 0 };
    const mag = Math.abs(n(r.credits_delta));
    g.events += 1;
    if (r.execution_phase === 'confirm') {
      g.consumed += mag;
      g.settlements += 1;
    } else if (r.execution_phase === 'hold') {
      g.reserved += mag;
    } else if (r.execution_phase === 'release') {
      g.released += mag;
    }
    m.set(activity, g);
  }
  return Array.from(m.values()).sort((a, b) => b.consumed - a.consumed);
}
