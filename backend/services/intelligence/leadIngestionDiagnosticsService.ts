/**
 * Lead ingestion integrity diagnostics (READ-ONLY).
 *
 * Cross-checks the EXISTING ingestion outputs — tracking_events(form_submit)
 * vs leads vs form_conversions — to surface ingestion loss/lag, orphan leads,
 * and attribution loss. Reuses the existing leadQueueObservability snapshot
 * (no new queue, no DLQ, no writes).
 *
 * Ingestion flow it observes (unchanged):
 *   form_submit event → /api/leads (webhook/embed) → leads
 *     → recordLeadAttribution() → lead_attributions + form_conversions
 *     → engine-jobs (BullMQ jobQueue) → engine worker (LEAD jobs)
 */
import { ownedDbTable } from '../../db/writeOwner';
import {
  getLeadQueueObservabilitySnapshot,
  type LeadQueueObservabilitySnapshot,
} from '../../queue/leadQueueObservability';

export interface LeadIngestionDiagnosticsReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  formSubmitEvents: number;
  leadsCreated: number;
  formConversions: number;
  /** form_submit events with no corresponding lead — potential ingestion loss. */
  suspectedIngestionLoss: number;
  /** leads with no visitor_session — attribution loss. */
  orphanLeads: number;
  /** leads with no form_conversion row — conversion-event loss. */
  conversionEventGap: number;
  deliveryConfidence: number;
  queue: {
    available: boolean;
    snapshot: LeadQueueObservabilitySnapshot | null;
  };
  issues: string[];
  remediation: string[];
}

const DAY = 24 * 60 * 60 * 1000;

async function countSafe(build: () => any): Promise<number> {
  try {
    const { count, error } = await build();
    if (error) return 0;
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

export async function buildLeadIngestionDiagnostics(
  companyId: string,
  windowDays = 7,
): Promise<LeadIngestionDiagnosticsReport> {
  const sinceIso = new Date(Date.now() - windowDays * DAY).toISOString();
  const issues: string[] = [];
  const remediation: string[] = [];

  const formSubmitEvents = await countSafe(() =>
    ownedDbTable('tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('event_name', 'form_submit')
      .gte('occurred_at', sinceIso),
  );
  const leadsCreated = await countSafe(() =>
    ownedDbTable('leads')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', sinceIso),
  );
  const formConversions = await countSafe(() =>
    ownedDbTable('form_conversions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('converted_at', sinceIso),
  );
  const orphanLeads = await countSafe(() =>
    ownedDbTable('leads')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('visitor_session_id', null)
      .gte('created_at', sinceIso),
  );

  // form_submit events that never became a lead (heuristic, window-bounded).
  const suspectedIngestionLoss = Math.max(0, formSubmitEvents - leadsCreated);
  const conversionEventGap = Math.max(0, leadsCreated - formConversions);

  let queueSnapshot: LeadQueueObservabilitySnapshot | null = null;
  let queueAvailable = false;
  try {
    queueSnapshot = await getLeadQueueObservabilitySnapshot();
    queueAvailable = true;
  } catch {
    queueAvailable = false;
  }

  // Delivery confidence: lead capture coverage vs submit signal + queue health.
  let deliveryConfidence = 100;
  if (formSubmitEvents > 0) {
    deliveryConfidence = Math.round(
      Math.min(1, leadsCreated / formSubmitEvents) * 70 +
        (orphanLeads === 0 ? 15 : Math.max(0, 15 - Math.round((orphanLeads / Math.max(1, leadsCreated)) * 15))) +
        (conversionEventGap === 0 ? 15 : 5),
    );
  } else if (leadsCreated > 0) {
    deliveryConfidence = 80; // leads exist but no submit telemetry (webhook-only path)
  }
  deliveryConfidence = Math.max(0, Math.min(100, deliveryConfidence));

  if (suspectedIngestionLoss > 0 && formSubmitEvents > 0) {
    issues.push(`${suspectedIngestionLoss} form_submit events have no matching lead (possible ingestion loss).`);
    remediation.push('Verify form posts reach /api/leads (origin allow-list, webhook secret) and check engine-jobs LEAD failures (lead-job-failed logs).');
  }
  if (orphanLeads > 0) {
    issues.push(`${orphanLeads} leads created without a visitor session (attribution loss).`);
    remediation.push('Ensure submissions forward the tracker anonymous_id/session_id so sessions can stitch.');
  }
  if (conversionEventGap > 0) {
    issues.push(`${conversionEventGap} leads without a form_conversion record.`);
  }
  if (queueAvailable && queueSnapshot && (queueSnapshot as any).lastFailureCategory) {
    remediation.push('Lead queue reported recent failures — inspect leadQueueObservability snapshot.');
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    windowDays,
    formSubmitEvents,
    leadsCreated,
    formConversions,
    suspectedIngestionLoss,
    orphanLeads,
    conversionEventGap,
    deliveryConfidence,
    queue: { available: queueAvailable, snapshot: queueSnapshot },
    issues,
    remediation,
  };
}
