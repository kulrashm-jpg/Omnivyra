import {
  incrCounter,
  getCounter,
  snapshotBillingMetrics,
  _resetBillingMetricsForTests,
} from '../../services/billing/billingMetrics';

describe('billingMetrics', () => {
  beforeEach(() => _resetBillingMetricsForTests());

  it('increments named counters', () => {
    incrCounter('billing_operations_total');
    incrCounter('billing_operations_total');
    expect(getCounter('billing_operations_total')).toBe(2);
  });

  it('snapshots return a stable shape including all known counters', () => {
    incrCounter('approval_rejections_total', 3);
    const snap = snapshotBillingMetrics();
    expect(snap.approval_rejections_total).toBe(3);
    expect(snap.billing_operations_total).toBe(0);
    expect(typeof snap.queue_replay_blocked_total).toBe('number');
  });
});
