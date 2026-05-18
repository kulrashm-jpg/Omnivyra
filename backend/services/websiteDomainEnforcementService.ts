import crypto from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { normalizeDomain } from './domainCanonicalService';
import type { CaptureForm } from './leadService';
import type { Website } from './websiteService';

export type DomainEnforcementDecision = {
  allowed: boolean;
  verified: boolean;
  mode: 'verified' | 'allow_unverified' | 'no_origin' | 'mismatch';
  message: string;
  originHost?: string | null;
};

export function hashIp(value: string | undefined): string | null {
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function originHost(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return normalizeDomain(new URL(origin).hostname);
  } catch {
    return null;
  }
}

export async function checkWebsiteOrigin(website: Pick<Website, 'id' | 'domain_id' | 'canonical_url' | 'settings'>, origin: string | undefined): Promise<DomainEnforcementDecision> {
  const host = originHost(origin);
  const canonicalHost = originHost(website.canonical_url) || normalizeDomain(website.canonical_url);
  const settings = website.settings || {};
  const allowUnverified = settings.allow_unverified_ingestion !== false;

  if (!host) {
    return { allowed: allowUnverified, verified: false, mode: 'no_origin', message: allowUnverified ? 'Origin missing; accepted in compatibility mode.' : 'Origin is required.' };
  }

  const allowedHosts = new Set<string>([
    canonicalHost,
    ...((Array.isArray(settings.allowed_tracking_domains) ? settings.allowed_tracking_domains : []) as string[]).map(normalizeDomain),
  ].filter(Boolean));

  const hostMatches = Array.from(allowedHosts).some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (!hostMatches) {
    return { allowed: false, verified: false, mode: 'mismatch', originHost: host, message: 'Origin does not match this website.' };
  }

  if (!website.domain_id) {
    return { allowed: allowUnverified, verified: false, mode: allowUnverified ? 'allow_unverified' : 'mismatch', originHost: host, message: allowUnverified ? 'Domain link not verified; accepted in compatibility mode.' : 'Verified domain is required.' };
  }

  const { data } = await ownedDbTable('company_domains')
    .select('id, verified, verification_status, final_domain')
    .eq('id', website.domain_id)
    .maybeSingle();
  const verified = Boolean((data as any)?.verified || (data as any)?.verification_status === 'verified' || (data as any)?.verification_status === 'admin_override');

  return {
    allowed: verified || allowUnverified,
    verified,
    mode: verified ? 'verified' : 'allow_unverified',
    originHost: host,
    message: verified ? 'Verified domain accepted.' : 'Domain is not verified; accepted in compatibility mode.',
  };
}

export async function checkFormOrigin(form: CaptureForm, origin: string | undefined): Promise<DomainEnforcementDecision> {
  const host = originHost(origin);
  const allowed = Array.isArray(form.allowed_domains) ? form.allowed_domains.map(normalizeDomain).filter(Boolean) : [];
  if (allowed.length === 0) {
    return { allowed: true, verified: false, mode: 'allow_unverified', originHost: host, message: 'No form allowlist configured.' };
  }
  if (!host) return { allowed: false, verified: false, mode: 'no_origin', message: 'Origin is required for this form.' };
  const matches = allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
  return {
    allowed: matches,
    verified: matches,
    mode: matches ? 'verified' : 'mismatch',
    originHost: host,
    message: matches ? 'Form origin allowed.' : 'Origin is not allowed for this form.',
  };
}
