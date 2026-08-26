import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/creator-assets/composition — Content Creator's canonical asset surface.
 *
 *   GET    ?company_id&composition_id            → { items: [{ reference, asset }] }
 *   POST   { company_id, composition_id, media_file_id, purpose,
 *            replaces_reference_id?, instruction?, ai_proposed? }
 *            register the upload as a canonical asset, then give it that
 *            purpose — DISPLACING whatever held the purpose before, because a
 *            purpose holds one asset and "replace" must not mean "append"
 *   PATCH  { company_id, composition_id, reference_id, asset_id, purpose,
 *            instruction?, ai_proposed? }
 *            change how an attached asset is used (no re-upload)
 *   DELETE ?company_id&reference_id              → detach (asset survives)
 *
 * Deliberately narrow. This is Content Creator's seam, not a general asset API:
 * Writer, campaigns and the workspace get their own entry points when their
 * phases land, reusing the same two canonical services underneath. A generic
 * "asset API" now would be a guess at four flows that have not been designed.
 *
 * The client never names a bucket or a storage path — it names a `media_files`
 * id from the existing upload response, and the server reads the rest. Every
 * write goes through the canonical services; nothing here touches a table.
 *
 * Static path (dynamic [id] routes are unreliable in this dev environment) —
 * the same convention as the neighbouring creator-assets routes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '@/backend/services/userContextService';
import {
  registerUploadedMediaAsset,
  listCreatorCompositionAssetsResolved,
  detachCreatorCompositionAsset,
  changeCreatorCompositionAssetUsage,
  replaceCreatorCompositionAssetForPurpose,
} from '@/backend/services/creator/creatorCompositionAssetService';
import { isCreatorAssetUsagePurpose } from '@/lib/content/creatorCompositionAsset';

const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The instruction, shaped for the reference's `metadata` JSONB.
 *
 * Returns undefined rather than an empty object when nothing was typed, so an
 * absent instruction leaves existing metadata untouched instead of writing a
 * key that means "the user said nothing".
 */
function instructionMetadata(raw: unknown, aiProposed?: unknown): Record<string, unknown> | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const meta: Record<string, unknown> = {};
  if (text) meta.userInstruction = text.slice(0, 400);
  /*
   * Provenance, not semantics. Records that the treatment was OUR suggestion
   * rather than the user's own pick, so a later template change can tell the
   * two apart. Nothing routes on it — purpose remains the only routing input.
   */
  if (aiProposed === true) meta.aiProposed = true;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Service failures are operator-facing messages, not stack traces. A missing or
 * foreign asset is 404 rather than 403 so the endpoint cannot be used to probe
 * for ids belonging to another tenant; a not-ready asset is 409 because the
 * caller can fix it by waiting or re-uploading.
 */
function fail(res: NextApiResponse, err: unknown) {
  const message = err instanceof Error ? err.message : 'Request failed';
  const status = /not found/i.test(message) ? 404
    : /not ready|lifecycle/i.test(message) ? 409
      : /required|not one Content Creator offers|Only image|is not allowed for purpose/i.test(message) ? 400
        : 500;
  return res.status(status).json({ error: message });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method || '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = str(req.body?.company_id) || str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  // Tenancy is proven server-side. The browser's company id is a request, not
  // an authorization: this rejects it when the caller is not an active member.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  if (req.method === 'GET') {
    const compositionId = str(req.query.composition_id);
    if (!compositionId) return res.status(400).json({ error: 'composition_id required' });
    try {
      return res.status(200).json({ items: await listCreatorCompositionAssetsResolved(companyId, compositionId) });
    } catch (err) { return fail(res, err); }
  }

  if (req.method === 'DELETE') {
    const referenceId = str(req.query.reference_id) || str(req.body?.reference_id);
    if (!referenceId) return res.status(400).json({ error: 'reference_id required' });
    try {
      await detachCreatorCompositionAsset(companyId, referenceId);
      return res.status(200).json({ success: true });
    } catch (err) { return fail(res, err); }
  }

  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const compositionId = str(req.body?.composition_id);
  if (!compositionId) return res.status(400).json({ error: 'composition_id required' });

  // Every remaining write names a usage, so the vocabulary is checked once here.
  const purpose = str(req.body?.purpose);
  if (!isCreatorAssetUsagePurpose(purpose)) {
    return res.status(400).json({ error: 'purpose is not one Content Creator offers' });
  }

  if (req.method === 'PATCH') {
    const referenceId = str(req.body?.reference_id);
    const assetId = str(req.body?.asset_id);
    if (!referenceId || !assetId) {
      return res.status(400).json({ error: 'reference_id and asset_id required' });
    }
    try {
      const reference = await changeCreatorCompositionAssetUsage({
        companyId, compositionId, referenceId, assetId, purpose,
        metadata: instructionMetadata(req.body?.instruction, req.body?.ai_proposed),
      });
      return res.status(200).json({ reference });
    } catch (err) { return fail(res, err); }
  }

  // POST — register the already-uploaded file, then attach it.
  const mediaFileId = str(req.body?.media_file_id);
  if (!mediaFileId) return res.status(400).json({ error: 'media_file_id required' });
  try {
    // Registration first. If it fails there is no reference to unwind, and the
    // caller learns the upload never became a usable asset rather than seeing a
    // selection that only looks valid.
    const asset = await registerUploadedMediaAsset({ companyId, userId: user.userId, mediaFileId });
    // Replace, not append: the panel shows ONE asset per purpose, so a second
    // upload into the same purpose used to leave an invisible reference behind
    // that still reached the render.
    const { reference, replacedReferenceIds } = await replaceCreatorCompositionAssetForPurpose({
      companyId, compositionId, assetId: asset.id, purpose,
      // A single-image surface replacing its one attachment says so, so the old
      // reference cannot survive under a different usage.
      replacesReferenceId: str(req.body?.replaces_reference_id) || null,
      // The user's own words about this image, kept on the reference's existing
      // metadata. Optional, and absent means exactly today's behaviour.
      metadata: instructionMetadata(req.body?.instruction, req.body?.ai_proposed),
    });
    return res.status(200).json({ asset, reference, replaced_reference_ids: replacedReferenceIds });
  } catch (err) { return fail(res, err); }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-assets/composition' });
