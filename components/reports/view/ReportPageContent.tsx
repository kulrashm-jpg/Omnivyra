import Head from 'next/head';
import OpportunityCoverageMatrix from '@/components/reports/seo/OpportunityCoverageMatrix';
import SearchVisibilityFunnel from '@/components/reports/seo/SearchVisibilityFunnel';
import CrawlHealthBreakdown from '@/components/reports/seo/CrawlHealthBreakdown';
import QueryAnswerCoverageMap from '@/components/reports/geo-aeo/QueryAnswerCoverageMap';
import AnswerExtractionFunnel from '@/components/reports/geo-aeo/AnswerExtractionFunnel';
import EntityAuthorityMap from '@/components/reports/geo-aeo/EntityAuthorityMap';
import KeywordGapAnalysis from '@/components/reports/competitor/KeywordGapAnalysis';
import AiAnswerGapAnalysis from '@/components/reports/competitor/AiAnswerGapAnalysis';
import CanonicalReportSections from '@/components/reports/canonical/CanonicalReportSections';
import ProgressIndicatorBars from '@/components/reports/shared/ProgressIndicatorBars';
import {
  MarketPulseConfidenceBadge,
  MarketPulseSignalBox,
} from '@/components/reports/shared/MarketPulseVisualPrimitives';
import {
  Download,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Gauge,
  Target,
  Zap,
  ArrowRight,
} from 'lucide-react';
import {
  type ReportData,
  formatPriorityType,
  getScoreStage,
  getScoreStory,
  isSnapshotReport,
} from '@/pages/reports/view/reportView.types';
import ReportDataSections from '@/components/reports/view/ReportDataSections';

function SectionPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500" />
    </div>
  );
}

interface ReportPageContentProps {
  reportData: ReportData;
  fetchError: string | null;
  isDownloading: boolean;
  isRegenerating: boolean;
  activeSection: string;
  setActiveSection: (section: string) => void;
  onDownloadPDF: () => void;
  onRegenerate: () => void;
}

export default function ReportPageContent({
  reportData,
  fetchError,
  isDownloading,
  isRegenerating,
  activeSection,
  setActiveSection,
  onDownloadPDF,
  onRegenerate,
}: ReportPageContentProps) {
  const scoreRanges = [
    { label: 'Early-stage', min: 0, max: 44, color: 'bg-amber-100 text-amber-800 border-amber-200' },
    { label: 'Growing', min: 45, max: 74, color: 'bg-blue-100 text-blue-800 border-blue-200' },
    { label: 'Leader', min: 75, max: 100, color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  ] as const;

  const competitorDrivesTopPriority = Boolean(
    reportData?.competitorContext?.strongestGaps?.[0] &&
    reportData.topPriorities.length > 0,
  );
  const authorityProxyScore = reportData
    ? (reportData.scoreExplanation?.dimensions.find((dimension) => dimension.key === 'authority')?.value ??
      reportData.metrics.find((metric) => metric.label.toLowerCase().includes('authority'))?.score ??
      reportData.seoVisuals?.seoCapabilityRadar.backlinks_score ??
      reportData.seoVisuals?.seoCapabilityRadar.competitor_intelligence_score ??
      null)
    : null;
  const progressIndicators = [
    {
      label: 'Unified',
      score: reportData.unifiedIntelligenceSummary?.unifiedScore ?? reportData.overallScore,
      delta:
        reportData.progressComparison?.unified_score_change ??
        reportData.timelineComparison?.snapshots?.[reportData.timelineComparison.snapshots.length - 1]?.delta_from_previous ??
        null,
    },
    {
      label: 'SEO',
      score: reportData.seoExecutiveSummary?.overallHealthScore ?? null,
      delta: reportData.progressComparison?.seo_changes.health_score_delta ?? null,
    },
    {
      label: 'GEO/AEO',
      score: reportData.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null,
      delta: reportData.progressComparison?.geo_aeo_changes.ai_visibility_delta ?? null,
    },
    {
      label: 'Authority',
      score: authorityProxyScore,
      delta: reportData.competitorMovementComparison?.competitors?.[0]?.delta?.authority_delta ?? null,
    },
  ];

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high':   return 'bg-red-50 border-red-200 text-red-900';
      case 'medium': return 'bg-yellow-50 border-yellow-200 text-yellow-900';
      case 'low':    return 'bg-green-50 border-green-200 text-green-900';
      default:       return 'bg-gray-50 border-gray-200 text-gray-900';
    }
  };

  const getImpactBadge = (impact: string) => {
    const colors = {
      high: 'bg-red-100 text-red-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-green-100 text-green-800',
    };
    return colors[impact as keyof typeof colors] || colors.low;
  };

  const getCompetitorLabel = (classification: string, _source: string) => {
    if (classification === 'authority_leader') return 'Authority';
    if (classification === 'seo_competitor') return 'SEO';
    return 'Direct';
  };

  const getStandingLabel = (standing: 'Behind' | 'At Par' | 'Ahead') => {
    if (standing === 'Ahead') return 'Leading';
    if (standing === 'At Par') return 'Competitive';
    return 'Behind (needs improvement)';
  };

  const getStandingStyles = (standing: 'Behind' | 'At Par' | 'Ahead') => {
    if (standing === 'Ahead') return 'bg-emerald-100 text-emerald-700';
    if (standing === 'At Par') return 'bg-slate-100 text-slate-700';
    return 'bg-amber-100 text-amber-700';
  };

  const getTopGapLabel = (gapType?: string) => {
    if (!gapType) return 'competitive positioning';
    return gapType.replace(/_/g, ' ');
  };

  const getMarketSummary = () => {
    const competitors = reportData?.competitorContext?.competitors ?? [];
    const strongestGap = reportData?.competitorContext?.strongestGaps?.[0];
    if (!strongestGap || competitors.length === 0) {
      return 'You are currently benchmarking against your market, but the strongest gap is still forming.';
    }

    const standingOrder = { Behind: 0, 'At Par': 1, Ahead: 2 } as const;
    const weakestStanding = competitors.reduce<'Behind' | 'At Par' | 'Ahead'>((lowest, competitor) => {
      return standingOrder[competitor.standing] < standingOrder[lowest] ? competitor.standing : lowest;
    }, 'Ahead');

    const summaryLabel =
      weakestStanding === 'Ahead'
        ? 'ahead'
        : weakestStanding === 'At Par'
          ? 'at par'
          : 'behind';

    return `You are currently ${summaryLabel} your market on ${getTopGapLabel(strongestGap.gapType)}.`;
  };

  const getMarketPressure = () => {
    const gaps = reportData?.competitorContext?.strongestGaps ?? [];
    if (gaps.length === 0) return 'Low';

    const pressureScore =
      gaps.reduce((sum, gap) => sum + gap.impactScore * 0.6 + gap.confidenceScore * 100 * 0.4, 0) /
      gaps.length;

    if (gaps.length >= 2 && pressureScore >= 70) return 'High';
    if (pressureScore >= 52) return 'Moderate';
    return 'Low';
  };

  const getPressureStyles = (pressure: 'High' | 'Moderate' | 'Low') => {
    if (pressure === 'High') return 'bg-red-100 text-red-700';
    if (pressure === 'Moderate') return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  };

  const getBrandInitials = (value: string): string => {
    const cleaned = value.trim();
    if (!cleaned) return 'R';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return cleaned.slice(0, 1).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  };

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <>
      <Head>
        <title>
          {(reportData.companyContext?.companyName || reportData.domain)} - {reportData.title}
        </title>
        <meta name="robots" content="noindex" />
        <style>{`
          @media print {
            @page {
              size: A4;
              margin: 16mm;
            }

            html, body {
              background: #ffffff !important;
            }

            body * {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .print-shell {
              background: #ffffff !important;
            }

            .print-hide {
              display: none !important;
            }

            .print-section {
              margin-bottom: 24px !important;
              break-inside: avoid;
            }

            .print-card {
              break-inside: avoid;
              box-shadow: none !important;
            }

            .print-page-break {
              break-before: page;
            }
          }

          @keyframes reportFadeInUp {
            from {
              opacity: 0;
              transform: translateY(4px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .report-animate {
            animation: reportFadeInUp 320ms ease-out both;
          }

          .report-animate-delay-1 {
            animation-delay: 50ms;
          }

          .report-animate-delay-2 {
            animation-delay: 90ms;
          }

          .report-animate-delay-3 {
            animation-delay: 130ms;
          }

          .report-animate-delay-4 {
            animation-delay: 170ms;
          }

          .report-copy {
            word-break: normal;
            overflow-wrap: break-word;
            hyphens: none;
          }
        `}</style>
      </Head>

      <div className="print-shell report-copy min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
        {/* STICKY SECTION NAVIGATION */}
        <div className="print-hide sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm shadow-sm">
          <div className="mx-auto max-w-4xl px-6 py-3">
            <div className="flex items-center gap-4 overflow-x-auto text-sm">
              {[
                { id: 'summary', label: 'Summary' },
                { id: 'unified-intelligence', label: 'Unified' },
                { id: 'progress-comparison', label: 'Progress' },
                { id: 'competitor-intelligence', label: 'Competitors' },
                { id: 'seo-visuals', label: 'SEO Visuals' },
                { id: 'insights', label: 'Insights' },
                { id: 'metrics', label: 'Metrics' },
                { id: 'opportunities', label: 'Opportunities' },
                { id: 'actions', label: 'Actions' },
              ].map((section) => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`whitespace-nowrap px-3 py-2 rounded-md font-medium transition-all ${
                    activeSection === section.id
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* HEADER SECTION */}
        <div className="border-b border-slate-200 bg-white shadow-sm">
          <div className="mx-auto max-w-4xl px-6 py-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-sm font-bold text-blue-700">
                {getBrandInitials(reportData.companyContext?.companyName || reportData.domain)}
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">
                  {reportData.companyContext?.companyName || reportData.domain}
                </p>
                <p className="text-xs text-slate-500">{reportData.domain}</p>
              </div>
            </div>

            {reportData.companyContext?.tagline || reportData.companyContext?.homepageHeadline || reportData.companyContext?.primaryOffering ? (
              <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Brand context</p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {reportData.companyContext?.tagline || reportData.companyContext?.homepageHeadline}
                </p>
                {reportData.companyContext?.primaryOffering ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Primary offering: {reportData.companyContext.primaryOffering}
                  </p>
                ) : null}
                {reportData.companyContext?.positioningStrength ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Positioning strength: <span className="font-semibold">{reportData.companyContext.positioningStrength}</span>
                  </p>
                ) : null}
                {reportData.companyContext?.marketNarrative ? (
                  <p className="mt-1 text-xs text-slate-600">{reportData.companyContext.marketNarrative}</p>
                ) : null}
                {reportData.companyContext?.strategyAlignment ? (
                  <p className="mt-1 text-xs font-medium text-slate-700">
                    Strategy alignment: {reportData.companyContext.strategyAlignment}
                  </p>
                ) : null}
                {reportData.companyContext?.marketPositionStatement ? (
                  <p className="mt-1 text-xs font-medium text-slate-700">
                    {reportData.companyContext.marketPositionStatement}
                  </p>
                ) : null}
                {reportData.companyContext?.positionImplication ? (
                  <p className="mt-1 text-xs text-slate-600">
                    {reportData.companyContext.positionImplication}
                  </p>
                ) : null}
                {reportData.companyContext?.executionRisk ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Execution risk: {reportData.companyContext.executionRisk}
                  </p>
                ) : null}
                {reportData.companyContext?.resilienceGuidance ? (
                  <p className="mt-1 text-xs text-emerald-700">
                    {reportData.companyContext.resilienceGuidance}
                  </p>
                ) : null}
              </div>
            ) : null}

            {isSnapshotReport(reportData) && reportData.strategicScore ? (
              <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Strategic Strength</p>
                <p className="mt-1 text-xl font-bold text-indigo-900">
                  {reportData.strategicScore.value}/100
                  {reportData.strategicScore.strategic_score_change != null ? (
                    <span className={`ml-2 text-base ${
                      reportData.strategicScore.strategic_score_change > 0
                        ? 'text-emerald-700'
                        : reportData.strategicScore.strategic_score_change < 0
                          ? 'text-rose-700'
                          : 'text-indigo-700'
                    }`}>
                      ({reportData.strategicScore.strategic_score_change > 0 ? '+' : ''}{reportData.strategicScore.strategic_score_change})
                    </span>
                  ) : null}
                </p>
                <p className="text-sm font-medium text-indigo-800">{reportData.strategicScore.label}</p>
                <p className="mt-1 text-xs text-indigo-700">{reportData.strategicScore.interpretation}</p>
                <p className="mt-2 text-xs text-indigo-700">
                  Overall score is {reportData.overallScore}/100. Strategic Strength is a forward-looking blend of position, growth trajectory, execution risk, and positioning, so it can be higher or lower than the current-state overall score.
                </p>
                {Math.abs(reportData.strategicScore.value - reportData.overallScore) >= 10 ? (
                  <p className="mt-1 text-xs font-semibold text-indigo-800">
                    Large gap is expected when momentum/risk signals differ from current baseline performance.
                  </p>
                ) : null}
                <p className="mt-1 text-xs font-semibold text-indigo-700">
                  Movement: {reportData.strategicScore.movement}
                </p>
                <p className="mt-1 text-xs text-indigo-700">
                  Primary driver: {reportData.strategicScore.primary_driver}
                </p>
                <p className="mt-1 text-xs font-semibold text-indigo-700">
                  Confidence: {reportData.strategicScore.confidence}
                </p>
                <div className="mt-3 space-y-2">
                  {[
                    {
                      label: 'Position',
                      score: reportData.strategicScore.strategic_score_breakdown.position.score,
                      state: reportData.strategicScore.strategic_score_breakdown.position.state,
                    },
                    {
                      label: 'Growth',
                      score: reportData.strategicScore.strategic_score_breakdown.growth.score,
                      state: reportData.strategicScore.strategic_score_breakdown.growth.state,
                    },
                    {
                      label: 'Risk',
                      score: reportData.strategicScore.strategic_score_breakdown.risk.score,
                      state: reportData.strategicScore.strategic_score_breakdown.risk.state,
                    },
                    {
                      label: 'Positioning',
                      score: reportData.strategicScore.strategic_score_breakdown.positioning.score,
                      state: reportData.strategicScore.strategic_score_breakdown.positioning.state,
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="mb-0.5 flex items-center justify-between text-[11px] font-semibold text-indigo-800">
                        <span>{item.label}</span>
                        <span>{item.score} ({item.state})</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-indigo-100">
                        <div
                          className="h-2 rounded-full bg-indigo-500"
                          style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-indigo-700">
                  Position: {reportData.strategicScore.strategic_score_breakdown.position.state} | Growth: {reportData.strategicScore.strategic_score_breakdown.growth.state} | Risk: {reportData.strategicScore.strategic_score_breakdown.risk.state} | Positioning: {reportData.strategicScore.strategic_score_breakdown.positioning.state}
                </p>
              </div>
            ) : null}

            {/* CONFIDENCE SIGNAL */}
            <div className="mb-6 rounded-lg bg-slate-50 px-4 py-2 text-center">
              <p className="text-xs font-medium text-slate-600">
                Confidence signal: {reportData.confidenceSource}
              </p>
            </div>

            {/* DIAGNOSIS (1-LINE INSIGHT) */}
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-sm font-semibold text-blue-900">
                Primary diagnosis: {reportData.diagnosis}
              </p>
            </div>

            <div className="mb-8">
              <ProgressIndicatorBars items={progressIndicators} />
            </div>

            {/* Canonical Architecture Consolidation (Phase 2): single canonical report
                surface that absorbs Decision Snapshot, UnifiedIntelligenceSummary, the
                three legacy radars, time-series widgets, and the score-story block. */}
            {reportData.canonical ? (
              <div id="canonical" className="mb-8 scroll-mt-20 report-animate">
                <CanonicalReportSections report={reportData.canonical as any} />
              </div>
            ) : (
              <SectionPlaceholder
                title="Canonical report"
                description="The canonical report layer is not available for this run. Regenerate after data sources reconnect."
              />
            )}

            {/* Canonical Architecture Consolidation (Phase 2): the legacy competitor-
                intelligence card and the CompetitorPositioningRadar / KeywordGapAnalysis /
                AiAnswerGapAnalysis grid are absorbed into the canonical CompetitiveSurfaceShare
                section above. Detail panels (matrix, funnel, crawl breakdown, query coverage,
                entity map, gap analysis) remain below as L5 evidence drill-downs and become
                the foundation of the Phase 3 Evidence Trace drawer. */}

            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <h1 className="mb-2 text-3xl font-bold text-slate-900">
                  {reportData.title}
                </h1>
                <p className="mb-4 text-lg font-semibold text-slate-700">
                  {reportData.domain}
                </p>
                <p className="text-sm text-slate-600">
                  Generated on {reportData.generatedDate}
                </p>
              </div>

              {/* HEADER BUTTONS */}
              <div className="print-hide flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={onDownloadPDF}
                  disabled={isDownloading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download size={18} />
                  <span className="hidden sm:inline">
                    {isDownloading ? 'Downloading...' : 'Download PDF'}
                  </span>
                  <span className="sm:hidden">
                    {isDownloading ? '...' : 'PDF'}
                  </span>
                </button>
                <button
                  onClick={onRegenerate}
                  disabled={isRegenerating}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                >
                  <RefreshCw size={18} />
                  <span className="hidden sm:inline">{isRegenerating ? 'Regenerating...' : 'Regenerate'}</span>
                  <span className="sm:hidden">{isRegenerating ? '...' : 'Refresh'}</span>
                </button>
              </div>
            </div>
            {fetchError ? (
              <p className="mt-4 text-sm text-red-600">{fetchError}</p>
            ) : null}
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="mx-auto max-w-4xl px-6 py-12">
          {/* EXECUTIVE SUMMARY */}
          <section id="summary" className="print-section mb-12 scroll-mt-20">
            <div className="print-card rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-50 p-8">
              <div className="mb-8 flex flex-col gap-8 sm:flex-row sm:items-center sm:gap-10">
                {/* SCORE — honors overallScoreState; renders "—" when insufficient signal. */}
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-24 w-24 items-center justify-center rounded-full ${
                      reportData.overallScoreState === 'insufficient_signal' || reportData.overallScoreState === 'unavailable'
                        ? 'bg-slate-200'
                        : 'bg-gradient-to-br from-blue-400 to-blue-600'
                    }`}
                  >
                    <span className={`text-4xl font-bold ${
                      reportData.overallScoreState === 'insufficient_signal' || reportData.overallScoreState === 'unavailable'
                        ? 'text-slate-500'
                        : 'text-white'
                    }`}>
                      {reportData.overallScoreState === 'insufficient_signal' || reportData.overallScoreState === 'unavailable'
                        ? '—'
                        : reportData.overallScore}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
                      Overall Score
                    </p>
                    <p className="text-sm text-blue-900">
                      {reportData.overallScoreState === 'insufficient_signal' || reportData.overallScoreState === 'unavailable'
                        ? 'Insufficient signal'
                        : 'out of 100'}
                    </p>
                  </div>
                </div>

                {/* SCORE CONTEXT */}
                <div className="space-y-3 border-l border-blue-200 pl-6">
                  <div className="flex items-center justify-between gap-6">
                    <p className="text-sm text-slate-600">Your Score</p>
                    <p className="font-bold text-blue-700">
                      {reportData.overallScoreState === 'insufficient_signal' || reportData.overallScoreState === 'unavailable'
                        ? '—'
                        : reportData.overallScore}
                    </p>
                  </div>
                  <div className="inline-flex w-fit rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                    {getScoreStage(reportData.overallScore, reportData.overallScoreState)}
                  </div>
                  <div className="mt-2 text-xs text-slate-500 leading-relaxed">
                    {reportData.confidenceSource}
                  </div>
                </div>
              </div>

              <p className="text-lg leading-relaxed text-slate-800">
                {reportData.summary}
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                {scoreRanges.map((range) => {
                  // Canonical Trust Foundation: do not highlight any band when score is insufficient.
                  const insufficientState = reportData.overallScoreState === 'insufficient_signal' || reportData.overallScoreState === 'unavailable';
                  const active = !insufficientState && reportData.overallScore >= range.min && reportData.overallScore <= range.max;
                  return (
                    <div
                      key={range.label}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${range.color} ${active ? 'ring-2 ring-offset-1' : 'opacity-50'}`}
                    >
                      {range.label} ({range.min}-{range.max})
                    </div>
                  );
                })}
                {(reportData.overallScoreState === 'insufficient_signal' || reportData.overallScoreState === 'unavailable') ? (
                  <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 ring-2 ring-offset-1">
                    Insufficient signal
                  </div>
                ) : null}
              </div>

              {/* Canonical Architecture Consolidation (Phase 2): the Score Story,
                  Dimension Scores, Limiting Factors, Growth Path, top-priority cards,
                  SEO/GEO visual intelligence sections, and the three legacy radars are
                  absorbed into the canonical Authority Overview, Pillar Cards, and Action
                  Playbook above. Detail panels (matrix, funnel, crawl breakdown, query
                  coverage, entity map, gap analysis) appear in the L5 evidence section
                  immediately below — they will become a drawer in Phase 3. */}

              {isSnapshotReport(reportData) && (reportData.seoVisuals || reportData.geoAeoVisuals || reportData.competitorVisuals) ? (
                <section id="evidence-detail-panels" className="print-section mt-8 scroll-mt-20">
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Evidence Drill-Down</p>
                    <h3 className="mt-1 text-xl font-bold text-slate-900">Detail panels behind the canonical scores</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      Phase 2 surfaces these as inline detail panels. In Phase 3 they collapse into a per-pillar Evidence Trace drawer.
                    </p>
                  </div>
                  <div className="grid gap-5 xl:grid-cols-2">
                    {reportData.seoVisuals ? (
                      <>
                        <OpportunityCoverageMatrix data={reportData.seoVisuals.opportunityCoverageMatrix} />
                        <SearchVisibilityFunnel data={reportData.seoVisuals.searchVisibilityFunnel} />
                        <CrawlHealthBreakdown data={reportData.seoVisuals.crawlHealthBreakdown} />
                      </>
                    ) : null}
                    {reportData.geoAeoVisuals ? (
                      <>
                        <AnswerExtractionFunnel data={reportData.geoAeoVisuals.answerExtractionFunnel} />
                        <QueryAnswerCoverageMap data={reportData.geoAeoVisuals.queryAnswerCoverageMap} />
                        <EntityAuthorityMap data={reportData.geoAeoVisuals.entityAuthorityMap} />
                      </>
                    ) : null}
                    {reportData.competitorVisuals ? (
                      <>
                        <KeywordGapAnalysis data={reportData.competitorVisuals.keywordGapAnalysis} />
                        <AiAnswerGapAnalysis data={reportData.competitorVisuals.aiAnswerGapAnalysis} />
                      </>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          </section>

          <ReportDataSections reportData={reportData} />
        </div>
      </div>
    </>
  );
}
