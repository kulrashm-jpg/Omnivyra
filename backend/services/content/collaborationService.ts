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
 * explicitly company-scoped. Fail-safe: failures log and return a structured
 * result rather than throwing.
 *
 * See supabase/migrations/20260718000002_content_quality_collaboration.sql.
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

/**
 * Upsert section blocks for a content row (company-scoped). Rows carrying an
 * `id` are updated in place; others are inserted. Returns the persisted blocks,
 * ordered by position. Fail-safe: returns [] on error.
 */
export async function upsertBlocks(
  companyId: string,
  contentId: string,
  blocks: BlockUpsertInput[],
): Promise<CollabBlock[]> {
  try {
    if (!companyId || !contentId || !blocks?.length) return [];
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
      if (b.id) row.id = b.id;
      return row;
    });
    const { data, error } = await supabase
      .from(BLOCK_TABLE)
      .upsert(rows, { onConflict: 'id' })
      .select('*');
    if (error) {
      console.warn('[collaborationService] upsertBlocks failed:', error.message);
      return [];
    }
    return (data ?? []).map(mapBlock).sort((a, b) => a.position - b.position);
  } catch (e) {
    console.warn('[collaborationService] upsertBlocks threw:', (e as Error)?.message);
    return [];
  }
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
