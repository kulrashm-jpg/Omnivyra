/**
 * Phase 1B.1 — Multi-row thread insert helper.
 *
 * Thin wrapper over the `insert_thread_atomic` and `replace_thread_children`
 * Postgres RPCs (see supabase/migrations/20260806_thread_multi_row_runtime.sql).
 * Both RPCs run with SECURITY INVOKER so the caller's RLS context applies.
 *
 * The endpoint passes its own Supabase client (cookie-bound user client OR the
 * service client used by activity-workspace/scheduler) — this module makes no
 * assumption about which.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ThreadNodePayload } from './threadNodeContract';
import { projectAttachmentsToDbArrays } from '@/lib/shared/attachments/canonicalAttachment';

/**
 * G6/G2 — project a ThreadNodePayload into the RPC JSONB shape, including
 * per-node media_urls + media_types when the node carries attachments.
 *
 * Forward-compatible: when the migration `20260809_thread_per_node_attachments.sql`
 * is NOT yet applied, the RPC silently ignores the extra JSONB keys (Postgres
 * JSONB extraction is no-error on missing keys). After the migration is
 * applied, the RPC reads and persists them per child row.
 */
function projectNodeForRpc(n: ThreadNodePayload): Record<string, unknown> {
  const base: Record<string, unknown> = { position: n.position, content: n.content };
  if (n.attachments && n.attachments.length > 0) {
    const { media_urls, media_types } = projectAttachmentsToDbArrays(n.attachments);
    if (media_urls.length > 0) base.media_urls = media_urls;
    if (media_types.length > 0) base.media_types = media_types;
  }
  return base;
}

export type ThreadInsertPayload = {
  user_id: string;
  social_account_id: string | null;
  campaign_id: string | null;
  platform: string;
  scheduled_for: string;
  title: string | null;
  hashtags: string[] | null;
  nodes: ThreadNodePayload[];
  /**
   * Phase 1B.1A — root row status. Defaults to 'scheduled' (publish-eligible).
   * Shadow-mode callers pass 'draft' so the cron's direct scan does NOT pick
   * up the multi-row root alongside the legacy joined row (which would cause
   * duplicate publish). See lib/thread/threadRuntimeMode.ts for the full
   * publish-ownership semantics.
   *
   * G2 propagation boundary note: the RPC accepts only {position, content}
   * per node. Per-node attachments from G2's nodeAttachmentMap are NOT
   * propagated through this layer. Adding per-node attachment carriage is
   * 1B.2 orchestrator work, not 1B.1A stabilization.
   */
  rootStatus?: 'scheduled' | 'draft';
};

export type ThreadInsertResult = {
  rootId: string;
  nodeIds: string[];
};

export class ThreadInsertError extends Error {
  constructor(message: string, public readonly code: string | null) {
    super(message);
    this.name = 'ThreadInsertError';
  }
}

export async function insertThreadAtomic(
  supabase: SupabaseClient,
  payload: ThreadInsertPayload,
): Promise<ThreadInsertResult> {
  if (!payload.nodes || payload.nodes.length < 2) {
    throw new ThreadInsertError('thread_must_have_at_least_two_nodes', 'INPUT');
  }

  const rpcPayload = {
    user_id: payload.user_id,
    social_account_id: payload.social_account_id,
    campaign_id: payload.campaign_id,
    platform: payload.platform,
    scheduled_for: payload.scheduled_for,
    title: payload.title,
    hashtags: payload.hashtags ?? [],
    // Phase 1B.1A — defaults to 'scheduled' inside the RPC when omitted.
    ...(payload.rootStatus ? { root_status: payload.rootStatus } : {}),
    nodes: payload.nodes.map(projectNodeForRpc),
  };

  const { data, error } = await supabase.rpc('insert_thread_atomic', { p_payload: rpcPayload });
  if (error) {
    throw new ThreadInsertError(error.message, error.code ?? null);
  }
  return parseRpcResult(data);
}

export async function replaceThreadChildren(
  supabase: SupabaseClient,
  rootId: string,
  children: ThreadNodePayload[],
): Promise<ThreadInsertResult> {
  const { data, error } = await supabase.rpc('replace_thread_children', {
    p_root_id: rootId,
    p_children: children.map(projectNodeForRpc),
  });
  if (error) {
    throw new ThreadInsertError(error.message, error.code ?? null);
  }
  return parseRpcResult(data);
}

function parseRpcResult(data: unknown): ThreadInsertResult {
  if (!data || typeof data !== 'object') {
    throw new ThreadInsertError('thread_rpc_unexpected_response', null);
  }
  const obj = data as Record<string, unknown>;
  const rootId = typeof obj.root_id === 'string' ? obj.root_id : null;
  const nodeIdsRaw = obj.node_ids;
  if (!rootId || !Array.isArray(nodeIdsRaw)) {
    throw new ThreadInsertError('thread_rpc_unexpected_response', null);
  }
  const nodeIds = nodeIdsRaw.filter((v): v is string => typeof v === 'string');
  return { rootId, nodeIds };
}
