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
import fs from 'fs';

// Disable body parser to allow file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse form data using formidable
    const form = formidable({
      maxFileSize: 500 * 1024 * 1024, // 500MB max
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);

    // Get required fields
    const userId = Array.isArray(fields.user_id) ? fields.user_id[0] : fields.user_id;
    const campaignId = Array.isArray(fields.campaign_id) ? fields.campaign_id[0] : fields.campaign_id;
    const platform = Array.isArray(fields.platform) ? fields.platform[0] : fields.platform;

    if (!userId) {
      return res.status(400).json({ error: 'user_id is required' });
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
      return res.status(400).json({
        error: 'Media validation failed',
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
    res.status(500).json({
      error: 'Failed to upload media',
      message: error.message,
    });
  }
}

