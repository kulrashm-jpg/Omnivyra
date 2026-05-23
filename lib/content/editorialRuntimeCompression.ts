// Editorial Runtime Compression Layer
//
// Advisory-only, non-mutating context compression. Collapses repeated advisory
// fragments (dependency / boundary / preservation / verification / risk / gap
// arrays) into a shared interned pool so identical structures are stored once.
//
// MUST NOT change runtime behavior, remove required context, or rewrite
// generators. This module only produces a compressed *view*; expansion is
// loss-free for debug compatibility.

export type EditorialRuntimeCompressionVersion = 'editorial-runtime-compression-v1';

export interface AdvisorySectionFragment {
  sectionIndex: number;
  dependencies?: readonly string[];
  boundaries?: readonly string[];
  preservationRequirements?: readonly string[];
  verificationRequirements?: readonly string[];
  riskSignals?: readonly string[];
  gapSignals?: readonly string[];
}

export interface CompressedSectionFragment {
  sectionIndex: number;
  dependenciesRef: number;
  boundariesRef: number;
  preservationRequirementsRef: number;
  verificationRequirementsRef: number;
  riskSignalsRef: number;
  gapSignalsRef: number;
}

export interface EditorialRuntimeCompression {
  version: EditorialRuntimeCompressionVersion;
  generatedAt: string;
  fragmentPool: readonly (readonly string[])[];
  sections: readonly CompressedSectionFragment[];
  normalizedRiskSignals: readonly string[];
  normalizedGapSignals: readonly string[];
  compressionStats: {
    sectionCount: number;
    rawFragmentArrays: number;
    pooledFragmentArrays: number;
    dedupedFragmentArrays: number;
    rawSignalCount: number;
    normalizedSignalCount: number;
  };
}

const FRAGMENT_FIELDS = [
  'dependencies',
  'boundaries',
  'preservationRequirements',
  'verificationRequirements',
  'riskSignals',
  'gapSignals',
] as const;

function normalizeFragment(values: readonly string[] | undefined): string[] {
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

class FragmentPool {
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

export function compressEditorialRuntimeContext(
  fragments: readonly AdvisorySectionFragment[],
): EditorialRuntimeCompression {
  const ordered = [...fragments].sort((a, b) => a.sectionIndex - b.sectionIndex);
  const pool = new FragmentPool();
  let rawSignalCount = 0;
  const allRisk: string[] = [];
  const allGap: string[] = [];

  const sections: CompressedSectionFragment[] = ordered.map((fragment) => {
    const refs = FRAGMENT_FIELDS.map((field) => pool.intern(normalizeFragment(fragment[field])));
    rawSignalCount += (fragment.riskSignals?.length || 0) + (fragment.gapSignals?.length || 0);
    allRisk.push(...(fragment.riskSignals || []));
    allGap.push(...(fragment.gapSignals || []));
    return {
      sectionIndex: fragment.sectionIndex,
      dependenciesRef: refs[0],
      boundariesRef: refs[1],
      preservationRequirementsRef: refs[2],
      verificationRequirementsRef: refs[3],
      riskSignalsRef: refs[4],
      gapSignalsRef: refs[5],
    };
  });

  const normalizedRiskSignals = normalizeFragment(allRisk);
  const normalizedGapSignals = normalizeFragment(allGap);
  const rawFragmentArrays = ordered.length * FRAGMENT_FIELDS.length;

  return {
    version: 'editorial-runtime-compression-v1',
    generatedAt: new Date(0).toISOString(),
    fragmentPool: pool.pool,
    sections,
    normalizedRiskSignals,
    normalizedGapSignals,
    compressionStats: {
      sectionCount: ordered.length,
      rawFragmentArrays,
      pooledFragmentArrays: pool.pool.length,
      dedupedFragmentArrays: Math.max(0, rawFragmentArrays - pool.pool.length),
      rawSignalCount,
      normalizedSignalCount: normalizedRiskSignals.length + normalizedGapSignals.length,
    },
  };
}

// Loss-free expansion back to advisory fragments — debug compatibility.
export function expandEditorialRuntimeContext(
  compression: EditorialRuntimeCompression,
): AdvisorySectionFragment[] {
  const at = (ref: number): readonly string[] => compression.fragmentPool[ref] || [];
  return compression.sections.map((section) => ({
    sectionIndex: section.sectionIndex,
    dependencies: at(section.dependenciesRef),
    boundaries: at(section.boundariesRef),
    preservationRequirements: at(section.preservationRequirementsRef),
    verificationRequirements: at(section.verificationRequirementsRef),
    riskSignals: at(section.riskSignalsRef),
    gapSignals: at(section.gapSignalsRef),
  }));
}

export function serializeEditorialRuntimeCompression(compression: EditorialRuntimeCompression): string {
  const stats = compression.compressionStats;
  return [
    '## EDITORIAL RUNTIME COMPRESSION',
    `Version: ${compression.version}`,
    `Sections: ${stats.sectionCount}`,
    `Fragment arrays: ${stats.rawFragmentArrays} raw / ${stats.pooledFragmentArrays} pooled / ${stats.dedupedFragmentArrays} deduped`,
    `Signals: ${stats.rawSignalCount} raw / ${stats.normalizedSignalCount} normalized`,
    `Risk signals: ${compression.normalizedRiskSignals.join('; ') || 'none'}`,
    `Gap signals: ${compression.normalizedGapSignals.join('; ') || 'none'}`,
  ].join('\n');
}
