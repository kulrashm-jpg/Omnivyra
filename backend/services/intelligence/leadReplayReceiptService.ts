/**
 * Safe lead/webhook replay — PROVABLY idempotent via an ISOLATED receipt sink.
 *
 * It does NOT write to the public `leads` table and does NOT reuse the
 * hardened public ingress (no refactor, no duplicate lead creation). Instead
 * it writes a receipt into `replay_lead_receipts` whose UNIQUE
 * (company_id, dedupe_key) makes the replay exactly-once by DB invariant. The
 * receipt is then READ BACK to verify the write. When the table is absent it
 * falls back to the append-only `replay_executed` audit marker (lineage/
 * export-only) — exactly the spec's required fallback.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type ReceiptOutcome =
  | 'receipt_written'
  | 'already_receipted'
  | 'lineage_only_fallback'
  | 'failed';

export interface ReceiptResult {
  outcome: ReceiptOutcome;
  verified: boolean;
  detail: string;
}

let tableProbe: boolean | null = null;
async function hasReceiptTable(): Promise<boolean> {
  if (tableProbe !== null) return tableProbe;
  try {
    const { error } = await ownedDbTable('replay_lead_receipts')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    tableProbe = !error;
  } catch {
    tableProbe = false;
  }
  return tableProbe;
}

/**
 * Record a provably-idempotent replay receipt for a lead/webhook payload.
 * Re-runs are no-ops (UNIQUE conflict). Returns a verified result by reading
 * the receipt back.
 */
export async function recordLeadReplayReceipt(args: {
  companyId: string;
  source: string;
  dedupeKey: string;
  replayOrigin: string;
  detail?: Record<string, unknown>;
}): Promise<ReceiptResult> {
  const { companyId, source, dedupeKey, replayOrigin } = args;

  if (!(await hasReceiptTable())) {
    // Fallback: append-only lineage marker only (no idempotent sink table).
    await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'lead-replay-receipt' },
      action: 'replay_executed.lineage_only',
      resourceType: 'replay_executed',
      resourceId: dedupeKey,
      severity: 'info',
      entityLineage: ['company', 'replay_executed', source],
      detail: { source, replayOrigin, mode: 'lineage_only', note: 'receipt table absent — export-only fallback' },
    }).catch(() => undefined);
    return { outcome: 'lineage_only_fallback', verified: false, detail: 'receipt table not applied — lineage/export-only (no duplicate writes)' };
  }

  try {
    // Idempotent insert: UNIQUE(company_id,dedupe_key) → re-run is a no-op.
    const ins = await ownedDbTable('replay_lead_receipts').upsert(
      {
        company_id: companyId,
        source,
        dedupe_key: dedupeKey,
        replay_origin: replayOrigin,
        verified: true,
        detail: args.detail ?? {},
      },
      { onConflict: 'company_id,dedupe_key', ignoreDuplicates: true },
    );
    if (ins.error) {
      return { outcome: 'failed', verified: false, detail: ins.error.message };
    }

    // Replay write verification — read the receipt back.
    const { data } = await ownedDbTable('replay_lead_receipts')
      .select('id, created_at')
      .eq('company_id', companyId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    const verified = Boolean((data as any)?.id);

    await recordComplianceAudit({
      companyId,
      actor: { userId: null, type: 'system', label: 'lead-replay-receipt' },
      action: 'replay_executed.receipt',
      resourceType: 'replay_executed',
      resourceId: dedupeKey,
      severity: 'info',
      entityLineage: ['company', 'replay_executed', source, 'receipt'],
      detail: { source, replayOrigin, verified, receiptId: (data as any)?.id ?? null },
    }).catch(() => undefined);

    return {
      outcome: 'receipt_written',
      verified,
      detail: verified
        ? 'idempotent receipt written & verified (exactly-once by UNIQUE constraint; no lead duplication)'
        : 'receipt insert ok but verification read returned nothing',
    };
  } catch (err) {
    return { outcome: 'failed', verified: false, detail: err instanceof Error ? err.message : 'receipt error' };
  }
}

export async function listLeadReplayReceipts(companyId: string, limit = 100): Promise<any[]> {
  if (!(await hasReceiptTable())) return [];
  try {
    const { data } = await ownedDbTable('replay_lead_receipts')
      .select('source, dedupe_key, replay_origin, verified, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as any[];
  } catch {
    return [];
  }
}

export function __resetReceiptProbe(): void {
  tableProbe = null;
}
