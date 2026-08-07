/**
 * INT-001 Phase 2 — Recommendation Engine.
 *
 * Consumes qualification (plus intent/persona/segments/behaviour) and answers
 * the operator questions: why valuable, product interest, objections, content,
 * owner, channel, contact time, meeting/close probability, next best action.
 * Every recommendation carries a confidence and an explanation. Deterministic.
 */

import type {
  IntentIntelligence,
  LeadCaptureSnapshot,
  LeadEvolutionIntelligence,
  LeadRecommendations,
  PageCategory,
  PersonaIntelligence,
  QualificationIntelligence,
  RecommendationItem,
  SegmentAssignment,
} from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';
import { describeGeo, utcOffsetHours } from './visitorContext';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const capConf = (n: number): number => round2(Math.min(0.95, Math.max(0.05, n)));

export interface RecommendationInputs {
  snapshot: LeadCaptureSnapshot;
  intent: IntentIntelligence;
  persona: PersonaIntelligence;
  qualification: QualificationIntelligence;
  segments: SegmentAssignment[];
  /** WS-2 M3 — evolution context; absent means the pre-M3 behaviour. */
  evolution?: LeadEvolutionIntelligence;
}

const CATEGORY_INTEREST_LABEL: Partial<Record<PageCategory, string>> = {
  pricing: 'Core product (pricing-stage evaluation)',
  enterprise: 'Enterprise plan',
  demo: 'Guided demo / trial',
  documentation: 'API / technical integration',
  security: 'Security & compliance posture',
  comparison: 'Competitive replacement',
  case_study: 'Proven-outcome use cases',
};

function topCategories(b: BehaviorAnalysis): Array<{ category: PageCategory; count: number }> {
  return [...b.categoryPages.entries()]
    .map(([category, set]) => ({ category, count: set.size }))
    .filter((e) => e.count > 0)
    .sort((a, z) => (z.count - a.count) || a.category.localeCompare(z.category));
}

export function buildRecommendations(
  inputs: RecommendationInputs,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
  precomputed?: BehaviorAnalysis,
): LeadRecommendations {
  const config = resolveEngineConfig(configOverride);
  const recCfg = config.recommendation;
  const b = precomputed ?? analyzeBehavior(inputs.snapshot, config);
  const { snapshot, intent, persona, qualification, segments } = inputs;
  const hasSegment = (s: SegmentAssignment['segment']): boolean => segments.some((x) => x.segment === s);
  const dataRichness = capConf(0.3 + Math.min(b.totalEvents, 10) * 0.04 + (snapshot.lead.jobTitle ? 0.1 : 0) + (snapshot.lead.companyName ? 0.1 : 0));

  // Why valuable — top weighted qualification sections.
  const topSections = [...qualification.sections].sort((a, z) => (z.weightedScore - a.weightedScore) || a.key.localeCompare(z.key)).slice(0, 2);
  // WS-2 M1 (5): returning behaviour is one of the strongest buying signals a
  // visitor can give, so it is stated explicitly in the value rationale rather
  // than being buried inside a qualification section reason.
  const loyaltyClause =
    b.returningVisitor === true
      ? b.visitCount !== null
        ? ` Returning visitor — visit #${b.visitCount}.`
        : ' Returning visitor.'
      : '';
  const whyValuable: RecommendationItem = {
    value:
      qualification.totalScore > 0
        ? `Scored ${qualification.totalScore}/100 (${qualification.band}); strongest signals: ${topSections.map((s) => `${s.key} ${s.score}/100`).join(', ')}.${loyaltyClause}`
        : `No captured signals establish value yet.${loyaltyClause}`,
    // A known returning visitor is materially more certain than a first-touch
    // one, so the confidence in this judgement rises accordingly.
    confidence: capConf(qualification.totalScore / 100 + 0.2 + (b.returningVisitor === true ? 0.1 : 0)),
    explanation: topSections.map((s) => s.reason).join(' · ') || 'No qualification signals captured',
  };

  // Product interest — declared interest first, else dominant page category.
  const declared = (snapshot.lead.primaryInterest ?? '').trim();
  const top = topCategories(b).find((e) => CATEGORY_INTEREST_LABEL[e.category]);
  // WS-2 M2: an on-site search sits between a declared interest and an inferred
  // one — the visitor typed it, but not into a form asking what they want.
  const searchedFor = b.searchQueries[0] ?? null;
  const likelyProductInterest: RecommendationItem = declared
    ? { value: declared, confidence: capConf(0.75), explanation: `Lead declared "${declared}" as their primary interest at capture` }
    : searchedFor
      ? {
        value: `Searched: ${searchedFor}`,
        confidence: capConf(0.55 + Math.min(b.searchQueries.length, 3) * 0.05),
        explanation: `No declared interest, but the visitor searched the site for ${b.searchQueries.slice(0, 3).map((q) => `"${q}"`).join(', ')}`,
      }
      : top
      ? { value: CATEGORY_INTEREST_LABEL[top.category]!, confidence: capConf(0.35 + top.count * 0.1), explanation: `Most-visited signal category: ${top.category} (${top.count} page(s))` }
      : { value: 'Unknown', confidence: 0.1, explanation: 'No declared interest and no categorized page visits' };

  // Objections — driven by segments/behaviour.
  const objections: string[] = [];
  const objectionReasons: string[] = [];
  if (hasSegment('Price Shoppers')) { objections.push('Price sensitivity'); objectionReasons.push('pricing-focused browsing'); }
  if (hasSegment('Competitor Evaluators')) { objections.push('Committed to a competitor'); objectionReasons.push('comparison pages visited'); }
  if (hasSegment('Technical Evaluators')) { objections.push('Integration complexity'); objectionReasons.push('deep documentation review'); }
  if (hasSegment('Enterprise Buyers') || hasSegment('Procurement')) { objections.push('Security/compliance review requirements'); objectionReasons.push('enterprise/security interest'); }
  if (objections.length === 0) { objections.push('Insufficient perceived urgency'); objectionReasons.push('no objection-specific signals; defaulting to urgency risk'); }
  const likelyObjections: RecommendationItem<string[]> = {
    value: objections,
    confidence: capConf(0.25 + (objectionReasons.length - 1) * 0.15),
    explanation: `Derived from: ${objectionReasons.join(', ')}`,
  };

  // Content — what the persona/segments have NOT seen yet but would need next.
  const content: string[] = [];
  const pagesOf = (c: PageCategory): number => b.categoryPages.get(c)?.size ?? 0;
  if (persona.persona === 'Developer' || persona.persona === 'CTO' || hasSegment('Technical Evaluators')) content.push('Technical integration guide / API docs');
  if (hasSegment('Enterprise Buyers') || hasSegment('Procurement')) content.push('Security & compliance whitepaper');
  if (pagesOf('case_study') === 0) content.push('Customer case study matching their industry');
  if (pagesOf('pricing') > 0 && pagesOf('demo') === 0) content.push('Demo / trial invitation');

  // WS-2 M2 — the visitor told us what they want; lead with that.
  const contentWhy: string[] = ['persona/segment needs minus content categories already consumed'];
  if (b.searchQueries.length > 0) {
    // Searched terms go FIRST: an explicit query outranks any inference.
    content.unshift(`Material answering their search for ${b.searchQueries.slice(0, 2).map((q) => `"${q}"`).join(' and ')}`);
    contentWhy.push(`on-site searches (${b.searchQueries.length} distinct)`);
  }
  if (b.videoCompleteCount > 0) {
    content.push('More video content — they finish what they start');
    contentWhy.push('completed video watches');
  } else if (b.videoStartCount > 0 && b.videoCompleteCount === 0) {
    content.push('Shorter-format video — they start videos but do not finish them');
    contentWhy.push('started but unfinished videos');
  }
  if (b.downloadedAssets.length > 0) {
    content.push(`Follow-up to ${b.downloadedAssets[0]}`);
    contentWhy.push(`downloaded assets (${b.downloadedAssets.slice(0, 2).join(', ')})`);
  }

  if (content.length === 0) content.push('Product overview and getting-started guide');
  const recommendedContent: RecommendationItem<string[]> = {
    value: content,
    // Declared interest (search) and consumed assets make this materially more
    // certain than inference from page visits alone.
    confidence: capConf(dataRichness + (b.searchQueries.length > 0 ? 0.15 : 0) + (b.downloadedAssets.length > 0 ? 0.05 : 0)),
    explanation: `Selected from ${contentWhy.join('; ')}`,
  };

  // Owner — routing by qualification band + persona.
  let owner = 'Marketing nurture';
  let ownerWhy = 'Low qualification — keep warming via automated nurture';
  if (qualification.band === 'hot' && (hasSegment('Enterprise Buyers') || hasSegment('Decision Makers'))) {
    owner = 'Senior Account Executive';
    ownerWhy = 'Hot lead with enterprise/decision-maker profile warrants senior sales ownership';
  } else if (qualification.band === 'hot' || qualification.band === 'warm') {
    owner = persona.persona === 'Developer' || persona.persona === 'CTO' ? 'Solutions Engineer' : 'Account Executive';
    ownerWhy = persona.persona === 'Developer' || persona.persona === 'CTO'
      ? 'Technical evaluator — pair with a solutions engineer'
      : 'Sales-ready qualification band';
  }
  // WS-2 M3 — owner evolution: ownership follows funnel depth, not just band.
  // A lead that has reached evaluation/decision warrants a closer even if its
  // score has not caught up yet; a dormant one goes back to nurture.
  const evoForOwner = inputs.evolution;
  if (evoForOwner) {
    const depth = evoForOwner.funnel.stage;
    if ((depth === 'decision' || depth === 'evaluation') && owner === 'Marketing nurture') {
      owner = 'Account Executive';
      ownerWhy = `Reached the ${depth} stage — too far along for automated nurture regardless of score`;
    } else if (evoForOwner.intent.trend === 'dormant' && owner !== 'Marketing nurture') {
      owner = 'Marketing nurture (re-engagement)';
      ownerWhy = `Previously ${evoForOwner.funnel.furthestStage}, now dormant — return to nurture until activity resumes`;
    } else {
      ownerWhy += `; currently ${depth}, trend ${evoForOwner.intent.trend}`;
    }
  }
  const recommendedOwner: RecommendationItem = { value: owner, confidence: capConf(0.3 + qualification.totalScore / 200), explanation: ownerWhy };

  // Channel.
  let channel = 'Email';
  let channelWhy = 'Default first-touch channel with captured email';
  const urgencyScore = qualification.sections.find((s) => s.key === 'urgency')?.score ?? 0;
  if (qualification.band === 'hot' && urgencyScore >= 50 && snapshot.lead.id !== null) {
    channel = 'Phone call';
    channelWhy = 'Hot + urgent — call while interest is live';
  } else if (hasSegment('Enterprise Buyers') && persona.persona !== 'Unknown') {
    channel = 'LinkedIn + Email';
    channelWhy = 'Enterprise buyer — multi-thread via LinkedIn alongside email';
  }
  // WS-2 M2 — device- and geography-aware channel refinement.
  //
  // A mobile-only visitor is a poor target for a long-form desktop demo link,
  // and a rep should know before calling that the lead is in another country.
  // These REFINE the channel choice above rather than replacing it, so the
  // existing band/segment logic stays the primary determinant.
  let channelDeviceNote = '';
  if (b.primaryDeviceCategory === 'mobile' && b.multiDevice !== true) {
    channelDeviceNote = ' Mobile-only visitor — keep the first touch short and avoid desktop-only assets.';
    if (channel === 'Email') channelDeviceNote += ' A concise mobile-friendly email or SMS will land better than a document.';
  } else if (b.primaryDeviceCategory === 'desktop' && b.videoCompleteCount > 0) {
    channelDeviceNote = ' Desktop viewer who finishes videos — a recorded walkthrough is a proven format for them.';
  }
  const geoNote = b.geo ? ` Located in ${describeGeo(b.geo)}.` : '';
  const geoWarning =
    b.geoConsistent === false ? ` Sessions came from ${b.countries.length} countries — confirm location before scheduling.` : '';
  const bestChannel: RecommendationItem = {
    value: channel,
    // Location and device sharpen the channel judgement; a mixed-country signal
    // does the opposite, so it removes the geographic part of that certainty.
    confidence: capConf(0.3 + urgencyScore / 200 + (b.geo && b.geoConsistent !== false ? 0.05 : 0)),
    explanation: `${channelWhy}.${channelDeviceNote}${geoNote}${geoWarning}`.trim(),
  };

  // Contact time — modal activity hour (UTC), earliest hour wins ties.
  //
  // WS-2 M2: when the visitor's timezone is known, the same modal hour is ALSO
  // expressed in their local time. "14:00 UTC" is not actionable to a rep;
  // "09:00 in America/New_York" is. The UTC figure is retained so the value
  // never becomes ambiguous about which clock it refers to.
  let bestContactTime: RecommendationItem;
  if (b.hourHistogram.size > 0) {
    let bestHour = -1;
    let bestCount = -1;
    for (const [hour, count] of [...b.hourHistogram.entries()].sort((a, z) => a[0] - z[0])) {
      if (count > bestCount) { bestHour = hour; bestCount = count; }
    }
    const hh = (h: number): string => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
    const offset = utcOffsetHours(b.timezone, snapshot.now);
    const localWindow =
      offset !== null
        ? ` (${hh(bestHour + Math.trunc(offset))}–${hh(bestHour + Math.trunc(offset) + 1)} local, ${b.timezone})`
        : '';
    bestContactTime = {
      value: `${hh(bestHour)}–${hh(bestHour + 1)} UTC${localWindow}`,
      // Knowing the visitor's timezone materially improves this recommendation.
      confidence: capConf(0.2 + Math.min(bestCount, 8) * 0.06 + (offset !== null ? 0.1 : 0)),
      explanation:
        offset !== null
          ? `Most active around ${hh(bestHour)} UTC (${bestCount} event(s)); converted to ${b.timezone}`
          : `Lead was most active around ${hh(bestHour)} UTC (${bestCount} event(s))`,
    };
  } else if (b.timezone) {
    bestContactTime = {
      value: `Weekday mornings in ${b.timezone}`,
      confidence: 0.2,
      explanation: `No activity timestamps captured, but the visitor's timezone (${b.timezone}) is known`,
    };
  } else {
    bestContactTime = { value: 'Weekday mornings (recipient local time)', confidence: 0.1, explanation: 'No activity timestamps captured; using general default' };
  }

  // WS-2 M3 — timing evolution. The hour of day is only half the question; the
  // other half is how soon, and that comes from momentum rather than the clock.
  if (inputs.evolution) {
    const t = inputs.evolution.intent.trend;
    const urgencyWindow =
      t === 'accelerating' ? 'Contact within hours — momentum is building'
        : t === 'growing' ? 'Contact within 24 hours while interest is rising'
          : t === 'decaying' ? 'Contact immediately — the window is closing'
            : t === 'dormant' ? 'No time pressure; re-engage on a nurture cadence'
              : null;
    if (urgencyWindow) {
      bestContactTime = {
        ...bestContactTime,
        explanation: `${bestContactTime.explanation}. ${urgencyWindow} (intent trend: ${t})`,
      };
    }
  }

  // Probabilities — bounded linear maps from qualification (reproducible).
  const meetP = round2(Math.min(recCfg.meetingProbability.max, recCfg.meetingProbability.base + qualification.totalScore * recCfg.meetingProbability.perQualificationPoint));
  const companyFitScore = qualification.sections.find((s) => s.key === 'companyFit')?.score ?? 0;
  const closeP = round2(Math.min(
    recCfg.closeProbability.max,
    recCfg.closeProbability.base + qualification.totalScore * recCfg.closeProbability.perQualificationPoint + companyFitScore * recCfg.closeProbability.companyFitFactor,
  ));
  const meetingProbability: RecommendationItem<number> = {
    value: meetP,
    confidence: dataRichness,
    explanation: `Linear map of qualification ${qualification.totalScore}/100 onto configured meeting-probability curve`,
  };
  const closeProbability: RecommendationItem<number> = {
    value: closeP,
    confidence: round2(Math.max(0.05, dataRichness - 0.1)),
    explanation: `Qualification ${qualification.totalScore}/100 plus company fit ${companyFitScore}/100 on configured close-probability curve`,
  };

  // Next best action.
  let action = 'Add to nurture sequence and monitor for new activity';
  let actionWhy = 'Signals too weak for direct outreach';
  if (qualification.band === 'hot') {
    action = pagesOf('demo') > 0 ? 'Book the demo now — direct outreach within 24h' : 'Direct outreach within 24h offering a tailored demo';
    actionWhy = 'Hot qualification band with live intent';
  } else if (qualification.band === 'warm') {
    action = 'Personalized follow-up referencing the pages they explored';
    actionWhy = 'Warm lead — relevance-led touch keeps momentum';
  } else if (qualification.band === 'cool') {
    action = 'Send the top recommended content and re-score after next visit';
    actionWhy = 'Cool lead — earn attention with content before outreach';
  }
  // ── WS-2 M3 — evolution-aware action, risk and maturity ──────────────────
  //
  // The band-based action above answers "how good is this lead?". Evolution
  // answers "which way is it moving?", and the two disagree often enough to
  // matter: a hot lead that peaked a month ago needs a re-engagement play, not
  // the same "book the demo" a rising hot lead needs.
  const evo = inputs.evolution;
  let actionConfidence = capConf(0.3 + qualification.totalScore / 150);
  if (evo) {
    if (evo.intent.trend === 'dormant' || evo.journey.state === 'dormant') {
      action = 'Re-engagement campaign — do not open with a sales ask';
      actionWhy = `Dormant: ${evo.journey.stagnantDays ?? '?'} day(s) since any activity, intent ${evo.intent.decayFromPeak} pts below its peak of ${evo.intent.peakScore}`;
    } else if (evo.intent.trend === 'decaying' && qualification.band !== 'cold') {
      action = 'Reach out now with new information — interest is cooling';
      actionWhy = `Intent fell from ${evo.intent.peakScore} to ${evo.intent.currentScore}; act before it decays further`;
    } else if (evo.intent.trend === 'accelerating' || evo.journey.state === 'accelerating') {
      action = 'Contact today — engagement is accelerating';
      actionWhy = `${evo.intent.reasoning}. Momentum is the reason to move now, not the score alone`;
    } else if (evo.funnel.regressed) {
      action = 'Revisit the objection that stalled them';
      actionWhy = `Reached ${evo.funnel.furthestStage} but is currently reading ${evo.funnel.stage}`;
    }
    // A trend built on more observation points is a more trustworthy basis.
    actionConfidence = capConf(actionConfidence + (evo.intent.confidence - 0.5) * 0.2);
  }
  const nextBestAction: RecommendationItem = { value: action, confidence: actionConfidence, explanation: actionWhy };

  // Risk indicators — what could lose this deal, each traced to its evidence.
  const risks: string[] = [];
  const riskWhy: string[] = [];
  if (evo) {
    if (evo.intent.trend === 'dormant') { risks.push('Gone dormant'); riskWhy.push(`no activity for ${evo.intent.persistenceDays !== null ? `${evo.journey.stagnantDays} day(s)` : 'an extended period'}`); }
    else if (evo.intent.trend === 'decaying') { risks.push('Cooling interest'); riskWhy.push(`intent ${evo.intent.decayFromPeak} pts below peak`); }
    if (evo.journey.state === 'stagnant') { risks.push('Journey stalled'); riskWhy.push(`${evo.journey.stagnantDays} day(s) without a new milestone`); }
    if (evo.journey.state === 'slowing') { risks.push('Return cadence slowing'); riskWhy.push(`visits ${evo.journey.acceleration}× the previous pace`); }
    if (evo.funnel.regressed) { risks.push('Funnel regression'); riskWhy.push(`${evo.funnel.furthestStage} → ${evo.funnel.stage}`); }
    if (evo.intent.checkpoints.length === 1) { risks.push('Single-session read'); riskWhy.push('no history to corroborate the signal'); }
  }
  if (hasSegment('Price Shoppers') && !risks.includes('Cooling interest')) { risks.push('Price sensitivity'); riskWhy.push('pricing-focused browsing'); }
  if (risks.length === 0) { risks.push('No elevated risk detected'); riskWhy.push('engagement is steady or improving with no regression'); }
  const riskIndicators: RecommendationItem<string[]> = {
    value: risks,
    confidence: evo ? capConf(0.3 + evo.intent.confidence * 0.4) : 0.2,
    explanation: `Derived from: ${riskWhy.join('; ')}`,
  };

  // Opportunity maturity — funnel depth qualified by direction of travel.
  const maturityLabel = evo
    ? evo.funnel.stage === 'decision' ? 'Late stage — decision'
      : evo.funnel.stage === 'evaluation' ? 'Mid–late stage — evaluation'
        : evo.funnel.stage === 'consideration' ? 'Mid stage — consideration'
          : evo.funnel.stage === 'interest' ? 'Early stage — interest'
            : evo.funnel.stage === 'awareness' ? 'Top of funnel — awareness'
              : 'Not yet engaged'
    : 'Unknown';
  const opportunityMaturity: RecommendationItem = {
    value: evo ? `${maturityLabel} (${evo.intent.trend})` : maturityLabel,
    confidence: evo ? capConf(evo.funnel.confidence) : 0.1,
    explanation: evo
      ? `${evo.funnel.reasoning}. ${evo.intent.reasoning}`
      : 'No evolution context available for this lead',
  };

  return {
    whyValuable,
    likelyProductInterest,
    likelyObjections,
    recommendedContent,
    recommendedOwner,
    bestChannel,
    bestContactTime,
    meetingProbability,
    closeProbability,
    nextBestAction,
    riskIndicators,
    opportunityMaturity,
  };
}
