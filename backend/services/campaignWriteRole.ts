/**
 * Campaign WRITE role guard (BLOCKING security, 2026-11-13; e9 GO + owner rulings).
 *
 * The standard campaign gates (requireCampaignAccess, requireCampaignTenantAccess, enforceCompanyAccess) proved
 * MEMBERSHIP only, so a Viewer or Engager could create, plan, schedule, release (publish) and delete campaign work.
 * Owner rulings:
 *   - Viewer / view-only roles may VIEW campaigns only - no writes, no AI generation (AI spends company credits).
 *   - Engagers (CONTENT_ENGAGER) may additionally write campaign DISCUSSION messages and VOICE NOTES - nothing else.
 *     That is a NAMED exception a route must opt into (EngagerCampaignWriteException); it never applies implicitly.
 *
 * Decision on the RAW membership role (normalizeRole folds VIEWER and CONTENT_ENGAGER into VIEW_ONLY, so the raw
 * value is what tells an Engager from a Viewer). Writes = POST / PUT / PATCH / DELETE (a POST that only previews or
 * chats with AI is still a write here - ruling: view-only means view only). Unknown role -> forbidden (fail closed).
 * Platform super-admins and the content_architect principal bypass, as they do in enforceRole.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { ownedDbTable } from '../db/writeOwner';
import { normalizeRole, Role } from './rbacPrimitives';
import { logger } from './logger';

/**
 * A membership role EXACTLY AS STORED (05 review): a distinct type so a NORMALIZED role can never drive a write
 * decision - VIEWER and CONTENT_ENGAGER collapse to VIEW_ONLY under normalizeRole, which would erase the Engager
 * exception (or, the other way round, a "tidy" normalize-once refactor would silently change who may write).
 */
export type RawMembershipRole = string & { readonly __rawMembershipRole: unique symbol };
/** Brand a value read straight from a membership row (user_company_roles.role / TenantGuard's granted.role). */
export function asRawMembershipRole(value: unknown): RawMembershipRole | null {
  return typeof value === 'string' && value.trim() !== '' ? (value as RawMembershipRole) : null;
}

// AI spend follows authoring: a POST that CAN REACH the AI gateway needs the write role; the rule and its revisit
// condition live in backend/services/content/contentWriteAuthz.ts.
export const CAMPAIGN_WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The ONLY campaign writes an Engager may make (owner ruling). */
export type EngagerCampaignWriteException = 'campaign_messages' | 'voice_notes';

export const ROLE_FORBIDDEN_BODY = {
  error: 'Your role can view this campaign but not change it.',
  code: 'ROLE_FORBIDDEN',
} as const;

export function isCampaignWriteMethod(method: string | undefined | null): boolean {
  return CAMPAIGN_WRITE_METHODS.has(String(method ?? '').toUpperCase());
}

/** Pure decision. `rawRole` = the membership row's role as stored (never a normalized role - see RawMembershipRole). */
export function campaignWriteDecision(input: {
  method: string | undefined | null;
  rawRole: RawMembershipRole | null | undefined;
  bypass: boolean;
  engagerException?: EngagerCampaignWriteException | null;
}): 'allow' | 'forbid' {
  if (!isCampaignWriteMethod(input.method)) return 'allow';
  if (input.bypass) return 'allow';
  const raw = String(input.rawRole ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  const normalized = normalizeRole(raw);
  if (!normalized) return 'forbid';
  if (normalized !== Role.VIEW_ONLY) return 'allow';
  if (raw === Role.CONTENT_ENGAGER && input.engagerException) return 'allow';
  return 'forbid';
}

/**
 * The caller's ACTIVE membership role for the company, exactly as stored. null = no active row OR unreadable.
 * A read FAILURE is logged distinctly ('campaign_write_role_lookup_failed', 05 review) so an infrastructure blip that
 * fails writes closed is never mistaken for a genuine view-only member.
 */
export async function getActiveRawCompanyRole(userId: string, companyId: string): Promise<RawMembershipRole | null> {
  try {
    const { data, error } = await ownedDbTable('user_company_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .eq('status', 'active');
    if (error) {
      logger.warn('campaign_write_role_lookup_failed', { userId, companyId, reason: 'query_error', message: error.message });
      return null;
    }
    if (!Array.isArray(data) || data.length === 0) return null;
    return asRawMembershipRole((data[0] as { role?: unknown }).role);
  } catch (err) {
    logger.warn('campaign_write_role_lookup_failed', { userId, companyId, reason: 'exception', message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * For routes gated by enforceCompanyAccess (membership only): call AFTER it, with the authorized company and user.
 * Returns false (403 ROLE_FORBIDDEN already sent) when the caller's role may not write campaign data.
 */
export async function enforceCampaignWriteRole(input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId: string;
  userId: string;
  engagerException?: EngagerCampaignWriteException | null;
}): Promise<boolean> {
  if (!isCampaignWriteMethod(input.req.method)) return true;
  if (input.userId === 'content_architect') return true;
  const rawRole = await getActiveRawCompanyRole(input.userId, input.companyId);
  let decision = campaignWriteDecision({ method: input.req.method, rawRole, bypass: false, engagerException: input.engagerException });
  if (decision === 'forbid') {
    const { isPlatformSuperAdmin } = await import('./rbacService');
    if (await isPlatformSuperAdmin(input.userId)) decision = 'allow';
  }
  if (decision === 'forbid') {
    input.res.status(403).json(ROLE_FORBIDDEN_BODY);
    return false;
  }
  return true;
}
