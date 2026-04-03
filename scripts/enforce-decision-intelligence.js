const fs = require('fs');
const path = require('path');

const root = process.cwd();
const useLegacyInsights = String(process.env.USE_LEGACY_INSIGHTS || 'false').toLowerCase() === 'true';

if (useLegacyInsights) {
  console.error('USE_LEGACY_INSIGHTS must remain false for production builds.');
  process.exit(1);
}

const forbiddenLegacyPatterns = [
  ".from('campaign_strategic_insights')",
  '.from("campaign_strategic_insights")',
  ".from('engagement_insights')",
  '.from("engagement_insights")',
  ".from('opportunity_reports')",
  '.from("opportunity_reports")',
];

const forbiddenLegacyWritePatterns = [
  ".from('feedback_intelligence')",
  '.from("feedback_intelligence")',
];

const forbiddenApiGenerationPatterns = [
  'generateStrategicInsights(',
  'generateGrowthIntelligenceDecisions(',
  'generateBusinessDecisionObjects(',
  'generateLeadIntelligenceDecisions(',
  'generateKeywordIntelligenceDecisions(',
  'generateContentClusterDecisions(',
  'detectOpportunities(',
  'generateFeedbackInsights(',
  'getOpportunitiesForCompany(',
  'getRecommendationsForCompany(',
  'runIntelligenceCycle(',
  'runOptimizationForCompany(',
];

const forbiddenApiDirectDecisionReads = [
  ".from('decision_objects')",
  '.from("decision_objects")',
];

const forbiddenFeatureApiPatterns = [
  'getDecisionReportView(',
  'listDecisionObjects(',
];

const tenantGuardPatterns = [
  'requireCompanyContext(',
  'enforceCompanyAccess(',
  'requireCampaignAccess(',
];

const tenantEnforcedApiPrefixes = [
  'pages/api/insights/',
  'pages/api/growth-intelligence/',
  'pages/api/community/',
  'pages/api/dashboard/',
  'pages/api/company/',
  'pages/api/executive/',
];

const blockedModuleImports = [
  'opportunityDetectionEngine',
  'strategicThemesEngine',
  'strategicRecommendationEngine',
  'strategicPlaybookEngine',
  'learningOrchestrationService',
  'simulationOrchestrationService',
  'themePreviewService',
];

const ignoredSegments = new Set([
  'node_modules',
  '.git',
  '.next',
  'docs',
  'dist',
  '.vercel',
  'database',
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.includes(`${path.sep}backend${path.sep}tests${path.sep}`)) continue;
      walk(fullPath, files);
    } else if (/\.(ts|tsx|js|sql)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = walk(root);
const violations = [];

for (const file of files) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');

  if (
    !relative.startsWith('supabase/migrations/') &&
    !relative.startsWith('scripts/enforce-decision-intelligence.js')
  ) {
    for (const pattern of forbiddenLegacyPatterns) {
      if (content.includes(pattern)) {
        violations.push(`${relative}: legacy dependency "${pattern}" is not allowed.`);
      }
    }

    for (const pattern of forbiddenLegacyWritePatterns) {
      if (content.includes(pattern)) {
        violations.push(`${relative}: legacy table write "${pattern}" is not allowed.`);
      }
    }

    for (const moduleName of blockedModuleImports) {
      if (relative.endsWith(`${moduleName}.ts`) || relative.endsWith(`${moduleName}.tsx`) || relative.endsWith(`${moduleName}.js`)) {
        continue;
      }
      const hasBlockedImport =
        content.includes(`from './${moduleName}'`) ||
        content.includes(`from "../${moduleName}"`) ||
        content.includes(`from '../../${moduleName}'`) ||
        content.includes(`from '../../../${moduleName}'`) ||
        content.includes(`from "../../../../${moduleName}"`) ||
        content.includes(`from '@/backend/services/${moduleName}'`) ||
        content.includes(`from '../../../backend/services/${moduleName}'`) ||
        content.includes(`from '../../../../backend/services/${moduleName}'`);

      if (hasBlockedImport) {
        violations.push(`${relative}: blocked legacy intelligence module "${moduleName}" is imported.`);
      }
    }
  }

  if (relative.startsWith('pages/api/')) {
    for (const pattern of forbiddenApiGenerationPatterns) {
      if (content.includes(pattern)) {
        violations.push(`${relative}: API-triggered intelligence generation "${pattern}" is not allowed.`);
      }
    }

    for (const pattern of forbiddenApiDirectDecisionReads) {
      if (content.includes(pattern)) {
        violations.push(`${relative}: APIs must read decision intelligence through tier views only, not "${pattern}".`);
      }
    }

    const requiresTenantGuard = tenantEnforcedApiPrefixes.some((prefix) => relative.startsWith(prefix));
    if (requiresTenantGuard) {
      const hasTenantGuard = tenantGuardPatterns.some((pattern) => content.includes(pattern));
      if (!hasTenantGuard) {
        violations.push(`${relative}: tenant-enforced API must call requireCompanyContext, enforceCompanyAccess, or requireCampaignAccess.`);
      }
    }
  }

  if (relative.startsWith('pages/api/insights/')) {
    for (const pattern of forbiddenFeatureApiPatterns) {
      if (content.includes(pattern)) {
        violations.push(`${relative}: feature insight APIs must read feature decision views only, not "${pattern}".`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Decision intelligence enforcement failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Decision intelligence enforcement passed.');
