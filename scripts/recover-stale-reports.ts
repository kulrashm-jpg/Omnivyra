/**
 * scripts/recover-stale-reports.ts
 *
 * Operational recovery for reports stuck in `status='generating'`.
 *
 * USAGE:
 *   # 1) Dry-run (default): list rows that would be recovered, do nothing.
 *   npx tsx scripts/recover-stale-reports.ts
 *
 *   # 2) Custom timeout (minutes). Default falls back to
 *   #    REPORT_GENERATION_TIMEOUT_MINUTES env or 10.
 *   npx tsx scripts/recover-stale-reports.ts --timeout 30
 *
 *   # 3) Apply: actually demote stale rows to status='failed'. Requires
 *   #    explicit --confirm flag — there is no shorthand for safety.
 *   npx tsx scripts/recover-stale-reports.ts --confirm
 *
 * The script uses the same backend service the cron uses, so behavior is
 * identical to the production reaper. It prints the affected rows in dry-run
 * so an operator can eyeball them before applying.
 */

/* eslint-disable no-console */

import {
  REPORT_GENERATION_TIMEOUT_MINUTES,
  listStaleGeneratingReports,
  recoverStaleGeneratingReports,
} from '../backend/services/reportCardService';

interface CliArgs {
  confirm: boolean;
  timeoutMinutes: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    confirm: false,
    timeoutMinutes: REPORT_GENERATION_TIMEOUT_MINUTES,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--confirm' || a === '--apply') args.confirm = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--timeout' || a === '-t') {
      const next = argv[i + 1];
      const n = Number.parseInt(String(next), 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`Invalid --timeout value: ${next}`);
        process.exit(2);
      }
      args.timeoutMinutes = n;
      i += 1;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(
    [
      'recover-stale-reports — operational recovery for reports stuck in status=\'generating\'',
      '',
      'Flags:',
      '  --timeout, -t <min>  Reap rows older than <min> minutes (default: env or 10).',
      '  --confirm, --apply   Actually perform the update. Without this, dry-run.',
      '  --help, -h           Show this help.',
      '',
      'Dry-run shows the affected rows without modifying anything.',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }

  console.log('--------------------------------------------------------');
  console.log(' recover-stale-reports');
  console.log('--------------------------------------------------------');
  console.log(` mode            : ${args.confirm ? 'APPLY' : 'dry-run'}`);
  console.log(` timeoutMinutes  : ${args.timeoutMinutes}`);
  console.log(` cutoff          : ${new Date(Date.now() - args.timeoutMinutes * 60_000).toISOString()}`);
  console.log('--------------------------------------------------------');

  const stale = await listStaleGeneratingReports(args.timeoutMinutes);

  if (stale.length === 0) {
    console.log('No stale generating reports found. Nothing to do.');
    return;
  }

  console.log(`Found ${stale.length} stale generating row(s):`);
  for (const row of stale) {
    const ts = row.started_at ?? row.created_at;
    console.log(
      `  - id=${row.id}  company_id=${row.company_id}  domain=${row.domain}  started=${ts}`,
    );
  }
  console.log('--------------------------------------------------------');

  if (!args.confirm) {
    console.log('DRY-RUN: no changes made. Re-run with --confirm to apply.');
    return;
  }

  const result = await recoverStaleGeneratingReports(args.timeoutMinutes);
  console.log(`APPLIED: demoted ${result.recovered} row(s) to status='failed'.`);
  if (result.recoveredIds.length > 0) {
    console.log(`Recovered IDs: ${result.recoveredIds.join(', ')}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('recover-stale-reports failed:', err);
    process.exit(1);
  },
);
