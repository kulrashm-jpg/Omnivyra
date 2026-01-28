// Platform-specific content guidelines and marketing optimization
export interface PlatformContentGuidelines {
  platform: string;
  contentTypes: ContentType[];
  hashtagLimits: {
    max: number;
    recommended: number;
    minForReach: number;
  };
  characterLimits: {
    max: number;
    optimal: number;
    minForEngagement: number;
  };
  mediaRequirements: {
    image: MediaRequirement;
    video: MediaRequirement;
    audio?: MediaRequirement;
  };
  postingTimes: string[];
  engagementTips: string[];
  algorithmPreferences: string[];
}

export interface ContentType {
  type: string;
  name: string;
  description: string;
  characterLimit: number;
  hashtagLimit: number;
  mediaRequired: boolean;
  marketingTips: string[];
}

export interface MediaRequirement {
  aspectRatio: string;
  minResolution: string;
  maxFileSize: string;
  formats: string[];
  duration?: {
    min: string;
    max: string;
    optimal: string;
  };
}

export const PLATFORM_GUIDELINES: Record<string, PlatformContentGuidelines> = {
  linkedin: {
    platform: 'linkedin',
    contentTypes: [
      {
        type: 'post',
        name: 'LinkedIn Post',
        description: 'Professional updates and insights',
        characterLimit: 3000,
        hashtagLimit: 5,
        mediaRequired: false,
        marketingTips: [
          'Use professional tone',
          'Include industry insights',
          'Ask engaging questions',
          'Share personal experiences',
          'Use data and statistics'
        ]
      },
      {
        type: 'article',
        name: 'LinkedIn Article',
        description: 'Long-form professional content',
        characterLimit: 125000,
        hashtagLimit: 3,
        mediaRequired: false,
        marketingTips: [
          'Write comprehensive guides',
          'Include actionable insights',
          'Use professional formatting',
          'Add relevant images',
          'End with clear call-to-action'
        ]
      },
      {
        type: 'video',
        name: 'LinkedIn Video',
        description: 'Professional video content',
        characterLimit: 2000,
        hashtagLimit: 5,
        mediaRequired: true,
        marketingTips: [
          'Keep videos under 10 minutes',
          'Start with hook in first 3 seconds',
          'Include captions',
          'Use professional lighting',
          'End with clear CTA'
        ]
      },
      {
        type: 'audio',
        name: 'LinkedIn Audio Event',
        description: 'Live audio discussions',
        characterLimit: 500,
        hashtagLimit: 3,
        mediaRequired: false,
        marketingTips: [
          'Schedule during business hours',
          'Invite industry experts',
          'Promote in advance',
          'Keep topics professional',
          'Record for later sharing'
        ]
      }
    ],
    hashtagLimits: {
      max: 5,
      recommended: 3,
      minForReach: 1
    },
    characterLimits: {
      max: 3000,
      optimal: 150,
      minForEngagement: 50
    },
    mediaRequirements: {
      image: {
        aspectRatio: '1.91:1 or 1:1',
        minResolution: '1200x627px',
        maxFileSize: '5MB',
        formats: ['JPG', 'PNG', 'GIF']
      },
      video: {
        aspectRatio: '16:9 or 1:1',
        minResolution: '1280x720px',
        maxFileSize: '5GB',
        formats: ['MP4', 'MOV', 'AVI'],
        duration: {
          min: '3 seconds',
          max: '10 minutes',
          optimal: '2-3 minutes'
        }
      }
    },
    postingTimes: [
      'Tuesday-Thursday 8-10 AM',
      'Tuesday-Thursday 12-2 PM',
      'Tuesday-Thursday 5-6 PM'
    ],
    engagementTips: [
      'Use professional tone',
      'Include industry hashtags',
      'Tag relevant people',
      'Ask engaging questions',
      'Share valuable insights'
    ],
    algorithmPreferences: [
      'Professional content',
      'Industry insights',
      'Engaging questions',
      'Video content',
      'Long-form articles'
    ]
  },

  twitter: {
    platform: 'twitter',
    contentTypes: [
      {
        type: 'tweet',
        name: 'Tweet',
        description: 'Short updates and thoughts',
        characterLimit: 280,
        hashtagLimit: 2,
        mediaRequired: false,
        marketingTips: [
          'Keep it concise and punchy',
          'Use trending hashtags',
          'Include emojis sparingly',
          'Ask questions to drive engagement',
          'Use current events'
        ]
      },
      {
        type: 'thread',
        name: 'Twitter Thread',
        description: 'Multi-tweet story or explanation',
        characterLimit: 280,
        hashtagLimit: 1,
        mediaRequired: false,
        marketingTips: [
          'Start with compelling hook',
          'Number your tweets',
          'Use thread unrollers',
          'Include visuals',
          'End with clear conclusion'
        ]
      },
      {
        type: 'video',
        name: 'Twitter Video',
        description: 'Short video content',
        characterLimit: 280,
        hashtagLimit: 2,
        mediaRequired: true,
        marketingTips: [
          'Keep under 2 minutes',
          'Start with attention grabber',
          'Use captions',
          'Include trending audio',
          'Post during peak hours'
        ]
      }
    ],
    hashtagLimits: {
      max: 2,
      recommended: 1,
      minForReach: 0
    },
    characterLimits: {
      max: 280,
      optimal: 100,
      minForEngagement: 20
    },
    mediaRequirements: {
      image: {
        aspectRatio: '16:9 or 1:1',
        minResolution: '1200x675px',
        maxFileSize: '5MB',
        formats: ['JPG', 'PNG', 'GIF']
      },
      video: {
        aspectRatio: '16:9 or 9:16',
        minResolution: '1280x720px',
        maxFileSize: '512MB',
        formats: ['MP4', 'MOV'],
        duration: {
          min: '2 seconds',
          max: '2 minutes 20 seconds',
          optimal: '15-30 seconds'
        }
      }
    },
    postingTimes: [
      'Monday-Friday 9-10 AM',
      'Monday-Friday 12-1 PM',
      'Monday-Friday 5-6 PM',
      'Weekends 9-10 AM'
    ],
    engagementTips: [
      'Use trending hashtags',
      'Reply to others quickly',
      'Retweet relevant content',
      'Use polls and questions',
      'Share breaking news'
    ],
    algorithmPreferences: [
      'Timely content',
      'Engaging conversations',
      'Video content',
      'Trending topics',
      'Interactive elements'
    ]
  },

  instagram: {
    platform: 'instagram',
    contentTypes: [
      {
        type: 'feed_post',
        name: 'Instagram Feed Post',
        description: 'Main feed content with image/video',
        characterLimit: 2200,
        hashtagLimit: 30,
        mediaRequired: true,
        marketingTips: [
          'Use high-quality visuals',
          'Include 20-30 hashtags',
          'Post during peak hours',
          'Use Stories to promote',
          'Engage with comments quickly'
        ]
      },
      {
        type: 'story',
        name: 'Instagram Story',
        description: '24-hour disappearing content',
        characterLimit: 2200,
        hashtagLimit: 10,
        mediaRequired: true,
        marketingTips: [
          'Use interactive stickers',
          'Create story series',
          'Use location tags',
          'Include call-to-action',
          'Post multiple times daily'
        ]
      },
      {
        type: 'reel',
        name: 'Instagram Reel',
        description: 'Short-form video content',
        characterLimit: 2200,
        hashtagLimit: 30,
        mediaRequired: true,
        marketingTips: [
          'Use trending audio',
          'Keep under 30 seconds',
          'Include trending hashtags',
          'Post consistently',
          'Use trending effects'
        ]
      },
      {
        type: 'igtv',
        name: 'Instagram TV',
        description: 'Long-form video content',
        characterLimit: 2200,
        hashtagLimit: 30,
        mediaRequired: true,
        marketingTips: [
          'Create series content',
          'Use engaging thumbnails',
          'Include captions',
          'Promote in Stories',
          'Post weekly'
        ]
      }
    ],
    hashtagLimits: {
      max: 30,
      recommended: 20,
      minForReach: 5
    },
    characterLimits: {
      max: 2200,
      optimal: 125,
      minForEngagement: 50
    },
    mediaRequirements: {
      image: {
        aspectRatio: '1:1 or 4:5',
        minResolution: '1080x1080px',
        maxFileSize: '8MB',
        formats: ['JPG', 'PNG']
      },
      video: {
        aspectRatio: '9:16 or 1:1',
        minResolution: '1080x1920px',
        maxFileSize: '100MB',
        formats: ['MP4', 'MOV'],
        duration: {
          min: '3 seconds',
          max: '60 seconds',
          optimal: '15-30 seconds'
        }
      }
    },
    postingTimes: [
      'Monday-Friday 11 AM-1 PM',
      'Monday-Friday 5-7 PM',
      'Weekends 10 AM-2 PM'
    ],
    engagementTips: [
      'Use trending hashtags',
      'Post consistently',
      'Engage with followers',
      'Use Stories features',
      'Collaborate with others'
    ],
    algorithmPreferences: [
      'High-quality visuals',
      'Video content',
      'Stories engagement',
      'Consistent posting',
      'User interaction'
    ]
  },

  youtube: {
    platform: 'youtube',
    contentTypes: [
      {
        type: 'short',
        name: 'YouTube Short',
        description: 'Vertical short-form video',
        characterLimit: 100,
        hashtagLimit: 15,
        mediaRequired: true,
        marketingTips: [
          'Keep under 60 seconds',
          'Use trending audio',
          'Hook viewers in first 3 seconds',
          'Include captions',
          'Post consistently'
        ]
      },
      {
        type: 'video',
        name: 'YouTube Video',
        description: 'Long-form video content',
        characterLimit: 5000,
        hashtagLimit: 15,
        mediaRequired: true,
        marketingTips: [
          'Create compelling thumbnails',
          'Write detailed descriptions',
          'Use relevant tags',
          'Include timestamps',
          'End with subscribe CTA'
        ]
      },
      {
        type: 'live',
        name: 'YouTube Live',
        description: 'Live streaming content',
        characterLimit: 5000,
        hashtagLimit: 15,
        mediaRequired: true,
        marketingTips: [
          'Promote in advance',
          'Interact with chat',
          'Use engaging titles',
          'Schedule regular streams',
          'Create community posts'
        ]
      }
    ],
    hashtagLimits: {
      max: 15,
      recommended: 10,
      minForReach: 3
    },
    characterLimits: {
      max: 5000,
      optimal: 200,
      minForEngagement: 100
    },
    mediaRequirements: {
      image: {
        aspectRatio: '16:9',
        minResolution: '1280x720px',
        maxFileSize: '2MB',
        formats: ['JPG', 'PNG', 'GIF', 'BMP', 'WEBP']
      },
      video: {
        aspectRatio: '16:9 or 9:16',
        minResolution: '1280x720px',
        maxFileSize: '256GB',
        formats: ['MP4', 'MOV', 'AVI', 'WMV', 'FLV', 'WEBM'],
        duration: {
          min: '1 second',
          max: '12 hours',
          optimal: '8-15 minutes'
        }
      }
    },
    postingTimes: [
      'Monday-Friday 2-4 PM',
      'Monday-Friday 8-11 PM',
      'Weekends 9 AM-11 AM'
    ],
    engagementTips: [
      'Create compelling titles',
      'Use custom thumbnails',
      'Write detailed descriptions',
      'Add end screens',
      'Encourage subscriptions'
    ],
    algorithmPreferences: [
      'Watch time',
      'Engagement rate',
      'Click-through rate',
      'Subscriber growth',
      'Consistent uploads'
    ]
  },

  facebook: {
    platform: 'facebook',
    contentTypes: [
      {
        type: 'post',
        name: 'Facebook Post',
        description: 'Text, image, or video updates',
        characterLimit: 63206,
        hashtagLimit: 30,
        mediaRequired: false,
        marketingTips: [
          'Use engaging visuals',
          'Ask questions',
          'Share personal stories',
          'Include call-to-action',
          'Post during peak hours'
        ]
      },
      {
        type: 'story',
        name: 'Facebook Story',
        description: '24-hour disappearing content',
        characterLimit: 500,
        hashtagLimit: 10,
        mediaRequired: true,
        marketingTips: [
          'Use interactive stickers',
          'Create story series',
          'Use location tags',
          'Include polls',
          'Post multiple times daily'
        ]
      },
      {
        type: 'video',
        name: 'Facebook Video',
        description: 'Native video content',
        characterLimit: 5000,
        hashtagLimit: 30,
        mediaRequired: true,
        marketingTips: [
          'Upload natively to Facebook',
          'Use captions',
          'Create engaging thumbnails',
          'Post consistently',
          'Use Facebook Live'
        ]
      },
      {
        type: 'event',
        name: 'Facebook Event',
        description: 'Event promotion and management',
        characterLimit: 5000,
        hashtagLimit: 30,
        mediaRequired: false,
        marketingTips: [
          'Create compelling event descriptions',
          'Use high-quality cover photos',
          'Invite relevant people',
          'Share updates regularly',
          'Use Facebook Live for events'
        ]
      }
    ],
    hashtagLimits: {
      max: 30,
      recommended: 5,
      minForReach: 1
    },
    characterLimits: {
      max: 63206,
      optimal: 40,
      minForEngagement: 20
    },
    mediaRequirements: {
      image: {
        aspectRatio: '1.91:1 or 1:1',
        minResolution: '1200x630px',
        maxFileSize: '10MB',
        formats: ['JPG', 'PNG', 'GIF']
      },
      video: {
        aspectRatio: '16:9 or 1:1',
        minResolution: '1280x720px',
        maxFileSize: '10GB',
        formats: ['MP4', 'MOV', 'AVI'],
        duration: {
          min: '1 second',
          max: '240 minutes',
          optimal: '1-3 minutes'
        }
      }
    },
    postingTimes: [
      'Monday-Friday 9-10 AM',
      'Monday-Friday 3-4 PM',
      'Weekends 12-1 PM'
    ],
    engagementTips: [
      'Use engaging visuals',
      'Ask questions',
      'Share personal content',
      'Use Facebook Live',
      'Engage with comments'
    ],
    algorithmPreferences: [
      'Meaningful interactions',
      'Video content',
      'Live videos',
      'Community engagement',
      'Original content'
    ]
  }
};

// Helper functions for content optimization
export const getPlatformGuidelines = (platform: string): PlatformContentGuidelines => {
  return PLATFORM_GUIDELINES[platform] || PLATFORM_GUIDELINES.linkedin;
};

export const getContentTypeGuidelines = (platform: string, contentType: string): ContentType | null => {
  const guidelines = getPlatformGuidelines(platform);
  return guidelines.contentTypes.find(type => type.type === contentType) || null;
};

export const validateContent = (platform: string, contentType: string, content: string, hashtags: string[]): ValidationResult => {
  const typeGuidelines = getContentTypeGuidelines(platform, contentType);
  if (!typeGuidelines) {
    return { isValid: false, errors: ['Invalid content type'] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Character limit validation
  if (content.length > typeGuidelines.characterLimit) {
    errors.push(`Content exceeds character limit of ${typeGuidelines.characterLimit}`);
  } else if (content.length < typeGuidelines.characterLimit * 0.1) {
    warnings.push('Content is very short - consider adding more detail');
  }

  // Hashtag validation
  if (hashtags.length > typeGuidelines.hashtagLimit) {
    errors.push(`Too many hashtags. Maximum allowed: ${typeGuidelines.hashtagLimit}`);
  } else if (hashtags.length < typeGuidelines.hashtagLimit * 0.3) {
    warnings.push(`Consider adding more hashtags for better reach (recommended: ${typeGuidelines.hashtagLimit})`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    score: calculateContentScore(platform, contentType, content, hashtags)
  };
};

export const calculateContentScore = (platform: string, contentType: string, content: string, hashtags: string[]): number => {
  let score = 0;
  const typeGuidelines = getContentTypeGuidelines(platform, contentType);
  if (!typeGuidelines) return 0;

  // Character count score (optimal length gets highest score)
  const optimalLength = typeGuidelines.characterLimit * 0.3;
  const lengthRatio = Math.min(content.length / optimalLength, 1);
  score += lengthRatio * 30;

  // Hashtag score
  const hashtagRatio = Math.min(hashtags.length / typeGuidelines.hashtagLimit, 1);
  score += hashtagRatio * 20;

  // Engagement indicators
  if (content.includes('?')) score += 10; // Questions
  if (content.includes('!')) score += 5; // Excitement
  if (hashtags.length > 0) score += 10; // Hashtags present
  if (content.length > 50) score += 15; // Substantial content
  if (content.includes('http')) score += 10; // Links

  return Math.min(score, 100);
};

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  score: number;
}























