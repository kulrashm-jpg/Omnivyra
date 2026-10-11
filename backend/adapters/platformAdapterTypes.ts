export interface PublishResult {
  success: boolean;
  platform_post_id?: string;
  post_url?: string;
  published_at?: Date;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    /**
     * 'not_sent' is EVIDENCE that the create-post request never left this
     * process (the failure happened before dispatch to a platform adapter).
     * Absent means the request may have been sent — see
     * backend/queue/publishOutcome.ts. `retryable` is not such evidence.
     */
    delivery?: 'not_sent';
  };
}
