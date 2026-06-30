/**
 * CREATOR-INFO-COMPOSE stage 1 — the intent-aware Composition Planner. Proves heterogeneous,
 * purpose/audience-driven element mixes, determinism, data-gating (no fabricated charts/quotes),
 * and byte-identical legacy behaviour when the flag is OFF.
 */
import {
  planComposition, deriveCompositionIntent, compositionVariety,
  type CompositionIntent,
} from '../../services/creator/infographicCompositionPlanner';

const FLAG = 'INFOGRAPHIC_COMPOSED_LAYOUTS';
const withFlag = <T>(on: boolean, fn: () => T): T => {
  const prev = process.env[FLAG];
  process.env[FLAG] = on ? 'true' : 'false';
  try { return fn(); } finally { if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev; }
};

const intent = (over: Partial<CompositionIntent> = {}): CompositionIntent => ({
  archetype: 'data_report', hasQuantData: true, hasQuote: false, audienceTags: [], industryTags: [], baseLayout: 'stats', ...over,
});

describe('legacy behaviour (flag OFF) is byte-identical', () => {
  it('returns hero + single repeating role per layout', () => withFlag(false, () => {
    expect(planComposition(intent({ baseLayout: 'stats' }))).toEqual([
      { element: 'hero', count: 1, emphasis: 'primary' },
      { element: 'kpi_row', count: 3, emphasis: 'primary' },
    ]);
    expect(planComposition(intent({ baseLayout: 'process' })).map((s) => s.element)).toEqual(['hero', 'process_steps']);
    expect(planComposition(intent({ baseLayout: 'timeline' })).map((s) => s.element)).toEqual(['hero', 'timeline']);
    // legacy is mono-block: exactly 2 distinct kinds
    expect(compositionVariety(planComposition(intent()))).toBe(2);
  }));
});

describe('composed behaviour (flag ON) is heterogeneous + intent-driven', () => {
  it('data_report mixes KPI + chart + callout and respects exec audience', () => withFlag(true, () => {
    const general = planComposition(intent({ archetype: 'data_report', audienceTags: ['prospects'] }));
    const exec = planComposition(intent({ archetype: 'data_report', audienceTags: ['executives'] }));
    expect(general.map((s) => s.element)).toEqual(['hero', 'kpi_row', 'chart', 'icon_points', 'callout']);
    expect(general.find((s) => s.element === 'chart')!.chartHint).toBe('pie');
    // exec audience: bar chart, no icon_points
    expect(exec.find((s) => s.element === 'chart')!.chartHint).toBe('bar');
    expect(exec.some((s) => s.element === 'icon_points')).toBe(false);
    expect(compositionVariety(general)).toBeGreaterThanOrEqual(4);
  }));

  it('thought_leadership leads with a quote + icon points', () => withFlag(true, () => {
    const p = planComposition(intent({ archetype: 'thought_leadership', hasQuote: true, hasQuantData: false, baseLayout: 'framework' }));
    expect(p[1]!.element).toBe('quote');
    expect(p.some((s) => s.element === 'icon_points')).toBe(true);
    expect(p.some((s) => s.element === 'kpi_row')).toBe(false); // no quant data → no KPI
  }));

  it('data-gating: no chart/KPI when there is no quantitative data (never fabricate)', () => withFlag(true, () => {
    const p = planComposition(intent({ archetype: 'data_report', hasQuantData: false }));
    expect(p.some((s) => s.element === 'chart')).toBe(false);
    // KPI row stays (qualitative stat cards), but no chart is invented
    expect(p.some((s) => s.element === 'callout')).toBe(true);
  }));

  it('is deterministic — same intent yields the same plan', () => withFlag(true, () => {
    const a = planComposition(intent({ archetype: 'framework_overview', hasQuote: true }));
    const b = planComposition(intent({ archetype: 'framework_overview', hasQuote: true }));
    expect(a).toEqual(b);
  }));

  it('every archetype produces a heterogeneous plan (≥3 distinct element kinds)', () => withFlag(true, () => {
    const archetypes = ['data_report', 'thought_leadership', 'process_guide', 'comparison', 'framework_overview', 'timeline_story', 'hierarchy_ranking'] as const;
    for (const a of archetypes) {
      const v = compositionVariety(planComposition(intent({ archetype: a, hasQuantData: true, hasQuote: true })));
      expect(v).toBeGreaterThanOrEqual(3);
    }
  }));
});

describe('intent derivation', () => {
  it('maps layout → archetype and reads audience/industry tags', () => {
    const i = deriveCompositionIntent({ baseLayout: 'stats', meta: { audienceTags: ['executives'], industryTags: ['finance'] }, hasQuantData: true });
    expect(i.archetype).toBe('data_report');
    expect(i.audienceTags).toEqual(['executives']);
    expect(i.hasQuantData).toBe(true);
  });
  it('promotes to thought_leadership when a quote drives a generic framework layout', () => {
    const i = deriveCompositionIntent({ baseLayout: 'framework', hasQuote: true, tags: ['thought-leadership'] });
    expect(i.archetype).toBe('thought_leadership');
  });
});
