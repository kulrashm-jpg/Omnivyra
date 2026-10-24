/**
 * The user's MAIN MESSAGE reaches the image scene prompt.
 *
 * The renderer passed `objective: metadata.objective || metadata.summary`, so
 * the main message (body.summary, the "Key message" answer) was dropped
 * whenever an objective existed. It now travels in its own `keyMessage` field,
 * alongside the objective and a CTA intent.
 */
import * as fs from 'fs';
import * as path from 'path';
import { composeCreatorImagePrompt } from '../../services/creator/creatorPromptComposer';
import { validateProviderImageTextSafety } from '../../services/creatorImageTextValidation';

const base = (over: Record<string, unknown>) => ({
  title: 'Launch',
  body: 'Body',
  eyebrow: 'image',
  platform: 'linkedin',
  contentType: 'image',
  ...over,
}) as any;

describe('key message in the scene prompt', () => {
  it('CRITICAL: key message is present even when an objective is set', () => {
    const { prompt } = composeCreatorImagePrompt(base({
      attachmentMode: 'embedded_copy',
      objective: 'Drive trial signups',
      keyMessage: 'Teams publish a week of content in one afternoon',
    }));
    expect(prompt).toContain('Campaign objective: Drive trial signups.');
    expect(prompt).toContain('Main message the scene must convey');
    expect(prompt).toContain('Teams publish a week of content in one afternoon');
  });

  it('objective equal to the key message (upstream fallback) is not stated twice', () => {
    const { prompt } = composeCreatorImagePrompt(base({
      attachmentMode: 'embedded_copy',
      objective: 'Same words',
      keyMessage: 'Same words',
    }));
    expect(prompt).not.toContain('Campaign objective: Same words.');
    expect(prompt.match(/Same words/g)).toHaveLength(1);
  });

  it('CTA intent shapes an embedded-copy scene', () => {
    const { prompt } = composeCreatorImagePrompt(base({ attachmentMode: 'embedded_copy', ctaIntent: 'Book a demo' }));
    expect(prompt).toContain('Desired viewer action the scene should invite (do NOT render it as text): Book a demo.');
  });

  it('Post + Image: no CTA intent, and the key message cannot trip the CTA-leak gate', () => {
    const { prompt } = composeCreatorImagePrompt(base({
      attachmentMode: 'supporting_visual',
      keyMessage: 'Press the button to see the CTA results',
      ctaIntent: 'Book a demo',
    }));
    expect(prompt).not.toContain('Book a demo');
    expect(prompt).toContain('Main message the scene must convey');
    const flags = validateProviderImageTextSafety({
      mode: 'supporting_visual', providerReturnedImage: true, prompt, overlayText: null,
    }).flags;
    expect(flags).not.toContain('supporting_visual_cta_prompt_leak');
  });

  it('no key message → no key-message line (unchanged prompt shape)', () => {
    const { prompt } = composeCreatorImagePrompt(base({ attachmentMode: 'embedded_copy', objective: 'Grow' }));
    expect(prompt).not.toContain('Main message the scene must convey');
  });

  it('the renderer forwards metadata.summary as keyMessage (objective kept)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/creatorAssetRendererSvg.ts'), 'utf8');
    expect(src).toContain('objective: compactText(input.metadata.objective || input.metadata.summary),');
    expect(src).toContain('keyMessage: compactText(input.metadata.summary),');
    expect(src).toMatch(/ctaIntent: compactText\(/);
  });
});
