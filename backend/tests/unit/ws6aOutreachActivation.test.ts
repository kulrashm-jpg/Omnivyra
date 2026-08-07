/**
 * WS-6A — activation caller safety properties.
 *
 * The certification proof (scripts/ws6a-activation-proof.ts) drives the real
 * runtime against a real database and proves the happy path executes. These
 * tests pin the properties that make the caller SAFE, which are precisely the
 * ones a future edit is most likely to erode quietly:
 *
 *   • it never approves — approval is the human gate M3 built before capability
 *   • it dispatches the internal channel only unless told otherwise, even
 *     though the email transport is registered and resolvable
 *   • a permitted-channel refusal is distinguishable from a missing transport
 *   • a lead with no plan is a reported state, not a throw
 *
 * No database, no network: the intelligence read port is injected, and the
 * runtime module is mocked at the seam so the assertions are about the CALLER's
 * decisions rather than about the runtime, which WS-3 already certifies.
 */

const dispatched: Array<{ companyId: string; taskId: string }> = [];
let tasksForLead: Array<Record<string, unknown>> = [];
let registered: string[] = ['internal', 'email'];
let materializeCalls = 0;
let approveCalls = 0;
let submitCalls = 0;

jest.mock('../../services/leadOutreachExecution', () => ({
  registerDefaultTransports: () => {},
  supportedChannels: () => [...registered],
  resolveTransport: (channel: string | null) => (channel && registered.includes(channel) ? { channel } : null),
  listOutreachTasksForLead: async () => tasksForLead,
  materializeAutomationPlan: async () => {
    materializeCalls += 1;
    return { created: 1, duplicates: 0, skipped: 0, failed: 0, results: [] };
  },
  dispatchInternalOutreachTask: async (companyId: string, taskId: string) => {
    dispatched.push({ companyId, taskId });
    return { ok: true, outcome: 'sent', reason: 'stub', governance: { decision: 'allowed' } };
  },
  submitForApproval: async () => { submitCalls += 1; return { ok: true, status: 'awaiting_approval' }; },
  approveOutreachTask: async () => { approveCalls += 1; return { ok: true, status: 'approved' }; },
}));

jest.mock('../../services/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } }));

import {
  DEFAULT_ACTIVATION_CHANNELS,
  dispatchApprovedOutreachForLead,
  runOutreachActivation,
} from '../../services/leadOutreachActivation';

/** Intelligence read port returning a fixed envelope. */
const portWith = (automationPlanning: unknown) => ({
  get: async () => (automationPlanning === undefined ? null : ({
    companyId: 'co', leadId: 'L1', automationPlanning, generatedAt: '2026-08-07T09:00:00.000Z',
  } as never)),
  upsert: async () => ({ ok: true as const }),
});

const task = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 't1', channel: 'internal', status: 'approved', ...over,
});

beforeEach(() => {
  dispatched.length = 0;
  tasksForLead = [];
  registered = ['internal', 'email'];
  materializeCalls = 0;
  approveCalls = 0;
  submitCalls = 0;
});

describe('WS-6A activation caller — safety properties', () => {
  it('defaults to the internal channel only', () => {
    expect([...DEFAULT_ACTIVATION_CHANNELS]).toEqual(['internal']);
  });

  it('never approves a task as a side effect of activation', async () => {
    tasksForLead = [task({ status: 'pending' })];
    const report = await runOutreachActivation('co', 'L1', { persistence: portWith({ tasks: [] }) as never });

    expect(approveCalls).toBe(0);
    expect(submitCalls).toBe(0);
    expect(report.dispatched).toBe(0);
    expect(report.tasks[0].action).toBe('not_approved');
  });

  it('does not dispatch an approved EMAIL task by default, though its transport resolves', async () => {
    tasksForLead = [task({ id: 'e1', channel: 'email', status: 'approved' })];
    const reports = await dispatchApprovedOutreachForLead('co', 'L1');

    expect(dispatched).toHaveLength(0);
    expect(reports[0].action).toBe('channel_not_permitted');
  });

  it('dispatches email only when the caller is explicitly widened', async () => {
    tasksForLead = [task({ id: 'e1', channel: 'email', status: 'approved' })];
    const reports = await dispatchApprovedOutreachForLead('co', 'L1', { channels: ['internal', 'email'] });

    expect(dispatched).toEqual([{ companyId: 'co', taskId: 'e1' }]);
    expect(reports[0].action).toBe('dispatched');
  });

  it('separates "not permitted" from "no transport" — they are different operator facts', async () => {
    registered = ['internal']; // email transport absent entirely
    tasksForLead = [
      task({ id: 'a', channel: 'email', status: 'approved' }),
      task({ id: 'b', channel: 'whatsapp', status: 'approved' }),
    ];
    const reports = await dispatchApprovedOutreachForLead('co', 'L1', { channels: ['internal', 'email', 'whatsapp'] });

    expect(reports.find((r) => r.taskId === 'a')?.action).toBe('no_transport');
    expect(reports.find((r) => r.taskId === 'b')?.action).toBe('no_transport');
    expect(dispatched).toHaveLength(0);
  });

  it('leaves terminal tasks alone rather than re-dispatching them', async () => {
    tasksForLead = [task({ id: 's1', status: 'sent' })];
    const reports = await dispatchApprovedOutreachForLead('co', 'L1');

    expect(reports[0].action).toBe('terminal');
    expect(dispatched).toHaveLength(0);
  });

  it('reports a lead with no envelope instead of throwing', async () => {
    const report = await runOutreachActivation('co', 'L1', { persistence: portWith(undefined) as never });

    expect(report.planPresent).toBe(false);
    expect(report.blocked).toContain('no generated envelope');
    expect(materializeCalls).toBe(0);
  });

  it('reports an envelope whose plan is null instead of materialising nothing silently', async () => {
    const report = await runOutreachActivation('co', 'L1', { persistence: portWith(null) as never });

    expect(report.planPresent).toBe(false);
    expect(report.blocked).toContain('no automationPlanning');
    expect(materializeCalls).toBe(0);
  });

  it('previewOnly dispatches nothing', async () => {
    tasksForLead = [task()];
    const report = await runOutreachActivation('co', 'L1', {
      previewOnly: true, persistence: portWith({ tasks: [] }) as never,
    });

    expect(report.dispatched).toBe(0);
    expect(dispatched).toHaveLength(0);
    expect(report.blocked).toContain('previewOnly');
  });

  it('surfaces the registered channels so an operator can see what is dispatchable', async () => {
    const report = await runOutreachActivation('co', 'L1', { persistence: portWith({ tasks: [] }) as never });
    expect(report.registeredChannels).toEqual(['internal', 'email']);
    expect(report.permittedChannels).toEqual(['internal']);
  });
});
