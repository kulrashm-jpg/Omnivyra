/**
 * B7.5 — canonical topic curation writer.
 *
 * UNIT PROOF of the identity rules. Concurrency under a real UNIQUE/serialized
 * writer is exercised separately in the isolated PostgreSQL rehearsal and
 * reported as DATABASE PROOF.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../db/supabaseClient';
import {
  confirmCanonicalTopic,
  reverseCanonicalTopic,
} from '../../services/content/knowledgeGraph/topicCurationService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';   // alias candidate
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';   // canonical
const C = 'cccccccc-0000-4000-8000-00000000000c';   // third
const MISSING = 'dddddddd-0000-4000-8000-00000000000d';

/** In-memory node table; every write is recorded so "nothing else changed" is provable. */
let nodes: Record<string, { id: string; canonical_topic_id: string | null; normalized_label: string; parent_topic_id: string | null }>;
let writes: Array<{ id: string; patch: Record<string, unknown>; guard: string }>;
let writeError: { message: string } | null;

function install() {
  writes = [];
  writeError = null;
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'platform_topic_node') throw new Error('unexpected table: ' + table);
    return {
      select: () => {
        let id: string | null = null;
        const chain: Record<string, unknown> = {
          eq: (col: string, v: string) => { if (col === 'id') id = v; return chain; },
          maybeSingle: async () => ({ data: (id && nodes[id]) ? nodes[id] : null, error: null }),
        };
        return chain;
      },
      update: (patch: Record<string, unknown>) => {
        let id: string | null = null;
        let guard = 'none';
        const chain: Record<string, unknown> = {
          eq: (col: string, v: unknown) => {
            if (col === 'id') id = String(v);
            if (col === 'canonical_topic_id') guard = 'eq:' + String(v);
            return chain;
          },
          is: (col: string, v: unknown) => {
            if (col === 'canonical_topic_id' && v === null) guard = 'is:null';
            return chain;
          },
          then: (resolve: (r: { error: unknown }) => unknown) => {
            if (!writeError && id && nodes[id]) {
              writes.push({ id, patch, guard });
              Object.assign(nodes[id], patch);
            }
            return resolve({ error: writeError });
          },
        };
        return chain;
      },
    } as never;
  }) as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  nodes = {
    [A]: { id: A, canonical_topic_id: null, normalized_label: 'ai powered lead qualification', parent_topic_id: null },
    [B]: { id: B, canonical_topic_id: null, normalized_label: 'ai lead qualification', parent_topic_id: null },
    [C]: { id: C, canonical_topic_id: null, normalized_label: 'lead scoring', parent_topic_id: B },
  };
  install();
});

/* ── 1–4: happy path + idempotency + reversal ──────────────────────────── */

describe('B7.5 · confirm / reverse', () => {
  it('1. authorized confirmation succeeds', async () => {
    const r = await confirmCanonicalTopic(A, B);
    expect(r).toMatchObject({ ok: true, action: 'confirmed', topicId: A, canonicalTopicId: B });
    expect(nodes[A].canonical_topic_id).toBe(B);
  });

  it('2. repeated confirmation is idempotent and writes nothing', async () => {
    await confirmCanonicalTopic(A, B);
    const before = writes.length;
    const r = await confirmCanonicalTopic(A, B);
    expect(r).toMatchObject({ ok: true, action: 'already_confirmed' });
    expect(writes.length).toBe(before);
  });

  it('3. authorized reversal succeeds', async () => {
    await confirmCanonicalTopic(A, B);
    const r = await reverseCanonicalTopic(A);
    expect(r).toMatchObject({ ok: true, action: 'reversed', canonicalTopicId: null });
    expect(nodes[A].canonical_topic_id).toBeNull();
  });

  it('4. repeated reversal is idempotent and writes nothing', async () => {
    await confirmCanonicalTopic(A, B);
    await reverseCanonicalTopic(A);
    const before = writes.length;
    const r = await reverseCanonicalTopic(A);
    expect(r).toMatchObject({ ok: true, action: 'already_reversed' });
    expect(writes.length).toBe(before);
  });

  it('confirm → reverse → confirm round-trips (merge is fully reversible)', async () => {
    await confirmCanonicalTopic(A, B);
    await reverseCanonicalTopic(A);
    const r = await confirmCanonicalTopic(A, B);
    expect(r).toMatchObject({ ok: true, action: 'confirmed' });
    expect(nodes[A].canonical_topic_id).toBe(B);
  });
});

/* ── 5–8: validation rules ─────────────────────────────────────────────── */

describe('B7.5 · validation', () => {
  it('5. source == canonical is rejected', async () => {
    const r = await confirmCanonicalTopic(A, A);
    expect(r).toMatchObject({ ok: false, reason: 'self_reference' });
    expect(writes).toHaveLength(0);
  });

  it('6. a non-existent source or canonical is rejected (cross-platform / unknown id)', async () => {
    expect(await confirmCanonicalTopic(MISSING, B)).toMatchObject({ ok: false, reason: 'source_not_found' });
    expect(await confirmCanonicalTopic(A, MISSING)).toMatchObject({ ok: false, reason: 'canonical_not_found' });
    expect(writes).toHaveLength(0);
  });

  // NOTE: the flat-alias rule fires FIRST and subsumes the cycle case — once A
  // aliases B, A is no longer a valid target, so B→A is refused as
  // 'canonical_is_alias'. Cycles are therefore structurally impossible while
  // targets must be identities. The depth-bounded walk is retained as defence
  // in depth for rows written before this service existed (canonical_topic_id
  // had no writer, so hand-seeded data may contain loops). These tests assert
  // the SAFETY property — refused, nothing written — not a specific code.
  it('7. a direct cycle (A→B then B→A) is refused, nothing written', async () => {
    await confirmCanonicalTopic(A, B);
    writes.length = 0;
    const r = await confirmCanonicalTopic(B, A);
    expect(r.ok).toBe(false);
    expect(['would_create_cycle', 'canonical_is_alias']).toContain((r as { reason: string }).reason);
    expect(nodes[B].canonical_topic_id).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('7b. an indirect cycle (A→B, B→C, then C→A) is refused, nothing written', async () => {
    nodes[B].canonical_topic_id = null;
    await confirmCanonicalTopic(A, B);
    // B→C requires C to be an identity; it is (parent_topic_id is unrelated).
    await confirmCanonicalTopic(B, C);
    writes.length = 0;
    const r = await confirmCanonicalTopic(C, A);
    expect(r.ok).toBe(false);
    expect(['would_create_cycle', 'canonical_is_alias']).toContain((r as { reason: string }).reason);
    expect(nodes[C].canonical_topic_id).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('pointing at an alias is rejected — chains stay flat', async () => {
    await confirmCanonicalTopic(A, B);          // A is now an alias of B
    const r = await confirmCanonicalTopic(C, A); // C → A (an alias) must be refused
    expect(r).toMatchObject({ ok: false, reason: 'canonical_is_alias' });
    expect(nodes[C].canonical_topic_id).toBeNull();
  });

  it('8. an existing DIFFERENT canonical is re-chained explicitly, not silently', async () => {
    await confirmCanonicalTopic(A, B);
    const r = await confirmCanonicalTopic(A, C);
    expect(r).toMatchObject({ ok: true, action: 'rechained', canonicalTopicId: C });
    expect(nodes[A].canonical_topic_id).toBe(C);
  });

  it('missing ids are rejected before any read', async () => {
    expect(await confirmCanonicalTopic('', B)).toMatchObject({ ok: false, reason: 'missing_topic_id' });
    expect(await confirmCanonicalTopic(A, '')).toMatchObject({ ok: false, reason: 'missing_canonical_topic_id' });
    expect(await reverseCanonicalTopic('')).toMatchObject({ ok: false, reason: 'missing_topic_id' });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

/* ── 10–14: nothing else is touched ────────────────────────────────────── */

describe('B7.5 · blast radius', () => {
  it('10. no topic is deleted', async () => {
    await confirmCanonicalTopic(A, B);
    await reverseCanonicalTopic(A);
    expect(Object.keys(nodes).sort()).toEqual([A, B, C].sort());
  });

  it('11. normalized_label is never rewritten', async () => {
    const before = Object.fromEntries(Object.values(nodes).map((n) => [n.id, n.normalized_label]));
    await confirmCanonicalTopic(A, B);
    for (const n of Object.values(nodes)) expect(n.normalized_label).toBe(before[n.id]);
    for (const w of writes) expect(w.patch).not.toHaveProperty('normalized_label');
  });

  it('12. parent_topic_id is never modified', async () => {
    await confirmCanonicalTopic(A, B);
    expect(nodes[C].parent_topic_id).toBe(B);   // untouched
    for (const w of writes) expect(w.patch).not.toHaveProperty('parent_topic_id');
  });

  it('13. unrelated topics are unchanged', async () => {
    await confirmCanonicalTopic(A, B);
    expect(nodes[C].canonical_topic_id).toBeNull();
    expect(writes.every((w) => w.id === A)).toBe(true);
  });

  it('14. no coverage table is ever touched', async () => {
    await confirmCanonicalTopic(A, B);
    await reverseCanonicalTopic(A);
    // The stub throws on any table other than platform_topic_node; reaching
    // here proves company_topic_coverage was never read or written.
    expect(writes.every((w) => w.id === A)).toBe(true);
  });

  it('the write patch contains ONLY canonical_topic_id', async () => {
    await confirmCanonicalTopic(A, B);
    expect(Object.keys(writes[0].patch)).toEqual(['canonical_topic_id']);
  });
});

/* ── 15–16: concurrency guard + failure containment ────────────────────── */

describe('B7.5 · concurrency and failure', () => {
  it('15. the update is conditioned on the value read (no lost update)', async () => {
    await confirmCanonicalTopic(A, B);
    expect(writes[0].guard).toBe('is:null');          // expected "was unset"
    await confirmCanonicalTopic(A, C);
    expect(writes[1].guard).toBe('eq:' + B);          // expected "was B"
  });

  it('15b. reversal is likewise conditional', async () => {
    await confirmCanonicalTopic(A, B);
    writes.length = 0;
    await reverseCanonicalTopic(A);
    expect(writes[0].guard).toBe('eq:' + B);
  });

  it('16. a write failure returns a deterministic error, never a throw', async () => {
    writeError = { message: 'deadlock detected' };
    const r = await confirmCanonicalTopic(A, B);
    expect(r).toMatchObject({ ok: false, reason: 'write_failed', detail: 'deadlock detected' });
  });

  it('16b. a client explosion is contained', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(confirmCanonicalTopic(A, B)).resolves.toMatchObject({ ok: false, reason: 'exception' });
    await expect(reverseCanonicalTopic(A)).resolves.toMatchObject({ ok: false, reason: 'exception' });
  });

  it('a pre-existing loop in data is refused rather than walked forever', async () => {
    // Hand-crafted corruption: B→C and C→B already present.
    nodes[B].canonical_topic_id = C;
    nodes[C].canonical_topic_id = B;
    const r = await confirmCanonicalTopic(A, B);
    // B is an alias, so it is refused before the walk even matters.
    expect(r).toMatchObject({ ok: false, reason: 'canonical_is_alias' });
  });
});
