/**
 * Automated settlement migration-ledger reconciliation (INTERNAL).
 *
 * Registers the settlement-foundation migration versions in
 * supabase_migrations.schema_migrations WITHOUT re-applying any DDL — closing
 * the local ledger/schema divergence created when the settlement migrations
 * were applied directly via psql.
 *
 * STRICTLY ledger-only:
 *   - NO DDL execution, NO migration application, NO DB reset, NO settlement-
 *     data mutation — it inserts ledger rows and nothing else;
 *   - idempotent — only versions ABSENT from the ledger are registered;
 *   - collision-safe — a duplicate-prefix version is registered only when all
 *     its sibling artifacts are present (evaluateMigrationCollisionRisk);
 *   - PRICING-BLIND — it touches no pricing data.
 *
 * The planner is pure + deterministic; the executor is dependency-injected
 * (LedgerWriter) so it is unit-testable without a DB or filesystem.
 */

import {
  SETTLEMENT_MIGRATION_VERSIONS,
  SETTLEMENT_MIGRATION_FILES,
  evaluateMigrationCollisionRisk,
} from './settlementMigrationGovernance';

export interface ReconciliationPlan {
  ok: boolean;
  /** Missing versions that are safe to register. */
  toRegister: string[];
  /** Versions already present in the ledger (idempotent skip). */
  alreadyRegistered: string[];
  /** Versions that must NOT be registered, with the deterministic reason. */
  blocked: Array<{ version: string; reason: string }>;
  /** Versions whose numeric prefix collides with a sibling migration. */
  collisions: string[];
  /** Non-empty when a later version is registered while an earlier is missing. */
  orderCorruption: string;
}

/**
 * Compute the deterministic reconciliation plan from the current ledger state
 * and the on-disk migration files. Pure — no I/O.
 */
export function planSettlementLedgerReconciliation(input: {
  ledgerVersions: string[];
  migrationFiles: string[];
}): ReconciliationPlan {
  const ledger = new Set(input.ledgerVersions);
  const collision = evaluateMigrationCollisionRisk(input.migrationFiles);
  const blockedSet = new Set(collision.blockers);

  const alreadyRegistered = SETTLEMENT_MIGRATION_VERSIONS.filter((v) => ledger.has(v));

  // Migration-order corruption — an earlier version missing while a later one
  // is registered means the ledger history is out of order.
  let orderCorruption = '';
  for (let i = 0; i < SETTLEMENT_MIGRATION_VERSIONS.length; i++) {
    const version = SETTLEMENT_MIGRATION_VERSIONS[i];
    if (ledger.has(version)) continue;
    const laterRegistered = SETTLEMENT_MIGRATION_VERSIONS.slice(i + 1).filter((v) => ledger.has(v));
    if (laterRegistered.length > 0) {
      orderCorruption = `${version} unregistered but later ${laterRegistered.join(', ')} already registered`;
      break;
    }
  }

  const toRegister: string[] = [];
  const blocked: Array<{ version: string; reason: string }> = [];
  for (const version of SETTLEMENT_MIGRATION_VERSIONS) {
    if (ledger.has(version)) continue; // idempotent — already registered
    if (blockedSet.has(version)) {
      const finding = collision.findings.find((f) => f.version === version);
      blocked.push({ version, reason: finding?.detail ?? 'collision / sibling-artifact hazard' });
      continue;
    }
    toRegister.push(version);
  }

  return {
    ok: blocked.length === 0 && orderCorruption === '',
    toRegister,
    alreadyRegistered,
    blocked,
    collisions: collision.collisions,
    orderCorruption,
  };
}

/** Migration-ledger persistence surface — injectable for unit tests. */
export interface LedgerWriter {
  readLedgerVersions(): Promise<string[]>;
  readMigrationFiles(): Promise<string[]>;
  /** Insert ledger rows ONLY (version + name). No DDL, idempotent on conflict. */
  registerVersions(rows: Array<{ version: string; name: string }>): Promise<void>;
}

export interface ReconcileResult {
  ok: boolean;
  dryRun: boolean;
  plan: ReconciliationPlan;
  /** Versions actually written — empty on a dry-run or a blocked plan. */
  registered: string[];
}

/** Derive the ledger `name` for a version from its settlement migration file. */
function ledgerName(version: string): string {
  return SETTLEMENT_MIGRATION_FILES[version].settlement.replace(/^\d+_/, '').replace(/\.sql$/, '');
}

/**
 * Reconcile the settlement migration ledger. Registers only the missing,
 * collision-safe versions. On `dryRun` (or a blocked / empty plan) it writes
 * nothing. Idempotent — a second run registers nothing.
 */
export async function reconcileSettlementMigrationLedger(
  opts: { dryRun: boolean },
  deps: LedgerWriter,
): Promise<ReconcileResult> {
  const ledgerVersions = await deps.readLedgerVersions();
  const migrationFiles = await deps.readMigrationFiles();
  const plan = planSettlementLedgerReconciliation({ ledgerVersions, migrationFiles });

  // Dry-run, a blocked plan, or nothing to do → no writes.
  if (opts.dryRun || !plan.ok || plan.toRegister.length === 0) {
    return { ok: plan.ok, dryRun: opts.dryRun, plan, registered: [] };
  }

  await deps.registerVersions(plan.toRegister.map((v) => ({ version: v, name: ledgerName(v) })));
  return { ok: true, dryRun: false, plan, registered: [...plan.toRegister] };
}
