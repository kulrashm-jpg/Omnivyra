// Core Scheduling Service
import { ScheduledPost, PostingJob, PlatformConfig, PostingService, PostingResult, ValidationResult, AccountInfo } from './types/scheduling';
import { queue } from './queue';
import { PostingServiceFactory } from './posting';

export class SchedulingService {
  private postingServices: Map<string, PostingService> = new Map();
  private platformConfigs: Map<string, PlatformConfig> = new Map();
  private isProcessing = false;

  constructor() {
    this.initializePlatforms();
    this.initializePostingServices();
  }

  // Initialize platform configurations
  private initializePlatforms() {
    const platforms: PlatformConfig[] = [
      {
        platform: 'linkedin',
        enabled: true,
        apiCredentials: {
          clientId: process.env.LINKEDIN_CLIENT_ID || '',
          clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
        },
        postingLimits: {
          maxPostsPerDay: 5,
          maxPostsPerHour: 1,
          minIntervalMinutes: 60,
        },
        contentLimits: {
          maxCharacters: 3000,
          maxHashtags: 5,
          maxMediaFiles: 9,
          maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
          allowedFormats: ['jpg', 'png', 'mp4', 'mov', 'pdf'],
        },
      },
      {
        platform: 'twitter',
        enabled: true,
        apiCredentials: {
          clientId: process.env.TWITTER_CLIENT_ID || '',
          clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
        },
        postingLimits: {
          maxPostsPerDay: 50,
          maxPostsPerHour: 5,
          minIntervalMinutes: 12,
        },
        contentLimits: {
          maxCharacters: 280,
          maxHashtags: 2,
          maxMediaFiles: 4,
          maxFileSize: 15 * 1024 * 1024, // 15MB
          allowedFormats: ['jpg', 'png', 'gif', 'mp4', 'mov'],
        },
      },
      {
        platform: 'instagram',
        enabled: true,
        apiCredentials: {
          clientId: process.env.INSTAGRAM_CLIENT_ID || '',
          clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || '',
        },
        postingLimits: {
          maxPostsPerDay: 25,
          maxPostsPerHour: 3,
          minIntervalMinutes: 20,
        },
        contentLimits: {
          maxCharacters: 2200,
          maxHashtags: 30,
          maxMediaFiles: 10,
          maxFileSize: 100 * 1024 * 1024, // 100MB
          allowedFormats: ['jpg', 'png', 'mp4', 'mov'],
        },
      },
      {
        platform: 'youtube',
        enabled: true,
        apiCredentials: {
          clientId: process.env.YOUTUBE_CLIENT_ID || '',
          clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
        },
        postingLimits: {
          maxPostsPerDay: 10,
          maxPostsPerHour: 1,
          minIntervalMinutes: 60,
        },
        contentLimits: {
          maxCharacters: 5000,
          maxHashtags: 15,
          maxMediaFiles: 1,
          maxFileSize: 256 * 1024 * 1024 * 1024, // 256GB
          allowedFormats: ['mp4', 'mov', 'avi', 'wmv'],
        },
      },
      {
        platform: 'facebook',
        enabled: true,
        apiCredentials: {
          clientId: process.env.FACEBOOK_CLIENT_ID || '',
          clientSecret: process.env.FACEBOOK_CLIENT_SECRET || '',
        },
        postingLimits: {
          maxPostsPerDay: 25,
          maxPostsPerHour: 3,
          minIntervalMinutes: 20,
        },
        contentLimits: {
          maxCharacters: 63206,
          maxHashtags: 30,
          maxMediaFiles: 12,
          maxFileSize: 1024 * 1024 * 1024, // 1GB
          allowedFormats: ['jpg', 'png', 'gif', 'mp4', 'mov'],
        },
      },
    ];

    platforms.forEach(config => {
      this.platformConfigs.set(config.platform, config);
    });
  }

  // Initialize posting services
  private initializePostingServices() {
    const platforms = ['linkedin', 'twitter', 'instagram', 'youtube', 'facebook'];
    platforms.forEach(platform => {
      const service = PostingServiceFactory.getService(platform);
      if (service) {
        this.postingServices.set(platform, service);
      }
    });
  }

  // Schedule a post
  async schedulePost(post: Omit<ScheduledPost, 'id' | 'createdAt' | 'updatedAt' | 'retryCount' | 'maxRetries'>): Promise<ScheduledPost> {
    const scheduledPost: ScheduledPost = {
      ...post,
      id: this.generateId(),
      status: 'draft',
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Validate the post
    const validation = await this.validatePost(scheduledPost);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    // Check posting limits
    await this.checkPostingLimits(scheduledPost);

    // Save to database (mock for now)
    await this.savePost(scheduledPost);

    // Add to posting queue if scheduled for future
    if (scheduledPost.scheduledFor > new Date()) {
      queue.addJob(scheduledPost);
    } else {
      // Post immediately if scheduled for now or past
      await this.processPost(scheduledPost);
    }

    return scheduledPost;
  }

  // Validate a post
  async validatePost(post: ScheduledPost): Promise<ValidationResult> {
    const config = this.platformConfigs.get(post.platform);
    if (!config) {
      return {
        valid: false,
        errors: [`Platform ${post.platform} not supported`],
        warnings: [],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // Check character limit
    if (post.content.length > config.contentLimits.maxCharacters) {
      errors.push(`Content exceeds character limit of ${config.contentLimits.maxCharacters}`);
    }

    // Check hashtag limit
    if (post.hashtags && post.hashtags.length > config.contentLimits.maxHashtags) {
      errors.push(`Too many hashtags. Maximum allowed: ${config.contentLimits.maxHashtags}`);
    }

    // Check media file limit
    if (post.mediaUrls && post.mediaUrls.length > config.contentLimits.maxMediaFiles) {
      errors.push(`Too many media files. Maximum allowed: ${config.contentLimits.maxMediaFiles}`);
    }

    // Check if platform is enabled
    if (!config.enabled) {
      errors.push(`Platform ${post.platform} is currently disabled`);
    }

    // Check API credentials
    if (!config.apiCredentials.clientId || !config.apiCredentials.clientSecret) {
      errors.push(`API credentials not configured for ${post.platform}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // Check posting limits
  async checkPostingLimits(post: ScheduledPost): Promise<void> {
    const config = this.platformConfigs.get(post.platform);
    if (!config) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Check daily limit
    const todayPosts = await this.getPostsCount(post.platform, today, now);
    if (todayPosts >= config.postingLimits.maxPostsPerDay) {
      throw new Error(`Daily posting limit reached for ${post.platform} (${config.postingLimits.maxPostsPerDay} posts)`);
    }

    // Check hourly limit
    const hourlyPosts = await this.getPostsCount(post.platform, oneHourAgo, now);
    if (hourlyPosts >= config.postingLimits.maxPostsPerHour) {
      throw new Error(`Hourly posting limit reached for ${post.platform} (${config.postingLimits.maxPostsPerHour} posts)`);
    }

    // Check minimum interval
    const lastPost = await this.getLastPost(post.platform);
    if (lastPost) {
      const timeSinceLastPost = now.getTime() - lastPost.publishedAt!.getTime();
      const minIntervalMs = config.postingLimits.minIntervalMinutes * 60 * 1000;
      
      if (timeSinceLastPost < minIntervalMs) {
        const remainingMinutes = Math.ceil((minIntervalMs - timeSinceLastPost) / (60 * 1000));
        throw new Error(`Minimum interval not met. Wait ${remainingMinutes} minutes before posting to ${post.platform}`);
      }
    }
  }

  // Process a post (publish it)
  async processPost(post: ScheduledPost): Promise<PostingResult> {
    try {
      // Update status to publishing
      await this.updatePostStatus(post.id, 'publishing');

      // Get posting service for the platform
      const postingService = this.postingServices.get(post.platform);
      if (!postingService) {
        throw new Error(`No posting service available for ${post.platform}`);
      }

      // Publish the post
      const result = await postingService.post(post);

      if (result.success) {
        // Update status to published
        await this.updatePostStatus(post.id, 'published', {
          publishedAt: result.publishedAt || new Date(),
          platformPostId: result.platformPostId,
        });

        // Update metrics if available
        if (result.metrics) {
          await this.updatePostMetrics(post.id, result.metrics);
        }

        return result;
      } else {
        // Update status to failed
        await this.updatePostStatus(post.id, 'failed', {
          errorMessage: result.errorMessage,
        });

        // Add to retry queue if retries remaining
        if (post.retryCount < post.maxRetries) {
          await this.addToRetryQueue(post);
        }

        return result;
      }
    } catch (error: any) {
      // Update status to failed
      await this.updatePostStatus(post.id, 'failed', {
        errorMessage: error.message,
      });

      // Add to retry queue if retries remaining
      if (post.retryCount < post.maxRetries) {
        await this.addToRetryQueue(post);
      }

      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  // Add post to queue
  async addToQueue(post: ScheduledPost): Promise<void> {
    queue.addJob(post);
  }

  // Add post to retry queue
  async addToRetryQueue(post: ScheduledPost): Promise<void> {
    const retryDelay = Math.pow(2, post.retryCount) * 60 * 1000; // Exponential backoff
    const nextRetryAt = new Date(Date.now() + retryDelay);

    // Update retry count
    await this.updatePost(post.id, {
      retryCount: post.retryCount + 1,
      scheduledFor: nextRetryAt,
      status: 'scheduled',
    });

    // Add to retry queue
    queue.addJob({
      ...post,
      retryCount: post.retryCount + 1,
      scheduledFor: nextRetryAt,
      status: 'scheduled',
    });
  }

  // Get posts count for time range
  async getPostsCount(platform: string, startDate: Date, endDate: Date): Promise<number> {
    // Mock implementation - in production, query database
    return 0;
  }

  // Get last post for platform
  async getLastPost(platform: string): Promise<ScheduledPost | null> {
    // Mock implementation - in production, query database
    return null;
  }

  // Save post to database
  async savePost(post: ScheduledPost): Promise<void> {
    // Mock implementation - in production, save to database
    console.log('Saving post:', post.id);
  }

  // Update post status
  async updatePostStatus(postId: string, status: ScheduledPost['status'], additionalData?: any): Promise<void> {
    // Mock implementation - in production, update database
    console.log(`Updating post ${postId} status to ${status}`, additionalData);
  }

  // Update post
  async updatePost(postId: string, updates: Partial<ScheduledPost>): Promise<void> {
    // Mock implementation - in production, update database
    console.log(`Updating post ${postId}:`, updates);
  }

  // Update post metrics
  async updatePostMetrics(postId: string, metrics: any): Promise<void> {
    // Mock implementation - in production, update database
    console.log(`Updating post ${postId} metrics:`, metrics);
  }

  // Generate unique ID
  private generateId(): string {
    return `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get all scheduled posts
  async getScheduledPosts(platform?: string, status?: string): Promise<ScheduledPost[]> {
    // Mock implementation - in production, query database
    return [];
  }

  // Cancel a scheduled post
  async cancelPost(postId: string): Promise<void> {
    await this.updatePostStatus(postId, 'draft');
    // Remove from queue if not yet processed
    console.log(`Post ${postId} cancelled`);
  }

  // Get posting statistics
  async getPostingStats(platform?: string, days: number = 30): Promise<any> {
    // Mock implementation - in production, query database
    return {
      totalPosts: 0,
      publishedPosts: 0,
      failedPosts: 0,
      scheduledPosts: 0,
      averageEngagement: 0,
    };
  }
}
