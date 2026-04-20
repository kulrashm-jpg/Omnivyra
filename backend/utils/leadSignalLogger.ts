import * as fs from 'fs';
import * as path from 'path';

export type LeadSignalLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LeadSignalLogEvent =
  | 'writer_mode_initialized'
  | 'write_decision'
  | 'canonical_write_failure'
  | 'canonical_retry_failure'
  | 'legacy_fallback_triggered'
  | 'invalid_flag_state';

export type LeadSignalLogEntry = {
  timestamp: string;
  level: LeadSignalLogLevel;
  event: LeadSignalLogEvent;
  mode?: string | null;
  signal_id?: string | null;
  source_type?: string | null;
  context?: string | null;
  error?: string | null;
  retry?: boolean | null;
  attempt?: number | null;
  details?: Record<string, unknown>;
};

function resolveLogPath(): string | null {
  const configured = process.env.LEAD_SIGNAL_LOG_PATH?.trim();
  if (!configured) return null;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.appendFile(filePath, line, 'utf8');
}

export async function logLeadSignalEvent(
  entry: Omit<LeadSignalLogEntry, 'timestamp'>,
): Promise<void> {
  const payload: LeadSignalLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const serialized = `${JSON.stringify(payload)}\n`;
  const filePath = resolveLogPath();

  if (!filePath) {
    const sink = payload.level === 'error' ? console.error : payload.level === 'warn' ? console.warn : console.log;
    sink('[leadSignals]', payload);
    return;
  }

  try {
    await appendLine(filePath, serialized);
  } catch (error) {
    console.error('[leadSignals] file log write failed', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    const sink = payload.level === 'error' ? console.error : payload.level === 'warn' ? console.warn : console.log;
    sink('[leadSignals]', payload);
  }
}
