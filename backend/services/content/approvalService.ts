/**
 * WRITER-EXEC-005 Wave 4 — Content approval workflow service (items 6 + 9).
 *
 * A thin, FAIL-SAFE seam over the Wave-1 canonical content spine that advances a
 * piece of content through its lifecycle *and* records an immutable audit row in
 * `content_approval_history` (see
 * supabase/migrations/20260718000002_content_quality_collaboration.sql).
 *
 * Design notes:
 *  - Validation of the transition is delegated to the ONE canonical authority:
 *    `contentService.setLifecycleStatus`, which itself calls
 *    `canTransition(from, to)`. We never re-implement the transition rules here.
 *  - Company-scoped end to end (the service role bypasses RLS, so every query is
 *    explicitly `.eq('company_id', …)`).
 *  - FAIL-SAFE: a failed history write never rolls back / masks a successful
 *    status change, and no method throws for a mere audit-write hiccup. A
 *    genuinely illegal transition is surfaced as `{ ok: false, error }` rather
 *    than an exception, so callers get a predictable result shape.
 *  - Observability: emits `quality.approval_latency_ms` (fail-safe) when a piece
 *    reaches 'approved', measured from its last update to the approval decision.
 */

import { supabase } from '../../db/supabaseClient';
import { getContent, setLifecycleStatus } from './contentService';
import { recordApprovalLatency } from '../../observability/qualityMetrics';
import * as publicationLineageService from './publicationLineageService';
import * as learningEngine from './learningEngine';
import { isSemanticRootEnabled } from './runtime/semanticSpine';
import { isSemanticRootId } from '../../platform/intelligence';
import type {
  CanonicalContent,
  ContentLifecycleStatus,
} from '../../../lib/content/canonicalContent';

const APPROVAL_HISTORY_TABLE = 'content_approval_history';

// ── types ─────────────────────────────────────────────────────────────────────

export interface AdvanceApprovalInput {
  companyId: string;
  contentId: string;
  toStatus: ContentLifecycleStatus;
  /** User id driving the change; null/undefined = system. */
  actor?: string | null;
  /** Optional free-text note stored on the history row. */
  note?: string | null;
}

/** A single approval-history audit row (camelCase mirror of the table). */
export interface ApprovalHistoryEntry {
  id: string;
  companyId: string;
  contentId: string;
  fromStatus: ContentLifecycleStatus | null;
  toStatus: ContentLifecycleStatus;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

/** Result of `advanceApproval`. Never throws for expected failure modes. */
export interface AdvanceApprovalResult {
  ok: boolean;
  /** The updated content row when the transition succeeded. */
  content?: CanonicalContent;
  fromStatus?: ContentLifecycleStatus;
  toStatus: ContentLifecycleStatus;
  /** True when the lifecycle changed but the audit row could not be written. */
  historyWriteFailed?: boolean;
  error?: string;
}

// ── mappers ─────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapHistoryRow(row: any): ApprovalHistoryEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    contentId: row.content_id,
    fromStatus: (row.from_status ?? null) as ContentLifecycleStatus | null,
    toStatus: row.to_status as ContentLifecycleStatus,
    actor: row.actor ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── history write (best-effort, never throws) ───────────────────────────────

async function recordHistory(
  companyId: string,
  contentId: string,
  fromStatus: ContentLifecycleStatus | null,
  toStatus: ContentLifecycleStatus,
  actor: string | null,
  note: string | null,
): Promise<boolean> {
  try {
    const { error } = await supabase.from(APPROVAL_HISTORY_TABLE).insert({
      company_id: companyId,
      content_id: contentId,
      from_status: fromStatus,
      to_status: toStatus,
      actor: actor ?? null,
      note: note ?? null,
    });
    if (error) {
      console.warn('[approvalService][history-write-failed]', {
        contentId,
        toStatus,
        message: error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[approvalService][history-write-threw]', {
      contentId,
      toStatus,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ── publish → learning event (Wave 5, item 1) ───────────────────────────────

/**
 * When a piece transitions to 'published', "every published item becomes a
 * learning event": record an immutable lineage row and enrol the piece into the
 * learning engine.
 *
 * STRICTLY FAIL-OPEN / BEST-EFFORT: this is called only AFTER the lifecycle
 * change has already committed. A lineage- or learning-write failure MUST NEVER
 * block, roll back, or mask a successful publish, so every branch is guarded and
 * this function never throws and returns nothing meaningful. It also never
 * mutates the content (recordEvent / recordLearningEvent are append-only + no-op
 * on content).
 */
/**
 * WS-1b (PMO-ADR-06) — recover the generation-time Semantic Root soft-ref from a
 * content row's `source_metadata` (where the runtime persisted it at creation).
 * Returns the id ONLY when it is a canonical `sroot_<…>` — a malformed/legacy
 * value degrades to null (we never fabricate one). No I/O; pure projection.
 */
function readSemanticRootId(content: CanonicalContent | null | undefined): string | null {
  const meta = content?.sourceMetadata;
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as Record<string, unknown>).semanticRootId;
  return typeof raw === 'string' && isSemanticRootId(raw) ? raw : null;
}

async function emitPublishLearningEvent(
  companyId: string,
  contentId: string,
  semanticRootId?: string | null,
): Promise<void> {
  // Lineage: append a 'published' event (soft-ref, append-only). WS-1b — carry
  // the generation-time Semantic Root id into the ONE certified lineage store so
  // the generation→publish lineage is COMPLETE. This REUSES publicationLineage-
  // Service.recordEvent (its WS-1a `semanticRootId` seam folds it into metadata);
  // NO second lineage store is introduced. A null id leaves the recorded event
  // byte-identical to today (never mints a fresh root).
  try {
    await publicationLineageService.recordEvent({
      companyId,
      contentId,
      eventType: 'published',
      ...(semanticRootId ? { semanticRootId } : {}),
    });
  } catch (err) {
    console.warn('[approvalService][publish-lineage-failed]', {
      contentId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Learning: idempotent, fail-open, never mutates content.
  try {
    await learningEngine.recordLearningEvent({ companyId, contentId });
  } catch (err) {
    console.warn('[approvalService][publish-learning-failed]', {
      contentId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Advance a piece of content to `toStatus`, validating the transition and
 * writing an audit row. FAIL-SAFE: illegal transitions and missing content are
 * returned as `{ ok: false, error }`; a history-write failure does not undo the
 * (already committed) status change.
 */
export async function advanceApproval(
  input: AdvanceApprovalInput,
): Promise<AdvanceApprovalResult> {
  const { companyId, contentId, toStatus } = input;
  const actor = input.actor ?? null;
  const note = input.note ?? null;

  if (!companyId || !contentId || !toStatus) {
    return { ok: false, toStatus, error: 'companyId, contentId and toStatus are required' };
  }

  // Snapshot the current status for validation + the audit trail.
  let existing: CanonicalContent | null;
  try {
    existing = await getContent(contentId, companyId);
  } catch (err) {
    return {
      ok: false,
      toStatus,
      error: err instanceof Error ? err.message : 'failed to load content',
    };
  }
  if (!existing) {
    return { ok: false, toStatus, error: 'content not found for company' };
  }

  const fromStatus = existing.lifecycleStatus;

  // No-op guard: advancing to the current status is not a transition.
  if (fromStatus === toStatus) {
    return { ok: false, fromStatus, toStatus, error: `already in status '${toStatus}'` };
  }

  // The canonical authority (contentService.setLifecycleStatus → canTransition)
  // validates and applies the change. A disallowed transition throws; we catch
  // and surface it as a structured failure.
  let updated: CanonicalContent;
  try {
    updated = await setLifecycleStatus(contentId, companyId, toStatus);
  } catch (err) {
    return {
      ok: false,
      fromStatus,
      toStatus,
      error: err instanceof Error ? err.message : 'illegal transition',
    };
  }

  // Audit row — preserved + traceable (item 9). Best-effort; failure is reported
  // but does not roll back the committed lifecycle change.
  const historyOk = await recordHistory(companyId, contentId, fromStatus, toStatus, actor, note);

  // Fail-safe observability: approval latency measured from the piece's last
  // update to the approval decision.
  if (toStatus === 'approved') {
    try {
      const prev = Date.parse(existing.updatedAt);
      if (Number.isFinite(prev)) {
        recordApprovalLatency(Date.now() - prev, existing.contentType);
      }
    } catch { /* fail-safe */ }
  }

  // Wave 5, item 1 — "every published item becomes a learning event". FAIL-OPEN:
  // the transition is already committed above; a learning/lineage failure here
  // must NEVER block or roll back the approval, so this is guarded end-to-end and
  // its outcome is deliberately NOT reflected in the returned result.
  if (toStatus === 'published') {
    // WS-1b — recover the Semantic Root soft-ref persisted at generation time and
    // carry it into the lineage event. OBSERVABLE continuity gap (fail-open,
    // post-commit): under the enforcement flag a published piece that carries NO
    // Semantic Root is a continuity gap — but the publish has ALREADY committed,
    // so we can neither fail it nor mint a fresh root; we record the gap
    // deterministically and still append the lineage event with the real id.
    const semanticRootId = readSemanticRootId(updated);
    if (isSemanticRootEnabled() && !semanticRootId) {
      console.warn('[approvalService][semantic-continuity-gap]', {
        contentId,
        reason: 'published content missing semanticRootId in source_metadata',
      });
    }
    try {
      await emitPublishLearningEvent(companyId, contentId, semanticRootId);
    } catch { /* fail-open — never blocks a committed publish */ }
  }

  return {
    ok: true,
    content: updated,
    fromStatus,
    toStatus,
    historyWriteFailed: historyOk ? undefined : true,
  };
}

/**
 * Return the approval history for a piece of content, newest-first.
 * FAIL-SAFE: on any read error returns an empty array rather than throwing, so
 * an audit-surface glitch never breaks a caller's render/flow.
 */
export async function getApprovalHistory(
  contentId: string,
  companyId: string,
): Promise<ApprovalHistoryEntry[]> {
  if (!contentId || !companyId) return [];
  try {
    const { data, error } = await supabase
      .from(APPROVAL_HISTORY_TABLE)
      .select('*')
      .eq('content_id', contentId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('[approvalService][history-read-failed]', { contentId, message: error.message });
      return [];
    }
    return (data ?? []).map(mapHistoryRow);
  } catch (err) {
    console.warn('[approvalService][history-read-threw]', {
      contentId,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
