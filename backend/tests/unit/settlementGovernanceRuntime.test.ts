/**
 * settlementGovernanceRuntime — runtime-reachability + offline-governance tests.
 *
 * Covers: runtime-state classification (docker_unavailable / db_unreachable /
 * partial_stack / ready), structured blocked-state reporting, offline
 * governance execution, deterministic exit behavior, and hidden-pricing
 * preservation. All logic is pure / dependency-injected — NO Docker, NO DB.
 */

import {
  classifyRuntimeState,
  buildRuntimeDiagnostics,
  formatRuntimeDiagnostics,
  isRuntimeReady,
  DB_DEPENDENT_OPERATIONS,
  OFFLINE_GOVERNANCE_CHECKS,
  type RuntimeProbe,
} from '../../services/billing/payments/settlementGovernanceRuntime';
import { runOfflineGovernanceChecks } from '../../services/billing/payments/settlementMigrationGovernance';

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
const probe = (dockerReachable: boolean, dbReachable: boolean): RuntimeProbe => ({ dockerReachable, dbReachable });

describe('runtime — state classification', () => {
  test('docker ✓ db ✓ → ready', () => {
    expect(classifyRuntimeState(probe(true, true))).toBe('ready');
  });
  test('docker ✗ db ✗ → docker_unavailable', () => {
    expect(classifyRuntimeState(probe(false, false))).toBe('docker_unavailable');
  });
  test('docker ✓ db ✗ → db_unreachable', () => {
    expect(classifyRuntimeState(probe(true, false))).toBe('db_unreachable');
  });
  test('docker ✗ db ✓ → partial_stack', () => {
    expect(classifyRuntimeState(probe(false, true))).toBe('partial_stack');
  });
});

describe('runtime — structured blocked-state reporting', () => {
  test('the diagnostic carries exactly the six required fields', () => {
    const diag = buildRuntimeDiagnostics(probe(false, false));
    expect(Object.keys(diag).sort()).toEqual([
      'blocked_operations', 'db_reachable', 'docker_reachable',
      'executable_offline_checks', 'required_operator_action', 'runtime_state',
    ]);
  });

  test('a ready runtime has no blocked operations and a no-op action', () => {
    const diag = buildRuntimeDiagnostics(probe(true, true));
    expect(diag.runtime_state).toBe('ready');
    expect(diag.blocked_operations).toEqual([]);
    expect(diag.executable_offline_checks).toEqual([...OFFLINE_GOVERNANCE_CHECKS]);
    expect(diag.required_operator_action).toContain('ready');
  });

  test('docker_unavailable blocks every DB-dependent operation', () => {
    const diag = buildRuntimeDiagnostics(probe(false, false));
    expect(diag.runtime_state).toBe('docker_unavailable');
    expect(diag.docker_reachable).toBe(false);
    expect(diag.db_reachable).toBe(false);
    expect(diag.blocked_operations).toEqual([...DB_DEPENDENT_OPERATIONS]);
    expect(diag.executable_offline_checks).toEqual([...OFFLINE_GOVERNANCE_CHECKS]);
    expect(diag.required_operator_action).toMatch(/docker/i);
  });

  test('db_unreachable surfaces a supabase-start operator action', () => {
    const diag = buildRuntimeDiagnostics(probe(true, false));
    expect(diag.runtime_state).toBe('db_unreachable');
    expect(diag.blocked_operations).toEqual([...DB_DEPENDENT_OPERATIONS]);
    expect(diag.required_operator_action).toMatch(/supabase start/i);
  });

  test('partial_stack is reported with its own operator action', () => {
    const diag = buildRuntimeDiagnostics(probe(false, true));
    expect(diag.runtime_state).toBe('partial_stack');
    expect(diag.required_operator_action).toMatch(/partial stack/i);
  });

  test('the formatted diagnostic is plain key/value text (no stack trace)', () => {
    const text = formatRuntimeDiagnostics(buildRuntimeDiagnostics(probe(false, false)));
    expect(text).toContain('runtime_state');
    expect(text).toContain('blocked_operations');
    expect(text).toContain('required_operator_action');
    expect(text).not.toMatch(/\bat\s+.+\(.+:\d+:\d+\)/); // no stack-frame lines
  });
});

describe('runtime — offline governance execution', () => {
  test('a complete migration set passes every offline check', () => {
    const report = runOfflineGovernanceChecks(allMigrationFiles());
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual([...OFFLINE_GOVERNANCE_CHECKS]);
  });

  test('a missing settlement file fails migration_manifest_validation', () => {
    const files = allMigrationFiles().filter((f) => f !== '20260721_settlement_metrics_rollup.sql');
    const report = runOfflineGovernanceChecks(files);
    expect(report.ok).toBe(false);
    expect(report.failures).toContain('migration_manifest_validation');
  });

  test('a missing sibling artifact fails collision_validation', () => {
    const files = allMigrationFiles().filter((f) => f !== '20260714_fix_queue_fn_search_path.sql');
    const report = runOfflineGovernanceChecks(files);
    expect(report.ok).toBe(false);
    expect(report.failures).toContain('collision_validation');
  });

  test('offline checks run without any DB or Docker dependency', () => {
    // Pure input → deterministic output; no environment is consulted.
    const report = runOfflineGovernanceChecks(allMigrationFiles());
    expect(report.checks).toHaveLength(4);
  });
});

describe('runtime — deterministic exit behavior', () => {
  test('isRuntimeReady is true only for the ready state', () => {
    expect(isRuntimeReady('ready')).toBe(true);
    expect(isRuntimeReady('docker_unavailable')).toBe(false);
    expect(isRuntimeReady('db_unreachable')).toBe(false);
    expect(isRuntimeReady('partial_stack')).toBe(false);
  });

  test('identical probes yield an identical diagnostic (deterministic)', () => {
    expect(buildRuntimeDiagnostics(probe(false, false)))
      .toEqual(buildRuntimeDiagnostics(probe(false, false)));
  });

  test('offline governance execution is deterministic', () => {
    const a = runOfflineGovernanceChecks(allMigrationFiles());
    const b = runOfflineGovernanceChecks(allMigrationFiles());
    expect(b).toEqual(a);
  });
});

describe('runtime — hidden-pricing preservation', () => {
  test('the runtime diagnostic carries no pricing fields', () => {
    const serialized = JSON.stringify(buildRuntimeDiagnostics(probe(false, false))).toLowerCase();
    for (const f of ['"amount"', '"price"', '"pricing"', '"revenue"', '"invoice"']) {
      expect(serialized).not.toContain(f);
    }
  });

  test('the offline governance report carries no pricing fields', () => {
    const serialized = JSON.stringify(runOfflineGovernanceChecks(allMigrationFiles())).toLowerCase();
    for (const f of ['"amount"', '"price"', '"pricing"', '"revenue"', '"invoice"']) {
      expect(serialized).not.toContain(f);
    }
  });
});
