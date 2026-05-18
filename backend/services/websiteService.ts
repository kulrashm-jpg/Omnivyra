import { ownedDbTable } from '../db/writeOwner';
import { normalizeDomain } from './domainCanonicalService';

export type WebsiteStatus = 'active' | 'inactive' | 'pending_verification' | 'archived' | 'deleted';
export type WebsiteConnectionStatus = 'pending' | 'connected' | 'failed' | 'disabled' | 'deleted';
export type WebsiteHealthStatus = 'unknown' | 'healthy' | 'warning' | 'degraded' | 'failed' | 'reauth_required';

export interface Website {
  id: string;
  company_id: string;
  domain_id: string | null;
  name: string;
  canonical_url: string;
  cms_provider: string | null;
  status: WebsiteStatus;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebsiteConnection {
  id: string;
  website_id: string;
  provider: string;
  auth_type: string;
  encrypted_credentials: Record<string, unknown>;
  non_secret_config: Record<string, unknown>;
  status: WebsiteConnectionStatus;
  health_status: WebsiteHealthStatus;
  last_sync_at: string | null;
  last_error: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWebsiteInput {
  companyId: string;
  createdBy?: string | null;
  name: string;
  canonicalUrl: string;
  domainId?: string | null;
  cmsProvider?: string | null;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateWebsiteConnectionInput {
  websiteId: string;
  provider: string;
  authType?: string;
  nonSecretConfig?: Record<string, unknown>;
  status?: WebsiteConnectionStatus;
  healthStatus?: WebsiteHealthStatus;
  lastError?: string | null;
}

export function normalizeWebsiteUrl(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    const domain = normalizeDomain(raw);
    return domain ? `https://${domain}` : raw;
  }
}

function websiteNameFromUrl(canonicalUrl: string): string {
  try {
    return new URL(canonicalUrl).hostname.replace(/^www\./i, '');
  } catch {
    return canonicalUrl || 'Website';
  }
}

export async function createWebsite(input: CreateWebsiteInput): Promise<Website> {
  const canonicalUrl = normalizeWebsiteUrl(input.canonicalUrl);
  if (!canonicalUrl) throw new Error('canonicalUrl is required');

  const payload = {
    company_id: input.companyId,
    domain_id: input.domainId ?? null,
    name: input.name.trim() || websiteNameFromUrl(canonicalUrl),
    canonical_url: canonicalUrl,
    cms_provider: input.cmsProvider ?? null,
    settings: input.settings ?? {},
    metadata: input.metadata ?? {},
    created_by: input.createdBy ?? null,
    status: 'active',
  };

  const { data, error } = await ownedDbTable('websites')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Website;
}

export async function getWebsite(id: string, companyId: string): Promise<Website | null> {
  const { data, error } = await ownedDbTable('websites')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return null;
  return (data as Website | null) ?? null;
}

export async function getWebsites(companyId: string): Promise<Website[]> {
  const { data, error } = await ownedDbTable('websites')
    .select('*')
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as Website[];
}

export async function ensureDefaultWebsite(companyId: string, userId?: string | null): Promise<Website> {
  const existing = await getWebsites(companyId);
  if (existing.length > 0) return existing[0]!;

  let domainUrl = '';
  const { data: domainRow } = await ownedDbTable('company_domains')
    .select('id, final_domain, domain, is_primary')
    .eq('company_id', companyId)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();

  const finalDomain =
    (domainRow as any)?.final_domain ||
    (domainRow as any)?.domain ||
    '';
  if (finalDomain) domainUrl = `https://${String(finalDomain).replace(/^https?:\/\//i, '')}`;

  return createWebsite({
    companyId,
    createdBy: userId ?? null,
    domainId: (domainRow as any)?.id ?? null,
    name: finalDomain ? websiteNameFromUrl(domainUrl) : 'Default Website',
    canonicalUrl: domainUrl || `https://company-${companyId}.local`,
    metadata: { created_by_backfill: true },
  });
}

export async function resolveWebsiteForCompany(
  companyId: string,
  websiteId?: string | null,
  userId?: string | null,
): Promise<Website> {
  if (websiteId) {
    const website = await getWebsite(websiteId, companyId);
    if (!website) throw new Error('Website not found or inaccessible');
    return website;
  }
  return ensureDefaultWebsite(companyId, userId);
}

export async function createWebsiteConnection(input: CreateWebsiteConnectionInput): Promise<WebsiteConnection> {
  const { data, error } = await ownedDbTable('website_connections')
    .insert({
      website_id: input.websiteId,
      provider: input.provider,
      auth_type: input.authType ?? 'api_key',
      non_secret_config: input.nonSecretConfig ?? {},
      status: input.status ?? 'pending',
      health_status: input.healthStatus ?? 'unknown',
      last_error: input.lastError ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as WebsiteConnection;
}

export async function getWebsiteConnection(id: string): Promise<WebsiteConnection | null> {
  const { data, error } = await ownedDbTable('website_connections')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return null;
  return (data as WebsiteConnection | null) ?? null;
}

export async function getWebsiteConnections(websiteId: string, provider?: string): Promise<WebsiteConnection[]> {
  let query = ownedDbTable('website_connections')
    .select('*')
    .eq('website_id', websiteId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (provider) query = query.eq('provider', provider);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as WebsiteConnection[];
}

export async function updateWebsiteConnection(
  connectionId: string,
  updates: Partial<Pick<WebsiteConnection, 'status' | 'health_status' | 'last_error' | 'last_sync_at' | 'non_secret_config'>>,
): Promise<void> {
  const { error } = await ownedDbTable('website_connections')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId);
  if (error) throw new Error(error.message);
}

export async function assertWebsiteCompanyAccess(companyId: string, websiteId: string): Promise<Website> {
  const website = await getWebsite(websiteId, companyId);
  if (!website) throw new Error('Website not found or inaccessible');
  return website;
}
