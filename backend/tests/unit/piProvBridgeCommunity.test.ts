/**
 * A4 — community / listening / scheduled-detection → canonical prospect bridge.
 *
 * Exercises the real builders + the real bridge core + the real contribution
 * writer against in-memory, tenant-keyed fakes of the existing PI services.
 */
import {
  bridgeCommunityFeedItem,
  bridgeEngagementSignal,
  bridgeScheduledDetectionSignal,
  buildCommunityFeedEvent,
  buildScheduledDetectionEvent,
  categoryForFeedItem,
  feedAuthorPlatformUserId,
  withCommunityAuthorIdentity,
  getBridgeCounters,
  resetBridgeCounters,
  BRIDGE_CATEGORIES,
} from '../../services/prospectProvenance/communityBridge';
import { isSourceCategory } from '../../../lib/prospectProvenance/contract';
import { makeWorld, feedItem, listeningSignal, engagementSignal, ORG_A, ORG_B } from './piProvBridge.helpers';

beforeEach(() => resetBridgeCounters());

describe('platform_user_id nesting fix', () => {
  it('reads the author id from author_metadata (where the feed stores it)', () => {
    expect(feedAuthorPlatformUserId(feedItem(ORG_A))).toBe('u_alice');
    expect(feedAuthorPlatformUserId(feedItem(ORG_A, { author_metadata: {} }))).toBeNull();
  });

  it('lifts it to the top level for adoption, preserving every original key', () => {
    const feed = feedItem(ORG_A);
    const row = withCommunityAuthorIdentity(feed);
    expect(row.platform_user_id).toBe('u_alice');
    for (const k of Object.keys(feed)) expect(row[k]).toBe(feed[k]);
    // a top-level value is never overwritten
    expect(withCommunityAuthorIdentity({ ...feed, platform_user_id: 'x' }).platform_user_id).toBe('x');
    // nothing to lift → same object
    const bare = feedItem(ORG_A, { author_metadata: {} });
    expect(withCommunityAuthorIdentity(bare)).toBe(bare);
  });
});

describe('category is decided explicitly from data', () => {
  it('feed item from a listening execution ⇒ social_listening; none ⇒ community', () => {
    expect(categoryForFeedItem(feedItem(ORG_A))).toBe('social_listening');
    // execution row deleted (FK SET NULL) but the trace still names it
    expect(categoryForFeedItem(feedItem(ORG_A, { listening_execution_id: null }))).toBe('social_listening');
    expect(categoryForFeedItem(feedItem(ORG_A, { listening_execution_id: null, explanation: {} }))).toBe('community');
  });

  it('scheduled detection listening ⇒ social_listening; an engagement signal is routed to engagement', () => {
    const l = buildScheduledDetectionEvent(listeningSignal(ORG_A, { metadata: { job_id: 'job-1', posted_at: '2026-10-28T00:00:00Z' } }));
    expect(l.ok && l.event.sourceCategory).toBe('social_listening');
    const e = buildScheduledDetectionEvent(engagementSignal(ORG_A));
    expect(e.ok && e.event.sourceCategory).toBe('engagement');
  });

  it('every category the bridge emits is in the contract vocabulary', () => {
    expect(BRIDGE_CATEGORIES).toEqual(['community', 'social_listening', 'engagement']);
    for (const c of BRIDGE_CATEGORIES) expect(isSourceCategory(c)).toBe(true);
  });
});

describe('community feed → canonical prospect: evidence preserved', () => {
  it('records category, platform, url, observedAt (posted_at), run id and signal refs', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.signals.push(listeningSignal(ORG_A));

    const out = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);

    expect(out).toMatchObject({ status: 'bridged', reason: 'recorded', leadCreated: true, prospectPath: 'created', contribution: 'inserted', contributionRole: 'originating', externalRef: 'community:feed-1' });
    expect(w.prospects).toEqual([expect.objectContaining({ org: ORG_A, key: 'community:feed-1', source: 'community', personId: out.personId })]);
    expect(w.persons).toEqual([expect.objectContaining({ org: ORG_A, keys: JSON.stringify({ 'reddit:user': 'u_alice' }) })]);
    expect(w.sourceRecords).toEqual([expect.objectContaining({ org: ORG_A, provider: 'community', recordId: 'feed-1', runId: 'exec-1', observedAt: '2026-10-29T09:00:00.000Z' })]);

    expect(w.contributions).toHaveLength(1);
    const c = w.contributions[0];
    expect(c).toMatchObject({
      organization_id: ORG_A,
      canonical_lead_id: out.prospectId,
      contribution_role: 'originating',
      source_category: 'social_listening',
      external_ref: 'community:feed-1',
      source_record_id: out.sourceRecordId,
      platform: 'reddit',
      source_url: 'https://reddit.com/r/saas/comments/abc',
      observed_at: '2026-10-29T09:00:00.000Z',
      ingestion_run_id: 'exec-1',
      opportunity_feed_item_id: 'feed-1',
      lead_signal_id: 'sig-1',
      contact_id: 'contact-1',
      engagement_message_id: null,
    });
    expect(c.evidence).toMatchObject({
      observedAtBasis: 'posted_at',
      listeningExecutionId: 'exec-1',
      clusterId: 'cluster-1',
      clusterKey: 'k1',
      sourceIdentifier: 'saas',
      opportunityType: 'buying_intent',
      signalSourceId: 't3_abc',
      scores: { scale: 'unit', opportunity: 0.8, confidence: 0.7, urgency: 0.4 },
    });
  });

  it('observedAt falls back to source_trace.detected_at when the post time is unknown (documented order)', () => {
    const built = buildCommunityFeedEvent(feedItem(ORG_A), listeningSignal(ORG_A, { metadata: {} }));
    expect(built.ok && [built.event.observedAt, built.event.observedAtBasis]).toEqual(['2026-10-29T10:00:00.000Z', 'source_trace_detected_at']);
    const noTrace = buildCommunityFeedEvent(feedItem(ORG_A, { explanation: {} }), null);
    expect(noTrace.ok && noTrace.event.observedAtBasis).toBe('feed_created_at');
  });

  it('a missing lead_signals row degrades to feed-only evidence (no url, no contact) rather than dropping it', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const out = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(out.status).toBe('bridged');
    expect(w.contributions[0]).toMatchObject({ source_url: null, contact_id: null, lead_signal_id: 'sig-1' });
  });
});

describe('idempotency', () => {
  it('a replay of the same feed item converges: one person, one prospect, one source record, one contribution', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.signals.push(listeningSignal(ORG_A));
    const first = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    const second = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(second).toMatchObject({ status: 'bridged', reason: 'already_recorded', contribution: 'duplicate', prospectId: first.prospectId, prospectPath: 'own_key' });
    expect([w.persons.length, w.prospects.length, w.sourceRecords.length, w.contributions.length]).toEqual([1, 1, 1, 1]);
  });

  it('a retry after a failed source-record write still records the ORIGINATING contribution', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.signals.push(listeningSignal(ORG_A));
    w.failNext.ingestSourceRecord = new Error('boom');
    const failed = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(failed).toMatchObject({ status: 'failed', reason: 'source_record_failed:boom' });
    expect(w.prospects).toHaveLength(1);
    expect(w.contributions).toHaveLength(0);

    const retried = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(retried).toMatchObject({ status: 'bridged', prospectPath: 'own_key', contributionRole: 'originating' });
    expect(w.prospects).toHaveLength(1);
  });

  it('a second item by the SAME author contributes to the existing prospect — never a second canonical lead', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const first = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    const second = await bridgeCommunityFeedItem(feedItem(ORG_A, { id: 'feed-2', signal_id: 'sig-2' }), w.deps);
    expect(second).toMatchObject({ status: 'bridged', prospectPath: 'existing_person', leadCreated: false, contributionRole: 'contributing', prospectId: first.prospectId });
    expect(w.prospects).toHaveLength(1);
    expect(w.contributions.map((c) => [c.external_ref, c.contribution_role])).toEqual([
      ['community:feed-1', 'originating'], ['community:feed-2', 'contributing'],
    ]);
  });

  it('when the person already has two prospects the bridge refuses rather than choosing or adding a third', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const { unifiedPersonId } = await w.deps.resolvePerson({ companyId: ORG_A, externalKeys: { 'reddit:user': 'u_alice' } });
    w.prospects.push({ id: 'l1', org: ORG_A, key: 'apollo:1', personId: unifiedPersonId, source: 'apollo' });
    w.prospects.push({ id: 'l2', org: ORG_A, key: 'csv:2', personId: unifiedPersonId, source: 'csv' });
    const out = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(out).toMatchObject({ status: 'skipped', reason: 'ambiguous_person_prospects' });
    expect(w.prospects).toHaveLength(2);
    expect(w.contributions).toHaveLength(0);
  });
});

describe('tenant isolation', () => {
  it("two tenants' identical platform ids never cross", async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.gateOpen.add(ORG_B);
    w.signals.push(listeningSignal(ORG_A), listeningSignal(ORG_B));
    const a = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    const b = await bridgeCommunityFeedItem(feedItem(ORG_B, { id: 'feed-b' }), w.deps);
    expect(a.personId).not.toBe(b.personId);
    expect(a.prospectId).not.toBe(b.prospectId);
    expect(b).toMatchObject({ prospectPath: 'created', contributionRole: 'originating' });
    for (const c of w.contributions) {
      const lead = w.prospects.find((p) => p.id === c.canonical_lead_id)!;
      expect(lead.org).toBe(c.organization_id);
    }
  });

  it('a lead_signals row of another tenant is never used as evidence', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.signals.push(listeningSignal(ORG_B)); // same id, other tenant
    await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(w.contributions[0]).toMatchObject({ contact_id: null, source_url: null });
    expect(buildCommunityFeedEvent(feedItem(ORG_A), listeningSignal(ORG_B))).toEqual({ ok: false, reason: 'signal_tenant_mismatch' });
  });

  it('only the tenant whose gate is open is bridged', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const b = await bridgeCommunityFeedItem(feedItem(ORG_B), w.deps);
    expect(b).toMatchObject({ status: 'skipped', reason: 'gate_closed:tenant_flag:flag_not_found' });
    expect(w.prospects).toHaveLength(0);
  });
});

describe('gate closed ⇒ no canonical work at all', () => {
  it('stops after the gate: no person, prospect, source record, contribution or signal read', async () => {
    const w = makeWorld();
    const out = await bridgeCommunityFeedItem(feedItem(ORG_A), w.deps);
    expect(out.status).toBe('skipped');
    expect(w.calls).toEqual(['gate']);
    expect(getBridgeCounters()).toEqual({ 'community_feed.skipped.gate_closed': 1 });
  });
});

describe('identity and failure posture', () => {
  it('no author id ⇒ skipped, nothing created', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const out = await bridgeCommunityFeedItem(feedItem(ORG_A, { author_metadata: {} }), w.deps);
    expect(out).toMatchObject({ status: 'skipped', reason: 'no_resolvable_identity' });
    expect(w.prospects).toHaveLength(0);
  });

  it('failures are returned and counted, never thrown', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.failNext.resolvePerson = new Error('db down');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(bridgeCommunityFeedItem(feedItem(ORG_A), w.deps)).resolves.toMatchObject({ status: 'failed', reason: 'identity_failed:db down' });
    w.failNext.loadLeadSignal = new Error('timeout');
    await expect(bridgeCommunityFeedItem(feedItem(ORG_A), w.deps)).resolves.toMatchObject({ status: 'failed', reason: 'signal_load_failed:timeout' });
    const throwingGate = { ...w.deps, gate: async () => { throw new Error('x'); } };
    await expect(bridgeCommunityFeedItem(feedItem(ORG_A), throwingGate)).resolves.toMatchObject({ status: 'skipped' });
    expect(getBridgeCounters()).toMatchObject({ 'community_feed.failed.identity_failed': 1, 'community_feed.failed.signal_load_failed': 1 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('engagement signal → canonical prospect', () => {
  it('records category engagement with the engagement_message_id and the campaign post', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const out = await bridgeEngagementSignal(engagementSignal(ORG_A), w.deps);
    expect(out).toMatchObject({ status: 'bridged', externalRef: 'engagement:msg-1', contributionRole: 'originating' });
    expect(w.contributions[0]).toMatchObject({
      source_category: 'engagement', platform: 'linkedin', engagement_message_id: 'msg-1', lead_signal_id: 'esig-1',
      contact_id: 'contact-9', observed_at: '2026-10-29T08:30:00.000Z', ingestion_run_id: null,
    });
    expect(w.contributions[0].evidence).toMatchObject({ scheduledPostId: 'sp-77', threadId: 'thread-1', observedAtBasis: 'message_created_at' });
    expect(w.prospects[0]).toMatchObject({ key: 'engagement:msg-1', source: 'engagement' });
  });

  it('the same author seen through listening and engagement on the same platform joins one prospect', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    const viaFeed = await bridgeCommunityFeedItem(feedItem(ORG_A, { platform: 'linkedin', author_metadata: { platform_user_id: 'li_bob' } }), w.deps);
    const viaEngagement = await bridgeEngagementSignal(engagementSignal(ORG_A), w.deps);
    expect(viaEngagement).toMatchObject({ prospectId: viaFeed.prospectId, prospectPath: 'existing_person', contributionRole: 'contributing' });
  });
});

describe('scheduled lead detection → canonical prospect', () => {
  it('loads the persisted signal (tenant-scoped) and records social_listening with the job as run id', async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.signals.push(listeningSignal(ORG_A, {
      id: 'sig-job', source_id: 'https://x.com/a/status/1', platform: 'twitter', platform_user_id: 'carol',
      metadata: { job_id: 'job-9', mode: 'REACTIVE', posted_at: '2026-10-27T00:00:00.000Z', source_url: 'https://x.com/a/status/1', signal_type: 'EXPLICIT' },
    }));
    const out = await bridgeScheduledDetectionSignal(ORG_A, 'sig-job', w.deps);
    expect(out).toMatchObject({ status: 'bridged', externalRef: 'lead_detection:sig-job' });
    expect(w.contributions[0]).toMatchObject({
      source_category: 'social_listening', platform: 'twitter', source_url: 'https://x.com/a/status/1',
      observed_at: '2026-10-27T00:00:00.000Z', ingestion_run_id: 'job-9', lead_signal_id: 'sig-job',
    });
    expect(w.prospects[0]).toMatchObject({ source: 'listening' });
  });

  it("never reads another tenant's signal", async () => {
    const w = makeWorld();
    w.gateOpen.add(ORG_A);
    w.signals.push(listeningSignal(ORG_B, { id: 'sig-x' }));
    await expect(bridgeScheduledDetectionSignal(ORG_A, 'sig-x', w.deps)).resolves.toMatchObject({ status: 'failed', reason: 'signal_not_found' });
    expect(w.prospects).toHaveLength(0);
  });
});
