/**
 * RF-3A — comparison + quality hooks + CONFIGURABLE classification.
 * Rules live in ClassificationConfig (config.ts) — not hard-coded here.
 */
import type {
  Classification, ClassificationConfig, DatasetEntry, QualityScores, RunCapture, WorkloadComparison, WorkloadDef,
} from './types';

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Pending quality scores — machine-readable hook for later manual/auto review. */
export function pendingQuality(): QualityScores {
  return {
    factualCorrectness: 'pending', relevance: 'pending', completeness: 'pending',
    brandConsistency: 'pending', instructionFollowing: 'pending', hallucination: 'pending',
    campaignUsefulness: 'pending', contentQuality: 'pending', reviewer: 'unassigned',
  };
}

function diffFields(legacy: Record<string, unknown>, canonical: Record<string, unknown>): { backfilled: string[]; overwritten: string[] } {
  const backfilled: string[] = [];
  const overwritten: string[] = [];
  for (const k of new Set([...Object.keys(legacy), ...Object.keys(canonical)])) {
    const b = legacy[k], a = canonical[k];
    if (isEmpty(b) && !isEmpty(a)) backfilled.push(k);
    else if (!isEmpty(b) && JSON.stringify(b) !== JSON.stringify(a)) overwritten.push(k);
  }
  return { backfilled: backfilled.sort(), overwritten: overwritten.sort() };
}

function missing(fields: string[], grounding: Record<string, unknown>): string[] {
  return fields.filter((f) => isEmpty(grounding[f])).sort();
}

/** Apply configurable rules → exactly one classification (+ human-readable reasons). */
export function classify(
  cmp: Omit<WorkloadComparison, 'classification' | 'classificationReasons'>,
  config: ClassificationConfig,
): { classification: Classification; reasons: string[] } {
  const reasons: string[] = [];
  const d = cmp.delta;
  const growth = cmp.legacy.promptChars > 0
    ? d.promptCharsDelta / cmp.legacy.promptChars
    : (cmp.canonical.promptChars > 0 ? 1 : 0);

  if (cmp.canonical.overwriteCount > config.maxOverwritesForEnforce) {
    reasons.push(`overwrite ${cmp.canonical.overwriteCount} > ${config.maxOverwritesForEnforce} (safety violation)`);
    return { classification: 'REQUIRES_ENGINEERING_CHANGES', reasons };
  }
  if (config.requireDeterministic && !d.deterministic) {
    reasons.push('non-deterministic grounding for identical inputs');
    return { classification: 'REQUIRES_ENGINEERING_CHANGES', reasons };
  }
  if (cmp.canonical.error) {
    reasons.push(`canonical arm error: ${cmp.canonical.error}`);
    return { classification: 'REQUIRES_ENGINEERING_CHANGES', reasons };
  }
  if (growth > config.maxPromptGrowthRatioForEnforce) {
    reasons.push(`prompt growth ${(growth * 100).toFixed(0)}% > ${(config.maxPromptGrowthRatioForEnforce * 100).toFixed(0)}%`);
    return { classification: 'KEEP_IN_SHADOW', reasons };
  }
  if (d.estCostDeltaUsd > config.maxCostDeltaUsdForEnforce) {
    reasons.push(`cost delta $${d.estCostDeltaUsd.toFixed(5)} > $${config.maxCostDeltaUsdForEnforce}`);
    return { classification: 'KEEP_IN_SHADOW', reasons };
  }
  const hasPending = Object.values(cmp.quality).some((v) => v === 'pending');
  if (config.requireQualityForEnforce && hasPending) {
    reasons.push('AI-output quality unscored (pending) — no equivalence evidence yet');
    return { classification: 'KEEP_IN_SHADOW', reasons };
  }
  reasons.push('no overwrite, deterministic, bounded prompt/cost growth, quality scored');
  return { classification: 'SAFE_TO_ENFORCE', reasons };
}

/** Build the full comparison for a (workload, entry) pair. */
export function compareArms(input: {
  workload: WorkloadDef;
  entry: DatasetEntry;
  legacy: RunCapture;
  canonical: RunCapture;
  deterministic: boolean;
  quality?: QualityScores;
  config: ClassificationConfig;
  traceId?: string;
}): WorkloadComparison {
  const { workload, entry, legacy, canonical } = input;
  const { backfilled, overwritten } = diffFields(legacy.grounding, canonical.grounding);
  const quality = input.quality ?? pendingQuality();

  const base = {
    workload: workload.key,
    entryId: entry.id,
    size: entry.size,
    completeness: entry.completeness,
    legacy,
    canonical,
    delta: {
      promptCharsDelta: canonical.promptChars - legacy.promptChars,
      promptChanged: canonical.prompt !== legacy.prompt,
      backfilledFields: backfilled,
      overwrittenFields: overwritten,
      missingFieldsLegacy: missing(workload.fields, legacy.grounding),
      missingFieldsCanonical: missing(workload.fields, canonical.grounding),
      completenessDelta: canonical.contextCompleteness - legacy.contextCompleteness,
      groundingLatencyDeltaMs: canonical.groundingLatencyMs - legacy.groundingLatencyMs,
      tokensInDelta: canonical.tokensIn - legacy.tokensIn,
      estCostDeltaUsd: canonical.estCostUsd - legacy.estCostUsd,
      deterministic: input.deterministic,
    },
    quality,
    traceId: input.traceId,
  };
  const { classification, reasons } = classify(base, input.config);
  return { ...base, classification, classificationReasons: reasons };
}
