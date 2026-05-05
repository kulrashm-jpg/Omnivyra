import { Zap } from 'lucide-react';

export interface SourceBadgeProps {
  source: string;
  isBoosted: boolean;
}

export default function SourceBadge({ source, isBoosted }: SourceBadgeProps) {
  if (isBoosted) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">
      <Zap className="h-2.5 w-2.5" /> Boosted
    </span>
  );
  if (source === 'override') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
      Override
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">
      Global
    </span>
  );
}
