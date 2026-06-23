/**
 * PHASE CAMPAIGN-HEALTH-BOLT-ALIGNMENT — execution-health authority.
 * Proves the BOLT execution states the Activity-board engine ignores
 * (render_failed, publish failed, awaiting upload, schedule drift) now drive a
 * truthful green/orange/red, and that the worst-of combiner overlays it on the
 * Activity-board color. Pure — no DB / scheduler / publisher imported.
 */
import {
  computeExecutionHealth,
  combineHealthColor,
  classifyContentStatusHealth,
  classifyScheduledPostHealth,
} from '../../../lib/shared/executionHealth';

describe('classifyContentStatusHealth / classifyScheduledPostHealth', () => {
  it('maps each execution state to the right level', () => {
    expect(classifyContentStatusHealth('render_failed')).toBe('critical');
    expect(classifyContentStatusHealth('upload_failed')).toBe('critical');
    expect(classifyContentStatusHealth('awaiting_media_upload')).toBe('warning');
    expect(classifyContentStatusHealth('ready_for_schedule')).toBe('warning');
    expect(classifyContentStatusHealth('render_ready')).toBe('warning');
    expect(classifyContentStatusHealth('scheduled')).toBe('healthy');
    expect(classifyContentStatusHealth('published')).toBe('healthy');
    expect(classifyContentStatusHealth('')).toBe('healthy'); // text row, no creator lifecycle
    expect(classifyContentStatusHealth('generated')).toBe('healthy'); // unknown → not a concern
    expect(classifyScheduledPostHealth('failed')).toBe('critical');
    expect(classifyScheduledPostHealth('published')).toBe('healthy');
    expect(classifyScheduledPostHealth('cancelled')).toBe('healthy');
  });
});

describe('computeExecutionHealth — scenario coverage', () => {
  it('healthy campaign: all scheduled/published → green', () => {
    const h = computeExecutionHealth({
      dailyPlanStatuses: ['scheduled', 'scheduled', 'published', ''],
      scheduledPostStatuses: ['scheduled', 'published'],
    });
    expect(h.color).toBe('green');
    expect(h.level).toBe('healthy');
    expect(h.criticalCount).toBe(0);
    expect(h.warningCount).toBe(0);
    expect(h.reasons).toEqual([]);
  });

  it('pending upload: awaiting_media_upload → orange (no longer false-green)', () => {
    const h = computeExecutionHealth({
      dailyPlanStatuses: ['scheduled', 'awaiting_media_upload', 'awaiting_media_upload'],
    });
    expect(h.color).toBe('orange');
    expect(h.level).toBe('warning');
    expect(h.counts.awaitingUpload).toBe(2);
    expect(h.reasons).toContain('2 awaiting upload');
  });

  it('render failed → red', () => {
    const h = computeExecutionHealth({
      dailyPlanStatuses: ['scheduled', 'render_failed'],
    });
    expect(h.color).toBe('red');
    expect(h.level).toBe('critical');
    expect(h.counts.renderFailed).toBe(1);
    expect(h.reasons).toContain('1 render failed');
  });

  it('publish failed → red', () => {
    const h = computeExecutionHealth({
      dailyPlanStatuses: ['scheduled'],
      scheduledPostStatuses: ['published', 'failed'],
    });
    expect(h.color).toBe('red');
    expect(h.counts.publishFailed).toBe(1);
    expect(h.reasons).toContain('1 publish failed');
  });

  it('schedule drift contributes a warning (orange)', () => {
    const h = computeExecutionHealth({
      dailyPlanStatuses: ['scheduled'],
      scheduleDrift: { orphanCount: 1, danglingCount: 1 },
    });
    expect(h.color).toBe('orange');
    expect(h.counts.scheduleDriftOrphan).toBe(1);
    expect(h.counts.scheduleDriftDangling).toBe(1);
    expect(h.reasons).toContain('2 schedule drift');
  });

  it('mixed campaign: critical wins over warnings (red, but both surfaced)', () => {
    const h = computeExecutionHealth({
      dailyPlanStatuses: ['scheduled', 'awaiting_media_upload', 'render_failed', 'ready_for_schedule'],
      scheduledPostStatuses: ['failed', 'published'],
      scheduleDrift: { orphanCount: 1 },
    });
    expect(h.color).toBe('red');
    expect(h.level).toBe('critical');
    expect(h.criticalCount).toBe(2); // render_failed + publish failed
    expect(h.reasons).toEqual(
      expect.arrayContaining(['1 render failed', '1 publish failed', '1 awaiting upload', '1 schedule drift']),
    );
  });

  it('all-clear recovery: once everything is scheduled/published → back to green', () => {
    const before = computeExecutionHealth({ dailyPlanStatuses: ['awaiting_media_upload', 'render_failed'] });
    expect(before.color).toBe('red');
    const after = computeExecutionHealth({
      dailyPlanStatuses: ['scheduled', 'scheduled'],
      scheduledPostStatuses: ['published', 'published'],
    });
    expect(after.color).toBe('green');
    expect(after.level).toBe('healthy');
  });

  it('empty campaign → green/healthy', () => {
    expect(computeExecutionHealth({}).color).toBe('green');
  });
});

describe('combineHealthColor — worst-of overlay (closes the false-green)', () => {
  it('green Activity-board + red execution → red (the whole point)', () => {
    expect(combineHealthColor('green', 'red')).toBe('red');
  });
  it('green + orange → orange', () => {
    expect(combineHealthColor('green', 'orange')).toBe('orange');
  });
  it('red Activity-board + green execution → red (Activity-board concerns preserved)', () => {
    expect(combineHealthColor('red', 'green')).toBe('red');
  });
  it('green + green → green', () => {
    expect(combineHealthColor('green', 'green')).toBe('green');
  });
});
