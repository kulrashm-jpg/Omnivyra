/**
 * knowledgeVersionSelector.ts — deterministic version resolution (CKC-001 §5).
 *
 * Resolves a KnowledgeVersionSelector to a concrete (entity, domains,
 * currentActiveVersion) by delegating to the EXISTING Company Knowledge API
 * (CKRE-003). It reads knowledge; it never composes or stores it.
 *
 * Strategies: latest | approved (current ACTIVE) | specific | rollback | preview
 * | comparison (serves the toVersion snapshot; the diff stays available via the
 * existing diffKnowledgeVersions API).
 */

import type { KnowledgeDomain, KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';
import type { KnowledgeEntity } from '../knowledge/companyKnowledgeEntity';
import { getCurrentKnowledge, getKnowledgeByVersion } from '../knowledge/companyKnowledgeService';
import { getKnowledgeState } from '../crawl/knowledgeVersionStore';
import type { KnowledgeVersionSelector } from './knowledgeContextContracts';

export interface ResolvedKnowledge {
  entity: KnowledgeEntity;
  domains: Record<KnowledgeDomainId, KnowledgeDomain>;
  currentActiveVersion: number;
  /** The selector strategy that produced this (for cache keys / events). */
  selected: string;
}

/** Deterministic string form of a selector (stable cache-key component). */
export function selectorKey(sel: KnowledgeVersionSelector | undefined): string {
  const s = sel ?? { kind: 'latest' };
  switch (s.kind) {
    case 'latest':     return 'latest';
    case 'approved':   return 'approved';
    case 'specific':   return `specific:${s.version}`;
    case 'rollback':   return `rollback:${s.version}`;
    case 'preview':    return `preview:${s.version}`;
    case 'comparison': return `comparison:${s.fromVersion ?? 'none'}:${s.toVersion}`;
    default:           return 'latest';
  }
}

/** Resolve the selector to concrete knowledge. Returns null when unavailable. Never throws. */
export async function resolveKnowledgeForSelector(
  companyId: string,
  sel: KnowledgeVersionSelector | undefined,
): Promise<ResolvedKnowledge | null> {
  if (!companyId) return null;
  const selector = sel ?? { kind: 'latest' as const };
  try {
    const currentActiveVersion = (await getKnowledgeState(companyId)).version?.version ?? 0;

    // latest / approved → the current active/live knowledge.
    if (selector.kind === 'latest' || selector.kind === 'approved') {
      const cur = await getCurrentKnowledge(companyId);
      if (!cur) return null;
      return { entity: cur.entity, domains: cur.domains, currentActiveVersion, selected: selectorKey(selector) };
    }

    // A specific stored version (specific | rollback | preview | comparison.toVersion).
    const version = selector.kind === 'comparison' ? selector.toVersion : selector.version;
    const snap = await getKnowledgeByVersion(companyId, version);
    if (!snap) {
      // Preview/comparison of a non-captured version → fall back to current (safe, non-throwing).
      const cur = await getCurrentKnowledge(companyId);
      if (!cur) return null;
      return { entity: cur.entity, domains: cur.domains, currentActiveVersion, selected: `${selectorKey(selector)}:fallback_current` };
    }
    return { entity: snap.entity, domains: snap.domains, currentActiveVersion, selected: selectorKey(selector) };
  } catch {
    return null;
  }
}
