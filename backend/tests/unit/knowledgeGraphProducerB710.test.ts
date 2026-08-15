/**
 * B7.10 — content-acceptance producer: the cases the restored B7.2 acceptance
 * suite does not cover (§8 G, H, I, J and the duplicate-adoption path).
 *
 * The decisive assertions are negative: the producer reaches no provider, no
 * ledger and no customer billing, and it cannot disable B7.9 operator authoring.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../../services/ai/safety', () => ({
  moderateBeforePersist: jest.fn(async () => ({ allow: true, categories: [], auditId: 'a' })),
  AiError: class AiError extends Error {},
}));

const mockResolve = jest.fn();
const mockRecordCoverage = jest.fn();
const mockEnabled = jest.fn();
jest.mock('../../services/content/knowledgeGraph/topicResolutionService', () => ({
  resolveTopicIdentity: (...a: unknown[]) => mockResolve(...a),
  isPlatformKnowledgeGraphEnabled: () => mockEnabled(),
}));
jest.mock('../../services/content/knowledgeGraph/coverageService', () => ({
  recordTopicCoverage: (...a: unknown[]) => mockRecordCoverage(...a),
}));
jest.mock('../../observability', () => ({
  recordRawCounter: jest.fn(),
  recordRawHistogram: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../../db/supabaseClient';
import { createContent } from '../../services/content/contentService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

const COMPANY = '11111111-1111-1111-1111-111111111111';
const TOPIC_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

/** Every table the acceptance path touches, so the boundary is provable. */
let touched: string[];

function installSupabase() {
  touched = [];
  mockFrom.mockImplementation(((table: string) => {
    touched.push(table);
    const chain: Record<string, unknown> = {};
    chain.insert = (row: unknown) => {
      const ins: Record<string, unknown> = {};
      ins.select = () => ins;
      ins.single = () => Promise.resolve({
        data: { id: 'c-1', company_id: COMPANY, content_type: 'post', ...(row as object) },
        error: null,
      });
      ins.then = (r: (v: unknown) => unknown) => r({ error: null });
      return ins;
    };
    return chain as never;
  }) as never);
}

const req = (over: Record<string, unknown> = {}) => ({
  companyId: COMPANY, contentType: 'post' as const, title: 't', body: 'b',
  topic: 'AI Lead Qualification', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  installSupabase();
  mockEnabled.mockReturnValue(true);
  mockResolve.mockResolvedValue({
    kind: 'new_topic', topicId: TOPIC_ID, normalizedLabel: 'ai lead qualification',
    state: 'observed', confidence: 'low', reason: 'created_new_identity',
  });
  mockRecordCoverage.mockResolvedValue({ ok: true, action: 'recorded' });
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

/* ── G. provider / billing boundary ────────────────────────────────────── */

describe('B7.10 · provider and billing boundary', () => {
  it('the producer writes no ledger or customer-billing table', async () => {
    await createContent(req());
    for (const forbidden of ['platform_usage_events', 'usage_events', 'unified_transactions']) {
      expect(touched).not.toContain(forbidden);
    }
  });

  it('the producer makes no network/provider call', async () => {
    const realFetch = globalThis.fetch;
    const spy = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = spy;
    try {
      await createContent(req());
      expect(spy).not.toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  });

  it('resolution and coverage are the ONLY knowledge-graph operations', async () => {
    await createContent(req());
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockRecordCoverage).toHaveBeenCalledTimes(1);
  });

  it('the producer source names the acceptance path, not an operator', async () => {
    await createContent(req());
    expect(mockResolve.mock.calls[0][1]).toEqual({ source: 'content_acceptance' });
    expect(mockRecordCoverage.mock.calls[0][0].source).toBe('content_acceptance');
  });
});

/* ── I. duplicate adoption / convergence ───────────────────────────────── */

describe('B7.10 · convergence', () => {
  it('an existing identity is adopted — no duplicate topic is created', async () => {
    mockResolve.mockResolvedValue({
      kind: 'existing_canonical', topicId: TOPIC_ID, normalizedLabel: 'ai lead qualification',
      state: 'observed', confidence: 'low', reason: 'exact_normalized_label_match',
    });
    await createContent(req());
    expect(mockRecordCoverage.mock.calls[0][0].topicId).toBe(TOPIC_ID);
  });

  it('repeated equivalent content converges on the same topic id', async () => {
    await createContent(req({ topic: 'AI Lead Qualification' }));
    mockResolve.mockResolvedValue({
      kind: 'existing_canonical', topicId: TOPIC_ID, normalizedLabel: 'ai lead qualification',
      state: 'observed', confidence: 'low', reason: 'exact_normalized_label_match',
    });
    await createContent(req({ topic: '  ai   lead   qualification ' }));
    const ids = mockRecordCoverage.mock.calls.map((c) => c[0].topicId);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(TOPIC_ID);
  });

  it('an alias resolves through to its canonical identity', async () => {
    mockResolve.mockResolvedValue({
      kind: 'existing_alias', topicId: TOPIC_ID, normalizedLabel: 'ai powered lead qualification',
      state: 'observed', confidence: 'low', reason: 'alias_followed_to_canonical',
    });
    await createContent(req());
    expect(mockRecordCoverage.mock.calls[0][0].topicId).toBe(TOPIC_ID);
  });

  it('the raw label is handed to the resolver — no second normalizer', async () => {
    await createContent(req({ topic: '  AI   Lead   Qualification ' }));
    expect(mockResolve.mock.calls[0][0]).toBe('  AI   Lead   Qualification ');
  });
});

/* ── J. angle + tenancy ────────────────────────────────────────────────── */

describe('B7.10 · coverage semantics', () => {
  it('angle_label is explicitly NULL — never synthesised', async () => {
    await createContent(req());
    expect(mockRecordCoverage.mock.calls[0][0].angleLabel).toBeNull();
  });

  it('coverage is company-scoped from the accepted content', async () => {
    await createContent(req());
    const arg = mockRecordCoverage.mock.calls[0][0];
    expect(arg.companyId).toBe(COMPANY);
    expect(arg.contentId).toBe('c-1');
  });

  it('no tenant field is ever passed to topic resolution', async () => {
    await createContent(req());
    expect(JSON.stringify(mockResolve.mock.calls[0])).not.toMatch(/companyId|organizationId|campaignId/i);
  });
});

/* ── H. operator authoring independence (source proof) ─────────────────── */

describe('B7.10 · B7.9 operator authoring stays independent of the flag', () => {
  const REPO = path.resolve(__dirname, '../../..');
  const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');

  it('the flag is NOT checked inside resolveTopicIdentity', () => {
    const src = read('backend/services/content/knowledgeGraph/topicResolutionService.ts');
    const body = src.slice(src.indexOf('export async function resolveTopicIdentity'));
    expect(body).not.toContain('isPlatformKnowledgeGraphEnabled(');
  });

  it('the flag is NOT checked in the operator curation writer', () => {
    const src = read('backend/services/content/knowledgeGraph/topicCurationService.ts');
    expect(src).not.toContain('isPlatformKnowledgeGraphEnabled');
    expect(src).not.toContain('PLATFORM_KNOWLEDGE_GRAPH_ENABLED');
  });

  it('the flag is NOT checked in the B7.9 authoring route', () => {
    const src = read('pages/api/admin/knowledge-graph/topic.ts');
    expect(src).not.toContain('PLATFORM_KNOWLEDGE_GRAPH');
  });

  it('the flag is enforced ONLY at the content-acceptance producer', () => {
    const src = read('backend/services/content/contentService.ts');
    expect((src.match(/isPlatformKnowledgeGraphEnabled\(\)/g) ?? []).length).toBe(1);
  });

  it('the producer introduces no second flag', () => {
    const src = read('backend/services/content/contentService.ts');
    const flags = (src.match(/process\.env\.[A-Z_]+/g) ?? []).filter((f) => /KNOWLEDGE_GRAPH/.test(f));
    expect(flags).toEqual([]);   // reads the flag only via the shared helper
  });

  it('the producer imports no novelty or uniqueness dependency', () => {
    const src = read('backend/services/content/contentService.ts');
    expect(src).not.toContain('platformNoveltyService');
    expect(src).not.toContain('campaignUniquenessGuard');
  });
});
