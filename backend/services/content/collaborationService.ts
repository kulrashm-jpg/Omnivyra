/**
 * Collaboration Service — WRITER-EXEC-005 Wave 4 (items 4/9). CRUD over
 * `content_block` + `content_recommendation`, company-scoped, enforcing the
 * human-AI collaboration SAFETY RULES:
 *
 *   1. LOCKED blocks are inviolable. A recommendation can never modify a block
 *      whose `locked` flag is true — accept is REFUSED, the rec stays pending.
 *   2. MANUAL EDITS take precedence. If the block's current text no longer
 *      matches the rec's `before_text`, a human edited it after the rec was
 *      generated — the rec is marked `superseded`, never applied.
 *   3. Every accept is REVERSIBLE (the prior text is preserved in `before_text`)
 *      and TRACEABLE (status + resolved_at on the row).
 *
 * Uses the shared service-role client (RLS-bypassing) → every query is
 * explicitly company-scoped.
 *
 * ERROR CONTRACT — NOT UNIFORM ACROSS THIS FILE. An earlier version of this
 * header said "failures log and return a structured result rather than
 * throwing", which was true when every function swallowed. It is now wrong for
 * the one function that matters most:
 *   - upsertBlocks THROWS a status-carrying error on validation, ownership and
 *     write failure, deliberately, so a denied cross-tenant write can never be
 *     mistaken for "saved nothing successfully". See its own docblock.
 *   - listBlocks, listRecommendations, setBlockLocked, saveRecommendations,
 *     acceptRecommendation,
 *     rejectRecommendation, acceptAll and restoreOriginal still log and return
 *     a structured or empty result. setBlockLocked in particular returns null
 *     on every failure, which its route reports as HTTP 200 — the pattern
 *     upsertBlocks was changed to stop using. That inconsistency is recorded,
 *     not resolved: changing it is an owner decision, not a comment fix.
 *
 * SCHEMA. The predecessor is
 * supabase/migrations/20260718000002_content_quality_collaboration.sql; the
 * OPERATIVE schema for the block-upsert path in this file is
 * supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql,
 * which is NOT APPLIED — see the BLOCK_CONFLICT_TARGET docblock.
 */

import { supabase } from '../../db/supabaseClient';
import type { ContentBlockType, Recommendation } from './recommendationRuntime';

const BLOCK_TABLE = 'content_block';
const REC_TABLE = 'content_recommendation';

export type RecommendationStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

export interface CollabBlock {
  id: string;
  contentId: string;
  companyId: string;
  blockType: ContentBlockType;
  position: number;
  text: string | null;
  locked: boolean;
  updatedAt: string;
}

export interface CollabRecommendation {
  id: string;
  companyId: string;
  contentId: string;
  blockId: string | null;
  affectedSection: string | null;
  category: string;
  reason: string;
  expectedImpact: string | null;
  confidence: number | null;
  beforeText: string | null;
  afterText: string | null;
  status: RecommendationStatus;
  qualityRef: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AcceptResult {
  applied: boolean;
  recommendationId: string;
  reason: string;
  blockId?: string | null;
  before?: string | null;
  after?: string | null;
}

/* ── mappers ──────────────────────────────────────────────────────────────── */
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapBlock(row: any): CollabBlock {
  return {
    id: row.id,
    contentId: row.content_id,
    companyId: row.company_id,
    blockType: row.block_type as ContentBlockType,
    position: row.position ?? 0,
    text: row.text ?? null,
    locked: !!row.locked,
    updatedAt: row.updated_at,
  };
}

function mapRec(row: any): CollabRecommendation {
  return {
    id: row.id,
    companyId: row.company_id,
    contentId: row.content_id,
    blockId: row.block_id ?? null,
    affectedSection: row.affected_section ?? null,
    category: row.category,
    reason: row.reason,
    expectedImpact: row.expected_impact ?? null,
    confidence: row.confidence ?? null,
    beforeText: row.before_text ?? null,
    afterText: row.after_text ?? null,
    status: (row.status ?? 'pending') as RecommendationStatus,
    qualityRef: (row.quality_ref ?? null) as Record<string, unknown> | null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── PURE safety-rule decision (unit-testable without a DB) ──────────────── */

export type AcceptAction = 'apply' | 'refuse' | 'supersede';
export interface AcceptDecision {
  action: AcceptAction;
  reason: string;
}

/**
 * The single source of truth for whether a recommendation may be applied to its
 * target block. Deterministic + side-effect free so it is exercised directly by
 * unit tests (cert env down → no DB in tests).
 *
 *   - non-pending rec        → refuse (already resolved)
 *   - locked block           → refuse (rule 1: locks are inviolable)
 *   - current text ≠ before  → supersede (rule 2: manual edits win)
 *   - otherwise              → apply (rule 3 handled by the caller: store before)
 */
export function evaluateAcceptance(params: {
  status: string;
  blockLocked: boolean;
  currentBlockText: string | null;
  recBefore: string | null;
}): AcceptDecision {
  if (params.status !== 'pending') return { action: 'refuse', reason: params.status || 'not_pending' };
  if (params.blockLocked) return { action: 'refuse', reason: 'locked' };
  const cur = (params.currentBlockText ?? '').trim();
  const before = (params.recBefore ?? '').trim();
  // Only enforce precedence when the rec actually recorded a baseline.
  if (before.length > 0 && cur !== before) {
    return { action: 'supersede', reason: 'manual_edit_precedence' };
  }
  return { action: 'apply', reason: 'ok' };
}

/* ── blocks CRUD ─────────────────────────────────────────────────────────── */

export interface BlockUpsertInput {
  id?: string;
  blockType: ContentBlockType;
  position: number;
  text?: string | null;
  locked?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The conflict target for the block upsert. It is COMPANY-SCOPED on purpose.
 *
 * `content_block.id` is a globally unique primary key, so `onConflict: 'id'`
 * made a caller-supplied id sufficient to land an `ON CONFLICT (id) DO UPDATE`
 * on ANOTHER company's row and rewrite its `company_id` — a cross-tenant
 * destructive write, over an RLS-bypassing service-role client. Scoping the
 * conflict target to `(company_id, id)` means a foreign id finds no conflict
 * for this company, so PostgreSQL attempts an INSERT, which the primary key on
 * `id` then rejects (23505): the other company's row is left untouched and the
 * error is surfaced rather than swallowed.
 *
 * WHAT THAT BACKSTOP DEPENDS ON — stated, because it is CONDITIONAL and not yet
 * verified against a database. It requires a unique key on exactly
 * `(company_id, id)` to exist, so that PostgreSQL can infer an arbiter index
 * from this target at all. That key is created by
 * supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql
 * (STEP 2, `content_block_company_id_key UNIQUE (company_id, id)`), which also
 * creates `public.content_block` itself. THAT MIGRATION IS NOT APPLIED.
 *
 * WHAT ACTUALLY HAPPENS BEFORE IT IS. Two states are visible from this
 * repository; the exact runtime outcome in each is UNVERIFIED, because nothing
 * here has been executed against a database:
 *   - TODAY, as the dump records it. `public.content_block` is ABSENT from
 *     supabase/_schema/baseline.sql, the production-shaped dump, and so are
 *     content_recommendation, content_approval_history and content_quality. The
 *     predecessor migration 20260718000002, which would have created them, is
 *     not reflected there either. So the write never reaches a conflict-arbiter
 *     decision; it fails on the missing relation. The expected answer is
 *     PostgREST's OWN schema-cache error, PGRST205 ("Could not find the table
 *     in the schema cache"), raised before any SQL is issued — NOT a
 *     translation of PostgreSQL's 42P01. 42P01 is the alternative, reached only
 *     if the relation disappears after PostgREST built its cache. An earlier
 *     version of this comment described PGRST205 as 42P01 "surfaced by
 *     PostgREST", which is the wrong mechanism: they are alternatives.
 *   - THE INTERMEDIATE STATE. If 20260718000002 is applied but this file's
 *     migration is not, the table exists with `id` as its only unique key and
 *     no `(company_id, id)`, and THEN the target matches no index and the
 *     statement is expected to be rejected at plan time with 42P10.
 * A further state exists that neither code path can distinguish: STEP 2 of that
 * migration REUSES any already-usable unique key on (company_id, id) whatever
 * its name, so on a target that already carries an equivalent key the upsert
 * resolves even though the migration has not run.
 *
 * AND IT IS NOT "FAIL CLOSED AND COMPLETELY" — an earlier version said so, and
 * that was wrong in the direction that matters. Generation can and does
 * succeed with no block seeded, so no part of this path is fail-closed.
 *
 * THE CONSUMERS, by what they DO with a thrown error. There are five, not the
 * four an earlier version of this note listed:
 *   1. pages/api/content/[id]/blocks.ts — PROPAGATES. The throw reaches
 *      respondServiceError and the caller sees the status this service chose.
 *   2. lib/post/runPostGeneration.ts — CATCHES AND LOGS
 *      (`console.error('… section-block seeding failed (continuing):', …)`),
 *      then returns success. The user sees a successful generation with no
 *      blocks; stderr is the only signal.
 *   3. lib/thread/runThreadGeneration.ts — identical.
 *   4. scripts/cert/e2e-runtime-cert.ts — RECORDS A FAILURE RESULT. Its step()
 *      wrapper catches, pushes a FAIL row into the cert table and returns null
 *      without rethrowing; the run's own exit code still reflects it.
 *   5. hooks/useContentCollaboration.ts — DISCARDS THE RESULT. Its postBlock()
 *      awaits fetch() inside a try/catch and never reads `res.ok`. The
 *      comparison an earlier version drew here — that "the same hook does check
 *      `.ok` on its reads" — is true per response and misleading as a contrast:
 *      the read path checks `.ok` only to decide whether to PARSE, and surfaces
 *      an error to the user only when ALL THREE of its reads fail
 *      (useContentCollaboration.ts:234). A blocks-only 500 yields an empty
 *      block list, no setError, and an editor that renders a document with no
 *      sections indistinguishably from a document that has none. The read path
 *      has the same "nothing versus failed" ambiguity this bullet criticises in
 *      the write path; it is not the better-behaved half. Every status — 404 NOT_FOUND,
 *      500 BLOCK_LOOKUP_FAILED, 500 BLOCK_WRITE_FAILED — is dropped and the
 *      optimistic local state is kept. So the throw removes the
 *      "saved-nothing-successfully" ambiguity at THIS boundary and the shipped
 *      client reintroduces it.
 *      Note what that client actually sends: its only call site posts
 *      `{ action: 'lock', blockId, locked }`, which routes to setBlockLocked —
 *      NOT to this function. No in-repo client posts a `{ blocks: [...] }`
 *      upsert at all, so the browser never exercises this path today.
 *
 * WHICH ERROR A CALLER SEES. An earlier version said BLOCK_WRITE_FAILED was
 * "reached only on an id-less batch — which is to say only from the callers
 * that swallow it". The first half is nearly right and the second is wrong:
 *   - With at least one supplied id, the ownership SELECT is the first database
 *     touch, so a failure there is BLOCK_LOOKUP_FAILED and the write is never
 *     reached.
 *   - With NO supplied id the lookup is skipped entirely and the write is the
 *     first touch, so the error is BLOCK_WRITE_FAILED.
 *   - WHO ACTUALLY SENDS AN ID-LESS BATCH, corrected. An earlier version of
 *     this bullet said an id-less batch is "the ORDINARY FIRST SAVE through the
 *     route", and therefore that BLOCK_WRITE_FAILED is "plainly user-reachable,
 *     not confined to the swallowing callers". That contradicted this very
 *     comment twelve lines above, which says no in-repo client posts a
 *     `{ blocks: [...] }` body at all — and the second half was wrong.
 *     `splitIntoBlocks` is called by exactly three places that then upsert:
 *     lib/post/runPostGeneration.ts, lib/thread/runThreadGeneration.ts and
 *     scripts/cert/e2e-runtime-cert.ts. The first two CATCH AND LOG and then
 *     return success; the third records a FAIL row. No client of the ROUTE
 *     produces an id-less batch, because no client posts this body.
 *     So on today's code the id-less path is reached only from the callers that
 *     swallow or record the error, and what a user sees on an ordinary
 *     generation is a successful generation with no blocks and a line on
 *     stderr. BLOCK_WRITE_FAILED is reachable THROUGH THE ROUTE only by a
 *     hand-crafted request, and reachable in PRACTICE only where it is
 *     swallowed. Neither statement makes it harmless; they make it invisible.
 *   - And a supplied id does not make the write safe either: if the ownership
 *     answer goes stale between the two statements, the write fails and the
 *     route reports BLOCK_WRITE_FAILED. The suite asserts exactly that case.
 *
 * RELEASE DEPENDENCY. This application code must not ship before that migration
 * is applied AND verified — verification being
 * supabase/migrations/_fix3_tenant_consistent/verification.sql. This comment
 * RECORDS the dependency; it does not and cannot enforce it.
 * What does and does not check anything today:
 *   - scripts/ci/real-schema-ci.sh REPLAYS every migration whose 14-digit
 *     version sorts above the baseline's ledger position and FAILS the job if
 *     one does not apply. 20261212000000 is in that set, so there IS an
 *     automated check that this migration APPLIES cleanly onto the dump. It is
 *     NOT evidence that the migration is applied in production, and it does not
 *     run for a change to this file: the workflow's `paths:` filter lists
 *     supabase/migrations/**, supabase/_schema/**, scripts/ci/**,
 *     backend/tests/realschema/**, backend/db/** and the PI service paths —
 *     NOT supabase/** as a whole, and not backend/services/content/**.
 *   - scripts/verify-schema-parity.js carries two content_block columns at WARN
 *     only, and its REQUIRED_INDEXES list does not include (company_id, id), so
 *     nothing anywhere checks for the key this call site needs.
 *   - No runbook or release checklist references the migration: a repository
 *     grep for 20261212000000 finds only this comment.
 *
 * Nor is the 23505 outcome itself established here: that `(company_id, id)`
 * infers only the composite index, and that a row landing on the primary key
 * therefore raises instead of taking the DO UPDATE branch, is reasoned from
 * PostgreSQL's arbiter-inference rules and has NOT been executed. The unit
 * tests model it; a mock cannot prove it.
 *
 * This is a DEFENCE IN DEPTH backstop, not the primary control, and the
 * conditionality above is exactly why. The primary control is the ownership
 * pre-validation below, which needs no schema change and no inference, because
 * the database cannot distinguish "this id is not yours" from "this id does
 * not exist" — only the application can.
 */
export const BLOCK_CONFLICT_TARGET = 'company_id,id';

function blockError(message: string, status: number, code: string): Error {
  const err = new Error(message) as Error & { status: number; code: string };
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Upsert section blocks for a content row (company-scoped). Rows carrying an
 * `id` update that block in place; rows without one are inserted.
 *
 * MIXED BATCHES ARE AN OPEN QUESTION, not a supported shape. The route accepts
 * a batch combining id-bearing and id-less elements, and this function forwards
 * it, but the installed client sends the UNION of all row keys as `columns=`
 * and omits `Prefer: missing=default` at its default, so an id-less element in
 * a mixed batch is expected to be written with a NULL id against a uuid PRIMARY
 * KEY — failing the whole statement and losing the valid elements with it. That
 * expectation is from the client's own source and documented contract and has
 * NOT been executed against PostgREST. No in-repo caller sends the shape. The
 * contract this endpoint should have is an OPEN OWNER DECISION; nothing here
 * has been changed to pick one.
 *
 * OWNERSHIP. A caller-supplied `id` NEVER authorizes an ownership transfer.
 * Every supplied id must already belong to BOTH `companyId` and `contentId`;
 * the whole batch is rejected otherwise, before any write, so an unauthorized
 * element cannot produce a partial write. An id that does not exist at all is
 * rejected for the same reason — this endpoint updates existing blocks and
 * inserts new ones without an id; it does not create a block at a
 * caller-chosen id.
 *
 * ERRORS ARE RAISED, NOT SWALLOWED. Unlike the other read paths in this
 * service, a validation or database failure here throws a status-carrying
 * error so the route reports it. Returning `[]` on failure would be
 * indistinguishable from "saved nothing successfully", which is exactly how a
 * denied cross-tenant write could have looked like a success.
 */
export async function upsertBlocks(
  companyId: string,
  contentId: string,
  blocks: BlockUpsertInput[],
): Promise<CollabBlock[]> {
  if (!companyId) throw blockError('companyId required', 400, 'VALIDATION');
  if (!contentId) throw blockError('contentId required', 400, 'VALIDATION');
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  // ── 1. shape + id validation (no database access yet) ───────────────────
  //
  // ID NORMALISATION — WHERE IT HAPPENS, AND WHAT COUPLES THE SITES.
  //
  // WHY ANY OF IT. `UUID_RE` is case-insensitive, so `…ABCD` is a valid uuid —
  // but PostgreSQL's uuid output is always canonical LOWERCASE, and the
  // ownership comparison below is a JavaScript string compare. Without
  // normalising, a caller supplying its OWN block id in uppercase would match
  // no row in the `owned` set and be refused with a spurious 404.
  //
  // THE FOUR SITES, each stated as it actually is:
  //   1. CAPTURE (just below). `b.id` is read, `.trim()`ed and `.toLowerCase()`d
  //      into a local, validated against UUID_RE, and pushed to `suppliedIds`.
  //      A non-string id becomes '' and is rejected here, so nothing downstream
  //      has to re-check the type.
  //   2. DUPLICATE DETECTION (step 1, below). Runs on `suppliedIds`, i.e. on the
  //      normalised values, so `…ABCD` and `…abcd` in one batch are correctly
  //      one block rather than two.
  //   3. OWNERSHIP COMPARISON (step 2). The query sends `suppliedIds`, and the
  //      rows that come back are lower-cased again before the set compare, so
  //      the comparison does not depend on a driver or a fake returning the
  //      canonical form. Nothing in this repository returns a non-canonical
  //      uuid, so that second lower-case is defensive, not load-bearing.
  //   4. WRITE (step 3). `b.id` is read a SECOND time, from the same input
  //      object, and `.trim()`ed and `.toLowerCase()`d again.
  //
  // WHAT IS AND IS NOT GUARANTEED. An earlier version of this comment said the
  // id is "lower-cased once … so the two can never diverge". That was false:
  // sites 1 and 4 are two independent reads of `b.id` with two independently
  // written transformations. They agree today because the transformations are
  // written identically, NOT because one value is carried from the validation
  // to the write. Changing either without the other would validate one string
  // and persist a different one. The tests in
  // backend/tests/unit/collaborationBlockTenantSafety.test.ts pin each site
  // separately for exactly that reason.
  //
  // SCOPE. This is a normalisation of representation only: a uuid is
  // case-insensitive by definition, so it neither widens nor narrows which rows
  // a caller can reach, and the company + content scoping below is untouched.
  const suppliedIds: string[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') {
      throw blockError('each block must be an object', 400, 'VALIDATION');
    }
    if (b.id !== undefined && b.id !== null) {
      const id = typeof b.id === 'string' ? b.id.trim().toLowerCase() : '';
      if (!UUID_RE.test(id)) {
        throw blockError('block id must be a uuid', 400, 'VALIDATION');
      }
      suppliedIds.push(id);
    }
  }
  // Duplicate detection runs on the normalised ids, so `…ABCD` and `…abcd` in
  // one batch are correctly rejected as the same block rather than slipping
  // through as two.
  if (new Set(suppliedIds).size !== suppliedIds.length) {
    throw blockError('duplicate block id in request', 400, 'VALIDATION');
  }

  // ── 2. ownership pre-validation ─────────────────────────────────────────
  // Every supplied id must already be a block of THIS company AND THIS
  // content. Scoping on both columns is what makes a foreign id — and an id
  // belonging to this company but to different content — fail closed.
  if (suppliedIds.length > 0) {
    const { data, error } = await supabase
      .from(BLOCK_TABLE)
      .select('id')
      .eq('company_id', companyId)
      .eq('content_id', contentId)
      .in('id', suppliedIds);
    if (error) {
      throw blockError(`block ownership lookup failed: ${error.message}`, 500, 'BLOCK_LOOKUP_FAILED');
    }
    // Site 3 of the normalisation described above. Both sides are lower-cased:
    // the supplied ids were normalised at capture, and the database side is
    // normalised here too rather than relying on PostgreSQL's canonical output,
    // so the comparison cannot depend on which driver or fake returned the row.
    // Defensive rather than load-bearing — no producer in this repository
    // returns a non-canonical uuid — and pinned by its own test so that removing
    // it is not a silent no-op.
    const owned = new Set((data ?? []).map((r: { id: string }) => String(r.id).toLowerCase()));
    const rejected = suppliedIds.filter((id) => !owned.has(id));
    if (rejected.length > 0) {
      // Deliberately a 404, not a 403: do not confirm that an id exists in
      // another company. The rejected ids were supplied by the caller, so
      // echoing them back discloses nothing it did not already hold.
      throw blockError(
        `block not found for this company and content: ${rejected.join(', ')}`,
        404,
        'NOT_FOUND',
      );
    }
  }

  // ── 3. write ────────────────────────────────────────────────────────────
  const rows = blocks.map((b) => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const row: Record<string, any> = {
      company_id: companyId,
      content_id: contentId,
      block_type: b.blockType,
      position: b.position,
      text: b.text ?? null,
      locked: b.locked ?? false,
    };
    // Site 4 of the normalisation described above: a SECOND read of `b.id`,
    // transformed the same way as the capture site so that the id validated
    // against the owned set is the id written. The two are kept in step by
    // being written identically, not by sharing a value — see the note above,
    // and the per-site tests that pin each one.
    if (b.id) row.id = String(b.id).trim().toLowerCase();
    return row;
  });
  const { data, error } = await supabase
    .from(BLOCK_TABLE)
    .upsert(rows, { onConflict: BLOCK_CONFLICT_TARGET })
    .select('*');
  if (error) {
    throw blockError(`upsertBlocks failed: ${error.message}`, 500, 'BLOCK_WRITE_FAILED');
  }
  return (data ?? []).map(mapBlock).sort((a, b) => a.position - b.position);
}

/** List a content row's blocks, ordered by position (company-scoped). */
export async function listBlocks(contentId: string, companyId: string): Promise<CollabBlock[]> {
  try {
    if (!contentId || !companyId) return [];
    const { data, error } = await supabase
      .from(BLOCK_TABLE)
      .select('*')
      .eq('content_id', contentId)
      .eq('company_id', companyId)
      .order('position', { ascending: true });
    if (error) {
      console.warn('[collaborationService] listBlocks failed:', error.message);
      return [];
    }
    return (data ?? []).map(mapBlock);
  } catch (e) {
    console.warn('[collaborationService] listBlocks threw:', (e as Error)?.message);
    return [];
  }
}

/** Lock or unlock a block (company-scoped). Returns the updated block or null. */
export async function setBlockLocked(
  blockId: string,
  companyId: string,
  locked: boolean,
): Promise<CollabBlock | null> {
  try {
    if (!blockId || !companyId) return null;
    const { data, error } = await supabase
      .from(BLOCK_TABLE)
      .update({ locked })
      .eq('id', blockId)
      .eq('company_id', companyId)
      .select('*')
      .maybeSingle();
    if (error) {
      console.warn('[collaborationService] setBlockLocked failed:', error.message);
      return null;
    }
    return data ? mapBlock(data) : null;
  } catch (e) {
    console.warn('[collaborationService] setBlockLocked threw:', (e as Error)?.message);
    return null;
  }
}

/* ── recommendations CRUD ────────────────────────────────────────────────── */

/**
 * Persist generated recommendations (from recommendationRuntime) for a content
 * row. Each rec's `before`/`after` become `before_text`/`after_text` for
 * reversibility. Returns the persisted rows. Fail-safe: [] on error.
 */
export async function saveRecommendations(
  companyId: string,
  contentId: string,
  recs: Recommendation[],
): Promise<CollabRecommendation[]> {
  try {
    if (!companyId || !contentId || !recs?.length) return [];
    const rows = recs.map((r) => ({
      company_id: companyId,
      content_id: contentId,
      block_id: r.blockId ?? null,
      affected_section: r.affectedSection ?? r.blockType ?? null,
      category: r.category,
      reason: r.reason,
      expected_impact: r.expectedImpact ?? null,
      confidence: r.confidence ?? null,
      before_text: r.before ?? null,
      after_text: r.after ?? null,
      quality_ref: r.qualityRef ?? null,
      status: 'pending',
    }));
    const { data, error } = await supabase.from(REC_TABLE).insert(rows).select('*');
    if (error) {
      console.warn('[collaborationService] saveRecommendations failed:', error.message);
      return [];
    }
    return (data ?? []).map(mapRec);
  } catch (e) {
    console.warn('[collaborationService] saveRecommendations threw:', (e as Error)?.message);
    return [];
  }
}

export interface ListRecommendationsFilter {
  status?: RecommendationStatus;
}

/** List a content row's recommendations (company-scoped), newest first. */
export async function listRecommendations(
  contentId: string,
  companyId: string,
  filter: ListRecommendationsFilter = {},
): Promise<CollabRecommendation[]> {
  try {
    if (!contentId || !companyId) return [];
    let query = supabase
      .from(REC_TABLE)
      .select('*')
      .eq('content_id', contentId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
    if (filter.status) query = query.eq('status', filter.status);
    const { data, error } = await query;
    if (error) {
      console.warn('[collaborationService] listRecommendations failed:', error.message);
      return [];
    }
    return (data ?? []).map(mapRec);
  } catch (e) {
    console.warn('[collaborationService] listRecommendations threw:', (e as Error)?.message);
    return [];
  }
}

async function getRec(recId: string, companyId: string): Promise<CollabRecommendation | null> {
  const { data, error } = await supabase
    .from(REC_TABLE)
    .select('*')
    .eq('id', recId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    console.warn('[collaborationService] getRec failed:', error.message);
    return null;
  }
  return data ? mapRec(data) : null;
}

async function getBlock(blockId: string, companyId: string): Promise<CollabBlock | null> {
  const { data, error } = await supabase
    .from(BLOCK_TABLE)
    .select('*')
    .eq('id', blockId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    console.warn('[collaborationService] getBlock failed:', error.message);
    return null;
  }
  return data ? mapBlock(data) : null;
}

async function markRecStatus(
  recId: string,
  companyId: string,
  status: RecommendationStatus,
  beforeText?: string | null,
): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const patch: Record<string, any> = { status, resolved_at: new Date().toISOString() };
  if (beforeText !== undefined) patch.before_text = beforeText;
  const { error } = await supabase
    .from(REC_TABLE)
    .update(patch)
    .eq('id', recId)
    .eq('company_id', companyId);
  if (error) console.warn('[collaborationService] markRecStatus failed:', error.message);
}

/**
 * Accept a recommendation: apply its `after_text` to the target block, preserve
 * the prior text on the rec (reversibility) and set status=accepted. Enforces
 * the safety rules via evaluateAcceptance:
 *   - locked block           → refuse (rec stays pending)
 *   - manual edit since rec   → supersede (rec marked superseded, NOT applied)
 * Fail-safe: never throws.
 */
export async function acceptRecommendation(recId: string, companyId: string): Promise<AcceptResult> {
  try {
    if (!recId || !companyId) return { applied: false, recommendationId: recId, reason: 'bad_input' };
    const rec = await getRec(recId, companyId);
    if (!rec) return { applied: false, recommendationId: recId, reason: 'not_found' };
    if (!rec.blockId) {
      // No target block to mutate — nothing reversible to apply.
      return { applied: false, recommendationId: recId, reason: 'no_block' };
    }

    const block = await getBlock(rec.blockId, companyId);
    if (!block) return { applied: false, recommendationId: recId, reason: 'block_not_found' };

    const decision = evaluateAcceptance({
      status: rec.status,
      blockLocked: block.locked,
      currentBlockText: block.text,
      recBefore: rec.beforeText,
    });

    if (decision.action === 'refuse') {
      // Do NOT resolve on a lock — the user may unlock and re-accept later.
      return { applied: false, recommendationId: recId, reason: decision.reason, blockId: block.id };
    }
    if (decision.action === 'supersede') {
      await markRecStatus(recId, companyId, 'superseded');
      return { applied: false, recommendationId: recId, reason: decision.reason, blockId: block.id };
    }

    // apply
    const priorText = block.text; // == rec.beforeText (verified by evaluateAcceptance)
    const { error: updErr } = await supabase
      .from(BLOCK_TABLE)
      .update({ text: rec.afterText ?? '' })
      .eq('id', block.id)
      .eq('company_id', companyId);
    if (updErr) {
      console.warn('[collaborationService] acceptRecommendation block update failed:', updErr.message);
      return { applied: false, recommendationId: recId, reason: 'update_failed', blockId: block.id };
    }
    // Persist the prior text for reversibility + resolve the rec.
    await markRecStatus(recId, companyId, 'accepted', priorText);

    return {
      applied: true,
      recommendationId: recId,
      reason: 'applied',
      blockId: block.id,
      before: priorText,
      after: rec.afterText,
    };
  } catch (e) {
    console.warn('[collaborationService] acceptRecommendation threw:', (e as Error)?.message);
    return { applied: false, recommendationId: recId, reason: 'error' };
  }
}

/** Reject a recommendation: status=rejected, resolved_at set. Fail-safe. */
export async function rejectRecommendation(recId: string, companyId: string): Promise<AcceptResult> {
  try {
    if (!recId || !companyId) return { applied: false, recommendationId: recId, reason: 'bad_input' };
    const rec = await getRec(recId, companyId);
    if (!rec) return { applied: false, recommendationId: recId, reason: 'not_found' };
    if (rec.status !== 'pending') {
      return { applied: false, recommendationId: recId, reason: rec.status };
    }
    await markRecStatus(recId, companyId, 'rejected');
    return { applied: false, recommendationId: recId, reason: 'rejected' };
  } catch (e) {
    console.warn('[collaborationService] rejectRecommendation threw:', (e as Error)?.message);
    return { applied: false, recommendationId: recId, reason: 'error' };
  }
}

export interface AcceptAllResult {
  accepted: string[];
  skipped: { id: string; reason: string }[];
}

/**
 * Accept every pending recommendation for a content row, in creation order.
 * Locked / superseded / already-resolved recs are skipped (never forced). Note:
 * once a block is edited by an accepted rec, later recs whose `before` no longer
 * matches are correctly superseded (manual-edit precedence also protects prior
 * accepts). Fail-safe.
 */
export async function acceptAll(contentId: string, companyId: string): Promise<AcceptAllResult> {
  const result: AcceptAllResult = { accepted: [], skipped: [] };
  try {
    const pending = await listRecommendations(contentId, companyId, { status: 'pending' });
    for (const rec of pending) {
      const r = await acceptRecommendation(rec.id, companyId);
      if (r.applied) result.accepted.push(rec.id);
      else result.skipped.push({ id: rec.id, reason: r.reason });
    }
    return result;
  } catch (e) {
    console.warn('[collaborationService] acceptAll threw:', (e as Error)?.message);
    return result;
  }
}

export interface RestoreResult {
  restored: number;
  blockIds: string[];
}

/**
 * Restore a content row's blocks to their pre-recommendation text by reverting
 * every ACCEPTED rec (most-recent first) back to the `before_text` preserved at
 * accept time. Each reverted rec is marked `superseded` (consumed). This is the
 * section-level "restore original" — the block-revision snapshot lives in each
 * rec's before_text. (Content-row field revisions remain contentService's job;
 * WAVE4-TODO if a full content_revision restore is later wired here.) Fail-safe.
 */
export async function restoreOriginal(contentId: string, companyId: string): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, blockIds: [] };
  try {
    const accepted = await listRecommendations(contentId, companyId, { status: 'accepted' });
    // Undo in reverse chronological order so stacked edits unwind correctly.
    const ordered = accepted
      .filter((r) => r.blockId && r.beforeText != null)
      .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));

    for (const rec of ordered) {
      const { error: updErr } = await supabase
        .from(BLOCK_TABLE)
        .update({ text: rec.beforeText ?? '' })
        .eq('id', rec.blockId as string)
        .eq('company_id', companyId);
      if (updErr) {
        console.warn('[collaborationService] restoreOriginal block revert failed:', updErr.message);
        continue;
      }
      await markRecStatus(rec.id, companyId, 'superseded');
      result.restored += 1;
      result.blockIds.push(rec.blockId as string);
    }
    return result;
  } catch (e) {
    console.warn('[collaborationService] restoreOriginal threw:', (e as Error)?.message);
    return result;
  }
}
