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
    expect(html).toContain('provider failed');
    expect(html).toContain('not configured');
    expect(html).toContain('Source failed');
  });

  it('marks the own domain by position and other domains by presence in the query heatmap', () => {
    expect(html).toContain('#4');
    expect(html).toContain('not in top 8');
  });
});
