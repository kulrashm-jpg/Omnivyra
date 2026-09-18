/**
 * B7 — company_topic_coverage READER.
 *
 * `company_topic_coverage` was write-only: the B7.10 producer filled it and
 * nothing read it back. These tests pin the reader that closes that loop.
 *
 * The decisive assertions are about the tenant boundary and about degradation:
 * because this path uses the SERVICE-ROLE client (platform_topic_node has RLS
 * enabled with zero policies, so a tenant JWT reads nothing), the explicit
 * `.eq('company_id', …)` filter IS the tenant boundary and must be proven, not
 * assumed. And because the reader feeds an enrichment path, every failure must
 * return [] AND emit a counter.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

const mockCounter = jest.fn();
jest.mock('../../observability', () => ({
  recordRawCounter: (...a: unknown[]) => mockCounter(...a),
  recordRawHistogram: jest.fn(),
}));

const mockEnabled = jest.fn();
jest.mock('../../services/content/knowledgeGraph/topicResolutionService', () => ({
  isPlatformKnowledgeGraphEnabled: () => mockEnabled(),
}));

import { supabase } from '../../db/supabaseClient';
import { readCompanyTopicCoverage } from '../../services/content/knowledgeGraph/coverageReadService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

const COMPANY_A = '11111111-1111-1111-1111-111111111111';
const COMPANY_B = '22222222-2222-2222-2222-222222222222';
const TOPIC_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const TOPIC_2 = 'aaaaaaaa-0000-4000-8000-000000000002';

type Captured = {
  coverageEq: Array<[string, unknown]>;
  coverageLimit: number | null;
  topicIn: Array<[string, unknown]>;
  tables: string[];
};

let captured: Captured;

/**
 * Minimal PostgREST-shaped double. Coverage rows are keyed by company_id, so a
 * query that FAILS to filter returns both tenants' rows — which is exactly how
 * the leak test below can fail loudly rather than silently pass.
 */
function installSupabase(options: {
  coverageByCompany?: Record<string, Array<Record<string, unknown>>>;
  topics?: Array<Record<string, unknown>>;
  coverageError?: { message: string } | null;
  topicError?: { message: string } | null;
  throwOn?: string;
} = {}) {
  const coverageByCompany = options.coverageByCompany ?? {};
  const topics = options.topics ?? [];

  mockFrom.mockImplementation(((table: string) => {
    captured.tables.push(table);
    if (options.throwOn === table) throw new Error('boom');

    if (table === 'company_topic_coverage') {
      let company: string | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          captured.coverageEq.push([column, value]);
          if (column === 'company_id') company = String(value);
          return builder;
        },
        order: () => builder,
        limit: async (n: number) => {
          captured.coverageLimit = n;
          if (options.coverageError) return { data: null, error: options.coverageError };
          // No company filter applied => every tenant's rows come back.
          const rows = company === null
            ? Object.values(coverageByCompany).flat()
            : coverageByCompany[company] ?? [];
          return { data: rows, error: null };
        },
      };
      return builder;
    }

    if (table === 'platform_topic_node') {
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: async (column: string, values: unknown) => {
          captured.topicIn.push([column, values]);
          if (options.topicError) return { data: null, error: options.topicError };
          const wanted = new Set((values as string[]) ?? []);
          return { data: topics.filter((t) => wanted.has(String(t.id))), error: null };
        },
      };
      return builder;
    }

    throw new Error(`unexpected table ${table}`);
  }) as unknown as typeof supabase.from);
}

const coverageRow = (topicId: string, extra: Record<string, unknown> = {}) => ({
  topic_id: topicId,
  coverage_count: 3,
  last_covered_at: '2026-09-01T00:00:00.000Z',
  angle_label: null,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  captured = { coverageEq: [], coverageLimit: null, topicIn: [], tables: [] };
  mockEnabled.mockReturnValue(true);
});

/* -- the happy path: coverage becomes labelled, usable topics -------------- */

describe('reads what the producer wrote', () => {
  it('returns the company\'s covered topics with their canonical labels', async () => {
    installSupabase({
      coverageByCompany: { [COMPANY_A]: [coverageRow(TOPIC_1)] },
      topics: [{ id: TOPIC_1, canonical_label: 'AI lead qualification' }],
    });

    const entries = await readCompanyTopicCoverage(COMPANY_A);

    expect(entries).toEqual([
      {
        topicId: TOPIC_1,
        label: 'AI lead qualification',
        coverageCount: 3,
        lastCoveredAt: '2026-09-01T00:00:00.000Z',
        angleLabel: null,
      },
    ]);
  });

  it('joins labels from platform_topic_node with a second bounded query, not a PostgREST embed', async () => {
    // topic_id is a SOFT reference with no FK, so an embed cannot resolve.
    installSupabase({
      coverageByCompany: { [COMPANY_A]: [coverageRow(TOPIC_1), coverageRow(TOPIC_2)] },
      topics: [
        { id: TOPIC_1, canonical_label: 'AI lead qualification' },
        { id: TOPIC_2, canonical_label: 'Attribution' },
      ],
    });

    await readCompanyTopicCoverage(COMPANY_A);

    expect(captured.tables).toEqual(['company_topic_coverage', 'platform_topic_node']);
    // The label query is constrained to ids the tenant-filtered query returned.
    expect(captured.topicIn).toEqual([['id', [TOPIC_1, TOPIC_2]]]);
  });

  it('carries an angle through when the writer recorded one, and never invents one', async () => {
    installSupabase({
      coverageByCompany: { [COMPANY_A]: [coverageRow(TOPIC_1, { angle_label: 'buyer view' })] },
      topics: [{ id: TOPIC_1, canonical_label: 'AI lead qualification' }],
    });

    const entries = await readCompanyTopicCoverage(COMPANY_A);
    expect(entries[0].angleLabel).toBe('buyer view');
  });

  it('bounds the read so the graph cannot flood a prompt', async () => {
    installSupabase({ coverageByCompany: { [COMPANY_A]: [] } });
    await readCompanyTopicCoverage(COMPANY_A);
    expect(captured.coverageLimit).toBe(8);

    captured = { coverageEq: [], coverageLimit: null, topicIn: [], tables: [] };
    await readCompanyTopicCoverage(COMPANY_A, { limit: 9999 });
    expect(captured.coverageLimit).toBe(50);
  });
});

/* -- the tenant boundary --------------------------------------------------- */

describe('tenant isolation', () => {
  it('filters coverage on company_id — the only boundary on a service-role read', async () => {
    installSupabase({
      coverageByCompany: {
        [COMPANY_A]: [coverageRow(TOPIC_1)],
        [COMPANY_B]: [coverageRow(TOPIC_2)],
      },
      topics: [
        { id: TOPIC_1, canonical_label: 'AI lead qualification' },
        { id: TOPIC_2, canonical_label: 'Company B secret topic' },
      ],
    });

    const entries = await readCompanyTopicCoverage(COMPANY_A);

    expect(captured.coverageEq).toContainEqual(['company_id', COMPANY_A]);
    expect(entries.map((e) => e.label)).toEqual(['AI lead qualification']);
    expect(JSON.stringify(entries)).not.toContain('Company B secret topic');
    // And the platform query never reached for B's topic either.
    expect(captured.topicIn[0][1]).toEqual([TOPIC_1]);
  });

  it('refuses to query at all without a company id', async () => {
    installSupabase({ coverageByCompany: { [COMPANY_A]: [coverageRow(TOPIC_1)] } });

    expect(await readCompanyTopicCoverage('')).toEqual([]);
    expect(await readCompanyTopicCoverage('   ')).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCounter).toHaveBeenCalledWith('content.knowledge_graph.read_missing_company', 1);
  });
});

/* -- degradation: empty, never fatal, never silent ------------------------- */

describe('degrades without breaking, and never silently', () => {
  it('returns [] and counts when the graph flag is off', async () => {
    mockEnabled.mockReturnValue(false);
    installSupabase({ coverageByCompany: { [COMPANY_A]: [coverageRow(TOPIC_1)] } });

    expect(await readCompanyTopicCoverage(COMPANY_A)).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCounter).toHaveBeenCalledWith('content.knowledge_graph.read_disabled', 1);
  });

  it('returns [] and counts when the coverage read errors', async () => {
    installSupabase({ coverageError: { message: 'permission denied' } });

    expect(await readCompanyTopicCoverage(COMPANY_A)).toEqual([]);
    expect(mockCounter).toHaveBeenCalledWith('content.knowledge_graph.read_failed', 1);
  });

  it('returns [] and counts when the label read errors', async () => {
    installSupabase({
      coverageByCompany: { [COMPANY_A]: [coverageRow(TOPIC_1)] },
      topicError: { message: 'rls' },
    });

    expect(await readCompanyTopicCoverage(COMPANY_A)).toEqual([]);
    expect(mockCounter).toHaveBeenCalledWith('content.knowledge_graph.read_label_failed', 1);
  });

  it('returns [] and counts when the company has no coverage yet', async () => {
    installSupabase({ coverageByCompany: { [COMPANY_A]: [] } });

    expect(await readCompanyTopicCoverage(COMPANY_A)).toEqual([]);
    expect(mockCounter).toHaveBeenCalledWith('content.knowledge_graph.read_empty', 1);
  });

  it('drops a coverage row whose topic identity has no label, rather than emitting a uuid', async () => {
    installSupabase({
      coverageByCompany: { [COMPANY_A]: [coverageRow(TOPIC_1), coverageRow(TOPIC_2)] },
      topics: [{ id: TOPIC_1, canonical_label: 'AI lead qualification' }],
    });

    const entries = await readCompanyTopicCoverage(COMPANY_A);

    expect(entries.map((e) => e.label)).toEqual(['AI lead qualification']);
    expect(JSON.stringify(entries)).not.toContain(TOPIC_2);
    expect(mockCounter).toHaveBeenCalledWith('content.knowledge_graph.read_unlabelled', 1);
  });

  it('never throws — an unexpected client failure degrades to [] with a counter', async () => {
    installSupabase({ throwOn: 'company_topic_coverage' });

    await expect(readCompanyTopicCoverage(COMPANY_A)).resolves.toEqual([]);
    expect(mockCounter).toHaveBeenCalledWith('content.knowledge_graph.read_error', 1);
  });
});
