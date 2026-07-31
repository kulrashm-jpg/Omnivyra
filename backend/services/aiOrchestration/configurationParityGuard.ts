/**
 * configurationParityGuard.ts — ConfigurationParityGuard (AI-ORCH 2A-3).
 *
 * THE one new runtime abstraction for this phase: a PURE, side-effect-free comparator
 * that validates the configuration ACTUALLY EXECUTED by the gateway against the
 * configuration the resolver would produce (via the LegacyExecutionAdapter). It powers
 * DUAL / CANARY validation without ever influencing execution.
 *
 * It NEVER modifies either configuration, never retries, never persists, never throws,
 * never influences provider execution. It compares and returns a verdict.
 *
 * Reuses the SINGLE ExecutionSnapshotBuilder (no second snapshot implementation).
 */
import {
  ExecutionSnapshotBuilder, hashExecutionSnapshot, rawConfigFromLegacyConfiguration,
  EXECUTION_FIELDS, UNSET,
} from './executionSnapshot';
import type { DifferenceCategory } from './resolverComparator';
import type { LegacyExecutionConfiguration } from './types/LegacyExecutionConfiguration';

export type ConfigurationParity = 'IDENTICAL' | 'SEMANTICALLY_EQUIVALENT' | 'DIFFERENT';

export interface ConfigurationFieldDifference {
  mappedField: string;
  executedValue: unknown;
  resolverValue: unknown;
  category: DifferenceCategory;
  reason: string;
}

export interface ConfigurationParityResult {
  parity: ConfigurationParity;
  reason: string;
  differences: ConfigurationFieldDifference[];
  /** Same set of fields specified on both sides (no CONFIGURATION_DIFFERENCE). */
  structuralMatch: boolean;
  snapshotHashExecuted: string;
  snapshotHashResolver: string;
  snapshotHashMatch: boolean;
  fingerprintExecuted: string | null;
  fingerprintResolver: string | null;
  fingerprintMatch: boolean;
  /** Fraction of execution fields specified (non-UNSET) on both sides. */
  fieldCoverage: number;
}

function valueKey(v: unknown): string {
  if (v === undefined) return 'U';
  if (v === null) return 'N';
  if (typeof v === 'object') return 'O:' + JSON.stringify(v);
  return (typeof v)[0] + ':' + String(v);
}

/**
 * The guard. `executed` is the LegacyExecutionConfiguration the gateway actually used;
 * `resolver` is the LegacyExecutionAdapter output for the same request. Pure.
 */
export const ConfigurationParityGuard = {
  compare(executed: LegacyExecutionConfiguration, resolver: LegacyExecutionConfiguration): ConfigurationParityResult {
    const rawExec = rawConfigFromLegacyConfiguration(executed);
    const rawRes = rawConfigFromLegacyConfiguration(resolver);
    const snapExec = ExecutionSnapshotBuilder.fromLegacyConfiguration(executed);
    const snapRes = ExecutionSnapshotBuilder.fromLegacyConfiguration(resolver);

    const differences: ConfigurationFieldDifference[] = [];
    let rawOnlyDiffs = 0;
    let bothSpecified = 0;
    let structuralMatch = true;

    for (const field of EXECUTION_FIELDS) {
      const normEqual = valueKey(snapExec[field]) === valueKey(snapRes[field]);
      const rawEqual = valueKey(rawExec[field]) === valueKey(rawRes[field]);
      const execSet = snapExec[field] !== UNSET;
      const resSet = snapRes[field] !== UNSET;
      if (execSet && resSet) bothSpecified++;

      if (!normEqual) {
        const oneUnset = snapExec[field] === UNSET || snapRes[field] === UNSET;
        const category: DifferenceCategory = oneUnset ? 'CONFIGURATION_DIFFERENCE' : 'EXECUTION_DIFFERENCE';
        if (oneUnset) structuralMatch = false;
        differences.push({
          mappedField: field, executedValue: snapExec[field], resolverValue: snapRes[field],
          category, reason: `${field}: executed=${JSON.stringify(snapExec[field])} resolver=${JSON.stringify(snapRes[field])}`,
        });
      } else if (!rawEqual) {
        rawOnlyDiffs++;
        differences.push({
          mappedField: field, executedValue: rawExec[field], resolverValue: rawRes[field],
          category: 'NORMALIZATION_DIFFERENCE', reason: `${field}: raw differs, normalized identical`,
        });
      }
    }

    const normalizedDiffCount = differences.filter((d) => d.category !== 'NORMALIZATION_DIFFERENCE').length;
    const snapshotHashExecuted = hashExecutionSnapshot(snapExec);
    const snapshotHashResolver = hashExecutionSnapshot(snapRes);
    const snapshotHashMatch = snapshotHashExecuted === snapshotHashResolver;

    const fingerprintExecuted = executed.configFingerprint ?? null;
    const fingerprintResolver = resolver.configFingerprint ?? null;
    const fingerprintMatch = fingerprintExecuted === fingerprintResolver;

    let parity: ConfigurationParity;
    let reason: string;
    if (normalizedDiffCount === 0) {
      if (rawOnlyDiffs === 0) { parity = 'IDENTICAL'; reason = 'executed + resolver configurations are identical'; }
      else { parity = 'SEMANTICALLY_EQUIVALENT'; reason = `${rawOnlyDiffs} normalization-only diff(s)`; }
    } else {
      parity = 'DIFFERENT';
      reason = `${normalizedDiffCount} normalized execution diff(s)`;
    }

    return {
      parity, reason, differences, structuralMatch,
      snapshotHashExecuted, snapshotHashResolver, snapshotHashMatch,
      fingerprintExecuted, fingerprintResolver, fingerprintMatch,
      fieldCoverage: bothSpecified / EXECUTION_FIELDS.length,
    };
  },
};
