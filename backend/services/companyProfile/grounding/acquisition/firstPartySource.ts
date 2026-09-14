/**
 * CPG-002 — first-party website evidence source (§6).
 *
 * Fetches a small, fixed set of the company's OWN pages and emits only what
 * those documents actually state.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 * It does not infer industry from a description, ICP from a customer logo wall,
 * brand voice from prose style, or positioning from a headline. Those are
 * SYNTHESIS, and CPG-001 keeps synthesis structurally separate from fact. A page
 * existing is not evidence of what the page implies.
 *
 * The honest consequence: a first-party crawl typically yields identity and
 * self-description, and leaves ICP, brand voice, pain points and competitive
 * advantage UNVERIFIED. That sparse result is the correct one (§15) — filling
 * those fields from a homepage would be exactly the invented-fact failure this
 * whole capability exists to prevent.
 *
 * SSRF: every fetch is host-pinned to the company's own domain via the injected
 * fetcher's `allowedHosts`. Production passes `safeFetch` (HARDEN-005).
 */

import { extractWebsiteMetadata } from '../../websiteMetadataExtractor';
import type { EvidenceClaim } from '../types';
import {
  claimId, normalizeValue, retrieved, unavailable,
  type AcquisitionContext, type AcquisitionResult, type EvidenceSource,
} from './evidenceSource';

const SOURCE_ID = 'first_party_website';

/** Pages worth trying, in priority order. Kept small: this is evidence, not a crawl. */
export const FIRST_PARTY_PATHS: readonly string[] = Object.freeze([
  '/', '/about', '/about-us', '/company', '/products', '/services', '/team', '/leadership', '/press', '/news',
]);

function pageKind(path: string): string {
  if (path === '/') return 'homepage';
  if (/about|company/.test(path)) return 'about';
  if (/product|service/.test(path)) return 'products';
  if (/team|leadership/.test(path)) return 'leadership';
  if (/press|news/.test(path)) return 'newsroom';
  return 'page';
}

/**
 * Extract claims from ONE fetched document.
 *
 * Only fields the metadata genuinely asserts are emitted:
 *   site_name / title → `name`         (the site states its own name)
 *   description       → `company_description`  — NOT `unique_value`.
 *
 * That second mapping is the important restraint: a meta description is how a
 * company describes itself, which is a source-derived fact. Treating it as the
 * `unique_value` field would silently promote marketing copy into a verified
 * positioning claim.
 */
export function extractFirstPartyClaims(
  html: string, url: string, ctx: AcquisitionContext,
): EvidenceClaim[] {
  const meta = extractWebsiteMetadata(html, url);
  const out: EvidenceClaim[] = [];

  const push = (field: string, value: string | null | undefined, kindNote: string) => {
    const v = (value ?? '').trim();
    if (!v) return;
    out.push({
      claimId: claimId(SOURCE_ID, url, field, v),
      field, value: v, normalizedValue: normalizeValue(v),
      sourceType: 'company_website',
      sourceName: ctx.companyDomain ?? url,
      sourceUrl: url,
      sourcePublishedAt: null, // a marketing page rarely states one; never invented
      sourceAccessedAt: ctx.asOf,
      excerpt: v.slice(0, 300),
      verificationMethod: 'crawl',
      entitySignals: {
        // The document IS the company's own site, so the domain is the identity.
        companyName: (meta.siteName ?? meta.title ?? null) as string | null,
        domain: ctx.companyDomain,
        linkedinUrl: null,
        location: null, // locale-derived geography is an INFERENCE — not emitted
        leadership: [],
        registryId: null,
        // CPG-009 — the host is the identity evidence (first party); the
        // publisher here IS the company, recorded separately all the same.
        sourceHost: (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } })(),
        publisher: meta.siteName ?? null,
      },
    });
    void kindNote;
  };

  // ⚠️ CPG-004 LIVE FINDING — `name` comes from og:site_name ONLY, never <title>.
  //
  // The live run against real sites showed the previous `site_name || title`
  // fallback emitting PAGE TITLES as company-name claims:
  //   "Cloudflare: Build for the agent era"
  //   "Basecamp — Where we came from"
  //   "Infosys - Consulting | IT Services | Digital Transformation"
  //   "Our company, history, and the people behind it"   (Zerodha /about)
  // None of those is the company's name. `og:site_name` is a site-level
  // assertion of identity; `<title>` is per-page marketing copy, and treating it
  // as an identity claim is precisely the inference this layer forbids.
  //
  // It also manufactured false conflicts: two pages of one site have two
  // different titles, which the resolver correctly read as disagreement about
  // `name`. Fixtures never caught this because they set a clean og:site_name.
  push('name', meta.siteName, 'og:site_name is a site-level identity assertion');
  push('company_description', meta.description, 'self-description as stated');

  return out;
}

export function createFirstPartySource(paths: readonly string[] = FIRST_PARTY_PATHS): EvidenceSource {
  return {
    id: SOURCE_ID,
    label: 'Company website (first-party)',
    isAvailable: () => true, // keyless; availability depends only on a known domain
    async acquire(ctx: AcquisitionContext): Promise<AcquisitionResult> {
      if (!ctx.companyDomain) {
        return unavailable('no_coverage', 'no company domain is known, so no first-party site can be fetched');
      }
      const host = ctx.companyDomain.replace(/^www\./, '');
      const claims: EvidenceClaim[] = [];
      const seen = new Set<string>();
      let fetched = 0;
      let anyFailure = '';

      for (const path of paths) {
        const url = `https://${host}${path}`;
        let res: Awaited<ReturnType<typeof ctx.fetcher>>;
        try {
          // Host-pinned: this source can never be redirected off the company domain.
          res = await ctx.fetcher(url, { allowedHosts: [host] });
        } catch (err) {
          anyFailure = err instanceof Error ? err.message : String(err);
          continue; // one bad page never aborts the crawl
        }
        if (!res || !res.ok || !res.text) continue;
        fetched++;
        for (const c of extractFirstPartyClaims(res.text, res.url || url, ctx)) {
          // Same value from two pages is one claim, not corroboration by repetition.
          const key = `${c.field}|${c.normalizedValue}`;
          if (seen.has(key)) continue;
          seen.add(key);
          claims.push({ ...c, sourceName: `${host} (${pageKind(path)})` });
        }
      }

      if (fetched === 0) {
        return unavailable('retrieval_failed', anyFailure || `no page under https://${host} could be fetched`);
      }
      return retrieved(claims, fetched);
    },
  };
}
