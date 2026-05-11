import { ownedDbTable } from '../db/writeOwner';
import { getRequestContext } from './requestContext';
import { logger } from './logger';

export type MonetizationSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type MonetizationEscalationPriority = 'informational' | 'support_review' | 'urgent' | 'critical';
export type MonetizationImpactLevel = 'none' | 'possible' | 'confirmed';
export type MonetizationRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface MonetizationOperationalEventInput {
  eventName: string;
  severity?: MonetizationSeverity;
  organizationId?: string | null;
  provider?: string | null;
  providerEventId?: string | null;
  providerOrderId?: string | null;
  paymentId?: string | null;
  purchaseId?: string | null;
  fulfillmentStatus?: string | null;
  reservationId?: string | null;
  alertKey?: string | null;
  alertReady?: boolean;
  customerSafe?: boolean;
  escalationPriority?: MonetizationEscalationPriority;
  requiresHumanReview?: boolean;
  customerImpact?: MonetizationImpactLevel;
  economicRisk?: MonetizationRiskLevel;
  betaCohort?: string | null;
  betaAccessLevel?: string | null;
  monetizationBetaEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export type MonetizationControlMode = {
  stagingEnabled: boolean;
  globalKillSwitch: boolean;
  webhookProcessingDisabled: boolean;
  fulfillmentPaused: boolean;
  readOnlyAuditMode: boolean;
  replayDryRunOnly: boolean;
  productionStagingAllowed: boolean;
  externalBetaEnabled: boolean;
  internalStagingOnly: boolean;
};

export function getMonetizationControlMode(): MonetizationControlMode {
  return {
    stagingEnabled: process.env.RAZORPAY_STAGING_ENABLED === 'true',
    globalKillSwitch: process.env.MONETIZATION_STAGING_KILL_SWITCH === 'true',
    webhookProcessingDisabled: process.env.MONETIZATION_WEBHOOK_PROCESSING_DISABLED === 'true',
    fulfillmentPaused: process.env.MONETIZATION_FULFILLMENT_PAUSED === 'true',
    readOnlyAuditMode: process.env.MONETIZATION_READ_ONLY_AUDIT_MODE === 'true',
    replayDryRunOnly: process.env.MONETIZATION_REPLAY_DRY_RUN_ONLY === 'true',
    productionStagingAllowed: process.env.RAZORPAY_ALLOW_PRODUCTION_STAGING === 'true',
    externalBetaEnabled: process.env.EXTERNAL_BETA_ENABLED === 'true',
    internalStagingOnly: process.env.INTERNAL_STAGING_ONLY !== 'false',
  };
}

export function assertMonetizationOperationAllowed(operation: 'order_create' | 'webhook_process' | 'fulfillment' | 'admin_mutation' | 'replay'): void {
  const mode = getMonetizationControlMode();
  if (!mode.stagingEnabled) throw new Error('monetization_staging_disabled');
  if (mode.globalKillSwitch) throw new Error('monetization_global_kill_switch_enabled');
  if (operation === 'webhook_process' && mode.webhookProcessingDisabled) throw new Error('monetization_webhook_processing_disabled');
  if (operation === 'fulfillment' && mode.fulfillmentPaused) throw new Error('monetization_fulfillment_paused');
  if (operation === 'admin_mutation' && mode.readOnlyAuditMode) throw new Error('monetization_read_only_audit_mode');
  if (operation === 'replay' && mode.replayDryRunOnly) throw new Error('monetization_replay_dry_run_only');
}

export function assertMonetizationExposureModeConfigured(): void {
  const mode = getMonetizationControlMode();
  if (mode.externalBetaEnabled && mode.internalStagingOnly) {
    throw new Error('monetization_exposure_mode_conflict');
  }
  if (!mode.externalBetaEnabled && !mode.internalStagingOnly) {
    throw new Error('monetization_exposure_mode_unconfigured');
  }
}

function deriveEscalation(input: MonetizationOperationalEventInput, severity: MonetizationSeverity): {
  escalationPriority: MonetizationEscalationPriority;
  requiresHumanReview: boolean;
  customerImpact: MonetizationImpactLevel;
  economicRisk: MonetizationRiskLevel;
} {
  const alertKey = input.alertKey ?? '';
  const eventName = input.eventName;
  let escalationPriority: MonetizationEscalationPriority = 'informational';
  let customerImpact: MonetizationImpactLevel = 'none';
  let economicRisk: MonetizationRiskLevel = 'none';

  if (severity === 'WARN') {
    escalationPriority = 'support_review';
    economicRisk = 'low';
  }
  if (severity === 'ERROR') {
    escalationPriority = 'urgent';
    customerImpact = 'possible';
    economicRisk = 'medium';
  }
  if (severity === 'CRITICAL') {
    escalationPriority = 'critical';
    customerImpact = 'confirmed';
    economicRisk = 'critical';
  }

  if (/fulfillment|purchase|payment|amount|currency|org_mismatch|reservation|orphan|quarantine/.test(alertKey + eventName)) {
    customerImpact = severity === 'INFO' ? 'possible' : customerImpact === 'none' ? 'possible' : customerImpact;
    economicRisk = severity === 'INFO' ? 'low' : economicRisk === 'none' ? 'medium' : economicRisk;
  }
  if (/signature|replay|duplicate/.test(alertKey + eventName)) {
    economicRisk = severity === 'CRITICAL' ? 'critical' : economicRisk === 'none' ? 'medium' : economicRisk;
  }

  return {
    escalationPriority: input.escalationPriority ?? escalationPriority,
    requiresHumanReview: input.requiresHumanReview ?? ['support_review', 'urgent', 'critical'].includes(input.escalationPriority ?? escalationPriority),
    customerImpact: input.customerImpact ?? customerImpact,
    economicRisk: input.economicRisk ?? economicRisk,
  };
}

export async function recordMonetizationOperationalEvent(input: MonetizationOperationalEventInput): Promise<void> {
  const ctx = getRequestContext();
  const severity = input.severity ?? 'INFO';
  const escalation = deriveEscalation(input, severity);
  const payload = {
    namespace: 'monetization',
    event_name: input.eventName,
    severity,
    organization_id: input.organizationId ?? null,
    request_id: ctx.requestId ?? null,
    correlation_id: ctx.correlationId ?? null,
    provider: input.provider ?? null,
    provider_event_id: input.providerEventId ?? null,
    provider_order_id: input.providerOrderId ?? null,
    provider_payment_id: input.paymentId ?? null,
    purchase_id: input.purchaseId ?? null,
    fulfillment_status: input.fulfillmentStatus ?? null,
    reservation_id: input.reservationId ?? null,
    alert_key: input.alertKey ?? null,
    alert_ready: input.alertReady === true || severity === 'ERROR' || severity === 'CRITICAL',
    customer_safe: input.customerSafe === true,
    escalation_priority: escalation.escalationPriority,
    requires_human_review: escalation.requiresHumanReview,
    customer_impact: escalation.customerImpact,
    economic_risk: escalation.economicRisk,
    beta_cohort: input.betaCohort ?? (typeof input.metadata?.beta_cohort === 'string' ? input.metadata.beta_cohort : null),
    beta_access_level: input.betaAccessLevel ?? (typeof input.metadata?.beta_access_level === 'string' ? input.metadata.beta_access_level : null),
    monetization_beta_enabled: input.monetizationBetaEnabled ?? Boolean(input.metadata?.monetization_beta_enabled),
    metadata: input.metadata ?? {},
  };

  const logPayload = {
    category: 'monetization',
    orgId: payload.organization_id,
    provider: payload.provider,
    providerEventId: payload.provider_event_id,
    providerOrderId: payload.provider_order_id,
    paymentId: payload.provider_payment_id,
    purchaseId: payload.purchase_id,
    fulfillmentStatus: payload.fulfillment_status,
    reservationId: payload.reservation_id,
    alertKey: payload.alert_key,
    escalationPriority: payload.escalation_priority,
    customerImpact: payload.customer_impact,
    economicRisk: payload.economic_risk,
    betaCohort: payload.beta_cohort,
    betaAccessLevel: payload.beta_access_level,
    ...payload.metadata,
  };
  if (severity === 'CRITICAL' || severity === 'ERROR') logger.error(input.eventName, logPayload);
  else if (severity === 'WARN') logger.warn(input.eventName, logPayload);
  else logger.info(input.eventName, logPayload);

  const { error } = await ownedDbTable('monetization_operational_events').insert(payload);
  if (error) {
    logger.error('monetization.operational_event_insert_failed', {
      category: 'monetization',
      eventName: input.eventName,
      message: error.message,
    });
  }
}

export async function listMonetizationOperationalEvents(input?: {
  limit?: number;
  alertOnly?: boolean;
  severity?: MonetizationSeverity;
  providerEventId?: string;
  purchaseId?: string;
}) {
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
  let query = ownedDbTable('monetization_operational_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (input?.alertOnly) query = query.eq('alert_ready', true);
  if (input?.severity) query = query.eq('severity', input.severity);
  if (input?.providerEventId) query = query.eq('provider_event_id', input.providerEventId);
  if (input?.purchaseId) query = query.eq('purchase_id', input.purchaseId);
  const { data, error } = await query;
  if (error) throw new Error(`monetization_ops_list_failed:${error.message}`);
  return data ?? [];
}

export async function getMonetizationAlertSummary(input?: { lookbackHours?: number; limit?: number }) {
  const lookbackHours = Math.min(Math.max(input?.lookbackHours ?? 24, 1), 168);
  const limit = Math.min(Math.max(input?.limit ?? 1000, 1), 5000);
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await ownedDbTable('monetization_operational_events')
    .select('event_name, severity, alert_key, escalation_priority, requires_human_review, customer_impact, economic_risk, provider_event_id, purchase_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`monetization_alert_summary_failed:${error.message}`);

  const rows = data ?? [];
  const countBy = (matcher: (row: any) => boolean) => rows.filter(matcher).length;
  const byPriority = rows.reduce<Record<string, number>>((acc, row: any) => {
    const key = row.escalation_priority ?? 'informational';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    lookback_hours: lookbackHours,
    total_events: rows.length,
    requires_human_review: countBy((row: any) => row.requires_human_review === true),
    by_priority: byPriority,
    surfaces: {
      replay_spikes: countBy((row: any) => /replay|duplicate/.test(String(row.alert_key ?? row.event_name ?? ''))),
      pending_purchase_growth: countBy((row: any) => /purchase|fulfillment/.test(String(row.alert_key ?? row.event_name ?? '')) && row.requires_human_review === true),
      quarantine_growth: countBy((row: any) => /quarantine/.test(String(row.alert_key ?? row.event_name ?? ''))),
      repeated_signature_failures: countBy((row: any) => /signature/.test(String(row.alert_key ?? row.event_name ?? ''))),
      repeated_fulfillment_retries: countBy((row: any) => /fulfillment_failed|fulfillment_retry/.test(String(row.alert_key ?? row.event_name ?? ''))),
    },
    recent_review_events: rows
      .filter((row: any) => row.requires_human_review === true)
      .slice(0, 25),
  };
}
