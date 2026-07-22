/**
 * Timeline Profile (WS-2D Phase 2) — a dashboard-ready communication timeline.
 * Composes `intel.getTimeline` (primitive) + the shared lifecycle helper; derives
 * artifact children from the SAME fetched set (no new traversal).
 */
import { deriveLifecycleProgression } from '../registration/registrationContracts';
import type { QueryProfile, ProfileDeps } from './queryProfileFramework';
import { must } from './queryProfileFramework';
import {
  toSummary,
  type CommunicationSummary,
  type LifecycleProgressionView,
} from './profileModels';

export interface TimelineProfileRequest {
  sinceDays?: number;
  campaignId?: string | null;
  platform?: string | null;
  limit?: number;
}

export interface TimelineItem extends CommunicationSummary {
  lifecycle: LifecycleProgressionView;
  derivedArtifactIds: string[];
}

export interface TimelineProfileData {
  from: string;
  to: string;
  items: TimelineItem[];
}

export const timelineProfile: QueryProfile<TimelineProfileRequest, TimelineProfileData> = {
  type: 'timeline',
  async run(deps: ProfileDeps, companyId, req) {
    const tl = must(await deps.intel.getTimeline(companyId, {
      sinceDays: req.sinceDays,
      campaignId: req.campaignId,
      platform: req.platform,
      limit: req.limit,
    }));

    // Derived artifacts = children by parentArtifactId within the fetched window.
    const childrenByParent = new Map<string, string[]>();
    for (const r of tl.entries) {
      if (r.parentArtifactId) {
        const list = childrenByParent.get(r.parentArtifactId) ?? [];
        list.push(r.id);
        childrenByParent.set(r.parentArtifactId, list);
      }
    }

    const items: TimelineItem[] = tl.entries.map((r) => {
      const prog = deriveLifecycleProgression(r.publicationStatus);
      return {
        ...toSummary(r),
        lifecycle: { current: r.publicationStatus, completed: prog.completed, pending: prog.pending, canonical: prog.canonical },
        derivedArtifactIds: childrenByParent.get(r.id) ?? [],
      };
    });

    return { from: tl.from, to: tl.to, items };
  },
  resultCount: (d) => d.items.length,
};
