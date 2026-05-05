import React from 'react';
import { TrendingUp, FileText, Megaphone, MessageCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRetention } from '../../hooks/useRetention';
import StreakTracker from './StreakTracker';

/**
 * WeeklySummary — motivational weekly overview.
 *
 * Shows this week's activity with positive framing.
 * Designed for Command Center or Dashboard.
 */

export default function WeeklySummary() {
  const { weeklyStats, streak } = useRetention();
  const total = weeklyStats.contentCreated + weeklyStats.campaignsLaunched + weeklyStats.engagementActions;

  // Don't show if no activity at all
  if (total === 0 && streak.current === 0) return null;

  // Motivational message based on activity
  const getMessage = () => {
    if (total >= 10) return 'Incredible productivity this week!';
    if (total >= 5) return 'Great momentum — keep it going!';
    if (total >= 1) return 'You\'re making progress. Every action counts.';
    if (streak.current > 0) return 'Your streak is alive. Do one thing today to keep it going.';
    return 'Start your week with one piece of content.';
  };

  const stats = [
    { label: 'Content', value: weeklyStats.contentCreated, icon: FileText, color: 'text-violet-600', href: '/content/blog' },
    { label: 'Campaigns', value: weeklyStats.campaignsLaunched, icon: Megaphone, color: 'text-emerald-600', href: '/campaigns' },
    { label: 'Engagement', value: weeklyStats.engagementActions, icon: MessageCircle, color: 'text-amber-600', href: '/command-center/engagement' },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">This week</span>
        </div>
        <StreakTracker streak={streak} size="sm" />
      </div>

      {/* Message */}
      <div className="px-4 py-3">
        <p className="text-sm text-gray-600">{getMessage()}</p>
      </div>

      {/* Stats grid */}
      <div className="px-4 pb-4 grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="flex flex-col items-center p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors group"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-1`} />
            <span className="text-lg font-bold text-gray-900">{stat.value}</span>
            <span className="text-xs text-gray-500">{stat.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}


