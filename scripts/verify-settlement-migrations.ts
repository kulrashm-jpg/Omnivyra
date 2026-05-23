/**
 * Settlement migration dry-run governance harness — VERIFICATION ONLY.
 *
 * Collects a read-only fact snapshot from a target Postgres and evaluates
 * settlement-foundation migration readiness via the deterministic governance
 * evaluator. It is the controlled gate to run BEFORE any production settlement
 * migration rollout.
 *
 * STRICTLY verification only:
 *   - every query is a SELECT, run inside a READ ONLY transaction;
 *   - NO writes, NO DDL, NO settlement activation, NO migration application;
 *   - PRICING-BLIND — it never reads or prints an amount.
 *
 * Target defaults to the local Supabase stack; override via SETTLEMENT_VERIFY_*
 * env vars to dry-run against a production read replica.
 *
 * Run: npx tsx scripts/verify-settlement-migrations.ts
 * Exit: 0 = all governance checks pass; 1 = a readiness gap was detected.
 */

import { Client } from 'pg';
import { readdirSync } from 'fs';
import { join } from 'path';
import {
  evaluateSettlementMigrationReadiness,
  evaluateMigrationCollisionRisk,
  evaluateLedgerSchemaParity,
  runOfflineGovernanceChecks,
  settlementMigrationsFullyRegistered,
  SETTLEMENT_MIGRATION_VERSIONS,
  REQUIRED_SETTLEMENT_TABLES,
  REQUIRED_SETTLEMENT_FUNCTIONS,
  PRICING_BLIND_TABLES,
  type MigrationFacts,
} from '../backend/services/billing/payments/settlementMigrationGovernance';
import {
  probeRuntime,
  buildRuntimeDiagnostics,
  formatRuntimeDiagnostics,
  isRuntimeReady,
} from '../backend/services/billing/payments/settlementGovernanceRuntime';

/** Read the on-disk migration filenames (verification only — no writes). */
function readMigrationFiles(): string[] {
  try {
    return readdirSync(join(process.cwd(), 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'));
  } catch {
    return [];
  }
}

function connectionConfig() {
  return {
    host: process.env.SETTLEMENT_VERIFY_HOST ?? '127.0.0.1',
    port: Number(process.env.SETTLEMENT_VERIFY_PORT ?? 54322),
    user: process.env.SETTLEMENT_VERIFY_USER ?? 'postgres',
    password: process.env.SETTLEMENT_VERIFY_PASSWORD ?? 'postgres',
    database: process.env.SETTLEMENT_VERIFY_DB ?? 'postgres',
  };
}

/** Collect the read-only fact snapshot. Every statement is a SELECT. */
async function collectFacts(client: Client): Promise<MigrationFacts> {
  // Enforce read-only — a write attempted here would raise.
  await client.query('SET TRANSACTION READ ONLY');

  let ledgerVersions: string[] = [];
  try {
    const r = await client.query('select version from supabase_migrations.schema_migrations');
    ledgerVersions = r.rows.map((x) => String(x.version));
  } catch {
    // schema_migrations absent → treated as zero registered versions.
    ledgerVersions = [];
  }

  const tablesRes = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name = any($1)`,
    [REQUIRED_SETTLEMENT_TABLES as unknown as string[]],
  );
  const tables = tablesRes.rows.map((x) => String(x.table_name));

  const fnRes = await client.query(
    'select proname from pg_proc where proname = any($1)',
    [REQUIRED_SETTLEMENT_FUNCTIONS as unknown as string[]],
  );
  const functions = fnRes.rows.map((x) => String(x.proname));

  const trigRes = await client.query(
    `select t.tgname, c.relname
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal and c.relname = any($1)`,
    [REQUIRED_SETTLEMENT_TABLES as unknown as string[]],
  );
  const triggers = trigRes.rows.map((x) => ({ table: String(x.relname), trigger: String(x.tgname) }));

  const pricingRes = await client.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public'
       and table_name = any($1)
       and column_name ~* '(price|pricing|revenue|invoice|subtotal|amount)'`,
    [PRICING_BLIND_TABLES as unknown as string[]],
  );
  const pricingColumns = pricingRes.rows.map((x) => ({
    table: String(x.table_name), column: String(x.column_name),
  }));

  return { ledgerVersions, tables, functions, triggers, pricingColumns };
}

async function main(): Promise<void> {
  // ── runtime preflight — degrade to offline governance mode if DB is down ──
  const diagnostics = buildRuntimeDiagnostics(await probeRuntime({ dbConfig: connectionConfig() }));
  console.log('=== Settlement governance runtime preflight ===');
  console.log(formatRuntimeDiagnostics(diagnostics));

  if (!isRuntimeReady(diagnostics.runtime_state)) {
    // OFFLINE GOVERNANCE MODE — DB-dependent checks are skipped; the
    // filesystem-only governance checks still run and report deterministically.
    console.log('\n--- offline governance checks (DB-independent) ---');
    const offline = runOfflineGovernanceChecks(readMigrationFiles());
    for (const c of offline.checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
    }
    console.error(
      `\nRESULT: BLOCKED (${diagnostics.runtime_state}) — DB-dependent verification skipped; ` +
      `offline governance checks: ${offline.ok ? 'PASS' : 'FAIL'}.`,
    );
    process.exit(1);
  }
  console.log('');

  const client = new Client(connectionConfig());
  try {
    await client.connect();
  } catch (err) {
    console.error('DRY-RUN BLOCKED — cannot reach the target database:',
      err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  let facts: MigrationFacts;
  try {
    facts = await collectFacts(client);
  } finally {
    await client.end();
  }

  const report = evaluateSettlementMigrationReadiness(facts);
  const fullyRegistered = settlementMigrationsFullyRegistered(facts.ledgerVersions);

  // Collision-risk + sibling-artifact validation (filesystem) and
  // ledger/schema parity validation.
  const collision = evaluateMigrationCollisionRisk(readMigrationFiles());
  const parity = evaluateLedgerSchemaParity(facts);

  console.log('=== Settlement migration dry-run governance ===');
  for (const check of report.checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`);
  }
  console.log(`${parity.ok ? 'PASS' : 'FAIL'}  ${parity.name} — ${parity.detail}`);

  console.log('\n--- migration-prefix collision protection ---');
  for (const finding of collision.findings) {
    const ok = finding.kind === 'ok' || finding.kind === 'collision_resolved';
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${finding.version} [${finding.kind}] — ${finding.detail}`);
  }
  if (collision.collisions.length > 0) {
    console.log(`collisions detected on prefixes: ${collision.collisions.join(', ')}`);
  }

  console.log(
    `\nduplicate-apply prevention: ${fullyRegistered ? 'ARMED' : 'NOT ARMED'} — ` +
    (fullyRegistered
      ? 'all settlement versions registered; `supabase migration up` will skip them (no duplicate DDL)'
      : `unregistered versions remain — ${SETTLEMENT_MIGRATION_VERSIONS.filter((v) => !facts.ledgerVersions.includes(v)).join(', ')}`),
  );

  const allOk = report.ok && collision.ok && parity.ok;
  if (allOk) {
    console.log('\nRESULT: PASS — settlement foundation is migration-ready.');
    process.exit(0);
  }
  const gaps = [
    ...report.failures,
    ...(parity.ok ? [] : [parity.name]),
    ...(collision.ok ? [] : [`collision_blockers:${collision.blockers.join('/')}`]),
  ];
  console.error(`\nRESULT: FAIL — readiness gaps: ${gaps.join(', ')}`);
  process.exit(1);
}

main().catch((e) => { console.error('DRY-RUN ERROR:', e); process.exit(1); });
