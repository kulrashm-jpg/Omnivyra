import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import { recordMonetizationOperationalEvent } from './monetizationOpsService';
import {
  confirmCreditReservation,
  releaseCreditReservation,
  type CreditReservationHandle,
} from './creditExecutionService';
import type { CreditAction } from './creditDeductionService';
import type { CategorySplit } from './creditPriorityService';

type HoldRow = {
  id: string;
  organization_id: string;
  free_delta: number | null;
  paid_delta: number | null;
  incentive_delta: number | null;
  idempotency_key: string | null;
  reference_type: string | null;
  reference_id: string | null;
  performed_by: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

type TerminalRow = {
  id: string;
  parent_transaction_id: string | null;
  execution_phase: string | null;
  idempotency_key: string | null;
};

export type ReconciliationDecision = 'confirm' | 'release' | 'quarantine' | 'skip';

export interface ReservationReconciliationResult {
  scanned: number;
  confirmed: number;
  released: number;
  quarantined: number;
  skippedTerminal: number;
  failed: number;
  actions: Array<{
    holdId: string;
    decision: ReconciliationDecision;
    reason: string;
    terminalTransactionId?: string | null;
  }>;
}

export interface MonetizationInvariantAuditReport {
  generated_at: string;
  stale_holds: Array<Record<string, unknown>>;
  terminal_without_valid_hold: Array<Record<string, unknown>>;
  duplicate_idempotency_keys: Array<Record<string, unknown>>;
  reserved_balance_mismatches: Array<Record<string, unknown>>;
  missing_usage_events: Array<Record<string, unknown>>;
  orphan_unified_transactions: Array<Record<string, unknown>>;
  artifact_charge_mismatches: Array<Record<string, unknown>>;
  payment_fulfillment_mismatches: Array<Record<string, unknown>>;
}

const DEFAULT_MIN_AGE_SECONDS = 10 * 60;
const DEFAULT_BATCH_LIMIT = 100;

function stripHoldSuffix(key: string | null | undefined): string | null {
  if (!key || !key.endsWith(':hold')) return null;
  return key.slice(0, -':hold'.length);
}

function splitFromHold(row: HoldRow): CategorySplit {
  return {
    free: Math.abs(row.free_delta ?? 0),
    incentive: Math.abs(row.incentive_delta ?? 0),
    paid: Math.abs(row.paid_delta ?? 0),
  };
}

function creditsFromSplit(split: CategorySplit): number {
  return split.free + split.incentive + split.paid;
}

function actionForReferenceType(referenceType: string | null): CreditAction | null {
  switch (referenceType) {
    case 'reports.snapshot':
      return 'website_audit';
    case 'reports.performance_intelligence':
      return 'deep_analysis';
    case 'reports.market_growth_intelligence':
      return 'full_strategy';
    case 'autonomous_campaign_generation':
      return 'campaign_generation';
    case 'master_content':
      return 'content_generation';
    case 'activity_platform_variants':
    case 'workspace_content_variants':
      return 'content_basic';
    case 'activity_content_improvement':
      return 'content_rewrite';
    default:
      return null;
  }
}

function buildHandle(row: HoldRow): CreditReservationHandle | null {
  const baseKey = stripHoldSuffix(row.idempotency_key);
  const action = actionForReferenceType(row.reference_type);
  if (!baseKey || !action) return null;
  const split = splitFromHold(row);
  return {
    orgId: row.organization_id,
    userId: row.performed_by ?? row.organization_id,
    action,
    referenceType: row.reference_type ?? 'unknown',
    referenceId: row.reference_id ?? row.id,
    idempotencyKey: baseKey,
    holdTransactionId: row.id,
    creditsReserved: creditsFromSplit(split),
    split,
  };
}

async function hasTerminalSibling(row: HoldRow): Promise<TerminalRow | null> {
  const baseKey = stripHoldSuffix(row.idempotency_key);
  if (!baseKey) return null;
  const { data } = await ownedDbTable('credit_transactions')
    .select('id, parent_transaction_id, execution_phase, idempotency_key')
    .eq('parent_transaction_id', row.id)
    .in('execution_phase', ['confirm', 'release'])
    .limit(1)
    .maybeSingle();
  if (data) return data as TerminalRow;

  const { data: keyed } = await ownedDbTable('credit_transactions')
    .select('id, parent_transaction_id, execution_phase, idempotency_key')
    .in('idempotency_key', [`${baseKey}:confirm`, `${baseKey}:release`])
    .limit(1)
    .maybeSingle();
  return (keyed as TerminalRow | null) ?? null;
}

function contentObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function contentHasDurableOutput(content: Record<string, unknown>, referenceType: string | null): boolean {
  if (referenceType === 'master_content') return !!content.master_content;
  if (referenceType === 'activity_platform_variants') {
    return Array.isArray(content.platform_variants) && content.platform_variants.length > 0;
  }
  if (referenceType === 'activity_content_improvement') {
    return Array.isArray(content.platform_variants)
      && content.platform_variants.some((variant) => {
        const v = variant as Record<string, unknown>;
        return String(v.generated_content ?? '').trim().length > 0;
      });
  }
  return false;
}

async function classifyHold(row: HoldRow): Promise<{ decision: ReconciliationDecision; reason: string }> {
  const referenceType = row.reference_type;
  const referenceId = row.reference_id;

  if (!stripHoldSuffix(row.idempotency_key)) {
    return { decision: 'quarantine', reason: 'noncanonical_hold_idempotency_key' };
  }
  if (!actionForReferenceType(referenceType)) {
    return { decision: 'quarantine', reason: 'unmapped_reference_type' };
  }

  if (referenceType?.startsWith('reports.')) {
    if (!referenceId) return { decision: 'quarantine', reason: 'report_hold_missing_reference_id' };
    const { data: report } = await ownedDbTable('reports')
      .select('id, status, data, metadata')
      .eq('id', referenceId)
      .eq('company_id', row.organization_id)
      .maybeSingle();
    if (!report) return { decision: 'quarantine', reason: 'report_artifact_missing' };
    const status = String((report as any).status ?? '');
    if (status === 'completed' && (report as any).data) return { decision: 'confirm', reason: 'completed_report_artifact_has_pending_hold' };
    if (status === 'failed') return { decision: 'release', reason: 'failed_report_artifact_has_pending_hold' };
    return { decision: 'quarantine', reason: `report_state_ambiguous:${status || 'unknown'}` };
  }

  if (referenceType === 'autonomous_campaign_generation') {
    const { data: log } = await ownedDbTable('autonomous_decision_logs')
      .select('id, created_at')
      .eq('company_id', row.organization_id)
      .eq('decision_type', 'generate')
      .gte('created_at', row.created_at)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (log) return { decision: 'confirm', reason: 'autonomous_generation_decision_log_exists' };
    return { decision: 'quarantine', reason: 'autonomous_generation_output_not_proven' };
  }

  if (referenceType === 'master_content' || referenceType === 'activity_platform_variants' || referenceType === 'activity_content_improvement') {
    const activityId = String(referenceId ?? '').split(':')[0];
    if (!activityId || activityId.startsWith('workspace-')) return { decision: 'quarantine', reason: 'content_artifact_not_persisted' };
    const { data: activity } = await ownedDbTable('daily_content_plans')
      .select('id, content')
      .eq('id', activityId)
      .maybeSingle();
    if (!activity) return { decision: 'quarantine', reason: 'content_activity_missing' };
    const content = contentObject((activity as any).content);
    if (contentHasDurableOutput(content, referenceType)) return { decision: 'confirm', reason: 'content_artifact_exists' };
    return { decision: 'quarantine', reason: 'content_output_not_proven' };
  }

  if (referenceType === 'workspace_content_variants') {
    return { decision: 'quarantine', reason: 'workspace_variants_are_response_only_no_durable_artifact' };
  }

  return { decision: 'quarantine', reason: 'unknown_hold_context' };
}

async function stampHold(row: HoldRow, fields: Record<string, unknown>): Promise<void> {
  await ownedDbTable('credit_transactions')
    .update({
      metadata: {
        ...(row.metadata ?? {}),
        ...fields,
      },
    })
    .eq('id', row.id);
}

async function stampReportArtifact(row: HoldRow, reason: string, reconciledBy: string): Promise<void> {
  if (!row.reference_type?.startsWith('reports.') || !row.reference_id) return;
  const { data: report } = await ownedDbTable('reports')
    .select('id, metadata')
    .eq('id', row.reference_id)
    .eq('company_id', row.organization_id)
    .maybeSingle();
  if (!report) return;
  const metadata = ((report as any).metadata && typeof (report as any).metadata === 'object')
    ? (report as any).metadata as Record<string, unknown>
    : {};
  await ownedDbTable('reports')
    .update({
      metadata: {
        ...metadata,
        reservation_reconciliation: {
          reconciliation_reason: reason,
          reconciled_at: new Date().toISOString(),
          reconciled_by: reconciledBy,
          hold_transaction_id: row.id,
        },
      },
    })
    .eq('id', row.reference_id);
}

export async function reconcileDurableMonetizationReservations(input?: {
  minAgeSeconds?: number;
  batchLimit?: number;
  orgId?: string;
  reconciledBy?: string;
}): Promise<ReservationReconciliationResult> {
  const minAgeSeconds = input?.minAgeSeconds ?? DEFAULT_MIN_AGE_SECONDS;
  const cutoff = new Date(Date.now() - minAgeSeconds * 1000).toISOString();
  const reconciledBy = input?.reconciledBy ?? 'system:monetization-reservation-reconciler';

  let query = ownedDbTable('credit_transactions')
    .select('id, organization_id, free_delta, paid_delta, incentive_delta, idempotency_key, reference_type, reference_id, performed_by, created_at, metadata')
    .eq('execution_phase', 'hold')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(input?.batchLimit ?? DEFAULT_BATCH_LIMIT);
  if (input?.orgId) query = query.eq('organization_id', input.orgId);

  const { data, error } = await query;
  if (error) throw new Error(`reservation_reconciliation_query_failed: ${error.message}`);

  const result: ReservationReconciliationResult = {
    scanned: (data ?? []).length,
    confirmed: 0,
    released: 0,
    quarantined: 0,
    skippedTerminal: 0,
    failed: 0,
    actions: [],
  };

  await recordMonetizationOperationalEvent({
    eventName: 'monetization.reservation_reconciliation_started',
    severity: 'INFO',
    organizationId: input?.orgId ?? null,
    metadata: { min_age_seconds: minAgeSeconds, batch_limit: input?.batchLimit ?? DEFAULT_BATCH_LIMIT },
  });

  for (const row of (data ?? []) as HoldRow[]) {
    try {
      const sibling = await hasTerminalSibling(row);
      if (sibling) {
        result.skippedTerminal += 1;
        result.actions.push({ holdId: row.id, decision: 'skip', reason: `already_${sibling.execution_phase}`, terminalTransactionId: sibling.id });
        continue;
      }

      const classification = await classifyHold(row);
      const handle = buildHandle(row);
      if (!handle) {
        await stampHold(row, {
          reconciliation_status: 'quarantined',
          reconciliation_reason: classification.reason,
          reconciled_at: new Date().toISOString(),
          reconciled_by: reconciledBy,
        });
        result.quarantined += 1;
        await recordMonetizationOperationalEvent({
          eventName: 'monetization.reservation_quarantined',
          severity: 'WARN',
          organizationId: row.organization_id,
          reservationId: row.id,
          alertKey: 'reservation_quarantine',
          metadata: { reason: classification.reason, reference_type: row.reference_type, reference_id: row.reference_id },
        });
        result.actions.push({ holdId: row.id, decision: 'quarantine', reason: classification.reason });
        continue;
      }

      if (classification.decision === 'confirm') {
        const settlement = await confirmCreditReservation({
          ...handle,
          note: `[RECONCILED] ${classification.reason}`,
        });
        await stampHold(row, {
          reconciliation_status: settlement.status,
          reconciliation_reason: classification.reason,
          reconciled_at: new Date().toISOString(),
          reconciled_by: reconciledBy,
        });
        await stampReportArtifact(row, classification.reason, reconciledBy);
        result.confirmed += settlement.status === 'confirmed' || settlement.status === 'already_confirmed' ? 1 : 0;
        await recordMonetizationOperationalEvent({
          eventName: 'monetization.reservation_reconciled_confirmed',
          severity: 'INFO',
          organizationId: row.organization_id,
          reservationId: row.id,
          fulfillmentStatus: settlement.status,
          metadata: { reason: classification.reason, reference_type: row.reference_type, reference_id: row.reference_id },
        });
        result.actions.push({ holdId: row.id, decision: 'confirm', reason: classification.reason });
        continue;
      }

      if (classification.decision === 'release') {
        const release = await releaseCreditReservation({
          ...handle,
          note: `[RECONCILED] ${classification.reason}`,
        });
        await stampHold(row, {
          reconciliation_status: release.status,
          reconciliation_reason: classification.reason,
          reconciled_at: new Date().toISOString(),
          reconciled_by: reconciledBy,
        });
        await stampReportArtifact(row, classification.reason, reconciledBy);
        result.released += release.status === 'released' || release.status === 'already_released' ? 1 : 0;
        await recordMonetizationOperationalEvent({
          eventName: 'monetization.reservation_reconciled_released',
          severity: 'WARN',
          organizationId: row.organization_id,
          reservationId: row.id,
          fulfillmentStatus: release.status,
          alertKey: 'reservation_reconciled_release',
          metadata: { reason: classification.reason, reference_type: row.reference_type, reference_id: row.reference_id },
        });
        result.actions.push({ holdId: row.id, decision: 'release', reason: classification.reason });
        continue;
      }

      await stampHold(row, {
        reconciliation_status: 'quarantined',
        reconciliation_reason: classification.reason,
        reconciled_at: new Date().toISOString(),
        reconciled_by: reconciledBy,
      });
      result.quarantined += 1;
      await recordMonetizationOperationalEvent({
        eventName: 'monetization.reservation_quarantined',
        severity: 'WARN',
        organizationId: row.organization_id,
        reservationId: row.id,
        alertKey: 'reservation_quarantine',
        metadata: { reason: classification.reason, reference_type: row.reference_type, reference_id: row.reference_id },
      });
      result.actions.push({ holdId: row.id, decision: 'quarantine', reason: classification.reason });
    } catch (err) {
      result.failed += 1;
      result.actions.push({
        holdId: row.id,
        decision: 'quarantine',
        reason: err instanceof Error ? err.message : String(err),
      });
      logger.error('reservation_reconciliation_failed_for_hold', {
        holdId: row.id,
        orgId: row.organization_id,
        message: err instanceof Error ? err.message : String(err),
      });
      await recordMonetizationOperationalEvent({
        eventName: 'monetization.reservation_reconciliation_failed',
        severity: 'ERROR',
        organizationId: row.organization_id,
        reservationId: row.id,
        alertKey: 'reservation_reconciliation_failed',
        metadata: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  await recordMonetizationOperationalEvent({
    eventName: 'monetization.reservation_reconciliation_completed',
    severity: result.failed > 0 || result.quarantined > 0 ? 'WARN' : 'INFO',
    organizationId: input?.orgId ?? null,
    alertKey: result.quarantined > 0 ? 'reservation_quarantine_growth' : null,
    metadata: { ...result, actions: result.actions.slice(0, 25) },
  });

  return result;
}

export async function auditMonetizationInvariants(input?: {
  staleHoldSeconds?: number;
  limit?: number;
}): Promise<MonetizationInvariantAuditReport> {
  const limit = input?.limit ?? 250;
  const staleCutoff = new Date(Date.now() - (input?.staleHoldSeconds ?? 60 * 60) * 1000).toISOString();

  const [
    holdsRes,
    terminalsRes,
    walletRes,
    creditTxRes,
    usageRes,
    unifiedRes,
    purchasesRes,
  ] = await Promise.all([
    ownedDbTable('credit_transactions')
      .select('id, organization_id, idempotency_key, reference_type, reference_id, created_at, metadata')
      .eq('execution_phase', 'hold')
      .lt('created_at', staleCutoff)
      .limit(limit),
    ownedDbTable('credit_transactions')
      .select('id, organization_id, parent_transaction_id, execution_phase, idempotency_key, created_at')
      .in('execution_phase', ['confirm', 'release'])
      .limit(limit),
    ownedDbTable('organization_credits')
      .select('organization_id, reserved_free, reserved_paid, reserved_incentive')
      .limit(limit),
    ownedDbTable('credit_transactions')
      .select('id, organization_id, parent_transaction_id, execution_phase, idempotency_key, free_delta, paid_delta, incentive_delta, reference_type, reference_id, created_at')
      .limit(5000),
    ownedDbTable('usage_events')
      .select('id, organization_id, reference_type, reference_id, action_key, created_at')
      .limit(5000),
    ownedDbTable('unified_transactions')
      .select('id, organization_id, reference_type, reference_id, action_key, created_at')
      .limit(5000),
    ownedDbTable('credit_purchases')
      .select('id, organization_id, status, fulfillment_status, reference_id, provider_event_id, created_at')
      .limit(limit),
  ]);

  const allTx = (creditTxRes.data ?? []) as any[];
  const txById = new Map(allTx.map((row) => [row.id, row]));
  const terminalWithoutValidHold = ((terminalsRes.data ?? []) as any[])
    .filter((row) => !row.parent_transaction_id || !txById.has(row.parent_transaction_id))
    .map((row) => ({ id: row.id, organization_id: row.organization_id, phase: row.execution_phase, parent_transaction_id: row.parent_transaction_id }));

  const idempotencyCounts = new Map<string, any[]>();
  for (const row of allTx) {
    if (!row.idempotency_key) continue;
    const bucket = idempotencyCounts.get(row.idempotency_key) ?? [];
    bucket.push(row);
    idempotencyCounts.set(row.idempotency_key, bucket);
  }
  const duplicateIdempotencyKeys = Array.from(idempotencyCounts.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([idempotency_key, rows]) => ({ idempotency_key, count: rows.length, ids: rows.map((r) => r.id) }))
    .slice(0, limit);

  const terminalParentIds = new Set(allTx.filter((row) => ['confirm', 'release'].includes(row.execution_phase)).map((row) => row.parent_transaction_id));
  const activeHolds = allTx.filter((row) => row.execution_phase === 'hold' && !terminalParentIds.has(row.id));
  const reservedByOrg = new Map<string, CategorySplit>();
  for (const row of activeHolds) {
    const current = reservedByOrg.get(row.organization_id) ?? { free: 0, incentive: 0, paid: 0 };
    current.free += Math.abs(row.free_delta ?? 0);
    current.incentive += Math.abs(row.incentive_delta ?? 0);
    current.paid += Math.abs(row.paid_delta ?? 0);
    reservedByOrg.set(row.organization_id, current);
  }
  const reservedBalanceMismatches = ((walletRes.data ?? []) as any[])
    .map((wallet) => {
      const expected = reservedByOrg.get(wallet.organization_id) ?? { free: 0, incentive: 0, paid: 0 };
      const actual = {
        free: Number(wallet.reserved_free ?? 0),
        incentive: Number(wallet.reserved_incentive ?? 0),
        paid: Number(wallet.reserved_paid ?? 0),
      };
      return { organization_id: wallet.organization_id, expected, actual };
    })
    .filter((row) => row.expected.free !== row.actual.free || row.expected.incentive !== row.actual.incentive || row.expected.paid !== row.actual.paid);

  const usageKeys = new Set(((usageRes.data ?? []) as any[]).map((row) => `${row.reference_type ?? ''}:${row.reference_id ?? ''}:${row.action_key ?? ''}`));
  const confirmedRows = allTx.filter((row) => row.execution_phase === 'confirm');
  const missingUsageEvents = confirmedRows
    .filter((row) => {
      const action = actionForReferenceType(row.reference_type) ?? '';
      return !usageKeys.has(`${row.reference_type ?? ''}:${row.reference_id ?? ''}:`)
        && !usageKeys.has(`${row.reference_type ?? ''}:${row.reference_id ?? ''}:${action}`);
    })
    .map((row) => ({ id: row.id, organization_id: row.organization_id, reference_type: row.reference_type, reference_id: row.reference_id }));
  const orphanUnifiedTransactions = ((unifiedRes.data ?? []) as any[])
    .filter((row) => row.reference_type && row.reference_id && !confirmedRows.some((tx) => tx.reference_type === row.reference_type && tx.reference_id === row.reference_id))
    .map((row) => ({ id: row.id, organization_id: row.organization_id, reference_type: row.reference_type, reference_id: row.reference_id, action_key: row.action_key }))
    .slice(0, limit);

  const paymentFulfillmentMismatches = ((purchasesRes.data ?? []) as any[])
    .filter((row) =>
      (row.status === 'completed' && row.fulfillment_status !== 'completed')
      || (row.fulfillment_status === 'completed' && row.status !== 'completed')
      || (row.provider_event_id && !row.reference_id)
    )
    .map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      status: row.status,
      fulfillment_status: row.fulfillment_status,
      reference_id: row.reference_id,
      provider_event_id: row.provider_event_id,
    }));

  return {
    generated_at: new Date().toISOString(),
    stale_holds: (holdsRes.data ?? []) as Array<Record<string, unknown>>,
    terminal_without_valid_hold: terminalWithoutValidHold,
    duplicate_idempotency_keys: duplicateIdempotencyKeys,
    reserved_balance_mismatches: reservedBalanceMismatches,
    missing_usage_events: missingUsageEvents.slice(0, limit),
    orphan_unified_transactions: orphanUnifiedTransactions,
    artifact_charge_mismatches: [],
    payment_fulfillment_mismatches: paymentFulfillmentMismatches,
  };
}
