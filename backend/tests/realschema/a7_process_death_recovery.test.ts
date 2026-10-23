/**
 * A7 — a REAL killed process, against real PostgreSQL.
 *
 * ─── THE GAP THIS CLOSES ──────────────────────────────────────────────────
 * Everything A4Q, A4N and A4U prove about process death is proven by SQL
 * SEMANTICS: rows are hand-planted in the state a dead worker would have left,
 * and the predicates are exercised against them. That is a proof about the
 * predicates. It is not a proof that a worker destroyed mid-flight actually
 * leaves that state, because no worker was ever destroyed.
 *
 * This suite destroys one. It spawns a real operating-system process, has it
 * open a real attempt over a real PostgreSQL connection, brings it to a chosen
 * boundary, and kills it from the outside — `TerminateProcess` via `taskkill /F`
 * on Windows, `SIGKILL` elsewhere. Nothing in the child runs afterwards: no
 * `finally`, no exit handler, no rollback issued by the client. The suite waits
 * until PostgreSQL has reaped the orphaned backend (proving the death, not just
 * a pause) and then asserts on what is COMMITTED.
 *
 * ─── WHAT EACH BOUNDARY IS FOR ────────────────────────────────────────────
 *   before-mark        killed after the attempt row exists and before the
 *                      pre-transport mark — the row must read `not_called`,
 *                      or the mark is being written speculatively;
 *   autocommit-mark    killed after the mark — the row must read `unknown`.
 *                      THIS IS B3, for real: the surviving row is the only
 *                      thing that knows the tenant's quota may have been spent;
 *   uncommitted-mark   the mark issued inside an OPEN transaction that the
 *                      death aborts — the row reads `not_called` again. The
 *                      marker is only worth anything because it is committed
 *                      before transport, and this names the change that would
 *                      silently undo A4Q: wrapping the mark and the provider
 *                      call in one transaction.
 *
 * ─── WHAT THIS STILL DOES NOT PROVE ───────────────────────────────────────
 * The provider call is not made — no vendor is contacted, by rule — so the
 * "quota was spent" half of B3 remains a property of the ORDERING (mark strictly
 * before transport), not something observed end to end. The ordering itself is
 * proven, in-process and against the real executor, in
 * `backend/tests/unit/piA7ProcessDeathProof.test.ts`.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract
 * as its siblings and has not been run locally.
 */
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { db, seedTenants, newAccount, ORG_A, ORG_B } from './setup';

const url = process.env.W6_DB_URL as string;
const ROOT = path.resolve(__dirname, '../../..');
const PROVIDER = 'a7-death';
const SET = '{employee_count}';

/**
 * The dying worker. Written at run time rather than committed as a source
 * file, so this package owns exactly the test files it declares.
 *
 * It uses `pg` directly rather than the production writer: the production
 * writer reaches storage through the Supabase client, which needs credentials
 * this tier does not have and must not seek. The statements below are the ones
 * `markProviderCallPending` composes, transcribed — the same convention a4n,
 * a4u and a4y follow — and the transcription is checked against the source in
 * the unit-tier sibling.
 *
 * Deliberately free of backticks and template literals: it is embedded in one.
 */
const CHILD_SOURCE = String.raw`
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const url = process.argv[3];
const org = process.argv[4];
const account = process.argv[5];
const provider = process.argv[6];
const idPath = process.argv[7];
const readyPath = process.argv[8];
const cleanupPath = process.argv[9];
const mode = process.argv[10];
const appName = process.argv[11];

const { Client } = require(path.join(ROOT, 'node_modules/pg'));

// If ANY of these run, the death was catchable and the proof is void.
const noteCleanup = (what) => { try { fs.writeFileSync(cleanupPath, what); } catch (e) { /* gone */ } };
process.on('exit', () => noteCleanup('exit-handler'));
process.on('SIGTERM', () => noteCleanup('sigterm-handler'));
process.on('SIGINT', () => noteCleanup('sigint-handler'));

const OPEN = "INSERT INTO public.prospect_enrichment_attempts"
  + " (organization_id, account_id, provider_key, requested_attributes, attempt_number,"
  + "  correlation_id, started_at, claimed_by, claimed_until)"
  + " VALUES ($1,$2,$3,'{employee_count}',1,'corr-a7-death', now(), 'dying-worker',"
  + "         now() + interval '5 minutes') RETURNING id";

// markProviderCallPending, exactly as it composes its UPDATE.
const MARK = "UPDATE public.prospect_enrichment_attempts"
  + " SET provider_call_state = 'unknown'"
  + " WHERE id = $1 AND organization_id = $2 AND completed_at IS NULL";

async function main() {
  const c = new Client({ connectionString: url, application_name: appName });
  await c.connect();

  const opened = await c.query(OPEN, [org, account, provider]);
  const id = opened.rows[0].id;
  fs.writeFileSync(idPath, id);

  if (mode === 'autocommit-mark') {
    // One statement, its own implicit transaction: committed on return.
    await c.query(MARK, [id, org]);
  } else if (mode === 'uncommitted-mark') {
    // The same write, held open. The death aborts it.
    await c.query('BEGIN');
    await c.query(MARK, [id, org]);
  }

  // At the boundary. The parent kills only after seeing this, so the moment of
  // death is chosen rather than raced.
  fs.writeFileSync(readyPath, mode);
  await new Promise(function () { setInterval(function () { /* stay alive */ }, 1000); });
}

main().catch(function (e) {
  try { fs.writeFileSync(readyPath, 'error:' + String(e && e.message)); } catch (x) { /* gone */ }
  process.exit(1);
});
`;

interface Corpse {
  attemptId: string;
  marker: string;
  cleanupRan: boolean;
  exitedNormally: boolean;
}

let tmpRoot = '';
let childPath = '';
const spawned: ChildProcess[] = [];
const accounts: Record<string, string> = {};
const corpses: Record<string, Corpse> = {};

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
    // Already gone. The assertions read committed rows, not this.
  }
}

async function waitForFile(file: string, deadlineMs: number): Promise<string> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8');
      if (v.length) return v;
    }
    if (Date.now() > until) throw new Error(`the child never reached its boundary: ${file}`);
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

/**
 * Wait until PostgreSQL has reaped the killed backend.
 *
 * This is what turns "the process stopped responding" into "the process is
 * dead": an orphaned backend still holds the row locks an uncommitted
 * transaction took, so the assertions below would block rather than fail.
 */
async function waitForBackendGone(appName: string, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM pg_stat_activity WHERE application_name = $1`, [appName]);
    if (rows[0].n === 0) return;
    if (Date.now() > until) throw new Error(`the killed backend ${appName} was never reaped`);
    await sleep(250);
  }
}

/** Spawn a worker, bring it to `mode`'s boundary, and destroy it. */
async function killAt(mode: string, account: string): Promise<Corpse> {
  const dir = path.join(tmpRoot, mode);
  fs.mkdirSync(dir, { recursive: true });
  const idPath = path.join(dir, 'attempt-id');
  const readyPath = path.join(dir, 'ready');
  const cleanupPath = path.join(dir, 'cleanup');
  const appName = `a7-dying-${mode}`;

  const child = spawn(process.execPath, [
    childPath, ROOT, url, ORG_A, account, PROVIDER, idPath, readyPath, cleanupPath, mode, appName,
  ], { stdio: 'ignore' });
  spawned.push(child);

  const marker = await waitForFile(readyPath, 60_000);
  if (marker.startsWith('error:')) throw new Error(`child failed before the boundary: ${marker}`);

  hardKill(child.pid as number);
  await onExit(child, 15_000);
  await waitForBackendGone(appName, 30_000);

  return {
    attemptId: fs.readFileSync(idPath, 'utf8').trim(),
    marker,
    cleanupRan: fs.existsSync(cleanupPath),
    exitedNormally: child.exitCode === 0,
  };
}

async function row(id: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `SELECT provider_call_state, provider_called, outcome, completed_at, claimed_by
       FROM public.prospect_enrichment_attempts WHERE id = $1`, [id]);
  return rows[0];
}

/** The ONLY safe reading. `provider_called` is deliberately not consulted. */
const safeToCall = (r: Record<string, unknown>): boolean => r.provider_call_state === 'not_called';

beforeAll(async () => {
  await seedTenants();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a7-death-'));
  childPath = path.join(tmpRoot, 'dying-worker.js');
  fs.writeFileSync(childPath, CHILD_SOURCE, 'utf8');

  // One account per boundary: the live partial unique index permits exactly one
  // open attempt per work item, and every corpse below is an open attempt.
  for (const mode of ['before-mark', 'autocommit-mark', 'uncommitted-mark']) {
    accounts[mode] = await newAccount(ORG_A, { domain: `${mode}.a7death.w6`, source: 'a7' });
    corpses[mode] = await killAt(mode, accounts[mode]);
  }
}, 300_000);

afterAll(async () => {
  for (const c of spawned) {
    if (c.exitCode === null && c.signalCode === null && c.pid) hardKill(c.pid);
  }
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });

  // These suites share one database; a leaked canonical row previously broke a
  // SIBLING that legitimately asserted a tenant held none. Same cleanup as A4N.
  await db.query(`DELETE FROM public.prospect_enrichment_attempts WHERE provider_key LIKE 'a7-%'`);
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'a7'`);
  await db.query(`DELETE FROM public.unified_persons WHERE company_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
});

// ── the deaths were real ────────────────────────────────────────────────────

describe('A7 — the worker was genuinely destroyed', () => {
  it.each(['before-mark', 'autocommit-mark', 'uncommitted-mark'])(
    '%s: nothing in the child ran after the kill', (mode) => {
      const c = corpses[mode];
      expect(c.exitedNormally).toBe(false);
      // No exit handler, no signal handler. Had the kill been catchable — or
      // merely simulated — this marker would exist.
      expect(c.cleanupRan).toBe(false);
      expect(c.marker).toBe(mode);
    });

  it('PostgreSQL reaped every orphaned backend', async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM pg_stat_activity WHERE application_name LIKE 'a7-dying-%'`);
    expect(rows[0].n).toBe(0);
  });

  it('each dead worker still left its attempt row behind', async () => {
    for (const mode of Object.keys(corpses)) {
      const r = await row(corpses[mode].attemptId);
      expect(r).toBeDefined();
      // An open row IS the evidence that something started and never finished.
      expect(r.completed_at).toBeNull();
      expect(r.claimed_by).toBe('dying-worker');
    }
  });
});

// ── what the committed row says ─────────────────────────────────────────────

describe('A7 — the committed state after a real death', () => {
  it('killed BEFORE the mark: not_called — nothing was written speculatively', async () => {
    const r = await row(corpses['before-mark'].attemptId);
    expect(r.provider_call_state).toBe('not_called');
    expect(safeToCall(r)).toBe(true);
  });

  it('killed AFTER the committed mark: unknown — B3, observed rather than assumed', async () => {
    const r = await row(corpses['autocommit-mark'].attemptId);
    expect(r.provider_call_state).toBe('unknown');
    expect(r.provider_call_state).not.toBe('not_called');
    expect(r.provider_called).toBe(false);        // the boolean is stale, and useless
    expect(safeToCall(r)).toBe(false);
  });

  it('the mark held in an OPEN transaction does not survive: not_called', async () => {
    // Not a defect in the shipped writer — it autocommits, as the case above
    // shows. This is the regression this file exists to catch: batching the
    // mark into the same transaction as the call would erase it on death and
    // silently reinstate the ambiguity B3 removed, with every other test in
    // the repository still green.
    const r = await row(corpses['uncommitted-mark'].attemptId);
    expect(r.provider_call_state).toBe('not_called');
    expect(safeToCall(r)).toBe(true);             // and this is the WRONG answer
  });

  it('the two committed deaths differ only in the state', async () => {
    const before = await row(corpses['before-mark'].attemptId);
    const after = await row(corpses['autocommit-mark'].attemptId);
    expect(before.provider_called).toBe(after.provider_called);
    expect(before.outcome).toBe(after.outcome);
    expect(before.completed_at).toBe(after.completed_at);
    expect(before.provider_call_state).not.toBe(after.provider_call_state);
  });
});

// ── recovery of the corpse ──────────────────────────────────────────────────

describe('A7 — a survivor recovers the dead worker\'s attempt', () => {
  /** `dbReclaim` with A4U's cutoff and A4Y's attribute predicate. */
  const RECOVER = `
    UPDATE public.prospect_enrichment_attempts
       SET claimed_by = $6, claimed_until = now() + interval '1 minute'
     WHERE organization_id = $1 AND account_id = $2 AND provider_key = $3
       AND requested_attributes = $4::text[]
       AND completed_at IS NULL
       AND (claimed_until < now()
            OR (claimed_until IS NULL AND started_at < $5::timestamptz))
     RETURNING id`;

  /** The dead worker took a 5-minute lease; expire it as a sweeper would find it. */
  const expire = (id: string) => db.query(
    `UPDATE public.prospect_enrichment_attempts
        SET claimed_until = now() - interval '1 minute' WHERE id = $1`, [id]);

  const cutoff = () => new Date(Date.now() - 30 * 60_000).toISOString();

  it('while the corpse is open, no second attempt can be opened for that work item', async () => {
    // The reason abandoned work cannot become a duplicate CALL: it cannot even
    // become a duplicate ATTEMPT. The arbiter is the index, not anyone's care.
    await expect(db.query(
      `INSERT INTO public.prospect_enrichment_attempts
         (organization_id, account_id, provider_key, requested_attributes, attempt_number,
          correlation_id, started_at)
       VALUES ($1,$2,$3,$4::text[],2,'corr-a7-second', now())`,
      [ORG_A, accounts['autocommit-mark'], PROVIDER, SET],
    )).rejects.toMatchObject({ code: '23505' });
  });

  it('the recoverer inherits the attempt and is told NOT to call', async () => {
    const id = corpses['autocommit-mark'].attemptId;
    await expire(id);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, accounts['autocommit-mark'], PROVIDER, SET, cutoff(), 'survivor']);
    expect(rowCount).toBe(1);

    const r = await row(id);
    expect(r.claimed_by).toBe('survivor');         // ownership moved
    expect(r.provider_call_state).toBe('unknown'); // knowledge did not
    expect(safeToCall(r)).toBe(false);
  });

  it('exactly one survivor wins the corpse', async () => {
    const id = corpses['autocommit-mark'].attemptId;
    await expire(id);
    const a = await db.query(RECOVER,
      [ORG_A, accounts['autocommit-mark'], PROVIDER, SET, cutoff(), 'survivor-A']);
    const b = await db.query(RECOVER,
      [ORG_A, accounts['autocommit-mark'], PROVIDER, SET, cutoff(), 'survivor-B']);
    expect(a.rowCount).toBe(1);
    expect(b.rowCount).toBe(0);
    expect((await row(id)).provider_call_state).toBe('unknown');
  });

  it('the corpse that died before the mark IS safe for its recoverer to call', async () => {
    const id = corpses['before-mark'].attemptId;
    await expire(id);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, accounts['before-mark'], PROVIDER, SET, cutoff(), 'survivor']);
    expect(rowCount).toBe(1);
    const r = await row(id);
    expect(r.provider_call_state).toBe('not_called');
    expect(safeToCall(r)).toBe(true);
  });

  it('another tenant can neither recover nor read the corpse', async () => {
    const id = corpses['autocommit-mark'].attemptId;
    await expire(id);
    const { rowCount } = await db.query(RECOVER,
      [ORG_B, accounts['autocommit-mark'], PROVIDER, SET, cutoff(), 'other-tenant']);
    expect(rowCount).toBe(0);

    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.prospect_enrichment_attempts
        WHERE id = $1 AND organization_id = $2`, [id, ORG_B]);
    expect(rows[0].n).toBe(0);
  });
});
