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
  }
];

export const getPlatformConfig = (key: string): PlatformConfig | undefined => {
  return PLATFORM_CONFIGS.find(config => config.key === key);
}; 