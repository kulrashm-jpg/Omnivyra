/**
 * Technical readiness — the `TechnicalFinding` contract and its pure builder.
 *
 * ─── WHAT THIS IS ──────────────────────────────────────────────────────────
 * Evidence about a site's technical readiness for search and AI crawlers, built ONLY from what
 * the crawler already persisted (`canonical_pages.crawl_metadata`). No request is issued here.
 *
 * ─── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * A score input. Findings are deliberately kept OUT of every engine's `checks[]` (the engines'
 * `aggregate()` averages every evaluable check and counts every check in its confidence
 * denominator, so even a score-less check would move a number) and OUT of dimension evidence
 * (which drives the confidence band). `feeds_dimension` is a presentation hint only.
 *
 * Missing evidence is never a zero and never a pass: a row crawled before these fields existed
 * yields `unavailable` with a reason.
 */
import { AI_AGENT_REGISTRY_VERSION, AI_CRAWLER_REGISTRY, type CrawlerToken } from './aiCrawlerRegistry';
import { JSONLD_LIMITATION, JSONLD_RULESET_VERSION, type JsonLdValidation } from './jsonLdValidation';
import { LLMS_TXT_LIMITATION } from './llmsTxt';
import { evaluatePath, type RobotsGroup } from './robotsTxt';
import type { LlmsTxtObservation, RobotsObservation } from './siteFilesProbe';

export const TECHNICAL_FINDINGS_VERSION = '2026-10-29.1';

export type TechnicalFindingState =
  /** Observed, and the observation is favourable. */
  | 'pass'
  /** Observed, and the observation is a defect the site owner can act on. */
  | 'issue'
  /** Observed, and reported without a verdict (a policy choice, an optional file). */
  | 'info'
  /** Observed, but the observation cannot support a claim either way. */
  | 'indeterminate'
  /** The check's gate excluded this site. */
  | 'not_applicable'
  /** No source exists, or nothing was collected. Never a zero, never a pass. */
  | 'unavailable';

export type TechnicalFindingDimension =
  | 'index_integrity'
  | 'extraction_readiness'
  | 'entity_graph_strength'
  | 'trust_coherence'
  | 'ai_surface_presence';

export interface TechnicalFinding {
  check_id: string;
  check_version: string;
  subject_url: string;
  state: TechnicalFindingState;
  /** Check-specific outcome, e.g. `allowed` / `disallowed` / `present_malformed`. */
  detail_state: string | null;
  /** One customer-readable sentence, built from the evidence only. */
  detail: string;
  /** ≤240 chars, verbatim from the source (matched robots line, JSON error, llms first lines). */
  evidence_excerpt: string | null;
  source_url: string | null;
  source_http_status: number | null;
  /** When the source was retrieved — crawl time, never report time. */
  retrieved_at: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Mandatory, fixed per check. */
  limitation: string;
  /** Presentation grouping only. Never a score input. */
  feeds_dimension: TechnicalFindingDimension | null;
  /** ≤5 example pages from the same rows the finding counted. Never exhaustive. */
  examples?: Array<{ url: string }>;
  /** For `unavailable` / `indeterminate` / `not_applicable`: why. */
  reason?: string | null;
}

export type TechnicalFindingsResult = {
  version: string;
  registry_version: string;
  jsonld_ruleset_version: string;
  findings: TechnicalFinding[];
  /** Counts by state — counts of findings, deliberately not a score. */
  counts: Record<TechnicalFindingState, number>;
};

/** The subset of a `canonical_pages` row this builder reads. */
export type TechnicalFindingPageRow = {
  url: string;
  page_type?: string | null;
  http_status: number | null;
  crawl_depth?: number | null;
  last_crawled_at: string | null;
  crawl_metadata?: {
    meta_tags?: Record<string, string>;
    signals?: {
      jsonld_validation?: JsonLdValidation;
      canonical_href?: string | null;
      x_robots_tag?: string | null;
      same_as?: string[];
      legal_name?: string | null;
      site?: {
        robots_txt?: boolean;
        robots?: RobotsObservation;
        llms?: LlmsTxtObservation;
        llms_full?: LlmsTxtObservation;
      };
    };
    reachability?: { reason?: string | null } | null;
  } | null;
};

// ── Fixed limitation texts ─────────────────────────────────────────────────────────────────

export const ROBOTS_LIMITATION =
  'robots.txt states policy, not behaviour: it cannot show whether a crawler obeys it, whether a CDN or firewall blocks the crawler anyway, or whether the crawler has ever fetched or cited the site. Evaluated from one fetch by Omnivyra; no crawler user agent was impersonated.';
export const RFC_UNREACHABLE_NOTE =
  'Under RFC 9309 a compliant crawler that cannot retrieve robots.txt because of a server error, rate limit or timeout treats the whole site as disallowed until it can.';
export const ENTITY_LIMITATION =
  'Compares only what the site itself declares on the crawled pages. It does not establish how search engines or knowledge graphs resolve the entity.';
export const PAGE_SIGNAL_LIMITATION =
  'Read from the HTML and response headers served to Omnivyra’s crawler on the crawled pages only; JavaScript-inserted tags are not observed.';

const SEARCH_KINDS = new Set(['search_crawler']);

// ── Helpers ────────────────────────────────────────────────────────────────────────────────

const isRead = (p: TechnicalFindingPageRow) =>
  typeof p.http_status === 'number' && p.http_status >= 200 && p.http_status < 300
  && !['off_site_redirect', 'unverifiable_final_url'].includes(String(p.crawl_metadata?.reachability?.reason ?? ''));

const pathOf = (url: string): string => {
  try { const u = new URL(url); return (u.pathname || '/') + (u.search || ''); } catch { return '/'; }
};
const originOf = (url: string | null | undefined): string | null => {
  try { return url ? new URL(url).origin : null; } catch { return null; }
};
const examplesOf = (rows: TechnicalFindingPageRow[]) =>
  rows.length ? [...new Set(rows.map((r) => r.url))].slice(0, 5).map((url) => ({ url })) : undefined;
const clip = (s: string | null | undefined, n = 240) => (s ? s.slice(0, n) : null);

/** The root page's site-level signals: the shallowest, most recently crawled row that has them. */
function siteSignalsOf(pages: readonly TechnicalFindingPageRow[]) {
  const withSite = pages.filter((p) => p.crawl_metadata?.signals?.site);
  withSite.sort((a, b) => (a.crawl_depth ?? 99) - (b.crawl_depth ?? 99)
    || Date.parse(b.last_crawled_at ?? '') - Date.parse(a.last_crawled_at ?? ''));
  const row = withSite[0];
  return row ? { row, site: row.crawl_metadata!.signals!.site! } : null;
}

/** Root + up to 5 crawled, readable paths (shallowest first) for per-agent evaluation. */
function keyPaths(pages: readonly TechnicalFindingPageRow[]): string[] {
  const read = pages.filter(isRead).slice().sort((a, b) => (a.crawl_depth ?? 99) - (b.crawl_depth ?? 99));
  const out = ['/'];
  for (const p of read) {
    const path = pathOf(p.url);
    if (!out.includes(path)) out.push(path);
    if (out.length >= 6) break;
  }
  return out;
}

// ── robots.txt / AI crawler access ────────────────────────────────────────────────────────

export type CrawlerAccessState = 'allowed' | 'disallowed' | 'indeterminate' | 'unavailable';

export type CrawlerAccessResult = {
  token: string;
  state: CrawlerAccessState;
  /** Paths (of those evaluated) that the rules disallow. Non-empty with `allowed` = partial. */
  disallowed_paths: string[];
  matched_by: 'token' | 'wildcard' | 'none' | null;
  matched_rule: { type: 'allow' | 'disallow'; path: string; line: number } | null;
  reason: string | null;
  confidence: 'high' | 'medium' | 'low';
};

/**
 * One token against one robots observation. Fetch outcome → state (RFC 9309 §2.3.1):
 *   2xx text                → parse and evaluate
 *   2xx HTML body           → treated as unavailable (no rules) ⇒ allowed, LOW confidence
 *   4xx (not 429), bare 3xx → "unavailable" ⇒ crawlers MAY access anything ⇒ allowed
 *   5xx, 429, timeout, cap  → indeterminate (+ the RFC note: compliant crawlers treat as disallowed)
 *   no HTTP response        → unavailable
 */
export function evaluateCrawlerAccess(robots: RobotsObservation | null | undefined, token: string, paths: readonly string[] = ['/']): CrawlerAccessResult {
  const base = { token, disallowed_paths: [] as string[], matched_by: null, matched_rule: null };
  if (!robots) return { ...base, state: 'unavailable', reason: 'robots.txt was not collected by the crawl that produced this evidence', confidence: 'high' };
  switch (robots.outcome) {
    case 'client_error':
      return { ...base, state: 'allowed', matched_by: 'none', reason: `robots.txt returned HTTP ${robots.status}; under RFC 9309 an unavailable robots.txt places no restriction`, confidence: 'high' };
    case 'redirect_unresolved':
      return { ...base, state: 'allowed', matched_by: 'none', reason: `robots.txt returned an unresolved redirect (HTTP ${robots.status}); treated as unavailable under RFC 9309`, confidence: 'medium' };
    case 'html_body':
      return { ...base, state: 'allowed', matched_by: 'none', reason: 'robots.txt URL served an HTML page rather than a robots file; no rules could be read', confidence: 'low' };
    case 'server_error':
    case 'rate_limited':
    case 'timeout':
    case 'too_large':
      return { ...base, state: 'indeterminate', reason: `robots.txt could not be read (${robots.outcome}${robots.status ? `, HTTP ${robots.status}` : ''}). ${RFC_UNREACHABLE_NOTE}`, confidence: 'medium' };
    case 'unreachable':
      return { ...base, state: 'unavailable', reason: 'No HTTP response for robots.txt (host unreachable or the request was refused)', confidence: 'high' };
    case 'ok':
      break;
    default:
      return { ...base, state: 'unavailable', reason: 'Unrecognised robots.txt fetch outcome', confidence: 'low' };
  }
  const groups: RobotsGroup[] = robots.groups ?? [];
  const decisions = paths.map((p) => evaluatePath(groups, token, p));
  const root = decisions[0];
  const disallowed = decisions.filter((d) => !d.allowed).map((d) => d.path);
  const decisive = root.allowed ? (decisions.find((d) => !d.allowed)?.rule ?? root.rule) : root.rule;
  return {
    token,
    state: root.allowed ? 'allowed' : 'disallowed',
    disallowed_paths: disallowed,
    matched_by: root.matchedBy,
    matched_rule: decisive ? { type: decisive.type, path: decisive.path, line: decisive.line } : null,
    reason: robots.truncated ? 'robots.txt exceeded 500 KiB; rules after the limit were ignored, as RFC 9309 permits' : null,
    confidence: robots.truncated ? 'medium' : 'high',
  };
}

function crawlerFinding(entry: CrawlerToken, result: CrawlerAccessResult, robots: RobotsObservation | undefined, subject: string): TechnicalFinding {
  const partial = result.state === 'allowed' && result.disallowed_paths.length > 0;
  let state: TechnicalFindingState;
  if (result.state === 'allowed') state = partial ? (SEARCH_KINDS.has(entry.kind) ? 'issue' : 'info') : 'pass';
  else if (result.state === 'disallowed') state = SEARCH_KINDS.has(entry.kind) ? 'issue' : 'info';
  else state = result.state;
  const label = `${entry.token} (${entry.operator}${entry.legacy ? ', legacy token' : ''})`;
  const detail = result.state === 'allowed'
    ? partial
      ? `robots.txt allows ${label} at the site root but disallows ${result.disallowed_paths.join(', ')}.`
      : `robots.txt allows ${label} on every evaluated path.`
    : result.state === 'disallowed'
      ? `robots.txt disallows ${label} at the site root.`
      : result.state === 'indeterminate'
        ? `Access for ${label} cannot be determined.`
        : `Access for ${label} was not evaluated.`;
  const excerpt = result.matched_rule ? `line ${result.matched_rule.line}: ${result.matched_rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${result.matched_rule.path}` : null;
  return {
    check_id: `ai_crawler_access.${entry.token}`,
    check_version: AI_AGENT_REGISTRY_VERSION,
    subject_url: subject,
    state,
    detail_state: partial ? 'partially_disallowed' : result.state,
    detail: entry.note ? `${detail} ${entry.note}` : detail,
    evidence_excerpt: clip(excerpt),
    source_url: robots?.url ?? null,
    source_http_status: robots?.status ?? null,
    retrieved_at: robots?.fetched_at ?? null,
    confidence: result.confidence,
    limitation: ROBOTS_LIMITATION,
    feeds_dimension: SEARCH_KINDS.has(entry.kind) ? 'index_integrity' : 'ai_surface_presence',
    reason: result.reason,
  };
}

// ── llms.txt ───────────────────────────────────────────────────────────────────────────────

function llmsFinding(checkId: 'llms_txt' | 'llms_full_txt', obs: LlmsTxtObservation | undefined, subject: string): TechnicalFinding {
  const name = checkId === 'llms_txt' ? 'llms.txt' : 'llms-full.txt';
  if (!obs) {
    return {
      check_id: checkId, check_version: TECHNICAL_FINDINGS_VERSION, subject_url: subject, state: 'unavailable', detail_state: null,
      detail: `${name} was not checked by the crawl that produced this evidence.`, evidence_excerpt: null, source_url: null,
      source_http_status: null, retrieved_at: null, confidence: 'high', limitation: LLMS_TXT_LIMITATION, feeds_dimension: 'extraction_readiness',
      reason: 'not collected by this crawl',
    };
  }
  const state: TechnicalFindingState = obs.state === 'indeterminate' ? 'indeterminate' : obs.state === 'unavailable' ? 'unavailable' : 'info';
  const detail = {
    present_well_formed: `${name} is published (title, ${obs.structure?.link_count ?? 0} link${obs.structure?.link_count === 1 ? '' : 's'}, ${obs.structure?.h2_sections ?? 0} section${obs.structure?.h2_sections === 1 ? '' : 's'}).`,
    present_malformed: `${name} answered, but without the expected markdown structure (an H1 title and at least one link)${obs.outcome === 'html_body' ? ' — the URL served an HTML page' : ''}.`,
    present_exceeds_cap: `${name} is published and is larger than the ${checkId === 'llms_txt' ? '256' : '64'} KiB read limit; its structure was not parsed.`,
    absent: `${name} is not published (HTTP ${obs.status}). It is optional.`,
    indeterminate: `${name} could not be read (${obs.outcome}${obs.status ? `, HTTP ${obs.status}` : ''}).`,
    unavailable: `${name} could not be requested (no HTTP response).`,
  }[obs.state];
  return {
    check_id: checkId, check_version: TECHNICAL_FINDINGS_VERSION, subject_url: subject, state, detail_state: obs.state, detail,
    evidence_excerpt: clip(obs.excerpt), source_url: obs.url, source_http_status: obs.status, retrieved_at: obs.fetched_at,
    confidence: obs.state === 'present_malformed' && obs.outcome === 'html_body' ? 'medium' : 'high',
    limitation: LLMS_TXT_LIMITATION, feeds_dimension: 'extraction_readiness',
    reason: state === 'info' ? null : obs.reason,
  };
}

// ── JSON-LD ────────────────────────────────────────────────────────────────────────────────

function jsonLdFindings(pages: readonly TechnicalFindingPageRow[], subject: string): TechnicalFinding[] {
  const read = pages.filter(isRead);
  const validated = read.filter((p) => p.crawl_metadata?.signals?.jsonld_validation);
  const latest = validated.map((p) => p.last_crawled_at).filter(Boolean).sort().pop() ?? null;
  const common = { check_version: JSONLD_RULESET_VERSION, subject_url: subject, source_url: null, source_http_status: null, retrieved_at: latest, limitation: JSONLD_LIMITATION, feeds_dimension: 'extraction_readiness' as const };
  if (validated.length === 0) {
    const reason = read.length === 0 ? 'no readable crawled pages' : 'the crawled pages predate structured-data validation';
    return ['jsonld_syntax', 'jsonld_required_properties'].map((check_id) => ({
      ...common, check_id, state: 'unavailable' as const, detail_state: null, detail: 'Structured data was not validated for this crawl.',
      evidence_excerpt: null, confidence: 'high' as const, reason,
    }));
  }
  const v = (p: TechnicalFindingPageRow) => p.crawl_metadata!.signals!.jsonld_validation!;
  const withBlocks = validated.filter((p) => v(p).blocks > 0);
  const invalid = validated.filter((p) => v(p).invalid_blocks > 0);
  const missing = validated.filter((p) => v(p).nodes.some((n) => n.missing_required.length > 0));
  const supported = validated.filter((p) => v(p).supported_nodes > 0);

  const syntax: TechnicalFinding = withBlocks.length === 0
    ? { ...common, check_id: 'jsonld_syntax', state: 'info', detail_state: 'no_structured_data', detail: `No JSON-LD structured data on ${validated.length} validated page${validated.length === 1 ? '' : 's'}.`, evidence_excerpt: null, confidence: 'high' }
    : invalid.length > 0
      ? {
        ...common, check_id: 'jsonld_syntax', state: 'issue', detail_state: 'invalid_syntax',
        detail: `${invalid.length} of ${withBlocks.length} page${withBlocks.length === 1 ? '' : 's'} with JSON-LD contain a block that is not valid JSON, so no consumer can read it.`,
        evidence_excerpt: clip(`${invalid[0].url} block ${v(invalid[0]).first_error?.block_index ?? 0}: ${v(invalid[0]).first_error?.message ?? ''}`),
        source_url: invalid[0].url, confidence: 'high', examples: examplesOf(invalid),
      }
      : { ...common, check_id: 'jsonld_syntax', state: 'pass', detail_state: 'valid_syntax', detail: `Every JSON-LD block on ${withBlocks.length} page${withBlocks.length === 1 ? '' : 's'} is valid JSON.`, evidence_excerpt: null, confidence: 'high' };

  let required: TechnicalFinding;
  if (supported.length === 0) {
    required = { ...common, check_id: 'jsonld_required_properties', state: 'info', detail_state: withBlocks.length ? 'unsupported_types_only' : 'no_structured_data',
      detail: withBlocks.length ? 'The JSON-LD present uses only types outside the supported set (Organization, WebSite, Product, SoftwareApplication, LocalBusiness, FAQPage, Article, BreadcrumbList); no property check applies.' : 'No supported structured-data types to check.',
      evidence_excerpt: null, confidence: 'high' };
  } else if (missing.length > 0) {
    const first = v(missing[0]).nodes.find((n) => n.missing_required.length > 0)!;
    required = { ...common, check_id: 'jsonld_required_properties', state: 'issue', detail_state: 'valid_syntax_missing_required',
      detail: `${missing.length} of ${supported.length} page${supported.length === 1 ? '' : 's'} with supported types miss a required property (e.g. ${first.type}: ${first.missing_required.slice(0, 3).join(', ')}).`,
      evidence_excerpt: clip(`${missing[0].url} ${first.type} missing ${first.missing_required.join(', ')}`), source_url: missing[0].url, confidence: 'high', examples: examplesOf(missing) };
  } else {
    required = { ...common, check_id: 'jsonld_required_properties', state: 'pass', detail_state: 'valid_syntax_complete',
      detail: `Supported structured-data types on ${supported.length} page${supported.length === 1 ? '' : 's'} carry their required properties. This does not establish eligibility for rich results.`,
      evidence_excerpt: null, confidence: 'high' };
  }
  return [syntax, required];
}

// ── Page-level index signals (canonical target, X-Robots-Tag) ──────────────────────────────

const sameSite = (a: string, b: string) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

function canonicalFinding(pages: readonly TechnicalFindingPageRow[], subject: string): TechnicalFinding {
  const read = pages.filter(isRead);
  const measured = read.filter((p) => p.crawl_metadata?.signals && 'canonical_href' in p.crawl_metadata.signals);
  const common = { check_id: 'canonical_target', check_version: TECHNICAL_FINDINGS_VERSION, subject_url: subject, source_url: null, source_http_status: null, limitation: PAGE_SIGNAL_LIMITATION, feeds_dimension: 'index_integrity' as const };
  if (measured.length === 0) {
    return { ...common, state: 'unavailable', detail_state: null, detail: 'Canonical targets were not recorded for this crawl.', evidence_excerpt: null, retrieved_at: null, confidence: 'high', reason: read.length ? 'the crawled pages predate canonical-target capture' : 'no readable crawled pages' };
  }
  const offSite: TechnicalFindingPageRow[] = [];
  const unparseable: TechnicalFindingPageRow[] = [];
  const elsewhere: TechnicalFindingPageRow[] = [];
  let declared = 0;
  for (const p of measured) {
    const href = p.crawl_metadata!.signals!.canonical_href;
    if (!href) continue;
    declared += 1;
    let target: URL;
    try { target = new URL(href, p.url); } catch { unparseable.push(p); continue; }
    let page: URL;
    try { page = new URL(p.url); } catch { continue; }
    if (!sameSite(target.hostname.toLowerCase(), page.hostname.toLowerCase())) offSite.push(p);
    else if ((target.pathname.replace(/\/$/, '') || '/') !== (page.pathname.replace(/\/$/, '') || '/')) elsewhere.push(p);
  }
  const latest = measured.map((p) => p.last_crawled_at).filter(Boolean).sort().pop() ?? null;
  if (declared === 0) {
    return { ...common, state: 'info', detail_state: 'none_declared', detail: `None of ${measured.length} crawled page${measured.length === 1 ? '' : 's'} declares a canonical URL.`, evidence_excerpt: null, retrieved_at: latest, confidence: 'high' };
  }
  if (offSite.length || unparseable.length) {
    const bad = [...offSite, ...unparseable];
    return { ...common, state: 'issue', detail_state: offSite.length ? 'off_site' : 'unparseable',
      detail: `${offSite.length} page${offSite.length === 1 ? '' : 's'} declare a canonical URL on another site${unparseable.length ? ` and ${unparseable.length} declare one that cannot be parsed` : ''}; search engines may index the other URL instead.`,
      evidence_excerpt: clip(`${bad[0].url} → ${bad[0].crawl_metadata!.signals!.canonical_href}`), retrieved_at: latest, confidence: 'high', examples: examplesOf(bad) };
  }
  return { ...common, state: elsewhere.length ? 'info' : 'pass', detail_state: elsewhere.length ? 'points_elsewhere_same_site' : 'self_referencing',
    detail: elsewhere.length
      ? `${elsewhere.length} of ${declared} page${declared === 1 ? '' : 's'} canonicalise to a different URL on the same site (normal for variants; check it is intended).`
      : `All ${declared} declared canonical URL${declared === 1 ? '' : 's'} point to the page itself.`,
    evidence_excerpt: elsewhere.length ? clip(`${elsewhere[0].url} → ${elsewhere[0].crawl_metadata!.signals!.canonical_href}`) : null,
    retrieved_at: latest, confidence: 'high', examples: examplesOf(elsewhere) };
}

function xRobotsFinding(pages: readonly TechnicalFindingPageRow[], subject: string): TechnicalFinding {
  const read = pages.filter(isRead);
  const measured = read.filter((p) => p.crawl_metadata?.signals && 'x_robots_tag' in p.crawl_metadata.signals);
  const common = { check_id: 'x_robots_tag_noindex', check_version: TECHNICAL_FINDINGS_VERSION, subject_url: subject, source_url: null, source_http_status: null, limitation: PAGE_SIGNAL_LIMITATION, feeds_dimension: 'index_integrity' as const };
  if (measured.length === 0) {
    return { ...common, state: 'unavailable', detail_state: null, detail: 'X-Robots-Tag headers were not recorded for this crawl.', evidence_excerpt: null, retrieved_at: null, confidence: 'high', reason: read.length ? 'the crawled pages predate X-Robots-Tag capture' : 'no readable crawled pages' };
  }
  // `noindex` / `none`, either bare or scoped to a user agent ("googlebot: noindex").
  const noindex = measured.filter((p) => /(^|[\s,:])(noindex|none)(\s*(,|$))/i.test(p.crawl_metadata!.signals!.x_robots_tag ?? ''));
  const latest = measured.map((p) => p.last_crawled_at).filter(Boolean).sort().pop() ?? null;
  return noindex.length
    ? { ...common, state: 'issue', detail_state: 'noindex_header', detail: `${noindex.length} of ${measured.length} crawled page${measured.length === 1 ? '' : 's'} send an X-Robots-Tag header that blocks indexing (not visible in the HTML).`, evidence_excerpt: clip(`${noindex[0].url}: X-Robots-Tag: ${noindex[0].crawl_metadata!.signals!.x_robots_tag}`), retrieved_at: latest, confidence: 'high', examples: examplesOf(noindex) }
    : { ...common, state: 'pass', detail_state: 'no_noindex_header', detail: `No crawled page sends an X-Robots-Tag noindex header (${measured.length} checked).`, evidence_excerpt: null, retrieved_at: latest, confidence: 'high' };
}

// ── Entity readiness ───────────────────────────────────────────────────────────────────────

const LEGAL_SUFFIX = /[\s,]+(inc|inc\.|llc|ltd|ltd\.|limited|gmbh|pvt|pvt\.|private|plc|corp|corp\.|corporation|co\.?|s\.?a\.?|ag|bv|oy|ab)\.?$/i;
export function normalizeEntityName(name: string): string {
  let n = name.toLowerCase().normalize('NFKC').replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i += 1) n = n.replace(LEGAL_SUFFIX, '').trim();
  return n.replace(/[^\p{L}\p{N} ]/gu, '').trim();
}

function entityFindings(pages: readonly TechnicalFindingPageRow[], subject: string): TechnicalFinding[] {
  const read = pages.filter(isRead);
  const observations: Array<{ source: string; value: string; url: string }> = [];
  for (const p of read) {
    const sig = p.crawl_metadata?.signals;
    for (const org of sig?.jsonld_validation?.org_nodes ?? []) {
      if (org.name) observations.push({ source: 'JSON-LD name', value: org.name, url: p.url });
    }
    const siteName = p.crawl_metadata?.meta_tags?.['og:site_name'];
    if (typeof siteName === 'string' && siteName.trim()) observations.push({ source: 'og:site_name', value: siteName.trim().slice(0, 120), url: p.url });
  }
  const latest = read.map((p) => p.last_crawled_at).filter(Boolean).sort().pop() ?? null;
  const common = { check_version: TECHNICAL_FINDINGS_VERSION, subject_url: subject, source_url: null, source_http_status: null, retrieved_at: latest, limitation: ENTITY_LIMITATION };
  const distinct = new Map<string, { value: string; source: string; urls: Set<string> }>();
  for (const o of observations) {
    const key = normalizeEntityName(o.value);
    if (!key) continue;
    const entry = distinct.get(key) ?? { value: o.value, source: o.source, urls: new Set<string>() };
    entry.urls.add(o.url);
    distinct.set(key, entry);
  }
  let name: TechnicalFinding;
  if (observations.length < 2) {
    name = { ...common, check_id: 'entity_name_consistency', state: 'unavailable', detail_state: 'insufficient_evidence', detail: 'Too few self-declared organisation names on the crawled pages to compare.', evidence_excerpt: null, confidence: 'high', feeds_dimension: 'entity_graph_strength', reason: `${observations.length} declaration${observations.length === 1 ? '' : 's'} found (JSON-LD Organization name, og:site_name); at least 2 are needed` };
  } else if (distinct.size <= 1) {
    const only = [...distinct.values()][0];
    name = { ...common, check_id: 'entity_name_consistency', state: 'pass', detail_state: 'consistent', detail: `The site names itself consistently (${observations.length} declarations): “${only?.value ?? ''}”.`, evidence_excerpt: null, confidence: 'high', feeds_dimension: 'entity_graph_strength' };
  } else {
    const variants = [...distinct.values()].slice(0, 5);
    name = { ...common, check_id: 'entity_name_consistency', state: 'info', detail_state: 'variants_observed',
      detail: `The site declares ${distinct.size} different organisation names across its pages: ${variants.map((v) => `“${v.value}” (${v.source})`).join(', ')}.`,
      evidence_excerpt: clip(variants.map((v) => `${v.value} @ ${[...v.urls][0]}`).join(' | ')), confidence: 'high', feeds_dimension: 'entity_graph_strength',
      examples: variants.map((v) => ({ url: [...v.urls][0] })).slice(0, 5) };
  }

  const declaredHosts = [...new Set(read.flatMap((p) => p.crawl_metadata?.signals?.same_as ?? []).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } }).filter((h): h is string => !!h))];
  const localDeclared = read.some((p) => (p.crawl_metadata?.signals?.jsonld_validation?.org_nodes ?? []).some((o) => o.family === 'LocalBusiness'));

  const sameAs: TechnicalFinding = {
    ...common, check_id: 'entity_sameas_crosscheck', state: 'unavailable', detail_state: null,
    detail: `Declared profile links${declaredHosts.length ? ` (${declaredHosts.slice(0, 6).join(', ')})` : ''} were not cross-checked against a knowledge graph.`,
    evidence_excerpt: null, confidence: 'high', feeds_dimension: 'entity_graph_strength',
    reason: 'The Wikidata integration does not expose external-identifier claims (LinkedIn, Crunchbase, X), so declared profiles cannot be cross-checked in this release.',
  };
  const nap: TechnicalFinding = {
    ...common, check_id: 'local_nap_consistency', state: 'unavailable', detail_state: localDeclared ? 'local_business_declared' : null,
    detail: 'Name/address/phone consistency was not evaluated.',
    evidence_excerpt: null, confidence: 'high', feeds_dimension: 'trust_coherence',
    reason: 'No local-business gate exists yet: the company profile has no local-business field, and NAP checks must apply only to local businesses. No Google Business Profile integration provides NAP.',
  };
  return [name, sameAs, nap];
}

// ── Entry point ────────────────────────────────────────────────────────────────────────────

const STATES: TechnicalFindingState[] = ['pass', 'issue', 'info', 'indeterminate', 'not_applicable', 'unavailable'];

/**
 * Build every technical-readiness finding from stored crawl rows. Pure, deterministic for a
 * given input, never throws, never mutates its input.
 *
 * @param input.pages     `canonical_pages` rows for the report's domain scope (any order).
 * @param input.targetUrl the report's website, used as the subject when no root row exists.
 */
export function buildTechnicalFindings(input: { pages: readonly TechnicalFindingPageRow[]; targetUrl?: string | null }): TechnicalFindingsResult {
  const pages = Array.isArray(input?.pages) ? input.pages : [];
  const site = siteSignalsOf(pages);
  const origin = originOf(site?.row.url) ?? originOf(input?.targetUrl ?? null) ?? originOf(pages[0]?.url) ?? (input?.targetUrl ?? '');
  const subject = origin ? `${origin}/` : '';
  const findings: TechnicalFinding[] = [];

  try {
    const robots = site?.site.robots;
    const paths = keyPaths(pages);
    if (robots) {
      findings.push({
        check_id: 'robots_fetch_outcome', check_version: TECHNICAL_FINDINGS_VERSION, subject_url: subject,
        state: robots.outcome === 'ok' ? 'pass' : robots.outcome === 'unreachable' ? 'unavailable' : ['server_error', 'rate_limited', 'timeout', 'too_large'].includes(robots.outcome) ? 'indeterminate' : 'info',
        detail_state: robots.outcome,
        detail: robots.outcome === 'ok'
          ? `robots.txt was read (${robots.groups.length} group${robots.groups.length === 1 ? '' : 's'}${robots.sitemaps.length ? `, ${robots.sitemaps.length} sitemap declaration${robots.sitemaps.length === 1 ? '' : 's'}` : ''}).`
          : `robots.txt fetch outcome: ${robots.outcome}${robots.status ? ` (HTTP ${robots.status})` : ''}.`,
        evidence_excerpt: robots.sha256 ? `sha256 ${robots.sha256.slice(0, 16)}…` : null,
        source_url: robots.url, source_http_status: robots.status, retrieved_at: robots.fetched_at,
        confidence: 'high', limitation: ROBOTS_LIMITATION, feeds_dimension: 'index_integrity',
        reason: ['server_error', 'rate_limited', 'timeout', 'too_large'].includes(robots.outcome) ? RFC_UNREACHABLE_NOTE : robots.reason,
      });
    }
    for (const entry of AI_CRAWLER_REGISTRY) {
      findings.push(crawlerFinding(entry, evaluateCrawlerAccess(robots, entry.token, paths), robots, subject));
    }
    findings.push(llmsFinding('llms_txt', site?.site.llms, subject));
    findings.push(llmsFinding('llms_full_txt', site?.site.llms_full, subject));
    findings.push(...jsonLdFindings(pages, subject));
    findings.push(canonicalFinding(pages, subject));
    findings.push(xRobotsFinding(pages, subject));
    findings.push(...entityFindings(pages, subject));
  } catch {
    // Never throws: a malformed row degrades to whatever was built before it.
  }

  const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<TechnicalFindingState, number>;
  for (const f of findings) counts[f.state] += 1;
  return { version: TECHNICAL_FINDINGS_VERSION, registry_version: AI_AGENT_REGISTRY_VERSION, jsonld_ruleset_version: JSONLD_RULESET_VERSION, findings, counts };
}
