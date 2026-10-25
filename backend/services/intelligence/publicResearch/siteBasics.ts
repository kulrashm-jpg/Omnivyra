/**
 * Public research — the crawl and entity basics of a website, read directly over HTTP.
 * robots.txt, llms.txt, the sitemap (size, coverage of the pages the homepage links to, whether
 * every <lastmod> is identical), structured-data types on the homepage, and whether official
 * social profiles are linked. Each check returns what was fetched; nothing is inferred.
 */
import { readCapped, safeFetch } from '../../../../lib/security/safeFetch';

export type SiteCheck = {
  key: 'robots' | 'llms' | 'sitemap' | 'organization_schema' | 'profile_links';
  ok: boolean | null;
  claim: string;
  url: string;
  excerpt: string;
};

const UA = 'Mozilla/5.0 (compatible; OmnivyraSnapshot/1.0; +https://www.omnivyra.com)';
const SOCIAL = /https?:\/\/(?:www\.)?(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|tiktok\.com)\/[^"'\s<>]+/gi;

/** The domain comes from the company profile, so every fetch goes through the SSRF-safe client. */
async function get(url: string, timeoutMs: number): Promise<{ status: number; type: string; body: string } | null> {
  try {
    const res = await safeFetch(url, { headers: { 'user-agent': UA } }, { timeoutMs, maxBytes: 2_000_000, metricLabel: 'public_research_site' });
    const body = (await readCapped(res, 2_000_000)).toString('utf8');
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: body.slice(0, 400_000) };
  } catch {
    return null;
  }
}

export async function checkSiteBasics(domain: string, timeoutMs = 20_000): Promise<SiteCheck[]> {
  const origin = `https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const [robots, llms, home] = await Promise.all([get(`${origin}/robots.txt`, timeoutMs), get(`${origin}/llms.txt`, timeoutMs), get(`${origin}/`, timeoutMs)]);
  const checks: SiteCheck[] = [];
  const isText = (r: typeof robots) => Boolean(r && r.status === 200 && !/text\/html/i.test(r.type) && r.body.trim());

  checks.push(robots
    ? { key: 'robots', ok: isText(robots), url: `${origin}/robots.txt`, excerpt: isText(robots) ? robots.body.split('\n').slice(0, 3).join(' | ').slice(0, 160) : `HTTP ${robots.status}`,
        claim: isText(robots) ? 'robots.txt is published' : `robots.txt is missing (HTTP ${robots.status})` }
    : { key: 'robots', ok: null, url: `${origin}/robots.txt`, excerpt: 'no response', claim: 'robots.txt could not be fetched' });
  checks.push(llms
    ? { key: 'llms', ok: isText(llms), url: `${origin}/llms.txt`, excerpt: isText(llms) ? llms.body.split('\n')[0].slice(0, 160) : `HTTP ${llms.status}`,
        claim: isText(llms) ? 'llms.txt is published' : `llms.txt is missing (HTTP ${llms.status})` }
    : { key: 'llms', ok: null, url: `${origin}/llms.txt`, excerpt: 'no response', claim: 'llms.txt could not be fetched' });

  // Sitemap: from robots.txt, else /sitemap.xml.
  const declared = isText(robots) ? /^sitemap:\s*(\S+)/im.exec(robots!.body)?.[1] : null;
  const smUrl = declared ?? `${origin}/sitemap.xml`;
  const sm = await get(smUrl, timeoutMs);
  if (sm && sm.status === 200 && /<urlset|<sitemapindex/i.test(sm.body)) {
    const locs = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const mods = [...sm.body.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)].map((m) => m[1]);
    const paths = new Set(locs.map((u) => u.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/'));
    const linked = home ? [...new Set([...home.body.matchAll(/href="(\/[a-z0-9][a-z0-9\-/]*)"/gi)].map((m) => m[1].replace(/\/$/, '')))] : [];
    const missing = linked.filter((p) => !paths.has(p) && !/^\/(login|signin|signup|create-account|api|_next)/.test(p)).slice(0, 8);
    const sameMod = mods.length > 1 && new Set(mods).size === 1;
    const index = /<sitemapindex/i.test(sm.body);
    const ok = !index ? missing.length === 0 && !sameMod : null;
    checks.push({ key: 'sitemap', ok, url: smUrl,
      excerpt: `${locs.length} <loc> entries${mods.length ? `; lastmod ${sameMod ? `identical on all (${mods[0]})` : 'varies'}` : ''}`,
      claim: index ? `Sitemap index with ${locs.length} child sitemaps`
        : `Sitemap lists ${locs.length} URLs${missing.length ? ` and omits pages the homepage links to (${missing.join(', ')})` : ''}${sameMod ? '; every <lastmod> is the same timestamp' : ''}` });
  } else {
    checks.push({ key: 'sitemap', ok: sm ? false : null, url: smUrl, excerpt: sm ? `HTTP ${sm.status}` : 'no response', claim: sm ? `No sitemap at ${smUrl.replace(origin, '')} (HTTP ${sm.status})` : 'Sitemap could not be fetched' });
  }

  if (home && home.status === 200) {
    const types = [...new Set([...home.body.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]))];
    const org = types.some((t) => /^(Organization|Corporation|LocalBusiness|SoftwareApplication|WebSite)$/.test(t));
    const sameAs = /"sameAs"\s*:/.test(home.body);
    checks.push({ key: 'organization_schema', ok: org && sameAs, url: `${origin}/`, excerpt: types.length ? `@type: ${types.join(', ')}` : 'no JSON-LD',
      claim: org ? `Homepage structured data includes ${types.filter((t) => /Organization|Corporation|LocalBusiness|SoftwareApplication|WebSite/.test(t)).join(', ')}${sameAs ? ' with sameAs profile links' : ' but no sameAs profile links'}`
        : `Homepage structured data has no Organization entity${types.length ? ` (only ${types.join(', ')})` : ''}` });
    const profiles = [...new Set([...home.body.matchAll(SOCIAL)].map((m) => m[1].replace('twitter.com', 'x.com')))];
    checks.push({ key: 'profile_links', ok: profiles.length > 0, url: `${origin}/`, excerpt: profiles.length ? profiles.join(', ') : 'no links to social profiles',
      claim: profiles.length ? `Homepage links to official profiles on ${profiles.join(', ')}` : 'Homepage links to no social profiles' });
  }
  return checks;
}
