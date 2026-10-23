/**
 * OD-2 — the auth subsystem boot LIFECYCLE as scheduled by authResolver.
 *
 * WHAT WAS WRONG, stated so these tests are legible as regressions rather than
 * as a description of the current code. `scheduleAuthSubsystemBoot` used to be:
 *
 *   setImmediate(() => {
 *     authBootInFlight = import('../security/startup/authSubsystemBoot')
 *       .then(({ bootAuthSubsystem }) => bootAuthSubsystem())
 *       .catch(logWarn);
 *   });
 *
 * and the broad 72-suite run exited 1 with all 2490 assertions passing. The
 * mechanism: `import()` is evaluated SYNCHRONOUSLY inside the timer callback, so
 * once Jest tore the environment down that call threw a ReferenceError before
 * any promise existed — the `.catch` covered rejections of a promise that had
 * never been constructed, and the throw escaped a `setImmediate` callback as an
 * unhandled exception. The logged `bootAuthSubsystem is not a function` was the
 * same root cause at a different moment: a partially torn-down module registry
 * returning a degenerate namespace object. The export itself has always existed
 * (backend/security/startup/authSubsystemBoot.ts:154).
 *
 * WHAT IS ASSERTED HERE. The boot module owns run-once (it is single-flight
 * memoized internally), so these tests are about the RESOLVER's side: that it
 * schedules at most once, that the promise it tracks is observable the moment
 * scheduling returns rather than a tick later, that a rejection AND a
 * synchronous throw are both contained and logged, and that auth resolution
 * never depends on, waits for, or is failed by boot.
 *
 * NOT ASSERTED: anything about what bootAuthSubsystem itself does. That is
 * authSubsystemBoot.test.ts. Here it is a mock, deliberately, so the lifecycle
 * can be driven into failure modes a real boot never produces.
 */
const loggerWarn = jest.fn();
const loggerInfo = jest.fn();
const loggerError = jest.fn();
const loggerDebug = jest.fn();
jest.mock('../../services/logger', () => ({
  logger: { info: loggerInfo, warn: loggerWarn, error: loggerError, debug: loggerDebug },
}));

const bootMock = jest.fn();
jest.mock('../../security/startup/authSubsystemBoot', () => ({
  __esModule: true,
  bootAuthSubsystem: (...args: unknown[]) => bootMock(...args),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: () => { throw new Error('no database access in this suite'); } },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no database access in this suite'); },
}));

import type { NextApiRequest } from 'next';
import {
  resolveAuthenticatedUser,
  getAuthSubsystemBootPromise,
  resetAuthSubsystemBootSchedule,
} from '../../services/authResolver';

/**
 * A request carrying NO credential at all.
 *
 * Chosen on purpose: `scheduleAuthSubsystemBoot()` is the first statement of
 * `resolveAuthenticatedUser`, and token extraction fails immediately after it,
 * so the boot path is exercised in full while no database or identity provider
 * is touched. Both mocked data accessors throw if reached, which is what proves
 * that.
 */
const bareRequest = () => ({ headers: {}, cookies: {} }) as unknown as NextApiRequest;

beforeEach(() => {
  resetAuthSubsystemBootSchedule();
  bootMock.mockReset();
  loggerWarn.mockReset();
  loggerInfo.mockReset();
  loggerError.mockReset();
});

describe('authResolver — auth subsystem boot lifecycle (OD-2)', () => {
  it('a SUCCESSFUL boot: scheduled once, tracked, settles, nothing logged as a failure', async () => {
    bootMock.mockResolvedValue({ ready: true });

    const result = await resolveAuthenticatedUser(bareRequest());

    // auth resolution is unaffected and does not wait for boot
    expect(result).toEqual({ user: null, error: 'NO_TOKEN' });
    expect(bootMock).toHaveBeenCalledTimes(1);

    // OBSERVABLE IMMEDIATELY. Under the old shape this was null until the next
    // macrotask, because the assignment happened inside the timer — so the
    // promise was "tracked" in name only and nothing could await it.
    const tracked = getAuthSubsystemBootPromise();
    expect(tracked).not.toBeNull();
    await expect(tracked).resolves.toBeUndefined();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('a FAILED boot (rejection): contained, logged once, and auth resolution still succeeds', async () => {
    bootMock.mockRejectedValue(new Error('schema probe exploded'));

    const result = await resolveAuthenticatedUser(bareRequest());
    expect(result).toEqual({ user: null, error: 'NO_TOKEN' });

    // The tracked promise RESOLVES rather than rejecting — deliberately. No
    // caller is permitted to treat boot failure as fatal to auth resolution, so
    // the failure is recorded and absorbed. That is not converting failure into
    // success: nothing consumes a success value, and the warning is the signal.
    await expect(getAuthSubsystemBootPromise()).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith('auth_subsystem_boot_deferred_failed', {
      message: 'schema probe exploded',
    });
  });

  it('a SYNCHRONOUS throw from the boot call: contained, logged, and the promise still settles', async () => {
    // THE EXACT ESCAPE THAT MADE JEST EXIT 1. Under the old shape a synchronous
    // throw happened before any promise existed, inside a setImmediate
    // callback, so it escaped as an unhandled exception. Here it must be caught
    // by the surrounding try/catch, and an observer must not be left hanging on
    // a promise that was never assigned.
    bootMock.mockImplementation(() => { throw new Error('registry torn down'); });

    const result = await resolveAuthenticatedUser(bareRequest());
    expect(result).toEqual({ user: null, error: 'NO_TOKEN' });

    const tracked = getAuthSubsystemBootPromise();
    expect(tracked).not.toBeNull();
    await expect(tracked).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith('auth_subsystem_boot_deferred_failed', {
      message: 'registry torn down',
    });
  });

  it('a non-Error thrown value is still stringified rather than lost', async () => {
    bootMock.mockImplementation(() => { throw 'a bare string'; });
    await resolveAuthenticatedUser(bareRequest());
    expect(loggerWarn).toHaveBeenCalledWith('auth_subsystem_boot_deferred_failed', {
      message: 'a bare string',
    });
  });

  it('NO DUPLICATE BOOT: many resolver calls schedule exactly one', async () => {
    bootMock.mockResolvedValue({ ready: true });

    await resolveAuthenticatedUser(bareRequest());
    await resolveAuthenticatedUser(bareRequest());
    await Promise.all([
      resolveAuthenticatedUser(bareRequest()),
      resolveAuthenticatedUser(bareRequest()),
      resolveAuthenticatedUser(bareRequest()),
    ]);

    // One invocation from this module. The boot module is ALSO single-flight
    // internally, so run-once is owned there; this guard exists so the resolver
    // does not schedule repeatedly and create two memoizations that could race.
    expect(bootMock).toHaveBeenCalledTimes(1);
  });

  it('NOTHING IS LEFT PENDING once the resolver returns — the teardown path', async () => {
    // This is the property whose absence produced the nonzero exit. Previously
    // the work was queued on a timer that fired AFTER the caller finished, so a
    // test could complete, Jest could tear down, and the import would then run
    // against a dead registry. Now the promise exists and is settled by the
    // time the caller is done, so there is no window in which teardown can
    // overtake it.
    let settled = false;
    bootMock.mockImplementation(async () => { settled = true; return { ready: true }; });

    await resolveAuthenticatedUser(bareRequest());
    await getAuthSubsystemBootPromise();

    expect(settled).toBe(true);
    // and no timer is holding anything open: a further microtask drain changes
    // nothing and logs nothing.
    await Promise.resolve();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('the schedule RESET makes the path exercisable twice (test lifecycle)', async () => {
    bootMock.mockResolvedValue({ ready: true });

    await resolveAuthenticatedUser(bareRequest());
    expect(bootMock).toHaveBeenCalledTimes(1);

    // Without a reset the module-level guard is process-wide, so a second
    // scenario in any suite would silently assert nothing.
    expect(getAuthSubsystemBootPromise()).not.toBeNull();
    resetAuthSubsystemBootSchedule();
    expect(getAuthSubsystemBootPromise()).toBeNull();

    await resolveAuthenticatedUser(bareRequest());
    expect(bootMock).toHaveBeenCalledTimes(2);
  });

  it('boot is never awaited by auth resolution: a boot that never settles does not block', async () => {
    // Proves the fire-and-forget contract positively. If the resolver awaited
    // boot, this test would time out rather than pass.
    bootMock.mockImplementation(() => new Promise(() => { /* never settles */ }));

    const result = await resolveAuthenticatedUser(bareRequest());
    expect(result).toEqual({ user: null, error: 'NO_TOKEN' });
    expect(getAuthSubsystemBootPromise()).not.toBeNull();
  });
});
