export function buildSeoVisuals(report: any): any {
  const visuals = report.visual_intelligence;
  if (!visuals) return undefined;

  const radar = visuals.seo_capability_radar;
  const matrix = visuals.opportunity_coverage_matrix;
  const funnel = visuals.search_visibility_funnel;
  const crawl = visuals.crawl_health_breakdown;
  const unifiedConstraint = report.unified_intelligence_summary?.primary_constraint?.title || 'the primary growth constraint';
  const seoPrimary = report.seo_executive_summary?.primary_problem?.title || 'core search constraints';

  const radarScores = [
    radar?.technical_seo_score,
    radar?.keyword_research_score,
    radar?.rank_tracking_score,
    radar?.backlinks_score,
    radar?.competitor_intelligence_score,
    radar?.content_quality_score,
  ].filter((value): value is number => typeof value === 'number');
  const missingRadarSignals = 6 - radarScores.length;
  const softenedRadarConfidence: 'high' | 'medium' | 'low' =
    missingRadarSignals >= 3
      ? 'low'
      : missingRadarSignals === 2 && (radar?.confidence || 'low') === 'high'
        ? 'medium'
        : (radar?.confidence || 'low');

  return {
    seoCapabilityRadar: {
      technical_seo_score: typeof radar?.technical_seo_score === 'number' ? radar.technical_seo_score : null,
      keyword_research_score: typeof radar?.keyword_research_score === 'number' ? radar.keyword_research_score : null,
      rank_tracking_score: typeof radar?.rank_tracking_score === 'number' ? radar.rank_tracking_score : null,
      backlinks_score: typeof radar?.backlinks_score === 'number' ? radar.backlinks_score : null,
      competitor_intelligence_score: typeof radar?.competitor_intelligence_score === 'number' ? radar.competitor_intelligence_score : null,
      content_quality_score: typeof radar?.content_quality_score === 'number' ? radar.content_quality_score : null,
      confidence: softenedRadarConfidence,
      data_source_strength: radar?.data_source_strength
        ? {
            technical_seo_score: radar.data_source_strength.technical_seo_score || 'missing',
            keyword_research_score: radar.data_source_strength.keyword_research_score || 'missing',
            rank_tracking_score: radar.data_source_strength.rank_tracking_score || 'missing',
            backlinks_score: radar.data_source_strength.backlinks_score || 'missing',
            competitor_intelligence_score: radar.data_source_strength.competitor_intelligence_score || 'missing',
            content_quality_score: radar.data_source_strength.content_quality_score || 'missing',
          }
        : undefined,
      source_tags: radar?.source_tags
        ? {
            technical_seo_score: radar.source_tags.technical_seo_score ?? null,
            keyword_research_score: radar.source_tags.keyword_research_score ?? null,
            rank_tracking_score: radar.source_tags.rank_tracking_score ?? null,
            backlinks_score: radar.source_tags.backlinks_score ?? null,
            competitor_intelligence_score: radar.source_tags.competitor_intelligence_score ?? null,
            content_quality_score: radar.source_tags.content_quality_score ?? null,
          }
        : undefined,
      axis_states: radar?.axis_states
        ? {
            technical_seo_score: radar.axis_states.technical_seo_score || 'insufficient_signal',
            keyword_research_score: radar.axis_states.keyword_research_score || 'insufficient_signal',
            rank_tracking_score: radar.axis_states.rank_tracking_score || 'insufficient_signal',
            backlinks_score: radar.axis_states.backlinks_score || 'insufficient_signal',
            competitor_intelligence_score: radar.axis_states.competitor_intelligence_score || 'insufficient_signal',
            content_quality_score: radar.axis_states.content_quality_score || 'insufficient_signal',
          }
        : undefined,
      benchmark: radar?.benchmark
        ? {
            technical_seo_score: typeof radar.benchmark.technical_seo_score === 'number' ? radar.benchmark.technical_seo_score : null,
            keyword_research_score: typeof radar.benchmark.keyword_research_score === 'number' ? radar.benchmark.keyword_research_score : null,
            rank_tracking_score: typeof radar.benchmark.rank_tracking_score === 'number' ? radar.benchmark.rank_tracking_score : null,
            backlinks_score: typeof radar.benchmark.backlinks_score === 'number' ? radar.benchmark.backlinks_score : null,
            competitor_intelligence_score: typeof radar.benchmark.competitor_intelligence_score === 'number' ? radar.benchmark.competitor_intelligence_score : null,
            content_quality_score: typeof radar.benchmark.content_quality_score === 'number' ? radar.benchmark.content_quality_score : null,
          }
        : undefined,
      tooltips: {
        technical_seo_score: 'Reflects crawl health, structural SEO, metadata coverage, and answer-engine readiness.',
        keyword_research_score: 'Shows how much keyword opportunity coverage is visible in the report data.',
        rank_tracking_score: 'Summarizes how strong current search visibility and click capture look in tracked keyword evidence.',
        backlinks_score: 'Proxy for backlink and authority strength using the authority dimension in the score model.',
        competitor_intelligence_score: 'Shows how strongly the company currently performs versus benchmarked competitors in the snapshot.',
        content_quality_score: 'Measures how well pages answer buyer questions with depth, structure, and relevance.',
      },
      insightSentence:
        typeof radar?.technical_seo_score === 'number'
          ? `Because ${unifiedConstraint} is unresolved, SEO is currently constrained by ${seoPrimary}. ${[
              ['content quality', radar.content_quality_score],
              ['backlinks', radar.backlinks_score],
              ['technical SEO', radar.technical_seo_score],
            ]
              .filter((item): item is [string, number] => typeof item[1] === 'number')
              .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'available signal areas'} currently leads, while weaker dimensions constrain performance. This is supported by technical ${radar?.technical_seo_score ?? 'n/a'}, visibility ${radar?.rank_tracking_score ?? 'n/a'}, authority ${radar?.backlinks_score ?? 'n/a'}.`
          : 'SEO capability radar is inferred from limited crawl/search signals in this run, so confidence is intentionally reduced.',
    },
    opportunityCoverageMatrix: {
      opportunities: Array.isArray(matrix?.opportunities)
        ? matrix!.opportunities!
            .filter((item: any) => item.keyword && typeof item.opportunity_score === 'number' && typeof item.coverage_score === 'number')
            .map((item: any) => ({
              keyword: item.keyword as string,
              opportunity_score: Number(item.opportunity_score ?? 0),
              coverage_score: Number(item.coverage_score ?? 0),
              opportunity_value_score: typeof item.opportunity_value_score === 'number' ? Number(item.opportunity_value_score) : null,
              priority_bucket: item.priority_bucket ?? null,
              confidence: item.confidence || 'low',
            }))
        : [],
      confidence: matrix?.confidence || 'low',
      opportunityReasoning:
        matrix?.opportunity_reasoning ||
        'These opportunity gaps usually come from stronger market demand than current page coverage and intent alignment.',
      insightSentence:
        Array.isArray(matrix?.opportunities) && matrix!.opportunities!.length > 0
          ? 'This confirms the same constraint: highest-value gaps are where opportunity stays high while coverage remains uneven.'
          : 'Opportunity matrix is inferred from limited keyword signal coverage in this run.',
    },
    searchVisibilityFunnel: {
      impressions: typeof funnel?.impressions === 'number' ? funnel.impressions : null,
      clicks: typeof funnel?.clicks === 'number' ? funnel.clicks : null,
      ctr: typeof funnel?.ctr === 'number' ? funnel.ctr : null,
      estimated_lost_clicks: typeof funnel?.estimated_lost_clicks === 'number' ? funnel.estimated_lost_clicks : null,
      confidence: funnel?.confidence || 'low',
      drop_off_reason_distribution: funnel?.drop_off_reason_distribution
        ? {
            ranking_issue_pct: typeof funnel.drop_off_reason_distribution.ranking_issue_pct === 'number' ? funnel.drop_off_reason_distribution.ranking_issue_pct : null,
            ctr_issue_pct: typeof funnel.drop_off_reason_distribution.ctr_issue_pct === 'number' ? funnel.drop_off_reason_distribution.ctr_issue_pct : null,
            intent_mismatch_pct: typeof funnel.drop_off_reason_distribution.intent_mismatch_pct === 'number' ? funnel.drop_off_reason_distribution.intent_mismatch_pct : null,
          }
        : undefined,
      tooltips: {
        impressions: 'The number of search appearances visible in tracked keyword evidence.',
        clicks: 'The number of clicks captured from those search appearances.',
        ctr: 'Click-through rate from visible impressions to visits.',
        estimated_lost_clicks: 'Estimated clicks left on the table because rankings or snippets are not strong enough yet.',
      },
      insightSentence:
        typeof funnel?.estimated_lost_clicks === 'number'
          ? `This mirrors the upstream constraint: search visibility creates demand, but roughly ${Math.round(funnel.estimated_lost_clicks).toLocaleString()} potential clicks are still being lost before visits happen.`
          : 'Search funnel evidence is limited because impressions/clicks signals were sparse in this run.',
    },
    crawlHealthBreakdown: {
      metadata_issues: typeof crawl?.metadata_issues === 'number' ? crawl.metadata_issues : null,
      structure_issues: typeof crawl?.structure_issues === 'number' ? crawl.structure_issues : null,
      internal_link_issues: typeof crawl?.internal_link_issues === 'number' ? crawl.internal_link_issues : null,
      crawl_depth_issues: typeof crawl?.crawl_depth_issues === 'number' ? crawl.crawl_depth_issues : null,
      confidence: crawl?.confidence || 'low',
      severity_split: crawl?.severity_split
        ? {
            critical: typeof crawl.severity_split.critical === 'number' ? crawl.severity_split.critical : null,
            moderate: typeof crawl.severity_split.moderate === 'number' ? crawl.severity_split.moderate : null,
            low: typeof crawl.severity_split.low === 'number' ? crawl.severity_split.low : null,
            classification: crawl.severity_split.classification || 'unclassified',
          }
        : undefined,
      tooltips: {
        metadata_issues: 'Missing, thin, or duplicated titles and descriptions found in the crawl.',
        structure_issues: 'Thin pages or weak heading structure affecting crawl understanding and ranking potential.',
        internal_link_issues: 'Pages with weak internal link support or orphan-like patterns.',
        crawl_depth_issues: 'Crawl errors or depth-related issues that reduce reliable page discovery.',
      },
      insightSentence:
        typeof crawl?.metadata_issues === 'number'
          ? `Technical evidence reinforces the same story: issue concentration remains highest in metadata ${crawl?.metadata_issues ?? 'n/a'} and structure ${crawl?.structure_issues ?? 'n/a'}.`
          : 'Crawl evidence is limited in this run, so technical confidence is intentionally reduced.',
    },
  };
}

export function buildSeoExecutiveSummary(report: any): any {
  const summary = report.seo_executive_summary;
  if (!summary) return undefined;

  return {
    overallHealthScore: typeof summary.overall_health_score === 'number' ? summary.overall_health_score : null,
    overallHealthScoreState: summary.overall_health_score_state || 'insufficient_signal',
    primaryProblem: {
      title: summary.primary_problem?.title || 'Primary SEO issue still forming',
      impactedArea: summary.primary_problem?.impacted_area || 'visibility',
      severity: summary.primary_problem?.severity || 'low',
      reasoning: summary.primary_problem?.reasoning || 'The report does not yet have enough signal to sharpen this diagnosis further.',
      ifNotAddressed: summary.primary_problem?.if_not_addressed || 'If not addressed, traffic capture and conversion efficiency will remain constrained.',
    },
    top3Actions: Array.isArray(summary.top_3_actions)
      ? summary.top_3_actions.map((item: any) => ({
          actionTitle: item.action_title || item.title || '',
          title: item.title || item.action_title || '',
          priority: item.priority || 'medium',
          expectedImpact: item.expected_impact || 'medium',
          effort: item.effort || 'medium',
          linkedVisual: item.linked_visual || 'radar',
          reasoning: item.reasoning || '',
          tactics: Array.isArray(item.tactics) ? item.tactics.filter((step: any) => typeof step === 'string' && step.trim().length > 0).slice(0, 3) : [],
          focusPage: item.focus_page || '',
          timeline: {
            short: item.timeline?.short || '',
            mid: item.timeline?.mid || '',
            long: item.timeline?.long || '',
          },
          impact: item.impact || item.expected_impact || 'medium',
          confidence: typeof item.confidence === 'number' ? item.confidence : 0,
        })).slice(0, 3)
      : [],
    growthOpportunity: summary.growth_opportunity
      ? {
          title: summary.growth_opportunity.title || 'Growth opportunity identified',
          estimatedUpside: summary.growth_opportunity.estimated_upside || 'Upside is visible and should be quantified in the next data-rich run.',
          basedOn: summary.growth_opportunity.based_on || 'Based on current snapshot signals.',
        }
      : null,
    confidence: summary.confidence || 'low',
  };
}

export function buildGeoAeoVisuals(report: any): any {
  const visuals = report.geo_aeo_visuals;
  if (!visuals) return undefined;

  return {
    aiAnswerPresenceRadar: {
      answer_coverage_score: typeof visuals.ai_answer_presence_radar?.answer_coverage_score === 'number' ? visuals.ai_answer_presence_radar.answer_coverage_score : null,
      entity_clarity_score: typeof visuals.ai_answer_presence_radar?.entity_clarity_score === 'number' ? visuals.ai_answer_presence_radar.entity_clarity_score : null,
      topical_authority_score: typeof visuals.ai_answer_presence_radar?.topical_authority_score === 'number' ? visuals.ai_answer_presence_radar.topical_authority_score : null,
      citation_readiness_score: typeof visuals.ai_answer_presence_radar?.citation_readiness_score === 'number' ? visuals.ai_answer_presence_radar.citation_readiness_score : null,
      content_structure_score: typeof visuals.ai_answer_presence_radar?.content_structure_score === 'number' ? visuals.ai_answer_presence_radar.content_structure_score : null,
      freshness_score: typeof visuals.ai_answer_presence_radar?.freshness_score === 'number' ? visuals.ai_answer_presence_radar.freshness_score : null,
      confidence: visuals.ai_answer_presence_radar?.confidence || 'low',
      data_source_strength: visuals.ai_answer_presence_radar?.data_source_strength || 'missing',
      source_tags: visuals.ai_answer_presence_radar?.source_tags ?? null,
      axis_states: visuals.ai_answer_presence_radar?.axis_states
        ? {
            answer_coverage_score: visuals.ai_answer_presence_radar.axis_states.answer_coverage_score || 'insufficient_signal',
            entity_clarity_score: visuals.ai_answer_presence_radar.axis_states.entity_clarity_score || 'insufficient_signal',
            topical_authority_score: visuals.ai_answer_presence_radar.axis_states.topical_authority_score || 'insufficient_signal',
            citation_readiness_score: visuals.ai_answer_presence_radar.axis_states.citation_readiness_score || 'insufficient_signal',
            content_structure_score: visuals.ai_answer_presence_radar.axis_states.content_structure_score || 'insufficient_signal',
            freshness_score: visuals.ai_answer_presence_radar.axis_states.freshness_score || 'insufficient_signal',
          }
        : undefined,
      benchmark: visuals.ai_answer_presence_radar?.benchmark
        ? {
            answer_coverage_score: typeof visuals.ai_answer_presence_radar.benchmark.answer_coverage_score === 'number' ? visuals.ai_answer_presence_radar.benchmark.answer_coverage_score : null,
            entity_clarity_score: typeof visuals.ai_answer_presence_radar.benchmark.entity_clarity_score === 'number' ? visuals.ai_answer_presence_radar.benchmark.entity_clarity_score : null,
            topical_authority_score: typeof visuals.ai_answer_presence_radar.benchmark.topical_authority_score === 'number' ? visuals.ai_answer_presence_radar.benchmark.topical_authority_score : null,
            citation_readiness_score: typeof visuals.ai_answer_presence_radar.benchmark.citation_readiness_score === 'number' ? visuals.ai_answer_presence_radar.benchmark.citation_readiness_score : null,
            content_structure_score: typeof visuals.ai_answer_presence_radar.benchmark.content_structure_score === 'number' ? visuals.ai_answer_presence_radar.benchmark.content_structure_score : null,
            freshness_score: typeof visuals.ai_answer_presence_radar.benchmark.freshness_score === 'number' ? visuals.ai_answer_presence_radar.benchmark.freshness_score : null,
          }
        : undefined,
    },
    queryAnswerCoverageMap: {
      queries: Array.isArray(visuals.query_answer_coverage_map?.queries)
        ? visuals.query_answer_coverage_map!.queries!.map((item: any) => ({
            query: item.query || 'Unnamed query',
            coverage: item.coverage || 'missing',
            answer_quality_score: Number(item.answer_quality_score ?? 0),
          }))
        : [],
      confidence: visuals.query_answer_coverage_map?.confidence || 'low',
    },
    answerExtractionFunnel: {
      total_queries: typeof visuals.answer_extraction_funnel?.total_queries === 'number' ? visuals.answer_extraction_funnel.total_queries : null,
      answerable_content_pct: typeof visuals.answer_extraction_funnel?.answerable_content_pct === 'number' ? visuals.answer_extraction_funnel.answerable_content_pct : null,
      structured_content_pct: typeof visuals.answer_extraction_funnel?.structured_content_pct === 'number' ? visuals.answer_extraction_funnel.structured_content_pct : null,
      citation_ready_pct: typeof visuals.answer_extraction_funnel?.citation_ready_pct === 'number' ? visuals.answer_extraction_funnel.citation_ready_pct : null,
      confidence: visuals.answer_extraction_funnel?.confidence || 'low',
      drop_off_reason_distribution: {
        answer_gap_pct: typeof visuals.answer_extraction_funnel?.drop_off_reason_distribution?.answer_gap_pct === 'number' ? visuals.answer_extraction_funnel.drop_off_reason_distribution.answer_gap_pct : null,
        structure_gap_pct: typeof visuals.answer_extraction_funnel?.drop_off_reason_distribution?.structure_gap_pct === 'number' ? visuals.answer_extraction_funnel.drop_off_reason_distribution.structure_gap_pct : null,
        citation_gap_pct: typeof visuals.answer_extraction_funnel?.drop_off_reason_distribution?.citation_gap_pct === 'number' ? visuals.answer_extraction_funnel.drop_off_reason_distribution.citation_gap_pct : null,
      },
    },
    entityAuthorityMap: {
      entities: Array.isArray(visuals.entity_authority_map?.entities)
        ? visuals.entity_authority_map!.entities!.map((item: any) => ({
            entity: item.entity || 'Unnamed entity',
            relevance_score: Number(item.relevance_score ?? 0),
            coverage_score: Number(item.coverage_score ?? 0),
          }))
        : [],
      confidence: visuals.entity_authority_map?.confidence || 'low',
    },
  };
}

export function buildGeoAeoExecutiveSummary(report: any): any {
  const summary = report.geo_aeo_executive_summary;
  if (!summary) return undefined;
  return {
    overallAiVisibilityScore: typeof summary.overall_ai_visibility_score === 'number' ? summary.overall_ai_visibility_score : null,
    overallAiVisibilityScoreState: summary.overall_ai_visibility_score_state || 'insufficient_signal',
    primaryGap: {
      title: summary.primary_gap?.title || 'Primary AI visibility gap still forming',
      type: summary.primary_gap?.type || 'answer_gap',
      severity: summary.primary_gap?.severity || 'low',
      reasoning: summary.primary_gap?.reasoning || 'Current crawl evidence is limited, so this gap is directional and confidence is reduced.',
      ifNotAddressed: summary.primary_gap?.if_not_addressed || 'If not addressed, AI answer visibility will remain constrained and citation performance will stay weak.',
    },
    top3Actions: Array.isArray(summary.top_3_actions)
      ? summary.top_3_actions.map((item: any) => ({
          actionTitle: item.action_title || 'Priority action',
          priority: item.priority || 'medium',
          expectedImpact: item.expected_impact || 'medium',
          effort: item.effort || 'medium',
          linkedVisual: item.linked_visual || 'radar',
          reasoning: item.reasoning || 'This action is one of the clearest next AI-visibility moves in the current snapshot.',
        })).slice(0, 3)
      : [],
    visibilityOpportunity: summary.visibility_opportunity
      ? {
          title: summary.visibility_opportunity.title || 'AI visibility opportunity identified',
          estimatedAiExposure: summary.visibility_opportunity.estimated_ai_exposure || 'Upside is visible and should be quantified in the next data-rich run.',
          basedOn: summary.visibility_opportunity.based_on || 'Based on current query and structure signals.',
        }
      : null,
    confidence: summary.confidence || 'low',
  };
}

export function buildUnifiedIntelligenceSummary(report: any): any {
  const summary = report.unified_intelligence_summary;
  if (!summary) return undefined;

  return {
    unifiedScore: typeof summary.unified_score === 'number' ? summary.unified_score : null,
    unifiedScoreState: summary.unified_score_state || 'insufficient_signal',
    systemMaturity: summary.system_maturity || 'building_baseline',
    marketContextSummary:
      summary.market_context_summary ||
      'Cross-channel intelligence is currently insufficient to compute — neither SEO nor AI-answer evidence has been observed for this snapshot.',
    dominantGrowthChannel: summary.dominant_growth_channel || 'balanced',
    primaryConstraint: {
      title: summary.primary_constraint?.title || 'Primary cross-channel constraint still forming',
      source: summary.primary_constraint?.source || 'seo',
      severity: summary.primary_constraint?.severity || 'low',
      reasoning: summary.primary_constraint?.reasoning || 'Current report evidence is limited, so this constraint is directional and confidence is reduced.',
      ifNotAddressed: summary.primary_constraint?.if_not_addressed || 'If not addressed, growth will remain constrained across both SEO and GEO/AEO channels.',
    },
    top3UnifiedActions: Array.isArray(summary.top_3_unified_actions)
      ? summary.top_3_unified_actions.slice(0, 3).map((action: any) => ({
          actionTitle: action.action_title || 'Priority action',
          source: action.source || 'seo',
          priority: action.priority || 'medium',
          expectedImpact: action.expected_impact || 'medium',
          effort: action.effort || 'medium',
          reasoning: action.reasoning || 'This action addresses a shared growth constraint across channels.',
        }))
      : [],
    growthDirection: {
      shortTermFocus: summary.growth_direction?.short_term_focus || 'Stabilize the highest-urgency visibility constraints first.',
      longTermFocus: summary.growth_direction?.long_term_focus || 'Build a balanced search and AI-answer visibility engine.',
    },
    confidence: summary.confidence || 'low',
  };
}

export function buildCompetitorVisuals(report: any): any {
  const visuals = report.competitor_visuals;
  if (!visuals) return undefined;

  return {
    competitorPositioningRadar: {
      competitors: Array.isArray(visuals.competitor_positioning_radar?.competitors)
        ? visuals.competitor_positioning_radar!.competitors!.map((item: any) => ({
            name: item.name || 'Competitor',
            domain: item.domain || item.name || 'unknown-competitor',
            content_score: Number(item.content_score ?? 0),
            keyword_coverage_score: Number(item.keyword_coverage_score ?? 0),
            authority_score: Number(item.authority_score ?? 0),
            technical_score: Number(item.technical_score ?? 0),
            ai_answer_presence_score: Number(item.ai_answer_presence_score ?? 0),
          }))
        : [],
      user: {
        content_score: Number(visuals.competitor_positioning_radar?.user?.content_score ?? 0),
        keyword_coverage_score: Number(visuals.competitor_positioning_radar?.user?.keyword_coverage_score ?? 0),
        authority_score: Number(visuals.competitor_positioning_radar?.user?.authority_score ?? 0),
        technical_score: Number(visuals.competitor_positioning_radar?.user?.technical_score ?? 0),
        ai_answer_presence_score: Number(visuals.competitor_positioning_radar?.user?.ai_answer_presence_score ?? 0),
      },
      confidence: visuals.competitor_positioning_radar?.confidence || 'low',
    },
    keywordGapAnalysis: {
      missing_keywords: Array.isArray(visuals.keyword_gap_analysis?.missing_keywords) ? visuals.keyword_gap_analysis!.missing_keywords! : [],
      weak_keywords: Array.isArray(visuals.keyword_gap_analysis?.weak_keywords) ? visuals.keyword_gap_analysis!.weak_keywords! : [],
      strong_keywords: Array.isArray(visuals.keyword_gap_analysis?.strong_keywords) ? visuals.keyword_gap_analysis!.strong_keywords! : [],
      confidence: visuals.keyword_gap_analysis?.confidence || 'low',
    },
    aiAnswerGapAnalysis: {
      missing_answers: Array.isArray(visuals.ai_answer_gap_analysis?.missing_answers) ? visuals.ai_answer_gap_analysis!.missing_answers! : [],
      weak_answers: Array.isArray(visuals.ai_answer_gap_analysis?.weak_answers) ? visuals.ai_answer_gap_analysis!.weak_answers! : [],
      strong_answers: Array.isArray(visuals.ai_answer_gap_analysis?.strong_answers) ? visuals.ai_answer_gap_analysis!.strong_answers! : [],
      confidence: visuals.ai_answer_gap_analysis?.confidence || 'low',
    },
  };
}

export function buildCompetitorIntelligenceSummary(report: any): any {
  const summary = report.competitor_intelligence_summary;
  if (summary === null) return null;
  if (!summary) return undefined;

  const radarCount = report.competitor_visuals?.competitor_positioning_radar?.competitors?.length ?? 0;
  const fallbackUsed =
    report.competitor_intelligence?.discovery_metadata?.is_fallback_used === true ||
    report.competitor_intelligence?.discovery_metadata?.serp_status === 'fallback';
  let confidence: 'high' | 'medium' | 'low' = summary.confidence || 'low';
  if (radarCount === 0) confidence = 'low';
  else if (fallbackUsed && confidence === 'high') confidence = 'medium';
  else if (fallbackUsed && radarCount < 2) confidence = 'low';

  return {
    topCompetitor: summary.top_competitor || 'No reliable competitor identified yet',
    competitorExplanation:
      summary.competitor_explanation ||
      'Competitor direction is inferred from available market signals; stronger coverage, authority, and answer readiness are currently constraining your position.',
    primaryGap: {
      title: summary.primary_gap?.title || 'Primary competitor gap still forming',
      type: summary.primary_gap?.type || 'keyword_gap',
      severity: summary.primary_gap?.severity || 'low',
      reasoning: summary.primary_gap?.reasoning || 'Competitor gap reasoning is limited in this run, so comparative confidence is reduced.',
      ifNotAddressed: summary.primary_gap?.if_not_addressed || 'If not addressed, competitor pressure will continue reducing qualified traffic and conversion leverage.',
    },
    top3Actions: Array.isArray(summary.top_3_actions)
      ? summary.top_3_actions.slice(0, 3).map((action: any) => ({
          actionTitle: action.action_title || 'Priority action',
          priority: action.priority || 'medium',
          expectedImpact: action.expected_impact || 'medium',
          effort: action.effort || 'medium',
          reasoning: action.reasoning || 'This action addresses the strongest detected market gap.',
        }))
      : [],
    competitivePosition: summary.competitive_position || 'competitive',
    confidence,
  };
}
