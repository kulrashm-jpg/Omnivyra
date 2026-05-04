const FORBIDDEN_CAMPAIGN_STATE_FIELDS = new Set([
  'status',
  'blueprint_status',
  'execution_status',
]);

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' ||
    process.env.OMNIVYRA_ENV === 'production' ||
    process.env.DRISHIQ_ENV === 'production';
}

export function assertNoCampaignStateBypass(payload: unknown): void {
  if (!isProductionRuntime() || !payload || typeof payload !== 'object') return;

  const keys = Object.keys(payload as Record<string, unknown>);
  const forbidden = keys.filter((key) => FORBIDDEN_CAMPAIGN_STATE_FIELDS.has(key));
  if (forbidden.length === 0) return;

  const stack = new Error().stack ?? '';
  if (stack.includes('campaignStateService')) return;

  throw new Error(`CAMPAIGN_STATE_BYPASS_DETECTED:${forbidden.sort().join(',')}`);
}

export function getForbiddenCampaignStateFields(): string[] {
  return [...FORBIDDEN_CAMPAIGN_STATE_FIELDS].sort();
}
