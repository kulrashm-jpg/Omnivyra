import React from 'react';
import { CheckCircle, Clock, Globe, Plug, Rss, XCircle } from 'lucide-react';
import type { IntegrationStatus, IntegrationType } from './types';

export const TYPE_LABELS: Record<IntegrationType, string> = {
  lead_webhook: 'Lead Webhook',
  wordpress: 'WordPress',
  custom_blog_api: 'Custom Blog API',
};

export const TYPE_ICONS: Record<IntegrationType, React.ReactNode> = {
  lead_webhook: <Plug className="h-5 w-5" />,
  wordpress: <Globe className="h-5 w-5" />,
  custom_blog_api: <Rss className="h-5 w-5" />,
};

export const TYPE_COLORS: Record<IntegrationType, string> = {
  lead_webhook: 'bg-emerald-100 text-emerald-700',
  wordpress: 'bg-blue-100 text-blue-700',
  custom_blog_api: 'bg-violet-100 text-violet-700',
};

export const STATUS_BADGE: Record<IntegrationStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  connected: { label: 'Connected', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700 border-red-200', icon: <XCircle className="h-3.5 w-3.5" /> },
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="h-3.5 w-3.5" /> },
};

export const CONFIG_FIELDS: Record<IntegrationType, { key: string; label: string; placeholder: string; type?: string; hint?: string }[]> = {
  lead_webhook: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://your-crm.com/webhooks/leads', hint: 'Receives POST with { name, email, phone, source }' },
    { key: 'secret', label: 'Secret (optional)', placeholder: 'my-secret-key', hint: 'Sent as X-Webhook-Secret header' },
  ],
  wordpress: [
    { key: 'site_url', label: 'Site URL', placeholder: 'https://myblog.com' },
    { key: 'username', label: 'WordPress Username', placeholder: 'admin' },
    { key: 'app_password', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password', hint: 'Generate in WordPress under Users > Profile > Application Passwords' },
  ],
  custom_blog_api: [
    { key: 'endpoint_url', label: 'Endpoint URL', placeholder: 'https://api.myblog.com/posts' },
    { key: 'api_key', label: 'API Key', placeholder: 'sk-...', type: 'password' },
    { key: 'auth_header', label: 'Auth Header (optional)', placeholder: 'Authorization', hint: 'Defaults to Authorization: Bearer <api_key>' },
  ],
};
