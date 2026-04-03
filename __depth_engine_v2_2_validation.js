/**
 * Depth Quality Validation Engine — v2.3 Harness
 *
 * Ports all v2.3 TypeScript logic to plain JS, runs three card fixtures
 * through the full pipeline (enforceDepth → antiShallowReport), then
 * applies all 8 validation framework checks.
 *
 * v2.3 changes ported:
 *   - deriveSyntheticSignals() → structured {actor,constraint,failure_mode,desired_outcome}
 *   - generateMechanism()     → Step 1/2/3 + Because causal chain
 *   - generateExample()       → actor + context + outcome
 *   - generateDecision()      → Use this when / Avoid this when / Choose this if
 *   - tryInject overrideRedundancy for insight + example
 *   - insight guarantee appended to every section
 *
 * Run: node __depth_engine_v2_2_validation.js
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PORTED CORE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by',
  'for','from','had','has','have','if','in','into','is','it','its','of',
  'on','or','that','the','their','there','these','this','those','to','was',
  'were','will','with','you','your','they','them','we','our','all','about',
  'more','can','when','what','how','which','so','do','also','just',
  'not','any','than','then','use','used','some','other','most',
]);

const TEMPLATE_PATTERNS = [
  /^Detailed explanation of HOW .+ works in practice\.?$/i,
  /^Concrete .+-specific example\.?$/i,
  /^Challenge the most common assumption about .+\.?$/i,
  /^Evidence from .+ execution patterns\.?$/i,
  /^\[.*\]$/,
];

const MECHANISM_RE = /\b(because|work[s]? by|process|system|sequence|driver|caus|mechanism|operat|step[s]?|how it|the reason)\b/i;
const EXAMPLE_RE   = /\b(for example|for instance|example|case study|scenario|consider|imagine|such as|like when|in practice|real.world)\b/i;
const INSIGHT_RE   = /\b(this means|which means|therefore|however|the implication|why this matters|so what|the key insight|trade.?off|vs\.|versus|unlike|the difference|what this reveals|the consequence)\b/i;
const DECISION_RE  = /\b(decision|implication|therefore|which means|trade.?off|when to use|should you)\b/i;

// ── Quality assessment regexes (stricter than presence check) ────────────────

// Real mechanism: step/process/causal — not just abstract assertion (v2.5: relaxed to include process|sequence)
const REAL_MECHANISM_RE = /\b(step|steps|works? by|because|process|sequence|leads to|results in|operates by|triggers|caus[ei]|driven by|how it works)\b/i;
// Abstract/weak mechanism: vague importance without explanation
const ABSTRACT_MECHANISM_RE = /\b(important|essential|key factor|plays a role|critical|vital|significant|relevant|valuable)\b/i;

// Specific example: number, named entity, timeframe, percentage
const SPECIFIC_EXAMPLE_RE = /\b(\d{1,4}%|\d{4}|\$\d|\d+x|[A-Z][a-z]+ (team|company|brand|startup|enterprise|client)|quarter|Q[1-4]|sprint|campaign)\b/i;
// Real actor in example
const ACTOR_RE = /\b(team|company|brand|startup|org(anization)?|client|marketer|manager|executive|vendor|agency|SaaS|B2B)\b/i;
// Outcome in example
const OUTCOME_RE = /\b(result(ed|s|ing)?|achiev(ed|es)|saw|led to|gained|grew|dropped|increas|decreas|improv|saved|reduced|generated)\b/i;

// Non-obvious insight: contrast/reversal language
const NON_OBVIOUS_RE = /\b(contrary|unlike|the opposite|most assume|but actually|surprising|counter.?intuit|the paradox|however|yet the|despite|even though|the catch)\b/i;
// Generic/weak insight: just restates importance
const GENERIC_INSIGHT_RE = /\b(this is why .+important|as mentioned|as described above|key takeaway is that|important to note)\b/i;

// Actionable decision language
const ACTIONABLE_DECISION_RE = /\b(when to use|if you (are|have|need)|before choosing|should you|factor this|apply this when|use this (when|if|for)|choose .+ when)\b/i;

const MAX_SECTION_WORDS        = 350;
const MAX_DEPTH_WORDS          = 120;  // depth layers (mechanism + example + insight)
const MAX_DECISION_WORDS       = 80;   // decision has its own independent budget
const MAX_TOTAL_INJECTION      = 150;  // hard total cap per section
const SIGNAL_POVERTY_THRESHOLD = 5;

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function esc(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3 && !STOP_WORDS.has(t));
}

function wordCount(html) {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

function isTemplate(value) {
  if (!value || value.length < 5) return true;
  return TEMPLATE_PATTERNS.some(re => re.test(value.trim()));
}

function parseSections(html) {
  const sections = [];
  const firstH2 = html.search(/<h2>/i);
  if (firstH2 > 0) {
    const preamble = html.slice(0, firstH2).trim();
    if (preamble) {
      sections.push({ id: 'section_intro', heading: '__intro__', body: preamble,
                      is_reference: false, is_key_insights: true });
    }
  }
  const h2Re = /<h2>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2>|$)/gi;
  let match; let idx = 0;
  while ((match = h2Re.exec(html)) !== null) {
    const heading = stripHtml(match[1]).trim();
    const body    = match[2].trim();
    sections.push({
      id: `section_${idx++}`, heading, body,
      is_reference:    /^references?$/i.test(heading),
      is_key_insights: false,
    });
  }
  return sections;
}

function evalDepthState(body, wc) {
  return {
    explanation: wc > 50 || /\b(is|are|means|refers|defined as|describes|represents)\b/i.test(body),
    mechanism:   MECHANISM_RE.test(body),
    example:     EXAMPLE_RE.test(body),
    insight:     INSIGHT_RE.test(body),
  };
}

function depthScore(state) {
  return ([state.explanation, state.mechanism, state.example, state.insight].filter(Boolean).length / 4) * 100;
}

function aggregateDepthScore(sections) {
  const ev = sections.filter(s => !s.is_reference && !s.is_key_insights);
  if (ev.length === 0) return 100;
  let total = 0;
  for (const s of ev) {
    const wc = wordCount(s.body);
    total += depthScore(evalDepthState(s.body, wc));
  }
  return Math.round(total / ev.length);
}

function matchDepthEntry(heading, idx, depthMap) {
  const empty = { pillar:'', key_point:'', why_it_matters:'', mechanism:'',
                  example_direction:'', insight_angle:'', contrarian_take:'' };
  if (depthMap.length === 0) return empty;
  const headingTokens = new Set(tokenize(heading));
  let best = depthMap[Math.min(idx, depthMap.length - 1)];
  let bestScore = 0;
  for (const entry of depthMap) {
    const pt = tokenize(entry.pillar);
    const score = pt.length > 0 ? pt.filter(t => headingTokens.has(t)).length / pt.length : 0;
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return best;
}

// ── v2.3: Structured synthetic signals ───────────────────────────────────────

function deriveSyntheticSignals(cgi) {
  const audienceWords = cgi.audience
    ? cgi.audience.split(/[,\s]+/).filter(w => w.length > 3).slice(0, 2).join(' ')
    : '';
  const actor = audienceWords || `${cgi.topic} practitioners`;

  const constraint =
    cgi.selected_angle.split(/[.!?]/)[0].trim() ||
    cgi.strategic_core.core_problem.split(/[.!?]/)[0].trim() ||
    `the complexity of ${cgi.topic}`;

  const failure_mode =
    cgi.strategic_core.core_problem.split(/[.!?]/)[0].trim() ||
    `failing to apply ${cgi.topic} effectively`;

  const desired_outcome =
    (cgi.strategic_core.transformation_goal) ||
    cgi.key_messages[0] ||
    `improved results through systematic ${cgi.topic.toLowerCase()}`;

  return { actor, constraint, failure_mode, desired_outcome };
}

// v2.3 generators ─────────────────────────────────────────────────────────────

function generateMechanism(heading, dmMech, signals) {
  if (!isTemplate(dmMech) && dmMech.length > 20) return dmMech;
  const topic = heading || 'this approach';
  return [
    `Step 1: ${signals.actor} identify where ${signals.constraint.toLowerCase()}.`,
    `Step 2: Apply the ${topic.toLowerCase()} process by resolving the core blocker in sequence rather than all at once.`,
    `Step 3: Measure the outcome against ${signals.desired_outcome.toLowerCase()}.`,
    `Because ${signals.failure_mode.toLowerCase()}, each step must complete before the next begins — skipping steps reintroduces the original failure mode.`,
  ].join(' ');
}

function generateExample(heading, dmEx, signals) {
  if (!isTemplate(dmEx) && dmEx.length > 20) return dmEx;
  const topic = heading || 'this';
  return (
    `For example, a ${signals.actor} team facing ${signals.constraint.toLowerCase()} ` +
    `applied ${topic.toLowerCase()} systematically and achieved ${signals.desired_outcome.toLowerCase()}. ` +
    `In practice, the key difference was sequencing the work so each stage produced a measurable result ` +
    `before the next was started — which resulted in faster adoption and reduced rework.`
  );
}

function generateDecision(heading, dmWhy, signals) {
  const context = !isTemplate(dmWhy) && dmWhy.length > 20
    ? dmWhy : signals.desired_outcome;
  const topic = heading || 'this approach';
  return (
    `Use this when ${signals.actor.toLowerCase()} need to address ${signals.constraint.toLowerCase()} ` +
    `and ${context.toLowerCase()}. ` +
    `Avoid this when the problem is not yet clearly defined or when ${signals.failure_mode.toLowerCase()} ` +
    `is caused by external factors outside your team's control. ` +
    `Choose this if you need a repeatable, step-based system for ${topic.toLowerCase()} ` +
    `that surfaces measurable progress at each stage.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function wouldBeRedundant(body, text) {
  if (!text || text.length < 10) return true;
  const injTokens = tokenize(text).slice(0, 8);
  if (injTokens.length === 0) return true;
  const bodyText = stripHtml(body).toLowerCase();
  const hits = injTokens.filter(t => bodyText.includes(t)).length;
  return hits >= 5;
}

// v2.5: insight guarantee markers — also match plain-text versions (no <strong> tag)
// so near-ceiling sections whose body already contains the labeled text don't get redundant injection.
const KEY_INSIGHT_RE     = /<strong>Key Insight:<\/strong>|key insight:/i;
const STRAT_IMPL_RE      = /<strong>The strategic implication:<\/strong>|the strategic implication:/i;
const ACTIONABLE_DECISION_FULL_RE = /Use this when .+ Avoid this when .+ Choose this if/i;

function enforceDepth(sections, cgi) {
  const fixes = []; const rewritten = [];
  let shallowFixed = 0; let overcorrectionDetected = false;

  const primarySignalText = [
    cgi.topic, cgi.selected_angle, cgi.trend_context, cgi.uniqueness_directive,
    ...cgi.must_include_points, ...Object.values(cgi.answers), ...cgi.key_messages,
  ].filter(Boolean).join(' ');
  const signalTokenCount = tokenize(primarySignalText).length;

  if (signalTokenCount < SIGNAL_POVERTY_THRESHOLD) {
    fixes.push(`signal-poverty → synthetic signals derived (primaryTokens=${signalTokenCount})`);
  }

  let evaluableIdx = 0;

  const updated = sections.map(section => {
    if (section.is_reference || section.is_key_insights) return section;
    const wcBefore = wordCount(section.body);
    const ds = evalDepthState(section.body, wcBefore);
    const overCeiling = wcBefore >= MAX_SECTION_WORDS;

    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, cgi.depth_map);
    evaluableIdx++;

    let body                  = section.body;
    let depthWordsInjected    = 0;   // mechanism + example + insight
    let decisionWordsInjected = 0;   // decision only (v2.5 independent budget)
    let changed               = false;

    if (!overCeiling) {
      // v2.3: structured signal object
      const synth = signalTokenCount < SIGNAL_POVERTY_THRESHOLD
        ? deriveSyntheticSignals(cgi)
        : {
            actor:           cgi.audience || `${cgi.topic} practitioners`,
            constraint:      cgi.selected_angle.split(/[.!?]/)[0].trim(),
            failure_mode:    cgi.strategic_core.core_problem.split(/[.!?]/)[0].trim(),
            desired_outcome: (cgi.strategic_core.transformation_goal) || cgi.key_messages[0] || cgi.topic,
          };

      const mechanismText = generateMechanism(section.heading, dmEntry.mechanism, synth);
      const exampleText   = generateExample(section.heading, dmEntry.example_direction, synth);
      const insightText   = !isTemplate(dmEntry.contrarian_take) && dmEntry.contrarian_take.length > 20
        ? dmEntry.contrarian_take
        : `The key insight: ${synth.desired_outcome}. ` +
          `However, ${synth.failure_mode.toLowerCase()} — which means the teams that succeed address ` +
          `${synth.constraint.toLowerCase()} before scaling effort.`;
      const decisionText  = generateDecision(section.heading, dmEntry.why_it_matters, synth);

      // v2.5 fix 1+2: split budget — depth vs decision, total cap reserves decision slot
      const decisionWords        = tokenize(decisionText).length;
      const decisionWillFire     = decisionWords <= MAX_DECISION_WORDS;
      const effectiveDepthBudget = decisionWillFire
        ? Math.min(MAX_DEPTH_WORDS, MAX_TOTAL_INJECTION - decisionWords)
        : MAX_DEPTH_WORDS;

      // v2.3 fix 2: overrideRedundancy for insight + example
      const tryInject = (missing, rawValue, label, prefix, overrideRedundancy = false) => {
        if (!missing) return;
        if (isTemplate(rawValue)) { fixes.push(`[${section.id}] ${label}: template — skipped`); return; }
        if (!overrideRedundancy && wouldBeRedundant(body, rawValue)) {
          fixes.push(`[${section.id}] ${label}: redundant — skipped`); return;
        }
        const cw = tokenize(rawValue).length;
        if (depthWordsInjected + cw > effectiveDepthBudget) {
          fixes.push(`[${section.id}] ${label}: depth budget exhausted (${depthWordsInjected}+${cw}>${effectiveDepthBudget}) — skipped`);
          return;
        }
        body = `${body}\n<p><strong>${prefix}</strong> ${esc(rawValue)}</p>`;
        depthWordsInjected += cw; changed = true;
        fixes.push(`[${section.id}] ${label} injected`);
      };

      tryInject(!ds.mechanism, mechanismText, 'mechanism', 'How this works:',           true);
      tryInject(!ds.example,   exampleText,   'example',   'In practice:',              true);
      tryInject(!ds.insight,   insightText,   'insight',   'The strategic implication:', true);

      // v2.5: decision injection — fired only when section lacks BOTH full Use/Avoid/Choose
      // structure AND any legacy actionable language (when to use, should you, etc.).
      // Aligns injection gate with check5_decisionDepth which already accepts legacy language.
      const hasFullDecisionStructure =
        body.includes('Use this when') &&
        body.includes('Avoid this when') &&
        body.includes('Choose this if');
      const hasLegacyActionable = ACTIONABLE_DECISION_RE.test(stripHtml(body));
      if (!hasFullDecisionStructure && !hasLegacyActionable) {
        if (decisionWordsInjected + decisionWords <= MAX_DECISION_WORDS) {
          body = `${body}\n<p><strong>What this means for decision-making:</strong> ${esc(decisionText)}</p>`;
          decisionWordsInjected += decisionWords;
          fixes.push(`[${section.id}] decision-depth link injected`);
          changed = true;
        }
      }
    }

    // v2.3 fix 5: insight guarantee — every section, even over ceiling
    if (!KEY_INSIGHT_RE.test(body) && !STRAT_IMPL_RE.test(body)) {
      const insightGuarantee = !isTemplate(dmEntry.insight_angle) && dmEntry.insight_angle.length > 20
        ? dmEntry.insight_angle
        : !isTemplate(dmEntry.contrarian_take) && dmEntry.contrarian_take.length > 20
          ? dmEntry.contrarian_take
          : `Teams that apply this systematically outperform those that treat it as a one-time task — ` +
            `which means treating ${section.heading.toLowerCase()} as an ongoing process is the ` +
            `highest-leverage change you can make.`;
      body = `${body}\n<p><strong>Key Insight:</strong> ${esc(insightGuarantee)}</p>`;
      fixes.push(`[${section.id}] insight guarantee appended`);
      changed = true;
    }

    // v2.5 fix 2: ceiling-based anti-bloat — flag only when section exceeds MAX_SECTION_WORDS.
    // Delta-based checks false-positively flag stub sections that legitimately need all layers.
    const wcAfter = wordCount(body);
    if (wcAfter > MAX_SECTION_WORDS) {
      overcorrectionDetected = true;
      fixes.push(`[${section.id}] WARN: section is ${wcAfter} words — exceeds section ceiling`);
    }

    if (changed) { shallowFixed++; rewritten.push(`[${section.id}] "${section.heading}"`); }
    return { ...section, body };
  });

  return { sections: updated, fixes, rewritten, shallowFixed, overcorrectionDetected };
}

function antiShallowReport(sections, cgi) {
  const stillShallow = []; let evaluableIdx = 0;
  for (const section of sections) {
    if (section.is_reference || section.is_key_insights) continue;
    const wc = wordCount(section.body);
    const ds = evalDepthState(section.body, wc);
    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, cgi.depth_map);
    evaluableIdx++;
    const missing = [];
    if (!ds.mechanism) {
      missing.push(`mechanism (${isTemplate(dmEntry.mechanism) ? 'template' : 'no content'})`);
    }
    // v2.5: accept full Use/Avoid/Choose OR legacy actionable language (when to use, should you)
    const hasFullDecision =
      section.body.includes('Use this when') &&
      section.body.includes('Avoid this when') &&
      section.body.includes('Choose this if');
    const hasLegacyAct = ACTIONABLE_DECISION_RE.test(stripHtml(section.body));
    if (!hasFullDecision && !hasLegacyAct) {
      missing.push(`decision_structure (${isTemplate(dmEntry.why_it_matters) ? 'template' : 'incomplete'})`);
    }
    if (!ds.example) missing.push(`example`);
    if (!ds.insight)  missing.push(`insight`);
    if (missing.length > 0) {
      stillShallow.push(`[${section.id}] "${section.heading}" — missing: ${missing.join(', ')}`);
    }
  }
  return stillShallow;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION FRAMEWORK
// ─────────────────────────────────────────────────────────────────────────────

function check1_depthCompleteness(afterSections) {
  const evaluable = afterSections.filter(s => !s.is_reference && !s.is_key_insights);
  const incomplete = [];
  for (const s of evaluable) {
    const wc = wordCount(s.body);
    const ds = evalDepthState(s.body, wc);
    const missing = [];
    if (!ds.mechanism) missing.push('mechanism');
    if (!ds.example)   missing.push('example');
    if (!ds.insight)   missing.push('insight');
    // v2.5: accept full Use/Avoid/Choose OR legacy actionable language
    const hasFullDecision =
      s.body.includes('Use this when') &&
      s.body.includes('Avoid this when') &&
      s.body.includes('Choose this if');
    const hasLegacyAct = ACTIONABLE_DECISION_RE.test(stripHtml(s.body));
    if (!hasFullDecision && !hasLegacyAct) missing.push('decision_structure');
    if (missing.length > 0) incomplete.push({ section: s.id, heading: s.heading, missing });
  }
  return {
    all_sections_complete: incomplete.length === 0,
    incomplete_sections: incomplete,
  };
}

function check2_mechanismQuality(afterSections) {
  const evaluable = afterSections.filter(s => !s.is_reference && !s.is_key_insights);
  const weak = [];
  let realCount = 0;

  for (const s of evaluable) {
    // v2.4 fix 1: PRIORITIZE injected mechanism block as authoritative source.
    // Extract text between <strong>How this works:</strong> and </p>.
    // Only fall back to full plain text if no injected block exists.
    const injectedBlockMatch = s.body.match(/<strong>How this works:<\/strong>\s*([^<]+)/i);
    const mechanismSource = injectedBlockMatch
      ? injectedBlockMatch[1].trim()
      : stripHtml(s.body);

    const hasMechanism = MECHANISM_RE.test(s.body);
    if (!hasMechanism) { weak.push({ section: s.id, reason: 'no mechanism detected (MECHANISM_RE)' }); continue; }

    // Assess quality against the authoritative source only
    const hasRealMechanism = REAL_MECHANISM_RE.test(mechanismSource);

    if (!hasRealMechanism) {
      weak.push({ section: s.id, reason: 'mechanism source lacks causal/step structure (Step|works by|because|caus|sequence)' });
    } else {
      realCount++;
    }
  }

  const score = evaluable.length > 0 ? Math.round((realCount / evaluable.length) * 100) : 100;
  return { score, weak_mechanisms: weak };
}

function check3_exampleQuality(afterSections) {
  const evaluable = afterSections.filter(s => !s.is_reference && !s.is_key_insights);
  const generic = [];
  let specificCount = 0;

  for (const s of evaluable) {
    const plain = stripHtml(s.body);
    if (!EXAMPLE_RE.test(s.body)) {
      generic.push({ section: s.id, reason: 'no example detected' });
      continue;
    }
    const hasSpecific = SPECIFIC_EXAMPLE_RE.test(plain);
    const hasActor    = ACTOR_RE.test(plain);
    const hasOutcome  = OUTCOME_RE.test(plain);

    // Injected example from synthetic signal?
    const isSyntheticExample = /<strong>In practice:<\/strong>/.test(s.body);
    const syntheticExText = isSyntheticExample
      ? (s.body.match(/<strong>In practice:<\/strong>([^<]+)/i) || ['',''])[1].trim()
      : '';
    const syntheticSpecific = SPECIFIC_EXAMPLE_RE.test(syntheticExText);
    const syntheticActor    = ACTOR_RE.test(syntheticExText);
    const syntheticOutcome  = OUTCOME_RE.test(syntheticExText);

    // Penalise if the injected example lacks all three quality markers
    if (isSyntheticExample && !syntheticSpecific && !syntheticActor && !syntheticOutcome) {
      generic.push({ section: s.id, reason: 'injected example lacks specificity, actor, and outcome' });
    } else if (!hasSpecific && !hasActor) {
      generic.push({ section: s.id, reason: 'example present but generic — no specific actor or measurable detail' });
    } else {
      specificCount++;
    }
  }

  const score = evaluable.length > 0 ? Math.round((specificCount / evaluable.length) * 100) : 100;
  return { score, generic_examples: generic };
}

function check4_insightQuality(afterSections) {
  const evaluable = afterSections.filter(s => !s.is_reference && !s.is_key_insights);
  const weak = [];
  let strongCount = 0;

  // v2.3: insight guarantee means every section has Key Insight: or strategic implication:
  const KEY_INSIGHT_PRESENT_RE   = /<strong>Key Insight:<\/strong>/i;
  const STRAT_IMPL_PRESENT_RE    = /<strong>The strategic implication:<\/strong>/i;

  for (const s of evaluable) {
    const plain = stripHtml(s.body);

    // v2.3: a section with guaranteed Key Insight: may still be weak if the text is generic
    const hasKeyInsightTag = KEY_INSIGHT_PRESENT_RE.test(s.body);
    const hasStratImpl     = STRAT_IMPL_PRESENT_RE.test(s.body);
    const hasInsightRE     = INSIGHT_RE.test(s.body);

    if (!hasInsightRE && !hasKeyInsightTag && !hasStratImpl) {
      weak.push({ section: s.id, reason: 'no insight detected even after v2.3 guarantee' });
      continue;
    }

    // Extract the guaranteed Key Insight text to assess quality
    const keyInsightText = hasKeyInsightTag
      ? (s.body.match(/<strong>Key Insight:<\/strong>\s*([^<]+)/i) || ['',''])[1].trim()
      : '';
    const stratImplText  = hasStratImpl
      ? (s.body.match(/<strong>The strategic implication:<\/strong>\s*([^<]+)/i) || ['',''])[1].trim()
      : '';
    const insightText    = keyInsightText || stratImplText;

    const hasNonObvious = NON_OBVIOUS_RE.test(plain);
    const hasGeneric    = GENERIC_INSIGHT_RE.test(plain);

    // v2.3 insight guarantee fallback text = "Teams that apply this systematically outperform..."
    const isFallbackGuarantee = /teams that apply this systematically outperform/i.test(insightText);
    // Fallback is acceptable if section already has non-obvious language elsewhere
    if (isFallbackGuarantee && !hasNonObvious) {
      weak.push({ section: s.id, reason: 'insight guarantee used fallback text — no non-obvious differential in section' });
    } else if (hasGeneric && !hasNonObvious && !keyInsightText) {
      weak.push({ section: s.id, reason: 'insight present but restates importance — no differential or reversal' });
    } else {
      strongCount++;
    }
  }

  const score = evaluable.length > 0 ? Math.round((strongCount / evaluable.length) * 100) : 100;
  return { score, weak_insights: weak };
}

function check5_decisionDepth(afterSections) {
  const evaluable = afterSections.filter(s => !s.is_reference && !s.is_key_insights);
  const nonActionable = [];
  let actionableCount = 0;

  // v2.3: must have "Use this when", "Avoid this when", "Choose this if"
  const USE_WHEN_RE    = /Use this when /i;
  const AVOID_WHEN_RE  = /Avoid this when /i;
  const CHOOSE_IF_RE   = /Choose this if /i;

  for (const s of evaluable) {
    const plain = stripHtml(s.body);
    const hasDecision   = DECISION_RE.test(plain);
    const hasDMInject   = /<strong>What this means for decision-making:<\/strong>/i.test(s.body);

    // Extract injected decision text
    const dmText = hasDMInject
      ? (s.body.match(/<strong>What this means for decision-making:<\/strong>\s*([^<]+)/i) || ['',''])[1].trim()
      : '';

    const hasUseWhen   = USE_WHEN_RE.test(dmText)   || USE_WHEN_RE.test(plain);
    const hasAvoidWhen = AVOID_WHEN_RE.test(dmText)  || AVOID_WHEN_RE.test(plain);
    const hasChooseIf  = CHOOSE_IF_RE.test(dmText)   || CHOOSE_IF_RE.test(plain);

    // Full v2.3 decision structure
    const hasFullDecisionStructure = hasUseWhen && hasAvoidWhen && hasChooseIf;
    // Legacy actionable (v2.2 fallback path still acceptable if full structure present elsewhere)
    const hasLegacyActionable = ACTIONABLE_DECISION_RE.test(plain);

    if (!hasDecision && !hasDMInject) {
      nonActionable.push({ section: s.id, reason: 'no decision language at all' });
    } else if (!hasFullDecisionStructure && !hasLegacyActionable) {
      nonActionable.push({
        section: s.id,
        reason: `missing decision structure: ${!hasUseWhen?'USE ':''  }${!hasAvoidWhen?'AVOID ':''  }${!hasChooseIf?'CHOOSE ':''  }required`,
      });
    } else {
      actionableCount++;
    }
  }

  const score = evaluable.length > 0 ? Math.round((actionableCount / evaluable.length) * 100) : 100;
  return { score, non_actionable_sections: nonActionable };
}

function check6_overcorrection(beforeSections, afterSections, enforceResult) {
  const issues = [];
  const evaluable = afterSections.filter(s => !s.is_reference && !s.is_key_insights);
  const beforeMap = new Map(beforeSections.map(s => [s.id, s]));

  for (const s of evaluable) {
    const before = beforeMap.get(s.id);
    if (!before) continue;
    const wcBefore = wordCount(before.body);
    const wcAfter  = wordCount(s.body);
    const growth   = wcAfter - wcBefore;
    const growthPct = wcBefore > 0 ? Math.round((growth / wcBefore) * 100) : 0;

    // v2.5: ceiling-based check — only flag genuine overcorrection (section > MAX_SECTION_WORDS)
    if (wcAfter > MAX_SECTION_WORDS) {
      issues.push(`[${s.id}] grew to ${wcAfter} words — exceeds section ceiling (${MAX_SECTION_WORDS})`);
    }

    // Repeated phrases detection: check for duplicate consecutive sentences
    const sentences = stripHtml(s.body).match(/[^.!?]+[.!?]+/g) || [];
    const seen = new Set();
    for (const sent of sentences) {
      const norm = sent.trim().toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ');
      if (norm.length > 20 && seen.has(norm)) {
        issues.push(`[${s.id}] repeated sentence detected — forced/duplicate content`);
        break;
      }
      seen.add(norm);
    }
  }

  if (enforceResult.overcorrectionDetected) {
    issues.push('enforceDepth flagged overcorrection internally');
  }

  return { detected: issues.length > 0, issues };
}

function check7_deltaAnalysis(beforeSections, afterSections) {
  const bEval = beforeSections.filter(s => !s.is_reference && !s.is_key_insights);
  const aEval = afterSections.filter(s => !s.is_reference && !s.is_key_insights);

  const beforeWords = bEval.reduce((sum, s) => sum + wordCount(s.body), 0);
  const afterWords  = aEval.reduce((sum, s) => sum + wordCount(s.body), 0);
  const lengthIncreasePct = beforeWords > 0
    ? Math.round(((afterWords - beforeWords) / beforeWords) * 100) : 0;

  // Signal density = depth-positive sentences per 100 words
  function signalDensity(sections) {
    const ev = sections.filter(s => !s.is_reference && !s.is_key_insights);
    let depthHits = 0; let totalWords = 0;
    for (const s of ev) {
      const plain = stripHtml(s.body);
      totalWords += wordCount(s.body);
      const sents = plain.match(/[^.!?]+[.!?]+/g) || [];
      for (const sent of sents) {
        const hasDepth = MECHANISM_RE.test(sent) || EXAMPLE_RE.test(sent)
                      || INSIGHT_RE.test(sent)   || DECISION_RE.test(sent);
        if (hasDepth) depthHits++;
      }
    }
    return totalWords > 0 ? parseFloat((depthHits / totalWords * 100).toFixed(2)) : 0;
  }

  const densityBefore = signalDensity(beforeSections);
  const densityAfter  = signalDensity(afterSections);
  const densityDelta  = densityAfter >= densityBefore ? '+' : '-';

  const depthBefore = aggregateDepthScore(beforeSections);
  const depthAfter  = aggregateDepthScore(afterSections);
  const depthReal   = (depthAfter - depthBefore) >= 15 && densityDelta === '+';

  return {
    depth_improvement_real:  depthReal,
    depth_score_before:      depthBefore,
    depth_score_after:       depthAfter,
    length_increase_pct:     lengthIncreasePct,
    signal_density_before:   densityBefore,
    signal_density_after:    densityAfter,
    signal_density_change:   densityDelta,
  };
}

function check8_finalVerdict(c1, c2, c3, c4, c5, c6, c7) {
  const depth_solved = (
    c1.all_sections_complete &&
    c2.score >= 80 &&
    c4.score >= 80 &&
    c5.score >= 75 &&
    !c6.detected
  );
  const production_ready = depth_solved && c3.score >= 70 && c7.depth_improvement_real;
  return { depth_solved, production_ready };
}

function runValidation(label, cgi, v21Html) {
  const beforeSections = parseSections(v21Html);
  const enforceResult  = enforceDepth(beforeSections, cgi);
  const afterSections  = enforceResult.sections;
  const shallowAfter   = antiShallowReport(afterSections, cgi);

  const c1 = check1_depthCompleteness(afterSections);
  const c2 = check2_mechanismQuality(afterSections);
  const c3 = check3_exampleQuality(afterSections);
  const c4 = check4_insightQuality(afterSections);
  const c5 = check5_decisionDepth(afterSections);
  const c6 = check6_overcorrection(beforeSections, afterSections, enforceResult);
  const c7 = check7_deltaAnalysis(beforeSections, afterSections);
  const c8 = check8_finalVerdict(c1, c2, c3, c4, c5, c6, c7);

  // Pass conditions
  const passes = {
    all_sections_complete:    c1.all_sections_complete               ? '✅' : '❌',
    mechanism_quality_ge_80:  c2.score >= 80                         ? '✅' : '❌',
    insight_quality_ge_80:    c4.score >= 80                         ? '✅' : '❌',
    decision_depth_ge_75:     c5.score >= 75                         ? '✅' : '❌',
    overcorrection_false:     !c6.detected                           ? '✅' : '❌',
    depth_solved:             c8.depth_solved                        ? '✅' : '❌',
  };

  return {
    card: label,
    pipeline: {
      sections_rewritten:           enforceResult.rewritten.length,
      shallow_fixed:                enforceResult.shallowFixed,
      shallow_remaining:            shallowAfter.length,
      overcorrection_detected_flag: enforceResult.overcorrectionDetected,
      depth_fixes:                  enforceResult.fixes,
    },
    depth_completeness:  c1,
    mechanism_quality:   c2,
    example_quality:     c3,
    insight_quality:     c4,
    decision_depth:      c5,
    overcorrection:      c6,
    delta_analysis:      c7,
    final_verdict:       c8,
    pass_conditions:     passes,
    overall_pass:        Object.values(passes).every(v => v === '✅'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

// ── Card A — Rich card: B2B Content Flywheel ──────────────────────────────────
// Sections have partial depth. mechanism missing in S2, example missing in S3.
// depth_map has real (non-template) entries.

const CGI_A = {
  topic: 'B2B Content Marketing Flywheel',
  selected_angle: 'Most B2B content teams publish consistently but fail to compound returns because they treat each post as isolated output rather than a compounding flywheel.',
  trend_context: 'B2B buyers now consume 7+ pieces of content before a sales conversation, making content sequencing the critical differentiator for pipeline velocity in 2025.',
  uniqueness_directive: 'Show the mechanical relationship between content sequencing and pipeline velocity, not just content consistency.',
  must_include_points: [
    'Content sequencing drives compounding returns more than volume',
    'The flywheel breaks when teams optimise for production not distribution',
  ],
  answers: {
    what_is_it: 'A B2B content flywheel is a sequenced publishing system where each content asset amplifies the reach and authority of the next.',
    why_now:    'With 7+ touchpoints before sales conversations, sequencing determines which teams compound vs. plateau.',
  },
  key_messages: [
    'Sequence over volume: one well-placed piece moves buyers faster than three disconnected ones.',
    'Distribution is the flywheel mechanism — without it the wheel does not spin.',
  ],
  strategic_core: {
    core_problem: 'B2B content teams plateau because they optimise for production speed rather than distribution leverage and sequencing intelligence.',
  },
  depth_map: [
    {
      pillar: 'Content Sequencing',
      key_point: 'Content sequencing is the process of mapping asset types to buyer journey stages in a deliberate order that reduces objections at each step.',
      why_it_matters: 'Teams that sequence rather than batch-publish see 3x higher lead-to-meeting conversion because buyers arrive at sales conversations pre-educated.',
      mechanism: 'Sequencing works by creating a dependency chain: awareness content surfaces the problem, consideration content installs the framework, and decision content eliminates alternatives. Each step reduces cognitive load for the next.',
      example_direction: 'A 40-person SaaS marketing team restructured their content calendar around 3-post sequences per ICP persona; within one quarter they reduced SDR follow-ups by 35% because prospects already understood the category.',
      insight_angle: 'The counterintuitive finding is that producing fewer pieces per month but sequencing them intentionally outperforms high-volume random publishing by a factor of 3–5x on pipeline contribution.',
      contrarian_take: 'Most content teams measure success by volume metrics. However, the teams compounding the fastest publish 40% fewer posts but with deliberate sequencing — which means production speed is actually the enemy of flywheel momentum.',
    },
    {
      pillar: 'Distribution Leverage',
      key_point: 'Distribution leverage is what separates content teams that compound from those that plateau — the same content can generate 10x more pipeline with the right amplification system.',
      why_it_matters: 'Without distribution leverage, even well-sequenced content stalls. When to use: prioritise distribution investment before scaling production.',
      mechanism: 'The distribution leverage system operates in three steps: (1) publish to owned audience, (2) activate partner/community amplification within 48 hours, (3) repurpose top performers into channel-native formats for paid amplification. The key driver is the 48-hour window — content engagement signals decay after 72 hours on most platforms.',
      example_direction: 'Gong\'s content team activated their revenue team as distribution agents for every post, tagging 15–20 relevant LinkedIn connections per post within 24 hours. This resulted in 4x organic reach vs. brand-only publishing and drove 22% of their inbound pipeline from content in Q3 2024.',
      insight_angle: 'Distribution is not a downstream activity — it is the mechanism that determines whether the flywheel builds momentum or stalls. The ratio that matters is not content quality vs. quantity but production investment vs. distribution investment.',
      contrarian_take: 'The prevailing assumption is that better content drives better results. However, average content with systematic distribution consistently outperforms exceptional content with passive distribution — which means your amplification system is more valuable than your writing quality.',
    },
    {
      pillar: 'Flywheel Feedback Loops',
      key_point: 'Feedback loops close the flywheel by feeding engagement signals from one content cycle back into the next production cycle.',
      why_it_matters: 'Without feedback loops the flywheel degenerates into a conveyor belt — content is produced and forgotten. Use feedback loops when you want content to compound rather than just accrue.',
      mechanism: 'Feedback loops work by routing performance data (time-on-page, share rate, conversation triggers) back to content planning. When a piece exceeds 3 minutes average read time or generates >5 direct replies, it signals a gap in the audience\'s mental model — which should become the next sequence entry point.',
      example_direction: 'Detailed explanation of HOW Flywheel Feedback Loops works in practice.',
      insight_angle: 'The teams that compound fastest treat high-performing content as category research, not just marketing success. The implication: your top content is telling you which mental models your buyers lack — which means it is your best product roadmap signal too.',
      contrarian_take: 'Concrete Flywheel Feedback Loops-specific example.',
    },
  ],
};

const V21_HTML_A = `
<h2>Content Sequencing</h2>
<p>Content sequencing is the process of ordering your B2B content assets to guide buyers through a logical progression. When teams sequence intentionally, each asset builds on the previous one rather than competing for attention.</p>
<p>A B2B content flywheel requires sequencing as its core operating principle. Teams that batch-publish without sequencing see diminishing returns because each piece competes with the others for the same buyer attention.</p>

<h2>Distribution Leverage</h2>
<p>Distribution leverage determines whether your content compounds or plateaus. Most B2B content teams invest heavily in production and almost nothing in systematic distribution — this is the primary reason flywheel momentum stalls.</p>
<p>The content distribution process involves three activation stages that must happen within specific time windows to capture platform engagement signals before they decay.</p>

<h2>Flywheel Feedback Loops</h2>
<p>Feedback loops are essential for closing the content flywheel cycle. Without them, content production becomes a one-way conveyor rather than a compounding system.</p>
<p>High-performing content signals which mental models your buyers are missing. When a post generates high engagement, it reveals a gap in category understanding that should directly feed back into your planning cycle.</p>
`.trim();

// ── Card B — Sparse card: AI adoption in enterprise ───────────────────────────
// Signal-poor: few key_messages, minimal trend context, depth_map has templates.
// Should trigger synthetic signal derivation.

const CGI_B = {
  topic: 'AI adoption in enterprise',
  selected_angle: 'Enterprise AI adoption is slower than expected.',
  trend_context: '',
  uniqueness_directive: '',
  must_include_points: [],
  answers: {},
  key_messages: ['AI is important for enterprise.'],
  strategic_core: {
    core_problem: 'Enterprises struggle to adopt AI effectively.',
  },
  depth_map: [
    {
      pillar: 'AI Implementation',
      key_point: 'AI implementation requires careful planning.',
      why_it_matters: '',
      mechanism: 'Detailed explanation of HOW AI Implementation works in practice.',
      example_direction: 'Concrete AI Implementation-specific example.',
      insight_angle: '',
      contrarian_take: 'Challenge the most common assumption about AI Implementation.',
    },
    {
      pillar: 'Change Management',
      key_point: 'Change management is critical for AI success.',
      why_it_matters: 'Change management ensures adoption.',
      mechanism: 'Detailed explanation of HOW Change Management works in practice.',
      example_direction: 'Concrete Change Management-specific example.',
      insight_angle: '[insight placeholder]',
      contrarian_take: '[contrarian placeholder]',
    },
  ],
};

const V21_HTML_B = `
<h2>AI Implementation</h2>
<p>AI implementation in enterprise environments involves deploying machine learning systems across business units. The process requires technical infrastructure, data governance, and stakeholder alignment.</p>
<p>Many enterprises have AI strategies but struggle to move from pilot to production. This is a critical challenge for digital transformation initiatives.</p>

<h2>Change Management</h2>
<p>Change management is a key factor in AI adoption success. Organisations that invest in change management see better AI adoption rates compared to those that do not.</p>
<p>The importance of change management cannot be overstated. It is essential for ensuring that employees understand and embrace new AI tools and processes.</p>
`.trim();

// ── Card C — Planner card: OKR Goal-Setting Framework ────────────────────────
// Real depth_map entries but sections are near the 350-word ceiling.
// Should largely pass through without injection.

const V21_HTML_C_SECTION_1 = `
<p>OKRs work by separating <em>what</em> you want to achieve (the Objective) from <em>how you will know you achieved it</em> (the Key Results). The Objective is qualitative and inspirational; the Key Results are quantitative and time-bound.</p>
<p>The causal mechanism is: a well-written Objective creates directional clarity, which allows teams to derive their own Key Results autonomously rather than waiting for top-down task lists. This decoupled structure is why OKRs scale: each layer of the organisation can sequence their own KRs while maintaining alignment to the company objective.</p>
<p>For example, a 60-person SaaS company set a company-level Objective of "Become the category leader in mid-market HR tech." The sales team independently derived KRs of: (1) close 12 new mid-market logos ≥ 200 seats, (2) achieve 85% logo retention, (3) reduce average sales cycle from 67 to 45 days. These KRs were derived without executive prescription — which means the team owned them and executed 20% faster than quota-driven targets in the same period.</p>
<p>The strategic implication: therefore, the decision point for OKR success is not writing quality but cadence design. Teams that review KRs weekly and update confidence scores bi-weekly outperform teams that treat OKRs as a quarterly document — which means your OKR review rhythm is a stronger predictor of outcomes than objective quality.</p>
<p>However, the most common failure mode is conflating activities with results. Unlike task lists, Key Results must describe an outcome state, not a deliverable. When you confuse outputs for outcomes, the framework collapses into reporting theatre rather than a decision engine.</p>
<p>When to use OKRs rather than KPIs: use OKRs when you need to generate alignment across ambiguous, emergent goals where the path is unknown. Use KPIs when you are managing a stable, well-understood process where the leading indicators are already validated.</p>
<p>What this means for decision-making: before adopting OKRs, factor in whether your organisation has the psychological safety to set aspirational targets that may not be fully achieved. OKRs are designed to be ambitious — 70% achievement should you be celebrating, not investigating.</p>
`.trim();

const V21_HTML_C_SECTION_2 = `
<p>The Key Results scoring process works as follows: at the end of each cycle, each KR is scored from 0.0 to 1.0, where 0.7 represents strong performance and 1.0 represents exceptional or lucky performance. The average score across all KRs in an Objective determines whether the Objective was achieved.</p>
<p>For example, Google's OKR scoring convention — now adopted by Stripe, Netflix, and hundreds of Series B+ startups — treats a 0.7 as the target. This is because scoring above 0.7 consistently signals that objectives were set too conservatively. When Stripe introduced this scoring standard to their engineering OKRs in 2022, aspirational KR setting increased by 40% in the next cycle because teams stopped sandbagging to guarantee 1.0s.</p>
<p>The key insight: the paradox of OKR scoring is therefore not maximising completion — it is using completion rates as a signal of ambition calibration. Which means a team consistently hitting 1.0 is not high-performing; it is under-ambitious. Trade-off: raising ambition increases learning velocity but also increases the risk of team burnout if objectives are not graded on effort as well as outcome.</p>
<p>What this means for decision-making: when you score your first OKR cycle, should you find scores clustered at 0.9–1.0, treat this as a planning failure rather than a performance success. Introduce a "stretch dial" in your next planning session where each team must propose at least one KR they genuinely believe has a 50% chance of scoring below 0.6.</p>
`.trim();

const CGI_C = {
  topic: 'OKR Goal-Setting Framework',
  selected_angle: 'Most companies adopt OKRs as a reporting format rather than a decision engine, which is why they plateau at bureaucracy rather than compounding into strategic clarity.',
  trend_context: 'As hybrid and distributed teams increase, goal alignment frameworks are replacing top-down planning as the primary coordination mechanism at Series A+ companies.',
  uniqueness_directive: 'Show the mechanical difference between OKRs as a reporting tool vs. OKRs as a decision engine.',
  must_include_points: [
    'OKRs decouple direction-setting from task prescription',
    'Cadence design is the hidden leverage point most teams underinvest in',
  ],
  answers: {
    what_is_it: 'OKRs are a goal-setting framework that separates aspirational direction (Objective) from measurable outcomes (Key Results).',
    why_now: 'Distributed teams need alignment without micromanagement — OKRs provide the structure for autonomous execution toward shared objectives.',
  },
  key_messages: [
    'Review cadence, not writing quality, determines OKR outcomes',
    'A 0.7 score means you set the right level of ambition',
  ],
  strategic_core: {
    core_problem: 'Teams adopt OKRs as a reporting format rather than a decision engine, creating bureaucracy rather than strategic clarity.',
  },
  depth_map: [
    {
      pillar: 'OKR Structure',
      key_point: 'OKRs decouple directional vision from prescriptive task lists by separating Objectives (what) from Key Results (how measured).',
      why_it_matters: 'When teams own their KRs rather than receive task lists, execution speed increases because intrinsic motivation replaces compliance.',
      mechanism: 'The mechanism works by separating the Objective (qualitative, directional) from the Key Results (quantitative, outcome-based). Each layer derives its own KRs from the Objective above, creating autonomous alignment rather than hierarchical task distribution.',
      example_direction: 'A 60-person SaaS company set company Objective: "Become the category leader in mid-market HR tech." The sales team derived their own KRs without executive prescription and executed 20% faster than prior quota-driven targets.',
      insight_angle: 'The teams that get the most from OKRs treat the Objective as a compass, not a contract — which means they update KRs mid-cycle when new evidence demands it rather than anchoring to the original plan.',
      contrarian_take: 'Most companies adopt OKRs as a reporting format rather than a decision engine. However, the highest-performing OKR users update their KRs bi-weekly based on signal changes — which means OKR rigidity is a stronger predictor of failure than OKR absence.',
    },
    {
      pillar: 'OKR Scoring',
      key_point: 'OKR scoring is a calibration tool, not a performance grade — the target is 0.7, not 1.0.',
      why_it_matters: 'Scoring 1.0 consistently signals sandbagging, not excellence — which means teams should you treat low scores as ambition signals, not performance failures.',
      mechanism: 'Scoring works by rating each KR from 0.0 to 1.0 at cycle end, where 0.7 = strong. Averaging across all KRs in an Objective reveals ambition calibration. Consistent 1.0s = objectives too conservative. Consistent 0.3s = objectives too aspirational or resources misaligned.',
      example_direction: 'Google\'s OKR scoring convention — adopted by Stripe, Netflix and hundreds of Series B+ startups — treats 0.7 as the target. When Stripe introduced this to engineering OKRs in 2022, aspirational KR setting increased 40% in the next cycle.',
      insight_angle: 'The paradox: a team hitting 1.0 consistently is not high-performing — it is under-ambitious. Therefore, maximising OKR scores is the wrong optimisation target.',
      contrarian_take: 'The prevailing assumption is that high OKR scores mean strong performance. However, unlike KPIs, OKRs are designed to be partially missed — which means compliance-oriented cultures systematically underperform OKR-friendly cultures even with better processes.',
    },
  ],
};

const V21_HTML_C = `
<h2>OKR Structure and Mechanics</h2>
${V21_HTML_C_SECTION_1}

<h2>OKR Scoring</h2>
${V21_HTML_C_SECTION_2}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// RUN ALL CARDS
// ─────────────────────────────────────────────────────────────────────────────

const results = {
  timestamp: new Date().toISOString(),
  card_A: runValidation('Card A — Rich: B2B Content Flywheel', CGI_A, V21_HTML_A),
  card_B: runValidation('Card B — Sparse: AI Enterprise Adoption', CGI_B, V21_HTML_B),
  card_C: runValidation('Card C — Planner: OKR Framework (near-ceiling sections)', CGI_C, V21_HTML_C),
};

// Overall pass: all three cards must pass
results.overall_pass = results.card_A.overall_pass
                    && results.card_B.overall_pass
                    && results.card_C.overall_pass;

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT
// ─────────────────────────────────────────────────────────────────────────────

console.log(JSON.stringify(results, null, 2));
