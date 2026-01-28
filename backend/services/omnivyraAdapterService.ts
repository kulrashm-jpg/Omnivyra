import { getExplainability, isOmniVyraEnabled } from './omnivyraClientV1';

export type OmniVyraAdvisory = {
  hashtags: string[];
  timing: string | null;
  format: string | null;
  notes: string;
  source: 'placeholder' | 'omnivyra';
  omnivyra?: {
    decision_id?: string;
    confidence?: number;
    placeholders?: string[];
    explanation?: string;
    contract_version?: string;
    partial?: boolean;
  };
};

export async function getOmniVyraAdvisory(input: {
  recommendation?: string | null;
  context?: any;
}): Promise<OmniVyraAdvisory> {
  const recommendation = input.recommendation || '';
  if (!isOmniVyraEnabled()) {
    return {
      hashtags: [],
      timing: null,
      format: null,
      notes: recommendation ? recommendation : 'No OmniVyra advisory provided',
      source: recommendation ? 'omnivyra' : 'placeholder',
    };
  }

  const response = await getExplainability({
    recommendation: recommendation || null,
    context: input.context,
  });
  if (response.status !== 'ok') {
    console.warn('OMNIVYRA_FALLBACK_EXPLAIN', { reason: response.error?.message });
    return {
      hashtags: [],
      timing: null,
      format: null,
      notes: recommendation ? recommendation : 'No OmniVyra advisory provided',
      source: recommendation ? 'omnivyra' : 'placeholder',
    };
  }

  const data = response.data || {};
  return {
    hashtags: data.hashtags ?? [],
    timing: data.timing ?? null,
    format: data.format ?? null,
    notes: data.notes ?? data.explanation ?? recommendation ?? '',
    source: 'omnivyra',
    omnivyra: {
      decision_id: response.decision_id,
      confidence: response.confidence,
      placeholders: response.placeholders,
      explanation: response.explanation,
      contract_version: response.contract_version,
      partial: response.partial,
    },
  };
}
