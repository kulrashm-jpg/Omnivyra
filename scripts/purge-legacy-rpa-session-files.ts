/**
 * Operator script: purge legacy plaintext RPA session files
 * ($RPA_SESSION_DIR || tmp/rpa-sessions/<org>__<platform>.json).
 *
 * Legacy plaintext RPA sessions are invalidated; organizations log in again.
 * This script never opens a file's contents and prints counts only.
 *
 *   node -r ts-node/register scripts/purge-legacy-rpa-session-files.ts            # dry run (counts)
 *   node -r ts-node/register scripts/purge-legacy-rpa-session-files.ts --apply    # delete
 *   ... --max-files=500                                                            # bound per run
 *
 * Run it on each host / volume that ever ran the RPA auth routes or worker
 * with a local tmp directory. It is NOT scheduled and needs no database.
 * Exit code: 0 = completed (including "directory absent"), 1 = any failure.
 */
import { purgeLegacyRpaSessionFiles } from '../backend/services/rpaWorker/rpaLegacySessionFilePurge';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const maxArg = args.find((a) => a.startsWith('--max-files='));
  const maxFiles = maxArg ? Number(maxArg.slice('--max-files='.length)) : undefined;
  const result = await purgeLegacyRpaSessionFiles({ apply, maxFiles });
  return result.failed > 0 ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  () => {
    console.error('[purge-legacy-rpa-session-files] failed');
    process.exitCode = 1;
  },
);
