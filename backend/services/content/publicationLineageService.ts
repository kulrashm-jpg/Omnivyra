/**
 * Wave 5 (item 7) — Publication Lineage.
 *
 * The single write/read seam for `publication_lineage` — a complete, traceable,
 * APPEND-ONLY history of every publication event (published / reposted /
 * regenerated / revised / scheduled) for a piece of content. Lineage rows are
 * never mutated; a repost or regeneration records a NEW event that points back
 * at its `parent_content_id`, forming a reconstructable chain.
 *
 * Design:
 *  - Shared service-role client (`backend/db/supabaseClient`); the service role
 *    bypasses RLS, so EVERY method is explicitly company-scoped.
 *  - FAIL-SAFE: recording never throws (a publish flow must not fail because a
 *    lineage write failed). Reads return `[]` / a minimal chain on error.
 */

import { supabase } from '../../db/supabaseClient';
// PHASE A — canonical persistence activation boundary (default DENY).
import { isCanonicalPersistenceEnabled } from './canonicalPersistencePolicy';

const LINEAGE_TABLE = 'publication_lineage';

/** The event kinds tracked in the publication lineage (mirrors the CHECK). */
export type LineageEventType =
  | 'published'
  | 'reposted'
  | 'regenerated'
  | 'revised'
  | 'scheduled';

export const LINEAGE_EVENT_TYPES: readonly LineageEventType[] = [
  'published',
  'reposted',
  'regenerated',
  'revised',
  'scheduled',
] as const;

export interface RecordEventInput {
  companyId: string;
  contentId?: string | null;
  eventType: LineageEventType;
  platform?: string | null;
  /** The content this event descends from (repost / regeneration source). */
  parentContentId?: string | null;
  scheduledPostId?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * WS-1a (PMO-ADR-06) — SOFT reference to the immutable generation-time
   * Semantic Root. When supplied it is folded into `metadata.semanticRootId`,
   * linking this lifecycle EVENT LOG row back to the generation identity. This
   * is the ONLY lineage store; the Semantic Root is not a parallel lineage
   * table. ADDITIVE + OPTIONAL: omitting it leaves `metadata` byte-identical, so
   * every existing caller is unaffected.
   */
  semanticRootId?: string | null;
  /** ISO event time. Supplied by the caller for reproducibility; optional. */
  createdAt?: string;
}

/** A persisted lineage event projected to camelCase. */
export interface LineageEvent {
  id: string;
  companyId: string;
  contentId: string | null;
  parentContentId: string | null;
  eventType: LineageEventType;
  platform: string | null;
  scheduledPostId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * The reconstructed lineage for a content item: the item's own events plus the
 * ancestor chain assembled by following `parentContentId` links.
 */
export interface LineageChain {
  /** The content id the lineage was requested for. */
  contentId: string;
  /** Every event for this content id, oldest-first. */
  events: LineageEvent[];
  /**
   * The ordered ancestry from the ROOT content id down to this content id
   * (inclusive), reconstructed by walking `parentContentId`. A piece with no
   * parents yields `[contentId]`.
   */
  ancestry: string[];
  /** The root (origin) content id of the chain. */
  rootContentId: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(row: any): LineageEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    contentId: row.content_id ?? null,
    parentContentId: row.parent_content_id ?? null,
    eventType: row.event_type as LineageEventType,
    platform: row.platform ?? null,
    scheduledPostId: row.scheduled_post_id ?? null,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Append one lineage event. Company-scoped, append-only, fail-safe (returns
 * `null` instead of throwing). Invalid `eventType` is rejected (returns null)
 * so a bad caller cannot violate the table CHECK.
 */
export async function recordEvent(input: RecordEventInput): Promise<LineageEvent | null> {
  try {
    // PHASE A — canonical persistence boundary. `publication_lineage` is part of
    // the Phase A foundation, so it stays inert while the policy denies. This
    // writer is FAIL-SAFE by contract (never throws), so a refusal returns null
    // exactly like any other unavailable-write path — byte-identical to today,
    // where the same call fails against the missing table.
    if (!isCanonicalPersistenceEnabled()) return null;
    if (!input?.companyId) return null;
    if (!LINEAGE_EVENT_TYPES.includes(input.eventType)) return null;

    // WS-1a — fold an optional Semantic Root soft-ref into metadata. When absent
    // the value stays exactly `input.metadata ?? null` (byte-identical for every
    // existing caller); when present it links this event to the generation root.
    const rootId =
      typeof input.semanticRootId === 'string' && input.semanticRootId.trim().length > 0
        ? input.semanticRootId.trim()
        : null;
    const metadata: Record<string, unknown> | null = rootId
      ? { ...(input.metadata ?? {}), semanticRootId: rootId }
      : input.metadata ?? null;

    const insertRow: Record<string, unknown> = {
      company_id: input.companyId,
      content_id: input.contentId ?? null,
      parent_content_id: input.parentContentId ?? null,
      event_type: input.eventType,
      platform: input.platform ?? null,
      scheduled_post_id: input.scheduledPostId ?? null,
      metadata,
    };
    if (input.createdAt) insertRow.created_at = input.createdAt;

    const { data, error } = await supabase
      .from(LINEAGE_TABLE)
      .insert(insertRow)
      .select('*')
      .single();
    if (error || !data) return null;
    return mapRow(data);
  } catch {
    return null;
  }
}

/**
 * Fetch every lineage event for a single content id, oldest-first.
 * Company-scoped. Returns `[]` on error.
 */
export async function getEvents(
  contentId: string,
  companyId: string,
): Promise<LineageEvent[]> {
  try {
    if (!contentId || !companyId) return [];
    const { data, error } = await supabase
      .from(LINEAGE_TABLE)
      .select('*')
      .eq('content_id', contentId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return (data as unknown[]).map((r) => mapRow(r));
  } catch {
    return [];
  }
}

/**
 * Reconstruct the full lineage for a content item: its own events plus the
 * ancestry chain built by following `parent_content_id` upward to the root.
 *
 * The walk is company-scoped and cycle-guarded (a visited set bounds it), so a
 * malformed self-referential chain cannot loop forever. Fail-safe: on error it
 * returns a minimal single-node chain for `contentId`.
 */
export async function getLineage(
  contentId: string,
  companyId: string,
): Promise<LineageChain> {
  const fallback: LineageChain = {
    contentId,
    events: [],
    ancestry: [contentId],
    rootContentId: contentId,
  };
  try {
    if (!contentId || !companyId) return fallback;

    const events = await getEvents(contentId, companyId);

    // Walk parents upward. Every event that carries a parent_content_id gives us
    // the next ancestor; we follow the FIRST parent link we can find per hop.
    const ancestryReversed: string[] = [contentId];
    const visited = new Set<string>([contentId]);
    let cursorEvents = events;
    let cursor = contentId;

    // Bound the walk defensively (depth cap) in addition to the visited-set guard.
    for (let depth = 0; depth < 256; depth += 1) {
      const parent = cursorEvents
        .map((e) => e.parentContentId)
        .find((p): p is string => typeof p === 'string' && p.length > 0 && !visited.has(p));
      if (!parent) break;
      ancestryReversed.push(parent);
      visited.add(parent);
      cursor = parent;
      cursorEvents = await getEvents(parent, companyId);
    }

    const ancestry = [...ancestryReversed].reverse(); // root → … → contentId
    return {
      contentId,
      events,
      ancestry,
      rootContentId: ancestry[0] ?? contentId,
    };
  } catch {
    return fallback;
  }
}
