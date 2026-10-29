/**
 * Technical readiness — RFC 9309 robots.txt parsing, group precedence, path matching, and the
 * fetch-outcome → crawler-access state mapping. Pure; no network.
 */
import {
  evaluatePath,
  normalizeRobotsPath,
  parseRobotsTxt,
  robotsPatternMatches,
  ROBOTS_PARSE_LIMIT_BYTES,
  selectGroups,
} from '../../services/technicalReadiness/robotsTxt';
import { AI_AGENT_REGISTRY_VERSION, AI_CRAWLER_REGISTRY } from '../../services/technicalReadiness/aiCrawlerRegistry';
import { evaluateCrawlerAccess, RFC_UNREACHABLE_NOTE } from '../../services/technicalReadiness/technicalFindings';
import { robotsObservationFromProbe, type SiteFileProbe } from '../../services/technicalReadiness/siteFilesProbe';

const probe = (over: Partial<SiteFileProbe>): SiteFileProbe => ({
  url: 'https://site.test/robots.txt', fetched_at: '2026-10-29T10:00:00.000Z', outcome: 'ok', status: 200,
  content_type: 'text/plain', bytes: 10, body: '', reason: null, ...over,
});
const obsFor = (body: string) => robotsObservationFromProbe(probe({ body, bytes: body.length }));

describe('robots.txt parser (RFC 9309 §2.1–2.2)', () => {
  it('R-1 groups consecutive user-agent lines; a user-agent after a rule opens a new group', () => {
    const parsed = parseRobotsTxt('﻿User-agent: A\r\nUser-agent: B\nDisallow: /x # comment\nUser-agent: C\nAllow: /\n');
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0].agents).toEqual(['a', 'b']);
    expect(parsed.groups[0].rules).toEqual([{ type: 'disallow', path: '/x', line: 3 }]);
    expect(parsed.groups[1].agents).toEqual(['c']);
  });

  it('keys are case-insensitive; Sitemap lines are collected; other records are ignored, not interpreted', () => {
    const parsed = parseRobotsTxt('USER-AGENT: *\nDISALLOW: /a\nCrawl-delay: 10\nSitemap: https://site.test/s.xml\n');
    expect(parsed.groups[0].rules[0]).toMatchObject({ type: 'disallow', path: '/a' });
    expect(parsed.sitemaps).toEqual(['https://site.test/s.xml']);
    expect(parsed.unrecognised_lines).toBe(0);
  });

  it('R-8 an empty Disallow is no rule', () => {
    const parsed = parseRobotsTxt('User-agent: *\nDisallow:\n');
    expect(parsed.groups[0].rules).toEqual([]);
    expect(evaluatePath(parsed.groups, 'GPTBot', '/').allowed).toBe(true);
  });

  it('R-10 parses at most 500 KiB and flags truncation', () => {
    const filler = '# '.padEnd(1000, 'x') + '\n';
    const big = 'User-agent: *\nAllow: /\n' + filler.repeat(Math.ceil(ROBOTS_PARSE_LIMIT_BYTES / filler.length) + 5) + 'Disallow: /late\n';
    const parsed = parseRobotsTxt(big);
    expect(parsed.truncated).toBe(true);
    expect(parsed.groups[0].rules.map((r) => r.path)).not.toContain('/late');
  });
});

describe('group selection and precedence (RFC 9309 §2.2.1–2.2.2)', () => {
  it('R-2 product-token match is case-insensitive', () => {
    const { groups } = parseRobotsTxt('User-agent: gptbot\nDisallow: /\n');
    expect(selectGroups(groups, 'GPTBot').matchedBy).toBe('token');
    expect(evaluatePath(groups, 'GPTBot', '/').allowed).toBe(false);
  });

  it('R-3 a group naming the token beats the * group', () => {
    const { groups } = parseRobotsTxt('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n');
    expect(evaluatePath(groups, 'GPTBot', '/').allowed).toBe(true);
    expect(evaluatePath(groups, 'CCBot', '/').allowed).toBe(false);
  });

  it('R-4 all groups naming the same token are merged', () => {
    const { groups } = parseRobotsTxt('User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b\n');
    expect(selectGroups(groups, 'GPTBot').groups).toHaveLength(2);
    expect(evaluatePath(groups, 'GPTBot', '/a/1').allowed).toBe(false);
    expect(evaluatePath(groups, 'GPTBot', '/b/1').allowed).toBe(false);
    expect(evaluatePath(groups, 'GPTBot', '/c').allowed).toBe(true);
  });

  it('R-5 the longest matching rule wins', () => {
    const { groups } = parseRobotsTxt('User-agent: *\nDisallow: /\nAllow: /blog\n');
    expect(evaluatePath(groups, 'Bingbot', '/').allowed).toBe(false);
    expect(evaluatePath(groups, 'Bingbot', '/blog/post').allowed).toBe(true);
    const { groups: g2 } = parseRobotsTxt('User-agent: *\nAllow: /docs\nDisallow: /docs/private\n');
    expect(evaluatePath(g2, 'Bingbot', '/docs/private/x').allowed).toBe(false);
  });

  it('R-6 on an equal-length allow/disallow tie, allow wins', () => {
    const { groups } = parseRobotsTxt('User-agent: *\nDisallow: /page\nAllow: /page\n');
    expect(evaluatePath(groups, 'Googlebot', '/page').allowed).toBe(true);
  });

  it('R-7 * wildcard and $ end anchor', () => {
    expect(robotsPatternMatches('/*.pdf$', '/files/a.pdf')).toBe(true);
    expect(robotsPatternMatches('/*.pdf$', '/files/a.pdf?x=1')).toBe(false);
    expect(robotsPatternMatches('/private*/', '/private-area/x')).toBe(true);
    expect(robotsPatternMatches('/a.b', '/aXb')).toBe(false);
  });

  it('R-9 /robots.txt itself is always allowed', () => {
    const { groups } = parseRobotsTxt('User-agent: *\nDisallow: /\n');
    expect(evaluatePath(groups, 'GPTBot', '/robots.txt').allowed).toBe(true);
  });

  it('percent-encoding is normalised on both sides', () => {
    expect(normalizeRobotsPath('/%7euser')).toBe('/~user');
    expect(normalizeRobotsPath('/café')).toBe('/caf%C3%A9');
    expect(robotsPatternMatches('/caf%c3%a9', '/café/menu')).toBe(true);
  });

  it('no group at all ⇒ allowed with matchedBy none', () => {
    const { groups } = parseRobotsTxt('User-agent: SomeOtherBot\nDisallow: /\n');
    expect(evaluatePath(groups, 'ClaudeBot', '/')).toMatchObject({ allowed: true, matchedBy: 'none' });
  });
});

describe('fetch outcome → crawler access state', () => {
  it('2xx text: disallowed at root, allowed with a matched rule and line', () => {
    const obs = obsFor('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
    const gpt = evaluateCrawlerAccess(obs, 'GPTBot');
    expect(gpt.state).toBe('disallowed');
    expect(gpt.matched_rule).toEqual({ type: 'disallow', path: '/', line: 2 });
    expect(evaluateCrawlerAccess(obs, 'Googlebot').state).toBe('allowed');
  });

  it('root allowed but a key path disallowed is reported as allowed + disallowed_paths', () => {
    const obs = obsFor('User-agent: *\nDisallow: /blog\n');
    const r = evaluateCrawlerAccess(obs, 'PerplexityBot', ['/', '/blog/a', '/pricing']);
    expect(r.state).toBe('allowed');
    expect(r.disallowed_paths).toEqual(['/blog/a']);
  });

  it.each([
    ['404 ⇒ allowed (RFC: unavailable places no restriction)', { outcome: 'client_error' as const, status: 404, body: null }, 'allowed', 'high'],
    ['410 ⇒ allowed', { outcome: 'client_error' as const, status: 410, body: null }, 'allowed', 'high'],
    ['HTML body at 200 ⇒ allowed, low confidence', { outcome: 'html_body' as const, status: 200, body: '<html></html>' }, 'allowed', 'low'],
    ['503 ⇒ indeterminate', { outcome: 'server_error' as const, status: 503, body: null }, 'indeterminate', 'medium'],
    ['429 ⇒ indeterminate', { outcome: 'rate_limited' as const, status: 429, body: null }, 'indeterminate', 'medium'],
    ['timeout ⇒ indeterminate', { outcome: 'timeout' as const, status: null, body: null }, 'indeterminate', 'medium'],
    ['unreachable host ⇒ unavailable', { outcome: 'unreachable' as const, status: null, body: null }, 'unavailable', 'high'],
  ])('R-11 %s', (_label, over, state, confidence) => {
    const r = evaluateCrawlerAccess(robotsObservationFromProbe(probe(over)), 'ClaudeBot');
    expect(r.state).toBe(state);
    expect(r.confidence).toBe(confidence);
    if (state === 'indeterminate') expect(r.reason).toContain(RFC_UNREACHABLE_NOTE);
  });

  it('a robots observation that was never collected (legacy row) is unavailable, never allowed', () => {
    expect(evaluateCrawlerAccess(undefined, 'GPTBot').state).toBe('unavailable');
  });

  it('a 5xx body is never parsed into rules', () => {
    const obs = robotsObservationFromProbe(probe({ outcome: 'server_error', status: 500, body: 'User-agent: *\nDisallow: /' }));
    expect(obs.groups).toEqual([]);
  });
});

describe('registry', () => {
  it('R-12 has exactly the 16 versioned tokens, unique, with control tokens labelled', () => {
    expect(AI_CRAWLER_REGISTRY).toHaveLength(16);
    expect(new Set(AI_CRAWLER_REGISTRY.map((t) => t.token.toLowerCase())).size).toBe(16);
    expect(AI_CRAWLER_REGISTRY.filter((t) => t.kind === 'control_token').map((t) => t.token).sort()).toEqual(['Applebot-Extended', 'Google-Extended']);
    expect(AI_AGENT_REGISTRY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
