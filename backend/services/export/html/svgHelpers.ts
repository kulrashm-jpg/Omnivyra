// SVG / visual chart rendering helpers

import { clampPercent, displayScore, escapeHtml, getStateBadgeClass, getStateBarClass, getStateTone, safeText } from './htmlHelpers';

export function renderBarSvg(values: Array<{ label: string; value: number; color: string }>): string {
  const compactLabel = (label: string): string => {
    const normalized = safeText(label, 1);
    return normalized.length > 44 ? `${normalized.slice(0, 41).trim()}...` : normalized;
  };
  const max = Math.max(...values.map((item) => item.value), 1);
  return `
    <div class="chart-list" role="img" aria-label="bar chart">
      ${values.map((item) => {
        const scaled = Math.max(8, Math.round((item.value / max) * 100));
        return `
          <div class="chart-row">
            <div class="chart-label" title="${escapeHtml(item.label)}">${escapeHtml(compactLabel(item.label))}</div>
            <div class="chart-track"><div class="chart-fill" style="width:${scaled}%;background:${escapeHtml(item.color)};"></div></div>
            <div class="chart-value">${item.value}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function renderTrendSvg(pointsA: number[], pointsB?: number[]): string {
  const width = 320;
  const height = 120;
  const step = pointsA.length > 1 ? width / (pointsA.length - 1) : width;
  const toPath = (points: number[]) => points.map((point, index) => {
    const x = index * step;
    const y = height - ((clampPercent(point) / 100) * (height - 20)) - 10;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  const dots = (points: number[], color: string) => points.map((point, index) => {
    const x = index * step;
    const y = height - ((clampPercent(point) / 100) * (height - 20)) - 10;
    return `<circle cx="${x}" cy="${y}" r="3" fill="${color}"></circle>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${width} ${height}" class="svg-chart" role="img" aria-label="trend chart">
      <line x1="0" y1="${height - 10}" x2="${width}" y2="${height - 10}" stroke="#d7e2ef" />
      <line x1="0" y1="10" x2="0" y2="${height - 10}" stroke="#d7e2ef" />
      <path d="${toPath(pointsA)}" fill="none" stroke="#4f7cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots(pointsA, '#4f7cff')}
      ${pointsB && pointsB.length ? `<path d="${toPath(pointsB)}" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>${dots(pointsB, '#f59e0b')}` : ''}
    </svg>
  `;
}

export function renderRadarSvg(values: Array<{ label: string; value: number }>): string {
  const center = 90;
  const radius = 62;
  const points = values.map((item, index) => {
    const angle = ((Math.PI * 2) / values.length) * index - Math.PI / 2;
    const scaled = (clampPercent(item.value) / 100) * radius;
    const x = center + Math.cos(angle) * scaled;
    const y = center + Math.sin(angle) * scaled;
    const labelX = center + Math.cos(angle) * (radius + 18);
    const labelY = center + Math.sin(angle) * (radius + 18);
    return { x, y, labelX, labelY, label: item.label };
  });
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
  const axes = points.map((point) => `<line x1="${center}" y1="${center}" x2="${point.labelX - (point.labelX > center ? 8 : -8)}" y2="${point.labelY - (point.labelY > center ? 8 : -8)}" stroke="#d7e2ef" />`).join('');
  const labels = points.map((point) => `<text x="${point.labelX}" y="${point.labelY}" font-size="10" text-anchor="middle" fill="#61718a">${escapeHtml(point.label)}</text>`).join('');
  return `
    <svg viewBox="0 0 180 180" class="svg-chart radar" role="img" aria-label="radar chart">
      <circle cx="${center}" cy="${center}" r="${radius}" fill="#f8fbff" stroke="#d7e2ef"></circle>
      <circle cx="${center}" cy="${center}" r="${Math.round(radius * 0.66)}" fill="none" stroke="#e7edf7"></circle>
      <circle cx="${center}" cy="${center}" r="${Math.round(radius * 0.33)}" fill="none" stroke="#e7edf7"></circle>
      ${axes}
      <polygon points="${polygon}" fill="rgba(79,124,255,0.18)" stroke="#4f7cff" stroke-width="2"></polygon>
      ${labels}
    </svg>
  `;
}

export function renderMetricGrid(values: Array<{ label: string; value: number | null | undefined; color: string; note?: string }>): string {
  return `
    <div class="metric-grid-2">
      ${values.map((item) => {
        const score = Number(item.value ?? 0);
        return `
          <article class="metric-card no-break">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(displayScore(item.value, item.value == null ? 'MISSING' : 'AVAILABLE'))}</strong>
            <div class="bar"><span style="width:${item.value == null ? 0 : clampPercent(score)}%;background:${escapeHtml(item.color)};"></span></div>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

export function renderMetricRowCard(item: { label: string; value: number | null | undefined; color: string; note?: string }): string {
  const score = Number(item.value ?? 0);
  return `
    <article class="metric-card metric-row-card no-break">
      <div class="metric-row-card-label">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(displayScore(item.value, item.value == null ? 'MISSING' : 'AVAILABLE'))}</strong>
      </div>
      <div class="metric-row-card-bar">
        <div class="bar"><span style="width:${item.value == null ? 0 : clampPercent(score)}%;background:${escapeHtml(item.color)};"></span></div>
      </div>
      <div class="metric-row-card-note">${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}</div>
    </article>
  `;
}

export function renderVisualMetricBlock(
  label: string,
  score: number | null | undefined,
  note: string,
  benchmark?: number | null,
): string {
  const gap = score != null && benchmark != null ? Math.round(score - benchmark) : null;
  return `<article class="card visual-metric no-break"><div class="label">${escapeHtml(label)}</div><div class="metric-row"><div class="${score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(score, score == null ? 'MISSING' : 'AVAILABLE'))}</div><span class="badge ${getStateBadgeClass(score)}">${score == null ? 'Missing' : getStateTone(score) === 'green' ? 'Strong' : getStateTone(score) === 'yellow' ? 'Developing' : 'Constraint'}</span></div><div class="bar-track"><div class="bar-fill ${getStateBarClass(score)}" style="width:${score == null ? 0 : clampPercent(score)}%"></div></div>${benchmark != null ? `<div class="metric-meta"><span>Benchmark ${escapeHtml(displayScore(benchmark, 'AVAILABLE'))}</span><span>${gap == null ? '--' : gap >= 0 ? `+${gap} gap` : `${gap} gap`}</span></div>` : ''}<p style="margin-top:8px;">${escapeHtml(note)}</p></article>`;
}
