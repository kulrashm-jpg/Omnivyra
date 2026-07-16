/** detected-opportunities API (Agent-B split — backend module, not a route). */
import { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../services/recommendationEngineService';
import { getCompanyDefaultApiIds } from '../../services/externalApiService';
import { enforceCompanyAccess } from '../../services/userContextService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { supabase } from '../../db/supabaseClient';
import { Role } from '../../services/rbacService';
import { withRBAC } from '../../middleware/withRBAC';
import { generateRecommendation } from '../../services/aiGateway';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../services/billing/phase2EnforcementGate';
import {
  countActive,
  upsertOpportunities,
  listActiveOpportunities,
  MAX_SLOTS_PER_TYPE,
  type OpportunityItem,
  type OpportunityInput,
} from '../../services/opportunityService';

export const DEFAULT_LOOKBACK_DAYS = 90;

export const riskFromConfidence = (confidence: number) => {
  if (confidence >= 0.75) return 'Low';
  if (confidence >= 0.5) return 'Medium';
  return 'High';
};

export const normalizeTopic = (value: string) => {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const computePriorityScore = (trend: any) => {
  const finalScore =
    typeof trend.final_score === 'number'
      ? trend.final_score
      : typeof trend.score === 'number'
      ? trend.score
      : null;
  const confidence =
    typeof trend.confidence === 'number'
      ? trend.confidence
      : typeof trend.signal_confidence === 'number'
      ? trend.signal_confidence
      : 0.6;
  const signalConfidence =
    typeof trend.signal_confidence === 'number' ? trend.signal_confidence : confidence;

  if (typeof finalScore === 'number') {
    return finalScore * 0.5 + confidence * 0.3 + signalConfidence * 0.2;
  }
  return confidence;
};

export const buildSignalExplanation = (signals: string[]) => {
  const signalCopy: Record<string, string> = {
    topic_overlap_detected: 'This overlaps with topics used in a recent campaign.',
    related_to_recent_campaign: 'This is related to a recent campaign you ran.',
    possible_campaign_continuation: 'This could continue momentum from a previous campaign.',
    novel_theme: 'This appears to be a new theme for your brand.',
  };
  return signals.map((signal) => signalCopy[signal]).filter(Boolean);
};

export const clampReasoning = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 2).join(' ');
};

export const normalizeList = (value?: string | null): string[] =>
  String(value || '')
    .split(/[,;/|]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const buildAudienceKeywords = (profile: any): string[] => {
  const list = Array.isArray(profile?.target_audience_list)
    ? profile.target_audience_list
    : normalizeList(profile?.target_audience);
  return list.map((item: string) => String(item).toLowerCase()).filter(Boolean);
};

export const computeAudienceMatch = (topic: string, keywords: string[]) => {
  if (!keywords.length) return 0;
  const lower = String(topic || '').toLowerCase();
  const matches = keywords.filter((keyword) => keyword && lower.includes(keyword)).length;
  return Math.min(1, matches / keywords.length);
};

export const clampScore = (value: number) => Math.max(0, Math.min(1, value));

