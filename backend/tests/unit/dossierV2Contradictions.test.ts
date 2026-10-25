/**
 * Dossier v2 — the automated contradiction checks that fail the build (report-consistency CI job).
 *
 * One test per rule: each feeds the validator a report that breaks exactly that rule and expects
 * the rule to fire, and a clean counterpart that must not. Plus the evidence models the rules rest
 * on: the crawl funnel, the offering provenance check, the footprint families and the AI vocabulary.
 */
import { buildDossierRegistry } from '../../services/intelligence/dossierV2/registry';
import { aiCellState, aiStateOf, buildLedger, urlPurpose } from '../../services/intelligence/dossierV2/ledger';
import { validateReport } from '../../services/intelligence/dossierV2/validate';
import { withoutConfigNames } from '../../services/intelligence/dossierV2/render';
import { findPassage, judgeClaim, pageText, publishedPricing, purposeOf } from '../../services/intelligence/publicResearch/offering';
import { classifyCrawlRow } from '../../services/crawl/reportCrawlEvidenceService';
import { parseResearchPack, withoutNamesakes } from '../../services/intelligence/dossierV2/research';

const REPORT_DAY = 'Evidence dates: website crawl 25 Oct 2026 · report 25 Oct 2026.';

function payload(over: Record<string, unknown> = {}): any {
  return {
    generated_at: '2026-10-25T10:00:00Z',
    pillars: [],
    report1: {
      evidence_acquisition: { crawl: { action: 'reused', pagesAfter: 6, lastCrawledAt: '2026-10-25T07:00:00Z' } },
      website_checks: { pagesEvaluated: 2, total: 10, evaluated: 8, groups: [] },
      company_identity: { fields: [{ label: 'Market', declaredValue: 'SaaS in India', observedValue: null, agreement: 'declared_only' }] },
    },
    authority_inflow: { score: { state: 'unavailable', value: null }, rationale: { text: 'No backlink/authority API is configured.' } },
    ...over,
  };
}

const rec = (over: Record<string, unknown>) => ({ id: 'E-GEN-01', kind: 'chatgpt_search', surface: 'ChatGPT search', claim: '', status: 'observed', confidence: 'high', sourceUrl: '', observedAt: '2026-10-25T09:00:00Z', method: '', scope: '', ...over });
function pack(over: Record<string, unknown> = {}): any {
  return {
    subject: { brand: 'Acme', domain: 'acme.test' }, collectedAt: '2026-10-25T09:00:00Z', collector: 'test', method: {},
    company: [], search: [], competitors: [], independent: [], gaps: [], site: [], benchmark: [],
    generative: [
      rec({ id: 'E-GEN-01', query: 'best tools for x', mentioned: false, citedDomains: ['source.test'] }),
      rec({ id: 'E-GEN-02', query: 'what helps with y', mentioned: false, citedDomains: ['source.test'] }),
      rec({ id: 'E-GEN-03', kind: 'gemini_search', surface: 'Gemini (Google Search grounding)', query: 'best tools for x', status: 'failed_source' }),
      rec({ id: 'E-GEN-04', kind: 'perplexity', surface: 'Perplexity', query: 'best tools for x', status: 'not_measured' }),
    ],
    ...over,
  };
}

const run = (html: string, p: any = pack(), pl: any = payload()) => {
  const ledger = buildLedger(pl, p);
  return validateReport(ledger, buildDossierRegistry(pl, p), `<html><body>${html}</body></html>`, [], p);
};
const rules = (html: string, p?: any, pl?: any) => run(html, p, pl).issues.filter((i) => i.blocking).map((i) => i.rule);

describe('dossier v2 contradiction checks (each fails the build)', () => {
  it('a clean report passes', () => {
    expect(rules(`<section id="summary-now"><p>${REPORT_DAY}</p><p>0 of 2 grounded answers to buyer questions name the company.</p></section>`)).toEqual([]);
  });

  it('numbers must match the evidence rows', () => {
    expect(rules(`<p>${REPORT_DAY}</p><p>Named in 1 of 9 grounded AI answers to buyer questions.</p>`)).toContain('numbers');
  });

  it('crawl totals must add up, and never-fetched addresses are not failures', () => {
    const urls = [
      { path: '/', pageType: 'home', status: 200, outcome: 'read' }, { path: '/pricing', pageType: 'pricing', status: 200, outcome: 'read' },
      { path: '/dashboard', pageType: 'landing', status: null, outcome: 'not_fetched' }, { path: '/reports/view/0b3b77c9-fe10-4f08-a78a-8d2f447799dd', pageType: 'landing', status: null, outcome: 'not_fetched' },
      { path: '/campaigns', pageType: 'landing', status: null, outcome: 'not_fetched' }, { path: '/old', pageType: 'other', status: 404, outcome: 'client_error' },
    ];
    const pl = payload();
    pl.report1.evidence_acquisition.crawl.urls = urls;
    const l = buildLedger(pl, null);
    expect(l.crawl).toMatchObject({ known: 6, attempted: 3, notAttempted: 3, responded: 3, read: 2, evaluated: 2, notObserved: 3 });
    expect(l.crawl.byPurpose?.find((b) => b.purpose === 'Account and app screens')?.notFetched).toBe(2);
    expect(rules(`<p>${REPORT_DAY}</p><p>3 known pages gave no response.</p>`, null, pl)).toContain('crawl-wording');
    expect(rules(`<p>${REPORT_DAY}</p><p>3 were never fetched: they came from analytics.</p>`, null, pl)).toEqual([]);
  });

  it('stale narrative is caught: blanket "AI not measured", "measured more recently", generated and spliced templates', () => {
    expect(rules(`<p>${REPORT_DAY}</p><p>AI presence is unmeasured — not low. Connect a retrieval-grounded answer engine.</p>`)).toEqual(expect.arrayContaining(['ai-scope', 'stale-narrative']));
    expect(rules(`<p>${REPORT_DAY}</p><p>Gemini is not shown: the research measured it more recently.</p>`)).toContain('stale-narrative');
    expect(rules(`<p>${REPORT_DAY}</p><p>Acme's positioning as X is currently strong, because clarity signals are visible.</p>`)).toContain('stale-narrative');
    expect(rules(`<p>${REPORT_DAY}</p><p>Strengthen proof for a long sentence around the core focus area to recover trust</p>`)).toContain('stale-narrative');
  });

  it('a failed or unconfigured source is never printed as zero', () => {
    expect(rules(`<p>${REPORT_DAY}</p><ul><li class="v2-ai-source_failed"><span>Gemini</span><b>0/1</b></li></ul>`)).toContain('failed-as-zero');
    expect(rules(`<p>${REPORT_DAY}</p><p>The site has 0 backlinks.</p>`)).toContain('failed-as-zero');
  });

  it('"not found" always says where it was looked for', () => {
    expect(rules(`<p>${REPORT_DAY}</p><td>Funding</td><td>not found</td>`)).toContain('not-found-scope');
    expect(rules(`<p>${REPORT_DAY}</p><p>G2: not found in search. Searched, not found. Looked for, not found.</p>`)).toEqual([]);
  });

  it('a missing key is "not measured", never "no evidence"; configuration names never reach the reader', () => {
    expect(rules(`<p>${REPORT_DAY}</p><p>Set AHREFS_API_KEY to enable.</p>`)).toContain('config-names');
    expect(rules(`<p>${REPORT_DAY}</p><p>Connect it (or PAGESPEED_ENABLED=true).</p>`)).toContain('config-names');
    expect(rules(`<p>${REPORT_DAY}</p><p>Backlinks / referring domains: no evidence of links.</p>`)).toContain('missing-key');
    expect(withoutConfigNames('No adapter. Set AHREFS_API_KEY to enable. Connect it (or PAGESPEED_ENABLED=true) now.')).toBe('No adapter. Connect the provider credential. Connect it now.');
    const l = buildLedger(payload(), null);
    const inbound = l.families.find((f) => f.key === 'inbound_links')!;
    expect(inbound.state).toBe('not_measured');
    expect(inbound.result).toMatch(/not measured/i);
    expect(inbound.limitation).toMatch(/unknown, not zero/);
  });

  it('claim provenance: no like-for-like comparison when most declared capabilities are unverified', () => {
    const cap = (claim: string, state: string) => ({ claim, state, sourceUrl: null, excerpt: null, confidence: 'low', basis: '' });
    const p = pack({ offering: { checkedAt: '2026-10-25T09:00:00Z', pages: [], selfDescription: null, offering: null, pricing: null, freePlan: null,
      capabilities: [cap('A', 'website_verified'), cap('B', 'company_declared'), cap('C', 'company_declared')] } });
    expect(rules(`<p>${REPORT_DAY}</p><p>A competitor covering most of them is a like-for-like rival.</p>`, p)).toContain('provenance');
    expect(rules(`<p>${REPORT_DAY}</p><p>This is a comparison of claims.</p>`, p)).toEqual([]);
  });

  it('competitor comparisons only for validated competitors', () => {
    const p = pack({ competitors: [{ ...rec({ id: 'E-CMP-01' }), kind: 'competitor', name: 'Rival', classification: 'adjacent' }, { ...rec({ id: 'E-CMP-02' }), kind: 'competitor', name: 'Agency', classification: 'substitute' }] });
    expect(rules(`<p>${REPORT_DAY}</p><p>Checked against their own websites, Agency compete for the same buyer.</p>`, p)).toContain('competitors');
    expect(rules(`<p>${REPORT_DAY}</p><p>Checked against their own websites, Rival competes for the same buyer.</p>`, p)).toEqual([]);
  });

  it('action ids resolve', () => {
    const pl = payload();
    const p = pack();
    const reg = buildDossierRegistry(pl, p);
    reg.findings.push({ id: 'F-x', title: 'x', pillar: null, kind: 'coverage', state: 'measured', metric: null, observation: '', implication: null, source: '', actionIds: ['A-missing'] });
    expect(validateReport(buildLedger(pl, p), reg, `<p>${REPORT_DAY}</p>`, [], p).issues.map((i) => i.rule)).toContain('actions');
  });

  it('a wording difference is not called a different story, and a generated assessment is not a company statement', () => {
    const pl = payload();
    pl.report1.company_identity.fields.push({ key: 'positioning', label: 'Positioning', declaredValue: 'One AI platform for marketing', observedValue: 'Fragmented tools limit AI.', agreement: 'differ' });
    const f = buildDossierRegistry(pl, null).findings.find((x) => x.id === 'F-identity-positioning')!;
    expect(f.title).toBe('Declared and published positioning are worded differently');
    expect(f.implication).not.toMatch(/not what they encounter/);
  });

  it('a competitor set validated by the research replaces the scoring run’s "no competitor set"', () => {
    const pl = payload();
    pl.report1.competitive_tables = { empty: true, emptyReason: 'No competitors were discovered.' };
    const p = pack({ competitors: [{ ...rec({ id: 'E-CMP-01' }), kind: 'competitor', name: 'Rival', classification: 'adjacent' }] });
    const f = buildDossierRegistry(pl, p).findings.find((x) => x.id === 'F-competitors-unresolved')!;
    expect(f.title).toBe('Competitor set established by public research');
    expect(f.observation).toContain('Rival');
    expect(buildDossierRegistry(pl, null).findings.find((x) => x.id === 'F-competitors-unresolved')?.title).toBe('No competitor set could be established');
  });

  it('citations: a competitor value shown as observed carries its source page', () => {
    const p = pack({ benchmark: [{ ...rec({ id: 'E-BEN-01' }), kind: 'benchmark', dimension: 'profile_entryPrice', claim: 'Entry price', values: { 'rival.test': { value: '$10/month', status: 'observed', url: '' } } }] });
    expect(rules(`<p>${REPORT_DAY}</p>`, p)).toContain('citations');
    p.benchmark[0].values['rival.test'].url = 'https://rival.test/pricing';
    expect(rules(`<p>${REPORT_DAY}</p>`, p)).toEqual([]);
  });

  it('crawl numbers printed anywhere equal the ledger funnel', () => {
    const pl = payload();
    pl.report1.evidence_acquisition.crawl.urls = [{ path: '/', pageType: 'home', status: 200, outcome: 'read' }, { path: '/x', pageType: 'other', status: null, outcome: 'not_fetched' }];
    pl.report1.website_checks.pagesEvaluated = 1;
    expect(rules(`<p>${REPORT_DAY}</p><p>2 of 2 known addresses fetched.</p>`, null, pl)).toContain('numbers');
    expect(rules(`<p>${REPORT_DAY}</p><p>1 of 2 known addresses fetched.</p>`, null, pl)).toEqual([]);
  });

  it('Report 1 never presents a paid-advertising or lead-outcome metric', () => {
    expect(rules(`<p>${REPORT_DAY}</p><p>ROAS was 2.1 and CPC $0.40.</p>`)).toContain('scope');
  });

  it('one register: duplicate action titles fail', () => {
    const pl = payload();
    const p = pack();
    const reg = buildDossierRegistry(pl, p);
    const a = { ...(reg.actions[0] ?? { id: 'A-x', title: 'Do x', dependsOn: [], findingIds: [] } as never) } as never as typeof reg.actions[number];
    reg.actions.push({ ...a, id: 'A-a' }, { ...a, id: 'A-b' });
    expect(validateReport(buildLedger(pl, p), reg, `<p>${REPORT_DAY}</p>`, [], p).issues.map((i) => i.rule)).toContain('actions');
  });

  it('namesakes the search returned are excluded from mentions and listings, and disclosed', () => {
    const fp = withoutNamesakes({ checkedAt: '', profiles: [], mentionSearch: 'openai',
      mentions: [{ url: 'https://crunchbase.com/organization/omnyra', title: 'Omnyra - Crunchbase', type: 'directory', check: 'unconfirmed' },
        { url: 'https://news.test/acme-launch', title: 'Acme launches', type: 'press', check: 'unconfirmed' }],
      platforms: [{ platform: 'Trustpilot', state: 'claimed_unconfirmed', url: 'https://trustpilot.com/review/omnyra.ai' }] } as never, 'Acme');
    expect(fp.mentions.map((m) => m.url)).toEqual(['https://news.test/acme-launch']);
    expect(fp.platforms[0].state).toBe('not_found_in_search');
    expect(fp.namesakes).toHaveLength(2);
  });

  it('AI denominator: an answer with no checkable source is never counted as grounded', () => {
    const p = pack();
    delete p.generative[1].citedDomains;
    // A stored answer without any source: the validator rejects counting it…
    expect(rules(`<p>${REPORT_DAY}</p>`, p)).toContain('grounding');
    // …and the pack reader re-classifies it, so the ledger counts only sourced answers.
    const parsed = parseResearchPack(p, 'acme.test')!;
    expect(parsed.generative.find((g) => g.id === 'E-GEN-02')?.status).toBe('insufficient_evidence');
    const l = buildLedger(payload(), parsed);
    expect(l.aiTotals).toMatchObject({ groundedAnswers: 1, buyerAnswers: 1, buyerNamed: 0 });
    expect(rules(`<p>${REPORT_DAY}</p>`, parsed)).toEqual([]);
  });

  it('buyer-search counts exclude brand-name searches and equal the ledger', () => {
    const s = (id: string, query: string, ownPosition: number | null) => ({ ...rec({ id }), kind: 'search', query, ownPosition, intent: 'category', engine: 'google' });
    const p = pack({ search: [s('E-SRC-01', 'Acme alternatives', null), s('E-SRC-02', 'Acme', 1), s('E-SRC-03', 'best tools for x', null)] });
    expect(rules(`<p>${REPORT_DAY}</p><p>Found for 1 of 3 buyer searches.</p>`, p)).toContain('numbers');
    expect(rules(`<p>${REPORT_DAY}</p><p>Found for 0 of 1 buyer searches.</p>`, p)).toEqual([]);
  });

  it('dates: the summary states evidence dates, and no evidence is dated after the report', () => {
    expect(rules('<p>No dates here.</p>')).toContain('dates');
    const pl = payload();
    pl.report1.evidence_acquisition.crawl.lastCrawledAt = '2026-11-30T00:00:00Z';
    expect(rules(`<p>${REPORT_DAY}</p>`, pack(), pl)).toContain('dates');
  });

  it('unsupported claims: "not found in search" needs buyer searches, not generic category queries', () => {
    const pl = payload();
    pl.report1.search_visibility = { queriesRun: 4, queriesRanked: 0, observations: [{ query: 'SaaS Software alternatives' }] };
    expect(rules(`<section id="summary-now"><p>${REPORT_DAY}</p><p>Buyers do not find it yet, in search or in AI answers.</p></section>`, pack(), pl)).toContain('unsupported');
  });
});

describe('dossier v2 evidence models', () => {
  it('one AI vocabulary for tools and for single answers', () => {
    expect(aiStateOf('measured')).toBe('measured_grounded');
    expect(aiStateOf('partial')).toBe('measured_grounded');
    expect(aiStateOf('ungrounded')).toBe('answered_not_grounded');
    expect(aiStateOf('request_failed')).toBe('source_failed');
    expect(aiStateOf('quota_restricted')).toBe('source_failed');
    expect(aiStateOf('missing_credential')).toBe('not_configured');
    expect(aiStateOf('not_searched')).toBe('not_tested');
    expect(aiStateOf('no_adapter')).toBe('not_tested');
    expect(aiStateOf('restricted')).toBe('inaccessible');
    expect(aiCellState({ status: 'not_measured', surface: 'Meta AI' })).toBe('not_tested');
    expect(aiCellState({ status: 'not_measured', surface: 'Perplexity' })).toBe('not_configured');
    expect(aiCellState({ status: 'failed_source' })).toBe('source_failed');
    const l = buildLedger(payload(), pack());
    expect(l.aiTotals).toMatchObject({ attemptedCalls: 3, groundedAnswers: 2, buyerAnswers: 2, buyerNamed: 0 });
    expect(l.ai.find((a) => a.label === 'Perplexity')?.state).toBe('not_configured');
    expect(l.access.find((a) => a.capability === 'Perplexity')?.outcome).not.toMatch(/^0 of/);
  });

  it('footprint families are kept apart, including the corporate registry', () => {
    const l = buildLedger(payload(), pack());
    expect(l.families.map((f) => f.key)).toEqual(['inbound_links', 'profiles_to_site', 'site_to_profiles', 'editorial', 'partner_customer', 'directories', 'reviews', 'registry', 'entity']);
    const reg = l.families.find((f) => f.key === 'registry')!;
    expect(reg).toMatchObject({ label: 'Corporate registry (MCA, India)', attempted: false, state: 'not_attempted' });
    expect(l.access.find((a) => a.family === 'registry')?.reason).toBe('no_adapter');
  });

  it('classifies each stored crawl row by attempt outcome', () => {
    expect(classifyCrawlRow({ http_status: null, last_crawled_at: null })).toBe('not_fetched');
    expect(classifyCrawlRow({ http_status: 0, last_crawled_at: 'x' })).toBe('no_response');
    expect(classifyCrawlRow({ http_status: 404, last_crawled_at: 'x' })).toBe('client_error');
    expect(classifyCrawlRow({ http_status: 503, last_crawled_at: 'x' })).toBe('server_error');
    expect(classifyCrawlRow({ http_status: 200, last_crawled_at: 'x' })).toBe('read');
  });

  it('classifies an address by purpose before depth is judged', () => {
    expect(urlPurpose('/')).toBe('Home');
    expect(urlPurpose('/privacy')).toBe('Legal');
    expect(urlPurpose('/create-account')).toBe('Account and app screens');
    expect(urlPurpose('/reports/view/0b3b77c9-fe10-4f08-a78a-8d2f447799dd')).toBe('Account and app screens');
    expect(urlPurpose('/pricing')).toBe('Pricing');
    expect(urlPurpose('/blog/a-post')).toBe('Articles');
    expect(urlPurpose('/whatever', 'feature')).toBe('Product and features');
  });
});

describe('offering provenance (declared vs shown on the website)', () => {
  const site = [
    { url: 'https://acme.test/features', text: 'Systems: 08 Collaborative planning 09 Workflow management 10 Guided campaign execution. AI-era marketing for teams.' },
    { url: 'https://acme.test/', text: 'Acme measures digital authority and connects campaigns. Lead scoring is coming soon.' },
  ];
  it('verifies a claim only when the site states every key word in one short passage', () => {
    expect(judgeClaim('Campaign planning and execution', site).state).toBe('website_verified');
    expect(judgeClaim('AI-Driven Digital Marketing System', site).state).toBe('company_declared');
    expect(findPassage('Collaborative planning', site)).toMatchObject({ exact: true, url: 'https://acme.test/features' });
  });
  it('marks a claim the site calls not yet available as contradictory, and says unknown without pages', () => {
    expect(judgeClaim('Lead scoring', site).state).toBe('contradictory');
    expect(judgeClaim('Lead scoring', []).state).toBe('unknown');
  });
  it('a claim on a confirmed third-party page as well is independently corroborated', () => {
    expect(judgeClaim('Campaign planning and execution', site, [{ url: 'https://news.test/a', text: 'Its guided campaign execution and collaborative planning impressed us.' }]).state).toBe('independently_corroborated');
  });
  it('reads published pricing and free plans verbatim, and the site’s own JSON-LD text', () => {
    const p = publishedPricing([{ url: 'https://acme.test/pricing', purpose: 'pricing', text: 'Free Try it $0 / one-time. Starter For creators $39 $100 / month 300 credits.' }]);
    expect(p.pricing?.excerpt).toContain('$39 $100 / month');
    expect(p.freePlan?.excerpt).toContain('$0');
    expect(pageText('<script type="application/ld+json">{"@type":"FAQPage","name":"How much?","text":"Plans start at $39."}</script><p>Hi</p>')).toContain('Plans start at $39.');
    expect(purposeOf('/pricing')).toBe('pricing');
    expect(purposeOf('/blog')).toBeNull();
  });
});
