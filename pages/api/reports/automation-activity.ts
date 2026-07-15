import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/** Route shell — automation-activity API (Agent-B split: helpers/types in ../../../backend/apiHandlers/reports/automationActivityShared). */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

import { AutomationContext, AutomationEvent, HighlightItem, HighlightTone, NotificationEvent, ScoredHighlight, buildAlertHighlights, buildAutomationHighlights, buildAutomationPrioritySignal, buildSnapshotPrioritySignal, formatDate, getReviewWindowCopy, isMissingTableError, readList, resolveCompanyId, timeAgo, toNumber } from '../../../backend/apiHandlers/reports/automationActivityShared';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const [eventsRes, notificationsRes, latestConfigRes, latestReportRes] = await Promise.all([
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
    supabase
      .from('report_automation_configs')
      .select('id, domain, frequency, change_detection_enabled, is_active, last_run_at, next_run_at, last_triggered_report_id, created_at')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('reports')
      .select('id, domain, report_type, status, created_at, data')
      .eq('company_id', companyId)
      .eq('status', 'completed')
      .eq('report_type', 'content_readiness')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (eventsRes.error) {
    return res.status(500).json({ error: eventsRes.error.message, code: 'EVENTS_LOAD_FAILED' });
  }
  if (notificationsRes.error && !isMissingTableError(notificationsRes.error.message)) {
    return res.status(500).json({ error: notificationsRes.error.message, code: 'NOTIFICATIONS_LOAD_FAILED' });
  }

  const automationEvents = (eventsRes.data || []) as AutomationEvent[];
  const notificationEvents = notificationsRes.error ? [] : ((notificationsRes.data || []) as NotificationEvent[]);
  const latestConfig = (latestConfigRes.data || null) as Record<string, any> | null;
  const latestReport = (latestReportRes.data || null) as Record<string, any> | null;
  const companyCampaignVersionsRes = await supabase
    .from('campaign_versions')
    .select('campaign_id')
    .eq('company_id', companyId);
  const campaignIds = Array.from(new Set(((companyCampaignVersionsRes.data || []) as Array<{ campaign_id?: string | null }>)
    .map((row) => String(row.campaign_id || '').trim())
    .filter(Boolean)));
  const [socialAccountsRes, campaignsRes, scheduledPostsRes] = await Promise.all([
    supabase
      .from('social_accounts')
      .select('id, is_active')
      .eq('company_id', companyId),
    campaignIds.length > 0
      ? supabase
          .from('campaigns')
          .select('id, status')
          .in('id', campaignIds)
      : Promise.resolve({ data: [], error: null } as any),
    campaignIds.length > 0
      ? supabase
          .from('scheduled_posts')
          .select('id, status, published_at, created_at, campaign_id')
          .in('campaign_id', campaignIds)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  const socialAccounts = (socialAccountsRes.data || []) as Array<{ id: string; is_active?: boolean | null }>;
  const campaigns = (campaignsRes.data || []) as Array<{ id: string; status?: string | null }>;
  const scheduledPosts = (scheduledPostsRes.data || []) as Array<{ id: string; status?: string | null; published_at?: string | null }>;
  const automationContext: AutomationContext = {
    connectedPlatforms: socialAccounts.filter((row) => row.is_active !== false).length,
    activeCampaigns: campaigns.filter((row) => ['active', 'running', 'execution_ready'].includes(String(row.status || '').toLowerCase())).length,
    scheduledPosts30d: scheduledPosts.filter((row) => String(row.status || '').toLowerCase() === 'scheduled').length,
    publishedPosts30d: scheduledPosts.filter((row) => Boolean(row.published_at) || String(row.status || '').toLowerCase() === 'published').length,
  };
  const automationHighlights = buildAutomationHighlights({
    config: latestConfig,
    events: automationEvents,
    latestReport,
  });
  const snapshotHighlights = buildAlertHighlights({
    notifications: notificationEvents,
    latestReport,
  });
  const automationPriorityResult = buildAutomationPrioritySignal({ automation: automationContext });
  const snapshotPriorityResult = buildSnapshotPrioritySignal({
    latestReport,
  });
  const dashboardDisplayScore = Math.round((automationPriorityResult.qualityScore + snapshotPriorityResult.qualityScore) / 2);
  const showSection = dashboardDisplayScore >= 80;

  return res.status(200).json({
    automationEvents,
    notificationEvents,
    automationHighlights,
    snapshotHighlights,
    automationPrioritySignal: automationPriorityResult.highlight,
    snapshotPrioritySignal: snapshotPriorityResult.highlight,
    dashboardDisplayScore,
    showSection,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/reports/automation-activity' });
