/**
 * Settlement governance runtime-environment guard (INTERNAL).
 *
 * Detects whether the Docker daemon and the local Supabase database are
 * reachable, classifies the runtime state, and produces a deterministic,
 * structured blocked-state diagnostic so settlement governance tooling degrades
 * predictably (and without stack traces) when the stack is unavailable.
 *
 * The classification + diagnostics builders are PURE and deterministic — the
 * only I/O is `probeRuntime`, which is never unit-tested directly. STRICTLY
 * governance/runtime — no settlement activation, no pricing, no DB writes.
 */

import { execSync } from 'child_process';
import { Client } from 'pg';

export type RuntimeState = 'ready' | 'docker_unavailable' | 'db_unreachable' | 'partial_stack';

export interface RuntimeProbe {
  dockerReachable: boolean;
  dbReachable: boolean;
}

/** Operations that REQUIRE a reachable database — blocked when it is not. */
export const DB_DEPENDENT_OPERATIONS = [
  'ledger_reconciliation',
  'governance_db_verification',
  'migration_up',
  'ledger_schema_parity',
] as const;

/** Governance checks that run from the filesystem alone — always executable. */
export const OFFLINE_GOVERNANCE_CHECKS = [
  'migration_manifest_validation',
  'collision_validation',
  'migration_order_validation',
  'pricing_blind_validation',
] as const;

const OPERATOR_ACTION: Record<RuntimeState, string> = {
  ready: 'none — runtime ready; proceed with governance operations.',
  docker_unavailable:
    'Start the Docker daemon (Docker Desktop), then run `supabase start` to bring up the local stack, then re-run.',
  db_unreachable:
    'Docker is running but the local Supabase database is unreachable — run `supabase start`, then re-run.',
  partial_stack:
    'Partial stack — the database is reachable but the Docker control plane is not; verify the target database and stack consistency before proceeding.',
};

/**
 * Classify the runtime from a reachability probe. Deterministic 2×2 mapping:
 *   docker ✓ db ✓ → ready
 *   docker ✗ db ✗ → docker_unavailable
 *   docker ✓ db ✗ → db_unreachable
 *   docker ✗ db ✓ → partial_stack (anomalous — DB up, control plane down)
 */
export function classifyRuntimeState(probe: RuntimeProbe): RuntimeState {
  if (probe.dockerReachable && probe.dbReachable) return 'ready';
  if (!probe.dockerReachable && !probe.dbReachable) return 'docker_unavailable';
  if (probe.dockerReachable && !probe.dbReachable) return 'db_unreachable';
  return 'partial_stack';
}

export interface RuntimeDiagnostics {
  runtime_state: RuntimeState;
  docker_reachable: boolean;
  db_reachable: boolean;
  blocked_operations: string[];
  executable_offline_checks: string[];
  required_operator_action: string;
}

/** Build the deterministic structured blocked-state diagnostic. */
export function buildRuntimeDiagnostics(probe: RuntimeProbe): RuntimeDiagnostics {
  const runtime_state = classifyRuntimeState(probe);
  const ready = runtime_state === 'ready';
  return {
    runtime_state,
    docker_reachable: probe.dockerReachable,
    db_reachable: probe.dbReachable,
    blocked_operations: ready ? [] : [...DB_DEPENDENT_OPERATIONS],
    executable_offline_checks: [...OFFLINE_GOVERNANCE_CHECKS],
    required_operator_action: OPERATOR_ACTION[runtime_state],
  };
}

export function isRuntimeReady(state: RuntimeState): boolean {
  return state === 'ready';
}

/** Render the structured blocked-state diagnostic as deterministic key/value
 *  text. No stack traces — a blocked stack is an expected, reportable state. */
export function formatRuntimeDiagnostics(diag: RuntimeDiagnostics): string {
  return [
    `runtime_state             : ${diag.runtime_state}`,
    `docker_reachable          : ${diag.docker_reachable}`,
    `db_reachable              : ${diag.db_reachable}`,
    `blocked_operations        : ${diag.blocked_operations.join(', ') || '(none)'}`,
    `executable_offline_checks : ${diag.executable_offline_checks.join(', ')}`,
    `required_operator_action  : ${diag.required_operator_action}`,
  ].join('\n');
}

export interface DbProbeConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Probe Docker + the Supabase DB. The only I/O in this module. Never throws —
 *  an unreachable component simply yields `false`. */
export async function probeRuntime(opts: { dbConfig?: Partial<DbProbeConfig> } = {}): Promise<RuntimeProbe> {
  let dockerReachable = false;
  try {
    // `docker version` is fast and exits non-zero when the daemon is
    // unreachable; plain `docker info` gathers everything and can exceed the
    // timeout on a slow-but-healthy daemon (a false docker_unavailable).
    const serverVersion = execSync('docker version --format "{{.Server.Version}}"', {
      timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    dockerReachable = serverVersion.length > 0;
  } catch {
    dockerReachable = false;
  }

  const dbConfig: DbProbeConfig = {
    host: opts.dbConfig?.host ?? '127.0.0.1',
    port: opts.dbConfig?.port ?? 54322,
    user: opts.dbConfig?.user ?? 'postgres',
    password: opts.dbConfig?.password ?? 'postgres',
    database: opts.dbConfig?.database ?? 'postgres',
  };
  let dbReachable = false;
  const client = new Client({ ...dbConfig, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.query('select 1');
    dbReachable = true;
  } catch {
    dbReachable = false;
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }

  return { dockerReachable, dbReachable };
}
