/**
 * Report 1 query universe — commercial ranking.
 *
 * The omnivyra.com snapshot (2026-10-24) searched "get", "credits", "features", "digital",
 * "authority", "snapshot", "help", "login": navigation words that won on link-text frequency,
 * while the declared category queries were cut by the cap and never searched.
 */
import {
  mergeReport1QueryUniverse,
  rankCommercialQueryCandidates,
  REPORT1_QUERY_LIMIT,
  type Report1QueryCandidate,
} from '../../services/report1QueryUniverse';

const pub = (value: string): Report1QueryCandidate => ({ value, origin: 'observed_public', rationale: 'r', basis: 'b' });
const dec = (value: string): Report1QueryCandidate => ({ value, origin: 'declared', rationale: 'r', basis: 'b' });
const tpl = (value: string): Report1QueryCandidate => ({ value, origin: 'derived_template', rationale: 'r', basis: 'b' });
const fallback = (value: string): Report1QueryCandidate => ({ value, origin: 'derived_fallback', rationale: 'r', basis: 'b' });

const OMNIVYRA_PUBLIC = ['get', 'credits', 'features', 'digital', 'authority', 'snapshot', 'help', 'login'].map(pub);

describe('rankCommercialQueryCandidates', () => {
  it('drops single interface words and keeps single subject words last', () => {
    const ranked = rankCommercialQueryCandidates(OMNIVYRA_PUBLIC).map((c) => c.value);
    expect(ranked).toEqual(['digital', 'authority', 'snapshot']);
  });

  it('puts declared and template queries ahead of public words, then public phrases ahead of single words', () => {
    const ranked = rankCommercialQueryCandidates([
      ...OMNIVYRA_PUBLIC,
      pub('marketing automation platform'),
      dec('ai marketing software'),
      tpl('ai marketing software alternatives'),
    ]).map((c) => c.value);
    expect(ranked.slice(0, 3)).toEqual(['ai marketing software', 'ai marketing software alternatives', 'marketing automation platform']);
    expect(ranked).not.toContain('login');
  });

  it('keeps a phrase that contains an interface word', () => {
    expect(rankCommercialQueryCandidates([pub('help desk software')]).map((c) => c.value)).toEqual(['help desk software']);
  });

  it('never invents a query and keeps each recorded origin', () => {
    const input = [dec('a b'), pub('c d'), fallback('business software competitors')];
    const ranked = rankCommercialQueryCandidates(input);
    expect(ranked).toHaveLength(3);
    for (const c of ranked) expect(input).toContain(c);
  });

  it('declared queries survive the cap — the cut previously removed them', () => {
    const universe = mergeReport1QueryUniverse(
      rankCommercialQueryCandidates([...OMNIVYRA_PUBLIC, dec('ai marketing software'), tpl('ai marketing software competitors')]),
      { limit: REPORT1_QUERY_LIMIT, normalize: (v) => (v ? v.trim() : null) },
    ).map((q) => q.query);
    expect(universe[0]).toBe('ai marketing software');
    expect(universe).toContain('ai marketing software competitors');
    expect(universe.length).toBeLessThanOrEqual(REPORT1_QUERY_LIMIT);
  });

  it('the universe cap equals the number the SERP batch searches (8)', () => {
    expect(REPORT1_QUERY_LIMIT).toBe(8);
  });
});
