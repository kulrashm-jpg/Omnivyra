/**
 * Repurpose Learning Service
 * Records repurpose transformations for campaign performance learning.
 * Initially logging-only; will later feed into campaign_performance_signals.
 */

export function recordRepurposeTransformation({
  sourceType,
  targetType,
  sourcePlatform,
  targetPlatform,
}: {
  sourceType: string;
  targetType: string;
  sourcePlatform?: string;
  targetPlatform?: string;
}) {
  console.info('Repurpose transformation recorded', {
    sourceType,
    targetType,
    sourcePlatform,
    targetPlatform,
  });
}
