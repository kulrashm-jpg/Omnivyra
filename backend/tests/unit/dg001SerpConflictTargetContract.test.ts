/**
 * DG-001 — the `analytics_serp_results` writer's ON CONFLICT target must always
 * have an arbiter, across every migration not yet in production.
 *
 * WHY THIS EXISTS. The first draft of 20261025000000_serp_result_feature_types.sql
 * dropped `analytics_serp_results_unique (snapshot_id, position, domain, url)` and
 * replaced it with a six-column index. The only writer upserts with
 * `onConflict: 'snapshot_id,position,domain,url'`, and PostgreSQL infers an
 * arbiter only from a NON-PARTIAL unique index whose key columns are exactly the
 * conflict target — so applying that migration would have made every SERP ingest
 * raise 42P10. No existing test could see it: unit tests mock the database, and
 * check:migrations validates naming and idempotency, not meaning.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. The authoritative check executes the real
 * statement against real PostgreSQL: backend/tests/realschema/
 * dg001_serp_results_conflict_target.test.ts, run by `npm run test:realschema`
 * (Docker). That cannot run in the ordinary unit suite, so this is its
 * Docker-free counterpart: a MODEL of this one table's unique structures, built
 * from the production schema snapshot and then replaying the ADD / DROP / RENAME
 * of constraints and unique indexes in every migration above the snapshot's
 * ledger position, in version order. It is not a SQL engine; it is deliberately
 * conservative, so an unrecognised statement that touches the arbiter by name is
 * treated as removing it rather than being ignored.
 *
 * The conflict target is read from the writer's source, not restated here, so
 * changing the writer without the schema (or the schema without the writer)
 * fails this test.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TABLE = 'analytics_serp_results';
const WRITER = 'backend/services/externalCompetitiveIntelligenceService.ts';
const SNAPSHOT = 'supabase/_schema/baseline.sql';
const SNAPSHOT_META = 'supabase/_schema/baseline.json';
const MIGRATIONS = 'supabase/migrations';

type Structure = { cols: string[]; partial: boolean };
type Model = Map<string, Structure>;

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const stripTsComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const cols = (list: string) => list.split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase()).filter(Boolean);
const key = (c: string[]) => [...c].sort().join(',');

/** The conflict target the writer actually sends, read from its source. */
function writerConflictTarget(): string[] {
  const src = stripTsComments(read(WRITER));
  const at = src.indexOf(`ownedDbTable('${TABLE}')`);
  const chain = at >= 0 ? src.slice(at, at + 400) : '';
  const match = chain.match(/\.upsert\([^)]*?onConflict:\s*'([^']+)'/);
  if (!match) throw new Error(`could not find the ${TABLE} upsert conflict target in ${WRITER}`);
  return cols(match[1]);
}

/** Apply every statement touching the table's unique structures to the model. */
function apply(model: Model, sql: string): void {
  const statements = stripSqlComments(sql).split(';').map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase());
  for (const s of statements) {
    if (!s.includes(TABLE)) continue;

    const create = s.match(new RegExp(
      `create unique index (?:concurrently )?(?:if not exists )?"?(\\w+)"? on (?:only )?(?:public\\.)?"?${TABLE}"?(?: using \\w+)? \\(([^)]*)\\)(.*)$`));
    if (create) { model.set(create[1], { cols: cols(create[2]), partial: /\bwhere\b/.test(create[3]) }); continue; }

    const addUnique = s.match(new RegExp(
      `alter table (?:only )?(?:if exists )?(?:public\\.)?"?${TABLE}"? .*?add constraint "?(\\w+)"? unique (?:nulls (?:not )?distinct )?\\(([^)]*)\\)`));
    if (addUnique) { model.set(addUnique[1], { cols: cols(addUnique[2]), partial: false }); continue; }

    const rename = s.match(/rename constraint "?(\w+)"? to "?(\w+)"?/);
    if (rename && model.has(rename[1])) { model.set(rename[2], model.get(rename[1])!); model.delete(rename[1]); continue; }

    for (const drop of s.matchAll(/drop (?:constraint|index) (?:concurrently )?(?:if exists )?(?:public\.)?"?(\w+)"?/g)) {
      model.delete(drop[1]);
    }
    // Conservative: any remaining statement that names an existing structure and
    // says DROP is treated as removing it, so an unparsed form cannot hide a drop.
    if (/\bdrop\b/.test(s)) for (const name of [...model.keys()]) if (s.includes(name)) model.delete(name);
  }
}

/** The table's unique structures in the production snapshot. */
function snapshotModel(): Model {
  const model: Model = new Map();
  apply(model, read(SNAPSHOT));
  return model;
}

/** Governed migrations above the snapshot's ledger position, in version order. */
function pendingMigrations(): string[] {
  const ledgerMax = String(JSON.parse(read(SNAPSHOT_META)).ledgerMax);
  return fs.readdirSync(path.join(ROOT, MIGRATIONS))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .filter((f) => f.split('_')[0] > ledgerMax)
    .sort();
}

const arbitersFor = (model: Model, target: string[]) =>
  [...model.entries()].filter(([, s]) => !s.partial && key(s.cols) === key(target)).map(([name]) => name);

describe('DG-001 — analytics_serp_results keeps an arbiter for its writer', () => {
  const target = writerConflictTarget();

  it('reads the writer’s real conflict target', () => {
    expect(target).toEqual(['snapshot_id', 'position', 'domain', 'url']);
  });

  it('production already has the arbiter the writer depends on', () => {
    expect(arbitersFor(snapshotModel(), target)).toEqual(['analytics_serp_results_unique']);
  });

  it('every pending migration, applied in order, still leaves a non-partial arbiter', () => {
    const model = snapshotModel();
    const touched: string[] = [];
    for (const file of pendingMigrations()) {
      const sql = read(`${MIGRATIONS}/${file}`);
      if (sql.includes(TABLE)) touched.push(file);
      apply(model, sql);
      // Checked after EACH migration, not only at the end: a drop in one file and a
      // re-create in a later one still leaves a window in which ingest fails.
      expect({ after: file, arbiters: arbitersFor(model, target) })
        .toEqual({ after: file, arbiters: expect.arrayContaining(['analytics_serp_results_unique']) });
    }
    // Guard against a vacuous pass: the DG-001 migration must actually be replayed.
    expect(touched).toContain('20261025000000_serp_result_feature_types.sql');
  });

  it('the DG-001 expansion is present alongside it, not instead of it', () => {
    const model = snapshotModel();
    for (const file of pendingMigrations()) apply(model, read(`${MIGRATIONS}/${file}`));
    const identity = model.get('analytics_serp_results_identity');
    expect(identity).toEqual({
      cols: ['snapshot_id', 'result_type', 'position', 'domain', 'url', 'title'],
      partial: false,
    });
    expect(model.has('analytics_serp_results_unique')).toBe(true);
  });

  describe('positive control — the model detects the defect it guards against', () => {
    it('the original DROP-and-replace migration leaves the writer with no arbiter', () => {
      const model = snapshotModel();
      apply(model, `
        ALTER TABLE public.analytics_serp_results
          DROP CONSTRAINT IF EXISTS analytics_serp_results_unique;
        CREATE UNIQUE INDEX IF NOT EXISTS analytics_serp_results_identity
          ON public.analytics_serp_results (snapshot_id, result_type, position, domain, url, title)
          NULLS NOT DISTINCT;`);
      expect(arbitersFor(model, target)).toEqual([]);
    });

    it('a PARTIAL replacement is not an arbiter either (the W0.1 shape)', () => {
      const model = snapshotModel();
      apply(model, `
        ALTER TABLE public.analytics_serp_results DROP CONSTRAINT analytics_serp_results_unique;
        CREATE UNIQUE INDEX serp_partial ON public.analytics_serp_results (snapshot_id, position, domain, url)
          WHERE position IS NOT NULL;`);
      expect(arbitersFor(model, target)).toEqual([]);
    });

    it('a drop hidden in an unrecognised statement is still treated as a drop', () => {
      const model = snapshotModel();
      apply(model, `DO $$ BEGIN EXECUTE 'ALTER TABLE public.analytics_serp_results DROP CONSTRAINT analytics_serp_results_unique'; END $$`);
      expect(arbitersFor(model, target)).toEqual([]);
    });
  });
});
