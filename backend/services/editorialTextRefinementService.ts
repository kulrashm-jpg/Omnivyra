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

export function refineCampaignTopicForHeadlines(topic: string): string {
  const base = stripDanglingTrailingWords(expandMonthNames(normalizeWhitespace(topic)));
  const launch = parseLaunchPhrase(base);
  if (launch) return launchNounPhrase(launch);
  return titleCase(base);
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
