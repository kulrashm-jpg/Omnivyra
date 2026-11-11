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

import * as registry from '../../security/capabilityRegistry';
import { STEP_UP_REQUIRED_CAPABILITIES, SUPER_ADMIN_LEGACY_BRIDGE } from '../../../shared/contracts/security';

describe('capability-set invariants — the bridge set is gone (e9 (C), 2026-11-11)', () => {
  // The bridge ⊥ step-up invariant pinned here had a subject until the legacy
  // cookie bridge was deleted. What must now hold: no bridge capability set is
  // exported, and NO role grants the bridge capability (it is an audit label).
  it('no bridge capability set is exported any more', () => {
    const mod = registry as Record<string, unknown>;
    expect(mod.LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES).toBeUndefined();
    expect(mod.legacyCookieSuperAdminCapabilities).toBeUndefined();
  });

  it('no role grants the legacy bridge capability', () => {
    for (const role of Object.keys(registry.ROLE_CAPABILITIES)) {
      expect([role, registry.capabilitiesForRole(role).includes(SUPER_ADMIN_LEGACY_BRIDGE)]).toEqual([role, false]);
    }
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
