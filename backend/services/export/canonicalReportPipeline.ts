// Canonical report export pipeline.
//
// Replaces the legacy `reportPdfRenderer` / `reportHtmlTemplateRenderer`
// stack. There is now exactly ONE path from a stored report to an
// exported PDF or HTML document, and that path is the canonical
// executive dossier:
//
//   ReportViewPayload (sanitised)
//      → ReportViewPayload.canonical (CanonicalReport)
//      → buildCanonicalExport({ shape: 'executive' }) (CanonicalExportPayload)
//      → renderExportHtml() (string)
//      → renderPdfFromHtml() (Buffer, when PDF requested)
//
// All previous renderers (snapshot HTML master document, narrative-flow
// renderers, PDFKit fallbacks) have been disconnected and deleted.
// This file is the single export pipeline the API endpoint consumes.

import type { ReportViewPayload } from '../../../pages/api/reports/reportViewPayloadTypes';
import { buildCanonicalExport } from '../intelligence/canonicalExport';
import { renderExportHtml } from '../intelligence/exportRenderer';
import { renderPdfFromHtml } from './htmlToPdfRenderer';

function escape(text: string | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Insufficient-evidence fallback ────────────────────────────────────────
//
// When the stored report has not yet produced a canonical authority
// report (status: generating, or older legacy intel without a canonical
// projection), we render a single calm page that holds the document
// honestly open until measurement accumulates. The styling matches the
// canonical dossier's structural-invisibility system — restrained
// typography, no metrics, no widgets.

function renderInsufficientReportHtml(payload: ReportViewPayload): string {
  const company = escape(payload.companyContext?.companyName ?? payload.domain);
  const generated = escape(payload.generatedDate ?? payload.generated_at ?? '');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Authority Intelligence Dossier — ${company}</title>
    <style>
      @page { size: A4; margin: 24mm 22mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #1a2332; font-family: "Source Serif 4", Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.65; }
      .ds-page { padding: 0; max-width: 720px; margin: 0 auto; }
      .ds-cover { min-height: 249mm; padding: 18mm 0; display: flex; flex-direction: column; justify-content: space-between; }
      .ds-mark { width: 25mm; height: 0.6mm; border-radius: 999px; background: linear-gradient(90deg, #0f4c6b, rgba(15, 76, 107, 0.25)); margin: 0 0 26mm; }
      .ds-title { font-size: 12pt; letter-spacing: 0.18em; text-transform: uppercase; color: #475569; margin: 0 0 7mm; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
      .ds-company { font-size: 30pt; line-height: 1.08; margin: 0 0 11mm; color: #0f172a; font-weight: 650; letter-spacing: -0.015em; }
      .ds-thesis { font-size: 15pt; line-height: 1.55; color: #1a2332; margin: 12mm 0 0; max-width: 142mm; font-family: "Inter", system-ui, sans-serif; font-weight: 460; }
      .ds-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 8mm; padding-top: 7mm; color: #64748b; font-size: 9pt; font-family: "Inter", system-ui, sans-serif; border-top: 0.25mm solid #e8edf2; }
    </style>
  </head>
  <body>
    <div class="ds-page">
      <div class="ds-cover">
        <div>
          <div class="ds-mark"></div>
          <h1 class="ds-company">${company}</h1>
          <p class="ds-title">Authority Intelligence Dossier</p>
          <p class="ds-thesis">Authority cannot yet be classified — measurement is still forming. The dossier holds the architecture honestly open until evidence accumulates; this document refreshes when the canonical report has resolved.</p>
        </div>
        <div class="ds-meta">
          <span>${generated ? `Status as of ${generated}` : 'Measurement in progress'}</span>
          <span>Canonical Executive Dossier</span>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

// ── Canonical pipeline entry points ───────────────────────────────────────

export function renderCanonicalReportHtml(payload: ReportViewPayload): string {
  if (!payload.canonical) {
    return renderInsufficientReportHtml(payload);
  }
  const exportPayload = buildCanonicalExport({
    shape: 'executive',
    // The view payload does not surface tenant context separately;
    // companyId is the stable export framing identifier the dossier
    // uses for its title surface. Tenant-aware cost/governance still
    // lives on the canonical report itself.
    tenantId: payload.companyId,
    companyId: payload.companyId,
    report: payload.canonical,
    // GAP-01 — carry the Report 1 surfaces into the export. These were computed by
    // `composeSnapshotReport`, persisted in `composed_report`, and previously discarded here
    // because the export payload had no slot for them. Pass-through: `null` where the
    // producer abstained, so the renderer omits rather than invents.
    report1: {
      digital_snapshot: payload.digitalSnapshot ?? null,
      evidence_coverage: payload.evidenceCoverage ?? null,
      digital_experience: payload.digitalExperience ?? null,
      performance: payload.performanceEvidence ?? null,
      competitive_tables: payload.competitiveTables ?? null,
      evidence_acquisition: payload.evidenceAcquisition ?? null,
      search_visibility: payload.searchVisibility ?? null,
      company_identity: payload.companyIdentity ?? null,
      website_checks: payload.websiteChecks ?? null,
    },
  });
  // Brand presence: thread companyName, domain, logoUrl, and faviconUrl
  // from the sanitised view payload's companyContext into the renderer.
  // The renderer falls back to companyId / payload.domain when these
  // are absent, so logo-less reports still render correctly.
  return renderExportHtml(exportPayload, {
    brandName: payload.companyContext?.companyName ?? payload.domain ?? null,
    domain: payload.domain ?? null,
    logoUrl: payload.companyContext?.logoUrl ?? null,
    faviconUrl: payload.companyContext?.faviconUrl ?? null,
    companyContext: payload.companyContext ?? null,
  });
}

export async function renderCanonicalReportPdf(payload: ReportViewPayload): Promise<Buffer> {
  const html = renderCanonicalReportHtml(payload);
  return renderPdfFromHtml(html);
}
