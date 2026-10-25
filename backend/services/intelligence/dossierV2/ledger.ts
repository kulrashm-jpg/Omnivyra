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
  family: 'website' | 'search' | 'ai_answers' | 'social' | 'mentions' | 'reviews' | 'backlinks' | 'knowledge_graph' | 'page_speed' | 'advertising';
  adapter: boolean | null;
  credential: boolean | null;
  attempted: boolean | null;
  reason: ReasonClass;
  outcome: string;
  nextStep: string | null;
  source: 'research' | 'report_run';
};

export type AiRow = {
  label: string;
  source: 'research' | 'report_run';
  reason: ReasonClass | 'ungrounded';
  asked: number;
  answered: number;
  buyerAnswers: number;
  buyerNamed: number;
  brandCorrect: number;
  brandConfused: number;
};

export type Ledger = {
  crawl: { known: number | null; attempted: null; responded: number | null; evaluated: number | null; notObserved: number | null; lastCrawledIso: string | null; reused: boolean };
  checks: { total: number | null; evaluated: number | null };
  search: { source: 'research' | 'report_run'; checked: number; found: number; brandedFound: number; geography: string | null; date: string | null } | null;
  ai: AiRow[];
  aiTotals: { buyerAnswers: number; buyerNamed: number; measured: string[]; notMeasured: string[] };
  aio: { total: number; retrieved: number; failed: number } | null;
  footprint: {
    profiles: { total: number; confirmed: number; domainLinked: number; fetched: number; inaccessible: number; declaredOnly: number };
    mentions: { confirmed: number; unconfirmed: number; searched: boolean };
    reviews: { checked: number; listed: number; claimed: number; notFound: number; searched: boolean };
  } | null;
  access: AccessRow[];
  coverage: { measured: number; partial: number; notMeasured: number };
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
  const known = num(crawl?.pagesAfter);
  const evaluated = num(wc?.pagesEvaluated) ?? num(obj(obj(r1?.digital_experience)?.coverage)?.pagesEvaluated);
  // The crawl records pages that answered; the attempt count is not stored, so "responded" is the
  // evaluated set and the remainder is NOT OBSERVED (not "failed").
  const responded = evaluated;

  // Search: research pack first, else the report run.
  const research = pack?.search.filter((r) => r.status === 'observed') ?? [];
  const sv = obj(r1?.search_visibility);
  const search: Ledger['search'] = research.length
    ? { source: 'research', checked: research.length, found: research.filter((r) => r.ownPosition != null).length,
      brandedFound: research.filter((r) => r.intent === 'branded' && r.ownPosition != null).length, geography: research[0]?.geography ?? null, date: research[0]?.observedAt?.slice(0, 10) ?? null }
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
    ai.push({ label: cap.label, source: 'research', reason: cap.reason, asked: rs.length, answered: ok.length,
      buyerAnswers: buyer.length, buyerNamed: buyer.filter((g) => g.mentioned).length,
      brandCorrect: brandQs.filter((g) => g.accuracy === 'correct').length, brandConfused: brandQs.filter((g) => g.accuracy === 'misidentified').length });
  }
  // Packs collected before the runtime snapshot existed: derive rows from the answers themselves.
  if (!researchCaps.length && pack) {
    for (const label of [...new Set(pack.generative.filter((g) => g.query && g.kind !== 'ai_overview').map((g) => String(g.surface)))]) {
      const rs = pack.generative.filter((g) => g.surface === label && g.query);
      const ok = rs.filter((g) => g.status === 'observed');
      const buyer = ok.filter((g) => !isBrandQuestion(g, brand));
      ai.push({ label, source: 'research', reason: ok.length === rs.length ? 'measured' : ok.length ? 'partial' : rs.every((g) => g.status === 'not_measured') ? 'missing_credential' : 'request_failed',
        asked: rs.length, answered: ok.length, buyerAnswers: buyer.length, buyerNamed: buyer.filter((g) => g.mentioned).length,
        brandCorrect: ok.filter((g) => g.accuracy === 'correct').length, brandConfused: ok.filter((g) => g.accuracy === 'misidentified').length });
    }
  }
  const cells = objs(obj(obj(payload.ai_surface_presence)?.citation_matrix)?.cells);
  for (const prov of [...new Set(cells.map((c) => String(c.provider)))]) {
    const label = PROVIDER_LABEL[prov] ?? prov;
    if (ai.some((a) => a.label === label)) continue; // newer research evidence already covers it
    const pc = cells.filter((c) => c.provider === prov);
    ai.push({ label, source: 'report_run', reason: runAiReason(pc), asked: pc.length, answered: pc.filter((c) => c.state === 'measured').length,
      buyerAnswers: 0, buyerNamed: 0, brandCorrect: 0, brandConfused: 0 });
  }
  const groundedRows = ai.filter((a) => a.reason === 'measured' || a.reason === 'partial');
  const aiTotals = {
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

  // ── Access reconciliation ──
  const access: AccessRow[] = [];
  const cfg = (id: string) => pack?.runtime?.capabilities.find((c) => c.id === id) ?? null;
  access.push({ capability: 'Website crawl', family: 'website', adapter: true, credential: null, attempted: known != null ? true : null,
    reason: evaluated ? (known && evaluated < known ? 'partial' : 'measured') : 'not_searched',
    outcome: known != null ? `${evaluated ?? 0} of ${known} known addresses read; ${known - (evaluated ?? 0)} not observed (attempt status not recorded).` : 'No crawl recorded.',
    nextStep: known && evaluated != null && evaluated < known ? 'Record attempts and status codes per URL on the next crawl.' : null, source: 'report_run' });
  access.push({ capability: 'Search results', family: 'search', adapter: true, credential: cfg('search:serp')?.credential ?? null, attempted: search ? true : null,
    reason: search ? 'measured' : cfg('search:serp')?.credential === false ? 'missing_credential' : 'not_searched',
    outcome: search ? `${search.checked} searches checked (${search.source === 'research' ? 'public research' : 'report run'}).` : 'No search observations.',
    nextStep: search ? null : 'Add a SerpAPI key.', source: search?.source ?? 'report_run' });
  for (const a of ai) {
    const cap = pack?.runtime?.capabilities.find((c) => c.label === a.label);
    access.push({ capability: a.label, family: 'ai_answers', adapter: cap ? cap.adapter : true, credential: cap ? cap.credential : null, attempted: a.asked > 0 && a.reason !== 'missing_credential' && a.reason !== 'no_adapter',
      reason: a.reason === 'ungrounded' ? 'partial' : a.reason,
      outcome: cap?.outcome ?? (a.reason === 'ungrounded' ? 'Answered from model memory without searching the web; not counted.' : a.reason === 'missing_credential' ? 'Not configured in the report run.' : a.reason === 'request_failed' ? 'Configured, but the request failed.' : `${a.answered} of ${a.asked} checks answered.`),
      nextStep: cap?.nextStep ?? (a.reason === 'measured' ? null : 'Run it with live web search enabled.'), source: a.source });
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

  const ads = obj(r1?.advertising);
  access.push({ capability: 'Advertising libraries', family: 'advertising', adapter: true, credential: null, attempted: ads ? true : null,
    reason: ads ? 'measured' : 'not_searched', outcome: ads ? 'An ad-library observation was recorded for this domain.' : 'No ad-library observation was made for this report; this says nothing about whether the company advertises.',
    nextStep: ads ? null : 'Run a public ad-library observation (Google Ads Transparency Center).', source: 'report_run' });

  const measured = access.filter((a) => a.reason === 'measured').length;
  const partial = access.filter((a) => a.reason === 'partial').length;
  return {
    crawl: { known, attempted: null, responded, evaluated, notObserved: known != null && responded != null ? known - responded : null, lastCrawledIso: str(crawl?.lastCrawledAt), reused: crawl?.action === 'reused' },
    checks: { total: num(wc?.total), evaluated: num(wc?.evaluated) },
    search, ai, aiTotals, aio, footprint, access,
    coverage: { measured, partial, notMeasured: access.length - measured - partial },
  };
}
