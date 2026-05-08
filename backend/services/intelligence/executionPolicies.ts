// Intelligence execution policies.
//
// Different scan types consume different providers, run different query depths,
// and ship under different cost ceilings. The policy is selected at the report
// boundary; downstream services read it to decide whether to call a provider,
// which providers to skip, and how aggressive to be with cache.

import type { ScanProfile } from './snapshotWriter';
import type { ScanBudget } from './costGovernance';
import type { AIQueryClass } from './providerInterfaces';

export type ExecutionPolicy = {
  profile: ScanProfile;
  /** Which LLM query classes are exercised at all. */
  enabledQueryClasses: AIQueryClass[];
  /** Max queries per (provider × class) cell. */
  maxQueriesPerCell: number;
  /** Whether to consult a provider whose breaker is half-open. */
  allowHalfOpenProbes: boolean;
  /** Whether structured-data extraction is run. */
  runStructuredDataExtraction: boolean;
  /** Whether benchmark lookup is run. */
  runBenchmark: boolean;
  /** Whether the canonical history is written for this run. */
  persistHistory: boolean;
  /** Whether forecast is computed. */
  computeForecast: boolean;
  /** Cost / volume budget for this scan. */
  budget: Omit<ScanBudget, 'scan_id'>;
  /** Reuse cache aggressively (longer TTL hint to adapters). */
  preferCache: boolean;
};

const ALL_CLASSES: AIQueryClass[] = ['branded', 'category', 'competitive', 'expertise'];

export const POLICY_LIGHTWEIGHT: ExecutionPolicy = {
  profile: 'lightweight',
  enabledQueryClasses: ['branded'],
  maxQueriesPerCell: 1,
  allowHalfOpenProbes: false,
  runStructuredDataExtraction: false,
  runBenchmark: false,
  persistHistory: true,
  computeForecast: false,
  budget: { max_requests: 30, max_cost_usd: 0.5 },
  preferCache: true,
};

export const POLICY_STANDARD: ExecutionPolicy = {
  profile: 'standard',
  enabledQueryClasses: ['branded', 'category', 'competitive'],
  maxQueriesPerCell: 2,
  allowHalfOpenProbes: true,
  runStructuredDataExtraction: true,
  runBenchmark: true,
  persistHistory: true,
  computeForecast: true,
  budget: { max_requests: 120, max_cost_usd: 3.0 },
  preferCache: true,
};

export const POLICY_DEEP: ExecutionPolicy = {
  profile: 'deep',
  enabledQueryClasses: ALL_CLASSES,
  maxQueriesPerCell: 4,
  allowHalfOpenProbes: true,
  runStructuredDataExtraction: true,
  runBenchmark: true,
  persistHistory: true,
  computeForecast: true,
  budget: { max_requests: 400, max_cost_usd: 12.0 },
  preferCache: false,
};

export const POLICY_MANUAL_REFRESH: ExecutionPolicy = {
  profile: 'manual_refresh',
  enabledQueryClasses: ALL_CLASSES,
  maxQueriesPerCell: 3,
  allowHalfOpenProbes: true,
  runStructuredDataExtraction: true,
  runBenchmark: true,
  persistHistory: true,
  computeForecast: true,
  budget: { max_requests: 250, max_cost_usd: 8.0 },
  preferCache: false,
};

export const POLICY_DELTA_ONLY: ExecutionPolicy = {
  profile: 'delta_only',
  enabledQueryClasses: ['branded', 'competitive'],
  maxQueriesPerCell: 1,
  allowHalfOpenProbes: false,
  runStructuredDataExtraction: false,
  runBenchmark: false,
  persistHistory: true,
  computeForecast: false,
  budget: { max_requests: 25, max_cost_usd: 0.4 },
  preferCache: true,
};

export const EXECUTION_POLICIES: Record<ScanProfile, ExecutionPolicy> = {
  lightweight: POLICY_LIGHTWEIGHT,
  standard: POLICY_STANDARD,
  deep: POLICY_DEEP,
  manual_refresh: POLICY_MANUAL_REFRESH,
  delta_only: POLICY_DELTA_ONLY,
};

export function policyFor(profile: ScanProfile): ExecutionPolicy {
  return EXECUTION_POLICIES[profile];
}
