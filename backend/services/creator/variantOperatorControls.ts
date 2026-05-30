/**
 * Variant Operator Controls.
 *
 * Per-org runtime feature switches that gate the variant execution
 * planner. Operators flip these via existing admin tooling (or the
 * API endpoint that wraps `setOperatorControl`) — there is NO new
 * configuration framework here.
 *
 * Switches:
 *   - experimentModeDisabled       — disables `mode = 'experiment'`
 *   - variantExplorationDisabled   — collapses every request to V1 baseline
 *   - forceBaselineV1              — always pin V1 regardless of caller intent
 *   - forceWinningVariant          — always use the winner engine
 *
 * Conflict resolution:
 *   - variantExplorationDisabled and forceBaselineV1 are equivalent
 *     in effect; the planner reports both as `forced_baseline_v1`.
 *   - When BOTH forceBaselineV1 and forceWinningVariant are set,
 *     forceBaselineV1 wins (more restrictive); forceWinningVariant
 *     is ignored.
 *
 * Bounded in-memory cache (200 orgs LRU). No DB. No new schema.
 * Operators set + read via the API endpoint.
 */

const MAX_ORG_ENTRIES = 200;

export type VariantOperatorControls = {
  experimentModeDisabled: boolean;
  variantExplorationDisabled: boolean;
  forceBaselineV1: boolean;
  forceWinningVariant: boolean;
};

const DEFAULT_CONTROLS: VariantOperatorControls = {
  experimentModeDisabled: false,
  variantExplorationDisabled: false,
  forceBaselineV1: false,
  forceWinningVariant: false,
};

type Entry = {
  controls: VariantOperatorControls;
  updatedAt: number;
};

const store = new Map<string, Entry>();

function pruneIfFull(): void {
  if (store.size <= MAX_ORG_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of store.entries()) {
    if (v.updatedAt < oldestTs) {
      oldestTs = v.updatedAt;
      oldestKey = k;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

function keyFor(companyId: string): string {
  return companyId.trim().toLowerCase();
}

/**
 * Fetch the current control settings for a company. Returns the
 * default (all switches off) when no override has been set.
 */
export function getVariantOperatorControls(companyId: string): VariantOperatorControls {
  if (!companyId) return { ...DEFAULT_CONTROLS };
  const entry = store.get(keyFor(companyId));
  return entry ? { ...entry.controls } : { ...DEFAULT_CONTROLS };
}

/**
 * Set one or more controls for a company. Unspecified fields keep
 * their current value (partial merge). Returns the post-merge
 * controls so the caller can echo them back to the UI.
 */
export function setVariantOperatorControls(
  companyId: string,
  patch: Partial<VariantOperatorControls>,
): VariantOperatorControls {
  if (!companyId) return { ...DEFAULT_CONTROLS };
  const key = keyFor(companyId);
  const current = store.get(key)?.controls ?? DEFAULT_CONTROLS;
  const next: VariantOperatorControls = {
    experimentModeDisabled:     patch.experimentModeDisabled ?? current.experimentModeDisabled,
    variantExplorationDisabled: patch.variantExplorationDisabled ?? current.variantExplorationDisabled,
    forceBaselineV1:            patch.forceBaselineV1 ?? current.forceBaselineV1,
    forceWinningVariant:        patch.forceWinningVariant ?? current.forceWinningVariant,
  };
  store.set(key, { controls: next, updatedAt: Date.now() });
  pruneIfFull();
  // Phase 7 — audit log only when the operator's intent CHANGED.
  // (Setting `forceBaselineV1: false` when it was already false is
  // noise — only record actual toggles.)
  try {
    const { auditOperatorForceV1, auditOperatorForceWinner } =
      require('./variantAuditEvents') as typeof import('./variantAuditEvents');
    if (patch.forceBaselineV1 !== undefined && patch.forceBaselineV1 !== current.forceBaselineV1) {
      auditOperatorForceV1({ companyId, enabled: patch.forceBaselineV1 });
    }
    if (patch.forceWinningVariant !== undefined && patch.forceWinningVariant !== current.forceWinningVariant) {
      auditOperatorForceWinner({ companyId, enabled: patch.forceWinningVariant });
    }
  } catch {
    // No-op.
  }
  return { ...next };
}

/** Test-surface — clears the store. */
export function clearVariantOperatorControls(): void {
  store.clear();
}

/** Diagnostics — used by the dashboard endpoint. */
export function variantOperatorControlsStats(): { orgCount: number; maxOrgs: number } {
  return { orgCount: store.size, maxOrgs: MAX_ORG_ENTRIES };
}

/** Default snapshot — exposed for callers that want the canonical baseline. */
export function defaultVariantOperatorControls(): VariantOperatorControls {
  return { ...DEFAULT_CONTROLS };
}
