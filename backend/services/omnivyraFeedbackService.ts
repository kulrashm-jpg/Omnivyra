type LearningSnapshot = {
  companyId: string;
  campaignId?: string;
  trends_used: Array<{ topic: string; source?: string; signal_confidence?: number }>;
  trends_ignored: Array<{ topic: string; source?: string }>;
  signal_confidence_summary?: { average: number; min: number; max: number } | null;
  novelty_score?: number;
  confidence_score?: number;
  placeholders?: string[];
  explanation?: string;
  external_api_health_snapshot?: any;
  performance_metrics?: any;
  optimization_reason?: string;
  drift_flags?: any;
  timestamp: string;
};

type LearningSendResult = {
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  payload_preview?: Partial<LearningSnapshot>;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRY_COUNT = 2;
const API_PREFIX = '/api/v1/omnivyra';

const lastLearningStatus = new Map<string, LearningSendResult>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBaseUrl = () => {
  const baseUrl = process.env.OMNIVYRA_BASE_URL;
  return baseUrl ? baseUrl.replace(/\/$/, '') : null;
};

const isOmniVyraEnabled = () => {
  const flag = process.env.USE_OMNIVYRA;
  return flag === 'true' || flag === '1' || flag === 'yes';
};

const buildPreview = (snapshot: LearningSnapshot) => ({
  companyId: snapshot.companyId,
  campaignId: snapshot.campaignId,
  trends_used: snapshot.trends_used.slice(0, 5),
  trends_ignored: snapshot.trends_ignored.slice(0, 5),
  signal_confidence_summary: snapshot.signal_confidence_summary ?? null,
  novelty_score: snapshot.novelty_score,
  confidence_score: snapshot.confidence_score,
  placeholders: snapshot.placeholders ?? [],
  explanation: snapshot.explanation,
  timestamp: snapshot.timestamp,
});

export const sendLearningSnapshot = async (snapshot: LearningSnapshot): Promise<LearningSendResult> => {
  if (!isOmniVyraEnabled()) {
    const result = { status: 'skipped', payload_preview: buildPreview(snapshot) } as LearningSendResult;
    if (snapshot.campaignId) {
      lastLearningStatus.set(snapshot.campaignId, result);
    }
    return result;
  }

  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    const result = {
      status: 'failed',
      error: 'Missing OMNIVYRA_BASE_URL',
      payload_preview: buildPreview(snapshot),
    } as LearningSendResult;
    if (snapshot.campaignId) {
      lastLearningStatus.set(snapshot.campaignId, result);
    }
    console.warn('OMNIVYRA_LEARNING_FAILED', { reason: result.error });
    return result;
  }

  const url = `${baseUrl}${API_PREFIX}/learning/ingest`;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= DEFAULT_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
        signal: controller.signal,
      });
      if (response.ok) {
        const result = {
          status: 'sent',
          payload_preview: buildPreview(snapshot),
        } as LearningSendResult;
        if (snapshot.campaignId) {
          lastLearningStatus.set(snapshot.campaignId, result);
        }
        return result;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error: any) {
      lastError = error?.name === 'AbortError' ? 'Timeout' : error?.message || 'Request failed';
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < DEFAULT_RETRY_COUNT) {
      await sleep(400 * Math.pow(2, attempt));
    }
  }

  const result = {
    status: 'failed',
    error: lastError || 'Request failed',
    payload_preview: buildPreview(snapshot),
  } as LearningSendResult;
  if (snapshot.campaignId) {
    lastLearningStatus.set(snapshot.campaignId, result);
  }
  console.warn('OMNIVYRA_LEARNING_FAILED', { reason: result.error });
  return result;
};

export const getLearningStatus = (campaignId?: string | null): LearningSendResult | null => {
  if (!campaignId) return null;
  return lastLearningStatus.get(campaignId) ?? null;
};
