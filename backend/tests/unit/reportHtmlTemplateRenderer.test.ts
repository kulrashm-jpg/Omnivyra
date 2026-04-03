import { renderReportHtmlTemplate } from '../../services/export/reportHtmlTemplateRenderer';
import type { PdfReportPayload } from '../../services/export/reportPdfRenderer';

describe('reportHtmlTemplateRenderer', () => {
  const basePayload: PdfReportPayload = {
    domain: 'example.com',
    title: 'SEO Snapshot Report',
    reportType: 'snapshot',
    generatedDate: 'Apr 2, 2026',
    diagnosis: 'Clear diagnosis text.',
    summary: 'Compact summary text.',
    topPriorities: [],
    insights: [],
    nextSteps: [],
  };

  it('selects the signal-rich template for strong reports', () => {
    const { html, templateName } = renderReportHtmlTemplate({
      ...basePayload,
      seoExecutiveSummary: {
        overallHealthScore: 82,
        primaryProblem: {
          title: 'Primary issue',
          impactedArea: 'content',
          severity: 'moderate',
          reasoning: 'Reasoning text.',
        },
        top3Actions: [
          {
            actionTitle: 'Action one',
            priority: 'high',
            expectedImpact: 'high',
            effort: 'medium',
            linkedVisual: 'matrix',
            reasoning: 'Action detail.',
          },
        ],
        growthOpportunity: {
          title: 'Opportunity title',
          estimatedUpside: 'Upside text.',
          basedOn: 'Based on text.',
        },
        confidence: 'high',
      },
    });

    expect(templateName).toBe('best_signal_rich_report_template.html');
    expect(html).toContain('Strategic Snapshot');
    expect(html).toContain('Action one');
  });

  it('selects the sparse template for low-score reports', () => {
    const { html, templateName } = renderReportHtmlTemplate({
      ...basePayload,
      seoExecutiveSummary: {
        overallHealthScore: 31,
        primaryProblem: {
          title: 'Thin coverage',
          impactedArea: 'content',
          severity: 'critical',
          reasoning: 'Site is sparse.',
        },
        top3Actions: [],
        growthOpportunity: null,
        confidence: 'low',
      },
    });

    expect(templateName).toBe('best_sparse_signal_report_template.html');
    expect(html).toContain('Baseline Opportunity Report');
  });

  it('injects Omnivyra-specific content when the payload is for Omnivyra', () => {
    const { html, templateName } = renderReportHtmlTemplate({
      ...basePayload,
      domain: 'www.omnivyra.com',
      companyContext: {
        companyName: 'Omnivyra',
        domain: 'www.omnivyra.com',
        homepageHeadline: 'AI marketing operating system',
        tagline: 'Understand, plan, create, publish, optimize',
        primaryOffering: null,
        positioning: null,
        marketContext: null,
      },
      seoExecutiveSummary: {
        overallHealthScore: 77,
        primaryProblem: {
          title: 'Positioning needs more product depth',
          impactedArea: 'content',
          severity: 'moderate',
          reasoning: 'The current site communicates value, but the operating-system story can be made more concrete.',
        },
        top3Actions: [],
        growthOpportunity: {
          title: 'Strengthen product trust',
          estimatedUpside: 'More buyers should understand the full workflow faster.',
          basedOn: 'Product clarity compounds conversion quality.',
        },
        confidence: 'high',
      },
      competitorIntelligenceSummary: {
        topCompetitor: 'saas-search-rival.com',
        primaryGap: {
          title: 'Competitors are signaling more authority',
          type: 'authority_gap',
          severity: 'critical',
          reasoning: 'Competitors are creating more trust and commercial certainty than Omnivyra right now.',
        },
        top3Actions: [],
        competitivePosition: 'lagging',
        confidence: 'high',
      },
      competitorVisuals: {
        competitorPositioningRadar: {
          competitors: [
            {
              name: 'saas-search-rival.com',
              content_score: 76,
              keyword_coverage_score: 72,
              authority_score: 81,
              technical_score: 64,
              ai_answer_presence_score: 69,
            },
          ],
          user: {
            content_score: 42,
            keyword_coverage_score: 38,
            authority_score: 35,
            technical_score: 51,
            ai_answer_presence_score: 28,
          },
          confidence: 'high',
        },
        keywordGapAnalysis: {
          missing_keywords: ['buyer intent pages', 'comparison pages'],
          weak_keywords: ['workflow proof'],
          strong_keywords: ['AI marketing operating system'],
          confidence: 'medium',
        },
        aiAnswerGapAnalysis: {
          missing_answers: ['what Omnivyra replaces', 'how the workflow works'],
          weak_answers: ['who it is for'],
          strong_answers: ['AI marketing operating system'],
          confidence: 'medium',
        },
      },
      topPriorities: [],
      insights: [],
      nextSteps: [],
    });

    expect(templateName).toBe('omnivyra_snapshot_master_report.html');
    expect(html).toContain('Omnivyra');
    expect(html).toContain('AI marketing operating system');
    expect(html).toContain('understand, plan, execute, and improve marketing from one place');
    expect(html).toContain('Decision Snapshot');
    expect(html).toContain('Competitor Signals');
    expect(html).not.toContain('<span class="tab active">Summary</span>');
    expect(html).toContain('Ready to execute?');
  });

  it('selects the visual intelligence template for Omnivyra performance reports', () => {
    const { html, templateName } = renderReportHtmlTemplate({
      ...basePayload,
      domain: 'www.omnivyra.com',
      reportType: 'performance',
      companyContext: {
        companyName: 'Omnivyra',
        domain: 'www.omnivyra.com',
        homepageHeadline: 'AI marketing operating system',
        tagline: 'Understand, plan, create, publish, optimize',
        primaryOffering: null,
        positioning: null,
        marketContext: null,
      },
      seoVisuals: {
        seoCapabilityRadar: {
          technical_seo_score: 38,
          keyword_research_score: 24,
          rank_tracking_score: 18,
          backlinks_score: 18,
          competitor_intelligence_score: 35,
          content_quality_score: 30,
          confidence: 'medium',
          tooltips: {},
          insightSentence: 'Radar insight.',
        },
        opportunityCoverageMatrix: {
          opportunities: [
            { keyword: 'buyer intent', opportunity_score: 52, coverage_score: 18, confidence: 'medium' },
          ],
          confidence: 'low',
          insightSentence: 'Matrix insight.',
        },
        searchVisibilityFunnel: {
          impressions: 24,
          clicks: 44,
          ctr: 0.32,
          estimated_lost_clicks: 56,
          confidence: 'low',
          tooltips: {},
          insightSentence: 'Funnel insight.',
        },
        crawlHealthBreakdown: {
          metadata_issues: 0,
          structure_issues: 0,
          internal_link_issues: 0,
          crawl_depth_issues: 0,
          confidence: 'high',
          tooltips: {},
          insightSentence: 'Crawl insight.',
        },
      },
    });

    expect(templateName).toBe('omnivyra_visual_intelligence_report_template.html');
    expect(html).toContain('Omnivyra Visual Intelligence');
    expect(html).toContain('Snapshot At A Glance');
  });

  it('selects the execution endgame template for Omnivyra growth reports', () => {
    const { html, templateName } = renderReportHtmlTemplate({
      ...basePayload,
      domain: 'www.omnivyra.com',
      reportType: 'growth',
      companyContext: {
        companyName: 'Omnivyra',
        domain: 'www.omnivyra.com',
        homepageHeadline: 'AI marketing operating system',
        tagline: 'Understand, plan, create, publish, optimize',
        primaryOffering: null,
        positioning: null,
        marketContext: null,
      },
      seoVisuals: {
        seoCapabilityRadar: {
          technical_seo_score: 38,
          keyword_research_score: 24,
          rank_tracking_score: 18,
          backlinks_score: 18,
          competitor_intelligence_score: 35,
          content_quality_score: 30,
          confidence: 'medium',
          tooltips: {},
          insightSentence: 'Radar insight.',
        },
        opportunityCoverageMatrix: {
          opportunities: [
            { keyword: 'buyer intent', opportunity_score: 52, coverage_score: 18, confidence: 'medium' },
          ],
          confidence: 'low',
          insightSentence: 'Matrix insight.',
        },
        searchVisibilityFunnel: {
          impressions: 24,
          clicks: 44,
          ctr: 0.32,
          estimated_lost_clicks: 56,
          confidence: 'low',
          tooltips: {},
          insightSentence: 'Funnel insight.',
        },
        crawlHealthBreakdown: {
          metadata_issues: 0,
          structure_issues: 0,
          internal_link_issues: 0,
          crawl_depth_issues: 0,
          confidence: 'high',
          tooltips: {},
          insightSentence: 'Crawl insight.',
        },
      },
      nextSteps: [
        {
          action: 'Execute the highest-impact action first.',
          description: 'Prioritize the strongest near-term growth lever.',
          steps: ['Define main promise', 'Add proof blocks'],
          expectedOutcome: 'Commercial trust should improve.',
          expectedUpside: 'better conversion readiness',
          effortLevel: 'medium',
          priorityType: 'high_impact',
          priorityWhy: 'It has the strongest near-term commercial leverage.',
        },
      ],
    });

    expect(templateName).toBe('omnivyra_execution_endgame_report_template.html');
    expect(html).toContain('Omnivyra Execution Endgame');
    expect(html).toContain('Your Next Steps');
  });
});
