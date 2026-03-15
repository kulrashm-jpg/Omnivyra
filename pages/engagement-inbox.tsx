/**
 * Campaign Engagement Inbox
 * SYSTEM 2: Displays engagement signals from campaign activities.
 * Data source: GET /api/engagement/campaign-signals
 */

import React, { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useCompanyContext } from '@/components/CompanyContext';
import PlatformIcon from '@/components/ui/PlatformIcon';
import {
  Bookmark,
  ExternalLink,
  MessageSquare,
  Send,
  UserPlus,
} from 'lucide-react';

type CampaignSignal = {
  id: string;
  campaign_id: string;
  activity_id: string;
  platform: string;
  author?: string | null;
  content?: string | null;
  signal_type: string;
  conversation_url?: string | null;
  engagement_score: number;
  detected_at: string;
  signal_status?: string;
};

const SIGNAL_STATUSES = ['new', 'reviewed', 'actioned', 'ignored'] as const;

const SIGNAL_TYPES = ['comment', 'reply', 'mention', 'quote', 'discussion', 'buyer_intent_signal'];
const PLATFORMS = ['linkedin', 'twitter', 'discord', 'slack', 'reddit', 'github'];
const TIME_RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
];

export default function EngagementInboxPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [signals, setSignals] = useState<CampaignSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<CampaignSignal | null>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [campaignId, setCampaignId] = useState('');
  const [platform, setPlatform] = useState('');
  const [signalType, setSignalType] = useState('');
  const [timeRange, setTimeRange] = useState('7d');

  const updateSignalStatus = async (signalId: string, status: string) => {
    try {
      const res = await fetch('/api/engagement/signal/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ signalId, status, companyId }),
      });
      if (!res.ok) throw new Error(res.statusText);
      setSelectedSignal((s) => (s?.id === signalId ? { ...s, signal_status: status } : s));
      setSignals((prev) => prev.map((x) => (x.id === signalId ? { ...x, signal_status: status } : x)));
    } catch {
      // ignore
    }
  };

  const fetchSignals = useCallback(async () => {
    if (!companyId) {
      setSignals([]);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ companyId });
    if (campaignId) params.set('campaignId', campaignId);
    if (platform) params.set('platform', platform);
    if (signalType) params.set('signalType', signalType);
    const days = parseInt(String(timeRange).replace('d', ''), 10) || 7;
    const from = new Date();
    from.setDate(from.getDate() - days);
    params.set('dateFrom', from.toISOString());
    params.set('dateTo', new Date().toISOString());

    try {
      const res = await fetch(`/api/engagement/campaign-signals?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSignals(data.signals ?? []);
      if (selectedSignal && !(data.signals ?? []).some((s: CampaignSignal) => s.id === selectedSignal.id)) {
        setSelectedSignal(null);
      }
    } catch (err) {
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, campaignId, platform, signalType, timeRange, selectedSignal?.id]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/campaigns/list?companyId=${encodeURIComponent(companyId)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { campaigns: [] })
      .then((data) => setCampaigns(data.campaigns ?? []))
      .catch(() => setCampaigns([]));
  }, [companyId]);

  return (
    <>
      <Head>
        <title>Campaign Engagement Inbox</title>
      </Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Campaign Engagement Inbox</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Conversations and signals from your campaign activities
          </p>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Filters */}
          <aside className="w-64 bg-white border-r border-gray-200 p-4 shrink-0 overflow-y-auto">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Filters</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Campaign</label>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">All campaigns</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">All</option>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Signal type</label>
                <select
                  value={signalType}
                  onChange={(e) => setSignalType(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">All</option>
                  {SIGNAL_TYPES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Time range</label>
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {TIME_RANGES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </aside>

          {/* Main: Signal list */}
          <main className="flex-1 min-w-0 border-r border-gray-200 flex flex-col bg-white">
            <div className="p-3 border-b border-gray-100 text-sm text-gray-500">
              {loading ? 'Loading...' : `${signals.length} signal${signals.length !== 1 ? 's' : ''}`}
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Loading signals...</div>
              ) : signals.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No campaign signals yet. Engagement from campaign activities will appear here.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {signals.map((sig) => (
                    <li
                      key={sig.id}
                      onClick={() => setSelectedSignal(sig)}
                      className={`p-3 cursor-pointer hover:bg-gray-50 ${
                        selectedSignal?.id === sig.id ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="font-medium text-gray-900">{sig.author || 'Anonymous'}</span>
                            <PlatformIcon platform={sig.platform} size={12} showLabel />
                            <span className="capitalize">{sig.signal_type.replace('_', ' ')}</span>
                            <span>{(Number(sig.engagement_score) * 100).toFixed(0)}%</span>
                          </div>
                          <p className="text-sm text-gray-800 line-clamp-2 mt-0.5">{sig.content || '—'}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {sig.detected_at ? new Date(sig.detected_at).toLocaleString() : '—'}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </main>

          {/* Right: Detail */}
          <aside className="w-96 bg-white flex flex-col shrink-0">
            {selectedSignal ? (
              <>
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-900">Conversation detail</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Author</div>
                    <div className="text-sm font-medium text-gray-900">
                      {selectedSignal.author || 'Anonymous'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Content</div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {selectedSignal.content || '—'}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Platform · Type · Score</div>
                    <div className="flex items-center gap-2 text-sm">
                      <PlatformIcon platform={selectedSignal.platform} size={14} showLabel />
                      <span className="capitalize">{selectedSignal.signal_type.replace('_', ' ')}</span>
                      <span>{(Number(selectedSignal.engagement_score) * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Date</div>
                    <div className="text-sm text-gray-700">
                      {selectedSignal.detected_at
                        ? new Date(selectedSignal.detected_at).toLocaleString()
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Status</div>
                    <select
                      value={selectedSignal.signal_status || 'new'}
                      onChange={(e) => updateSignalStatus(selectedSignal.id, e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      {SIGNAL_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  {selectedSignal.conversation_url && (
                    <a
                      href={selectedSignal.conversation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View thread
                    </a>
                  )}
                  <div className="text-xs text-gray-500 pt-2">
                    Linked activity: {selectedSignal.activity_id}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-4">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 flex items-center gap-1.5"
                    >
                      <MessageSquare className="h-4 w-4" />
                      Reply
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 flex items-center gap-1.5"
                    >
                      <Bookmark className="h-4 w-4" />
                      Bookmark
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 flex items-center gap-1.5"
                    >
                      <UserPlus className="h-4 w-4" />
                      Mark as lead
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 flex items-center gap-1.5"
                    >
                      <Send className="h-4 w-4" />
                      Export to CRM
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-gray-500 text-sm">
                Select a signal to view details
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
