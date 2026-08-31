/**
 * REPORTS-BINDER-PARITY-001 — the ONE tenant binder for pages/api/reports/*.
 *
 * This is a CONSOLIDATION of an existing, already-certified authorization
 * contract, not a new one. Ten byte-equivalent copies of this function lived
 * inline in the reports routes (nine inline + one in automationActivityShared);
 * all ten normalised to a single implementation hash before extraction, so the
 * behaviour below is theirs, unchanged.
 *
 * REPORTS-BATCH-SEC-001 certified that contract with 70 tests. This module makes
 * it single-source-of-truth and statically recognisable, so the routes stop
 * being invisible to check-tenant-authz and the copies cannot drift apart.
 *
 * THE CONTRACT — deliberately preserved, including its limits
 *
 *   resolveCompanyId(userId, requested?)
 *
 *   requested given -> the caller must hold an ACTIVE membership row for exactly
 *   that company; the row's own company_id is returned. The request value is
 *   never echoed back: what the caller gets is the server-owned column.
 *
 *   requested omitted/empty -> falls back to the caller's first active
 *   membership. Callers with several companies get an arbitrary one, because the
 *   query is limit(1) with no ORDER BY. That is the shipped behaviour and is
 *   preserved rather than "fixed" here.
 *
 *   no active membership -> null, and every caller answers 403.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — do not "improve" these without an audit:
 *
 *   - No company lifecycle check. `companies.status` is never consulted, so an
 *     active member of a suspended company still resolves. assertTenantAccess
 *     WOULD reject that, which is precisely why this helper must not be swapped
 *     for requireCompanyAccess as a refactor: it would silently change behaviour
 *     for suspended orgs.
 *   - No super-admin bypass. A platform super admin with no active membership
 *     row resolves to null here, exactly as before.
 *
 * Those two omissions are the established contract of these ten routes. Changing
 * either is an authorization change and belongs in its own audited work item.
 */
import { supabase } from '../db/supabaseClient';

/**
 * Resolve the company a reports route may operate on for this user.
 *
 * @param userId              the AUTHENTICATED caller (never request-supplied)
 * @param requestedCompanyId  the company the caller asked for, if any
 * @returns the server-owned company_id, or null when the caller may not act
 */
export async function resolveCompanyId(
  userId: string,
  requestedCompanyId?: string,
): Promise<string | null> {
  if (requestedCompanyId) {
    const { data } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('company_id', requestedCompanyId)
      .eq('status', 'active')
      .maybeSingle();
    return data?.company_id ?? null;
  }

  const { data } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return data?.company_id ?? null;
}
