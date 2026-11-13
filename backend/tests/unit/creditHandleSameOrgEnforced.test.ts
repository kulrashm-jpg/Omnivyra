/**
 * e1 2026-11-13 (05): the credit handle's same-org property is ENFORCED. Nesting a handle for a DIFFERENT
 * organization inside a billed execution is refused (it would rebind which org the inner AI calls are billed to);
 * a same-org nested handle (an adopter's own wrap inside the engine's) is allowed.
 */
import { runWithCreditHandle, getActiveCreditHandle, CreditHandleOrgConflictError } from '../../services/billing/aiGatewayBillingGuard';

const h = (orgId: string) => ({ operationId: 'op', idempotencyKey: 'k', orgId, action: 'content_basic', source: 'orchestrator' as const });

it('a nested handle for ANOTHER org is refused - the outer billing org is never rebound', () => {
  expect(() => runWithCreditHandle(h('org-A'), () => runWithCreditHandle(h('org-B'), () => 'never'))).toThrow(CreditHandleOrgConflictError);
});

it('a nested handle for the SAME org is allowed (the inner handle is active inside it)', () => {
  const seen = runWithCreditHandle(h('org-A'), () => runWithCreditHandle({ ...h('org-A'), operationId: 'inner' }, () => getActiveCreditHandle()));
  expect(seen).toMatchObject({ orgId: 'org-A', operationId: 'inner' });
});

it('control: a top-level handle needs no outer one', () => {
  expect(runWithCreditHandle(h('org-B'), () => getActiveCreditHandle()?.orgId)).toBe('org-B');
  expect(getActiveCreditHandle()).toBeUndefined();
});
