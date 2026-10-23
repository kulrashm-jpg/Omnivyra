/**
 * PI-A7 — provider-call state proven against a REAL killed process.
 *
 * ─── WHAT WAS MISSING ─────────────────────────────────────────────────────
 * A4Q introduced the three-valued `provider_call_state` precisely because a
 * process that dies around the provider call leaves nothing behind to infer
 * from. Every existing proof of that behaviour, however, is a SIMULATION: the
 * A4Q unit suite "kills" the worker by declining to call the completion
 * function, and the A4U/A4Y real-schema suites prove SQL semantics about rows
 * that some hypothetical dead worker left behind. Neither has ever killed a
 * process. A simulated kill is evidence about the simulation.
 *
 * ─── WHAT THIS FILE ACTUALLY DOES ─────────────────────────────────────────
 * It spawns a real operating-system process, has it run the REAL
 * `executeEnrichmentRecorded` from `backend/services/enrichment`, and destroys
 * that process from the outside at a chosen point with an UNCATCHABLE kill —
 * `TerminateProcess` via `taskkill /F` on Windows, `SIGKILL` elsewhere. No
 * `finally`, no `process.on('exit')`, no unhandled-rejection hook runs. The
 * suite then reads what SURVIVED the death and asserts on that alone.
 *
 * Uncatchability is not assumed, it is proven: the child installs an exit
 * handler and a `finally` block that write a cleanup marker. After a normal
 * exit that marker exists; after the kill it must not. If the kill were
 * catchable — or merely simulated — the marker would be there.
 *
 * ─── THE LIMIT OF THIS FILE, STATED PLAINLY ───────────────────────────────
 * The process death is real. The PRODUCTION CODE PATH is real. The durable
 * record is NOT PostgreSQL: it is an fsync'd file standing in for the row,
 * because `W6_DB_URL` is a real-schema-tier dependency this tier does not have.
 * So this proves the ORDERING and DURABILITY property of A4Q — that the mark
 * reaches durable storage strictly before transport, and therefore survives a
 * death that nothing in-process can respond to — and it does NOT prove
 * PostgreSQL's own behaviour under that death.
 *
 * That half lives in `backend/tests/realschema/a7_process_death_recovery.test.ts`,
 * which kills a real process holding a real PostgreSQL connection. It requires
 * `W6_DB_URL` and WAS NOT RUN BY THE AUTHOR.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import { spawn, execFileSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { PROVIDER_CALL_STATES } from '../../services/enrichment/attempts';

const ROOT = path.resolve(__dirname, '../../..');
const ATTEMPTS_SRC = path.join(ROOT, 'backend/services/enrichment/attempts.ts');
const CALL_STATE_MIGRATION = path.join(
  ROOT, 'supabase/migrations/20261017000000_pi_provider_call_state.sql',
);

/**
 * The child. Written to a temp directory at run time rather than committed as
 * a source file, so this package owns exactly the test files it declares.
 *
 * It registers ts-node IN PROCESS (`-r`-style, not the `tsx` CLI) so that
 * exactly ONE operating-system process exists: a kill has nothing to hide
 * behind, and no grandchild can survive the parent and keep running.
 *
 * Deliberately free of template literals — it is embedded in one.
 */
const CHILD_SOURCE = String.raw`
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const rowPath = process.argv[3];      // the durable record — stands in for the row
const readyPath = process.argv[4];    // "I have reached the kill point"
const cleanupPath = process.argv[5];  // written ONLY if something in-process ran on exit
const mode = process.argv[6];

require(path.join(ROOT, 'node_modules/ts-node')).register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true, strict: false },
  project: path.join(ROOT, 'tsconfig.json'),
});
require(path.join(ROOT, 'node_modules/tsconfig-paths')).register({ baseUrl: ROOT, paths: { '@/*': ['./*'] } });

const { executeEnrichmentRecorded } =
  require(path.join(ROOT, 'backend/services/enrichment/recordedExecution.ts'));

// The record is fsync'd on every write. What is readable after the kill is
// exactly what a committed row would be: nothing buffered, nothing deferred.
function writeRow(row) {
  const fd = fs.openSync(rowPath, 'w');
  fs.writeSync(fd, JSON.stringify(row));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
}
const readRow = () => JSON.parse(fs.readFileSync(rowPath, 'utf8'));

// Insert-time defaults, exactly as the table declares them: the boolean and the
// state agree that nothing has been called yet.
writeRow({
  provider_call_state: 'not_called',
  provider_called: false,
  completed_at: null,
  outcome: null,
  claimed_by: 'worker-1',
});

// If ANY of these run, the death was catchable and the proof is void.
const noteCleanup = (what) => { try { fs.writeFileSync(cleanupPath, what); } catch (e) { /* nothing to do */ } };
process.on('exit', () => noteCleanup('exit-handler'));
process.on('SIGTERM', () => noteCleanup('sigterm-handler'));
process.on('SIGINT', () => noteCleanup('sigint-handler'));

// Announce arrival at the kill point, then never return. The parent kills only
// after seeing the announcement, so the boundary is chosen, not raced.
//
// The try/finally wraps the AWAIT, not the promise executor: an executor
// returns synchronously, so a "finally" around it would fire instantly and
// prove nothing. (It did, on the first run of this file.)
async function hangHere(name) {
  try {
    await new Promise(() => {
      fs.writeFileSync(readyPath, name);
      setInterval(() => { /* keep the loop alive so the process must be killed */ }, 1000);
    });
  } finally {
    // Unreachable while hanging; reached only if the kill were catchable.
    noteCleanup('finally-' + name);
  }
}

const ORG = '11111111-1111-4111-8111-111111111111';
const request = {
  organizationId: ORG,
  subject: 'account',
  entityId: '33333333-3333-4333-8333-333333333333',
  attributes: ['employee_count'],
  selectors: { domain: 'example.com' },
  purpose: 'pi-a7',
  correlationId: 'corr-a7',
};

const adapter = {
  id: 'clearbit',
  label: 'Clearbit',
  supports: ['employee_count'],
  credentialEnvVar: 'CLEARBIT_API_KEY',
  isAvailable: () => false,
  enrich: async () => {
    // Inside transport. The A4Q marker has already been written by the real
    // recorder at this point; nothing else has.
    if (mode === 'kill-in-transport') await hangHere('transport');
    return {
      outcome: 'enriched',
      notReturned: [],
      fields: [{
        attribute: 'employee_count', subject: 'account', value: 240,
        observedAt: null, confidence: null, providerInferred: false,
      }],
    };
  },
};

const ports = {
  authorizeCost: async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } }),
  releaseCost: async () => { /* tenant-funded: nothing reserved */ },
  resolveCredential: async () => {
    // Before transport, and therefore before the marker.
    if (mode === 'kill-before-mark') await hangHere('credential');
    return 'synthetic-tenant-provider-key';
  },
  findRecentObservation: async () => null,
  persistObservation: async () => {
    // The provider has ANSWERED. Completion has not run.
    if (mode === 'kill-after-transport') await hangHere('persist');
    return { sourceRecordId: 'src-1', canonicalWithheld: [] };
  },
  now: () => new Date().toISOString(),
};

// The recorder writes to the durable record instead of the table. Every branch
// is the production one — this only redirects storage.
const recorder = {
  nextNumber: async () => 1,
  record: async () => ({ attemptId: 'attempt-1' }),
  markPending: async () => {
    const r = readRow();
    if (r.completed_at) return;                  // a completed row is never re-opened
    r.provider_call_state = 'unknown';
    writeRow(r);
  },
  complete: async (i) => {
    const r = readRow();
    r.provider_call_state = i.providerCallState || (i.providerCalled ? 'called' : 'not_called');
    r.provider_called = i.providerCalled;
    r.outcome = i.outcome;
    r.completed_at = i.completedAt;
    writeRow(r);
  },
  now: () => new Date().toISOString(),
};

executeEnrichmentRecorded(request, 'clearbit', ports, { adapter, recorder })
  .then(() => { fs.writeFileSync(readyPath, 'done'); process.exit(0); })
  .catch((e) => { fs.writeFileSync(readyPath, 'error:' + String(e && e.message)); process.exit(1); });
`;

interface Row {
  provider_call_state: string;
  provider_called: boolean;
  completed_at: string | null;
  outcome: string | null;
  claimed_by: string | null;
}

interface Death {
  /** Where the process was when it was destroyed. */
  marker: string;
  /** What survived. */
  row: Row;
  /** True if ANYTHING in-process ran after the kill. It must not. */
  cleanupRan: boolean;
  exitedNormally: boolean;
}

let tmpRoot = '';
let childPath = '';
const spawned: ChildProcess[] = [];

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

/** Destroy the process tree from the outside. Uncatchable on both platforms. */
function hardKill(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // Already gone. Nothing to do — the assertions read the record, not this.
  }
}

async function waitForFile(file: string, deadlineMs: number): Promise<string> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8');
      if (v.length) return v;
    }
    if (Date.now() > until) throw new Error(`child never reached its kill point: ${file}`);
    await sleep(50);
  }
}

function onExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

/** Run the real executor in a real process, and destroy it at `mode`'s point. */
async function runAndKill(mode: string): Promise<Death> {
  const dir = path.join(tmpRoot, mode);
  fs.mkdirSync(dir, { recursive: true });
  const rowPath = path.join(dir, 'attempt-row.json');
  const readyPath = path.join(dir, 'ready');
  const cleanupPath = path.join(dir, 'cleanup');

  const child = spawn(
    process.execPath, [childPath, ROOT, rowPath, readyPath, cleanupPath, mode],
    { stdio: 'ignore' },
  );
  spawned.push(child);

  const marker = await waitForFile(readyPath, 120_000);
  if (mode !== 'survive') hardKill(child.pid as number);
  await onExit(child, 15_000);
  // Give the OS a moment to reap; the record itself was fsync'd long before.
  await sleep(200);

  return {
    marker,
    row: JSON.parse(fs.readFileSync(rowPath, 'utf8')) as Row,
    cleanupRan: fs.existsSync(cleanupPath),
    exitedNormally: child.exitCode === 0,
  };
}

/**
 * All four processes are run once, in `beforeAll`, because each is a real spawn
 * of a real Node process that loads the real service graph. The assertions
 * below read the corpses.
 */
const deaths: Record<string, Death> = {};

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-a7-'));
  childPath = path.join(tmpRoot, 'child.js');
  fs.writeFileSync(childPath, CHILD_SOURCE, 'utf8');

  for (const mode of ['survive', 'kill-before-mark', 'kill-in-transport', 'kill-after-transport']) {
    deaths[mode] = await runAndKill(mode);
  }
}, 300_000);

afterAll(() => {
  for (const c of spawned) {
    if (c.exitCode === null && c.signalCode === null && c.pid) hardKill(c.pid);
  }
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── the kill is real, and that is itself asserted ───────────────────────────

describe('PI-A7 — the death is real, not simulated', () => {
  it('a process that exits normally DOES run its cleanup', () => {
    // The control. It establishes that the markers this suite relies on are
    // wired up and would fire — so their absence below means something.
    expect(deaths.survive.exitedNormally).toBe(true);
    expect(deaths.survive.cleanupRan).toBe(true);
  });

  it.each(['kill-before-mark', 'kill-in-transport', 'kill-after-transport'])(
    'a killed process (%s) runs NOTHING afterwards', (mode) => {
      const d = deaths[mode];
      expect(d.exitedNormally).toBe(false);
      // No exit handler, no signal handler, no `finally`. This is what makes
      // the state below evidence rather than a stylised story about a crash.
      expect(d.cleanupRan).toBe(false);
      // And it really did die at the boundary this case names.
      expect(d.marker).not.toBe('done');
    },
  );
});

// ── the three states, each after a REAL death ───────────────────────────────

describe('PI-A7 — what a real death leaves behind', () => {
  it('survives the whole execution: called, completed, provider_called true', () => {
    const r = deaths.survive.row;
    expect(r.provider_call_state).toBe('called');
    expect(r.provider_called).toBe(true);
    expect(r.completed_at).not.toBeNull();
    expect(r.outcome).toBe('enriched');
  });

  it('killed BEFORE the marker: not_called — the mark is not written speculatively', () => {
    const d = deaths['kill-before-mark'];
    expect(d.marker).toBe('credential');          // died resolving the credential
    expect(d.row.provider_call_state).toBe('not_called');
    expect(d.row.completed_at).toBeNull();        // still open — the row is the evidence
  });

  it('killed INSIDE transport: unknown, and emphatically NOT not_called', () => {
    // THE B3 CASE, for real. A worker destroyed here may have spent the
    // tenant's provider quota; nothing survived to say so.
    const d = deaths['kill-in-transport'];
    expect(d.marker).toBe('transport');
    expect(d.row.provider_call_state).toBe('unknown');
    expect(d.row.provider_call_state).not.toBe('not_called');
    expect(d.row.completed_at).toBeNull();
  });

  it('killed AFTER the provider answered: still unknown — completion never ran', () => {
    // The provider WAS called and DID answer. The in-memory `providerCalled`
    // flag knew it; the flag died with the process. Only the pre-transport
    // mark survived, and it is the safe answer.
    const d = deaths['kill-after-transport'];
    expect(d.marker).toBe('persist');
    expect(d.row.provider_call_state).toBe('unknown');
    expect(d.row.provider_called).toBe(false);    // the boolean is stale — and useless
    expect(d.row.completed_at).toBeNull();
  });

  it('the boolean alone cannot separate the two deaths; the state can', () => {
    const before = deaths['kill-before-mark'].row;
    const after = deaths['kill-after-transport'].row;
    // Identical on every pre-A4Q signal: this is exactly the ambiguity B3 names.
    expect(before.provider_called).toBe(after.provider_called);
    expect(before.completed_at).toBe(after.completed_at);
    expect(before.outcome).toBe(after.outcome);
    // Separable on the only signal that was persisted before the risk was taken.
    expect(before.provider_call_state).not.toBe(after.provider_call_state);
  });
});

// ── the retry decision a reclaimer would actually make ──────────────────────

describe('PI-A7 — a reclaimer cannot be led into an unsafe duplicate call', () => {
  /** The only safe reading. `provider_called` is not consulted, by design. */
  const safeToCall = (row: Row): boolean => row.provider_call_state === 'not_called';

  it('the corpse of a killed-in-transport worker is NOT safe to call again', () => {
    expect(safeToCall(deaths['kill-in-transport'].row)).toBe(false);
  });

  it('the corpse of a killed-after-transport worker is NOT safe to call again', () => {
    expect(safeToCall(deaths['kill-after-transport'].row)).toBe(false);
  });

  it('a worker that died before the marker IS safe to call — nothing was spent', () => {
    expect(safeToCall(deaths['kill-before-mark'].row)).toBe(true);
  });

  it('reading the boolean instead would authorise a second paid call', () => {
    // Stated as the defect it is, so a future edit that "simplifies" the read
    // back to the boolean fails here rather than in a tenant's invoice.
    const naive = (row: Row): boolean => row.provider_called === false;
    expect(naive(deaths['kill-after-transport'].row)).toBe(true);   // wrong
    expect(safeToCall(deaths['kill-after-transport'].row)).toBe(false); // right
  });

  it('recovery moves ownership only: unknown survives being reclaimed', () => {
    // The A4U/A4N reclaim writes `claimed_by` and `claimed_until` and nothing
    // else. Applied to a real corpse, twice, the state is untouched.
    const row = { ...deaths['kill-in-transport'].row };
    const reclaim = (r: Row, by: string): Row => ({ ...r, claimed_by: by });
    const once = reclaim(row, 'recoverer-1');
    const twice = reclaim(once, 'recoverer-2');
    expect(twice.provider_call_state).toBe('unknown');
    expect(twice.claimed_by).toBe('recoverer-2');
    expect(safeToCall(twice)).toBe(false);
  });
});

// ── the writers that could silently undo all of the above ───────────────────

describe('PI-A7 — nothing in the reclaim path can downgrade unknown', () => {
  const source = (): string => fs.readFileSync(ATTEMPTS_SRC, 'utf8');

  it('the reclaim UPDATE writes ownership columns and no others', () => {
    const src = source();
    const from = src.indexOf('const dbReclaim');
    const to = src.indexOf('export async function reclaimExpiredAttempt');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    const body = src.slice(from, to);
    const openAt = body.indexOf('.update({');
    expect(openAt).toBeGreaterThan(-1);
    const payload = body.slice(openAt, body.indexOf('})', openAt) + 2);

    expect(payload).toContain('claimed_by');
    expect(payload).toContain('claimed_until');
    for (const forbidden of [
      'provider_call_state', 'provider_called', 'outcome', 'completed_at',
      'requested_attributes', 'correlation_id', 'source_record_id', 'attempts_returned',
    ]) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it('the pre-transport marker only ever writes `unknown`, and only to an open row', () => {
    const src = source();
    const from = src.indexOf('export async function markProviderCallPending');
    const to = src.indexOf('export interface ReclaimAttemptInput');
    const body = src.slice(from, to);
    expect(body).toContain("provider_call_state: 'unknown'");
    expect(body).toContain(".is('completed_at', null)");
    expect(body).toContain(".eq('organization_id', input.organizationId)");
    expect(body).not.toContain("'not_called'");
    expect(body).not.toContain("'called'");
  });

  it('completion never writes `unknown` — a surviving process always knows', () => {
    const src = source();
    const from = src.indexOf('export async function completeAttempt');
    const to = src.indexOf('export async function listAttempts');
    const body = src.slice(from, to);
    expect(body).toContain("provider_call_state: input.providerCallState");
    // The derivation is the only fallback, and it cannot produce `unknown`.
    expect(body).toContain("(input.providerCalled ? 'called' : 'not_called')");
    expect(body).not.toMatch(/\?\?\s*'unknown'/);
  });
});

// ── the vocabulary is one vocabulary, not two ───────────────────────────────

describe('PI-A7 — the TypeScript vocabulary matches the database CHECK', () => {
  it('the CHECK constraint admits exactly the three TS values', () => {
    const sql = fs.readFileSync(CALL_STATE_MIGRATION, 'utf8');
    const m = sql.match(/CHECK\s*\(provider_call_state IN \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const admitted = (m as RegExpMatchArray)[1]
      .split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    // Order included: a mismatch in either direction is a defect, and the
    // migration lists them in the same order the constant declares them.
    expect(admitted).toEqual([...PROVIDER_CALL_STATES]);
  });

  it('the column defaults to the value the boolean also defaults to', () => {
    const sql = fs.readFileSync(CALL_STATE_MIGRATION, 'utf8');
    expect(sql).toMatch(/provider_call_state text NOT NULL DEFAULT 'not_called'/);
  });
});
