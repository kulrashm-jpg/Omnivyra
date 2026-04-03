
/**
 * GET/PUT company-level API configuration (company_api_configs).
 * GET: list configs for company, or single by api_source_id.
 * PUT: upsert one config (enabled, polling_frequency, priority, daily_limit, signal_limit, purposes, include_filters, exclude_filters).
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  getUserRole,
  hasPermission,
  getCompanyRoleIncludingInvited,
  Role,
} from '../../../backend/services/rbacService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import {
  getAllowedPollingForCompany,
  isPollingAllowedForCompany,
  POLLING_OPTIONS,
  normalizeFilterRecord,
  validateFilterLimits,
} from '../../../backend/services/companyApiConfigService';
import { invalidateCompanyConfigCache } from '../../../backend/services/companyApiConfigCache';

const PURPOSE_OPTIONS = [
  'trend_campaign_detection',
  'market_pulse_signals',
  'competitor_intelligence',
  'market_news',
  'influencer_signals',
  'technology_signals',
  'keyword_intelligence',
];

async function requireCompanyAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  companyId: string | undefined
): Promise<{ userId: string; canManage: boolean } | null> {
  if (!companyId) {
    res.status(400).json({ error: 'companyId required' });
    return null;
  }
  const legacy = getLegacySuperAdminSession(req);
  const { user, error } = legacy
    ? { user: { id: legacy.userId }, error: null }
    : await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  let role: string | null = null;
  const { role: r, error: roleError } = await getUserRole(user.id, companyId);
  if (!roleError && r) role = r;
  if (!role) {
    const fallback = await getCompanyRoleIncludingInvited(user.id, companyId);
    if (fallback === Role.ADMIN || fallback === Role.COMPANY_ADMIN || fallback === Role.SUPER_ADMIN)
      role = fallback;
  }
  const canManage = role ? await hasPermission(role, 'MANAGE_EXTERNAL_APIS') : false;
  return { userId: user.id, canManage };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.companyId as string) || (req.body?.companyId as string);
  const apiSourceId = (req.query.api_source_id as string) || (req.body?.api_source_id as string);

  const access = await requireCompanyAccess(req, res, companyId);
  if (!access) return;

  if (req.method === 'GET') {
    if (apiSourceId) {
      const { data, error } = await supabase
        .from('company_api_configs')
        .select('*')
        .eq('company_id', companyId)
        .eq('api_source_id', apiSourceId)
        .maybeSingle();
      if (error) {
        return res.status(500).json({ error: 'Failed to load company API config', detail: error.message });
      }
      const allowedPolling = await getAllowedPollingForCompany(companyId);
      return res.status(200).json({ config: data, allowed_polling: allowedPolling });
    }
    const { data, error } = await supabase
      .from('company_api_configs')
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });
    if (error) {
      return res.status(500).json({ error: 'Failed to load company API configs', detail: error.message });
    }
    const allowedPolling = await getAllowedPollingForCompany(companyId);
    return res.status(200).json({ configs: data ?? [], allowed_polling: allowedPolling });
  }

  if (req.method === 'PUT') {
    if (!access.canManage) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (!apiSourceId) {
      return res.status(400).json({ error: 'api_source_id required' });
    }
    const body = req.body || {};
    const polling_frequency =
      body.polling_frequency != null && body.polling_frequency !== ''
        ? String(body.polling_frequency).trim()
        : null;
    if (polling_frequency && !POLLING_OPTIONS.includes(polling_frequency as any)) {
      return res.status(400).json({
        error: 'Invalid polling_frequency',
        allowed: POLLING_OPTIONS,
      });
    }
    const allowed = await isPollingAllowedForCompany(companyId, polling_frequency);
    if (!allowed) {
      const allowedList = await getAllowedPollingForCompany(companyId);
      return res.status(400).json({
        error: 'Polling frequency not allowed for your plan',
        allowed_polling: allowedList,
      });
    }
    const priority =
      body.priority != null && body.priority !== ''
        ? String(body.priority).toUpperCase()
        : null;
    if (priority && !['HIGH', 'MEDIUM', 'LOW'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority; use HIGH, MEDIUM, or LOW' });
    }
    const purposes = Array.isArray(body.purposes)
      ? body.purposes.filter((p: string) => PURPOSE_OPTIONS.includes(String(p)))
      : [];
    const include_filters = normalizeFilterRecord(
      body.include_filters && typeof body.include_filters === 'object' ? body.include_filters : {}
    );
    const exclude_filters = normalizeFilterRecord(
      body.exclude_filters && typeof body.exclude_filters === 'object' ? body.exclude_filters : {}
    );
    const limitCheck = validateFilterLimits(include_filters, exclude_filters);
    if (limitCheck.ok === false) {
      return res.status(400).json({ error: limitCheck.error });
    }
    const daily_limit =
      body.daily_limit != null && body.daily_limit !== ''
        ? parseInt(String(body.daily_limit), 10)
        : null;
    const signal_limit =
      body.signal_limit != null && body.signal_limit !== ''
        ? parseInt(String(body.signal_limit), 10)
        : null;
    const enabled = body.enabled !== false;

    const row = {
      company_id: companyId,
      api_source_id: apiSourceId,
      enabled,
      polling_frequency,
      priority,
      daily_limit: Number.isFinite(daily_limit) ? daily_limit : null,
      signal_limit: Number.isFinite(signal_limit) ? signal_limit : null,
      purposes,
      include_filters: include_filters as Record<string, unknown>,
      exclude_filters: exclude_filters as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('company_api_configs')
      .upsert(row, { onConflict: 'company_id,api_source_id' })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to save company API config', detail: error.message });
    }
    invalidateCompanyConfigCache(companyId);
    return res.status(200).json({ config: data });
  }

  if (req.method === 'DELETE') {
    if (!access.canManage) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (!apiSourceId) {
      return res.status(400).json({ error: 'api_source_id required' });
    }
    const { error } = await supabase
      .from('company_api_configs')
      .delete()
      .eq('company_id', companyId)
      .eq('api_source_id', apiSourceId);
    if (error) {
      return res.status(500).json({ error: 'Failed to remove company API config', detail: error.message });
    }
    invalidateCompanyConfigCache(companyId);
    return res.status(200).json({ removed: true });
  }

  res.setHeader('Allow', 'GET, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
