/**
 * Platform Business Impact Engine (Phase 21B, Phase D).
 *
 * The ONE deterministic relationship-graph machinery for every intelligence domain. It is
 * dimension-agnostic and graph-agnostic: each domain supplies its own relationship graph,
 * module→dimension defaults, and dimension labels; the engine computes the impact profile,
 * cascade, ROI and aggregate identically. No domain computes business impact independently.
 *
 * Supported dimensions (Phase D) are open: ImpactDimension lists the canonical platform set,
 * but the engine accepts any string dimension so future domains extend without edits here.
 */
export type ImpactDimension =
  | 'traffic' | 'leads' | 'qualified_leads' | 'pipeline' | 'revenue' | 'retention'
  | 'trust' | 'authority' | 'brand' | 'seo' | 'performance' | 'marketing'
  | 'campaign' | 'crm' | 'community' | 'marketpulse' | 'content'
  | 'conversion' | 'technical' | 'accessibility' | 'lead';

export interface BusinessImpact<D extends string = string> {
  dimensions: Partial<Record<D, number>>;
  cascade: string[];
  summary: string;
  score: number;
}

export interface ImpactGraphConfig<D extends string> {
  /** Explicit issue-key → {dimensions, cascade} relationships (the "why" graph). */
  graph: Record<string, { dimensions: Partial<Record<D, number>>; cascade: string[] }>;
  /** Default dimension weights per module — used when a key has no explicit graph entry. */
  moduleDimensions: Record<string, Partial<Record<D, number>>>;
  /** Human label per dimension for cascade/summary text. */
  dimensionTail: Record<D, string>;
}

const IMPACT_WEIGHT = { high: 1, medium: 0.7, low: 0.4 } as const;

/** Deterministic business-impact profile for one finding. */
export function buildBusinessImpact<D extends string>(
  key: string,
  affectedModules: string[],
  level: 'high' | 'medium' | 'low',
  cfg: ImpactGraphConfig<D>,
): BusinessImpact<D> {
  const explicit = cfg.graph[key];
  let dimensions: Partial<Record<D, number>> = {};
  let cascade: string[];
  if (explicit) {
    dimensions = { ...explicit.dimensions };
    cascade = explicit.cascade;
  } else {
    for (const mod of affectedModules) {
      for (const [dim, w] of Object.entries(cfg.moduleDimensions[mod] ?? {})) {
        dimensions[dim as D] = Math.max(dimensions[dim as D] ?? 0, w as number);
      }
    }
    const top = Object.entries(dimensions).sort((a, b) => (b[1] as number) - (a[1] as number))[0];
    cascade = top ? [affectedModules[0] ?? 'Platform', `Lower ${cfg.dimensionTail[top[0] as D]}`] : ['Platform', 'Lower overall quality'];
  }
  const w = IMPACT_WEIGHT[level];
  const scaled: Partial<Record<D, number>> = {};
  for (const [dim, v] of Object.entries(dimensions)) scaled[dim as D] = Math.round((v as number) * w);
  const vals = Object.values(scaled) as number[];
  const score = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  return { dimensions: scaled, cascade, summary: cascade.join(' → '), score };
}

/** Deterministic ROI band from impact magnitude vs effort. */
export function estimateROI(impactScore: number, effort: 'high' | 'medium' | 'low'): 'high' | 'medium' | 'low' {
  const effortPenalty = effort === 'high' ? 30 : effort === 'medium' ? 12 : 0;
  const net = impactScore - effortPenalty;
  return net >= 55 ? 'high' : net >= 30 ? 'medium' : 'low';
}

/** Aggregate per-finding impacts into a domain-level dimension profile. */
export function aggregateBusinessImpact<D extends string>(
  impacts: BusinessImpact<D>[],
  dimensionTail: Record<D, string>,
): { dimensions: Partial<Record<D, number>>; topDimensions: D[]; summary: string } {
  const acc: Partial<Record<D, number>> = {};
  const counts: Partial<Record<D, number>> = {};
  for (const im of impacts) for (const [dim, v] of Object.entries(im.dimensions)) {
    acc[dim as D] = (acc[dim as D] ?? 0) + (v as number);
    counts[dim as D] = (counts[dim as D] ?? 0) + 1;
  }
  const dimensions: Partial<Record<D, number>> = {};
  for (const dim of Object.keys(acc) as D[]) dimensions[dim] = Math.round(acc[dim]! / Math.max(1, counts[dim]!));
  const topDimensions = (Object.entries(dimensions).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 3).map(([d]) => d) as D[]);
  const summary = topDimensions.length ? `Most exposed: ${topDimensions.map((d) => dimensionTail[d]).join(', ')}.` : 'No material business impact detected.';
  return { dimensions, topDimensions, summary };
}
