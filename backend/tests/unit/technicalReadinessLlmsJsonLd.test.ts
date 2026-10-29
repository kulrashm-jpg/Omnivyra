/**
 * Technical readiness — llms.txt probe/parse and JSON-LD validation. No network: the SSRF-safe
 * fetcher is mocked and routed by URL.
 */
const safeFetch = jest.fn();
const readCapped = jest.fn();
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (url: string, init?: unknown, opts?: unknown) => safeFetch(url, init, opts),
  readCapped: (response: unknown) => readCapped(response),
}));

import { LLMS_TXT_LIMITATION, parseLlmsTxt } from '../../services/technicalReadiness/llmsTxt';
import { LLMS_FULL_TXT_MAX_BYTES, LLMS_TXT_MAX_BYTES, probeLlmsFiles } from '../../services/technicalReadiness/siteFilesProbe';
import { JSONLD_LIMITATION, validateJsonLdBlocks } from '../../services/technicalReadiness/jsonLdValidation';

type Route = { status?: number; body?: string; type?: string; throws?: string; readThrows?: string };
const route = (routes: Record<string, Route>) => {
  safeFetch.mockImplementation(async (url: string) => {
    const r = routes[url];
    if (!r) return { status: 404, headers: { get: () => null } };
    if (r.throws) throw new Error(r.throws);
    return { status: r.status ?? 200, headers: { get: (k: string) => (k === 'content-type' ? r.type ?? 'text/plain' : null) }, __r: r };
  });
  readCapped.mockImplementation(async (res: { __r?: Route }) => {
    if (res.__r?.readThrows) throw new Error(res.__r.readThrows);
    return Buffer.from(res.__r?.body ?? '');
  });
};

const UA = 'TestBot/1.0';
beforeEach(() => { safeFetch.mockReset(); readCapped.mockReset(); });

const WELL_FORMED = '# Site Test\n\n> A short summary.\n\n## Docs\n- [Guide](https://site.test/guide): how to\n- [API](https://site.test/api)\n';

describe('llms.txt parse', () => {
  it('L-2 well-formed: H1, blockquote, sections, links', () => {
    expect(parseLlmsTxt(WELL_FORMED)).toEqual({ has_h1_title: true, title: 'Site Test', has_summary_blockquote: true, h2_sections: 1, link_count: 2, looks_like_html: false });
  });
  it('an HTML document is not an llms.txt', () => {
    expect(parseLlmsTxt('<!doctype html><html><h1># x</h1></html>')).toMatchObject({ has_h1_title: false, link_count: 0, looks_like_html: true });
  });
});

describe('llms.txt / llms-full.txt probe', () => {
  it('L-1 404 ⇒ absent (optional), with the fixed limitation available', async () => {
    route({});
    const { llms, llms_full } = await probeLlmsFiles('https://site.test', 5000, UA);
    expect(llms.state).toBe('absent');
    expect(llms.status).toBe(404);
    expect(llms_full.state).toBe('absent');
    expect(readCapped).not.toHaveBeenCalled();
    expect(LLMS_TXT_LIMITATION).toMatch(/not evidence that any AI system reads it/);
  });

  it('L-2 well-formed file ⇒ present_well_formed with excerpt and retrieval time', async () => {
    route({ 'https://site.test/llms.txt': { body: WELL_FORMED } });
    const { llms } = await probeLlmsFiles('https://site.test', 5000, UA);
    expect(llms.state).toBe('present_well_formed');
    expect(llms.excerpt).toBe('# Site Test | > A short summary. | ## Docs');
    expect(Date.parse(llms.fetched_at)).not.toBeNaN();
  });

  it('L-3 HTML at 200 ⇒ present_malformed', async () => {
    route({ 'https://site.test/llms.txt': { body: '<html><body>app</body></html>', type: 'text/html' } });
    expect((await probeLlmsFiles('https://site.test', 5000, UA)).llms.state).toBe('present_malformed');
  });

  it('L-4 timeout ⇒ indeterminate; unreachable ⇒ unavailable; 503 ⇒ indeterminate', async () => {
    route({ 'https://site.test/llms.txt': { throws: 'UND_ERR_HEADERS_TIMEOUT' }, 'https://site.test/llms-full.txt': { throws: 'SSRF blocked (dns_resolution_failed) for site.test' } });
    let r = await probeLlmsFiles('https://site.test', 5000, UA);
    expect(r.llms.state).toBe('indeterminate');
    expect(r.llms_full.state).toBe('unavailable');
    route({ 'https://site.test/llms.txt': { status: 503 } });
    r = await probeLlmsFiles('https://site.test', 5000, UA);
    expect(r.llms.state).toBe('indeterminate');
  });

  it('L-5 a 2xx llms-full.txt above the cap is present, size above cap — not an error', async () => {
    route({ 'https://site.test/llms-full.txt': { body: 'x', readThrows: 'SSRF blocked (stream_exceeded_max_bytes) for https://site.test/llms-full.txt' } });
    const { llms_full } = await probeLlmsFiles('https://site.test', 5000, UA);
    expect(llms_full.state).toBe('present_exceeds_cap');
    expect(llms_full.size_exceeds_cap).toBe(true);
  });

  it('L-6 exactly two requests, SSRF-safe, capped, same timeout; no link inside the file is followed', async () => {
    route({ 'https://site.test/llms.txt': { body: WELL_FORMED } });
    await probeLlmsFiles('https://site.test', 4321, UA);
    expect(safeFetch).toHaveBeenCalledTimes(2);
    const calls = safeFetch.mock.calls.map((c) => [c[0], c[2]]);
    expect(calls).toEqual(expect.arrayContaining([
      ['https://site.test/llms.txt', { timeoutMs: 4321, maxBytes: LLMS_TXT_MAX_BYTES }],
      ['https://site.test/llms-full.txt', { timeoutMs: 4321, maxBytes: LLMS_FULL_TXT_MAX_BYTES }],
    ]));
  });
});

describe('JSON-LD validation', () => {
  const org = (extra: object = {}) => JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Site Test', url: 'https://site.test', ...extra });

  it('J-1 an invalid block is reported with its index; valid blocks are still evaluated', () => {
    const v = validateJsonLdBlocks([org(), '{ "@type": "WebSite", name: broken }']);
    expect(v.state).toBe('invalid_syntax');
    expect(v.valid_blocks).toBe(1);
    expect(v.first_error?.block_index).toBe(1);
    expect(v.org_nodes[0].name).toBe('Site Test');
  });

  it('J-2 walks @graph and array @type; strips HTML comment / CDATA wrappers', () => {
    const v = validateJsonLdBlocks([`<!--${JSON.stringify({ '@graph': [{ '@type': ['Thing', 'WebSite'], name: 'S', url: 'https://site.test' }] })}-->`]);
    expect(v.state).toBe('valid_syntax_complete');
    expect(v.nodes[0]).toMatchObject({ type: 'WebSite', family: 'WebSite', missing_required: [] });
  });

  it('J-3 Organization without url ⇒ missing required', () => {
    const v = validateJsonLdBlocks([JSON.stringify({ '@type': 'Organization', name: 'S' })]);
    expect(v.state).toBe('valid_syntax_missing_required');
    expect(v.nodes[0].missing_required).toEqual(['url']);
  });

  it('J-4 FAQPage question without acceptedAnswer.text ⇒ missing required', () => {
    const v = validateJsonLdBlocks([JSON.stringify({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer' } }] })]);
    expect(v.nodes[0].missing_required).toEqual(['mainEntity[0].acceptedAnswer.text']);
  });

  it('J-5 BreadcrumbList: the last crumb may omit item', () => {
    const v = validateJsonLdBlocks([JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://site.test/' },
      { '@type': 'ListItem', position: 2, name: 'Here' },
    ] })]);
    expect(v.state).toBe('valid_syntax_complete');
  });

  it('J-6 Product without offers/review/aggregateRating ⇒ missing required', () => {
    const v = validateJsonLdBlocks([JSON.stringify({ '@type': 'Product', name: 'P' })]);
    expect(v.nodes[0].missing_required).toEqual(['offers|review|aggregateRating']);
  });

  it('J-7 only unsupported types ⇒ unsupported_types_only; none ⇒ no_structured_data', () => {
    expect(validateJsonLdBlocks([JSON.stringify({ '@type': 'Event', name: 'E' })]).state).toBe('unsupported_types_only');
    expect(validateJsonLdBlocks([]).state).toBe('no_structured_data');
  });

  it('property-nested entities (a publisher Organization) are not validated as the subject', () => {
    const v = validateJsonLdBlocks([JSON.stringify({ '@type': 'Article', headline: 'H', publisher: { '@type': 'Organization', name: 'Other' } })]);
    expect(v.nodes.map((n) => n.family)).toEqual(['Article']);
    expect(v.org_nodes).toEqual([]);
  });

  it('LocalBusiness subtypes resolve to the LocalBusiness family', () => {
    const v = validateJsonLdBlocks([JSON.stringify({ '@type': 'Dentist', name: 'D' })]);
    expect(v.nodes[0]).toMatchObject({ family: 'LocalBusiness', missing_required: ['address'] });
    expect(v.org_nodes[0].family).toBe('LocalBusiness');
  });

  it('J-8 the limitation states validity is not rich-result eligibility', () => {
    expect(JSONLD_LIMITATION).toMatch(/necessary but not sufficient/);
  });
});
