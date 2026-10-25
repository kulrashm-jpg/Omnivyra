/**
 * Dossier v2 — the canonical evidence ledger for one report.
 *
 * Every count, denominator and source state the report prints comes from here, so the summary
 * pages, the detailed sections and the appendix cannot disagree. Two inputs:
 *   - the report run (CanonicalExportPayload): crawl, scoring-run AI checks, backlinks, reviews…
 *   - the public-research pack collected with it (optional): AI answers, footprint, runtime.
 * Where both speak about the same capability, the research record wins: it is the newer runtime
 * evidence, and it records adapter / credential / attempt / outcome explicitly.
 *
 * States never collapse: "not attempted", "not configured", "configured but failed",
 * "restricted", "searched, not found" and "measured" stay distinct, and nothing missing becomes 0.
 */
import type { CanonicalExportPayload } from '../canonicalExport';
import { isBrandQuestion, type ResearchPack } from './research';
import type { ReasonClass } from '../publicResearch/runtime';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj).filter((o): o is Obj => Boolean(o)) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export type AccessRow = {
  capability: string;
  family: 'website' | 'search' | 'ai_answers' | 'social' | 'mentions' | 'reviews' | 'backlinks' | 'knowledge_graph' | 'page_speed' | 'registry' | 'competitors';
  adapter: boolean | null;
  credential: boolean | null;
  attempted: boolean | null;
  reason: ReasonClass;
  outcome: string;
  nextStep: string | null;
  source: 'research' | 'report_run';
};

/**
 * The one vocabulary for an AI tool's state, used on every page. An answer counts only when it is
 * measured_grounded (built from live web search, with sources); everything else says why not.
 */
export type AiState = 'measured_grounded' | 'answered_not_grounded' | 'source_failed' | 'not_configured' | 'not_tested' | 'inaccessible' | 'unknown';
export const AI_STATE_LABEL: Record<AiState, string> = {
  measured_grounded: 'measured, grounded', answered_not_grounded: 'answered, not grounded', source_failed: 'source failed',
  not_configured: 'not configured', not_tested: 'not tested', inaccessible: 'inaccessible', unknown: 'unknown',
};
export function aiStateOf(reason: ReasonClass | 'ungrounded'): AiState {
  switch (reason) {
    case 'measured': case 'partial': return 'measured_grounded';
    case 'ungrounded': return 'answered_not_grounded';
    case 'request_failed': case 'quota_restricted': return 'source_failed';
    case 'missing_credential': return 'not_configured';
    case 'not_searched': return 'not_tested';
    // No adapter: the provider may offer access (Meta's Model API does), this system has not built it.
    case 'no_adapter': return 'not_tested';
    case 'restricted': return 'inaccessible';
    default: return 'unknown';
  }
}
/** One generative record (one question to one tool) in the same vocabulary. */
export function aiCellState(r: { status: string; kind?: string; surface?: string }): AiState {
  if (r.kind === 'model_recall') return 'answered_not_grounded';
  if (r.status === 'observed') return 'measured_grounded';
  if (r.status === 'failed_source') return 'source_failed';
  if (r.status === 'insufficient_evidence' || r.status === 'inferred') return 'answered_not_grounded';
  if (r.status === 'not_measured') return /meta/i.test(String(r.surface ?? r.kind ?? '')) ? 'not_tested' : 'not_configured';
  return 'unknown';
}

/** What kind of observation a tool's answers are: never an observation of the consumer app unless it says so. */
export function surfaceTypeOf(label: string, source: 'research' | 'report_run'): string {
  if (source === 'report_run') return 'scoring-run API check';
  if (/meta ai/i.test(label)) return 'no adapter (Meta Model API not integrated; consumer app not used)';
  if (/ai mode|copilot/i.test(label)) return 'results page captured via SerpAPI';
  return 'API answer with live web search (not the consumer app)';
}

export type AiRow = {
  label: string;
  source: 'research' | 'report_run';
  /** surfaceTypeOf(label, source). */
  surfaceType: string;
  state: AiState;
  reason: ReasonClass | 'ungrounded';
  asked: number;
  answered: number;
  buyerAnswers: number;
  buyerNamed: number;
  brandCorrect: number;
  brandConfused: number;
};

/** What a web address is for, read from its path (and the crawler's page type), so depth is judged against purpose. */
export type UrlPurpose = 'Home' | 'Product and features' | 'Pricing' | 'Articles' | 'Help and FAQ' | 'Contact and sales' | 'About' | 'Legal' | 'Account and app screens' | 'Other';
const PURPOSES: Array<[RegExp, UrlPurpose]> = [
  [/\/(privacy|terms|cookie|legal|data-deletion|imprint|disclaimer|refund)/i, 'Legal'],
  [/^\/(auth|login|logout|sign-?in|sign-?up|create-account|register|account|dashboard|settings|admin|super-?admin|api|onboarding|app|command-center|team-management|company-profile)(\/|$)|\/(create|edit|view|callback|mfa|login)(\/|$)|[0-9a-f]{8}-[0-9a-f]{4}-/i, 'Account and app screens'],
  [/^\/(pricing|plans?)(\/|$)/i, 'Pricing'],
  [/^\/(features?|products?|solutions?|platform|how-it-works|use-cases?)(\/|$)/i, 'Product and features'],
  [/^\/(blog|blogs|news|articles?|insights|resources|whitepapers?|guides?)(\/|$)/i, 'Articles'],
  [/^\/(help|faqs?|docs|support)(\/|$)/i, 'Help and FAQ'],
  [/^\/(contact|contact-sales|demo|book|get-free-credits|free-audit)(\/|$|-)/i, 'Contact and sales'],
  [/^\/(about|company|team|careers)(\/|$)/i, 'About'],
];
export function urlPurpose(path: string, pageType?: string | null): UrlPurpose {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/') return 'Home';
  const byPath = PURPOSES.find(([re]) => re.test(p))?.[1];
  if (byPath) return byPath;
  return pageType === 'pricing' ? 'Pricing' : pageType === 'feature' || pageType === 'product' ? 'Product and features' : pageType === 'blog' ? 'Articles' : pageType === 'contact' ? 'Contact and sales' : 'Other';
}

export type CrawlOutcomeCounts = { read: number; clientError: number; serverError: number; noResponse: number; redirectedOffSite: number; notFetched: number };

export type Ledger = {
  /**
   * Crawl funnel. With per-URL states recorded: known = attempted + notAttempted, attempted =
   * responded + noResponse. Without them `attempted` and `notAttempted` are null and the remainder
   * is "not observed; attempt status unknown".
   */
  crawl: {
    known: number | null; attempted: number | null; responded: number | null; read: number | null; evaluated: number | null;
    notAttempted: number | null; notObserved: number | null; outcomes: CrawlOutcomeCounts | null;
    byPurpose: Array<{ purpose: UrlPurpose } & CrawlOutcomeCounts> | null;
    lastCrawledIso: string | null; reused: boolean;
  };
  checks: { total: number | null; evaluated: number | null };
  search: { source: 'research' | 'report_run'; checked: number; found: number; brandedFound: number; geography: string | null; date: string | null } | null;
  ai: AiRow[];
  /** Denominators: calls attempted (configured tools only) → grounded answers → grounded answers to buyer questions → naming the brand. */
  aiTotals: { attemptedCalls: number; groundedAnswers: number; buyerAnswers: number; buyerNamed: number; measured: string[]; notMeasured: string[] };
  aio: { total: number; retrieved: number; failed: number } | null;
  footprint: {
    profiles: { total: number; confirmed: number; domainLinked: number; fetched: number; inaccessible: number; declaredOnly: number };
    mentions: { confirmed: number; unconfirmed: number; searched: boolean };
    reviews: { checked: number; listed: number; claimed: number; notFound: number; searched: boolean };
  } | null;
  /** The external footprint by family: never collapsed into one "presence" number. */
  families: FootprintFamily[];
  /** Official profiles, one row each, on the identity ladder. */
  identities: ProfileIdentity[];
  access: AccessRow[];
  coverage: { measured: number; partial: number; notMeasured: number };
};

export type FamilyState = 'found' | 'searched_not_found' | 'not_measured' | 'inaccessible' | 'not_attempted';
export type FootprintFamily = {
  key: 'inbound_links' | 'profiles_to_site' | 'site_to_profiles' | 'editorial' | 'partner_customer' | 'directories' | 'registry' | 'reviews' | 'entity';
  label: string;
  attempted: boolean;
  source: string;
  state: FamilyState;
  result: string;
  checkedAt: string | null;
  urls: string[];
  /** How sure the evidence is about THIS company (not a namesake). */
  identity: 'high' | 'medium' | 'low' | null;
  limitation: string;
};
export type ProfileIdentity = {
  platform: string; url: string; declared: boolean; foundBySearch: boolean; opened: boolean; identityConfirmed: boolean; linksToSite: boolean | null; siteLinksToProfile: boolean;
  posts: { count: number; newest: string | null; oldest: string | null } | null; blocked: string | null;
};

/** Scoring-run state of one AI provider, from its citation-matrix cells. */
function runAiReason(cells: Obj[]): AiRow['reason'] {
  const reasons = cells.map((c) => String(c.reason_unavailable ?? ''));
  if (cells.some((c) => c.state === 'measured')) return 'measured';
  if (reasons.some((r) => /not retrieval-grounded|model recall/i.test(r))) return 'ungrounded';
  if (reasons.some((r) => /failed to load|error/i.test(r))) return 'request_failed';
  if (reasons.some((r) => /not configured/i.test(r))) return 'missing_credential';
  return 'not_searched';
}

/** Scoring-run provider ids, in the labels the research step uses, so one tool has one row. */
export const PROVIDER_LABEL: Record<string, string> = { chatgpt: 'ChatGPT search', claude: 'Claude (web search)', gemini: 'Gemini (Google Search grounding)', perplexity: 'Perplexity', copilot: 'Bing Copilot' };

export function buildLedger(payload: CanonicalExportPayload, pack: ResearchPack | null): Ledger {
  const r1 = payload.report1;
  const crawl = obj(obj(r1?.evidence_acquisition)?.crawl);
  const wc = obj(r1?.website_checks);
  const evaluated = num(wc?.pagesEvaluated) ?? num(obj(obj(r1?.digital_experience)?.coverage)?.pagesEvaluated);
  // Per-URL states (recorded since the crawl funnel was added): the funnel is counted, not assumed.
  const urls = Array.isArray(crawl?.urls) ? objs(crawl!.urls) : null;
  const tally = (rows: Obj[]): CrawlOutcomeCounts => ({
    read: rows.filter((u) => u.outcome === 'read').length, clientError: rows.filter((u) => u.outcome === 'client_error').length,
    serverError: rows.filter((u) => u.outcome === 'server_error').length, noResponse: rows.filter((u) => u.outcome === 'no_response').length,
    redirectedOffSite: rows.filter((u) => u.outcome === 'redirected_off_site').length, notFetched: rows.filter((u) => u.outcome === 'not_fetched').length,
  });
  const outcomes = urls ? tally(urls) : null;
  const known = urls ? urls.length : num(crawl?.pagesAfter);
  const attempted = outcomes ? urls!.length - outcomes.notFetched : null;
  // Without per-URL states only the pages that answered are known, so "responded" is the evaluated
  // set and the remainder is NOT OBSERVED (never "failed").
  const responded = outcomes ? attempted! - outcomes.noResponse : evaluated;
  const byPurpose = urls ? (() => {
    const groups = new Map<UrlPurpose, Obj[]>();
    for (const u of urls) { const k = urlPurpose(String(u.path ?? '/'), str(u.pageType)); groups.set(k, [...(groups.get(k) ?? []), u]); }
    return [...groups.entries()].map(([purpose, rows]) => ({ purpose, ...tally(rows) })).sort((a, b) => (b.read + b.notFetched) - (a.read + a.notFetched));
  })() : null;

  // Search: research pack first, else the report run.
  const research = pack?.search.filter((r) => r.status === 'observed') ?? [];
  const sv = obj(r1?.search_visibility);
  const search: Ledger['search'] = research.length
    ? { source: 'research', checked: research.length, found: research.filter((r) => r.ownPosition != null).length,
      brandedFound: research.filter((r) => isBrandQuestion(r, pack?.subject.brand ?? '') && r.ownPosition != null).length, geography: research[0]?.geography ?? null, date: research[0]?.observedAt?.slice(0, 10) ?? null }
    : num(sv?.queriesRun)
      ? { source: 'report_run', checked: num(sv?.queriesRun)!, found: num(sv?.queriesRanked) ?? 0, brandedFound: 0, geography: null, date: str(sv?.observedAt)?.slice(0, 10) ?? null }
      : null;

  // AI answers: one row per tool; research rows replace the scoring run's row for the same tool.
  const brand = pack?.subject.brand ?? '';
  const ai: AiRow[] = [];
  const researchCaps = pack?.runtime?.capabilities.filter((c) => c.family === 'ai_answers') ?? [];
  for (const cap of researchCaps) {
    const rs = pack!.generative.filter((g) => g.surface === cap.label && g.query);
    const ok = rs.filter((g) => g.status === 'observed');
    const buyer = ok.filter((g) => !isBrandQuestion(g, brand));
    const brandQs = ok.filter((g) => g.accuracy);
    ai.push({ label: cap.label, source: 'research', surfaceType: surfaceTypeOf(cap.label, 'research'), state: aiStateOf(cap.reason), reason: cap.reason, asked: rs.length, answered: ok.length,
      buyerAnswers: buyer.length, buyerNamed: buyer.filter((g) => g.mentioned).length,
      brandCorrect: brandQs.filter((g) => g.accuracy === 'correct').length, brandConfused: brandQs.filter((g) => g.accuracy === 'misidentified').length });
  }
  // Packs collected before the runtime snapshot existed: derive rows from the answers themselves.
  if (!researchCaps.length && pack) {
    for (const label of [...new Set(pack.generative.filter((g) => g.query && g.kind !== 'ai_overview').map((g) => String(g.surface)))]) {
      const rs = pack.generative.filter((g) => g.surface === label && g.query);
      const ok = rs.filter((g) => g.status === 'observed');
      const buyer = ok.filter((g) => !isBrandQuestion(g, brand));
      const reason: ReasonClass = ok.length === rs.length ? 'measured' : ok.length ? 'partial'
        : rs.every((g) => g.status === 'not_measured') ? (/meta/i.test(label) ? 'no_adapter' : 'missing_credential') : 'request_failed';
      ai.push({ label, source: 'research', surfaceType: surfaceTypeOf(label, 'research'), state: aiStateOf(reason), reason,
        asked: rs.length, answered: ok.length, buyerAnswers: buyer.length, buyerNamed: buyer.filter((g) => g.mentioned).length,
        brandCorrect: ok.filter((g) => g.accuracy === 'correct').length, brandConfused: ok.filter((g) => g.accuracy === 'misidentified').length });
    }
  }
  const cells = objs(obj(obj(payload.ai_surface_presence)?.citation_matrix)?.cells);
  for (const prov of [...new Set(cells.map((c) => String(c.provider)))]) {
    const label = PROVIDER_LABEL[prov] ?? prov;
    if (ai.some((a) => a.label === label)) continue; // newer research evidence already covers it
    const pc = cells.filter((c) => c.provider === prov);
    ai.push({ label, source: 'report_run', surfaceType: surfaceTypeOf(label, 'report_run'), state: aiStateOf(runAiReason(pc)), reason: runAiReason(pc), asked: pc.length, answered: pc.filter((c) => c.state === 'measured').length,
      buyerAnswers: 0, buyerNamed: 0, brandCorrect: 0, brandConfused: 0 });
  }
  const groundedRows = ai.filter((a) => a.reason === 'measured' || a.reason === 'partial');
  const aiTotals = {
    attemptedCalls: ai.filter((a) => a.state === 'measured_grounded' || a.state === 'source_failed' || a.state === 'answered_not_grounded').reduce((n, a) => n + a.asked, 0),
    groundedAnswers: groundedRows.reduce((n, a) => n + a.answered, 0),
    buyerAnswers: groundedRows.reduce((n, a) => n + a.buyerAnswers, 0),
    buyerNamed: groundedRows.reduce((n, a) => n + a.buyerNamed, 0),
    measured: groundedRows.map((a) => a.label),
    notMeasured: ai.filter((a) => !groundedRows.includes(a)).map((a) => a.label),
  };

  // Google AI Overview: one denominator, mutually exclusive states.
  const aioRecs = pack?.generative.filter((g) => g.kind === 'ai_overview') ?? [];
  const aio = aioRecs.length ? { total: aioRecs.length, retrieved: aioRecs.filter((g) => g.status === 'observed').length, failed: aioRecs.filter((g) => g.status !== 'observed').length } : null;

  const fp = pack?.footprint ?? null;
  const footprint: Ledger['footprint'] = fp ? {
    profiles: {
      total: fp.profiles.length,
      confirmed: fp.profiles.filter((p) => p.state === 'identity_confirmed').length,
      domainLinked: fp.profiles.filter((p) => p.state === 'domain_linked').length,
      fetched: fp.profiles.filter((p) => p.state === 'fetched').length,
      inaccessible: fp.profiles.filter((p) => p.state === 'inaccessible').length,
      declaredOnly: fp.profiles.filter((p) => p.state === 'declared_unverified').length,
    },
    mentions: { confirmed: fp.mentions.filter((m) => m.check === 'confirmed').length, unconfirmed: fp.mentions.filter((m) => m.check !== 'confirmed').length, searched: Boolean(fp.mentionSearch) },
    reviews: { checked: fp.platforms.length, listed: fp.platforms.filter((p) => p.state === 'listed').length, claimed: fp.platforms.filter((p) => p.state === 'claimed_unconfirmed').length,
      notFound: fp.platforms.filter((p) => p.state === 'not_found_in_search').length, searched: Boolean(fp.mentionSearch) },
  } : null;

  // ── External footprint, by family ──
  const families: FootprintFamily[] = [];
  const backlinkSig = obj(obj(payload.authority_inflow)?.score);
  const backlinkText = str(obj(obj(payload.authority_inflow)?.rationale)?.text) ?? '';
  families.push({ key: 'inbound_links', label: 'Inbound links (backlinks)', attempted: backlinkSig?.state === 'measured', source: 'Backlink index (Ahrefs adapter)',
    state: backlinkSig?.state === 'measured' ? 'found' : 'not_measured', checkedAt: null, urls: [], identity: null,
    result: backlinkSig?.state === 'measured' ? backlinkText || 'Measured by the report run.' : 'Backlink authority not measured: no backlink source is connected.',
    limitation: 'A missing key means the count is unknown, not zero. Search Console’s Links report lists linking sites for free to the site owner.' });
  const fpAt = fp?.checkedAt ?? null;
  const profs = fp?.profiles ?? [];
  const linking = profs.filter((p) => p.linksDomain);
  families.push({ key: 'profiles_to_site', label: 'Profiles linking to the website', attempted: profs.some((p) => p.attempted), source: 'Each official profile, opened signed out',
    state: !fp ? 'not_measured' : linking.length ? 'found' : profs.some((p) => p.outcome === 'responded') ? 'searched_not_found' : profs.length ? 'inaccessible' : 'not_measured',
    checkedAt: fpAt, urls: linking.map((p) => p.url), identity: linking.some((p) => p.namesBrand) ? 'high' : linking.length ? 'medium' : null,
    result: !fp ? 'Not checked in this run.' : `${linking.length} of ${profs.length} profile(s) link to the website${profs.filter((p) => p.state === 'inaccessible').length ? `; ${profs.filter((p) => p.state === 'inaccessible').length} could not be read signed out` : ''}.`,
    limitation: 'Platforms that require sign-in are recorded as inaccessible, never as "no link".' });
  const siteProfileRec = pack?.site.find((r) => /social profile/i.test(r.claim));
  const fromSite = profs.filter((p) => p.onHomepage || p.inSameAs);
  families.push({ key: 'site_to_profiles', label: 'Website linking to its profiles', attempted: Boolean(siteProfileRec || fp), source: 'Homepage links and structured data (sameAs)',
    state: !siteProfileRec && !fp ? 'not_measured' : fromSite.length ? 'found' : 'searched_not_found', checkedAt: siteProfileRec?.observedAt ?? fpAt, urls: siteProfileRec ? [siteProfileRec.sourceUrl] : [],
    identity: 'high', result: fromSite.length ? `The homepage links to ${fromSite.map((p) => p.platform).join(', ')}.` : 'The homepage links to no social profile and its structured data has no sameAs list.',
    limitation: 'Only the homepage is checked for profile links.' });
  const ments = fp?.mentions ?? [];
  const famOf = (t: string) => (t === 'partner_or_customer' ? 'partner_customer' : t === 'directory' ? 'directories' : t === 'review' ? 'reviews' : 'editorial');
  const mentionFamily = (key: 'editorial' | 'partner_customer', label: string) => {
    const ms = ments.filter((m) => famOf(m.type) === key);
    const ok = ms.filter((m) => m.check === 'confirmed');
    families.push({ key, label, attempted: Boolean(fp?.mentionSearch), source: fp?.mentionSearch ? `Web search (${fp.mentionSearch}); each page re-opened` : 'Web search',
      state: !fp?.mentionSearch ? 'not_measured' : ok.length ? 'found' : 'searched_not_found', checkedAt: fpAt, urls: ok.map((m) => m.url), identity: ok.length ? 'medium' : null,
      result: !fp?.mentionSearch ? 'Not searched in this run.' : `${ok.length} page(s) confirmed to name the brand${ms.length - ok.length ? `; ${ms.length - ok.length} reported but not confirmed` : ''}.`,
      limitation: 'One web search, not an index of the web: "searched, not found" means that search did not find it.' });
  };
  mentionFamily('editorial', 'Editorial, press and comparison pages');
  mentionFamily('partner_customer', 'Partner and customer pages');
  const DIRECTORY = /crunchbase|product hunt|saasworthy/i;
  const platformFamily = (key: 'directories' | 'reviews', label: string, match: (name: string) => boolean) => {
    const ps = (fp?.platforms ?? []).filter((p) => match(p.platform));
    const ms = ments.filter((m) => famOf(m.type) === key && m.check === 'confirmed');
    const listed = ps.filter((p) => p.state === 'listed');
    families.push({ key, label, attempted: Boolean(fp?.mentionSearch), source: ps.length ? ps.map((p) => p.platform).join(', ') : 'Web search',
      state: !fp?.mentionSearch ? 'not_measured' : listed.length || ms.length ? 'found' : 'searched_not_found', checkedAt: fpAt,
      urls: [...listed.map((p) => p.url), ...ms.map((m) => m.url)], identity: listed.length ? 'high' : ms.length ? 'medium' : null,
      result: !fp?.mentionSearch ? 'Not searched in this run.' : `${ps.map((p) => `${p.platform}: ${p.state === 'listed' ? 'listed' : p.state === 'claimed_unconfirmed' ? 'reported, page not confirmed' : 'not found in search'}`).join('; ')}${ms.length ? `; ${ms.length} other confirmed page(s)` : ''}.`,
      limitation: 'Many review sites block automated reading; a reported listing whose page could not be opened stays unconfirmed.' });
  };
  platformFamily('directories', 'Directories and marketplaces', (n) => DIRECTORY.test(n));
  platformFamily('reviews', 'Review sites', (n) => !DIRECTORY.test(n));
  const market = String(objs(obj(r1?.company_identity)?.fields).find((f) => /market|geograph/i.test(String(f.label)))?.declaredValue ?? '');
  const india = /\bindia\b/i.test(market);
  families.push({ key: 'registry', label: india ? 'Corporate registry (MCA, India)' : 'Corporate registry', attempted: false,
    source: india ? 'Ministry of Corporate Affairs company master data (mca.gov.in)' : 'The national company registry', state: 'not_attempted', checkedAt: null, urls: [], identity: null,
    result: 'Not checked: the report has no registry adapter.',
    limitation: india ? 'The MCA master-data search is an interactive form with a captcha, so it is not automated here. Cheapest next step: look up the company by name or CIN on mca.gov.in by hand and record the CIN.' : 'Look the company up in its national registry by hand and record the registration number.' });

  // Brand/entity consistency: the site's own structured identity and the public knowledge graph.
  const orgRec = pack?.site.find((r) => /structured data/i.test(r.claim));
  const kgSig = obj(obj(payload.knowledge_graph)?.score);
  const kgText = str(obj(obj(payload.knowledge_graph)?.rationale)?.text) ?? '';
  const orgOk = Boolean(orgRec && !/no Organization entity/i.test(orgRec.claim) && /sameAs profile links/i.test(orgRec.claim) && !/but no sameAs/i.test(orgRec.claim));
  families.push({ key: 'entity', label: 'Brand / entity consistency', attempted: Boolean(orgRec) || kgSig != null, source: 'Homepage structured data; Wikidata',
    state: orgOk || kgSig?.state === 'measured' ? 'found' : orgRec || kgSig ? 'searched_not_found' : 'not_measured', checkedAt: orgRec?.observedAt ?? null, urls: orgRec ? [orgRec.sourceUrl] : [], identity: 'high',
    result: `${orgRec ? `${orgRec.claim}.` : 'Structured data not checked.'} ${kgSig?.state === 'measured' ? 'A Wikidata entity exists.' : /no wikidata entity/i.test(kgText) ? 'No Wikidata entity was found.' : 'Knowledge graph not established.'}`,
    limitation: 'Identity links tell engines which profiles and records are the same company; they are not endorsements or backlinks.' });

  const identities: ProfileIdentity[] = profs.map((p) => ({
    platform: p.platform, url: p.url, declared: p.declared, foundBySearch: Boolean(p.foundBySearch), opened: p.outcome === 'responded', identityConfirmed: p.state === 'identity_confirmed',
    linksToSite: p.outcome === 'responded' ? Boolean(p.linksDomain) : null, siteLinksToProfile: p.onHomepage || p.inSameAs, posts: p.posts ?? null,
    blocked: p.state === 'inaccessible' ? p.reason ?? 'Could not be read signed out.' : p.attempted ? null : 'Not opened in this run.',
  }));

  // ── Access reconciliation ──
  const access: AccessRow[] = [];
  const cfg = (id: string) => pack?.runtime?.capabilities.find((c) => c.id === id) ?? null;
  const failedFetch = outcomes ? outcomes.clientError + outcomes.serverError + outcomes.noResponse + outcomes.redirectedOffSite : 0;
  access.push({ capability: 'Website crawl', family: 'website', adapter: true, credential: null, attempted: known != null ? true : null,
    reason: !evaluated ? 'not_searched' : outcomes ? (failedFetch || evaluated < outcomes.read ? 'partial' : 'measured') : known && evaluated < known ? 'partial' : 'measured',
    outcome: known == null ? 'No crawl recorded.'
      : outcomes ? `${attempted} of ${known} known addresses fetched: ${outcomes.read} read${failedFetch ? `, ${failedFetch} failed` : ''}; ${outcomes.notFetched} never fetched (known only from site analytics).`
        : `${evaluated ?? 0} of ${known} known addresses read; ${known - (evaluated ?? 0)} not observed (attempt status not recorded).`,
    nextStep: outcomes ? (failedFetch ? 'Fix or redirect the addresses that returned errors, then re-crawl.' : null)
      : known && evaluated != null && evaluated < known ? 'Record attempts and status codes per URL on the next crawl.' : null, source: 'report_run' });
  access.push({ capability: 'Search results', family: 'search', adapter: true, credential: cfg('search:serp')?.credential ?? null, attempted: search ? true : null,
    reason: search ? 'measured' : cfg('search:serp')?.credential === false ? 'missing_credential' : 'not_searched',
    outcome: search ? `${search.checked} searches checked (${search.source === 'research' ? 'public research' : 'report run'}).` : 'No search observations.',
    nextStep: search ? null : 'Add a SerpAPI key.', source: search?.source ?? 'report_run' });
  for (const a of ai) {
    const cap = pack?.runtime?.capabilities.find((c) => c.label === a.label);
    access.push({ capability: a.label, family: 'ai_answers', adapter: cap ? cap.adapter : true, credential: cap ? cap.credential : null, attempted: a.asked > 0 && a.reason !== 'missing_credential' && a.reason !== 'no_adapter',
      reason: a.reason === 'ungrounded' ? 'partial' : a.reason,
      outcome: cap?.outcome ?? (a.reason === 'ungrounded' ? 'Answered from model memory without searching the web; not counted.'
        : a.reason === 'missing_credential' ? 'No credential is configured, so it was not asked.'
          : a.reason === 'no_adapter' ? 'No adapter is implemented for the provider’s grounded API, so it was not asked; the consumer app is not used.'
            : a.reason === 'request_failed' ? `Asked ${a.asked} questions; every request failed, so the result is unknown.`
              : `${a.answered} of ${a.asked} questions answered from live web search${a.answered < a.asked ? `; ${a.asked - a.answered} failed` : ''}.`),
      nextStep: cap?.nextStep ?? (a.reason === 'measured' ? null : a.reason === 'partial' ? 'Retry the questions that failed.'
        : a.reason === 'missing_credential' ? `Add an API key for ${a.label.replace(/ \(.*\)$/, '')}.`
          : a.reason === 'no_adapter' ? 'Implement an adapter for the provider’s grounded API (paid usage).'
            : a.reason === 'request_failed' ? 'Check the provider error (key, quota or billing) in the research register, then retry.' : 'Run it with live web search enabled.'), source: a.source });
  }
  if (aio) access.push({ capability: 'Google AI Overview', family: 'ai_answers', adapter: true, credential: null, attempted: true, reason: aio.retrieved === aio.total ? 'measured' : aio.retrieved ? 'partial' : 'request_failed',
    outcome: `${aio.retrieved} of ${aio.total} overviews retrieved; ${aio.failed} could not be retrieved.`, nextStep: aio.failed ? 'Retrieve the overview content immediately after each search (tokens expire).' : null, source: 'research' });
  if (fp) {
    for (const p of fp.profiles) {
      access.push({ capability: `${p.platform} profile`, family: 'social', adapter: true, credential: null, attempted: p.attempted,
        reason: p.state === 'identity_confirmed' || p.state === 'domain_linked' ? 'measured' : p.state === 'fetched' ? 'partial' : p.outcome === 'login_wall' ? 'restricted' : p.state === 'inaccessible' ? 'request_failed' : 'not_searched',
        outcome: `${p.declared ? 'Declared by the company' : 'Found on the website'}${p.onHomepage ? '; linked from the homepage' : '; not linked from the homepage'}${p.inSameAs ? '; in structured data' : ''}. ${p.reason ?? (p.state === 'identity_confirmed' ? 'Page names the brand and links to the website.' : 'Page links to the website.')}`,
        nextStep: p.outcome === 'login_wall' ? 'Confirm by hand while signed in, or add the website link to the profile.' : null, source: 'research' });
    }
    access.push({ capability: 'Independent mentions', family: 'mentions', adapter: true, credential: null, attempted: Boolean(fp.mentionSearch),
      reason: !fp.mentionSearch ? 'request_failed' : footprint!.mentions.confirmed ? 'measured' : 'searched_not_found',
      outcome: fp.mentionSearch ? `${footprint!.mentions.confirmed} third-party page(s) confirmed to mention the brand; ${footprint!.mentions.unconfirmed} reported but not confirmed.` : 'The mention search did not run.',
      nextStep: footprint!.mentions.confirmed ? null : 'Earn listings and mentions on directories, partner pages and comparison articles; re-check.', source: 'research' });
    access.push({ capability: 'Review and directory listings', family: 'reviews', adapter: true, credential: null, attempted: Boolean(fp.mentionSearch),
      reason: !fp.mentionSearch ? 'request_failed' : footprint!.reviews.listed ? 'measured' : footprint!.reviews.claimed ? 'partial' : 'searched_not_found',
      outcome: `${fp.platforms.map((p) => `${p.platform}: ${p.state === 'listed' ? 'listed' : p.state === 'claimed_unconfirmed' ? 'reported, page not confirmed' : 'not found in search'}`).join('; ')}.`,
      nextStep: footprint!.reviews.listed ? null : 'Create listings on the review sites buyers in this category use, then re-check.', source: 'research' });
  }
  const sig = (x: unknown) => ({ state: String(obj(obj(x)?.score)?.state ?? 'unavailable'), text: str(obj(obj(x)?.rationale)?.text) ?? '' });
  const backlinks = sig(payload.authority_inflow);
  access.push({ capability: 'Backlinks / referring domains', family: 'backlinks', adapter: true, credential: cfg('backlinks')?.credential ?? null,
    attempted: backlinks.state === 'measured' ? true : cfg('backlinks')?.credential === false ? false : null,
    reason: backlinks.state === 'measured' ? 'measured' : /not configured|no backlink/i.test(backlinks.text) || cfg('backlinks')?.credential === false ? 'missing_credential' : /failed/i.test(backlinks.text) ? 'request_failed' : 'not_searched',
    outcome: backlinks.state === 'measured' ? 'Measured by the report run.' : 'Not measured: no backlink source is connected. This says nothing about how many backlinks exist.',
    nextStep: backlinks.state === 'measured' ? null : 'Connect a backlink data source (an Ahrefs adapter is implemented), or read the Search Console Links report by hand.', source: 'report_run' });
  const kg = sig(payload.knowledge_graph);
  access.push({ capability: 'Knowledge graph (Wikidata)', family: 'knowledge_graph', adapter: true, credential: null, attempted: true,
    reason: kg.state === 'measured' ? 'measured' : /no wikidata entity was found|not found/i.test(kg.text) ? 'searched_not_found' : /failed/i.test(kg.text) ? 'request_failed' : 'partial',
    outcome: kg.text || 'See the brand section.', nextStep: kg.state === 'measured' ? null : 'Create a Wikidata entry; add Organization structured data. A missing entry alone does not prove weak authority.', source: 'report_run' });
  const perf = obj(r1?.performance);
  access.push({ capability: 'Page speed', family: 'page_speed', adapter: true, credential: cfg('page_speed')?.credential ?? null, attempted: perf?.state === 'measured',
    reason: perf?.state === 'measured' ? 'measured' : 'missing_credential', outcome: str(perf?.reasonUnavailable) ?? 'See the website section.',
    nextStep: perf?.state === 'measured' ? null : 'Enable PageSpeed Insights (free API key).', source: 'report_run' });

  const registry = families.find((f) => f.key === 'registry')!;
  access.push({ capability: registry.label, family: 'registry', adapter: false, credential: null, attempted: false, reason: 'no_adapter',
    outcome: registry.result, nextStep: registry.limitation, source: 'report_run' });

  // Paid advertising belongs to Report 2: it is not an evidence source of this organic report.
  const off = pack?.offering ?? null;
  if (pack) {
    const read = off ? off.pages.filter((p) => p.read).length : 0;
    access.push({ capability: 'Official website pages (offering check)', family: 'website', adapter: true, credential: null, attempted: Boolean(off),
      reason: !off ? 'not_searched' : read === off.pages.length && read ? 'measured' : read ? 'partial' : 'request_failed',
      outcome: off ? `${read} of ${off.pages.length} pages read (${off.pages.map((p) => p.purpose).join(', ')}); ${off.capabilities.filter((c) => c.state === 'website_verified' || c.state === 'independently_corroborated').length} of ${off.capabilities.length} declared capabilities stated on the site.` : 'The offering was not checked against the website in this run.',
      nextStep: off ? null : 'Read the product, pricing, FAQ and help pages and compare them with the profile.', source: 'research' });
    const site = pack.site ?? [];
    access.push({ capability: 'Crawl and entity basics (robots, llms, sitemap, structured data)', family: 'website', adapter: true, credential: null, attempted: site.length > 0,
      reason: !site.length ? 'not_searched' : site.some((r) => r.status === 'failed_source') ? 'partial' : 'measured',
      outcome: site.length ? `${site.filter((r) => r.status === 'observed').length} of ${site.length} checks fetched directly from the live site.` : 'Not checked.', nextStep: null, source: 'research' });
    const comps = pack.competitors;
    const profiled = comps.filter((c) => c.status === 'observed').length;
    access.push({ capability: 'Competitor profiling', family: 'competitors', adapter: true, credential: null, attempted: comps.length > 0,
      reason: !comps.length ? 'not_searched' : profiled === comps.length ? 'measured' : profiled ? 'partial' : 'request_failed',
      outcome: comps.length ? `${profiled} of ${comps.length} candidates profiled from their own sites; ${comps.filter((c) => ['direct', 'adjacent', 'strategic'].includes(String(c.classification))).length} validated as direct or adjacent.` : 'No competitor candidates in this run.',
      nextStep: comps.length ? null : 'Run competitor discovery from the validated offering.', source: 'research' });
  }

  const measured = access.filter((a) => a.reason === 'measured').length;
  const partial = access.filter((a) => a.reason === 'partial').length;
  return {
    crawl: { known, attempted, responded, read: outcomes ? outcomes.read : evaluated, evaluated, notAttempted: outcomes ? outcomes.notFetched : null,
      notObserved: known != null && responded != null ? known - responded : null, outcomes, byPurpose, lastCrawledIso: str(crawl?.lastCrawledAt), reused: crawl?.action === 'reused' },
    checks: { total: num(wc?.total), evaluated: num(wc?.evaluated) },
    search, ai, aiTotals, aio, footprint, families, identities, access,
    coverage: { measured, partial, notMeasured: access.length - measured - partial },
  };
}
