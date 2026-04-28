import PDFDocument from 'pdfkit';
import {
  renderOmnivyraSnapshotMasterHtml,
  renderReportHtmlTemplate,
} from '../reportHtmlTemplateRenderer';
import { renderPdfFromHtml } from '../htmlToPdfRenderer';
import {
  PAGE,
  COLORS,
  toTitleCase,
  formatPriorityType,
  formatReportType,
  deriveImpactLabel,
  deriveTimeToImpact,
  effortColor,
} from './colorHelpers';
import { createPdfRendererHelpers } from './pdfRendererHelpers';
import { renderSnapshotPdfDynamic } from './snapshotPdfRenderer';
import type { PdfReportPayload } from './pdfTypes';

function wrapInHtmlShell(segment: string, sourceHtml: string): string {
  const styleMatch = sourceHtml.match(/<style>([\s\S]*?)<\/style>/i);
  const styles = styleMatch ? `<style>${styleMatch[1]}</style>` : '';
  const normalizedSegment = /id=["']pdf-report["']/i.test(segment)
    ? segment
    : `<div id="pdf-report">${segment}</div>`;
  const wrappedSegment = /class=["'][^"']*\breport-page\b/i.test(segment)
    ? normalizedSegment
    : `<main class="report-page">${normalizedSegment}</main>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />${styles}</head><body>${wrappedSegment}</body></html>`;
}

function extractPdfSegment(html: string): string {
  const markedMatch = html.match(/<!--\s*PDF-SEGMENT-START\s*-->([\s\S]*?)<!--\s*PDF-SEGMENT-END\s*-->/i);
  if (markedMatch) return wrapInHtmlShell(markedMatch[1], html);

  const match = html.match(/<div id="pdf-report">([\s\S]*?)<\/div>\s*<!--.*SEGMENT B/i);
  if (match) return wrapInHtmlShell(match[1], html);

  const fallbackMatch = html.match(/<div id="pdf-report">([\s\S]*?)<\/div>/i);
  return fallbackMatch ? wrapInHtmlShell(fallbackMatch[1], html) : html;
}

export async function renderReportPdf(payload: PdfReportPayload): Promise<Buffer> {
  try {
    const html = payload.reportType === 'snapshot'
      ? renderOmnivyraSnapshotMasterHtml(payload).html
      : renderReportHtmlTemplate(payload).html;
    const htmlPdf = await renderPdfFromHtml(extractPdfSegment(html));
    if (htmlPdf.length > 0) {
      return htmlPdf;
    }
    if (payload.reportType === 'snapshot') {
      throw new Error('Snapshot PDF HTML render returned an empty buffer.');
    }
  } catch (error) {
    console.warn('[reportPdfRenderer] HTML-first PDF render failed, falling back to PDFKit:', error);
  }

  const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true });
  const chunks: Buffer[] = [];

  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
  const cardGap = 12;
  const brandName = payload.companyContext?.companyName || payload.domain;
  const brandInitials = (() => {
    const cleaned = String(brandName ?? '').trim();
    if (!cleaned) return 'R';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return cleaned.slice(0, 1).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  })();

  const {
    ensureSpace,
    drawRule,
    drawSectionMetaPills,
    drawSignalHighlight,
    drawReportClosingCta,
    drawSectionTitle,
    drawCard,
    drawActionCard,
    drawPageIdentity,
    renderSection,
  } = createPdfRendererHelpers({
    doc,
    pageWidth,
    cardGap,
    bottomLimit,
    brandName,
    brandInitials,
    payload,
  });

  if ((payload as PdfReportPayload).reportType === 'snapshot') {
    renderSnapshotPdfDynamic({
      doc,
      pageWidth,
      cardGap,
      brandName,
      payload,
      ensureSpace,
      drawRule,
      drawSectionMetaPills,
      drawSignalHighlight,
      drawSectionTitle,
      drawCard,
      drawActionCard,
      renderSection,
      drawReportClosingCta,
    });

    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i += 1) {
      doc.switchToPage(i);
      drawPageIdentity(i, pageRange.count);
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.faint).text(
        `${brandName} (${payload.domain})  |  ${formatReportType(payload.reportType)}  |  Page ${i + 1} of ${pageRange.count}`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom - 6,
        { width: pageWidth, align: 'center', lineBreak: false }
      );
    }
    doc.end();
    return bufferPromise;
  }

  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.ink).text(brandName, {
    width: pageWidth,
  });
  doc.moveDown(0.05);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.faint).text(payload.domain, {
    width: pageWidth,
  });
  doc.moveDown(0.25);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.brand).text(payload.title || formatReportType(payload.reportType));
  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.faint).text(
    `${formatReportType(payload.reportType)}  |  Generated ${payload.generatedDate}`,
    { width: pageWidth }
  );
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(payload.summary, {
    width: pageWidth,
  });
  doc.moveDown(0.8);

  ensureSpace(96);
  doc.font('Helvetica-Bold').fontSize(15);
  const diagnosisHeight = 54 + doc.heightOfString(payload.diagnosis, { width: pageWidth - 28 });
  doc.save();
  doc.roundedRect(doc.page.margins.left, doc.y, pageWidth, diagnosisHeight, 14)
    .fillAndStroke(COLORS.diagnosisBg, COLORS.diagnosisBorder);
  doc.restore();
  const diagnosisY = doc.y + 14;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.brand).text('DIAGNOSIS', doc.page.margins.left + 14, diagnosisY, {
    characterSpacing: 1,
  });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.ink).text(payload.diagnosis, doc.page.margins.left + 14, diagnosisY + 18, {
    width: pageWidth - 28,
  });
  doc.y += diagnosisHeight + 14;

  if (payload.topPriorities.length > 0) {
    drawSectionTitle('Top priorities', 'What to fix first', 'Highest-leverage actions ranked from the same report payload shown on screen.');
    payload.topPriorities.slice(0, 3).forEach((priority, index) => {
      drawCard({
        title: `${index + 1}. ${priority.title}`,
        bodyLines: [priority.whyNow, `Expected outcome: ${priority.expectedOutcome}`, priority.expectedUpside],
        footerLines: [
          `Priority type: ${formatPriorityType(priority.priorityType)}`,
          priority.priorityWhy,
          `Priority: ${deriveImpactLabel(priority)}`,
          `Time to impact: ${deriveTimeToImpact(priority)}`,
          `Effort: ${toTitleCase(priority.effortLevel)}`,
        ],
        background: COLORS.priorityBg,
        border: COLORS.diagnosisBorder,
        badges: [
          { label: formatPriorityType(priority.priorityType), color: COLORS.brand },
          { label: deriveImpactLabel(priority), color: COLORS.brand },
          { label: `Effort: ${toTitleCase(priority.effortLevel)}`, color: effortColor(priority.effortLevel) },
          { label: deriveTimeToImpact(priority), color: COLORS.faint },
        ],
      });
    });
  }

  drawRule();
  drawSectionTitle('Insights', 'What the report is telling you');
  payload.insights.forEach((insight) => {
    drawCard({
      title: insight.text,
      bodyLines: [
        `Why it matters: ${insight.whyItMatters}`,
        `Business impact: ${insight.businessImpact}`,
      ],
      background: COLORS.insightBg,
      border: COLORS.border,
    });
  });

  if (payload.nextSteps.length > 0) {
    ensureSpace(96);
    drawRule();
    drawSectionTitle('Actions', 'Execution plan', 'Concrete next steps built from the same report output your team sees in-app.');
    payload.nextSteps.forEach((action, index) => {
      drawActionCard(action, index);
    });
  }

  const pageRange = doc.bufferedPageRange();
  for (let i = 0; i < pageRange.count; i += 1) {
    doc.switchToPage(i);
    drawPageIdentity(i, pageRange.count);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.faint).text(
      `${brandName} (${payload.domain})  |  ${formatReportType(payload.reportType)}  |  Page ${i + 1} of ${pageRange.count}`,
      doc.page.margins.left,
      doc.page.height - doc.page.margins.bottom - 6,
      { width: pageWidth, align: 'center', lineBreak: false }
    );
  }

  doc.end();
  return bufferPromise;
}
