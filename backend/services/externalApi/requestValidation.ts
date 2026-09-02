import type { ExternalApiSource, ExternalApiRequestDetails } from './types';
import { VALID_API_CATEGORIES } from './types';

export const AUTH_TYPES_REQUIRING_KEY = new Set(['api_key', 'bearer', 'query', 'header']);

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_RETRY_COUNT = 2;
export const DEFAULT_RATE_LIMIT_PER_MIN = 60;
export const DEFAULT_CACHE_TTL_MS = 12 * 60 * 1000;

export function validatePlatformConfig(input: Partial<ExternalApiSource>): {
  ok: boolean;
  message?: string;
} {
  const missing: string[] = [];
  if (!input.name?.trim()) missing.push('name');
  if (!input.base_url?.trim()) missing.push('base_url');
  if (!input.platform_type?.trim()) missing.push('platform_type');
  if (missing.length > 0) {
    return { ok: false, message: `Missing required fields: ${missing.join(', ')}` };
  }
  if (input.method && !['GET', 'POST'].includes(String(input.method).toUpperCase())) {
    return { ok: false, message: 'method must be GET or POST' };
  }
  if (input.supported_content_types && !Array.isArray(input.supported_content_types)) {
    return { ok: false, message: 'supported_content_types must be an array' };
  }
  if (input.promotion_modes && !Array.isArray(input.promotion_modes)) {
    return { ok: false, message: 'promotion_modes must be an array' };
  }
  if (input.headers && (typeof input.headers !== 'object' || Array.isArray(input.headers))) {
    return { ok: false, message: 'headers must be a JSON object' };
  }
  if (input.query_params && (typeof input.query_params !== 'object' || Array.isArray(input.query_params))) {
    return { ok: false, message: 'query_params must be a JSON object' };
  }
  return { ok: true };
}

export const normalizeRecord = (value: any): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

export const resolveEnvValue = (envName?: string | null): string | undefined => {
  if (!envName) return undefined;
  // SECURITY: the literal-key fallback was REMOVED — see the identical note in
  // `internalHelpers.resolveEnvValue`. A secret pasted into the NAME field must never
  // function as a credential. An env-var NAME resolves to its value; anything else
  // resolves to nothing.
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  return undefined;
};

export const applyOverrides = (
  base: Record<string, any>,
  overrides?: Record<string, any> | null
): Record<string, any> => {
  if (!overrides || typeof overrides !== 'object') return { ...base };
  const next = { ...base };
  Object.entries(overrides).forEach(([key, value]) => {
    if (typeof value === 'undefined') return;
    if (value === null) {
      delete next[key];
      return;
    }
    next[key] = value;
  });
  return next;
};

export const resolveAccessApiKeyEnvName = (
  source: ExternalApiSource,
  access?: { api_key_env_name?: string | null } | null
): string | null => {
  return access?.api_key_env_name ?? source.api_key_env_name ?? source.api_key_name ?? null;
};

export const extractPlaceholders = (value: string): string[] => {
  const matches = value.match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g) || [];
  return matches.map((match) => match.replace(/[{}]/g, '').trim());
};

const resolvePlaceholderName = (name: string, apiKeyEnvName?: string | null): string => {
  const normalized = name.trim();
  if (
    (normalized === 'api_key' || normalized === 'apiKey' || normalized === 'API_KEY') &&
    apiKeyEnvName
  ) {
    return apiKeyEnvName;
  }
  return normalized;
};

const replacePlaceholders = (
  value: string,
  envResolver: (name: string) => string | undefined,
  maskSecrets: boolean,
  apiKeyEnvName?: string | null,
  runtimeValues?: Record<string, string>
): { value: string; missing: string[] } => {
  const missing: string[] = [];
  const replaced = value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, envName) => {
    const runtimeValue = runtimeValues?.[envName];
    if (typeof runtimeValue !== 'undefined' && runtimeValue !== null) {
      return String(runtimeValue);
    }
    const resolvedName = resolvePlaceholderName(envName, apiKeyEnvName);
    const resolved = envResolver(resolvedName);
    const hasLowercase = /[a-z]/.test(envName);
    const shouldResolveEnv = resolvedName !== envName || !hasLowercase;
    if (!shouldResolveEnv) return match;
    if (!resolved) {
      missing.push(resolvedName);
      return match;
    }
    return maskSecrets ? '****' : resolved;
  });
  return { value: replaced, missing };
};

export const resolveRecordPlaceholders = (
  record: Record<string, any>,
  envResolver: (name: string) => string | undefined,
  maskSecrets: boolean,
  apiKeyEnvName?: string | null,
  runtimeValues?: Record<string, string>
): { resolved: Record<string, string>; missing: string[] } => {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  Object.entries(record).forEach(([key, rawValue]) => {
    if (rawValue === null || typeof rawValue === 'undefined') return;
    if (typeof rawValue === 'string') {
      const result = replacePlaceholders(rawValue, envResolver, maskSecrets, apiKeyEnvName, runtimeValues);
      resolved[key] = result.value;
      missing.push(...result.missing);
      return;
    }
    resolved[key] = String(rawValue);
  });
  return { resolved, missing };
};

export const buildMissingEnvPlaceholders = (missingEnv: string[]) =>
  Array.from(new Set(missingEnv)).map((envName) => `missing_env:${envName}`);

export const mapHttpErrorMessage = (status: number): string => {
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Not found';
  if (status === 429) return 'Rate limited';
  if (status >= 500) return 'Server error';
  return `HTTP ${status}`;
};

/** { re-export for convenience } */
export { VALID_API_CATEGORIES };
