/** Part of platform-guidelines (Agent-B split — main module keeps the original path). */
import type { PlatformContentGuidelines } from './platform-guidelinesDataA';

export const PLATFORM_GUIDELINES_B: Record<string, PlatformContentGuidelines> = {
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
