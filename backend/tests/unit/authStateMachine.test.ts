/**
 * Pin every legal transition in the auth FSM, plus the no-op behavior
 * for illegal events. Race-condition-class regressions hit when
 * multiple events arrive in the same render tick; the FSM gives those
 * a deterministic outcome.
 */

import {
  initialAuthFsm,
  transitionAuthFsm,
  type AuthFsmEvent,
} from '../../../utils/authStateMachine';
import { AUTH_ERROR_CODE } from '../../../shared/contracts/security/AuthErrorCodes';

function fire(state: ReturnType<typeof initialAuthFsm>, events: AuthFsmEvent[]) {
  return events.reduce((acc, ev) => transitionAuthFsm(acc, ev).next, state);
}

describe('authStateMachine — legal transitions', () => {
  it('starts in initializing', () => {
    expect(initialAuthFsm().state).toBe('initializing');
  });

  it('initializing → authenticated on AUTH_SUCCESS', () => {
    const out = transitionAuthFsm(initialAuthFsm(), { type: 'AUTH_SUCCESS' });
    expect(out.next.state).toBe('authenticated');
    expect(out.next.retryAttempts).toBe(0);
    expect(out.changed).toBe(true);
  });

  it('initializing → signed_out on AUTH_FAIL_FATAL', () => {
    const out = transitionAuthFsm(initialAuthFsm(), { type: 'AUTH_FAIL_FATAL', code: AUTH_ERROR_CODE.INVALID_SESSION });
    expect(out.next.state).toBe('signed_out');
    expect(out.next.lastErrorCode).toBe(AUTH_ERROR_CODE.INVALID_SESSION);
  });

  it('initializing → degraded on AUTH_FAIL_RETRYABLE', () => {
    const out = transitionAuthFsm(initialAuthFsm(), { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.SCHEMA_MISMATCH });
    expect(out.next.state).toBe('degraded');
    expect(out.next.lastErrorCode).toBe(AUTH_ERROR_CODE.SCHEMA_MISMATCH);
  });

  it('degraded → retrying increments retryAttempts', () => {
    const next = fire(initialAuthFsm(), [
      { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED },
      { type: 'RETRY' },
    ]);
    expect(next.state).toBe('retrying');
    expect(next.retryAttempts).toBe(1);
  });

  it('retrying → degraded on AUTH_FAIL_RETRYABLE preserves retryAttempts', () => {
    const next = fire(initialAuthFsm(), [
      { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED },
      { type: 'RETRY' },
      { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED },
    ]);
    expect(next.state).toBe('degraded');
    expect(next.retryAttempts).toBe(1);
  });

  it('retrying → blocked on RETRY_EXHAUSTED', () => {
    const next = fire(initialAuthFsm(), [
      { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED },
      { type: 'RETRY' },
      { type: 'RETRY_EXHAUSTED' },
    ]);
    expect(next.state).toBe('blocked');
  });

  it('blocked → retrying on explicit RETRY (user click)', () => {
    const next = fire(initialAuthFsm(), [
      { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED },
      { type: 'RETRY' },
      { type: 'RETRY_EXHAUSTED' },
      { type: 'RETRY' },
    ]);
    expect(next.state).toBe('retrying');
    expect(next.retryAttempts).toBe(2);
  });

  it('any state → signed_out on SIGN_OUT', () => {
    const states = [
      initialAuthFsm(),
      fire(initialAuthFsm(), [{ type: 'AUTH_SUCCESS' }]),
      fire(initialAuthFsm(), [{ type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED }]),
      fire(initialAuthFsm(), [{ type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED }, { type: 'RETRY' }]),
    ];
    for (const start of states) {
      const out = transitionAuthFsm(start, { type: 'SIGN_OUT', reason: 'user' });
      expect(out.next.state).toBe('signed_out');
    }
  });

  it('retrying → authenticated on AUTH_SUCCESS resets retryAttempts', () => {
    const next = fire(initialAuthFsm(), [
      { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED },
      { type: 'RETRY' },
      { type: 'AUTH_SUCCESS' },
    ]);
    expect(next.state).toBe('authenticated');
    expect(next.retryAttempts).toBe(0);
    expect(next.lastErrorCode).toBeNull();
  });
});

describe('authStateMachine — OFFLINE/ONLINE decorations', () => {
  it('OFFLINE marks the context offline without changing state', () => {
    const after = fire(initialAuthFsm(), [
      { type: 'AUTH_SUCCESS' },
      { type: 'OFFLINE' },
    ]);
    expect(after.state).toBe('authenticated');
    expect(after.offline).toBe(true);
  });

  it('ONLINE clears the offline flag', () => {
    const after = fire(initialAuthFsm(), [
      { type: 'AUTH_SUCCESS' },
      { type: 'OFFLINE' },
      { type: 'ONLINE' },
    ]);
    expect(after.state).toBe('authenticated');
    expect(after.offline).toBe(false);
  });

  it('repeated OFFLINE is a no-op', () => {
    const start = fire(initialAuthFsm(), [{ type: 'AUTH_SUCCESS' }, { type: 'OFFLINE' }]);
    const after = transitionAuthFsm(start, { type: 'OFFLINE' });
    expect(after.changed).toBe(false);
    expect(after.next).toBe(start);
  });
});

describe('authStateMachine — illegal transitions are no-ops with metadata', () => {
  it('AUTH_FAIL_RETRYABLE from signed_out is a no-op', () => {
    const start = fire(initialAuthFsm(), [{ type: 'SIGN_OUT', reason: 'user' }]);
    const out = transitionAuthFsm(start, { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED });
    expect(out.changed).toBe(false);
    expect(out.illegal).toEqual({ event: 'AUTH_FAIL_RETRYABLE', fromState: 'signed_out' });
  });

  it('RETRY from authenticated is a no-op', () => {
    const start = fire(initialAuthFsm(), [{ type: 'AUTH_SUCCESS' }]);
    const out = transitionAuthFsm(start, { type: 'RETRY' });
    expect(out.changed).toBe(false);
    expect(out.illegal).toEqual({ event: 'RETRY', fromState: 'authenticated' });
  });

  it('RETRY_EXHAUSTED from degraded is a no-op (must enter retrying first)', () => {
    const start = fire(initialAuthFsm(), [{ type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED }]);
    const out = transitionAuthFsm(start, { type: 'RETRY_EXHAUSTED' });
    expect(out.changed).toBe(false);
    expect(out.illegal?.event).toBe('RETRY_EXHAUSTED');
  });
});

describe('authStateMachine — determinism under multi-event sequences', () => {
  it('two concurrent AUTH_SUCCESS events from initializing settle to authenticated exactly once', () => {
    const a = transitionAuthFsm(initialAuthFsm(), { type: 'AUTH_SUCCESS' });
    const b = transitionAuthFsm(a.next, { type: 'AUTH_SUCCESS' });
    expect(b.changed).toBe(false);
    expect(b.next.state).toBe('authenticated');
    expect(b.next.transitionCount).toBe(a.next.transitionCount);
  });

  it('SIGN_OUT during retrying takes precedence over any in-flight retry events', () => {
    const start = fire(initialAuthFsm(), [
      { type: 'AUTH_FAIL_RETRYABLE', code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED },
      { type: 'RETRY' },
    ]);
    const afterSignOut = transitionAuthFsm(start, { type: 'SIGN_OUT', reason: 'user' });
    expect(afterSignOut.next.state).toBe('signed_out');
    // Subsequent late-arriving retry event must NOT pull us back.
    const stillSignedOut = transitionAuthFsm(afterSignOut.next, { type: 'RETRY_EXHAUSTED' });
    expect(stillSignedOut.next.state).toBe('signed_out');
  });
});
