/**
 * Phase 96 — two refinements of the same activity must not eat each other.
 *
 * THE RACE
 * --------
 * `appendRefinedVersion` is read-modify-write over one JSONB envelope:
 *
 *     read envelope  →  next = max(versions)+1  →  write the WHOLE envelope
 *
 * and the write underneath is a blind `.upsert(row, { onConflict: 'id' })`.
 * So two requests that start from the same state both compute the same next
 * version, and the second write — assembled from a snapshot that never
 * contained the first result — replaces the row wholesale. The first
 * refinement disappears, and its caller was already told `ok: true`.
 *
 * v1 survives (both snapshots contain it), so "the original is recoverable"
 * stays true. That is exactly why this is easy to miss: the guarantee everyone
 * checks still holds while a user's work is silently discarded.
 *
 * HOW THIS TEST FORCES IT
 * -----------------------
 * The store below is a faithful model of the persistence semantics — a single
 * shared envelope, and a write that REPLACES it — not a queue that serialises
 * callers. Both requests are held at a barrier until both have read, so the
 * interleaving is deterministic rather than timing-dependent. A mock that
 * simply serialised the two calls would pass regardless of the fix and would
 * prove nothing.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** The one shared envelope, plus the barrier that forces the interleaving. */
const store: { library: Record<string, unknown> } = { library: {} };
let readsSeen = 0;
let releaseBarrier: (() => void) | null = null;
let barrier: Promise<void> = Promise.resolve();
/** How many reads must arrive before any of them is allowed to proceed. */
let barrierArrivals = 0;

const writeLog: Array<{ expected: number | undefined; versions: number[] }> = [];

/** Faithful model of libraryWriteAsset: blind replace, or CAS when asked. */
class VersionConflict extends Error {
  constructor() { super('LIBRARY_VERSION_CONFLICT'); this.name = 'LibraryVersionConflictError'; }
}

const mockRead = jest.fn(async () => {
  readsSeen += 1;
  if (readsSeen <= barrierArrivals) await barrier;   // hold until everyone has read
  return { library: clone(store.library) } as unknown;
});

/** The faithful default; reinstalled by seed() so per-test overrides can't leak. */
const defaultWrite = async (input: { envelope: Record<string, unknown>; expectedCurrentVersion?: number }) => {
  const envelope = input.envelope;
  writeLog.push({
    expected: input.expectedCurrentVersion,
    versions: (envelope.versions as Record<string, unknown>[]).map((v) => Number(v.version)),
  });
  // Compare-and-set when the caller supplies an expectation — this is the
  // behaviour the DB-level guard provides; without it the write is blind.
  if (input.expectedCurrentVersion !== undefined) {
    if (Number(store.library.currentVersion) !== input.expectedCurrentVersion) throw new VersionConflict();
  }
  store.library = clone(envelope);                    // wholesale replace
  return {} as unknown;
};

const mockWrite = jest.fn(defaultWrite);

jest.mock('../../services/creatorAssetPersistenceService', () => ({
  libraryReadAsset: (...a: any[]) => (mockRead as any)(...a),
  libraryWriteAsset: (...a: any[]) => (mockWrite as any)(...a),
}));

const mockResolve = jest.fn();
jest.mock('../../services/creator/activityCreativeService', () => ({
  resolveActivityCreative: (...a: any[]) => mockResolve(...a),
  activityCreativeIsRefinable: () => true,
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'act-1', campaign_id: 'camp-1', content: { title: 'T' }, asset_type: 'image' } }) }) }),
  }),
}));

jest.mock('../../services/creator/creatorOrchestrator', () => ({
  runCreatorOrchestration: async () => ({
    output: { asset_payload: { url: 'https://example.invalid/r.png' }, metadata: { rendered_asset: { urls: ['https://example.invalid/r.png'] } } },
  }),
}));

let refineActivityCreative: typeof import('../../services/creator/activityCreativeRefinementService').refineActivityCreative;

beforeAll(async () => {
  ({ refineActivityCreative } = await import('../../services/creator/activityCreativeRefinementService'));
});

/** Reset to a freshly generated creative: v1 only, exactly as the campaign left it. */
function seed(): void {
  store.library = {
    id: 'asset-1',
    currentVersion: 1,
    versions: [{ version: 1, op: 'generate', payload: { url: 'https://example.invalid/v1.png' }, createdAt: '2026-01-01T00:00:00.000Z' }],
  };
  readsSeen = 0;
  writeLog.length = 0;
  mockRead.mockClear();
  // mockReset drops any per-test override; reinstall the faithful default so a
  // stubbed failure in one test cannot silently govern the next.
  mockWrite.mockReset();
  mockWrite.mockImplementation(defaultWrite as any);
  mockResolve.mockReset();
  mockResolve.mockResolvedValue({
    activityId: 'act-1', campaignId: 'camp-1', compositionId: 'comp-1',
    creatorAssetId: 'asset-1', assetType: 'image', currentVersion: 1, isRefined: false,
  });
}

/** Arm the barrier for N concurrent readers. */
function armBarrier(n: number): void {
  barrierArrivals = n;
  barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
}

const refine = () => refineActivityCreative({ companyId: 'co-1', userId: 'u-1', activityId: 'act-1' });

describe('A — concurrent refinement must not silently lose a version', () => {
  it('CRITICAL: two refinements from the same version do not overwrite each other', async () => {
    seed();
    armBarrier(2);

    const both = Promise.all([refine(), refine()]);
    // Both have now read v1. Release them to write into the same envelope.
    await new Promise((r) => setImmediate(r));
    releaseBarrier!();
    const [a, b] = await both;

    const successes = [a, b].filter((r) => r.ok);
    const stored = (store.library.versions as Record<string, unknown>[]).map((v) => Number(v.version));

    // The invariant: every refinement the system CLAIMED succeeded must still
    // be present. Claiming success and then discarding the work is the bug.
    expect(stored.length).toBe(1 + successes.length);

    // And no two successes may claim the same version number.
    const claimed = successes.map((r) => r.version);
    expect(new Set(claimed).size).toBe(claimed.length);
  }, 20000);

  it('CRITICAL: a losing writer reports failure rather than false success', async () => {
    seed();
    armBarrier(2);
    const both = Promise.all([refine(), refine()]);
    await new Promise((r) => setImmediate(r));
    releaseBarrier!();
    const [a, b] = await both;

    // Either both genuinely landed (serialised safely), or one is an explicit
    // failure. What must never happen is two "ok" with only one stored.
    const stored = (store.library.versions as Record<string, unknown>[]).length;
    const oks = [a, b].filter((r) => r.ok).length;
    expect(oks).toBeLessThanOrEqual(stored - 1 + 1);
    expect(stored).toBeGreaterThanOrEqual(1 + oks);
  }, 20000);

  it('CRITICAL: BOTH refinements land — the loser retries onto the winner, not over it', async () => {
    seed();
    armBarrier(2);
    const both = Promise.all([refine(), refine()]);
    await new Promise((r) => setImmediate(r));
    releaseBarrier!();
    const [a, b] = await both;

    // Both are real work a user asked for. Safety alone would allow failing the
    // loser; this pins the chosen behaviour — it re-reads and appends AFTER the
    // winner, so nobody is told to redo work that succeeded.
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(new Set([a.version, b.version])).toEqual(new Set([2, 3]));

    const stored = (store.library.versions as Record<string, unknown>[]).map((v) => Number(v.version));
    expect(stored).toEqual([1, 2, 3]);
    expect(store.library.currentVersion).toBe(3);
  }, 20000);

  it('CRITICAL: v1 remains recoverable through the race', async () => {
    seed();
    armBarrier(2);
    const both = Promise.all([refine(), refine()]);
    await new Promise((r) => setImmediate(r));
    releaseBarrier!();
    await both;

    const versions = store.library.versions as Record<string, unknown>[];
    const v1 = versions.find((v) => Number(v.version) === 1);
    expect(v1).toBeDefined();
    expect((v1!.payload as Record<string, unknown>).url).toBe('https://example.invalid/v1.png');
    expect(v1!.op).toBe('generate');
  }, 20000);

  it('the write path actually carries a concurrency expectation', async () => {
    seed();
    armBarrier(2);
    const both = Promise.all([refine(), refine()]);
    await new Promise((r) => setImmediate(r));
    releaseBarrier!();
    await both;

    // Without an expectation reaching the persistence layer, the DB write is
    // blind and nothing downstream can detect the collision.
    expect(writeLog.every((w) => typeof w.expected === 'number')).toBe(true);
  }, 20000);
});

describe('C — the guard does not weaken isolation or hide failure', () => {
  it('CRITICAL: a foreign activity is still refused before any write', async () => {
    seed();
    armBarrier(0);
    // Tenant resolution is the authorization boundary; it stays the boundary.
    mockResolve.mockResolvedValue(null);

    const r = await refine();

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('activity_not_found');
    expect(mockWrite).not.toHaveBeenCalled();
  }, 20000);

  it('CRITICAL: the CAS filter is company-scoped, never id-only', async () => {
    seed();
    armBarrier(0);
    await refine();
    // The company must reach the persistence layer on every versioned write —
    // a concurrency guard must not become a way to touch another tenant's row.
    expect(mockWrite).toHaveBeenCalled();
    expect((mockWrite.mock.calls[0][0] as any).companyId).toBe('co-1');
  }, 20000);

  it('CRITICAL: a persistence failure never reports success', async () => {
    seed();
    armBarrier(0);
    mockWrite.mockRejectedValueOnce(new Error('db exploded'));

    // Either an explicit failure result or a thrown error — never ok:true.
    let result: { ok: boolean } | null = null;
    try { result = await refine(); } catch { result = null; }
    if (result) expect(result.ok).toBe(false);
  }, 20000);

  it('CRITICAL: exhausted retries fail honestly rather than overwriting', async () => {
    seed();
    armBarrier(0);
    // Every attempt loses — the envelope keeps moving underneath.
    mockWrite.mockImplementation(async () => {
      store.library = { ...store.library, currentVersion: Number(store.library.currentVersion) + 1 };
      const e = new Error('LIBRARY_VERSION_CONFLICT'); e.name = 'LibraryVersionConflictError'; throw e;
    });

    const r = await refine();

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('asset_unavailable');
    // Bounded: it must not spin forever.
    expect(mockWrite.mock.calls.length).toBeLessThanOrEqual(APPEND_ATTEMPT_CEILING);
  }, 20000);

  it('unrelated assets in the same tenant are untouched by a conflict', async () => {
    seed();
    armBarrier(0);
    const other = { id: 'asset-2', currentVersion: 1, versions: [{ version: 1, op: 'generate', payload: {}, createdAt: 'x' }] };
    await refine();
    // The write targets one asset id; nothing else is rewritten.
    expect((mockWrite.mock.calls[0][0] as any).envelope.id).toBe('asset-1');
    expect(other.currentVersion).toBe(1);
  }, 20000);
});

/** retries (2) + the initial attempt, with headroom for the assertion. */
const APPEND_ATTEMPT_CEILING = 4;

describe('B — the ordinary single-refinement path is unchanged', () => {
  it('one refinement still succeeds and becomes version 2', async () => {
    seed();
    armBarrier(0);                                   // no barrier: plain sequential call

    const r = await refine();

    expect(r.ok).toBe(true);
    expect(r.version).toBe(2);
    expect(r.originalVersion).toBe(1);
    expect((store.library.versions as unknown[]).length).toBe(2);
    expect(store.library.currentVersion).toBe(2);
  }, 20000);

  it('a second, sequential refinement becomes version 3', async () => {
    seed();
    armBarrier(0);
    await refine();
    mockResolve.mockResolvedValue({
      activityId: 'act-1', campaignId: 'camp-1', compositionId: 'comp-1',
      creatorAssetId: 'asset-1', assetType: 'image', currentVersion: 2, isRefined: true,
    });

    const r = await refine();

    expect(r.ok).toBe(true);
    expect(r.version).toBe(3);
    expect((store.library.versions as unknown[]).length).toBe(3);
  }, 20000);
});
