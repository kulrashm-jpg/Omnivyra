/**
 * Market Pulse CONSOLE access (owner ruling 2026-11-13, via e9).
 *
 * The Executive room (/market-pulse) is the one customer entry and is member-readable. The scan console (the V2 tab:
 * starting / cancelling scans, run detail, history, automation, finding actions) is for company ADMINS only - the
 * UI shows its entry only when CompanyContext.isAdmin (COMPANY_ADMIN || SUPER_ADMIN), and this is the server-side
 * gate that makes that real (hiding a button is not access control). Scans spend money (LLM + data providers), so
 * starting one is an admin decision.
 *
 * Allowed: SUPER_ADMIN, COMPANY_ADMIN, and the platform-internal CONTENT_ARCHITECT session that resolveCompanyAccess
 * already recognises. Everything else (members, invited, viewers) gets 403 MARKET_PULSE_ADMIN_REQUIRED.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../contentArchitectService';

export const MARKET_PULSE_CONSOLE_ROLES: ReadonlySet<string> = new Set(['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_ARCHITECT']);

export function isMarketPulseConsoleRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && MARKET_PULSE_CONSOLE_ROLES.has(role.toUpperCase());
}

/**
 * Role gate on an access ALREADY resolved by resolveCompanyAccess in the route (so the route-auth gate still sees the
 * approved primitive at the call site). Writes 403 and returns false for non-console roles.
 */
export function refuseUnlessMarketPulseConsoleRole(access: { role?: string | null }, res: NextApiResponse): boolean {
  if (isMarketPulseConsoleRole(access.role)) return true;
  res.status(403).json({ error: 'Market Pulse scan console is for company admins', code: 'MARKET_PULSE_ADMIN_REQUIRED' });
  return false;
}

/**
 * Membership + role for `companyId` (resolveCompanyAccess answers 400/401/403 itself), then the console role gate.
 * Returns the access on success; null when a response has already been written.
 */
export async function requireMarketPulseConsoleAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string | null | undefined,
): Promise<{ userId: string; role: string } | null> {
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return null;
  return refuseUnlessMarketPulseConsoleRole(access, res) ? access : null;
}
