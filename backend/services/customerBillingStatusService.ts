export type CustomerSafeBillingState =
  | 'payment_processing'
  | 'credits_pending'
  | 'credits_added'
  | 'credits_reserved'
  | 'credits_used'
  | 'credits_restored'
  | 'credits_expired'
  | 'payment_failed'
  | 'payment_under_review';

export type CustomerRecoveryStatus =
  | 'processing_normally'
  | 'delayed_no_action_needed'
  | 'needs_review'
  | 'contact_support'
  | 'credits_restored';

export interface CustomerBillingGuidance {
  expected_wait: string | null;
  retry_guidance: string | null;
  support_escalation_hint: string | null;
  money_moved: boolean | null;
  credits_granted: boolean;
  recovery_status: CustomerRecoveryStatus;
}

export interface BillingAgeClassification {
  age_minutes: number | null;
  recovery_status: CustomerRecoveryStatus;
  support_escalation_required: boolean;
  customer_label_suffix: string | null;
}

const DEFAULT_PENDING_PURCHASE_DELAY_MINUTES = 10;
const DEFAULT_PENDING_PURCHASE_REVIEW_MINUTES = 30;
const DEFAULT_PENDING_RESERVATION_DELAY_MINUTES = 20;
const DEFAULT_PENDING_RESERVATION_REVIEW_MINUTES = 60;

function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 60000));
}

function thresholdFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function classifyPendingPurchaseAge(createdAt: string | null | undefined): BillingAgeClassification {
  const age = minutesSince(createdAt);
  const delayed = thresholdFromEnv('MONETIZATION_PENDING_PURCHASE_DELAY_MINUTES', DEFAULT_PENDING_PURCHASE_DELAY_MINUTES);
  const review = thresholdFromEnv('MONETIZATION_PENDING_PURCHASE_REVIEW_MINUTES', DEFAULT_PENDING_PURCHASE_REVIEW_MINUTES);
  if (age === null || age < delayed) {
    return {
      age_minutes: age,
      recovery_status: 'processing_normally',
      support_escalation_required: false,
      customer_label_suffix: null,
    };
  }
  if (age < review) {
    return {
      age_minutes: age,
      recovery_status: 'delayed_no_action_needed',
      support_escalation_required: false,
      customer_label_suffix: 'Delayed - no action needed',
    };
  }
  return {
    age_minutes: age,
    recovery_status: 'contact_support',
    support_escalation_required: true,
    customer_label_suffix: 'Contact support',
  };
}

export function classifyPendingReservationAge(createdAt: string | null | undefined): BillingAgeClassification {
  const age = minutesSince(createdAt);
  const delayed = thresholdFromEnv('MONETIZATION_PENDING_RESERVATION_DELAY_MINUTES', DEFAULT_PENDING_RESERVATION_DELAY_MINUTES);
  const review = thresholdFromEnv('MONETIZATION_PENDING_RESERVATION_REVIEW_MINUTES', DEFAULT_PENDING_RESERVATION_REVIEW_MINUTES);
  if (age === null || age < delayed) {
    return {
      age_minutes: age,
      recovery_status: 'processing_normally',
      support_escalation_required: false,
      customer_label_suffix: null,
    };
  }
  if (age < review) {
    return {
      age_minutes: age,
      recovery_status: 'delayed_no_action_needed',
      support_escalation_required: false,
      customer_label_suffix: 'Delayed - no action needed',
    };
  }
  return {
    age_minutes: age,
    recovery_status: 'needs_review',
    support_escalation_required: true,
    customer_label_suffix: 'Needs review',
  };
}

export function guidanceForCustomerState(state: CustomerSafeBillingState, recoveryStatus?: CustomerRecoveryStatus): CustomerBillingGuidance {
  if (state === 'payment_processing' || state === 'credits_pending') {
    const recovery = recoveryStatus ?? 'processing_normally';
    return {
      expected_wait: recovery === 'processing_normally'
        ? 'Credits usually appear within a few minutes.'
        : recovery === 'delayed_no_action_needed'
          ? 'This is taking longer than usual, but no action is needed yet.'
          : 'Our team may need to review this payment before credits are added.',
      retry_guidance: 'Do not retry payment unless checkout clearly failed.',
      support_escalation_hint: recovery === 'contact_support' || recovery === 'needs_review'
        ? 'Contact support with the payment reference shown here.'
        : null,
      money_moved: null,
      credits_granted: false,
      recovery_status: recovery,
    };
  }

  if (state === 'payment_failed') {
    return {
      expected_wait: null,
      retry_guidance: 'You can retry payment if no credits were added.',
      support_escalation_hint: 'Contact support if your bank shows a successful debit.',
      money_moved: false,
      credits_granted: false,
      recovery_status: 'contact_support',
    };
  }

  if (state === 'payment_under_review') {
    return {
      expected_wait: 'Support is reviewing this payment state.',
      retry_guidance: 'Do not retry this payment while it is under review.',
      support_escalation_hint: 'Contact support with the payment reference shown here.',
      money_moved: true,
      credits_granted: false,
      recovery_status: 'needs_review',
    };
  }

  if (state === 'credits_added') {
    return {
      expected_wait: null,
      retry_guidance: null,
      support_escalation_hint: null,
      money_moved: true,
      credits_granted: true,
      recovery_status: 'processing_normally',
    };
  }

  if (state === 'credits_reserved') {
    const recovery = recoveryStatus ?? 'processing_normally';
    return {
      expected_wait: recovery === 'processing_normally'
        ? 'Reserved credits are restored automatically if generation fails.'
        : 'This reservation is taking longer than usual and may be reviewed.',
      retry_guidance: 'Do not start the same paid action again unless the previous attempt failed.',
      support_escalation_hint: recovery === 'needs_review' ? 'Contact support if the action appears stuck.' : null,
      money_moved: false,
      credits_granted: false,
      recovery_status: recovery,
    };
  }

  if (state === 'credits_restored') {
    return {
      expected_wait: null,
      retry_guidance: 'You may retry the action if you still need the output.',
      support_escalation_hint: null,
      money_moved: false,
      credits_granted: false,
      recovery_status: 'credits_restored',
    };
  }

  return {
    expected_wait: null,
    retry_guidance: null,
    support_escalation_hint: null,
    money_moved: false,
    credits_granted: false,
    recovery_status: 'processing_normally',
  };
}

export function customerDisplayLabel(state: CustomerSafeBillingState): string {
  switch (state) {
    case 'payment_processing': return 'Payment Processing';
    case 'credits_pending': return 'Credits Pending';
    case 'credits_added': return 'Credits Added';
    case 'credits_reserved': return 'Credits Reserved';
    case 'credits_used': return 'Credits Used';
    case 'credits_restored': return 'Credits Restored';
    case 'credits_expired': return 'Credits Expired';
    case 'payment_failed': return 'Payment Failed';
    case 'payment_under_review': return 'Payment Under Review';
    default: return 'Billing Update';
  }
}
