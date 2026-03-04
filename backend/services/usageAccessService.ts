/**
 * Usage report access: Super Admin or org-scoped granted read access.
 * Non-super users see operational metrics only (cost masked at API layer).
 */

import { supabase } from '../db/supabaseClient';

export async function hasUsageAccess(
  userId: string,
  organizationId: string,
  isSuperAdmin: boolean
): Promise<boolean> {
  if (isSuperAdmin) return true;

  const { data } = await supabase
    .from('usage_report_access')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .limit(1);

  return !!data?.length;
}
