/**
 * Dossier v2 — chart primitives. Inline SVG only: vector in the PDF, text stays extractable, no
 * script, no external asset. Every chart takes already-derived values; none computes a metric.
 *
 * Colour is never the only carrier of meaning: every state also has a text label or glyph.
 */
import { escape } from '../exportRendererCore';

export const PALETTE = {
  navy: '#0B1F3A',
  ink: '#16233A',
  blue: '#1E6FD9',
  blueSoft: '#DCE9FB',
  green: '#1B8A5A',
  greenSoft: '#DDF1E7',
  amber: '#B7791F',
  amberSoft: '#FBEFD9',
  crimson: '#B4233C',
  crimsonSoft: '#F8DEE3',
  grey: '#5B6779',
  greyMid: '#9AA5B5',
  line: '#E2E7EE',
  wash: '#F4F6F9',
} as const;

/** Band colour for a 0–100 score; null renders as "not measured" grey. */
export function scoreColor(value: number | null): string {
  if (value == null) return PALETTE.greyMid;
  if (value >= 75) return PALETTE.green;
  if (value >= 50) return PALETTE.blue;
  if (value >= 25) return PALETTE.amber;
  return PALETTE.crimson;
}

/** Large score ring for the executive dashboard. */
export function scoreRing(value: number | null, label: string, size = 150): string {
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const color = scoreColor(value);
  return `<svg class="v2-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escape(label)}: ${value ?? 'not measured'} of 100">
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${PALETTE.line}" stroke-width="12"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
    stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  <text x="50%" y="48%" text-anchor="middle" dominant-baseline="middle" font-size="${size * 0.3}" font-weight="700" fill="${PALETTE.navy}">${value ?? '—'}</text>
  <text x="50%" y="68%" text-anchor="middle" font-size="${size * 0.085}" fill="${PALETTE.grey}">of 100</text>
</svg>`;
}

export type BarRow = { label: string; value: number | null; note?: string; tag?: string };

/** Horizontal bars, 0–100 axis. Null rows render as an explicit "not measured" row, never zero. */
export function barChart(rows: BarRow[], opts: { width?: number; labelWidth?: number } = {}): string {
  const width = opts.width ?? 620;
  const labelW = opts.labelWidth ?? 170;
  const rowH = 27;
  const plotW = width - labelW - 40;
  const h = rows.length * rowH + 26;
  const ticks = [0, 25, 50, 75, 100];
  const grid = ticks.map((t) => {
    const x = labelW + (plotW * t) / 100;
    return `<line x1="${x}" y1="4" x2="${x}" y2="${h - 20}" stroke="${PALETTE.line}" stroke-width="1"/>
    <text x="${x}" y="${h - 6}" text-anchor="middle" font-size="9" fill="${PALETTE.greyMid}">${t}</text>`;
  }).join('');
  const bars = rows.map((row, i) => {
    const y = 6 + i * rowH;
    const label = `<text x="0" y="${y + 13}" font-size="11" font-weight="600" fill="${PALETTE.ink}">${escape(row.label)}</text>
      ${row.tag ? `<text x="0" y="${y + 24}" font-size="8.5" fill="${PALETTE.grey}">${escape(row.tag)}</text>` : ''}`;
    if (row.value == null) {
      // The note sits inside the hatched track so it can never run past the chart edge.
      return `${label}<rect x="${labelW}" y="${y + 3}" width="${plotW}" height="14" rx="3" fill="url(#v2-hatch)" stroke="${PALETTE.line}"/>
        <text x="${labelW + 8}" y="${y + 13.5}" font-size="9.5" font-weight="600" fill="${PALETTE.grey}">${escape(row.note ?? 'not measured')} — no value</text>`;
    }
    const w = Math.max(2, (plotW * Math.max(0, Math.min(100, row.value))) / 100);
    return `${label}<rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="14" rx="3" fill="${scoreColor(row.value)}"/>
      <text x="${labelW + w + 6}" y="${y + 14}" font-size="11" font-weight="700" fill="${PALETTE.ink}">${row.value}</text>`;
  }).join('');
  return `<svg class="v2-chart" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Score bars">
  <defs><pattern id="v2-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="${PALETTE.wash}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${PALETTE.line}" stroke-width="2"/></pattern></defs>
  ${grid}${bars}</svg>`;
}

export type StackSegment = { label: string; count: number; color: string };

/** One horizontal 100% stacked bar per row (e.g. check outcomes per group). */
export function stackedRows(rows: Array<{ label: string; segments: StackSegment[] }>, width = 620): string {
  const labelW = 170;
  const plotW = width - labelW - 40;
  const rowH = 24;
  const h = rows.length * rowH + 6;
  const body = rows.map((row, i) => {
    const y = 4 + i * rowH;
    const total = row.segments.reduce((a, s) => a + s.count, 0) || 1;
    let x = labelW;
    const segs = row.segments.filter((s) => s.count > 0).map((s) => {
      const w = (plotW * s.count) / total;
      const out = `<rect x="${x.toFixed(1)}" y="${y + 2}" width="${w.toFixed(1)}" height="14" fill="${s.color}"><title>${escape(s.label)}: ${s.count}</title></rect>
        ${w > 16 ? `<text x="${(x + w / 2).toFixed(1)}" y="${y + 12.5}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${s.count}</text>` : ''}`;
      x += w;
      return out;
    }).join('');
    return `<text x="0" y="${y + 13}" font-size="10.5" fill="${PALETTE.ink}">${escape(row.label)}</text>${segs}
      <text x="${labelW + plotW + 6}" y="${y + 13}" font-size="9.5" fill="${PALETTE.grey}">${total}</text>`;
  }).join('');
  return `<svg class="v2-chart" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Outcome distribution">${body}</svg>`;
}

export type HeatCell = { text: string; tone: 'top' | 'mid' | 'low' | 'absent' | 'unmeasured' | 'self'; title?: string };

const TONE: Record<HeatCell['tone'], { fill: string; ink: string }> = {
  top: { fill: PALETTE.green, ink: '#fff' },
  mid: { fill: PALETTE.blue, ink: '#fff' },
  low: { fill: PALETTE.amberSoft, ink: PALETTE.ink },
  absent: { fill: PALETTE.wash, ink: PALETTE.grey },
  unmeasured: { fill: '#fff', ink: PALETTE.greyMid },
  self: { fill: PALETTE.blueSoft, ink: PALETTE.navy },
};

/** Matrix heatmap: rows × columns of labelled cells. Rendered as a table for reliable text. */
export function heatmap(columns: string[], rows: Array<{ label: string; sub?: string; cells: HeatCell[] }>): string {
  const head = columns.map((c) => `<th><span>${escape(c)}</span></th>`).join('');
  const body = rows.map((r) => `<tr><th scope="row">${escape(r.label)}${r.sub ? `<small>${escape(r.sub)}</small>` : ''}</th>${
    r.cells.map((c) => `<td style="background:${TONE[c.tone].fill};color:${TONE[c.tone].ink}"${c.title ? ` title="${escape(c.title)}"` : ''}>${escape(c.text)}</td>`).join('')
  }</tr>`).join('');
  return `<table class="v2-heat"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function heatLegend(items: Array<{ tone: HeatCell['tone']; label: string }>): string {
  return `<div class="v2-legend">${items.map((i) => `<span><i style="background:${TONE[i.tone].fill};border-color:${i.tone === 'unmeasured' ? PALETTE.line : TONE[i.tone].fill}"></i>${escape(i.label)}</span>`).join('')}</div>`;
}

export type RoadmapItem = { id: string; label: string; window: 0 | 1 | 2; dependsOn: string[]; tone: string; meta: string };

/**
 * Three-window roadmap with dependency arrows. Items stack per window; an arrow is drawn from a
 * prerequisite to its dependant only when both are on the map.
 */
export function roadmap(items: RoadmapItem[], windows: [string, string, string], width = 680): string {
  const colW = width / 3;
  const boxW = colW - 22;
  const boxH = 46;
  const gap = 10;
  const top = 34;
  const pos = new Map<string, { x: number; y: number }>();
  const perCol = [0, 0, 0];
  for (const it of items) {
    const x = it.window * colW + 11;
    const y = top + perCol[it.window] * (boxH + gap);
    perCol[it.window] += 1;
    pos.set(it.id, { x, y });
  }
  const h = top + Math.max(1, ...perCol) * (boxH + gap) + 6;
  const headers = windows.map((w, i) => `<rect x="${i * colW + 4}" y="0" width="${colW - 8}" height="${h}" rx="6" fill="${i % 2 ? '#fff' : PALETTE.wash}" stroke="${PALETTE.line}"/>
    <text x="${i * colW + colW / 2}" y="20" text-anchor="middle" font-size="11" font-weight="700" fill="${PALETTE.navy}">${escape(w)}</text>`).join('');
  const arrows = items.flatMap((it) => it.dependsOn.map((dep) => {
    const from = pos.get(dep);
    const to = pos.get(it.id);
    if (!from || !to) return '';
    const x1 = from.x + boxW;
    const y1 = from.y + boxH / 2;
    const x2 = to.x;
    const y2 = to.y + boxH / 2;
    if (x2 <= x1) {
      // Same window: route down the right edge.
      const xr = from.x + boxW + 6;
      return `<path d="M${from.x + boxW} ${y1} H${xr} V${y2} H${to.x + boxW}" fill="none" stroke="${PALETTE.greyMid}" stroke-width="1.2" marker-end="url(#v2-arrow)"/>`;
    }
    const mx = (x1 + x2) / 2;
    return `<path d="M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${PALETTE.greyMid}" stroke-width="1.2" marker-end="url(#v2-arrow)"/>`;
  })).join('');
  const boxes = items.map((it) => {
    const p = pos.get(it.id)!;
    const label = it.label.length > 58 ? `${it.label.slice(0, 56)}…` : it.label;
    const words = label.split(' ');
    const lines: string[] = [''];
    for (const w of words) {
      if ((lines[lines.length - 1] + ' ' + w).trim().length > 32 && lines.length < 2) lines.push(w);
      else lines[lines.length - 1] = `${lines[lines.length - 1]} ${w}`.trim();
    }
    return `<g><rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="5" fill="#fff" stroke="${it.tone}" stroke-width="1.5"/>
      <rect x="${p.x}" y="${p.y}" width="4" height="${boxH}" rx="2" fill="${it.tone}"/>
      ${lines.map((l, i) => `<text x="${p.x + 10}" y="${p.y + 14 + i * 12}" font-size="9.6" font-weight="600" fill="${PALETTE.ink}">${escape(l)}</text>`).join('')}
      <text x="${p.x + 10}" y="${p.y + boxH - 6}" font-size="8.2" fill="${PALETTE.grey}">${escape(it.meta)}</text></g>`;
  }).join('');
  return `<svg class="v2-chart" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Ninety-day roadmap">
  <defs><marker id="v2-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${PALETTE.greyMid}"/></marker></defs>
  ${headers}${arrows}${boxes}</svg>`;
}

/** Inline status pill. Text always states the status; colour only reinforces it. */
export function pill(text: string, tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info'): string {
  return `<span class="v2-pill v2-pill-${tone}">${escape(text)}</span>`;
}
