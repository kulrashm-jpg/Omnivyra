/**
 * Error Recovery Service
 * 
 * Handles platform-specific errors with actionable recovery suggestions.
 * 
 * Features:
 * - Error categorization
 * - User-friendly error messages
 * - Automatic recovery suggestions
 * - Error code tracking for analytics
 */

export interface PlatformError {
  code: string;
  category: ErrorCategory;
  message: string;
  user_message: string;
  retryable: boolean;
  recovery_suggestions: string[];
  requires_user_action: boolean;
}

export type ErrorCategory = 
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'media'
  | 'content_policy'
  | 'account_restriction'
  | 'network'
  | 'unknown';

/**
 * Categorize and format platform errors
 */
export function categorizeError(
  platform: string,
  error: any
): PlatformError {
  const errorMessage = error?.message || error?.error?.message || String(error);
  const statusCode = error?.response?.status || error?.status || 0;

  // LinkedIn errors
  if (platform === 'linkedin') {
    if (statusCode === 401) {
      return {
        code: 'LINKEDIN_UNAUTHORIZED',
        category: 'authentication',
        message: errorMessage,
        user_message: 'LinkedIn authentication expired. Please reconnect your account.',
        retryable: false,
        recovery_suggestions: [
          'Go to Settings > Connected Accounts',
          'Click "Reconnect" for LinkedIn',
          'Authorize the app again',
        ],
        requires_user_action: true,
      };
    }

    if (statusCode === 429) {
      return {
        code: 'LINKEDIN_RATE_LIMIT',
        category: 'rate_limit',
        message: errorMessage,
        user_message: 'LinkedIn rate limit exceeded. Please wait before posting again.',
        retryable: true,
        recovery_suggestions: [
          'Wait 1 hour before posting again',
          'Reduce posting frequency',
          'Contact support if issue persists',
        ],
        requires_user_action: false,
      };
    }

    if (errorMessage.includes('image') || errorMessage.includes('media') || errorMessage.includes('size')) {
      return {
        code: 'LINKEDIN_MEDIA_ERROR',
        category: 'media',
        message: errorMessage,
        user_message: 'Media file issue. Check file size and format requirements.',
        retryable: true,
        recovery_suggestions: [
          'Resize image to 1200x627px or smaller (recommended: 1200x627px)',
          'Ensure file size is under 5MB',
          'Use JPG, PNG, or GIF format',
        ],
        requires_user_action: true,
      };
    }
  }

  // Twitter/X errors
  if (platform === 'twitter' || platform === 'x') {
    if (statusCode === 401) {
      return {
        code: 'TWITTER_UNAUTHORIZED',
        category: 'authentication',
        message: errorMessage,
        user_message: 'Twitter/X authentication expired. Please reconnect your account.',
        retryable: false,
        recovery_suggestions: [
          'Go to Settings > Connected Accounts',
          'Click "Reconnect" for Twitter/X',
          'Authorize the app again',
        ],
        requires_user_action: true,
      };
    }

    if (statusCode === 429) {
      return {
        code: 'TWITTER_RATE_LIMIT',
        category: 'rate_limit',
        message: errorMessage,
        user_message: 'Twitter/X rate limit exceeded. Please wait before posting again.',
        retryable: true,
        recovery_suggestions: [
          'Wait 15 minutes before posting again',
          'Reduce posting frequency',
          'Check Twitter API status',
        ],
        requires_user_action: false,
      };
    }

    if (errorMessage.includes('duplicate') || errorMessage.includes('already posted')) {
      return {
        code: 'TWITTER_DUPLICATE',
        category: 'content_policy',
        message: errorMessage,
        user_message: 'This content has already been posted. Twitter prevents duplicate posts.',
        retryable: false,
        recovery_suggestions: [
          'Modify the content slightly',
          'Add a timestamp or unique identifier',
          'Wait before posting similar content',
        ],
        requires_user_action: true,
      };
    }
  }

  // Generic errors
  if (statusCode >= 500) {
    return {
      code: 'PLATFORM_SERVER_ERROR',
      category: 'network',
      message: errorMessage,
      user_message: 'Platform server error. This is usually temporary.',
      retryable: true,
      recovery_suggestions: [
        'Wait a few minutes and try again',
        'Check platform status page',
        'Contact support if issue persists',
      ],
      requires_user_action: false,
    };
  }

  if (statusCode === 403) {
    return {
      code: 'PLATFORM_FORBIDDEN',
      category: 'authorization',
      message: errorMessage,
      user_message: 'You don\'t have permission to perform this action.',
      retryable: false,
      recovery_suggestions: [
        'Check account permissions',
        'Verify account is active',
        'Contact platform support',
      ],
      requires_user_action: true,
    };
  }

  // Default unknown error — surface the raw message so callers can show it
  return {
    code: 'UNKNOWN_ERROR',
    category: 'unknown',
    message: errorMessage,
    user_message: errorMessage || 'An unexpected error occurred. Please try again.',
    retryable: true,
    recovery_suggestions: [
      'Try again in a few minutes',
      'Check your internet connection',
      'Contact support if issue persists',
    ],
    requires_user_action: false,
  };
}

/**
 * Get recovery actions for an error
 */
export function getRecoveryActions(error: PlatformError): Array<{
  action: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}> {
  const actions: Array<{
    action: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }> = [];

  switch (error.category) {
    case 'authentication':
      actions.push({
        action: 'reconnect_account',
        description: 'Reconnect the social media account',
        priority: 'high',
      });
      break;

    case 'rate_limit':
      actions.push({
        action: 'schedule_for_later',
        description: 'Reschedule post for later',
        priority: 'high',
      });
      actions.push({
        action: 'reduce_frequency',
        description: 'Reduce posting frequency',
        priority: 'medium',
      });
      break;

    case 'media':
      actions.push({
        action: 'resize_media',
        description: 'Resize or compress media files',
        priority: 'high',
      });
      actions.push({
        action: 'change_format',
        description: 'Convert to supported format',
        priority: 'medium',
      });
      break;

    case 'content_policy':
      actions.push({
        action: 'edit_content',
        description: 'Modify content to comply with policies',
        priority: 'high',
      });
      break;

    case 'account_restriction':
      actions.push({
        action: 'check_account_status',
        description: 'Verify account is active and in good standing',
        priority: 'high',
      });
      break;
  }

  // Always add retry action if retryable
  if (error.retryable) {
    actions.push({
      action: 'retry',
      description: 'Retry posting',
      priority: 'low',
    });
  }

  return actions;
}

