/**
 * WS-6C1 — Automation Runtime activation flags.
 *
 * Asserts the Tier-2 contract the Understanding subsystems already follow:
 * DEFAULT OFF, strict `'true'` comparison, and independence from the RBAC
 * capability strings that were previously mistaken for activation switches.
 */
import {
  isAutomationRuntimeEnabled,
  isAutomationRuntimeAuthoritative,
} from '../../services/automationExecution/flags';

const ENV_KEYS = ['AUTOMATION_RUNTIME_ENABLED', 'AUTOMATION_RUNTIME_AUTHORITATIVE'] as const;

describe('WS-6C1 — Automation Runtime activation flags', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // The property that makes this safe to merge: an unset environment must not
  // activate anything. A flipped default is the mutation this catches.
  it('DEFAULTS OFF when the environment is unset', () => {
    expect(isAutomationRuntimeEnabled()).toBe(false);
    expect(isAutomationRuntimeAuthoritative()).toBe(false);
  });

  it('activates only on the exact string "true"', () => {
    process.env.AUTOMATION_RUNTIME_ENABLED = 'true';
    expect(isAutomationRuntimeEnabled()).toBe(true);
  });

  // Guards against a loose truthiness check, which would let '1'/'yes'/'TRUE'
  // silently enable the runtime — the Tier-2 convention is strict equality.
  it.each(['1', 'yes', 'on', 'TRUE', 'True', '', 'false'])(
    'stays OFF for %p', (value) => {
      process.env.AUTOMATION_RUNTIME_ENABLED = value;
      expect(isAutomationRuntimeEnabled()).toBe(false);
    },
  );

  it('treats the two flags independently', () => {
    process.env.AUTOMATION_RUNTIME_ENABLED = 'true';
    expect(isAutomationRuntimeAuthoritative()).toBe(false);

    delete process.env.AUTOMATION_RUNTIME_ENABLED;
    process.env.AUTOMATION_RUNTIME_AUTHORITATIVE = 'true';
    expect(isAutomationRuntimeEnabled()).toBe(false);
    expect(isAutomationRuntimeAuthoritative()).toBe(true);
  });

  // The RBAC capabilities were previously mistaken for activation switches
  // (WS-6B). Setting them must have no effect on the runtime gate.
  it('is not influenced by the AUTOMATION_EXECUTE RBAC capabilities', () => {
    process.env.AUTOMATION_EXECUTE = 'true';
    process.env.AUTOMATION_EXECUTE_PROD = 'true';
    try {
      expect(isAutomationRuntimeEnabled()).toBe(false);
      expect(isAutomationRuntimeAuthoritative()).toBe(false);
    } finally {
      delete process.env.AUTOMATION_EXECUTE;
      delete process.env.AUTOMATION_EXECUTE_PROD;
    }
  });
});
