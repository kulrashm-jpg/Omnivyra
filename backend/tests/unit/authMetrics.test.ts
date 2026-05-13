/**
 * Pin counter semantics + cardinality cap behavior.
 */

import {
  incrementAuthMetric,
  snapshotAuthMetrics,
  resetAuthMetrics,
} from '../../services/authMetrics';

beforeEach(() => resetAuthMetrics());

describe('authMetrics', () => {
  it('groups increments by (name, tags) bucket', () => {
    incrementAuthMetric('auth.x', { code: 'INVALID_SESSION' });
    incrementAuthMetric('auth.x', { code: 'INVALID_SESSION' });
    incrementAuthMetric('auth.x', { code: 'USER_INVITED' });
    const snap = snapshotAuthMetrics();
    const byKey = new Map(snap.counters.map((c) => [`${c.name}|${c.tags.code}`, c.value]));
    expect(byKey.get('auth.x|INVALID_SESSION')).toBe(2);
    expect(byKey.get('auth.x|USER_INVITED')).toBe(1);
  });

  it('drops null/undefined tag values silently for stable cardinality', () => {
    incrementAuthMetric('auth.y', { code: null, ok: undefined });
    incrementAuthMetric('auth.y', {});
    const snap = snapshotAuthMetrics();
    expect(snap.counters).toHaveLength(1);
    expect(snap.counters[0].tags).toEqual({});
    expect(snap.counters[0].value).toBe(2);
  });

  it('caps total cardinality and reports the cap count', () => {
    // 1000 is the cap (see MAX_COUNTER_KEYS in source).
    for (let i = 0; i < 1_010; i++) {
      incrementAuthMetric('auth.z', { run: String(i) });
    }
    const snap = snapshotAuthMetrics();
    expect(snap.counters.length).toBeLessThanOrEqual(1_000);
    expect(snap.cardinalityCapped).toBeGreaterThanOrEqual(10);
  });
});
