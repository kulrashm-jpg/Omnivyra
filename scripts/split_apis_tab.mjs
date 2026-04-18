import { readFileSync, writeFileSync } from 'fs';

const src = readFileSync('c:/virality/components/super-admin/tabs/ApisPlatformsTab.tsx', 'utf-8');
const lines = src.split('\n');
const get = (from, to) => lines.slice(from - 1, to).join('\n');

// ── SocialPlatformsSection ────────────────────────────────────────────────────
// State: lines 49-60 (socialPlatforms … platformCheckResults)
// Handlers: lines 81-166 (loadSocialPlatforms, checkPlatformConfig, saveOauthConfig)
// JSX: lines 830-1065 (the social-tab div, minus the outer closing conditional paren)

const socialContent = `import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { OAUTH_PLATFORMS } from '@/pages/super-admin.types';
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

export default function SocialPlatformsSection() {
  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const token = await getAuthToken();
    return fetch(input, { ...init, credentials: 'include', headers: { ...(init?.headers || {}), ...(typeof token === 'string' && token ? { Authorization: \`Bearer \${token}\` } : {}) } });
  };

${get(49, 60)}
${get(81, 166)}

  useEffect(() => {
    loadSocialPlatforms();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
${get(830, 1065)}
  );
}
`;

writeFileSync('c:/virality/components/super-admin/tabs/SocialPlatformsSection.tsx', socialContent, 'utf-8');
console.log('SocialPlatformsSection.tsx:', socialContent.split('\n').length, 'lines');

// ── ApiCatalogSection ─────────────────────────────────────────────────────────
// State: lines 61-79
// CANONICAL_BASE_URLS: lines 168-187
// Handlers: lines 189-398
// renderApiCategorySection function: lines 407-789
// JSX (just the category render call + account modal): lines 1071-1137
// Props: categoryKey: 'trend' | 'community' | 'llm' | 'image' | 'others'

const catalogContent = `import React, { useState, useEffect } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { KNOWN_APIS } from '@/pages/super-admin.types';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type ProviderAccount = {
  id: string; api_source_id: string; account_name: string; priority: number;
  is_active: boolean; rate_limit_per_min: number | null; rate_limit_per_day: number | null;
  current_usage_min: number; current_usage_day: number;
  last_reset_at: string; created_at: string;
  last_used_at?: string | null; last_outcome?: string | null; health_score?: number | null;
};

interface ApiCatalogSectionProps {
  categoryKey: 'trend' | 'community' | 'llm' | 'image' | 'others';
}

export default function ApiCatalogSection({ categoryKey }: ApiCatalogSectionProps) {
  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const token = await getAuthToken();
    return fetch(input, { ...init, credentials: 'include', headers: { ...(init?.headers || {}), ...(typeof token === 'string' && token ? { Authorization: \`Bearer \${token}\` } : {}) } });
  };

${get(61, 79)}
${get(168, 398)}

  useEffect(() => {
    if (catalogApis.length === 0 && !loadingCatalogApis) loadCatalogApis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

${get(407, 789)}

  return (
    <>
      {apiEnvSaveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{apiEnvSaveError}</span>
          <button onClick={() => setApiEnvSaveError(null)} className="ml-4 text-red-400 hover:text-red-600 text-lg font-bold">×</button>
        </div>
      )}
      {renderApiCategorySection(categoryKey)}
${get(1071, 1137)}
    </>
  );
}
`;

writeFileSync('c:/virality/components/super-admin/tabs/ApiCatalogSection.tsx', catalogContent, 'utf-8');
console.log('ApiCatalogSection.tsx:', catalogContent.split('\n').length, 'lines');

// ── Rewrite ApisPlatformsTab as thin wrapper ──────────────────────────────────
const wrapper = `import React, { useState } from 'react';
import SocialPlatformsSection from './SocialPlatformsSection';
import ApiCatalogSection from './ApiCatalogSection';

interface ApisPlatformsTabProps {
  authError: string | null;
}

export default function ApisPlatformsTab({ authError }: ApisPlatformsTabProps) {
  const [apiSubTab, setApiSubTab] = useState<'social' | 'trend' | 'community' | 'llm' | 'image' | 'others'>('social');

  return (
    <div className="space-y-4">
      {authError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-6 py-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{authError}</span>
          <a href="/super-admin/login" className="ml-4 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap">
            Log in
          </a>
        </div>
      )}

      {/* Sub-tab bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3 flex gap-1 flex-wrap">
        {([
          { id: 'social',    label: 'Social Platform APIs' },
          { id: 'trend',     label: 'Trend APIs' },
          { id: 'community', label: 'Community APIs' },
          { id: 'llm',       label: 'LLM APIs' },
          { id: 'image',     label: 'Image APIs' },
          { id: 'others',    label: 'Others' },
        ] as const).map((sub) => (
          <button
            key={sub.id}
            onClick={() => setApiSubTab(sub.id)}
            className={\`px-4 py-2 rounded-lg text-sm font-medium transition-colors \${apiSubTab === sub.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}\`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {apiSubTab === 'social' && <SocialPlatformsSection />}
      {apiSubTab !== 'social' && <ApiCatalogSection categoryKey={apiSubTab} />}
    </div>
  );
}
`;

writeFileSync('c:/virality/components/super-admin/tabs/ApisPlatformsTab.tsx', wrapper, 'utf-8');
console.log('ApisPlatformsTab.tsx:', wrapper.split('\\n').length, 'lines');
