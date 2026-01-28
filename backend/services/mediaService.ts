/**
 * Media Service
 * 
 * Handles media file upload, storage, and management for all content types:
 * - Images (JPG, PNG, GIF, WebP)
 * - Videos (MP4, MOV, AVI, WebM)
 * - Audio (MP3, WAV, OGG, M4A)
 * - Documents (PDF - for LinkedIn articles)
 * 
 * Features:
 * - Supabase Storage integration
 * - File validation (type, size, dimensions)
 * - Platform-specific optimization
 * - Media metadata tracking
 * - Secure file URLs
 * 
 * Environment Variables:
 * - SUPABASE_URL (required)
 * - SUPABASE_SERVICE_ROLE_KEY (required)
 */

import { supabase } from '../db/supabaseClient';

export type MediaType = 'image' | 'video' | 'audio' | 'document';

export interface MediaFile {
  id: string;
  user_id: string;
  campaign_id?: string;
  file_name: string;
  file_path: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  media_type: MediaType;
  width?: number;
  height?: number;
  duration?: number;
  storage_provider: string;
  storage_bucket: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface UploadMediaOptions {
  userId: string;
  campaignId?: string;
  file: File | Buffer;
  fileName: string;
  mimeType: string;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    [key: string]: any;
  };
}

export interface MediaValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  optimized?: {
    width?: number;
    height?: number;
    format?: string;
    quality?: number;
  };
}

/**
 * Media type validation rules
 */
const MEDIA_RULES = {
  image: {
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 10 * 1024 * 1024, // 10MB
    maxDimensions: { width: 4096, height: 4096 },
    minDimensions: { width: 100, height: 100 },
  },
  video: {
    allowedTypes: ['video/mp4', 'video/mov', 'video/quicktime', 'video/webm', 'video/avi'],
    maxSize: 500 * 1024 * 1024, // 500MB
    maxDuration: 600, // 10 minutes in seconds
    supportedFormats: ['mp4', 'mov', 'webm'],
  },
  audio: {
    allowedTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a'],
    maxSize: 50 * 1024 * 1024, // 50MB
    maxDuration: 3600, // 1 hour
    supportedFormats: ['mp3', 'wav', 'ogg', 'm4a'],
  },
  document: {
    allowedTypes: ['application/pdf'],
    maxSize: 25 * 1024 * 1024, // 25MB
    supportedFormats: ['pdf'],
  },
};

/**
 * Platform-specific media requirements
 */
const PLATFORM_MEDIA_REQUIREMENTS = {
  linkedin: {
    image: { maxSize: 5 * 1024 * 1024, formats: ['jpg', 'png'], aspectRatios: ['16:9', '1:1', '4:5'] },
    video: { maxSize: 200 * 1024 * 1024, maxDuration: 600, formats: ['mp4'], minDuration: 3 },
  },
  instagram: {
    image: { maxSize: 8 * 1024 * 1024, formats: ['jpg'], aspectRatios: ['1:1', '4:5', '16:9'] },
    video: { maxSize: 100 * 1024 * 1024, maxDuration: 60, formats: ['mp4'], minDuration: 3 },
  },
  facebook: {
    image: { maxSize: 4 * 1024 * 1024, formats: ['jpg', 'png'], aspectRatios: ['1:1', '16:9'] },
    video: { maxSize: 1024 * 1024 * 1024, maxDuration: 240, formats: ['mp4', 'mov'], minDuration: 1 },
  },
  youtube: {
    video: { maxSize: 128 * 1024 * 1024 * 1024, maxDuration: 7200, formats: ['mp4', 'mov'], minResolution: { width: 1280, height: 720 } },
  },
  twitter: {
    image: { maxSize: 5 * 1024 * 1024, formats: ['jpg', 'png', 'gif', 'webp'], aspectRatios: ['16:9', '1:1'] },
    video: { maxSize: 512 * 1024 * 1024, maxDuration: 140, formats: ['mp4'], minDuration: 0.5 },
  },
  tiktok: {
    video: { maxSize: 287 * 1024 * 1024, maxDuration: 600, formats: ['mp4'], aspectRatios: ['9:16'], minResolution: { width: 540, height: 960 } },
  },
};

/**
 * Detect media type from MIME type
 */
export function detectMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'document';
  throw new Error(`Unsupported media type: ${mimeType}`);
}

/**
 * Validate media file before upload
 */
export async function validateMedia(
  file: File | Buffer,
  mimeType: string,
  platform?: string,
  options?: { width?: number; height?: number; duration?: number }
): Promise<MediaValidation> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const mediaType = detectMediaType(mimeType);
  const rules = MEDIA_RULES[mediaType];

  // Check file size
  const fileSize = file instanceof File ? file.size : (file as Buffer).length;
  if (fileSize > rules.maxSize) {
    errors.push(`File size (${(fileSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${rules.maxSize / 1024 / 1024}MB)`);
  }

  // Check MIME type
  if (!rules.allowedTypes.includes(mimeType)) {
    errors.push(`MIME type ${mimeType} not allowed for ${mediaType}`);
  }

  // Platform-specific validation
  if (platform && PLATFORM_MEDIA_REQUIREMENTS[platform as keyof typeof PLATFORM_MEDIA_REQUIREMENTS]) {
    const platformData = PLATFORM_MEDIA_REQUIREMENTS[platform as keyof typeof PLATFORM_MEDIA_REQUIREMENTS];
    const platformRules = platformData[mediaType as keyof typeof platformData] as any;
    if (platformRules) {
      if (fileSize > platformRules.maxSize) {
        errors.push(`File size exceeds ${platform} limit (${platformRules.maxSize / 1024 / 1024}MB)`);
      }

      if (mediaType === 'image' && options?.width && options?.height) {
        // Check aspect ratio
        if (platformRules.aspectRatios) {
          const aspectRatio = (options.width / options.height).toFixed(2);
          const validRatios = platformRules.aspectRatios.map((r: string) => {
            const [w, h] = r.split(':');
            return (parseFloat(w) / parseFloat(h)).toFixed(2);
          });
          if (!validRatios.includes(aspectRatio)) {
            warnings.push(`Aspect ratio ${aspectRatio} may not be optimal for ${platform}`);
          }
        }
      }

      if (mediaType === 'video' && options?.duration) {
        if (platformRules.maxDuration && options.duration > platformRules.maxDuration) {
          errors.push(`Video duration (${options.duration}s) exceeds ${platform} limit (${platformRules.maxDuration}s)`);
        }
        if (platformRules.minDuration && options.duration < platformRules.minDuration) {
          errors.push(`Video duration (${options.duration}s) below ${platform} minimum (${platformRules.minDuration}s)`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Upload media file to Supabase Storage
 */
export async function uploadMedia(options: UploadMediaOptions): Promise<MediaFile> {
  const { userId, campaignId, file, fileName, mimeType, metadata = {} } = options;

  // Detect media type
  const mediaType = detectMediaType(mimeType);
  
  // Determine storage bucket based on media type
  const bucketName = `media-${mediaType}s`; // e.g., media-images, media-videos
  
  // Validate file
  const validation = await validateMedia(
    file,
    mimeType,
    undefined, // Platform validation done separately
    {
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
    }
  );

  if (!validation.valid) {
    throw new Error(`Media validation failed: ${validation.errors.join(', ')}`);
  }

  // Generate unique file path
  const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
  const uniqueFileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
  const filePath = `${bucketName}/${uniqueFileName}`;

  // Convert File to Buffer if needed
  let fileBuffer: Buffer;
  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer();
    fileBuffer = Buffer.from(arrayBuffer);
  } else {
    fileBuffer = file as Buffer;
  }

  // Upload to Supabase Storage
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(uniqueFileName, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    // If bucket doesn't exist, try to create it (requires admin privileges)
    if (uploadError.message.includes('Bucket not found')) {
      throw new Error(
        `Storage bucket '${bucketName}' not found. Please create it in Supabase Dashboard > Storage, or use existing bucket.`
      );
    }
    throw new Error(`Failed to upload media: ${uploadError.message}`);
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(uniqueFileName);
  const fileUrl = urlData.publicUrl;

  // Save metadata to database
  const { data: dbData, error: dbError } = await supabase
    .from('media_files')
    .insert({
      user_id: userId,
      campaign_id: campaignId || null,
      file_name: fileName,
      file_path: filePath,
      file_url: fileUrl,
      file_size: fileBuffer.length,
      mime_type: mimeType,
      media_type: mediaType,
      width: metadata.width || null,
      height: metadata.height || null,
      duration: metadata.duration || null,
      storage_provider: 'supabase',
      storage_bucket: bucketName,
      metadata: metadata,
    })
    .select()
    .single();

  if (dbError) {
    // Rollback: delete uploaded file if DB insert fails
    await supabase.storage.from(bucketName).remove([uniqueFileName]);
    throw new Error(`Failed to save media metadata: ${dbError.message}`);
  }

  return dbData as MediaFile;
}

/**
 * Get media file by ID
 */
export async function getMediaFile(mediaId: string): Promise<MediaFile | null> {
  const { data, error } = await supabase
    .from('media_files')
    .select('*')
    .eq('id', mediaId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get media file: ${error.message}`);
  }

  return data as MediaFile;
}

/**
 * Get media files for a user or campaign
 */
export async function listMediaFiles(options: {
  userId?: string;
  campaignId?: string;
  mediaType?: MediaType;
  limit?: number;
}): Promise<MediaFile[]> {
  let query = supabase.from('media_files').select('*');

  if (options.userId) {
    query = query.eq('user_id', options.userId);
  }

  if (options.campaignId) {
    query = query.eq('campaign_id', options.campaignId);
  }

  if (options.mediaType) {
    query = query.eq('media_type', options.mediaType);
  }

  query = query.order('created_at', { ascending: false });

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list media files: ${error.message}`);
  }

  return (data || []) as MediaFile[];
}

/**
 * Delete media file
 */
export async function deleteMediaFile(mediaId: string): Promise<void> {
  // Get media file info
  const mediaFile = await getMediaFile(mediaId);
  if (!mediaFile) {
    throw new Error('Media file not found');
  }

  // Delete from storage
  const fileName = mediaFile.file_path.split('/').slice(1).join('/'); // Remove bucket name
  const { error: storageError } = await supabase.storage
    .from(mediaFile.storage_bucket)
    .remove([fileName]);

  if (storageError) {
    console.warn(`Failed to delete from storage: ${storageError.message}`);
    // Continue to delete DB record even if storage deletion fails
  }

  // Delete from database
  const { error: dbError } = await supabase
    .from('media_files')
    .delete()
    .eq('id', mediaId);

  if (dbError) {
    throw new Error(`Failed to delete media file: ${dbError.message}`);
  }
}

/**
 * Link media to scheduled post
 */
export async function linkMediaToPost(
  scheduledPostId: string,
  mediaFileId: string,
  displayOrder: number = 0
): Promise<void> {
  const { error } = await supabase
    .from('scheduled_post_media')
    .insert({
      scheduled_post_id: scheduledPostId,
      media_file_id: mediaFileId,
      display_order: displayOrder,
    });

  if (error) {
    throw new Error(`Failed to link media to post: ${error.message}`);
  }
}

/**
 * Get media files for a scheduled post
 */
export async function getPostMedia(scheduledPostId: string): Promise<MediaFile[]> {
  const { data, error } = await supabase
    .from('scheduled_post_media')
    .select(`
      media_file_id,
      display_order,
      media_files (*)
    `)
    .eq('scheduled_post_id', scheduledPostId)
    .order('display_order', { ascending: true });

  if (error) {
    throw new Error(`Failed to get post media: ${error.message}`);
  }

  return (data || []).map((item: any) => item.media_files) as MediaFile[];
}

