import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();

const FROZEN_ROUTE_PATHS = [
  'pages/api/team',
  'pages/api/company/users.ts',
];

const FORBIDDEN_FRONTEND_PATTERNS = [
  /\/api\/team\b/i,
  /\/api\/company\/users\b/i,
];

const FRONTEND_ROOTS = ['pages', 'components', 'hooks', 'app'];
const FRONTEND_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

type Finding = {
  file: string;
  line?: number;
  message: string;
};

const toPosix = (path: string) => relative(ROOT, path).split(sep).join('/');

const extensionOf = (name: string): string => {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
};

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir).map((entry) => join(dir, entry));
  const files: string[] = [];
  for (const entry of entries) {
    const stat = statSync(entry);
    if (stat.isDirectory()) files.push(...walkFiles(entry));
    if (stat.isFile()) files.push(entry);
  }
  return files;
};

const findings: Finding[] = [];

for (const routePath of FROZEN_ROUTE_PATHS) {
  const absolute = join(ROOT, routePath);
  const hasFiles = existsSync(absolute) && (
    statSync(absolute).isFile() ||
    (statSync(absolute).isDirectory() && walkFiles(absolute).length > 0)
  );
  if (hasFiles) {
    findings.push({
      file: routePath,
      message: 'Frozen legacy user/team route still exists. Use canonical /api/users routes.',
    });
  }
}

for (const root of FRONTEND_ROOTS) {
  for (const file of walkFiles(join(ROOT, root))) {
    if (!FRONTEND_EXTENSIONS.has(extensionOf(file))) continue;
    if (toPosix(file).startsWith('pages/api/')) continue;

    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of FORBIDDEN_FRONTEND_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            file: toPosix(file),
            line: index + 1,
            message: `Legacy frontend route usage found: ${pattern}`,
          });
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`[check-user-integrity-freeze] FAIL - ${findings.length} finding(s):`);
  for (const finding of findings) {
    const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`  ${where} ${finding.message}`);
  }
  process.exit(1);
}

console.log('[check-user-integrity-freeze] OK - legacy user/team routes are frozen.');
