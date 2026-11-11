/**
 * What the operator is told, and may do, about a WhatsApp broadcast's queueing (e9 / 05,
 * S's partial-enqueue response contract).
 *
 * Create (POST /api/whatsapp/broadcasts, enqueue: true) answers 2xx whenever the broadcast
 * ROW was created, including when nothing was queued, so a 2xx alone must never read as
 * "sending":
 *   - enqueued: true, not partial -> null: the list shows it running; no message.
 *   - partial: true               -> warning: some batches are queued and WILL send. The
 *                                    rest are NOT queued and stay that way until the operator
 *                                    resumes the broadcast, so the notice says so.
 *   - enqueued: false + a reason  -> error: the enqueue FAILED; nothing was sent; try again.
 *   - `enqueued` missing          -> error: the server did not SAY whether anything was queued
 *                                    (version skew, or a body rewritten in transit; the field
 *                                    is set on every path of the current route). The action
 *                                    differs: check the broadcast's state before acting, not
 *                                    retry blind (05). Absence of a denial is not confirmation.
 */
export interface BroadcastEnqueueResponse {
  broadcast_id?: string;
  inserted?: number;
  skipped?: number;
  enqueued?: boolean;
  partial?: boolean;
  uncertain?: boolean;
  batches?: number;
  enqueue_error?: string;
  error?: string;
}

export interface BroadcastEnqueueOutcome {
  tone: 'warning' | 'error';
  message: string;
}

/** A partial run: shared by create and resume. */
export function partialEnqueueMessage(data: BroadcastEnqueueResponse): string {
  const queued = typeof data.batches === 'number' ? `${data.batches} batch${data.batches === 1 ? '' : 'es'}` : 'some batches';
  return `Only partly queued: ${queued} will send. The remaining recipients are NOT queued and will not be sent until you Resume this broadcast.`
    + (data.uncertain ? ' Whether one batch was queued could not be confirmed - check the broadcast before resuming.' : '');
}

export function describeBroadcastCreateOutcome(data: BroadcastEnqueueResponse): BroadcastEnqueueOutcome | null {
  if (data.partial === true) return { tone: 'warning', message: partialEnqueueMessage(data) };
  if (data.enqueued === true) return null;
  if (typeof data.enqueued !== 'boolean') {
    return {
      tone: 'error',
      message: 'Broadcast saved, but the server did not confirm whether anything was queued. '
        + 'Check this broadcast\'s status in the list before resuming or retrying.',
    };
  }
  if ((data.inserted ?? 0) === 0) {
    return { tone: 'error', message: 'Broadcast saved, but no valid recipients were added, so nothing was queued or sent.' };
  }
  return {
    tone: 'error',
    message: `Broadcast saved as a draft but NOT queued - nothing was sent. ${data.enqueue_error ?? 'No recipient could be queued.'} You can try again with Resume.`,
  };
}

/** The broadcast fields the row actions depend on (the list GET selects every column). */
export interface BroadcastActionInput {
  status: string;
  failed_count?: number | null;
  open_count?: number | null;
}

/**
 * Which row actions the page offers. The server writes only draft, running, paused and
 * completed; it never writes 'failed' or 'partial', so actions keyed on those were
 * unreachable. The SERVER still decides: retry answers 409 when nothing is retryable, and
 * resume answers 409 while a batch of the broadcast is queued or active, and the page shows
 * that answer - offering an action is never a claim it will do anything.
 *   - Retry:  some recipients failed (failed_count > 0), on a broadcast that has started.
 *   - Resume: paused, OR running with recipients not yet sent (open_count > 0) - the case a
 *             partial enqueue leaves, whose remaining recipients nothing else queues.
 */
export function broadcastActions(b: BroadcastActionInput): { canRetry: boolean; canResume: boolean } {
  const started = b.status !== 'draft';
  return {
    canRetry: started && (b.failed_count ?? 0) > 0,
    canResume: b.status === 'paused' || (b.status === 'running' && (b.open_count ?? 0) > 0),
  };
}
