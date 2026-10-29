/**
 * Source-domain aggregate: role-separated counts, buyer questions only, co-occurrence association,
 * determinism.
 */
import { toCitationSources } from '../../services/intelligence/citations/citationSources';
import { aggregateSourceDomains } from '../../services/intelligence/citations/sourceDomainAggregate';
import type { CitationDetailInput } from '../../services/intelligence/citations/citationTypes';

const answer = (id: string, provider: string, query: string, citations: CitationDetailInput[], brand = false) =>
  toCitationSources({ provider, query, query_class: brand ? 'branded' : 'commercial', grounded_sources: [], observation_id: id, citations }, { is_brand_question: brand });
const cited = (url: string): CitationDetailInput => ({ url, title: null, role: 'cited' });
const retrieved = (url: string): CitationDetailInput => ({ url, title: null, role: 'retrieved' });
const unknown = (url: string): CitationDetailInput => ({ url, title: null, role: 'unknown' });

const ctx = {
  subject: { brand: 'Acme', domains: ['acme.test'] },
  competitors: [{ name: 'Rival', domain: 'rival.test' }],
  answers: [
    { observation_id: 'E-GEN-01', brandsNamed: ['Rival', 'Other'], excerpt: 'Rival and Other lead.' },
    { observation_id: 'E-GEN-02', brandsNamed: [], excerpt: 'Acme and Rival both work.' },
    { observation_id: 'E-GEN-03', brandsNamed: ['Zeta'], excerpt: 'Zeta.' },
  ],
};

const SOURCES = [
  ...answer('E-GEN-01', 'chatgpt_search', 'best planners', [cited('https://reviews.test/a'), cited('https://reviews.test/b'), retrieved('https://side.test/1')]),
  ...answer('E-GEN-02', 'perplexity', 'planner comparison', [cited('https://reviews.test/a'), unknown('https://side.test/2')]),
  ...answer('E-GEN-03', 'claude_search', 'best planners', [retrieved('https://reviews.test/c'), cited('https://zeta-only.test/p')]),
  ...answer('E-GEN-09', 'chatgpt_search', 'Acme pricing', [cited('https://reviews.test/a')], true),
];

describe('aggregate', () => {
  const agg = aggregateSourceDomains(SOURCES, ctx);
  const of = (d: string) => agg.find((x) => x.registrable_domain === d)!;

  it('counts cited, unknown and retrieved-only separately, never summed', () => {
    expect(of('reviews.test')).toMatchObject({ citation_count: 3, unknown_role_count: 0, retrieved_only_count: 1 });
    expect(of('side.test')).toMatchObject({ citation_count: 0, unknown_role_count: 1, retrieved_only_count: 1 });
  });

  it('counts distinct buyer questions and providers from cited / unknown roles only; brand questions excluded', () => {
    expect(of('reviews.test').distinct_questions).toBe(2);
    expect(of('reviews.test').distinct_providers).toEqual(['chatgpt_search', 'perplexity']);
    expect(of('reviews.test').observation_ids).toEqual(['E-GEN-01', 'E-GEN-02']);
    expect(of('reviews.test').example_urls).toEqual(['https://reviews.test/a', 'https://reviews.test/b', 'https://reviews.test/c']);
  });

  it('associates a brand only when named in the same answer that cited the domain', () => {
    const brands = of('reviews.test').associated_brands;
    expect(brands.find((b) => b.name === 'Rival')).toMatchObject({ kind: 'validated_competitor', co_occurrences: 2, observation_ids: ['E-GEN-01', 'E-GEN-02'] });
    expect(brands.find((b) => b.name === 'Other')).toMatchObject({ kind: 'other_named_brand', co_occurrences: 1 });
    expect(brands.find((b) => b.name === 'Acme')).toMatchObject({ kind: 'subject', co_occurrences: 1, observation_ids: ['E-GEN-02'] });
    // Zeta was named only in E-GEN-03, which merely retrieved reviews.test: not associated.
    expect(brands.find((b) => b.name === 'Zeta')).toBeUndefined();
    expect(of('reviews.test').subject_named_in_citing_answers).toBe(1);
    expect(of('reviews.test').citing_answers_with_brand_data).toBe(2);
  });

  it('a name the excerpt does not contain and the reader did not keep is not associated', () => {
    expect(of('zeta-only.test').associated_brands.map((b) => b.name)).toEqual(['Zeta']);
  });

  it('answers without text (scoring-run probes) give no association and a null subject count', () => {
    const probe = toCitationSources({ provider: 'scoring_run:perplexity', query: 'q', query_class: 'scoring:category', grounded_sources: ['https://p.test/1'], observation_id: 'OBS-1' }, { pipeline: 'scoring_run' });
    const [d] = aggregateSourceDomains(probe, ctx);
    expect(d.associated_brands).toEqual([]);
    expect(d.subject_named_in_citing_answers).toBeNull();
  });

  it('is deterministic under input reordering', () => {
    const shuffled = [...SOURCES].reverse();
    expect(aggregateSourceDomains(shuffled, { ...ctx, answers: [...ctx.answers].reverse() })).toEqual(agg);
  });

  it('classifies each domain; subject-owned stays visible in the table', () => {
    const own = aggregateSourceDomains(answer('E-GEN-04', 'perplexity', 'best planners', [cited('https://acme.test/x')]), ctx);
    expect(own[0]).toMatchObject({ registrable_domain: 'acme.test', category: 'subject_owned' });
    expect(of('reviews.test').category).toBe('unknown');
  });
});
