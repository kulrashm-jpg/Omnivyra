/**
 * Agent 5 — prospect ↔ opportunity contract (lib/prospectOpportunity/contract.ts).
 *
 * Pure projection only. The database invariants it relies on (composite tenant
 * FKs, append-only lifecycle, one originating contribution) belong to the
 * realschema plan in docs/architecture/PROSPECT-OPPORTUNITY-LIFECYCLE.md §11.
 */

import {
  buildProspectOpportunities,
  ROLLUP_FIELD_MAP,
  type FeedItemOpportunityRow,
  type ProspectContributionRow,
  type ProspectOpportunityInputs,
} from '../../../lib/prospectOpportunity/contract';
import { LIFECYCLE_STATES, type LifecycleState } from '../../types/opportunityLifecycle';
import type { OpportunityAssignment, OpportunityDisposition } from '../../types/opportunityWorkflow';
import type { LifecycleReadResult } from '../../services/opportunityLifecycleService';

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
const P = '11111111-1111-4111-8111-111111111111';
const F1 = 'f1000000-0000-4000-8000-000000000001';
const F2 = 'f2000000-0000-4000-8000-000000000002';
const U1 = 'u1000000-0000-4000-8000-000000000001';
const U2 = 'u2000000-0000-4000-8000-000000000002';

function contribution(id: string, over: Partial<ProspectContributionRow> = {}): ProspectContributionRow {
  return {
    id,
    organizationId: ORG,
    canonicalLeadId: P,
    role: 'contributing',
    sourceCategory: 'social_listening',
    externalRef: `reddit:${id}`,
    platform: 'reddit',
    sourceUrl: null,
    sourceRecordId: null,
    observedAt: '2026-10-01T00:00:00Z',
    signalRefs: {},
    evidence: {},
    ...over,
  };
}

function feedItem(id: string, over: Partial<FeedItemOpportunityRow> = {}): FeedItemOpportunityRow {
  return { id, organizationId: ORG, opportunityType: 'buying_intent', platform: 'reddit', createdAt: '2026-10-01T00:00:00Z', ...over };
}

function present(itemId: string, state: LifecycleState, actor: string | null, at: string, org = ORG): LifecycleReadResult {
  return {
    kind: 'present',
    state,
    isInitial: state === 'detected',
    record: {
      id: `lc-${itemId}-${state}`,
      organization_id: org,
      opportunity_feed_item_id: itemId,
      state,
      previous_state: state === 'detected' ? null : 'detected',
      reasoning: null,
      actor_user_id: actor,
      is_initial: state === 'detected',
      metadata: {},
      transitioned_at: at,
    },
  };
}

function owner(id: string, itemId: string, userId: string, over: Partial<OpportunityAssignment> = {}): OpportunityAssignment {
  return {
    id,
    organization_id: ORG,
    opportunity_feed_item_id: itemId,
    assigned_to_user_id: userId,
    assigned_by_user_id: null,
    role: 'owner',
    metadata: {},
    unassigned_at: null,
    created_at: '2026-10-02T00:00:00Z',
    ...over,
  };
}

function disposition(id: string, itemId: string, d: OpportunityDisposition['disposition'], at: string): OpportunityDisposition {
  return { id, organization_id: ORG, opportunity_feed_item_id: itemId, disposition: d, reason: null, set_by_user_id: U1, metadata: {}, created_at: at };
}

/** One prospect, two opportunity types, different owners and statuses, shared attribution. */
function acceptanceInput(): ProspectOpportunityInputs {
  return {
    organizationId: ORG,
    prospectId: P,
    contributions: [
      contribution('c-orig', { role: 'originating', observedAt: '2026-09-01T00:00:00Z', signalRefs: { opportunityFeedItemId: F1 } }),
      contribution('c-later', { observedAt: '2026-10-05T00:00:00Z', signalRefs: { opportunityFeedItemId: F2 } }),
      contribution('c-crm', { sourceCategory: 'crm', externalRef: 'hubspot:42', platform: 'hubspot', observedAt: '2026-10-06T00:00:00Z' }),
    ],
    feedItems: [
      feedItem(F1, { opportunityType: 'buying_intent' }),
      feedItem(F2, { opportunityType: 'hiring_signal', createdAt: '2026-10-05T00:00:00Z' }),
    ],
    lifecycle: {
      [F1]: present(F1, 'qualified', U1, '2026-10-03T00:00:00Z'),
      [F2]: present(F2, 'triaged', U2, '2026-10-07T00:00:00Z'),
    },
    assignments: [owner('a1', F1, U1), owner('a2', F2, U2)],
    dispositions: [],
  };
}

describe('buildProspectOpportunities — acceptance: one prospect, two opportunity types', () => {
  it('keeps type, owner and status per opportunity and the source attribution shared and intact', () => {
    const r = buildProspectOpportunities(acceptanceInput());

    expect(r.anomalies).toEqual([]);
    expect(r.opportunities.map((o) => [o.opportunityType, o.owner, o.status.kind === 'present' && o.status.state])).toEqual([
      ['buying_intent', { kind: 'assigned', userId: U1, assignedAt: '2026-10-02T00:00:00Z', assignedBy: null }, 'qualified'],
      ['hiring_signal', { kind: 'assigned', userId: U2, assignedAt: '2026-10-02T00:00:00Z', assignedBy: null }, 'triaged'],
    ]);

    // Attribution is prospect-level: one originating, every later source contributing, nothing lost.
    expect(r.sourceAttribution.originating?.id).toBe('c-orig');
    expect(r.sourceAttribution.contributing.map((c) => c.id)).toEqual(['c-later', 'c-crm']);
    // Each opportunity cites only the contributions that point at its own signal.
    expect(r.opportunities.map((o) => o.citingContributionIds)).toEqual([['c-orig'], ['c-later']]);
    expect(r.byType).toEqual({ buying_intent: [F1], hiring_signal: [F2] });
  });

  it('maps status_changed_at / status_changed_by from the latest lifecycle row', () => {
    const [bi, hs] = buildProspectOpportunities(acceptanceInput()).opportunities;
    expect(bi.status).toEqual({ kind: 'present', state: 'qualified', isInitial: false, changedAt: '2026-10-03T00:00:00Z', changedBy: U1 });
    expect(hs.status).toMatchObject({ changedAt: '2026-10-07T00:00:00Z', changedBy: U2 });
  });

  it('is deterministic under input reordering', () => {
    const a = acceptanceInput();
    const b: ProspectOpportunityInputs = {
      ...a,
      contributions: [...a.contributions].reverse(),
      feedItems: [...a.feedItems].reverse(),
      assignments: [...a.assignments].reverse(),
    };
    expect(buildProspectOpportunities(b)).toEqual(buildProspectOpportunities(a));
  });
});

describe('buildProspectOpportunities — owner', () => {
  it('ignores ended assignments and non-owner roles', () => {
    const input = acceptanceInput();
    input.assignments = [
      owner('old', F1, U2, { unassigned_at: '2026-10-01T12:00:00Z', created_at: '2026-10-01T00:00:00Z' }),
      owner('rev', F1, U2, { role: 'reviewer' }),
      owner('a1', F1, U1),
    ];
    const [bi, hs] = buildProspectOpportunities(input).opportunities;
    expect(bi.owner).toMatchObject({ kind: 'assigned', userId: U1 });
    expect(hs.owner).toEqual({ kind: 'unassigned' });
  });

  it('reports two distinct active owners as contradictory instead of picking one', () => {
    const input = acceptanceInput();
    input.assignments = [owner('a1', F1, U1), owner('a1b', F1, U2, { created_at: '2026-10-09T00:00:00Z' })];
    expect(buildProspectOpportunities(input).opportunities[0].owner).toEqual({ kind: 'contradictory', userIds: [U1, U2].sort() });
  });
});

describe('buildProspectOpportunities — status never invented', () => {
  it('missing lifecycle stays missing (never defaulted to detected)', () => {
    const input = acceptanceInput();
    input.lifecycle = { [F1]: { kind: 'missing' } };
    const [bi, hs] = buildProspectOpportunities(input).opportunities;
    expect(bi.status).toEqual({ kind: 'missing' });
    expect(hs.status).toEqual({ kind: 'missing' });
  });

  it('passes unreadable through and refuses a lifecycle row from another tenant or another item', () => {
    const input = acceptanceInput();
    input.lifecycle = {
      [F1]: present(F1, 'qualified', U1, '2026-10-03T00:00:00Z', OTHER_ORG),
      [F2]: present(F1, 'triaged', U2, '2026-10-07T00:00:00Z'),
    };
    const [bi, hs] = buildProspectOpportunities(input).opportunities;
    expect(bi.status).toMatchObject({ kind: 'unreadable', reason: 'cross_tenant' });
    expect(hs.status).toMatchObject({ kind: 'unreadable', reason: 'subject_mismatch' });

    input.lifecycle = { [F1]: { kind: 'unreadable', reason: 'unknown_state', detail: 'state_not_in_vocabulary:won' } };
    expect(buildProspectOpportunities(input).opportunities[0].status)
      .toEqual({ kind: 'unreadable', reason: 'unknown_state', detail: 'state_not_in_vocabulary:won' });
  });

  it('every present state comes from the existing LIFECYCLE_STATES vocabulary', () => {
    for (const s of LIFECYCLE_STATES) {
      const input = acceptanceInput();
      input.lifecycle = { [F1]: present(F1, s, null, '2026-10-03T00:00:00Z') };
      expect(buildProspectOpportunities(input).opportunities[0].status).toMatchObject({ kind: 'present', state: s });
    }
  });

  it('snooze has no carrier: snoozedUntil is null and revisit_later is a disposition only', () => {
    const input = acceptanceInput();
    input.dispositions = [
      disposition('d1', F1, 'qualified', '2026-10-03T00:00:00Z'),
      disposition('d2', F1, 'revisit_later', '2026-10-04T00:00:00Z'),
    ];
    const [bi] = buildProspectOpportunities(input).opportunities;
    expect(bi.snoozedUntil).toBeNull();
    expect(bi.latestDisposition).toEqual({ disposition: 'revisit_later', at: '2026-10-04T00:00:00Z', by: U1, reason: null });
    expect(bi.status).toMatchObject({ kind: 'present', state: 'qualified' });
  });
});

describe('buildProspectOpportunities — tenant safety and attachment', () => {
  it('drops other-tenant rows and other-prospect contributions, reporting each', () => {
    const input = acceptanceInput();
    input.contributions = [
      ...input.contributions,
      contribution('x-org', { organizationId: OTHER_ORG }),
      contribution('x-lead', { canonicalLeadId: '22222222-2222-4222-8222-222222222222' }),
    ];
    input.feedItems = [...input.feedItems, feedItem('f-x', { organizationId: OTHER_ORG })];
    input.assignments = [...input.assignments, owner('a-x', F1, U2, { organization_id: OTHER_ORG })];
    input.dispositions = [{ ...disposition('d-x', F1, 'converted', '2026-10-09T00:00:00Z'), organization_id: OTHER_ORG }];

    const r = buildProspectOpportunities(input);
    expect(r.anomalies).toEqual(expect.arrayContaining([
      { kind: 'cross_tenant_row', table: 'prospect_source_contributions', id: 'x-org' },
      { kind: 'foreign_prospect_contribution', id: 'x-lead' },
      { kind: 'cross_tenant_row', table: 'opportunity_feed_items', id: 'f-x' },
      { kind: 'cross_tenant_row', table: 'opportunity_assignments', id: 'a-x' },
      { kind: 'cross_tenant_row', table: 'opportunity_dispositions', id: 'd-x' },
    ]));
    expect(r.anomalies).toHaveLength(5);
    expect(r.opportunities[0].owner).toMatchObject({ kind: 'assigned', userId: U1 });
    expect(r.opportunities[0].latestDisposition).toBeNull();
    expect([r.sourceAttribution.originating, ...r.sourceAttribution.contributing].map((c) => c?.id)).toEqual(['c-orig', 'c-later', 'c-crm']);
  });

  it('never attaches an uncited feed item, and keeps attribution when a cited item is gone (retention)', () => {
    const input = acceptanceInput();
    input.feedItems = [feedItem(F2, { opportunityType: 'hiring_signal' }), feedItem('f-stray')];
    const r = buildProspectOpportunities(input);
    expect(r.opportunities.map((o) => o.opportunityRef.id)).toEqual([F2]);
    expect(r.anomalies).toEqual(expect.arrayContaining([
      { kind: 'feed_item_not_cited', id: 'f-stray' },
      { kind: 'cited_feed_item_absent', contributionId: 'c-orig', opportunityFeedItemId: F1 },
    ]));
    expect(r.sourceAttribution.originating?.id).toBe('c-orig');
  });

  it('refuses to pick an originating contribution when more than one claims it', () => {
    const input = acceptanceInput();
    input.contributions = [...input.contributions, contribution('c-orig2', { role: 'originating' })];
    const r = buildProspectOpportunities(input);
    expect(r.sourceAttribution.originating).toBeNull();
    expect(r.anomalies).toContainEqual({ kind: 'multiple_originating', ids: ['c-orig', 'c-orig2'] });
  });

  it('two opportunities of the same type stay separate (no roll-up status)', () => {
    const input = acceptanceInput();
    input.feedItems = [feedItem(F1), feedItem(F2, { createdAt: '2026-10-05T00:00:00Z' })];
    const r = buildProspectOpportunities(input);
    expect(r.byType).toEqual({ buying_intent: [F1, F2] });
    expect(r.opportunities.map((o) => o.status.kind === 'present' && o.status.state)).toEqual(['qualified', 'triaged']);
  });
});

describe('ROLLUP_FIELD_MAP — the 20260817 roll-up fields', () => {
  it('covers every field the design brief names, with a carrier or a declared gap', () => {
    for (const f of ['opportunity_type', 'status', 'owner_user_id', 'snoozed_until', 'status_changed_at', 'status_changed_by']) {
      const m = ROLLUP_FIELD_MAP[f];
      expect(m).toBeDefined();
      expect(m.status === 'gap' ? m.carrier === null : typeof m.carrier === 'string').toBe(true);
    }
    expect(ROLLUP_FIELD_MAP.snoozed_until.status).toBe('gap');
    expect(ROLLUP_FIELD_MAP.status.status).toBe('mapped_different_vocabulary');
  });
});
