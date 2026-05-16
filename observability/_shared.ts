import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { IntegrityFinding } from '../config/integrity/integrityUtils';

export type DiagnosticSeverity = 'ok' | 'info' | 'warning';

export type DiagnosticCheck = {
  name: string;
  severity: DiagnosticSeverity;
  summary: string;
  details?: ReadonlyArray<string>;
};

export type DiagnosticReport = {
  generatedAt: string;
  mode: 'READONLY_DIAGNOSTIC';
  scope: string;
  checks: DiagnosticCheck[];
};

export const repoRoot = path.resolve(__dirname, '..');

export function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

export function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

export function listRepoFiles(relativeDir: string, extensions: ReadonlyArray<string>): string[] {
  const root = path.join(repoRoot, relativeDir);
  const out: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
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

export function summarizeFindings(name: string, findings: IntegrityFinding[]): DiagnosticCheck {
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  const infos = findings.filter((finding) => finding.severity === 'info');
  return {
    name,
    severity: warnings.length > 0 ? 'warning' : infos.length > 0 ? 'info' : 'ok',
    summary: `${warnings.length} warning(s), ${infos.length} info item(s).`,
    details: findings.slice(0, 20).map((finding) => {
      const file = finding.file ? ` [${finding.file}]` : '';
      return `${finding.severity.toUpperCase()} ${finding.code}${file}: ${finding.message}`;
    }),
  };
}

export function requiredTokensCheck(
  name: string,
  file: string,
  tokens: ReadonlyArray<string>,
): DiagnosticCheck {
  if (!fileExists(file)) {
    return {
      name,
      severity: 'warning',
      summary: `${file} is missing.`,
    };
  }

  const source = readRepoFile(file);
  const missing = tokens.filter((token) => !source.includes(token));
  return {
    name,
    severity: missing.length > 0 ? 'warning' : 'ok',
    summary: missing.length > 0
      ? `${missing.length} expected contract token(s) missing.`
      : 'Expected contract tokens are present.',
    details: missing.map((token) => `missing token: ${token}`),
  };
}

export function envPresence(keys: ReadonlyArray<string>): Record<string, 'present' | 'missing'> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key] ? 'present' : 'missing']));
}

export function printReport(report: DiagnosticReport): void {
  console.log(JSON.stringify(report, null, 2));
  const warnings = report.checks.filter((check) => check.severity === 'warning').length;
  const infos = report.checks.filter((check) => check.severity === 'info').length;
  console.log('');
  console.log(`Summary: ${warnings} warning check(s), ${infos} info check(s).`);
  console.log('Mode: READONLY_DIAGNOSTIC. No files were modified, no remote calls were made, and no operator scripts were executed.');
}

export function buildReport(scope: string, checks: DiagnosticCheck[]): DiagnosticReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: 'READONLY_DIAGNOSTIC',
    scope,
    checks,
  };
}

export function loadLocalEnvForDiagnostics(): void {
  dotenv.config({ path: path.join(repoRoot, '.env.local') });
  dotenv.config();
}
