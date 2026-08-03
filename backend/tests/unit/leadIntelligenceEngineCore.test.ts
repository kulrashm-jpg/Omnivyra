/**
 * INT-001 Phase 2 test suite (core engines): page classification, intent
 * scoring, persona classification, qualification scoring, segmentation.
 * All engines are pure — no mocks, no I/O, injected `now`.
 */

import {
  classifyPage,
  computeIntentIntelligence,
  classifyPersona,
  buildQualification,
  recomputeQualificationTotal,
  assignSegments,
  defaultEngineConfig,
  emailDomainOf,
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

beforeEach(() => {
  eventSeq = 0;
});

describe('INT-001 Phase 2 — page classifier', () => {
  it('classifies the canonical categories', () => {
    expect(classifyPage('https://omnivyra.com/')).toBe('home');
    expect(classifyPage('https://omnivyra.com/pricing')).toBe('pricing');
    expect(classifyPage('/enterprise')).toBe('enterprise');
    expect(classifyPage('/docs/getting-started')).toBe('documentation');
    expect(classifyPage('/security')).toBe('security');
    expect(classifyPage('/compare/omnivyra-vs-other')).toBe('comparison');
    expect(classifyPage('/book-a-demo')).toBe('demo');
    expect(classifyPage('/blog/how-to-grow')).toBe('blog');
    expect(classifyPage('/case-studies/acme')).toBe('case_study');
    expect(classifyPage('/careers/open-roles')).toBe('careers');
    expect(classifyPage('/resources/report.pdf')).toBe('download');
    expect(classifyPage('/some/unknown/path')).toBe('other');
    expect(classifyPage(null)).toBe('other');
    expect(classifyPage('')).toBe('other');
  });
});

describe('INT-001 Phase 2 — intent engine', () => {
  it('returns zero score with no contributions for an empty journey', () => {
    const intent = computeIntentIntelligence(snap());
    expect(intent.score).toBe(0);
    expect(intent.band).toBe('none');
    expect(intent.contributions).toEqual([]);
  });

  it('scores a pricing-heavy journey with explainable contributions', () => {
    const s = snap({
      events: [
        ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/plans', '2026-08-03T10:05:00.000Z'),
      ],
    });
    const intent = computeIntentIntelligence(s);
    const pricing = intent.contributions.find((c) => c.signal === 'page:pricing');
    expect(pricing).toBeDefined();
    // 2 distinct pricing pages * 10, capped at 20.
    expect(pricing!.points).toBe(20);
    expect(pricing!.evidence).toContain('2 pricing pages');
    const recency = intent.contributions.find((c) => c.signal === 'recency');
    expect(recency?.points).toBe(10); // active within 24h
    // dwell: /pricing view followed 5min later by another event.
    const dwell = intent.contributions.find((c) => c.signal === 'dwell_time');
    expect(dwell?.points).toBe(3);
    expect(intent.score).toBe(33);
    expect(intent.band).toBe('low');
  });

  it('caps each category contribution at its configured cap', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((p, i) => ev('page_view', `/demo/${p}`, `2026-08-03T10:0${i}:00.000Z`));
    const intent = computeIntentIntelligence(snap({ events }));
    const demo = intent.contributions.find((c) => c.signal === 'page:demo');
    expect(demo!.points).toBe(defaultEngineConfig.intent.pageCategoryPoints.demo!.cap);
  });

  it('rewards repeat visits and visit frequency for a repeat visitor', () => {
    const s = snap({
      events: [
        ev('page_view', '/pricing', '2026-08-01T09:00:00.000Z', 's1'),
        ev('page_view', '/docs/api', '2026-08-02T09:00:00.000Z', 's2'),
        ev('page_view', '/security', '2026-08-03T09:00:00.000Z', 's3'),
      ],
    });
    const intent = computeIntentIntelligence(s);
    const repeat = intent.contributions.find((c) => c.signal === 'repeat_visits');
    expect(repeat?.points).toBe(12); // 2 extra sessions * 6, cap 12
    expect(repeat?.evidence).toBe('3 sessions recorded');
    const freq = intent.contributions.find((c) => c.signal === 'visit_frequency');
    expect(freq?.points).toBe(6); // 2 extra active days * 3
  });

  it('counts deep scrolls and downloads', () => {
    const s = snap({
      events: [
        ev('page_view', '/blog/post', '2026-08-03T10:00:00.000Z'),
        ev('scroll_depth', '/blog/post', '2026-08-03T10:01:00.000Z', 's1', { scroll_depth: 90 }),
        ev('scroll_depth', '/blog/post', '2026-08-03T10:02:00.000Z', 's1', { scroll_depth: 50 }),
        ev('file_download', '/resources/report.pdf', '2026-08-03T10:03:00.000Z'),
      ],
    });
    const intent = computeIntentIntelligence(s);
    expect(intent.contributions.find((c) => c.signal === 'scroll_depth')?.points).toBe(3); // one ≥75%
    expect(intent.contributions.find((c) => c.signal === 'downloads')?.points).toBe(6);
  });

  it('never exceeds the configured max score', () => {
    const events: CapturedEvent[] = [];
    const cats = ['pricing', 'enterprise', 'demo', 'compare', 'docs', 'security', 'case-studies', 'download'];
    for (let day = 1; day <= 5; day += 1) {
      for (const c of cats) {
        events.push(ev('page_view', `/${c}/p${day}`, `2026-08-0${day}T10:00:00.000Z`, `s${day}`, { scroll_depth: 95 }));
      }
    }
    const intent = computeIntentIntelligence(snap({ events, now: '2026-08-05T12:00:00.000Z' }));
    expect(intent.score).toBe(100);
    expect(intent.band).toBe('high');
  });

  it('is fully configurable — custom weights change the outcome', () => {
    const custom = {
      ...defaultEngineConfig,
      intent: {
        ...defaultEngineConfig.intent,
        pageCategoryPoints: { pricing: { points: 50, cap: 50, label: 'Pricing' } },
        recency: [],
      },
    };
    const s = snap({ events: [ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z')] });
    const intent = computeIntentIntelligence(s, custom);
    expect(intent.score).toBe(50);
    expect(intent.contributions).toHaveLength(1);
  });
});

describe('INT-001 Phase 2 — persona engine', () => {
  it('classifies a CTO from the job title with reasons', () => {
    const s = snap({ lead: leadProfile({ jobTitle: 'CTO' }) });
    const persona = classifyPersona(s);
    expect(persona.persona).toBe('CTO');
    expect(persona.confidence).toBeGreaterThan(0.5);
    expect(persona.reasons[0]).toContain('CTO');
  });

  it('does not confuse "Director" with CTO (boundary matching)', () => {
    const s = snap({ lead: leadProfile({ jobTitle: 'Director of Operations' }) });
    expect(classifyPersona(s).persona).not.toBe('CTO');
  });

  it('classifies a developer journey from behaviour when title is missing', () => {
    const s = snap({
      lead: leadProfile({ jobTitle: null }),
      events: [
        ev('page_view', '/docs/quickstart', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/docs/api-reference', '2026-08-03T10:10:00.000Z'),
      ],
    });
    const persona = classifyPersona(s);
    // Behaviour-only evidence is weak: below minScore → Unknown, never a guess.
    expect(persona.persona).toBe('Unknown');
    expect(persona.confidence).toBe(0);
  });

  it('title + matching behaviour beats title alone in confidence', () => {
    const titleOnly = classifyPersona(snap({ lead: leadProfile({ jobTitle: 'Software Engineer' }) }));
    const withDocs = classifyPersona(
      snap({
        lead: leadProfile({ jobTitle: 'Software Engineer' }),
        events: [ev('page_view', '/docs/sdk', '2026-08-03T10:00:00.000Z')],
      }),
    );
    expect(titleOnly.persona).toBe('Developer');
    expect(withDocs.persona).toBe('Developer');
    expect(withDocs.confidence).toBeGreaterThan(titleOnly.confidence);
  });

  it('classifies Student from academic email domain', () => {
    const s = snap({ lead: leadProfile({ email: 'sam@cs.stanford.edu', jobTitle: null }) });
    const persona = classifyPersona(s);
    expect(persona.persona).toBe('Student');
    expect(persona.reasons[0]).toContain('cs.stanford.edu');
  });

  it('returns Unknown with zero confidence when nothing matches', () => {
    const s = snap({ lead: leadProfile({ email: 'x@gmail.com', jobTitle: null }) });
    const persona = classifyPersona(s);
    expect(persona.persona).toBe('Unknown');
    expect(persona.confidence).toBe(0);
    expect(persona.reasons.length).toBeGreaterThan(0);
  });

  it('handles a completely empty lead (no email, no title, no events)', () => {
    const s = snap({ lead: leadProfile({ email: null, jobTitle: null }) });
    expect(classifyPersona(s).persona).toBe('Unknown');
  });

  it('emailDomainOf tolerates malformed emails', () => {
    expect(emailDomainOf('nope')).toBeNull();
    expect(emailDomainOf('trailing@')).toBeNull();
    expect(emailDomainOf(null)).toBeNull();
    expect(emailDomainOf('a@B.Com')).toBe('b.com');
  });
});

describe('INT-001 Phase 2 — qualification engine', () => {
  const build = (s: LeadCaptureSnapshot) => {
    const intent = computeIntentIntelligence(s);
    const persona = classifyPersona(s);
    return buildQualification({ snapshot: s, intent, persona });
  };

  it('exposes five sections, each with score, weight and reason', () => {
    const q = build(snap());
    expect(q.sections.map((x) => x.key)).toEqual(['intent', 'persona', 'companyFit', 'behavior', 'urgency']);
    for (const section of q.sections) {
      expect(section.score).toBeGreaterThanOrEqual(0);
      expect(section.score).toBeLessThanOrEqual(100);
      expect(section.weight).toBeGreaterThan(0);
      expect(typeof section.reason).toBe('string');
      expect(section.reason.length).toBeGreaterThan(0);
    }
    const weightSum = q.sections.reduce((a, s) => a + s.weight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
  });

  it('total score is always reproducible from the sections', () => {
    const scenarios = [
      snap(),
      snap({ lead: leadProfile({ jobTitle: 'CEO', companyName: 'Acme', companySize: '1000+', industry: 'SaaS' }) }),
      snap({
        lead: leadProfile({ jobTitle: 'Engineer' }),
        events: [
          ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z'),
          ev('page_view', '/demo', '2026-08-03T10:10:00.000Z'),
        ],
      }),
    ];
    for (const s of scenarios) {
      const q = build(s);
      expect(recomputeQualificationTotal(q)).toBe(q.totalScore);
    }
  });

  it('an enterprise journey scores companyFit and lands in a warmer band than an empty lead', () => {
    const enterprise = build(
      snap({
        lead: leadProfile({ jobTitle: 'CTO', companyName: 'BigCorp', companySize: '1000+', industry: 'Finance' }),
        events: [
          ev('page_view', '/enterprise', '2026-08-03T09:00:00.000Z', 's1'),
          ev('page_view', '/security', '2026-08-03T09:10:00.000Z', 's1'),
          ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z', 's2'),
          ev('page_view', '/book-a-demo', '2026-08-03T10:30:00.000Z', 's2'),
        ],
      }),
    );
    const empty = build(snap({ lead: leadProfile({ email: 'x@gmail.com' }) }));
    const fit = enterprise.sections.find((s) => s.key === 'companyFit')!;
    expect(fit.score).toBeGreaterThanOrEqual(90); // 40 size + 30 domain + 15 industry + 15 name
    expect(fit.reason).toContain('enterprise company size');
    expect(enterprise.totalScore).toBeGreaterThan(empty.totalScore);
    expect(['hot', 'warm']).toContain(enterprise.band);
    expect(empty.band).toBe('cold');
  });

  it('urgency reflects recency, demo/pricing in latest session and acceleration', () => {
    const q = build(
      snap({
        events: [
          ev('page_view', '/blog/a', '2026-07-20T10:00:00.000Z', 's1'),
          ev('page_view', '/blog/b', '2026-08-02T10:00:00.000Z', 's2'),
          ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z', 's3'),
          ev('page_view', '/book-a-demo', '2026-08-03T10:05:00.000Z', 's3'),
        ],
      }),
    );
    const urgency = q.sections.find((s) => s.key === 'urgency')!;
    expect(urgency.score).toBe(100); // 50 recency + 30 demo/pricing + 20 accelerating
    expect(urgency.reason).toContain('demo/pricing viewed in latest session');
  });

  it('missing data degrades to zero-scored sections, never throws', () => {
    const s = snap({ lead: leadProfile({ email: null, name: null, createdAt: null, source: null }) });
    const q = build(s);
    expect(q.totalScore).toBe(0);
    expect(q.band).toBe('cold');
    expect(q.sections.find((x) => x.key === 'behavior')!.reason).toBe('No behavioural events captured');
  });
});

describe('INT-001 Phase 2 — segmentation engine', () => {
  const segmentsFor = (s: LeadCaptureSnapshot) => {
    const intent = computeIntentIntelligence(s);
    const persona = classifyPersona(s);
    const qualification = buildQualification({ snapshot: s, intent, persona });
    return assignSegments({ snapshot: s, intent, persona, qualification });
  };

  it('classifies a research-heavy journey as Researchers', () => {
    const s = snap({
      events: [
        ev('page_view', '/blog/one', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/docs/two', '2026-08-03T10:05:00.000Z'),
        ev('page_view', '/case-studies/three', '2026-08-03T10:10:00.000Z'),
      ],
    });
    const segs = segmentsFor(s);
    const researchers = segs.find((x) => x.segment === 'Researchers');
    expect(researchers).toBeDefined();
    expect(researchers!.confidence).toBeGreaterThanOrEqual(0.3);
    expect(researchers!.reasons[0]).toContain('3 research-type pages');
  });

  it('classifies enterprise + security browsing as Enterprise Buyers', () => {
    const s = snap({
      events: [
        ev('page_view', '/enterprise', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/security', '2026-08-03T10:05:00.000Z'),
      ],
    });
    expect(segmentsFor(s).some((x) => x.segment === 'Enterprise Buyers')).toBe(true);
  });

  it('classifies a developer docs journey as Technical Evaluators', () => {
    const s = snap({
      lead: leadProfile({ jobTitle: 'Backend Developer' }),
      events: [ev('page_view', '/docs/api', '2026-08-03T10:00:00.000Z')],
    });
    expect(segmentsFor(s).some((x) => x.segment === 'Technical Evaluators')).toBe(true);
  });

  it('classifies pricing-only browsing as Price Shoppers', () => {
    const s = snap({
      events: [
        ev('page_view', '/pricing', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/plans', '2026-08-03T10:05:00.000Z'),
      ],
    });
    expect(segmentsFor(s).some((x) => x.segment === 'Price Shoppers')).toBe(true);
  });

  it('flags Decision Makers for a confident CEO persona', () => {
    const s = snap({ lead: leadProfile({ jobTitle: 'CEO' }) });
    const dm = segmentsFor(s).find((x) => x.segment === 'Decision Makers');
    expect(dm).toBeDefined();
    expect(dm!.confidence).toBeGreaterThan(0.5);
  });

  it('flags comparison browsing as Competitor Evaluators', () => {
    const s = snap({ events: [ev('page_view', '/compare/us-vs-them', '2026-08-03T10:00:00.000Z')] });
    expect(segmentsFor(s).some((x) => x.segment === 'Competitor Evaluators')).toBe(true);
  });

  it('flags careers browsing as Job Seekers', () => {
    const s = snap({ events: [ev('page_view', '/careers', '2026-08-03T10:00:00.000Z')] });
    expect(segmentsFor(s).some((x) => x.segment === 'Job Seekers')).toBe(true);
  });

  it('an empty journey is a Cold Visitor and nothing else behavioural', () => {
    const s = snap({ lead: leadProfile({ email: 'x@gmail.com' }) });
    const segs = segmentsFor(s);
    expect(segs.some((x) => x.segment === 'Cold Visitors')).toBe(true);
    expect(segs.some((x) => x.segment === 'High Intent Buyers')).toBe(false);
    expect(segs.some((x) => x.segment === 'Researchers')).toBe(false);
  });

  it('a saturated journey becomes High Intent Buyers with confidence on every segment', () => {
    const events: CapturedEvent[] = [];
    const cats = ['pricing', 'enterprise', 'demo', 'docs', 'security'];
    for (let day = 1; day <= 3; day += 1) {
      for (const c of cats) events.push(ev('page_view', `/${c}/p${day}`, `2026-08-0${day}T10:00:00.000Z`, `s${day}`));
    }
    const s = snap({ events, now: '2026-08-03T12:00:00.000Z' });
    const segs = segmentsFor(s);
    expect(segs.some((x) => x.segment === 'High Intent Buyers')).toBe(true);
    for (const seg of segs) {
      expect(seg.confidence).toBeGreaterThanOrEqual(0.3);
      expect(seg.confidence).toBeLessThanOrEqual(0.95);
      expect(seg.reasons.length).toBeGreaterThan(0);
    }
  });

  it('output ordering is stable (confidence desc, then name)', () => {
    const s = snap({
      events: [
        ev('page_view', '/enterprise', '2026-08-03T10:00:00.000Z'),
        ev('page_view', '/security', '2026-08-03T10:05:00.000Z'),
      ],
    });
    const a = segmentsFor(s);
    const b = segmentsFor(s);
    expect(a).toEqual(b);
    const sorted = [...a].sort((x, z) => (z.confidence - x.confidence) || x.segment.localeCompare(z.segment));
    expect(a).toEqual(sorted);
  });
});
