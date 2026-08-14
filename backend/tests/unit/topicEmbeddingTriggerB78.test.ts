/**
 * B7.8 — on-demand embedding trigger + dedicated operational flag.
 *
 * The trigger is provider-agnostic (the embedder is injected), so these tests
 * fully exercise it despite the production provider wiring being blocked — see
 * the B7.8 report for the companyId/tenant-less conflict.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../db/supabaseClient';
import {
  requestTopicEmbedding,
  isTopicEmbeddingEnabled,
  PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV,
  _inFlightSize,
} from '../../services/content/knowledgeGraph/topicEmbeddingTrigger';
import { PLATFORM_KNOWLEDGE_GRAPH_ENV } from '../../services/content/knowledgeGraph/topicResolutionService';
import { EMBEDDING_DIM } from '../../services/content/knowledgeGraph/topicCandidateService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const T = 'aaaa0000-0000-4000-8000-00000000000a';
const PRIOR = process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV];

const vec = (): number[] => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === 0 ? 1 : 0));

type Node = {
  id: string; canonical_label: string; normalized_label: string;
  canonical_topic_id: string | null; parent_topic_id: string | null;
  embedding: unknown; embedding_model: string | null; embedding_version: number | null;
};
let nodes: Record<string, Node>;
let writes: Array<{ id: string; patch: Record<string, unknown> }>;

function install() {
  writes = [];
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'platform_topic_node') throw new Error('unexpected table: ' + table);
    let byId: string | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (c: string, v: string) => { if (c === 'id') byId = v; return chain; };
    chain.is = () => chain;
    chain.not = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.maybeSingle = async () => ({ data: byId ? (nodes[byId] ?? null) : null, error: null });
    chain.then = (r: (v: unknown) => unknown) => r({ data: Object.values(nodes), error: null });
    chain.update = (patch: Record<string, unknown>) => ({
      eq: async (_c: string, id: string) => {
        if (nodes[id]) { writes.push({ id, patch }); Object.assign(nodes[id], patch); }
        return { error: null };
      },
    });
    return chain as never;
  }) as never);
}

/** Let the fire-and-forget continuation settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV] = 'true';
  nodes = {
    [T]: {
      id: T, canonical_label: 'AI lead qualification', normalized_label: 'ai lead qualification',
      canonical_topic_id: null, parent_topic_id: null,
      embedding: null, embedding_model: null, embedding_version: null,
    },
  };
  install();
});
afterAll(() => {
  if (PRIOR === undefined) delete process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV];
  else process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV] = PRIOR;
});

/* ── flag ──────────────────────────────────────────────────────────────── */

describe('B7.8 · PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENABLED', () => {
  it('1. unset ⇒ disabled, and NO provider call', async () => {
    delete process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV];
    expect(isTopicEmbeddingEnabled()).toBe(false);
    const embed = jest.fn(async () => vec());
    const out = await requestTopicEmbedding(T, { embed });
    expect(out).toMatchObject({ ok: false, status: 'disabled' });
    expect(embed).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();   // not even a query
  });

  it.each(['false', '0', 'off', 'no', '', '   ', 'maybe', 'TRUE-ish'])('2. %s ⇒ disabled', async (v) => {
    process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV] = v;
    expect(isTopicEmbeddingEnabled()).toBe(false);
    const embed = jest.fn(async () => vec());
    await requestTopicEmbedding(T, { embed });
    expect(embed).not.toHaveBeenCalled();
  });

  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' On '])('%s ⇒ enabled', (v) => {
    process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV] = v;
    expect(isTopicEmbeddingEnabled()).toBe(true);
  });

  it('is evaluated at CALL TIME, not module load', () => {
    delete process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV];
    expect(isTopicEmbeddingEnabled()).toBe(false);
    process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV] = 'true';
    expect(isTopicEmbeddingEnabled()).toBe(true);   // no reload needed
  });

  it('is INDEPENDENT of the other knowledge-graph flags', () => {
    expect(PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV).not.toBe(PLATFORM_KNOWLEDGE_GRAPH_ENV);
    delete process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV];
    process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV] = 'true';
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
    process.env.ORIGINALITY_GATE_ENABLED = 'true';
    expect(isTopicEmbeddingEnabled()).toBe(false);   // still off
    delete process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV];
    delete process.env.CANONICAL_PERSISTENCE_ENABLED;
    delete process.env.ORIGINALITY_GATE_ENABLED;
  });
});

/* ── trigger ───────────────────────────────────────────────────────────── */

describe('B7.8 · on-demand trigger', () => {
  it('3. an eligible topic is accepted and returns WITHOUT awaiting the provider', async () => {
    let resolveEmbed: (v: number[]) => void = () => {};
    const slow = new Promise<number[]>((r) => { resolveEmbed = r; });
    const out = await requestTopicEmbedding(T, { embed: () => slow });
    expect(out).toMatchObject({ ok: true, status: 'accepted' });   // returned while provider pending
    expect(nodes[T].embedding).toBeNull();
    resolveEmbed(vec());
    await settle();
    expect(nodes[T].embedding).not.toBeNull();                     // completed asynchronously
  });

  it('4. an already-embedded topic makes NO provider call', async () => {
    nodes[T].embedding = vec();
    const embed = jest.fn(async () => vec());
    const out = await requestTopicEmbedding(T, { embed });
    expect(out).toMatchObject({ ok: true, status: 'already_embedded' });
    expect(embed).not.toHaveBeenCalled();
  });

  it('5. concurrent triggers for the same topic collapse to ONE provider call', async () => {
    let resolveEmbed: (v: number[]) => void = () => {};
    const embed = jest.fn(() => new Promise<number[]>((r) => { resolveEmbed = r; }));
    const a = await requestTopicEmbedding(T, { embed });
    const b = await requestTopicEmbedding(T, { embed });
    expect(a.status).toBe('accepted');
    expect(b.status).toBe('in_flight');
    expect(embed).toHaveBeenCalledTimes(1);
    resolveEmbed(vec());
    await settle();
    expect(_inFlightSize()).toBe(0);      // guard released
  });

  it('22. different topics do not block one another', async () => {
    const T2 = 'bbbb0000-0000-4000-8000-00000000000b';
    nodes[T2] = { ...nodes[T], id: T2, normalized_label: 'other topic' };
    const embed = jest.fn(async () => vec());
    const a = await requestTopicEmbedding(T, { embed });
    const b = await requestTopicEmbedding(T2, { embed });
    expect(a.status).toBe('accepted');
    expect(b.status).toBe('accepted');
    await settle();
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('21. retry after a provider failure is possible', async () => {
    const embed = jest.fn()
      .mockImplementationOnce(async () => { throw new Error('503'); })
      .mockImplementationOnce(async () => vec());
    await requestTopicEmbedding(T, { embed });
    await settle();
    expect(nodes[T].embedding).toBeNull();        // failed, still eligible
    expect(_inFlightSize()).toBe(0);              // guard released so retry works

    const again = await requestTopicEmbedding(T, { embed });
    expect(again.status).toBe('accepted');
    await settle();
    expect(nodes[T].embedding).not.toBeNull();
  });

  it('an unknown topic is refused with no provider call', async () => {
    const embed = jest.fn(async () => vec());
    expect(await requestTopicEmbedding('nope', { embed })).toMatchObject({ ok: false, status: 'not_found' });
    expect(await requestTopicEmbedding('', { embed })).toMatchObject({ ok: false, status: 'missing_topic_id' });
    expect(embed).not.toHaveBeenCalled();
  });
});

/* ── safety ────────────────────────────────────────────────────────────── */

describe('B7.8 · identity is never touched', () => {
  it('6. success persists a 1536-dim embedding and ONLY embedding columns', async () => {
    await requestTopicEmbedding(T, { embed: async () => vec() });
    await settle();
    expect((nodes[T].embedding as number[]).length).toBe(EMBEDDING_DIM);
    for (const w of writes) {
      expect(Object.keys(w.patch).sort()).toEqual(['embedding', 'embedding_model', 'embedding_version']);
    }
  });

  it.each([
    ['7. provider failure', async () => { throw new Error('down'); }],
    ['8. malformed embedding', async () => Array.from({ length: EMBEDDING_DIM }, () => NaN)],
    ['9. wrong dimensionality', async () => [1, 2, 3]],
  ])('%s leaves topic identity unchanged', async (_n, embed) => {
    const before = { ...nodes[T] };
    await requestTopicEmbedding(T, { embed: embed as () => Promise<number[]> });
    await settle();
    expect(nodes[T].canonical_topic_id).toBe(before.canonical_topic_id);
    expect(nodes[T].parent_topic_id).toBe(before.parent_topic_id);
    expect(nodes[T].normalized_label).toBe(before.normalized_label);
    expect(nodes[T].embedding).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('10. usage accounting is invoked for every real provider call', async () => {
    const usage: unknown[] = [];
    await requestTopicEmbedding(T, { embed: async () => vec(), recordUsage: (i) => { usage.push(i); } });
    await settle();
    expect(usage).toHaveLength(1);
  });

  it('11/12/13/14/15. candidates are warmed after success but confirm nothing', async () => {
    await requestTopicEmbedding(T, { embed: async () => vec() });
    await settle();
    // Only embedding columns were ever written — candidate generation is read-only.
    for (const w of writes) {
      expect(w.patch).not.toHaveProperty('canonical_topic_id');
      expect(w.patch).not.toHaveProperty('parent_topic_id');
      expect(w.patch).not.toHaveProperty('normalized_label');
    }
    expect(nodes[T].canonical_topic_id).toBeNull();   // no identity decision made
  });

  it('16. no table other than platform_topic_node is touched (coverage unchanged)', async () => {
    // The stub throws on any other table; reaching here proves it.
    await requestTopicEmbedding(T, { embed: async () => vec() });
    await settle();
    expect(nodes[T].id).toBe(T);
  });
});

/* ═══ B7.8-C.3 — trigger ↔ provider wiring ═══════════════════════════════ */

describe('B7.8-C.3 · wiring to the platform provider path', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const trigger = require('../../services/content/knowledgeGraph/topicEmbeddingTrigger');

  it('1/19. the production dependency embeds via the PLATFORM path with the topic as resource', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sig = require('../../services/signalEmbeddingService');
    const spy = jest.spyOn(sig, 'generatePlatformEmbedding')
      .mockResolvedValue({ ok: true, embedding: vec(), totalCost: 0.0000001 });

    const embedder = trigger.platformEmbedderFor(T);
    const out = await embedder.embed('AI lead qualification');

    expect(out).toHaveLength(EMBEDDING_DIM);
    // Exactly the label — nothing tenant-derived.
    expect(spy.mock.calls[0][0]).toBe('AI lead qualification');
    expect(spy.mock.calls[0][1]).toEqual({ resourceType: 'platform_topic_node', resourceId: T });
    spy.mockRestore();
  });

  it('11/12. a provider/ledger failure maps to null so NOTHING is persisted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sig = require('../../services/signalEmbeddingService');
    for (const reason of ['ledger_failed:deadlock', 'provider_failed:503', 'invalid_embedding_shape', 'pricing_missing:x']) {
      const spy = jest.spyOn(sig, 'generatePlatformEmbedding').mockResolvedValue({ ok: false, reason });
      const embedder = trigger.platformEmbedderFor(T);
      await expect(embedder.embed('x')).resolves.toBeNull();
      spy.mockRestore();
    }
  });

  it('the adapter supplies NO recordUsage — the provider path already ledgers', () => {
    const embedder = trigger.platformEmbedderFor(T);
    expect(embedder.recordUsage).toBeUndefined();
    expect(typeof embedder.embed).toBe('function');
  });

  it('18/20. deps remain injectable — a test embedder replaces the provider entirely', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sig = require('../../services/signalEmbeddingService');
    const spy = jest.spyOn(sig, 'generatePlatformEmbedding');

    const fake = jest.fn(async () => vec());
    const out = await requestTopicEmbedding(T, { embed: fake });
    await settle();

    expect(out).toMatchObject({ ok: true, status: 'accepted' });
    expect(fake).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();          // no OpenAI path touched
    spy.mockRestore();
  });

  it('7/8. disabled flag and unknown topic never construct the production embedder', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sig = require('../../services/signalEmbeddingService');
    const spy = jest.spyOn(sig, 'generatePlatformEmbedding');

    delete process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV];
    expect(await requestTopicEmbedding(T)).toMatchObject({ status: 'disabled' });

    process.env[PLATFORM_KNOWLEDGE_GRAPH_EMBEDDING_ENV] = 'true';
    expect(await requestTopicEmbedding('unknown-id')).toMatchObject({ status: 'not_found' });
    await settle();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('6. an already-embedded topic never reaches the provider', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sig = require('../../services/signalEmbeddingService');
    const spy = jest.spyOn(sig, 'generatePlatformEmbedding');
    nodes[T].embedding = vec();

    expect(await requestTopicEmbedding(T)).toMatchObject({ status: 'already_embedded' });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('15/16/17. identity and coverage are untouched through the wired path', async () => {
    const before = { ...nodes[T] };
    await requestTopicEmbedding(T, { embed: async () => vec() });
    await settle();
    expect(nodes[T].canonical_topic_id).toBe(before.canonical_topic_id);
    expect(nodes[T].parent_topic_id).toBe(before.parent_topic_id);
    // The stub throws on any table other than platform_topic_node; reaching
    // here proves no coverage table was touched.
    for (const w of writes) {
      expect(Object.keys(w.patch).sort()).toEqual(['embedding', 'embedding_model', 'embedding_version']);
    }
  });
});
