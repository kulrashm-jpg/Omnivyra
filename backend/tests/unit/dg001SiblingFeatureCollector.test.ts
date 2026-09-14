/**
 * DG-001 — the sibling-feature collector's handling of untrusted provider JSON.
 *
 * `collectSiblingFeatureItems` reads the blocks that sit beside `organic_results`
 * (and the sitelinks nested inside them) from a raw provider response. It used to
 * take `body: any`; it now takes `unknown` and proves each level is an object before
 * reading from it. That change is only worth anything if malformed input cannot
 * slip past the check, so this suite feeds it the shapes a provider could send.
 *
 * The PARSER's own rules (identity, rank, closed vocabulary, de-duplication) are
 * covered in dg001SerpFeatureCapture.test.ts and are not repeated here. What is new
 * here is the collector, plus the few compositions that show the collector cannot
 * launder anything past the parser — above all, that a provider cannot relabel a
 * feature as `organic` by putting `type: 'organic'` on it.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

import {
  __collectSiblingFeatureItemsForTest as collect,
  __parseProviderResultsForTest as parse,
} from '../../services/serpAcquisitionService';

describe('DG-001 — a body that is not an object yields nothing, and does not throw', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'related_questions'],
    ['a number', 42],
    ['a boolean', true],
  ])('%s → []', (_label, body) => {
    expect(collect(body)).toEqual([]);
  });

  it('an array body carries none of the named blocks → []', () => {
    expect(collect([{ question: 'Q?' }])).toEqual([]);
  });

  it('an object without any feature block → []', () => {
    expect(collect({ organic_results: [], search_metadata: { id: 'x' } })).toEqual([]);
  });
});

describe('DG-001 — only object entries are collected, and each is tagged by its key', () => {
  it('a valid object block (a knowledge graph arrives as one object) is collected', () => {
    expect(collect({ knowledge_graph: { title: 'Northwind Ltd' } }))
      .toEqual([{ title: 'Northwind Ltd', type: 'knowledge_graph' }]);
  });

  it('within an array block, null and primitive entries are skipped', () => {
    const items = collect({
      related_questions: [{ question: 'Q1?' }, null, 'Q2?', 7, undefined, { question: 'Q3?' }],
    });
    expect(items).toEqual([
      { question: 'Q1?', type: 'related_questions' },
      { question: 'Q3?', type: 'related_questions' },
    ]);
  });

  it('a primitive where a block should be is ignored', () => {
    expect(collect({ knowledge_graph: 'Northwind', related_questions: 5 })).toEqual([]);
  });

  it('the key’s label OVERWRITES any type the provider put on the entry', () => {
    // A provider cannot promote a feature to `organic` — or invent a type — by
    // labelling the entry itself. The collector writes `type` last.
    const items = collect({
      related_questions: [{ question: 'Q?', type: 'organic' }],
      knowledge_graph: { title: 'N', type: 'invented_block' },
    });
    expect(items.map((i) => i.type)).toEqual(['related_questions', 'knowledge_graph']);
  });
});

describe('DG-001 — sitelinks nested inside organic results', () => {
  const link = { title: 'About', url: 'https://northwind.test/about' };

  it.each([
    ['an array', [link]],
    ['{ inline: [...] }', { inline: [link] }],
    ['{ expanded: [...] }', { expanded: [link] }],
  ])('collects sitelinks given as %s', (_label, sitelinks) => {
    expect(collect({ organic_results: [{ url: 'https://northwind.test', sitelinks }] }))
      .toEqual([{ ...link, type: 'sitelink' }]);
  });

  it('null, primitive and malformed organic results and containers contribute nothing', () => {
    expect(collect({
      organic_results: [
        null,
        'a string result',
        { sitelinks: null },
        { sitelinks: 'not a container' },
        { sitelinks: { inline: 'not an array' } },
        { sitelinks: [null, 3, 'x'] },
      ],
    })).toEqual([]);
  });

  it('a non-array organic_results is not iterated', () => {
    expect(collect({ organic_results: { 0: { sitelinks: [link] } } })).toEqual([]);
  });
});

describe('DG-001 — nothing the collector passes on can bypass the parser', () => {
  it('a feature labelled `organic` by the provider is still a People Also Ask entry', () => {
    const rows = parse(collect({ related_questions: [{ question: 'Q?', type: 'organic', link: 'https://x.test/q' }] }));
    expect(rows.map((r) => r.result_type)).toEqual(['people_also_ask']);
    // …and so it carries no organic rank.
    expect(rows[0].position).toBeNull();
  });

  it('an entry missing its identifying evidence is withheld, not filled in', () => {
    // An unlinked type needs a question or title; a linked type needs a link.
    expect(parse(collect({ related_questions: [{}], top_stories: [{ title: 'Headline, no link' }] }))).toEqual([]);
  });

  it('an unranked feature’s position — even a nonsense one — is not turned into a rank', () => {
    const rows = parse(collect({ knowledge_graph: { title: 'Northwind Ltd', position: 'first' } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBeNull();
  });

  it('a garbage body parses to no observations at all', () => {
    for (const body of [null, 'x', 42, [], { related_questions: [null, 1, 'x'] }]) {
      expect(parse(collect(body))).toEqual([]);
    }
  });
});
