/**
 * Company profile as OPTIONAL enrichment of the Digital Snapshot — end to end through public research
 * (offering register, market, buyer-intent queries, competitor discovery) and the rendered dossier.
 *
 *   Case A  populated profile — facts enrich the ledger with provenance; website evidence is intact
 *   Case B  partial profile   — present fields used, absent ones researched; conflicts kept
 *   Case C  no profile        — the report runs on website and public evidence alone
 * plus: access error, malformed record, identity mismatch, duplicates, stale and conflicting facts.
 * Network is mocked; nothing here calls a provider.
 */
import { collectPublicResearch, researchInputFromNarrative } from '../../services/intelligence/publicResearch/collect';
import { lookupProfile, profileEvidence } from '../../services/intelligence/publicResearch/profileEvidence';
import { parseResearchPack } from '../../services/intelligence/dossierV2/research';
import { lastValidation, renderDossierV2Html } from '../../services/intelligence/dossierV2/render';

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: async (url: string, init?: RequestInit) => (global.fetch as typeof fetch)(url, init),
  readCapped: async (res: Response) => Buffer.from(await res.text()),
}));
jest.mock('../../services/providerCredentialResolver', () => ({ resolveProviderCredential: async () => ({ value: null }) }));

const COMPANY = 'cmp-prof-0000-0000-0000-000000000001';
const realFetch = global.fetch;
const KEYS = ['OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'SERPAPI_KEY', 'SERP_API_KEY', 'SERPAPI_API_KEY', 'PAGESPEED_API_KEY'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { global.fetch = realFetch; for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const page = (body: string) => `<html><head><title>Acme | Campaign software</title></head><body>${body}</body></html>`;
const SITE: Record<string, string> = {
  'https://acme.test/': page('<h1>Plan every campaign in one place.</h1><a href="/features">f</a><a href="/solutions">s</a><a href="/about">a</a><p>Acme connects content and campaigns for marketing teams.</p>'),
  'https://acme.test/features': page('<h2>Campaign Planning</h2><p>Plan and execute marketing campaigns across channels.</p><h2>Content Calendar</h2><p>Create and schedule social content.</p>'),
  'https://acme.test/solutions': page('<h2>Built for agencies</h2><p>Agencies and growth teams run client marketing campaigns with Acme.</p>'),
  'https://acme.test/about': page('<h1>About Acme</h1><p>Acme was founded in 2021 in Pune.</p>'),
};
function mockWeb() {
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input);
    const html = SITE[url];
    return { ok: Boolean(html), status: html ? 200 : 404, headers: { get: () => (html ? 'text/html' : 'text/plain') }, json: async () => ({}), text: async () => html ?? '' } as unknown as Response;
  }) as unknown as typeof fetch;
}

const RECENT = new Date(Date.now() - 20 * 86_400_000).toISOString();
const FULL_PROFILE = {
  id: 'prof-1', company_id: COMPANY, name: 'Acme', source: 'user', updated_at: RECENT,
  products_services_list: ['Campaign Planning', 'Campaign Planning', 'AI copywriting'],
  target_customer_segment: 'Marketing agencies', industry: 'Marketing software', geography: 'India',
  pricing_model: 'Monthly subscription', competitive_advantages: 'One workspace for content and campaigns',
  report_settings: { company_facts: { revenue_range: '₹1–5 crore (FY2025)', team_size: '11-50', founded_year: '2019' } },
};

async function run(profile: ReturnType<typeof profileEvidence> | null, companyName: string | null = 'Acme') {
  mockWeb();
  const input = researchInputFromNarrative({ companyName, domain: 'acme.test', homepageHeadline: null, tagline: null, primaryOffering: null, positioning: null,
    marketContext: null, marketFocus: null, productServices: profile ? profile.facts.filter((f) => f.field === 'product_line' || f.field === 'offering').map((f) => f.value) : [], geography: null, profile });
  expect(input).not.toBeNull();
  const pack = await collectPublicResearch(input!);
  const parsed = parseResearchPack(pack, 'acme.test')!;
  const html = renderDossierV2Html({ generated_at: new Date().toISOString(), pillars: [], report1: {} } as never, { brandName: input!.brand, domain: 'acme.test' }, pack);
  return { pack: parsed, html, validation: lastValidation! };
}

describe('Case A — populated profile', () => {
  it('enriches the register with provenance, keeps website evidence, and feeds queries and discovery', async () => {
    const pe = profileEvidence(FULL_PROFILE, { status: 'profile_available', detail: null }, COMPANY);
    expect(pe.status).toBe('profile_available');
    const { pack: a, html, validation } = await run(pe);
    const { pack: c } = await run(null);
    const reg = a.register!;
    // Each profile fact carries its record, field, capture time and author.
    const revenue = reg.entries.find((e) => e.field === 'revenue')!;
    expect(revenue).toMatchObject({ value: '₹1–5 crore (FY2025)', status: 'company_declared' });
    expect(revenue.provenance).toMatchObject({ source: 'company_profile', recordId: 'prof-1', profileField: 'report_settings.company_facts.revenue_range', capturedAt: RECENT, attribution: 'company user' });
    // A profile claim the website states in the same words is website-verified, and remembers it was also declared.
    const planning = reg.entries.filter((e) => e.field === 'product_line' && e.value === 'Campaign Planning');
    expect(planning).toHaveLength(1);
    expect(planning[0].status).toBe('official_website_verified');
    expect(planning[0].alsoDeclared?.profileField).toBe('products_services');
    // A declared capability the site does not state stays declared.
    expect(reg.entries.find((e) => e.value === 'AI copywriting')?.status).toBe('company_declared');
    // Website evidence from the no-profile run is all still present (founded is now a recorded conflict).
    for (const w of c.register!.entries.filter((e) => e.status === 'official_website_verified' && e.field !== 'founded')) {
      expect(reg.entries.some((e) => e.field === w.field && e.value === w.value && e.status === 'official_website_verified')).toBe(true);
    }
    // Queries: the declared offering adds a labelled query; discovery ran.
    expect(a.proposedQueries!.some((q) => /company profile \(declared/i.test(q.basis))).toBe(true);
    expect(Array.isArray(a.candidates)).toBe(true);
    expect(html).toContain('Company profile (filled)');
    expect(html).toContain('Revenue (as declared)');
    expect(validation.issues.filter((i) => i.blocking)).toEqual([]);
  });
});

describe('Case B — partial profile', () => {
  it('uses the fields present, researches the rest, and keeps a conflict on both sides', async () => {
    const pe = profileEvidence({ id: 'prof-2', company_id: COMPANY, source: 'ai_refined', updated_at: RECENT, products_services: 'Campaign Planning', report_settings: { company_facts: { founded_year: '2019' } } },
      { status: 'profile_available', detail: null }, COMPANY);
    expect(pe.status).toBe('profile_partial');
    expect(pe.fieldsPresent).toEqual(expect.arrayContaining(['offering', 'founded']));
    const { pack, html, validation } = await run(pe);
    const reg = pack.register!;
    // Buyers were not in the profile: they come from the website, verified.
    expect(reg.entries.filter((e) => e.field === 'buyer').every((e) => e.status === 'official_website_verified')).toBe(true);
    expect(reg.entries.some((e) => e.field === 'buyer')).toBe(true);
    // Founded: website 2021 vs profile 2019 — both kept, each naming the other.
    const founded = reg.entries.filter((e) => e.field === 'founded');
    expect(founded.map((e) => [e.value, e.status])).toEqual(expect.arrayContaining([['2021', 'conflicting'], ['2019', 'conflicting']]));
    expect(founded.find((e) => e.value === '2019')?.provenance?.attribution).toBe('AI-refined profile');
    expect(founded.find((e) => e.value === '2021')?.url).toBe('https://acme.test/about');
    expect(html).toContain('Company profile (partly filled)');
    expect(html).toContain('both kept; not resolved');
    expect(html).not.toMatch(/complete (your|the) (company )?profile/i);
    expect(validation.issues.filter((i) => i.blocking)).toEqual([]);
  });
});

describe('Case C — no profile', () => {
  it('runs on the website alone, with no zeros and nothing invented', async () => {
    const pe = profileEvidence(null, { status: 'profile_not_found', detail: null }, COMPANY);
    const { pack, html, validation } = await run(pe, null);
    expect(pack.brandSource).toBe('domain');
    expect(pack.subject.brand).toBe('Acme');
    expect(pack.register!.entries.some((e) => e.provenance)).toBe(false);
    expect(pack.register!.entries.some((e) => ['revenue', 'team_size'].includes(e.field))).toBe(false);
    expect(pack.register!.entries.some((e) => e.field === 'product_line' && e.status === 'official_website_verified')).toBe(true);
    expect(Array.isArray(pack.candidates)).toBe(true);
    expect(pack.proposedQueries!.length).toBeGreaterThan(0);
    expect(pack.proposedQueries!.every((q) => !/company profile/i.test(q.basis))).toBe(true);
    expect(html).toContain('No company profile was available');
    expect(html).not.toMatch(/revenue[^.<]{0,30}\b(0|zero)\b/i);
    expect(html).not.toMatch(/\b(NaN|undefined|null)\b/);
    expect(validation.issues.filter((i) => i.blocking)).toEqual([]);
  });
});

describe('profile edge cases', () => {
  it('a lookup failure is an access error, never "no profile", and the report still renders', async () => {
    const { profile, lookup } = await lookupProfile(async () => { throw new Error('permission denied for table company_profiles (token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc)'); });
    expect(profile).toBeNull();
    expect(lookup.status).toBe('profile_access_error');
    expect(lookup.detail).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc/);
    const { html, validation } = await run(profileEvidence(null, lookup, COMPANY));
    expect(html).toContain('could not be read');
    expect(html).not.toContain('No company profile was available');
    expect(validation.issues.filter((i) => i.blocking)).toEqual([]);
  });
  it('a malformed record yields no facts and no exception', () => {
    expect(profileEvidence('not a record', { status: 'profile_available', detail: null }, COMPANY).status).toBe('profile_access_error');
    expect(profileEvidence({ company_id: COMPANY, products_services: 42, geography: ['x'], report_settings: 'bad' }, { status: 'profile_available', detail: null }, COMPANY))
      .toMatchObject({ status: 'profile_empty', facts: [] });
    expect(profileEvidence({ company_id: COMPANY, target_audience: 'N/A', industry: '  ' }, { status: 'profile_available', detail: null }, COMPANY).status).toBe('profile_empty');
  });
  it('drops placeholders and does not repeat a comma-joined field its list already covers', () => {
    const pe = profileEvidence({ company_id: COMPANY, geography: 'Other', geography_list: ['India', 'Global'], industry: 'SaaS, Analytics', industry_list: ['SaaS', 'Analytics'],
      target_audience: 'Agencies, Startups', target_audience_list: ['Agencies', 'Startups'] }, { status: 'profile_available', detail: null }, COMPANY);
    expect(pe.facts.map((f) => f.value)).toEqual(['Agencies', 'Startups', 'SaaS', 'Analytics', 'India', 'Global']);
  });
  it('never uses another company’s profile', () => {
    expect(profileEvidence({ ...FULL_PROFILE, company_id: 'someone-else' }, { status: 'profile_available', detail: null }, COMPANY)).toMatchObject({ status: 'profile_identity_mismatch', facts: [] });
  });
  it('records one claim once', () => {
    const pe = profileEvidence(FULL_PROFILE, { status: 'profile_available', detail: null }, COMPANY);
    const keys = pe.facts.map((f) => `${f.field}:${f.value.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('labels a stale profile and never lets it drive queries or outrank the website', async () => {
    const old = new Date(Date.now() - 800 * 86_400_000).toISOString();
    const pe = profileEvidence({ ...FULL_PROFILE, updated_at: old }, { status: 'profile_available', detail: null }, COMPANY);
    expect(pe.facts.every((f) => f.stale)).toBe(true);
    const { pack, html } = await run(pe);
    expect(pack.register!.entries.filter((e) => e.provenance).every((e) => e.confidence === 'low')).toBe(true);
    expect(pack.proposedQueries!.some((q) => /company profile/i.test(q.basis))).toBe(false);
    expect(html).toContain('older than a year');
  });
});

describe('profile list fields', () => {
  it('splits a comma-joined products field into separate declared items', () => {
    const pe = profileEvidence({ company_id: COMPANY, products_services: 'Campaign Planning, SEO audits, Content calendar' }, { status: 'profile_available', detail: null }, COMPANY);
    expect(pe.facts.map((f) => [f.field, f.value])).toEqual([['offering', 'Campaign Planning'], ['product_line', 'SEO audits'], ['product_line', 'Content calendar']]);
  });
});
