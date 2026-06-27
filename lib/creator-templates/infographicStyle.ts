/**
 * Infographic visual-language schema — the INFOGRAPHIC FAMILY implementation
 * of the canonical Creator Template domain (see ./types.ts).
 *
 * This is the consolidated home of the infographic visual language. It used
 * to live in a second, infographic-only template model
 * (`backend/services/creator/infographicTemplate*`); that duplicate is
 * removed and its visual-language content now lives here, inside the single
 * canonical Template domain, attached to infographic-family templates via
 * `CreatorTemplate.infographicStyle`.
 *
 * A style describes ONLY visual language (color, typography, spacing, and the
 * per-element style of cards, connectors, icons, charts, decorations). It
 * NEVER carries content. Pure data + types — client- and server-safe, no I/O.
 *
 * The `DEFAULT_INFOGRAPHIC_STYLE` is a faithful DATA mirror of the constants
 * the production renderer hardcodes in
 * `backend/services/creatorAssetRenderer.ts → renderInfographicAsset` (and the
 * chart constants in `infographicDataCards.ts`). Nothing consumes it yet, so
 * production output is byte-identical; it is the contract a future wiring pass
 * must reproduce exactly.
 */

/* ── Supported infographic layouts (the renderer's layout set) ──────── */

export const INFOGRAPHIC_LAYOUTS = [
  'framework',
  'process',
  'timeline',
  'comparison',
  'hierarchy',
  'stats',
] as const;
export type InfographicLayout = (typeof INFOGRAPHIC_LAYOUTS)[number];

/* ── Style sub-schemas (pure visual language) ───────────────────────── */

export type GradientStop = { offset: number; color: 'backgroundBase' | 'accent'; opacity: number };
export type GradientSpec = { direction: 'vertical' | 'horizontal' | 'diagonal'; stops: GradientStop[] };

export type InfographicColorScheme = {
  backgroundBase: string;
  accent: string;
  panel: string;
  innerPanel: string;
  primaryText: string;
  bodyText: string;
  tinyLabelText: string;
  seriesRamp: string[];
  backgroundMode: 'gradient' | 'image';
  gradients: { background: GradientSpec; header: GradientSpec; wave: GradientSpec };
};

export type InfographicTypography = {
  fontFamily: string;
  baseSizes: { headerTitle: number; cardTitle: number; lead: number; bullet: number; label: number; value: number };
  fontMultiplierScale: Array<{ maxSectionChars: number; multiplier: number }>;
};

export type InfographicSpacing = {
  sideMargin: number;
  bottomMargin: number;
  headerHeight: number;
  headerHeightWithSubtitle: number;
};

export type InfographicCardStyle = {
  cornerRadius: number;
  fill: 'panel';
  fillOpacity: number;
  accentStripeWidth: number;
  accentStripeRadius: number;
};

export type InfographicConnectorStyle = {
  process: { strokeWidth: number; arrowHead: boolean };
  timeline: { railStrokeWidth: number; railOpacity: number; dotRadius: number };
};

export type InfographicIconStyle = {
  kind: 'concept_glyph';
  glyphFill: string;
  discFillsFromAccent: boolean;
  discRadiusRatio: number;
};

/** Deterministic chart-card plot geometry (bar/line/pie/donut/table) +
 *  shared title/plot. Runtime-data-derived values stay in the builder. */
export type InfographicChartGeometry = {
  minFontSize: number;
  title: { sizeBase: number; xInset: number; yInset: number; charFactor: number; widthInset: number; bottomGap: number; emptyBottomY: number };
  plot: { padL: number; padR: number; padB: number; yGap: number; min: number };
  bar: { gapMin: number; gapRatio: number; barWMin: number; labelSizeBase: number; axisOpacity: number; axisStrokeWidth: number; headroom: number; valueLabelYOffset: number; xLabelYOffset: number; labelCharFactor: number; labelCharPad: number };
  line: { usableHeadroom: number; pointRadius: number; lineStrokeWidth: number; pointStrokeWidth: number; labelSizeBase: number; valueLabelYOffset: number; xLabelYOffset: number; labelMaxChars: number; valueLabelMaxPoints: number; axisOpacity: number; axisStrokeWidth: number };
  pie: { zoneRatio: number; rMin: number; rPad: number; cxPad: number; legendXGap: number; rowHMin: number; legendSizeBase: number; legendStartYRatio: number; swatchRx: number; swatchYOffset: number; labelGap: number; labelInsetSub: number; labelCharFactor: number; labelCharPad: number };
  table: { padL: number; padR: number; padB: number; gridTopGap: number; rowHMin: number; rowHMax: number; headerSizeBase: number; cellSizeBase: number; charFactor: number; charInset: number; headerRx: number; headerOpacity: number; textInset: number; headerTextYRatio: number; cellTextYRatio: number; zebraOpacity: number; separatorOpacity: number; separatorWidth: number };
  weights: { chartTitle: string; barValue: string; barLabel: string; lineValue: string; lineLabel: string; legend: string; tableHeader: string; tableCell: string };
};

export type InfographicChartStyle = {
  barCornerRadius: number;
  donutHoleRatio: number;
  maxDataPoints: number;
  seriesFromBrand: boolean;
  geometry: InfographicChartGeometry;
};

export type InfographicDecorationStyle = {
  wave: { enabled: boolean; strokeWidthRatio: number };
  ambientFill: { enabled: boolean; opacity: number };
  ctaFooter: {
    enabled: boolean;
    treatment: 'pill_band';
    /** Horizontal inset of the band on each side. */
    inset: number;
    /** Band height. */
    bandHeight: number;
    /** Band top measured from the canvas bottom (height - bandBottomOffset). */
    bandBottomOffset: number;
    cornerRadius: number;
    opacity: number;
    /** CTA text base font size (scaled by the adaptive multiplier). */
    fontSize: number;
    /** CTA text baseline from the canvas bottom (height - textBottomOffset). */
    textBottomOffset: number;
  };
  /** Inner safe panel that the cards float on. */
  innerPanel: { inset: number; topOffset: number; cornerRadius: number; opacity: number };
};

/** Per-layout engine geometry — section gaps, minimum card heights, and the
 *  layout-specific offsets/insets. Dynamic card sizing (fill-to-canvas math)
 *  stays in the renderer; these are the deterministic seed constants. */
export type InfographicEngineGeometry = {
  timeline: { gap: number; minCardHeight: number; railOffset: number };
  process: { gap: number; minCardHeight: number };
  comparison: { gap: number; minCardHeight: number; columnGap: number };
  stats: { gapX: number; gapY: number; minCardHeight: number };
  hierarchy: { gap: number; minCardHeight: number; widthInset: number; indentStep: number; maxIndentSteps: number };
  framework: { gapX: number; gapY: number; minCardHeight: number };
};

/** Dense-body composition geometry (lead + bullets + stat chip + impact/risk
 *  panels + footer). Base font sizes are scaled by the adaptive multiplier;
 *  line-wrap counts depend on runtime content and stay in the renderer. */
export type InfographicDenseBodyGeometry = {
  leadSize: number;
  bulletSize: number;
  labelSize: number;
  valueSize: number;
  charWidthFactor: number;
  leadLineHeightMul: number;
  bulletLineHeightMul: number;
  panelValueLineHeightMul: number;
  footerValueLineHeightMul: number;
  leadMaxLines: number;
  bulletMaxLines: number;
  panelMaxLines: number;
  footerMaxLines: number;
  statChipHeightMul: number;
  statValueFontMul: number;
  statValueCharWidthMul: number;
  bulletDotX: number;
  bulletDotRadius: number;
  bulletTextIndent: number;
  bulletDotCyMul: number;
  gapAfterStat: number;
  gapAfterLead: number;
  gapBeforePanels: number;
  gapBeforeFooter: number;
  panelTwoUpMinWidth: number;
  panelGap: number;
  panelInnerInset: number;
  panelLabelY: number;
  panelValueStartY: number;
  panelHeightBase: number;
  panelHeightPad: number;
  footerInnerInset: number;
  footerLabelY: number;
  footerValueStartY: number;
  footerHeightBase: number;
  footerHeightPad: number;
  offsetYCap: number;
  /** Render-detail (radii, opacities, weights, letter-spacing, text insets,
   *  label fit factor, panel accent colors). */
  detail: {
    statChipRx: number; statChipOpacity: number; statValueYMul: number; statLabelYMul: number; statValueX: number; statLabelInset: number; labelCharFactor: number;
    panelRx: number; panelStripeWidth: number; panelStripeRx: number; panelOpacity: number; panelTextInset: number; panelLabelSpacing: number;
    footerRx: number; footerOpacity: number; footerTextInset: number; footerLabelSpacing: number;
    impactColor: string; riskColor: string;
    leadWeight: string; bulletWeight: string; panelLabelWeight: string; panelValueWeight: string; statValueWeight: string; statLabelWeight: string;
    footerLabelWeight: string; footerExampleWeight: string; footerTakeWeight: string;
    bulletInterGap: number;
  };
};

/** Decorative continuity wave geometry (control-point + endpoint ratios). */
export type InfographicWaveGeometry = {
  topOffset: number;
  exitYRatio: number;
  cpAYRatio: number;
  cpBYRatio: number;
  startXInset: number;
  cpAXRatio: number;
  cpBXRatio: number;
  endXInset: number;
};

/** Per-layout card-element geometry (header bands, badges, title baselines,
 *  dot/rail, indent visuals). Font sizes are bases scaled by the adaptive
 *  multiplier in the renderer; body inset/heights feed the dense-body block. */
export type InfographicLayoutGeometry = {
  process: {
    bandRx: number; bandOpacity: number;
    badgeRadiusRatio: number; badgePanelWMul: number; badgeNumYRatio: number; badgeNumFontRatio: number;
    connectorHeight: number; connectorArrowGap: number; connectorArrowHalfW: number; connectorTipExt: number;
    connectorStrokeWidth: number; connectorOpacity: number;
    labelX: number; labelY: number; labelFont: number; labelSpacing: number;
    titleX: number; titleY: number; titleFontMul: number;
    bodyX: number; bodyY: number; bodyWidthInset: number; bodyHeightInset: number;
  };
  comparison: {
    bandRx: number; bandHeight: number; bandOpacity: number;
    labelX: number; labelY: number; labelFont: number; labelSpacing: number;
    bodyX: number; bodyY: number; bodyWidthInset: number; bodyHeightInset: number;
  };
  timeline: {
    dotXOffset: number; dotYOffset: number; dotRadius: number; dotStrokeWidth: number;
    labelX: number; labelY: number; labelFont: number; labelSpacing: number;
    titleX: number; titleY: number; bodyX: number; bodyY: number; bodyWidthInset: number; bodyHeightInset: number;
    railXOffset: number; railTopPad: number; railBottomPad: number; railStrokeWidth: number; railOpacity: number;
  };
  hierarchy: {
    numX: number; numY: number; numFont: number;
    titleX: number; titleY: number; bodyX: number; bodyY: number; bodyWidthInset: number; bodyHeightInset: number;
  };
  framework: {
    bandRx: number; bandHeight: number; bandOpacity: number;
    labelX: number; labelY: number; labelFont: number; labelSpacing: number;
    titleX: number; titleY: number; bodyX: number; bodyY: number; bodyWidthInset: number; bodyHeightInset: number;
  };
  /** Stats numeric visuals (donut / bar / dot pictogram). The textless
   *  concept-card variant keeps its own composition. */
  stats: {
    titleFont: number; bodyFont: number; bodyLineHeightMul: number; bodyWidthInset: number; bodyBottomPad: number;
    donut: {
      yOffset: number; radiusRatio: number; strokeMin: number; strokeRatio: number; trackOpacity: number;
      statYRatio: number; statFontMin: number; statFontRatio: number; titleGap: number; bodyGap: number;
    };
    bar: {
      numeralYRatio: number; numeralFontHRatio: number; numeralFontWRatio: number;
      widthInset: number; height: number; xInset: number; yRatio: number; trackOpacity: number;
      fillBase: number; fillIndexStep: number; titleGap: number; bodyGap: number;
    };
    dot: {
      count: number; radiusMin: number; radiusRatio: number; gapMul: number; yRatio: number; emptyOpacity: number;
      ratioFontHRatio: number; ratioFontWRatio: number; ratioYRatio: number; filledBase: number; titleGap: number; bodyGap: number;
    };
  };
  ambient: { inset: number; opacity: number; cornerRadius: number };
};

/** Shared text weights + the white foreground used by badges/markers. */
export type InfographicTextStyle = {
  labelWeight: string; titleWeight: string; numeralWeight: string; bodyWeight: string; panelValueWeight: string; takeWeight: string; whiteFg: string;
};

/** Concept-glyph silhouette ratios (consumed by renderConceptGlyph). Every
 *  value is a multiple of the glyph `size`; the renderer only plugs them into
 *  the fixed path templates — no shape logic. */
export type InfographicGlyphGeometry = {
  lightbulb: {
    r: number; topDy: number;
    c1: [number, number, number, number, number, number]; lDx: number;
    c2: [number, number, number, number, number, number];
    b1: [number, number, number, number, number]; b2: [number, number, number, number, number];
  };
  target: { r1: number; sw1: number; r2: number; sw2: number; r3: number };
  arrow: { tip: number; p1y: number; p2x: number; p3y: number; p4y: number; sw: number; headBackX: number; headY: number; headTipY: number };
  check: { p1x: number; p1y: number; p2x: number; p2y: number; p3x: number; p3y: number; sw: number };
  bolt: [number, number, number, number, number, number, number, number, number, number, number, number];
  gear: { teeth: number; outerR: number; innerR: number; discR: number };
};

/** Textless stats concept-card composition (icon disc + title + lead +
 *  bullets + optional stat rail + impact/risk panels + example/take footer).
 *  Font sizes scale by the adaptive multiplier; line counts stay dynamic. */
export type InfographicStatsConceptGeometry = {
  iconDiscRatio: number; iconInset: number; glyphSizeRatio: number;
  contentLeftInset: number; contentRightPad: number; contentRightPadWithRail: number;
  railWidthRatio: number;
  titleSize: number; titleIconGap: number; titleZoneIconGap: number; titleZoneTailInset: number; titleMaxLines: number; titleLineHeightMul: number;
  charWidthFactor: number;
  headerBottomPad: number; titleBlockPad: number; leadGap: number;
  leadSize: number; leadMaxLines: number; leadLineHeightMul: number;
  bulletsStartGap: number; bulletSize: number; bulletMaxLines: number; bulletLineHeightMul: number; bulletCharInset: number; maxBullets: number; bulletFooterPad: number; bulletDotInset: number; bulletDotCyMul: number; bulletDotRadius: number; bulletTextInset: number; bulletInterGap: number;
  footerBandH: number; footerBottomPad: number; impactRowH: number; impactFooterGap: number;
  statRail: { boxXPad: number; boxY: number; boxHInset: number; valueSizeRatio: number; valueSizeMax: number; valueY: number; labelSize: number; labelCharFactor: number; labelMaxLines: number; labelLineHeightMul: number; labelStartY: number; rx: number; opacity: number };
  panels: { gap: number; outerInset: number; innerInset: number; valueLineHeightMul: number; charFactor: number; maxLines: number; heightBase: number; heightPad: number; labelSize: number; textSize: number; labelYOffset: number; valueStartYOffset: number; textInset: number; rx: number; stripeWidth: number; stripeRx: number; opacity: number; labelSpacing: number; xInset: number; impactColor: string; riskColor: string };
  footer: { innerInset: number; charFactor: number; maxLines: number; lineHeightMul: number; heightBase: number; heightPad: number; valueStartYOffset: number; labelSize: number; textSize: number; xInset: number; textInset: number; labelYOffset: number; rx: number; opacity: number; labelSpacing: number };
};

/** Header title + subtitle text geometry. */
export type InfographicHeaderGeometry = {
  leftX: number; zoneRightPad: number;
  titleCharFactor: number; titleLineHeightMul: number; titleMaxLines: number; titleTopY: number; titleLetterSpacing: number; titleFill: string; titleWeight: string;
  subtitleSize: number; subtitleCharFactor: number; subtitleMaxLines: number; subtitleLineHeightMul: number; subtitleGap: number; subtitleFill: string; subtitleWeight: string;
  panelClampTop: number; panelClampPad: number;
};

export type InfographicGeometry = {
  engine: InfographicEngineGeometry;
  denseBody: InfographicDenseBodyGeometry;
  wave: InfographicWaveGeometry;
  layouts: InfographicLayoutGeometry;
  glyph: InfographicGlyphGeometry;
  statsConcept: InfographicStatsConceptGeometry;
  header: InfographicHeaderGeometry;
  text: InfographicTextStyle;
};

/** The complete visual-language bundle for an infographic template. */
export type InfographicStyleSchema = {
  /** Fixed infographic canvas (platform-agnostic 4:5). */
  canvas: { width: number; height: number };
  /** Deterministic layout geometry (engine spacing, dense body, wave). */
  geometry: InfographicGeometry;
  color_scheme: InfographicColorScheme;
  typography: InfographicTypography;
  spacing: InfographicSpacing;
  card_style: InfographicCardStyle;
  connector_style: InfographicConnectorStyle;
  icon_style: InfographicIconStyle;
  chart_style: InfographicChartStyle;
  decoration_style: InfographicDecorationStyle;
};

/* ── The canonical default — production visual language as DATA ──────── */

export const DEFAULT_INFOGRAPHIC_STYLE: InfographicStyleSchema = {
  canvas: { width: 1200, height: 1500 },
  geometry: {
    engine: {
      timeline: { gap: 18, minCardHeight: 160, railOffset: 50 },
      process: { gap: 32, minCardHeight: 160 },
      comparison: { gap: 30, minCardHeight: 220, columnGap: 40 },
      stats: { gapX: 30, gapY: 30, minCardHeight: 260 },
      hierarchy: { gap: 22, minCardHeight: 170, widthInset: 40, indentStep: 20, maxIndentSteps: 4 },
      framework: { gapX: 30, gapY: 26, minCardHeight: 220 },
    },
    denseBody: {
      leadSize: 14, bulletSize: 13, labelSize: 10, valueSize: 12, charWidthFactor: 0.58,
      leadLineHeightMul: 1.45, bulletLineHeightMul: 1.4, panelValueLineHeightMul: 1.3, footerValueLineHeightMul: 1.4,
      leadMaxLines: 3, bulletMaxLines: 2, panelMaxLines: 2, footerMaxLines: 3,
      statChipHeightMul: 1.9, statValueFontMul: 1.25, statValueCharWidthMul: 0.62,
      bulletDotX: 4, bulletDotRadius: 3, bulletTextIndent: 16, bulletDotCyMul: 0.55,
      gapAfterStat: 10, gapAfterLead: 8, gapBeforePanels: 8, gapBeforeFooter: 10,
      panelTwoUpMinWidth: 360, panelGap: 10, panelInnerInset: 28, panelLabelY: 18, panelValueStartY: 34,
      panelHeightBase: 24, panelHeightPad: 6,
      footerInnerInset: 32, footerLabelY: 18, footerValueStartY: 34, footerHeightBase: 26, footerHeightPad: 6,
      offsetYCap: 20,
      detail: {
        statChipRx: 8, statChipOpacity: 0.10, statValueYMul: 0.68, statLabelYMul: 0.66, statValueX: 14, statLabelInset: 12, labelCharFactor: 0.55,
        panelRx: 8, panelStripeWidth: 4, panelStripeRx: 2, panelOpacity: 0.13, panelTextInset: 14, panelLabelSpacing: 2.2,
        footerRx: 10, footerOpacity: 0.08, footerTextInset: 16, footerLabelSpacing: 2.2,
        impactColor: '#10b981', riskColor: '#f59e0b',
        leadWeight: '500', bulletWeight: '500', panelLabelWeight: '800', panelValueWeight: '600', statValueWeight: '900', statLabelWeight: '600',
        footerLabelWeight: '800', footerExampleWeight: '500', footerTakeWeight: '700',
        bulletInterGap: 4,
      },
    },
    wave: {
      topOffset: 20, exitYRatio: 0.02, cpAYRatio: 0.025, cpBYRatio: 0.040,
      startXInset: 80, cpAXRatio: 0.30, cpBXRatio: 0.62, endXInset: 80,
    },
    layouts: {
      process: {
        bandRx: 14, bandOpacity: 0.10,
        badgeRadiusRatio: 0.13, badgePanelWMul: 3, badgeNumYRatio: 0.35, badgeNumFontRatio: 0.85,
        connectorHeight: 24, connectorArrowGap: 4, connectorArrowHalfW: 12, connectorTipExt: 10,
        connectorStrokeWidth: 4, connectorOpacity: 0.85,
        labelX: 34, labelY: 44, labelFont: 13, labelSpacing: 2.4,
        titleX: 34, titleY: 80, titleFontMul: 1.15,
        bodyX: 34, bodyY: 96, bodyWidthInset: 70, bodyHeightInset: 116,
      },
      comparison: {
        bandRx: 14, bandHeight: 44, bandOpacity: 0.10,
        labelX: 28, labelY: 30, labelFont: 14, labelSpacing: 2.4,
        bodyX: 28, bodyY: 62, bodyWidthInset: 56, bodyHeightInset: 84,
      },
      timeline: {
        dotXOffset: 22, dotYOffset: 40, dotRadius: 11, dotStrokeWidth: 3,
        labelX: 28, labelY: 32, labelFont: 13, labelSpacing: 2.4,
        titleX: 28, titleY: 62, bodyX: 28, bodyY: 78, bodyWidthInset: 56, bodyHeightInset: 96,
        railXOffset: 22, railTopPad: 12, railBottomPad: 12, railStrokeWidth: 3, railOpacity: 0.4,
      },
      hierarchy: {
        numX: 28, numY: 56, numFont: 34,
        titleX: 96, titleY: 48, bodyX: 96, bodyY: 64, bodyWidthInset: 120, bodyHeightInset: 84,
      },
      framework: {
        bandRx: 14, bandHeight: 48, bandOpacity: 0.14,
        labelX: 28, labelY: 22, labelFont: 12, labelSpacing: 2.4,
        titleX: 28, titleY: 78, bodyX: 28, bodyY: 94, bodyWidthInset: 56, bodyHeightInset: 114,
      },
      stats: {
        titleFont: 22, bodyFont: 15, bodyLineHeightMul: 1.5, bodyWidthInset: 56, bodyBottomPad: 28,
        donut: { yOffset: 50, radiusRatio: 0.28, strokeMin: 14, strokeRatio: 0.30, trackOpacity: 0.14, statYRatio: 0.22, statFontMin: 36, statFontRatio: 0.72, titleGap: 50, bodyGap: 66 },
        bar: { numeralYRatio: 0.36, numeralFontHRatio: 0.38, numeralFontWRatio: 0.36, widthInset: 56, height: 14, xInset: 28, yRatio: 0.50, trackOpacity: 0.16, fillBase: 0.35, fillIndexStep: 0.18, titleGap: 38, bodyGap: 56 },
        dot: { count: 10, radiusMin: 8, radiusRatio: 0.022, gapMul: 2.6, yRatio: 0.38, emptyOpacity: 0.18, ratioFontHRatio: 0.20, ratioFontWRatio: 0.22, ratioYRatio: 0.22, filledBase: 4, titleGap: 50, bodyGap: 66 },
      },
      ambient: { inset: 48, opacity: 0.04, cornerRadius: 0 },
    },
    glyph: {
      lightbulb: {
        r: 0.5, topDy: 0.1,
        c1: [0, 0.25, 0.15, 0.4, 0.25, 0.5], lDx: 0.5,
        c2: [0.1, 0.1, 0.25, 0.25, 0.25, 0.5],
        b1: [0.22, 0.45, 0.44, 0.18, 0.07], b2: [0.16, 0.66, 0.32, 0.1, 0.05],
      },
      target: { r1: 0.95, sw1: 0.14, r2: 0.50, sw2: 0.14, r3: 0.18 },
      arrow: { tip: 0.95, p1y: 0.5, p2x: 0.35, p3y: 0.15, p4y: 0.55, sw: 0.18, headBackX: 0.45, headY: 0.55, headTipY: 0.1 },
      check: { p1x: 0.6, p1y: 0.05, p2x: 0.1, p2y: 0.55, p3x: 0.7, p3y: 0.55, sw: 0.22 },
      bolt: [0.05, 0.9, 0.55, 0.1, 0.05, 0.1, 0.25, 0.9, 0.55, 0.15, 0.05, 0.15],
      gear: { teeth: 8, outerR: 0.92, innerR: 0.62, discR: 0.28 },
    },
    statsConcept: {
      iconDiscRatio: 0.08, iconInset: 36, glyphSizeRatio: 0.5,
      contentLeftInset: 28, contentRightPad: 28, contentRightPadWithRail: 20,
      railWidthRatio: 0.24,
      titleSize: 20, titleIconGap: 18, titleZoneIconGap: 36, titleZoneTailInset: 36, titleMaxLines: 2, titleLineHeightMul: 1.2,
      charWidthFactor: 0.58,
      headerBottomPad: 12, titleBlockPad: 4, leadGap: 18,
      leadSize: 14, leadMaxLines: 3, leadLineHeightMul: 1.45,
      bulletsStartGap: 12, bulletSize: 13, bulletMaxLines: 2, bulletLineHeightMul: 1.4, bulletCharInset: 18, maxBullets: 4, bulletFooterPad: 14, bulletDotInset: 4, bulletDotCyMul: 0.3, bulletDotRadius: 3, bulletTextInset: 16, bulletInterGap: 4,
      footerBandH: 70, footerBottomPad: 12, impactRowH: 78, impactFooterGap: 10,
      statRail: { boxXPad: 8, boxY: 20, boxHInset: 56, valueSizeRatio: 0.42, valueSizeMax: 50, valueY: 70, labelSize: 11, labelCharFactor: 0.55, labelMaxLines: 4, labelLineHeightMul: 1.35, labelStartY: 110, rx: 12, opacity: 0.10 },
      panels: { gap: 12, outerInset: 32, innerInset: 32, valueLineHeightMul: 1.35, charFactor: 0.58, maxLines: 3, heightBase: 28, heightPad: 8, labelSize: 10, textSize: 12, labelYOffset: 22, valueStartYOffset: 42, textInset: 18, rx: 10, stripeWidth: 4, stripeRx: 2, opacity: 0.13, labelSpacing: 2.4, xInset: 16, impactColor: '#10b981', riskColor: '#f59e0b' },
      footer: { innerInset: 64, charFactor: 0.58, maxLines: 3, lineHeightMul: 1.4, heightBase: 30, heightPad: 6, valueStartYOffset: 38, labelSize: 10, textSize: 12, xInset: 16, textInset: 32, labelYOffset: 20, rx: 10, opacity: 0.08, labelSpacing: 2.4 },
    },
    header: {
      leftX: 80, zoneRightPad: 24,
      titleCharFactor: 0.55, titleLineHeightMul: 1.1, titleMaxLines: 2, titleTopY: 44, titleLetterSpacing: 0.5, titleFill: '#ffffff', titleWeight: '900',
      subtitleSize: 15, subtitleCharFactor: 0.55, subtitleMaxLines: 2, subtitleLineHeightMul: 1.45, subtitleGap: 16, subtitleFill: 'rgba(255,255,255,0.92)', subtitleWeight: '500',
      panelClampTop: 12, panelClampPad: 8,
    },
    text: { labelWeight: '800', titleWeight: '800', numeralWeight: '900', bodyWeight: '500', panelValueWeight: '600', takeWeight: '700', whiteFg: '#ffffff' },
  },
  color_scheme: {
    backgroundBase: '#0F172A',
    accent: '#22c55e',
    panel: '#ffffff',
    innerPanel: '#f8fafc',
    primaryText: '#111827',
    bodyText: '#334155',
    tinyLabelText: '#64748b',
    seriesRamp: ['#2563eb', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#0ea5e9', '#14b8a6', '#f43f5e'],
    backgroundMode: 'gradient',
    gradients: {
      background: {
        direction: 'vertical',
        stops: [
          { offset: 0, color: 'backgroundBase', opacity: 1 },
          { offset: 35, color: 'accent', opacity: 0.85 },
          { offset: 100, color: 'accent', opacity: 1 },
        ],
      },
      header: {
        direction: 'diagonal',
        stops: [
          { offset: 0, color: 'backgroundBase', opacity: 1 },
          { offset: 100, color: 'accent', opacity: 0.9 },
        ],
      },
      wave: {
        direction: 'horizontal',
        stops: [
          { offset: 0, color: 'accent', opacity: 0.55 },
          { offset: 100, color: 'accent', opacity: 0.18 },
        ],
      },
    },
  },
  typography: {
    fontFamily: 'Inter, Arial',
    baseSizes: { headerTitle: 44, cardTitle: 25, lead: 14, bullet: 13, label: 10, value: 12 },
    fontMultiplierScale: [
      { maxSectionChars: 60, multiplier: 1.40 },
      { maxSectionChars: 110, multiplier: 1.28 },
      { maxSectionChars: 170, multiplier: 1.16 },
      { maxSectionChars: 230, multiplier: 1.05 },
      { maxSectionChars: 300, multiplier: 0.96 },
      { maxSectionChars: Number.POSITIVE_INFINITY, multiplier: 0.88 },
    ],
  },
  spacing: { sideMargin: 80, bottomMargin: 90, headerHeight: 150, headerHeightWithSubtitle: 212 },
  card_style: { cornerRadius: 14, fill: 'panel', fillOpacity: 0.97, accentStripeWidth: 6, accentStripeRadius: 3 },
  connector_style: {
    process: { strokeWidth: 4, arrowHead: true },
    timeline: { railStrokeWidth: 3, railOpacity: 0.4, dotRadius: 11 },
  },
  icon_style: { kind: 'concept_glyph', glyphFill: '#ffffff', discFillsFromAccent: true, discRadiusRatio: 0.08 },
  chart_style: {
    barCornerRadius: 4, donutHoleRatio: 0.55, maxDataPoints: 8, seriesFromBrand: true,
    geometry: {
      minFontSize: 9,
      title: { sizeBase: 20, xInset: 28, yInset: 24, charFactor: 0.55, widthInset: 56, bottomGap: 10, emptyBottomY: 24 },
      plot: { padL: 28, padR: 24, padB: 44, yGap: 14, min: 20 },
      bar: { gapMin: 8, gapRatio: 0.04, barWMin: 6, labelSizeBase: 11, axisOpacity: 0.25, axisStrokeWidth: 1, headroom: 22, valueLabelYOffset: 6, xLabelYOffset: 6, labelCharFactor: 0.55, labelCharPad: 2 },
      line: { usableHeadroom: 26, pointRadius: 4.5, lineStrokeWidth: 3, pointStrokeWidth: 2, labelSizeBase: 11, valueLabelYOffset: 10, xLabelYOffset: 6, labelMaxChars: 8, valueLabelMaxPoints: 6, axisOpacity: 0.25, axisStrokeWidth: 1 },
      pie: { zoneRatio: 0.52, rMin: 20, rPad: 6, cxPad: 6, legendXGap: 14, rowHMin: 18, legendSizeBase: 12, legendStartYRatio: 0.6, swatchRx: 3, swatchYOffset: 2, labelGap: 8, labelInsetSub: 10, labelCharFactor: 0.55, labelCharPad: 4 },
      table: { padL: 28, padR: 24, padB: 20, gridTopGap: 12, rowHMin: 22, rowHMax: 56, headerSizeBase: 12, cellSizeBase: 12, charFactor: 0.55, charInset: 16, headerRx: 6, headerOpacity: 0.16, textInset: 12, headerTextYRatio: 0.35, cellTextYRatio: 0.35, zebraOpacity: 0.05, separatorOpacity: 0.10, separatorWidth: 1 },
      weights: { chartTitle: '800', barValue: '700', barLabel: '500', lineValue: '700', lineLabel: '500', legend: '600', tableHeader: '800', tableCell: '500' },
    },
  },
  decoration_style: {
    wave: { enabled: true, strokeWidthRatio: 0.005 },
    ambientFill: { enabled: true, opacity: 0.04 },
    ctaFooter: {
      enabled: true, treatment: 'pill_band', inset: 32, bandHeight: 56,
      bandBottomOffset: 88, cornerRadius: 18, opacity: 0.16, fontSize: 22, textBottomOffset: 50,
    },
    innerPanel: { inset: 32, topOffset: 12, cornerRadius: 18, opacity: 0.95 },
  },
};
