import type { Snapshot, RoutedSystemAction } from './types';
import {
  formatContentTypeLabel,
  formatPlatformLabel,
  formatCampaignPathLabel,
  formatReportTypeLabel,
  getContentRoute,
  getCampaignPathRoute,
} from './hooks/viewModel.helpers';
import { shouldRefreshCurrentReport } from './derives';

export function deriveSystemActionLines(snapshot: Snapshot) {
  const { reports_summary, content_summary, campaign_mix_summary, distribution_summary, timing_summary, engagement_summary, lead_summary, market_pulse_summary, knowledge_graph_summary, system_snapshot, intelligence_settings } = snapshot;
  const actions = { doNow: [] as RoutedSystemAction[], doNext: [] as RoutedSystemAction[], monitor: [] as RoutedSystemAction[] };
  const pushAction = (bucket: keyof typeof actions, text: string, href: string, label: string) => {
    actions[bucket].push({ text, href, label });
  };
  const objective = intelligence_settings.objective;
  const topContentType = content_summary.content_type_mix[0];
  const contentTypeCount = content_summary.content_type_mix.length;
  const topReportType = reports_summary.report_type_mix[0]?.type ?? null;
  const refreshCurrentReport = shouldRefreshCurrentReport(snapshot);
  const performanceReadiness = snapshot.report_readiness_summary.performance;
  const growthReadiness = snapshot.report_readiness_summary.growth;
  const growthIntegrationSummary = snapshot.report_readiness_summary.growth_integration_summary;
  const connectedGrowthSystems = [
    growthIntegrationSummary.crm_connected ? 'CRM' : null,
    growthIntegrationSummary.email_connected ? 'email' : null,
    growthIntegrationSummary.outreach_connected ? 'outreach' : null,
    growthIntegrationSummary.commerce_connected ? 'commerce' : null,
    growthIntegrationSummary.event_signal_connected ? 'event/webinar' : null,
  ].filter(Boolean) as string[];
  const dominantCampaignPath = campaign_mix_summary.dominant_path;
  const dominantCampaignPathLabel = formatCampaignPathLabel(dominantCampaignPath);
  const topPlatform = distribution_summary.platform_mix[0];
  const campaignPathCounts = [
    campaign_mix_summary.bolt_text,
    campaign_mix_summary.bolt_creator,
    campaign_mix_summary.intelligent_mix,
    campaign_mix_summary.strategy_mix,
  ].filter((count) => count > 0);

  if (reports_summary.total_reports === 0) {
    pushAction('doNow', 'Run the first report so the system can move from surface activity into evidence-backed guidance.', '/reports/digital-authority-snapshot', 'Run first report');
  } else if (refreshCurrentReport && reports_summary.latest_report_type) {
    const reportHref =
      reports_summary.latest_report_type === 'performance' ? '/reports/performance-intelligence'
      : reports_summary.latest_report_type === 'growth' ? '/reports/market-growth-intelligence'
      : '/reports/digital-authority-snapshot';
    pushAction('doNow', `Redo ${formatReportTypeLabel(reports_summary.latest_report_type)} before moving to the next report level. The current diagnostic is stale enough that a fresh baseline will create better decisions.`, reportHref, 'Redo report');
  } else if (reports_summary.total_reports === 1) {
    pushAction('doNext', 'Run the next report tier to deepen the operating picture before scaling further.', '/reports', 'Open reports');
  }

  if (!refreshCurrentReport && reports_summary.analytics_reports === 0 && reports_summary.structured_reports > 0) {
    if (performanceReadiness.state === 'ready_now') {
      pushAction('doNext', 'Performance Intelligence is now justified because the core instrumentation and operating signal are both in place.', '/reports/performance-intelligence', 'Run Performance Intelligence');
    } else if (performanceReadiness.state === 'collecting_baseline') {
      pushAction('monitor', 'Performance Intelligence prerequisites are connected, but the system is still collecting enough live baseline data to make that report genuinely useful.', '/company-profile', 'Review setup');
    } else {
      pushAction('doNext', `Before moving to Performance Intelligence, close the readiness gaps first: ${performanceReadiness.missing_requirements.slice(0, 2).join('; ')}.`, '/company-profile', 'Close readiness gaps');
    }
  } else if (!refreshCurrentReport && reports_summary.structured_reports === 0 && reports_summary.analytics_reports > 0) {
    pushAction('doNext', 'Add a structured diagnostic report next so the system can explain what is missing, not only what is moving.', '/reports/digital-authority-snapshot', 'Add diagnostic report');
  } else if (!refreshCurrentReport && reports_summary.total_reports >= 2) {
    pushAction('monitor', 'The report layer is broad enough for now, so the bigger gain likely comes from acting on the findings rather than collecting another report immediately.', '/intelligence', 'Stay on intelligence');
  }

  if (!refreshCurrentReport && topReportType === 'snapshot' && reports_summary.report_type_mix.length === 1) {
    if (performanceReadiness.state === 'ready_now') {
      pushAction('doNext', 'The current report layer is dominated by Digital Authority Snapshot, and the company is now mature enough for Performance Intelligence to create real execution guidance.', '/reports/performance-intelligence', 'Go to next report');
    } else if (performanceReadiness.state === 'collecting_baseline') {
      pushAction('monitor', 'The company is instrumented enough for Performance Intelligence, but it still needs a little more tracked activity before that report will be worth the credits.', '/engagement', 'Build more signal');
    } else if (growthReadiness.state === 'ready_now') {
      pushAction('doNext', 'Market & Growth Intelligence is now viable, but only because the company appears growth-mature enough to support it. Use it only if downstream commercial context is the real next decision.', '/reports/market-growth-intelligence', 'Open growth report');
    } else {
      pushAction('doNext', `Do not jump beyond Digital Authority Snapshot yet. First close the missing readiness items for the next report: ${performanceReadiness.missing_requirements.slice(0, 2).join('; ')}.`, '/company-profile', 'Review readiness');
    }
  } else if (!refreshCurrentReport && topReportType === 'performance' && reports_summary.report_type_mix.length === 1) {
    if (growthReadiness.state === 'ready_now') {
      pushAction('doNext', 'The company now looks mature enough for Market & Growth Intelligence because broader growth instrumentation and commercial context are available.', '/reports/market-growth-intelligence', 'Run growth report');
    } else if (growthReadiness.state === 'collecting_baseline') {
      pushAction('monitor', 'Growth instrumentation is largely in place, but the system still needs more accumulated commercial signal before Market & Growth Intelligence becomes decision-grade.', '/engagement', 'Keep collecting signal');
    } else {
      pushAction('doNext', `Do not push into Market & Growth Intelligence yet. First close the readiness gaps: ${growthReadiness.missing_requirements.slice(0, 2).join('; ')}.`, '/company-profile', 'Close growth gaps');
    }
  } else if (!refreshCurrentReport && topReportType === 'growth' && reports_summary.report_type_mix.length === 1) {
    pushAction('monitor', 'Market & Growth Intelligence is already the dominant report path, so the better move now is likely acting on that guidance rather than climbing further.', '/intelligence', 'Act on guidance');
  } else if (!refreshCurrentReport && topReportType === 'strategic' && reports_summary.report_type_mix.length === 1) {
    pushAction('doNext', 'The current report layer is dominated by Strategic Intelligence. Add a more concrete diagnostic or performance report next so recommendations stay grounded in operating evidence.', '/reports', 'Review report options');
  }

  if (!refreshCurrentReport && growthReadiness.state !== 'ready_now' && connectedGrowthSystems.length < 2) {
    pushAction('doNext', `Market & Growth Intelligence should wait until at least two broader commercial systems are connected. Right now the system only sees ${connectedGrowthSystems.length > 0 ? connectedGrowthSystems.join(' + ') : 'too little commercial infrastructure'} from a growth-readiness standpoint.`, '/company-profile', 'Connect growth systems');
  }

  if (content_summary.recent_blogs === 0) {
    pushAction('doNow', 'Publish new content this week so the system has fresh signal to learn from.', '/admin/content', 'Publish content this week');
  } else if (content_summary.total_blogs < 3) {
    pushAction('doNext', 'Broaden the content mix slightly so one successful piece does not carry the whole authority story.', '/command-center/content', 'Broaden content mix');
  }

  if (topContentType && contentTypeCount <= 1) {
    pushAction('doNext', `Right now the content system leans almost entirely on ${formatContentTypeLabel(topContentType.type)}. Add one adjacent format so the intelligence layer can compare what actually creates stronger traction.`, '/command-center/content', 'Add another format');
  } else if (topContentType && contentTypeCount === 2) {
    pushAction('monitor', `The current mix still leans heavily on ${formatContentTypeLabel(topContentType.type)}. Keep watching whether the second format is creating enough distinct value to justify scaling it.`, '/command-center/content', 'Review content mix');
  }

  if (campaign_mix_summary.total_versions > 0 && dominantCampaignPathLabel && campaignPathCounts.length <= 1) {
    pushAction('doNext', `Campaign execution currently leans almost entirely on ${dominantCampaignPathLabel}. Add one adjacent campaign path so the system can learn whether a different execution style creates stronger traction or conversion.`, '/command-center/campaigns', 'Add campaign path');
  } else if (campaign_mix_summary.total_versions > 0 && dominantCampaignPathLabel && campaignPathCounts.length === 2) {
    pushAction('monitor', `${dominantCampaignPathLabel} is still the dominant campaign path. Keep watching whether the second path is creating a distinct enough lift to justify scaling the mix further.`, getCampaignPathRoute(dominantCampaignPath), 'Review campaign mix');
  }

  if (distribution_summary.connected_platforms === 0) {
    pushAction('doNow', 'Connect publishing platforms because the system still cannot judge whether traction is weak due to content or due to thin distribution.', '/engagement', 'Connect platforms');
  } else if (distribution_summary.active_platforms === 0) {
    pushAction('doNow', 'Move to a fixed weekly publishing cadence on the connected platforms so the system can start compounding signal.', '/engagement', 'Move to weekly cadence');
  } else if (distribution_summary.active_platforms === 1 && distribution_summary.connected_platforms > 1) {
    pushAction('doNow', 'Distribute every content cycle across at least two active channels so traction does not depend on a single platform.', '/engagement', 'Expand distribution');
  }

  if (topPlatform && topPlatform.share_pct >= 70 && distribution_summary.active_platforms > 1) {
    pushAction('doNext', `${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of visible distribution right now. Rebalance the mix slightly so growth does not depend too heavily on one platform.`, '/engagement', 'Rebalance channels');
  }

  if (topPlatform && topPlatform.success_rate > 0 && topPlatform.success_rate < 80) {
    pushAction('doNow', `${formatPlatformLabel(topPlatform.platform)} is only delivering at a ${topPlatform.success_rate}% success rate. Fix that channel before relying on it as the main distribution path.`, '/engagement', 'Fix channel delivery');
  }

  if (distribution_summary.publish_success_rate > 0 && distribution_summary.publish_success_rate < 85) {
    pushAction('doNow', `Publishing reliability is only ${distribution_summary.publish_success_rate}%. Fix delivery failures before scaling content volume or campaign complexity.`, '/engagement', 'Fix publishing reliability');
  }

  if (timing_summary.rhythm_state === 'thin') {
    pushAction('doNow', `Move to a fixed weekly publishing cadence now. The system only has ${timing_summary.active_days} active day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days, which is not enough to create compounding signal.`, topContentType ? getContentRoute(topContentType.type) : '/admin/content', 'Move to weekly cadence');
  } else if (timing_summary.rhythm_state === 'steady' && timing_summary.avg_gap_days != null && timing_summary.avg_gap_days > 5) {
    pushAction('doNext', `The system is active, but the average ${timing_summary.avg_gap_days}-day gap between visible events is still slowing compounding momentum. Tighten the publishing rhythm a little further.`, topContentType ? getContentRoute(topContentType.type) : '/command-center/content', 'Tighten rhythm');
  }

  if (knowledge_graph_summary.status === 'shallow') {
    pushAction('doNow', 'Fill the weakest buyer-journey stage next instead of producing more top-of-funnel content only.', '/command-center/content', 'Fill weak stage');
  } else if (knowledge_graph_summary.status === 'imbalanced' && knowledge_graph_summary.weakest_stage) {
    const weakestStageRoute =
      knowledge_graph_summary.weakest_stage === 'awareness'
        ? '/posts/create'
        : knowledge_graph_summary.weakest_stage === 'decision'
          ? '/case-studies/create'
          : '/admin/content';
    pushAction('doNow', `Fill the ${knowledge_graph_summary.weakest_stage} stage next so the system stops over-relying on one part of the buyer journey.`, weakestStageRoute, 'Fill weak stage');
  } else if (knowledge_graph_summary.status === 'maturing') {
    pushAction('monitor', 'The knowledge graph is maturing well enough that the next move should focus on exploiting the strongest clusters rather than rebuilding the foundation.', '/command-center/content', 'Use strong clusters');
  }

  if (engagement_summary.connected_social_accounts === 0) {
    pushAction('doNow', 'Connect at least one active social account because engagement and distribution intelligence are still underpowered.', '/engagement', 'Connect social account');
  } else if (engagement_summary.threads === 0) {
    pushAction('doNext', 'Publish and ingest more live interactions so engagement intelligence can influence the next move.', '/engagement', 'Build live engagement');
  }

  if (lead_summary.qualified_active_leads > 0) {
    pushAction('doNow', `Move the ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} into a stronger follow-up or outreach motion now.`, '/dashboard/intelligence?intelTab=active-leads', 'Open active leads');
  } else if (lead_summary.prospect_active_leads > 0) {
    pushAction('doNow', `Review the ${lead_summary.prospect_active_leads} prospect${lead_summary.prospect_active_leads === 1 ? '' : 's'} now and tighten the next motion around role, segment, and urgency before they cool off.`, '/dashboard/intelligence?intelTab=active-leads', 'Review prospects');
  } else if (lead_summary.active_leads > 0) {
    pushAction('doNext', 'Review active leads and decide which ones should be nurtured into stronger commercial follow-up.', '/dashboard/intelligence?intelTab=active-leads', 'Review active leads');
  }

  if (market_pulse_summary.completed_runs === 0) {
    pushAction('monitor', 'Run Market Pulse to add external context before making the next bigger commercial bet.', '/dashboard/intelligence?intelTab=market-pulse', 'Run Market Pulse');
  } else if (market_pulse_summary.latest_findings > 0) {
    pushAction('doNext', 'Use the latest Market Pulse findings to refine where timing, partnerships, or expansion signals can strengthen execution.', '/dashboard/intelligence?intelTab=market-pulse', 'Review Market Pulse');
  }

  if (system_snapshot.campaigns_ready_to_scale > 1) {
    pushAction('doNow', 'More than one campaign is ready to scale, so the next move should focus on amplification rather than just more experimentation.', '/command-center/campaigns', 'Scale campaigns');
  }

  if (dominantCampaignPath === 'bolt_text') {
    pushAction('doNext', 'Current campaigns rely heavily on BOLT Text. Test BOLT Creator or Intelligent Mix next so the system can judge whether creative-led execution unlocks more traction or stronger conversion.', '/command-center/campaigns', 'Try another campaign path');
  } else if (dominantCampaignPath === 'bolt_creator') {
    pushAction('doNext', 'Current campaigns rely heavily on BOLT Creator. Add a stronger text-led or mixed path next so the system can compare whether strategic text depth improves repeatability.', '/command-center/campaigns', 'Balance campaign path');
  } else if (dominantCampaignPath === 'strategy_mix') {
    pushAction('monitor', 'Strategy Mix is carrying most of the campaign load right now. Watch whether that flexibility is creating clarity or whether a more opinionated BOLT path would tighten execution.', '/command-center/campaigns', 'Review campaign strategy');
  }

  if (objective === 'authority_growth') {
    if (content_summary.recent_blogs === 0) {
      actions.doNow.unshift({ text: 'Publish a fresh authority asset now because authority growth stalls quickly when the content graph goes quiet.', href: '/admin/content', label: 'Publish authority asset' });
    }
    if (topContentType?.type === 'post' || topContentType?.type === 'story') {
      pushAction('doNext', 'Authority growth should not rely only on short-form. Add at least one deeper format like blog, article, guide, or whitepaper to build stronger depth.', '/admin/content', 'Add deeper format');
    }
    if (dominantCampaignPath === 'bolt_text') {
      pushAction('doNext', 'Authority growth may now need a richer campaign mix than BOLT Text alone. Try Intelligent Mix or a creator-supported path if strong topics already exist.', '/command-center/intelligent-mix-strategy', 'Enrich campaign mix');
    }
    pushAction('doNext', 'Extend the strongest topic cluster into adjacent supporting formats so authority depth does not remain too narrow.', '/command-center/content', 'Extend strong topic');
  } else if (objective === 'engagement_growth') {
    if (engagement_summary.connected_social_accounts > 0 && engagement_summary.threads === 0) {
      actions.doNow.unshift({ text: 'Push more live distribution now because engagement growth needs active conversations, not only content inventory.', href: '/engagement', label: 'Increase live distribution' });
    }
    if (topContentType?.type === 'blog' || topContentType?.type === 'whitepaper') {
      pushAction('doNext', 'Engagement growth may be too weighted toward long-form depth. Add faster-response formats like posts, stories, or threads to increase interaction velocity.', '/posts/create', 'Add faster formats');
    }
    if (dominantCampaignPath === 'bolt_text' || dominantCampaignPath === 'strategy_mix') {
      pushAction('doNext', 'Engagement growth may benefit from a more creative campaign path. Test BOLT Creator or Intelligent Mix to increase visual pull and shareability.', dominantCampaignPath === 'strategy_mix' ? '/command-center/bolt-combined-strategy' : '/command-center/bolt-creator-strategy', 'Test creative path');
    }
    pushAction('doNext', 'Review timing, shareability, and creative variation because engagement growth depends on resonance, not just output volume.', '/engagement', 'Review engagement quality');
  } else if (objective === 'lead_generation') {
    if (lead_summary.active_leads === 0) {
      actions.doNow.unshift({ text: 'Tighten campaigns around clearer buyer intent so activity starts turning into identifiable active leads.', href: '/command-center/campaigns', label: 'Tighten buyer intent' });
    }
    if (topContentType?.type === 'post' || topContentType?.type === 'thread') {
      pushAction('doNext', 'Lead generation may need stronger conversion support than short-form alone. Add a deeper asset such as blog, article, case study, or newsletter to capture more serious demand.', '/case-studies/create', 'Add conversion asset');
    }
    if (dominantCampaignPath === 'bolt_creator') {
      pushAction('doNext', 'Lead generation should not rely only on creator-led campaigns. Add a text-led or mixed campaign path so stronger offer clarity and buyer education can support qualification.', '/command-center/bolt-text', 'Adjust campaign path');
    }
    if (lead_summary.qualified_active_leads > 0) {
      actions.doNow.unshift({ text: `Convert the ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} now before that demand cools off.`, href: '/dashboard/intelligence?intelTab=active-leads', label: 'Convert qualified leads' });
    } else if (lead_summary.prospect_active_leads > 0) {
      actions.doNow.unshift({ text: `Push the ${lead_summary.prospect_active_leads} prospect${lead_summary.prospect_active_leads === 1 ? '' : 's'} through a sharper qualification step now so the next commercial move is based on evidence, not guesswork.`, href: '/dashboard/intelligence?intelTab=active-leads', label: 'Qualify prospects' });
    }
    pushAction('doNext', 'Use campaign and engagement signals to separate suspects, prospects, and qualified leads before scaling volume.', '/dashboard/intelligence?intelTab=active-leads', 'Open lead stages');
  } else if (objective === 'pipeline_growth') {
    pushAction('doNow', 'Prioritize actions that move warm demand into a stronger pipeline motion instead of only expanding top-of-funnel activity.', '/dashboard/intelligence?intelTab=active-leads', 'Move demand into pipeline');
    if (lead_summary.qualified_active_leads > 0) {
      pushAction('doNow', 'Segment qualified demand by role, business type, or deal potential before routing the next outreach motion.', '/dashboard/intelligence?intelTab=active-leads', 'Segment qualified demand');
    } else if (lead_summary.prospect_active_leads > 0) {
      pushAction('doNext', 'Prospect-stage demand exists, but it still needs stronger qualification before the team treats it like true pipeline.', '/dashboard/intelligence?intelTab=active-leads', 'Tighten qualification');
    }
    if (intelligence_settings.target_customer_segment) {
      pushAction('doNext', `Pressure-test pipeline actions against the target segment: ${intelligence_settings.target_customer_segment}.`, '/company-profile', 'Review target segment');
    }
  } else if (objective === 'revenue_acceleration') {
    pushAction('doNow', 'Bias the next move toward commercial conversion, not only engagement uplift, because revenue acceleration depends on turning warm demand into action quickly.', '/dashboard/intelligence?intelTab=active-leads', 'Push commercial conversion');
    if (intelligence_settings.sales_motion) {
      pushAction('doNext', `Align the next commercial step to the ${intelligence_settings.sales_motion} sales motion so the path from demand to revenue stays realistic.`, '/company-profile', 'Review sales motion');
    }
    if (intelligence_settings.avg_deal_size) {
      pushAction('doNext', `Use the ${intelligence_settings.avg_deal_size} average deal context when deciding whether to pursue volume, qualification, or deeper nurture.`, '/company-profile', 'Review deal context');
    }
  }

  return actions;
}
