export type ExistingItem = {
  id: string;
  title: string;
  slug: string | null;
  status?: string | null;
  views_count?: number | null;
};

export type FormatOption = {
  value: string;
  label: string;
  description: string;
  wordRange?: string;
};

export type RecommendationCard = {
  topic: string;
  reason: string;
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  priority: 'high' | 'medium' | 'low';
};

export type CardSuggestions = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

export type CardSelectionBundle = {
  topic: string;
  reason: string;
  targetWords: number;
  depthLabel: string;
  formatLabel: string;
  suggestions?: CardSuggestions;
  brief: {
    company_id: string;
    company_context: string;
    current_content: string;
    writing_style: string;
    related_titles: string[];
    intent: 'awareness' | 'authority' | 'conversion' | 'retention';
    tone: string;
  };
};

export type ManagedIntelligenceProps = {
  contentType: 'article' | 'guide' | 'story' | 'whitepaper' | 'case-study' | 'newsletter' | 'post' | 'thread';
  pageTitle: string;
  eyebrow: string;
  heading: string;
  icon: string;
  accentClassName: string;
  accentSurfaceClassName: string;
  backPath: string;
  createPath: string;
  templatePath: string;
  generatePath: string;
  formatOptions: FormatOption[];
  defaultFormat: string;
};

export const PRIORITY_STYLES = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
} as const;
