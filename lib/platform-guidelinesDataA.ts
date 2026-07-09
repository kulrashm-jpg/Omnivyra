/** Part of platform-guidelines (Agent-B split — main module keeps the original path). */
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
export const PLATFORM_GUIDELINES_A: Record<string, PlatformContentGuidelines> = {
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

};
