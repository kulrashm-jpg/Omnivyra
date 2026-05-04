import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { Role } from '../../../backend/services/rbacPrimitives';
import { hasUsageAccess } from '../../../backend/services/usageAccessService';
import { requireAdminRateLimit, requireAdminScope } from '../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:usage-meter', 30, 60))) return;

  const organizationId = req.query.organization_id as string | undefined;
  if (!organizationId) {
    return res.status(400).json({ error: 'organization_id is required' });
  }

  const ctx = await requireAdminScope(req, res, 'analytics:usage-meter', { companyId: organizationId });
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/super-admin/usage-meter', 'analytics:usage-meter');
  }
  const auth = { userId: ctx.id, isSuperAdmin: ctx.role === Role.SUPER_ADMIN };

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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
