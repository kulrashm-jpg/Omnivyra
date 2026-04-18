import fs from 'fs';
import path from 'path';
import type { PdfReportPayload } from './reportPdfRenderer';
import { renderOmnivyraExecutionEndgameHtml } from './reportHtmlExecutionEndgame';
import { renderSnapshotMasterDocument } from './reportHtmlSnapshotMasterDocument';
import { buildTemplateVariables } from './reportHtmlTemplateVariables';
import { getSnapshotSectionSpecs } from './reportHtmlSections';
import {
  renderActionsFlow,
  renderAuthorityAiFlow,
  renderCompetitorFlow,
  renderConfidenceFlow,
  renderDiagnosticsFlow,
  renderGeoAeoFlow,
  renderHookFlow,
  renderInsightsFlow,
  renderNextLevelCtaFlow,
  renderOpportunityFlow,
  renderPositionFlow,
  renderRealityFlow,
  renderSocialPlatformFlow,
  renderTrajectoryFlow,
  renderTransformationFlow,
  type SnapshotSectionStatus,
} from './reportHtmlNarrativeFlows';
import { collectMasterActions } from './reportHtmlActionDataHelpers';
import { chooseTemplate, escapeHtml, type TemplateChoice } from './reportHtmlCoreUtils';
import { stripLeadingSectionHeader } from './reportHtmlVisualPrimitives';

export function renderOmnivyraSnapshotMasterHtml(payload: PdfReportPayload): { html: string; templateName: string } {
  const vars = buildTemplateVariables(payload);
  const sections = getSnapshotSectionSpecs(payload, vars);
  const completedSections = sections.filter((section) => section.status === 'complete');
  const reviewSections = sections
    .filter((section) => section.status !== 'complete')
    .map((section) => ({
      ...section,
      html: stripLeadingSectionHeader(section.html),
    }));
  const completedMarkup = `
    <section id="completed-report" class="report-group report-group-complete">
      <div class="group-header">
        <div>
          <div class="group-kicker">Executive Snapshot</div>
          <h2>Digital Authority Snapshot</h2>
          <p>The strongest sections are organized first so the report reads as a clean executive story before the lower-confidence appendix.</p>
        </div>
        <div class="group-pill group-pill-complete">${completedSections.length} section${completedSections.length === 1 ? '' : 's'}</div>
      </div>
      <div class="report-stack completed-flow">
        ${completedSections.map((section) => section.html).join('')}
      </div>
    </section>
  `;
  const incompleteMarkup = reviewSections.length
    ? `<section id="incomplete-report" class="report-group report-group-incomplete"><div class="group-header"><div><div class="group-kicker">Appendix</div><h2>Directional Signals And Follow-Up Detail</h2><p>These sections are still useful, but they carry lower confidence or require more source depth. They sit below the main story so the report stays cleaner.</p></div><div class="group-pill group-pill-incomplete">${reviewSections.length} section${reviewSections.length === 1 ? '' : 's'}</div></div><div class="report-stack">${reviewSections.map((section) => section.html).join('')}</div></section>`
    : `<section id="incomplete-report" class="report-group report-group-incomplete"><div class="group-header"><div><div class="group-kicker">Appendix</div><h2>No lower-confidence sections in this run</h2><p>All major sections were complete enough to stay in the executive narrative above.</p></div><div class="group-pill group-pill-complete">0 sections</div></div></section>`;
  const html = renderSnapshotMasterDocument({
    companyName: vars.company_name,
    completedMarkup,
    incompleteMarkup,
  });
  return { html, templateName: 'omnivyra_snapshot_master_report.html' };
}

export function renderOmnivyraSnapshotPdfHtml(payload: PdfReportPayload): { html: string; templateName: string } {
  const vars = buildTemplateVariables(payload);
  const sections = getSnapshotSectionSpecs(payload, vars);
  const sectionStatuses = Object.fromEntries(
    sections
      .filter((section) => section.id !== 'section-overview')
      .map((section) => [section.id, section.status]),
  ) as Record<string, SnapshotSectionStatus>;
  const actions = collectMasterActions(payload);
  const completedMarkup = `
    <div class="completed-flow pdf-narrative-flow">
      ${renderHookFlow(payload, vars)}
      ${renderRealityFlow(payload)}
      ${renderInsightsFlow(payload)}
      ${renderPositionFlow(payload, vars)}
      ${renderCompetitorFlow(payload)}
      ${renderTransformationFlow(payload)}
      ${renderOpportunityFlow(payload)}
      ${renderDiagnosticsFlow(payload, vars)}
      ${renderAuthorityAiFlow(payload)}
      ${renderGeoAeoFlow(payload)}
      ${renderSocialPlatformFlow(payload, vars)}
      ${renderActionsFlow(actions)}
      ${renderTrajectoryFlow(payload, actions)}
      ${renderConfidenceFlow(payload, vars, sectionStatuses)}
      ${renderNextLevelCtaFlow(payload, vars)}
    </div>
  `;
  const html = renderSnapshotMasterDocument({
    companyName: vars.company_name,
    completedMarkup,
    incompleteMarkup: '',
  });
  return { html, templateName: 'omnivyra_snapshot_master_report.html' };
}

export function renderReportHtmlWithTemplate(
  payload: PdfReportPayload,
  templateName: TemplateChoice,
): { html: string; templateName: string } {
  if (templateName === 'omnivyra_snapshot_master_report.html') {
    return renderOmnivyraSnapshotMasterHtml(payload);
  }
  if (templateName === 'omnivyra_execution_endgame_report_template.html') {
    return renderOmnivyraExecutionEndgameHtml(payload, buildTemplateVariables(payload));
  }

  const templatePath = path.join(process.cwd(), 'templates', templateName);
  const template = fs.readFileSync(templatePath, 'utf8');
  const variables = buildTemplateVariables(payload);

  const html = Object.entries(variables).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escapeHtml(value));
  }, template);

  return {
    html,
    templateName,
  };
}

export function renderReportHtmlTemplate(payload: PdfReportPayload): { html: string; templateName: string } {
  return renderReportHtmlWithTemplate(payload, chooseTemplate(payload));
}
