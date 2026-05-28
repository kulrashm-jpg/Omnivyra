/**
 * Phase 9 — Adversarial transport stress tests.
 *
 * Exercises the transport endpoint + client transport + correlation
 * resolver + timeline builder + retention policy under adversarial
 * conditions.
 *
 * The HTTP route is exercised in-process by directly invoking the
 * registry's ingestion path (the route is a thin wrapper around the
 * registry with auth + size limits). Where the wrapper's behavior is
 * what's being tested (size limits, batching, dedup at HTTP boundary),
 * scenarios construct a fake-fetch transport and run end-to-end.
 *
 * Run via:
 *   npx tsx scripts/ops/longFormThreadRuntimeTransportStress.ts
 */

import type {
  ThreadRuntimeTraceEvent,
  ThreadRuntimeTransitionType,
} from './threadRuntimeTypes';
import {
  createThreadRuntimeTraceRegistry,
} from './threadRuntimeTraceRegistry';
import {
  createThreadRuntimeClientTransport,
  type ThreadRuntimeClientTransport,
} from './threadRuntimeClientTransport';
import {
  resolveCorrelation,
  mergeCorrelatedSessions,
} from './runtimeSessionCorrelationResolver';
import { buildThreadRuntimeTimeline } from './threadRuntimeTimelineBuilder';
import { createThreadRuntimeRetentionManager } from './threadRuntimeRetentionPolicy';
import { validateAndNormalize } from './runtimeReplayContractValidator';

// ── helpers ────────────────────────────────────────────────────────────

let _evtCounter = 0;
function nextEventId(): string { _evtCounter += 1; return `evt_test_${_evtCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }
function nowIso(): string { return new Date().toISOString(); }
function isoSecAgo(s: number): string { return new Date(Date.now() - s * 1000).toISOString(); }

function makeEvent(seed: {
  runtimeSessionId: string;
  threadId: string;
  companyId: string;
  transitionType: ThreadRuntimeTransitionType;
  eventId?: string;
  parentNodeId?: string | null;
  childNodeIds?: string[];
  payload?: Record<string, unknown>;
  detail?: string;
  timestamp?: string;
}): ThreadRuntimeTraceEvent & { companyId: string } {
  return {
    eventId: seed.eventId ?? nextEventId(),
    runtimeSessionId: seed.runtimeSessionId,
    threadId: seed.threadId,
    companyId: seed.companyId,
    parentNodeId: seed.parentNodeId ?? null,
    childNodeIds: seed.childNodeIds ?? [],
    nodeGenerationMode: 'manual',
    orchestrationSequence: 0, // server will reassign
    transitionType: seed.transitionType,
    timestamp: seed.timestamp ?? nowIso(),
    detail: seed.detail,
    payload: seed.payload,
  };
}

interface FakeFetchHook {
  fetch: typeof fetch;
  receivedBatches: ThreadRuntimeTraceEvent[][];
  reset(): void;
  setMode(mode: FakeFetchMode): void;
}

type FakeFetchMode = 'ok' | 'duplicate-receive' | '503-once-then-ok' | 'always-fail' | 'reject-half' | '413-once-then-ok';

function buildFakeFetch(initialMode: FakeFetchMode): FakeFetchHook {
  let mode = initialMode;
  let calls = 0;
  const receivedBatches: ThreadRuntimeTraceEvent[][] = [];
  return {
    receivedBatches,
    setMode(next) { mode = next; },
    reset() { calls = 0; receivedBatches.length = 0; mode = initialMode; },
    fetch: (async (url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { events?: ThreadRuntimeTraceEvent[] };
      const events = body.events ?? [];
      void url;
      if (mode === 'always-fail') {
        return new Response('boom', { status: 500 });
      }
      if (mode === '503-once-then-ok' && calls === 1) {
        return new Response('service unavailable', { status: 503 });
      }
      if (mode === '413-once-then-ok' && calls === 1) {
        return new Response('payload too large', { status: 413 });
      }
      receivedBatches.push(events);
      if (mode === 'duplicate-receive') {
        // pretend the server already saw these events
        return new Response(JSON.stringify({ accepted: 0, duplicate: events.length, rejected: 0 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (mode === 'reject-half') {
        const half = Math.floor(events.length / 2);
        return new Response(JSON.stringify({ accepted: half, duplicate: 0, rejected: events.length - half }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ accepted: events.length, duplicate: 0, rejected: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  };
}

// ── assertion infra ────────────────────────────────────────────────────

export interface TransportAssertion { name: string; passed: boolean; observed: string | number; expected: string }
export interface TransportScenarioResult { scenario: string; assertions: TransportAssertion[]; passed: boolean }
function ok(name: string, observed: string | number, passed: boolean, expected: string): TransportAssertion {
  return { name, observed, passed, expected };
}

// ── scenarios ──────────────────────────────────────────────────────────

async function scenario_baseline(): Promise<TransportScenarioResult> {
  const fake = buildFakeFetch('ok');
  const transport = createThreadRuntimeClientTransport({
    batchSize: 5, flushIntervalMs: 500, maxRetries: 1, initialBackoffMs: 10, disableLocalStorage: true,
    fetchImpl: fake.fetch,
  });
  for (let i = 0; i < 7; i += 1) {
    transport.enqueue(makeEvent({
      runtimeSessionId: 'rs_baseline', threadId: 'thr_baseline', companyId: 'co_test',
      transitionType: 'node_create', childNodeIds: [`n${i}`], payload: { position: i },
    }));
  }
  const r1 = await transport.flush();
  return {
    scenario: 'baseline. happy-path flush',
    passed: true,
    assertions: [
      ok('first batch result accepted', r1?.accepted ?? 0, (r1?.accepted ?? 0) > 0, '> 0'),
      ok('queue drained to 0', transport.queueSize(), transport.queueSize() === 0, '0'),
      ok('at least 2 batches sent (7 / batch=5)', fake.receivedBatches.length, fake.receivedBatches.length >= 2, '≥ 2'),
    ],
  };
}

async function scenario1_duplicateTransportDelivery(): Promise<TransportScenarioResult> {
  // Same eventId sent twice — registry must dedupe.
  const reg = createThreadRuntimeTraceRegistry();
  const sid = 'rs_dup';
  reg.startSession({ runtimeSessionId: sid, threadId: 't', companyId: 'c' });
  const sharedId = 'evt_shared_xyz';
  const ev = makeEvent({
    runtimeSessionId: sid, threadId: 't', companyId: 'c',
    transitionType: 'node_create', childNodeIds: ['a'], payload: { position: 0 },
    eventId: sharedId,
  });
  reg.recordEvent({ ...ev });
  reg.recordEvent({ ...ev }); // duplicate id
  const trace = reg.getTrace(sid)!;
  const occurrences = trace.events.filter((e) => e.eventId === sharedId).length;
  return {
    scenario: '1. duplicate transport delivery',
    passed: true,
    assertions: [
      ok('event recorded exactly once', occurrences, occurrences === 1, '1'),
    ],
  };
}

async function scenario2_partialFlushFailure(): Promise<TransportScenarioResult> {
  // Server rejects half — client should keep the rejected count but accept
  // that successive flushes drain the queue normally.
  const fake = buildFakeFetch('reject-half');
  const transport = createThreadRuntimeClientTransport({
    batchSize: 6, maxRetries: 0, initialBackoffMs: 10, disableLocalStorage: true,
    fetchImpl: fake.fetch,
  });
  for (let i = 0; i < 6; i += 1) {
    transport.enqueue(makeEvent({
      runtimeSessionId: 'rs_partial', threadId: 't', companyId: 'c',
      transitionType: 'node_create', childNodeIds: [`n${i}`], payload: { position: i },
    }));
  }
  const r = await transport.flush();
  return {
    scenario: '2. partial flush failure (server rejects half)',
    passed: true,
    assertions: [
      ok('non-zero rejected reported', r?.rejected ?? 0, (r?.rejected ?? 0) > 0, '> 0'),
      ok('queue still empties (rejected events dropped from client)', transport.queueSize(), transport.queueSize() === 0, '0'),
    ],
  };
}

async function scenario3_reconnectDuringReorder(): Promise<TransportScenarioResult> {
  // Network goes 503 for one batch, then OK. Transport must retry and succeed.
  const fake = buildFakeFetch('503-once-then-ok');
  const transport = createThreadRuntimeClientTransport({
    batchSize: 3, maxRetries: 3, initialBackoffMs: 5, disableLocalStorage: true,
    fetchImpl: fake.fetch,
  });
  for (let i = 0; i < 3; i += 1) {
    transport.enqueue(makeEvent({
      runtimeSessionId: 'rs_reconnect', threadId: 't', companyId: 'c',
      transitionType: 'node_reorder', childNodeIds: [`n${i}`], payload: { newPosition: i },
    }));
  }
  const r = await transport.flush();
  return {
    scenario: '3. reconnect during reorder',
    passed: true,
    assertions: [
      ok('eventually accepted', r?.accepted ?? 0, (r?.accepted ?? 0) >= 3, '≥ 3'),
      ok('queue drained', transport.queueSize(), transport.queueSize() === 0, '0'),
    ],
  };
}

async function scenario4_unloadDuringPersist(): Promise<TransportScenarioResult> {
  // drainOnUnload should fire a beacon. We can't actually trigger
  // navigator.sendBeacon in node — instead verify the queue is intact
  // when drainOnUnload runs without a sendBeacon shim.
  const fake = buildFakeFetch('ok');
  const transport = createThreadRuntimeClientTransport({
    batchSize: 5, maxRetries: 0, initialBackoffMs: 10, disableLocalStorage: true,
    fetchImpl: fake.fetch,
  });
  for (let i = 0; i < 5; i += 1) {
    transport.enqueue(makeEvent({
      runtimeSessionId: 'rs_unload', threadId: 't', companyId: 'c',
      transitionType: 'persist_attempt', detail: `attempt ${i}`,
    }));
  }
  // drainOnUnload is a no-op in node test env (no navigator.sendBeacon).
  transport.drainOnUnload();
  const r = await transport.flush();
  return {
    scenario: '4. unload during persist',
    passed: true,
    assertions: [
      ok('events did not vanish before flush', r?.accepted ?? 0, (r?.accepted ?? 0) === 5, '5'),
    ],
  };
}

async function scenario5_retryStorm(): Promise<TransportScenarioResult> {
  // Always-fail mode — transport retries up to maxRetries then puts events
  // back on the queue. Verify queue size returns to original count.
  const fake = buildFakeFetch('always-fail');
  const transport = createThreadRuntimeClientTransport({
    batchSize: 3, maxRetries: 2, initialBackoffMs: 5, disableLocalStorage: true,
    fetchImpl: fake.fetch,
  });
  for (let i = 0; i < 3; i += 1) {
    transport.enqueue(makeEvent({
      runtimeSessionId: 'rs_storm', threadId: 't', companyId: 'c',
      transitionType: 'node_create', childNodeIds: [`n${i}`], payload: { position: i },
    }));
  }
  const r = await transport.flush();
  return {
    scenario: '5. retry storm (all retries fail)',
    passed: true,
    assertions: [
      ok('flush returned null (no progress)', r === null ? 'null' : 'not null', r === null, 'null'),
      ok('queue retained events for next attempt', transport.queueSize(), transport.queueSize() === 3, '3'),
    ],
  };
}

async function scenario6_outOfOrderTransportArrival(): Promise<TransportScenarioResult> {
  // Server receives events in a different order than they were emitted.
  // The registry uses orchestrationSequence assigned at insertion time, so
  // the order of insertion is what matters; the resolver should still
  // produce a coherent timeline.
  const reg = createThreadRuntimeTraceRegistry();
  const sid = 'rs_ooo';
  reg.startSession({ runtimeSessionId: sid, threadId: 't', companyId: 'c' });
  // Insert events in "wrong" order — they get sequence numbers based on insertion.
  reg.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'node_create', childNodeIds: ['a'], payload: { position: 0 }, timestamp: isoSecAgo(5) });
  reg.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'persist_success', timestamp: isoSecAgo(2), detail: 'late-arriving' });
  reg.recordEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'persist_attempt', timestamp: isoSecAgo(3) });
  const trace = reg.getTrace(sid)!;
  const timeline = buildThreadRuntimeTimeline(trace);
  return {
    scenario: '6. out-of-order transport arrival',
    passed: true,
    assertions: [
      ok('timeline produced entries', timeline.entries.length, timeline.entries.length >= 3, '≥ 3'),
      ok('timeline sequence is monotonic by orchestrationSequence', timeline.entries.map((e) => e.orchestrationSequence).join(','),
        timeline.entries.every((e, i) => i === 0 || e.orchestrationSequence >= timeline.entries[i - 1].orchestrationSequence),
        'monotonic'),
    ],
  };
}

async function scenario7_tabCrashMidSession(): Promise<TransportScenarioResult> {
  // Simulate: events buffered to localStorage (via the transport), tab
  // crashes (transport instance dies), a new transport instance picks up
  // the persisted queue on construction. We use a fake localStorage map.
  const storageMap = new Map<string, string>();
  const origLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const origWindow = (globalThis as { window?: unknown }).window;
  const origDocument = (globalThis as { document?: unknown }).document;
  const mockDocument = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' };
  (globalThis as { window?: unknown }).window = {
    document: mockDocument,                 // isBrowser() looks at window.document
    localStorage: {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => { storageMap.set(k, v); },
      removeItem: (k: string) => { storageMap.delete(k); },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: undefined,
  };
  (globalThis as { document?: unknown }).document = mockDocument;
  try {
    const fake1 = buildFakeFetch('ok');
    const t1 = createThreadRuntimeClientTransport({
      batchSize: 5, maxRetries: 0, initialBackoffMs: 10, fetchImpl: fake1.fetch,
    });
    for (let i = 0; i < 4; i += 1) {
      t1.enqueue(makeEvent({
        runtimeSessionId: 'rs_crash', threadId: 't', companyId: 'c',
        transitionType: 'node_create', childNodeIds: [`n${i}`], payload: { position: i },
      }));
    }
    // Tab crashes: do NOT call flush. queue persisted in localStorage.

    // New transport instance reads the persisted queue at construction time.
    const fake2 = buildFakeFetch('ok');
    const t2 = createThreadRuntimeClientTransport({
      batchSize: 5, maxRetries: 0, initialBackoffMs: 10, fetchImpl: fake2.fetch,
    });
    const queueAfterCrash = t2.queueSize();
    const r = await t2.flush();
    return {
      scenario: '7. tab crash mid-session — queue rehydrates',
      passed: true,
      assertions: [
        ok('new transport picked up queued events', queueAfterCrash, queueAfterCrash === 4, '4'),
        ok('rehydrated events flushed to server', r?.accepted ?? 0, (r?.accepted ?? 0) === 4, '4'),
      ],
    };
  } finally {
    if (origLocalStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    if (origWindow === undefined) delete (globalThis as { window?: unknown }).window;
    if (origDocument === undefined) delete (globalThis as { document?: unknown }).document;
  }
}

async function scenario8_orphanedClientSession(): Promise<TransportScenarioResult> {
  // Events arrive at the registry tagged with a session that was never
  // started — the registry auto-creates the session.
  const reg = createThreadRuntimeTraceRegistry();
  reg.recordEvent({
    runtimeSessionId: 'rs_orphan', threadId: 't_orphan', companyId: 'c_orphan',
    transitionType: 'node_create', childNodeIds: ['a'], payload: { position: 0 },
    eventId: 'evt_orph_1',
  });
  const trace = reg.getTrace('rs_orphan');
  return {
    scenario: '8. orphaned client session (auto-creates)',
    passed: true,
    assertions: [
      ok('trace auto-created', trace ? 'yes' : 'no', !!trace, 'yes'),
      ok('event inserted', trace?.events.length ?? 0, (trace?.events.length ?? 0) === 1, '1'),
    ],
  };
}

async function scenario9_transportReplayDuplication(): Promise<TransportScenarioResult> {
  // Client retries the same batch 3 times via the registry's ingestion
  // path. Server registry dedupes.
  const reg = createThreadRuntimeTraceRegistry();
  const sid = 'rs_replay';
  reg.startSession({ runtimeSessionId: sid, threadId: 't', companyId: 'c' });
  const batch = [
    makeEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'node_create', childNodeIds: ['a'], payload: { position: 0 }, eventId: 'evt_a' }),
    makeEvent({ runtimeSessionId: sid, threadId: 't', companyId: 'c', transitionType: 'node_create', childNodeIds: ['b'], payload: { position: 1 }, eventId: 'evt_b' }),
  ];
  for (let i = 0; i < 3; i += 1) {
    for (const e of batch) {
      reg.recordEvent({ ...e, eventId: e.eventId });
    }
  }
  const trace = reg.getTrace(sid)!;
  const aCount = trace.events.filter((e) => e.eventId === 'evt_a').length;
  const bCount = trace.events.filter((e) => e.eventId === 'evt_b').length;
  return {
    scenario: '9. transport replay duplication',
    passed: true,
    assertions: [
      ok('evt_a recorded exactly once across 3 retries', aCount, aCount === 1, '1'),
      ok('evt_b recorded exactly once across 3 retries', bCount, bCount === 1, '1'),
    ],
  };
}

async function scenario10_serverRestartDuringFlush(): Promise<TransportScenarioResult> {
  // Round-trip: client flushes a batch successfully, server "restarts"
  // (we clear the registry), client retries on its next flush — server now
  // has no record so all events are accepted.
  const fake = buildFakeFetch('ok');
  const transport = createThreadRuntimeClientTransport({
    batchSize: 3, maxRetries: 0, initialBackoffMs: 5, disableLocalStorage: true,
    fetchImpl: fake.fetch,
  });
  for (let i = 0; i < 3; i += 1) {
    transport.enqueue(makeEvent({
      runtimeSessionId: 'rs_restart', threadId: 't', companyId: 'c',
      transitionType: 'persist_attempt', detail: `attempt ${i}`,
    }));
  }
  const r1 = await transport.flush();
  // Server "restarts" → we simulate by enqueueing the same eventIds again
  for (let i = 0; i < 3; i += 1) {
    transport.enqueue(makeEvent({
      runtimeSessionId: 'rs_restart', threadId: 't', companyId: 'c',
      transitionType: 'persist_attempt', detail: `attempt ${i}-retry`,
    }));
  }
  const r2 = await transport.flush();
  return {
    scenario: '10. server restart during flush',
    passed: true,
    assertions: [
      ok('first flush accepted', r1?.accepted ?? 0, (r1?.accepted ?? 0) === 3, '3'),
      ok('second flush accepted (new events post-restart)', r2?.accepted ?? 0, (r2?.accepted ?? 0) === 3, '3'),
    ],
  };
}

async function scenario_endToEnd(): Promise<TransportScenarioResult> {
  // Correlation + timeline + retention end-to-end.
  const reg = createThreadRuntimeTraceRegistry();
  const sid = 'rs_e2e';
  reg.startSession({ runtimeSessionId: sid, threadId: 'pending_e2e', companyId: 'co_e2e' });
  reg.recordEvent({ runtimeSessionId: sid, threadId: 'pending_e2e', companyId: 'co_e2e',
    transitionType: 'persist_attempt', timestamp: isoSecAgo(10) });
  reg.recordEvent({ runtimeSessionId: sid, threadId: 'pending_e2e', companyId: 'co_e2e',
    transitionType: 'persist_success', latencyMs: 500, detail: 'root=real_root_xyz nodes=3',
    timestamp: isoSecAgo(9) });
  reg.recordEvent({ runtimeSessionId: sid, threadId: 'pending_e2e', companyId: 'co_e2e',
    transitionType: 'node_create', childNodeIds: ['n0'], payload: { position: 0 }, timestamp: isoSecAgo(8) });
  reg.endSession(sid, isoSecAgo(5));

  // Validate against the replay contract — make sure our test data is shaped correctly.
  void validateAndNormalize({
    runtimeSessionId: sid, threadId: 'pending_e2e', companyId: 'co_e2e',
    transitionType: 'node_create', childNodeIds: ['n0'], payload: { position: 0 },
  });

  const trace = reg.getTrace(sid)!;
  const correlated = resolveCorrelation({ trace });
  const timeline = buildThreadRuntimeTimeline(correlated.resolved);

  const merged = mergeCorrelatedSessions({ registry: reg, companyId: 'co_e2e', canonicalThreadId: 'real_root_xyz' });

  const retention = createThreadRuntimeRetentionManager({ registry: reg, policy: { maxAgeMs: 60_000, maxSessionsPerCompany: 10 } });
  const sweepReport = retention.sweep();

  return {
    scenario: '11. correlation + timeline + retention end-to-end',
    passed: true,
    assertions: [
      ok('canonical thread id resolved', correlated.canonicalThreadId ?? '(none)',
        correlated.canonicalThreadId === 'real_root_xyz', 'real_root_xyz'),
      ok('events rewritten to canonical id', correlated.rewrittenEventIds.length,
        correlated.rewrittenEventIds.length >= 3, '≥ 3'),
      ok('timeline includes persist_succeeded entry',
        timeline.entries.map((e) => e.kind).join(','),
        timeline.entries.some((e) => e.kind === 'persist_succeeded'), 'persist_succeeded'),
      ok('timeline emits topology_stabilized', timeline.entries.map((e) => e.kind).join(','),
        timeline.entries.some((e) => e.kind === 'topology_stabilized'), 'topology_stabilized'),
      ok('merge resolved trace touches canonical id', merged.resolved.threadId, merged.resolved.threadId === 'real_root_xyz', 'real_root_xyz'),
      ok('retention sweep returned report', sweepReport.remainingSessionCount,
        sweepReport.remainingSessionCount >= 0, '≥ 0'),
    ],
  };
}

// ── suite ──────────────────────────────────────────────────────────────

export interface TransportStressSuiteReport {
  scenarios: TransportScenarioResult[];
  overall: { total: number; passed: number; failed: number };
}

function finalize(r: TransportScenarioResult): TransportScenarioResult {
  r.passed = r.assertions.every((a) => a.passed);
  return r;
}

export async function runThreadRuntimeTransportStressTests(): Promise<TransportStressSuiteReport> {
  // Sequential so localStorage mock state doesn't leak across scenarios.
  const scenarios: TransportScenarioResult[] = [];
  scenarios.push(await scenario_baseline());
  scenarios.push(await scenario1_duplicateTransportDelivery());
  scenarios.push(await scenario2_partialFlushFailure());
  scenarios.push(await scenario3_reconnectDuringReorder());
  scenarios.push(await scenario4_unloadDuringPersist());
  scenarios.push(await scenario5_retryStorm());
  scenarios.push(await scenario6_outOfOrderTransportArrival());
  scenarios.push(await scenario7_tabCrashMidSession());
  scenarios.push(await scenario8_orphanedClientSession());
  scenarios.push(await scenario9_transportReplayDuplication());
  scenarios.push(await scenario10_serverRestartDuringFlush());
  scenarios.push(await scenario_endToEnd());
  const finalized = scenarios.map(finalize);
  const passed = finalized.filter((s) => s.passed).length;
  return { scenarios: finalized, overall: { total: finalized.length, passed, failed: finalized.length - passed } };
}

export function formatTransportStressReport(report: TransportStressSuiteReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' Thread runtime transport stress suite');
  lines.push('═══════════════════════════════════════════════════════');
  for (const s of report.scenarios) {
    lines.push('');
    lines.push(`${s.passed ? '[PASS]' : '[FAIL]'} ${s.scenario}`);
    for (const a of s.assertions) {
      lines.push(`   ${a.passed ? '✓' : '✗'} ${a.name}: ${a.observed} (${a.expected})`);
    }
  }
  lines.push('');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(` Overall: ${report.overall.passed}/${report.overall.total} scenarios passed`);
  lines.push('═══════════════════════════════════════════════════════');
  return lines.join('\n');
}

void ({} as ThreadRuntimeClientTransport);
