import { ownedDbTable } from '../db/writeOwner';
import { recordMonetizationOperationalEvent } from './monetizationOpsService';

export type MonetizationBetaSurface =
  | 'checkout'
  | 'payment_verify'
  | 'billing_history'
  | 'paid_report_generation'
  | 'support_operations';

export type MonetizationBetaAccessLevel = 'internal_staging' | 'invited_beta_user' | 'invited_beta_org';
export type MonetizationBetaSupportStatus = 'open' | 'investigating' | 'resolved' | 'customer-contact-required';
export type MonetizationBetaSupportAction = 'replay_fulfillment' | 'reconcile_reservation' | 'mark_reviewed' | 'escalate' | 'quarantine_review';

export interface MonetizationBetaAccessDecision {
  allowed: boolean;
  access_level: MonetizationBetaAccessLevel | 'denied';
  beta_cohort: string;
  reason: string;
  monetization_beta_enabled: boolean;
}

export interface MonetizationBetaHealthSummary {
  beta_cohort: string;
  economic_health: 'healthy' | 'watch' | 'risk' | 'critical';
  trust_risk: 'low' | 'medium' | 'high' | 'critical';
  unresolved_purchases: number;
  human_review_events: number;
  quarantined_reservations: number;
  failed_purchases: number;
  delayed_purchases: number;
  support_cases_open: number;
}

function csvContains(value: string | null | undefined, needle: string): boolean {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(needle);
}

export function getMonetizationBetaRuntimeMode() {
  return {
    externalBetaEnabled: process.env.EXTERNAL_BETA_ENABLED === 'true',
    internalStagingOnly: process.env.INTERNAL_STAGING_ONLY !== 'false',
    betaDisabled: process.env.MONETIZATION_BETA_DISABLED === 'true',
    betaFreeze: process.env.MONETIZATION_BETA_FREEZE === 'true',
    betaReplayPaused: process.env.MONETIZATION_BETA_REPLAY_PAUSED === 'true',
    betaCohort: process.env.MONETIZATION_BETA_COHORT || 'invited-external-beta',
  };
}

export async function resolveMonetizationBetaAccess(input: {
  organizationId: string;
  userId?: string | null;
  surface: MonetizationBetaSurface;
}): Promise<MonetizationBetaAccessDecision> {
  const mode = getMonetizationBetaRuntimeMode();
  if (mode.betaDisabled) {
    return {
      allowed: false,
      access_level: 'denied',
      beta_cohort: mode.betaCohort,
      reason: 'monetization_beta_disabled',
      monetization_beta_enabled: false,
    };
  }

  if (!mode.externalBetaEnabled) {
    return {
      allowed: true,
      access_level: 'internal_staging',
      beta_cohort: 'internal-staging',
      reason: 'internal_staging_mode',
      monetization_beta_enabled: false,
    };
  }

  if (mode.betaFreeze && ['checkout', 'payment_verify', 'paid_report_generation'].includes(input.surface)) {
    return {
      allowed: false,
      access_level: 'denied',
      beta_cohort: mode.betaCohort,
      reason: 'monetization_beta_freeze_enabled',
      monetization_beta_enabled: true,
    };
  }

  if (csvContains(process.env.MONETIZATION_BETA_ORG_ALLOWLIST, input.organizationId)) {
    return {
      allowed: true,
      access_level: 'invited_beta_org',
      beta_cohort: mode.betaCohort,
      reason: 'env_org_allowlist',
      monetization_beta_enabled: true,
    };
  }
  if (input.userId && csvContains(process.env.MONETIZATION_BETA_USER_ALLOWLIST, input.userId)) {
    return {
      allowed: true,
      access_level: 'invited_beta_user',
      beta_cohort: mode.betaCohort,
      reason: 'env_user_allowlist',
      monetization_beta_enabled: true,
    };
  }

  const [orgRow, userRow] = await Promise.all([
    ownedDbTable('monetization_beta_orgs')
      .select('organization_id, enabled, beta_cohort')
      .eq('organization_id', input.organizationId)
      .eq('enabled', true)
      .maybeSingle(),
    input.userId
      ? ownedDbTable('monetization_beta_users')
        .select('user_id, organization_id, enabled, beta_cohort')
        .eq('user_id', input.userId)
        .eq('organization_id', input.organizationId)
        .eq('enabled', true)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);

  if (orgRow.data) {
    return {
      allowed: true,
      access_level: 'invited_beta_org',
      beta_cohort: (orgRow.data as any).beta_cohort ?? mode.betaCohort,
      reason: 'org_allowlist',
      monetization_beta_enabled: true,
    };
  }
  if (userRow.data) {
    return {
      allowed: true,
      access_level: 'invited_beta_user',
      beta_cohort: (userRow.data as any).beta_cohort ?? mode.betaCohort,
      reason: 'user_allowlist',
      monetization_beta_enabled: true,
    };
  }

  return {
    allowed: false,
    access_level: 'denied',
    beta_cohort: mode.betaCohort,
    reason: 'not_invited_to_monetization_beta',
    monetization_beta_enabled: true,
  };
}

export async function assertMonetizationBetaAccess(input: {
  organizationId: string;
  userId?: string | null;
  surface: MonetizationBetaSurface;
}): Promise<MonetizationBetaAccessDecision> {
  const decision = await resolveMonetizationBetaAccess(input);
  if (!decision.allowed) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.beta_access_denied',
      severity: 'WARN',
      organizationId: input.organizationId,
      alertKey: 'beta_access_denied',
      customerImpact: 'possible',
      economicRisk: 'low',
      metadata: {
        surface: input.surface,
        user_id: input.userId ?? null,
        reason: decision.reason,
        beta_cohort: decision.beta_cohort,
      },
    });
    throw new Error(decision.reason);
  }
  return decision;
}

export async function getOrganizationBetaTag(organizationId?: string | null): Promise<{
  beta_cohort: string | null;
  beta_access_level: MonetizationBetaAccessLevel | null;
  monetization_beta_enabled: boolean;
}> {
  if (!organizationId) {
    return { beta_cohort: null, beta_access_level: null, monetization_beta_enabled: false };
  }
  const decision = await resolveMonetizationBetaAccess({
    organizationId,
    surface: 'billing_history',
  });
  return {
    beta_cohort: decision.allowed ? decision.beta_cohort : null,
    beta_access_level: decision.allowed ? decision.access_level as MonetizationBetaAccessLevel : null,
    monetization_beta_enabled: decision.monetization_beta_enabled,
  };
}

export async function listMonetizationBetaHealthSummary(input?: { lookbackHours?: number }): Promise<MonetizationBetaHealthSummary> {
  const lookbackHours = Math.min(Math.max(input?.lookbackHours ?? 24, 1), 168);
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const mode = getMonetizationBetaRuntimeMode();
  const [events, purchases, reservations, supportCases] = await Promise.all([
    ownedDbTable('monetization_operational_events')
      .select('requires_human_review, escalation_priority, alert_key, created_at')
      .gte('created_at', since)
      .eq('beta_cohort', mode.betaCohort)
      .limit(5000),
    ownedDbTable('credit_purchases')
      .select('id, fulfillment_status, status, created_at')
      .eq('provider', 'razorpay')
      .gte('created_at', since)
      .limit(5000),
    ownedDbTable('credit_transactions')
      .select('id, metadata, created_at')
      .eq('execution_phase', 'hold')
      .contains('metadata', { reconciliation_status: 'quarantined' })
      .gte('created_at', since)
      .limit(1000),
    ownedDbTable('monetization_beta_support_cases')
      .select('id, status, created_at')
      .neq('status', 'resolved')
      .gte('created_at', since)
      .limit(1000),
  ]);

  const eventRows = events.data ?? [];
  const purchaseRows = purchases.data ?? [];
  const humanReviewEvents = eventRows.filter((row: any) => row.requires_human_review === true).length;
  const failedPurchases = purchaseRows.filter((row: any) => row.status === 'failed' || row.fulfillment_status === 'failed').length;
  const unresolvedPurchases = purchaseRows.filter((row: any) => ['pending', 'event_recorded', 'failed'].includes(row.fulfillment_status)).length;
  const delayedPurchases = purchaseRows.filter((row: any) => {
    const ageMinutes = (Date.now() - new Date(row.created_at).getTime()) / 60000;
    return row.fulfillment_status !== 'completed' && ageMinutes >= Number(process.env.MONETIZATION_PENDING_PURCHASE_DELAY_MINUTES ?? 10);
  }).length;
  const quarantinedReservations = (reservations.data ?? []).length;
  const supportCasesOpen = (supportCases.data ?? []).length;

  const criticalSignals = eventRows.filter((row: any) => row.escalation_priority === 'critical').length;
  const urgentSignals = eventRows.filter((row: any) => row.escalation_priority === 'urgent').length;
  const trustRisk = criticalSignals > 0 || failedPurchases > 0
    ? 'critical'
    : urgentSignals > 0 || supportCasesOpen > 3
      ? 'high'
      : humanReviewEvents > 0 || delayedPurchases > 0
        ? 'medium'
        : 'low';
  const economicHealth = trustRisk === 'critical'
    ? 'critical'
    : trustRisk === 'high'
      ? 'risk'
      : trustRisk === 'medium'
        ? 'watch'
        : 'healthy';

  return {
    beta_cohort: mode.betaCohort,
    economic_health: economicHealth,
    trust_risk: trustRisk,
    unresolved_purchases: unresolvedPurchases,
    human_review_events: humanReviewEvents,
    quarantined_reservations: quarantinedReservations,
    failed_purchases: failedPurchases,
    delayed_purchases: delayedPurchases,
    support_cases_open: supportCasesOpen,
  };
}

export async function recordMonetizationBetaSupportAction(input: {
  caseId?: string | null;
  action: MonetizationBetaSupportAction;
  actorUserId: string;
  organizationId?: string | null;
  purchaseId?: string | null;
  reservationId?: string | null;
  providerEventId?: string | null;
  note?: string | null;
}) {
  const { data: actionRow, error } = await ownedDbTable('monetization_beta_support_actions')
    .insert({
      support_case_id: input.caseId ?? null,
      action: input.action,
      actor_user_id: input.actorUserId,
      organization_id: input.organizationId ?? null,
      purchase_id: input.purchaseId ?? null,
      reservation_id: input.reservationId ?? null,
      provider_event_id: input.providerEventId ?? null,
      note: input.note ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`beta_support_action_log_failed:${error.message}`);
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.beta_support_action_recorded',
    severity: input.action === 'escalate' ? 'WARN' : 'INFO',
    organizationId: input.organizationId ?? null,
    providerEventId: input.providerEventId ?? null,
    purchaseId: input.purchaseId ?? null,
    reservationId: input.reservationId ?? null,
    alertKey: input.action === 'escalate' ? 'beta_support_escalation' : null,
    metadata: {
      support_case_id: input.caseId ?? null,
      support_action_id: (actionRow as any).id,
      action: input.action,
      actor_user_id: input.actorUserId,
    },
  });
  return actionRow;
}

export async function updateMonetizationBetaSupportCase(input: {
  caseId?: string | null;
  status: MonetizationBetaSupportStatus;
  actorUserId: string;
  organizationId?: string | null;
  purchaseId?: string | null;
  reservationId?: string | null;
  providerEventId?: string | null;
  note?: string | null;
}) {
  let caseId = input.caseId ?? null;
  if (!caseId) {
    const { data, error } = await ownedDbTable('monetization_beta_support_cases')
      .insert({
        status: input.status,
        organization_id: input.organizationId ?? null,
        purchase_id: input.purchaseId ?? null,
        reservation_id: input.reservationId ?? null,
        provider_event_id: input.providerEventId ?? null,
        opened_by: input.actorUserId,
        latest_note: input.note ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(`beta_support_case_create_failed:${error.message}`);
    caseId = String((data as any).id);
  } else {
    const { error } = await ownedDbTable('monetization_beta_support_cases')
      .update({
        status: input.status,
        latest_note: input.note ?? null,
        updated_at: new Date().toISOString(),
        resolved_at: input.status === 'resolved' ? new Date().toISOString() : null,
      })
      .eq('id', caseId);
    if (error) throw new Error(`beta_support_case_update_failed:${error.message}`);
  }

  await recordMonetizationBetaSupportAction({
    caseId,
    action: input.status === 'resolved' ? 'mark_reviewed' : input.status === 'investigating' ? 'quarantine_review' : 'escalate',
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    purchaseId: input.purchaseId,
    reservationId: input.reservationId,
    providerEventId: input.providerEventId,
    note: input.note,
  });
  return { id: caseId, status: input.status };
}
