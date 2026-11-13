/**
 * Client mirror of the server's campaign WRITE role rule (F3; 55's
 * backend/services/campaignWriteRole.ts campaignWriteDecision + rbacPrimitives.normalizeRole).
 * The server is the enforcement (403 ROLE_FORBIDDEN); this only decides which controls to
 * SHOW, so the UI never offers an action the server will refuse.
 *
 * Owner rulings (2026-11-13): Viewer / view-only roles may VIEW campaigns only (no writes,
 * no AI generation). Engagers may additionally post campaign discussion messages and voice
 * notes. Unknown roles cannot write (fail closed, as on the server). Platform super admins
 * and the content-architect principal bypass, as on the server.
 *
 * backend/tests/unit/campaignWriteAccessParity.test.ts runs this against the server's
 * campaignWriteDecision for every known role, so the two cannot drift.
 */

/** The 403 body the server sends (ROLE_FORBIDDEN_BODY); its `error` is the user-facing text. */
export const ROLE_FORBIDDEN_CODE = 'ROLE_FORBIDDEN';
export const ROLE_FORBIDDEN_MESSAGE = 'Your role can view this campaign but not change it.';

/** Synthetic client roles that bypass on the server (CompanyContext sets them). */
const BYPASS_ROLES = new Set(['SUPER_ADMIN', 'CONTENT_ARCHITECT']);

const upperRaw = (role: string | null | undefined) => String(role ?? '').trim().toUpperCase().replace(/\s+/g, '_');

/** Mirrors rbacPrimitives.normalizeRole: the normalized role, or null if unknown. */
function normalizeRole(value: string | null | undefined): string | null {
  const upper = upperRaw(value);
  if (!upper) return null;
  if (upper === 'ADMIN' || upper === 'COMPANYADMIN' || upper === 'COMPANY_ADMIN') return 'COMPANY_ADMIN';
  if (upper === 'CONTENT_MANAGER' || upper === 'CONTENTPLANNER' || upper === 'CONTENT_PLANNER' || upper === 'CONTENT_CREATOR') {
    return 'CONTENT_CREATOR';
  }
  if (upper === 'CONTENT_ENGAGER' || upper === 'VIEWER' || upper === 'VIEW_ONLY') return 'VIEW_ONLY';
  return ['SUPER_ADMIN', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER'].includes(upper) ? upper : null;
}

/** May this role change campaign data or trigger campaign AI? */
export function canWriteCampaign(role: string | null | undefined): boolean {
  if (BYPASS_ROLES.has(upperRaw(role))) return true;
  const normalized = normalizeRole(role);
  return normalized !== null && normalized !== 'VIEW_ONLY';
}

/** Campaign discussion messages and voice notes: writers, plus Engagers (owner ruling). */
export function canPostCampaignMessages(role: string | null | undefined): boolean {
  return canWriteCampaign(role) || upperRaw(role) === 'CONTENT_ENGAGER';
}

/** campaigns/approve: reviewers, company admins and super admins (55: APPROVE_CONTENT). */
export function canApproveCampaign(role: string | null | undefined): boolean {
  if (upperRaw(role) === 'SUPER_ADMIN') return true;
  const normalized = normalizeRole(role);
  return normalized === 'CONTENT_REVIEWER' || normalized === 'COMPANY_ADMIN';
}

/** True when a response is the server's campaign-role refusal. */
export function isRoleForbidden(status: number, body: unknown): boolean {
  return status === 403 && (body as { code?: unknown } | null)?.code === ROLE_FORBIDDEN_CODE;
}
