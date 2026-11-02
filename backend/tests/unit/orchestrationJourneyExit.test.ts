/**
 * A run goes terminal only once its unsent tasks are confirmed withdrawn. Faults a real
 * database will not produce on request, so the stores are replaced here; the real path
 * is proven in realschema/orch_contract_journey.test.ts.
 */
const mockCancel = jest.fn(async () => 2);
const mockHandoffs = jest.fn();
const mockGet = jest.fn();
const mockTransition = jest.fn();
const mockRequests = { data: [] as unknown[], error: null as unknown };
const mockWithdrawn = { data: [{ id: 'r' }] as unknown[], error: null as unknown };
const mockUpdate = jest.fn();

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    select: () => ({ eq: () => ({ eq: async () => mockRequests }) }),
    update: (patch: unknown) => { mockUpdate(patch); return { eq: () => ({ eq: () => ({ eq: () => ({ select: async () => mockWithdrawn }) }) }) }; },
  }),
}));
jest.mock('../../services/workflowExecution/stepProgressionStore', () => ({ cancelExecutionRun: mockCancel }));
jest.mock('../../services/outreachBridge/outreachBridgeStore', () => ({ listInstanceHandoffs: mockHandoffs }));
jest.mock('../../services/leadOutreachExecution', () => ({ getOutreachTaskById: mockGet, transitionOutreachTaskState: mockTransition }));

import { exitJourney, withdrawStepAction, withdrawUnsentTasks } from '../../services/orchestration/journeyExit';

const ORG = '00000000-0000-4000-8000-00000000000a';

beforeEach(() => {
  jest.clearAllMocks();
  mockRequests.data = []; mockRequests.error = null;
  mockWithdrawn.data = [{ id: 'r' }]; mockWithdrawn.error = null;
  mockHandoffs.mockResolvedValue([{ outreachTaskId: 't1', executionTaskId: 'other' }]);
});

describe('exitJourney', () => {
  it('an unreadable task leaves the run open, so the sweep can try again', async () => {
    mockGet.mockResolvedValue(null);
    await expect(exitJourney(ORG, 'run')).rejects.toMatchObject({ code: 'withdrawal_incomplete' });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('a withdrawal that keeps failing leaves the run open', async () => {
    mockGet.mockResolvedValue({ status: 'awaiting_approval' });
    mockTransition.mockResolvedValue({ ok: false, changed: false });
    await expect(exitJourney(ORG, 'run')).rejects.toMatchObject({ code: 'withdrawal_incomplete' });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('losing a race re-reads and withdraws from the new status', async () => {
    mockGet.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce({ status: 'awaiting_approval' }).mockResolvedValue({ status: 'cancelled' });
    mockTransition.mockResolvedValueOnce({ ok: true, changed: false }).mockResolvedValueOnce({ ok: true, changed: true });
    await expect(exitJourney(ORG, 'run')).resolves.toBe(2);
    expect(mockTransition).toHaveBeenLastCalledWith(ORG, 't1', 'awaiting_approval', 'cancelled');
  });

  it('withdraws again after the run ends, catching a task bridged meanwhile', async () => {
    mockGet.mockResolvedValue({ status: 'cancelled' });
    await exitJourney(ORG, 'run');
    expect(mockHandoffs).toHaveBeenCalledTimes(2);
    expect(mockHandoffs.mock.invocationCallOrder[0]).toBeLessThan(mockCancel.mock.invocationCallOrder[0]!);
    expect(mockHandoffs.mock.invocationCallOrder[1]).toBeGreaterThan(mockCancel.mock.invocationCallOrder[0]!);
  });

  it('a task already sending is left to its engine', async () => {
    mockGet.mockResolvedValue({ status: 'dispatching' });
    await expect(withdrawUnsentTasks(ORG, 'run')).resolves.toBeUndefined();
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('withdrawStepAction', () => {
  it('any engine request except a skipped one means the engine holds it', async () => {
    mockRequests.data = [{ state: 'failed' }];
    await expect(withdrawStepAction(ORG, 'run', 'task')).resolves.toBe('engine_holds');
    mockRequests.data = [{ state: 'skipped' }];
    await expect(withdrawStepAction(ORG, 'run', 'task')).resolves.toBe('none');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('a requested row holds nothing: it is withdrawn, so the adapter is not asked to act', async () => {
    mockRequests.data = [{ state: 'requested' }];
    await expect(withdrawStepAction(ORG, 'run', 'task')).resolves.toBe('none');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'skipped' }));
  });

  it('losing that race to a concurrent claim means the engine holds it', async () => {
    mockRequests.data = [{ state: 'requested' }];
    mockWithdrawn.data = [];
    await expect(withdrawStepAction(ORG, 'run', 'task')).resolves.toBe('engine_holds');
  });

  it('a failed write decides nothing', async () => {
    mockRequests.data = [{ state: 'requested' }];
    mockWithdrawn.error = { message: 'down' };
    await expect(withdrawStepAction(ORG, 'run', 'task')).rejects.toMatchObject({ code: 'withdrawal_incomplete' });
  });

  it('an unreadable request ledger decides nothing', async () => {
    mockRequests.error = { message: 'down' };
    await expect(withdrawStepAction(ORG, 'run', 'task')).rejects.toMatchObject({ code: 'withdrawal_incomplete' });
  });

  it('a sent WS-3 task means the engine holds it; an unsent one is withdrawn', async () => {
    mockHandoffs.mockResolvedValue([{ outreachTaskId: 'other', executionTaskId: 'x' }, { outreachTaskId: 't1', executionTaskId: 'task' }]);
    mockGet.mockResolvedValueOnce({ status: 'sent' });
    await expect(withdrawStepAction(ORG, 'run', 'task')).resolves.toBe('engine_holds');
    mockGet.mockResolvedValueOnce({ status: 'approved' });
    mockTransition.mockResolvedValueOnce({ ok: true, changed: true });
    await expect(withdrawStepAction(ORG, 'run', 'task')).resolves.toBe('none');
  });
});
