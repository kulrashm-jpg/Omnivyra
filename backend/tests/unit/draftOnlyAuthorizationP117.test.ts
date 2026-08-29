/**
 * Draft-only execution is a CAMPAIGN capability, not a platform-admin one.
 *
 * It was first gated on AUTOMATION_EXECUTE_PROD, which the registry grants to
 * SUPER_ADMIN alone. That was wrong twice over:
 *
 *   - operating a company's campaigns is COMPANY_ADMIN's job; a platform
 *     administrator should not have to run a customer's campaign;
 *   - it inverted risk. A normal release publishes to a real audience and
 *     requires no capability at all beyond requireCampaignAccess, so the SAFE
 *     operation demanded a HIGHER privilege than the dangerous one — a
 *     COMPANY_ADMIN could publish but could not dry-run.
 *
 * CAMPAIGN_EXECUTE already existed and is held by both roles, so the fix needed
 * no new capability and no registry change.
 *
 * The dangerous failure remains the one these tests exist for: a caller who
 * asks for a dry run, is not authorized, and receives a REAL release that
 * publishes. Silently ignoring the flag would produce exactly that, so an
 * unauthorized request is refused outright.
 */

import { ROLE_CAPABILITIES } from '../../security/capabilityRegistry';
import { hasCapability } from '../../security/AuthorizationService';
import {
  CAMPAIGN_EXECUTE,
  AUTOMATION_EXECUTE_PROD,
} from '../../../shared/contracts/security/SecurityCapabilities';

type Principal = Parameters<typeof hasCapability>[0];

const principalWith = (caps: readonly string[]): Principal =>
  ({ capabilities: [...caps], organizations: [] } as unknown as Principal);

describe('draft-only is gated on the campaign capability', () => {
  test('COMPANY_ADMIN holds CAMPAIGN_EXECUTE — the campaign operator can dry-run', () => {
    expect(ROLE_CAPABILITIES.COMPANY_ADMIN).toContain(CAMPAIGN_EXECUTE);
  });

  test('SUPER_ADMIN also holds it, so platform admins are not locked out', () => {
    expect(ROLE_CAPABILITIES.SUPER_ADMIN).toContain(CAMPAIGN_EXECUTE);
  });

  test('the gate is NOT the SUPER_ADMIN-only automation capability', () => {
    // Regression pin for the original bug.
    expect(ROLE_CAPABILITIES.COMPANY_ADMIN).not.toContain(AUTOMATION_EXECUTE_PROD);
    expect(ROLE_CAPABILITIES.SUPER_ADMIN).toContain(AUTOMATION_EXECUTE_PROD);
  });
});

describe('hasCapability is the gate the route relies on', () => {
  test('a COMPANY_ADMIN principal is authorized', () => {
    expect(hasCapability(principalWith(ROLE_CAPABILITIES.COMPANY_ADMIN), CAMPAIGN_EXECUTE)).toBe(true);
  });

  test('a SUPER_ADMIN principal is authorized', () => {
    expect(hasCapability(principalWith(ROLE_CAPABILITIES.SUPER_ADMIN), CAMPAIGN_EXECUTE)).toBe(true);
  });

  test('an unauthenticated (null) principal is refused', () => {
    expect(hasCapability(null, CAMPAIGN_EXECUTE)).toBe(false);
  });

  test('a principal without CAMPAIGN_EXECUTE is refused', () => {
    expect(hasCapability(principalWith([]), CAMPAIGN_EXECUTE)).toBe(false);
  });

  test('a lower campaign role without the capability is refused', () => {
    for (const role of ['CONTENT_CREATOR', 'CONTENT_REVIEWER', 'VIEW_ONLY'] as const) {
      const caps = ROLE_CAPABILITIES[role];
      if (!caps) continue;
      if (!caps.includes(CAMPAIGN_EXECUTE)) {
        expect(hasCapability(principalWith(caps), CAMPAIGN_EXECUTE)).toBe(false);
      }
    }
  });
});

describe('the route wires the corrected capability', () => {
  const source = require('fs').readFileSync(
    require('path').join(process.cwd(), 'pages/api/campaigns/[id]/release.ts'),
    'utf8',
  ) as string;

  test('the draft-only gate checks CAMPAIGN_EXECUTE', () => {
    expect(source).toContain('hasCapability(principal, CAMPAIGN_EXECUTE)');
  });

  test('the SUPER_ADMIN-only capability is no longer the gate', () => {
    expect(source).not.toContain('hasCapability(principal, AUTOMATION_EXECUTE_PROD)');
  });

  test('the capability check is still present — not dropped', () => {
    expect(source).toContain('DRAFT_ONLY_FORBIDDEN');
    expect(source).toMatch(/if \(!hasCapability\(/);
  });

  test('requireCampaignAccess remains the ownership boundary, ahead of the gate', () => {
    const ownership = source.indexOf('requireCampaignAccess(req, res, id)');
    const gate = source.indexOf('const draftOnlyRequested');
    expect(ownership).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(ownership);
  });

  test('only a strict true activates draft-only', () => {
    expect(source).toContain("req.body?.draftOnly === true");
  });

  test('normal release is unchanged — no capability gate outside the draft-only branch', () => {
    // The single hasCapability call lives inside `if (draftOnlyRequested)`.
    expect((source.match(/hasCapability\(/g) ?? []).length).toBe(1);
  });
});
