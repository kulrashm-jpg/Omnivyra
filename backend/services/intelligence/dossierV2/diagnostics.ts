/**
 * Dossier v2 — the diagnostic source matrix: for every evidence source, what was sought, what the
 * provider offers, what happened, why (only as far as the evidence shows), what it costs the report,
 * and the cheapest compliant way to close it.
 *
 * Provider capabilities and prices come from the CATALOGUE below, each with the official page it was
 * read from (checked 25 Oct 2026). Where the official page did not state a price or limit, the entry
 * says "not confirmed" and the cost category is `unknown` — never a guess. A cause is "confirmed" only
 * when a provider error message, a free check or a configuration inspection supports it.
 */
import type { Ledger } from './ledger';
import { isBrandQuestion, type ResearchPack } from './research';
import { classifyStoredReason, type ErrorClass } from '../publicResearch/providerErrors';
import type { ProviderCheck } from '../publicResearch/providerChecks';

export type DiagState =
  | 'measured' | 'partial' | 'not_attempted' | 'not_configured' | 'invalid_credential' | 'billing_blocked' | 'quota_exhausted'
  | 'rate_limited' | 'permission_denied' | 'login_restricted' | 'unsupported_capability' | 'provider_unavailable' | 'request_failed' | 'searched_not_found';

export const DIAG_LABEL: Record<DiagState, string> = {
  measured: 'Measured', partial: 'Partial', not_attempted: 'Not attempted', not_configured: 'Not configured', invalid_credential: 'Invalid credential',
  billing_blocked: 'Billing / entitlement blocked', quota_exhausted: 'Quota exhausted', rate_limited: 'Rate limited', permission_denied: 'Permission denied',
  login_restricted: 'Login / CAPTCHA restricted', unsupported_capability: 'Unsupported capability', provider_unavailable: 'Provider unavailable',
  request_failed: 'Request failed', searched_not_found: 'Searched, not found',
};

export type Cost = 'free' | 'existing entitlement' | 'paid usage' | 'unknown';
export type Need = 'credential' | 'permission' | 'deployment' | 'human verification' | 'paid entitlement';

export type SourceDiagnostic = {
  key: string;
  source: string;
  family: string;
  sought: string;
  capability: string;
  docUrl: string | null;
  integration: 'implemented' | 'partial' | 'absent' | 'broken';
  credential: 'absent' | 'present' | 'rejected' | 'not needed' | 'unverified';
  attempt: string;
  usable: boolean;
  state: DiagState;
  cause: string;
  causeConfirmed: boolean;
  impact: string;
  next: string;
  cost: Cost;
  needs: Need[];
  unlocks: string;
};

/** Official facts only (pages read 25 Oct 2026). `price` is verbatim-faithful or "not confirmed". */
export const CATALOGUE: Record<string, { capability: string; docUrl: string; price: string }> = {
  gemini: { capability: 'Gemini API with “Grounding with Google Search”; answers carry grounding sources. Free-tier grounding depends on the model (2.5 Flash: up to 500 requests/day; Gemini 3 and newer: not on the free tier).', docUrl: 'https://ai.google.dev/gemini-api/docs/pricing', price: 'Gemini 3+: 5,000 free search requests/month on a paid project, then $14 per 1,000; 2.5 Flash/Pro: 1,500/day free on paid tier, then $35 per 1,000 grounded prompts.' },
  serpapi: { capability: 'SerpAPI “google_ai_mode” and “bing_copilot” engines return the AI result and its references.', docUrl: 'https://serpapi.com/pricing', price: 'Free plan 250 searches/month; Starter $25/month for 1,000 searches (only successful searches count).' },
  perplexity: { capability: 'Perplexity Sonar API returns answers with a citations list and search results.', docUrl: 'https://docs.perplexity.ai/docs/sonar/models/sonar', price: 'Per-request fees plus per-token charges; exact Sonar figures not confirmed. No free API allowance confirmed; a consumer subscription is not required and is not confirmed to include API credit.' },
  meta: { capability: 'Meta Model API (dev.meta.ai) supports search grounding with url citations through the Responses and Messages APIs (not Chat Completions).', docUrl: 'https://dev.meta.ai/docs/search-grounding', price: '$2.50 per 1,000 search queries plus token cost (pay-as-you-go); no free tier confirmed.' },
  pagespeed: { capability: 'PageSpeed Insights API v5 measures a page (lab data); usable with or without an API key, a key recommended for automated use.', docUrl: 'https://developers.google.com/speed/docs/insights/v5/get-started', price: 'Not confirmed on the official page.' },
  gsc: { capability: 'Search Console API offers Search Analytics, Sitemaps, Sites and URL Inspection — no Links (backlinks) resource. The Links report is in the Search Console interface for verified owners.', docUrl: 'https://developers.google.com/webmaster-tools/v1/api_reference_index', price: 'No cost stated for Search Console.' },
  bing: { capability: 'Bing Webmaster API GetUrlLinks returns inbound links for a verified site.', docUrl: 'https://learn.microsoft.com/en-us/bingwebmaster/getting-access', price: 'Not confirmed on the official page.' },
  awt: { capability: 'Ahrefs Webmaster Tools: free backlink view for verified websites (up to 1,000 backlinks at once). The Ahrefs API is plan-gated (tier not confirmed).', docUrl: 'https://ahrefs.com/webmaster-tools', price: 'Free for verified sites; API on paid plans (tier not confirmed).' },
  mca: { capability: 'MCA Master Data Services: public view of a company’s master details by Company name or CIN; the form has a CAPTCHA.', docUrl: 'https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html', price: 'Free public service.' },
};

const fmt = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : 'time not recorded');

function fromError(cls: ErrorClass | 'ok' | 'not_checked'): DiagState {
  return cls === 'ok' ? 'measured' : cls === 'not_checked' ? 'not_attempted' : cls;
}

export function buildDiagnostics(ledger: Ledger, pack: ResearchPack | null): SourceDiagnostic[] {
  const rows: SourceDiagnostic[] = [];
  const checks = pack?.providerChecks ?? [];
  const disc = pack?.candidateDiscovery ?? null;
  const check = (provider: string, env?: ProviderCheck['environment']) => checks.find((c) => c.provider === provider && (!env || c.environment === env));
  const c = ledger.crawl;

  rows.push({ key: 'crawl', source: 'Website crawl', family: 'Website', sought: 'Every public page, its HTTP outcome and content, to judge readiness to be found and quoted.',
    capability: 'Own crawler (canonical_pages).', docUrl: null, integration: 'implemented', credential: 'not needed', usable: (c.read ?? 0) > 0,
    attempt: `Crawl ${fmt(c.lastCrawledIso)}: ${c.attempted ?? '?'} of ${c.known ?? '?'} addresses fetched, ${c.read ?? '?'} read.`,
    state: c.outcomes && c.outcomes.read === c.attempted ? 'measured' : 'partial', cause: c.notAttempted ? `${c.notAttempted} addresses are known only from site analytics and were never fetched.` : 'All known addresses were fetched.', causeConfirmed: true,
    impact: 'Page findings describe the pages read; signed-in app screens are out of scope.', next: 'None needed for the public site.', cost: 'free', needs: [], unlocks: '—' });

  const off = pack?.offering;
  if (off) rows.push({ key: 'offering', source: 'Official website pages (offering)', family: 'Website', sought: 'What the company says it sells, to whom, and at what price — the basis for the market and competitor set.',
    capability: 'Direct page fetches of the pages the homepage links to.', docUrl: null, integration: 'implemented', credential: 'not needed', usable: off.pages.some((p) => p.read),
    attempt: `${fmt(off.checkedAt)}: ${off.pages.filter((p) => p.read).length} of ${off.pages.length} pages read (${off.pages.map((p) => p.purpose).join(', ')}).`,
    state: off.pages.every((p) => p.read) ? 'measured' : 'partial', cause: 'Read directly.', causeConfirmed: true,
    impact: pack?.register?.missing.length ? `Not stated on the site: ${pack.register.missing.join(', ')}; conclusions that need them stay provisional.` : 'Offering established from the site.',
    next: pack?.register?.missing.includes('geography') ? 'State the markets served on the website (e.g. an About or pricing note).' : 'None.', cost: 'free', needs: [], unlocks: 'A market and competitor set grounded in the site.' });

  // Search: stored observations vs new runs.
  const serp = check('SerpAPI', 'local');
  const serpProd = check('SerpAPI', 'production');
  rows.push({ key: 'search', source: 'Google search results (SerpAPI)', family: 'Search', sought: 'Where the site ranks for buyer-intent searches.',
    capability: 'SerpAPI Google engine (organic results).', docUrl: CATALOGUE.serpapi.docUrl, integration: 'implemented', credential: serp?.credential === 'present' ? 'present' : 'unverified',
    usable: Boolean(ledger.search), attempt: `${ledger.search ? `${ledger.search.checked} stored observations of ${ledger.search.date ?? '—'} used` : 'No observations'}; free account check ${fmt(serp?.at)}: ${serp?.detail ?? 'not run'}`,
    state: ledger.search?.source === 'research' ? 'partial' : ledger.search ? 'partial' : 'not_attempted',
    cause: serp?.outcome === 'quota_exhausted' ? 'The plan has no searches left this period (SerpAPI account endpoint), so no new search was run; stored results of the day before were used.' : 'Search ran in the report run with generic category queries.',
    causeConfirmed: serp?.outcome === 'quota_exhausted',
    impact: `Search visibility rests on ${(pack?.search ?? []).filter((r) => r.status === 'observed' && !isBrandQuestion(r, pack!.subject.brand)).length || 'no'} buyer searches from one day (plus ${ledger.search?.source === 'report_run' ? 'the run’s generic queries' : 'brand-name searches'}): a small sample, not market-wide.`, next: 'Wait for the monthly reset, then run the proposed buyer-intent queries; or upgrade the plan.',
    cost: serp?.outcome === 'quota_exhausted' ? 'paid usage' : 'existing entitlement', needs: serp?.outcome === 'quota_exhausted' ? ['paid entitlement'] : [], unlocks: `A buyer-intent sample from the validated offering (${CATALOGUE.serpapi.price})` });

  // AI tools.
  const ai = (label: string) => ledger.ai.find((a) => a.label === label);
  const firstError = (label: string) => {
    const r = pack?.generative.find((g) => g.surface === label && g.status === 'failed_source');
    if (!r) return null;
    const e = r.providerError;
    return e ? { cls: e.errorClass as ErrorClass, confirmed: e.causeConfirmed, msg: e.message, status: e.httpStatus } : (() => { const s = classifyStoredReason(r.claim.replace(/^[^:]+:\s*/, '')); return { cls: s.errorClass, confirmed: s.causeConfirmed, msg: s.evidence.message, status: s.evidence.httpStatus }; })();
  };
  const aiRow = (key: string, label: string, sought: string, cat: keyof typeof CATALOGUE | null, extra: Partial<SourceDiagnostic>) => {
    const a = ai(label);
    if (!a) return;
    const err = firstError(label);
    const measured = a.state === 'measured_grounded';
    rows.push({ key, source: label, family: 'AI answers', sought, capability: cat ? CATALOGUE[cat].capability : 'Provider API with live web search.', docUrl: cat ? CATALOGUE[cat].docUrl : null,
      integration: 'implemented', credential: a.state === 'not_configured' ? 'absent' : err?.cls === 'invalid_credential' ? 'rejected' : 'present', usable: measured,
      attempt: `${a.asked} questions, ${a.answered} grounded answers${err ? `; first failure: HTTP ${err.status ?? '—'} “${err.msg.slice(0, 120)}”` : ''}.`,
      state: measured ? (a.answered < a.asked ? 'partial' : 'measured') : err ? err.cls : a.state === 'not_configured' ? 'not_configured' : 'not_attempted',
      cause: measured ? (a.answered < a.asked ? `${a.asked - a.answered} answers were not counted (no web search or no checkable source).` : '—') : err ? `Provider message: “${err.msg.slice(0, 160)}”.` : 'No credential is configured.',
      causeConfirmed: measured || (err ? err.confirmed : true),
      impact: measured ? 'Counted in the AI-answer sample.' : 'Visibility in this tool is unknown — not zero.', next: '—', cost: 'unknown', needs: [], unlocks: `Grounded answers from ${label.replace(/ \(.*\)$/, '')}`, ...extra });
  };
  aiRow('chatgpt', 'ChatGPT search', 'Grounded answers to buyer questions (OpenAI API with web search — not the ChatGPT app).', null, { next: 'None; answers without sources are excluded by rule.', cost: 'existing entitlement', capability: 'OpenAI Responses API with the web search tool.' });
  aiRow('claude', 'Claude (web search)', 'Grounded answers to buyer questions (Anthropic API with web search — not the Claude app).', null, { next: 'Retry the 3 questions answered without a search.', cost: 'existing entitlement', capability: 'Anthropic Messages API with the web search tool.' });
  const gem = check('Gemini', 'local');
  aiRow('gemini', 'Gemini (Google Search grounding)', 'Grounded answers via Google Search grounding.', 'gemini', {
    cause: 'The provider answered HTTP 429 “You exceeded your current quota, please check your plan and billing details” to every grounded request. Which quota (free-tier limit, grounding allowance or billing) is not named in the recorded message — cause unconfirmed.',
    causeConfirmed: false,
    attempt: `8 grounded requests, all HTTP 429 (report run). Free metadata check ${fmt(gem?.at)} (${gem?.environment ?? '—'}): ${gem?.detail ?? 'not run'}`,
    next: 'Next diagnostic (no cost): the collector now records the quota metric in the error; read the project’s quota and billing page in Google AI Studio. Possible no-cost route, unverified: a Gemini 2.5 Flash model, whose free tier lists grounding (up to 500 requests/day); confirm billing is off before testing.',
    cost: 'unknown', needs: ['human verification', 'deployment'], unlocks: `Grounded Gemini answers (${CATALOGUE.gemini.price})` });
  for (const [key, label] of [['ai_mode', 'Google AI Mode'], ['copilot', 'Bing Copilot']] as const) {
    aiRow(key, label, `The ${label} answer for each buyer question, with its references.`, 'serpapi', {
      cause: `SerpAPI answered “Invalid API key” to the key the deployed research step read. ${serpProd?.detail ?? ''}`.trim(), causeConfirmed: Boolean(serpProd),
      next: 'Deploy the credential fix on this branch (research resolves the managed credential the report run uses); then the plan quota applies: 0 searches left this period, so it needs the monthly reset or a paid plan.',
      cost: 'paid usage', needs: ['deployment', 'paid entitlement'], unlocks: `${label} answers (${CATALOGUE.serpapi.price})` });
  }
  aiRow('perplexity', 'Perplexity', 'Grounded Perplexity answers with citations.', 'perplexity', { integration: 'implemented', next: 'Add a Perplexity API key (API access is sold separately from the consumer subscription).', cost: 'paid usage', needs: ['credential', 'paid entitlement'], unlocks: `Perplexity answers (${CATALOGUE.perplexity.price})` });
  aiRow('meta', 'Meta AI', 'Grounded answers from Meta’s model with web search.', 'meta', { integration: 'absent', credential: 'absent', state: 'not_attempted',
    cause: 'No adapter is implemented for the Meta Model API’s search grounding; the consumer Meta AI app requires a signed-in account and is not used.', causeConfirmed: true,
    next: 'Implement an adapter for the Meta Model API (Responses API with search grounding); API answers are not the consumer app.', cost: 'paid usage', needs: ['credential', 'paid entitlement', 'deployment'], unlocks: `Meta answers (${CATALOGUE.meta.price})` });

  // Footprint families.
  for (const f of ledger.families) {
    const restricted = f.key === 'registry';
    rows.push({ key: `family:${f.key}`, source: f.label, family: 'External footprint', sought: f.key === 'inbound_links' ? 'Other websites linking to the domain (backlink authority).' : `Evidence for: ${f.label.toLowerCase()}.`,
      capability: f.key === 'inbound_links' ? `${CATALOGUE.gsc.capability} ${CATALOGUE.awt.capability}` : f.key === 'registry' ? CATALOGUE.mca.capability : f.source,
      docUrl: f.key === 'inbound_links' ? CATALOGUE.gsc.docUrl : f.key === 'registry' ? CATALOGUE.mca.docUrl : null,
      integration: f.key === 'inbound_links' ? 'partial' : f.key === 'registry' ? 'absent' : 'implemented', credential: f.key === 'inbound_links' ? 'absent' : 'not needed', usable: f.state === 'found',
      attempt: f.attempted ? `${f.source}${f.checkedAt ? ` · ${fmt(f.checkedAt)}` : ''}: ${f.result}` : 'Not attempted.',
      state: f.state === 'found' ? 'measured' : f.state === 'searched_not_found' ? 'searched_not_found' : restricted ? 'login_restricted' : f.state === 'inaccessible' ? 'permission_denied' : f.key === 'inbound_links' ? 'not_configured' : 'not_attempted',
      cause: f.key === 'inbound_links' ? 'No backlink data source is connected (an Ahrefs adapter exists; no key). The Search Console API has no Links resource.' : restricted ? 'The MCA search is an interactive form with a CAPTCHA; the website states no registered company name or CIN to look up.' : f.limitation,
      causeConfirmed: true,
      impact: f.key === 'inbound_links' ? 'Backlink authority not measured — unknown, not zero.' : f.state === 'searched_not_found' ? 'Not found by that search; not proof of absence.' : f.state === 'found' ? 'Counted.' : 'Unknown.',
      next: f.key === 'inbound_links' ? 'Verify the site in Ahrefs Webmaster Tools (free) or export the Links report from Search Console; Bing Webmaster API (GetUrlLinks) after verification.' : restricted ? 'Ask the company for its CIN (or exact registered name), then look it up by hand on MCA Master Data.' : f.state === 'searched_not_found' ? 'Create the listings or earn the mentions, then re-check.' : '—',
      cost: 'free', needs: f.key === 'inbound_links' ? ['permission', 'human verification'] : restricted ? ['human verification'] : [], unlocks: f.key === 'inbound_links' ? 'Linking domains and top linked pages' : restricted ? 'Registered name, status and incorporation date' : '—' });
  }

  // PageSpeed.
  const psi = check('PageSpeed Insights', 'local');
  rows.push({ key: 'pagespeed', source: 'Page speed (PageSpeed Insights)', family: 'Website', sought: 'Lab performance of the homepage (loading, layout shift, blocking time).',
    capability: CATALOGUE.pagespeed.capability, docUrl: CATALOGUE.pagespeed.docUrl, integration: 'implemented', credential: psi?.credential === 'present' ? 'present' : 'not needed', usable: psi?.outcome === 'ok',
    attempt: psi ? `${fmt(psi.at)} (${psi.environment}): ${psi.operation} → HTTP ${psi.httpStatus ?? '—'}. ${psi.detail}` : 'Not attempted (the report run has PageSpeed disabled).',
    state: psi ? fromError(psi.outcome) : 'not_configured', cause: psi?.outcome === 'ok' ? 'Measured keyless.' : psi ? `${psi.detail}${psi.causeConfirmed ? '' : ' Cause unconfirmed (keyless requests share a quota).'}` : 'PageSpeed is not enabled in the report run.',
    causeConfirmed: psi ? psi.causeConfirmed : true, impact: psi?.outcome === 'ok' ? 'Counted.' : 'Page speed not measured.', next: 'Create a PageSpeed Insights API key and enable it for the report run.',
    cost: 'unknown', needs: ['credential', 'deployment'], unlocks: 'Performance score and Core Web Vitals lab values' });

  // Competitor discovery.
  const cands = pack?.candidates ?? [];
  if (cands.length) {
    rows.push({ key: 'competitors', source: 'Competitor discovery and validation', family: 'Market', sought: 'Companies selling the same thing to the same buyers, confirmed on their own pages.',
      capability: 'Candidates from this report’s evidence; each read on its own site.', docUrl: null, integration: 'implemented', credential: 'not needed', usable: cands.some((x) => ['direct', 'adjacent', 'substitute'].includes(x.classification)),
      attempt: `${disc ? `${disc.found} candidates found, ${disc.checked} checked` : `${cands.length} checked`} on ${fmt(cands[0]?.checkedAt)}.`,
      state: disc && disc.checked < disc.found ? 'partial' : 'measured', cause: disc && disc.checked < disc.found ? `${disc.found - disc.checked} lower-evidence candidates were not checked.` : '—', causeConfirmed: true,
      impact: 'Classification is rule-based from each company’s own pages; it is not an analyst’s review.', next: 'Have an analyst review the direct and substitute classifications.', cost: 'free', needs: ['human verification'], unlocks: 'A reviewed competitor set' });
  }
  return rows;
}
