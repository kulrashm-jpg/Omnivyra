/**
 * The WhatsApp unconfirmed-send sweep is SCHEDULED and RUNS (owner approval 2026-11-11).
 *
 * A job wired to nothing is this programme's recurring failure (recordUserActivity, the
 * ALWAYS_RUN_JOBS gate, email W4, and this very sweep until now). So "registered" is
 * proven three ways, not asserted in a comment:
 *   1. the REAL intent gate admits it with an EMPTY activity set and with a Redis fault
 *      (same harness as readinessSnapshotIntentGate.test.ts);
 *   2. scheduler/cron.ts imports the job and calls it behind shouldRunCronJob with its key;
 *   3. the job itself runs: it finds tenants with unconfirmed sends and sweeps each one,
 *      and one tenant's failure never stops the others.
 */

const zrangebyscoreResult: { value: string[] | Error } = { value: [] };
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: jest.fn(() => ({
    zrangebyscore: jest.fn(async () => {
      if (zrangebyscoreResult.value instanceof Error) throw zrangebyscoreResult.value;
      return zrangebyscoreResult.value;
    }),
    zadd: jest.fn(async () => 1),
    zremrangebyscore: jest.fn(async () => 0),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    hincrby: jest.fn(async () => 1),
    hgetall: jest.fn(async () => ({})),
    expire: jest.fn(async () => 1),
    scan: jest.fn(async () => ['0', [] as string[]]),
    pipeline: jest.fn(() => ({ hincrby: jest.fn(), expire: jest.fn(), exec: jest.fn(async () => []) })),
  })),
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) }));

import fs from 'fs';
import path from 'path';
import { warmIntentContext, getIntentGate, ALWAYS_RUN_JOBS } from '../../services/intentExecutionService';
import { resetFakeDb, failNext } from '../helpers/fakeWhatsappDb';
import {
  listTenantsWithUnconfirmedSends,
  runWhatsAppUnconfirmedSendSweepJob,
} from '../../jobs/whatsappUnconfirmedSendSweepJob';
import type { UnconfirmedSendSweepResult } from '../../services/whatsappUnconfirmedSendSweep';

const JOB = 'whatsappUnconfirmedSendSweep';
const result = (over: Partial<UnconfirmedSendSweepResult> = {}): UnconfirmedSendSweepResult => ({
  runId: 'run', examined: 1, attached: 1, markedUncertain: 0, flaggedForReview: 0, conflicting: 0, alreadyResolved: 0, errors: [], ...over,
});

beforeEach(() => {
  zrangebyscoreResult.value = [];
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('1. the real intent gate admits the sweep regardless of recorded activity', () => {
  it('EMPTY activity set -> allowed', async () => {
    await warmIntentContext();
    expect(ALWAYS_RUN_JOBS.has(JOB)).toBe(true);
    expect(getIntentGate(JOB)).toMatchObject({ allowed: true, reason: null });
  });

  it('Redis ERROR (indistinguishable from idle) -> still allowed', async () => {
    zrangebyscoreResult.value = new Error('redis unavailable');
    await warmIntentContext();
    expect(getIntentGate(JOB).allowed).toBe(true);
  });

  it('NEGATIVE CONTROL: a job NOT in ALWAYS_RUN_JOBS stays gated on an idle platform', async () => {
    await warmIntentContext();
    expect(getIntentGate('healthSnapshot')).toMatchObject({ allowed: false, reason: 'no_active_companies' });
  });
});

describe('2. scheduler/cron.ts calls the job behind its gate key', () => {
  const cron = fs.readFileSync(path.join(__dirname, '../../scheduler/cron.ts'), 'utf8');
  it('imports the job, gates it on its key with an interval, and calls it', () => {
    expect(cron).toMatch(/import \{ runWhatsAppUnconfirmedSendSweepJob \} from '\.\.\/jobs\/whatsappUnconfirmedSendSweepJob';/);
    const block = cron.slice(cron.indexOf(`shouldRunCronJob("${JOB}"`));
    expect(block.length).toBeGreaterThan(0);
    expect(block.slice(0, 600)).toMatch(/WHATSAPP_UNCONFIRMED_SWEEP_INTERVAL_MS/);
    expect(block.slice(0, 600)).toMatch(/await runWhatsAppUnconfirmedSendSweepJob\(\)/);
  });
});

describe('3. the job runs: every tenant with unconfirmed sends is swept, failures isolated', () => {
  it('sweeps each listed tenant and sums the results', async () => {
    const swept: string[] = [];
    const r = await runWhatsAppUnconfirmedSendSweepJob({
      listTenants: async () => ['co-a', 'co-b'],
      sweep: async ({ companyId }) => { swept.push(companyId); return result({ attached: 2, conflicting: companyId === 'co-b' ? 1 : 0 }); },
    });
    expect(swept).toEqual(['co-a', 'co-b']);
    expect(r).toMatchObject({ ok: true, tenants: 2, attached: 4, conflicting: 1, failedTenants: [] });
  });

  it('one tenant failing does not stop the others; the run reports it', async () => {
    const swept: string[] = [];
    const r = await runWhatsAppUnconfirmedSendSweepJob({
      listTenants: async () => ['co-a', 'co-b', 'co-c'],
      sweep: async ({ companyId }) => { if (companyId === 'co-b') throw new Error('rpc down'); swept.push(companyId); return result(); },
    });
    expect(swept).toEqual(['co-a', 'co-c']);
    expect(r).toMatchObject({ ok: false, tenants: 2, failedTenants: ['co-b'] });
  });

  it('a HUNG tenant sweep is abandoned at its timeout; the next tenant is still swept (05: one hang must not freeze the cycle)', async () => {
    const swept: string[] = [];
    const r = await runWhatsAppUnconfirmedSendSweepJob({
      listTenants: async () => ['co-a', 'co-b'],
      sweep: ({ companyId }) => {
        if (companyId === 'co-a') return new Promise<never>(() => undefined);
        swept.push(companyId);
        return Promise.resolve(result());
      },
      sweepTimeoutMs: 20,
    });
    expect(swept).toEqual(['co-b']);
    expect(r).toMatchObject({ ok: false, tenants: 1, failedTenants: ['co-a'] });
  });

  it('a HUNG tenant scan is abandoned at its timeout; nothing is swept and the job returns', async () => {
    const sweep = jest.fn();
    const r = await runWhatsAppUnconfirmedSendSweepJob({ listTenants: () => new Promise<never>(() => undefined), sweep, scanTimeoutMs: 20 });
    expect(r.ok).toBe(false);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('once the run budget is spent, the remaining tenants are DEFERRED (counted), not swept', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let t = 0;
    const swept: string[] = [];
    const r = await runWhatsAppUnconfirmedSendSweepJob({
      listTenants: async () => ['co-a', 'co-b', 'co-c'],
      sweep: async ({ companyId }) => { swept.push(companyId); t += 100; return result(); },
      budgetMs: 150,
      clock: () => t,
    });
    expect(swept).toEqual(['co-a', 'co-b']);
    expect(r.deferredTenants).toBe(1);
  });

  it('NEGATIVE CONTROL: within the timeouts and budget every tenant is swept and nothing is deferred', async () => {
    const r = await runWhatsAppUnconfirmedSendSweepJob({
      listTenants: async () => ['co-a', 'co-b'],
      sweep: async () => result(),
      sweepTimeoutMs: 1000,
      budgetMs: 10_000,
    });
    expect(r).toMatchObject({ ok: true, tenants: 2, deferredTenants: 0 });
  });

  it('a failed tenant scan sweeps nothing and never throws', async () => {
    const sweep = jest.fn();
    const r = await runWhatsAppUnconfirmedSendSweepJob({ listTenants: async () => { throw new Error('db down'); }, sweep });
    expect(r.ok).toBe(false);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('the tenant scan finds exactly the tenants with unconfirmed sends (no message id), once each', async () => {
    resetFakeDb({
      whatsapp_broadcasts: [
        { id: 'b1', company_id: 'co-a' }, { id: 'b2', company_id: 'co-a' }, { id: 'b3', company_id: 'co-b' }, { id: 'b4', company_id: 'co-c' },
      ],
      whatsapp_broadcast_recipients: [
        { id: 'r1', broadcast_id: 'b1', status: 'sending', wa_message_id: null },
        { id: 'r2', broadcast_id: 'b2', status: 'send_uncertain', wa_message_id: null },
        { id: 'r3', broadcast_id: 'b3', status: 'send_uncertain', wa_message_id: null },
        // NEGATIVE CONTROLS: resolved, or already carrying an id - not candidates.
        { id: 'r4', broadcast_id: 'b4', status: 'sent', wa_message_id: 'wamid.1' },
        { id: 'r5', broadcast_id: 'b4', status: 'send_uncertain', wa_message_id: 'wamid.2' },
      ],
    });
    expect((await listTenantsWithUnconfirmedSends()).sort()).toEqual(['co-a', 'co-b']);
  });

  it('a recipient read error is surfaced, not read as "no tenants"', async () => {
    resetFakeDb({ whatsapp_broadcasts: [], whatsapp_broadcast_recipients: [] });
    failNext('whatsapp_broadcast_recipients', 'select', 0);
    await expect(listTenantsWithUnconfirmedSends()).rejects.toThrow(/unreadable/);
  });
});
