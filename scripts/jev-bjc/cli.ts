/**
 * BJC command line — the operator-facing explicit invocation.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/jev-bjc/cli.ts hash  --request <file>
 *   node node_modules/tsx/dist/cli.mjs scripts/jev-bjc/cli.ts judge --request <file> [--audit-dir <dir>]
 *
 * `hash` prints the canonical input_hash for a request (no network).
 * `judge` prints the BjcResponse JSON. Exit codes:
 *   0 COMPLETED · 2 JUDGMENT_UNAVAILABLE · 3 REQUEST_REJECTED · 4 audit not written · 64 usage error
 *
 * The key is read only from TYPESAFE_API_KEY; audit records go to
 * BJC_AUDIT_DIR or ~/.omnivyra/bjc-audit (never inside a git work tree).
 */
import fs from 'node:fs';
import { computeInputHash } from './canonical';
import { FileAuditSink, defaultAuditDir } from './audit';
import { createTypeSafeTransport, resolveApiKey } from './provider';
import { judge } from './judge';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const USAGE = 'usage: cli.ts <hash|judge> --request <file> [--audit-dir <dir>]';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function runCli(argv: string[], env: Record<string, string | undefined>, io: CliIo): Promise<number> {
  const [command] = argv;
  const requestPath = flag(argv, '--request');
  if ((command !== 'hash' && command !== 'judge') || !requestPath) {
    io.err(USAGE);
    return 64;
  }

  let request: unknown;
  try {
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch {
    io.err(`cannot read a JSON request from ${requestPath}`);
    return 64;
  }

  if (command === 'hash') {
    try {
      io.out(computeInputHash(request as Parameters<typeof computeInputHash>[0]));
      return 0;
    } catch (err) {
      io.err(`cannot hash request: ${(err as Error).message}`);
      return 64;
    }
  }

  let audit: FileAuditSink;
  try {
    audit = new FileAuditSink(flag(argv, '--audit-dir') ?? defaultAuditDir(env));
  } catch (err) {
    io.err((err as Error).message);
    return 64;
  }

  const apiKey = resolveApiKey(env);
  const response = await judge(request, {
    transport: apiKey ? createTypeSafeTransport({ apiKey }) : null,
    audit,
  });
  io.out(JSON.stringify(response, null, 2));

  if (!response.audit.written) {
    io.err(`audit record NOT written: ${response.audit.error}`);
    return 4;
  }
  if (response.status === 'COMPLETED') return 0;
  io.err(`BJC ${response.status}: ${response.error?.code} — ${response.error?.message}`);
  return response.status === 'JUDGMENT_UNAVAILABLE' ? 2 : 3;
}

if (require.main === module) {
  runCli(process.argv.slice(2), process.env, {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
  }).then((code) => process.exit(code));
}
