export interface PublishResult {
  success: boolean;
  platform_post_id?: string;
  post_url?: string;
  published_at?: Date;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}
