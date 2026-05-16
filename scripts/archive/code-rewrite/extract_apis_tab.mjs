import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const mainFile = 'c:/virality/pages/super-admin.tsx';
const lines = readFileSync(mainFile, 'utf-8').split('\n');

// Helper: get lines (1-indexed, inclusive)
const getLines = (from, to) => lines.slice(from - 1, to).join('\n');

// Social platform state: lines 90-102 + 111-135 (skip 103-110 which is plans+externalApisHealth)
// Lines 119-125 contain an inline `type ProviderAccount = {...}` — skip it (we define it top-level)
const socialState1 = getLines(90, 102);   // socialPlatforms...platformCheckResults
// Lines 103-110 are plans state + externalApisHealth — SKIP
// Lines 111-118 are apiSubTab, catalogApis, etc.
const socialState2 = getLines(111, 118);  // apiSubTab, catalogApis, loadingCatalogApis, expandedApiId, apiEnvForm, savingApiEnv, apiEnvSaveError
// Lines 119-125 is inline type ProviderAccount — SKIP (defined top-level)
const socialState3 = getLines(126, 135);  // accountsByApiId...apiCheckResults

// Lines 164-249: loadSocialPlatforms, checkPlatformConfig, saveOauthConfig
// Lines 251-265: auth guard useEffect — SKIP (stays in parent)
// Lines 267-498: CANONICAL_BASE_URLS, loadCatalogApis, addApiToCatalog, addAndExpand, etc.
const socialHandlers = getLines(164, 249) + '\n\n' + getLines(267, 498);
const renderApiCategoryFn = getLines(2219, 2601);  // renderApiCategorySection function definition
const mainJsx = getLines(2604, 2881);         // the div inside the IIFE return (without `return (`)
const accountModalJsx = getLines(3131, 3197); // accountModal JSX (includes `{accountModal && (...)`)

const apiTab = `import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import {
  OAUTH_PLATFORMS,
  KNOWN_APIS,
} from '@/pages/super-admin.types';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Save,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Copy,
  Check,
  Globe,
} from 'lucide-react';

type ProviderAccount = {
  id: string; api_source_id: string; account_name: string; priority: number;
  is_active: boolean; rate_limit_per_min: number | null; rate_limit_per_day: number | null;
  current_usage_min: number; current_usage_day: number;
  last_reset_at: string; created_at: string;
  last_used_at?: string | null; last_outcome?: string | null; health_score?: number | null;
};

interface ApisPlatformsTabProps {
  authError: string | null;
}

export default function ApisPlatformsTab({ authError }: ApisPlatformsTabProps) {
  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const token = await getAuthToken();
    return fetch(input, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.headers || {}),
        ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
      },
    });
  };

  // Social platform OAuth config state
${socialState1}
${socialState2}
  // ── Provider accounts ──────────────────────────────────────────────────────
${socialState3}

${socialHandlers}

  useEffect(() => {
    if (socialPlatforms.length === 0 && !loadingSocialPlatforms) loadSocialPlatforms();
    if (catalogApis.length === 0 && !loadingCatalogApis) loadCatalogApis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  ${renderApiCategoryFn}

  return (
    <>
${mainJsx}
${accountModalJsx}
    </>
  );
}
`;

mkdirSync('c:/virality/components/super-admin/tabs', { recursive: true });
writeFileSync('c:/virality/components/super-admin/tabs/ApisPlatformsTab.tsx', apiTab, 'utf-8');
console.log(`ApisPlatformsTab.tsx written: ${apiTab.split('\n').length} lines`);
