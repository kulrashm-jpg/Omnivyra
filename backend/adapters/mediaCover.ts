/**
 * Branded video-cover generation for platforms that accept a custom cover IMAGE
 * URL (e.g. Instagram Reels `cover_url`). The cover is rendered DETERMINISTICALLY
 * (clean composited title text — never AI-baked, so no garbled glyphs), hosted in
 * public storage, and its URL returned. Fully non-fatal: any failure returns null
 * so the caller falls back to a frame cover / the platform's auto cover.
 */
import { createHash } from 'crypto';
import sharp from 'sharp';
import { supabase } from '../db/supabaseClient';
import { renderCreatorAssetReviewPreview } from '../services/creatorAssetRenderer';

const COVER_BUCKET = 'media-images';

export interface CoverBrand {
  companyName?: string;
  logoUrl?: string;
  colors?: string[];
}

/**
 * Render a branded cover at the given size and host it publicly. Returns a public
 * URL or null (non-fatal). Default size is 1080x1920 (9:16, Instagram Reels).
 */
export async function generateHostedBrandedCover(
  title: string,
  brand?: CoverBrand,
  size: { width: number; height: number } = { width: 1080, height: 1920 },
): Promise<string | null> {
  try {
    const headline = String(title || '').trim().slice(0, 80);
    if (!headline) return null;
    const { buffer } = await renderCreatorAssetReviewPreview({
      assetType: 'banner',
      platform: 'instagram',
      overlayText: { headline },
      title: headline,
      body: '',
      colors: brand?.colors,
      brand: brand?.companyName || brand?.logoUrl
        ? { companyName: brand?.companyName, logoUrl: brand?.logoUrl }
        : undefined,
    });
    const jpeg = await sharp(buffer).resize(size.width, size.height, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
    const digest = createHash('sha1').update(jpeg).digest('hex').slice(0, 12);
    const objectPath = `covers/${digest}.jpg`;
    const { error } = await supabase.storage
      .from(COVER_BUCKET)
      .upload(objectPath, jpeg, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
    if (error) {
      console.warn('[media-cover] upload failed (non-fatal):', error.message);
      return null;
    }
    const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(objectPath);
    return data?.publicUrl ?? null;
  } catch (error) {
    console.warn('[media-cover] generation failed (non-fatal):', (error as Error)?.message);
    return null;
  }
}
