// Core Scheduling System - Database Models and Types
export interface ScheduledPost {
  id: string;
  platform: 'linkedin' | 'twitter' | 'instagram' | 'youtube' | 'facebook';
  contentType: string;
  content: string;
  mediaUrls?: string[];
  hashtags?: string[];
  scheduledFor: Date;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
  publishedAt?: Date;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostingJob {
  id: string;
  postId: string;
  platform: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformConfig {
  platform: string;
  enabled: boolean;
  apiCredentials: {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
  };
  postingLimits: {
    maxPostsPerDay: number;
    maxPostsPerHour: number;
    minIntervalMinutes: number;
  };
  contentLimits: {
    maxCharacters: number;
    maxHashtags: number;
    maxMediaFiles: number;
    maxFileSize: number;
    allowedFormats: string[];
  };
}

// Queue System for Background Processing
export interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  queues: {
    posting: {
      name: string;
      concurrency: number;
      delay: number;
    };
    retry: {
      name: string;
      concurrency: number;
      delay: number;
    };
  };
}

// Posting Service Interface
export interface PostingService {
  platform: string;
  post(content: ScheduledPost): Promise<PostingResult>;
  validate(content: ScheduledPost): ValidationResult;
  getAccountInfo(): Promise<AccountInfo>;
}

export interface PostingResult {
  success: boolean;
  platformPostId?: string;
  errorMessage?: string;
  publishedAt?: Date;
  metrics?: {
    views?: number;
    likes?: number;
    shares?: number;
    comments?: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AccountInfo {
  id: string;
  name: string;
  username: string;
  followers?: number;
  isActive: boolean;
  lastPosted?: Date;
}























