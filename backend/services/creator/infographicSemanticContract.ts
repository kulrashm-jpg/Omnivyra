/**
 * CREATOR-115 — the role-aware semantic CONTRACT between the planner and the LLM.
 *
 * One canonical place that, for each sample layout, declares:
 *   • promptSchema  — the exact JSON shape the LLM must return (role-specific, not prose)
 *   • validate      — strict validation of that JSON (wrong count / missing / extra → reject)
 *   • toSections    — maps the validated role objects onto the renderer's section model
 *   • staticContent — a deterministic role-typed fallback (no LLM) used for previews + when
 *                     the model output is rejected (graceful degrade, never silent repair)
 *
 * The renderer therefore paints validated, role-typed objects — never inferred-from-prose.
 * This module is pure + has no LLM/network dependency, so the contract is fully testable
 * offline (valid JSON accepted, malformed rejected) before the live model is ever called.
 */

export interface ContractSectionOut {
  title: string;
  body: string;
  lead?: string;
  bullets?: string[];
  stat?: { value: string; label: string } | null;
  example?: string | null;
  take?: string | null;
  impact?: string | null;
  risk?: string | null;
  semanticRole: string;
}
export interface ContractResult {
  headline: string;
  sections: ContractSectionOut[];
  summary: string;
  cta: string;
}
export interface ValidationOutcome {
  ok: boolean;
  errors: string[];
  result?: ContractResult;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const onlyKeys = (o: Record<string, unknown>, allowed: string[]): string[] =>
  Object.keys(o).filter((k) => !allowed.includes(k));

export type InfographicRole = 'statistic' | 'process_step' | 'comparison_side' | 'framework_pillar' | 'hierarchy_level' | 'timeline_event';

const LAYOUT_ROLE: Readonly<Record<string, InfographicRole>> = {
  stats: 'statistic', process: 'process_step', comparison: 'comparison_side',
  framework: 'framework_pillar', hierarchy: 'hierarchy_level', timeline: 'timeline_event',
};
export function roleForLayout(layout: string): InfographicRole {
  return LAYOUT_ROLE[layout] ?? 'framework_pillar';
}

/* CREATOR-116: each role declares how TALL its card should be — a KPI is compact (a big
 * number + a line), a comparison side is wide/tall (two lists), a process step is medium.
 * The engine caps card height at this and centers the grid, so a concise role no longer
 * stretches to legacy paragraph height. px on the canonical 1200px canvas. */
const ROLE_MAX_CARD_HEIGHT: Readonly<Record<InfographicRole, number>> = {
  statistic: 360,        // compact KPI tile
  process_step: 300,     // medium step row
  comparison_side: 640,  // wide column with advantages + limitations
  framework_pillar: 430, // medium pillar
  hierarchy_level: 300,  // medium level row
  timeline_event: 280,   // medium event row
};
export function roleMaxCardHeight(layout: string): number {
  return ROLE_MAX_CARD_HEIGHT[roleForLayout(layout)];
}

/** The exact JSON shape the LLM must return for this layout + slot count. */
export function promptSchemaFor(layout: string, slotCount: number): string {
  switch (roleForLayout(layout)) {
    case 'statistic':
      return `{ "headline": string, "kpis": [ { "label": string, "value": string, "description": string } ] (EXACTLY ${slotCount}), "cta": string }`;
    case 'process_step':
      return `{ "headline": string, "steps": [ { "title": string, "body": string, "outcome": string } ] (EXACTLY ${slotCount}), "cta": string }`;
    case 'comparison_side':
      return `{ "headline": string, "comparison": { "left": { "title": string, "advantages": string[], "limitations": string[] }, "right": { "title": string, "advantages": string[], "limitations": string[] } }, "summary": string, "cta": string }`;
    case 'framework_pillar':
      return `{ "headline": string, "pillars": [ { "pillarName": string, "pillarExplanation": string } ] (EXACTLY ${slotCount}), "cta": string }`;
    case 'hierarchy_level':
      return `{ "headline": string, "levels": [ { "title": string, "body": string } ] (EXACTLY ${slotCount}), "cta": string }`;
    case 'timeline_event':
      return `{ "headline": string, "events": [ { "title": string, "date": string, "body": string } ] (EXACTLY ${slotCount}), "cta": string }`;
  }
}

/** STRICT validation of the parsed JSON against the role schema. Never repairs. */
export function validateRoleResponse(layout: string, parsed: unknown, slotCount: number): ValidationOutcome {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['response is not a JSON object'] };
  }
  const o = parsed as Record<string, unknown>;
  if (!isStr(o.headline)) errors.push('missing headline');
  if (!isStr(o.cta)) errors.push('missing cta');
  const role = roleForLayout(layout);
  let sections: ContractSectionOut[] = [];
  let summary = s(o.summary);

  const checkArr = (key: string, allowedItemKeys: string[], itemCheck: (it: Record<string, unknown>, i: number) => string[], map: (it: Record<string, unknown>) => ContractSectionOut) => {
    const arr = o[key];
    if (!Array.isArray(arr)) { errors.push(`missing ${key} array`); return; }
    if (arr.length !== slotCount) errors.push(`${key} must contain exactly ${slotCount} items (got ${arr.length})`);
    arr.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') { errors.push(`${key}[${i}] not an object`); return; }
      const it = raw as Record<string, unknown>;
      const extra = onlyKeys(it, allowedItemKeys);
      if (extra.length) errors.push(`${key}[${i}] has unexpected fields: ${extra.join(',')}`);
      errors.push(...itemCheck(it, i));
    });
    if (errors.length === 0) sections = (arr as Record<string, unknown>[]).map(map);
  };

  if (role === 'statistic') {
    if (onlyKeys(o, ['headline', 'kpis', 'cta']).length) errors.push(`unexpected top-level fields: ${onlyKeys(o, ['headline', 'kpis', 'cta']).join(',')}`);
    checkArr('kpis', ['label', 'value', 'description'],
      (it, i) => [!isStr(it.label) && `kpis[${i}].label`, !isStr(it.value) && `kpis[${i}].value`, !isStr(it.description) && `kpis[${i}].description`].filter(Boolean).map((x) => `missing ${x}`),
      (it) => ({ title: s(it.label), body: s(it.description), lead: s(it.description), stat: { value: s(it.value), label: s(it.label) }, bullets: [], semanticRole: 'statistic' }));
  } else if (role === 'process_step') {
    if (onlyKeys(o, ['headline', 'steps', 'cta']).length) errors.push(`unexpected top-level fields: ${onlyKeys(o, ['headline', 'steps', 'cta']).join(',')}`);
    checkArr('steps', ['title', 'body', 'outcome'],
      (it, i) => [!isStr(it.title) && `steps[${i}].title`, !isStr(it.body) && `steps[${i}].body`, !isStr(it.outcome) && `steps[${i}].outcome`].filter(Boolean).map((x) => `missing ${x}`),
      (it) => ({ title: s(it.title), body: s(it.body), lead: s(it.body), take: s(it.outcome), bullets: [], semanticRole: 'process_step' }));
  } else if (role === 'framework_pillar') {
    if (onlyKeys(o, ['headline', 'pillars', 'cta']).length) errors.push(`unexpected top-level fields: ${onlyKeys(o, ['headline', 'pillars', 'cta']).join(',')}`);
    checkArr('pillars', ['pillarName', 'pillarExplanation'],
      (it, i) => [!isStr(it.pillarName) && `pillars[${i}].pillarName`, !isStr(it.pillarExplanation) && `pillars[${i}].pillarExplanation`].filter(Boolean).map((x) => `missing ${x}`),
      (it) => ({ title: s(it.pillarName), body: s(it.pillarExplanation), lead: s(it.pillarExplanation), bullets: [], semanticRole: 'framework_pillar' }));
  } else if (role === 'hierarchy_level') {
    if (onlyKeys(o, ['headline', 'levels', 'cta']).length) errors.push(`unexpected top-level fields: ${onlyKeys(o, ['headline', 'levels', 'cta']).join(',')}`);
    checkArr('levels', ['title', 'body'],
      (it, i) => [!isStr(it.title) && `levels[${i}].title`, !isStr(it.body) && `levels[${i}].body`].filter(Boolean).map((x) => `missing ${x}`),
      (it) => ({ title: s(it.title), body: s(it.body), lead: s(it.body), bullets: [], semanticRole: 'hierarchy_level' }));
  } else if (role === 'timeline_event') {
    if (onlyKeys(o, ['headline', 'events', 'cta']).length) errors.push(`unexpected top-level fields: ${onlyKeys(o, ['headline', 'events', 'cta']).join(',')}`);
    checkArr('events', ['title', 'date', 'body'],
      (it, i) => [!isStr(it.title) && `events[${i}].title`, !isStr(it.date) && `events[${i}].date`, !isStr(it.body) && `events[${i}].body`].filter(Boolean).map((x) => `missing ${x}`),
      (it) => ({ title: s(it.title), body: s(it.body), lead: s(it.body), take: s(it.date), bullets: [], semanticRole: 'timeline_event' }));
  } else { // comparison_side — exactly 2, a {left,right} object (slotCount is 2)
    if (onlyKeys(o, ['headline', 'comparison', 'summary', 'cta']).length) errors.push(`unexpected top-level fields: ${onlyKeys(o, ['headline', 'comparison', 'summary', 'cta']).join(',')}`);
    const cmp = o.comparison;
    if (!cmp || typeof cmp !== 'object') errors.push('missing comparison object');
    else {
      const c = cmp as Record<string, unknown>;
      const side = (key: 'left' | 'right'): ContractSectionOut | null => {
        const raw = c[key];
        if (!raw || typeof raw !== 'object') { errors.push(`comparison.${key} missing`); return null; }
        const it = raw as Record<string, unknown>;
        const extra = onlyKeys(it, ['title', 'advantages', 'limitations']);
        if (extra.length) errors.push(`comparison.${key} unexpected fields: ${extra.join(',')}`);
        if (!isStr(it.title)) errors.push(`comparison.${key}.title missing`);
        if (!isStrArr(it.advantages)) errors.push(`comparison.${key}.advantages must be string[]`);
        if (!isStrArr(it.limitations)) errors.push(`comparison.${key}.limitations must be string[]`);
        return { title: s(it.title), body: (it.advantages as string[] | undefined)?.[0] ?? '', lead: '', bullets: (it.advantages as string[] | undefined) ?? [], risk: (it.limitations as string[] | undefined)?.join(' · ') ?? '', semanticRole: 'comparison_side' };
      };
      const l = side('left'); const r = side('right');
      if (errors.length === 0 && l && r) sections = [l, r];
    }
    if (slotCount !== 2) errors.push(`comparison expects exactly 2 sides (slotCount=${slotCount})`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], result: { headline: s(o.headline), sections, summary, cta: s(o.cta) } };
}

/** Deterministic, role-typed fallback content (no LLM). Always passes the validator. */
export function staticRoleContent(layout: string, slotCount: number, topic: string, sectionTitles: string[]): ContractResult {
  const role = roleForLayout(layout);
  const title = (i: number) => s(sectionTitles[i]) || `${topic} — point ${i + 1}`;
  const sections: ContractSectionOut[] = [];
  for (let i = 0; i < slotCount; i++) {
    const t = title(i);
    if (role === 'statistic') sections.push({ title: t, body: `Why ${t.toLowerCase()} matters for ${topic}.`, lead: `Why ${t.toLowerCase()} matters.`, stat: { value: `${[2, 3, 4, 5, 6][i % 5]}x`, label: t }, bullets: [], semanticRole: role });
    else if (role === 'process_step') sections.push({ title: t, body: `Carry out ${t.toLowerCase()} as part of ${topic}.`, lead: `Carry out ${t.toLowerCase()}.`, take: `Result: ${t} completed.`, bullets: [], semanticRole: role });
    else if (role === 'framework_pillar') sections.push({ title: t, body: `${t} is a core pillar of ${topic}.`, lead: `${t} is a core pillar.`, bullets: [], semanticRole: role });
    else if (role === 'hierarchy_level') sections.push({ title: t, body: `${t} sits at this level of ${topic}.`, lead: `${t} at this level.`, bullets: [], semanticRole: role });
    else if (role === 'timeline_event') sections.push({ title: t, body: `${t} happens here in ${topic}.`, lead: `${t}.`, take: `Phase ${i + 1}`, bullets: [], semanticRole: role });
    else sections.push({ title: t, body: '', bullets: [`Advantage of ${t.toLowerCase()}`, `Strength in ${topic}`], risk: `Watch-out for ${t.toLowerCase()}`, semanticRole: 'comparison_side' });
  }
  return { headline: topic, sections, summary: `A clear view of ${topic}.`, cta: 'Learn more' };
}
