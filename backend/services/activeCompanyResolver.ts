/**
 * Resolve the company a user is acting for, from their ACTIVE memberships only (BLOCKING fix, e9 2026-11-13).
 *
 * users.active_company_id is a PREFERENCE pointer, not proof of membership: it can still name a company the user has
 * left (accept-invite only sets it when empty; setup-company re-points on any role row; billing comments report 24 of
 * 33 prod pointers naming a company where the membership is inactive). Code that keyed company data on the raw
 * pointer let a former member of B read B's onboarding / integration state and write B's journey and domain events.
 *
 * Rule: the pointer is honoured ONLY when the user has an ACTIVE membership in that company; otherwise the user's
 * first active membership in a deterministic order (most recent first, then company id); otherwise null.
 * A non-null result is a company the user actively belongs to; callers still run enforceCompanyAccess (company
 * status, platform rules) before reading or writing.
 */
import { supabase } from '../db/supabaseClient';

export async function resolveActiveCompanyForUser(
  userId: string,
  pointer: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('company_id, created_at')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error || !Array.isArray(data)) return null; // fail closed: no proven membership, no company
  const memberships = (data as Array<{ company_id: string | null; created_at: string | null }>)
    .filter((r) => typeof r.company_id === 'string' && r.company_id.length > 0)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(a.company_id).localeCompare(String(b.company_id)));
  if (pointer && memberships.some((m) => m.company_id === pointer)) return pointer;
  return memberships[0]?.company_id ?? null;
}
