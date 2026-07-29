/**
 * LEAD-INTELLIGENCE-PROGRAM-001 / Phase B — canonical Lead Understanding foundation tests.
 * Deterministic; covers facets, evidence lifecycle, unified scoring, reasoning, contradictions,
 * projection, graph, persistence, shadow runtime, observability, and flags (default OFF).
 */

import {
  facet, nullFacet, facetConfidenceFromEvidence,
  evidenceRef, refresh, supersede, expire, activeEvidence, normalizeEvidence, countByKind,
  combineDimension, combineScores,
  reasoningTrace, isGrounded, validateReasoning,
  detectEvidenceContradictions, detectScoreContradictions, resolveContradiction,
  buildLeadUnderstanding, projectLead,
  node, edge, buildLeadGraph, neighbours,
  toShadowRecord, legacyScoresAdapter,
  compareToLegacy, computeLeadUnderstandingShadow,
  summarizeLeadUnderstandingRun,
  isLeadUnderstandingEnabled, isLeadProjectionAuthoritative,
  type EvidenceRef, type ScoreContribution,
} from '../../services/leadUnderstanding';

const T0 = '2026-07-01T00:00:00.000Z';
const T1 = '2026-07-10T00:00:00.000Z';
const ev = (over: Partial<EvidenceRef> & { id: string }): EvidenceRef =>
  evidenceRef({ id: over.id, kind: over.kind ?? 'observed', label: over.label ?? 'pricing_page', value: over.value ?? 'visited', source: over.source ?? { system: 'website_capture' }, observedAt: over.observedAt ?? T0, recordedAt: over.recordedAt ?? T0, weight: over.weight });
const contrib = (o: Partial<ScoreContribution> & { dimension: ScoreContribution['dimension'] }): ScoreContribution =>
  ({ dimension: o.dimension, contributor: o.contributor ?? 'buyingIntent', method: o.method ?? 'deterministic', value: o.value === undefined ? 0.8 : o.value, confidence: o.confidence ?? 0.9, evidence: o.evidence ?? [ev({ id: `e-${o.dimension}` })], asOf: o.asOf ?? T0 });

describe('LI-B101 facets', () => {
  it('abstains honestly (nullFacet)', () => {
    const f = nullFacet<string>(['no_title_evidence']);
    expect(f.value).toBeNull(); expect(f.confidence).toBe(0); expect(f.unknowns).toEqual(['no_title_evidence']);
  });
  it('derives confidence from evidence breadth + distinct sources', () => {
    expect(facetConfidenceFromEvidence([])).toBe(0);
    const one = facetConfidenceFromEvidence([ev({ id: '1' })]);
    const two = facetConfidenceFromEvidence([ev({ id: '1' }), ev({ id: '2', source: { system: 'crm' } })]);
    expect(two).toBeGreaterThan(one);
  });
  it('facet() lowers confidence for unresolved contradictions', () => {
    const e = [ev({ id: '1' }), ev({ id: '2', source: { system: 'crm' } })];
    const clean = facet('x', e);
    const conflicted = facet('x', e, { contradictions: [{ id: 'c', kind: 'source_conflict', a: '1', b: '2', resolution: 'flag_unresolved', resolved: false }] });
    expect(conflicted.confidence).toBeLessThan(clean.confidence);
  });
});

describe('LI-B102 evidence lifecycle', () => {
  it('created → refreshed → superseded → expired; never deleted', () => {
    const a = ev({ id: 'a' });
    expect(a.lifecycle).toBe('created');
    expect(refresh(a, T1, T1).lifecycle).toBe('refreshed');
    expect(supersede(a, 'b').lifecycle).toBe('superseded');
    expect(supersede(a, 'b').supersededBy).toBe('b');
    expect(expire(ev({ id: 'a', observedAt: '2020-01-01T00:00:00.000Z' }), T0).lifecycle).toBe('expired');
  });
  it('activeEvidence excludes superseded/expired; countByKind + normalize', () => {
    const set = [ev({ id: '1', kind: 'structured' }), supersede(ev({ id: '2', kind: 'ai_generated' }), '1'), ev({ id: '1', kind: 'structured' })];
    expect(activeEvidence(set).map((e) => e.id)).toEqual(['1', '1']);
    expect(normalizeEvidence(set).length).toBe(2); // dedup by id
    expect(countByKind(set).structured).toBe(2);
  });
});

describe('LI-B103 unified scoring', () => {
  it('abstains when no contributor has value+evidence', () => {
    const d = combineDimension('intent', [contrib({ dimension: 'intent', value: null })]);
    expect(d.abstained).toBe(true); expect(d.value).toBeNull();
  });
  it('confidence-weighted blend with method precedence; calibrated on agreement', () => {
    const d = combineDimension('intent', [
      contrib({ dimension: 'intent', contributor: 'buyingIntent', method: 'deterministic', value: 0.8, confidence: 0.9 }),
      contrib({ dimension: 'intent', contributor: 'qualifyLead', method: 'ai_reasoned', value: 0.82, confidence: 0.7 }),
    ]);
    expect(d.abstained).toBe(false); expect(d.calibrated).toBe(true); expect(d.method).toBe('blended');
    expect(d.value).toBeCloseTo(0.807, 2); expect(d.contributors).toEqual(['buyingIntent', 'qualifyLead']);
  });
  it('combineScores blends dimensions; overall abstains when all abstain', () => {
    const s = combineScores([contrib({ dimension: 'intent', value: 0.6 }), contrib({ dimension: 'icp', value: 0.4 })]);
    expect(s.overall).toBeGreaterThan(0); expect(s.dimensions.urgency.abstained).toBe(true);
    expect(combineScores([]).overall).toBeNull();
  });
  it('no single engine owns the final score (contributors blended, not overwritten)', () => {
    const d = combineDimension('intent', [
      contrib({ dimension: 'intent', contributor: 'A', value: 0.9, confidence: 0.9 }),
      contrib({ dimension: 'intent', contributor: 'B', method: 'ai_reasoned', value: 0.5, confidence: 0.6 }),
    ]);
    expect(d.value).toBeGreaterThan(0.5); expect(d.value).toBeLessThan(0.9); // blended, not either raw
  });
});

describe('LI-B104 reasoning', () => {
  it('builds provenance + freshness; grounded conclusion required', () => {
    const t = reasoningTrace({ claim: 'high intent', conclusion: 'high', because: [ev({ id: '1' }), ev({ id: '2', source: { system: 'crm' }, observedAt: T1 })], confidence: 0.8, method: 'deterministic' });
    expect(t.freshness).toBe(T1); expect(t.provenance.map((p) => p.system)).toEqual(['crm', 'website_capture']);
    expect(isGrounded(t)).toBe(true); expect(validateReasoning(t).valid).toBe(true);
  });
  it('rejects ungrounded conclusions and abstention-without-unknown', () => {
    expect(validateReasoning(reasoningTrace({ claim: 'x', conclusion: 'yes', because: [], confidence: 0.5, method: 'llm_grounded' })).valid).toBe(false);
    expect(validateReasoning(reasoningTrace({ claim: 'x', conclusion: null, because: [], confidence: 0, method: 'deterministic' })).valid).toBe(false);
    expect(validateReasoning(reasoningTrace({ claim: 'x', conclusion: null, because: [], confidence: 0, method: 'deterministic', unknowns: ['no data'] })).valid).toBe(true);
  });
});

describe('LI-B107 contradictions', () => {
  it('detects source_conflict + stale_vs_fresh; resolves without deleting', () => {
    const a = ev({ id: 'a', label: 'title', value: 'VP', source: { system: 'crm' }, observedAt: T0, weight: 0.8 });
    const b = ev({ id: 'b', label: 'title', value: 'Director', source: { system: 'form' }, observedAt: T1, weight: 0.5 });
    const src = detectEvidenceContradictions([a, b]);
    expect(src[0].kind).toBe('source_conflict');
    const stale = detectEvidenceContradictions([ev({ id: 'a', label: 'title', value: 'VP', observedAt: '2026-05-01T00:00:00.000Z' }), ev({ id: 'b', label: 'title', value: 'Director', observedAt: T1, source: { system: 'crm' } })]);
    expect(stale[0].kind).toBe('stale_vs_fresh'); expect(stale[0].resolution).toBe('prefer_fresh');
    const map = new Map([[a.id, a], [b.id, b]]);
    const r = resolveContradiction(src[0], map);
    expect(map.size).toBe(2); // loser retained — nothing deleted
    expect(r.resolved).toBe(true);
  });
  it('detects score confidence_divergence between confident contributors', () => {
    const c = detectScoreContradictions([
      contrib({ dimension: 'intent', contributor: 'A', value: 0.3, confidence: 0.7 }),
      contrib({ dimension: 'intent', contributor: 'B', value: 0.8, confidence: 0.8 }),
    ]);
    expect(c[0].kind).toBe('confidence_divergence');
  });
});

describe('LI-B105 projection (single owner, derived reshape)', () => {
  const input = { key: { leadKey: 'L1', companyId: 'C1' }, builtAt: T0, evidence: [ev({ id: '1', kind: 'structured' })], contributions: [contrib({ dimension: 'intent', value: 0.7 })] };
  it('buildLeadUnderstanding is the single producer (score + contradictions + evidenceSummary)', () => {
    const u = buildLeadUnderstanding(input);
    expect(u.score.dimensions.intent.value).toBeCloseTo(0.7, 5);
    expect(u.facets.evidenceSummary.value?.totalEvidence).toBe(1);
    expect(u.version).toBe(1);
  });
  it('projectLead reshapes without recomputing; deterministic', () => {
    const u = buildLeadUnderstanding(input);
    const p1 = projectLead(u, T1); const p2 = projectLead(buildLeadUnderstanding(input), T1);
    expect(p1.scores.intent).toBe(u.score.dimensions.intent.value); // same reference value, not recomputed
    expect(p1).toEqual(p2); // deterministic
  });
});

describe('LI-B106 graph', () => {
  it('dedupes, rejects self-loops, deterministic order; references only', () => {
    const lead = node('lead', 'L1');
    const e1 = edge({ type: 'belongs_to', from: lead, to: node('company', 'C1'), confidence: 0.9 });
    const g = buildLeadGraph(lead, [e1, e1, edge({ type: 'references', from: lead, to: lead })]);
    expect(g.edges.length).toBe(1); // dup removed, self-loop removed
    expect(neighbours(g, 'belongs_to')[0]).toEqual(node('company', 'C1'));
  });
});

describe('LI-B108 persistence', () => {
  it('builds shadow record + legacy compat adapter', () => {
    const u = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: T0, contributions: [contrib({ dimension: 'intent', value: 0.7 })] });
    const rec = toShadowRecord(u, projectLead(u, T0), 0.9);
    expect(rec.company_id).toBe('C1'); expect(rec.lead_key).toBe('L1'); expect(rec.parity).toBe(0.9);
    expect(legacyScoresAdapter.fromUnderstanding(u).intent).toBeCloseTo(0.7, 5);
  });
});

describe('LI-B109 shadow runtime', () => {
  const input = { key: { leadKey: 'L1', companyId: 'C1' }, builtAt: T0, contributions: [contrib({ dimension: 'intent', value: 0.70 })] };
  it('compares to legacy; abstain-vs-abstain agrees', () => {
    const u = buildLeadUnderstanding(input);
    const cmp = compareToLegacy(u, { intent: 0.72, icp: null, urgency: null, total: 0.70 });
    expect(cmp.divergences.find((d) => d.dimension === 'intent')?.agree).toBe(true);
    expect(cmp.divergences.find((d) => d.dimension === 'icp')?.agree).toBe(true); // both abstain
    expect(cmp.parity).toBeGreaterThan(0);
  });
  it('flag-gated: OFF ⇒ null, ON ⇒ bundle', () => {
    delete process.env.LEAD_UNDERSTANDING_ENABLED;
    expect(computeLeadUnderstandingShadow(input, { intent: 0.7 })).toBeNull();
    process.env.LEAD_UNDERSTANDING_ENABLED = 'true';
    const bundle = computeLeadUnderstandingShadow(input, { intent: 0.7 });
    expect(bundle?.understanding.key.leadKey).toBe('L1'); expect(bundle?.comparison).toBeDefined();
    delete process.env.LEAD_UNDERSTANDING_ENABLED;
  });
});

describe('LI-B110 observability + flags', () => {
  it('summarizes a run', () => {
    const u = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: T0, evidence: [ev({ id: '1' })], contributions: [contrib({ dimension: 'intent', value: 0.7 })] });
    const s = summarizeLeadUnderstandingRun([u], [compareToLegacy(u, { intent: 0.7 })]);
    expect(s.leads).toBe(1); expect(s.scoredDimensions.intent).toBe(1); expect(s.shadow.compared).toBe(1);
  });
  it('flags default OFF', () => {
    delete process.env.LEAD_UNDERSTANDING_ENABLED; delete process.env.LEAD_UNDERSTANDING_AUTHORITATIVE;
    expect(isLeadUnderstandingEnabled()).toBe(false); expect(isLeadProjectionAuthoritative()).toBe(false);
  });
});
