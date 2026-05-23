/*
SCRIPT_CLASSIFICATION: OPERATOR_SUPPORT
MUTATION_LEVEL: NONE
SAFE_FOR_CI: YES
SAFE_FOR_PRODUCTION: YES
REQUIRES_EXPLICIT_OPERATOR_INTENT: NO
*/
/**
 * Snapshot Publishing Operator Core
 *
 * Pure, deterministic helpers shared by the snapshot-publishing operator
 * scripts. No DB, no Redis, no filesystem, no I/O — safe to import anywhere
 * and fully unit-testable.
 */

import type { ShadowSoakStatus } from '../../lib/publishing/workerSnapshotShadowSoakStatus';
import type { PersistenceStatus } from '../../lib/publishing/workerSnapshotPersistenceStatus';

// The ONLY two migrations this tooling is permitted to target — in order.
export const SNAPSHOT_PUBLISHING_MIGRATION_PREFIXES = ['20260723', '20260724'] as const;

export interface MigrationSelection {
  selected: readonly string[];
  ordered: boolean;
  missing: readonly string[];
  duplicates: readonly string[];
  valid: boolean;
  reasons: readonly string[];
}

// Selects ONLY the two snapshot-publishing migrations from a directory listing.
// Never returns historical or unrelated migrations — there is no path here to a
// blanket apply or a full ledger replay.
export function selectTargetMigrations(availableFiles: readonly string[]): MigrationSelection {
  const sqlFiles = availableFiles.filter((file) => file.endsWith('.sql'));
  const selected: string[] = [];
  const missing: string[] = [];
  const duplicates: string[] = [];

  for (const prefix of SNAPSHOT_PUBLISHING_MIGRATION_PREFIXES) {
    const matches = sqlFiles.filter((file) => file.startsWith(`${prefix}_`)).sort();
    if (matches.length === 0) {
      missing.push(prefix);
    } else {
      if (matches.length > 1) duplicates.push(prefix);
      selected.push(matches[0]);
    }
  }

  const ordered = selected.every((file, index) => index === 0 || file > selected[index - 1]);
  const reasons: string[] = [];
  for (const prefix of missing) reasons.push(`migration ${prefix}_* not found`);
  for (const prefix of duplicates) reasons.push(`migration ${prefix}_* has multiple files`);
  if (selected.length > 1 && !ordered) reasons.push('selected migrations are not in ascending order');

  return {
    selected,
    ordered,
    missing,
    duplicates,
    valid: missing.length === 0 && duplicates.length === 0 && ordered,
    reasons,
  };
}

const DESTRUCTIVE_DDL: readonly RegExp[] = [
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bDROP\s+DATABASE\b/i,
];

// Defense in depth: refuse to apply a migration file containing destructive
// DDL, even though the two target migrations are pre-vetted additive.
export function hasDestructiveDdl(sql: string): string | null {
  for (const pattern of DESTRUCTIVE_DDL) {
    const match = sql.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export interface RedisTlsValidation {
  valid: boolean;
  scheme: string;
  isTls: boolean;
  reasons: readonly string[];
}

// Validates that a Redis URL uses the TLS (rediss://) scheme.
export function validateRedisTlsUrl(url: string | undefined | null): RedisTlsValidation {
  const value = typeof url === 'string' ? url.trim() : '';
  if (!value) {
    return { valid: false, scheme: '', isTls: false, reasons: ['REDIS_URL is not set'] };
  }
  const match = value.match(/^([a-z]+):\/\//i);
  const scheme = match ? match[1].toLowerCase() : '';
  const reasons: string[] = [];
  if (!scheme) reasons.push('REDIS_URL has no URL scheme');
  else if (scheme === 'redis') reasons.push('REDIS_URL uses plain redis:// — must be rediss:// for TLS');
  else if (scheme !== 'rediss') reasons.push(`REDIS_URL uses an unexpected scheme: ${scheme}`);
  return { valid: scheme === 'rediss', scheme, isTls: scheme === 'rediss', reasons };
}

export type RuntimeReadiness = 'READY' | 'CONDITIONAL' | 'NOT_READY';

export interface RuntimeReadinessInput {
  migrationsApplied: boolean;
  triggersPresent: boolean;
  indexesPresent: boolean;
  telemetryTableAccessible: boolean;
  redisTls: boolean;
  soakStatus: ShadowSoakStatus | null;
  persistenceStatus: PersistenceStatus | null;
  crossCompanyOwnershipDriftCount: number | null;
}

export interface RuntimeReadinessResult {
  readiness: RuntimeReadiness;
  reasons: readonly string[];
}

// Advisory aggregation — NOT_READY on any hard blocker, CONDITIONAL on any
// unverified-or-degraded signal, READY only when everything is verified clean.
export function aggregateRuntimeReadiness(input: RuntimeReadinessInput): RuntimeReadinessResult {
  const blockers: string[] = [];
  const conditionals: string[] = [];

  if (!input.migrationsApplied) blockers.push('snapshot publishing migrations not applied');
  if (!input.triggersPresent) blockers.push('append-only / immutability triggers not present');
  if (!input.telemetryTableAccessible) blockers.push('telemetry table not accessible');
  if (!input.redisTls) blockers.push('REDIS_URL is not using rediss:// TLS');
  if (input.soakStatus === 'shadow_soak_invalid') blockers.push('shadow soak status is invalid');
  if (input.persistenceStatus === 'persistence_invalid') blockers.push('persistence status is invalid');
  if ((input.crossCompanyOwnershipDriftCount ?? 0) > 0) blockers.push('cross-company ownership drift detected');

  if (!input.indexesPresent) conditionals.push('expected indexes are not all present');
  if (input.soakStatus === null) conditionals.push('shadow soak has not been run');
  else if (input.soakStatus === 'shadow_soak_risk' || input.soakStatus === 'shadow_soak_warning') {
    conditionals.push(`shadow soak status is ${input.soakStatus}`);
  }
  if (input.persistenceStatus === null) conditionals.push('persistence verification has not been run');
  else if (input.persistenceStatus === 'persistence_risk' || input.persistenceStatus === 'persistence_warning') {
    conditionals.push(`persistence status is ${input.persistenceStatus}`);
  }
  if (input.crossCompanyOwnershipDriftCount === null) conditionals.push('ownership drift count is unknown');

  if (blockers.length > 0) return { readiness: 'NOT_READY', reasons: blockers };
  if (conditionals.length > 0) return { readiness: 'CONDITIONAL', reasons: conditionals };
  return { readiness: 'READY', reasons: ['all snapshot-runtime prerequisites verified clean'] };
}
