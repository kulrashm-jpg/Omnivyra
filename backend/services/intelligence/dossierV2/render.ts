/**
 * Dossier v2 — six-section report renderer.
 *
 *   1 Executive brief · 2 Market & competitive intelligence · 3 Digital presence & discoverability
 *   4 Authority, trust & entity · 5 Strategic action plan · 6 Evidence appendix
 *
 * Written for two readers at once: someone new to marketing (every score and finding carries a
 * plain-English meaning; jargon is defined) and a CMO (decisions, trade-offs, confidence and
 * success measures). Reads the same CanonicalExportPayload as v1. Every recommendation comes from
 * the registry (one id per action), so no section restates another. Every value is read from the
 * payload; where a producer abstained the report says so instead of estimating.
 */
import type { CanonicalExportPayload } from '../canonicalExport';
import { escape } from '../exportRendererCore';
import {
  PALETTE, barChart, entityGraph, evidenceArchitecture, funnel, heatLegend, heatmap, impactEffortMatrix, pill,
  roadmap, scoreColor, scoreRing, stackedRows,
  type BarRow, type FunnelStage, type GraphNode, type HeatCell, type MatrixPoint, type RoadmapItem,
} from './charts';
import { buildDossierRegistry, type DossierAction, type DossierFinding, type DossierRegistry } from './registry';
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
const ageDays = (iso: string | null | undefined, ref: string): number | null => {
  if (!iso) return null;
  const a = new Date(iso).getTime();
  const b = new Date(ref).getTime();
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, Math.round((b - a) / 86_400_000));
};

const PILLAR_NAME: Record<string, string> = {
  foundation: 'Foundation', authority: 'Authority', discoverability: 'Discoverability', trust: 'Trust', momentum: 'Momentum',
};
const pillarName = (p: string | null | undefined): string => (p ? PILLAR_NAME[p] ?? p : '—');

/** One sentence per pillar for a reader new to marketing. */
const PILLAR_MEANING: Record<string, string> = {
  foundation: 'Is the website technically sound and easy for search engines and AI tools to read?',
  authority: 'Does the wider web recognise and vouch for the brand?',
  discoverability: 'Does the site cover the topics buyers search for, in a form engines can use?',
  trust: 'Do reviews and reputation sources back the brand up?',
  momentum: 'Is the site visibly active — publishing and updating?',
};

type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'info';
const stateLabel = (state: string | null | undefined): { text: string; tone: Tone } => {
  switch (state) {
    case 'failed': return { text: 'Source failed', tone: 'bad' };
    case 'measured': return { text: 'Measured', tone: 'good' };
    case 'inferred': return { text: 'Inferred', tone: 'info' };
    case 'declared': return { text: 'Company-declared', tone: 'neutral' };
    case 'not_measured': return { text: 'Not measured', tone: 'neutral' };
    case 'not_found': return { text: 'Looked for, not found', tone: 'neutral' };
    case 'insufficient_signal': return { text: 'Insufficient evidence', tone: 'warn' };
    default: return { text: 'Unavailable', tone: 'warn' };
  }
};

/**
 * A provider that was configured and failed is its own state. Its slot may still carry a value
 * inferred from on-site evidence (the knowledge-graph slot reads 28 from page entity clarity),
 * but the source itself did not answer, and the reader must see that.
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

// ── Derived context ─────────────────────────────────────────────────────────

type SourceRow = { key: string; label: string; meaning: string; status: 'connected' | 'partial' | 'missing'; feeds: string };

type Context = {
  payload: CanonicalExportPayload;
  registry: DossierRegistry;
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
 * partial = inferred; missing = no value. Public search results are queried separately and are
 * not one of the six.
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
    { key: 'ai', label: 'AI answers', meaning: 'what AI assistants say about you', status: status('ai_surface_presence'), feeds: 'AI Surface Presence' },
    { key: 'competitor', label: 'Competitors', meaning: 'a validated set of rivals', status: competitorCount > 0 ? 'connected' : 'missing', feeds: 'competitive comparison' },
    { key: 'trust', label: 'Reviews & reputation', meaning: 'independent reviews and ratings', status: status('trust_coherence'), feeds: 'Trust Coherence' },
  ];
}

function buildContext(payload: CanonicalExportPayload, branding: DossierV2Branding): Context {
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
    registry: buildDossierRegistry(payload),
    brand: branding.brandName ?? branding.domain ?? 'Company',
    domain: branding.domain ?? '',
    generated: fmtDate(payload.generated_at) ?? '',
    generatedIso: payload.generated_at,
    crawl: {
      known,
      read,
      unread: known != null && read != null ? Math.max(0, known - read) : null,
      lastCrawled: fmtDate(lastIso),
      lastCrawledIso: lastIso,
      reused: crawl?.action === 'reused',
    },
    pillars,
    sources: evidenceSources(pillars, competitorCount),
  };
}

/** How a pillar value was established, in a short label. */
function pillarTag(p: Context['pillars'][number]): string {
  if (p.value == null) return 'insufficient evidence';
  const measuredDims = p.dims.filter((d) => d.value != null).length;
  const label = p.state === 'measured' ? 'measured' : 'inferred';
  const scope = p.key === 'discoverability' ? ' · on-site readiness, not rankings' : '';
  return `${label} · ${measuredDims} of ${p.dims.length} dimensions${scope}`;
}

const scored = (ctx: Context) => ctx.pillars.filter((p) => p.value != null);
const lowest = (ctx: Context) => [...scored(ctx)].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
const highest = (ctx: Context) => [...scored(ctx)].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];

// ── Cover ───────────────────────────────────────────────────────────────────

function renderCover(ctx: Context, branding: DossierV2Branding): string {
  const index = num(obj(obj(ctx.payload.authority_overview)?.overall_score)?.value);
  const stage = str(obj(ctx.payload.maturity_stage)?.label);
  const low = lowest(ctx);
  const high = highest(ctx);
  // Calibrated, derived from the scores themselves — not the producer's narrative.
  const thesis = low && high
    ? `${high.label} scores highest (${high.value}/100, ${high.state === 'measured' ? 'measured' : 'inferred from the website'}); ${low.label} scores lowest (${low.value}/100). ${ctx.sources.filter((s) => s.status === 'connected').length} of ${ctx.sources.length} evidence sources are fully measured, so several conclusions are provisional.`
    : 'Where the brand stands, what holds it back, and how much of that is measured.';
  const connected = ctx.sources.filter((s) => s.status === 'connected').length;
  return `<section class="v2-cover">
  <div class="v2-cover-brand">${branding.logoUrl ? `<img src="${e(branding.logoUrl)}" alt="${e(ctx.brand)}" onerror="this.style.display='none'"/>` : ''}<span class="v2-cover-eyebrow">${e(ctx.domain)} · Digital intelligence dossier</span></div>
  <h1>${e(ctx.brand)}: where the brand stands, what holds it back, and what to do first</h1>
  <p class="v2-cover-thesis">${e(thesis)}</p>
  <div class="v2-cover-meta">
    <div>Authority Index<strong>${index ?? '—'} / 100</strong></div>
    <div>Stage<strong>${e(stage ?? '—')}</strong></div>
    <div>Evidence sources measured<strong>${connected} of ${ctx.sources.length}</strong></div>
    <div>Generated<strong>${e(ctx.generated)}</strong></div>
  </div>
</section>`;
}

// ── 1. Executive brief ──────────────────────────────────────────────────────

function sourceStrip(ctx: Context): string {
  const tone = (s: SourceRow['status']): Tone => (s === 'connected' ? 'good' : s === 'partial' ? 'info' : 'neutral');
  const text = (s: SourceRow['status']) => (s === 'connected' ? 'Measured' : s === 'partial' ? 'Partly (inferred)' : 'Not measured');
  return `<table class="v2-table v2-compact"><tbody>${ctx.sources.map((s) =>
    `<tr><td style="width:24%"><strong>${e(s.label)}</strong></td><td style="width:20%">${pill(text(s.status), tone(s.status))}</td><td><small>${e(cap(s.meaning))}. Counts as measured when ${e(s.feeds)} has a measured value.</small></td></tr>`).join('')}</tbody></table>`;
}

/** The four reading lenses (navigation model). Each states which sections answer it and how measured it is. */
function lensMap(ctx: Context): string {
  const r1 = ctx.payload.report1;
  const competitors = ctx.sources.find((s) => s.key === 'competitor')?.status === 'connected';
  const identity = objs(obj(r1?.company_identity)?.fields).length > 0;
  const serp = objs(obj(r1?.search_visibility)?.observations).length;
  const de = objs(obj(r1?.digital_experience)?.pillars).filter((p) => p.readiness !== 'insufficient_evidence').length;
  const lenses: Array<[string, string, string, string, Tone]> = [
    ['Market & brand positioning', 'Who the brand is for, how it describes itself, and who it competes with.', 'Sections 2, 4',
      competitors ? 'Measured' : identity ? 'Partly measured — no validated competitors' : 'Not measured', competitors ? 'good' : identity ? 'warn' : 'neutral'],
    ['Discoverability & visibility', 'Whether buyers can find the brand in search engines and AI answers.', 'Sections 2, 3',
      serp ? `Partly measured — ${serp} search queries, no grounded AI answers` : 'Not measured', serp ? 'warn' : 'neutral'],
    ['Digital experience → demand', 'Whether the website turns a visit into a next step.', 'Section 3',
      de ? `Partly measured — ${de} of 4 experience areas read` : 'Not measured', de ? 'warn' : 'neutral'],
    ['Lead quality (authority × need fit)', 'Whether the right buyers arrive and trust what they find.', 'Sections 4, 5',
      'Not measurable from public evidence — needs analytics or CRM data', 'neutral'],
  ];
  return `<div class="v2-lenses">${lenses.map(([t, d, where, status, tone]) =>
    `<div class="v2-lens"><h4>${e(t)}</h4><p>${e(d)}</p><div>${pill(status, tone)}</div><small>${e(where)}</small></div>`).join('')}</div>`;
}

function decisionCards(ctx: Context): string {
  const top = ctx.registry.actions.filter((a) => a.kind === 'improvement').slice(0, 3);
  return `<div class="v2-decisions">${top.map((a, i) => `<div class="v2-decision-card">
    <div class="v2-decision-num">${i + 1}</div>
    <h4>${e(a.title)}</h4>
    <dl><dt>Why</dt><dd>${e(a.why ?? a.action)}</dd>
    <dt>Success measure</dt><dd>${e(a.verification ?? 'Not defined by the source; see the action register.')}</dd></dl>
    <div class="v2-id">${e(a.id)} · ${e(a.effort ?? '—')} effort · ${e(a.confidence ?? '—')} confidence</div></div>`).join('')}</div>`;
}

function renderExecutive(ctx: Context): string {
  const overall = obj(obj(ctx.payload.authority_overview)?.overall_score) ?? {};
  const index = num(overall.value);
  const ms = obj(ctx.payload.maturity_stage) ?? {};
  const high = highest(ctx);
  const low = lowest(ctx);
  const connected = ctx.sources.filter((s) => s.status === 'connected').length;

  const kpi = (label: string, value: string, note: string, meaning: string, color: string) =>
    `<div class="v2-kpi" style="border-top-color:${color}"><div class="v2-kpi-label">${e(label)}</div><div class="v2-kpi-value">${value}</div><div class="v2-kpi-note">${e(note)}</div><div class="v2-kpi-meaning">${e(meaning)}</div></div>`;
  const kpis = `<div class="v2-kpis">
    ${kpi('Authority Index', `${index ?? '—'}<small>/100</small>`, `${str(ms.label) ?? ''} stage · ${stateLabel(String(overall.state)).text.toLowerCase()}`, 'One 0–100 summary of how established the brand is online, from the evidence collected.', PALETTE.blue)}
    ${kpi('Strongest area', `${e(high?.label ?? '—')} ${high?.value ?? ''}`, high ? pillarTag(high) : '', high ? PILLAR_MEANING[high.key] ?? '' : '', PALETTE.green)}
    ${kpi('Lowest measured area', `${e(low?.label ?? '—')} ${low?.value ?? ''}`, low ? pillarTag(low) : '', low ? PILLAR_MEANING[low.key] ?? '' : '', PALETTE.crimson)}
    ${kpi('Evidence measured', `${connected} / ${ctx.sources.length}`, 'sources fully measured', 'How much of this report rests on measurement rather than inference. Named below.', PALETTE.amber)}
  </div>`;

  const rows: BarRow[] = ctx.pillars.map((p) => ({ label: p.label, value: p.value, tag: pillarTag(p), note: 'insufficient evidence' }));
  const hero = `<div class="v2-hero">${scoreRing(index, 'Authority Index')}
    <div class="v2-hero-text"><h3>${e(str(ms.label) ?? 'Stage')} stage</h3>
    <p>${e(str(obj(ms.unlock)?.explanation) ?? '')}</p>
    <p class="v2-note">How to read this: the index is the geometric mean of the ${scored(ctx).length} of ${ctx.pillars.length} pillars that have a value, so one weak pillar pulls it down. A pillar without evidence is left out, not scored as zero. ${str(overall.state) === 'inferred' ? 'Part of it is inferred from the website alone, so it is not a ranking of market authority.' : ''}</p></div></div>`;

  const limits: string[] = [];
  if (ctx.crawl.known != null && ctx.crawl.read != null) {
    limits.push(`${ctx.crawl.read} of ${ctx.crawl.known} known web addresses answered the crawler${ctx.crawl.lastCrawled ? ` (crawl of ${ctx.crawl.lastCrawled}${ctx.crawl.reused ? ', reused for this report' : ''})` : ''}. Page findings describe those ${ctx.crawl.read} pages.`);
  }
  for (const f of ctx.registry.findings.filter((x) => x.kind === 'coverage' || x.kind === 'competitive')) limits.push(`${f.title}: ${f.observation}`);
  if (searchQueryQuality(ctx)) limits.push('Search visibility rests mostly on generic single-word queries; see section 2.');

  return section(1, 'Executive brief', 'Where does the brand stand, what holds it back, and how reliable is that reading?',
    `${high ? `${high.label} scores highest${high.state === 'measured' ? '' : ' (estimated from the website, not from rankings)'} and ` : ''}${low ? `${low.label} scores lowest. ` : ''}Only ${connected} of ${ctx.sources.length} evidence sources are fully measured, so treat the scores as a starting baseline, not a verdict.`, `
    ${kpis}${hero}
    ${block('Pillar scores', 'Each bar says how it was established. Trust has no value: it shows as insufficient evidence, not as zero.', barChart(rows))}
    ${block('Three decisions', 'The highest-ranked actions from the action register (section 5), each with how success will be judged.', decisionCards(ctx))}
    ${block('Material limitations', 'What this reading could not see. Each is detailed once, in the evidence appendix.', `<ul class="v2-list">${limits.map((l) => `<li>${e(l)}</li>`).join('')}</ul>`)}
    ${block('What the evidence covers', 'The six evidence sources behind the scores. Public search results were also queried; they are reported in section 2.', sourceStrip(ctx))}
    ${block('How to read this report', 'Four questions a marketing team asks; each points to the sections that answer it and says how far public evidence can answer it.', lensMap(ctx))}
  `);
}

// ── 2. Market & competitive intelligence ────────────────────────────────────

function searchQueryQuality(ctx: Context): string | null {
  const obs = objs(obj(ctx.payload.report1?.search_visibility)?.observations);
  if (obs.length === 0) return null;
  const singles = obs.filter((o) => String(o.query ?? '').trim().split(/\s+/).length === 1);
  if (singles.length === 0) return null;
  // Plain text: callers escape at the point of output.
  return `${singles.length} of ${obs.length} search queries were single words taken from the site's own text (e.g. "${singles.slice(0, 3).map((o) => String(o.query)).join('", "')}"); results for them say little about commercial search demand.`;
}

/** Domain roles in search results. Lists are generic web platforms, never a judgement about a company. */
// Matched on the registrable name with any country ending (capterra.in, g2.com, medium.com).
const PLATFORMS = /(^|\.)(medium|linkedin|wikipedia|reddit|youtube|quora|facebook|instagram|x|twitter|britannica|theguardian|forbes|substack|github|builtin|ycombinator|cutshort|crunchbase|glassdoor|indeed|naukri|wellfound|angel|hackernoon|dev|hashnode)\.[a-z.]{2,6}$/i;
const DIRECTORIES = /(^|\.)(g2|capterra|getapp|softwareadvice|trustradius|producthunt|alternativeto|saasworthy|softwaresuggest|crozdesk|sourceforge|techjockey|goodfirms)\.[a-z.]{2,6}$/i;
/**
 * Role of a domain seen in results. Only generic web platforms and software directories are
 * recognised by name; everything else is "not yet classified" — never called a competitor.
 */
const domainRole = (d: string): { role: string; tone: Tone } =>
  (DIRECTORIES.test(d) ? { role: 'Software directory', tone: 'info' } : PLATFORMS.test(d) ? { role: 'Publishing / jobs platform', tone: 'neutral' } : { role: 'Not yet classified', tone: 'warn' });

function renderMarket(ctx: Context): string {
  const r1 = ctx.payload.report1;
  const fields = objs(obj(r1?.company_identity)?.fields);
  const agreementPill = (a: unknown) =>
    a === 'agree' ? pill('Website agrees', 'good') : a === 'differ' ? pill('Website differs', 'bad') : a === 'declared_only' ? pill('Declared only', 'neutral') : a === 'observed_only' ? pill('Observed only', 'info') : pill('Unresolved', 'neutral');
  const identity = fields.length ? `<table class="v2-table"><thead><tr><th style="width:20%">Attribute</th><th>Company declared</th><th>Website shows</th><th style="width:16%">Agreement</th></tr></thead><tbody>${
    fields.map((f) => `<tr><td><strong>${e(f.label)}</strong></td><td>${e(f.declaredValue ?? '—')}</td><td>${e(f.observedValue ?? '— not stated on the pages read')}</td><td>${agreementPill(f.agreement)}</td></tr>`).join('')
  }</tbody></table>` : '<p class="v2-note">No company identity evidence was produced for this run.</p>';

  const ct = obj(r1?.competitive_tables) ?? {};
  const sv = obj(r1?.search_visibility) ?? {};
  const obs = objs(sv.observations);
  const own = (ctx.domain || '').replace(/^www\./, '');
  const domainQueries = new Map<string, Set<string>>();
  for (const o of obs) for (const d of arr(o.competitorDomains)) {
    const k = String(d).replace(/^www\./, '');
    if (k === own) continue;
    if (!domainQueries.has(k)) domainQueries.set(k, new Set());
    domainQueries.get(k)!.add(String(o.query));
  }
  const ranked = [...domainQueries.entries()].sort((a, b) => b[1].size - a[1].size);
  const competitiveQueries = obs.filter((o) => /competitor|alternative|comparison|vs\b|versus/i.test(String(o.query)));
  const candidates = ranked.filter(([d]) => domainRole(d).role !== 'Publishing / jobs platform');
  const summary = obj(ct.summary) ?? {};
  const classified = ['direct', 'adjacent', 'substitute', 'strategic'].reduce((n, k) => n + (num(summary[k]) ?? 0), 0);

  const discovery = `<table class="v2-table"><thead><tr><th style="width:30%">Discovery path</th><th style="width:16%">Status</th><th>What it established</th></tr></thead><tbody>
    <tr><td>Competitors declared in the company profile</td><td>${pill('Checked', 'info')}</td><td>${classified > 0 ? `${classified} classified competitor(s).` : 'None declared.'}</td></tr>
    <tr><td>Domains returned for public search queries</td><td>${obs.length ? pill('Checked', 'info') : pill('Not run', 'neutral')}</td><td>${obs.length ? `${domainQueries.size} distinct domains across ${obs.length} queries${competitiveQueries.length ? `, ${competitiveQueries.length} of them competitor / alternative / comparison queries` : ''}. None passed the relevance check to count as a confirmed competitor.` : 'No search results were available.'}</td></tr>
    <tr><td>Software directories, marketplaces, integration listings, comparison articles</td><td>${pill('Not run', 'neutral')}</td><td>Not part of this report's collection. Their absence says nothing about the market.</td></tr>
  </tbody></table>`;

  const candidateTable = candidates.length ? `<table class="v2-table"><thead><tr><th>Domain seen in results</th><th style="width:20%">Role</th><th class="v2-num" style="width:12%">Queries</th><th style="width:38%">Seen for</th></tr></thead><tbody>${
    candidates.slice(0, 10).map(([d, qs]) => { const r = domainRole(d); return `<tr><td><strong>${e(d)}</strong></td><td>${pill(r.role, r.tone)}</td><td class="v2-num">${qs.size}</td><td><small>${e([...qs].slice(0, 3).join(' · '))}</small></td></tr>`; }).join('')
  }</tbody></table><p class="v2-note">These domains appeared in search results; that is all that is established. None has been checked for product overlap, buyer, pricing or geography, so none is called a competitor here. Publishing and jobs platforms (Medium, LinkedIn, Built In and similar) are excluded from this list.</p>` : '';

  let heat = '<p class="v2-note">No public search observations were recorded for this run.</p>';
  if (obs.length) {
    const cols = ranked.slice(0, 6).map(([d]) => d);
    const rows = obs.map((o) => {
      const depth = num(o.resultCount);
      const pos = num(o.position);
      const ownCell: HeatCell = pos != null
        ? { text: `#${pos}`, tone: pos <= 3 ? 'top' : pos <= 10 ? 'mid' : 'low' }
        : { text: depth ? `not in top ${depth}` : 'not found', tone: 'absent' };
      const present = new Set(arr(o.competitorDomains).map((d) => String(d).replace(/^www\./, '')));
      return {
        label: String(o.query ?? ''),
        sub: [str(o.queryClass)?.replace(/_/g, ' '), str(o.queryOrigin) === 'observed_public' ? 'from site text' : str(o.queryOrigin)?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
        cells: [ownCell, ...cols.map((d): HeatCell => (present.has(d) ? { text: 'in results', tone: 'self' } : { text: '–', tone: 'unmeasured' }))],
      };
    });
    heat = heatmap([own || 'this domain', ...cols], rows) + heatLegend([
      { tone: 'top', label: 'Top 3' }, { tone: 'mid', label: 'Positions 4–10' }, { tone: 'low', label: 'Beyond 10' },
      { tone: 'absent', label: 'Not within the depth checked' }, { tone: 'self', label: 'Other domain present' }, { tone: 'unmeasured', label: '– not in its results' },
    ]);
  }
  const engines = [...new Set(obs.map((o) => str(o.engine)).filter(Boolean))].join(', ');
  const depths = obs.map((o) => num(o.resultCount)).filter((n): n is number => n != null);
  const svLine = `${num(sv.queriesRun) ?? obs.length} queries on ${e(engines || 'a search engine')} via ${e(str(sv.provider) ?? 'a search provider')}${fmtDate(str(sv.observedAt)) ? ` on ${fmtDate(str(sv.observedAt))}` : ''}; results read to depth ${depths.length ? `${Math.min(...depths)}–${Math.max(...depths)}` : '—'}; location and language not recorded. The domain ranked for ${num(sv.queriesRanked) ?? 0} of them.`;

  const icp = obj(ctx.payload.market_icp_recommendation);
  const attrs = objs(icp?.attributes);
  const icpTable = attrs.length ? `<table class="v2-table"><thead><tr><th style="width:22%">Market attribute</th><th style="width:16%">State</th><th>Value, or what would resolve it</th></tr></thead><tbody>${
    attrs.map((a) => { const st = stateLabel(a.status === 'unavailable' ? 'unavailable' : String(a.status)); return `<tr><td>${e(a.label)}</td><td>${pill(st.text, st.tone)}</td><td>${e(a.value ?? a.unlock ?? '—')}</td></tr>`; }).join('')
  }</tbody></table>` : '';
  const acq = obj(r1?.acquisition_decision);
  const acqLine = acq ? `<div class="v2-callout"><strong>Acquisition posture: ${e(String(acq.posture ?? '').replace(/_/g, ' ').toLowerCase())}.</strong> ${e(acq.rationale)}</div>` : '';

  // Template queries built on a broad declared category describe that category, not this brand's niche.
  const templated = obs.filter((o) => o.queryOrigin === 'derived_template');
  const category = fields.find((f) => f.key === 'market' || f.key === 'category');
  const templateNote = templated.length > obs.length / 2
    ? `${templated.length} of ${obs.length} queries were built from templates on the declared category${category?.declaredValue ? ` ("${String(category.declaredValue)}")` : ''}. A broad category returns broad results; queries naming the specific product and the buyer's problem would test commercial visibility more directly.`
    : null;
  const quality = [searchQueryQuality(ctx), templateNote].filter(Boolean).join(' ') || null;
  return section(2, 'Market and competitive intelligence', 'Which market does the brand address, who competes for the same buyer, and where is it visible?',
    `${fields.some((f) => f.agreement === 'differ') ? 'The website describes the brand differently from the company profile. ' : ''}No competitor set has been confirmed yet, so this section shows what was found and what still needs checking rather than a comparison. In the search results checked, the domain did not appear.`, `
    ${block('Market definition', 'What the company declared next to what its website says. A difference is shown, not resolved for you.', identity)}
    ${block('Competitor discovery', 'Each path is listed with whether it ran, so an unchecked source is never read as an empty market.', discovery)}
    ${candidateTable ? block('Domains appearing for the same searches', 'Starting points for a competitor review — not a competitor list.', candidateTable) : ''}
    ${block('Search visibility by query', `${svLine} A search engine results page (SERP) is the list of results a search returns; "position" is where a site appears in it.`, heat + (quality ? `<p class="v2-note">${e(quality)}</p>` : ''), 'v2-allow-break')}
    ${icpTable ? block('Market proposal from public evidence', str(icp?.headline), icpTable) : ''}
    ${acqLine ? block('Organic and paid acquisition', null, acqLine) : ''}
  `);
}

// ── 3. Digital presence & discoverability ───────────────────────────────────

const PLAIN_FOR_FINDING: Record<string, string> = {
  extraction_readiness: 'Search engines and AI assistants struggle to pull a clear, quotable answer from these pages.',
  accessibility: 'Parts of the site are harder to use with assistive technology, and the same structure helps machines read it.',
  authority_velocity: 'The site shows little sign of being updated, which makes it look less active to buyers and engines.',
  entity_graph_strength: 'The brand is not yet described consistently enough for engines to treat it as one clearly defined company.',
  content: 'Some pages say very little, so a buyer arriving there may not find what they need.',
  positioning: 'Visitors read a different story from the one the company uses to describe itself.',
};
const plainFor = (f: DossierFinding): string | null =>
  PLAIN_FOR_FINDING[f.id.replace(/^F-dim-/, '')] ?? (f.kind === 'content' ? PLAIN_FOR_FINDING.content : f.kind === 'positioning' ? PLAIN_FOR_FINDING.positioning : null);

/** The thin-page examples are often legal pages; say so instead of implying commercial damage. */
function thinPageCaveat(f: DossierFinding): string | null {
  const urls = (f.observation.match(/https?:\/\/[^\s,)]+/g) ?? []);
  if (urls.length === 0) return null;
  const legal = urls.filter((u) => /terms|privacy|cookie|legal|data-deletion|imprint|disclaimer|refund/i.test(u));
  if (legal.length !== urls.length) return null;
  return 'The example pages listed are legal or policy pages, which are usually short by design. Which of the thin pages are commercial (product, pricing, solution) is not established by this crawl; review the commercial pages first.';
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

function aiGrid(ctx: Context): string {
  const cm = obj(obj(ctx.payload.ai_surface_presence)?.citation_matrix);
  const cells = objs(cm?.cells);
  if (!cells.length) return '<p class="v2-note">No AI answer-engine checks were recorded.</p>';
  const providers = [...new Set(cells.map((c) => String(c.provider)))];
  const classes = [...new Set(cells.map((c) => String(c.query_class)))];
  return heatmap(classes.map(cap), providers.map((p) => ({
    label: p,
    cells: classes.map((q): HeatCell => {
      const c = cells.find((x) => x.provider === p && x.query_class === q);
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

function renderPresence(ctx: Context): string {
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
    ? funnel(funnelStages) + `<p class="v2-note">Crawl of ${e(ctx.crawl.lastCrawled ?? '—')}${ctx.crawl.reused ? ', reused for this report' : ''}${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso) != null ? ` (${ageDays(ctx.crawl.lastCrawledIso, ctx.generatedIso)} days before the report)` : ''}. ${evaluated ?? '—'} of ${total ?? '—'} website checks could be evaluated against the pages read. How many addresses were attempted in this run is not recorded separately.</p>`
    : '<p class="v2-note">Crawl scope was not recorded.</p>';

  const de = obj(r1?.digital_experience);
  const readiness = objs(de?.pillars).map((p) => {
    const r = String(p.readiness ?? '');
    const tone: Tone = r === 'ready' ? 'good' : r === 'partial' ? 'warn' : r === 'not_ready' ? 'bad' : 'neutral';
    const cov = obj(p.coverage);
    return `<tr><td>${e(p.label)}</td><td>${pill(cap(r.replace(/_/g, ' ')), tone)}</td><td class="v2-num">${num(cov?.evaluated) ?? '—'} / ${num(cov?.total) ?? '—'} signals</td></tr>`;
  }).join('');

  const dimRows: BarRow[] = ctx.pillars.filter((p) => ['foundation', 'discoverability', 'momentum'].includes(p.key))
    .flatMap((p) => p.dims.map((d) => ({ label: d.label, value: d.value, tag: `${p.label} · ${d.value == null ? 'not measured' : d.state}`, note: 'not measured' })));

  const cards = ctx.registry.findings.filter((f) => f.kind === 'content' || (f.kind === 'dimension' && ['foundation', 'discoverability', 'momentum'].includes(f.pillar ?? '')));

  const cm = obj(obj(ctx.payload.ai_surface_presence)?.citation_matrix);
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  const measuredCells = num(obj(cm?.coverage)?.measured_cells) ?? 0;
  const aiPanels = `<div class="v2-cols">
    <div class="v2-panel"><h4>Website readiness for AI answers ${pill('Measured on site', 'good')}</h4>
      <p>Extraction readiness reads <strong>${extraction?.value ?? '—'}/100</strong>: how cleanly an answer can be lifted from the pages read. It rates the site's content, not what any AI tool says.</p></div>
    <div class="v2-panel"><h4>What AI assistants actually say ${pill(measuredCells ? 'Measured' : 'Not measured', measuredCells ? 'good' : 'warn')}</h4>
      <p>${e(str(obj(obj(ctx.payload.ai_surface_presence)?.rationale)?.text) ?? '')}</p>
      <p class="v2-note">A grounded answer is one the AI tool built by searching the live web, with sources. An answer from the model's memory says what it was trained on, not what buyers see today, so it is not counted.</p></div></div>
    <div style="margin-top:4mm">${aiGrid(ctx)}</div>`;

  const perf = obj(r1?.performance);
  return section(3, 'Digital presence and discoverability', 'Can buyers and machines find, read and act on the site?',
    `The crawler could read ${ctx.crawl.read ?? 'only some'} of ${ctx.crawl.known ?? 'the'} known pages. Those pages are technically sound in most respects, but answers are hard to lift from them${extraction?.value != null ? ` (extraction readiness ${extraction.value}/100)` : ''} and the site shows little sign of regular updates. What AI tools say about the brand has not been measured yet.`, `
    ${block('Crawl coverage', 'From every address the crawler knew to the pages it could actually read.', crawlBody)}
    ${block('Website checks by area', 'Count of checks per outcome. "Not evaluated" means the crawl could not read the signal — not a fault on the site.', stack + swatchLegend([[PALETTE.green, 'Observed / pass'], [PALETTE.amber, 'Needs attention'], [PALETTE.greyMid, 'Not evaluated']]))}
    ${readiness ? block('Digital experience readiness', 'A classification, not a score.', `<table class="v2-table"><tbody>${readiness}</tbody></table>`) : ''}
    ${block('Dimension scores', 'The dimensions behind Foundation, Discoverability and Momentum.', barChart(dimRows))}
    ${cards.length ? block('Findings', 'Each card: what was observed, what it means, why it matters, and the action that addresses it.', `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`, 'v2-allow-break') : ''}
    ${block('AI discoverability: readiness versus what AI tools say', 'Two different measurements. Readiness is read from the site; visibility needs an AI tool to be asked.', aiPanels)}
    ${perf ? block('Page speed', null, `<p class="v2-note">${e(str(perf.reasonUnavailable) ?? `Performance state: ${perf.state}`)}</p>`) : ''}
  `);
}

// ── 4. Authority, trust & entity ────────────────────────────────────────────

function renderAuthority(ctx: Context): string {
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
  const nodes: GraphNode[] = [
    ...social.map((s): GraphNode => ({
      id: String(s.platform), label: cap(String(s.platform)),
      sub: s.status === 'observed' ? 'found in search' : s.status === 'unreachable' ? 'not checked' : 'declared, unverified',
      kind: s.status === 'observed' ? 'observed' : 'declared',
    })),
    { id: 'wikidata', label: 'Wikidata', sub: kgState === 'failed' ? 'lookup failed' : kgState === 'not_found' ? 'no entity found' : 'entity record', kind: kgState === 'measured' ? 'observed' : 'absent' },
  ];
  const graph = entityGraph({ id: 'brand', label: ctx.brand, sub: ctx.domain, kind: 'center' }, nodes)
    + swatchLegend([[PALETTE.green, 'Observed in public sources'], [PALETTE.blue, 'Declared by the company, not verified'], [PALETTE.greyMid, 'Looked for, not found']]);

  const checks = objs(obj(p.report1?.website_checks)?.groups).flatMap((g) => objs(g.checks));
  const PROOF = ['testimonials', 'case_studies', 'social_proof', 'company_information', 'contact_info', 'pricing_visibility', 'legal_pages'];
  const proofRows = PROOF.map((k) => checks.find((c) => c.key === k)).filter((c): c is Obj => Boolean(c)).map((c) => {
    const found = c.status === 'pass';
    return `<tr><td>${e(c.label)}</td><td>${found ? pill('Found', 'good') : pill('Not found on pages read', 'neutral')}</td><td><small>${e(c.detail ?? '')}</small></td></tr>`;
  }).join('');
  const legalItems = objs(obj(de?.legal_transparency)?.items);
  const proof = `${proofRows ? `<table class="v2-table"><thead><tr><th style="width:26%">Proof element</th><th style="width:24%">On the site</th><th>Detail</th></tr></thead><tbody>${proofRows}</tbody></table>` : ''}
    ${legalItems.length ? `<p style="margin-top:3mm">${legalItems.map((i) => (i.present ? pill(String(i.label), 'good') : pill(`${i.label}: not found`, 'neutral'))).join(' ')}</p>` : ''}
    <p class="v2-note">Company-published proof (testimonials, case studies on its own site) is different from independent proof (reviews on third-party sites). Neither was found on the pages read; that is not evidence that customers or reviews do not exist.</p>`;

  const cards = ctx.registry.findings.filter((f) => f.kind === 'positioning' || (f.kind === 'dimension' && ['authority', 'trust'].includes(f.pillar ?? '')));

  const ba = obj(obj(p.backlink_authority)?.strategy);
  const recs = objs(ba?.recommendations);
  const strategy = recs.length ? `<table class="v2-table"><thead><tr><th>Type of external authority</th><th style="width:12%">When</th><th style="width:14%">Horizon</th><th style="width:14%">Relevance</th><th>Depends on</th></tr></thead><tbody>${
    recs.map((r) => {
      const rel = objs(r.relevance);
      const supports = rel.filter((x) => x.verdict === 'supports').length;
      const deps = arr(r.dependencies).map((d) => str(d) ?? str(obj(d)?.text) ?? str(obj(d)?.label)).filter(Boolean).join('; ');
      // Only the type's own first sentence: the rest is a company-context paragraph identical on every row.
      const why = (str(r.whyItMatters) ?? '').split(/(?<=\.)\s+For this company/)[0];
      return `<tr><td><strong>${e(r.label)}</strong><br/><small>${e(why)}</small></td><td>${pill(cap(String(r.priority ?? '')), r.priority === 'now' ? 'info' : 'neutral')}</td><td>${e(cap(String(r.horizon ?? '').replace(/_/g, ' ')))}</td><td class="v2-num">${supports} of ${rel.length} checks</td><td><small>${e(deps || '—')}</small></td></tr>`;
    }).join('')
  }</tbody></table><p class="v2-note">${e(objs(recs)[0] ? arr(recs[0].caveats).map(String).join(' ') : '')}</p>` : '';

  return section(4, 'Authority, trust and entity', 'Does the wider web corroborate the brand, and is it a clearly defined company?',
    'Other websites, review sites and public databases have not yet been measured or did not mention the brand. The company has declared social profiles, but public search has not confirmed them. Building independent proof is the main gap.', `
    ${block('External signal status', '"Unavailable" means a source is missing, not that the result is weak.', status)}
    ${block('Entity map', 'An entity is a clearly identified organisation that search engines and AI tools can recognise. Each line shows how a link to the brand was established.', graph)}
    ${cards.length ? block('Findings', null, `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`) : ''}
    ${block('Proof inventory', 'Trust signals the site itself shows, from the pages read.', proof)}
    ${strategy ? block('External authority worth building', `${str(ba?.headline) ?? ''} Types of authority, not a list of sites; relevance is the share of nine relevance checks that support the type.`, strategy, 'v2-allow-break') : ''}
  `);
}

// ── 5. Strategic action plan ────────────────────────────────────────────────

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

  const register = `<table class="v2-table"><thead><tr><th style="width:4%">#</th><th>Action</th><th style="width:12%">Addresses</th><th style="width:9%">Pillar</th><th style="width:13%">Impact · effort · confidence</th><th style="width:10%">Window</th><th style="width:22%">How you will know</th></tr></thead><tbody>${
    actions.map((a, i) => `<tr><td class="v2-num">${i + 1}</td>
      <td><strong>${e(a.title)}</strong> ${a.kind === 'measurement' ? pill('Measurement', 'info') : ''}<br/>${a.action !== a.title ? `<small>${e(a.action)}</small><br/>` : ''}<span class="v2-id">${e(a.id)}</span>${a.dependsOn.length ? `<br/><small>After: ${a.dependsOn.map((d) => e(d)).join(', ')}</small>` : ''}</td>
      <td><small>${a.findingIds.map((f) => e(f)).join('<br/>') || '—'}</small></td>
      <td>${e(pillarName(a.pillar))}</td>
      <td>${e(cap(a.impact ?? '—'))} · ${e(a.effort ?? '—')} · ${e(a.confidence ?? '—')}</td>
      <td>${e(a.horizon ? HORIZON_LABEL[a.horizon] : '—')}${a.horizonBasis === 'effort' ? '<br/><small>from effort</small>' : ''}</td>
      <td><small>${e(a.verification ?? '—')}</small></td></tr>`).join('')
  }</tbody></table>
  <p class="v2-note">Ordered by each action's own source score (snapshot priority, playbook leverage, or projected index gain for score levers), then lower effort and higher confidence. Measurement actions follow improvements. Owners are not known and are not assigned. Windows marked "from effort" were not scheduled by a source: low effort is placed in days 0–30, medium in 31–60, high in 61–90.</p>`;

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
  }</tbody></table><p class="v2-note">Projected by re-running the report's own scoring with the dimension raised to its target; each gain is computed on its own and they do not add up exactly. A projection is a hypothesis to test, not a forecast.</p>` : '';

  // Decision summary: a view of registry records, not new prose.
  const top = actions.filter((a) => a.kind === 'improvement').slice(0, 3);
  // Commercially closest findings first (content, positioning), then the weakest measured dimensions.
  const kindRank: Record<string, number> = { content: 0, positioning: 1, search: 2, dimension: 3 };
  const findings = ctx.registry.findings.filter((f) => f.kind !== 'coverage' && f.state === 'measured')
    .sort((a, b) => (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9)).slice(0, 3);
  const risks = ctx.registry.findings.filter((f) => f.kind === 'coverage' || f.kind === 'competitive');
  const summary = `<div class="v2-cols">
    <div class="v2-panel"><h4>Key measured findings</h4><table class="v2-table v2-compact"><tbody>${findings.map((f) => `<tr><td>${e(f.title)}</td><td class="v2-num">${e(f.metric ? f.metric.split(' (')[0] : '')}</td></tr>`).join('')}</tbody></table></div>
    <div class="v2-panel"><h4>First actions and their success measures</h4><table class="v2-table v2-compact"><tbody>${top.map((a) => `<tr><td><span class="v2-id">${e(a.id)}</span></td><td><small>${e(a.verification ?? 'see register')}</small></td></tr>`).join('')}</tbody></table></div></div>
    <div class="v2-panel" style="margin-top:4mm"><h4>Risks to these conclusions</h4><table class="v2-table v2-compact"><tbody>${risks.map((f) => `<tr><td style="width:34%">${e(f.title)}</td><td><small>${e(f.implication ?? f.observation)}</small></td></tr>`).join('')}</tbody></table></div>`;

  return section(5, 'Strategic action plan', 'What should happen first, in what order, and how will each step be verified?',
    'Start with the moves that the evidence supports most and that unblock others; connect the missing evidence sources in parallel so the next report can confirm whether the changes worked.', `
    ${block('Impact versus effort', 'Where each action sits by its stated impact and effort.', matrix)}
    ${block('Action register', `One register: ${actions.length} actions, each with one id. Every other section links here instead of restating an action.`, register, 'v2-allow-break')}
    ${block('90-day roadmap', 'Arrows run from a prerequisite to the action that depends on it.', map)}
    ${leverTable ? block('Score levers', 'Where an action moves a weak dimension, the projected effect on the score.', leverTable) : ''}
    ${block('Decision summary', 'The findings, first actions and risks a leadership review needs, drawn from the records above.', summary)}
  `);
}

// ── 6. Evidence appendix ────────────────────────────────────────────────────

const GLOSSARY: Array<[string, string]> = [
  ['SERP', 'Search engine results page: the list of results a search returns.'],
  ['Backlink', 'A link from another website to yours; search engines treat relevant ones as a vote of confidence.'],
  ['Structured data', 'Code on a page that labels facts (company, product, FAQ) so machines can read them reliably.'],
  ['Entity', 'A clearly identified organisation, product or person that engines can recognise across sources.'],
  ['Grounded AI answer', 'An answer an AI tool built by searching the live web and citing sources.'],
  ['AI citation', 'A grounded answer that names or links to the brand.'],
  ['Crawl', 'An automated visit that fetches and reads the website\'s pages.'],
  ['Conversion', 'A visitor taking a desired next step, such as booking a demo.'],
  ['ICP', 'Ideal customer profile: the type of company most likely to buy and benefit.'],
];

const LADDER: Array<[string, string]> = [
  ['Measured', 'Observed directly in this run (crawl, search results, a provider response).'],
  ['Company-declared', 'Stated by the company during setup; useful context, not independently checked.'],
  ['Inferred', 'Estimated from related on-site evidence; directional, not a measurement.'],
  ['Looked for, not found', 'A source was checked and did not return the item; not proof it does not exist.'],
  ['Not measured / unavailable', 'The source was not connected or not run; no conclusion is drawn.'],
  ['Source failed', 'A connected source errored; the result is unknown, not negative.'],
];

function renderAppendix(ctx: Context): string {
  const p = ctx.payload;
  const r1 = p.report1;
  const sv = obj(r1?.search_visibility) ?? {};
  const cm = obj(obj(p.ai_surface_presence)?.citation_matrix);
  const cov = obj(cm?.coverage);
  const perf = obj(r1?.performance);
  const ct = obj(r1?.competitive_tables);
  const age = (iso: string | null) => { const d = ageDays(iso, ctx.generatedIso); return d == null ? '—' : d === 0 ? 'same day' : `${d} days`; };
  const fam = (name: string, state: string, coverage: string, observedIso: string | null, limitation: string, next: string) => {
    const st = stateLabel(state);
    return `<tr><td><strong>${e(name)}</strong></td><td>${pill(st.text, st.tone)}</td><td>${e(coverage)}</td><td>${e(fmtDate(observedIso) ?? '—')}<br/><small>${e(observedIso ? age(observedIso) : '')}</small></td><td><small>${e(limitation)}</small></td><td><small>${e(next)}</small></td></tr>`;
  };
  const cellsFailed = objs(cm?.cells).some((c) => /failed to load/i.test(String(c.reason_unavailable ?? '')));
  const svObserved = str(sv.observedAt);
  const sources = `<table class="v2-table"><thead><tr><th style="width:15%">Evidence family</th><th style="width:13%">State</th><th style="width:14%">Coverage</th><th style="width:12%">Observed · age</th><th>Limitation</th><th style="width:19%">Next step</th></tr></thead><tbody>
    ${fam('Website crawl', ctx.crawl.read ? 'measured' : 'unavailable', `${ctx.crawl.read ?? '—'} of ${ctx.crawl.known ?? '—'} addresses read`, ctx.crawl.lastCrawledIso, ctx.crawl.unread ? `${ctx.crawl.unread} addresses gave no HTTP response.` : 'None recorded.', 'Re-crawl after content changes.')}
    ${fam('Public search results', objs(sv.observations).length ? 'measured' : 'unavailable', `${num(sv.queriesRun) ?? 0} queries`, svObserved, searchQueryQuality(ctx) ?? 'Bounded query set; not market-wide coverage. Location and language not recorded.', 'Run a commercial query set per buyer intent.')}
    ${fam('Competitor discovery', ct?.empty ? 'not_measured' : 'measured', ct?.empty ? 'no validated competitors' : 'competitors classified', null, str(ct?.emptyReason) ?? '—', 'Declare known competitors; add directory and comparison discovery.')}
    ${fam('Backlinks', String(obj(obj(p.authority_inflow)?.score)?.state ?? 'unavailable'), '—', null, str(obj(obj(p.authority_inflow)?.rationale)?.text) ?? '—', 'Connect a backlink source.')}
    ${fam('AI answer engines', (num(cov?.measured_cells) ?? 0) > 0 ? 'measured' : cellsFailed ? 'failed' : 'unavailable', `${num(cov?.measured_cells) ?? 0} of ${num(cov?.total_cells) ?? 0} checks`, null, str(obj(obj(p.ai_surface_presence)?.rationale)?.text) ?? '—', 'Connect a retrieval-grounded engine (e.g. Perplexity).')}
    ${fam('Reviews and reputation', String(obj(obj(p.trust_coherence)?.score)?.state ?? 'unavailable'), '—', null, str(obj(obj(p.trust_coherence)?.rationale)?.text) ?? '—', 'Connect a review source.')}
    ${fam('Knowledge graph', sourceState(obj(obj(p.knowledge_graph)?.score), str(obj(obj(p.knowledge_graph)?.rationale)?.text)), '—', null, str(obj(obj(p.knowledge_graph)?.rationale)?.text) ?? '—', 'Create or correct a Wikidata entry; add Organization structured data.')}
    ${fam('Advertising libraries', r1?.advertising ? 'measured' : 'not_measured', r1?.advertising ? 'observed' : 'not queried', null, r1?.advertising ? '—' : 'No ad-library observation was made for this run.', 'Run a public ad-library observation.')}
    ${fam('Page speed', String(perf?.state ?? 'unavailable'), `${num(obj(perf?.coverage)?.measured) ?? 0} of ${num(obj(perf?.coverage)?.eligible) ?? 0} pages`, null, str(perf?.reasonUnavailable) ?? '—', 'Enable PageSpeed Insights.')}
  </tbody></table>`;

  const ladder = `<table class="v2-table v2-compact"><tbody>${LADDER.map(([t, d]) => `<tr><td style="width:26%"><strong>${e(t)}</strong></td><td><small>${e(d)}</small></td></tr>`).join('')}</tbody></table>`;

  const findings = `<table class="v2-table"><thead><tr><th style="width:24%">Finding</th><th style="width:12%">State</th><th>Observation</th><th style="width:16%">Source</th><th style="width:18%">Actions</th></tr></thead><tbody>${
    ctx.registry.findings.map((f) => { const st = stateLabel(f.state); return `<tr><td><strong>${e(f.title)}</strong><br/><span class="v2-id">${e(f.id)}</span></td><td>${pill(st.text, st.tone)}</td><td><small>${e(f.observation)}</small></td><td><small>${e(f.source)}</small></td><td><small>${f.actionIds.map(e).join('<br/>') || '—'}</small></td></tr>`; }).join('')
  }</tbody></table>`;

  const obs = objs(sv.observations);
  const queries = obs.length ? `<table class="v2-table"><thead><tr><th>Query</th><th>Class · intent</th><th>Why checked</th><th class="v2-num">Depth</th><th class="v2-num">Position</th><th>Observed</th></tr></thead><tbody>${
    obs.map((o) => `<tr><td><strong>${e(o.query)}</strong></td><td><small>${e(String(o.queryClass ?? '').replace(/_/g, ' '))} · ${e(o.intent)}</small></td><td><small>${e(o.queryRationale)}</small></td><td class="v2-num">${num(o.resultCount) ?? '—'}</td><td class="v2-num">${num(o.position) ?? 'not found'}</td><td><small>${e(fmtDate(str(o.observedAt)) ?? '')} · ${e(o.engine)}</small></td></tr>`).join('')
  }</tbody></table>` : '';

  const groups = objs(obj(r1?.website_checks)?.groups);
  const checkRows = groups.flatMap((g) => objs(g.checks).map((c) => {
    const s = String(c.status);
    const tone: Tone = s === 'pass' ? 'good' : s === 'warn' || s === 'fail' ? 'warn' : 'neutral';
    const text = s === 'pass' ? 'Observed' : s === 'warn' ? 'Needs attention' : s === 'fail' ? 'Problem' : 'Not evaluated';
    return `<tr><td><small>${e(g.label)}</small></td><td>${e(c.label)}</td><td>${pill(text, tone)}</td><td><small>${e(c.detail ?? '')}</small></td></tr>`;
  })).join('');

  const audit = ctx.registry.audit;
  const auditBody = `<p>${audit.candidates} recommendations arrived from ${Object.values(audit.bySource).filter((n) => n > 0).length} generators (${Object.entries(audit.bySource).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ')}). They resolve to ${audit.actions} actions; ${audit.merges.length} restatements were merged:</p>
    <table class="v2-table"><thead><tr><th style="width:30%">Merged into</th><th style="width:18%">From</th><th>Restated as</th></tr></thead><tbody>${
      audit.merges.map((m) => `<tr><td class="v2-id">${e(m.into)}</td><td><small>${e(m.from.replace(/_/g, ' '))}</small></td><td><small>${e(m.title)}</small></td></tr>`).join('')
    }</tbody></table>`;

  const method = `<table class="v2-table"><tbody>
    <tr><td style="width:24%"><strong>Authority Index</strong></td><td>Geometric mean of the pillar scores that have a value. A pillar with no evidence is excluded, not counted as zero, so the index can rest on fewer than five pillars; the executive brief states how many.</td></tr>
    <tr><td><strong>Pillar score</strong></td><td>Mean of the pillar's dimensions that have a value. Labelled measured when its dimensions were observed, inferred when any was estimated from on-site evidence.</td></tr>
    <tr><td><strong>Discoverability</strong></td><td>Built from Topical Authority (the mean of an on-site topical score and the content-quality score) and AI Surface Presence. When AI presence is unmeasured it rests on the on-site part alone, so it describes readiness to be found, not observed rankings.</td></tr>
    <tr><td><strong>Index stage</strong></td><td>Six bands: Foundational 0–24 · Emerging 25–39 · Developing 40–54 · Operational 55–69 · Advanced 70–84 · Leading 85–100.</td></tr>
    <tr><td><strong>Score bands</strong></td><td>Individual pillar and dimension scores use a different, four-band scale: foundational 0–24 · developing 25–49 · operational 50–74 · leading 75+. A pillar can therefore read "leading" while the index is "Emerging".</td></tr>
    <tr><td><strong>Evidence sources</strong></td><td>Six: crawl, content, backlinks, AI answers, competitors, reviews. Measured when the dimension each feeds has a measured value; partly when inferred.</td></tr>
    <tr><td><strong>Search visibility</strong></td><td>Positions are the search provider's own ranks for the queries listed above, within the result depth checked. Not found within that depth is not a rank of zero.</td></tr>
    <tr><td><strong>AI visibility</strong></td><td>Each cell is an AI tool × question-type check. Only grounded answers count as measured; memory answers, failures and unconfigured tools are shown by reason, never estimated.</td></tr>
    <tr><td><strong>Action register</strong></td><td>One entry per move; recommendations that restate the same move are merged and listed in the duplication audit.</td></tr>
  </tbody></table>`;

  const glossary = `<table class="v2-table v2-compact"><tbody>${GLOSSARY.map(([t, d]) => `<tr><td style="width:22%"><strong>${e(t)}</strong></td><td><small>${e(d)}</small></td></tr>`).join('')}</tbody></table>`;

  return section(6, 'Evidence appendix', 'What was observed, where it came from, and how the numbers are calculated.',
    'Everything needed to check a conclusion: each source and its age, each finding with its evidence, the exact searches run, every website check, and how scores are calculated.', `
    ${block('Source coverage', 'Every evidence family, whether it was measured, how old the evidence is, and what it would take to measure it.', sources, 'v2-allow-break')}
    ${block('How strongly to read each label', 'The evidence states used throughout this report, from strongest to weakest.', ladder)}
    ${block('Where the evidence comes from', 'Conceptual — how public, declared and private evidence feed this report and deeper analysis.', `${evidenceArchitecture()}<p class="v2-note">This report uses public and company-declared evidence only. Lead quality, conversion and revenue need private analytics or CRM data and are therefore outside it.</p>`)}
    ${block('Findings register', 'Every finding once, with its evidence state and the actions that address it.', findings, 'v2-allow-break')}
    ${queries ? block('Search query records', null, queries, 'v2-allow-break') : ''}
    ${checkRows ? block('Website checks', null, `<table class="v2-table"><thead><tr><th style="width:16%">Area</th><th style="width:26%">Check</th><th style="width:16%">Outcome</th><th>Detail</th></tr></thead><tbody>${checkRows}</tbody></table>`, 'v2-allow-break') : ''}
    ${block('Duplication audit', 'How the action register was assembled.', auditBody, 'v2-allow-break')}
    ${block('Methodology', null, method)}
    ${block('Glossary', null, glossary)}
  `);
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function renderDossierV2Html(payload: CanonicalExportPayload, branding: DossierV2Branding = {}): string {
  const ctx = buildContext(payload, branding);
  const footer = `${ctx.brand} · ${ctx.domain} · Digital intelligence dossier · ${ctx.generated}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>${e(ctx.brand)} — Digital intelligence dossier</title>
<style>${DOSSIER_V2_CSS.replace('var(--v2-footer, "")', JSON.stringify(footer.replace(/[\n\\]/g, ' ')))}</style></head>
<body data-dossier="v2">
${renderCover(ctx, branding)}
${renderExecutive(ctx)}
${renderMarket(ctx)}
${renderPresence(ctx)}
${renderAuthority(ctx)}
${renderPlan(ctx)}
${renderAppendix(ctx)}
</body></html>`;
}

export { buildDossierRegistry };
