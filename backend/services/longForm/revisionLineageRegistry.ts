/**
 * Phase 1 — Revision lineage registry.
 *
 * In-memory store of branches and revisions. Each branch has a baseline
 * revision (e.g. the orchestrator's initial output) and a tree of subsequent
 * revisions reachable by `parentRevisionId`.
 *
 * Supports:
 *   - linear edits (revisions chain off currentRevisionId)
 *   - branching (record a revision whose parent is an earlier revision)
 *   - rollback (creates a new branch starting from any historical revision)
 *   - ancestry tracing (walk parent links back to baseline)
 *
 * Caller-owned. Tests use a fresh registry per scenario. Production wires
 * a per-process singleton via `getDefaultRevisionLineageRegistry()`.
 */

import type {
  Revision,
  RevisionBranch,
  RevisionOrigin,
  EditorIdentityType,
  RevisionSectionEdit,
} from './longFormRecommendationTypes';

function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface StartBranchInput {
  articleId: string;
  baselineSections: Array<{ sectionId: string; html: string }>;
}

export interface RecordRevisionInput {
  branchId: string;
  parentRevisionId?: string;
  revisionOrigin: RevisionOrigin;
  editorIdentityType: EditorIdentityType;
  editorId?: string;
  edits: RevisionSectionEdit[];
  editSummary: string;
}

export interface RevisionLineageRegistry {
  startBranch(input: StartBranchInput): RevisionBranch;
  recordRevision(input: RecordRevisionInput): Revision;
  getBranch(branchId: string): RevisionBranch | null;
  getRevision(branchId: string, revisionId: string): Revision | null;
  /** Walk parent links back to baseline. Returns newest → oldest. */
  getLineage(branchId: string, revisionId: string): Revision[];
  /** Create a new branch starting from a historical revision. */
  rollback(input: { branchId: string; toRevisionId: string; reason: string }): RevisionBranch;
  /** Snapshot of all branches for a given article. */
  listBranchesForArticle(articleId: string): RevisionBranch[];
  clear(articleId?: string): void;
  size(): number;
}

export function createRevisionLineageRegistry(): RevisionLineageRegistry {
  const branches = new Map<string, RevisionBranch>();

  function startBranch(input: StartBranchInput): RevisionBranch {
    const branchId = newId('rbr');
    const baselineRevId = `rev_baseline_${stableHash(input.articleId + branchId).slice(0, 8)}`;
    const baseline: Revision = {
      revisionId: baselineRevId,
      branchId,
      parentRevisionId: null,
      revisionOrigin: 'ai_generation',
      editorIdentityType: 'system',
      affectedSections: input.baselineSections.map((s) => ({
        sectionId: s.sectionId,
        beforeHtml: '',
        afterHtml: s.html,
      })),
      editSummary: 'Baseline article (initial generation)',
      revisionTimestamp: new Date().toISOString(),
    };
    const branch: RevisionBranch = {
      branchId,
      articleId: input.articleId,
      baselineRevisionId: baselineRevId,
      currentRevisionId: baselineRevId,
      revisionTree: { [baselineRevId]: baseline },
    };
    branches.set(branchId, branch);
    return branch;
  }

  function recordRevision(input: RecordRevisionInput): Revision {
    const branch = branches.get(input.branchId);
    if (!branch) throw new Error(`Revision branch ${input.branchId} not found`);
    const parentRevisionId = input.parentRevisionId ?? branch.currentRevisionId;
    if (!branch.revisionTree[parentRevisionId]) {
      throw new Error(`Parent revision ${parentRevisionId} not found in branch ${input.branchId}`);
    }
    const revision: Revision = {
      revisionId: newId('rev'),
      branchId: input.branchId,
      parentRevisionId,
      revisionOrigin: input.revisionOrigin,
      editorIdentityType: input.editorIdentityType,
      editorId: input.editorId,
      affectedSections: input.edits,
      editSummary: input.editSummary,
      revisionTimestamp: new Date().toISOString(),
    };
    branch.revisionTree[revision.revisionId] = revision;
    // Only advance currentRevisionId when parent was current — otherwise this is a branched edit.
    if (parentRevisionId === branch.currentRevisionId) {
      branch.currentRevisionId = revision.revisionId;
    }
    return revision;
  }

  function getBranch(branchId: string): RevisionBranch | null {
    return branches.get(branchId) ?? null;
  }

  function getRevision(branchId: string, revisionId: string): Revision | null {
    const branch = branches.get(branchId);
    if (!branch) return null;
    return branch.revisionTree[revisionId] ?? null;
  }

  function getLineage(branchId: string, revisionId: string): Revision[] {
    const branch = branches.get(branchId);
    if (!branch) return [];
    const out: Revision[] = [];
    let cursor: string | null = revisionId;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const rev = branch.revisionTree[cursor];
      if (!rev) break;
      out.push(rev);
      cursor = rev.parentRevisionId;
    }
    return out;
  }

  function rollback(input: { branchId: string; toRevisionId: string; reason: string }): RevisionBranch {
    const source = branches.get(input.branchId);
    if (!source) throw new Error(`Branch ${input.branchId} not found`);
    if (!source.revisionTree[input.toRevisionId]) {
      throw new Error(`Cannot rollback to ${input.toRevisionId} — not found in branch ${input.branchId}`);
    }
    const newBranchId = newId('rbr');
    // New branch's revisionTree is the slice of ancestry from baseline → toRevisionId.
    const lineageNewestFirst = getLineage(input.branchId, input.toRevisionId);
    const lineageOldestFirst = [...lineageNewestFirst].reverse();
    const newTree: Record<string, Revision> = {};
    for (const rev of lineageOldestFirst) {
      newTree[rev.revisionId] = { ...rev, branchId: newBranchId };
    }
    const newBaselineId = lineageOldestFirst[0]?.revisionId ?? source.baselineRevisionId;
    const newCurrentId = input.toRevisionId;
    // Add an annotation revision describing the rollback.
    const rollbackRev: Revision = {
      revisionId: newId('rev'),
      branchId: newBranchId,
      parentRevisionId: newCurrentId,
      revisionOrigin: 'recovery_pass',
      editorIdentityType: 'system',
      affectedSections: [],
      editSummary: `Rollback from branch ${source.branchId} to revision ${input.toRevisionId}: ${input.reason}`,
      revisionTimestamp: new Date().toISOString(),
    };
    newTree[rollbackRev.revisionId] = rollbackRev;

    const newBranch: RevisionBranch = {
      branchId: newBranchId,
      articleId: source.articleId,
      baselineRevisionId: newBaselineId,
      currentRevisionId: rollbackRev.revisionId,
      revisionTree: newTree,
    };
    branches.set(newBranchId, newBranch);
    return newBranch;
  }

  function listBranchesForArticle(articleId: string): RevisionBranch[] {
    const out: RevisionBranch[] = [];
    branches.forEach((b) => {
      if (b.articleId === articleId) out.push(b);
    });
    return out;
  }

  function clear(articleId?: string): void {
    if (!articleId) { branches.clear(); return; }
    branches.forEach((b, k) => {
      if (b.articleId === articleId) branches.delete(k);
    });
  }

  function size(): number {
    return branches.size;
  }

  return { startBranch, recordRevision, getBranch, getRevision, getLineage, rollback, listBranchesForArticle, clear, size };
}

let _defaultRegistry: RevisionLineageRegistry | null = null;

export function getDefaultRevisionLineageRegistry(): RevisionLineageRegistry {
  if (!_defaultRegistry) _defaultRegistry = createRevisionLineageRegistry();
  return _defaultRegistry;
}

export function setDefaultRevisionLineageRegistry(reg: RevisionLineageRegistry): void {
  _defaultRegistry = reg;
}
