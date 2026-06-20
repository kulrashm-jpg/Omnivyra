/**
 * Editorial Text Refinement
 *
 * Always-on, deterministic grammar cleanup for short generated copy that is
 * reused across strategy cards, weekly topics, subject lines, and post text.
 * This is intentionally rule-based so the safety net is available even when
 * the broader language refinement feature flag is disabled.
 */

type RefinementKind = 'headline' | 'subject' | 'body';

const MONTHS: Record<string, string> = {
  jan: 'January',
  january: 'January',
  feb: 'February',
  february: 'February',
  mar: 'March',
  march: 'March',
  apr: 'April',
  april: 'April',
  may: 'May',
  jun: 'June',
  june: 'June',
  jul: 'July',
  july: 'July',
  aug: 'August',
  august: 'August',
  sep: 'September',
  sept: 'September',
  september: 'September',
  oct: 'October',
  october: 'October',
  nov: 'November',
  november: 'November',
  dec: 'December',
  december: 'December',
};

const ACRONYMS = new Set(['AI', 'API', 'SEO', 'SaaS', 'CRM', 'B2B', 'B2C', 'ROI', 'KPI', 'UX', 'UI', 'HR']);
const SMALL_TITLE_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);
const DANGLING_WORDS = new Set([
  ...SMALL_TITLE_WORDS,
  'about', 'across', 'against', 'along', 'among', 'around', 'before', 'behind', 'below',
  'beneath', 'beside', 'between', 'beyond', 'during', 'inside', 'near', 'off', 'outside',
  'over', 'past', 'through', 'toward', 'towards', 'under', 'until', 'upon',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'my', 'your', 'our', 'their', 'his', 'her', 'its',
]);

type LaunchPhrase = {
  original: string;
  object: string;
  month?: string;
  year?: string;
};

function normalizeWhitespace(text: string): string {
  return String(text ?? '').replace(/[ \t\u00a0]+/g, ' ').replace(/\s+\n/g, '\n').trim();
}

function normalizeMonthToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return MONTHS[token.toLowerCase().replace(/\.$/, '')];
}

function expandMonthNames(text: string): string {
  return text.replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\b/gi, (m) => MONTHS[m.toLowerCase().replace(/\.$/, '')] ?? m);
}

function stripDanglingTrailingWords(text: string): string {
  const parts = normalizeWhitespace(text).split(/\s+/).filter(Boolean);
  let removed = false;
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!.replace(/[.,;:!?\-]+$/, '').toLowerCase();
    if (!DANGLING_WORDS.has(last)) break;
    parts.pop();
    removed = true;
  }
  const joined = parts.join(' ').trim();
  return removed ? joined.replace(/[.,;:!?\-]+$/, '').trim() : joined;
}

function titleCase(text: string): string {
  const words = normalizeWhitespace(text).split(/\s+/);
  return words.map((word, index) => {
    const bare = word.replace(/^[^\w]+|[^\w]+$/g, '');
    const upper = bare.toUpperCase();
    if (ACRONYMS.has(upper)) return word.replace(bare, upper);
    if (/^\d{4}$/.test(bare)) return word;
    if (/^[A-Z][A-Za-z0-9]*['’]s$/.test(bare)) return word;

    const lower = bare.toLowerCase();
    if (index > 0 && SMALL_TITLE_WORDS.has(lower)) return word.replace(bare, lower);

    const mappedMonth = MONTHS[lower];
    const cased = mappedMonth ?? lower.charAt(0).toUpperCase() + lower.slice(1);
    return word.replace(bare, cased);
  }).join(' ');
}

function repairPossessivePronounMisses(text: string): string {
  return text
    .replace(/\byou\s+(audience|brand|business|campaign|company|content|customer|customers|market|marketing|message|offer|product|solution|team|users)\b/gi, 'your $1')
    .replace(/\bwe\s+(audience|brand|business|campaign|company|content|customer|customers|market|marketing|message|offer|product|solution|team|users)\b/gi, 'our $1')
    .replace(/\bthey\s+(audience|brand|business|campaign|company|content|customer|customers|market|marketing|message|offer|product|solution|team|users)\b/gi, 'their $1');
}

function parseLaunchPhrase(text: string): LaunchPhrase | null {
  const normalized = expandMonthNames(normalizeWhitespace(text)).replace(/[.!?]+$/, '');
  const match = normalized.match(/^launch(?:ing)?\s+(.+?)(?:\s+(?:in|on|by|for)\s+([A-Za-z]+)\s+(\d{4}))?$/i);
  if (!match?.[1]) return null;
  const object = stripDanglingTrailingWords(match[1].replace(/^(?:the|a|an)\s+/i, ''));
  if (!object || object.split(/\s+/).length > 8) return null;
  const month = normalizeMonthToken(match[2]);
  const year = match[3];
  return { original: normalized, object: titleCase(object), month, year };
}

function launchNounPhrase(launch: LaunchPhrase): string {
  if (launch.month && launch.year) return `${launch.object}'s ${launch.month} ${launch.year} launch`;
  return `${launch.object}'s launch`;
}

function launchGerundPhrase(launch: LaunchPhrase): string {
  if (launch.month && launch.year) return `launching ${launch.object} in ${launch.month} ${launch.year}`;
  return `launching ${launch.object}`;
}

/**
 * Imperative/value-prop verbs commonly used as campaign topics (e.g.
 * "Unify and Optimize with AI", "Scale your Pipeline"). When a topic is a
 * verb phrase, interpolating it raw into a noun-slot template
 * ("Stop Doing {topic} the Hard Way") reads broken. We gerundize the leading
 * verb(s) so the phrase becomes noun-like ("Unifying and Optimizing with AI").
 * Curated + shape-gated so plain noun topics ("Email Marketing") are untouched.
 */
const IMPERATIVE_VERBS = new Set([
  'unify', 'optimize', 'automate', 'scale', 'grow', 'build', 'create', 'launch',
  'transform', 'simplify', 'streamline', 'accelerate', 'boost', 'drive', 'manage',
  'master', 'improve', 'enhance', 'connect', 'engage', 'convert', 'generate',
  'deliver', 'empower', 'unlock', 'discover', 'develop', 'integrate', 'customize',
  'personalize', 'elevate', 'modernize', 'amplify', 'maximize', 'monetize',
  'capture', 'nurture', 'expand', 'optimise', 'personalise', 'modernise',
  'get', 'reduce', 'cut', 'increase', 'lower', 'raise', 'win', 'retain',
  'fix', 'solve', 'save', 'close', 'attract', 'reach', 'double',
]);

const bareWord = (w: string): string => w.toLowerCase().replace(/[^a-z]/g, '');

/** Deterministic base-verb → gerund (handles -e, -ie, and CVC doubling). */
function toGerund(verb: string): string {
  const w = bareWord(verb);
  if (!w || w.endsWith('ing')) return verb;
  if (w.endsWith('ie')) return verb.slice(0, w.length - 2) + 'ying';
  if (w.endsWith('e') && !/(ee|oe|ye)$/.test(w)) return verb.slice(0, verb.length - 1) + 'ing';
  if (w.length <= 5 && /[^aeiou][aeiou][bcdfgklmnpt]$/.test(w)) return verb + w.slice(-1) + 'ing';
  return verb + 'ing';
}

/**
 * If `topic` is an imperative verb phrase, return it with leading/coordinated
 * verbs gerundized; otherwise return null (leave noun topics alone). Gated on
 * an imperative SHAPE — "{verb} and {verb}…" or "{verb} your/with/for/to …" —
 * so ambiguous noun-verbs ("Design Systems", "Marketing Automation") don't fire.
 */
function gerundizeImperativeTopic(topic: string): string | null {
  const words = topic.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  // The curated action-verb set IS the gate: a topic that leads with one of
  // these verbs is being used imperatively ("Build Better Campaigns", "Reduce
  // Customer Churn", "Scale Your Marketing Team"), not as a noun. Plain noun
  // topics ("Email Marketing", "Lead Generation") never lead with one.
  if (!IMPERATIVE_VERBS.has(bareWord(words[0]))) return null;

  const out = [...words];
  out[0] = toGerund(words[0]);
  for (let i = 1; i < out.length - 1; i++) {
    const w = bareWord(out[i]);
    if (w === 'and' && IMPERATIVE_VERBS.has(bareWord(out[i + 1]))) {
      out[i + 1] = toGerund(out[i + 1]); // coordinated verb: "Unify and Optimize"
    } else if (['with', 'for', 'to', 'your', 'the', 'a', 'an'].includes(w)) {
      break; // reached the object — stop converting
    }
  }
  return out.join(' ');
}

/** Interrogative leads that signal a question-shaped topic. */
const INTERROGATIVE_LEADS = new Set(['why', 'how', 'what', 'when', 'where', 'who', 'which', 'whose']);

/** Adverbs skipped when locating the predicate verb inside a clause. */
const CLAUSE_ADVERBS = new Set([
  'really', 'actually', 'truly', 'still', 'always', 'often', 'never', 'simply',
  'just', 'now', 'today', 'consistently', 'constantly', 'quietly', 'slowly', 'finally',
]);

/** Present-tense predicate verbs seen in question/clause topics (base forms). */
const PREDICATE_VERBS = new Set<string>([
  'fail', 'lose', 'want', 'need', 'struggle', 'win', 'grow', 'drop', 'miss', 'ignore',
  'waste', 'underperform', 'succeed', 'matter', 'work', 'break', 'change', 'fall',
  'stall', 'lag', 'lead', 'convert', 'churn', 'retain', 'adapt', 'evolve', 'shift',
  'thrive', 'slip', 'stick', 'click', 'buy', 'trust', 'react', 'respond', 'quit',
  ...IMPERATIVE_VERBS,
]);

/** Return the base verb if `word` is a known predicate verb (handles 3rd-person 's'). */
function baseOfPredicate(word: string): string | null {
  const b = bareWord(word);
  if (!b) return null;
  if (PREDICATE_VERBS.has(b)) return b;
  if (b.endsWith('s') && PREDICATE_VERBS.has(b.slice(0, -1))) return b.slice(0, -1);
  return null;
}

/**
 * Curated predicate/concept → noun map (TITLE-D). Nounification produces
 * editorially stronger titles than gerundization for question topics
 * ("Why Retention Fails" → "Retention Failure", not "Retention Failing").
 * Keys are verb/concept base forms.
 */
const PREDICATE_NOUN_MAP: Record<string, string> = {
  fail: 'failure',
  lose: 'loss',
  // TITLE-H (P1): 'needs' shifted meaning (necessity vs desire), was plural
  // (agreement), and collided with "What you need to know about {topic}".
  // 'demand' is singular, collision-free, and preserves "what customers want".
  want: 'demand',
  underperform: 'underperformance',
  churn: 'churn',
  // TITLE-H2: 'struggles'/'gaps' were plural → subject-verb agreement errors
  // with the singular "{topic} Is …" template family ("Struggles Is …").
  // Singular, collision-free replacements ('struggle' + 'challenge' both occur
  // verbatim in templates; 'friction'/'shortfall' do not).
  struggle: 'friction',
  grow: 'growth',
  miss: 'shortfall',
  fall: 'decline',
  drop: 'decline',
  // TITLE-H (P1): 'wins' was plural (agreement) and collided with the
  // "How to Win With {topic}" template. 'victory' is a singular, collision-free
  // synonym ('success' was rejected — collides with "What success looks like…").
  win: 'victory',
  trust: 'trust erosion',
  // TITLE-F — predicate coverage expansion.
  adapt: 'adaptation',
  recover: 'recovery',
  convert: 'conversion',
  engage: 'engagement',
  retain: 'retention',
  acquire: 'acquisition',
  differentiate: 'differentiation',
  compete: 'competition',
  scale: 'scaling',
  automate: 'automation',
  accelerate: 'acceleration',
  expand: 'expansion',
  improve: 'improvement',
  optimize: 'optimization',
  transform: 'transformation',
  modernize: 'modernization',
  replace: 'replacement',
  simplify: 'simplification',
  personalize: 'personalization',
  integrate: 'integration',
};

/** Singularize a plural subject noun ("Teams" → "Team"). Conservative: leaves
 *  -ss/-us/-is and short words alone. */
/** Nouns ending in "ie" whose plural is "ies" (NOT a y→ies plural). */
const IE_PLURAL_EXCEPTIONS = new Set([
  'cookies', 'movies', 'selfies', 'rookies', 'zombies', 'newbies', 'indies', 'foodies', 'techies', 'goalies',
]);

function singularizeSubject(word: string): string {
  const lower = bareWord(word);
  if (lower.length <= 3) return word;
  // -ie+s nouns: Cookies→Cookie (strip just the 's').
  if (IE_PLURAL_EXCEPTIONS.has(lower)) return word.replace(/s$/i, '');
  // Consonant + ies → y: Companies→Company, Strategies→Strategy, Capabilities→Capability.
  // Length guard keeps short -ie words (ties, pies, dies) on the plain path below.
  if (lower.length > 5 && /[^aeiou]ies$/.test(lower)) return word.replace(/ies$/i, 'y');
  // Sibilant plurals: Businesses→Business, Boxes→Box, Watches→Watch.
  if (/(ses|xes|zes|ches|shes)$/.test(lower)) return word.replace(/es$/i, '');
  // Plain plurals: Teams→Team. Leave -ss/-us/-is alone.
  if (lower.endsWith('s') && !/(ss|us|is)$/.test(lower)) return word.replace(/s$/i, '');
  return word;
}

/** Map a base word to its concept-noun (handles a trailing 3rd-person 's'). */
function nounForConcept(word: string): string | null {
  const b = bareWord(word);
  if (PREDICATE_NOUN_MAP[b]) return PREDICATE_NOUN_MAP[b];
  if (b.endsWith('s') && PREDICATE_NOUN_MAP[b.slice(0, -1)]) return PREDICATE_NOUN_MAP[b.slice(0, -1)];
  return null;
}

/**
 * TITLE-F — a token is a valid question predicate when EITHER `baseOfPredicate`
 * recognizes it (the verb set) OR it resolves to a noun mapping. Composes the
 * two existing sources — NOT a second registry — so verbs that exist only in
 * the noun map (recover/acquire/differentiate/compete/replace) are still found
 * and nounified instead of leaking a bare verb clause. Returns the base key.
 */
function questionPredicateBase(word: string): string | null {
  const direct = baseOfPredicate(word);
  if (direct) return direct;
  const b = bareWord(word);
  if (PREDICATE_NOUN_MAP[b]) return b;
  if (b.endsWith('s') && PREDICATE_NOUN_MAP[b.slice(0, -1)]) return b.slice(0, -1);
  return null;
}

/**
 * Nounify a question clause "{subject} {verb} [object]" → a noun phrase, or
 * null if neither the object nor the verb has a noun mapping (caller then
 * falls back to gerundization).
 *   - object carries the concept (lose TRUST → "trust erosion"): "{subj} {objNoun}"
 *   - else, object present + verb mapped: "{subj} {object…} {verbNoun}"
 *   - else, no object + verb mapped:      "{subj} {verbNoun}"
 */
function nounifyQuestionClause(subject: string, verbBase: string, objectWords: string[]): string | null {
  if (objectWords.length > 0) {
    const objNoun = nounForConcept(objectWords[objectWords.length - 1]);
    if (objNoun) {
      return [subject, ...objectWords.slice(0, -1), ...objNoun.split(' ')].join(' ');
    }
    const verbNoun = PREDICATE_NOUN_MAP[verbBase];
    if (verbNoun) return [subject, ...objectWords, ...verbNoun.split(' ')].join(' ');
    return null;
  }
  const verbNoun = PREDICATE_NOUN_MAP[verbBase];
  if (verbNoun) return [subject, ...verbNoun.split(' ')].join(' ');
  return null;
}

/**
 * Normalize a question-shaped topic into a noun phrase. Strategy (TITLE-D):
 *   1. Nounify first — singularize the subject + map the predicate (or object)
 *      to a noun ("Why Retention Fails" → "Retention Failure").
 *   2. Fallback — if the predicate has no noun mapping, gerundize it (the
 *      TITLE-B path) so a double-interrogative / noun-slot collision can never
 *      survive ("Why X Adapts" → "X Adapting").
 *   3. If no predicate verb is recognized at all, strip the interrogative only.
 * Returns null for non-questions (so imperative/noun paths run).
 */
function normalizeQuestionTopic(topic: string): string | null {
  const words = topic.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  if (!INTERROGATIVE_LEADS.has(bareWord(words[0]))) return null;
  const rest = words.slice(1); // drop the interrogative; rest[0] is the subject
  const nonAdverb = (w: string) => !CLAUSE_ADVERBS.has(bareWord(w));

  // Primary: "{subject} {verb} [object]" — subject = rest[0], verb in rest[1..].
  // Scanning from index 1 keeps a verb-homograph SUBJECT ("Why Leads Convert")
  // as the subject; the verb-first shape is handled in the fallback below.
  let vi = -1;
  let verbBase: string | null = null;
  for (let i = 1; i < rest.length; i++) {
    if (!nonAdverb(rest[i])) continue;
    const b = questionPredicateBase(rest[i]);
    if (b) { vi = i; verbBase = b; break; }
  }

  if (vi !== -1 && verbBase) {
    const subject = singularizeSubject(rest[0]);
    const objectWords = rest.slice(vi + 1).filter(nonAdverb);
    const nounified = nounifyQuestionClause(subject, verbBase, objectWords);
    if (nounified) return nounified;
    // Fallback — gerundize the predicate (TITLE-B behavior; never BROKEN).
    const out = [...rest];
    out[vi] = toGerund(verbBase);
    return out.join(' ');
  }

  // Verb-first ("What Replaces Cookies"): rest[0] is the verb, object follows.
  // Reorder to "{object} {verb-noun}" so no verb clause survives.
  const leadVerb = questionPredicateBase(rest[0]);
  const objAfterLead = rest.slice(1).filter(nonAdverb);
  if (leadVerb && objAfterLead.length > 0) {
    const subject = singularizeSubject(objAfterLead[objAfterLead.length - 1]);
    const lead = objAfterLead.slice(0, -1);
    const nounified = nounifyQuestionClause(subject, leadVerb, []);
    if (nounified) return [...lead, nounified].join(' ');
    const out = [...rest];
    out[0] = toGerund(leadVerb);
    return out.join(' ');
  }

  // No recognized predicate anywhere — interrogative still removed (never BROKEN).
  return rest.filter(nonAdverb).join(' ');
}

export function refineCampaignTopicForHeadlines(topic: string): string {
  const base = stripDanglingTrailingWords(expandMonthNames(normalizeWhitespace(topic)));
  const launch = parseLaunchPhrase(base);
  if (launch) return launchNounPhrase(launch);
  // Question-shaped topics → noun-compatible gerund clause (before imperative,
  // since a question starts with an interrogative, not a verb).
  const question = normalizeQuestionTopic(base);
  if (question) return titleCase(question);
  const gerundized = gerundizeImperativeTopic(base);
  return titleCase(gerundized ?? base);
}

export function refineStrategicCardTitle(title: string, sourceTopic?: string, cardIndex: number = 0): string {
  let result = expandMonthNames(normalizeWhitespace(title));
  const sourceLaunch = sourceTopic ? parseLaunchPhrase(sourceTopic) : null;

  const launchFromTitle =
    result.match(/^(?:The\s+Rise\s+of|The\s+Future\s+Belongs\s+to|Where|What\s+Everyone\s+Gets\s+Wrong\s+About|The)\s+(launch(?:ing)?\s+.+)$/i)?.[1] ??
    result.match(/^The\s+(launch(?:ing)?\s+.+?)\s+Myth,\s*Debunked$/i)?.[1] ??
    null;
  const titleLaunch = launchFromTitle ? parseLaunchPhrase(launchFromTitle) : null;
  const launch = sourceLaunch ?? titleLaunch;

  if (launch) {
    const noun = launchNounPhrase(launch);
    const gerund = launchGerundPhrase(launch);
    const launchTitles = [
      `Building Momentum for ${noun}`,
      `Debunking the Myths Around ${noun}`,
      `What ${noun} Needs to Win`,
    ];
    if (
      /^(The\s+Rise\s+of|The\s+Future\s+Belongs\s+to|Where|What\s+Everyone\s+Gets\s+Wrong\s+About|The\s+.+\s+Myth,\s*Debunked)/i.test(result) ||
      /^launch(?:ing)?\s+/i.test(sourceTopic ?? '')
    ) {
      result = launchTitles[Math.max(0, Math.min(launchTitles.length - 1, cardIndex))] ?? `A Practical Plan for ${gerund}`;
    }
  }

  result = result
    .replace(/^The\s+Rise\s+of\s+(.+)$/i, (_m, topic) => `Why ${stripDanglingTrailingWords(topic)} Matters Now`)
    .replace(/^The\s+Future\s+Belongs\s+to\s+(.+)$/i, (_m, topic) => `Why ${stripDanglingTrailingWords(topic)} Is Becoming Hard to Ignore`);

  result = result
    .replace(/\bThe\s+([A-Z][\w'’]*(?:\s+[A-Z][\w'’]*)*'s)\s+/g, '$1 ')
    .replace(/\bLaunch\s+([A-Z])/g, 'Launching $1')
    .replace(/\bIn\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, 'in $1');

  // "Stop Doing Unifying … the Hard Way" → "Stop Unifying … the Hard Way".
  // When a gerundized verb-phrase topic lands in the "Stop Doing {topic}"
  // template, "Doing" is redundant and ungrammatical before a gerund.
  result = result.replace(/\bStop\s+Doing\s+(?=\w+ing\b)/gi, 'Stop ');

  return stripDanglingTrailingWords(titleCase(repairPossessivePronounMisses(result)));
}

export function refineGeneratedText(text: string, opts: { kind?: RefinementKind } = {}): string {
  let result = expandMonthNames(normalizeWhitespace(text));
  result = repairPossessivePronounMisses(result);
  result = result.replace(/\blaunch\s+([A-Za-z][\w'’]*(?:\s+[A-Za-z][\w'’]*)*)\s+in\s+([A-Za-z]+)\s+(\d{4})\b/gi, (_m, object, month, year) => {
    const expandedMonth = normalizeMonthToken(month) ?? month;
    return `launching ${titleCase(object)} in ${expandedMonth} ${year}`;
  });
  result = stripDanglingTrailingWords(result);
  if (opts.kind === 'headline' || opts.kind === 'subject') return refineStrategicCardTitle(result);
  return result;
}

export function refineSubjectLine(subject: string): string {
  return refineGeneratedText(subject, { kind: 'subject' });
}
