import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/campaigns/[id]/ai-asset-mutation
 * Phase-2 Step-22 — REAL AI-asset override mutation.
 *
 * Writes an additive `ai_asset_override` block into the execution content
 * blob via the canonical orchestration write layer
 * (updateExecutionContentByActivity → reconciled, stale-safe, fires state
 * synchronization → readiness recalculates). NO DB migration (mirrors the
 * creator_lifecycle content-blob pattern). Provenance / AI lineage is
 * preserved verbatim and the prior AI asset is captured so Restore is
 * lossless.
 *
 * Video/manual is never reached: only AI-creatable executions carry an
 * `ai_asset` projection; the runtime/routing already exclude video.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import { updateExecutionContentByActivity, orchestrationEvents } from '../../../../backend/services/orchestration';

type Action = 'remove' | 'restore' | 'mark_uploaded' | 'mark_replaced';

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { id } = req.query;
  const campaignId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;

  const body = obj(req.body);
  const executionId = String(body.execution_id ?? '').trim();
  const action = String(body.action ?? '').trim() as Action;
  const asset = obj(body.asset);
  if (!executionId) return res.status(400).json({ error: 'Missing execution_id' });
  if (!['remove', 'restore', 'mark_uploaded', 'mark_replaced'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const now = new Date().toISOString();

  try {
    const result = await updateExecutionContentByActivity(
      executionId,
      (existing) => {
        // Capture prior AI lineage ONCE so repeated overrides stay lossless.
        const priorOverride = obj(existing.ai_asset_override);
        const prior =
          priorOverride.prior !== undefined
            ? priorOverride.prior
            : (existing.ai_asset ?? null);

        let next: Record<string, unknown>;
        if (action === 'restore') {
          // Restore = clear the override (signals resolve back to AI).
          next = { state: 'RESTORED', restored_at: now, prior };
        } else if (action === 'remove') {
          next = { state: 'USER_REMOVED', removed_at: now, prior };
        } else {
          next = {
            state: action === 'mark_uploaded' ? 'USER_UPLOADED' : 'USER_REPLACED',
            url: typeof asset.url === 'string' ? asset.url : null,
            files: Array.isArray(asset.files) ? asset.files.map(String) : [],
            thumbnail: typeof asset.thumbnail === 'string' ? asset.thumbnail : null,
            asset_id: typeof asset.asset_id === 'string' ? asset.asset_id : null,
            uploaded_at: now,
            prior,
          };
        }
        // Additive only — provenance, ai_asset, creator lineage untouched.
        return { ...existing, ai_asset_override: next };
      },
      'aiAssetMutation:step22',
    );

    // eslint-disable-next-line no-console
    console.log('[AI_ASSET_MUTATION]', JSON.stringify({
      campaign_id: access.campaignId,
      execution_id: executionId,
      mutation_type: action,
      hydration_success: result.ok,
      reason: result.ok ? null : result.reason ?? 'write_failed',
    }));

    if (!result.ok) {
      return res.status(409).json({ error: result.reason ?? 'mutation_failed', ok: false });
    }

    // Step-23: push the mutation outcome so every open card for this
    // campaign hydrates immediately (event-driven, no reload/focus).
    const evCommon = {
      executionId,
      provenanceSummary: { changed_fields: result.changed_fields ?? [] },
    };
    if (action === 'remove') {
      orchestrationEvents.aiAssetRemoved(access.campaignId, { ...evCommon, assetState: 'USER_REMOVED' });
    } else if (action === 'restore') {
      orchestrationEvents.aiAssetRestored(access.campaignId, { ...evCommon, assetState: 'AI_GENERATED' });
    } else {
      orchestrationEvents.aiAssetReplaced(access.campaignId, {
        ...evCommon,
        assetState: action === 'mark_uploaded' ? 'USER_UPLOADED' : 'USER_REPLACED',
      });
    }
    orchestrationEvents.orchestrationRefresh(access.campaignId, { executionId });

    return res.status(200).json({
      ok: true,
      campaign_id: access.campaignId,
      execution_id: executionId,
      action,
      changed_fields: result.changed_fields ?? [],
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('[AI_ASSET_REFRESH_FAIL]', JSON.stringify({
      campaign_id: access.campaignId, execution_id: executionId, mutation_type: action,
      reason: (e as Error)?.message ?? 'exception',
    }));
    return res.status(500).json({ error: (e as Error)?.message ?? 'mutation_exception', ok: false });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/ai-asset-mutation' });
