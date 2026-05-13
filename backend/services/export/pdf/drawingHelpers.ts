import { assertNoFallback, sanitizeRenderText, sanitizeRenderLines } from '../renderTextSanitizer';
import { COLORS } from './colorHelpers';
import type { PDFDoc } from './pdfTypes';

export function resetTextSpacing(doc: PDFDoc) {
  const maybeDoc = doc as unknown as {
    characterSpacing?: (value: number) => unknown;
    wordSpacing?: (value: number) => unknown;
  };
  if (typeof maybeDoc.characterSpacing === 'function') maybeDoc.characterSpacing(0);
  if (typeof maybeDoc.wordSpacing === 'function') maybeDoc.wordSpacing(0);
}

export function drawTextBlock(
  doc: PDFDoc,
  title: string,
  body: string,
  x: number,
  y: number,
  width: number,
  options?: {
    background?: string;
    border?: string;
    badges?: Array<{ label: string; color: string }>;
    bodySize?: number;
  },
): number {
  const cleanTitle = sanitizeRenderText(title, { maxSentences: 1 }) || 'Report block';
  const cleanBody = sanitizeRenderText(body, { maxSentences: 2 });
  const badges = (options?.badges ?? []).filter((badge) => sanitizeRenderText(badge.label, { maxSentences: 1 }));
  const bodySize = options?.bodySize ?? 10;
  let estimated = 20;
  doc.font('Helvetica-Bold').fontSize(12);
  estimated += doc.heightOfString(cleanTitle, { width: width - 24 });
  doc.font('Helvetica').fontSize(bodySize);
  estimated += doc.heightOfString(cleanBody, { width: width - 24, lineGap: 1 }) + 20 + (badges.length > 0 ? 22 : 0);

  doc.save();
  doc.roundedRect(x, y, width, estimated, 12).fillAndStroke(options?.background ?? COLORS.panel, options?.border ?? COLORS.border);
  doc.restore();

  let cursorY = y + 12;
  let badgeX = x + 12;
  badges.forEach((badge) => {
    const label = sanitizeRenderText(badge.label, { maxSentences: 1 });
    if (!label) return;
    const badgeWidth = Math.min(Math.max(doc.widthOfString(label) + 16, 72), 180);
    doc.save();
    doc.roundedRect(badgeX, cursorY, badgeWidth, 18, 9).fillAndStroke(badge.color, badge.color);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(label, badgeX, cursorY + 5, {
      width: badgeWidth,
      align: 'center',
    });
    doc.restore();
    badgeX += badgeWidth + 8;
  });
  if (badges.length > 0) cursorY += 24;

  assertNoFallback(cleanTitle);
  resetTextSpacing(doc);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text(cleanTitle, x + 12, cursorY, {
    width: width - 24,
    align: 'left',
    lineBreak: true,
  });
  cursorY = doc.y + 6;
  if (cleanBody) {
    assertNoFallback(cleanBody);
    resetTextSpacing(doc);
    doc.font('Helvetica').fontSize(bodySize).fillColor(COLORS.muted).text(cleanBody, x + 12, cursorY, {
      width: width - 24,
      align: 'left',
      lineBreak: true,
      lineGap: 1,
    });
  }
  return estimated;
}

export function drawScoreCircle(doc: PDFDoc, score: number, x: number, y: number, size: number) {
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const radius = size / 2;
  const color = score >= 75 ? COLORS.low : score >= 45 ? COLORS.medium : COLORS.high;
  doc.save();
  doc.circle(centerX, centerY, radius).fillAndStroke(COLORS.panel, COLORS.border);
  doc.lineWidth(8).circle(centerX, centerY, radius - 8).strokeColor('#e2e8f0').stroke();
  doc.restore();

  const angle = (Math.PI * 2) * Math.min(Math.max(score, 0), 100) / 100 - Math.PI / 2;
  const startAngle = -Math.PI / 2;
  doc.save();
  doc.lineWidth(8).strokeColor(color);
  doc.arc(centerX, centerY, radius - 8, startAngle, angle).stroke();
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.ink).text(String(score), x, y + size / 2 - 18, { width: size, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.faint).text('overall health', x, y + size / 2 + 12, { width: size, align: 'center' });
}

export function drawRadarVisual(
  doc: PDFDoc,
  metrics: Array<{ label: string; value: number | null; strength?: string }>,
  x: number,
  y: number,
  size: number,
) {
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const radius = size / 2 - 20;
  const rings = [0.25, 0.5, 0.75, 1];
  const angleStep = (Math.PI * 2) / metrics.length;

  doc.save();
  rings.forEach((ring) => {
    const points = metrics.map((_, index) => {
      const angle = -Math.PI / 2 + index * angleStep;
      return [
        centerX + Math.cos(angle) * radius * ring,
        centerY + Math.sin(angle) * radius * ring,
      ] as const;
    });
    doc.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(([px, py]) => doc.lineTo(px, py));
    doc.closePath().strokeColor('#e2e8f0').lineWidth(1).stroke();
  });

  const polygon = metrics.map((metric, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const value = typeof metric.value === 'number' ? metric.value / 100 : 0;
    return [
      centerX + Math.cos(angle) * radius * value,
      centerY + Math.sin(angle) * radius * value,
    ] as const;
  });
  doc.moveTo(polygon[0][0], polygon[0][1]);
  polygon.slice(1).forEach(([px, py]) => doc.lineTo(px, py));
  doc.closePath().fillOpacity(0.28).fillAndStroke(COLORS.brandSoft, COLORS.brand);
  doc.fillOpacity(1);

  metrics.forEach((metric, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const labelX = centerX + Math.cos(angle) * (radius + 16) - 28;
    const labelY = centerY + Math.sin(angle) * (radius + 16) - 6;
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.faint).text(metric.label, labelX, labelY, { width: 56, align: 'center' });
  });
  doc.restore();
}

export function drawFunnelVisual(
  doc: PDFDoc,
  rows: Array<{ label: string; value: number | null; color: string }>,
  x: number,
  y: number,
  width: number,
) {
  const available = rows.filter((row) => typeof row.value === 'number') as Array<{ label: string; value: number; color: string }>;
  if (available.length === 0) {
    return;
  }
  const topValue = Math.max(...available.map((row) => row.value), 1);
  let cursorY = y;
  available.forEach((row, index) => {
    const barWidth = width * (row.value / topValue);
    const offsetX = x + (width - barWidth) / 2;
    const height = 28;
    doc.save();
    doc.roundedRect(offsetX, cursorY, barWidth, height, 10).fill(row.color);
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(`${row.label}: ${Math.round(row.value).toLocaleString()}`, offsetX + 8, cursorY + 9, {
      width: Math.max(0, barWidth - 16),
      align: 'center',
    });
    cursorY += height + (index === 0 ? 14 : 10);
  });
}

export function drawMatrixVisual(
  doc: PDFDoc,
  rows: Array<{ keyword: string; opportunity: number; coverage: number; bucket?: string | null }>,
  x: number,
  y: number,
  size: number,
) {
  doc.save();
  doc.roundedRect(x, y, size, size, 12).strokeColor(COLORS.border).lineWidth(1).stroke();
  doc.moveTo(x + size / 2, y).lineTo(x + size / 2, y + size).strokeColor(COLORS.border).stroke();
  doc.moveTo(x, y + size / 2).lineTo(x + size, y + size / 2).strokeColor(COLORS.border).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.faint);
  doc.text('Low coverage', x, y + size + 4, { width: size / 2, align: 'left' });
  doc.text('High coverage', x + size / 2, y + size + 4, { width: size / 2, align: 'right' });
  doc.save();
  doc.rotate(-90, { origin: [x - 12, y + size / 2] });
  doc.text('Opportunity score', x - size, y - 24, { width: size, align: 'center' });
  doc.restore();

  rows.slice(0, 6).forEach((row) => {
    const px = x + (row.coverage / 100) * size;
    const py = y + size - (row.opportunity / 100) * size;
    const color = row.bucket === 'quick_win' ? COLORS.low : row.bucket === 'strategic' ? COLORS.medium : COLORS.high;
    doc.save();
    doc.circle(px, py, 6).fill(color);
    doc.restore();
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.ink).text(row.keyword, px + 8, py - 4, { width: 80 });
  });
}

export function drawHorizontalIssueBars(
  doc: PDFDoc,
  rows: Array<{ label: string; value: number | null; color: string }>,
  x: number,
  y: number,
  width: number,
) {
  const max = Math.max(...rows.map((row) => row.value ?? 0), 1);
  let cursorY = y;
  rows.forEach((row) => {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text(row.label, x, cursorY, { width: 110 });
    const barX = x + 112;
    const barWidth = width - 112;
    doc.save();
    doc.roundedRect(barX, cursorY + 2, barWidth, 12, 6).fill('#eef2f7');
    if (typeof row.value === 'number') {
      doc.roundedRect(barX, cursorY + 2, Math.max(8, (row.value / max) * barWidth), 12, 6).fill(row.color);
    }
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.faint).text(typeof row.value === 'number' ? String(row.value) : 'N/A', x + width - 28, cursorY, { width: 28, align: 'right' });
    cursorY += 22;
  });
}

export function drawSimpleListCard(
  doc: PDFDoc,
  title: string,
  items: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  background = COLORS.panel,
) {
  const cleanTitle = sanitizeRenderText(title, { maxSentences: 1 }) || title;
  const cleanItems = sanitizeRenderLines(items, {
    maxItems: 3,
    maxSentencesPerLine: 1,
  });
  doc.save();
  doc.roundedRect(x, y, width, height, 12).fillAndStroke(background, COLORS.border);
  doc.restore();
  assertNoFallback(cleanTitle);
  resetTextSpacing(doc);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text(cleanTitle, x + 12, y + 12, { width: width - 24, align: 'left', lineBreak: true });
  let cursorY = y + 32;
  cleanItems.forEach((item) => {
    assertNoFallback(item);
    resetTextSpacing(doc);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`- ${item}`, x + 12, cursorY, { width: width - 24, align: 'left', lineBreak: true });
    cursorY = doc.y + 4;
  });
}
