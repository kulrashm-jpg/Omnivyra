import { ownedDbTable } from '../db/writeOwner';
import { listCustomerBillingEvents } from './customerBillingProjectionService';
import { getMonetizationAlertSummary, recordMonetizationOperationalEvent } from './monetizationOpsService';
import { listMonetizationBetaHealthSummary } from './monetizationBetaAccessService';

export type MonetizationTimelineAudience = 'support' | 'customer_safe';

export interface MonetizationTimelineItem {
  id: string;
  occurred_at: string;
  source: 'purchase' | 'provider_event' | 'operational_event' | 'credit_transaction' | 'support_action' | 'customer_billing';
  title: string;
  status?: string | null;
  request_id?: string | null;
  correlation_id?: string | null;
  lineage?: {
    replay?: string | null;
    reconciliation?: string | null;
  };
  customer_safe: boolean;
  details: Record<string, unknown>;
}

export type MonetizationDrillType =
  | 'successful_purchase'
  | 'duplicate_webhook'
  | 'delayed_webhook'
  | 'invalid_signature'
  | 'failed_fulfillment'
  | 'reconciliation_recovery'
  | 'freeze_mode'
  | 'replay_dry_run';

export type MonetizationDrillStatus = 'planned' | 'running' | 'passed' | 'failed' | 'blocked';

export async function buildMonetizationIncidentTimeline(input: {
  organizationId?: string | null;
  purchaseId?: string | null;
  providerEventId?: string | null;
  reservationId?: string | null;
  limit?: number;
  audience?: MonetizationTimelineAudience;
}): Promise<MonetizationTimelineItem[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const customerSafeOnly = input.audience === 'customer_safe';

  const [purchases, providerEvents, opsEvents, creditTx, supportActions, billingEvents] = await Promise.all([
    input.purchaseId
      ? ownedDbTable('credit_purchases')
        .select('*')
        .eq('id', input.purchaseId)
        .limit(5)
      : input.organizationId
        ? ownedDbTable('credit_purchases')
          .select('*')
          .eq('organization_id', input.organizationId)
          .order('created_at', { ascending: false })
          .limit(25)
        : Promise.resolve({ data: [], error: null } as any),
    ownedDbTable('payment_provider_events')
      .select('id, provider_event_id, event_type, purchase_id, organization_id, processing_status, error_message, provider_order_id, provider_payment_id, received_at, processed_at, request_id, correlation_id, payload')
      .match({
        ...(input.purchaseId ? { purchase_id: input.purchaseId } : {}),
        ...(input.providerEventId ? { provider_event_id: input.providerEventId } : {}),
        ...(input.organizationId ? { organization_id: input.organizationId } : {}),
      })
      .order('received_at', { ascending: false })
      .limit(limit),
    ownedDbTable('monetization_operational_events')
      .select('*')
      .match({
        ...(input.purchaseId ? { purchase_id: input.purchaseId } : {}),
        ...(input.providerEventId ? { provider_event_id: input.providerEventId } : {}),
        ...(input.reservationId ? { reservation_id: input.reservationId } : {}),
        ...(input.organizationId ? { organization_id: input.organizationId } : {}),
      })
      .order('created_at', { ascending: false })
      .limit(limit),
    ownedDbTable('credit_transactions')
      .select('id, organization_id, reference_type, reference_id, execution_phase, credits_delta, note, idempotency_key, parent_transaction_id, created_at, metadata')
      .match({
        ...(input.reservationId ? { id: input.reservationId } : {}),
        ...(input.organizationId ? { organization_id: input.organizationId } : {}),
      })
      .order('created_at', { ascending: false })
      .limit(limit),
    ownedDbTable('monetization_beta_support_actions')
      .select('*')
      .match({
        ...(input.purchaseId ? { purchase_id: input.purchaseId } : {}),
        ...(input.providerEventId ? { provider_event_id: input.providerEventId } : {}),
        ...(input.reservationId ? { reservation_id: input.reservationId } : {}),
        ...(input.organizationId ? { organization_id: input.organizationId } : {}),
      })
      .order('created_at', { ascending: false })
      .limit(limit),
    input.organizationId
      ? listCustomerBillingEvents({ organizationId: input.organizationId, limit: 50 }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const items: MonetizationTimelineItem[] = [];

  for (const row of purchases.data ?? []) {
    items.push({
      id: `purchase:${row.id}`,
      occurred_at: row.created_at,
      source: 'purchase',
      title: 'Payment intent',
      status: row.fulfillment_status ?? row.status,
      customer_safe: false,
      details: {
        purchase_id: row.id,
        organization_id: row.organization_id,
        provider_order_id: row.provider_order_id,
        provider_payment_id: row.provider_payment_id,
        credits: row.credits,
        amount: row.amount_paid,
        currency: row.currency,
      },
    });
  }

  for (const row of providerEvents.data ?? []) {
    if (customerSafeOnly) continue;
    items.push({
      id: `provider:${row.id}`,
      occurred_at: row.processed_at ?? row.received_at,
      source: 'provider_event',
      title: `Provider event: ${row.event_type}`,
      status: row.processing_status,
      request_id: row.request_id ?? null,
      correlation_id: row.correlation_id ?? null,
      lineage: { replay: row.payload?.replay_of ?? null, reconciliation: null },
      customer_safe: false,
      details: {
        provider_event_id: row.provider_event_id,
        provider_order_id: row.provider_order_id,
        provider_payment_id: row.provider_payment_id,
        error_message: row.error_message,
      },
    });
  }

  for (const row of opsEvents.data ?? []) {
    if (customerSafeOnly && row.customer_safe !== true) continue;
    const replayLineage = row.metadata?.provider_event_row_id
      ? String(row.metadata.provider_event_row_id)
      : row.metadata?.source === 'replay'
        ? 'replay'
        : null;
    items.push({
      id: `ops:${row.id}`,
      occurred_at: row.created_at,
      source: 'operational_event',
      title: row.event_name,
      status: row.escalation_priority ?? row.severity,
      request_id: row.request_id ?? null,
      correlation_id: row.correlation_id ?? null,
      lineage: {
        replay: replayLineage,
        reconciliation: row.metadata?.result ? 'admin_reconciliation' : null,
      },
      customer_safe: row.customer_safe === true,
      details: {
        severity: row.severity,
        alert_key: row.alert_key,
        customer_impact: row.customer_impact,
        economic_risk: row.economic_risk,
        fulfillment_status: row.fulfillment_status,
        metadata: row.metadata,
      },
    });
  }

  for (const row of creditTx.data ?? []) {
    const internal = String(row.note ?? '').startsWith('[REAPER]') || String(row.reference_type ?? '').includes('reconciliation');
    if (customerSafeOnly && internal) continue;
    items.push({
      id: `credit:${row.id}`,
      occurred_at: row.created_at,
      source: 'credit_transaction',
      title: `Credit ${row.execution_phase}`,
      status: row.execution_phase,
      lineage: {
        replay: null,
        reconciliation: row.metadata?.reconciliation_status ?? null,
      },
      customer_safe: !internal,
      details: {
        transaction_id: row.id,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        credits_delta: row.credits_delta,
        parent_transaction_id: row.parent_transaction_id,
        idempotency_key: row.idempotency_key,
      },
    });
  }

  for (const row of supportActions.data ?? []) {
    if (customerSafeOnly) continue;
    items.push({
      id: `support:${row.id}`,
      occurred_at: row.created_at,
      source: 'support_action',
      title: `Support action: ${row.action}`,
      status: row.action,
      customer_safe: false,
      details: {
        support_case_id: row.support_case_id,
        actor_user_id: row.actor_user_id,
        note: row.note,
      },
    });
  }

  for (const row of billingEvents) {
    items.push({
      id: `customer:${row.id}`,
      occurred_at: row.occurred_at,
      source: 'customer_billing',
      title: row.display_status ?? row.label,
      status: row.recovery_status,
      customer_safe: true,
      details: {
        customer_state: row.customer_state,
        customer_message: row.customer_message,
        credits: row.credits,
        guidance: row.guidance,
      },
    });
  }

  return items
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit);
}

export async function recordMonetizationBetaDrill(input: {
  drillType: MonetizationDrillType;
  status: MonetizationDrillStatus;
  operatorUserId: string;
  expectedOutcome: string;
  observedOutcome?: string | null;
  anomaliesFound?: string[] | null;
  economicImpactAssessment?: string | null;
  followUpActions?: string[] | null;
  organizationId?: string | null;
  purchaseId?: string | null;
  providerEventId?: string | null;
}) {
  const { data, error } = await ownedDbTable('monetization_beta_drills')
    .insert({
      drill_type: input.drillType,
      status: input.status,
      operator_user_id: input.operatorUserId,
      organization_id: input.organizationId ?? null,
      purchase_id: input.purchaseId ?? null,
      provider_event_id: input.providerEventId ?? null,
      expected_outcome: input.expectedOutcome,
      observed_outcome: input.observedOutcome ?? null,
      anomalies_found: input.anomaliesFound ?? [],
      economic_impact_assessment: input.economicImpactAssessment ?? null,
      follow_up_actions: input.followUpActions ?? [],
      completed_at: ['passed', 'failed', 'blocked'].includes(input.status) ? new Date().toISOString() : null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`monetization_beta_drill_record_failed:${error.message}`);
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.beta_drill_recorded',
    severity: input.status === 'failed' || input.status === 'blocked' ? 'WARN' : 'INFO',
    organizationId: input.organizationId ?? null,
    providerEventId: input.providerEventId ?? null,
    purchaseId: input.purchaseId ?? null,
    alertKey: input.status === 'failed' ? 'beta_drill_failed' : null,
    metadata: {
      drill_type: input.drillType,
      drill_status: input.status,
      operator_user_id: input.operatorUserId,
    },
  });
  return data;
}

export async function listMonetizationBetaDrillSummary(input?: { limit?: number }) {
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  const { data, error } = await ownedDbTable('monetization_beta_drills')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`monetization_beta_drills_list_failed:${error.message}`);
  const rows = data ?? [];
  return {
    rows,
    summary: {
      total: rows.length,
      passed: rows.filter((row: any) => row.status === 'passed').length,
      failed: rows.filter((row: any) => row.status === 'failed').length,
      blocked: rows.filter((row: any) => row.status === 'blocked').length,
      unresolved_anomalies: rows.filter((row: any) => Array.isArray(row.anomalies_found) && row.anomalies_found.length > 0 && row.status !== 'passed').length,
      required_follow_ups: rows.filter((row: any) => Array.isArray(row.follow_up_actions) && row.follow_up_actions.length > 0).length,
    },
  };
}

export async function getMonetizationDailyReviewSummary() {
  const [betaHealth, alertSummary, drillSummary] = await Promise.all([
    listMonetizationBetaHealthSummary({ lookbackHours: 24 }),
    getMonetizationAlertSummary({ lookbackHours: 24, limit: 1000 }),
    listMonetizationBetaDrillSummary({ limit: 50 }).catch(() => ({ rows: [], summary: null })),
  ]);
  return {
    generated_at: new Date().toISOString(),
    beta_health: betaHealth,
    alert_summary: alertSummary,
    drills: drillSummary,
    review_ready: betaHealth.trust_risk === 'low' && betaHealth.economic_health === 'healthy',
    human_review_required:
      betaHealth.support_cases_open > 0 ||
      betaHealth.human_review_events > 0 ||
      betaHealth.quarantined_reservations > 0 ||
      alertSummary.requires_human_review > 0,
  };
}
