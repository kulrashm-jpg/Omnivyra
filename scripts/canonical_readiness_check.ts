import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createServiceRoleMigrationProxy } from '../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

type Status = 'READY' | 'NOT_READY';
type LeadSignalLogEntry = {
  timestamp?: string;
  level?: string;
  event?: string;
  mode?: string | null;
  signal_id?: string | null;
  error?: string | null;
  retry?: boolean | null;
};

function isMissingTable(error: { message?: string; code?: string } | null | undefined, table: string): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    error?.code === '42P01' ||
    message.includes(`relation "${table}" does not exist`) ||
    message.includes(`could not find the table 'public.${table.toLowerCase()}'`)
  );
}

async function countRows(table: string, column: string, since: string): Promise<{ count: number; missing: boolean }> {
  const { count, error } = await (supabase as any)
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte(column, since);

  if (error) {
    if (isMissingTable(error, table)) {
      return { count: 0, missing: true };
    }
    throw new Error(`Failed counting ${table}: ${error.message}`);
  }

  return { count: count ?? 0, missing: false };
}

function readFailureRate(lookbackSince: string): {
  failureEvents: number;
  failureRate: number;
  retryEvents: number;
  fallbackEvents: number;
  retrySuccessRate: number;
  reason: string | null;
} {
  const logPath = process.env.LEAD_SIGNAL_LOG_PATH;
  if (!logPath) {
    return {
      failureEvents: 0,
      failureRate: 0,
      retryEvents: 0,
      fallbackEvents: 0,
      retrySuccessRate: 1,
      reason: 'LEAD_SIGNAL_LOG_PATH not set; failure logs not verified',
    };
  }

  if (!fs.existsSync(logPath)) {
    return {
      failureEvents: 0,
      failureRate: 0,
      retryEvents: 0,
      fallbackEvents: 0,
      retrySuccessRate: 1,
      reason: `Log file not found: ${logPath}`,
    };
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const since = new Date(lookbackSince).getTime();
  const entries = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LeadSignalLogEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is LeadSignalLogEntry => {
      if (!entry || !entry.timestamp) return false;
      const at = new Date(entry.timestamp).getTime();
      return Number.isFinite(at) && at >= since;
    });

  const failureEvents = entries.filter((entry) => entry.event === 'canonical_write_failure').length;
  const retryEvents = entries.filter((entry) => entry.event === 'canonical_retry_failure').length;
  const fallbackEvents = entries.filter((entry) => entry.event === 'legacy_fallback_triggered').length;
  const totalWrites = entries.filter((entry) => entry.event === 'write_decision').length;
  const failureRate = totalWrites > 0 ? failureEvents / totalWrites : 0;
  const retrySuccessRate = retryEvents > 0 ? Math.max(0, (retryEvents - failureEvents) / retryEvents) : 1;
  return { failureEvents, failureRate, retryEvents, fallbackEvents, retrySuccessRate, reason: null };
}

async function main() {
  const lookbackHours = Number(process.env.LEAD_SIGNAL_VERIFY_LOOKBACK_HOURS ?? '24');
  const failureRateThreshold = Number(process.env.LEAD_SIGNAL_FAILURE_RATE_THRESHOLD ?? '0.01');
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const canonicalWriteEnabled = String(process.env.USE_CANONICAL_SIGNAL_WRITE ?? 'true').toLowerCase() === 'true';

  const [canonicalResult] = await Promise.all([
    countRows('lead_signals', 'created_at', since),
  ]);

  const canonicalCount = canonicalResult.count;
  const canonicalCoverage = canonicalCount > 0 ? 1 : 0;
  const { failureEvents, failureRate, retryEvents, fallbackEvents, retrySuccessRate, reason: failureReason } =
    readFailureRate(since);
  const fallbackRate = canonicalCount > 0 ? fallbackEvents / canonicalCount : 0;

  const reasons: string[] = [];
  if (canonicalResult.missing) reasons.push('Canonical lead_signals table is missing');
  if (canonicalCount === 0) reasons.push('No signal traffic observed in the lookback window');
  if (!canonicalWriteEnabled) reasons.push('Canonical writes are disabled');
  if (failureReason) reasons.push(failureReason);
  if (failureRate > failureRateThreshold) {
    reasons.push(`Canonical write failure rate ${failureRate.toFixed(4)} exceeds threshold ${failureRateThreshold}`);
  }
  if (fallbackEvents > 0) {
    reasons.push(`Legacy fallback events detected: ${fallbackEvents}`);
  }
  if (retryEvents > 0 && retrySuccessRate < 1) {
    reasons.push(`Canonical retry success rate ${retrySuccessRate.toFixed(4)} is below 1.0000`);
  }

  const status: Status = reasons.length === 0 ? 'READY' : 'NOT_READY';

  console.log(
    JSON.stringify(
      {
        status,
        reasons,
        metrics: {
          lookback_hours: lookbackHours,
          canonical_count: canonicalCount,
          canonical_coverage: Number(canonicalCoverage.toFixed(4)),
          failure_events: failureEvents,
          failure_rate: Number(failureRate.toFixed(4)),
          retry_events: retryEvents,
          retry_success_rate: Number(retrySuccessRate.toFixed(4)),
          fallback_events: fallbackEvents,
          fallback_rate: Number(fallbackRate.toFixed(4)),
          failure_rate_threshold: failureRateThreshold,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[canonical_readiness_check]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
