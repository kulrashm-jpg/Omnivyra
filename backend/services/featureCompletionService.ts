/**
 * Feature Completion Auto-Detection Logic
 * Computes feature status based on actual company/user data
 * 
 * NO MANUAL UPDATES - purely computed from source data
 */

import { FeatureKey, ComputedFeature, FeatureDetectionResult } from '../types/featureCompletion';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config';

function requireStringConfig(value: unknown, key: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new Error(`Missing or invalid config value: ${key}`);
}

const supabase = createClient(
  requireStringConfig(config.SUPABASE_URL, 'SUPABASE_URL'),
  requireStringConfig(config.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
);

/**
 * COMPANY_PROFILE_COMPLETED
 * Detects if company profile is set up with required fields
 */
async function detectCompanyProfileCompleted(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const [{ data: profile }, { data: company }] = await Promise.all([
      supabase
        .from('company_profiles')
        .select('name, industry, report_settings')
        .eq('company_id', companyId)
        .maybeSingle(),
      supabase
        .from('companies')
        .select('name, industry, size')
        .eq('id', companyId)
        .maybeSingle(),
    ]);

    if (!profile && !company) {
      return { isCompleted: false, score: 0, reason: 'Company profile not found' };
    }

    const teamSize =
      profile?.report_settings &&
      typeof profile.report_settings === 'object' &&
      'company_facts' in profile.report_settings &&
      profile.report_settings.company_facts &&
      typeof profile.report_settings.company_facts === 'object' &&
      'team_size' in profile.report_settings.company_facts
        ? profile.report_settings.company_facts.team_size
        : null;

    const fields = [
      Boolean(profile?.name || company?.name),
      Boolean(profile?.industry || company?.industry),
      Boolean(teamSize || company?.size),
    ];
    const filled = fields.filter(Boolean).length;
    const score  = filled / 3;
    const isCompleted = filled === 3;

    return {
      isCompleted,
      score,
      reason: isCompleted
        ? 'Company profile complete (name, industry, size)'
        : `${filled}/3 profile fields filled`,
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { hasName: fields[0], hasIndustry: fields[1], hasSize: fields[2] },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * WEBSITE_CONNECTED
 * Detects if company has a website URL configured
 */
async function detectWebsiteConnected(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const [{ data: profile }, { data: company }] = await Promise.all([
      supabase
        .from('company_profiles')
        .select('website_url')
        .eq('company_id', companyId)
        .maybeSingle(),
      supabase
        .from('companies')
        .select('website')
        .eq('id', companyId)
        .maybeSingle(),
    ]);

    if (!profile && !company) {
      return { isCompleted: false, score: 0, reason: 'Company not found' };
    }

    const websiteUrl = profile?.website_url || company?.website || null;
    const isCompleted = Boolean(websiteUrl);
    return {
      isCompleted,
      score: isCompleted ? 1 : 0,
      reason: isCompleted ? `Website connected: ${websiteUrl}` : 'No website URL configured',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { websiteUrl },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * BLOG_CREATED
 * Detects if company has created at least one blog post
 */
async function detectBlogCreated(companyId: string): Promise<FeatureDetectionResult> {
  try {
    // Persisted/used only: a blog row is written even for transient AI drafts,
    // so a draft alone does not count. Require the content to have been
    // committed for actual use (scheduled to publish or already published).
    const { data: blogs, error } = await supabase
      .from('blogs')
      .select('id')
      .eq('company_id', companyId)
      .in('status', ['scheduled', 'published'])
      .limit(10);

    if (error) {
      return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    }

    const count = blogs?.length ?? 0;
    // 1 = 33%, 3 = 66%, 5+ = 100%
    const score = count === 0 ? 0 : count < 3 ? 0.33 : count < 5 ? 0.66 : 1;
    const isCompleted = score >= 1;

    return {
      isCompleted,
      score,
      reason: `${count} piece(s) of content scheduled/published`,
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * REPORT_GENERATED
 * Detects if company has generated at least one analytics report
 */
async function detectReportGenerated(companyId: string): Promise<FeatureDetectionResult> {
  try {
    // analytics_reports has no status column — every row is a finalized,
    // persisted snapshot, so existence counts as a generated report.
    const { data: analyticsRows, error: analyticsError } = await supabase
      .from('analytics_reports')
      .select('id')
      .eq('company_id', companyId)
      .limit(5);

    // reports has a generation lifecycle — only a fully completed report is
    // persisted/usable; pending/processing/failed runs do not count.
    const { data: reportRows, error: reportsError } = await supabase
      .from('reports')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'completed')
      .limit(5);

    if (analyticsError && reportsError) {
      return {
        isCompleted: false,
        score: 0,
        reason: `Error: ${analyticsError.message || reportsError.message}`,
      };
    }

    const ids = new Set<string>();
    (analyticsRows || []).forEach((row: { id?: string | null }) => {
      if (row?.id) ids.add(row.id);
    });
    (reportRows || []).forEach((row: { id?: string | null }) => {
      if (row?.id) ids.add(row.id);
    });
    const count = ids.size;

    // 1 = 50%, 2 = 75%, 3+ = 100%
    const score = count === 0 ? 0 : count === 1 ? 0.5 : count === 2 ? 0.75 : 1;
    const isCompleted = score >= 1;

    return {
      isCompleted,
      score,
      reason: `${count} report(s) generated`,
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * SOCIAL_ACCOUNTS_CONNECTED
 * Detects if company has connected social media accounts
 */
async function detectSocialAccountsConnected(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data: accounts, error } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(5);

    if (error) {
      return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    }

    const count = accounts?.length ?? 0;
    // 1 = 40%, 2 = 70%, 3+ = 100%
    const score = count === 0 ? 0 : count === 1 ? 0.4 : count === 2 ? 0.7 : 1;
    const isCompleted = score >= 1;

    return {
      isCompleted,
      score,
      reason: `${count} social account(s) connected`,
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * CAMPAIGN_CREATED
 * Detects if company has created at least one campaign
 */
async function detectCampaignCreated(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    if (error) {
      return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    }

    const isCompleted = (campaigns?.length ?? 0) > 0;
    return {
      isCompleted,
      score: isCompleted ? 1 : 0,
      reason: isCompleted ? 'Campaign created / staged' : 'No campaigns created yet',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { count: campaigns?.length ?? 0 },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * CAMPAIGN_PUBLISHED
 * Detects if company has at least one published / sent campaign
 */
async function detectCampaignPublished(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id')
      .eq('company_id', companyId)
      .in('status', ['published', 'sent', 'active', 'completed'])
      .limit(1);

    if (error) {
      return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    }

    const isCompleted = (campaigns?.length ?? 0) > 0;
    return {
      isCompleted,
      score: isCompleted ? 1 : 0,
      reason: isCompleted ? 'Campaign published / sent' : 'No campaigns published yet',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { count: campaigns?.length ?? 0 },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * CHROME_EXTENSION_INSTALLED
 * Sticky "ever redeemed/seen" detection: the extension is considered installed
 * once it has successfully connected at least once. A redeem / first command
 * poll creates an `extension_sessions` row keyed by `org_id` (which is the same
 * UUID as `companies.id`). Existence of ANY such row — regardless of expiry or
 * last_seen recency — means the extension was authenticated for this company,
 * so the factor never reverts even if the extension is later uninstalled.
 * A manually-set `feature_completion` flag still counts as a fallback.
 */
async function detectChromeExtensionInstalled(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const [sessionRes, flagRes] = await Promise.all([
      supabase
        .from('extension_sessions')
        .select('id, last_seen')
        .eq('org_id', companyId)
        .order('last_seen', { ascending: false, nullsFirst: false })
        .limit(1),
      supabase
        .from('feature_completion')
        .select('status')
        .eq('company_id', companyId)
        .eq('feature_key', 'chrome_extension_installed')
        .maybeSingle(),
    ]);

    const everConnected = (sessionRes.data?.length ?? 0) > 0;
    const manuallyCompleted = flagRes.data?.status === 'completed';
    const isCompleted = everConnected || manuallyCompleted;

    return {
      isCompleted,
      score: isCompleted ? 1 : 0,
      reason: everConnected
        ? 'Chrome extension connected (extension session found)'
        : manuallyCompleted
          ? 'Chrome extension installed (manually marked)'
          : 'Chrome extension not yet installed',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { everConnected, manuallyCompleted },
    };
  } catch {
    return { isCompleted: false, score: 0, reason: 'Chrome extension not yet installed' };
  }
}

/**
 * API_CONFIGURED
 * Detects if company has API keys configured
 */
async function detectApiConfigured(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data: cfg, error } = await supabase
      .from('company_api_configs')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    if (error) {
      return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    }

    const isCompleted = (cfg?.length ?? 0) > 0;
    return {
      isCompleted,
      score: isCompleted ? 1 : 0,
      reason: isCompleted ? 'API keys configured' : 'No API keys configured',
      completedAt: isCompleted ? new Date() : undefined,
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * Resolve all campaign IDs owned by a company. Several content tables
 * (bolt_content_jobs, content_assets) are campaign-scoped rather than
 * company-scoped, so we map company → campaign IDs first.
 */
async function getCompanyCampaignIds(companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id')
    .eq('company_id', companyId)
    .limit(500);
  if (error) return [];
  return (data || [])
    .map((row: { id?: string | null }) => row?.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * CONTENT_WRITER — long-form writer content (blogs table holds long-form
 * pieces). Persisted/used only: scheduled or published, not raw drafts.
 * Tier: 1 → 40%, 2 → 70%, 3+ → 100%.
 */
async function detectContentWriter(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data, error } = await supabase
      .from('blogs')
      .select('id')
      .eq('company_id', companyId)
      .in('status', ['scheduled', 'published'])
      .limit(5);
    if (error) return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    const count = data?.length ?? 0;
    const score = count === 0 ? 0 : count === 1 ? 0.4 : count === 2 ? 0.7 : 1;
    return {
      isCompleted: score >= 1,
      score,
      reason: `${count} long-form writer piece(s)`,
      completedAt: score >= 1 ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * CONTENT_SHORT_FORMAT — short posts (post / tweet / poll) generated and
 * completed via the BOLT pipeline. Tier: 1 → 40%, 3 → 70%, 5+ → 100%.
 */
async function detectContentShortFormat(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const campaignIds = await getCompanyCampaignIds(companyId);
    if (campaignIds.length === 0) {
      return { isCompleted: false, score: 0, reason: 'No short-format content yet', metadata: { count: 0 } };
    }
    const { data, error } = await supabase
      .from('bolt_content_jobs')
      .select('id')
      .in('campaign_id', campaignIds)
      .in('content_type', ['post', 'tweet', 'poll', 'short_story'])
      .eq('status', 'done')
      .limit(5);
    if (error) return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    const count = data?.length ?? 0;
    const score = count === 0 ? 0 : count >= 5 ? 1 : count >= 3 ? 0.7 : 0.4;
    return {
      isCompleted: score >= 1,
      score,
      reason: `${count} short-format post(s) completed`,
      completedAt: score >= 1 ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * CONTENT_CREATOR — short-form creator media (reel / video / short / story)
 * completed via the BOLT pipeline. Tier: 1 → 50%, 2 → 75%, 3+ → 100%.
 */
async function detectContentCreator(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const campaignIds = await getCompanyCampaignIds(companyId);
    if (campaignIds.length === 0) {
      return { isCompleted: false, score: 0, reason: 'No creator content yet', metadata: { count: 0 } };
    }
    const { data, error } = await supabase
      .from('bolt_content_jobs')
      .select('id')
      .in('campaign_id', campaignIds)
      .in('content_type', ['reel', 'video', 'short', 'story'])
      .eq('status', 'done')
      .limit(5);
    if (error) return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    const count = data?.length ?? 0;
    const score = count === 0 ? 0 : count === 1 ? 0.5 : count === 2 ? 0.75 : 1;
    return {
      isCompleted: score >= 1,
      score,
      reason: `${count} creator media piece(s) completed`,
      completedAt: score >= 1 ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * CONTENT_WRITER_ASSET — content paired with a produced visual asset
 * (content_assets row past the draft stage). Tier: 1 → 60%, 2+ → 100%.
 */
async function detectContentWriterAsset(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const campaignIds = await getCompanyCampaignIds(companyId);
    if (campaignIds.length === 0) {
      return { isCompleted: false, score: 0, reason: 'No content assets yet', metadata: { count: 0 } };
    }
    const { data, error } = await supabase
      .from('content_assets')
      .select('asset_id')
      .in('campaign_id', campaignIds)
      .neq('status', 'draft')
      .limit(2);
    if (error) return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    const count = data?.length ?? 0;
    const score = count === 0 ? 0 : count === 1 ? 0.6 : 1;
    return {
      isCompleted: score >= 1,
      score,
      reason: `${count} content asset(s) attached`,
      completedAt: score >= 1 ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * MARKET_PULSE_USED — generated Market Pulse intelligence (comparative or
 * opportunity signals). Tier: 1 → 50%, 3+ → 100%.
 */
async function detectMarketPulseUsed(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const [cmp, opp] = await Promise.all([
      supabase
        .from('marketpulse_comparative_intelligence')
        .select('id')
        .eq('company_id', companyId)
        .limit(3),
      supabase
        .from('marketpulse_opportunity_intelligence')
        .select('id')
        .eq('company_id', companyId)
        .limit(3),
    ]);
    const count = (cmp.data?.length ?? 0) + (opp.data?.length ?? 0);
    const score = count === 0 ? 0 : count >= 3 ? 1 : count === 1 ? 0.5 : 0.75;
    return {
      isCompleted: score >= 1,
      score,
      reason: `${count} Market Pulse signal(s)`,
      completedAt: score >= 1 ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * ACTIVE_LEADS_USED — lead signals detected for the org (engagement or
 * listening). Tier: 1 → 50%, 5+ → 100%.
 */
async function detectActiveLeadsUsed(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data, error } = await supabase
      .from('lead_signals')
      .select('id')
      .eq('organization_id', companyId)
      .limit(5);
    if (error) return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    const count = data?.length ?? 0;
    const score = count === 0 ? 0 : count >= 5 ? 1 : count === 1 ? 0.5 : 0.5 + (count - 1) * 0.125;
    return {
      isCompleted: score >= 1,
      score,
      reason: `${count} active lead signal(s)`,
      completedAt: score >= 1 ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * RECURRING_ENGAGEMENT — the org has actually engaged in the past: at least one
 * OUTBOUND engagement message (an auto-reply / DM the org sent) exists. This is the
 * durable "log to check" — engagement history survives even after auto-reply/auto-DM
 * is later toggled off, so mastery credit for the capability is never lost ("done
 * once = scored forever"). Pure proof: any outbound engagement → 100%.
 *
 * engagement_messages carries no org column; it joins to engagement_threads
 * (organization_id) via thread_id, so we resolve the org's threads first, then look
 * for any outgoing message within them.
 */
async function detectRecurringEngagement(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data: threads, error: tErr } = await supabase
      .from('engagement_threads')
      .select('id')
      .eq('organization_id', companyId)
      .order('created_at', { ascending: false })
      .limit(300);
    if (tErr) return { isCompleted: false, score: 0, reason: `Error: ${tErr.message}` };
    const threadIds = (threads ?? []).map((t) => (t as { id: string }).id);
    if (threadIds.length === 0) {
      return { isCompleted: false, score: 0, reason: 'No engagement activity yet' };
    }
    const { data: sent, error: mErr } = await supabase
      .from('engagement_messages')
      .select('id')
      .in('thread_id', threadIds)
      .eq('direction', 'outgoing')
      .limit(1);
    if (mErr) return { isCompleted: false, score: 0, reason: `Error: ${mErr.message}` };
    const engaged = (sent?.length ?? 0) > 0;
    return {
      isCompleted: engaged,
      score: engaged ? 1 : 0,
      reason: engaged ? 'Engaged in the past (auto-reply / DM sent)' : 'No outbound engagement yet',
      completedAt: engaged ? new Date() : undefined,
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * FREE_CREDITS_USED — the org actually spent shared free credits on real
 * product actions (credit_transactions: deduction, category='free').
 * Tier: 1 → 40%, 3 → 70%, 5+ → 100%.
 */
async function detectFreeCreditsUsed(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('id')
      .eq('organization_id', companyId)
      .eq('transaction_type', 'deduction')
      .eq('category', 'free')
      .limit(5);
    if (error) return { isCompleted: false, score: 0, reason: `Error: ${error.message}` };
    const count = data?.length ?? 0;
    const score = count === 0 ? 0 : count >= 5 ? 1 : count >= 3 ? 0.7 : 0.4;
    return {
      isCompleted: score >= 1,
      score,
      reason: `${count} free-credit action(s) used`,
      completedAt: score >= 1 ? new Date() : undefined,
      metadata: { count },
    };
  } catch (err) {
    return { isCompleted: false, score: 0, reason: `Error: ${(err as Error).message}` };
  }
}

/**
 * Compute feature completion for a company
 * Runs all detection logic and returns array of computed features
 * 
 * @param companyId Company UUID
 * @param userId Optional user UUID
 * @returns Array of computed feature statuses
 */
export async function computeFeatureCompletion(
  companyId: string,
  userId?: string
): Promise<ComputedFeature[]> {
  const detectors: Record<FeatureKey, (cid: string) => Promise<FeatureDetectionResult>> = {
    [FeatureKey.COMPANY_PROFILE_COMPLETED]: detectCompanyProfileCompleted,
    [FeatureKey.WEBSITE_CONNECTED]: detectWebsiteConnected,
    [FeatureKey.BLOG_CREATED]: detectBlogCreated,
    [FeatureKey.REPORT_GENERATED]: detectReportGenerated,
    [FeatureKey.SOCIAL_ACCOUNTS_CONNECTED]: detectSocialAccountsConnected,
    [FeatureKey.CAMPAIGN_CREATED]: detectCampaignCreated,
    [FeatureKey.CAMPAIGN_PUBLISHED]: detectCampaignPublished,
    [FeatureKey.RECURRING_ENGAGEMENT]: detectRecurringEngagement,
    [FeatureKey.CHROME_EXTENSION_INSTALLED]: detectChromeExtensionInstalled,
    [FeatureKey.API_CONFIGURED]: detectApiConfigured,
    [FeatureKey.CONTENT_WRITER]: detectContentWriter,
    [FeatureKey.CONTENT_SHORT_FORMAT]: detectContentShortFormat,
    [FeatureKey.CONTENT_CREATOR]: detectContentCreator,
    [FeatureKey.CONTENT_WRITER_ASSET]: detectContentWriterAsset,
    [FeatureKey.MARKET_PULSE_USED]: detectMarketPulseUsed,
    [FeatureKey.ACTIVE_LEADS_USED]: detectActiveLeadsUsed,
    [FeatureKey.FREE_CREDITS_USED]: detectFreeCreditsUsed,
  };

  const results = await Promise.all(
    Object.entries(detectors).map(async ([featureKey, detector]) => {
      const result = await detector(companyId);
      // Derive status from score: 0 = not_started, 0<s<1 = in_progress, 1 = completed
      const status: ComputedFeature['status'] =
        result.score >= 1 ? 'completed' : result.score > 0 ? 'in_progress' : 'not_started';
      return {
        key: featureKey as FeatureKey,
        status,
        score: result.score,
        completedAt: result.completedAt,
        reason: result.reason,
      };
    })
  );

  return results;
}
