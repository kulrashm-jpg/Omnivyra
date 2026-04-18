import { clampPercent, escapeHtml, safeText } from './reportHtmlCoreUtils';

/**
 * Renders an SVG donut/circle score visualization — McKinsey-style.
 * size: 'lg' (cover) or 'sm' (inline metric).
 */
export function renderScoreDonut(
  score: number | null | undefined,
  options?: { size?: 'lg' | 'sm'; label?: string },
): string {
  const sz = options?.size ?? 'lg';
  const dim = sz === 'lg' ? 110 : 70;
  const stroke = sz === 'lg' ? 8 : 6;
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = clampPercent(score);
  const offset = circumference - (pct / 100) * circumference;
  const displayed = score != null && !Number.isNaN(score) ? String(Math.round(score)) : '--';
  const color = pct >= 50 ? '#1B7340' : pct >= 30 ? '#B45309' : pct > 0 ? '#991B1B' : '#8C9DAB';
  const trackColor = '#E8EFF6';
  const labelClass = sz === 'lg' ? 'score-circle-label score-circle-label-lg' : 'score-circle-label score-circle-label-sm';
  return `<div class="score-circle-wrap" style="width:${dim}px;height:${dim}px;">
    <svg width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">
      <circle cx="${dim / 2}" cy="${dim / 2}" r="${radius}" fill="none" stroke="${trackColor}" stroke-width="${stroke}" />
      <circle cx="${dim / 2}" cy="${dim / 2}" r="${radius}" fill="none" stroke="${escapeHtml(color)}" stroke-width="${stroke}"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        stroke-linecap="round" transform="rotate(-90 ${dim / 2} ${dim / 2})" />
    </svg>
    <div class="${labelClass}">${escapeHtml(displayed)}</div>
  </div>${options?.label ? `<div class="label" style="text-align:center;margin-top:4px;">${escapeHtml(options.label)}</div>` : ''}`;
}

/**
 * Renders a horizontal comparative bar — "You vs Market Leader" style.
 */
export function renderComparisonBar(
  label: string,
  yourScore: number | null | undefined,
  marketScore: number,
  marketLabel?: string,
): string {
  const you = clampPercent(yourScore);
  const market = clampPercent(marketScore);
  const yourColor = you >= 50 ? '#1B7340' : you >= 30 ? '#B45309' : '#991B1B';
  return `<div class="comparison-bar-block no-break" style="margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;">
      <span style="font-size:12px;font-weight:600;color:#1A3A50;">${escapeHtml(label)}</span>
    </div>
    <div style="margin-bottom:4px;">
      <div class="label" style="margin-bottom:2px;">Your Score</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="bar-track" style="flex:1;height:8px;"><div class="bar-fill" style="width:${you}%;background:${yourColor};height:100%;border-radius:3px;"></div></div>
        <span style="font-size:12px;font-weight:700;color:#051C2C;min-width:28px;text-align:right;">${you > 0 ? you : '--'}</span>
      </div>
    </div>
    <div>
      <div class="label" style="margin-bottom:2px;">${escapeHtml(marketLabel || 'Market Leader')}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="bar-track" style="flex:1;height:8px;"><div class="bar-fill" style="width:${market}%;background:#0077B6;height:100%;border-radius:3px;"></div></div>
        <span style="font-size:12px;font-weight:700;color:#051C2C;min-width:28px;text-align:right;">${market}</span>
      </div>
    </div>
  </div>`;
}

/**
 * Renders a performance score card grid matching the PDF reference — 4 score boxes in a row.
 */
export function renderPerformanceScoreRow(
  items: Array<{ label: string; score: number | null | undefined; benchmark: number; note?: string }>,
): string {
  return `<div style="display:grid;grid-template-columns:repeat(${Math.min(items.length, 4)}, 1fr);gap:12px;">
    ${items.map((item) => {
      const score = item.score != null ? Math.round(item.score) : null;
      const gap = score != null ? score - item.benchmark : null;
      const highlighted = item.label === 'Authority';
      return `<article class="card no-break" style="${highlighted ? 'border:2px solid #051C2C;' : ''}">
        <div class="label">${escapeHtml(item.label)}</div>
        <div class="${score == null ? 'score-missing' : 'score-med'}" style="margin:6px 0 4px;">${score != null ? escapeHtml(String(score)) : '--'}</div>
        ${gap != null ? `<div style="font-size:11px;color:${gap >= 0 ? '#1B7340' : '#991B1B'};font-weight:600;">${gap >= 0 ? '+' : ''}${gap} vs benchmark</div>` : '<div style="font-size:11px;color:#8C9DAB;">Missing benchmark data</div>'}
        ${item.note ? `<p style="font-size:11px;margin-top:4px;">${escapeHtml(item.note)}</p>` : ''}
      </article>`;
    }).join('')}
  </div>`;
}

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

export function displayScore(score: number | null | undefined, dataStrength: string): string {
  if (score == null || Number.isNaN(score)) return dataStrength === 'MISSING' ? 'Not Available' : '0';
  return `${Math.round(score)}/100`;
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

export function renderExecutiveInsights(items: Array<{ title: string; impact: string; highImpact?: boolean }>): string {
  return `
    <div class="executive-insights">
      <h3>Key Insights (What You Should Know Immediately)</h3>
      <div class="grid-2">
        ${items.map((item) => `
          <article class="insight-card ${item.highImpact ? 'high-impact' : ''}">
            <div class="insight-title">${escapeHtml(item.title)}</div>
            <div class="insight-impact">Business Impact: ${escapeHtml(item.impact)}</div>
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

export function renderBeforeAfter(current: string[], future: string[]): string {
  return `
    <div class="before-after">
      <div class="before-after-col">
        <h4>What the site says now</h4>
        <ul>${current.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="before-after-col">
        <h4>What it needs to say</h4>
        <ul>${future.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
    </div>
  `;
}

export function renderScoreComparison(label: string, yourScore: number | null | undefined, marketLabel: string, marketScore: number): string {
  return `
    <div class="score-comparison">
      <div class="score-comparison-title">${escapeHtml(label)}</div>
      <div class="score-comparison-values">
        <span>Your score: <strong>${escapeHtml(displayScore(yourScore, yourScore == null ? 'MISSING' : 'AVAILABLE'))}</strong></span>
        <span>${escapeHtml(marketLabel)}: <strong>${Math.round(marketScore)}/100</strong></span>
      </div>
    </div>
  `;
}

export function renderMiniMetrics(items: Array<{ label: string; value: string }>): string {
  return `<div class="mini-metrics">${items.map((item) => `
    <div class="mini-metric">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>
  `).join('')}</div>`;
}

export function renderCalloutBox(text: string): string {
  return `<div class="callout-box">${escapeHtml(text)}</div>`;
}

export function renderCompactBulletLine(items: string[]): string {
  return items.length ? `<div class="compact-bullets">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : '';
}

export function estimateBlockUnits(text: string, base = 8): number {
  return Math.max(base, Math.ceil(text.length / 120));
}

export function renderInlineSummary(items: string[]): string {
  return items.length ? `<p class="inline-summary">${items.map((item) => escapeHtml(item)).join(' ')}</p>` : '';
}

export function renderRadarSvg(values: Array<{ label: string; value: number }>): string {
  const radius = 90;
  const center = 110;
  const angleStep = (Math.PI * 2) / values.length;
  const point = (value: number, index: number, scale = 1) => {
    const angle = -Math.PI / 2 + (index * angleStep);
    const r = radius * scale * (clampPercent(value) / 100);
    return [center + Math.cos(angle) * r, center + Math.sin(angle) * r];
  };
  const polygon = values.map((item, index) => point(item.value, index).join(',')).join(' ');
  const labelNodes = values.map((item, index) => {
    const [x, y] = point(100, index, 1.18);
    return `<text x="${x}" y="${y}" text-anchor="middle">${escapeHtml(item.label)}</text>`;
  }).join('');
  return `
    <svg viewBox="0 0 220 220" class="svg-chart" role="img" aria-label="radar chart">
      <polygon points="${polygon}" fill="rgba(79,124,255,0.15)" stroke="#4f7cff" stroke-width="2"></polygon>
      ${labelNodes}
    </svg>
  `;
}

export function renderFillQuote(title: string, quote: string, note?: string): string {
  return `<div class="fill-quote"><strong>${escapeHtml(title)}</strong><blockquote>${escapeHtml(quote)}</blockquote>${note ? `<p>${escapeHtml(note)}</p>` : ''}</div>`;
}

export function renderReportBlock(
  type: string,
  body: string,
  options?: { className?: string; group?: string; keepTogether?: boolean; fill?: boolean },
): string {
  const classes = [
    'report-block',
    `report-block-${type}`,
    options?.className ?? '',
    options?.keepTogether ? 'keep-together' : '',
    options?.fill ? 'report-block-fill' : '',
  ].filter(Boolean).join(' ');
  const groupAttr = options?.group ? ` data-group="${escapeHtml(options.group)}"` : '';
  return `<div class="${classes}"${groupAttr}>${body}</div>`;
}

export function renderNarrativeGroup(
  id: string,
  title: string,
  kicker: string,
  items: string[],
  options?: { keepTogether?: boolean; hideHeading?: boolean },
): string {
  const keepClass = options?.keepTogether ? ' keep-together' : '';
  const divider = options?.hideHeading
    ? ''
    : `<div class="section-divider"><div class="section-divider-line"></div><span class="section-divider-label">${escapeHtml(kicker)}</span><div class="section-divider-line"></div></div>`;
  const heading = options?.hideHeading
    ? ''
    : `<div class="section-heading-anchor"><h2>${escapeHtml(title)}</h2></div>`;
  return `<section id="${escapeHtml(id)}" class="narrative-flow-group${keepClass}">${divider}${heading}${items.join('')}</section>`;
}

export function stripLeadingSectionHeader(html: string): string {
  return html.replace(/^\s*<section[^>]*>\s*<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i, '<section>');
}

export function renderPagePrintHeader(companyName: string, reportDate: string): string {
  return `<div class="page-print-header"><span>${escapeHtml(companyName)}</span><span>${escapeHtml(reportDate)}</span></div>`;
}

export function getStateTone(score: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (score == null || Number.isNaN(score)) return 'gray';
  if (score >= 75) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

export function getStateBarClass(score: number | null | undefined): string {
  return `state-bar-${getStateTone(score)}`;
}

export function getStateBadgeClass(score: number | null | undefined): string {
  return `state-badge-${getStateTone(score)}`;
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

export function formatSignedGap(score: number | null | undefined, benchmark: number): string {
  if (score == null || Number.isNaN(score)) return 'n/a';
  const gap = Math.round(score - benchmark);
  return gap > 0 ? `+${gap}` : `${gap}`;
}
