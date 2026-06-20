/**
 * Unified Infographic Enhancement — Phase 7 tests.
 *
 * Covers the deterministic, pure data-card foundation: chart cards
 * (bar/line/pie), table cards, background image mode, brand adoption,
 * validation/fallback, and backward-compatibility of the gradient path.
 *
 * These exercise pure SVG-string builders — no sharp, no network — so
 * they are fast and fully deterministic.
 */

import {
  infographicChartsEnabled,
  infographicTablesEnabled,
  infographicBackgroundImagesEnabled,
  normalizeChartData,
  normalizeChartSpec,
  normalizeTableSpec,
  resolveStructuredCards,
  resolveSeriesColors,
  resolveBackgroundConfig,
  buildBackgroundLayerSvg,
  buildChartCardSvg,
  buildTableCardSvg,
  formatValue,
  CHART_MAX_POINTS,
  TABLE_MAX_ROWS,
  TABLE_MAX_COLUMNS,
  type InfographicCardBrand,
  type ChartCardSpec,
  type TableCardSpec,
  type CardGeometry,
} from '../../services/creator/infographicDataCards';

const BRAND: InfographicCardBrand = {
  palette: ['#0f172a', '#22c55e', '#0ea5e9', '#a855f7'],
  accent: '#22c55e',
  fontFamily: 'Inter, Arial',
  text: '#111827',
  bodyTextColor: '#334155',
  panel: '#ffffff',
  fontMultiplier: 1,
};

const GEOM: CardGeometry = { x: 80, y: 200, width: 480, height: 460 };

// Count occurrences of a tag in an SVG fragment.
const count = (svg: string, tag: string): number =>
  (svg.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;

describe('feature flags — default OFF', () => {
  const KEYS = [
    'INFOGRAPHIC_CHARTS_ENABLED',
    'INFOGRAPHIC_TABLES_ENABLED',
    'INFOGRAPHIC_BACKGROUND_IMAGES_ENABLED',
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }));
  afterEach(() => KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }));

  it('all three flags are OFF when unset', () => {
    expect(infographicChartsEnabled()).toBe(false);
    expect(infographicTablesEnabled()).toBe(false);
    expect(infographicBackgroundImagesEnabled()).toBe(false);
  });

  it('enable only with the exact string "true"', () => {
    process.env.INFOGRAPHIC_CHARTS_ENABLED = 'true';
    process.env.INFOGRAPHIC_TABLES_ENABLED = '1';
    process.env.INFOGRAPHIC_BACKGROUND_IMAGES_ENABLED = 'TRUE';
    expect(infographicChartsEnabled()).toBe(true);
    expect(infographicTablesEnabled()).toBe(false); // '1' is not 'true'
    expect(infographicBackgroundImagesEnabled()).toBe(false); // case-sensitive
  });
});

describe('normalizeChartData', () => {
  it('keeps valid label+finite-value points', () => {
    const out = normalizeChartData([
      { label: 'A', value: 10 },
      { label: 'B', value: 0 },
      { label: 'C', value: 3.5 },
    ]);
    expect(out).toHaveLength(3);
  });

  it('drops missing labels, non-finite, and non-objects', () => {
    const out = normalizeChartData([
      { label: '', value: 5 },
      { label: 'ok', value: Number.NaN },
      { label: 'ok2', value: Infinity },
      { label: 'good', value: 7 },
      null,
      'nope',
    ]);
    expect(out).toEqual([{ label: 'good', value: 7 }]);
  });

  it('caps at CHART_MAX_POINTS (8)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, value: i }));
    expect(normalizeChartData(many)).toHaveLength(CHART_MAX_POINTS);
  });

  it('returns [] for non-arrays', () => {
    expect(normalizeChartData(undefined)).toEqual([]);
    expect(normalizeChartData({})).toEqual([]);
  });
});

describe('normalizeChartSpec', () => {
  it('defaults unknown chartType to bar', () => {
    const s = normalizeChartSpec({ type: 'chart', chartType: 'wat', title: 'T', data: [{ label: 'a', value: 1 }] });
    expect(s?.chartType).toBe('bar');
  });

  it('rejects pie when every value is <= 0', () => {
    const s = normalizeChartSpec({ type: 'chart', chartType: 'pie', title: 'T', data: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] });
    expect(s).toBeNull();
  });

  it('rejects non-chart and empty-data specs', () => {
    expect(normalizeChartSpec({ type: 'table' })).toBeNull();
    expect(normalizeChartSpec({ type: 'chart', data: [] })).toBeNull();
  });
});

describe('buildChartCardSvg — bar', () => {
  const spec: ChartCardSpec = {
    type: 'chart', chartType: 'bar', title: 'Revenue',
    data: [{ label: 'Q1', value: 10 }, { label: 'Q2', value: 20 }, { label: 'Q3', value: 40 }],
  };

  it('renders one rect bar per data point (plus panel base + stripe)', () => {
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    expect(svg).toBeTruthy();
    // 2 base rects (panel + accent stripe) + 3 bars = 5 rects.
    expect(count(svg, 'rect')).toBe(5);
  });

  it('scales the tallest bar to the max value (taller = larger value)', () => {
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    const heights = [...svg.matchAll(/<rect[^>]*height="(\d+)"[^>]*rx="4"/g)].map((m) => Number(m[1]));
    expect(heights).toHaveLength(3);
    // Q3 (40) is the max → its bar must be the tallest; Q1 (10) shortest.
    expect(Math.max(...heights)).toBe(heights[2]);
    expect(Math.min(...heights)).toBe(heights[0]);
  });

  it('uses native <text> only — no foreignObject', () => {
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    expect(svg).not.toContain('foreignObject');
    expect(count(svg, 'text')).toBeGreaterThan(0);
  });

  it('adopts brand font + accent', () => {
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    expect(svg).toContain('font-family="Inter, Arial"');
    expect(svg).toContain('#22c55e'); // accent stripe / first bar
  });
});

describe('buildChartCardSvg — line', () => {
  it('renders a polyline + one dot per point', () => {
    const spec: ChartCardSpec = {
      type: 'chart', chartType: 'line', title: 'Trend',
      data: [{ label: 'M', value: 3 }, { label: 'T', value: 8 }, { label: 'W', value: 5 }],
    };
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    expect(count(svg, 'polyline')).toBe(1);
    expect(count(svg, 'circle')).toBe(3);
  });
});

describe('buildChartCardSvg — pie/donut', () => {
  it('renders slices + donut hole + legend swatches', () => {
    const spec: ChartCardSpec = {
      type: 'chart', chartType: 'pie', title: 'Share',
      data: [{ label: 'Direct', value: 50 }, { label: 'Search', value: 30 }, { label: 'Social', value: 20 }],
    };
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    expect(count(svg, 'path')).toBe(3); // 3 slices
    expect(count(svg, 'circle')).toBe(1); // donut hole
    // legend percentages present
    expect(svg).toContain('50%');
    expect(svg).toContain('30%');
    expect(svg).toContain('20%');
  });

  it('draws a full circle when a single slice is 100%', () => {
    const spec: ChartCardSpec = {
      type: 'chart', chartType: 'pie', title: 'All',
      data: [{ label: 'Only', value: 100 }, { label: 'Zero', value: 0 }],
    };
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    // full-circle slice + donut hole = 2 circles, no degenerate arc path.
    expect(count(svg, 'circle')).toBe(2);
    expect(count(svg, 'path')).toBe(0);
  });
});

describe('buildChartCardSvg — overflow / fallback', () => {
  it('returns null for empty data (caller falls back to legacy card)', () => {
    expect(buildChartCardSvg({ type: 'chart', chartType: 'bar', title: 'x', data: [] }, GEOM, BRAND)).toBeNull();
  });

  it('returns null when the card is too small to host a chart', () => {
    const tiny: CardGeometry = { x: 0, y: 0, width: 40, height: 40 };
    const spec: ChartCardSpec = { type: 'chart', chartType: 'bar', title: 'x', data: [{ label: 'a', value: 1 }] };
    expect(buildChartCardSvg(spec, tiny, BRAND)).toBeNull();
  });

  it('caps at 8 bars even when more points are supplied', () => {
    const spec: ChartCardSpec = {
      type: 'chart', chartType: 'bar', title: 'many',
      data: Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: i + 1 })),
    };
    const svg = buildChartCardSvg(spec, GEOM, BRAND)!;
    const bars = [...svg.matchAll(/rx="4"/g)].length;
    expect(bars).toBe(CHART_MAX_POINTS);
  });
});

describe('normalizeTableSpec', () => {
  it('caps columns at 4 and rows at 6, rectangularizes ragged rows', () => {
    const s = normalizeTableSpec({
      type: 'table', title: 'T',
      columns: ['a', 'b', 'c', 'd', 'e', 'f'],
      rows: Array.from({ length: 10 }, () => ['1', '2']),
    })!;
    expect(s.columns).toHaveLength(TABLE_MAX_COLUMNS);
    expect(s.rows).toHaveLength(TABLE_MAX_ROWS);
    s.rows.forEach((r) => expect(r).toHaveLength(TABLE_MAX_COLUMNS)); // padded to col count
  });

  it('truncates long cell text with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const s = normalizeTableSpec({ type: 'table', title: 'T', columns: ['c'], rows: [[long]] })!;
    expect(s.rows[0][0].length).toBeLessThanOrEqual(28);
    expect(s.rows[0][0].endsWith('…')).toBe(true);
  });

  it('returns null with no columns', () => {
    expect(normalizeTableSpec({ type: 'table', title: 'T', columns: [], rows: [] })).toBeNull();
  });
});

describe('buildTableCardSvg', () => {
  it('renders a 2x2 table with a header band + cells', () => {
    const spec: TableCardSpec = {
      type: 'table', title: 'Metrics',
      columns: ['Metric', 'Value'],
      rows: [['Leads', '120'], ['MQLs', '34']],
    };
    const svg = buildTableCardSvg(spec, GEOM, BRAND)!;
    expect(svg).toContain('Metric');
    expect(svg).toContain('120');
    // header texts (2) + body cell texts (4) + title = 7 text nodes min
    expect(count(svg, 'text')).toBeGreaterThanOrEqual(7);
    expect(svg).not.toContain('foreignObject');
  });

  it('handles a full 4x6 table without overflowing the card', () => {
    const spec: TableCardSpec = {
      type: 'table', title: 'Big',
      columns: ['A', 'B', 'C', 'D'],
      rows: Array.from({ length: 6 }, (_, r) => ['w', 'x', 'y', `row${r}`]),
    };
    const svg = buildTableCardSvg(spec, GEOM, BRAND)!;
    // All Y coordinates must stay within the card bounds.
    const ys = [...svg.matchAll(/y="(\d+)"/g)].map((m) => Number(m[1]));
    const maxY = Math.max(...ys);
    expect(maxY).toBeLessThanOrEqual(GEOM.y + GEOM.height);
  });

  it('returns null for an empty-columns spec (fallback)', () => {
    expect(buildTableCardSvg({ type: 'table', title: 'x', columns: [], rows: [] }, GEOM, BRAND)).toBeNull();
  });
});

describe('resolveStructuredCards', () => {
  it('maps specs by index, validating each', () => {
    const map = resolveStructuredCards({
      infographic_cards: [
        { index: 0, type: 'chart', chartType: 'bar', title: 'c', data: [{ label: 'a', value: 1 }] },
        { index: 2, type: 'table', title: 't', columns: ['x'], rows: [['1']] },
        { index: 3, type: 'chart', data: [] }, // invalid → dropped
      ],
    });
    expect(map.get(0)?.type).toBe('chart');
    expect(map.get(2)?.type).toBe('table');
    expect(map.has(3)).toBe(false);
  });

  it('falls back to list position when index is absent', () => {
    const map = resolveStructuredCards({
      infographic_cards: [{ type: 'table', title: 't', columns: ['x'], rows: [['1']] }],
    });
    expect(map.get(0)?.type).toBe('table');
  });

  it('reads from creator_card.infographic_cards too', () => {
    const map = resolveStructuredCards({
      creator_card: { infographic_cards: [{ index: 1, type: 'table', title: 't', columns: ['x'], rows: [] }] },
    });
    expect(map.get(1)?.type).toBe('table');
  });

  it('returns an empty map for metadata without structured cards (DEFAULT)', () => {
    expect(resolveStructuredCards({}).size).toBe(0);
    expect(resolveStructuredCards({ topic: 'x', summary: 'y' }).size).toBe(0);
  });
});

describe('resolveSeriesColors — brand adoption', () => {
  it('leads with the brand accent, then palette, all distinct', () => {
    const colors = resolveSeriesColors(BRAND, 4);
    expect(colors[0]).toBe('#22c55e'); // accent first
    expect(new Set(colors).size).toBe(4); // distinct
  });

  it('falls back to an accessible ramp when the kit is sparse', () => {
    const sparse: InfographicCardBrand = { ...BRAND, palette: [], accent: 'not-a-color' };
    const colors = resolveSeriesColors(sparse, 3);
    expect(colors).toHaveLength(3);
    colors.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
  });
});

describe('background mode', () => {
  it('defaults to gradient', () => {
    expect(resolveBackgroundConfig({}).mode).toBe('gradient');
    expect(resolveBackgroundConfig({ backgroundMode: 'image' }).mode).toBe('gradient'); // no URL
  });

  it('selects image mode only with a usable URL', () => {
    const cfg = resolveBackgroundConfig({ backgroundMode: 'image', backgroundImageUrl: 'https://x/y.png' });
    expect(cfg.mode).toBe('image');
    expect(cfg.imageUrl).toBe('https://x/y.png');
  });

  it('clamps opacity into [0.2, 0.6]', () => {
    expect(resolveBackgroundConfig({ backgroundMode: 'image', backgroundImageUrl: 'https://x', imageOpacity: 0.9 }).imageOpacity).toBe(0.6);
    expect(resolveBackgroundConfig({ backgroundMode: 'image', backgroundImageUrl: 'https://x', imageOpacity: 0.05 }).imageOpacity).toBe(0.2);
  });

  it('gradient layer SVG is byte-identical to the legacy background rect', () => {
    const svg = buildBackgroundLayerSvg({ mode: 'gradient', width: 1200, height: 1500, imageOpacity: 0.45 });
    expect(svg).toBe('<rect width="1200" height="1500" fill="url(#infographicBgGradient)" />');
  });

  it('image layer ALWAYS paints a mandatory overlay scrim (>= 40% opacity)', () => {
    const svg = buildBackgroundLayerSvg({ mode: 'image', width: 1200, height: 1500, imageOpacity: 0.6 });
    const m = svg.match(/opacity="([\d.]+)"/);
    expect(m).toBeTruthy();
    const overlay = Number(m![1]);
    expect(overlay).toBeGreaterThanOrEqual(0.4); // contrast protection
    expect(overlay).toBeLessThanOrEqual(0.8);
  });
});

describe('formatValue', () => {
  it('compacts thousands and millions, keeps integers clean', () => {
    expect(formatValue(42)).toBe('42');
    expect(formatValue(1500)).toBe('1.5K');
    expect(formatValue(2_000_000)).toBe('2M');
  });
});
