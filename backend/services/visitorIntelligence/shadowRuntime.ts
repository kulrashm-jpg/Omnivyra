/**
 * V-A101 (shadow runtime) — Visitor shadow runtime (pure). Builds the canonical Understanding from a
 * raw visitor and measures FIELD parity vs that raw input — ZERO production behaviour change,
 * authoritative OFF, consumed by nothing. `computeVisitorUnderstandingShadow` returns null when the
 * flag is OFF (default).
 */

import type { VisitorUnderstanding, VisitorProjection } from './types';
import type { VisitorRawInput } from './fromRaw';
import { visitorFromRaw } from './fromRaw';
import { buildVisitorUnderstanding } from './builder';
import { projectVisitor } from './projection';
import { isVisitorUnderstandingEnabled } from './flags';
import { toLegacyFields } from './persistence';

export interface VisitorFieldDivergence { field: string; canonical: unknown; legacy: unknown; agree: boolean; }
export interface VisitorShadowComparison { visitorId: string; divergences: VisitorFieldDivergence[]; facetCount: number; evidenceCount: number; contradictionCount: number; parity: number; }

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

export function compareToRaw(u: VisitorUnderstanding, raw: VisitorRawInput): VisitorShadowComparison {
  const c = toLegacyFields(u);
  const pairs: Array<[string, unknown, unknown]> = [
    ['device', c.device, raw.device ?? null],
    ['country', c.country, raw.country ?? null],
    ['source', c.source, raw.acquisitionSource ?? null],
    ['campaign', c.campaign, raw.campaign ?? null],
    ['lead_ref', c.lead_ref, raw.leadRef ?? null],
    ['lifecycle', c.lifecycle, raw.lifecycle ?? null],
  ];
  const divergences: VisitorFieldDivergence[] = pairs.map(([field, cv, lv]) => ({ field, canonical: cv, legacy: lv, agree: norm(cv) === norm(lv) }));
  const facetCount = Object.values(u.facets).filter((f) => f.value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const agree = divergences.filter((d) => d.agree).length;
  return { visitorId: u.key.visitorId, divergences, facetCount, evidenceCount, contradictionCount: u.contradictions.length, parity: divergences.length ? Number((agree / divergences.length).toFixed(4)) : 1 };
}

export interface VisitorShadowBundle { understanding: VisitorUnderstanding; projection: VisitorProjection; comparison: VisitorShadowComparison; }

export function computeVisitorUnderstandingShadow(raw: VisitorRawInput): VisitorShadowBundle | null {
  if (!isVisitorUnderstandingEnabled()) return null;
  const a = visitorFromRaw(raw);
  const understanding = buildVisitorUnderstanding({ key: a.key, builtAt: raw.asOf, facets: a.facets, evidence: a.evidence, edges: a.edges });
  const projection = projectVisitor(understanding, raw.asOf);
  const comparison = compareToRaw(understanding, raw);
  return { understanding, projection, comparison };
}
