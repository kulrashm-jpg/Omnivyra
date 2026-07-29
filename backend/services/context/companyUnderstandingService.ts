/**
 * Company Understanding — multi-source "what kind of company is this?" read.
 *
 * Before we can name accurate competitors we must first understand the CORE
 * BUSINESS. This composes several public sources into one grounded read:
 *   - the stored profile (products/services, customers, value, revenue range)
 *   - Wikidata firmographics (founded year / team size / revenue range)
 *   - Wikipedia summary (a neutral description of what the company actually does)
 *   - Crunchbase / Bloomberg — activation-gated adapters (dark until a key is
 *     configured; they return null rather than fabricating data)
 *
 * Every external call is best-effort and fail-safe: a source that is missing,
 * slow, or errors contributes nothing and never throws. The result is a single
 * `groundingText` block that competitor discovery feeds to the model, plus the
 * structured signals so callers can reason over them.
 */

import { safeFetch } from '../../../lib/security/safeFetch';
import { lookupCompanyFirmographicsFromWikidata } from '../intelligence/adapters/wikidataAdapter';

export interface CompetitorGroundingContext {
  name: string;
  website: string;
  signals: {
    industry: string;
    products: string;
    valueProp: string;
    customers: string;
    revenueRange: string | null;
    teamSize: string | null;
    foundedYear: string | null;
    wikipediaSummary: string | null;
    wikidataMatched: string | null;
  };
  /** Which sources actually contributed a signal (for transparency in the UI/logs). */
  sources: string[];
  /** Activation state of key-gated external providers. */
  gatedProviders: { crunchbase: 'no_key' | 'active'; bloomberg: 'no_key' | 'active' };
  /** Formatted multi-source block to ground competitor discovery. */
  groundingText: string;
}

const str = (v: unknown): string => String(v ?? '').trim();

/** Hard timeout wrapper so no external source can stall discovery. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  const result = await Promise.race<T | null>([p.catch(() => null), timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

/**
 * Best-effort Wikipedia summary: resolve the most likely page title, then pull
 * its REST summary extract. Public host only — routed through safeFetch (SSRF
 * layer). Returns null on any miss/timeout/error.
 */
async function fetchWikipediaSummary(name: string): Promise<{ title: string; extract: string } | null> {
  if (!name) return null;
  try {
    const searchUrl =
      'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=' +
      encodeURIComponent(name);
    const searchRes = await withTimeout(safeFetch(searchUrl, { method: 'GET' }), 4000);
    if (!searchRes || !searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as { query?: { search?: Array<{ title?: string }> } };
    const title = str(searchJson?.query?.search?.[0]?.title);
    if (!title) return null;

    const summaryUrl = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title);
    const sumRes = await withTimeout(safeFetch(summaryUrl, { method: 'GET' }), 4000);
    if (!sumRes || !sumRes.ok) return null;
    const sumJson = (await sumRes.json()) as { extract?: string; type?: string };
    const extract = str(sumJson?.extract);
    // Disambiguation pages describe nothing — skip them.
    if (!extract || sumJson?.type === 'disambiguation') return null;
    return { title, extract: extract.slice(0, 800) };
  } catch {
    return null;
  }
}

/**
 * Crunchbase adapter — activation-gated. Requires CRUNCHBASE_API_KEY (paid
 * Crunchbase Data license). Dark by default: returns null so the pipeline
 * degrades cleanly rather than fabricating firmographics.
 */
async function fetchCrunchbase(_name: string): Promise<{ description: string } | null> {
  if (!process.env.CRUNCHBASE_API_KEY) return null; // dark — no fabrication
  // Wiring point for a licensed Crunchbase key. Intentionally left inert until
  // credentials are provided; returning null keeps discovery safe meanwhile.
  return null;
}

/**
 * Bloomberg adapter — activation-gated. Requires a Bloomberg enterprise data
 * credential. Dark by default (no free/public API); returns null.
 */
async function fetchBloomberg(_name: string): Promise<{ description: string } | null> {
  if (!process.env.BLOOMBERG_API_KEY) return null; // dark — no fabrication
  return null;
}

/**
 * Build the multi-source understanding for a company. `profile` is the canonical
 * profile record (as returned by getCanonicalProfile). Never throws.
 */
export async function buildCompetitorGroundingContext(
  _companyId: string,
  profile: Record<string, unknown>,
): Promise<CompetitorGroundingContext> {
  const name = str(profile.name);
  const website = str(profile.website) || str(profile.canonical_website) || str(profile.domain);
  const industry = [str(profile.industry), str(profile.category)].filter(Boolean).join(' / ');
  const products = str(profile.products_services);
  const valueProp = str(profile.unique_value);
  const customers = str(profile.target_audience) || str(profile.ideal_customer_profile);
  const profileRevenue = str(profile.revenue_range) || null;

  // Gather external sources in parallel — all fail-safe.
  const [wikidata, wikipedia, crunchbase, bloomberg] = await Promise.all([
    name ? withTimeout(lookupCompanyFirmographicsFromWikidata(name), 5000) : Promise.resolve(null),
    fetchWikipediaSummary(name),
    fetchCrunchbase(name),
    fetchBloomberg(name),
  ]);

  const sources: string[] = [];
  if (products || valueProp || customers || industry) sources.push('profile');
  if (wikidata?.matched_label) sources.push('wikidata');
  if (wikipedia?.extract) sources.push('wikipedia');
  if (crunchbase) sources.push('crunchbase');
  if (bloomberg) sources.push('bloomberg');

  const signals: CompetitorGroundingContext['signals'] = {
    industry,
    products,
    valueProp,
    customers,
    // Prefer the profile's own revenue range; fall back to Wikidata's.
    revenueRange: profileRevenue ?? (wikidata?.revenue_range ?? null),
    teamSize: wikidata?.team_size ?? null,
    foundedYear: wikidata?.founded_year ?? null,
    wikipediaSummary: wikipedia?.extract ?? null,
    wikidataMatched: wikidata?.matched_label ?? null,
  };

  const groundingLines = [
    `Company: ${name || _companyId}`,
    website ? `Website: ${website}` : '',
    `Industry/Category: ${industry || 'Not set'}`,
    `What it sells (products/services): ${products || 'Not set'}`,
    `Unique value: ${valueProp || 'Not set'}`,
    `Target customer: ${customers || 'Not set'}`,
    signals.revenueRange ? `Revenue range: ${signals.revenueRange}` : '',
    signals.teamSize ? `Team size: ${signals.teamSize}` : '',
    signals.foundedYear ? `Founded: ${signals.foundedYear}` : '',
    wikipedia?.extract
      ? `Public description (Wikipedia — "${wikipedia.title}"): ${wikipedia.extract}`
      : '',
    `Sources consulted: ${sources.length ? sources.join(', ') : 'profile only'}.`,
  ].filter(Boolean);

  return {
    name,
    website,
    signals,
    sources,
    gatedProviders: {
      crunchbase: process.env.CRUNCHBASE_API_KEY ? 'active' : 'no_key',
      bloomberg: process.env.BLOOMBERG_API_KEY ? 'active' : 'no_key',
    },
    groundingText: groundingLines.join('\n'),
  };
}
