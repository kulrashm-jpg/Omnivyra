import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  ensureAutomationConfig,
  type AutomationFrequency,
} from '../../../backend/services/reportAutomationService';

async function resolveCompanyId(userId: string, requestedCompanyId?: string): Promise<string | null> {
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

async function resolveDomain(companyId: string, fallback?: string): Promise<string | null> {
  if (fallback && fallback.trim().length > 0) return fallback.trim().toLowerCase();
  const { data } = await supabase
    .from('companies')
    .select('website_domain, website_url')
    .eq('id', companyId)
    .maybeSingle();
  const raw = (data?.website_domain || data?.website_url || '').toString().trim().toLowerCase();
  return raw || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const companyId = await resolveCompanyId(user.id, req.query.company_id as string | undefined);
  if (!companyId) {
    return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
  }

  if (req.method === 'GET') {
    const domain = await resolveDomain(companyId, req.query.domain as string | undefined);
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required', code: 'DOMAIN_REQUIRED' });
    }

    const { data, error } = await supabase
      .from('report_automation_configs')
      .select('id, user_id, company_id, domain, frequency, change_detection_enabled, is_active, last_run_at, next_run_at, last_checked_at, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .eq('domain', domain)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message, code: 'CONFIG_LOAD_FAILED' });
    }

    return res.status(200).json({
      config: data || null,
      defaults: {
        frequency: 'weekly',
        change_detection_enabled: true,
        is_active: true,
      },
    });
  }

  if (req.method === 'PUT') {
    const body = (req.body || {}) as {
      domain?: string;
      frequency?: AutomationFrequency;
      change_detection_enabled?: boolean;
      is_active?: boolean;
    };
    const domain = await resolveDomain(companyId, body.domain);
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required', code: 'DOMAIN_REQUIRED' });
    }

    const frequency: AutomationFrequency =
      body.frequency === 'biweekly' || body.frequency === 'monthly' || body.frequency === 'weekly'
        ? body.frequency
        : 'weekly';

    await ensureAutomationConfig({
      userId: user.id,
      companyId,
      domain,
      frequency,
      changeDetectionEnabled: body.change_detection_enabled ?? true,
    });

    if (body.is_active === false) {
      await supabase
        .from('report_automation_configs')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('company_id', companyId)
        .eq('domain', domain);
    } else if (body.is_active === true) {
      await supabase
        .from('report_automation_configs')
        .update({
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('company_id', companyId)
        .eq('domain', domain);
    }

    const { data, error } = await supabase
      .from('report_automation_configs')
      .select('id, user_id, company_id, domain, frequency, change_detection_enabled, is_active, last_run_at, next_run_at, last_checked_at, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('company_id', companyId)
      .eq('domain', domain)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message, code: 'CONFIG_SAVE_FAILED' });
    }

    return res.status(200).json({ success: true, config: data || null });
  }

  return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
}
