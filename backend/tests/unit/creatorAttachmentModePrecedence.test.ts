/**
 * Attachment-mode precedence — the user's explicit toggle wins.
 *
 * buildCreatorGenerationBody set `attachment_mode: standaloneAttachmentMode`
 * and, three lines later in the same object literal, overwrote it with
 * `writerAttachmentMode` (null without a Writer source). A selected text image
 * template then re-set it to the template's own `embedded_copy` and the
 * text-bearing `banner` lane, so "Post + Image" could still draw text.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildCreatorGenerationBody } from '../../../lib/creator-content/creatorSuggestionAndPayload';
import { getTemplateById, resolveInitialStandaloneAttachmentMode } from '../../../lib/creator-templates';
import { WORKFLOW_CONFIG } from '../../../lib/creator-content/creatorWorkflowConfig';
import { resolveAttachmentModeFromIntent, normalizeWriterCreatorAssetType } from '../../../lib/content/writerCreatorAttachmentContracts';

function body(over: Record<string, unknown> = {}) {
  return buildCreatorGenerationBody({
    type: 'image',
    config: WORKFLOW_CONFIG.image,
    answers: { topic: 'BRIEF TOPIC', keyMessage: 'BRIEF MESSAGE', cta: 'BRIEF CTA' },
    selectedAsset: null, selectedSuggestion: null, refinedSuggestion: null, refinePrompt: '',
    writerSource: null, writerSupportingVisual: false, writerEmbeddedCopy: false,
    writerCompositionIntent: null, writerAssetType: null, writerAttachmentMode: null,
    standaloneAttachmentMode: 'embedded_copy',
    overlayText: {}, brandMode: 'neutral', brandPresence: 'none', brandSelections: {},
    brandProfile: null, brandOverrides: {}, brandContextLines: [],
    selectedPlatform: 'linkedin', selectedCompanyId: 'co-1',
    activeTemplate: null,
    templateValues: { fields: {} },
    lightweightContext: {}, blueprintId: null, compositionId: 'comp-1',
    variantPinOverride: null,
    ...over,
  } as never) as Record<string, unknown>;
}
const card = (b: Record<string, unknown>) => b.creator_card as Record<string, unknown>;

describe('the explicit toggle survives the payload builder', () => {
  it.each(['embedded_copy', 'supporting_visual'] as const)(
    'CRITICAL: standalone %s is not overwritten by the (null) writer mode',
    (mode) => {
      expect(card(body({ standaloneAttachmentMode: mode })).attachment_mode).toBe(mode);
    },
  );

  it('CRITICAL: Post + Image with a TEXT template stays supporting_visual, supporting_image, no overlay', () => {
    const template = getTemplateById('sys-image-headline-sub-cta')!;
    expect(template.renderingContract.attachmentMode).toBe('embedded_copy');
    const c = card(body({
      standaloneAttachmentMode: 'supporting_visual',
      activeTemplate: template,
      templateValues: { fields: { headline: 'TEMPLATE HEADLINE', cta: 'TEMPLATE CTA' } },
    }));
    expect(c.attachment_mode).toBe('supporting_visual');
    expect(c.writer_asset_type).toBe('supporting_image');
    expect(c.overlay_text).toBeNull();
    // The template identity still rides along for style.
    expect(c.template_id).toBe(template.id);
  });

  it('Text Inside Image with a text template keeps the template lane', () => {
    const template = getTemplateById('sys-image-headline-sub-cta')!;
    const c = card(body({ standaloneAttachmentMode: 'embedded_copy', activeTemplate: template }));
    expect(c.attachment_mode).toBe('embedded_copy');
    expect(c.writer_asset_type).toBe(template.renderingContract.writerAssetType);
  });

  it('Writer-launched sessions keep the Writer mode (fallback when there is no toggle)', () => {
    const c = card(body({
      writerSource: { sourceType: 'post', sourceId: 's1', title: 'Post', body: 'Body', platform: 'linkedin', hashtags: [] },
      writerAttachmentMode: 'embedded_copy',
      writerEmbeddedCopy: true,
      standaloneAttachmentMode: 'supporting_visual',
    }));
    expect(c.attachment_mode).toBe('embedded_copy');
  });

  it('server side: a supporting_image asset is pinned to supporting_visual even with text signals', () => {
    const resolution = resolveAttachmentModeFromIntent({
      assetType: normalizeWriterCreatorAssetType('supporting_image'),
      requestedMode: 'supporting_visual',
      cta: 'Book a demo',
      overlayText: { headline: 'leftover' },
    } as never);
    expect(resolution.mode).toBe('supporting_visual');
  });
});

describe('the reset effect and the template effect agree on the toggle', () => {
  it('restored draft value wins', () => {
    expect(resolveInitialStandaloneAttachmentMode({ restoredMode: 'embedded_copy', templateId: 'sys-image-logo-only', creatorType: 'image' }))
      .toBe('embedded_copy');
  });

  it('CRITICAL: an image template\'s declared mode is the default (reset can no longer wipe it)', () => {
    expect(resolveInitialStandaloneAttachmentMode({ templateId: 'sys-image-headline-sub-cta', creatorType: 'image' }))
      .toBe('embedded_copy');
  });

  it('no template / non-image family → clean visual default', () => {
    expect(resolveInitialStandaloneAttachmentMode({ creatorType: 'image' })).toBe('supporting_visual');
    expect(resolveInitialStandaloneAttachmentMode({ templateId: 'sys-image-headline-sub-cta', creatorType: 'carousel' })).toBe('supporting_visual');
  });

  it('the lifecycle reset uses the shared resolver', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../components/creator/workflow/useCreatorWorkflowLifecycle.tsx'), 'utf8');
    expect(src).toContain('setStandaloneAttachmentMode(resolveInitialStandaloneAttachmentMode({');
  });
});
