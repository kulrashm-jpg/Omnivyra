const fs = require('fs');
const path = require('path');

const root = process.cwd();
const allowed = new Set([
  path.join(root, 'backend', 'services', 'canonicalLeadSignalService.ts'),
]);
const engagementRouteRedirect = path.join(root, 'pages', 'engagement', 'leads.tsx');
const allowedLegacyReferenceDirs = [
  `${path.sep}deprecated${path.sep}`,
  `${path.sep}archive${path.sep}`,
  `${path.sep}scripts${path.sep}`,
];

const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.sql', '.md']);
const patterns = [
  /\.from\('lead_signals_v1'\)\.(insert|upsert|update|delete)/,
  /\.from\('engagement_lead_signals'\)\.(insert|upsert|update|delete)/,
  /\.from\('lead_signals'\)\.(insert|upsert|update|delete)/,
];
const forbiddenLegacyReferences = [
  /\blead_signals_v1\b/,
  /\bengagement_lead_signals\b/,
];
const engagementPath = `${path.sep}engagement${path.sep}`;
const forbiddenEngagementPatterns = [
  /\/api\/engagement\/leads\b/,
  /href=["'`]\/engagement\/leads\b/,
  /push\(["'`]\/engagement\/leads\b/,
  /replace\(["'`]\/engagement\/leads\b/,
  /location\.(href|assign)\(["'`]\/engagement\/leads\b/,
  /\bView Potential Leads\b/,
  /\bReview potential leads\b/,
  /\bPotential Leads\b/,
];
const engagementLeadListPatterns = [
  /\bconst\s+leads\s*=\s*useState/i,
  /\bsetLeads\s*\(/,
  /\btitle=["'`]Lead Signals["'`]/,
  /\btitle=["'`]Potential Leads["'`]/,
  /\bLead Signals\b/,
];

function isEngagementFile(file) {
  return file.replaceAll('/', path.sep).includes(engagementPath);
}

function checkEngagementRoutes() {
  const pagesDir = path.join(root, 'pages', 'engagement');
  const routeViolations = [];
  if (!fs.existsSync(pagesDir)) return routeViolations;

  for (const entry of fs.readdirSync(pagesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const normalizedName = entry.name.toLowerCase();
    if (!normalizedName.includes('lead')) continue;
    const full = path.join(pagesDir, entry.name);
    if (full !== engagementRouteRedirect) {
      routeViolations.push(`pages${path.sep}engagement${path.sep}${entry.name}: lead routes are forbidden in Engagement`);
      continue;
    }

    const redirectContent = fs.readFileSync(full, 'utf8');
    const hasRedirectTarget = redirectContent.includes('/dashboard/intelligence?intelTab=active-leads');
    const hasRouterReplace = redirectContent.includes('router.replace');
    if (!hasRedirectTarget || !hasRouterReplace) {
      routeViolations.push(
        `pages${path.sep}engagement${path.sep}${entry.name}: must remain a redirect to Active Leads`
      );
    }
  }

  return routeViolations;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (exts.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const violations = [];
for (const file of walk(root)) {
  const normalizedFile = file.replaceAll('/', path.sep);
  const allowsLegacyReferences = allowedLegacyReferenceDirs.some((segment) =>
    normalizedFile.includes(segment)
  );
  if (allowed.has(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) {
      violations.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
    }
    if (!allowsLegacyReferences && forbiddenLegacyReferences.some((pattern) => pattern.test(line))) {
      violations.push(
        `${path.relative(root, file)}:${index + 1}: forbidden legacy reference -> ${line.trim()}`
      );
    }
    if (
      isEngagementFile(file) &&
      forbiddenEngagementPatterns.some((pattern) => pattern.test(line))
    ) {
      violations.push(
        `${path.relative(root, file)}:${index + 1}: engagement must not link to or present a lead workspace -> ${line.trim()}`
      );
    }
    if (
      isEngagementFile(file) &&
      file !== engagementRouteRedirect &&
      engagementLeadListPatterns.some((pattern) => pattern.test(line))
    ) {
      violations.push(
        `${path.relative(root, file)}:${index + 1}: engagement must not build lead lists or lead-management sections -> ${line.trim()}`
      );
    }
  });
}

violations.push(...checkEngagementRoutes());

if (violations.length > 0) {
  console.error(
    '[lead-signal-boundary] canonical lead signals are the only production path; Engagement must stay conversation-only and all lead management must live in Active Leads.'
  );
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('[lead-signal-boundary] ok');
