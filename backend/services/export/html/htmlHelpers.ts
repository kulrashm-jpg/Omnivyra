// Pure HTML / text utility helpers — no payload dependencies

import { assertNoFallback, sanitizeRenderText, sanitizeTextArtifacts } from '../renderTextSanitizer';

export function safeText(value: string | null | undefined, maxSentences = 2): string {
  const clean = sanitizeRenderText(sanitizeTextArtifacts(value ?? '').replace(/\s+/g, ' ').trim(), { maxSentences }) || '';
  if (clean) assertNoFallback(clean);
  return clean;
}

export function safeScore(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(Math.round(Number(value))) : '0';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripRepeatedSentences(value: string): string {
  const seen = new Set<string>();
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((part) => safeText(part, 1))
    .filter(Boolean);

  return sentences.filter((sentence) => {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' ');
}

export function hasContent(value: string | null | undefined): boolean {
  return safeText(value, 2).length > 0;
}

export function hasNonEmptyList(values: Array<string | null | undefined> | null | undefined): boolean {
  return Array.isArray(values) && values.some((value) => hasContent(value));
}

export function clampPercent(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

export function estimateBlockUnits(text: string, base = 8): number {
  return base + Math.min(18, Math.ceil((text || '').length / 80));
}

export function displayScore(score: number | null | undefined, dataStrength: string): string {
  if (score === null || score === undefined) return '--';
  if (score === 0 && dataStrength === 'MISSING') return '--';
  return String(score);
}

export function getStateTone(score: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (score == null || !Number.isFinite(score)) return 'gray';
  if (score >= 50) return 'green';
  if (score >= 30) return 'yellow';
  return 'red';
}

export function getStateBarClass(score: number | null | undefined): string {
  const tone = getStateTone(score);
  if (tone === 'green') return 'bar-fill-green';
  if (tone === 'yellow') return 'bar-fill-amber';
  if (tone === 'red') return 'bar-fill-red';
  return '';
}

export function getStateBadgeClass(score: number | null | undefined): string {
  const tone = getStateTone(score);
  if (tone === 'green') return 'badge-green';
  if (tone === 'yellow') return 'badge-amber';
  if (tone === 'red') return 'badge-red';
  return 'badge-gray';
}

export function toUpperStrength(value: string | null | undefined): 'STRONG' | 'INFERRED' | 'WEAK' | 'MISSING' {
  const normalized = safeText(value, 1).toUpperCase();
  if (normalized === 'STRONG' || normalized === 'INFERRED' || normalized === 'WEAK') return normalized;
  return 'MISSING';
}

export function formatSignedGap(score: number | null | undefined, benchmark: number): string {
  if (!Number.isFinite(score)) return 'Missing';
  const gap = Math.round(Number(score) - benchmark);
  return gap > 0 ? `+${gap}` : `${gap}`;
}

export function stripTimelinePrefix(value: string | null | undefined, label: string): string {
  const cleaned = safeText(value, 2);
  if (!cleaned) return '';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleaned.replace(new RegExp(`^\\s*(?:${escapedLabel})\\s*:?\\s*`, 'i'), '').trim();
}

export function renderInlineDisclaimer(kind: 'missing' | 'partial', text: string, confidenceReason?: string): string {
  const title = kind === 'missing' ? 'Early-stage signal detected' : 'Directional signal detected';
  const confidence = confidenceReason ? `<span class="badge ${kind === 'missing' ? 'badge-red' : 'badge-amber'}">Signal confidence: ${kind === 'missing' ? 'Low' : 'Medium'} (${escapeHtml(confidenceReason)})</span>` : '';
  return `<div class="inline-disclaimer ${kind === 'missing' ? 'inline-disclaimer-missing' : 'inline-disclaimer-partial'}">${confidence}<p><strong>${title}.</strong> ${escapeHtml(text)}</p></div>`;
}

export function sectionHeaderBar(companyName: string, reportDate: string): string {
  return `
    <div class="section-header">
      <span class="company-name">${escapeHtml(companyName)}</span>
      <span class="report-title">Digital Authority Snapshot</span>
      <span class="report-date">${escapeHtml(reportDate)}</span>
    </div>
  `;
}

export function renderPagePrintHeader(companyName: string, reportDate: string): string {
  return `<div class="page-print-header">${sectionHeaderBar(companyName, reportDate)}</div>`;
}

export function stripLeadingSectionHeader(html: string): string {
  return html.replace(/^\s*<div class="report-section([^"]*)"([^>]*)>\s*<div class="section-header">[\s\S]*?<\/div>/, '<div class="report-section$1"$2>');
}

export function renderFillQuote(title: string, quote: string, note?: string): string {
  return `<div class="fill-quote"><div class="label">${escapeHtml(title)}</div><blockquote>${escapeHtml(quote)}</blockquote>${note ? `<div class="pending-note">${escapeHtml(note)}</div>` : ''}</div>`;
}

export function renderReportBlock(
  type: 'heading' | 'score-card' | 'insight' | 'chart' | 'action' | 'disclaimer',
  inner: string,
  options?: { className?: string; group?: string; fill?: boolean; keepTogether?: boolean },
): string {
  const shouldKeepTogether = Boolean(options?.keepTogether && ['heading', 'score-card', 'disclaimer'].includes(type));
  const className = ['report-block', options?.className, shouldKeepTogether ? 'keep-together' : ''].filter(Boolean).join(' ');
  const groupAttr = options?.group ? ` data-group="${escapeHtml(options.group)}"` : '';
  const fillAttr = options?.fill ? ' data-fill="true"' : '';
  return `<div class="${className}" data-type="${type}"${groupAttr}${fillAttr}>${inner}</div>`;
}

export function renderNarrativeGroup(
  id: string,
  microHeader: string,
  title: string,
  blocks: string[],
  options?: { keepTogether?: boolean; hideHeading?: boolean },
): string {
  const heading = options?.hideHeading
    ? ''
    : renderReportBlock('heading', `<div class="label">${escapeHtml(microHeader)}</div><h2>${escapeHtml(title)}</h2>`, { className: 'report-block-heading', group: id, keepTogether: true });
  return `<section class="narrative-group ${options?.keepTogether ? 'keep-together' : ''}" id="${escapeHtml(id)}" data-group="${escapeHtml(id)}">${heading}${blocks.join('')}</section>`;
}

export function renderCalloutBox(text: string): string {
  return `<div class="callout-box"><strong>Why This Matters:</strong> ${escapeHtml(text)}</div>`;
}

export function renderCompactBulletLine(items: string[]): string {
  return `<p>${items.map((item) => escapeHtml(item)).join(' · ')}</p>`;
}

export function renderInlineSummary(items: string[]): string {
  return `<p class="inline-summary">${items.map((item) => escapeHtml(item)).join(' &middot; ')}</p>`;
}

export function scoreMetricCard(label: string, score: number | null | undefined, dataStrength: string, note: string): string {
  const shown = displayScore(score, dataStrength);
  const width = shown === '--' ? 0 : clampPercent(score);
  return `
    <article class="metric-card no-break">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(shown)}</strong>
      <div class="bar"><span style="width:${width}%"></span></div>
      <p>${escapeHtml(note)}</p>
    </article>
  `;
}
