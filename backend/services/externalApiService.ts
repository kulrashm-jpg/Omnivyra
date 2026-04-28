// Re-export facade — implementation split into sub-modules under externalApi/
// Explicit named exports are used throughout to avoid duplicate-export conflicts
// between sub-modules that share helpers.

// ── Types ─────────────────────────────────────────────────────────────────────
export * from './externalApi/types';

// ── Request validation & constants ───────────────────────────────────────────
export {
  AUTH_TYPES_REQUIRING_KEY,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRY_COUNT,
  DEFAULT_RATE_LIMIT_PER_MIN,
  DEFAULT_CACHE_TTL_MS,
  validatePlatformConfig,
  normalizeRecord,
  resolveEnvValue,
  applyOverrides,
  resolveAccessApiKeyEnvName,
  extractPlaceholders,
  resolveRecordPlaceholders,
  buildMissingEnvPlaceholders,
  mapHttpErrorMessage,
} from './externalApi/requestValidation';

// ── Access checks ─────────────────────────────────────────────────────────────
export { isApiSourceExecutable, getEnabledApiIdsFromCompanyConfig } from './externalApi/accessChecks';

// ── Response mapping & signal confidence ──────────────────────────────────────
export {
  getSourceWeight,
  computeSignalConfidence,
  recordSignalConfidenceSummary,
  resetSignalConfidenceSummary,
  lastSignalConfidenceSummary,
  normalizeTrendSignals,
  toTrendInput,
  mapOmnivyraTrends,
  applyRankingOrder,
  computeFreshnessScore,
  computeReliabilityScore,
} from './externalApi/responseMapping';

// ── Internal helpers (profile, fetch, rate-limit) ─────────────────────────────
export {
  sourceReliabilityWeights,
  buildProfileRuntimeValues,
  fetchWithRetry,
  isRateLimited,
  getHealthForSource as getHealthForSourceInternal,
} from './externalApi/internalHelpers';

// ── Usage logging ─────────────────────────────────────────────────────────────
export {
  buildUsageUserId,
  buildFeatureUsageUserId,
  resolveUsageDate,
  logExternalApiUsage,
  addSignalsGenerated,
} from './externalApi/usageLogging';

// ── DB helpers ────────────────────────────────────────────────────────────────
export {
  fetchHealthMapForApiIds,
  getHealthForSource,
  checkCompanyApiLimitsForPolling,
  recordApiHealth,
} from './externalApi/dbHelpers';

// ── Platform config ───────────────────────────────────────────────────────────
export {
  savePlatformConfig,
  saveTenantPlatformConfig,
  getPlatformConfigs,
  getSocialPostingConfigs,
  getPlatformStrategies,
  getPlatformConfigByPlatform,
  getApiConfigByPlatform,
  getApiHealthByPlatform,
} from './externalApi/platformConfig';

// ── User access ───────────────────────────────────────────────────────────────
export {
  getCompanyDefaultApiIds,
  getEnabledApis,
  getAvailableApis,
  getUserApiAccess,
  getExternalApiSourcesForUser,
  getExternalApiSourceById,
} from './externalApi/userAccess';

// ── Execution ─────────────────────────────────────────────────────────────────
export {
  executeExternalApiRequest,
  buildExternalApiRequest,
  executeWithAccountLoop,
} from './externalApi/execution';

// ── Trend fetching ────────────────────────────────────────────────────────────
export {
  fetchTrendsFromApis,
  fetchExternalTrends,
  fetchExternalApis,
} from './externalApi/trendFetching';

// ── Single-source fetchers & runtime utils ────────────────────────────────────
export {
  INTELLIGENCE_POLLER_USER_ID,
  fetchSingleSourceWithQueryBuilder,
  fetchSingleSourceForIntelligencePolling,
  validateExternalApiSource,
  getExternalApiRuntimeSnapshot,
  resetExternalApiRuntime,
} from './externalApi/singleSourceFetcher';
