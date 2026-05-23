// Editorial Prompt Assembly Budget Guard
//
// Advisory-only measurement of editorial prompt/context size. Detects silent
// prompt inflation, duplicated advisory payload, repeated context fragments,
// and oversized section payloads. It generates advisory warnings ONLY — it
// never truncates, gates runtime, mutates prompts, or mutates scoring.

export type EditorialPromptBudgetStatus = 'within_budget' | 'budget_advisory' | 'budget_warning';

export interface EditorialPromptSegment {
  name: string;
  content: string;
}

export interface EditorialPromptBudgetThresholds {
  totalBudgetChars: number;
  oversizedSegmentChars: number;
  repeatedFragmentMinLength: number;
}

export const DEFAULT_EDITORIAL_PROMPT_BUDGET: EditorialPromptBudgetThresholds = {
  totalBudgetChars: 60000,
  oversizedSegmentChars: 8000,
  repeatedFragmentMinLength: 40,
};

export interface EditorialPromptBudgetReport {
  version: 'editorial-prompt-budget-guard-v1';
  generatedAt: string;
  totalChars: number;
  segmentCount: number;
  segmentSizes: readonly { name: string; chars: number }[];
  duplicatedSegments: readonly { name: string; duplicateOf: string }[];
  oversizedSegments: readonly { name: string; chars: number }[];
  repeatedFragments: readonly { fragment: string; occurrences: number }[];
  duplicatedPayloadChars: number;
  budgetStatus: EditorialPromptBudgetStatus;
  warnings: readonly string[];
  thresholds: EditorialPromptBudgetThresholds;
}

function asContent(value: string | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function evaluateEditorialPromptBudget(
  segments: readonly EditorialPromptSegment[],
  thresholds: EditorialPromptBudgetThresholds = DEFAULT_EDITORIAL_PROMPT_BUDGET,
): EditorialPromptBudgetReport {
  const ordered = [...segments]
    .map((segment) => ({ name: String(segment.name || ''), content: asContent(segment.content) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const segmentSizes = ordered.map((segment) => ({ name: segment.name, chars: segment.content.length }));
  const totalChars = segmentSizes.reduce((sum, segment) => sum + segment.chars, 0);

  // Duplicated segments — identical content, deterministic first-seen owner.
  const firstByContent = new Map<string, string>();
  const duplicatedSegments: { name: string; duplicateOf: string }[] = [];
  let duplicatedPayloadChars = 0;
  for (const segment of ordered) {
    if (!segment.content) continue;
    const owner = firstByContent.get(segment.content);
    if (owner === undefined) {
      firstByContent.set(segment.content, segment.name);
    } else {
      duplicatedSegments.push({ name: segment.name, duplicateOf: owner });
      duplicatedPayloadChars += segment.content.length;
    }
  }

  // Oversized segments.
  const oversizedSegments = segmentSizes
    .filter((segment) => segment.chars > thresholds.oversizedSegmentChars)
    .map((segment) => ({ name: segment.name, chars: segment.chars }));

  // Repeated context fragments — lines repeated across the assembled context.
  const fragmentCounts = new Map<string, number>();
  for (const segment of ordered) {
    const lines = new Set<string>();
    for (const rawLine of segment.content.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (line.length < thresholds.repeatedFragmentMinLength) continue;
      lines.add(line);
    }
    for (const line of lines) {
      fragmentCounts.set(line, (fragmentCounts.get(line) || 0) + 1);
    }
  }
  const repeatedFragments = Array.from(fragmentCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([fragment, occurrences]) => ({ fragment, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences || a.fragment.localeCompare(b.fragment))
    .slice(0, 20);

  const warnings: string[] = [];
  if (totalChars > thresholds.totalBudgetChars) {
    warnings.push(
      `editorial prompt budget exceeded: ${totalChars} chars over ${thresholds.totalBudgetChars}-char advisory budget`,
    );
  }
  for (const segment of oversizedSegments) {
    warnings.push(
      `oversized segment: '${segment.name}' is ${segment.chars} chars (advisory limit ${thresholds.oversizedSegmentChars})`,
    );
  }
  for (const duplicate of duplicatedSegments) {
    warnings.push(`duplicated advisory segment: '${duplicate.name}' is identical to '${duplicate.duplicateOf}'`);
  }
  for (const repeated of repeatedFragments) {
    warnings.push(`repeated context fragment appears ${repeated.occurrences}x: "${repeated.fragment.slice(0, 60)}"`);
  }

  const budgetStatus: EditorialPromptBudgetStatus =
    totalChars > thresholds.totalBudgetChars || oversizedSegments.length > 0
      ? 'budget_warning'
      : duplicatedSegments.length > 0 || repeatedFragments.length > 0
        ? 'budget_advisory'
        : 'within_budget';

  return {
    version: 'editorial-prompt-budget-guard-v1',
    generatedAt: new Date(0).toISOString(),
    totalChars,
    segmentCount: ordered.length,
    segmentSizes,
    duplicatedSegments,
    oversizedSegments,
    repeatedFragments,
    duplicatedPayloadChars,
    budgetStatus,
    warnings,
    thresholds,
  };
}

export function serializeEditorialPromptBudgetReport(report: EditorialPromptBudgetReport): string {
  return [
    '## EDITORIAL PROMPT BUDGET GUARD',
    `Version: ${report.version}`,
    `Budget status: ${report.budgetStatus}`,
    `Total chars: ${report.totalChars} / ${report.thresholds.totalBudgetChars} advisory budget`,
    `Segments: ${report.segmentCount}`,
    `Duplicated segments: ${report.duplicatedSegments.length} (${report.duplicatedPayloadChars} chars)`,
    `Oversized segments: ${report.oversizedSegments.length}`,
    `Repeated fragments: ${report.repeatedFragments.length}`,
    `Warnings: ${report.warnings.join('; ') || 'none'}`,
  ].join('\n');
}
