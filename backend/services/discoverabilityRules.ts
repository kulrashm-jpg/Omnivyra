export type DiscoverabilityTargets = {
  hashtagMin: number;
  hashtagMax: number;
  hashtagRecommended: number;
  youtubeTagsMax?: number;
};

const PLATFORM_DISCOVERABILITY_TARGETS: Record<string, DiscoverabilityTargets> = {
  linkedin: {
    hashtagMin: 3,
    hashtagMax: 5,
    hashtagRecommended: 4,
  },
  instagram: {
    hashtagMin: 18,
    hashtagMax: 25,
    hashtagRecommended: 22,
  },
  facebook: {
    hashtagMin: 5,
    hashtagMax: 12,
    hashtagRecommended: 8,
  },
  x: {
    hashtagMin: 1,
    hashtagMax: 2,
    hashtagRecommended: 2,
  },
  twitter: {
    hashtagMin: 1,
    hashtagMax: 2,
    hashtagRecommended: 2,
  },
  youtube: {
    hashtagMin: 8,
    hashtagMax: 15,
    hashtagRecommended: 12,
    youtubeTagsMax: 50,
  },
};

const DEFAULT_DISCOVERABILITY_TARGET: DiscoverabilityTargets = {
  hashtagMin: 3,
  hashtagMax: 5,
  hashtagRecommended: 4,
};

export function getDiscoverabilityTargets(platform: string): DiscoverabilityTargets {
  const key = String(platform || '').trim().toLowerCase();
  return PLATFORM_DISCOVERABILITY_TARGETS[key] || DEFAULT_DISCOVERABILITY_TARGET;
}

