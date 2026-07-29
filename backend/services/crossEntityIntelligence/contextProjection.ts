/**
 * G-C306 — Context Projection Framework (pure, deterministic).
 *
 * Produces graph-DERIVED context projections (buying / account / offering / relationship) for
 * downstream intelligence programs (Journey / Customer / Revenue / Automation — future). These are
 * cross-entity SUMMARIES over the graph; they are NOT entity projections and DUPLICATE no entity's
 * canonical projection (Programs 1–3 keep their own single projection). Nothing here is persisted.
 */

import type { CrossEntityContext, CrossEntityInsight, RelationshipQuality, ContextProjection, ContextProjectionName } from './types';
import { clamp01 } from '../intelligence/canonical';

const avg = (ns: number[]): number => (ns.length ? clamp01(ns.reduce((a, n) => a + n, 0) / ns.length) : 0);

export function projectContext(context: CrossEntityContext, insights: CrossEntityInsight[], relationships: RelationshipQuality[]): ContextProjection[] {
  const present = new Set(context.entities.map((e) => e.type));
  const entityKeys = context.entities.map((e) => e.key).sort();
  const at = context.builtAt;
  const live = insights.filter((i) => !i.abstained);

  const build = (name: ContextProjectionName, ofKinds: string[], gate: boolean): ContextProjection | null => {
    if (!gate) return null;
    const contributing = live.filter((i) => ofKinds.includes(i.kind));
    const relConf = name === 'relationship_context' ? relationships.map((r) => r.strength) : [];
    const confidence = avg([...contributing.map((i) => i.confidence), ...relConf]);
    return {
      name, focus: context.focus.key, entities: entityKeys,
      insights: contributing.map((i) => i.claim).sort(),
      relationshipCount: relationships.length, confidence, projectedAt: at,
    };
  };

  return [
    build('buying_context', ['buying_context', 'interest', 'qualification'], present.has('lead')),
    build('account_context', ['qualification', 'portfolio'], present.has('company')),
    build('offering_context', ['portfolio', 'interest'], present.has('offering')),
    build('relationship_context', [], relationships.length > 0),
  ].filter((p): p is ContextProjection => p != null);
}
