import { validateOmniVyraEnvelope } from './omnivyraContractService';
import {
  getHealthReport,
  recordFailure,
  recordSuccess,
  setLastMeta,
} from './omnivyraHealthService';

type OmniVyraError = {
  message: string;
  status?: number;
  error_type?: string;
};

export type OmniVyraEnvelope<T> = {
  decision_id: string;
  confidence: number;
  placeholders: string[];
  explanation: string;
  contract_version: string;
  data: T;
};

export type OmniVyraResponse<T> = {
  status: 'ok' | 'error';
  data?: T;
  decision_id?: string;
  confidence?: number;
  placeholders?: string[];
  explanation?: string;
  contract_version?: string;
  partial?: boolean;
  raw?: any;
  error?: OmniVyraError;
  _omnivyra_meta?: {
    latency_ms: number;
    contract_valid: boolean;
    error_type?: string;
    endpoint: string;
  };
};

export type TrendSignalInput = {
  topic: string;
  source?: string;
  geo?: string;
  velocity?: number;
  sentiment?: number;
  volume?: number;
};

export type TrendRelevanceResult = {
  relevant_trends?: Array<TrendSignalInput | { topic: string } | string>;
  ignored_trends?: Array<TrendSignalInput | { topic: string } | string>;
  trends?: Array<TrendSignalInput | { topic: string } | string>;
};

export type TrendRankingResult = {
  ranked_trends?: Array<
    | { topic: string; score?: number; rank?: number }
    | TrendSignalInput
    | string
  >;
  trends?: Array<TrendSignalInput | { topic: string } | string>;
};

export type PlatformRuleResult = {
  rule?: Record<string, any>;
  rules?: Record<string, any>[];
};

export type ContentBlueprintResult = {
  campaign?: any;
  weekly_plan?: any[];
  daily_plan?: any[];
  trend_alerts?: any;
  schedule_hints?: any[];
};

export type PromotionMetadataResult = {
  hashtags?: string[];
  keywords?: string[];
  seo_title?: string;
  seo_description?: string;
  meta_tags?: string[];
  alt_text?: string;
  cta?: string;
  confidence?: number;
};

export type ComplianceResult = {
  status?: 'ok' | 'warning' | 'block' | 'blocked';
  violations?: string[];
  warnings?: string[];
};

export type ExplainabilityResult = {
  notes?: string;
  explanation?: string;
  hashtags?: string[];
  timing?: string | null;
  format?: string | null;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;
const API_PREFIX = '/api/v1/omnivyra';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isNonEmptyString = (value: any): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseNumber = (value: any): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
};

const parsePlaceholders = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
};

const getBaseUrl = (): string | null => {
  const baseUrl = process.env.OMNIVYRA_BASE_URL;
  if (!baseUrl) {
    return null;
  }
  return baseUrl.replace(/\/$/, '');
};

const logOmniVyraMeta = (payload: {
  path: string;
  decision_id?: string;
  confidence?: number;
  placeholders?: string[];
  explanation?: string;
  contract_version?: string;
}) => {
  console.log('OMNIVYRA_RESPONSE', payload);
  if (payload.confidence !== undefined) {
    console.log('OMNIVYRA_CONFIDENCE', {
      path: payload.path,
      confidence: payload.confidence,
    });
    if (payload.confidence < 0.5) {
      console.warn('OMNIVYRA_LOW_CONFIDENCE', {
        path: payload.path,
        confidence: payload.confidence,
      });
    }
  }
  if (payload.placeholders) {
    console.log('OMNIVYRA_PLACEHOLDERS', {
      path: payload.path,
      placeholders: payload.placeholders,
    });
  }
  if (payload.explanation) {
    console.log('OMNIVYRA_EXPLANATION', {
      path: payload.path,
      explanation: payload.explanation,
    });
  }
};

const normalizeEnvelope = <T>(rawJson: any): OmniVyraEnvelope<T> | null => {
  const decisionId = rawJson?.decision_id;
  const confidence = parseNumber(rawJson?.confidence);
  const placeholders = parsePlaceholders(rawJson?.placeholders);
  const explanation = rawJson?.explanation;
  const contractVersion = rawJson?.contract_version;

  if (!isNonEmptyString(decisionId)) return null;
  if (confidence === null) return null;
  if (!isNonEmptyString(explanation)) return null;
  if (!isNonEmptyString(contractVersion)) return null;

  const data =
    rawJson?.data ??
    rawJson?.result ??
    rawJson?.payload ??
    rawJson?.intelligence ??
    rawJson;

  return {
    decision_id: decisionId,
    confidence,
    placeholders,
    explanation,
    contract_version: contractVersion,
    data: data as T,
  };
};

const requestOmniVyra = async <T>(
  path: string,
  payload: any,
  options?: { timeoutMs?: number; retries?: number }
): Promise<OmniVyraResponse<T>> => {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    recordFailure(path, 'unknown', 'Missing OMNIVYRA_BASE_URL');
    setLastMeta({
      endpoint: path,
      latency_ms: 0,
      contract_valid: false,
      error_type: 'omnivyra_unavailable',
    });
    return {
      status: 'error',
      error: { message: 'Missing OMNIVYRA_BASE_URL', error_type: 'omnivyra_unavailable' },
      _omnivyra_meta: {
        latency_ms: 0,
        contract_valid: false,
        error_type: 'omnivyra_unavailable',
        endpoint: path,
      },
    };
  }

  const retries = options?.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: OmniVyraError | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl}${API_PREFIX}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      const rawText = await response.text();
      let rawJson: any = null;
      if (rawText) {
        try {
          rawJson = JSON.parse(rawText);
        } catch {
          rawJson = { raw_text: rawText };
        }
      }

      if (!response.ok) {
        lastError = {
          message: rawJson?.error || response.statusText || 'OmniVyra error',
          status: response.status,
          error_type: 'http_error',
        };
        recordFailure(path, 'http_error', lastError.message);
        setLastMeta({
          endpoint: path,
          latency_ms: latencyMs,
          contract_valid: false,
          error_type: 'http_error',
        });
        continue;
      }

      const contract = validateOmniVyraEnvelope(rawJson);
      const envelope = normalizeEnvelope<T>(rawJson);
      if (!contract.valid || !envelope) {
        const errorType = contract.errors.some((error) => error.includes('contract_version'))
          ? 'version_mismatch'
          : 'schema_invalid';
        recordFailure(path, errorType, contract.errors.join('; '));
        setLastMeta({
          endpoint: path,
          latency_ms: latencyMs,
          contract_valid: false,
          error_type: errorType,
        });
        return {
          status: 'error',
          error: { message: 'Invalid OmniVyra response envelope', error_type: errorType },
          raw: rawJson,
          _omnivyra_meta: {
            latency_ms: latencyMs,
            contract_valid: false,
            error_type: errorType,
            endpoint: path,
          },
        };
      }

      const partial = envelope.placeholders.length > 0;
      logOmniVyraMeta({
        path,
        decision_id: envelope.decision_id,
        confidence: envelope.confidence,
        placeholders: envelope.placeholders,
        explanation: envelope.explanation,
        contract_version: envelope.contract_version,
      });

      recordSuccess(path, latencyMs);
      setLastMeta({
        endpoint: path,
        latency_ms: latencyMs,
        contract_valid: true,
        contract_version: envelope.contract_version,
      });
      return {
        status: 'ok',
        data: envelope.data,
        decision_id: envelope.decision_id,
        confidence: envelope.confidence,
        placeholders: envelope.placeholders,
        explanation: envelope.explanation,
        contract_version: envelope.contract_version,
        partial,
        raw: rawJson,
        _omnivyra_meta: {
          latency_ms: latencyMs,
          contract_valid: true,
          endpoint: path,
        },
      };
    } catch (error: any) {
      const errType = (error?.name === 'AbortError' ? 'timeout' : 'unknown') as 'timeout' | 'unknown';
      lastError = {
        message: error?.name === 'AbortError' ? 'OmniVyra request timed out' : error?.message,
        error_type: errType,
      };
      recordFailure(path, errType, lastError.message);
      setLastMeta({
        endpoint: path,
        latency_ms: timeoutMs,
        contract_valid: false,
        error_type: (lastError.error_type ?? 'unknown') as 'timeout' | 'schema_invalid' | 'http_error' | 'omnivyra_unavailable' | 'version_mismatch' | 'unknown',
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < retries) {
      await sleep(250 * Math.pow(2, attempt));
    }
  }

  return {
    status: 'error',
    error: lastError || { message: 'OmniVyra request failed' },
    _omnivyra_meta: {
      latency_ms: timeoutMs,
      contract_valid: false,
      error_type: (lastError?.error_type ?? 'unknown') as 'timeout' | 'schema_invalid' | 'http_error' | 'omnivyra_unavailable' | 'version_mismatch' | 'unknown',
      endpoint: path,
    },
  };
};

export const isOmniVyraEnabled = (): boolean => {
  const flag = process.env.USE_OMNIVYRA;
  return flag === 'true' || flag === '1' || flag === 'yes';
};

export const getOmniVyraHealthReport = () => getHealthReport(isOmniVyraEnabled());

export const getTrendRelevance = (input: {
  signals: TrendSignalInput[];
  geo?: string;
  category?: string;
  companyProfile?: any;
}) => requestOmniVyra<TrendRelevanceResult>('/trends/relevance', input);

export const getTrendRanking = (input: {
  signals: TrendSignalInput[];
  geo?: string;
  category?: string;
  companyProfile?: any;
}) => requestOmniVyra<TrendRankingResult>('/trends/rank', input);

export const getPlatformRules = (input: { platform: string; contentType: string }) =>
  requestOmniVyra<PlatformRuleResult>('/platform/rules/canonical', input);

export const getContentBlueprint = (input: {
  companyProfile: any;
  objective: string;
  durationWeeks: number;
  contentCapabilities: any;
  platformRules?: any;
}) => requestOmniVyra<ContentBlueprintResult>('/content/blueprint', input);

export const getPromotionMetadata = (input: {
  companyId: string;
  contentAssetId: string;
  platform: string;
  content: any;
}) => requestOmniVyra<PromotionMetadataResult>('/promotion/intelligence', input);

export const checkPlatformCompliance = (input: {
  contentAssetId: string;
  platform: string;
  contentType: string;
  formattedContent: string;
  rule: any;
  promotionMetadata: any;
}) => requestOmniVyra<ComplianceResult>('/platform/compliance/intelligence', input);

export const getExplainability = (input: { recommendation?: string | null; context?: any }) =>
  requestOmniVyra<ExplainabilityResult>('/explain', input);

export type CommunityAiEvaluationResult = {
  analysis?: string;
  suggested_actions?: any[];
  content_improvement?: any;
  safety_classification?: any;
  execution_links?: any;
};

export const evaluateCommunityAiEngagement = (input: {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  post_data?: any;
  engagement_metrics?: any;
  goals?: any;
  brand_voice: string;
  context?: any;
}) => requestOmniVyra<CommunityAiEvaluationResult>('/community/engagement/evaluate', input);

export type CommunityAiInsightsResult = {
  summary_insight?: string;
  key_findings?: any[];
  recommended_actions?: any[];
  risks?: any;
  confidence_level?: number;
};

export const evaluateCommunityAiInsights = (input: {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  content_type?: string | null;
  kpis: any;
  trends: any;
  anomalies: any;
  brand_voice: string;
  recent_content_summary?: any;
}) => requestOmniVyra<CommunityAiInsightsResult>('/community/insights/evaluate', input);

export type CommunityAiForecastInsightsResult = {
  explanation_summary?: string;
  key_drivers?: any[];
  risks?: any[];
  recommended_actions?: any[];
  confidence_level?: number;
};

export const evaluateCommunityAiForecastInsights = (input: {
  tenant_id: string;
  organization_id: string;
  platform?: string | null;
  content_type?: string | null;
  forecast: any;
  trends: any;
  anomalies: any;
  kpis: any;
  brand_voice: string;
  recent_content_summary?: any;
}) => requestOmniVyra<CommunityAiForecastInsightsResult>('/community/forecast/insights', input);

export type CommunityAiExecutiveNarrativeResult = {
  overview?: string;
  key_shifts?: any[];
  risks_to_watch?: any[];
  recommendations_to_review?: any[];
  explicitly_not_recommended?: any[];
  confidence_level?: number;
};

export const evaluateCommunityAiExecutiveNarrative = (input: {
  tenant_id: string;
  organization_id: string;
  executive_summary: any;
  playbook_effectiveness: any;
  network_intelligence_snapshot: any;
  automation_levels: any;
  date_range?: { start_date: string | null; end_date: string | null };
}) => requestOmniVyra<CommunityAiExecutiveNarrativeResult>('/community/executive/narrative', input);
