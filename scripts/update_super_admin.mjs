import { readFileSync, writeFileSync } from 'fs';

const mainFile = 'c:/virality/pages/super-admin.tsx';
const lines = readFileSync(mainFile, 'utf-8').split('\n');

// Helper
const getLines = (from, to) => lines.slice(from - 1, to).join('\n');

// The new super-admin.tsx:
// Keep: lines 1-89 (imports + shared state)
// Remove: lines 90-135 (social/API state - moved to ApisPlatformsTab)
// Keep: lines 136-163 (companyForm, companyAdminForm, fetchWithAuth)
// Keep: lines 164-249 are social handlers - REMOVE (moved to ApisPlatformsTab)
// Keep: lines 251-265 (auth guard useEffect + loadSuperAdminData call - KEEP)
// Remove: lines 267-498 (CANONICAL_BASE_URLS + API handlers - moved to ApisPlatformsTab)
// Keep: lines 500-511 (useEffect for social tab + rbac sync useEffect)
//   BUT line 500-505 was: useEffect for social-platforms tab → REMOVE (tab component handles its own loading)
//   Lines 507-510: useEffect syncing rbacDraftPermissions → KEEP
// Keep: lines 512-645 (loadSuperAdminData)
// Keep: lines 646-1113 (RBAC handlers, policy handlers, plans handlers, company handlers, computed)
// Keep: lines 1114-2217 (return JSX: header + nav + analytics + company-users + plans + community tabs)
// REMOVE: lines 2218-2884 (social-platforms IIFE JSX - moved to ApisPlatformsTab)
// Keep: lines 2885-2968 (cost-analysis tab + audit tab + main closing div)
// Keep: lines 2969-2970 (closing </div>)
// REMOVE: lines 2971-3093 (company modals - will be handled separately)
// Actually keep company modals for now: lines 2971-3093
// Keep: lines 3094-3128 (policy confirm modal)
// REMOVE: lines 3130-3197 (account modal - moved to ApisPlatformsTab)
// Keep: lines 3198-3200 (closing divs + );}

const importSection = getLines(1, 45);  // All imports
const newImport = `import ApisPlatformsTab from '../components/super-admin/tabs/ApisPlatformsTab';`;

// Shared state (without social/API state which is now in ApisPlatformsTab)
const sharedState = getLines(47, 89);  // router through isLoggingOut (before social state)
// Skip lines 90-135 (social state)
// Company form + fetchWithAuth
const companyFormAndFetch = getLines(136, 163); // companyForm, companyAdminForm, fetchWithAuth
// Skip social handlers 164-249
// Auth guard useEffect + loadSuperAdminData call (lines 251-265)
const authGuardEffect = getLines(251, 265);
// Skip CANONICAL_BASE_URLS + API handlers (267-498)
// Skip social platforms useEffect (500-505)
// Keep rbac sync useEffect (507-510)
const rbacSyncEffect = getLines(507, 510);
// loadSuperAdminData (512-645)
const loadSuperAdminData = getLines(512, 645);
// All remaining state/handlers (646-1113)
const remainingHandlers = getLines(646, 1113);
// Return JSX: header + nav + tab content (except social-platforms)
// Lines 1114-2217: everything up to social-platforms IIFE
const headerAndTabs = getLines(1114, 2217);
// Replace social-platforms IIFE (2218-2884) with ApisPlatformsTab call
const apiTabCall = `        {activeTab === 'social-platforms' && (
          <ApisPlatformsTab authError={authError} />
        )}`;
// After social-platforms: cost-analysis, audit, closing div
const afterApiTab = getLines(2885, 2968);
// Closing main container div
const mainClosingDiv = getLines(2969, 2970);
// Company modals (staying for now)
const companyModals = getLines(2971, 3093);
// Policy modal
const policyModal = getLines(3094, 3128);
// Skip account modal (3130-3197) - moved to ApisPlatformsTab
// Final closing
const finalClose = getLines(3198, 3200);

const newContent = importSection + '\n' + newImport + '\n\n' +
  sharedState + '\n' +
  companyFormAndFetch + '\n' +
  authGuardEffect + '\n\n' +
  rbacSyncEffect + '\n\n' +
  loadSuperAdminData + '\n' +
  remainingHandlers + '\n' +
  headerAndTabs + '\n' +
  apiTabCall + '\n\n' +
  afterApiTab + '\n' +
  mainClosingDiv + '\n' +
  companyModals + '\n' +
  policyModal + '\n' +
  finalClose + '\n';

writeFileSync(mainFile, newContent, 'utf-8');
const lineCount = newContent.split('\n').length;
console.log(`super-admin.tsx rewritten: ${lineCount} lines`);
