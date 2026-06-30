/**
 * CREATOR-INFO-COMPOSE stage 2 — the multi-section contract. Proves the schema/validation/
 * fallback handle a heterogeneous plan: accept a well-formed composed payload, reject wrong
 * element/order/count/missing fields, and that the deterministic static fallback always
 * validates. Pure + offline (no LLM).
 */
import { planComposition, type CompositionIntent } from '../../services/creator/infographicCompositionPlanner';
import { composedPromptSchema, validateComposedResponse, staticComposedContent } from '../../services/creator/infographicComposedContract';

const FLAG = 'INFOGRAPHIC_COMPOSED_LAYOUTS';
const on = <T>(fn: () => T): T => { const p = process.env[FLAG]; process.env[FLAG] = 'true'; try { return fn(); } finally { if (p === undefined) delete process.env[FLAG]; else process.env[FLAG] = p; } };
const intent = (o: Partial<CompositionIntent> = {}): CompositionIntent => ({ archetype: 'data_report', hasQuantData: true, hasQuote: false, audienceTags: ['prospects'], industryTags: [], baseLayout: 'stats', ...o });

// data_report (general) → hero + kpi_row(3) + chart + icon_points(3) + callout
const dataReportPlan = () => on(() => planComposition(intent()));

const wellFormed = () => ({
  headline: 'Growth in 2026', cta: 'Learn more', summary: 'A clear view.',
  sections: [
    { element: 'kpi_row', items: [{ label: 'Revenue', value: '3x', description: 'Tripled YoY.' }, { label: 'Users', value: '120k', description: 'Active monthly.' }, { label: 'NPS', value: '62', description: 'Up from 48.' }] },
    { element: 'chart', items: [{ title: 'Revenue mix', chartType: 'pie', points: [{ label: 'NA', value: 45 }, { label: 'EU', value: 35 }, { label: 'APAC', value: 20 }] }] },
    { element: 'icon_points', items: [{ label: 'Fast', body: 'Ships weekly.' }, { label: 'Safe', body: 'SOC2.' }, { label: 'Loved', body: 'High NPS.' }] },
    { element: 'callout', items: [{ text: 'Momentum compounds.' }] },
  ],
});

describe('stage 2 — composed prompt schema', () => {
  it('describes every planned band in order with exact counts', () => {
    const schema = composedPromptSchema(dataReportPlan());
    expect(schema).toContain('"element": "kpi_row"');
    expect(schema).toContain('"element": "chart"');
    expect(schema).toContain('"element": "callout"');
    expect(schema).toContain('EXACTLY 3'); // kpi_row + icon_points
  });
});

describe('stage 2 — strict validation', () => {
  it('accepts a well-formed heterogeneous payload and flattens to tagged cards', () => {
    const v = validateComposedResponse(dataReportPlan(), wellFormed());
    expect(v.ok).toBe(true);
    const els = v.result!.sections.map((s) => s.element);
    // 3 kpi cards + 1 chart + 3 icon points + 1 callout = 8 cards
    expect(els).toEqual(['kpi_row', 'kpi_row', 'kpi_row', 'chart', 'icon_points', 'icon_points', 'icon_points', 'callout']);
    const chart = v.result!.sections.find((s) => s.element === 'chart')!;
    expect(chart.chartType).toBe('pie');
    expect(chart.points!.length).toBe(3);
  });
  it('rejects wrong element order', () => {
    const bad = wellFormed(); const tmp = bad.sections[0]; bad.sections[0] = bad.sections[1]; bad.sections[1] = tmp;
    const v = validateComposedResponse(dataReportPlan(), bad);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/element must be 'kpi_row'/);
  });
  it('rejects wrong item count', () => {
    const bad = wellFormed(); bad.sections[0].items = bad.sections[0].items.slice(0, 2); // 2 KPIs, need 3
    const v = validateComposedResponse(dataReportPlan(), bad);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/exactly 3/);
  });
  it('rejects a chart with a non-numeric value (no fabricated data slips through)', () => {
    const bad = wellFormed(); (bad.sections[1].items[0] as any).points[0].value = 'lots';
    const v = validateComposedResponse(dataReportPlan(), bad);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/must be number/);
  });
});

describe('stage 2 — static fallback', () => {
  it('produces content that always passes its own validator (every archetype)', () => on(() => {
    const archetypes = ['data_report', 'thought_leadership', 'process_guide', 'comparison', 'framework_overview', 'timeline_story', 'hierarchy_ranking'] as const;
    for (const a of archetypes) {
      const plan = planComposition(intent({ archetype: a, hasQuantData: true, hasQuote: true, baseLayout: a === 'process_guide' ? 'process' : a === 'comparison' ? 'comparison' : 'framework' }));
      const fallback = staticComposedContent(plan, 'Topic');
      const v = validateComposedResponse(plan, { headline: fallback.headline, cta: fallback.cta, summary: fallback.summary, sections: rebuildPayload(plan, fallback) });
      expect(v.ok).toBe(true);
    }
  }));
  it('is deterministic', () => on(() => {
    const plan = planComposition(intent());
    expect(staticComposedContent(plan, 'X')).toEqual(staticComposedContent(plan, 'X'));
  }));
});

// helper: re-serialize the flat fallback cards back into the {element,items[]} payload shape
function rebuildPayload(plan: ReturnType<typeof planComposition>, fallback: ReturnType<typeof staticComposedContent>) {
  const cards = fallback.sections.slice();
  const out: any[] = [];
  for (const sec of plan.filter((p) => p.element !== 'hero')) {
    const singleton = ['chart', 'quote', 'callout', 'image_band'].includes(sec.element);
    const n = singleton ? 1 : sec.count;
    const group = cards.splice(0, n);
    out.push({ element: sec.element, items: group.map((c) => serializeCard(sec.element, c)) });
  }
  return out;
}
function serializeCard(element: string, c: any) {
  switch (element) {
    case 'kpi_row': return { label: c.stat.label, value: c.stat.value, description: c.body };
    case 'chart': return { title: c.title, chartType: c.chartType, points: c.points.map((p: any) => ({ label: p.label, value: Number(p.value) })) };
    case 'quote': return { quote: c.body, attribution: c.attribution };
    case 'icon_points': return { label: c.title, body: c.body };
    case 'callout': return { text: c.body };
    case 'image_band': return { caption: c.body };
    case 'process_steps': return { title: c.title, body: c.body, outcome: c.take };
    case 'comparison': return { title: c.title, advantages: c.bullets, limitations: (c.risk || '').split(' · ') };
    case 'framework': return { pillarName: c.title, pillarExplanation: c.body };
    case 'hierarchy': return { title: c.title, body: c.body };
    case 'timeline': return { title: c.title, date: c.take, body: c.body };
    default: return {};
  }
}
