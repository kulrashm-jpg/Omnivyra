import type {
  PrimaryCampaignTypeId,
  SecondaryOptionId,
} from '../../../lib/campaignTypeHierarchy';

export const TYPE = 'TREND';

export type ClusterInput = {
  problem_domain: string;
  signal_count: number;
  avg_intent_score: number;
  avg_urgency_score: number;
  priority_score: number;
};

export const TREND_CLUSTER_PAYLOAD_BRIDGE = 'trend_cluster_payload_bridge';
export const PULSE_TOPIC_BRIDGE = 'pulse_topic_bridge';

export type PulseTopicBridge = {
  topic: string;
  regions: string[];
  narrative_phase: string | null;
  momentum_score: number | null;
};

export function safeParseClusterPayload(raw: string): { cluster_inputs?: ClusterInput[]; context_mode?: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { cluster_inputs?: unknown }).cluster_inputs)) {
      return parsed as { cluster_inputs: ClusterInput[]; context_mode?: string };
    }
    return null;
  } catch {
    return null;
  }
}

export type ExecutionConfig = {
  target_audience: string;
  professional_segment: string | null;
  professional_segments: string[];
  communication_style: string[];
  content_depth: string;
  frequency_per_week: string;
  campaign_duration?: number;
  tentative_start: string | undefined;
  campaign_goal: string;
};

export type StrategicPayload = {
  context_mode: string;
  company_context: Record<string, unknown>;
  selected_offerings: string[];
  selected_aspect: string | null;
  selected_aspects?: string[];
  strategic_text: string;
  strategic_intents?: string[];
  regions?: string[];
  cluster_inputs?: ClusterInput[];
  focused_modules?: string[];
  additional_direction?: string;
  primary_campaign_type?: PrimaryCampaignTypeId;
  secondary_campaign_types?: SecondaryOptionId[];
  context?: 'business' | 'personal' | 'third_party';
  mapped_core_types?: string[];
  execution_config?: ExecutionConfig;
};

export type StrategyStatusForProgress = 'continuation' | 'expansion' | 'neutral' | 'momentum_expand' | undefined;

export type StrategicFlowState =
  | 'expansion'
  | 'momentum'
  | 'exploration'
  | 'consolidation'
  | 'default';

export type CardSignals = {
  journeyState: import('../cards/RecommendationBlueprintCard').JourneyState;
  confidenceTier: 'high' | 'medium' | 'low';
  momentumState: import('../cards/RecommendationBlueprintCard').MomentumState;
  strategyStatus: StrategyStatusForProgress;
  cardId?: string;
  cardTitle?: string;
};

/** Country name → ISO 2-letter code for autocomplete and resolution. */
export const ISO_COUNTRIES = [
  { name: 'India', code: 'IN' },
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Germany', code: 'DE' },
  { name: 'France', code: 'FR' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Singapore', code: 'SG' },
  { name: 'UAE', code: 'AE' },
  { name: 'Japan', code: 'JP' },
  { name: 'Indonesia', code: 'ID' },
  { name: 'Italy', code: 'IT' },
  { name: 'Spain', code: 'ES' },
  { name: 'Brazil', code: 'BR' },
  { name: 'Mexico', code: 'MX' },
  { name: 'Netherlands', code: 'NL' },
  { name: 'South Korea', code: 'KR' },
  { name: 'China', code: 'CN' },
  { name: 'Hong Kong', code: 'HK' },
  { name: 'Ireland', code: 'IE' },
  { name: 'New Zealand', code: 'NZ' },
  { name: 'South Africa', code: 'ZA' },
  { name: 'Sweden', code: 'SE' },
  { name: 'Norway', code: 'NO' },
  { name: 'Denmark', code: 'DK' },
  { name: 'Finland', code: 'FI' },
  { name: 'Poland', code: 'PL' },
  { name: 'Belgium', code: 'BE' },
  { name: 'Switzerland', code: 'CH' },
  { name: 'Austria', code: 'AT' },
  { name: 'Portugal', code: 'PT' },
  { name: 'Greece', code: 'GR' },
  { name: 'Turkey', code: 'TR' },
  { name: 'Israel', code: 'IL' },
  { name: 'Saudi Arabia', code: 'SA' },
  { name: 'Malaysia', code: 'MY' },
  { name: 'Thailand', code: 'TH' },
  { name: 'Philippines', code: 'PH' },
  { name: 'Vietnam', code: 'VN' },
  { name: 'Argentina', code: 'AR' },
  { name: 'Chile', code: 'CL' },
  { name: 'Colombia', code: 'CO' },
  { name: 'Egypt', code: 'EG' },
  { name: 'Nigeria', code: 'NG' },
  { name: 'Kenya', code: 'KE' },
  { name: 'Pakistan', code: 'PK' },
  { name: 'Bangladesh', code: 'BD' },
  { name: 'Sri Lanka', code: 'LK' },
  { name: 'Russia', code: 'RU' },
  { name: 'Ukraine', code: 'UA' },
  { name: 'Czech Republic', code: 'CZ' },
  { name: 'Romania', code: 'RO' },
  { name: 'Hungary', code: 'HU' },
];

export function matchCountry(query: string, country: { name: string; code: string }): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    country.name.toLowerCase().includes(q) ||
    country.code.toLowerCase() === q
  );
}

export function tokenToIsoCode(token: string): string {
  const t = token.trim();
  if (t.length === 2) {
    const byCode = ISO_COUNTRIES.find((c) => c.code.toLowerCase() === t.toLowerCase());
    if (byCode) return byCode.code.toUpperCase();
  }
  const byName = ISO_COUNTRIES.find((c) => c.name.toLowerCase() === t.toLowerCase());
  if (byName) return byName.code.toUpperCase();
  const startsWith = ISO_COUNTRIES.find((c) => c.name.toLowerCase().startsWith(t.toLowerCase()));
  if (startsWith) return startsWith.code.toUpperCase();
  return t.toUpperCase();
}

export function regionInputToIsoCodes(regionInput: string): string[] {
  const parts = regionInput.split(',').map((r) => r.trim()).filter(Boolean);
  return parts.map(tokenToIsoCode);
}
