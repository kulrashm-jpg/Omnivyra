/**
 * REPORT-1-ADVERTISING-DECISION-007 — advertising evidence participates in the decision model.
 *
 * THE GAP
 * Slice 006 wired the ads read seam, so the Public Advertising section finally reached the
 * customer. But the evidence arrived as a SECTION only: it produced no opportunity, no
 * recommendation and no plan item. Visible and inert — the "list of observations" failure this
 * report criticises elsewhere in its own §14 decision chain.
 *
 * WHAT THIS SUITE ASSERTS
 * That `ruleAdvertisingPosture` refuses more often than it speaks, that the two cases where it
 * does speak are backed by observation on both sides, and that it never converts an absence of
 * looking into a finding — nor claims any performance figure the Ads Transparency record cannot
 * establish.
 *
 * The rule runs through the REAL `assembleDigitalSnapshot`, so the slice-004 sequencing applies
 * to its output like any other demand-generation work.
 */
import { assembleDigitalSnapshot } from '../../services/digitalSnapshotAssembly';

type Finding = {
  pillar: string; problem: string; evidence: string; whyItMatters: string;
  action: string; severity: string; effort: string; measurement: string;
};

const finding = (pillar: string, problem: string, severity: string): Finding => ({
  pillar, problem,
  evidence: `${problem} (observed across the pages read)`,
  whyItMatters: 'x',
  action: `Fix: ${problem}.`,
  severity, effort: 'low',
  measurement: 'Re-crawl and confirm.',
});

const NO_CONVERSION_PATH = finding('conversion_readiness', 'no discoverable conversion path', 'critical');
const WEAK_CTA = finding('conversion_readiness', 'CTA coverage is thin', 'moderate');

type Ads = {
  accessState: string;
  subjectLegalNameUsed: string | null;
  matchedAdvertiserCount: number;
  observedAt: string | null;
};

const ads = (over: Partial<Ads> = {}): Ads => ({
  accessState: 'observed',
  subjectLegalNameUsed: 'ACME ANALYTICS LTD',
  matchedAdvertiserCount: 1,
  observedAt: '2026-09-27T08:09:59.384Z',
  ...over,
});

const run = (advertising: Ads | null, findings: Finding[] = []) =>
  assembleDigitalSnapshot({ experienceFindings: findings, advertising } as never);

const byId = (r: ReturnType<typeof run>, id: string) => r.opportunities.find((o) => o.id === id);
const anyAdOpportunity = (r: ReturnType<typeof run>) =>
  r.opportunities.filter((o) => o.sources.includes('advertising' as never));

describe('REMEDIATION-007 — advertising in the decision model', () => {
  // ── The refusals. Most of the rule is refusal. ──────────────────────────
  describe('preconditions — it abstains rather than guesses', () => {
    it('no observation at all produces no advertising opportunity', () => {
      expect(anyAdOpportunity(run(null, [NO_CONVERSION_PATH]))).toHaveLength(0);
    });

    it.each(['blocked', 'restricted', 'requires_auth', 'unreachable', 'unavailable'])(
      'access state %s is not treated as absence of advertising',
      (accessState) => {
        const r = run(ads({ accessState, matchedAdvertiserCount: 0 }), [NO_CONVERSION_PATH]);
        expect(anyAdOpportunity(r)).toHaveLength(0);
        expect(JSON.stringify(r)).not.toMatch(/does not advertise|no paid activity exists/i);
      },
    );

    it('without a subject legal name, neither presence nor absence is establishable', () => {
      // MATCHED was structurally unreachable, so a zero count proves nothing.
      const r = run(ads({ subjectLegalNameUsed: null, matchedAdvertiserCount: 0 }), [NO_CONVERSION_PATH]);
      expect(anyAdOpportunity(r)).toHaveLength(0);
    });

    it('advertising observed with a healthy conversion path yields no opportunity', () => {
      // An observation with no decision attached is not an opportunity — it is already
      // rendered in the Public Advertising section.
      expect(anyAdOpportunity(run(ads(), []))).toHaveLength(0);
    });

    it('a merely moderate conversion defect is not enough to question the spend', () => {
      expect(byId(run(ads(), [WEAK_CTA]), 'advertising_conversion_posture')).toBeUndefined();
    });
  });

  // ── Branch (a): attributable ads + critical conversion defect ───────────
  describe('advertising attributable AND conversion path critically defective', () => {
    const r = () => run(ads({ matchedAdvertiserCount: 2 }), [NO_CONVERSION_PATH]);

    it('produces a cross-source posture opportunity', () => {
      const o = byId(r(), 'advertising_conversion_posture');
      expect(o).toBeDefined();
      expect(o!.crossSource).toBe(true);
      expect(o!.sources).toEqual(expect.arrayContaining(['advertising', 'digital_experience']));
    });

    it('rests on observation from BOTH sides', () => {
      const o = byId(r(), 'advertising_conversion_posture')!;
      expect(o.evidence).toHaveLength(2);
      for (const e of o.evidence) expect(e.state).toBe('measured');
      expect(o.evidence[0].statement).toMatch(/2 verified advertiser account/);
      expect(o.evidence[1].statement).toMatch(/no discoverable conversion path/);
    });

    it('is distinct from the conversion remediation, not a duplicate of it', () => {
      const result = r();
      const conv = byId(result, 'conversion_readiness');
      const posture = byId(result, 'advertising_conversion_posture')!;
      expect(conv).toBeDefined();
      // Different action: one fixes the pages, the other checks the spend already being made.
      expect(posture.action).not.toBe(conv!.action);
      expect(posture.action).toMatch(/before increasing budget/i);
    });

    it('is sequenced behind the conversion remediation by the existing mechanism', () => {
      const result = r();
      const posture = byId(result, 'advertising_conversion_posture')!;
      const conv = byId(result, 'conversion_readiness')!;
      expect(posture.kind).toBe('demand_generation');
      expect(posture.dependsOn).toBe('conversion_readiness');
      expect(posture.priorityScore).toBeLessThan(conv.priorityScore);
    });

    it('carries the observation date so the reader can weigh its age', () => {
      expect(byId(r(), 'advertising_conversion_posture')!.evidence[0].statement).toContain('2026-09-27');
    });
  });

  // ── Branch (b): absence that WAS establishable ──────────────────────────
  describe('no attributable advertising, and absence was establishable', () => {
    const r = () => run(ads({ matchedAdvertiserCount: 0 }), []);

    it('produces a conditional consideration, not a recommendation to spend', () => {
      const o = byId(r(), 'paid_acquisition_consideration');
      expect(o).toBeDefined();
      expect(o!.action).toMatch(/a question to answer, not a change to make/i);
      expect(o!.action).not.toMatch(/should start advertising|begin paid|launch campaigns/i);
    });

    it('states the boundary of the observation — one provider, one record', () => {
      const o = byId(r(), 'paid_acquisition_consideration')!;
      expect(o.evidence[0].statement).toMatch(/public Ads Transparency record/);
      expect(o.businessImplication).toMatch(/covers this provider only/i);
      // The record cannot distinguish a deliberate choice from an unexplored one, and says so.
      expect(o.businessImplication).toMatch(/cannot distinguish/i);
    });

    it('is held at low confidence and a long horizon, and admits it cannot be measured', () => {
      const o = byId(r(), 'paid_acquisition_consideration')!;
      expect(o.confidence).toBe('low');
      // The assembly derives horizon from impact x effort; impact 35 + medium effort => 31-60.
      // What matters is that it is NOT day one.
      expect(o.horizon).toBe('31-60');
      expect(o.measurementAvailable).toBe(false);
      expect(o.measurement).toMatch(/depends on economics this report cannot observe/i);
    });

    it('never asserts the company does not advertise', () => {
      expect(JSON.stringify(r())).not.toMatch(/does not advertise|runs no ads|is not advertising/i);
    });
  });

  // ── No performance claims, on either branch ────────────────────────────
  describe('no performance figures are introduced', () => {
    it.each([
      ['posture', ads({ matchedAdvertiserCount: 2 }), [NO_CONVERSION_PATH]],
      ['consideration', ads({ matchedAdvertiserCount: 0 }), []],
    ])('%s branch claims no spend, CTR, ROAS, CAC, impressions or revenue', (_label, a, f) => {
      const blob = JSON.stringify(run(a as Ads, f as Finding[]));
      expect(blob).not.toMatch(/\bCTR\b|\bROAS\b|\bCAC\b|impressions|click-through|ad spend|cost per|revenue/i);
    });

    it('the posture branch names the limit explicitly', () => {
      const o = byId(run(ads({ matchedAdvertiserCount: 1 }), [NO_CONVERSION_PATH]), 'advertising_conversion_posture')!;
      expect(o.measurement).toMatch(/NOT measurable from public evidence/i);
    });
  });

  // ── It reaches the plan the customer reads ─────────────────────────────
  describe('composition', () => {
    it('the posture opportunity reaches the 30/60/90 plan', () => {
      const r = run(ads({ matchedAdvertiserCount: 1 }), [NO_CONVERSION_PATH]);
      const all = [...r.plan.days_0_30, ...r.plan.days_31_60, ...r.plan.days_61_90];
      expect(all.some((i) => /paid landing experience/i.test(i.title))).toBe(true);
    });

    it('the consideration never lands on day one', () => {
      const r = run(ads({ matchedAdvertiserCount: 0 }), []);
      expect(r.plan.days_31_60.some((i) => /paid acquisition/i.test(i.title))).toBe(true);
      expect(r.plan.days_0_30.some((i) => /paid acquisition/i.test(i.title))).toBe(false);
    });
  });
});
