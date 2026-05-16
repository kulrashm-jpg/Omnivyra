jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  heartbeatBillingOperation,
  heartbeatJobRegistry,
  withHeartbeat,
  _resetHeartbeatStateForTests,
} from '../../services/billing/idempotency/heartbeatService';

type AnyMock = jest.Mock;

describe('heartbeatService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetHeartbeatStateForTests();
  });

  it('heartbeatBillingOperation reads existing metadata + merges last_heartbeat_at', async () => {
    const updateMock = jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { metadata: { foo: 'bar' } }, error: null }),
        }),
      }),
      update: updateMock,
    });
    await heartbeatBillingOperation('op-1');
    expect(updateMock).toHaveBeenCalled();
    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload.metadata.foo).toBe('bar');
    expect(typeof updatePayload.metadata.last_heartbeat_at).toBe('string');
  });

  it('heartbeatBillingOperation is throttled (same id within 30s)', async () => {
    const updateMock = jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { metadata: {} }, error: null }) }) }),
      update: updateMock,
    });
    await heartbeatBillingOperation('op-1');
    await heartbeatBillingOperation('op-1');
    await heartbeatBillingOperation('op-1');
    // Throttle window is 30s; only the first call should update.
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('heartbeatJobRegistry directly updates last_seen_at', async () => {
    const updateMock = jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    (supabase.from as AnyMock).mockReturnValue({ update: updateMock });
    await heartbeatJobRegistry('exec-hash-abc');
    expect(updateMock).toHaveBeenCalled();
    expect(typeof updateMock.mock.calls[0][0].last_seen_at).toBe('string');
  });

  it('withHeartbeat resolves the body and cleans up the interval', async () => {
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { metadata: {} }, error: null }) }) }),
      update: jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) }),
    });

    const result = await withHeartbeat({
      operationId:    'op-2',
      intervalMs:     1000,
      body: async () => 42,
    });
    expect(result).toBe(42);
  });

  it('withHeartbeat propagates body errors AND still cleans up', async () => {
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { metadata: {} }, error: null }) }) }),
      update: jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) }),
    });

    await expect(
      withHeartbeat({ operationId: 'op-3', body: async () => { throw new Error('boom'); } })
    ).rejects.toThrow('boom');
  });
});
