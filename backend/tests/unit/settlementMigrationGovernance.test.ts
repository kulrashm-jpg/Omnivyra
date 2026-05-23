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
    expect(report.checks).toHaveLength(6);
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

  test('all 8 immutability triggers present → no immutability gap', () => {
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
