import { supabase } from '../db/supabaseClient';
import { getProfile, saveProfile, type CompanyProfile } from './companyProfileService';

export type ReportRequestPayload = {
  formData?: Record<string, unknown> | null;
  generationContext?: Record<string, unknown> | null;
};

export type ResolvedReportCategory = 'snapshot' | 'performance' | 'growth';

export type ReportIntegrationKey =
  | 'google_analytics'
  | 'google_search_console'
  | 'google_ads'
  | 'linkedin_ads'
  | 'meta_ads'
  | 'shopify'
  | 'woocommerce'
  | 'social_accounts'
  | 'wordpress'
  | 'custom_blog_api'
  | 'lead_webhook'
  | 'website_crawl'
  | 'data_upload'
  | 'manual_entry';

export type ReportIntegrationState = Record<
  ReportIntegrationKey,
  {
    connected: boolean;
    source: 'company_profile' | 'company_integrations' | 'social_accounts' | 'request_payload' | 'system';
    label: string;
  }
>;

export type ReportDefaultInputs = {
  company_name: string | null;
  website_domain: string | null;
  business_type: string | null;
  geography: string | null;
  social_links: string[];
  competitors: string[];
};

export type ReportCompanyContext = {
  marketFocus: string | null;
  productServices: string[];
  targetCustomer: string | null;
  idealCustomerProfile: string | null;
  brandPositioning: string | null;
  competitiveAdvantages: string | null;
  teamSize: string | null;
  foundedYear: string | null;
  revenueRange: string | null;
};

export type ResolvedReportInput = {
  companyId: string;
  reportCategory: ResolvedReportCategory;
  profile: CompanyProfile | null;
  requestPayload: ReportRequestPayload;
  defaults: ReportDefaultInputs;
  resolved: {
    companyName: string | null;
    websiteDomain: string | null;
    businessType: string | null;
    geography: string | null;
    socialLinks: string[];
    competitors: string[];
    source: 'integrations' | 'upload' | 'manual' | 'manual-entry' | 'unknown';
    uploadedFileName: string | null;
    manualData: Record<string, unknown> | null;
    companyContext: ReportCompanyContext;
  };
  integrations: ReportIntegrationState;
};

type CompanyIntegrationRow = {
  type?: string | null;
  name?: string | null;
  status?: string | null;
  config?: Record<string, unknown> | null;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDomain(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) return null;
  return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
}

function splitLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => splitLines(item))
      .filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  return value
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push(item.trim());
  }

  return results;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function createIntegrationState(): ReportIntegrationState {
  return {
    google_analytics: { connected: false, source: 'system', label: 'Google Analytics' },
    google_search_console: { connected: false, source: 'system', label: 'Google Search Console' },
    google_ads: { connected: false, source: 'system', label: 'Google Ads' },
    linkedin_ads: { connected: false, source: 'system', label: 'LinkedIn Ads' },
    meta_ads: { connected: false, source: 'system', label: 'Meta Ads' },
    shopify: { connected: false, source: 'system', label: 'Shopify' },
    woocommerce: { connected: false, source: 'system', label: 'WooCommerce' },
    social_accounts: { connected: false, source: 'system', label: 'Social Accounts' },
    wordpress: { connected: false, source: 'system', label: 'WordPress' },
    custom_blog_api: { connected: false, source: 'system', label: 'Custom Blog API' },
    lead_webhook: { connected: false, source: 'system', label: 'Lead Webhook' },
    website_crawl: { connected: true, source: 'system', label: 'Website Crawl' },
    data_upload: { connected: false, source: 'system', label: 'Uploaded Data File' },
    manual_entry: { connected: false, source: 'system', label: 'Manual Data Entry' },
  };
}

function markConnected(
  integrations: ReportIntegrationState,
  key: ReportIntegrationKey,
  source: ReportIntegrationState[ReportIntegrationKey]['source'],
): void {
  integrations[key] = {
    ...integrations[key],
    connected: true,
    source,
  };
}

function includesKeyword(row: CompanyIntegrationRow, patterns: string[]): boolean {
  const haystack = [
    row.type,
    row.name,
    typeof row.config === 'object' && row.config ? JSON.stringify(row.config) : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return patterns.some((pattern) => haystack.includes(pattern));
}

async function loadCompanyIntegrationState(
  companyId: string,
  payload: ReportRequestPayload,
  profile: CompanyProfile | null,
): Promise<ReportIntegrationState> {
  const integrations = createIntegrationState();

  const [{ data: rows }, { data: roleRows }, storedFlags] = await Promise.all([
    supabase
      .from('company_integrations')
      .select('type, name, status, config')
      .eq('company_id', companyId),
    supabase
      .from('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active'),
    Promise.resolve(
      ((profile?.report_settings as Record<string, unknown> | null)?.integrations ?? {}) as Record<string, unknown>,
    ),
  ]);

  const activeRows = ((rows ?? []) as CompanyIntegrationRow[]).filter((row) => row.status === 'connected');

  for (const row of activeRows) {
    if (row.type === 'wordpress') markConnected(integrations, 'wordpress', 'company_integrations');
    if (row.type === 'custom_blog_api') markConnected(integrations, 'custom_blog_api', 'company_integrations');
    if (row.type === 'lead_webhook') markConnected(integrations, 'lead_webhook', 'company_integrations');

    if (includesKeyword(row, ['google analytics', 'ga4'])) markConnected(integrations, 'google_analytics', 'company_integrations');
    if (includesKeyword(row, ['search console', 'gsc'])) markConnected(integrations, 'google_search_console', 'company_integrations');
    if (includesKeyword(row, ['google ads'])) markConnected(integrations, 'google_ads', 'company_integrations');
    if (includesKeyword(row, ['linkedin ads'])) markConnected(integrations, 'linkedin_ads', 'company_integrations');
    if (includesKeyword(row, ['meta ads', 'facebook ads'])) markConnected(integrations, 'meta_ads', 'company_integrations');
    if (includesKeyword(row, ['shopify'])) markConnected(integrations, 'shopify', 'company_integrations');
    if (includesKeyword(row, ['woocommerce', 'woo commerce'])) markConnected(integrations, 'woocommerce', 'company_integrations');
  }

  const userIds = ((roleRows ?? []) as Array<{ user_id?: string | null }>)
    .map((row) => row.user_id)
    .filter((value): value is string => Boolean(value));

  if (userIds.length > 0) {
    const { data: socialAccounts } = await supabase
      .from('social_accounts')
      .select('id')
      .in('user_id', userIds)
      .eq('is_active', true)
      .limit(1);

    if ((socialAccounts ?? []).length > 0) {
      markConnected(integrations, 'social_accounts', 'social_accounts');
    }
  }

  for (const key of Object.keys(integrations) as ReportIntegrationKey[]) {
    if (storedFlags[key] === true) {
      markConnected(integrations, key, 'company_profile');
    }
  }

  const source = normalizeString(payload.generationContext?.source)?.toLowerCase();
  const uploadedFileName = normalizeString(payload.generationContext?.uploadedFileName);
  const manualData =
    payload.generationContext?.manualData && typeof payload.generationContext.manualData === 'object'
      ? (payload.generationContext.manualData as Record<string, unknown>)
      : null;

  if (source === 'upload' || uploadedFileName) {
    markConnected(integrations, 'data_upload', 'request_payload');
  }

  if (
    source === 'manual' ||
    (manualData && Object.values(manualData).some((value) => normalizeString(value)))
  ) {
    markConnected(integrations, 'manual_entry', 'request_payload');
  }

  return integrations;
}

function getDefaultInputs(profile: CompanyProfile | null): ReportDefaultInputs {
  const reportSettings = (profile?.report_settings as Record<string, unknown> | null) ?? {};
  const storedDefaults = (reportSettings.default_inputs as Record<string, unknown> | null) ?? {};

  return {
    company_name: normalizeString(storedDefaults.company_name) ?? normalizeString(profile?.name) ?? null,
    website_domain:
      normalizeDomain(storedDefaults.website_domain) ??
      normalizeDomain(profile?.website_url) ??
      null,
    business_type:
      normalizeString(storedDefaults.business_type) ??
      normalizeString(profile?.category) ??
      normalizeString(profile?.industry) ??
      null,
    geography:
      normalizeString(storedDefaults.geography) ??
      normalizeString(profile?.geography) ??
      (Array.isArray(profile?.geography_list) && profile.geography_list.length > 0 ? profile.geography_list[0] : null),
    social_links: dedupe([
      ...splitLines(storedDefaults.social_links),
      ...splitLines(profile?.linkedin_url),
      ...splitLines(profile?.facebook_url),
      ...splitLines(profile?.instagram_url),
      ...splitLines(profile?.x_url),
      ...splitLines(profile?.youtube_url),
      ...splitLines(profile?.tiktok_url),
      ...splitLines(profile?.reddit_url),
      ...splitLines(profile?.blog_url),
      ...(Array.isArray(profile?.other_social_links)
        ? profile.other_social_links.flatMap((entry) => splitLines(entry?.url))
        : []),
    ]),
    competitors: dedupe([
      ...splitLines(storedDefaults.competitors),
      ...splitLines(profile?.competitors),
      ...(Array.isArray(profile?.competitors_list) ? profile.competitors_list : []),
    ]),
  };
}

function resolveBusinessType(
  defaults: ReportDefaultInputs,
  payload: ReportRequestPayload,
): string | null {
  return normalizeString(payload.formData?.businessType) ?? defaults.business_type;
}

function resolveGeography(defaults: ReportDefaultInputs, payload: ReportRequestPayload): string | null {
  return normalizeString(payload.formData?.targetGeography) ?? defaults.geography;
}

function resolveCompanyName(defaults: ReportDefaultInputs, payload: ReportRequestPayload): string | null {
  return normalizeString(payload.formData?.companyName) ?? defaults.company_name;
}

function resolveSocialLinks(defaults: ReportDefaultInputs, payload: ReportRequestPayload): string[] {
  return dedupe([...defaults.social_links, ...splitLines(payload.formData?.socialLinks)]);
}

function resolveCompetitors(defaults: ReportDefaultInputs, payload: ReportRequestPayload): string[] {
  const manualData =
    payload.generationContext?.manualData && typeof payload.generationContext.manualData === 'object'
      ? (payload.generationContext.manualData as Record<string, unknown>)
      : null;

  return dedupe([
    ...defaults.competitors,
    ...splitLines(payload.formData?.competitors),
    ...splitLines(manualData?.competitors),
  ]);
}

async function loadCompanyFirmographics(companyId: string): Promise<{
  teamSize: string | null;
}> {
  const { data } = await supabase
    .from('companies')
    .select('company_size')
    .eq('id', companyId)
    .maybeSingle();

  return {
    teamSize: normalizeString((data as { company_size?: unknown } | null)?.company_size),
  };
}

function resolveCompanyContext(params: {
  profile: CompanyProfile | null;
  payload: ReportRequestPayload;
  defaults: ReportDefaultInputs;
  firmographics: {
    teamSize: string | null;
  };
}): ReportCompanyContext {
  const manualData =
    params.payload.generationContext?.manualData && typeof params.payload.generationContext.manualData === 'object'
      ? (params.payload.generationContext.manualData as Record<string, unknown>)
      : null;

  const productServices = dedupe([
    ...splitLines(params.payload.formData?.productServices),
    ...splitLines(params.payload.formData?.services),
    ...splitLines(manualData?.productServices),
    ...splitLines(manualData?.services),
    ...(Array.isArray(params.profile?.products_services_list) ? params.profile.products_services_list : []),
    ...splitLines(params.profile?.products_services),
  ]);

  return {
    marketFocus: firstNonEmptyString(
      params.payload.formData?.marketFocus,
      manualData?.marketFocus,
      manualData?.market,
      params.defaults.business_type,
      params.profile?.campaign_focus,
      params.profile?.content_strategy,
      params.profile?.category,
      params.profile?.industry,
    ),
    productServices,
    targetCustomer: firstNonEmptyString(
      params.payload.formData?.targetCustomer,
      manualData?.targetCustomer,
      params.profile?.target_customer_segment,
      params.profile?.target_audience,
    ),
    idealCustomerProfile: firstNonEmptyString(
      params.payload.formData?.idealCustomerProfile,
      manualData?.idealCustomerProfile,
      params.profile?.ideal_customer_profile,
    ),
    brandPositioning: firstNonEmptyString(
      params.payload.formData?.brandPositioning,
      manualData?.brandPositioning,
      params.profile?.brand_positioning,
      params.profile?.unique_value,
    ),
    competitiveAdvantages: firstNonEmptyString(
      params.payload.formData?.competitiveAdvantages,
      manualData?.competitiveAdvantages,
      params.profile?.competitive_advantages,
    ),
    teamSize: firstNonEmptyString(
      params.payload.formData?.teamSize,
      manualData?.teamSize,
      manualData?.companySize,
      params.profile?.report_settings?.company_facts?.team_size,
      params.firmographics.teamSize,
    ),
    foundedYear: firstNonEmptyString(
      params.payload.formData?.foundedYear,
      manualData?.foundedYear,
      manualData?.founded,
      params.profile?.report_settings?.company_facts?.founded_year,
    ),
    revenueRange: firstNonEmptyString(
      params.payload.formData?.revenueRange,
      manualData?.revenueRange,
      manualData?.revenue,
      manualData?.annualRevenue,
      params.profile?.report_settings?.company_facts?.revenue_range,
    ),
  };
}

function resolveInputSource(payload: ReportRequestPayload): ResolvedReportInput['resolved']['source'] {
  const source = normalizeString(payload.generationContext?.source)?.toLowerCase();

  if (source === 'integrations' || source === 'upload' || source === 'manual' || source === 'manual-entry') {
    return source as ResolvedReportInput['resolved']['source'];
  }

  return 'unknown';
}

export async function resolveReportInput(params: {
  companyId: string;
  reportCategory: ResolvedReportCategory;
  requestPayload?: ReportRequestPayload | null;
}): Promise<ResolvedReportInput> {
  const requestPayload = params.requestPayload ?? {};
  const profile = await getProfile(params.companyId, { autoRefine: false, languageRefine: true });
  const defaults = getDefaultInputs(profile);
  const [integrations, firmographics] = await Promise.all([
    loadCompanyIntegrationState(params.companyId, requestPayload, profile),
    loadCompanyFirmographics(params.companyId),
  ]);

  const companyDomain =
    normalizeDomain(requestPayload.formData?.domain) ??
    normalizeDomain(defaults.website_domain) ??
    normalizeDomain(profile?.website_url);

  return {
    companyId: params.companyId,
    reportCategory: params.reportCategory,
    profile,
    requestPayload,
    defaults,
    resolved: {
      companyName: resolveCompanyName(defaults, requestPayload),
      websiteDomain: companyDomain,
      businessType: resolveBusinessType(defaults, requestPayload),
      geography: resolveGeography(defaults, requestPayload),
      socialLinks: resolveSocialLinks(defaults, requestPayload),
      competitors: resolveCompetitors(defaults, requestPayload),
      source: resolveInputSource(requestPayload),
      uploadedFileName: normalizeString(requestPayload.generationContext?.uploadedFileName),
      manualData:
        requestPayload.generationContext?.manualData && typeof requestPayload.generationContext.manualData === 'object'
          ? (requestPayload.generationContext.manualData as Record<string, unknown>)
          : null,
      companyContext: resolveCompanyContext({
        profile,
        payload: requestPayload,
        defaults,
        firmographics,
      }),
    },
    integrations,
  };
}

export async function persistResolvedReportInputs(input: ResolvedReportInput): Promise<void> {
  const socialProfiles = input.resolved.socialLinks
    .slice(0, 20)
    .map((url) => ({
      platform: url.toLowerCase().includes('linkedin') ? 'linkedin' :
        url.toLowerCase().includes('instagram') ? 'instagram' :
          url.toLowerCase().includes('facebook') ? 'facebook' :
            url.toLowerCase().includes('youtube') ? 'youtube' :
              url.toLowerCase().includes('tiktok') ? 'tiktok' :
                url.toLowerCase().includes('reddit') ? 'reddit' :
                  url.toLowerCase().includes('twitter') || url.toLowerCase().includes('x.com') ? 'x' :
                    'other',
      url,
      source: 'report_input',
      confidence: 'high',
    }));

  const reportSettings = {
    ...(input.profile?.report_settings ?? {}),
    default_inputs: {
      company_name: input.resolved.companyName,
      website_domain: input.resolved.websiteDomain,
      business_type: input.resolved.businessType,
      geography: input.resolved.geography,
      social_links: input.resolved.socialLinks,
      competitors: input.resolved.competitors,
    },
    integrations: Object.fromEntries(
      (Object.keys(input.integrations) as ReportIntegrationKey[]).map((key) => [key, input.integrations[key].connected]),
    ),
    last_report_source: input.resolved.source,
    last_uploaded_file_name: input.resolved.uploadedFileName,
    updated_at: new Date().toISOString(),
  };

  await saveProfile(
    {
      company_id: input.companyId,
      name: input.resolved.companyName ?? input.profile?.name ?? undefined,
      website_url: input.resolved.websiteDomain ?? input.profile?.website_url ?? undefined,
      category: input.resolved.businessType ?? input.profile?.category ?? undefined,
      geography: input.resolved.geography ?? input.profile?.geography ?? undefined,
      geography_list: input.resolved.geography ? [input.resolved.geography] : input.profile?.geography_list ?? undefined,
      competitors: input.resolved.competitors.length > 0 ? input.resolved.competitors.join(', ') : input.profile?.competitors ?? undefined,
      competitors_list: input.resolved.competitors.length > 0 ? input.resolved.competitors : input.profile?.competitors_list ?? undefined,
      social_profiles: socialProfiles.length > 0 ? socialProfiles : input.profile?.social_profiles ?? undefined,
      other_social_links:
        input.resolved.socialLinks.length > 0
          ? input.resolved.socialLinks.map((url) => ({ url }))
          : input.profile?.other_social_links ?? undefined,
      report_settings: reportSettings as CompanyProfile['report_settings'],
    },
    { source: 'user' },
  );
}
