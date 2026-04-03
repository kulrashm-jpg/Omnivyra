import Head from 'next/head';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getAuthToken } from '@/utils/getAuthToken';
import SeoCapabilityRadar from '@/components/reports/seo/SeoCapabilityRadar';
import OpportunityCoverageMatrix from '@/components/reports/seo/OpportunityCoverageMatrix';
import SearchVisibilityFunnel from '@/components/reports/seo/SearchVisibilityFunnel';
import CrawlHealthBreakdown from '@/components/reports/seo/CrawlHealthBreakdown';
import SeoExecutiveSummary from '@/components/reports/seo/SeoExecutiveSummary';
import AiAnswerPresenceRadar from '@/components/reports/geo-aeo/AiAnswerPresenceRadar';
import QueryAnswerCoverageMap from '@/components/reports/geo-aeo/QueryAnswerCoverageMap';
import AnswerExtractionFunnel from '@/components/reports/geo-aeo/AnswerExtractionFunnel';
import EntityAuthorityMap from '@/components/reports/geo-aeo/EntityAuthorityMap';
import GeoAeoExecutiveSummary from '@/components/reports/geo-aeo/GeoAeoExecutiveSummary';
import UnifiedIntelligenceSummary from '@/components/reports/unified/UnifiedIntelligenceSummary';
import ProgressComparison from '@/components/reports/progress/ProgressComparison';
import CompetitorMovement from '@/components/reports/competitor/CompetitorMovement';
import SearchGrowthTimeline from '@/components/reports/timeline/SearchGrowthTimeline';
import CompetitorExecutiveSummary from '@/components/reports/competitor/CompetitorExecutiveSummary';
import CompetitorPositioningRadar from '@/components/reports/competitor/CompetitorPositioningRadar';
import KeywordGapAnalysis from '@/components/reports/competitor/KeywordGapAnalysis';
import AiAnswerGapAnalysis from '@/components/reports/competitor/AiAnswerGapAnalysis';
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

function formatPriorityType(value: 'quick_win' | 'high_impact' | 'strategic'): string {
  if (value === 'quick_win') return 'Quick Win';
  if (value === 'high_impact') return 'High Impact';
  return 'Strategic';
}

function getScoreStage(score: number): 'Early-stage' | 'Growing' | 'Leader' {
  if (score >= 75) return 'Leader';
  if (score >= 45) return 'Growing';
  return 'Early-stage';
}

function getScoreStory(score: number, weakestDimensions: Array<{ label: string; value: number }>): string {
  const weakest = weakestDimensions.slice(0, 2).map((item) => item.label.toLowerCase()).join(' and ');
  const stage = getScoreStage(score);
  if (stage === 'Leader') {
    return `The score is in leader territory because the business has a relatively balanced baseline, although ${weakest || 'a few weaker areas'} still limit how dominant it can become.`;
  }
  if (stage === 'Growing') {
    return `The score is in the growing range because the business has real strength, but ${weakest || 'a few uneven dimensions'} are still pulling down overall market position.`;
  }
  return `The score is early-stage because weak spots in ${weakest || 'multiple core dimensions'} are reducing the total more than stronger areas can compensate for.`;
}

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
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.
      </p>
    </div>
  );
}

/**
 * Task 6 — Type safety.
 * ReportData is the canonical shape returned by /api/reports/[reportId].
 * It is derived from CompanyBlogIntelligenceResult via the server-side mappers —
 * no independent scoring logic lives here.
 */
interface ReportData {
  reportId: string;
  companyId: string;
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
  reportType: 'snapshot' | 'performance' | 'growth';
  generatedDate: string;
  status: 'generating' | 'completed' | 'failed';
  diagnosis: string;
  overallScore: number;
  scoreExplanation?: {
    dimensions: {
      key: string;
      label: string;
      value: number;
      explanation: string;
    }[];
    weakestDimensions: {
      key: string;
      label: string;
      value: number;
    }[];
    limitingFactors: string[];
    growthPath: {
      currentLevel: string;
      nextLevel: string | null;
      focus: string[];
      projectedScoreImprovements: {
        dimension: string;
        currentValue: number;
        projectedValue: number;
        projectedTotalScore: number;
      }[];
    };
  };
  confidenceSource: string;
  summary: string;
  insights: {
    text: string;
    icon: string;
    whyItMatters: string;
    businessImpact: string;
  }[];
  metrics: {
    label: string;
    score: number;
    color: string;
  }[];
  opportunities: {
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    priority: string;
  }[];
  competitorContext?: {
    summary: string;
    competitors: {
      name: string;
      domain: string | null;
      classification: string;
      source: string;
      relevanceScore: number;
      rationale: string;
      standing: 'Behind' | 'At Par' | 'Ahead';
    }[];
    strongestGaps: {
      gapType: string;
      title: string;
      whyItMatters: string;
      confidenceScore: number;
      impactScore: number;
      leadingCompetitors: string[];
    }[];
  };
  seoExecutiveSummary?: {
    overallHealthScore: number;
    primaryProblem: {
      title: string;
      impactedArea: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: {
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }[];
    growthOpportunity: {
      title: string;
      estimatedUpside: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  geoAeoExecutiveSummary?: {
    overallAiVisibilityScore: number;
    primaryGap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: {
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }[];
    visibilityOpportunity: {
      title: string;
      estimatedAiExposure: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  unifiedIntelligenceSummary?: {
    unifiedScore: number;
    marketContextSummary: string;
    dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced';
    primaryConstraint: {
      title: string;
      source: 'seo' | 'geo_aeo';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3UnifiedActions: {
      actionTitle: string;
      source: 'seo' | 'geo_aeo';
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }[];
    growthDirection: {
      shortTermFocus: string;
      longTermFocus: string;
    };
    confidence: 'high' | 'medium' | 'low';
  };
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
  strategicScore?: {
    value: number;
    label: 'strong strategic position' | 'developing position' | 'constrained position';
    strategic_score_change: number | null;
    movement: 'improving' | 'declining' | 'stable';
    primary_driver: string;
    interpretation: string;
    confidence: 'high' | 'medium' | 'low';
    strategic_score_breakdown: {
      position: { state: 'below market' | 'at parity' | 'ahead'; score: number; weight: number };
      growth: { state: 'improving' | 'stable' | 'declining'; score: number; weight: number };
      risk: { state: 'high' | 'medium' | 'low'; score: number; weight: number };
      positioning: { state: 'weak' | 'moderate' | 'strong'; score: number; weight: number };
    };
  };
  progressComparison?: {
    previous_report_id: string;
    current_report_id: string;
    unified_score_change: number | null;
    seo_changes: {
      health_score_delta: number | null;
      impressions_delta: number | null;
      clicks_delta: number | null;
      ctr_delta: number | null;
    };
    geo_aeo_changes: {
      ai_visibility_delta: number | null;
      answer_coverage_delta: number | null;
      citation_readiness_delta: number | null;
    };
    competitor_changes: {
      position_change: number | null;
      gap_reduction_score: number | null;
    };
    data_status: 'complete' | 'partial' | 'insufficient';
    summary: {
      overall_trend: 'improving' | 'declining' | 'stable';
      biggest_gain: string;
      biggest_drop: string;
    };
  } | null;
  competitorMovementComparison?: {
    previous_report_id: string;
    current_report_id: string;
    competitors: {
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
    }[];
    user_vs_competitor_shift: {
      closest_competitor: string;
      gap_change: number | null;
      direction: 'closing_gap' | 'widening_gap' | 'unchanged';
    };
    data_status: 'complete' | 'partial' | 'insufficient';
    summary: {
      overall_trend: 'improving' | 'declining' | 'stable';
      key_movement: string;
    };
  } | null;
  timelineComparison?: {
    snapshots: {
      report_id: string;
      created_at: string;
      unified_score: number | null;
      competitor: {
        domain: string;
        score: number;
      } | null;
      delta_from_previous: number | null;
    }[];
    meta: {
      trend: 'improving' | 'declining' | 'stable';
      total_change: number | null;
      data_points: number;
      data_status: 'complete' | 'partial' | 'insufficient';
    };
  } | null;
  competitorVisuals?: {
    competitorPositioningRadar: {
      competitors: {
        name: string;
        domain: string;
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      }[];
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
    competitorExplanation: string;
    primaryGap: {
      title: string;
      type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: {
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }[];
    competitivePosition: 'leader' | 'competitive' | 'lagging';
    confidence: 'high' | 'medium' | 'low';
  } | null;
  seoVisuals?: {
    seoCapabilityRadar: {
      technical_seo_score: number | null;
      keyword_research_score: number | null;
      rank_tracking_score: number | null;
      backlinks_score: number | null;
      competitor_intelligence_score: number | null;
      content_quality_score: number | null;
      confidence: 'high' | 'medium' | 'low';
      data_source_strength?: {
        technical_seo_score: 'strong' | 'inferred' | 'weak' | 'missing';
        keyword_research_score: 'strong' | 'inferred' | 'weak' | 'missing';
        rank_tracking_score: 'strong' | 'inferred' | 'weak' | 'missing';
        backlinks_score: 'strong' | 'inferred' | 'weak' | 'missing';
        competitor_intelligence_score: 'strong' | 'inferred' | 'weak' | 'missing';
        content_quality_score: 'strong' | 'inferred' | 'weak' | 'missing';
      };
      source_tags?: {
        technical_seo_score: string[] | null;
        keyword_research_score: string[] | null;
        rank_tracking_score: string[] | null;
        backlinks_score: string[] | null;
        competitor_intelligence_score: string[] | null;
        content_quality_score: string[] | null;
      };
      tooltips: Record<string, string>;
      insightSentence: string;
    };
    opportunityCoverageMatrix: {
      opportunities: {
        keyword: string;
        opportunity_score: number;
        coverage_score: number;
        opportunity_value_score?: number | null;
        priority_bucket?: 'quick_win' | 'strategic' | 'low_priority' | null;
        confidence: 'high' | 'medium' | 'low';
      }[];
      confidence: 'high' | 'medium' | 'low';
      opportunityReasoning: string;
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
      queries: {
        query: string;
        coverage: 'full' | 'partial' | 'missing';
        answer_quality_score: number;
      }[];
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
      entities: {
        entity: string;
        relevance_score: number;
        coverage_score: number;
      }[];
      confidence: 'high' | 'medium' | 'low';
    };
  };
  topPriorities: {
    title: string;
    whyNow: string;
    expectedOutcome: string;
    expectedUpside: string;
    effortLevel: 'low' | 'medium' | 'high';
    priorityType: 'quick_win' | 'high_impact' | 'strategic';
    priorityWhy: string;
    impactScore: number;
    confidenceScore: number;
    impactLabel: string;
    timeToImpact: string;
  }[];
  nextSteps: {
    action: string;
    description: string;
    steps: string[];
    expectedOutcome: string;
    expectedUpside: string;
    effortLevel: 'low' | 'medium' | 'high';
    priorityType: 'quick_win' | 'high_impact' | 'strategic';
    priorityWhy: string;
  }[];
}


export default function ReportViewPage() {
  const router = useRouter();
  const { reportId, type } = router.query;

  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);

  const scoreRanges = [
    { label: 'Early-stage', min: 0, max: 44, color: 'bg-amber-100 text-amber-800 border-amber-200' },
    { label: 'Growing', min: 45, max: 74, color: 'bg-blue-100 text-blue-800 border-blue-200' },
    { label: 'Leader', min: 75, max: 100, color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  ] as const;

  // Fetch from /api/reports/[reportId]?type=... and poll while generating
  useEffect(() => {
    if (!router.isReady || !reportId) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const MAX_ATTEMPTS = 24; // 24 × 5 s = 2 min max

    async function fetchReport() {
      try {
        const token = await getAuthToken().catch(() => null);
        const res = await fetch(
          `/api/reports/${reportId}?type=${type ?? 'snapshot'}`,
          {
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );

        if (cancelled) return;

        if (res.status === 401) {
          setFetchError('Your session expired. Please sign in again to load this report.');
          setIsGenerating(false);
          return;
        }

        if (!res.ok) {
          setFetchError('Failed to load report. Please try again.');
          setIsGenerating(false);
          return;
        }

        const data: ReportData = await res.json();

        if (data.status === 'generating') {
          setGenerationMessage(
            attempts >= MAX_ATTEMPTS
              ? 'This report is taking longer than usual. We are still processing it for you.'
              : null,
          );
          if (attempts < MAX_ATTEMPTS) {
            attempts += 1;
          }
          pollTimer = setTimeout(fetchReport, 5000);
          return;
        }

        setGenerationMessage(null);
        setReportData(data);
        setIsGenerating(false);
      } catch {
        if (!cancelled) {
          setFetchError('Could not connect to report service.');
          setIsGenerating(false);
        }
      }
    }

    fetchReport();
    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [router.isReady, reportId, type]);

  const [isDownloading, setIsDownloading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [activeSection, setActiveSection] = useState('summary');
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
  const progressIndicators = reportData
    ? [
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
      ]
    : [];

  if (isGenerating) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="mx-auto mb-6 w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Generating Your Report</h2>
          <p className="text-gray-600 mb-2">Our AI is analysing your data and composing insights.</p>
          <p className="text-sm text-gray-400">This usually takes 2–5 minutes. You can safely close this tab.</p>
          {generationMessage ? (
            <p className="mt-3 text-sm text-amber-600">{generationMessage}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (fetchError || !reportData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Report Unavailable</h2>
          <p className="text-gray-600 mb-6">{fetchError ?? 'No report data found.'}</p>
          <button
            onClick={() => router.push('/reports')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Back to Reports
          </button>
        </div>
      </div>
    );
  }

  const handleDownloadPDF = async () => {
    if (typeof window === 'undefined' || !reportData) return;

    setIsDownloading(true);
    try {
      const token = await getAuthToken().catch(() => null);
      const res = await fetch(
        `/api/reports/${reportData.reportId}?type=${reportData.reportType}&format=pdf`,
        {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );

      if (!res.ok) {
        throw new Error('Failed to generate PDF export.');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeDomain = reportData.domain.replace(/[^a-z0-9.-]+/gi, '-');
      link.href = url;
      link.download = `${reportData.reportType}-${safeDomain}-${reportData.reportId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to download PDF.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!reportData) return;

    setIsRegenerating(true);
    setFetchError(null);

    try {
      const token = await getAuthToken().catch(() => null);
      const reportCategory =
        reportData.reportType === 'growth'
          ? 'growth'
          : reportData.reportType === 'performance'
            ? 'performance'
            : 'snapshot';

      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          companyId: reportData.companyId,
          domain: reportData.domain,
          type: 'premium',
          reportCategory,
          generationContext: {
            source: 'report-regenerate',
            previousReportId: reportData.reportId,
            detailLevel: 'enhanced',
          },
        }),
      });

      const data = await res.json().catch(() => ({})) as { reportId?: string; error?: string };
      if (!res.ok || !data.reportId) {
        throw new Error(data.error || 'Failed to regenerate report');
      }

      await router.push(`/reports/view/${data.reportId}?type=${reportData.reportType}`);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'Failed to regenerate report.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high':
        return 'bg-red-50 border-red-200 text-red-900';
      case 'medium':
        return 'bg-yellow-50 border-yellow-200 text-yellow-900';
      case 'low':
        return 'bg-green-50 border-green-200 text-green-900';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-900';
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

  const getCompetitorLabel = (classification: string, source: string) => {
    if (source === 'inferred_keyword_peer') return 'Market benchmark';
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

            {reportData.reportType === 'snapshot' && reportData.strategicScore ? (
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
                ✓ {reportData.confidenceSource}
              </p>
            </div>

            {/* DIAGNOSIS (1-LINE INSIGHT) */}
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <p className="text-sm font-semibold text-blue-900">
                🎯 {reportData.diagnosis}
              </p>
            </div>

            {reportData.reportType === 'snapshot' && reportData.decisionSnapshot ? (
              <div className="mb-8 report-animate rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Decision Snapshot</p>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    Primary focus area: {reportData.decisionSnapshot.primaryFocusArea}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">What&apos;s broken</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{reportData.decisionSnapshot.whatsBroken}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">What to fix first</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-900">{reportData.decisionSnapshot.whatToFixFirst}</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">What to delay</p>
                    <p className="mt-1 text-sm text-amber-900">{reportData.decisionSnapshot.whatToDelay}</p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-rose-700">If ignored</p>
                    <p className="mt-1 text-sm text-rose-900">{reportData.decisionSnapshot.ifIgnored}</p>
                  </div>
                </div>
                {reportData.decisionSnapshot.executionSequence.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Execution sequence</p>
                    <ol className="mt-2 space-y-1 text-sm text-slate-800">
                      {reportData.decisionSnapshot.executionSequence.slice(0, 3).map((step, index) => (
                        <li key={`${step}-${index}`}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">If executed well</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-emerald-700">
                      {reportData.decisionSnapshot.impactScale.replace(/_/g, ' ')}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700">
                      Outcome confidence: {reportData.decisionSnapshot.outcomeConfidence}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-emerald-900">{reportData.decisionSnapshot.ifExecutedWell}</p>
                  <p className="mt-2 text-sm font-semibold text-emerald-900">
                    {reportData.decisionSnapshot.currentState} {'->'} {reportData.decisionSnapshot.expectedState}
                  </p>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">When to expect impact</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-800">
                    <p>{reportData.decisionSnapshot.whenToExpectImpact.shortTerm}</p>
                    <p>{reportData.decisionSnapshot.whenToExpectImpact.midTerm}</p>
                    <p>{reportData.decisionSnapshot.whenToExpectImpact.longTerm}</p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mb-8">
              <ProgressIndicatorBars items={progressIndicators} />
            </div>

            {reportData.reportType === 'snapshot' ? (
              <div id="unified-intelligence" className="mb-8 scroll-mt-20 report-animate report-animate-delay-1">
                {reportData.unifiedIntelligenceSummary ? (
                  <UnifiedIntelligenceSummary data={reportData.unifiedIntelligenceSummary} />
                ) : (
                  <SectionPlaceholder
                    title="Unified Intelligence"
                    description="We could not assemble enough unified SEO and GEO/AEO signals for this run. Re-run after more crawl, search, or competitor data is available."
                  />
                )}
              </div>
            ) : null}

            {reportData.reportType === 'snapshot' ? (
              <div id="progress-comparison" className="mb-8 scroll-mt-20 report-animate report-animate-delay-2">
                <ProgressComparison data={reportData.progressComparison ?? null} />
              </div>
            ) : null}

            {reportData.reportType === 'snapshot' ? (
              <div id="competitor-movement" className="mb-8 scroll-mt-20 report-animate report-animate-delay-3">
                <CompetitorMovement data={reportData.competitorMovementComparison ?? null} />
              </div>
            ) : null}

            {reportData.reportType === 'snapshot' ? (
              <div id="search-growth-timeline" className="mb-8 scroll-mt-20 report-animate report-animate-delay-4">
                <SearchGrowthTimeline data={reportData.timelineComparison ?? null} />
              </div>
            ) : null}

            {reportData.reportType === 'snapshot' ? (
              <div id="competitor-intelligence" className="mb-8 scroll-mt-20 space-y-5 report-animate report-animate-delay-4">
                <CompetitorExecutiveSummary data={reportData.competitorIntelligenceSummary ?? null} />
                {reportData.competitorVisuals ? (
                  <div className="grid gap-5 xl:grid-cols-2">
                    <CompetitorPositioningRadar data={reportData.competitorVisuals.competitorPositioningRadar} />
                    <KeywordGapAnalysis data={reportData.competitorVisuals.keywordGapAnalysis} />
                    <AiAnswerGapAnalysis data={reportData.competitorVisuals.aiAnswerGapAnalysis} />
                  </div>
                ) : (
                  <SectionPlaceholder
                    title="Competitor Visual Intelligence"
                    description="Competitor visual comparisons are not yet available for this report. The section remains visible so report flow stays consistent."
                  />
                )}
              </div>
            ) : null}

            {reportData.reportType === 'snapshot' ? (
              <div className="mb-8">
                {reportData.seoExecutiveSummary ? (
                  <SeoExecutiveSummary data={reportData.seoExecutiveSummary} />
                ) : (
                  <SectionPlaceholder
                    title="SEO Executive Summary"
                    description="The executive SEO layer is waiting on stronger crawl and search coverage. This section will auto-fill on the next richer run."
                  />
                )}
              </div>
            ) : null}

            {reportData.reportType === 'snapshot' ? (
              <div className="mb-8">
                {reportData.geoAeoExecutiveSummary ? (
                  <GeoAeoExecutiveSummary data={reportData.geoAeoExecutiveSummary} />
                ) : (
                  <SectionPlaceholder
                    title="GEO/AEO Executive Summary"
                    description="AI-answer visibility signals are limited in this run. We keep the section visible and explain data strength transparently."
                  />
                )}
              </div>
            ) : null}

            {reportData.reportType === 'snapshot' && reportData.competitorContext && !reportData.competitorVisuals ? (
              <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Market Context
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-slate-900">
                      How you compare to your market
                    </h2>
                    <p className="mt-3 text-base font-semibold text-slate-900">
                      {getMarketSummary()}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {reportData.competitorContext.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Market Pressure
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getPressureStyles(
                          getMarketPressure(),
                        )}`}
                      >
                        {getMarketPressure()}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {reportData.competitorContext.competitors.map((competitor, idx) => (
                      <div
                        key={`${competitor.name}-${idx}`}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{competitor.name}</p>
                          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                            {getCompetitorLabel(competitor.classification, competitor.source)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStandingStyles(
                              competitor.standing,
                            )}`}
                          >
                            {getStandingLabel(competitor.standing)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{competitor.rationale}</p>
                      </div>
                    ))}
                  </div>

                  {reportData.competitorContext.strongestGaps[0] ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                            Strongest Gap
                          </p>
                          <h3 className="mt-1 font-semibold text-slate-900">
                            {reportData.competitorContext.strongestGaps[0].title}
                          </h3>
                          <p className="mt-2 text-sm text-slate-700">
                            {reportData.competitorContext.strongestGaps[0].whyItMatters}
                          </p>
                          <p className="mt-3 text-sm font-medium text-slate-800">
                            Competitors win because {reportData.competitorContext.strongestGaps[0].whyItMatters.toLowerCase()}
                          </p>
                          {reportData.competitorContext.strongestGaps[0].leadingCompetitors.length > 0 ? (
                            <p className="mt-2 text-xs font-medium text-slate-500">
                              Led by {reportData.competitorContext.strongestGaps[0].leadingCompetitors.join(', ')}
                            </p>
                          ) : null}
                        </div>
                        {competitorDrivesTopPriority ? (
                          <div className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                            Drives top priority
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <p className="text-sm font-medium text-blue-700">
                    Fix this with your top priority below.
                  </p>
                </div>
              </div>
            ) : null}

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
                  onClick={handleDownloadPDF}
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
                  onClick={handleRegenerate}
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
                {/* SCORE */}
                <div className="flex items-center gap-4">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600">
                    <span className="text-4xl font-bold text-white">
                      {reportData.overallScore}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
                      Overall Score
                    </p>
                    <p className="text-sm text-blue-900">out of 100</p>
                  </div>
                </div>

                {/* SCORE CONTEXT */}
                <div className="space-y-3 border-l border-blue-200 pl-6">
                  <div className="flex items-center justify-between gap-6">
                    <p className="text-sm text-slate-600">Your Score</p>
                    <p className="font-bold text-blue-700">{reportData.overallScore}</p>
                  </div>
                  <div className="inline-flex w-fit rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                    {getScoreStage(reportData.overallScore)}
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
                  const active = reportData.overallScore >= range.min && reportData.overallScore <= range.max;
                  return (
                    <div
                      key={range.label}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${range.color} ${active ? 'ring-2 ring-offset-1' : 'opacity-75'}`}
                    >
                      {range.label} ({range.min}-{range.max})
                    </div>
                  );
                })}
              </div>

              {reportData.scoreExplanation ? (
                <div className="mt-6 rounded-xl border border-slate-200 bg-white/85 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Score Story
                  </p>
                  <p className="mt-3 text-base leading-relaxed text-slate-800">
                    {getScoreStory(reportData.overallScore, reportData.scoreExplanation.weakestDimensions)}
                  </p>
                </div>
              ) : null}

              {reportData.topPriorities.length > 0 ? (
                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  {reportData.topPriorities.map((priority, idx) => (
                    <div key={idx} className="print-card rounded-lg border border-blue-200 bg-white/80 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                        Priority {idx + 1}
                      </p>
                      <h3 className="mt-2 font-semibold text-slate-900">{priority.title}</h3>
                      <p className="mt-2 text-sm text-slate-600">{priority.whyNow}</p>
                      <p className="mt-2 text-sm text-slate-500">{priority.expectedOutcome}</p>
                      <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{priority.expectedUpside}</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{priority.priorityWhy}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-violet-100 px-2.5 py-1 font-semibold text-violet-700">
                          {formatPriorityType(priority.priorityType)}
                        </span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-700">
                          {priority.impactLabel}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                          Effort: {priority.effortLevel}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">
                          {priority.timeToImpact}
                        </span>
                        <span>I:{Math.round(priority.impactScore)} C:{Math.round(priority.confidenceScore * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {reportData.reportType === 'snapshot' ? (
                <section id="seo-visuals" className="print-section mt-8 scroll-mt-20">
                  <div className="mb-6">
                    <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <Gauge size={14} />
                      Visual Intelligence
                    </p>
                    <h3 className="mt-1 text-2xl font-bold text-slate-900">
                      SEO Snapshot At A Glance
                    </h3>
                    <p className="mt-2 text-sm text-slate-600">
                      These visuals summarize where search strength is building, where coverage is weak, and where technical issues are suppressing performance.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <MarketPulseConfidenceBadge value={reportData.seoVisuals?.seoCapabilityRadar.confidence ?? 'limited data'} />
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                        Focus on comparison pages and crawl hygiene to move this area fastest.
                      </span>
                    </div>
                    <div className="mt-3">
                      <MarketPulseSignalBox
                        title="Key Insight"
                        text={reportData.seoVisuals?.seoCapabilityRadar.insightSentence ?? 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
                        tone="blue"
                      />
                    </div>
                  </div>

                  {reportData.seoVisuals ? (
                    <div className="grid gap-5 xl:grid-cols-2">
                      <SeoCapabilityRadar data={reportData.seoVisuals.seoCapabilityRadar} />
                      <OpportunityCoverageMatrix data={reportData.seoVisuals.opportunityCoverageMatrix} />
                      <SearchVisibilityFunnel data={reportData.seoVisuals.searchVisibilityFunnel} />
                      <CrawlHealthBreakdown data={reportData.seoVisuals.crawlHealthBreakdown} />
                    </div>
                  ) : (
                    <SectionPlaceholder
                      title="SEO Visual Intelligence"
                      description="SEO visual diagnostics are currently limited for this report run. We keep this section pinned so your executive flow remains complete."
                    />
                  )}
                </section>
              ) : null}

              {reportData.reportType === 'snapshot' ? (
                <section id="geo-aeo-visuals" className="print-section mt-8 scroll-mt-20">
                  <div className="mb-6">
                    <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <Zap size={14} />
                      GEO / AEO Intelligence
                    </p>
                    <h3 className="mt-1 text-2xl font-bold text-slate-900">
                      AI Answer Visibility At A Glance
                    </h3>
                    <p className="mt-2 text-sm text-slate-600">
                      These visuals show how well the site can be extracted, cited, and understood in AI answer experiences.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <MarketPulseConfidenceBadge value={reportData.geoAeoVisuals?.aiAnswerPresenceRadar.confidence ?? 'limited data'} />
                      <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                        Strengthen structured answers and entity clarity to lift AI visibility.
                      </span>
                    </div>
                    <div className="mt-3">
                      <MarketPulseSignalBox
                        title="Key Insight"
                        text={reportData.geoAeoExecutiveSummary?.primaryGap.reasoning ?? 'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.'}
                        tone="teal"
                      />
                    </div>
                  </div>

                  {reportData.geoAeoVisuals ? (
                    <div className="grid gap-5 xl:grid-cols-2">
                      <AiAnswerPresenceRadar data={reportData.geoAeoVisuals.aiAnswerPresenceRadar} />
                      <AnswerExtractionFunnel data={reportData.geoAeoVisuals.answerExtractionFunnel} />
                      <QueryAnswerCoverageMap data={reportData.geoAeoVisuals.queryAnswerCoverageMap} />
                      <EntityAuthorityMap data={reportData.geoAeoVisuals.entityAuthorityMap} />
                    </div>
                  ) : (
                    <SectionPlaceholder
                      title="GEO/AEO Visual Intelligence"
                      description="GEO/AEO visuals are limited for this run. We still render this section with clear messaging so the report remains complete and shareable."
                    />
                  )}
                </section>
              ) : null}

              {reportData.scoreExplanation ? (
                <div className="mt-8 space-y-5">
                  <div className="print-card rounded-lg border border-slate-200 bg-white/85 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Dimension Scores
                      </p>
                      <p className="text-sm font-medium text-slate-600">
                        Realistic score bars by dimension
                      </p>
                    </div>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      {reportData.scoreExplanation.dimensions.map((dimension) => (
                        <div key={dimension.key} className="rounded-lg border border-slate-100 bg-slate-50/80 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900">{dimension.label}</p>
                            <p className="text-sm font-bold text-slate-700">{dimension.value}</p>
                          </div>
                          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full ${dimension.value >= 75 ? 'bg-emerald-500' : dimension.value >= 45 ? 'bg-blue-500' : 'bg-amber-500'}`}
                              style={{ width: `${dimension.value}%` }}
                            />
                          </div>
                          <p className="mt-3 text-sm text-slate-600">{dimension.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
                  <div className="print-card rounded-lg border border-amber-200 bg-white/85 p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                      What Is Limiting The Score
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {reportData.scoreExplanation.weakestDimensions.map((dimension) => (
                        <div
                          key={dimension.key}
                          className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3"
                        >
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                            {dimension.label}
                          </p>
                          <p className="mt-1 text-2xl font-bold text-amber-900">
                            {dimension.value}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 space-y-3">
                      {reportData.scoreExplanation.limitingFactors.map((factor, idx) => (
                        <p key={idx} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          {factor}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="print-card rounded-lg border border-emerald-200 bg-white/85 p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Growth Path
                    </p>
                    <p className="mt-3 text-sm text-slate-600">
                      Current level: <span className="font-semibold text-slate-900">{reportData.scoreExplanation.growthPath.currentLevel}</span>
                    </p>
                    {reportData.scoreExplanation.growthPath.nextLevel ? (
                      <p className="mt-1 text-sm text-slate-600">
                        Next level: <span className="font-semibold text-emerald-800">{reportData.scoreExplanation.growthPath.nextLevel}</span>
                      </p>
                    ) : null}
                    <div className="mt-4 space-y-2">
                      {reportData.scoreExplanation.growthPath.focus.map((item, idx) => (
                        <p key={idx} className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                          {item}
                        </p>
                      ))}
                    </div>
                    {reportData.scoreExplanation.growthPath.projectedScoreImprovements.length > 0 ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                            Fastest Improvement
                          </p>
                          <p className="mt-2 text-sm font-semibold text-emerald-900">
                            Improve {reportData.scoreExplanation.growthPath.projectedScoreImprovements[0].dimension.replace(/_/g, ' ')}
                          </p>
                          <p className="mt-1 text-sm text-emerald-800">
                            This is the single biggest lever to move the score fastest.
                          </p>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Score Trajectory
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-800">
                            <span className="rounded-full bg-white px-3 py-1 shadow-sm">
                              Current {reportData.overallScore}
                            </span>
                            <ArrowRight size={16} className="text-slate-400" />
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">
                              Next {reportData.scoreExplanation.growthPath.projectedScoreImprovements[0].projectedTotalScore}
                            </span>
                            <ArrowRight size={16} className="text-slate-400" />
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
                              Future {Math.max(...reportData.scoreExplanation.growthPath.projectedScoreImprovements.map((item) => item.projectedTotalScore))}
                            </span>
                          </div>
                        </div>

                        {reportData.scoreExplanation.growthPath.projectedScoreImprovements.slice(0, 3).map((item, idx) => (
                          <div key={idx} className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                            <p className="text-sm font-semibold text-emerald-900">
                              Improve {item.dimension.replace(/_/g, ' ')}
                            </p>
                            <p className="mt-1 text-sm text-emerald-800">
                              {item.currentValue} {'->'} {item.projectedValue} in this dimension
                            </p>
                            <p className="mt-1 text-sm text-slate-700">
                              Projected total score: <span className="font-semibold text-emerald-900">{item.projectedTotalScore}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* KEY INSIGHTS */}
          <section id="insights" className="print-section mb-12 scroll-mt-20">
            <h2 className="mb-6 text-2xl font-bold text-slate-900">
              Key Insights
            </h2>
            <div className="grid gap-4">
              {reportData.insights.map((insight, idx) => (
                <div
                  key={idx}
                  className="print-card rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md"
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-0.5 flex-shrink-0">
                      {insight.icon === 'alert' ? (
                        <AlertCircle size={20} className="text-amber-500" />
                      ) : (
                        <TrendingUp size={20} className="text-green-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{insight.text}</p>
                      <p className="mt-2 text-sm text-slate-600">
                        💡 {insight.whyItMatters}
                      </p>
                      <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        Business impact: {insight.businessImpact}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* PERFORMANCE/AUTHORITY SNAPSHOT */}
          <section id="metrics" className="print-section mb-12 scroll-mt-20">
            <h2 className="mb-6 text-2xl font-bold text-slate-900">
              {reportData.reportType === 'growth'
                ? 'Market Position Metrics'
                : 'Performance Metrics'}
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {reportData.metrics.map((metric, idx) => (
                <div
                  key={idx}
                  className="print-card rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-semibold text-slate-900">
                      {metric.label}
                    </p>
                    <p className="text-xl font-bold text-slate-900">
                      {typeof metric.score === 'number' &&
                      metric.score.toString().includes('.')
                        ? metric.score.toFixed(1) + '%'
                        : metric.score}
                      %
                    </p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full bg-gradient-to-r ${metric.color}`}
                      style={{
                        width: `${Math.min(metric.score, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* OPPORTUNITIES */}
          <section id="opportunities" className="print-section mb-12 scroll-mt-20">
            <h2 className="mb-6 text-2xl font-bold text-slate-900">
              Improvement Opportunities
            </h2>
            <div className="grid gap-4">
              {reportData.opportunities.map((opp, idx) => (
                <div
                  key={idx}
                  className={`print-card rounded-lg border p-6 ${getImpactColor(
                    opp.impact
                  )}`}
                >
                  <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
                    <h3 className="font-semibold">{opp.title}</h3>
                    <div className="flex flex-col gap-2 whitespace-nowrap sm:items-end">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getImpactBadge(
                          opp.impact
                        )}`}
                      >
                        {opp.impact} Impact
                      </span>
                      <span className="inline-block rounded-full bg-white/50 px-3 py-1 text-xs font-semibold text-slate-700">
                        {opp.priority}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm opacity-90">{opp.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ACTIONABLE NEXT STEPS */}
          <section id="actions" className="print-section print-page-break mb-16 scroll-mt-20">
            <h2 className="mb-6 text-2xl font-bold text-slate-900">
              Your Next Steps
            </h2>
            <div className="space-y-4">
              {reportData.nextSteps.map((step, idx) => (
                <div
                  key={idx}
                  className="print-card rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600">
                      {idx + 1}
                    </div>
                    <h3 className="font-semibold text-slate-900">
                      {step.action}
                    </h3>
                  </div>
                  <p className="ml-11 text-slate-700">{step.description}</p>
                  <p className="ml-11 mt-3 text-sm font-medium text-slate-700">{step.priorityWhy}</p>
                  <p className="ml-11 mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{step.expectedUpside}</p>
                  <div className="ml-11 mt-4 flex items-center gap-4 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <span>{formatPriorityType(step.priorityType)}</span>
                    <span>Effort: {step.effortLevel}</span>
                    <span>Outcome: {step.expectedOutcome}</span>
                  </div>
                  {step.steps.length > 0 ? (
                    <ol className="ml-16 mt-4 list-decimal space-y-2 text-sm text-slate-600">
                      {step.steps.map((item, stepIndex) => (
                        <li key={stepIndex}>{item}</li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {/* FOOTER CTA */}
          <section className="print-hide rounded-lg border-t border-slate-200 bg-gradient-to-r from-blue-50 to-slate-50 p-8 text-center">
            <h3 className="mb-2 text-xl font-bold text-slate-900">
              Ready to execute?
            </h3>
            <p className="mb-6 text-slate-700">
              This report is your strategic foundation. Start with the highest-impact opportunities and track progress weekly.
            </p>
            <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-all hover:bg-blue-700">
              Get Implementation Guide
              <ArrowRight size={18} />
            </button>
          </section>
        </div>
      </div>
    </>
  );
}

