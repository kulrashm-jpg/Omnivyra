/**
 * Feature Completion Tracking Types
 * Defines types and enums for activation milestone tracking
 */

/**
 * Enum of all trackable feature completion keys
 * These map to actual company/user data (not manual)
 */
export enum FeatureKey {
  // Core Setup
  COMPANY_PROFILE_COMPLETED = 'company_profile_completed',
  WEBSITE_CONNECTED = 'website_connected',
  
  // Content Creation
  BLOG_CREATED = 'blog_created',
  REPORT_GENERATED = 'report_generated',
  
  // Distribution & Engagement
  SOCIAL_ACCOUNTS_CONNECTED = 'social_accounts_connected',
  CAMPAIGN_CREATED = 'campaign_created',
  
  // Tools & Integration
  CHROME_EXTENSION_INSTALLED = 'chrome_extension_installed',
  API_CONFIGURED = 'api_configured',
}

/**
 * Feature completion status
 */
export type FeatureStatus = 'not_started' | 'in_progress' | 'completed';

/**
 * Database record for feature completion
 */
export interface FeatureCompletionRecord {
  id: string; // UUID
  company_id: string; // UUID
  user_id?: string; // UUID (optional)
  feature_key: FeatureKey;
  status: FeatureStatus;
  metadata?: Record<string, any>;
  completed_at?: string; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

/**
 * Computed feature completion (what we calculate)
 */
export interface ComputedFeature {
  key: FeatureKey;
  status: FeatureStatus;
  completedAt?: Date;
  reason?: string; // Why this status
}

/**
 * API response for feature completion
 */
export interface FeatureCompletionResponse {
  features: Array<{
    key: FeatureKey;
    status: FeatureStatus;
    completedAt?: string;
  }>;
  summary?: {
    total: number;
    completed: number;
    percentage: number;
  };
}

/**
 * Feature detection logic result
 */
export interface FeatureDetectionResult {
  isCompleted: boolean;
  reason: string;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Optional: Batch computation result
 */
export interface BatchComputeResult {
  companyId: string;
  features: ComputedFeature[];
  syncedAt: Date;
  changesCount: number;
}
