/**
 * Dossier v2 — one action per move, one finding per condition, auditable merges, and a rendered
 * report with no duplicated content. Synthetic fixture shaped like a real export payload.
 */
import { buildDossierRegistry, similarity } from '../../services/intelligence/dossierV2/registry';
import { renderDossierV2Html } from '../../services/intelligence/dossierV2/render';

const ev = { count: 0, sources: [], freshness: { age_hours: null, last_observed_at: null }, observations: [] };
const score = (value: number | null, state = 'measured') => ({ value, state, band: 'developing', confidence: 'medium', evidence: ev, benchmark: { label: null, value: null } });

const entity = 'Strengthen entity mentions and proof around the core brand and service terms';
const passages = 'Make key passages citation-ready with clear summaries and supporting evidence';
const structure = 'Improve page structure with stronger summaries, FAQs, and heading hierarchy';
const comparison = 'Build comparison and decision pages aligned with the current positioning';
const playbookAction = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, effort: 'medium', confidence: 'low', pillar: 'discoverability', severity: 'critical', reasoning: `${title}.`,
  leverage_score: 40, dependencies: [], evidence: ev, timeline: { short: '', mid: '', long: '' }, owner_area: 'content', expected_outcome: '', ...extra,
});

function payload(): any {
  const actions = [
    playbookAction('geo_aeo:entity', entity, { pillar: 'authority', leverage_score: 55, reasoning: 'Entity clarity scores 28/100 on the public crawl.' }),
    playbookAction('geo_aeo:passages', passages, { leverage_score: 35, reasoning: 'Citation readiness scores 0/100 on the public crawl.', dependencies: ['geo_aeo:entity'] }),
    playbookAction('geo_aeo:structure', structure, { leverage_score: 35, dependencies: ['geo_aeo:entity'] }),
    playbookAction('seo:comparison', comparison, { effort: 'low', confidence: 'high', leverage_score: 20, dependencies: ['geo_aeo:entity'] }),
  ];
  return {
    shape: 'executive', generated_at: '2026-10-24T03:05:44.771Z', tenant_id: 't', company_id: 'c',
    authority_overview: { overall_score: score(36, 'inferred') },
    maturity_stage: { label: 'Emerging', stage: 'emerging', unlock: { explanation: 'Lift Momentum above 40.' }, blocker: { explanation: 'Momentum at 18/100 is the drag.' } },
    pillars: [
      { pillar: 'foundation', label: 'Foundation', score: score(41), dimensions: [
        { key: 'extraction_readiness', label: 'Extraction Readiness', score: score(8), rationale: 'Answers are hard to lift.' },
        { key: 'index_integrity', label: 'Index Integrity', score: score(66) },
      ] },
      { pillar: 'authority', label: 'Authority', score: score(28, 'inferred'), dimensions: [
        { key: 'entity_graph_strength', label: 'Entity Graph Strength', score: score(28, 'inferred'), rationale: 'Entity clarity on page.' },
      ] },
      { pillar: 'discoverability', label: 'Discoverability', score: score(79, 'inferred'), dimensions: [
        { key: 'topical_authority', label: 'Topical Authority', score: score(79, 'inferred') },
        { key: 'ai_surface_presence', label: 'AI Surface Presence', score: score(null, 'insufficient_signal') },
      ] },
      { pillar: 'trust', label: 'Trust', score: score(null, 'insufficient_signal'), dimensions: [] },
      { pillar: 'momentum', label: 'Momentum', score: score(18), dimensions: [
        { key: 'authority_velocity', label: 'Content Freshness', score: score(18), rationale: 'Publishing cadence.' },
      ] },
    ],
    action_playbook: { actions },
    strategic_playbook: { actions },
    improvement_todos: [
      { dimension: 'entity_graph_strength', dimension_label: 'Entity Graph Strength', pillar: 'authority', what: 'Make the brand a clear, well-linked entity in the knowledge graph.',
        how: ['Add complete Organization schema linking every official profile.', 'Keep the brand name, description, and category identical across all profiles to reinforce one entity.',
          'Cover the core topics with entity-rich pages (about, founders, products) that establish what the brand is known for.'],
        effort: 'high', confidence: 'low', current_score: 28, target_score: 53, projected_overall_gain: 6, projected_pillar_gain: 25 },
      { dimension: 'index_integrity', dimension_label: 'Index Integrity', pillar: 'foundation', what: 'Make every important page cleanly crawlable, indexable, and internally linked.',
        how: ['Fix non-200 pages.', 'Add internal links to orphaned pages.'], effort: 'medium', confidence: 'medium', current_score: 66, target_score: 85, projected_overall_gain: 1, projected_pillar_gain: 6 },
      { dimension: 'authority_velocity', dimension_label: 'Content Freshness', pillar: 'momentum', what: 'Establish a steady publishing cadence so the site reads as active and current.',
        how: ['Publish weekly.'], effort: 'medium', confidence: 'low', current_score: 18, target_score: 43, projected_overall_gain: 8, projected_pillar_gain: 25 },
    ],
    ai_surface_presence: { score: score(null, 'insufficient_signal'), rationale: { text: 'Not measured.' }, citation_matrix: { coverage: { measured_cells: 0, total_cells: 4 }, cells: [
      { provider: 'chatgpt', query_class: 'branded', state: 'unavailable', reason_unavailable: 'chatgpt adapter is configured but failed to load' },
      { provider: 'gemini', query_class: 'branded', state: 'unavailable', reason_unavailable: 'gemini adapter is not configured' },
    ] } },
    knowledge_graph: { score: score(28, 'inferred'), rationale: { text: 'knowledge_graph adapter is configured but failed to load: mod.WikidataAdapter is not a constructor' } },
    authority_inflow: { score: score(null, 'unavailable'), rationale: { text: 'No backlink API is configured.' } },
    trust_coherence: { score: score(null, 'unavailable'), rationale: { text: 'No review source is connected.' } },
    report1: {
      digital_snapshot: { topPriorities: [{ id: 'content_search_foundation', title: 'Build out the pages that should carry commercial search demand',
        action: 'Expand the thin pages that map to a commercial offering; consolidate or remove the ones that do not.', effort: 'medium', confidence: 'medium', horizon: '31-60', priorityScore: 32.67,
        businessImplication: 'Thin pages give buyers nothing to act on.', measurement: 'Re-crawl and confirm the pages exceed the threshold.',
        evidence: [{ state: 'measured', statement: '7 of 14 pages have under 150 words' }] }], opportunities: [], plan: { days_0_30: [], days_31_60: [], days_61_90: [] } },
      digital_experience: { findings: [{ problem: 'Pages carry too little content to explain the offering', action: 'Expand the thin pages that matter commercially; consolidate or remove the ones that do not.',
        evidence: '7 of 14 pages have under 150 words', whyItMatters: 'Thin pages answer nothing.', effort: 'medium' }], pillars: [], coverage: { pagesEvaluated: 14 } },
      geo_evidence_decision: { decision: { doNow: [passages, structure, entity], why: 'Readiness is worth improving now.' } },
      evidence_coverage: { connected_sources: 2, total_sources: 6, gaps: [{ area: 'Backlink authority', why: 'No backlink source.', impact: 'Authority is inferred.', next_step: 'Connect a backlink data source.' }] },
      evidence_acquisition: { crawl: { pagesAfter: 90, lastCrawledAt: '2026-10-18T04:06:24Z', action: 'reused' } },
      website_checks: { total: 3, evaluated: 2, pagesEvaluated: 14, groups: [{ label: 'Reachability', checks: [
        { key: 'https', label: 'HTTPS', status: 'pass', detail: 'Pages served over HTTPS' },
        { key: 'cwv', label: 'Core Web Vitals', status: 'not_evaluable', detail: 'Not observable' }] }] },
      search_visibility: { queriesRun: 2, queriesRanked: 0, provider: 'serpapi', observedAt: '2026-10-24T01:22:50Z', reason: 'Not found in 2 queries.', observations: [
        { query: 'login', queryClass: 'use_case', queryOrigin: 'observed_public', position: null, resultCount: 8, competitorDomains: ['wikipedia.org'], intent: 'informational', engine: 'google', queryRationale: 'Link text.' },
        { query: 'ai marketing software', queryClass: 'category', queryOrigin: 'declared', position: 4, resultCount: 10, competitorDomains: ['hubspot.com'], intent: 'commercial', engine: 'google', queryRationale: 'Declared category.' },
      ] },
      company_identity: { fields: [{ key: 'positioning', label: 'Positioning', agreement: 'differ', declaredValue: 'A unified platform', observedValue: 'Fragmented systems limit AI.' }] },
      competitive_tables: { empty: true, emptyReason: 'No competitors could be discovered.', summary: {} },
    },
  };
}

describe('dossier v2 registry', () => {
  const reg = buildDossierRegistry(payload());
  const titles = (id: string) => reg.actions.find((a) => a.id === id)?.mergedTitles ?? [];

  it('every action has a unique id', () => {
    const ids = reg.actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the same move from the strategic playbook, action playbook and GEO list is ONE action', () => {
    const entityActions = reg.actions.filter((a) => a.mergedTitles.includes(entity));
    expect(entityActions).toHaveLength(1);
    expect(entityActions[0].sources).toEqual(expect.arrayContaining(['strategic_playbook', 'action_playbook', 'geo_decision']));
  });

  it('no two actions are near-identical restatements', () => {
    for (let i = 0; i < reg.actions.length; i += 1) {
      for (let j = i + 1; j < reg.actions.length; j += 1) {
        expect(similarity(reg.actions[i].title, reg.actions[j].title)).toBeLessThan(0.6);
      }
    }
  });

  it('snapshot priority and website finding describing the same fix merge', () => {
    const a = reg.actions.find((x) => x.id === 'A-content-search-foundation');
    expect(a?.sources).toEqual(['digital_snapshot', 'digital_experience']);
    expect(a?.priority).toBe(33);
  });

  it('a score lever merges into the action that names its dimension, and not into a look-alike', () => {
    const entityAction = reg.actions.find((x) => x.mergedTitles.includes(entity))!;
    expect(entityAction.lever).toMatchObject({ dimension: 'Entity Graph Strength', now: 28, target: 53, overallGain: 6 });
    // Index Integrity's steps resemble "build out pages" but that action never names the dimension.
    expect(titles('A-content-search-foundation')).not.toContain('Make every important page cleanly crawlable, indexable, and internally linked.');
    expect(reg.actions.some((x) => x.lever?.dimension === 'Index Integrity' && x.sources.length === 1)).toBe(true);
  });

  it('every merge is recorded in the audit, and counts reconcile', () => {
    const sourcesTotal = Object.values(reg.audit.bySource).reduce((a, b) => a + b, 0);
    expect(reg.audit.candidates).toBe(sourcesTotal);
    expect(reg.audit.candidates - reg.audit.merges.length).toBe(reg.audit.actions);
  });

  it('a coverage gap becomes a measurement action linked to its finding', () => {
    const m = reg.actions.find((a) => a.id === 'A-gap-backlink-authority');
    expect(m?.kind).toBe('measurement');
    expect(m?.findingIds).toContain('F-gap-backlink-authority');
  });

  it('a window derived from effort never precedes its prerequisite', () => {
    const order = ['0-30', '31-60', '61-90', 'later'];
    for (const a of reg.actions) {
      for (const dep of a.dependsOn) {
        const d = reg.actions.find((x) => x.id === dep)!;
        if (a.horizonBasis === 'effort') expect(order.indexOf(a.horizon!)).toBeGreaterThanOrEqual(order.indexOf(d.horizon!));
      }
    }
    expect(reg.actions.find((a) => a.mergedTitles.includes(comparison))?.horizon).toBe('31-60');
  });

  it('verification is derived only from a score the action itself names', () => {
    expect(reg.actions.find((a) => a.mergedTitles.includes(passages))?.verification).toBe('Re-run the report and confirm citation readiness rises above 0/100.');
  });

  it('one finding per condition; the declared/observed positioning difference is a finding', () => {
    const ids = reg.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('F-identity-positioning');
    expect(ids).toContain('F-competitors-unresolved');
  });
});

describe('dossier v2 rendered report', () => {
  const html = renderDossierV2Html(payload(), { brandName: 'Acme', domain: 'acme.test' });
  const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('has exactly six numbered sections', () => {
    expect(html.match(/class="v2-section"/g)).toHaveLength(6);
  });

  it('repeats no paragraph or list item across the report', () => {
    const blocks = [...html.matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2])).filter((t) => t.length > 60);
    const seen = new Map<string, number>();
    for (const b of blocks) seen.set(b, (seen.get(b) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('never double-escapes', () => {
    expect(html).not.toMatch(/&amp;(quot|amp|lt|gt|#39);/);
  });

  it('shows a pillar with no value as insufficient evidence, never as zero', () => {
    expect(html).toContain('insufficient evidence — no value');
  });

  it('every action id referenced anywhere exists in the register', () => {
    const reg = buildDossierRegistry(payload());
    const known = new Set(reg.actions.map((a) => a.id));
    const referenced = new Set([...html.matchAll(/\bA-[a-z0-9-]+/g)].map((m) => m[0]));
    for (const id of referenced) expect(known.has(id)).toBe(true);
  });

  it('separates a failed AI provider from an unconfigured one, and a failed source from an inferred value', () => {
    // One AI vocabulary: source failed / not configured, never "provider failed".
    expect(html).toContain('source failed');
    expect(html).not.toContain('provider failed');
    expect(html).toContain('not configured');
    expect(html).toContain('Source failed');
  });

  it('marks the own domain by position and other domains by presence in the query heatmap', () => {
    expect(html).toContain('#4');
    expect(html).toContain('not in top 8');
  });

  it('names all six evidence sources and how "measured" is decided', () => {
    for (const s of ['Website crawl', 'Content &amp; structure', 'Backlinks', 'AI answers', 'Competitors', 'Reviews &amp; reputation']) expect(html).toContain(s);
    expect(html).toContain('Counts as measured when');
  });

  it('never calls a domain from search results a competitor', () => {
    expect(html).not.toMatch(/>\s*(Direct|Confirmed) competitor/i);
    expect(html).toContain('Not yet classified');
  });

  it('gives every section a plain-English summary and defines jargon', () => {
    expect(html.match(/class="v2-plain"/g)).toHaveLength(6);
    expect(html).toContain('Search engine results page');
    expect(html).toContain('Grounded AI answer');
  });

  it('uses calibrated wording, not dramatic certainty', () => {
    expect(html).not.toMatch(/most dangerous|dominant drag/i);
  });
});

describe('dossier v2 states', () => {
  const p = payload();
  p.ai_surface_presence.citation_matrix.cells = [
    { provider: 'chatgpt', query_class: 'branded', state: 'insufficient_signal', reason_unavailable: 'Provider is not retrieval-grounded: its answer reflects model recall, not observed AI visibility.' },
    { provider: 'chatgpt', query_class: 'competitive', state: 'unavailable', reason_unavailable: 'No queries derived for competitive.' },
  ];
  p.knowledge_graph.rationale.text = 'No Wikidata entity was found for this brand, so its knowledge-graph presence could not be established.';
  p.report1.digital_experience.findings[0].evidence = '7 of 14 pages have under 150 words (e.g. https://acme.test/terms, https://acme.test/privacy)';
  p.report1.search_visibility.observations[0].competitorDomains = ['capterra.in', 'medium.com', 'rival.io'];
  const html = renderDossierV2Html(p, { brandName: 'Acme', domain: 'acme.test' });

  it('separates an answer from model memory and a check that was not run from a measurement', () => {
    expect(html).toContain('answered, not grounded');
    expect(html).toContain('not run');
  });

  it('reports a knowledge-graph lookup that found nothing as looked for, not as a failure', () => {
    expect(html).toContain('Looked for, not found');
  });

  it('flags thin-page examples that are legal or account pages (purpose before depth)', () => {
    expect(html).toMatch(/(are account or legal pages|is an account or legal page), short by design/);
  });

  it('classifies directories and platforms by name, and nothing else', () => {
    expect(html).toMatch(/capterra\.in<\/strong><\/td><td><span class="v2-pill v2-pill-info">Software directory/);
    expect(html).toMatch(/rival\.io<\/strong><\/td><td><span class="v2-pill v2-pill-warn">Not yet classified/);
    expect(html).not.toMatch(/medium\.com<\/strong><\/td>/);
  });
});

describe('dossier v2 summary pages and public research', () => {
  const T = '2026-10-24T10:00:00Z';
  const r = (id: string, extra: Record<string, unknown>) => ({ id, claim: id, status: 'observed', confidence: 'high', sourceUrl: 'https://example.test/', observedAt: T, method: 'm', scope: 's', ...extra });
  const pack = () => ({
    subject: { brand: 'Acme', domain: 'acme.test' }, collectedAt: '2026-10-24', collector: 'test', method: { search: 'Google, gl=in' },
    company: [r('E-COM-01', { kind: 'company_definition', status: 'company_declared', claim: 'Pricing: $10/mo', price: '$10 per month' }),
      r('E-COM-02', { kind: 'site_navigation', pages: ['/', '/pricing', '/terms'] })],
    search: [
      r('E-SRC-01', { kind: 'serp', intent: 'branded', query: 'acme', ownPosition: 1, depth: 9, topDomains: ['acme.test'], geography: 'India', language: 'en' }),
      r('E-SRC-02', { kind: 'serp', intent: 'category', query: 'widget platform', ownPosition: null, depth: 8, topDomains: ['rival.io', 'other.io'], geography: 'India', language: 'en' }),
      r('E-SRC-03', { kind: 'serp', intent: 'problem', query: 'fix widgets', ownPosition: null, depth: 9, topDomains: ['label.io'], geography: 'India', language: 'en' }),
    ],
    generative: [
      r('E-GEN-01', { kind: 'ai_overview', surface: 'Google AI Overview', query: 'widget platform', mentioned: false, cited: false, citedDomains: ['a', 'b'] }),
      r('E-GEN-02', { kind: 'ai_overview', surface: 'Google AI Overview', query: 'fix widgets', status: 'failed_source' }),
      r('E-GEN-03', { kind: 'model_recall', surface: 'ChatGPT', status: 'not_measured' }),
      r('E-GEN-04', { kind: 'chatgpt_search', surface: 'ChatGPT search', intent: 'category', query: 'widget platform', mentioned: false, brandsNamed: ['HubSpot'], citedDomains: ['x.io'] }),
      r('E-GEN-05', { kind: 'chatgpt_search', surface: 'ChatGPT search', intent: 'branded', query: 'What is Acme?', mentioned: false, accuracy: 'misidentified' }),
    ],
    competitors: [
      r('E-CMP-01', { kind: 'competitor', name: 'Rival', domain: 'rival.io', classification: 'direct', confidence: 'medium' }),
      r('E-CMP-02', { kind: 'competitor', name: 'Label', domain: 'label.io', classification: 'not_competitor', confidence: 'medium' }),
      r('E-CMP-03', { kind: 'competitor', name: 'Maybe', domain: 'maybe.io', classification: 'substitute_candidate', status: 'insufficient_evidence', confidence: 'low' }),
    ],
    independent: [
      r('E-IND-01', { kind: 'third_party_mention', status: 'looked_for_not_found' }),
      r('E-IND-02', { kind: 'name_collision' }),
    ],
    gaps: [r('E-GAP-01', { kind: 'gap', status: 'not_measured', claim: 'Reviews', method: 'Create listings and re-check.' })],
    site: [r('E-SIT-01', { kind: 'site_basics', claim: 'robots.txt returns HTTP 404', recommends: { id: 'A-site-crawl-basics', title: 'Fix the crawl basics', action: 'Publish robots.txt.', effort: 'low', impact: 'high', verification: 'robots.txt returns 200.' } })],
    benchmark: [r('E-BEN-01', { kind: 'benchmark', dimension: 'customer_proof', claim: 'Customer proof on site', gap: 'Competitors show customers.',
      values: { 'acme.test': { value: 'none found', status: 'looked_for_not_found', url: '' }, 'rival.io': { value: '12 case studies', status: 'company_declared', url: '' } } })],
  });
  const html = renderDossierV2Html(payload(), { brandName: 'Acme', domain: 'acme.test' }, pack());
  const plain = renderDossierV2Html(payload(), { brandName: 'Acme', domain: 'acme.test' });
  const summary = (h: string, id: string) => { const at = h.indexOf(`id="${id}"`); return at < 0 ? '' : h.slice(at, h.indexOf('</section>', at)); };

  it('puts exactly two summary pages after the cover, situation first, before the detailed sections', () => {
    for (const h of [html, plain]) {
      expect(h.match(/class="v2-summary"/g)).toHaveLength(2);
      const cover = h.indexOf('class="v2-cover"');
      const now = h.indexOf('id="summary-now"');
      const next = h.indexOf('id="summary-next"');
      const first = h.indexOf('class="v2-section"');
      expect(cover).toBeLessThan(now);
      expect(now).toBeLessThan(next);
      expect(next).toBeLessThan(first);
    }
  });

  it('page 3 shows the three decision lanes, each with owner class, dependency, success measure and timing — and no internal ids', () => {
    const next = summary(html, 'summary-next');
    for (const title of ['Fix the foundation', 'Improve buyer-intent discoverability', 'Build independent proof and measure again']) expect(next).toContain(title);
    expect(next.match(/class="v2-lane v2-lane-/g)).toHaveLength(3);
    // Every action row: action, business reason, owner class, dependency, success measure, window.
    for (const col of ['Action', 'Business reason', 'Owner', 'Depends on', 'Success measure', 'Window']) {
      expect(next.match(new RegExp(`<th[^>]*>${col}</th>`, 'g'))?.length).toBeGreaterThanOrEqual(2);
    }
    // Evidence-supported actions are told apart from hypotheses.
    expect(next).toMatch(/v2-pill[^>]*>(Evidence|Hypothesis|Partly inferred|Closes a gap)</);
    const text = next.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/\bA-[a-z0-9-]{3,}|E-[A-Z]{3}-\d{2}|[A-Z]{3,}_[A-Z_]*KEY/);
  });

  it('page 2 shows separate search, AI-answer and website indicators from one ledger, plus the discovery path', () => {
    const now = summary(html, 'summary-now');
    expect(now).toMatch(/Search<\/div><div class="v2-ind-value">0<small> of 2<\/small>/);
    expect(now).toMatch(/AI answers<\/div><div class="v2-ind-value">0<small> of 1<\/small>/);
    expect(now).toContain('Website readiness');
    // Each indicator carries a definition and a confidence.
    expect(now.match(/class="v2-ind-def"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(now.match(/class="v2-ind-conf"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(now).toContain('How a buyer looks — and what they find');
    expect(now).toContain('v2-headline');
  });

  it('never shows missing evidence as zero on the summary', () => {
    const now = summary(plain, 'summary-now');
    expect(now.match(/Not measured/g)!.length).toBeGreaterThanOrEqual(2);
    expect(now).not.toMatch(/>0<small> of 0</);
  });

  it('compares only validated competitors, and keeps rejected and unvalidated ones out of the search matrix', () => {
    expect(html).toContain('Direct competitor');
    expect(html).toContain('Not a competitor');
    expect(html).toContain('Possible substitute — unvalidated');
    const matrix = html.slice(html.indexOf('Search results by buyer question'), html.indexOf('AI search: question'));
    const cols = matrix.replace(/<wbr>/g, '');
    expect(cols).toContain('rival.io');
    expect(cols).not.toContain('label.io');
    expect(cols).not.toContain('maybe.io');
  });

  it('prints prices and page roles only from the evidence pack', () => {
    expect(html).toContain('$10 per month');
    expect(html).toContain('Legal / policy');
    expect(plain).not.toContain('Published pricing');
    expect(plain).not.toContain('Page purpose map');
  });

  it('ignores a research pack about another domain', () => {
    const other = { ...pack(), subject: { brand: 'Else', domain: 'else.test' } };
    expect(renderDossierV2Html(payload(), { brandName: 'Acme', domain: 'acme.test' }, other)).not.toContain('E-SRC-01');
  });

  it('lists every research observation by id in the appendix, and every action evidence id exists in the pack', () => {
    const all = Object.values(pack()).filter(Array.isArray).flat() as Array<{ id: string }>;
    const appendix = html.slice(html.indexOf('id="s6"'));
    for (const rec of all) expect(appendix).toContain(rec.id);
    const known = new Set(all.map((x) => x.id));
    for (const a of buildDossierRegistry(payload(), pack() as never).actions) for (const id of a.evidenceIds) expect(known.has(id)).toBe(true);
  });

  it('places the evidence-backed crawl fix in the foundation lane', () => {
    const next = summary(html, 'summary-next');
    const lane = next.slice(next.indexOf('v2-lane-foundation'), next.indexOf('v2-lane-discover'));
    expect(lane).toContain('Fix the crawl basics');
    const reg = buildDossierRegistry(payload(), pack() as never);
    expect(reg.actions.find((a) => a.id === 'A-site-crawl-basics')?.evidenceIds).toEqual(['E-SIT-01']);
  });

  it('benchmarks competitors side by side and marks where the company has nothing comparable', () => {
    expect(html).toContain('How the competitors market themselves');
    expect(html).toMatch(/<td class="v2-gapcell"><small>none found/);
    expect(html).toContain('12 case studies <em>(claimed)</em>');
  });

  it('shows an AI answer that confuses the brand as confused, not as a mention', () => {
    expect(html).toContain('confused with another');
    expect(html).toContain('Who AI answers recommend instead');
  });
});

describe('dossier v2 evidence ledger, footprint and consistency check', () => {
  // Imported lazily so the module-level render cache does not leak between suites.
  const load = () => require('../../services/intelligence/dossierV2/render') as typeof import('../../services/intelligence/dossierV2/render');
  const { buildLedger } = require('../../services/intelligence/dossierV2/ledger') as typeof import('../../services/intelligence/dossierV2/ledger');
  const { validateReport } = require('../../services/intelligence/dossierV2/validate') as typeof import('../../services/intelligence/dossierV2/validate');
  const T = '2026-10-25T01:00:00Z';
  const rec = (id: string, extra: Record<string, unknown>) => ({ id, claim: id, status: 'observed', confidence: 'high', sourceUrl: '', observedAt: T, method: 'm', scope: 's', ...extra });
  const pack = () => ({
    subject: { brand: 'Acme', domain: 'acme.test' }, collectedAt: T, collector: 'pipeline', method: {},
    company: [], search: [], competitors: [], independent: [], gaps: [], site: [], benchmark: [],
    generative: [
      rec('E-GEN-01', { kind: 'claude_search', surface: 'Claude (web search)', intent: 'category', query: 'best widget tools', mentioned: false, brandsNamed: ['Rival'], citedDomains: ['x.io'] }),
      rec('E-GEN-02', { kind: 'claude_search', surface: 'Claude (web search)', intent: 'branded', query: 'What is Acme?', mentioned: true, cited: true, accuracy: 'correct' }),
      rec('E-GEN-03', { kind: 'perplexity', surface: 'Perplexity', intent: 'category', query: 'best widget tools', status: 'not_measured' }),
    ],
    footprint: {
      checkedAt: T, mentionSearch: 'anthropic',
      profiles: [
        { platform: 'LinkedIn', url: 'https://www.linkedin.com/company/acme', declared: true, onHomepage: false, inSameAs: false, attempted: true, httpStatus: 999, outcome: 'login_wall', namesBrand: null, linksDomain: null, state: 'inaccessible', reason: 'The platform requires sign-in (HTTP 999).', checkedAt: T },
        { platform: 'YouTube', url: 'https://www.youtube.com/@acme', declared: true, onHomepage: true, inSameAs: false, attempted: true, httpStatus: 200, outcome: 'responded', namesBrand: true, linksDomain: true, state: 'identity_confirmed', reason: null, checkedAt: T },
      ],
      mentions: [{ url: 'https://dir.test/acme', title: 'Acme on Dir', type: 'directory', check: 'confirmed' }],
      platforms: [{ platform: 'G2', state: 'claimed_unconfirmed', url: 'https://g2.com/acme' }, { platform: 'Capterra', state: 'not_found_in_search', url: '' }],
    },
    runtime: { checkedAt: T, capabilities: [
      { id: 'ai:claude_search', label: 'Claude (web search)', family: 'ai_answers', adapter: true, credential: true, attempted: true, reason: 'measured', outcome: '2 of 2 answered.', nextStep: null },
      { id: 'ai:perplexity', label: 'Perplexity', family: 'ai_answers', adapter: true, credential: false, attempted: false, reason: 'missing_credential', outcome: 'No credential is configured.', nextStep: 'Add an API key for Perplexity.' },
      { id: 'backlinks', label: 'Backlinks', family: 'backlinks', adapter: true, credential: false, attempted: false, reason: 'missing_credential', outcome: '', nextStep: '' },
    ] },
  });
  const run = () => {
    const p = payload();
    // The scoring run (older) says Claude is not configured; the research measured it.
    p.ai_surface_presence.citation_matrix.cells.push({ provider: 'claude', query_class: 'branded', state: 'unavailable', reason_unavailable: 'claude adapter is not configured' });
    return p;
  };

  it('passes the consistency check on every fixture render', () => {
    const { renderDossierV2Html } = load();
    for (const research of [null, pack()]) {
      renderDossierV2Html(run(), { brandName: 'Acme', domain: 'acme.test' }, research);
      const v = load().lastValidation!;
      expect(v.issues.filter((i) => i.blocking)).toEqual([]);
    }
  });

  it('lets newer research evidence replace a stale "not configured" from the scoring run', () => {
    const l = buildLedger(run() as never, pack() as never);
    const claude = l.ai.filter((a) => a.label === 'Claude (web search)');
    expect(claude).toHaveLength(1);
    expect(claude[0]).toMatchObject({ source: 'research', reason: 'measured' });
    const html = load().renderDossierV2Html(run(), { brandName: 'Acme', domain: 'acme.test' }, pack());
    expect(html).toContain('Claude is not shown here');
  });

  it('classifies every access gap: sign-in wall, not configured, reported-not-confirmable, searched-not-found', () => {
    const l = buildLedger(run() as never, pack() as never);
    expect(l.access.find((a) => a.capability === 'LinkedIn profile')?.reason).toBe('restricted');
    expect(l.access.find((a) => a.capability === 'YouTube profile')?.reason).toBe('measured');
    expect(l.access.find((a) => a.capability === 'Perplexity')?.reason).toBe('missing_credential');
    expect(l.access.find((a) => a.capability === 'Review and directory listings')?.reason).toBe('partial');
    expect(l.access.every((a) => Boolean(a.reason))).toBe(true);
    const html = load().renderDossierV2Html(run(), { brandName: 'Acme', domain: 'acme.test' }, pack());
    expect(html).toContain('Source diagnostics');
    // The identity ladder: a sign-in wall is a limitation on a step, not a "no".
    expect(html).toContain('Official profiles: identity, step by step');
    expect(html).toMatch(/requires sign-in|Sign-in wall/);
    expect(html).toContain('reported, not confirmable');
    expect(html).toContain('not found in search');
    expect(html).toContain('External digital footprint');
  });

  it('calls unobserved crawl addresses "not observed", never failures, and the validator would catch it', () => {
    const html = load().renderDossierV2Html(run(), { brandName: 'Acme', domain: 'acme.test' }, pack());
    expect(html).not.toMatch(/no HTTP response/);
    const l = buildLedger(run() as never, pack() as never);
    const reg = buildDossierRegistry(run(), pack() as never);
    const bad = validateReport(l, reg, '<p>76 addresses gave no HTTP response</p>'.replace('76', String(l.crawl.notObserved)), []);
    expect(bad.issues.map((i) => i.rule)).toContain('crawl-wording');
    const broken = { ...l, crawl: { ...l.crawl, notObserved: 5 } };
    expect(validateReport(broken, reg, '', []).passed).toBe(false);
  });

  it('re-scopes a stale "AI visibility cannot be measured" gap to the tools still missing', () => {
    const p = run();
    p.report1.evidence_coverage.gaps.push({ area: 'AI visibility', why: 'No answer engine that retrieves from the live web is connected, so AI visibility cannot be measured at all.', impact: 'Unknown.', next_step: 'Connect a retrieval-grounded answer engine, then regenerate the report.' });
    const reg = buildDossierRegistry(p, pack() as never);
    const f = reg.findings.find((x) => x.id === 'F-gap-ai-visibility')!;
    expect(f.title).toBe('Not every AI search tool could be measured');
    expect(f.observation).toContain('Claude (web search)');
    expect(f.observation).toContain('Perplexity');
    expect(reg.actions.find((a) => a.id === 'A-gap-ai-visibility')?.title).toBe('Measure the remaining AI search tools: Perplexity');
    const html = load().renderDossierV2Html(p, { brandName: 'Acme', domain: 'acme.test' }, pack());
    expect(html).not.toMatch(/cannot be measured at all/);
    expect(load().lastValidation!.passed).toBe(true);
  });

  it('never calls unobserved addresses "unreachable"', () => {
    const { notObservedWording } = load();
    expect(notObservedWording('0 pages returned 4xx/5xx (of 14 that responded; 76 unreachable)')).toBe('0 pages returned 4xx/5xx (of 14 that responded; 76 not observed)');
    const l = buildLedger(run() as never, pack() as never);
    const reg = buildDossierRegistry(run(), pack() as never);
    expect(validateReport(l, reg, `<p>${l.crawl.notObserved} unreachable</p>`, []).issues.map((i) => i.rule)).toContain('crawl-wording');
  });
});
