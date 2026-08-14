/**
 * B7.7 — semantic candidate generation (recall only).
 *
 * The decisive assertions are negative: candidate generation NEVER writes
 * identity, and no score is ever treated as a merge decision.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../db/supabaseClient';
import {
  generateTopicEmbedding,
  backfillTopicEmbeddings,
  findTopicCandidates,
  parseEmbedding,
  EMBEDDING_DIM,
  MIN_RETRIEVAL_SIMILARITY,
  MAX_CANDIDATE_LIMIT,
} from '../../services/content/knowledgeGraph/topicCandidateService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

const A = 'aaaa0000-0000-4000-8000-00000000000a';
const B = 'bbbb0000-0000-4000-8000-00000000000b';
const C = 'cccc0000-0000-4000-8000-00000000000c';
const ALIAS = 'dddd0000-0000-4000-8000-00000000000d';

/** Deterministic unit vector: dimension `axis` = 1, rest 0. cos(v(i),v(j)) = 0 for i≠j. */
const unit = (axis: number): number[] => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === axis ? 1 : 0));
/** Blend of two axes — gives a controllable similarity to `unit(a)`. */
const blend = (a: number, b: number, w: number): number[] =>
  Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === a ? w : i === b ? Math.sqrt(1 - w * w) : 0));

type Node = {
  id: string; canonical_label: string; normalized_label: string;
  canonical_topic_id: string | null; embedding: unknown;
  embedding_model: string | null; embedding_version: number | null;
};

let nodes: Record<string, Node>;
let writes: Array<{ id: string; patch: Record<string, unknown> }>;
let writeError: { message: string } | null;
let listFilters: string[];

const node = (id: string, label: string, emb: unknown = null, canonical: string | null = null): Node => ({
  id, canonical_label: label, normalized_label: label.toLowerCase(),
  canonical_topic_id: canonical, embedding: emb,
  embedding_model: emb ? 'text-embedding-3-small' : null, embedding_version: emb ? 1 : null,
});

function install() {
  writes = []; writeError = null; listFilters = [];
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'platform_topic_node') throw new Error('unexpected table: ' + table);
    let byId: string | null = null;
    let onlyIdentities = false;
    let onlyNullEmbedding = false;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (c: string, v: string) => { if (c === 'id') byId = v; return chain; };
    chain.is = (c: string, v: unknown) => {
      if (c === 'canonical_topic_id' && v === null) { onlyIdentities = true; listFilters.push('is:canonical_topic_id'); }
      if (c === 'embedding' && v === null) { onlyNullEmbedding = true; listFilters.push('is:embedding'); }
      return chain;
    };
    chain.not = (c: string) => { listFilters.push('not:' + c); return chain; };
    chain.order = (c: string) => { listFilters.push('order:' + c); return chain; };
    chain.limit = () => chain;
    chain.maybeSingle = async () => ({ data: byId ? (nodes[byId] ?? null) : null, error: null });
    chain.then = (r: (v: unknown) => unknown) => {
      let rows = Object.values(nodes);
      if (onlyIdentities) rows = rows.filter((n) => n.canonical_topic_id === null);
      if (onlyNullEmbedding) rows = rows.filter((n) => n.embedding === null);
      else if (listFilters.includes('not:embedding')) rows = rows.filter((n) => n.embedding !== null);
      return r({ data: rows, error: null });
    };
    chain.update = (patch: Record<string, unknown>) => ({
      eq: async (_c: string, id: string) => {
        if (!writeError && nodes[id]) { writes.push({ id, patch }); Object.assign(nodes[id], patch); }
        return { error: writeError };
      },
    });
    return chain as never;
  }) as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  nodes = {
    [A]: node(A, 'AI lead qualification', unit(0)),
    [B]: node(B, 'AI powered lead qualification', blend(0, 1, 0.95)),   // very close to A
    [C]: node(C, 'Sourdough starter', unit(2)),                          // orthogonal to A
    [ALIAS]: node(ALIAS, 'Alias topic', unit(0), A),                     // already an alias
  };
  install();
});

const okEmbedder = { embed: async () => unit(3) };

/* ── embedding generation ──────────────────────────────────────────────── */

describe('B7.7 · embedding generation', () => {
  it('writes ONLY embedding columns — never identity', async () => {
    nodes[A].embedding = null; nodes[A].embedding_model = null; nodes[A].embedding_version = null;
    const r = await generateTopicEmbedding(A, okEmbedder);
    expect(r).toMatchObject({ ok: true, action: 'embedded' });
    expect(Object.keys(writes[0].patch).sort()).toEqual(['embedding', 'embedding_model', 'embedding_version']);
    for (const w of writes) {
      expect(w.patch).not.toHaveProperty('canonical_topic_id');
      expect(w.patch).not.toHaveProperty('parent_topic_id');
      expect(w.patch).not.toHaveProperty('normalized_label');
      expect(w.patch).not.toHaveProperty('canonical_label');
    }
  });

  it('embeds ONLY the platform-scoped label — no tenant text can reach the provider', async () => {
    nodes[A].embedding = null;
    const seen: string[] = [];
    await generateTopicEmbedding(A, { embed: async (t) => { seen.push(t); return unit(3); } });
    expect(seen).toEqual(['AI lead qualification']);
  });

  it('is idempotent — a re-run makes NO provider call', async () => {
    const embed = jest.fn(async () => unit(3));
    const r = await generateTopicEmbedding(A, { embed });
    expect(r).toMatchObject({ ok: true, action: 'already_embedded' });
    expect(embed).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('records usage for every real provider call', async () => {
    nodes[A].embedding = null;
    const usage: unknown[] = [];
    await generateTopicEmbedding(A, { ...okEmbedder, recordUsage: (i) => { usage.push(i); } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ model: 'text-embedding-3-small', inputs: 1 });
  });

  it.each([
    ['provider returns null', async () => null],
    ['wrong dimensionality', async () => [1, 2, 3]],
    ['malformed values', async () => Array.from({ length: EMBEDDING_DIM }, () => NaN)],
  ])('%s ⇒ rejected, nothing written, embedding stays NULL', async (_n, embed) => {
    nodes[A].embedding = null;
    const r = await generateTopicEmbedding(A, { embed: embed as () => Promise<number[] | null> });
    expect(r).toMatchObject({ ok: false, reason: 'invalid_or_missing_embedding' });
    expect(writes).toHaveLength(0);
    expect(nodes[A].embedding).toBeNull();
  });

  it('a provider throw is contained', async () => {
    nodes[A].embedding = null;
    const r = await generateTopicEmbedding(A, { embed: async () => { throw new Error('502'); } });
    expect(r.ok).toBe(false);
    expect(nodes[A].embedding).toBeNull();
  });

  it('a usage-ledger failure does NOT fail the operation', async () => {
    nodes[A].embedding = null;
    const r = await generateTopicEmbedding(A, {
      ...okEmbedder,
      recordUsage: () => { throw new Error('ledger down'); },
    });
    expect(r).toMatchObject({ ok: true, action: 'embedded' });
  });

  it('a write failure returns a typed error and leaves the topic retryable', async () => {
    nodes[A].embedding = null;
    writeError = { message: 'deadlock' };
    const r = await generateTopicEmbedding(A, okEmbedder);
    expect(r).toMatchObject({ ok: false });
    expect(nodes[A].embedding).toBeNull();
  });

  it('missing id / unknown topic are refused before any provider call', async () => {
    const embed = jest.fn(async () => unit(3));
    expect(await generateTopicEmbedding('', { embed })).toMatchObject({ ok: false, reason: 'missing_topic_id' });
    expect(await generateTopicEmbedding('nope', { embed })).toMatchObject({ ok: false, reason: 'topic_not_found' });
    expect(embed).not.toHaveBeenCalled();
  });
});

/* ── backfill ──────────────────────────────────────────────────────────── */

describe('B7.7 · bounded backfill', () => {
  it('targets embedding IS NULL, is batch-bounded and idempotent', async () => {
    nodes[A].embedding = null; nodes[C].embedding = null;
    const embed = jest.fn(async () => unit(4));
    const first = await backfillTopicEmbeddings({ embed }, { batchSize: 5 });
    expect(first.embedded).toBe(2);
    expect(listFilters).toContain('is:embedding');

    // Re-run: nothing left with a NULL embedding ⇒ no further provider calls.
    embed.mockClear();
    const second = await backfillTopicEmbeddings({ embed }, { batchSize: 5 });
    expect(second.attempted).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it('a per-row failure is counted, not fatal', async () => {
    nodes[A].embedding = null; nodes[C].embedding = null;
    let n = 0;
    const r = await backfillTopicEmbeddings({ embed: async () => (n++ === 0 ? null : unit(4)) });
    expect(r.failed).toBe(1);
    expect(r.embedded).toBe(1);
  });

  it('orders deterministically on the UNIQUE normalized_label', async () => {
    nodes[A].embedding = null;
    await backfillTopicEmbeddings(okEmbedder);
    expect(listFilters).toContain('order:normalized_label');
  });
});

/* ── candidate retrieval ───────────────────────────────────────────────── */

describe('B7.7 · candidate retrieval is RECALL, not classification', () => {
  it('returns nearest identities with score and rank as evidence', async () => {
    const out = await findTopicCandidates(A);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].candidateTopicId).toBe(B);          // closest
    expect(out[0].retrievalRank).toBe(1);
    expect(out[0].similarityScore).toBeGreaterThan(0.9);
    expect(out[0].sourceTopicId).toBe(A);
  });

  it('NEVER writes anything — retrieval is read-only', async () => {
    await findTopicCandidates(A);
    expect(writes).toHaveLength(0);
  });

  it('excludes itself', async () => {
    const out = await findTopicCandidates(A);
    expect(out.map((c) => c.candidateTopicId)).not.toContain(A);
  });

  it('excludes topics that are already aliases — they are not valid merge targets', async () => {
    const out = await findTopicCandidates(A);
    expect(out.map((c) => c.candidateTopicId)).not.toContain(ALIAS);
    expect(listFilters).toContain('is:canonical_topic_id');
  });

  it('excludes an unrelated topic below the retrieval floor', async () => {
    const out = await findTopicCandidates(A);
    // C is orthogonal to A ⇒ cosine 0 ⇒ below the floor.
    expect(out.map((c) => c.candidateTopicId)).not.toContain(C);
  });

  it('the retrieval floor sits BELOW the measured C-range minimum (0.6498)', () => {
    // Guards against the floor silently becoming an identity threshold that
    // would exclude true semantic equivalents.
    expect(MIN_RETRIEVAL_SIMILARITY).toBeLessThan(0.6498);
  });

  it('never compares across embedding generations', async () => {
    nodes[B].embedding_model = 'text-embedding-3-large';   // different generation
    const out = await findTopicCandidates(A);
    expect(out.map((c) => c.candidateTopicId)).not.toContain(B);
  });

  it('an unembedded source yields no candidates and no error', async () => {
    nodes[A].embedding = null;
    await expect(findTopicCandidates(A)).resolves.toEqual([]);
  });

  it('ordering is deterministic and stable across runs', async () => {
    const a = await findTopicCandidates(A);
    const b = await findTopicCandidates(A);
    expect(a.map((c) => c.candidateTopicId)).toEqual(b.map((c) => c.candidateTopicId));
    expect(a.map((c) => c.similarityScore)).toEqual(b.map((c) => c.similarityScore));
  });

  it('result count is bounded', async () => {
    for (let i = 0; i < 40; i += 1) {
      const id = 'x'.repeat(8) + i;
      nodes[id] = node(id, 'topic ' + i, blend(0, 1, 0.9));
    }
    const out = await findTopicCandidates(A, { limit: 999 });
    expect(out.length).toBeLessThanOrEqual(MAX_CANDIDATE_LIMIT);
  });

  it('a client explosion is contained', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(findTopicCandidates(A)).resolves.toEqual([]);
  });

  it('the returned shape carries NO identity decision field', async () => {
    const out = await findTopicCandidates(A);
    const keys = Object.keys(out[0]);
    for (const forbidden of ['isSame', 'shouldMerge', 'confirmed', 'canonicalTopicId', 'decision', 'merge']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('parseEmbedding accepts both array and pgvector string forms', () => {
    expect(parseEmbedding([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseEmbedding('[1,2,3]')).toEqual([1, 2, 3]);
    expect(parseEmbedding('nonsense')).toBeNull();
    expect(parseEmbedding(null)).toBeNull();
  });
});
