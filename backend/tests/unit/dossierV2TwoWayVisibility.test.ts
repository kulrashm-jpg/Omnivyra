/**
 * Visibility both ways (found by buyers / recognised by name and by description), missing data framed
 * as missing data, and the offering-first competitor shortlist (at most eight, direct peers first).
 */
import { classifyProviderError, errorEvidence } from '../../services/intelligence/publicResearch/providerErrors';
import { readResultPage, searchPlan } from '../../services/intelligence/publicResearch/searchResults';
import { brandTokens, candidatesFromEvidence, domainGuesses, focusOf, scaleOf, shortlist, type Candidate } from '../../services/intelligence/publicResearch/competitorDiscovery';
import { definitionalTemplate } from '../../services/intelligence/publicResearch/aiQuestions';
import { proposeQueries } from '../../services/intelligence/publicResearch/offeringRegister';
import { twoWayVisibility } from '../../services/intelligence/dossierV2/research';
import { buildDiagnostics } from '../../services/intelligence/dossierV2/diagnostics';
import { buildLedger } from '../../services/intelligence/dossierV2/ledger';

const payload = (): any => ({
  generated_at: '2026-10-26T02:00:00Z', pillars: [],
  report1: { evidence_acquisition: { crawl: { action: 'reused', pagesAfter: 2, lastCrawledAt: '2026-10-26T01:00:00Z' } }, website_checks: { pagesEvaluated: 2 }, company_identity: { fields: [] },
    search_visibility: { state: 'failed', reason: 'SerpAPI responded with HTTP 429', queriesRun: 0, observations: [] } },
});
const pack = (o: Record<string, unknown> = {}): any => ({
  subject: { brand: 'Acme', domain: 'acme.test' }, collectedAt: '2026-10-26T02:00:00Z', collector: 't', method: {},
  company: [], search: [], generative: [], competitors: [], independent: [], gaps: [], site: [], benchmark: [], ...o,
});
const gen = (o: Record<string, unknown>) => ({ id: 'E-GEN-01', kind: 'chatgpt_search', surface: 'ChatGPT search', claim: 'ChatGPT search: x', status: 'observed', confidence: 'high', sourceUrl: '', observedAt: '2026-10-26T02:00:00Z', method: '', scope: '', query: 'best tools for x', ...o });
const quotaErr = (message: string) => ({ httpStatus: 429, codes: [], quota: null, message, errorClass: 'quota_exhausted', causeConfirmed: true });

describe('missing data is explained as missing data, from the evidence of this run', () => {
  const p = () => pack({
    providerChecks: [
      // A report generated on the worker labels its checks "local": the row must still be used.
      { provider: 'SerpAPI', environment: 'local', outcome: 'quota_exhausted', causeConfirmed: true, credential: 'present', detail: 'Valid key; plan “Free Plan”; 0 searches left this period.', at: '2026-10-26T02:00:00Z', httpStatus: 200 },
      { provider: 'PageSpeed Insights', environment: 'local', outcome: 'quota_exhausted', causeConfirmed: false, credential: 'absent', detail: 'Quota exceeded.', at: '2026-10-26T02:00:00Z', httpStatus: 429, operation: 'GET' },
    ],
    generative: [
      gen({ kind: 'google_ai_mode', surface: 'Google AI Mode', status: 'failed_source', claim: 'Google AI Mode: Your account has run out of searches.', providerError: quotaErr('Your account has run out of searches.') }),
      gen({ kind: 'bing_copilot', surface: 'Bing Copilot', status: 'failed_source', claim: 'Bing Copilot: Your account has run out of searches.', providerError: quotaErr('Your account has run out of searches.') }),
    ],
  });

  it('a search with no results and an exhausted plan is "quota exhausted", with a reader-facing reason', () => {
    const rows = buildDiagnostics(buildLedger(payload(), p()), p());
    const s = rows.find((r) => r.key === 'search')!;
    expect(s.state).toBe('quota_exhausted');
    expect(s.causeConfirmed).toBe(true);
    expect(s.cause).not.toMatch(/stored results/);
    expect(s.plain).toMatchObject({ by: 'next run', short: 'search allowance used up' });
  });
  it('AI Mode and Copilot quote what the provider said — never a stale credential cause', () => {
    const rows = buildDiagnostics(buildLedger(payload(), p()), p());
    for (const key of ['ai_mode', 'copilot']) {
      const r = rows.find((x) => x.key === key)!;
      expect(r.cause).toMatch(/run out of searches/);
      expect(r.cause).not.toMatch(/Invalid API key/);
      expect(r.causeConfirmed).toBe(true);
      expect(r.next).not.toMatch(/credential fix/);
    }
  });
  it('backlinks, registry and page speed each say which data or access was missing and who provides it', () => {
    const rows = buildDiagnostics(buildLedger(payload(), p()), p());
    const psi = rows.find((r) => r.key === 'pagespeed')!;
    expect(psi.plain?.short).toBe('speed-test limit hit');
    for (const r of rows.filter((x) => x.plain)) {
      expect(r.plain!.why).not.toMatch(/\b(cannot|unable to|not supported)\b/i);
      expect(r.plain!.unlock.length).toBeGreaterThan(10);
    }
  });
  it('Google names the quota inside its message; a free-tier limit of 0 confirms the cause', () => {
    const ev = errorEvidence(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3-flash-lite' } });
    expect(ev.quota).toMatch(/free_tier_requests \(limit 0, model gemini-3-flash-lite\)/);
    expect(classifyProviderError(ev)).toMatchObject({ errorClass: 'quota_exhausted', causeConfirmed: true });
  });
});

describe('visibility both ways', () => {
  it('reads the brand-name result page: own position, knowledge panel, and what ranks instead', () => {
    const page = { organic_results: [{ position: 1, title: 'Acme Corp — anvils', link: 'https://acmecorp.com/' }, { position: 2, title: 'Acme', link: 'https://www.acme.test/' }],
      knowledge_graph: { title: 'Acme Corp', website: 'https://acmecorp.com' } };
    const r = readResultPage(page, 'acme.test');
    expect(r.ownPosition).toBe(2);
    expect(r.knowledgePanel).toMatchObject({ title: 'Acme Corp', matchesSite: false });
    expect(searchPlan('Acme', [{ query: 'q1' }, { query: 'q2' }], 1)).toEqual([{ query: 'Acme', intent: 'branded' }, { query: 'q1', intent: 'commercial' }]);
  });
  it('separates found (buyer questions) from recognised (name, and exact description)', () => {
    const t = twoWayVisibility(pack({
      search: [{ id: 'S1', kind: 'search', intent: 'branded', query: 'Acme', status: 'observed', ownPosition: 2, claim: '', confidence: 'high', sourceUrl: '', observedAt: '2026-10-26T02:00:00Z', method: '', scope: '',
        results: [{ position: 1, title: 'x', domain: 'acmecorp.com', url: '' }, { position: 2, title: 'y', domain: 'acme.test', url: '' }], knowledgePanel: null }],
      generative: [
        gen({ intent: 'commercial', query: 'best tools for x', mentioned: false, brandsNamed: ['Rival'] }),
        gen({ intent: 'definitional', query: 'Which platform does exactly x for y?', mentioned: false, brandsNamed: ['Rival', 'Other'] }),
        gen({ intent: 'branded', query: 'What is Acme?', accuracy: 'correct', claim: 'ChatGPT search: describes Acme accurately (matches the site)' }),
      ],
    }))!;
    expect(t.found).toMatchObject({ aiAnswers: 2, aiNamed: 0, searchChecked: 0 });
    expect(t.recognised.nameSearch).toMatchObject({ ownPosition: 2, others: ['acmecorp.com'] });
    expect(t.recognised.aiByName).toHaveLength(1);
    expect(t.recognised.definitional).toMatchObject({ answers: 1, named: 0, namedInstead: ['Rival', 'Other'] });
  });
  it('the fallback definitional question describes the offering without the name', () => {
    const q = definitionalTemplate({ brand: 'Acme', domain: 'acme.test', siteText: '', category: null, offering: 'AI marketing operations platform.', buyers: 'Startups, micro, SMB', market: null });
    expect(q).toEqual({ intent: 'definitional', query: 'Which company offers ai marketing operations platform for startups?' });
  });
});

describe('offering-first competitor shortlist', () => {
  const cand = (name: string, o: Partial<Candidate>): Candidate => ({
    name, domain: `${name.toLowerCase()}.com`, sources: [], pagesRead: ['x'], identityVerified: true, identityBasis: '', signals: { software: true, service: false },
    capabilities: {}, overlap: ['content_ops', 'campaign_ops', 'marketing_analytics'], classification: 'direct', rationale: '', confidence: 'high', checkedAt: '', ...o,
  });
  it('caps at eight: direct peers, then larger or differently-focused direct rivals, then alternatives', () => {
    const list = [
      cand('Giant', { scale: { band: 'large', basis: 'x' }, focus: { bands: ['enterprise'], excerpt: null, match: false } }),
      cand('Peer', { scale: { band: 'early', basis: 'x' }, focus: { bands: ['small_business'], excerpt: null, match: true } }),
      cand('Agency', { classification: 'substitute', signals: { software: false, service: true } }),
      cand('Partial', { classification: 'adjacent', overlap: ['content_ops', 'campaign_ops'] }),
      ...Array.from({ length: 8 }, (_, i) => cand(`Alt${i}`, { classification: 'adjacent', overlap: ['content_ops', 'campaign_ops'] })),
      cand('Unknown', { classification: 'unverified' }),
    ];
    const s = shortlist(list, 'early');
    expect(s).toHaveLength(8);
    expect(s.map((c) => c.name).slice(0, 2)).toEqual(['Peer', 'Giant']);
    expect(s[0].tier).toBe('direct_peer');
    expect(s[1].tier).toBe('direct_other');
    expect(s.some((c) => c.name === 'Unknown')).toBe(false);
  });
  it('size comes only from a stated figure, and buyer focus from the same patterns for every company', () => {
    expect(scaleOf({ revenue: '<$1M' }).band).toBe('early');
    expect(scaleOf({ employees: '1,001-5,000' }).band).toBe('large');
    expect(scaleOf({ pageText: 'Join 200,000+ businesses growing with us' }).band).toBe('large');
    expect(scaleOf({ pageText: 'Marketing made simple' })).toEqual({ band: null, basis: 'no revenue, headcount or customer figure found' });
    expect(focusOf('Built for small businesses and agencies').bands).toEqual(['small_business', 'agency']);
  });
  it('merges product names of one company and resolves a domain from the answer’s own citations', () => {
    const raw = candidatesFromEvidence({
      subject: { domain: 'acme.test', brand: 'Acme' }, search: [], competitors: [],
      generative: [
        { status: 'observed', query: 'best tools', brandsNamed: ['HubSpot Marketing Hub', 'Jasper AI'], citedDomains: ['https://www.hubspot.com/products'], observedAt: '2026-10-26' },
        { status: 'observed', query: 'top platforms', brandsNamed: ['HubSpot', 'HubSpot CRM'], observedAt: '2026-10-26' },
      ],
    }, () => false);
    const hub = raw.find((c) => brandTokens(c.name).first === 'hubspot')!;
    expect(raw.filter((c) => brandTokens(c.name).first === 'hubspot')).toHaveLength(1);
    expect(hub.domain).toBe('hubspot.com');
    expect(hub.sources).toHaveLength(3);
    expect(domainGuesses('Jasper AI')[0]).toBe('jasper.ai');
    expect(domainGuesses('Surfer SEO')).toContain('surferseo.com');
  });
});

describe('proposed queries read like searches', () => {
  it('drops full-sentence problems and trailing punctuation', () => {
    const reg: any = { entries: [
      { field: 'customer_problem', value: 'Marketing operations rarely fail from lack of effort.', status: 'official_website_verified' },
      { field: 'customer_problem', value: 'Fragmented marketing tools', status: 'official_website_verified' },
      { field: 'value_proposition', value: 'AI-Driven Digital Marketing System', status: 'company_declared', provenance: { profileField: 'x' } },
      { field: 'buyer', value: 'Startups, micro, SMB, and later enterprises.', status: 'company_declared', provenance: { profileField: 'y' } },
    ], missing: [], provisional: true };
    const q = proposeQueries(reg, { items: [], assumptions: [] }).map((x) => x.query);
    expect(q).toContain('how to fix fragmented marketing tools');
    expect(q.some((x) => /rarely fail/.test(x))).toBe(false);
    expect(q).toContain('ai-driven digital marketing system for startups');
  });
});
