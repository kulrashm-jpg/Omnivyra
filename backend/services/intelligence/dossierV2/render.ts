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
  PALETTE, barChart, entityGraph, funnel, heatLegend, heatmap, impactEffortMatrix, pill,
  roadmap, scoreColor, stackedRows,
  type BarRow, type FunnelStage, type GraphNode, type HeatCell, type MatrixPoint, type RoadmapItem,
} from './charts';
import { buildDossierRegistry, type DossierAction, type DossierFinding, type DossierRegistry } from './registry';
import { isBrandQuestion, isMarketingBasic, parseResearchPack, summariseVisibility, twoWayVisibility, type ResearchPack, type ResearchRecord } from './research';
import { DOSSIER_V2_CSS } from './styles';
import { AI_STATE_LABEL, aiCellState, aiStateOf, buildLedger, PROVIDER_LABEL, runCellOutcome, urlPurpose, type AccessRow, type AiState, type Ledger } from './ledger';
import { validateReport, type ValidationResult } from './validate';
import { buildDiagnostics, DIAG_LABEL, type DiagState, type SourceDiagnostic } from './diagnostics';
import { brandTokens, CAPABILITIES, capabilityState, scaleOf, shortlist, TIER_LABEL, type Candidate, type ScaleBand } from '../publicResearch/competitorDiscovery';

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
/** Plain words for stored labels written before the terminology pass ("Product line" → "Offering"). Display only. */
const plainTerm = (s: string): string => s.replace(/\bProduct lines\b/g, 'Offerings').replace(/\bProduct line\b/g, 'Offering');
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

/** Each section keeps one accent throughout (visual blueprint section map). */
const SECTION_ACCENT: Record<number, [string, string]> = {
  1: [PALETTE.blue, PALETTE.blueSoft], 2: [PALETTE.teal, PALETTE.tealSoft], 3: [PALETTE.purple, PALETTE.purpleSoft],
  4: [PALETTE.orange, PALETTE.orangeSoft], 5: [PALETTE.red, PALETTE.redSoft], 6: [PALETTE.navy, PALETTE.wash],
};

function section(n: number, title: string, question: string, plain: string, body: string): string {
  const [accent, soft] = SECTION_ACCENT[n] ?? [PALETTE.navy, PALETTE.wash];
  return `<section class="v2-section" id="s${n}" style="--sec:${accent};--sec-soft:${soft}">
  <div class="v2-section-top"><header class="v2-section-head"><span class="v2-section-num">${String(n).padStart(2, '0')}</span><div><h2>${e(title)}</h2><p>${e(question)}</p></div></header>
  <div class="v2-plain"><strong>In plain English:</strong> ${e(plain)}</div></div>
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
  /** One row per evidence source: state, cause, impact, next step (diagnostics.ts). */
  diagnostics: SourceDiagnostic[];
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
  const ledger = buildLedger(payload, research);
  const known = ledger.crawl.known;
  const read = ledger.crawl.evaluated;
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
    ledger,
    diagnostics: buildDiagnostics(ledger, research),
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
      // Buyer searches (no brand name) and brand-name searches are counted apart, as on page 2.
      line: `Found for ${v.found - v.brandedFound} of ${v.checked - v.branded} buyer searches${v.branded ? `; found for ${v.brandedFound} of ${v.branded} brand-name searches` : ''}`,
      source: `Google, ${v.geography ?? 'geography unrecorded'}, ${fmtDate(v.date) ?? ''} · public research`,
    };
  }
  const sv = obj(ctx.payload.report1?.search_visibility);
  const run = num(sv?.queriesRun);
  if (!run) return null;
  const ranked = num(sv?.queriesRanked) ?? 0;
  const example = runQueryExample(ctx);
  return { found: ranked, checked: run, line: `Found for ${ranked} of ${run} generic category searches checked`,
    source: `${str(sv?.provider) ?? 'search'} · ${fmtDate(str(sv?.observedAt)) ?? ''} · report run${example ? ` · queries such as “${example}”, built from the declared category label, not from buyer questions` : ''}` };
}

/** One of the report run's own search queries, verbatim, so its scope can be read. */
function runQueryExample(ctx: Context): string | null {
  return str(objs(obj(ctx.payload.report1?.search_visibility)?.observations)[0]?.query);
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
    const other = ctx.ledger.ai.filter((a) => a.state !== 'measured_grounded').map((a) => `${a.label.replace(/ \(.*\)$/, '')} ${AI_STATE_LABEL[a.state]}`);
    if (other.length) parts.push(other.join(', '));
    return { grounded, mentioned: g.buyerNamed, line: `Named in ${g.buyerNamed} of ${g.buyerAnswers} grounded AI answers to buyer questions`, note: `${g.surfaces.join(', ')} · ${parts.join(' · ')}` };
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
  <div class="v2-cover-brand">${branding.logoUrl ? `<img src="${e(branding.logoUrl)}" alt="${e(ctx.brand)}" onerror="this.style.display='none'"/>` : ''}<span class="v2-cover-eyebrow">${e(ctx.domain)} · Digital Snapshot</span></div>
  <h1>${e(ctx.brand)}: how it shows up in search and AI answers, and what to do first</h1>
  <p class="v2-cover-thesis">Four things a buyer’s first look depends on, each measured on its own and never blended into one score. Pages 2 and 3 explain them in plain English.</p>
  <div class="v2-cover-grid">${coverIndicators(ctx).join('')}</div>
  <div class="v2-cover-meta">
    <div>Stage<strong>${e(stage ?? '—')}</strong></div>
    <div>Authority Index<strong>${index ?? '—'}</strong><em>${index == null ? 'insufficient evidence — not zero' : `composite of ${scored(ctx).length} of ${ctx.pillars.length} pillars; method in the appendix`}</em></div>
    <div>Evidence sources measured<strong>${ctx.ledger.coverage.measured} of ${ctx.ledger.access.length}</strong>${ctx.ledger.coverage.partial ? `<em>${ctx.ledger.coverage.partial} partly</em>` : ''}</div>
    <div>Generated<strong>${e(ctx.generated)}</strong>${ctx.research ? `<em>Public research ${e(fmtDate(ctx.research.collectedAt) ?? ctx.research.collectedAt)}</em>` : ''}</div>
  </div>
</section>`;
}

/**
 * The cover's four indicators, each read from the same evidence as the pages that explain it:
 * organic search, AI answers, website readiness and the competitor shortlist. A source this run
 * could not measure is shown as "Not measured" with what was missing — never as a value.
 */
function coverIndicators(ctx: Context): string[] {
  const l = ctx.ledger;
  const card = (title: string, value: string, sub: string, visual: string, note: string, tone: 'ok' | 'warn' | 'bad' | 'none') =>
    `<div class="v2-cov-card v2-cov-card-${tone}"><div class="v2-cov-card-title">${e(title)}</div><div class="v2-cov-card-value">${value}</div><div class="v2-cov-card-sub">${e(sub)}</div>${visual}<div class="v2-cov-card-note">${e(note)}</div></div>`;
  const dots = (filled: number, total: number) => `<div class="v2-cov-dots">${Array.from({ length: Math.min(total, 24) }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('')}</div>`;
  const nm = (why: string | undefined) => `<span class="v2-cov-nm">Not measured</span>${why ? `<small>${e(why)}</small>` : ''}`;

  // 1. Organic search: Google results for searches buyers make without the name.
  const s = l.search;
  const brandObserved = s?.source === 'research' ? ctx.research?.search.filter((r) => r.status === 'observed' && isBrandQuestion(r, ctx.brand)).length ?? 0 : 0;
  const buyerSearches = s ? s.checked - brandObserved : 0;
  const searchFound = s ? s.found - s.brandedFound : 0;
  const searchCard = s && buyerSearches > 0
    ? card('Organic search', `${searchFound}<small> of ${buyerSearches}</small>`, s.source === 'research' ? 'buyer searches that returned the website' : 'generic category searches that returned the website',
      dots(searchFound, buyerSearches), `Google, ${fmtDate(s.date) ?? 'date not recorded'}; one search per query.`, searchFound === 0 ? 'bad' : 'warn')
    : card('Organic search', nm(ctx.diagnostics.find((d) => d.key === 'search')?.plain?.short), 'Google results for searches potential customers might make',
      '<div class="v2-cov-dots v2-cov-dots-none"></div>', 'Unknown, not zero: no search result was available to this run.', 'none');

  // 2. Visibility in AI answers: grounded answers to buyer questions that name the company.
  const t = l.aiTotals;
  const tools = l.ai.filter((a) => a.state === 'measured_grounded').length;
  const aiCard = t.buyerAnswers
    ? card('Visibility in AI answers', `${t.buyerNamed}<small> of ${t.buyerAnswers}</small>`, 'grounded AI answers to buyer questions that name the company',
      dots(t.buyerNamed, t.buyerAnswers), `${tools} of ${l.ai.length} AI tools measured; answers built from live web search.`, t.buyerNamed === 0 ? 'bad' : 'warn')
    : card('Visibility in AI answers', nm(topGaps(ctx, 1)[0]?.plain?.short), 'grounded AI answers to buyer questions', '<div class="v2-cov-dots v2-cov-dots-none"></div>', 'Unknown, not zero: no grounded AI answer was read.', 'none');

  // 3. Website readiness: how easily engines can lift an answer from the site (measured dimension).
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  const c = l.crawl;
  const speed = ctx.diagnostics.find((d) => d.key === 'pagespeed');
  const speedText = speed?.state === 'measured' ? 'Page speed measured.' : `Page speed not measured${speed?.plain?.short ? ` (${speed.plain.short})` : ''}.`;
  const webCard = extraction?.value != null
    ? card('Website readiness', `${extraction.value}<small> / 100</small>`, 'how easily search and AI engines can lift a clear answer from the site',
      `<div class="v2-cov-bar"><i style="width:${Math.max(2, extraction.value)}%;background:${scoreColor(extraction.value)}"></i></div>`,
      `${c.attempted != null && c.known != null ? `${c.attempted} of ${c.known} known addresses fetched. ` : ''}${speedText}`, extraction.value < 25 ? 'bad' : extraction.value < 50 ? 'warn' : 'ok')
    : card('Website readiness', nm(undefined), 'readiness of the site to be read and quoted', '<div class="v2-cov-bar"></div>', speedText, 'none');

  // 4. How the company compares with alternatives: the offering-first competitor shortlist.
  // Counts cover every confirmed competitor; the section-1 shortlist shows the first eight of them.
  const list = competitorShortlist(ctx, Number.MAX_SAFE_INTEGER);
  const n = (tier: string) => list.filter((x) => x.tier === tier).length;
  const peers = list.filter((x) => x.tier === 'direct_peer').map((x) => x.name);
  const TIERS: Array<[string, string]> = [['direct_peer', 'direct, same buyers'], ['direct_other', 'direct, larger or other buyers'], ['alternative', 'alternatives']];
  const compCard = list.length
    ? card('Competitive landscape', `${n('direct_peer') + n('direct_other')}<small> direct</small>`, `competitors confirmed on their own websites; ${n('alternative')} alternative${n('alternative') === 1 ? '' : 's'}`,
      `<div class="v2-cov-stack">${TIERS.filter(([k]) => n(k)).map(([k]) => `<span class="v2-cov-seg v2-cov-seg-${k}" style="flex:${n(k)}">${n(k)}</span>`).join('')}</div><div class="v2-cov-legend">${TIERS.filter(([k]) => n(k)).map(([k, label]) => `<span><i class="v2-cov-seg-${k}"></i>${e(label)}</span>`).join('')}</div>`,
      peers.length ? `Closest: ${peers.slice(0, 3).join(', ')}.` : 'No competitor of comparable size and buyer focus was confirmed.', 'warn')
    : card('Competitive landscape', nm(undefined), 'competitors confirmed on their own websites', '<div class="v2-cov-stack"></div>', 'No competitor was confirmed in this run.', 'none');
  return [searchCard, aiCard, webCard, compCard];
}

// ── Summary page 1 — What is happening? ─────────────────────────────────────

const REASON_TEXT: Record<string, string> = {
  measured: 'measured', partial: 'partly measured', not_searched: 'not attempted', restricted: 'blocked by sign-in or bot protection',
  no_adapter: 'no supported access', missing_credential: 'not connected', request_failed: 'request failed', quota_restricted: 'plan or quota limit',
  searched_not_found: 'searched, not found', ungrounded: 'answered from memory only',
};

const firstSentence = (t: string): string => (t.split(/(?<=\.)\s/)[0] ?? t).replace(/\.$/, '');

/** A diagnostic row's state in words, flagged when its cause is not established. */
const diagText = (d: SourceDiagnostic): string => `${DIAG_LABEL[d.state].toLowerCase()}${d.causeConfirmed ? '' : ' (cause unconfirmed)'}`;

/**
 * Visibility both ways: found (buyers who do not know the name) and recognised (searching the name, or
 * describing exactly what the company does). Each side shows only what was observed.
 */
function twoWayPanel(ctx: Context, compact: boolean): string {
  const t = twoWayVisibility(ctx.research);
  if (!t) return '';
  const b = ctx.brand;
  const r = t.recognised;
  const searchDiag = ctx.diagnostics.find((d) => d.key === 'search');
  const cited = ctx.research?.benchmark.find((x) => x.kind === 'ai_cited_sources');
  const drawOn = cited?.values ? Object.keys(cited.values).slice(0, 4) : [];
  const found = t.found
    ? [t.found.searchChecked ? `Google: on the first page for ${t.found.searchFound} of ${t.found.searchChecked} buyer searches` : null,
      t.found.searchChecked ? null : `Google buyer searches: not run — ${searchDiag?.plain?.short ?? 'no result observed'}`,
      t.found.aiAnswers ? `AI answers: named in ${t.found.aiNamed} of ${t.found.aiAnswers} answers to buyer questions` : null,
      drawOn.length ? `Those answers draw on ${drawOn.join(', ')}` : null].filter(Boolean) as string[]
    : [];
  const name = r.nameSearch
    ? `Google, searching “${r.nameSearch.query}”: ${r.nameSearch.ownPosition === 1 ? 'the website is the first result' : r.nameSearch.ownPosition ? `the website is at position ${r.nameSearch.ownPosition}` : 'the website is not on the first page'}${r.nameSearch.others.length && r.nameSearch.ownPosition !== 1 ? `; shown ${r.nameSearch.ownPosition ? 'above it' : 'instead'}: ${r.nameSearch.others.slice(0, 4).join(', ')}` : ''}; ${r.nameSearch.panel ? `knowledge panel “${r.nameSearch.panel.title}”${r.nameSearch.panel.matchesSite ? ' links to the site' : ' is not about this company'}` : 'no knowledge panel'} (${fmtDate(r.nameSearch.date) ?? ''})`
    : `Google name search: not run — ${searchDiag?.plain?.short ?? (r.nameSearchFailed ? 'request failed' : 'not attempted')}`;
  const acc = { correct: 0, partly: 0, misidentified: 0, unjudged: 0 };
  for (const a of r.aiByName) acc[a.accuracy ?? 'unjudged'] += 1;
  const byName = r.aiByName.length
    ? `AI tools, asked by name: described correctly in ${acc.correct} of ${r.aiByName.length}${acc.partly ? `, partly in ${acc.partly}` : ''}${acc.misidentified ? `, confused with something else in ${acc.misidentified}` : ''}`
    : 'AI tools, asked by name: no grounded answer read';
  const def = r.definitional
    ? `AI tools, asked for exactly what ${b} does (without the name): named in ${r.definitional.named} of ${r.definitional.answers}${r.definitional.named < r.definitional.answers && r.definitional.namedInstead.length ? `; named instead: ${r.definitional.namedInstead.slice(0, 4).join(', ')}` : ''}`
    : 'Definitional question: not asked in this run';
  const verdict = (() => {
    const knownByName = acc.correct > 0 && acc.misidentified === 0;
    const foundAny = (t.found?.aiNamed ?? 0) + (t.found?.searchFound ?? 0) > 0;
    if (!t.found && !r.aiByName.length) return '';
    if (knownByName && !foundAny) return `${b} is recognised when its name is used, but buyers who do not know the name are not shown it.`;
    if (!knownByName && r.aiByName.length) return `Even searching the name does not reliably return ${b}: the engines do not yet read the name as this company.`;
    if (foundAny) return `${b} is reached both ways in part; the gaps below show where not.`;
    return '';
  })();
  const q = r.definitional ? `<p class="v2-note">Definitional question asked: “${e(r.definitional.query)}”.</p>` : '';
  if (compact) return `<div class="v2-twoway"><div><b>Found — by buyers who do not know the name</b><ul>${(found.length ? found : ['Not observed in this run']).map((x) => `<li>${e(x)}</li>`).join('')}</ul></div><div><b>Recognised — when the name or an exact description is searched</b><ul><li>${e(name)}</li><li>${e(byName)}</li><li>${e(def)}</li></ul></div></div>${verdict ? `<p class="v2-note"><b>${e(verdict)}</b></p>` : ''}`;
  return `<table class="v2-table v2-compact"><thead><tr><th style="width:26%">Test</th><th>What was observed</th></tr></thead><tbody>
    <tr><td><strong>Found</strong><br/><small>buyers who do not know the name</small></td><td>${(found.length ? found : ['Not observed in this run']).map((x) => e(x)).join('<br/>')}</td></tr>
    <tr><td><strong>Recognised by name</strong><br/><small>the name typed into Google and asked of AI tools</small></td><td>${e(name)}<br/>${e(byName)}</td></tr>
    <tr><td><strong>Recognised by description</strong><br/><small>what the company does, described exactly, without the name</small></td><td>${e(def)}</td></tr>
  </tbody></table>${q}${verdict ? `<p class="v2-note"><b>${e(verdict)}</b> A company searched by name should come first with its own site and a panel about it; a company described exactly should be among the answers.</p>` : ''}`;
}

/** Coverage-strip family → the diagnostic row that explains it when it is not measured. */
const CHIP_DIAG: Partial<Record<AccessRow['family'], string>> = { search: 'search', backlinks: 'family:inbound_links', page_speed: 'pagespeed' };

/** Missing data in the reader's terms: what was missing, what provides it, who acts. */
function missingDataTable(ctx: Context): string {
  const rows = ctx.diagnostics.filter((d) => d.plain);
  if (!rows.length) return '';
  const BY: Record<NonNullable<SourceDiagnostic['plain']>['by'], [string, Tone]> = { company: ['Your input', 'warn'], 'next run': ['Next run', 'info'], 'report operator': ['Report setup', 'neutral'] };
  return `<table class="v2-table v2-compact"><thead><tr><th style="width:19%">Source</th><th>What was missing</th><th style="width:34%">What gets it measured</th><th style="width:12%">Who acts</th></tr></thead><tbody>${
    rows.map((d) => { const [t, tone] = BY[d.plain!.by]; return `<tr data-diag="${e(d.key)}"><td><strong>${e(d.source.replace(/ \(.*\)$/, ''))}</strong></td><td><small>${e(d.plain!.why)}</small></td><td><small>${e(d.plain!.unlock)}</small></td><td>${pill(t, tone)}</td></tr>`; }).join('')
  }</tbody></table><p class="v2-note">Each row lacked the data or access it needs, not a method. Until it is provided the row stays unknown — never scored as zero.</p>`;
}

/** The gaps that matter most to the conclusions: AI tools and search first, then backlinks and reviews. */
function topGaps(ctx: Context, n: number): SourceDiagnostic[] {
  const rank = (d: SourceDiagnostic) => (d.family === 'AI answers' ? 0 : d.key === 'search' ? 1 : d.key === 'family:inbound_links' ? 2 : 3);
  return ctx.diagnostics.filter((d) => !['measured', 'partial', 'searched_not_found'].includes(d.state)).sort((a, b) => rank(a) - rank(b)).slice(0, n);
}

/** An access row's state in words; AI tools use the AI vocabulary. */
const reasonText = (a: AccessRow): string => (a.family === 'ai_answers' ? AI_STATE_LABEL[aiStateOf(a.reason)] : REASON_TEXT[a.reason] ?? a.reason);

/** Confidence from how much of the evidence was actually measured. */
function confidenceOf(l: Ledger): { level: 'Low' | 'Moderate' | 'High'; note: string } {
  // Per evidence family, so a family with many rows (the website) cannot outweigh one with few (search).
  const fams = [...new Set(l.access.map((a) => a.family))];
  const state = (f: AccessRow['family']) => {
    const rows = l.access.filter((a) => a.family === f);
    return rows.every((a) => a.reason === 'measured') ? 1 : rows.some((a) => a.reason === 'measured' || a.reason === 'partial') ? 0.5 : 0;
  };
  const full = fams.filter((f) => state(f) === 1).length;
  const part = fams.filter((f) => state(f) === 0.5).length;
  const share = (full + part / 2) / (fams.length || 1);
  return { level: share >= 0.7 ? 'High' : share >= 0.45 ? 'Moderate' : 'Low', note: `${full} of ${fams.length} evidence families fully measured, ${part} partly` };
}

/** The one-sentence situation, chosen from the evidence. */
function headlineOf(ctx: Context): string {
  const l = ctx.ledger;
  // Only searches a buyer would type count: the report run's generic category-label queries do not.
  const searchMiss = l.search?.source === 'research' ? l.search.found - l.search.brandedFound === 0 : null;
  const aiMiss = l.aiTotals.buyerAnswers ? l.aiTotals.buyerNamed === 0 : null;
  if (searchMiss && aiMiss) return `Buyers did not find ${ctx.brand} in ${l.search!.checked - (ctx.research?.search.filter((r) => r.status === 'observed' && isBrandQuestion(r, ctx.brand)).length ?? 0)} Google searches or ${l.aiTotals.buyerAnswers} AI answers.`;
  if (aiMiss) return `In ${l.aiTotals.buyerAnswers} AI answers to buyer questions, ${ctx.brand} was not named — other tools were.`;
  if (searchMiss) return `Buyers searching for the problem ${ctx.brand} solves do not find it in the results checked.`;
  return `${ctx.brand} is visible for some buyer questions; the gaps below show where it is not.`;
}

function renderSummaryNow(ctx: Context): string {
  const l = ctx.ledger;
  const conf = confidenceOf(l);
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  // Each indicator: value, what it counts (definition), and how far to trust it (confidence).
  const tile = (title: string, value: string, sub: string, tone: Tone, extra = '', def = '', confidence = '') =>
    `<div class="v2-ind v2-ind-${tone}"><div class="v2-ind-title">${e(title)}</div><div class="v2-ind-value">${value}</div><div class="v2-ind-sub">${e(sub)}</div>${extra}${def ? `<div class="v2-ind-def">${e(def)}</div>` : ''}${confidence ? `<div class="v2-ind-conf">Confidence: ${e(confidence)}</div>` : ''}</div>`;
  const nm = '<span class="v2-nm">Not measured</span>';

  const s = l.search;
  const buyerSearches = s ? s.checked - (s.source === 'research' ? (ctx.research?.search.filter((r) => r.status === 'observed' && isBrandQuestion(r, ctx.brand)).length ?? 0) : 0) : 0;
  const example = runQueryExample(ctx);
  const searchTile = s
    ? tile('Search', `${s.found - s.brandedFound}<small> of ${buyerSearches}</small>`,
      s.source === 'research'
        ? `buyer searches that returned the website${s.brandedFound ? '; found when the name is searched' : ''}`
        : 'generic searches by the report run that returned the website',
      s.source === 'research' ? (s.found - s.brandedFound === 0 ? 'bad' : 'warn') : 'neutral', '',
      s.source === 'research' ? `Google results for searches a buyer would type, without the name (${s.geography ?? 'geography not recorded'}, ${fmtDate(s.date) ?? 'date not recorded'}).`
        : `Queries built from the declared category label${example ? ` (e.g. “${example}”)` : ''}, not from buyer questions; location and language not recorded.`,
      s.source === 'research' ? 'medium — one search per query, one day' : 'low — generic queries')
    : tile('Search', nm, ctx.diagnostics.find((d) => d.key === 'search')?.plain?.why ?? 'No search results were observed in this run.', 'neutral', '', 'Search results for buyer queries.', 'none — unknown, not zero');
  const aiList = l.ai.filter((a) => a.source === 'research' || a.state !== 'not_configured').slice(0, 7)
    .map((a) => `<li class="v2-ai-${a.state}"><span>${e(a.label.replace(/ \(.*\)$/, ''))}</span><b>${a.state === 'measured_grounded' ? `${a.buyerNamed}/${a.buyerAnswers}` : e(AI_STATE_LABEL[a.state])}</b></li>`).join('');
  const aiTools = l.ai.filter((a) => a.state === 'measured_grounded').length;
  const aiTile = l.aiTotals.buyerAnswers
    ? tile('AI answers', `${l.aiTotals.buyerNamed}<small> of ${l.aiTotals.buyerAnswers}</small>`, 'grounded answers to buyer questions that name the company', l.aiTotals.buyerNamed ? 'warn' : 'bad', `<ul class="v2-ind-list">${aiList}</ul>`,
      `${l.aiTotals.attemptedCalls} questions sent → ${l.aiTotals.groundedAnswers} grounded answers → ${l.aiTotals.buyerAnswers} to buyer questions. API answers with live web search, not the consumer apps; one run.`,
      `${aiTools >= 3 ? 'medium' : 'low'} — ${aiTools} of ${l.ai.length} tools measured`)
    : tile('AI answers', nm, 'No AI answer built from live web search was read.', 'neutral', aiList ? `<ul class="v2-ind-list">${aiList}</ul>` : '', 'Grounded AI answers to buyer questions.', 'none — unknown, not zero');
  const c = l.crawl;
  const webTile = c.known != null
    ? tile('Website readiness', `${extraction?.value ?? '—'}<small> / 100</small>`, 'how easily engines can lift a clear answer from the site', (extraction?.value ?? 0) < 25 ? 'bad' : 'warn', '',
      c.attempted != null
        ? `From ${c.evaluated ?? 0} pages read: ${c.attempted} of ${c.known} known addresses fetched; ${c.notAttempted} never fetched (analytics only).`
        : `From ${c.evaluated ?? 0} pages read of ${c.known} known addresses; ${c.notObserved ?? 0} not observed, attempt status unknown.`,
      c.attempted != null && c.outcomes && c.outcomes.read === c.attempted ? 'medium — every fetched page read' : 'low — part of the site not observed')
    : tile('Website readiness', nm, 'No crawl was recorded.', 'neutral', '', 'Readiness of the site to be read and quoted.', 'none — unknown, not zero');
  const f = l.footprint;
  const fpTile = f
    ? tile('External footprint', `${f.profiles.confirmed + f.profiles.domainLinked}<small> of ${f.profiles.total}</small>`, `official profiles confirmed to link to the website; ${f.mentions.confirmed} independent mention${f.mentions.confirmed === 1 ? '' : 's'} confirmed`, f.mentions.confirmed ? 'warn' : 'bad', '',
      `Profiles opened signed out${f.profiles.inaccessible ? ` (${f.profiles.inaccessible} behind a sign-in wall)` : ''}; mentions from one web search. ${cap(backlinkPhrase(ctx))}.`,
      'low — one web search')
    : tile('External footprint', nm, 'Profiles and mentions were not checked in this run.', 'neutral', '', 'Official profiles, independent mentions and listings.', 'none — unknown, not zero');
  const revTile = f && f.reviews.searched
    ? tile('Reviews & listings', `${f.reviews.listed}<small> of ${f.reviews.checked}</small>`, `review and directory sites with a confirmed listing${f.reviews.claimed ? `; ${f.reviews.claimed} reported but not confirmable` : ''}`, f.reviews.listed ? 'warn' : 'bad', '',
      'Counts only a listing whose page names the company; not found in search is not proof of absence.', 'low — search-based')
    : tile('Reviews & listings', nm, 'No review source was checked.', 'neutral', '', 'Independent ratings and directory listings.', 'none — unknown, not zero');
  const confTile = tile('How sure is this?', `${conf.level}`, conf.note, conf.level === 'High' ? 'good' : conf.level === 'Moderate' ? 'warn' : 'bad', '',
    'Share of the sources this report depends on that were measured; the rest are unknown, not zero.');
  const indicators = `<div class="v2-inds">${searchTile}${aiTile}${webTile}${fpTile}${revTile}${confTile}</div>`;

  // The discovery path: only routes this run actually tested.
  const surfaces = [
    ...(s ? [{ name: s.source === 'research' ? 'Google search' : 'Google (generic queries)', res: `found ${s.found - s.brandedFound}/${buyerSearches}` }] : []),
    ...l.ai.filter((a) => a.reason === 'measured' || a.reason === 'partial').map((a) => ({ name: a.label.replace(/ \(.*\)$/, ''), res: `named ${a.buyerNamed}/${a.buyerAnswers}` })),
  ];
  const cited = ctx.research?.benchmark.find((r) => r.kind === 'ai_cited_sources');
  const topSources = cited?.values ? Object.keys(cited.values).slice(0, 4) : [];
  const citedAnswers = ctx.research?.generative.filter((g) => g.status === 'observed' && g.cited && g.query) ?? [];
  const ownCited = citedAnswers.length;
  const buyerCited = citedAnswers.filter((g) => !isBrandQuestion(g, ctx.brand)).length;
  const citedScope = !ownCited ? '' : buyerCited ? ` (${buyerCited} to buyer questions)` : ' (all to questions naming the company)';
  const path = surfaces.length ? `<div class="v2-path">
    <div class="v2-path-step"><b>1 · The buyer asks</b><span>${e(String(new Set(ctx.research?.generative.filter((g) => g.query && !isBrandQuestion(g, ctx.brand)).map((g) => g.query)).size || 0))} questions a buyer would type, without the company name${s && s.source !== 'research' ? `; plus ${e(String(buyerSearches))} generic category searches` : s ? ` and ${e(String(buyerSearches))} searches` : ''}</span></div><i>›</i>
    <div class="v2-path-step"><b>2 · Where they ask</b><ul>${surfaces.map((x) => `<li>${e(x.name)} <em>${e(x.res)}</em></li>`).join('')}</ul></div><i>›</i>
    <div class="v2-path-step"><b>3 · What they are shown</b><span>${topSources.length ? `Answers draw on ${e(topSources.join(', '))}` : 'Sources were not recorded'}</span></div><i>›</i>
    <div class="v2-path-step"><b>4 · What they find about ${e(ctx.brand)}</b><span>Website cited in ${ownCited} answer${ownCited === 1 ? '' : 's'}${citedScope}${f ? `; ${f.profiles.confirmed + f.profiles.domainLinked} profile${f.profiles.confirmed + f.profiles.domainLinked === 1 ? '' : 's'} linked; ${f.mentions.confirmed} third-party mention${f.mentions.confirmed === 1 ? '' : 's'}` : ''}</span></div>
  </div>` : '';

  // Strongest finding and largest uncertainty.
  const answers = ctx.research?.generative.filter((r) => r.status === 'observed' && r.brandsNamed && r.query && !isBrandQuestion(r, ctx.brand)) ?? [];
  // One company, one bar: product names of the same company ("HubSpot", "HubSpot CRM") count once per answer.
  const counts = new Map<string, number>();
  const shown = new Map<string, string>();
  for (const r of answers) {
    for (const k of new Set((r.brandsNamed ?? []).map((b) => { const key = brandTokens(b).first || b.toLowerCase(); if (!shown.has(key) || b.length < shown.get(key)!.length) shown.set(key, b); return key; }))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const leaders = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => [shown.get(k) ?? k, n] as [string, number]);
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
  const gapRows = topGaps(ctx, 5);
  const uncertainty = `<div class="v2-panel"><h4>Largest uncertainty: data this run did not have</h4><ul class="v2-unk">${gapRows.map((d) => `<li data-diag="${e(d.key)}"><b>${e(d.source.replace(/ \(.*\)$/, ''))}</b><span>${e(d.plain?.short ?? diagText(d))}</span></li>`).join('') || (gaps.length ? '' : '<li><span>Every planned source was reached.</span></li>')}</ul><small>Each is missing data or access, not a missing check; unknown is not zero. What gets each one measured: “Missing data” in section 5.</small></div>`;

  const families: Array<[string, AccessRow['family'][]]> = [['Website', ['website']], ['Search', ['search']], ['AI answers', ['ai_answers']], ['Social', ['social']], ['Mentions', ['mentions']], ['Reviews', ['reviews']], ['Links to the site', ['backlinks']], ['Knowledge graph', ['knowledge_graph']], ['Registry', ['registry']], ['Page speed', ['page_speed']]];
  const chip = ([name, fams]: [string, AccessRow['family'][]]) => {
    const rows = l.access.filter((a) => fams.includes(a.family));
    if (!rows.length) return '';
    const m = rows.filter((a) => a.reason === 'measured').length;
    const p = rows.filter((a) => a.reason === 'partial' || a.reason === 'searched_not_found').length;
    const state = m === rows.length ? 'good' : m || p ? 'info' : 'neutral';
    // A grey chip names what was missing, so "not measured" never reads as "not able to".
    const gap = state === 'neutral' ? ctx.diagnostics.find((d) => d.plain && d.key === (CHIP_DIAG[fams[0]] ?? `family:${fams[0]}`))?.plain?.short : null;
    return `<span class="v2-cov v2-cov-${state}">${e(name)}<em>${state === 'good' ? 'measured' : state === 'info' ? 'partial' : gap ? e(gap) : 'not measured'}</em></span>`;
  };
  const fresh = [l.search?.source === 'research' && l.search.date ? `Google searches ${fmtDate(l.search.date)}` : null, ctx.research ? `public research ${fmtDate(ctx.research.collectedAt)}` : null, l.crawl.lastCrawledIso ? `website crawl ${fmtDate(l.crawl.lastCrawledIso)}` : null, `report ${ctx.generated}`].filter(Boolean).join(' · ');
  const strip = `<div class="v2-covstrip">${families.map(chip).join('')}</div><p class="v2-fresh">Evidence dates: ${e(fresh)}.</p>`;

  return `<section class="v2-summary" id="summary-now">
  <header class="v2-summary-head"><span>Summary 1 of 2</span><h2>What is happening?</h2></header>
  <p class="v2-headline">${e(headlineOf(ctx))}</p>
  ${indicators}
  ${twoWayPanel(ctx, true) ? `<h3 class="v2-summary-h">Found, and recognised: visibility both ways</h3>${twoWayPanel(ctx, true)}` : ''}
  ${path && !twoWayPanel(ctx, true) ? `<h3 class="v2-summary-h">How a buyer looks — and what they find</h3>${path}` : ''}
  <div class="v2-cols v2-tight v2-sf">${strongest}${uncertainty}</div>
  <h3 class="v2-summary-h">How much was measured <small class="v2-h-key">green: measured · blue: partly · white: not measured, with what was missing</small></h3>
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
    { key: 'discover', title: 'Get found in the searches customers make', outcome: `Buyers who search for the problem — not the name — start to find ${ctx.brand}.`, actions: [] },
    { key: 'proof', title: 'Build independent proof and measure again', outcome: `Others vouch for ${ctx.brand}, and the next report can show what changed.`, actions: [] },
  ];
  for (const a of actions) lanes.find((l) => l.key === laneOf(a))!.actions.push(a);
  const titleOf = (id: string) => actions.find((x) => x.id === id)?.title ?? null;
  const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t);
  // Evidence-supported: rests on a measured observation; partly: inferred only; otherwise a hypothesis to test.
  const findingState = (a: DossierAction) => ctx.registry.findings.filter((f) => a.findingIds.includes(f.id) || f.actionIds.includes(a.id)).map((f) => f.state);
  const basisOf = (a: DossierAction): [string, Tone] =>
    a.kind === 'measurement' ? ['Blocked until access', 'warn']
      : a.evidenceIds.length || a.evidence.some((x) => x.state === 'measured') || findingState(a).includes('measured') || a.lever ? ['Evidence', 'good']
        : a.evidence.some((x) => x.state === 'inferred') || findingState(a).includes('inferred') ? ['Partly inferred', 'info'] : ['Hypothesis', 'neutral'];
  const LANE_OWNER: Record<Lane['key'], string> = { foundation: 'web / engineering', discover: 'content', proof: 'marketing' };
  const order = (a: DossierAction) => ['0-30', '31-60', '61-90', 'later'].indexOf(a.horizon ?? 'later');
  const laneCard = (lane: Lane, i: number) => {
    const sorted = [...lane.actions].sort((a, b) => order(a) - order(b) || (b.priority ?? 0) - (a.priority ?? 0));
    const shown = sorted.slice(0, 2);
    const deps = lane.actions.flatMap((a) => a.dependsOn).filter((d) => !lane.actions.some((x) => x.id === d));
    const depLane = [...new Set(deps.map((d) => actions.find((x) => x.id === d)).filter(Boolean).map((x) => lanes.find((l) => l.key === laneOf(x!))!.title))];
    const row = (a: DossierAction) => {
      const [basis, tone] = basisOf(a);
      // Executive page: evidence ids stay in the register, not in the sentences.
      const clean = (t: string) => t.replace(/\s*\((?:[^()]*\b[EAF]-[A-Za-z]+-[A-Za-z0-9-]+[^()]*)\)/g, '').replace(/\b[EF]-[A-Z]{3}-\d{2}\b,?\s*/g, '').trim();
      const dep = a.dependsOn.map(titleOf).filter((t): t is string => Boolean(t));
      return `<tr><td><strong>${e(short(a.title.replace(/^Measure: /, 'Measure '), 90))}</strong><br/>${pill(basis, tone)}</td>
        <td><small>${e(short(clean(a.why ?? a.action), 115))}</small></td>
        <td><small>${a.owner ? `${e(proper(a.owner))} team` : `Not set<br/><em>suggested: ${e(LANE_OWNER[lane.key])}</em>`}</small></td>
        <td><small>${dep.length ? e(short(dep.join('; '), 70)) : 'None'}</small></td>
        <td><small>${e(short(clean(a.verification ?? 'Not defined by any source.'), 105))}</small></td>
        <td><small>${e(a.horizon ? HORIZON_LABEL[a.horizon] : '—')}${a.horizonBasis === 'effort' ? '<br/><em>from effort</em>' : ''}</small></td></tr>`;
    };
    return `<div class="v2-lane v2-lane-${lane.key}">
      <div class="v2-lane-head"><span>${i + 1}</span><div><h4>${e(lane.title)}</h4><p>${e(lane.outcome)}${depLane.length ? ` <em>Waits on: ${e(depLane.join(', '))}.</em>` : ''}</p>${laneEvidence(ctx, lane.key) ? `<p class="v2-lane-ev"><b>Evidence:</b> ${e(laneEvidence(ctx, lane.key)!)}</p>` : ''}</div></div>
      ${shown.length ? `<table class="v2-lane-table"><thead><tr><th style="width:24%">Action</th><th>Business reason</th><th style="width:11%">Owner</th><th style="width:13%">Depends on</th><th style="width:21%">Success measure</th><th style="width:9%">Window</th></tr></thead><tbody>${shown.map(row).join('')}</tbody></table>${lane.actions.length > 2 ? `<p class="v2-more">and ${lane.actions.length - 2} more in the action register (section 5)</p>` : ''}` : '<p class="v2-note">No action fell in this lane.</p>'}
    </div>`;
  };

  const blocked = ctx.diagnostics.filter((d) => d.needs.length && !['measured', 'partial', 'searched_not_found'].includes(d.state));
  const blockedStrip = blocked.length ? `<div class="v2-blocked"><h4>Waiting on data or access <small>· who provides each: “Missing data”, section 5</small></h4><ul>${blocked.slice(0, 6).map((d) => `<li data-diag="${e(d.key)}"><b>${e(d.source.replace(/ \(.*\)$/, ''))}</b> — ${e(d.plain?.short ?? diagText(d))}. <span>${e(d.plain ? ({ company: 'Your input', 'next run': 'Next run', 'report operator': 'Report setup' } as const)[d.plain.by] : `Needs ${d.needs.join(', ')}`)}.</span></li>`).join('')}</ul></div>` : '';

  return `<section class="v2-summary" id="summary-next">
  <header class="v2-summary-head"><span>Summary 2 of 2</span><h2>What should happen next?</h2></header>
  <p class="v2-headline">Three lanes that can run side by side; a lane that waits on another says so.</p>
  <div class="v2-lanes">${lanes.map(laneCard).join('')}</div>
  ${blockedStrip}
  <p class="v2-note">Two actions per lane, earliest first. <b>Evidence</b>: rests on a measured finding · <b>hypothesis</b>: to test · <b>blocked until access</b>: needs the source below first. Unnamed owners: the lane's usual team is suggested.</p>
</section>`;
}

/** The measured evidence each lane rests on, in one line, from the ledger and the dimension scores. */
function laneEvidence(ctx: Context, key: Lane['key']): string | null {
  const l = ctx.ledger;
  const dim = (k: string) => ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === k)?.value ?? null;
  const parts: string[] = [];
  if (key === 'foundation') {
    if (dim('extraction_readiness') != null) parts.push(`extraction readiness ${dim('extraction_readiness')}/100`);
    const missing = (ctx.research?.site ?? []).filter((r) => /missing|no Organization|omits/i.test(r.claim)).length;
    if (missing) parts.push(`${missing} of ${ctx.research!.site.length} crawl and entity basics missing`);
    if (dim('authority_velocity') != null) parts.push(`content freshness ${dim('authority_velocity')}/100`);
  } else if (key === 'discover') {
    if (l.aiTotals.buyerAnswers) parts.push(`named in ${l.aiTotals.buyerNamed} of ${l.aiTotals.buyerAnswers} grounded AI answers to buyer questions`);
    const v = ctx.ledger.access.find((a) => a.capability.startsWith('Official website pages'));
    const off = ctx.research?.offering;
    if (off) parts.push(`${off.capabilities.filter((c) => c.state === 'website_verified').length} of ${off.capabilities.length} declared capabilities stated on the site`);
    else if (v) parts.push(v.outcome);
  } else {
    const f = l.footprint;
    if (f) parts.push(`${f.mentions.confirmed} independent mentions confirmed`, `${f.reviews.listed} of ${f.reviews.checked} review and directory sites listed`);
    parts.push(backlinkPhrase(ctx));
  }
  return parts.length ? parts.join(' · ') : null;
}

/** "backlinks not measured" unless Bing Webmaster Tools measured them for the verified site. */
function backlinkPhrase(ctx: Context): string {
  const l = ctx.research?.bingWebmaster?.status === 'measured' ? ctx.research.bingWebmaster.links : null;
  const inb = ctx.ledger.families.find((x) => x.key === 'inbound_links');
  if (inb?.state === 'found' && !l) return 'backlinks measured by the report run';
  return l ? (l.total ? `${l.total}${l.complete ? '' : '+'} inbound links reported by Bing` : 'no inbound links reported by Bing') : 'backlinks not measured';
}

/** Top linked pages from Bing Webmaster Tools; empty unless measured. */
function bingLinkTable(ctx: Context): string {
  const l = ctx.research?.bingWebmaster?.status === 'measured' ? ctx.research.bingWebmaster.links : null;
  if (!l || !l.pages.length) return '';
  const s = ctx.research?.bingWebmaster?.linkSample;
  const strip = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '');
  const sample = s?.links.length ? `<table class="v2-table v2-compact"><thead><tr><th>Linking page (sample)</th><th style="width:26%">Anchor text</th><th style="width:28%">Links to</th></tr></thead><tbody>${
    s.links.slice(0, 12).map((x) => `<tr><td><small>${e(strip(x.source).slice(0, 80))}</small></td><td><small>${e(x.anchorText ?? '—')}</small></td><td><small>${e(strip(x.target))}</small></td></tr>`).join('')
  }</tbody></table><p class="v2-note">A sample: the first page of Bing’s link list for the ${s.targetsSampled} most-linked page${s.targetsSampled === 1 ? '' : 's'} (${s.referringHosts.length} distinct linking site${s.referringHosts.length === 1 ? '' : 's'} in the sample). Not the full set of referring domains.</p>` : '';
  return `<table class="v2-table v2-compact"><thead><tr><th>Page on the site</th><th class="v2-num" style="width:18%">Inbound links</th></tr></thead><tbody>${
    [...l.pages].sort((a, b) => b.count - a.count).slice(0, 10).map((p) => `<tr><td>${e(strip(p.url))}</td><td class="v2-num">${p.count}</td></tr>`).join('')
  }</tbody></table><p class="v2-note">Counts are from Bing’s own link index for the verified site (Bing Webmaster Tools, ${e(fmtDate(ctx.research?.bingWebmaster?.checkedAt) ?? '')}); links Bing knows about, not every link on the web, and not an authority score.</p>${sample}`;
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
  const off = pack?.offering ?? null;
  const pagesRead = off ? off.pages.filter((x) => x.read) : [];
  // "Differs" compares wording, not meaning, so it is labelled as a wording difference to review.
  const agreementPill = (a: unknown) =>
    a === 'agree' ? pill('Website agrees', 'good') : a === 'differ' ? pill('Different wording', 'warn') : a === 'declared_only' ? pill('Declared only', 'neutral') : a === 'observed_only' ? pill('Observed only', 'info') : pill('Unresolved', 'neutral');
  const identityRow = (f: Obj) => {
    let declared = str(f.declaredValue);
    let observed = str(f.observedValue);
    let agreement: unknown = f.agreement;
    // A generated positioning assessment is not something the company declared.
    if (declared && GENERATED_ASSESSMENT.test(declared)) { declared = null; agreement = observed ? 'observed_only' : null; }
    // The offering: where the profile's words are not on the site, show what the site calls itself.
    if (!observed && /offering/i.test(String(f.label)) && off?.selfDescription?.title) {
      observed = `Homepage title: “${off.selfDescription.title}”${off.selfDescription.heading ? `; heading: “${off.selfDescription.heading}”` : ''}`;
      agreement = off.offering?.state === 'website_verified' ? 'agree' : 'differ';
    }
    return `<tr><td><strong>${e(f.label)}</strong></td><td>${e(declared ?? '— not declared in the profile')}</td><td>${e(observed ?? (pagesRead.length ? `— not stated on the ${pagesRead.length} page${pagesRead.length === 1 ? '' : 's'} read` : '— not stated on the pages read'))}</td><td>${declared || observed ? agreementPill(agreement) : pill('Not declared', 'neutral')}</td></tr>`;
  };
  const identity = fields.length ? `<table class="v2-table"><thead><tr><th style="width:20%">Attribute</th><th>Company profile</th><th>Website shows</th><th style="width:16%">Agreement</th></tr></thead><tbody>${
    fields.map(identityRow).join('')
  }</tbody></table>${off ? `<p class="v2-note">Website pages read on ${e(fmtDate(off.checkedAt) ?? '')}: ${off.pages.map((x) => `${e(x.url.replace(/^https?:\/\/(www\.)?/, ''))} (${x.read ? x.purpose : `HTTP ${x.status ?? 'no response'}`})`).join(', ')}. "Different wording" compares words, not meaning.</p>` : ''}` : '';

  // Each declared capability, with the strongest state the evidence supports.
  const OFFER_STATE: Record<string, [string, Tone]> = {
    website_verified: ['Website-verified', 'good'], independently_corroborated: ['Independently corroborated', 'good'], company_declared: ['Company-declared only', 'neutral'],
    contradictory: ['Contradictory', 'bad'], unknown: ['Unknown', 'neutral'],
  };
  const capabilityTable = off && (off.capabilities.length || off.offering) ? `<table class="v2-table v2-compact"><thead><tr><th style="width:26%">Declared in the profile</th><th style="width:18%">State</th><th>Evidence on the website (verbatim)</th><th style="width:9%">Confidence</th></tr></thead><tbody>${
    [...(off.offering && !off.capabilities.some((x) => x.claim === off.offering!.claim) ? [off.offering] : []), ...off.capabilities].map((c) => { const [t, tone] = OFFER_STATE[c.state] ?? ['Unknown', 'neutral' as Tone];
      return `<tr><td><strong>${e(c.claim)}</strong></td><td>${pill(t, tone)}</td><td><small>${c.excerpt ? `“${e(c.excerpt)}”<br/><span class="v2-src">${e((c.sourceUrl ?? '').replace(/^https?:\/\/(www\.)?/, ''))}</span>` : e(c.basis)}</small></td><td>${e(c.confidence)}</td></tr>`; }).join('')
  }${off.pricing ? `<tr><td><strong>Published pricing</strong></td><td>${pill('Website-verified', 'good')}</td><td><small>“${e(off.pricing.excerpt)}”<br/><span class="v2-src">${e(off.pricing.url.replace(/^https?:\/\/(www\.)?/, ''))}</span></small></td><td>high</td></tr>` : ''}${off.freePlan ? `<tr><td><strong>Free plan or trial</strong></td><td>${pill('Website-verified', 'good')}</td><td><small>“${e(off.freePlan.excerpt)}”<br/><span class="v2-src">${e(off.freePlan.url.replace(/^https?:\/\/(www\.)?/, ''))}</span></small></td><td>high</td></tr>` : ''}</tbody></table>
    <p class="v2-note">A claim is website-verified only when the site's own text states it (every key word in one short passage); paraphrase does not count. Company-declared only means the pages read do not state it in these words — not that the company lacks it. No third-party page was checked for these claims, so none is independently corroborated.</p>` : '';

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
      const value = v.value === 'not found' ? 'not found in the sources searched' : v.value;
      const text = value.length > 110 ? `${value.slice(0, 107)}…` : value;
      return `<td${weak ? ' class="v2-gapcell"' : ''}><small>${e(text)}${tag}${link}</small></td>`;
    };
    const basicRows = bench.filter(isMarketingBasic);
    const own = pack!.subject.domain;
    const fromSite: Record<string, { excerpt: string; url: string } | null | undefined> = { profile_entryPrice: off?.pricing, profile_freePlanOrTrial: off?.freePlan };
    const profileRows = bench.filter((r) => !isMarketingBasic(r)).map((r) => {
      const site = fromSite[String(r.dimension)];
      return site && r.values ? { ...r, values: { ...r.values, [own]: { value: `“${site.excerpt}”`, status: 'observed', url: site.url } } } : r;
    });
    const table = (rows: ResearchRecord[], first: string, last: boolean) => `<table class="v2-table v2-compact v2-bench"><thead><tr><th style="width:15%">${e(first)}</th>${domains.map((d) => `<th>${e(nameOf(d))}</th>`).join('')}${last ? `<th style="width:22%">What it means for ${e(ctx.brand)}</th>` : ''}</tr></thead><tbody>${
      rows.map((r) => `<tr><td><strong>${e(plainTerm(r.claim))}</strong><br/><span class="v2-id">${e(r.id)}</span></td>${domains.map((d, i) => cell(r.values?.[d], i === 0 && last)).join('')}${last ? `<td><small>${e(r.gap ?? '')}</small>${r.recommends ? `<br/><span class="v2-id">${e(r.recommends.id)}</span>` : ''}</td>` : ''}</tr>`).join('')
    }</tbody></table>`;
    profile = profileRows.length ? table(profileRows, 'Company profile', false) + `<p class="v2-note">Each value was found by an AI analyst using live web search and carries its source; the pipeline re-opened every source page. "(not re-confirmed)" marks a value the page did not show when re-checked. Revenue is shown only where a public source states it.</p>` : '';
    benchmark = basicRows.length ? table(basicRows, 'Marketing basic', true) + `<p class="v2-note">Shaded cells are where ${e(ctx.brand)} has nothing comparable yet. "(claimed)" marks a company's statement about itself.</p>` : '';
    const capRows = pack!.benchmark.filter((r) => r.kind === 'capability' && r.values);
    if (capRows.length) {
      const capCols = domains.filter((d) => capRows.some((r) => r.values?.[d]));
      // The company's own column carries the provenance of its claim (declared vs shown on its site).
      const ownState = (claim: string): HeatCell => {
        const c = off?.capabilities.find((x) => x.claim === claim);
        if (!c) return { text: 'declared (not checked)', tone: 'self' };
        return c.state === 'website_verified' || c.state === 'independently_corroborated' ? { text: 'on its website', tone: 'top' }
          : c.state === 'contradictory' ? { text: 'contradictory', tone: 'low' } : c.state === 'unknown' ? { text: 'unknown', tone: 'unmeasured' } : { text: 'declared only', tone: 'self' };
      };
      const verifiedOwn = capRows.filter((r) => ownState(r.claim).tone === 'top').length;
      overlap = heatmap(capCols.map(nameOf), capRows.map((r) => ({
        label: r.claim, sub: r.gap ?? '',
        cells: capCols.map((d): HeatCell => {
          if (d === own) return ownState(r.claim);
          const v = r.values?.[d];
          if (!v || v.value === 'unknown') return { text: 'unknown', tone: 'unmeasured' };
          return v.value === 'yes' ? { text: v.status === 'inferred' ? 'yes (not re-confirmed)' : 'yes', tone: 'mid' } : { text: 'no (analyst reading)', tone: 'absent' };
        }),
      }))) + heatLegend([{ tone: 'top', label: `${ctx.brand}: stated on its website` }, { tone: 'self', label: `${ctx.brand}: declared only` }, { tone: 'mid', label: 'Competitor offers it (analyst, with source)' }, { tone: 'absent', label: 'Competitor does not' }, { tone: 'unmeasured', label: 'Unknown' }])
        + `<p class="v2-note">Rows are ${e(ctx.brand)}'s own declared capabilities. ${off
          ? `${verifiedOwn} of ${capRows.length} ${verifiedOwn === 1 ? 'is' : 'are'} stated on its website; the rest are the company's claim only.${verifiedOwn * 2 < capRows.length ? ' Because most of the offer could not be confirmed on the site, this is a comparison of claims, not a like-for-like comparison of offerings.' : ''}`
          : 'They were not checked against the website in this run, so this is a comparison of claims, not a like-for-like comparison of offerings.'} Competitor cells are an analyst's reading of each competitor's own site, with the source re-opened.</p>`;
    }

  }

  const icp = obj(ctx.payload.market_icp_recommendation);
  const attrs = objs(icp?.attributes);
  const icpTable = attrs.length ? `<table class="v2-table"><thead><tr><th style="width:22%">Market attribute</th><th style="width:16%">State</th><th>Value, or what would resolve it</th></tr></thead><tbody>${
    attrs.map((a) => { const st = stateLabel(a.status === 'unavailable' ? 'unavailable' : String(a.status)); return `<tr><td>${e(a.label)}</td><td>${pill(st.text, st.tone)}</td><td><small>${e(a.value ?? a.unlock ?? '—')}</small></td></tr>`; }).join('')
  }</tbody></table>` : '';

  const cands = pack?.candidates ?? [];
  const included = cands.filter((c) => ['direct', 'adjacent', 'substitute'].includes(c.classification));
  const verifiedNames = cands.length ? included.filter((c) => c.classification !== 'substitute').map((c) => c.name)
    : pack?.competitors.filter((c) => ['direct', 'adjacent'].includes(String(c.classification))).map((c) => c.name) ?? [];
  const register = registerTable(ctx);
  const marketView = marketTable(ctx);
  const discovery = discoveryBlock(ctx);
  const capMatrix = capabilityMatrix(ctx);
  return section(1, 'Market and competitors', 'What does the company sell, to whom, and who else competes for that buyer?',
    cands.length ? discoveryPlainEnglish(ctx) : marketPlainEnglish(verifiedNames, pack?.competitors.filter((c) => c.classification === 'not_competitor').length ?? 0), `
    ${competitorOverlapVisual(ctx) ? block('At a glance: how much of the offer each competitor also sells', 'Capabilities stated on each company’s own website, against those stated on the company’s own site — the same five definitions for everyone. Detail in stages 1–4 below.', competitorOverlapVisual(ctx)) : ''}
    ${definition ? block('What the company offers — from its own pages', 'The starting point for everything else: buyer problems, search queries and competitor criteria come from this.', definition) : ''}
    ${register ? block('Stage 1 · What it offers: offerings, buyers and prices', 'Each entry quotes the official page it came from. Profile-only entries are labelled company-declared.', register, 'v2-allow-break') : ''}
    ${identity ? block('Company profile versus website', 'What was entered in the company profile next to what the website says. A difference is shown, not resolved.', identity) : ''}
    ${capabilityTable ? block('What it offers: declared versus shown on its website', 'Each claim from the company profile, checked against the product, feature, pricing, solutions and help pages the homepage links to.', capabilityTable) : ''}
    ${marketView ? block('Stage 2 · The market this places it in', 'Derived only from the offering register. Anything resting on the company profile alone is an assumption.', marketView) : ''}
    ${discovery ? block('Stage 3 · How the company compares with alternatives: the shortlist (at most eight)', 'Candidates come from this report’s own evidence and were each read on their own website; direct competitors first, then alternatives.', discovery, 'v2-allow-break') : landscape}
    ${capMatrix ? block('Stage 4 · Capabilities, same definitions for every company', 'A capability counts only where the company’s own pages state it within one short passage. “Not found in checked pages” is not “does not offer”.', capMatrix) : overlap ? block('Offering overlap', 'Which of the company\'s own capabilities each competitor also offers.', overlap) : ''}
    ${profile ? block('Competitor profiles (analyst, sourced)', 'What each company sells, to whom, where, and how big it is — from public sources.', profile, 'v2-allow-break') : ''}
    ${benchmark ? block('How the competitors market themselves', 'The same public checks for each company, side by side, and what closing each gap would take.', benchmark, 'v2-allow-break') : ''}
    ${icpTable && !marketView ? block('Market facts the public record does not yet establish', str(icp?.headline), icpTable + (profile ? `<p class="v2-note">The competitor profiles above are the nearest public evidence for segment, buyer and market: they show who the validated competitors sell to and where. They describe the competitors, so these attributes stay unresolved for ${e(ctx.brand)} itself.</p>` : '') + (pack?.company.length ? `<p class="v2-note">The company’s own pages state its intended buyers and prices (${e(pack.company.filter((r) => /^(buyers|pricing)/i.test(r.claim)).map((r) => r.id).join(', '))}). That is company-declared intent, not independent market evidence, so these attributes stay unresolved here.</p>` : '')) : ''}
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
  // Purpose before depth: account and legal pages are short by design.
  const purposes = urls.map((u) => urlPurpose(u.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0] || '/'));
  const shortByDesign = purposes.filter((p) => p === 'Legal' || p === 'Account and app screens').length;
  if (shortByDesign === 0) return null;
  return `${shortByDesign === urls.length ? 'Every example' : `${shortByDesign} of the ${urls.length} examples`} listed ${shortByDesign === 1 ? 'is an account or legal page' : 'are account or legal pages'}, short by design. Which of the thin pages are commercial (product, pricing, articles) is not established by this crawl; review those first.`;
}

function findingCard(f: DossierFinding, actions: DossierAction[]): string {
  const st = stateLabel(f.state);
  const tone = f.kind === 'coverage' || f.kind === 'competitive' ? 'neutral' : f.state === 'measured' ? 'bad' : 'warn';
  const linked = actions.filter((a) => f.actionIds.includes(a.id));
  const metric = f.metric ? f.metric.split(' (')[0] : null;
  const plain = plainFor(f);
  const caveat = f.kind === 'content' ? thinPageCaveat(f) : null;
  // One claim, three layers: what was found → why it matters → where it comes from.
  return `<div class="v2-card v2-tone-${tone}"><h4>${e(f.title)} ${pill(st.text, st.tone)}</h4>
    ${metric ? `<div class="v2-card-metric">${e(metric)}</div>` : ''}
    <div class="v2-layer v2-layer-plain"><b>Plain English</b>${e(plain ?? f.observation)}</div>
    ${f.implication ? `<div class="v2-layer v2-layer-impl"><b>Business implication</b>${e(f.implication)}</div>` : ''}
    <div class="v2-layer v2-layer-ev"><b>Where the information came from</b>${plain && f.observation !== metric ? `${e(f.observation)}<br/>` : ''}<span>Source: ${e(f.source)} · state: ${e(st.text.toLowerCase())} · <span class="v2-id">${e(f.id)}</span></span>${caveat ? `<br/><em>Caveat: ${e(caveat)}</em>` : ''}</div>
    ${linked.length ? `<div class="v2-card-action"><b>Action</b> ${linked.map((a) => `${e(a.title)} <span class="v2-id">${e(a.id)}</span>`).join('<br/>')}</div>` : ''}</div>`;
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
  const lc = ctx.ledger.crawl;
  const funnelStages: FunnelStage[] = [];
  if (lc.known != null) funnelStages.push({ label: 'Known web addresses', value: lc.known });
  if (lc.attempted != null) {
    funnelStages.push({ label: 'Fetched by the crawler', value: lc.attempted, note: lc.notAttempted ? `${lc.notAttempted} never fetched` : undefined });
    funnelStages.push({ label: 'Answered (any HTTP status)', value: lc.responded ?? 0 });
    funnelStages.push({ label: 'Read (HTTP 200)', value: lc.read ?? 0 });
    funnelStages.push({ label: 'Evaluated by the website checks', value: lc.evaluated ?? 0 });
  } else if (lc.evaluated != null) {
    funnelStages.push({ label: 'Answered the crawler', value: lc.evaluated, note: lc.notObserved ? 'the rest were not observed; attempt status unknown' : undefined });
    funnelStages.push({ label: 'Pages read and evaluated', value: lc.evaluated });
  }
  const o = lc.outcomes;
  const failedFetch = o ? o.clientError + o.serverError + o.noResponse + o.redirectedOffSite : 0;
  const crawlWhen = `Crawl of ${e(ctx.crawl.lastCrawled ?? '—')}${ctx.crawl.reused ? ', reused for this report' : ''}${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso) != null ? ` (${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso)} days before the report)` : ''}. ${evaluated ?? '—'} of ${total ?? '—'} website checks could be evaluated.`;
  const crawlBody = !funnelStages.length ? '<p class="v2-note">Crawl scope was not recorded.</p>'
    : o ? funnel(funnelStages) + `<p class="v2-note">Every address has a recorded state. ${o.read} were read${failedFetch ? `; ${failedFetch} were fetched and failed (${[o.clientError && `${o.clientError} client error`, o.serverError && `${o.serverError} server error`, o.noResponse && `${o.noResponse} no response`, o.redirectedOffSite && `${o.redirectedOffSite} redirected off the site`].filter(Boolean).join(', ')})` : '; none failed'}. The other ${o.notFetched} were <strong>never fetched</strong>: they reached the page table from site analytics, not from links the crawler followed, so they are not failures and say nothing about the public site. ${crawlWhen}</p>`
      : funnel(funnelStages) + `<p class="v2-note">Attempted in this run: <strong>not recorded</strong> — the crawl stores known addresses and the pages that answered, not how many were tried, so the ${lc.notObserved ?? ''} not observed are not counted as failures: whether they were tried, timed out or returned an error is unknown. ${crawlWhen}</p>`;
  // What each known address is for, against what happened to it: depth is judged by purpose.
  const purposeMap = lc.byPurpose?.length ? heatmap(['Read', 'Fetched, failed', 'Never fetched'], lc.byPurpose.map((b) => {
    const failed = b.clientError + b.serverError + b.noResponse + b.redirectedOffSite;
    const cell = (n: number, tone: HeatCell['tone']): HeatCell => (n ? { text: String(n), tone } : { text: '–', tone: 'unmeasured' });
    return { label: b.purpose, sub: PURPOSE_NOTE[b.purpose] ?? '', cells: [cell(b.read, 'top'), cell(failed, 'low'), cell(b.notFetched, 'self')] };
  })) + heatLegend([{ tone: 'top', label: 'Read' }, { tone: 'low', label: 'Fetched, failed' }, { tone: 'self', label: 'Never fetched (analytics only)' }])
    + '<p class="v2-note">Purpose is read from each address, not from its content. Thin-content judgements apply to commercial pages and articles; account and app screens are signed-in product pages and legal pages are short by design.</p>' : '';

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
    ${purposeMap ? block('Known addresses by purpose', 'What each address is for, and what happened to it in the crawl.', purposeMap) : ''}
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
  // Backlinks: never a configuration instruction, and a missing source is "not measured", not zero.
  const inbound = ctx.ledger.families.find((x) => x.key === 'inbound_links');
  const status = `<table class="v2-table"><thead><tr><th style="width:26%">Signal</th><th style="width:16%">State</th><th style="width:8%">Score</th><th>Basis</th></tr></thead><tbody>
    ${statusRow('Backlinks', 'links from other websites to yours', inbound && inbound.state !== 'found' ? { score: ai.score, text: `${inbound.result} ${inbound.limitation}` } : ai)}
    ${statusRow('Entity and knowledge graph', 'whether public databases (e.g. Wikidata) know the company', kg)}
    ${statusRow('Reviews and reputation', 'independent ratings and reviews', tr)}
  </tbody></table>`;
  const FAMILY_STATE: Record<string, [string, Tone]> = {
    found: ['Found', 'good'], searched_not_found: ['Searched, not found', 'neutral'], not_measured: ['Not measured', 'neutral'], inaccessible: ['Inaccessible', 'warn'], not_attempted: ['Not attempted', 'neutral'],
  };
  const familyTable = `<table class="v2-table v2-compact"><thead><tr><th style="width:20%">Family</th><th style="width:13%">State</th><th>Result</th><th style="width:19%">Source · checked</th><th style="width:8%">Identity</th><th style="width:22%">Limitation</th></tr></thead><tbody>${
    ctx.ledger.families.map((x) => { const [t, tone] = FAMILY_STATE[x.state]; return `<tr><td><strong>${e(x.label)}</strong></td><td>${pill(t, tone)}</td><td><small>${e(x.result)}${x.urls.length ? `<br/>${x.urls.slice(0, 3).map((u) => `<span class="v2-src">${e(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</span>`).join('<br/>')}` : ''}</small></td><td><small>${e(x.source)}${x.checkedAt ? ` · ${e(fmtDate(x.checkedAt) ?? '')}` : ''}${x.attempted ? '' : ' · not attempted'}</small></td><td><small>${e(x.identity ?? '—')}</small></td><td><small>${e(x.limitation)}</small></td></tr>`; }).join('')
  }</tbody></table><p class="v2-note">Each family is kept apart: an owned profile is not a mention, a mention is not a link, and a source that was not checked is "not measured", never zero.</p>`;
  const yesNo = (v: boolean | null, good = true) => (v == null ? '<span class="v2-muted">—</span>' : v ? `<b class="v2-${good ? 'yes' : 'no'}">yes</b>` : '<span class="v2-no">no</span>');
  const identityTable = ctx.ledger.identities.length ? `<table class="v2-table v2-compact v2-ladder"><thead><tr><th style="width:12%">Profile</th><th>Declared</th><th>Opened signed out</th><th>Identity confirmed</th><th>Links to website</th><th>Website links to it</th><th style="width:20%">Dated posts seen</th><th style="width:20%">Limitation</th></tr></thead><tbody>${
    ctx.ledger.identities.map((x) => `<tr><td><strong>${e(x.platform)}</strong><br/><small>${e(x.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</small></td><td>${x.foundBySearch ? '<small>no — found by search</small>' : yesNo(x.declared)}</td><td>${yesNo(x.opened)}</td><td>${yesNo(x.opened ? x.identityConfirmed : null)}</td><td>${yesNo(x.linksToSite)}</td><td>${yesNo(x.siteLinksToProfile)}</td><td><small>${x.posts ? `${x.posts.count} post${x.posts.count === 1 ? '' : 's'}, ${e(fmtDate(x.posts.oldest) ?? '')} – ${e(fmtDate(x.posts.newest) ?? '')}` : x.opened ? 'none visible signed out' : '—'}</small></td><td><small>${e(x.blocked ?? '—')}</small></td></tr>`).join('')
  }</tbody></table>${ctx.research?.footprint?.profilesFound ? `<p class="v2-note">Profile discovery: the web search of ${e(fmtDate(ctx.research!.footprint!.checkedAt) ?? '')} was also asked for official LinkedIn, Facebook, Instagram, YouTube, X and TikTok profiles; ${ctx.research!.footprint!.profilesFound!.length ? `it surfaced ${ctx.research!.footprint!.profilesFound!.length} (${e(ctx.research!.footprint!.profilesFound!.map((u) => u.replace(/^https?:\/\/(www\.)?/, '')).join(', '))}), each verified above` : 'it surfaced none beyond those listed, so no Facebook or TikTok profile was found by that search — not proof that none exists'}.</p>` : ''}<p class="v2-note">Each step is shown only when observed: "—" means the step could not be checked (for example behind a sign-in wall), not that it failed. Posts are a sample visible to a signed-out visitor, not the account's full history. Company and founder posts are owned content, never independent coverage.</p>` : '';

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
    const inb = ctx.ledger.families.find((x) => x.key === 'inbound_links');
    nodes.push({ id: 'backlinks', label: 'Backlinks', sub: inb?.state === 'found' ? 'measured (Bing)' : inb?.state === 'searched_not_found' ? 'none reported' : 'not measured', kind: inb?.state === 'found' ? 'observed' : 'absent' });
    const reg = ctx.ledger.families.find((x) => x.key === 'registry');
    if (reg) nodes.push({ id: 'registry', label: 'Company registry', sub: reg.state === 'found' ? 'record confirmed' : reg.state === 'searched_not_found' ? 'no number stated' : reg.state === 'inaccessible' ? 'not confirmable' : 'not checked', kind: reg.state === 'found' ? 'observed' : 'absent' });
  } else if (pack) {
    if (pack.independent.some((r) => r.kind === 'directory_listing' && r.status === 'looked_for_not_found')) nodes.push({ id: 'reviews', label: 'Review sites', sub: 'G2 / Capterra: not found', kind: 'absent' });
    if (pack.independent.some((r) => r.kind === 'third_party_mention' && r.status === 'looked_for_not_found')) nodes.push({ id: 'press', label: 'Press & mentions', sub: 'none found', kind: 'absent' });
  }
  const graph = entityGraph({ id: 'brand', label: ctx.brand, sub: ctx.domain, kind: 'center' }, nodes)
    + swatchLegend([[PALETTE.green, 'Observed in public sources'], [PALETTE.blue, 'Declared or found, not verified'], [PALETTE.greyMid, 'Not found where looked, or not measured (see label)']]);

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
    const namesakes = fp.namesakes ?? [];
    const namesakeNote = namesakes.length ? `<p class="v2-note">Excluded as namesakes: ${namesakes.length} result${namesakes.length === 1 ? '' : 's'} the search returned for similarly named companies, whose page and title never name ${e(ctx.brand)} (${e([...new Set(namesakes.map((n) => n.url.replace(/^https?:\/\/(www\.)?/, '').split('/').slice(0, 3).join('/')))].slice(0, 4).join(', '))}${namesakes.length > 4 ? ', …' : ''}).</p>` : '';
    const how = fp.mentionSearch
      ? `<p class="v2-note">Method: web search by ${e(fp.mentionSearch === 'openai' ? 'OpenAI (web search tool)' : 'Claude (web search tool)')} on ${e(fmtDate(fp.checkedAt) ?? '')}, then each page re-opened to confirm it names the company. ${queries.length ? `Queries the search ran: ${queries.slice(0, 6).map((q) => `“${e(q)}”`).join('; ')}.` : 'The exact queries were not recorded for this run.'} A model-directed web search is a sample, not an exhaustive index of the web.</p>`
      : '';
    return `${identityTable ? block('Official profiles: identity, step by step', 'From declared, to opened, to confirmed as this company, to linked both ways.', identityTable) : block('Owned profiles', null, profiles)}${block('Independent mentions', 'Pages on other sites that discuss the company. A mention is not necessarily a link.', mentions + postsNote + namesakeNote + how)}${reviews ? block('Review and directory listings', null, reviews) : ''}${block('Websites linking to the company (backlinks)', null, `${bingLinkTable(ctx)}<p class="v2-note">${e(bl?.outcome ?? 'Not measured.')} ${e(bl?.nextStep ?? '')}</p>`)}`;
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
  const reg = ctx.research?.registry;
  const registryTable = reg && (reg.identifiers.length || reg.unavailable.length) ? `<table class="v2-table v2-compact"><thead><tr><th>Identifier</th><th style="width:22%">Registry</th><th style="width:26%">State</th><th>Registered as</th></tr></thead><tbody>${
    [...reg.identifiers.map((i) => `<tr><td><strong>${e(i.id)}</strong></td><td><small>${e(i.provider)}</small></td><td>${i.verified ? pill('Confirmed by the registry', 'good') : pill('Stated by the company', 'info')}</td><td><small>${e([i.legalName, i.status, i.jurisdiction].filter(Boolean).join(' · ') || '—')}</small></td></tr>`),
      ...reg.unavailable.filter((u) => !reg.identifiers.some((i) => i.id === u.id && i.verified)).map((u) => `<tr><td><strong>${e(u.id)}</strong></td><td><small>${e(u.provider)}</small></td><td>${pill(u.outcome === 'credential_required' ? 'Registry needs a credential' : u.outcome === 'inaccessible' ? 'Registry blocks automated checks' : 'Not checkable automatically', 'neutral')}</td><td><small>—</small></td></tr>`)].join('')
  }</tbody></table><p class="v2-note">${e(reg.detail)}</p>` : '';
  const strategy = recs.length ? `<table class="v2-table"><thead><tr><th>Type of external authority</th><th style="width:12%">When</th><th style="width:14%">Horizon</th><th style="width:14%">Relevance</th></tr></thead><tbody>${
    recs.map((r) => {
      const rel = objs(r.relevance);
      const supports = rel.filter((x) => x.verdict === 'supports').length;
      const why = (str(r.whyItMatters) ?? '').split(/(?<=\.)\s+For this company/)[0];
      return `<tr><td><strong>${e(r.label)}</strong><br/><small>${e(why)}</small></td><td>${pill(cap(String(r.priority ?? '')), r.priority === 'now' ? 'info' : 'neutral')}</td><td>${e(cap(String(r.horizon ?? '').replace(/_/g, ' ')))}</td><td class="v2-num">${supports} of ${rel.length} checks</td></tr>`;
    }).join('')
  }</tbody></table><p class="v2-note">Types of authority worth building — not a list of sites, and not links the company already has.</p>` : '';

  return section(3, 'Brand recognition and trust', 'Does the wider web recognise and vouch for the brand?',
    brandPlainEnglish(ctx, kgState), `
    ${block('How the web connects to the brand', 'Search engines and AI tools recognise a company by the profiles and records that point to it. Each line shows how that link was established.', graph)}
    ${block('External footprint by family', 'Websites linking to the company, profiles, press, partners, directories, the company registry and reviews — each with what was tried and what it can and cannot show.', familyTable, 'v2-allow-break')}
    ${registryTable ? block('Company registration', 'Registration numbers the company states on its own pages, and whether a public registry confirmed them.', registryTable) : ''}
    ${footprint ? `<div class="v2-keep"><h3 class="v2-subsection">External digital footprint</h3>${footprint}</div>` : ''}
    ${independent ? block('Independent evidence', 'Third-party confirmation, looked for in public sources.', independent) : ''}
    ${block('External signal status', '"Unavailable" means a source is missing, not that the result is weak.', status)}
    ${proof ? block('Proof the company shows on its own site', null, proof) : ''}
    ${cards.length ? block('Findings', null, `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`, 'v2-allow-break') : ''}
    ${strategy ? block('External authority worth building', null, strategy, 'v2-allow-break') : ''}
  `);
}

const REG_LABEL: Record<string, string> = {
  product_line: 'Offering', customer_problem: 'Customer problem', value_proposition: 'Value proposition', buyer: 'Buyer / segment', use_case: 'Declared capability',
  pricing: 'Pricing', business_model: 'Business model', free_offer: 'Free offer', geography: 'Geography',
  industry: 'Industry', differentiator: 'Differentiator', revenue: 'Revenue (as declared)', team_size: 'Team size (as declared)', founded: 'Founded',
};

/** One line on the company profile: what it contributed, or — without one — that nothing is implied. */
function profileNote(ctx: Context): string {
  const pe = ctx.research?.profileEvidence;
  if (!pe) return '';
  const n = pe.facts.length;
  switch (pe.status) {
    case 'profile_available': case 'profile_partial':
      return `<p class="v2-note">Company profile (${pe.status === 'profile_partial' ? 'partly filled' : 'filled'}): ${n} fact${n === 1 ? '' : 's'} imported as company-declared, each with its profile field and date; facts the website states in the same words are marked website-verified. Fields the profile leaves empty were researched from the website instead.</p>`;
    case 'profile_empty': return '<p class="v2-note">A company profile exists but holds no usable facts; everything below comes from the website and public sources.</p>';
    case 'profile_not_found': return '<p class="v2-note">No company profile was available; everything below comes from the website and public sources. A fact missing here is unknown — not evidence that it does not exist.</p>';
    case 'profile_access_error': return '<p class="v2-note">The company profile could not be read for this report (a lookup error, not a missing profile); everything below comes from the website and public sources.</p>';
    case 'profile_identity_mismatch': return '<p class="v2-note">A company profile was found but belongs to a different company, so it was not used; everything below comes from the website and public sources.</p>';
    default: return '';
  }
}
const REG_STATE: Record<string, [string, Tone]> = {
  official_website_verified: ['Website-verified', 'good'], company_declared: ['Company-declared', 'info'], independently_corroborated: ['Corroborated', 'good'], unknown: ['Unknown', 'neutral'], conflicting: ['Conflicting', 'bad'],
};

/** Stage 1: the offering register (capabilities have their own table above it). */
function registerTable(ctx: Context): string {
  const reg = ctx.research?.register;
  if (!reg) return '';
  const order = ['product_line', 'customer_problem', 'value_proposition', 'differentiator', 'buyer', 'industry', 'pricing', 'business_model', 'free_offer', 'geography', 'revenue', 'team_size', 'founded'];
  const rows = reg.entries.filter((x) => x.field !== 'use_case').sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  const short = (u: string | null) => (u ?? '').replace(/^https?:\/\/(www\.)?/, '');
  return `<table class="v2-table v2-compact"><thead><tr><th style="width:15%">Field</th><th style="width:26%">Entry</th><th style="width:14%">Status</th><th>Evidence (verbatim) · source · date</th></tr></thead><tbody>${
    rows.map((x) => { const [t, tone] = REG_STATE[x.status]; const prov = x.provenance ?? x.alsoDeclared;
      const from = prov ? `Company profile · ${prov.profileField}${prov.capturedAt ? ` · ${fmtDate(prov.capturedAt)}` : ''} · ${prov.attribution}${x.stale ? ' · older than a year' : ''}` : null;
      return `<tr><td><small>${e(REG_LABEL[x.field] ?? x.field)}</small></td><td><strong>${e(x.value)}</strong></td><td>${pill(t, tone)}<br/><small>${e(x.confidence)}</small></td><td><small>${x.excerpt ? `“${e(x.excerpt.slice(0, 200))}”` : x.provenance ? '' : 'Company profile only.'}${x.url ? `<br/><span class="v2-src">${e(short(x.url))} · ${e(fmtDate(x.observedAt) ?? '')}</span>` : ''}${from ? `${x.excerpt || x.url ? '<br/>' : ''}<span class="v2-src">${x.alsoDeclared ? 'Also declared in the company profile · ' : ''}${e(from)}</span>` : ''}${x.conflictsWith ? `<br/><b>Conflicts with:</b> ${e(x.conflictsWith)} — both kept; not resolved.` : ''}</small></td></tr>`; }).join('')
  }</tbody></table>${profileNote(ctx)}${reg.missing.length ? `<p class="v2-note">Not stated on the official pages read: <b>${e(reg.missing.map((m) => REG_LABEL[m]?.toLowerCase() ?? m).join(', '))}</b>. Conclusions that depend on ${reg.missing.length === 1 ? 'it' : 'them'} stay provisional.</p>` : ''}`;
}

/** Stage 2: market items, verified vs assumption. */
function marketTable(ctx: Context): string {
  const m = ctx.research?.market;
  if (!m?.items.length) return '';
  const KIND: Record<string, string> = { category: 'Category', segment: 'Segment', problem: 'Problem', geography: 'Geography' };
  return `<table class="v2-table v2-compact"><thead><tr><th style="width:13%">Kind</th><th style="width:34%">Market</th><th style="width:13%">Basis</th><th>Evidence</th></tr></thead><tbody>${
    m.items.map((i) => `<tr><td><small>${e(KIND[i.kind])}</small></td><td>${e(i.value)}</td><td>${i.basis === 'verified' ? pill('From the website', 'good') : pill('Assumption', 'warn')}</td><td><small>${e(i.evidence.slice(0, 160))}</small></td></tr>`).join('')
  }</tbody></table>${(() => {
    const n = m.items.filter((i) => i.basis === 'assumption').length;
    return n ? `<p class="v2-note">The ${n} “Assumption” ${n === 1 ? 'entry rests' : 'entries rest'} on the company profile, not on the website: ${n === 1 ? 'it shapes' : 'they shape'} the questions asked, never a verified conclusion. Stating them on the website makes them verifiable.</p>` : '';
  })()}`;
}

const CLASS_TONE: Record<string, [string, Tone]> = {
  direct: ['Direct competitor', 'bad'], adjacent: ['Adjacent competitor', 'warn'], substitute: ['Substitute / alternative', 'info'], unverified: ['Unverified candidate', 'neutral'], excluded: ['Excluded', 'neutral'],
};

/** Stage 3: the discovery pipeline and the candidate register. */
function discoveryBlock(ctx: Context): string {
  const cands = ctx.research?.candidates ?? [];
  if (!cands.length) return '';
  const disc = ctx.research?.candidateDiscovery;
  const n = (k: string) => cands.filter((c) => c.classification === k).length;
  const stage = (v: number, label: string, sub: string, tone: string) => `<div class="v2-pipe-stage" style="border-color:${tone}"><b>${v}</b><span>${e(label)}</span><small>${e(sub)}</small></div>`;
  const pipeline = `<div class="v2-pipe">${stage(disc?.found ?? cands.length, 'Found', 'in this report’s search results, AI answers and profiles', PALETTE.greyMid)}<i>›</i>${stage(cands.length, 'Checked', 'own website read', PALETTE.blue)}<i>›</i>${stage(n('direct') + n('adjacent'), 'Competitors', `${n('direct')} direct · ${n('adjacent')} adjacent`, PALETTE.red)}<i>›</i>${stage(n('substitute'), 'Substitutes', 'agencies / alternatives', PALETTE.teal)}<i>›</i>${stage(n('unverified') + n('excluded'), 'Not compared', `${n('unverified')} unverified · ${n('excluded')} excluded`, PALETTE.greyMid)}</div>`;
  // The strongest source, cut at a word, plus how many more.
  const srcText = (c: Candidate) => {
    const all = [...new Set(c.sources.map((x) => x.detail))];
    const first = all[0] ?? '';
    const cut = first.length > 90 ? `${first.slice(0, 90).replace(/\s+\S*$/, '')}…”` : first;
    return `${cut}${all.length > 1 ? ` (+${all.length - 1} more)` : ''}`;
  };
  const list = competitorShortlist(ctx);
  const tierRow = (tier: string) => `<tr class="v2-tier"><td colspan="4"><b>${e(tier)}</b></td></tr>`;
  let lastTier = '';
  const table = list.length ? `<table class="v2-table v2-compact"><thead><tr><th style="width:18%">Company</th><th>Why (from its own pages)</th><th style="width:26%">Market focus · size</th><th style="width:22%">Found via · identity</th></tr></thead><tbody>${
    list.map((c) => {
      const head = c.tier !== lastTier ? tierRow(TIER_LABEL[c.tier]) : '';
      lastTier = c.tier;
      const [t, tone] = CLASS_TONE[c.classification];
      return `${head}<tr><td><strong>${e(c.name)}</strong>${c.domain && c.domain !== c.name ? `<br/><small>${e(c.domain)}</small>` : ''}<br/>${pill(t, tone)}</td><td><small>${e(c.rationale)}</small></td><td><small>${e(c.fitNote)}</small></td><td><small>${e(srcText(c))}<br/><em>${e([c.domainBasis, /^Domain inferred/.test(c.domainBasis ?? '') ? null : `Identity: ${c.identityVerified ? 'confirmed — ' + c.identityBasis : c.identityBasis}`].filter(Boolean).join(' · '))}</em></small></td></tr>`;
    }).join('')
  }</tbody></table>` : `<p class="v2-note">No candidate was confirmed as a competitor on its own pages in this run.</p>`;
  const compared = cands.filter((c) => ['direct', 'adjacent', 'substitute'].includes(c.classification)).length;
  const beyond = compared > list.length ? `<p class="v2-note">${compared - list.length} further confirmed compan${compared - list.length === 1 ? 'y ranks' : 'ies rank'} below these eight (less capability overlap or a different focus) and ${compared - list.length === 1 ? 'is' : 'are'} not listed.</p>` : '';
  const unverified = cands.filter((c) => c.classification === 'unverified');
  const unNote = unverified.length ? `<p class="v2-note">Not compared (${unverified.length}): ${e(unverified.slice(0, 8).map((c) => `${c.name} — ${c.rationale.replace(/\.$/, '')}`).join('; '))}.</p>` : '';
  const excluded = cands.filter((c) => c.classification === 'excluded');
  const exNote = excluded.length ? `<p class="v2-note">Excluded (${excluded.length}): publishers, platforms and directories — sources buyers read, not competitors (${e(excluded.filter((c) => /publisher/.test(c.rationale)).map((c) => c.domain).slice(0, 8).join(', '))}); and companies whose own pages state none of ${e(ctx.brand)}’s capabilities (${e(excluded.filter((c) => /Irrelevant/.test(c.rationale)).map((c) => c.domain).slice(0, 8).join(', ') || 'none')}).${disc && disc.found > disc.checked ? ` ${disc.found - disc.checked} further candidates with less evidence were not checked.` : ''}</p>` : '';
  const provisional = ctx.research?.candidatesProvisional ? `<p class="v2-note"><b>Provisional:</b> ${e(ctx.brand)}’s offerings or buyers are not yet established from its own website, so these classes may change once they are.</p>` : '';
  return pipeline + table + beyond + unNote + exNote + provisional + '<p class="v2-note">Rule-based from each company’s own pages (identity, product or service wording, buyer focus, and the same capability definitions as below); not an analyst’s review. Ordered by offering first: direct competitors selling to the same buyers at a comparable size, then larger or differently-focused direct competitors, then alternatives. Size comes only from a stated figure; when none was found it is “not established”, never assumed.</p>';
}

/**
 * Section 1's opening visual: for each shortlisted competitor, how many of the company's
 * website-stated capabilities its own pages also state (the overlap the classification rests on),
 * coloured by shortlist tier. Read from the same candidates as the shortlist table.
 */
function competitorOverlapVisual(ctx: Context): string {
  const list = competitorShortlist(ctx);
  const ownPages = (ctx.research?.offering?.pages ?? []).filter((p) => p.read && p.text).map((p) => ({ url: p.url, text: p.text! }));
  const own = CAPABILITIES.filter((d) => capabilityState(d, ownPages).state === 'confirmed').length;
  if (!list.length || !own) return '';
  const TIER_COLOR: Record<string, string> = { direct_peer: PALETTE.crimson, direct_other: PALETTE.amber, alternative: PALETTE.blue };
  const row = (name: string, sub: string, n: number, color: string) =>
    `<div class="v2-ov-row"><div class="v2-ov-name"><b>${e(name)}</b><small>${e(sub)}</small></div><div class="v2-ov-track">${Array.from({ length: own }, (_, i) => `<i style="background:${i < n ? color : 'transparent'};border-color:${color}"></i>`).join('')}</div><div class="v2-ov-n">${n} of ${own}</div></div>`;
  return `<div class="v2-ov">${row(ctx.brand, 'its own website', own, PALETTE.navy)}${list.map((c) => row(c.name, TIER_LABEL[c.tier].split(' — ')[1] ?? c.tier, Math.min(own, c.overlap.length), TIER_COLOR[c.tier])).join('')}</div>`
    + swatchLegend([[PALETTE.crimson, 'Direct — same buyers'], [PALETTE.amber, 'Direct — much larger or other buyers'], [PALETTE.blue, 'Alternative — part of the offer, or a service']]);
}

/** The appendix's opening visual: every evidence family, its sources' states, and what was missing. */
function sourceAvailabilityVisual(ctx: Context): string {
  const FAMILIES: Array<[AccessRow['family'], string]> = [['website', 'Website'], ['search', 'Search'], ['ai_answers', 'AI answers'], ['social', 'Social profiles'], ['mentions', 'Mentions'], ['reviews', 'Reviews'], ['backlinks', 'Links from other sites'], ['knowledge_graph', 'Knowledge graph'], ['registry', 'Company registry'], ['page_speed', 'Page speed'], ['competitors', 'Competitors']];
  const tone = (a: AccessRow) => (a.reason === 'measured' ? PALETTE.green : a.reason === 'partial' ? PALETTE.blue : a.reason === 'searched_not_found' ? '#9DB7DA' : '#C9D1DC');
  const rows = FAMILIES.map(([fam, label]) => {
    const rs = ctx.ledger.access.filter((a) => a.family === fam);
    if (!rs.length) return '';
    const m = rs.filter((a) => a.reason === 'measured').length;
    const gap = m === rs.length ? null : ctx.diagnostics.find((d) => d.plain && d.key === (CHIP_DIAG[fam] ?? `family:${fam}`))?.plain?.short;
    return `<div class="v2-sa-row"><div class="v2-sa-name">${e(label)}</div><div class="v2-sa-track">${rs.map((a) => `<i style="background:${tone(a)}" title="${e(a.capability)}"></i>`).join('')}</div><div class="v2-sa-n">${m} of ${rs.length} measured${gap ? ` · <em>${e(gap)}</em>` : ''}</div></div>`;
  }).join('');
  return `<div class="v2-sa">${rows}</div>` + swatchLegend([[PALETTE.green, 'Measured'], [PALETTE.blue, 'Partly measured'], ['#9DB7DA', 'Searched, not found'], ['#C9D1DC', 'Not measured (missing data or access)']]);
}

/** The company's own size band, from what it states (register revenue or team size); null when it states none. */
function ownScaleOf(ctx: Context): ScaleBand | null {
  const entries = ctx.research?.register?.entries ?? [];
  const v = (f: string) => entries.find((x) => x.field === f && x.status !== 'conflicting')?.value ?? null;
  return scaleOf({ revenue: v('revenue'), employees: v('team_size') }).band;
}

/** At most eight competitors, offering first: direct peers, then other direct competitors, then alternatives. */
function competitorShortlist(ctx: Context, max = 8) {
  return shortlist(ctx.research?.candidates ?? [], ownScaleOf(ctx), max);
}

/** Stage 4: one capability definition per row, applied to every company. */
function capabilityMatrix(ctx: Context): string {
  const cands = competitorShortlist(ctx);
  const ownPages = (ctx.research?.offering?.pages ?? []).filter((p) => p.read && p.text).map((p) => ({ url: p.url, text: p.text! }));
  if (!cands.length || !ownPages.length) return '';
  const cell = (st: { state: string } | undefined): HeatCell => (st?.state === 'confirmed' ? { text: 'stated on own site', tone: 'top' } : st?.state === 'not_found_in_checked_pages' ? { text: 'not found in checked pages', tone: 'absent' } : { text: 'not checked', tone: 'unmeasured' });
  return heatmap([ctx.brand, ...cands.map((c) => c.name)], CAPABILITIES.map((d) => ({
    label: d.label, sub: 'same definition for every company',
    cells: [cell(capabilityState(d, ownPages)), ...cands.map((c) => cell(c.capabilities[d.key]))],
  }))) + heatLegend([{ tone: 'top', label: 'Stated on the company’s own pages' }, { tone: 'absent', label: 'Not found in checked pages (not proof it is absent)' }, { tone: 'unmeasured', label: 'Not checked' }])
    + `<p class="v2-note">${e(ctx.brand)}’s column uses its own website, not its profile: profile-only claims are not compared as facts.</p>`;
}

/** Section 1's plain-English line from the validated discovery. */
function discoveryPlainEnglish(ctx: Context): string {
  const c = competitorShortlist(ctx);
  const names = (pred: (x: (typeof c)[number]) => boolean) => c.filter(pred).map((x) => x.name);
  const list = (n: string[]) => (n.length <= 2 ? n.join(' and ') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
  const peers = names((x) => x.tier === 'direct_peer');
  const others = names((x) => x.tier === 'direct_other');
  const partial = names((x) => x.classification === 'adjacent');
  const services = names((x) => x.classification === 'substitute');
  // "The same buyers" only when every peer's own pages state a buyer band the company also states.
  const sameBuyers = peers.length > 0 && c.filter((x) => x.tier === 'direct_peer').every((x) => x.focus?.match === true);
  const parts = [peers.length ? `${list(peers)} ${peers.length === 1 ? 'sells' : 'sell'} much the same thing${sameBuyers ? ' to the same buyers' : ''} (stated on ${peers.length === 1 ? 'its' : 'their'} own website${peers.length === 1 ? '' : 's'})`
    : others.length ? 'No direct competitor of comparable size and buyer focus was confirmed' : 'No direct competitor was confirmed on its own website'];
  if (others.length) parts.push(`${list(others)} ${others.length === 1 ? 'competes' : 'compete'} directly but ${others.length === 1 ? 'is' : 'are'} larger or ${others.length === 1 ? 'focuses' : 'focus'} on other buyers`);
  if (partial.length) parts.push(`${list(partial)} ${partial.length === 1 ? 'covers' : 'cover'} part of the offer`);
  if (services.length) parts.push(`${list(services)} ${services.length === 1 ? 'offers' : 'offer'} similar work as a service`);
  return `${parts.join('; ')}. Classified from each company’s own pages by rule, not reviewed by an analyst.`;
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
  const lc = ctx.ledger.crawl;
  const parts = [lc.attempted != null
    ? `The crawler fetched ${lc.attempted} of ${lc.known} known addresses and read ${lc.read}${lc.notAttempted ? ` (the other ${lc.notAttempted} are known only from site analytics and were never fetched)` : ''}`
    : `The crawler read ${lc.evaluated ?? 'none'} of ${lc.known ?? 'the'} known pages`];
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
        if (!r) return { text: 'not tested', tone: 'unmeasured' };
        const state = aiCellState(r);
        if (state !== 'measured_grounded') return { text: AI_STATE_LABEL[state], tone: state === 'source_failed' ? 'low' : 'unmeasured', title: r.claim };
        if (r.accuracy === 'correct') return { text: r.cited ? 'correct, cites site' : 'correct', tone: 'top' };
        if (r.accuracy === 'partly') return { text: 'partly correct', tone: 'mid' };
        if (r.accuracy === 'misidentified') return { text: 'confused with another', tone: 'low' };
        return r.mentioned ? { text: r.cited ? 'named + cited' : 'named', tone: r.cited ? 'top' : 'mid' } : { text: 'not named', tone: 'absent' };
      }),
    };
  })) + heatLegend([
    { tone: 'top', label: 'Named / described correctly' }, { tone: 'mid', label: 'Partly' }, { tone: 'low', label: 'Confused with something else' },
    { tone: 'absent', label: 'Not named' }, { tone: 'low', label: 'Source failed (unknown, not zero)' }, { tone: 'unmeasured', label: 'Not configured / inaccessible / not tested' },
  ]);
  const unmeasured = [...new Set(gen.filter((r) => r.status === 'not_measured').map((r) => `${r.surface}: ${String(r.claim).replace(/^[^:]+:\s*/, '')}`))];
  return grid + (unmeasured.length ? `<p class="v2-note">${unmeasured.map(e).join('<br/>')}</p>` : '');
}

/** Per buyer intent: grounded answers that named the brand, grounded answers that did not, and no grounded answer. */
function intentBars(ctx: Context): string {
  const gen = ctx.research?.generative.filter((r) => r.query && r.kind !== 'ai_overview' && !isBrandQuestion(r, ctx.brand)) ?? [];
  if (!gen.length) return '';
  const intents = [...new Set(gen.map((r) => String(r.intent ?? 'category')))];
  return stackedRows(intents.map((it) => {
    const rs = gen.filter((r) => String(r.intent ?? 'category') === it);
    const ok = rs.filter((r) => r.status === 'observed');
    return { label: `${INTENT_LABEL[it] ?? cap(it)} (${new Set(rs.map((r) => r.query)).size} question${new Set(rs.map((r) => r.query)).size === 1 ? '' : 's'})`, segments: [
      { label: 'Named', count: ok.filter((r) => r.mentioned).length, color: PALETTE.green },
      { label: 'Grounded, not named', count: ok.filter((r) => !r.mentioned).length, color: PALETTE.orange },
      { label: 'No grounded answer', count: rs.length - ok.length, color: PALETTE.greyMid },
    ] };
  })) + swatchLegend([[PALETTE.green, `${ctx.brand} named`], [PALETTE.orange, 'Grounded answer, not named'], [PALETTE.greyMid, 'No grounded answer (failed, not configured or inaccessible)']]);
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
      const [label, tone] = read.length ? [read.length === aio.length ? 'Measured, grounded' : 'Measured, grounded (partly)', (read.length === aio.length ? 'good' : 'info') as Tone] : ['Source failed', 'bad' as Tone];
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
      const state: AiState = row?.state ?? aiStateOf(reason);
      const [label, tone] = AI_STATE_PILL[state];
      const grounded = state === 'measured_grounded';
      rows.push(`<tr><td><strong>${e(rs[0].surface)}</strong><br/><small>${e(row?.surfaceType ?? '')} · ${e(rs[0].geography || 'locale not recorded')} · ${e(fmtDate(rs[0].observedAt) ?? '')}</small></td><td>${pill(label, tone)}</td><td>${grounded ? `${ok.length} of ${rs.length} answered` : '—'}</td><td>${grounded ? `${e(said)}<br/><small>${e(rs[0].geography ?? '')}</small>` : `<small>${e(access?.outcome ?? '')}</small>`}</td></tr>`);
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
  // Superseded providers are named with the state the public research recorded — measured or not.
  const superseded = all.filter((p) => !providers.includes(p)).map((p) => ctx.ledger.ai.find((a) => a.label === (PROVIDER_LABEL[p] ?? p)))
    .filter((a): a is Ledger['ai'][number] => Boolean(a)).map((a) => `${a.label.replace(/ \(.*\)$/, '')} (${AI_STATE_LABEL[a.state]})`);
  const note = dropped.length ? `<p class="v2-note">Scoring run of ${e(ctx.generated)}. ${e(dropped.join(', '))} ${dropped.length === 1 ? 'is' : 'are'} not shown here because the public research in this report asked ${dropped.length === 1 ? 'it' : 'them'} the buyer questions directly; ${dropped.length === 1 ? 'its' : 'their'} state there: ${e(superseded.join(', '))}.</p>` : '';
  if (!providers.length) return note;
  const classes = [...new Set(cells.map((c) => String(c.query_class)))];
  return note + heatmap(classes.map((c) => cap(c.replace(/_/g, ' '))), providers.map((prov) => ({
    label: proper(prov),
    cells: classes.map((q): HeatCell => {
      const c = cells.find((x) => x.provider === prov && x.query_class === q);
      if (!c) return { text: AI_STATE_LABEL.unknown, tone: 'unmeasured' };
      const reason = String(c.reason_unavailable ?? '');
      // The same per-cell classification as the ledger, so the grid and the access matrix agree.
      const outcome = runCellOutcome(c);
      if (outcome === 'answered') return { text: `measured, grounded: ${Math.round((num(c.citation_rate) ?? 0) * 100)}% cited`, tone: 'top' };
      if (outcome === 'ungrounded') return { text: AI_STATE_LABEL.answered_not_grounded, tone: 'self', title: reason };
      if (outcome === 'failed') return { text: AI_STATE_LABEL.source_failed, tone: 'low', title: reason };
      if (/not configured/i.test(reason)) return { text: AI_STATE_LABEL.not_configured, tone: 'unmeasured', title: reason };
      return { text: AI_STATE_LABEL.not_tested, tone: 'unmeasured', title: reason };
    }),
  }))) + heatLegend([
    { tone: 'top', label: 'Measured, grounded' }, { tone: 'self', label: 'Answered, not grounded (not counted)' },
    { tone: 'low', label: 'Source failed' }, { tone: 'unmeasured', label: 'Not configured / not tested / unknown' },
  ]);
}

function proposedQueries(ctx: Context): string {
  const q = ctx.research?.proposedQueries ?? [];
  if (!q.length) return '';
  return `<table class="v2-table v2-compact"><thead><tr><th style="width:44%">Query</th><th>Basis</th><th style="width:12%">Status</th></tr></thead><tbody>${
    q.map((x) => `<tr><td>${e(x.query)}</td><td><small>${e(plainTerm(x.basis))}</small></td><td>${pill(x.status === 'run' ? 'Run' : 'Proposed', x.status === 'run' ? 'good' : 'neutral')}</td></tr>`).join('')
  }</tbody></table>${(() => {
    const run = q.filter((x) => x.status === 'run').length;
    const notRun = q.length - run;
    if (!notRun) return '';
    const why = ctx.diagnostics.find((d) => d.key === 'search')?.plain?.why;
    return `<p class="v2-note">${run ? `${run} run in this report; ` : ''}${notRun} not run${why ? `: ${e(why.replace(/\.$/, ''))}` : ' in this report'}. The leading queries run on the next report once searches are available.</p>`;
  })()}`;
}

function renderSearch(ctx: Context): string {
  const r1 = ctx.payload.report1;
  const search = searchView(ctx);
  const gen = generativeView(ctx);
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  const disc = pillarOf(ctx, 'discoverability');
  const three = `<div class="v2-vis3">
    <div class="v2-vis v2-vis-warn"><div class="v2-vis-n">1</div><div><h4>Search visibility</h4><div class="v2-vis-value">${e(search?.line ?? `Not measured — ${ctx.diagnostics.find((d) => d.key === 'search')?.plain?.short ?? 'no result observed'}`)}</div><small>What search engines actually returned · ${e(search?.source ?? '')}</small></div></div>
    <div class="v2-vis v2-vis-warn"><div class="v2-vis-n">2</div><div><h4>Visibility in AI answers</h4><div class="v2-vis-value">${e(gen.line)}</div><small>What AI search tools retrieved and cited · ${e(gen.note)}</small></div></div>
    <div class="v2-vis v2-vis-info"><div class="v2-vis-n">3</div><div><h4>Readiness</h4><div class="v2-vis-value">Discoverability ${disc?.value ?? '—'}${disc?.state === 'measured' ? '' : '*'} · extraction ${extraction?.value ?? '—'}/100</div><small>How well the site is built to be found and quoted · *inferred, not rankings</small></div></div>
  </div>
  <p class="v2-note">These are kept apart on purpose: a well-built site is not the same as a site that appears in results, and an AI model that has heard of a brand is not the same as an AI search tool that retrieves it today. The <b>AI Surface Presence</b> score in section 5 (${e(aiDimText(ctx))}) is a separate measure from the scoring run's on-site checks; it is <b>not</b> calculated from the AI answers in this section.</p>`;

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
    ${twoWayPanel(ctx, false) ? block('Visibility both ways: found, and recognised', 'Being found by buyers who do not know the name, and being recognised as the company when the name — or an exact description of what it does — is searched.', twoWayPanel(ctx, false)) : ''}
    ${searchMatrix(ctx) ? block('Search results by buyer question', 'Where the brand and its validated competitors appeared, query by query.', searchMatrix(ctx), 'v2-allow-break') : ''}
    ${intentBars(ctx) ? block('Buyer questions by intent', 'Each question was asked of every AI tool; bars show what came back. Grey is no grounded answer — unknown, not zero.', intentBars(ctx)) : ''}
    ${aiAnswerGrid(ctx) ? block('What AI search tools say, question by question', 'Each answer was built from live web sources the tool cites. Buyer questions: is the brand named? Brand-name questions: is it described correctly?', aiAnswerGrid(ctx), 'v2-allow-break') : ''}
    ${aiShareOfVoice(ctx) ? block('Who AI answers recommend instead', 'Brands named in the answers to buyer questions.', aiShareOfVoice(ctx)) : ''}
    ${aiCitedSources(ctx) ? block('Where AI answers get their information', null, aiCitedSources(ctx)) : ''}
    ${generativeMatrix(ctx) ? block('AI search tools checked', 'Only answers retrieved from the live web, with checkable sources, count as visibility. Answers from a model’s memory are excluded.', generativeMatrix(ctx), 'v2-allow-break') : ''}
    ${aiGrid(ctx) ? block('AI answer engines checked by the report run', 'By provider and question type. Only a grounded answer counts; every other outcome is shown by its reason.', aiGrid(ctx)) : ''}
    ${proposedQueries(ctx) ? block(`Searches potential customers might make${(ctx.research?.proposedQueries ?? []).some((x) => x.status === 'run') ? '' : ' — not yet run'}`, 'Built from what the company offers and who it sells to (section 1), never from a category label.', proposedQueries(ctx)) : ''}
    ${runTable ? block('Queries checked by the report run (generic)', 'Built from the declared category label, not from buyer questions: shown for completeness, not as evidence of what customers search for.', runTable, 'v2-allow-break') : ''}
    ${domainTable ? block('Domains seen in the report run’s results', null, domainTable) : ''}
    ${bingSearch(ctx) ? block('Bing search performance (Webmaster Tools)', 'From the site’s verified Bing Webmaster Tools account: the queries the site was shown for in Bing, with impressions, clicks and average position. Bing updates these weekly.', bingSearch(ctx)) : ''}
  `);
}

/** Bing Webmaster Tools query stats for the verified site; empty unless measured. */
function bingSearch(ctx: Context): string {
  const b = ctx.research?.bingWebmaster;
  if (!b || b.status !== 'measured' || !b.search) return '';
  const s = b.search;
  const c = b.crawl;
  const crawl = c ? `<p class="v2-note">Bing crawl and index on ${e(c.date ?? '')}: ${c.inIndex ?? '—'} pages in Bing’s index, ${c.crawledPages ?? '—'} crawled that day, ${c.crawlErrors ?? '—'} crawl errors, ${c.blockedByRobotsTxt ?? '—'} blocked by robots.txt (Bing’s daily figures${c.stale ? '; the newest row is more than a week old — stale' : ''}).</p>` : '';
  if (!s.queries.length) return `<p class="v2-note">Bing Webmaster Tools reports no search queries for ${e(b.siteUrl ?? ctx.domain)} in the period it keeps. Measured: no Bing impressions recorded.</p>${crawl}`;
  const pos = (v: number | null) => (v != null && v > 0 ? v.toFixed(1) : '—');
  return `<table class="v2-table v2-compact"><thead><tr><th>Query in Bing</th><th class="v2-num" style="width:14%">Impressions</th><th class="v2-num" style="width:11%">Clicks</th><th class="v2-num" style="width:16%">Avg. position shown</th></tr></thead><tbody>${
    s.queries.slice(0, 15).map((q) => `<tr><td>${e(q.query)}</td><td class="v2-num">${q.impressions}</td><td class="v2-num">${q.clicks}</td><td class="v2-num">${pos(q.avgImpressionPosition)}</td></tr>`).join('')
  }</tbody></table><p class="v2-note">${s.impressions} impressions and ${s.clicks} clicks across ${s.queries.length} quer${s.queries.length === 1 ? 'y' : 'ies'}${s.from ? `, ${e(s.from)} to ${e(s.to ?? '')}` : ''}. Bing only — Google search performance needs Search Console access. Bing updates these figures weekly${s.stale ? '; the newest data point is more than three weeks old, so treat them as stale' : ''}.</p>${crawl}`;
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
  const laneTone = (a: DossierAction) => ({ foundation: PALETTE.blue, discover: PALETTE.teal, proof: PALETTE.purple })[laneOf(a)];
  const items: RoadmapItem[] = actions.map((a) => ({
    id: a.id, label: a.title, window: win(a.horizon), dependsOn: a.dependsOn, tone: laneTone(a),
    meta: [a.effort && `${a.effort} effort`, a.confidence && `${a.confidence} confidence`, a.kind === 'measurement' && 'measurement'].filter(Boolean).join(' · '),
  }));
  const empty = [0, 1, 2].filter((w) => !items.some((i) => i.window === w)).map((w) => ['Days 0–30', 'Days 31–60', 'Days 61–90'][w]);
  const map = roadmap(items, ['Days 0–30', 'Days 31–60', 'Days 61–90'])
    + swatchLegend([[PALETTE.blue, 'Fix the foundation'], [PALETTE.teal, 'Get found in the searches customers make'], [PALETTE.purple, 'Build independent proof and measure again']])
    + (empty.length ? `<p class="v2-note">${e(empty.join(' and '))}: nothing scheduled. No action was scheduled there by a source or falls there by effort; the window is left empty rather than filled with generic work.</p>` : '');

  const levers = actions.filter((a) => a.lever).sort((a, b) => (b.lever!.overallGain - a.lever!.overallGain));
  const leverTable = levers.length ? `<table class="v2-table"><thead><tr><th>Dimension</th><th class="v2-num">Now</th><th class="v2-num">Target</th><th class="v2-num">Pillar gain</th><th class="v2-num">Index gain</th><th>Action</th></tr></thead><tbody>${
    levers.map((a) => `<tr><td>${e(a.lever!.dimension)}</td><td class="v2-num" style="color:${scoreColor(a.lever!.now)}">${a.lever!.now}</td><td class="v2-num">${a.lever!.target}</td><td class="v2-num">+${a.lever!.pillarGain}</td><td class="v2-num"><strong>+${a.lever!.overallGain}</strong></td><td><span class="v2-id">${e(a.id)}</span></td></tr>`).join('')
  }</tbody></table><p class="v2-note">Projected by re-running the report's own scoring with the dimension raised to its target; each gain is computed on its own. A projection is a hypothesis to test, not a forecast.</p>` : '';

  const pillarChart = barChart(ctx.pillars.map((p) => ({ label: p.label, value: p.value, tag: pillarTag(p), note: 'insufficient evidence' })));

  return section(5, 'Priorities and roadmap', 'What should happen first, in what order, and how will each step be verified?',
    'Start with the moves the evidence supports most and that unblock others; close the measurement gaps in parallel so the next report can show whether the changes worked.', `
    ${block('What drives the Authority Index', 'The five pillars behind the index. A pillar with no evidence has no value and is left out of the index, never scored as zero.', pillarChart)}
    ${plotted.length ? block('Impact versus effort', 'Where each action sits by its stated impact and effort.', matrix) : ''}
    ${block('Action register', `One register: ${actions.length} actions, each with one id. The summary pages, findings and roadmap all point here.`, register, 'v2-allow-break')}
    ${block('30/60/90-day roadmap', 'Arrows run from a prerequisite to the action that depends on it.', map)}
    ${leverTable ? block('Score levers', 'Where an action moves a weak dimension, the projected effect on the score.', leverTable) : ''}
    ${missingDataTable(ctx) ? block('Missing data — and what gets it measured', 'The sources this report could not complete, in plain terms: which data or access was missing, and who can provide it.', missingDataTable(ctx)) : ''}
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
export const notObservedWording = (text: string): string => text.replace(/\b(\d+) unreachable\b/gi, '$1 not observed')
  // "robots.txt not found" says where it was looked for.
  .replace(/\b(robots\.txt|llms\.txt|sitemap(?:\.xml)?) not found\b(?! on)/gi, '$1 not found on the site');

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
      const st = r.query && pack.generative.includes(r) ? { text: cap(AI_STATE_LABEL[aiCellState(r)]) } : stateLabel(r.status);
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
    const na = ctx.ledger.crawl.notAttempted;
    const detail = notObservedWording(String(c.detail ?? '')).replace(/\b(\d+) not observed\b/g, (m, n) => (na != null && Number(n) === na ? `${n} never fetched (analytics only)` : m));
    return `<tr><td><small>${e(g.label)}</small></td><td>${e(c.label)}</td><td>${pill(text, tone)}</td><td><small>${e(detail)}</small></td></tr>`;
  })).join('');

  const audit = ctx.registry.audit;
  const auditBody = `<p>${audit.candidates} recommendations and evidence gaps arrived from ${Object.values(audit.bySource).filter((n) => n > 0).length} sources (${Object.entries(audit.bySource).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ')}). They resolve to ${audit.actions} actions; ${audit.merges.length} restatements were merged:</p>
    <table class="v2-table v2-compact"><thead><tr><th style="width:30%">Merged into</th><th style="width:18%">From</th><th>Restated as</th></tr></thead><tbody>${
      audit.merges.map((m) => `<tr><td class="v2-id">${e(m.into)}</td><td><small>${e(m.from.replace(/_/g, ' '))}</small></td><td><small>${e(m.title)}</small></td></tr>`).join('')
    }</tbody></table>`;

  const method = `<table class="v2-table"><tbody>
    <tr><td style="width:24%"><strong>Authority Index</strong></td><td>Geometric mean of the pillar scores that have a value. A pillar with no evidence is excluded, not counted as zero, so the index can rest on fewer than five pillars.</td></tr>
    <tr><td><strong>Pillar score</strong></td><td>Mean of the pillar's dimensions that have a value. Measured when observed; inferred when estimated from on-site evidence.</td></tr>
    <tr><td><strong>Discoverability</strong></td><td>Topical Authority (mean of an on-site topical score and the content-quality score) plus AI Surface Presence (the scoring run's own AI checks). ${aiDimMeasured(ctx) ? 'In this report AI Surface Presence has a value.' : 'In this report AI Surface Presence has no value, so the pillar rests on the on-site part alone: readiness to be found, not observed rankings.'} The public research's search results and AI answers are reported separately and never feed it.</td></tr>
    <tr><td><strong>Index stage</strong></td><td>Foundational 0–24 · Emerging 25–39 · Developing 40–54 · Operational 55–69 · Advanced 70–84 · Leading 85–100.</td></tr>
    <tr><td><strong>Score bands</strong></td><td>Pillar and dimension scores use foundational 0–24 · developing 25–49 · operational 50–74 · leading 75+.</td></tr>
    <tr><td><strong>Scoring inputs</strong></td><td>Six: crawl, content, backlinks, AI answers, competitors, reviews. Measured when the dimension each feeds has a measured value; partly when inferred.</td></tr>
    <tr><td><strong>Evidence sources</strong></td><td>The ${ctx.ledger.access.length} sources in the access matrix (every source the report depends on). The cover and summary count these: ${ctx.ledger.coverage.measured} measured, ${ctx.ledger.coverage.partial} partly.</td></tr>
    <tr><td><strong>AI answer states</strong></td><td>One vocabulary throughout: measured, grounded (built from live web search, with sources — the only state that counts); answered, not grounded; source failed; not configured; not tested; inaccessible; unknown. Denominators: questions sent → grounded answers → grounded answers to buyer questions → answers naming the company.</td></tr>
    <tr><td><strong>Crawl funnel</strong></td><td>Known addresses → fetched → answered → read → evaluated. Addresses never fetched (known only from site analytics) are not failures.</td></tr>
    <tr><td><strong>Search visibility</strong></td><td>The search provider's own ranks for the listed queries, within the results returned. Not found within that depth is not a rank of zero and does not mean the site is not indexed.</td></tr>
    <tr><td><strong>Visibility in AI answers</strong></td><td>Counts only answers retrieved from the live web with checkable sources. Answers from a model’s memory, failures and unconfigured tools are shown by reason and never counted.</td></tr>
    <tr><td><strong>Competitors</strong></td><td>Candidates from the brand’s own buyer searches; included only after checking each company’s own site for the same product, buyer and job. Label or name overlap is not enough.</td></tr>
  </tbody></table>`;

  const glossary = `<table class="v2-table v2-compact"><tbody>${GLOSSARY.map(([t, d]) => `<tr><td style="width:22%"><strong>${e(t)}</strong></td><td><small>${e(d)}</small></td></tr>`).join('')}</tbody></table>`;

  return section(6, 'Evidence appendix', 'What was observed, where it came from, and how the numbers are calculated.',
    'Everything needed to check a conclusion: each source and its age, every research observation with its id and link, the open gaps and how to close them, each finding, every website check, and how scores are calculated.', `
    ${block('Where the information came from: source availability', `Each evidence family and how many of its ${ctx.ledger.access.length} sources this run could measure. Grey is missing data or access, labelled with what was missing — unknown, not poor.`, sourceAvailabilityVisual(ctx))}
    ${block('Source diagnostics', 'Every source: what was sought, what happened (with the provider’s own words where it refused), why — or “cause unconfirmed” — what it costs the conclusions, and the cheapest compliant next step.', diagnosticsTable(ctx), 'v2-allow-break')}
    <!--V2-VALIDATION-->
    ${block('Scoring inputs', 'The six inputs the Authority Index rests on, and whether each was measured. This is narrower than the access matrix above, which covers every source the report uses.', `<table class="v2-table v2-compact"><tbody>${ctx.sources.map((src) => {
      const tone: Tone = src.status === 'connected' ? 'good' : src.status === 'partial' ? 'info' : 'neutral';
      const label = src.status === 'connected' ? 'Measured' : src.status === 'partial' ? 'Partly (inferred)' : 'Not measured';
      return `<tr><td style="width:24%"><strong>${e(src.label)}</strong></td><td style="width:20%">${pill(label, tone)}</td><td><small>${e(cap(src.meaning))}. Counts as measured when ${e(src.feeds)} has a measured value.</small></td></tr>`;
    }).join('')}</tbody></table>`)}
    ${block('Evidence states', 'How strongly to read each label, from strongest to weakest. The same labels are used throughout.', ladder)}
    ${block('Evidence freshness', 'When each kind of evidence was collected, against the report date.', freshnessTimeline(ctx))}
    ${gapsList ? block('Unresolved gaps and how to close each', null, gapsList) : ''}
    ${researchRegister ? block('Public research register', 'Every research observation, with its id, source and method.', researchRegister, 'v2-allow-break') : ''}
    ${block('Findings register', 'Every finding once, with its state and the actions that address it.', findings, 'v2-allow-break')}
    ${checkRows ? block('Website checks', null, `<table class="v2-table v2-compact"><thead><tr><th style="width:16%">Area</th><th style="width:26%">Check</th><th style="width:16%">Outcome</th><th>Detail</th></tr></thead><tbody>${checkRows}</tbody></table>`, 'v2-allow-break') : ''}
    ${block('Duplication audit', 'How the action register was assembled.', auditBody, 'v2-allow-break')}
    ${block('Methodology', 'This report covers organic visibility from public and company-declared evidence only. Paid advertising, lead generation and revenue need private data and belong to Report 2.', method, 'v2-allow-break')}
    ${block('Glossary', null, glossary, 'v2-allow-break')}
  `);
}

const AI_STATE_PILL: Record<AiState, [string, Tone]> = {
  measured_grounded: ['Measured, grounded', 'good'], answered_not_grounded: ['Answered, not grounded', 'neutral'], source_failed: ['Source failed', 'bad'],
  not_configured: ['Not configured', 'warn'], not_tested: ['Not tested', 'neutral'], inaccessible: ['Inaccessible', 'neutral'], unknown: ['Unknown', 'neutral'],
};

/** "0/100, inferred" — the scoring run's AI Surface Presence value and state, or "no value". */
const aiDimText = (ctx: Context): string => {
  const d = ctx.pillars.flatMap((p) => p.dims).find((x) => x.key === 'ai_surface_presence');
  return d?.value == null ? 'no value' : `${d.value}/100, ${d.state}`;
};

/** Did the scoring run's AI Surface Presence dimension get a value? */
const aiDimMeasured = (ctx: Context): boolean => ctx.pillars.some((p) => p.dims.some((d) => d.key === 'ai_surface_presence' && d.value != null));

/** A generated positioning assessment ("… is currently strong: …"), as opposed to a company statement. */
const GENERATED_ASSESSMENT = /positioning as .{3,} is currently (strong|moderate|weak)\b/i;

const PURPOSE_NOTE: Record<string, string> = {
  'Account and app screens': 'signed-in product screens',
  Legal: 'short by design', Other: 'purpose not clear from the address',
};

/** Evidence dates in collection order, each with its gap to the report: crawl, research, footprint, offering check. */
function freshnessTimeline(ctx: Context): string {
  const pts: Array<[string, string | null | undefined]> = [
    ['Website crawl', ctx.ledger.crawl.lastCrawledIso], ['Google search results (stored)', ctx.research?.search.find((r) => r.status === 'observed')?.observedAt],
    ['Public research (AI answers, competitors)', ctx.research?.collectedAt],
    ['Profiles and mentions', ctx.research?.footprint?.checkedAt], ['Offering check (website pages)', ctx.research?.offering?.checkedAt],
    ['Report generated', ctx.generatedIso],
  ];
  const dated = pts.filter((x): x is [string, string] => Boolean(x[1]) && Number.isFinite(Date.parse(String(x[1]))))
    .map(([label, d]) => ({ label, d, t: Date.parse(d) })).sort((x, y) => x.t - y.t);
  if (!dated.length) return '<p class="v2-note">No evidence dates were recorded.</p>';
  const report = Date.parse(ctx.generatedIso);
  const rel = (t: number) => {
    const h = Math.round((t - report) / 3_600_000);
    return t === report ? 'the report' : `${Math.abs(h) < 1 ? 'under an hour' : `${Math.abs(h)} h`} ${t < report ? 'before' : 'after'} the report`;
  };
  return `<ol class="v2-timeline" style="grid-template-columns:repeat(${dated.length}, 1fr)">${dated.map((x) => `<li class="${x.label === 'Report generated' ? 'is-report' : x.t > report ? 'is-after' : ''}"><b>${e(fmtDate(x.d) ?? '')} ${e(new Date(x.d).toISOString().slice(11, 16))} UTC</b><span>${e(x.label)}</span><em>${e(rel(x.t))}</em></li>`).join('')}</ol>
    <p class="v2-note">Items collected after the report was generated (profiles, mentions, the offering check) were gathered for this regeneration and carry their own date.</p>`;
}

const REASON_PILL: Record<string, [string, Tone]> = {
  measured: ['Measured', 'good'], partial: ['Partly measured', 'info'], searched_not_found: ['Searched, not found', 'neutral'], not_searched: ['Not attempted', 'neutral'],
  missing_credential: ['Not configured', 'warn'], no_adapter: ['No supported access', 'neutral'], restricted: ['Sign-in / bot wall', 'warn'],
  request_failed: ['Configured, failed', 'bad'], quota_restricted: ['Quota / plan limit', 'bad'], ungrounded: ['Memory only', 'neutral'],
};

const DIAG_TONE = (s: DiagState): Tone => (s === 'measured' ? 'good' : s === 'partial' ? 'info' : ['searched_not_found', 'not_attempted', 'unsupported_capability'].includes(s) ? 'neutral' : ['not_configured', 'login_restricted', 'permission_denied'].includes(s) ? 'warn' : 'bad');

function diagnosticsTable(ctx: Context): string {
  return `<table class="v2-table v2-compact v2-access"><thead><tr><th style="width:21%">Source · state</th><th style="width:30%">What happened · why</th><th style="width:19%">What it costs the report</th><th>Next step · cost · needs</th></tr></thead><tbody>${
    // Four readable columns: the source with its state, then what happened and why, the cost to the report, the fix.
    ctx.diagnostics.map((d) => `<tr data-diag="${e(d.key)}"><td><strong>${e(d.source)}</strong><br/>${pill(DIAG_LABEL[d.state], DIAG_TONE(d.state))}${d.causeConfirmed ? '' : ' <em class="v2-unconf">cause unconfirmed</em>'}<br/><small>${e(d.family)} · credential ${e(d.credential)}${d.integration === 'implemented' ? '' : ` · integration ${e(d.integration)}`}</small></td>
      <td><small>${e(d.attempt)}</small>${d.cause && d.cause !== '—' ? `<br/><small><b>Why:</b> ${e(d.cause)}</small>` : ''}</td><td><small>${e(d.impact)}</small></td>
      <td><small>${e(d.next)}<br/><b>Cost:</b> ${e(d.cost)}${d.needs.length ? ` · <b>needs:</b> ${e(d.needs.join(', '))}` : ''}${d.unlocks && d.unlocks !== '—' ? `<br/><b>Unlocks:</b> ${e(d.unlocks)}` : ''}${d.docUrl ? `<br/><span class="v2-src">${e(d.docUrl.replace(/^https?:\/\//, ''))}</span>` : ''}</small></td></tr>`).join('')
  }</tbody></table><p class="v2-note">Credentials are recorded as present, absent or rejected only — never their values. Provider facts and prices are from the official pages linked, read on 25 Oct 2026; where a page did not state a price, the cost is “unknown”. Checks marked local ran from the analyst’s workstation and may differ from production.</p>`;
}

function accessMatrix(ctx: Context): string {
  const yn = (v: boolean | null) => (v === true ? 'yes' : v === false ? 'no' : '—');
  return `<table class="v2-table v2-compact v2-access"><thead><tr><th style="width:17%">Source</th><th style="width:11%">Adapter · credential · attempted</th><th style="width:14%">State</th><th>What happened</th><th style="width:26%">Cheapest compliant next step</th></tr></thead><tbody>${
    ctx.ledger.access.map((a) => {
      const [label, tone] = a.family === 'ai_answers' ? AI_STATE_PILL[aiStateOf(a.reason)] : REASON_PILL[a.reason] ?? [a.reason, 'neutral' as Tone];
      return `<tr><td><strong>${e(a.capability)}</strong><br/><small>${a.source === 'research' ? 'public research' : 'report run'}</small></td><td><small>${yn(a.adapter)} · ${yn(a.credential)} · ${yn(a.attempted)}</small></td><td>${pill(label, tone)}</td><td><small>${e(a.outcome)}</small></td><td><small>${e(a.nextStep ?? '—')}</small></td></tr>`;
    }).join('')
  }</tbody></table><p class="v2-note">"Not configured" is a configuration fact; "searched, not found" needs a search that ran; "sign-in / bot wall" means the platform refused a signed-out visitor. Credentials are recorded as present or absent only.${ctx.research?.runtime ? ` Configuration checked ${e(fmtDate(ctx.research.runtime.checkedAt) ?? '')}.` : ' This report has no runtime configuration record, so configuration states come from the report run.'}</p>`;
}

function validationBlock(v: ValidationResult): string {
  const rows = v.issues.length
    ? `<table class="v2-table v2-compact"><thead><tr><th style="width:16%">Rule</th><th style="width:14%">Severity</th><th>Detail</th></tr></thead><tbody>${v.issues.map((i) => `<tr><td>${e(i.rule)}</td><td>${i.blocking ? pill('Blocking', 'bad') : pill('Advisory', 'warn')}</td><td><small>${e(i.detail)}</small></td></tr>`).join('')}</tbody></table>`
    : '';
  // Marked so a later check of the finished artifact reads the report, not its own rule list.
  return `<!--V2-CHECK-START-->${block('Consistency check', v.passed ? 'Passed: no material contradiction found in counts, sources, scores or actions.' : 'Contradictions found — the conclusions below them should be read with care.',
    `<ul class="v2-list">${v.checks.map((c) => `<li><small>${e(c)}</small></li>`).join('')}</ul>${rows}`)}<!--V2-CHECK-END-->`;
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
</body></html>`.replace(/<body data-dossier="v2">[\s\S]*<\/body>/, (b) => withoutConfigNames(b));
  // Validate the finished report against its own ledger; results are printed and logged.
  const validation = validateReport(ctx.ledger, ctx.registry, html, ctx.pillars, ctx.research);
  if (!validation.passed) console.warn('[dossier-v2] consistency check failed', { domain: ctx.domain, issues: validation.issues.filter((i) => i.blocking).map((i) => `${i.rule}: ${i.detail}`) });
  lastValidation = validation;
  return html.replace('<!--V2-VALIDATION-->', validationBlock(validation));
}

/**
 * Configuration names (FOO_API_KEY) are operator detail, not customer copy. Upstream texts that
 * carry them ("Set PERPLEXITY_API_KEY to…") are restated before the report is assembled.
 */
export function withoutConfigNames(html: string): string {
  return html
    .replace(/\b(?:Set|Add|Configure)\s+(?:[A-Z][A-Z0-9]*_)+(?:API_)?KEY\b(?:\s+to\s+(?:enable|ask))?/g, (m) => (/ask$/.test(m) ? 'Connect a credential to ask' : 'Connect the provider credential'))
    .replace(/\b(?:[A-Z][A-Z0-9]*_)+(?:API_)?KEY\b/g, 'a provider credential')
    .replace(/\s*\((?:or\s+)?[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:=[\w.]+)?\)/g, '')
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+=[\w.]+/g, 'the provider setting');
}

/** The consistency check over a rendered artifact, against the ledger its inputs produce. */
export function validateDossierV2Html(payload: CanonicalExportPayload, branding: DossierV2Branding, research: unknown, html: string): ValidationResult {
  const ctx = buildContext(payload, branding, parseResearchPack(research, branding.domain ?? null));
  return validateReport(ctx.ledger, ctx.registry, html, ctx.pillars, ctx.research);
}

/** The consistency result of the most recent render in this process (for tests and diagnostics). */
export let lastValidation: ValidationResult | null = null;

export { buildDossierRegistry };
