/**
 * Campaign-level role service (additive only).
 * No API migrations. No changes to withRBAC or existing RBAC.
 * Campaign roles are optional; existing access is unchanged.
 */

import { supabase } from '../db/supabaseClient';
import { getUserRole } from './rbacService';

// -----------------------------------------------------------------------------
// Campaign-scoped role constants (Level 2). Use these in campaign_user_roles.role.
// CAMPAIGN_CONTENT_MANAGER = same as CAMPAIGN_OPERATOR (formal name for hierarchy).
// -----------------------------------------------------------------------------
export const CampaignRole = {
  CAMPAIGN_OPERATOR: 'CAMPAIGN_OPERATOR',
  /** Alias for CAMPAIGN_OPERATOR; use in hierarchy docs and UI. */
  CAMPAIGN_CONTENT_MANAGER: 'CAMPAIGN_CONTENT_MANAGER',
  CONTENT_CREATOR: 'CONTENT_CREATOR',
} as const;

export type CampaignRoleType = (typeof CampaignRole)[keyof typeof CampaignRole];

/** Company roles that override campaign role (full access to all campaigns in company). */
const COMPANY_OVERRIDE_ROLES: readonly string[] = [
  'SUPER_ADMIN',
  'CAMPAIGN_ARCHITECT',
  'COMPANY_ADMIN',
];

/** Campaign RBAC mode: OBSERVE = fallback only; HYBRID/STRICT = require campaign role for non-override. */
export type CampaignRbacMode = 'OBSERVE' | 'HYBRID' | 'STRICT';

export function getCampaignRbacMode(): CampaignRbacMode {
  const v = (process.env.CAMPAIGN_RBAC_MODE || 'HYBRID').trim().toUpperCase();
  if (v === 'OBSERVE' || v === 'HYBRID' || v === 'STRICT') return v;
  return 'HYBRID';
}

/** True if role is a campaign-scoped execution role (requires campaign_user_roles entry in HYBRID/STRICT). */
export function isCampaignScopedRole(role: string | null): boolean {
  if (!role) return false;
  const u = role.trim().toUpperCase();
  return (
    u === CampaignRole.CAMPAIGN_OPERATOR ||
    u === CampaignRole.CAMPAIGN_CONTENT_MANAGER ||
    u === CampaignRole.CONTENT_CREATOR
  );
}

/** True if company role gets full access to all campaigns (no campaign row required). */
export function isCompanyOverrideRole(role: string | null): boolean {
  if (!role) return false;
  return COMPANY_OVERRIDE_ROLES.includes(role.trim().toUpperCase());
}

// -----------------------------------------------------------------------------
// STEP 2 — getCampaignRole(userId, campaignId)
// Returns campaign role if exists, null otherwise. No permission logic.
// -----------------------------------------------------------------------------
export async function getCampaignRole(
  userId: string,
  campaignId: string
): Promise<string | null> {
  if (!userId || !campaignId) return null;
  const { data, error } = await supabase
    .from('campaign_user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (error || !data?.role) return null;
  return String(data.role).trim() || null;
}

// -----------------------------------------------------------------------------
// STEP 3 — resolveEffectiveCampaignRole(userId, campaignId, companyId)
// 1. Resolve company role.
// 2. Resolve campaign role.
// 3. If company role is override (SUPER_ADMIN | CAMPAIGN_ARCHITECT | COMPANY_ADMIN) → always allowed.
// 4. OBSERVE: fallback to company role (backward compat). HYBRID/STRICT: require campaign role for non-override.
// -----------------------------------------------------------------------------
export type EffectiveCampaignRoleResult = {
  companyRole: string | null;
  campaignRole: string | null;
  effectiveRole: string | null;
  source: 'company' | 'campaign';
  error: string | null;
};

export async function resolveEffectiveCampaignRole(
  userId: string,
  campaignId: string,
  companyId: string
): Promise<EffectiveCampaignRoleResult> {
  const companyResult = await getUserRole(userId, companyId);
  if (companyResult.error === 'COMPANY_ACCESS_DENIED') {
    return {
      companyRole: null,
      campaignRole: null,
      effectiveRole: null,
      source: 'company',
      error: 'COMPANY_ACCESS_DENIED',
    };
  }
  const companyRole = companyResult.role ? String(companyResult.role) : null;
  const campaignRole = await getCampaignRole(userId, campaignId);
  const mode = getCampaignRbacMode();

  if (companyRole && isCompanyOverrideRole(companyRole)) {
    return {
      companyRole,
      campaignRole,
      effectiveRole: companyRole,
      source: 'company',
      error: null,
    };
  }
  if (campaignRole) {
    return {
      companyRole,
      campaignRole,
      effectiveRole: campaignRole,
      source: 'campaign',
      error: null,
    };
  }
  if (mode === 'OBSERVE') {
    return {
      companyRole,
      campaignRole: null,
      effectiveRole: companyRole,
      source: 'company',
      error: null,
    };
  }
  return {
    companyRole,
    campaignRole: null,
    effectiveRole: companyRole,
    source: 'company',
    error: 'CAMPAIGN_ROLE_REQUIRED',
  };
}

/** Request context for soft adoption: observational only. Do not deny access based on this. */
export type CampaignAuthContext = {
  companyRole: string | null;
  campaignRole: string | null;
  effectiveRole: string | null;
  source: 'company' | 'campaign';
};

// -----------------------------------------------------------------------------
// STEP 4 — hasCampaignPermission(role, action). Structure only. No route usage yet.
// -----------------------------------------------------------------------------
export type CampaignPermissionAction =
  | 'VIEW_CAMPAIGN'
  | 'EDIT_CAMPAIGN_STRATEGY'
  | 'COMMIT_PLAN'
  | 'APPROVE_CONTENT'
  | 'CREATE_CONTENT'
  | 'SCHEDULE_CONTENT';

const CAMPAIGN_PERMISSIONS: Record<CampaignPermissionAction, string[]> = {
  VIEW_CAMPAIGN: [CampaignRole.CAMPAIGN_OPERATOR, CampaignRole.CAMPAIGN_CONTENT_MANAGER, CampaignRole.CONTENT_CREATOR],
  EDIT_CAMPAIGN_STRATEGY: [CampaignRole.CAMPAIGN_OPERATOR, CampaignRole.CAMPAIGN_CONTENT_MANAGER],
  COMMIT_PLAN: [CampaignRole.CAMPAIGN_OPERATOR, CampaignRole.CAMPAIGN_CONTENT_MANAGER],
  APPROVE_CONTENT: [CampaignRole.CAMPAIGN_OPERATOR, CampaignRole.CAMPAIGN_CONTENT_MANAGER],
  CREATE_CONTENT: [CampaignRole.CAMPAIGN_OPERATOR, CampaignRole.CAMPAIGN_CONTENT_MANAGER, CampaignRole.CONTENT_CREATOR],
  SCHEDULE_CONTENT: [CampaignRole.CAMPAIGN_OPERATOR, CampaignRole.CAMPAIGN_CONTENT_MANAGER],
};

export function hasCampaignPermission(
  role: string | null,
  action: CampaignPermissionAction
): boolean {
  if (!role) return false;
  const allowed = CAMPAIGN_PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(role.trim().toUpperCase());
}
