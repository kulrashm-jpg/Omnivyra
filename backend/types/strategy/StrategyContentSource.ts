/**
 * Strategy domain — owned/external content as a first-class strategy object.
 * Phase-2 Step-5 Step-4.
 */

export type StrategyContentSourceType =
  | 'BLOG_URL'
  | 'VIDEO_URL'
  | 'PDF'
  | 'IMAGE'
  | 'DOCUMENT'
  | 'DRIVE_LINK'
  | 'EMBEDDED_ASSET'
  | 'UPLOADED_ASSET';

export type StrategyContentSourceLifecycle =
  | 'registered'
  | 'extracting'
  | 'extracted'
  | 'ready'
  | 'archived'
  | 'failed';

export interface StrategyContentSource {
  source_id: string;
  source_type: StrategyContentSourceType;
  source_url?: string | null;
  /** Storage / attachment reference when uploaded (not a public URL). */
  upload_reference?: string | null;
  /** Why this owned content exists in the strategy. */
  usage_intent?: string | null;
  ai_extraction_enabled: boolean;
  extraction_metadata?: Record<string, unknown> | null;
  /** Reusable across weeks/campaigns. */
  reusable: boolean;
  lifecycle_state: StrategyContentSourceLifecycle;
  created_at: string;
  updated_at: string;
}
