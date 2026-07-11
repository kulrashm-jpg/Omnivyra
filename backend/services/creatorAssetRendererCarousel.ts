/** Part 7/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { config } from '../../config';
import {
  buildCreatorBrandKitMetadata,
  normalizeBrandMark,
  resolveCreatorBrandKit,
  type CreatorBrandKit,
} from './creatorBrandKit';
import { resolveBrand } from './brand/brandRuntime';
import { brandRuntimeToCreatorBrandKit } from './brand/brandRuntimeAdapter';
import { captureImageProviderCost } from './billing/blackHoleCostCapture';
import { recordAssetCredits } from './aiUsageCollector';
import { resolveCostProfile } from './creator/costProfiles';
import { fitSlideArcToCount } from './creator/purposeStrategyRegistry';
import { resolveTemplateStyle } from '../../lib/creator-outcomes/creatorVisualStyleRegistry';
import { isBetaAiRenderMode, createBetaMockImage, BETA_MOCK_MODEL } from './creator/rendering/providers/betaMockRenderProvider';
import { creatorEvent } from './creatorObservation';
import { recordCreatorDuration } from './creatorRuntimeMetrics';
import { validateProviderImageTextSafety } from './creatorImageTextValidation';
import { runCreatorOcr, isLightweightSocialEmbeddedCopy } from './creatorOcrProvider';
import {
  autoCorrectVisualCopy,
  buildPreviewGovernanceWarnings,
  estimateTextAreaPercent,
  resolveAssetGovernanceProfile,
  resolvePlatformVisualProfile,
  scoreCreatorQuality,
  validateVisualGovernance,
} from './creatorAssetGovernance';
import { estimateTextBox, validateLayoutGeometry } from './creatorRenderGeometry';
import {
  assertRenderManifestExportable,
  createRenderManifest,
  synthesizeReadingOrderForOverlay,
  type GovernanceCompatibilityFlags,
} from './creatorRenderManifest';
import { detectSemanticThreadDuplication } from './creatorSemanticDuplication';
import { validateCreatorAccessibility } from './creatorAccessibilityValidation';
import { logPipelineEvent } from '../../lib/shared/observability';
import { persistCreatorValidationManifest } from './creatorRenderPersistence';
import { resolvePlatformGeometryProfile, platformTextBoxY } from './creatorPlatformGeometry';
import { getCreatorRendererRegistration } from './creatorRendererRegistry';
import { composeInfographicCopy } from './creator/infographicCopyComposer';
import {
  infographicChartsEnabled,
  infographicTablesEnabled,
  infographicBackgroundImagesEnabled,
  resolveStructuredCards,
  resolveBackgroundConfig,
  buildBackgroundLayerSvg,
  buildChartCardSvg,
  buildTableCardSvg,
  type InfographicCardBrand,
} from './creator/infographicDataCards';
// Canonical Template visual-language consumption (TEMPLATE-003). The renderer
// reads its visual constants from the resolved family style via the ONE
// canonical resolver. No template / unknown id → the canonical DEFAULT style,
// whose values equal the prior hardcoded constants → byte-identical output.
import {
  resolveTemplate,
  infographicStyleForBlueprint,
  infographicLayoutForBlueprint,
  infographicCompositionForBlueprint,
  semanticStructureForBlueprint,
  semanticSlotCountForBlueprint,
  DEFAULT_IMAGE_STYLE,
  DEFAULT_INFOGRAPHIC_STYLE,
  type InfographicStyleSchema,
  type InfographicEngineGeometry,
  type ImageStyleSchema,
  type CarouselStyleSchema,
  type PresetVariant,
  type CreatorTemplate,
} from '../../lib/creator-templates';
import { registerCuratedSystemTemplates } from '../../lib/creator-outcomes/curatedSystemTemplatesFull';
import { ensureRenderFonts } from './creatorRenderFonts';

// FONT PARITY (PHASE 14J): configure fontconfig to discover the vendored fonts
// BEFORE sharp loads. Every infographic render path — render-inline,
// generate-inline (orchestrator), and the worker — flows through this module,
// so initializing here (the single render chokepoint) gives them all the
// identical font contract render-inline previously had alone. Idempotent +
// never throws; a no-op where system fonts already exist (e.g. the worker).
ensureRenderFonts();
import { sharp, PDFDocument, type RenderedMediaBundle, type CreatorReviewPreviewInput, type RenderOptions, type OverlayQualityReport, safeObject, resolveCarouselRenderStyle, resolveCarouselTemplateArc, carouselOverlayBaseStyle, renderBackgroundPng, classifyPdfStorageFailure, USER_MESSAGE_FOR_PDF_FALLBACK, compactText } from './creatorAssetRendererContracts';
import { buildOverlaySvg, loadBrandMark } from './creatorAssetRendererOverlay';
import { uploadRenderedPng, uploadRenderedFile } from './creatorAssetRendererMedia';
import { renderCreatorAssetReviewPreview } from './creatorAssetRendererImage';

export async function renderCreatorCarouselReviewPreview(input: CreatorReviewPreviewInput): Promise<{
  buffer: Buffer;
  metadata: Record<string, unknown>;
}> {
  const head = input.overlayText ?? {};
  // Three distinct slides so the deck reads as a real carousel, not a duplicated image.
  const slideOverlays = [
    { headline: head.headline ?? input.title, subheadline: head.subheadline, cta: undefined },
    { headline: head.subheadline ?? input.body, subheadline: undefined, cta: undefined },
    { headline: head.cta ?? 'Learn more', subheadline: head.headline ?? input.title, cta: head.cta ?? 'Learn more' },
  ];
  const slides: Buffer[] = [];
  for (const ov of slideOverlays) {
    // Square canvas (instagram) so the slide isn't side-cropped into the deck card.
    const { buffer } = await renderCreatorAssetReviewPreview({ ...input, platform: 'instagram', assetType: 'image', overlayText: ov });
    slides.push(buffer);
  }

  const S = 1080;
  const card = 700;          // slide size before frame
  const framed: Buffer[] = [];
  for (const s of slides) {
    framed.push(await sharp(s).resize(card, card, { fit: 'cover' })
      .extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' })
      .png().toBuffer());
  }
  const fc = card + 24;       // framed card size
  // Deck: back + mid peek up-and-right behind the fully-visible front slide.
  const positions = [
    { left: S - fc - 70, top: 95 },                 // back
    { left: Math.round((S - fc) / 2), top: 135 },   // mid
    { left: 70, top: 175 },                          // front (slide 1)
  ];
  const dotY = S - 70;
  const dots = `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">`
    + `<circle cx="${S / 2 - 30}" cy="${dotY}" r="8" fill="#2563eb"/>`
    + `<circle cx="${S / 2}" cy="${dotY}" r="8" fill="#cbd5e1"/>`
    + `<circle cx="${S / 2 + 30}" cy="${dotY}" r="8" fill="#cbd5e1"/></svg>`;
  const buffer = await sharp({ create: { width: S, height: S, channels: 4, background: { r: 226, g: 232, b: 240, alpha: 1 } } })
    .composite([
      { input: framed[2], top: positions[0].top, left: positions[0].left },
      { input: framed[1], top: positions[1].top, left: positions[1].left },
      { input: framed[0], top: positions[2].top, left: positions[2].left },
      { input: Buffer.from(dots), top: 0, left: 0 },
    ])
    .png().toBuffer();

  return { buffer, metadata: { width: S, height: S, preview_kind: 'visual_review_carousel', platform: input.platform, asset_type: 'carousel', slides: slideOverlays.length } };
}

/**
 * Strip prompt-style formatting instructions that leaked out of the
 * LLM into visible slide copy. Operator feedback flagged lines like
 * "Use a modern font for the headline, with a clean layout" appearing
 * verbatim under the body text. These are design DIRECTIVES the LLM
 * was meant to ACT on, not echo. We remove leading directive phrases
 * and drop any sentence that's still primarily a directive after that.
 *
 * Conservative: only matches well-known directive openers / fragments
 * so legitimate body copy (e.g., "Use AI to transform your strategy")
 * is preserved. The directive opener "Use a/an [adj] font/layout/..."
 * is structurally distinct from product copy.
 */
export function stripPromptDirectives(raw: string | null | undefined): string {
  const input = String(raw ?? '').trim();
  if (!input) return '';
  // Design-directive nouns. If a sentence starts with "Use a/an" or
  // "With a/an" AND mentions any of these anywhere, it's a leaked
  // prompt-style directive, not body copy. Comma-separated adjective
  // chains like "Use a clean, modern illustration style with a..."
  // are now caught because we no longer require the noun to be the
  // immediate next word after the article.
  const DIRECTIVE_NOUNS = /\b(font|layout|design|color|colour|palette|typography|hierarchy|style|illustration|composition|template|aesthetic|graphic|imagery|visual|tone|mood|background|foreground|spacing|alignment|kerning|leading|copy|filler|clutter|whitespace)\b/;
  const directiveSentence = (sentence: string): boolean => {
    const s = sentence.trim().toLowerCase();
    if (!s) return true;
    // "Use a/an ... [directive noun anywhere]" — catches "Use a clean,
    // modern illustration style with a clean palette" etc. Anchored
    // on the article ("a"/"an") so legitimate body copy like
    // "Use AI to..." / "Use this framework..." stays.
    if (/^use\s+(a|an)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "With a/an [directive noun anywhere]" — same shape, fragment.
    if (/^with\s+(a|an)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // Bare "use a/an [adj] [adj]..." trailing fragment (the LLM
    // sometimes echoes a directive without a closing period).
    if (/^use\s+(a|an)\s+(\w+,?\s+){1,5}/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "Ensure [the headline / the layout / etc.] ..." — directive.
    if (/^ensure\s+(the\s+)?/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "Make sure / make it ... [design term]" — directive.
    if (/^make\s+(sure|it|the\s+\w+)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    // "Avoid [design term]" — negative directive.
    if (/^avoid\s+/.test(s) && /(text|font|copy|filler|clutter|noise|over|whitespace)/.test(s)) return true;
    // "Render / create / produce / show [a/the] ... [design term]" —
    // catch-all imperative directive forms.
    if (/^(render|create|produce|show|display|present|generate|build|illustrate)\s+(a|an|the)\s+/.test(s) && DIRECTIVE_NOUNS.test(s)) return true;
    return false;
  };
  // Split into sentences but keep delimiters so we can rejoin cleanly.
  // Trailing/leading whitespace is normalized at the end.
  const sentences = input.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !directiveSentence(s));
  const result = kept.join(' ').replace(/\s+/g, ' ').trim();
  // If filtering wiped everything (every sentence was a directive),
  // return empty rather than a stub — downstream falls back to the
  // strategy's intent text.
  return result;
}

/**
 * Renderer-level guard: derive a distinct, role-appropriate headline for a
 * carousel slide whose title duplicates an earlier slide's (AUDIT-004 RC-3).
 * The deck path has no cross-slide dedupe, so a generator that emits duplicate
 * slide titles otherwise renders identical-looking slides. Never drops a slide;
 * the durable fix is distinct upstream generation.
 */
const ROLE_HEADLINE: Record<string, (topic: string) => string> = {
  hook: (t) => `Start here: ${t}`,
  insight: (t) => `The key insight on ${t}`,
  proof: (t) => `Why ${t} matters`,
  example: (t) => `${t} in practice`,
  content: (t) => `How ${t} works`,
  cta: (t) => `Your next step with ${t}`,
  summary: (t) => `The takeaway on ${t}`,
  problem: (t) => `The problem with ${t}`,
  solution: (t) => `A better way with ${t}`,
};
function distinctHeadlineForRole(original: string, role: string, metadata: Record<string, unknown>): string {
  const topic = compactText(String(metadata.topic || original)) || original;
  const roleKey = String(role || '').toLowerCase().replace(/_\d+$/, '').replace(/[^a-z]/g, '');
  const make = ROLE_HEADLINE[roleKey];
  const derived = make ? make(topic) : `${String(role).replace(/_/g, ' ')}: ${original}`;
  return compactText(derived) || `${original} — ${String(role).replace(/_/g, ' ')}`;
}

export function normalizeStructuredItems(
  items: Array<Record<string, unknown>>,
  fallbackLabel: string,
  fileNamePrefix: string,
  metadata: Record<string, unknown>,
): Array<{ headline: string; body: string; designNote?: string; role?: string }> {
  // Purpose-driven slide-arc orchestration. When the metadata carries
  // a resolved purposeStrategy with a slideArc (carousel) OR an
  // informationArchitecture.sectionBlueprint (infographic-ish), use
  // it as the canonical role sequence. The LLM-supplied items map
  // onto these roles in order; when fewer items than roles, missing
  // slides are scaffolded from the strategy's intent. When more
  // items than roles, extras keep their LLM-supplied roles.
  const bundleMeta = safeObject(safeObject(metadata.media_bundle).metadata);
  const purposeStrategy = (() => {
    const direct = (metadata as Record<string, unknown>).purpose_strategy;
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
    const fromBundle = bundleMeta.purpose_strategy;
    if (fromBundle && typeof fromBundle === 'object') return fromBundle as Record<string, unknown>;
    return null;
  })();
  const slideArcRoles = Array.isArray((purposeStrategy as Record<string, unknown> | null)?.slideArcRoles)
    ? ((purposeStrategy as Record<string, unknown>).slideArcRoles as unknown[]).map(String).filter(Boolean)
    : null;
  // Fidelity: prefer the selected template's OWN arc (from preview.sample.slides) over the
  // shared purpose arc, so each of the 20 carousel templates renders its own narrative.
  const templateArc = resolveCarouselTemplateArc(metadata);
  const effectiveArc = templateArc && templateArc.length > 0 ? templateArc : slideArcRoles;

  const clean = items.map((item, index) => {
    // RC-2 (AUDIT-004): stripPromptDirectives can wipe a directive-shaped body to
    // '' — the `||` chain already resolved to the raw directive, so the label
    // fallback was bypassed and the slide rendered a BLANK body region. Re-fall
    // back to real campaign copy (summary/objective/topic); the generic label
    // only as a last resort, so no slide ever renders an empty body.
    const strippedBody = compactText(stripPromptDirectives(String(item.body_text || item.body || item.text || item.summary || '')));
    const body = strippedBody
      || compactText(String(metadata.summary || metadata.objective || metadata.topic || ''))
      || fallbackLabel;
    return {
      role: compactText(item.role || item.section_type || item.type || `Slide ${index + 1}`),
      headline: compactText(stripPromptDirectives(String(item.headline || item.title || item.heading || `Slide ${index + 1}`))),
      body,
      designNote: compactText(item.design_note || item.visual_description || item.visual || ''),
    };
  }).filter((item) => item.headline || item.body);

  if (clean.length > 0) {
    // Carousel slide-limit removal — render EXACTLY the slides supplied by the
    // generation pipeline (template-driven dynamic counts: 3/5/7/8/9/10/…).
    // The former artificial cap (8 for carousel/slider, 7 for pdf) truncated
    // larger decks; it is intentionally removed with NO replacement limit.
    // Ordering is preserved (index order). The downstream render loop, deck
    // context, per-slide upload, OCR, and PDF paging are all driven by
    // `renderItems.length`, so every supplied slide is rendered, previewed,
    // and exported.
    const sliced = clean;
    // Purpose-strategy role overlay — when the strategy supplies a
    // role sequence (Educational: hook → concept → explanation →
    // example → summary, Story: hook → problem → journey → ..., etc.),
    // assign roles in order so structured slide generation matches
    // the strategy's narrative architecture.
    // Count-aware role arc — size the strategy arc (or a generic hook→…→cta arc) to
    // the ACTUAL number of slides so every slide gets a distinct strategic role. Prevents
    // generic `slide_N` filler on long decks (which read as duplicates) and dropped roles
    // on short decks. See fitSlideArcToCount.
    const baseArc = effectiveArc && effectiveArc.length > 0 ? effectiveArc : ['hook', 'insight', 'proof', 'content', 'cta'];
    const fittedRoles = fitSlideArcToCount(baseArc, sliced.length);
    // RC-3 (AUDIT-004): no cross-slide dedupe exists on the deck path, so
    // duplicate upstream titles (observed: slides 1 & 2 both "Unlock Thought
    // Leadership") render as identical slides. Differentiate — never drop — a
    // slide whose headline repeats an earlier one, using its distinct role.
    const seenHeadlines = new Set<string>();
    const normKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    return sliced.map((item, index) => {
      const role = fittedRoles[index] || item.role || `slide_${index + 1}`;
      let headline = item.headline;
      if (normKey(headline) && seenHeadlines.has(normKey(headline))) {
        headline = distinctHeadlineForRole(headline, role, metadata);
      }
      seenHeadlines.add(normKey(headline));
      return { role, headline, body: item.body, designNote: item.designNote };
    });
  }

  // Empty-LLM fallback. When a purpose strategy is present, scaffold
  // slides directly from its arc so the fallback path still produces
  // strategy-aligned content rather than the generic hook/insight/
  // proof/cta sequence.
  const topic = compactText(metadata.topic || fallbackLabel, fallbackLabel);
  const summary = compactText(metadata.summary || fallbackLabel, fallbackLabel);
  const objective = compactText(metadata.objective || 'Make the core idea easy to act on');
  if (effectiveArc && effectiveArc.length > 0) {
    return effectiveArc.map((role, index) => ({
      role,
      headline: index === 0 ? topic : role.replace(/_/g, ' '),
      body: index === 0 ? summary : index === effectiveArc.length - 1 ? objective : 'Detail for this slide will be expanded.',
      designNote: `${role} slide`,
    }));
  }
  return [
    { role: 'hook', headline: topic, body: summary, designNote: 'Strong opening hierarchy' },
    { role: 'insight', headline: 'Core insight', body: objective, designNote: 'Clarify the important shift' },
    { role: 'proof', headline: 'Why it matters', body: summary, designNote: 'Add credibility and context' },
    { role: 'cta', headline: compactText(metadata.cta || 'Next step'), body: 'Close with one clear action.', designNote: 'CTA ending' },
  ];
}

/**
 * Deck-wide rendering context. Computed ONCE per carousel/pdf/slider
 * so every slide in the deck:
 *
 *  1. Uses the same adaptive font multiplier (based on the longest
 *     slide's text length — guarantees consistent type sizes across
 *     the deck, not a different font on every slide).
 *
 *  2. Picks a layout from a deterministic rotation (text_top /
 *     text_center / text_bottom) so the deck has visual rhythm
 *     instead of identical bottom-anchored slides.
 *
 *  3. Continues the wave-form visual continuity line: slide N's
 *     left-edge wave-Y matches slide N-1's right-edge wave-Y, so
 *     across the swipe-through experience the curve reads as one
 *     uninterrupted flowing line, not five truncated stubs.
 */
type DeckLayoutMode = 'text_top' | 'text_center' | 'text_bottom';
type DeckSlideWaveAnchor = { entryY: number; exitY: number };
type DeckRenderContext = {
  /** The single adaptive font multiplier every slide will use. */
  fontMultiplier: number;
  /** Layout mode for each slide index. */
  layoutModes: DeckLayoutMode[];
  /** Wave entry / exit Y for each slide, in pixels. Slide i's exitY
   *  equals slide i+1's entryY so the curve is continuous. */
  waveAnchors: DeckSlideWaveAnchor[];
};

function buildDeckRenderContext(input: {
  // Loose shape — accepts the Record<string,string>[] coming out of
  // normalizeStructuredItems. We only read .headline / .body /
  // .designNote / .role so anything else on the record is ignored.
  renderItems: ReadonlyArray<Record<string, string>>;
  width: number;
  height: number;
}): DeckRenderContext {
  const { renderItems, height } = input;
  // 1. Deck-wide font multiplier — derived from the slide with the
  // MOST text, so the smallest-fitting font wins. This forces every
  // slide in the deck to render at the same type scale (consistency)
  // rather than each picking its own per-slide scale.
  // Operator feedback: "we have a lot of white space, and we should
  // have a guideline that looks into the white space... look at the
  // busiest slide available... and based on that, decide what should
  // be the font size for the title as well as the text."
  //
  // The multiplier is now derived from the BUSIEST slide's title +
  // subheading length (designNote excluded — that field is no longer
  // rendered). Bumped across the board so even the busiest slide
  // fills the canvas instead of leaving the 40%+ empty top band the
  // previous defaults produced.
  const maxOverlayChars = renderItems.reduce((max, item) => {
    const chars = String(item.headline || '').length
      + String(item.body || '').length;
    return Math.max(max, chars);
  }, 0);
  const fontMultiplier =
    maxOverlayChars <= 60 ? 1.70  // very short hook — title dominates
    : maxOverlayChars <= 110 ? 1.55
    : maxOverlayChars <= 170 ? 1.40
    : maxOverlayChars <= 230 ? 1.25
    : maxOverlayChars <= 300 ? 1.10
    : maxOverlayChars <= 380 ? 0.98
    : 0.88;

  // 2. Layout rotation. The roles supplied by normalizeStructuredItems
  // are stable (hook / insight / proof / cta / etc.) so we can derive
  // a deterministic but varied sequence:
  //   - hook slide      → text_center (entry, focal headline)
  //   - cta slide (last)→ text_center (exit, focal call)
  //   - middles         → alternate text_top / text_bottom
  // This is the variety operator feedback asked for: text doesn't
  // always live at the bottom of every slide.
  const layoutModes: DeckLayoutMode[] = renderItems.map((item, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === renderItems.length - 1;
    const role = String(item.role || '').toLowerCase();
    if (isFirst || role === 'hook' || role === 'title') return 'text_center';
    if (isLast || role === 'cta' || role === 'next_steps' || role === 'summary' || role === 'outcome' || role === 'conclusion') return 'text_center';
    // Alternate the middle slides — text_top on odd middles,
    // text_bottom on even middles — so the visual rhythm shifts as
    // the viewer swipes through.
    return idx % 2 === 0 ? 'text_top' : 'text_bottom';
  });

  // 3. Continuous wave anchors. Pick a smooth sweep across the deck:
  //    entry/exit Y values oscillate gently between 0.25 and 0.55
  //    of canvas height, deterministically per index. Slide N's
  //    exitY equals slide N+1's entryY by construction.
  const waveAnchors: DeckSlideWaveAnchor[] = [];
  // Anchor sequence: each slide-boundary gets a Y ratio. With N
  // slides, there are N+1 boundary points (slide_0_left, ..., slide_N-1_right).
  // We oscillate through a small set so adjacent boundaries share a
  // Y position (continuity) without the curve repeating identically.
  const boundaryRatios: number[] = [];
  const baseSweep = [0.30, 0.42, 0.28, 0.48, 0.32, 0.40, 0.26, 0.46];
  for (let i = 0; i <= renderItems.length; i += 1) {
    boundaryRatios.push(baseSweep[i % baseSweep.length]);
  }
  for (let i = 0; i < renderItems.length; i += 1) {
    waveAnchors.push({
      entryY: Math.round(height * boundaryRatios[i]),
      exitY: Math.round(height * boundaryRatios[i + 1]),
    });
  }

  return { fontMultiplier, layoutModes, waveAnchors };
}

async function renderStructuredSlidePng(input: {
  item: Record<string, string>;
  index: number;
  total: number;
  metadata: Record<string, unknown>;
  assetPayload: Record<string, unknown>;
  fileNamePrefix: string;
  width: number;
  height: number;
  brandKit: CreatorBrandKit;
  /** Deck-wide context. Provided when called from
   *  composeStructuredDeckAsset; absent for single-slide callers. */
  deckContext?: DeckRenderContext;
  /** Canonical carousel visual language (deck path). Drives the slide overlay
   *  base preset + continuity-wave gating. Default style → byte-identical. */
  carouselStyle?: CarouselStyleSchema;
}): Promise<{ buffer: Buffer; quality: OverlayQualityReport }> {
  const platform = compactText(input.metadata.platform || input.metadata.primary_platform, 'linkedin');
  // Operator feedback: drop the third "supporting / explanation"
  // tier entirely. The slide content is TITLE (headline) +
  // SUBHEADING (insight) only. The third tier carried the LLM's
  // design directive notes ("use a modern font for the headline
  // with a clean...") which were never meant for the reader. With
  // that field empty, the renderer skips the support block and the
  // title + subheading get bigger fonts and more vertical real estate.
  const overlay = {
    hook: `${input.item.role || 'slide'} ${input.index + 1}/${input.total}`,
    headline: input.item.headline,
    keyInsight: input.item.body,
    // Only the FINAL slide carries a CTA pill. Middle slides previously painted a
    // "Keep reading" button on every frame — an amateur tell that diluted the real
    // CTA; the swipe chevron already signals continuation.
    cta: input.index === input.total - 1 ? compactText(input.metadata.cta || 'Take the next step') : '',
    supportingText: '',
  };
  const background = await renderBackgroundPng({
    width: input.width,
    height: input.height,
    colors: input.brandKit.normalizedPalette,
    // Per-slide index keeps slides within a carousel distinct; mixing the
    // slide body keeps DIFFERENT carousels distinct from each other too.
    variantId: `${input.brandKit.layoutVariantId}:${input.index}:${String(input.item?.body || '').slice(0, 48)}`,
    // Carousel visual language — slide frame radius (0 → square, byte-identical).
    frameRadius: input.carouselStyle?.frame.cornerRadius ?? 0,
  });
  // Strategy-aware carousel/infographic slide rendering — read the
  // resolved purpose_strategy.id from metadata and look up the
  // matching render strategy. Slides for carousels and infographics
  // share the same buildOverlaySvg entry point as image rendering, so
  // the same strategy modifiers apply per slide.
  const { resolveRenderStrategy: resolveRenderStrategySlide } =
    require('./creator/renderStrategyRegistry') as typeof import('./creator/renderStrategyRegistry');
  const slideBundleMeta = safeObject(safeObject(input.metadata.media_bundle).metadata);
  const slidePurposeStrategyId =
    (typeof slideBundleMeta.purpose_strategy === 'object' && slideBundleMeta.purpose_strategy !== null
      ? String((slideBundleMeta.purpose_strategy as Record<string, unknown>).id || '')
      : '') ||
    (typeof input.metadata.purpose_strategy === 'object' && input.metadata.purpose_strategy !== null
      ? String((input.metadata.purpose_strategy as Record<string, unknown>).id || '')
      : '');
  const slideRenderStrategyRaw = resolveRenderStrategySlide(slidePurposeStrategyId || null);
  // ── Variant overlay (PHASE 4) — carousel/infographic slide path ──
  // Mirrors the image-flow composition above. Reads `variant_family`
  // / `variant_id` from the slide metadata bundle and overlays the
  // variant profile on top of the slide's RenderStrategyModifiers.
  const slideVariantFamily = (() => {
    const meta = slideBundleMeta as Record<string, unknown>;
    const fromMeta = meta.variant_family;
    if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;
    const purposeStrategyMeta = meta.purpose_strategy && typeof meta.purpose_strategy === 'object'
      ? (meta.purpose_strategy as Record<string, unknown>)
      : null;
    const fromPurpose = purposeStrategyMeta?.variant_family;
    return typeof fromPurpose === 'string' && fromPurpose.length > 0 ? fromPurpose : null;
  })();
  const slideVariantIdMeta = (() => {
    const meta = slideBundleMeta as Record<string, unknown>;
    const fromMeta = meta.variant_id;
    return typeof fromMeta === 'string' && fromMeta.length > 0 ? fromMeta : null;
  })();
  const { resolveVariant: _slideResolveVariant, resolveVariantByFamily: _slideResolveVariantByFamily } =
    require('./creator/variantRegistry') as typeof import('./creator/variantRegistry');
  const { resolveVariantStrategyProfile: _slideResolveProfile, composeVariantOntoStrategyModifiers: _slideCompose } =
    require('./creator/variantStrategyProfiles') as typeof import('./creator/variantStrategyProfiles');
  const slideVariant =
    _slideResolveVariant(slideVariantIdMeta)
    ?? _slideResolveVariantByFamily(slidePurposeStrategyId || null, slideVariantFamily);
  const slideVariantProfile = _slideResolveProfile(slideVariant?.variant_id ?? null);
  const slideRenderStrategy = slideRenderStrategyRaw && slideVariantProfile
    ? {
        ...slideRenderStrategyRaw,
        modifiers: _slideCompose(slideRenderStrategyRaw.modifiers, slideVariantProfile),
      }
    : slideRenderStrategyRaw;
  const overlayRender = buildOverlaySvg({
    width: input.width,
    height: input.height,
    overlay,
    brandKit: input.brandKit,
    platform,
    fileNamePrefix: input.fileNamePrefix === 'pdf' ? 'infographic' : 'carousel',
    renderStrategy: slideRenderStrategy,
    slideIndex: input.index,
    slideTotal: input.total,
    deckContext: input.deckContext,
    // Activate the carousel visual language: overlay base preset from the
    // resolved carouselStyle, and the continuity wave gated by its decoration.
    imageStyle: input.carouselStyle ? carouselOverlayBaseStyle(input.carouselStyle) : undefined,
    waveEnabled: input.carouselStyle ? input.carouselStyle.decoration.wave.enabled : undefined,
  });
  const brandMark = await loadBrandMark({
    brandKit: input.brandKit,
    placement: overlayRender.brandPlacement,
  });
  const composites: Array<{ input: Buffer; top: number; left: number }> = [
    { input: Buffer.from(overlayRender.svg), top: 0, left: 0 },
  ];
  // Operator feedback: middle slides (2..N-1) were showing an empty
  // patchwork rectangle because the brand mark was suppressed for
  // those frames but the SVG overlay still painted a backing tile.
  // The backing tile has been removed entirely (logos now keep their
  // own transparent edge), and the logo is composited on EVERY slide
  // in the deck for brand continuity — not just the first/last.
  if (brandMark) {
    composites.push({ input: brandMark, top: overlayRender.brandPlacement.top, left: overlayRender.brandPlacement.left });
  }
  const buffer = await sharp(background)
    .composite(composites)
    .png()
    .toBuffer();
  return { buffer, quality: overlayRender.quality };
}

async function createPdfBuffer(input: {
  title: string;
  items: Array<Record<string, string>>;
  brandKit: CreatorBrandKit;
  cta: string;
}): Promise<Buffer> {
  const brandMark = await loadBrandMark({
    brandKit: input.brandKit,
    placement: { maxWidth: 96, maxHeight: 48 },
  }).catch(() => null);
  return new Promise((resolve, reject) => {
    const primary = input.brandKit.normalizedPalette[0] || '#111827';
    const accent = input.brandKit.accentColor;
    const pdfFont = input.brandKit.typography.pdfFont || 'Helvetica';
    const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: input.title } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8fafc');
    if (brandMark) {
      doc.image(brandMark, 462, 48, { fit: [96, 48] });
    }
    doc.fillColor(primary).font(`${pdfFont}-Bold`).fontSize(32).text(input.title, 54, 86, { width: 500 });
    if (input.brandKit.companyName) {
      doc.fillColor(accent).font(`${pdfFont}-Bold`).fontSize(12).text(input.brandKit.companyName.toUpperCase(), 54, 54, { characterSpacing: 1.2 });
    }
    if (input.brandKit.domain || input.brandKit.tone) {
      doc.fillColor('#475569').font(pdfFont).fontSize(14).text(input.brandKit.domain || input.brandKit.tone, 54, 178, { width: 460 });
    }
    doc.roundedRect(54, 248, 504, 110, 14).fill('#ffffff').stroke('#e2e8f0');
    doc.fillColor('#0f172a').font(`${pdfFont}-Bold`).fontSize(18).text(input.items[0]?.headline || 'Overview', 78, 276, { width: 456 });
    doc.fillColor('#475569').font(pdfFont).fontSize(12).text(input.items[0]?.body || '', 78, 308, { width: 456, lineGap: 4 });

    input.items.forEach((item, index) => {
      doc.addPage({ size: 'LETTER', margin: 54 });
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
      if (brandMark) doc.image(brandMark, 478, 46, { fit: [80, 38] });
      doc.fillColor(accent).font(`${pdfFont}-Bold`).fontSize(11).text(`${item.role || 'SECTION'} ${index + 1}`.toUpperCase(), 54, 54, { characterSpacing: 1.1 });
      doc.fillColor(primary).font(`${pdfFont}-Bold`).fontSize(25).text(item.headline, 54, 86, { width: 500, lineGap: 4 });
      doc.moveTo(54, 154).lineTo(558, 154).lineWidth(2).strokeColor(accent).stroke();
      doc.fillColor('#334155').font(pdfFont).fontSize(13).text(item.body, 54, 184, { width: 500, lineGap: 6 });
      if (item.designNote) {
        doc.roundedRect(54, 492, 504, 86, 12).fill('#f1f5f9').stroke('#e2e8f0');
        doc.fillColor('#475569').font(`${pdfFont}-Bold`).fontSize(11).text('Creative note', 76, 516);
        doc.fillColor('#64748b').font(pdfFont).fontSize(11).text(item.designNote, 76, 536, { width: 456 });
      }
      doc.fillColor('#94a3b8').font(pdfFont).fontSize(9).text(input.brandKit.companyName || 'Creator asset', 54, 724);
    });

    doc.addPage({ size: 'LETTER', margin: 54 });
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(primary);
    if (brandMark) doc.image(brandMark, 54, 118, { fit: [106, 54] });
    doc.fillColor('#ffffff').font(`${pdfFont}-Bold`).fontSize(30).text(input.cta || 'Take the next step', 54, 220, { width: 500 });
    doc.fillColor('#cbd5e1').font(pdfFont).fontSize(14).text(input.brandKit.domain || input.brandKit.companyName || input.title, 54, 290, { width: 500, lineGap: 5 });
    doc.end();
  });
}

export async function composeStructuredDeckAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
  fallbackLabel: string,
  fileNamePrefix: 'carousel' | 'pdf' | 'slider',
  rendererId: string,
): Promise<RenderedMediaBundle> {
  const metadata = safeObject(safeObject(assetPayload.media_bundle).metadata);
  const platform = compactText(metadata.platform || metadata.primary_platform, 'linkedin');
  // Phase 4D-B — final visual consumer. The deck composer (carousel / slider /
  // deck-PDF — NOT the separate report system in backend/services/export) adopts
  // the BrandRuntime via the 1C adapter when a published brand_identity row
  // exists; otherwise the exact legacy resolver path (defaults byte-identical).
  // Same source guard as 4A/4B/4D-A. Accent already flows canonically through
  // overlayStrategy.ctaFill (no palette[1] assumption in this path).
  const brandRuntime = options.companyId
    ? await resolveBrand(options.companyId).catch(() => null)
    : null;
  const brandKit = brandRuntime && brandRuntime.meta.source === 'brand_identity'
    ? brandRuntimeToCreatorBrandKit(brandRuntime, { assetPayload, metadata, platform, assetType: fileNamePrefix })
    : resolveCreatorBrandKit({
        assetPayload,
        metadata,
        companyId: options.companyId,
        tenantId: options.companyId,
        platform,
        assetType: fileNamePrefix,
      });
  const renderItems = normalizeStructuredItems(items, fallbackLabel, fileNamePrefix, metadata);
  // Canonical Template visual language (carousel/slider/pdf). Default style ==
  // prior canvas constants → byte-identical.
  const carouselStyle = resolveCarouselRenderStyle(metadata);
  const deckCanvas = fileNamePrefix === 'slider' ? carouselStyle.canvas.slider
    : fileNamePrefix === 'pdf' ? carouselStyle.canvas.pdf
    : carouselStyle.canvas.carousel;
  const width = deckCanvas.width;
  const height = deckCanvas.height;
  const files: string[] = [];
  const qualityReports: OverlayQualityReport[] = [];
  const slideOcrResults: Array<Awaited<ReturnType<typeof runCreatorOcr>>> = [];
  // Operator feedback: "[the renderer] should be aware of all the
  // five slides so that we can bring the consistency into the text
  // format". Compute deck-wide context ONCE so every slide picks the
  // same font scale and the wave waypoints flow continuously across
  // the deck (slide N's right-edge wave-Y === slide N+1's left-edge
  // wave-Y, so the curve reads as one continuous flowing line).
  const deckContext = buildDeckRenderContext({
    renderItems,
    width,
    height,
  });
  for (let index = 0; index < renderItems.length; index += 1) {
    const rendered = await renderStructuredSlidePng({
      item: renderItems[index],
      index,
      total: renderItems.length,
      metadata,
      assetPayload,
      fileNamePrefix,
      width,
      height,
      brandKit,
      deckContext,
      carouselStyle,
    });
    qualityReports.push(rendered.quality);
    const url = await uploadRenderedPng({
      fileBuffer: rendered.buffer,
      campaignId: options.campaignId,
      userId: options.userId,
      companyId: options.companyId,
      fileNamePrefix: `${fileNamePrefix}-${index + 1}`,
      metadata: {
        width,
        height,
        preview_kind: fileNamePrefix === 'slider' ? 'slide_deck_page' : fileNamePrefix === 'pdf' ? 'pdf_page_preview' : 'carousel_slide',
        slide_number: index + 1,
        role: renderItems[index].role,
        platform,
        overlay_quality: rendered.quality,
        ...buildCreatorBrandKitMetadata(brandKit, {
          platform,
          overlayConfiguration: {
            ...brandKit.overlayStrategy,
            slide_number: index + 1,
            role: renderItems[index].role,
          },
          exportCapabilities: ['preview', 'download', 'save_as_asset'],
        }),
      },
    });
    const slideOcr = await runCreatorOcr({
      image: rendered.buffer,
      assetType: fileNamePrefix,
      platform,
      attachmentMode: 'embedded_copy',
      mimeType: 'image/png',
    });
    slideOcrResults.push(slideOcr);
    files.push(url);
  }

  // Part 3 — PDF preview + downloadable graceful degradation.
  //
  // Storage layer policies (Supabase bucket MIME allow-list, IAM, transient
  // network failures) can reject the `application/pdf` upload AFTER the
  // page previews have already been uploaded successfully. The renderer
  // must keep:
  //   - `files`        — the per-page PNG previews,
  //   - `preview_kind` — `'pdf_document'`,
  //   - `overlay_*`    — the overlay quality report,
  // intact so the Writer's attached-asset chip still works and the user
  // can SEE every page even when the downloadable PDF link is unavailable.
  //
  // We classify the failure into one of:
  //   - 'storage_mime_blocked' — the storage allow-list rejected `application/pdf`,
  //   - 'storage_permission'   — auth / IAM rejected the write,
  //   - 'storage_unavailable'  — transient (timeout, 5xx, network),
  //   - 'unknown_storage_error' — anything else.
  // The classification + a user-safe message land in the metadata block
  // so the UI can render a precise "preview available, download
  // unavailable" status instead of silently dropping the document URL.
  let documentUrl: string | undefined;
  let documentFallbackReason: string | undefined;
  let documentFallbackCategory: 'storage_mime_blocked' | 'storage_permission' | 'storage_unavailable' | 'unknown_storage_error' | undefined;
  let documentUserMessage: string | undefined;
  if (fileNamePrefix === 'pdf') {
    const pdfBuffer = await createPdfBuffer({
      title: compactText(metadata.topic || renderItems[0]?.headline || fallbackLabel, fallbackLabel),
      items: renderItems,
      brandKit,
      cta: compactText(metadata.cta || renderItems[renderItems.length - 1]?.headline || 'Take the next step'),
    });
    try {
      documentUrl = await uploadRenderedFile({
        fileBuffer: pdfBuffer,
        campaignId: options.campaignId,
        userId: options.userId,
        companyId: options.companyId,
        fileNamePrefix: 'pdf-document',
        extension: 'pdf',
        contentType: 'application/pdf',
      });
    } catch (error) {
      documentFallbackReason = error instanceof Error ? error.message : String(error);
      documentFallbackCategory = classifyPdfStorageFailure(documentFallbackReason);
      documentUserMessage = USER_MESSAGE_FOR_PDF_FALLBACK[documentFallbackCategory];
      // Loud structured log so an operator-side dashboard can pivot on
      // category. Page previews are unaffected.
      console.warn('[creator-asset-renderer][pdf-upload-failed]', {
        message:  documentFallbackReason,
        category: documentFallbackCategory,
        previewPagesAvailable: files.length,
      });
      creatorEvent('pdf_upload', 'fallback', {
        assetType:   'pdf',
        creatorType: 'pdf',
        platform,
        category: documentFallbackCategory,
        message:  documentFallbackReason,
        previewPagesAvailable: files.length,
      });
    }
  }

  // Compute PDF-availability flags. When the document upload failed,
  // exportCapabilities drops 'download' / 'pdf_document' so the UI can
  // render the correct affordances (preview-only, no download button).
  const pdfDownloadAvailable = fileNamePrefix === 'pdf' && Boolean(documentUrl);
  const pdfDownloadAttempted = fileNamePrefix === 'pdf';
  const exportCapabilities = fileNamePrefix === 'pdf'
    ? (pdfDownloadAvailable
        ? ['preview', 'download', 'save_as_asset', 'pdf_document']
        : ['preview', 'save_as_asset', 'pdf_preview_only'])
    : ['preview', 'download', 'save_as_asset'];

  const avgQuality = {
    score: Math.round(qualityReports.reduce((sum, report) => sum + report.score, 0) / Math.max(1, qualityReports.length)),
    flags: Array.from(new Set(qualityReports.flatMap((report) => report.flags))).slice(0, 8),
    text_units: Math.round(qualityReports.reduce((sum, report) => sum + report.text_units, 0) / Math.max(1, qualityReports.length)),
    preset: fileNamePrefix,
  };
  const textBlocks = renderItems.flatMap((item) => [item.headline, item.body]).filter(Boolean);
  // Operator feedback fix: density scoring was producing
  // 'text_density_exceeds_profile' / 'platform_density_mismatch' /
  // 'visual_cleanliness_low' / 'visual_hierarchy_weak' warnings even
  // when each individual slide was within budget. Root cause: the
  // scorer was comparing the SUM of every slide's words against the
  // per-slide cap (`maxWordsPerSlide=34` for carousel). For a 5-slide
  // deck where each slide has ~12 words, the deck total was ~60 which
  // exceeded the per-slide budget by ~1.8×, lighting up every density
  // warning.
  //
  // Fix: evaluate density against a representative single slide
  // (the median, by word count) so the score reflects per-slide
  // composition — which is what `maxWordsPerSlide` was always meant
  // to gate. The full deck text still flows through
  // `estimateTextAreaPercent` for cumulative pixel-coverage signals.
  const perSlideTextBlocks: string[][] = renderItems.map((item) => [item.headline, item.body].filter(Boolean));
  const wordCountOf = (s: string): number => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  const slideWordCounts = perSlideTextBlocks.map((blocks) => blocks.reduce((sum, t) => sum + wordCountOf(t), 0));
  const medianIndex = (() => {
    if (slideWordCounts.length === 0) return 0;
    const ranked = slideWordCounts
      .map((count, idx) => ({ count, idx }))
      .sort((a, b) => a.count - b.count);
    return ranked[Math.floor(ranked.length / 2)].idx;
  })();
  const representativeBlocks = perSlideTextBlocks[medianIndex] ?? [];

  const visualGovernance = validateVisualGovernance({
    assetType: fileNamePrefix,
    platform,
    textBlocks: representativeBlocks,
    hasCTA: renderItems.some((item) => /cta|next step|learn more|book/i.test(`${item.role} ${item.headline} ${item.body}`)),
    textAreaPercent: estimateTextAreaPercent({ textBlocks: representativeBlocks, width, height }),
    paragraphCount: renderItems.filter((item) => item.body.length > 130).length,
    overlapRisk: avgQuality.flags.includes('severe_layout_overflow_risk'),
    tinyTextRisk: avgQuality.flags.includes('headline_likely_unreadable_mobile'),
  });
  const quality = scoreCreatorQuality({
    assetType: fileNamePrefix,
    platform,
    textBlocks: representativeBlocks,
    hasCTA: renderItems.some((item) => /cta|next step|learn more|book/i.test(`${item.role} ${item.headline} ${item.body}`)),
    overlapRisk: avgQuality.flags.includes('severe_layout_overflow_risk'),
    tinyTextRisk: avgQuality.flags.includes('headline_likely_unreadable_mobile'),
  });
  const platformGeometry = resolvePlatformGeometryProfile(platform);
  const geometry = validateLayoutGeometry({
    width,
    height,
    boxes: renderItems.slice(0, 3).map((item, index) => estimateTextBox({
      id: `slide_${index + 1}`,
      text: `${item.headline} ${item.body}`,
      x: platformGeometry.margin,
      y: platformTextBoxY({ platform, index, baseY: 150 }),
      maxWidth: width - platformGeometry.margin * 2,
      fontSize: Math.round((fileNamePrefix === 'slider' ? 28 : 24) * platformGeometry.bodyScale),
      maxLines: 4,
      role: item.role,
    })),
    foreground: '#ffffff',
    background: brandKit.normalizedPalette[0] || '#111827',
    minFontSize: fileNamePrefix === 'pdf' ? 11 : 18,
  });
  const providerTextValidation = {
    ok: slideOcrResults.every((result) => result.ok),
    flags: Array.from(new Set(slideOcrResults.flatMap((result) => result.flags))),
    mode: 'embedded_copy' as const,
    confidence: slideOcrResults.length
      ? Math.min(...slideOcrResults.map((result) => result.confidence))
      : undefined,
    provider: slideOcrResults.find((result) => result.provider !== 'unavailable')?.provider ?? 'unavailable',
  };
  const accessibilityValidation = validateCreatorAccessibility({
    altText: compactText(metadata.topic || renderItems[0]?.headline || fallbackLabel, fallbackLabel),
    readingOrder: renderItems.map((item, index) => `slide_${index + 1}:${item.role}`),
    minFontSize: fileNamePrefix === 'pdf' ? 16 : 18,
    contrastRatio: geometry.contrastRatio,
  });
  const manifest = createRenderManifest({
    rendererId,
    platformProfile: resolvePlatformVisualProfile(platform) as unknown as Record<string, unknown>,
    governanceProfile: resolveAssetGovernanceProfile(fileNamePrefix) as unknown as Record<string, unknown>,
    qualityScore: quality,
    validationResult: visualGovernance,
    ocrResult: providerTextValidation,
    typographySafetyResult: geometry,
    transformIntent: typeof metadata.source_text_transform === 'string' ? metadata.source_text_transform : null,
    exportMetadata: { width, height, item_count: files.length, document_url: documentUrl },
    altText: compactText(metadata.topic || renderItems[0]?.headline || fallbackLabel, fallbackLabel),
    readingOrder: renderItems.map((item, index) => `slide_${index + 1}:${item.role}`),
    accessibilityValidation,
  });
  if (metadata.writer_asset_type || metadata.attachment_mode) assertRenderManifestExportable(manifest);
  const deckValidationManifest = { governance: visualGovernance, ocr: providerTextValidation, geometry, accessibility: accessibilityValidation, final_ocr_results: slideOcrResults };
  void persistCreatorValidationManifest({
    rendererId,
    assetType: fileNamePrefix,
    platform,
    attachmentMode: typeof metadata.attachment_mode === 'string' ? metadata.attachment_mode : 'embedded_copy',
    renderManifest: manifest as unknown as Record<string, unknown>,
    validationManifest: deckValidationManifest as unknown as Record<string, unknown>,
    auditId: typeof metadata.render_audit_id === 'string' ? metadata.render_audit_id : null,
  });

  return {
    url: files[0],
    files,
    metadata: {
      width,
      height,
      generated_by: 'creatorAssetRenderer',
      preview_kind: fileNamePrefix === 'slider' ? 'slide_deck' : fileNamePrefix === 'pdf' ? 'pdf_document' : 'carousel_deck',
      item_count: files.length,
      document_url: documentUrl,
      document_fallback_reason: documentFallbackReason,
      // Part 3 — structured PDF availability block. Clients render:
      //   - pdf_document_status: 'available' | 'preview_only'
      //   - pdf_document_fallback_category: machine-readable bucket
      //   - pdf_document_user_message: ready-to-display copy
      //   - pdf_preview_pages_available: page count regardless of doc status
      pdf_document_status: pdfDownloadAttempted
        ? (pdfDownloadAvailable ? 'available' : 'preview_only')
        : undefined,
      pdf_document_fallback_category: documentFallbackCategory,
      pdf_document_user_message: documentUserMessage,
      pdf_preview_pages_available: pdfDownloadAttempted ? files.length : undefined,
      preview_export_parity: {
        parity_version: 'creator-render-parity-v1',
        brandkit: true,
        typography: true,
        overlay: true,
        logo: true,
        footer_identity: true,
        export_mode: fileNamePrefix === 'pdf' ? (pdfDownloadAvailable ? 'pdf_document' : 'preview_only') : fileNamePrefix,
        verified_at: new Date().toISOString(),
      },
      overlay_renderer: 'deterministic_svg_v1',
      overlay_quality: avgQuality,
      // Per-slide overlay quality reports — additive, so post-render visual
      // validation can validate every slide independently (one failing slide
      // fails the carousel).
      overlay_quality_reports: qualityReports,
      platform_visual_profile: resolvePlatformVisualProfile(platform),
      creator_quality_score: quality,
      visual_governance: visualGovernance,
      visual_governance_warnings: buildPreviewGovernanceWarnings({ validation: visualGovernance, quality }),
      validation_manifest: deckValidationManifest,
      accessibility_manifest: accessibilityValidation,
      final_ocr_results: slideOcrResults,
      render_manifest: manifest,
      renderer_id: rendererId,
      ...buildCreatorBrandKitMetadata(brandKit, {
        platform,
        overlayConfiguration: {
          ...brandKit.overlayStrategy,
          item_count: files.length,
          asset_type: fileNamePrefix,
        },
        exportCapabilities,
      }),
    },
  };
}

