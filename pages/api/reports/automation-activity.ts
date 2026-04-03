import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const companyId = await resolveCompanyId(user.id, req.query.company_id as string | undefined);
  if (!companyId) {
    return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
  }

  const [eventsRes, notificationsRes] = await Promise.all([
    supabase
      .from('report_automation_events')
      .select('id, type, domain, triggered_at, report_id, details')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .order('triggered_at', { ascending: false })
      .limit(20),
    supabase
      .from('report_notification_events')
      .select('id, type, domain, message, linked_report_id, created_at, is_read')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (eventsRes.error) {
    return res.status(500).json({ error: eventsRes.error.message, code: 'EVENTS_LOAD_FAILED' });
  }
  if (notificationsRes.error) {
    return res.status(500).json({ error: notificationsRes.error.message, code: 'NOTIFICATIONS_LOAD_FAILED' });
  }

  return res.status(200).json({
    automationEvents: eventsRes.data || [],
    notificationEvents: notificationsRes.data || [],
  });
}
