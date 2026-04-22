/**
 * Shared types for BlogsPage.
 */

import type { ExistingPostMeta, ContentGap } from '../lib/blog/topicDetection';
import type { WritingStyleProfile } from '../lib/content/writingStyleEngine';

export type BlogStatus = 'draft' | 'published' | 'failed';

export interface Blog {
  id: string; company_id: string; title: string; content: string;
  status: BlogStatus; integration_id: string | null; external_id: string | null;
  published_at: string | null; created_at: string; updated_at: string;
  slug: string | null; excerpt: string | null; featured_image_url: string | null;
  category: string | null; tags: string[]; seo_meta_title: string | null;
  seo_meta_description: string | null; is_featured: boolean;
  angle_type?: string | null;
  views_count?: number;
  likes_count?: number;
  has_summary?: boolean;
  internal_links?: number;
  references_count?: number;
}

export interface BlogIntegration { id: string; name: string; type: string; status: string }

export interface PostMeta extends ExistingPostMeta {
  views_count:      number;
  likes_count:      number;
  status:           string;
  has_summary:      boolean;
  internal_links:   number;
  references_count: number;
  published_at:     string | null;
}

export interface SeriesPost {
  blog_id:  string;
  position: number;
  title:    string;
  slug:     string;
  status:   string;
}

export interface SeriesRow {
  id:                 string;
  title:              string;
  slug:               string;
  description:        string | null;
  blog_series_posts:  SeriesPost[];
}

export interface RelRow {
  id:               string;
  source_blog_id:   string;
  target_blog_id:   string;
  relationship_type: string;
}

export interface BriefInsight {
  company_id: string;
  company_name: string;
  company_context: string;
  current_content: string;
  writing_style: string;
  writing_style_profile: WritingStyleProfile | null;
  related_titles: string[];
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  tone: string;
}

export type EnrichedGap = ContentGap & { brief: BriefInsight };


export type DraftFieldSuggestions = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

export type TemplateSessionPayload = {
  blocks: any[];
  format_type?: string | null;
  template_name?: string;
  topic?: string;
  target_words?: number;
};
export default function BlogsTypesPage() {
  return null;
}
