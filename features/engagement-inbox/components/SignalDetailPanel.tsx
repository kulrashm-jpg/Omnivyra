import { ExternalLink } from 'lucide-react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import type { CampaignSignal } from '../types';
import { SIGNAL_STATUSES } from '../constants';
import { formatDateTime, formatScorePercent } from '../utils';

export interface SignalDetailPanelProps {
  signal: CampaignSignal;
  onStatusChange: (signalId: string, status: string) => void;
}

export default function SignalDetailPanel({ signal, onStatusChange }: SignalDetailPanelProps) {
  return (
    <>
      <div>
        <div className="text-xs text-gray-500 mb-1">Author</div>
        <div className="text-sm font-medium text-gray-900">
          {signal.author || 'Anonymous'}
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-1">Content</div>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">
          {signal.content || '—'}
        </p>
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-1">Platform · Type · Score</div>
        <div className="flex items-center gap-2 text-sm">
          <PlatformIcon platform={signal.platform} size={14} showLabel />
          <span className="capitalize">{signal.signal_type.replace('_', ' ')}</span>
          <span>{formatScorePercent(signal.engagement_score)}</span>
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-1">Date</div>
        <div className="text-sm text-gray-700">
          {formatDateTime(signal.detected_at)}
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-1">Status</div>
        <select
          value={signal.signal_status || 'new'}
          onChange={(e) => onStatusChange(signal.id, e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {SIGNAL_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {signal.conversation_url && (
        <a
          href={signal.conversation_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          View thread
        </a>
      )}
      <div className="text-xs text-gray-500 pt-2">
        Linked activity: {signal.activity_id}
      </div>
    </>
  );
}
