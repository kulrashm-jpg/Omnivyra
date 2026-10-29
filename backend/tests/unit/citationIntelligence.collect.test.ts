/**
 * Public-research integration: records keep per-source citations, the pack carries
 * citationIntelligence, every existing field keeps its value (ai_cited_sources is derived exactly as
 * before, so it is not more permissive), stored packs without the new fields parse as before, and
 * nothing outside the research pack imports the citation modules (scores unchanged).
 * Every network call is mocked.
 */
import * as fs from 'fs';
import * as path from 'path';
import { collectPublicResearch } from '../../services/intelligence/publicResearch/collect';
import { isBrandQuestion, parseResearchPack, type ResearchPack } from '../../services/intelligence/dossierV2/research';

jest.setTimeout(120_000);

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: async (url: string, init?: RequestInit) => {
    if (/^https?:\/\/(169\.254\.|127\.|10\.|localhost)/.test(url)) throw new Error('SSRF blocked');
    return (global.fetch as typeof fetch)(url, init);
  },
  readCapped: async (res: Response) => Buffer.from(await res.text()),
}));
jest.mock('../../services/providerCredentialResolver', () => ({ resolveProviderCredential: async () => ({ value: null }) }));

const KEYS = ['OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'SERPAPI_KEY', 'SERP_API_KEY', 'SERPAPI_API_KEY', 'PUBLIC_RESEARCH_SURFACES', 'REPORT_PUBLIC_RESEARCH'];
const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { global.fetch = realFetch; for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const QUESTIONS = ['best campaign planning tools for agencies', 'top campaign planners compared', 'how to plan campaigns faster', 'what is campaign planning software', 'free campaign planning tool', 'campaign planner vs spreadsheet'];

function mock() {
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    let status = 200; let json: unknown = {}; let text: string | undefined; let type = 'application/json';
    if (url.endsWith('/robots.txt') || url.endsWith('/llms.txt')) { status = 404; text = 'nf'; type = 'text/html'; }
    else if (url.endsWith('/sitemap.xml')) { text = '<urlset><url><loc>https://acme.test/</loc></url></urlset>'; type = 'application/xml'; }
    else if (url === 'https://acme.test/') { text = '<html></html>'; type = 'text/html'; }
    else if (url.includes('api.perplexity.ai')) {
      json = { choices: [{ message: { content: 'Rival and Acme are listed.' } }], citations: ['https://www.g2.com/categories/campaign-planning'],
        search_results: [{ url: 'https://www.g2.com/categories/campaign-planning', title: 'Campaign planning' }, { url: 'https://searched-only.test/p', title: 'Searched' }] };
    } else if (url.includes('chat/completions')) {
      const prompt = String(body?.messages?.[0]?.content ?? '');
      json = prompt.includes('Write exactly 6')
        ? { choices: [{ message: { content: JSON.stringify({ questions: QUESTIONS.map((query, i) => ({ intent: ['commercial', 'commercial', 'problem', 'category', 'use_case', 'comparison'][i], query })) }) } }] }
        : { choices: [{ message: { content: JSON.stringify({ readings: [] }) } }] };
    } else if (url.includes('api.openai.com/v1/responses')) {
      json = String(body?.input ?? '').includes('market analyst')
        ? { output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }
        : { output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'Rival is popular. Acme is a campaign tool.',
          annotations: ['https://rival.test/', 'https://acme.test/', 'https://www.g2.com/compare/rival-vs-acme'].map((u) => ({ type: 'url_citation', url: u, title: 'T' })) }] }] };
    } else { status = 404; text = ''; }
    return { ok: status < 400, status, headers: { get: () => type }, json: async () => json, text: async () => text ?? JSON.stringify(json) } as unknown as Response;
  }) as unknown as typeof fetch;
}

const brief = { brand: 'Acme', domain: 'acme.test', siteText: 'Acme helps teams plan campaigns.', category: 'campaign planning software', offering: 'Campaign planning', buyers: 'marketing teams', market: 'India' };

/** The ai_cited_sources derivation exactly as it was on main (collect.ts:221-231 at acde8b7a). */
function legacyCitedSources(pack: ResearchPack): Record<string, string> {
  const buyer = pack.generative.filter((g) => g.status === 'observed' && !isBrandQuestion(g, pack.subject.brand));
  const dom = new Map<string, number>();
  for (const g of buyer) for (const d of g.citedDomains ?? []) dom.set(d, (dom.get(d) ?? 0) + 1);
  return Object.fromEntries([...dom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, n]) => [d, `${n} answers`]));
}

describe('collected pack with citation intelligence', () => {
  let pack: ResearchPack;
  beforeAll(async () => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, { OPENAI_API_KEY: 'k', PERPLEXITY_API_KEY: 'k' });
    mock();
    pack = await collectPublicResearch({ ...brief, competitors: [{ name: 'Rival', domain: 'rival.test' }] });
  });

  it('keeps every legacy generative field and adds citations only to grounded answers', () => {
    const obs = pack.generative.filter((g) => g.status === 'observed');
    // 6 buyer + 2 brand-name questions, each answered by both configured tools.
    expect(obs.length).toBe(16);
    expect(obs.filter((g) => !isBrandQuestion(g, 'Acme')).length).toBe(12);
    for (const g of obs) {
      expect(g.citations?.length).toBeGreaterThan(0);
      expect(g.citations!.every((c) => c.observation_id === g.id)).toBe(true);
      expect(g.sourceUrl).toBeTruthy();
    }
    const px = obs.find((g) => g.kind === 'perplexity')!;
    // Legacy citedDomains keeps its merged value (includes the searched-only host); citations separate it.
    expect(px.citedDomains).toEqual(['g2.com', 'searched-only.test']);
    expect(px.sourceUrl).toBe('https://www.g2.com/categories/campaign-planning');
    expect(px.citations!.map((c) => [c.host, c.citation_role])).toEqual([['g2.com', 'cited'], ['searched-only.test', 'retrieved']]);
    for (const g of pack.generative.filter((x) => x.status !== 'observed')) expect(g.citations).toBeUndefined();
  });

  it('ai_cited_sources and its action are derived exactly as before (not more permissive)', () => {
    const rec = pack.benchmark.find((b) => b.kind === 'ai_cited_sources')!;
    expect(Object.fromEntries(Object.entries(rec.values!).map(([d, v]) => [d, v.value]))).toEqual(legacyCitedSources(pack));
    expect(rec.recommends?.id).toBe('A-ai-cited-sources');
    // Every opportunity domain is already among the legacy cited hosts: the new output never widens it.
    const legacy = Object.keys(rec.values!);
    for (const o of pack.citationIntelligence!.opportunities.opportunities) expect(legacy).toContain(o.target.registrable_domain);
  });

  it('builds domains and opportunities from cited sources only', () => {
    const ci = pack.citationIntelligence!;
    const g2 = ci.domains.find((d) => d.registrable_domain === 'g2.com')!;
    expect(g2).toMatchObject({ category: 'review_directory', citation_count: 12, retrieved_only_count: 0, distinct_questions: 6, distinct_providers: ['chatgpt_search', 'perplexity'] });
    expect(ci.domains.find((d) => d.registrable_domain === 'searched-only.test')).toMatchObject({ citation_count: 0, retrieved_only_count: 6 });
    expect(ci.domains.find((d) => d.registrable_domain === 'acme.test')?.category).toBe('subject_owned');
    expect(ci.opportunities.opportunities.map((o) => o.target.registrable_domain)).toEqual(['g2.com']);
    const [o] = ci.opportunities.opportunities;
    expect(o).toMatchObject({ suggested_action: 'claim_or_complete_profile', verification_status: 'not_verified', confidence: 'medium' });
    expect(o.supporting_evidence_ids.filter((x) => x.startsWith('E-GEN-')).every((x) => pack.generative.some((g) => g.id === x))).toBe(true);
    expect(ci.opportunities.inputs).toMatchObject({ grounded_buyer_answers: 12, providers_observed: ['chatgpt_search', 'perplexity'], retrieved_only_excluded: 6 });
    expect(ci.opportunities.evidence_gap).toMatch(/Not observed: .*Claude/);
    // The subject was named in every citing answer (by the excerpt), with no other brand read.
    expect(g2.subject_named_in_citing_answers).toBe(12);
  });

  it('round-trips through parseResearchPack; a stored pack without the new fields parses exactly as before', () => {
    const parsed = parseResearchPack(JSON.parse(JSON.stringify(pack)), 'acme.test')!;
    expect(parsed.citationIntelligence?.opportunities.opportunities).toHaveLength(1);
    const legacy = JSON.parse(JSON.stringify(pack));
    delete legacy.citationIntelligence;
    for (const g of legacy.generative) delete g.citations;
    const old = parseResearchPack(legacy, 'acme.test')!;
    expect('citationIntelligence' in old).toBe(false);
    expect(old.generative.every((g) => g.citations === undefined)).toBe(true);
  });
});

describe('scores are unchanged', () => {
  it('only the research pack modules import the citation modules', () => {
    const root = path.resolve(__dirname, '../../..');
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '.git', 'tests', 'citations'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /from '[^']*\/citations\/(citationTypes|citationSources|sourceDomainClassifier|sourceDomainAggregate|publicationOpportunities)'/.test(fs.readFileSync(p, 'utf8'))) {
          importers.push(path.relative(root, p).replace(/\\/g, '/'));
        }
      }
    };
    for (const d of ['backend', 'pages', 'lib', 'components']) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.sort()).toEqual([
      'backend/services/intelligence/dossierV2/research.ts',
      'backend/services/intelligence/publicResearch/aiAnswers.ts',
      'backend/services/intelligence/publicResearch/collect.ts',
    ]);
  });
});
