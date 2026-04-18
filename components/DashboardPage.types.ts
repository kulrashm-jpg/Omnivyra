/**
 * Shared types for DashboardPage.
 */

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  current_stage: string;
  start_date: string;
  end_date: string;
  created_at: string;
  platforms: string[];
  duration_weeks?: number | null;
}

export interface CampaignProgressData {
  percentage: number;
  contentCount: number;
  scheduledCount: number;
  publishedCount: number;
}

export interface DashboardStats {
  totalCampaigns: number;
  activeCampaigns: number;
  totalContent: number;
  publishedContent: number;
}

export type CompanyProfileReview = {
  due: boolean;
  pending_confirmation: boolean;
  last_confirmed_at: string | null;
  next_confirmation_due_at: string | null;
  confirmation_interval_days: number;
  facts_present: boolean;
};

export type CompanyFactSnapshot = {
  team_size?: string | null;
  founded_year?: string | null;
  revenue_range?: string | null;
};

export type CalendarExecutionStage =
  | 'weekly_planning'
  | 'daily_cards'
  | 'content_created'
  | 'content_scheduled'
  | 'content_shared'
  | 'overdue';

export type CalendarActivity = {
  campaign: Campaign;
  stage: CalendarExecutionStage;
  label: string;
  weekNumber?: number;
};
