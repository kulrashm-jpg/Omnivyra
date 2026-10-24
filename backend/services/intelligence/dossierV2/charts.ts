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
  // Domains break only after a dot, never mid-word.
  const head = columns.map((c) => `<th><span>${escape(c).replace(/\./g, '.<wbr>')}</span></th>`).join('');
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

export type FunnelStage = { label: string; value: number; note?: string };

/** Horizontal funnel: each stage is a bar proportional to the first; the drop is labelled. */
export function funnel(stages: FunnelStage[], width = 640): string {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const labelW = 190;
  const plotW = width - labelW - 170;
  const rowH = 30;
  const h = stages.length * rowH + 6;
  const body = stages.map((s, i) => {
    const y = 4 + i * rowH;
    const w = Math.max(3, (plotW * s.value) / max);
    const prev = i > 0 ? stages[i - 1].value : null;
    const drop = prev != null && prev > s.value ? ` (−${prev - s.value})` : '';
    return `<text x="0" y="${y + 14}" font-size="10.5" font-weight="600" fill="${PALETTE.ink}">${escape(s.label)}</text>
      <rect x="${labelW}" y="${y + 3}" width="${w.toFixed(1)}" height="16" rx="3" fill="${i === stages.length - 1 ? PALETTE.blue : PALETTE.navy}" opacity="${(1 - i * 0.12).toFixed(2)}"/>
      <text x="${(labelW + w + 6).toFixed(1)}" y="${y + 15}" font-size="10.5" font-weight="700" fill="${PALETTE.ink}">${s.value}<tspan font-weight="400" fill="${PALETTE.grey}">${escape(drop)}${s.note ? ` · ${escape(s.note)}` : ''}</tspan></text>`;
  }).join('');
  return `<svg class="v2-chart" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Crawl funnel">${body}</svg>`;
}

export type MatrixPoint = { id: string; label: string; x: 0 | 1 | 2; y: 0 | 1 | 2; tone: string };

/**
 * 3×3 impact (y) × effort (x) matrix. Points sit by tier, so position encodes only the tiers the
 * sources stated — no false precision. Points sharing a cell are listed, never overlapped.
 */
export function impactEffortMatrix(points: MatrixPoint[], width = 640): string {
  const left = 70;
  const top = 10;
  const cellW = (width - left - 10) / 3;
  const cellH = 92;
  const h = top + cellH * 3 + 34;
  const cells: string[] = [];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const quick = y === 2 && x === 0;
      cells.push(`<rect x="${(left + x * cellW).toFixed(1)}" y="${top + (2 - y) * cellH}" width="${(cellW - 3).toFixed(1)}" height="${cellH - 3}" rx="4" fill="${quick ? PALETTE.greenSoft : PALETTE.wash}"/>`);
      const inCell = points.filter((p) => p.x === x && p.y === y);
      inCell.slice(0, 5).forEach((p, i) => {
        const cx = left + x * cellW + 10;
        const cy = top + (2 - y) * cellH + 16 + i * 15;
        const label = p.label.length > 34 ? `${p.label.slice(0, 32)}…` : p.label;
        cells.push(`<circle cx="${(cx + 4).toFixed(1)}" cy="${cy - 3}" r="4" fill="${p.tone}"/><text x="${(cx + 12).toFixed(1)}" y="${cy}" font-size="8.6" fill="${PALETTE.ink}">${escape(label)}</text>`);
      });
      if (inCell.length > 5) cells.push(`<text x="${(left + x * cellW + 10).toFixed(1)}" y="${top + (2 - y) * cellH + cellH - 10}" font-size="8" fill="${PALETTE.grey}">+${inCell.length - 5} more</text>`);
    }
  }
  const yLabels = ['Low', 'Medium', 'High'].map((t, i) => `<text x="${left - 8}" y="${top + (2 - i) * cellH + cellH / 2}" text-anchor="end" font-size="9.5" fill="${PALETTE.grey}">${t}</text>`).join('');
  const xLabels = ['Low effort', 'Medium effort', 'High effort'].map((t, i) => `<text x="${(left + i * cellW + cellW / 2).toFixed(1)}" y="${top + cellH * 3 + 14}" text-anchor="middle" font-size="9.5" fill="${PALETTE.grey}">${t}</text>`).join('');
  return `<svg class="v2-chart" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Impact versus effort">
  <text x="12" y="${top + cellH * 1.5}" font-size="9.5" font-weight="700" fill="${PALETTE.navy}" transform="rotate(-90 12 ${top + cellH * 1.5})" text-anchor="middle">Impact</text>
  ${cells.join('')}${yLabels}${xLabels}
  <text x="${left + 6}" y="${top + cellH - 10}" font-size="8" fill="${PALETTE.green}" font-weight="700">QUICK WINS · high impact, low effort</text></svg>`;
}

export type GraphNode = { id: string; label: string; sub?: string; kind: 'center' | 'observed' | 'declared' | 'absent' };

/** Radial entity graph. Solid edge = observed; dashed = declared, unverified; dotted grey = looked for, not found. */
export function entityGraph(center: GraphNode, nodes: GraphNode[], width = 640): string {
  const h = 270;
  const cx = width / 2;
  const cy = h / 2;
  const rx = width / 2 - 80;
  const ry = h / 2 - 30;
  const style = (k: GraphNode['kind']) => (k === 'observed'
    ? { stroke: PALETTE.green, dash: '', fill: PALETTE.greenSoft }
    : k === 'declared' ? { stroke: PALETTE.blue, dash: '5 4', fill: '#fff' } : { stroke: PALETTE.greyMid, dash: '2 4', fill: PALETTE.wash });
  const parts = nodes.map((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, nodes.length) - Math.PI / 2;
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    const st = style(n.kind);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${st.stroke}" stroke-width="1.4" stroke-dasharray="${st.dash}"/>
      <rect x="${(x - 66).toFixed(1)}" y="${(y - 17).toFixed(1)}" width="132" height="34" rx="6" fill="${st.fill}" stroke="${st.stroke}" stroke-dasharray="${st.dash}"/>
      <text x="${x.toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="9.4" font-weight="650" fill="${PALETTE.ink}">${escape(n.label)}</text>
      ${n.sub ? `<text x="${x.toFixed(1)}" y="${(y + 10).toFixed(1)}" text-anchor="middle" font-size="7.8" fill="${PALETTE.grey}">${escape(n.sub)}</text>` : ''}`;
  }).join('');
  return `<svg class="v2-chart" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Entity relationships">${parts}
    <circle cx="${cx}" cy="${cy}" r="42" fill="${PALETTE.navy}"/>
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${escape(center.label)}</text>
    ${center.sub ? `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="8" fill="#B9CBE4">${escape(center.sub)}</text>` : ''}</svg>`;
}

/** Conceptual three-layer diagram: which evidence feeds which product. Rendered under a "conceptual" label. */
export function evidenceArchitecture(width = 640): string {
  const box = (x: number, y: number, w: number, title: string, sub: string, fill: string, ink: string = PALETTE.ink) =>
    `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="44" rx="6" fill="${fill}" stroke="${PALETTE.line}"/>
     <text x="${(x + w / 2).toFixed(1)}" y="${y + 18}" text-anchor="middle" font-size="10" font-weight="700" fill="${ink}">${escape(title)}</text>
     <text x="${(x + w / 2).toFixed(1)}" y="${y + 32}" text-anchor="middle" font-size="8.2" fill="${ink === '#fff' ? '#C9D7EA' : PALETTE.grey}">${escape(sub)}</text>`;
  const arrow = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1.toFixed(1)}" y1="${y1}" x2="${x2.toFixed(1)}" y2="${y2}" stroke="${PALETTE.greyMid}" stroke-width="1.3" marker-end="url(#v2-arch)"/>`;
  const third = (width - 40) / 3;
  return `<svg class="v2-chart" viewBox="0 0 ${width} 216" width="100%" role="img" aria-label="Evidence architecture (conceptual)">
  <defs><marker id="v2-arch" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${PALETTE.greyMid}"/></marker></defs>
  ${box(0, 0, third, 'Public evidence', 'crawl · search results · public profiles', PALETTE.blueSoft)}
  ${box(third + 20, 0, third, 'Company-declared', 'profile set up by the company', PALETTE.wash)}
  ${box(2 * third + 40, 0, third, 'Private / owned data', 'analytics · CRM · ad accounts', PALETTE.wash)}
  ${arrow(third / 2, 44, width / 2 - 60, 80)}${arrow(third * 1.5 + 20, 44, width / 2, 80)}${arrow(2.5 * third + 40, 44, width / 2 + 60, 80)}
  ${box(width / 2 - 170, 82, 340, 'Shared evidence layer → company intelligence', 'every observation keeps its source, date and status', PALETTE.navy, '#fff')}
  ${arrow(width / 2 - 90, 126, third / 2 + 20, 166)}${arrow(width / 2 + 90, 126, 2.5 * third + 20, 166)}
  ${box(0, 168, third + 40, 'This Digital Snapshot', 'public + company-declared evidence only', PALETTE.greenSoft)}
  ${box(2 * third, 168, third + 40, 'Marketing Intelligence', 'adds private, owned performance data', PALETTE.wash)}
</svg>`;
}
