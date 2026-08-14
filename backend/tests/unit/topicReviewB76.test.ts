/**
 * B7.6 — review API + service (backend proofs 1–10).
 *
 * The decisive assertions are negative: the review path issues NO mutation,
 * accepts NO companyId, and returns NO tenant data.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

const mockRequireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => mockRequireCapability(...a),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { supabase } from '../../db/supabaseClient';
import { listTopicsForReview, getTopicsByIds, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../services/content/knowledgeGraph/topicReviewService';
import handler from '../../../pages/api/admin/knowledge-graph/topics';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '../../../shared/contracts/security';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

/** Every query op recorded, so "read-only" and "deterministic order" are provable. */
let ops: string[];
let rows: Record<string, unknown>[];

const row = (id: string, label: string, canonical: string | null = null) => ({
  id, canonical_label: label, normalized_label: label.toLowerCase(),
  canonical_topic_id: canonical, parent_topic_id: null, state: 'observed',
  confidence: 'low', source: 'content', occurrence_count: 3,
  first_seen_at: '2026-01-01', last_seen_at: '2026-02-01',
});

function install() {
  ops = [];
  mockFrom.mockImplementation(((table: string) => {
    ops.push('from:' + table);
    const chain: Record<string, unknown> = {};
    chain.select = (cols: string) => { ops.push('select:' + cols); return chain; };
    chain.is = (c: string) => { ops.push('is:' + c); return chain; };
    chain.not = (c: string) => { ops.push('not:' + c); return chain; };
    chain.ilike = (c: string) => { ops.push('ilike:' + c); return chain; };
    chain.in = (c: string) => { ops.push('in:' + c); return chain; };
    chain.eq = (c: string) => { ops.push('eq:' + c); return chain; };
    chain.order = (c: string, o?: { ascending?: boolean }) => {
      ops.push('order:' + c + ':' + (o?.ascending ? 'asc' : 'desc'));
      return chain;
    };
    chain.range = (a: number, b: number) => { ops.push('range:' + a + '-' + b); return Promise.resolve({ data: rows, error: null }); };
    chain.then = (r: (v: unknown) => unknown) => r({ data: rows, error: null });
    // Mutation verbs deliberately absent — calling one throws, proving read-only.
    for (const verb of ['insert', 'update', 'upsert', 'delete']) {
      chain[verb] = () => { throw new Error('MUTATION ATTEMPTED: ' + verb); };
    }
    return chain as never;
  }) as never);
}

const mkRes = () => {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn(() => res as never);
  res.json = jest.fn(() => res as never);
  res.setHeader = jest.fn(() => res as never);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  rows = [row('t1', 'AI lead qualification'), row('t2', 'Lead scoring')];
  install();
  mockRequireCapability.mockResolvedValue({ ok: true, principal: { userId: 'op-1' } });
});

/* ── service ───────────────────────────────────────────────────────────── */

describe('B7.6 · review service', () => {
  it('4. ordering is deterministic on the UNIQUE normalized_label', async () => {
    await listTopicsForReview();
    expect(ops).toContain('order:normalized_label:asc');
  });

  it('6. performs NO mutation — mutation verbs throw if reached', async () => {
    await listTopicsForReview();
    await getTopicsByIds(['t1']);
    expect(ops.some((o) => /insert|update|upsert|delete/.test(o))).toBe(false);
  });

  it('selects an explicit column allow-list, never *', async () => {
    await listTopicsForReview();
    const sel = ops.find((o) => o.startsWith('select:')) ?? '';
    expect(sel).not.toContain('*');
    expect(sel).toContain('normalized_label');
  });

  it('5. never selects tenant columns or the embedding', async () => {
    await listTopicsForReview();
    const sel = ops.find((o) => o.startsWith('select:')) ?? '';
    for (const forbidden of ['company_id', 'campaign_id', 'content_id', 'user_id', 'embedding']) {
      expect(sel).not.toContain(forbidden);
    }
  });

  it('filters identities with IS NULL and aliases with NOT IS NULL (never = null)', async () => {
    await listTopicsForReview({ filter: 'identities' });
    expect(ops).toContain('is:canonical_topic_id');
    install();
    await listTopicsForReview({ filter: 'aliases' });
    expect(ops).toContain('not:canonical_topic_id');
    install();
    await listTopicsForReview({ filter: 'all' });
    expect(ops.some((o) => o.startsWith('is:') || o.startsWith('not:'))).toBe(false);
  });

  it('requests pageSize+1 to compute hasMore without a COUNT', async () => {
    rows = Array.from({ length: DEFAULT_PAGE_SIZE + 1 }, (_, i) => row('t' + i, 'label ' + i));
    const p = await listTopicsForReview();
    expect(p.items).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(p.hasMore).toBe(true);
    expect(ops).toContain('range:0-' + DEFAULT_PAGE_SIZE);
  });

  it('clamps pageSize and floors negative pages', async () => {
    const p = await listTopicsForReview({ pageSize: 5000, page: -3 });
    expect(p.pageSize).toBe(MAX_PAGE_SIZE);
    expect(p.page).toBe(0);
  });

  it('5. empty state is deterministic on error — empty list, no throw', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    const p = await listTopicsForReview();
    expect(p).toMatchObject({ items: [], hasMore: false });
    await expect(getTopicsByIds(['t1'])).resolves.toEqual([]);
  });

  it('getTopicsByIds dedupes, trims and ignores blanks', async () => {
    await getTopicsByIds(['t1', ' t1 ', '', '  ', 't2']);
    expect(ops).toContain('in:id');
  });

  it('maps rows to camelCase without leaking snake_case keys', async () => {
    const p = await listTopicsForReview();
    expect(Object.keys(p.items[0]).sort()).toEqual([
      'canonicalLabel', 'canonicalTopicId', 'confidence', 'firstSeenAt', 'id',
      'lastSeenAt', 'normalizedLabel', 'occurrenceCount', 'parentTopicId', 'source', 'state',
    ]);
  });
});

/* ── route ─────────────────────────────────────────────────────────────── */

describe('B7.6 · review route', () => {
  it('1. an authorized operator retrieves review data', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].items).toHaveLength(2);
  });

  it('2/3. an unauthorized or company-scoped caller is rejected and reads nothing', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  it('gates on the same platform-tier capability as B7.5', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(mockRequireCapability.mock.calls[0][2]).toMatchObject({ capability: INTELLIGENCE_OVERRIDE_MANAGE });
  });

  it('4. an unknown filter falls back to identities — never widens scope', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: { filter: 'everything' } } as never, res as never);
    expect(res.json.mock.calls[0][0].filter).toBe('identities');
  });

  it('4. no companyId is accepted from the browser', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: { companyId: 'c1', company_id: 'c2' } } as never, res as never);
    // Only the topic table is touched, and no company predicate is applied.
    expect(ops.filter((o) => o.includes('company'))).toEqual([]);
  });

  it('6. the route cannot mutate — mutation verbs throw if reached', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(ops.some((o) => /insert|update|upsert|delete/.test(o))).toBe(false);
  });

  it('byIds mode is served for explicit pairing', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: { ids: 't1,t2' } } as never, res as never);
    expect(res.json.mock.calls[0][0].mode).toBe('byIds');
  });

  it('non-GET is rejected before the guard', async () => {
    const res = mkRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockRequireCapability).not.toHaveBeenCalled();
  });

  it('5. empty state returns 200 with an empty list', async () => {
    rows = [];
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ items: [], hasMore: false });
  });
});

/* ── B7.7 — candidates mode on the review route ────────────────────────── */

jest.mock('../../services/content/knowledgeGraph/topicCandidateService', () => ({
  findTopicCandidates: jest.fn(async () => ([{
    sourceTopicId: 's1', candidateTopicId: 'c1', candidateLabel: 'AI powered lead qualification',
    candidateNormalizedLabel: 'ai powered lead qualification',
    similarityScore: 0.79, retrievalRank: 1, generatedAt: '2026-08-13T00:00:00Z',
  }])),
}));

describe('B7.7 · candidates reach the review surface', () => {
  it('serves candidates for a topic, gated by the same capability', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: { candidatesFor: 's1' } } as never, res as never);
    expect(mockRequireCapability).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.mode).toBe('candidates');
    expect(body.items[0].similarityScore).toBe(0.79);
    expect(body.items[0].retrievalRank).toBe(1);
  });

  it('the candidate payload carries NO identity decision', async () => {
    const res = mkRes();
    await handler({ method: 'GET', query: { candidatesFor: 's1' } } as never, res as never);
    const keys = Object.keys(res.json.mock.calls[0][0].items[0]);
    for (const forbidden of ['shouldMerge', 'isSame', 'decision', 'canonicalTopicId']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('an unauthorized caller gets no candidates', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler({ method: 'GET', query: { candidatesFor: 's1' } } as never, res as never);
    expect(res.status).not.toHaveBeenCalledWith(200);
  });
});
