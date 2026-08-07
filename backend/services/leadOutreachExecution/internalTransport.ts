/**
 * WS-3 Milestone-5A — the internal transport.
 *
 * The ONLY transport this milestone has, and the only one that contacts nobody.
 * An internal dispatch creates a durable work item somebody inside the tenant
 * can act on. Nothing leaves the platform: no email, no WhatsApp, no LinkedIn,
 * no SMS, no HTTP, no third-party SDK, no external queue.
 *
 * That is why internal is the FIRST executable channel: it exercises the entire
 * dispatch chain — governance, quota, lifecycle, attempts, evidence — at zero
 * external risk, so the first real send in Milestone-5B happens on a runtime
 * that has already run.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { OutreachTransport, TransportRequest, TransportResult } from './transport';
import type { OutreachTask } from './types';

export const OUTREACH_INTERNAL_WORK_ITEMS_TABLE = 'outreach_internal_work_items';

/** The channel this transport serves. Anything else is not dispatchable here. */
export const INTERNAL_CHANNEL = 'internal';

export interface InternalDispatchResult {
  ok: boolean;
  /** True when the work item already existed for this attempt. */
  duplicate: boolean;
  workItemId: string | null;
  error?: string;
}

const trim = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

/**
 * Perform an internal dispatch: create the work item.
 *
 * Idempotent by construction — `(company_id, task_id, attempt_id)` is unique,
 * so a retried call for the SAME attempt cannot create a second work item. That
 * is the anti-duplicate-execution anchor at the transport layer, independent of
 * the lifecycle guard above it.
 *
 * Never throws: a failure is returned, because the caller must record the
 * attempt outcome either way.
 */
export async function dispatchInternalTask(
  task: OutreachTask,
  attemptId: string | null,
): Promise<InternalDispatchResult> {
  if (task.channel !== INTERNAL_CHANNEL) {
    // Defence in depth. The runtime checks this too; a transport that would
    // handle a channel it does not serve is a latent external-send bug.
    return { ok: false, duplicate: false, workItemId: null, error: `internal transport cannot dispatch the "${task.channel}" channel` };
  }

  const title = trim(task.action) ?? 'Internal outreach task';
  try {
    const res = await ownedDbTable(OUTREACH_INTERNAL_WORK_ITEMS_TABLE)
      .insert({
        company_id: task.companyId,
        task_id: task.id,
        attempt_id: attemptId,
        lead_id: task.leadId,
        title,
        detail: trim(task.explanation, 2000),
        action: trim(task.action),
        suggested_owner: null, // assignment routing is not WS-3
      })
      .select('id')
      .single();

    if (res.error) {
      const code = String((res.error as { code?: string }).code ?? '');
      if (code === '23505') return { ok: true, duplicate: true, workItemId: null };
      return { ok: false, duplicate: false, workItemId: null, error: String((res.error as { message?: string }).message ?? res.error) };
    }
    return { ok: true, duplicate: false, workItemId: String((res.data as { id?: string } | null)?.id ?? '') || null };
  } catch (e) {
    return { ok: false, duplicate: false, workItemId: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * WS-3 M5B — the internal transport, expressed through the shared transport
 * interface so the dispatcher has ONE code path for every channel.
 *
 * Behaviour is unchanged from Milestone-5A: it creates a work item and records
 * `confirmed`, which is correct precisely because the platform completed the
 * write itself. An external transport cannot claim that.
 */
export const internalTransport: OutreachTransport = {
  channel: INTERNAL_CHANNEL,
  provider: 'internal_work_item',
  external: false,

  async send(request: TransportRequest): Promise<TransportResult> {
    const startedMs = Date.now();
    const res = await dispatchInternalTask(request.task, request.attemptId);
    const latencyMs = Math.max(0, Date.now() - startedMs);

    if (!res.ok) {
      return {
        outcome: 'transport_error',
        provider: 'internal_work_item',
        providerMessageId: null,
        deliveryStatus: 'failed',
        response: { reason: 'internal_transport_error' },
        duplicate: false,
        error: res.error,
        latencyMs,
      };
    }
    return {
      outcome: 'accepted',
      provider: 'internal_work_item',
      providerMessageId: res.workItemId,
      // `confirmed`, not `sent_unverified`: this is a platform-confirmed write.
      deliveryStatus: 'confirmed',
      response: { transport: 'internal_work_item', workItemId: res.workItemId, duplicate: res.duplicate },
      duplicate: res.duplicate,
      latencyMs,
    };
  },
};

/** Work items for a task. Company-scoped. */
export async function listInternalWorkItems(companyId: string, taskId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await ownedDbTable(OUTREACH_INTERNAL_WORK_ITEMS_TABLE)
      .select('*')
      .eq('company_id', companyId)
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    return res.error || !Array.isArray(res.data) ? [] : (res.data as Array<Record<string, unknown>>);
  } catch {
    return [];
  }
}
