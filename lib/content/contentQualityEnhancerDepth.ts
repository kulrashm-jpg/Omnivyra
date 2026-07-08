/**
 * Content Quality Enhancer — depth enforcement layer (Step 1, v2.3).
 *
 * Structured synthetic signals + mechanism/example/decision generators +
 * enforceDepth. Split from contentQualityEnhancer_v2_1.ts (Agent-B large-file
 * modularization).
 */
import { wordCount } from '../../pages/blogs.helpers';
import type { ContentGenerationInput, DepthMapEntry } from './cardToContentBridge';
import {
  type ParsedSection,
  MECHANISM_RE, EXAMPLE_RE, INSIGHT_RE,
  MAX_SECTION_WORDS, MAX_DEPTH_WORDS, MAX_DECISION_WORDS, MAX_TOTAL_INJECTION, SIGNAL_POVERTY_THRESHOLD,
  tokenize, isTemplate, esc, stripHtml,
  evalDepthState, matchDepthEntry,
} from './contentQualityEnhancerCore';

// ── v2.3: Structured synthetic signals ───────────────────────────────────────

export interface SyntheticSignals {
  actor:           string;   // who is acting (audience / practitioner type)
  constraint:      string;   // the core limiting condition
  failure_mode:    string;   // what goes wrong without this
  desired_outcome: string;   // what success looks like
}

/**
 * v2.3: Derive structured synthetic signals for signal-poor cards.
 * Returns an object with actor/constraint/failure_mode/desired_outcome
 * used by the three structured generators below.
 */
export function deriveSyntheticSignals(cgi: ContentGenerationInput): SyntheticSignals {
  const audienceWords = cgi.audience
    ? cgi.audience.split(/[,\s]+/).filter((w) => w.length > 3).slice(0, 2).join(' ')
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
    cgi.strategic_core.transformation_goal ||
    cgi.key_messages[0] ||
    `improved results through systematic ${cgi.topic.toLowerCase()}`;

  return { actor, constraint, failure_mode, desired_outcome };
}

/**
 * v2.3: Generate a mechanism with causal step structure.
 * MUST include "Step" or "works by" or "because" — no abstract assertions.
 */
export function generateMechanism(
  heading:  string,
  dmMech:   string,
  signals:  SyntheticSignals,
): string {
  if (!isTemplate(dmMech) && dmMech.length > 20) return dmMech;

  const topic = heading || 'this approach';
  return [
    `Step 1: ${signals.actor} identify where ${signals.constraint.toLowerCase()}.`,
    `Step 2: Apply the ${topic.toLowerCase()} process by resolving the core blocker in sequence rather than all at once.`,
    `Step 3: Measure the outcome against ${signals.desired_outcome.toLowerCase()}.`,
    `Because ${signals.failure_mode.toLowerCase()}, each step must complete before the next begins — skipping steps reintroduces the original failure mode.`,
  ].join(' ');
}

/**
 * v2.3: Generate a specific example with actor, context, and outcome.
 */
export function generateExample(
  heading:  string,
  dmEx:     string,
  signals:  SyntheticSignals,
): string {
  if (!isTemplate(dmEx) && dmEx.length > 20) return dmEx;

  const topic = heading || 'this';
  return (
    `For example, a ${signals.actor} team facing ${signals.constraint.toLowerCase()} ` +
    `applied ${topic.toLowerCase()} systematically and achieved ${signals.desired_outcome.toLowerCase()}. ` +
    `In practice, the key difference was sequencing the work so each stage produced a measurable result ` +
    `before the next was started — which resulted in faster adoption and reduced rework.`
  );
}

/**
 * v2.3: Generate actionable decision language.
 * MUST include "Use this when", "Avoid this when", "Choose this if".
 */
export function generateDecision(
  heading:  string,
  dmWhy:    string,
  signals:  SyntheticSignals,
): string {
  const context = !isTemplate(dmWhy) && dmWhy.length > 20
    ? dmWhy
    : signals.desired_outcome;

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

/** Returns true if injecting `text` into `body` would create detectable redundancy. */
export function wouldBeRedundant(body: string, text: string): boolean {
  if (!text || text.length < 10) return true;
  // Sample the first 8 tokens of the candidate injection
  const injTokens = tokenize(text).slice(0, 8);
  if (injTokens.length === 0) return true;
  const bodyText  = stripHtml(body).toLowerCase();
  // If ≥ 5 of the 8 leading tokens already appear in the body, skip
  const hits = injTokens.filter((t) => bodyText.includes(t)).length;
  return hits >= 5;
}

export interface EnforceDepthResult {
  sections:     ParsedSection[];
  fixes:        string[];
  rewritten:    string[];
  shallowFixed: number;
  overcorrectionDetected: boolean;
}

export function enforceDepth(
  sections: ParsedSection[],
  cgi:      ContentGenerationInput,
): EnforceDepthResult {
  const fixes: string[]     = [];
  const rewritten: string[] = [];
  let shallowFixed          = 0;
  let overcorrectionDetected = false;

  // ── Signal preparation ─────────────────────────────────────────────────────
  const primarySignalText = [
    cgi.topic, cgi.selected_angle, cgi.trend_context, cgi.uniqueness_directive,
    ...cgi.must_include_points,
    ...Object.values(cgi.answers),
    ...cgi.key_messages,
  ].filter(Boolean).join(' ');
  const signalTokenCount = tokenize(primarySignalText).length;

  // v2.3: always derive structured synth signals; used when signal-poor
  if (signalTokenCount < SIGNAL_POVERTY_THRESHOLD) {
    fixes.push(`signal-poverty → synthetic signals derived from topic/angle/trend (primaryTokens=${signalTokenCount})`);
  }

  let evaluableIdx = 0;

  const updated = sections.map((section) => {
    if (section.is_reference || section.is_key_insights) return section;

    const wcBefore = wordCount(section.body);
    const ds        = evalDepthState(section.body, wcBefore);

    // Stop injection (but not insight guarantee) when over ceiling
    const overCeiling = wcBefore >= MAX_SECTION_WORDS;

    const dmEntry = matchDepthEntry(section.heading, evaluableIdx, cgi.depth_map);
    evaluableIdx++;

    let body                  = section.body;
    let depthWordsInjected    = 0;   // mechanism + example + insight
    let decisionWordsInjected = 0;   // decision only (v2.5 independent budget)
    let changed               = false;

    if (!overCeiling) {
      // ── v2.3: structured signal object (real or synthetic) ────────────────
      const synth: SyntheticSignals = signalTokenCount < SIGNAL_POVERTY_THRESHOLD
        ? deriveSyntheticSignals(cgi)
        : {
            actor:           cgi.audience || `${cgi.topic} practitioners`,
            constraint:      cgi.selected_angle.split(/[.!?]/)[0].trim(),
            failure_mode:    cgi.strategic_core.core_problem.split(/[.!?]/)[0].trim(),
            desired_outcome: cgi.strategic_core.transformation_goal || cgi.key_messages[0] || cgi.topic,
          };

      // v2.3 fix 1: Real mechanism — step/causal structure guaranteed
      const mechanismText = generateMechanism(section.heading, dmEntry.mechanism, synth);
      // v2.3 fix 4: Real example — actor + context + outcome
      const exampleText   = generateExample(section.heading, dmEntry.example_direction, synth);
      // Insight: depth_map contrarian_take if real; else signal-derived
      const insightText   = !isTemplate(dmEntry.contrarian_take) && dmEntry.contrarian_take.length > 20
        ? dmEntry.contrarian_take
        : `The key insight: ${synth.desired_outcome}. ` +
          `However, ${synth.failure_mode.toLowerCase()} — which means the teams that succeed address ` +
          `${synth.constraint.toLowerCase()} before scaling effort.`;
      // v2.3 fix 3: Real decision language — use/avoid/choose
      const decisionText  = generateDecision(section.heading, dmEntry.why_it_matters, synth);

      // ── v2.5 fix 1+2: split budget — depth vs decision, total cap reserves decision slot ──
      const decisionWords         = tokenize(decisionText).length;
      const decisionWillFire      = decisionWords <= MAX_DECISION_WORDS;
      const effectiveDepthBudget  = decisionWillFire
        ? Math.min(MAX_DEPTH_WORDS, MAX_TOTAL_INJECTION - decisionWords)
        : MAX_DEPTH_WORDS;

      // ── v2.3 fix 2: completeness overrides redundancy for insight + example ─
      const tryInject = (
        missing:            boolean,
        rawValue:           string,
        label:              string,
        prefix:             string,
        overrideRedundancy: boolean = false,
      ): void => {
        if (!missing) return;
        if (isTemplate(rawValue)) { fixes.push(`[${section.id}] ${label}: template — skipped`); return; }
        if (!overrideRedundancy && wouldBeRedundant(body, rawValue)) {
          fixes.push(`[${section.id}] ${label}: redundant — skipped`);
          return;
        }
        const candidateWords = tokenize(rawValue).length;
        if (depthWordsInjected + candidateWords > effectiveDepthBudget) {
          fixes.push(`[${section.id}] ${label}: depth budget exhausted (${depthWordsInjected}+${candidateWords}>${effectiveDepthBudget}) — skipped`);
          return;
        }
        body                = `${body}\n<p><strong>${prefix}</strong> ${esc(rawValue)}</p>`;
        depthWordsInjected += candidateWords;
        fixes.push(`[${section.id}] ${label} injected`);
        changed = true;
      };

      tryInject(!ds.mechanism, mechanismText, 'mechanism', 'How this works:',          true);
      tryInject(!ds.example,   exampleText,   'example',   'In practice:',             true);
      tryInject(!ds.insight,   insightText,   'insight',   'The strategic implication:', true);

      // v2.5: decision injection — fire only when section lacks BOTH full Use/Avoid/Choose
      // structure AND any legacy actionable language (when to use, should you, etc.).
      const hasFullDecisionStructure =
        body.includes('Use this when') &&
        body.includes('Avoid this when') &&
        body.includes('Choose this if');
      const hasLegacyActionable = /\b(when to use|should you|if you (?:are|have|need)|before choosing|apply this when|use this when)\b/i.test(stripHtml(body));
      if (!hasFullDecisionStructure && !hasLegacyActionable) {
        if (decisionWordsInjected + decisionWords <= MAX_DECISION_WORDS) {
          body = `${body}\n<p><strong>What this means for decision-making:</strong> ${esc(decisionText)}</p>`;
          decisionWordsInjected += decisionWords;
          fixes.push(`[${section.id}] decision-depth link injected`);
          changed = true;
        }
      }
    }

    // ── v2.3 fix 5: Insight guarantee — applies even when over ceiling ──────
    // v2.5: also match plain-text versions (no <strong> tag) so sections with existing
    // strategic implication / key insight prose don't get redundant injection.
    const KEY_INSIGHT_PRESENT        = /<strong>Key Insight:<\/strong>|key insight:/i;
    const STRATEGIC_IMPL_PRESENT     = /<strong>The strategic implication:<\/strong>|the strategic implication:/i;
    if (!KEY_INSIGHT_PRESENT.test(body) && !STRATEGIC_IMPL_PRESENT.test(body)) {
      const insightGuarantee = !isTemplate(dmEntry.insight_angle) && dmEntry.insight_angle.length > 20
        ? dmEntry.insight_angle
        : !isTemplate(dmEntry.contrarian_take) && dmEntry.contrarian_take.length > 20
          ? dmEntry.contrarian_take
          : `Teams that apply this systematically outperform those that treat it as a one-time task — ` +
            `which means treating ${section.heading.toLowerCase()} as an ongoing process is the ` +
            `highest-leverage change you can make.`;
      body    = `${body}\n<p><strong>Key Insight:</strong> ${esc(insightGuarantee)}</p>`;
      fixes.push(`[${section.id}] insight guarantee appended`);
      changed = true;
    }

    // Anti-bloat check — v2.5: ceiling-based, not delta-based.
    // Delta-based checks false-positively flag stub sections that legitimately grow a lot.
    const wcAfter = wordCount(body);
    if (wcAfter > MAX_SECTION_WORDS) {
      overcorrectionDetected = true;
      fixes.push(`[${section.id}] WARN: section is ${wcAfter} words — exceeds section ceiling`);
    }

    if (changed) {
      shallowFixed++;
      rewritten.push(`[${section.id}] "${section.heading}"`);
    }

    return { ...section, body };
  });

  return { sections: updated, fixes, rewritten, shallowFixed, overcorrectionDetected };
}
