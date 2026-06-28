import { buildCreatorBlueprintPromptSpecification, type CreatorBlueprintPromptInput } from '../../../backend/services/creator/creatorPromptSpecification';
import { assembleBlueprintPrompt } from '../../../backend/services/creator/intelligence/blueprintPromptAssembler';

function baseInput(overrides: Partial<CreatorBlueprintPromptInput> = {}): CreatorBlueprintPromptInput {
  return {
    assetType: 'image',
    blueprintType: 'image',
    creatorContext: {
      content_theme: 'engaging',
      campaign_description: 'Creator campaign execution',
      brand_visual_tone: 'professional',
      visual_style: 'modern professional',
      target_platforms: ['linkedin'],
      supporting_asset_type: 'image',
      slide_count: 5,
      narrative_arc: 'problem -> insight -> action',
    } as unknown as CreatorBlueprintPromptInput['creatorContext'],
    promptInput: { topic: 'AI onboarding', asset_type: 'image' },
    templateAlignmentInstruction: 'Align to template X.',
    ...overrides,
  };
}

describe('CREATOR-061 — Single-asset blueprint thread reaches the final prompt builder', () => {
  it('STEP 6 — byte-identical user prompt when no blueprint (null === omitted === absent)', () => {
    const omitted = buildCreatorBlueprintPromptSpecification(baseInput());
    const explicitNull = buildCreatorBlueprintPromptSpecification(baseInput({ blueprintDirectives: null }));
    const emptyStr = buildCreatorBlueprintPromptSpecification(baseInput({ blueprintDirectives: '' }));
    expect(explicitNull.user).toBe(omitted.user);
    expect(emptyStr.user).toBe(omitted.user);
    expect(omitted.user).not.toContain('Visual blueprint direction');
  });

  it('STEP 5 — blueprint directives reach the user prompt additively (goal stays above)', () => {
    const directives = assembleBlueprintPrompt('corporate')!.directives;
    const withBp = buildCreatorBlueprintPromptSpecification(baseInput({ blueprintDirectives: directives }));
    const without = buildCreatorBlueprintPromptSpecification(baseInput());
    expect(withBp.user).toContain('Visual blueprint direction');
    expect(withBp.user).toContain(directives);
    expect(withBp.user.length).toBeGreaterThan(without.user.length);
    // Additive only: removing the injected section reproduces the legacy prompt exactly.
    const injected = `\nVisual blueprint direction (enrich visual intent; never override the business goal/brand/audience above):\n${directives}\n`;
    expect(withBp.user.replace(injected, '')).toBe(without.user);
    // System prompt + operation unchanged by the blueprint.
    expect(withBp.system).toBe(without.system);
    expect(withBp.operation).toBe(without.operation);
  });

  it('one canonical source — same blueprint id yields identical directives at every call', () => {
    expect(assembleBlueprintPrompt('graffiti')!.directives).toBe(assembleBlueprintPrompt('graffiti')!.directives);
  });
});
