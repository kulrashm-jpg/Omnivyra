/** Part 8/10 of creatorAssetRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { type RenderedMediaBundle, type RenderOptions, safeObject, blueprintIdForRender, curatedDesignTemplate, resolveInfographicRenderStyle, compactText, normalizeOverlayText } from './creatorAssetRendererContracts';
import { composeStructuredDeckAsset } from './creatorAssetRendererCarousel';

export async function renderCarouselAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
): Promise<RenderedMediaBundle> {
  return composeStructuredDeckAsset(assetPayload, options, items, 'Creator carousel asset', 'carousel', getCreatorRendererRegistration('carousel').rendererId);
}

export async function renderPdfAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
): Promise<RenderedMediaBundle> {
  return composeStructuredDeckAsset(assetPayload, options, items, 'Creator PDF asset', 'pdf', getCreatorRendererRegistration('pdf').rendererId);
}

export async function renderSliderAsset(
  assetPayload: Record<string, unknown>,
  options: RenderOptions,
  items: Array<Record<string, unknown>>,
): Promise<RenderedMediaBundle> {
  return composeStructuredDeckAsset(assetPayload, options, items, 'Creator slider asset', 'slider', getCreatorRendererRegistration('slider').rendererId);
}

type InfographicSection = {
  title: string;
  body: string;
  icon: string;
};

/**
 * CREATOR-114 — canonical content planner. The SAMPLE's semantic structure decides WHICH
 * and HOW MANY slots exist (3 KPIs for stats, 4 steps for process, 2 sides for
 * comparison…). The brief fills the slots in order; missing slots degrade to a neutral
 * placeholder (never a different block type). The renderer renders EXACTLY these slots —
 * it never invents extra generic sections. The LLM (composeInfographicCopy) enriches the
 * slot text downstream; it does not change the count or the structure.
 */
/**
 * A section heading must never render as the bare asset-type word ("Infographic")
 * or the raw topic — that reads as an unfinished placeholder. When the source
 * title is empty or such a placeholder, derive a real heading from the section
 * body (its first clause), falling back to a clean ordinal.
 */
function resolveSectionHeading(rawTitle: string, body: string, topic: string, index: number): string {
  const t = rawTitle.trim();
  const cleanTopic = topic.trim();
  const isPlaceholder =
    !t ||
    /^infographics?$/i.test(t) ||
    (!!cleanTopic && t.toLowerCase() === cleanTopic.toLowerCase());
  if (!isPlaceholder) return t;
  const b = String(body || '').trim();
  if (b) {
    const firstClause = b.split(/[.:;—\n]/)[0].trim();
    if (firstClause.length >= 6 && firstClause.length <= 48) return firstClause;
    const words = b.split(/\s+/).slice(0, 6).join(' ').replace(/[,:;]+$/, '').trim();
    if (words.length >= 6) return words.slice(0, 48);
  }
  return `Key point ${index + 1}`;
}

export function planInfographicContent(briefSections: InfographicSection[], slotCount: number, topic: string): InfographicSection[] {
  const out: InfographicSection[] = [];
  for (let i = 0; i < slotCount; i++) {
    const src = briefSections[i];
    out.push({
      title: resolveSectionHeading(String(src?.title || ''), String(src?.body || ''), topic, i),
      body: src?.body || '',
      icon: ['01', '02', '03', '04', '05', '06', '07', '08'][i] ?? String(i + 1).padStart(2, '0'),
    });
  }
  return out;
}

export function resolveInfographicSections(assetPayload: Record<string, unknown>, metadata: Record<string, unknown>): InfographicSection[] {
  const overlay = normalizeOverlayText({
    assetPayload,
    metadata,
    title: String(metadata.topic || 'Infographic'),
    body: String(metadata.summary || ''),
  });
  const rawTransform = safeObject(metadata.thread_visual_transform);
  const transformItems = Array.isArray(rawTransform.items)
    ? rawTransform.items.map((item) => compactText(item, '')).filter(Boolean)
    : [];
  const rawSource = transformItems.length > 0
    ? transformItems
    : [overlay.hook, overlay.headline, overlay.keyInsight, overlay.supportingText].filter(Boolean);
  // Dedupe near-identical items so a sparse overlay (e.g. hook===headline===
  // topic) doesn't yield two identical cards. Key on the normalized prefix.
  const seen = new Set<string>();
  const source = rawSource.filter((item) => {
    const key = compactText(item, '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const clipped = source.slice(0, 6).map((item, index) => {
    // Only split title/body on an explicit "Label: detail" form. Without a
    // colon, the item is the TITLE and the body is left empty so the copy
    // composer's lead fills it — never duplicate the title verbatim as body
    // (the previous behavior rendered the same sentence twice per card).
    const hasColon = item.includes(':');
    return {
      title: compactText(hasColon ? item.split(':')[0] : item, `Section ${index + 1}`).slice(0, 52),
      body: hasColon ? compactText(item.split(':').slice(1).join(':'), '').slice(0, 120) : '',
      icon: ['01', '02', '03', '04', '05', '06'][index] ?? String(index + 1).padStart(2, '0'),
    };
  });
  // A sparse overlay (hook≈headline≈topic) collapses to 1-2 cards, leaving most of
  // the canvas empty. Pad to a MINIMUM of 4 sections with standard explainer aspects
  // so the layout is a full grid; the copy composer fills each with topic-adaptive
  // content (bullets/impact/example), so these are real cards, not blank padding.
  const MIN_SECTIONS = 4;
  const DEFAULT_ASPECTS = ['The core idea', 'Why it matters', 'How to apply it', 'What to watch for'];
  const base = clipped.length > 0 ? clipped : [{ title: 'The core idea', body: '', icon: '01' }];
  const usedTitles = new Set(base.map((s) => s.title.toLowerCase().trim()));
  for (let i = 0; base.length < MIN_SECTIONS && i < DEFAULT_ASPECTS.length; i++) {
    const title = DEFAULT_ASPECTS[i];
    if (usedTitles.has(title.toLowerCase())) continue;
    usedTitles.add(title.toLowerCase());
    base.push({ title, body: '', icon: ['01', '02', '03', '04', '05', '06'][base.length] ?? String(base.length + 1).padStart(2, '0') });
  }
  return base;
}

const INFOGRAPHIC_LAYOUTS = ['stats', 'comparison', 'process', 'framework', 'hierarchy', 'timeline'] as const;

/**
 * Pick a layout that VARIES per infographic so a campaign's infographics don't all look
 * like the same 2×2 grid (operator feedback: "different format and style each time").
 * First honour the content — a comparison/process/timeline/stats/hierarchy topic gets the
 * matching engine (each uses genuinely different visual elements: graphs & donuts, a
 * milestone rail, numbered steps, two-column, indented tiers). When the topic doesn't
 * imply one, rotate deterministically by a hash of the topic, so different topics land on
 * different layouts while the SAME topic always re-renders identically.
 */
// With the two-pass content-fit (masonry + 2-column bullets) pass, every engine now renders
// dense, so generic topics rotate across the FULL set for maximum format variety.
const GENERIC_INFOGRAPHIC_ROTATION = ['stats', 'framework', 'process', 'timeline', 'hierarchy', 'comparison'] as const;

/**
 * STRONG content→engine signal: a keyword match that clearly implies a specific engine.
 * Returns null when the content gives no strong structural cue (caller decides the fallback).
 * Keyword-only — no hash — so it is safe to let this OVERRIDE an aesthetic template's layout.
 */
export function contentImpliedInfographicLayout(text: string): string | null {
  const t = String(text || '').toLowerCase();
  if (/\bvs\b|versus|compare|comparison|pros?\s*(and|&|vs)?\s*cons|before\s*(and|&)?\s*after/.test(t)) return 'comparison';
  if (/\bsteps?\b|step[-\s]?by[-\s]?step|how\s*to|workflow|stages?\b|playbook|checklist/.test(t)) return 'process';
  if (/timeline|roadmap|history|evolution|journey|over\s*time|milestones?\b/.test(t)) return 'timeline';
  if (/hierarchy|tiers?\b|pyramid|maturity\s*(model|levels?)/.test(t)) return 'hierarchy';
  if (/\d+\s*%|\bkpi\b|by the numbers|statistics?\b|benchmark/.test(t)) return 'stats';
  return null;
}

export function pickVariedInfographicLayout(topic: string): string {
  const t = String(topic || '').toLowerCase();
  // Content-appropriate engine first; only fall to the deterministic rotation when the content
  // gives no structural cue (so generic topics still vary instead of always 'framework').
  const implied = contentImpliedInfographicLayout(t);
  if (implied) return implied;
  let h = 0;
  for (let i = 0; i < t.length; i += 1) h = (Math.imul(h, 31) + t.charCodeAt(i)) >>> 0;
  return GENERIC_INFOGRAPHIC_ROTATION[h % GENERIC_INFOGRAPHIC_ROTATION.length];
}

/** All the text the layout picker should consider — topic + summary + section labels. */
function infographicContentText(metadata: Record<string, unknown>): string {
  const card = safeObject(metadata.creator_card);
  const parts: string[] = [
    String(metadata.topic || card.topic || ''),
    String(metadata.summary || card.summary || ''),
  ];
  const sections = metadata.infographic_sections ?? card.infographic_sections;
  if (Array.isArray(sections)) {
    for (const s of sections.slice(0, 12)) {
      const so = safeObject(s);
      parts.push(String(so.label ?? so.title ?? so.heading ?? ''), String(so.value ?? ''));
    }
  }
  return parts.filter(Boolean).join(' ');
}

export function resolveInfographicLayout(metadata: Record<string, unknown>): string {
  const contentText = infographicContentText(metadata);
  // CREATOR-127: a resolved curated TEMPLATE drives the layout directly (no blueprint).
  // FIDELITY (item 3b): curated templates hardcode a layout by AESTHETIC (e.g. Luxury→hierarchy).
  // Decouple structure from look — when the CONTENT strongly implies a specific engine (keyword
  // signal, not the generic hash), that wins over the template's hardcoded layout; the template's
  // aesthetic STYLE still applies via resolveInfographicRenderStyle. Otherwise the template layout.
  const dt = curatedDesignTemplate(metadata);
  if (dt?.renderingContract.infographicLayout) {
    return contentImpliedInfographicLayout(contentText) ?? dt.renderingContract.infographicLayout;
  }
  // CREATOR-106 (RULE 4): once a Marketing Sample is chosen, the SAMPLE determines the
  // layout structure — different samples produce genuinely different layout engines.
  const bp = blueprintIdForRender(metadata);
  if (bp) return infographicLayoutForBlueprint(bp);
  // RULE 7: blueprint_id == null. Honour an explicit per-asset layout when the generator
  // set one; otherwise pick a VARIED, content-aware layout from ALL the content (item 3c:
  // topic + summary + section labels, not just the topic — so AI/programmatic paths that
  // set no layout get a content-fit engine, not an arbitrary topic hash).
  const requested = String(metadata.infographic_layout || safeObject(metadata.creator_card).infographic_layout || '').trim().toLowerCase();
  if ((INFOGRAPHIC_LAYOUTS as readonly string[]).includes(requested)) return requested;
  return pickVariedInfographicLayout(contentText);
}

export function validateInfographicDensity(
  sections: Array<InfographicSection & { bullets?: unknown; impact?: unknown; example?: unknown; take?: unknown }>,
): { ok: boolean; flags: string[]; contentTooThin: boolean } {
  const flags: string[] = [];
  // Density (too MUCH) stays a per-card overflow signal → title + body only, as before.
  const bodyChars = sections.reduce((sum, section) => sum + section.title.length + section.body.length, 0);
  if (sections.length > 6) flags.push('too_many_sections');
  if (bodyChars > 760) flags.push('text_density_exceeds_infographic_bounds');
  if (sections.some((section) => section.body.length > 140)) flags.push('section_body_too_long');
  // WATCHDOG (inverse of density): a near-EMPTY infographic renders as a title over
  // mostly-blank canvas. Measure the FULL content the renderer actually draws — body/
  // lead + bullets + impact + example + take — so a rich "busy" card is never
  // mis-flagged as thin, while a genuinely sparse card is caught.
  const strLen = (v: unknown): number => (typeof v === 'string' ? v.length : 0);
  const richChars = sections.reduce<number>((sum, section) => {
    const bulletsLen = Array.isArray(section.bullets)
      ? (section.bullets as unknown[]).reduce<number>((n, b) => n + strLen(b), 0)
      : 0;
    return sum + section.title.length + section.body.length + bulletsLen + strLen(section.impact) + strLen(section.example) + strLen(section.take);
  }, 0);
  const contentTooThin = richChars < 260;
  if (contentTooThin) flags.push('infographic_content_too_thin');
  return { ok: flags.length === 0, flags, contentTooThin };
}

/**
 * Operator feedback fix: cards were rendering at ~220px tall in the
 * top quarter of a 1200px canvas — leaving ~70% of the canvas empty
 * white space. Every layout below now SIZES TO FILL the safe area
 * between the header band (top ~140px) and the bottom margin
 * (~80px), giving each card real visual presence instead of looking
 * like dropped text boxes.
 *
 * Formula: `availableH = height - headerH - bottomH`. Cards are then
 * `floor((availableH - gap*(rows-1)) / rows)` tall. With 4 stat cards
 * laid out as 2×2 on a 1200×1200 canvas → each card ~460px tall.
 * Same math applies to every layout.
 */
export function resolveInfographicEngine(input: {
  layout: string;
  width: number;
  height: number;
  sectionCount: number;
  headerH?: number;
  /** Resolved from the template style's spacing; default to prior literals. */
  sideMargin?: number;
  bottomMargin?: number;
  /** Per-layout engine geometry (gaps / minimums / offsets). Default == prior literals. */
  geometry?: InfographicEngineGeometry;
  /** CREATOR-107: sample-composition geometry. When a blueprint is selected the grid
   *  columns + spacing come from the SAMPLE, so same-engine samples still differ.
   *  Both undefined (blueprint_id == null) → prior generic geometry, byte-identical. */
  columnsOverride?: number;
  gapScale?: number;
  /** CREATOR-116: role-derived max card height. Cards are capped at this and the grid is
   *  centered in the available area, so a concise role (a KPI) renders compact instead of
   *  stretching to legacy paragraph height. undefined → fill the canvas (prior behavior). */
  maxCardHeight?: number;
}): {
  engineId: string;
  cardWidth: number;
  cardHeight: number;
  /** Grid rows + the vertical gap between them + the layout's card-height floor —
   *  exposed so the caller can derive a content-fit canvas height (≈10% white space). */
  rows: number;
  rowGap: number;
  minCardHeight: number;
  position: (index: number) => { x: number; y: number; iconZone: 'left' | 'top' | 'center' };
} {
  const count = Math.max(1, input.sectionCount);
  const headerH = input.headerH ?? 150;
  const bottomMargin = input.bottomMargin ?? 90;
  const sideMargin = input.sideMargin ?? 80;
  const geom = input.geometry ?? DEFAULT_INFOGRAPHIC_STYLE.geometry.engine;
  const gs = typeof input.gapScale === 'number' && input.gapScale > 0 ? input.gapScale : 1; // CREATOR-107
  const availableH = input.height - headerH - bottomMargin;
  const availableW = input.width - sideMargin * 2;
  // CREATOR-116: cap the filled card height at the role's preferred max and vertically
  // center the grid (extra space becomes balanced margin, not stretched cards).
  const capCenter = (rawCardH: number, rows: number, gap: number): { cardH: number; vOff: number } => {
    const cardH = input.maxCardHeight && input.maxCardHeight > 0 ? Math.min(rawCardH, input.maxCardHeight) : rawCardH;
    const vOff = Math.max(0, Math.floor((availableH - (rows * cardH + gap * Math.max(0, rows - 1))) / 2));
    return { cardH, vOff };
  };

  if (input.layout === 'timeline') {
    const g = geom.timeline;
    const rows = count;
    const gap = g.gap * gs;
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    return {
      engineId: 'infographic-timeline-engine-v2',
      cardWidth: availableW - g.railOffset,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      position: (index) => ({ x: sideMargin + g.railOffset, y: headerH + vOff + index * (cardH + gap), iconZone: 'left' }),
    };
  }
  if (input.layout === 'process') {
    const g = geom.process;
    const rows = count;
    const gap = g.gap * gs; // bigger gap so the arrow connectors have room to breathe
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    return {
      engineId: 'infographic-process-engine-v2',
      cardWidth: availableW,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      position: (index) => ({ x: sideMargin, y: headerH + vOff + index * (cardH + gap), iconZone: 'left' }),
    };
  }
  if (input.layout === 'comparison') {
    const g = geom.comparison;
    const rows = Math.max(1, Math.ceil(count / 2));
    const gap = g.gap * gs;
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    const colW = Math.floor((availableW - g.columnGap) / 2);
    return {
      engineId: 'infographic-comparison-engine-v2',
      cardWidth: colW,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      position: (index) => ({
        x: sideMargin + (index % 2) * (colW + g.columnGap),
        y: headerH + vOff + Math.floor(index / 2) * (cardH + gap),
        iconZone: 'top',
      }),
    };
  }
  if (input.layout === 'stats') {
    const g = geom.stats;
    // 1-2 sections → single row; 3 → 3-col row; 4 → 2×2; 5-6 → 3×2.
    // CREATOR-107: the sample's composition column count overrides the generic grid.
    const cols = input.columnsOverride && count > 1
      ? Math.max(1, Math.min(input.columnsOverride, count))
      : (count <= 2 ? count : count === 3 ? 3 : count === 4 ? 2 : 3);
    const rows = Math.max(1, Math.ceil(count / cols));
    const gapX = g.gapX * gs;
    const gapY = g.gapY * gs;
    const colW = Math.floor((availableW - gapX * (cols - 1)) / cols);
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gapY * (rows - 1)) / rows)), rows, gapY);
    return {
      engineId: 'infographic-stats-engine-v2',
      cardWidth: colW,
      cardHeight: cardH,
      rows, rowGap: gapY, minCardHeight: g.minCardHeight,
      position: (index) => ({
        x: sideMargin + (index % cols) * (colW + gapX),
        y: headerH + vOff + Math.floor(index / cols) * (cardH + gapY),
        iconZone: 'center',
      }),
    };
  }
  if (input.layout === 'hierarchy') {
    const g = geom.hierarchy;
    const rows = count;
    const gap = g.gap * gs;
    const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gap * (rows - 1)) / rows)), rows, gap);
    return {
      engineId: 'infographic-hierarchy-engine-v2',
      cardWidth: availableW - g.widthInset,
      cardHeight: cardH,
      rows, rowGap: gap, minCardHeight: g.minCardHeight,
      // Subtle right-indent per step communicates downward flow.
      position: (index) => ({
        x: sideMargin + Math.min(index, g.maxIndentSteps) * g.indentStep,
        y: headerH + vOff + index * (cardH + gap),
        iconZone: 'left',
      }),
    };
  }
  // framework (default) — pillar grid filling the canvas.
  const g = geom.framework;
  // CREATOR-107: the sample's composition column count overrides the generic 2-col grid.
  const cols = count === 1 ? 1 : (input.columnsOverride ? Math.max(1, Math.min(input.columnsOverride, count)) : 2);
  const rows = Math.max(1, Math.ceil(count / cols));
  const gapX = g.gapX * gs;
  const gapY = g.gapY * gs;
  const colW = Math.floor((availableW - gapX * (cols - 1)) / cols);
  const { cardH, vOff } = capCenter(Math.max(g.minCardHeight, Math.floor((availableH - gapY * (rows - 1)) / rows)), rows, gapY);
  return {
    engineId: 'infographic-framework-engine-v2',
    cardWidth: colW,
    cardHeight: cardH,
    rows, rowGap: gapY, minCardHeight: g.minCardHeight,
    position: (index) => ({
      x: sideMargin + (index % cols) * (colW + gapX),
      y: headerH + vOff + Math.floor(index / cols) * (cardH + gapY),
      iconZone: 'left',
    }),
  };
}

/**
 * Deterministically estimate the pixel height `renderDenseBody` will consume for a
 * section's composed content (lead + bullets + impact/risk + example/take), at the
 * given content width. Mirrors the block-by-block flow in renderDenseBody so the
 * caller can size cards + canvas to the content (≈10% white-space target) instead of
 * stretching a fixed grid. Approximate line-wrap (ceil(len/cpl)); the padding margin
 * absorbs the small error, biased toward slight over-estimate (breathing room, not
 * truncation).
 */
export function estimateDenseBodyHeight(
  s: Record<string, unknown>,
  contentWidth: number,
  style: InfographicStyleSchema,
  fontMul: number,
): number {
  const db = style.geometry.denseBody;
  const r = Math.round;
  const leadSize = r(db.leadSize * fontMul);
  const bulletSize = r(db.bulletSize * fontMul);
  const valSize = r(db.valueSize * fontMul);
  const cpl = (fontPx: number, w: number): number => Math.max(8, Math.floor(w / (fontPx * db.charWidthFactor)));
  const wrap = (text: unknown, fontPx: number, w: number, maxLines: number): number => {
    const t = String(text ?? '').trim();
    if (!t) return 0;
    return Math.min(maxLines, Math.max(1, Math.ceil(t.length / cpl(fontPx, w))));
  };
  let h = 0;
  const stat = s.stat as { value?: unknown } | null | undefined;
  if (stat && String(stat.value ?? '').trim()) h += r(valSize * db.statChipHeightMul) + db.gapAfterStat;
  const lead = String((s as { body?: unknown }).body ?? '').trim();
  if (lead) h += wrap(lead, leadSize, contentWidth, db.leadMaxLines) * r(leadSize * db.leadLineHeightMul) + db.gapAfterLead;
  const bullets = (Array.isArray(s.bullets) ? s.bullets : []).map((b) => String(b ?? '').trim()).filter((b) => b.length >= 4);
  const bulletLineH = r(bulletSize * db.bulletLineHeightMul);
  // Mirror renderDenseBody's 2-column bullets for WIDE cards, else the estimate over-counts
  // bullet height and the card gets a vertical void back.
  const twoCol = contentWidth >= 640 && bullets.length >= 3;
  if (twoCol) {
    const colW = Math.floor((contentWidth - 28) / 2);
    const each = bullets.map((b) => wrap(b, bulletSize, colW - (db.bulletTextIndent + 2), db.bulletMaxLines) * bulletLineH + db.detail.bulletInterGap);
    const half = Math.ceil(each.length / 2);
    const leftH = each.slice(0, half).reduce((a, b) => a + b, 0);
    const rightH = each.slice(half).reduce((a, b) => a + b, 0);
    h += Math.max(leftH, rightH);
  } else {
    for (const b of bullets) {
      h += wrap(b, bulletSize, contentWidth - (db.bulletTextIndent + 2), db.bulletMaxLines) * bulletLineH + db.detail.bulletInterGap;
    }
  }
  const impact = String(s.impact ?? '').trim();
  const risk = String(s.risk ?? '').trim();
  if (impact || risk) {
    const twoUp = Boolean(impact && risk && contentWidth > db.panelTwoUpMinWidth);
    const panelW = twoUp ? Math.floor((contentWidth - db.panelGap) / 2) : contentWidth;
    const innerW = panelW - db.panelInnerInset;
    const valLineH = r(valSize * db.panelValueLineHeightMul);
    const maxLines = Math.max(impact ? wrap(impact, valSize, innerW, db.panelMaxLines) : 0, risk ? wrap(risk, valSize, innerW, db.panelMaxLines) : 0, 1);
    h += db.gapBeforePanels + db.panelHeightBase + maxLines * valLineH + db.panelHeightPad;
  }
  const example = String(s.example ?? '').trim();
  const take = String(s.take ?? '').trim();
  if (example || take) {
    const valLineH = r(valSize * db.footerValueLineHeightMul);
    const lines = wrap(example || take, valSize, contentWidth - db.footerInnerInset, db.footerMaxLines);
    h += db.gapBeforeFooter + db.footerHeightBase + lines * valLineH + db.footerHeightPad;
  }
  return h;
}

