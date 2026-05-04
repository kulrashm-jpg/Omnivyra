import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/external-apis/[id]/accounts-summary
 *
 * Returns per-account visibility data for a given external API source.
 * Combines api_provider_accounts, external_api_usage (latest per account),
 * and external_api_health (account-scoped then source-scoped fallback).
 *
 * SUPER_ADMIN only.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';

// â”€â”€ Auth guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ userId: string } | null> {

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if ((await isPlatformSuperAdmin(user.id)) || (await isPlatformSuperAdmin(user.id))) {
    return { userId: user.id };
  }
  res.status(403).json({ error: 'SUPER_ADMIN_ONLY' });
  return null;
}

// â”€â”€ Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API source ID required' });
  }

  const session = await requireSuperAdmin(req, res);
  if (!session) return;

  // Verify the API source exists
  const { data: source, error: sourceError } = await supabase
    .from('external_api_sources')
    .select('id, name, category, is_whitelisted, is_enabled_global')
    .eq('id', id)
    .maybeSingle();

  if (sourceError) {
    return res.status(500).json({ error: sourceError.message });
  }
  if (!source) {
    return res.status(404).json({ error: 'API source not found' });
  }

  // â”€â”€ Fetch all accounts for this source â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: accounts, error: accountsError } = await supabase
    .from('api_provider_accounts')
    .select('id, account_name, is_active, priority, current_usage_min, current_usage_day, last_reset_at, created_at')
    .eq('api_source_id', id)
    .order('priority', { ascending: true });

  if (accountsError) {
    return res.status(500).json({ error: accountsError.message });
  }

  const accountList = accounts ?? [];
  const accountIds = accountList.map((a) => a.id);

  // â”€â”€ Fetch latest usage row per account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // We pull usage rows that reference these account IDs (last_outcome + last_used_at).
  const { data: usageRows } = accountIds.length
    ? await supabase
        .from('external_api_usage')
        .select('account_id, last_used_at, last_outcome')
        .in('account_id', accountIds)
        .order('last_used_at', { ascending: false })
    : { data: [] };

  // Keep only the most recent row per account_id
  const latestUsageByAccount = (usageRows ?? []).reduce<Record<string, { last_used_at: string | null; last_outcome: string | null }>>(
    (acc, row) => {
      if (!row.account_id) return acc;
      if (!acc[row.account_id]) {
        acc[row.account_id] = {
          last_used_at: row.last_used_at ?? null,
          last_outcome: row.last_outcome ?? null,
        };
      }
      return acc;
    },
    {}
  );

  // â”€â”€ Fetch health: account-scoped first, then source-level fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: healthByAccount } = accountIds.length
    ? await supabase
        .from('external_api_health')
        .select('account_id, health_score, freshness_score, reliability_score')
        .in('account_id', accountIds)
    : { data: [] };

  const healthScoreByAccountId = (healthByAccount ?? []).reduce<Record<string, number | null>>(
    (acc, row) => {
      if (row.account_id) acc[row.account_id] = row.health_score ?? null;
      return acc;
    },
    {}
  );

  // Source-level health fallback (used when no account-scoped row exists)
  const { data: sourceHealth } = await supabase
    .from('external_api_health')
    .select('health_score')
    .eq('api_source_id', id)
    .maybeSingle();

  const sourceLevelHealthScore = sourceHealth?.health_score ?? null;

  // â”€â”€ Build response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const summary = accountList.map((account) => {
    const usage = latestUsageByAccount[account.id] ?? { last_used_at: null, last_outcome: null };
    const healthScore =
      healthScoreByAccountId[account.id] !== undefined
        ? healthScoreByAccountId[account.id]
        : sourceLevelHealthScore;

    return {
      account_id: account.id,
      account_name: account.account_name,
      is_active: account.is_active,
      priority: account.priority,
      current_usage_min: account.current_usage_min,
      current_usage_day: account.current_usage_day,
      last_reset_at: account.last_reset_at,
      last_used_at: usage.last_used_at,
      last_outcome: usage.last_outcome,
      health_score: healthScore,
    };
  });

  return res.status(200).json({
    api_source_id: id,
    api_source_name: source.name,
    category: source.category,
    is_whitelisted: source.is_whitelisted,
    is_enabled_global: source.is_enabled_global,
    account_count: accountList.length,
    active_account_count: accountList.filter((a) => a.is_active).length,
    accounts: summary,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

