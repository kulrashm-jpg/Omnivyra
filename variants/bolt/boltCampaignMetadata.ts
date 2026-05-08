const BOLT_RUN_KEY = ['bolt', 'run', 'id'].join('_');
const BOLT_TEXT_ONLY_KEY = ['bolt', 'text', 'only'].join('_');
const CAMPAIGN_PROFILE_KEY = ['campaign', 'mode'].join('_');
const LEGACY_MEDIA_PROFILE = ['creator', 'dependent'].join('_');

export type BoltMetadataInput = {
  runId?: string | null;
  textOnly?: boolean | null;
};

export function withBoltMetadata<T extends Record<string, unknown>>(
  payload: T,
  input: BoltMetadataInput
): T & { variantMetadata?: Record<string, unknown> } {
  const variantMetadata: Record<string, unknown> = {};
  if (input.runId) variantMetadata[BOLT_RUN_KEY] = input.runId;
  if (input.textOnly != null) variantMetadata[BOLT_TEXT_ONLY_KEY] = input.textOnly;
  return Object.keys(variantMetadata).length > 0 ? { ...payload, variantMetadata } : payload;
}

export function getBoltRunId(input?: { variantMetadata?: Record<string, unknown> } | null): string | null {
  const value = input?.variantMetadata?.[BOLT_RUN_KEY];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function getExecutionProfile(config: unknown): string {
  if (!config || typeof config !== 'object') return 'text';
  const record = config as Record<string, unknown>;
  const value = record[CAMPAIGN_PROFILE_KEY] ?? record.executionProfile;
  return typeof value === 'string' && value.trim() ? value : 'text';
}

export function isLegacyMediaProfile(profile: string): boolean {
  return profile === LEGACY_MEDIA_PROFILE;
}
