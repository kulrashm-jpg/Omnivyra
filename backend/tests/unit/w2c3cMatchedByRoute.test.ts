/**
 * PHASE 4C-3C — the `check_suppression` route passes `matchedBy` through, and
 * adds nothing of its own.
 *
 * The route returns the service result verbatim (`execution.ts`), so this suite
 * mocks the service and asserts the ROUTE's behaviour: the field appears exactly
 * when the service supplies it, is absent when it does not, and the route never
 * introduces an identity, `decision` or `failClosed` field — nor echoes the
 * target it was given.
 */
import { seed, invoke, CO_A } from '../helpers/routeAuthHarness';
import { bearer, USER_DUAL } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());

const sinks = {
  isSuppressed: jest.fn(async () => ({ suppressed: false }) as unknown),
  addSuppression: jest.fn(async () => ({ id: 'se-1', canonicalId: 'cg-1', legacyRecorded: true, legacyError: null, complete: true }) as unknown),
  releaseSuppression: jest.fn(async () => ({ canonicalRevoked: 1, legacyDeactivated: true, legacyError: null, complete: true }) as unknown),
};
jest.mock('../../services/execution/suppressionService', () => ({
  isSuppressed: (...a: unknown[]) => (sinks.isSuppressed as any)(...a),
  addSuppression: (...a: unknown[]) => (sinks.addSuppression as any)(...a),
  releaseSuppression: (...a: unknown[]) => (sinks.releaseSuppression as any)(...a),
}));
jest.mock('../../services/execution/executionAuditService', () => ({ recordExecutionAudit: jest.fn(async () => undefined) }));
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
    user_company_roles: [{ user_id: USER_DUAL, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' }],
  });
  Object.values(sinks).forEach((s) => s.mockClear());
});

const check = () => invoke(execution, {
  method: 'POST',
  body: { company_id: CO_A, action: 'check_suppression', target: TARGET, channel: 'email' },
  headers: bearer('DUAL'),
});

describe('4C-3C route — check_suppression', () => {
  it('1. passes `matchedBy` through when the service supplies it', async () => {
    sinks.isSuppressed.mockResolvedValue({
      suppressed: true, reason: 'unsubscribe', scope: 'person', store: 'canonical',
      matchedBy: 'person', scopesEvaluated: ['canonical.person', 'canonical.target'],
    } as unknown);

    const r = await check();

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ suppressed: true, store: 'canonical', matchedBy: 'person' });
  });

  it('2. omits it when the service omits it — the route invents nothing', async () => {
    sinks.isSuppressed.mockResolvedValue({
      suppressed: true, reason: 'manual', scope: 'tenant', store: 'legacy',
    } as unknown);

    const r = await check();

    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('matchedBy');
    expect(r.body).toMatchObject({ scope: 'tenant', store: 'legacy' });
  });

  it('3. a fail-closed result passes through with no diagnostics bolted on', async () => {
    sinks.isSuppressed.mockResolvedValue({
      suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical',
    } as unknown);

    const r = await check();

    expect(r.body).toEqual({ suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
  });

  it('4. the route adds no identity, `decision` or `failClosed` field', async () => {
    sinks.isSuppressed.mockResolvedValue({
      suppressed: true, reason: 'unsubscribe', scope: 'target', store: 'canonical', matchedBy: 'target',
    } as unknown);

    const r = await check();

    for (const forbidden of ['identity', 'decision', 'failClosed']) {
      expect(r.body).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(r.body as Record<string, unknown>).sort())
      .toEqual(['matchedBy', 'reason', 'scope', 'store', 'suppressed']);
  });

  it('5. the response never echoes the submitted target back', async () => {
    sinks.isSuppressed.mockResolvedValue({
      suppressed: true, reason: 'unsubscribe', scope: 'target', store: 'canonical', matchedBy: 'target',
    } as unknown);

    const r = await check();

    expect(JSON.stringify(r.body)).not.toContain(TARGET);
  });

  it('6. inputs, status code and authorization are unchanged', async () => {
    const r = await check();

    expect(r.status).toBe(200);
    // The service is still called with (companyId, channel, target), in order.
    expect(sinks.isSuppressed).toHaveBeenCalledWith(CO_A, 'email', TARGET);

    // Unauthenticated still refused before the service is reached.
    sinks.isSuppressed.mockClear();
    const anon = await invoke(execution, {
      method: 'POST',
      body: { company_id: CO_A, action: 'check_suppression', target: TARGET },
      headers: {},
    });
    expect(anon.status).toBe(401);
    expect(sinks.isSuppressed).not.toHaveBeenCalled();
  });
});
