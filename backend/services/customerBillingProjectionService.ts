import { ownedDbTable } from '../db/writeOwner';
import {
  classifyPendingPurchaseAge,
  classifyPendingReservationAge,
  customerDisplayLabel,
  CustomerBillingGuidance,
  CustomerRecoveryStatus,
  CustomerSafeBillingState,
  guidanceForCustomerState,
} from './customerBillingStatusService';
import { getOrganizationBetaTag } from './monetizationBetaAccessService';

export type CustomerBillingEventType =
  | 'purchase'
  | 'grant'
  | 'charge'
  | 'reservation'
  | 'release'
  | 'expiry'
  | 'refund';

export interface CustomerBillingEvent {
  id: string;
  type: CustomerBillingEventType;
  status: 'pending' | 'completed' | 'released' | 'expired' | 'failed';
  customer_state: CustomerSafeBillingState;
  display_status: string;
  recovery_status: CustomerRecoveryStatus;
  credits: number;
  occurred_at: string;
  label: string;
  customer_message: string;
  guidance: CustomerBillingGuidance;
  support_escalation_required: boolean;
  beta_cohort?: string | null;
  beta_access_level?: string | null;
  monetization_beta_enabled?: boolean;
  reference_type: string | null;
  reference_id: string | null;
}

function mapPurchaseRow(row: any): CustomerBillingEvent | null {
  const status = String(row.status ?? '');
  const fulfillmentStatus = String(row.fulfillment_status ?? '');
  if (status === 'completed' && fulfillmentStatus === 'completed') return null;
  const failed = status === 'failed' || fulfillmentStatus === 'failed';
  const age = classifyPendingPurchaseAge(row.created_at);
  const customerState: CustomerSafeBillingState = failed
    ? 'payment_failed'
    : age.support_escalation_required || fulfillmentStatus === 'event_recorded'
      ? 'payment_under_review'
      : 'payment_processing';
  const guidance = guidanceForCustomerState(customerState, age.recovery_status);
  const displayStatus = customerDisplayLabel(customerState);
  return {
    id: row.id,
    type: 'purchase',
    status: failed ? 'failed' : 'pending',
    customer_state: customerState,
    display_status: displayStatus,
    recovery_status: failed ? 'contact_support' : age.recovery_status,
    credits: Math.abs(Number(row.credits ?? 0)),
    occurred_at: row.created_at,
    label: displayStatus,
    customer_message: failed
      ? 'This payment did not add credits. If your bank shows a debit, contact support with this reference.'
      : age.customer_label_suffix
        ? `${displayStatus}: ${age.customer_label_suffix}`
        : 'Your payment is being verified. Credits will appear automatically after verification.',
    guidance,
    support_escalation_required: failed || age.support_escalation_required,
    reference_type: 'credit_purchase',
    reference_id: row.reference_id ?? row.provider_order_id ?? row.id,
  };
}

function isInternalRow(row: {
  note?: string | null;
  reference_type?: string | null;
}): boolean {
  const note = String(row.note ?? '');
  const referenceType = String(row.reference_type ?? '');
  return (
    note.startsWith('[REAPER]') ||
    note.startsWith('[PARTIAL_RELEASE]') ||
    referenceType === 'orphan_hold' ||
    referenceType === 'reconciliation' ||
    referenceType === 'retry'
  );
}

function labelFor(row: {
  transaction_type?: string | null;
  reference_type?: string | null;
  execution_phase?: string | null;
  note?: string | null;
}): string {
  const phase = row.execution_phase;
  const referenceType = String(row.reference_type ?? '').replace(/_/g, ' ');
  if (phase === 'hold') return `Pending reservation${referenceType ? ` - ${referenceType}` : ''}`;
  if (phase === 'confirm') return `Credits used${referenceType ? ` - ${referenceType}` : ''}`;
  if (phase === 'release') return `Reservation released${referenceType ? ` - ${referenceType}` : ''}`;
  if (phase === 'grant') return `Credits granted${referenceType ? ` - ${referenceType}` : ''}`;
  if (phase === 'expire' || phase === 'expire_incentive') return 'Credits expired';
  return row.note?.trim() || 'Credit transaction';
}

function mapCreditTransaction(row: any): CustomerBillingEvent | null {
  if (isInternalRow(row)) return null;
  const phase = row.execution_phase as string | null;
  const delta = Number(row.credits_delta ?? 0);

  if (phase === 'hold') {
    const age = classifyPendingReservationAge(row.created_at);
    const guidance = guidanceForCustomerState('credits_reserved', age.recovery_status);
    return {
      id: row.id,
      type: 'reservation',
      status: 'pending',
      customer_state: 'credits_reserved',
      display_status: customerDisplayLabel('credits_reserved'),
      recovery_status: age.recovery_status,
      credits: Math.abs(delta),
      occurred_at: row.created_at,
      label: customerDisplayLabel('credits_reserved'),
      customer_message: age.customer_label_suffix
        ? `Credits are reserved while the action finishes. ${age.customer_label_suffix}.`
        : 'Credits are reserved while the action finishes. They are restored automatically if it fails.',
      guidance,
      support_escalation_required: age.support_escalation_required,
      reference_type: row.reference_type ?? null,
      reference_id: row.reference_id ?? null,
    };
  }
  if (phase === 'confirm') {
    const guidance = guidanceForCustomerState('credits_used');
    return {
      id: row.id,
      type: 'charge',
      status: 'completed',
      customer_state: 'credits_used',
      display_status: customerDisplayLabel('credits_used'),
      recovery_status: 'processing_normally',
      credits: Math.abs(delta),
      occurred_at: row.created_at,
      label: customerDisplayLabel('credits_used'),
      customer_message: 'Credits were used for this completed action.',
      guidance,
      support_escalation_required: false,
      reference_type: row.reference_type ?? null,
      reference_id: row.reference_id ?? null,
    };
  }
  if (phase === 'release') {
    const guidance = guidanceForCustomerState('credits_restored');
    return {
      id: row.id,
      type: 'release',
      status: 'released',
      customer_state: 'credits_restored',
      display_status: customerDisplayLabel('credits_restored'),
      recovery_status: 'credits_restored',
      credits: Math.abs(delta),
      occurred_at: row.created_at,
      label: customerDisplayLabel('credits_restored'),
      customer_message: 'Reserved credits were restored because the action did not complete as charged.',
      guidance,
      support_escalation_required: false,
      reference_type: row.reference_type ?? null,
      reference_id: row.reference_id ?? null,
    };
  }
  if (phase === 'grant') {
    const customerState: CustomerSafeBillingState = row.reference_type === 'credit_purchase' ? 'credits_added' : 'credits_added';
    const guidance = guidanceForCustomerState(customerState);
    return {
      id: row.id,
      type: row.reference_type === 'credit_purchase' ? 'purchase' : 'grant',
      status: 'completed',
      customer_state: customerState,
      display_status: customerDisplayLabel(customerState),
      recovery_status: 'processing_normally',
      credits: Math.abs(delta),
      occurred_at: row.created_at,
      label: customerDisplayLabel(customerState),
      customer_message: row.reference_type === 'credit_purchase'
        ? 'Credits were added to your account.'
        : 'Credits were added to your account.',
      guidance,
      support_escalation_required: false,
      reference_type: row.reference_type ?? null,
      reference_id: row.reference_id ?? null,
    };
  }
  if (phase === 'expire' || phase === 'expire_incentive') {
    const guidance = guidanceForCustomerState('credits_expired');
    return {
      id: row.id,
      type: 'expiry',
      status: 'expired',
      customer_state: 'credits_expired',
      display_status: customerDisplayLabel('credits_expired'),
      recovery_status: 'processing_normally',
      credits: Math.abs(delta),
      occurred_at: row.created_at,
      label: customerDisplayLabel('credits_expired'),
      customer_message: 'Credits expired according to their validity period.',
      guidance,
      support_escalation_required: false,
      reference_type: row.reference_type ?? null,
      reference_id: row.reference_id ?? null,
    };
  }
  return null;
}

export async function listCustomerBillingEvents(input: {
  organizationId: string;
  limit?: number;
}): Promise<CustomerBillingEvent[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [{ data, error }, { data: purchases, error: purchaseError }] = await Promise.all([
    ownedDbTable('credit_transactions')
    .select('id, transaction_type, credits_delta, reference_type, reference_id, note, execution_phase, created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
      .limit(limit * 2),
    ownedDbTable('credit_purchases')
      .select('id, credits, status, fulfillment_status, reference_id, provider_order_id, created_at')
      .eq('organization_id', input.organizationId)
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  if (error) throw new Error(`customer_billing_projection_failed: ${error.message}`);
  if (purchaseError) throw new Error(`customer_billing_projection_failed: ${purchaseError.message}`);

  const betaTag = await getOrganizationBetaTag(input.organizationId);
  return [
    ...(data ?? []).map(mapCreditTransaction),
    ...(purchases ?? []).map(mapPurchaseRow),
  ]
    .filter((row): row is CustomerBillingEvent => row !== null)
    .map((row) => ({
      ...row,
      beta_cohort: betaTag.beta_cohort,
      beta_access_level: betaTag.beta_access_level,
      monetization_beta_enabled: betaTag.monetization_beta_enabled,
    }))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit);
}
