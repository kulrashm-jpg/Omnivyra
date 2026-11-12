/**
 * ROLES APPROACH A (owner ruling via e9, 2026-11-12). The four content roles
 * keep their identity and authorise through deliberate base tiers. Pins the
 * model so a tier can never quietly become an admin grant.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no DB in this test'); } } }));
import { Role, ROLE_BASE_TIERS, roleSatisfies, normalizeRole, normalizePermissionRole } from '../../services/rbacPrimitives';
import { COMMUNITY_AI_CAPABILITIES, hasCommunityAiCapability } from '../../services/rbac/communityAiCapabilities';
import { PERMISSIONS } from '../../services/rbacService';

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
