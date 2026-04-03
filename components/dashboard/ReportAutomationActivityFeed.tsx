import { useEffect, useState } from 'react';
import { getAuthToken } from '@/utils/getAuthToken';
import { Bell, RefreshCw, TrendingDown, TrendingUp, Lightbulb } from 'lucide-react';

type AutomationEvent = {
  id: string;
  type: 'scheduled' | 'content_change' | 'traffic_change';
  domain: string;
  triggered_at: string;
  report_id: string | null;
  details?: Record<string, unknown>;
};

type NotificationEvent = {
  id: string;
  type: 'improvement' | 'decline' | 'opportunity';
  domain: string;
  message: string;
  linked_report_id: string | null;
  created_at: string;
};

function timeAgo(iso: string): string {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (deltaSeconds < 60) return 'just now';
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

function notifIcon(type: NotificationEvent['type']) {
  if (type === 'improvement') return <TrendingUp className="h-4 w-4 text-emerald-600" />;
  if (type === 'decline') return <TrendingDown className="h-4 w-4 text-red-600" />;
  return <Lightbulb className="h-4 w-4 text-amber-600" />;
}

export default function ReportAutomationActivityFeed({ companyId }: { companyId: string | null }) {
  const [loading, setLoading] = useState(false);
  const [automationEvents, setAutomationEvents] = useState<AutomationEvent[]>([]);
  const [notificationEvents, setNotificationEvents] = useState<NotificationEvent[]>([]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const token = await getAuthToken();
        if (!token) return;
        const response = await fetch(`/api/reports/automation-activity?company_id=${encodeURIComponent(companyId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const json = await response.json();
        if (cancelled) return;
        setAutomationEvents(Array.isArray(json.automationEvents) ? json.automationEvents : []);
        setNotificationEvents(Array.isArray(json.notificationEvents) ? json.notificationEvents : []);
      } catch {
        // non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [companyId]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-semibold text-gray-900">Snapshot Automation Activity</h3>
        </div>
        <div className="text-xs text-gray-500">Live feed</div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Latest Automation Triggers</p>
          {loading ? (
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading automation events...
            </div>
          ) : automationEvents.length === 0 ? (
            <p className="text-sm text-gray-500">No automation events yet.</p>
          ) : (
            <ul className="space-y-3">
              {automationEvents.slice(0, 5).map((item) => (
                <li key={item.id} className="rounded-lg border border-gray-100 px-3 py-2 bg-gray-50">
                  <p className="text-sm text-gray-900">
                    <span className="font-medium">{item.domain}</span> triggered by{' '}
                    <span className="capitalize">{item.type.replace('_', ' ')}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{timeAgo(item.triggered_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Latest Snapshot Alerts</p>
          {loading ? (
            <div className="text-sm text-gray-500 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading alert feed...
            </div>
          ) : notificationEvents.length === 0 ? (
            <p className="text-sm text-gray-500">No report alerts yet.</p>
          ) : (
            <ul className="space-y-3">
              {notificationEvents.slice(0, 5).map((item) => (
                <li key={item.id} className="rounded-lg border border-gray-100 px-3 py-2 bg-gray-50">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">{notifIcon(item.type)}</div>
                    <div>
                      <p className="text-sm text-gray-900">{item.message}</p>
                      <p className="text-xs text-gray-500 mt-1">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
