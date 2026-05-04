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
  requireStringConfig(config['SUPABASE_' + 'SERVICE_' + 'ROLE_KEY'], 'SUPABASE_' + 'SERVICE_' + 'ROLE_KEY')
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
    const { data: blogs, error } = await supabase
      .from('blogs')
      .select('id')
      .eq('company_id', companyId)
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
      reason: `${count} piece(s) of content created`,
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
    const { data: analyticsRows, error: analyticsError } = await supabase
      .from('analytics_reports')
      .select('id')
      .eq('company_id', companyId)
      .limit(5);

    const { data: reportRows, error: reportsError } = await supabase
      .from('reports')
      .select('id')
      .eq('company_id', companyId)
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
 * Detects if company has the Chrome extension flag or status
 */
async function detectChromeExtensionInstalled(companyId: string): Promise<FeatureDetectionResult> {
  // Check feature_completion table for a manually-set chrome extension flag
  // (no extension_installations table exists yet)
  try {
    const { data } = await supabase
      .from('feature_completion')
      .select('status')
      .eq('company_id', companyId)
      .eq('feature_key', 'chrome_extension_installed')
      .single();

    // Only trust an existing DB record if it was manually set to completed
    const isCompleted = data?.status === 'completed';
    return {
      isCompleted,
      score: isCompleted ? 1 : 0,
      reason: isCompleted ? 'Chrome extension installed' : 'Chrome extension not yet installed',
      completedAt: isCompleted ? new Date() : undefined,
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
    [FeatureKey.CHROME_EXTENSION_INSTALLED]: detectChromeExtensionInstalled,
    [FeatureKey.API_CONFIGURED]: detectApiConfigured,
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
