/**
 * Strategic Mix P1 — Release plan derivation (PURE).
 *
 * Decides WHICH of a finalized campaign's plan rows a release request may hand
 * to the existing scheduler, and why each excluded row was excluded. No I/O, no
 * clock, no randomness: same rows + same scope ⇒ same decision, so the whole
 * policy is unit-testable without a database.
 *
 * OWNERSHIP — this module decides eligibility ONLY. It never schedules, never
 * mutates a row, and never invents a status. Scheduling remains
 * `scheduleStructuredPlan`; content lifecycle remains
 * lib/campaign/campaignContentModel; adoption remains
 * lib/campaign/workspaceContentResolution.
 *
 * THE POLICY (SPEC-004 adoption ladder, applied at the release boundary):
 *
 *   • workspace copy APPROVED        → eligible; the scheduler adopts it verbatim
 *   • workspace copy in REVIEW       → BLOCKED. "Review" means "not yet approved";
 *                                      unapproved copy must never reach a platform.
 *   • workspace copy in DRAFT        → BLOCKED, same reason.
 *   • NO workspace copy at all       → eligible. The row is planning material and
 *                                      the scheduler generates for it exactly as it
 *                                      does today (this is how a campaign that never
 *                                      used the Content Workspace still ships).
 *   • already has a scheduled post   → skipped as already released (idempotency is
 *                                      also enforced below this layer by the
 *                                      scheduled_posts idempotency key).
 *   • outside the requested scope    → skipped, not an error.
 *
 * The asymmetry between "no copy" (eligible) and "draft copy" (blocked) is
 * deliberate: an empty slot expresses no human intent, whereas a draft slot
 * expresses intent that is explicitly NOT finished.
 */

import { resolveWorkspaceContent } from './workspaceContentResolution';

/** The release request scope. Not persisted — an execution request, not state. */
export type ReleaseScope =
  | { kind: 'campaign' }
  | { kind: 'weeks'; weeks: number[] }
  | { kind: 'slots'; slot_ids: string[] };

/** Why a row was not included in this release. */
export type ReleaseSkipReason =
  | 'out_of_scope'
  | 'content_in_draft'
  | 'content_in_review'
  | 'already_scheduled';

/** The minimal daily_content_plans shape this policy reads. */
export interface ReleaseCandidateRow {
  id: string;
  week_number?: number | null;
  platform?: string | null;
  content_type?: string | null;
  date?: string | null;
  scheduled_time?: string | null;
  /** The content envelope (JSON string or already-parsed object). */
  content?: unknown;
  /** Set once execution has produced a post for this row. */
  scheduled_post_id?: string | null;
}

export interface ReleaseSkippedRow {
  id: string;
  week: number | null;
  platform: string | null;
  reason: ReleaseSkipReason;
}

export interface ReleasePlan {
  /** daily_content_plans ids the scheduler may process. */
  eligible_ids: string[];
  /** Distinct week numbers covered by the eligible rows (ascending). */
  eligible_weeks: number[];
  /** Every row excluded, with its reason. */
  skipped: ReleaseSkippedRow[];
  /** Counts by reason, for the response summary. */
  skipped_by_reason: Record<ReleaseSkipReason, number>;
  /** Distinct platforms among eligible rows (ascending, lowercased). */
  platforms: string[];
  /** Approved-copy rows among the eligible set (adopted verbatim at publish). */
  approved_count: number;
  /** Eligible rows carrying no workspace copy (the scheduler will generate). */
  generate_count: number;
  /** Requested weeks/slots that matched no row in this campaign. */
  unknown_weeks: number[];
  unknown_slot_ids: string[];
}

const EMPTY_REASON_COUNTS: Record<ReleaseSkipReason, number> = {
  out_of_scope: 0,
  content_in_draft: 0,
  content_in_review: 0,
  already_scheduled: 0,
};

/** Parse the content envelope defensively — a malformed one is simply "no copy". */
function parseEnvelope(content: unknown): unknown {
  if (content == null) return null;
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return typeof content === 'object' ? content : null;
}

function weekOf(row: ReleaseCandidateRow): number | null {
  const n = Number(row.week_number);
  return Number.isFinite(n) ? n : null;
}

function inScope(row: ReleaseCandidateRow, scope: ReleaseScope): boolean {
  if (scope.kind === 'campaign') return true;
  if (scope.kind === 'weeks') {
    const w = weekOf(row);
    return w !== null && scope.weeks.includes(w);
  }
  return scope.slot_ids.includes(row.id);
}

/**
 * Derive the release plan. `rows` must already be scoped to ONE campaign by the
 * caller — this function never sees a campaign id and cannot enforce tenancy.
 */
export function deriveReleasePlan(
  rows: ReleaseCandidateRow[] | null | undefined,
  scope: ReleaseScope,
): ReleasePlan {
  const list = Array.isArray(rows) ? rows : [];
  const eligible_ids: string[] = [];
  const skipped: ReleaseSkippedRow[] = [];
  const skipped_by_reason = { ...EMPTY_REASON_COUNTS };
  const weeks = new Set<number>();
  const platforms = new Set<string>();
  let approved_count = 0;
  let generate_count = 0;

  const skip = (row: ReleaseCandidateRow, reason: ReleaseSkipReason) => {
    skipped.push({
      id: row.id,
      week: weekOf(row),
      platform: row.platform ? String(row.platform).toLowerCase() : null,
      reason,
    });
    skipped_by_reason[reason] += 1;
  };

  for (const row of list) {
    if (!inScope(row, scope)) {
      skip(row, 'out_of_scope');
      continue;
    }
    if (typeof row.scheduled_post_id === 'string' && row.scheduled_post_id.trim()) {
      skip(row, 'already_scheduled');
      continue;
    }

    const resolution = resolveWorkspaceContent(parseEnvelope(row.content));
    if (resolution.reason === 'review_not_eligible') {
      skip(row, 'content_in_review');
      continue;
    }
    if (resolution.reason === 'draft_not_eligible') {
      skip(row, 'content_in_draft');
      continue;
    }

    // adopted (approved) OR no workspace content at all — both releasable.
    if (resolution.adopted) approved_count += 1;
    else generate_count += 1;

    eligible_ids.push(row.id);
    const w = weekOf(row);
    if (w !== null) weeks.add(w);
    if (row.platform) platforms.add(String(row.platform).toLowerCase());
  }

  // Requested-but-absent weeks / slots: surfaced so the caller can reject a
  // request that names something this campaign does not contain.
  const presentWeeks = new Set<number>();
  const presentIds = new Set<string>();
  for (const row of list) {
    const w = weekOf(row);
    if (w !== null) presentWeeks.add(w);
    presentIds.add(row.id);
  }
  const unknown_weeks =
    scope.kind === 'weeks' ? scope.weeks.filter((w) => !presentWeeks.has(w)).sort((a, b) => a - b) : [];
  const unknown_slot_ids =
    scope.kind === 'slots' ? scope.slot_ids.filter((id) => !presentIds.has(id)) : [];

  return {
    eligible_ids,
    eligible_weeks: Array.from(weeks).sort((a, b) => a - b),
    skipped,
    skipped_by_reason,
    platforms: Array.from(platforms).sort(),
    approved_count,
    generate_count,
    unknown_weeks,
    unknown_slot_ids,
  };
}

/**
 * Parse + validate an untrusted request body into a ReleaseScope.
 *
 * Returns a plain result object rather than throwing. NOTE: callers in this
 * repo compile with `strict: false`, where discriminated-union narrowing on
 * `.ok` does not apply — read `.scope` and `.error` defensively.
 */
export function parseReleaseScope(body: unknown):
  | { ok: true; scope: ReleaseScope }
  | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = typeof b.scope === 'string' ? b.scope.trim() : 'campaign';

  if (kind === 'campaign') return { ok: true, scope: { kind: 'campaign' } };

  if (kind === 'weeks') {
    const raw = Array.isArray(b.weeks) ? b.weeks : null;
    if (!raw || raw.length === 0) return { ok: false, error: 'scope "weeks" requires a non-empty weeks array' };
    const weeks: number[] = [];
    for (const v of raw) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: `invalid week number: ${String(v)}` };
      if (!weeks.includes(n)) weeks.push(n);
    }
    return { ok: true, scope: { kind: 'weeks', weeks: weeks.sort((a, b) => a - b) } };
  }

  if (kind === 'slots') {
    const raw = Array.isArray(b.slot_ids) ? b.slot_ids : null;
    if (!raw || raw.length === 0) return { ok: false, error: 'scope "slots" requires a non-empty slot_ids array' };
    const slot_ids: string[] = [];
    for (const v of raw) {
      if (typeof v !== 'string' || !v.trim()) return { ok: false, error: 'slot_ids must be non-empty strings' };
      if (!slot_ids.includes(v.trim())) slot_ids.push(v.trim());
    }
    return { ok: true, scope: { kind: 'slots', slot_ids } };
  }

  return { ok: false, error: `unknown scope "${kind}" (expected campaign | weeks | slots)` };
}
