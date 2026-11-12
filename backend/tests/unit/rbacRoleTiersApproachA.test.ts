/**
 * ROLES APPROACH A (owner ruling via e9, 2026-11-12). The four content roles
 * keep their identity and authorise through deliberate base tiers. Pins the
 * model so a tier can never quietly become an admin grant.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no DB in this test'); } } }));
import { Role, ROLE_BASE_TIERS, roleSatisfies, normalizeRole, normalizePermissionRole, INVITABLE_TENANT_ROLES } from '../../services/rbacPrimitives';
import { COMMUNITY_AI_CAPABILITIES, hasCommunityAiCapability } from '../../services/rbac/communityAiCapabilities';
import { PERMISSIONS } from '../../services/rbacService';
import { capabilitiesForRole } from '../../security/capabilityRegistry';

const ADMIN_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.ADMIN];
const FOUR = [Role.CONTENT_MANAGER, Role.CONTENT_PLANNER, Role.CONTENT_ENGAGER, Role.VIEWER];

it('the four keep their identity through normalizeRole / normalizePermissionRole (no silent rewrite)', () => {
  for (const r of FOUR) {
    expect(normalizeRole(r)).toBe(r);
    expect(normalizeRole(r.toLowerCase())).toBe(r);
    expect(normalizePermissionRole(r)).toBe(r);
  }
  expect(normalizeRole('CONTENTPLANNER')).toBe(Role.CONTENT_PLANNER); // historical spelling
  expect(normalizeRole('ADMIN')).toBe(Role.COMPANY_ADMIN); // the one remaining alias
});

it('the tiers are exactly as ruled, and NO tier is an admin role', () => {
  expect(ROLE_BASE_TIERS).toEqual({
    VIEWER: ['VIEW_ONLY'],
    CONTENT_ENGAGER: ['VIEW_ONLY'],
    CONTENT_PLANNER: ['CONTENT_CREATOR'],
    CONTENT_MANAGER: ['CONTENT_CREATOR', 'CONTENT_PUBLISHER', 'CONTENT_REVIEWER'],
  });
  for (const tiers of Object.values(ROLE_BASE_TIERS)) for (const t of tiers) expect(ADMIN_ROLES).not.toContain(t);
});

it('none of the four satisfies an admin-only list (team / users / roles / API / billing / org)', () => {
  for (const r of FOUR) {
    expect(roleSatisfies(r, [Role.SUPER_ADMIN, Role.COMPANY_ADMIN])).toBe(false);
    for (const p of ['VIEW_TEAM', 'CREATE_USER', 'ASSIGN_ROLE', 'MANAGE_EXTERNAL_APIS'] as const) {
      expect(roleSatisfies(r, PERMISSIONS[p])).toBe(false);
    }
    for (const c of ['MANAGE_PLAYBOOKS', 'MANAGE_LISTENING_CAPABILITIES'] as const) expect(hasCommunityAiCapability(r, c)).toBe(false);
  }
});

it('VIEWER and CONTENT_ENGAGER view the campaigns list (e9 ruling) but cannot create campaigns', () => {
  for (const r of [Role.VIEWER, Role.CONTENT_ENGAGER]) {
    expect(roleSatisfies(r, PERMISSIONS.VIEW_CAMPAIGNS)).toBe(true);
    expect(roleSatisfies(r, PERMISSIONS.CREATE_CAMPAIGN)).toBe(false);
    expect(roleSatisfies(r, PERMISSIONS.APPROVE_CONTENT)).toBe(false);
  }
});

it('CONTENT_ENGAGER = VIEW_ONLY + engagement: executes community actions and sees discovered users; does not approve', () => {
  expect(hasCommunityAiCapability(Role.CONTENT_ENGAGER, 'EXECUTE_ACTIONS')).toBe(true);
  expect(hasCommunityAiCapability(Role.CONTENT_ENGAGER, 'VIEW_DISCOVERED_USERS')).toBe(true);
  expect(hasCommunityAiCapability(Role.CONTENT_ENGAGER, 'VIEW_ACTIONS')).toBe(true);
  expect(hasCommunityAiCapability(Role.CONTENT_ENGAGER, 'APPROVE_ACTIONS')).toBe(false);
  expect(hasCommunityAiCapability(Role.VIEWER, 'EXECUTE_ACTIONS')).toBe(false); // VIEWER is NOT an engager
});

it('CONTENT_PLANNER = CREATOR (+ planning named on its routes): creates, does not approve or publish', () => {
  expect(roleSatisfies(Role.CONTENT_PLANNER, PERMISSIONS.CREATE_CAMPAIGN)).toBe(true);
  expect(roleSatisfies(Role.CONTENT_PLANNER, PERMISSIONS.APPROVE_CONTENT)).toBe(false);
  expect(roleSatisfies(Role.CONTENT_PLANNER, PERMISSIONS.PUBLISH_CONTENT)).toBe(false);
});

it('CONTENT_MANAGER = PUBLISHER u REVIEWER (incl. create): approves, publishes, creates, governs community actions', () => {
  for (const p of ['CREATE_CAMPAIGN', 'APPROVE_CONTENT', 'PUBLISH_CONTENT', 'VIEW_CAMPAIGNS'] as const) expect(roleSatisfies(Role.CONTENT_MANAGER, PERMISSIONS[p])).toBe(true);
  for (const c of ['APPROVE_ACTIONS', 'EXECUTE_ACTIONS', 'SCHEDULE_ACTIONS', 'CLASSIFY_DISCOVERED_USERS'] as const) expect(hasCommunityAiCapability(Role.CONTENT_MANAGER, c)).toBe(true);
});

it('control: an unknown role satisfies nothing but a wildcard; tiers are not transitive through unknown names', () => {
  expect(roleSatisfies('NOT_A_ROLE', [Role.VIEW_ONLY, Role.CONTENT_CREATOR])).toBe(false);
  expect(roleSatisfies(null, ['*'])).toBe(false);
  expect(roleSatisfies(Role.VIEWER, ['*'])).toBe(true);
  expect(Object.keys(COMMUNITY_AI_CAPABILITIES).length).toBeGreaterThan(5);
});

// R2 - CapabilityService passes the RAW stored role, so each of the four needs
// its own registry entry (before this, they held NO capability, not even MFA).
it('R2: each of the four holds exactly the capabilities of its tiers (raw stored role)', () => {
  const sorted = (r: string) => [...capabilitiesForRole(r)].sort();
  expect(sorted('VIEWER')).toEqual(sorted('VIEW_ONLY'));
  expect(sorted('CONTENT_ENGAGER')).toEqual(sorted('VIEW_ONLY'));
  expect(sorted('CONTENT_PLANNER')).toEqual(sorted('CONTENT_CREATOR'));
  const union = Array.from(new Set([...capabilitiesForRole('CONTENT_PUBLISHER'), ...capabilitiesForRole('CONTENT_REVIEWER'), ...capabilitiesForRole('CONTENT_CREATOR')])).sort();
  expect(sorted('CONTENT_MANAGER')).toEqual(union);
  for (const r of FOUR) {
    expect(capabilitiesForRole(r)).toContain('mfa.enroll');
    expect(capabilitiesForRole(r).length).toBeGreaterThan(0);
  }
});

it('R2: none of the four holds a capability COMPANY_ADMIN-only roles hold beyond content (org / billing / integration / identity / prospect)', () => {
  const contentUniverse = new Set([...capabilitiesForRole('CONTENT_PUBLISHER'), ...capabilitiesForRole('CONTENT_REVIEWER'), ...capabilitiesForRole('CONTENT_CREATOR'), ...capabilitiesForRole('VIEW_ONLY')]);
  for (const r of FOUR) for (const c of capabilitiesForRole(r)) expect(contentUniverse.has(c)).toBe(true);
});

// R3 - the code lists and the migrations must name the SAME sets (one list, no drift).
const migrationRoles = (file: string, constraint: string): string[] => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations', file), 'utf8');
  const i = sql.indexOf(`ADD CONSTRAINT ${constraint} CHECK`);
  expect(i).toBeGreaterThan(-1);
  const arr = sql.slice(i, sql.indexOf(']::text[]', i));
  return Array.from(arr.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1]).sort();
};

it('R3: INVITABLE_TENANT_ROLES == the invitations_role_check set in 20270217000010 (never SUPER_ADMIN / ADMIN)', () => {
  const mig = migrationRoles('20270217000010_invitations_role_check_content_roles.sql', 'invitations_role_check');
  expect(mig).toEqual([...INVITABLE_TENANT_ROLES].sort());
  expect(mig).not.toContain('SUPER_ADMIN');
  expect(mig).not.toContain('ADMIN');
});

it('R3: the user_company_roles CHECK in 20270217000011 == every canonical Role value except the ADMIN alias', () => {
  const mig = migrationRoles('20270217000011_user_company_roles_role_check.sql', 'user_company_roles_role_check');
  expect(mig).toEqual((Object.values(Role) as string[]).filter((r) => r !== 'ADMIN').sort());
});

