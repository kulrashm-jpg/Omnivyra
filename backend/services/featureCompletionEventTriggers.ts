/**
 * Feature Completion Event Triggers
 *
 * Automatically syncs feature completion when key actions occur.
 * Non-blocking, fire-and-forget pattern.
 *
 * Usage:
 * ```typescript
 * // In any service after creating/updating a feature
 * syncFeatureCompletionAsync(companyId)
 *   .catch(err => console.error('[feature-completion] sync failed:', err))
 * ```
 */

import { syncFeatureCompletion } from './featureCompletionSyncService';

/**
 * Debounce timer map to prevent sync spam when multiple events fire rapidly
 */
const syncDebounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * Non-blocking sync with debounce protection
 *
 * Multiple events within 50ms will be batched into single sync call.
 * Prevents API spam when (e.g.) user creates blog + connects social in quick succession.
 */
export async function syncFeatureCompletionAsync(
  companyId: string,
  options?: { debounceMs?: number },
): Promise<void> {
  const debounceMs = options?.debounceMs ?? 50;

  // Clear existing timer for this company
  const existingTimer = syncDebounceTimers.get(companyId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule sync after debounce period
  const timer = setTimeout(async () => {
    try {
      syncDebounceTimers.delete(companyId);
      await syncFeatureCompletion(companyId);
      console.log(`[feature-completion] synced features for company ${companyId}`);
    } catch (err) {
      console.error(
        `[feature-completion] sync failed for company ${companyId}:`,
        err instanceof Error ? err.message : err,
      );
      // Don't throw - this is fire-and-forget
    }
  }, debounceMs);

  syncDebounceTimers.set(companyId, timer);
}

/**
 * Helper: Immediate sync (no debounce)
 * Use when you need synchronous guarantee (e.g., before redirect)
 */
export async function syncFeatureCompletionImmediate(
  companyId: string,
): Promise<void> {
  return syncFeatureCompletionAsync(companyId, { debounceMs: 0 });
}

/**
 * Integration points map (for documentation and testing)
 * Shows all places where syncFeatureCompletionAsync should be called
 */
export const FEATURE_SYNC_TRIGGERS = [
  {
    feature: 'blog_created',
    event: 'After blog insert',
    files: [
      'backend/services/blogService.ts (createBlog function)',
      'pages/api/blog/create.ts (if exists)',
      'pages/api/blogs/create.ts (if exists)',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
  {
    feature: 'report_generated',
    event: 'After report generation',
    files: [
      'backend/services/reportService.ts (generateReport function)',
      'pages/api/reports/generate.ts (if exists)',
      'pages/api/analytics/report.ts (if exists)',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
  {
    feature: 'social_accounts_connected',
    event: 'After OAuth callback success',
    files: [
      'pages/api/auth/linkedin/callback.ts',
      'pages/api/auth/twitter/callback.ts',
      'pages/api/auth/instagram/callback.ts',
      'pages/api/auth/youtube/callback.ts',
      'pages/api/integrations/social-connect.ts (if exists)',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
  {
    feature: 'campaign_created',
    event: 'After campaign insert',
    files: [
      'backend/services/campaignService.ts (createCampaign function)',
      'pages/api/campaigns/create.ts',
      'pages/api/campaigns.ts',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
  {
    feature: 'api_configured',
    event: 'After API key saved',
    files: [
      'backend/services/apiConfigService.ts (saveApiKey function)',
      'pages/api/settings/api-keys.ts (if exists)',
      'pages/api/api-config/save.ts (if exists)',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
  {
    feature: 'company_profile_completed',
    event: 'After company profile update',
    files: [
      'backend/services/companyService.ts (updateCompanyProfile function)',
      'pages/api/settings/company.ts',
      'pages/api/company/update.ts',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
  {
    feature: 'website_connected',
    event: 'After website URL added/updated',
    files: [
      'backend/services/companyService.ts (updateWebsiteUrl function)',
      'pages/api/settings/company.ts',
      'pages/api/company/update.ts',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
  {
    feature: 'chrome_extension_installed',
    event: 'After extension installation registered',
    files: [
      'backend/services/extensionService.ts (registerExtension function)',
      'pages/api/extensions/register.ts (if exists)',
      'pages/api/settings/extensions.ts (if exists)',
    ],
    code: `syncFeatureCompletionAsync(companyId).catch(err => console.error(err))`,
  },
] as const;

/**
 * Event: Blog Created
 *
 * Add to: backend/services/blogService.ts (at end of createBlog function)
 *
 * Example:
 * ```typescript
 * export async function createBlog(
 *   companyId: string,
 *   userId: string,
 *   input: CreateBlogInput,
 * ): Promise<Blog> {
 *   // ... existing code ...
 *   const blog = await supabase.from('blogs').insert({...}).single();
 *
 *   // ADD THIS:
 *   syncFeatureCompletionAsync(companyId)
 *     .catch(err => console.error('[feature-completion] blog sync failed:', err));
 *
 *   return blog;
 * }
 * ```
 */

/**
 * Event: Report Generated
 *
 * Add to: backend/services/reportService.ts (at end of generateReport function)
 *
 * Example:
 * ```typescript
 * export async function generateReport(
 *   companyId: string,
 *   input: GenerateReportInput,
 * ): Promise<Report> {
 *   // ... existing code ...
 *   const report = await supabase.from('analytics_reports').insert({...}).single();
 *
 *   // ADD THIS:
 *   syncFeatureCompletionAsync(companyId)
 *     .catch(err => console.error('[feature-completion] report sync failed:', err));
 *
 *   return report;
 * }
 * ```
 */

/**
 * Event: Social Account Connected
 *
 * Add to: pages/api/auth/linkedin/callback.ts (and all social OAuth callbacks)
 *
 * Example:
 * ```typescript
 * export default async function handler(
 *   req: NextApiRequest,
 *   res: NextApiResponse,
 * ) {
 *   // ... OAuth flow ...
 *   const socialAccount = await supabase
 *     .from('social_accounts')
 *     .insert({...})
 *     .single();
 *
 *   // ADD THIS:
 *   syncFeatureCompletionAsync(companyId)
 *     .catch(err => console.error('[feature-completion] social sync failed:', err));
 *
 *   return res.status(200).json(socialAccount);
 * }
 * ```
 *
 * Files to update:
 * - pages/api/auth/linkedin/callback.ts
 * - pages/api/auth/twitter/callback.ts
 * - pages/api/auth/instagram/callback.ts
 * - pages/api/auth/youtube/callback.ts
 * - pages/api/auth/pinterest/callback.ts
 * - pages/api/auth/tiktok/callback.ts
 * - pages/api/auth/spotify/callback.ts
 */

/**
 * Event: Campaign Created
 *
 * Add to: backend/services/campaignService.ts (at end of createCampaign function)
 *
 * Example:
 * ```typescript
 * export async function createCampaign(
 *   companyId: string,
 *   input: CreateCampaignInput,
 * ): Promise<Campaign> {
 *   // ... existing code ...
 *   const campaign = await supabase
 *     .from('campaigns')
 *     .insert({...})
 *     .single();
 *
 *   // ADD THIS:
 *   syncFeatureCompletionAsync(companyId)
 *     .catch(err => console.error('[feature-completion] campaign sync failed:', err));
 *
 *   return campaign;
 * }
 * ```
 */

/**
 * Event: API Config Saved
 *
 * Add to: backend/services/apiConfigService.ts (at end of saveApiKey function)
 *
 * Example:
 * ```typescript
 * export async function saveApiKey(
 *   companyId: string,
 *   apiKey: string,
 *   apiSecret: string,
 * ): Promise<ApiConfig> {
 *   // ... existing code ...
 *   const config = await supabase
 *     .from('company_api_configs')
 *     .insert({...})
 *     .single();
 *
 *   // ADD THIS:
 *   syncFeatureCompletionAsync(companyId)
 *     .catch(err => console.error('[feature-completion] api config sync failed:', err));
 *
 *   return config;
 * }
 * ```
 */

/**
 * Event: Company Profile Updated
 *
 * Add to: backend/services/companyService.ts (at end of updateCompanyProfile function)
 *
 * Example:
 * ```typescript
 * export async function updateCompanyProfile(
 *   companyId: string,
 *   input: UpdateCompanyInput,
 * ): Promise<Company> {
 *   // ... existing code ...
 *   const company = await supabase
 *     .from('companies')
 *     .update({...})
 *     .eq('id', companyId)
 *     .single();
 *
 *   // ADD THIS (if name, industry, or company_size changed):
 *   syncFeatureCompletionAsync(companyId)
 *     .catch(err => console.error('[feature-completion] profile sync failed:', err));
 *
 *   return company;
 * }
 * ```
 */

/**
 * Event: Website URL Added/Updated
 *
 * Add to: backend/services/companyService.ts (at end of updateCompanyProfile or separate updateWebsiteUrl function)
 *
 * Example:
 * ```typescript
 * export async function updateCompanyProfile(
 *   companyId: string,
 *   input: UpdateCompanyInput,
 * ): Promise<Company> {
 *   // ... existing code ...
 *   const company = await supabase
 *     .from('companies')
 *     .update({...})
 *     .eq('id', companyId)
 *     .single();
 *
 *   // ADD THIS (if website_url changed):
 *   if (input.website_url && input.website_url !== company.website_url) {
 *     syncFeatureCompletionAsync(companyId)
 *       .catch(err => console.error('[feature-completion] website sync failed:', err));
 *   }
 *
 *   return company;
 * }
 * ```
 */

/**
 * Event: Chrome Extension Installed
 *
 * Add to: backend/services/extensionService.ts (at end of registerExtension function)
 *
 * Example:
 * ```typescript
 * export async function registerExtension(
 *   companyId: string,
 *   userId: string,
 *   extensionId: string,
 * ): Promise<ExtensionInstallation> {
 *   // ... existing code ...
 *   const installation = await supabase
 *     .from('extension_installations')
 *     .insert({...})
 *     .single();
 *
 *   // ADD THIS:
 *   syncFeatureCompletionAsync(companyId)
 *     .catch(err => console.error('[feature-completion] extension sync failed:', err));
 *
 *   return installation;
 * }
 * ```
 */
