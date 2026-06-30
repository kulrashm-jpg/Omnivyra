/**
 * Canonical Tenant Resolution for public website ingestion (Phase 13).
 *
 * The single entry point that determines WHICH tenant a public request belongs to,
 * BEFORE any lead processing. Everything downstream is tenant-agnostic — no lead/
 * attribution/intelligence code knows whether the request is OmniVyra or a customer.
 *
 * Reuses existing website/organization infrastructure (the `websites` +
 * `company_domains` tables, `checkWebsiteOrigin`, `getWebsite`, `validateWebhookAuth`)
 * — it does NOT create a parallel tenant registry. Resolution strategies, in priority
 * order: verified website domain → configured website id → configured host header →
 * signed integration key → canonical site configuration (the configured default site).
 * Unknown websites resolve to null (rejected) unless a default site is configured.
 */

import { ownedDbTable } from '../db/writeOwner';
import { checkWebsiteOrigin, originHost } from './websiteDomainEnforcementService';
import { normalizeDomain } from './domainCanonicalService';
import { getWebsite, type Website } from './websiteService';
import { validateWebhookAuth } from './leadService';

export type TenantResolutionStrategy = 'verified_domain' | 'website_id' | 'host_header' | 'integration_key' | 'site_config';

export interface CanonicalTenantContext {
  tenantId: string;        // canonical tenant = company_id
  companyId: string;
  organizationId: string;  // platform org id (== company_id)
  websiteId: string | null;
  websiteDomain: string | null;
  siteConfiguration: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  timezone: string;
  locale: string;
  resolvedBy: TenantResolutionStrategy;
}

export interface TenantResolutionInput {
  websiteId?: string | null;
  origin?: string | null;
  host?: string | null;
  integrationId?: string | null;
  integrationSecret?: string | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function buildContext(
  companyId: string,
  websiteId: string | null,
  websiteDomain: string | null,
  settings: Record<string, unknown>,
  resolvedBy: TenantResolutionStrategy,
): CanonicalTenantContext {
  const s = obj(settings);
  return {
    tenantId: companyId,
    companyId,
    organizationId: companyId,
    websiteId,
    websiteDomain,
    siteConfiguration: s,
    featureFlags: obj(s.feature_flags),
    timezone: str(s.timezone) ?? 'UTC',
    locale: str(s.locale) ?? 'en',
    resolvedBy,
  };
}

const domainOf = (site: Pick<Website, 'canonical_url'>): string | null => {
  try { return originHost(site.canonical_url) ?? normalizeDomain(site.canonical_url); } catch { return null; }
};

/** Resolve a website by its host via the existing company_domains → websites linkage. */
async function resolveByDomain(domain: string | null, requireVerified: boolean, strategy: TenantResolutionStrategy): Promise<CanonicalTenantContext | null> {
  if (!domain) return null;
  try {
    const { data: dom } = await ownedDbTable('company_domains')
      .select('id, verified, verification_status, final_domain')
      .eq('final_domain', domain)
      .maybeSingle();
    if (!dom) return null;
    const verified = Boolean((dom as any).verified || ['verified', 'admin_override'].includes(String((dom as any).verification_status)));
    if (requireVerified && !verified) return null;
    const { data: site } = await ownedDbTable('websites')
      .select('*')
      .eq('domain_id', (dom as any).id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!site) return null;
    const w = site as Website;
    return buildContext(w.company_id, w.id, domain, w.settings, strategy);
  } catch {
    return null;
  }
}

/** Resolve by an explicit website id (the tracker's data-account), origin-enforced. */
async function resolveByWebsiteId(websiteId: string | null, origin: string | null): Promise<CanonicalTenantContext | null> {
  if (!websiteId) return null;
  try {
    const { data: site } = await ownedDbTable('websites').select('*').eq('id', websiteId).is('deleted_at', null).maybeSingle();
    if (!site) return null;
    const w = site as Website;
    const decision = await checkWebsiteOrigin(w, origin ?? undefined);
    if (!decision.allowed) return null; // origin does not belong to this website → tenant isolation
    return buildContext(w.company_id, w.id, domainOf(w), w.settings, 'website_id');
  } catch {
    return null;
  }
}

/** Resolve via a signed integration key (inbound webhook / SDK), reusing the existing auth. */
async function resolveByIntegration(integrationId: string | null, secret: string | null): Promise<CanonicalTenantContext | null> {
  if (!integrationId || !secret) return null;
  try {
    const auth = await validateWebhookAuth(integrationId, secret);
    if (!auth) return null;
    let domain: string | null = null;
    let settings: Record<string, unknown> = {};
    if (auth.website_id) {
      const site = await getWebsite(auth.website_id, auth.company_id);
      if (site) { domain = domainOf(site); settings = site.settings; }
    }
    return buildContext(auth.company_id, auth.website_id ?? null, domain, settings, 'integration_key');
  } catch {
    return null;
  }
}

/**
 * The configured default site (canonical site configuration).
 *
 * This is the ONLY place that reads the default-site env config. Canonical names are
 * `LEAD_CAPTURE_DEFAULT_COMPANY_ID` / `_ORIGINS` / `_WEBSITE_ID`. The `OMNIVYRA_*`
 * names are DEPRECATED backward-compatibility fallbacks retained for existing
 * deployments — set the `LEAD_CAPTURE_DEFAULT_*` vars and the OmniVyra ones can be
 * dropped. No other module reads these.
 */
function resolveBySiteConfig(origin: string | null): CanonicalTenantContext | null {
  const companyId = (process.env.LEAD_CAPTURE_DEFAULT_COMPANY_ID || process.env.OMNIVYRA_LEAD_COMPANY_ID /* deprecated */ || '').trim();
  if (!companyId) return null;
  const allow = (process.env.LEAD_CAPTURE_DEFAULT_ORIGINS || process.env.OMNIVYRA_SITE_ORIGINS /* deprecated */ || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length > 0 && origin && !allow.includes(origin)) return null; // configured origins + mismatch → reject
  const websiteId = (process.env.LEAD_CAPTURE_DEFAULT_WEBSITE_ID || '').trim() || null;
  return buildContext(companyId, websiteId, null, {}, 'site_config');
}

/** THE entry point — resolve the canonical tenant for a public website request. */
export async function resolveTenantForWebsite(input: TenantResolutionInput): Promise<CanonicalTenantContext | null> {
  const origin = str(input.origin);
  const host = str(input.host);

  return (
    (await resolveByDomain(originHost(origin ?? undefined), true, 'verified_domain')) ||
    (await resolveByWebsiteId(str(input.websiteId), origin)) ||
    (await resolveByDomain(host ? normalizeDomain(host) : null, false, 'host_header')) ||
    (await resolveByIntegration(str(input.integrationId), str(input.integrationSecret))) ||
    resolveBySiteConfig(origin)
  );
}

/** Build a canonical context from a known company (+ optional website). Reusable helper. */
export async function getTenantContext(companyId: string, websiteId?: string | null): Promise<CanonicalTenantContext | null> {
  if (!companyId) return null;
  if (websiteId) {
    const site = await getWebsite(websiteId, companyId).catch(() => null);
    if (site) return buildContext(companyId, site.id, domainOf(site), site.settings, 'site_config');
  }
  return buildContext(companyId, websiteId ?? null, null, {}, 'site_config');
}
