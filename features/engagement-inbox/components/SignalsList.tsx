import PlatformIcon from '@/components/ui/PlatformIcon';
import type { CampaignSignal } from '../types';
import { formatDateTime, formatScorePercent } from '../utils';

export interface SignalsListProps {
  signals: CampaignSignal[];
  loading: boolean;
  selectedSignal: CampaignSignal | null;
  onSelect: (sig: CampaignSignal) => void;
}

export default function SignalsList({ signals, loading, selectedSignal, onSelect }: SignalsListProps) {
  return (
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
                onClick={() => onSelect(sig)}
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
                      <span>{formatScorePercent(sig.engagement_score)}</span>
                    </div>
                    <p className="text-sm text-gray-800 line-clamp-2 mt-0.5">{sig.content || '—'}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatDateTime(sig.detected_at)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
