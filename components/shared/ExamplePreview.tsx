import React from 'react';
import { BarChart3, FileText, Megaphone, MessageSquare, TrendingUp } from 'lucide-react';

type Variant = 'blog' | 'campaign' | 'engagement' | 'insight';

const PREVIEWS: Record<
  Variant,
  {
    eyebrow: string;
    title: string;
    description: string;
    points: string[];
    icon: React.ElementType;
    accent: string;
  }
> = {
  blog: {
    eyebrow: 'Example output',
    title: '10 Best CRM Tools for Startups in 2026',
    description: 'A strong first piece shows a clear search topic, a useful angle, and a publish-ready structure.',
    points: ['SEO-ready title', '3 supporting sections', 'Clear CTA to book a demo'],
    icon: FileText,
    accent: 'from-sky-50 to-cyan-50',
  },
  campaign: {
    eyebrow: 'Example campaign',
    title: 'Launch your product across LinkedIn + Email in 3 steps',
    description: 'A good first campaign makes the next move obvious and shows how channels work together.',
    points: ['Week 1 launch post', 'Email follow-up', '3 repurposed content assets'],
    icon: Megaphone,
    accent: 'from-indigo-50 to-sky-50',
  },
  engagement: {
    eyebrow: 'Example outcome',
    title: 'You could capture 23 new leads this week',
    description: 'Your first interaction flow should show who reached out, where they came from, and what to do next.',
    points: ['3 recent signups', '1 high-intent lead', 'Suggested next response'],
    icon: MessageSquare,
    accent: 'from-emerald-50 to-teal-50',
  },
  insight: {
    eyebrow: 'Example insight',
    title: 'LinkedIn posts are driving more qualified attention this week',
    description: 'A meaningful first dashboard should surface one clear opportunity instead of a wall of charts.',
    points: ['Highest-engagement channel', 'Content recommendation', 'Next action to take today'],
    icon: BarChart3,
    accent: 'from-amber-50 to-orange-50',
  },
};

export default function ExamplePreview({ variant }: { variant: Variant }) {
  const preview = PREVIEWS[variant];
  const Icon = preview.icon;

  return (
    <div className={`rounded-2xl border border-slate-200 bg-gradient-to-br ${preview.accent} p-4`}>
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-white p-2 text-sky-600 shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{preview.eyebrow}</p>
          <h4 className="mt-1 text-sm font-semibold text-slate-900">{preview.title}</h4>
          <p className="mt-1 text-sm text-slate-600">{preview.description}</p>
          <ul className="mt-3 space-y-1.5">
            {preview.points.map((point) => (
              <li key={point} className="flex items-center gap-2 text-sm text-slate-700">
                <TrendingUp className="h-3.5 w-3.5 text-sky-600" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
