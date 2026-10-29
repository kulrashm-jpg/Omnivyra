/**
 * toCitationSources: URL normalization, rejection reasons, per-answer dedup, structural input
 * (no producer types), and no fabrication.
 */
import { MAX_SOURCES_PER_ANSWER, observationIdFor, toCitationSources } from '../../services/intelligence/citations/citationSources';
import type { CitationObservationInput } from '../../services/intelligence/citations/citationTypes';

const obs = (over: Partial<CitationObservationInput>): CitationObservationInput => ({
  provider: 'chatgpt_search', query: 'best planners', query_class: 'commercial', grounded_sources: [], observation_id: 'E-GEN-01', ...over,
});

describe('normalization and rejection', () => {
  it('rejects malformed, non-http, private and search-engine URLs with a reason and no normalized URL', () => {
    const cs = toCitationSources(obs({ grounded_sources: ['not a url', 'javascript:alert(1)', 'http://127.0.0.1/x', 'https://www.google.com/search?q=x', 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A'] }));
    expect(cs.map((c) => c.provenance.rejected_reason)).toEqual(['malformed', 'malformed', 'private_host', 'search_engine_host', 'search_engine_host']);
    expect(cs.every((c) => c.normalized_url === null)).toBe(true);
  });

  it('dedupes utm, hash, www and trailing-slash variants of one page within an answer', () => {
    const cs = toCitationSources(obs({ grounded_sources: ['https://www.reviews.test/a/?utm_source=x', 'https://reviews.test/a#top', 'https://reviews.test/a/'] }));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ normalized_url: 'https://reviews.test/a', host: 'reviews.test', registrable_domain: 'reviews.test', url: 'https://www.reviews.test/a/?utm_source=x', citation_role: 'unknown' });
  });

  it('keeps a page cited and retrieved in one answer once, as cited', () => {
    const cs = toCitationSources(obs({ grounded_sources: [], citations: [
      { url: 'https://reviews.test/a', title: null, role: 'retrieved' },
      { url: 'https://reviews.test/a?utm_medium=y', title: 'A', role: 'cited' },
    ] }));
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ citation_role: 'cited', title: 'A' });
  });

  it('uses the shared registrable-domain helper (subdomains merge, multi-label suffixes kept)', () => {
    const cs = toCitationSources(obs({ grounded_sources: ['https://en.wikipedia.org/wiki/X', 'https://news.example.co.uk/p'] }));
    expect(cs.map((c) => c.registrable_domain)).toEqual(['wikipedia.org', 'example.co.uk']);
  });

  it('keeps social and forum hosts (never-fetch hosts) as real citations', () => {
    const cs = toCitationSources(obs({ grounded_sources: ['https://www.reddit.com/r/x/comments/1', 'https://in.linkedin.com/company/x'] }));
    expect(cs.every((c) => c.provenance.rejected_reason === null)).toBe(true);
  });

  it('caps accepted sources per answer', () => {
    const many = Array.from({ length: MAX_SOURCES_PER_ANSWER + 5 }, (_, i) => `https://s${i}.test/p`);
    expect(toCitationSources(obs({ grounded_sources: many })).length).toBe(MAX_SOURCES_PER_ANSWER);
  });
});

describe('no fabrication', () => {
  it('never invents a title and never turns a host-only source into a page URL', () => {
    const cs = toCitationSources(obs({ provider: 'gemini_search', grounded_sources: ['https://reviews.test'] }));
    expect(cs[0]).toMatchObject({ title: null, url_precision: 'host_only', normalized_url: null, host: 'reviews.test', url: 'https://reviews.test' });
  });

  it('a host-only detail without a usable stated domain falls back to its URL and is rejected when that is a redirect', () => {
    const cs = toCitationSources(obs({ provider: 'gemini_search', citations: [{ url: 'https://vertexaisearch.cloud.google.com/r/1', title: null, role: 'cited', precision: 'host_only', domain: 'Some Title' }] }));
    expect(cs[0].provenance.rejected_reason).toBe('search_engine_host');
  });

  it('copies the model only when given, never a default', () => {
    expect(toCitationSources(obs({ grounded_sources: ['https://a.test/x'] }))[0].model).toBeNull();
    expect(toCitationSources(obs({ grounded_sources: ['https://a.test/x'] }), { model: 'sonar-2026' })[0].model).toBe('sonar-2026');
  });
});

describe('structural input and ids', () => {
  it('accepts a scoring-run observation shape with only grounded_sources (role unknown) and no observation id', () => {
    const input = { provider: 'scoring_run:perplexity', query: 'q', query_class: 'scoring:category', grounded_sources: ['https://a.test/1'], observation_id: null };
    const [c] = toCitationSources(input, { pipeline: 'scoring_run', observed_at: '2026-10-29T00:00:00Z' });
    expect(c.citation_role).toBe('unknown');
    expect(c.observation_id_derived).toBe(true);
    expect(c.observation_id).toBe(observationIdFor(input, '2026-10-29T00:00:00Z').id);
    expect(c.provenance.pipeline).toBe('scoring_run');
  });

  it('citation ids are deterministic and differ by observation and role', () => {
    const a = toCitationSources(obs({ grounded_sources: ['https://a.test/1'] }))[0].citation_id;
    expect(toCitationSources(obs({ grounded_sources: ['https://a.test/1'] }))[0].citation_id).toBe(a);
    expect(toCitationSources(obs({ observation_id: 'E-GEN-02', grounded_sources: ['https://a.test/1'] }))[0].citation_id).not.toBe(a);
    expect(toCitationSources(obs({ citations: [{ url: 'https://a.test/1', title: null, role: 'cited' }] }))[0].citation_id).not.toBe(a);
  });

  it('an answer with no sources yields nothing', () => {
    expect(toCitationSources(obs({ grounded_sources: [] }))).toEqual([]);
  });
});
