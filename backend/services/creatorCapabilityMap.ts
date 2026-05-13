export type CreatorPlatformType =
  | 'linkedin'
  | 'instagram'
  | 'x'
  | 'twitter'
  | 'tiktok'
  | 'pinterest'
  | 'facebook'
  | 'threads'
  | 'reddit';

export type CreatorAssetKind =
  | 'image'
  | 'carousel'
  | 'video';

export type CreatorPlatformCapability = {
  platform: CreatorPlatformType;
  supported_asset_types: CreatorAssetKind[];
  max_media_items: number;
  max_slide_count?: number;
  accepted_media_formats: string[];
  accepted_url_extensions: string[];
  accepted_aspect_ratios: string[];
  requires_remote_asset: boolean;
  video_constraints?: {
    min_duration_seconds?: number;
    max_duration_seconds?: number;
    max_file_size_bytes?: number;
    accepted_codecs?: string[];
    max_bitrate_kbps?: number;
    max_fps?: number;
    require_audio?: boolean;
    min_width?: number;
    min_height?: number;
  };
  image_constraints?: {
    max_file_size_bytes?: number;
    min_width?: number;
    min_height?: number;
  };
};

export const CREATOR_CAPABILITY_MAP: Record<CreatorPlatformType, CreatorPlatformCapability> = {
  linkedin: {
    platform: 'linkedin',
    supported_asset_types: ['image', 'carousel', 'video'],
    max_media_items: 9,
    max_slide_count: 9,
    accepted_media_formats: ['image/jpeg', 'image/png', 'video/mp4'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png', '.mp4'],
    accepted_aspect_ratios: ['1:1', '16:9', '9:16'],
    requires_remote_asset: true,
    video_constraints: {
      min_duration_seconds: 3,
      max_duration_seconds: 600,
      max_file_size_bytes: 536870912,
      accepted_codecs: ['h264', 'avc1'],
      max_bitrate_kbps: 30000,
      max_fps: 60,
      require_audio: false,
      min_width: 720,
      min_height: 720,
    },
    image_constraints: {
      max_file_size_bytes: 20971520,
      min_width: 1080,
      min_height: 1080,
    },
  },
  instagram: {
    platform: 'instagram',
    supported_asset_types: ['image', 'carousel', 'video'],
    max_media_items: 10,
    max_slide_count: 10,
    accepted_media_formats: ['image/jpeg', 'image/png', 'video/mp4'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png', '.mp4'],
    accepted_aspect_ratios: ['1:1', '4:5', '9:16'],
    requires_remote_asset: true,
    video_constraints: {
      min_duration_seconds: 3,
      max_duration_seconds: 900,
      max_file_size_bytes: 104857600,
      accepted_codecs: ['h264', 'avc1'],
      max_bitrate_kbps: 25000,
      max_fps: 60,
      require_audio: true,
      min_width: 1080,
      min_height: 1080,
    },
    image_constraints: {
      max_file_size_bytes: 8388608,
      min_width: 1080,
      min_height: 1080,
    },
  },
  x: {
    platform: 'x',
    supported_asset_types: ['image', 'video'],
    max_media_items: 4,
    accepted_media_formats: ['image/jpeg', 'image/png', 'video/mp4'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png', '.mp4'],
    accepted_aspect_ratios: ['1:1', '16:9'],
    requires_remote_asset: true,
    video_constraints: {
      min_duration_seconds: 1,
      max_duration_seconds: 140,
      max_file_size_bytes: 536870912,
      accepted_codecs: ['h264', 'avc1'],
      max_bitrate_kbps: 25000,
      max_fps: 60,
      require_audio: false,
      min_width: 1280,
      min_height: 720,
    },
    image_constraints: {
      max_file_size_bytes: 5242880,
      min_width: 600,
      min_height: 335,
    },
  },
  twitter: {
    platform: 'twitter',
    supported_asset_types: ['image', 'video'],
    max_media_items: 4,
    accepted_media_formats: ['image/jpeg', 'image/png', 'video/mp4'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png', '.mp4'],
    accepted_aspect_ratios: ['1:1', '16:9'],
    requires_remote_asset: true,
    video_constraints: {
      min_duration_seconds: 1,
      max_duration_seconds: 140,
      max_file_size_bytes: 536870912,
      accepted_codecs: ['h264', 'avc1'],
      max_bitrate_kbps: 25000,
      max_fps: 60,
      require_audio: false,
      min_width: 1280,
      min_height: 720,
    },
    image_constraints: {
      max_file_size_bytes: 5242880,
      min_width: 600,
      min_height: 335,
    },
  },
  tiktok: {
    platform: 'tiktok',
    supported_asset_types: ['video'],
    max_media_items: 1,
    accepted_media_formats: ['video/mp4'],
    accepted_url_extensions: ['.mp4'],
    accepted_aspect_ratios: ['9:16'],
    requires_remote_asset: true,
    video_constraints: {
      min_duration_seconds: 3,
      max_duration_seconds: 600,
      max_file_size_bytes: 536870912,
      accepted_codecs: ['h264', 'avc1'],
      max_bitrate_kbps: 25000,
      max_fps: 60,
      require_audio: true,
      min_width: 720,
      min_height: 1280,
    },
  },
  pinterest: {
    platform: 'pinterest',
    supported_asset_types: ['image', 'carousel'],
    max_media_items: 6,
    max_slide_count: 6,
    accepted_media_formats: ['image/jpeg', 'image/png'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png'],
    accepted_aspect_ratios: ['1000:1500', '2:3', '1:1'],
    requires_remote_asset: true,
    image_constraints: {
      max_file_size_bytes: 20971520,
      min_width: 1000,
      min_height: 1500,
    },
  },
  facebook: {
    platform: 'facebook',
    supported_asset_types: ['image', 'carousel'],
    max_media_items: 10,
    max_slide_count: 10,
    accepted_media_formats: ['image/jpeg', 'image/png'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png'],
    accepted_aspect_ratios: ['1:1', '4:5', '16:9'],
    requires_remote_asset: true,
    image_constraints: {
      max_file_size_bytes: 10485760,
      min_width: 1080,
      min_height: 1080,
    },
  },
  threads: {
    platform: 'threads',
    supported_asset_types: ['image'],
    max_media_items: 10,
    accepted_media_formats: ['image/jpeg', 'image/png'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png'],
    accepted_aspect_ratios: ['1:1', '4:5'],
    requires_remote_asset: true,
    image_constraints: {
      max_file_size_bytes: 8388608,
      min_width: 1080,
      min_height: 1080,
    },
  },
  reddit: {
    platform: 'reddit',
    supported_asset_types: ['image', 'carousel'],
    max_media_items: 20,
    max_slide_count: 20,
    accepted_media_formats: ['image/jpeg', 'image/png'],
    accepted_url_extensions: ['.jpg', '.jpeg', '.png'],
    accepted_aspect_ratios: ['1:1', '16:9'],
    requires_remote_asset: true,
    image_constraints: {
      max_file_size_bytes: 20971520,
      min_width: 720,
      min_height: 720,
    },
  },
};

export function normalizeCreatorPlatform(platform: string): CreatorPlatformType | null {
  const value = String(platform || '').trim().toLowerCase();
  if (value === 'twitter') return 'x';
  if (value in CREATOR_CAPABILITY_MAP) return value as CreatorPlatformType;
  return null;
}

export function checkCapability(
  platform: string,
  assetType: string,
  payload?: Record<string, unknown>
): { ok: true; capability: CreatorPlatformCapability } | { ok: false; reason: string } {
  const normalizedPlatform = normalizeCreatorPlatform(platform);
  if (!normalizedPlatform) {
    return { ok: false, reason: `Unsupported platform: ${platform}` };
  }
  const capability = CREATOR_CAPABILITY_MAP[normalizedPlatform];
  if (!capability.supported_asset_types.includes(assetType as CreatorAssetKind)) {
    return { ok: false, reason: `Unsupported combination: ${normalizedPlatform} does not support ${assetType}` };
  }
  if (payload) {
    if (typeof capability.max_slide_count === 'number' && Array.isArray(payload.slides) && payload.slides.length > capability.max_slide_count) {
      return { ok: false, reason: `Unsupported payload: ${normalizedPlatform} allows at most ${capability.max_slide_count} slides` };
    }
  }
  return { ok: true, capability };
}
