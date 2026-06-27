import { composeCreatorImagePrompt } from '../../services/creator/creatorPromptComposer';
import { validateProviderImageTextSafety } from '../../services/creatorImageTextValidation';

// Regression for the live failure:
//   governed_render_failed_closed:render_manifest_rejected:supporting_visual_cta_prompt_leak
// A text-free supporting_visual prompt must not contain the literal token "CTA"
// (the fail-closed render gate rejects any \bcta\b / \bbutton\b / "call to action").

const leakFlags = (prompt: string): string[] =>
  validateProviderImageTextSafety({ mode: 'supporting_visual', providerReturnedImage: true, prompt, overlayText: null }).flags;

const baseInput = (over: Record<string, unknown>) => ({
  attachmentMode: 'supporting_visual',
  platform: 'linkedin',
  campaignName: 'Launch',
  assetType: 'image',
  ...over,
}) as any;

describe('supporting_visual prompt never leaks CTA tokens (governed_render_failed_closed regression)', () => {
  // Real composite purpose keys that resolve CTA-heavy strategies (whyChosen +
  // promptDirectives in purposeStrategyRegistry carry the literal token "CTA").
  const cases: Array<{ contentType: string; purposeKey: string | null }> = [
    { contentType: 'image', purposeKey: null },
    { contentType: 'image', purposeKey: 'promotional-image' },
    { contentType: 'image', purposeKey: 'educational-image' },
    { contentType: 'image', purposeKey: 'product-showcase-image' },
    { contentType: 'image', purposeKey: 'brand-focus-image' },
    { contentType: 'banner', purposeKey: 'promotional-image' },
  ];

  it('composed supporting_visual prompts pass the cta-leak gate across content types + strategies', () => {
    for (const { contentType, purposeKey } of cases) {
      const composed = composeCreatorImagePrompt(baseInput({ contentType, eyebrow: contentType, purposeKey }));
      const flags = leakFlags(composed.prompt);
      expect({ contentType, purposeKey, flags }).toEqual({ contentType, purposeKey, flags: expect.not.arrayContaining(['supporting_visual_cta_prompt_leak']) });
      // The text-ban contract must remain intact.
      expect(composed.prompt.toLowerCase()).toContain('strictly avoid all visible text');
      // No raw trigger token anywhere in the composed supporting_visual prompt.
      expect(/\b(cta|call to action)\b/i.test(composed.prompt)).toBe(false);
    }
  });

  it('embedded_copy is unchanged — still carries "CTA intensity" strategy language', () => {
    const composed = composeCreatorImagePrompt(baseInput({ attachmentMode: 'embedded_copy', contentType: 'image', eyebrow: 'image', purposeKey: 'promotional-image' }));
    // embedded_copy keeps "CTA intensity:" (the cta-leak gate never applies to it).
    expect(composed.prompt).toMatch(/CTA intensity:/);
  });

  it('the governance gate stays strict for a genuine CTA render instruction', () => {
    expect(leakFlags('Strictly avoid all visible text. Render a prominent CTA button that says BUY NOW.'))
      .toContain('supporting_visual_cta_prompt_leak');
  });
});
