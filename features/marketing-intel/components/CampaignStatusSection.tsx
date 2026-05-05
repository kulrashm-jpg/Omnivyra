import Link from 'next/link';
import { SectionCard } from '@/features/marketing-intel/components/SectionCard';
import { scoreColour } from '@/features/marketing-intel/hooks/viewModel.helpers';
import {
  STATUS_CFG,
  ACTION_CFG,
  STABILITY_CFG,
  GOAL_LABELS,
} from '@/components/MarketingIntelView';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function CampaignStatusSection({ d }: Props) {
  const campaigns = d.snapshot?.campaign_status ?? [];

  if (campaigns.length === 0) {
    return (
      <SectionCard sectionKey="campaign_status" title="Campaign Status">
        <p className="text-sm text-gray-400">No campaigns found.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard sectionKey="campaign_status" title="Campaign Status" badge={`${campaigns.length}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] font-bold uppercase tracking-widest text-gray-400">
              <th className="pb-2 text-left font-normal">Campaign</th>
              <th className="pb-2 text-left font-normal">Goal</th>
              <th className="pb-2 text-center font-normal">Score</th>
              <th className="pb-2 text-center font-normal">Status</th>
              <th className="pb-2 text-center font-normal">Action</th>
              <th className="pb-2 text-center font-normal">Stability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {campaigns.map((c) => {
              const statusCfg = c.evaluation_status ? STATUS_CFG[c.evaluation_status] : null;
              const actionCfg = c.recommended_action ? ACTION_CFG[c.recommended_action] : null;
              const stabilCfg = c.stability_signal   ? STABILITY_CFG[c.stability_signal] : null;
              const ActionIcon = actionCfg?.icon;

              return (
                <tr key={c.id}>
                  <td className="py-2.5 pr-4">
                    <Link href={`/recommendations?campaign=${c.id}`} className="font-medium text-gray-800 hover:text-[#0A66C2] transition-colors line-clamp-1">
                      {c.name}
                    </Link>
                    {c.topic_seed && <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{c.topic_seed}</p>}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500">
                    {c.goal_type ? (GOAL_LABELS[c.goal_type] ?? c.goal_type) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    {c.evaluation_score != null
                      ? <span className={`font-bold ${scoreColour(c.evaluation_score)}`}>{c.evaluation_score}</span>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    {statusCfg
                      ? <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCfg.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`}/>{statusCfg.label}</span>
                      : <span className="text-gray-300 text-[10px]">No data</span>
                    }
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    {actionCfg && ActionIcon
                      ? <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${actionCfg.bg} ${actionCfg.colour}`}><ActionIcon className="h-3 w-3"/>{actionCfg.label}</span>
                      : <span className="text-gray-300 text-[10px]">—</span>
                    }
                  </td>
                  <td className="py-2.5 text-center">
                    {stabilCfg
                      ? <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${stabilCfg.text}`}><span className={`h-1.5 w-1.5 rounded-full ${stabilCfg.dot}`}/>{stabilCfg.label}</span>
                      : <span className="text-gray-300 text-[10px]">—</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
