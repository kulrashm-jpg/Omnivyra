/**
 * GET /api/campaigns/:id/outcomes re-measures a snapshot older than 6 h (e9 ruling, 2026-11-12).
 *
 * Before the campaign_outcomes upsert was issued (voidWritesIssued), the store was always empty,
 * so GET always re-measured. Once snapshots persist, "return it if one exists" would freeze the
 * read-only admin dashboard on the first measurement. Now GET returns a snapshot only while it is
 * fresh.
 *
 * REAL: the route handler, OUTCOME_SNAPSHOT_MAX_AGE_MS and isOutcomeSnapshotFresh. Spied: the
 * snapshot read and the measurement (the route's I/O). Both sides of the boundary are pinned,
 * and the boundary itself (exactly 6 h is stale).
 */
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const CAMPAIGN = 'c1000000-0000-4000-8000-000000000001';
const COMPANY = 'c1000000-0000-4000-8000-0000000000aa';

const getOutcomeSnapshot = jest.fn();
const measureOutcomeScore = jest.fn();

jest.mock('../../services/outcomeTrackingService', () => {
  const actual = jest.requireActual('../../services/outcomeTrackingService');
  return {
    OUTCOME_SNAPSHOT_MAX_AGE_MS: actual.OUTCOME_SNAPSHOT_MAX_AGE_MS,
    isOutcomeSnapshotFresh: actual.isOutcomeSnapshotFresh,
    getOutcomeSnapshot: (...a: unknown[]) => getOutcomeSnapshot(...a),
    measureOutcomeScore: (...a: unknown[]) => measureOutcomeScore(...a),
  };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/authMiddleware', () => ({
  requireAuth: async () => ({ user: { id: 'u-1' } }),
  requireCompanyAccess: async () => true,
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => {
      if (t !== 'campaigns') throw new Error(`undeclared table ${t}`);
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { company_id: COMPANY }, error: null }) };
      return b;
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../../pages/api/campaigns/[id]/outcomes').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OUTCOME_SNAPSHOT_MAX_AGE_MS, isOutcomeSnapshotFresh } = jest.requireActual('../../services/outcomeTrackingService');

const snapshotAged = (ageMs: number) => ({ campaign_id: CAMPAIGN, company_id: COMPANY, outcome_score: 1, snapshot_at: new Date(NOW - ageMs).toISOString() });
const MEASURED = { campaign_id: CAMPAIGN, company_id: COMPANY, outcome_score: 2, snapshot_at: new Date(NOW).toISOString() };

const get = async () => {
  const res: { statusCode: number; body: unknown; status(n: number): typeof res; json(b: unknown): typeof res; end(): typeof res } = {
    statusCode: 0, body: undefined,
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  await handler({ method: 'GET', query: { id: CAMPAIGN }, headers: {} }, res);
  return res;
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  getOutcomeSnapshot.mockReset();
  measureOutcomeScore.mockReset().mockResolvedValue(MEASURED);
});
afterEach(() => jest.restoreAllMocks());

describe('GET outcomes: snapshot freshness', () => {
  it('the window is a named 6 h constant', () => {
    expect(OUTCOME_SNAPSHOT_MAX_AGE_MS).toBe(6 * HOUR);
  });

  it('FRESH (5h59m): returns the stored snapshot, does not re-measure', async () => {
    const snap = snapshotAged(6 * HOUR - 60_000);
    getOutcomeSnapshot.mockResolvedValue(snap);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(snap);
    expect(measureOutcomeScore).not.toHaveBeenCalled();
  });

  it('STALE (6h01m): re-measures and returns the new measurement', async () => {
    getOutcomeSnapshot.mockResolvedValue(snapshotAged(6 * HOUR + 60_000));
    const res = await get();
    expect(measureOutcomeScore).toHaveBeenCalledWith(CAMPAIGN, COMPANY);
    expect(res.body).toBe(MEASURED);
  });

  it('BOUNDARY: exactly 6 h is stale', async () => {
    getOutcomeSnapshot.mockResolvedValue(snapshotAged(6 * HOUR));
    await get();
    expect(measureOutcomeScore).toHaveBeenCalledTimes(1);
  });

  it('no snapshot: measures (unchanged behaviour)', async () => {
    getOutcomeSnapshot.mockResolvedValue(null);
    await get();
    expect(measureOutcomeScore).toHaveBeenCalledTimes(1);
  });

  it('an unparseable snapshot_at is stale, never "fresh forever"', async () => {
    getOutcomeSnapshot.mockResolvedValue({ ...snapshotAged(0), snapshot_at: 'not-a-date' });
    await get();
    expect(measureOutcomeScore).toHaveBeenCalledTimes(1);
    expect(isOutcomeSnapshotFresh({ snapshot_at: 'not-a-date' }, NOW)).toBe(false);
  });
});
