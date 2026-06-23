/**
 * PHASE BOLT-PROGRESS-PARITY — single canonical progress authority.
 *
 * The ONLY source of stage ordering, labels, visibility, and runtime-stage
 * resolution for every BOLT builder (Text / Creator / Combined). No builder may
 * keep its own stage array. Maps EXISTING backend `current_stage` emissions
 * (from boltPipelineService / progress.ts) to one canonical 9-stage model.
 *
 * Presentation only — no backend stage is renamed, added, or emitted here.
 */

export type CampaignBuilderMode = 'TEXT' | 'CREATOR' | 'COMBINED';

/** Stable canonical stage ids (used as React keys + ProgressCard substage key). */
export type CanonicalStageId =
  | 'getting-ready'
  | 'building-strategy'
  | 'building-activities'
  | 'creating-content'
  | 'creating-assets'
  | 'repurposing-content'
  | 'scheduling-activities'
  | 'finalizing-campaign'
  | 'campaign-ready';

/**
 * A rendered progress step. `stage` is the stable key (also what ProgressCard
 * keys its ai/plan substage line off — Building Strategy uses 'ai/plan').
 * `backendStages` are the runtime `current_stage` values that map to this step.
 */
export type ProgressStep = {
  stage: string;
  label: string;
  backendStages: string[];
};

/** Canonical labels — identical vocabulary across ALL builders. */
export const CANONICAL_LABELS: Record<CanonicalStageId, string> = {
  'getting-ready': 'Getting Ready',
  'building-strategy': 'Building Strategy',
  'building-activities': 'Building Activities',
  'creating-content': 'Creating Content',
  'creating-assets': 'Creating Assets',
  'repurposing-content': 'Repurposing Content',
  'scheduling-activities': 'Scheduling Activities',
  'finalizing-campaign': 'Finalizing Campaign',
  'campaign-ready': 'Campaign Ready',
};

/**
 * The full ordered canonical pipeline. `stage` is the canonical key EXCEPT where
 * ProgressCard depends on the backend key:
 *   - Building Strategy uses 'ai/plan' so the existing substage line keeps
 *     rendering (ProgressCard: `step.stage === 'ai/plan'`).
 * `backendStages` carry the exact runtime stages each step absorbs.
 */
const FULL_PIPELINE: Array<ProgressStep & { id: CanonicalStageId }> = [
  { id: 'getting-ready',        stage: 'source-recommendation', label: CANONICAL_LABELS['getting-ready'],        backendStages: ['source-recommendation'] },
  { id: 'building-strategy',    stage: 'ai/plan',               label: CANONICAL_LABELS['building-strategy'],    backendStages: ['ai/plan'] },
  { id: 'building-activities',  stage: 'generate-weekly-structure', label: CANONICAL_LABELS['building-activities'], backendStages: ['commit-plan', 'generate-weekly-structure'] },
  { id: 'creating-content',     stage: 'schedule-creating-content', label: CANONICAL_LABELS['creating-content'], backendStages: ['schedule-creating-content'] },
  { id: 'creating-assets',      stage: 'creator-asset-generation',  label: CANONICAL_LABELS['creating-assets'],  backendStages: ['creator-asset-generation', 'render-creator'] },
  { id: 'repurposing-content',  stage: 'schedule-repurposing-content', label: CANONICAL_LABELS['repurposing-content'], backendStages: ['schedule-repurposing-content'] },
  { id: 'scheduling-activities', stage: 'schedule-structured-plan', label: CANONICAL_LABELS['scheduling-activities'], backendStages: ['schedule-structured-plan', 'schedule-writing-posts', 'schedule'] },
  { id: 'finalizing-campaign',  stage: 'finalizing-campaign',   label: CANONICAL_LABELS['finalizing-campaign'],  backendStages: [] },
  { id: 'campaign-ready',       stage: 'campaign-ready',        label: CANONICAL_LABELS['campaign-ready'],       backendStages: [] },
];

/**
 * Per-mode stage visibility (Section 4):
 *   TEXT     → hide Creating Assets
 *   CREATOR  → hide Creating Content + Repurposing Content
 *   COMBINED → show everything
 */
const HIDDEN_BY_MODE: Record<CampaignBuilderMode, Set<CanonicalStageId>> = {
  TEXT: new Set(['creating-assets']),
  CREATOR: new Set(['creating-content', 'repurposing-content']),
  COMBINED: new Set(),
};

/**
 * The ONLY way a builder obtains its progress stages. Returns canonical
 * ProgressSteps for the mode, in canonical order, with hidden stages removed.
 */
export function getProgressPipeline(mode: CampaignBuilderMode): ProgressStep[] {
  const hidden = HIDDEN_BY_MODE[mode] ?? HIDDEN_BY_MODE.COMBINED;
  return FULL_PIPELINE
    .filter((s) => !hidden.has(s.id))
    .map(({ stage, label, backendStages }) => ({ stage, label, backendStages }));
}

/** Does a runtime `current_stage` belong to this step's backend set? */
function matchesBackend(runtimeStage: string, backend: string): boolean {
  if (backend === 'ai/plan') return runtimeStage === 'ai/plan' || runtimeStage.startsWith('ai/plan:');
  // Prefix-matched backend stages: generate-weekly-structure-weeks-N-M (batch),
  // generate-weekly-structure:<substage> (intra-stage), and
  // render-creator-<contentType> (per-asset render progress).
  if (backend === 'generate-weekly-structure') {
    return runtimeStage === backend
      || runtimeStage.startsWith('generate-weekly-structure-')
      || runtimeStage.startsWith('generate-weekly-structure:');
  }
  if (backend === 'render-creator') {
    return runtimeStage === backend || runtimeStage.startsWith(`${backend}-`);
  }
  return runtimeStage === backend;
}

/**
 * Resolve a runtime backend stage (incl. `ai/plan:<sub>` and
 * `generate-weekly-structure-weeks-N-M`) to its index in a canonical pipeline.
 * Returns -1 when the stage doesn't map (e.g. terminal markers while running).
 */
export function resolveCanonicalStageIndex(stage: string | undefined, pipeline: ProgressStep[]): number {
  if (!stage) return -1;
  const exact = pipeline.findIndex((s) => s.stage === stage);
  if (exact !== -1) return exact;
  for (let i = 0; i < pipeline.length; i += 1) {
    if ((pipeline[i].backendStages ?? []).some((b) => matchesBackend(stage, b))) return i;
  }
  return -1;
}
