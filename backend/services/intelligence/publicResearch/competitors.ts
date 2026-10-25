/**
 * Public research — competitor intelligence from public sources.
 *
 * For each candidate (declared competitors first, then brands AI answers recommend for the buyer's
 * questions), an analyst model with live web search fills a fixed profile: what it sells, to whom,
 * where, at what entry price, how big it is, what proof it shows, and whether it competes with the
 * subject. EVERY value must carry the URL it came from. The pipeline then re-opens each URL and
 * checks the value is on the page:
 *   confirmed     — the page answered and contains the value's key tokens
 *   unconfirmed   — the page could not be read or did not contain them (shown, labelled)
 *   dropped       — no URL given
 * Revenue is reported only when a public source states it; otherwise the profile says so.
 */
import { readCapped, safeFetch } from '../../../../lib/security/safeFetch';
import { webJsonCompletion } from './llm';

export type FieldKey =
  | 'offering' | 'productLines' | 'buyers' | 'segments' | 'geography' | 'entryPrice' | 'freePlanOrTrial'
  | 'employees' | 'funding' | 'revenue' | 'customers' | 'reviews' | 'headquarters' | 'founded';

export type ProfileField = { value: string; url: string; check: 'confirmed' | 'unconfirmed' };

export type CompetitorProfile = {
  name: string;
  domain: string;
  classification: 'direct' | 'adjacent' | 'substitute' | 'not_competitor' | 'unconfirmed';
  rationale: string;
  /** The subject's capabilities this company also offers, with the URL that shows it. */
  capabilities: Array<{ capability: string; offers: boolean | null; url: string; check: 'confirmed' | 'unconfirmed' }>;
  fields: Partial<Record<FieldKey, ProfileField>>;
  status: 'observed' | 'failed_source';
  error: string | null;
  observedAt: string;
};

const FIELD_HELP: Record<FieldKey, string> = {
  offering: 'one-sentence description of what it sells, in its own words',
  productLines: 'its distinct products or modules, comma-separated',
  buyers: 'who it says it is for',
  segments: 'company sizes / industries it targets',
  geography: 'countries or regions it serves or is based in',
  entryPrice: 'lowest published paid price with currency and period, or "not published"',
  freePlanOrTrial: 'free plan / free trial / demo only',
  employees: 'employee count or range from a public profile (e.g. LinkedIn)',
  funding: 'total funding or latest round as publicly reported',
  revenue: 'annual revenue ONLY if a public source states it; otherwise "not publicly reported"',
  customers: 'customer count it claims, exactly as stated',
  reviews: 'G2 or Capterra rating and review count',
  headquarters: 'headquarters city/country',
  founded: 'founding year',
};

/** Every field is a value AND the page it came from; the strict schema makes the model return both. */
const sourced = { type: 'object', additionalProperties: false, required: ['value', 'url'], properties: { value: { type: 'string' }, url: { type: 'string' } } };
export const PROFILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'domain', 'classification', 'rationale', 'fields', 'capabilities'],
  properties: {
    name: { type: 'string' }, domain: { type: 'string' }, rationale: { type: 'string' },
    classification: { type: 'string', enum: ['direct', 'adjacent', 'substitute', 'not_competitor'] },
    fields: { type: 'object', additionalProperties: false, required: Object.keys(FIELD_HELP), properties: Object.fromEntries(Object.keys(FIELD_HELP).map((k) => [k, sourced])) },
    capabilities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['capability', 'offers', 'url'],
      properties: { capability: { type: 'string' }, offers: { type: 'string', enum: ['yes', 'no', 'unknown'] }, url: { type: 'string' } } } },
  },
};

/** Web-search research as JSON: OpenAI first, Claude with web search if OpenAI is unavailable (see llm.ts). */
async function webJson(step: string, prompt: string, timeoutMs: number, schema: { name: string; schema: unknown }): Promise<any | null> {
  const r = await webJsonCompletion(step, prompt, schema, { timeoutMs });
  if (process.env.PUBLIC_RESEARCH_DEBUG) console.info('[public-research] analyst raw', r?.provider, JSON.stringify(r?.json ?? null).slice(0, 4000));
  return r?.json ?? null;
}

/** Key tokens a page must contain for a value to count as confirmed: numbers first, else long words. */
export function keyTokens(value: string): string[] {
  const nums = value.match(/\d[\d,.]*\s*(?:k|m|bn|b|million|billion|%)?/gi)?.map((n) => n.replace(/[,\s]/g, '').toLowerCase()) ?? [];
  if (nums.length) return nums.slice(0, 2);
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 6))].slice(0, 8);
}

const pageCache = new Map<string, Promise<string | null>>();
/**
 * Source URLs come from a model's output, so they are untrusted: every fetch goes through the
 * SSRF-safe client (validated, DNS-pinned, private/metadata addresses blocked, redirects re-checked).
 */
function pageText(url: string, timeoutMs: number): Promise<string | null> {
  if (!pageCache.has(url)) {
    pageCache.set(url, safeFetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; OmnivyraSnapshot/1.0)' } }, { timeoutMs, maxBytes: 2_000_000, metricLabel: 'public_research_source' })
      .then(async (r) => (r.ok ? (await readCapped(r, 2_000_000)).toString('utf8').slice(0, 600_000).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase().replace(/,/g, '') : null))
      .catch(() => null));
  }
  return pageCache.get(url)!;
}

/** Fields that are the company's own description of itself: only its own site can confirm them. */
const SELF_DESCRIBED: FieldKey[] = ['offering', 'productLines', 'buyers', 'segments', 'entryPrice', 'freePlanOrTrial', 'customers'];

const hostOf = (u: string): string => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/**
 * A value is confirmed only when its source page (a) is about THIS company — on its own domain, or
 * naming it — and (b) shows the value. Self-descriptions must come from the company's own domain.
 */
export async function verify(
  value: string, url: string,
  company?: { name: string; domain: string; field?: FieldKey },
  timeoutMs = 15_000,
): Promise<'confirmed' | 'unconfirmed'> {
  if (!/^https?:\/\//.test(url)) return 'unconfirmed';
  if (company?.domain) {
    const own = company.domain.replace(/^www\./, '').toLowerCase();
    const host = hostOf(url);
    const onOwnSite = host === own || host.endsWith(`.${own}`);
    if (company.field && SELF_DESCRIBED.includes(company.field) && !onOwnSite) return 'unconfirmed';
    if (!onOwnSite) {
      const page = await pageText(url, timeoutMs);
      if (!page || !page.includes(company.name.toLowerCase())) return 'unconfirmed';
    }
  }
  const text = await pageText(url, timeoutMs);
  if (!text) return 'unconfirmed';
  const tokens = keyTokens(value);
  if (!tokens.length) return 'unconfirmed';
  // Numbers must all appear; for a description, most of its distinctive words must.
  const numeric = /\d/.test(tokens[0]);
  const found = tokens.filter((t) => text.includes(t)).length;
  return (numeric ? found === tokens.length : found / tokens.length >= 0.6) ? 'confirmed' : 'unconfirmed';
}

export async function profileCompetitor(
  subject: { brand: string; domain: string; offering: string; capabilities: string[] },
  candidate: { name: string; domain?: string | null },
  timeoutMs = 120_000,
): Promise<CompetitorProfile> {
  const observedAt = new Date().toISOString();
  const prompt = `You are a market analyst. Use web search. Research the company "${candidate.name}"${candidate.domain ? ` (${candidate.domain})` : ''} and compare it with "${subject.brand}" (${subject.domain}), which sells: ${subject.offering}.
Fill each field ONLY from a page you actually opened, and give that exact page's URL. If a value cannot be found on a page, return value "" and url "". Never estimate or infer: revenue, funding and employee figures only when a page states them.
Fields: ${Object.entries(FIELD_HELP).map(([k, v]) => `${k} (${v})`).join('; ')}.
Also: "capabilities": for each of these ${subject.brand} capabilities, copied exactly, say "yes", "no" or "unknown" for whether ${candidate.name} offers it, with the URL of the page that shows it: ${subject.capabilities.map((c) => `"${c}"`).join(', ')}.
And "classification": "direct" (same product for the same buyer), "adjacent" (overlapping product or buyer), "substitute" (a different way to do the same job), or "not_competitor"; with a one-sentence "rationale".`;
  try {
    const j = await webJson('competitor_profile', prompt, timeoutMs, { name: 'competitor_profile', schema: PROFILE_SCHEMA });
    if (!j) return { name: candidate.name, domain: candidate.domain ?? '', classification: 'unconfirmed', rationale: '', capabilities: [], fields: {}, status: 'failed_source', error: 'No structured answer from the research model.', observedAt };
    return await toProfile(j, candidate, subject, observedAt);
  } catch (error) {
    return { name: candidate.name, domain: candidate.domain ?? '', classification: 'unconfirmed', rationale: '', capabilities: [], fields: {}, status: 'failed_source', error: error instanceof Error ? error.message : String(error), observedAt };
  }
}

/** Turn one structured profile into checked fields: every value re-opened at its source. */
async function toProfile(
  j: any,
  candidate: { name: string; domain?: string | null },
  subject: { capabilities: string[] },
  observedAt: string,
): Promise<CompetitorProfile> {
  {
    const fields: CompetitorProfile['fields'] = {};
    await Promise.all(Object.keys(FIELD_HELP).map(async (k) => {
      const f = j.fields?.[k];
      if (!f || typeof f.value !== 'string' || !f.value.trim() || typeof f.url !== 'string' || !/^https?:\/\//.test(f.url)) return;
      if (/^(not (publicly )?(reported|published|found|available|stated|disclosed)|unknown|n\/a|none)\b/i.test(f.value.trim())) return;
      fields[k as FieldKey] = { value: f.value.trim().slice(0, 200), url: f.url, check: await verify(f.value, f.url, { name: candidate.name, domain: candidate.domain || String(j.domain ?? ''), field: k as FieldKey }) };
    }));
    const capabilities = await Promise.all((Array.isArray(j.capabilities) ? j.capabilities : [])
      .filter((c: any) => typeof c?.capability === 'string' && subject.capabilities.includes(c.capability))
      .map(async (c: any) => {
        const url = typeof c.url === 'string' && /^https?:\/\//.test(c.url) ? c.url : '';
        const offers = c.offers === 'yes' || c.offers === true ? true : c.offers === 'no' || c.offers === false ? false : null;
        // A "yes" needs a page that answers; a "no" is the model's reading and stays unconfirmed.
        const check: 'confirmed' | 'unconfirmed' = offers && url ? ((await pageText(url, 15_000)) ? 'confirmed' : 'unconfirmed') : 'unconfirmed';
        return { capability: String(c.capability), offers: url || offers === false ? offers : null, url, check };
      }));
    const classification = ['direct', 'adjacent', 'substitute', 'not_competitor'].includes(j.classification) ? j.classification : 'unconfirmed';
    // The candidate's own domain wins: the model must not swap in a different company.
    const domain = String(candidate.domain || j.domain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    return { name: candidate.name || String(j.name ?? ''), domain, classification, rationale: String(j.rationale ?? '').slice(0, 300), capabilities, fields, status: 'observed', error: null, observedAt };
  }
}

/**
 * Discovery and profiling in ONE web-search call: the declared competitors plus up to `limit`
 * companies found that sell the same kind of product to the same buyer, each with a full sourced
 * profile. Every value is still re-opened and checked afterwards, exactly as for a single profile.
 */
export async function discoverAndProfile(
  subject: { brand: string; domain: string; offering: string; capabilities: string[]; buyers: string | null; geography: string | null },
  declared: Array<{ name: string; domain: string }>,
  limit = 4,
  timeoutMs = 150_000,
): Promise<CompetitorProfile[]> {
  const observedAt = new Date().toISOString();
  const own = subject.domain.replace(/^www\./, '').toLowerCase();
  const prompt = `You are a market analyst. Use web search. "${subject.brand}" (${subject.domain}) sells: ${subject.offering}. Its buyers: ${subject.buyers ?? 'not stated'}. Market: ${subject.geography ?? 'not stated'}.
Return up to ${limit} competitors: ${declared.length ? `first these, declared by the company: ${declared.map((d) => `${d.name}${d.domain ? ` (${d.domain})` : ''}`).join(', ')}; then ` : ''}other companies selling the same kind of product to the same kind of buyer — specialist products a buyer would genuinely compare with ${subject.brand}, not general-purpose platforms unless they market a directly comparable product. Never include ${subject.brand} itself.
For each, fill every field ONLY from a page you actually opened, with that exact page's URL; if not found, value "" and url "". Never estimate: revenue, funding and employee figures only when a page states them.
Fields: ${Object.entries(FIELD_HELP).map(([k, v]) => `${k} (${v})`).join('; ')}.
"capabilities": for each of these ${subject.brand} capabilities, copied exactly, "yes", "no" or "unknown" with the URL that shows it: ${subject.capabilities.map((c) => `"${c}"`).join(', ')}.
"classification": "direct" (same product, same buyer), "adjacent" (overlapping product or buyer), "substitute" (different way to do the same job) or "not_competitor"; one-sentence "rationale".`;
  try {
    const j = await webJson('competitor_set', prompt, timeoutMs, {
      name: 'competitor_set', schema: { type: 'object', additionalProperties: false, required: ['competitors'], properties: { competitors: { type: 'array', items: PROFILE_SCHEMA } } },
    });
    const list: any[] = Array.isArray(j?.competitors) ? j.competitors : [];
    const clean = (d: unknown) => String(d ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
    const picked = list.filter((c) => c && c.name && clean(c.domain) !== own && String(c.name).toLowerCase() !== subject.brand.toLowerCase()).slice(0, limit);
    return await Promise.all(picked.map((c) => {
      const match = declared.find((d) => d.name.toLowerCase() === String(c.name).toLowerCase() || (d.domain && d.domain === clean(c.domain)));
      return toProfile(c, { name: match?.name ?? String(c.name), domain: match?.domain || clean(c.domain) }, subject, observedAt);
    }));
  } catch {
    return [];
  }
}

const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['competitors'],
  properties: { competitors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'domain', 'why', 'url'],
    properties: { name: { type: 'string' }, domain: { type: 'string' }, why: { type: 'string' }, url: { type: 'string' } } } } },
};

/**
 * Find companies that sell the same kind of product to the same buyer. Each must come with the page
 * that shows it; candidates without a URL, or that are the subject itself, are dropped. Profiling
 * (and classification) happens afterwards, so a weak candidate is ruled out on its own evidence.
 */
export async function discoverCompetitors(
  subject: { brand: string; domain: string; offering: string; buyers: string | null; geography: string | null },
  limit = 5,
  timeoutMs = 90_000,
): Promise<Array<{ name: string; domain: string; why: string; url: string }>> {
  const prompt = `You are a market analyst. Use web search. "${subject.brand}" (${subject.domain}) sells: ${subject.offering}. Its buyers: ${subject.buyers ?? 'not stated'}. Market: ${subject.geography ?? 'not stated'}.
Find up to ${limit} other companies that sell the same kind of product to the same kind of buyer — specialist products a buyer would genuinely compare with ${subject.brand}, not general-purpose platforms unless they market a directly comparable product. For each give its name, website domain, one sentence on why it competes, and the URL of the page (its own product page or a comparison article) that shows it.`;
  try {
    const j = await webJson('competitor_discovery', prompt, timeoutMs, { name: 'competitor_discovery', schema: DISCOVERY_SCHEMA });
    const own = subject.domain.replace(/^www\./, '').toLowerCase();
    return (Array.isArray(j?.competitors) ? j.competitors : [])
      .map((c: any) => ({ name: String(c?.name ?? '').trim(), domain: String(c?.domain ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase(), why: String(c?.why ?? '').slice(0, 240), url: String(c?.url ?? '') }))
      .filter((c: { name: string; domain: string; url: string }) => c.name && c.domain && c.domain !== own && /^https?:\/\//.test(c.url))
      .slice(0, limit);
  } catch {
    return [];
  }
}
