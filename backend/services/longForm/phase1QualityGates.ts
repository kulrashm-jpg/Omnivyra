/**
 * Phase 1 — Quality false-positive prevention gates.
 *
 * The structural / keyword / POV-overlap scorers reward format and vocabulary
 * but do not detect publishing defects a human editor would flag instantly:
 * leaked planner instructions, unresolved placeholders, frameworks that are
 * named but never delivered, and titles that promise an artifact the body
 * never provides. This module detects those defect CLASSES (not a fixed phrase
 * list) and emits a score CAP so a defective article cannot surface as high
 * quality.
 *
 * Scope discipline (Phase 1):
 *  - Pure detection + cap calculation. No scoring weights are changed, no
 *    generation behavior is touched. The caller decides how to apply the cap.
 *  - Fully additive: a clean article produces an empty report and is unaffected.
 *
 * Detection bias: tuned to be conservative (low false-positive) because a cap
 * can block publication. Patterns require grammatical structure (subject +
 * directive verb, claim phrasing + framework noun), not bare keywords.
 */

export type Phase1GateId =
  | 'publishing_readiness'
  | 'placeholder'
  | 'framework_delivery'
  | 'promise_fulfillment';

export interface Phase1GateTrigger {
  gate: Phase1GateId;
  severity: 'critical' | 'high';
  /** Detection class that matched (which pattern family / rule). */
  detector: string;
  /** Human-readable issue, pushed into the validator's issues[]. */
  issue: string;
  /** Exact substring that triggered the gate — telemetry / editor diagnostics. */
  triggeringText: string;
  /** Maximum TOTAL quality score permitted while this gate is active. */
  scoreCap: number;
}

export interface Phase1GateReport {
  triggered: Phase1GateTrigger[];
  /** min() of every triggered cap, or null when nothing fired. */
  scoreCap: number | null;
  /** Cap for the framework SUBSCORE when framework-delivery fails (else null). */
  frameworkScoreCap: number | null;
}

const GATE_CAP: Record<Phase1GateId, number> = {
  publishing_readiness: 70,
  placeholder: 60,
  framework_delivery: 70,
  promise_fulfillment: 65,
};

const FRAMEWORK_SUBSCORE_CAP = 50;

function stripHtml(value: string): string {
  return (value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Bounded context window around a match, for human-readable telemetry. */
function snippet(source: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(source.length, index + length + 24);
  return `${start > 0 ? '…' : ''}${source.slice(start, end).trim()}${end < source.length ? '…' : ''}`;
}

interface NamedPattern {
  detector: string;
  pattern: RegExp;
}

function firstPatternMatch(text: string, patterns: NamedPattern[]): { detector: string; text: string } | null {
  for (const { detector, pattern } of patterns) {
    const m = pattern.exec(text);
    if (m && m[0].trim()) {
      return { detector, text: snippet(text, m.index, m[0].length) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gate 1 — Publishing Readiness (leaked planner / meta-writing instructions)
// ---------------------------------------------------------------------------
// Each pattern targets a STRUCTURE of authoring instruction, so paraphrases of
// the same defect class are caught without enumerating phrases.
const PUBLISHING_ARTIFACT_PATTERNS: NamedPattern[] = [
  // "This / each / the following section should | must | is meant to | serves to …"
  { detector: 'section-directive', pattern: /\b(this|each|every|the\s+(following|next|above|preceding|first|second|final))\s+(section|sub-?section|paragraph|chapter|part|segment|heading)\s+(should|shall|must|will|needs?\s+to|is\s+(meant|intended|designed|supposed)\s+to|serves?\s+to|exists?\s+to|aims?\s+to|is\s+there\s+to|has\s+to)\b/i },
  // "The purpose | goal | job | role of this section | article is …"
  { detector: 'purpose-statement', pattern: /\bthe\s+(purpose|goal|objective|intent|aim|job|role|function|point)\s+of\s+(this|the\s+(following|next)|each)\s+(section|sub-?section|paragraph|article|piece|part|chapter|segment)\b/i },
  // "Use this section to …"
  { detector: 'use-this-to', pattern: /\buse\s+(this|the\s+(following|next))\s+(section|sub-?section|paragraph|space|area|block|part)\s+to\b/i },
  // "(must) serve a separate / distinct reader | search | audience job | need | intent"
  { detector: 'reader-job', pattern: /\b(serve|serves|must\s+serve|fulfil|fulfill|fulfils|fulfills|address(?:es)?|satisfy|satisfies|answer|answers)\s+(a|the|its|their|each|one)\s+(separate|distinct|different|own|specific|unique|standalone)?\s*(reader|user|audience|search(?:er)?|visitor)\s+(job|jobs|need|needs|intent|intents|goal|goals|task|tasks|question|questions)\b/i },
  // "In this section, we will | you should | the reader | let's …"
  { detector: 'meta-narration', pattern: /\bin\s+this\s+(section|article|paragraph|chapter|part|guide),?\s+(we['’]?(?:ll|\s+will|\s+are\s+going\s+to)|i['’]?(?:ll|\s+will)|you\s+(should|will|can|must|need|are\s+going\s+to)|the\s+reader|let['’]?s)\b/i },
  // Imperative addressed to the author / generator, anchored to "here | below | in this section"
  { detector: 'writer-instruction', pattern: /\b(write|insert|add|include|provide|describe|explain|outline|summari[sz]e|elaborate|expand|draft|mention|cover|list)\s+(a|an|the|your|\d+[-\s]?\d*|two|three|several|some|relevant)\b[^.]{0,80}\b(here|below|above|in\s+this\s+(section|paragraph)|for\s+this\s+section)\b/i },
  // Authoring / editorial guidance markers
  { detector: 'authoring-guidance', pattern: /\b(remember\s+to|make\s+sure\s+to|be\s+sure\s+to|don['’]?t\s+forget\s+to|note\s+to\s+(self|writer|editor)|writer['’]?s\s+note|editor['’]?s\s+note|\[?\s*(note|tip|todo)\s*:)\b/i },
  // AI / model self-reference leaking into reader-facing prose
  { detector: 'ai-self-reference', pattern: /\bas\s+an?\s+(ai|a\.i\.|language\s+model|large\s+language\s+model|llm|assistant|chatbot)\b/i },
  // The template describing itself ("this section provides a generic / sample …")
  { detector: 'template-description', pattern: /\bthis\s+(section|paragraph|article)\s+(is|provides|offers|contains)\s+(a|an|the)?\s*(generic|sample|example|placeholder|template|boilerplate|dummy)\b/i },
];

// ---------------------------------------------------------------------------
// Gate 2 — Placeholder (unresolved template variables / fill-in markers)
// ---------------------------------------------------------------------------
const PLACEHOLDER_PATTERNS: NamedPattern[] = [
  { detector: 'mustache', pattern: /\{\{\s*[\w.\-]+\s*\}\}/ },                                   // {{company_name}}
  { detector: 'angle-token', pattern: /<\s*[A-Z][A-Z0-9_]{2,}\s*>/ },                            // <INSERT_NAME>
  { detector: 'bracket-directive', pattern: /\[\s*(INSERT|TODO|PLACEHOLDER|TBD|FIXME|XXX|EXAMPLE|YOUR\b[^\]]*|COMPANY(?:[ _]NAME)?|PRODUCT(?:[ _]NAME)?|NAME|DATE|LINK|URL|CITATION|SOURCE|STAT(?:ISTIC)?|NUMBER|METRIC)\b[^\]]*\]/i },
  { detector: 'bare-marker', pattern: /(^|[\s(>—-])(TBD|FIXME|XXX|PLACEHOLDER|TKTK)([\s).,;:<—-]|$)/ }, // standalone journalism / dev markers
  { detector: 'todo-marker', pattern: /\bTODO\b/ },
  { detector: 'lorem-ipsum', pattern: /\blorem\s+ipsum\b/i },
];

// ---------------------------------------------------------------------------
// Gate 3 — Framework Delivery (named/claimed framework must be delivered)
// ---------------------------------------------------------------------------
const STRONG_FRAMEWORK_NOUNS = '(framework|methodology|maturity\\s+model|diagnostic\\s+model|decision\\s+matrix|scorecard|playbook|blueprint)';

// A CLAIM that the article presents/uses a framework — possessive/introductory
// phrasing, or a Proper-Case named framework. Bare "model"/"system"/"matrix"
// are intentionally excluded (too common: "operating model", "the system").
const FRAMEWORK_CLAIM_PATTERNS: NamedPattern[] = [
  {
    detector: 'framework-claim',
    pattern: new RegExp(
      `\\b(our|my|this|the|a|an|propose[sd]?|present(?:s|ed)?|introduc\\w+|develop(?:ed|s)?|created|built|use|using|appl(?:y|ies|ying)|follow(?:s|ing)?|call(?:ed)?\\s+(?:it|this|ours)?)\\s+(?:[\\w'’-]+\\s+){0,3}${STRONG_FRAMEWORK_NOUNS}\\b`,
      'i',
    ),
  },
  {
    detector: 'framework-named',
    pattern: /\b([A-Z][A-Za-z0-9&'’-]+(?:\s+[A-Z][A-Za-z0-9&'’-]+){0,4})\s+(Framework|Methodology|Matrix|Scorecard|Playbook|Blueprint)\b/,
  },
];

// ---------------------------------------------------------------------------
// Boilerplate-aware structure analysis (shared by Framework + Promise gates).
//
// The hardening: a framework/checklist/roadmap/comparison is only "delivered"
// if the supporting structure is CONTENT — never a references list, key-insights
// list, FAQ, related-reading, navigation, or summary. Two recognition paths:
//   • System #2 marks such blocks with `data-omni-boilerplate` (exact).
//   • Raw generated HTML (System #1) is recognised by its section heading.
// Framework delivery additionally must be CO-LOCATED with the claim (same or
// adjacent content section), not anywhere in the article.
// ---------------------------------------------------------------------------
const BOILERPLATE_HEADING = /\b(references?|sources?|citations?|bibliography|footnotes?|faq|frequently\s+asked|related\s+(reading|articles?|posts?|content|links?)|further\s+reading|see\s+also|navigation|key\s+(insights?|takeaways?)|takeaways?|tl;?dr|in\s+(summary|conclusion)|conclusion|about\s+(the\s+)?(author|us)|disclaimer)\b/i;
const BOILERPLATE_LIST = /<(ul|ol)\b[^>]*\bdata-omni-boilerplate\b[^>]*>[\s\S]*?<\/\1>/gi;

interface Segment { heading: string; html: string; text: string; boilerplate: boolean; }

/** Split HTML into sections at heading boundaries; flag boilerplate sections. */
function segmentByHeadings(html: string): Segment[] {
  const make = (heading: string, chunk: string): Segment => ({
    heading, html: chunk, text: stripHtml(chunk), boilerplate: BOILERPLATE_HEADING.test(heading),
  });
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  if (headings.length === 0) return [make('', html)];
  const segs: Segment[] = [];
  const firstIdx = headings[0].index ?? 0;
  if (firstIdx > 0) segs.push(make('', html.slice(0, firstIdx)));
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index ?? 0;
    const end = i + 1 < headings.length ? (headings[i + 1].index ?? html.length) : html.length;
    segs.push(make(stripHtml(headings[i][2] ?? ''), html.slice(start, end)));
  }
  return segs;
}

/** <li> count after removing boilerplate-marked lists — i.e. content list items only. */
function contentListItemCount(html: string): number {
  return ((html.replace(BOILERPLATE_LIST, ' ').match(/<li\b/gi)) ?? []).length;
}
/** Non-boilerplate sections only, with marked lists removed. */
function contentOnlyHtml(html: string): string {
  const noMarked = html.replace(BOILERPLATE_LIST, ' ');
  return segmentByHeadings(noMarked).filter((s) => !s.boilerplate).map((s) => s.html).join('\n');
}
function enumeratedStageCount(text: string): number {
  return (text.match(/\b(step|phase|stage|pillar|principle|component|dimension|layer|tier|element|lever|quadrant)s?\s+(\d+|one|two|three|four|five|six|first|second|third|fourth|fifth)\b/gi) ?? []).length;
}
function numberedPointCount(text: string): number {
  return (text.match(/(?:^|\s)\d\.\s+[A-Z]/g) ?? []).length;
}

/** Does a single section contain real (content) framework-delivery structure? */
function segmentDelivers(seg: Segment): boolean {
  if (seg.boilerplate) return false;
  return contentListItemCount(seg.html) >= 3
    || /<table\b/i.test(seg.html)
    || enumeratedStageCount(seg.text) >= 3
    || numberedPointCount(seg.text) >= 3;
}

/** Framework claim located in a CONTENT section (skips references/FAQ/etc). */
function findFrameworkClaim(segments: Segment[]): { index: number; text: string } | null {
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].boilerplate) continue;
    const m = firstPatternMatch(segments[i].text, FRAMEWORK_CLAIM_PATTERNS);
    if (m) return { index: i, text: m.text };
  }
  return null;
}

/** Delivery must be co-located: the claim's section, or the next content section. */
function frameworkDeliveredNearClaim(segments: Segment[], claimIndex: number): boolean {
  if (segmentDelivers(segments[claimIndex])) return true;
  for (let j = claimIndex + 1; j < segments.length; j++) {
    if (segments[j].boilerplate) continue;
    return segmentDelivers(segments[j]); // first content section after the claim
  }
  return false;
}

/** Any content delivery anywhere (used for title-promise 'framework'/'matrix'). */
function contentHasDelivery(contentHtml: string): boolean {
  const text = stripHtml(contentHtml);
  return contentListItemCount(contentHtml) >= 3
    || /<table\b/i.test(contentHtml)
    || enumeratedStageCount(text) >= 3
    || numberedPointCount(text) >= 3;
}

// ---------------------------------------------------------------------------
// Gate 4 — Promise Fulfillment (title promises an artifact the body lacks).
// All helpers below receive CONTENT-ONLY html (boilerplate already removed).
// ---------------------------------------------------------------------------
function listItemCount(html: string): number {
  return (html.match(/<li\b/gi) ?? []).length;
}
function headingCount(html: string): number {
  return (html.match(/<h[2-4]\b/gi) ?? []).length;
}
function comparisonSignals(html: string): number {
  const text = stripHtml(html).toLowerCase();
  return (text.match(/\b(versus|vs\.?|compared\s+to|in\s+contrast|whereas|unlike|on\s+the\s+other\s+hand|trade-?off|pros\s+and\s+cons)\b/g) ?? []).length;
}

interface PromiseSpec {
  artifact: string;
  titlePattern: RegExp;
  fulfilled: (html: string) => boolean;
}

const PROMISE_SPECS: PromiseSpec[] = [
  {
    artifact: 'checklist',
    titlePattern: /\bcheck-?list\b/i,
    fulfilled: (html) => listItemCount(html) >= 3 || /(☐|☑|✓|\[\s?\]|\[\s?[xX]\s?\])/.test(html),
  },
  {
    artifact: 'roadmap',
    titlePattern: /\broad-?map\b/i,
    fulfilled: (html) => {
      const text = stripHtml(html);
      const stages = (text.match(/\b(phase|stage|step|quarter|q[1-4]|month|milestone|year)\s+(\d+|one|two|three|first|second|third)\b/gi) ?? []).length;
      return stages >= 3 || listItemCount(html) >= 3;
    },
  },
  {
    artifact: 'comparison',
    titlePattern: /\b(comparison|compared|vs\.?|versus|head-to-head)\b/i,
    fulfilled: (html) => /<table\b/i.test(html) || comparisonSignals(html) >= 2,
  },
  {
    artifact: 'decision matrix',
    titlePattern: /\b(decision\s+matrix|decision\s+framework|decision\s+tree)\b/i,
    fulfilled: (html) => /<table\b/i.test(html) || contentHasDelivery(html),
  },
  {
    artifact: 'framework',
    titlePattern: /\b(framework|methodology|scorecard|playbook|blueprint|operating\s+model)\b/i,
    fulfilled: (html) => contentHasDelivery(html),
  },
  {
    artifact: 'template',
    titlePattern: /\btemplate\b/i,
    fulfilled: (html) => /<table\b/i.test(html) || /<pre\b/i.test(html) || /<code\b/i.test(html) || listItemCount(html) >= 3,
  },
  {
    artifact: 'step-by-step',
    titlePattern: /\b(step-by-step|step\s+by\s+step|how\s+to)\b/i,
    fulfilled: (html) => {
      const text = stripHtml(html);
      const steps = (text.match(/\b(step|phase|stage)\s+(\d+|one|two|three|first|second|third)\b/gi) ?? []).length;
      return steps >= 3 || listItemCount(html) >= 3 || headingCount(html) >= 3;
    },
  },
];

/** "7 strategies", "5 steps", "10 ways", "12 tips" → body must roughly deliver N items. */
function evaluateListiclePromise(title: string, html: string): { promisedN: number; have: number } | null {
  const m = /\b(\d{1,2})\s+(ways?|steps?|tips?|strategies|tactics|principles?|reasons?|lessons?|rules?|mistakes?|examples?|methods?|techniques?|ideas?|factors?|signs?|metrics?)\b/i.exec(title);
  if (!m) return null;
  const promisedN = parseInt(m[1], 10);
  if (!Number.isFinite(promisedN) || promisedN < 3 || promisedN > 30) return null;
  const have = Math.max(listItemCount(html), headingCount(html));
  return { promisedN, have };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
export function evaluatePhase1QualityGates(input: { title: string; contentHtml: string }): Phase1GateReport {
  const title = input.title || '';
  const html = input.contentHtml || '';
  const bodyText = stripHtml(html);
  const triggered: Phase1GateTrigger[] = [];

  // Gate 1 — Publishing Readiness
  const artifact = firstPatternMatch(bodyText, PUBLISHING_ARTIFACT_PATTERNS);
  if (artifact) {
    triggered.push({
      gate: 'publishing_readiness',
      severity: 'critical',
      detector: artifact.detector,
      issue: `Publishing Readiness Gate: leaked authoring/meta instruction (${artifact.detector}): "${artifact.text}"`,
      triggeringText: artifact.text,
      scoreCap: GATE_CAP.publishing_readiness,
    });
  }

  // Gate 2 — Placeholder (scan raw HTML so {{ }}, <TOKEN>, [INSERT] survive)
  const placeholder = firstPatternMatch(html, PLACEHOLDER_PATTERNS);
  if (placeholder) {
    triggered.push({
      gate: 'placeholder',
      severity: 'critical',
      detector: placeholder.detector,
      issue: `Placeholder Gate: unresolved placeholder (${placeholder.detector}): "${placeholder.text}"`,
      triggeringText: placeholder.text,
      scoreCap: GATE_CAP.placeholder,
    });
  }

  // Gate 3 — Framework Delivery. The claim AND its delivery evidence must be
  // co-located in the same (or the adjacent) content section. References /
  // key-insights / FAQ lists no longer count as delivery.
  const segments = segmentByHeadings(html);
  const fwClaim = findFrameworkClaim(segments);
  let frameworkScoreCap: number | null = null;
  if (fwClaim && !frameworkDeliveredNearClaim(segments, fwClaim.index)) {
    frameworkScoreCap = FRAMEWORK_SUBSCORE_CAP;
    triggered.push({
      gate: 'framework_delivery',
      severity: 'high',
      detector: 'framework-claim',
      issue: `Framework Delivery Gate: framework/methodology claimed ("${fwClaim.text}") but not delivered near the claim (no co-located enumerated steps, stages, components, or table — references/key-insights lists do not count)`,
      triggeringText: fwClaim.text,
      scoreCap: GATE_CAP.framework_delivery,
    });
  }

  // Gate 4 — Promise Fulfillment. Evidence must be CONTENT — boilerplate
  // sections (references / FAQ / related reading) and marked lists are removed
  // so a references list cannot fulfil a framework promise, nor an FAQ a
  // checklist promise.
  const content = contentOnlyHtml(html);
  for (const spec of PROMISE_SPECS) {
    if (spec.titlePattern.test(title) && !spec.fulfilled(content)) {
      triggered.push({
        gate: 'promise_fulfillment',
        severity: 'high',
        detector: `title-promise:${spec.artifact}`,
        issue: `Promise Fulfillment Gate: title promises a ${spec.artifact} the body does not deliver`,
        triggeringText: title.trim(),
        scoreCap: GATE_CAP.promise_fulfillment,
      });
      break; // one promise failure is enough to cap
    }
  }
  const listicle = evaluateListiclePromise(title, content);
  if (listicle && listicle.have < Math.ceil(listicle.promisedN * 0.7)) {
    triggered.push({
      gate: 'promise_fulfillment',
      severity: 'high',
      detector: 'title-promise:listicle',
      issue: `Promise Fulfillment Gate: title promises ${listicle.promisedN} items but body delivers ~${listicle.have}`,
      triggeringText: title.trim(),
      scoreCap: GATE_CAP.promise_fulfillment,
    });
  }

  const scoreCap = triggered.length > 0 ? Math.min(...triggered.map((t) => t.scoreCap)) : null;
  return { triggered, scoreCap, frameworkScoreCap };
}
