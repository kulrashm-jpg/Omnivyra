/**
 * Phase 6C contract-equivalence — GET /api/active-leads/opportunities repository cutover.
 * The repository composes the existing canonical opportunity read; the projection must
 * preserve the full OpportunityFeedItem contract (no field loss) and the page envelope,
 * and the type-counts must pass through unchanged. Mocks the composed service.
 */
const calls: { query: unknown[]; counts: unknown[] } = { query: [], counts: [] };
const PAGE = {
  items: [
    {
      id: 'o1', organization_id: 'co1', signal_id: 'sig1', cluster_id: null, listening_execution_id: 'le1',
      opportunity_type: 'buying_intent', opportunity_score: 0.9, confidence_score: 0.8, urgency_score: 0.7,
      source_context: { a: 1 }, detected_reason: 'kw', matched_keywords: ['pricing'], platform: 'reddit',
      source_identifier: 'r/x', author_metadata: { handle: 'u' }, recommendation_context: { r: 1 },
      explanation: {
        why: 'because', matched_keywords: ['pricing'],
        score_breakdown: { base_total_score: 0.8, type_multiplier: 1.1, keyword_match_bonus: 0.1, moderation_penalty: 0, final: 0.9 },
        source_trace: { listening_execution_id: 'le1', source_type: 'listening', source_identifier: 'r/x', platform: 'reddit', detected_at: '2026-01-01T00:00:00Z' },
        moderation: { outcome: 'approved', reasons: [] },
        cluster: { cluster_key: 'ck', cluster_id: null },
      },
      signal_excerpt: 'we need…', suggested_next_action: 'reply', resolved_company: 'Acme', resolved_role: 'CTO',
      identity_confidence: 0.6, priority_score: 0.85, status: 'new', created_at: '2026-01-01T00:00:00Z',
    },
  ],
  next_cursor: null,
  total: 1,
};

jest.mock('../../services/opportunityFeedService', () => ({
  queryOpportunityFeed: jest.fn(async (q: unknown) => { calls.query.push(q); return PAGE; }),
  getOpportunityFeedTypeCounts: jest.fn(async (id: unknown) => { calls.counts.push(id); return { buying_intent: 1, migration_signal: 0 }; }),
}));

import { getOpportunities, getOpportunityTypeCounts, toLegacyOpportunity } from '../../services/leadIntelligence/legacyOpportunityCompat';

beforeEach(() => { calls.query = []; calls.counts = []; });

describe('Phase 6C — legacy /api/active-leads/opportunities repository cutover (byte-identical)', () => {
  it('preserves the FULL opportunity item contract (no field loss/renaming)', () => {
    const out = toLegacyOpportunity(PAGE.items[0] as never);
    expect(out).toEqual(PAGE.items[0]); // deep equality — every nested field preserved
    // explicit guards on the rich/derived fields the contract requires
    expect(out.explanation.score_breakdown).toEqual(PAGE.items[0].explanation.score_breakdown);
    expect(out.explanation.source_trace).toEqual(PAGE.items[0].explanation.source_trace);
    expect(out.explanation.moderation).toEqual(PAGE.items[0].explanation.moderation);
    expect(out.explanation.cluster).toEqual(PAGE.items[0].explanation.cluster);
    expect(out.matched_keywords).toEqual(['pricing']);
    expect(out.suggested_next_action).toBe('reply');
    expect((out as Record<string, unknown>).resolved_company).toBe('Acme');
    expect((out as Record<string, unknown>).resolved_role).toBe('CTO');
    expect((out as Record<string, unknown>).priority_score).toBe(0.85);
  });

  it('getOpportunities returns the page envelope with projected items, params passed through', async () => {
    const page = await getOpportunities({ organizationId: 'co1', types: ['buying_intent'], pageSize: 25 } as never);
    expect(page).toEqual(PAGE); // {items, next_cursor, total} byte-identical
    expect(calls.query[0]).toEqual({ organizationId: 'co1', types: ['buying_intent'], pageSize: 25 });
  });

  it('getOpportunityTypeCounts delegates unchanged', async () => {
    const counts = await getOpportunityTypeCounts('co1');
    expect(counts).toEqual({ buying_intent: 1, migration_signal: 0 });
    expect(calls.counts).toEqual(['co1']);
  });

  it('projection is a copy (mutating the result does not mutate the source item)', () => {
    const src = PAGE.items[0] as never;
    const out = toLegacyOpportunity(src) as Record<string, unknown>;
    out.opportunity_type = 'mutated';
    expect((PAGE.items[0] as Record<string, unknown>).opportunity_type).toBe('buying_intent');
  });
});
