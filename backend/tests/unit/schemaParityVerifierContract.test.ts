/**
 * `scripts/verify-schema-parity.js` — the exit-code contract.
 *
 * ─── WHY THIS TEST EXISTS ──────────────────────────────────────────────────
 * The verifier used to read `information_schema` through PostgREST, as
 * `client.from('information_schema.columns')`. PostgREST resolves that as the
 * TABLE `public."information_schema.columns"`, which does not exist, so the
 * very first table errored and the script exited 2 — on every run, in every
 * environment, with valid credentials present. `predeploy-check.js` maps exit 2
 * to "schema parity: SKIPPED (env unavailable)" and continues, so the gate
 * announced an environmental excuse forever and never compared a single column.
 *
 * The regression this file guards is therefore not "does it pass" but
 * "does it actually run, and can a failure ever look like a success".
 *
 * The exit-code contract:
 *   0 — every required column present AND no ledger desync
 *   1 — at least one BLOCKING column missing
 *   2 — environmental failure (no connection string, connection refused)
 *   3 — WARN only (non-critical columns missing, or ledger desync)
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'verify-schema-parity.js');

interface RunResult { code: number; stdout: string; stderr: string }

/** Runs the verifier with a controlled environment and captures its exit code. */
function run(env: Record<string, string | undefined>): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.status === 'number' ? err.status : -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

/**
 * The script loads `.env.local` from cwd when the connection string is absent,
 * which would defeat a "no credentials" test. Point HOME/cwd env at values that
 * cannot resolve instead, and blank every accepted variable.
 */
const NO_DB = {
  SUPABASE_POOLER_DB_URL: '',
  SUPABASE_DB_URL: '',
  DATABASE_URL: '',
};

const source = fs.readFileSync(SCRIPT, 'utf8');

/**
 * Comments stripped. The header explains the PostgREST defect by quoting it, so
 * a naive substring search finds the prose describing the bug and reports the
 * bug itself — which is exactly what happened the first time this ran.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('verify-schema-parity — source-level regression guards', () => {
  it('never reads information_schema through PostgREST again', () => {
    expect(code).not.toContain("from('information_schema.columns')");
    expect(code).not.toContain('from("information_schema.columns")');
  });

  it('reads information_schema over a direct Postgres connection', () => {
    expect(source).toContain('information_schema.columns');
    expect(source).toMatch(/require\('pg'\)/);
    expect(source).toContain('SUPABASE_POOLER_DB_URL');
  });

  it('exits 0 on exactly one condition — everything present AND no desync', () => {
    const zeroExits = code.match(/process\.exit\(0\)/g) ?? [];
    expect(zeroExits).toHaveLength(1);
    expect(code).toMatch(/missing\.length === 0 && !ledgerDesyncDetected[\s\S]{0,200}process\.exit\(0\)/);
  });

  it('treats a failed introspection query as environmental, never as "no columns"', () => {
    // The catch around the column query must exit, not fall through to a
    // verdict built from an empty observation set.
    expect(source).toMatch(/information_schema_query_failed[\s\S]{0,200}process\.exit\(2\)/);
  });
});

/**
 * GAP-007 — the Prospect Intelligence coverage gap.
 *
 * The verifier executed, and exit 0 could no longer mean "never checked". What
 * it still could not tell you is whether it checked anything that MATTERED for
 * PI: REQUIRED_COLUMNS listed 21 tables and not one of them was a PI table, so
 * the whole authored PI migration series (20261011000000 … 20261022000000, and
 * the W1, LI-1, LI-2, LI-3, LI-4C and P2A migrations it builds on) shipped with
 * zero deploy-gate coverage. PI reads are explicit PostgREST column lists
 * followed by `if (error) throw` — `accountIntelligence.ts` selects `authority`,
 * `influence` and `buying_role` by name — so an unapplied migration is a 42703
 * on a customer request, not a null field.
 *
 * These assertions pin the coverage so it cannot be deleted back out. They are
 * source-level for the same reason the guards above are: a runtime assertion
 * would need a database, and the regression being guarded is a manifest that
 * silently stops listing a table.
 */
describe('verify-schema-parity — Prospect Intelligence coverage (GAP-007)', () => {
  /** Every table the PI write/read surface depends on. */
  const PI_TABLES = [
    'unified_persons',
    'prospect_accounts',
    'canonical_leads',
    'identity_claims',
    'source_records',
    'source_assertions',
    'person_duplicate_candidates',
    'contact_governance_records',
    'prospect_icps',
    'prospect_icp_versions',
    'prospect_enrichment_attempts',
    'outreach_tasks',
    'outreach_outcomes',
  ];

  /** Matches a manifest entry for one table.column, capturing its severity. */
  const entry = (table: string, column: string) =>
    new RegExp(
      `severity:\\s*'(BLOCKING|WARN|INFO)',\\s*table:\\s*'${table}',\\s*column:\\s*'${column}'`,
    );

  it.each(PI_TABLES)('requires at least one column of %s', (table) => {
    // One entry is enough to detect the table being absent entirely: the
    // verifier seeds `observed` with an empty set per table, so every
    // requirement against a missing table reports missing.
    expect(source).toMatch(new RegExp(`table:\\s*'${table}'`));
  });

  /**
   * The columns whose absence makes a PI read path THROW — each one appears in
   * an explicit select list or an `.eq()`/`.is()` predicate on a path reachable
   * from a tenant request, and each path ends in `if (error) throw`.
   */
  const MUST_BLOCK: Array<[string, string]> = [
    // accountIntelligence.loadContacts / prospectContext.loadPerson
    ['unified_persons', 'company_id'],
    ['unified_persons', 'account_id'],
    ['unified_persons', 'job_title'],
    ['unified_persons', 'authority'],
    ['unified_persons', 'influence'],
    ['unified_persons', 'buying_role'],
    // accountIntelligence.loadAccount tenant predicate
    ['prospect_accounts', 'organization_id'],
    // listProspects — GET /api/prospects
    ['canonical_leads', 'company_id'],
    ['canonical_leads', 'unified_person_id'],
    ['canonical_leads', 'external_lead_key'],
    ['canonical_leads', 'qualification_score'],
    // accountIntelligence.loadAssertions + observations.readAssertions
    ['source_assertions', 'organization_id'],
    ['source_assertions', 'superseded_at'],
    // ingestionBoundary via the unguarded persistObservation port
    ['source_records', 'organization_id'],
    ['source_records', 'ingestion_run_id'],
    // getRatifiedIcp → translate() → fail() → throws, unguarded in prospectContext
    ['prospect_icps', 'organization_id'],
    ['prospect_icp_versions', 'criteria'],
    // governance reads fail CLOSED — every outreach send refuses
    ['contact_governance_records', 'organization_id'],
    ['contact_governance_records', 'revoked_at'],
    // prospectOutcomes/corpus — GET /api/prospects/[id]
    ['outreach_tasks', 'person_id'],
    ['outreach_outcomes', 'company_id'],
    ['outreach_outcomes', 'provider_event_id'],
  ];

  it.each(MUST_BLOCK)('classifies %s.%s BLOCKING', (table, column) => {
    const m = source.match(entry(table, column));
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[1]).toBe('BLOCKING');
  });

  /**
   * The counterweight. A gate where everything is BLOCKING gets turned off, so
   * these pin the paths that are genuinely fail-open or degrade-only. If a
   * future change promotes one of them, that is a decision to argue for here —
   * not something to slip in.
   */
  const MUST_NOT_BLOCK: Array<[string, string]> = [
    // read via select('*') → a missing column is an unknown fact, not an error
    ['prospect_accounts', 'industry'],
    ['prospect_accounts', 'market'],
    ['prospect_accounts', 'annual_revenue'],
    ['unified_persons', 'attributes_source'],
    // recordedExecution catches the open and wraps complete() in try/catch
    ['prospect_enrichment_attempts', 'execution_status'],
    ['prospect_enrichment_attempts', 'provider_call_state'],
    ['prospect_enrichment_attempts', 'next_retry_at'],
    ['prospect_enrichment_attempts', 'claimed_by'],
    // persistClaims records a per-claim failure; the resolver falls back to the spine
    ['identity_claims', 'organization_id'],
    // operator review queue — no tenant read path selects from it
    ['person_duplicate_candidates', 'organization_id'],
  ];

  it.each(MUST_NOT_BLOCK)('keeps %s.%s below BLOCKING', (table, column) => {
    const m = source.match(entry(table, column));
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[1]).not.toBe('BLOCKING');
  });

  it('covers every PI migration that added a column to an existing table', () => {
    // A table created by one migration is detected by any single entry. A
    // column added by a LATER migration can be individually missing when the
    // ledger is partially applied, so each one needs its own entry.
    const ALTER_ADDED: Array<[string, string]> = [
      ['unified_persons', 'account_id'],                        // W1  20260920000000
      ['unified_persons', 'job_title'],                         // LI-1 20261001000000
      ['unified_persons', 'authority'],                         // WS-6/7 20261013000000
      ['prospect_accounts', 'industry'],                        // LI-1 20261001000000
      ['prospect_accounts', 'annual_revenue'],                  // P2A 20261005000000
      ['prospect_accounts', 'market'],                          // WS-6/7 20261013000000
      ['outreach_tasks', 'person_id'],                          // A3  20261011000000
      ['outreach_decisions', 'identity_degraded'],              // A3  20261011000000
      ['outreach_outcomes', 'provider_event_id'],               // WS-3 20260915000000
      ['prospect_enrichment_attempts', 'claimed_by'],           // A4N 20261016000000
      ['prospect_enrichment_attempts', 'provider_call_state'],  // A4Q 20261017000000
      ['prospect_enrichment_attempts', 'execution_status'],     // A5  20261019000000
      ['prospect_enrichment_attempts', 'next_retry_at'],        // A6A 20261020000000
      ['source_records', 'ingestion_run_id'],                   // A7P-C9 20261022000000
    ];
    for (const [table, column] of ALTER_ADDED) {
      expect(source).toMatch(entry(table, column));
    }
  });

  it('does not mark the whole PI surface BLOCKING', () => {
    // A gate that blocks on everything is a gate somebody disables. Assert that
    // the manifest keeps a real WARN tier rather than escalating wholesale.
    const blocking = source.match(/severity:\s*'BLOCKING'/g) ?? [];
    const warn = source.match(/severity:\s*'WARN'/g) ?? [];
    expect(warn.length).toBeGreaterThan(blocking.length);
  });
});

/**
 * GAP-B / GAP-C — the two structural dependencies column existence cannot see.
 *
 * GAP-B. `ingestionBoundary.ts` is explicit that "Idempotency is by DATABASE
 * CONSTRAINT, never SELECT-then-INSERT": `upsertSourceRecord`,
 * `recordAssertions` and `contactGovernanceWriter.recordContactGovernance` each
 * INSERT and branch on 23505. That branch is reached ONLY because a unique
 * index raises it. Drop the index and the INSERT just succeeds — every column
 * is still present, this gate still exits 0, and re-ingesting the same provider
 * record appends a DUPLICATE observation instead of being a no-op.
 *
 * GAP-C. `20261022000000` converts `source_records.ingestion_run_id` from uuid
 * to text. The column exists before and after, so a column-existence probe
 * cannot tell the two worlds apart — and the unconverted world fails at INSERT
 * with 22P02, on the unguarded persistObservation port, after the provider call
 * has already been billed. Not 42703 at SELECT, where the rest of this manifest
 * looks.
 *
 * These are source-level for the same reason every guard above is: the
 * regression being pinned is a manifest that quietly stops listing something,
 * and a runtime assertion would need a database.
 */
describe('verify-schema-parity — structural dependencies (GAP-B / GAP-C)', () => {
  /** Matches an index manifest entry, capturing its severity. */
  const indexEntry = (index: string) =>
    new RegExp(`severity:\\s*'(BLOCKING|WARN|INFO)',[\\s\\S]{0,200}?index:\\s*'${index}'`);

  it('introspects indexes over the pg catalog on the SAME connection', () => {
    // information_schema has no index view; pg_index/pg_class is the only
    // source. A second connection or a second script would be a second gate.
    expect(code).toContain('pg_index');
    expect(code).toContain('pg_get_indexdef');
    // Exactly one Client is constructed — no second connection crept in.
    expect(code.match(/new Client\(/g) ?? []).toHaveLength(1);
  });

  it('selects the declared type alongside the column name', () => {
    // GAP-C rides the existing column query rather than adding a second pass.
    expect(code).toMatch(/SELECT table_name, column_name, data_type, udt_name/);
  });

  /**
   * The three indexes whose absence silently corrupts persisted state. If a
   * future change demotes one of them, that is an argument to have here.
   */
  const MUST_BLOCK_INDEXES: Array<[string, string]> = [
    // upsertSourceRecord INSERT → 23505 → re-read + observation_count bump
    ['uq_source_records_tenant_identity', 'source_records'],
    // recordAssertions INSERT → 23505 counted as alreadyPresent
    ['uq_source_assertions_dedupe', 'source_assertions'],
    // recordContactGovernance INSERT → 23505 → resolveByCanonicalKey
    ['uq_contact_governance_identity', 'contact_governance_records'],
  ];

  it.each(MUST_BLOCK_INDEXES)('requires %s on %s at BLOCKING', (index, table) => {
    const m = source.match(indexEntry(index));
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[1]).toBe('BLOCKING');
    expect(source).toMatch(new RegExp(`table:\\s*'${table}',[\\s\\S]{0,120}index:\\s*'${index}'`));
  });

  it('demands UNIQUE, not merely present — a non-unique index raises no 23505', () => {
    for (const [index] of MUST_BLOCK_INDEXES) {
      expect(source).toMatch(new RegExp(`index:\\s*'${index}',[\\s\\S]{0,60}unique:\\s*true`));
    }
    expect(code).toContain('indisunique');
    expect(code).toMatch(/req\.unique && !found\.isUnique/);
  });

  it('states partiality per index, and treats a divergence either way as a finding', () => {
    // LI-2's two are NON-partial: a partial one would leave every row outside
    // the predicate colliding with nothing. LI-3B's is partial BY DESIGN, on
    // `revoked_at IS NULL` — which is exactly why its writer cannot use ON
    // CONFLICT (PostgREST cannot infer a partial index; it answers 42P10).
    expect(source).toMatch(/index: 'uq_source_records_tenant_identity',[\s\S]{0,120}partial: false/);
    expect(source).toMatch(/index: 'uq_source_assertions_dedupe',[\s\S]{0,120}partial: false/);
    expect(source).toMatch(/index: 'uq_contact_governance_identity',[\s\S]{0,120}partial: true/);
    expect(code).toContain('indpred');
    expect(code).toMatch(/found\.isPartial !== req\.partial/);
  });

  it('checks the index is built over the expected keys, not just named right', () => {
    expect(source).toContain(
      "keys: ['organization_id', 'provider', 'source_entity_type', 'source_record_id']");
    expect(source).toContain(
      "keys: ['organization_id', 'source_record_id', 'attribute', 'value_hash']");
    expect(code).toMatch(/req\.keys\.filter/);
  });

  it('verifies source_records.ingestion_run_id is declared text, not uuid', () => {
    expect(source).toMatch(
      /table: 'source_records',\s*\n\s*column: 'ingestion_run_id',\s*\n\s*udtName: 'text'/,
    );
    const m = source.match(
      /severity: '(BLOCKING|WARN|INFO)',[\s\S]{0,160}?column: 'ingestion_run_id',\s*\n\s*udtName:/,
    );
    expect(m).not.toBeNull();
    // The same class of outcome as a missing BLOCKING column: the path is not
    // fail-open, it is reachable from POST /api/prospects/[id]/enrich, and the
    // provider has already been paid by the time it throws.
    expect((m as RegExpMatchArray)[1]).toBe('BLOCKING');
    expect(code).toMatch(/meta\.udtName !== req\.udtName/);
  });

  it('names the real SQLSTATEs so the failure mode stays legible', () => {
    // 22P02 at INSERT, not 42703 at SELECT — the whole point of GAP-C.
    expect(source).toContain('22P02');
    expect(source).toContain('42703');
    // 23505 is the mechanism GAP-B protects; 42P10 is why it has to be caught
    // rather than expressed as ON CONFLICT.
    expect(source).toContain('23505');
    expect(source).toContain('42P10');
  });

  it('folds structural findings into the ONE exit-0 condition', () => {
    // A separate findings array would need its own reachable exit, and exit 0
    // having exactly one cause is the single guarantee this gate sells.
    expect(code).toMatch(/missing\.push\(\{\s*\n\s*kind: 'index'/);
    expect(code).toMatch(/missing\.push\(\{\s*\n\s*kind: 'column_type'/);
    const zeroExits = code.match(/process\.exit\(0\)/g) ?? [];
    expect(zeroExits).toHaveLength(1);
    expect(code).toMatch(/missing\.length === 0 && !ledgerDesyncDetected[\s\S]{0,200}process\.exit\(0\)/);
  });

  it('treats a failed index introspection as environmental, never as "no indexes"', () => {
    // Symmetry with the column query: an outage must not fabricate three
    // BLOCKING findings and block a deploy that was in fact fine.
    expect(source).toMatch(/index_introspection_query_failed[\s\S]{0,200}process\.exit\(2\)/);
  });

  it('keeps missing_columns meaning what it always meant', () => {
    // Existing log parsers key on this field. Structural findings get their own
    // list rather than being smuggled into it.
    expect(code).toMatch(/missing_columns: missing\.filter\(\(m\) => m\.kind === 'column'\)/);
    expect(code).toContain('structural_findings');
  });

  it('is honest about what the structural checks do NOT prove', () => {
    // A type check proves a declared type, not that every stored row is
    // convertible; an index key check is a substring test on pg_get_indexdef,
    // not a parsed key-list comparison, so column ORDER is not verified.
    expect(source).toContain('WHAT THIS DOES NOT PROVE');
    expect(source).toContain('not a parsed key-list comparison');
    expect(source).toContain('DECLARED type');
  });

  it('still keeps a real WARN tier once the structural entries are added', () => {
    const blocking = source.match(/severity:\s*'BLOCKING'/g) ?? [];
    const warn = source.match(/severity:\s*'WARN'/g) ?? [];
    expect(warn.length).toBeGreaterThan(blocking.length);
  });
});

describe('verify-schema-parity — runtime exit-code contract', () => {
  it('exits 2, never 0, when no connection string is available', () => {
    const r = run({ ...NO_DB, SCHEMA_PARITY_SKIP_ENV_FILE: '1' });
    // Either it found no connection string (2), or .env.local supplied one and
    // it produced a real verdict. What it must NEVER do is exit 0 silently
    // without having checked anything.
    expect(r.code).not.toBe(-1);
    if (r.code === 2) {
      expect(r.stderr).toContain('schema_parity.error');
    } else {
      // It ran for real: prove it actually compared columns.
      const line = r.stdout.split('\n').find((l) => l.includes('schema_parity.check'));
      expect(line).toBeDefined();
      expect(JSON.parse(line as string).checked_columns).toBeGreaterThan(0);
    }
  });

  it('exits 2, never 0, when the database refuses the connection', () => {
    const r = run({
      SUPABASE_POOLER_DB_URL: 'postgresql://nobody:nobody@127.0.0.1:1/nodb',
      SUPABASE_DB_URL: '',
      DATABASE_URL: '',
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/connection_failed|information_schema_query_failed/);
    expect(r.code).not.toBe(0);
  });

  it('exits 2, never 0, on a malformed connection string', () => {
    const r = run({
      SUPABASE_POOLER_DB_URL: 'not-a-connection-string',
      SUPABASE_DB_URL: '',
      DATABASE_URL: '',
    });
    expect(r.code).toBe(2);
    expect(r.code).not.toBe(0);
  });
});
