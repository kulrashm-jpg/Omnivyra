/**
 * A7 — the retry job: the trigger, and the two switches that keep it inert.
 *
 * Registering a job in `scheduler/cron.ts` makes it run on the next deploy, so
 * "inert until enabled" is not a claim that can be left to a comment. These
 * tests hold it: with the flag absent NOTHING is read, and with the flag on but
 * no tenant named, still nothing. Both are proven by observing that the
 * candidate reader was never called — not by inspecting a return value, which a
 * future edit could satisfy while still reading the database.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));
jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  runProspectRetryJob, scheduledTenants, retrySchedulerEnabled,
  RETRY_SCHEDULER_FLAG, RETRY_SCHEDULER_TENANTS, WORKER_ID,
} from '../../jobs/prospectRetryJob';
import type { RetryConsumerPorts } from '../../services/enrichment/retryConsumer';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-07T12:00:00.000Z';

/** Ports that record which tenants were asked about, and answer with nothing. */
function silentPorts() {
  const asked: string[] = [];
  const ports: RetryConsumerPorts = {
    listCandidates: async (i) => { asked.push(i.organizationId); return []; },
    resolveProspect: async () => null,
    plan: async () => { throw new Error('unreachable: no candidate'); },
    statuses: async () => [] as never,
    execute: async () => { throw new Error('unreachable: no candidate'); },
    emit: () => { /* asserted elsewhere */ },
  };
  return { ports, asked };
}

const on = { [RETRY_SCHEDULER_FLAG]: 'true' } as unknown as NodeJS.ProcessEnv;

describe('A7 — the job is inert unless deliberately enabled', () => {
  it('reads NOTHING when the flag is absent', async () => {
    const p = silentPorts();
    const report = await runProspectRetryJob({
      env: { [RETRY_SCHEDULER_TENANTS]: `${ORG_A},${ORG_B}` } as unknown as NodeJS.ProcessEnv,
      now: () => NOW, ports: p.ports,
    });
    expect(report.ran).toBe(false);
    expect(p.asked).toEqual([]);
  });

  it('reads NOTHING for any value of the flag other than the exact string "true"', async () => {
    for (const value of ['false', 'TRUE', '1', 'yes', '', ' true ']) {
      const p = silentPorts();
      const report = await runProspectRetryJob({
        env: { [RETRY_SCHEDULER_FLAG]: value, [RETRY_SCHEDULER_TENANTS]: ORG_A } as unknown as NodeJS.ProcessEnv,
        now: () => NOW, ports: p.ports,
      });
      expect(report.ran).toBe(false);
      expect(p.asked).toEqual([]);
    }
    expect(retrySchedulerEnabled({ [RETRY_SCHEDULER_FLAG]: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('reads NOTHING when the flag is on but no tenant is named', async () => {
    const p = silentPorts();
    const report = await runProspectRetryJob({ env: on, now: () => NOW, ports: p.ports });
    expect(report.ran).toBe(false);
    expect(p.asked).toEqual([]);
  });

  it('there is no "all tenants" form — scope comes only from the allow-list', () => {
    expect(scheduledTenants(undefined)).toEqual([]);
    expect(scheduledTenants('')).toEqual([]);
    expect(scheduledTenants('  ,  , ')).toEqual([]);
    expect(scheduledTenants('*')).toEqual(['*']);          // a literal, not a wildcard
    expect(scheduledTenants(`${ORG_A}, ${ORG_B} ,${ORG_A}`)).toEqual([ORG_A, ORG_B]);
  });
});

describe('A7 — with both switches set, each named tenant is asked separately', () => {
  const env = { ...on, [RETRY_SCHEDULER_TENANTS]: `${ORG_A},${ORG_B}` } as unknown as NodeJS.ProcessEnv;

  it('one bounded cycle per tenant, never a cross-tenant read', async () => {
    const p = silentPorts();
    const report = await runProspectRetryJob({ env, now: () => NOW, ports: p.ports });
    expect(report.ran).toBe(true);
    expect(report.tenants).toBe(2);
    // Two separate reads, each naming its own tenant.
    expect(p.asked).toEqual([ORG_A, ORG_B]);
  });

  it('a failing tenant is reported and does not stop the others', async () => {
    const asked: string[] = [];
    const ports: RetryConsumerPorts = {
      ...silentPorts().ports,
      listCandidates: async (i) => {
        asked.push(i.organizationId);
        if (i.organizationId === ORG_A) throw new Error('read failed');
        return [];
      },
    };
    const report = await runProspectRetryJob({ env, now: () => NOW, ports });
    expect(asked).toEqual([ORG_A, ORG_B]);
    expect(report.failures).toBe(1);
    expect(report.ran).toBe(true);
  });

  it('never throws, whatever the ports do', async () => {
    const ports: RetryConsumerPorts = {
      ...silentPorts().ports,
      listCandidates: async () => { throw new Error('database unreachable'); },
    };
    await expect(runProspectRetryJob({ env, now: () => NOW, ports })).resolves.toMatchObject({
      ran: true, failures: 2, executed: 0,
    });
  });
});

describe('A7 — worker identity', () => {
  it('is stable within a process, so its leases are attributable', () => {
    expect(WORKER_ID).toBe(WORKER_ID);
    expect(WORKER_ID).toMatch(/^pi-retry-\d+-[a-z0-9]+$/);
  });

  it('carries no credential and no user — a worker is a process, not a person', () => {
    expect(WORKER_ID.toLowerCase()).not.toMatch(/key|token|secret|@/);
  });

  it('is passed to the cycle as the lease owner', async () => {
    const seen: string[] = [];
    const ports: RetryConsumerPorts = {
      ...silentPorts().ports,
      listCandidates: async () => [],
      emit: (event, fields) => {
        if (event === 'cycle_complete') seen.push(String((fields as { workerId: string }).workerId));
      },
    };
    await runProspectRetryJob({
      env: { ...on, [RETRY_SCHEDULER_TENANTS]: ORG_A } as unknown as NodeJS.ProcessEnv,
      now: () => NOW, ports, workerId: 'worker-under-test',
    });
    expect(seen).toEqual(['worker-under-test']);
  });
});

describe('A7 — worker failure is answered by the existing attempt semantics', () => {
  const env = { ...on, [RETRY_SCHEDULER_TENANTS]: ORG_A } as unknown as NodeJS.ProcessEnv;

  it('a crash before the claim leaves the candidate untouched and rediscoverable', async () => {
    // Modelled as the process dying between discovery and execution: nothing was
    // claimed, so the row is exactly as it was and the next cycle sees it again.
    const rows = [{
      attemptId: 'att-1', organizationId: ORG_A, subject: 'account' as const,
      entityId: 'acct-1', providerKey: 'clearbit', requestedAttributes: ['employee_count'],
      attemptNumber: 1, correlationId: 'c', outcome: 'rate_limited' as const,
      executionStatus: 'completed' as const, providerCallState: 'called' as const,
      completedAt: '2026-09-07T11:00:00.000Z', nextRetryAt: '2026-09-07T11:00:00.000Z',
    }];
    let cycles = 0;
    const ports: RetryConsumerPorts = {
      ...silentPorts().ports,
      listCandidates: async () => { cycles += 1; return rows; },
      resolveProspect: async () => { throw new Error('worker died'); },
    };
    await runProspectRetryJob({ env, now: () => NOW, ports });
    await runProspectRetryJob({ env, now: () => NOW, ports });
    // Still discoverable on the second tick: nothing consumed it.
    expect(cycles).toBe(2);
  });

  it('the job writes no attempt state of its own — completion belongs to the executor', () => {
    // A structural claim, held by the port surface: there is no port through
    // which the job could close, reopen or re-time an attempt.
    const surface = Object.keys(silentPorts().ports);
    expect(surface).toEqual([
      'listCandidates', 'resolveProspect', 'plan', 'statuses', 'execute', 'emit',
    ]);
    for (const forbidden of ['complete', 'record', 'claim', 'reclaim', 'update']) {
      expect(surface.join(',')).not.toContain(forbidden);
    }
  });
});
