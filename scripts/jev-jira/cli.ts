/**
 * Jira ↔ BJC orchestrator command line — explicit, one AC per invocation.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/jev-jira/cli.ts judge-ac \
 *     --issue OMNI-123 --invoked-by human:<id> [--model <model>] [--write-back] [--audit-dir <dir>]
 *
 * --invoked-by is required. Without --model the pinned DEFAULT_JEV_MODEL is
 * requested; an explicit --model is passed through unchanged (never mapped).
 * Without --write-back Jira is only read. Jira identity is explicit
 * (identity.ts): JEV_JIRA_IDENTITY=reader + JEV_READER_TOKEN for read-only
 * runs, JEV_JIRA_IDENTITY=advisory + JEV_ADVISORY_TOKEN for --write-back, both
 * Bearer; the token's live OMNI permissions must match the identity before any
 * issue is read. TYPESAFE_API_KEY (JEV). Environment only.
 *
 * Exit codes: 0 ok · 2 JUDGMENT_UNAVAILABLE · 3 REJECTED/BJC_REJECTED ·
 * 4 audit not written · 5 Jira error or write-back not WRITTEN ·
 * 6 identity preflight failed (nothing judged, nothing written) · 64 usage.
 */
import { FileAuditSink, defaultAuditDir } from '../jev-bjc/audit';
import { createTypeSafeTransport, resolveApiKey } from '../jev-bjc/provider';
import { identityViolations, preflightPermissionKeys, resolveRuntimeIdentity } from './identity';
import { JiraClientError, createJiraClient } from './jiraClient';
import { FileIntegrationAuditSink, runAcJudgment } from './orchestrator';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

/**
 * Pinned JEV model requested when --model is omitted: the id the provider
 * resolved `jev-latest` to in the first live read-only smoke run (2026-10-01).
 * Never a floating alias, so a default run can be reproducible.
 */
export const DEFAULT_JEV_MODEL = 'jev-1.13.0';

const USAGE = 'usage: cli.ts judge-ac --issue OMNI-<n> --invoked-by <human|claude-code>:<id> [--model <model>] [--write-back] [--audit-dir <dir>]';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The model to request: explicit --model verbatim, else the pinned default. null = --model given without a value. */
export function resolveModel(argv: string[]): string | null {
  if (!argv.includes('--model')) return DEFAULT_JEV_MODEL;
  const model = flag(argv, '--model');
  return model && !model.startsWith('--') ? model : null;
}

export async function runCli(argv: string[], env: Record<string, string | undefined>, io: CliIo): Promise<number> {
  const [command] = argv;
  const issue = flag(argv, '--issue');
  const model = resolveModel(argv);
  const invokedBy = flag(argv, '--invoked-by');
  if (command !== 'judge-ac' || !issue || !model || !invokedBy) {
    io.err(USAGE);
    return 64;
  }

  const writeBack = argv.includes('--write-back');
  const resolved = resolveRuntimeIdentity(env, writeBack);
  if (resolved.ok === false) {
    io.err(resolved.message);
    return 64;
  }

  let bjcAudit: FileAuditSink;
  let audit: FileIntegrationAuditSink;
  try {
    const dir = flag(argv, '--audit-dir') ?? defaultAuditDir(env);
    bjcAudit = new FileAuditSink(dir);
    audit = new FileIntegrationAuditSink(dir);
  } catch (err) {
    io.err((err as Error).message);
    return 64;
  }

  const jira = createJiraClient({ credentials: resolved.credentials });
  let violations: string[];
  try {
    violations = identityViolations(resolved.identity, await jira.getMyPermissions(preflightPermissionKeys(resolved.identity)));
  } catch (err) {
    violations = [err instanceof JiraClientError ? `${err.code}: ${err.message}` : 'permission probe failed'];
  }
  if (violations.length > 0) {
    io.err(`Jira identity preflight failed for ${resolved.identity}: ${violations.join('; ')}`);
    return 6;
  }

  const apiKey = resolveApiKey(env);
  const result = await runAcJudgment(
    { jiraIssueKey: issue, model, invokedBy, writeBack },
    {
      jira,
      transport: apiKey ? createTypeSafeTransport({ apiKey }) : null,
      bjcAudit,
      audit,
    },
  );
  io.out(JSON.stringify(result, null, 2));

  if (!result.audit.written) {
    io.err(`integration audit NOT written: ${result.audit.error}`);
    return 4;
  }
  if (result.status === 'JUDGMENT_UNAVAILABLE') return 2;
  if (result.status === 'REJECTED' || result.status === 'BJC_REJECTED') return 3;
  if (result.status === 'JIRA_ERROR' || !result.ok) return 5;
  return 0;
}

if (require.main === module) {
  runCli(process.argv.slice(2), process.env, {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
  }).then((code) => process.exit(code));
}
