/**
 * The SINGLE publishing-resolution path.
 *
 * Every publishing entrypoint (schedule, publish-now, reschedule, campaign commit,
 * social publish) calls this — none re-implements resolution. It delegates to the
 * existing `creatorAssetServerResolver` (no independent resolution logic), normalizes
 * legacy payloads to CreatorAssetRef ONCE, emits the canonical
 * `creator_publish_ref_resolution` metric, and unions server-resolved asset media
 * with the entrypoint's non-asset media (video/draft URLs). Falls back to the legacy
 * media only when resolution genuinely yields nothing.
 */

import { resolveCreatorAssetRefsServer, normalizeServerAssetRefs } from './creatorAssetServerResolver';
import { recordCreatorRenderMetric } from '../creatorRenderObservability';

export interface PublishResolutionInput {
  companyId: string;
  userId: string;
  platform: string;
  /** New ref transport (preferred). */
  assetRefs?: unknown;
  /** Legacy attachment payloads — normalized to refs once, then resolved. */
  creatorAttachments?: unknown;
  attachments?: unknown;
  /** Non-asset / client media (video, draft images) — fallback transport only. */
  legacyMediaUrls?: unknown;
}

export interface PublishResolutionResult {
  /** Effective media: server-resolved asset media ∪ legacy media (or legacy alone on miss). */
  mediaUrls: string[];
  totalRefs: number;
  resolvedCount: number;
  usedFallback: boolean;
}

function cleanUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.map((u) => (typeof u === 'string' ? u.trim() : '')).filter((u) => u.length > 0) : [];
}

export async function resolvePublishMedia(input: PublishResolutionInput): Promise<PublishResolutionResult> {
  const refs = normalizeServerAssetRefs({ assetRefs: input.assetRefs, creatorAttachments: input.creatorAttachments, attachments: input.attachments });
  const legacy = cleanUrls(input.legacyMediaUrls);

  let resolved: Awaited<ReturnType<typeof resolveCreatorAssetRefsServer>> = [];
  if (refs.length && input.companyId && input.userId) {
    try {
      resolved = await resolveCreatorAssetRefsServer({ companyId: input.companyId, userId: input.userId, refs });
    } catch { resolved = []; }
  }
  const serverMediaUrls = Array.from(new Set(resolved.flatMap((a) => [...(a.url ? [a.url] : []), ...a.files])));
  const mediaUrls = serverMediaUrls.length ? Array.from(new Set([...legacy, ...serverMediaUrls])) : legacy;

  const totalRefs = refs.length;
  const resolvedCount = resolved.length;
  const orgResolved = Boolean(input.companyId && String(input.companyId).trim());
  if (totalRefs > 0) {
    recordCreatorRenderMetric({
      name: 'creator_publish_ref_resolution',
      tags: {
        platform: input.platform || 'unknown',
        total: String(totalRefs),
        server_resolved: String(resolvedCount),
        unresolved: String(Math.max(0, totalRefs - resolvedCount)),
        fallback: String(resolvedCount === 0 ? 1 : 0),
        // Canonical-org coverage — surfaces whether the organization id was resolved
        // (callers pass the org from resolvePublishingOrganization, never userId).
        organization_resolved: String(orgResolved ? 1 : 0),
        organization_missing: String(orgResolved ? 0 : 1),
      },
    });
  }
  return { mediaUrls, totalRefs, resolvedCount, usedFallback: totalRefs > 0 && resolvedCount === 0 };
}
