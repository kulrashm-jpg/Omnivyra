import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

export type SystemHealthWarning = {
  type: 'warning';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
};

const DEFAULT_STALE_TOUCHPOINT_DAYS = 7;
const DEFAULT_UNLINKED_TOUCHPOINT_THRESHOLD_PERCENT = 50;

function normalizeCompanyId(companyId: string): string {
  const normalized = companyId.trim();
  if (!normalized) {
    throw new Error('companyId is required');
  }
  return normalized;
}

function configuredPositiveNumber(envKey: string, fallback: number): number {
  const parsed = Number(process.env[envKey]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredPercent(envKey: string, fallback: number): number {
  const parsed = Number(process.env[envKey]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(100, Math.max(1, parsed));
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

async function countTouchpoints(companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('unified_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

  if (error) {
    throw new Error(`Failed to count touchpoints: ${error.message}`);
  }

  return count ?? 0;
}

async function countTouchpointsBySource(companyId: string, sources: string[]): Promise<number> {
  const { count, error } = await supabase
    .from('unified_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('source', sources);

  if (error) {
    throw new Error(`Failed to count touchpoints by source: ${error.message}`);
  }

  return count ?? 0;
}

async function countRecentTouchpoints(companyId: string, cutoffIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('unified_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('occurred_at', cutoffIso);

  if (error) {
    throw new Error(`Failed to count recent touchpoints: ${error.message}`);
  }

  return count ?? 0;
}

async function countUnlinkedTouchpoints(companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('unified_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('unified_person_id', null);

  if (error) {
    throw new Error(`Failed to count unlinked touchpoints: ${error.message}`);
  }

  return count ?? 0;
}

function buildUnlinkedSeverity(percent: number): SystemHealthWarning['severity'] {
  if (percent >= 75) {
    return 'high';
  }

  if (percent >= 50) {
    return 'medium';
  }

  return 'low';
}

export async function getSystemHealthWarnings(companyId: string): Promise<SystemHealthWarning[]> {
  const normalizedCompanyId = normalizeCompanyId(companyId);
  const staleTouchpointDays = configuredPositiveNumber(
    'INTELLIGENCE_HEALTH_STALE_DAYS',
    DEFAULT_STALE_TOUCHPOINT_DAYS
  );
  const unlinkedThresholdPercent = configuredPercent(
    'INTELLIGENCE_HEALTH_UNLINKED_THRESHOLD_PERCENT',
    DEFAULT_UNLINKED_TOUCHPOINT_THRESHOLD_PERCENT
  );
  const cutoffIso = new Date(Date.now() - staleTouchpointDays * 24 * 60 * 60 * 1000).toISOString();

  const [totalTouchpoints, ga4Touchpoints, crmTouchpoints, recentTouchpoints, unlinkedTouchpoints] =
    await Promise.all([
      countTouchpoints(normalizedCompanyId),
      countTouchpointsBySource(normalizedCompanyId, ['ga4', 'GA4']),
      countTouchpointsBySource(normalizedCompanyId, ['crm', 'CRM', 'csv', 'CSV']),
      countRecentTouchpoints(normalizedCompanyId, cutoffIso),
      countUnlinkedTouchpoints(normalizedCompanyId),
    ]);

  const warnings: SystemHealthWarning[] = [];

  if (ga4Touchpoints === 0) {
    warnings.push({
      type: 'warning',
      title: 'No GA4 data',
      description: 'No GA4 touchpoints are available in the unified intelligence timeline.',
      severity: 'medium',
    });
  }

  if (crmTouchpoints === 0) {
    warnings.push({
      type: 'warning',
      title: 'No CRM data',
      description: 'No CRM or CSV-sourced touchpoints are available in the unified intelligence timeline.',
      severity: 'medium',
    });
  }

  if (recentTouchpoints === 0) {
    warnings.push({
      type: 'warning',
      title: 'No recent touchpoints',
      description: `No touchpoints have been recorded in the last ${staleTouchpointDays} day(s).`,
      severity: totalTouchpoints === 0 ? 'high' : 'medium',
    });
  }

  if (totalTouchpoints > 0) {
    const unlinkedPercent = roundPercent((unlinkedTouchpoints / totalTouchpoints) * 100);
    if (unlinkedPercent >= unlinkedThresholdPercent) {
      warnings.push({
        type: 'warning',
        title: 'High unlinked touchpoint rate',
        description: `${unlinkedPercent}% of touchpoints are not linked to a unified person.`,
        severity: buildUnlinkedSeverity(unlinkedPercent),
      });
    }
  }

  return warnings;
}
