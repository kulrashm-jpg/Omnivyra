import { resolveLatchedFeatureState } from '../../services/featureCompletionSyncService';

describe('resolveLatchedFeatureState (once = forever)', () => {
  it('keeps a completed feature completed when the recompute drops to zero (deleted entity)', () => {
    const prior = { status: 'completed', score: 1, completedAt: '2026-01-01T00:00:00.000Z' };
    const computed = { status: 'not_started', score: 0 }; // campaign was deleted
    const result = resolveLatchedFeatureState(prior, computed);
    expect(result.status).toBe('completed');
    expect(result.score).toBe(1);
    expect(result.completedAt).toBe('2026-01-01T00:00:00.000Z'); // original date preserved
    expect(result.retained).toBe(true);
  });

  it('retains the highest tier reached for a partial/tiered feature', () => {
    const prior = { status: 'in_progress', score: 0.75, completedAt: null };
    const computed = { status: 'in_progress', score: 0.25 };
    const result = resolveLatchedFeatureState(prior, computed);
    expect(result.score).toBe(0.75);
    expect(result.retained).toBe(true);
  });

  it('upgrades when the fresh recompute is higher', () => {
    const prior = { status: 'in_progress', score: 0.5, completedAt: null };
    const computed = { status: 'completed', score: 1 };
    const result = resolveLatchedFeatureState(prior, computed);
    expect(result.status).toBe('completed');
    expect(result.score).toBe(1);
    expect(result.completedAt).toBeInstanceOf(Date); // freshly stamped on completion
    expect(result.retained).toBe(false);
  });

  it('uses the computed value when there is no prior record', () => {
    const result = resolveLatchedFeatureState(null, { status: 'completed', score: 1 });
    expect(result.status).toBe('completed');
    expect(result.retained).toBe(false);
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('does not stamp completed_at for a fresh not-started feature', () => {
    const result = resolveLatchedFeatureState(undefined, { status: 'not_started', score: 0 });
    expect(result.completedAt).toBeNull();
    expect(result.retained).toBe(false);
  });
});
