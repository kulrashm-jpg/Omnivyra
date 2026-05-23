// Editorial Diagnostic Compaction
//
// Advisory-only, non-mutating compaction of the deeply repetitive editorial
// diagnostic report. Section dimensions repeat identical indicator / drift
// arrays across sections; this module interns those into a shared pool and
// produces a compact projection plus a compact serializer.
//
// MUST remain diagnostic-only, non-mutating, and advisory-only. It never edits
// the source report — it returns a separate compacted structure.

import type {
  EditorialDiagnosticReport,
  SectionEditorialDiagnostic,
  EditorialDiagnosticDimension,
} from './editorialDiagnosticObserver';

export type EditorialDiagnosticCompactionVersion = 'editorial-diagnostic-compaction-v1';

const DIMENSION_KEYS = [
  'sectionRoleAlignment',
  'narrativeStageAlignment',
  'readerStateProgression',
  'repetitionRisk',
  'frameworkReuseRisk',
  'genericFramingRisk',
  'doctrineAlignment',
  'assimilationAlignment',
  'proofBehaviorAlignment',
  'transitionAlignment',
  'sectionDifferentiationAlignment',
] as const;

type DimensionKey = (typeof DIMENSION_KEYS)[number];

export interface CompactDimension {
  key: DimensionKey;
  aligned: boolean;
  risk: EditorialDiagnosticDimension['risk'];
  confidence: EditorialDiagnosticDimension['confidence'];
  indicatorsRef: number;
  driftIndicatorsRef: number;
}

export interface CompactSection {
  sectionIndex: number;
  progressionStage: SectionEditorialDiagnostic['progressionStage'];
  narrativeRole: SectionEditorialDiagnostic['narrativeRole'];
  riskFlagsRef: number;
  dimensions: readonly CompactDimension[];
}

export interface CompactedEditorialDiagnostics {
  version: EditorialDiagnosticCompactionVersion;
  generatedAt: string;
  contentType: string;
  topic: string;
  arrayPool: readonly (readonly string[])[];
  sections: readonly CompactSection[];
  normalizedRiskSignals: readonly string[];
  compactionStats: {
    sectionCount: number;
    rawArrays: number;
    pooledArrays: number;
    dedupedArrays: number;
  };
}

function normalizeArray(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values || []) {
    const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

class ArrayPool {
  private readonly index = new Map<string, number>();
  readonly pool: string[][] = [];

  intern(values: string[]): number {
    const key = JSON.stringify(values);
    const existing = this.index.get(key);
    if (existing !== undefined) return existing;
    const id = this.pool.length;
    this.index.set(key, id);
    this.pool.push(values);
    return id;
  }
}

export function compactEditorialDiagnostics(
  report: EditorialDiagnosticReport,
): CompactedEditorialDiagnostics {
  const pool = new ArrayPool();
  let rawArrays = 0;
  const allRisk: string[] = [...report.riskFlags];

  const ordered = [...report.sections].sort((a, b) => a.sectionIndex - b.sectionIndex);
  const sections: CompactSection[] = ordered.map((section) => {
    const dimensions: CompactDimension[] = DIMENSION_KEYS.map((key) => {
      const dimension = section[key] as EditorialDiagnosticDimension;
      rawArrays += 2;
      allRisk.push(...dimension.driftIndicators);
      return {
        key,
        aligned: dimension.aligned,
        risk: dimension.risk,
        confidence: dimension.confidence,
        indicatorsRef: pool.intern(normalizeArray(dimension.indicators)),
        driftIndicatorsRef: pool.intern(normalizeArray(dimension.driftIndicators)),
      };
    });
    rawArrays += 1;
    return {
      sectionIndex: section.sectionIndex,
      progressionStage: section.progressionStage,
      narrativeRole: section.narrativeRole,
      riskFlagsRef: pool.intern(normalizeArray(section.riskFlags)),
      dimensions,
    };
  });

  return {
    version: 'editorial-diagnostic-compaction-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: report.contentType,
    topic: report.topic,
    arrayPool: pool.pool,
    sections,
    normalizedRiskSignals: normalizeArray(allRisk),
    compactionStats: {
      sectionCount: ordered.length,
      rawArrays,
      pooledArrays: pool.pool.length,
      dedupedArrays: Math.max(0, rawArrays - pool.pool.length),
    },
  };
}

export function serializeCompactedEditorialDiagnostics(compacted: CompactedEditorialDiagnostics): string {
  const stats = compacted.compactionStats;
  const sectionLines = compacted.sections.map((section) => {
    const highRisk = section.dimensions.filter((dimension) => dimension.risk === 'high').length;
    return `${section.sectionIndex + 1}. ${section.progressionStage}/${section.narrativeRole}: high-risk dimensions=${highRisk}`;
  });
  return [
    '## EDITORIAL DIAGNOSTIC COMPACTION',
    `Version: ${compacted.version}`,
    `Topic: ${compacted.topic}`,
    `Content type: ${compacted.contentType}`,
    `Sections: ${stats.sectionCount}`,
    `Arrays: ${stats.rawArrays} raw / ${stats.pooledArrays} pooled / ${stats.dedupedArrays} deduped`,
    `Risk signals: ${compacted.normalizedRiskSignals.join('; ') || 'none'}`,
    ...sectionLines,
  ].join('\n');
}
