/**
 * Commercial reconciliation (§B/§C) — repair "paid-but-unfulfilled" top-up
 * purchases (status='completed' AND fulfillment_status != 'completed'), which
 * can occur if credit allocation failed AFTER the status flip in completePurchase.
 *
 * Repair goes through `fulfillProviderConfirmedPurchase` — the one settlement
 * gate — rather than calling `completePurchase` directly. That matters for more
 * than tidiness: the gate re-resolves the provider and re-validates amount and
 * currency, so reconciliation cannot become a side door that settles a purchase
 * the verify/webhook paths would refuse. Beyond the gate it is the same
 * idempotent fulfillment (`createCredit` with the deterministic key + idempotent
 * invoice generation) → never double-grants, never duplicate invoices, safe to
 * run repeatedly.
 *
 * Consequence worth knowing: if the provider is unreachable, a repair defers
 * rather than completing, and the next sweep retries. Delay, not loss.
 *
 * Read-only in dry-run.
 */
import { supabase } from '../../db/supabaseClient';
import { fulfillProviderConfirmedPurchase } from './purchaseClosureService';

export type ReconScopeKind = 'single' | 'org' | 'global';

export interface ReconScope {
  kind: ReconScopeKind;
  purchaseId?: string;
  orgId?: string;
}

export interface ReconDetail {
  purchaseId: string;
  organizationId: string;
  action: 'would_repair' | 'repaired' | 'skipped' | 'already_healthy';
  detail?: string;
}

export interface ReconResult {
  scope: ReconScopeKind;
  dryRun: boolean;
  found: number;
  repaired: number;
  skipped: number;
  alreadyHealthy: number;
  details: ReconDetail[];
}

const MAX = 500;

async function findPaidUnfulfilled(scope: ReconScope) {
  let q = supabase
    .from('credit_purchases')
    .select('id, organization_id, reference_id, status, fulfillment_status')
    .eq('status', 'completed')
    .neq('fulfillment_status', 'completed')
    .limit(MAX);
  if (scope.kind === 'single' && scope.purchaseId) q = q.eq('id', scope.purchaseId);
  if (scope.kind === 'org' && scope.orgId) q = q.eq('organization_id', scope.orgId);
  const { data } = await q;
  return (data ?? []) as Array<{ id: string; organization_id: string; reference_id: string | null; fulfillment_status: string | null }>;
}

export async function reconcile(scope: ReconScope, dryRun = true): Promise<ReconResult> {
  const details: ReconDetail[] = [];
  let repaired = 0;
  let skipped = 0;
  let alreadyHealthy = 0;

  // For a single purchase, surface the already-healthy case explicitly.
  if (scope.kind === 'single' && scope.purchaseId) {
    const { data } = await supabase
      .from('credit_purchases')
      .select('id, organization_id, status, fulfillment_status')
      .eq('id', scope.purchaseId)
      .maybeSingle();
    if (data && (data as any).status === 'completed' && (data as any).fulfillment_status === 'completed') {
      return { scope: scope.kind, dryRun, found: 0, repaired: 0, skipped: 0, alreadyHealthy: 1,
        details: [{ purchaseId: scope.purchaseId, organizationId: (data as any).organization_id, action: 'already_healthy' }] };
    }
  }

  const rows = await findPaidUnfulfilled(scope);

  for (const row of rows) {
    if (dryRun) {
      details.push({ purchaseId: row.id, organizationId: row.organization_id, action: 'would_repair', detail: `fulfillment_status=${row.fulfillment_status}` });
      continue;
    }
    try {
      // Routed through the provider-authoritative fulfillment gate rather than
      // calling completePurchase directly. Repair re-resolves the provider and
      // re-validates amount + currency, so reconciliation cannot become a way
      // to settle a purchase that the financial validator would refuse on the
      // verify/webhook paths. Still idempotent: a healthy row re-grants nothing.
      const r = await fulfillProviderConfirmedPurchase(row.id, row.reference_id ?? undefined);
      if (r.ok) {
        repaired++;
        details.push({ purchaseId: row.id, organizationId: row.organization_id, action: 'repaired' });
      } else {
        skipped++;
        details.push({ purchaseId: row.id, organizationId: row.organization_id, action: 'skipped', detail: r.detail ?? r.code });
      }
    } catch (e: any) {
      skipped++;
      details.push({ purchaseId: row.id, organizationId: row.organization_id, action: 'skipped', detail: e?.message });
    }
  }

  return { scope: scope.kind, dryRun, found: rows.length, repaired, skipped, alreadyHealthy, details };
}
