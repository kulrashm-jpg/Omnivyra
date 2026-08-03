/**
 * INT-001 Phase 2 test suite (composition layer): recommendation generation,
 * timeline building/ordering/dedupe, snapshot assembly from raw stored rows,
 * consolidated summary, confidence calculation and determinism.
 */

import {
  assembleLeadCaptureSnapshot,
  buildLeadIntelligenceSummary,
  buildLeadTimeline,
  buildRecommendations,
  buildQualification,
  computeIntentIntelligence,
  classifyPersona,
  assignSegments,
  type CapturedEvent,
  type LeadCaptureSnapshot,
  type CapturedLeadProfile,
} from '../../services/leadIntelligenceEngine';

const NOW = '2026-08-03T12:00:00.000Z';

const leadProfile = (overrides: Partial<CapturedLeadProfile> = {}): CapturedLeadProfile => ({
  id: 'lead-1',
  email: 'jane@acme.com',
  name: 'Jane Doe',
  jobTitle: null,
  companyName: null,
  companySize: null,
  industry: null,
  country: null,
  primaryInterest: null,
  message: null,
  source: 'website',
  createdAt: '2026-08-03T11:00:00.000Z',
  ...overrides,
});

let eventSeq = 0;
const ev = (eventName: string, pageUrl: string | null, occurredAt: string, sessionId = 's1', metadata: Record<string, unknown> = {}): CapturedEvent => ({
  id: `e${(eventSeq += 1)}`,
  eventName,
  pageUrl,
  sessionId,
  occurredAt,
  metadata,
});

const snap = (overrides: Partial<LeadCaptureSnapshot> = {}): LeadCaptureSnapshot => ({
  lead: leadProfile(),
  events: [],
  sessions: [],
  touchpoints: [],
  now: NOW,
  ...overrides,
});

const recsFor = (s: LeadCaptureSnapshot) => {
  const intent = computeIntentIntelligence(s);
  const persona = classifyPersona(s);
  const qualification = buildQualification({ snapshot: s, intent, persona });
  const segments = assignSegments({ snapshot: s, intent, persona, qualification });
  return { recs: buildRecommendations({ snapshot: s, intent, persona, qualification, segments }), qualification };
};

beforeEach(() => {
  eventSeq = 0;
});

describe('INT-001 Phase 2 — recommendation engine', () => {
  it('answers every question with confidence and explanation', () => {
    const { recs } = recsFor(snap());
    const items = [
      recs.whyValuable, recs.likelyProductInterest, recs.likelyObjections, recs.recommendedContent,
      recs.recommendedOwner, recs.bestChannel, recs.bestContactTime, recs.meetingProbability,
      recs.closeProbability, recs.nextBestAction,
    ];
    for (const item of items) {
      expect(item.confidence).toBeGreaterThanOrEqual(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
      expect(typeof item.explanation).toBe('string');
      expect(item.explanation.length).toBeGreaterThan(0);
    }
  });

  it('prefers the declared primary interest over inferred interest', () => {
    const { recs } = recsFor(snap({ lead: leadProfile({ primaryInterest: 'Content automation' }) }));
    expect(recs.likelyProductInterest.value).toBe('Content automation');
    expect(recs.likelyProductInterest.explanation).toContain('declared');
  });

  it('infers product interest from the dominant page category', () => {
    const s = snap({
      events: [
        ev('page_view', '/docs/a', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/docs/b', '2026-08-03T10:05:00.000Z'),
      ],
    });
    const { recs } = recsFor(s);
    expect(recs.likelyProductInterest.value).toBe('API / technical integration');
  });

  it('derives objections from segments (price shopper → price sensitivity)', () => {
    const s = snap({
      events: [
        ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/plans', '2026-08-03T10:05:00.000Z'),
      ],
    });
    const { recs } = recsFor(s);
    expect(recs.likelyObjections.value).toContain('Price sensitivity');
  });

  it('routes cold leads to nurture and warmer technical leads to a solutions engineer', () => {
    const cold = recsFor(snap({ lead: leadProfile({ email: 'x@gmail.com' }) })).recs;
    expect(cold.recommendedOwner.value).toBe('Marketing nurture');

    const events: CapturedEvent[] = [];
    for (let day = 1; day <= 3; day += 1) {
      events.push(ev('page_view', `/docs/p${day}`, `2026-08-0${day}T10:00:00.000Z`, `s${day}`));
      events.push(ev('page_view', `/pricing`, `2026-08-0${day}T10:10:00.000Z`, `s${day}`));
      events.push(ev('page_view', `/book-a-demo`, `2026-08-0${day}T10:20:00.000Z`, `s${day}`));
    }
    const warm = recsFor(
      snap({
        lead: leadProfile({ jobTitle: 'Staff Engineer', companyName: 'Acme', companySize: '51-200', industry: 'SaaS' }),
        events,
      }),
    );
    expect(['warm', 'hot']).toContain(warm.qualification.band);
    expect(warm.recs.recommendedOwner.value).toBe('Solutions Engineer');
  });

  it('meeting and close probabilities are bounded, reproducible maps of qualification', () => {
    const { recs, qualification } = recsFor(snap({ lead: leadProfile({ jobTitle: 'CEO', companySize: '1000+' }) }));
    const expectedMeet = Math.round(Math.min(0.9, 0.05 + qualification.totalScore * 0.007) * 100) / 100;
    expect(recs.meetingProbability.value).toBe(expectedMeet);
    expect(recs.meetingProbability.value).toBeGreaterThanOrEqual(0);
    expect(recs.meetingProbability.value).toBeLessThanOrEqual(0.9);
    expect(recs.closeProbability.value).toBeLessThanOrEqual(0.75);
  });

  it('derives best contact time from the modal activity hour', () => {
    const s = snap({
      events: [
        ev('page_view', '/a', '2026-08-01T14:10:00.000Z', 's1'),
        ev('page_view', '/b', '2026-08-02T14:20:00.000Z', 's2'),
        ev('page_view', '/c', '2026-08-03T09:00:00.000Z', 's3'),
      ],
    });
    const { recs } = recsFor(s);
    expect(recs.bestContactTime.value).toBe('14:00–15:00 UTC');
    expect(recs.bestContactTime.explanation).toContain('14:00 UTC');
  });

  it('falls back to a general contact time when no events exist', () => {
    const { recs } = recsFor(snap());
    expect(recs.bestContactTime.value).toContain('mornings');
    expect(recs.bestContactTime.confidence).toBeLessThanOrEqual(0.1);
  });
});

describe('INT-001 Phase 2 — opportunity timeline', () => {
  it('orders a full journey chronologically ending with intelligence milestones', () => {
    const s = snap({
      events: [
        ev('page_view', '/pricing', '2026-08-03T10:20:00.000Z'),
        ev('page_view', '/', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/blog/post', '2026-08-03T10:10:00.000Z'),
        ev('page_view', '/compare/x', '2026-08-03T10:30:00.000Z'),
        ev('page_view', '/case-studies/y', '2026-08-03T10:40:00.000Z'),
        ev('page_view', '/book-a-demo', '2026-08-03T10:50:00.000Z'),
      ],
    });
    const timeline = buildLeadTimeline(s, { qualifiedAt: NOW, recommendationGeneratedAt: NOW });
    expect(timeline.map((t) => t.label)).toEqual([
      'Homepage', 'Blog', 'Pricing', 'Comparison', 'Case Study', 'Demo',
      'Lead Submitted', 'Qualified', 'Recommendation Generated',
    ]);
    const times = timeline.map((t) => Date.parse(t.occurredAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('does not duplicate events (same id, or same name/page/time)', () => {
    const dup = ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z');
    const sameKeyDifferentId: CapturedEvent = { ...ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z'), id: null };
    const alsoNullId: CapturedEvent = { ...sameKeyDifferentId };
    const s = snap({ events: [dup, { ...dup }, sameKeyDifferentId, alsoNullId] });
    const timeline = buildLeadTimeline(s);
    // dup id:e1 once + the null-id pair collapses to one → 2 page views + lead_submitted.
    expect(timeline.filter((t) => t.type === 'page_view')).toHaveLength(2);
  });

  it('skips events with invalid timestamps and works for an empty journey', () => {
    const bad: CapturedEvent = { id: 'x', eventName: 'page_view', pageUrl: '/a', sessionId: 's1', occurredAt: 'not-a-date', metadata: {} };
    const timeline = buildLeadTimeline(snap({ events: [bad] }));
    expect(timeline).toHaveLength(1); // only Lead Submitted
    expect(timeline[0].type).toBe('lead_submitted');

    const empty = buildLeadTimeline(snap({ lead: leadProfile({ createdAt: null }) }));
    expect(empty).toEqual([]);
  });

  it('breaks timestamp ties with a stable stage order (capture before intelligence)', () => {
    const s = snap({ lead: leadProfile({ createdAt: NOW }) });
    const timeline = buildLeadTimeline(s, { qualifiedAt: NOW, recommendationGeneratedAt: NOW });
    expect(timeline.map((t) => t.type)).toEqual(['lead_submitted', 'qualified', 'recommendation_generated']);
  });
});

describe('INT-001 Phase 2 — snapshot assembler (raw stored rows)', () => {
  it('normalizes lead, tracking, session and touchpoint rows', () => {
    const snapshot = assembleLeadCaptureSnapshot({
      leadRow: {
        id: 'L1',
        email: 'cto@bigcorp.com',
        name: 'Sam',
        source: 'website',
        created_at: '2026-08-03T11:00:00.000Z',
        metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance', primary_interest: 'Automation' },
      },
      trackingEventRows: [
        { id: 't1', event_name: 'page_view', page_url: 'https://x.com/pricing', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:00:00.000Z', metadata: { scroll_depth: 80 } },
        { id: 't1', event_name: 'page_view', page_url: 'https://x.com/pricing', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:00:00.000Z', metadata: {} }, // duplicate id
        { id: 't2', event_name: 'scroll_depth', page_url: 'https://x.com/pricing', visitor_session_id: 'vs1', occurred_at: 'garbage', metadata: {} }, // bad timestamp
      ],
      visitorSessionRows: [{ id: 'vs1', started_at: '2026-08-03T09:59:00.000Z', first_landing_page: '/pricing', utm_source: 'google' }],
      touchpointRows: [{ id: 'tp1', touchpoint_type: 'first_touch', source: 'google', touched_at: '2026-08-03T09:59:00.000Z' }],
      now: NOW,
    });

    expect(snapshot.lead).toMatchObject({ id: 'L1', email: 'cto@bigcorp.com', jobTitle: 'CTO', companyName: 'BigCorp', companySize: '1000+', primaryInterest: 'Automation' });
    expect(snapshot.events).toHaveLength(1); // duplicate + invalid dropped
    expect(snapshot.events[0]).toMatchObject({ id: 't1', eventName: 'page_view', sessionId: 'vs1' });
    expect(snapshot.sessions[0]).toMatchObject({ id: 'vs1', utmSource: 'google', firstLandingPage: '/pricing' });
    expect(snapshot.touchpoints[0]).toMatchObject({ id: 'tp1', touchpointType: 'first_touch', source: 'google' });
    expect(snapshot.now).toBe(NOW);
  });

  it('tolerates null/missing rows entirely', () => {
    const snapshot = assembleLeadCaptureSnapshot({ leadRow: null, now: NOW });
    expect(snapshot.lead.id).toBeNull();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.touchpoints).toEqual([]);
    const summary = buildLeadIntelligenceSummary(snapshot);
    expect(summary.persona.persona).toBe('Unknown');
    expect(summary.qualification.totalScore).toBe(0);
  });
});

describe('INT-001 Phase 2 — consolidated intelligence summary', () => {
  const enterpriseSnapshot = (): LeadCaptureSnapshot => {
    eventSeq = 0;
    return snap({
      lead: leadProfile({ jobTitle: 'CTO', companyName: 'BigCorp', companySize: '1000+', industry: 'Finance', email: 'cto@bigcorp.com' }),
      events: [
        ev('page_view', '/', '2026-08-01T09:00:00.000Z', 's1'),
        ev('page_view', '/enterprise', '2026-08-01T09:05:00.000Z', 's1'),
        ev('page_view', '/security', '2026-08-02T09:00:00.000Z', 's2'),
        ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z', 's3'),
        ev('page_view', '/book-a-demo', '2026-08-03T10:05:00.000Z', 's3', { scroll_depth: 90 }),
      ],
      sessions: [
        { id: 's1', startedAt: '2026-08-01T09:00:00.000Z', lastSeenAt: null, firstLandingPage: '/', utmSource: null, utmMedium: null, utmCampaign: null },
      ],
    });
  };

  it('consolidates every section with generatedAt === snapshot.now', () => {
    const summary = buildLeadIntelligenceSummary(enterpriseSnapshot());
    expect(summary.leadId).toBe('lead-1');
    expect(summary.intent.score).toBeGreaterThan(0);
    expect(summary.persona.persona).toBe('CTO');
    expect(summary.qualification.sections).toHaveLength(5);
    expect(summary.segments.length).toBeGreaterThan(0);
    expect(summary.recommendations.nextBestAction.value.length).toBeGreaterThan(0);
    expect(summary.timeline[summary.timeline.length - 1].type).toBe('recommendation_generated');
    expect(summary.generatedAt).toBe(NOW);
  });

  it('confidence rises with data completeness and stays within [0, 0.95]', () => {
    const rich = buildLeadIntelligenceSummary(enterpriseSnapshot());
    const sparse = buildLeadIntelligenceSummary(snap({ lead: leadProfile({ email: null }) }));
    expect(rich.confidence).toBeGreaterThan(sparse.confidence);
    expect(rich.confidence).toBeLessThanOrEqual(0.95);
    expect(sparse.confidence).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — identical inputs produce byte-identical output, repeatedly', () => {
    const a = buildLeadIntelligenceSummary(enterpriseSnapshot());
    const b = buildLeadIntelligenceSummary(enterpriseSnapshot());
    const c = buildLeadIntelligenceSummary(enterpriseSnapshot());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toBe(JSON.stringify(c));
  });

  it('does not depend on the wall clock (no Date.now / randomness)', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    const randomSpy = jest.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must never be used by the intelligence engines');
    });
    try {
      const first = buildLeadIntelligenceSummary(enterpriseSnapshot());
      nowSpy.mockReturnValue(999_999_999_999);
      const second = buildLeadIntelligenceSummary(enterpriseSnapshot());
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    } finally {
      nowSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it('handles an empty journey end-to-end (cold, unknown, minimal timeline)', () => {
    const summary = buildLeadIntelligenceSummary(snap({ lead: leadProfile({ email: 'x@gmail.com' }) }));
    expect(summary.intent.band).toBe('none');
    expect(summary.persona.persona).toBe('Unknown');
    expect(summary.qualification.band).toBe('cold');
    expect(summary.segments.some((s) => s.segment === 'Cold Visitors')).toBe(true);
    expect(summary.timeline.map((t) => t.type)).toEqual(['lead_submitted', 'qualified', 'recommendation_generated']);
  });

  it('mutating the config does not leak between runs (input snapshot untouched)', () => {
    const s = enterpriseSnapshot();
    const frozen = JSON.stringify(s);
    buildLeadIntelligenceSummary(s);
    expect(JSON.stringify(s)).toBe(frozen);
  });
});
