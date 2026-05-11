/**
 * Phase 2 — CI Invariants for the capability registry.
 *
 * Hard-fails the build if the bridge capability set overlaps with the
 * step-up-required capability set. The two sets MUST be disjoint:
 *
 *   - LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES is the set held by bridge
 *     principals (legacy cookie super-admin).
 *   - STEP_UP_REQUIRED_CAPABILITIES is the set that requires phishing-
 *     resistant step-up before any route grants the action.
 *
 * Bridge principals can never satisfy step-up by design (see
 * StepUpAuthorizationService). If a step-up-required capability ever
 * landed in the bridge set, the resulting check would either silently
 * grant elevated access (catastrophic) OR confuse the deny path with a
 * STEP_UP_REQUIRED that the bridge can never satisfy. Either way is a
 * Phase-1/Phase-2 architectural violation.
 *
 * This test makes that invariant a hard gate on every CI run.
 */

import {
  LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES,
  legacyCookieSuperAdminCapabilities,
} from '../../security/capabilityRegistry';
import { STEP_UP_REQUIRED_CAPABILITIES } from '../../../shared/contracts/security';

describe('capability-set invariants — bridge ⊥ step-up', () => {
  it('LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES is disjoint from STEP_UP_REQUIRED_CAPABILITIES', () => {
    const stepUpSet = new Set<string>(STEP_UP_REQUIRED_CAPABILITIES);
    const bridgeBase = LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES;
    const overlap = bridgeBase.filter((cap) => stepUpSet.has(cap));
    expect(overlap).toEqual([]);
  });

  it('hierarchy-expanded bridge cap set is also disjoint from step-up set', () => {
    // Hierarchy expansion can add child caps. We need to make sure
    // expanding the bridge base doesn't pull in any step-up child either.
    const stepUpSet = new Set<string>(STEP_UP_REQUIRED_CAPABILITIES);
    const expanded = legacyCookieSuperAdminCapabilities();
    const overlap = expanded.filter((cap) => stepUpSet.has(cap));
    expect(overlap).toEqual([]);
  });

  it('bridge cap list is non-empty (otherwise the bridge is dead-code)', () => {
    expect(LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES.length).toBeGreaterThan(0);
  });

  it('step-up cap list contains every elevated mutation Phase 2 migrated', () => {
    // Soft regression guard: each capability we migrated mutation routes
    // onto MUST require step-up. If any drop out, Phase 2 mutation
    // routes silently lose their elevation requirement.
    // Use the exported constants rather than literal strings so a rename
    // breaks the test compilation rather than its assertion.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const caps = require('../../../shared/contracts/security') as {
      INTEGRATION_PLATFORM_OAUTH_MANAGE: string;
      BILLING_PLAN_MANAGE: string;
      BILLING_GRANT_FREE_CREDITS: string;
    };
    const required = [
      caps.INTEGRATION_PLATFORM_OAUTH_MANAGE,
      caps.BILLING_PLAN_MANAGE,
      caps.BILLING_GRANT_FREE_CREDITS,
    ];
    const have = new Set<string>(STEP_UP_REQUIRED_CAPABILITIES);
    for (const cap of required) {
      expect({ cap, present: have.has(cap) }).toEqual({ cap, present: true });
    }
  });
});
