/**
 * Infographic data-card foundation (Unified Infographic Enhancement).
 *
 * Adds THREE opt-in, feature-flagged capabilities to the infographic
 * renderer without touching the existing concept/process/comparison/
 * stat/timeline/hierarchy/framework layouts:
 *
 *   • Chart cards  (bar | line | pie/donut)   — Phase 2
 *   • Table cards                              — Phase 3
 *   • Background image mode                    — Phase 4
 *
 * DESIGN CONTRACT (per the mission brief):
 *   - DETERMINISTIC: every pixel here is computed from numeric inputs.
 *     The AI supplies DATA ONLY (labels + values / columns + rows). No
 *     SVG geometry is ever AI-generated.
 *   - PURE: these builders return SVG `<text>`/`<rect>`/`<path>` string
 *     fragments and never touch the network, the filesystem, or sharp.
 *     The renderer owns image I/O. This keeps them unit-testable.
 *   - NATIVE TEXT ONLY: no `<foreignObject>` (librsvg/sharp renders it
 *     blank) — mirrors the existing renderer contract.
 *   - BRAND-DRIVEN: colors + typography come from the caller's resolved
 *     CreatorBrandKit-derived context. No independent palette.
 *   - GEOMETRY-PRESERVING: a chart/table card occupies exactly one
 *     existing engine slot ({x,y,width,height}). The engine is unchanged.
 *   - OPT-IN: absent/invalid data → builders return null so the caller
 *     falls back to the legacy layout card → byte-identical default.
 */

// Canonical chart geometry — the single source of truth lives in the
// template style. The builders consume it via the card-brand context;
// absent → the default (whose values equal the prior literals → byte-identical).
import { DEFAULT_INFOGRAPHIC_STYLE, type InfographicChartStyle, type InfographicChartGeometry } from '../../../lib/creator-templates';

function chartGeom(brand: InfographicCardBrand): InfographicChartGeometry {
  return (brand.chart ?? DEFAULT_INFOGRAPHIC_STYLE.chart_style).geometry;
}

// ── Feature flags (default OFF) ─────────────────────────────────────
export function infographicChartsEnabled(): boolean {
  return process.env.INFOGRAPHIC_CHARTS_ENABLED === 'true';
}
export function infographicTablesEnabled(): boolean {
  return process.env.INFOGRAPHIC_TABLES_ENABLED === 'true';
}
export function infographicBackgroundImagesEnabled(): boolean {
  return process.env.INFOGRAPHIC_BACKGROUND_IMAGES_ENABLED === 'true';
}

// ── Public types ────────────────────────────────────────────────────
export type ChartType = 'bar' | 'line' | 'pie';

export type ChartDataPoint = { label: string; value: number };

export type ChartCardSpec = {
  type: 'chart';
  chartType: ChartType;
  title: string;
  data: ChartDataPoint[];
};

export type TableCardSpec = {
  type: 'table';
  title: string;
  columns: string[];
  rows: string[][];
};

export type StructuredCardSpec = ChartCardSpec | TableCardSpec;

/** Brand-derived render context. All fields come from the renderer's
 *  already-resolved CreatorBrandKit locals — no new brand resolution. */
export type InfographicCardBrand = {
  /** brandKit.normalizedPalette */
  palette: string[];
  /** brandKit.accentColor (WCAG-validated canonical accent) */
  accent: string;
  /** brand font with 'Inter, Arial' fallback */
  fontFamily: string;
  /** primary text color (#111827) */
  text: string;
  /** body/secondary text color (#334155) */
  bodyTextColor: string;
  /** card panel fill (#ffffff) */
  panel: string;
  /** the renderer's adaptive font multiplier */
  fontMultiplier: number;
  /** Canonical chart style (geometry + radii). Absent → defaults. */
  chart?: InfographicChartStyle;
  /** Canonical chart/card visual constants (from InfographicStyleSchema).
   *  Optional — absent → the prior literals, so callers stay byte-identical. */
  barCornerRadius?: number;
  donutHoleRatio?: number;
  cardCornerRadius?: number;
  cardStripeWidth?: number;
  cardStripeRadius?: number;
  cardFillOpacity?: number;
};

export type CardGeometry = { x: number; y: number; width: number; height: number };

export type BackgroundMode = 'gradient' | 'image';

export const CHART_MAX_POINTS = 8;
export const TABLE_MAX_ROWS = 6;
export const TABLE_MAX_COLUMNS = 4;
export const BACKGROUND_IMAGE_MIN_OPACITY = 0.2;
export const BACKGROUND_IMAGE_MAX_OPACITY = 0.6;
const BACKGROUND_IMAGE_DEFAULT_OPACITY = 0.45;

// ── Small pure helpers (local copies so this module stays standalone) ─
function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value: string, maxChars: number): string {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxChars) return s;
  if (maxChars <= 1) return s.slice(0, Math.max(0, maxChars));
  return `${s.slice(0, maxChars - 1).trimEnd()}…`;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

/** Deterministic, brand-led series colors. Cycles accent → palette →
 *  a fixed accessible ramp so a chart with N series always has N
 *  distinct, contrast-safe fills regardless of how sparse the kit is. */
const DEFAULT_SERIES_RAMP = [
  '#2563eb', '#10b981', '#f59e0b', '#a855f7',
  '#ef4444', '#0ea5e9', '#14b8a6', '#f43f5e',
];
export function resolveSeriesColors(brand: InfographicCardBrand, n: number): string[] {
  const seed: string[] = [];
  if (isHexColor(brand.accent)) seed.push(brand.accent.trim());
  for (const c of brand.palette || []) {
    if (isHexColor(c) && !seed.includes(c.trim())) seed.push(c.trim());
  }
  for (const c of DEFAULT_SERIES_RAMP) {
    if (!seed.includes(c)) seed.push(c);
  }
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, n); i += 1) out.push(seed[i % seed.length]);
  return out;
}

// ── Validation / normalization (deterministic, exported for tests) ───

/** Returns at most CHART_MAX_POINTS valid points, or [] when none are
 *  usable. A point is valid when it has a non-empty label and a finite
 *  numeric value. */
export function normalizeChartData(data: unknown): ChartDataPoint[] {
  if (!Array.isArray(data)) return [];
  const out: ChartDataPoint[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const label = truncate(String((raw as Record<string, unknown>).label ?? ''), 24);
    const value = (raw as Record<string, unknown>).value;
    if (!label) continue;
    if (!isFiniteNumber(value)) continue;
    out.push({ label, value });
    if (out.length >= CHART_MAX_POINTS) break;
  }
  return out;
}

export function normalizeChartSpec(spec: unknown): ChartCardSpec | null {
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  if (s.type !== 'chart') return null;
  const chartType: ChartType =
    s.chartType === 'line' ? 'line' : s.chartType === 'pie' ? 'pie' : 'bar';
  const data = normalizeChartData(s.data);
  if (data.length === 0) return null;
  // Pie needs at least one positive slice; bar/line tolerate zeros.
  if (chartType === 'pie' && data.every((d) => d.value <= 0)) return null;
  return {
    type: 'chart',
    chartType,
    title: truncate(String(s.title ?? ''), 48),
    data,
  };
}

export function normalizeTableSpec(spec: unknown): TableCardSpec | null {
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  if (s.type !== 'table') return null;
  const rawCols = Array.isArray(s.columns) ? s.columns : [];
  const columns = rawCols
    .slice(0, TABLE_MAX_COLUMNS)
    .map((c) => truncate(String(c ?? ''), 20));
  if (columns.length === 0) return null;
  const rawRows = Array.isArray(s.rows) ? s.rows : [];
  const rows: string[][] = rawRows
    .slice(0, TABLE_MAX_ROWS)
    .map((row) => {
      const cells = Array.isArray(row) ? row : [];
      // Pad/truncate every row to the column count so the grid is rectangular.
      return Array.from({ length: columns.length }, (_, i) =>
        truncate(String(cells[i] ?? ''), 28),
      );
    });
  return { type: 'table', title: truncate(String(s.title ?? ''), 48), columns, rows };
}

/**
 * Resolve operator/planner-supplied structured cards from metadata into
 * an index→spec map. This is the ONLY ingestion path; it is strictly
 * validated and never fabricates data. Reads `metadata.infographic_cards`
 * (or `metadata.creator_card.infographic_cards`), an array of:
 *   { index: number, type:'chart'|'table', ... }
 * Invalid entries are dropped (→ caller renders the legacy card).
 */
export function resolveStructuredCards(
  metadata: Record<string, unknown>,
): Map<number, StructuredCardSpec> {
  const map = new Map<number, StructuredCardSpec>();
  const creatorCard =
    metadata.creator_card && typeof metadata.creator_card === 'object'
      ? (metadata.creator_card as Record<string, unknown>)
      : {};
  const rawList = Array.isArray(metadata.infographic_cards)
    ? metadata.infographic_cards
    : Array.isArray(creatorCard.infographic_cards)
    ? creatorCard.infographic_cards
    : [];
  rawList.forEach((raw, listIndex) => {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    const index = isFiniteNumber(r.index) ? Math.trunc(r.index) : listIndex;
    if (index < 0) return;
    if (map.has(index)) return; // first valid spec per slot wins
    const chart = normalizeChartSpec(r);
    if (chart) {
      map.set(index, chart);
      return;
    }
    const table = normalizeTableSpec(r);
    if (table) map.set(index, table);
  });
  return map;
}

// ── Card-base helper (matches the renderer's renderCardBase style) ───
function cardBase(geom: CardGeometry, brand: InfographicCardBrand, accentFill: string): string {
  const { x, y, width, height } = geom;
  const rx = brand.cardCornerRadius ?? 14;
  const op = brand.cardFillOpacity ?? 0.97;
  const sw = brand.cardStripeWidth ?? 6;
  const sr = brand.cardStripeRadius ?? 3;
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${brand.panel}" opacity="${op}" />` +
    `<rect x="${x}" y="${y}" width="${sw}" height="${height}" rx="${sr}" fill="${accentFill}" />`
  );
}

function cardTitleSvg(
  geom: CardGeometry,
  brand: InfographicCardBrand,
  title: string,
): { svg: string; bottomY: number } {
  const gt = chartGeom(brand).title;
  if (!title) return { svg: '', bottomY: geom.y + gt.emptyBottomY };
  const size = Math.round(gt.sizeBase * brand.fontMultiplier);
  const tx = geom.x + gt.xInset;
  const ty = geom.y + gt.yInset + size;
  // Char budget keeps the title to a single line inside the card.
  const maxChars = Math.max(8, Math.floor((geom.width - gt.widthInset) / (size * gt.charFactor)));
  const svg = `<text x="${tx}" y="${ty}" font-size="${size}" font-family="${brand.fontFamily}" font-weight="${chartGeom(brand).weights.chartTitle}" fill="${brand.text}">${escapeXml(truncate(title, maxChars))}</text>`;
  return { svg, bottomY: ty + gt.bottomGap };
}

// ====================================================================
// PHASE 2 — CHART CARD
// ====================================================================

/**
 * Build a chart card SVG fragment. Returns null when the spec carries no
 * usable data (caller falls back to the legacy layout card).
 *
 * Deterministic: bar heights, line points, and pie arcs are all derived
 * from the supplied values via fixed scaling math. Colors/typography are
 * brand-driven. WCAG: all data labels are dark text on the white panel
 * (AA); value labels sit ABOVE bars/points (never low-contrast on a fill).
 */
export function buildChartCardSvg(
  spec: ChartCardSpec,
  geom: CardGeometry,
  brand: InfographicCardBrand,
): string | null {
  const normalized = normalizeChartSpec(spec);
  if (!normalized) return null;
  const accentFill = isHexColor(brand.accent) ? brand.accent : DEFAULT_SERIES_RAMP[0];
  const { svg: titleSvg, bottomY } = cardTitleSvg(geom, brand, normalized.title);
  const base = cardBase(geom, brand, accentFill);

  // Plot area inside the card, below the title.
  const gp = chartGeom(brand).plot;
  const padL = gp.padL;
  const padR = gp.padR;
  const padB = gp.padB; // room for x-axis labels
  const plotX = geom.x + padL;
  const plotY = bottomY + gp.yGap;
  const plotW = geom.width - padL - padR;
  const plotH = geom.y + geom.height - padB - plotY;
  if (plotW <= gp.min || plotH <= gp.min) {
    // Card too small to host a chart → let caller fall back.
    return null;
  }

  let body = '';
  if (normalized.chartType === 'pie') {
    body = buildPieBody(normalized.data, { plotX, plotY, plotW, plotH }, brand);
  } else if (normalized.chartType === 'line') {
    body = buildLineBody(normalized.data, { plotX, plotY, plotW, plotH }, brand);
  } else {
    body = buildBarBody(normalized.data, { plotX, plotY, plotW, plotH }, brand);
  }
  return `${base}${titleSvg}${body}`;
}

type Plot = { plotX: number; plotY: number; plotW: number; plotH: number };

function buildBarBody(data: ChartDataPoint[], plot: Plot, brand: InfographicCardBrand): string {
  const { plotX, plotY, plotW, plotH } = plot;
  const G = chartGeom(brand);
  const g = G.bar;
  const colors = resolveSeriesColors(brand, data.length);
  const maxV = Math.max(...data.map((d) => d.value), 0);
  const gap = Math.max(g.gapMin, Math.round(plotW * g.gapRatio));
  const barW = Math.max(g.barWMin, Math.floor((plotW - gap * (data.length - 1)) / data.length));
  const baselineY = plotY + plotH;
  const labelSize = Math.max(G.minFontSize, Math.round(g.labelSizeBase * brand.fontMultiplier));
  const valueSize = Math.max(G.minFontSize, Math.round(g.labelSizeBase * brand.fontMultiplier));
  // Baseline axis.
  let out = `<line x1="${plotX}" y1="${baselineY}" x2="${plotX + plotW}" y2="${baselineY}" stroke="${brand.bodyTextColor}" stroke-opacity="${g.axisOpacity}" stroke-width="${g.axisStrokeWidth}" />`;
  data.forEach((d, i) => {
    const bx = plotX + i * (barW + gap);
    const h = maxV > 0 ? Math.max(0, Math.round((Math.max(0, d.value) / maxV) * (plotH - g.headroom))) : 0;
    const by = baselineY - h;
    const cx = bx + barW / 2;
    out += `<rect x="${bx}" y="${by}" width="${barW}" height="${h}" rx="${brand.barCornerRadius ?? 4}" fill="${colors[i]}" />`;
    // Value label above the bar (dark on white panel = high contrast).
    out += `<text x="${cx}" y="${by - g.valueLabelYOffset}" text-anchor="middle" font-size="${valueSize}" font-family="${brand.fontFamily}" font-weight="${G.weights.barValue}" fill="${brand.text}">${escapeXml(formatValue(d.value))}</text>`;
    // X label under the baseline.
    out += `<text x="${cx}" y="${baselineY + labelSize + g.xLabelYOffset}" text-anchor="middle" font-size="${labelSize}" font-family="${brand.fontFamily}" font-weight="${G.weights.barLabel}" fill="${brand.bodyTextColor}">${escapeXml(truncate(d.label, Math.max(4, Math.floor(barW / (labelSize * g.labelCharFactor)) + g.labelCharPad)))}</text>`;
  });
  return out;
}

function buildLineBody(data: ChartDataPoint[], plot: Plot, brand: InfographicCardBrand): string {
  const { plotX, plotY, plotW, plotH } = plot;
  const G = chartGeom(brand);
  const g = G.line;
  const accent = isHexColor(brand.accent) ? brand.accent : DEFAULT_SERIES_RAMP[0];
  const maxV = Math.max(...data.map((d) => d.value), 0);
  const minV = Math.min(...data.map((d) => d.value), 0);
  const span = maxV - minV || 1;
  const baselineY = plotY + plotH;
  const usableH = plotH - g.usableHeadroom; // headroom for value labels
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;
  const labelSize = Math.max(G.minFontSize, Math.round(g.labelSizeBase * brand.fontMultiplier));
  const pointFor = (d: ChartDataPoint, i: number) => {
    const px = data.length > 1 ? plotX + i * stepX : plotX + plotW / 2;
    const py = baselineY - Math.round(((d.value - minV) / span) * usableH);
    return { px, py };
  };
  const pts = data.map(pointFor);
  let out = `<line x1="${plotX}" y1="${baselineY}" x2="${plotX + plotW}" y2="${baselineY}" stroke="${brand.bodyTextColor}" stroke-opacity="${g.axisOpacity}" stroke-width="${g.axisStrokeWidth}" />`;
  if (pts.length > 1) {
    out += `<polyline points="${pts.map((p) => `${p.px},${p.py}`).join(' ')}" fill="none" stroke="${accent}" stroke-width="${g.lineStrokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  pts.forEach((p, i) => {
    out += `<circle cx="${p.px}" cy="${p.py}" r="${g.pointRadius}" fill="${accent}" stroke="${brand.panel}" stroke-width="${g.pointStrokeWidth}" />`;
    // Only label values when sparse enough to avoid collision.
    if (data.length <= g.valueLabelMaxPoints) {
      out += `<text x="${p.px}" y="${p.py - g.valueLabelYOffset}" text-anchor="middle" font-size="${labelSize}" font-family="${brand.fontFamily}" font-weight="${G.weights.lineValue}" fill="${brand.text}">${escapeXml(formatValue(data[i].value))}</text>`;
    }
    out += `<text x="${p.px}" y="${baselineY + labelSize + g.xLabelYOffset}" text-anchor="middle" font-size="${labelSize}" font-family="${brand.fontFamily}" font-weight="${G.weights.lineLabel}" fill="${brand.bodyTextColor}">${escapeXml(truncate(data[i].label, g.labelMaxChars))}</text>`;
  });
  return out;
}

function buildPieBody(data: ChartDataPoint[], plot: Plot, brand: InfographicCardBrand): string {
  const { plotX, plotY, plotW, plotH } = plot;
  const G = chartGeom(brand);
  const g = G.pie;
  const colors = resolveSeriesColors(brand, data.length);
  const positive = data.map((d) => ({ ...d, value: Math.max(0, d.value) }));
  const total = positive.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return '';
  // Pie occupies the left ~55%; legend the right ~45%.
  const pieZoneW = Math.round(plotW * g.zoneRatio);
  const r = Math.max(g.rMin, Math.floor(Math.min(pieZoneW, plotH) / 2) - g.rPad);
  const cx = plotX + r + g.cxPad;
  const cy = plotY + plotH / 2;
  let out = '';
  let angle = -Math.PI / 2; // start at top
  const TWO_PI = Math.PI * 2;
  positive.forEach((d, i) => {
    const frac = d.value / total;
    const sweep = frac * TWO_PI;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    if (frac <= 0) return;
    if (frac >= 0.9999) {
      // Single full-circle slice — arcs degenerate, draw a circle.
      out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colors[i]}" />`;
      return;
    }
    const x0 = round2(cx + r * Math.cos(a0));
    const y0 = round2(cy + r * Math.sin(a0));
    const x1 = round2(cx + r * Math.cos(a1));
    const y1 = round2(cy + r * Math.sin(a1));
    const largeArc = sweep > Math.PI ? 1 : 0;
    out += `<path d="M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z" fill="${colors[i]}" />`;
  });
  // Donut hole for a cleaner, modern read.
  out += `<circle cx="${cx}" cy="${cy}" r="${Math.round(r * (brand.donutHoleRatio ?? 0.55))}" fill="${brand.panel}" />`;

  // Legend: swatch + label + percentage (dark text on white panel = AA).
  const legendX = plotX + pieZoneW + g.legendXGap;
  const legendW = plotX + plotW - legendX;
  const rowH = Math.max(g.rowHMin, Math.floor(plotH / Math.max(1, positive.length + 1)));
  const legendSize = Math.max(G.minFontSize, Math.round(g.legendSizeBase * brand.fontMultiplier));
  let ly = plotY + Math.round(rowH * g.legendStartYRatio);
  positive.forEach((d, i) => {
    const pct = Math.round((d.value / total) * 100);
    out += `<rect x="${legendX}" y="${ly - legendSize + g.swatchYOffset}" width="${legendSize}" height="${legendSize}" rx="${g.swatchRx}" fill="${colors[i]}" />`;
    const labelMax = Math.max(4, Math.floor((legendW - legendSize - g.labelInsetSub) / (legendSize * g.labelCharFactor)) - g.labelCharPad);
    out += `<text x="${legendX + legendSize + g.labelGap}" y="${ly}" font-size="${legendSize}" font-family="${brand.fontFamily}" font-weight="${G.weights.legend}" fill="${brand.text}">${escapeXml(truncate(d.label, labelMax))} ${pct}%</text>`;
    ly += rowH;
  });
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compact numeric formatting (deterministic, locale-free). */
export function formatValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${round2(v / 1_000_000)}M`;
  if (abs >= 1_000) return `${round2(v / 1_000)}K`;
  if (Number.isInteger(v)) return String(v);
  return String(round2(v));
}

// ====================================================================
// PHASE 3 — TABLE CARD
// ====================================================================

/**
 * Build a table card SVG fragment. Returns null when the spec has no
 * columns (caller falls back to the legacy layout card).
 *
 * Deterministic sizing: equal column widths, equal row heights bounded by
 * the card. Cells are truncated (normalizeTableSpec) so nothing overflows.
 * Header row carries an accent-tinted band; body rows zebra-stripe for
 * legibility. Typography + accent are brand-driven.
 */
export function buildTableCardSvg(
  spec: TableCardSpec,
  geom: CardGeometry,
  brand: InfographicCardBrand,
): string | null {
  const normalized = normalizeTableSpec(spec);
  if (!normalized) return null;
  const accentFill = isHexColor(brand.accent) ? brand.accent : DEFAULT_SERIES_RAMP[0];
  const { svg: titleSvg, bottomY } = cardTitleSvg(geom, brand, normalized.title);
  const base = cardBase(geom, brand, accentFill);

  const G = chartGeom(brand);
  const g = G.table;
  const padL = g.padL;
  const padR = g.padR;
  const padB = g.padB;
  const gridX = geom.x + padL;
  const gridW = geom.width - padL - padR;
  const gridTop = bottomY + g.gridTopGap;
  const gridBottom = geom.y + geom.height - padB;
  const gridH = gridBottom - gridTop;
  if (gridW <= 40 || gridH <= 40) return null;

  const cols = normalized.columns.length;
  const colW = Math.floor(gridW / cols);
  const totalRows = normalized.rows.length + 1; // +1 header
  const rowH = Math.max(g.rowHMin, Math.min(g.rowHMax, Math.floor(gridH / Math.max(1, totalRows))));
  const headerSize = Math.max(G.minFontSize, Math.round(g.headerSizeBase * brand.fontMultiplier));
  const cellSize = Math.max(G.minFontSize, Math.round(g.cellSizeBase * brand.fontMultiplier));

  const cellCharBudget = Math.max(4, Math.floor((colW - g.charInset) / (cellSize * g.charFactor)));
  const headerCharBudget = Math.max(4, Math.floor((colW - g.charInset) / (headerSize * g.charFactor)));

  let out = '';
  // Header band.
  out += `<rect x="${gridX}" y="${gridTop}" width="${gridW}" height="${rowH}" rx="${g.headerRx}" fill="${accentFill}" opacity="${g.headerOpacity}" />`;
  normalized.columns.forEach((col, c) => {
    const tx = gridX + c * colW + g.textInset;
    const ty = gridTop + Math.round(rowH / 2) + Math.round(headerSize * g.headerTextYRatio);
    out += `<text x="${tx}" y="${ty}" font-size="${headerSize}" font-family="${brand.fontFamily}" font-weight="${G.weights.tableHeader}" fill="${brand.text}">${escapeXml(truncate(col, headerCharBudget))}</text>`;
  });
  // Body rows.
  normalized.rows.forEach((row, r) => {
    const ry = gridTop + (r + 1) * rowH;
    if (r % 2 === 1) {
      out += `<rect x="${gridX}" y="${ry}" width="${gridW}" height="${rowH}" fill="${brand.bodyTextColor}" opacity="${g.zebraOpacity}" />`;
    }
    row.forEach((cell, c) => {
      const tx = gridX + c * colW + g.textInset;
      const ty = ry + Math.round(rowH / 2) + Math.round(cellSize * g.cellTextYRatio);
      out += `<text x="${tx}" y="${ty}" font-size="${cellSize}" font-family="${brand.fontFamily}" font-weight="${G.weights.tableCell}" fill="${brand.bodyTextColor}">${escapeXml(truncate(cell, cellCharBudget))}</text>`;
    });
  });
  // Column separators (subtle).
  for (let c = 1; c < cols; c += 1) {
    const lx = gridX + c * colW;
    out += `<line x1="${lx}" y1="${gridTop}" x2="${lx}" y2="${gridTop + totalRows * rowH}" stroke="${brand.bodyTextColor}" stroke-opacity="${g.separatorOpacity}" stroke-width="${g.separatorWidth}" />`;
  }
  return `${base}${titleSvg}${out}`;
}

// ====================================================================
// PHASE 4 — BACKGROUND IMAGE MODE
// ====================================================================

/** Resolve requested background mode + clamped opacity from metadata.
 *  Defaults to gradient (byte-identical) unless image mode is requested
 *  WITH a usable URL. The flag check is the caller's responsibility. */
export function resolveBackgroundConfig(metadata: Record<string, unknown>): {
  mode: BackgroundMode;
  imageUrl: string | null;
  imageOpacity: number;
} {
  const creatorCard =
    metadata.creator_card && typeof metadata.creator_card === 'object'
      ? (metadata.creator_card as Record<string, unknown>)
      : {};
  const rawMode = String(
    metadata.backgroundMode ?? creatorCard.backgroundMode ?? 'gradient',
  )
    .trim()
    .toLowerCase();
  const rawUrl = String(
    metadata.backgroundImageUrl ?? creatorCard.backgroundImageUrl ?? '',
  ).trim();
  const hasUrl = /^https?:\/\//i.test(rawUrl);
  const mode: BackgroundMode = rawMode === 'image' && hasUrl ? 'image' : 'gradient';
  const rawOpacity =
    metadata.imageOpacity ?? creatorCard.imageOpacity ?? BACKGROUND_IMAGE_DEFAULT_OPACITY;
  const parsed = isFiniteNumber(rawOpacity) ? rawOpacity : BACKGROUND_IMAGE_DEFAULT_OPACITY;
  const imageOpacity = Math.min(
    BACKGROUND_IMAGE_MAX_OPACITY,
    Math.max(BACKGROUND_IMAGE_MIN_OPACITY, parsed),
  );
  return { mode, imageUrl: mode === 'image' ? rawUrl : null, imageOpacity };
}

/**
 * The full-bleed background SVG fragment.
 *
 *  - gradient mode → the existing opaque gradient rect (BYTE-IDENTICAL).
 *  - image mode    → a MANDATORY overlay scrim painted OVER the image
 *    (which the renderer composites underneath). The scrim is the brand
 *    gradient at `1 - imageOpacity` so the image shows through at
 *    `imageOpacity` (20–60%) while text contrast is preserved. The image
 *    is NEVER rendered raw — this fragment is always present on top of it.
 */
export function buildBackgroundLayerSvg(input: {
  mode: BackgroundMode;
  width: number;
  height: number;
  imageOpacity: number;
}): string {
  if (input.mode === 'gradient') {
    return `<rect width="${input.width}" height="${input.height}" fill="url(#infographicBgGradient)" />`;
  }
  // overlayOpacity in [0.4, 0.8] — guarantees the scrim is at least 40%,
  // keeping header/card text readable over any image.
  const overlayOpacity = round2(
    Math.min(0.8, Math.max(0.4, 1 - input.imageOpacity)),
  );
  return `<rect width="${input.width}" height="${input.height}" fill="url(#infographicBgGradient)" opacity="${overlayOpacity}" />`;
}
