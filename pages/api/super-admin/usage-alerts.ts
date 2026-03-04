import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

const requireSuperAdmin = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireSuperAdmin(req, res))) return;

  const { year: defaultYear, month: defaultMonth } = currentYearMonth();
  const organizationId = req.query.organization_id as string | undefined;
  const year = req.query.year != null ? parseInt(String(req.query.year), 10) : defaultYear;
  const month = req.query.month != null ? parseInt(String(req.query.month), 10) : defaultMonth;

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year and month must be valid' });
  }

  try {
    let query = supabase
      .from('usage_threshold_alerts')
      .select('organization_id, resource_key, threshold_percent, triggered_at')
      .eq('year', year)
      .eq('month', month)
      .order('triggered_at', { ascending: false });

    if (organizationId) {
      query = query.eq('organization_id', organizationId);
    }

    const { data: rows, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const alerts = (rows ?? []).map(
      (r: { organization_id: string; resource_key: string; threshold_percent: number; triggered_at: string }) => ({
        organization_id: r.organization_id,
        resource_key: r.resource_key,
        threshold_percent: r.threshold_percent,
        triggered_at: r.triggered_at,
      })
    );

    return res.status(200).json({
      success: true,
      scope: { year, month },
      alerts,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
