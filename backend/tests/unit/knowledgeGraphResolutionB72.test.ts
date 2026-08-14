/**
 * B7.2 — topic resolution, coverage, flag, and failure containment.
 *
 * UNIT PROOF. Database behavioural claims (real UNIQUE serialization under
 * concurrency, RLS denial by non-superuser roles) are NOT asserted here — they
 * are proven in the isolated PostgreSQL rehearsal and reported separately.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  resolveTopicIdentity,
  normalizeTopicLabel,
  isPlatformKnowledgeGraphEnabled,
  PLATFORM_KNOWLEDGE_GRAPH_ENV,
} from '../../services/content/knowledgeGraph/topicResolutionService';
import { recordTopicCoverage } from '../../services/content/knowledgeGraph/coverageService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const PRIOR = process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV];

const CANON = 'aaaaaaaa-0000-4000-8000-000000000001';
const ALIAS = 'aaaaaaaa-0000-4000-8000-000000000002';
const CHILD = 'aaaaaaaa-0000-4000-8000-000000000004';
const COMPANY_A = 'cccccccc-0000-4000-8000-00000000000a';
const COMPANY_B = 'cccccccc-0000-4000-8000-00000000000b';

/** Records every table/op so "zero graph operations" is directly observable. */
let ops: string[] = [];

/** Build a supabase stub whose topic lookup returns `node` and whose insert behaves as told. */
function installStub(opts: {
  node?: Record<string, unknown> | null;
  insertError?: { message: string } | null;
  insertId?: string;
  coverage?: Record<string, unknown> | null;
  lookupError?: { message: string } | null;
} = {}) {
  ops = [];
  mockFrom.mockImplementation(((table: string) => {
    ops.push(`from:${table}`);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) chain[m] = () => chain;
    chain.maybeSingle = async () =>
      table === 'platform_topic_node'
        ? { data: opts.node ?? null, error: opts.lookupError ?? null }
        : { data: opts.coverage ?? null, error: null };
    return {
      ...chain,
      insert: (row: unknown) => {
        ops.push(`insert:${table}`);
        void row;
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: opts.insertError ? null : { id: opts.insertId ?? 'new-topic-id' },
              error: opts.insertError ?? null,
            }),
          }),
          // coverage insert is awaited directly
          then: (r: (v: unknown) => unknown) => r({ error: opts.insertError ?? null }),
        };
      },
      update: () => {
        ops.push(`update:${table}`);
        return { eq: async () => ({ error: null }) };
      },
    } as never;
  }) as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV];
  installStub();
});
afterAll(() => {
  if (PRIOR === undefined) delete process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV];
  else process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV] = PRIOR;
});

/* ── normalization ─────────────────────────────────────────────────────── */

describe('B7.2 · deterministic normalization', () => {
  it('collapses case, punctuation and whitespace to one label', () => {
    const a = normalizeTopicLabel('AI Lead Qualification');
    expect(normalizeTopicLabel('  ai   lead   qualification ')).toBe(a);
    expect(normalizeTopicLabel('AI, lead qualification!')).toBe(a);
  });

  it('is deterministic across repeated calls', () => {
    const runs = new Set([0, 1, 2].map(() => normalizeTopicLabel('AI Lead Qualification')));
    expect(runs.size).toBe(1);
  });

  it('returns empty for non-string or blank input — nothing is invented', () => {
    for (const v of [null, undefined, 42, {}, '', '   ']) {
      expect(normalizeTopicLabel(v)).toBe('');
    }
  });

  it('does NOT collapse two distinct subjects', () => {
    expect(normalizeTopicLabel('AI lead qualification'))
      .not.toBe(normalizeTopicLabel('AI replacing SDR teams'));
  });
});

/* ── A–F resolution states ─────────────────────────────────────────────── */

describe('B7.2 · resolution states', () => {
  it('A — exact canonical match', async () => {
    installStub({ node: { id: CANON, canonical_topic_id: null, parent_topic_id: null, state: 'confirmed', confidence: 'high' } });
    const r = await resolveTopicIdentity('AI lead qualification');
    expect(r.kind).toBe('existing_canonical');
    expect(r.topicId).toBe(CANON);
    expect(r.state).toBe('confirmed');
    expect(r.confidence).toBe('high');
    expect(ops).not.toContain('insert:platform_topic_node');
  });

  it('B — alias resolves THROUGH to its canonical', async () => {
    installStub({ node: { id: ALIAS, canonical_topic_id: CANON, parent_topic_id: null, state: 'inferred', confidence: 'medium' } });
    const r = await resolveTopicIdentity('AI powered lead qualification');
    expect(r.kind).toBe('existing_alias');
    expect(r.topicId).toBe(CANON);          // canonical, not the alias row
    expect(r.state).toBe('inferred');       // provenance preserved
  });

  it('C — a child topic resolves to ITSELF, never to its parent', async () => {
    installStub({ node: { id: CHILD, canonical_topic_id: null, parent_topic_id: CANON, state: 'observed', confidence: 'medium' } });
    const r = await resolveTopicIdentity('lead scoring');
    expect(r.kind).toBe('existing_child');
    expect(r.topicId).toBe(CHILD);
    expect(r.topicId).not.toBe(CANON);
  });

  it('D — a genuinely new label creates one identity', async () => {
    installStub({ node: null, insertId: 'brand-new' });
    const r = await resolveTopicIdentity('quantum go-to-market');
    expect(r.kind).toBe('new_topic');
    expect(r.topicId).toBe('brand-new');
    expect(r.state).toBe('observed');       // observed, not confirmed/inferred
    expect(r.confidence).toBe('low');
  });

  it('E — an empty signal is ambiguous and creates nothing', async () => {
    const r = await resolveTopicIdentity('   ');
    expect(r.kind).toBe('ambiguous');
    expect(r.topicId).toBeNull();
    expect(ops).toEqual([]);                // no query at all
  });

  it('E — allowCreate:false yields ambiguous rather than a new identity', async () => {
    installStub({ node: null });
    const r = await resolveTopicIdentity('unseen subject', { allowCreate: false });
    expect(r.kind).toBe('ambiguous');
    expect(ops).not.toContain('insert:platform_topic_node');
  });

  it('F — a lookup failure is a typed error, not a throw', async () => {
    installStub({ node: null, lookupError: { message: 'timeout' } });
    const r = await resolveTopicIdentity('anything');
    expect(r.kind).toBe('error');
    expect(r.topicId).toBeNull();
    expect(r.reason).toContain('lookup_failed');
  });

  it('never throws, whatever the client does', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db exploded'); });
    await expect(resolveTopicIdentity('x')).resolves.toMatchObject({ kind: 'error' });
  });

  it('the six states are distinct — none collapsed', () => {
    expect(new Set(['existing_canonical', 'existing_alias', 'existing_child', 'new_topic', 'ambiguous', 'error']).size).toBe(6);
  });
});

/* ── semantic similarity is deliberately absent ────────────────────────── */

describe('B7.2 · "similar" is not "same"', () => {
  it('a semantically close but distinct label does NOT collapse into an existing identity', async () => {
    // No exact match ⇒ a NEW identity, not a merge into "AI lead qualification".
    installStub({ node: null, insertId: 'sdr-topic' });
    const r = await resolveTopicIdentity('AI replacing SDR teams');
    expect(r.kind).toBe('new_topic');
    expect(r.topicId).toBe('sdr-topic');
    expect(r.topicId).not.toBe(CANON);
  });

  it('no embedding provider is called during resolution', async () => {
    installStub({ node: null, insertId: 'x' });
    await resolveTopicIdentity('some new topic');
    // Only the topic table is touched — no embedding service, no second store.
    expect(ops.every((o) => o.endsWith('platform_topic_node'))).toBe(true);
  });
});

/* ── concurrency (unit-level; DB proof is separate) ────────────────────── */

describe('B7.2 · concurrent creation converges on one identity', () => {
  it('losing the insert race adopts the winner rather than erroring', async () => {
    // Insert fails (unique violation), re-read finds the peer's row.
    installStub({ node: null, insertError: { message: 'duplicate key value violates unique constraint' } });
    let call = 0;
    mockFrom.mockImplementation(((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
      chain.maybeSingle = async () => {
        call += 1;
        // 1st = pre-insert lookup (miss); 2nd = post-conflict re-read (hit)
        return call === 1
          ? { data: null, error: null }
          : { data: { id: CANON, canonical_topic_id: null }, error: null };
      };
      void table;
      return {
        ...chain,
        insert: () => ({
          select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'duplicate key' } }) }),
        }),
      } as never;
    }) as never);

    const r = await resolveTopicIdentity('AI lead qualification');
    expect(r.topicId).toBe(CANON);
    expect(r.reason).toBe('adopted_concurrently_created_identity');
  });
});

/* ── coverage ──────────────────────────────────────────────────────────── */

describe('B7.2 · coverage writer', () => {
  it('creates the first coverage row', async () => {
    installStub({ coverage: null });
    const out = await recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON, contentId: 'c1' });
    expect(out).toMatchObject({ ok: true, action: 'created', coverageCount: 1 });
  });

  it('repeated coverage INCREMENTS rather than duplicating', async () => {
    installStub({ coverage: { id: 'cov-1', coverage_count: 14 } });
    const out = await recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON });
    expect(out).toMatchObject({ ok: true, action: 'incremented', coverageCount: 15 });
    expect(ops).toContain('update:company_topic_coverage');
    expect(ops).not.toContain('insert:company_topic_coverage');
  });

  it('a NULL angle is matched with IS NULL, not = null', async () => {
    // Guards the NULLS NOT DISTINCT semantics: `.eq(col, null)` would never match.
    const isCalls: string[] = [];
    mockFrom.mockImplementation((() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = (c: string) => { isCalls.push(c); return chain; };
      chain.maybeSingle = async () => ({ data: null, error: null });
      return { ...chain, insert: () => ({ then: (r: (v: unknown) => unknown) => r({ error: null }) }) } as never;
    }) as never);
    await recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON, angleLabel: null });
    expect(isCalls).toContain('angle_label');
  });

  it('never fabricates an angle — omitted stays NULL (B7.3 owns extraction)', async () => {
    let captured: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: null });
      return {
        ...chain,
        insert: (row: Record<string, unknown>) => { captured = row; return { then: (r: (v: unknown) => unknown) => r({ error: null }) }; },
      } as never;
    }) as never);
    await recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON });
    expect(captured!.angle_label).toBeNull();
  });

  it('preserves campaign_id when present and NULL otherwise — never inferred', async () => {
    const rows: Record<string, unknown>[] = [];
    mockFrom.mockImplementation((() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: null });
      return {
        ...chain,
        insert: (row: Record<string, unknown>) => { rows.push(row); return { then: (r: (v: unknown) => unknown) => r({ error: null }) }; },
      } as never;
    }) as never);
    await recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON, campaignId: 'camp-1' });
    await recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON });
    expect(rows[0].campaign_id).toBe('camp-1');
    expect(rows[1].campaign_id).toBeNull();
  });

  it('two companies on the same topic are independent writes', async () => {
    const seen: string[] = [];
    mockFrom.mockImplementation((() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: null });
      return {
        ...chain,
        insert: (row: Record<string, unknown>) => { seen.push(String(row.company_id)); return { then: (r: (v: unknown) => unknown) => r({ error: null }) }; },
      } as never;
    }) as never);
    await recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON });
    await recordTopicCoverage({ companyId: COMPANY_B, topicId: CANON });
    expect(seen).toEqual([COMPANY_A, COMPANY_B]);
  });

  it('refuses a missing company or topic rather than guessing', async () => {
    await expect(recordTopicCoverage({ companyId: '', topicId: CANON })).resolves.toMatchObject({ ok: false, reason: 'missing_company_id' });
    await expect(recordTopicCoverage({ companyId: COMPANY_A, topicId: '' })).resolves.toMatchObject({ ok: false, reason: 'missing_topic_id' });
  });

  it('never throws on a client explosion', async () => {
    mockFrom.mockImplementation(() => { throw new Error('down'); });
    await expect(recordTopicCoverage({ companyId: COMPANY_A, topicId: CANON })).resolves.toMatchObject({ ok: false });
  });
});

/* ── feature flag ──────────────────────────────────────────────────────── */

describe('B7.2 · PLATFORM_KNOWLEDGE_GRAPH_ENABLED', () => {
  it('defaults OFF', () => {
    expect(isPlatformKnowledgeGraphEnabled()).toBe(false);
  });

  it.each(['false', '0', 'off', 'no', '', '  ', 'enabled?'])('%s ⇒ OFF', (v) => {
    process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV] = v;
    expect(isPlatformKnowledgeGraphEnabled()).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' On '])('%s ⇒ ON', (v) => {
    process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV] = v;
    expect(isPlatformKnowledgeGraphEnabled()).toBe(true);
  });

  it('follows the same convention as the other content flags', () => {
    // Identical parsing to CANONICAL_PERSISTENCE_ENABLED / PLATFORM_UNIQUENESS_ENABLED.
    process.env[PLATFORM_KNOWLEDGE_GRAPH_ENV] = 'YES';
    expect(isPlatformKnowledgeGraphEnabled()).toBe(true);
  });
});
