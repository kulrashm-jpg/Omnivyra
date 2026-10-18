/**
 * R1-HIST-02 — a history row written through the DURABLE store must outlive the
 * process that wrote it.
 *
 * WHY THIS CANNOT BE A UNIT TEST. `report1DurableHistoryHonesty.test.ts` pins the
 * CONTRACT — that `scan_metadata.persisted` is `written && durable` and that an
 * in-memory store declares `durable = false`. It cannot pin the FACT, because a
 * process-local map satisfies every in-process write-then-read. Durability is the
 * one property that is only observable from outside the writing process, so this
 * suite writes in one OS process and reads from another.
 *
 * WHAT MAKES THE PROOF NON-VACUOUS. The same sequence is run against the
 * in-memory store as a negative control. If the cross-process read ever succeeded
 * for the in-memory store, the boundary would be fake and the positive result
 * would mean nothing.
 *
 * THE CHILD IS THIS FILE. Re-executed under `tsx` with `W6_DURABLE_CHILD_COMPANY`
 * set, it takes the child branch below instead of registering suites. That keeps
 * the proof to one file while still using the REAL `SupabaseHistoryStore` on both
 * sides — a second process with a cold module registry, not `jest.resetModules()`,
 * which cannot guarantee the heap is free of a captured instance.
 *
 * WHAT THIS DOES NOT PROVE — stated here because the gap is easy to overstate
 * past. The transport is a `pg` adapter, NOT PostgREST: `supabaseHistoryStore.ts`
 * takes a PostgREST-shaped client and a disposable Postgres has no PostgREST, so
 * the production transport and `require('../../db/supabaseClient')` are not
 * exercised. The disposable database also carries NO grants — `baseline.sql` is
 * dumped `--no-privileges` — while RLS is ENABLED on all six history tables with
 * zero policies, so this connects as `postgres` and bypasses both. Nothing here
 * establishes production provider registration, production store selection, the
 * deployed migration state, or production durability.
 *
 * NOT RUN BY `npm test`. `jest.config.js` ignores `backend/tests/realschema/`;
 * only `jest.realschema.config.js` matches it, and that project is driven by
 * `scripts/ci/real-schema-ci.sh`, which provisions the database first.
 */
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { Client } from 'pg';
import {
  InMemoryHistoryStore,
  registerHistoricalStore,
  _resetHistoricalStore,
  type HistoricalStore,
  type ReportSnapshotRecord,
} from '../../services/intelligence/historicalPersistence';
import { SupabaseHistoryStore } from '../../services/intelligence/supabaseHistoryStore';
import { persistCanonicalSnapshot } from '../../services/intelligence/snapshotWriter';
import { emptyCanonicalScore } from '../../services/canonicalReport/canonicalReportTypes';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

type StoreClient = ConstructorParameters<typeof SupabaseHistoryStore>[0];
type Row = Record<string, unknown>;

/** Every table the snapshot bundle touches. Cleanup covers exactly these. */
const HISTORY_TABLES = [
  'report_score_history',
  'report_pillar_history',
  'report_provider_history',
  'report_recommendation_history',
  'report_evidence_history',
  'report_benchmark_history',
] as const;

/**
 * A PostgREST-shaped client backed by `pg`.
 *
 * Deliberately thin: it exists so the REAL `SupabaseHistoryStore` runs unmodified
 * against a real schema with real constraints. Column names come from the store's
 * own serializers, so a column the store writes but the schema lacks fails loudly
 * here rather than being papered over.
 */
function pgSupabaseClient(client: Client): StoreClient {
  const adapter = {
    from(table: string) {
      return {
        async insert(rows: unknown[]) {
          try {
            for (const row of rows as Row[]) {
              const keys = Object.keys(row);
              const values = keys.map((k) => {
                const v = row[k];
                return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
              });
              const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
              await client.query(
                `INSERT INTO public.${table} (${keys.join(', ')}) VALUES (${placeholders})`,
                values,
              );
            }
            return { data: [], error: null };
          } catch (err) {
            return { data: null, error: err };
          }
        },
        select(_columns?: string) {
          const where: string[] = [];
          const params: unknown[] = [];
          let orderSql = '';
          const builder = {
            eq(col: string, v: unknown) { params.push(v); where.push(`${col} = $${params.length}`); return builder; },
            gte(col: string, v: unknown) { params.push(v); where.push(`${col} >= $${params.length}`); return builder; },
            lte(col: string, v: unknown) { params.push(v); where.push(`${col} <= $${params.length}`); return builder; },
            order(col: string, opts?: { ascending?: boolean }) {
              orderSql = ` ORDER BY ${col} ${opts && opts.ascending ? 'ASC' : 'DESC'}`;
              return builder;
            },
            async limit(n: number) {
              try {
                const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
                const sql = `SELECT * FROM public.${table}${clause}${orderSql} LIMIT ${Number(n)}`;
                const res = await client.query(sql, params);
                return { data: res.rows, error: null };
              } catch (err) {
                return { data: [], error: err };
              }
            },
          };
          return builder;
        },
      };
    },
  };
  return adapter as unknown as StoreClient;
}

// ── CHILD BRANCH ─────────────────────────────────────────────────────────────
//
// Reached only when re-executed under tsx. A cold process: nothing from the
// writer's heap exists here, so a row it can read came from the database.
const CHILD_COMPANY = process.env.W6_DURABLE_CHILD_COMPANY;

async function runChild(company: string): Promise<void> {
  const url = process.env.W6_DB_URL;
  if (!url) throw new Error('child: W6_DB_URL absent');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const store = new SupabaseHistoryStore(pgSupabaseClient(client));
    const rows = await store.loadSnapshots({ company_id: company, limit: 50 });
    const raw = await client.query(
      'SELECT count(*)::int AS n FROM public.report_score_history WHERE company_id = $1',
      [company],
    );
    process.stdout.write(JSON.stringify({
      ok: true,
      viaStore: rows.length,
      viaSql: raw.rows[0].n,
      ids: rows.map((r: ReportSnapshotRecord) => r.id),
      companies: Array.from(new Set(rows.map((r: ReportSnapshotRecord) => r.company_id))),
      authority: rows.map((r: ReportSnapshotRecord) => r.authority_score && r.authority_score.value),
    }));
  } finally {
    await client.end();
  }
}

if (CHILD_COMPANY) {
  runChild(CHILD_COMPANY).then(
    () => process.exit(0),
    (err: unknown) => {
      process.stdout.write(JSON.stringify({ ok: false, error: String(err) }));
      process.exit(1);
    },
  );
} else {
  // ── PARENT (jest) BRANCH ───────────────────────────────────────────────────
  //
  // This suite owns its OWN client rather than borrowing `db` from ./setup.
  //
  // WHY. `setup.ts` is a setupFilesAfterEach module, so its `afterAll(db.end)`
  // registers BEFORE any hook in this file and jest runs root-level `afterAll`
  // hooks in declaration order. Borrowing `db` therefore closed the connection
  // underneath this suite's cleanup:
  //
  //   ● Test suite failed to run — Client was closed and is not queryable
  //
  // Every sibling suite mutates through `inRollback()` and needs no cleanup, so
  // this is the first suite to commit and the first to hit it. Owning a client
  // fixes it here without touching a file 28 other suites depend on.
  const ROOT = join(__dirname, '..', '..', '..');
  const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const OBSERVED_AT = new Date().toISOString();
  const ENGINE = 'r1-hist-02';

  /** Set in beforeAll from the harness's own identity, never hard-coded. */
  let COMPANY = '';
  /** This suite's own connection. Opened in beforeAll, closed last. */
  let own: Client;

  function score(value: number | null) {
    return { ...emptyCanonicalScore(value == null ? 'insufficient_signal' : 'measured'), value };
  }

  function report(authority: number): CanonicalReport {
    return {
      authority_overview: { overall_score: score(authority), maturity: 'building_baseline' },
      ai_surface_presence: { score: score(authority - 5) },
      benchmark: { state: 'unavailable', overlay: null },
      maturity_stage: { stage: 'building_baseline' },
      pillars: [{ pillar: 'authority', score: score(authority), primary_signal: null }],
      action_playbook: { actions: [] },
      strategic_playbook: { actions: [] },
      evidence_trace: {
        overall: { count: 0, sources: [], freshness: { last_observed_at: null, age_hours: null }, observations: [] },
        by_pillar: {},
        by_dimension: {},
      },
    } as unknown as CanonicalReport;
  }

  /** Delete only this suite's synthetic rows, from exactly the six tables. */
  async function purge(company: string): Promise<void> {
    for (const table of HISTORY_TABLES) {
      await own.query(`DELETE FROM public.${table} WHERE company_id = $1`, [company]);
    }
  }

  async function countRows(company: string): Promise<number> {
    let total = 0;
    for (const table of HISTORY_TABLES) {
      const r = await own.query(`SELECT count(*)::int AS n FROM public.${table} WHERE company_id = $1`, [company]);
      total += r.rows[0].n as number;
    }
    return total;
  }

  beforeAll(async () => {
    // ── FAIL CLOSED ON ANYTHING NOT PROVABLY DISPOSABLE ──────────────────────
    //
    // The authorization model mirrors the harness that provisions the database:
    // a container it created carries a `w6-harness run=<32 hex>` database
    // comment; a GitHub-hosted runner's service container carries the workflow's
    // own declaration instead. Anything else is refused before a row is written.
    const connectionString = process.env.W6_DB_URL;
    if (!connectionString) throw new Error('W6_DB_URL is not set — run via scripts/ci/real-schema-ci.sh');
    own = new Client({ connectionString });
    await own.connect();

    const dbName = (await own.query('SELECT current_database() AS d')).rows[0].d as string;
    expect(dbName).toBe('w6');

    const stampRow = await own.query(
      "SELECT coalesce(shobj_description(oid, 'pg_database'), '') AS s FROM pg_database WHERE datname = current_database()",
    );
    const stamp = String(stampRow.rows[0].s);
    const harnessRun = /^w6-harness run=([0-9a-f]{32})$/.exec(stamp);
    const ephemeralCi = process.env.W6_CI_SERVICE_DB === '1'
      && process.env.GITHUB_ACTIONS === 'true'
      && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
      && Boolean(process.env.GITHUB_RUN_ID);

    if (!harnessRun && !ephemeralCi) {
      throw new Error(
        'refusing to run: the target is neither stamped by scripts/ci/real-schema-ci.sh '
        + 'nor a declared ephemeral GitHub-hosted service container',
      );
    }

    // The client's own view of where it connected. Asked of the URL rather than
    // the server, because a server behind a forwarded port reports its own
    // address — the mistake that made CI refuse its own service container.
    const url = String(process.env.W6_DB_URL || '');
    expect(url).toMatch(/^postgres(ql)?:\/\//);
    const host = /^[a-z]+:\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^:/?]*)/.exec(url);
    expect(['127.0.0.1', 'localhost', '[::1]', '::1']).toContain(host ? host[1] : '');

    // Run-scoped so two runs can never collide and cleanup can never reach
    // another suite's rows. Derived from the harness identity, not invented.
    const scope = harnessRun ? harnessRun[1] : String(process.env.GITHUB_RUN_ID);
    COMPANY = `w6-durable-${scope.slice(0, 12)}-${randomUUID().slice(0, 8)}`;

    for (const table of HISTORY_TABLES) {
      const exists = await own.query('SELECT to_regclass($1) AS t', [`public.${table}`]);
      expect(exists.rows[0].t).not.toBeNull();
    }

    await purge(COMPANY);
  });

  afterAll(async () => {
    try {
      if (own && COMPANY) await purge(COMPANY);
    } finally {
      // Closed here, after cleanup, on this suite's own connection. `setup.ts`
      // closing its client is unrelated and can no longer strand this one.
      if (own) await own.end();
    }
  });

  /** Phase A: write through the real store and COMMIT. */
  async function writeDurable(company: string): Promise<void> {
    const store = new SupabaseHistoryStore(pgSupabaseClient(own));
    expect(store.durable).toBe(true);
    await expect(store.isOperational()).resolves.toBe(true);
    await store.writeSnapshot({
      snapshot: {
        id: randomUUID(),
        company_id: company,
        observed_at: OBSERVED_AT,
        authority_score: score(61),
        ai_visibility_score: score(56),
        maturity: 'building_baseline',
        maturity_stage: 'building_baseline',
        scan_profile: 'standard',
        source_metadata: { engine_version: ENGINE, providers_used: [], providers_unavailable: [] },
      } as unknown as ReportSnapshotRecord,
      pillars: [],
      providers: [],
      benchmark: null,
      recommendations: [],
      evidence: [],
    });
  }

  /** Phase B: a separate OS process with a cold registry. */
  function readInChildProcess(company: string): { ok: boolean; viaStore?: number; viaSql?: number; companies?: string[]; error?: string } {
    const res = spawnSync(process.execPath, [TSX, __filename], {
      cwd: ROOT,
      env: { ...process.env, W6_DURABLE_CHILD_COMPANY: company },
      encoding: 'utf8',
      timeout: 120_000,
    });
    const out = String(res.stdout || '').trim();
    const start = out.lastIndexOf('{');
    if (start < 0) {
      return { ok: false, error: `child produced no JSON (status ${res.status}): ${out.slice(0, 300)} ${String(res.stderr).slice(0, 300)}` };
    }
    return JSON.parse(out.slice(start));
  }

  describe('R1-HIST-02 durable history survives a process boundary', () => {
    it('writes through the real durable store and a SEPARATE process reads the row back', async () => {
      await writeDurable(COMPANY);

      const child = readInChildProcess(COMPANY);
      expect(child.error).toBeUndefined();
      expect(child.ok).toBe(true);
      // Read by the real store in the child, and corroborated by raw SQL so the
      // store is not the only witness to its own durability.
      expect(child.viaStore).toBe(1);
      expect(child.viaSql).toBe(1);
      expect(child.companies).toEqual([COMPANY]);
    }, 180_000);

    it('NEGATIVE CONTROL: the in-memory store writes, yet the child finds nothing', async () => {
      const volatileCompany = `${COMPANY}-volatile`;
      const store = new InMemoryHistoryStore();
      expect(store.durable).toBe(false);
      await store.writeSnapshot({
        snapshot: {
          id: randomUUID(),
          company_id: volatileCompany,
          observed_at: OBSERVED_AT,
          authority_score: score(61),
          ai_visibility_score: score(56),
          maturity: 'building_baseline',
          maturity_stage: 'building_baseline',
          scan_profile: 'standard',
          source_metadata: { engine_version: ENGINE, providers_used: [], providers_unavailable: [] },
        } as unknown as ReportSnapshotRecord,
        pillars: [], providers: [], benchmark: null, recommendations: [], evidence: [],
      });
      // In-process it reads back perfectly — which is exactly why an in-process
      // assertion proves nothing about durability.
      await expect(store.loadSnapshots({ company_id: volatileCompany, limit: 10 }))
        .resolves.toHaveLength(1);

      const child = readInChildProcess(volatileCompany);
      expect(child.ok).toBe(true);
      expect(child.viaStore).toBe(0);
      expect(child.viaSql).toBe(0);
    }, 180_000);
  });

  describe('R1-HIST-02 persistence is never claimed without durability', () => {
    afterEach(() => { _resetHistoricalStore(); });

    it('a volatile store yields durable=false, so the persisted conjunction is false', async () => {
      registerHistoricalStore(new InMemoryHistoryStore());
      const result = await persistCanonicalSnapshot({
        companyId: `${COMPANY}-mode-volatile`,
        report: report(40),
        scanProfile: 'standard',
        engineVersion: ENGINE,
        providerOutcomes: [],
        domain: 'https://www.example.com/',
      });
      expect(result.written).toBe(true);
      expect(result.durable).toBe(false);
      // The assembly writes `written && durable` into scan_metadata.persisted.
      expect(result.written && result.durable).toBe(false);
    });

    it('a non-operational store yields written=false, so the conjunction is false', async () => {
      const dead: HistoricalStore = Object.assign(new InMemoryHistoryStore(), {
        durable: true as const,
        isOperational: async () => false,
      });
      registerHistoricalStore(dead);
      const result = await persistCanonicalSnapshot({
        companyId: `${COMPANY}-mode-dead`,
        report: report(40),
        scanProfile: 'standard',
        engineVersion: ENGINE,
        providerOutcomes: [],
        domain: 'https://www.example.com/',
      });
      expect(result.written).toBe(false);
      expect(result.reason).toBe('history-store-not-operational');
      expect(result.written && result.durable).toBe(false);
    });
  });

  describe('R1-HIST-02 leaves no residue', () => {
    it('removes exactly its own synthetic rows from all six tables', async () => {
      await purge(COMPANY);
      expect(await countRows(COMPANY)).toBe(0);
      // The failure-mode companies never reached the database at all.
      expect(await countRows(`${COMPANY}-mode-volatile`)).toBe(0);
      expect(await countRows(`${COMPANY}-volatile`)).toBe(0);
    });
  });
}
