/** Part 1/2 of SocialPlatformsSection.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useMemo, useState } from 'react';
import { OAUTH_PLATFORMS } from '@/pages/super-admin.types';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';
import { parseJsonResponse } from '@/lib/utils/safeFetchJson';
import {
  classifyAuthFailure,
  describeAuthFailure,
  isRecoverableAuthFailure,
  type AuthFailure,
} from '@/lib/security/superAdminAuthFailure';
import { runStepUpFlowIfNeeded, describeStepUpOutcome } from '@/lib/security/superAdminStepUp';
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Globe,
  RefreshCw,
  Save,
  XCircle,
} from 'lucide-react';


export type OAuthFormState = Record<string, { client_id: string; client_secret: string; enabled: boolean }>;
export type AnalyticsProviderFormState = {
  oauth_client_id: string;
  oauth_client_secret: string;
  enabled: boolean;
  redirect_uri: string;
  gsc_redirect_uri: string;
};
export type AnalyticsProviderConfigSummary = {
  provider: 'google_analytics';
  enabled: boolean;
  configured: boolean;
  client_id_preview: string;
  has_client_secret: boolean;
  scopes: string[];
  redirect_uri: string | null;
  capability_redirect_uris?: {
    google_analytics?: string | null;
    google_search_console?: string | null;
  };
  status: string;
  updated_at: string | null;
};

export type PlatformCheckResult = {
  credentials_ok: boolean;
  credentials_source?: 'platform_config' | 'env' | null;
  token_ok: boolean | null;
  token_detail: string | null;
  checked_at: string;
  live_check_supported?: boolean;
} | null;

// Phase E — canonical operational health surface. Sourced from
// /api/super-admin/integration-health. Shows the autonomous-lifecycle
// state of every provider per tenant. Contains NO tokens or secrets.
type IntegrationHealthPlatformRollup = {
  platform_key: string;
  configured: boolean;
  enabled: boolean;
  connected_count: number;
  reauth_required_count: number;
  refresh_required_count: number;
  expired_count: number;
  degraded_count: number;
  rate_limited_count: number;
};
export type IntegrationHealthSummary = {
  platforms: IntegrationHealthPlatformRollup[];
  tenants: Array<{
    company_id: string;
    company_name: string;
    per_platform: Array<{
      platform: string;
      state: string;
      expires_at: string | null;
      last_live_check_at: string | null;
      last_live_check_status: string | null;
      last_provider_error: string | null;
    }>;
  }>;
  generated_at: string;
};

export type BadgeTone = 'neutral' | 'warning' | 'danger' | 'success' | 'info';

export const CALLBACK_PLATFORMS = ['linkedin', 'x', 'youtube', 'tiktok', 'pinterest', 'facebook'];
/**
 * Platforms whose community-AI connector flow uses a distinct callback at
 * /api/community-ai/connectors/{platform}/callback (separate from the
 * publishing callback). The SUPER_ADMIN OAuth credentials panel surfaces
 * these as additional "Connector (local) / Connector (app)" redirect rows
 * so operators can register them in the provider's developer console.
 *
 * LinkedIn was previously in this list but is intentionally NOT here:
 * the LinkedIn community-ai connector auth flow at
 * pages/api/community-ai/connectors/linkedin/auth.ts sends OAuth to the
 * publishing callback (/api/auth/linkedin/callback) — it does not use the
 * connector callback path. Surfacing connector URLs for LinkedIn told
 * operators to register URLs that no flow actually uses, contributing to
 * the operator-confusion finding in the surface audit.
 *
 * X is excluded for the same reason it has been since this list was
 * created (single-callback flow).
 *
 * Facebook (Meta) stays — its community-ai connector flow at
 * pages/api/community-ai/connectors/meta/auth.ts genuinely uses the
 * /api/community-ai/connectors/meta/callback path.
 */
export const CONNECTOR_PLATFORMS = ['facebook'];

export const PLATFORM_ICONS: Record<string, string> = {
  linkedin:  '🔵',
  x:         '𝕏',
  youtube:   '▶️',
  facebook:  '📘',
  tiktok:    '🎵',
  pinterest: '📌',
  reddit:    '🟠',
};

export function createDefaultOauthForm(): OAuthFormState {
  return Object.fromEntries(
    OAUTH_PLATFORMS.map((platform) => [
      platform.platform_key,
      { client_id: '', client_secret: '', enabled: false },
    ])
  );
}

export function getPublicAppBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.omnivyra.com').replace(/\/$/, '');
}

export function getPublishingCallbackUri(platformKey: string, baseUrl: string) {
  if (platformKey === 'x') {
    return `${baseUrl}/auth/x/callback`;
  }
  return `${baseUrl}/api/auth/${platformKey}/callback`;
}

export function getPlatformStatus(
  platform: any,
  checkResult: PlatformCheckResult,
  isChecking: boolean
): { tone: BadgeTone; icon: any; label: string; title: string; spinning?: boolean } {
  if (!platform.configured) {
    return {
      tone: 'neutral',
      icon: XCircle,
      label: 'Not set up',
      title: 'No OAuth credentials have been saved yet.',
    };
  }

  if (!platform.enabled) {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Saved - disabled',
      title: 'Credentials are saved, but the platform is disabled for company admins.',
    };
  }

  if (isChecking) {
    return {
      tone: 'info',
      icon: RefreshCw,
      label: 'Checking',
      title: 'Running a live verification check now.',
      spinning: true,
    };
  }

  if (!checkResult) {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Configured - not verified',
      title: 'Credentials are saved, but no live verification has been run yet.',
    };
  }

  if (!checkResult.credentials_ok) {
    return {
      tone: 'danger',
      icon: XCircle,
      label: 'Credentials missing',
      title: 'This platform is enabled, but the client ID or secret is not available.',
    };
  }

  if (checkResult.token_ok === true) {
    return {
      tone: 'success',
      icon: CheckCircle,
      label: 'Live connection OK',
      title: checkResult.token_detail || 'Saved credentials and token both verified successfully.',
    };
  }

  if (checkResult.token_ok === false) {
    return {
      tone: 'danger',
      icon: XCircle,
      label: 'Connection broken',
      title: checkResult.token_detail || 'The saved token failed live verification.',
    };
  }

  if (checkResult.credentials_source === 'env') {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Env only',
      title: 'Credentials are coming from .env instead of the Super Admin database config.',
    };
  }

  if (checkResult.live_check_supported === false) {
    return {
      tone: 'warning',
      icon: AlertCircle,
      label: 'Manual verify',
      title: checkResult.token_detail || 'This platform does not have an automated live verification yet.',
    };
  }

  return {
    tone: 'warning',
    icon: AlertCircle,
    label: 'Awaiting account',
    title: checkResult.token_detail || 'Credentials are saved, but no connected account was found for live testing.',
  };
}

