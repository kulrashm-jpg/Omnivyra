/**
 * Refining the creative an activity already has.
 *
 * WHAT THIS CLOSES
 * ----------------
 * Phase 64B made an activity's creative visible and gave refinements a durable
 * home to attach references to. This is the other half: taking those accepted
 * references through the rendering path that already exists and recording the
 * result as a NEW VERSION of the same asset.
 *
 * THE ONE THING THAT MATTERS MOST
 * -------------------------------
 * The campaign's original creative must survive. It is what was reviewed, and
 * possibly what was scheduled, so a refinement that overwrote it would destroy
 * history to produce a preview. The `creator_assets.library` envelope already
 * models exactly this — `versions[]` plus a `currentVersion` pointer, with an
 * `op` naming what each version was — so refinement APPENDS. Version 1 stays
 * where it is, and stays readable, forever.
 *
 * WHAT IT REUSES, ENTIRELY
 * ------------------------
 *   ownership + creative        activityCreativeService
 *   reference resolution        the orchestrator's existing composition path
 *   rendering                   runCreatorOrchestration — the canonical entry
 *   versioning                  libraryReadAsset / libraryWriteAsset envelope
 *
 * It renders nothing itself, reads no storage bytes, mints no URL, and knows
 * nothing about the stock-image picker beside it on the card.
 */

import { resolveActivityCreative, activityCreativeIsRefinable } from './activityCreativeService';
import { libraryReadAsset, libraryWriteAsset } from '../creatorAssetPersistenceService';
import { ownedDbTable } from '../../db/writeOwner';

export type RefinementFailureReason =
  | 'activity_not_found'
  | 'not_refinable'
  | 'render_failed'
  | 'asset_unavailable';

export interface RefinementResult {
  ok: boolean;
  activityId: string;
  compositionId: string | null;
  creatorAssetId: string | null;
  /** The version this refinement became. Null when nothing was recorded. */
  version: number | null;
  /** Always 1 — the campaign's own render. Null when there is no envelope. */
  originalVersion: number | null;
  urls: string[];
  reason: RefinementFailureReason | null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const p = JSON.parse(value);
      return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

const compact = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const failure = (
  activityId: string,
  reason: RefinementFailureReason,
  compositionId: string | null = null,
): RefinementResult => ({
  ok: false, activityId, compositionId, creatorAssetId: null,
  version: null, originalVersion: null, urls: [], reason,
});

/**
 * Append a refinement to an asset's version history.
 *
 * `op: 'version'` is the envelope's own word for "another take on this asset",
 * already understood by the client library's register/version/duplicate/restore
 * logic. Using it means the refined result appears wherever versions already
 * appear, and `restore` already knows how to go back — no second recovery path
 * had to be invented.
 *
 * Returns null when there is no envelope to append to, which the caller reports
 * rather than papering over: a refinement that rendered but could not be
 * recorded is not a success.
 */
/** How many times a refinement re-reads and re-appends after losing a race. */
const APPEND_CONFLICT_RETRIES = 2;

/**
 * Append this refinement as the next version.
 *
 * CONCURRENCY
 * -----------
 * This is read-modify-write over a single JSONB envelope, so two refinements
 * of the same activity can both read vN and both compute vN+1. The write is
 * therefore a compare-and-set on the version it was derived from: if another
 * refinement landed in between, the write is refused and we re-read and
 * re-append on top of the newer state rather than replacing it.
 *
 * Both refinements are real work a user asked for, so the right outcome is two
 * distinct recoverable versions — not a conflict thrown back at whoever was
 * slower. Retries are bounded; if the row is genuinely too hot we fail rather
 * than loop, and the caller reports an honest failure instead of a version
 * that silently overwrote someone else's.
 */
async function appendRefinedVersion(input: {
  companyId: string;
  userId: string | null;
  assetId: string;
  payload: Record<string, unknown>;
}): Promise<{ version: number; originalVersion: number } | null> {
  for (let attempt = 0; ; attempt += 1) {
    const record = await libraryReadAsset({ companyId: input.companyId, assetId: input.assetId });
    const envelope = asObject((record as unknown as Record<string, unknown> | null)?.library ?? record ?? null);
    const versions = Array.isArray(envelope.versions) ? envelope.versions as Record<string, unknown>[] : [];
    if (!envelope.id || versions.length === 0) return null;

    const highest = versions.reduce((max, v) => Math.max(max, Number(v.version) || 0), 0);
    const nextVersion = highest + 1;
    // Guard on what the stored envelope says is current, which is what the CAS
    // filter compares against. Fall back to the highest version for envelopes
    // written before `currentVersion` was carried.
    const expectedCurrentVersion = Number(envelope.currentVersion ?? highest);
    const nextEnvelope: Record<string, unknown> = {
      ...envelope,
      currentVersion: nextVersion,
      versions: [
        ...versions,
        {
          version: nextVersion,
          op: 'version',
          payload: input.payload,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    try {
      await libraryWriteAsset({
        companyId: input.companyId,
        userId: input.userId || '',
        envelope: nextEnvelope,
        expectedCurrentVersion,
      });
    } catch (err: unknown) {
      // Lost the race: someone else's version landed first. Re-read and append
      // after theirs — never overwrite it.
      if (isLibraryVersionConflict(err) && attempt < APPEND_CONFLICT_RETRIES) continue;
      if (isLibraryVersionConflict(err)) return null;
      throw err;
    }

    // The campaign's own render is always version 1 — that is what "original"
    // means here, and it is never rewritten.
    return { version: nextVersion, originalVersion: 1 };
  }
}

/** Structural check — survives the error crossing a module/mock boundary. */
function isLibraryVersionConflict(err: unknown): boolean {
  return Boolean(err) && (err as { name?: string }).name === 'LibraryVersionConflictError';
}

/**
 * Render a refinement of this activity's creative and record it as a version.
 *
 * The accepted references are NOT passed in: they are resolved by the
 * orchestrator from `compositionId`, through the same resolver, routing,
 * tenancy and lifecycle checks every other render uses. That is deliberate —
 * this service must not become a second place where a reference can be
 * interpreted.
 *
 * On any failure the envelope is left untouched, so the original stays current
 * and the user is told the truth instead of shown a new version that is not
 * there.
 */
export async function refineActivityCreative(input: {
  companyId: string | null | undefined;
  userId: string | null | undefined;
  activityId: string | null | undefined;
}): Promise<RefinementResult> {
  const companyId = compact(input.companyId);
  const activityId = compact(input.activityId);
  if (!companyId || !activityId) return failure(activityId, 'activity_not_found');

  // Ownership, and the activity's own creative. Company-scoped throughout.
  const creative = await resolveActivityCreative({ companyId, activityId });
  if (!creative) return failure(activityId, 'activity_not_found');
  if (!activityCreativeIsRefinable(creative)) {
    return failure(activityId, 'not_refinable', creative.compositionId);
  }

  // The activity supplies its own brief. Nothing is invented: these are the
  // fields the campaign generation already wrote onto the row.
  const { data: row } = await ownedDbTable('daily_content_plans')
    .select('id, campaign_id, content, asset_type')
    .eq('id', activityId)
    .maybeSingle();
  const content = asObject((row as Record<string, unknown> | null)?.content);
  const topic = compact(content.title) || compact(content.topic) || compact(content.description) || 'Refined creative';
  const platform = compact(content.platform) || compact(content.primary_platform) || 'linkedin';
  const contentType = compact(creative.assetType) || compact(content.asset_type) || 'image';

  let orchestrated: { output?: unknown } | null = null;
  try {
    const { runCreatorOrchestration } = await import('./creatorOrchestrator');
    orchestrated = await runCreatorOrchestration({
      campaignId: creative.campaignId || activityId,
      companyId,
      userId: compact(input.userId) || null,
      topic,
      contentType,
      targetPlatforms: [platform],
      /*
       * THE point of the whole phase: the render resolves this activity's own
       * accepted references, because the composition is the activity. Not a
       * browser session's token, and not another activity's.
       */
      compositionId: creative.compositionId,
    } as Parameters<typeof runCreatorOrchestration>[0]);
  } catch {
    // A failed render must cost the user nothing. The original stays current.
    return failure(activityId, 'render_failed', creative.compositionId);
  }

  const output = asObject((orchestrated as Record<string, unknown> | null)?.output);
  if (!output || Object.keys(output).length === 0) {
    return failure(activityId, 'render_failed', creative.compositionId);
  }

  const appended = await appendRefinedVersion({
    companyId,
    userId: compact(input.userId) || null,
    assetId: creative.creatorAssetId!,
    payload: {
      ...asObject(output.asset_payload),
      refinedFromActivityId: activityId,
      compositionId: creative.compositionId,
    },
  });
  if (!appended) return failure(activityId, 'asset_unavailable', creative.compositionId);

  const rendered = asObject(asObject(output.metadata).rendered_asset);
  return {
    ok: true,
    activityId,
    compositionId: creative.compositionId,
    creatorAssetId: creative.creatorAssetId,
    version: appended.version,
    originalVersion: appended.originalVersion,
    urls: Array.isArray(rendered.urls)
      ? rendered.urls.filter((u): u is string => typeof u === 'string' && Boolean(u))
      : [],
    reason: null,
  };
}
