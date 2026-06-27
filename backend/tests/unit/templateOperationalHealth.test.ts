import { computeTemplateHealth, resolveVersionStatus, computeSystemHealth, type TemplateHealthEvent } from '../../../lib/creator-templates';

const ev = (action: string, at: string, templateVersion = 1): TemplateHealthEvent => ({ action, templateId: 't1', templateVersion, at });

describe('CAMPAIGN-007 operational health (deterministic)', () => {
  it('aggregates operational counters + rates + last-* timestamps', () => {
    const events = [
      ev('selected', '2026-06-01T00:00:00Z'),
      ev('selected', '2026-06-03T00:00:00Z'),
      ev('generation_started', '2026-06-03T00:01:00Z'),
      ev('generation_succeeded', '2026-06-03T00:02:00Z'),
      ev('render_succeeded', '2026-06-03T00:02:30Z'),
      ev('generation_started', '2026-06-04T00:00:00Z'),
      ev('generation_failed', '2026-06-04T00:01:00Z'),
      ev('render_failed', '2026-06-04T00:01:30Z'),
      ev('validation_failed', '2026-06-04T00:02:00Z'),
      ev('published', '2026-06-02T00:00:00Z'),
    ];
    const h = computeTemplateHealth('t1', events, { ownership: 'user', latestVersion: 1, activeVersion: 1, status: 'published' });
    expect(h.timesSelected).toBe(2);
    expect(h.timesGenerated).toBe(2);                 // generation_started count
    expect(h.generationSuccessRate).toBe(0.5);        // 1 of 2
    expect(h.renderSuccessRate).toBe(0.5);            // 1 ok / (1 ok + 1 fail)
    expect(h.generationFailureCount).toBe(1);
    expect(h.renderFailureCount).toBe(1);
    expect(h.validationFailureCount).toBe(1);
    expect(h.publishCount).toBe(1);
    expect(h.lastUsed).toBe('2026-06-03T00:00:00Z');
    expect(h.lastGenerated).toBe('2026-06-04T00:00:00Z');
    expect(h.lastPublished).toBe('2026-06-02T00:00:00Z');
    expect(h.versionStatus).toBe('ACTIVE');           // published + active==latest
  });

  it('defaults rates to 1 when there are no attempts', () => {
    const h = computeTemplateHealth('t1', [], { ownership: 'system', latestVersion: 1, activeVersion: 1, status: 'published' });
    expect(h.generationSuccessRate).toBe(1);
    expect(h.renderSuccessRate).toBe(1);
    expect(h.timesGenerated).toBe(0);
  });

  it('resolves deterministic version status', () => {
    expect(resolveVersionStatus({ version: 1, latestVersion: 1, status: 'published' })).toBe('ACTIVE');
    expect(resolveVersionStatus({ version: 3, latestVersion: 3, status: 'draft' })).toBe('CURRENT');
    expect(resolveVersionStatus({ version: 2, latestVersion: 5, status: 'published' })).toBe('SUPERSEDED');
    expect(resolveVersionStatus({ version: 1, latestVersion: 1, status: 'archived' })).toBe('ARCHIVED');
    expect(resolveVersionStatus({ version: 1, latestVersion: 1, status: 'deprecated' })).toBe('DEPRECATED');
    expect(resolveVersionStatus({ version: null, latestVersion: null })).toBe('UNKNOWN');
  });

  it('computes fleet system-health flags', () => {
    const mk = (id: string, over: Partial<ReturnType<typeof computeTemplateHealth>>) =>
      ({ templateId: id, ownership: 'user', activeVersion: 1, latestVersion: 1, timesSelected: 0, timesGenerated: 0, generationSuccessRate: 1, renderSuccessRate: 1, validationFailureCount: 0, generationFailureCount: 0, renderFailureCount: 0, publishCount: 0, lastUsed: null, lastGenerated: null, lastPublished: null, versionStatus: 'CURRENT', ...over } as any);
    const sys = computeSystemHealth([
      mk('unused', {}),                                                    // no usage, never published → safe to archive
      mk('failing', { timesGenerated: 5, generationFailureCount: 2, renderFailureCount: 2, publishCount: 1 }), // repeated failures
      mk('badcopy', { timesSelected: 1, validationFailureCount: 3, publishCount: 1 }),
      mk('old', { timesSelected: 4, versionStatus: 'DEPRECATED', publishCount: 2 }),
    ]);
    expect(sys.noUsage).toContain('unused');
    expect(sys.safeToArchive).toContain('unused');
    expect(sys.repeatedFailures).toContain('failing');
    expect(sys.failingValidation).toContain('badcopy');
    expect(sys.deprecatedVersions).toContain('old');
    expect(sys.neverPublished).toContain('unused');
    expect(sys.neverPublished).not.toContain('failing'); // published once
  });
});
