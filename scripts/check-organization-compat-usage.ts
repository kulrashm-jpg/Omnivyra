import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const roots = ['backend', 'lib', 'pages/api', 'hooks/org'];
const allowedFiles = new Set<string>([
  'backend/auth/tokenRefresh.ts',
  'backend/scheduler/schedulerService.ts',
  'backend/schedulers/intelligenceScheduler.ts',
  'backend/scripts/activateCompanyIntelligence.ts',
  'backend/scripts/activateIntelligenceSystem.ts',
  'backend/scripts/engagementCommandCenterDiagnostics.ts',
  'backend/scripts/postActivationVerification.ts',
  'backend/scripts/verifyIntelligencePipeline.ts',
  'backend/services/rbacService.ts',
  'backend/services/autonomousCampaignAgent.ts',
  'backend/services/companyDomainLookup.ts',
  'backend/services/companyIntelligenceEngine.ts',
  'backend/services/companyMatchService.ts',
  'backend/services/companyTrendRelevanceEngine.ts',
  'backend/services/contentOpportunityEngine.ts',
  'backend/services/featureCompletionEventTriggers.ts',
  'backend/services/featureCompletionService.ts',
  'backend/services/GovernanceMetricsService.ts',
  'backend/services/ingestionUtils.ts',
  'backend/services/initialFreeCreditService.ts',
  'backend/services/intelligenceAggregationService.ts',
  'backend/services/omnivyraWebsiteCompanyService.ts',
  'backend/services/reportCardService.ts',
  'backend/services/reportInputResolver.ts',
  'backend/services/signalRelevanceEngine.ts',
  'backend/services/userContextService.ts',
  'pages/api/admin/access-requests/approve.ts',
  'pages/api/admin/consumption/infra-estimate.ts',
  'pages/api/admin/create-company.ts',
  'pages/api/admin/external-users.ts',
  'pages/api/auth/sync-supabase-user.ts',
  'pages/api/campaigns/[id]/prediction.ts',
  'pages/api/command-center/company-state.ts',
  'pages/api/content-architect/search.ts',
  'pages/api/cron/leverage-optimizer.ts',
  'pages/api/external-apis/access.ts',
  'pages/api/onboarding/complete.ts',
  'pages/api/onboarding/request-company-access.ts',
  'pages/api/onboarding/setup-company.ts',
  'pages/api/onboarding/validate-company-name.ts',
  'pages/api/reports/automation-config.ts',
  'pages/api/settings/intelligence-access.ts',
  'pages/api/super-admin/companies.ts',
  'pages/api/super-admin/credits/grant.ts',
  'pages/api/super-admin/users.ts',
  'pages/api/system/overview.ts',
]);

const forbiddenPatterns = [
  /\.from\(\s*['"]companies['"]\s*\)/,
  /\bfrom\s+companies\b/i,
  /\bjoin\s+companies\b/i,
];

const files: string[] = [];

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      walk(full);
      continue;
    }
    if (/\.(ts|tsx|js|jsx|sql)$/.test(entry)) files.push(full);
  }
}

for (const root of roots) {
  try {
    walk(root);
  } catch {
    // Some roots are optional in smaller environments.
  }
}

const violations: string[] = [];
for (const file of files) {
  const normalized = relative(process.cwd(), file).replace(/\\/g, '/');
  if (normalized.startsWith('supabase/migrations/') || allowedFiles.has(normalized)) continue;

  const source = readFileSync(file, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) {
      violations.push(normalized);
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('Forbidden companies compatibility view usage found outside the legacy allowlist:');
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Organization compatibility guard passed.');
