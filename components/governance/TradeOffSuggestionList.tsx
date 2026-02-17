/**
 * Trade-Off Suggestions — Stage 10 Phase 5.
 * Display-only list of trade-off options when present in campaign-status.
 */

import React from 'react';
import { Lightbulb } from 'lucide-react';

export interface TradeOffOption {
  type: string;
  [key: string]: unknown;
}

interface TradeOffSuggestionListProps {
  options: TradeOffOption[];
}

function formatOption(opt: TradeOffOption): string {
  switch (opt.type) {
    case 'SHIFT_START_DATE': {
      const date = opt.newStartDate as string | undefined;
      return date ? `Shift start date to: ${new Date(date).toLocaleDateString()}` : 'Shift start date';
    }
    case 'REDUCE_FREQUENCY': {
      const x = opt.postsPerWeek as number | undefined;
      return x != null ? `Reduce to ${x} posts/week` : 'Reduce post frequency';
    }
    case 'EXTEND_DURATION': {
      const x = opt.weeks as number | undefined;
      return x != null ? `Adjust duration to ${x} weeks` : 'Adjust duration';
    }
    case 'INCREASE_CAPACITY': {
      const x = opt.postsPerWeek as number | undefined;
      return x != null ? `Increase capacity by ${x} posts/week` : 'Increase capacity';
    }
    case 'PREEMPT_LOWER_PRIORITY_CAMPAIGN': {
      const id = opt.targetCampaignId as string | undefined;
      return id ? `Preempt campaign ${id}` : 'Preempt lower-priority campaign';
    }
    case 'ADJUST_CONTENT_MIX':
      return opt.reasoning as string ?? 'Adjust weekly content mix to match available asset types.';
    case 'ADJUST_CONTENT_SELECTION':
      return opt.reasoning as string ?? 'Select different content assets for this campaign.';
    default:
      return opt.type.replace(/_/g, ' ');
  }
}

export function TradeOffSuggestionList({ options }: TradeOffSuggestionListProps) {
  if (!options || options.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border">
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h2 className="text-xl font-semibold">Trade-Off Suggestions</h2>
      </div>
      <ul className="space-y-2 text-sm text-gray-700">
        {options.map((opt, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="text-amber-500 mt-0.5">•</span>
            <span>{formatOption(opt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
