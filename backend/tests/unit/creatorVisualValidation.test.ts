import {
  validateCreatorVisual,
  deriveVisualRepairHint,
  applyVisualRepair,
} from '../../services/creator/creatorVisualValidation';

describe('Visual validation — pass/fail rules (deterministic, no AI)', () => {
  it('passes when there are no quality signals (placeholder/fallback safe)', () => {
    expect(validateCreatorVisual({ placeholder: true }).passed).toBe(true);
    expect(validateCreatorVisual({}).passed).toBe(true);
  });

  it('passes a clean overlay report', () => {
    const v = validateCreatorVisual({ overlay_quality: { flags: [], score: 88 } });
    expect(v.passed).toBe(true);
    expect(v.repairHint).toBeNull();
  });

  it('fails on layout overflow (text fit + overlap + safe margins) and is repairable', () => {
    const v = validateCreatorVisual({ overlay_quality: { flags: ['severe_layout_overflow_risk'], score: 70 } });
    expect(v.passed).toBe(false);
    const cats = v.failures.map((f) => f.category);
    expect(cats).toEqual(expect.arrayContaining(['text_fit', 'overlap', 'safe_margins']));
    expect(v.repairHint).toBe('shorten_text');
  });

  it('fails on unreadable typography', () => {
    const v = validateCreatorVisual({ overlay_quality: { flags: ['headline_likely_unreadable_mobile'], score: 70 } });
    expect(v.failures.map((f) => f.category)).toContain('typography');
    expect(v.repairHint).toBe('shorten_text');
  });

  it('fails on insufficient contrast (and is NOT text-repairable)', () => {
    const v = validateCreatorVisual({ contrastRatio: 2.4, overlay_quality: { flags: [], score: 90 } });
    expect(v.passed).toBe(false);
    expect(v.failures.map((f) => f.category)).toContain('contrast');
    expect(v.repairHint).toBeNull(); // contrast can't be fixed by shortening text
  });

  it('fails on a low quality score', () => {
    const v = validateCreatorVisual({ overlay_quality: { flags: [], score: 12 } });
    expect(v.failures.map((f) => f.category)).toContain('low_quality');
  });

  it('fails on infographic density flags', () => {
    const v = validateCreatorVisual({ overlay_quality: { flags: ['too_many_sections', 'text_density_exceeds_infographic_bounds'], score: 60 } });
    expect(v.passed).toBe(false);
    expect(v.failures.every((f) => f.category === 'text_fit')).toBe(true);
  });
});

describe('Visual validation — carousel validates every slide independently', () => {
  it('one failing slide fails the whole carousel and reports the slide number', () => {
    const v = validateCreatorVisual({
      overlay_quality_reports: [
        { flags: [], score: 85 },
        { flags: ['severe_layout_overflow_risk'], score: 55 },
        { flags: [], score: 80 },
      ],
    });
    expect(v.passed).toBe(false);
    expect(v.slideCount).toBe(3);
    expect(v.failures.some((f) => f.slide === 2)).toBe(true);
    expect(v.failures.every((f) => f.slide === 2)).toBe(true);
  });

  it('passes when every slide is clean', () => {
    const v = validateCreatorVisual({ overlay_quality_reports: [{ flags: [], score: 80 }, { flags: [], score: 82 }] });
    expect(v.passed).toBe(true);
    expect(v.slideCount).toBe(2);
  });
});

describe('Visual validation — repair hint derivation', () => {
  it('text/fit/typography → shorten_text; contrast/dimensions → null', () => {
    expect(deriveVisualRepairHint([{ category: 'text_fit', flag: 'x' }])).toBe('shorten_text');
    expect(deriveVisualRepairHint([{ category: 'typography', flag: 'x' }])).toBe('shorten_text');
    expect(deriveVisualRepairHint([{ category: 'contrast', flag: 'x' }])).toBeNull();
    expect(deriveVisualRepairHint([{ category: 'dimensions', flag: 'x' }])).toBeNull();
  });
});

describe('Visual validation — deterministic layout repair', () => {
  it('shortens overlay copy, slides, and metadata transform items', () => {
    const payload = {
      overlay_text: { headline: 'H'.repeat(100), cta: 'C'.repeat(50) },
      slides: [{ title: 'T'.repeat(90), body: 'B'.repeat(300) }],
      media_bundle: { metadata: { overlay_text: { headline: 'M'.repeat(120) }, thread_visual_transform: { items: ['I'.repeat(200)] } } },
    };
    const repaired = applyVisualRepair(payload, 'shorten_text');
    expect((repaired.overlay_text as any).headline.length).toBeLessThanOrEqual(60);
    expect((repaired.overlay_text as any).cta.length).toBeLessThanOrEqual(24);
    expect((repaired.slides as any)[0].title.length).toBeLessThanOrEqual(48);
    expect((repaired.slides as any)[0].body.length).toBeLessThanOrEqual(140);
    const meta = (repaired.media_bundle as any).metadata;
    expect(meta.overlay_text.headline.length).toBeLessThanOrEqual(60);
    expect(meta.thread_visual_transform.items[0].length).toBeLessThanOrEqual(110);
    expect(meta.visual_repair_applied).toBe(true);
    // original is untouched (pure)
    expect((payload.overlay_text as any).headline.length).toBe(100);
  });

  it('is a no-op for non-shorten hints', () => {
    const payload = { overlay_text: { headline: 'short' } };
    expect(applyVisualRepair(payload, null)).toBe(payload);
  });
});
