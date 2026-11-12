import React, { useState } from 'react';
import { useActivationRetry } from './activationRetryStore';

/**
 * "Retry status update" for a campaign whose posts were scheduled but whose status update failed.
 * Runs ONLY the activation (retry-activation route), never a re-schedule. Renders nothing otherwise.
 */
export function ActivationRetryNotice({ campaignId }: { campaignId?: string }) {
  const retry = useActivationRetry(campaignId);
  const [busy, setBusy] = useState(false);
  if (!retry) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        type="button"
        className="rounded border border-red-300 bg-white px-3 py-1 text-red-800 hover:bg-red-50 disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await retry(); } finally { setBusy(false); }
        }}
      >
        {busy ? 'Updating status…' : 'Retry status update'}
      </button>
      <span className="text-gray-600">This only updates the campaign status. It does not schedule anything again.</span>
    </div>
  );
}
