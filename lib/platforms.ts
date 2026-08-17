export interface PlatformConfig {
  key: string;
  name: string;
  color: string;
  constraints: {
    hashtagsLimit?: number;
    image: { aspectRatios?: string[] };
    textLimit?: number;
  };
}

export const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    key: "linkedin",
    name: "LinkedIn",
    color: "blue-500",
    constraints: {
      hashtagsLimit: 5,
      textLimit: 3000,
      image: { aspectRatios: ["1:1", "16:9", "4:3"] }
    }
  },
  {
    key: "twitter",
    name: "Twitter/X",
    color: "black",
    constraints: {
      hashtagsLimit: 10,
      textLimit: 280,
      image: { aspectRatios: ["16:9", "1:1"] }
    }
  },
  {
    // `x` is the normalized platform key used by the adaptation layer
    // (platformAdaptationProfiles carries BOTH `x` and `twitter` as direct
    // profiles, so normalizePlatformKey returns each unchanged rather than
    // collapsing them). getPlatformConfig is an exact-key lookup, so without
    // this entry `getPlatformConfig('x')` returned undefined — which left
    // platformVariantGenerator's `constraints.max_length` null and dropped
    // every length instruction from the X variant prompt.
    //
    // Constraints MUST mirror `twitter` above: same surface, same limits.
    key: "x",
    name: "Twitter/X",
    color: "black",
    constraints: {
      hashtagsLimit: 10,
      textLimit: 280,
      image: { aspectRatios: ["16:9", "1:1"] }
    }
  }
];

export const getPlatformConfig = (key: string): PlatformConfig | undefined => {
  return PLATFORM_CONFIGS.find(config => config.key === key);
};

/**
 * The platforms a user can pick in the UI.
 *
 * PLATFORM_CONFIGS is a LOOKUP table: it must answer for every key the system
 * can be asked about, and `x` and `twitter` are two keys the adaptation layer
 * uses for the SAME surface. Rendering the raw array in a picker would show
 * "Twitter/X" twice, so pickers select over this view instead.
 *
 * Keeping the FIRST entry per surface preserves the exact keys the scheduler
 * already submits (`linkedin`, `twitter`) — this is a presentation filter, not
 * a second source of truth, and it holds no limits of its own.
 */
export const SELECTABLE_PLATFORM_CONFIGS: PlatformConfig[] = PLATFORM_CONFIGS.filter(
  (config, index) => PLATFORM_CONFIGS.findIndex(other => other.name === config.name) === index
);