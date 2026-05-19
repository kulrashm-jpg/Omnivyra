/**
 * dailyCreatorProjection — Phase-2 Step-17.
 * Daily creator workflow parity: workspace init + asset-generation
 * readiness + upload-override availability + creator guidance + approval
 * expectations + lifecycle continuity. Reuses the weekly creator projection
 * primitive (no duplication). Pure.
 */

import { projectCreator } from '../../weekly/enrichment/weeklyCreatorProjection';
import type { DailyAssetProjection } from './dailyAssetProjection';

export interface DailyCreatorProjection {
  creator_workspace_initialized: boolean;
  asset_generation_ready: boolean;
  upload_override_available: boolean;
  creator_guidance: string;
  approval_expectation: string;
  lifecycle_state: string;
  asset_family: string | null;
}

export function projectDailyCreator(
  contentType: string,
  routing: { execution_type?: string; workflow_type?: string; asset_requirement?: string; creator_requirement?: boolean } | null,
  objective: string,
  message: string,
  asset: DailyAssetProjection,
): DailyCreatorProjection | null {
  const base = projectCreator(contentType, routing, objective, message);
  if (!base) return null; // pure text — no creator workflow
  return {
    creator_workspace_initialized: true,
    asset_generation_ready: asset.ai_creatable && asset.asset_state === 'AI_READY',
    upload_override_available: asset.upload_override_available,
    creator_guidance: asset.ai_creatable
      ? 'AI-generated asset is attached by default; remove/replace to switch to manual upload.'
      : base.production_expectation,
    approval_expectation: base.requires_approval ? 'approval_required_before_schedule' : 'none',
    lifecycle_state: asset.asset_state === 'AI_READY' ? 'ai_ready' : base.lifecycle_state,
    asset_family: base.asset_family,
  };
}
