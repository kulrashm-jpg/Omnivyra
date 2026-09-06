/**
 * GAP-13 — Report 1 score history must be DURABLY persisted.
 *
 * THE DEFECT
 * `SupabaseHistoryStore.writeSnapshot` issued its inserts as:
 *
 *     const { error } = this.client.from(table).insert(rows);
 *
 * PostgREST query builders are LAZY thenables: the HTTP request is fired inside
 * `then()`. Without `await`, `insert()` builds a request that is never sent, and
 * destructuring `error` off the builder always yields `undefined` — so the write
 * silently no-ops AND reports success. `persistCanonicalSnapshot` then records
 * `written: true` and Report 1 persists `scan_metadata.persisted = true` while
 * `report_score_history` stays empty.
 *
 * These tests drive the store through a fake client that reproduces PostgREST
 * laziness exactly: a builder counts as executed ONLY once `then()` is called.
 */
import { SupabaseHistoryStore } from '../../services/intelligence/supabaseHistoryStore';
import type {
  BenchmarkHistoryRecord,
  EvidenceHistoryRecord,
  PillarHistoryRecord,
  ProviderHistoryRecord,
  RecommendationHistoryRecord,
  ReportSnapshotRecord,
} from '../../services/intelligence/historicalPersistence';

const COMPANY = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const OBSERVED_AT = '2026-09-06T07:15:00.000Z';

type Insert = { table: string; rows: unknown[]; executed: boolean };

/** A fake PostgREST client: `insert()` returns a lazy thenable, exactly like postgrest-js. */
function fakeClient(options: { failOn?: string } = {}) {
  const inserts: Insert[] = [];
  const client = {
    from(table: string) {
      return {
        insert(rows: unknown[]) {
          const record: Insert = { table, rows, executed: false };
          inserts.push(record);
          // Lazy thenable — nothing happens until awaited.
          return {
            then(onFulfilled: (r: { data: unknown[] | null; error: unknown }) => unknown) {
              record.executed = true;
              return Promise.resolve(
                options.failOn === table
                  ? { data: null, error: { message: 'insert into ' + table + ' rejected' } }
                  : { data: rows, error: null },
              ).then(onFulfilled);
            },
          };
        },
        select() {
          return { limit: () => Promise.resolve({ data: [], error: null }) };
        },
      };
    },
  };
  return { client, inserts };
}

const score = { value: 61, state: 'measured', band: 'operational', confidence: 'medium' };

function bundle() {
  const snapshot = {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    company_id: COMPANY,
    observed_at: OBSERVED_AT,
    authority_score: score,
    ai_visibility_score: score,
    maturity: 'developing',
    maturity_stage: 'stage_2',
    scan_profile: 'standard',
    source_metadata: { engine_version: 'phase-5', providers_used: [], providers_unavailable: [] },
  } as unknown as ReportSnapshotRecord;
  const pillars = [{
    id: 'aaaaaaaa-0000-4000-8000-000000000002', company_id: COMPANY, observed_at: OBSERVED_AT,
    pillar: 'foundation', score, primary_signal: 'crawl',
  }] as unknown as PillarHistoryRecord[];
  const providers = [{
    id: 'aaaaaaaa-0000-4000-8000-000000000003', company_id: COMPANY, observed_at: OBSERVED_AT,
    provider_id: 'wikidata', outcome: 'measured', latency_ms: 120, cache_hit: false, reason: null,
  }] as unknown as ProviderHistoryRecord[];
  const recommendations = [{
    id: 'aaaaaaaa-0000-4000-8000-000000000004', company_id: COMPANY, observed_at: OBSERVED_AT,
    action_id: 'fix-titles', title: 'Fix titles', pillar: 'foundation', severity: 'high',
    leverage_score: 8, status: 'new',
  }] as unknown as RecommendationHistoryRecord[];
  const evidence = [{
    id: 'aaaaaaaa-0000-4000-8000-000000000005', company_id: COMPANY, observed_at: OBSERVED_AT,
    scope: { kind: 'overall' }, evidence_count: 12, evidence_sources: ['crawler'],
    signal_summary: ['brand_health'],
  }] as unknown as EvidenceHistoryRecord[];
  const benchmark = {
    id: 'aaaaaaaa-0000-4000-8000-000000000006', company_id: COMPANY, observed_at: OBSERVED_AT,
    vertical: 'saas', size_band: 'smb', peer_count: 9, percentile: 42, median_snapshot: score,
  } as unknown as BenchmarkHistoryRecord;
  return { snapshot, pillars, providers, benchmark, recommendations, evidence };
}

describe('GAP-13 — durable score-history persistence', () => {
  // ── 1. The write must actually reach the database ──────────────────────────
  describe('1. every insert is executed, not merely built', () => {
    it('fires the report_score_history insert', async () => {
      const { client, inserts } = fakeClient();
      await new SupabaseHistoryStore(client as never).writeSnapshot(bundle());
      const scoreInsert = inserts.find((i) => i.table === 'report_score_history');
      expect(scoreInsert).toBeDefined();
      expect(scoreInsert!.executed).toBe(true);
    });

    it('fires every companion table insert', async () => {
      const { client, inserts } = fakeClient();
      await new SupabaseHistoryStore(client as never).writeSnapshot(bundle());
      expect(inserts.map((i) => i.table).sort()).toEqual([
        'report_benchmark_history',
        'report_evidence_history',
        'report_pillar_history',
        'report_provider_history',
        'report_recommendation_history',
        'report_score_history',
      ]);
      expect(inserts.every((i) => i.executed)).toBe(true);
    });

    it('leaves no insert unexecuted', async () => {
      const { client, inserts } = fakeClient();
      await new SupabaseHistoryStore(client as never).writeSnapshot(bundle());
      expect(inserts.filter((i) => !i.executed)).toEqual([]);
    });
  });

  // ── 2. A rejected write must surface, never be reported as success ─────────
  describe('2. database errors are surfaced', () => {
    it('throws when the snapshot insert is rejected', async () => {
      const { client } = fakeClient({ failOn: 'report_score_history' });
      await expect(new SupabaseHistoryStore(client as never).writeSnapshot(bundle()))
        .rejects.toThrow(/report_score_history/);
    });

    it('throws when a companion insert is rejected', async () => {
      const { client } = fakeClient({ failOn: 'report_evidence_history' });
      await expect(new SupabaseHistoryStore(client as never).writeSnapshot(bundle()))
        .rejects.toThrow(/report_evidence_history/);
    });

    it('resolves when every insert succeeds', async () => {
      const { client } = fakeClient();
      await expect(new SupabaseHistoryStore(client as never).writeSnapshot(bundle())).resolves.toBeUndefined();
    });
  });

  // ── 3. Persisted identity / value / timestamp fields ───────────────────────
  describe('3. the persisted row carries the correct identity, value and timestamp', () => {
    it('persists tenant identity and observation time on the score row', async () => {
      const { client, inserts } = fakeClient();
      await new SupabaseHistoryStore(client as never).writeSnapshot(bundle());
      const row = inserts.find((i) => i.table === 'report_score_history')!.rows[0] as Record<string, unknown>;
      expect(row.company_id).toBe(COMPANY);
      expect(row.observed_at).toBe(OBSERVED_AT);
      expect(row.id).toBe('aaaaaaaa-0000-4000-8000-000000000001');
      expect(row.scan_profile).toBe('standard');
      expect(row.authority_score).toEqual(score);
      expect(row.ai_visibility_score).toEqual(score);
    });

    it('stamps every companion row with the same company and observed_at', async () => {
      const { client, inserts } = fakeClient();
      await new SupabaseHistoryStore(client as never).writeSnapshot(bundle());
      for (const insert of inserts) {
        for (const row of insert.rows as Array<Record<string, unknown>>) {
          expect(row.company_id).toBe(COMPANY);
          expect(row.observed_at).toBe(OBSERVED_AT);
        }
      }
    });

    it('does not invent rows for an absent benchmark', async () => {
      const { client, inserts } = fakeClient();
      await new SupabaseHistoryStore(client as never).writeSnapshot({ ...bundle(), benchmark: null });
      expect(inserts.some((i) => i.table === 'report_benchmark_history')).toBe(false);
    });

    it('skips empty collections rather than issuing empty inserts', async () => {
      const { client, inserts } = fakeClient();
      await new SupabaseHistoryStore(client as never).writeSnapshot({
        ...bundle(), pillars: [], providers: [], recommendations: [], evidence: [], benchmark: null,
      });
      expect(inserts.map((i) => i.table)).toEqual(['report_score_history']);
      expect(inserts[0].executed).toBe(true);
    });
  });

  // ── 4. Operational probe ───────────────────────────────────────────────────
  describe('4. isOperational reflects the real backend', () => {
    it('is true when the probe query succeeds', async () => {
      const { client } = fakeClient();
      expect(await new SupabaseHistoryStore(client as never).isOperational()).toBe(true);
    });

    it('is false when the probe query errors', async () => {
      const client = {
        from: () => ({ select: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'nope' } }) }) }),
      };
      expect(await new SupabaseHistoryStore(client as never).isOperational()).toBe(false);
    });

    it('is false when the probe throws', async () => {
      const client = { from: () => { throw new Error('unreachable'); } };
      expect(await new SupabaseHistoryStore(client as never).isOperational()).toBe(false);
    });
  });
});
