/**
 * The operator is never told a broadcast is sending when it was not queued, and always has
 * an action for recipients that nothing else will queue (e9 / 05). The create route answers
 * 2xx whenever the broadcast row exists, so these cases are the contract the page relies on.
 */
import {
  broadcastActions,
  describeBroadcastCreateOutcome,
  partialEnqueueMessage,
} from '../../../lib/whatsapp/broadcastCreateOutcome';

describe('describeBroadcastCreateOutcome', () => {
  it('fully queued (201, enqueued:true): no message - the list shows it running', () => {
    expect(describeBroadcastCreateOutcome({ inserted: 3, enqueued: true, batches: 1 })).toBeNull();
  });

  it('partially queued (202, partial:true): a WARNING that names the action - Resume - for the rest', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 30, enqueued: true, partial: true, uncertain: false, batches: 2 });
    expect(o?.tone).toBe('warning');
    expect(o?.message).toContain('2 batches will send');
    expect(o?.message).toContain('will not be sent until you Resume');
    expect(o?.message).not.toContain('could not be confirmed');
  });

  it('partial AND uncertain: says a batch may or may not be queued, check before resuming', () => {
    const m = partialEnqueueMessage({ partial: true, uncertain: true, batches: 1 });
    expect(m).toContain('1 batch will send');
    expect(m).toContain('check the broadcast before resuming');
  });

  it('the enqueue FAILED (202, enqueued:false + reason): error, nothing sent, the reason, try again', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 3, enqueued: false, enqueue_error: 'Rate limit exceeded' });
    expect(o?.tone).toBe('error');
    expect(o?.message).toContain('NOT queued - nothing was sent. Rate limit exceeded');
    expect(o?.message).toContain('try again');
  });

  it('every recipient screened out (201, enqueued:false, batches:0): an error, not success', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 2, enqueued: false, batches: 0 });
    expect(o?.tone).toBe('error');
    expect(o?.message).toContain('nothing was sent');
  });

  it('no valid recipients (inserted:0): an error', () => {
    expect(describeBroadcastCreateOutcome({ inserted: 0, enqueued: false })?.tone).toBe('error');
  });

  it('`enqueued` MISSING: an error that says the server did not confirm - check, do not retry blind (05)', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 2 });
    expect(o?.tone).toBe('error');
    expect(o?.message).toContain('did not confirm whether anything was queued');
    expect(o?.message).toContain('Check this broadcast');
    expect(o?.message).not.toContain('try again');
  });
});

describe('broadcastActions: an action exists wherever recipients are stranded', () => {
  it('a partial enqueue leaves the broadcast running with recipients not yet sent: Resume', () => {
    expect(broadcastActions({ status: 'running', open_count: 12, failed_count: 0, counts_refreshed_at: '2026-11-11T10:00:00Z' })).toEqual({ canRetry: false, canResume: true });
  });

  it('a paused broadcast (rate limit, failed governance re-read): Resume', () => {
    expect(broadcastActions({ status: 'paused', open_count: 5 }).canResume).toBe(true);
  });

  it('failed recipients on a COMPLETED broadcast (the server never writes "failed"): Retry', () => {
    expect(broadcastActions({ status: 'completed', failed_count: 3, open_count: 0 })).toEqual({ canRetry: true, canResume: false });
  });

  it('NEGATIVE CONTROL: running with nothing left to queue, nothing failed: no action', () => {
    expect(broadcastActions({ status: 'running', open_count: 0, failed_count: 0, counts_refreshed_at: '2026-11-11T10:00:00Z' })).toEqual({ canRetry: false, canResume: false });
  });

  it('running with counts NEVER computed (counts_refreshed_at NULL): open_count 0 is unknown, so Resume is offered (05)', () => {
    expect(broadcastActions({ status: 'running', open_count: 0, failed_count: 0, counts_refreshed_at: null }).canResume).toBe(true);
  });

  it('a draft offers neither (it has not started)', () => {
    expect(broadcastActions({ status: 'draft', failed_count: 2, open_count: 2 })).toEqual({ canRetry: false, canResume: false });
  });
});
