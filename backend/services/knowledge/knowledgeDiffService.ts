/**
 * knowledgeDiffService.ts — deterministic Company Knowledge diff (CKRE-003 §4).
 *
 * PURE. No AI. Compares two knowledge snapshots (entity + composed domains) and
 * returns changed domains/fields, additions, removals, confidence changes,
 * dependency impact, and the refresh source. Identical inputs → identical diff.
 */

import type { KnowledgeDomainId } from './companyKnowledgeModel';
import type { KnowledgeEntity } from './companyKnowledgeEntity';
import type { KnowledgeDomain } from './companyKnowledgeModel';

export interface KnowledgeSnapshot {
  entity: KnowledgeEntity;
  domains: Record<KnowledgeDomainId, KnowledgeDomain>;
}

export interface DomainFieldChange {
  domain: KnowledgeDomainId;
  field: string;
  kind: 'added' | 'removed' | 'changed';
}

export interface DomainConfidenceChange {
  domain: KnowledgeDomainId;
  from: number | null;
  to: number | null;
}

export interface KnowledgeDiff {
  fromVersion: number | null;
  toVersion: number;
  changedDomains: KnowledgeDomainId[];
  changedFields: DomainFieldChange[];
  added: DomainFieldChange[];
  removed: DomainFieldChange[];
  confidenceChanges: DomainConfidenceChange[];
  /** Affected fingerprint types driving the refresh (dependency impact). */
  dependencyImpact: string[];
  refreshSource: { reason: string; policy: string };
  /** True when nothing changed across any domain. */
  identical: boolean;
}

const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === '';
const stable = (v: unknown): string => {
  try { return JSON.stringify(v ?? null); } catch { return String(v); }
};

/**
 * Diff two knowledge snapshots. `prev` may be null (first version → everything
 * present is "added"). Pure + deterministic (sorted outputs).
 */
export function diffKnowledge(prev: KnowledgeSnapshot | null, next: KnowledgeSnapshot): KnowledgeDiff {
  const changedFields: DomainFieldChange[] = [];
  const added: DomainFieldChange[] = [];
  const removed: DomainFieldChange[] = [];
  const confidenceChanges: DomainConfidenceChange[] = [];
  const changedDomains = new Set<KnowledgeDomainId>();

  const domainIds = Object.keys(next.domains) as KnowledgeDomainId[];
  for (const domain of domainIds) {
    const nextFields = next.domains[domain]?.fields ?? {};
    const prevFields = prev?.domains[domain]?.fields ?? {};
    const allKeys = Array.from(new Set([...Object.keys(prevFields), ...Object.keys(nextFields)])).sort();

    for (const field of allKeys) {
      const pv = prevFields[field];
      const nv = nextFields[field];
      if (stable(pv) === stable(nv)) continue;
      changedDomains.add(domain);
      if (isEmpty(pv) && !isEmpty(nv)) added.push({ domain, field, kind: 'added' });
      else if (!isEmpty(pv) && isEmpty(nv)) removed.push({ domain, field, kind: 'removed' });
      else changedFields.push({ domain, field, kind: 'changed' });
    }

    // Confidence changes per domain.
    const pc = prev?.entity.confidence.byDomain?.[domain] ?? null;
    const nc = next.entity.confidence.byDomain?.[domain] ?? null;
    if (pc !== nc) {
      confidenceChanges.push({ domain, from: pc, to: nc });
      changedDomains.add(domain);
    }
  }

  const allChanges = [...added, ...removed, ...changedFields];
  return {
    fromVersion: prev?.entity.version ?? null,
    toVersion: next.entity.version,
    changedDomains: Array.from(changedDomains).sort(),
    changedFields: changedFields.sort(byDomainField),
    added: added.sort(byDomainField),
    removed: removed.sort(byDomainField),
    confidenceChanges: confidenceChanges.sort((a, b) => a.domain.localeCompare(b.domain)),
    dependencyImpact: [...next.entity.dependencies].sort(),
    refreshSource: { reason: next.entity.refreshReason, policy: String(next.entity.refreshPolicy) },
    identical: allChanges.length === 0 && confidenceChanges.length === 0,
  };
}

function byDomainField(a: DomainFieldChange, b: DomainFieldChange): number {
  return a.domain === b.domain ? a.field.localeCompare(b.field) : a.domain.localeCompare(b.domain);
}
