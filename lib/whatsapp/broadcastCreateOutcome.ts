/**
 * What the operator is told after "create and send" (POST /api/whatsapp/broadcasts with
 * enqueue: true). The route answers 2xx whenever the broadcast ROW was created, including
 * when nothing was queued, so a 2xx alone must never read as "sending" (e9 / 05, the
 * partial-enqueue response contract):
 *   - enqueued: true, not partial  -> null: the list shows it running; no message.
 *   - partial: true                -> warning: some batches are queued and WILL send; the rest
 *                                     were not; if `uncertain`, a batch may or may not be queued.
 *   - enqueued: false              -> error: saved, NOT queued, nothing sent, with the reason.
 */
export interface BroadcastCreateResponse {
  broadcast_id?: string;
  inserted?: number;
  skipped?: number;
  enqueued?: boolean;
  partial?: boolean;
  uncertain?: boolean;
  batches?: number;
  enqueue_error?: string;
}

export interface BroadcastCreateOutcome {
  tone: 'warning' | 'error';
  message: string;
}

export function describeBroadcastCreateOutcome(data: BroadcastCreateResponse): BroadcastCreateOutcome | null {
  if (data.partial === true) {
    const queued = typeof data.batches === 'number' ? `${data.batches} batch${data.batches === 1 ? '' : 'es'}` : 'some batches';
    return {
      tone: 'warning',
      message: `Broadcast created, but only partly queued: ${queued} will send; the remaining recipients were not queued.`
        + (data.uncertain ? ' Whether one batch was queued could not be confirmed - review before resending.' : '')
        + (data.enqueue_error ? ` (${data.enqueue_error})` : ''),
    };
  }
  if (data.enqueued === true) return null;
  if ((data.inserted ?? 0) === 0) {
    return { tone: 'error', message: 'Broadcast saved, but no valid recipients were added, so nothing was queued or sent.' };
  }
  return {
    tone: 'error',
    message: `Broadcast saved as a draft but NOT queued - nothing was sent. ${data.enqueue_error ?? 'No recipient could be queued.'}`,
  };
}
