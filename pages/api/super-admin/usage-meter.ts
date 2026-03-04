import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { hasUsageAccess } from '../../../backend/services/usageAccessService';

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

const requireAuth = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ userId: string | null; isSuperAdmin: boolean } | null> => {
  const hasSession = req.cookies?.super_admin_session === '1';
  if (hasSession) {
    return { userId: null, isSuperAdmin: true };
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id) {
    const isAdmin = await isPlatformSuperAdmin(user.id);
    return { userId: user.id, isSuperAdmin: isAdmin };
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return null;
};

type MeterRow = {
  llm_input_tokens?: number | null;
  llm_output_tokens?: number | null;
  llm_total_tokens?: number | null;
  external_api_calls?: number | null;
  automation_executions?: number | null;
  total_cost?: number | null;
};

function buildUsage(row: MeterRow | null, includeCost: boolean): Record<string, unknown> {
  const llm = {
    input_tokens: Number(row?.llm_input_tokens ?? 0),
    output_tokens: Number(row?.llm_output_tokens ?? 0),
    total_tokens: Number(row?.llm_total_tokens ?? 0),
  };
  const external_api = { calls: Number(row?.external_api_calls ?? 0) };
  const automation = { executions: Number(row?.automation_executions ?? 0) };
  const usage: Record<string, unknown> = { llm, external_api, automation };
  if (includeCost) {
    usage.total_cost = Number(row?.total_cost ?? 0);
  }
  return usage;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const organizationId = req.query.organization_id as string | undefined;
  if (!organizationId) {
    return res.status(400).json({ error: 'organization_id is required' });
  }

  if (!auth.isSuperAdmin && auth.userId) {
    const allowed = await hasUsageAccess(auth.userId, organizationId, false);
    if (!allowed) {
      return res.status(403).json({ error: 'FORBIDDEN_NO_USAGE_ACCESS' });
    }
  }

  const { year: defaultYear, month: defaultMonth } = currentYearMonth();
  const year = req.query.year != null ? parseInt(String(req.query.year), 10) : defaultYear;
  const month = req.query.month != null ? parseInt(String(req.query.month), 10) : defaultMonth;

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year and month must be valid' });
  }

  try {
    const { data: row, error } = await supabase
      .from('usage_meter_monthly')
      .select('llm_input_tokens, llm_output_tokens, llm_total_tokens, external_api_calls, automation_executions, total_cost')
      .eq('organization_id', organizationId)
      .eq('year', year)
      .eq('month', month)
      .limit(1)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const usage = buildUsage(row as MeterRow | null, auth.isSuperAdmin);

    return res.status(200).json({
      success: true,
      scope: { organization_id: organizationId, year, month },
      usage,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
