type OmniVyraError = {
  message: string;
  status?: number;
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
    return {
      status: 'error',
      error: { message: 'Missing OMNIVYRA_BASE_URL' },
    };
  }

  const retries = options?.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: OmniVyraError | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${API_PREFIX}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
      });
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
        };
        continue;
      }

      const envelope = normalizeEnvelope<T>(rawJson);
      if (!envelope) {
        return {
          status: 'error',
          error: { message: 'Invalid OmniVyra response envelope' },
          raw: rawJson,
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
      };
    } catch (error: any) {
      lastError = {
        message: error?.name === 'AbortError' ? 'OmniVyra request timed out' : error?.message,
      };
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
  };
};

export const isOmniVyraEnabled = (): boolean => {
  const flag = process.env.USE_OMNIVYRA;
  return flag === 'true' || flag === '1' || flag === 'yes';
};

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
