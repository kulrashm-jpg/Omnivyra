/**
 * Campaign Variant Config — serializer + accessors.
 *
 * Wraps the `execution_config.variant_strategy` field already
 * accepted by `POST /api/campaigns` (and echoed back on the GET
 * endpoint inside `campaign_snapshot.execution_config`). No schema
 * change. No migration. Variant config rides on the EXISTING
 * `campaign_snapshot.execution_config` JSONB.
 *
 * Shape:
 *   campaign_snapshot.execution_config.variant_strategy = {
 *     strategy_id: 'image:quote-image',
 *     variant_mode: 'top_3_variants',
 *   }
 *
 * Pure functions. No I/O.
 */

import type { CampaignVariantPersistedConfig } from '../../components/variant-experience/CampaignVariantModeField';
import type { VariantModeOption } from '../../components/variant-experience/VariantModeSelector';

/* ── Constants ──────────────────────────────────────────────────── */

/** JSON key under `execution_config` where the variant config lives. */
export const CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY = 'variant_strategy';

// P2-4 — 'default' kept here ONLY as a backward-compat alias so
// legacy persisted execution_config rows still parse. The read
// path translates it to 'v1' downstream.
const VALID_MODES: ReadonlyArray<string> = [
  'default', 'best_variant', 'v1', 'v2', 'v3', 'top_3_variants', 'experiment',
];

/* ── Serializer ─────────────────────────────────────────────────── */

/**
 * Embed the variant config under the canonical key on an
 * execution_config object. Pure — returns a new object so callers
 * can spread it into their own payload without aliasing.
 *
 * When the input `existing` already carries a variant_strategy
 * field, it is REPLACED outright (variant config is single-source).
 */
export function applyVariantConfigToExecutionConfig(
  existing: Record<string, unknown> | null | undefined,
  config: CampaignVariantPersistedConfig | null | undefined,
): Record<string, unknown> {
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? (existing as Record<string, unknown>)
    : {};
  if (!config || !config.strategy_id || !config.variant_mode) {
    // Removing variant config: omit the key entirely.
    const { [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: _omit, ...rest } = base;
    return rest;
  }
  return {
    ...base,
    [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: {
      strategy_id: config.strategy_id,
      variant_mode: config.variant_mode,
    },
  };
}

/**
 * Extract a `CampaignVariantPersistedConfig` from a campaign snapshot
 * envelope (the shape returned by the GET endpoint). Returns null
 * when the campaign has no variant config or it is malformed.
 */
export function readVariantConfigFromExecutionConfig(
  executionConfig: unknown,
): CampaignVariantPersistedConfig | null {
  if (!executionConfig || typeof executionConfig !== 'object' || Array.isArray(executionConfig)) return null;
  const raw = (executionConfig as Record<string, unknown>)[CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const strategyId = typeof obj.strategy_id === 'string' && obj.strategy_id.length > 0 ? obj.strategy_id : null;
  const variantModeRaw = typeof obj.variant_mode === 'string' ? obj.variant_mode : null;
  if (!strategyId || !variantModeRaw) return null;
  if (!(VALID_MODES as ReadonlyArray<string>).includes(variantModeRaw)) return null;
  // P2-4 — translate legacy 'default' to canonical 'v1' on read.
  const normalizedMode = (variantModeRaw === 'default' ? 'v1' : variantModeRaw) as VariantModeOption;
  return {
    strategy_id: strategyId,
    variant_mode: normalizedMode,
  };
}

/**
 * Read variant config off any of the shapes the GET endpoint may
 * return — `campaign_snapshot.execution_config`, top-level
 * `execution_config`, or the prefilled-planning `execution_config`
 * field. Returns null when none carry a variant config.
 */
export function readVariantConfigFromAnyCampaignShape(
  campaignLike: unknown,
): CampaignVariantPersistedConfig | null {
  if (!campaignLike || typeof campaignLike !== 'object') return null;
  const obj = campaignLike as Record<string, unknown>;
  // 1. Direct execution_config (e.g. test fixtures / loose callers)
  const direct = readVariantConfigFromExecutionConfig(obj.execution_config);
  if (direct) return direct;
  // 2. campaign_snapshot.execution_config (versions-table shape)
  const snap = obj.campaign_snapshot;
  if (snap && typeof snap === 'object') {
    const fromSnap = readVariantConfigFromExecutionConfig((snap as Record<string, unknown>).execution_config);
    if (fromSnap) return fromSnap;
  }
  // 3. Nested under campaign.config (defensive)
  const config = obj.config;
  if (config && typeof config === 'object') {
    const fromConfig = readVariantConfigFromExecutionConfig((config as Record<string, unknown>).execution_config);
    if (fromConfig) return fromConfig;
  }
  // 4. Prefilled-planning shape returned by GET (the snake_case echo)
  const prefilled = obj.prefilled_planning ?? obj.prefilledPlanning;
  if (prefilled && typeof prefilled === 'object') {
    const fromPre = readVariantConfigFromExecutionConfig((prefilled as Record<string, unknown>).execution_config);
    if (fromPre) return fromPre;
  }
  return null;
}

/**
 * Returns the variant_strategy execution_config slice for embedding
 * inside a campaign POST/PUT payload. Useful when the caller doesn't
 * already carry an execution_config — just spread the result into
 * `execution_config`:
 *
 *   const ec = buildExecutionConfigPatch(config);
 *   await fetch('/api/campaigns', {
 *     method: 'POST',
 *     body: JSON.stringify({ ..., execution_config: { ...prior, ...ec } }),
 *   });
 */
export function buildExecutionConfigPatch(
  config: CampaignVariantPersistedConfig | null | undefined,
): Record<string, unknown> {
  if (!config || !config.strategy_id || !config.variant_mode) return {};
  return {
    [CAMPAIGN_EXECUTION_CONFIG_VARIANT_KEY]: {
      strategy_id: config.strategy_id,
      variant_mode: config.variant_mode,
    },
  };
}
