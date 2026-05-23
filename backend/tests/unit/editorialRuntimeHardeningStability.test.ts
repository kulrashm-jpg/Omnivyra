import {
  compressEditorialRuntimeContext,
  expandEditorialRuntimeContext,
  serializeEditorialRuntimeCompression,
  type AdvisorySectionFragment,
} from '../../../lib/content/editorialRuntimeCompression';
import {
  compactEditorialDiagnostics,
  serializeCompactedEditorialDiagnostics,
} from '../../../lib/content/editorialDiagnosticCompaction';
import {
  getEditorialCompatibilityContract,
  resolveEditorialContentTypeKind,
  serializeEditorialCompatibilityContract,
  EDITORIAL_CONTENT_TYPE_KINDS,
  CROSS_CONTENT_TYPE_EDITORIAL_COMPATIBILITY,
} from '../../../lib/content/crossContentTypeEditorialCompatibility';
import {
  evaluateEditorialPromptBudget,
  serializeEditorialPromptBudgetReport,
  DEFAULT_EDITORIAL_PROMPT_BUDGET,
} from '../../../lib/content/editorialPromptBudgetGuard';
import type { EditorialDiagnosticReport, EditorialDiagnosticDimension } from '../../../lib/content/editorialDiagnosticObserver';

function buildFragments(): AdvisorySectionFragment[] {
  const shared = {
    dependencies: ['0. narrative', '1. authority'],
    boundaries: ['preserve section boundary'],
    preservationRequirements: ['preserve progression stage: diagnose'],
    verificationRequirements: ['runtime layer is advisory-only'],
  };
  return [
    { sectionIndex: 1, ...shared, riskSignals: ['risk a', 'risk a'], gapSignals: ['gap a'] },
    { sectionIndex: 0, ...shared, riskSignals: ['risk a'], gapSignals: [] },
    { sectionIndex: 2, ...shared, riskSignals: [], gapSignals: ['gap b'] },
  ];
}

function dimension(overrides: Partial<EditorialDiagnosticDimension> = {}): EditorialDiagnosticDimension {
  return {
    aligned: true,
    risk: 'low',
    confidence: 'medium',
    summary: 'advisory dimension',
    indicators: ['shared indicator'],
    driftIndicators: [],
    ...overrides,
  };
}

function buildDiagnosticReport(): EditorialDiagnosticReport {
  const section = (sectionIndex: number) => ({
    sectionIndex,
    progressionStage: 'diagnose' as const,
    narrativeRole: 'problem_diagnosis' as const,
    sectionRoleAlignment: dimension(),
    narrativeStageAlignment: dimension(),
    readerStateProgression: dimension(),
    repetitionRisk: dimension({ risk: 'high', driftIndicators: ['repeated direct-answer shape'] }),
    frameworkReuseRisk: dimension(),
    genericFramingRisk: dimension(),
    doctrineAlignment: dimension(),
    assimilationAlignment: dimension(),
    proofBehaviorAlignment: dimension(),
    transitionAlignment: dimension(),
    sectionDifferentiationAlignment: dimension(),
    riskFlags: ['repeated direct-answer shape'],
  });
  return {
    version: 'editorial-diagnostic-observer-v1',
    generatedAt: new Date(0).toISOString(),
    contentType: 'blog',
    topic: 'AI content operations',
    riskFlags: ['repeated direct-answer shape'],
    alignmentSummary: {
      overallRisk: 'high',
      observedSections: 2,
      plannedSections: 2,
      highRiskDimensions: 2,
      mediumRiskDimensions: 0,
      confidence: 'high',
    },
    driftIndicators: {
      repeatedSectionIntent: false,
      repeatedDirectAnswerShape: true,
      genericSaasFraming: false,
      weakPovDifferentiation: false,
      collapsedNarrativeProgression: false,
      recycledExamples: false,
      missingReaderStateMovement: false,
      proofPatternAbsence: false,
      doctrineDrift: false,
      assimilationDrift: false,
    },
    sections: [section(1), section(0)],
  };
}

describe('editorialRuntimeCompression', () => {
  it('compresses identical advisory fragments into a shared pool', () => {
    const compression = compressEditorialRuntimeContext(buildFragments());

    expect(compression.version).toBe('editorial-runtime-compression-v1');
    expect(compression.compressionStats.dedupedFragmentArrays).toBeGreaterThan(0);
    expect(compression.compressionStats.pooledFragmentArrays).toBeLessThan(
      compression.compressionStats.rawFragmentArrays,
    );
  });

  it('produces deterministic output and preserves section ordering', () => {
    const first = compressEditorialRuntimeContext(buildFragments());
    const second = compressEditorialRuntimeContext(buildFragments());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.sections.map((section) => section.sectionIndex)).toEqual([0, 1, 2]);
  });

  it('normalizes and dedupes risk and gap signals deterministically', () => {
    const compression = compressEditorialRuntimeContext(buildFragments());

    expect(compression.normalizedRiskSignals).toEqual(['risk a']);
    expect(compression.normalizedGapSignals).toEqual(['gap a', 'gap b']);
  });

  it('expands losslessly for debug compatibility', () => {
    const fragments = buildFragments();
    const expanded = expandEditorialRuntimeContext(compressEditorialRuntimeContext(fragments));

    expect(expanded.map((fragment) => fragment.sectionIndex)).toEqual([0, 1, 2]);
    expect(expanded[0].dependencies).toEqual(['0. narrative', '1. authority']);
  });

  it('serializes compactly', () => {
    const serialized = serializeEditorialRuntimeCompression(compressEditorialRuntimeContext(buildFragments()));

    expect(serialized).toContain('## EDITORIAL RUNTIME COMPRESSION');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('editorialDiagnosticCompaction', () => {
  it('compacts repeated diagnostic arrays into a shared pool', () => {
    const compacted = compactEditorialDiagnostics(buildDiagnosticReport());

    expect(compacted.version).toBe('editorial-diagnostic-compaction-v1');
    expect(compacted.compactionStats.dedupedArrays).toBeGreaterThan(0);
    expect(compacted.compactionStats.pooledArrays).toBeLessThan(compacted.compactionStats.rawArrays);
  });

  it('produces deterministic output and preserves section ordering', () => {
    const first = compactEditorialDiagnostics(buildDiagnosticReport());
    const second = compactEditorialDiagnostics(buildDiagnosticReport());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.sections.map((section) => section.sectionIndex)).toEqual([0, 1]);
  });

  it('normalizes risk signals and does not mutate the source report', () => {
    const report = buildDiagnosticReport();
    const snapshot = JSON.stringify(report);
    const compacted = compactEditorialDiagnostics(report);

    expect(compacted.normalizedRiskSignals).toEqual(['repeated direct-answer shape']);
    expect(JSON.stringify(report)).toBe(snapshot);
  });

  it('serializes compactly', () => {
    const serialized = serializeCompactedEditorialDiagnostics(compactEditorialDiagnostics(buildDiagnosticReport()));

    expect(serialized).toContain('## EDITORIAL DIAGNOSTIC COMPACTION');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('crossContentTypeEditorialCompatibility', () => {
  it('exposes a contract for every editorial content-type kind', () => {
    for (const kind of EDITORIAL_CONTENT_TYPE_KINDS) {
      const contract = CROSS_CONTENT_TYPE_EDITORIAL_COMPATIBILITY[kind];
      expect(contract.contentType).toBe(kind);
      expect(contract.allowedNarrativeStages.length).toBeGreaterThan(0);
      expect(contract.sectionDensity.min).toBeLessThanOrEqual(contract.sectionDensity.typical);
      expect(contract.sectionDensity.typical).toBeLessThanOrEqual(contract.sectionDensity.max);
    }
  });

  it('resolves content-type aliases and falls back to blog', () => {
    expect(resolveEditorialContentTypeKind('Short Story')).toBe('story');
    expect(resolveEditorialContentTypeKind('long-form-educational')).toBe('long_form_educational');
    expect(resolveEditorialContentTypeKind('unknown-type')).toBeUndefined();
    expect(getEditorialCompatibilityContract('unknown-type').contentType).toBe('blog');
  });

  it('is deterministic and stable per content type', () => {
    expect(JSON.stringify(getEditorialCompatibilityContract('guide')))
      .toBe(JSON.stringify(getEditorialCompatibilityContract('guide')));
  });

  it('serializes compactly', () => {
    const serialized = serializeEditorialCompatibilityContract(getEditorialCompatibilityContract('newsletter'));

    expect(serialized).toContain('## CROSS-CONTENT-TYPE EDITORIAL COMPATIBILITY');
    expect(serialized).toContain('Content type: newsletter');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('editorialPromptBudgetGuard', () => {
  const segments = [
    { name: 'doctrine', content: 'doctrine context line one\ndoctrine context line two that is long enough' },
    { name: 'assimilation', content: 'doctrine context line one\ndoctrine context line two that is long enough' },
    { name: 'guidance', content: 'unique guidance content for the section budget evaluation pass' },
  ];

  it('measures size, detects duplicated payload and repeated fragments', () => {
    const report = evaluateEditorialPromptBudget(segments);

    expect(report.version).toBe('editorial-prompt-budget-guard-v1');
    expect(report.totalChars).toBeGreaterThan(0);
    expect(report.duplicatedSegments).toHaveLength(1);
    expect(report.duplicatedSegments[0].duplicateOf).toBe('assimilation');
    expect(report.repeatedFragments.length).toBeGreaterThan(0);
    expect(report.budgetStatus).toBe('budget_advisory');
  });

  it('flags oversized segments and budget overflow as advisory warnings only', () => {
    const report = evaluateEditorialPromptBudget(
      [{ name: 'bulk', content: 'x'.repeat(50) }],
      { ...DEFAULT_EDITORIAL_PROMPT_BUDGET, totalBudgetChars: 10, oversizedSegmentChars: 10 },
    );

    expect(report.budgetStatus).toBe('budget_warning');
    expect(report.oversizedSegments).toHaveLength(1);
    expect(report.warnings.some((warning) => warning.includes('budget exceeded'))).toBe(true);
  });

  it('reports within_budget for clean non-redundant context', () => {
    const report = evaluateEditorialPromptBudget([
      { name: 'a', content: 'first distinct segment' },
      { name: 'b', content: 'second distinct segment' },
    ]);

    expect(report.budgetStatus).toBe('within_budget');
    expect(report.warnings).toHaveLength(0);
  });

  it('produces deterministic output', () => {
    const first = evaluateEditorialPromptBudget(segments);
    const second = evaluateEditorialPromptBudget(segments);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('serializes compactly', () => {
    const serialized = serializeEditorialPromptBudgetReport(evaluateEditorialPromptBudget(segments));

    expect(serialized).toContain('## EDITORIAL PROMPT BUDGET GUARD');
    expect(serialized.length).toBeLessThan(2200);
  });
});

describe('editorial runtime hardening — cross-module serialization stability', () => {
  it('keeps fixed-epoch timestamps with no nondeterministic drift', () => {
    const epoch = new Date(0).toISOString();
    expect(compressEditorialRuntimeContext(buildFragments()).generatedAt).toBe(epoch);
    expect(compactEditorialDiagnostics(buildDiagnosticReport()).generatedAt).toBe(epoch);
    expect(evaluateEditorialPromptBudget([]).generatedAt).toBe(epoch);
  });

  it('keeps section, risk, and normalization ordering identical across runs', () => {
    const compressionA = compressEditorialRuntimeContext(buildFragments());
    const compressionB = compressEditorialRuntimeContext(buildFragments());
    expect(compressionA.sections).toEqual(compressionB.sections);
    expect(compressionA.fragmentPool).toEqual(compressionB.fragmentPool);
    expect(compressionA.normalizedRiskSignals).toEqual(compressionB.normalizedRiskSignals);

    const compactionA = compactEditorialDiagnostics(buildDiagnosticReport());
    const compactionB = compactEditorialDiagnostics(buildDiagnosticReport());
    expect(compactionA.arrayPool).toEqual(compactionB.arrayPool);
    expect(compactionA.sections).toEqual(compactionB.sections);
  });
});
