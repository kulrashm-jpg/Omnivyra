/**
 * settlementMigrationGovernance — dry-run readiness evaluator tests.
 *
 * Covers: ledger-reconciliation correctness, duplicate-apply prevention,
 * dry-run governance validation, migration-order validation, immutability
 * verification, and hidden-pricing preservation. The evaluator is pure — NO DB.
 */

import {
  evaluateSettlementMigrationReadiness,
  settlementMigrationsFullyRegistered,
  SETTLEMENT_MIGRATION_VERSIONS,
  REQUIRED_SETTLEMENT_TABLES,
  REQUIRED_SETTLEMENT_FUNCTIONS,
  REQUIRED_IMMUTABILITY_TRIGGERS,
  RETIRED_HIDDEN_BILLING_TABLES,
  RETIRED_HIDDEN_BILLING_AUDIT_TRIGGERS,
  type MigrationFacts,
} from '../../services/billing/payments/settlementMigrationGovernance';

/** A fully migration-ready fact snapshot. */
function completeFacts(): MigrationFacts {
  return {
    ledgerVersions: [...SETTLEMENT_MIGRATION_VERSIONS],
    tables: [...REQUIRED_SETTLEMENT_TABLES],
    functions: [...REQUIRED_SETTLEMENT_FUNCTIONS],
    triggers: REQUIRED_IMMUTABILITY_TRIGGERS.map((t) => ({ table: t.table, trigger: t.trigger })),
    pricingColumns: [],
  };
}
const failed = (facts: MigrationFacts) => evaluateSettlementMigrationReadiness(facts).failures;

describe('migration governance — fully ready', () => {
  test('a complete fact snapshot passes every check', () => {
    const report = evaluateSettlementMigrationReadiness(completeFacts());
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.checks).toHaveLength(7);
  });
});

describe('migration governance — ledger-reconciliation correctness', () => {
  test('an unregistered settlement version fails ledger_reconciliation', () => {
    const facts = completeFacts();
    facts.ledgerVersions = SETTLEMENT_MIGRATION_VERSIONS.filter((v) => v !== '20260721');
    const report = evaluateSettlementMigrationReadiness(facts);
    expect(report.failures).toContain('ledger_reconciliation');
    expect(report.checks.find((c) => c.name === 'ledger_reconciliation')!.detail).toContain('20260721');
  });

  test('all 7 versions registered → ledger_reconciliation passes', () => {
    expect(failed(completeFacts())).not.toContain('ledger_reconciliation');
  });
});

describe('migration governance — duplicate-apply prevention', () => {
  test('fully-registered ledger arms duplicate-apply prevention', () => {
    expect(settlementMigrationsFullyRegistered([...SETTLEMENT_MIGRATION_VERSIONS])).toBe(true);
  });
  test('a missing version leaves duplicate-apply prevention NOT armed', () => {
    expect(settlementMigrationsFullyRegistered(['20260714', '20260717'])).toBe(false);
  });
  test('extra unrelated ledger versions do not affect the determination', () => {
    expect(settlementMigrationsFullyRegistered([...SETTLEMENT_MIGRATION_VERSIONS, '20259999', '20260101'])).toBe(true);
  });
});

describe('migration governance — migration-order validation', () => {
  test('a missing middle version with later versions registered → ordering corruption', () => {
    const facts = completeFacts();
    // 20260719 missing while 20260720/21/22 are registered.
    facts.ledgerVersions = SETTLEMENT_MIGRATION_VERSIONS.filter((v) => v !== '20260719');
    const report = evaluateSettlementMigrationReadiness(facts);
    expect(report.failures).toContain('migration_ordering_integrity');
    expect(report.checks.find((c) => c.name === 'migration_ordering_integrity')!.detail).toContain('20260719');
  });

  test('only the LAST version missing → no ordering corruption (just reconciliation)', () => {
    const facts = completeFacts();
    facts.ledgerVersions = SETTLEMENT_MIGRATION_VERSIONS.slice(0, 6); // 20260722 absent
    const report = evaluateSettlementMigrationReadiness(facts);
    expect(report.failures).toContain('ledger_reconciliation');
    expect(report.failures).not.toContain('migration_ordering_integrity');
  });
});

describe('migration governance — dry-run governance validation', () => {
  test('a missing settlement table → partial-application detected', () => {
    const facts = completeFacts();
    facts.tables = REQUIRED_SETTLEMENT_TABLES.filter((t) => t !== 'settlement_metrics_rollup');
    const report = evaluateSettlementMigrationReadiness(facts);
    expect(report.failures).toContain('settlement_tables_present');
    expect(report.checks.find((c) => c.name === 'settlement_tables_present')!.detail).toContain('settlement_metrics_rollup');
  });

  test('a missing prune RPC → rollup_prune_rpc_present fails', () => {
    const facts = completeFacts();
    facts.functions = REQUIRED_SETTLEMENT_FUNCTIONS.filter((f) => f !== 'settlement_metrics_prune_rolled');
    const report = evaluateSettlementMigrationReadiness(facts);
    expect(report.failures).toContain('rollup_prune_rpc_present');
  });

  test('the report is deterministic — identical facts yield an identical report', () => {
    const a = evaluateSettlementMigrationReadiness(completeFacts());
    const b = evaluateSettlementMigrationReadiness(completeFacts());
    expect(b).toEqual(a);
  });

  test('checks always run in a fixed order', () => {
    const names = evaluateSettlementMigrationReadiness(completeFacts()).checks.map((c) => c.name);
    expect(names).toEqual([
      'ledger_reconciliation', 'migration_ordering_integrity', 'settlement_tables_present',
      'rollup_prune_rpc_present', 'append_only_immutability_triggers', 'pricing_blind',
      'retired_hidden_billing_frozen',
    ]);
  });
});

describe('migration governance — immutability verification', () => {
  test('a missing append-only trigger → immutability gap detected', () => {
    const facts = completeFacts();
    facts.triggers = facts.triggers.filter((t) => t.trigger !== 'som_immutable_update');
    const report = evaluateSettlementMigrationReadiness(facts);
    expect(report.failures).toContain('append_only_immutability_triggers');
    expect(report.checks.find((c) => c.name === 'append_only_immutability_triggers')!.detail)
      .toContain('settlement_operational_metrics.som_immutable_update');
  });

  test('a missing retention-gated delete trigger → immutability gap detected', () => {
    const facts = completeFacts();
    facts.triggers = facts.triggers.filter((t) => t.trigger !== 'som_retention_gated_delete');
    expect(failed(facts)).toContain('append_only_immutability_triggers');
  });

  test('all required immutability triggers present → no immutability gap', () => {
    expect(failed(completeFacts())).not.toContain('append_only_immutability_triggers');
  });
});

describe('migration governance — hidden-pricing preservation', () => {
  test('a pricing-named column on a settlement operational table fails pricing_blind', () => {
    const facts = completeFacts();
    facts.pricingColumns = [{ table: 'settlement_operational_metrics', column: 'amount_cents' }];
    const report = evaluateSettlementMigrationReadiness(facts);
    expect(report.failures).toContain('pricing_blind');
  });

  test('a clean snapshot keeps pricing_blind passing', () => {
    expect(failed(completeFacts())).not.toContain('pricing_blind');
  });

  test('the governance report itself carries no pricing fields', () => {
    const report = evaluateSettlementMigrationReadiness(completeFacts());
    const serialized = JSON.stringify(report).toLowerCase();
    for (const f of ['"amount"', '"price"', '"pricing"', '"revenue"', '"invoice"', '"subtotal"']) {
      expect(serialized).not.toContain(f);
    }
  });
});

describe('migration governance — retired hidden billing stays frozen (e9 C97 1(a); 05)', () => {
  const frozen = (facts: MigrationFacts) =>
    evaluateSettlementMigrationReadiness(facts).checks.find((c) => c.name === 'retired_hidden_billing_frozen')!;

  // The decision table is TOTAL (05): 2 tables x audit-trigger completeness, every row asserted.
  const ALL = RETIRED_HIDDEN_BILLING_AUDIT_TRIGGERS.map((t) => t.trigger);
  test.each([
    // catalog, audit, triggers present,                ok,    detail fragment
    [false, false, [] as string[],                     true,  'absent (both)'],
    [false, false, ALL,                                true,  'absent (both)'],
    [true,  false, [] as string[],                     false, 'partial application'],
    [true,  false, ALL,                                false, 'partial application'],
    [true,  true,  ALL,                                true,  'present (both) and the audit trail is frozen'],
    [true,  true,  [] as string[],                     false, 'unfrozen'],
    [false, true,  ALL,                                true,  'present and frozen (catalog absent)'],
    [false, true,  [] as string[],                     false, 'unfrozen'],
  ] as const)('catalog=%p audit=%p triggers=%j → ok=%p (%s)', (catalog, audit, triggers, ok, fragment) => {
    const facts = completeFacts();
    if (catalog) facts.tables.push('hidden_billing_catalog');
    if (audit) facts.tables.push('hidden_billing_catalog_audit');
    facts.triggers.push(...triggers.map((trigger) => ({ table: 'hidden_billing_catalog_audit', trigger })));
    const c = frozen(facts);
    expect(c.ok).toBe(ok);
    expect(c.detail).toContain(fragment);
    expect(evaluateSettlementMigrationReadiness(facts).failures).toEqual(ok ? [] : ['retired_hidden_billing_frozen']);
  });

  test.each(RETIRED_HIDDEN_BILLING_AUDIT_TRIGGERS.map((t) => t.trigger))(
    'audit table present but %s missing → retired_hidden_billing_frozen FAILS', (missing) => {
      const facts = completeFacts();
      facts.tables.push('hidden_billing_catalog_audit');
      facts.triggers.push(...RETIRED_HIDDEN_BILLING_AUDIT_TRIGGERS.filter((t) => t.trigger !== missing).map((t) => ({ ...t })));
      const report = evaluateSettlementMigrationReadiness(facts);
      expect(report.failures).toEqual(['retired_hidden_billing_frozen']);
      expect(frozen(facts).detail).toContain(missing);
    });

  test('retired objects are no longer REQUIRED', () => {
    for (const t of RETIRED_HIDDEN_BILLING_TABLES) expect(REQUIRED_SETTLEMENT_TABLES as readonly string[]).not.toContain(t);
    for (const t of RETIRED_HIDDEN_BILLING_AUDIT_TRIGGERS) {
      expect(REQUIRED_IMMUTABILITY_TRIGGERS.map((r) => r.trigger) as string[]).not.toContain(t.trigger);
    }
  });
});
