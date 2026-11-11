import fs from 'fs/promises';
import path from 'path';
import { legacyRpaSessionDir } from './rpaSessionStore';

/**
 * Bounded, best-effort purge of the legacy plaintext RPA session copies that
 * rpaSessionStore used to write to $RPA_SESSION_DIR || tmp/rpa-sessions as
 * `<org>__<platform>.json`.
 *
 * Product decision: legacy plaintext sessions are invalidated and the
 * organization logs in again. These files are therefore DELETED, never read,
 * migrated, copied or moved.
 *
 * Safety rules:
 *   - File CONTENTS are never opened. Only directory entry names and lstat
 *     metadata are inspected.
 *   - Only top-level regular files whose name matches the legacy pattern are
 *     touched. Directories, symlinks (never followed) and any other name are
 *     skipped. No recursion.
 *   - At most `maxFiles` (default 1000, hard cap 10000) deletions per call.
 *   - Dry run by default: `apply: true` is required to unlink anything.
 *   - The logger receives counts only — never a file name or content.
 *
 * Invoked only by the explicit operator script
 * scripts/purge-legacy-rpa-session-files.ts. Nothing schedules it.
 */

export const LEGACY_RPA_SESSION_FILE_RE = /^[A-Za-z0-9_-]+__[A-Za-z0-9_-]+\.json$/;

const DEFAULT_MAX_FILES = 1000;
const HARD_MAX_FILES = 10000;

export type LegacyPurgeLogger = (message: string, counts: Record<string, number | boolean>) => void;

export type LegacyPurgeOptions = {
  /** Directory to purge; defaults to the store's legacy directory. */
  dir?: string;
  /** Unlink matched files. Default false (dry run: count only). */
  apply?: boolean;
  maxFiles?: number;
  logger?: LegacyPurgeLogger;
};

export type LegacyPurgeResult = {
  dir_present: boolean;
  matched: number;
  deleted: number;
  skipped_non_matching: number;
  skipped_not_regular_file: number;
  failed: number;
  truncated: boolean;
  applied: boolean;
};

export async function purgeLegacyRpaSessionFiles(opts: LegacyPurgeOptions = {}): Promise<LegacyPurgeResult> {
  const dir = opts.dir ?? legacyRpaSessionDir();
  const apply = opts.apply === true;
  const requested = Number.isFinite(opts.maxFiles) && (opts.maxFiles as number) > 0
    ? Math.floor(opts.maxFiles as number)
    : DEFAULT_MAX_FILES;
  const maxFiles = Math.min(requested, HARD_MAX_FILES);
  const log: LegacyPurgeLogger = opts.logger ?? ((m, c) => console.info(m, c));

  const result: LegacyPurgeResult = {
    dir_present: false,
    matched: 0,
    deleted: 0,
    skipped_non_matching: 0,
    skipped_not_regular_file: 0,
    failed: 0,
    truncated: false,
    applied: apply,
  };

  let names: string[];
  try {
    names = await fs.readdir(dir);
    result.dir_present = true;
  } catch {
    log('[rpaLegacySessionFilePurge] legacy session directory absent; nothing to purge', { ...result });
    return result;
  }

  for (const name of names) {
    if (!LEGACY_RPA_SESSION_FILE_RE.test(name)) {
      result.skipped_non_matching += 1;
      continue;
    }
    if (result.matched >= maxFiles) {
      result.truncated = true;
      break;
    }
    const full = path.join(dir, name);
    let isRegular = false;
    try {
      isRegular = (await fs.lstat(full)).isFile();
    } catch {
      result.failed += 1;
      continue;
    }
    if (!isRegular) {
      result.skipped_not_regular_file += 1;
      continue;
    }
    result.matched += 1;
    if (!apply) continue;
    try {
      await fs.unlink(full);
      result.deleted += 1;
    } catch {
      result.failed += 1;
    }
  }

  log(
    apply
      ? '[rpaLegacySessionFilePurge] legacy plaintext session files purged'
      : '[rpaLegacySessionFilePurge] dry run: legacy plaintext session files found (pass --apply to delete)',
    { ...result },
  );
  return result;
}
