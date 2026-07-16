/**
 * RF-3A — machine-readable report emitters (JSON / CSV / Markdown).
 * Pure string builders; no filesystem writes (the caller decides where to persist).
 */
import type { HarnessResult, WorkloadComparison } from './types';

export function toJson(result: HarnessResult): string {
  return JSON.stringify(result, null, 2);
}

const CSV_COLS = [
  'workload', 'entryId', 'size', 'completeness', 'classification',
  'legacyPromptChars', 'canonicalPromptChars', 'promptCharsDelta', 'promptChanged',
  'backfillCount', 'overwriteCount', 'completenessDelta',
  'legacyTokensIn', 'canonicalTokensIn', 'tokensInDelta', 'estCostDeltaUsd',
  'assemblyLatencyMs', 'cacheColdHit', 'cacheWarmHit', 'fallbackUsed', 'deterministic', 'error',
] as const;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(result: HarnessResult): string {
  const rows = [CSV_COLS.join(',')];
  for (const c of result.comparisons) {
    rows.push([
      c.workload, c.entryId, c.size, c.completeness, c.classification,
      c.legacy.promptChars, c.canonical.promptChars, c.delta.promptCharsDelta, c.delta.promptChanged,
      c.canonical.backfillCount, c.canonical.overwriteCount, c.delta.completenessDelta.toFixed(3),
      c.legacy.tokensIn, c.canonical.tokensIn, c.delta.tokensInDelta, c.delta.estCostDeltaUsd.toFixed(6),
      c.canonical.assemblyLatencyMs, c.canonical.cacheColdHit, c.canonical.cacheWarmHit,
      c.canonical.fallbackUsed, c.delta.deterministic, c.canonical.error ?? '',
    ].map(csvCell).join(','));
  }
  return rows.join('\n');
}

export function toMarkdown(result: HarnessResult): string {
  const s = result.summary;
  const lines: string[] = [];
  lines.push('# Canonical Grounding — Equivalence Harness Report (RF-3A)');
  lines.push('');
  lines.push(`- Params: ${result.generatedForParams.provider}/${result.generatedForParams.model} · temp=${result.generatedForParams.temperature} · seed=${result.generatedForParams.seed}`);
  lines.push(`- Dataset entries: ${result.datasetSize} · Workloads: ${result.workloadCount} · Comparisons: ${result.comparisons.length}`);
  lines.push('');
  lines.push('## Classification summary');
  lines.push('');
  lines.push('| Classification | Count |');
  lines.push('|---|---|');
  lines.push(`| SAFE_TO_ENFORCE | ${s.byClassification.SAFE_TO_ENFORCE} |`);
  lines.push(`| KEEP_IN_SHADOW | ${s.byClassification.KEEP_IN_SHADOW} |`);
  lines.push(`| REQUIRES_ENGINEERING_CHANGES | ${s.byClassification.REQUIRES_ENGINEERING_CHANGES} |`);
  lines.push('');
  lines.push('## Per-workload (worst-case across entries)');
  lines.push('');
  lines.push('| Workload | Classification |');
  lines.push('|---|---|');
  for (const [w, cls] of Object.entries(s.byWorkload)) lines.push(`| ${w} | ${cls} |`);
  lines.push('');
  lines.push('## Detail');
  lines.push('');
  lines.push('| Workload | Entry | Size | Complete | Class | ΔpromptChars | backfill | overwrite | Δcost$ | det |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const c of result.comparisons) lines.push(detailRow(c));
  return lines.join('\n');
}

function detailRow(c: WorkloadComparison): string {
  return `| ${c.workload} | ${c.entryId} | ${c.size} | ${c.completeness} | ${c.classification} | ${c.delta.promptCharsDelta} | ${c.canonical.backfillCount} | ${c.canonical.overwriteCount} | ${c.delta.estCostDeltaUsd.toFixed(6)} | ${c.delta.deterministic} |`;
}
