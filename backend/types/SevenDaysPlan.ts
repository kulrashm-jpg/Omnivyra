/**
 * Seven Days Plan — detailed 7-day blueprint per week.
 * Mirrors twelve_week_plan.weeks conceptually; holds "book-level" detail per day.
 */

export interface PlatformContentItem {
  platform: string;
  content_type: string;
  title?: string;
  description?: string;
  references?: string[];
}

export interface SevenDaysPlanDay {
  day: string; // Monday, Tuesday, ...
  intro_objective?: string;
  key_message?: string;
  supporting_points?: string[];
  cta?: string;
  brand_voice?: string;
  best_posting_time?: string;
  content_format_notes?: string;
  topic_linkage?: string;
  platform_content?: PlatformContentItem[];
}

export interface SevenDaysPlan {
  campaign_id: string;
  week_number: number;
  week_theme?: string;
  week_phase_label?: string;
  week_topics?: string[];
  days: SevenDaysPlanDay[];
  source?: string;
  status?: 'draft' | 'questions_pending' | 'committed' | 'edited';
}
