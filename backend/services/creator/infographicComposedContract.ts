/**
 * CREATOR-INFO-COMPOSE stage 2 — the MULTI-SECTION semantic contract.
 *
 * Stage 1's planner produces a heterogeneous CompositionSection[] (hero + kpi_row + chart +
 * quote + icon_points + callout …). This module is the planner↔LLM contract for that plan:
 *   • composedPromptSchema   — the exact JSON the LLM must return for a given plan
 *   • validateComposedResponse — strict validation → a flat, per-card ContractSectionOut[]
 *                                (the SAME card model the renderer already paints), each card
 *                                tagged with its `element` so stage 3 can group cards into bands
 *   • staticComposedContent  — deterministic, no-LLM fallback that always passes validation
 *
 * Pure + offline-testable. Additive: it does NOT touch the legacy single-role contract
 * (infographicSemanticContract.ts), which remains the path when composed layouts are off.
 *
 * Every element uses one uniform payload shape `{ element, items: [...] }` (singletons carry
 * exactly one item) so validation is strict and small. Data-bearing elements (chart/kpi) are
 * only ever PLANNED when real data exists (stage 1 gating), so the contract never fabricates.
 */
import type { CompositionSection, CompositionElement } from './infographicCompositionPlanner';
import type { ContractSectionOut, ContractResult } from './infographicSemanticContract';

/** ContractSectionOut + the optional fields the new elements need (additive intersection —
 *  no change to the existing type). */
export type ComposedSectionOut = ContractSectionOut & {
  element: CompositionElement;
  points?: { label: string; value: string; description?: string }[]; // kpi_row, chart, icon_points
  chartType?: 'pie' | 'bar' | 'line';
  attribution?: string; // quote
};

export interface ComposedResult extends Omit<ContractResult, 'sections'> {
  sections: ComposedSectionOut[];
}
export interface ComposedValidation { ok: boolean; errors: string[]; result?: ComposedResult }

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isStr);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const onlyKeys = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).filter((k) => !allowed.includes(k));

interface ElementSpec {
  singleton: boolean;              // singletons carry exactly one item regardless of plan count
  itemShape: string;               // for the prompt schema
  check: (it: Record<string, unknown>, i: number) => string[];
  map: (it: Record<string, unknown>) => ComposedSectionOut;
}

const ELEMENT_SPEC: Record<Exclude<CompositionElement, 'hero'>, ElementSpec> = {
  kpi_row: {
    singleton: false,
    itemShape: `{ "label": string, "value": string, "description": string }`,
    check: (it, i) => [!isStr(it.label) && `label`, !isStr(it.value) && `value`, !isStr(it.description) && `description`].filter(Boolean).map((x) => `kpi[${i}].${x} missing`),
    map: (it) => ({ element: 'kpi_row', semanticRole: 'kpi_row', title: s(it.label), body: s(it.description), lead: s(it.description), stat: { value: s(it.value), label: s(it.label) }, bullets: [] }),
  },
  chart: {
    singleton: true,
    itemShape: `{ "title": string, "chartType": "pie"|"bar"|"line", "points": [ { "label": string, "value": number } ] (>=2) }`,
    check: (it) => {
      const errs: string[] = [];
      if (!isStr(it.title)) errs.push('chart.title missing');
      if (!['pie', 'bar', 'line'].includes(String(it.chartType))) errs.push('chart.chartType invalid');
      const pts = it.points;
      if (!Array.isArray(pts) || pts.length < 2) errs.push('chart.points must have >=2 points');
      else pts.forEach((p, i) => { const po = (p ?? {}) as Record<string, unknown>; if (!isStr(po.label)) errs.push(`chart.points[${i}].label missing`); if (num(po.value) == null) errs.push(`chart.points[${i}].value must be number`); });
      return errs;
    },
    map: (it) => ({ element: 'chart', semanticRole: 'chart', title: s(it.title), body: '', chartType: it.chartType as 'pie' | 'bar' | 'line', points: (it.points as Record<string, unknown>[]).map((p) => ({ label: s(p.label), value: String(num(p.value) ?? 0) })), bullets: [] }),
  },
  quote: {
    singleton: true,
    itemShape: `{ "quote": string, "attribution": string }`,
    check: (it) => [!isStr(it.quote) && 'quote.quote missing', !isStr(it.attribution) && 'quote.attribution missing'].filter(Boolean) as string[],
    map: (it) => ({ element: 'quote', semanticRole: 'quote', title: '', body: s(it.quote), attribution: s(it.attribution), bullets: [] }),
  },
  icon_points: {
    singleton: false,
    itemShape: `{ "label": string, "body": string }`,
    check: (it, i) => [!isStr(it.label) && `label`, !isStr(it.body) && `body`].filter(Boolean).map((x) => `icon_point[${i}].${x} missing`),
    map: (it) => ({ element: 'icon_points', semanticRole: 'icon_point', title: s(it.label), body: s(it.body), lead: s(it.body), bullets: [] }),
  },
  callout: {
    singleton: true,
    itemShape: `{ "text": string }`,
    check: (it) => (!isStr(it.text) ? ['callout.text missing'] : []),
    map: (it) => ({ element: 'callout', semanticRole: 'callout', title: '', body: s(it.text), bullets: [] }),
  },
  image_band: {
    singleton: true,
    itemShape: `{ "caption": string }`,
    check: (it) => (!isStr(it.caption) ? ['image_band.caption missing'] : []),
    map: (it) => ({ element: 'image_band', semanticRole: 'image_band', title: '', body: s(it.caption), bullets: [] }),
  },
  process_steps: {
    singleton: false,
    itemShape: `{ "title": string, "body": string, "outcome": string }`,
    check: (it, i) => [!isStr(it.title) && `title`, !isStr(it.body) && `body`, !isStr(it.outcome) && `outcome`].filter(Boolean).map((x) => `step[${i}].${x} missing`),
    map: (it) => ({ element: 'process_steps', semanticRole: 'process_step', title: s(it.title), body: s(it.body), lead: s(it.body), take: s(it.outcome), bullets: [] }),
  },
  comparison: {
    singleton: false,
    itemShape: `{ "title": string, "advantages": string[], "limitations": string[] }`,
    check: (it, i) => [!isStr(it.title) && `comparison[${i}].title missing`, !isStrArr(it.advantages) && `comparison[${i}].advantages must be string[]`, !isStrArr(it.limitations) && `comparison[${i}].limitations must be string[]`].filter(Boolean) as string[],
    map: (it) => ({ element: 'comparison', semanticRole: 'comparison_side', title: s(it.title), body: (it.advantages as string[])[0] ?? '', bullets: (it.advantages as string[]) ?? [], risk: ((it.limitations as string[]) ?? []).join(' · ') }),
  },
  framework: {
    singleton: false,
    itemShape: `{ "pillarName": string, "pillarExplanation": string }`,
    check: (it, i) => [!isStr(it.pillarName) && `pillarName`, !isStr(it.pillarExplanation) && `pillarExplanation`].filter(Boolean).map((x) => `pillar[${i}].${x} missing`),
    map: (it) => ({ element: 'framework', semanticRole: 'framework_pillar', title: s(it.pillarName), body: s(it.pillarExplanation), lead: s(it.pillarExplanation), bullets: [] }),
  },
  hierarchy: {
    singleton: false,
    itemShape: `{ "title": string, "body": string }`,
    check: (it, i) => [!isStr(it.title) && `title`, !isStr(it.body) && `body`].filter(Boolean).map((x) => `level[${i}].${x} missing`),
    map: (it) => ({ element: 'hierarchy', semanticRole: 'hierarchy_level', title: s(it.title), body: s(it.body), lead: s(it.body), bullets: [] }),
  },
  timeline: {
    singleton: false,
    itemShape: `{ "title": string, "date": string, "body": string }`,
    check: (it, i) => [!isStr(it.title) && `title`, !isStr(it.date) && `date`, !isStr(it.body) && `body`].filter(Boolean).map((x) => `event[${i}].${x} missing`),
    map: (it) => ({ element: 'timeline', semanticRole: 'timeline_event', title: s(it.title), body: s(it.body), lead: s(it.body), take: s(it.date), bullets: [] }),
  },
};

const bands = (plan: CompositionSection[]) => plan.filter((p) => p.element !== 'hero');
const slotCount = (sec: CompositionSection) => (ELEMENT_SPEC[sec.element as Exclude<CompositionElement, 'hero'>]?.singleton ? 1 : sec.count);

/** The exact JSON the LLM must return for a composition plan. */
export function composedPromptSchema(plan: CompositionSection[]): string {
  const sectionSchemas = bands(plan).map((sec) => {
    const spec = ELEMENT_SPEC[sec.element as Exclude<CompositionElement, 'hero'>];
    return `{ "element": "${sec.element}", "items": [ ${spec.itemShape} ] (EXACTLY ${slotCount(sec)}) }`;
  });
  return `{ "headline": string, "cta": string, "summary": string, "sections": [ ${sectionSchemas.join(', ')} ] (EXACTLY ${sectionSchemas.length}, in this order) }`;
}

/** STRICT validation → flat, per-card ComposedSectionOut[] tagged with element. Never repairs. */
export function validateComposedResponse(plan: CompositionSection[], parsed: unknown): ComposedValidation {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, errors: ['response is not a JSON object'] };
  const o = parsed as Record<string, unknown>;
  if (!isStr(o.headline)) errors.push('missing headline');
  if (!isStr(o.cta)) errors.push('missing cta');
  const extraTop = onlyKeys(o, ['headline', 'cta', 'summary', 'sections']);
  if (extraTop.length) errors.push(`unexpected top-level fields: ${extraTop.join(',')}`);

  const wanted = bands(plan);
  const arr = o.sections;
  const out: ComposedSectionOut[] = [];
  if (!Array.isArray(arr)) {
    errors.push('missing sections array');
  } else {
    if (arr.length !== wanted.length) errors.push(`sections must contain exactly ${wanted.length} entries (got ${arr.length})`);
    wanted.forEach((sec, idx) => {
      const raw = arr[idx];
      if (!raw || typeof raw !== 'object') { errors.push(`sections[${idx}] not an object`); return; }
      const so = raw as Record<string, unknown>;
      if (so.element !== sec.element) { errors.push(`sections[${idx}].element must be '${sec.element}' (got '${String(so.element)}')`); return; }
      const spec = ELEMENT_SPEC[sec.element as Exclude<CompositionElement, 'hero'>];
      const items = so.items;
      const need = slotCount(sec);
      if (!Array.isArray(items)) { errors.push(`sections[${idx}].items must be an array`); return; }
      if (items.length !== need) errors.push(`sections[${idx}].items must have exactly ${need} (got ${items.length})`);
      items.forEach((it, i) => {
        if (!it || typeof it !== 'object') { errors.push(`sections[${idx}].items[${i}] not an object`); return; }
        errors.push(...spec.check(it as Record<string, unknown>, i));
      });
      if (errors.length === 0) items.forEach((it) => out.push(spec.map(it as Record<string, unknown>)));
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], result: { headline: s(o.headline), cta: s(o.cta), summary: s(o.summary), sections: out } };
}

/** Deterministic, no-LLM fallback for a plan (preview + graceful degrade). Always validates. */
export function staticComposedContent(plan: CompositionSection[], topic: string, sectionTitles: string[] = []): ComposedResult {
  const title = (i: number) => s(sectionTitles[i]) || `${topic} — point ${i + 1}`;
  const out: ComposedSectionOut[] = [];
  let ti = 0;
  for (const sec of bands(plan)) {
    const spec = ELEMENT_SPEC[sec.element as Exclude<CompositionElement, 'hero'>];
    const n = slotCount(sec);
    for (let i = 0; i < n; i++) {
      const t = title(ti++);
      switch (sec.element) {
        case 'kpi_row': out.push(spec.map({ label: t, value: `${[2, 3, 4, 5, 6][i % 5]}x`, description: `Why ${t.toLowerCase()} matters for ${topic}.` })); break;
        case 'chart': out.push(spec.map({ title: `${topic} breakdown`, chartType: sec.chartHint ?? 'pie', points: [{ label: 'A', value: 45 }, { label: 'B', value: 30 }, { label: 'C', value: 25 }] })); break;
        case 'quote': out.push(spec.map({ quote: `${topic} is what sets the leaders apart.`, attribution: 'Industry perspective' })); break;
        case 'icon_points': out.push(spec.map({ label: t, body: `${t} strengthens ${topic}.` })); break;
        case 'callout': out.push(spec.map({ text: `Key takeaway: ${topic} done right compounds.` })); break;
        case 'image_band': out.push(spec.map({ caption: `${topic} in context.` })); break;
        case 'process_steps': out.push(spec.map({ title: t, body: `Carry out ${t.toLowerCase()} for ${topic}.`, outcome: `${t} completed.` })); break;
        case 'comparison': out.push(spec.map({ title: t, advantages: [`Advantage of ${t.toLowerCase()}`, `Strength in ${topic}`], limitations: [`Watch-out for ${t.toLowerCase()}`] })); break;
        case 'framework': out.push(spec.map({ pillarName: t, pillarExplanation: `${t} is a core pillar of ${topic}.` })); break;
        case 'hierarchy': out.push(spec.map({ title: t, body: `${t} sits at this level of ${topic}.` })); break;
        case 'timeline': out.push(spec.map({ title: t, date: `Phase ${i + 1}`, body: `${t} happens here in ${topic}.` })); break;
      }
    }
  }
  return { headline: topic, cta: 'Learn more', summary: `A clear view of ${topic}.`, sections: out };
}
