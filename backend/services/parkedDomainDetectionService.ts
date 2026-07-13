/**
 * parkedDomainDetectionService.ts — parked / expired-domain heuristics
 * (AUTH-001, Section 7).
 *
 * Before AUTH-001 the "live website" gate (resolveDomain) accepted ANY
 * HTTP 200 at the apex — a registrar parking lander or an expired-domain
 * sales page passed rule 3. This module adds a content-level pass over the
 * final resolved page, scanning for high-specificity parking/expiry markers.
 *
 * Design constraints:
 *   - ONE extra GET, only on the success path of validateCompanyIdentity
 *     (all other rules already passed), body capped at 256 KiB, 4s budget —
 *     bounded added latency on exactly the requests that will create accounts.
 *   - Outbound via safeFetch (HARDEN-005 seam): SSRF-validated, DNS-pinned.
 *   - FAIL-OPEN: a fetch/parse failure returns { parked: false, checked:
 *     false }. Site liveness was already proven by resolveDomain; a transient
 *     body-read failure must not block a legitimate signup. Parked detection
 *     is an abuse filter, not an availability gate.
 *   - Markers are deliberately narrow phrases used by parking providers and
 *     registrar expiry landers — generic words like "for sale" alone are NOT
 *     matched, to keep false positives (e.g. real-estate companies) near zero.
 *   - A positive match routes to MANUAL REVIEW (PARKED_DOMAIN, reviewable),
 *     never a silent hard block — the copy invites the user to contact the
 *     team, which is the correct outcome for a false positive.
 *
 * WHOIS-based expiry detection was evaluated and deliberately NOT added: no
 * WHOIS client exists in the repo, port-43 WHOIS is blocked from most PaaS
 * egress, and an expired domain that has left DNS already fails the MX /
 * resolveDomain gates (NO_EMAIL_CAPABILITY / NO_WEBSITE_FOUND). What remains
 * detectable — an expired domain showing a registrar lander — is exactly what
 * the marker list below covers.
 */

import { safeFetch } from '../../lib/security/safeFetch';
import { logger } from './logger';

export interface ParkedDomainVerdict {
  /** True when a parking/expiry marker matched. */
  parked: boolean;
  /** True when the page body was actually fetched and scanned. */
  checked: boolean;
  /** The marker that matched (diagnostics). */
  marker?: string;
}

/**
 * High-specificity parking / expiry markers (lowercase substring match
 * against the first 256 KiB of the final page). Grouped by source.
 */
const PARKED_MARKERS: ReadonlyArray<string> = [
  // Parking providers (script/host names are the strongest signals)
  'sedoparking.com',
  'parkingcrew.net',
  'img.sedoparking',
  'bodis.com/js/parking',
  'parklogic.com',
  'above.com/parking',
  // Registrar / marketplace landers
  'this domain is for sale',
  'the domain is for sale',
  'domain may be for sale',
  'buy this domain',
  'is parked free, courtesy of godaddy',
  'this domain is parked',
  'domain is parked',
  'hugedomains.com',
  'afternic.com',
  'dan.com/buy-domain',
  // Expiry landers
  'this domain has expired',
  'domain has expired and is pending renewal',
  'expired domain name',
  'renew this domain',
];

const BODY_CAP_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 4_000;

/**
 * Fetch the final resolved page and scan for parking/expiry markers.
 * Never throws. See fail-open notes in the header.
 */
export async function detectParkedDomain(finalDomain: string): Promise<ParkedDomainVerdict> {
  const domain = String(finalDomain || '').trim().toLowerCase();
  if (!domain) return { parked: false, checked: false };

  try {
    const res = await safeFetch(
      `https://${domain}/`,
      { method: 'GET', headers: { accept: 'text/html' } },
      {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: BODY_CAP_BYTES,
        maxRedirects: 2,
        metricLabel: 'parked_domain_probe',
      },
    );
    if (!res.ok) {
      // Non-200 body — resolveDomain already vouched for liveness; nothing to scan.
      return { parked: false, checked: false };
    }
    const body = (await res.text()).slice(0, BODY_CAP_BYTES).toLowerCase();
    for (const marker of PARKED_MARKERS) {
      if (body.includes(marker)) {
        logger.info('parked_domain_detected', { domain, marker });
        return { parked: true, checked: true, marker };
      }
    }
    return { parked: false, checked: true };
  } catch (err) {
    logger.warn('parked_domain_probe_failed', {
      domain,
      message: err instanceof Error ? err.message : String(err),
    });
    return { parked: false, checked: false }; // fail-open
  }
}
