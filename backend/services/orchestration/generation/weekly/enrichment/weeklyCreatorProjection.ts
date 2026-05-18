/**
 * weeklyCreatorProjection — Phase-2 Step-12.
 *
 * Projects a structural creator-workspace shell + lifecycle/upload/approval
 * expectations from the centralized routing decision (no inline creator/
 * media branching). Returns null for pure text rows (no creator projection
 * needed → does not penalise score).
 */

export interface CreatorProjection {
  creator_workspace: {
    domain: 'creator';
    asset_family: string;
    production_status: string;
    requires_human_production: boolean;
    planning_context: { creative_objective: string; core_message: string };
    production_context: { asset_family: string; storyboard: unknown[] };
    packaging_context: { caption: string; hashtags: string[]; cta: string };
  };
  lifecycle_state: string;
  requires_upload: boolean;
  requires_approval: boolean;
  asset_family: string;
  production_expectation: string;
  score: number;
}

function assetFamily(contentType: string, routingExecType: string): string {
  const ct = String(contentType || '').toLowerCase();
  if (routingExecType === 'VIDEO_WORKFLOW' || /video|reel|short/.test(ct)) return 'video';
  if (/carousel|slide/.test(ct)) return 'carousel';
  if (/image|banner|infographic|pdf|story/.test(ct)) return 'image';
  return 'post_with_asset';
}

export function projectCreator(
  contentType: string,
  routing: { execution_type?: string; asset_requirement?: string; workflow_type?: string; creator_requirement?: boolean } | null,
  objective: string,
  message: string,
): CreatorProjection | null {
  const execType = String(routing?.execution_type ?? '');
  const isCreator = execType === 'BOLT_CREATOR' || execType === 'VIDEO_WORKFLOW' ||
    (execType === 'HYBRID' && routing?.creator_requirement === true);
  if (!isCreator) return null; // pure text — no creator projection

  const fam = assetFamily(contentType, execType);
  const requires_upload = routing?.workflow_type === 'MANUAL_UPLOAD' || execType === 'VIDEO_WORKFLOW';
  const production_status = requires_upload ? 'awaiting_human_production' : 'draft';

  // Score: family resolved + lifecycle resolved + packaging stub present.
  const score = 60 + (fam !== 'post_with_asset' ? 20 : 0) + (production_status ? 20 : 0);

  return {
    creator_workspace: {
      domain: 'creator',
      asset_family: fam,
      production_status,
      requires_human_production: requires_upload,
      planning_context: { creative_objective: objective, core_message: message },
      production_context: { asset_family: fam, storyboard: [] },
      packaging_context: { caption: objective, hashtags: [], cta: 'Encourage the next relevant step' },
    },
    lifecycle_state: requires_upload ? 'awaiting_media_upload' : 'ready_for_schedule',
    requires_upload,
    requires_approval: false,
    asset_family: fam,
    production_expectation: requires_upload
      ? 'User produces & uploads the asset; schedulable after upload.'
      : 'Omnivyra renders the asset autonomously.',
    score: Math.min(100, score),
  };
}
