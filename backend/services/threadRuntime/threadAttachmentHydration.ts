/**
 * G6 — canonical thread attachment hydration.
 *
 * Single read path that returns a thread's per-node attachment layout in the
 * canonical shape. Backend surfaces that need to render or inspect a thread's
 * attachments (preview parity checks, super-admin tooling, retry/replay
 * verification) should use this instead of re-querying scheduled_posts and
 * re-shaping the row data themselves.
 *
 * The orchestrator + adapters do NOT need this helper — they consume
 * `scheduled_posts.media_urls` directly per row, which the migration
 * `20260809_thread_per_node_attachments.sql` is responsible for populating
 * from the per-node payload. This helper exists so out-of-band readers
 * (preview, admin, observability) see the same data the publisher will.
 */

import { supabase } from '../../db/supabaseClient';
import {
  rehydrateAttachmentsFromDbArrays,
  type CanonicalAttachment,
  type CanonicalNodeAttachments,
} from '@/lib/shared/attachments/canonicalAttachment';

export interface HydratedThreadNode {
  rowId: string;
  position: number;
  content: string;
  isRoot: boolean;
  attachments: CanonicalAttachment[];
}

export interface HydratedThread {
  rootId: string;
  platform: string;
  nodes: HydratedThreadNode[];
  /** Per-position attachment list, ordered ascending. Empty when no node carries media. */
  attachmentsByPosition: CanonicalNodeAttachments[];
}

/**
 * Load a thread's root + all children, projecting each row's media columns
 * into the canonical attachment shape. Returns null when the root is missing
 * or is not a thread start.
 *
 * Read path mirrors the orchestrator's `loadThreadRows` exactly (same SELECT
 * + ORDER BY thread_position), so canonical hydration sees the same row
 * universe the publisher does.
 */
export async function hydrateThread(rootId: string): Promise<HydratedThread | null> {
  const { data: root, error: rootErr } = await supabase
    .from('scheduled_posts')
    .select('id, platform, content, thread_position, is_thread_start, media_urls, media_types')
    .eq('id', rootId)
    .maybeSingle();
  if (rootErr || !root) return null;
  if ((root as { is_thread_start?: boolean }).is_thread_start !== true) return null;

  const { data: children, error: childErr } = await supabase
    .from('scheduled_posts')
    .select('id, platform, content, thread_position, is_thread_start, media_urls, media_types')
    .eq('parent_post_id', rootId)
    .order('thread_position', { ascending: true });
  if (childErr) return null;

  const allRows = [root, ...(children ?? [])] as Array<{
    id: string;
    platform: string | null;
    content: string | null;
    thread_position: number | null;
    is_thread_start: boolean | null;
    media_urls: string[] | null;
    media_types: string[] | null;
  }>;

  const nodes: HydratedThreadNode[] = allRows.map((row) => ({
    rowId: row.id,
    position: typeof row.thread_position === 'number' ? row.thread_position : 0,
    content: row.content ?? '',
    isRoot: row.is_thread_start === true,
    attachments: rehydrateAttachmentsFromDbArrays({
      media_urls: row.media_urls,
      media_types: row.media_types,
    }),
  }));

  const attachmentsByPosition: CanonicalNodeAttachments[] = nodes
    .filter((n) => n.attachments.length > 0)
    .map((n) => ({ nodePosition: n.position, attachments: n.attachments }));

  return {
    rootId,
    platform: String(root.platform ?? ''),
    nodes,
    attachmentsByPosition,
  };
}
