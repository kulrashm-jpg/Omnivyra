import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const SECTIONS = [
  { key: 'system_snapshot',        label: 'System Snapshot'        },
  { key: 'next_actions',           label: 'Next Actions'           },
  { key: 'campaign_status',        label: 'Campaign Status'        },
  { key: 'content_performance',    label: 'Content Performance'    },
  { key: 'strategic_intelligence', label: 'Strategic Intelligence' },
  { key: 'campaign_dna',           label: 'Campaign DNA'           },
  { key: 'audience_response',      label: 'Audience Response'      },
  { key: 'strategic_memory',       label: 'Strategic Memory'       },
] as const;

export type SectionKey = typeof SECTIONS[number]['key'];

export const SECTION_DESCRIPTION: Record<SectionKey, string> = {
  system_snapshot:        'Overall health and current direction of your marketing activity',
  next_actions:           'Recommended steps based on recent performance and strategic signals',
  campaign_status:        'Current state of all campaigns and their performance',
  content_performance:    'Top and bottom performing campaigns based on outcomes',
  strategic_intelligence: 'Patterns and momentum derived from campaign performance',
  campaign_dna:           'How your campaigns are structured and what consistently works',
  audience_response:      'How your audience is reacting across key performance metrics',
  strategic_memory:       'What your system has learned over time from past decisions',
};

export interface SectionCardProps {
  sectionKey?: SectionKey;
  title: string;
  badge?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function SectionCard({ sectionKey, title, badge, children, footer, className = '' }: SectionCardProps) {
  const description = sectionKey ? SECTION_DESCRIPTION[sectionKey] : undefined;
  return (
    <div className={`rounded-2xl border border-gray-100/80 bg-white shadow-sm ${className}`}>
      <div className="px-6 py-4 border-b border-gray-100/80">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</p>
          {badge && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{badge}</span>}
        </div>
        {description && <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
      {footer && <div className="px-6 pb-5 pt-0">{footer}</div>}
    </div>
  );
}

export function SectionCta({ href, label, variant = 'default' }: { href: string; label: string; variant?: 'default' | 'primary' | 'critical' | 'secondary' }) {
  const classes =
    variant === 'critical'
      ? 'border-transparent bg-[#DC2626] text-white hover:bg-[#B91C1C] hover:border-transparent shadow-sm'
      : variant === 'secondary'
        ? 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
      : variant === 'primary'
        ? 'border-amber-500 bg-transparent text-amber-700 hover:bg-amber-50 hover:border-amber-600'
        : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-[#0A66C2] hover:border-[#0A66C2] hover:text-white';
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-[8px] border px-4 py-2 text-xs font-semibold tracking-[0.2px] transition-all duration-150 ease-out hover:-translate-y-[1px] ${classes}`}
    >
      {label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}
