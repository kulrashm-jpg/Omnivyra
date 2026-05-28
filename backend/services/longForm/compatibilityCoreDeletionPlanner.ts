/**
 * compatibilityCoreDeletionPlanner.ts
 *
 * Phase 9.10 — Concrete deletion plan generator for physically removing
 * the compatibility-core engine from the codebase.
 *
 * Inputs:
 *   - the same `CompatibilityCoreCodeMap` consumed by
 *     `compatibilityCoreUnlinkAnalyzer` (Phase 9.6)
 *   - the timeline snapshot (Phase 9.9) — so we refuse to emit a plan
 *     while the timeline says we're NOT in COMPATIBILITY_CORE_UNLINK
 *     (unless an `assumeReadiness` flag is set, for what-if previews)
 *
 * Outputs:
 *   - ordered deletion batches (leaf modules first, root last)
 *   - per-batch unlink steps (which imports to remove from which files)
 *   - shared-utility extraction proposals
 *   - rollback-safe checkpoints (after each batch)
 *   - explicit "do not delete" exceptions
 *
 * The planner emits text-only artifacts. It does NOT call git, the
 * filesystem, or any external system. Operators feed the plan into
 * their own change-management tooling.
 */

import {
  analyzeCompatibilityCoreUnlinkReadiness,
  type CompatibilityCoreCodeMap,
  type CompatibilityCoreUnlinkReadinessReport,
  type LinkedModuleKind,
} from './compatibilityCoreUnlinkAnalyzer';
import { computeRetirementExecutionTimeline } from './retirementExecutionTimeline';

// ── Public types ─────────────────────────────────────────────────────────────

export type DeletionBatchKind =
  | 'documentation_cleanup'
  | 'test_cleanup'
  | 'fallback_only_modules'
  | 'recovery_assumption_modules'
  | 'emergency_bridges'
  | 'shared_utility_extraction'
  | 'direct_import_unlink'
  | 'final_module_deletion';

export interface DeletionStep {
  module: string;
  action: 'remove_file' | 'remove_import' | 'extract_to_neutral_module' | 'inline_into_planned_engine';
  importer?: string;        // when action === 'remove_import'
  rationale: string;
}

export interface DeletionBatch {
  batch_id: string;
  order: number;
  kind: DeletionBatchKind;
  description: string;
  steps: DeletionStep[];
  rollback_checkpoint: string;
  estimated_blast_radius: 'tiny' | 'small' | 'moderate' | 'large';
}

export interface SharedUtilityExtraction {
  module: string;
  target_neutral_module: string;
  callers_to_repoint: string[];
  rationale: string;
}

export interface DeletionPlan {
  generated_at: string;
  approved_to_execute: boolean;
  refusal_reason: string | null;
  batches: DeletionBatch[];
  shared_utility_extractions: SharedUtilityExtraction[];
  do_not_delete: string[];
  final_unlink_checklist: string[];
  rollback_strategy: string[];
  inputs_summary: {
    timeline_current_stage: string;
    unlink_readiness_score: number;
    blocking_dependency_count: number;
    module_count: number;
  };
}

export interface GenerateDeletionPlanOptions {
  /** Static code map produced by an offline scan. Required. */
  codeMap: CompatibilityCoreCodeMap;
  /** Skip the timeline guard (for what-if previews). Default: false. */
  assumeReadiness?: boolean;
  /** Override the unlink report (e.g. for sandboxed simulations). */
  unlinkReport?: CompatibilityCoreUnlinkReadinessReport;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function batchOrderFor(kind: DeletionBatchKind): number {
  switch (kind) {
    case 'documentation_cleanup':     return 1;
    case 'test_cleanup':              return 2;
    case 'fallback_only_modules':     return 3;
    case 'recovery_assumption_modules': return 4;
    case 'emergency_bridges':         return 5;
    case 'shared_utility_extraction': return 6;
    case 'direct_import_unlink':      return 7;
    case 'final_module_deletion':     return 8;
  }
}

function stableBatchId(kind: DeletionBatchKind): string {
  return `batch_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function blastRadiusFor(stepCount: number, kind: DeletionBatchKind): DeletionBatch['estimated_blast_radius'] {
  if (kind === 'shared_utility_extraction' || kind === 'direct_import_unlink') {
    return stepCount > 5 ? 'large' : 'moderate';
  }
  if (kind === 'final_module_deletion') return stepCount > 10 ? 'moderate' : 'small';
  if (kind === 'emergency_bridges') return 'moderate';
  if (stepCount > 10) return 'moderate';
  if (stepCount > 3) return 'small';
  return 'tiny';
}

function modulesOfKind(map: CompatibilityCoreCodeMap, kinds: LinkedModuleKind[]) {
  const set = new Set(kinds);
  return map.modules.filter((m) => set.has(m.kind));
}

// ── Plan generation ──────────────────────────────────────────────────────────

export function generateCompatibilityCoreDeletionPlan(
  options: GenerateDeletionPlanOptions,
): DeletionPlan {
  const map = options.codeMap;
  const unlinkReport = options.unlinkReport
    ?? analyzeCompatibilityCoreUnlinkReadiness({ codeMap: map });
  const timeline = computeRetirementExecutionTimeline({ codeMap: map });

  // ── Refusal guard ──────────────────────────────────────────────────────
  let approved = true;
  let refusal: string | null = null;
  if (!options.assumeReadiness) {
    if (timeline.current_stage !== 'COMPATIBILITY_CORE_UNLINK' && timeline.current_stage !== 'FULL_RETIREMENT_READY') {
      approved = false;
      refusal = `Timeline current stage is ${timeline.current_stage}; deletion plan requires FULL_RETIREMENT_READY or higher.`;
    } else if (unlinkReport.blockingDependencies.length > 0) {
      approved = false;
      refusal = `${unlinkReport.blockingDependencies.length} blocking dependencies remain — resolve before executing.`;
    }
  }

  // ── Batches ────────────────────────────────────────────────────────────
  const batches: DeletionBatch[] = [];

  // Batch 1: documentation cleanup
  const docMods = modulesOfKind(map, ['documentation_only']);
  if (docMods.length > 0) {
    batches.push(makeBatch('documentation_cleanup',
      'Remove documentation references and orphaned doc files.',
      docMods.map((m) => ({
        module: m.path,
        action: 'remove_file',
        rationale: 'Doc-only reference; safe to delete first.',
      } as DeletionStep)),
      'No code paths touched; revert by restoring the doc files.',
    ));
  }

  // Batch 2: tests
  const testMods = modulesOfKind(map, ['test_only']);
  if (testMods.length > 0) {
    batches.push(makeBatch('test_cleanup',
      'Remove tests that exercise compatibility-core in isolation.',
      testMods.map((m) => ({
        module: m.path,
        action: 'remove_file',
        rationale: 'Tests no longer represent live behavior.',
      } as DeletionStep)),
      'Test suite must still pass on the planned-engine paths.',
    ));
  }

  // Batch 3: fallback-only modules
  const fbMods = modulesOfKind(map, ['fallback_only']);
  if (fbMods.length > 0) {
    batches.push(makeBatch('fallback_only_modules',
      'Delete modules that are only reachable through the fallback path.',
      fbMods.map((m) => ({
        module: m.path,
        action: 'remove_file',
        rationale: `Only importers are inside the compatibility-core call graph (${m.importers.length} caller(s)).`,
      } as DeletionStep)),
      'Run planned-engine integration tests; confirm zero references remain.',
    ));
  }

  // Batch 4: recovery assumption modules
  const recMods = modulesOfKind(map, ['recovery_assumption']);
  if (recMods.length > 0) {
    batches.push(makeBatch('recovery_assumption_modules',
      'Rewrite recovery paths that ASSUME compatibility-core is callable, then delete them.',
      recMods.map((m) => ({
        module: m.path,
        action: 'inline_into_planned_engine',
        rationale: 'Recovery code must no longer assume compatibility-core; inline a planned-only fallback first.',
      } as DeletionStep)),
      'Run UnifiedRecoveryGraph soak tests; verify no path calls into the removed module.',
    ));
  }

  // Batch 5: emergency bridges
  const bridgeMods = modulesOfKind(map, ['emergency_bridge']);
  if (bridgeMods.length > 0) {
    batches.push(makeBatch('emergency_bridges',
      'Remove emergency bridges that route to compatibility-core under failure.',
      bridgeMods.map((m) => ({
        module: m.path,
        action: 'remove_file',
        rationale: 'Bridge no longer needed once the planned engine is the sole runtime.',
      } as DeletionStep)),
      'Verify no env flag re-enables the bridge; confirm coverage on alternative recovery paths.',
    ));
  }

  // Batch 6: shared utility extraction
  const sharedMods = modulesOfKind(map, ['shared_utility']);
  const sharedExtractions: SharedUtilityExtraction[] = [];
  if (sharedMods.length > 0) {
    const steps: DeletionStep[] = [];
    for (const m of sharedMods) {
      const targetNeutral = m.path.replace(/[\\/]compatibility-core[\\/]/i, '/shared/').replace(/[\\/]compat[\\/]/i, '/shared/');
      const callers = m.importers.filter((i) => !i.includes('compatibility-core'));
      sharedExtractions.push({
        module: m.path,
        target_neutral_module: targetNeutral,
        callers_to_repoint: callers,
        rationale: m.notes ?? 'Shared between compatibility-core and another caller; must be relocated to a neutral module before unlink.',
      });
      steps.push({
        module: m.path,
        action: 'extract_to_neutral_module',
        rationale: `Move shared utility out of compatibility-core surface to ${targetNeutral}.`,
      });
      for (const caller of callers) {
        steps.push({
          module: m.path,
          action: 'remove_import',
          importer: caller,
          rationale: `Repoint ${caller} to the new neutral location.`,
        });
      }
    }
    batches.push(makeBatch('shared_utility_extraction',
      'Extract shared utilities to a neutral module; repoint callers.',
      steps,
      'Each caller still compiles and passes contract tests after re-pointing.',
    ));
  }

  // Batch 7: direct-import unlink
  const directExternalImporters = map.externalImporters.filter((l) => !l.fallback_branch_only);
  if (directExternalImporters.length > 0) {
    batches.push(makeBatch('direct_import_unlink',
      'Remove remaining direct imports of compatibility-core from production code paths.',
      directExternalImporters.map((l) => ({
        module: l.importedModule,
        action: 'remove_import',
        importer: l.importer,
        rationale: 'Live importer must be replaced with a planned-engine call before final deletion.',
      } as DeletionStep)),
      'tsc passes; CI runs the full long-form generation suite without referencing compatibility-core.',
    ));
  }

  // Batch 8: final module deletion (direct_imports + anything still standing)
  const finalCandidates = map.modules.filter((m) => m.kind === 'direct_import');
  if (finalCandidates.length > 0) {
    batches.push(makeBatch('final_module_deletion',
      'Delete the compatibility-core engine modules.',
      finalCandidates.map((m) => ({
        module: m.path,
        action: 'remove_file',
        rationale: 'Last step: remove the engine itself once all importers are gone.',
      } as DeletionStep)),
      'Build + integration tests + smoke test all green on a clean checkout.',
    ));
  }

  batches.sort((a, b) => a.order - b.order);

  // ── Final checklist + rollback strategy ────────────────────────────────
  const finalChecklist = [
    'Confirm tsc has zero references to deleted modules.',
    'Confirm grep for "compatibility-core" returns only historical doc / migration notes.',
    'Run full long-form integration suite on a clean checkout.',
    'Verify retirementExecutionTimeline.current_stage === COMPATIBILITY_CORE_UNLINK on staging.',
    'Confirm fallbackRate has been 0 for ≥ 48h before the deletion PR.',
    'Update CLAUDE.md / docs to mark the planned engine as canonical.',
  ];

  const rollbackStrategy = [
    'Each batch lands as a separate PR; revert any single batch without touching the others.',
    'Keep the deletion PRs reachable for ≥ 60 days for easy revert.',
    'If post-deploy fallback rate exceeds 0.5% during the 48h soak, revert the most recent batch and re-evaluate.',
    'If a downstream service surfaces an unexpected planned-engine error, do NOT re-merge compatibility-core; instead patch the planned engine.',
  ];

  // ── Modules explicitly preserved ───────────────────────────────────────
  const doNotDelete = unlinkReport.unsafeSharedUtilities
    .filter((u) => u.required_action === 'keep_until_replaced')
    .map((u) => u.module);

  return {
    generated_at: new Date().toISOString(),
    approved_to_execute: approved,
    refusal_reason: refusal,
    batches,
    shared_utility_extractions: sharedExtractions,
    do_not_delete: doNotDelete,
    final_unlink_checklist: finalChecklist,
    rollback_strategy: rollbackStrategy,
    inputs_summary: {
      timeline_current_stage: timeline.current_stage,
      unlink_readiness_score: unlinkReport.unlinkReadinessScore,
      blocking_dependency_count: unlinkReport.blockingDependencies.length,
      module_count: map.modules.length,
    },
  };
}

function makeBatch(
  kind: DeletionBatchKind,
  description: string,
  steps: DeletionStep[],
  checkpoint: string,
): DeletionBatch {
  return {
    batch_id: stableBatchId(kind),
    order: batchOrderFor(kind),
    kind,
    description,
    steps,
    rollback_checkpoint: checkpoint,
    estimated_blast_radius: blastRadiusFor(steps.length, kind),
  };
}
