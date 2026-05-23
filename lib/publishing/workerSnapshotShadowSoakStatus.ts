// Shadow Soak Status Model
//
// Deterministic, advisory-only soak statuses for non-production worker shadow
// snapshot soak cycles. These describe soak outcomes — they NEVER gate
// runtime, block publishing, or mutate anything.

import type { SnapshotRuntimeStatus } from './workerSnapshotRuntimeStatus';

export type ShadowSoakStatus =
  | 'shadow_soak_clean'
  | 'shadow_soak_warning'
  | 'shadow_soak_risk'
  | 'shadow_soak_invalid';

export const SHADOW_SOAK_STATUSES: readonly ShadowSoakStatus[] = [
  'shadow_soak_clean',
  'shadow_soak_warning',
  'shadow_soak_risk',
  'shadow_soak_invalid',
];

const STATUS_RANK: Record<ShadowSoakStatus, number> = {
  shadow_soak_clean: 0,
  shadow_soak_warning: 1,
  shadow_soak_risk: 2,
  shadow_soak_invalid: 3,
};

export function rankShadowSoakStatus(status: ShadowSoakStatus): number {
  return STATUS_RANK[status];
}

export function isCleanShadowSoakStatus(status: ShadowSoakStatus): boolean {
  return status === 'shadow_soak_clean';
}

export function worstShadowSoakStatus(statuses: readonly ShadowSoakStatus[]): ShadowSoakStatus {
  let status: ShadowSoakStatus = 'shadow_soak_clean';
  for (const candidate of statuses) {
    if (STATUS_RANK[candidate] > STATUS_RANK[status]) status = candidate;
  }
  return status;
}

export function shadowSoakStatusFromRuntime(status: SnapshotRuntimeStatus): ShadowSoakStatus {
  switch (status) {
    case 'snapshot_runtime_clean': return 'shadow_soak_clean';
    case 'snapshot_runtime_warning': return 'shadow_soak_warning';
    case 'snapshot_runtime_risk': return 'shadow_soak_risk';
    case 'snapshot_runtime_invalid': return 'shadow_soak_invalid';
  }
}
