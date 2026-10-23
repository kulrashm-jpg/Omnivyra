/**
 * W2-B / D-5 — the operator route tells the truth about a partial store write.
 *
 * W2-A C-3: `releaseSuppression` discarded the legacy update result, so a
 * release that revoked the canonical record but failed to deactivate the legacy
 * row answered `200 { ok: true }` AND wrote an audit row asserting `cancelled`
 * — while the target was in fact still suppressed by the surviving legacy row.
 * An operator reading either the response or the audit would conclude the
 * person had been released.
 *
 * The service layer is a spy here: this suite is about what the ROUTE reports,
 * given each result the service can legitimately return. The service's own
 * behaviour is pinned in `w2bSuppressionCorrectness.test.ts`.
 */
import { seed, invoke, CO_A } from '../helpers/routeAuthHarness';
import { bearer, USER_DUAL } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

const COMPLETE_RELEASE = { canonicalRevoked: 1, legacyDeactivated: true, legacyOutcome: 'deactivated', legacyError: null, complete: true };
const PARTIAL_RELEASE = { canonicalRevoked: 1, legacyDeactivated: false, legacyOutcome: 'failed', legacyError: 'legacy_release_failed:08006', complete: false };
const COMPLETE_ADD = { id: 'se-1', canonicalId: 'cg-1', legacyRecorded: true, legacyError: null, complete: true };
const PARTIAL_ADD = { id: null, canonicalId: 'cg-1', legacyRecorded: false, legacyError: 'legacy_write_failed:08006', complete: false };

const sinks = {
  releaseSuppression: jest.fn(async () => COMPLETE_RELEASE as unknown),
  addSuppression: jest.fn(async () => COMPLETE_ADD as unknown),
  isSuppressed: jest.fn(async () => ({ suppressed: false })),
  recordExecutionAudit: jest.fn(async (..._a: unknown[]) => undefined),
};
jest.mock('../../services/execution/suppressionService', () => {
  // DR-3 — the route now validates the operator-supplied reason before calling
  // the service, so this double must expose the REAL vocabulary and guard.
  // Stubbing them would leave the validation untested, and hard-coding the list
  // here would let the double drift from the service it stands in for.
  const actual = jest.requireActual('../../services/execution/suppressionService') as Record<string, unknown>;
  return {
    SUPPRESSION_REASONS: actual.SUPPRESSION_REASONS,
    isSuppressionReason: actual.isSuppressionReason,
    releaseSuppression: (...a: unknown[]) => (sinks.releaseSuppression as any)(...a),
    addSuppression: (...a: unknown[]) => (sinks.addSuppression as any)(...a),
    isSuppressed: (...a: unknown[]) => (sinks.isSuppressed as any)(...a),
  };
});
jest.mock('../../services/execution/executionAuditService', () => ({
  recordExecutionAudit: (...a: unknown[]) => (sinks.recordExecutionAudit as any)(...a),
}));
jest.mock('../../services/execution/executionControlService', () => ({
  setControl: jest.fn(async () => undefined),
  killSwitch: jest.fn(async () => undefined),
  isExecutionEnabled: jest.fn(async () => false),
}));
jest.mock('../../services/execution/executionApprovalService', () => ({
  recordApproval: jest.fn(async () => ({ id: 'appr-1' })),
  revokeApproval: jest.fn(async () => undefined),
}));
jest.mock('../../services/execution/executionBridge', () => ({
  dispatchGuarded: jest.fn(async () => ({ dispatched: false })),
  previewDispatch: jest.fn(() => ({ ok: true })),
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const execution = require('../../../pages/api/lead-intelligence/execution').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const TARGET = 'person@example.test';

beforeEach(() => {
  seed({
    user_company_roles: [
      { user_id: USER_DUAL, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
    ],
  });
  Object.values(sinks).forEach((s) => s.mockClear());
  sinks.releaseSuppression.mockResolvedValue(COMPLETE_RELEASE as unknown);
  sinks.addSuppression.mockResolvedValue(COMPLETE_ADD as unknown);
});

const post = (body: Record<string, unknown>) =>
  invoke(execution, { method: 'POST', body: { company_id: CO_A, ...body }, headers: bearer('DUAL') });

const audit = () => sinks.recordExecutionAudit.mock.calls.map((c) => c[0] as Record<string, unknown>);

describe('W2-B/D-5 — release', () => {
  it('1. a COMPLETE release answers 200 and records `cancelled`', async () => {
    const r = await post({ action: 'release', target: TARGET, channel: 'email' });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, complete: true, canonicalRevoked: 1 });
    expect(audit()[0]).toMatchObject({
      stage: 'suppression', decision: 'cancelled', reason: 'suppression_released',
    });
  });

  it('2. a PARTIAL release does NOT answer success', async () => {
    sinks.releaseSuppression.mockResolvedValue(PARTIAL_RELEASE as unknown);

    const r = await post({ action: 'release', target: TARGET, channel: 'email' });

    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({
      error: 'suppression_release_incomplete',
      canonicalRevoked: 1,
      legacyDeactivated: false,
      legacyError: 'legacy_release_failed:08006',
    });
    expect(r.body).not.toHaveProperty('ok', true);
  });

  it('3. a PARTIAL release does NOT write an audit row asserting a completed release', async () => {
    sinks.releaseSuppression.mockResolvedValue(PARTIAL_RELEASE as unknown);

    await post({ action: 'release', target: TARGET, channel: 'email' });

    const row = audit()[0];
    expect(row.decision).not.toBe('cancelled');
    expect(row).toMatchObject({
      stage: 'suppression',
      decision: 'suppressed',                    // the target REMAINS suppressed
      reason: 'suppression_release_incomplete',
    });
    expect(row.evidence).toMatchObject({ legacy_deactivated: false, canonical_revoked: 1 });
  });

  it('4. the partial-release audit still names the tenant and the channel', async () => {
    sinks.releaseSuppression.mockResolvedValue(PARTIAL_RELEASE as unknown);

    await post({ action: 'release', target: TARGET, channel: 'email' });

    expect(audit()[0]).toMatchObject({ companyId: CO_A, channel: 'email' });
  });

  it('4b. R2 — an UNCONFIRMED release (zero rows) answers 200 but never `complete: true`', async () => {
    sinks.releaseSuppression.mockResolvedValue({
      canonicalRevoked: 1, legacyDeactivated: false, legacyOutcome: 'no_match', legacyError: null, complete: false,
    } as unknown);

    const r = await post({ action: 'release', target: TARGET, channel: 'email' });

    // NOT a 500: a replayed release, and a channel-exact release that correctly
    // matched a `'*'` row, are legitimate no-ops — failing them would turn
    // correct behaviour into an error.
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, complete: false, legacyOutcome: 'no_match' });
    expect(r.body).not.toHaveProperty('complete', true);

    // ...and the audit does not assert a completed release.
    const row = audit()[0];
    expect(row.decision).not.toBe('cancelled');
    expect(row).toMatchObject({ decision: 'suppressed', reason: 'suppression_release_unconfirmed' });
    expect(row.evidence).toMatchObject({ legacy_outcome: 'no_match', legacy_deactivated: false });
  });

  it('5. a malformed/absent result is treated as INCOMPLETE, never as success', async () => {
    // Defensive: a caller must never read "released" out of a missing answer.
    sinks.releaseSuppression.mockResolvedValue(undefined as unknown);

    const r = await post({ action: 'release', target: TARGET, channel: 'email' });

    expect(r.status).toBe(500);
    expect(String(r.body?.error)).toBe('suppression_release_incomplete');
  });
});

describe('W2-B/D-5 — suppress', () => {
  it('6. a COMPLETE write answers 201 and says so', async () => {
    const r = await post({ action: 'suppress', target: TARGET, channel: 'email', reason: 'manual' });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, complete: true });
  });

  it('7. a PARTIAL write is still 201 — the restriction IS in force — but never "complete"', async () => {
    sinks.addSuppression.mockResolvedValue(PARTIAL_ADD as unknown);

    const r = await post({ action: 'suppress', target: TARGET, channel: 'email', reason: 'manual' });

    // The canonical store holds the instruction and answers first, so the person
    // IS protected: reporting a failure here would invite an operator to retry a
    // suppression that already works. What must not happen is claiming the
    // operation completed.
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      ok: true,
      complete: false,
      canonicalRecorded: true,
      legacyRecorded: false,
      legacyError: 'legacy_write_failed:08006',
    });
  });

  it('8. neither response ever echoes the recipient back', async () => {
    sinks.addSuppression.mockResolvedValue(PARTIAL_ADD as unknown);
    const added = await post({ action: 'suppress', target: TARGET, channel: 'email' });
    sinks.releaseSuppression.mockResolvedValue(PARTIAL_RELEASE as unknown);
    const released = await post({ action: 'release', target: TARGET, channel: 'email' });

    expect(JSON.stringify(added.body)).not.toContain(TARGET);
    expect(JSON.stringify(released.body)).not.toContain(TARGET);
  });
});

/**
 * DR-3 — the operator-supplied reason is client input.
 *
 * It used to be forwarded unchecked, so ANY string fell through
 * `toGovernanceType`'s `default:` branch and was recorded as a do-not-contact —
 * and because the canonical write precedes the legacy mirror, the result was a
 * canonical DNC whose mirror the `suppression_reason_check` CHECK then rejected.
 * A half-written restriction with an uninterpretable cause.
 */
describe('DR-3 — operator reason validation', () => {
  it('9. an UNSUPPORTED reason is a 400 and writes nothing', async () => {
    const r = await post({ action: 'suppress', target: TARGET, channel: 'email', reason: 'because-i-said-so' });

    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toBe('unsupported_reason');
    // The decisive assertion: the service was never reached, so no DNC exists.
    expect(sinks.addSuppression).not.toHaveBeenCalled();
  });

  it('10. the rejection tells the operator what IS allowed', async () => {
    const r = await post({ action: 'suppress', target: TARGET, channel: 'email', reason: 'nope' });

    expect(r.body?.allowed).toEqual(expect.arrayContaining(['unsubscribe', 'manual', 'bounce', 'complaint']));
    // ...and never leaks the recipient while doing so.
    expect(JSON.stringify(r.body)).not.toContain(TARGET);
  });

  it('11. every SUPPORTED reason still passes through untouched', async () => {
    for (const reason of ['unsubscribe', 'consent_withdrawn', 'dsar', 'legal_hold', 'bounce', 'complaint', 'manual']) {
      sinks.addSuppression.mockClear();
      const r = await post({ action: 'suppress', target: TARGET, channel: 'email', reason });

      expect(r.status).toBe(201);
      expect(sinks.addSuppression).toHaveBeenCalledWith(expect.objectContaining({ reason }));
    }
  });

  it('12. an OMITTED reason still defaults to `manual` — unchanged behaviour', async () => {
    sinks.addSuppression.mockClear();
    const r = await post({ action: 'suppress', target: TARGET, channel: 'email' });

    expect(r.status).toBe(201);
    expect(sinks.addSuppression).toHaveBeenCalledWith(expect.objectContaining({ reason: 'manual' }));
  });
});
