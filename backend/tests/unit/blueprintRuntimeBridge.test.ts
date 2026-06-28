import {
  resolveBlueprintRuntime, blueprintCreatorCardFields, mergeBlueprintIntoCreatorCard,
} from '../../../lib/creator-outcomes/blueprintRuntimeBridge';
import { VISUAL_BLUEPRINTS } from '../../../lib/creator-outcomes/creatorVisualBlueprintRegistry';

describe('CREATOR-059 follow-up — Blueprint → runtime bridge', () => {
  it('resolves complete runtime guidance for every blueprint, deterministically', () => {
    for (const b of VISUAL_BLUEPRINTS) {
      const r = resolveBlueprintRuntime(b.id);
      expect(r).not.toBeNull();
      expect(r!.blueprintId).toBe(b.id);
      expect(r!.stylePrompt.length).toBeGreaterThan(0);
      expect(r!.imagePrompt.length).toBeGreaterThan(0);
      expect(/^#/.test(r!.colorLanguage.primary)).toBe(true);
      expect(/^#/.test(r!.colorLanguage.surface)).toBe(true);
      expect(['high', 'soft']).toContain(r!.colorLanguage.contrast);
      expect(r!.layoutGuidance).toContain('composition');
      expect(r!.typographyGuidance).toContain('case');
    }
    // Deterministic.
    expect(resolveBlueprintRuntime('corporate')).toEqual(resolveBlueprintRuntime('corporate'));
    expect(resolveBlueprintRuntime('does-not-exist')).toBeNull();
    expect(resolveBlueprintRuntime(null)).toBeNull();
  });

  it('produces additive, prefixed creator_card fields (no-op when absent)', () => {
    const f = blueprintCreatorCardFields('corporate');
    expect(f.blueprint_id).toBe('corporate');
    expect(Object.keys(f).every((k) => k.startsWith('blueprint_'))).toBe(true);
    expect(blueprintCreatorCardFields(null)).toEqual({});
    expect(blueprintCreatorCardFields('nope')).toEqual({});
  });

  it('merge is additive and never overwrites existing creator_card keys', () => {
    // blueprint id read from the card itself.
    const merged = mergeBlueprintIntoCreatorCard({ blueprint_id: 'corporate', tone: 'bold' });
    expect(merged.tone).toBe('bold');
    expect(merged.blueprint_style_prompt).toBeTruthy();
    expect(merged.blueprint_id).toBe('corporate');
    // Explicit id arg also works.
    expect(mergeBlueprintIntoCreatorCard({}, 'corporate').blueprint_visual_category).toBeTruthy();
    // Existing keys win over derived ones.
    const clash = mergeBlueprintIntoCreatorCard({ blueprint_id: 'corporate', blueprint_style_prompt: 'MINE' });
    expect(clash.blueprint_style_prompt).toBe('MINE');
    // No blueprint ⇒ exact same reference (true no-op).
    const card = { tone: 'x' };
    expect(mergeBlueprintIntoCreatorCard(card)).toBe(card);
  });
});
