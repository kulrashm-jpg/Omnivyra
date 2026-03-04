import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { hasUsageAccess } from '../../../backend/services/usageAccessService';
import { resolveOrganizationPlanLimits } from '../../../backend/services/planResolutionService';

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

const requireAuth = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ userId: string | null; isSuperAdmin: boolean } | null> => {
  if (req.cookies?.super_admin_session === '1') {
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
    const [meterResult, resolved] = await Promise.all([
      supabase
        .from('usage_meter_monthly')
        .select('llm_total_tokens, external_api_calls, automation_executions')
        .eq('organization_id', organizationId)
        .eq('year', year)
        .eq('month', month)
        .maybeSingle(),
      resolveOrganizationPlanLimits(organizationId),
    ]);

    const meterRow = meterResult.data;
    const limits = resolved.limits;

    let enforcementEnabled = false;
    let allowOverage = false;
    let gracePercent = 0;
    if (resolved.plan_key) {
      const { data: planFlags } = await supabase
        .from('pricing_plans')
        .select('enforcement_enabled, allow_overage, grace_percent')
        .eq('plan_key', resolved.plan_key)
        .maybeSingle();
      if (planFlags) {
        enforcementEnabled = planFlags.enforcement_enabled === true;
        allowOverage = planFlags.allow_overage === true;
        gracePercent = Number(planFlags.grace_percent ?? 0) || 0;
      }
    }

    const llmUsed = Number(meterRow?.llm_total_tokens ?? 0);
    const apiUsed = Number(meterRow?.external_api_calls ?? 0);
    const autoUsed = Number(meterRow?.automation_executions ?? 0);

    function allowedUntil(limit: number | null): number | null {
      if (limit == null) return null;
      return limit * (1 + gracePercent / 100);
    }
    function isBlocked(used: number, limit: number | null, allowed: number | null): boolean {
      return (
        enforcementEnabled && limit != null && !allowOverage && allowed != null && used > allowed
      );
    }

    const llmAllowed = allowedUntil(limits.llm_tokens);
    const apiAllowed = allowedUntil(limits.external_api_calls);
    const autoAllowed = allowedUntil(limits.automation_executions);

    const resources = {
      llm_tokens: {
        used: llmUsed,
        limit: limits.llm_tokens,
        allowed_until: llmAllowed,
        is_blocked:
          limits.llm_tokens != null ? isBlocked(llmUsed, limits.llm_tokens, llmAllowed) : false,
      },
      external_api_calls: {
        used: apiUsed,
        limit: limits.external_api_calls,
        allowed_until: apiAllowed,
        is_blocked:
          limits.external_api_calls != null
            ? isBlocked(apiUsed, limits.external_api_calls, apiAllowed)
            : false,
      },
      automation_executions: {
        used: autoUsed,
        limit: limits.automation_executions,
        allowed_until: autoAllowed,
        is_blocked:
          limits.automation_executions != null
            ? isBlocked(autoUsed, limits.automation_executions, autoAllowed)
            : false,
      },
    };

    return res.status(200).json({
      success: true,
      scope: { organization_id: organizationId, year, month },
      resources,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
