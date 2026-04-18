/**
 * WhatsApp Broadcasts — /whatsapp/broadcasts
 * Create, list, retry failed broadcasts; view delivery stats.
 *
 * APIs:
 *   GET  /api/whatsapp/broadcasts?company_id=
 *   POST /api/whatsapp/broadcasts
 *   POST /api/whatsapp/broadcasts/[id]?action=retry
 *   GET  /api/analytics/whatsapp/broadcasts?company_id=
 *   GET  /api/whatsapp/templates?company_id=&active_only=true   (for template picker)
 *   GET  /api/social-accounts/status?companyId=                 (for WA account picker)
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  Send,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Plus,
  FileText,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type MessageType = 'template' | 'text';

type Broadcast = {
  id: string;
  name: string;
  message_type: MessageType;
  template_name?: string | null;
  body?: string | null;
  status: 'draft' | 'queued' | 'running' | 'sending' | 'sent' | 'failed' | 'partial' | 'paused';
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_at: string;
  scheduled_for?: string | null;
};

type BroadcastAnalytics = {
  broadcast_id: string;
  delivery_rate: number;
  read_rate: number;
  failure_rate: number;
};

type WaAccount = { id: string; name: string };
type Template = { id: string; template_name: string; status: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:   'bg-gray-100 text-gray-700',
  queued:  'bg-blue-100 text-blue-700',
  running: 'bg-yellow-100 text-yellow-700',
  sending: 'bg-yellow-100 text-yellow-700',
  sent:    'bg-green-100 text-green-700',
  failed:  'bg-red-100 text-red-700',
  partial: 'bg-orange-100 text-orange-700',
  paused:  'bg-gray-100 text-gray-500',
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'sent')                    return <CheckCircle className="h-4 w-4 text-green-600" />;
  if (status === 'failed')                  return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === 'running' || status === 'sending') return <RefreshCw className="h-4 w-4 text-yellow-600 animate-spin" />;
  if (status === 'queued')                  return <Clock className="h-4 w-4 text-blue-600" />;
  if (status === 'partial')                 return <AlertCircle className="h-4 w-4 text-orange-600" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function WhatsAppBroadcastsPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, BroadcastAnalytics>>({});
  const [waAccounts, setWaAccounts] = useState<WaAccount[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipientErrors, setRecipientErrors] = useState<string[]>([]);

  // Form state
  const [form, setForm] = useState({
    social_account_id: '',
    name: '',
    message_type: 'template' as MessageType,
    template_name: '',
    template_params: '',   // JSON string of param array e.g. ["John","ORD-123"]
    body: '',
    recipients: '',        // one E.164 phone per line
  });

  // Load WA accounts + active templates
  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/social-accounts/status?companyId=${encodeURIComponent(companyId)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { accounts: [] })
      .then((data) => {
        const wa = (data.accounts ?? []).filter(
          (a: any) => a.platform_key === 'whatsapp' && a.connected && !a.expired && a.social_account_id
        );
        setWaAccounts(wa.map((a: any) => ({ id: a.social_account_id, name: a.account_name ?? 'WhatsApp' })));
        if (wa.length > 0) setForm((f) => ({ ...f, social_account_id: wa[0].social_account_id }));
      })
      .catch(() => {});

    fetch(`/api/whatsapp/templates?company_id=${encodeURIComponent(companyId)}&active_only=true`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { templates: [] })
      .then((data) => {
        setTemplates((data.templates ?? []).filter((t: Template) => t.status === 'APPROVED'));
        if (data.templates?.length > 0) {
          setForm((f) => ({ ...f, template_name: data.templates[0].template_name }));
        }
      })
      .catch(() => {});
  }, [companyId]);

  const fetchBroadcasts = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/broadcasts?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load broadcasts');
      setBroadcasts(data.broadcasts ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchAnalytics = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/analytics/whatsapp/broadcasts?company_id=${encodeURIComponent(companyId)}&per_page=100`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, BroadcastAnalytics> = {};
      for (const row of data.broadcasts ?? []) map[row.broadcast_id] = row;
      setAnalytics(map);
    } catch { /* non-critical */ }
  }, [companyId]);

  useEffect(() => {
    fetchBroadcasts();
    fetchAnalytics();
  }, [fetchBroadcasts, fetchAnalytics]);

  const E164_RE = /^\+[1-9]\d{1,14}$/;

  const validateRecipients = (raw: string): { valid: string[]; errors: string[] } => {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const valid: string[] = [];
    const errors: string[] = [];
    lines.forEach((phone) => {
      if (E164_RE.test(phone)) {
        valid.push(phone);
      } else {
        errors.push(`"${phone}" is not a valid E.164 number (e.g. +14155552671)`);
      }
    });
    return { valid, errors };
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !form.social_account_id) return;
    setCreating(true);
    setError(null);
    setRecipientErrors([]);

    const { valid, errors: valErrors } = validateRecipients(form.recipients);

    if (valErrors.length > 0) {
      setRecipientErrors(valErrors);
      setCreating(false);
      return;
    }

    const contacts = valid.map((phone) => ({ phone_number: phone }));

    if (contacts.length === 0) {
      setError('Enter at least one recipient phone number');
      setCreating(false);
      return;
    }

    let template_params: string[] | undefined;
    if (form.message_type === 'template' && form.template_params.trim()) {
      try {
        template_params = JSON.parse(form.template_params);
      } catch {
        setError('Template params must be valid JSON array e.g. ["John","ORD-123"]');
        setCreating(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/whatsapp/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          company_id: companyId,
          social_account_id: form.social_account_id,
          name: form.name,
          message_type: form.message_type,
          template_name: form.message_type === 'template' ? form.template_name : undefined,
          template_params: template_params,
          body: form.message_type === 'text' ? form.body : undefined,
          contacts,
          enqueue: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create broadcast');
      setShowForm(false);
      setForm((f) => ({ ...f, name: '', body: '', recipients: '', template_params: '' }));
      setRecipientErrors([]);
      await fetchBroadcasts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRetry = async (broadcastId: string) => {
    setRetrying(broadcastId);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/broadcasts/${broadcastId}?action=retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Retry failed');
      await fetchBroadcasts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRetrying(null);
    }
  };

  if (!companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Select a company to manage broadcasts
      </div>
    );
  }

  const noWaAccount = waAccounts.length === 0;

  return (
    <>
      <Head>
        <title>WhatsApp Broadcasts</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/whatsapp" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Broadcasts</h1>
              <p className="text-xs text-gray-500">Send bulk messages to your contacts</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchBroadcasts(); fetchAnalytics(); }}
              className="p-2 rounded border border-gray-300 hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4 text-gray-600" />
            </button>
            <button
              onClick={() => { setShowForm((v) => !v); setError(null); }}
              disabled={noWaAccount}
              title={noWaAccount ? 'Connect a WhatsApp account first' : 'New broadcast'}
              className="px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              New Broadcast
            </button>
          </div>
        </header>

        <main className="max-w-4xl mx-auto p-6 space-y-4">
          {noWaAccount && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-yellow-800">No WhatsApp account connected. Connect one to start broadcasting.</span>
              <Link href="/social-platforms" className="text-yellow-900 underline font-medium">Connect</Link>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>
          )}

          {/* Create Broadcast Form */}
          {showForm && !noWaAccount && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">New Broadcast</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                {/* Account picker */}
                {waAccounts.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Account</label>
                    <select
                      value={form.social_account_id}
                      onChange={(e) => setForm((f) => ({ ...f, social_account_id: e.target.value }))}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      required
                    >
                      {waAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Broadcast Name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="April promo blast"
                  />
                </div>

                {/* Message type toggle */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Message Type</label>
                  <div className="flex rounded border border-gray-300 overflow-hidden w-fit">
                    {(['template', 'text'] as MessageType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, message_type: t }))}
                        className={`px-4 py-1.5 text-sm capitalize ${form.message_type === t ? 'bg-green-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                      >
                        {t === 'template' ? 'Template' : 'Free-form Text'}
                      </button>
                    ))}
                  </div>
                  {form.message_type === 'template' && (
                    <p className="text-xs text-gray-400 mt-1">
                      Template messages can be sent outside the 24h window. Requires a Meta-approved template.
                    </p>
                  )}
                  {form.message_type === 'text' && (
                    <p className="text-xs text-orange-500 mt-1">
                      Free-form text can only be sent within the 24h reply window.
                    </p>
                  )}
                </div>

                {/* Template or text body */}
                {form.message_type === 'template' ? (
                  <div className="space-y-3">
                    {templates.length === 0 ? (
                      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        No approved templates. {' '}
                        <Link href="/whatsapp/templates" className="underline font-medium">Create a template</Link>
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
                          <select
                            value={form.template_name}
                            onChange={(e) => setForm((f) => ({ ...f, template_name: e.target.value }))}
                            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                            required={form.message_type === 'template'}
                          >
                            {templates.map((t) => (
                              <option key={t.id} value={t.template_name}>{t.template_name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Template Parameters{' '}
                            <span className="text-gray-400 font-normal">(JSON array, optional)</span>
                          </label>
                          <input
                            type="text"
                            value={form.template_params}
                            onChange={(e) => setForm((f) => ({ ...f, template_params: e.target.value }))}
                            className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
                            placeholder={`["John", "ORD-123", "15 Apr"]`}
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            Values for {`{{1}}`}, {`{{2}}`}, {`{{3}}`}… in the template body
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                    <textarea
                      required
                      rows={4}
                      value={form.body}
                      onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="Hello! We have an exciting offer just for you..."
                    />
                  </div>
                )}

                {/* Recipients */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Recipients <span className="text-gray-400 font-normal">(one E.164 phone number per line)</span>
                  </label>
                  <textarea
                    required
                    rows={5}
                    value={form.recipients}
                    onChange={(e) => { setForm((f) => ({ ...f, recipients: e.target.value })); setRecipientErrors([]); }}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder={`+14155552671\n+447911123456\n+919876543210`}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {form.recipients.split('\n').filter((l) => l.trim()).length} recipients entered
                  </p>
                  {recipientErrors.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {recipientErrors.map((err, i) => (
                        <li key={i} className="text-xs text-red-600">{err}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating || (form.message_type === 'template' && templates.length === 0)}
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {creating ? 'Sending...' : 'Send Broadcast'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Broadcast List */}
          {loading ? (
            <div className="py-16 text-center text-gray-500">Loading broadcasts...</div>
          ) : broadcasts.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">No broadcasts yet. Create your first above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {broadcasts.map((b) => {
                const stats = analytics[b.id];
                const isExpanded = expandedId === b.id;
                const canRetry = b.status === 'failed' || b.status === 'partial';
                return (
                  <div key={b.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                      onClick={() => setExpandedId(isExpanded ? null : b.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <StatusIcon status={b.status} />
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 text-sm truncate">{b.name}</div>
                          <div className="text-xs text-gray-400">
                            {new Date(b.created_at).toLocaleString()} · {b.total_recipients} recipients
                            {b.template_name && <span> · <span className="font-mono">{b.template_name}</span></span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[b.status] ?? STATUS_COLORS.draft}`}>
                          {b.status}
                        </span>
                        {canRetry && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRetry(b.id); }}
                            disabled={retrying === b.id}
                            className="px-2 py-1 text-xs rounded border border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-50 flex items-center gap-1"
                          >
                            <RefreshCw className={`h-3 w-3 ${retrying === b.id ? 'animate-spin' : ''}`} />
                            Retry
                          </button>
                        )}
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-4 space-y-4">
                        {/* Delivery counts */}
                        <div className="grid grid-cols-4 gap-3 text-center">
                          {[
                            { label: 'Sent',      value: b.sent_count,      color: 'text-gray-900' },
                            { label: 'Delivered', value: b.delivered_count, color: 'text-green-600' },
                            { label: 'Read',      value: b.read_count,      color: 'text-blue-600' },
                            { label: 'Failed',    value: b.failed_count,    color: 'text-red-600' },
                          ].map((s) => (
                            <div key={s.label} className="bg-gray-50 rounded p-3">
                              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                              <div className="text-xs text-gray-500">{s.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Rate bars */}
                        {stats && (
                          <div className="space-y-2">
                            {[
                              { label: 'Delivery rate', value: stats.delivery_rate, color: 'bg-green-500' },
                              { label: 'Read rate',     value: stats.read_rate,     color: 'bg-blue-500' },
                              { label: 'Failure rate',  value: stats.failure_rate,  color: 'bg-red-500' },
                            ].map((r) => (
                              <div key={r.label}>
                                <div className="flex justify-between text-xs text-gray-600 mb-1">
                                  <span>{r.label}</span>
                                  <span>{(r.value * 100).toFixed(1)}%</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className={`h-full ${r.color} rounded-full`} style={{ width: `${Math.min(100, r.value * 100)}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Message preview */}
                        {b.body && (
                          <div className="p-3 bg-gray-50 rounded text-sm text-gray-700 whitespace-pre-wrap border border-gray-100">
                            {b.body}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
