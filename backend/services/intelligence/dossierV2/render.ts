/**
 * Dossier v2 — six-section report renderer.
 *
 *   1 Executive brief · 2 Market & competitive intelligence · 3 Digital presence & discoverability
 *   4 Authority, trust & entity · 5 Strategic action plan · 6 Evidence appendix
 *
 * Reads the same CanonicalExportPayload as v1. Every recommendation comes from the registry
 * (one id per action), so no section restates another. Every value shown is read from the
 * payload; where a producer abstained the section says so instead of estimating.
 */
import type { CanonicalExportPayload } from '../canonicalExport';
import { escape } from '../exportRendererCore';
import {
  PALETTE, barChart, heatLegend, heatmap, pill, roadmap, scoreColor, scoreRing, stackedRows,
  type BarRow, type HeatCell, type RoadmapItem,
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
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const e = (v: unknown): string => escape(String(v ?? ''));

const fmtDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const PILLAR_NAME: Record<string, string> = {
  foundation: 'Foundation', authority: 'Authority', discoverability: 'Discoverability', trust: 'Trust', momentum: 'Momentum',
};
const pillarName = (p: string | null | undefined): string => (p ? PILLAR_NAME[p] ?? p : '—');

const stateLabel = (state: string | null | undefined): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' } => {
  switch (state) {
    case 'failed': return { text: 'Source failed', tone: 'bad' };
    case 'measured': return { text: 'Measured', tone: 'good' };
    case 'inferred': return { text: 'Inferred', tone: 'info' };
    case 'declared': return { text: 'Company-declared', tone: 'neutral' };
    case 'not_measured': return { text: 'Not measured', tone: 'neutral' };
    case 'insufficient_signal': return { text: 'Insufficient evidence', tone: 'warn' };
    default: return { text: 'Unavailable', tone: 'warn' };
  }
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * A provider that was configured and failed is its own state. Its slot may still carry a value
 * inferred from on-site evidence (the knowledge-graph slot reads 28 from page entity clarity),
 * but the source itself did not answer, and the reader must see that.
 */
const sourceState = (score: Obj | null, rationale: string | null): string =>
  (/failed to load|is not a constructor/i.test(rationale ?? '') ? 'failed' : String(score?.state ?? 'unavailable'));

function section(num: number, title: string, question: string, body: string): string {
  return `<section class="v2-section" id="s${num}">
  <header class="v2-section-head"><span class="v2-section-num">${num}</span><div><h2>${e(title)}</h2><p>${e(question)}</p></div></header>
  ${body}
</section>`;
}

const block = (title: string, sub: string | null, body: string, extraClass = ''): string =>
  `<div class="v2-block ${extraClass}"><h3>${e(title)}</h3>${sub ? `<p class="v2-sub">${e(sub)}</p>` : ''}${body}</div>`;

// ── Derived context ─────────────────────────────────────────────────────────

type Context = {
  payload: CanonicalExportPayload;
  registry: DossierRegistry;
  brand: string;
  domain: string;
  generated: string;
  crawl: { known: number | null; read: number | null; unread: number | null; lastCrawled: string | null; reused: boolean };
  pillars: Array<{ key: string; label: string; value: number | null; state: string; dims: Array<{ key: string; label: string; value: number | null; state: string }> }>;
  sources: { connected: number | null; total: number | null };
};

function buildContext(payload: CanonicalExportPayload, branding: DossierV2Branding): Context {
  const r1 = payload.report1;
  const crawl = obj(obj(r1?.evidence_acquisition)?.crawl);
  const wc = obj(r1?.website_checks);
  const known = num(crawl?.pagesAfter);
  const read = num(wc?.pagesEvaluated) ?? num(obj(obj(r1?.digital_experience)?.coverage)?.pagesEvaluated);
  const pillars = arr(payload.pillars).map((raw) => {
    const p = obj(raw) ?? {};
    const score = obj(p.score) ?? {};
    return {
      key: String(p.pillar ?? ''),
      label: str(p.label) ?? pillarName(String(p.pillar ?? '')),
      value: num(score.value),
      state: String(score.state ?? 'unavailable'),
      dims: arr(p.dimensions).map((d) => {
        const dim = obj(d) ?? {};
        const s = obj(dim.score) ?? {};
        return { key: String(dim.key ?? ''), label: str(dim.label) ?? String(dim.key ?? ''), value: num(s.value), state: String(s.state ?? 'unavailable') };
      }),
    };
  });
  const cov = obj(r1?.evidence_coverage);
  return {
    payload,
    registry: buildDossierRegistry(payload),
    brand: branding.brandName ?? branding.domain ?? 'Company',
    domain: branding.domain ?? '',
    generated: fmtDate(payload.generated_at) ?? '',
    crawl: {
      known,
      read,
      unread: known != null && read != null ? Math.max(0, known - read) : null,
      lastCrawled: fmtDate(str(crawl?.lastCrawledAt)),
      reused: crawl?.action === 'reused',
    },
    pillars,
    sources: { connected: num(cov?.connected_sources), total: num(cov?.total_sources) },
  };
}

/** A pillar whose only scored dimensions are on-site readiness, not visibility, says so. */
function pillarTag(p: Context['pillars'][number]): string {
  if (p.value == null) return 'insufficient evidence';
  const measuredDims = p.dims.filter((d) => d.value != null).length;
  const label = p.state === 'measured' ? 'measured' : 'inferred';
  const scope = p.key === 'discoverability' ? ' · on-site readiness only' : '';
  return `${label} · ${measuredDims} of ${p.dims.length} dimensions${scope}`;
}

// ── 1. Executive brief ──────────────────────────────────────────────────────

function renderCover(ctx: Context, branding: DossierV2Branding): string {
  const ov = obj(ctx.payload.authority_overview);
  const index = num(obj(ov?.overall_score)?.value);
  const stage = str(obj(ctx.payload.maturity_stage)?.label);
  const blocker = str(obj(obj(ctx.payload.maturity_stage)?.blocker)?.explanation);
  return `<section class="v2-cover">
  <div class="v2-cover-brand">${branding.logoUrl ? `<img src="${e(branding.logoUrl)}" alt="${e(ctx.brand)}" onerror="this.style.display='none'"/>` : ''}<span class="v2-cover-eyebrow">${e(ctx.domain)} · Digital intelligence dossier</span></div>
  <h1>${e(ctx.brand)}: authority, visibility and the decisions that move them</h1>
  <p class="v2-cover-thesis">${e(blocker ?? 'Where the brand stands, what holds it back, and how much of that is measured.')}</p>
  <div class="v2-cover-meta">
    <div>Authority Index<strong>${index ?? '—'} / 100</strong></div>
    <div>Stage<strong>${e(stage ?? '—')}</strong></div>
    <div>Evidence sources<strong>${ctx.sources.connected ?? '—'} of ${ctx.sources.total ?? '—'} connected</strong></div>
    <div>Generated<strong>${e(ctx.generated)}</strong></div>
  </div>
</section>`;
}

function renderExecutive(ctx: Context): string {
  const ov = obj(ctx.payload.authority_overview);
  const overall = obj(ov?.overall_score) ?? {};
  const index = num(overall.value);
  const ms = obj(ctx.payload.maturity_stage) ?? {};
  const scored = ctx.pillars.filter((p) => p.value != null);
  const strongest = [...scored].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const weakest = [...scored].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];

  const kpis = `<div class="v2-kpis">
    <div class="v2-kpi"><div class="v2-kpi-label">Authority Index</div><div class="v2-kpi-value">${index ?? '—'}<small>/100</small></div><div class="v2-kpi-note">${e(str(ms.label) ?? '')} · ${e(stateLabel(String(overall.state)).text.toLowerCase())}</div></div>
    <div class="v2-kpi" style="border-top-color:${PALETTE.green}"><div class="v2-kpi-label">Strongest pillar</div><div class="v2-kpi-value">${e(strongest?.label ?? '—')} ${strongest?.value ?? ''}</div><div class="v2-kpi-note">${e(strongest ? pillarTag(strongest) : '')}</div></div>
    <div class="v2-kpi" style="border-top-color:${PALETTE.crimson}"><div class="v2-kpi-label">Priority constraint</div><div class="v2-kpi-value">${e(weakest?.label ?? '—')} ${weakest?.value ?? ''}</div><div class="v2-kpi-note">${e(weakest ? pillarTag(weakest) : '')}</div></div>
    <div class="v2-kpi" style="border-top-color:${PALETTE.amber}"><div class="v2-kpi-label">Evidence sources</div><div class="v2-kpi-value">${ctx.sources.connected ?? '—'} / ${ctx.sources.total ?? '—'}</div><div class="v2-kpi-note">connected; the rest are not measured</div></div>
  </div>`;

  const rows: BarRow[] = ctx.pillars.map((p) => ({ label: p.label, value: p.value, tag: pillarTag(p), note: 'insufficient evidence' }));
  // The cover carries the blocker sentence; the hero states the unlock and how the index is built.
  const hero = `<div class="v2-hero">${scoreRing(index, 'Authority Index')}
    <div class="v2-hero-text"><h3>${e(str(ms.label) ?? 'Stage')} stage</h3>
    <p>${e(str(obj(ms.unlock)?.explanation) ?? '')}</p>
    <p class="v2-note">The index is the geometric mean of the ${scored.length} of ${ctx.pillars.length} pillars that have a value; a pillar without evidence is excluded, not scored as zero. ${e(str(overall.state) === 'inferred' ? 'Part of it is inferred from on-site evidence, so it is not a verified market-authority ranking.' : '')}</p></div></div>`;

  const top = ctx.registry.actions.filter((a) => a.kind === 'improvement').slice(0, 3);
  const decision = `<div class="v2-decision"><h3>The three decisions</h3><ol>${top.map((a) =>
    `<li><strong>${e(a.title)}</strong> <span class="v2-id">${e(a.id)}</span><br/>${e(a.why ?? a.action)}</li>`).join('')}</ol></div>`;

  const limits: string[] = [];
  if (ctx.crawl.known != null && ctx.crawl.read != null) {
    limits.push(`${ctx.crawl.read} of ${ctx.crawl.known} known URLs answered the crawler${ctx.crawl.lastCrawled ? ` (crawl of ${ctx.crawl.lastCrawled}${ctx.crawl.reused ? ', reused for this report' : ''})` : ''}; page-level findings describe those ${ctx.crawl.read} pages.`);
  }
  for (const f of ctx.registry.findings.filter((x) => x.kind === 'coverage' || x.kind === 'competitive')) limits.push(`${f.title}: ${f.observation}`);
  // Pointer only: the caveat itself is stated once, next to the search heatmap in section 2.
  if (searchQueryQuality(ctx)) limits.push('Search visibility rests mostly on generic single-word queries; see section 2.');

  return section(1, 'Executive brief', 'Where does the brand stand, what holds it back, and how reliable is that reading?', `
    ${kpis}${hero}
    ${block('Pillar scores', 'Each bar is labelled with how it was established. Trust has no value: it is shown as insufficient evidence, not as zero.', barChart(rows))}
    ${block('Decision', null, decision)}
    ${block('Material limitations', 'What this reading could not see. Each limitation is detailed once, in the evidence appendix.', `<ul class="v2-list">${limits.map((l) => `<li>${e(l)}</li>`).join('')}</ul>`)}
  `);
}

// ── 2. Market & competitive intelligence ────────────────────────────────────

function searchQueryQuality(ctx: Context): string | null {
  const obs = arr(obj(ctx.payload.report1?.search_visibility)?.observations).map(obj).filter((o): o is Obj => Boolean(o));
  if (obs.length === 0) return null;
  const singles = obs.filter((o) => String(o.query ?? '').trim().split(/\s+/).length === 1);
  if (singles.length === 0) return null;
  // Plain text: callers escape at the point of output.
  return `${singles.length} of ${obs.length} search queries were single words taken from the site's own text (e.g. "${singles.slice(0, 3).map((o) => String(o.query)).join('", "')}"); results for them say little about commercial search demand.`;
}

function renderMarket(ctx: Context): string {
  const r1 = ctx.payload.report1;
  // Market definition.
  const fields = arr(obj(r1?.company_identity)?.fields).map(obj).filter((o): o is Obj => Boolean(o));
  const agreementPill = (a: unknown) =>
    a === 'agree' ? pill('Website agrees', 'good') : a === 'differ' ? pill('Website differs', 'bad') : a === 'declared_only' ? pill('Declared only', 'neutral') : a === 'observed_only' ? pill('Observed only', 'info') : pill('Unresolved', 'neutral');
  const identity = fields.length ? `<table class="v2-table"><thead><tr><th style="width:22%">Attribute</th><th>Company declared</th><th>Website shows</th><th style="width:16%">Agreement</th></tr></thead><tbody>${
    fields.map((f) => `<tr><td><strong>${e(f.label)}</strong></td><td>${e(f.declaredValue ?? '—')}</td><td>${e(f.observedValue ?? '— not stated on the pages read')}</td><td>${agreementPill(f.agreement)}</td></tr>`).join('')
  }</tbody></table>` : '<p class="v2-note">No company identity evidence was produced for this run.</p>';

  // Competitor discovery.
  const ct = obj(r1?.competitive_tables) ?? {};
  const sv = obj(r1?.search_visibility) ?? {};
  const obs = arr(sv.observations).map(obj).filter((o): o is Obj => Boolean(o));
  const domainCount = new Map<string, number>();
  for (const o of obs) for (const d of arr(o.competitorDomains)) { const k = String(d); domainCount.set(k, (domainCount.get(k) ?? 0) + 1); }
  const topDomains = [...domainCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d]) => d);
  const summary = obj(ct.summary) ?? {};
  const classified = ['direct', 'adjacent', 'substitute', 'strategic'].reduce((n, k) => n + (num(summary[k]) ?? 0), 0);
  const discovery = `<table class="v2-table"><thead><tr><th style="width:30%">Discovery path</th><th style="width:18%">Status</th><th>What it established</th></tr></thead><tbody>
    <tr><td>Competitors declared in the company profile</td><td>${pill('Queried', 'info')}</td><td>${classified > 0 ? `${classified} classified competitor(s).` : 'None declared.'}</td></tr>
    <tr><td>Domains in public search results</td><td>${obs.length ? pill('Queried', 'info') : pill('Not queried', 'neutral')}</td><td>${obs.length ? `${domainCount.size} distinct domains across ${obs.length} queries${topDomains.length ? ` (most frequent: ${e(topDomains.slice(0, 4).join(', '))})` : ''}. None passed the relevance gate as a competitor.` : 'No search results were available.'}</td></tr>
    <tr><td>Software directories, marketplaces, comparison pages</td><td>${pill('Not queried', 'neutral')}</td><td>Not part of this run. Absence here says nothing about the market.</td></tr>
  </tbody></table>
  <p class="v2-note">${e(str(ct.emptyReason) ?? '')} Positioning maps, pricing and feature matrices need a validated competitor set; they are held open rather than drawn from guesses.</p>`;

  // Search heatmap.
  let heat = '<p class="v2-note">No public search observations were recorded for this run.</p>';
  if (obs.length) {
    const own = ctx.domain || 'this domain';
    const columns = [own, ...topDomains];
    const rows = obs.map((o) => {
      const depth = num(o.resultCount);
      const pos = num(o.position);
      const ownCell: HeatCell = pos != null
        ? { text: `#${pos}`, tone: pos <= 3 ? 'top' : pos <= 10 ? 'mid' : 'low' }
        : { text: depth ? `not in top ${depth}` : 'not found', tone: 'absent' };
      const present = new Set(arr(o.competitorDomains).map(String));
      return {
        label: String(o.query ?? ''),
        sub: [str(o.queryClass)?.replace(/_/g, ' '), str(o.queryOrigin) === 'observed_public' ? 'from site text' : str(o.queryOrigin)?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
        cells: [ownCell, ...topDomains.map((d): HeatCell => (present.has(d) ? { text: 'in results', tone: 'self' } : { text: '–', tone: 'unmeasured' }))],
      };
    });
    heat = heatmap(columns, rows) + heatLegend([
      { tone: 'top', label: 'Top 3' }, { tone: 'mid', label: 'Positions 4–10' }, { tone: 'low', label: 'Beyond 10' },
      { tone: 'absent', label: 'Not within the depth checked' }, { tone: 'self', label: 'Other domain present' },
    ]);
  }
  const svLine = `${num(sv.queriesRun) ?? obs.length} queries checked via ${e(str(sv.provider) ?? 'public search')}${fmtDate(str(sv.observedAt)) ? ` on ${fmtDate(str(sv.observedAt))}` : ''}; the domain ranked for ${num(sv.queriesRanked) ?? 0}.`;

  // Market proposal + acquisition.
  const icp = obj(ctx.payload.market_icp_recommendation);
  const attrs = arr(icp?.attributes).map(obj).filter((o): o is Obj => Boolean(o));
  const icpTable = attrs.length ? `<table class="v2-table"><thead><tr><th style="width:22%">Market attribute</th><th style="width:16%">State</th><th>Value, or what would resolve it</th></tr></thead><tbody>${
    attrs.map((a) => { const st = stateLabel(a.status === 'unavailable' ? 'unavailable' : String(a.status)); return `<tr><td>${e(a.label)}</td><td>${pill(st.text, st.tone)}</td><td>${e(a.value ?? a.unlock ?? '—')}</td></tr>`; }).join('')
  }</tbody></table>` : '';
  const acq = obj(r1?.acquisition_decision);
  const acqLine = acq ? `<div class="v2-callout"><strong>Acquisition posture: ${e(String(acq.posture ?? '').replace(/_/g, ' ').toLowerCase())}.</strong> ${e(acq.rationale)}</div>` : '';

  const quality = searchQueryQuality(ctx);
  return section(2, 'Market and competitive intelligence', 'Which market does the brand address, who competes for the same buyer, and where is it visible?', `
    ${block('Market definition', 'What the company declared next to what its website says. A difference is shown, not resolved for you.', identity)}
    ${block('Competitor discovery', 'Each path is listed with whether it ran, so an unqueried source is never read as an empty market.', discovery)}
    ${block('Search visibility by query', `${svLine} Rows are queries; columns are this domain and the domains most often returned.`, heat + (quality ? `<p class="v2-note">${e(quality)}</p>` : ''), 'v2-allow-break')}
    ${icpTable ? block('Market proposal from public evidence', str(icp?.headline), icpTable) : ''}
    ${acqLine ? block('Organic and paid acquisition', null, acqLine) : ''}
  `);
}

// ── 3. Digital presence & discoverability ───────────────────────────────────

const swatchLegend = (items: Array<[string, string]>): string =>
  `<div class="v2-legend">${items.map(([c, l]) => `<span><i style="background:${c};border-color:${c}"></i>${e(l)}</span>`).join('')}</div>`;

function findingCard(f: DossierFinding, actions: DossierAction[]): string {
  const st = stateLabel(f.state);
  const tone = f.kind === 'coverage' || f.kind === 'competitive' ? 'neutral' : f.state === 'measured' ? 'bad' : 'warn';
  const linked = actions.filter((a) => f.actionIds.includes(a.id));
  // Headline metric is the short figure; the full observation follows only when it adds detail.
  const metric = f.metric ? f.metric.split(' (')[0] : null;
  return `<div class="v2-card v2-tone-${tone}"><h4>${e(f.title)} ${pill(st.text, st.tone)}</h4>
    ${metric ? `<div class="v2-card-metric">${e(metric)}</div>` : ''}
    <dl>${f.observation !== metric ? `<dt>Observed</dt><dd>${e(f.observation)}</dd>` : ''}
    ${f.implication ? `<dt>Implication</dt><dd>${e(f.implication)}</dd>` : ''}
    <dt>Source</dt><dd>${e(f.source)}</dd>
    ${linked.length ? `<dt>Action</dt><dd>${linked.map((a) => `${e(a.title)} <span class="v2-id">${e(a.id)}</span>`).join('<br/>')}</dd>` : ''}</dl>
    <div class="v2-id" style="margin-top:1.5mm">${e(f.id)}</div></div>`;
}

function renderPresence(ctx: Context): string {
  const r1 = ctx.payload.report1;
  const wc = obj(r1?.website_checks) ?? {};
  const groups = arr(wc.groups).map(obj).filter((o): o is Obj => Boolean(o));
  const stack = stackedRows(groups.map((g) => {
    const checks = arr(g.checks).map(obj).filter((o): o is Obj => Boolean(o));
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
  const crawlLine = ctx.crawl.known != null
    ? `${ctx.crawl.read ?? '—'} of ${ctx.crawl.known} known URLs answered${ctx.crawl.unread ? ` (${ctx.crawl.unread} returned no HTTP response and are excluded)` : ''}${ctx.crawl.lastCrawled ? `; crawled ${ctx.crawl.lastCrawled}${ctx.crawl.reused ? ', reused for this report' : ''}` : ''}. ${num(wc.evaluated) ?? '—'} of ${num(wc.total) ?? '—'} checks could be evaluated.`
    : 'Crawl scope was not recorded.';

  const de = obj(r1?.digital_experience);
  const readiness = arr(de?.pillars).map(obj).filter((o): o is Obj => Boolean(o)).map((p) => {
    const r = String(p.readiness ?? '');
    const tone = r === 'ready' ? 'good' : r === 'partial' ? 'warn' : r === 'not_ready' ? 'bad' : 'neutral';
    const cov = obj(p.coverage);
    return `<tr><td>${e(p.label)}</td><td>${pill(cap(r.replace(/_/g, ' ')), tone)}</td><td class="v2-num">${num(cov?.evaluated) ?? '—'} / ${num(cov?.total) ?? '—'} signals</td></tr>`;
  }).join('');

  const dimRows: BarRow[] = ctx.pillars.filter((p) => ['foundation', 'discoverability', 'momentum'].includes(p.key))
    .flatMap((p) => p.dims.map((d) => ({ label: d.label, value: d.value, tag: `${p.label} · ${d.value == null ? 'not measured' : d.state}`, note: 'not measured' })));

  const cards = ctx.registry.findings.filter((f) => f.kind === 'content' || (f.kind === 'dimension' && ['foundation', 'discoverability', 'momentum'].includes(f.pillar ?? '')));

  // AI: readiness vs observed retrieval.
  const cm = obj(obj(ctx.payload.ai_surface_presence)?.citation_matrix);
  const cells = arr(cm?.cells).map(obj).filter((o): o is Obj => Boolean(o));
  const providers = [...new Set(cells.map((c) => String(c.provider)))];
  const classes = [...new Set(cells.map((c) => String(c.query_class)))];
  const aiGrid = cells.length ? heatmap(classes.map(cap), providers.map((p) => ({
    label: p,
    cells: classes.map((q): HeatCell => {
      const c = cells.find((x) => x.provider === p && x.query_class === q);
      const reason = String(c?.reason_unavailable ?? '');
      if (c?.state === 'measured') return { text: `${Math.round((num(c.citation_rate) ?? 0) * 100)}% cited`, tone: 'top' };
      if (/failed to load|error/i.test(reason)) return { text: 'provider failed', tone: 'low', title: reason };
      if (/not configured/i.test(reason)) return { text: 'not configured', tone: 'unmeasured', title: reason };
      return { text: 'no result', tone: 'absent', title: reason };
    }),
  }))) + heatLegend([{ tone: 'top', label: 'Measured' }, { tone: 'low', label: 'Configured, failed' }, { tone: 'unmeasured', label: 'Not configured' }]) : '<p class="v2-note">No AI answer-engine checks were recorded.</p>';
  const extraction = ctx.pillars.flatMap((p) => p.dims).find((d) => d.key === 'extraction_readiness');
  const aiPanels = `<div class="v2-cols">
    <div class="v2-panel"><h4>Website readiness for AI answers ${pill('Measured on site', 'good')}</h4>
      <p>Extraction readiness reads <strong>${extraction?.value ?? '—'}/100</strong>: how cleanly answers can be lifted from the pages read. It rates the site's content, not any AI answer.</p></div>
    <div class="v2-panel"><h4>Observed answer-engine visibility ${pill(num(obj(cm?.coverage)?.measured_cells) ? 'Measured' : 'Not measured', num(obj(cm?.coverage)?.measured_cells) ? 'good' : 'warn')}</h4>
      <p>${e(str(obj(obj(ctx.payload.ai_surface_presence)?.rationale)?.text) ?? '')}</p></div></div>
    <div style="margin-top:4mm">${aiGrid}</div>`;

  const perf = obj(r1?.performance);
  return section(3, 'Digital presence and discoverability', 'Can buyers and machines find, read and act on the site?', `
    ${block('Crawl scope', null, `<div class="v2-callout">${e(crawlLine)}</div>`)}
    ${block('Website checks by area', 'Count of checks per outcome. "Not evaluated" means the crawl could not read the signal — not a fault on the site.', stack + swatchLegend([[PALETTE.green, 'Observed / pass'], [PALETTE.amber, 'Needs attention'], [PALETTE.greyMid, 'Not evaluated']]))}
    ${readiness ? block('Digital experience readiness', 'A classification, not a score.', `<table class="v2-table"><tbody>${readiness}</tbody></table>`) : ''}
    ${block('Dimension scores', 'The dimensions behind Foundation, Discoverability and Momentum.', barChart(dimRows))}
    ${cards.length ? block('Findings', null, `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`, 'v2-allow-break') : ''}
    ${block('AI discoverability: readiness versus observed visibility', 'Two different measurements. Readiness is read from the site; visibility needs an answer engine to be asked.', aiPanels)}
    ${perf ? block('Page performance', null, `<p class="v2-note">${e(str(perf.reasonUnavailable) ?? `Performance state: ${perf.state}`)}</p>`) : ''}
  `);
}

// ── 4. Authority, trust & entity ────────────────────────────────────────────

function renderAuthority(ctx: Context): string {
  const p = ctx.payload;
  const statusRow = (label: string, score: Obj | null, rationale: string | null) => {
    const st = stateLabel(sourceState(score, rationale));
    return `<tr><td><strong>${e(label)}</strong></td><td>${pill(st.text, st.tone)}</td><td class="v2-num">${num(score?.value) ?? '—'}</td><td>${e(rationale ?? '')}</td></tr>`;
  };
  const sig = (x: unknown) => ({ score: obj(obj(x)?.score), text: str(obj(obj(x)?.rationale)?.text) });
  const kg = sig(p.knowledge_graph); const ai = sig(p.authority_inflow); const tr = sig(p.trust_coherence);
  const status = `<table class="v2-table"><thead><tr><th style="width:22%">Signal</th><th style="width:17%">State</th><th style="width:8%">Score</th><th>Basis</th></tr></thead><tbody>
    ${statusRow('Backlinks and referring domains', ai.score, ai.text)}
    ${statusRow('Entity and knowledge graph', kg.score, kg.text)}
    ${statusRow('Reviews and reputation', tr.score, tr.text)}
  </tbody></table>`;

  const de = obj(p.declared_evidence);
  const legal = obj(de?.legal_transparency);
  const legalItems = arr(legal?.items).map(obj).filter((o): o is Obj => Boolean(o));
  const social = arr(de?.social_presence).map(obj).filter((o): o is Obj => Boolean(o));
  const declared = `<div class="v2-cols">
    <div class="v2-panel"><h4>Legal and policy pages</h4><p>${legalItems.map((i) => `${i.present ? pill(String(i.label), 'good') : pill(`${i.label}: not found`, 'neutral')}`).join(' ')}</p></div>
    <div class="v2-panel"><h4>Declared social profiles</h4><p>${social.length ? social.map((s) => {
      const tone = s.status === 'observed' ? 'good' : s.status === 'unreachable' ? 'warn' : 'neutral';
      const text = s.status === 'observed' ? 'found in search' : s.status === 'unreachable' ? 'not checked' : s.searched_at ? 'not in one brand search' : s.searched_at === null ? 'not a profile URL' : 'not observed';
      return pill(`${s.platform}: ${text}`, tone);
    }).join(' ') : 'None declared.'}</p><p class="v2-note">A single search that does not return a profile does not show the profile is missing.</p></div></div>`;

  const cards = ctx.registry.findings.filter((f) => f.kind === 'positioning' || (f.kind === 'dimension' && ['authority', 'trust'].includes(f.pillar ?? '')));

  const ba = obj(obj(p.backlink_authority)?.strategy);
  const recs = arr(ba?.recommendations).map(obj).filter((o): o is Obj => Boolean(o));
  const strategy = recs.length ? `<table class="v2-table"><thead><tr><th>Type of external authority</th><th style="width:12%">When</th><th style="width:14%">Horizon</th><th style="width:14%">Relevance</th><th>Depends on</th></tr></thead><tbody>${
    recs.map((r) => {
      const rel = arr(r.relevance).map(obj).filter((o): o is Obj => Boolean(o));
      const supports = rel.filter((x) => x.verdict === 'supports').length;
      const deps = arr(r.dependencies).map((d) => str(d) ?? str(obj(d)?.text) ?? str(obj(d)?.label)).filter(Boolean).join('; ');
      // Only the type's own first sentence: the rest is a company-context paragraph identical on every row.
      const why = (str(r.whyItMatters) ?? '').split(/(?<=\.)\s+For this company/)[0];
      return `<tr><td><strong>${e(r.label)}</strong><br/><small>${e(why)}</small></td><td>${pill(cap(String(r.priority ?? '')), r.priority === 'now' ? 'info' : 'neutral')}</td><td>${e(cap(String(r.horizon ?? '').replace(/_/g, ' ')))}</td><td class="v2-num">${supports} of ${rel.length} checks</td><td><small>${e(deps || '—')}</small></td></tr>`;
    }).join('')
  }</tbody></table><p class="v2-note">${e(arr(recs[0]?.caveats).map(String).join(' '))}</p>` : '';

  return section(4, 'Authority, trust and entity', 'Does the wider web corroborate the brand, and is it a clear entity?', `
    ${block('External signal status', 'State of each off-site signal. "Unavailable" is a missing source, not a weak result.', status)}
    ${cards.length ? block('Findings', null, `<div class="v2-cards">${cards.map((f) => findingCard(f, ctx.registry.actions)).join('')}</div>`) : ''}
    ${block('What the site declares about itself', 'Declared by the organisation, not independently verified; carries no score.', declared)}
    ${strategy ? block('External authority worth building', `${str(ba?.headline) ?? ''} Types of authority, not a list of sites; relevance is the share of nine relevance checks that support the type.`, strategy, 'v2-allow-break') : ''}
  `);
}

// ── 5. Strategic action plan ────────────────────────────────────────────────

const HORIZON_LABEL: Record<string, string> = { '0-30': 'Days 0–30', '31-60': 'Days 31–60', '61-90': 'Days 61–90', later: 'Later' };

function renderPlan(ctx: Context): string {
  const actions = ctx.registry.actions;
  const register = `<table class="v2-table"><thead><tr><th style="width:4%">#</th><th>Action</th><th style="width:12%">Addresses</th><th style="width:9%">Pillar</th><th style="width:13%">Effort · confidence</th><th style="width:11%">Window</th><th style="width:22%">How you will know</th></tr></thead><tbody>${
    actions.map((a, i) => `<tr><td class="v2-num">${i + 1}</td>
      <td><strong>${e(a.title)}</strong> ${a.kind === 'measurement' ? pill('Measurement', 'info') : ''}<br/>${a.action !== a.title ? `<small>${e(a.action)}</small><br/>` : ''}<span class="v2-id">${e(a.id)}</span>${a.dependsOn.length ? `<br/><small>After: ${a.dependsOn.map((d) => e(d)).join(', ')}</small>` : ''}</td>
      <td><small>${a.findingIds.map((f) => e(f)).join('<br/>') || '—'}</small></td>
      <td>${e(pillarName(a.pillar))}</td>
      <td>${e(cap(a.effort ?? '—'))} · ${e(a.confidence ?? '—')}</td>
      <td>${e(a.horizon ? HORIZON_LABEL[a.horizon] : '—')}${a.horizonBasis === 'effort' ? '<br/><small>from effort</small>' : ''}</td>
      <td><small>${e(a.verification ?? '—')}</small></td></tr>`).join('')
  }</tbody></table>
  <p class="v2-note">Ordered by each action's own source score (snapshot priority, playbook leverage, or projected index gain for score levers), then lower effort and higher confidence. Measurement actions follow improvements. Windows marked "from effort" were not scheduled by a source: low effort is placed in days 0–30, medium in 31–60, high in 61–90.</p>`;

  const win = (h: string | null): 0 | 1 | 2 => (h === '0-30' ? 0 : h === '61-90' || h === 'later' ? 2 : 1);
  const items: RoadmapItem[] = actions.map((a) => ({
    id: a.id,
    label: a.title,
    window: win(a.horizon),
    dependsOn: a.dependsOn,
    tone: a.kind === 'measurement' ? PALETTE.blue : a.confidence === 'high' ? PALETTE.green : a.confidence === 'low' ? PALETTE.amber : PALETTE.navy,
    meta: [a.effort && `${a.effort} effort`, a.confidence && `${a.confidence} confidence`, a.kind === 'measurement' && 'measurement'].filter(Boolean).join(' · '),
  }));
  const empty = [0, 1, 2].filter((w) => !items.some((i) => i.window === w)).map((w) => ['Days 0–30', 'Days 31–60', 'Days 61–90'][w]);
  const map = roadmap(items, ['Days 0–30', 'Days 31–60', 'Days 61–90'])
    + (empty.length ? `<p class="v2-note">${e(empty.join(' and '))}: nothing scheduled. No action in the register was scheduled there by a source or falls there by effort; the window is left empty rather than filled with generic work.</p>` : '');

  const levers = actions.filter((a) => a.lever).sort((a, b) => (b.lever!.overallGain - a.lever!.overallGain));
  const leverTable = levers.length ? `<table class="v2-table"><thead><tr><th>Dimension</th><th class="v2-num">Now</th><th class="v2-num">Target</th><th class="v2-num">Pillar gain</th><th class="v2-num">Index gain</th><th>Action</th></tr></thead><tbody>${
    levers.map((a) => `<tr><td>${e(a.lever!.dimension)}</td><td class="v2-num" style="color:${scoreColor(a.lever!.now)}">${a.lever!.now}</td><td class="v2-num">${a.lever!.target}</td><td class="v2-num">+${a.lever!.pillarGain}</td><td class="v2-num"><strong>+${a.lever!.overallGain}</strong></td><td><small>${e(a.title)}</small> <span class="v2-id">${e(a.id)}</span></td></tr>`).join('')
  }</tbody></table><p class="v2-note">Projected by re-running the report's own scoring with the dimension raised to its target; each gain is computed independently and they do not add up exactly.</p>` : '';

  return section(5, 'Strategic action plan', 'What should happen, in what order, and how will each step be verified?', `
    ${block('Action register', `One register: ${actions.length} actions, each with one id. Every other section links here instead of restating an action.`, register, 'v2-allow-break')}
    ${block('90-day roadmap', 'Arrows run from a prerequisite to the action that depends on it.', map)}
    ${leverTable ? block('Score levers', 'Where an action moves a weak dimension, the projected effect on the score.', leverTable) : ''}
  `);
}

// ── 6. Evidence appendix ────────────────────────────────────────────────────

function renderAppendix(ctx: Context): string {
  const p = ctx.payload;
  const r1 = p.report1;
  const sv = obj(r1?.search_visibility) ?? {};
  const cm = obj(obj(p.ai_surface_presence)?.citation_matrix);
  const cov = obj(cm?.coverage);
  const perf = obj(r1?.performance);
  const ct = obj(r1?.competitive_tables);
  const fam = (name: string, state: string, coverage: string, last: string | null, limitation: string, next: string) => {
    const st = stateLabel(state);
    return `<tr><td><strong>${e(name)}</strong></td><td>${pill(st.text, st.tone)}</td><td>${e(coverage)}</td><td>${e(last ?? '—')}</td><td><small>${e(limitation)}</small></td><td><small>${e(next)}</small></td></tr>`;
  };
  const sources = `<table class="v2-table"><thead><tr><th style="width:15%">Evidence family</th><th style="width:13%">State</th><th style="width:15%">Coverage</th><th style="width:11%">Last observed</th><th>Limitation</th><th style="width:19%">Next step</th></tr></thead><tbody>
    ${fam('Website crawl', ctx.crawl.read ? 'measured' : 'unavailable', `${ctx.crawl.read ?? '—'} of ${ctx.crawl.known ?? '—'} URLs read`, ctx.crawl.lastCrawled, ctx.crawl.unread ? `${ctx.crawl.unread} URLs gave no HTTP response.` : 'None recorded.', 'Re-crawl after content changes.')}
    ${fam('Public search results', arr(sv.observations).length ? 'measured' : 'unavailable', `${num(sv.queriesRun) ?? 0} queries`, fmtDate(str(sv.observedAt)), searchQueryQuality(ctx) ?? 'Bounded query set; not market-wide coverage.', 'Check a commercial query set built from the declared category.')}
    ${fam('Competitor discovery', ct?.empty ? 'not_measured' : 'measured', ct?.empty ? 'no validated competitors' : 'competitors classified', null, str(ct?.emptyReason) ?? '—', 'Declare known competitors or broaden discovery paths.')}
    ${fam('Backlinks', String(obj(obj(p.authority_inflow)?.score)?.state ?? 'unavailable'), '—', null, str(obj(obj(p.authority_inflow)?.rationale)?.text) ?? '—', 'Connect a backlink source.')}
    ${fam('AI answer engines', num(cov?.measured_cells) ? 'measured' : arr(cm?.cells).some((c) => /failed to load/i.test(String(obj(c)?.reason_unavailable ?? ''))) ? 'failed' : 'unavailable', `${num(cov?.measured_cells) ?? 0} of ${num(cov?.total_cells) ?? 0} checks`, null, str(obj(obj(p.ai_surface_presence)?.rationale)?.text) ?? '—', 'Repair failed providers; connect a retrieval-grounded engine.')}
    ${fam('Reviews and reputation', String(obj(obj(p.trust_coherence)?.score)?.state ?? 'unavailable'), '—', null, str(obj(obj(p.trust_coherence)?.rationale)?.text) ?? '—', 'Connect a review source.')}
    ${fam('Knowledge graph', sourceState(obj(obj(p.knowledge_graph)?.score), str(obj(obj(p.knowledge_graph)?.rationale)?.text)), '—', null, str(obj(obj(p.knowledge_graph)?.rationale)?.text) ?? '—', 'Wikidata is keyless; it measures once the adapter loads.')}
    ${fam('Advertising libraries', r1?.advertising ? 'measured' : 'not_measured', r1?.advertising ? 'observed' : 'not queried', null, r1?.advertising ? '—' : 'No ad-library observation was made for this run.', 'Run a public ad-library observation.')}
    ${fam('Page performance', String(perf?.state ?? 'unavailable'), `${num(obj(perf?.coverage)?.measured) ?? 0} of ${num(obj(perf?.coverage)?.eligible) ?? 0} pages`, null, str(perf?.reasonUnavailable) ?? '—', 'Enable PageSpeed Insights.')}
  </tbody></table>`;

  const findings = `<table class="v2-table"><thead><tr><th style="width:24%">Finding</th><th style="width:12%">State</th><th>Observation</th><th style="width:16%">Source</th><th style="width:18%">Actions</th></tr></thead><tbody>${
    ctx.registry.findings.map((f) => { const st = stateLabel(f.state); return `<tr><td><strong>${e(f.title)}</strong><br/><span class="v2-id">${e(f.id)}</span></td><td>${pill(st.text, st.tone)}</td><td><small>${e(f.observation)}</small></td><td><small>${e(f.source)}</small></td><td><small>${f.actionIds.map(e).join('<br/>') || '—'}</small></td></tr>`; }).join('')
  }</tbody></table>`;

  const obs = arr(sv.observations).map(obj).filter((o): o is Obj => Boolean(o));
  const queries = obs.length ? `<table class="v2-table"><thead><tr><th>Query</th><th>Class · intent</th><th>Why checked</th><th class="v2-num">Depth</th><th class="v2-num">Position</th><th>Observed</th></tr></thead><tbody>${
    obs.map((o) => `<tr><td><strong>${e(o.query)}</strong></td><td><small>${e(String(o.queryClass ?? '').replace(/_/g, ' '))} · ${e(o.intent)}</small></td><td><small>${e(o.queryRationale)}</small></td><td class="v2-num">${num(o.resultCount) ?? '—'}</td><td class="v2-num">${num(o.position) ?? 'not found'}</td><td><small>${e(fmtDate(str(o.observedAt)) ?? '')} · ${e(o.engine)}</small></td></tr>`).join('')
  }</tbody></table>` : '';

  const groups = arr(obj(r1?.website_checks)?.groups).map(obj).filter((o): o is Obj => Boolean(o));
  const checkRows = groups.flatMap((g) => arr(g.checks).map(obj).filter((o): o is Obj => Boolean(o)).map((c) => {
    const s = String(c.status);
    const tone = s === 'pass' ? 'good' : s === 'warn' || s === 'fail' ? 'warn' : 'neutral';
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
    <tr><td><strong>Index stage</strong></td><td>The Authority Index is staged on six bands: Foundational 0–24 · Emerging 25–39 · Developing 40–54 · Operational 55–69 · Advanced 70–84 · Leading 85–100.</td></tr>
    <tr><td><strong>Score bands</strong></td><td>Individual pillar and dimension scores use a different, four-band scale: foundational 0–24 · developing 25–49 · operational 50–74 · leading 75+. A pillar can therefore read "leading" while the index is "Emerging".</td></tr>
    <tr><td><strong>Search visibility</strong></td><td>Positions are the search provider's own ranks for the queries listed above, within the result depth checked. Not found within that depth is not a rank of zero.</td></tr>
    <tr><td><strong>AI visibility</strong></td><td>Each cell is an answer-engine × question-type check. Unmeasured cells are shown by reason (failed or not configured), never estimated.</td></tr>
    <tr><td><strong>Action register</strong></td><td>One entry per move; recommendations that restate the same move are merged and listed in the duplication audit above.</td></tr>
  </tbody></table>`;

  return section(6, 'Evidence appendix', 'What was observed, where it came from, and how the numbers are calculated.', `
    ${block('Source coverage', 'Every evidence family, whether it was measured, and what it would take to measure it.', sources, 'v2-allow-break')}
    ${block('Findings register', 'Every finding once, with its evidence state and the actions that address it.', findings, 'v2-allow-break')}
    ${queries ? block('Search query records', null, queries, 'v2-allow-break') : ''}
    ${checkRows ? block('Website checks', null, `<table class="v2-table"><thead><tr><th style="width:16%">Area</th><th style="width:26%">Check</th><th style="width:16%">Outcome</th><th>Detail</th></tr></thead><tbody>${checkRows}</tbody></table>`, 'v2-allow-break') : ''}
    ${block('Duplication audit', 'How the action register was assembled.', auditBody, 'v2-allow-break')}
    ${block('Methodology', null, method)}
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
