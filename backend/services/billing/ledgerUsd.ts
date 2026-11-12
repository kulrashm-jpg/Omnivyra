/**
 * USD for a ledger charge, at READ time (e9 ruling b, 2026-11-12, BLOCKING).
 *
 * Settlement rows written by apply_credit_reservation / the live
 * apply_credit_partial_confirm carry NO usd_equivalent, so every reader that
 * summed it billed those charges at $0. The ledger is immutable and is NEVER
 * rewritten: a row without a recorded USD gets one DERIVED here, and the figure
 * is marked ESTIMATED wherever it is shown.
 *
 * RATE: there is no credit-rate history (organization_credits.credit_rate_usd
 * holds only the current rate), so a derived figure uses the org's CURRENT
 * rate and is always estimated. If a rate-history table is added, resolve the
 * rate in effect at the row's created_at here and keep the label for rows that
 * still fall back to the current rate.
 */
import { supabase } from '../../db/supabaseClient';

/** The schema default of organization_credits.credit_rate_usd. */
export const DEFAULT_CREDIT_RATE_USD = 0.01;

export interface RowUsd {
  usd: number;
  /** true when the USD was derived at read time (not recorded on the row). */
  estimated: boolean;
}

/** A failed read THROWS: a reader must not price a charge from a guessed rate. */
export async function loadCurrentCreditRateUsd(organizationId: string): Promise<number> {
  const { data, error } = await supabase
    .from('organization_credits')
    .select('credit_rate_usd')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`[ledgerUsd] credit rate read failed for ${organizationId}: ${error.message}`);
  const rate = Number((data as { credit_rate_usd?: number | null } | null)?.credit_rate_usd);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_CREDIT_RATE_USD;
}

export function rowUsd(row: { usd_equivalent?: number | string | null; credits_delta?: number | string | null }, currentRate: number): RowUsd {
  if (row.usd_equivalent !== null && row.usd_equivalent !== undefined) {
    return { usd: Number(row.usd_equivalent), estimated: false };
  }
  return { usd: Math.abs(Number(row.credits_delta ?? 0)) * currentRate, estimated: true };
}

/** Whether any row needs a derived (estimated) USD - load the rate only then. */
export function needsDerivedUsd(rows: Array<{ usd_equivalent?: unknown }>): boolean {
  return rows.some((r) => r.usd_equivalent === null || r.usd_equivalent === undefined);
}

export const ESTIMATED_USD_LABEL = 'USD estimated at the current credit rate (no USD recorded on the charge)';
