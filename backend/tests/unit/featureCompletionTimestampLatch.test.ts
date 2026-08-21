/**
 * Phase 9 — a completion timestamp is a historical fact, not a sync artefact.
 *
 * resolveLatchedFeatureState retains the prior row only on a STRICTLY higher
 * prior score. An already-completed feature recomputes to the SAME score on
 * every sync, so `retained` was false and the fall-through branch minted a
 * fresh `new Date()` — overwriting the moment the company actually earned the
 * feature, on every single Command Center load.
 *
 * Production showed the symptom directly: five independently-earned features
 * (blog_created, campaign_created, campaign_published, api_configured,
 * social_accounts_connected) all carrying the identical timestamp
 * 2026-08-20T20:00:28.394Z — the instant of the most recent sync.
 *
 * SCORE semantics are untouched. Only the timestamp retention boundary moves.
 */
import { resolveLatchedFeatureState } from '../../services/featureCompletionSyncService';

const EARNED = new Date('2026-03-01T09:15:00.000Z');
const NOW = new Date('2026-08-20T20:00:28.394Z');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterAll(() => {
  jest.useRealTimers();
});

const completed = (score = 1, completedAt: Date | string | null = EARNED) => ({
  status: 'completed',
  score,
  completedAt,
});

describe('Phase 9 — A/B: no prior row', () => {
  it('A — no prior + incomplete carries no completion timestamp', () => {
    const r = resolveLatchedFeatureState(null, { status: 'not_started', score: 0 });
    expect(r.status).toBe('not_started');
    expect(r.completedAt).toBeNull();
    expect(r.retained).toBe(false);
  });

  it('B — no prior + newly completed stamps the current completion time', () => {
    const r = resolveLatchedFeatureState(undefined, { status: 'completed', score: 1 });
    expect(r.status).toBe('completed');
    expect(r.completedAt).toEqual(NOW);
  });
});

describe('Phase 9 — C/D: prior incomplete', () => {
  it('C — prior incomplete staying incomplete is unchanged', () => {
    const prior = { status: 'in_progress', score: 0.5, completedAt: null };
    const r = resolveLatchedFeatureState(prior, { status: 'in_progress', score: 0.5 });
    expect(r.status).toBe('in_progress');
    expect(r.score).toBe(0.5);
    expect(r.completedAt).toBeNull();
  });

  it('D — prior incomplete becoming completed gets a NEW timestamp', () => {
    const prior = { status: 'in_progress', score: 0.6666666666666666, completedAt: null };
    const r = resolveLatchedFeatureState(prior, { status: 'completed', score: 1 });
    expect(r.status).toBe('completed');
    expect(r.completedAt).toEqual(NOW);
  });

  it('D2 — a stale completedAt on a non-completed prior is not resurrected', () => {
    const prior = { status: 'in_progress', score: 0.5, completedAt: EARNED };
    const r = resolveLatchedFeatureState(prior, { status: 'completed', score: 1 });
    expect(r.completedAt).toEqual(NOW);
  });
});

describe('Phase 9 — E/G: prior completed, timestamp preserved', () => {
  it('E — CRITICAL: same score preserves the EXACT prior timestamp', () => {
    const r = resolveLatchedFeatureState(completed(1), { status: 'completed', score: 1 });
    expect(r.status).toBe('completed');
    expect(r.score).toBe(1);
    expect(r.completedAt).toBe(EARNED);
    expect(r.completedAt).not.toEqual(NOW);
    expect(r.retained).toBe(false); // score was NOT retained — only the timestamp
  });

  it('G — a higher recomputed score still preserves the original timestamp', () => {
    const r = resolveLatchedFeatureState(completed(0.5), { status: 'completed', score: 1 });
    expect(r.score).toBe(1);
    expect(r.completedAt).toBe(EARNED);
  });

  it('7 — repeated syncs never move the timestamp', () => {
    let state = completed(1);
    for (let i = 0; i < 5; i += 1) {
      const r = resolveLatchedFeatureState(state, { status: 'completed', score: 1 });
      expect(r.completedAt).toBe(EARNED);
      state = { status: r.status, score: r.score, completedAt: r.completedAt as Date };
    }
  });

  it('an ISO string timestamp is preserved byte-for-byte', () => {
    const iso = '2026-03-01T09:15:00.000Z';
    const r = resolveLatchedFeatureState(completed(1, iso), { status: 'completed', score: 1 });
    expect(r.completedAt).toBe(iso);
  });

  it('MUTATION GUARD: reverting to strict-greater re-stamping fails here', () => {
    // Under the old logic prior.score > computed.score is false for 1 > 1, so
    // this branch minted new Date(). Asserting on NOW inequality is what fails
    // the moment the equality handling is reverted.
    const r = resolveLatchedFeatureState(completed(1), { status: 'completed', score: 1 });
    expect(r.completedAt).not.toEqual(NOW);
    expect(r.completedAt).toEqual(EARNED);
  });
});

describe('Phase 9 — F: monotonic score latch is unchanged', () => {
  it('F — a lower recompute retains prior score, status AND timestamp', () => {
    const r = resolveLatchedFeatureState(completed(1), { status: 'not_started', score: 0 });
    expect(r.status).toBe('completed');
    expect(r.score).toBe(1);
    expect(r.completedAt).toBe(EARNED);
    expect(r.retained).toBe(true);
  });

  it('F2 — a tiered feature keeps its highest tier', () => {
    const prior = { status: 'in_progress', score: 0.75, completedAt: null };
    const r = resolveLatchedFeatureState(prior, { status: 'in_progress', score: 0.25 });
    expect(r.score).toBe(0.75);
    expect(r.retained).toBe(true);
  });

  it('MUTATION GUARD: score retention still requires STRICTLY higher prior', () => {
    // Equal score must NOT report retained — that flag drives the "(retained —
    // previously achieved)" reason string and the latched metadata flag.
    expect(resolveLatchedFeatureState(completed(1), { status: 'completed', score: 1 }).retained).toBe(false);
    expect(resolveLatchedFeatureState(completed(1), { status: 'x', score: 0.9 }).retained).toBe(true);
  });

  it('H — a degenerate completed prior resolving to not-completed carries no timestamp', () => {
    // Documented, deliberate: a non-completed row must not carry completed_at.
    const r = resolveLatchedFeatureState(completed(0), { status: 'not_started', score: 0 });
    expect(r.status).toBe('not_started');
    expect(r.completedAt).toBeNull();
  });
});

describe('Phase 9 — 6: incomplete features never receive a timestamp', () => {
  it.each([
    ['not_started', 0],
    ['in_progress', 0.5],
  ])('%s stays without completedAt', (status, score) => {
    const r = resolveLatchedFeatureState(null, { status, score: score as number });
    expect(r.completedAt).toBeNull();
  });
});
