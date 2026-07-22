/**
 * Communication Query Profiles — shared response models (WS-2D, Zone A2).
 *
 * Common DTOs extracted so no two profiles redefine the same shape (Phase 9). All
 * read-side; no platform contracts. Types + tiny pure mappers only.
 */
import type { CommunicationIntent } from '../../../../platform/intelligence';
import type {
  ArtifactType,
  CommunicationRecord,
  PublicationStatus,
} from '../coordinationContracts';
import type { CommunicationLifecycleState } from '../registration/registrationContracts';

export type ProfileType = 'timeline' | 'continuity' | 'campaign' | 'semantic' | 'analytics' | 'audit';

/** The canonical, compact view of a communication reused across profiles. */
export interface CommunicationSummary {
  id: string;
  communicationIntent: CommunicationIntent;
  topic: string;
  platform: string | null;
  campaignId: string | null;
  semanticRootId: string;
  publicationStatus: PublicationStatus;
  artifactType?: ArtifactType;
  parentArtifactId?: string | null;
  observedAt: string;
}

export function toSummary(r: CommunicationRecord): CommunicationSummary {
  return {
    id: r.id,
    communicationIntent: r.communicationIntent,
    topic: r.topic,
    platform: r.platform ?? null,
    campaignId: r.campaignId ?? null,
    semanticRootId: r.semanticRootId,
    publicationStatus: r.publicationStatus,
    artifactType: r.artifactType,
    parentArtifactId: r.parentArtifactId ?? null,
    observedAt: r.observedAt,
  };
}

/** A generic count-by-key distribution, reused by the Analytics/Campaign profiles. */
export interface DistributionBucket { key: string; count: number }

export function distribution(keys: Array<string | null | undefined>, unknownLabel = 'unknown'): DistributionBucket[] {
  const m = new Map<string, number>();
  for (const k of keys) {
    const key = k && k.length ? k : unknownLabel;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Monotonic lifecycle progression view (derived, not from a transition log). */
export interface LifecycleProgressionView {
  current: PublicationStatus;
  completed: CommunicationLifecycleState[];
  pending: CommunicationLifecycleState[];
  canonical: boolean;
}

// ── Response envelope (every profile returns this) ───────────────────────────

export interface ProfileResponseMeta {
  profileType: ProfileType;
  companyId: string;
  resultCount: number;
  degraded: boolean;
}

export interface ProfileResponse<T> {
  meta: ProfileResponseMeta;
  data: T;
}
