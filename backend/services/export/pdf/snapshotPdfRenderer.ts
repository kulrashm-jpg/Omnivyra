import { sanitizeRenderText } from '../renderTextSanitizer';
import { average, COLORS, formatPriorityType, formatReportType, safeNumber, toTitleCase } from './colorHelpers';
import {
  drawFunnelVisual,
  drawHorizontalIssueBars,
  drawMatrixVisual,
  drawRadarVisual,
  drawScoreCircle,
  resetTextSpacing,
} from './drawingHelpers';
import type { PDFDoc, PdfNextStep, PdfReportPayload } from './pdfTypes';

type SnapshotRendererParams = {
  doc: PDFDoc;
  pageWidth: number;
  cardGap: number;
  brandName: string;
  payload: PdfReportPayload;
  ensureSpace: (height: number) => void;
  drawRule: () => void;
  drawSectionMetaPills: (
    items: Array<
      | { type: 'confidence'; value: string | null | undefined }
      | { type: 'trend'; value: 'improving' | 'declining' | 'stable' }
      | { type: 'label'; value: string }
    >,
  ) => void;
  drawSignalHighlight: (title: string, text: string, tone?: 'blue' | 'teal' | 'slate') => void;
  drawSectionTitle: (eyebrow: string, title: string, description?: string) => void;
  drawCard: (options: {
    title: string;
    bodyLines: string[];
    footerLines?: string[];
    background?: string;
    border?: string;
    width?: number;
    badges?: Array<{ label: string; color: string }>;
    bodyMaxItems?: number;
    footerMaxItems?: number;
  }) => void;
  drawActionCard: (action: PdfNextStep, index: number) => void;
  renderSection: (section: {
    eyebrow: string;
    title: string;
    description?: string;
    visual?: () => void;
    text: string[];
    textLineLimit?: number;
    tone?: { background?: string; border?: string };
  }) => void;
  drawReportClosingCta: () => void;
};

export function renderSnapshotPdfDynamic({
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
}: SnapshotRendererParams) {
  const unified = payload.unifiedIntelligenceSummary;
  const seo = payload.seoExecutiveSummary;
  const seoVisuals = payload.seoVisuals;
  const geo = payload.geoAeoExecutiveSummary;
  const geoVisuals = payload.geoAeoVisuals;
  const competitor = payload.competitorIntelligenceSummary;
  const authorityScore = seoVisuals?.seoCapabilityRadar.backlinks_score ?? seoVisuals?.seoCapabilityRadar.competitor_intelligence_score ?? null;
  const usedNarrativeSentences = new Set<string>();
  const overallScore =
    unified?.unifiedScore
    ?? seo?.overallHealthScore
    ?? geo?.overallAiVisibilityScore
    ?? average([
      seoVisuals?.seoCapabilityRadar.technical_seo_score ?? 0,
      seoVisuals?.seoCapabilityRadar.keyword_research_score ?? 0,
      seoVisuals?.seoCapabilityRadar.rank_tracking_score ?? 0,
      seoVisuals?.seoCapabilityRadar.content_quality_score ?? 0,
    ]);

  const hasMeaningfulText = (value: string | null | undefined) =>
    Boolean(sanitizeRenderText(value, { maxSentences: 2 }));

  const mappedExecutiveActions: PdfNextStep[] = (seo?.top3Actions ?? []).map((action) => ({
    action: action.actionTitle,
    description: action.reasoning,
    steps: [
      `Priority: ${toTitleCase(action.priority)}`,
      `Impact: ${toTitleCase(action.expectedImpact)}`,
      `Effort: ${toTitleCase(action.effort)}`,
    ],
    expectedOutcome: seo?.growthOpportunity?.title ?? 'Improve qualified visibility and traffic efficiency.',
    expectedUpside: seo?.growthOpportunity?.estimatedUpside ?? 'Turn visible demand into stronger traffic capture.',
    effortLevel: action.effort,
    priorityType: action.priority === 'high' ? 'high_impact' : action.priority === 'medium' ? 'strategic' : 'quick_win',
    priorityWhy: action.reasoning,
  }));
  const actionCards = payload.nextSteps.length > 0
    ? payload.nextSteps
    : payload.topPriorities.length > 0
      ? payload.topPriorities.slice(0, 3).map((priority) => ({
          action: priority.title,
          description: priority.whyNow,
          steps: [priority.priorityWhy, priority.expectedOutcome].filter(Boolean),
          expectedOutcome: priority.expectedOutcome,
          expectedUpside: priority.expectedUpside,
          effortLevel: priority.effortLevel,
          priorityType: priority.priorityType,
          priorityWhy: priority.priorityWhy,
        }))
      : mappedExecutiveActions;

  const normalizeSentence = (value: string): string =>
    value
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .trim();

  const splitSentences = (value: string | null | undefined): string[] => {
    if (!value) return [];
    return value
      .replace(/\n+/g, ' ')
      .split(/[.!?]\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
  };

  const buildUniqueSectionNarrative = (
    sectionKey: string,
    sources: Array<string | null | undefined>,
    maxSentences: number,
    fallback: string,
  ): string => {
    const collected: string[] = [];
    sources.forEach((source) => {
      if (!source) return;
      splitSentences(source).forEach((sentence) => {
        const normalized = normalizeSentence(sentence);
        if (!normalized || usedNarrativeSentences.has(normalized)) return;
        usedNarrativeSentences.add(normalized);
        collected.push(sentence);
      });
    });
    if (collected.length === 0) {
      if (!fallback) return '';
      const normalizedFallback = normalizeSentence(`${sectionKey} ${fallback}`);
      if (!usedNarrativeSentences.has(normalizedFallback)) {
        usedNarrativeSentences.add(normalizedFallback);
      }
      return fallback;
    }
    return collected.slice(0, Math.max(1, maxSentences)).join(' ');
  };

  const diagnosisCore = buildUniqueSectionNarrative(
    'diagnosis',
    [payload.diagnosis, unified?.primaryConstraint.reasoning, payload.summary],
    2,
    sanitizeRenderText(payload.diagnosis, { maxSentences: 2 }) || '',
  );

  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.ink).text(brandName, { width: pageWidth });
  doc.moveDown(0.05);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.faint).text(payload.domain, { width: pageWidth });
  doc.moveDown(0.15);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.brand).text('Snapshot Report', { width: pageWidth });
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.faint).text(
    `${formatReportType(payload.reportType)}  |  Generated ${payload.generatedDate}`,
    { width: pageWidth },
  );
  doc.moveDown(0.55);

  const heroHeight = 168;
  ensureSpace(heroHeight);
  const heroX = doc.page.margins.left;
  const heroY = doc.y;
  const scoreWidth = 132;
  const narrativeX = heroX + scoreWidth + 18;
  const narrativeWidth = pageWidth - scoreWidth - 18;
  doc.save();
  doc.roundedRect(heroX, heroY, pageWidth, heroHeight, 18).fillAndStroke('#f8fbff', '#c7d2fe');
  doc.restore();
  drawScoreCircle(doc, safeNumber(overallScore), heroX + 16, heroY + 20, 96);
  resetTextSpacing(doc);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.ink).text(
    sanitizeRenderText(seo?.primaryProblem.title || unified?.primaryConstraint.title || payload.title, { maxSentences: 1 }) || 'Executive Snapshot',
    narrativeX,
    heroY + 18,
    { width: narrativeWidth, align: 'left', lineBreak: true },
  );
  if (diagnosisCore) {
    resetTextSpacing(doc);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(
      diagnosisCore,
      narrativeX,
      heroY + 48,
      { width: narrativeWidth, align: 'left', lineBreak: true, lineGap: 1 },
    );
  }
  const opportunityLine = sanitizeRenderText(
    seo?.growthOpportunity?.title
      || unified?.growthDirection?.shortTermFocus
      || payload.summary,
    { maxSentences: 1 },
  );
  if (opportunityLine) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.brand).text(
      'Best Near-Term Move',
      narrativeX,
      heroY + 112,
      { width: narrativeWidth },
    );
    resetTextSpacing(doc);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink).text(
      opportunityLine,
      narrativeX,
      heroY + 126,
      { width: narrativeWidth, align: 'left', lineBreak: true },
    );
  }
  doc.y = heroY + heroHeight + cardGap;

  if (hasMeaningfulText(payload.summary)) {
    drawSignalHighlight('Executive Readout', sanitizeRenderText(payload.summary, { maxSentences: 2 }) || payload.summary, 'blue');
  }

  drawSectionTitle('Actions', 'Top Moves', 'Highest-leverage actions from this snapshot.');
  if (actionCards.length > 0) {
    actionCards.slice(0, 3).forEach((action, index) => {
      drawActionCard(action, index);
    });
  }

  drawRule();
  renderSection({
    eyebrow: 'Visuals',
    title: 'Visual Evidence',
    description: 'Primary evidence visuals for capability, demand capture, opportunity, and crawl health.',
    visual: seoVisuals
      ? () => {
          const visualBlockHeight = 440;
          ensureSpace(visualBlockHeight);
          const visualStartY = doc.y;
          const visualLeftWidth = (pageWidth - 16) / 2;
          const visualRightX = doc.page.margins.left + visualLeftWidth + 16;

          resetTextSpacing(doc);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text('SEO Capability Radar', doc.page.margins.left, visualStartY, {
            width: visualLeftWidth,
            align: 'left',
            lineBreak: true,
          });
          drawRadarVisual(
            doc,
            [
              { label: 'Tech SEO', value: seoVisuals.seoCapabilityRadar.technical_seo_score },
              { label: 'Keywords', value: seoVisuals.seoCapabilityRadar.keyword_research_score },
              { label: 'Rank', value: seoVisuals.seoCapabilityRadar.rank_tracking_score },
              { label: 'Links', value: seoVisuals.seoCapabilityRadar.backlinks_score },
              { label: 'Competitors', value: seoVisuals.seoCapabilityRadar.competitor_intelligence_score },
              { label: 'Content', value: seoVisuals.seoCapabilityRadar.content_quality_score },
            ],
            doc.page.margins.left,
            visualStartY + 18,
            Math.min(230, visualLeftWidth - 8),
          );

          resetTextSpacing(doc);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text('Search Visibility Funnel', visualRightX, visualStartY, {
            width: visualLeftWidth,
            align: 'left',
            lineBreak: true,
          });
          drawFunnelVisual(
            doc,
            [
              { label: 'Impressions', value: seoVisuals.searchVisibilityFunnel.impressions, color: '#93c5fd' },
              { label: 'Clicks', value: seoVisuals.searchVisibilityFunnel.clicks, color: '#2563eb' },
            ],
            visualRightX,
            visualStartY + 30,
            visualLeftWidth - 16,
          );

          drawMatrixVisual(
            doc,
            seoVisuals.opportunityCoverageMatrix.opportunities.slice(0, 6).map((item) => ({
              keyword: item.keyword,
              opportunity: item.opportunity_score,
              coverage: item.coverage_score,
              bucket: item.priority_bucket ?? null,
            })),
            doc.page.margins.left,
            visualStartY + 332,
            170,
          );
          drawHorizontalIssueBars(
            doc,
            [
              { label: 'Metadata', value: seoVisuals.crawlHealthBreakdown.metadata_issues, color: '#f59e0b' },
              { label: 'Structure', value: seoVisuals.crawlHealthBreakdown.structure_issues, color: '#dc2626' },
              { label: 'Internal links', value: seoVisuals.crawlHealthBreakdown.internal_link_issues, color: '#2563eb' },
              { label: 'Depth', value: seoVisuals.crawlHealthBreakdown.crawl_depth_issues, color: '#7c3aed' },
            ],
            visualRightX,
            visualStartY + 332,
            visualLeftWidth,
          );

          doc.y = visualStartY + visualBlockHeight;
        }
      : undefined,
    text: [
      seoVisuals?.seoCapabilityRadar.insightSentence ?? '',
      seoVisuals?.searchVisibilityFunnel.insightSentence ?? '',
    ],
    textLineLimit: seoVisuals ? 2 : 3,
    tone: { background: COLORS.panel, border: COLORS.border },
  });

  if (seo && hasMeaningfulText(seo.primaryProblem.reasoning)) {
    drawRule();
    drawSectionTitle('SEO', 'Why Performance Looks This Way', 'Compact causal readout from the SEO layer.');
    drawSectionMetaPills([
      { type: 'confidence', value: seo.confidence },
      { type: 'label', value: `Authority: ${authorityScore == null ? 'N/A' : authorityScore}` },
    ]);
    drawCard({
      title: seo.primaryProblem.title,
      bodyLines: [
        buildUniqueSectionNarrative('seo-cause', [seo.primaryProblem.reasoning, seoVisuals?.seoCapabilityRadar.insightSentence], 2, ''),
      ].filter(Boolean),
      footerLines: [
        sanitizeRenderText(seoVisuals?.searchVisibilityFunnel.insightSentence, { maxSentences: 1 }) || '',
      ].filter(Boolean),
      background: COLORS.panel,
      border: COLORS.border,
    });
  }

  if (geo && (hasMeaningfulText(geo.primaryGap.reasoning) || geoVisuals)) {
    drawRule();
    drawSectionTitle('GEO/AEO', 'AI Answer Visibility', 'Only included when answer-readiness signals are present.');
    drawSectionMetaPills([
      { type: 'confidence', value: geo.confidence },
      { type: 'label', value: 'Answer readiness' },
    ]);
    drawCard({
      title: geo.primaryGap.title,
      bodyLines: [
        buildUniqueSectionNarrative('geo', [geo.primaryGap.reasoning], 2, ''),
        geoVisuals
          ? `Coverage ${geoVisuals.aiAnswerPresenceRadar.answer_coverage_score ?? 'N/A'} | Citation ${geoVisuals.aiAnswerPresenceRadar.citation_readiness_score ?? 'N/A'}`
          : '',
      ].filter(Boolean),
      footerLines: [
        geo.visibilityOpportunity?.title ?? '',
      ].filter(Boolean),
      background: '#f0fdfa',
      border: '#99f6e4',
    });
  }

  if (competitor && hasMeaningfulText(competitor.primaryGap.reasoning)) {
    drawRule();
    drawSectionTitle('Competitor', 'Competitive Pressure', 'Only included when comparative signal exists.');
    drawSectionMetaPills([
      { type: 'confidence', value: competitor.confidence },
      { type: 'trend', value: payload.competitorMovementComparison?.summary.overall_trend ?? 'stable' },
    ]);
    drawCard({
      title: competitor.primaryGap.title,
      bodyLines: [
        buildUniqueSectionNarrative('competitor', [competitor.primaryGap.reasoning], 2, ''),
      ].filter(Boolean),
      footerLines: [
        `Top competitor: ${competitor.topCompetitor}`,
        `Position: ${competitor.competitivePosition}`,
      ],
      background: '#f8fafc',
      border: '#cbd5e1',
    });
  }

  if (payload.decisionSnapshot && hasMeaningfulText(payload.decisionSnapshot.whatToFixFirst)) {
    drawRule();
    drawSectionTitle('Decision', 'Execution Sequence', 'Decision layer rendered only when a decision snapshot exists.');
    drawCard({
      title: sanitizeRenderText(payload.decisionSnapshot.primaryFocusArea, { maxSentences: 1 }) || 'Execution Focus',
      bodyLines: [
        sanitizeRenderText(payload.decisionSnapshot.whatToFixFirst, { maxSentences: 1 }) || '',
        sanitizeRenderText(payload.decisionSnapshot.ifIgnored, { maxSentences: 1 }) || '',
      ].filter(Boolean),
      footerLines: payload.decisionSnapshot.executionSequence.slice(0, 2).map((item, idx) => `Step ${idx + 1}: ${item}`),
      background: COLORS.successBg,
      border: COLORS.border,
    });
  }

  if (payload.topPriorities.length > 0) {
    drawRule();
    drawSectionTitle('Priorities', 'Strategic Priorities', 'Additional priority framing from the report payload.');
    payload.topPriorities.slice(0, 2).forEach((priority, index) => {
      drawCard({
        title: `${index + 1}. ${priority.title}`,
        bodyLines: [priority.whyNow, `Expected outcome: ${priority.expectedOutcome}`],
        footerLines: [
          `Priority type: ${formatPriorityType(priority.priorityType)} | Effort: ${priority.effortLevel}`,
          priority.expectedUpside,
        ],
        background: COLORS.priorityBg,
        border: COLORS.diagnosisBorder,
      });
    });
  }

  drawRule();
  drawSectionTitle('CTA', 'Implementation', 'Close with the next move, not another paragraph.');
  drawReportClosingCta();
}
