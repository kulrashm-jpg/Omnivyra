import { supabase } from '../db/supabaseClient';

export type ActionRegistryEntry = {
  action_type: string;
  handler_key: string;
  required_payload_fields: string[];
  instruction_code?: string;
  action_category?: ActionCategory;
  is_active: boolean;
};

export type ActionCategory =
  | 'content'
  | 'seo'
  | 'conversion'
  | 'distribution'
  | 'trust';

type StaticActionRegistryEntry = {
  handlerKey: string;
  requiredPayloadFields: string[];
  instructionCode: string;
  category: ActionCategory;
};

const ACTION_REGISTRY: Record<string, StaticActionRegistryEntry> = {
  fix_cta: {
    handlerKey: 'CTAService.execute',
    requiredPayloadFields: ['campaign_id'],
    instructionCode: 'CTA_FIX',
    category: 'conversion',
  },
  improve_content: {
    handlerKey: 'ContentService.generate',
    requiredPayloadFields: [],
    instructionCode: 'CONTENT_IMPROVEMENT',
    category: 'content',
  },
  reallocate_budget: {
    handlerKey: 'AdsService.adjust',
    requiredPayloadFields: ['campaign_id'],
    instructionCode: 'BUDGET_REALLOCATION',
    category: 'conversion',
  },
  launch_campaign: {
    handlerKey: 'CampaignService.launch',
    requiredPayloadFields: [],
    instructionCode: 'CAMPAIGN_LAUNCH',
    category: 'distribution',
  },
  fix_distribution: {
    handlerKey: 'DistributionService.repair',
    requiredPayloadFields: [],
    instructionCode: 'DISTRIBUTION_REPAIR',
    category: 'distribution',
  },
  capture_leads: {
    handlerKey: 'LeadService.capture',
    requiredPayloadFields: ['opportunity_type'],
    instructionCode: 'LEAD_CAPTURE',
    category: 'conversion',
  },
  improve_tracking: {
    handlerKey: 'TrackingService.audit',
    requiredPayloadFields: ['campaign_id'],
    instructionCode: 'TRACKING_IMPROVEMENT',
    category: 'trust',
  },
  adjust_strategy: {
    handlerKey: 'StrategyService.adjust',
    requiredPayloadFields: ['campaign_id'],
    instructionCode: 'STRATEGY_ADJUSTMENT',
    category: 'seo',
  },
  apply_learning: {
    handlerKey: 'LearningService.apply',
    requiredPayloadFields: ['campaign_id'],
    instructionCode: 'LEARNING_APPLICATION',
    category: 'trust',
  },
};

export function getActionInstructionCode(actionType: string): string {
  const configured = ACTION_REGISTRY[actionType];
  if (configured?.instructionCode) return configured.instructionCode;

  return String(actionType || 'manual_action')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'MANUAL_ACTION';
}

export function getActionCategory(actionType: string): ActionCategory {
  return ACTION_REGISTRY[actionType]?.category ?? 'content';
}

export function getActionCategoryFromInstructionCode(instructionCode: string): ActionCategory {
  const normalized = String(instructionCode || '').trim().toUpperCase();
  const match = Object.values(ACTION_REGISTRY).find((entry) => entry.instructionCode === normalized);
  return match?.category ?? 'content';
}

export async function getActionRegistryEntry(actionType: string): Promise<ActionRegistryEntry | null> {
  const configured = ACTION_REGISTRY[actionType];
  if (configured) {
    return {
      action_type: actionType,
      handler_key: configured.handlerKey,
      required_payload_fields: configured.requiredPayloadFields,
      instruction_code: configured.instructionCode,
      action_category: configured.category,
      is_active: true,
    };
  }

  const { data, error } = await supabase
    .from('action_registry')
    .select('action_type, handler_key, required_payload_fields, is_active')
    .eq('action_type', actionType)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as ActionRegistryEntry;
}

export async function validateActionPayload(actionType: string, payload: Record<string, unknown>): Promise<void> {
  const entry = await getActionRegistryEntry(actionType);
  if (!entry) {
    throw new Error(`Decision action_type "${actionType}" is not registered.`);
  }

  for (const field of entry.required_payload_fields ?? []) {
    if (!(field in payload)) {
      throw new Error(`Decision action_payload missing required field "${field}" for action "${actionType}".`);
    }
  }
}

export function getActionRegistrySnapshot(): Record<string, { handlerKey: string; requiredPayloadFields: string[] }> {
  return Object.fromEntries(
    Object.entries(ACTION_REGISTRY).map(([key, value]) => [
      key,
      {
        handlerKey: value.handlerKey,
        requiredPayloadFields: value.requiredPayloadFields,
      },
    ])
  );
}
