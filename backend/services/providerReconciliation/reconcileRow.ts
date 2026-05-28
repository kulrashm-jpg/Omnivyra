/**
 * Top-level reconciliation entry point.
 *
 * Loads a row, picks the right detector based on the row's current state,
 * runs it, emits a structured telemetry event, and appends a snapshot to
 * `creator_attachment_metadata.reconciliation_snapshots`.
 *
 * This function performs ZERO state mutation on the row (no status change,
 * no platform_post_id rewrite, no media columns touched). It is the
 * observability-only entry to the reconciliation foundation.
 *
 * Repair actions live in a future phase. The DriftAnalysis returned here
 * carries a `repairHint` for operator decision-making.
 *
 * Importing the providers barrel as a side effect to register all stub
 * lookups. Future implementations replace the stubs in-place without
 * changing this caller.
 */

import './providers'; // side-effect: register provider lookups
import { getScheduledPost } from '../../db/queries';
import { logPipelineEvent, type PipelineEvent } from '../../../lib/shared/observability';
import { appendReconciliationSnapshot } from './snapshots';
import { verifyPublishedPost } from './driftDetection';
import type { DriftAnalysis, ReconciliationSnapshot } from './types';

export interface ReconcileRowResult {
  ran: boolean;
  reason?: 'row_not_found' | 'no_platform_post_id' | 'no_social_account';
  analysis?: DriftAnalysis;
}

/**
 * Reconcile a single scheduled_posts row against the provider.
 *
 * Today only the published-row verification path is wired. Rows in other
 * states (failed/blocked/draft) require orphan-detection scaffolding that
 * is out of scope for this foundation phase.
 */
export async function reconcileRow(input: { rowId: string }): Promise<ReconcileRowResult> {
  const row = await getScheduledPost(input.rowId);
  if (!row) return { ran: false, reason: 'row_not_found' };
  if (!row.platform_post_id) return { ran: false, reason: 'no_platform_post_id' };
  if (!row.social_account_id) return { ran: false, reason: 'no_social_account' };

  const analysis = await verifyPublishedPost({
    rowId: row.id,
    platform: row.platform,
    socialAccountId: row.social_account_id,
    platformPostId: row.platform_post_id,
  });

  emitReconciliationTelemetry(analysis);

  // Persist the snapshot for forensic audit. Best-effort; failures are
  // logged inside the helper.
  const snapshot: ReconciliationSnapshot = {
    timestamp: new Date().toISOString(),
    platform: analysis.platform,
    kind: analysis.kind,
    platformPostId: row.platform_post_id,
    diagnostic: analysis.diagnostic.slice(0, 500),
    confidence: analysis.lookup?.confidence,
  };
  await appendReconciliationSnapshot(row.id, snapshot);

  return { ran: true, analysis };
}

/**
 * Emit one structured event per DriftAnalysis. Each kind maps to a stable
 * event name so dashboards can show absolute counts per drift class.
 *
 * Tags are platform + rowId + diagnostic-safe context only — no URLs, no
 * secrets, no content.
 */
function emitReconciliationTelemetry(analysis: DriftAnalysis): void {
  if (!analysis.shouldEmit) {
    // In-sync — silent success. Emit a debug-level success event so dashboards
    // can show a verified-rate alongside the drift events.
    logPipelineEvent('reconciliation.success', 'info', {
      platform: analysis.platform,
      row_id: analysis.rowId,
    }, { dedupeKey: `reconciliation.success.${analysis.platform}`, throttleMs: 30_000 });
    return;
  }

  const event = `reconciliation.${analysis.kind}` as PipelineEvent;
  const severity: 'info' | 'warn' | 'error' = analysis.kind === 'unverifiable' ? 'info'
    : analysis.kind === 'in_sync' ? 'info'
    : 'warn';
  logPipelineEvent(event, severity, {
    platform: analysis.platform,
    row_id: analysis.rowId,
    diagnostic: analysis.diagnostic.slice(0, 200),
    ...(analysis.tags ?? {}),
    ...(analysis.repairHint ? { repair_hint: analysis.repairHint.slice(0, 200) } : {}),
    ...(analysis.lookup?.confidence ? { lookup_confidence: analysis.lookup.confidence } : {}),
  }, { dedupeKey: `reconciliation.${analysis.kind}.${analysis.platform}`, throttleMs: 10_000 });
}
