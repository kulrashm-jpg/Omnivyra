/**
 * reconcileSettlementMigrationLedger — ledger reconciliation + collision tests.
 *
 * Covers: missing-version registration, duplicate-prefix detection, sibling-
 * artifact verification, dry-run correctness, duplicate-apply prevention,
 * migration-ledger/schema parity, and hidden-pricing preservation. All logic
 * is pure / dependency-injected — NO DB, NO filesystem.
 */

import {
  planSettlementLedgerReconciliation,
  reconcileSettlementMigrationLedger,
  type LedgerWriter,
} from '../../services/billing/payments/reconcileSettlementMigrationLedger';
import {
  evaluateMigrationCollisionRisk,
  evaluateLedgerSchemaParity,
  SETTLEMENT_MIGRATION_VERSIONS,
  REQUIRED_SETTLEMENT_TABLES,
  REQUIRED_SETTLEMENT_FUNCTIONS,
  REQUIRED_IMMUTABILITY_TRIGGERS,
  type MigrationFacts,
} from '../../services/billing/payments/settlementMigrationGovernance';

/** Every settlement migration file + the two known infra siblings. */
function allMigrationFiles(): string[] {
  return [
    '20260714_payment_provider_config.sql',
    '20260714_fix_queue_fn_search_path.sql',
    '20260717_hidden_billing_catalog.sql',
    '20260718_hidden_billing_audit_and_checkout_sessions.sql',
    '20260718_harden_fn_search_path.sql',
    '20260719_settlement_lifecycle_foundation.sql',
    '20260720_settlement_locks_and_metrics.sql',
    '20260721_settlement_metrics_rollup.sql',
    '20260722_settlement_metrics_prune.sql',
  ];
}

function memWriter(ledger: string[], files: string[]) {
  const registered = [...ledger];
  const writes: Array<{ version: string; name: string }> = [];
  const writer: LedgerWriter = {
    readLedgerVersions: async () => [...registered],
    readMigrationFiles: async () => [...files],
    registerVersions: async (rows) => {
      for (const r of rows) {
        writes.push(r);
        if (!registered.includes(r.version)) registered.push(r.version);
      }
    },
  };
  return { writer, registered, writes };
}

function facts(ledgerVersions: string[], schemaComplete = true): MigrationFacts {
  return {
    ledgerVersions,
    tables: schemaComplete ? [...REQUIRED_SETTLEMENT_TABLES] : [],
    functions: schemaComplete ? [...REQUIRED_SETTLEMENT_FUNCTIONS] : [],
    triggers: schemaComplete ? REQUIRED_IMMUTABILITY_TRIGGERS.map((t) => ({ table: t.table, trigger: t.trigger })) : [],
    pricingColumns: [],
  };
}

describe('ledger reconciliation — missing-version registration', () => {
  test('an empty ledger registers all 7 settlement versions', async () => {
    const { writer, registered, writes } = memWriter([], allMigrationFiles());
    const r = await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    expect(r.ok).toBe(true);
    expect(r.registered.sort()).toEqual([...SETTLEMENT_MIGRATION_VERSIONS].sort());
    expect(writes).toHaveLength(7);
    expect(registered.sort()).toEqual([...SETTLEMENT_MIGRATION_VERSIONS].sort());
  });

  test('only the missing versions are registered (idempotent skip of present ones)', async () => {
    const { writer, writes } = memWriter(['20260714', '20260717'], allMigrationFiles());
    const r = await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    expect(r.plan.alreadyRegistered.sort()).toEqual(['20260714', '20260717']);
    expect(r.registered.sort()).toEqual(['20260718', '20260719', '20260720', '20260721', '20260722']);
    expect(writes).toHaveLength(5);
  });

  test('a second reconciliation run registers nothing (idempotent)', async () => {
    const { writer } = memWriter([], allMigrationFiles());
    const first = await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    const second = await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    expect(first.registered).toHaveLength(7);
    expect(second.registered).toHaveLength(0);
    expect(second.plan.toRegister).toEqual([]);
  });

  test('the registered ledger name is derived from the settlement file', async () => {
    const { writer, writes } = memWriter([], allMigrationFiles());
    await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    const row = writes.find((w) => w.version === '20260722');
    expect(row?.name).toBe('settlement_metrics_prune');
  });
});

describe('ledger reconciliation — duplicate-prefix detection', () => {
  test('the colliding prefixes 20260714 and 20260718 are detected', () => {
    const report = evaluateMigrationCollisionRisk(allMigrationFiles());
    expect(report.collisions.sort()).toEqual(['20260714', '20260718']);
    expect(report.ok).toBe(true); // both siblings present → safe
  });

  test('a resolved collision is marked collision_resolved, a unique prefix ok', () => {
    const report = evaluateMigrationCollisionRisk(allMigrationFiles());
    expect(report.findings.find((f) => f.version === '20260714')!.kind).toBe('collision_resolved');
    expect(report.findings.find((f) => f.version === '20260719')!.kind).toBe('ok');
  });

  test('an unrecognized file sharing a settlement prefix → unexpected_collision', () => {
    const files = [...allMigrationFiles(), '20260719_some_unrelated_change.sql'];
    const report = evaluateMigrationCollisionRisk(files);
    expect(report.ok).toBe(false);
    expect(report.findings.find((f) => f.version === '20260719')!.kind).toBe('unexpected_collision');
    expect(report.blockers).toContain('20260719');
  });
});

describe('ledger reconciliation — sibling-artifact verification', () => {
  test('a missing sibling artifact blocks the colliding version (partial_sibling)', async () => {
    // 20260714's infra sibling is absent.
    const files = allMigrationFiles().filter((f) => f !== '20260714_fix_queue_fn_search_path.sql');
    const report = evaluateMigrationCollisionRisk(files);
    expect(report.findings.find((f) => f.version === '20260714')!.kind).toBe('partial_sibling');
    expect(report.blockers).toContain('20260714');

    const { writer, writes } = memWriter([], files);
    const r = await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    expect(r.ok).toBe(false);
    expect(r.plan.blocked.map((b) => b.version)).toContain('20260714');
    expect(writes.find((w) => w.version === '20260714')).toBeUndefined(); // never registered
  });

  test('a missing settlement file → missing_settlement_artifact blocker', async () => {
    const files = allMigrationFiles().filter((f) => f !== '20260722_settlement_metrics_prune.sql');
    const { writer } = memWriter([], files);
    const r = await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    expect(r.ok).toBe(false);
    expect(r.plan.blocked.map((b) => b.version)).toContain('20260722');
  });

  test('a blocked plan writes nothing at all', async () => {
    const files = allMigrationFiles().filter((f) => f !== '20260722_settlement_metrics_prune.sql');
    const { writer, writes } = memWriter([], files);
    await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    expect(writes).toHaveLength(0);
  });

  test('migration-order corruption fails the plan deterministically', () => {
    // 20260720 registered while every earlier settlement version is missing.
    const plan = planSettlementLedgerReconciliation({
      ledgerVersions: ['20260720'], migrationFiles: allMigrationFiles(),
    });
    expect(plan.ok).toBe(false);
    expect(plan.orderCorruption).toContain('20260720');
  });
});

describe('ledger reconciliation — dry-run correctness', () => {
  test('--dry-run writes nothing but reports what would be registered', async () => {
    const { writer, writes, registered } = memWriter([], allMigrationFiles());
    const r = await reconcileSettlementMigrationLedger({ dryRun: true }, writer);
    expect(r.dryRun).toBe(true);
    expect(r.registered).toEqual([]);          // no writes performed
    expect(writes).toHaveLength(0);
    expect(registered).toEqual([]);
    expect(r.plan.toRegister.sort()).toEqual([...SETTLEMENT_MIGRATION_VERSIONS].sort());
  });

  test('--dry-run still surfaces collisions and blockers', async () => {
    const files = allMigrationFiles().filter((f) => f !== '20260718_harden_fn_search_path.sql');
    const { writer } = memWriter([], files);
    const r = await reconcileSettlementMigrationLedger({ dryRun: true }, writer);
    expect(r.plan.collisions).toContain('20260718');
    expect(r.plan.blocked.map((b) => b.version)).toContain('20260718');
  });
});

describe('ledger reconciliation — duplicate-apply prevention', () => {
  test('a fully-registered ledger registers nothing on a real run', async () => {
    const { writer, writes } = memWriter([...SETTLEMENT_MIGRATION_VERSIONS], allMigrationFiles());
    const r = await reconcileSettlementMigrationLedger({ dryRun: false }, writer);
    expect(r.ok).toBe(true);
    expect(r.registered).toEqual([]);
    expect(writes).toHaveLength(0);
    expect(r.plan.alreadyRegistered).toHaveLength(7);
  });
});

describe('ledger reconciliation — migration-ledger/schema parity', () => {
  test('schema applied + ledger fully reconciled → parity OK', () => {
    const check = evaluateLedgerSchemaParity(facts([...SETTLEMENT_MIGRATION_VERSIONS], true));
    expect(check.ok).toBe(true);
  });

  test('schema applied but ledger NOT reconciled → parity violation', () => {
    const check = evaluateLedgerSchemaParity(facts(['20260714'], true));
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('ledger NOT reconciled');
  });

  test('ledger registered but schema NOT applied → phantom-entry parity violation', () => {
    const check = evaluateLedgerSchemaParity(facts([...SETTLEMENT_MIGRATION_VERSIONS], false));
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('schema NOT fully applied');
  });

  test('nothing applied and nothing registered → consistently pending (parity OK)', () => {
    const check = evaluateLedgerSchemaParity(facts([], false));
    expect(check.ok).toBe(true);
  });
});

describe('ledger reconciliation — hidden-pricing preservation', () => {
  test('the reconciliation plan carries no pricing fields', () => {
    const plan = planSettlementLedgerReconciliation({ ledgerVersions: [], migrationFiles: allMigrationFiles() });
    const serialized = JSON.stringify(plan).toLowerCase();
    for (const f of ['"amount"', '"price"', '"pricing"', '"revenue"', '"invoice"', '"subtotal"']) {
      expect(serialized).not.toContain(f);
    }
  });

  test('the collision report carries no pricing fields', () => {
    const report = evaluateMigrationCollisionRisk(allMigrationFiles());
    const serialized = JSON.stringify(report).toLowerCase();
    for (const f of ['"amount"', '"price"', '"pricing"', '"revenue"', '"invoice"']) {
      expect(serialized).not.toContain(f);
    }
  });
});
