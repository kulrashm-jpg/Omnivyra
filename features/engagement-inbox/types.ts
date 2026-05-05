// Shared types for the engagement-inbox module.

export type CampaignSignal = {
  id: string;
  campaign_id: string;
  activity_id: string;
  platform: string;
  author?: string | null;
  content?: string | null;
  signal_type: string;
  conversation_url?: string | null;
  engagement_score: number;
  detected_at: string;
  signal_status?: string;
};

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type IntelligenceState = {
  insight: string | null;
  hints: string[];
  confidence: { level: ConfidenceLevel; score: number };
  recommendation?: { type: string; label: string } | null;
} | null;

export type ActionNotice = { kind: 'success' | 'error'; text: string } | null;

export type Campaign = { id: string; name: string };
