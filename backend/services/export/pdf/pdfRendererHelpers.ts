import { assertNoFallback, sanitizeRenderLines, sanitizeRenderText, sanitizeTextArtifacts } from '../renderTextSanitizer';
import { COLORS, effortColor, formatPriorityType, formatReportType, toTitleCase } from './colorHelpers';
import { resetTextSpacing } from './drawingHelpers';
import type { PDFDoc, PdfNextStep, PdfReportPayload } from './pdfTypes';

export function createPdfRendererHelpers(params: {
  doc: PDFDoc;
  pageWidth: number;
  cardGap: number;
  bottomLimit: () => number;
  brandName: string;
  brandInitials: string;
  payload: PdfReportPayload;
}) {
  const { doc, pageWidth, cardGap, bottomLimit, brandName, brandInitials, payload } = params;

  const normalizeRenderCopy = (value: string | null | undefined, maxSentences = 1) =>
    sanitizeRenderText(sanitizeTextArtifacts(value ?? '').replace(/\s+/g, ' ').trim(), { maxSentences });

  const renderWrappedText = (
    text: string,
    x: number,
    y: number,
    options: Record<string, unknown>,
  ) => {
    const normalized = sanitizeTextArtifacts(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return y;
    assertNoFallback(normalized);
    resetTextSpacing(doc);
    doc.text(normalized, x, y, {
      align: 'left',
      lineBreak: true,
      ...options,
    });
    return doc.y;
  };

  const renderLines = (
    lines: string[],
    x: number,
    y: number,
    width: number,
    font: { name: string; size: number; color: string },
    gap = 6,
  ) => {
    let cursorY = y;
    const cleanLines = sanitizeRenderLines(lines, {
      maxItems: lines.length,
      maxSentencesPerLine: 1,
    });
    cleanLines.forEach((line) => {
      doc.font(font.name).fontSize(font.size).fillColor(font.color);
      cursorY = renderWrappedText(line, x, cursorY, { width });
      cursorY += gap;
    });
    return cursorY;
  };

  const ensureSpace = (height: number) => {
    if (doc.y + height > bottomLimit()) {
      doc.addPage();
    }
  };

  const drawRule = () => {
    ensureSpace(10);
    const y = doc.y;
    doc.save();
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + pageWidth, y).strokeColor(COLORS.border).lineWidth(1).stroke();
    doc.restore();
    doc.moveDown(0.8);
  };

  const drawBadge = (label: string, color: string, x: number, y: number) => {
    const cleanLabel = sanitizeRenderText(label, { maxSentences: 1 });
    if (!cleanLabel) return 0;
    const width = Math.min(Math.max(doc.widthOfString(cleanLabel) + 16, 72), 180);
    doc.save();
    doc.roundedRect(x, y, width, 18, 9).fillAndStroke(color, color);
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold').text(cleanLabel, x, y + 5, {
      width,
      align: 'center',
    });
    doc.restore();
    return width;
  };

  const normalizeConfidence = (value: string | null | undefined): 'high' | 'medium' | 'low' | 'limited data' => {
    const normalized = (value ?? '').toLowerCase();
    if (normalized === 'high') return 'high';
    if (normalized === 'medium') return 'medium';
    if (normalized === 'low') return 'low';
    return 'limited data';
  };

  const drawSoftPill = (
    label: string,
    x: number,
    y: number,
    colors: { bg: string; border: string; text: string; dot?: string },
  ) => {
    const cleanLabel = sanitizeRenderText(label, { maxSentences: 1 });
    if (!cleanLabel) return 0;
    const width = Math.min(Math.max(doc.widthOfString(cleanLabel) + (colors.dot ? 28 : 16), 86), 210);
    doc.save();
    doc.roundedRect(x, y, width, 18, 9).fillAndStroke(colors.bg, colors.border);
    if (colors.dot) {
      doc.circle(x + 9, y + 9, 2.5).fill(colors.dot);
    }
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(8).text(
      cleanLabel,
      x + (colors.dot ? 15 : 8),
      y + 5,
      { width: width - (colors.dot ? 20 : 12), align: 'left' },
    );
    doc.restore();
    return width;
  };

  const confidencePillColors = (value: string | null | undefined) => {
    const confidence = normalizeConfidence(value);
    if (confidence === 'high') {
      return { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46', dot: '#10b981' };
    }
    if (confidence === 'medium') {
      return { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', dot: '#f59e0b' };
    }
    if (confidence === 'low') {
      return { bg: '#fff1f2', border: '#fda4af', text: '#9f1239', dot: '#f43f5e' };
    }
    return { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155', dot: '#94a3b8' };
  };

  const trendPillColors = (trend: 'improving' | 'declining' | 'stable') => {
    if (trend === 'improving') {
      return { bg: '#ecfdf5', border: '#86efac', text: '#166534', dot: '#16a34a' };
    }
    if (trend === 'declining') {
      return { bg: '#fff1f2', border: '#fda4af', text: '#9f1239', dot: '#e11d48' };
    }
    return { bg: '#fefce8', border: '#fde68a', text: '#854d0e', dot: '#d97706' };
  };

  const drawSectionMetaPills = (
    items: Array<
      | { type: 'confidence'; value: string | null | undefined }
      | { type: 'trend'; value: 'improving' | 'declining' | 'stable' }
      | { type: 'label'; value: string }
    >,
  ) => {
    ensureSpace(26);
    let x = doc.page.margins.left;
    const y = doc.y;
    items.forEach((item) => {
      let width = 0;
      if (item.type === 'confidence') {
        width = drawSoftPill(`CONFIDENCE: ${normalizeConfidence(item.value).toUpperCase()}`, x, y, confidencePillColors(item.value));
      } else if (item.type === 'trend') {
        width = drawSoftPill(`TREND: ${item.value.toUpperCase()}`, x, y, trendPillColors(item.value));
      } else {
        width = drawSoftPill(item.value.toUpperCase(), x, y, { bg: '#eff6ff', border: '#bfdbfe', text: '#1e3a8a' });
      }
      x += width + 8;
    });
    doc.y = y + 22;
  };

  const estimateCardHeight = (title: string, bodyLines: string[], footerLines: string[] = [], width = pageWidth) => {
    let total = 24;
    doc.font('Helvetica-Bold').fontSize(12);
    total += doc.heightOfString(title, { width: width - 28, align: 'left' });
    bodyLines.forEach((line) => {
      doc.font('Helvetica').fontSize(10);
      total += doc.heightOfString(line, { width: width - 28, align: 'left' }) + 6;
    });
    footerLines.forEach((line) => {
      doc.font('Helvetica-Bold').fontSize(9);
      total += doc.heightOfString(line, { width: width - 28, align: 'left' }) + 4;
    });
    return total + 16;
  };

  const drawCard = (options: {
    title: string;
    bodyLines: string[];
    footerLines?: string[];
    background?: string;
    border?: string;
    width?: number;
    badges?: Array<{ label: string; color: string }>;
    bodyMaxItems?: number;
    footerMaxItems?: number;
  }) => {
    const width = options.width ?? pageWidth;
    const title = sanitizeRenderText(options.title, { maxSentences: 1 }) || options.title;
    const bodyLines = sanitizeRenderLines(options.bodyLines, {
      maxItems: options.bodyMaxItems ?? 2,
      maxSentencesPerLine: 1,
    });
    const footerLines = sanitizeRenderLines(options.footerLines ?? [], {
      maxItems: options.footerMaxItems ?? 1,
      maxSentencesPerLine: 1,
    });
    const height = estimateCardHeight(title, bodyLines, footerLines, width);
    ensureSpace(height + cardGap);

    const startX = doc.page.margins.left;
    const startY = doc.y;
    doc.save();
    doc.roundedRect(startX, startY, width, height, 12)
      .fillAndStroke(options.background ?? COLORS.panel, options.border ?? COLORS.border);
    doc.restore();

    let cursorY = startY + 14;
    if (options.badges?.length) {
      let badgeX = startX + 14;
      options.badges.forEach((badge) => {
        badgeX += drawBadge(badge.label, badge.color, badgeX, cursorY) + 8;
      });
      cursorY += 26;
    }

    assertNoFallback(title);
    resetTextSpacing(doc);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text(title, startX + 14, cursorY, {
      width: width - 28,
      align: 'left',
      lineBreak: true,
    });
    cursorY = doc.y + 8;

    bodyLines.forEach((line) => {
      assertNoFallback(line);
      resetTextSpacing(doc);
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(line, startX + 14, cursorY, {
        width: width - 28,
        align: 'left',
        lineBreak: true,
        lineGap: 1,
      });
      cursorY = doc.y + 6;
    });

    footerLines.forEach((line) => {
      assertNoFallback(line);
      resetTextSpacing(doc);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(line, startX + 14, cursorY, {
        width: width - 28,
        align: 'left',
        lineBreak: true,
      });
      cursorY = doc.y + 4;
    });

    doc.y = startY + height + cardGap;
  };

  const drawSignalHighlight = (title: string, text: string, tone: 'blue' | 'teal' | 'slate' = 'blue') => {
    const palette =
      tone === 'teal'
        ? { bg: '#f0fdfa', border: '#99f6e4' }
        : tone === 'slate'
          ? { bg: '#f8fafc', border: '#cbd5e1' }
          : { bg: '#eff6ff', border: '#bfdbfe' };
    drawCard({
      title,
      bodyLines: [text],
      background: palette.bg,
      border: palette.border,
      bodyMaxItems: 1,
      footerMaxItems: 0,
    });
  };

  const drawReportClosingCta = () => {
    const estimatedHeight = 118;
    ensureSpace(estimatedHeight);
    const startX = doc.page.margins.left;
    const startY = doc.y;
    const width = pageWidth;
    const height = 106;

    doc.save();
    doc.roundedRect(startX, startY, width, height, 14).fillAndStroke('#eff6ff', '#bfdbfe');
    doc.restore();

    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.ink).text('Ready to execute?', startX + 16, startY + 16, {
      width: width - 32,
    });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(
      'Start with the top priority action, then track movement in the next snapshot to validate gains.',
      startX + 16,
      startY + 40,
      { width: width - 32 },
    );

    const buttonLabel = 'Implementation Guide';
    const buttonWidth = Math.min(Math.max(doc.widthOfString(buttonLabel) + 20, 144), 220);
    const buttonHeight = 24;
    const buttonX = startX + 16;
    const buttonY = startY + height - 34;
    doc.save();
    doc.roundedRect(buttonX, buttonY, buttonWidth, buttonHeight, 12).fillAndStroke(COLORS.brand, COLORS.brand);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(buttonLabel, buttonX, buttonY + 8, {
      width: buttonWidth,
      align: 'center',
    });
    doc.restore();

    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.faint).text(
      'END OF REPORT',
      startX + width - 120,
      startY + height - 18,
      { width: 104, align: 'right' },
    );

    doc.y = startY + height + cardGap;
  };

  const drawSectionTitle = (eyebrow: string, title: string, description?: string) => {
    ensureSpace(56);
    const cleanEyebrow = sanitizeRenderText(eyebrow.toUpperCase(), { maxSentences: 1 }) || eyebrow.toUpperCase();
    const cleanTitle = sanitizeRenderText(title, { maxSentences: 1 }) || title;
    assertNoFallback(cleanEyebrow);
    assertNoFallback(cleanTitle);
    resetTextSpacing(doc);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.brand).text(cleanEyebrow, {
      characterSpacing: 1,
      align: 'left',
      lineBreak: true,
    });
    doc.moveDown(0.2);
    resetTextSpacing(doc);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.ink).text(cleanTitle, { align: 'left', lineBreak: true });
    if (description) {
      doc.moveDown(0.25);
      const cleanDescription = sanitizeRenderText(description, { maxSentences: 1 });
      if (cleanDescription) {
        assertNoFallback(cleanDescription);
        resetTextSpacing(doc);
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(cleanDescription, {
          width: pageWidth,
          align: 'left',
          lineBreak: true,
        });
      }
    }
    doc.moveDown(0.6);
  };

  const drawActionCard = (action: PdfNextStep, index: number) => {
    const stepLines = action.steps.slice(0, 4).map((step, stepIndex) => `${stepIndex + 1}. ${step}`);
    drawCard({
      title: `${index + 1}. ${action.action}`,
      bodyLines: [action.description, ...stepLines],
      footerLines: [
        `Expected outcome: ${action.expectedOutcome}`,
        `Effort: ${toTitleCase(action.effortLevel)}`,
      ],
      background: COLORS.actionBg,
      border: COLORS.border,
      badges: [
        { label: formatPriorityType(action.priorityType), color: COLORS.brand },
        { label: `Effort: ${toTitleCase(action.effortLevel)}`, color: effortColor(action.effortLevel) },
      ],
      bodyMaxItems: 2,
      footerMaxItems: 1,
    });
  };

  const drawPageIdentity = (pageIndex: number, totalPages: number) => {
    const headerY = 12;
    const logoX = doc.page.margins.left;
    const badgeW = 14;
    doc.save();
    doc.roundedRect(logoX, headerY, badgeW, badgeW, 3).fillAndStroke('#eff6ff', '#bfdbfe');
    doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(8).text(brandInitials, logoX, headerY + 4, {
      width: badgeW,
      align: 'center',
    });
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink).text(
      `Snapshot Report  |  ${brandName} (${payload.domain})  |  ${payload.generatedDate}`,
      logoX + badgeW + 8,
      headerY + 5,
      { width: pageWidth - badgeW - 8 },
    );
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.faint).text(
      `Page ${pageIndex + 1} of ${totalPages}`,
      doc.page.margins.left,
      headerY + 5,
      { width: pageWidth, align: 'right' },
    );
    doc.save();
    doc.moveTo(doc.page.margins.left, headerY + 22).lineTo(doc.page.margins.left + pageWidth, headerY + 22).strokeColor('#e7edf5').lineWidth(0.6).stroke();
    doc.restore();
  };

  const renderProgressBars = (
    items: Array<{ label: string; score: number | null }>,
    title = 'Progress Indicators',
  ) => {
    drawSectionTitle('Progress', title, 'Top-level score mix across unified, SEO, GEO/AEO, and authority.');
    const blockHeight = 28 + items.length * 30;
    ensureSpace(blockHeight);
    const startY = doc.y;
    doc.save();
    doc.roundedRect(doc.page.margins.left, startY, pageWidth, blockHeight, 12).fillAndStroke(COLORS.panel, COLORS.border);
    doc.restore();
    let y = startY + 14;
    items.slice(0, 4).forEach((item) => {
      const labelWidth = 88;
      const valueWidth = 40;
      const barX = doc.page.margins.left + 14 + labelWidth;
      const barWidth = pageWidth - 28 - labelWidth - valueWidth;
      const score = typeof item.score === 'number' ? Math.max(0, Math.min(100, Math.round(item.score))) : null;
      const color = score == null ? '#94a3b8' : score > 70 ? COLORS.low : score >= 40 ? COLORS.medium : COLORS.high;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(item.label, doc.page.margins.left + 14, y + 1, {
        width: labelWidth - 6,
      });
      doc.save();
      doc.roundedRect(barX, y, barWidth, 12, 6).fill('#e2e8f0');
      if (score != null) {
        doc.roundedRect(barX, y, Math.max(10, (score / 100) * barWidth), 12, 6).fill(color);
      }
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(
        score == null ? 'N/A' : String(score),
        barX + barWidth + 8,
        y + 1,
        { width: valueWidth - 8, align: 'right' },
      );
      y += 24;
    });
    doc.y = startY + blockHeight + cardGap;
  };

  const renderSection = (section: {
    eyebrow: string;
    title: string;
    description?: string;
    visual?: () => void;
    text: string[];
    textLineLimit?: number;
    tone?: { background?: string; border?: string };
  }) => {
    drawSectionTitle(section.eyebrow, section.title, section.description);
    if (section.visual) {
      section.visual();
      const lines = sanitizeRenderLines(section.text, {
        maxItems: Math.min(section.textLineLimit ?? 2, 2),
        maxSentencesPerLine: 1,
      });
      if (lines.length > 0) {
        drawCard({
          title: section.title,
          bodyLines: lines,
          background: section.tone?.background ?? COLORS.panel,
          border: section.tone?.border ?? COLORS.border,
          bodyMaxItems: 2,
          footerMaxItems: 0,
        });
      }
      return;
    }

    const lines = sanitizeRenderLines(section.text, {
      maxItems: Math.min(section.textLineLimit ?? 3, 3),
      maxSentencesPerLine: 1,
    });
    if (lines.length > 0) {
      drawCard({
        title: section.title,
        bodyLines: lines,
        background: section.tone?.background ?? COLORS.panel,
        border: section.tone?.border ?? COLORS.border,
        bodyMaxItems: 3,
        footerMaxItems: 0,
      });
    }
  };

  return {
    normalizeRenderCopy,
    renderWrappedText,
    renderLines,
    ensureSpace,
    drawRule,
    drawBadge,
    normalizeConfidence,
    drawSoftPill,
    confidencePillColors,
    trendPillColors,
    drawSectionMetaPills,
    drawSignalHighlight,
    drawReportClosingCta,
    drawSectionTitle,
    estimateCardHeight,
    drawCard,
    drawActionCard,
    drawPageIdentity,
    renderProgressBars,
    renderSection,
  };
}
