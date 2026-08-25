import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Media Upload API
 * POST /api/media/upload
 * 
 * Uploads media files (images, videos, audio) to Supabase Storage
 * and saves metadata to database.
 * 
 * Supports:
 * - Images: JPG, PNG, GIF, WebP
 * - Videos: MP4, MOV, AVI, WebM
 * - Audio: MP3, WAV, OGG, M4A
 * - Documents: PDF
 */

import { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import { uploadMedia, validateMedia } from '../../../backend/services/mediaService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import fs from 'fs';

// Disable body parser to allow file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Parse form data using formidable
    const form = formidable({
      maxFileSize: 500 * 1024 * 1024, // 500MB max
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);

    // Get required fields
    const providedUserId = Array.isArray(fields.user_id) ? fields.user_id[0] : fields.user_id;
    const campaignId = Array.isArray(fields.campaign_id) ? fields.campaign_id[0] : fields.campaign_id;
    const platform = Array.isArray(fields.platform) ? fields.platform[0] : fields.platform;

    /*
     * OWNERSHIP IS THE AUTHENTICATED IDENTITY. Always.
     *
     * This used to prefer the browser-supplied `user_id` whenever it merely
     * LOOKED like a uuid, falling back to `user.id` only when it did not:
     *
     *     const userId = uuidPattern.test(providedUserId) ? providedUserId : user.id;
     *
     * So an authenticated caller could file an upload under any uuid it chose.
     * Phase 67 hit the benign form of that: the Creator panel sends
     * `getSupabaseBrowser().auth.getUser().id`, which on a browser whose
     * Supabase session has drifted from its server session is a DIFFERENT user.
     * The row was stored under that other id, and canonical registration then
     * correctly refused to promote a file the caller does not own — a real
     * upload silently misfiled, and unusable.
     *
     * `user.id` here is already the server-resolved principal (the same one
     * `resolveUserContext` derives), so it is the only identity that can be
     * right. The field is still ACCEPTED so existing clients keep working, but
     * it no longer decides anything: `companyProfileFormController` already
     * uploads without it, which is what proves this path is sufficient.
     *
     * A conflict is corrected rather than rejected. There is no legitimate
     * caller that needs to name another owner — every caller is a browser UI
     * uploading its own file — so a mismatch is a drifted client session, not a
     * choice. Rejecting it would break those users while protecting nothing the
     * server identity does not already protect. It is logged so the drift is
     * visible instead of silent.
     */
    const userId = user.id;
    if (typeof providedUserId === 'string' && providedUserId && providedUserId !== userId) {
      console.warn('[media-upload] ignoring client-supplied user_id; ownership is the authenticated user', {
        authenticatedUserId: userId,
      });
    }

    // Get uploaded file
    const fileArray = Array.isArray(files.file) ? files.file : files.file ? [files.file] : [];
    if (fileArray.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadedFile = fileArray[0];
    if (!uploadedFile.filepath) {
      return res.status(400).json({ error: 'Invalid file' });
    }

    // Read file
    const fileBuffer = fs.readFileSync(uploadedFile.filepath);
    const fileName = uploadedFile.originalFilename || uploadedFile.newFilename;
    const mimeType = uploadedFile.mimetype || 'application/octet-stream';

    // Get file metadata (if available)
    const metadata: any = {};
    if (fields.width) {
      metadata.width = parseInt(Array.isArray(fields.width) ? fields.width[0] : fields.width);
    }
    if (fields.height) {
      metadata.height = parseInt(Array.isArray(fields.height) ? fields.height[0] : fields.height);
    }
    if (fields.duration) {
      metadata.duration = parseFloat(Array.isArray(fields.duration) ? fields.duration[0] : fields.duration);
    }

    // Validate media
    const validation = await validateMedia(
      fileBuffer,
      mimeType,
      platform || undefined,
      metadata
    );

    if (!validation.valid) {
      // Clean up uploaded file
      fs.unlinkSync(uploadedFile.filepath);
      const reason = validation.errors.join(', ') || 'Media validation failed';
      return res.status(400).json({
        error: reason,
        message: reason,
        details: validation.errors,
        warnings: validation.warnings,
      });
    }

    // Upload media
    const mediaFile = await uploadMedia({
      userId,
      campaignId: campaignId || undefined,
      file: fileBuffer,
      fileName,
      mimeType,
      metadata,
    });

    // Clean up temp file
    fs.unlinkSync(uploadedFile.filepath);

    res.status(200).json({
      success: true,
      data: mediaFile,
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    });
  } catch (error: any) {
    console.error('Media upload error:', error);
    const reason =
      typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Failed to upload media';
    res.status(500).json({
      error: reason,
      message: reason,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/media/upload' });
