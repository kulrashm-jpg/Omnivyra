/**
 * Role-Based Governance Permissions (Phase 8).
 *
 * Eight enterprise creative-operations roles + per-transition
 * permission matrix. NOT an auth provider — this module ONLY defines
 * which roles are allowed to perform which actions. Actual auth
 * resolution (which user has which role for which org) is the
 * platform's existing auth layer's responsibility.
 *
 * Deterministic. Pure (no DB, no fetch).
 */

export type CreativeReviewRole =
  | 'creative_operator'
  | 'creative_director'
  | 'brand_manager'
  | 'compliance_reviewer'
  | 'legal_reviewer'
  | 'campaign_manager'
  | 'executive_reviewer'
  | 'admin';

export type CreativeAction =
  | 'submit_for_review'
  | 'approve_qa'
  | 'approve_governance'
  | 'approve_brand'
  | 'approve_legal'
  | 'reject'
  | 'request_regeneration'
  | 'manual_override'
  | 'bypass_review'
  | 'escalate'
  | 'publish'
  | 'archive'
  | 'unfreeze_campaign'
  | 'campaign_lock'
  | 'strategy_override';

/**
 * Permission matrix. Each action lists the roles allowed to perform it.
 * `admin` is allowed everywhere (kept implicit via the resolver below
 * — explicit lists carry only the SPECIFIC role permissions).
 */
const PERMISSIONS: Record<CreativeAction, ReadonlyArray<CreativeReviewRole>> = {
  submit_for_review: ['creative_operator', 'creative_director', 'campaign_manager'],
  approve_qa: ['compliance_reviewer', 'creative_director'],
  approve_governance: ['compliance_reviewer', 'brand_manager'],
  approve_brand: ['brand_manager', 'creative_director'],
  approve_legal: ['legal_reviewer'],
  reject: ['compliance_reviewer', 'brand_manager', 'legal_reviewer', 'creative_director', 'campaign_manager'],
  request_regeneration: ['creative_operator', 'creative_director', 'campaign_manager'],
  manual_override: ['creative_director', 'campaign_manager', 'executive_reviewer'],
  bypass_review: ['executive_reviewer'],
  escalate: ['creative_operator', 'creative_director', 'brand_manager', 'compliance_reviewer', 'campaign_manager'],
  publish: ['campaign_manager', 'creative_director'],
  archive: ['campaign_manager', 'creative_director', 'admin'],
  unfreeze_campaign: ['executive_reviewer', 'creative_director'],
  campaign_lock: ['creative_director', 'campaign_manager', 'executive_reviewer'],
  strategy_override: ['creative_director', 'executive_reviewer'],
};

export function canPerform(role: CreativeReviewRole | null | undefined, action: CreativeAction): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  return PERMISSIONS[action].includes(role);
}

export function requiredRolesForAction(action: CreativeAction): ReadonlyArray<CreativeReviewRole> {
  return PERMISSIONS[action];
}

/** All roles — for diagnostics + permission UIs. */
export const ALL_ROLES: ReadonlyArray<CreativeReviewRole> = [
  'creative_operator',
  'creative_director',
  'brand_manager',
  'compliance_reviewer',
  'legal_reviewer',
  'campaign_manager',
  'executive_reviewer',
  'admin',
];
