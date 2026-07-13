/**
 * decisionRelationships.ts — deterministic decision relationships (PMF-007R §5).
 *
 * Derives relationships between Decision Objects — blocks, depends_on, supersedes,
 * duplicates, conflicts_with, related_to. Pure/deterministic: identical decision sets
 * yield identical relationships. Additive — the relationship graph is a projection
 * over the decisions, never a mutation of them.
 */

import type { DecisionObject } from './decisionObjectModel';

export type RelationshipType = 'blocks' | 'depends_on' | 'supersedes' | 'duplicates' | 'conflicts_with' | 'related_to';

export interface DecisionRelationship {
  from: string; // decisionId
  to: string;   // decisionId
  type: RelationshipType;
  reason: string;
}

/** Content key used to detect duplicates (same type + title). */
function contentKey(d: DecisionObject): string {
  return `${d.decisionType}::${d.title.trim().toLowerCase()}`;
}

/**
 * Derive relationships across a decision set. Deterministic (stable ordering).
 *   depends_on / blocks — from graph dependencies (decisionSource.node).
 *   duplicates          — same type + title.
 *   supersedes          — a COMPLETED/SUPERSEDED decision superseded by a newer CREATED one of the same content.
 *   conflicts_with      — same type, same title, but materially different recommendedAction.
 *   related_to          — same decisionType (siblings), when not already a stronger relation.
 */
export function deriveDecisionRelationships(decisions: DecisionObject[]): DecisionRelationship[] {
  const rels: DecisionRelationship[] = [];
  const byNode = new Map<string, DecisionObject[]>();
  for (const d of decisions) {
    const arr = byNode.get(d.decisionSource.node) ?? [];
    arr.push(d);
    byNode.set(d.decisionSource.node, arr);
  }

  const sorted = [...decisions].sort((a, b) => a.decisionId.localeCompare(b.decisionId));

  // depends_on / blocks (from graph node dependencies).
  for (const d of sorted) {
    for (const depNode of d.dependencies) {
      for (const upstream of (byNode.get(depNode) ?? [])) {
        rels.push({ from: d.decisionId, to: upstream.decisionId, type: 'depends_on', reason: `depends on ${depNode}` });
        rels.push({ from: upstream.decisionId, to: d.decisionId, type: 'blocks', reason: `blocks until ${depNode} completes` });
      }
    }
  }

  // duplicates / conflicts_with / supersedes (pairwise by content key).
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]; const b = sorted[j];
      if (contentKey(a) !== contentKey(b)) continue;
      if (a.recommendedAction.trim() !== b.recommendedAction.trim()) {
        rels.push({ from: a.decisionId, to: b.decisionId, type: 'conflicts_with', reason: 'same target, different action' });
        continue;
      }
      // supersession: a terminal decision superseded by a fresh one.
      const aTerminal = a.status === 'COMPLETED' || a.status === 'SUPERSEDED';
      const bTerminal = b.status === 'COMPLETED' || b.status === 'SUPERSEDED';
      if (aTerminal && !bTerminal) rels.push({ from: b.decisionId, to: a.decisionId, type: 'supersedes', reason: 'newer decision supersedes terminal duplicate' });
      else if (bTerminal && !aTerminal) rels.push({ from: a.decisionId, to: b.decisionId, type: 'supersedes', reason: 'newer decision supersedes terminal duplicate' });
      else rels.push({ from: a.decisionId, to: b.decisionId, type: 'duplicates', reason: 'same type + title + action' });
    }
  }

  // related_to (same type siblings not already related).
  const seen = new Set(rels.map((r) => `${r.from}:${r.to}`));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]; const b = sorted[j];
      if (a.decisionType !== b.decisionType) continue;
      if (contentKey(a) === contentKey(b)) continue; // stronger relation handled above
      if (seen.has(`${a.decisionId}:${b.decisionId}`) || seen.has(`${b.decisionId}:${a.decisionId}`)) continue;
      rels.push({ from: a.decisionId, to: b.decisionId, type: 'related_to', reason: `same decision type ${a.decisionType}` });
    }
  }

  return rels.sort((x, y) => (x.from + x.to + x.type).localeCompare(y.from + y.to + y.type));
}
