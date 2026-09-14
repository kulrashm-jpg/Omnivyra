/**
 * CPG-009 — secondary company domains, associated ONLY by explicit evidence (§4).
 *
 * cloudflare.com and cloudflare.net must not be assumed unrelated because the
 * strings differ — nor assumed identical because they look alike. A secondary
 * domain becomes the company's only when a FIRST-PARTY page on the canonical
 * domain establishes it, and the reason is recorded:
 *
 *   first_party_ir_link          the canonical site links to it as Investor
 *                                Relations / Investors;
 *   first_party_same_brand_link  the canonical site links to it AND its
 *                                publisher label equals the canonical's —
 *                                SUPPORTING only (affiliation ≠ identity);
 *   first_party_json_ld_sameAs   the canonical site's own JSON-LD Organization
 *                                lists it in url / sameAs;
 *   redirect_from_canonical      fetching the canonical domain lands on it.
 *
 * A plain outbound link is NOT enough: every company site links to GitHub,
 * social networks and partners. Social / profile hosts are never aliases.
 *
 * Pure: it reads HTML the caller already fetched through safeFetch.
 */

import type { DomainAlias } from '../types';
import { readJsonLdBlocks, nodesOfType } from '../extraction/documentExtractors';
import { decodeEntities } from '../extraction/valueTypes';
import { registrableDomain } from './sourceRegistry';
// Re-exported for existing importers; defined apart so sourceRegistry does not import this module (CPG-012).
import { ALIAS_STRENGTH } from './aliasStrength';
export { ALIAS_STRENGTH };

const NEVER_ALIAS = /(^|\.)(linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|wikipedia\.org|wikidata\.org|crunchbase\.com|medium\.com|tiktok\.com|apple\.com|google\.com|t\.me|glassdoor\.com|g2\.com|trustpilot\.com)$/;

/** Financial / news / business-profile hosts: they describe companies, they are not owned by them. */
const PROFILE_OR_MEDIA = /(^|\.)(bloomberg\.com|yahoo\.com|reuters\.com|forbes\.com|crunchbase\.com|tracxn\.com|pitchbook\.com|owler\.com|zoominfo\.com|dnb\.com|morningstar\.com|marketwatch\.com|nasdaq\.com|nyse\.com|sec\.gov|investor\.gov|finra\.org|nseindia\.com|bseindia\.com|nsdl\.co\.in|nsdl\.com|cdslindia\.com|mcxindia\.com|amfiindia\.com|rbi\.org\.in)$/;

/** CPG-010 — may this host ever be a company's secondary domain? Never a social, profile, media or registry host. */
export function aliasEligibleHost(h: string): boolean {
  const x = h.toLowerCase().replace(/^www\./, '');
  return !NEVER_ALIAS.test(x) && !PROFILE_OR_MEDIA.test(x) && !/(^|\.)gov(\.[a-z]{2})?$/.test(x);
}

const host = (u: string): string | null => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
/** The label before the public suffix: cloudflare.com → "cloudflare". */
const brandLabel = (h: string) => registrableDomain(h).split('.')[0];

export interface FirstPartyPage {
  /** Final URL after redirects — must be ON the canonical domain to count. */
  url: string;
  html: string;
}

export function establishDomainAliases(canonicalDomain: string, pages: readonly FirstPartyPage[], redirectedTo?: string | null): DomainAlias[] {
  const canonical = canonicalDomain.toLowerCase().replace(/^www\./, '');
  const onCanonical = (h: string | null) => !!h && (h === canonical || h.endsWith(`.${canonical}`));
  const found = new Map<string, DomainAlias>();
  // ⚠️ CPG-009 — the alias is the EXACT host linked (its subdomains follow),
  // except for same-brand-label evidence, whose justification IS the
  // registrable name (cloudflare.net). Widening an IR link on
  // acme.azurewebsites.net to "azurewebsites.net" would hand the company
  // every site on that platform.
  const add = (a: DomainAlias) => {
    const d = a.evidence === 'first_party_same_brand_link' ? registrableDomain(a.domain) : a.domain.replace(/^www\./, '');
    // CPG-010 LIVE FIX — every evidence type passes the same eligibility test
    // (social, profile, media, market-infrastructure and government hosts are
    // never a company's own domain); only JSON-LD used to check media hosts.
    if (registrableDomain(d) === registrableDomain(canonical) || !aliasEligibleHost(d) || found.has(d)) return;
    found.set(d, { ...a, domain: d });
  };

  if (redirectedTo) {
    const h = host(redirectedTo);
    if (h && !onCanonical(h)) add({ domain: h, evidence: 'redirect_from_canonical', sourceUrl: `https://${canonical}/`, detail: `https://${canonical}/ redirects to ${redirectedTo}` });
  }

  for (const p of pages) {
    if (!onCanonical(host(p.url))) continue; // only the company's OWN pages can establish aliases

    // Anchors: IR links, or same-brand-label domains.
    const a = /<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = a.exec(p.html)) !== null) {
      const h = host(m[1]);
      if (!h || onCanonical(h)) continue;
      const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      // ⚠️ CPG-010 LIVE FIX — the label must be a LABEL. zerodha.com's investor
      // charter links https://investor.nsdl.com/… with the URL itself as the
      // anchor text; "investor" in a depository's host name made NSDL a
      // DECISIVE "IR alias". A URL-like or long anchor text is not an
      // Investors link.
      const urlLike = /:\/\/|^www\.|[a-z0-9-]\.[a-z]{2,}(\/|$)/i.test(text);
      if (!urlLike && text.length <= 40 && /\binvestor(s|\s+relations)?\b/i.test(text)) {
        add({ domain: h, evidence: 'first_party_ir_link', sourceUrl: p.url, detail: `${p.url} links "${text.slice(0, 60)}" → ${m[1].slice(0, 120)}` });
      } else if (brandLabel(h) === brandLabel(canonical)) {
        add({ domain: h, evidence: 'first_party_same_brand_link', sourceUrl: p.url, detail: `${p.url} links ${m[1].slice(0, 120)} (same publisher label "${brandLabel(h)}")` });
      }
    }

    // The canonical site's own structured statement of its other domains.
    // ⚠️ CPG-009 LIVE FIX — `sameAs` means "the same entity described
    // elsewhere": stripe.com lists its Bloomberg profile and Yahoo Finance
    // quote page, which became "Stripe domains". Only a site ROOT on a
    // non-profile host is an owned domain; a page at a path is a profile.
    for (const type of ['Organization', 'Corporation']) {
      for (const org of nodesOfType(readJsonLdBlocks(p.html), type)) {
        const urls = [org.url, ...(Array.isArray(org.sameAs) ? org.sameAs : [org.sameAs])].filter((u): u is string => typeof u === 'string');
        for (const u of urls) {
          const h = host(u);
          let root = false;
          try { const x = new URL(u); root = (x.pathname === '/' || x.pathname === '') && !x.search; } catch { root = false; }
          if (h && root && !onCanonical(h) && !PROFILE_OR_MEDIA.test(h)) {
            add({ domain: h, evidence: 'first_party_json_ld_sameAs', sourceUrl: p.url, detail: `${p.url} JSON-LD Organization lists the site root ${u}` });
          }
        }
      }
    }
  }
  return [...found.values()].sort((x, y) => (x.domain < y.domain ? -1 : 1));
}
