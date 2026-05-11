import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_MANAGE } from '@/shared/contracts/security';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  assertMonetizationOperationAllowed,
  getMonetizationAlertSummary,
  getMonetizationControlMode,
  listMonetizationOperationalEvents,
  recordMonetizationOperationalEvent,
} from '@/backend/services/monetizationOpsService';
import {
  auditMonetizationInvariants,
  reconcileDurableMonetizationReservations,
} from '@/backend/services/monetizationReservationReconciliationService';
import { replayRazorpayStagingProviderEvent } from '@/backend/services/payments/razorpayStagingService';
import {
  listMonetizationSupportCases,
  listMonetizationSupportRunbooks,
} from '@/backend/services/monetizationSupportRunbookService';
import {
  getMonetizationBetaRuntimeMode,
  listMonetizationBetaHealthSummary,
  recordMonetizationBetaSupportAction,
  updateMonetizationBetaSupportCase,
} from '@/backend/services/monetizationBetaAccessService';
import {
  buildMonetizationIncidentTimeline,
  getMonetizationDailyReviewSummary,
  listMonetizationBetaDrillSummary,
  recordMonetizationBetaDrill,
} from '@/backend/services/monetizationIncidentOpsService';

function numberFromQuery(v: unknown, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function loadOperationalSnapshot(limit: number) {
  const [events, rejectedEvents, unresolvedPurchases, quarantinedReservations, supportCases, alertSummary, betaHealth, dailyReview, drills] = await Promise.all([
    listMonetizationOperationalEvents({ limit }),
    ownedDbTable('payment_provider_events')
      .select('id, provider, provider_event_id, event_type, purchase_id, organization_id, processing_status, error_message, provider_order_id, provider_payment_id, received_at')
      .eq('provider', 'razorpay')
      .in('processing_status', ['recorded', 'failed', 'duplicate'])
      .order('received_at', { ascending: false })
      .limit(limit),
    ownedDbTable('credit_purchases')
      .select('id, organization_id, provider, provider_mode, provider_order_id, provider_payment_id, status, fulfillment_status, fulfillment_error, credits, amount_paid, currency, created_at, updated_at')
      .eq('provider', 'razorpay')
      .in('fulfillment_status', ['pending', 'event_recorded', 'failed'])
      .order('created_at', { ascending: false })
      .limit(limit),
    ownedDbTable('credit_transactions')
      .select('id, organization_id, reference_type, reference_id, idempotency_key, execution_phase, created_at, metadata')
      .eq('execution_phase', 'hold')
      .contains('metadata', { reconciliation_status: 'quarantined' })
      .order('created_at', { ascending: false })
      .limit(limit),
    listMonetizationSupportCases({ limit }),
    getMonetizationAlertSummary({ limit: 1000 }),
    listMonetizationBetaHealthSummary(),
    getMonetizationDailyReviewSummary(),
    listMonetizationBetaDrillSummary(),
  ]);

  return {
    controls: getMonetizationControlMode(),
    beta_runtime: getMonetizationBetaRuntimeMode(),
    beta_health: betaHealth,
    events,
    rejected_provider_events: rejectedEvents.data ?? [],
    unresolved_purchases: unresolvedPurchases.data ?? [],
    quarantined_reservations: quarantinedReservations.data ?? [],
    support_cases: supportCases,
    support_runbooks: listMonetizationSupportRunbooks(),
    alert_summary: alertSummary,
    daily_review: dailyReview,
    drills,
    query_errors: [
      rejectedEvents.error ? { surface: 'payment_provider_events', message: rejectedEvents.error.message } : null,
      unresolvedPurchases.error ? { surface: 'credit_purchases', message: unresolvedPurchases.error.message } : null,
      quarantinedReservations.error ? { surface: 'credit_transactions', message: quarantinedReservations.error.message } : null,
    ].filter(Boolean),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const guard = await requireCapability(req, res, {
    capability: BILLING_MANAGE,
    reason: `super-admin monetization operations ${req.method}`,
    resourceId: typeof req.query.purchaseId === 'string' ? req.query.purchaseId : null,
  });
  if (guard.ok !== true) return;

  if (req.method === 'GET') {
    const limit = Math.min(numberFromQuery(req.query.limit, 100), 500);
    const includeAudit = String(req.query.audit ?? 'false') === 'true';
    if (req.query.view === 'timeline') {
      const timeline = await buildMonetizationIncidentTimeline({
        organizationId: typeof req.query.organization_id === 'string' ? req.query.organization_id : null,
        purchaseId: typeof req.query.purchase_id === 'string' ? req.query.purchase_id : null,
        providerEventId: typeof req.query.provider_event_id === 'string' ? req.query.provider_event_id : null,
        reservationId: typeof req.query.reservation_id === 'string' ? req.query.reservation_id : null,
        audience: req.query.audience === 'customer_safe' ? 'customer_safe' : 'support',
        limit,
      });
      await recordMonetizationOperationalEvent({
        eventName: 'monetization.admin_incident_timeline_viewed',
        severity: 'INFO',
        metadata: { actor_user_id: guard.principal.userId, query: req.query },
      });
      return res.status(200).json({ ok: true, timeline });
    }

    const snapshot = await loadOperationalSnapshot(limit);
    const audit = includeAudit ? await auditMonetizationInvariants({ limit }) : null;
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.admin_operations_viewed',
      severity: 'INFO',
      metadata: { actor_user_id: guard.principal.userId, include_audit: includeAudit },
    });
    return res.status(200).json({ ok: true, ...snapshot, audit });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const action = String(body?.action ?? '').trim();

  try {
    if (action === 'reconcile') {
      assertMonetizationOperationAllowed('admin_mutation');
      const result = await reconcileDurableMonetizationReservations({
        minAgeSeconds: Number(body?.minAgeSeconds ?? 600),
        batchLimit: Number(body?.batchLimit ?? 100),
        orgId: typeof body?.organization_id === 'string' ? body.organization_id : undefined,
        reconciledBy: `super-admin:${guard.principal.userId}`,
      });
      await recordMonetizationOperationalEvent({
        eventName: 'monetization.admin_reconciliation_triggered',
        severity: result.failed > 0 || result.quarantined > 0 ? 'WARN' : 'INFO',
        organizationId: typeof body?.organization_id === 'string' ? body.organization_id : null,
        alertKey: result.failed > 0 || result.quarantined > 0 ? 'admin_reconciliation_attention' : null,
        metadata: { actor_user_id: guard.principal.userId, result },
      });
      return res.status(200).json({ ok: true, result });
    }

    if (action === 'retry_provider_event') {
      const providerEventRowId = String(body?.provider_event_row_id ?? '').trim();
      if (!providerEventRowId) return res.status(400).json({ error: 'provider_event_row_id is required' });
      const dryRun = body?.dryRun !== false || getMonetizationControlMode().replayDryRunOnly;
      if (!dryRun) assertMonetizationOperationAllowed('admin_mutation');
      const result = await replayRazorpayStagingProviderEvent({ providerEventRowId, dryRun });
      await recordMonetizationOperationalEvent({
        eventName: dryRun ? 'monetization.admin_provider_event_replay_dry_run' : 'monetization.admin_provider_event_replay_executed',
        severity: dryRun ? 'INFO' : 'WARN',
        alertKey: dryRun ? null : 'admin_provider_event_replay',
        metadata: { actor_user_id: guard.principal.userId, provider_event_row_id: providerEventRowId, result },
      });
      return res.status(200).json({ ok: true, dryRun, result });
    }

    if (action === 'audit') {
      const result = await auditMonetizationInvariants({ limit: Number(body?.limit ?? 250) });
      await recordMonetizationOperationalEvent({
        eventName: 'monetization.admin_invariant_audit_triggered',
        severity: 'INFO',
        metadata: { actor_user_id: guard.principal.userId },
      });
      return res.status(200).json({ ok: true, result });
    }

    if (action === 'beta_support_case') {
      assertMonetizationOperationAllowed('admin_mutation');
      const result = await updateMonetizationBetaSupportCase({
        caseId: typeof body?.case_id === 'string' ? body.case_id : null,
        status: body?.status,
        actorUserId: guard.principal.userId,
        organizationId: typeof body?.organization_id === 'string' ? body.organization_id : null,
        purchaseId: typeof body?.purchase_id === 'string' ? body.purchase_id : null,
        reservationId: typeof body?.reservation_id === 'string' ? body.reservation_id : null,
        providerEventId: typeof body?.provider_event_id === 'string' ? body.provider_event_id : null,
        note: typeof body?.note === 'string' ? body.note : null,
      });
      return res.status(200).json({ ok: true, result });
    }

    if (action === 'beta_support_action') {
      assertMonetizationOperationAllowed('admin_mutation');
      const result = await recordMonetizationBetaSupportAction({
        caseId: typeof body?.case_id === 'string' ? body.case_id : null,
        action: body?.support_action,
        actorUserId: guard.principal.userId,
        organizationId: typeof body?.organization_id === 'string' ? body.organization_id : null,
        purchaseId: typeof body?.purchase_id === 'string' ? body.purchase_id : null,
        reservationId: typeof body?.reservation_id === 'string' ? body.reservation_id : null,
        providerEventId: typeof body?.provider_event_id === 'string' ? body.provider_event_id : null,
        note: typeof body?.note === 'string' ? body.note : null,
      });
      return res.status(200).json({ ok: true, result });
    }

    if (action === 'record_beta_drill') {
      const result = await recordMonetizationBetaDrill({
        drillType: body?.drill_type,
        status: body?.status,
        operatorUserId: guard.principal.userId,
        expectedOutcome: String(body?.expected_outcome ?? '').trim(),
        observedOutcome: typeof body?.observed_outcome === 'string' ? body.observed_outcome : null,
        anomaliesFound: Array.isArray(body?.anomalies_found) ? body.anomalies_found.map(String) : [],
        economicImpactAssessment: typeof body?.economic_impact_assessment === 'string' ? body.economic_impact_assessment : null,
        followUpActions: Array.isArray(body?.follow_up_actions) ? body.follow_up_actions.map(String) : [],
        organizationId: typeof body?.organization_id === 'string' ? body.organization_id : null,
        purchaseId: typeof body?.purchase_id === 'string' ? body.purchase_id : null,
        providerEventId: typeof body?.provider_event_id === 'string' ? body.provider_event_id : null,
      });
      return res.status(200).json({ ok: true, result });
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (err) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.admin_operation_failed',
      severity: 'ERROR',
      alertKey: 'admin_operation_failed',
      metadata: {
        actor_user_id: guard.principal.userId,
        action,
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
