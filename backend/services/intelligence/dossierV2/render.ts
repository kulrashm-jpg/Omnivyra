/**
 * Dossier v2 — report renderer.
 *
 *   Cover
 *   Summary 1 of 2 — What is happening        (one page, plain English)
 *   Summary 2 of 2 — What to do next          (one page, plain English)
 *   1 Market & competitors · 2 Website & content · 3 Brand, entity & trust
 *   4 Search & AI visibility · 5 Priorities & roadmap · 6 Evidence appendix
 *
 * Written for two readers at once: a leader new to marketing (the two summary pages, every finding
 * with a plain-English meaning, jargon defined) and a specialist (every claim traceable to a source,
 * date, scope and status). Reads the same CanonicalExportPayload as v1, plus an optional public-
 * research evidence pack. Every recommendation comes from the registry (one id per action). Every
 * value is read from the payload or the pack; where a producer abstained the report says so.
 *
 * Three kinds of visibility are never collapsed into one: what search engines returned, what
 * retrieval-grounded AI search surfaced and cited, and how ready the site itself is. A model's memory
 * of a brand is not visibility evidence and is never counted as such.
 */
import type { CanonicalExportPayload } from '../canonicalExport';
import { escape } from '../exportRendererCore';
import {
  PALETTE, barChart, entityGraph, evidenceArchitecture, funnel, heatLegend, heatmap, impactEffortMatrix, pill,
  roadmap, scoreColor, stackedRows,
  type BarRow, type FunnelStage, type GraphNode, type HeatCell, type MatrixPoint, type RoadmapItem,
} from './charts';
import { buildDossierRegistry, type DossierAction, type DossierFinding, type DossierRegistry } from './registry';
import { isBrandQuestion, isMarketingBasic, parseResearchPack, summariseVisibility, type ResearchPack, type ResearchRecord } from './research';
import { DOSSIER_V2_CSS } from './styles';
import { buildLedger, PROVIDER_LABEL, type AccessRow, type Ledger } from './ledger';
import { validateReport, type ValidationResult } from './validate';

export type DossierV2Branding = {
  brandName?: string | null;
  domain?: string | null;
  logoUrl?: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objs = (v: unknown): Obj[] => arr(v).map(obj).filter((o): o is Obj => Boolean(o));
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const e = (v: unknown): string => escape(String(v ?? ''));
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const fmtDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
/** Whole calendar days (UTC) from `iso` to `ref`; an observation after the report reads as 0. */
const ageDays = (iso: string | null | undefined, ref: string): number | null => {
  if (!iso) return null;
  const day = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? NaN : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const a = day(iso);
  const b = day(ref);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, Math.round((b - a) / 86_400_000));
};

/** Proper names for providers, platforms and teams that arrive as lower-case keys. */
const PROPER: Record<string, string> = {
  chatgpt: 'ChatGPT', openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity', copilot: 'Copilot',
  linkedin: 'LinkedIn', youtube: 'YouTube', x: 'X', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', github: 'GitHub',
  pr: 'PR', seo: 'SEO', marketing_ops: 'Marketing operations',
};
const proper = (k: string): string => PROPER[k.toLowerCase()] ?? cap(k.replace(/_/g, ' '));

const PILLAR_NAME: Record<string, string> = {
  foundation: 'Foundation', authority: 'Authority', discoverability: 'Discoverability', trust: 'Trust', momentum: 'Momentum',
};
const pillarName = (p: string | null | undefined): string => (p ? PILLAR_NAME[p] ?? p : '—');

type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'info';

/**
 * ONE evidence-state vocabulary for every pill in the report (the brief's six states, plus the
 * report's own measured/insufficient labels). Colour reinforces; the text always says the state.
 */
const stateLabel = (state: string | null | undefined): { text: string; tone: Tone } => {
  switch (state) {
    case 'measured': case 'observed': return { text: 'Measured', tone: 'good' };
    case 'independently_corroborated': return { text: 'Independently confirmed', tone: 'good' };
    case 'declared': case 'company_declared': return { text: 'Company-declared', tone: 'info' };
    case 'inferred': return { text: 'Inferred', tone: 'info' };
    case 'not_found': case 'looked_for_not_found': return { text: 'Looked for, not found', tone: 'neutral' };
    case 'not_measured': return { text: 'Not measured', tone: 'neutral' };
    case 'failed': case 'failed_source': return { text: 'Source failed', tone: 'bad' };
    case 'insufficient_signal': case 'insufficient_evidence': return { text: 'Insufficient evidence', tone: 'warn' };
    default: return { text: 'Unavailable', tone: 'warn' };
  }
};

/**
 * A provider that was configured and failed is its own state. Its slot may still carry a value
 * inferred from on-site evidence, but the source itself did not answer, and the reader must see that.
 */
const sourceState = (score: Obj | null, rationale: string | null): string =>
  (/failed to load|is not a constructor/i.test(rationale ?? '') ? 'failed'
    : /no wikidata entity was found|not found/i.test(rationale ?? '') && score?.state !== 'measured' ? 'not_found'
      : String(score?.state ?? 'unavailable'));

function section(n: number, title: string, question: string, plain: string, body: string): string {
  return `<section class="v2-section" id="s${n}">
  <header class="v2-section-head"><span class="v2-section-num">${n}</span><div><h2>${e(title)}</h2><p>${e(question)}</p></div></header>
  <div class="v2-plain"><strong>In plain English:</strong> ${e(plain)}</div>
  ${body}
</section>`;
}

const block = (title: string, sub: string | null, body: string, extraClass = ''): string =>
  `<div class="v2-block ${extraClass}"><h3>${e(title)}</h3>${sub ? `<p class="v2-sub">${e(sub)}</p>` : ''}${body}</div>`;

const swatchLegend = (items: Array<[string, string]>): string =>
  `<div class="v2-legend">${items.map(([c, l]) => `<span><i style="background:${c};border-color:${c}"></i>${e(l)}</span>`).join('')}</div>`;

const evRef = (ids: string[]): string => (ids.length ? `<span class="v2-id">${ids.map(e).join(' · ')}</span>` : '');

// ── Derived context ─────────────────────────────────────────────────────────

type SourceRow = { key: string; label: string; meaning: string; status: 'connected' | 'partial' | 'missing'; feeds: string };

type Context = {
  payload: CanonicalExportPayload;
  registry: DossierRegistry;
  research: ResearchPack | null;
  brand: string;
  domain: string;
  generated: string;
  generatedIso: string;
  crawl: { known: number | null; read: number | null; unread: number | null; lastCrawled: string | null; lastCrawledIso: string | null; reused: boolean };
  pillars: Array<{ key: string; label: string; value: number | null; state: string; dims: Array<{ key: string; label: string; value: number | null; state: string }> }>;
  sources: SourceRow[];
  ledger: Ledger;
};

/**
 * The six evidence sources, with the SAME rule the report's readiness uses
 * (reportEvidenceReadiness.sourceStatus): connected = the dimension it feeds was measured;
 * partial = inferred; missing = no value.
 */
function evidenceSources(pillars: Context['pillars'], competitorCount: number): SourceRow[] {
  const dim = new Map(pillars.flatMap((p) => p.dims).map((d) => [d.key, d]));
  const status = (key: string): SourceRow['status'] => {
    const d = dim.get(key);
    if (!d) return 'missing';
    if (d.state === 'measured' && d.value != null) return 'connected';
    if (d.state === 'inferred') return 'partial';
    return 'missing';
  };
  return [
    { key: 'crawl', label: 'Website crawl', meaning: 'pages fetched and checked', status: status('index_integrity'), feeds: 'Index Integrity' },
    { key: 'content', label: 'Content & structure', meaning: 'how readable pages are for engines', status: status('extraction_readiness'), feeds: 'Extraction Readiness' },
    { key: 'backlink', label: 'Backlinks', meaning: 'other sites linking to yours', status: status('authority_inflow'), feeds: 'Authority Inflow' },
    { key: 'ai', label: 'AI answers', meaning: 'what retrieval-grounded AI search says about you', status: status('ai_surface_presence'), feeds: 'AI Surface Presence' },
    { key: 'competitor', label: 'Competitors', meaning: 'a validated set of rivals', status: competitorCount > 0 ? 'connected' : 'missing', feeds: 'competitive comparison' },
    { key: 'trust', label: 'Reviews & reputation', meaning: 'independent reviews and ratings', status: status('trust_coherence'), feeds: 'Trust Coherence' },
  ];
}

function buildContext(payload: CanonicalExportPayload, branding: DossierV2Branding, research: ResearchPack | null): Context {
  const r1 = payload.report1;
  const crawl = obj(obj(r1?.evidence_acquisition)?.crawl);
  const wc = obj(r1?.website_checks);
  const known = num(crawl?.pagesAfter);
  const read = num(wc?.pagesEvaluated) ?? num(obj(obj(r1?.digital_experience)?.coverage)?.pagesEvaluated);
  const pillars = objs(payload.pillars).map((p) => {
    const score = obj(p.score) ?? {};
    return {
      key: String(p.pillar ?? ''),
      label: str(p.label) ?? pillarName(String(p.pillar ?? '')),
      value: num(score.value),
      state: String(score.state ?? 'unavailable'),
      dims: objs(p.dimensions).map((dim) => {
        const s = obj(dim.score) ?? {};
        return { key: String(dim.key ?? ''), label: str(dim.label) ?? String(dim.key ?? ''), value: num(s.value), state: String(s.state ?? 'unavailable') };
      }),
    };
  });
  const ct = obj(r1?.competitive_tables);
  const summary = obj(ct?.summary) ?? {};
  const competitorCount = ['direct', 'adjacent', 'substitute', 'strategic'].reduce((n, k) => n + (num(summary[k]) ?? 0), 0);
  const lastIso = str(crawl?.lastCrawledAt);
  return {
    payload,
    registry: buildDossierRegistry(payload, research),
    research,
    brand: branding.brandName ?? branding.domain ?? 'Company',
    domain: branding.domain ?? '',
    generated: fmtDate(payload.generated_at) ?? '',
    generatedIso: payload.generated_at,
    crawl: { known, read, unread: known != null && read != null ? Math.max(0, known - read) : null, lastCrawled: fmtDate(lastIso), lastCrawledIso: lastIso, reused: crawl?.action === 'reused' },
    pillars,
    sources: evidenceSources(pillars, competitorCount),
    ledger: buildLedger(payload, research),
  };
}

function pillarTag(p: Context['pillars'][number]): string {
  if (p.value == null) return 'insufficient evidence';
  const measuredDims = p.dims.filter((d) => d.value != null).length;
  const label = p.state === 'measured' ? 'measured' : 'inferred';
  const scope = p.key === 'discoverability' ? ' · on-site readiness, not rankings' : '';
  return `${label} · ${measuredDims} of ${p.dims.length} dimensions${scope}`;
}

const pillarOf = (ctx: Context, key: string) => ctx.pillars.find((p) => p.key === key);
const scored = (ctx: Context) => ctx.pillars.filter((p) => p.value != null);

/** Search visibility from the best available source: the research pack, else the report's own run. */
function searchView(ctx: Context): { found: number; checked: number; line: string; source: string } | null {
  const v = summariseVisibility(ctx.research).search;
  if (v && v.checked) {
    return {
      found: v.found, checked: v.checked,
      line: `Found for ${v.found} of ${v.checked} buyer searches${v.brandedFound ? ` — ${v.brandedFound === v.found ? 'only' : 'including'} brand-name searches` : ''}`,
      source: `Google, ${v.geography ?? 'geography unrecorded'}, ${fmtDate(v.date) ?? ''} · public research`,
    };
  }
  const sv = obj(ctx.payload.report1?.search_visibility);
  const run = num(sv?.queriesRun);
  if (!run) return null;
  const ranked = num(sv?.queriesRanked) ?? 0;
  return { found: ranked, checked: run, line: `Found for ${ranked} of ${run} searches checked`, source: `${str(sv?.provider) ?? 'search'} · ${fmtDate(str(sv?.observedAt)) ?? ''} · report run` };
}

/** Generative-search visibility: counts only retrieval-grounded observations. */
function generativeView(ctx: Context): { grounded: number; mentioned: number; line: string; note: string } {
  const g = summariseVisibility(ctx.research).generative;
  const cm = obj(obj(ctx.payload.ai_surface_presence)?.citation_matrix);
  const measuredCells = num(obj(cm?.coverage)?.measured_cells) ?? 0;
  const recallCells = objs(cm?.cells).filter((c) => /not retrieval-grounded|model recall/i.test(String(c.reason_unavailable ?? ''))).length;
  const grounded = (g?.grounded ?? 0) + measuredCells;
  const mentioned = g?.mentioned ?? 0;
  const parts: string[] = [];
  if (g?.buyerAnswers) {
    if (g.brandAnswers) parts.push(`asked by name: correct in ${g.brandCorrect} of ${g.brandAnswers}, confused in ${g.brandMisidentified}`);
    if (g.notMeasuredSurfaces.length) parts.push(`${g.notMeasuredSurfaces.join(', ')} not measured`);
    return { grounded, mentioned: g.buyerNamed, line: `Named in ${g.buyerNamed} of ${g.buyerAnswers} AI answers to buyer questions`, note: `${g.surfaces.join(', ')} · ${parts.join(' · ')}` };
  }
  const line = grounded
    ? `Mentioned in ${mentioned} of ${grounded} grounded AI answer${grounded === 1 ? '' : 's'} read`
    : 'Not measured — no grounded AI answer was read';
  if (g?.failed) parts.push(`${g.failed} AI Overview${g.failed === 1 ? '' : 's'} could not be retrieved`);
  if (recallCells) parts.push(`${recallCells} answer${recallCells === 1 ? '' : 's'} from model memory excluded`);
  if (g?.notMeasuredSurfaces.length) parts.push(`${g.notMeasuredSurfaces.join(', ')} not measured`);
  return { grounded, mentioned, line, note: parts.join(' · ') };
}

// ── Cover ───────────────────────────────────────────────────────────────────

function renderCover(ctx: Context, branding: DossierV2Branding): string {
  const index = num(obj(obj(ctx.payload.authority_overview)?.overall_score)?.value);
  const stage = str(obj(ctx.payload.maturity_stage)?.label);
  const connected = ctx.sources.filter((s) => s.status === 'connected').length;
  return `<section class="v2-cover">
  <div class="v2-cover-brand">${branding.logoUrl ? `<img src="${e(branding.logoUrl)}" alt="${e(ctx.brand)}" onerror="this.style.display='none'"/>` : ''}<span class="v2-cover-eyebrow">${e(ctx.domain)} · Digital intelligence dossier</span></div>
  <h1>${e(ctx.brand)}: how it shows up in public search, and what to do first</h1>
  <p class="v2-cover-thesis">Three kinds of visibility, measured separately: what search engines return for buyer searches, what AI search tools retrieve and cite, and how ready the website itself is. Pages 2 and 3 summarise it in plain English.</p>
  <div class="v2-cover-tags"><span>Brand presence</span><span>Discoverability</span><span>Trust &amp; proof</span></div>
  <div class="v2-cover-meta">
    <div>Authority Index<strong>${index ?? '—'} / 100</strong></div>
    <div>Stage<strong>${e(stage ?? '—')}</strong></div>
    <div>Evidence sources measured<strong>${ctx.ledger.coverage.measured} of ${ctx.ledger.access.length}</strong>${ctx.ledger.coverage.partial ? `<em>${ctx.ledger.coverage.partial} partly</em>` : ''}</div>
    <div>Generated<strong>${e(ctx.generated)}</strong>${ctx.research ? `<em>Public research ${e(fmtDate(ctx.research.collectedAt) ?? ctx.research.collectedAt)}</em>` : ''}</div>
  </div>
</section>`;
}

// ── Summary page 1 — What is happening? ─────────────────────────────────────

const REASON_TEXT: Record<string, string> = {
  measured: 'measured', partial: 'partly measured', not_searched: 'not attempted', restricted: 'blocked by sign-in or bot protection',
  no_adapter: 'no supported access', missing_credential: 'not connected', request_failed: 'request failed', quota_restricted: 'plan or quota limit',
  searched_not_found: 'searched, not found', ungrounded: 'answered from memory only',
};

/** Two-word states for tight lists. */
const SHORT_REASON: Record<string, string> = {
  measured: 'measured', partial: 'partial', not_searched: 'not run', restricted: 'blocked', no_adapter: 'no access',
  missing_credential: 'not connected', request_failed: 'failed', quota_restricted: 'quota limit', searched_not_found: 'not found', ungrounded: 'memory only',
};

/** Confidence from how much of the evidence was actually measured. */
function confidenceOf(l: Ledger): { level: 'Low' | 'Moderate' | 'High'; note: string } {
  const total = l.access.length || 1;
  const share = (l.coverage.measured + l.coverage.partial / 2) / total;
  return { level: share >= 0.7 ? 'High' : share >= 0.4 ? 'Moderate' : 'Low', note: `${l.coverage.measured} of ${l.access.length} evidence sources measured, ${l.coverage.partial} partly` };
}

/** The one-sentence situation, chosen from the evidence. */
function headlineOf(ctx: Context): string {
  const l = ctx.ledger;
  const searchMiss = l.search ? l.search.found - l.search.brandedFound === 0 : null;
  const aiMiss = l.aiTotals.buyerAnswers ? l.aiTotals.buyerNamed === 0 : null;
  if (searchMiss && aiMiss) return `Buyers who search for what ${ctx.brand} sells — rather than its name — do not find it yet, in search or in AI answers.`;
  if (aiMiss) return `AI answers to buyers' questions do not name ${ctx.brand} yet; other tools are recommended instead.`;
  if (searchMiss) return `Buyers searching for the problem ${ctx.brand} solves do not find it in the results checked.`;
  return `${ctx.brand} is visible for some buyer questions; the gaps below show where it is not.`;
}

function renderSummaryNow(ctx: Context): string {
  const l = ctx.ledger;
  const conf = confidenceOf(l);
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  const tile = (title: string, value: string, sub: string, tone: Tone, extra = '') =>
    `<div class="v2-ind v2-ind-${tone}"><div class="v2-ind-title">${e(title)}</div><div class="v2-ind-value">${value}</div><div class="v2-ind-sub">${e(sub)}</div>${extra}</div>`;
  const nm = '<span class="v2-nm">Not measured</span>';

  const s = l.search;
  const buyerSearches = s ? s.checked - (s.source === 'research' ? (ctx.research?.search.filter((r) => r.status === 'observed' && r.intent === 'branded').length ?? 0) : 0) : 0;
  const searchTile = s
    ? tile('Search', `${s.found - s.brandedFound}<small> of ${buyerSearches}</small>`,
      s.source === 'research'
        ? `buyer searches that returned the website${s.brandedFound ? '; found when the name is searched' : ''}`
        : 'category searches by the report run that returned the website (location and language not recorded)',
      s.found - s.brandedFound === 0 ? 'bad' : 'warn')
    : tile('Search', nm, 'No search results were observed in this run.', 'neutral');
  const aiList = l.ai.filter((a) => a.source === 'research' || a.reason !== 'missing_credential').slice(0, 7)
    .map((a) => `<li><span>${e(a.label.replace(/ \(.*\)$/, ''))}</span><b>${a.reason === 'measured' || a.reason === 'partial' ? `${a.buyerNamed}/${a.buyerAnswers}` : e(SHORT_REASON[a.reason] ?? a.reason)}</b></li>`).join('');
  const aiTile = l.aiTotals.buyerAnswers
    ? tile('AI answers', `${l.aiTotals.buyerNamed}<small> of ${l.aiTotals.buyerAnswers}</small>`, 'answers to buyer questions that name the company', l.aiTotals.buyerNamed ? 'warn' : 'bad', `<ul class="v2-ind-list">${aiList}</ul>`)
    : tile('AI answers', nm, 'No AI answer built from live web search was read.', 'neutral', aiList ? `<ul class="v2-ind-list">${aiList}</ul>` : '');
  const webTile = l.crawl.known != null
    ? tile('Website evidence', `${l.crawl.evaluated ?? 0}<small> of ${l.crawl.known}</small>`, `known pages read; ${l.crawl.notObserved ?? 0} not observed. Answers easy to quote: ${extraction?.value ?? '—'}/100`, (extraction?.value ?? 0) < 25 ? 'bad' : 'warn')
    : tile('Website evidence', nm, 'No crawl was recorded.', 'neutral');
  const f = l.footprint;
  const fpTile = f
    ? tile('External footprint', `${f.profiles.confirmed + f.profiles.domainLinked}<small> of ${f.profiles.total}</small>`, `official profiles confirmed to link to the website; ${f.mentions.confirmed} independent mention${f.mentions.confirmed === 1 ? '' : 's'} confirmed${f.profiles.inaccessible ? `; ${f.profiles.inaccessible} profile${f.profiles.inaccessible === 1 ? '' : 's'} behind a sign-in wall` : ''}`, f.mentions.confirmed ? 'warn' : 'bad')
    : tile('External footprint', nm, 'Profiles and mentions were not checked in this run.', 'neutral');
  const revTile = f && f.reviews.searched
    ? tile('Reviews & listings', `${f.reviews.listed}<small> of ${f.reviews.checked}</small>`, `review and directory sites with a confirmed listing${f.reviews.claimed ? `; ${f.reviews.claimed} reported but not confirmable` : ''}. Not found in search is not proof of absence.`, f.reviews.listed ? 'warn' : 'bad')
    : tile('Reviews & listings', nm, 'No review source was checked.', 'neutral');
  const confTile = tile('How sure is this?', `${conf.level}`, conf.note, conf.level === 'High' ? 'good' : conf.level === 'Moderate' ? 'warn' : 'bad');
  const indicators = `<div class="v2-inds">${searchTile}${aiTile}${webTile}${fpTile}${revTile}${confTile}</div>`;

  // The discovery path: only routes this run actually tested.
  const surfaces = [
    ...(s ? [{ name: 'Google search', res: `found ${s.found - s.brandedFound}/${buyerSearches}` }] : []),
    ...l.ai.filter((a) => a.reason === 'measured' || a.reason === 'partial').map((a) => ({ name: a.label.replace(/ \(.*\)$/, ''), res: `named ${a.buyerNamed}/${a.buyerAnswers}` })),
  ];
  const cited = ctx.research?.benchmark.find((r) => r.kind === 'ai_cited_sources');
  const topSources = cited?.values ? Object.keys(cited.values).slice(0, 4) : [];
  const citedAnswers = ctx.research?.generative.filter((g) => g.status === 'observed' && g.cited && g.query) ?? [];
  const ownCited = citedAnswers.length;
  const buyerCited = citedAnswers.filter((g) => !isBrandQuestion(g, ctx.brand)).length;
  const citedScope = !ownCited ? '' : buyerCited ? ` (${buyerCited} to buyer questions)` : ' (all to questions naming the company)';
  const path = surfaces.length ? `<div class="v2-path">
    <div class="v2-path-step"><b>1 · The buyer asks</b><span>${e(String(buyerSearches || '—'))} searches and ${e(String(new Set(ctx.research?.generative.filter((g) => g.query && !isBrandQuestion(g, ctx.brand)).map((g) => g.query)).size || 0))} questions a buyer would type, without the company name</span></div><i>›</i>
    <div class="v2-path-step"><b>2 · Where they ask</b><ul>${surfaces.map((x) => `<li>${e(x.name)} <em>${e(x.res)}</em></li>`).join('')}</ul></div><i>›</i>
    <div class="v2-path-step"><b>3 · What they are shown</b><span>${topSources.length ? `Answers draw on ${e(topSources.join(', '))}` : 'Sources were not recorded'}</span></div><i>›</i>
    <div class="v2-path-step"><b>4 · What they find about ${e(ctx.brand)}</b><span>Website cited in ${ownCited} answer${ownCited === 1 ? '' : 's'}${citedScope}${f ? `; ${f.profiles.confirmed + f.profiles.domainLinked} profile${f.profiles.confirmed + f.profiles.domainLinked === 1 ? '' : 's'} linked; ${f.mentions.confirmed} third-party mention${f.mentions.confirmed === 1 ? '' : 's'}` : ''}</span></div>
  </div>` : '';

  // Strongest finding and largest uncertainty.
  const answers = ctx.research?.generative.filter((r) => r.status === 'observed' && r.brandsNamed && r.query && !isBrandQuestion(r, ctx.brand)) ?? [];
  const counts = new Map<string, number>();
  for (const r of answers) for (const b of r.brandsNamed ?? []) counts.set(b, (counts.get(b) ?? 0) + 1);
  const leaders = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const max = Math.max(1, ...leaders.map(([, n]) => n));
  const bars = [...leaders, [ctx.brand, answers.filter((r) => r.mentioned).length] as [string, number]]
    .map(([name, n]) => `<div class="v2-mbar"><span>${e(name)}</span><i style="width:${Math.max(2, (100 * n) / max)}%;background:${name === ctx.brand ? PALETTE.navy : PALETTE.blue}"></i><b>${n}</b></div>`).join('');
  const strongest = leaders.length
    ? `<div class="v2-panel"><h4>Strongest finding: AI answers recommend other tools</h4>${bars}<small>Times each brand is named across ${answers.length} AI answers to buyer questions.</small></div>`
    : (() => {
      // Without AI brand data, the strongest finding is the weakest measured area of the site itself.
      const weakest = ctx.pillars.flatMap((p) => p.dims).filter((d) => d.value != null && d.state === 'measured').sort((a, b) => a.value! - b.value!).slice(0, 4);
      return weakest.length
        ? `<div class="v2-panel"><h4>Strongest finding: the weakest measured areas</h4>${weakest.map((d) => `<div class="v2-mbar"><span>${e(d.label)}</span><i style="width:${Math.max(2, d.value!)}%;background:${scoreColor(d.value)}"></i><b>${d.value}</b></div>`).join('')}<small>Scores out of 100, measured from the website crawl.</small></div>`
        : '<div class="v2-panel"><h4>Strongest finding</h4><p class="v2-note">No measured area is available to rank.</p></div>';
    })();
  const gaps = l.access.filter((a) => ['missing_credential', 'restricted', 'no_adapter', 'quota_restricted', 'request_failed'].includes(a.reason)).slice(0, 5);
  const uncertainty = `<div class="v2-panel"><h4>Largest uncertainty: what this run could not see</h4><ul class="v2-unk">${gaps.map((a) => `<li><b>${e(a.capability)}</b><span>${e(REASON_TEXT[a.reason] ?? a.reason)}</span></li>`).join('') || '<li><span>Every planned source was reached.</span></li>'}</ul><small>Unknown is not zero: these are gaps in what was observed, not evidence of weakness.</small></div>`;

  const families: Array<[string, AccessRow['family'][]]> = [['Website', ['website']], ['Search', ['search']], ['AI answers', ['ai_answers']], ['Social', ['social']], ['Mentions', ['mentions']], ['Reviews', ['reviews']], ['Backlinks', ['backlinks']], ['Knowledge graph', ['knowledge_graph']], ['Page speed', ['page_speed']]];
  const chip = ([name, fams]: [string, AccessRow['family'][]]) => {
    const rows = l.access.filter((a) => fams.includes(a.family));
    if (!rows.length) return '';
    const m = rows.filter((a) => a.reason === 'measured').length;
    const p = rows.filter((a) => a.reason === 'partial' || a.reason === 'searched_not_found').length;
    const state = m === rows.length ? 'good' : m || p ? 'info' : 'neutral';
    return `<span class="v2-cov v2-cov-${state}">${e(name)}<em>${state === 'good' ? 'measured' : state === 'info' ? 'partial' : 'not measured'}</em></span>`;
  };
  const fresh = [ctx.research ? `public research ${fmtDate(ctx.research.collectedAt)}` : null, l.crawl.lastCrawledIso ? `website crawl ${fmtDate(l.crawl.lastCrawledIso)}` : null, `report ${ctx.generated}`].filter(Boolean).join(' · ');
  const strip = `<div class="v2-covstrip">${families.map(chip).join('')}</div><p class="v2-fresh">Evidence dates: ${e(fresh)}</p>`;

  return `<section class="v2-summary" id="summary-now">
  <header class="v2-summary-head"><span>Summary 1 of 2</span><h2>What is happening?</h2></header>
  <p class="v2-headline">${e(headlineOf(ctx))}</p>
  <p class="v2-confnote">Confidence: <b>${conf.level}</b> — ${e(conf.note)}. Missing evidence is shown as "not measured", never as zero.</p>
  ${indicators}
  ${path ? `<h3 class="v2-summary-h">How a buyer looks — and what they find</h3>${path}` : ''}
  <div class="v2-cols v2-tight v2-sf">${strongest}${uncertainty}</div>
  <h3 class="v2-summary-h">How much was measured</h3>
  ${strip}
</section>`;
}

/** One sentence on whether the named rivals appear in AI answers to buyer questions, from the pack's counts. */
function aiNamedRivals(ctx: Context, names: string[]): string {
  const answers = ctx.research?.generative.filter((r) => r.status === 'observed' && r.query && !isBrandQuestion(r, ctx.brand)) ?? [];
  if (!answers.length) return '';
  const named = names
    .map((n) => [n, answers.filter((r) => (r.brandsNamed ?? []).some((b) => b.toLowerCase() === n.toLowerCase())).length] as const)
    .filter(([, c]) => c > 0);
  return named.length
    ? `In AI answers to buyer questions, ${named.map(([n, c]) => `${n} is named in ${c}`).join(', ')} of ${answers.length}.`
    : `None of them is named in the ${answers.length} AI answers to buyer questions either; those answers name larger, established tools.`;
}

// ── Summary page 2 — What should happen next? ──────────────────────────────

const ownerOf = (a: DossierAction): string => (a.owner ? `${proper(a.owner)} team (person unassigned)` : 'Unassigned');

type Lane = { key: 'foundation' | 'discover' | 'proof'; title: string; outcome: string; actions: DossierAction[] };

/** Every action belongs to exactly one lane, from its pillar and kind. */
export function laneOf(a: DossierAction): Lane['key'] {
  if (a.kind === 'measurement') return 'proof';
  if (a.pillar === 'foundation') return 'foundation';
  if (a.pillar === 'trust' || a.pillar === 'authority') return 'proof';
  return 'discover';
}

function renderSummaryNext(ctx: Context): string {
  const actions = ctx.registry.actions;
  const lanes: Lane[] = [
    { key: 'foundation', title: 'Fix the foundation', outcome: 'Search engines and AI tools can read, understand and quote every important page.', actions: [] },
    { key: 'discover', title: 'Improve buyer-intent discoverability', outcome: `Buyers who search for the problem — not the name — start to find ${ctx.brand}.`, actions: [] },
    { key: 'proof', title: 'Build independent proof and measure again', outcome: `Others vouch for ${ctx.brand}, and the next report can show what changed.`, actions: [] },
  ];
  for (const a of actions) lanes.find((l) => l.key === laneOf(a))!.actions.push(a);
  const windows: Array<[string, string]> = [['0-30', '0–30'], ['31-60', '31–60'], ['61-90', '61–90']];
  const owners = (as: DossierAction[]) => {
    const t = [...new Set(as.map((a) => a.owner).filter(Boolean).map((o) => proper(String(o))))];
    return t.length ? `${t.join(', ')} team${t.length > 1 ? 's' : ''}; people not yet named` : 'Not assigned yet';
  };
  const laneCard = (lane: Lane, i: number) => {
    const shown = lane.actions.slice(0, 4);
    // The plainest success test in the lane: the shortest one without technical shorthand.
    const tests = lane.actions.map((a) => a.verification).filter((v): v is string => Boolean(v));
    const plain = tests.filter((v) => !/\b(SERP|credential|API|schema|JSON|HTTP|llms\.txt|robots\.txt)\b/i.test(v));
    const success = [...(plain.length ? plain : tests)].sort((a, b) => a.length - b.length)[0] ?? 'Defined per action in the detailed plan.';
    const placed = new Set<string>(lane.actions.map((a) => (a.horizon === 'later' ? '61-90' : a.horizon ?? '')));
    const deps = lane.actions.flatMap((a) => a.dependsOn).filter((d) => !lane.actions.some((x) => x.id === d));
    const depLane = [...new Set(deps.map((d) => actions.find((x) => x.id === d)).filter(Boolean).map((x) => lanes.find((l) => l.key === laneOf(x!))!.title))];
    return `<div class="v2-lane v2-lane-${lane.key}">
      <div class="v2-lane-head"><span>${i + 1}</span><div><h4>${e(lane.title)}</h4><p>${e(lane.outcome)}</p></div></div>
      ${shown.length ? `<ul>${shown.map((a) => `<li>${e(a.title.replace(/^Measure: /, 'Measure '))}</li>`).join('')}${lane.actions.length > 4 ? `<li class="v2-more">and ${lane.actions.length - 4} more in the detailed plan</li>` : ''}</ul>` : '<p class="v2-note">No action fell in this lane.</p>'}
      <dl><dt>Who</dt><dd>${e(owners(lane.actions))}</dd>
      <dt>Depends on</dt><dd>${e(depLane.length ? depLane.join(', ') : 'Nothing outside this lane')}</dd>
      <dt>Success</dt><dd>${e(success)}</dd></dl>
      <div class="v2-lane-time">${windows.map(([h, label]) => `<span class="${placed.has(h) ? 'on' : ''}">${label} days</span>`).join('')}</div>
    </div>`;
  };

  const blocked = ctx.ledger.access.filter((a) => ['missing_credential', 'restricted', 'no_adapter', 'quota_restricted'].includes(a.reason));
  const blockedStrip = blocked.length ? `<div class="v2-blocked"><h4>Blocked until access is in place</h4><ul>${blocked.slice(0, 6).map((a) => `<li><b>${e(a.capability)}</b> — ${e(REASON_TEXT[a.reason])}${a.nextStep ? `: ${e(a.nextStep.replace(/\s*\([^)]*_[A-Z_]+[^)]*\)/g, ''))}` : ''}</li>`).join('')}</ul></div>` : '';

  return `<section class="v2-summary" id="summary-next">
  <header class="v2-summary-head"><span>Summary 2 of 2</span><h2>What should happen next?</h2></header>
  <p class="v2-headline">Three lanes of work that can run side by side. Where one lane waits on another, the lane says so.</p>
  <div class="v2-lanes">${lanes.map(laneCard).join('')}</div>
  ${blockedStrip}
  <p class="v2-note">Each action, with its effort, confidence, evidence and success test, is in the action register (section 5). Placement in the 30/60/90-day windows comes from each action's stated timing or, where none was stated, its effort.</p>
</section>`;
}

// ── 1. Market & competitors ─────────────────────────────────────────────────

const CLASS_LABEL: Record<string, { text: string; tone: Tone }> = {
  direct: { text: 'Direct competitor', tone: 'bad' },
  adjacent: { text: 'Adjacent competitor', tone: 'warn' },
  substitute: { text: 'Substitute', tone: 'info' },
  strategic: { text: 'Strategic / future', tone: 'info' },
  substitute_candidate: { text: 'Possible substitute — unvalidated', tone: 'neutral' },
  unconfirmed: { text: 'Unconfirmed', tone: 'neutral' },
  not_competitor: { text: 'Not a competitor', tone: 'good' },
};

function renderMarket(ctx: Context): string {
  const r1 = ctx.payload.report1;
  const pack = ctx.research;

  const definition = pack?.company.length
    ? `<table class="v2-table"><thead><tr><th>What ${e(ctx.brand)} says about itself</th><th style="width:16%">State</th><th style="width:22%">Source</th></tr></thead><tbody>${
      pack.company.filter((r) => r.kind !== 'site_navigation').map((r) => { const st = stateLabel(r.status); return `<tr><td>${e(r.claim)}<br/><span class="v2-id">${e(r.id)}</span></td><td>${pill(st.text, st.tone)}</td><td><small>${e(r.sourceUrl.replace(/^https?:\/\/(www\.)?/, ''))}<br/>${e(fmtDate(r.observedAt) ?? '')}</small></td></tr>`; }).join('')
    }</tbody></table><p class="v2-note">Company-declared: this is what the company says about itself. It establishes the offer and the intended buyer; it does not establish customer outcomes or market position.</p>`
    : '';

  const fields = objs(obj(r1?.company_identity)?.fields);
  const agreementPill = (a: unknown) =>
    a === 'agree' ? pill('Website agrees', 'good') : a === 'differ' ? pill('Website differs', 'bad') : a === 'declared_only' ? pill('Declared only', 'neutral') : a === 'observed_only' ? pill('Observed only', 'info') : pill('Unresolved', 'neutral');
  const identity = fields.length ? `<table class="v2-table"><thead><tr><th style="width:20%">Attribute</th><th>Company profile</th><th>Website shows</th><th style="width:16%">Agreement</th></tr></thead><tbody>${
    fields.map((f) => `<tr><td><strong>${e(f.label)}</strong></td><td>${e(f.declaredValue ?? '—')}</td><td>${e(f.observedValue ?? '— not stated on the pages read')}</td><td>${agreementPill(f.agreement)}</td></tr>`).join('')
  }</tbody></table>` : '';

  // Competitor pipeline: candidate → check fit → verified.
  let landscape = '';
  if (pack?.competitors.length) {
    const comps = pack.competitors;
    const verified = comps.filter((c) => ['direct', 'adjacent', 'strategic'].includes(String(c.classification)));
    const rejected = comps.filter((c) => c.classification === 'not_competitor');
    const open = comps.filter((c) => c.classification === 'unconfirmed' || c.classification === 'substitute_candidate');
    const stage = (n: number, label: string, sub: string, tone: string) => `<div class="v2-pipe-stage" style="border-color:${tone}"><b>${n}</b><span>${e(label)}</span><small>${e(sub)}</small></div>`;
    const pipeline = `<div class="v2-pipe">${stage(comps.length, 'Candidates', `from ${ctx.brand}’s buyer searches`, PALETTE.greyMid)}<i>›</i>${stage(comps.length - open.length, 'Fit checked', 'against each site’s own pages', PALETTE.blue)}<i>›</i>${stage(verified.length, 'Validated', 'direct or adjacent', PALETTE.green)}<i>›</i>${stage(rejected.length, 'Rejected', 'label or name overlap only', PALETTE.crimson)}</div>`;
    const table = `<table class="v2-table"><thead><tr><th style="width:18%">Company</th><th style="width:18%">Classification</th><th>Why (from its own site)</th><th style="width:10%">Confidence</th></tr></thead><tbody>${
      comps.map((c) => { const cl = CLASS_LABEL[String(c.classification)] ?? CLASS_LABEL.unconfirmed; return `<tr><td><strong>${e(c.name)}</strong><br/><small>${e(c.domain)}</small><br/><span class="v2-id">${e(c.id)}</span></td><td>${pill(cl.text, cl.tone)}</td><td><small>${e(c.claim)}</small><br/><small class="v2-muted">${e(c.scope)}</small></td><td>${e(c.confidence)}</td></tr>`; }).join('')
    }</tbody></table>`;
    // Pricing — only where both sides publish comparable prices.
    const ownPrice = pack.company.find((r) => r.price);
    const priceRows: Array<[string, string, string]> = [
      ...(ownPrice ? [[ctx.brand, ownPrice.price!, ownPrice.id] as [string, string, string]] : []),
      ...verified.filter((c) => c.price).map((c): [string, string, string] => [String(c.name), c.price!, c.id]),
    ];
    const unpriced = verified.filter((c) => !c.price).map((c) => String(c.name));
    const pricing = priceRows.length ? `<table class="v2-table v2-compact"><thead><tr><th>Company</th><th>Published price</th><th>Evidence</th></tr></thead><tbody>${priceRows.map(([n, p, id]) => `<tr><td>${e(n)}</td><td>${e(p)}</td><td>${evRef([id])}</td></tr>`).join('')}
      ${unpriced.length ? `<tr><td>${e(unpriced.join(', '))}</td><td><em>Not recorded — no price on the pages checked</em></td><td>—</td></tr>` : ''}</tbody></table>
      <p class="v2-note">Prices exactly as each company publishes them. Packaging differs (credits, seats, client profiles), so a lower number is not necessarily cheaper.</p>` : '';
    landscape = block('Who competes for the same buyer', `Candidates came from the companies returned for ${ctx.brand}’s own buyer searches (section 4); each was checked against its own website for the same product, buyer and job. Only validated companies are compared.`, pipeline + table)
      + (pricing ? block('Published pricing', null, pricing) : '');
  } else {
    const ct = obj(r1?.competitive_tables) ?? {};
    landscape = block('Who competes for the same buyer', null, `<p class="v2-note">${e(str(ct.emptyReason) ?? 'No competitor set was established.')} Comparisons are held open until a validated competitor set exists.</p>`);
  }

  const bench = pack?.benchmark.filter((r) => r.kind === 'benchmark' && r.values) ?? [];
  let benchmark = '';
  let profile = '';
  let overlap = '';
  if (bench.length) {
    const domains = [...new Set([pack!.subject.domain, ...bench.flatMap((r) => Object.keys(r.values ?? {}))])];
    const nameOf = (d: string) => (d === pack!.subject.domain ? ctx.brand : String(pack!.competitors.find((c) => c.domain === d || c.name === d)?.name ?? d));
    const cell = (v: { value: string; status: string; url?: string } | undefined, own: boolean) => {
      if (!v) return '<td>—</td>';
      const weak = own && (v.status === 'looked_for_not_found' || /^(none|0 of|404)/i.test(v.value));
      const tag = v.status === 'company_declared' ? ' <em>(claimed)</em>' : v.status === 'inferred' ? ' <em>(not re-confirmed)</em>' : '';
      const link = v.url && /^https?:/.test(v.url) ? `<br/><span class="v2-src">${e(v.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</span>` : '';
      const text = v.value.length > 110 ? `${v.value.slice(0, 107)}…` : v.value;
      return `<td${weak ? ' class="v2-gapcell"' : ''}><small>${e(text)}${tag}${link}</small></td>`;
    };
    const basicRows = bench.filter(isMarketingBasic);
    const profileRows = bench.filter((r) => !isMarketingBasic(r));
    const table = (rows: ResearchRecord[], first: string, last: boolean) => `<table class="v2-table v2-compact v2-bench"><thead><tr><th style="width:15%">${e(first)}</th>${domains.map((d) => `<th>${e(nameOf(d))}</th>`).join('')}${last ? `<th style="width:22%">What it means for ${e(ctx.brand)}</th>` : ''}</tr></thead><tbody>${
      rows.map((r) => `<tr><td><strong>${e(r.claim)}</strong><br/><span class="v2-id">${e(r.id)}</span></td>${domains.map((d, i) => cell(r.values?.[d], i === 0 && last)).join('')}${last ? `<td><small>${e(r.gap ?? '')}</small>${r.recommends ? `<br/><span class="v2-id">${e(r.recommends.id)}</span>` : ''}</td>` : ''}</tr>`).join('')
    }</tbody></table>`;
    profile = profileRows.length ? table(profileRows, 'Company profile', false) + `<p class="v2-note">Each value was found by an AI analyst using live web search and carries its source; the pipeline re-opened every source page. "(not re-confirmed)" marks a value the page did not show when re-checked. Revenue is shown only where a public source states it.</p>` : '';
    benchmark = basicRows.length ? table(basicRows, 'Marketing basic', true) + `<p class="v2-note">Shaded cells are where ${e(ctx.brand)} has nothing comparable yet. "(claimed)" marks a company's statement about itself.</p>` : '';
    const capRows = pack!.benchmark.filter((r) => r.kind === 'capability' && r.values);
    if (capRows.length) {
      const capCols = domains.filter((d) => capRows.some((r) => r.values?.[d]));
      overlap = heatmap(capCols.map(nameOf), capRows.map((r) => ({
        label: r.claim, sub: r.gap ?? '',
        cells: capCols.map((d): HeatCell => {
          const v = r.values?.[d];
          if (!v || v.value === 'unknown') return { text: 'unknown', tone: 'unmeasured' };
          return v.value === 'yes' ? { text: v.status === 'inferred' ? 'yes (unconfirmed)' : 'yes', tone: 'top' } : { text: 'no', tone: 'absent' };
        }),
      }))) + heatLegend([{ tone: 'top', label: 'Offers it' }, { tone: 'absent', label: 'Does not' }, { tone: 'unmeasured', label: 'Unknown' }])
        + `<p class="v2-note">Rows are ${e(ctx.brand)}'s own declared capabilities. A competitor covering most of them is a like-for-like rival; one covering a few is focused on part of the offer. "No" is the analyst's reading of the competitor's site and is not re-confirmed.</p>`;
    }

  }

  const icp = obj(ctx.payload.market_icp_recommendation);
  const attrs = objs(icp?.attributes);
  const icpTable = attrs.length ? `<table class="v2-table"><thead><tr><th style="width:22%">Market attribute</th><th style="width:16%">State</th><th>Value, or what would resolve it</th></tr></thead><tbody>${
    attrs.map((a) => { const st = stateLabel(a.status === 'unavailable' ? 'unavailable' : String(a.status)); return `<tr><td>${e(a.label)}</td><td>${pill(st.text, st.tone)}</td><td><small>${e(a.value ?? a.unlock ?? '—')}</small></td></tr>`; }).join('')
  }</tbody></table>` : '';

  const verifiedNames = pack?.competitors.filter((c) => ['direct', 'adjacent'].includes(String(c.classification))).map((c) => c.name) ?? [];
  return section(1, 'Market and competitors', 'What does the company sell, to whom, and who else competes for that buyer?',
    marketPlainEnglish(verifiedNames, pack?.competitors.filter((c) => c.classification === 'not_competitor').length ?? 0), `
    ${definition ? block('What the company offers — from its own pages', 'The starting point for everything else: buyer problems, search queries and competitor criteria come from this.', definition) : ''}
    ${identity ? block('Company profile versus website', 'What was entered in the company profile next to what the website says. A difference is shown, not resolved.', identity) : ''}
    ${landscape}
    ${profile ? block('Competitor profiles', 'What each company sells, to whom, where, and how big it is — from public sources.', profile, 'v2-allow-break') : ''}
    ${overlap ? block('Offering overlap', 'Which of the company\'s own capabilities each competitor also offers.', overlap) : ''}
    ${benchmark ? block('How the competitors market themselves', 'The same public checks for each company, side by side, and what closing each gap would take.', benchmark, 'v2-allow-break') : ''}
    ${icpTable ? block('Market facts the public record does not yet establish', str(icp?.headline), icpTable + (profile ? `<p class="v2-note">The competitor profiles above are the nearest public evidence for segment, buyer and market: they show who the validated competitors sell to and where. They describe the competitors, so these attributes stay unresolved for ${e(ctx.brand)} itself.</p>` : '') + (pack?.company.length ? `<p class="v2-note">The company’s own pages state its intended buyers and prices (${e(pack.company.filter((r) => /^(buyers|pricing)/i.test(r.claim)).map((r) => r.id).join(', '))}). That is company-declared intent, not independent market evidence, so these attributes stay unresolved here.</p>` : '')) : ''}
  `);
}

// ── 2. Website & content ────────────────────────────────────────────────────

const PLAIN_FOR_FINDING: Record<string, string> = {
  extraction_readiness: 'Search engines and AI assistants struggle to pull a clear, quotable answer from these pages.',
  accessibility: 'Parts of the site are harder to use with assistive technology, and the same structure helps machines read it.',
  authority_velocity: 'The site shows little sign of being updated, which makes it look less active to buyers and engines.',
  entity_graph_strength: 'The brand is not yet described consistently enough for engines to treat it as one clearly defined company.',
  content: 'Some pages say very little, so a buyer arriving there may not find what they need.',
  positioning: 'Visitors read a different story from the one the company uses to describe itself.',
};
const plainFor = (f: DossierFinding): string | null =>
  PLAIN_FOR_FINDING[f.id.replace(/^F-dim-/, '').replace(/-/g, '_')] ?? (f.kind === 'content' ? PLAIN_FOR_FINDING.content : f.kind === 'positioning' ? PLAIN_FOR_FINDING.positioning : null);

/** Page purpose before depth: a short legal page is expected; a short pricing page is a problem. */
const PAGE_ROLES: Array<[RegExp, string]> = [
  [/\/(terms|privacy|cookie|legal|data-deletion|imprint|disclaimer|refund)/i, 'Legal / policy'],
  [/\/(login|signin|signup|register|account|dashboard)/i, 'Account / utility'],
  [/\/(help|support|faq|docs)/i, 'Support'],
  [/\/(blog|article|news|guide|resources)/i, 'Content'],
  [/\/(about|team|careers|company)/i, 'Company'],
  [/\/(pricing|features|solutions|product|contact-sales|demo|get-free-credits|reports)/i, 'Commercial'],
];
export const pageRole = (url: string): string => {
  const path = url.replace(/^https?:\/\/[^/]+/, '') || '/';
  if (path === '/' || path === '') return 'Commercial (home)';
  return PAGE_ROLES.find(([re]) => re.test(path))?.[1] ?? 'Unclassified';
};

function thinPageCaveat(f: DossierFinding): string | null {
  const urls = (f.observation.match(/https?:\/\/[^\s,)]+/g) ?? []);
  if (urls.length === 0) return null;
  const roles = urls.map(pageRole);
  if (roles.every((r) => r === 'Legal / policy')) {
    return 'The example pages listed are legal or policy pages, which are usually short by design. Which of the thin pages are commercial (product, pricing, solution) is not established by this crawl; review the commercial pages first.';
  }
  return null;
}

function findingCard(f: DossierFinding, actions: DossierAction[]): string {
  const st = stateLabel(f.state);
  const tone = f.kind === 'coverage' || f.kind === 'competitive' ? 'neutral' : f.state === 'measured' ? 'bad' : 'warn';
  const linked = actions.filter((a) => f.actionIds.includes(a.id));
  const metric = f.metric ? f.metric.split(' (')[0] : null;
  const plain = plainFor(f);
  const caveat = f.kind === 'content' ? thinPageCaveat(f) : null;
  return `<div class="v2-card v2-tone-${tone}"><h4>${e(f.title)} ${pill(st.text, st.tone)}</h4>
    ${metric ? `<div class="v2-card-metric">${e(metric)}</div>` : ''}
    ${plain ? `<div class="v2-card-plain">${e(plain)}</div>` : ''}
    <dl>${f.observation !== metric ? `<dt>Observed</dt><dd>${e(f.observation)}</dd>` : ''}
    ${f.implication ? `<dt>Why it matters</dt><dd>${e(f.implication)}</dd>` : ''}
    ${caveat ? `<dt>Caveat</dt><dd>${e(caveat)}</dd>` : ''}
    <dt>Source</dt><dd>${e(f.source)}</dd>
    ${linked.length ? `<dt>Action</dt><dd>${linked.map((a) => `${e(a.title)} <span class="v2-id">${e(a.id)}</span>`).join('<br/>')}</dd>` : ''}</dl>
    <div class="v2-id" style="margin-top:1.5mm">${e(f.id)}</div></div>`;
}

function renderWebsite(ctx: Context): string {
  const r1 = ctx.payload.report1;
  const wc = obj(r1?.website_checks) ?? {};
  const groups = objs(wc.groups);
  const stack = stackedRows(groups.map((g) => {
    const checks = objs(g.checks);
    const count = (s: string) => checks.filter((c) => c.status === s).length;
    return {
      label: String(g.label ?? ''),
      segments: [
        { label: 'Observed / pass', count: count('pass'), color: PALETTE.green },
        { label: 'Needs attention', count: count('warn') + count('fail'), color: PALETTE.amber },
        { label: 'Not evaluated', count: count('not_evaluable'), color: PALETTE.greyMid },
      ],
    };
  }));

  const total = num(wc.total);
  const evaluated = num(wc.evaluated);
  const funnelStages: FunnelStage[] = [];
  if (ctx.crawl.known != null) funnelStages.push({ label: 'Known web addresses', value: ctx.crawl.known });
  if (ctx.crawl.read != null) {
    funnelStages.push({ label: 'Answered the crawler', value: ctx.crawl.read, note: ctx.crawl.unread ? 'the rest were not observed in this run' : undefined });
    funnelStages.push({ label: 'Pages read and evaluated', value: ctx.crawl.read });
  }
  const crawlBody = funnelStages.length
    ? funnel(funnelStages) + `<p class="v2-note">Attempted in this run: <strong>not recorded</strong> — the crawl stores known addresses and the pages that answered, not how many were tried, so the ${ctx.crawl.unread ?? ''} not observed are not counted as failures: whether they were tried, timed out or returned an error is unknown. Crawl of ${e(ctx.crawl.lastCrawled ?? '—')}${ctx.crawl.reused ? ', reused for this report' : ''}${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso) != null ? ` (${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso)} days before the report)` : ''}. ${evaluated ?? '—'} of ${total ?? '—'} website checks could be evaluated.</p>`
    : '<p class="v2-note">Crawl scope was not recorded.</p>';

  // Page purpose map — from the site's own navigation (research) when available.
  const nav = ctx.research?.company.find((r) => r.kind === 'site_navigation' && r.pages?.length);
  const roleCounts = new Map<string, string[]>();
  for (const p of nav?.pages ?? []) { const r = pageRole(p); roleCounts.set(r, [...(roleCounts.get(r) ?? []), p]); }
  const roleMap = nav ? `<div class="v2-roles">${[...roleCounts.entries()].map(([role, pages]) => `<div class="v2-role"><b>${e(role)}</b><small>${pages.map(e).join(' · ')}</small></div>`).join('')}</div>
    <p class="v2-note">Pages linked from the site's navigation and footer (${e(nav.id)}, observed ${e(fmtDate(nav.observedAt) ?? '')}). Depth should be judged against purpose: legal and account pages are expected to be short; commercial pages carry the buying decision.</p>` : '';

  const de = obj(r1?.digital_experience);
  const readiness = objs(de?.pillars).map((p) => {
    const r = String(p.readiness ?? '');
    const tone: Tone = r === 'ready' ? 'good' : r === 'partial' ? 'warn' : r === 'not_ready' ? 'bad' : 'neutral';
    const cov = obj(p.coverage);
    return `<tr><td>${e(p.label)}</td><td>${pill(cap(r.replace(/_/g, ' ')), tone)}</td><td class="v2-num">${num(cov?.evaluated) ?? '—'} / ${num(cov?.total) ?? '—'} signals</td></tr>`;
  }).join('');

  const dimRows: BarRow[] = ctx.pillars.filter((p) => ['foundation', 'momentum'].includes(p.key))
    .flatMap((p) => p.dims.map((d) => ({ label: d.label, value: d.value, tag: `${p.label} · ${d.value == null ? 'not measured' : d.state}`, note: 'not measured' })));
  const cards = ctx.registry.findings.filter((f) => f.kind === 'content' || (f.kind === 'dimension' && ['foundation', 'momentum'].includes(f.pillar ?? '')));
  const perf = obj(r1?.performance);
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');

  return section(2, 'Website and content', 'Can a buyer — and a search or AI engine — read, understand and act on the site?',
    websitePlainEnglish(ctx, groups, extraction?.value ?? null), `
    ${block('Crawl coverage', 'From every address the crawler knew to the pages it could actually read.', crawlBody)}
    ${ctx.research?.site.length ? block('Crawl and entity basics', 'Checked directly on the live site.', `<table class="v2-table v2-compact"><tbody>${ctx.research.site.map((r) => `<tr><td>${e(r.claim)}<br/><span class="v2-id">${e(r.id)}</span></td><td style="width:30%"><small>${e(r.sourceUrl.replace(/^https?:\/\/(www\.)?/, ''))}<br/>${e(r.excerpt ?? '')}</small></td></tr>`).join('')}</tbody></table>`) : ''}
    ${perf ? block('Page speed', null, `<p class="v2-note">${e(str(perf.reasonUnavailable) ?? `Performance state: ${perf.state}`)}</p>`) : ''}
    ${roleMap ? block('Page purpose map', 'What each page is for, before judging how much it says.', roleMap) : ''}
    ${block('Website checks by area', 'Count of checks per outcome. "Not evaluated" means the crawl could not read the signal — not a fault on the site.', stack + swatchLegend([[PALETTE.green, 'Observed / pass'], [PALETTE.amber, 'Needs attention'], [PALETTE.greyMid, 'Not evaluated']]))}
    ${readiness ? block('Digital experience readiness', 'A classification, not a score.', `<table class="v2-table"><tbody>${readiness}</tbody></table>`) : ''}
    ${block('Dimension scores', 'The dimensions behind Foundation and Momentum.', barChart(dimRows))}
    ${cards.length ? block('Findings', 'Each card: what was observed, what it means, why it matters, and the action that addresses it.', `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`, 'v2-allow-break') : ''}
  `);
}

// ── 3. Brand, entity & trust ────────────────────────────────────────────────

function renderBrand(ctx: Context): string {
  const p = ctx.payload;
  const sig = (x: unknown) => ({ score: obj(obj(x)?.score), text: str(obj(obj(x)?.rationale)?.text) });
  const kg = sig(p.knowledge_graph); const ai = sig(p.authority_inflow); const tr = sig(p.trust_coherence);
  const statusRow = (label: string, meaning: string, s: { score: Obj | null; text: string | null }) => {
    const st = stateLabel(sourceState(s.score, s.text));
    return `<tr><td><strong>${e(label)}</strong><br/><small>${e(meaning)}</small></td><td>${pill(st.text, st.tone)}</td><td class="v2-num">${num(s.score?.value) ?? '—'}</td><td><small>${e(s.text ?? '')}</small></td></tr>`;
  };
  const status = `<table class="v2-table"><thead><tr><th style="width:26%">Signal</th><th style="width:16%">State</th><th style="width:8%">Score</th><th>Basis</th></tr></thead><tbody>
    ${statusRow('Backlinks', 'links from other websites to yours', ai)}
    ${statusRow('Entity and knowledge graph', 'whether public databases (e.g. Wikidata) know the company', kg)}
    ${statusRow('Reviews and reputation', 'independent ratings and reviews', tr)}
  </tbody></table>`;

  const de = obj(p.declared_evidence);
  const social = objs(de?.social_presence);
  const kgState = sourceState(kg.score, kg.text);
  const pack = ctx.research;
  const fp = pack?.footprint ?? null;
  const PROFILE_SUB: Record<string, string> = {
    identity_confirmed: 'confirmed: names brand, links site', domain_linked: 'links to the website', fetched: 'opened; link not shown',
    inaccessible: 'sign-in or bot wall', declared_unverified: 'declared, not checked',
  };
  const nodes: GraphNode[] = [
    ...(fp && fp.profiles.length
      ? fp.profiles.map((p): GraphNode => ({ id: p.url, label: p.platform, sub: PROFILE_SUB[p.state], kind: p.state === 'identity_confirmed' || p.state === 'domain_linked' ? 'observed' : 'declared' }))
      : social.map((s): GraphNode => ({
        id: String(s.platform), label: proper(String(s.platform)),
        sub: s.status === 'observed' ? 'found in search' : s.status === 'unreachable' ? 'not checked' : 'declared, unverified',
        kind: s.status === 'observed' ? 'observed' : 'declared',
      }))),
    { id: 'wikidata', label: 'Wikidata', sub: kgState === 'failed' ? 'lookup failed' : kgState === 'not_found' ? 'no entity found' : 'entity record', kind: kgState === 'measured' ? 'observed' : 'absent' },
  ];
  if (fp) {
    const confirmed = fp.mentions.filter((m) => m.check === 'confirmed').length;
    const listed = fp.platforms.filter((x) => x.state === 'listed').length;
    nodes.push({ id: 'mentions', label: 'Third-party mentions', sub: confirmed ? `${confirmed} confirmed` : 'none confirmed', kind: confirmed ? 'observed' : 'absent' });
    nodes.push({ id: 'reviews', label: 'Review sites', sub: listed ? `${listed} listed` : `none of ${fp.platforms.length} confirmed`, kind: listed ? 'observed' : 'absent' });
    nodes.push({ id: 'backlinks', label: 'Backlinks', sub: 'not measured', kind: 'absent' });
  } else if (pack) {
    if (pack.independent.some((r) => r.kind === 'directory_listing' && r.status === 'looked_for_not_found')) nodes.push({ id: 'reviews', label: 'Review sites', sub: 'G2 / Capterra: not found', kind: 'absent' });
    if (pack.independent.some((r) => r.kind === 'third_party_mention' && r.status === 'looked_for_not_found')) nodes.push({ id: 'press', label: 'Press & mentions', sub: 'none found', kind: 'absent' });
  }
  const graph = entityGraph({ id: 'brand', label: ctx.brand, sub: ctx.domain, kind: 'center' }, nodes)
    + swatchLegend([[PALETTE.green, 'Observed in public sources'], [PALETTE.blue, 'Declared or found, not verified'], [PALETTE.greyMid, 'Not found, or not measured (see label)']]);

  // External digital footprint: owned, independent, reviews and backlinks kept apart.
  const footprint = fp ? (() => {
    const where = (p: typeof fp.profiles[number]) => [p.declared && 'declared by the company', p.onHomepage && 'homepage link', p.inSameAs && 'structured data'].filter(Boolean).join(', ');
    const pState = (p: typeof fp.profiles[number]) => (p.state === 'identity_confirmed' ? pill('Identity confirmed', 'good') : p.state === 'domain_linked' ? pill('Links to the website', 'good')
      : p.state === 'fetched' ? pill('Opened, not confirmed', 'info') : p.state === 'inaccessible' ? pill(p.outcome === 'login_wall' ? 'Sign-in wall' : 'Could not open', 'warn') : pill('Declared, not checked', 'neutral'));
    const profiles = fp.profiles.length ? `<table class="v2-table v2-compact"><thead><tr><th style="width:14%">Platform</th><th>Profile</th><th style="width:20%">Where it was found</th><th style="width:18%">State</th><th style="width:26%">Detail</th></tr></thead><tbody>${
      fp.profiles.map((p) => `<tr><td><strong>${e(p.platform)}</strong></td><td><small>${e(p.url.replace(/^https?:\/\/(www\.)?/, ''))}</small></td><td><small>${e(where(p) || '—')}</small></td><td>${pState(p)}</td><td><small>${e(p.reason ?? (p.state === 'identity_confirmed' ? 'Names the brand and links to the website.' : 'Links to the website.'))}${p.outcome === 'responded' ? ` ${p.posts ? `Posts visible signed out: ${p.posts.count} (${fmtDate(p.posts.oldest)} – ${fmtDate(p.posts.newest)}).` : 'No dated posts visible signed out.'}` : ''}</small></td></tr>`).join('')
    }</tbody></table><p class="v2-note">Owned profiles show the company exists on a platform; they are not independent endorsement. Each was opened once, signed out, on ${e(fmtDate(fp.checkedAt) ?? '')}. Posts are counted only where the signed-out page publishes them with dates; that is a sample of recent activity, not the platform's full history, and a platform that shows none is not evidence of inactivity.</p>` : '<p class="v2-note">No official profile was declared, linked from the homepage or listed in structured data.</p>';
    const confirmed = fp.mentions.filter((m) => m.check === 'confirmed');
    const unconfirmed = fp.mentions.filter((m) => m.check !== 'confirmed');
    const mentions = fp.mentionSearch
      ? (fp.mentions.length ? `<table class="v2-table v2-compact"><thead><tr><th>Third-party page</th><th style="width:16%">Type</th><th style="width:20%">State</th></tr></thead><tbody>${
        [...confirmed, ...unconfirmed].map((m) => `<tr><td>${e(m.title || m.url)}<br/><small>${e(m.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70))}</small></td><td><small>${e(cap(m.type.replace(/_/g, ' ')))}</small></td><td>${m.check === 'confirmed' ? pill('Names the brand', 'good') : pill('Not confirmed on the page', 'neutral')}</td></tr>`).join('')
      }</tbody></table>` : '<p class="v2-note">A web search for third-party pages about the company found none that could be confirmed. That is a finding about this search, not proof that none exist.</p>')
      : '<p class="v2-note">The mention search did not run, so independent mentions are not measured.</p>';
    const reviews = fp.platforms.length ? `<div class="v2-chips">${fp.platforms.map((x) => `<span class="v2-chip v2-chip-${x.state === 'listed' ? 'good' : x.state === 'claimed_unconfirmed' ? 'info' : 'neutral'}">${e(x.platform)}<em>${x.state === 'listed' ? 'listed' : x.state === 'claimed_unconfirmed' ? 'reported, not confirmable' : 'not found in search'}</em></span>`).join('')}</div>
      <p class="v2-note">"Not found in search" means a web search did not surface a listing; it is not proof of absence. "Reported, not confirmable" means search pointed to a listing whose page could not be opened or did not name the company.</p>` : '';
    const bl = ctx.ledger.access.find((a) => a.family === 'backlinks');
    const posts = fp.socialPosts ?? [];
    const ownPosts = posts.filter((x) => x.fromOwnAccount).length;
    const postsNote = posts.length ? `<p class="v2-note">Also found: ${posts.length} social post${posts.length === 1 ? '' : 's'} naming the company (${ownPosts} from its own accounts${posts.length - ownPosts ? `, ${posts.length - ownPosts} from other accounts whose link to the company cannot be checked signed out` : ''}). Social posts are not counted as independent mentions.</p>` : '';
    const queries = fp.mentionQueries ?? [];
    const how = fp.mentionSearch
      ? `<p class="v2-note">Method: web search by ${e(fp.mentionSearch === 'openai' ? 'OpenAI (web search tool)' : 'Claude (web search tool)')} on ${e(fmtDate(fp.checkedAt) ?? '')}, then each page re-opened to confirm it names the company. ${queries.length ? `Queries the search ran: ${queries.slice(0, 6).map((q) => `“${e(q)}”`).join('; ')}.` : 'The exact queries were not recorded for this run.'} A model-directed web search is a sample, not an exhaustive index of the web.</p>`
      : '';
    return `${block('Owned profiles', null, profiles)}${block('Independent mentions', 'Pages on other sites that discuss the company. A mention is not necessarily a link.', mentions + postsNote + how)}${reviews ? block('Review and directory listings', null, reviews) : ''}${block('Backlinks', null, `<p class="v2-note">${e(bl?.outcome ?? 'Not measured.')} ${e(bl?.nextStep ?? '')}</p>`)}`;
  })() : '';

  const independent = pack?.independent.length ? `<table class="v2-table"><thead><tr><th>What was looked for</th><th style="width:20%">State</th><th style="width:22%">Method</th></tr></thead><tbody>${
    pack.independent.map((r) => { const st = stateLabel(r.status); return `<tr><td>${e(r.claim)}<br/><span class="v2-id">${e(r.id)}</span></td><td>${pill(st.text, st.tone)}</td><td><small>${e(r.method)} · ${e(r.scope)}</small></td></tr>`; }).join('')
  }</tbody></table>` : '';

  const checks = objs(obj(p.report1?.website_checks)?.groups).flatMap((g) => objs(g.checks));
  const PROOF = ['testimonials', 'case_studies', 'social_proof', 'company_information', 'contact_info', 'pricing_visibility', 'legal_pages'];
  const proofRows = PROOF.map((k) => checks.find((c) => c.key === k)).filter((c): c is Obj => Boolean(c)).map((c) => {
    const found = c.status === 'pass';
    return `<tr><td>${e(c.label)}</td><td>${found ? pill('Found', 'good') : pill('Not found on pages read', 'neutral')}</td><td><small>${e(c.detail ?? '')}</small></td></tr>`;
  }).join('');
  const proof = proofRows ? `<table class="v2-table"><thead><tr><th style="width:26%">Proof on the company's own site</th><th style="width:24%">State</th><th>Detail</th></tr></thead><tbody>${proofRows}</tbody></table>
    <p class="v2-note">Company-published proof (testimonials, case studies on its own site) is different from independent proof (reviews and articles on other sites). Not finding either is not evidence that customers or reviews do not exist.</p>` : '';

  const cards = ctx.registry.findings.filter((f) => f.kind === 'positioning' || f.id === 'F-research-name-collision' || f.id === 'F-research-no-independent-proof' || (f.kind === 'dimension' && ['authority', 'trust'].includes(f.pillar ?? '')));

  const ba = obj(obj(p.backlink_authority)?.strategy);
  const recs = objs(ba?.recommendations);
  const strategy = recs.length ? `<table class="v2-table"><thead><tr><th>Type of external authority</th><th style="width:12%">When</th><th style="width:14%">Horizon</th><th style="width:14%">Relevance</th></tr></thead><tbody>${
    recs.map((r) => {
      const rel = objs(r.relevance);
      const supports = rel.filter((x) => x.verdict === 'supports').length;
      const why = (str(r.whyItMatters) ?? '').split(/(?<=\.)\s+For this company/)[0];
      return `<tr><td><strong>${e(r.label)}</strong><br/><small>${e(why)}</small></td><td>${pill(cap(String(r.priority ?? '')), r.priority === 'now' ? 'info' : 'neutral')}</td><td>${e(cap(String(r.horizon ?? '').replace(/_/g, ' ')))}</td><td class="v2-num">${supports} of ${rel.length} checks</td></tr>`;
    }).join('')
  }</tbody></table><p class="v2-note">Types of authority worth building — not a list of sites, and not links the company already has.</p>` : '';

  return section(3, 'Brand, entity and trust', 'Does the wider web recognise and vouch for the brand?',
    brandPlainEnglish(ctx, kgState), `
    ${block('Brand ecosystem', 'An entity is an organisation that search engines and AI tools can recognise across sources. Each line shows how the link to the brand was established.', graph)}
    ${footprint ? `<div class="v2-keep"><h3 class="v2-subsection">External digital footprint</h3>${footprint}</div>` : ''}
    ${independent ? block('Independent evidence', 'Third-party confirmation, looked for in public sources.', independent) : ''}
    ${block('External signal status', '"Unavailable" means a source is missing, not that the result is weak.', status)}
    ${proof ? block('Proof inventory', null, proof) : ''}
    ${cards.length ? block('Findings', null, `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`, 'v2-allow-break') : ''}
    ${strategy ? block('External authority worth building', null, strategy, 'v2-allow-break') : ''}
  `);
}

/** Section 1's plain-English line: names and rejections only as this run established them. */
function marketPlainEnglish(verified: string[], rejected: number): string {
  const who = verified.length
    ? `Checked against their own websites, ${verified.join(', ')} ${verified.length === 1 ? 'competes' : 'compete'} for the same buyer.`
    : 'No competitor set has been validated yet.';
  const out = rejected ? ` ${rejected} candidate${rejected === 1 ? ' that only shared' : 's that only shared'} a label or a similar name ${rejected === 1 ? 'was' : 'were'} ruled out rather than compared.` : '';
  return `${who}${out}`;
}

/** Section 2's plain-English line: each judgement only when the run's own checks support it. */
function websitePlainEnglish(ctx: Context, groups: Obj[], extraction: number | null): string {
  const checks = groups.flatMap((g) => objs(g.checks)).filter((c) => c.status !== 'not_evaluable');
  const pass = checks.filter((c) => c.status === 'pass').length;
  const freshness = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'authority_velocity')?.value ?? null;
  const parts = [`The crawler read ${ctx.ledger.crawl.evaluated ?? 'none'} of ${ctx.ledger.crawl.known ?? 'the'} known pages`];
  if (checks.length) parts.push(`${pass} of ${checks.length} technical checks that could be evaluated passed`);
  if (extraction != null) parts.push(`answers are ${extraction < 40 ? 'hard' : 'reasonably easy'} for engines to lift from them (extraction readiness ${extraction}/100)`);
  if (freshness != null) parts.push(freshness < 40 ? `the site shows little sign of regular updates (content freshness ${freshness}/100)` : `content is updated regularly (content freshness ${freshness}/100)`);
  return `${parts.join('; ')}. Short pages are judged by their purpose: a short legal page is normal.`;
}

/** The section's plain-English line, built only from what this run observed. */
function brandPlainEnglish(ctx: Context, kgState: string): string {
  const f = ctx.ledger.footprint;
  const parts: string[] = [];
  if (f) {
    const linked = f.profiles.confirmed + f.profiles.domainLinked;
    parts.push(f.profiles.total
      ? `${linked} of ${f.profiles.total} official profiles could be confirmed to link to the website${f.profiles.inaccessible ? ` (${f.profiles.inaccessible} could not be opened without signing in)` : ''}`
      : 'No official profile was found to check');
    parts.push(f.mentions.searched ? `${f.mentions.confirmed} independent mention${f.mentions.confirmed === 1 ? ' was' : 's were'} confirmed` : 'independent mentions were not searched');
    parts.push(f.reviews.searched ? `${f.reviews.listed} of ${f.reviews.checked} review and directory sites showed a confirmed listing` : 'review sites were not checked');
  }
  parts.push(kgState === 'measured' ? 'a knowledge-graph entry exists' : kgState === 'not_found' ? 'no knowledge-graph entry was found' : 'the knowledge-graph check did not complete');
  if (ctx.research?.independent.some((r) => r.kind === 'name_collision' && r.status === 'observed')) parts.push('and the name is easily confused with others in search');
  return `${cap(parts.join('; '))}. Backlinks were ${ctx.ledger.access.find((a) => a.family === 'backlinks')?.reason === 'measured' ? 'measured' : 'not measured'}.`;
}

// ── 4. Search & AI visibility ───────────────────────────────────────────────

/** Domain roles in search results. Only generic platforms and directories are named. */
const PLATFORMS = /(^|\.)(medium|linkedin|wikipedia|reddit|youtube|quora|facebook|instagram|x|twitter|britannica|theguardian|forbes|substack|github|builtin|ycombinator|cutshort|crunchbase|glassdoor|indeed|naukri|wellfound|angel|hackernoon|dev|hashnode|chatgpt|gemini|openai|google|ibm|nist|chromewebstore)\.[a-z.]{2,6}$/i;
const DIRECTORIES = /(^|\.)(g2|capterra|getapp|softwareadvice|trustradius|producthunt|alternativeto|saasworthy|softwaresuggest|crozdesk|sourceforge|techjockey|goodfirms|gartner)\.[a-z.]{2,6}$/i;
const domainRole = (d: string): { role: string; tone: Tone } =>
  (DIRECTORIES.test(d) ? { role: 'Software directory', tone: 'info' } : PLATFORMS.test(d) ? { role: 'Publishing / jobs platform', tone: 'neutral' } : { role: 'Not yet classified', tone: 'warn' });

const INTENT_LABEL: Record<string, string> = { branded: 'Brand name', category: 'Category', problem: 'Buyer problem', commercial: 'Commercial', use_case: 'Use case', comparison: 'Comparison' };

function searchMatrix(ctx: Context): string {
  const pack = ctx.research;
  if (!pack?.search.length) return '';
  const rows = pack.search;
  const validated = new Set(pack.competitors.filter((c) => ['direct', 'adjacent'].includes(String(c.classification))).map((c) => String(c.domain)));
  const own = ctx.domain.replace(/^www\./, '');
  const cols = [own, ...validated];
  const heat = heatmap(cols, rows.map((r) => ({
    label: String(r.query ?? r.claim),
    sub: INTENT_LABEL[String(r.intent)] ?? String(r.intent ?? ''),
    cells: cols.map((d, i): HeatCell => {
      if (r.status === 'failed_source') return { text: 'search failed', tone: 'low' };
      if (i === 0) {
        const pos = r.ownPosition;
        return pos != null ? { text: `#${pos}`, tone: pos <= 3 ? 'top' : pos <= 10 ? 'mid' : 'low' } : { text: `not in top ${r.depth ?? '—'}`, tone: 'absent' };
      }
      const idx = (r.topDomains ?? []).indexOf(d);
      return idx >= 0 ? { text: `#${idx + 1}`, tone: idx < 3 ? 'top' : 'mid' } : { text: '–', tone: 'unmeasured' };
    }),
  })));
  const depths = rows.map((r) => r.depth).filter((d): d is number => d != null);
  const ctxLine = `${cap(rows[0]?.engine ?? 'Search engine')} · ${rows[0]?.geography ?? 'geography not recorded'} · language ${rows[0]?.language ?? 'not recorded'} · ${fmtDate(rows[0]?.observedAt) ?? ''}${depths.length ? ` · ${Math.min(...depths)}–${Math.max(...depths)} results returned per query` : ''}`;
  return `<p class="v2-note">${e(ctxLine)}. Rows are buyer searches derived from ${e(ctx.brand)}’s own pages, grouped by intent; columns are ${e(ctx.brand)} and the validated competitors. A dash means the domain was not in that query’s results.</p>${heat}${heatLegend([
    { tone: 'top', label: 'Top 3' }, { tone: 'mid', label: 'Positions 4–10' }, { tone: 'absent', label: 'Not within the results returned' }, { tone: 'low', label: 'Search failed' },
  ])}`;
}


/** Question × AI tool: named / cited for buyer questions; correct / confused for brand-name ones. */
function aiAnswerGrid(ctx: Context): string {
  const gen = ctx.research?.generative.filter((r) => r.query && r.kind !== 'ai_overview') ?? [];
  const questions = [...new Set(gen.map((r) => String(r.query)))];
  // Every tool asked these questions, in the order first seen; tools never asked are left out.
  const surfaces = [...new Set(gen.map((r) => String(r.surface)))];
  if (!questions.length) return '';
  const grid = heatmap(surfaces, questions.map((q) => {
    const intent = gen.find((r) => r.query === q)?.intent;
    return {
      label: q, sub: INTENT_LABEL[String(intent)] ?? String(intent ?? ''),
      cells: surfaces.map((sf): HeatCell => {
        const r = gen.find((x) => x.query === q && x.surface === sf);
        if (!r) return { text: 'not asked', tone: 'unmeasured' };
        if (r.status === 'not_measured') return { text: 'not measured', tone: 'unmeasured', title: r.claim };
        if (r.status !== 'observed') return { text: 'no answer', tone: 'unmeasured', title: r.claim };
        if (r.accuracy === 'correct') return { text: r.cited ? 'correct, cites site' : 'correct', tone: 'top' };
        if (r.accuracy === 'partly') return { text: 'partly correct', tone: 'mid' };
        if (r.accuracy === 'misidentified') return { text: 'confused with another', tone: 'low' };
        return r.mentioned ? { text: r.cited ? 'named + cited' : 'named', tone: r.cited ? 'top' : 'mid' } : { text: 'not named', tone: 'absent' };
      }),
    };
  })) + heatLegend([
    { tone: 'top', label: 'Named / described correctly' }, { tone: 'mid', label: 'Partly' }, { tone: 'low', label: 'Confused with something else' },
    { tone: 'absent', label: 'Not named' }, { tone: 'unmeasured', label: 'Not measured / no answer' },
  ]);
  const unmeasured = [...new Set(gen.filter((r) => r.status === 'not_measured').map((r) => `${r.surface}: ${String(r.claim).replace(/^[^:]+:\s*/, '')}`))];
  return grid + (unmeasured.length ? `<p class="v2-note">${unmeasured.map(e).join('<br/>')}</p>` : '');
}

/** How often each brand is named across the AI answers to buyer questions. */
function aiShareOfVoice(ctx: Context): string {
  const answers = ctx.research?.generative.filter((r) => r.status === 'observed' && r.brandsNamed && r.query && !isBrandQuestion(r, ctx.brand)) ?? [];
  if (!answers.length) return '';
  const count = new Map<string, number>();
  for (const r of answers) for (const b of r.brandsNamed ?? []) count.set(b, (count.get(b) ?? 0) + 1);
  const rivals = [ctx.brand, ...(ctx.research?.competitors.filter((c) => ['direct', 'adjacent'].includes(String(c.classification))).map((c) => String(c.name)) ?? [])];
  const leaders = [...count.entries()].filter(([b]) => !rivals.includes(b)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b]) => b);
  const rows: BarRow[] = [...leaders, ...rivals].map((b) => {
    const n = count.get(b) ?? 0;
    const color = b === ctx.brand ? PALETTE.navy : rivals.includes(b) ? PALETTE.amber : PALETTE.blue;
    return { label: b, value: Math.round((100 * n) / answers.length), color, tag: `named in ${n} of ${answers.length} answers${rivals.includes(b) ? (b === ctx.brand ? ' · this company' : ' · validated competitor') : ''}` };
  });
  const unlisted = (ctx.research?.generative.filter((r) => r.status === 'observed' && !r.brandsNamed && r.query && !isBrandQuestion(r, ctx.brand)).length) ?? 0;
  return barChart(rows) + swatchLegend([[PALETTE.navy, ctx.brand], [PALETTE.amber, 'Validated competitors'], [PALETTE.blue, 'Most-named other brands']])
    + `<p class="v2-note">Share of the ${answers.length} AI answers to buyer questions that name each brand (0–100%). Brand names are read from each answer and counted only where they appear in the answer's own words.${unlisted ? ` ${unlisted} further answer${unlisted === 1 ? '' : 's'} (Google AI Overview) did not record brand names and ${unlisted === 1 ? 'is' : 'are'} not included here.` : ''}</p>`;
}

function aiCitedSources(ctx: Context): string {
  const r = ctx.research?.benchmark.find((x) => x.kind === 'ai_cited_sources');
  if (!r?.values) return '';
  return `<table class="v2-table v2-compact"><thead><tr><th>Site the AI answers cited</th><th style="width:20%">Answers citing it</th></tr></thead><tbody>${
    Object.entries(r.values).map(([d, v]) => `<tr><td>${e(d)}</td><td>${e(v.value)}</td></tr>`).join('')
  }</tbody></table><p class="v2-note">${e(r.gap ?? '')} ${r.recommends ? `Action: <span class="v2-id">${e(r.recommends.id)}</span>.` : ''}</p>`;
}

function generativeMatrix(ctx: Context): string {
  const pack = ctx.research;
  const cm = obj(obj(ctx.payload.ai_surface_presence)?.citation_matrix);
  const cells = objs(cm?.cells);
  const rows: string[] = [];
  if (pack) {
    const aio = pack.generative.filter((r) => r.kind === 'ai_overview');
    const read = aio.filter((r) => r.status === 'observed');
    const failed = aio.filter((r) => r.status === 'failed_source');
    // Only when overviews were actually requested: one denominator, retrieved + not retrieved.
    if (aio.length) {
      const [label, tone] = read.length === aio.length ? ['Measured', 'good' as Tone] : read.length ? ['Partly measured', 'info' as Tone] : ['Source failed', 'bad' as Tone];
      rows.push(`<tr><td><strong>Google AI Overview</strong><br/><small>retrieval-grounded, cites sources</small></td><td>${pill(label, tone)}</td><td>${read.length} of ${aio.length} retrieved · ${failed.length} not retrievable</td><td>${read.map((r) => `${e(r.query)}: ${r.mentioned ? 'mentioned' : 'not mentioned'}, ${r.cited ? 'cited' : 'not cited'} (${(r.citedDomains ?? []).length} sources)`).join('<br/>') || '—'}</td></tr>`);
    }
    // Surfaces the report run also checked are shown once, from the run's own cells.
    const covered = new Set(cells.map((c) => String(c.provider).toLowerCase()));
    const asked = new Set(pack.generative.filter((x) => x.query).map((x) => String(x.kind)));
    for (const kind of [...asked].filter((k) => k !== 'ai_overview')) {
      const rs = pack.generative.filter((x) => x.kind === kind);
      const ok = rs.filter((x) => x.status === 'observed');
      const buyerQs = ok.filter((x) => !isBrandQuestion(x, ctx.brand));
      const brandQs = ok.filter((x) => x.accuracy);
      const said = `${ctx.brand} named in ${buyerQs.filter((x) => x.mentioned).length} of ${buyerQs.length} buyer questions${brandQs.length ? `; asked by name: ${brandQs.filter((x) => x.accuracy === 'correct').length} correct, ${brandQs.filter((x) => x.accuracy === 'partly').length} partly, ${brandQs.filter((x) => x.accuracy === 'misidentified').length} confused` : ''}`;
      // State and wording come from the ledger, so this table and the access matrix cannot disagree.
      const row = ctx.ledger.ai.find((a) => a.label === rs[0].surface);
      const access = ctx.ledger.access.find((a) => a.capability === rs[0].surface);
      const reason = row?.reason ?? (ok.length ? 'measured' : 'request_failed');
      const [label, tone] = REASON_PILL[reason] ?? ['Unavailable', 'neutral' as Tone];
      const grounded = reason === 'measured' || reason === 'partial';
      rows.push(`<tr><td><strong>${e(rs[0].surface)}</strong><br/><small>${reason === 'no_adapter' ? 'no web-grounded access' : 'answers from live web search, cites sources'}</small></td><td>${pill(label, tone)}</td><td>${grounded ? `${ok.length} of ${rs.length} answered` : '—'}</td><td>${grounded ? `${e(said)}<br/><small>${e(rs[0].geography ?? '')}</small>` : `<small>${e(access?.outcome ?? '')}</small>`}</td></tr>`);
    }
    for (const r of pack.generative.filter((x) => !x.query && x.kind !== 'ai_overview' && !covered.has(String(x.kind).toLowerCase()) && !(x.kind === 'model_recall' && covered.size))) {
      const st = stateLabel(r.status);
      rows.push(`<tr><td><strong>${e(r.surface)}</strong></td><td>${pill(r.kind === 'model_recall' ? 'Excluded' : st.text, r.kind === 'model_recall' ? 'neutral' : st.tone)}</td><td>—</td><td><small>${e(r.claim)}</small></td></tr>`);
    }
  }
  return rows.length ? `<table class="v2-table"><thead><tr><th style="width:22%">AI search surface</th><th style="width:16%">State</th><th style="width:16%">Checks</th><th>What it showed</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
}

/** The report run's own AI answer-engine checks: one cell per provider × question type, by outcome. */
function aiGrid(ctx: Context): string {
  const cm = obj(obj(ctx.payload.ai_surface_presence)?.citation_matrix);
  const cells = objs(cm?.cells);
  if (!cells.length) return '';
  // Providers this report's research measured are shown there; the scoring run's older state is
  // superseded. The choice is the ledger's, so the grid and the access matrix cannot disagree.
  const all = [...new Set(cells.map((c) => String(c.provider)))];
  const runLabels = new Set(ctx.ledger.ai.filter((a) => a.source === 'report_run').map((a) => a.label));
  const providers = all.filter((p) => runLabels.has(PROVIDER_LABEL[p] ?? p));
  const dropped = all.filter((p) => !providers.includes(p)).map((p) => (PROVIDER_LABEL[p] ?? proper(p)).replace(/ \(.*\)$/, ''));
  const note = dropped.length ? `<p class="v2-note">Scoring run of ${e(ctx.generated)}. ${e(dropped.join(', '))} ${dropped.length === 1 ? 'is' : 'are'} not shown here: the public research in this report measured ${dropped.length === 1 ? 'it' : 'them'} more recently (see above and the access matrix in the appendix).</p>` : '';
  if (!providers.length) return note;
  const classes = [...new Set(cells.map((c) => String(c.query_class)))];
  return note + heatmap(classes.map((c) => cap(c.replace(/_/g, ' '))), providers.map((prov) => ({
    label: proper(prov),
    cells: classes.map((q): HeatCell => {
      const c = cells.find((x) => x.provider === prov && x.query_class === q);
      const reason = String(c?.reason_unavailable ?? '');
      if (c?.state === 'measured') return { text: `${Math.round((num(c.citation_rate) ?? 0) * 100)}% cited`, tone: 'top' };
      if (/not retrieval-grounded|model recall/i.test(reason)) return { text: 'answered, not grounded', tone: 'self', title: reason };
      if (/no queries derived/i.test(reason)) return { text: 'not run', tone: 'absent', title: reason };
      if (/failed to load|error/i.test(reason)) return { text: 'provider failed', tone: 'low', title: reason };
      if (/not configured/i.test(reason)) return { text: 'not configured', tone: 'unmeasured', title: reason };
      return { text: 'no result', tone: 'absent', title: reason };
    }),
  }))) + heatLegend([
    { tone: 'top', label: 'Grounded answer measured' }, { tone: 'self', label: 'Answered from memory (not counted)' },
    { tone: 'absent', label: 'Not run' }, { tone: 'low', label: 'Configured, failed' }, { tone: 'unmeasured', label: 'Not configured' },
  ]);
}

function renderSearch(ctx: Context): string {
  const r1 = ctx.payload.report1;
  const search = searchView(ctx);
  const gen = generativeView(ctx);
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  const disc = pillarOf(ctx, 'discoverability');
  const three = `<div class="v2-vis3">
    <div class="v2-vis v2-vis-warn"><div class="v2-vis-n">1</div><div><h4>Search visibility</h4><div class="v2-vis-value">${e(search?.line ?? 'Not measured')}</div><small>What search engines actually returned · ${e(search?.source ?? '')}</small></div></div>
    <div class="v2-vis v2-vis-warn"><div class="v2-vis-n">2</div><div><h4>Generative-search visibility</h4><div class="v2-vis-value">${e(gen.line)}</div><small>What AI search tools retrieved and cited · ${e(gen.note)}</small></div></div>
    <div class="v2-vis v2-vis-info"><div class="v2-vis-n">3</div><div><h4>Readiness</h4><div class="v2-vis-value">Discoverability ${disc?.value ?? '—'}${disc?.state === 'measured' ? '' : '*'} · extraction ${extraction?.value ?? '—'}/100</div><small>How well the site is built to be found and quoted · *inferred, not rankings</small></div></div>
  </div>
  <p class="v2-note">These are kept apart on purpose: a well-built site is not the same as a site that appears in results, and an AI model that has heard of a brand is not the same as an AI search tool that retrieves it today.</p>`;

  // The report run's own queries, when present.
  const sv = obj(r1?.search_visibility) ?? {};
  const obs = objs(sv.observations);
  const own = ctx.domain.replace(/^www\./, '');
  let runTable = '';
  let domainTable = '';
  if (obs.length) {
    const domainQueries = new Map<string, Set<string>>();
    for (const o of obs) for (const d of arr(o.competitorDomains)) {
      const k = String(d).replace(/^www\./, '');
      if (k === own) continue;
      if (!domainQueries.has(k)) domainQueries.set(k, new Set());
      domainQueries.get(k)!.add(String(o.query));
    }
    const ranked = [...domainQueries.entries()].sort((a, b) => b[1].size - a[1].size);
    const cols = ranked.slice(0, 5).map(([d]) => d);
    runTable = heatmap([own || 'this domain', ...cols], obs.map((o) => {
      const depth = num(o.resultCount);
      const pos = num(o.position);
      const present = new Set(arr(o.competitorDomains).map((d) => String(d).replace(/^www\./, '')));
      return {
        label: String(o.query ?? ''),
        sub: [str(o.queryClass)?.replace(/_/g, ' '), str(o.queryOrigin)?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
        cells: [
          pos != null ? { text: `#${pos}`, tone: pos <= 3 ? 'top' : pos <= 10 ? 'mid' : 'low' } as HeatCell : { text: depth ? `not in top ${depth}` : 'not found', tone: 'absent' } as HeatCell,
          ...cols.map((d): HeatCell => (present.has(d) ? { text: 'in results', tone: 'self' } : { text: '–', tone: 'unmeasured' })),
        ],
      };
    })) + heatLegend([
      { tone: 'top', label: 'Top 3' }, { tone: 'mid', label: 'Positions 4–10' }, { tone: 'absent', label: 'Not within the depth checked' }, { tone: 'self', label: 'Other domain present' },
    ]) + `<p class="v2-note">The report’s own run (${e(fmtDate(str(sv.observedAt)) ?? '')}) used queries built on the declared category; location and language were not recorded for it. ${ctx.research ? 'The public-research run above names its geography and language.' : ''}</p>`;
    const candidates = ranked.filter(([d]) => domainRole(d).role !== 'Publishing / jobs platform');
    domainTable = candidates.length ? `<table class="v2-table v2-compact"><thead><tr><th>Domain seen in results</th><th style="width:22%">Role</th><th class="v2-num" style="width:10%">Queries</th><th style="width:38%">Seen for</th></tr></thead><tbody>${
      candidates.slice(0, 10).map(([d, qs]) => { const r = domainRole(d); return `<tr><td><strong>${e(d)}</strong></td><td>${pill(r.role, r.tone)}</td><td class="v2-num">${qs.size}</td><td><small>${e([...qs].slice(0, 3).join(' · '))}</small></td></tr>`; }).join('')
    }</tbody></table><p class="v2-note">Appearing in results is all that is established for these domains; none is called a competitor unless validated (section 1). Publishing and jobs platforms are left out.</p>` : '';
  }

  return section(4, 'Search and AI visibility', 'Where does the brand appear when buyers search — in search engines and in AI search — and for which questions?',
    `${search ? `${search.line}. ` : ''}${gen.grounded ? `${gen.line}. ` : 'What AI search tools retrieve about the brand has not been measured yet. '}The website’s readiness score is a separate thing: it says the site could be found, not that it is.`, `
    ${block('Three kinds of visibility', null, three)}
    ${searchMatrix(ctx) ? block('Search results by buyer question', 'Where the brand and its validated competitors appeared, query by query.', searchMatrix(ctx), 'v2-allow-break') : ''}
    ${aiAnswerGrid(ctx) ? block('What AI search tools say, question by question', 'Each answer was built from live web sources the tool cites. Buyer questions: is the brand named? Brand-name questions: is it described correctly?', aiAnswerGrid(ctx), 'v2-allow-break') : ''}
    ${aiShareOfVoice(ctx) ? block('Who AI answers recommend instead', 'Brands named in the answers to buyer questions.', aiShareOfVoice(ctx)) : ''}
    ${aiCitedSources(ctx) ? block('Where AI answers get their information', null, aiCitedSources(ctx)) : ''}
    ${generativeMatrix(ctx) ? block('AI search tools checked', 'Only answers retrieved from the live web, with checkable sources, count as visibility. Answers from a model’s memory are excluded.', generativeMatrix(ctx)) : ''}
    ${aiGrid(ctx) ? block('AI answer engines checked by the report run', 'By provider and question type. Only a grounded answer counts; every other outcome is shown by its reason.', aiGrid(ctx)) : ''}
    ${runTable ? block('Queries checked by the report run', null, runTable, 'v2-allow-break') : ''}
    ${domainTable ? block('Domains seen in the report run’s results', null, domainTable) : ''}
  `);
}

// ── 5. Priorities & roadmap ─────────────────────────────────────────────────

const HORIZON_LABEL: Record<string, string> = { '0-30': 'Days 0–30', '31-60': 'Days 31–60', '61-90': 'Days 61–90', later: 'Later' };

function renderPlan(ctx: Context): string {
  const actions = ctx.registry.actions;
  const tier = (l: string | null): 0 | 1 | 2 | null => (l === 'low' ? 0 : l === 'medium' ? 1 : l === 'high' ? 2 : null);
  const toneOf = (a: DossierAction) => (a.kind === 'measurement' ? PALETTE.blue : a.confidence === 'high' ? PALETTE.green : a.confidence === 'low' ? PALETTE.amber : PALETTE.navy);
  const plotted: MatrixPoint[] = actions.filter((a) => tier(a.impact) != null && tier(a.effort) != null)
    .map((a) => ({ id: a.id, label: a.title, x: tier(a.effort)!, y: tier(a.impact)!, tone: toneOf(a) }));
  const unplotted = actions.filter((a) => tier(a.impact) == null || tier(a.effort) == null);
  const matrix = impactEffortMatrix(plotted)
    + swatchLegend([[PALETTE.green, 'High confidence'], [PALETTE.navy, 'Medium confidence'], [PALETTE.amber, 'Low confidence']])
    + `<p class="v2-note">Rubric: impact is each source's own rating — playbook expected impact; snapshot impact score (≥60 high, ≥35 medium); or a score lever's projected index gain (≥5 points high, ≥2 medium). Effort is the source's rating. ${unplotted.length ? `Not plotted because no source rated their impact or effort: ${unplotted.map((a) => a.id).join(', ')}.` : ''}</p>`;

  const register = `<table class="v2-table"><thead><tr><th style="width:4%">#</th><th>Action</th><th style="width:13%">Addresses</th><th style="width:13%">Impact · effort · confidence</th><th style="width:12%">Owner · window</th><th style="width:22%">Success test</th></tr></thead><tbody>${
    actions.map((a, i) => `<tr><td class="v2-num">${i + 1}</td>
      <td><strong>${e(a.title)}</strong> ${a.kind === 'measurement' ? pill('Measurement', 'info') : ''}<br/>${a.action !== a.title ? `<small>${e(a.action)}</small><br/>` : ''}<span class="v2-id">${e(a.id)}</span>${a.dependsOn.length ? `<br/><small>Prerequisite: ${a.dependsOn.map((d) => e(d)).join(', ')}</small>` : ''}${a.evidenceIds.length ? `<br/><small>Evidence: ${a.evidenceIds.map(e).join(', ')}</small>` : ''}</td>
      <td><small>${a.findingIds.map((f) => e(f)).join('<br/>') || '—'}</small></td>
      <td>${e(cap(a.impact ?? 'not rated'))} · ${e(a.effort ?? '—')} · ${e(a.confidence ?? '—')}</td>
      <td><small>${e(ownerOf(a))}</small><br/>${e(a.horizon ? HORIZON_LABEL[a.horizon] : '—')}${a.horizonBasis === 'effort' ? '<br/><small>from effort</small>' : ''}</td>
      <td><small>${e(a.verification ?? '—')}</small></td></tr>`).join('')
  }</tbody></table>
  <p class="v2-note">Ordered by each action's own source score, then lower effort and higher confidence; measurement actions follow improvements. Owners are not recorded: where a source named a team it is shown, otherwise "Unassigned". Windows marked "from effort" were not scheduled by a source (low effort: days 0–30, medium: 31–60, high: 61–90).</p>`;

  const win = (h: string | null): 0 | 1 | 2 => (h === '0-30' ? 0 : h === '61-90' || h === 'later' ? 2 : 1);
  const items: RoadmapItem[] = actions.map((a) => ({
    id: a.id, label: a.title, window: win(a.horizon), dependsOn: a.dependsOn, tone: toneOf(a),
    meta: [a.effort && `${a.effort} effort`, a.confidence && `${a.confidence} confidence`, a.kind === 'measurement' && 'measurement'].filter(Boolean).join(' · '),
  }));
  const empty = [0, 1, 2].filter((w) => !items.some((i) => i.window === w)).map((w) => ['Days 0–30', 'Days 31–60', 'Days 61–90'][w]);
  const map = roadmap(items, ['Days 0–30', 'Days 31–60', 'Days 61–90'])
    + (empty.length ? `<p class="v2-note">${e(empty.join(' and '))}: nothing scheduled. No action was scheduled there by a source or falls there by effort; the window is left empty rather than filled with generic work.</p>` : '');

  const levers = actions.filter((a) => a.lever).sort((a, b) => (b.lever!.overallGain - a.lever!.overallGain));
  const leverTable = levers.length ? `<table class="v2-table"><thead><tr><th>Dimension</th><th class="v2-num">Now</th><th class="v2-num">Target</th><th class="v2-num">Pillar gain</th><th class="v2-num">Index gain</th><th>Action</th></tr></thead><tbody>${
    levers.map((a) => `<tr><td>${e(a.lever!.dimension)}</td><td class="v2-num" style="color:${scoreColor(a.lever!.now)}">${a.lever!.now}</td><td class="v2-num">${a.lever!.target}</td><td class="v2-num">+${a.lever!.pillarGain}</td><td class="v2-num"><strong>+${a.lever!.overallGain}</strong></td><td><span class="v2-id">${e(a.id)}</span></td></tr>`).join('')
  }</tbody></table><p class="v2-note">Projected by re-running the report's own scoring with the dimension raised to its target; each gain is computed on its own. A projection is a hypothesis to test, not a forecast.</p>` : '';

  const pillarChart = barChart(ctx.pillars.map((p) => ({ label: p.label, value: p.value, tag: pillarTag(p), note: 'insufficient evidence' })));

  return section(5, 'Priorities and roadmap', 'What should happen first, in what order, and how will each step be verified?',
    'Start with the moves the evidence supports most and that unblock others; close the measurement gaps in parallel so the next report can show whether the changes worked.', `
    ${block('What drives the Authority Index', 'The five pillars behind the index. A pillar with no evidence has no value and is left out of the index, never scored as zero.', pillarChart)}
    ${block('Impact versus effort', 'Where each action sits by its stated impact and effort.', matrix)}
    ${block('Action register', `One register: ${actions.length} actions, each with one id. The summary pages, findings and roadmap all point here.`, register, 'v2-allow-break')}
    ${block('30/60/90-day roadmap', 'Arrows run from a prerequisite to the action that depends on it.', map)}
    ${leverTable ? block('Score levers', 'Where an action moves a weak dimension, the projected effect on the score.', leverTable) : ''}
  `);
}

// ── 6. Evidence appendix ────────────────────────────────────────────────────

const GLOSSARY: Array<[string, string]> = [
  ['SERP', 'Search engine results page: the list of results a search returns.'],
  ['Backlink', 'A link from another website to yours; search engines treat relevant ones as a vote of confidence.'],
  ['Structured data', 'Code on a page that labels facts (company, product, FAQ) so machines can read them reliably.'],
  ['Entity', 'A clearly identified organisation, product or person that engines can recognise across sources.'],
  ['Grounded AI answer', 'An answer an AI search tool built by searching the live web, with sources you can check.'],
  ['Model memory', 'What an AI model learned in training. It is not evidence of what buyers can find today.'],
  ['AI citation', 'A grounded answer that names or links to the brand.'],
  ['Crawl', 'An automated visit that fetches and reads the website\'s pages.'],
  ['Conversion', 'A visitor taking a desired next step, such as booking a demo.'],
  ['ICP', 'Ideal customer profile: the type of company most likely to buy and benefit.'],
];

const LADDER: Array<[string, string, string]> = [
  ['observed', 'Measured', 'Observed directly in this run (crawl, search results, a retrieved answer).'],
  ['independently_corroborated', 'Independently confirmed', 'Confirmed by a third-party source.'],
  ['company_declared', 'Company-declared', 'Stated by the company itself; context, not independent confirmation.'],
  ['inferred', 'Inferred', 'Estimated from related on-site evidence; directional, not a measurement.'],
  ['looked_for_not_found', 'Looked for, not found', 'A source was checked and did not return the item; not proof it does not exist.'],
  ['not_measured', 'Not measured', 'The source was not connected or the check was not run; no conclusion is drawn.'],
  ['failed_source', 'Source failed', 'A source errored; the result is unknown, not negative.'],
];

/**
 * Upstream check details count unobserved crawl addresses as "unreachable"; the crawl does not record
 * attempts, so the honest word is "not observed".
 */
export const notObservedWording = (text: string): string => text.replace(/\b(\d+) unreachable\b/gi, '$1 not observed');

function renderAppendix(ctx: Context): string {
  const p = ctx.payload;
  const r1 = p.report1;
  const pack = ctx.research;

  const ladder = `<table class="v2-table v2-compact"><tbody>${LADDER.map(([k, t, d]) => { const st = stateLabel(k); return `<tr><td style="width:24%">${pill(t, st.tone)}</td><td><small>${e(d)}</small></td></tr>`; }).join('')}</tbody></table>`;

  const researchRegister = pack ? (() => {
    const groups: Array<[string, ResearchRecord[]]> = [
      ['Company definition (official pages)', pack.company], ['Search results', pack.search], ['AI search answers', pack.generative],
      ['Competitor validation', pack.competitors], ['External footprint', pack.independent], ['Own-site checks', pack.site], ['Competitor benchmark', pack.benchmark],
    ];
    const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').split(/[?#]/)[0].slice(0, 48);
    const row = (r: ResearchRecord) => {
      const st = stateLabel(r.status);
      const text = r.query ? `${r.query} — ${r.claim}` : r.claim;
      return `<tr><td class="v2-id">${e(r.id)}</td><td>${e(text.length > 170 ? `${text.slice(0, 167)}…` : text)}</td><td>${e(st.text)}</td><td>${e(short(r.sourceUrl || '—'))}</td></tr>`;
    };
    return `<p class="v2-note">${e(pack.collector)} · collected ${e(fmtDate(pack.collectedAt) ?? pack.collectedAt)}. ${Object.entries(pack.method).map(([k, v]) => `${cap(k)}: ${v}`).map(e).join(' ')}</p>
    <table class="v2-table v2-register"><thead><tr><th style="width:9%">Id</th><th>Observation</th><th style="width:14%">State</th><th style="width:22%">Source</th></tr></thead><tbody>${
      groups.filter(([, rs]) => rs.length).map(([label, rs]) => `<tr class="v2-group"><td colspan="4">${e(label)} · ${e(rs[0].method)}</td></tr>${rs.map(row).join('')}`).join('')
    }</tbody></table>`;
  })() : '';

  const gapsList = pack?.gaps.length ? `<table class="v2-table v2-compact"><thead><tr><th style="width:36%">Open gap</th><th>Method to close it</th></tr></thead><tbody>${pack.gaps.map((g) => `<tr><td><strong>${e(g.claim)}</strong> <span class="v2-id">${e(g.id)}</span></td><td><small>${e(g.method)}</small></td></tr>`).join('')}</tbody></table>` : '';

  const findings = `<table class="v2-table"><thead><tr><th style="width:24%">Finding</th><th style="width:12%">State</th><th>Observation</th><th style="width:16%">Source</th><th style="width:18%">Actions</th></tr></thead><tbody>${
    ctx.registry.findings.map((f) => { const st = stateLabel(f.state); return `<tr><td><strong>${e(f.title)}</strong><br/><span class="v2-id">${e(f.id)}</span></td><td>${pill(st.text, st.tone)}</td><td><small>${e(f.observation)}</small></td><td><small>${e(f.source)}</small></td><td><small>${f.actionIds.map(e).join('<br/>') || '—'}</small></td></tr>`; }).join('')
  }</tbody></table>`;

  const groups = objs(obj(r1?.website_checks)?.groups);
  const checkRows = groups.flatMap((g) => objs(g.checks).map((c) => {
    const s = String(c.status);
    const tone: Tone = s === 'pass' ? 'good' : s === 'warn' || s === 'fail' ? 'warn' : 'neutral';
    const text = s === 'pass' ? 'Observed' : s === 'warn' ? 'Needs attention' : s === 'fail' ? 'Problem' : 'Not evaluated';
    return `<tr><td><small>${e(g.label)}</small></td><td>${e(c.label)}</td><td>${pill(text, tone)}</td><td><small>${e(notObservedWording(String(c.detail ?? '')))}</small></td></tr>`;
  })).join('');

  const audit = ctx.registry.audit;
  const auditBody = `<p>${audit.candidates} recommendations and evidence gaps arrived from ${Object.values(audit.bySource).filter((n) => n > 0).length} sources (${Object.entries(audit.bySource).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ')}). They resolve to ${audit.actions} actions; ${audit.merges.length} restatements were merged:</p>
    <table class="v2-table v2-compact"><thead><tr><th style="width:30%">Merged into</th><th style="width:18%">From</th><th>Restated as</th></tr></thead><tbody>${
      audit.merges.map((m) => `<tr><td class="v2-id">${e(m.into)}</td><td><small>${e(m.from.replace(/_/g, ' '))}</small></td><td><small>${e(m.title)}</small></td></tr>`).join('')
    }</tbody></table>`;

  const method = `<table class="v2-table"><tbody>
    <tr><td style="width:24%"><strong>Authority Index</strong></td><td>Geometric mean of the pillar scores that have a value. A pillar with no evidence is excluded, not counted as zero, so the index can rest on fewer than five pillars.</td></tr>
    <tr><td><strong>Pillar score</strong></td><td>Mean of the pillar's dimensions that have a value. Measured when observed; inferred when estimated from on-site evidence.</td></tr>
    <tr><td><strong>Discoverability</strong></td><td>Topical Authority (mean of an on-site topical score and the content-quality score) plus AI Surface Presence. With AI presence unmeasured it rests on the on-site part alone: readiness to be found, not observed rankings. Public search results and AI answers never feed it.</td></tr>
    <tr><td><strong>Index stage</strong></td><td>Foundational 0–24 · Emerging 25–39 · Developing 40–54 · Operational 55–69 · Advanced 70–84 · Leading 85–100.</td></tr>
    <tr><td><strong>Score bands</strong></td><td>Pillar and dimension scores use foundational 0–24 · developing 25–49 · operational 50–74 · leading 75+.</td></tr>
    <tr><td><strong>Evidence sources</strong></td><td>Six: crawl, content, backlinks, AI answers, competitors, reviews. Measured when the dimension each feeds has a measured value; partly when inferred.</td></tr>
    <tr><td><strong>Search visibility</strong></td><td>The search provider's own ranks for the listed queries, within the results returned. Not found within that depth is not a rank of zero and does not mean the site is not indexed.</td></tr>
    <tr><td><strong>Generative-search visibility</strong></td><td>Counts only answers retrieved from the live web with checkable sources. Answers from a model’s memory, failures and unconfigured tools are shown by reason and never counted.</td></tr>
    <tr><td><strong>Competitors</strong></td><td>Candidates from the brand’s own buyer searches; included only after checking each company’s own site for the same product, buyer and job. Label or name overlap is not enough.</td></tr>
  </tbody></table>`;

  const glossary = `<table class="v2-table v2-compact"><tbody>${GLOSSARY.map(([t, d]) => `<tr><td style="width:22%"><strong>${e(t)}</strong></td><td><small>${e(d)}</small></td></tr>`).join('')}</tbody></table>`;

  return section(6, 'Evidence appendix', 'What was observed, where it came from, and how the numbers are calculated.',
    'Everything needed to check a conclusion: each source and its age, every research observation with its id and link, the open gaps and how to close them, each finding, every website check, and how scores are calculated.', `
    ${block('Access reconciliation', 'Every source this report depends on: is there an adapter, is a credential present (yes / no only), was it attempted, what happened, and the cheapest compliant way to measure it.', accessMatrix(ctx), 'v2-allow-break')}
    <!--V2-VALIDATION-->
    ${block('Scoring inputs', 'The six inputs the Authority Index rests on, and whether each was measured. This is narrower than the access matrix above, which covers every source the report uses.', `<table class="v2-table v2-compact"><tbody>${ctx.sources.map((src) => {
      const tone: Tone = src.status === 'connected' ? 'good' : src.status === 'partial' ? 'info' : 'neutral';
      const label = src.status === 'connected' ? 'Measured' : src.status === 'partial' ? 'Partly (inferred)' : 'Not measured';
      return `<tr><td style="width:24%"><strong>${e(src.label)}</strong></td><td style="width:20%">${pill(label, tone)}</td><td><small>${e(cap(src.meaning))}. Counts as measured when ${e(src.feeds)} has a measured value.</small></td></tr>`;
    }).join('')}</tbody></table>`)}
    ${block('Evidence states', 'How strongly to read each label, from strongest to weakest. The same labels are used throughout.', ladder)}
    ${block('Where the evidence comes from', 'Conceptual: public, company-declared and private evidence, and which product uses which.', `${evidenceArchitecture()}<p class="v2-note">This report uses public and company-declared evidence only. Lead quality, conversion and revenue need private analytics or CRM data and are outside it.</p>`)}
    ${gapsList ? block('Unresolved gaps and how to close each', null, gapsList) : ''}
    ${researchRegister ? block('Public research register', 'Every research observation, with its id, source and method.', researchRegister, 'v2-allow-break') : ''}
    ${block('Findings register', 'Every finding once, with its state and the actions that address it.', findings, 'v2-allow-break')}
    ${checkRows ? block('Website checks', null, `<table class="v2-table v2-compact"><thead><tr><th style="width:16%">Area</th><th style="width:26%">Check</th><th style="width:16%">Outcome</th><th>Detail</th></tr></thead><tbody>${checkRows}</tbody></table>`, 'v2-allow-break') : ''}
    ${block('Duplication audit', 'How the action register was assembled.', auditBody, 'v2-allow-break')}
    ${block('Methodology', null, method)}
    ${block('Glossary', null, glossary)}
  `);
}

const REASON_PILL: Record<string, [string, Tone]> = {
  measured: ['Measured', 'good'], partial: ['Partly measured', 'info'], searched_not_found: ['Searched, not found', 'neutral'], not_searched: ['Not attempted', 'neutral'],
  missing_credential: ['Not configured', 'warn'], no_adapter: ['No supported access', 'neutral'], restricted: ['Sign-in / bot wall', 'warn'],
  request_failed: ['Configured, failed', 'bad'], quota_restricted: ['Quota / plan limit', 'bad'], ungrounded: ['Memory only', 'neutral'],
};

function accessMatrix(ctx: Context): string {
  const yn = (v: boolean | null) => (v === true ? 'yes' : v === false ? 'no' : '—');
  return `<table class="v2-table v2-compact v2-access"><thead><tr><th style="width:17%">Source</th><th style="width:7%">Adapter</th><th style="width:8%">Credential</th><th style="width:8%">Attempted</th><th style="width:14%">State</th><th>What happened</th><th style="width:20%">Cheapest compliant next step</th></tr></thead><tbody>${
    ctx.ledger.access.map((a) => {
      const [label, tone] = REASON_PILL[a.reason] ?? [a.reason, 'neutral' as Tone];
      return `<tr><td><strong>${e(a.capability)}</strong><br/><small>${a.source === 'research' ? 'public research' : 'report run'}</small></td><td>${yn(a.adapter)}</td><td>${yn(a.credential)}</td><td>${yn(a.attempted)}</td><td>${pill(label, tone)}</td><td><small>${e(a.outcome)}</small></td><td><small>${e(a.nextStep ?? '—')}</small></td></tr>`;
    }).join('')
  }</tbody></table><p class="v2-note">"Not configured" is a configuration fact; "searched, not found" needs a search that ran; "sign-in / bot wall" means the platform refused a signed-out visitor. Credentials are recorded as present or absent only.${ctx.research?.runtime ? ` Configuration checked ${e(fmtDate(ctx.research.runtime.checkedAt) ?? '')}.` : ' This report has no runtime configuration record, so configuration states come from the report run.'}</p>`;
}

function validationBlock(v: ValidationResult): string {
  const rows = v.issues.length
    ? `<table class="v2-table v2-compact"><thead><tr><th style="width:16%">Rule</th><th style="width:14%">Severity</th><th>Detail</th></tr></thead><tbody>${v.issues.map((i) => `<tr><td>${e(i.rule)}</td><td>${i.blocking ? pill('Blocking', 'bad') : pill('Advisory', 'warn')}</td><td><small>${e(i.detail)}</small></td></tr>`).join('')}</tbody></table>`
    : '';
  return block('Consistency check', v.passed ? 'Passed: no material contradiction found in counts, sources, scores or actions.' : 'Contradictions found — the conclusions below them should be read with care.',
    `<ul class="v2-list">${v.checks.map((c) => `<li><small>${e(c)}</small></li>`).join('')}</ul>${rows}`);
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function renderDossierV2Html(payload: CanonicalExportPayload, branding: DossierV2Branding = {}, research: unknown = null): string {
  const pack = parseResearchPack(research, branding.domain ?? null);
  const ctx = buildContext(payload, branding, pack);
  const footer = `${ctx.brand} · ${ctx.domain} · Digital intelligence dossier · ${ctx.generated}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>${e(ctx.brand)} — Digital intelligence dossier</title>
<style>${DOSSIER_V2_CSS.replace('var(--v2-footer, "")', JSON.stringify(footer.replace(/[\n\\]/g, ' ')))}</style></head>
<body data-dossier="v2">
${renderCover(ctx, branding)}
${renderSummaryNow(ctx)}
${renderSummaryNext(ctx)}
${renderMarket(ctx)}
${renderWebsite(ctx)}
${renderBrand(ctx)}
${renderSearch(ctx)}
${renderPlan(ctx)}
${renderAppendix(ctx)}
</body></html>`;
  // Validate the finished report against its own ledger; results are printed and logged.
  const validation = validateReport(ctx.ledger, ctx.registry, html, ctx.pillars, ctx.research);
  if (!validation.passed) console.warn('[dossier-v2] consistency check failed', { domain: ctx.domain, issues: validation.issues.filter((i) => i.blocking).map((i) => `${i.rule}: ${i.detail}`) });
  lastValidation = validation;
  return html.replace('<!--V2-VALIDATION-->', validationBlock(validation));
}

/** The consistency result of the most recent render in this process (for tests and diagnostics). */
export let lastValidation: ValidationResult | null = null;

export { buildDossierRegistry };
