import PDFDocument from 'pdfkit';
import { assertNoFallback, sanitizeRenderLines, sanitizeRenderText, sanitizeTextArtifacts } from './renderTextSanitizer';
import { renderReportHtmlTemplate } from './reportHtmlTemplateRenderer';
import { renderPdfFromHtml } from './htmlToPdfRenderer';

type PDFDoc = InstanceType<typeof PDFDocument>;

type EffortLevel = 'low' | 'medium' | 'high';
type ReportType = 'snapshot' | 'performance' | 'growth';

type PdfInsight = {
  text: string;
  whyItMatters: string;
  businessImpact: string;
};

type PdfTopPriority = {
  title: string;
  whyNow: string;
  expectedOutcome: string;
  expectedUpside: string;
  effortLevel: EffortLevel;
  priorityType: 'quick_win' | 'high_impact' | 'strategic';
  priorityWhy: string;
  impactScore: number;
  confidenceScore: number;
  impactLabel?: string;
  timeToImpact?: string;
};

type PdfNextStep = {
  action: string;
  description: string;
  steps: string[];
  expectedOutcome: string;
  expectedUpside: string;
  effortLevel: EffortLevel;
  priorityType: 'quick_win' | 'high_impact' | 'strategic';
  priorityWhy: string;
};

export type PdfReportPayload = {
  domain: string;
  companyContext?: {
    companyName: string | null;
    domain: string | null;
    homepageHeadline: string | null;
    tagline: string | null;
    primaryOffering: string | null;
    positioning: string | null;
    marketContext: string | null;
    positioningStrength?: 'strong' | 'moderate' | 'weak';
    positioningNarrative?: string;
    positioningGap?: string | null;
    marketType?: 'competitive' | 'saturated' | 'emerging' | 'niche';
    marketNarrative?: string;
    strategyAlignment?: string;
    marketPosition?: 'below market' | 'at parity' | 'ahead';
    marketPositionStatement?: string;
    positionImplication?: string;
    executionRisk?: string;
    resilienceGuidance?: string;
  };
  title: string;
  reportType: ReportType;
  generatedDate: string;
  diagnosis: string;
  summary: string;
  seoExecutiveSummary?: {
    overallHealthScore: number;
    primaryProblem: {
      title: string;
      impactedArea: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: Array<{
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }>;
    growthOpportunity: {
      title: string;
      estimatedUpside: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  seoVisuals?: {
    seoCapabilityRadar: {
      technical_seo_score: number | null;
      keyword_research_score: number | null;
      rank_tracking_score: number | null;
      backlinks_score: number | null;
      competitor_intelligence_score: number | null;
      content_quality_score: number | null;
      confidence: 'high' | 'medium' | 'low';
      data_source_strength?: Record<string, 'strong' | 'inferred' | 'weak' | 'missing'>;
      source_tags?: Record<string, string[] | null>;
      tooltips: Record<string, string>;
      insightSentence: string;
    };
    opportunityCoverageMatrix: {
      opportunities: Array<{
        keyword: string;
        opportunity_score: number;
        coverage_score: number;
        opportunity_value_score?: number | null;
        priority_bucket?: 'quick_win' | 'strategic' | 'low_priority' | null;
        confidence: 'high' | 'medium' | 'low';
      }>;
      confidence: 'high' | 'medium' | 'low';
      insightSentence: string;
    };
    searchVisibilityFunnel: {
      impressions: number | null;
      clicks: number | null;
      ctr: number | null;
      estimated_lost_clicks: number | null;
      confidence: 'high' | 'medium' | 'low';
      drop_off_reason_distribution?: {
        ranking_issue_pct: number | null;
        ctr_issue_pct: number | null;
        intent_mismatch_pct: number | null;
      };
      tooltips: Record<string, string>;
      insightSentence: string;
    };
    crawlHealthBreakdown: {
      metadata_issues: number | null;
      structure_issues: number | null;
      internal_link_issues: number | null;
      crawl_depth_issues: number | null;
      confidence: 'high' | 'medium' | 'low';
      severity_split?: {
        critical: number | null;
        moderate: number | null;
        low: number | null;
        classification: 'classified' | 'unclassified';
      };
      tooltips: Record<string, string>;
      insightSentence: string;
    };
  };
  geoAeoExecutiveSummary?: {
    overallAiVisibilityScore: number;
    primaryGap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: Array<{
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }>;
    visibilityOpportunity: {
      title: string;
      estimatedAiExposure: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  geoAeoVisuals?: {
    aiAnswerPresenceRadar: {
      answer_coverage_score: number | null;
      entity_clarity_score: number | null;
      topical_authority_score: number | null;
      citation_readiness_score: number | null;
      content_structure_score: number | null;
      freshness_score: number | null;
      confidence: 'high' | 'medium' | 'low';
      data_source_strength: 'strong' | 'inferred' | 'weak' | 'missing';
      source_tags: string[] | null;
    };
    queryAnswerCoverageMap: {
      queries: Array<{
        query: string;
        coverage: 'full' | 'partial' | 'missing';
        answer_quality_score: number;
      }>;
      confidence: 'high' | 'medium' | 'low';
    };
    answerExtractionFunnel: {
      total_queries: number | null;
      answerable_content_pct: number | null;
      structured_content_pct: number | null;
      citation_ready_pct: number | null;
      confidence: 'high' | 'medium' | 'low';
      drop_off_reason_distribution: {
        answer_gap_pct: number | null;
        structure_gap_pct: number | null;
        citation_gap_pct: number | null;
      };
    };
    entityAuthorityMap: {
      entities: Array<{
        entity: string;
        relevance_score: number;
        coverage_score: number;
      }>;
      confidence: 'high' | 'medium' | 'low';
    };
  };
  unifiedIntelligenceSummary?: {
    unifiedScore: number;
    marketContextSummary?: string;
    dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced';
    primaryConstraint: {
      title: string;
      source: 'seo' | 'geo_aeo';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3UnifiedActions: Array<{
      actionTitle: string;
      source: 'seo' | 'geo_aeo';
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    growthDirection: {
      shortTermFocus: string;
      longTermFocus: string;
    };
    confidence: 'high' | 'medium' | 'low';
  };
  competitorVisuals?: {
    competitorPositioningRadar: {
      competitors: Array<{
        name: string;
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      }>;
      user: {
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      };
      confidence: 'high' | 'medium' | 'low';
    };
    keywordGapAnalysis: {
      missing_keywords: string[];
      weak_keywords: string[];
      strong_keywords: string[];
      confidence: 'high' | 'medium' | 'low';
    };
    aiAnswerGapAnalysis: {
      missing_answers: string[];
      weak_answers: string[];
      strong_answers: string[];
      confidence: 'high' | 'medium' | 'low';
    };
  };
  competitorIntelligenceSummary?: {
    topCompetitor: string;
    primaryGap: {
      title: string;
      type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: Array<{
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    competitivePosition: 'leader' | 'competitive' | 'lagging';
    confidence: 'high' | 'medium' | 'low';
  } | null;
  competitorMovementComparison?: {
    previous_report_id: string;
    current_report_id: string;
    competitors: Array<{
      domain: string;
      previous_scores: {
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      };
      current_scores: {
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      };
      delta: {
        content_delta: number | null;
        keyword_delta: number | null;
        authority_delta: number | null;
        technical_delta: number | null;
        ai_answer_delta: number | null;
      };
      movement: 'improving' | 'declining' | 'stable';
    }>;
    user_vs_competitor_shift: {
      closest_competitor: string;
      gap_change: number | null;
      direction: 'closing_gap' | 'widening_gap' | 'unchanged';
    };
    summary: {
      overall_trend: 'improving' | 'declining' | 'stable';
      key_movement: string;
    };
  } | null;
  decisionSnapshot?: {
    primaryFocusArea: string;
    whatsBroken: string;
    whatToFixFirst: string;
    whatToDelay: string;
    ifIgnored: string;
    executionSequence: string[];
    ifExecutedWell: string;
    whenToExpectImpact: {
      shortTerm: string;
      midTerm: string;
      longTerm: string;
    };
    impactScale: 'high_impact' | 'medium_impact' | 'foundational_impact';
    currentState: string;
    expectedState: string;
    outcomeConfidence: 'high' | 'medium' | 'low';
  };
  topPriorities: PdfTopPriority[];
  insights: PdfInsight[];
  nextSteps: PdfNextStep[];
};

const PAGE = {
  size: 'A4' as const,
  margin: 42,
};

const COLORS = {
  ink: '#0f172a',
  muted: '#475569',
  faint: '#64748b',
  border: '#dbe4f0',
  panel: '#f8fafc',
  brand: '#1d4ed8',
  brandSoft: '#dbeafe',
  diagnosisBg: '#eff6ff',
  diagnosisBorder: '#93c5fd',
  priorityBg: '#f8fbff',
  actionBg: '#f8fafc',
  insightBg: '#ffffff',
  successBg: '#f0fdf4',
  warningBg: '#fff7ed',
  dangerBg: '#fff1f2',
  high: '#e11d48',
  medium: '#d97706',
  low: '#0f766e',
};

function safeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + safeNumber(value), 0) / values.length);
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPriorityType(value: 'quick_win' | 'high_impact' | 'strategic'): string {
  if (value === 'quick_win') return 'Quick Win';
  if (value === 'high_impact') return 'High Impact';
  return 'Strategic';
}

function formatReportType(value: ReportType): string {
  return value === 'snapshot'
    ? 'Snapshot Report'
    : value === 'performance'
      ? 'Performance Report'
      : 'Growth Report';
}

function deriveImpactLabel(priority: PdfTopPriority): string {
  if (priority.impactLabel) return priority.impactLabel;
  const impact = safeNumber(priority.impactScore);
  const confidence = safeNumber(priority.confidenceScore) * 100;
  if (impact >= 80 || confidence >= 80) return 'High impact';
  if (impact >= 55 || confidence >= 60) return 'Medium impact';
  return 'Emerging impact';
}

function deriveTimeToImpact(priority: PdfTopPriority): string {
  if (priority.timeToImpact) return priority.timeToImpact;
  const effort = priority.effortLevel;
  const confidence = safeNumber(priority.confidenceScore);
  if (effort === 'low' && confidence >= 0.65) return '1-2 weeks';
  if (effort === 'medium' || confidence >= 0.45) return '2-4 weeks';
  return '4-8 weeks';
}

function effortColor(level: EffortLevel): string {
  if (level === 'low') return COLORS.low;
  if (level === 'high') return COLORS.high;
  return COLORS.medium;
}

function statusColor(level: 'high' | 'medium' | 'low' | 'critical' | 'moderate'): string {
  if (level === 'high' || level === 'critical') return COLORS.high;
  if (level === 'medium' || level === 'moderate') return COLORS.medium;
  return COLORS.low;
}

function strengthColor(level: 'strong' | 'inferred' | 'weak' | 'missing' | undefined): string {
  if (level === 'strong') return '#0f766e';
  if (level === 'inferred') return '#b45309';
  if (level === 'weak') return '#be123c';
  return COLORS.faint;
}

function boxFill(level: 'high' | 'medium' | 'low' | 'critical' | 'moderate'): string {
  if (level === 'high' || level === 'critical') return COLORS.dangerBg;
  if (level === 'medium' || level === 'moderate') return COLORS.warningBg;
  return COLORS.successBg;
}

function resetTextSpacing(doc: PDFDoc) {
  const maybeDoc = doc as unknown as {
    characterSpacing?: (value: number) => unknown;
    wordSpacing?: (value: number) => unknown;
  };
  if (typeof maybeDoc.characterSpacing === 'function') maybeDoc.characterSpacing(0);
  if (typeof maybeDoc.wordSpacing === 'function') maybeDoc.wordSpacing(0);
}

function drawTextBlock(
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

function drawScoreCircle(doc: PDFDoc, score: number, x: number, y: number, size: number) {
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

function drawRadarVisual(
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

function drawFunnelVisual(
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

function drawMatrixVisual(
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

function drawHorizontalIssueBars(
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

export async function renderReportPdf(payload: PdfReportPayload): Promise<Buffer> {
  try {
    const { html } = renderReportHtmlTemplate(payload);
    const htmlPdf = await renderPdfFromHtml(html);
    if (htmlPdf.length > 0) {
      return htmlPdf;
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[reportPdfRenderer] HTML-first PDF render failed, falling back to PDFKit:', error);
    }
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
  const brandTagline =
    payload.companyContext?.tagline ||
    payload.companyContext?.homepageHeadline ||
    payload.companyContext?.marketNarrative ||
    null;
  const brandInitials = (() => {
    const cleaned = String(brandName ?? '').trim();
    if (!cleaned) return 'R';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return cleaned.slice(0, 1).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  })();

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

  const renderSeoSnapshotPdf = () => {
    const exec = payload.seoExecutiveSummary!;
    const visuals = payload.seoVisuals!;
    const geoExec = payload.geoAeoExecutiveSummary;
    const geoVisuals = payload.geoAeoVisuals;
    const unified = payload.unifiedIntelligenceSummary;
    const hasGeoLayer = Boolean(geoExec && geoVisuals);
    const leftX = doc.page.margins.left;
    const contentWidth = pageWidth;

    const truncate = (value: string | undefined, _max = 0, maxSentences = 2) =>
      sanitizeRenderText(value, { maxSentences });

    const drawPageHeader = (title: string, subtitle?: string) => {
      const headerY = doc.page.margins.top - 10;
      const hasBrandLine = Boolean(brandTagline);
      const headerHeight = subtitle
        ? hasBrandLine ? 108 : 96
        : hasBrandLine ? 88 : 72;
      doc.save();
      doc.roundedRect(leftX, headerY, contentWidth, headerHeight, 12).fillAndStroke('#f8fafc', COLORS.border);
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.ink).text(sanitizeRenderText(brandName, { maxSentences: 1 }) || brandName, leftX, doc.page.margins.top, {
        width: contentWidth,
        align: 'left',
        lineBreak: true,
      });
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.faint).text(sanitizeRenderText(payload.domain, { maxSentences: 1 }) || payload.domain, leftX, doc.y, {
        width: contentWidth,
        align: 'left',
        lineBreak: true,
      });
      if (brandTagline) {
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(sanitizeRenderText(brandTagline, { maxSentences: 1 }), leftX, doc.y, {
          width: contentWidth,
          align: 'left',
          lineBreak: true,
        });
      }
      doc.moveDown(0.1);
      doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.brand).text(sanitizeRenderText(title, { maxSentences: 1 }) || title, leftX, doc.y, { width: contentWidth, align: 'left', lineBreak: true });
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.faint).text(
        `${formatReportType(payload.reportType)}  |  Generated ${payload.generatedDate}`,
        leftX,
        doc.y,
        { width: contentWidth },
      );
      if (subtitle) {
        doc.moveDown(0.25);
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(sanitizeRenderText(subtitle, { maxSentences: 1 }), leftX, doc.y, { width: contentWidth, align: 'left', lineBreak: true });
      }
      doc.moveDown(0.8);
    };

    const drawSimpleListCard = (
      title: string,
      items: string[],
      x: number,
      y: number,
      width: number,
      height: number,
      background = COLORS.panel,
    ) => {
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
    };

    const dominantChannelLabel = !hasGeoLayer
      ? 'SEO-led'
      : unified?.dominantGrowthChannel === 'geo_aeo'
        ? 'GEO/AEO'
        : unified?.dominantGrowthChannel === 'balanced'
          ? 'Balanced'
          : 'SEO';

    const unifiedScore = typeof unified?.unifiedScore === 'number' ? unified.unifiedScore : exec.overallHealthScore;
    const primaryConstraint = unified?.primaryConstraint
      ? unified.primaryConstraint
      : {
          title: exec.primaryProblem.title,
          source: 'seo' as const,
          severity: exec.primaryProblem.severity,
          reasoning: exec.primaryProblem.reasoning,
        };

    const unifiedActionsRaw = Array.isArray(unified?.top3UnifiedActions)
      ? unified.top3UnifiedActions
      : exec.top3Actions.map((action) => ({
          actionTitle: action.actionTitle,
          source: 'seo' as const,
          priority: action.priority,
          expectedImpact: action.expectedImpact,
          effort: action.effort,
          reasoning: action.reasoning,
        }));

    const dedupedUnifiedActions: typeof unifiedActionsRaw = [];
    const seenTitles = new Set<string>();
    for (const action of unifiedActionsRaw) {
      const key = action.actionTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      dedupedUnifiedActions.push(action);
      if (dedupedUnifiedActions.length >= 3) break;
    }

    const seoSourceCount = dedupedUnifiedActions.filter((action) => action.source === 'seo').length;
    const geoSourceCount = dedupedUnifiedActions.filter((action) => action.source === 'geo_aeo').length;
    const competitorSummary = payload.competitorIntelligenceSummary;
    const competitorVisuals = payload.competitorVisuals;
    const competitorMovement = payload.competitorMovementComparison;
    const competitorRadarRows = competitorVisuals?.competitorPositioningRadar.competitors.slice(0, 3) ?? [];
    const competitorAvailable = Boolean(competitorSummary && competitorVisuals && competitorRadarRows.length > 0);

    // PAGE 1: Unified Intelligence
    drawPageHeader('Unified Intelligence', 'Single growth direction before diving into SEO and GEO/AEO details.');
    const unifiedTopY = doc.y;
    drawScoreCircle(doc, unifiedScore, leftX, unifiedTopY, 180);
    drawTextBlock(
      doc,
      primaryConstraint.title,
      truncate(primaryConstraint.reasoning, 320),
      leftX + 194,
      unifiedTopY + 8,
      contentWidth - 194,
      {
        background: boxFill(primaryConstraint.severity),
        border: COLORS.border,
        badges: [
          { label: `${primaryConstraint.severity.toUpperCase()} CONSTRAINT`, color: statusColor(primaryConstraint.severity) },
          { label: `SOURCE ${primaryConstraint.source === 'geo_aeo' ? 'GEO/AEO' : 'SEO'}`, color: COLORS.brand },
          { label: `CHANNEL ${dominantChannelLabel.toUpperCase()}`, color: hasGeoLayer ? COLORS.low : COLORS.medium },
        ],
      },
    );

    const unifiedActionsY = unifiedTopY + 194;
    drawSimpleListCard(
      'Top 3 unified actions',
      dedupedUnifiedActions.length > 0
        ? dedupedUnifiedActions.map((action, index) =>
            `${index + 1}. [${action.source === 'geo_aeo' ? 'GEO' : 'SEO'}] ${truncate(action.actionTitle, 72)} (${action.priority} priority, ${action.effort} effort)`
          )
        : ['Available signals indicate limited data coverage'],
      leftX,
      unifiedActionsY,
      contentWidth,
      134,
      COLORS.brandSoft,
    );

    drawTextBlock(
      doc,
      'Growth direction',
      [
        `Short term: ${truncate(unified?.growthDirection?.shortTermFocus, 155)}`,
        `Long term: ${truncate(unified?.growthDirection?.longTermFocus, 155)}`,
        `Source mix: SEO ${seoSourceCount} | GEO/AEO ${geoSourceCount}`,
      ].join('\n'),
      leftX,
      unifiedActionsY + 146,
      contentWidth,
      {
        background: COLORS.successBg,
        border: COLORS.border,
        badges: [{ label: `${(unified?.confidence ?? exec.confidence).toUpperCase()} CONFIDENCE`, color: statusColor(unified?.confidence ?? exec.confidence) }],
      },
    );

    // PAGE 2: Competitor Intelligence
    doc.addPage();
    drawPageHeader('Competitor Intelligence', 'How your domain compares against market competitors across SEO and GEO/AEO dimensions.');
    if (!competitorAvailable) {
      drawTextBlock(
        doc,
        'No competitor data available',
        'Competitor benchmarking could not be rendered from the current snapshot payload. Connect more market and search signals, then regenerate the report to unlock side-by-side competitor comparisons.',
        leftX,
        doc.y,
        contentWidth,
        {
          background: COLORS.panel,
          border: COLORS.border,
          badges: [{ label: 'Available signals indicate limited data coverage', color: COLORS.medium }],
        },
      );
    } else {
      const summary = competitorSummary!;
      const visuals = competitorVisuals!;
      const userRadar = visuals.competitorPositioningRadar.user;
      const topRadarRows = competitorRadarRows;
      const avgCompetitor = {
        content: Math.round(average(topRadarRows.map((item) => item.content_score))),
        keyword: Math.round(average(topRadarRows.map((item) => item.keyword_coverage_score))),
        authority: Math.round(average(topRadarRows.map((item) => item.authority_score))),
        technical: Math.round(average(topRadarRows.map((item) => item.technical_score))),
        answer: Math.round(average(topRadarRows.map((item) => item.ai_answer_presence_score))),
      };

      // SECTION 1
      drawTextBlock(
        doc,
        summary.primaryGap.title,
        [
          `Top competitor: ${summary.topCompetitor}`,
          `Competitive position: ${summary.competitivePosition}`,
          `Gap type: ${summary.primaryGap.type.replace(/_/g, ' ')}`,
          `Reasoning: ${truncate(summary.primaryGap.reasoning, 180)}`,
        ].join('\n'),
        leftX,
        doc.y,
        contentWidth,
        {
          background: boxFill(summary.primaryGap.severity),
          border: COLORS.border,
          badges: [
            { label: summary.primaryGap.severity.toUpperCase(), color: statusColor(summary.primaryGap.severity) },
            { label: `${summary.competitivePosition.toUpperCase()} POSITION`, color: summary.competitivePosition === 'leader' ? COLORS.low : summary.competitivePosition === 'competitive' ? COLORS.medium : COLORS.high },
            { label: `${summary.confidence.toUpperCase()} CONFIDENCE`, color: statusColor(summary.confidence) },
          ],
        },
      );

      // SECTION 2
      const radarY = doc.y + 136;
      drawSimpleListCard(
        'Competitor positioning radar (top 3)',
        [
          'User vs competitors (avg):',
          `Content ${userRadar.content_score} vs ${avgCompetitor.content}`,
          `Keyword coverage ${userRadar.keyword_coverage_score} vs ${avgCompetitor.keyword}`,
          `Authority ${userRadar.authority_score} vs ${avgCompetitor.authority}`,
          `Technical ${userRadar.technical_score} vs ${avgCompetitor.technical}`,
          `AI answer presence ${userRadar.ai_answer_presence_score} vs ${avgCompetitor.answer}`,
        ],
        leftX,
        radarY,
        contentWidth * 0.54,
        154,
        COLORS.panel,
      );
      drawSimpleListCard(
        'Top competitors compared',
        topRadarRows.map((row, index) => `${index + 1}. ${row.name} | SEO ${Math.round((row.content_score + row.keyword_coverage_score + row.authority_score + row.technical_score) / 4)} | AEO ${row.ai_answer_presence_score}`),
        leftX + contentWidth * 0.54 + 14,
        radarY,
        contentWidth - (contentWidth * 0.54 + 14),
        154,
        COLORS.panel,
      );

      // SECTION 3 + 4
      const gapsY = radarY + 168;
      const topMissingKeywords = visuals.keywordGapAnalysis.missing_keywords.slice(0, 5);
      const topWeakKeywords = visuals.keywordGapAnalysis.weak_keywords.slice(0, 5);
      const topMissingAnswers = visuals.aiAnswerGapAnalysis.missing_answers.slice(0, 5);

      drawSimpleListCard(
        'Keyword gap analysis',
        [
          'Missing keywords (top 5):',
          ...(topMissingKeywords.length > 0 ? topMissingKeywords : ['Available signals indicate limited data coverage']),
          'Weak keywords (top 5):',
          ...(topWeakKeywords.length > 0 ? topWeakKeywords : ['Available signals indicate limited data coverage']),
        ],
        leftX,
        gapsY,
        contentWidth * 0.54,
        168,
        COLORS.warningBg,
      );

      drawSimpleListCard(
        'AI answer gap analysis',
        [
          'Missing answers (top 5):',
          ...(topMissingAnswers.length > 0 ? topMissingAnswers : ['Available signals indicate limited data coverage']),
          `Primary gap reasoning: ${truncate(summary.primaryGap.reasoning, 96)}`,
        ],
        leftX + contentWidth * 0.54 + 14,
        gapsY,
        contentWidth - (contentWidth * 0.54 + 14),
        168,
        COLORS.warningBg,
      );
    }

    // PAGE 3: Competitor Movement
    doc.addPage();
    drawPageHeader('Competitor Movement', 'Directional movement versus your closest competitor between the latest two snapshots.');
    if (!competitorMovement || competitorMovement.competitors.length === 0) {
      drawTextBlock(
        doc,
        'No competitor movement data available',
        'Movement tracking needs at least one matchable competitor across current and previous snapshots.',
        leftX,
        doc.y,
        contentWidth,
        {
          background: COLORS.panel,
          border: COLORS.border,
          badges: [{ label: 'Available signals indicate limited data coverage', color: COLORS.medium }],
        },
      );
    } else {
      const focusDomain = competitorMovement.user_vs_competitor_shift.closest_competitor;
      const focusCompetitor = competitorMovement.competitors.find((item) => item.domain === focusDomain) ?? competitorMovement.competitors[0];
      const direction = competitorMovement.user_vs_competitor_shift.direction;
      const headline =
        direction === 'closing_gap'
          ? `You are closing the gap with ${focusCompetitor.domain}`
          : direction === 'widening_gap'
            ? `Competitor ${focusCompetitor.domain} is pulling ahead`
            : `Your gap with ${focusCompetitor.domain} is unchanged`;

      drawTextBlock(
        doc,
        headline,
        truncate(competitorMovement.summary.key_movement, 220),
        leftX,
        doc.y,
        contentWidth,
        {
          background:
            direction === 'closing_gap'
              ? COLORS.successBg
              : direction === 'widening_gap'
                ? COLORS.dangerBg
                : COLORS.panel,
          border: COLORS.border,
          badges: [
            {
              label: direction === 'closing_gap' ? 'CLOSING GAP' : direction === 'widening_gap' ? 'PULLING AHEAD' : 'UNCHANGED',
              color: direction === 'closing_gap' ? COLORS.low : direction === 'widening_gap' ? COLORS.high : COLORS.medium,
            },
            {
              label: `${competitorMovement.summary.overall_trend.toUpperCase()} TREND`,
              color: statusColor(
                competitorMovement.summary.overall_trend === 'improving'
                  ? 'high'
                  : competitorMovement.summary.overall_trend === 'declining'
                    ? 'critical'
                    : 'medium'
              ),
            },
          ],
        },
      );

      const gapChange = competitorMovement.user_vs_competitor_shift.gap_change;
      drawSimpleListCard(
        'Movement focus (1 competitor)',
        [
          `Competitor: ${focusCompetitor.domain}`,
          `Direction: ${direction.replace(/_/g, ' ')}`,
          `Gap change: ${gapChange == null ? 'Signal coverage is currently insufficient' : `${gapChange >= 0 ? '+' : ''}${Number(gapChange.toFixed(2))}`}`,
          `Keyword delta: ${focusCompetitor.delta.keyword_delta == null ? 'Signal coverage is currently insufficient' : `${focusCompetitor.delta.keyword_delta >= 0 ? '+' : ''}${Number(focusCompetitor.delta.keyword_delta.toFixed(1))}`}`,
          `Authority delta: ${focusCompetitor.delta.authority_delta == null ? 'Signal coverage is currently insufficient' : `${focusCompetitor.delta.authority_delta >= 0 ? '+' : ''}${Number(focusCompetitor.delta.authority_delta.toFixed(1))}`}`,
          `AI answer delta: ${focusCompetitor.delta.ai_answer_delta == null ? 'Signal coverage is currently insufficient' : `${focusCompetitor.delta.ai_answer_delta >= 0 ? '+' : ''}${Number(focusCompetitor.delta.ai_answer_delta.toFixed(1))}`}`,
        ],
        leftX,
        doc.y + 18,
        contentWidth,
        180,
        COLORS.panel,
      );
    }

    // PAGE 4: SEO Executive Summary
    doc.addPage();
    drawPageHeader('SEO Executive Summary', 'SEO action layer built from the same snapshot payload.');
    const scoreBoxWidth = 160;
    drawTextBlock(
      doc,
      'Primary problem',
      `${exec.primaryProblem.title}\n\n${truncate(exec.primaryProblem.reasoning, 260)}`,
      leftX + scoreBoxWidth + 18,
      doc.y,
      contentWidth - scoreBoxWidth - 18,
      {
        background: boxFill(exec.primaryProblem.severity),
        border: COLORS.border,
        badges: [
          { label: exec.primaryProblem.severity.toUpperCase(), color: statusColor(exec.primaryProblem.severity) },
          { label: exec.primaryProblem.impactedArea.replace(/_/g, ' ').toUpperCase(), color: COLORS.brand },
        ],
        bodySize: 10,
      },
    );
    drawScoreCircle(doc, exec.overallHealthScore, leftX, doc.y + 2, 140);
    doc.y += 170;

    drawSimpleListCard(
      'Top 3 actions',
      exec.top3Actions.map((action) => `${action.actionTitle} (${action.priority} priority, ${action.effort} effort)`),
      leftX,
      doc.y,
      contentWidth * 0.62,
      190,
      COLORS.brandSoft,
    );
    const actionReasonX = leftX + contentWidth * 0.62 + 14;
    drawTextBlock(
      doc,
      'Why these actions',
      exec.top3Actions.map((action, index) => `${index + 1}. ${truncate(action.reasoning, 128)}`).join('\n\n'),
      actionReasonX,
      doc.y,
      contentWidth - (contentWidth * 0.62 + 14),
      {
        background: COLORS.panel,
        border: COLORS.border,
      },
    );
    doc.y += 204;

    drawTextBlock(
      doc,
      exec.growthOpportunity?.title || 'Growth opportunity',
      exec.growthOpportunity
        ? `${truncate(exec.growthOpportunity.estimatedUpside, 180)}\n\n${truncate(exec.growthOpportunity.basedOn, 160)}`
        : 'Available signals indicate limited data coverage',
      leftX,
      doc.y,
      contentWidth,
      {
        background: COLORS.successBg,
        border: COLORS.border,
        badges: [{ label: `${exec.confidence.toUpperCase()} CONFIDENCE`, color: statusColor(exec.confidence) }],
      },
    );

    // PAGE 5: SEO Visual Intelligence
    doc.addPage();
    drawPageHeader('SEO Visual Intelligence', 'Capability and visibility visuals from the same snapshot payload shown on screen.');
    const radarWidth = (contentWidth - 18) / 2;
    const chartY = doc.y;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('SEO Capability Radar', leftX, chartY - 2, { width: radarWidth });
    drawRadarVisual(
      doc,
      [
        { label: 'Tech SEO', value: visuals.seoCapabilityRadar.technical_seo_score, strength: visuals.seoCapabilityRadar.data_source_strength?.technical_seo_score },
        { label: 'Keywords', value: visuals.seoCapabilityRadar.keyword_research_score, strength: visuals.seoCapabilityRadar.data_source_strength?.keyword_research_score },
        { label: 'Rank', value: visuals.seoCapabilityRadar.rank_tracking_score, strength: visuals.seoCapabilityRadar.data_source_strength?.rank_tracking_score },
        { label: 'Links', value: visuals.seoCapabilityRadar.backlinks_score, strength: visuals.seoCapabilityRadar.data_source_strength?.backlinks_score },
        { label: 'Competitors', value: visuals.seoCapabilityRadar.competitor_intelligence_score, strength: visuals.seoCapabilityRadar.data_source_strength?.competitor_intelligence_score },
        { label: 'Content', value: visuals.seoCapabilityRadar.content_quality_score, strength: visuals.seoCapabilityRadar.data_source_strength?.content_quality_score },
      ],
      leftX,
      chartY + 24,
      radarWidth - 10,
    );
    drawTextBlock(
      doc,
      'Why this matters',
      visuals.seoCapabilityRadar.insightSentence,
      leftX,
      chartY + 280,
      radarWidth - 10,
      { background: COLORS.panel, border: COLORS.border }
    );

    const funnelX = leftX + radarWidth + 18;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Search Visibility Funnel', funnelX, chartY - 2, { width: radarWidth });
    drawFunnelVisual(
      doc,
      [
        { label: 'Impressions', value: visuals.searchVisibilityFunnel.impressions, color: '#93c5fd' },
        { label: 'Clicks', value: visuals.searchVisibilityFunnel.clicks, color: '#2563eb' },
      ],
      funnelX,
      chartY + 34,
      radarWidth - 20,
    );
    drawSimpleListCard(
      'Drop-off reasons',
      [
        `Ranking issues: ${visuals.searchVisibilityFunnel.drop_off_reason_distribution?.ranking_issue_pct ?? 'Available signals indicate limited data coverage'}${typeof visuals.searchVisibilityFunnel.drop_off_reason_distribution?.ranking_issue_pct === 'number' ? '%' : ''}`,
        `CTR issues: ${visuals.searchVisibilityFunnel.drop_off_reason_distribution?.ctr_issue_pct ?? 'Available signals indicate limited data coverage'}${typeof visuals.searchVisibilityFunnel.drop_off_reason_distribution?.ctr_issue_pct === 'number' ? '%' : ''}`,
        `Intent mismatch: ${visuals.searchVisibilityFunnel.drop_off_reason_distribution?.intent_mismatch_pct ?? 'Available signals indicate limited data coverage'}${typeof visuals.searchVisibilityFunnel.drop_off_reason_distribution?.intent_mismatch_pct === 'number' ? '%' : ''}`,
        `Estimated lost clicks: ${visuals.searchVisibilityFunnel.estimated_lost_clicks ?? 'Available signals indicate limited data coverage'}`,
      ],
      funnelX,
      chartY + 180,
      radarWidth,
      110,
      COLORS.panel,
    );
    drawTextBlock(
      doc,
      'Why this matters',
      visuals.searchVisibilityFunnel.insightSentence,
      funnelX,
      chartY + 300,
      radarWidth,
      { background: COLORS.panel, border: COLORS.border }
    );

    // PAGE 6: SEO Opportunities + Technical
    doc.addPage();
    drawPageHeader('SEO Opportunities + Technical', 'Opportunity capture and technical health in one execution page.');
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Opportunity Coverage Matrix', leftX, doc.y, { width: contentWidth });
    drawMatrixVisual(
      doc,
      visuals.opportunityCoverageMatrix.opportunities.map((item) => ({
        keyword: item.keyword,
        opportunity: item.opportunity_score,
        coverage: item.coverage_score,
        bucket: item.priority_bucket ?? null,
      })),
      leftX,
      doc.y + 22,
      220,
    );
    drawSimpleListCard(
      'Top opportunity highlights',
      visuals.opportunityCoverageMatrix.opportunities.length > 0
        ? visuals.opportunityCoverageMatrix.opportunities.slice(0, 4).map((item) =>
            `${item.keyword}: opp ${item.opportunity_score}, coverage ${item.coverage_score}, value ${item.opportunity_value_score ?? 'N/A'}`
          )
        : ['Available signals indicate limited data coverage'],
      leftX + 236,
      doc.y + 22,
      contentWidth - 236,
      162,
      COLORS.panel,
    );
    const techY = doc.y + 196;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Technical Health', leftX, techY, { width: contentWidth });
    drawHorizontalIssueBars(
      doc,
      [
        { label: 'Metadata', value: visuals.crawlHealthBreakdown.metadata_issues, color: '#f59e0b' },
        { label: 'Structure', value: visuals.crawlHealthBreakdown.structure_issues, color: '#dc2626' },
        { label: 'Internal links', value: visuals.crawlHealthBreakdown.internal_link_issues, color: '#2563eb' },
        { label: 'Crawl depth', value: visuals.crawlHealthBreakdown.crawl_depth_issues, color: '#7c3aed' },
      ],
      leftX,
      techY + 24,
      contentWidth,
    );
    drawSimpleListCard(
      'Top technical issues summary',
      [
        `Critical: ${visuals.crawlHealthBreakdown.severity_split?.critical ?? 'Available signals indicate limited data coverage'}`,
        `Moderate: ${visuals.crawlHealthBreakdown.severity_split?.moderate ?? 'Available signals indicate limited data coverage'}`,
        `Low: ${visuals.crawlHealthBreakdown.severity_split?.low ?? 'Available signals indicate limited data coverage'}`,
        `Classification: ${visuals.crawlHealthBreakdown.severity_split?.classification ?? 'unclassified'}`,
      ],
      leftX,
      techY + 122,
      contentWidth,
      106,
      COLORS.panel,
    );

    // PAGE 7: GEO/AEO Executive Summary
    doc.addPage();
    drawPageHeader('GEO/AEO Executive Summary', 'AI-answer visibility direction and highest-priority actions.');
    if (geoExec) {
      const geoY = doc.y;
      drawScoreCircle(doc, geoExec.overallAiVisibilityScore, leftX, geoY, 140);
      drawTextBlock(
        doc,
        geoExec.primaryGap.title,
        truncate(geoExec.primaryGap.reasoning, 320),
        leftX + 154,
        geoY + 6,
        contentWidth - 154,
        {
          background: boxFill(geoExec.primaryGap.severity),
          border: COLORS.border,
          badges: [
            { label: geoExec.primaryGap.severity.toUpperCase(), color: statusColor(geoExec.primaryGap.severity) },
            { label: geoExec.primaryGap.type.replace(/_/g, ' ').toUpperCase(), color: COLORS.brand },
          ],
        },
      );
      const geoActionsY = geoY + 154;
      drawSimpleListCard(
        'Top GEO/AEO actions',
        geoExec.top3Actions.map((action) => `${action.actionTitle} (${action.priority} priority, ${action.effort} effort)`),
        leftX,
        geoActionsY,
        contentWidth * 0.62,
        190,
        COLORS.brandSoft,
      );
      drawTextBlock(
        doc,
        'Why these actions',
        geoExec.top3Actions.map((action, index) => `${index + 1}. ${truncate(action.reasoning, 128)}`).join('\n\n'),
        leftX + contentWidth * 0.62 + 14,
        geoActionsY,
        contentWidth - (contentWidth * 0.62 + 14),
        { background: COLORS.panel, border: COLORS.border },
      );
      drawTextBlock(
        doc,
        geoExec.visibilityOpportunity?.title || 'Visibility opportunity',
        geoExec.visibilityOpportunity
          ? `${truncate(geoExec.visibilityOpportunity.estimatedAiExposure, 170)}\n\n${truncate(geoExec.visibilityOpportunity.basedOn, 150)}`
          : 'Available signals indicate limited data coverage',
        leftX,
        geoActionsY + 204,
        contentWidth,
        {
          background: COLORS.successBg,
          border: COLORS.border,
          badges: [{ label: `${geoExec.confidence.toUpperCase()} CONFIDENCE`, color: statusColor(geoExec.confidence) }],
        },
      );
    } else {
      drawTextBlock(
        doc,
        'GEO/AEO executive summary',
        'Available signals indicate limited data coverage',
        leftX,
        doc.y,
        contentWidth,
        {
          background: COLORS.panel,
          border: COLORS.border,
          badges: [{ label: 'SEO-LED SNAPSHOT', color: COLORS.medium }],
        },
      );
    }

    // PAGE 8: GEO/AEO Visual Intelligence
    doc.addPage();
    drawPageHeader('GEO/AEO Visual Intelligence', 'Answer coverage, extraction readiness, and entity authority.');
    if (geoVisuals) {
      const geoRadarWidth = (contentWidth - 18) / 2;
      const geoChartY = doc.y;
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('AI Answer Presence Radar', leftX, geoChartY - 2, { width: geoRadarWidth });
      drawRadarVisual(
        doc,
        [
          { label: 'Answers', value: geoVisuals.aiAnswerPresenceRadar.answer_coverage_score, strength: geoVisuals.aiAnswerPresenceRadar.data_source_strength },
          { label: 'Entity', value: geoVisuals.aiAnswerPresenceRadar.entity_clarity_score, strength: geoVisuals.aiAnswerPresenceRadar.data_source_strength },
          { label: 'Authority', value: geoVisuals.aiAnswerPresenceRadar.topical_authority_score, strength: geoVisuals.aiAnswerPresenceRadar.data_source_strength },
          { label: 'Citation', value: geoVisuals.aiAnswerPresenceRadar.citation_readiness_score, strength: geoVisuals.aiAnswerPresenceRadar.data_source_strength },
          { label: 'Structure', value: geoVisuals.aiAnswerPresenceRadar.content_structure_score, strength: geoVisuals.aiAnswerPresenceRadar.data_source_strength },
          { label: 'Freshness', value: geoVisuals.aiAnswerPresenceRadar.freshness_score, strength: geoVisuals.aiAnswerPresenceRadar.data_source_strength },
        ],
        leftX,
        geoChartY + 24,
        geoRadarWidth - 10,
      );
      drawSimpleListCard(
        'Query coverage highlights',
        geoVisuals.queryAnswerCoverageMap.queries.length > 0
          ? geoVisuals.queryAnswerCoverageMap.queries.slice(0, 5).map((query) => `${query.query}: ${query.coverage} (${query.answer_quality_score}/100)`)
          : ['Available signals indicate limited data coverage'],
        leftX,
        geoChartY + 280,
        geoRadarWidth - 10,
        130,
        COLORS.panel,
      );

      const geoRightX = leftX + geoRadarWidth + 18;
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Answer Extraction Funnel', geoRightX, geoChartY - 2, { width: geoRadarWidth });
      drawFunnelVisual(
        doc,
        [
          { label: 'Total queries', value: geoVisuals.answerExtractionFunnel.total_queries, color: '#60a5fa' },
          { label: 'Answerable %', value: geoVisuals.answerExtractionFunnel.answerable_content_pct, color: '#2563eb' },
          { label: 'Structured %', value: geoVisuals.answerExtractionFunnel.structured_content_pct, color: '#1d4ed8' },
          { label: 'Citation-ready %', value: geoVisuals.answerExtractionFunnel.citation_ready_pct, color: '#1e40af' },
        ],
        geoRightX,
        geoChartY + 34,
        geoRadarWidth - 20,
      );
      drawSimpleListCard(
        'Entity authority map',
        geoVisuals.entityAuthorityMap.entities.length > 0
          ? geoVisuals.entityAuthorityMap.entities.slice(0, 5).map((entity) => `${entity.entity}: relevance ${entity.relevance_score}, coverage ${entity.coverage_score}`)
          : ['Available signals indicate limited data coverage'],
        geoRightX,
        geoChartY + 208,
        geoRadarWidth,
        118,
        COLORS.panel,
      );
      drawSimpleListCard(
        'Drop-off reasons',
        [
          `Answer gap: ${geoVisuals.answerExtractionFunnel.drop_off_reason_distribution.answer_gap_pct ?? 'Available signals indicate limited data coverage'}${typeof geoVisuals.answerExtractionFunnel.drop_off_reason_distribution.answer_gap_pct === 'number' ? '%' : ''}`,
          `Structure gap: ${geoVisuals.answerExtractionFunnel.drop_off_reason_distribution.structure_gap_pct ?? 'Available signals indicate limited data coverage'}${typeof geoVisuals.answerExtractionFunnel.drop_off_reason_distribution.structure_gap_pct === 'number' ? '%' : ''}`,
          `Citation gap: ${geoVisuals.answerExtractionFunnel.drop_off_reason_distribution.citation_gap_pct ?? 'Available signals indicate limited data coverage'}${typeof geoVisuals.answerExtractionFunnel.drop_off_reason_distribution.citation_gap_pct === 'number' ? '%' : ''}`,
        ],
        geoRightX,
        geoChartY + 334,
        geoRadarWidth,
        76,
        COLORS.panel,
      );
    } else {
      drawTextBlock(
        doc,
        'GEO/AEO visuals',
        'Available signals indicate limited data coverage',
        leftX,
        doc.y,
        contentWidth,
        {
          background: COLORS.panel,
          border: COLORS.border,
          badges: [{ label: 'SEO-LED SNAPSHOT', color: COLORS.medium }],
        },
      );
    }

    // PAGE 9: Confidence + Attribution + Disclaimer
    doc.addPage();
    drawPageHeader('Confidence + Attribution + Disclaimer', 'Data strength, source context, and responsible interpretation notes.');
    drawTextBlock(
      doc,
      'Data confidence explanation',
      [
        `Unified confidence: ${unified?.confidence ?? 'Available signals indicate limited data coverage'}`,
        `SEO executive confidence: ${exec.confidence}`,
        `SEO radar confidence: ${visuals.seoCapabilityRadar.confidence}`,
        `SEO matrix confidence: ${visuals.opportunityCoverageMatrix.confidence}`,
        `SEO funnel confidence: ${visuals.searchVisibilityFunnel.confidence}`,
        `SEO crawl confidence: ${visuals.crawlHealthBreakdown.confidence}`,
        `GEO/AEO executive confidence: ${geoExec?.confidence ?? 'Available signals indicate limited data coverage'}`,
        `GEO/AEO radar confidence: ${geoVisuals?.aiAnswerPresenceRadar.confidence ?? 'Available signals indicate limited data coverage'}`,
        `GEO/AEO query confidence: ${geoVisuals?.queryAnswerCoverageMap.confidence ?? 'Available signals indicate limited data coverage'}`,
        `GEO/AEO funnel confidence: ${geoVisuals?.answerExtractionFunnel.confidence ?? 'Available signals indicate limited data coverage'}`,
      ].join('\n'),
      leftX,
      doc.y,
      contentWidth,
      { background: COLORS.panel, border: COLORS.border }
    );
    drawTextBlock(
      doc,
      'Attribution explanation',
      [
        `Technical SEO sources: ${(visuals.seoCapabilityRadar.source_tags?.technical_seo_score ?? ['unclassified']).join(', ')}`,
        `Keyword sources: ${(visuals.seoCapabilityRadar.source_tags?.keyword_research_score ?? ['unclassified']).join(', ')}`,
        `Rank tracking sources: ${(visuals.seoCapabilityRadar.source_tags?.rank_tracking_score ?? ['unclassified']).join(', ')}`,
        `Backlink sources: ${(visuals.seoCapabilityRadar.source_tags?.backlinks_score ?? ['unclassified']).join(', ')}`,
        `Competitor sources: ${(visuals.seoCapabilityRadar.source_tags?.competitor_intelligence_score ?? ['unclassified']).join(', ')}`,
        `GEO/AEO sources: ${(geoVisuals?.aiAnswerPresenceRadar.source_tags ?? ['unclassified']).join(', ')}`,
      ].join('\n'),
      leftX,
      doc.y + 196,
      contentWidth,
      { background: COLORS.panel, border: COLORS.border }
    );
    drawTextBlock(
      doc,
      'Disclaimer',
      'This report is data-driven and inference-assisted. It highlights likely priorities and opportunities based on connected and crawlable signals available at generation time. It does not guarantee ranking, traffic, AI answer inclusion, or revenue outcomes.',
      leftX,
      doc.y + 384,
      contentWidth,
      { background: COLORS.warningBg, border: COLORS.border }
    );
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

  const renderSnapshotPdfDynamic = () => {
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
          if (!normalized) return;
          if (usedNarrativeSentences.has(normalized)) return;
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
  };

  if (payload.reportType === 'snapshot') {
    renderSnapshotPdfDynamic();

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
