/**
 * Canonical email-authentication signal — the sending domain's SPF and DMARC posture,
 * read straight from DNS. SPF (a `v=spf1` TXT record on the domain) and DMARC (a
 * `v=DMARC1` TXT record on `_dmarc.<domain>`) are the two records a receiving server checks
 * to trust mail from a domain. DKIM is selector-specific (no generic lookup) so it is not
 * probed here. Best-effort + time-boxed: any DNS error/timeout resolves to "not found"
 * rather than throwing, so this never blocks the caller.
 */
import { resolveTxt } from 'dns/promises';
import { normalizeCompanyDomain } from '../../lib/shared/domain/companyDomain';

export interface EmailAuthStatus {
  /** A `v=spf1` TXT record exists on the domain. */
  spf: boolean;
  /** A `v=DMARC1` TXT record exists on `_dmarc.<domain>`. */
  dmarc: boolean;
  /** SPF and/or DMARC present — the domain has at least baseline email authentication. */
  configured: boolean;
  /** The domain actually queried (normalized), or null when none was resolvable. */
  domain: string | null;
}

const DNS_TIMEOUT_MS = 4000;

async function txtRecords(name: string): Promise<string[]> {
  const lookup = resolveTxt(name).then((records) => records.map((chunks) => chunks.join('')));
  const timeout = new Promise<string[]>((resolve) => setTimeout(() => resolve([]), DNS_TIMEOUT_MS));
  try {
    return await Promise.race([lookup, timeout]);
  } catch {
    // NXDOMAIN / no records / DNS error → treat as absent.
    return [];
  }
}

/**
 * Resolve the SPF + DMARC posture for a domain (or a website/email value that normalizes to
 * one). Returns all-false when the input isn't a resolvable domain.
 */
export async function checkEmailAuth(domainOrWebsite: string | null | undefined): Promise<EmailAuthStatus> {
  const domain = normalizeCompanyDomain(String(domainOrWebsite ?? ''));
  if (!domain) return { spf: false, dmarc: false, configured: false, domain: null };

  const [root, dmarc] = await Promise.all([
    txtRecords(domain),
    txtRecords(`_dmarc.${domain}`),
  ]);
  const spfPresent = root.some((r) => r.trim().toLowerCase().startsWith('v=spf1'));
  const dmarcPresent = dmarc.some((r) => r.trim().toLowerCase().startsWith('v=dmarc1'));

  return {
    spf: spfPresent,
    dmarc: dmarcPresent,
    configured: spfPresent || dmarcPresent,
    domain,
  };
}
