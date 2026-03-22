/**
 * Knowledge graph types and helpers.
 * The graph is stored in `blog_relationships` in Supabase.
 * These are pure utilities — no DB calls.
 */

export type RelationshipType = 'related' | 'prerequisite' | 'continuation';

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  related:      'Related',
  prerequisite: 'Prerequisite',
  continuation: 'Continues from',
};

export const RELATIONSHIP_DESCRIPTIONS: Record<RelationshipType, string> = {
  related:      'These articles share the same topic or theme',
  prerequisite: 'Readers should read the source first',
  continuation: 'The target article directly continues this one',
};

export interface BlogNode {
  id:          string;
  title:       string;
  slug:        string;
  category:    string | null;
  tags:        string[];
  views_count: number;
  published_at: string | null;
}

export interface BlogEdge {
  id:          string;
  sourceId:    string;
  targetId:    string;
  type:        RelationshipType;
  sourceTitle: string;
  targetTitle: string;
  sourceSlug:  string;
  targetSlug:  string;
}

export interface BlogGraph {
  nodes: BlogNode[];
  edges: BlogEdge[];
}

/** Nodes that have at least one edge (connected). */
export function connectedNodes(graph: BlogGraph): BlogNode[] {
  const ids = new Set(
    graph.edges.flatMap((e) => [e.sourceId, e.targetId]),
  );
  return graph.nodes.filter((n) => ids.has(n.id));
}

/** All edges touching a given blog ID (in either direction). */
export function edgesForNode(graph: BlogGraph, blogId: string): BlogEdge[] {
  return graph.edges.filter(
    (e) => e.sourceId === blogId || e.targetId === blogId,
  );
}

/** Nodes with no edges — candidates for linking. */
export function isolatedNodes(graph: BlogGraph): BlogNode[] {
  const connected = new Set(
    graph.edges.flatMap((e) => [e.sourceId, e.targetId]),
  );
  return graph.nodes.filter((n) => !connected.has(n.id));
}

/**
 * Infer "related" edges from shared tags (≥2 shared tags).
 * Used to suggest relationships that admins haven't manually created.
 */
export function inferRelatedEdges(
  nodes: BlogNode[],
  existingEdges: BlogEdge[],
): { sourceId: string; targetId: string; sourceTitle: string; targetTitle: string; sharedTags: string[] }[] {
  const existingPairs = new Set(
    existingEdges.flatMap((e) => [
      `${e.sourceId}:${e.targetId}`,
      `${e.targetId}:${e.sourceId}`,
    ]),
  );

  const suggestions: {
    sourceId: string; targetId: string;
    sourceTitle: string; targetTitle: string;
    sharedTags: string[];
  }[] = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const pair = `${a.id}:${b.id}`;
      if (existingPairs.has(pair)) continue;
      const sharedTags = a.tags.filter((t) => b.tags.includes(t));
      if (sharedTags.length >= 2) {
        suggestions.push({
          sourceId: a.id, targetId: b.id,
          sourceTitle: a.title, targetTitle: b.title,
          sharedTags,
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.sharedTags.length - a.sharedTags.length).slice(0, 10);
}
