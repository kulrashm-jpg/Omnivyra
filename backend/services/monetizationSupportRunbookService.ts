import { ownedDbTable } from '../db/writeOwner';
import {
  classifyPendingPurchaseAge,
  classifyPendingReservationAge,
  CustomerRecoveryStatus,
} from './customerBillingStatusService';

export type MonetizationIncidentClass =
  | 'pending_purchase'
  | 'duplicate_payment'
  | 'failed_fulfillment'
  | 'delayed_webhook'
  | 'quarantined_reservation'
  | 'stale_reservation'
  | 'missing_credits'
  | 'failed_verification';

export interface MonetizationSupportRunbook {
  incident_class: MonetizationIncidentClass;
  title: string;
  safe_investigation_steps: string[];
  allowed_operator_actions: string[];
  prohibited_operator_actions: string[];
  escalation_conditions: string[];
  expected_ledger_outcome: string;
}

export interface MonetizationSupportCase {
  incident_class: MonetizationIncidentClass;
  recovery_status: CustomerRecoveryStatus;
  organization_id: string | null;
  purchase_id?: string | null;
  provider_order_id?: string | null;
  provider_event_id?: string | null;
  reservation_id?: string | null;
  reconciliation_state?: string | null;
  safe_replay_eligible: boolean;
  age_minutes: number | null;
  customer_safe_status: string;
  support_reference: string;
  runbook: MonetizationSupportRunbook;
}

const RUNBOOKS: Record<MonetizationIncidentClass, MonetizationSupportRunbook> = {
  pending_purchase: {
    incident_class: 'pending_purchase',
    title: 'Pending purchase',
    safe_investigation_steps: [
      'Open the purchase by purchase_id and confirm organization ownership.',
      'Check provider_order_id and matching provider events.',
      'Verify whether credits were already granted via credit_transactions.',
      'Check operational events for amount, currency, or signature failures.',
    ],
    allowed_operator_actions: [
      'Run provider-event replay in dry-run mode.',
      'Run reconciliation/audit and review the returned anomalies.',
      'Escalate to engineering if money movement is unclear.',
    ],
    prohibited_operator_actions: [
      'Do not manually edit wallet balances.',
      'Do not create a manual credit grant unless a payment has been verified through provider records.',
      'Do not ask the customer to pay again while a captured payment may still fulfill.',
    ],
    escalation_conditions: [
      'Purchase is older than the review threshold.',
      'Provider shows payment captured but no fulfillment completed.',
      'Amount, currency, or organization mismatch appears.',
    ],
    expected_ledger_outcome: 'Exactly one credit grant transaction linked to the purchase, or a failed purchase with no credit grant.',
  },
  duplicate_payment: {
    incident_class: 'duplicate_payment',
    title: 'Duplicate payment signal',
    safe_investigation_steps: [
      'Compare provider_payment_id, provider_order_id, and purchase_id.',
      'Confirm whether duplicate provider events are already marked processed.',
      'Check that only one credit_purchase reached completed fulfillment.',
    ],
    allowed_operator_actions: ['Review duplicate event logs.', 'Escalate suspected duplicate customer debit for payment-provider review.'],
    prohibited_operator_actions: ['Do not replay processed provider events for credit granting.', 'Do not issue credits for both duplicate signals without verified double debit.'],
    escalation_conditions: ['Two distinct captured provider payments exist for one customer intent.', 'Customer bank statement shows multiple debits.'],
    expected_ledger_outcome: 'One credit grant per verified captured payment intent.',
  },
  failed_fulfillment: {
    incident_class: 'failed_fulfillment',
    title: 'Failed fulfillment',
    safe_investigation_steps: [
      'Check fulfillment_error and operational events.',
      'Confirm whether createCredit succeeded before purchase completion failed.',
      'Check customer billing projection for credits added.',
    ],
    allowed_operator_actions: ['Retry safe provider fulfillment when dry-run says replayable.', 'Run invariant audit before and after retry.'],
    prohibited_operator_actions: ['Do not manually set fulfillment_status to completed.', 'Do not bypass createCredit.'],
    escalation_conditions: ['Credit grant exists but purchase status is failed.', 'Retry fails more than once.'],
    expected_ledger_outcome: 'Idempotent retry either observes existing grant or creates exactly one grant.',
  },
  delayed_webhook: {
    incident_class: 'delayed_webhook',
    title: 'Delayed webhook',
    safe_investigation_steps: ['Check provider events for the order.', 'Verify checkout verify endpoint result if present.', 'Confirm no amount/currency mismatch.'],
    allowed_operator_actions: ['Wait within normal delay window.', 'Use provider-event replay only if a recorded captured event exists.'],
    prohibited_operator_actions: ['Do not grant credits from an unverified client callback alone.'],
    escalation_conditions: ['Provider captured payment but no webhook/verify event exists after threshold.'],
    expected_ledger_outcome: 'Purchase remains pending until verified provider evidence exists.',
  },
  quarantined_reservation: {
    incident_class: 'quarantined_reservation',
    title: 'Quarantined reservation',
    safe_investigation_steps: ['Inspect reservation metadata and reference artifact.', 'Check reconciliation reason.', 'Run invariant audit.'],
    allowed_operator_actions: ['Escalate to engineering for manual classification.', 'Run reconciliation only after artifact state is confirmed.'],
    prohibited_operator_actions: ['Do not force confirm or release without durable artifact evidence.'],
    escalation_conditions: ['Customer-visible action is stuck.', 'Reserved credits remain held beyond review threshold.'],
    expected_ledger_outcome: 'Reservation becomes confirmed if output exists, released if failed, or remains quarantined for engineering review.',
  },
  stale_reservation: {
    incident_class: 'stale_reservation',
    title: 'Stale reservation',
    safe_investigation_steps: ['Check for terminal confirm/release siblings.', 'Check referenced artifact status.', 'Review orphan reaper activity.'],
    allowed_operator_actions: ['Trigger reconciliation.', 'Allow orphan reaper to release if no completed artifact exists.'],
    prohibited_operator_actions: ['Do not delete hold rows.', 'Do not directly change reserved balances.'],
    escalation_conditions: ['Reserved balance mismatch appears.', 'Artifact completion and reservation terminal state disagree.'],
    expected_ledger_outcome: 'A terminal confirm or release transaction resolves the hold.',
  },
  missing_credits: {
    incident_class: 'missing_credits',
    title: 'Missing credits',
    safe_investigation_steps: ['Search billing projection by purchase_id.', 'Check credit_transactions for credit_purchase reference.', 'Check provider event processing status.'],
    allowed_operator_actions: ['Retry replayable provider event.', 'Escalate verified missing grant.'],
    prohibited_operator_actions: ['Do not compensate with manual credits until payment evidence and ledger state are verified.'],
    escalation_conditions: ['Captured payment exists and no credit grant exists after retry.', 'Customer impact is active.'],
    expected_ledger_outcome: 'Exactly one purchase-linked credit grant appears.',
  },
  failed_verification: {
    incident_class: 'failed_verification',
    title: 'Failed verification',
    safe_investigation_steps: ['Check signature, order, amount, currency, and organization mismatch logs.', 'Confirm request was from the expected organization.'],
    allowed_operator_actions: ['Ask customer to retry checkout only if no captured payment is visible.', 'Escalate mismatches immediately.'],
    prohibited_operator_actions: ['Do not fulfill a payment with mismatched organization, amount, or currency.'],
    escalation_conditions: ['Any organization mismatch.', 'Any amount/currency mismatch.', 'Repeated signature failures.'],
    expected_ledger_outcome: 'No credit grant for rejected verification.',
  },
};

export function listMonetizationSupportRunbooks(): MonetizationSupportRunbook[] {
  return Object.values(RUNBOOKS);
}

export function getMonetizationSupportRunbook(incidentClass: MonetizationIncidentClass): MonetizationSupportRunbook {
  return RUNBOOKS[incidentClass];
}

export async function listMonetizationSupportCases(input?: { limit?: number }): Promise<MonetizationSupportCase[]> {
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
  const [purchases, providerEvents, reservations] = await Promise.all([
    ownedDbTable('credit_purchases')
      .select('id, organization_id, provider_order_id, provider_payment_id, status, fulfillment_status, fulfillment_error, created_at, updated_at')
      .eq('provider', 'razorpay')
      .in('fulfillment_status', ['pending', 'event_recorded', 'failed'])
      .order('created_at', { ascending: false })
      .limit(limit),
    ownedDbTable('payment_provider_events')
      .select('id, organization_id, provider_event_id, provider_order_id, provider_payment_id, purchase_id, processing_status, error_message, received_at')
      .eq('provider', 'razorpay')
      .in('processing_status', ['recorded', 'failed', 'duplicate'])
      .order('received_at', { ascending: false })
      .limit(limit),
    ownedDbTable('credit_transactions')
      .select('id, organization_id, reference_type, reference_id, created_at, metadata')
      .eq('execution_phase', 'hold')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const cases: MonetizationSupportCase[] = [];
  for (const row of (purchases.data ?? []) as any[]) {
    const age = classifyPendingPurchaseAge(row.created_at);
    const failed = row.status === 'failed' || row.fulfillment_status === 'failed';
    const incident: MonetizationIncidentClass = failed ? 'failed_fulfillment' : 'pending_purchase';
    cases.push({
      incident_class: incident,
      recovery_status: failed ? 'contact_support' : age.recovery_status,
      organization_id: row.organization_id ?? null,
      purchase_id: row.id,
      provider_order_id: row.provider_order_id ?? null,
      safe_replay_eligible: row.fulfillment_status === 'event_recorded' || age.support_escalation_required,
      age_minutes: age.age_minutes,
      customer_safe_status: failed ? 'Payment Failed' : age.support_escalation_required ? 'Payment Under Review' : 'Payment Processing',
      support_reference: row.provider_order_id ?? row.id,
      runbook: RUNBOOKS[incident],
    });
  }

  for (const row of (providerEvents.data ?? []) as any[]) {
    const failedVerification = String(row.error_message ?? '').includes('mismatch') || String(row.error_message ?? '').includes('signature');
    const incident: MonetizationIncidentClass = failedVerification ? 'failed_verification' : 'delayed_webhook';
    cases.push({
      incident_class: incident,
      recovery_status: row.processing_status === 'failed' ? 'contact_support' : 'needs_review',
      organization_id: row.organization_id ?? null,
      purchase_id: row.purchase_id ?? null,
      provider_order_id: row.provider_order_id ?? null,
      provider_event_id: row.provider_event_id ?? null,
      safe_replay_eligible: row.processing_status === 'recorded',
      age_minutes: classifyPendingPurchaseAge(row.received_at).age_minutes,
      customer_safe_status: row.processing_status === 'failed' ? 'Payment Under Review' : 'Credits Pending',
      support_reference: row.provider_event_id ?? row.id,
      runbook: RUNBOOKS[incident],
    });
  }

  for (const row of (reservations.data ?? []) as any[]) {
    const meta = row.metadata ?? {};
    const quarantined = meta.reconciliation_status === 'quarantined';
    const age = classifyPendingReservationAge(row.created_at);
    const incident: MonetizationIncidentClass = quarantined ? 'quarantined_reservation' : 'stale_reservation';
    if (!quarantined && !age.support_escalation_required) continue;
    cases.push({
      incident_class: incident,
      recovery_status: quarantined ? 'needs_review' : age.recovery_status,
      organization_id: row.organization_id ?? null,
      reservation_id: row.id,
      reconciliation_state: typeof meta.reconciliation_status === 'string' ? meta.reconciliation_status : null,
      safe_replay_eligible: false,
      age_minutes: age.age_minutes,
      customer_safe_status: quarantined ? 'Payment Under Review' : 'Credits Reserved',
      support_reference: row.reference_id ?? row.id,
      runbook: RUNBOOKS[incident],
    });
  }

  return cases.slice(0, limit);
}
