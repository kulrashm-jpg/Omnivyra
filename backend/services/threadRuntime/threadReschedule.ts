/**
 * Closure-004 — re-schedule an EXISTING multi-row thread without losing the
 * identity of any node that may already be on the platform.
 *
 * The replace primitive (`replace_thread_children` RPC) deletes EVERY child of
 * the root and inserts fresh 'draft' children with no platform_post_id. Run
 * over a thread whose children were published (or may have been), the next
 * thread run publishes them all again. So the replace is only ever allowed
 * when NO node of the thread has an identity to lose:
 *
 *   node identity (classifyThreadNodeIdentity)   re-schedule
 *   ───────────────────────────────────────────   ─────────────────────────────
 *   published   (platform_post_id / 'published')  refused THREAD_ALREADY_PUBLISHED
 *   in_flight   (publishing / fenced)              refused THREAD_PUBLISH_IN_PROGRESS
 *   uncertain   (UNCERTAIN / CALL_STARTED / code-  refused PUBLISH_OUTCOME_UNCERTAIN
 *                less failure)                      (reconcile first)
 *   replaceable (never reached the platform)       replaced (unchanged, modified,
 *                                                  removed and added children alike)
 *
 * A published node is never rewritten, deleted or turned back into a
 * publishable one here. There is deliberately no "replace published" mode:
 * posting new content means scheduling a NEW thread (the published posts stay
 * on the platform; nothing deletes them there).
 *
 * Concurrency, without a schema change:
 *   1. Every child is FENCED first — error_code := THREAD_RESCHEDULING:<token>,
 *      compare-and-set on the exact (status, error_code, no platform_post_id,
 *      owner) that was read. Publishers read a fenced node as held and never
 *      claim it; a publisher that claimed a child first makes the fence miss,
 *      and the re-schedule is refused (fences already written are rolled back).
 *   2. The RPC then deletes and re-inserts the children in ONE transaction.
 *   3. The root is rewritten compare-and-set on the state that was read.
 * Ownership: every read and write is bound to the authenticated owner; a child
 * belonging to anyone else makes the thread refuse (never silently re-owned).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import type { ThreadNodePayload } from '../../../lib/thread/threadNodeContract';
import { replaceThreadChildren } from '../../../lib/thread/threadNodePersistence';
import { classifyThreadNodeIdentity, threadReschedulingCode } from '../../queue/publishOutcome';

type NodeRow = {
  id: string;
  user_id?: string | null;
  status?: string | null;
  error_code?: string | null;
  platform_post_id?: string | null;
};

export type ThreadRescheduleRefusal =
  | 'THREAD_ALREADY_PUBLISHED'
  | 'THREAD_PUBLISH_IN_PROGRESS'
  | 'PUBLISH_OUTCOME_UNCERTAIN'
  | 'THREAD_OWNERSHIP_CONFLICT'
  | 'THREAD_CHANGED_CONCURRENTLY';

export type ThreadRescheduleOutcome =
  | { ok: true }
  | { ok: false; code: ThreadRescheduleRefusal; message: string; nodeIds: string[] };

const MESSAGES: Record<ThreadRescheduleRefusal, string> = {
  THREAD_ALREADY_PUBLISHED:
    'Part of this thread is already published. Published posts are never replaced or re-published by ' +
    're-scheduling; schedule a new thread to post new content.',
  THREAD_PUBLISH_IN_PROGRESS: 'This thread is being published right now. Try again once it has finished.',
  PUBLISH_OUTCOME_UNCERTAIN:
    'A post in this thread may already have been published: its last attempt reached the platform but the ' +
    'result was not saved. Check the platform and have the outcome reconciled before re-scheduling.',
  THREAD_OWNERSHIP_CONFLICT: 'This thread contains posts that do not belong to you, so it cannot be re-scheduled.',
  THREAD_CHANGED_CONCURRENTLY: 'The thread changed while it was being re-scheduled. Refresh and try again.',
};

const refuse = (code: ThreadRescheduleRefusal, nodeIds: string[]): ThreadRescheduleOutcome =>
  ({ ok: false, code, message: MESSAGES[code], nodeIds });

/** Compare-and-set predicate on the error_code that was read. */
function pinCode<Q extends { is: (c: string, v: null) => Q; eq: (c: string, v: string) => Q }>(q: Q, code: string | null | undefined): Q {
  return code == null ? q.is('error_code', null) : q.eq('error_code', code);
}

export async function rescheduleExistingThread(
  supabase: SupabaseClient,
  input: {
    rootId: string;
    /** The authenticated principal — never a client-supplied id. */
    userId: string;
    /** Root columns to rewrite (content, schedule, account, status, ...). Never user_id. */
    rootUpdate: Record<string, unknown>;
    children: ThreadNodePayload[];
  },
): Promise<ThreadRescheduleOutcome> {
  const { rootId, userId } = input;

  const { data: rootData, error: rootErr } = await supabase
    .from('scheduled_posts')
    .select('id, user_id, status, error_code, platform_post_id')
    .eq('id', rootId)
    .eq('user_id', userId)
    .eq('is_thread_start', true)
    .maybeSingle();
  if (rootErr) throw new Error(`thread root read failed: ${rootErr.message}`);
  if (!rootData) return refuse('THREAD_CHANGED_CONCURRENTLY', [rootId]);
  const root = rootData as NodeRow;

  // Children are read WITHOUT an owner filter on purpose: one that belongs to
  // someone else must make the thread refuse, not be silently skipped (the
  // replace would delete it).
  const { data: childData, error: childErr } = await supabase
    .from('scheduled_posts')
    .select('id, user_id, status, error_code, platform_post_id')
    .eq('parent_post_id', rootId);
  if (childErr) throw new Error(`thread children read failed: ${childErr.message}`);
  const children = (Array.isArray(childData) ? childData : []) as NodeRow[];

  const foreign = children.filter((c) => c.user_id !== userId).map((c) => c.id);
  if (foreign.length > 0) return refuse('THREAD_OWNERSHIP_CONFLICT', foreign);

  const nodes = [root, ...children];
  const byIdentity = (identity: string) => nodes.filter((n) => classifyThreadNodeIdentity(n) === identity).map((n) => n.id);
  const published = byIdentity('published');
  if (published.length > 0) return refuse('THREAD_ALREADY_PUBLISHED', published);
  const inFlight = byIdentity('in_flight');
  if (inFlight.length > 0) return refuse('THREAD_PUBLISH_IN_PROGRESS', inFlight);
  const uncertain = byIdentity('uncertain');
  if (uncertain.length > 0) return refuse('PUBLISH_OUTCOME_UNCERTAIN', uncertain);

  // 1. Fence every child on exactly what was read.
  const fence = threadReschedulingCode(randomUUID());
  const fenced: NodeRow[] = [];
  const rollBackFences = async () => {
    for (const child of fenced) {
      await supabase
        .from('scheduled_posts')
        .update({ error_code: child.error_code ?? null })
        .eq('id', child.id)
        .eq('error_code', fence);
    }
  };
  for (const child of children) {
    let q = supabase
      .from('scheduled_posts')
      .update({ error_code: fence, updated_at: new Date().toISOString() })
      .eq('id', child.id)
      .eq('parent_post_id', rootId)
      .eq('user_id', userId)
      .eq('status', String(child.status ?? ''))
      .is('platform_post_id', null);
    q = pinCode(q, child.error_code);
    const { data, error } = await q.select('id');
    if (error || !Array.isArray(data) || data.length === 0) {
      await rollBackFences();
      if (error) throw new Error(`thread child fence failed: ${error.message}`);
      return refuse('THREAD_CHANGED_CONCURRENTLY', [child.id]);
    }
    fenced.push(child);
  }

  // 2. Atomic delete + re-insert of the (fenced, identity-free) children.
  try {
    await replaceThreadChildren(supabase, rootId, input.children);
  } catch (err) {
    await rollBackFences();
    throw err;
  }

  // 3. The root, compare-and-set on what was read (never re-owned).
  const { user_id: _ignored, ...rootUpdate } = input.rootUpdate;
  void _ignored;
  let rq = supabase
    .from('scheduled_posts')
    .update(rootUpdate)
    .eq('id', rootId)
    .eq('user_id', userId)
    .eq('status', String(root.status ?? ''))
    .is('platform_post_id', null);
  rq = pinCode(rq, root.error_code);
  const { data: rootRows, error: rootUpdateErr } = await rq.select('id');
  if (rootUpdateErr) throw new Error(`thread root update failed: ${rootUpdateErr.message}`);
  if (!Array.isArray(rootRows) || rootRows.length === 0) return refuse('THREAD_CHANGED_CONCURRENTLY', [rootId]);

  return { ok: true };
}
