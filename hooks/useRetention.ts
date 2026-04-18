import { useState, useEffect, useMemo, useCallback } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyTask {
  id: string;
  label: string;
  completed: boolean;
}

export interface WeeklyStats {
  contentCreated: number;
  campaignsLaunched: number;
  engagementActions: number;
  creditsUsed: number;
}

export interface StreakData {
  current: number;
  longest: number;
  lastActiveDate: string;   // YYYY-MM-DD
  milestone: number | null;  // 3, 7, 14, 30 — if just hit one
}

export interface RewardEvent {
  id: string;
  message: string;
  type: 'milestone' | 'first' | 'streak';
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// LocalStorage persistence
// ─────────────────────────────────────────────────────────────────────────────

const STREAK_KEY = 'omnivyra_streak';
const TASKS_KEY = 'omnivyra_daily_tasks';
const REWARDS_KEY = 'omnivyra_rewards_seen';
const WEEKLY_KEY = 'omnivyra_weekly_stats';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function startOfWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Streak logic
// ─────────────────────────────────────────────────────────────────────────────

const MILESTONES = [3, 7, 14, 30, 60, 100];

function loadStreak(): StreakData {
  const stored = loadJSON<StreakData>(STREAK_KEY, {
    current: 0,
    longest: 0,
    lastActiveDate: '',
    milestone: null,
  });

  const todayStr = today();
  const yesterdayStr = yesterday();

  // Already active today — no changes
  if (stored.lastActiveDate === todayStr) {
    return { ...stored, milestone: null };
  }

  // Active yesterday — streak continues (will be incremented when user acts)
  if (stored.lastActiveDate === yesterdayStr) {
    return { ...stored, milestone: null };
  }

  // Inactive > 1 day — streak resets
  if (stored.lastActiveDate && stored.lastActiveDate < yesterdayStr) {
    return {
      current: 0,
      longest: stored.longest,
      lastActiveDate: stored.lastActiveDate,
      milestone: null,
    };
  }

  return { ...stored, milestone: null };
}

function incrementStreak(streak: StreakData): StreakData {
  const todayStr = today();
  if (streak.lastActiveDate === todayStr) return streak; // already counted today

  const newCurrent = streak.current + 1;
  const newLongest = Math.max(newCurrent, streak.longest);
  const milestone = MILESTONES.includes(newCurrent) ? newCurrent : null;

  const updated: StreakData = {
    current: newCurrent,
    longest: newLongest,
    lastActiveDate: todayStr,
    milestone,
  };

  saveJSON(STREAK_KEY, updated);
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily tasks logic
// ─────────────────────────────────────────────────────────────────────────────

interface StoredTasks {
  date: string;
  tasks: DailyTask[];
}

const DEFAULT_TASKS: DailyTask[] = [
  { id: 'create-content', label: 'Create or edit a piece of content', completed: false },
  { id: 'review-engagement', label: 'Check engagement or leads', completed: false },
  { id: 'plan-campaign', label: 'Plan or launch a campaign', completed: false },
];

function loadDailyTasks(): DailyTask[] {
  const todayStr = today();
  const stored = loadJSON<StoredTasks>(TASKS_KEY, { date: '', tasks: [] });

  // If stored is from today, use it
  if (stored.date === todayStr) return stored.tasks;

  // Reset for new day
  const fresh = DEFAULT_TASKS.map((t) => ({ ...t, completed: false }));
  saveJSON(TASKS_KEY, { date: todayStr, tasks: fresh });
  return fresh;
}

function saveDailyTasks(tasks: DailyTask[]) {
  saveJSON(TASKS_KEY, { date: today(), tasks });
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly stats logic
// ─────────────────────────────────────────────────────────────────────────────

interface StoredWeekly {
  weekStart: string;
  stats: WeeklyStats;
}

function loadWeeklyStats(): WeeklyStats {
  const weekStart = startOfWeek();
  const stored = loadJSON<StoredWeekly>(WEEKLY_KEY, { weekStart: '', stats: { contentCreated: 0, campaignsLaunched: 0, engagementActions: 0, creditsUsed: 0 } });

  if (stored.weekStart === weekStart) return stored.stats;

  // New week — reset
  const fresh: WeeklyStats = { contentCreated: 0, campaignsLaunched: 0, engagementActions: 0, creditsUsed: 0 };
  saveJSON(WEEKLY_KEY, { weekStart, stats: fresh });
  return fresh;
}

function saveWeeklyStats(stats: WeeklyStats) {
  saveJSON(WEEKLY_KEY, { weekStart: startOfWeek(), stats });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rewards (seen tracking)
// ─────────────────────────────────────────────────────────────────────────────

function getSeenRewards(): Set<string> {
  return new Set(loadJSON<string[]>(REWARDS_KEY, []));
}

function markRewardSeen(id: string) {
  const seen = getSeenRewards();
  seen.add(id);
  saveJSON(REWARDS_KEY, [...seen]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useRetention() {
  const { isAuthenticated } = useCompanyContext();

  const [streak, setStreak] = useState<StreakData>({ current: 0, longest: 0, lastActiveDate: '', milestone: null });
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>(DEFAULT_TASKS);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats>({ contentCreated: 0, campaignsLaunched: 0, engagementActions: 0, creditsUsed: 0 });
  const [pendingReward, setPendingReward] = useState<RewardEvent | null>(null);
  const [seenRewards, setSeenRewards] = useState<Set<string>>(new Set());

  // Hydrate on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    setStreak(loadStreak());
    setDailyTasks(loadDailyTasks());
    setWeeklyStats(loadWeeklyStats());
    setSeenRewards(getSeenRewards());
  }, [isAuthenticated]);

  // ── Record action (call from anywhere when user does something meaningful) ──

  const recordAction = useCallback((action: 'content' | 'campaign' | 'engagement') => {
    // 1. Update streak
    setStreak((prev) => {
      const updated = incrementStreak(prev);

      // Check for streak milestone reward
      if (updated.milestone && !getSeenRewards().has(`streak-${updated.milestone}`)) {
        setPendingReward({
          id: `streak-${updated.milestone}`,
          message: updated.milestone >= 14
            ? `${updated.milestone}-day streak — incredible consistency!`
            : updated.milestone >= 7
              ? `${updated.milestone}-day streak — you're on fire!`
              : `${updated.milestone}-day streak — great start!`,
          type: 'streak',
          timestamp: Date.now(),
        });
      }

      return updated;
    });

    // 2. Complete matching daily task
    setDailyTasks((prev) => {
      const taskMap: Record<string, string> = {
        content: 'create-content',
        campaign: 'plan-campaign',
        engagement: 'review-engagement',
      };
      const taskId = taskMap[action];
      const updated = prev.map((t) => t.id === taskId ? { ...t, completed: true } : t);
      saveDailyTasks(updated);
      return updated;
    });

    // 3. Update weekly stats
    setWeeklyStats((prev) => {
      const updated = { ...prev };
      if (action === 'content') updated.contentCreated += 1;
      if (action === 'campaign') updated.campaignsLaunched += 1;
      if (action === 'engagement') updated.engagementActions += 1;
      saveWeeklyStats(updated);

      // Check for first-time rewards
      if (action === 'content' && updated.contentCreated === 1 && !getSeenRewards().has('first-content')) {
        setPendingReward({
          id: 'first-content',
          message: 'You created your first piece of content!',
          type: 'first',
          timestamp: Date.now(),
        });
      }
      if (action === 'campaign' && updated.campaignsLaunched === 1 && !getSeenRewards().has('first-campaign')) {
        setPendingReward({
          id: 'first-campaign',
          message: 'You launched your first campaign!',
          type: 'first',
          timestamp: Date.now(),
        });
      }

      return updated;
    });
  }, []);

  // ── Dismiss reward ──

  const dismissReward = useCallback(() => {
    if (pendingReward) {
      markRewardSeen(pendingReward.id);
      setSeenRewards((prev) => new Set(prev).add(pendingReward.id));
    }
    setPendingReward(null);
  }, [pendingReward]);

  // ── Derived state ──

  const tasksCompleted = dailyTasks.filter((t) => t.completed).length;
  const tasksTotal = dailyTasks.length;
  const allTasksDone = tasksCompleted === tasksTotal;

  return {
    // Streak
    streak,

    // Daily tasks
    dailyTasks,
    tasksCompleted,
    tasksTotal,
    allTasksDone,

    // Weekly
    weeklyStats,

    // Rewards
    pendingReward,
    dismissReward,

    // Action recorder
    recordAction,
  };
}
