/**
 * WhatsApp Campaign Hub — /whatsapp
 * Overview dashboard for company admin & users.
 * Links to: broadcasts, templates, inbox.
 * Shows quick stats from broadcasts analytics.
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  Send,
  FileText,
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Wifi,
  WifiOff,
} from 'lucide-react';

type WaAccount = {
  social_account_id: string | null;
  account_name: string | null;
  connected: boolean;
  expired: boolean;
  token_expires_at: string | null;
};

type BroadcastSummary = {
  total: number;
  sent: number;
  failed: number;
  draft: number;
  avg_delivery_rate: number;
  avg_read_rate: number;
};

const NAV_ITEMS = [
  {
    href: '/whatsapp/broadcasts',
    icon: Send,
    title: 'Broadcasts',
    description: 'Create and send bulk messages to your contacts',
    color: 'text-green-600',
    bg: 'bg-green-50 hover:bg-green-100',
    border: 'border-green-200',
  },
  {
    href: '/whatsapp/templates',
    icon: FileText,
    title: 'Message Templates',
    description: 'Create and manage Meta-approved message templates',
    color: 'text-blue-600',
    bg: 'bg-blue-50 hover:bg-blue-100',
    border: 'border-blue-200',
  },
  {
    href: '/whatsapp/inbox',
    icon: MessageSquare,
    title: 'Conversations Inbox',
    description: 'Reply to inbound messages within the 24h window',
    color: 'text-purple-600',
    bg: 'bg-purple-50 hover:bg-purple-100',
    border: 'border-purple-200',
  },
];

export default function WhatsAppHubPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [account, setAccount] = useState<WaAccount | null>(null);
  const [summary, setSummary] = useState<BroadcastSummary | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  useEffect(() => {
    if (!companyId) return;

    // Load connected WA account from status endpoint
    setLoadingAccount(true);
    fetch(`/api/social-accounts/status?companyId=${encodeURIComponent(companyId)}`, {
      credentials: 'include',
    })
      .then((r) => r.ok ? r.json() : { accounts: [] })
      .then((data) => {
        const wa = (data.accounts ?? []).find((a: any) => a.platform_key === 'whatsapp');
        if (wa) {
          setAccount({
            social_account_id: wa.social_account_id,
            account_name: wa.account_name,
            connected: wa.connected,
            expired: wa.expired,
            token_expires_at: wa.token_expires_at,
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAccount(false));

    // Load broadcast counts from broadcasts endpoint (includes all statuses: draft, queued, sent, failed)
    // Load delivery/read rates separately from analytics endpoint
    setLoadingSummary(true);
    Promise.all([
      fetch(`/api/whatsapp/broadcasts?company_id=${encodeURIComponent(companyId)}&limit=200`, { credentials: 'include' })
        .then((r) => r.ok ? r.json() : { broadcasts: [] }),
      fetch(`/api/analytics/whatsapp/broadcasts?company_id=${encodeURIComponent(companyId)}&per_page=200`, { credentials: 'include' })
        .then((r) => r.ok ? r.json() : { broadcasts: [] }),
    ])
      .then(([broadcastsData, analyticsData]) => {
        const broadcasts: any[] = broadcastsData.broadcasts ?? [];
        const analyticsRows: any[] = analyticsData.broadcasts ?? [];
        if (broadcasts.length === 0) return;
        const avgDelivery = analyticsRows.length > 0
          ? analyticsRows.reduce((s: number, r: any) => s + (r.delivery_rate ?? 0), 0) / analyticsRows.length
          : 0;
        const avgRead = analyticsRows.length > 0
          ? analyticsRows.reduce((s: number, r: any) => s + (r.read_rate ?? 0), 0) / analyticsRows.length
          : 0;
        setSummary({
          total: broadcasts.length,
          sent: broadcasts.filter((b: any) => b.status === 'sent').length,
          failed: broadcasts.filter((b: any) => b.status === 'failed' || b.status === 'partial').length,
          draft: broadcasts.filter((b: any) => b.status === 'draft').length,
          avg_delivery_rate: avgDelivery,
          avg_read_rate: avgRead,
        });
      })
      .catch(() => {})
      .finally(() => setLoadingSummary(false));
  }, [companyId]);

  if (!companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Select a company to access WhatsApp campaigns
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>WhatsApp Campaigns</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">WhatsApp Campaigns</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage broadcasts, templates, and customer conversations
          </p>
        </header>

        <main className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Account status banner */}
          <div className={`rounded-lg border px-4 py-3 flex items-center justify-between ${
            account?.connected && !account.expired
              ? 'bg-green-50 border-green-200'
              : 'bg-yellow-50 border-yellow-200'
          }`}>
            <div className="flex items-center gap-2">
              {account?.connected && !account.expired ? (
                <Wifi className="h-4 w-4 text-green-600" />
              ) : (
                <WifiOff className="h-4 w-4 text-yellow-600" />
              )}
              {loadingAccount ? (
                <span className="text-sm text-gray-500">Checking WhatsApp connection...</span>
              ) : account?.connected && !account.expired ? (
                <span className="text-sm text-green-800 font-medium">
                  Connected: {account.account_name ?? 'WhatsApp Account'}
                </span>
              ) : account?.connected && account.expired ? (
                <span className="text-sm text-yellow-800 font-medium">
                  Token expired — reconnect your WhatsApp account
                </span>
              ) : (
                <span className="text-sm text-yellow-800 font-medium">
                  No WhatsApp account connected
                </span>
              )}
            </div>
            {(!account?.connected || account.expired) && (
              <Link
                href="/social-platforms"
                className="text-xs text-yellow-800 underline hover:text-yellow-900"
              >
                Connect account
              </Link>
            )}
          </div>

          {/* Quick stats */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">{summary.total}</div>
                <div className="text-xs text-gray-500 mt-0.5">Total Broadcasts</div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{summary.sent}</div>
                <div className="text-xs text-gray-500 mt-0.5">Sent</div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {(summary.avg_delivery_rate * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Avg Delivery</div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {(summary.avg_read_rate * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Avg Read</div>
              </div>
            </div>
          )}

          {/* Navigation cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-lg border p-5 transition-colors ${item.bg} ${item.border}`}
                >
                  <div className="flex items-start justify-between">
                    <Icon className={`h-6 w-6 ${item.color}`} />
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                  <div className={`mt-3 text-base font-semibold ${item.color}`}>{item.title}</div>
                  <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                </Link>
              );
            })}
          </div>

          {/* Status legend */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Broadcast Status Guide</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                { icon: <Clock className="h-4 w-4 text-gray-400" />, label: 'Draft', desc: 'Saved, not yet sent' },
                { icon: <Clock className="h-4 w-4 text-blue-500" />, label: 'Queued', desc: 'Waiting to send' },
                { icon: <Send className="h-4 w-4 text-yellow-500" />, label: 'Sending', desc: 'In progress' },
                { icon: <CheckCircle className="h-4 w-4 text-green-500" />, label: 'Sent', desc: 'Delivered to all' },
                { icon: <AlertTriangle className="h-4 w-4 text-orange-500" />, label: 'Partial', desc: 'Some failed — retryable' },
                { icon: <XCircle className="h-4 w-4 text-red-500" />, label: 'Failed', desc: 'All failed — retry available' },
              ].map((s) => (
                <div key={s.label} className="flex items-start gap-2">
                  <div className="mt-0.5">{s.icon}</div>
                  <div>
                    <div className="font-medium text-gray-800">{s.label}</div>
                    <div className="text-xs text-gray-500">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
