/**
 * B7.9 — operator topic authoring (service + route).
 *
 * The decisive assertions are negative: creating a topic reaches no provider,
 * writes no ledger row, touches no customer billing, creates no canonical
 * relationship, and synthesises no angle_label.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

const mockRequireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => mockRequireCapability(...a),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../../db/supabaseClient';
import {
  createOperatorTopic,
  renameOperatorTopic,
  MAX_LABEL_LENGTH,
} from '../../services/content/knowledgeGraph/topicCurationService';
import { normalizeTopicLabel } from '../../services/content/knowledgeGraph/topicResolutionService';
import handler from '../../../pages/api/admin/knowledge-graph/topic';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '../../../shared/contracts/security';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

/** Every table touched and every write, so the boundary is provable. */
let touched: string[];
let writes: Array<{ op: string; payload?: unknown; filters: string[] }>;

const TOPIC = 'aaaaaaaa-0000-4000-8000-00000000000a';

/**
 * Table mock. `existing` is the row returned by a normalized_label lookup
 * (null = unseen); `byId` is the row returned by an id lookup.
 */
function install(opts: {
  existing?: Record<string, unknown> | null;
  byId?: Record<string, unknown> | null;
  insertResult?: { data?: unknown; error?: unknown };
  updateError?: unknown;
} = {}) {
  touched = []; writes = [];
  mockFrom.mockImplementation(((table: string) => {
    touched.push(table);
    const filters: string[] = [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (c: string, v: unknown) => { filters.push('eq:' + c + '=' + String(v)); return chain; };
    chain.is = (c: string, v: unknown) => { filters.push('is:' + c + '=' + String(v)); return chain; };
    chain.maybeSingle = () => {
      const byId = filters.some((f) => f.startsWith('eq:id='));
      return Promise.resolve({ data: byId ? (opts.byId ?? null) : (opts.existing ?? null), error: null });
    };
    chain.insert = (payload: unknown) => {
      writes.push({ op: 'insert', payload, filters: [...filters] });
      const r = opts.insertResult ?? { data: { id: TOPIC }, error: null };
      const ins: Record<string, unknown> = {};
      ins.select = () => ins;
      ins.maybeSingle = () => Promise.resolve(r);
      return ins;
    };
    chain.update = (payload: unknown) => {
      const u: Record<string, unknown> = {};
      const ufilters: string[] = [];
      const settle = () => Promise.resolve({ error: opts.updateError ?? null });
      u.eq = (c: string, v: unknown) => { ufilters.push('eq:' + c + '=' + String(v)); return u; };
      u.is = (c: string, v: unknown) => { ufilters.push('is:' + c + '=' + String(v)); return u; };
      u.then = (res: (v: unknown) => unknown) => settle().then(res);
      writes.push({ op: 'update', payload, filters: ufilters });
      return u;
    };
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
  install();
  mockRequireCapability.mockResolvedValue({ ok: true, principal: { userId: 'op-1' } });
});

/* ── authorization ─────────────────────────────────────────────────────── */

describe('B7.9 · authorization', () => {
  it('an authorized operator can create', async () => {
    const res = mkRes();
    await handler({ method: 'POST', body: { label: 'AI Lead Qualification' }, query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('an unauthorized principal is rejected BEFORE any mutation', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler({ method: 'POST', body: { label: 'x' }, query: {} } as never, res as never);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  it('uses the existing platform-tier capability — no new capability', async () => {
    const res = mkRes();
    await handler({ method: 'POST', body: { label: 'x' }, query: {} } as never, res as never);
    expect(mockRequireCapability.mock.calls[0][2]).toMatchObject({ capability: INTELLIGENCE_OVERRIDE_MANAGE });
    expect(INTELLIGENCE_OVERRIDE_MANAGE).toBe('intelligence.override.manage');
  });

  it('authorization precedes validation — an unauthorized bad body still 401/403s', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler({ method: 'POST', body: {}, query: {} } as never, res as never);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  it('rejects unsupported methods before the guard', async () => {
    const res = mkRes();
    await handler({ method: 'DELETE', body: {}, query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockRequireCapability).not.toHaveBeenCalled();
  });
});

/* ── create semantics ──────────────────────────────────────────────────── */

describe('B7.9 · create', () => {
  it('creates exactly one row with the certified defaults', async () => {
    const out = await createOperatorTopic('AI Lead Qualification');
    expect(out).toMatchObject({ ok: true, action: 'created', topicId: TOPIC });

    const inserts = writes.filter((w) => w.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toEqual({
      canonical_label: 'AI Lead Qualification',
      normalized_label: 'ai lead qualification',
      state: 'observed',
      confidence: 'low',
      source: 'operator',
    });
  });

  it('never sets embedding, canonical_topic_id or parent_topic_id', async () => {
    await createOperatorTopic('AI Lead Qualification');
    const payload = writes.find((w) => w.op === 'insert')!.payload as Record<string, unknown>;
    for (const forbidden of ['embedding', 'embedding_model', 'embedding_version', 'canonical_topic_id', 'parent_topic_id', 'angle_label']) {
      expect(Object.prototype.hasOwnProperty.call(payload, forbidden)).toBe(false);
    }
  });

  it('touches only platform_topic_node', async () => {
    await createOperatorTopic('AI Lead Qualification');
    expect([...new Set(touched)]).toEqual(['platform_topic_node']);
  });

  it('route returns 201 with the created identity', async () => {
    const res = mkRes();
    await handler({ method: 'POST', body: { label: 'AI Lead Qualification' }, query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({ action: 'created', normalizedLabel: 'ai lead qualification' });
  });

  it('ignores every field except label', async () => {
    const res = mkRes();
    await handler({
      method: 'POST',
      body: {
        label: 'AI Lead Qualification',
        embedding: [1, 2, 3], canonicalTopicId: 'x', parentTopicId: 'y', angle_label: 'z',
        companyId: 'c1', organizationId: 'o1', campaignId: 'k1', contentId: 'n1',
        provider: 'openai', model: 'gpt-4o', state: 'confirmed', confidence: 'high',
      },
      query: {},
    } as never, res as never);
    const payload = writes.find((w) => w.op === 'insert')!.payload as Record<string, unknown>;
    expect(payload).toEqual({
      canonical_label: 'AI Lead Qualification',
      normalized_label: 'ai lead qualification',
      state: 'observed',            // NOT the caller-supplied 'confirmed'
      confidence: 'low',            // NOT the caller-supplied 'high'
      source: 'operator',
    });
  });
});

/* ── normalization + collisions ────────────────────────────────────────── */

describe('B7.9 · normalization and collision', () => {
  it('reuses the existing helper — normalization cannot diverge', async () => {
    await createOperatorTopic('  AI   Lead   Qualification  ');
    const payload = writes.find((w) => w.op === 'insert')!.payload as Record<string, unknown>;
    expect(payload.normalized_label).toBe(normalizeTopicLabel('  AI   Lead   Qualification  '));
    expect(payload.normalized_label).toBe('ai lead qualification');
  });

  it('an existing normalized identity is a CONFLICT, not a silent success', async () => {
    install({ existing: { id: 'existing-1', canonical_topic_id: null, parent_topic_id: null, state: 'observed', confidence: 'low' } });
    const out = await createOperatorTopic('AI Lead Qualification');
    expect(out).toMatchObject({ ok: false, reason: 'already_exists', topicId: 'existing-1' });
    expect(writes.filter((w) => w.op === 'insert')).toEqual([]);   // nothing written
  });

  it('case and whitespace variants collide with the same identity', async () => {
    install({ existing: { id: 'existing-1', canonical_topic_id: null, parent_topic_id: null } });
    for (const variant of ['ai lead qualification', 'AI LEAD QUALIFICATION', '  AI  Lead  Qualification ']) {
      const out = await createOperatorTopic(variant);
      expect(out).toMatchObject({ ok: false, reason: 'already_exists' });
    }
  });

  it('a concurrent duplicate cannot create two identities', async () => {
    /**
     * Models the real race: the label is unseen at lookup, our INSERT loses to
     * a peer on UNIQUE(normalized_label), and the re-read then finds the
     * winner's row. Only one identity can exist, and we adopt it.
     */
    touched = []; writes = [];
    let lookups = 0;
    mockFrom.mockImplementation(((table: string) => {
      touched.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => {
        lookups += 1;
        // 1st lookup: unseen. 2nd (post-race re-read): the winner's row.
        return Promise.resolve({
          data: lookups === 1 ? null : { id: 'winner-1', canonical_topic_id: null, parent_topic_id: null },
          error: null,
        });
      };
      chain.insert = (payload: unknown) => {
        writes.push({ op: 'insert', payload, filters: [] });
        const ins: Record<string, unknown> = {};
        ins.select = () => ins;
        ins.maybeSingle = () => Promise.resolve({
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        });
        return ins;
      };
      return chain as never;
    }) as never);

    const out = await createOperatorTopic('AI Lead Qualification');
    expect(out).toMatchObject({ ok: false, reason: 'already_exists', topicId: 'winner-1' });
    expect(writes.filter((w) => w.op === 'insert')).toHaveLength(1);   // exactly one attempt
  });

  it('route maps a collision to 409 and returns the existing topicId', async () => {
    install({ existing: { id: 'existing-1', canonical_topic_id: null, parent_topic_id: null } });
    const res = mkRes();
    await handler({ method: 'POST', body: { label: 'AI Lead Qualification' }, query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({ error: 'already_exists', topicId: 'existing-1' });
  });
});

/* ── validation ────────────────────────────────────────────────────────── */

describe('B7.9 · validation', () => {
  it('rejects empty, whitespace-only and non-string labels without writing', async () => {
    for (const bad of ['', '   ', '\t\n', null, undefined, 42, {}]) {
      install();
      const out = await createOperatorTopic(bad as unknown);
      expect(out).toMatchObject({ ok: false, reason: 'missing_label' });
      expect(writes).toEqual([]);
    }
  });

  it('rejects an oversized label', async () => {
    const out = await createOperatorTopic('x'.repeat(MAX_LABEL_LENGTH + 1));
    expect(out).toMatchObject({ ok: false, reason: 'label_too_long' });
    expect(writes.filter((w) => w.op === 'insert')).toEqual([]);
  });

  it('accepts a label at exactly the limit', async () => {
    const out = await createOperatorTopic('x'.repeat(MAX_LABEL_LENGTH));
    expect(out).toMatchObject({ ok: true, action: 'created' });
  });

  it('route maps validation failures to 400', async () => {
    const res = mkRes();
    await handler({ method: 'POST', body: { label: '   ' }, query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

/* ── rename ────────────────────────────────────────────────────────────── */

describe('B7.9 · rename', () => {
  const inert = { id: TOPIC, canonical_topic_id: null, normalized_label: 'old label', embedding: null };

  it('renames an inert topic and recomputes the identity key', async () => {
    install({ byId: inert });
    const out = await renameOperatorTopic(TOPIC, 'New Label');
    expect(out).toMatchObject({ ok: true, action: 'renamed', normalizedLabel: 'new label' });
    const upd = writes.find((w) => w.op === 'update')!;
    expect(upd.payload).toEqual({ canonical_label: 'New Label', normalized_label: 'new label' });
  });

  it('re-asserts both preconditions in the WHERE clause (no lost update)', async () => {
    install({ byId: inert });
    await renameOperatorTopic(TOPIC, 'New Label');
    const upd = writes.find((w) => w.op === 'update')!;
    expect(upd.filters).toContain('is:canonical_topic_id=null');
    expect(upd.filters).toContain('is:embedding=null');
  });

  it('refuses a topic that is already an alias', async () => {
    install({ byId: { ...inert, canonical_topic_id: 'canon-1' } });
    const out = await renameOperatorTopic(TOPIC, 'New Label');
    expect(out).toMatchObject({ ok: false, reason: 'topic_is_alias' });
    expect(writes.filter((w) => w.op === 'update')).toEqual([]);
  });

  it('refuses a topic that has an embedding', async () => {
    install({ byId: { ...inert, embedding: '[0.1,0.2]' } });
    const out = await renameOperatorTopic(TOPIC, 'New Label');
    expect(out).toMatchObject({ ok: false, reason: 'topic_is_embedded' });
    expect(writes.filter((w) => w.op === 'update')).toEqual([]);
  });

  it('a normalized collision is rejected via the unique index', async () => {
    install({ byId: inert, updateError: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const out = await renameOperatorTopic(TOPIC, 'Other Label');
    expect(out).toMatchObject({ ok: false, reason: 'already_exists' });
  });

  it('an unknown topic is not found', async () => {
    install({ byId: null });
    expect(await renameOperatorTopic(TOPIC, 'New Label')).toMatchObject({ ok: false, reason: 'topic_not_found' });
  });

  it('the same identity key updates only the display label', async () => {
    install({ byId: { ...inert, normalized_label: 'new label' } });
    const out = await renameOperatorTopic(TOPIC, 'New  Label');
    expect(out).toMatchObject({ ok: true, action: 'unchanged' });
    expect((writes.find((w) => w.op === 'update')!.payload as Record<string, unknown>).normalized_label).toBeUndefined();
  });

  it('never writes embedding, canonical or hierarchy fields', async () => {
    install({ byId: inert });
    await renameOperatorTopic(TOPIC, 'New Label');
    const payload = writes.find((w) => w.op === 'update')!.payload as Record<string, unknown>;
    for (const forbidden of ['embedding', 'embedding_model', 'embedding_version', 'canonical_topic_id', 'parent_topic_id', 'angle_label']) {
      expect(Object.prototype.hasOwnProperty.call(payload, forbidden)).toBe(false);
    }
  });

  it('route maps rename refusals to 409 and 404', async () => {
    install({ byId: { ...inert, embedding: '[0.1]' } });
    const r1 = mkRes();
    await handler({ method: 'PATCH', body: { topicId: TOPIC, label: 'x' }, query: {} } as never, r1 as never);
    expect(r1.status).toHaveBeenCalledWith(409);

    install({ byId: null });
    const r2 = mkRes();
    await handler({ method: 'PATCH', body: { topicId: TOPIC, label: 'x' }, query: {} } as never, r2 as never);
    expect(r2.status).toHaveBeenCalledWith(404);
  });
});

/* ── boundary proof ────────────────────────────────────────────────────── */

describe('B7.9 · boundaries (source proof)', () => {
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../../pages/api/admin/knowledge-graph/topic.ts'), 'utf8',
  );
  const code = routeSrc.split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n');

  it('the route has no database client and names no table', () => {
    expect(code).not.toMatch(/supabaseClient|ownedDbTable/);
    for (const t of ['platform_topic_node', 'platform_usage_events', 'usage_events', 'unified_transactions', 'company_topic_coverage']) {
      expect(code).not.toContain(t);
    }
  });

  it('the route reaches no provider, ledger, billing or content integration', () => {
    expect(code).not.toMatch(/openai|signalEmbeddingService|platformUsageLedgerService|logUsageEvent|contentService|canonicalPersistencePolicy|platformNoveltyService|campaignUniquenessGuard/i);
  });

  it('creating a topic writes no ledger row and no billing row', async () => {
    await createOperatorTopic('AI Lead Qualification');
    for (const t of ['platform_usage_events', 'usage_events', 'unified_transactions', 'company_topic_coverage']) {
      expect(touched).not.toContain(t);
    }
  });

  it('creating a topic makes no provider call', async () => {
    const realFetch = globalThis.fetch;
    const spy = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = spy;
    try {
      await createOperatorTopic('AI Lead Qualification');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  });

  it('angle_label is never referenced by the authoring path', () => {
    const svc = fs.readFileSync(
      path.resolve(__dirname, '../../services/content/knowledgeGraph/topicCurationService.ts'), 'utf8',
    );
    const authoring = svc.slice(svc.indexOf('B7.9 — OPERATOR TOPIC AUTHORING'));
    const authoringCode = authoring.split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
      .join('\n');
    expect(authoringCode).not.toContain('angle_label');
    expect(authoringCode).not.toMatch(/company_topic_coverage/);
  });
});
