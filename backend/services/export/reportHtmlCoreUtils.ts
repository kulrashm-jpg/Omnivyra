import type { PdfReportPayload } from './reportPdfRenderer';
import { assertNoFallback, sanitizeRenderText, sanitizeTextArtifacts } from './renderTextSanitizer';

export type TemplateChoice =
  | 'best_omnivyra_final_report_template.html'
  | 'omnivyra_snapshot_master_report.html'
  | 'omnivyra_snapshot_compact_report_template.html'
  | 'omnivyra_decision_flow_report_template.html'
  | 'omnivyra_visual_intelligence_report_template.html'
  | 'omnivyra_execution_endgame_report_template.html'
  | 'best_signal_rich_report_template.html'
  | 'best_sparse_signal_report_template.html'
  | 'best_balanced_report_template.html'
  | 'best_executive_report_template.html';

export type BrandProfile = {
  companyName: string;
  websiteUrl: string;
  primaryFocus: string;
  executiveSummary: string;
  confidenceSummary: string;
  scoreSummary: string;
  trustSummary: string;
  conversionSummary: string;
  ctaText: string;
};

export function safeText(value: string | null | undefined, maxSentences = 2): string {
  const clean = sanitizeRenderText(sanitizeTextArtifacts(value ?? '').replace(/\s+/g, ' ').trim(), { maxSentences }) || '';
  if (clean) assertNoFallback(clean);
  return clean;
}

export function safeScore(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(Math.round(Number(value))) : '0';
}

export function getBrandName(payload: PdfReportPayload): string {
  return safeText(payload.companyContext?.companyName || payload.domain, 1) || payload.domain;
}

export function isOmnivyraPayload(payload: PdfReportPayload): boolean {
  const haystack = [
    payload.domain,
    payload.companyContext?.companyName,
    payload.companyContext?.homepageHeadline,
    payload.companyContext?.tagline,
  ].join(' ').toLowerCase();
  return haystack.includes('omnivyra');
}

export function getBrandProfile(payload: PdfReportPayload): BrandProfile | null {
  if (!isOmnivyraPayload(payload)) return null;
  return {
    companyName: 'OmniVyra',
    websiteUrl: 'www.omnivyra.com',
    primaryFocus: 'AI marketing operating system',
    executiveSummary: 'The site should communicate one operating system for readiness, strategy, creation, publishing, and optimization, then convert that understanding into action.',
    confidenceSummary: 'This version should read like an executive report, with product clarity, system credibility, and buyer momentum reinforced across sections.',
    scoreSummary: 'The strongest report balances strategic intelligence with product trust: what the platform does, why the workflow matters, and where the site is leaking conversion confidence.',
    trustSummary: 'Credibility comes from workflow clarity, depth of capability, and visible proof of execution across the pages that drive decisions.',
    conversionSummary: 'Conversion depends on connecting readiness analysis, campaign planning, content execution, and optimization into one buyer journey.',
    ctaText: 'Tighten the story so the site presents one connected system from understanding through execution, not a set of isolated SEO tasks.',
  };
}

export function getOverallScore(payload: PdfReportPayload): number {
  return payload.unifiedIntelligenceSummary?.unifiedScore
    ?? payload.seoExecutiveSummary?.overallHealthScore
    ?? payload.geoAeoExecutiveSummary?.overallAiVisibilityScore
    ?? 0;
}

export function chooseOmnivyraTemplate(payload: PdfReportPayload): TemplateChoice {
  if (payload.reportType === 'performance') {
    return 'omnivyra_visual_intelligence_report_template.html';
  }
  if (payload.reportType === 'growth') {
    return 'omnivyra_execution_endgame_report_template.html';
  }
  return 'omnivyra_snapshot_master_report.html';
}

export function chooseTemplate(payload: PdfReportPayload): TemplateChoice {
  if (isOmnivyraPayload(payload)) {
    return chooseOmnivyraTemplate(payload);
  }
  const score = getOverallScore(payload);
  if (payload.decisionSnapshot || payload.unifiedIntelligenceSummary) {
    return 'best_executive_report_template.html';
  }
  if (score >= 72) return 'best_signal_rich_report_template.html';
  if (score <= 45) return 'best_sparse_signal_report_template.html';
  return 'best_balanced_report_template.html';
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

export function hasRealAiVisibilityData(payload: PdfReportPayload): boolean {
  const radar = payload.geoAeoVisuals?.aiAnswerPresenceRadar;
  const queryMap = payload.geoAeoVisuals?.queryAnswerCoverageMap;
  const extraction = payload.geoAeoVisuals?.answerExtractionFunnel;
  const entityMap = payload.geoAeoVisuals?.entityAuthorityMap;

  return Boolean(
    (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? 0) > 0 ||
    (radar?.answer_coverage_score ?? 0) > 0 ||
    (radar?.entity_clarity_score ?? 0) > 0 ||
    (radar?.topical_authority_score ?? 0) > 0 ||
    (radar?.citation_readiness_score ?? 0) > 0 ||
    (radar?.content_structure_score ?? 0) > 0 ||
    (radar?.freshness_score ?? 0) > 0 ||
    (queryMap?.queries?.length ?? 0) > 0 ||
    (extraction?.total_queries ?? 0) > 0 ||
    (entityMap?.entities?.length ?? 0) > 0
  );
}

export function clampPercent(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

export function stripTimelinePrefix(value: string | null | undefined, label: string): string {
  const cleaned = safeText(value, 2);
  if (!cleaned) return '';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleaned.replace(new RegExp(`^\\s*(?:${escapedLabel})\\s*:?\\s*`, 'i'), '').trim();
}
