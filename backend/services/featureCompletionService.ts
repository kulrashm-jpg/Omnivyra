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
    const { data: company, error } = await supabase
      .from('companies')
      .select('name, industry, company_size')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      return {
        isCompleted: false,
        reason: 'Company profile not found',
      };
    }

    const isCompleted = Boolean(company.name && company.industry && company.company_size);
    
    return {
      isCompleted,
      reason: isCompleted 
        ? 'Company profile has name, industry, and size'
        : 'Missing one or more required fields: name, industry, company_size',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: {
        hasName: Boolean(company.name),
        hasIndustry: Boolean(company.industry),
        hasSize: Boolean(company.company_size),
      },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking company profile: ${(err as Error).message}`,
    };
  }
}

/**
 * WEBSITE_CONNECTED
 * Detects if company has a website URL configured
 */
async function detectWebsiteConnected(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data: company, error } = await supabase
      .from('companies')
      .select('website_url')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      return {
        isCompleted: false,
        reason: 'Company not found',
      };
    }

    const isCompleted = Boolean(company.website_url);
    
    return {
      isCompleted,
      reason: isCompleted 
        ? `Website connected: ${company.website_url}`
        : 'No website URL configured',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: {
        websiteUrl: company.website_url,
      },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking website: ${(err as Error).message}`,
    };
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
      .select('id', { count: 'exact' })
      .eq('company_id', companyId)
      .limit(1);

    if (error) {
      return {
        isCompleted: false,
        reason: `Error checking blogs: ${error.message}`,
      };
    }

    const blogCount = blogs?.length ?? 0;
    const isCompleted = blogCount > 0;
    
    return {
      isCompleted,
      reason: isCompleted 
        ? `${blogCount} blog post(s) created`
        : 'No blog posts created yet',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: {
        blogCount,
      },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking blogs: ${(err as Error).message}`,
    };
  }
}

/**
 * REPORT_GENERATED
 * Detects if company has generated at least one analytics report
 */
async function detectReportGenerated(companyId: string): Promise<FeatureDetectionResult> {
  try {
    // Check for generated reports (adjust table name as needed)
    const { data: reports, error } = await supabase
      .from('analytics_reports')
      .select('id', { count: 'exact' })
      .eq('company_id', companyId)
      .limit(1);

    if (error) {
      // Try alternative table name
      const { data: reports2 } = await supabase
        .from('reports')
        .select('id', { count: 'exact' })
        .eq('company_id', companyId)
        .limit(1);

      const reportCount = reports2?.length ?? 0;
      const isCompleted = reportCount > 0;
      
      return {
        isCompleted,
        reason: isCompleted 
          ? `${reportCount} report(s) generated`
          : 'No reports generated yet',
        completedAt: isCompleted ? new Date() : undefined,
        metadata: { reportCount },
      };
    }

    const reportCount = reports?.length ?? 0;
    const isCompleted = reportCount > 0;
    
    return {
      isCompleted,
      reason: isCompleted 
        ? `${reportCount} report(s) generated`
        : 'No reports generated yet',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { reportCount },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking reports: ${(err as Error).message}`,
    };
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
      .select('id', { count: 'exact' })
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(1);

    if (error) {
      return {
        isCompleted: false,
        reason: `Error checking social accounts: ${error.message}`,
      };
    }

    const accountCount = accounts?.length ?? 0;
    const isCompleted = accountCount > 0;
    
    return {
      isCompleted,
      reason: isCompleted 
        ? `${accountCount} social account(s) connected`
        : 'No social accounts connected',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { accountCount },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking social accounts: ${(err as Error).message}`,
    };
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
      .select('id', { count: 'exact' })
      .eq('company_id', companyId)
      .limit(1);

    if (error) {
      return {
        isCompleted: false,
        reason: `Error checking campaigns: ${error.message}`,
      };
    }

    const campaignCount = campaigns?.length ?? 0;
    const isCompleted = campaignCount > 0;
    
    return {
      isCompleted,
      reason: isCompleted 
        ? `${campaignCount} campaign(s) created`
        : 'No campaigns created yet',
      completedAt: isCompleted ? new Date() : undefined,
      metadata: { campaignCount },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking campaigns: ${(err as Error).message}`,
    };
  }
}

/**
 * CHROME_EXTENSION_INSTALLED
 * Detects if company has the Chrome extension flag or status
 */
async function detectChromeExtensionInstalled(companyId: string): Promise<FeatureDetectionResult> {
  try {
    // Check if company has extension metadata or flag
    const { data: company, error } = await supabase
      .from('companies')
      .select('metadata')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      return {
        isCompleted: false,
        reason: 'Company not found',
      };
    }

    const extensionFlag = company.metadata?.chrome_extension_installed ?? false;
    
    // Also check for extension records (adjust table as needed)
    const { data: extensions } = await supabase
      .from('extension_installations')
      .select('id', { count: 'exact' })
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(1);

    const hasExtension = extensionFlag || (extensions?.length ?? 0) > 0;
    
    return {
      isCompleted: hasExtension,
      reason: hasExtension 
        ? 'Chrome extension installed'
        : 'Chrome extension not installed',
      completedAt: hasExtension ? new Date() : undefined,
      metadata: {
        viaMetadata: extensionFlag,
        viaTable: (extensions?.length ?? 0) > 0,
      },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking extension: ${(err as Error).message}`,
    };
  }
}

/**
 * API_CONFIGURED
 * Detects if company has API keys configured
 */
async function detectApiConfigured(companyId: string): Promise<FeatureDetectionResult> {
  try {
    const { data: config, error } = await supabase
      .from('company_api_configs')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    if (error) {
      return {
        isCompleted: false,
        reason: `Error checking API config: ${error.message}`,
      };
    }

    const hasConfig = (config?.length ?? 0) > 0;
    
    return {
      isCompleted: hasConfig,
      reason: hasConfig 
        ? 'API keys configured'
        : 'No API keys configured',
      completedAt: hasConfig ? new Date() : undefined,
      metadata: {
        configCount: config?.length ?? 0,
      },
    };
  } catch (err) {
    return {
      isCompleted: false,
      reason: `Error checking API config: ${(err as Error).message}`,
    };
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
  const features: ComputedFeature[] = [];

  // Map feature keys to detection functions
  const detectors: Record<FeatureKey, (cid: string) => Promise<FeatureDetectionResult>> = {
    [FeatureKey.COMPANY_PROFILE_COMPLETED]: detectCompanyProfileCompleted,
    [FeatureKey.WEBSITE_CONNECTED]: detectWebsiteConnected,
    [FeatureKey.BLOG_CREATED]: detectBlogCreated,
    [FeatureKey.REPORT_GENERATED]: detectReportGenerated,
    [FeatureKey.SOCIAL_ACCOUNTS_CONNECTED]: detectSocialAccountsConnected,
    [FeatureKey.CAMPAIGN_CREATED]: detectCampaignCreated,
    [FeatureKey.CHROME_EXTENSION_INSTALLED]: detectChromeExtensionInstalled,
    [FeatureKey.API_CONFIGURED]: detectApiConfigured,
  };

  // Run all detectors in parallel
  const detectionPromises = Object.entries(detectors).map(async ([featureKey, detector]) => {
    const result = await detector(companyId);
    return {
      key: featureKey as FeatureKey,
      status: result.isCompleted ? ('completed' as const) : ('not_started' as const),
      completedAt: result.completedAt,
      reason: result.reason,
    };
  });

  await Promise.all(detectionPromises).then(results => {
    features.push(...results);
  });

  return features;
}
