// COMPREHENSIVE UI STRUCTURE PLAN
// Unified Content Management Page with Platform-Specific Forms

// ==============================================
// MAIN PAGE STRUCTURE
// ==============================================

interface UnifiedContentManager {
  // Top Navigation
  topNav: {
    platformTabs: PlatformTab[];
    campaignSelector: CampaignSelector;
    bulkActions: BulkAction[];
  };
  
  // Left Sidebar
  leftSidebar: {
    contentTypes: ContentTypeFilter[];
    dateRange: DateRangePicker;
    statusFilter: StatusFilter[];
    searchBar: SearchInput;
  };
  
  // Main Content Area
  mainContent: {
    platformForms: PlatformFormSection[];
    contentCalendar: ContentCalendar;
    previewPanel: PreviewPanel;
  };
  
  // Right Sidebar
  rightSidebar: {
    analytics: AnalyticsPanel;
    suggestions: AISuggestionsPanel;
    assets: AssetLibrary;
  };
}

// ==============================================
// PLATFORM-SPECIFIC FORM STRUCTURES
// ==============================================

// LinkedIn Forms
interface LinkedInForms {
  posts: {
    title: string; // VARCHAR(200)
    content: string; // TEXT (max 3000)
    hashtags: string[]; // TEXT[] (max 5)
    media: {
      urls: string[]; // TEXT[] (max 9)
      types: ('image' | 'video' | 'document')[];
      sizes: number[]; // BIGINT[]
      formats: string[]; // VARCHAR(10)[]
    };
    video?: {
      duration: number; // INTEGER (max 600)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10)
      bitrate: number; // INTEGER (max 30000)
    };
    image?: {
      width: number; // INTEGER
      height: number; // INTEGER
      aspectRatio: string; // VARCHAR(10)
    };
  };
  
  articles: {
    title: string; // VARCHAR(200)
    content: string; // TEXT (max 125000)
    excerpt: string; // TEXT (max 500)
    tags: string[]; // TEXT[] (max 3)
    coverImage: {
      url: string; // VARCHAR(500)
      width: number; // INTEGER
      height: number; // INTEGER
      size: number; // BIGINT (max 5MB)
    };
    wordCount: number; // INTEGER
    readingTime: number; // INTEGER
  };
  
  videos: {
    title: string; // VARCHAR(200)
    description: string; // TEXT (max 2000)
    hashtags: string[]; // TEXT[] (max 5)
    video: {
      url: string; // VARCHAR(500)
      thumbnailUrl: string; // VARCHAR(500)
      duration: number; // INTEGER (max 600)
      fileSize: number; // BIGINT (max 5GB)
      format: string; // VARCHAR(10)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10)
      bitrate: number; // INTEGER (max 30000)
      fps: number; // INTEGER (max 60)
    };
  };
  
  audioEvents: {
    title: string; // VARCHAR(200)
    description: string; // TEXT (max 500)
    hashtags: string[]; // TEXT[] (max 3)
    duration: number; // INTEGER
    maxParticipants: number; // INTEGER
    eventType: string; // VARCHAR(50)
  };
}

// Twitter Forms
interface TwitterForms {
  tweets: {
    content: string; // VARCHAR(280)
    hashtags: string[]; // TEXT[] (max 2)
    mentions: string[]; // TEXT[]
    media: {
      urls: string[]; // TEXT[] (max 4)
      types: ('image' | 'video' | 'gif')[];
      sizes: number[]; // BIGINT[]
      formats: string[]; // VARCHAR(10)[]
    };
    video?: {
      duration: number; // INTEGER (max 140)
      fileSize: number; // BIGINT (max 15MB)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10)
    };
    image?: {
      width: number; // INTEGER
      height: number; // INTEGER
      fileSize: number; // BIGINT (max 5MB)
    };
    thread?: {
      threadId: number; // INTEGER
      position: number; // INTEGER
      isThreadStart: boolean; // BOOLEAN
    };
  };
  
  threads: {
    title: string; // VARCHAR(200)
    description: string; // TEXT
    hashtags: string[]; // TEXT[] (max 1)
    tweets: Tweet[]; // Array of tweet objects
  };
}

// Instagram Forms
interface InstagramForms {
  feedPosts: {
    caption: string; // TEXT (max 2200)
    hashtags: string[]; // TEXT[] (max 30)
    location: string; // VARCHAR(200)
    altText: string; // TEXT
    media: {
      urls: string[]; // TEXT[] (max 10)
      types: ('image' | 'video' | 'carousel')[];
      sizes: number[]; // BIGINT[]
      formats: string[]; // VARCHAR(10)[]
    };
    images?: {
      widths: number[]; // INTEGER[]
      heights: number[]; // INTEGER[]
      aspectRatios: string[]; // VARCHAR(10)[]
    };
    videos?: {
      durations: number[]; // INTEGER[] (max 60)
      fileSizes: number[]; // BIGINT[] (max 100MB)
      resolutions: string[]; // VARCHAR(20)[]
      aspectRatios: string[]; // VARCHAR(10)[]
    };
  };
  
  stories: {
    content: string; // TEXT (max 2200)
    media: {
      url: string; // VARCHAR(500)
      type: 'image' | 'video'; // VARCHAR(20)
      fileSize: number; // BIGINT (max 100MB)
      format: string; // VARCHAR(10)
    };
    image?: {
      width: number; // INTEGER
      height: number; // INTEGER (9:16)
      aspectRatio: string; // VARCHAR(10) = '9:16'
    };
    video?: {
      duration: number; // INTEGER (max 15)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10) = '9:16'
    };
    stickers: object; // JSONB
  };
  
  reels: {
    caption: string; // TEXT (max 2200)
    hashtags: string[]; // TEXT[] (max 30)
    audio: {
      url: string; // VARCHAR(500)
      title: string; // VARCHAR(200)
    };
    video: {
      url: string; // VARCHAR(500)
      thumbnailUrl: string; // VARCHAR(500)
      duration: number; // INTEGER (5-90)
      fileSize: number; // BIGINT (max 100MB)
      format: string; // VARCHAR(10)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10) = '9:16'
    };
  };
  
  igtv: {
    title: string; // VARCHAR(500)
    description: string; // TEXT (max 2200)
    hashtags: string[]; // TEXT[] (max 30)
    video: {
      url: string; // VARCHAR(500)
      thumbnailUrl: string; // VARCHAR(500)
      duration: number; // INTEGER (min 60)
      fileSize: number; // BIGINT (max 100MB)
      format: string; // VARCHAR(10)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10) = '9:16' or '16:9'
    };
  };
}

// YouTube Forms
interface YouTubeForms {
  shorts: {
    title: string; // VARCHAR(500)
    description: string; // TEXT (max 5000)
    hashtags: string[]; // TEXT[] (max 15)
    video: {
      url: string; // VARCHAR(500)
      thumbnailUrl: string; // VARCHAR(500)
      duration: number; // INTEGER (max 60)
      fileSize: number; // BIGINT (max 256GB)
      format: string; // VARCHAR(10)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10) = '9:16'
      bitrate: number; // INTEGER
    };
  };
  
  videos: {
    title: string; // VARCHAR(500)
    description: string; // TEXT (max 5000)
    tags: string[]; // TEXT[] (max 15)
    category: string; // VARCHAR(100)
    language: string; // VARCHAR(10)
    video: {
      url: string; // VARCHAR(500)
      thumbnailUrl: string; // VARCHAR(500)
      duration: number; // INTEGER (max 43200 = 12 hours)
      fileSize: number; // BIGINT (max 256GB)
      format: string; // VARCHAR(10)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10) = '16:9', '9:16', '1:1'
      bitrate: number; // INTEGER
    };
  };
  
  live: {
    title: string; // VARCHAR(500)
    description: string; // TEXT (max 5000)
    tags: string[]; // TEXT[] (max 15)
    scheduledFor: string; // TIMESTAMP
    duration: number; // INTEGER
    streamKey: string; // VARCHAR(100)
    streamUrl: string; // VARCHAR(500)
  };
}

// Facebook Forms
interface FacebookForms {
  posts: {
    content: string; // TEXT (max 63206)
    hashtags: string[]; // TEXT[] (max 30)
    location: string; // VARCHAR(200)
    media: {
      urls: string[]; // TEXT[] (max 12)
      types: ('image' | 'video')[];
      sizes: number[]; // BIGINT[]
      formats: string[]; // VARCHAR(10)[]
    };
    images?: {
      widths: number[]; // INTEGER[]
      heights: number[]; // INTEGER[]
      aspectRatios: string[]; // VARCHAR(10)[]
      fileSizes: number[]; // BIGINT[] (max 4MB each)
    };
    videos?: {
      durations: number[]; // INTEGER[] (max 1200 = 20 min)
      fileSizes: number[]; // BIGINT[] (max 1GB each)
      resolutions: string[]; // VARCHAR(20)[]
      aspectRatios: string[]; // VARCHAR(10)[]
    };
  };
  
  stories: {
    content: string; // TEXT (max 500)
    media: {
      url: string; // VARCHAR(500)
      type: 'image' | 'video'; // VARCHAR(20)
      fileSize: number; // BIGINT (max 100MB)
      format: string; // VARCHAR(10)
    };
    image?: {
      width: number; // INTEGER
      height: number; // INTEGER (9:16)
      aspectRatio: string; // VARCHAR(10) = '9:16'
    };
    video?: {
      duration: number; // INTEGER (max 15)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10) = '9:16'
    };
    stickers: object; // JSONB
  };
  
  videos: {
    title: string; // VARCHAR(500)
    description: string; // TEXT (max 5000)
    hashtags: string[]; // TEXT[]
    video: {
      url: string; // VARCHAR(500)
      thumbnailUrl: string; // VARCHAR(500)
      duration: number; // INTEGER (max 14400 = 4 hours)
      fileSize: number; // BIGINT (max 1GB)
      format: string; // VARCHAR(10)
      resolution: string; // VARCHAR(20)
      aspectRatio: string; // VARCHAR(10)
    };
  };
  
  events: {
    title: string; // VARCHAR(500)
    description: string; // TEXT (max 5000)
    location: string; // VARCHAR(200)
    eventType: string; // VARCHAR(50)
    scheduledFor: string; // TIMESTAMP
    endTime: string; // TIMESTAMP
    duration: number; // INTEGER
    maxAttendees: number; // INTEGER
  };
}

// ==============================================
// UI COMPONENT STRUCTURE
// ==============================================

interface PlatformFormSection {
  platform: 'linkedin' | 'twitter' | 'instagram' | 'youtube' | 'facebook';
  contentTypes: ContentTypeTab[];
  activeContentType: string;
  form: PlatformForm;
  validation: FormValidation;
  preview: ContentPreview;
}

interface ContentTypeTab {
  type: string;
  name: string;
  icon: string;
  description: string;
  characterLimit: number;
  hashtagLimit: number;
  mediaRequired: boolean;
  mediaTypes: string[];
  aspectRatios: string[];
  fileSizeLimit: number;
  durationLimit?: number;
}

interface PlatformForm {
  fields: FormField[];
  mediaUpload: MediaUploadSection;
  scheduling: SchedulingSection;
  hashtags: HashtagSection;
  location: LocationSection;
  advanced: AdvancedOptions;
}

interface FormField {
  name: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date' | 'time';
  label: string;
  placeholder: string;
  required: boolean;
  maxLength: number;
  validation: FieldValidation;
  helpText: string;
}

interface MediaUploadSection {
  allowedTypes: string[];
  maxFiles: number;
  maxFileSize: number;
  aspectRatios: string[];
  dimensions: {
    min: { width: number; height: number };
    max: { width: number; height: number };
  };
  formats: string[];
  durationLimit?: number;
}

interface SchedulingSection {
  dateTime: DateTimePicker;
  timezone: TimezoneSelector;
  optimalTimes: OptimalTimeSuggestion[];
  recurring: RecurringOptions;
}

interface HashtagSection {
  maxCount: number;
  suggestions: HashtagSuggestion[];
  trending: TrendingHashtag[];
  validation: HashtagValidation;
}

interface ContentPreview {
  platform: string;
  contentType: string;
  preview: PreviewComponent;
  metrics: PreviewMetrics;
  optimization: OptimizationSuggestions;
}

// ==============================================
// VALIDATION RULES
// ==============================================

interface ValidationRules {
  characterLimits: Record<string, number>;
  hashtagLimits: Record<string, number>;
  mediaLimits: Record<string, MediaLimits>;
  fileSizeLimits: Record<string, number>;
  durationLimits: Record<string, number>;
  aspectRatioLimits: Record<string, string[]>;
  requiredFields: Record<string, string[]>;
}

interface MediaLimits {
  maxFiles: number;
  maxFileSize: number;
  allowedFormats: string[];
  aspectRatios: string[];
  dimensions: {
    min: { width: number; height: number };
    max: { width: number; height: number };
  };
  duration?: {
    min: number;
    max: number;
  };
}

// ==============================================
// API ENDPOINTS STRUCTURE
// ==============================================

interface APIEndpoints {
  // Content CRUD
  'POST /api/content/linkedin/posts': LinkedInPost;
  'PUT /api/content/linkedin/posts/:id': LinkedInPost;
  'DELETE /api/content/linkedin/posts/:id': void;
  'GET /api/content/linkedin/posts': LinkedInPost[];
  
  'POST /api/content/twitter/tweets': TwitterTweet;
  'PUT /api/content/twitter/tweets/:id': TwitterTweet;
  'DELETE /api/content/twitter/tweets/:id': void;
  'GET /api/content/twitter/tweets': TwitterTweet[];
  
  'POST /api/content/instagram/feed-posts': InstagramFeedPost;
  'PUT /api/content/instagram/feed-posts/:id': InstagramFeedPost;
  'DELETE /api/content/instagram/feed-posts/:id': void;
  'GET /api/content/instagram/feed-posts': InstagramFeedPost[];
  
  'POST /api/content/youtube/videos': YouTubeVideo;
  'PUT /api/content/youtube/videos/:id': YouTubeVideo;
  'DELETE /api/content/youtube/videos/:id': void;
  'GET /api/content/youtube/videos': YouTubeVideo[];
  
  'POST /api/content/facebook/posts': FacebookPost;
  'PUT /api/content/facebook/posts/:id': FacebookPost;
  'DELETE /api/content/facebook/posts/:id': void;
  'GET /api/content/facebook/posts': FacebookPost[];
  
  // Campaign Management
  'POST /api/campaigns': Campaign;
  'PUT /api/campaigns/:id': Campaign;
  'DELETE /api/campaigns/:id': void;
  'GET /api/campaigns': Campaign[];
  
  'POST /api/campaigns/:id/content': CampaignContent;
  'PUT /api/campaigns/:id/content/:contentId': CampaignContent;
  'DELETE /api/campaigns/:id/content/:contentId': void;
  'GET /api/campaigns/:id/content': CampaignContent[];
  
  // Analytics
  'GET /api/analytics/content/:id': ContentAnalytics;
  'GET /api/analytics/campaign/:id': CampaignAnalytics;
  'GET /api/analytics/platform/:platform': PlatformAnalytics;
  
  // AI Features
  'POST /api/ai/analyze-content': ContentAnalysis;
  'POST /api/ai/generate-content': GeneratedContent;
  'POST /api/ai/optimize-content': OptimizedContent;
  'POST /api/ai/suggest-hashtags': HashtagSuggestions;
  
  // Media Upload
  'POST /api/media/upload': MediaUploadResponse;
  'GET /api/media/:id': MediaFile;
  'DELETE /api/media/:id': void;
  
  // Scheduling
  'POST /api/schedule/content': ScheduledContent;
  'PUT /api/schedule/content/:id': ScheduledContent;
  'DELETE /api/schedule/content/:id': void;
  'GET /api/schedule/content': ScheduledContent[];
  
  // Publishing
  'POST /api/publish/content/:id': PublishResponse;
  'GET /api/publish/status/:id': PublishStatus;
}























