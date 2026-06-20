/**
 * Commercial reconciliation (§B/§C) — repair "paid-but-unfulfilled" top-up
 * purchases (status='completed' AND fulfillment_status != 'completed'), which
 * can occur if credit allocation failed AFTER the status flip in completePurchase.
 *
 * Repair re-runs the EXISTING idempotent fulfillment (`completePurchase` →
 * `createCredit` with the deterministic key) + idempotent invoice generation.
 * → never double-grants, never duplicate invoices, safe to run repeatedly.
 * Read-only in dry-run.
 */
import { supabase } from '../../db/supabaseClient';
import { completePurchase } from '../purchaseService';
import { generateTopupInvoice } from './topupInvoiceService';

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
      const r = await completePurchase(row.id, row.reference_id ?? undefined); // idempotent
      if (r.success) {
        try { await generateTopupInvoice(row.id); } catch { /* invoice best-effort */ }
        repaired++;
        details.push({ purchaseId: row.id, organizationId: row.organization_id, action: 'repaired' });
      } else {
        skipped++;
        details.push({ purchaseId: row.id, organizationId: row.organization_id, action: 'skipped', detail: (r as any).reason });
      }
    } catch (e: any) {
      skipped++;
      details.push({ purchaseId: row.id, organizationId: row.organization_id, action: 'skipped', detail: e?.message });
    }
  }

  return { scope: scope.kind, dryRun, found: rows.length, repaired, skipped, alreadyHealthy, details };
}
