/**
 * compatibilityCoreUnlinkAnalyzer.ts
 *
 * Phase 9.6 — Static-readiness analyzer for physical unlink of the
 * compatibility-core fallback engine.
 *
 * The retirement governance snapshot answers "is it safe to STOP using
 * compatibility-core at runtime?" — this module answers the next
 * question: "is it safe to DELETE the compatibility-core code paths?"
 *
 * Inputs are operator-supplied (the analyzer does NOT walk the
 * filesystem at runtime — that would couple a runtime service to a
 * build-time concern). Operators feed in a `CompatibilityCoreCodeMap`
 * produced by an offline scan; the analyzer:
 *
 *   - classifies each linked module (direct, fallback-only, shared, bridge)
 *   - computes an `unlinkReadinessScore` 0..100
 *   - lists blocking dependencies (live importers, shared utilities)
 *   - lists dead-code candidates (fallback-only modules)
 *   - lists unsafe shared utilities (used by both engines)
 *   - emits a stable `requiredDeletionOrder[]` (leaves first)
 *
 * The output drives the Phase 9.10 deletion planner and the Phase 9.9
 * timeline. Nothing in this module mutates state or files.
 */

import {
  getCompatibilityCoreUsageReport,
  type CompatibilityCoreUsageReport,
} from './plannedEngineStabilityTelemetry';
import { resolveEnforcementMode } from './plannedEngineEnforcementMode';

// ── Public types ─────────────────────────────────────────────────────────────

export type LinkedModuleKind =
  | 'direct_import'         // live import that runs in normal traffic
  | 'fallback_only'         // only reachable through the compatibility-core path
  | 'shared_utility'        // used by both engines
  | 'emergency_bridge'      // used only by emergency recovery paths
  | 'recovery_assumption'   // recovery code that ASSUMES compatibility-core is callable
  | 'test_only'             // only referenced from tests
  | 'documentation_only';   // only referenced from docs / comments

export interface CompatibilityCoreLinkedModule {
  path: string;
  kind: LinkedModuleKind;
  /** Files that still import this module (callers). */
  importers: string[];
  /** Symbols re-exported / consumed downstream. */
  exportedSymbols: string[];
  /** Free-form notes from the offline scan (e.g. "uses planner cache"). */
  notes?: string;
}

export interface CompatibilityCoreCodeMap {
  /** Generated-by tag of the offline scan. */
  scanned_by: string;
  /** ISO timestamp of the scan. */
  scanned_at: string;
  /** Modules that physically belong to the compatibility-core engine. */
  modules: CompatibilityCoreLinkedModule[];
  /** Files outside compatibility-core that still import it. */
  externalImporters: Array<{
    importer: string;
    importedModule: string;
    /** True if the import sits inside a fallback branch only. */
    fallback_branch_only: boolean;
  }>;
}

export interface BlockingDependency {
  module: string;
  reason:
    | 'live_external_importer'
    | 'shared_utility_in_use'
    | 'emergency_bridge_active'
    | 'recovery_assumption_unresolved';
  importers: string[];
  severity: 'critical' | 'high' | 'moderate';
}

export interface DeadCodeCandidate {
  module: string;
  kind: Extract<LinkedModuleKind, 'fallback_only' | 'test_only' | 'documentation_only'>;
  reason: string;
  safe_to_delete_after: 'fallback_traffic_zero' | 'tests_updated' | 'docs_updated' | 'immediate';
}

export interface UnsafeSharedUtility {
  module: string;
  used_by: 'both_engines' | 'compatibility_core_and_recovery' | 'multiple_callers';
  required_action: 'extract_to_neutral_module' | 'inline_into_planned_engine' | 'keep_until_replaced';
  notes: string;
}

export interface CompatibilityCoreUnlinkReadinessReport {
  unlinkReadinessScore: number;        // 0..100, higher = safer to physically delete
  readinessBand: 'NOT_READY' | 'STAGED' | 'NEAR_READY' | 'READY';
  blockingDependencies: BlockingDependency[];
  deadCodeCandidates: DeadCodeCandidate[];
  unsafeSharedUtilities: UnsafeSharedUtility[];
  requiredDeletionOrder: string[];     // module paths, safe-leaves-first
  runtimeContext: {
    enforcementMode: string;
    fallbackRate: number;
    totalAttempts: number;
  };
  generatedAt: string;
  inputScan: {
    scanned_by: string;
    scanned_at: string;
    module_count: number;
    external_importer_count: number;
  };
}

export interface AnalyzeUnlinkReadinessOptions {
  /** Static code map produced by an offline scan. Required. */
  codeMap: CompatibilityCoreCodeMap;
  /** Override the runtime usage report — defaults to in-process counters. */
  usageReport?: CompatibilityCoreUsageReport;
  /** Override the enforcement mode lookup (useful for what-if simulations). */
  enforcementMode?: string;
  /** Above this fallback rate, runtime traffic blocks deletion. Default 0.005 (0.5%). */
  fallbackRateBlockThreshold?: number;
}

// ── Classification helpers ───────────────────────────────────────────────────

function severityForKind(kind: LinkedModuleKind): 'critical' | 'high' | 'moderate' {
  switch (kind) {
    case 'direct_import': return 'critical';
    case 'emergency_bridge': return 'critical';
    case 'recovery_assumption': return 'high';
    case 'shared_utility': return 'high';
    case 'fallback_only':
    case 'test_only':
    case 'documentation_only':
      return 'moderate';
  }
}

function deletionPriority(kind: LinkedModuleKind): number {
  // Lower number = delete earlier (safer leaves first).
  switch (kind) {
    case 'documentation_only': return 0;
    case 'test_only':          return 1;
    case 'fallback_only':      return 2;
    case 'recovery_assumption': return 3;
    case 'emergency_bridge':   return 4;
    case 'shared_utility':     return 5;
    case 'direct_import':      return 6;
  }
}

// ── Core analyzer ────────────────────────────────────────────────────────────

export function analyzeCompatibilityCoreUnlinkReadiness(
  options: AnalyzeUnlinkReadinessOptions,
): CompatibilityCoreUnlinkReadinessReport {
  const usage = options.usageReport ?? getCompatibilityCoreUsageReport();
  const enforcement = options.enforcementMode ?? resolveEnforcementMode().mode;
  const fallbackThreshold = options.fallbackRateBlockThreshold ?? 0.005;

  const codeMap = options.codeMap;
  const moduleByPath = new Map<string, CompatibilityCoreLinkedModule>();
  for (const m of codeMap.modules) moduleByPath.set(m.path, m);

  // ── Blocking dependencies ─────────────────────────────────────────────
  const blockingDependencies: BlockingDependency[] = [];

  // 1) External importers that are NOT fallback-branch-only.
  const liveExternalImporters = new Map<string, string[]>();
  for (const link of codeMap.externalImporters) {
    if (link.fallback_branch_only) continue;
    const list = liveExternalImporters.get(link.importedModule) ?? [];
    list.push(link.importer);
    liveExternalImporters.set(link.importedModule, list);
  }
  for (const [mod, importers] of liveExternalImporters.entries()) {
    blockingDependencies.push({
      module: mod,
      reason: 'live_external_importer',
      importers,
      severity: 'critical',
    });
  }

  // 2) Direct imports flagged by the scan.
  for (const m of codeMap.modules) {
    if (m.kind === 'direct_import' && m.importers.length > 0) {
      blockingDependencies.push({
        module: m.path,
        reason: 'live_external_importer',
        importers: m.importers,
        severity: 'critical',
      });
    }
    if (m.kind === 'shared_utility' && m.importers.length > 0) {
      blockingDependencies.push({
        module: m.path,
        reason: 'shared_utility_in_use',
        importers: m.importers,
        severity: 'high',
      });
    }
    if (m.kind === 'emergency_bridge') {
      blockingDependencies.push({
        module: m.path,
        reason: 'emergency_bridge_active',
        importers: m.importers,
        severity: 'critical',
      });
    }
    if (m.kind === 'recovery_assumption') {
      blockingDependencies.push({
        module: m.path,
        reason: 'recovery_assumption_unresolved',
        importers: m.importers,
        severity: 'high',
      });
    }
  }

  // ── Dead-code candidates ──────────────────────────────────────────────
  const deadCodeCandidates: DeadCodeCandidate[] = [];
  for (const m of codeMap.modules) {
    if (m.kind === 'fallback_only') {
      deadCodeCandidates.push({
        module: m.path,
        kind: 'fallback_only',
        reason: 'Reachable only via the compatibility-core fallback path.',
        safe_to_delete_after: 'fallback_traffic_zero',
      });
    } else if (m.kind === 'test_only') {
      deadCodeCandidates.push({
        module: m.path,
        kind: 'test_only',
        reason: 'Only referenced from test suites — remove with the test deletion pass.',
        safe_to_delete_after: 'tests_updated',
      });
    } else if (m.kind === 'documentation_only') {
      deadCodeCandidates.push({
        module: m.path,
        kind: 'documentation_only',
        reason: 'Only referenced from documentation — remove with the docs update pass.',
        safe_to_delete_after: 'docs_updated',
      });
    }
  }

  // ── Unsafe shared utilities ───────────────────────────────────────────
  const unsafeSharedUtilities: UnsafeSharedUtility[] = [];
  for (const m of codeMap.modules) {
    if (m.kind !== 'shared_utility') continue;
    const externalImporters = m.importers.filter((i) => !i.includes('compatibility-core'));
    let used_by: UnsafeSharedUtility['used_by'];
    let action: UnsafeSharedUtility['required_action'];
    if (externalImporters.length > 0) {
      used_by = 'both_engines';
      action = 'extract_to_neutral_module';
    } else if (m.importers.some((i) => i.includes('recovery'))) {
      used_by = 'compatibility_core_and_recovery';
      action = 'inline_into_planned_engine';
    } else {
      used_by = 'multiple_callers';
      action = 'keep_until_replaced';
    }
    unsafeSharedUtilities.push({
      module: m.path,
      used_by,
      required_action: action,
      notes: m.notes ?? 'Shared between compatibility-core and another caller; cannot be deleted while in use.',
    });
  }

  // ── Required deletion order ──────────────────────────────────────────
  // Sort by priority (leaves first), then by importer count (fewer first),
  // then by path for determinism.
  const requiredDeletionOrder = [...codeMap.modules]
    .sort((a, b) => {
      const p = deletionPriority(a.kind) - deletionPriority(b.kind);
      if (p !== 0) return p;
      const i = a.importers.length - b.importers.length;
      if (i !== 0) return i;
      return a.path.localeCompare(b.path);
    })
    .map((m) => m.path);

  // ── Runtime context ───────────────────────────────────────────────────
  const fallbackRate = usage.total_attempts_all_types > 0
    ? usage.total_fallback_to_compatibility_core / usage.total_attempts_all_types
    : 0;
  const runtimeContext = {
    enforcementMode: enforcement,
    fallbackRate: Number(fallbackRate.toFixed(4)),
    totalAttempts: usage.total_attempts_all_types,
  };

  // ── Readiness score (0..100) ──────────────────────────────────────────
  // Weighted blend:
  //   - 35% : runtime is no longer using compatibility-core
  //   - 25% : zero live external importers
  //   - 20% : zero direct imports / emergency bridges
  //   - 10% : shared utilities cleaned up
  //   - 10% : enforcement mode is NO_COMPATIBILITY_CORE
  const runtimeClean = fallbackRate <= fallbackThreshold ? 1 : Math.max(0, 1 - (fallbackRate / 0.05));
  const liveImporterCount = liveExternalImporters.size;
  const liveImporterClean = liveImporterCount === 0 ? 1 : Math.max(0, 1 - liveImporterCount / 5);
  const criticalLinkCount = codeMap.modules.filter(
    (m) => m.kind === 'direct_import' || m.kind === 'emergency_bridge',
  ).length;
  const criticalClean = criticalLinkCount === 0 ? 1 : Math.max(0, 1 - criticalLinkCount / 5);
  const sharedCount = unsafeSharedUtilities.length;
  const sharedClean = sharedCount === 0 ? 1 : Math.max(0, 1 - sharedCount / 5);
  const enforcementClean = enforcement === 'NO_COMPATIBILITY_CORE' ? 1
    : enforcement === 'PLANNED_REQUIRED_ALL' ? 0.7
    : enforcement === 'PLANNED_REQUIRED_NON_CRITICAL' ? 0.4
    : enforcement === 'PREFER_PLANNED' ? 0.15
    : 0;

  const rawScore =
      35 * runtimeClean
    + 25 * liveImporterClean
    + 20 * criticalClean
    + 10 * sharedClean
    + 10 * enforcementClean;
  const unlinkReadinessScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  let readinessBand: CompatibilityCoreUnlinkReadinessReport['readinessBand'];
  if (unlinkReadinessScore >= 90 && blockingDependencies.length === 0) readinessBand = 'READY';
  else if (unlinkReadinessScore >= 75) readinessBand = 'NEAR_READY';
  else if (unlinkReadinessScore >= 50) readinessBand = 'STAGED';
  else readinessBand = 'NOT_READY';

  return {
    unlinkReadinessScore,
    readinessBand,
    blockingDependencies,
    deadCodeCandidates,
    unsafeSharedUtilities,
    requiredDeletionOrder,
    runtimeContext,
    generatedAt: new Date().toISOString(),
    inputScan: {
      scanned_by: codeMap.scanned_by,
      scanned_at: codeMap.scanned_at,
      module_count: codeMap.modules.length,
      external_importer_count: codeMap.externalImporters.length,
    },
  };
}

// ── Convenience: empty/placeholder scan ──────────────────────────────────────

/**
 * Returns a minimal "no scan supplied" report so callers that haven't
 * wired the offline scan yet still get a stable shape. The report
 * declares NOT_READY and explicitly notes that no scan was provided.
 */
export function makeUnknownUnlinkReport(): CompatibilityCoreUnlinkReadinessReport {
  const usage = getCompatibilityCoreUsageReport();
  return {
    unlinkReadinessScore: 0,
    readinessBand: 'NOT_READY',
    blockingDependencies: [{
      module: '(scan_not_provided)',
      reason: 'recovery_assumption_unresolved',
      importers: [],
      severity: 'critical',
    }],
    deadCodeCandidates: [],
    unsafeSharedUtilities: [],
    requiredDeletionOrder: [],
    runtimeContext: {
      enforcementMode: resolveEnforcementMode().mode,
      fallbackRate: usage.total_attempts_all_types > 0
        ? Number((usage.total_fallback_to_compatibility_core / usage.total_attempts_all_types).toFixed(4))
        : 0,
      totalAttempts: usage.total_attempts_all_types,
    },
    generatedAt: new Date().toISOString(),
    inputScan: {
      scanned_by: 'none',
      scanned_at: new Date().toISOString(),
      module_count: 0,
      external_importer_count: 0,
    },
  };
}
