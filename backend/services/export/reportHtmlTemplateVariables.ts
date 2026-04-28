import type { PdfReportPayload } from './reportPdfRenderer';
import { getBrandName, getBrandProfile, getOverallScore, safeScore, safeText } from './reportHtmlCoreUtils';

export function buildTemplateVariables(payload: PdfReportPayload): Record<string, string> {
  const brandName = getBrandName(payload);
  const brandProfile = getBrandProfile(payload);
  const seo = payload.seoExecutiveSummary;
  const visuals = payload.seoVisuals;
  const geo = payload.geoAeoExecutiveSummary;
  const topActions = seo?.top3Actions ?? [];
  const mappedActions = payload.nextSteps.length > 0
    ? payload.nextSteps.map((step) => ({
        title: safeText(step.action, 1),
        text: safeText(step.reasoning || step.description, 2),
        focusPage: safeText(step.focusPage, 1),
        tactics: Array.isArray(step.tactics) ? step.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
        timeline: {
          short: safeText(step.timeline?.short, 1),
          mid: safeText(step.timeline?.mid, 1),
          long: safeText(step.timeline?.long, 1),
        },
        priority: safeText(step.priority, 1).toUpperCase(),
        impact: safeText(step.impact, 1).toUpperCase(),
        effort: safeText(step.effort, 1).toUpperCase(),
      }))
    : topActions.map((action) => ({
        title: safeText(action.actionTitle, 1),
        text: safeText(action.reasoning, 2),
        focusPage: safeText(action.focusPage, 1),
        tactics: Array.isArray(action.tactics) ? action.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
        timeline: {
          short: safeText(action.timeline?.short, 1),
          mid: safeText(action.timeline?.mid, 1),
          long: safeText(action.timeline?.long, 1),
        },
        priority: safeText(action.priority, 1).toUpperCase(),
        impact: safeText(action.impact, 1).toUpperCase(),
        effort: safeText(action.effort, 1).toUpperCase(),
      }));
  const action1 = mappedActions[0] ?? { title: '', text: '', focusPage: '', tactics: [], timeline: { short: '', mid: '', long: '' }, priority: '', impact: '', effort: '' };
  const action2 = mappedActions[1] ?? { title: '', text: '', focusPage: '', tactics: [], timeline: { short: '', mid: '', long: '' }, priority: '', impact: '', effort: '' };
  const action3 = mappedActions[2] ?? { title: '', text: '', focusPage: '', tactics: [], timeline: { short: '', mid: '', long: '' }, priority: '', impact: '', effort: '' };
  const competitorSummary = safeText(payload.competitorIntelligenceSummary?.primaryGap.reasoning, 1);
  const decisionSummary = safeText(payload.decisionSnapshot?.whatToFixFirst, 1);
  const opportunitySummary = safeText(seo?.growthOpportunity?.title || seo?.growthOpportunity?.estimatedUpside, 1);
  const geoSummary = safeText(geo?.primaryGap.reasoning || geo?.visibilityOpportunity?.title, 1);
  const confidenceSummary = safeText(payload.confidenceSource, 1);
  const scoreLimitingFactors = (payload.scoreExplanation?.limitingFactors ?? [])
    .map((item) => safeText(item, 1))
    .filter(Boolean);
  const overallScore = getOverallScore(payload);
  const unifiedScore = payload.unifiedIntelligenceSummary?.unifiedScore ?? seo?.overallHealthScore ?? 0;
  const confidenceLabel = safeText(
    payload.unifiedIntelligenceSummary?.confidence
    || seo?.confidence
    || geo?.confidence
    || 'medium',
    1,
  ).toUpperCase();
  const stageLabel = overallScore <= 44 ? 'EARLY-STAGE' : overallScore <= 74 ? 'GROWING' : 'LEADER';
  const bannerText = safeText(payload.unifiedIntelligenceSummary?.primaryConstraint.reasoning || '', 2);
  const next1 = payload.nextSteps[0];
  const next2 = payload.nextSteps[1];
  const visual1 = safeText(visuals?.seoCapabilityRadar.insightSentence, 1);
  const visual2 = safeText(visuals?.opportunityCoverageMatrix.insightSentence, 1);
  const visual3 = safeText(visuals?.searchVisibilityFunnel.insightSentence, 1);
  const visual4 = safeText(visuals?.crawlHealthBreakdown.insightSentence, 1);

  const rawLogoUrl = String(payload.companyContext?.logoUrl ?? '').trim();
  const company_logo_url = /^https?:\/\//i.test(rawLogoUrl) ? rawLogoUrl : '';
  const rawFaviconUrl = String(payload.companyContext?.faviconUrl ?? '').trim();
  const company_favicon_url = /^https?:\/\//i.test(rawFaviconUrl) ? rawFaviconUrl : '';

  return {
    company_name: brandProfile?.companyName ?? brandName,
    website_url: brandProfile?.websiteUrl ?? safeText(payload.domain, 1),
    company_logo_url,
    company_favicon_url,
    report_date: safeText(payload.generatedDate, 1),
    primary_focus: brandProfile?.primaryFocus ?? safeText(
      payload.decisionSnapshot?.primaryFocusArea
      || payload.unifiedIntelligenceSummary?.primaryConstraint.title
      || seo?.primaryProblem.title
      || payload.title,
      1,
    ),
    overall_score: safeScore(getOverallScore(payload)),
    unified_score: safeScore(unifiedScore),
    unified_summary: safeText(
      payload.unifiedIntelligenceSummary?.marketContextSummary
      || payload.unifiedIntelligenceSummary?.primaryConstraint.reasoning
      || seo?.primaryProblem.reasoning
      || payload.summary,
      2,
    ),
    stage_label: stageLabel,
    confidence_label: confidenceLabel,
    banner_text: bannerText,
    executive_summary: safeText(payload.diagnosis, 2),
    confidence_summary: confidenceSummary,
    score_summary: scoreLimitingFactors.slice(0, 2).join(' '),
    seo_score: safeScore(seo?.overallHealthScore),
    seo_summary: safeText(visuals?.seoCapabilityRadar.insightSentence || seo?.primaryProblem.reasoning, 1),
    messaging_score: safeScore(visuals?.searchVisibilityFunnel.ctr ? visuals.searchVisibilityFunnel.ctr * 100 : null),
    messaging_summary: safeText(visuals?.searchVisibilityFunnel.insightSentence, 1),
    conversion_score: safeScore(visuals?.opportunityCoverageMatrix.opportunities?.[0]?.coverage_score ?? null),
    conversion_summary: brandProfile?.conversionSummary ?? safeText(seo?.growthOpportunity?.title || payload.summary, 1),
    trust_score: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    trust_summary: brandProfile?.trustSummary ?? safeText(
      payload.companyContext?.positioningNarrative || payload.companyContext?.marketNarrative || seo?.growthOpportunity?.basedOn,
      1,
    ),
    authority_score: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    authority_summary: safeText(seo?.growthOpportunity?.basedOn || visuals?.crawlHealthBreakdown.insightSentence, 1),
    visibility_score: safeScore(visuals?.searchVisibilityFunnel.impressions ? Math.min(100, Math.round((visuals.searchVisibilityFunnel.clicks ?? 0) / Math.max(visuals.searchVisibilityFunnel.impressions, 1) * 1000)) : null),
    visibility_summary: safeText(visuals?.searchVisibilityFunnel.insightSentence, 1),
    visual_title: safeText(seo?.top3Actions?.[0]?.linkedVisual || 'visual evidence', 1),
    visual_summary: safeText(visuals?.opportunityCoverageMatrix.insightSentence || visuals?.crawlHealthBreakdown.insightSentence || '', 2),
    visual_callout_1_title: safeText('Coverage Gap', 1),
    visual_callout_1_text: safeText(visuals?.opportunityCoverageMatrix.insightSentence || opportunitySummary, 1),
    visual_callout_2_title: safeText('Visibility Leak', 1),
    visual_callout_2_text: safeText(visuals?.searchVisibilityFunnel.insightSentence || decisionSummary, 1),
    visual_callout_3_text: visual3,
    visual_callout_4_text: visual4,
    visual_confidence_1: `CONFIDENCE ${safeText(visuals?.seoCapabilityRadar.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_confidence_2: `CONFIDENCE ${safeText(visuals?.opportunityCoverageMatrix.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_confidence_3: `CONFIDENCE ${safeText(visuals?.searchVisibilityFunnel.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_confidence_4: `CONFIDENCE ${safeText(visuals?.crawlHealthBreakdown.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_reason_1: visual1,
    visual_reason_3: visual3,
    visual_reason_4: visual4,
    radar_metric_1: safeScore(visuals?.seoCapabilityRadar.technical_seo_score),
    radar_metric_2: safeScore(visuals?.seoCapabilityRadar.keyword_research_score),
    radar_metric_3: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    radar_metric_4: safeScore(visuals?.seoCapabilityRadar.content_quality_score),
    matrix_missing: safeText(visuals?.opportunityCoverageMatrix.opportunities?.slice(0, 2).map((item) => item.keyword).join(', '), 1),
    matrix_weak: safeText(visuals?.opportunityCoverageMatrix.opportunities?.slice(0, 2).map((item) => `${item.keyword} (${item.coverage_score})`).join(', '), 1),
    matrix_strong: safeText(payload.companyContext?.companyName ? `${payload.companyContext.companyName}, SaaS, omnivyra` : 'Brand, category, product', 1),
    funnel_impressions: safeScore(visuals?.searchVisibilityFunnel.impressions),
    funnel_clicks: safeScore(visuals?.searchVisibilityFunnel.clicks),
    funnel_ctr: safeScore(visuals?.searchVisibilityFunnel.ctr ? visuals.searchVisibilityFunnel.ctr * 100 : null),
    funnel_lost: safeScore(visuals?.searchVisibilityFunnel.estimated_lost_clicks),
    crawl_metadata: safeScore(visuals?.crawlHealthBreakdown.metadata_issues),
    crawl_structure: safeScore(visuals?.crawlHealthBreakdown.structure_issues),
    crawl_links: safeScore(visuals?.crawlHealthBreakdown.internal_link_issues),
    crawl_depth: safeScore(visuals?.crawlHealthBreakdown.crawl_depth_issues),
    insight_title_1: safeText(seo?.primaryProblem.title || 'Primary constraint', 1),
    insight_text_1: safeText(seo?.primaryProblem.reasoning || payload.diagnosis, 1),
    insight_title_2: safeText(geo?.primaryGap.title || 'Growth opportunity', 1),
    insight_text_2: geoSummary,
    insight_title_3: safeText(payload.competitorIntelligenceSummary?.primaryGap.title || 'Execution implication', 1),
    insight_text_3: competitorSummary,
    insight_title_4: safeText('Market implication', 1),
    insight_text_4: safeText(payload.unifiedIntelligenceSummary?.marketContextSummary, 1),
    decision_banner: safeText(payload.decisionSnapshot?.primaryFocusArea, 1),
    decision_broken: safeText(payload.decisionSnapshot?.whatsBroken || payload.diagnosis, 1),
    decision_fix_first: safeText(payload.decisionSnapshot?.whatToFixFirst || decisionSummary, 1),
    decision_delay: safeText(payload.decisionSnapshot?.whatToDelay || 'Delay low-impact expansion until core constraints improve.', 1),
    decision_ignored: safeText(payload.decisionSnapshot?.ifIgnored || 'Core performance constraints will persist.', 1),
    execution_sequence: safeText(payload.decisionSnapshot?.executionSequence?.join(' -> '), 2),
    executed_well: safeText(payload.decisionSnapshot?.ifExecutedWell || payload.summary, 2),
    impact_timeline: safeText(payload.decisionSnapshot ? `${payload.decisionSnapshot.whenToExpectImpact.shortTerm}; ${payload.decisionSnapshot.whenToExpectImpact.midTerm}; ${payload.decisionSnapshot.whenToExpectImpact.longTerm}` : '', 2),
    growth_direction: safeText(payload.unifiedIntelligenceSummary ? `${payload.unifiedIntelligenceSummary.growthDirection.shortTermFocus} ${payload.unifiedIntelligenceSummary.growthDirection.longTermFocus}` : opportunitySummary, 2),
    metric_unified: safeText(`Score ${safeScore(unifiedScore)}`, 1),
    metric_unified_pct: safeScore(unifiedScore),
    metric_seo: safeText(`Score ${safeScore(seo?.overallHealthScore)}`, 1),
    metric_seo_pct: safeScore(seo?.overallHealthScore),
    metric_geo: safeText(`Score ${safeScore(geo?.overallAiVisibilityScore)}`, 1),
    metric_geo_pct: safeScore(geo?.overallAiVisibilityScore),
    metric_authority: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    metric_authority_pct: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    action_1_title: action1.title,
    action_1_text: action1.text,
    action_1_focus_page: action1.focusPage,
    action_1_tactics: action1.tactics.join('\n'),
    action_1_timeline_short: action1.timeline.short,
    action_1_timeline_mid: action1.timeline.mid,
    action_1_timeline_long: action1.timeline.long,
    action_1_priority: action1.priority,
    action_1_impact: action1.impact,
    action_1_effort: action1.effort,
    action_2_title: action2.title,
    action_2_text: action2.text,
    action_2_focus_page: action2.focusPage,
    action_2_tactics: action2.tactics.join('\n'),
    action_2_timeline_short: action2.timeline.short,
    action_2_timeline_mid: action2.timeline.mid,
    action_2_timeline_long: action2.timeline.long,
    action_2_priority: action2.priority,
    action_2_impact: action2.impact,
    action_2_effort: action2.effort,
    action_3_title: action3.title,
    action_3_text: action3.text,
    action_3_focus_page: action3.focusPage,
    action_3_tactics: action3.tactics.join('\n'),
    action_3_timeline_short: action3.timeline.short,
    action_3_timeline_mid: action3.timeline.mid,
    action_3_timeline_long: action3.timeline.long,
    action_3_priority: action3.priority,
    action_3_impact: action3.impact,
    action_3_effort: action3.effort,
    proof_1_label: '',
    proof_1_value: safeScore(payload.unifiedIntelligenceSummary?.unifiedScore ?? seo?.overallHealthScore ?? null),
    proof_1_text: safeText(seo?.growthOpportunity?.basedOn || payload.summary, 2),
    proof_2_label: '',
    proof_2_value: safeScore(visuals?.opportunityCoverageMatrix.opportunities?.[0]?.opportunity_score ?? null),
    proof_2_text: safeText(visuals?.opportunityCoverageMatrix.insightSentence || payload.summary, 2),
    proof_3_label: '',
    proof_3_value: safeScore(visuals?.searchVisibilityFunnel.estimated_lost_clicks != null ? 100 - Math.min(100, visuals.searchVisibilityFunnel.estimated_lost_clicks) : null),
    proof_3_text: safeText(decisionSummary || payload.summary, 2),
    workflow_1_title: '',
    workflow_1_text: safeText(payload.diagnosis, 2),
    workflow_2_title: '',
    workflow_2_text: safeText(opportunitySummary || payload.summary, 2),
    workflow_3_title: '',
    workflow_3_text: safeText(brandProfile?.ctaText || payload.summary, 2),
    metric_request: safeScore(visuals?.searchVisibilityFunnel.impressions ? Math.min(100, Math.round((visuals.searchVisibilityFunnel.impressions as number) / 100)) : null),
    metric_request_text: safeText('Tracks how much demand context is available for this report run.', 1),
    metric_visibility: safeScore(visuals?.searchVisibilityFunnel.clicks),
    metric_visibility_text: safeText(visuals?.searchVisibilityFunnel.insightSentence, 1),
    metric_content: safeScore(visuals?.seoCapabilityRadar.content_quality_score),
    metric_content_text: safeText('Measures how well pages answer buyer questions with depth and clarity.', 1),
    metric_authority_text: safeText('Reflects how credible and established the brand looks in market context.', 1),
    opportunity_1_title: safeText(action1.title || 'Improvement opportunity one', 1),
    opportunity_1_text: safeText(action1.text, 2),
    opportunity_1_tag: safeText('PLAN NEXT', 1),
    opportunity_2_title: safeText(action2.title || 'Improvement opportunity two', 1),
    opportunity_2_text: safeText(action2.text, 2),
    opportunity_2_tag: safeText('ACT NOW', 1),
    opportunity_3_title: safeText(action3.title || 'Improvement opportunity three', 1),
    opportunity_3_text: safeText(action3.text, 2),
    opportunity_3_tag: safeText('PLAN NEXT', 1),
    next_step_1_title: safeText(next1?.action || action1.title, 1),
    next_step_1_text: safeText(next1?.reasoning || next1?.description || action1.text, 2),
    next_step_1_focus_page: safeText(next1?.focusPage || action1.focusPage, 1),
    next_step_1_tactics: Array.isArray(next1?.tactics) ? next1.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3).join('\n') : action1.tactics.join('\n'),
    next_step_1_timeline_short: safeText(next1?.timeline?.short || action1.timeline.short, 1),
    next_step_1_timeline_mid: safeText(next1?.timeline?.mid || action1.timeline.mid, 1),
    next_step_1_timeline_long: safeText(next1?.timeline?.long || action1.timeline.long, 1),
    next_step_1_highlight: safeText(next1?.expectedOutcome, 1),
    next_step_1_priority: safeText(next1?.priority || '', 1).toUpperCase(),
    next_step_1_impact: safeText(next1?.impact || '', 1).toUpperCase(),
    next_step_1_effort: safeText(next1?.effort || next1?.effortLevel || '', 1).toUpperCase(),
    next_step_1_outcome: safeText(next1?.expectedUpside || '', 1),
    next_step_2_title: safeText(next2?.action || action2.title, 1),
    next_step_2_text: safeText(next2?.reasoning || next2?.description || action2.text, 2),
    next_step_2_focus_page: safeText(next2?.focusPage || action2.focusPage, 1),
    next_step_2_tactics: Array.isArray(next2?.tactics) ? next2.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3).join('\n') : action2.tactics.join('\n'),
    next_step_2_timeline_short: safeText(next2?.timeline?.short || action2.timeline.short, 1),
    next_step_2_timeline_mid: safeText(next2?.timeline?.mid || action2.timeline.mid, 1),
    next_step_2_timeline_long: safeText(next2?.timeline?.long || action2.timeline.long, 1),
    next_step_2_highlight: safeText(next2?.expectedOutcome || '', 1),
    next_step_2_priority: safeText(next2?.priority || '', 1).toUpperCase(),
    next_step_2_impact: safeText(next2?.impact || '', 1).toUpperCase(),
    next_step_2_effort: safeText(next2?.effort || next2?.effortLevel || '', 1).toUpperCase(),
    next_step_2_outcome: safeText(next2?.expectedUpside || '', 1),
    cta_title: '',
    cta_text: safeText(payload.decisionSnapshot?.ifExecutedWell, 2),
    cta_label: '',
  };
}
