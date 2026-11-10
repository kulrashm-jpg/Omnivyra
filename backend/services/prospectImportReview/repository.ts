/**
 * R3: the import review list (`prospect_import_review_items`) and the probe's
 * production read ports.
 *
 * Owner decisions (2026-11-10): weakly-matched discovered leads are HELD here,
 * NOT imported, until a tenant user chooses IMPORT or SKIP; they expire after
 * 30 days as "not imported" and can be re-pulled. Nothing here merges persons.
 *
 * Writes in this module, and only these:
 *  - INSERT held items (idempotent: a duplicate row is ignored);
 *  - DELETE expired items (best-effort, lazy, on read and on write; no cron);
 *  - UPDATE a pending item to `skipped` (clearing the held record);
 *  - DELETE an item after its record has been IMPORTED through `ingestLeadBatch`.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { ingestLeadBatch } from '../leadIngestion/orchestrator';
import type { HoldReason, Lookup, ProbePorts } from './probe';

const TABLE = 'prospect_import_review_items';

// ── probe read ports ────────────────────────────────────────────────────────

/**
 * Turn a PostgREST answer into a `Lookup`. A NULL ERROR IS NOT AN ANSWER:
 * postgrest-js reports a blank 404 as `{status: 204, error: null}`, so a row
 * set counts as read ONLY when there is no error, the status is 200/206 and
 * the data is an array. Anything else is `{ ok: false }`.
 */
export function toLookup(res: { data?: unknown; error?: unknown; status?: number }): Lookup {
  if (res.error || (res.status !== 200 && res.status !== 206) || !Array.isArray(res.data)) return { ok: false };
  return {
    ok: true,
    persons: (res.data as Array<Record<string, unknown>>)
      .filter((r) => typeof r.id === 'string')
      .map((r) => ({ id: r.id as string, fullName: typeof r.full_name === 'string' ? r.full_name : null })),
  };
}

const PERSON_COLUMNS = 'id, full_name';

export const productionProbePorts: ProbePorts = {
  async byExternalKey(org, source, externalId) {
    return toLookup(await ownedDbTable('unified_persons').select(PERSON_COLUMNS)
      .eq('company_id', org)
      .contains('external_keys', { [source]: { external_id: externalId } })
      .limit(5));
  },
  async byEmail(org, email) {
    return toLookup(await ownedDbTable('unified_persons').select(PERSON_COLUMNS)
      .eq('company_id', org).eq('primary_email', email).limit(10));
  },
  async byPhone(org, phone) {
    return toLookup(await ownedDbTable('unified_persons').select(PERSON_COLUMNS)
      .eq('company_id', org).eq('primary_phone', phone).limit(10));
  },
  async byNameToken(org, lastToken) {
    // Letters only (nameTokens), so no LIKE metacharacter can reach the pattern.
    if (!/^\p{L}+$/u.test(lastToken)) return { ok: true, persons: [] };
    return toLookup(await ownedDbTable('unified_persons').select(PERSON_COLUMNS)
      .eq('company_id', org).ilike('full_name', `%${lastToken}%`).limit(50));
  },
};

// ── the review list ─────────────────────────────────────────────────────────

export interface HeldItem {
  readonly providerRecordId: string;
  readonly reason: HoldReason;
  readonly matchedPersonIds: readonly string[];
  /** The provider's raw record, verbatim, so IMPORT can replay it later. */
  readonly raw: Record<string, unknown>;
}

/**
 * Best-effort lazy expiry. Never required: a failure is swallowed and the
 * caller's read or write proceeds (expired rows are also filtered on read).
 */
export async function expireReviewItems(organizationId: string, nowIso: string): Promise<void> {
  try {
    await ownedDbTable(TABLE).delete().eq('organization_id', organizationId).lt('expires_at', nowIso);
  } catch {
    /* best-effort by design */
  }
}

/**
 * Hold items for review. IDEMPOTENT: one row per (tenant, source, record,
 * matched person); a re-run of the same discovery inserts nothing new, and a
 * row already SKIPPED stays skipped (it suppresses re-queueing until expiry).
 */
export async function holdForReview(
  organizationId: string, source: string, items: readonly HeldItem[], nowIso: string,
): Promise<{ held: number }> {
  if (!items.length) return { held: 0 };
  await expireReviewItems(organizationId, nowIso);
  const rows = items.flatMap((it) => it.matchedPersonIds.map((personId) => ({
    organization_id: organizationId,
    source,
    provider_record_id: it.providerRecordId,
    matched_person_id: personId,
    reason: it.reason,
    raw_record: it.raw,
  })));
  const res = await ownedDbTable(TABLE).upsert(rows, {
    onConflict: 'organization_id,source,provider_record_id,matched_person_id',
    ignoreDuplicates: true,
  });
  if (res.error) throw new Error(`review hold failed: ${res.error.message}`);
  return { held: items.length };
}

export interface ReviewListItem {
  readonly providerRecordId: string;
  readonly source: string;
  readonly reason: HoldReason;
  readonly matchedPersonIds: string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The display fields of the held candidate (from the raw record). */
  readonly candidate: Record<string, unknown> | null;
}

/** Pending items for a tenant, grouped by provider record, oldest first. */
export async function listReviewItems(
  organizationId: string, nowIso: string, limit = 100,
): Promise<{ items: ReviewListItem[]; pendingRows: number; oldestCreatedAt: string | null }> {
  await expireReviewItems(organizationId, nowIso);
  const res = await ownedDbTable(TABLE)
    .select('source, provider_record_id, matched_person_id, reason, raw_record, created_at, expires_at')
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(Math.min(Math.max(1, limit), 500) * 10);
  if (res.error || !Array.isArray(res.data)) {
    throw new Error(`review list read failed${res.error ? `: ${res.error.message}` : ''}`);
  }
  const byRecord = new Map<string, ReviewListItem & { matchedPersonIds: string[] }>();
  for (const r of res.data as Array<Record<string, unknown>>) {
    const key = `${r.source}\u0000${r.provider_record_id}`;
    const existing = byRecord.get(key);
    if (existing) { existing.matchedPersonIds.push(String(r.matched_person_id)); continue; }
    byRecord.set(key, {
      providerRecordId: String(r.provider_record_id),
      source: String(r.source),
      reason: r.reason as HoldReason,
      matchedPersonIds: [String(r.matched_person_id)],
      createdAt: String(r.created_at),
      expiresAt: String(r.expires_at),
      candidate: (r.raw_record as Record<string, unknown> | null) ?? null,
    });
  }
  const items = [...byRecord.values()].slice(0, limit);
  return { items, pendingRows: res.data.length, oldestCreatedAt: items[0]?.createdAt ?? null };
}

export class ReviewDecisionRefused extends Error {
  constructor(readonly code: 'not_a_member' | 'membership_unknown' | 'invalid_input') {
    super(`review decision refused: ${code}`);
    this.name = 'ReviewDecisionRefused';
  }
}

/**
 * WRITER VALIDATION for the `decided_by` actor column (GOV-H, registered in
 * scripts/migrations/actor-field-registry.json): the deciding user must hold an
 * ACTIVE role in THIS tenant, checked here, at the write, not inferred from the
 * route. An unreadable membership refuses.
 */
async function assertActiveMember(organizationId: string, userId: string): Promise<void> {
  const res = await ownedDbTable('user_company_roles').select('company_id')
    .eq('user_id', userId).eq('company_id', organizationId).eq('status', 'active').limit(1);
  if (res.error || (res.status !== 200 && res.status !== 206) || !Array.isArray(res.data)) {
    throw new ReviewDecisionRefused('membership_unknown');
  }
  if (res.data.length === 0) throw new ReviewDecisionRefused('not_a_member');
}

export interface DecisionOutcome {
  readonly providerRecordId: string;
  readonly status: 'imported' | 'skipped' | 'not_pending' | 'import_failed' | 'skip_failed';
  readonly reason?: string;
}

/**
 * Apply IMPORT or SKIP to held records. Never merges: IMPORT replays the held
 * raw record through `ingestLeadBatch` exactly as discovery would have, so the
 * normal resolver decides identity, and any duplicate signal on the new person
 * is LI-4C's from then on.
 *
 * Ordering: IMPORT ingests first and deletes the held rows only after a
 * successful ingest. If the delete then fails, the rows stay pending and a
 * second IMPORT replays the same source record, which LI-2 reports `unchanged`
 * (idempotent). A failed ingest leaves the item pending, reported per record.
 */
export async function decideReviewItems(input: {
  organizationId: string;
  userId: string;
  source: string;
  providerRecordIds: readonly string[];
  decision: 'import' | 'skip';
  now: string;
  /** Test seam. */
  ingest?: typeof ingestLeadBatch;
}): Promise<DecisionOutcome[]> {
  const org = String(input.organizationId ?? '').trim();
  const user = String(input.userId ?? '').trim();
  const ids = [...new Set((input.providerRecordIds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (!org || !user || !ids.length || ids.length > 100 || (input.decision !== 'import' && input.decision !== 'skip')) {
    throw new ReviewDecisionRefused('invalid_input');
  }
  await assertActiveMember(org, user);
  await expireReviewItems(org, input.now);

  const outcomes: DecisionOutcome[] = [];
  for (const recordId of ids) {
    const pending = await ownedDbTable(TABLE).select('id, raw_record')
      .eq('organization_id', org).eq('source', input.source).eq('provider_record_id', recordId)
      .eq('status', 'pending').gt('expires_at', input.now).limit(50);
    if (pending.error || !Array.isArray(pending.data)) {
      outcomes.push({ providerRecordId: recordId, status: 'import_failed', reason: 'read_failed' });
      continue;
    }
    if (pending.data.length === 0) { outcomes.push({ providerRecordId: recordId, status: 'not_pending' }); continue; }

    if (input.decision === 'skip') {
      // `.select('id')` returns the rows THIS update changed, so a concurrent
      // second reviewer (who finds nothing still pending) reports not_pending
      // instead of a success it did not cause.
      const upd = await ownedDbTable(TABLE)
        .update({ status: 'skipped', decided_at: input.now, decided_by: user, raw_record: null })
        .eq('organization_id', org).eq('source', input.source).eq('provider_record_id', recordId).eq('status', 'pending')
        .select('id');
      if (upd.error || !Array.isArray(upd.data)) {
        outcomes.push({ providerRecordId: recordId, status: 'skip_failed', reason: 'skip_write_failed' });
      } else {
        outcomes.push({ providerRecordId: recordId, status: upd.data.length ? 'skipped' : 'not_pending' });
      }
      continue;
    }

    const raw = (pending.data[0] as { raw_record?: unknown }).raw_record;
    if (!raw || typeof raw !== 'object') {
      outcomes.push({ providerRecordId: recordId, status: 'import_failed', reason: 'no_held_record' });
      continue;
    }
    const result = await (input.ingest ?? ingestLeadBatch)({
      organizationId: org, source: input.source, records: [raw as Record<string, unknown>],
      ingestionRunId: `review-import:${recordId}`, now: input.now,
    });
    const o = result.outcomes[0];
    if (!o?.ok) {
      outcomes.push({ providerRecordId: recordId, status: 'import_failed', reason: o?.rejection ?? 'ingest_failed' });
      continue;
    }
    await ownedDbTable(TABLE).delete()
      .eq('organization_id', org).eq('source', input.source).eq('provider_record_id', recordId);
    outcomes.push({ providerRecordId: recordId, status: 'imported' });
  }
  return outcomes;
}
