/**
 * Infographic Composition Planner (CREATOR-INFO-COMPOSE, stage 1).
 *
 * THE PROBLEM IT SOLVES: every infographic today is `hero + ONE repeating block of a single
 * role` (stats→3 KPIs, process→4 steps, …), so they all look structurally alike. The element
 * TYPES exist (charts, tables, …) but nothing COMBINES a chart + KPI row + quote + icon points
 * + smart-shape callout in one asset.
 *
 * This module is the deterministic, intent-aware "brain" that decides — from the infographic's
 * PURPOSE / AUDIENCE / DATA AVAILABILITY — which heterogeneous element sequence to compose.
 * No LLM, no randomness: the same intent always yields the same plan (a stable design family),
 * while different intents yield genuinely different element mixes.
 *
 * It is PURE and ADDITIVE. It does not render and does not change any existing behaviour; the
 * renderer + semantic contract consume it only when INFOGRAPHIC_COMPOSED_LAYOUTS is enabled
 * (stage 2). When the flag is off, `planComposition` returns the legacy single-role structure
 * so output is byte-identical.
 */

// ── Feature flag (default OFF) ──────────────────────────────────────
export function infographicComposedLayoutsEnabled(): boolean {
  return process.env.INFOGRAPHIC_COMPOSED_LAYOUTS === 'true';
}

// ── Element vocabulary ──────────────────────────────────────────────
/** The composable element kinds. The first six map 1:1 to the legacy repeating roles
 *  (so the legacy path is expressible); the rest are the NEW heterogeneous elements. */
export type CompositionElement =
  | 'hero'           // headline band — always the first section
  | 'kpi_row'        // a row of compact stat KPIs (number + label)
  | 'chart'          // a single chart (pie | bar | line)
  | 'quote'          // a pull quote / testimonial
  | 'icon_points'    // icon-led points (benefits, takeaways)
  | 'image_band'     // a supporting image / illustration band
  | 'callout'        // a smart-shape callout / key takeaway
  | 'process_steps'  // an ordered sequence
  | 'comparison'     // side-by-side options
  | 'framework'      // pillars of a model
  | 'hierarchy'      // ranked levels
  | 'timeline';      // dated events

export type ChartHint = 'pie' | 'bar' | 'line';

export interface CompositionSection {
  element: CompositionElement;
  /** How many slots this section holds (hero/chart/quote/callout = 1; rows/sequences = N). */
  count: number;
  emphasis: 'primary' | 'support';
  chartHint?: ChartHint;
}

// ── Intent ──────────────────────────────────────────────────────────
export type InfographicArchetype =
  | 'data_report'
  | 'thought_leadership'
  | 'process_guide'
  | 'comparison'
  | 'framework_overview'
  | 'timeline_story'
  | 'hierarchy_ranking';

export interface CompositionIntent {
  archetype: InfographicArchetype;
  /** Real numeric data exists → KPI rows / charts are warranted (never fabricate otherwise). */
  hasQuantData: boolean;
  /** A real quote/testimonial exists. */
  hasQuote: boolean;
  audienceTags: string[];
  industryTags: string[];
  /** The legacy engine layout (stats/process/comparison/framework/hierarchy/timeline). */
  baseLayout: string;
}

const LAYOUT_TO_ARCHETYPE: Record<string, InfographicArchetype> = {
  stats: 'data_report',
  process: 'process_guide',
  comparison: 'comparison',
  framework: 'framework_overview',
  hierarchy: 'hierarchy_ranking',
  timeline: 'timeline_story',
};

const lc = (xs: string[]) => xs.map((x) => String(x).toLowerCase());
const isExecAudience = (aud: string[]) => lc(aud).some((a) => /exec|c-?suite|leader|founder|investor|board/.test(a));

/** Derive intent from a template's layout + metadata tags + whether real data/quote exist.
 *  `meta` is the template's `metadata` record (audienceTags/industryTags) — all optional. */
export function deriveCompositionIntent(input: {
  baseLayout: string;
  meta?: Record<string, unknown> | null;
  tags?: string[];
  hasQuantData?: boolean;
  hasQuote?: boolean;
}): CompositionIntent {
  const meta = (input.meta ?? {}) as Record<string, unknown>;
  const audienceTags = Array.isArray(meta.audienceTags) ? (meta.audienceTags as string[]) : [];
  const industryTags = Array.isArray(meta.industryTags) ? (meta.industryTags as string[]) : [];
  const tags = lc(input.tags ?? []);
  // Quote-forward archetype when the layout is generic AND the content reads as a point of view.
  const quoteForward = (input.hasQuote ?? false) && (input.baseLayout === 'framework' || tags.some((t) => /quote|thought|opinion|insight|story/.test(t)));
  const archetype = quoteForward ? 'thought_leadership' : (LAYOUT_TO_ARCHETYPE[input.baseLayout] ?? 'framework_overview');
  return {
    archetype,
    hasQuantData: input.hasQuantData ?? false,
    hasQuote: input.hasQuote ?? false,
    audienceTags,
    industryTags,
    baseLayout: input.baseLayout,
  };
}

// ── Legacy structure (back-compat, flag OFF) ────────────────────────
const LEGACY_REPEAT: Record<string, { element: CompositionElement; count: number }> = {
  stats: { element: 'kpi_row', count: 3 },
  process: { element: 'process_steps', count: 4 },
  comparison: { element: 'comparison', count: 2 },
  framework: { element: 'framework', count: 4 },
  hierarchy: { element: 'hierarchy', count: 4 },
  timeline: { element: 'timeline', count: 5 },
};

function legacyComposition(baseLayout: string): CompositionSection[] {
  const rep = LEGACY_REPEAT[baseLayout] ?? LEGACY_REPEAT.framework;
  return [
    { element: 'hero', count: 1, emphasis: 'primary' },
    { element: rep.element, count: rep.count, emphasis: 'primary' },
  ];
}

// ── The intent-aware composer (flag ON) ─────────────────────────────
/**
 * Plan a heterogeneous element sequence from intent. Deterministic. Every section that depends
 * on data is GATED on `hasQuantData`/`hasQuote` so the planner never asks the renderer to
 * fabricate numbers or quotes that don't exist — Unknown stays Unknown.
 */
export function planComposition(intent: CompositionIntent): CompositionSection[] {
  if (!infographicComposedLayoutsEnabled()) return legacyComposition(intent.baseLayout);

  const exec = isExecAudience(intent.audienceTags);
  const sections: CompositionSection[] = [{ element: 'hero', count: 1, emphasis: 'primary' }];
  const add = (element: CompositionElement, count: number, emphasis: 'primary' | 'support' = 'support', chartHint?: ChartHint) => {
    if (count > 0) sections.push({ element, count, emphasis, ...(chartHint ? { chartHint } : {}) });
  };

  switch (intent.archetype) {
    case 'data_report':
      add('kpi_row', 3, 'primary');
      if (intent.hasQuantData) add('chart', 1, 'primary', exec ? 'bar' : 'pie');
      add('icon_points', exec ? 0 : 3);
      add('callout', 1);
      break;
    case 'thought_leadership':
      if (intent.hasQuote) add('quote', 1, 'primary');
      add('icon_points', 3, 'primary');
      if (intent.hasQuantData) add('kpi_row', 1);
      add('callout', 1);
      break;
    case 'process_guide':
      add('process_steps', 4, 'primary');
      add('icon_points', exec ? 0 : 3);
      add('callout', 1);
      break;
    case 'comparison':
      add('comparison', 2, 'primary');
      if (intent.hasQuantData) add('chart', 1, 'support', 'bar');
      add('callout', 1);
      break;
    case 'framework_overview':
      add('framework', 4, 'primary');
      if (intent.hasQuote) add('quote', 1);
      else if (intent.hasQuantData) add('chart', 1, 'support', 'pie');
      add('callout', 1);
      break;
    case 'timeline_story':
      add('timeline', 5, 'primary');
      add('callout', 1);
      break;
    case 'hierarchy_ranking':
      add('hierarchy', 4, 'primary');
      if (intent.hasQuantData) add('kpi_row', 1);
      add('callout', 1);
      break;
  }
  return sections;
}

/** The distinct element kinds present in a plan (variety/coverage signal for tests + telemetry). */
export function compositionVariety(sections: CompositionSection[]): number {
  return new Set(sections.map((s) => s.element)).size;
}
