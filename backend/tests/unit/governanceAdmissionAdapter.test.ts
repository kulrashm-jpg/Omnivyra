/**
 * RELEASE-R3D — Governance Admission Adapter + Consumer Abstraction tests.
 *
 * Proves the optional consumer stack's contract WITHOUT spawning the real
 * (~40 s) runtime: the low-level transport is injected, so the abstraction,
 * adapter policy, feature-flag gating, diagnostics, and compatibility gate are
 * all exercised deterministically. Governance logic is never mocked — only the
 * published-entrypoint transport.
 *
 * Covered:
 *   - OFF by default → bypass, runtime NOT invoked, standard requests untouched.
 *   - enforce + non-designated → bypass (zero impact on standard AI requests).
 *   - enforce + designated + Admitted → admitted.
 *   - enforce + designated + Rejected → blocked (fail-closed throw).
 *   - enforce + designated + invocation error → fail-closed.
 *   - shadow + designated + Rejected → never blocks (observe only).
 *   - compatibility gate against the published VERSION.json.
 *   - diagnostics/observability rollup is machine-readable.
 */
import type { RuntimeInvoker } from '../../services/governance';
import {
  evaluateAdmission,
  enforceAdmission,
  GovernanceAdmissionDenied,
  checkCompatibility,
  getGovernanceObservabilitySnapshot,
  resetGovernanceDiagnostics,
  describeGovernanceFlagState,
  CONSUMER_VERSION,
} from '../../services/governance';

const DESIGNATED = 'governance.admission.selfTest';
const MODE_ENV = 'ROLLOUT_GOVERNANCE_ADMISSION_MODE';

function stubInvoker(decision: 'Admitted' | 'Rejected' | 'Deferred'): { invoker: RuntimeInvoker; calls: number[] } {
  const calls: number[] = [];
  const invoker: RuntimeInvoker = async () => {
    calls.push(1);
    return {
      stdout: JSON.stringify({
        runtimeVersion: '1.0.0',
        admissionDecision: {
          gatewayDecision: decision,
          entersPipeline: decision === 'Admitted',
          reason: decision === 'Admitted' ? null : 'inactive-constitution',
          admissionId: 'ADM-Gen3-testc0de',
        },
      }),
      stderr: '',
    };
  };
  return { invoker, calls };
}

const throwingInvoker: RuntimeInvoker = async () => {
  const e = new Error('boom') as Error & { killed?: boolean };
  e.killed = true; // simulate timeout
  throw e;
};

describe('Governance Admission Adapter (RELEASE-R3D)', () => {
  const prev = process.env[MODE_ENV];
  beforeEach(() => { resetGovernanceDiagnostics(); delete process.env[MODE_ENV]; });
  afterAll(() => { if (prev === undefined) delete process.env[MODE_ENV]; else process.env[MODE_ENV] = prev; });

  it('is OFF by default: bypasses without invoking the runtime', async () => {
    const { invoker, calls } = stubInvoker('Admitted');
    const r = await evaluateAdmission({ operation: DESIGNATED, invokeOptions: { invoker } });
    expect(r.mode).toBe('off');
    expect(r.admitted).toBe(true);
    expect(r.disposition).toBe('bypass');
    expect(calls).toHaveLength(0); // runtime never invoked
  });

  it('enforce + non-designated op bypasses (zero impact on standard AI requests)', async () => {
    process.env[MODE_ENV] = 'enforce';
    const { invoker, calls } = stubInvoker('Rejected');
    const r = await evaluateAdmission({ operation: 'blog.generate', invokeOptions: { invoker } });
    expect(r.admitted).toBe(true);
    expect(r.disposition).toBe('not-designated');
    expect(calls).toHaveLength(0);
  });

  it('enforce + designated + Admitted → admitted', async () => {
    process.env[MODE_ENV] = 'enforce';
    const { invoker, calls } = stubInvoker('Admitted');
    const r = await evaluateAdmission({ operation: DESIGNATED, invokeOptions: { invoker, retries: 0 } });
    expect(r.admitted).toBe(true);
    expect(r.disposition).toBe('admitted');
    expect(r.runtimeDecision).toBe('Admitted');
    expect(calls).toHaveLength(1);
  });

  it('enforce + designated + Rejected → fail-closed (enforceAdmission throws)', async () => {
    process.env[MODE_ENV] = 'enforce';
    const { invoker } = stubInvoker('Rejected');
    await expect(
      enforceAdmission({ operation: DESIGNATED, invokeOptions: { invoker, retries: 0 } }),
    ).rejects.toBeInstanceOf(GovernanceAdmissionDenied);
  });

  it('enforce + designated + invocation error → fail-closed (blocked)', async () => {
    process.env[MODE_ENV] = 'enforce';
    const r = await evaluateAdmission({
      operation: DESIGNATED,
      invokeOptions: { invoker: throwingInvoker, retries: 0 },
    });
    expect(r.admitted).toBe(false);
    expect(r.disposition).toBe('blocked');
    expect(r.diagnostic.errorCode).toBe('GOV_CONSUMER_TIMEOUT');
  });

  it('shadow + designated + Rejected → never blocks (observe only)', async () => {
    process.env[MODE_ENV] = 'shadow';
    const { invoker, calls } = stubInvoker('Rejected');
    const r = await evaluateAdmission({ operation: DESIGNATED, invokeOptions: { invoker, retries: 0 } });
    expect(r.mode).toBe('shadow');
    expect(r.admitted).toBe(true); // shadow never blocks
    expect(r.disposition).toBe('shadow-observed');
    expect(r.runtimeDecision).toBe('Rejected');
    expect(calls).toHaveLength(1);
  });

  it('verifies compatibility against the published VERSION.json', () => {
    const c = checkCompatibility();
    expect(c.runtimeVersion).toBe('1.0.0');
    expect(c.releaseDigest).toBe('4903e8fb');
    expect(c.compatible).toBe(true);
    expect(c.reasons).toHaveLength(0);
  });

  it('exposes machine-readable diagnostics + flag state', async () => {
    process.env[MODE_ENV] = 'enforce';
    const { invoker } = stubInvoker('Admitted');
    await evaluateAdmission({ operation: DESIGNATED, invokeOptions: { invoker, retries: 0 } });
    const snap = getGovernanceObservabilitySnapshot(CONSUMER_VERSION);
    expect(snap.invocationCount).toBe(1);
    expect(snap.admittedCount).toBe(1);
    expect(snap.successRatio).toBe(1);
    expect(snap.health).toBe('healthy');

    const flag = describeGovernanceFlagState();
    expect(flag.key).toBe('governance-admission');
    expect(flag.enforcing).toBe(true);
    expect(flag.designatedOperations).toContain(DESIGNATED);
  });
});
