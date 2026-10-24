/**
 * Closure-014 (E) — the direct-grant issuance rule, and its agreement with the
 * proposed database trigger's capability list.
 */
import fs from 'fs';
import path from 'path';
import { validateCapabilityGrant, PLATFORM_TIER_WRITE_CAPABILITIES } from '../../security/capabilityGrantPolicy';
import { expandWithHierarchy } from '../../security/capabilityRegistry';
import { ALL_CAPABILITIES, SUPER_ADMIN_DASHBOARD_VIEW, CONSUMPTION_VIEW_AGGREGATE, CAMPAIGN_VIEW } from '../../../shared/contracts/security';

const SA = { userId: 'grantor', organizations: [{ organizationId: 'p', role: 'SUPER_ADMIN', status: 'active' }], legacyCookieSuperAdmin: false } as never;
const ACTIVE_SA = [{ role: 'SUPER_ADMIN', status: 'active' }];

describe('validateCapabilityGrant', () => {
  it.each(PLATFORM_TIER_WRITE_CAPABILITIES.map((c) => [c]))('%s to an active exact SUPER_ADMIN → allowed', (c) => {
    expect(validateCapabilityGrant({ capability: c, targetUserId: 't', targetMemberships: ACTIVE_SA, grantor: SA })).toEqual({ ok: true });
  });
  it.each(PLATFORM_TIER_WRITE_CAPABILITIES.map((c) => [c]))('%s to a VIEW_ONLY / tenant admin / inactive / lowercase super_admin → refused', (c) => {
    for (const m of [[{ role: 'VIEW_ONLY', status: 'active' }], [{ role: 'COMPANY_ADMIN', status: 'active' }], [{ role: 'SUPER_ADMIN', status: 'inactive' }], [{ role: 'super_admin', status: 'active' }], []]) {
      expect(validateCapabilityGrant({ capability: c, targetUserId: 't', targetMemberships: m, grantor: SA }))
        .toEqual({ ok: false, reason: 'PLATFORM_WRITE_REQUIRES_ACTIVE_SUPER_ADMIN' });
    }
  });
  it('read-only platform capabilities may be delegated to any principal', () => {
    for (const c of [SUPER_ADMIN_DASHBOARD_VIEW, CONSUMPTION_VIEW_AGGREGATE]) {
      expect(validateCapabilityGrant({ capability: c, targetUserId: 't', targetMemberships: [{ role: 'VIEW_ONLY', status: 'active' }], grantor: SA }).ok).toBe(true);
    }
  });
  it('the grantor must be an active, canonical platform SUPER_ADMIN', () => {
    const nonSa = { userId: 'g', organizations: [{ organizationId: 'a', role: 'COMPANY_ADMIN', status: 'active' }], legacyCookieSuperAdmin: false } as never;
    const bridge = { userId: 'legacy:cookie-super-admin', organizations: [{ organizationId: 'p', role: 'SUPER_ADMIN', status: 'active' }], legacyCookieSuperAdmin: true } as never;
    for (const g of [nonSa, bridge]) {
      expect(validateCapabilityGrant({ capability: CAMPAIGN_VIEW, targetUserId: 't', targetMemberships: [], grantor: g }))
        .toEqual({ ok: false, reason: 'GRANTOR_NOT_PLATFORM_SUPER_ADMIN' });
    }
  });
  it('self-grants and unknown capability strings are refused', () => {
    expect(validateCapabilityGrant({ capability: CAMPAIGN_VIEW, targetUserId: 'grantor', targetMemberships: ACTIVE_SA, grantor: SA })).toEqual({ ok: false, reason: 'SELF_GRANT' });
    expect(validateCapabilityGrant({ capability: 'Billing.Plan.Manage', targetUserId: 't', targetMemberships: ACTIVE_SA, grantor: SA })).toEqual({ ok: false, reason: 'UNKNOWN_CAPABILITY' });
  });
});

describe('the proposed DB trigger stays in sync with the code', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../docs/security/proposed/20261013_capability_assignments_platform_write_guard.sql'), 'utf8');
  const listed = new Set([...sql.match(/NEW\.capability IN \(([\s\S]*?)\)/)![1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]));

  it('lists exactly the grantable values that confer a platform-tier write capability', () => {
    const conferring = (ALL_CAPABILITIES as readonly string[]).filter((c) =>
      expandWithHierarchy([c as never]).some((x) => (PLATFORM_TIER_WRITE_CAPABILITIES as readonly string[]).includes(x)));
    expect([...listed].sort()).toEqual([...conferring].sort());
  });
  it('compares the role exactly and requires status active (same predicate as platform authority)', () => {
    expect(sql).toMatch(/ucr\.role = 'SUPER_ADMIN' AND ucr\.status = 'active'/);
  });
  it('is not part of the migration set (owner decision)', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../../supabase/migrations/20261013_capability_assignments_platform_write_guard.sql'))).toBe(false);
  });
});
