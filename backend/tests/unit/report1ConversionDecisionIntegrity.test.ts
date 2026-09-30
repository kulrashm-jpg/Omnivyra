/**
 * REPORT-1-CONVERSION-DECISION-INTEGRITY-REMEDIATION-004
 *
 * DEFECT A — traffic was never conditioned by conversion readiness.
 * "Fix conversion before sending more demand" existed in this repository only as prose, and
 * only on the Report 2 path. Nothing in Report 1 read the conversion state to sequence its own
 * recommendations, so a report could rank "expand the thin pages that should carry search
 * demand" above "a visitor has no way to act" purely because the constants were 70 and 75.
 *
 * DEFECT B — `ruleConversionReadiness` required BOTH the value_communication and the
 * conversion_readiness pillar to produce a finding. A site with NO discoverable conversion path
 * at all — the most serious conversion defect the crawl can raise, at severity `critical` —
 * produced no opportunity if its pages happened to explain the offering clearly.
 *
 * WHAT IS ASSERTED
 * The real `assembleDigitalSnapshot` throughout. Assertions are on the decision fields the
 * report actually orders by — `priorityScore`, position, `horizon`, `dependsOn` — not on the
 * presence of recommendation text.
 */
import { assembleDigitalSnapshot } from '../../services/digitalSnapshotAssembly';

type Finding = {
  pillar: string; problem: string; evidence: string; action: string;
  severity: string; effort: string; measurement: string;
};

const finding = (pillar: string, problem: string, severity: string): Finding => ({
  pillar,
  problem,
  evidence: `${problem} (observed across the pages read)`,
  action: `Fix: ${problem}.`,
  severity,
  effort: 'low',
  measurement: 'Re-crawl and confirm.',
});

/** The most serious conversion defect the crawl can raise. */
const NO_CONVERSION_PATH = finding('conversion_readiness', 'no discoverable conversion path', 'critical');
const WEAK_CTA = finding('conversion_readiness', 'CTA coverage is thin', 'moderate');
const UNCLEAR_VALUE = finding('value_communication', 'the home page does not state the offering', 'moderate');

/** A legitimate demand-generation opportunity: thin commercial pages. */
const THIN_CONTENT = finding('information_accessibility', 'pages carry too little content', 'moderate');
const META_MISSING = finding('information_accessibility', 'pages are missing a title or meta description', 'moderate');

const run = (findings: Finding[]) =>
  assembleDigitalSnapshot({ experienceFindings: findings } as never);

const byId = (r: ReturnType<typeof run>, id: string) => r.opportunities.find((o) => o.id === id);
const indexOf = (r: ReturnType<typeof run>, id: string) => r.opportunities.findIndex((o) => o.id === id);

describe('REMEDIATION-004 — conversion decision integrity', () => {
  // ── DEFECT B ────────────────────────────────────────────────────────────
  describe('A. a single STRONG conversion finding', () => {
    it('establishes a conversion opportunity with no second finding required', () => {
      const conv = byId(run([NO_CONVERSION_PATH]), 'conversion_readiness');
      expect(conv).toBeDefined();
      expect(conv!.materiallyDeficient).toBe(true);
      expect(conv!.kind).toBe('conversion_remediation');
    });

    it('carries the evidence it actually observed, and only that', () => {
      const conv = byId(run([NO_CONVERSION_PATH]), 'conversion_readiness')!;
      expect(conv.evidence).toHaveLength(1);
      expect(conv.evidence[0].statement).toContain('no discoverable conversion path');
      expect(conv.evidence[0].state).toBe('measured');
      // No fabricated measurement: the public boundary is still stated.
      expect(conv.measurement).toMatch(/NOT measurable from public evidence/i);
    });

    it('states a stronger claim than a pair of moderate findings', () => {
      const strong = byId(run([NO_CONVERSION_PATH]), 'conversion_readiness')!;
      const pair = byId(run([UNCLEAR_VALUE, WEAK_CTA]), 'conversion_readiness')!;
      expect(strong.confidence).toBe('high');
      expect(pair.confidence).toBe('medium');
      expect(strong.priorityScore).toBeGreaterThan(pair.priorityScore);
    });
  });

  describe('B. a single WEAK finding', () => {
    it('does NOT become a definitive conversion conclusion', () => {
      expect(byId(run([WEAK_CTA]), 'conversion_readiness')).toBeUndefined();
      expect(byId(run([UNCLEAR_VALUE]), 'conversion_readiness')).toBeUndefined();
    });
  });

  describe('C. two findings — existing behaviour preserved', () => {
    it('still produces the opportunity across both pillars', () => {
      const conv = byId(run([UNCLEAR_VALUE, WEAK_CTA]), 'conversion_readiness');
      expect(conv).toBeDefined();
      expect(conv!.evidence).toHaveLength(2);
      expect(conv!.materiallyDeficient).toBe(true);
      expect(conv!.impact).toBe(75);
    });
  });

  describe('D. no conversion findings', () => {
    it('invents no conversion failure', () => {
      const r = run([THIN_CONTENT]);
      expect(byId(r, 'conversion_readiness')).toBeUndefined();
      expect(JSON.stringify(r)).not.toMatch(/conversion path/i);
    });
  });

  // ── DEFECT A — the critical regression ──────────────────────────────────
  describe('E. conversion materially deficient + demand opportunity', () => {
    const r = () => run([NO_CONVERSION_PATH, THIN_CONTENT, META_MISSING]);

    it('orders conversion remediation ahead of every demand-generation item', () => {
      const result = r();
      const conv = indexOf(result, 'conversion_readiness');
      expect(conv).toBeGreaterThanOrEqual(0);
      for (const id of ['content_search_foundation', 'metadata_clickthrough']) {
        const at = indexOf(result, id);
        if (at >= 0) expect(at).toBeGreaterThan(conv);
      }
    });

    it('no demand item outranks the conversion remediation by priorityScore', () => {
      const result = r();
      const conv = byId(result, 'conversion_readiness')!;
      for (const o of result.opportunities.filter((x) => x.kind === 'demand_generation')) {
        expect(o.priorityScore).toBeLessThan(conv.priorityScore);
      }
    });

    it('states the dependency rather than silently demoting', () => {
      const demoted = r().opportunities.filter((o) => o.dependsOn);
      expect(demoted.length).toBeGreaterThan(0);
      for (const o of demoted) {
        expect(o.kind).toBe('demand_generation');
        expect(o.dependsOn).toBe('conversion_readiness');
      }
    });

    it('does NOT suppress demand generation — both remain present with evidence intact', () => {
      const result = r();
      const demand = result.opportunities.filter((o) => o.kind === 'demand_generation');
      expect(demand.length).toBeGreaterThan(0);
      for (const o of demand) {
        expect(o.evidence.length).toBeGreaterThan(0);
        expect(o.action.length).toBeGreaterThan(0);
      }
    });
  });

  describe('F. conversion adequate + demand opportunity', () => {
    it('leaves demand generation unsequenced and unmarked', () => {
      const result = run([THIN_CONTENT, META_MISSING]);
      expect(byId(result, 'conversion_readiness')).toBeUndefined();
      const demand = result.opportunities.filter((o) => o.kind === 'demand_generation');
      expect(demand.length).toBeGreaterThan(0);
      for (const o of demand) expect(o.dependsOn).toBeUndefined();
    });
  });

  describe('G. conversion unavailable + demand opportunity', () => {
    it('assumes no conversion state in either direction', () => {
      // Nothing observed the conversion path. That is not evidence it is fine, and not
      // evidence it is broken — so nothing is re-sequenced and nothing is claimed.
      const result = run([THIN_CONTENT]);
      expect(byId(result, 'conversion_readiness')).toBeUndefined();
      const demand = result.opportunities.filter((o) => o.kind === 'demand_generation');
      for (const o of demand) expect(o.dependsOn).toBeUndefined();
      expect(JSON.stringify(result)).not.toMatch(/conversion (is|path is) (fine|adequate|healthy|broken)/i);
    });
  });

  // ── H. ordering/priority regression, asserted on decision fields ─────────
  describe('H. ordering is a decision, not narrative', () => {
    it('the top priority is the conversion remediation when it is materially deficient', () => {
      const result = run([NO_CONVERSION_PATH, THIN_CONTENT, META_MISSING]);
      expect(result.topPriorities[0]?.id).toBe('conversion_readiness');
    });

    it('the sequencing is stable and deterministic across runs', () => {
      const a = run([NO_CONVERSION_PATH, THIN_CONTENT, META_MISSING]).opportunities.map((o) => o.id);
      const b = run([NO_CONVERSION_PATH, THIN_CONTENT, META_MISSING]).opportunities.map((o) => o.id);
      expect(a).toEqual(b);
    });

    it('re-sequencing never produces a negative score or reorders non-demand work', () => {
      const result = run([NO_CONVERSION_PATH, THIN_CONTENT, META_MISSING]);
      for (const o of result.opportunities) expect(o.priorityScore).toBeGreaterThanOrEqual(0);
      const foundation = result.opportunities.find((o) => o.id === 'reachability_foundation');
      if (foundation) expect(foundation.dependsOn).toBeUndefined();
    });
  });

  // ── I. the plan the customer reads reflects the same ordering ───────────
  describe('I. composed plan output', () => {
    it('places the conversion remediation in the plan the customer reads', () => {
      const result = run([NO_CONVERSION_PATH, THIN_CONTENT, META_MISSING]);
      const all = [...result.plan.days_0_30, ...result.plan.days_31_60, ...result.plan.days_61_90];
      expect(all.some((i) => /being able to act/i.test(i.title))).toBe(true);
    });

    it('the 0-30 horizon leads with conversion remediation, not demand generation', () => {
      const result = run([NO_CONVERSION_PATH, THIN_CONTENT, META_MISSING]);
      expect(result.plan.days_0_30.length).toBeGreaterThan(0);
      expect(result.plan.days_0_30[0].title).toMatch(/being able to act/i);
    });
  });
});
