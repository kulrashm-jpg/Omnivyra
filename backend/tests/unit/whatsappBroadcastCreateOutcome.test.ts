/**
 * The operator is never told a broadcast is sending when it was not queued (e9 / 05).
 * The create route answers 2xx whenever the broadcast row exists, so these cases are the
 * whole contract the page relies on: full enqueue -> no message; partial -> warning;
 * nothing queued -> error naming the reason.
 */
import { describeBroadcastCreateOutcome } from '../../../lib/whatsapp/broadcastCreateOutcome';

describe('describeBroadcastCreateOutcome', () => {
  it('fully queued (201, enqueued:true): no message - the list shows it running', () => {
    expect(describeBroadcastCreateOutcome({ inserted: 3, enqueued: true, batches: 1 })).toBeNull();
  });

  it('partially queued (202, enqueued:true, partial:true): a WARNING, never silence', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 30, enqueued: true, partial: true, uncertain: false, batches: 2, enqueue_error: 'queue unavailable' });
    expect(o?.tone).toBe('warning');
    expect(o?.message).toContain('only partly queued');
    expect(o?.message).toContain('2 batches will send');
    expect(o?.message).not.toContain('could not be confirmed');
  });

  it('partial AND uncertain: says a batch may or may not be queued', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 30, enqueued: true, partial: true, uncertain: true, batches: 1 });
    expect(o?.tone).toBe('warning');
    expect(o?.message).toContain('1 batch will send');
    expect(o?.message).toContain('could not be confirmed');
  });

  it('nothing queued (202, enqueued:false): an ERROR that says nothing was sent, with the reason', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 3, enqueued: false, enqueue_error: 'Another enqueue or retry of this broadcast is in progress.' });
    expect(o).toEqual({ tone: 'error', message: expect.stringContaining('NOT queued - nothing was sent') });
    expect(o?.message).toContain('in progress');
  });

  it('every recipient screened out (201, enqueued:false, batches:0): an error, not success', () => {
    const o = describeBroadcastCreateOutcome({ inserted: 2, enqueued: false, batches: 0 });
    expect(o?.tone).toBe('error');
    expect(o?.message).toContain('nothing was sent');
  });

  it('no valid recipients (inserted:0): an error', () => {
    expect(describeBroadcastCreateOutcome({ inserted: 0, enqueued: false })?.tone).toBe('error');
  });

  it('a response without `enqueued` is NOT read as sending', () => {
    expect(describeBroadcastCreateOutcome({ inserted: 2 })?.tone).toBe('error');
  });
});
