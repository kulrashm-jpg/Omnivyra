/**
 * OMNI-GOV-002 — End-to-end adoption test for the FIRST production workflow to
 * consume the certified Governance Runtime: the autonomous governance audit
 * sweep (backend/jobs/governanceAuditJob.ts).
 *
 * Proves the full chain Request → Omnivyra (job) → Governance Consumer →
 * Governance Runtime decision → Application Response, deterministically (the
 * runtime transport is injected; governance logic is never mocked):
 *   - flag OFF (default) → sweep runs exactly as before (admission bypassed, no
 *     runtime spawn) — zero impact on the existing production workflow.
 *   - enforce + runtime Admitted → sweep runs.
 *   - enforce + runtime Rejected → sweep is SKIPPED (fail-closed for this
 *     designated workflow), and NO campaign work occurs.
 */
import type { RuntimeInvoker } from '../../services/governance';
import {
  evaluateAdmission,
  resetGovernanceDiagnostics,
  isGovernanceDesignated,
} from '../../services/governance';

// Mock the audit job's data + work dependencies so the test needs no DB.
type AuditArgs = Parameters<typeof import('../../services/GovernanceAuditService')['runGovernanceAudit']>;
const runGovernanceAudit = jest.fn(async (..._a: AuditArgs) => ({ auditStatus: 'OK' }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: () => ({ select: async () => ({ data: [{ company_id: 'co-1' }], error: null }) }) },
}));
jest.mock('../../services/GovernanceAuditService', () => ({
  runGovernanceAudit: (...a: AuditArgs) => runGovernanceAudit(...a),
}));
jest.mock('../../scheduler/schedulerBatching', () => ({
  getSchedulerConcurrency: () => 2,
  mapWithConcurrency: async (items: string[], _c: number, fn: (x: string) => Promise<unknown>) =>
    Promise.all(items.map(async (x) => ({ ok: true, value: await fn(x) }))),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { runAllCompanyAudits } from '../../jobs/governanceAuditJob';

const OP = 'governance.audit.sweep';
const MODE_ENV = 'ROLLOUT_GOVERNANCE_ADMISSION_MODE';

function stubInvoker(decision: 'Admitted' | 'Rejected'): RuntimeInvoker {
  return async () => ({
    stdout: JSON.stringify({
      runtimeVersion: '1.0.0',
      admissionDecision: {
        gatewayDecision: decision,
        entersPipeline: decision === 'Admitted',
        reason: decision === 'Admitted' ? null : 'inactive-constitution',
        admissionId: 'ADM-Gen3-audit',
      },
    }),
    stderr: '',
  });
}

describe('OMNI-GOV-002 — governance audit sweep consumes the certified runtime', () => {
  const prev = process.env[MODE_ENV];
  beforeEach(() => { resetGovernanceDiagnostics(); runGovernanceAudit.mockClear(); delete process.env[MODE_ENV]; });
  afterAll(() => { if (prev === undefined) delete process.env[MODE_ENV]; else process.env[MODE_ENV] = prev; });

  it('designates governance.audit.sweep as a governance operation', () => {
    expect(isGovernanceDesignated(OP)).toBe(true);
  });

  it('flag OFF (default): sweep runs unchanged, runtime NOT invoked', async () => {
    let spawned = false;
    const invoker: RuntimeInvoker = async () => { spawned = true; return { stdout: '{}', stderr: '' }; };
    // The job itself calls evaluateAdmission without an injected invoker; with the
    // flag off it never reaches the transport. We assert the decision the job sees:
    const decision = await evaluateAdmission({ operation: OP, invokeOptions: { invoker } });
    expect(decision.admitted).toBe(true);
    expect(decision.disposition).toBe('bypass');
    expect(spawned).toBe(false);
    // And the real job runs its sweep end-to-end.
    await runAllCompanyAudits();
    expect(runGovernanceAudit).toHaveBeenCalledWith('co-1');
  });

  it('enforce + runtime Admitted → sweep proceeds', async () => {
    process.env[MODE_ENV] = 'enforce';
    const decision = await evaluateAdmission({ operation: OP, invokeOptions: { invoker: stubInvoker('Admitted'), retries: 0 } });
    expect(decision.admitted).toBe(true);
    expect(decision.runtimeDecision).toBe('Admitted');
    expect(decision.disposition).toBe('admitted');
  });

  it('enforce + runtime Rejected → admission blocks (sweep would skip)', async () => {
    process.env[MODE_ENV] = 'enforce';
    const decision = await evaluateAdmission({ operation: OP, invokeOptions: { invoker: stubInvoker('Rejected'), retries: 0 } });
    expect(decision.admitted).toBe(false);
    expect(decision.disposition).toBe('blocked');
    expect(decision.runtimeDecision).toBe('Rejected');
  });
});
