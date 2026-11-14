import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/activity-workspace/[id]/upload-media-authorize
 *
 * MEDIA-H3 — issues the ONLY credential a browser may use to write upload
 * bytes: a Supabase signed upload token for ONE server-minted key in the
 * PRIVATE `media-quarantine` bucket.
 *
 *   - authenticated first (401 before any lookup), then the activity's company
 *     is resolved from trusted rows and `enforceCompanyAccess` must pass;
 *   - attachment-required formats only; the declared type must be in the
 *     activity's category and the quarantine allowlist; size within the cap;
 *   - the key is `<companyId>/<activityId>/<subdir>/<128-bit stem>.<ext>`,
 *     never caller-chosen; the token is `upsert: false` (no overwrite) and
 *     Supabase expires it after 2 hours;
 *   - the abuse/rate guard used by the direct upload route applies.
 *
 * Body (JSON): { mime_type: string; size_bytes: number }
 * 200: { bucket, object_path, token, upload_session_id, resumable_endpoint }
 *
 * The returned object is NOT public and NOT used by the app until
 * `upload-media-finalize` validates and promotes it.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { tenantChildTable, tenantContextFor, TenantSeamError } from '@/backend/db/tenantTable';
import { seamDenial } from '@/backend/db/seamDenial';
import { normalizeCreatorFormat, isAttachmentRequiredFormat } from '@/lib/shared/creatorGovernanceRegistry';
import { resolveExpectedCategory } from '@/backend/services/mediaUploadValidationService';
import { checkUploadAttemptAllowed } from '@/backend/services/creatorUploadAbuseGuardService';
import { refuseIfCreatorMediaUploadsDisabled } from '@/backend/services/activityWorkspace/creatorMediaUploadGate';
import {
  QUARANTINE_BUCKET,
  QUARANTINE_ALLOWED_MIME_TYPES,
  MAX_QUARANTINE_BYTES,
  mimeCategory,
  mintQuarantineObjectPath,
  normalizeMime,
} from '@/backend/services/activityWorkspace/quarantinedMediaUpload';

export const RESUMABLE_SIGNED_ENDPOINT = '/storage/v1/upload/resumable/sign';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!id) return res.status(400).json({ error: 'daily_content_plans id is required in the path' });

  const { user } = await getSupabaseUserFromRequest(req);
  if (!user?.id) return res.status(401).json({ error: 'UNAUTHORIZED' });
  // PC5-4: uploads stay off until the bucket and policies are provisioned.
  if (refuseIfCreatorMediaUploadsDisabled(res)) return;

  const body = (req.body || {}) as { mime_type?: unknown; size_bytes?: unknown };
  const mime = normalizeMime(body.mime_type);
  const sizeBytes = typeof body.size_bytes === 'number' && Number.isFinite(body.size_bytes) ? body.size_bytes : 0;
  if (!mime) return res.status(400).json({ error: 'mime_type is required.' });
  if (!sizeBytes || sizeBytes <= 0) return res.status(400).json({ error: 'size_bytes must be > 0.' });

  // S2: this pre-authorization BOOTSTRAP read stays raw and reads ONLY the row's campaign link: the route answers a
  // failed company lookup 503 COMPANY_LOOKUP_FAILED (retryable) and a failed row read 500, which ownerOfChildRow
  // would collapse into its uniform null. The row itself is read through the seam after authorization (below).
  const { data: linkData, error: rowError } = await supabase
    .from('daily_content_plans')
    .select('campaign_id')
    .eq('id', id)
    .maybeSingle();
  if (rowError) return res.status(500).json({ error: 'Failed to load row.' });
  if (!linkData) return res.status(404).json({ error: `Row not found: ${id}` });
  const rowLink = linkData as { campaign_id: string };

  let companyId: string | null = null;
  try {
    const { data: campaignRow, error: campaignError } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', rowLink.campaign_id)
      .maybeSingle();
    if (campaignError) throw campaignError;
    companyId = (campaignRow as { company_id?: string } | null)?.company_id ?? null;
  } catch {
    return res.status(503).json({ error: 'Campaign company lookup failed. Please retry.', code: 'COMPANY_LOOKUP_FAILED' });
  }
  if (!companyId) return res.status(403).json({ error: 'Campaign company could not be resolved.' });
  const access = await enforceCompanyAccess({ req, res, companyId, campaignId: rowLink.campaign_id });
  if (!access) return;

  // S2 tenant seam: daily_content_plans is a child of campaigns. The tenant is the campaign's company that
  // enforceCompanyAccess just authorized for this principal; the handle is pinned to the row's campaign. A seam
  // refusal answers the route's existing company denial (a failed parent read: 503 via seamDenial).
  let plansTable: Awaited<ReturnType<typeof tenantChildTable>>;
  try {
    plansTable = await tenantChildTable('daily_content_plans', tenantContextFor(access, companyId), rowLink.campaign_id);
  } catch (err) {
    if (err instanceof TenantSeamError) return seamDenial(res, err, 403, { error: 'Campaign company could not be resolved.' });
    throw err;
  }
  const { data: rowData, error: rowReadError } = await plansTable
    .select('id, campaign_id, content_type')
    .eq('id', id)
    .maybeSingle();
  if (rowReadError) return res.status(500).json({ error: 'Failed to load row.' });
  if (!rowData) return res.status(404).json({ error: `Row not found: ${id}` });
  const row = rowData as { id: string; campaign_id: string; content_type: string };

  const contentType = normalizeCreatorFormat(row.content_type || '');
  const expectedCategory = isAttachmentRequiredFormat(contentType) ? resolveExpectedCategory(contentType) : null;
  if (!expectedCategory) {
    return res.status(409).json({ error: `Upload is not valid for format "${contentType}".`, code: 'UPLOAD_NOT_VALID_FOR_FORMAT' });
  }
  if (mimeCategory(mime) !== expectedCategory || !QUARANTINE_ALLOWED_MIME_TYPES.includes(mime)) {
    return res.status(415).json({
      error: `Type "${mime}" is not an allowed ${expectedCategory} type for "${contentType}".`,
      code: 'UPLOAD_MIME_MISMATCH',
    });
  }
  if (sizeBytes > MAX_QUARANTINE_BYTES) {
    return res.status(413).json({ error: `File exceeds ${MAX_QUARANTINE_BYTES} bytes.` });
  }

  const rate = await checkUploadAttemptAllowed({ userId: access.userId, companyId, dailyPlanId: id });
  if (!rate.allowed) {
    const denial = rate as { allowed: false; reason: string; retry_after_seconds?: number };
    return res.status(429).json({
      error: 'Upload rate limit exceeded or abuse detected.',
      code: String(denial.reason || 'rate_limited').toUpperCase(),
      retry_after_seconds: denial.retry_after_seconds,
    });
  }

  const { objectPath, stem } = mintQuarantineObjectPath({ companyId, activityId: id, mime });
  const { data: signed, error: signError } = await supabase.storage
    .from(QUARANTINE_BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (signError || !signed?.token) {
    console.warn('[upload-media-authorize] signed upload token failed', { daily_plan_id: id, message: signError?.message });
    return res.status(503).json({ error: 'Upload could not be authorized. Please retry.', code: 'UPLOAD_AUTHORIZE_FAILED' });
  }

  return res.status(200).json({
    bucket: QUARANTINE_BUCKET,
    object_path: objectPath,
    token: signed.token,
    upload_session_id: stem,
    resumable_endpoint: RESUMABLE_SIGNED_ENDPOINT,
  });
}

export default __createApiRoute(handler, { route: '/api/activity-workspace/:id/upload-media-authorize' });
