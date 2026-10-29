/**
 * Publication opportunities: thresholds, never-targets, cap, traceability, not_verified, mandatory
 * evidence gap, no generic fallback, and the action allow-list.
 * Listed hosts (g2.com, reddit.com, …) are used only because the classifier table is what decides
 * the category; every URL path is synthetic.
 */
import { toCitationSources } from '../../services/intelligence/citations/citationSources';
import { aggregateSourceDomains } from '../../services/intelligence/citations/sourceDomainAggregate';
import { ACTION_FOR_CATEGORY, ALLOWED_ACTION_TYPES, OPPORTUNITY_THRESHOLDS, buildCitationIntelligence, buildPublicationOpportunities } from '../../services/intelligence/citations/publicationOpportunities';
import type { CitationRole, CitationSource } from '../../services/intelligence/citations/citationTypes';

let n = 0;
const ans = (provider: string, query: string, urls: Array<[string, CitationRole?]>, brand = false): CitationSource[] =>
  toCitationSources({ provider, query, query_class: 'commercial', grounded_sources: [], observation_id: `E-GEN-${String(++n).padStart(2, '0')}`,
    citations: urls.map(([url, role]) => ({ url, title: null, role: role ?? 'cited' })) }, { is_brand_question: brand });

const subject = { brand: 'Acme', domains: ['acme.test'] };
const competitors = [{ name: 'Rival', domain: 'rival.test' }];
const build = (sources: CitationSource[], answers = 6) => buildCitationIntelligence(sources, {
  subject, competitors, answers: [], groundedBuyerAnswers: answers, providersObserved: [...new Set(sources.map((s) => String(s.provider)))],
});

describe('thresholds', () => {
  it('a domain cited once, or twice by one question on one tool, is not listed; at the bar it is', () => {
    const once = build(ans('perplexity', 'q1', [['https://www.g2.com/x/1']]));
    expect(once.opportunities.opportunities).toEqual([]);
    const sameQSameTool = build([...ans('perplexity', 'q1', [['https://www.g2.com/x/1']]), ...ans('perplexity', 'q1', [['https://www.g2.com/x/2']])]);
    expect(sameQSameTool.opportunities.opportunities).toEqual([]);
    const twoQuestions = build([...ans('perplexity', 'q1', [['https://www.g2.com/x/1']]), ...ans('perplexity', 'q2', [['https://www.g2.com/x/1']])]);
    expect(twoQuestions.opportunities.opportunities.map((o) => o.target.registrable_domain)).toEqual(['g2.com']);
    const twoTools = build([...ans('perplexity', 'q1', [['https://www.g2.com/x/1']]), ...ans('chatgpt_search', 'q1', [['https://www.g2.com/x/1']])]);
    expect(twoTools.opportunities.opportunities).toHaveLength(1);
  });

  it('retrieved-only sources never count; unknown-role ones count at half weight', () => {
    const retrievedOnly = build([...ans('perplexity', 'q1', [['https://www.g2.com/1', 'retrieved']]), ...ans('claude_search', 'q2', [['https://www.g2.com/1', 'retrieved']]), ...ans('claude_search', 'q3', [['https://www.g2.com/1', 'retrieved']])]);
    expect(retrievedOnly.opportunities.opportunities).toEqual([]);
    expect(retrievedOnly.opportunities.inputs.retrieved_only_excluded).toBe(3);
    const twoUnknown = build([...ans('perplexity', 'q1', [['https://www.g2.com/1', 'unknown']]), ...ans('perplexity', 'q2', [['https://www.g2.com/1', 'unknown']])]);
    expect(twoUnknown.opportunities.opportunities).toEqual([]);
    const fourUnknown = build(['q1', 'q2', 'q3', 'q4'].flatMap((q) => ans('perplexity', q, [['https://www.g2.com/1', 'unknown']])));
    expect(fourUnknown.opportunities.opportunities).toHaveLength(1);
    expect(fourUnknown.opportunities.opportunities[0].limitations.join(' ')).toMatch(/half weight/);
  });

  it('unknown, subject-owned and AI/search domains are never targets; competitor-owned is context only, after targets', () => {
    const twice = (url: string) => [...ans('perplexity', 'q1', [[url]]), ...ans('chatgpt_search', 'q2', [[url]])];
    const r = build([...twice('https://somesite.test/a'), ...twice('https://acme.test/a'), ...twice('https://chatgpt.com/x'), ...twice('https://rival.test/p'), ...twice('https://www.reddit.com/r/x')]);
    const o = r.opportunities.opportunities;
    expect(o.map((x) => [x.target.registrable_domain, x.suggested_action])).toEqual([['reddit.com', 'contribute_disclosed_expertise'], ['rival.test', 'none_competitor_owned']]);
    expect(r.domains.map((d) => d.registrable_domain)).toEqual(expect.arrayContaining(['somesite.test', 'acme.test', 'chatgpt.com']));
    expect(r.opportunities.evidence_gap).toMatch(/category is not established from evidence/);
  });

  it('caps at 10 and ranks deterministically', () => {
    const hosts = ['g2.com', 'capterra.com', 'getapp.com', 'trustradius.com', 'trustpilot.com', 'producthunt.com', 'alternativeto.net', 'saasworthy.com', 'reddit.com', 'quora.com', 'medium.com', 'forbes.com'];
    const sources = hosts.flatMap((h, i) => Array.from({ length: 2 + (i % 3) }, (_, k) => ans(k % 2 ? 'perplexity' : 'chatgpt_search', `q${k}`, [[`https://${h}/p${k}`]])).flat());
    const r = build(sources);
    expect(r.opportunities.opportunities).toHaveLength(OPPORTUNITY_THRESHOLDS.max_opportunities);
    expect(r.opportunities.evidence_gap).toBeTruthy();
    const again = build([...sources].reverse());
    expect(again.opportunities.opportunities.map((o) => o.opportunity_id)).toEqual(r.opportunities.opportunities.map((o) => o.opportunity_id));
  });
});

describe('traceability and honesty', () => {
  const sources = [
    ...ans('perplexity', 'best planners', [['https://www.g2.com/categories/planners'], ['https://en.wikipedia.org/wiki/Planner', 'retrieved']]),
    ...ans('chatgpt_search', 'planner comparison', [['https://www.g2.com/compare/a-vs-b']]),
    ...ans('claude_search', 'best planners', [['https://www.g2.com/categories/planners']]),
  ];
  const r = build(sources);
  const [o] = r.opportunities.opportunities;

  it('every evidence id resolves to an observation id or a citation id that counted', () => {
    const ids = new Set([...sources.map((s) => s.observation_id), ...sources.filter((s) => s.citation_role !== 'retrieved').map((s) => s.citation_id)]);
    expect(o.supporting_evidence_ids.length).toBeGreaterThan(0);
    for (const id of o.supporting_evidence_ids) expect(ids.has(id)).toBe(true);
  });

  it('the counts in the text equal counts recomputed from the evidence', () => {
    const citeIds = new Set(o.supporting_evidence_ids);
    const used = sources.filter((s) => citeIds.has(s.citation_id));
    expect(o.counts.citations).toBe(used.filter((s) => s.citation_role === 'cited').length);
    expect(o.counts.questions).toBe(new Set(used.map((s) => s.query)).size);
    expect(o.counts.providers).toBe(new Set(used.map((s) => s.provider)).size);
    expect(o.why_it_may_matter).toContain(`cited ${o.counts.citations} times`);
    expect(o.why_it_may_matter).toContain(`${o.counts.questions} buyer questions`);
    expect(o.why_it_may_matter).toContain(`${o.counts.providers} AI tools`);
    expect(o.relevant_questions.map((q) => q.query)).toEqual(['best planners', 'planner comparison']);
  });

  it('is never verified, never high confidence, and always carries the single-run limitation', () => {
    for (const x of r.opportunities.opportunities) {
      expect(x.verification_status).toBe('not_verified');
      expect(x.confidence).not.toBe('high');
      expect(x.limitations[0]).toMatch(/One run/);
      expect(x.verification_step).toMatch(/Re-run the same buyer questions/);
    }
  });

  it('example URLs are only normalized pages the providers returned', () => {
    const returned = new Set(sources.map((s) => s.normalized_url));
    for (const u of o.target.example_urls) expect(returned.has(u)).toBe(true);
    expect(o.target.label).toBe(o.target.registrable_domain);
  });

  it('the evidence gap is always present and states the counts', () => {
    expect(r.opportunities.evidence_gap).toMatch(/^1 site met the bar .* from 6 grounded buyer answers by 3 AI tools/);
    expect(r.opportunities.evidence_gap).toMatch(/does not support more than 1/);
  });
});

describe('no evidence', () => {
  it('returns no opportunities, a gap statement, and no generic fallback site', () => {
    const r = build([], 0);
    expect(r.opportunities.opportunities).toEqual([]);
    expect(r.domains).toEqual([]);
    expect(r.opportunities.evidence_gap).toMatch(/No grounded AI answers to buyer questions were observed/);
    expect(JSON.stringify(r)).not.toMatch(/g2|capterra|trustpilot|producthunt/i);
  });

  it('brand-question citations alone produce nothing', () => {
    const r = build([...ans('perplexity', 'Acme pricing', [['https://www.g2.com/a']], true), ...ans('chatgpt_search', 'Acme reviews', [['https://www.g2.com/a']], true)], 0);
    expect(r.opportunities.opportunities).toEqual([]);
  });
});

describe('action policy', () => {
  const DENY = /fake|incentivi[sz]|undisclosed|astroturf|sock ?puppet|paid link|buy (links|reviews)|hidden text|prompt injection|cloak|doorway|vote|upvote|review gating|review swap/i;

  it('every template maps to an allowed action type and contains no manipulative practice', () => {
    for (const [cat, a] of Object.entries(ACTION_FOR_CATEGORY)) {
      expect(ALLOWED_ACTION_TYPES).toContain(a.type);
      expect(`${cat}: ${a.text}`).not.toMatch(DENY);
    }
  });

  it('reference entries go through the conflict-of-interest process only', () => {
    expect(ACTION_FOR_CATEGORY.knowledge_reference.type).toBe('correct_or_update_reference_entry');
    expect(ACTION_FOR_CATEGORY.knowledge_reference.text).toMatch(/conflict-of-interest process/);
    expect(ACTION_FOR_CATEGORY.knowledge_reference.text).toMatch(/not by editing it directly/);
  });

  it('generated opportunities use only allowed actions', () => {
    const r = buildPublicationOpportunities(aggregateSourceDomains([], { subject, competitors }), { brand: 'Acme', sources: [], groundedBuyerAnswers: 0, providersObserved: [] });
    expect(r.opportunities.every((o) => ALLOWED_ACTION_TYPES.includes(o.suggested_action))).toBe(true);
  });
});
