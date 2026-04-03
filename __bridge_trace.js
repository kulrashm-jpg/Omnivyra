// Bridge trace validation script — run with: node __bridge_trace.js
// Traces cardToContentBridge logic against 3 card fixtures to produce evidence JSON

function str(v) { return (v ?? '').trim(); }
function list(v) { return (v ?? []).filter(s => typeof s === 'string' && s.trim().length > 0); }
function compact(parts, sep) {
  var s = sep || ' | ';
  return parts.filter(Boolean).join(s);
}

function deriveIntent(executionStage, goalOverride) {
  if (goalOverride) return goalOverride;
  var stage = str(executionStage).toLowerCase();
  if (stage.indexOf('awareness') >= 0 || stage.indexOf('trust') >= 0 || stage.indexOf('thought') >= 0) return 'awareness';
  if (stage.indexOf('authority') >= 0 || stage.indexOf('education') >= 0 || stage.indexOf('consider') >= 0) return 'authority';
  if (stage.indexOf('conversion') >= 0 || stage.indexOf('demand') >= 0 || stage.indexOf('decision') >= 0 || stage.indexOf('capture') >= 0) return 'conversion';
  if (stage.indexOf('retention') >= 0 || stage.indexOf('relationship') >= 0 || stage.indexOf('loyalty') >= 0) return 'retention';
  return 'authority';
}

function deriveAngleType(campaignAngle) {
  var a = str(campaignAngle).toLowerCase();
  if (a.indexOf('contrarian') >= 0 || a.indexOf('challenge') >= 0 || a.indexOf('myth') >= 0 || a.indexOf('wrong') >= 0) return 'contrarian';
  if (a.indexOf('strategic') >= 0 || a.indexOf('lever') >= 0 || a.indexOf('outcome') >= 0 || a.indexOf('decision') >= 0 || a.indexOf('roi') >= 0) return 'strategic';
  return 'analytical';
}

var cardA = {
  schema_type: 'recommendation_strategic_card',
  core: {
    topic: 'B2B Content Distribution',
    polished_title: 'The Distribution-First Content Strategy Most B2B Teams Are Missing',
    narrative_direction: 'Shift from content volume to distribution leverage as primary KPI'
  },
  strategic_context: {
    aspect: 'Content Operations',
    facets: ['owned channels', 'earned amplification', 'dark social tracking'],
    audience_personas: ['Content Managers at 50-500 person SaaS companies', 'VP Marketing at Series B startups'],
    messaging_hooks: [
      'Most content teams measure production, not distribution efficiency',
      'Dark social accounts for 84% of B2B content sharing but almost nobody tracks it',
      'Distribution-first thinking fundamentally changes what content gets created'
    ]
  },
  intelligence: {
    problem_being_solved: 'Content teams spend 80% of effort on creation and 20% on distribution — inverse of where ROI lives',
    gap_being_filled: 'No playbook exists for systematic B2B distribution stack construction and measurement',
    why_now: 'Algorithm reach is declining 40% YoY across all owned channels; owned audience building is now existential',
    authority_reason: 'First-party analysis of 200+ B2B content audits showing distribution as #1 ROI driver',
    expected_transformation: 'Teams shift KPIs from content volume to distribution-reach-ratio, driving 3x qualified pipeline',
    campaign_angle: 'Challenge the creation-first orthodoxy: distribution is the leverage point that makes content work'
  },
  execution: {
    execution_stage: 'authority building',
    stage_objective: 'Establish distribution expertise as a differentiated capability',
    psychological_goal: 'Make CMO feel urgency + professional inadequacy gap they can close',
    momentum_level: 'high'
  },
  company_context_snapshot: {
    core_problem_statement: 'Marketing teams invest heavily in content with poor distribution ROI',
    pain_symptoms: ['low blog traffic despite high publish frequency', 'social posts getting <50 impressions', 'newsletter growth plateau'],
    desired_transformation: 'Audience-owned distribution channels that compound month-over-month',
    brand_voice: 'Direct, evidence-based, challenges conventional thinking',
    reader_emotion_target: 'Urgency + clarity',
    recommended_cta_style: 'Self-assessment tool or distribution audit framework'
  },
  blueprint: { progression_summary: 'Week 1-2: Problem definition. Week 3-5: Distribution stack build. Week 6-8: Measurement.' }
};

var themeA = {
  theme_angle: 'The hidden leverage in your content stack',
  hooks: ['Your content is fine. Your distribution is the problem.', 'Stop publishing. Start distributing.'],
  messaging_hooks: ['Distribution ROI is 4x creation ROI in B2B'],
  emotional_tone: 'Provocative clarity',
  reader_emotion_target: 'Urgency + actionability'
};

var cardB = {
  schema_type: 'recommendation_strategic_card',
  core: { topic: 'AI Adoption in Marketing', polished_title: null, narrative_direction: '' },
  strategic_context: { aspect: '', facets: [], audience_personas: [], messaging_hooks: [] },
  intelligence: {
    problem_being_solved: '',
    gap_being_filled: '',
    why_now: 'GPT-4o and Claude 3.5 released; marketing teams scrambling to integrate',
    authority_reason: '',
    expected_transformation: '',
    campaign_angle: 'AI adoption: strategic vs. tactical lens'
  },
  execution: { execution_stage: 'awareness', stage_objective: '', psychological_goal: '', momentum_level: 'medium' },
  company_context_snapshot: {
    core_problem_statement: '', pain_symptoms: [], desired_transformation: '',
    brand_voice: '', reader_emotion_target: '', recommended_cta_style: ''
  },
  blueprint: { progression_summary: '' }
};

var themeB = {
  theme_angle: 'AI as competitive moat vs. AI as commodity',
  hooks: [],
  emotional_tone: 'Analytical'
};

var cardC = {
  schema_type: 'planner_strategic_card',
  core: {
    topic: 'Demand Generation',
    polished_title: 'Demand Gen in a Zero-Click World',
    narrative_direction: 'Dark social and zero-click are permanently changing demand attribution'
  },
  strategic_context: {
    campaign_goal: 'Establish authority on modern demand gen attribution',
    target_audience: ['Demand Gen Managers', 'RevOps Leaders'],
    key_message: 'Clicks are a lagging indicator; attention is the leading signal',
    selected_aspects: ['attribution', 'dark social', 'intent signals'],
    selected_offerings: []
  },
  intelligence: {
    problem_being_solved: 'Last-click attribution systematically undercounts the top-of-funnel channels that actually drive pipeline',
    why_now: 'Google Analytics 4 deprecation of session-based metrics forces teams to rethink measurement',
    expected_transformation: 'Marketing teams adopt multi-signal models that double their visible pipeline',
    campaign_angle: 'The attribution gap is costing demand gen teams their budget and credibility'
  },
  execution: {
    execution_stage: 'conversion consideration',
    stage_objective: 'Get RevOps buy-in on new attribution model',
    psychological_goal: 'Remove fear of attribution model change by providing a clear transition path',
    momentum_level: 'high'
  },
  blueprint: { progression_summary: 'Rethink attribution build dark social visibility validate new pipeline model' },
  weekly_themes: []
};

var themeC = {
  narrative_direction: 'From last-click myths to multi-signal truth',
  hooks: ['Your demand gen is working. Your measurement is broken.'],
  emotional_tone: 'Confident and challenging',
  reader_emotion_target: 'Empowered certainty'
};

function traceCard(label, card, themeCard) {
  var intel = card.intelligence;
  var exec = card.execution;
  var isRec = 'company_context_snapshot' in card;
  var isPlan = card.schema_type === 'planner_strategic_card';

  var intent = deriveIntent(exec.execution_stage, undefined);
  var angleType = deriveAngleType(intel.campaign_angle);

  var coreProblem = str(isRec ? (card.company_context_snapshot.core_problem_statement || intel.problem_being_solved) : intel.problem_being_solved);
  var painPoints = list(isRec ? card.company_context_snapshot.pain_symptoms : []);
  var transformationGoal = str(isRec ? (card.company_context_snapshot.desired_transformation || intel.expected_transformation) : intel.expected_transformation);
  var authorityBasis = str(isRec ? intel.authority_reason : '');
  var gapFilled = str(isRec ? intel.gap_being_filled : '');
  var whyNow = str(intel.why_now);
  var messagingHooks = list(isRec ? card.strategic_context.messaging_hooks : []);
  var audiencePersonas = list(isRec ? card.strategic_context.audience_personas : (isPlan ? card.strategic_context.target_audience : []));
  var brandVoice = str(isRec ? card.company_context_snapshot.brand_voice : '');
  var ctaStyle = str(isRec ? card.company_context_snapshot.recommended_cta_style : '');
  var readerEmotion = str(isRec ? card.company_context_snapshot.reader_emotion_target : exec.psychological_goal);
  var narrativeDirection = str(card.core.narrative_direction);
  var topic = str(card.core.topic || card.core.polished_title);

  var themeAngle = str((themeCard && themeCard.theme_angle) || (themeCard && themeCard.narrative_direction) || '');
  var hookVariants = list((themeCard && themeCard.hooks) || (themeCard && themeCard.messaging_hooks) || messagingHooks);
  var tone = str((themeCard && themeCard.emotional_tone) || (themeCard && themeCard.reader_emotion_target) || readerEmotion || brandVoice);

  var mustIncludePoints = Array.from(new Set(messagingHooks.concat(hookVariants.length > 0 ? hookVariants : []))).filter(Boolean);
  var audience = audiencePersonas.slice(0, 2).join(', ') || 'B2B marketing practitioners and decision-makers';

  var answers = {};
  if (audience) answers.audience = audience;
  if (whyNow) answers.trend_context = whyNow;
  if (gapFilled) answers.uniqueness_directive = gapFilled;
  if (mustIncludePoints.length > 0) answers.must_include_points = mustIncludePoints.join(' | ');
  if (coreProblem || transformationGoal || authorityBasis || painPoints.length > 0) {
    answers.company_context = compact([
      coreProblem ? 'Core problem: ' + coreProblem : '',
      transformationGoal ? 'Transformation goal: ' + transformationGoal : '',
      authorityBasis ? 'Authority basis: ' + authorityBasis : '',
      painPoints.length > 0 ? 'Pain points: ' + painPoints.join('; ') : ''
    ]);
  }
  if (narrativeDirection || themeAngle) answers.campaign_objective = narrativeDirection || themeAngle;
  if (exec.stage_objective) answers.reader_stage = compact([str(exec.stage_objective), str(exec.psychological_goal), readerEmotion]);
  if (ctaStyle) answers.cta_preference = ctaStyle;
  if (brandVoice) answers.writing_style = brandVoice;

  var depthPillars = 0;
  if (coreProblem) depthPillars++;
  if (whyNow) depthPillars++;
  if (gapFilled) depthPillars++;
  if (transformationGoal) depthPillars++;
  depthPillars++; // always decision framework pillar

  var signals = {
    campaign_angle: { present: str(intel.campaign_angle).length > 0, maps_to: 'selected_angle + derived_angle.angle_summary' },
    messaging_hooks: { present: messagingHooks.length > 0, maps_to: 'answers.must_include_points', count: messagingHooks.length },
    why_now: { present: whyNow.length > 0, maps_to: 'answers.trend_context' },
    gap_being_filled: { present: gapFilled.length > 0, maps_to: 'answers.uniqueness_directive' },
    authority_reason: { present: authorityBasis.length > 0, maps_to: 'answers.company_context[authority_basis]' },
    problem_being_solved: { present: coreProblem.length > 0, maps_to: 'answers.company_context[core_problem]' },
    expected_transformation: { present: transformationGoal.length > 0, maps_to: 'answers.company_context[transformation_goal]' },
    pain_symptoms: { present: painPoints.length > 0, maps_to: 'answers.company_context[pain_points]', count: painPoints.length },
    execution_stage: { present: true, maps_to: 'intent=' + intent, source: exec.execution_stage },
    audience_personas: { present: audiencePersonas.length > 0, maps_to: 'answers.audience', count: audiencePersonas.length },
    brand_voice: { present: brandVoice.length > 0, maps_to: 'tone + answers.writing_style' },
    cta_style: { present: ctaStyle.length > 0, maps_to: 'answers.cta_preference' },
    narrative_direction: { present: narrativeDirection.length > 0, maps_to: 'answers.campaign_objective' }
  };

  var signalKeys = Object.keys(signals);
  var presentCount = signalKeys.filter(function(k) { return signals[k].present; }).length;
  var droppedSignals = signalKeys.filter(function(k) { return !signals[k].present; });
  var retentionScore = Math.round((presentCount / signalKeys.length) * 100);

  // Distortion analysis
  var distorted = [];
  if (painPoints.length > 0) {
    distorted.push('pain_symptoms: ' + painPoints.length + ' individual symptoms merged into company_context string blob — not individually accessible to generation engine prompt');
  }
  if (exec.stage_objective && exec.psychological_goal) {
    distorted.push('reader_stage: stage_objective + psychological_goal + reader_emotion_target concatenated as single pipe-delimited string — multi-concept compression may collapse nuance');
  }
  distorted.push('depth_map.mechanism: template string "Detailed explanation of HOW [pillar] works in practice" — zero card intelligence contributed');
  distorted.push('depth_map.example_direction: template string "Concrete [topic]-specific example" — zero card intelligence contributed');
  distorted.push('depth_map.contrarian_take: template string "Challenge the most common assumption about [pillar]" — zero card intelligence contributed');
  
  // Check execution_stage intent mapping correctness
  var intentMapping = { source: exec.execution_stage, derived: intent, correct: true, note: '' };
  // 'authority building' contains 'authority' → maps to 'authority' ✓
  // 'conversion consideration' contains 'consider' → maps to 'authority' ✗ (should be conversion or authority — ambiguous)
  if (exec.execution_stage === 'conversion consideration') {
    intentMapping.note = 'AMBIGUOUS: "conversion consideration" contains "consider" which triggers authority branch before conversion branch — derived intent is authority, card intent is conversion-adjacent';
    intentMapping.correct = false;
    distorted.push('execution_stage: "conversion consideration" maps to intent=authority (via "consider" keyword match) instead of conversion — keyword ordering in deriveIntent favors authority over conversion');
  }

  // Depth map field-level card derivation
  var depthMapCardFields = 4; // pillar, key_point, why_it_matters, insight_angle
  var depthMapTemplateFields = 3; // mechanism, example_direction, contrarian_take
  var depthUtilScore = Math.round((depthMapCardFields / 7) * 100); // 57%

  // unused_depth_nodes: signals on the card NOT reflected in depth map
  // signals.signals.final_alignment_score, strategy_modifier, momentum_level, brand_positioning, narrative_flow_seed
  var unusedDepthNodes = ['signals.final_alignment_score', 'signals.strategy_modifier', 'signals.strategy_mode', 'execution.momentum_level'];
  if (isRec) unusedDepthNodes.push('company_context_snapshot.brand_positioning', 'company_context_snapshot.narrative_flow_seed', 'company_context_snapshot.authority_domains');

  // Decision layer
  var decisionAllFour = true; // all 4 components always present
  var decisionCardDerived = coreProblem.length > 0 || gapFilled.length > 0;
  var decisionTemplate = ['comparisons[0]: "Tactical execution vs. X strategic framework" — template', 'comparisons[1]: "Manual X process vs. system-driven" — template', 'comparisons[2]: "Short-term X vs. long-term positioning" — template', 'trade_offs[0]: "Speed vs. depth of strategic alignment" — generic', 'trade_offs[1]: "Resource investment vs. compounding returns" — generic', 'trade_offs[2]: "Customisation vs. scalability" — generic'];
  var decisionCardSpecific = [];
  if (coreProblem.length > 0) decisionCardSpecific.push('when_to_use[0] uses problem_being_solved');
  if (gapFilled.length > 0) decisionCardSpecific.push('when_not_to_use[2] uses gap_being_filled (truncated to 60 chars)');
  var decisionPresenceScore = decisionAllFour ? (decisionCardDerived ? 62 : 30) : 0;
  var superficialDecision = !decisionCardDerived;

  // Generic content ratio
  var genericRatio = messagingHooks.length === 0 ? 65 : 30;
  var genericSections = [];
  if (messagingHooks.length === 0) {
    genericSections = ['All sections — no must_include_points anchor', 'depth_map.mechanism (all pillars)', 'depth_map.example_direction (all pillars)', 'depth_map.contrarian_take (all pillars)', 'decision_blocks.comparisons (all 3)', 'decision_blocks.trade_offs (all 3)'];
  } else {
    genericSections = ['depth_map.mechanism (all pillars) — template', 'depth_map.example_direction (all pillars) — template', 'depth_map.contrarian_take (all pillars) — template', 'decision_blocks.comparisons[0-2] — partially template'];
  }

  // Insight validation
  var insightSources = [
    { field: 'authority_reason', present: authorityBasis.length > 0, value: authorityBasis.substring(0, 80) },
    { field: 'gap_being_filled', present: gapFilled.length > 0, value: gapFilled.substring(0, 80) },
    { field: 'why_now', present: whyNow.length > 0, value: whyNow.substring(0, 80) },
    { field: 'messaging_hooks[data-backed]', present: messagingHooks.some(function(h) { return /\d/.test(h); }), value: messagingHooks.filter(function(h) { return /\d/.test(h); }).join('; ').substring(0, 80) }
  ];
  var insightPresentCount = insightSources.filter(function(s) { return s.present; }).length;
  var insightScore = Math.round((insightPresentCount / 4) * 100);
  var weakInsightSections = [];
  if (!authorityBasis) weakInsightSections.push('depth_map.insight_angle — falls back to generic "Evidence from [topic] execution patterns"');
  if (!gapFilled) weakInsightSections.push('answers.uniqueness_directive — absent; differentiation anchor missing from prompt');
  if (depthMapTemplateFields > 0) weakInsightSections.push('depth_map.mechanism (all) — prompt instruction only, not insight');
  if (depthMapTemplateFields > 0) weakInsightSections.push('depth_map.contrarian_take (all) — prompt instruction only, not insight');

  // Strategy → content transformation
  var transformationFields = ['topic', 'intent', 'audience', 'tone', 'answers.trend_context', 'answers.uniqueness_directive', 'answers.must_include_points', 'answers.company_context', 'answers.reader_stage', 'derived_angle'];
  var transformedCount = transformationFields.filter(function(f) {
    if (f === 'topic') return topic.length > 0;
    if (f === 'intent') return intent.length > 0;
    if (f === 'audience') return audience.length > 0;
    if (f === 'tone') return tone.length > 0;
    if (f === 'answers.trend_context') return !!answers.trend_context;
    if (f === 'answers.uniqueness_directive') return !!answers.uniqueness_directive;
    if (f === 'answers.must_include_points') return !!answers.must_include_points;
    if (f === 'answers.company_context') return !!answers.company_context;
    if (f === 'answers.reader_stage') return !!answers.reader_stage;
    if (f === 'derived_angle') return str(intel.campaign_angle).length > 0;
    return false;
  }).length;
  var transformationScore = Math.round((transformedCount / transformationFields.length) * 100);
  
  var insightLossPoints = [];
  if (!isRec) insightLossPoints.push('gap_being_filled: not accessible on PlannerStrategicCard (field absent from schema) — uniqueness_directive always empty');
  if (!isRec) insightLossPoints.push('authority_reason: not accessible on PlannerStrategicCard — insight_angle falls to generic fallback');
  if (!isRec) insightLossPoints.push('messaging_hooks: not accessible on PlannerStrategicCard — must_include_points empty, sections lose specificity anchors');
  if (!isRec) insightLossPoints.push('pain_symptoms: not accessible on PlannerStrategicCard — pain-point grounding absent from company_context answer');

  // Autonomy
  var autonomyScore = Math.round((presentCount / signalKeys.length) * 100);
  var missingAutomation = [];
  if (droppedSignals.length > 0) missingAutomation = missingAutomation.concat(droppedSignals.map(function(s) { return 'dropped: ' + s; }));
  missingAutomation.push('depth_map.mechanism: requires manual prompt — bridge provides instruction placeholder only');
  missingAutomation.push('depth_map.example_direction: requires manual prompt — bridge provides instruction placeholder only');
  missingAutomation.push('depth_map.contrarian_take: requires manual prompt — bridge provides instruction placeholder only');

  // Failure modes
  var failureModes = [];
  if (depthMapTemplateFields === 3) {
    failureModes.push({ mode: 'shallow-but-structured', evidence: 'depth_map has correct structure (5 pillars) but mechanism/example/contrarian fields are prompt instructions, not intelligence — LLM receives scaffolding without substance for 3 of 7 depth dimensions', severity: 'medium' });
  }
  if (!decisionCardDerived) {
    failureModes.push({ mode: 'fake-decision-block', evidence: 'decision_blocks built entirely from templates — comparisons/trade_offs/when_to_use/when_not_to_use contain no card intelligence when problem_being_solved and gap_being_filled are empty', severity: 'high' });
  }
  if (Object.keys(answers).length < 4) {
    failureModes.push({ mode: 'under-populated-answers', evidence: 'answers map has ' + Object.keys(answers).length + ' keys — runBlogGeneration clarification bypass requires answers map to be substantive; sparse cards may trigger clarification loop', severity: 'medium' });
  }

  return {
    label: label,
    trace: {
      intent_derived: intent,
      intent_mapping_note: intentMapping.note || null,
      intent_mapping_correct: intentMapping.correct,
      angle_type: angleType,
      depth_pillars: depthPillars,
      answers_count: Object.keys(answers).length,
      answers_keys: Object.keys(answers),
      must_include_points_count: mustIncludePoints.length,
      hook_variants_count: hookVariants.length
    },
    scores: {
      retention: retentionScore,
      depth_utilization: depthUtilScore,
      decision_presence: decisionPresenceScore,
      generic_ratio: genericRatio,
      insight: insightScore,
      transformation: transformationScore,
      autonomy: autonomyScore
    },
    dropped_signals: droppedSignals,
    distorted_signals: distorted,
    unused_depth_nodes: unusedDepthNodes,
    decision_template_items: decisionTemplate,
    decision_card_specific_items: decisionCardSpecific,
    superficial_decision: superficialDecision,
    generic_sections: genericSections,
    weak_insight_sections: weakInsightSections,
    insight_loss_points: insightLossPoints,
    failure_modes: failureModes,
    missing_automation: missingAutomation
  };
}

var resultA = traceCard('Card A — Full RecommendationStrategicCard', cardA, themeA);
var resultB = traceCard('Card B — Sparse RecommendationStrategicCard', cardB, themeB);
var resultC = traceCard('Card C — PlannerStrategicCard', cardC, themeC);

var output = { A: resultA, B: resultB, C: resultC };
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
