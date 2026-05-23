/**
 * Settlement migration governance — deterministic readiness evaluator (INTERNAL).
 *
 * A pure, side-effect-free evaluator for the settlement-foundation migration
 * set. Given a snapshot of database FACTS (ledger versions, tables, functions,
 * triggers, pricing-named columns) it produces a deterministic readiness
 * report. It is the verification core behind the production dry-run governance
 * harness (scripts/verify-settlement-migrations.ts).
 *
 * VERIFICATION ONLY — this module performs NO database I/O, NO writes, NO
 * settlement activation. It detects: partial migration application, missing
 * triggers (immutability gaps), missing RPCs, migration-order corruption, and
 * pricing leakage. PRICING-BLIND — it never reads or reports an amount.
 */

/** The settlement-foundation migration versions, in canonical apply order. */
export const SETTLEMENT_MIGRATION_VERSIONS = [
  '20260714', // payment_provider_config
  '20260717', // hidden_billing_catalog
  '20260718', // hidden_billing_audit_and_checkout_sessions
  '20260719', // settlement_lifecycle_foundation
  '20260720', // settlement_locks_and_metrics
  '20260721', // settlement_metrics_rollup
  '20260722', // settlement_metrics_prune
] as const;

/** Tables the settlement foundation must have created. */
export const REQUIRED_SETTLEMENT_TABLES = [
  'payment_provider_config',
  'hidden_billing_catalog',
  'hidden_billing_catalog_audit',
  'billing_checkout_sessions',
  'billing_settlement_events',
  'settlement_runtime_locks',
  'settlement_operational_metrics',
  'settlement_metrics_rollup',
] as const;

/** Functions / RPCs the settlement foundation must have created. */
export const REQUIRED_SETTLEMENT_FUNCTIONS = [
  'raise_ledger_immutable',               // append-only guard (pre-existing dependency)
  'raise_settlement_metrics_delete_guard', // retention-gated delete guard (20260722)
  'settlement_metrics_prune_rolled',       // sanctioned prune RPC (20260722)
] as const;

/**
 * Append-only immutability triggers the foundation must have installed. This
 * reflects the FINAL expected state — 20260722 drops som_immutable_delete and
 * replaces it with the retention-gated som_retention_gated_delete.
 */
export const REQUIRED_IMMUTABILITY_TRIGGERS = [
  { table: 'hidden_billing_catalog_audit', trigger: 'hbca_audit_immutable_update' },
  { table: 'hidden_billing_catalog_audit', trigger: 'hbca_audit_immutable_delete' },
  { table: 'billing_settlement_events', trigger: 'bse_immutable_update' },
  { table: 'billing_settlement_events', trigger: 'bse_immutable_delete' },
  { table: 'settlement_operational_metrics', trigger: 'som_immutable_update' },
  { table: 'settlement_operational_metrics', trigger: 'som_retention_gated_delete' },
  { table: 'settlement_metrics_rollup', trigger: 'smr_immutable_update' },
  { table: 'settlement_metrics_rollup', trigger: 'smr_immutable_delete' },
] as const;

/** Settlement operational/runtime tables that MUST stay pricing-blind. The
 *  hidden pricing catalog is deliberately excluded — it legitimately stores
 *  internal amounts and is never publicly exposed. */
export const PRICING_BLIND_TABLES = [
  'settlement_operational_metrics',
  'settlement_metrics_rollup',
  'settlement_runtime_locks',
  'billing_checkout_sessions',
  'billing_settlement_events',
] as const;

/** A read-only snapshot of database facts — collected by the dry-run harness. */
export interface MigrationFacts {
  /** Versions registered in supabase_migrations.schema_migrations. */
  ledgerVersions: string[];
  /** public table names that exist. */
  tables: string[];
  /** function names (proname) that exist. */
  functions: string[];
  /** triggers that exist, as { table, trigger } pairs. */
  triggers: Array<{ table: string; trigger: string }>;
  /** pricing-named columns found on PRICING_BLIND_TABLES — MUST be empty. */
  pricingColumns: Array<{ table: string; column: string }>;
}

export interface GovernanceCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GovernanceReport {
  ok: boolean;
  checks: GovernanceCheck[];
  /** Names of the failed checks — deterministic, in check order. */
  failures: string[];
}

/** True when every settlement migration is registered — a future
 *  `supabase migration up` will then treat them as applied (no duplicate DDL). */
export function settlementMigrationsFullyRegistered(ledgerVersions: string[]): boolean {
  const ledger = new Set(ledgerVersions);
  return SETTLEMENT_MIGRATION_VERSIONS.every((v) => ledger.has(v));
}

/**
 * Evaluate settlement-migration readiness from a database fact snapshot.
 * Deterministic + pure — identical facts always yield an identical report.
 * Checks run in a fixed order; `failures` lists the failed checks in that order.
 */
export function evaluateSettlementMigrationReadiness(facts: MigrationFacts): GovernanceReport {
  const checks: GovernanceCheck[] = [];
  const ledger = new Set(facts.ledgerVersions);
  const tableSet = new Set(facts.tables);
  const fnSet = new Set(facts.functions);
  const triggerSet = new Set(facts.triggers.map((t) => `${t.table}.${t.trigger}`));

  // 1. Ledger reconciliation — all 7 settlement migrations registered.
  const unregistered = SETTLEMENT_MIGRATION_VERSIONS.filter((v) => !ledger.has(v));
  checks.push({
    name: 'ledger_reconciliation',
    ok: unregistered.length === 0,
    detail: unregistered.length === 0
      ? 'all 7 settlement migrations registered in schema_migrations'
      : `unregistered versions: ${unregistered.join(', ')}`,
  });

  // 2. Migration-order integrity — no later version registered while an
  //    earlier required version is missing (out-of-order / corrupt history).
  let corruption = '';
  for (let i = 0; i < SETTLEMENT_MIGRATION_VERSIONS.length; i++) {
    if (ledger.has(SETTLEMENT_MIGRATION_VERSIONS[i])) continue;
    const laterRegistered = SETTLEMENT_MIGRATION_VERSIONS.slice(i + 1).filter((v) => ledger.has(v));
    if (laterRegistered.length > 0) {
      corruption = `${SETTLEMENT_MIGRATION_VERSIONS[i]} missing but later ${laterRegistered.join(', ')} registered`;
      break;
    }
  }
  checks.push({
    name: 'migration_ordering_integrity',
    ok: corruption === '',
    detail: corruption === '' ? 'no out-of-order / partial registration detected' : corruption,
  });

  // 3. Partial application — every required settlement table must exist.
  const missingTables = REQUIRED_SETTLEMENT_TABLES.filter((t) => !tableSet.has(t));
  checks.push({
    name: 'settlement_tables_present',
    ok: missingTables.length === 0,
    detail: missingTables.length === 0
      ? 'all 8 settlement tables present'
      : `partial application — missing tables: ${missingTables.join(', ')}`,
  });

  // 4. Rollup / prune RPC + guard functions present.
  const missingFunctions = REQUIRED_SETTLEMENT_FUNCTIONS.filter((f) => !fnSet.has(f));
  checks.push({
    name: 'rollup_prune_rpc_present',
    ok: missingFunctions.length === 0,
    detail: missingFunctions.length === 0
      ? 'prune RPC + delete guard + immutability function present'
      : `missing functions/RPCs: ${missingFunctions.join(', ')}`,
  });

  // 5. Append-only immutability triggers — an immutability gap is a hard fail.
  const missingTriggers = REQUIRED_IMMUTABILITY_TRIGGERS.filter(
    (t) => !triggerSet.has(`${t.table}.${t.trigger}`),
  );
  checks.push({
    name: 'append_only_immutability_triggers',
    ok: missingTriggers.length === 0,
    detail: missingTriggers.length === 0
      ? 'all 8 append-only / retention-gated triggers present'
      : `immutability gap — missing: ${missingTriggers.map((t) => `${t.table}.${t.trigger}`).join(', ')}`,
  });

  // 6. Pricing-blind — no pricing-named column on a settlement operational table.
  checks.push({
    name: 'pricing_blind',
    ok: facts.pricingColumns.length === 0,
    detail: facts.pricingColumns.length === 0
      ? 'no pricing columns on settlement operational tables'
      : `pricing leakage: ${facts.pricingColumns.map((c) => `${c.table}.${c.column}`).join(', ')}`,
  });

  const failures = checks.filter((c) => !c.ok).map((c) => c.name);
  return { ok: failures.length === 0, checks, failures };
}

// ── migration-prefix collision protection ───────────────────────────────────
// Two settlement prefixes collide with unrelated infra migrations: a version
// registered in the ledger covers EVERY file sharing that prefix, so before a
// colliding version is registered all its sibling artifacts must be present.

/** Per-version migration filenames: the settlement file + any known siblings
 *  sharing the same numeric prefix. */
export const SETTLEMENT_MIGRATION_FILES: Record<string, { settlement: string; siblings: string[] }> = {
  '20260714': { settlement: '20260714_payment_provider_config.sql', siblings: ['20260714_fix_queue_fn_search_path.sql'] },
  '20260717': { settlement: '20260717_hidden_billing_catalog.sql', siblings: [] },
  '20260718': { settlement: '20260718_hidden_billing_audit_and_checkout_sessions.sql', siblings: ['20260718_harden_fn_search_path.sql'] },
  '20260719': { settlement: '20260719_settlement_lifecycle_foundation.sql', siblings: [] },
  '20260720': { settlement: '20260720_settlement_locks_and_metrics.sql', siblings: [] },
  '20260721': { settlement: '20260721_settlement_metrics_rollup.sql', siblings: [] },
  '20260722': { settlement: '20260722_settlement_metrics_prune.sql', siblings: [] },
};

export type CollisionFindingKind =
  | 'ok'
  | 'collision_resolved'
  | 'partial_sibling'
  | 'missing_settlement_artifact'
  | 'unexpected_collision';

export interface CollisionFinding {
  version: string;
  kind: CollisionFindingKind;
  detail: string;
}

export interface CollisionReport {
  ok: boolean;
  findings: CollisionFinding[];
  /** Versions whose numeric prefix is shared by more than one migration file. */
  collisions: string[];
  /** Versions that must NOT be auto-registered (a sibling/artifact hazard). */
  blockers: string[];
}

/**
 * Detect duplicate-prefix collisions and verify sibling artifacts. Pure +
 * deterministic. A colliding version is safe only when ALL its sibling files
 * are present; a partial sibling set, a missing settlement file, or an
 * unrecognized prefix-sharing file is a deterministic blocker.
 */
export function evaluateMigrationCollisionRisk(migrationFiles: string[]): CollisionReport {
  const fileSet = new Set(migrationFiles);
  const findings: CollisionFinding[] = [];
  const collisions: string[] = [];
  const blockers: string[] = [];

  for (const version of SETTLEMENT_MIGRATION_VERSIONS) {
    const manifest = SETTLEMENT_MIGRATION_FILES[version];
    const onDiskWithPrefix = migrationFiles.filter((f) => f.startsWith(`${version}_`));
    const isCollision = manifest.siblings.length > 0;
    if (isCollision) collisions.push(version);

    if (!fileSet.has(manifest.settlement)) {
      findings.push({ version, kind: 'missing_settlement_artifact',
        detail: `settlement migration file ${manifest.settlement} is absent from the migrations directory` });
      blockers.push(version);
      continue;
    }
    const missingSiblings = manifest.siblings.filter((s) => !fileSet.has(s));
    if (missingSiblings.length > 0) {
      findings.push({ version, kind: 'partial_sibling',
        detail: `colliding prefix ${version} is missing sibling artifact(s): ${missingSiblings.join(', ')}` });
      blockers.push(version);
      continue;
    }
    const expected = new Set([manifest.settlement, ...manifest.siblings]);
    const unexpected = onDiskWithPrefix.filter((f) => !expected.has(f));
    if (unexpected.length > 0) {
      findings.push({ version, kind: 'unexpected_collision',
        detail: `unrecognized file(s) sharing prefix ${version}: ${unexpected.join(', ')}` });
      blockers.push(version);
      continue;
    }
    findings.push({
      version,
      kind: isCollision ? 'collision_resolved' : 'ok',
      detail: isCollision
        ? `prefix ${version} collides with ${manifest.siblings.join(', ')} — all siblings present, safe to register`
        : `prefix ${version} is unique`,
    });
  }
  return { ok: blockers.length === 0, findings, collisions, blockers };
}

/**
 * Migration-ledger / schema parity. The settlement schema and the migration
 * ledger must agree: schema fully applied ⟺ all versions registered. A schema
 * that is applied but unregistered (the divergence the reconciliation utility
 * fixes), or a ledger ahead of the schema, is a parity violation.
 */
export function evaluateLedgerSchemaParity(facts: MigrationFacts): GovernanceCheck {
  const tableSet = new Set(facts.tables);
  const fnSet = new Set(facts.functions);
  const triggerSet = new Set(facts.triggers.map((t) => `${t.table}.${t.trigger}`));
  const schemaComplete =
    REQUIRED_SETTLEMENT_TABLES.every((t) => tableSet.has(t)) &&
    REQUIRED_SETTLEMENT_FUNCTIONS.every((f) => fnSet.has(f)) &&
    REQUIRED_IMMUTABILITY_TRIGGERS.every((t) => triggerSet.has(`${t.table}.${t.trigger}`));
  const ledgerComplete = settlementMigrationsFullyRegistered(facts.ledgerVersions);

  if (schemaComplete === ledgerComplete) {
    return { name: 'migration_ledger_schema_parity', ok: true,
      detail: schemaComplete
        ? 'schema applied and ledger fully reconciled — in parity'
        : 'schema not applied and ledger not registered — consistently pending' };
  }
  return {
    name: 'migration_ledger_schema_parity',
    ok: false,
    detail: schemaComplete
      ? 'schema applied but ledger NOT reconciled — run reconcileSettlementMigrationLedger'
      : 'ledger registered but schema NOT fully applied — phantom ledger entries',
  };
}

/**
 * Offline governance checks — runnable from the filesystem alone (NO DB).
 * Covers migration-manifest, collision, migration-order, and governance-layer
 * pricing-blind validation. Used when the database is unreachable so governance
 * tooling still provides deterministic guidance. Pure + deterministic.
 */
export function runOfflineGovernanceChecks(migrationFiles: string[]): GovernanceReport {
  const checks: GovernanceCheck[] = [];
  const fileSet = new Set(migrationFiles);
  const collision = evaluateMigrationCollisionRisk(migrationFiles);

  // migration_manifest_validation — every settlement migration file is present.
  const missingSettlement = SETTLEMENT_MIGRATION_VERSIONS.filter(
    (v) => !fileSet.has(SETTLEMENT_MIGRATION_FILES[v].settlement),
  );
  checks.push({
    name: 'migration_manifest_validation',
    ok: missingSettlement.length === 0,
    detail: missingSettlement.length === 0
      ? 'all 7 settlement migration files present on disk'
      : `missing settlement files: ${missingSettlement.map((v) => SETTLEMENT_MIGRATION_FILES[v].settlement).join(', ')}`,
  });

  // collision_validation — duplicate-prefix / sibling-artifact safety.
  checks.push({
    name: 'collision_validation',
    ok: collision.ok,
    detail: collision.ok
      ? 'no duplicate-prefix collision hazards'
      : `collision blockers: ${collision.blockers.join(', ')}`,
  });

  // migration_order_validation — the canonical version sequence is intact.
  const ascending = SETTLEMENT_MIGRATION_VERSIONS.every((v, i, a) => i === 0 || a[i - 1] < v);
  checks.push({
    name: 'migration_order_validation',
    ok: ascending && missingSettlement.length === 0,
    detail: !ascending
      ? 'settlement version manifest is not strictly ascending'
      : missingSettlement.length === 0
        ? 'settlement migration order intact'
        : 'order indeterminate — settlement files missing',
  });

  // pricing_blind_validation — the governance LAYER (manifest + collision
  // report) carries no pricing field; the DB-column scan is the online check.
  const serialized = JSON.stringify({ files: SETTLEMENT_MIGRATION_FILES, collision }).toLowerCase();
  const leak = ['"amount"', '"price"', '"pricing"', '"revenue"', '"invoice"', '"subtotal"'].find(
    (f) => serialized.includes(f),
  );
  checks.push({
    name: 'pricing_blind_validation',
    ok: !leak,
    detail: leak ? `governance manifest leaks ${leak}` : 'governance manifest + collision report pricing-blind',
  });

  const failures = checks.filter((c) => !c.ok).map((c) => c.name);
  return { ok: failures.length === 0, checks, failures };
}
