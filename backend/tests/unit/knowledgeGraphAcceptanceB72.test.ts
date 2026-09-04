/**
 * B7.2 — acceptance-path integration (STEP 5, 7, 10).
 *
 * The decisive assertions are negative: with the flag OFF the graph is never
 * touched, and with it ON a graph failure cannot fail content acceptance.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
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

const mockCounter = jest.fn();
jest.mock('../../observability', () => ({
  recordRawCounter: (...a: unknown[]) => mockCounter(...a),
  recordRawHistogram: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { createContent } from '../../services/content/contentService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

const COMPANY = '11111111-1111-1111-1111-111111111111';
const CAMPAIGN = '33333333-3333-3333-3333-333333333333';
const TOPIC_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function installSupabase() {
  mockFrom.mockImplementation(((table: string) => {
    if (table === 'content') {
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({
              data: { id: 'content-1', created_at: 'n', updated_at: 'n', current_revision: 1, ...row },
              error: null,
            }),
          }),
        }),
      };
    }
    return { insert: async () => ({ error: null }) };
  }) as unknown as typeof supabase.from);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  installSupabase();
  mockEnabled.mockReturnValue(false);
  mockResolve.mockResolvedValue({ kind: 'existing_canonical', topicId: TOPIC_ID, normalizedLabel: 't', state: 'observed', confidence: 'low', reason: 'x' });
  mockRecordCoverage.mockResolvedValue({ ok: true, action: 'created', coverageCount: 1 });
});
afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

const req = (extra: Record<string, unknown> = {}) => ({
  companyId: COMPANY, contentType: 'post' as const, body: 'x', topic: 'AI lead qualification', ...extra,
});

/* ── STEP 7 — flag OFF ─────────────────────────────────────────────────── */

describe('B7.2 · flag OFF ⇒ zero graph operations', () => {
  it('no topic resolution occurs', async () => {
    await createContent(req());
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('no coverage write occurs', async () => {
    await createContent(req());
    expect(mockRecordCoverage).not.toHaveBeenCalled();
  });

  it('no embedding/semantic provider call is made for B7.2', async () => {
    await createContent(req());
    // Neither graph service is reached, so no provider beneath them can be.
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockRecordCoverage).not.toHaveBeenCalled();
  });

  it('content acceptance still succeeds and returns the artifact', async () => {
    const out = await createContent(req());
    expect(out.id).toBe('content-1');
  });

  it('emits no graph telemetry', async () => {
    await createContent(req());
    const names = mockCounter.mock.calls.map((c) => String(c[0]));
    expect(names.filter((n) => n.includes('knowledge_graph'))).toEqual([]);
  });
});

/* ── STEP 7 — flag ON ──────────────────────────────────────────────────── */

describe('B7.2 · flag ON ⇒ the graph path executes', () => {
  beforeEach(() => mockEnabled.mockReturnValue(true));

  it('resolves the topic from the artifact signal', async () => {
    await createContent(req());
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve.mock.calls[0][0]).toBe('AI lead qualification');
  });

  it('records coverage against the resolved canonical topic', async () => {
    await createContent(req());
    const arg = mockRecordCoverage.mock.calls[0][0];
    expect(arg.topicId).toBe(TOPIC_ID);
    expect(arg.companyId).toBe(COMPANY);
    expect(arg.contentId).toBe('content-1');
  });

  it('preserves campaign_id when the artifact has one', async () => {
    await createContent(req({ campaignId: CAMPAIGN }));
    expect(mockRecordCoverage.mock.calls[0][0].campaignId).toBe(CAMPAIGN);
  });

  it('persists NULL campaign when absent — never inferred', async () => {
    await createContent(req());
    expect(mockRecordCoverage.mock.calls[0][0].campaignId).toBeNull();
  });

  it('never fabricates an angle (B7.3 owns extraction)', async () => {
    await createContent(req());
    expect(mockRecordCoverage.mock.calls[0][0].angleLabel).toBeNull();
  });

  it('runs AFTER the artifact is persisted, never before', async () => {
    const order: string[] = [];
    mockFrom.mockImplementation(((table: string) => {
      if (table === 'content') {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({ single: async () => { order.push('content_insert'); return { data: { id: 'content-1', ...row }, error: null }; } }),
          }),
        };
      }
      return { insert: async () => ({ error: null }) };
    }) as never);
    mockResolve.mockImplementation(async () => { order.push('resolve'); return { kind: 'new_topic', topicId: TOPIC_ID, normalizedLabel: 't', state: 'observed', confidence: 'low', reason: 'r' }; });
    await createContent(req());
    expect(order).toEqual(['content_insert', 'resolve']);
  });

  it('an unresolved topic records telemetry and writes no coverage', async () => {
    mockResolve.mockResolvedValue({ kind: 'ambiguous', topicId: null, normalizedLabel: '', state: 'unknown', confidence: 'none', reason: 'empty_or_non_string_topic_signal' });
    await createContent(req({ topic: null }));
    expect(mockRecordCoverage).not.toHaveBeenCalled();
    expect(mockCounter.mock.calls.map((c) => String(c[0]))).toContain('content.knowledge_graph.unresolved');
  });
});

/* ── STEP 10 — failure containment ─────────────────────────────────────── */

describe('B7.2 · a graph failure never fails content acceptance', () => {
  beforeEach(() => mockEnabled.mockReturnValue(true));

  it('resolver throws ⇒ content is still accepted', async () => {
    mockResolve.mockRejectedValue(new Error('resolver exploded'));
    const out = await createContent(req());
    expect(out.id).toBe('content-1');
  });

  it('resolver throws ⇒ the failure is OBSERVABLE, not swallowed', async () => {
    mockResolve.mockRejectedValue(new Error('resolver exploded'));
    await createContent(req());
    expect(mockCounter.mock.calls.map((c) => String(c[0]))).toContain('content.knowledge_graph.error');
  });

  it('coverage write fails ⇒ content still accepted, failure observable', async () => {
    mockRecordCoverage.mockResolvedValue({ ok: false, reason: 'insert_failed:timeout' });
    const out = await createContent(req());
    expect(out.id).toBe('content-1');
    expect(mockCounter.mock.calls.map((c) => String(c[0]))).toContain('content.knowledge_graph.coverage_failed');
  });

  it('coverage throws ⇒ contained', async () => {
    mockRecordCoverage.mockRejectedValue(new Error('db timeout'));
    await expect(createContent(req())).resolves.toMatchObject({ id: 'content-1' });
  });

  it('resolution error state ⇒ no coverage, acceptance unaffected', async () => {
    mockResolve.mockResolvedValue({ kind: 'error', topicId: null, normalizedLabel: 'x', state: 'unknown', confidence: 'none', reason: 'lookup_failed:timeout' });
    const out = await createContent(req());
    expect(out.id).toBe('content-1');
    expect(mockRecordCoverage).not.toHaveBeenCalled();
  });
});

/* ── STEP 7 — independence from the existing pipeline ──────────────────── */

describe('B7.2 · does not alter existing content behaviour', () => {
  it('the canonical persistence policy still gates the write with the flag ON', async () => {
    mockEnabled.mockReturnValue(true);
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'false';
    await expect(createContent(req())).rejects.toThrow();
    // Denied before persistence ⇒ the graph is never reached either.
    expect(mockResolve).not.toHaveBeenCalled();
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  });

  it('the returned artifact shape is identical with the flag ON and OFF', async () => {
    mockEnabled.mockReturnValue(false);
    const off = await createContent(req({ campaignId: CAMPAIGN }));
    installSupabase();
    mockEnabled.mockReturnValue(true);
    const on = await createContent(req({ campaignId: CAMPAIGN }));
    expect(Object.keys(on).sort()).toEqual(Object.keys(off).sort());
    expect(on.campaignId).toBe(off.campaignId);
    expect(on.contentType).toBe(off.contentType);
  });
});
