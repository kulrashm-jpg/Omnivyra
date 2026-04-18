import React from 'react';
import { FileText, Megaphone, MessageCircle, CheckCircle2 } from 'lucide-react';
import { useRetention } from '../../hooks/useRetention';
import StreakTracker from './StreakTracker';

/**
 * UserProgress — dashboard-ready progress overview.
 *
 * Shows: daily task progress, streak, weekly stats.
 * Designed for Command Center or Dashboard sidebar.
 */

export default function UserProgress() {
  const { streak, dailyTasks, tasksCompleted, tasksTotal, weeklyStats, allTasksDone } = useRetention();

  const hasActivity = weeklyStats.contentCreated > 0 || weeklyStats.campaignsLaunched > 0 || weeklyStats.engagementActions > 0;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header: Today's progress */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Today&apos;s progress</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {allTasksDone ? 'All done — great work!' : `${tasksCompleted}/${tasksTotal} tasks completed`}
          </p>
        </div>
        <StreakTracker streak={streak} size="sm" />
      </div>

      {/* Daily tasks */}
      <div className="px-4 py-3 space-y-2">
        {dailyTasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2.5">
            {task.completed ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0" />
            )}
            <span className={`text-sm ${task.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
              {task.label}
            </span>
          </div>
        ))}

        {/* Progress bar */}
        <div className="pt-1">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                allTasksDone ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${tasksTotal > 0 ? (tasksCompleted / tasksTotal) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Weekly stats (compact) */}
      {hasActivity && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">This week</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-violet-500" />
              <span className="text-xs font-semibold text-gray-700">{weeklyStats.contentCreated}</span>
              <span className="text-xs text-gray-400">content</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Megaphone className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs font-semibold text-gray-700">{weeklyStats.campaignsLaunched}</span>
              <span className="text-xs text-gray-400">campaigns</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-gray-700">{weeklyStats.engagementActions}</span>
              <span className="text-xs text-gray-400">engaged</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
