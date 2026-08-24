/**
 * Composition mode must govern image copy — not just the form.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Text Inside Image" (embedded_copy) vs "Post + Image" (supporting_visual) is
 * the user's statement about whether words belong ON the picture. The bug this
 * pins: `overlayPayload` consulted that choice, but whenever an image TEMPLATE
 * was selected the payload builder took a different branch that emitted
 * overlay_text unconditionally. Choosing "Post + Image" changed the form and
 * not the generated image — the copy still went to the renderer.
 *
 * That failure is invisible in the UI and only shows up as text baked into an
 * image the user asked to be visual-only.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../lib/creator-content/creatorSuggestionAndPayload.ts'), 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('A — one authoritative predicate', () => {
  it('imageCopyActive is derived from the composition mode', () => {
    expect(code).toContain('const imageCopyActive = overlayAllowed');
    expect(code).toMatch(/!writerSource \? standaloneEmbeddedCopy : writerEmbeddedCopy/);
  });

  it('the existing vocabulary is reused, not replaced', () => {
    // embedded_copy / supporting_visual already exist end to end; a new flag
    // would be a second source of truth for the same decision.
    expect(code).toContain("standaloneAttachmentMode === 'embedded_copy'");
    expect(code).not.toMatch(/imageTextMode|textInImageFlag|copyPlacement/);
  });
});

describe('B — SEPARATE ("Post + Image") excludes image copy', () => {
  it('CRITICAL: the template path is gated, not just the non-template path', () => {
    // The regression was precisely that this branch ignored the mode.
    expect(code).toMatch(
      /overlay_text: !imageCopyActive && isSocialCreativeType\(type\) && type === 'image'\s*\n?\s*\? null/);
  });

  it('MUTATION GUARD: removing the gate must fail this suite', () => {
    // If overlay_text goes back to starting at `activeTemplate && ...`, stale
    // headline/subheadline/CTA reach generation again in Post + Image mode.
    const overlayLine = code.slice(code.indexOf('overlay_text:'), code.indexOf('overlay_text:') + 220);
    expect(overlayLine).toContain('!imageCopyActive');
    expect(overlayLine).not.toMatch(/^\s*overlay_text: activeTemplate && activeTemplate\.assetFamily === 'image'/m);
  });

  it('the non-template path remains gated as before', () => {
    expect(code).toMatch(/const overlayPayload = isSocialCreativeType\(type\) && overlayAllowed/);
    expect(code).toContain('!(type === \'image\' && !standaloneEmbeddedCopy)');
  });
});

describe('C — TEXT-IN-IMAGE preserves image copy', () => {
  it('the template-authoritative projection is still reachable', () => {
    // Gating must not amputate the embedded_copy path: when the user DOES want
    // text on the image, the template fields remain its only source.
    expect(code).toContain('projectImageOverlayText(activeTemplate, templateValues)');
    expect(code).toContain('__template_authoritative');
  });

  it('the mode is still reported to the server', () => {
    expect(code).toMatch(/attachment_mode: standaloneAttachmentMode/);
  });
});

describe('D — scope', () => {
  it('the fix is confined to overlay copy', () => {
    // No CONDITION/COMPOSE, provider, or asset-model behaviour may move.
    expect(code).not.toMatch(/images\.(edit|generate)|gpt-image|conditionPlan|composePlan/);
  });

  it('composition_id propagation is untouched', () => {
    expect(code).toContain('composition_id: compositionId');
  });
});
