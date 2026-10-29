/**
 * Technical readiness — a small, pure RFC 9309 (Robots Exclusion Protocol) parser and matcher.
 *
 * WHY NOT A DEPENDENCY. No robots parser is installed (`robots-parser` is absent from
 * package.json and node_modules), and the rules needed here are short and fully specified by
 * RFC 9309 §2. A pure implementation is deterministic and testable without network.
 *
 * WHAT THIS ANSWERS. "What does this robots.txt SAY to product token X about path P?" — policy,
 * never behaviour. It cannot show whether an agent obeys it, whether a CDN/WAF blocks the agent
 * anyway, or whether the agent ever crawled or cited the site.
 *
 * RFC 9309 rules implemented:
 *   • §2.1/§2.2   `user-agent` / `allow` / `disallow` lines; keys case-insensitive; `#` comments.
 *   • §2.2.1      a `user-agent` line that follows a rule starts a new group; consecutive
 *                 `user-agent` lines share one group; product-token match is case-insensitive;
 *                 ALL groups naming the token are merged; `*` applies only when none names it.
 *   • §2.2.2      most specific (longest) match wins; on an allow/disallow tie, allow wins;
 *                 `*` wildcard and `$` end anchor; an empty `disallow:` is no rule;
 *                 `/robots.txt` is always allowed.
 *   • §2.5        at least 500 KiB parsed; anything beyond is ignored and flagged `truncated`.
 */

/** RFC 9309 §2.5 — crawlers MUST parse at least 500 kibibytes. */
export const ROBOTS_PARSE_LIMIT_BYTES = 500 * 1024;
/** Bound on what is persisted per robots.txt (JSONB on the root page row). */
export const MAX_STORED_RULES = 400;
export const MAX_STORED_SITEMAPS = 10;

export type RobotsRule = {
  type: 'allow' | 'disallow';
  /** The pattern exactly as written (trimmed). */
  path: string;
  /** 1-based source line, so a finding can quote the line that decided it. */
  line: number;
};

export type RobotsGroup = {
  /** Product tokens as written, lower-cased. `*` is the wildcard group. */
  agents: string[];
  rules: RobotsRule[];
};

export type ParsedRobots = {
  groups: RobotsGroup[];
  sitemaps: string[];
  truncated: boolean;
  /** Lines that were neither blank, comment, nor a recognised key — counted, never interpreted. */
  unrecognised_lines: number;
};

/** Parse robots.txt text. Pure; never throws. */
export function parseRobotsTxt(input: string): ParsedRobots {
  let text = typeof input === 'string' ? input : '';
  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > ROBOTS_PARSE_LIMIT_BYTES) {
    text = Buffer.from(text, 'utf8').subarray(0, ROBOTS_PARSE_LIMIT_BYTES).toString('utf8');
    truncated = true;
  }
  text = text.replace(/^﻿/, '');

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let unrecognised = 0;
  let current: RobotsGroup | null = null;
  /** True once the current group has received a rule — the next user-agent starts a new group. */
  let currentHasRules = false;

  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const hash = raw.indexOf('#');
    const content = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (!content) continue;
    const colon = content.indexOf(':');
    if (colon <= 0) { unrecognised += 1; continue; }
    const key = content.slice(0, colon).trim().toLowerCase();
    const value = content.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!current || currentHasRules) {
        current = { agents: [], rules: [] };
        groups.push(current);
        currentHasRules = false;
      }
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }
    if (key === 'allow' || key === 'disallow') {
      // A rule before any user-agent line belongs to no group (RFC 9309 §2.2) — ignored.
      if (!current) { unrecognised += 1; continue; }
      currentHasRules = true;
      // Empty `disallow:` means "no rule" (§2.2.2). An empty `allow:` is equally inert.
      if (!value) continue;
      current.rules.push({ type: key, path: value, line: i + 1 });
      continue;
    }
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    // crawl-delay, host, content-signal, … : recognised as "other records", never interpreted.
    if (/^[a-z][a-z0-9_-]*$/.test(key)) continue;
    unrecognised += 1;
  }

  return { groups, sitemaps, truncated, unrecognised_lines: unrecognised };
}

/**
 * Normalise a path or pattern for comparison (RFC 9309 §2.2.2 refers to RFC 3986):
 * percent-escapes upper-cased, unreserved characters decoded, non-ASCII percent-encoded.
 */
export function normalizeRobotsPath(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    out += code > 0x7e || code < 0x21 ? encodeURIComponent(ch) : ch;
  }
  return out.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`;
  });
}

/** Does `pattern` (with `*` and `$`) match the start of `path`? */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const p = normalizeRobotsPath(pattern);
  const target = normalizeRobotsPath(path);
  const anchored = p.endsWith('$');
  const body = anchored ? p.slice(0, -1) : p;
  const regex = '^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '');
  try {
    return new RegExp(regex).test(target);
  } catch {
    return false;
  }
}

/** The groups that govern `token`: every group naming it, else every `*` group, else none. */
export function selectGroups(groups: readonly RobotsGroup[], token: string): { groups: RobotsGroup[]; matchedBy: 'token' | 'wildcard' | 'none' } {
  const t = token.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(t));
  if (named.length > 0) return { groups: named, matchedBy: 'token' };
  const wildcard = groups.filter((g) => g.agents.includes('*'));
  if (wildcard.length > 0) return { groups: wildcard, matchedBy: 'wildcard' };
  return { groups: [], matchedBy: 'none' };
}

export type PathDecision = {
  path: string;
  allowed: boolean;
  /** The rule that decided it; null when no rule matched (allowed by default). */
  rule: RobotsRule | null;
};

/** Is `path` allowed for `token`? Longest match wins; allow wins a tie (§2.2.2). */
export function evaluatePath(groups: readonly RobotsGroup[], token: string, path: string): PathDecision & { matchedBy: 'token' | 'wildcard' | 'none' } {
  const target = path || '/';
  const selected = selectGroups(groups, token);
  if (/^\/robots\.txt$/i.test(target.split('?')[0])) {
    return { path: target, allowed: true, rule: null, matchedBy: selected.matchedBy };
  }
  let best: RobotsRule | null = null;
  let bestLen = -1;
  for (const group of selected.groups) {
    for (const rule of group.rules) {
      if (!robotsPatternMatches(rule.path, target)) continue;
      const len = normalizeRobotsPath(rule.path).length;
      if (len > bestLen || (len === bestLen && rule.type === 'allow' && best?.type === 'disallow')) {
        best = rule;
        bestLen = len;
      }
    }
  }
  return { path: target, allowed: best ? best.type === 'allow' : true, rule: best, matchedBy: selected.matchedBy };
}

/** A bounded copy of the parse, for persistence. */
export function boundedGroups(parsed: ParsedRobots): RobotsGroup[] {
  const out: RobotsGroup[] = [];
  let budget = MAX_STORED_RULES;
  for (const g of parsed.groups) {
    if (budget <= 0) break;
    const rules = g.rules.slice(0, budget);
    budget -= rules.length;
    out.push({ agents: g.agents.slice(0, 20), rules });
  }
  return out;
}
