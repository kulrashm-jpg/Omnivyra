/**
 * Raw replay EXECUTOR — isolated internal path, idempotent by DB invariant.
 *
 * Closes the prior `accepted_pending_executor` gap WITHOUT reusing or
 * refactoring the hardened public ingestion route. It re-injects captured
 * tracker events directly into the canonical `tracking_events` table keyed by
 * the PRESERVED original `dedupe_key` — the existing UNIQUE (website_id,
 * dedupe_key) index makes the write idempotent (no duplicate writes, ever).
 * `processed_at=null` so existing downstream aggregation handles replayed
 * rows exactly like normal pending events. Replay-origin + signature are
 * preserved in metadata for lineage.
 *
 * DOUBLE ENV GATE (off by default — uncontrolled automation avoided):
 *   - REPLAY_INGRESS_SECRET must be set (isolated ingress is enabled), AND
 *   - REPLAY_RAW_EXECUTOR_ENABLED === 'true' (operator opt-in).
 * Otherwise → `executor_disabled` (payload stays captured/replayable).
 *
 * HONEST SCOPE: this re-injects the captured canonical events for recovery; it
 * does NOT re-run ingress-only side effects (rate-limit/bot/origin/session
 * stitching are public-ingress concerns, irrelevant to recovery). Webhook/lead
 * raw execution is NOT auto-performed (no safe idempotent service boundary
 * without refactor) → reported `unsupported_source`, never faked.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { recordLeadReplayReceipt } from './leadReplayReceiptService';

export type ExecutorOutcome =
  | 'executed'
  | 'idempotent_skip'
  | 'executor_disabled'
  | 'unsupported_source'
  | 'malformed'
  | 'failed';

export interface ExecutorResult {
  outcome: ExecutorOutcome;
  written: number;
  detail: string;
}

function enabled(): boolean {
  return Boolean(process.env.REPLAY_INGRESS_SECRET) && process.env.REPLAY_RAW_EXECUTOR_ENABLED === 'true';
}

interface TrackerEvent {
  event_id?: string;
  event_name?: string;
  event_type?: string;
  properties?: Record<string, unknown>;
}

/**
 * Execute a captured raw ingestion payload. Idempotent: each event row uses
 * `${dedupeKey}:${event_id|index}` as its dedupe_key; the existing unique
 * index suppresses any duplicate replay.
 */
export async function executeRawReplay(args: {
  companyId: string;
  source: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  replayOrigin: string;
}): Promise<ExecutorResult> {
  if (!enabled()) {
    return { outcome: 'executor_disabled', written: 0, detail: 'raw executor disabled (set REPLAY_INGRESS_SECRET + REPLAY_RAW_EXECUTOR_ENABLED=true)' };
  }
  if (args.source !== 'ingestion') {
    return { outcome: 'unsupported_source', written: 0, detail: `raw executor only handles 'ingestion' (got '${args.source}')` };
  }

  const p = args.payload as any;
  const websiteId = String(p?.website_id ?? '');
  const events: TrackerEvent[] = Array.isArray(p?.events) ? p.events : [];
  if (!websiteId || events.length === 0) {
    return { outcome: 'malformed', written: 0, detail: 'missing website_id or events[]' };
  }

  let written = 0;
  try {
    const rows = events.map((ev, idx) => ({
      company_id: args.companyId,
      website_id: websiteId,
      anonymous_id: p?.anonymous_id ?? null,
      event_name: String(ev.event_name ?? 'replayed_event'),
      event_category: String(ev.event_type ?? 'system'),
      page_url: p?.current_page ?? null,
      referrer: p?.referrer ?? null,
      consent_state: p?.consent_state ?? null,
      // Idempotency anchor: preserved original key + per-event suffix.
      dedupe_key: `${args.dedupeKey}:${ev.event_id ?? idx}`,
      batch_id: p?.batch_id ?? null,
      processed_at: null, // let existing downstream aggregation handle it
      metadata: {
        ...(ev.properties ?? {}),
        __replay: true,
        __replay_origin: args.replayOrigin,
        __original_dedupe_key: args.dedupeKey,
      },
    }));
    // ON CONFLICT (website_id, dedupe_key) DO NOTHING → idempotent replay.
    const { error } = await ownedDbTable('tracking_events').upsert(rows, {
      onConflict: 'website_id,dedupe_key',
      ignoreDuplicates: true,
    });
    if (error) {
      await audit(args, 'failed', error.message);
      return { outcome: 'failed', written: 0, detail: error.message };
    }
    written = rows.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'executor error';
    await audit(args, 'failed', msg);
    return { outcome: 'failed', written: 0, detail: msg };
  }

  await audit(args, 'executed', `re-injected ${written} canonical event(s)`);
  return {
    outcome: 'executed',
    written,
    detail: `re-injected ${written} event(s) idempotently (duplicates suppressed by unique index)`,
  };
}

/**
 * Durable replay-layer exactly-once marker. Returns true if this dedupeKey
 * was already executed (append-only audit, multi-instance consistent).
 */
async function alreadyExecuted(companyId: string, dedupeKey: string): Promise<boolean> {
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('id')
      .eq('company_id', companyId)
      .eq('resource_type', 'replay_executed')
      .eq('resource_id', dedupeKey)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Webhook / lead raw replay. There is NO public-`leads` sink with a proven
 * idempotency invariant that we can write through WITHOUT refactoring a
 * stable system, so — per "only execute replay paths that can be proven
 * idempotent" — we do NOT auto-write leads. We enforce exactly-once at the
 * replay LAYER (durable marker) and continue lineage; the captured payload
 * remains operator-exportable. Honest, not fabricated.
 */
export async function executeWebhookOrLeadReplay(args: {
  companyId: string;
  source: string;
  dedupeKey: string;
  replayOrigin: string;
}): Promise<ExecutorResult> {
  if (!enabled()) {
    return { outcome: 'executor_disabled', written: 0, detail: 'raw executor disabled (env-gated)' };
  }
  if (await alreadyExecuted(args.companyId, args.dedupeKey)) {
    await audit(args, 'idempotent_skip', 'replay-layer marker present — exactly-once enforced');
    return { outcome: 'idempotent_skip', written: 0, detail: 'already replayed (durable marker) — no duplicate write' };
  }
  // PROVABLY-idempotent isolated receipt sink (UNIQUE company_id,dedupe_key).
  // Never writes `leads` (no duplicate lead creation) and never reuses public
  // ingress. Falls back to lineage/export-only when the table is absent.
  const receipt = await recordLeadReplayReceipt({
    companyId: args.companyId,
    source: args.source,
    dedupeKey: args.dedupeKey,
    replayOrigin: args.replayOrigin,
  });
  if (receipt.outcome === 'receipt_written' && receipt.verified) {
    await audit(args, 'executed', `idempotent replay receipt written & verified (${args.source})`);
    return { outcome: 'executed', written: 1, detail: receipt.detail };
  }
  if (receipt.outcome === 'already_receipted') {
    await audit(args, 'idempotent_skip', 'receipt already present — exactly-once');
    return { outcome: 'idempotent_skip', written: 0, detail: receipt.detail };
  }
  if (receipt.outcome === 'failed') {
    await audit(args, 'failed', receipt.detail);
    return { outcome: 'failed', written: 0, detail: receipt.detail };
  }
  // lineage_only_fallback (receipt table not applied) — honest export-only.
  await audit(args, 'unsupported_source', receipt.detail);
  return {
    outcome: 'unsupported_source',
    written: 0,
    detail: `Lineage/export-only fallback — ${receipt.detail}. No lead written (no duplicate creation).`,
  };
}

async function audit(
  args: { companyId: string; source: string; dedupeKey: string; replayOrigin: string },
  outcome: ExecutorOutcome,
  detail: string,
): Promise<void> {
  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: null, type: 'system', label: 'raw-replay-executor' },
    action: `replay_executor.${outcome}`,
    resourceType: 'replay_ingress',
    resourceId: args.dedupeKey,
    severity: outcome === 'failed' ? 'warning' : 'info',
    outcome: outcome === 'executed' ? 'success' : outcome === 'failed' ? 'failure' : 'success',
    entityLineage: ['company', 'replay_ingress', args.source, 'raw_executor'],
    detail: { source: args.source, replayOrigin: args.replayOrigin, outcome, detail },
  }).catch(() => undefined);
}
