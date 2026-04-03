import { renderReportPdf } from '../../services/export/reportPdfRenderer';

describe('reportPdfRenderer', () => {
  it('renders the executive snapshot PDF with seo visuals', async () => {
    const buffer = await renderReportPdf({
      domain: 'example.com',
      title: 'SEO Snapshot Report',
      reportType: 'snapshot',
      generatedDate: 'Apr 1, 2026',
      diagnosis: 'Organic visibility is being constrained by weak content coverage and crawl-level friction.',
      summary: 'Snapshot summary',
      seoExecutiveSummary: {
        overallHealthScore: 58,
        primaryProblem: {
          title: 'Technical crawlability and thin content are suppressing search performance',
          impactedArea: 'technical_seo',
          severity: 'moderate',
          reasoning: 'The crawl shows visible technical friction and the strongest search opportunities are still under-covered.',
        },
        top3Actions: [
          {
            actionTitle: 'Fix crawl errors on high-value pages',
            priority: 'high',
            expectedImpact: 'high',
            effort: 'medium',
            linkedVisual: 'crawl',
            reasoning: 'Crawl issues are concentrated on pages that should rank and convert.',
          },
          {
            actionTitle: 'Expand coverage around core service keywords',
            priority: 'high',
            expectedImpact: 'high',
            effort: 'medium',
            linkedVisual: 'matrix',
            reasoning: 'Opportunity scores are high while current coverage remains uneven.',
          },
          {
            actionTitle: 'Improve SERP messaging to recover lost clicks',
            priority: 'medium',
            expectedImpact: 'medium',
            effort: 'low',
            linkedVisual: 'funnel',
            reasoning: 'Current visibility is not converting enough impressions into visits.',
          },
        ],
        growthOpportunity: {
          title: 'Win more traffic from buyer-intent service queries',
          estimatedUpside: 'The current funnel suggests meaningful incremental clicks are recoverable.',
          basedOn: 'Based on opportunity coverage plus lost clicks in the visibility funnel.',
        },
        confidence: 'high',
      },
      seoVisuals: {
        seoCapabilityRadar: {
          technical_seo_score: 49,
          keyword_research_score: 61,
          rank_tracking_score: 57,
          backlinks_score: 52,
          competitor_intelligence_score: 55,
          content_quality_score: 64,
          confidence: 'high',
          data_source_strength: {
            technical_seo_score: 'strong',
            keyword_research_score: 'inferred',
            rank_tracking_score: 'strong',
            backlinks_score: 'weak',
            competitor_intelligence_score: 'inferred',
            content_quality_score: 'inferred',
          },
          source_tags: {
            technical_seo_score: ['crawler'],
            keyword_research_score: ['GSC', 'heuristic'],
            rank_tracking_score: ['GSC'],
            backlinks_score: ['heuristic'],
            competitor_intelligence_score: ['competitor_intelligence', 'heuristic'],
            content_quality_score: ['crawler', 'heuristic'],
          },
          tooltips: {},
          insightSentence: 'SEO capability is uneven across technical, keyword, and authority dimensions.',
        },
        opportunityCoverageMatrix: {
          opportunities: [
            {
              keyword: 'b2b seo agency',
              opportunity_score: 78,
              coverage_score: 42,
              opportunity_value_score: 74,
              priority_bucket: 'quick_win',
              confidence: 'high',
            },
          ],
          confidence: 'high',
          insightSentence: 'The highest-value keyword opportunities are visible where coverage remains low.',
        },
        searchVisibilityFunnel: {
          impressions: 4200,
          clicks: 168,
          ctr: 0.04,
          estimated_lost_clicks: 126,
          confidence: 'high',
          drop_off_reason_distribution: {
            ranking_issue_pct: 46,
            ctr_issue_pct: 34,
            intent_mismatch_pct: 20,
          },
          tooltips: {},
          insightSentence: 'Search visibility is creating demand, but too many clicks are still being lost.',
        },
        crawlHealthBreakdown: {
          metadata_issues: 8,
          structure_issues: 6,
          internal_link_issues: 4,
          crawl_depth_issues: 2,
          confidence: 'high',
          severity_split: {
            critical: 8,
            moderate: 10,
            low: 2,
            classification: 'classified',
          },
          tooltips: {},
          insightSentence: 'Crawl health issues are concentrated in metadata and structure.',
        },
      },
      topPriorities: [],
      insights: [],
      nextSteps: [],
    });

    expect(buffer.length).toBeGreaterThan(0);
  });
});
