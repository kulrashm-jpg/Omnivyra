/**
 * B7.8-C.4 — platform topic embedding admin route.
 *
 * The decisive assertions are negative: the route delegates to exactly one
 * function, and imports no OpenAI client, no ledger and no database client —
 * so it structurally cannot bypass the trigger.
 */

const mockRequireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => mockRequireCapability(...a),
}));

const mockRequestTopicEmbedding = jest.fn();
jest.mock('../../services/content/knowledgeGraph/topicEmbeddingTrigger', () => ({
  requestTopicEmbedding: (...a: unknown[]) => mockRequestTopicEmbedding(...a),
}));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import * as fs from 'fs';
import * as path from 'path';
import handler from '../../../pages/api/admin/knowledge-graph/embed-topic';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '../../../shared/contracts/security';

const TOPIC = 'aaaaaaaa-0000-4000-8000-00000000000a';

const mkRes = () => {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn(() => res as never);
  res.json = jest.fn(() => res as never);
  res.setHeader = jest.fn(() => res as never);
  return res;
};

const post = (body: Record<string, unknown>) => ({ method: 'POST', body, query: {} });

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireCapability.mockResolvedValue({ ok: true, principal: { userId: 'op-1' } });
  mockRequestTopicEmbedding.mockResolvedValue({ ok: true, status: 'accepted' });
});

/* ── 1-3: authorization ────────────────────────────────────────────────── */

describe('B7.8-C.4 · authorization', () => {
  it('1. an authorized operator is accepted', async () => {
    const res = mkRes();
    await handler(post({ topicId: TOPIC }) as never, res as never);
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('2/3. unauthorized (incl. company-scoped) is rejected BEFORE the trigger runs', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler(post({ topicId: TOPIC }) as never, res as never);
    expect(mockRequestTopicEmbedding).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(202);
  });

  it('uses the existing platform-tier capability — no new role or permission', async () => {
    const res = mkRes();
    await handler(post({ topicId: TOPIC }) as never, res as never);
    expect(mockRequireCapability.mock.calls[0][2]).toMatchObject({ capability: INTELLIGENCE_OVERRIDE_MANAGE });
    expect(INTELLIGENCE_OVERRIDE_MANAGE).toBe('intelligence.override.manage');
  });

  it('authorization precedes validation — an unauthorized bad request still 401/403s', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler(post({}) as never, res as never);
    expect(res.status).not.toHaveBeenCalledWith(400);   // guard responded first
  });
});

/* ── 4-5: input validation ─────────────────────────────────────────────── */

describe('B7.8-C.4 · input validation', () => {
  it('4. a missing or empty topicId is rejected without reaching the trigger', async () => {
    for (const body of [{}, { topicId: '' }, { topicId: '   ' }, { topicId: null }]) {
      jest.clearAllMocks();
      mockRequireCapability.mockResolvedValue({ ok: true, principal: {} });
      const res = mkRes();
      await handler(post(body) as never, res as never);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRequestTopicEmbedding).not.toHaveBeenCalled();
    }
  });

  it('5. a malformed topicId is rejected before any DB query', async () => {
    for (const bad of ['not-a-uuid', '12345', 'aaaaaaaa-0000-0000-0000-00000000000a', '<script>']) {
      jest.clearAllMocks();
      mockRequireCapability.mockResolvedValue({ ok: true, principal: {} });
      const res = mkRes();
      await handler(post({ topicId: bad }) as never, res as never);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockRequestTopicEmbedding).not.toHaveBeenCalled();
    }
  });

  it('rejects non-POST before the guard', async () => {
    const res = mkRes();
    await handler({ method: 'GET', body: {}, query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockRequireCapability).not.toHaveBeenCalled();
  });
});

/* ── 6-10: response contract ───────────────────────────────────────────── */

describe('B7.8-C.4 · response contract', () => {
  it.each([
    ['not_found', 404, false],
    ['disabled', 503, false],
    ['already_embedded', 200, true],
    ['in_flight', 202, true],
    ['accepted', 202, true],
    ['error', 500, false],
  ])('%s → HTTP %i', async (status, code, ok) => {
    mockRequestTopicEmbedding.mockResolvedValue({ ok, status });
    const res = mkRes();
    await handler(post({ topicId: TOPIC }) as never, res as never);
    expect(res.status).toHaveBeenCalledWith(code);
    expect(res.json.mock.calls[0][0].status).toBe(status);
  });

  it('10. an accepted response does NOT claim a completed embedding', async () => {
    const res = mkRes();
    await handler(post({ topicId: TOPIC }) as never, res as never);
    const body = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(202);          // not 200
    expect(body.status).toBe('accepted');
    expect(body.note).toMatch(/asynchronous/i);
    expect(body).not.toHaveProperty('embedding');
  });

  it('only already_embedded asserts a completed state (200)', async () => {
    mockRequestTopicEmbedding.mockResolvedValue({ ok: true, status: 'already_embedded' });
    const res = mkRes();
    await handler(post({ topicId: TOPIC }) as never, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].note).toBeUndefined();
  });
});

/* ── 11-17: delegation and blast radius ────────────────────────────────── */

describe('B7.8-C.4 · delegation', () => {
  it('11. the trigger is called with ONLY the topicId', async () => {
    const res = mkRes();
    await handler(post({ topicId: TOPIC }) as never, res as never);
    expect(mockRequestTopicEmbedding).toHaveBeenCalledTimes(1);
    expect(mockRequestTopicEmbedding.mock.calls[0]).toEqual([TOPIC]);
  });

  it('15/16. arbitrary provider text and tenant identifiers are ignored entirely', async () => {
    const res = mkRes();
    await handler(post({
      topicId: TOPIC,
      text: 'inject me into the provider',
      model: 'gpt-4o', provider: 'evil', cost: 999,
      companyId: 'c1', organizationId: 'o1', userId: 'u1',
    }) as never, res as never);
    // Still exactly one argument — nothing from the body rides along.
    expect(mockRequestTopicEmbedding.mock.calls[0]).toEqual([TOPIC]);
  });

  it('17. a contained trigger failure is surfaced, not thrown', async () => {
    mockRequestTopicEmbedding.mockResolvedValue({ ok: false, status: 'error', reason: 'boom' });
    const res = mkRes();
    await expect(handler(post({ topicId: TOPIC }) as never, res as never)).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

/* ── 12-14: structural proof the route cannot bypass the trigger ───────── */

describe('B7.8-C.4 · the route is a pure delegator (source proof)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../pages/api/admin/knowledge-graph/embed-topic.ts'), 'utf8',
  );
  const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*')).join('\n');

  it('12. imports no OpenAI client', () => {
    expect(code).not.toMatch(/from ['"]openai['"]/);
    expect(code).not.toMatch(/signalEmbeddingService/);
  });

  it('13. imports no ledger', () => {
    expect(code).not.toMatch(/platformUsageLedgerService|usageLedgerService|recordPlatformUsage|logUsageEvent/);
  });

  it('14. imports no database client — it cannot write any table', () => {
    expect(code).not.toMatch(/supabaseClient|ownedDbTable|from\(['"`]/);
    for (const t of ['platform_topic_node', 'company_topic_coverage', 'platform_usage_events', 'usage_events']) {
      expect(code).not.toContain(t);
    }
  });

  it('imports exactly the route factory, the guard, the capability and the trigger', () => {
    const imports = (code.match(/^import .*$/gm) ?? []).join('\n');
    expect(imports).toMatch(/routeFactory/);
    expect(imports).toMatch(/requireCapability/);
    expect(imports).toMatch(/INTELLIGENCE_OVERRIDE_MANAGE/);
    expect(imports).toMatch(/topicEmbeddingTrigger/);
    // Nothing else that could reach a provider, ledger or table.
    expect(imports.split('\n').filter((l) => l.trim()).length).toBeLessThanOrEqual(5);
  });

  it('never references canonical_topic_id, parent_topic_id or coverage', () => {
    for (const f of ['canonical_topic_id', 'parent_topic_id', 'canonicalTopicId', 'parentTopicId', 'angle_label', 'coverage']) {
      expect(code).not.toContain(f);
    }
  });
});
