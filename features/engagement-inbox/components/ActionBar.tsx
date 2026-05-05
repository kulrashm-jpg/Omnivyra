import { Bookmark, Send, UserPlus } from 'lucide-react';
import type { ActionNotice, CampaignSignal } from '../types';

export interface ActionBarProps {
  signal: CampaignSignal;
  bookmarkBusy: boolean;
  leadBusy: boolean;
  crmBusy: boolean;
  actionNotice: ActionNotice;
  onBookmark: () => void;
  onMarkAsLead: () => void;
  onExportToCRM: () => void;
}

export default function ActionBar({
  signal,
  bookmarkBusy,
  leadBusy,
  crmBusy,
  actionNotice,
  onBookmark,
  onMarkAsLead,
  onExportToCRM,
}: ActionBarProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="button"
          disabled={bookmarkBusy}
          onClick={onBookmark}
          className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Bookmark className="h-4 w-4" />
          {signal.signal_status === 'reviewed' ? 'Bookmarked' : 'Bookmark'}
        </button>
        <button
          type="button"
          disabled={leadBusy}
          onClick={onMarkAsLead}
          className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <UserPlus className="h-4 w-4" />
          Mark as lead
        </button>
        <button
          type="button"
          disabled={crmBusy}
          onClick={onExportToCRM}
          className="px-3 py-1.5 rounded border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Send className="h-4 w-4" />
          Export to CRM
        </button>
      </div>
      {actionNotice && (
        <p
          className={`text-xs ${
            actionNotice.kind === 'success' ? 'text-green-600' : 'text-red-600'
          }`}
        >
          {actionNotice.text}
        </p>
      )}
    </>
  );
}
