import fs from 'fs';
import path from 'path';

export type IntegritySeverity = 'info' | 'warning';

export type IntegrityFinding = {
  severity: IntegritySeverity;
  code: string;
  message: string;
  file?: string;
  recommendation?: string;
};

export const repoRoot = path.resolve(__dirname, '..', '..');

export function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

export function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

export function listFiles(relativeDir: string, extensions: ReadonlyArray<string>): string[] {
  const root = path.join(repoRoot, relativeDir);
  const out: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
      }
    }
  }

  walk(root);
  return out.sort();
}

export function extractScriptPaths(command: string): string[] {
  const matches = command.match(/(?:^|\s)(?:node|tsx|ts-node|bash|sh|jest)\s+(\.?\/?[\w./\-[\]]+\.(?:js|ts|tsx|sh|mjs))/g) ?? [];
  return matches
    .map((match) => match.trim().split(/\s+/).pop() ?? '')
    .map((p) => p.replace(/^\.\//, ''))
    .filter(Boolean);
}

export function extractWorkflowRunPaths(source: string): string[] {
  const paths = new Set<string>();
  const regex = /\b(?:node|bash|sh|tsx|ts-node)\s+(\.?\/?[\w./\-[\]]+\.(?:js|ts|tsx|sh|mjs))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    paths.add(match[1].replace(/^\.\//, ''));
  }
  return [...paths].sort();
}

export function parseProjectRef(value: string | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  const hostMatch = lower.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  if (hostMatch) return hostMatch[1];
  const dbMatch = lower.match(/(?:db\.|@db\.)([a-z0-9-]+)\.supabase\.co/);
  if (dbMatch) return dbMatch[1];
  return null;
}

export function looksLocal(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower.includes('localhost')
    || lower.includes('127.0.0.1')
    || lower.includes('0.0.0.0')
    || lower.includes('host.docker.internal')
    || lower.includes('supabase_db_');
}

export function printFindings(title: string, findings: IntegrityFinding[]): void {
  console.log(`\n${title}`);
  console.log('='.repeat(title.length));
  if (findings.length === 0) {
    console.log('No warnings detected.');
    return;
  }
  for (const finding of findings) {
    const prefix = finding.severity.toUpperCase();
    console.log(`[${prefix}] ${finding.code}: ${finding.message}`);
    if (finding.file) console.log(`  file: ${finding.file}`);
    if (finding.recommendation) console.log(`  recommendation: ${finding.recommendation}`);
  }
}

export function exitWarnOnly(title: string, findings: IntegrityFinding[]): void {
  printFindings(title, findings);
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  console.log(`\nSummary: ${warnings} warning(s), ${findings.length - warnings} info item(s).`);
  console.log('Mode: WARN_ONLY. No files were modified and no remote calls were made.');
}
