/**
 * Profile adapter — bridges renderer-side `applied_render_strategy`
 * envelope onto the `VariantComparisonView` profile shape.
 *
 * The renderer (Strategy-Aware Rendering phase) writes an
 * `applied_render_strategy` envelope onto each generated asset's
 * `media_bundle.metadata`. Per-variant assets ALSO carry an
 * `applied_variant` envelope. This adapter takes either envelope
 * (or both) and returns the four operator-readable profile strings
 * the comparison view needs.
 *
 * Pure function. No I/O.
 */

import type {
  StrategyAnalyticsPayload,
  VariantDefinition,
} from '../../components/variant-experience/useVariantApi';
import type { VariantComparisonRow } from '../../components/variant-experience';

/* ── Envelope shape (loose — matches renderer output) ──────────── */

type AppliedRenderStrategyEnvelope = {
  id?: string;
  typography_profile?: string;
  branding_profile?: string;
  density_profile?: string;
  cta_profile?: string;
  visual_emphasis_profile?: string;
};

type AppliedVariantEnvelope = {
  variant_id?: string;
  variant_family?: string;
  display_name?: string;
  description?: string;
  reasoning?: string;
};

/* ── Profile resolver ─────────────────────────────────────────── */

/**
 * Build a `VariantComparisonRow` from a `VariantDefinition` and
 * optional render-strategy envelope. Profile fields are populated
 * only when the envelope carries the corresponding `*_profile`
 * string; missing fields are left undefined so the comparison view
 * renders `—`.
 */
export function buildComparisonRow(
  variant: VariantDefinition,
  options: {
    renderStrategyEnvelope?: AppliedRenderStrategyEnvelope | null;
    appliedVariant?: AppliedVariantEnvelope | null;
    metrics?: VariantComparisonRow['metrics'];
  } = {},
): VariantComparisonRow {
  const env = options.renderStrategyEnvelope ?? null;
  return {
    variant,
    metrics: options.metrics ?? null,
    profiles: {
      typography: env?.typography_profile,
      branding: env?.branding_profile,
      density: env?.density_profile,
      cta: env?.cta_profile,
    },
  };
}

/**
 * Build a full set of comparison rows for every declared variant of
 * a strategy. Pulls performance metrics from the strategy-analytics
 * payload's variant leaderboard; pulls profile strings from the
 * matching explainability entry when available.
 *
 * The variant exploration phase guarantees 3 variants per strategy,
 * so the output is typically 3 rows.
 */
export function buildComparisonRowsForStrategy(input: {
  strategyId: string;
  analytics: StrategyAnalyticsPayload | null;
}): VariantComparisonRow[] {
  const { strategyId, analytics } = input;
  if (!analytics) return [];
  const variants = analytics.variants.catalog.filter((v) => v.strategy_id === strategyId);
  const leaderboard = analytics.variants.leaderboards.find((entry) => entry.strategy_id === strategyId)?.leaderboard ?? [];
  const explainability = analytics.explainability.find((entry: any) => entry?.strategy_id === strategyId) ?? null;
  // The strategy-analytics payload's explainability entry carries the
  // `typography_profile` / `branding_profile` / `density_profile` /
  // `cta_profile` strings under different keys depending on the source
  // (variant vs strategy). Adapter normalizes them.
  const envelope: AppliedRenderStrategyEnvelope | null = explainability
    ? {
        typography_profile: explainability.typography_profile ?? explainability.typographyProfile,
        branding_profile:   explainability.branding_profile   ?? explainability.brandingProfile,
        density_profile:    explainability.density_profile    ?? explainability.densityProfile,
        cta_profile:        explainability.cta_profile        ?? explainability.ctaProfile,
      }
    : null;
  return variants.map((variant) => {
    const lbRow = leaderboard.find((r: any) => r?.variant_id === variant.variant_id);
    const metrics = lbRow
      ? {
          engagementRate: Number(lbRow.metrics?.engagementRate ?? 0),
          saveRate:       Number(lbRow.metrics?.saveRate ?? 0),
          shareRate:      Number(lbRow.metrics?.shareRate ?? 0),
          sampleSize:     Number(lbRow.metrics?.sampleSize ?? 0),
        }
      : null;
    return buildComparisonRow(variant, {
      renderStrategyEnvelope: envelope,
      metrics,
    });
  });
}

/**
 * Extract the rendered asset's render-strategy envelope from its
 * media_bundle.metadata. The Creator/Writer surfaces store the most
 * recent generation result; this helper pulls the envelope into the
 * adapter-friendly shape so the comparison view can render the
 * actual profiles applied to the latest asset.
 */
export function extractRenderStrategyEnvelopeFromMetadata(
  metadata: unknown,
): AppliedRenderStrategyEnvelope | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = metadata as Record<string, unknown>;
  const raw = meta.applied_render_strategy;
  if (!raw || typeof raw !== 'object') return null;
  const env = raw as Record<string, unknown>;
  return {
    id: typeof env.id === 'string' ? env.id : undefined,
    typography_profile: typeof env.typography_profile === 'string' ? env.typography_profile : undefined,
    branding_profile:   typeof env.branding_profile === 'string' ? env.branding_profile : undefined,
    density_profile:    typeof env.density_profile === 'string' ? env.density_profile : undefined,
    cta_profile:        typeof env.cta_profile === 'string' ? env.cta_profile : undefined,
    visual_emphasis_profile: typeof env.visual_emphasis_profile === 'string' ? env.visual_emphasis_profile : undefined,
  };
}

/* P3-6 cleanup — `extractAppliedVariantFromMetadata` removed (no
 * production caller).  Kept the AppliedVariantEnvelope type local
 * since `buildComparisonRow` accepts it as an optional input shape. */
