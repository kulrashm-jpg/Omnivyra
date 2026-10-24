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
import { parseResearchPack, summariseVisibility, type ResearchPack, type ResearchRecord } from './research';
import { DOSSIER_V2_CSS } from './styles';

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
  const line = grounded
    ? `Mentioned in ${mentioned} of ${grounded} grounded AI answer${grounded === 1 ? '' : 's'} read`
    : 'Not measured — no grounded AI answer was read';
  const parts: string[] = [];
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
    <div>Evidence sources measured<strong>${connected} of ${ctx.sources.length}</strong></div>
    <div>Generated<strong>${e(ctx.generated)}</strong>${ctx.research ? `<em>Public research ${e(fmtDate(ctx.research.collectedAt) ?? ctx.research.collectedAt)}</em>` : ''}</div>
  </div>
</section>`;
}

// ── Summary page 1 — What is happening ──────────────────────────────────────

function renderSummaryNow(ctx: Context): string {
  const overall = obj(obj(ctx.payload.authority_overview)?.overall_score) ?? {};
  const index = num(overall.value);
  const disc = pillarOf(ctx, 'discoverability');
  const mom = pillarOf(ctx, 'momentum');
  const trust = pillarOf(ctx, 'trust');
  const kpi = (value: string, label: string, note: string, color: string) =>
    `<div class="v2-tile" style="border-top-color:${color}"><div class="v2-tile-value" style="color:${color}">${value}</div><div class="v2-tile-label">${e(label)}</div><div class="v2-tile-note">${e(note)}</div></div>`;
  const tiles = `<div class="v2-tiles4">
    ${kpi(`${index ?? '—'}<small> / 100</small>`, 'Authority Index', `A summary of ${scored(ctx).length} of ${ctx.pillars.length} areas; partial inputs`, PALETTE.blue)}
    ${kpi(`${disc?.value ?? '—'}${disc?.state === 'measured' ? '' : '*'}<small> / 100</small>`, 'Discoverability', '*Inferred from the website: readiness, not rankings', PALETTE.green)}
    ${kpi(`${mom?.value ?? '—'}<small> / 100</small>`, 'Momentum', 'Measured: how recently the site was updated', PALETTE.amber)}
    ${kpi(trust?.value != null ? `${trust.value}<small> / 100</small>` : '—', 'Trust', trust?.value != null ? 'Measured' : 'Insufficient evidence — not zero', PALETTE.greyMid)}
  </div>`;

  const search = searchView(ctx);
  const gen = generativeView(ctx);
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  const visTile = (n: string, title: string, value: string, sub: string, tone: Tone) =>
    `<div class="v2-vis v2-vis-${tone}"><div class="v2-vis-n">${n}</div><div><h4>${e(title)}</h4><div class="v2-vis-value">${e(value)}</div><small>${e(sub)}</small></div></div>`;
  const visibility = `<div class="v2-vis3">
    ${visTile('1', 'Search visibility', search ? search.line : 'Not measured', search ? search.source : 'No search observations', search && search.found < search.checked / 2 ? 'warn' : 'good')}
    ${visTile('2', 'Generative-search visibility', gen.line, gen.note || 'Retrieval-grounded answers only', gen.grounded && gen.mentioned ? 'good' : 'warn')}
    ${visTile('3', 'Website readiness', `Answers hard to lift: extraction readiness ${extraction?.value ?? '—'}/100`, 'How well engines can read and quote the site', (extraction?.value ?? 0) < 25 ? 'bad' : 'warn')}
  </div>`;

  const connected = ctx.sources.filter((s) => s.status === 'connected').length;
  const chips = ctx.sources.map((s) => pill(s.label, s.status === 'connected' ? 'good' : s.status === 'partial' ? 'info' : 'neutral')).join(' ');
  const funnelLine = ctx.crawl.known != null
    ? `<div class="v2-mini-funnel"><span><b>${ctx.crawl.known}</b> known pages</span><i>›</i><span><b>?</b> attempted <em>not recorded</em></span><i>›</i><span><b>${ctx.crawl.read ?? '—'}</b> answered</span><i>›</i><span><b>${ctx.crawl.read ?? '—'}</b> evaluated</span></div>`
    : '';
  const coverage = `<div class="v2-cols v2-tight">
    <div class="v2-panel"><h4>Evidence measured: ${connected} of ${ctx.sources.length} sources</h4><p>${chips}</p><small>Green = measured; blue = partly (inferred); grey = not measured. Grey is unknown, not poor.</small></div>
    <div class="v2-panel"><h4>Website pages read</h4>${funnelLine}<small>${ctx.crawl.unread ? `${ctx.crawl.unread} known pages gave no response. ` : ''}Findings about pages describe the ${ctx.crawl.read ?? ''} that answered.</small></div>
  </div>`;

  const know: Array<[string, string, string]> = [];
  if (search) know.push(['Buyers who do not already know the name are unlikely to find the site in search.', search.found <= (summariseVisibility(ctx.research).search?.brandedFound ?? 0) ? `It appeared only for a search that included the brand name; for category, problem and comparison searches it did not appear in the results checked.` : `It appeared for ${search.found} of ${search.checked} searches checked.`, 'Section 4']);
  const nameCollision = ctx.research?.independent.find((r) => r.kind === 'name_collision');
  const noProof = ctx.research?.independent.some((r) => r.status === 'looked_for_not_found');
  if (nameCollision || noProof) know.push(['Little outside the website vouches for the brand yet.', `${noProof ? 'No review site, directory or press mention was found. ' : ''}${nameCollision ? 'A plain search for the name returns unrelated results with similar spellings.' : ''}`, 'Section 3']);
  know.push(['The website is technically sound but hard for engines to quote, and rarely updated.', `Extraction readiness ${extraction?.value ?? '—'}/100 and content freshness ${mom?.value ?? '—'}/100 are the weakest measured areas.`, 'Section 2']);

  return `<section class="v2-summary" id="summary-now">
  <header class="v2-summary-head"><span>Summary 1 of 2</span><h2>What is happening</h2><p>For leaders who are not marketing specialists: where the brand stands today, in plain English.</p></header>
  ${tiles}
  <h3 class="v2-summary-h">Three kinds of visibility — measured separately</h3>
  ${visibility}
  <h3 class="v2-summary-h">How much of this is measured</h3>
  ${coverage}
  <h3 class="v2-summary-h">Three things to know</h3>
  <ol class="v2-know">${know.slice(0, 3).map(([t, d, where]) => `<li><strong>${e(t)}</strong> ${e(d)} <span class="v2-where">${e(where)}</span></li>`).join('')}</ol>
</section>`;
}

// ── Summary page 2 — What to do next ────────────────────────────────────────

const ownerOf = (a: DossierAction): string => (a.owner ? `${proper(a.owner)} team (person unassigned)` : 'Unassigned');

function renderSummaryNext(ctx: Context): string {
  const actions = ctx.registry.actions;
  const top = actions.filter((a) => a.kind === 'improvement').slice(0, 3);
  const card = (a: DossierAction, i: number) => `<div class="v2-next">
    <div class="v2-next-n">${i + 1}</div>
    <div class="v2-next-body"><h4>${e(a.title)}</h4>
      <dl><dt>Why</dt><dd>${e(a.why ?? a.action)}</dd>
      <dt>Success test</dt><dd>${e(a.verification ?? 'Not defined by the source — see the action register.')}</dd></dl>
      <div class="v2-next-meta"><span>${e(a.id)}</span><span>Owner: ${e(ownerOf(a))}</span><span>Prerequisite: ${e(a.dependsOn.length ? a.dependsOn.join(', ') : 'none')}</span><span>Impact: ${e(a.impact ?? 'not rated')} · Effort: ${e(a.effort ?? '—')}</span></div>
    </div></div>`;

  const windows: Array<[string, string, string]> = [['0-30', 'Days 0–30', 'Measure what is missing'], ['31-60', 'Days 31–60', 'Fix and strengthen'], ['61-90', 'Days 61–90', 'Re-measure and adjust']];
  const strip = `<div class="v2-strip">${windows.map(([h, label, theme]) => {
    const inWin = actions.filter((a) => a.horizon === h);
    return `<div class="v2-strip-col"><div class="v2-strip-head">${e(label)}</div><div class="v2-strip-theme">${e(theme)}</div><div class="v2-strip-count">${inWin.length} action${inWin.length === 1 ? '' : 's'}</div><small>${inWin.length ? inWin.slice(0, 4).map((a) => e(a.id)).join('<br/>') + (inWin.length > 4 ? `<br/>+${inWin.length - 4} more` : '') : 'Nothing scheduled — no action fell here.'}</small></div>`;
  }).join('')}</div>`;

  const gaps = actions.filter((a) => a.kind === 'measurement').slice(0, 5);
  const missing = (a: DossierAction): string => {
    const t = a.title.replace(/^Measure: /, '');
    if (t !== a.action) return t;
    return (a.why ?? t).split(/(?<=\.)\s/)[0];
  };
  const gapList = `<table class="v2-table v2-compact"><thead><tr><th style="width:42%">Not measured</th><th>How to close it</th></tr></thead><tbody>${gaps.map((a) => `<tr><td><strong>${e(missing(a))}</strong></td><td><small>${e(a.action)}</small></td></tr>`).join('')}</tbody></table>`;

  return `<section class="v2-summary" id="summary-next">
  <header class="v2-summary-head"><span>Summary 2 of 2</span><h2>What to do next</h2><p>Three decisions, when to make them, and how to tell whether they worked.</p></header>
  <h3 class="v2-summary-h">Three decisions</h3>
  <div class="v2-next-list">${top.map(card).join('')}</div>
  <h3 class="v2-summary-h">The next 90 days</h3>
  ${strip}
  <h3 class="v2-summary-h">What we could not measure — and how to close it</h3>
  ${gapList}
  <p class="v2-note">Every decision and gap above has one id in the action register (section 5), where effort, confidence, dependencies and evidence are listed. Owners are not recorded anywhere yet, so none is assigned.</p>
</section>`;
}

// ── 1. Market & competitors ─────────────────────────────────────────────────

const CLASS_LABEL: Record<string, { text: string; tone: Tone }> = {
  direct: { text: 'Direct competitor', tone: 'bad' },
  adjacent: { text: 'Adjacent competitor', tone: 'warn' },
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

  const icp = obj(ctx.payload.market_icp_recommendation);
  const attrs = objs(icp?.attributes);
  const icpTable = attrs.length ? `<table class="v2-table"><thead><tr><th style="width:22%">Market attribute</th><th style="width:16%">State</th><th>Value, or what would resolve it</th></tr></thead><tbody>${
    attrs.map((a) => { const st = stateLabel(a.status === 'unavailable' ? 'unavailable' : String(a.status)); return `<tr><td>${e(a.label)}</td><td>${pill(st.text, st.tone)}</td><td><small>${e(a.value ?? a.unlock ?? '—')}</small></td></tr>`; }).join('')
  }</tbody></table>` : '';

  const verifiedNames = pack?.competitors.filter((c) => ['direct', 'adjacent'].includes(String(c.classification))).map((c) => c.name) ?? [];
  return section(1, 'Market and competitors', 'What does the company sell, to whom, and who else competes for that buyer?',
    `${verifiedNames.length ? `Checked against their own websites, ${verifiedNames.join(', ')} compete for the same buyer. ` : 'No competitor set has been validated yet. '}Companies that only share a label such as "decision intelligence", or a similar name, were ruled out rather than compared.`, `
    ${definition ? block('What the company offers — from its own pages', 'The starting point for everything else: buyer problems, search queries and competitor criteria come from this.', definition) : ''}
    ${identity ? block('Company profile versus website', 'What was entered in the company profile next to what the website says. A difference is shown, not resolved.', identity) : ''}
    ${landscape}
    ${icpTable ? block('Market facts the public record does not yet establish', str(icp?.headline), icpTable + (pack?.company.length ? `<p class="v2-note">The company’s own pages state its intended buyers and prices (${e(pack.company.filter((r) => /^(buyers|pricing)/i.test(r.claim)).map((r) => r.id).join(', '))}). That is company-declared intent, not independent market evidence, so these attributes stay unresolved here.</p>` : '')) : ''}
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
    funnelStages.push({ label: 'Answered the crawler', value: ctx.crawl.read, note: ctx.crawl.unread ? 'the rest gave no HTTP response' : undefined });
    funnelStages.push({ label: 'Pages read and evaluated', value: ctx.crawl.read });
  }
  const crawlBody = funnelStages.length
    ? funnel(funnelStages) + `<p class="v2-note">Attempted in this run: <strong>not recorded</strong> — the crawl stores known addresses and the pages that answered, not how many were tried, so the ${ctx.crawl.unread ?? ''} without a response are not counted as failures. Crawl of ${e(ctx.crawl.lastCrawled ?? '—')}${ctx.crawl.reused ? ', reused for this report' : ''}${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso) != null ? ` (${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso)} days before the report)` : ''}. ${evaluated ?? '—'} of ${total ?? '—'} website checks could be evaluated.</p>`
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
    `The crawler read ${ctx.crawl.read ?? 'some'} of ${ctx.crawl.known ?? 'the'} known pages. They are technically sound in most respects, but answers are hard to lift from them${extraction?.value != null ? ` (extraction readiness ${extraction.value}/100)` : ''} and the site shows little sign of regular updates. Short pages are judged by their purpose: a short legal page is normal.`, `
    ${block('Crawl coverage', 'From every address the crawler knew to the pages it could actually read.', crawlBody)}
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
  const nodes: GraphNode[] = [
    ...social.map((s): GraphNode => ({
      id: String(s.platform), label: proper(String(s.platform)),
      sub: s.status === 'observed' ? 'found in search' : s.status === 'unreachable' ? 'not checked' : 'declared, unverified',
      kind: s.status === 'observed' ? 'observed' : 'declared',
    })),
    { id: 'wikidata', label: 'Wikidata', sub: kgState === 'failed' ? 'lookup failed' : kgState === 'not_found' ? 'no entity found' : 'entity record', kind: kgState === 'measured' ? 'observed' : 'absent' },
  ];
  if (pack) {
    if (pack.independent.some((r) => r.kind === 'directory_listing' && r.status === 'looked_for_not_found')) nodes.push({ id: 'reviews', label: 'Review sites', sub: 'G2 / Capterra: not found', kind: 'absent' });
    if (pack.independent.some((r) => r.kind === 'third_party_mention' && r.status === 'looked_for_not_found')) nodes.push({ id: 'press', label: 'Press & mentions', sub: 'none found', kind: 'absent' });
  }
  const graph = entityGraph({ id: 'brand', label: ctx.brand, sub: ctx.domain, kind: 'center' }, nodes)
    + swatchLegend([[PALETTE.green, 'Observed in public sources'], [PALETTE.blue, 'Declared by the company, not verified'], [PALETTE.greyMid, 'Looked for, not found']]);

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
    'Outside the company’s own website, little was found that confirms the brand: no review-site listing, no press mention, no knowledge-graph entry, and the name is easily confused in search. The company has declared social profiles, which have not yet been confirmed in public search.', `
    ${block('Brand ecosystem', 'An entity is an organisation that search engines and AI tools can recognise across sources. Each line shows how the link to the brand was established.', graph)}
    ${independent ? block('Independent evidence', 'Third-party confirmation, looked for in public sources.', independent) : ''}
    ${block('External signal status', '"Unavailable" means a source is missing, not that the result is weak.', status)}
    ${proof ? block('Proof inventory', null, proof) : ''}
    ${cards.length ? block('Findings', null, `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`, 'v2-allow-break') : ''}
    ${strategy ? block('External authority worth building', null, strategy, 'v2-allow-break') : ''}
  `);
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

function generativeMatrix(ctx: Context): string {
  const pack = ctx.research;
  const cm = obj(obj(ctx.payload.ai_surface_presence)?.citation_matrix);
  const cells = objs(cm?.cells);
  const rows: string[] = [];
  if (pack) {
    const aio = pack.generative.filter((r) => r.kind === 'ai_overview');
    const read = aio.filter((r) => r.status === 'observed');
    const failed = aio.filter((r) => r.status === 'failed_source');
    rows.push(`<tr><td><strong>Google AI Overview</strong><br/><small>retrieval-grounded, cites sources</small></td><td>${pill('Measured', 'good')}</td><td>${read.length} read · ${failed.length} not retrievable</td><td>${read.map((r) => `${e(r.query)}: ${r.mentioned ? 'mentioned' : 'not mentioned'}, ${r.cited ? 'cited' : 'not cited'} (${(r.citedDomains ?? []).length} sources)`).join('<br/>') || '—'}</td></tr>`);
    // Surfaces the report run also checked are shown once, from the run's own cells.
    const covered = new Set(cells.map((c) => String(c.provider).toLowerCase()));
    for (const r of pack.generative.filter((x) => x.kind !== 'ai_overview' && !covered.has(String(x.kind).toLowerCase()) && !(x.kind === 'model_recall' && covered.size))) {
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
  const providers = [...new Set(cells.map((c) => String(c.provider)))];
  const classes = [...new Set(cells.map((c) => String(c.query_class)))];
  return heatmap(classes.map((c) => cap(c.replace(/_/g, ' '))), providers.map((prov) => ({
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
    ${generativeMatrix(ctx) ? block('AI search: question, mention and citation', 'Only answers retrieved from the live web, with checkable sources, count as visibility. Answers from a model’s memory are excluded.', generativeMatrix(ctx)) : ''}
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

function renderAppendix(ctx: Context): string {
  const p = ctx.payload;
  const r1 = p.report1;
  const pack = ctx.research;
  const sv = obj(r1?.search_visibility) ?? {};
  const cm = obj(obj(p.ai_surface_presence)?.citation_matrix);
  const cov = obj(cm?.coverage);
  const perf = obj(r1?.performance);
  const ct = obj(r1?.competitive_tables);
  const age = (iso: string | null) => { const d = ageDays(iso, ctx.generatedIso); return d == null ? '' : d === 0 ? 'same day' : d === 1 ? '1 day' : `${d} days`; };
  const fam = (name: string, state: string, coverage: string, observedIso: string | null, limitation: string, next: string) => {
    const st = stateLabel(state);
    return `<tr><td><strong>${e(name)}</strong></td><td>${pill(st.text, st.tone)}</td><td>${e(coverage)}</td><td>${e(fmtDate(observedIso) ?? '—')}<br/><small>${e(age(observedIso))}</small></td><td><small>${e(limitation)}</small></td><td><small>${e(next)}</small></td></tr>`;
  };
  const vis = summariseVisibility(pack);
  const cellsFailed = objs(cm?.cells).some((c) => /failed to load/i.test(String(c.reason_unavailable ?? '')));
  const sources = `<table class="v2-table"><thead><tr><th style="width:15%">Evidence family</th><th style="width:13%">State</th><th style="width:14%">Coverage</th><th style="width:11%">Observed · age</th><th>Limitation</th><th style="width:19%">Next step</th></tr></thead><tbody>
    ${fam('Website crawl', ctx.crawl.read ? 'observed' : 'unavailable', `${ctx.crawl.read ?? '—'} of ${ctx.crawl.known ?? '—'} addresses read`, ctx.crawl.lastCrawledIso, `${ctx.crawl.unread ?? 0} gave no HTTP response; attempted count not recorded.`, 'Re-crawl after content changes; record attempts.')}
    ${pack ? fam('Official pages (research)', 'company_declared', `${pack.company.length} facts`, pack.collectedAt, 'What the company says about itself.', '—') : ''}
    ${vis.search ? fam('Google search (research)', 'observed', `${vis.search.checked} buyer queries`, pack?.collectedAt ?? null, `One geography (${vis.search.geography}) and one day; not market-wide coverage.`, 'Repeat per target market; add queries from public related searches.') : ''}
    ${fam('Google search (report run)', objs(sv.observations).length ? 'observed' : 'not_measured', `${num(sv.queriesRun) ?? 0} queries`, str(sv.observedAt), 'Template queries; location and language not recorded.', 'Send location/language as search parameters (now implemented).')}
    ${vis.generative ? fam('Google AI Overview (research)', vis.generative.grounded ? 'observed' : 'failed_source', `${vis.generative.grounded} read, ${vis.generative.failed} not retrievable`, pack?.collectedAt ?? null, 'Overview content needs a prompt follow-up request; most tokens returned no content.', 'Retry promptly; record citations.') : ''}
    ${fam('AI answer engines (report run)', (num(cov?.measured_cells) ?? 0) > 0 ? 'observed' : cellsFailed ? 'failed_source' : 'not_measured', `${num(cov?.measured_cells) ?? 0} of ${num(cov?.total_cells) ?? 0} checks grounded`, null, 'Model-memory answers are excluded; Perplexity is not configured.', 'Configure a retrieval-grounded engine (Perplexity).')}
    ${pack ? fam('Competitor validation (research)', 'observed', `${pack.competitors.length} candidates checked`, pack.collectedAt, 'Homepages only; pricing and features not yet compared in depth.', 'Fetch pricing and feature pages of validated competitors.') : fam('Competitor discovery', ct?.empty ? 'not_measured' : 'observed', ct?.empty ? 'no validated competitors' : 'classified', null, str(ct?.emptyReason) ?? '—', 'Validate candidates against their own sites.')}
    ${pack ? fam('Independent mentions (research)', 'looked_for_not_found', `${pack.independent.length} checks`, pack.collectedAt, 'A few web searches; review sites not queried one by one.', 'Search each directory directly; create listings.') : ''}
    ${fam('Backlinks', String(obj(obj(p.authority_inflow)?.score)?.state ?? 'unavailable'), '—', null, str(obj(obj(p.authority_inflow)?.rationale)?.text) ?? '—', 'Connect a backlink source.')}
    ${fam('Reviews and reputation', String(obj(obj(p.trust_coherence)?.score)?.state ?? 'unavailable'), '—', null, str(obj(obj(p.trust_coherence)?.rationale)?.text) ?? '—', 'Connect a review source.')}
    ${fam('Knowledge graph', sourceState(obj(obj(p.knowledge_graph)?.score), str(obj(obj(p.knowledge_graph)?.rationale)?.text)), '—', null, str(obj(obj(p.knowledge_graph)?.rationale)?.text) ?? '—', 'Create a Wikidata entry; add Organization structured data.')}
    ${fam('Advertising libraries', r1?.advertising ? 'observed' : 'not_measured', r1?.advertising ? 'observed' : 'not queried', null, r1?.advertising ? '—' : 'No ad-library observation was made.', 'Run a public ad-library observation.')}
    ${fam('Page speed', String(perf?.state ?? 'unavailable'), `${num(obj(perf?.coverage)?.measured) ?? 0} of ${num(obj(perf?.coverage)?.eligible) ?? 0} pages`, null, str(perf?.reasonUnavailable) ?? '—', 'Enable PageSpeed Insights.')}
  </tbody></table>`;

  const ladder = `<table class="v2-table v2-compact"><tbody>${LADDER.map(([k, t, d]) => { const st = stateLabel(k); return `<tr><td style="width:24%">${pill(t, st.tone)}</td><td><small>${e(d)}</small></td></tr>`; }).join('')}</tbody></table>`;

  const researchRegister = pack ? (() => {
    const all: ResearchRecord[] = [...pack.company, ...pack.search, ...pack.generative, ...pack.competitors, ...pack.independent];
    return `<p class="v2-note">${e(pack.collector)} · collected ${e(fmtDate(pack.collectedAt) ?? pack.collectedAt)}. ${Object.entries(pack.method).map(([k, v]) => `${cap(k)}: ${v}`).map(e).join(' ')}</p>
    <table class="v2-table v2-compact"><thead><tr><th style="width:10%">Id</th><th>Observation</th><th style="width:14%">State</th><th style="width:26%">Source · method</th></tr></thead><tbody>${
      all.map((r) => { const st = stateLabel(r.status); return `<tr><td class="v2-id">${e(r.id)}</td><td><small>${e(r.query ? `${r.query} — ${r.claim}` : r.claim)}</small></td><td>${pill(st.text, st.tone)}</td><td><small>${e(r.sourceUrl || '—')}<br/>${e(r.method)}</small></td></tr>`; }).join('')
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
    return `<tr><td><small>${e(g.label)}</small></td><td>${e(c.label)}</td><td>${pill(text, tone)}</td><td><small>${e(c.detail ?? '')}</small></td></tr>`;
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
    ${block('Public-evidence coverage', 'Every evidence family, whether it was measured, how old it is, and what it would take to measure it.', sources, 'v2-allow-break')}
    ${block('The six evidence sources', 'What the summary’s “sources measured” count is made of.', `<table class="v2-table v2-compact"><tbody>${ctx.sources.map((src) => {
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

// ── Assembly ────────────────────────────────────────────────────────────────

export function renderDossierV2Html(payload: CanonicalExportPayload, branding: DossierV2Branding = {}, research: unknown = null): string {
  const pack = parseResearchPack(research, branding.domain ?? null);
  const ctx = buildContext(payload, branding, pack);
  const footer = `${ctx.brand} · ${ctx.domain} · Digital intelligence dossier · ${ctx.generated}`;
  return `<!doctype html>
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
}

export { buildDossierRegistry };
