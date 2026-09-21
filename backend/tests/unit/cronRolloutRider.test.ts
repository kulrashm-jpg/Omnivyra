/**
 * 3AH-170 — cron rollout rider classifier (scripts/operator/cron-rollout-rider.cjs).
 *
 * The rider answers one question about a Railway rollout: after the outgoing,
 * FIXED worker ZREMs itself, does its identity stay/reappear in the registry?
 *
 *   predecessor reported AFTER Stopping Container + removed=1 → FAILURE
 *   attributable read after removal, in window, without it    → DECISIVE PASS
 *   sightings before the removal (Railway overlap)            → NON-DECISIVE
 *   silence / broken evidence                                 → INCONCLUSIVE
 *
 * Pure fixtures only: no Railway, no Redis, no network.
 */
import fs from 'fs';
import path from 'path';

const rider = require('../../../scripts/operator/cron-rollout-rider.cjs');
const { classifyRollout, extractEvidence, parseRailwayJsonLines, VERDICT } = rider;

type Line = { timestamp: string; message: string };
const railway = (lines: Line[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const at = (base: string, deltaMs: number) => new Date(Date.parse(base) + deltaMs).toISOString();

const OUT_ID = 'old-host:1';
const INC_ID = 'new-host:1';
const T_START = '2026-09-21T10:00:00.000Z';
const T_STOP = at(T_START, 6_000);
const T_DEREG = at(T_START, 9_000);
const MIN = 60_000;

const dupLine = (ids: string, self = INC_ID, heartbeat = false) =>
  `[cron] ⚠️  DUPLICATE INSTANCES DETECTED: ${ids} (this instance: ${self})${heartbeat ? ' [source=heartbeat]' : ''}`;

/** A fixed outgoing worker that shut down cleanly at T_STOP / T_DEREG. */
const outgoing = (over: Partial<{ removed: string; stop: boolean; dereg: boolean }> = {}): Line[] => [
  { timestamp: at(T_START, -30 * MIN), message: `[cron] instance=${OUT_ID} cycle=abc jobs=0 useful=false duration=500ms` },
  ...(over.stop === false ? [] : [{ timestamp: T_STOP, message: 'Stopping Container' }]),
  { timestamp: at(T_START, 8_000), message: ' Received SIGTERM. Shutting down cron...' },
  ...(over.dereg === false ? [] : [{
    timestamp: T_DEREG,
    message: `[cron] instance ${OUT_ID} deregistered (graceful shutdown, removed=${over.removed ?? '1'})`,
  }]),
];

/** An incoming worker that booted at T_START and ran its first cycle during the overlap. */
const incoming = (extra: Line[] = [], endDeltaMs = 20 * MIN): Line[] => [
  { timestamp: T_START, message: 'Starting Container' },
  { timestamp: at(T_START, 1_500), message: `[cron] instance=${INC_ID} cycle=def jobs=0 useful=false duration=500ms` },
  ...extra,
  { timestamp: at(T_START, endDeltaMs), message: 'redis_metrics_flush' },
];

const classify = (out: Line[], inc: Line[], outgoingFixed = true) =>
  classifyRollout(extractEvidence(parseRailwayJsonLines(railway(out)), parseRailwayJsonLines(railway(inc)), { outgoingFixed }));

describe('3AH-170 — cron rollout rider', () => {
  it('1. a cycle duplicate BEFORE the predecessor stopped → NON-DECISIVE overlap', () => {
    const r = classify(outgoing(), incoming([{ timestamp: at(T_START, 2_000), message: dupLine(OUT_ID) }]));
    expect(r.verdict).toBe(VERDICT.OVERLAP);
  });

  it('2. predecessor still reported by a HEARTBEAT after removed=1 → FAILURE (stale identity survived)', () => {
    const r = classify(outgoing(), incoming([
      { timestamp: at(T_START, 2_000), message: dupLine(OUT_ID) },
      { timestamp: at(T_START, 5 * MIN), message: dupLine(OUT_ID, INC_ID, true) },
    ]));
    expect(r.verdict).toBe(VERDICT.FAIL);
    expect(r.why.join(' ')).toContain('source=heartbeat');
  });

  it('2b. an attributable post-removal read WITHOUT the predecessor → DECISIVE PASS', () => {
    // A heartbeat line naming only an unrelated live peer proves the read happened.
    const viaHeartbeat = classify(outgoing(), incoming([
      { timestamp: at(T_START, 2_000), message: dupLine(OUT_ID) },
      { timestamp: at(T_START, 5 * MIN), message: dupLine('other-live:1', INC_ID, true) },
    ]));
    expect(viaHeartbeat.verdict).toBe(VERDICT.PASS);
    // So does a cycle line whose duplicate line would have followed within the logged tail.
    const viaCycle = classify(outgoing(), incoming([
      { timestamp: at(T_START, 10 * MIN), message: `[cron] instance=${INC_ID} cycle=ghi jobs=0 useful=false duration=500ms` },
    ]));
    expect(viaCycle.verdict).toBe(VERDICT.PASS);
  });

  it('3. a heartbeat duplicate BEFORE the logged removal → NON-DECISIVE', () => {
    const beforeStop = classify(outgoing(), incoming([{ timestamp: at(T_START, 3_000), message: dupLine(OUT_ID, INC_ID, true) }]));
    expect(beforeStop.verdict).toBe(VERDICT.OVERLAP);
    const betweenStopAndRemoval = classify(outgoing(), incoming([{ timestamp: at(T_START, 7_000), message: dupLine(OUT_ID, INC_ID, true) }]));
    expect(betweenStopAndRemoval.verdict).toBe(VERDICT.OVERLAP);
  });

  it('4. no duplicate at all, even with heartbeats due in the window → never a false PASS', () => {
    // Heartbeats fire every 5 min but are SILENT when clean, so nothing here is an observed read.
    const r = classify(outgoing(), incoming([], 20 * MIN));
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(r.why.join(' ')).toMatch(/silent heartbeat proves nothing/);
  });

  it('5. multiple identities: the predecessor among others → FAILURE; only others → PASS', () => {
    const withPredecessor = classify(outgoing(), incoming([
      { timestamp: at(T_START, 5 * MIN), message: dupLine(`other-live:1, ${OUT_ID}`, INC_ID, true) },
    ]));
    expect(withPredecessor.verdict).toBe(VERDICT.FAIL);
    const othersOnly = classify(outgoing(), incoming([
      { timestamp: at(T_START, 5 * MIN), message: dupLine('other-a:1, other-b:1', INC_ID, true) },
    ]));
    expect(othersOnly.verdict).toBe(VERDICT.PASS);
  });

  it('6. close ordering: equal-to-removal is not "after"; the window edge is inclusive', () => {
    const removal = at(T_START, 9_000); // max(stop, dereg) = dereg here
    expect(classify(outgoing(), incoming([{ timestamp: removal, message: dupLine(OUT_ID, INC_ID, true) }])).verdict).toBe(VERDICT.OVERLAP);
    expect(classify(outgoing(), incoming([{ timestamp: at(removal, 1), message: dupLine(OUT_ID, INC_ID, true) }])).verdict).toBe(VERDICT.FAIL);
    const edge = at(removal, 15 * MIN - 60_000);
    expect(classify(outgoing(), incoming([{ timestamp: edge, message: dupLine('other:1', INC_ID, true) }], 30 * MIN)).verdict).toBe(VERDICT.PASS);
    expect(classify(outgoing(), incoming([{ timestamp: at(edge, 1), message: dupLine('other:1', INC_ID, true) }], 30 * MIN)).verdict).toBe(VERDICT.INCONCLUSIVE);
  });

  it('6b. removed=1 logged BEFORE Stopping Container (flushed app lines, as in 3AH-162): a sighting between them is not a failure', () => {
    // App timestamps are upper bounds, so a sighting logged between the two
    // cannot be ordered against the true ZREM — removal counts from the later of both.
    const deregFirst: Line[] = [
      { timestamp: at(T_START, 8_000), message: ' Received SIGTERM. Shutting down cron...' },
      { timestamp: at(T_START, 8_100), message: `[cron] instance ${OUT_ID} deregistered (graceful shutdown, removed=1)` },
      { timestamp: at(T_START, 8_400), message: 'Stopping Container' },
    ];
    const r = classify(deregFirst, incoming([{ timestamp: at(T_START, 8_250), message: dupLine(OUT_ID, INC_ID, true) }]));
    expect(r.verdict).toBe(VERDICT.OVERLAP);
  });

  it('7. duplicate lines emitted by a DIFFERENT worker are not attributed to the incoming one', () => {
    const r = classify(outgoing(), incoming([
      { timestamp: at(T_START, 5 * MIN), message: dupLine(OUT_ID, 'third-host:1', true) },
    ]));
    expect(r.verdict).toBe(VERDICT.INCONCLUSIVE);
  });

  it('8. malformed or incomplete evidence → INCONCLUSIVE', () => {
    expect(classify(outgoing({ stop: false }), incoming()).verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(classify(outgoing({ dereg: false }), incoming()).verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(classify(outgoing({ removed: '0' }), incoming()).verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(classify([], []).verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(classifyRollout(null).verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(parseRailwayJsonLines('garbage\n{not json\n{"timestamp":"nope","message":"x"}')).toEqual([]);
    // A cycle line at the very end of the fetched log: its duplicate line may not be fetched yet.
    const truncated = incoming([{ timestamp: at(T_START, 10 * MIN), message: `[cron] instance=${INC_ID} cycle=late jobs=0 useful=false duration=1ms` }], 10 * MIN + 5_000);
    expect(classify(outgoing(), truncated).verdict).toBe(VERDICT.INCONCLUSIVE);
  });

  it('   an unfixed outgoing worker is never decisive', () => {
    const r = classify(outgoing(), incoming([{ timestamp: at(T_START, 5 * MIN), message: dupLine(OUT_ID, INC_ID, true) }]), false);
    expect(r.verdict).toBe(VERDICT.NOT_FIXED);
  });

  it('   the rider parses exactly the line cronInstrumentation.ts emits', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../utils/cronInstrumentation.ts'), 'utf8');
    expect(src).toContain('`(this instance: ${this.instanceId}) [source=heartbeat]`');
    expect(src).toContain('`[cron] ⚠️  DUPLICATE INSTANCES DETECTED: ${dupeIds.join(\', \')} `');
    const [e] = extractEvidence([], parseRailwayJsonLines(railway([{ timestamp: T_START, message: dupLine('a:1, b:1', INC_ID, true) }])), { outgoingFixed: true }).incoming.events;
    expect(e).toMatchObject({ kind: 'duplicate', source: 'heartbeat', ids: ['a:1', 'b:1'], thisInstance: INC_ID });
  });
});

// ── Real rollouts (verbatim Railway lines, trimmed to the relevant events) ─────

/** 3AH-162: outgoing 2e2a0e88 @ 3ed2234e (UNFIXED) → incoming 2bf891f2 @ ed961483. */
const R162_OUT: Line[] = [
  { timestamp: '2026-09-21T04:39:44.477715726Z', message: '[cron] instance=965eb46f5a13:1 cycle=muarajnb-5xxo jobs=1 useful=true duration=575ms fired=[leadThreadQueueCleanup]' },
  { timestamp: '2026-09-21T04:47:31.032188352Z', message: ' Received SIGTERM. Shutting down cron...' },
  { timestamp: '2026-09-21T04:47:31.032197600Z', message: '[cron] instance 965eb46f5a13:1 deregistered (graceful shutdown, removed=1)' },
  { timestamp: '2026-09-21T04:47:31.130924647Z', message: 'Stopping Container' },
];
const R162_INC: Line[] = [
  { timestamp: '2026-09-21T04:47:24.700899406Z', message: 'Starting Container' },
  { timestamp: '2026-09-21T04:47:26.947587983Z', message: '[cron] instance=fda92baa2f0b:1 cycle=muarkgnn-jo1j jobs=0 useful=false duration=655ms' },
  { timestamp: '2026-09-21T04:47:27.133472346Z', message: '[cron] ⚠️  DUPLICATE INSTANCES DETECTED: 965eb46f5a13:1 (this instance: fda92baa2f0b:1)' },
  { timestamp: '2026-09-21T05:17:29.064785350Z', message: '[cron] instance=fda92baa2f0b:1 cycle=muasn356-e8co jobs=1 useful=true duration=671ms fired=[leadThreadQueueCleanup]' },
  { timestamp: '2026-09-21T05:47:32.065565264Z', message: '[cron] instance=fda92baa2f0b:1 cycle=muatpnue-q6h6 jobs=1 useful=true duration=529ms fired=[leadThreadQueueCleanup]' },
  { timestamp: '2026-09-21T06:17:34.585975750Z', message: '[cron] instance=fda92baa2f0b:1 cycle=muaus8qu-0ybg jobs=1 useful=true duration=903ms fired=[leadThreadQueueCleanup]' },
  { timestamp: '2026-09-21T06:17:36.811533181Z', message: '(last fetched line)' },
];

/**
 * 3AH-168: outgoing 2bf891f2 @ ed961483 (FIXED) → incoming 1a5a7040 @ 326c5c0b.
 * Incoming lines are verbatim. The outgoing shutdown lines were not saved raw;
 * they are rebuilt from that run's recorded rider output (exact timestamps,
 * identity and removed=1) in the verbatim message formats above.
 */
const R168_OUT: Line[] = [
  { timestamp: '2026-09-21T07:56:50.790128301Z', message: 'Stopping Container' },
  { timestamp: '2026-09-21T07:56:59.926165764Z', message: ' Received SIGTERM. Shutting down cron...' },
  { timestamp: '2026-09-21T07:56:59.926169704Z', message: '[cron] instance fda92baa2f0b:1 deregistered (graceful shutdown, removed=1)' },
];
const R168_INC: Line[] = [
  { timestamp: '2026-09-21T07:56:45.027039093Z', message: 'Starting Container' },
  { timestamp: '2026-09-21T07:56:46.676124008Z', message: '[cron] instance=9b41a3f91501:1 cycle=muaybxyj-wg2d jobs=0 useful=false duration=551ms' },
  { timestamp: '2026-09-21T07:56:47.074353673Z', message: '[cron] ⚠️  DUPLICATE INSTANCES DETECTED: fda92baa2f0b:1 (this instance: 9b41a3f91501:1)' },
  { timestamp: '2026-09-21T08:24:48.909292054Z', message: '(last fetched line)' },
];

describe('3AH-170 — real rollouts keep their established classification', () => {
  it('9. 3AH-162 (outgoing 3ed2234e, unfixed) → NON-DECISIVE; overlap even if it had been fixed', () => {
    expect(classify(R162_OUT, R162_INC, false).verdict).toBe(VERDICT.NOT_FIXED);
    // Its later cycles (05:17, 05:47) fall OUTSIDE the 15-min window and must not count as a clean read.
    expect(classify(R162_OUT, R162_INC, true).verdict).toBe(VERDICT.OVERLAP);
  });

  it('10. 3AH-168 (outgoing ed961483, fixed) → NON-DECISIVE overlap', () => {
    const r = classify(R168_OUT, R168_INC, true);
    expect(r.verdict).toBe(VERDICT.OVERLAP);
    expect(r.why.join(' ')).toContain('2026-09-21T07:56:47.074353673Z');
  });
});
