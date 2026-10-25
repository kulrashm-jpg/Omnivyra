/**
 * Public research collected during report generation: every network call mocked.
 * Grounded answers only; missing keys are "not measured"; names and values must be traceable.
 */
import { askAiSurfaces, SURFACES } from '../../services/intelligence/publicResearch/aiAnswers';
import { readAnswers, buyerQuestions } from '../../services/intelligence/publicResearch/aiQuestions';
import { verify, keyTokens } from '../../services/intelligence/publicResearch/competitors';
import { collectPublicResearch, distinctCapabilities, researchInputFromNarrative } from '../../services/intelligence/publicResearch/collect';
import { parseResearchPack, summariseVisibility } from '../../services/intelligence/dossierV2/research';
import { renderDossierV2Html } from '../../services/intelligence/dossierV2/render';

// The SSRF-safe client resolves DNS and opens real sockets; here it delegates to the mocked fetch,
// and refuses private / metadata addresses the way the real client does.
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: async (url: string, init?: RequestInit) => {
    if (/^https?:\/\/(169\.254\.|127\.|10\.|localhost)/.test(url)) throw new Error('SSRF blocked');
    return (global.fetch as typeof fetch)(url, init);
  },
  readCapped: async (res: Response) => Buffer.from(await res.text()),
}));

// SerpAPI tools resolve their key like the report run (providerCredentialResolver); here only the
// environment fallback is modelled, so a test controls the key through process.env alone.
jest.mock('../../services/providerCredentialResolver', () => ({
  resolveProviderCredential: async () => ({ value: ['SERPAPI_API_KEY', 'SERP_API_KEY', 'SERPAPI_KEY'].map((n) => process.env[n]).find(Boolean) ?? null }),
}));

type Handler = (url: string, body: any) => { status?: number; json?: unknown; text?: string; type?: string };
const realFetch = global.fetch;
const KEYS = ['OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'SERPAPI_KEY', 'SERP_API_KEY', 'SERPAPI_API_KEY'];
const saved: Record<string, string | undefined> = {};

function mockFetch(handler: Handler) {
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const r = handler(url, body);
    const status = r.status ?? 200;
    return {
      ok: status < 400, status,
      headers: { get: () => r.type ?? (r.text !== undefined ? 'text/plain' : 'application/json') },
      json: async () => r.json ?? {},
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { global.fetch = realFetch; for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const brief = { brand: 'Acme', domain: 'acme.test', siteText: 'Acme helps teams plan campaigns.', category: 'campaign planning software', offering: 'Campaign planning', buyers: 'marketing teams', market: 'India' };
const responsesAnswer = (text: string, urls: string[], searched = true) => ({
  output: [...(searched ? [{ type: 'web_search_call' }] : []), { type: 'message', content: [{ type: 'output_text', text, annotations: urls.map((url) => ({ type: 'url_citation', url })) }] }],
});

describe('AI search answers', () => {
  it('records a tool without a key, and Meta AI, as not measured — never as an answer', async () => {
    mockFetch(() => ({ status: 500 }));
    const out = await askAiSurfaces(['best campaign tools?']);
    expect(out.find((a) => a.surface === 'perplexity')).toMatchObject({ status: 'not_measured' });
    expect(out.find((a) => a.surface === 'perplexity')?.reason).toContain('PERPLEXITY_API_KEY');
    expect(out.find((a) => a.surface === 'meta_ai')?.reason).toContain('no public API');
    expect(out.every((a) => a.status === 'not_measured')).toBe(true);
    expect(SURFACES.map((s) => s.id)).toEqual(expect.arrayContaining(['chatgpt_search', 'perplexity', 'claude_search', 'gemini_search', 'google_ai_mode', 'bing_copilot', 'meta_ai']));
  });

  it('does not count an answer the tool gave without searching the web', async () => {
    process.env.OPENAI_API_KEY = 'k';
    mockFetch(() => ({ json: responsesAnswer('HubSpot is great.', [], false) }));
    const [a] = (await askAiSurfaces(['q'])).filter((x) => x.surface === 'chatgpt_search');
    expect(a.status).toBe('failed_source');
    expect(a.reason).toContain('without a web search');
  });

  it('does not count a searched answer that returned no checkable source', async () => {
    process.env.OPENAI_API_KEY = 'k';
    mockFetch(() => ({ json: responsesAnswer('HubSpot is great.', [], true) }));
    const [a] = (await askAiSurfaces(['q'])).filter((x) => x.surface === 'chatgpt_search');
    expect(a.status).toBe('failed_source');
    expect(a.reason).toContain('checkable source');
  });

  it('reads grounded answers and their sources from each API shape', async () => {
    Object.assign(process.env, { OPENAI_API_KEY: 'k', PERPLEXITY_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'k', SERPAPI_KEY: 'k' });
    mockFetch((url) => {
      if (url.includes('openai.com')) return { json: responsesAnswer('Try Rival.', ['https://rival.io/']) };
      if (url.includes('perplexity.ai')) return { json: { choices: [{ message: { content: 'Rival and Other.' } }], citations: ['https://g2.com/x'] } };
      if (url.includes('anthropic.com')) return { json: { content: [{ type: 'server_tool_use' }, { type: 'web_search_tool_result', content: [{ url: 'https://b.com/' }] }, { type: 'text', text: 'Rival leads.', citations: [{ url: 'https://b.com/' }] }] } };
      if (url.includes('googleapis.com')) return { json: { candidates: [{ content: { parts: [{ text: 'Rival.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://redirect/1', title: 'rival.io' } }] } }] } };
      if (url.includes('google_ai_mode')) return { json: { reconstructed_markdown: 'Rival', references: [{ link: 'https://c.com/' }] } };
      if (url.includes('bing_copilot')) return { json: { text_blocks: [{ snippet: 'Rival' }], references: [{ link: 'https://d.com/' }] } };
      return { status: 404 };
    });
    const out = await askAiSurfaces(['q']);
    for (const id of ['chatgpt_search', 'perplexity', 'claude_search', 'gemini_search', 'google_ai_mode', 'bing_copilot']) {
      const a = out.find((x) => x.surface === id)!;
      expect(a.status).toBe('observed');
      expect(a.sources.length).toBeGreaterThan(0);
    }
    expect(out.find((x) => x.surface === 'gemini_search')?.sources).toEqual(['https://rival.io']);
  });
});

describe('questions and reading', () => {
  it('rejects model questions that name the brand, and falls back to templates when too few remain', async () => {
    process.env.OPENAI_API_KEY = 'k';
    mockFetch(() => ({ json: { choices: [{ message: { content: JSON.stringify({ questions: [{ intent: 'commercial', query: 'Is Acme the best campaign tool?' }, { intent: 'category', query: 'What is campaign planning software?' }] }) } }] } }));
    const { questions, method } = await buyerQuestions(brief);
    expect(method).toContain('Template');
    expect(questions).toHaveLength(8);
    expect(questions.slice(0, 6).some((q) => /acme/i.test(q.query))).toBe(false);
    expect(questions.slice(6).map((q) => q.query)).toEqual(['What is Acme?', 'Acme alternatives and competitors']);
  });

  it('keeps only brand names that appear verbatim in the answer', async () => {
    process.env.OPENAI_API_KEY = 'k';
    mockFetch(() => ({ json: { choices: [{ message: { content: JSON.stringify({ readings: [{ id: 'a', brands: ['Rival', 'Invented Co'], accuracy: null }, { id: 'b', brands: [], accuracy: 'misidentified', note: 'a cartoon' }] }) } }] } }));
    const r = await readAnswers(brief, [{ id: 'a', branded: false, text: 'Use Rival for this.' }, { id: 'b', branded: true, text: 'Acme is a cartoon company.' }]);
    expect(r.get('a')?.brands).toEqual(['Rival']);
    expect(r.get('b')?.accuracy).toBe('misidentified');
  });
});

describe('competitor values', () => {
  it('confirms a value only when its source page shows it', async () => {
    mockFetch((url) => (url.includes('good') ? { text: '<p>Trusted by 1,000+ teams</p>', type: 'text/html' } : { text: '<p>nothing here</p>', type: 'text/html' }));
    expect(keyTokens('1,000+ teams')).toEqual(['1000']);
    expect(await verify('1,000+ teams', 'https://good.test/a')).toBe('confirmed');
    expect(await verify('1,000+ teams', 'https://bad.test/a')).toBe('unconfirmed');
    expect(await verify('1,000+ teams', 'not a url')).toBe('unconfirmed');
  });

  it('never fetches an internal address a model returns as a source', async () => {
    const seen: string[] = [];
    mockFetch((url) => { seen.push(url); return { text: '<p>1,000+ teams</p>', type: 'text/html' }; });
    expect(await verify('1,000+ teams', 'http://169.254.169.254/latest/meta-data')).toBe('unconfirmed');
    expect(seen).toEqual([]);
  });

  it('never confirms a value from a page about a different company, and takes self-descriptions only from the company site', async () => {
    mockFetch((url) => (url.includes('namesake')
      ? { text: '<p>Omnira: AI video studio trusted by 1,000+ teams</p>', type: 'text/html' }
      : { text: '<p>Acme is trusted by 1,000+ teams</p>', type: 'text/html' }));
    const acme = { name: 'Acme', domain: 'acme.test' };
    expect(await verify('1,000+ teams', 'https://namesake.test/', { ...acme, field: 'employees' })).toBe('unconfirmed');
    expect(await verify('1,000+ teams', 'https://directory.test/acme', { ...acme, field: 'employees' })).toBe('confirmed');
    expect(await verify('1,000+ teams', 'https://directory.test/acme', { ...acme, field: 'customers' })).toBe('unconfirmed');
    expect(await verify('1,000+ teams', 'https://www.acme.test/about', { ...acme, field: 'customers' })).toBe('confirmed');
  });
});

describe('analysis model fallback', () => {
  const claudeReply = (obj: unknown) => ({ json: { content: [{ type: 'text', text: '```json\n' + JSON.stringify(obj) + '\n```' }] } });

  it('uses Claude when OpenAI is out of credit, and when OpenAI is not configured', async () => {
    const { jsonCompletion } = await import('../../services/intelligence/publicResearch/llm');
    process.env.OPENAI_API_KEY = 'k';
    process.env.ANTHROPIC_API_KEY = 'k';
    mockFetch((url) => (url.includes('openai.com') ? { status: 429, json: { error: { message: 'no credits' } } } : claudeReply({ ok: 1 })));
    expect(await jsonCompletion('t', 'p')).toEqual({ json: { ok: 1 }, provider: 'anthropic' });
    delete process.env.OPENAI_API_KEY;
    expect(await jsonCompletion('t', 'p')).toEqual({ json: { ok: 1 }, provider: 'anthropic' });
  });

  it('returns nothing rather than inventing when both providers fail', async () => {
    const { jsonCompletion } = await import('../../services/intelligence/publicResearch/llm');
    process.env.OPENAI_API_KEY = 'k';
    process.env.ANTHROPIC_API_KEY = 'k';
    mockFetch(() => ({ status: 500 }));
    expect(await jsonCompletion('t', 'p')).toBeNull();
  });

  it('gives Claude web search when it stands in for the research analyst', async () => {
    const { webJsonCompletion } = await import('../../services/intelligence/publicResearch/llm');
    process.env.ANTHROPIC_API_KEY = 'k';
    let claudeBody: any = null;
    mockFetch((url, body) => { if (url.includes('anthropic.com')) { claudeBody = body; return claudeReply({ competitors: [] }); } return { status: 404 }; });
    expect((await webJsonCompletion('t', 'p', { name: 's', schema: {} }))?.provider).toBe('anthropic');
    expect(claudeBody.tools[0].type).toBe('web_search_20250305');
  });
});

describe('competitor set in one call', () => {
  it('never lists the company itself, and keeps a declared competitor under its declared name and domain', async () => {
    process.env.OPENAI_API_KEY = 'k';
    const profile = (name: string, domain: string) => ({ name, domain, classification: 'direct', rationale: 'same buyer',
      fields: { offering: { value: 'Campaign planning for agencies', url: `https://${domain}/` } }, capabilities: [] });
    mockFetch((url) => {
      if (url.includes('api.openai.com/v1/responses')) {
        return { json: { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ competitors: [profile('Acme', 'acme.test'), profile('RIVAL Inc', 'www.rival.io'), profile('Other', 'other.io')] }) }] }] } };
      }
      return { text: '<p>Campaign planning for agencies</p>', type: 'text/html' };
    });
    const { discoverAndProfile } = await import('../../services/intelligence/publicResearch/competitors');
    const out = await discoverAndProfile({ brand: 'Acme', domain: 'acme.test', offering: 'x', capabilities: [], buyers: null, geography: null }, [{ name: 'Rival', domain: 'rival.io' }], 4);
    expect(out.map((p) => [p.name, p.domain])).toEqual([['Rival', 'rival.io'], ['Other', 'other.io']]);
    expect(out[0].fields.offering?.check).toBe('confirmed');
  });
});

describe('collected pack', () => {
  it('maps the resolved company context, including competitors given as domains', () => {
    const input = researchInputFromNarrative({ companyName: 'Acme', domain: 'acme.test', homepageHeadline: 'Plan campaigns', tagline: null, primaryOffering: 'Campaign planning', positioning: null,
      marketContext: null, marketFocus: 'agencies', productServices: ['Planning', 'Publishing'], geography: 'India', declaredCompetitors: ['rival.io', 'Other Co'] });
    expect(input?.competitors).toEqual([{ name: 'rival', domain: 'rival.io' }, { name: 'Other Co', domain: '' }]);
    expect(input?.capabilities).toEqual(['Planning', 'Publishing']);
    expect(distinctCapabilities(['Campaign management', 'Campaign management software', 'SEO audits', 'SEO audit tools', 'Content strategy'], 8))
      .toEqual(['Campaign management', 'SEO audits', 'Content strategy']);
  });

  it('produces a pack the report accepts, with unmeasured tools shown and nothing counted from them', async () => {
    process.env.OPENAI_API_KEY = 'k';
    mockFetch((url, body) => {
      if (url.endsWith('/robots.txt')) return { status: 404, text: 'nf', type: 'text/html' };
      if (url.endsWith('/llms.txt')) return { status: 404, text: 'nf', type: 'text/html' };
      if (url.endsWith('/sitemap.xml')) return { text: '<urlset><url><loc>https://acme.test/</loc></url></urlset>', type: 'application/xml' };
      if (url === 'https://acme.test/') return { text: '<a href="/pricing">p</a><script type="application/ld+json">{"@type":"FAQPage"}</script>', type: 'text/html' };
      if (url.includes('chat/completions')) {
        const prompt = String(body?.messages?.[0]?.content ?? '');
        if (prompt.includes('Write exactly 6')) return { json: { choices: [{ message: { content: JSON.stringify({ questions: ['best campaign planning tools for agencies', 'top campaign planners compared', 'how to plan campaigns faster', 'what is campaign planning software', 'free campaign planning tool', 'campaign planner vs spreadsheet'].map((query, i) => ({ intent: ['commercial', 'commercial', 'problem', 'category', 'use_case', 'comparison'][i], query })) }) } }] } };
        return { json: { choices: [{ message: { content: JSON.stringify({ readings: [] }) } }] } };
      }
      if (url.includes('api.openai.com/v1/responses')) {
        if (String(body?.input ?? '').includes('market analyst')) return { json: { output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] } };
        return { json: responsesAnswer('Rival is popular. Acme is a campaign tool.', ['https://rival.io/', 'https://acme.test/']) };
      }
      return { status: 404, text: '' };
    });
    const pack = await collectPublicResearch({ ...brief, competitors: [{ name: 'Rival', domain: 'rival.io' }], capabilities: ['Planning'] });
    const parsed = parseResearchPack(pack, 'acme.test');
    expect(parsed).not.toBeNull();
    const vis = summariseVisibility(parsed);
    expect(vis.generative?.buyerAnswers).toBe(6);
    expect(vis.generative?.notMeasuredSurfaces).toEqual(expect.arrayContaining(['Perplexity', 'Meta AI']));
    expect(parsed!.site.find((r) => /robots\.txt is missing/.test(r.claim))?.recommends?.id).toBe('A-site-crawl-basics');
    expect(parsed!.gaps.map((g) => g.claim)).toEqual(expect.arrayContaining(['Perplexity answers']));
    const ids = Object.values(parsed!).filter(Array.isArray).flat().map((r: any) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const html = renderDossierV2Html({ generated_at: '2026-10-24T00:00:00Z', pillars: [], report1: {} } as never, { brandName: 'Acme', domain: 'acme.test' }, pack);
    expect(html).toContain('What AI search tools say, question by question');
    expect(html).toContain('not measured');
  });
});

describe('external footprint', () => {
  it('merges one profile found in several places, detects sign-in walls, and confirms identity only from the page', async () => {
    const { checkProfiles } = await import('../../services/intelligence/publicResearch/footprint');
    mockFetch((url) => {
      if (url.includes('linkedin')) return { status: 999, text: 'authwall', type: 'text/html' };
      if (url.includes('youtube')) return { text: '<title>Acme</title><a href="https://acme.test">site</a>', type: 'text/html' };
      return { text: '<p>someone else</p>', type: 'text/html' };
    });
    const out = await checkProfiles('Acme', 'acme.test', {
      declared: ['https://www.linkedin.com/company/acme/', 'https://youtube.com/@acme', 'https://acme.test/blog'],
      homepage: ['https://linkedin.com/company/acme'], sameAs: ['https://x.com/other'],
    });
    expect(out).toHaveLength(3);
    const li = out.find((p) => p.platform === 'LinkedIn')!;
    expect(li).toMatchObject({ declared: true, onHomepage: true, state: 'inaccessible', outcome: 'login_wall' });
    expect(out.find((p) => p.platform === 'YouTube')?.state).toBe('identity_confirmed');
    expect(out.find((p) => p.platform === 'X')?.state).toBe('fetched');
  });

  it('keeps owned pages out of independent mentions and does not turn an unconfirmable listing into "not found"', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const { findIndependentMentions } = await import('../../services/intelligence/publicResearch/footprint');
    const reply = { mentions: [
      { url: 'https://acme.test/about', title: 'own', type: 'other' },
      { url: 'https://www.linkedin.com/company/acme', title: 'own profile', type: 'other' },
      { url: 'https://dir.test/acme', title: 'Acme listed', type: 'directory' },
    ], platforms: [{ platform: 'G2', found: true, url: 'https://g2.test/acme' }, { platform: 'Capterra', found: false, url: '' }] };
    mockFetch((url) => {
      if (url.includes('anthropic.com')) return { json: { content: [{ type: 'text', text: JSON.stringify(reply) }] } };
      if (url.includes('g2.test')) return { status: 403, text: 'blocked', type: 'text/html' };
      return { text: '<p>Acme is a widget company</p>', type: 'text/html' };
    });
    const r = await findIndependentMentions({ brand: 'Acme', domain: 'acme.test', offering: 'widgets' }, ['https://linkedin.com/company/acme']);
    expect(r.mentions.map((m) => m.url)).toEqual(['https://dir.test/acme']);
    expect(r.mentions[0].check).toBe('confirmed');
    expect(r.platforms.find((p) => p.platform === 'G2')?.state).toBe('claimed_unconfirmed');
    expect(r.platforms.find((p) => p.platform === 'Capterra')?.state).toBe('not_found_in_search');
  });
});

describe('evidence auditability', () => {
  it('does not count an AI Mode answer that returns no source links', async () => {
    process.env.SERPAPI_KEY = 'k';
    mockFetch(() => ({ json: { reconstructed_markdown: 'Try HubSpot.', references: [] } }));
    const [a] = (await askAiSurfaces(['best tools?'], { surfaces: SURFACES.filter((s) => s.id === 'google_ai_mode') }));
    expect(a.status).toBe('failed_source');
    expect(a.reason).toBe('The answer came back without checkable source links, so it is not counted.');
  });

  it('records the web-search queries the model actually ran, from either provider', async () => {
    const { webJsonCompletion } = await import('../../services/intelligence/publicResearch/llm');
    process.env.OPENAI_API_KEY = 'k';
    mockFetch(() => ({ json: { output: [{ type: 'web_search_call', action: { type: 'search', query: '"Acme" reviews' } }, { type: 'message', content: [{ type: 'output_text', text: '{"ok":1}' }] }] } }));
    expect((await webJsonCompletion('t', 'p', { name: 's', schema: {} }))?.searches).toEqual(['"Acme" reviews']);
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'k';
    mockFetch(() => ({ json: { content: [{ type: 'server_tool_use', name: 'web_search', input: { query: 'Acme G2' } }, { type: 'text', text: '{"ok":1}' }] } }));
    expect((await webJsonCompletion('t', 'p', { name: 's', schema: {} }))?.searches).toEqual(['Acme G2']);
  });
});
