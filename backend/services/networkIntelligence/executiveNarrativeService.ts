import { buildExecutiveSummary } from './executiveSummaryService';
import { fetchPlaybookEffectiveness } from './playbookEffectivenessService';
import { fetchNetworkIntelligence } from './networkIntelligenceService';
import {
  evaluateCommunityAiExecutiveNarrative,
  isOmniVyraEnabled,
} from '../omnivyraClientV1';

export type ExecutiveNarrativeInput = {
  tenant_id: string;
  organization_id: string;
  start_date?: string | null;
  end_date?: string | null;
};

export type ExecutiveNarrativePayload = {
  executive_summary: any;
  playbook_effectiveness: any;
  network_intelligence_snapshot: any;
  automation_levels: any;
  date_range: { start_date: string | null; end_date: string | null };
};

export type ExecutiveNarrativeOutput = {
  overview: string;
  key_shifts: string[];
  risks_to_watch: string[];
  recommendations_to_review: string[];
  explicitly_not_recommended: string[];
  confidence_level: number;
  source: 'omnivyra' | 'placeholder';
};

const clampConfidence = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const normalizeLine = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return (
      value.text ||
      value.message ||
      value.label ||
      value.title ||
      value.summary ||
      JSON.stringify(value)
    );
  }
  return String(value ?? '').trim();
};

const normalizeList = (value: any): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeLine(item)).filter((item) => item.trim().length > 0);
};

export const buildExecutiveNarrative = async (
  input: ExecutiveNarrativeInput
): Promise<ExecutiveNarrativeOutput> => {
  const { tenant_id, organization_id, start_date, end_date } = input;
  const filters = { tenant_id, organization_id, start_date, end_date };

  const [summary, playbookEffectiveness, networkIntelligence] = await Promise.all([
    buildExecutiveSummary(filters),
    fetchPlaybookEffectiveness(filters),
    fetchNetworkIntelligence(filters),
  ]);

  if (!isOmniVyraEnabled()) {
    return {
      overview: 'OmniVyra disabled.',
      key_shifts: [],
      risks_to_watch: [],
      recommendations_to_review: [],
      explicitly_not_recommended: [],
      confidence_level: 0,
      source: 'placeholder',
    };
  }

  const payload: ExecutiveNarrativePayload = {
    executive_summary: summary,
    playbook_effectiveness: playbookEffectiveness.records,
    network_intelligence_snapshot: networkIntelligence.summaries,
    automation_levels: summary.automation_mix,
    date_range: {
      start_date: start_date ?? null,
      end_date: end_date ?? null,
    },
  };

  const response = await evaluateCommunityAiExecutiveNarrative({
    tenant_id,
    organization_id,
    ...payload,
  });

  if (response.status !== 'ok') {
    console.warn('OMNIVYRA_EXECUTIVE_NARRATIVE_FALLBACK', {
      reason: response.error?.message,
    });
    return {
      overview: 'OmniVyra unavailable.',
      key_shifts: [],
      risks_to_watch: [],
      recommendations_to_review: [],
      explicitly_not_recommended: [],
      confidence_level: 0,
      source: 'placeholder',
    };
  }

  const data: any = response.data || {};
  return {
    overview: normalizeLine(data.overview || data.summary || ''),
    key_shifts: normalizeList(data.key_shifts),
    risks_to_watch: normalizeList(data.risks_to_watch || data.risks),
    recommendations_to_review: normalizeList(data.recommendations_to_review),
    explicitly_not_recommended: normalizeList(
      data.explicitly_not_recommended || data.not_recommended
    ),
    confidence_level: clampConfidence(
      typeof data.confidence_level === 'number' ? data.confidence_level : response.confidence ?? 0
    ),
    source: 'omnivyra',
  };
};
