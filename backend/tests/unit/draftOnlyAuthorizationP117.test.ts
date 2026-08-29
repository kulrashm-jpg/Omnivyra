/**
 * PHASE 117 — draft-only execution is an OPERATOR capability.
 *
 * The dangerous failure here is not a missing 403. It is the opposite: a caller
 * who asks for a dry run, is not authorized, and gets a REAL release that
 * publishes to a live audience. Silently ignoring the flag would produce exactly
 * that, so an unauthorized request is refused outright and the scheduler is
 * never reached.
 *
 * AUTOMATION_EXECUTE_PROD is granted to SUPER_ADMIN alone; COMPANY_ADMIN holds
 * only AUTOMATION_EXECUTE.
 */

import { ROLE_CAPABILITIES } from '../../security/capabilityRegistry';
import { hasCapability } from '../../security/AuthorizationService';
import { AUTOMATION_EXECUTE_PROD, AUTOMATION_EXECUTE } from '../../../shared/contracts/security/SecurityCapabilities';

type Principal = Parameters<typeof hasCapability>[0];

const principalWith = (caps: readonly string[]): Principal =>
  ({ capabilities: [...caps], organizations: [] } as unknown as Principal);

describe('P117 — the gating capability is SUPER_ADMIN-only', () => {
  test('SUPER_ADMIN holds AUTOMATION_EXECUTE_PROD', () => {
    expect(ROLE_CAPABILITIES.SUPER_ADMIN).toContain(AUTOMATION_EXECUTE_PROD);
  });

  test('no other role holds it', () => {
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      if (role === 'SUPER_ADMIN') continue;
      expect(caps).not.toContain(AUTOMATION_EXECUTE_PROD);
    }
  });

  test('COMPANY_ADMIN holds only the non-production automation capability', () => {
    expect(ROLE_CAPABILITIES.COMPANY_ADMIN).toContain(AUTOMATION_EXECUTE);
    expect(ROLE_CAPABILITIES.COMPANY_ADMIN).not.toContain(AUTOMATION_EXECUTE_PROD);
  });
});

describe('P117 — hasCapability is the gate the route relies on', () => {
  test('a SUPER_ADMIN principal passes', () => {
    expect(hasCapability(principalWith(ROLE_CAPABILITIES.SUPER_ADMIN), AUTOMATION_EXECUTE_PROD)).toBe(true);
  });

  test('a COMPANY_ADMIN principal is refused', () => {
    expect(hasCapability(principalWith(ROLE_CAPABILITIES.COMPANY_ADMIN), AUTOMATION_EXECUTE_PROD)).toBe(false);
  });

  test('an unauthenticated (null) principal is refused', () => {
    expect(hasCapability(null, AUTOMATION_EXECUTE_PROD)).toBe(false);
  });

  test('a principal carrying only the non-production capability is refused', () => {
    expect(hasCapability(principalWith([AUTOMATION_EXECUTE]), AUTOMATION_EXECUTE_PROD)).toBe(false);
  });
});
