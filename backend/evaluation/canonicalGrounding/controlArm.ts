/**
 * DT-C1 — UNGROUNDED CONTROL ARM (counterfactual baseline).
 *
 * WHY THIS EXISTS
 * ---------------
 * The RF-3A harness (`execute.ts`) already runs two arms:
 *   • 'legacy'    — grounding = { ...entry.profile }          (raw profile injected)
 *   • 'canonical' — grounding = canonical assembly + overlay   (the intervention)
 *
 * BOTH of those arms are GROUNDED. The legacy arm still projects the company's
 * full profile into the prompt, so `legacy vs canonical` answers a MIGRATION
 * question ("is canonical safe to enforce?"), NOT the counterfactual question
 * ("what does the system produce when grounding is ABSENT?").
 *
 * This module supplies the missing third arm:
 *   • 'ungrounded' — grounding = {}                            (nothing injected)
 *
 * It is the control against which any future grounding-efficacy comparison must
 * be measured. It is INFRASTRUCTURE ONLY.
 *
 * HARD INVARIANTS
 * ---------------
 *  1. NO GROUNDING MACHINERY. This module deliberately does NOT import
 *     contextAssimilationEngine, canonicalProfileOverlay, canonicalContextAdapters,
 *     or the evaluation cache. Its isolation from the intervention is structural,
 *     not conventional — importing them would defeat the point of a control.
 *  2. NO EXTERNAL API. The default runner is offline and never calls a provider.
 *  3. NO WALL CLOCK, NO RNG. Nothing here reads Date.now() or Math.random(), so
 *     repeated execution is BYTE-IDENTICAL. Latency fields are deliberately ABSENT
 *     from the capture rather than recorded as zero — a control arm must not carry
 *     fields whose values would be fabricated.
 *  4. NO PERSISTENCE. Pure functions only. Mirrors the architectural rule stated
 *     in report.ts ("no filesystem writes — the caller decides where to persist").
 *  5. NO PRODUCTION REACHABILITY. Lives under backend/evaluation/, imported only
 *     by its CLI runner and its tests.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is NOT an experiment and produces NO efficacy result. It establishes that
 * a counterfactual arm exists, covers the dataset, and is reproducible. Nothing
 * more may be concluded from it.
 */

import { loadGoldenDataset } from './dataset';
import { WORKLOADS, projectPrompt } from './workloads';
import { DEFAULT_EXECUTION_PARAMS } from './config';
import type { AiRunResult, AiRunner, DatasetEntry, ExecutionParams, WorkloadDef } from './types';

/** The arm identifier. Distinct from the harness's 'legacy' | 'canonical'. */
export const UNGROUNDED_ARM = 'ungrounded' as const;
export type UngroundedArm = typeof UNGROUNDED_ARM;

/**
 * The control's grounding record: EMPTY. Frozen so no caller can accidentally
 * seed it with company facts and silently turn the control into a treatment.
 */
export const EMPTY_GROUNDING: Readonly<Record<string, unknown>> = Object.freeze({});

/** Deterministic token estimate — mirrors execute.ts's estimator exactly. */
function estTokens(text: string, charsPerToken: number): number {
  return Math.ceil(text.length / Math.max(1, charsPerToken));
}

/**
 * DEFAULT control runner — OFFLINE. Byte-identical to the harness's
 * `offlineAiRunner` in behaviour, but redefined here so this module does not
 * import execute.ts (which pulls in the grounding machinery at module scope).
 * NEVER calls a provider.
 */
export const offlineControlRunner: AiRunner = async (prompt, params): Promise<AiRunResult> => ({
  text: null,
  tokensIn: estTokens(prompt, params.charsPerToken),
  tokensOut: 0,
  latencyMs: 0,
  retries: 0,
  error: null,
});

/**
 * One ungrounded capture. Deliberately carries ONLY deterministic fields — there
 * are no latency or cache fields, because the control performs no assembly and
 * timing them would make the artifact non-reproducible.
 */
export interface UngroundedCapture {
  arm: UngroundedArm;
  workload: string;
  entryId: string;
  /** Always {} — retained so the artifact proves emptiness rather than asserting it. */
  grounding: Record<string, unknown>;
  prompt: string;
  promptChars: number;
  /** Fields the workload WOULD have consumed — all necessarily missing here. */
  omittedFields: string[];
  /** 0 by construction: no consumed field can be present with empty grounding. */
  contextCompleteness: number;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  /** null unless an operator injects a runner that reports an error. */
  error: string | null;
}

/**
 * Execute the ungrounded control for one (workload, entry).
 *
 * The ONLY thing removed relative to the grounded arms is the grounding itself:
 * the identical `projectPrompt` projection is applied, to an empty record. The
 * `entry` is accepted (and its id recorded) so coverage is provable per dataset
 * entry, but NO field of the entry's profile or content is read.
 */
export async function executeUngroundedArm(
  workload: WorkloadDef,
  entry: DatasetEntry,
  aiRunner: AiRunner = offlineControlRunner,
  params: ExecutionParams = DEFAULT_EXECUTION_PARAMS,
): Promise<UngroundedCapture> {
  // Grounding intervention ABSENT. No assimilation, no overlay, no facts block,
  // no profile read. The prompt is the workload instruction and nothing else.
  const prompt = projectPrompt(workload, EMPTY_GROUNDING as Record<string, unknown>);

  const ai = await aiRunner(prompt, params);
  const estCostUsd = ((ai.tokensIn + ai.tokensOut) / 1000) * params.costPer1kTokens;

  return {
    arm: UNGROUNDED_ARM,
    workload: workload.key,
    entryId: entry.id,
    grounding: {},
    prompt,
    promptChars: prompt.length,
    omittedFields: [...workload.fields].sort(),
    contextCompleteness: 0,
    tokensIn: ai.tokensIn,
    tokensOut: ai.tokensOut,
    estCostUsd,
    error: ai.error,
  };
}

export interface ControlArmOptions {
  aiRunner?: AiRunner;
  params?: ExecutionParams;
  dataset?: DatasetEntry[];
  workloads?: WorkloadDef[];
}

export interface ControlArmCoverage {
  datasetEntries: number;
  workloads: number;
  expected: number;
  successful: number;
  failed: number;
  skipped: number;
  /** successful / expected, as a 0..1 ratio rounded to 6dp. */
  coverage: number;
}

export interface ControlArmResult {
  armId: UngroundedArm;
  /** Identity of the dataset this control was run against. */
  datasetId: string;
  datasetEntryIds: string[];
  workloadKeys: string[];
  params: ExecutionParams;
  captures: UngroundedCapture[];
  coverage: ControlArmCoverage;
}

/**
 * Run the ungrounded control across the full canonical dataset × workloads.
 * Ordering is fixed (workload outer, entry inner) to mirror the harness and to
 * keep serialization stable.
 */
export async function runControlArm(opts: ControlArmOptions = {}): Promise<ControlArmResult> {
  const aiRunner = opts.aiRunner ?? offlineControlRunner;
  const params = opts.params ?? DEFAULT_EXECUTION_PARAMS;
  const dataset = opts.dataset ?? loadGoldenDataset();
  const workloads = opts.workloads ?? WORKLOADS;

  const captures: UngroundedCapture[] = [];
  let failed = 0;

  for (const workload of workloads) {
    for (const entry of dataset) {
      const capture = await executeUngroundedArm(workload, entry, aiRunner, params);
      if (capture.error) failed++;
      captures.push(capture);
    }
  }

  const expected = dataset.length * workloads.length;
  const successful = captures.length - failed;

  return {
    armId: UNGROUNDED_ARM,
    datasetId: 'canonicalGrounding.goldenDataset.v1',
    datasetEntryIds: dataset.map((e) => e.id),
    workloadKeys: workloads.map((w) => w.key),
    params,
    captures,
    coverage: {
      datasetEntries: dataset.length,
      workloads: workloads.length,
      expected,
      successful,
      failed,
      skipped: expected - captures.length,
      coverage: expected === 0 ? 0 : Number((successful / expected).toFixed(6)),
    },
  };
}

/** Stable key ordering so serialization is byte-identical across runs. */
function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stableSort(src[k]);
    return out;
  }
  return value;
}

/**
 * Deterministic serialization of a control-arm result. Given identical inputs
 * this returns a byte-identical string — no clock, no RNG, no key-order drift.
 * Pure: writes nothing.
 */
export function serializeControlArm(result: ControlArmResult): string {
  return `${JSON.stringify(stableSort(result), null, 2)}\n`;
}

/** FNV-1a 32-bit — a dependency-free content fingerprint for the artifact header. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
