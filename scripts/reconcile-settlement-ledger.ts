/**
 * Settlement migration-ledger reconciliation CLI.
 *
 * Registers the missing settlement-foundation migration versions in
 * supabase_migrations.schema_migrations — LEDGER ROWS ONLY. It executes NO
 * DDL, applies NO migration, resets NO database, mutates NO settlement data.
 *
 * Modes:
 *   --dry-run   plan only — prints versions needing registration, detected
 *               collisions, missing artifacts, and blockers; writes nothing.
 *   (default)   registers the missing, collision-safe versions; idempotent.
 *
 * Target defaults to the local Supabase stack; override via SETTLEMENT_VERIFY_*
 * env vars. Run: npx tsx scripts/reconcile-settlement-ledger.ts [--dry-run]
 */

import { Client } from 'pg';
import { readdirSync } from 'fs';
import { join } from 'path';
import {
  reconcileSettlementMigrationLedger,
  type LedgerWriter,
} from '../backend/services/billing/payments/reconcileSettlementMigrationLedger';
import {
  probeRuntime,
  buildRuntimeDiagnostics,
  formatRuntimeDiagnostics,
  isRuntimeReady,
} from '../backend/services/billing/payments/settlementGovernanceRuntime';
import { runOfflineGovernanceChecks } from '../backend/services/billing/payments/settlementMigrationGovernance';

/** On-disk migration filenames (verification only — no writes). */
function readMigrationFilesList(): string[] {
  try {
    return readdirSync(join(process.cwd(), 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'));
  } catch {
    return [];
  }
}

/** Deterministic blocked-state output — no stack trace; offline checks still run. */
function reportBlockedState(): void {
  const offline = runOfflineGovernanceChecks(readMigrationFilesList());
  console.log('--- offline governance checks (DB-independent) ---');
  for (const c of offline.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
  console.log(`offline checks: ${offline.ok ? 'PASS' : 'FAIL'}`);
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

function makeLedgerWriter(client: Client): LedgerWriter {
  return {
    readLedgerVersions: async () => {
      try {
        const r = await client.query('select version from supabase_migrations.schema_migrations');
        return r.rows.map((x) => String(x.version));
      } catch {
        return []; // schema_migrations absent → nothing registered
      }
    },
    readMigrationFiles: async () => {
      try {
        return readdirSync(join(process.cwd(), 'supabase', 'migrations')).filter((f) => f.endsWith('.sql'));
      } catch {
        return [];
      }
    },
    registerVersions: async (rows) => {
      // LEDGER ROWS ONLY — no DDL. Idempotent via ON CONFLICT.
      for (const row of rows) {
        try {
          await client.query(
            `insert into supabase_migrations.schema_migrations(version, name, statements)
             values ($1, $2, '{}'::text[]) on conflict (version) do nothing`,
            [row.version, row.name],
          );
        } catch (e: any) {
          if (e?.code === '42703') {
            // Older schema without a `statements` column.
            await client.query(
              `insert into supabase_migrations.schema_migrations(version, name)
               values ($1, $2) on conflict (version) do nothing`,
              [row.version, row.name],
            );
          } else {
            throw e;
          }
        }
      }
    },
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  // ── runtime preflight — degrade deterministically when the stack is down ──
  const diagnostics = buildRuntimeDiagnostics(await probeRuntime({ dbConfig: connectionConfig() }));
  console.log('=== Settlement governance runtime preflight ===');
  console.log(formatRuntimeDiagnostics(diagnostics));
  if (!isRuntimeReady(diagnostics.runtime_state)) {
    console.log('');
    reportBlockedState();
    console.error(`\nRESULT: BLOCKED (${diagnostics.runtime_state}) — ledger reconciliation requires the database; no writes attempted.`);
    process.exit(1);
  }
  console.log('');

  const client = new Client(connectionConfig());
  try {
    await client.connect();
  } catch (err) {
    console.error('RECONCILIATION BLOCKED — cannot reach the target database:',
      err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  let result;
  try {
    result = await reconcileSettlementMigrationLedger({ dryRun }, makeLedgerWriter(client));
  } finally {
    await client.end();
  }

  const { plan } = result;
  console.log(`=== Settlement ledger reconciliation ${dryRun ? '(DRY-RUN — no writes)' : ''} ===`);
  console.log(`already registered : ${plan.alreadyRegistered.join(', ') || '(none)'}`);
  console.log(`needs registration : ${plan.toRegister.join(', ') || '(none)'}`);
  console.log(`prefix collisions  : ${plan.collisions.join(', ') || '(none)'}`);
  if (plan.orderCorruption) console.log(`ORDER CORRUPTION   : ${plan.orderCorruption}`);
  for (const b of plan.blocked) console.log(`BLOCKED ${b.version} — ${b.reason}`);

  if (!plan.ok) {
    console.error('\nRESULT: FAIL — reconciliation blocked; resolve the hazards above.');
    process.exit(1);
  }
  if (dryRun) {
    console.log(`\nRESULT: DRY-RUN OK — ${plan.toRegister.length} version(s) would be registered.`);
    process.exit(0);
  }
  console.log(`\nRESULT: OK — registered ${result.registered.length} version(s): ${result.registered.join(', ') || '(none)'}`);
  process.exit(0);
}

main().catch((e) => { console.error('RECONCILIATION ERROR:', e); process.exit(1); });
