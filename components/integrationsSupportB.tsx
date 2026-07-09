/** Part 2/4 of integrations.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  Clock,
  Database,
  Files,
  Globe,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Rss,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';
import { fetchWithAuth } from '../components/community-ai/fetchWithAuth';
import { emitSetupChanged } from '../lib/setup/setupEvents';

import { type CmsEnvironmentType, type CmsValidationReport, type Integration, type Website, type IntegrationAction, TYPE_LABELS, TYPE_ICONS, TYPE_COLORS, STATUS_BADGE } from './integrationsSupportA';

interface ConnectionCardProps {
  integration: Integration;
  isAdmin: boolean;
  onEdit: (integration: Integration) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testing: boolean;
}

export function ConnectionCard({ integration, isAdmin, onEdit, onDelete, onTest, testing }: ConnectionCardProps) {
  const badge = STATUS_BADGE[integration.status];
  const lastTested = integration.last_tested_at ? new Date(integration.last_tested_at).toLocaleString() : 'Never';
  const testedUrl =
    integration.config.site_url ||
    integration.config.endpoint_url ||
    integration.config.webhook_url ||
    integration.config.shop_domain ||
    '';

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`shrink-0 rounded-lg p-2 ${TYPE_COLORS[integration.type]}`}>{TYPE_ICONS[integration.type]}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">{integration.name}</div>
            <div className="text-xs text-gray-500">{TYPE_LABELS[integration.type]}</div>
          </div>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
          {badge.icon}
          {badge.label}
        </span>
      </div>

      <div className="space-y-0.5 text-xs text-gray-500">
        {testedUrl && (
          <div className="truncate" title={testedUrl}>
            Testing: {testedUrl}
          </div>
        )}
        <div>Last tested: {lastTested}</div>
        {integration.last_error && integration.status === 'failed' && (
          <div className="truncate text-red-600" title={integration.last_error}>
            Error: {integration.last_error}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-1">
          <button
            onClick={() => onTest(integration.id)}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
            Test
          </button>
          <button
            onClick={() => onEdit(integration)}
            className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={() => onDelete(integration.id)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function EmptyConnections({
  title,
  actions,
}: {
  title: string;
  actions: IntegrationAction[];
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
      <p>{title}</p>
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          {actions.map((action) =>
            'href' in action ? (
              <a key={action.label} href={action.href} className="font-medium text-indigo-600 hover:text-indigo-700">
                {action.label} →
              </a>
            ) : (
              <button key={action.label} onClick={action.onClick} className="font-medium text-indigo-600 hover:text-indigo-700">
                {action.label} →
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function CategoryAction({ action }: { action: IntegrationAction }) {
  if ('href' in action) {
    return (
      <a
        href={action.href}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        {action.label}
        <ArrowRight className="h-4 w-4" />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
        action.tone === 'secondary'
          ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          : 'bg-gray-900 text-white hover:bg-gray-800'
      }`}
    >
      {action.label}
    </button>
  );
}

export type WorkflowStatus = 'connected' | 'attention' | 'not_started';

function workflowTone(status: WorkflowStatus) {
  if (status === 'connected') {
    return {
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      icon: <CheckCircle className="h-4 w-4" />,
      label: 'Connected',
    };
  }
  if (status === 'attention') {
    return {
      badge: 'border-amber-200 bg-amber-50 text-amber-700',
      icon: <Clock className="h-4 w-4" />,
      label: 'Needs attention',
    };
  }
  return {
    badge: 'border-gray-200 bg-gray-50 text-gray-600',
    icon: <Clock className="h-4 w-4" />,
    label: 'Not started',
  };
}

function WorkflowStatusPill({ status, label }: { status: WorkflowStatus; label?: string }) {
  const tone = workflowTone(status);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.badge}`}>
      {tone.icon}
      {label ?? tone.label}
    </span>
  );
}

export function WebsiteCommandCenter({
  primaryWebsite,
  websitesCount,
  publishingStatus,
  publishingDetail,
  leadStatus,
  analyticsStatus,
  intelligenceStatus,
  isAdmin,
  onConnectPublishing,
}: {
  primaryWebsite: Website | null;
  websitesCount: number;
  publishingStatus: WorkflowStatus;
  publishingDetail: string;
  leadStatus: WorkflowStatus;
  analyticsStatus: WorkflowStatus;
  intelligenceStatus: WorkflowStatus;
  isAdmin: boolean;
  onConnectPublishing: () => void;
}) {
  return (
    <section className="mb-8 border-b border-gray-200 pb-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Website integration status</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-950">
            {primaryWebsite ? primaryWebsite.name : 'No website selected yet'}
          </h2>
          <p className="mt-1 break-all text-sm text-gray-500">
            {primaryWebsite?.canonical_url ?? 'Add a website once, then decide whether you want publishing, lead capture, analytics, or all three.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:min-w-[520px]">
          <div>
            <p className="text-[11px] font-medium text-gray-500">Websites</p>
            <p className="mt-1 text-lg font-semibold text-gray-950">{websitesCount}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Publishing</p>
            <div className="mt-1"><WorkflowStatusPill status={publishingStatus} /></div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Lead capture</p>
            <div className="mt-1"><WorkflowStatusPill status={leadStatus} /></div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Analytics</p>
            <div className="mt-1"><WorkflowStatusPill status={analyticsStatus} /></div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorkflowCard
          icon={<Globe className="h-5 w-5" />}
          title="Blog publishing"
          description={publishingDetail}
          status={publishingStatus}
          primaryLabel={publishingStatus === 'connected' ? 'Manage publishing' : 'Connect publishing'}
          onPrimary={onConnectPublishing}
          secondaryHref="#website-publishing-section"
          secondaryLabel="View connection"
          isAdmin={isAdmin}
        />
        <WorkflowCard
          icon={<Plug className="h-5 w-5" />}
          title="Lead capture"
          description="Create hosted forms, embed forms on your site, and route submissions to your team or CRM."
          status={leadStatus}
          primaryHref="/leads?tab=forms"
          primaryLabel="Open lead capture"
          secondaryHref="/leads?tab=connections"
          secondaryLabel="Lead routing"
          isAdmin={isAdmin}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="border-t border-gray-200 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Analytics & tracking</p>
              <p className="mt-1 text-xs text-gray-500">Traffic and search data for reports and intelligence.</p>
            </div>
            <WorkflowStatusPill status={analyticsStatus} />
          </div>
          <a href="/integrations?focus=data" className="mt-3 inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            Manage analytics
          </a>
        </div>
        <div className="border-t border-gray-200 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Intelligence readiness</p>
              <p className="mt-1 text-xs text-gray-500">Becomes stronger as publishing, lead capture, and analytics produce signal.</p>
            </div>
            <WorkflowStatusPill status={intelligenceStatus} />
          </div>
          <a href="/intelligence" className="mt-3 inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            Open intelligence
          </a>
        </div>
      </div>
    </section>
  );
}

function WorkflowCard({
  icon,
  title,
  description,
  status,
  primaryLabel,
  secondaryLabel,
  isAdmin,
  onPrimary,
  primaryHref,
  secondaryHref,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: WorkflowStatus;
  primaryLabel: string;
  secondaryLabel: string;
  isAdmin: boolean;
  onPrimary?: () => void;
  primaryHref?: string;
  secondaryHref: string;
}) {
  const primaryClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-700">
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
            <p className="mt-1 text-sm leading-5 text-gray-600">{description}</p>
          </div>
        </div>
        <WorkflowStatusPill status={status} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {primaryHref ? (
          <a href={primaryHref} className={primaryClass}>
            {primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <button type="button" onClick={onPrimary} disabled={!isAdmin} className={`${primaryClass} disabled:opacity-50`}>
            {primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
        <a href={secondaryHref} className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          {secondaryLabel}
        </a>
      </div>
    </div>
  );
}

const WP_LOCAL_CONFIG_SNIPPET = `define('WP_ENVIRONMENT_TYPE', 'local');

// or, equivalently:
define('WP_ENVIRONMENT_TYPE', 'development');`;

// Client-side mirror of provider local-dev guidance (label + optional snippet).
const PROVIDER_META: Record<string, { label: string; snippet?: string; localHint?: string }> = {
  wordpress: {
    label: 'WordPress',
    snippet: WP_LOCAL_CONFIG_SNIPPET,
    localHint: 'WordPress disables Application Passwords on non-HTTPS environments by default. Add this to wp-config.php to enable local auth:',
  },
  ghost: { label: 'Ghost', localHint: 'Create a Custom Integration in Ghost Admin and use its Admin API key for local development.' },
  joomla: { label: 'Joomla', localHint: 'Enable Web Services (REST API) and create a Joomla API token for local development.' },
  drupal: { label: 'Drupal', localHint: 'Enable the core JSON:API module to allow local development access.' },
  webflow: { label: 'Webflow' },
  shopify: { label: 'Shopify Blog' },
  hubspot: { label: 'HubSpot CMS' },
  wix: { label: 'Wix Blog' },
  squarespace: { label: 'Squarespace (read-only)', localHint: 'Squarespace has no public write API — this integration validates reachability only; publishing is not supported.' },
  custom_blog_api: { label: 'Custom Blog API' },
};

function providerMeta(provider: string) {
  return PROVIDER_META[provider] ?? { label: provider };
}

const ENV_BADGE: Record<CmsEnvironmentType, { label: string; cls: string }> = {
  localhost: { label: 'Localhost', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  local_network: { label: 'Local network', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  staging: { label: 'Staging / Dev', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  production: { label: 'Production', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
};

function DiagRow({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const icon =
    ok === true ? (
      <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
    ) : ok === false ? (
      <XCircle className="h-3.5 w-3.5 text-red-600" />
    ) : (
      <Clock className="h-3.5 w-3.5 text-gray-400" />
    );
  return (
    <div className="flex items-center gap-2 text-xs text-gray-700">
      {icon}
      <span className="font-medium">{label}:</span>
      <span className="text-gray-500">{detail ?? (ok === true ? 'OK' : ok === false ? 'Failed' : 'Not checked')}</span>
    </div>
  );
}

export function CmsDiagnosticsPanel({
  report,
  onRedetect,
  redetecting,
}: {
  report: CmsValidationReport;
  onRedetect?: () => void;
  redetecting?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const env = ENV_BADGE[report.environmentType] ?? ENV_BADGE.production;
  // Canonical operational base = apiBase. No detected root while apiReachable
  // means publishing is running on the legacy fallback (degraded).
  const usingFallback = report.apiReachable && !report.detectedApiRoot;
  const meta = providerMeta(report.provider);
  const isLocalDev = report.environmentType === 'localhost' || report.environmentType === 'local_network';
  // Local-setup guidance is only relevant for non-HTTPS local/dev sites where
  // the provider would otherwise refuse to authenticate, and only while auth
  // is not yet working.
  const showLocalGuidance =
    isLocalDev && !report.httpsEnabled && report.authWorking !== true && Boolean(meta.localHint);
  const devDiag =
    report.diagnostics && typeof report.diagnostics === 'object'
      ? (report.diagnostics as any).developerDiagnostics
      : null;

  const copySnippet = async () => {
    if (!meta.snippet) return;
    try {
      await navigator.clipboard.writeText(meta.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — snippet is still visible to copy manually */
    }
  };

  const sevBadge =
    report.severity === 'fatal'
      ? 'bg-red-100 text-red-800 border-red-300'
      : report.severity === 'warning'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200';

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">{meta.label} diagnostics</span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${env.cls}`}>
          <Globe className="h-3 w-3" />
          {env.label}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            report.httpsEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          {report.httpsEnabled ? 'HTTPS' : 'HTTP only'}
        </span>
        {report.errorCode && (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sevBadge}`}>
            {report.errorCode}
            {report.retryable ? ' · retryable' : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <DiagRow label="API" ok={report.apiReachable} detail={report.apiReachable ? 'Reachable' : 'Unreachable'} />
        <DiagRow
          label="Auth"
          ok={report.authWorking}
          detail={
            report.authWorking === true
              ? 'Working'
              : report.authWorking === false
                ? 'Failed'
                : report.authSupported === false
                  ? 'Unsupported'
                  : 'Not checked'
          }
        />
        <DiagRow label="Publish" ok={report.publishSupported} />
        <DiagRow label="Webhook" ok={report.webhookSupported} detail={report.webhookSupported ? 'Supported' : 'Unsupported'} />
        <DiagRow
          label="API root"
          ok={report.detectedApiRoot ? true : report.apiReachable ? null : false}
          detail={report.detectedApiRoot ?? 'Not detected'}
        />
        <DiagRow
          label="Canonical base"
          ok={report.apiBase ? true : null}
          detail={report.apiBase ?? 'Unresolved'}
        />
      </div>

      {(usingFallback || onRedetect) && (
        <div className="flex flex-wrap items-center gap-2">
          {usingFallback && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              Fallback mode — REST root not auto-detected, using legacy default
            </span>
          )}
          {onRedetect && (
            <button
              type="button"
              onClick={onRedetect}
              disabled={redetecting}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${redetecting ? 'animate-spin' : ''}`} />
              {redetecting ? 'Re-detecting…' : 'Re-detect API'}
            </button>
          )}
        </div>
      )}

      {report.remediationSteps.length > 0 && (
        <div className="rounded-md bg-gray-50 p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">How to fix</div>
          <ul className="list-disc space-y-1 pl-4 text-xs text-gray-700">
            {report.remediationSteps
              .filter((step) => !meta.snippet || step.trim() !== meta.snippet.trim())
              .map((step, i) => (
                <li key={i}>{step}</li>
              ))}
          </ul>
        </div>
      )}

      {showLocalGuidance && (
        <div className="rounded-md border border-violet-200 bg-violet-50 p-2">
          <div className="mb-1 text-xs font-semibold text-violet-800">Local development setup</div>
          <p className="mb-2 text-xs text-violet-700">{meta.localHint}</p>
          {meta.snippet && (
            <div className="relative">
              <pre className="overflow-x-auto rounded bg-gray-900 p-2 pr-16 text-[11px] leading-relaxed text-emerald-300">
                <code>{meta.snippet}</code>
              </pre>
              <button
                type="button"
                onClick={copySnippet}
                className="absolute right-1.5 top-1.5 rounded bg-white/10 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/20"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}

      {devDiag && (
        <div className="text-[11px] text-gray-500">
          <button
            type="button"
            onClick={() => setShowDev((v) => !v)}
            className="font-medium text-gray-600 underline-offset-2 hover:underline"
          >
            {showDev ? 'Hide' : 'Show'} developer diagnostics
          </button>
          {showDev && (
            <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-gray-700">{String(devDiag)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

