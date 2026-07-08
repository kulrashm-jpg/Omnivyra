/**
 * YouTube custom-thumbnail support (best-effort, never blocks publishing).
 *
 * A branded 1280x720 thumbnail is rendered DETERMINISTICALLY (clean composited
 * title text — never AI-baked, so no garbled glyphs) and attached to the video
 * via the YouTube Data API thumbnails.set endpoint. Both steps are fully
 * non-fatal: any failure (render error, unverified channel that can't set a
 * custom thumbnail, network) leaves YouTube's auto-generated thumbnail and the
 * video stays published.
 */
import axios from 'axios';
import sharp from 'sharp';
import { renderCreatorAssetReviewPreview } from '../services/creatorAssetRenderer';

export interface ThumbnailBrand {
  companyName?: string;
  logoUrl?: string;
  colors?: string[];
}

/**
 * Render a branded 1280x720 (16:9) JPEG thumbnail from the video title.
 * Returns null on any failure so generation can never block publishing.
 */
export async function generateBrandedYouTubeThumbnail(
  title: string,
  brand?: ThumbnailBrand,
): Promise<Buffer | null> {
  try {
    const headline = String(title || '').trim().slice(0, 80);
    if (!headline) return null;
    const { buffer } = await renderCreatorAssetReviewPreview({
      assetType: 'banner',
      platform: 'youtube',
      overlayText: { headline },
      title: headline,
      body: '',
      colors: brand?.colors,
      brand: brand?.companyName || brand?.logoUrl
        ? { companyName: brand?.companyName, logoUrl: brand?.logoUrl }
        : undefined,
    });
    // YouTube custom thumbnails must be 1280x720. Cover-fit + JPEG keeps it
    // under the 2MB limit.
    return await sharp(buffer).resize(1280, 720, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
  } catch (error) {
    console.warn('[youtube-thumbnail] generation failed (non-fatal):', (error as Error)?.message);
    return null;
  }
}

/**
 * Attach a custom thumbnail to a video (thumbnails.set). Requires the channel to
 * allow custom thumbnails (verified accounts) — a 403 simply leaves the auto
 * thumbnail. Non-fatal: returns false on any error.
 */
export async function setYouTubeThumbnail(videoId: string, jpeg: Buffer, accessToken: string): Promise<boolean> {
  try {
    const resp = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/thumbnails/set',
      jpeg,
      {
        params: { videoId },
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg' },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      },
    );
    if (resp.status >= 200 && resp.status < 300) return true;
    console.warn('[youtube-thumbnail] set failed (non-fatal):', resp.status, resp.data?.error?.message);
    return false;
  } catch (error) {
    console.warn('[youtube-thumbnail] set threw (non-fatal):', (error as Error)?.message);
    return false;
  }
}
