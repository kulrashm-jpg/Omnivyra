import {
  evaluateHealth, runIntegrityChecks, buildDependencyGraph, worst,
  type ObservabilitySnapshot, type IntegrityInput,
} from '../../../lib/creator-templates/creatorObservability';

const baseSnap = (): ObservabilitySnapshot => ({
  templateLibrary: { systemCount: 12 },
  userTemplates: { total: 3, failedPreviews: 0, pendingPreviews: 0, missingDiagnostics: 0 },
  collections: { total: 2, invalid: 0, orphan: 0 },
  campaignDesignSystems: { total: 1, unhealthy: 0, pinMismatches: 0 },
  previewQueue: { pending: 0, rendering: 0, failed: 0 },
  renderQueue: { configured: true, active: 0, failed: 0, deadLetter: 0 },
  aiAssist: { configured: true, recentCalls: 5, recentFailures: 0 },
  publishing: { recentPublishes: 4, recentFailures: 0 },
  analytics: { assetsWithData: 10, attributedAssets: 10 },
  performance: { measuredAssets: 10 },
  evolution: { recommendationsAvailable: 2 },
});

describe('Creator Template Observability — health', () => {
  it('all-green snapshot is PASS across all 11 sections', () => {
    const { overall, sections } = evaluateHealth(baseSnap());
    expect(overall).toBe('PASS');
    expect(sections).toHaveLength(11);
    expect(sections.every((s) => s.status === 'PASS')).toBe(true);
  });

  it('escalates to FAILED on dead-letter and invalid collections', () => {
    const s = baseSnap();
    s.renderQueue.deadLetter = 2;
    s.collections.invalid = 1;
    const { overall, sections } = evaluateHealth(s);
    expect(overall).toBe('FAILED');
    expect(sections.find((x) => x.section === 'Render Queue')!.status).toBe('FAILED');
    expect(sections.find((x) => x.section === 'Collections')!.status).toBe('FAILED');
  });

  it('warns on missing diagnostics, unconfigured queue, and no performance', () => {
    const s = baseSnap();
    s.userTemplates.missingDiagnostics = 2;
    s.renderQueue.configured = false;
    s.performance.measuredAssets = 0;
    const { overall, sections } = evaluateHealth(s);
    expect(overall).toBe('WARNING');
    expect(sections.find((x) => x.section === 'User Templates')!.status).toBe('WARNING');
    expect(sections.find((x) => x.section === 'Performance Intelligence')!.status).toBe('WARNING');
  });

  it('worst() picks the highest severity', () => {
    expect(worst(['PASS', 'WARNING', 'PASS'])).toBe('WARNING');
    expect(worst(['WARNING', 'FAILED'])).toBe('FAILED');
    expect(worst(['PASS', 'PASS'])).toBe('PASS');
  });
});

describe('Creator Template Observability — integrity', () => {
  const input: IntegrityInput = {
    collections: [
      { id: 'c1', version: 2, templateIds: ['t1', 'ghost'], coverTemplateId: 'phantom' },
      { id: 'c2', version: 1, templateIds: [], coverTemplateId: null },
    ],
    campaignDesignSystems: [
      { campaignId: 'camp1', collectionId: 'c1', pinnedVersion: 1 },     // version mismatch (c1 is v2)
      { campaignId: 'camp2', collectionId: 'gone', pinnedVersion: 1 },   // pin mismatch (missing)
    ],
    userTemplates: [
      { id: 't1', previewStatus: 'ready', hasThumbnail: false, hasDiagnostic: false },
    ],
    templateExists: (id) => id === 't1',
    collectionVersion: (id) => (id === 'c1' ? 2 : id === 'c2' ? 1 : null),
    measuredTemplateIds: new Set(['t1']),
  };

  it('detects every integrity class deterministically', () => {
    const f = runIntegrityChecks(input);
    const types = f.map((x) => x.type);
    expect(types).toContain('missing_template');
    expect(types).toContain('invalid_reference');
    expect(types).toContain('orphan_collection');
    expect(types).toContain('version_mismatch');
    expect(types).toContain('campaign_pin_mismatch');
    expect(types).toContain('preview_mismatch');
    expect(types).toContain('missing_diagnostics');
    expect(f[0]!.severity).toBe('error'); // errors sort first
    expect(JSON.stringify(runIntegrityChecks(input))).toBe(JSON.stringify(f));
  });
});

describe('Creator Template Observability — dependency graph', () => {
  it('builds the canonical chain and links members → collection → campaign', () => {
    const g = buildDependencyGraph({
      collections: [{ id: 'c1', name: 'Launch', templateIds: ['t1', 't2'] }],
      campaignDesignSystems: [{ campaignId: 'camp1', collectionId: 'c1' }],
    });
    expect(g.nodes.find((n) => n.id === 'template:t1')).toBeTruthy();
    expect(g.edges).toContainEqual({ from: 'template:t1', to: 'collection:c1' });
    expect(g.edges).toContainEqual({ from: 'collection:c1', to: 'cds:camp1' });
    expect(g.edges).toContainEqual({ from: 'stage:analytics', to: 'stage:performance' });
    expect(g.nodes[0]!.type).toBe('template');
  });
});
