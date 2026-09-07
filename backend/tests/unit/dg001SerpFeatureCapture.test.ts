/**
 * DG-001 — SERP feature capture.
 *
 * WHAT THIS PROVES. The parser observes the SERP features the providers already
 * return, rejects what it cannot name, invents nothing, and leaves the organic
 * and featured-snippet paths byte-identical to what they were. The last of
 * those is the one that matters most: this change touches the single parser
 * every SERP provider flows through, so the regression assertions below are not
 * ceremony — they are the reason the change is safe to make there.
 *
 * WHAT IT DOES NOT PROVE. Nothing here is evidence that a provider ACTUALLY
 * returns a given block. `parseProviderResults` is exercised against inputs
 * shaped like provider responses; whether SerpAPI or ScaleSERP deliver those
 * shapes is unverified in this repository and unverified against a live
 * account. Only DataForSEO's richer stream is proven from the code itself.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => { throw new Error('no production table in this suite'); },
}));

import {
  SERP_RESULT_TYPES,
  PERSISTABLE_SERP_RESULT_TYPES,
  ANSWER_FEATURE_TYPES,
  normalizeSerpResultType,
  hasMeaningfulPosition,
  requiresUrl,
  isPersistableSerpResultType,
  isAnswerFeature,
  PROVIDER_TYPE_ALIASES,
  type SerpResultType,
} from '../../services/serp/serpResultTypes';
import { __parseProviderResultsForTest as parse } from '../../services/serpAcquisitionService';

const organic = (over: Record<string, unknown> = {}) => ({
  type: 'organic', position: 1, url: 'https://northwind.test/a', title: 'A', ...over,
});

// ── the vocabulary ──────────────────────────────────────────────────────────

describe('DG-001 — the result vocabulary is closed', () => {
  it('every alias maps into the canonical vocabulary', () => {
    for (const [alias, type] of Object.entries(PROVIDER_TYPE_ALIASES)) {
      expect(SERP_RESULT_TYPES).toContain(type);
      expect(normalizeSerpResultType(alias)).toBe(type);
    }
  });

  it('is case- and whitespace-insensitive, and nothing else', () => {
    expect(normalizeSerpResultType('  RELATED_QUESTIONS ')).toBe('people_also_ask');
    // Not substring matching: a label that merely contains a known word is not one.
    expect(normalizeSerpResultType('questions')).toBeNull();
    expect(normalizeSerpResultType('organic_extra')).toBeNull();
  });

  it('refuses anything it does not recognise, rather than guessing', () => {
    for (const bad of ['', '   ', 'sponsored_carousel', 'brand_new_block', null, undefined, 42, {}, []]) {
      expect(normalizeSerpResultType(bad as never)).toBeNull();
    }
  });

  it('names exactly the four types the deployed CHECK constraint allows', () => {
    // Mirrors migration 20260660. If this drifts, persistence raises 23514.
    expect([...PERSISTABLE_SERP_RESULT_TYPES].sort())
      .toEqual(['featured_snippet', 'organic', 'other', 'paid']);
    for (const t of SERP_RESULT_TYPES) {
      expect(isPersistableSerpResultType(t)).toBe(PERSISTABLE_SERP_RESULT_TYPES.includes(t));
    }
  });

  it('marks the answer-oriented features, and decides nothing with them', () => {
    // DG-007 will consume this. Today it is a predicate over the vocabulary.
    expect([...ANSWER_FEATURE_TYPES].sort())
      .toEqual(['featured_snippet', 'knowledge_panel', 'people_also_ask']);
    expect(isAnswerFeature('organic')).toBe(false);
    expect(isAnswerFeature('people_also_ask')).toBe(true);
  });

  it('withholds a rank from features that do not have one', () => {
    for (const t of ['people_also_ask', 'knowledge_panel', 'sitelink', 'image'] as SerpResultType[]) {
      expect(hasMeaningfulPosition(t)).toBe(false);
    }
    for (const t of ['organic', 'featured_snippet', 'paid'] as SerpResultType[]) {
      expect(hasMeaningfulPosition(t)).toBe(true);
    }
  });

  it('requires a URL only from features that must link somewhere', () => {
    expect(requiresUrl('organic')).toBe(true);
    expect(requiresUrl('sitelink')).toBe(true);
    // These legitimately link nowhere; requiring a URL would discard real
    // observations, and inventing one would be fabrication.
    expect(requiresUrl('people_also_ask')).toBe(false);
    expect(requiresUrl('knowledge_panel')).toBe(false);
  });
});

// ── regression: the paths that already worked ───────────────────────────────

describe('DG-001 — organic and featured-snippet parsing are unchanged', () => {
  it('an untyped row is organic, exactly as before', () => {
    const [row] = parse([{ position: 3, url: 'https://northwind.test/x', title: 'X' }]);
    expect(row).toEqual({
      position: 3, url: 'https://northwind.test/x', domain: 'northwind.test',
      title: 'X', result_type: 'organic',
    });
  });

  it('derives domain from the URL when none is supplied, as before', () => {
    const [row] = parse([{ position: 1, url: 'https://www.Northwind.test/a', title: 'A' }]);
    expect(row.domain).toBe('northwind.test');
  });

  it('falls back through position → rank → rank_absolute → index, as before', () => {
    expect(parse([{ url: 'https://a.test/1', title: 'A', rank: 7 }])[0].position).toBe(7);
    expect(parse([{ url: 'https://a.test/1', title: 'A', rank_absolute: 9 }])[0].position).toBe(9);
    // No rank of any kind → 1-based index.
    expect(parse([{ url: 'https://a.test/1', title: 'A' }])[0].position).toBe(1);
  });

  it('honours the featured_snippet flag and the featured_snippet type', () => {
    expect(parse([{ ...organic(), featured_snippet: true }])[0].result_type).toBe('featured_snippet');
    expect(parse([organic({ type: 'featured_snippet' })])[0].result_type).toBe('featured_snippet');
  });

  it('still drops an organic row with no URL or no domain', () => {
    expect(parse([{ position: 1, title: 'no link' }])).toEqual([]);
    expect(parse([{ position: 1, url: 'not-a-url', title: 'A' }])).toEqual([]);
  });

  it('still caps the response at 50 rows', () => {
    const many = Array.from({ length: 80 }, (_, i) => organic({ position: i + 1, url: `https://a.test/${i}` }));
    expect(parse(many)).toHaveLength(50);
  });
});

// ── positive: the features that used to be discarded ────────────────────────

describe('DG-001 — the discarded features are now observed', () => {
  it('captures People Also Ask from its question, with no rank and no URL', () => {
    const [row] = parse([{ type: 'people_also_ask', question: 'What is Northwind?' }]);
    expect(row).toEqual({
      position: null, url: null, domain: null,
      title: 'What is Northwind?', result_type: 'people_also_ask',
    });
  });

  it('captures a knowledge panel that links nowhere', () => {
    const [row] = parse([{ type: 'knowledge_graph', title: 'Northwind Ltd' }]);
    expect(row).toMatchObject({ result_type: 'knowledge_panel', position: null, url: null });
  });

  it.each([
    ['local_pack', 'local'],
    ['inline_images', 'image'],
    ['inline_videos', 'video'],
    ['top_stories', 'news'],
    ['shopping_results', 'shopping'],
    ['ads', 'paid'],
    ['sitelinks', 'sitelink'],
  ])('maps provider label %s to %s', (label, expected) => {
    const [row] = parse([{ type: label, position: 2, url: 'https://northwind.test/p', title: 'P' }]);
    expect(row.result_type).toBe(expected);
  });

  it('gives ranked features a position and unranked features null', () => {
    const rows = parse([
      { type: 'ads', position: 1, url: 'https://a.test/ad', title: 'Ad' },
      { type: 'related_questions', question: 'Q?' },
    ]);
    expect(rows.find((r) => r.result_type === 'paid')!.position).toBe(1);
    expect(rows.find((r) => r.result_type === 'people_also_ask')!.position).toBeNull();
  });

  it('preserves paid results instead of discarding them', () => {
    const rows = parse([{ type: 'ads', position: 1, url: 'https://rival.test/ad', title: 'Buy' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result_type: 'paid', domain: 'rival.test' });
  });
});

// ── negative: malformed, unknown, incomplete ────────────────────────────────

describe('DG-001 — bad input produces no observation, never a wrong one', () => {
  it('rejects an unrecognised block rather than relabelling it', () => {
    expect(parse([{ type: 'sponsored_carousel', position: 1, url: 'https://a.test/x', title: 'X' }]))
      .toEqual([]);
  });

  it('rejects a linked feature with no link', () => {
    expect(parse([{ type: 'sitelinks', title: 'About' }])).toEqual([]);
    expect(parse([{ type: 'top_stories', title: 'Story' }])).toEqual([]);
  });

  it('rejects an unlinked feature with no title — there is nothing to observe', () => {
    expect(parse([{ type: 'related_questions' }])).toEqual([]);
    expect(parse([{ type: 'knowledge_graph', title: '   ' }])).toEqual([]);
  });

  it('rejects a ranked feature whose rank is unusable', () => {
    for (const position of [0, -3, Number.NaN, 'third']) {
      expect(parse([{ type: 'organic', position, url: 'https://a.test/x', title: 'X' }])).toEqual([]);
    }
  });

  it('survives non-objects in the array without losing the valid rows', () => {
    const rows = parse([null, undefined, 'garbage', 42, [], organic({ url: 'https://a.test/ok' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('https://a.test/ok');
  });

  it('keeps the valid results from a response that also contains malformed ones', () => {
    const rows = parse([
      organic({ position: 1, url: 'https://a.test/1' }),
      { type: 'unknown_block', position: 2, url: 'https://a.test/2', title: 'B' },
      { type: 'related_questions' },                                   // no title
      { type: 'related_questions', question: 'Real question?' },
      organic({ position: 3, url: 'https://a.test/3' }),
    ]);
    expect(rows.map((r) => r.result_type)).toEqual(['organic', 'people_also_ask', 'organic']);
  });

  it('de-duplicates within one response, and keeps distinct types apart', () => {
    const dupes = parse([
      organic({ position: 1, url: 'https://a.test/1' }),
      organic({ position: 1, url: 'https://a.test/1' }),
    ]);
    expect(dupes).toHaveLength(1);

    // The same URL as an organic result and inside a sitelink block are two
    // different observations about the page, not one repeated.
    const mixed = parse([
      organic({ position: 1, url: 'https://a.test/1' }),
      { type: 'sitelinks', url: 'https://a.test/1', title: 'Same link, sitelink' },
    ]);
    expect(mixed).toHaveLength(2);
  });

  it('never invents a URL, a domain, a title or a rank', () => {
    for (const row of parse([
      { type: 'related_questions', question: 'Q?' },
      { type: 'knowledge_graph', title: 'K' },
    ])) {
      expect(row.url).toBeNull();
      expect(row.domain).toBeNull();
      expect(row.position).toBeNull();
      expect(row.title).toBeTruthy();
    }
  });
});

// ── the adapter, not just the parser ────────────────────────────────────────

describe('DG-001 — the DataForSEO adapter stops discarding what it paid for', () => {
  /**
   * WHY THIS EXISTS. The parser tests above all passed while the adapter still
   * filtered `items` down to two types — the mutation that restores that filter
   * killed nothing. The defect DG-001 exists to fix lived in the ADAPTER, so it
   * has to be asserted there: a response is stubbed, the real adapter parses it,
   * and the features must survive the journey.
   *
   * Fully synthetic: `fetch` is replaced, so no network and no credential.
   */
  const ENV = { ...process.env };
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    process.env.DATAFORSEO_LOGIN = 'synthetic-login';
    process.env.DATAFORSEO_PASSWORD = 'synthetic-password';
    process.env.SERP_PROVIDER_PRIORITY = 'dataforseo';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...ENV };
  });

  /** The mixed `items` stream `/serp/google/organic/live/advanced` returns. */
  const RESPONSE = {
    tasks: [{
      id: 'task-1',
      data: { location_name: 'United States', device: 'desktop' },
      result: [{
        items: [
          { type: 'organic', rank_group: 1, url: 'https://northwind.test/a', title: 'A', domain: 'northwind.test' },
          { type: 'featured_snippet', rank_group: 2, url: 'https://northwind.test/f', title: 'F', domain: 'northwind.test' },
          { type: 'people_also_ask', title: 'What is Northwind?' },
          { type: 'knowledge_graph', title: 'Northwind Ltd' },
          { type: 'local_pack', rank_group: 3, url: 'https://northwind.test/l', title: 'L', domain: 'northwind.test' },
          { type: 'top_stories', rank_group: 4, url: 'https://news.test/s', title: 'S', domain: 'news.test' },
          { type: 'paid', rank_group: 5, url: 'https://rival.test/ad', title: 'Ad', domain: 'rival.test' },
        ],
      }],
    }],
  };

  const runAdapter = async () => {
    globalThis.fetch = (async () => ({
      ok: true, status: 200, json: async () => RESPONSE,
    })) as unknown as typeof globalThis.fetch;
    const { configuredSerpProviders } = await import('../../services/serpAcquisitionService');
    const providers = await configuredSerpProviders();
    const dataforseo = providers.find((p) => p.id === 'dataforseo');
    expect(dataforseo).toBeTruthy();
    return dataforseo!.fetch('northwind crm');
  };

  it('carries every nameable feature through to the canonical results', async () => {
    const out = await runAdapter();
    const types = (out?.results ?? []).map((r) => r.result_type).sort();
    expect(types).toEqual([
      'featured_snippet', 'knowledge_panel', 'local',
      'news', 'organic', 'paid', 'people_also_ask',
    ]);
  });

  it('keeps the organic result exactly as it was before this change', async () => {
    const out = await runAdapter();
    const organicRow = (out?.results ?? []).find((r) => r.result_type === 'organic');
    expect(organicRow).toEqual({
      position: 1, url: 'https://northwind.test/a', domain: 'northwind.test',
      title: 'A', result_type: 'organic',
    });
  });

  it('gives the unranked features no rank and no invented link', async () => {
    const out = await runAdapter();
    const paa = (out?.results ?? []).find((r) => r.result_type === 'people_also_ask');
    expect(paa).toMatchObject({ position: null, url: null, domain: null, title: 'What is Northwind?' });
  });
});
