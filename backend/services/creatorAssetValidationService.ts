import { checkCapability } from './creatorCapabilityMap';
import type { CanonicalCreatorOutput } from './executionEngines/types';

export type AssetReadinessResult = {
  ready: boolean;
  failure_reason: string | null;
  confirmed_urls: string[];
  checks: Record<string, unknown>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getNestedObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function getNumeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMediaUrls(assetPayload: Record<string, unknown>): string[] {
  const mediaBundle = isObject(assetPayload.media_bundle) ? assetPayload.media_bundle : {};
  const urls = [
    ...(typeof assetPayload.url === 'string' ? [assetPayload.url] : []),
    ...(Array.isArray(assetPayload.files) ? assetPayload.files.filter((item): item is string => typeof item === 'string') : []),
    ...(typeof mediaBundle.url === 'string' ? [mediaBundle.url] : []),
    ...(Array.isArray(mediaBundle.files) ? mediaBundle.files.filter((item): item is string => typeof item === 'string') : []),
  ];
  return [...new Set(urls.map((item) => item.trim()).filter(Boolean))];
}

function inferFileExtension(url: string): string {
  const clean = url.split('?')[0] || url;
  const match = clean.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : '';
}

async function validateRemoteUrl(url: string): Promise<{ ok: boolean; status: number | null; contentType: string | null; contentLength: number | null }> {
  try {
    const headResponse = await fetch(url, { method: 'HEAD' });
    if (headResponse.ok) {
      return {
        ok: true,
        status: headResponse.status,
        contentType: headResponse.headers.get('content-type'),
        contentLength: getNumeric(headResponse.headers.get('content-length')),
      };
    }

    const getResponse = await fetch(url, { method: 'GET' });
    if (!getResponse.ok) {
      return {
        ok: false,
        status: getResponse.status,
        contentType: getResponse.headers.get('content-type'),
        contentLength: getNumeric(getResponse.headers.get('content-length')),
      };
    }
    return {
      ok: true,
      status: getResponse.status,
      contentType: getResponse.headers.get('content-type'),
      contentLength: getNumeric(getResponse.headers.get('content-length')),
    };
  } catch {
    return { ok: false, status: null, contentType: null, contentLength: null };
  }
}

export async function validateAssetReadiness(input: {
  output: CanonicalCreatorOutput;
  platform: string;
}): Promise<AssetReadinessResult> {
  const payload = input.output.asset_payload as Record<string, unknown>;
  const capabilityResult = checkCapability(input.platform, input.output.asset_type, payload);
  if (!capabilityResult.ok) {
    const failureReason = 'reason' in capabilityResult ? capabilityResult.reason : `Unsupported capability for ${input.platform}`;
    return {
      ready: false,
      failure_reason: failureReason,
      confirmed_urls: [],
      checks: { capability: failureReason },
    };
  }

  const mediaUrls = extractMediaUrls(payload);
  if (capabilityResult.capability.requires_remote_asset && mediaUrls.length === 0) {
    return {
      ready: false,
      failure_reason: 'Missing remote asset URLs',
      confirmed_urls: [],
      checks: { media_url_count: 0 },
    };
  }
  if (mediaUrls.length > capabilityResult.capability.max_media_items) {
    return {
      ready: false,
      failure_reason: `Too many media URLs for ${input.platform}`,
      confirmed_urls: [],
      checks: { media_url_count: mediaUrls.length, max_media_items: capabilityResult.capability.max_media_items },
    };
  }

  const aspectRatio = String((payload.aspect_ratio as string | undefined) || (payload.platform_payload as any)?.aspect_ratio || '').trim();
  if (aspectRatio && !capabilityResult.capability.accepted_aspect_ratios.includes(aspectRatio)) {
    return {
      ready: false,
      failure_reason: `Invalid aspect ratio for ${input.platform}: ${aspectRatio}`,
      confirmed_urls: [],
      checks: { aspect_ratio: aspectRatio, accepted: capabilityResult.capability.accepted_aspect_ratios },
    };
  }

  const requiredPayloadFields =
    input.output.asset_type === 'carousel'
      ? ['slides']
      : input.output.asset_type === 'image'
        ? ['visual_descriptor']
        : input.output.asset_type === 'video'
          ? ['scenes']
          : ['caption_blueprint'];
  for (const field of requiredPayloadFields) {
    if (!(field in payload)) {
      return {
        ready: false,
        failure_reason: `Missing required asset payload field: ${field}`,
        confirmed_urls: [],
        checks: { missing_field: field },
      };
    }
  }

  const platformPayload = getNestedObject(payload.platform_payload);
  const platformMetadata = getNestedObject(payload.platform_metadata);
  const mediaBundle = getNestedObject(payload.media_bundle);
  const mediaMetadata = getNestedObject(mediaBundle.metadata);
  const mergedMetadata = {
    ...platformMetadata,
    ...mediaMetadata,
  };

  const width = getNumeric(mergedMetadata.width ?? mergedMetadata.pixel_width ?? mergedMetadata.render_width);
  const height = getNumeric(mergedMetadata.height ?? mergedMetadata.pixel_height ?? mergedMetadata.render_height);
  const durationSeconds = getNumeric(payload.duration_seconds ?? platformPayload.duration ?? mergedMetadata.duration_seconds);
  const codec = typeof mergedMetadata.codec === 'string' ? mergedMetadata.codec.toLowerCase().trim() : null;
  const bitrateKbps = getNumeric(mergedMetadata.bitrate_kbps ?? mergedMetadata.video_bitrate_kbps ?? mergedMetadata.bitrate);
  const fps = getNumeric(mergedMetadata.fps ?? mergedMetadata.frame_rate);
  const hasAudio =
    typeof mergedMetadata.has_audio === 'boolean'
      ? mergedMetadata.has_audio
      : typeof mergedMetadata.audio_present === 'boolean'
        ? mergedMetadata.audio_present
        : null;

  if (Array.isArray(payload.slides) && typeof capabilityResult.capability.max_slide_count === 'number' && payload.slides.length > capabilityResult.capability.max_slide_count) {
    return {
      ready: false,
      failure_reason: `Slide count exceeds ${input.platform} maximum of ${capabilityResult.capability.max_slide_count}`,
      confirmed_urls: [],
      checks: { slide_count: payload.slides.length, max_slide_count: capabilityResult.capability.max_slide_count },
    };
  }

  if (input.output.asset_type === 'video' || input.output.asset_type === 'post_with_asset' || input.output.asset_type === 'thread_with_asset') {
    const constraints = capabilityResult.capability.video_constraints;
    if (constraints) {
      if (durationSeconds != null && constraints.min_duration_seconds != null && durationSeconds < constraints.min_duration_seconds) {
        return {
          ready: false,
          failure_reason: `Video duration below ${input.platform} minimum`,
          confirmed_urls: [],
          checks: { duration_seconds: durationSeconds, min_duration_seconds: constraints.min_duration_seconds },
        };
      }
      if (durationSeconds != null && constraints.max_duration_seconds != null && durationSeconds > constraints.max_duration_seconds) {
        return {
          ready: false,
          failure_reason: `Video duration exceeds ${input.platform} maximum`,
          confirmed_urls: [],
          checks: { duration_seconds: durationSeconds, max_duration_seconds: constraints.max_duration_seconds },
        };
      }
      if (codec && constraints.accepted_codecs && !constraints.accepted_codecs.includes(codec)) {
        return {
          ready: false,
          failure_reason: `Unsupported codec for ${input.platform}: ${codec}`,
          confirmed_urls: [],
          checks: { codec, accepted_codecs: constraints.accepted_codecs },
        };
      }
      if (bitrateKbps != null && constraints.max_bitrate_kbps != null && bitrateKbps > constraints.max_bitrate_kbps) {
        return {
          ready: false,
          failure_reason: `Video bitrate exceeds ${input.platform} maximum`,
          confirmed_urls: [],
          checks: { bitrate_kbps: bitrateKbps, max_bitrate_kbps: constraints.max_bitrate_kbps },
        };
      }
      if (fps != null && constraints.max_fps != null && fps > constraints.max_fps) {
        return {
          ready: false,
          failure_reason: `Video FPS exceeds ${input.platform} maximum`,
          confirmed_urls: [],
          checks: { fps, max_fps: constraints.max_fps },
        };
      }
      if (constraints.require_audio && hasAudio === false) {
        return {
          ready: false,
          failure_reason: `Audio track required for ${input.platform}`,
          confirmed_urls: [],
          checks: { has_audio: hasAudio },
        };
      }
      if (width != null && constraints.min_width != null && width < constraints.min_width) {
        return {
          ready: false,
          failure_reason: `Video width below ${input.platform} minimum`,
          confirmed_urls: [],
          checks: { width, min_width: constraints.min_width },
        };
      }
      if (height != null && constraints.min_height != null && height < constraints.min_height) {
        return {
          ready: false,
          failure_reason: `Video height below ${input.platform} minimum`,
          confirmed_urls: [],
          checks: { height, min_height: constraints.min_height },
        };
      }
    }
  } else {
    const constraints = capabilityResult.capability.image_constraints;
    if (constraints) {
      if (width != null && constraints.min_width != null && width < constraints.min_width) {
        return {
          ready: false,
          failure_reason: `Image width below ${input.platform} minimum`,
          confirmed_urls: [],
          checks: { width, min_width: constraints.min_width },
        };
      }
      if (height != null && constraints.min_height != null && height < constraints.min_height) {
        return {
          ready: false,
          failure_reason: `Image height below ${input.platform} minimum`,
          confirmed_urls: [],
          checks: { height, min_height: constraints.min_height },
        };
      }
    }
  }

  const confirmedUrls: string[] = [];
  for (const url of mediaUrls) {
    const extension = inferFileExtension(url);
    if (extension && !capabilityResult.capability.accepted_url_extensions.includes(extension)) {
      return {
        ready: false,
        failure_reason: `Invalid media extension for ${input.platform}: ${extension}`,
        confirmed_urls: confirmedUrls,
        checks: { accepted_extensions: capabilityResult.capability.accepted_url_extensions, url },
      };
    }
    const check = await validateRemoteUrl(url);
    if (!check.ok) {
      return {
        ready: false,
        failure_reason: `Remote asset check failed for ${url}`,
        confirmed_urls: confirmedUrls,
        checks: { url, status: check.status, content_type: check.contentType },
      };
    }
    if (check.contentType && !capabilityResult.capability.accepted_media_formats.includes(check.contentType)) {
      return {
        ready: false,
        failure_reason: `Invalid media MIME type for ${input.platform}: ${check.contentType}`,
        confirmed_urls: confirmedUrls,
        checks: { url, content_type: check.contentType, accepted_content_types: capabilityResult.capability.accepted_media_formats },
      };
    }
    const fileSizeLimit =
      input.output.asset_type === 'video' || input.output.asset_type === 'post_with_asset' || input.output.asset_type === 'thread_with_asset'
        ? capabilityResult.capability.video_constraints?.max_file_size_bytes
        : capabilityResult.capability.image_constraints?.max_file_size_bytes;
    if (fileSizeLimit != null && check.contentLength != null && check.contentLength > fileSizeLimit) {
      return {
        ready: false,
        failure_reason: `Media file size exceeds ${input.platform} maximum`,
        confirmed_urls: confirmedUrls,
        checks: { url, content_length: check.contentLength, max_file_size_bytes: fileSizeLimit },
      };
    }
    confirmedUrls.push(url);
  }

  return {
    ready: true,
    failure_reason: null,
    confirmed_urls: confirmedUrls,
    checks: {
      media_url_count: mediaUrls.length,
      aspect_ratio: aspectRatio || null,
      bitrate_kbps: bitrateKbps,
      fps,
      has_audio: hasAudio,
    },
  };
}
