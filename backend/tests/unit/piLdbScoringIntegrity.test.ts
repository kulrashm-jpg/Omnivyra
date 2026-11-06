/**
 * PI-LDB Prompt 2B · SCORING INTEGRITY.
 *
 * Three owner decisions, asserted against the real production functions:
 *
 *   1. `lead_captured` (+15, "Submitted a lead form") requires recorded
 *      `inbound_form` evidence. A display source never implies it.
 *   2. `websiteAdapter`'s `other -> website` fallback no longer buys that
 *      claim, because the adapter now states its evidence explicitly.
 *   3. A stored customer-visible score is not silently recalculated when the
 *      scoring MODEL has changed.
 *
 * ─── WHY THE THRESHOLD VALUES ARE WRITTEN OUT ──────────────────────────────
 * `lead_captured` is 15 points and the clamp is 0..100, so a view with no
 * other evidence scores exactly 0 or exactly 15. Those two numbers are the
 * whole difference the owner decision makes, so they are asserted literally
 * rather than compared to each other - a relative assertion would still pass
 * if both moved together, which is precisely the regression to catch.
 *
 * The observation point is always the real scorer's output or the real row the
 * repository sent. No `jest.fn` call count stands in for a score.
 */

import {
  buildBuyingIntentProfile,
  hasLeadFormEvidence,
  canonicalLeadToView,
  materializeCanonicalScores,
  resolveScoreWrite,
  LEAD_SCORE_MODEL_VERSION,
  authorizedScoreModelTransition,
  websiteAdapter,
  computeLeadDedupeKey,
  type CanonicalLead,
  type CanonicalLeadView,
} from '../../../lib/leadIntelligence';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const AT = '2026-11-05T10:00:00.000Z';

/* ── the minimum view the scorer needs, with nothing else to score on ──────*/

function viewOf(over: Partial<CanonicalLeadView> = {}): CanonicalLeadView {
  return {
    organizationId: ORG,
    source: 'crm',
    sourceLabel: 'CRM',
    unifiedPersonId: 'up-1',
    identity: { email: 'a@b.test', unifiedPersonId: 'up-1' },
    scores: {},
    status: null,
    campaign: null,
    content: null,
    referrer: null,
    utm: { source: null, medium: null, campaign: null, content: null, term: null },
    occurredAt: AT,
    sourceRef: { table: 'canonical_leads', id: 'prospect-1' },
    attribution: {
      originalSource: null,
      originalChannel: null,
      campaign: null,
      content: null,
      session: null,
      journey: null,
      referrer: null,
      utm: { source: null, medium: null, campaign: null, content: null, term: null },
      identity: {},
      sourceMetadata: {},
    },
    ...over,
  } as CanonicalLeadView;
}

const form = { category: 'inbound_form' as const, platform: null, observedAt: AT };
const types = (v: CanonicalLeadView) => buildBuyingIntentProfile({ view: v }).evidence.map((e) => e.type);

/* ════════════════════════════════════════════════════════════════════════════
 * 1. THE EVIDENCE RULE
 * ══════════════════════════════════════════════════════════════════════════*/

describe('PI-LDB 2B · `lead_captured` requires form evidence, not a label', () => {
  it('hasLeadFormEvidence is true for `inbound_form` and false for every other category', () => {
    expect(hasLeadFormEvidence(viewOf({ origin: form }))).toBe(true);
    for (const category of [
      'crm', 'csv', 'manual', 'pi_discovery', 'pi_enrichment', 'website',
      'marketpulse', 'social_listening', 'community', 'engagement',
      // Excluded deliberately, not overlooked: a webhook CAN carry a genuine
      // submission, but nothing on this path inspects its payload.
      'inbound_webhook',
    ] as const) {
      expect(hasLeadFormEvidence(viewOf({ origin: { category, platform: null, observedAt: AT } })))
        .toBe(false);
    }
  });

  it('FAIL-CLOSED: no origin at all, a null category, and an absent one all withhold the claim', () => {
    expect(hasLeadFormEvidence(viewOf())).toBe(false);
    expect(hasLeadFormEvidence(viewOf({ origin: null }))).toBe(false);
    expect(hasLeadFormEvidence(viewOf({ origin: { category: null, platform: null, observedAt: null } })))
      .toBe(false);
  });

  it('every former CAPTURE_SOURCES member now scores 0 on its label alone', () => {
    // THE REGRESSION THIS SUITE EXISTS FOR. These nine display sources were
    // the old capture set. `crm`, `manual` and `other` made the claim provably
    // false, and `other` is how a purchased Apollo contact arrived carrying
    // "Submitted a lead form" (`apollo` has no RAW_ALIASES entry, so
    // `resolveCanonicalSource` falls through to `other`).
    for (const source of [
      'website', 'blog', 'manual', 'webhook', 'referral', 'partner', 'api', 'crm', 'other',
    ] as const) {
      const profile = buildBuyingIntentProfile({ view: viewOf({ source }) });
      expect(profile.evidence.map((e) => e.type)).not.toContain('lead_captured');
      expect(profile.score).toBe(0);
      expect(profile.scoreBreakdown).toEqual([]);
    }
  });

  it('a lead with form evidence scores exactly 15 and names the claim', () => {
    const profile = buildBuyingIntentProfile({ view: viewOf({ origin: form }) });
    expect(profile.evidence.map((e) => e.type)).toContain('lead_captured');
    expect(profile.score).toBe(15);
    // The operator-visible string is the reason the rule exists, so it is
    // asserted verbatim rather than trusted to the weight table.
    expect(profile.scoreBreakdown.map((b) => b.label)).toContain('Submitted a lead form');
  });

  it('the claim is independent of the display source - evidence decides, both ways', () => {
    // Same evidence, nine different labels: all 15. Same nine labels, no
    // evidence: all 0 (asserted above). Together those two pin the rule as a
    // rule rather than a special case for one source.
    for (const source of [
      'website', 'blog', 'manual', 'webhook', 'referral', 'partner', 'api', 'crm', 'other',
    ] as const) {
      expect(buildBuyingIntentProfile({ view: viewOf({ source, origin: form }) }).score).toBe(15);
    }
  });

  it('the +15 does not leak into the decision STAGE for an unevidenced lead', () => {
    // `classifyStage` moves to `interest` at score >= 15. So the fabricated
    // claim did not only inflate a number: it advanced the lead a stage, which
    // is what an operator actually acts on.
    expect(buildBuyingIntentProfile({ view: viewOf({ source: 'crm' }) }).decisionStage).toBe('awareness');
    expect(buildBuyingIntentProfile({ view: viewOf({ source: 'crm', origin: form }) }).decisionStage)
      .toBe('interest');
  });
});

describe('PI-LDB 2B · the decision journey states the same claim as the score', () => {
  const journey = (v: CanonicalLeadView) =>
    buildBuyingIntentProfile({ view: v }).decisionJourney.map((s) => `${s.label}|${s.detail ?? ''}`);

  it('says "Converted / Lead captured" only when the score also claims it', () => {
    expect(journey(viewOf({ origin: form }))).toContain('Converted|Lead captured');
  });

  it('says "Added" with the recorded provenance when there is no form evidence', () => {
    // The half-fix guarded against: scoring an Apollo contact correctly and
    // still labelling it "Converted" on the screen.
    const apollo = viewOf({
      source: 'crm',
      origin: { category: 'pi_discovery', platform: 'apollo', observedAt: AT },
    });
    const steps = journey(apollo);
    expect(steps).not.toContain('Converted|Lead captured');
    expect(steps.some((s) => s.startsWith('Converted'))).toBe(false);
    // Named truthfully, from the provenance, via the existing label helper.
    expect(steps).toContain('Added|Prospect discovery · Apollo');
  });

  it('falls back to the display-source label when no provenance was recorded', () => {
    expect(journey(viewOf({ source: 'crm' }))).toContain('Added|CRM');
    expect(journey(viewOf({ source: 'manual' }))).toContain('Added|Manual');
  });

  it('the score and the journey can never disagree, across every category', () => {
    // ONE invariant standing in for both surfaces: they read the same
    // predicate, so this fails if either is changed alone.
    for (const category of [
      null, 'inbound_form', 'inbound_webhook', 'crm', 'csv', 'manual', 'pi_discovery', 'website',
    ] as const) {
      const v = viewOf({ origin: { category, platform: null, observedAt: AT } });
      const profile = buildBuyingIntentProfile({ view: v });
      const claimsInScore = profile.evidence.some((e) => e.type === 'lead_captured');
      const claimsInWords = profile.decisionJourney.some((s) => s.label === 'Converted');
      expect(claimsInScore).toBe(claimsInWords);
    }
  });
});

describe('PI-LDB 2B · the WRITE path can see the evidence at all', () => {
  const leadOf = (over: Partial<CanonicalLead> = {}): CanonicalLead => ({
    organizationId: ORG,
    source: 'crm',
    identity: { email: 'a@b.test', unifiedPersonId: 'up-1' },
    attribution: viewOf().attribution,
    status: null,
    occurredAt: AT,
    sourceRef: { table: 'canonical_leads', id: 'prospect-1' },
    unifiedPersonId: 'up-1',
    ingestedAt: AT,
    ...over,
  } as CanonicalLead);

  it('canonicalLeadToView carries `origin` through', () => {
    // Without this the rule is fail-closed for EVERY lead on the write path -
    // right by accident, and for the wrong reason.
    expect(canonicalLeadToView(leadOf({ origin: form })).origin).toEqual(form);
    expect(canonicalLeadToView(leadOf()).origin).toBeNull();
  });

  it('materializeCanonicalScores grants the +15 only with evidence on the lead', () => {
    expect(materializeCanonicalScores(leadOf({ origin: form })).intent).toBeCloseTo(0.15, 10);
    expect(materializeCanonicalScores(leadOf()).intent).toBe(0);
    // A discovery prospect: durable, correctly sourced, and NOT a form submit.
    expect(materializeCanonicalScores(leadOf({
      origin: { category: 'pi_discovery', platform: 'apollo', observedAt: AT },
    })).intent).toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * 2. THE ADAPTER
 * ══════════════════════════════════════════════════════════════════════════*/

describe('PI-LDB 2B · websiteAdapter states its evidence instead of implying it', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'l1', company_id: ORG, email: 'a@b.com', created_at: AT, ...over,
  });

  it('claims `inbound_form` only for the alias family that denotes a form', () => {
    expect(websiteAdapter(row({ source: 'form' })).origin?.category).toBe('inbound_form');
    expect(websiteAdapter(row({ source: 'form_embed' })).origin?.category).toBe('inbound_form');
    expect(websiteAdapter(row({ unified_source: { origin: 'form_embed' } })).origin?.category)
      .toBe('inbound_form');
  });

  it('an unclassifiable row is `null` - explicitly NOT a form', () => {
    // This is the `other -> website` fallback. The display source is still
    // `website` (see below); what changed is that it no longer asserts a
    // submission, which is all it was ever being read for.
    const i = websiteAdapter(row({ source: 'Trade Show' }));
    expect(i.source).toBe('website');
    expect(i.origin?.category).toBeNull();
    expect(hasLeadFormEvidence({ ...viewOf(), origin: i.origin } as CanonicalLeadView)).toBe(false);
  });

  it('a channel is recorded as a channel', () => {
    expect(websiteAdapter(row({ source: 'website' })).origin?.category).toBe('website');
    expect(websiteAdapter(row({ source: 'webhook' })).origin?.category).toBe('inbound_webhook');
    expect(websiteAdapter(row({ source: 'manual' })).origin?.category).toBe('manual');
  });

  it('THE PERSISTED KEY DOES NOT MOVE - no existing row is orphaned', () => {
    // `source` is inside `dedupe_key`, the upsert's own conflict target, and
    // inside lead keys and audience memberships. These are the values
    // origin/main produces, asserted so the correction above cannot be
    // "improved" later into a silent data migration.
    expect(websiteAdapter(row({ source: 'Trade Show' })).source).toBe('website');
    expect(websiteAdapter(row({ source: 'form_embed' })).source).toBe('website');
    expect(websiteAdapter(row({ source: 'webhook' })).source).toBe('webhook');
    expect(computeLeadDedupeKey(websiteAdapter(row({ source: 'Trade Show' }))))
      .toBe('src:website|tbl:leads|id:l1');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * 3. SCORE PROTECTION
 * ══════════════════════════════════════════════════════════════════════════*/

describe('PI-LDB 2B · resolveScoreWrite protects a stored score', () => {
  const computed = { intent: 0, total: 0, confidence: 0.2, modelVersion: LEAD_SCORE_MODEL_VERSION };

  afterEach(() => { delete process.env.LEAD_SCORE_MODEL_TRANSITION; });

  it('writes when there is nothing stored', () => {
    for (const stored of [null, undefined, {}, { intent: null, total: null }]) {
      const d = resolveScoreWrite(stored as never, computed);
      expect(d.action).toBe('write');
      expect(d.reason).toBe('no_stored_score');
      expect(d.scores).toBe(computed);
    }
  });

  it('writes when the stored score came from the SAME model', () => {
    const d = resolveScoreWrite({ intent: 0.35, modelVersion: LEAD_SCORE_MODEL_VERSION }, computed);
    expect(d.action).toBe('write');
    expect(d.reason).toBe('same_model');
  });

  it('PRESERVES a stored score from an earlier model', () => {
    const stored = { intent: 0.35, total: 0.35, modelVersion: 'bi-1' };
    const d = resolveScoreWrite(stored, computed);
    expect(d.action).toBe('preserve');
    expect(d.reason).toBe('earlier_model');
    expect(d.storedVersion).toBe('bi-1');
    expect(d.scores).toBe(stored);
  });

  it('PRESERVES an UNSTAMPED stored score - pre-versioning or source-provided', () => {
    // The population the drift would actually have hit: every row written
    // before the stamp existed. Treated as an earlier model, not as a blank.
    for (const stored of [
      { intent: 0.35 },
      { intent: 0.35, modelVersion: null },
      { intent: 0.35, modelVersion: '   ' },
      // A System-B `qualifyLead` score: ours must never replace it.
      { total: 0.8, scale: 'unit' as const },
    ]) {
      const d = resolveScoreWrite(stored as never, computed);
      expect(d.action).toBe('preserve');
      expect(d.storedVersion).toBeNull();
    }
  });

  it('recomputes ONLY under an explicit transition naming the current version', () => {
    const stored = { intent: 0.35, modelVersion: 'bi-1' };
    expect(authorizedScoreModelTransition()).toBeNull();

    process.env.LEAD_SCORE_MODEL_TRANSITION = LEAD_SCORE_MODEL_VERSION;
    const authorized = resolveScoreWrite(stored, computed);
    expect(authorized.action).toBe('write');
    expect(authorized.reason).toBe('transition_authorized');

    // A transition naming something else does NOT authorize this one. A
    // boolean here would have stayed switched on and silently authorized the
    // NEXT model transition too - the same class of defect as the default
    // that overwrote.
    process.env.LEAD_SCORE_MODEL_TRANSITION = 'bi-99';
    expect(resolveScoreWrite(stored, computed).action).toBe('preserve');
    for (const v of ['true', '1', 'yes', '']) {
      process.env.LEAD_SCORE_MODEL_TRANSITION = v;
      expect(resolveScoreWrite(stored, computed).action).toBe('preserve');
    }
  });

  it('the model version is stamped, so a score written today is comparable tomorrow', () => {
    expect(LEAD_SCORE_MODEL_VERSION).toBe('bi-2');
    const lead = {
      organizationId: ORG,
      source: 'crm',
      identity: { email: 'a@b.test' },
      attribution: viewOf().attribution,
      occurredAt: AT,
      sourceRef: { table: 'canonical_leads', id: 'p1' },
      unifiedPersonId: null,
      ingestedAt: AT,
    } as unknown as CanonicalLead;
    expect(materializeCanonicalScores(lead).modelVersion).toBe(LEAD_SCORE_MODEL_VERSION);
  });
});
