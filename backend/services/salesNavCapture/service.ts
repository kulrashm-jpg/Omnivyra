/**
 * `ingestCapturedSavedLeads`: the ONE entry point Outreach's capture route calls.
 *
 * Gates, in series. Each is cheap before the next, and every one fails closed:
 *
 *   1. SALESNAV_EXTENSION_CAPTURE_ENABLED: code constant, false (owner P-1).
 *   2. The verified context's tenant must equal the payload's, when the payload
 *      names one. The context is authoritative; the payload's tenant is only an
 *      assertion that must agree.
 *   3. resolveLeadIngestionGate: ENABLE_LEAD_INGESTION plus the tenant's
 *      `lead_ingestion` flag. This is the same gate every ingestion route uses.
 *   4. The tenant's own `salesnav_capture` flag (existing `feature_flags`; no
 *      schema change). Enabling lead ingestion does not opt a tenant into
 *      Sales Navigator capture.
 *   5. Provider availability, then envelope validation.
 *
 * Then each lead is validated and translated, and the valid ones go through
 * `ingestLeadBatch` unchanged: identity, account, prospect, provenance and
 * duplicate parking all happen there. Nothing here writes.
 *
 * The response carries a status per lead and NO ids and NO PII (agreed v1).
 */

import { evaluateFeatureFlag } from '../featureFlagService';
import { ownedDbTable } from '../../db/writeOwner';
import { ingestLeadBatch, resolveLeadIngestionGate } from '../leadIngestion/orchestrator';
import { hasLeadSourceAdapter, registerLeadSourceAdapter } from '../leadIngestion/registry';
import type { IngestionRecordOutcome } from '../leadIngestion/contracts';
import { SALESNAV_EXTENSION_CAPTURE_ENABLED, SALESNAV_LEAD_KEY_PROVISIONAL } from './captureSwitch';
import {
  SALESNAV_SOURCE,
  type CaptureBatchPayload,
  type CaptureBatchRefusal,
  type CaptureBatchResult,
  type CaptureCallerContext,
  type CaptureLeadOutcome,
} from './contract';
import { salesNavLeadSourceAdapter, toBatchRecord } from './adapter';
import { checkEnvelope, extensionSavedLeadsProvider } from './providers';

/** The per-tenant opt-in flag key. Declared once; a second spelling enables nobody. */
export const SALESNAV_CAPTURE_FLAG_KEY = 'salesnav_capture';

/** Idempotent, explicit registration (the registry refuses silent replacement). */
export function registerSalesNavLeadSource(): void {
  if (!hasLeadSourceAdapter(salesNavLeadSourceAdapter.source)) {
    registerLeadSourceAdapter(salesNavLeadSourceAdapter);
  }
}

const refuse = (refusal: CaptureBatchRefusal, detail?: string): CaptureBatchResult => ({
  ok: false,
  refusal,
  ...(detail ? { detail } : {}),
  leadKeyProvisional: SALESNAV_LEAD_KEY_PROVISIONAL,
  outcomes: [],
});

/** Map the orchestrator's verdict for one record to the agreed status vocabulary. */
export function toLeadOutcome(key: string | null, o: IngestionRecordOutcome): CaptureLeadOutcome {
  if (!o.ok) return { key, status: 'rejected', reason: o.rejection ?? 'ingestion_failed' };
  switch (o.provenanceOutcome) {
    case 'created': return { key, status: 'created' };
    case 'changed': return { key, status: 'updated' };
    case 'unchanged': return { key, status: 'unchanged' };
    // `ok` without a provenance verdict should not happen. It is reported as an
    // update rather than claimed as new.
    default: return { key, status: 'updated' };
  }
}

async function tenantCaptureFlag(orgId: string): Promise<{ allowed: boolean; reason: string }> {
  try {
    const r = await evaluateFeatureFlag({ organizationId: orgId, flagKey: SALESNAV_CAPTURE_FLAG_KEY, cohortKey: null });
    return { allowed: r.enabled, reason: `tenant_flag:${r.reason}` };
  } catch (e) {
    // A flag lookup that fails is a refusal. An open write surface is never the fallback.
    return { allowed: false, reason: `flag_evaluation_failed:${e instanceof Error ? e.name : 'error'}` };
  }
}

/**
 * The capture entry point Outreach's route calls. Runs the capture, then
 * records the run's TOTALS (counts only) in the usage ledger
 * `prospect_capture_runs`, for the tenant's "Data sources & usage" page.
 *
 * Ledger semantics (Outreach contract EXTENSION-1.5.0-CONTRACT.md §5.3:
 * "capture command_id is single-use; a repeat is a retry of the same batch"):
 * a COMPLETE run replaces that command's row; a refused or failed run is
 * written only when no row exists, so a failed retry never overwrites good
 * totals. A ledger write failure is logged and never fails the capture.
 */
export async function ingestCapturedSavedLeads(
  ctx: CaptureCallerContext,
  payload: CaptureBatchPayload,
  options: { now?: Date; recordRun?: typeof recordCaptureRun } = {},
): Promise<CaptureBatchResult> {
  const record = options.recordRun ?? recordCaptureRun;
  let result: CaptureBatchResult;
  try {
    result = await ingestCapturedSavedLeadsCore(ctx, payload, options);
  } catch (e) {
    await record(ctx, payload, null, e);
    throw e;
  }
  await record(ctx, payload, result, null);
  return result;
}

async function ingestCapturedSavedLeadsCore(
  ctx: CaptureCallerContext,
  payload: CaptureBatchPayload,
  options: { now?: Date } = {},
): Promise<CaptureBatchResult> {
  // 1. The code constant first: free, and it cannot be changed by configuration.
  if (!SALESNAV_EXTENSION_CAPTURE_ENABLED) return refuse('capture_disabled', 'code_constant_off');

  const orgId = String(ctx?.orgId ?? '').trim();
  if (!orgId) return refuse('organization_mismatch', 'context_without_tenant');
  // 2. The payload may name a tenant. If it does, the name must match the context.
  if (payload?.org_id != null && String(payload.org_id).trim() !== orgId) {
    return refuse('organization_mismatch', 'payload_tenant_differs');
  }

  // 3. The shared ingestion gate.
  const gate = await resolveLeadIngestionGate(orgId);
  if (!gate.allowed) return refuse('ingestion_not_enabled', gate.reason);

  // 4. The tenant's opt-in for this source specifically.
  const flag = await tenantCaptureFlag(orgId);
  if (!flag.allowed) return refuse('capture_not_enabled_for_tenant', flag.reason);

  // 5. The provider, then the envelope.
  const availability = await extensionSavedLeadsProvider.availability(orgId);
  if (!availability.available) return refuse('provider_unavailable', availability.reason);
  const now = options.now ?? new Date();
  const envelope = checkEnvelope(payload, now);
  if (envelope) return refuse(envelope.refusal, envelope.detail);

  const accepted = extensionSavedLeadsProvider.acceptBatch!(payload);
  const valid = accepted.rows.filter((r) => r.lead);

  let duplicatesParked = 0;
  const outcomes: CaptureLeadOutcome[] = accepted.rows.map((r) =>
    r.lead ? { key: r.key, status: 'rejected', reason: 'not_processed' } : { key: r.key, status: 'rejected', reason: r.reason });

  if (valid.length > 0) {
    registerSalesNavLeadSource();
    const batch = await ingestLeadBatch({
      organizationId: orgId,
      source: SALESNAV_SOURCE,
      records: valid.map((r) => toBatchRecord(r.lead!)),
      // Operational correlation only: the Outreach command that produced the batch.
      ingestionRunId: ctx.commandId ?? null,
      now: now.toISOString(),
    });
    duplicatesParked = batch.outcomes.filter((o) => o.ok && (o.duplicatesParked ?? 0) > 0).length;
    // `ingestLeadBatch` returns one outcome per input record, in order.
    let i = 0;
    accepted.rows.forEach((r, idx) => {
      if (!r.lead) return;
      const o = batch.outcomes[i++];
      outcomes[idx] = o ? toLeadOutcome(r.key, o) : { key: r.key, status: 'rejected', reason: 'no_outcome' };
    });
  }

  return {
    ok: true, leadKeyProvisional: SALESNAV_LEAD_KEY_PROVISIONAL, outcomes,
    totals: {
      received: accepted.rows.length,
      accepted: valid.length,
      created: outcomes.filter((o) => o.status === 'created').length,
      updated: outcomes.filter((o) => o.status === 'updated').length,
      unchanged: outcomes.filter((o) => o.status === 'unchanged').length,
      duplicatesParked: duplicatesParked,
    },
  };
}

/**
 * Write the run's totals to `prospect_capture_runs`. Counts and ids only.
 * `initiated_by` is the user Outreach's route VERIFIED (session -> user ->
 * active membership; the writer validation for that GOV-H actor column).
 */
export async function recordCaptureRun(
  ctx: CaptureCallerContext,
  payload: CaptureBatchPayload | null | undefined,
  result: CaptureBatchResult | null,
  error: unknown,
): Promise<void> {
  const org = String(ctx?.orgId ?? '').trim();
  const commandId = String(ctx?.commandId ?? '').trim();
  if (!org || !commandId) return;                    // no tenant or command: nothing attributable
  const received = Array.isArray(payload?.leads) ? payload!.leads.length : 0;
  const base = {
    organization_id: org, provider: SALESNAV_SOURCE, command_id: commandId,
    initiated_by: ctx.userId || null,
  };
  let row: Record<string, unknown>;
  if (error || !result) {
    row = { ...base, status: 'failed', received };
  } else if (!result.ok) {
    row = { ...base, status: 'refused', received, refused_reason: result.refusal ?? 'refused' };
  } else {
    const t = result.totals!;
    row = {
      ...base, status: 'complete', received: t.received, accepted: t.accepted, rejected: t.received - t.accepted,
      created: t.created, updated: t.updated, unchanged: t.unchanged, duplicates_parked: t.duplicatesParked,
      completed_at: new Date().toISOString(),
    };
  }
  try {
    const res = await ownedDbTable('prospect_capture_runs').upsert(row, {
      onConflict: 'organization_id,command_id',
      // ONLY a complete run replaces; anything else never overwrites existing totals.
      ignoreDuplicates: row.status !== 'complete',
    });
    if (res.error) console.warn('[salesNavCapture] capture run ledger write failed', { code: res.error.code ?? null });
  } catch {
    console.warn('[salesNavCapture] capture run ledger write threw');
  }
}
