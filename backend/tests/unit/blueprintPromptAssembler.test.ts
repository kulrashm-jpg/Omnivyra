import { assembleBlueprintPrompt, enrichVisualPrompt } from '../../../backend/services/creator/intelligence/blueprintPromptAssembler';
import { resolveCreatorContext } from '../../../backend/services/creator/intelligence/creatorIntelligenceEngine';
import { VISUAL_BLUEPRINTS } from '../../../lib/creator-outcomes/creatorVisualBlueprintRegistry';

describe('CREATOR-060 — BlueprintPromptAssembler', () => {
  it('STEP 2/5 — every blueprint assembles a non-empty, priority-ordered directive', () => {
    for (const b of VISUAL_BLUEPRINTS) {
      const p = assembleBlueprintPrompt(b.id);
      expect(p).not.toBeNull();
      expect(p!.blueprintId).toBe(b.id);
      expect(p!.directives.length).toBeGreaterThan(10);
      expect(p!.directives.toLowerCase()).toContain('colour palette');   // colour language present
    }
    expect(assembleBlueprintPrompt(null)).toBeNull();
    expect(assembleBlueprintPrompt('nope')).toBeNull();
  });

  it('STEP 5 — blueprints inject their own deterministic visual vocabulary', () => {
    const corp = assembleBlueprintPrompt('corporate')!.directives.toLowerCase();
    const graf = assembleBlueprintPrompt('graffiti')!.directives.toLowerCase();
    expect(corp).not.toEqual(graf);
    expect(graf).toMatch(/street|spray|mural|urban|graffiti/);
    expect(assembleBlueprintPrompt('watercolor')!.directives.toLowerCase()).toMatch(/water|paint|wash|pigment/);
    expect(assembleBlueprintPrompt('dashboard')!.directives.toLowerCase()).toMatch(/chart|dashboard|kpi|widget|analytic/);
    // Deterministic.
    expect(assembleBlueprintPrompt('corporate')).toEqual(assembleBlueprintPrompt('corporate'));
  });

  it('STEP 3/4 — enrich appends blueprint AFTER business intent; no blueprint ⇒ byte-identical', () => {
    const base = 'Promote our Q3 launch to enterprise buyers';
    const enriched = enrichVisualPrompt(base, 'corporate');
    expect(enriched.startsWith(base)).toBe(true);        // business intent first
    expect(enriched.length).toBeGreaterThan(base.length);
    expect(enrichVisualPrompt(base, null)).toBe(base);   // no blueprint ⇒ unchanged
    expect(enrichVisualPrompt(base, 'nope')).toBe(base);
  });

  it('STEP 6 — resolveCreatorContext is byte-identical without a blueprint, enriched with one', () => {
    const input = { topic: 'AI onboarding', contentType: 'image', platforms: ['linkedin'], objective: 'educate' };
    const legacy = resolveCreatorContext(input);
    const legacy2 = resolveCreatorContext(input);
    expect(legacy).toEqual(legacy2);                                          // deterministic
    const withBp = resolveCreatorContext({ ...input, blueprintId: 'corporate' });
    // Only visual_direction.image_prompt + scene_direction change; everything else identical.
    expect(withBp.visual_direction.image_prompt).not.toBe(legacy.visual_direction.image_prompt);
    expect(withBp.visual_direction.image_prompt.startsWith(legacy.visual_direction.image_prompt)).toBe(true);
    expect(withBp.visual_direction.scene_direction.startsWith(legacy.visual_direction.scene_direction)).toBe(true);
    expect(withBp.visual_direction.video_prompt).toBe(legacy.visual_direction.video_prompt);
    expect(withBp.packaging).toEqual(legacy.packaging);
    expect({ ...withBp, visual_direction: null }).toEqual({ ...legacy, visual_direction: null });
  });
});
