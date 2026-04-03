// __depth_engine_v2_validation.js
// Depth + Insight Engine v2 — BEFORE vs AFTER validation harness
// Run with: node __depth_engine_v2_validation.js
// NO API calls. NO randomness. Fully deterministic.
// Mirrors scoring logic from contentDepthAndInsightEngine.ts exactly.

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS (mirror from engine)
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','but','by',
  'for','from','had','has','have','if','in','into','is','it','its','of',
  'on','or','that','the','their','there','these','this','those','to','was',
  'were','will','with','you','your','they','them','we','our','all','about',
  'more','can','when','what','how','its','which','so','do','also','just',
  'not','any','than','then','use','used','some','other','most',
]);

const GENERIC_PHRASES = [
  "in today's world","in the modern era","it is important to","as we all know",
  "plays a crucial role","plays a vital role","leveraging the power of",
  "it goes without saying","needless to say","at the end of the day",
  "moving the needle","synergize","best practices","game changer",
  "disruptive","paradigm shift","circle back","take this to the next level",
  "actionable insights","value-add","low-hanging fruit","boil the ocean",
];

const EXPLANATION_RE = /\b(is|are|means|refers|defined as|what is|describes|represents)\b/i;
const MECHANISM_RE   = /\b(because|work[s]? by|process|system|sequence|driver|caus|mechanism|operat|step[s]?|how it|the reason)\b/i;
const EXAMPLE_RE     = /\b(for example|for instance|example|case study|scenario|consider|imagine|such as|like when|in practice|real.world)\b/i;
const INSIGHT_RE     = /\b(this means|which means|therefore|however|the implication|why this matters|so what|the key insight|trade.?off|vs\.|versus|unlike|the difference|what this reveals|the consequence)\b/i;
const COMPARISON_RE  = /\b( vs\.? |versus|compare|comparison|rather than|instead of|trade.?off|tradeoff|when to use|when not to use|should you|consider using|avoid when)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS (mirror from engine)
// ─────────────────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function esc(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3 && !STOP_WORDS.has(t));
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING FUNCTIONS (mirror from engine)
// ─────────────────────────────────────────────────────────────────────────────

function evalDepth(body, wordCount) {
  return {
    explanation: wordCount > 50 || EXPLANATION_RE.test(body),
    mechanism:   MECHANISM_RE.test(body),
    example:     EXAMPLE_RE.test(body),
    insight:     INSIGHT_RE.test(body),
  };
}

function scoreInsight(text, signalTokens, wordCount) {
  const normalized  = text.toLowerCase();
  const textTokens  = tokenize(normalized);
  const signalHits  = textTokens.filter(t => signalTokens.has(t)).length;
  const signalDensity = textTokens.length > 0 ? signalHits / textTokens.length : 0;
  const genericHits = GENERIC_PHRASES.filter(p => normalized.includes(p)).length;
  const tensionBoost = INSIGHT_RE.test(normalized) ? 15 : 0;
  const exampleBoost = EXAMPLE_RE.test(normalized) ? 10 : 0;
  const lengthBoost  = wordCount > 100 ? 10 : wordCount > 50 ? 5 : 0;
  const base = Math.min(70, Math.round(signalDensity * 200));
  return Math.max(0, Math.min(100,
    base + tensionBoost + exampleBoost + lengthBoost - genericHits * 15
  ));
}

function evalDecision(sections, signalTokens) {
  const missing = [];
  const hasComparisons = sections.some(s => /comparison|compare|vs\./i.test(s.heading) || COMPARISON_RE.test(s.body));
  const hasTradeoffs   = sections.some(s => /trade.?off/i.test(s.heading) || /trade.?off|tradeoff/i.test(s.body));
  const hasWhenToUse   = sections.some(s => /when to use|when not|decision/i.test(s.heading + s.body));
  if (!hasComparisons) missing.push('comparisons');
  if (!hasTradeoffs)   missing.push('trade_offs');
  if (!hasWhenToUse)   missing.push('when_to_use / when_not_to_use');
  let maxSignalHits = 0;
  for (const s of sections) {
    if (COMPARISON_RE.test(s.body)) {
      const hits = tokenize(s.body).filter(t => signalTokens.has(t)).length;
      if (hits > maxSignalHits) maxSignalHits = hits;
    }
  }
  const real = (hasComparisons || hasWhenToUse) && maxSignalHits >= 2;
  return { real, missing };
}

function buildSignalTokens(cgi) {
  const sources = [
    cgi.topic,
    cgi.selected_angle,
    cgi.trend_context,
    cgi.uniqueness_directive,
    cgi.narrative_direction,
    cgi.differentiation,
    ...cgi.must_include_points,
    ...(Object.values(cgi.answers)),
    ...cgi.key_messages,
    cgi.strategic_core.core_problem,
    cgi.strategic_core.authority_basis,
    cgi.strategic_core.transformation_goal,
    ...cgi.strategic_core.pain_points,
    ...cgi.depth_map.map(e => `${e.key_point} ${e.mechanism} ${e.contrarian_take}`),
    ...cgi.decision_blocks.flatMap(b => [...b.comparisons, ...b.trade_offs]),
  ].filter(Boolean);
  return new Set(sources.join(' ').split(/\s+/).flatMap(w => tokenize(w)));
}

function parseSections(html) {
  const sections = [];
  const firstH2 = html.search(/<h2>/i);
  if (firstH2 > 0) {
    const preamble = html.slice(0, firstH2).trim();
    if (preamble) {
      sections.push({
        id: 'section_intro',
        heading: '__intro__',
        body: preamble,
        is_reference: false,
        is_key_insights: true,
      });
    }
  }
  const h2Regex = /<h2>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2>|$)/gi;
  let match;
  let idx = 0;
  while ((match = h2Regex.exec(html)) !== null) {
    const heading = stripHtml(match[1]).trim();
    const body    = match[2].trim();
    sections.push({
      id: `section_${idx++}`,
      heading,
      body,
      is_reference:    /^references?$/i.test(heading),
      is_key_insights: false,
    });
  }
  return sections;
}

function assembleSections(sections) {
  return sections.map(s => {
    if (s.is_key_insights) return s.body;
    return `<h2>${esc(s.heading)}</h2>\n${s.body}`;
  }).join('\n\n');
}

// aggregate helpers
function aggregateDepthScore(depthReport, sections) {
  const ev = sections.filter(s => !s.is_reference && !s.is_key_insights);
  if (ev.length === 0) return 100;
  let total = 0;
  for (const s of ev) {
    const r = depthReport[s.id];
    if (!r) continue;
    const pass = [r.explanation, r.mechanism, r.example, r.insight].filter(Boolean).length;
    total += (pass / 4) * 100;
  }
  return Math.round(total / ev.length);
}

function aggregateInsightScore(insightReport, sections) {
  const ev = sections.filter(s => !s.is_reference && !s.is_key_insights);
  if (ev.length === 0) return 100;
  let total = 0, count = 0;
  for (const s of ev) {
    const r = insightReport[s.id];
    if (!r) continue;
    total += r.insight_score;
    count++;
  }
  return count > 0 ? Math.round(total / count) : 100;
}

function aggregateGenericRatio(insightReport, sections) {
  const ev = sections.filter(s => !s.is_reference && !s.is_key_insights);
  if (ev.length === 0) return 0;
  const generic = ev.filter(s => insightReport[s.id]?.generic).length;
  return Math.round((generic / ev.length) * 100);
}

function aggregateDecisionScore(report) {
  if (report.real) return 100;
  const total = 3;
  const present = total - report.missing.length;
  return Math.round((present / total) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// INJECTION HELPERS (mirror from engine)
// ─────────────────────────────────────────────────────────────────────────────

function injectMechanism(body, mechanism) {
  if (!mechanism || mechanism.length < 10) return body;
  return `${body}\n<p><strong>How this works:</strong> ${esc(mechanism)}</p>`;
}
function injectExample(body, exampleDirection) {
  if (!exampleDirection || exampleDirection.length < 10) return body;
  return `${body}\n<p><strong>In practice:</strong> ${esc(exampleDirection)}</p>`;
}
function injectInsight(body, contrarianTake) {
  if (!contrarianTake || contrarianTake.length < 10) return body;
  return `${body}\n<p><strong>The strategic implication:</strong> ${esc(contrarianTake)}</p>`;
}
function injectSpecificityAnchor(body, anchor) {
  if (!anchor || anchor.length < 10) return body;
  return `<p><em>${esc(anchor)}</em></p>\n${body}`;
}

function buildDecisionInjection(block) {
  const lines = [];
  if (block.comparisons.length > 0) {
    lines.push('<h3>Key Comparisons</h3><ul>');
    block.comparisons.slice(0, 3).forEach(c => lines.push(`<li>${esc(c)}</li>`));
    lines.push('</ul>');
  }
  if (block.trade_offs.length > 0) {
    lines.push('<h3>Trade-offs to Consider</h3><ul>');
    block.trade_offs.slice(0, 3).forEach(t => lines.push(`<li>${esc(t)}</li>`));
    lines.push('</ul>');
  }
  if (block.when_to_use.length > 0) {
    lines.push('<h3>When to Use This Approach</h3><ul>');
    block.when_to_use.slice(0, 3).forEach(w => lines.push(`<li>${esc(w)}</li>`));
    lines.push('</ul>');
  }
  if (block.when_not_to_use.length > 0) {
    lines.push('<h3>When Not to Use This Approach</h3><ul>');
    block.when_not_to_use.slice(0, 3).forEach(w => lines.push(`<li>${esc(w)}</li>`));
    lines.push('</ul>');
  }
  return lines.join('\n');
}

function matchDepthEntry(heading, idx, depthMap) {
  if (depthMap.length === 0) return { pillar:'',key_point:'',why_it_matters:'',mechanism:'',example_direction:'',insight_angle:'',contrarian_take:'' };
  const headingTokens = new Set(tokenize(heading));
  let best = depthMap[Math.min(idx, depthMap.length - 1)];
  let bestScore = 0;
  for (const entry of depthMap) {
    const pillarTokens = tokenize(entry.pillar);
    const overlap = pillarTokens.filter(t => headingTokens.has(t)).length;
    const score   = pillarTokens.length > 0 ? overlap / pillarTokens.length : 0;
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL ENGINE (mirror of runContentDepthAndInsightEngine — self-contained)
// ─────────────────────────────────────────────────────────────────────────────

function runEngine(cgi, generatedContent) {
  const signalTokens = buildSignalTokens(cgi);
  const sections     = parseSections(generatedContent.content_html);

  // depth before
  const depthReport = {};
  for (const s of sections) {
    if (s.is_reference || s.is_key_insights) continue;
    const text = stripHtml(s.body);
    const wc   = text.split(/\s+/).filter(Boolean).length;
    depthReport[s.id] = evalDepth(s.body, wc);
  }

  // insight before
  const insightReport = {};
  for (const s of sections) {
    if (s.is_reference || s.is_key_insights) continue;
    const text  = stripHtml(s.body);
    const wc    = text.split(/\s+/).filter(Boolean).length;
    const score = scoreInsight(text, signalTokens, wc);
    insightReport[s.id] = { insight_score: score, generic: score < 60 };
  }

  // decision before
  const decisionReport = evalDecision(sections, signalTokens);

  // before aggregates
  const depthScoreBefore    = aggregateDepthScore(depthReport, sections);
  const insightScoreBefore  = aggregateInsightScore(insightReport, sections);
  const genericRatioBefore  = aggregateGenericRatio(insightReport, sections);
  const decisionScoreBefore = aggregateDecisionScore(decisionReport);

  // auto-correction (mirror of correctSections)
  const fixes = [];
  const mustInclude = cgi.must_include_points.join(' | ');
  const uniqueness  = cgi.answers.uniqueness_directive || cgi.uniqueness_directive;
  let evaluableIdx  = 0;
  const corrected   = sections.map(section => {
    if (section.is_reference || section.is_key_insights) return { ...section };

    const dr  = depthReport[section.id];
    const ir  = insightReport[section.id];
    if (!dr || !ir) return { ...section };

    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, cgi.depth_map);
    evaluableIdx++;

    let body = section.body;

    if (!dr.mechanism && dmEntry.mechanism && dmEntry.mechanism.length > 20) {
      body = injectMechanism(body, dmEntry.mechanism);
      fixes.push(`[${section.id}] mechanism injected — "${dmEntry.pillar}"`);
    }
    if (!dr.example && dmEntry.example_direction && dmEntry.example_direction.length > 20) {
      body = injectExample(body, dmEntry.example_direction);
      fixes.push(`[${section.id}] example injected — "${dmEntry.pillar}"`);
    }
    if (!dr.insight && dmEntry.contrarian_take && dmEntry.contrarian_take.length > 20) {
      body = injectInsight(body, dmEntry.contrarian_take);
      fixes.push(`[${section.id}] insight injected — "${dmEntry.pillar}"`);
    }
    if (ir.generic) {
      const anchor = mustInclude || uniqueness;
      if (anchor) {
        body = injectSpecificityAnchor(body, anchor.slice(0, 200));
        fixes.push(`[${section.id}] specificity anchor injected`);
      }
    }
    return { ...section, body };
  });

  // 5.5 — decision injection
  const decisionBlock = cgi.decision_blocks[0];
  if (!decisionReport.real && decisionBlock) {
    let injected = false;
    for (let i = 0; i < corrected.length; i++) {
      const s = corrected[i];
      if (!s.is_reference && !s.is_key_insights && /decision|framework|when to|action/i.test(s.heading)) {
        corrected[i] = { ...s, body: s.body + '\n' + buildDecisionInjection(decisionBlock) };
        fixes.push(`[${s.id}] decision block injected into existing section`);
        injected = true;
        break;
      }
    }
    if (!injected) {
      const refIdx    = corrected.findIndex(s => s.is_reference);
      const insertAt  = refIdx >= 0 ? refIdx : corrected.length;
      corrected.splice(insertAt, 0, {
        id: 'section_decision_injected',
        heading: `Decision Framework: ${cgi.topic}`,
        body: buildDecisionInjection(decisionBlock),
        is_reference: false,
        is_key_insights: false,
      });
      fixes.push(`[section_decision_injected] full decision block section appended`);
    }
  }

  // after-scores
  const correctedHtml   = assembleSections(corrected);
  const correctedParsed = parseSections(correctedHtml);

  const depthReportAfter = {};
  for (const s of correctedParsed) {
    if (s.is_reference || s.is_key_insights) continue;
    const text = stripHtml(s.body);
    depthReportAfter[s.id] = evalDepth(s.body, text.split(/\s+/).filter(Boolean).length);
  }

  const insightReportAfter = {};
  for (const s of correctedParsed) {
    if (s.is_reference || s.is_key_insights) continue;
    const text  = stripHtml(s.body);
    const wc    = text.split(/\s+/).filter(Boolean).length;
    const score = scoreInsight(text, signalTokens, wc);
    insightReportAfter[s.id] = { insight_score: score, generic: score < 60 };
  }

  const decisionReportAfter  = evalDecision(correctedParsed, signalTokens);
  const depthScoreAfter       = aggregateDepthScore(depthReportAfter, correctedParsed);
  const insightScoreAfter     = aggregateInsightScore(insightReportAfter, correctedParsed);
  const genericRatioAfter     = aggregateGenericRatio(insightReportAfter, correctedParsed);
  const decisionScoreAfter    = aggregateDecisionScore(decisionReportAfter);

  return {
    corrected,
    correctedParsed,
    depthReport,     depthReportAfter,
    insightReport,   insightReportAfter,
    decisionReport,  decisionReportAfter,
    fixes,
    before: { depthScoreBefore, insightScoreBefore, genericRatioBefore, decisionScoreBefore },
    after:  { depthScoreAfter, insightScoreAfter, genericRatioAfter, decisionScoreAfter },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OVER-CORRECTION DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

function detectOvercorrection(fixes, correctedParsed, beforeSections) {
  const issues = [];

  // 1. Detect bloated sections: after-section body > 2.5x before-section body length
  for (const after of correctedParsed) {
    if (after.is_reference || after.is_key_insights) continue;
    const before = beforeSections.find(s => s.id === after.id);
    if (!before) continue; // injected new section — not overcorrection
    const ratio = after.body.length / (before.body.length || 1);
    if (ratio > 2.5) {
      issues.push(`[${after.id}] body grew ${ratio.toFixed(1)}x — potential injection bloat`);
    }
  }

  // 2. Detect repeated injection phrases in same section
  const injectionMarkers = ['How this works:', 'In practice:', 'The strategic implication:'];
  for (const s of correctedParsed) {
    for (const marker of injectionMarkers) {
      const count = (s.body.split(marker).length - 1);
      if (count > 1) issues.push(`[${s.id}] "${marker}" appears ${count} times`);
    }
  }

  // 3. Detect forced specificity anchor that doubles up with existing content
  for (const s of correctedParsed) {
    const anchorCount = (s.body.match(/<p><em>/g) || []).length;
    if (anchorCount > 1) issues.push(`[${s.id}] multiple <p><em> anchors — possible double-injection`);
  }

  return { detected: issues.length > 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

function detectRegression(beforeSections, afterSections, depthBefore, depthAfter, insightBefore, insightAfter) {
  const issues = [];

  // 1. Section count reduction
  const bev = beforeSections.filter(s => !s.is_reference && !s.is_key_insights).length;
  const aev = afterSections.filter(s  => !s.is_reference && !s.is_key_insights).length;
  if (aev < bev) issues.push(`section count dropped ${bev} → ${aev}`);

  // 2. Any heading changed (structure break)
  for (const bs of beforeSections) {
    if (bs.is_key_insights || bs.is_reference) continue;
    const as_ = afterSections.find(s => s.id === bs.id);
    if (as_ && as_.heading !== bs.heading) {
      issues.push(`[${bs.id}] heading changed: "${bs.heading}" → "${as_.heading}"`);
    }
  }

  // 3. Depth score regression (after < before)
  if (depthAfter < depthBefore - 5) {
    issues.push(`depth score regressed: ${depthBefore} → ${depthAfter}`);
  }

  // 4. Insight score regression
  if (insightAfter < insightBefore - 5) {
    issues.push(`insight score regressed: ${insightBefore} → ${insightAfter}`);
  }

  return { present: issues.length > 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL UTILIZATION CHECKER
// ─────────────────────────────────────────────────────────────────────────────

function checkSignalUsage(cgi, fixes, correctedParsed) {
  const missed = [];
  const allCorrectedText = correctedParsed.map(s => stripHtml(s.body)).join(' ').toLowerCase();

  // authority_reason / authority_basis
  if (cgi.strategic_core.authority_basis && cgi.strategic_core.authority_basis.length > 5) {
    const tokens = tokenize(cgi.strategic_core.authority_basis);
    const hits   = tokens.filter(t => allCorrectedText.includes(t)).length;
    if (hits === 0) missed.push('authority_reason (strategic_core.authority_basis)');
  }

  // uniqueness_directive
  const ud = cgi.answers.uniqueness_directive || cgi.uniqueness_directive;
  if (ud && ud.length > 5) {
    const tokens = tokenize(ud);
    const hits   = tokens.filter(t => allCorrectedText.includes(t)).length;
    if (hits === 0) missed.push('uniqueness_directive');
  }

  // must_include_points
  for (const point of cgi.must_include_points) {
    const tokens = tokenize(point);
    if (tokens.length === 0) continue;
    const hits = tokens.filter(t => allCorrectedText.includes(t)).length;
    if (hits === 0) missed.push(`must_include_point: "${point.slice(0, 60)}"`);
  }

  return {
    fully_utilized: missed.length === 0,
    missed_signals: missed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION-LEVEL DETAIL BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildSectionImprovement(depthReport, depthReportAfter, sections) {
  const sections_improved      = [];
  const still_shallow_sections = [];

  for (const s of sections) {
    if (s.is_reference || s.is_key_insights) continue;
    const before = depthReport[s.id];
    const after  = depthReportAfter[s.id];
    if (!before || !after) continue;

    const beforePass = [before.explanation, before.mechanism, before.example, before.insight].filter(Boolean).length;
    const afterPass  = [after.explanation,  after.mechanism,  after.example,  after.insight ].filter(Boolean).length;

    if (afterPass > beforePass) {
      sections_improved.push(`[${s.id}] "${s.heading}" ${beforePass}/4 → ${afterPass}/4`);
    }
    if (afterPass < 4) {
      const missing = [];
      if (!after.explanation) missing.push('explanation');
      if (!after.mechanism)   missing.push('mechanism');
      if (!after.example)     missing.push('example');
      if (!after.insight)     missing.push('insight');
      still_shallow_sections.push(`[${s.id}] "${s.heading}" — missing: ${missing.join(', ')}`);
    }
  }
  return { sections_improved, still_shallow_sections };
}

function buildInsightDetail(insightReport, insightReportAfter, sections, correctedParsed) {
  const generic_insights_remaining = [];
  const strong_insight_sections    = [];

  for (const s of correctedParsed) {
    if (s.is_reference || s.is_key_insights) continue;
    const r = insightReportAfter[s.id];
    if (!r) continue;
    if (r.generic) {
      generic_insights_remaining.push(`[${s.id}] "${s.heading}" — score ${r.insight_score}`);
    } else {
      strong_insight_sections.push(`[${s.id}] "${s.heading}" — score ${r.insight_score}`);
    }
  }
  return { generic_insights_remaining, strong_insight_sections };
}

function buildGenericDetail(insightReportAfter, correctedParsed) {
  const remaining = [];
  for (const s of correctedParsed) {
    if (s.is_reference || s.is_key_insights) continue;
    const r = insightReportAfter[s.id];
    if (r && r.generic) remaining.push(`[${s.id}] "${s.heading}" — score ${r.insight_score}`);
  }
  return remaining;
}

function buildFakeDecisionDetail(decisionReportAfter) {
  if (decisionReportAfter.real) return [];
  return decisionReportAfter.missing.map(m => `Missing: ${m}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

// ── Card A (Rich RecommendationStrategicCard) ──────────────────────────────

const cardA_cgi = {
  topic:               'B2B Content Strategy',
  selected_angle:      'Most SaaS teams are building content backwards — here is why execution-first thinking is destroying your pipeline',
  trend_context:       'SaaS buyers now consume 11+ pieces of content before contacting sales — yet 73% of SaaS content still leads with features not problems',
  uniqueness_directive:'Virality platform maps content gaps to pipeline velocity — a methodology competitors lack',
  narrative_direction: 'Challenge the assumption that more content equals more pipeline',
  differentiation:     'Signal-driven content creation vs template-based content production',
  must_include_points: [
    'Pipeline velocity is a content metric not a sales metric',
    'Lead scoring gaps trace back to content stage mismatches',
    'Editorial calendar should be derived from CRM gap analysis',
    'Authority content reduces CAC by compressing the trust cycle',
    'Competitor content analysis must precede topic selection',
  ],
  key_messages:        ['content strategy without pipeline data is creative guessing', 'buyers trust companies that teach not companies that pitch'],
  audience:            'VP Marketing at Series B SaaS companies with 15-40 person sales teams',
  tone:                'direct, evidence-based, contrarian',
  hook_variants:       [
    'Your content team is optimising for the wrong metric — here is the data',
    'The SaaS companies winning pipeline in 2025 share one counterintuitive content habit',
  ],
  strategic_core: {
    core_problem:        'SaaS content teams optimise for traffic and engagement but pipeline attribution is broken — content-to-revenue causation is invisible',
    pain_points:         ['editorial calendars disconnected from CRM data', 'content produced without buyer stage mapping', 'authority deficits in competitive segments'],
    transformation_goal: 'VP Marketing can trace every content asset to a pipeline velocity impact within 90 days',
    authority_basis:     'Virality platform has indexed 2.3M B2B content assets with pipeline attribution data across 400 SaaS companies',
  },
  depth_map: [
    {
      pillar:            'Pipeline Attribution Gap',
      key_point:         'Most SaaS companies cannot attribute pipeline to specific content assets',
      why_it_matters:    'Without attribution, content investment is invisible in the boardroom',
      mechanism:         'Content attribution breaks because UTM tracking stops at lead creation — it never connects to opportunity stage progression or closed-won revenue. The gap sits between MQL and SQL handoff.',
      example_direction: 'A Series B SaaS with $4M ARR running 3x weekly content cadence had zero pipeline attribution. After mapping content to CRM stage transitions, 40% of SQLs had consumed 3+ authority pieces — invisible in the original reporting.',
      insight_angle:     'Content is already influencing pipeline — you just cannot see it yet',
      contrarian_take:   'Pipeline attribution is not a marketing ops problem — it is a content architecture problem. Teams that solve it with better UTMs are solving the wrong problem.',
    },
    {
      pillar:            'Buyer Stage Mismatch',
      key_point:         'Content is produced for the wrong buyer stage',
      why_it_matters:    'Stage mismatches reduce conversion at every funnel gate',
      mechanism:         'Editorial calendars driven by keyword volume optimise for top-of-funnel traffic. Buyers in evaluation and decision stages consume comparison, proof, and ROI content — which most SaaS teams under-produce by 6:1.',
      example_direction: 'Series A SaaS audit: 84% of published content was awareness-stage. Mid-funnel evaluation content was 4% of output — yet 60% of deal-velocity acceleration happened in evaluation stage per CRM data.',
      insight_angle:     'The content your buyers need most is the content your team produces least',
      contrarian_take:   'SEO-driven content strategy systematically under-produces for the buyers closest to converting. Optimising for discovery is optimising against conversion.',
    },
    {
      pillar:            'Authority Deficit',
      key_point:         'Category authority cannot be faked with volume',
      why_it_matters:    'Buyers use authority signals to de-risk vendor selection',
      mechanism:         'Authority compounds through citation, backlink diversity and direct search intent for brand terms. Volume without earned authority produces diminishing returns beyond 6 months — the inflection appears in branded search share data.',
      example_direction: 'Two competing SaaS platforms: one publishing 5x/week (generalist), one publishing 2x/week (deep authority pieces). After 12 months, the lower-volume publisher had 3.4x branded search growth and 22% lower CAC.',
      insight_angle:     'Authority is a compounding asset — volume is a depreciating one',
      contrarian_take:   'Publishing frequency is the wrong optimisation. Teams that publish less but with greater depth and evidence consistently outperform on branded search and win rate within 18 months.',
    },
    {
      pillar:            'CRM-to-Content Gap',
      key_point:         'CRM data is the best editorial brief — almost no one uses it',
      why_it_matters:    'Closing the loop between sales objections and content production is the highest-ROI content investment',
      mechanism:         'Lost deals and stalled opportunities contain the exact objections and gaps your content should address. Extracting deal notes, call transcripts and stage-loss reasons creates a content brief that is pre-validated by real buyer behaviour.',
      example_direction: 'One growth-stage SaaS extracted 900 closed-lost deal notes and found 4 recurring objection clusters. Building content assets targeting those clusters reduced stage-4 deal loss by 18% in one quarter.',
      insight_angle:     'Your CRM is the highest-signal editorial calendar you will ever have',
      contrarian_take:   'The content your team does not publish — because it seems obvious or too niche — is exactly the content that accelerates stuck deals.',
    },
    {
      pillar:            'Competitive Content Saturation',
      key_point:         'Publishing into a saturated topic without a differentiated angle is invisible',
      why_it_matters:    'Saturated content produces traffic without authority',
      mechanism:         'Search intent saturation means the top 3 results capture 68% of clicks on informational queries. Breaking through requires a contrarian angle, proprietary data, or primary research — not incremental SEO optimisation.',
      example_direction: 'SaaS content team targeting "sales enablement" produced 22 articles over 6 months with zero first-page rankings. Pivot to "sales enablement for remote-first teams" with original survey data produced a first-page ranking in 60 days.',
      insight_angle:     'Undifferentiated content in a saturated category is an investment in your competitor\'s authority',
      contrarian_take:   'Publishing on a competitive topic without a proprietary data angle is not a content strategy — it is a budget allocation to noise.',
    },
  ],
  decision_blocks: [{
    topic: 'B2B Content Strategy approach selection',
    comparisons: [
      'Signal-driven content planning vs keyword-volume-driven editorial calendar — pipeline attribution visibility',
      'Authority-depth content (2x/week) vs frequency-volume content (5x/week) — CAC and win rate impact at 12 months',
      'CRM-first content brief vs SEO-first content brief — conversion stage coverage and deal velocity',
    ],
    trade_offs: [
      'Signal-driven approach requires CRM access and sales alignment — increases time-to-first-publish by 3-4 weeks but reduces wasted content investment',
      'Authority-depth content reduces output volume — harder to justify internally but compresses trust cycle and reduces CAC',
      'CRM-first briefs surface uncomfortable gaps — requires editorial courage to publish objection-handling content at scale',
    ],
    when_to_use: [
      'When pipeline attribution is broken and CMO cannot demonstrate content ROI in QBR',
      'When branded search share is declining despite content volume growth',
      'When deal velocity is stalling at evaluation stage — content-to-pipeline gap is most likely cause',
    ],
    when_not_to_use: [
      'When product-market fit is still in discovery — content strategy requires stable ICP',
      'When sales cycle is under 14 days — content influence on pipeline is minimal at short cycle lengths',
    ],
  }],
  answers: {
    audience:             'VP Marketing at Series B SaaS companies with 15-40 person sales teams',
    trend_context:        'SaaS buyers now consume 11+ pieces before contacting sales — 73% of SaaS content is still feature-led not problem-led',
    uniqueness_directive: 'Virality platform indexes 2.3M content assets with pipeline attribution data — methodology competitors lack',
    must_include_points:  'Pipeline velocity is a content metric | Lead scoring gaps trace to content stage mismatches | CRM gap analysis should drive editorial calendar | Authority content reduces CAC | Competitor analysis must precede topic selection',
    company_context:      'Virality is a signal-driven content platform for SaaS growth teams — clients are Series A/B companies targeting VP Marketing and Growth personas',
    campaign_objective:   'Generate 40 qualified demo requests from VP Marketing segment in Q2',
    reader_stage:         'evaluation | building business case | needs evidence to convince CFO',
    cta_preference:       'Book a 20-minute pipeline attribution audit — free for qualifying SaaS teams',
    writing_style:        'Direct, evidence-led, no jargon, uses real numbers, challenges conventional advice',
  },
  derived_angle: 'contrarian',
  intent:        'authority',
  content_type:  'blog',
  goal:          'pipeline',
  cluster:       'b2b-content-strategy',
};

// BEFORE html: realistic but shallow — mechanism/example/insight missing from several sections
// Intentionally uses generic phrases to trigger correction
const cardA_before_html = `
<div class="key-insights"><p>Key insight: Most SaaS teams build content for traffic, not pipeline.</p></div>
<p>B2B content strategy has never been more important. In today's world, buyers consume more content than ever before and it is important to understand how to leverage the power of digital content for growth.</p>

<h2>Pipeline Attribution Gap</h2>
<p>Most SaaS companies struggle to attribute pipeline to content. This plays a crucial role in how companies measure ROI. Pipeline attribution is important because it helps teams understand which content is working.</p>
<p>Many companies use UTM parameters to track content but this is often insufficient. The process requires careful coordination between marketing and sales teams.</p>

<h2>Buyer Stage Mismatch</h2>
<p>Producing content for the wrong buyer stage is a common problem. At the end of the day, teams need to align their content with where buyers actually are in the journey.</p>
<p>Editorial calendars are often driven by keyword volume, which means top-of-funnel content dominates. This is a well-known best practice in the industry.</p>

<h2>Authority Deficit</h2>
<p>Building category authority is essential for SaaS growth. Moving the needle on authority requires consistent publishing and thought leadership. Authority helps buyers trust your brand and reduces the time to conversion.</p>

<h2>CRM-to-Content Gap</h2>
<p>Using CRM data for content planning is an actionable insight that many teams miss. Sales teams have data that content teams need. Synergizing these two functions can be a game changer for pipeline generation.</p>

<h2>Competitive Content Saturation</h2>
<p>Publishing into saturated topics without differentiation is ineffective. Teams need to find their unique angle. This is a paradigm shift from traditional SEO-driven content approaches.</p>

<h2>References</h2>
<p>Content Marketing Institute 2024 Report. Gartner B2B Purchase Study.</p>
`.trim();

const cardA_before_content = {
  title:                'Why Your B2B Content Strategy Is Destroying Pipeline',
  excerpt:              'Most SaaS teams optimise for the wrong content metric.',
  content_html:         cardA_before_html,
  tags:                 ['b2b-content', 'pipeline', 'saas-growth'],
  category:             'Content Strategy',
  seo_meta_title:       'B2B Content Strategy That Drives Pipeline | Virality',
  seo_meta_description: 'Why SaaS content teams build for traffic and break pipeline — and what to do instead.',
  key_insights:         ['Content-to-pipeline attribution is broken', 'Buyer stage mismatch is the root cause of funnel inefficiency'],
  content_blocks:       [],
};

// ── Card B (Sparse RecommendationStrategicCard) ────────────────────────────

const cardB_cgi = {
  topic:               'Social Media Marketing',
  selected_angle:      'Strategic social media growth framework for early-stage SaaS',
  trend_context:       'Organic social reach declining across all platforms — paid amplification now required for consistent reach',
  uniqueness_directive:'',
  narrative_direction: '',
  differentiation:     '',
  must_include_points: [],
  key_messages:        [],
  audience:            'Early-stage SaaS founders and marketing generalists',
  tone:                'direct',
  hook_variants:       [],
  strategic_core: {
    core_problem:        'Social media growth without a strategic framework produces inconsistent results',
    pain_points:         [],
    transformation_goal: 'Build a repeatable social content system that grows audience predictably',
    authority_basis:     '',
  },
  depth_map: [
    {
      pillar:            'Platform Selection',
      key_point:         'Choosing the right platform for your audience',
      why_it_matters:    'Wrong platform selection wastes content investment',
      mechanism:         'Detailed explanation of HOW platform selection works in practice',
      example_direction: 'Concrete social media marketing-specific example',
      insight_angle:     'Evidence from social media marketing execution patterns',
      contrarian_take:   'Challenge the most common assumption about platform selection',
    },
    {
      pillar:            'Content Calendar',
      key_point:         'Consistent publishing cadence drives algorithm favour',
      why_it_matters:    'Inconsistent publishing reduces organic reach by up to 60%',
      mechanism:         'Detailed explanation of HOW content calendar works in practice',
      example_direction: 'Concrete social media marketing-specific example',
      insight_angle:     'Evidence from social media marketing execution patterns',
      contrarian_take:   'Challenge the most common assumption about content calendar',
    },
  ],
  decision_blocks: [{
    topic:          'Social media marketing approach',
    comparisons:    ['Tactical execution vs. strategic framework', 'Manual process vs. system-driven', 'Short-term vs. long-term positioning'],
    trade_offs:     ['Speed vs. depth of strategic alignment', 'Resource investment vs. compounding returns', 'Customisation vs. scalability'],
    when_to_use:    ['When building audience from zero', 'When organic reach is declining'],
    when_not_to_use:['When budget is below minimum viable paid spend threshold'],
  }],
  answers: {
    audience:           'Early-stage SaaS founders',
    trend_context:      'Paid amplification now required for organic reach',
    campaign_objective: 'Grow brand awareness for early-stage SaaS',
  },
  derived_angle: 'strategic',
  intent:        'awareness',
  content_type:  'blog',
  goal:          'awareness',
  cluster:       'social-media-marketing',
};

// BEFORE html: very shallow, all generic — no signal anchors, template mechanisms, no insights
const cardB_before_html = `
<div class="key-insights"><p>Build your social media presence strategically.</p></div>
<p>Social media marketing is more important than ever. In today's world, every business needs a social media presence to stay competitive and relevant. Best practices suggest posting consistently and engaging with your audience.</p>

<h2>Platform Selection</h2>
<p>Choosing the right social media platform is important. Different platforms serve different purposes. It is important to understand your audience before selecting a platform. This plays a crucial role in your social media success.</p>

<h2>Content Calendar</h2>
<p>Having a content calendar is a best practice for social media marketing. Moving the needle on social media requires consistent publishing. Leveraging the power of a content calendar helps you stay organised and on track.</p>

<h2>Social Media Strategy — Execution Context</h2>
<p>Execution is everything in social media marketing. At the end of the day, you need to take action and post consistently. This is how you build a following over time. Actionable insights require real execution.</p>

<h2>Decision Framework: Social Media Marketing</h2>
<p>Consider your options carefully before committing to a platform strategy. Synergizing your content and platform approach will be a game changer for your results.</p>

<h2>References</h2>
<p>Hootsuite Social Trends 2024. Sprout Social Index 2024.</p>
`.trim();

const cardB_before_content = {
  title:                'Social Media Marketing Strategy for SaaS',
  excerpt:              'Build a repeatable social system for early-stage SaaS growth.',
  content_html:         cardB_before_html,
  tags:                 ['social-media', 'saas', 'marketing'],
  category:             'Social Media',
  seo_meta_title:       'Social Media Marketing for SaaS | Virality',
  seo_meta_description: 'Build a strategic social media system for early-stage SaaS growth.',
  key_insights:         ['Platform selection determines reach ceiling', 'Consistency beats volume on all platforms'],
  content_blocks:       [],
};

// ── Card C (PlannerStrategicCard) ──────────────────────────────────────────

const cardC_cgi = {
  topic:               'Campaign Planning',
  selected_angle:      'Analytical framework for campaign planning in conversion consideration stage',
  trend_context:       'Marketing teams under pressure to demonstrate ROI within shorter quarters — campaign planning cycles compressing from 6 weeks to 2 weeks',
  uniqueness_directive:'',
  narrative_direction: 'Navigate from campaign intent to execution blueprint systematically',
  differentiation:     'Structured planning process vs ad-hoc campaign execution',
  must_include_points: ['Campaign planning must include success metric definition before brief approval'],
  key_messages:        ['Campaigns without pre-defined success metrics are expensive guesses'],
  audience:            'Marketing managers and campaign owners at growth-stage companies',
  tone:                'analytical, structured',
  hook_variants:       ['Most campaign briefs are approved before success metrics are defined — here is why this breaks campaigns'],
  strategic_core: {
    core_problem:        'Campaign planning is treated as a creative exercise when it is a strategic decisions process — success metrics are defined after launch not before',
    pain_points:         ['briefs approved without defined success metrics', 'campaign objectives misaligned with buyer stage', 'reporting built after campaign launch instead of before'],
    transformation_goal: 'Marketing manager can build a complete campaign brief with pre-defined success metrics and stage-aligned content plan in under 2 hours',
    authority_basis:     'Virality campaign planning module has processed 600+ campaigns with measurable post-campaign ROI data',
  },
  depth_map: [
    {
      pillar:            'Campaign Intent Definition',
      key_point:         'Every campaign must have a single measurable intent before brief approval',
      why_it_matters:    'Multi-intent campaigns produce diluted messaging and unmeasurable results',
      mechanism:         'Detailed explanation of HOW campaign intent definition works in practice',
      example_direction: 'Concrete campaign planning-specific example for intent definition',
      insight_angle:     'Evidence from campaign planning execution patterns',
      contrarian_take:   'Challenge the most common assumption about campaign intent',
    },
    {
      pillar:            'Audience Stage Alignment',
      key_point:         'Campaign content must match where the audience is in the buying process',
      why_it_matters:    'Stage misalignment produces engagement without conversion',
      mechanism:         'Detailed explanation of HOW audience stage alignment works in practice',
      example_direction: 'Concrete campaign planning-specific example for audience stage alignment',
      insight_angle:     'Evidence from campaign planning execution patterns',
      contrarian_take:   'Challenge the most common assumption about audience stage alignment',
    },
    {
      pillar:            'Success Metric Pre-Definition',
      key_point:         'Success metrics must be locked before campaign brief approval',
      why_it_matters:    'Post-launch metric definition enables HiPPO reporting not real performance measurement',
      mechanism:         'Detailed explanation of HOW success metric pre-definition works in practice',
      example_direction: 'Concrete campaign planning-specific example for success metric pre-definition',
      insight_angle:     'Evidence from campaign planning execution patterns',
      contrarian_take:   'Challenge the most common assumption about success metric pre-definition',
    },
    {
      pillar:            'Campaign Brief Architecture',
      key_point:         'A campaign brief is a decision document not a creative document',
      why_it_matters:    'Creative briefs optimise for aesthetics — decision briefs optimise for outcomes',
      mechanism:         'Detailed explanation of HOW campaign brief architecture works in practice',
      example_direction: 'Concrete campaign planning-specific example for brief architecture',
      insight_angle:     'Evidence from campaign planning execution patterns',
      contrarian_take:   'Challenge the most common assumption about campaign brief architecture',
    },
  ],
  decision_blocks: [{
    topic:          'Campaign Planning approach selection',
    comparisons:    ['Tactical execution vs. strategic framework — campaign approach', 'Manual campaign planning vs. system-driven brief — efficiency', 'Short-term campaign bursts vs. long-term content positioning'],
    trade_offs:     ['Speed vs. depth of strategic alignment in planning', 'Resource investment vs. compounding campaign returns', 'Customisation vs. scalability of campaign templates'],
    when_to_use:    ['When campaign success metrics are undefined before brief approval'],
    when_not_to_use:['When campaign cycle is under 3 days — structured planning overhead is not justified'],
  }],
  answers: {
    audience:           'Marketing managers and campaign owners at growth-stage companies',
    trend_context:      'Campaign planning cycles compressing from 6 weeks to 2 weeks under ROI pressure',
    must_include_points:'Campaign planning must include success metric definition before brief approval',
    company_context:    'Virality campaign planning module — 600+ campaigns with measurable post-campaign ROI data',
    campaign_objective: 'Drive conversion consideration — move evaluation-stage contacts to demo request',
    reader_stage:       'conversion consideration | building approval case | needs structured framework to present to CMO',
  },
  derived_angle: 'analytical',
  intent:        'authority',
  content_type:  'blog',
  goal:          'conversion',
  cluster:       'campaign-planning',
};

// BEFORE html: shallow on mechanisms/examples, generic on insight, no decision reality
const cardC_before_html = `
<div class="key-insights"><p>Campaign planning requires strategic thinking, not just creative briefing.</p></div>
<p>Campaign planning is a critical part of any marketing strategy. In today's competitive landscape, it is important to plan campaigns with precision and purpose. Best practices in campaign planning have evolved significantly.</p>

<h2>Campaign Intent Definition</h2>
<p>Every campaign needs a clear intent. This plays a crucial role in campaign success. Without a defined intent, campaigns lack direction and produce diluted results. Leveraging the power of a clear campaign intent helps teams stay focused.</p>

<h2>Audience Stage Alignment</h2>
<p>Aligning your campaign content with your audience stage is a well-known best practice. Teams need to understand where their audience is in the buying process. This is important for maximising conversion rates and campaign effectiveness.</p>

<h2>Success Metric Pre-Definition</h2>
<p>Defining success metrics before campaign launch is actionable and important. Moving the needle on campaign performance requires measurable goals. At the end of the day, what gets measured gets managed. This is a game changer for campaign accountability.</p>

<h2>Campaign Brief Architecture</h2>
<p>A well-structured campaign brief is the foundation of successful campaign execution. Synergizing creative requirements with strategic objectives produces better outcomes. Value-add comes from the quality of the brief, not just the creative.</p>

<h2>References</h2>
<p>HubSpot Marketing Statistics 2024. Demand Gen Report Campaign Planning Survey.</p>
`.trim();

const cardC_before_content = {
  title:                'Campaign Planning Framework for Marketing Managers',
  excerpt:              'Build campaigns with defined success metrics before brief approval.',
  content_html:         cardC_before_html,
  tags:                 ['campaign-planning', 'marketing-ops', 'growth'],
  category:             'Campaign Planning',
  seo_meta_title:       'Campaign Planning Framework | Virality',
  seo_meta_description: 'How to plan campaigns with pre-defined success metrics and stage-aligned content.',
  key_insights:         ['Success metrics must be locked before brief approval', 'Campaign briefs are decision documents not creative documents'],
  content_blocks:       [],
};

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildValidationObject(cardId, cgi, beforeContent) {
  const beforeSections = parseSections(beforeContent.content_html);

  const eng = runEngine(cgi, beforeContent);

  const { sections_improved, still_shallow_sections } = buildSectionImprovement(
    eng.depthReport, eng.depthReportAfter, beforeSections
  );

  const { generic_insights_remaining, strong_insight_sections } = buildInsightDetail(
    eng.insightReport, eng.insightReportAfter, beforeSections, eng.correctedParsed
  );

  const remaining_generic_sections = buildGenericDetail(eng.insightReportAfter, eng.correctedParsed);
  const fake_decision_blocks        = buildFakeDecisionDetail(eng.decisionReportAfter);

  const overcorrection = detectOvercorrection(eng.fixes, eng.correctedParsed, beforeSections);

  const regression = detectRegression(
    beforeSections, eng.correctedParsed,
    eng.before.depthScoreBefore,  eng.after.depthScoreAfter,
    eng.before.insightScoreBefore, eng.after.insightScoreAfter
  );

  const signal_usage = checkSignalUsage(cgi, eng.fixes, eng.correctedParsed);

  const { depthScoreBefore, insightScoreBefore, genericRatioBefore, decisionScoreBefore } = eng.before;
  const { depthScoreAfter,  insightScoreAfter,  genericRatioAfter,  decisionScoreAfter  } = eng.after;

  const depth_fixed    = depthScoreAfter    > depthScoreBefore;
  const insight_fixed  = insightScoreAfter  >= 75;
  const decision_fixed = decisionScoreAfter >= 70;
  const generic_fixed  = genericRatioAfter  <= 20;

  const production_ready = insight_fixed && generic_fixed && decision_fixed && !overcorrection.detected && !regression.present;

  return {
    card_id: cardId,
    depth_validation: {
      score_before:           depthScoreBefore,
      score_after:            depthScoreAfter,
      sections_improved,
      still_shallow_sections,
    },
    insight_validation: {
      score_before:               insightScoreBefore,
      score_after:                insightScoreAfter,
      generic_insights_remaining,
      strong_insight_sections,
    },
    generic_analysis: {
      before:                    genericRatioBefore,
      after:                     genericRatioAfter,
      remaining_generic_sections,
    },
    decision_validation: {
      score_before:      decisionScoreBefore,
      score_after:       decisionScoreAfter,
      fake_decision_blocks,
    },
    overcorrection,
    signal_usage,
    regression,
    final_verdict: {
      depth_fixed,
      insight_fixed,
      decision_fixed,
      generic_fixed,
      production_ready,
    },
    _fixes_applied: eng.fixes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const fixtures = [
  { id: 'A', cgi: cardA_cgi, before: cardA_before_content },
  { id: 'B', cgi: cardB_cgi, before: cardB_before_content },
  { id: 'C', cgi: cardC_cgi, before: cardC_before_content },
];

const results = fixtures.map(f => buildValidationObject(f.id, f.cgi, f.before));

// summary
function avg(arr) { return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length); }

const summary = {
  avg_depth_before:    avg(results.map(r => r.depth_validation.score_before)),
  avg_depth_after:     avg(results.map(r => r.depth_validation.score_after)),
  avg_insight_before:  avg(results.map(r => r.insight_validation.score_before)),
  avg_insight_after:   avg(results.map(r => r.insight_validation.score_after)),
  avg_generic_before:  avg(results.map(r => r.generic_analysis.before)),
  avg_generic_after:   avg(results.map(r => r.generic_analysis.after)),
  avg_decision_before: avg(results.map(r => r.decision_validation.score_before)),
  avg_decision_after:  avg(results.map(r => r.decision_validation.score_after)),
  pass_conditions: {
    insight_after_ge_75:    results.every(r => r.insight_validation.score_after >= 75),
    generic_after_le_20:    results.every(r => r.generic_analysis.after <= 20),
    decision_after_ge_70:   results.every(r => r.decision_validation.score_after >= 70),
    no_overcorrection:      results.every(r => !r.overcorrection.detected),
    no_regression:          results.every(r => !r.regression.present),
  },
  overall_pass: results.every(r => r.final_verdict.production_ready),
};

const output = { results, summary };
console.log(JSON.stringify(output, null, 2));
