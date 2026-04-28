import React from 'react';
import { CheckCircle, Plus, Sparkles } from 'lucide-react';
import type { WeeklyPlan, DailyPlan, PlatformStrategy, CampaignStrategy } from '../../hooks/useComprehensivePlan';

// ── Overview Tab ──────────────────────────────────────────────────────────────

interface OverviewTabProps {
  campaignStrategy: CampaignStrategy;
  platformStrategies: PlatformStrategy[];
  onStrategyChange: (updates: Partial<CampaignStrategy>) => void;
  onOpenAIModal: () => void;
}

export const OverviewTab = React.memo(function OverviewTab({
  campaignStrategy,
  platformStrategies,
  onStrategyChange,
  onOpenAIModal,
}: OverviewTabProps) {
  return (
    <div className="space-y-8">
      <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm rounded-lg p-4">
        Planning boundary: Virality produces plans, signals, and priorities only. Community-AI
        executes via playbooks; credentials, APIs, and automation logic do not flow upstream.
      </div>

      {/* Campaign Overview */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Campaign Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Objective</label>
            <textarea
              value={campaignStrategy.objective}
              onChange={(e) => onStrategyChange({ objective: e.target.value })}
              className="w-full p-3 border rounded-lg"
              rows={3}
              placeholder="Build brand awareness and audience engagement for Omnivyra using existing content catalog"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Target Audience</label>
            <textarea
              value={campaignStrategy.targetAudience}
              onChange={(e) => onStrategyChange({ targetAudience: e.target.value })}
              className="w-full p-3 border rounded-lg"
              rows={3}
              placeholder="Music lovers, indie music fans, playlist curators, emerging artists"
            />
          </div>
        </div>
      </div>

      {/* Content Pillars */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Content Pillars</h3>
          <button
            onClick={onOpenAIModal}
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            AI Generate
          </button>
        </div>
        <div className="space-y-4">
          {campaignStrategy.contentPillars.map((pillar) => (
            <div key={pillar.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">{pillar.name}</h4>
                <span className="text-sm text-gray-500">{pillar.percentage}%</span>
              </div>
              <p className="text-sm text-gray-600 mb-2">{pillar.description}</p>
              <div className="flex flex-wrap gap-2">
                {pillar.contentTypes.map(type => (
                  <span key={type} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                    {type}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Platform Strategy */}
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Platform Strategy</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {platformStrategies.map((strategy) => (
            <div key={strategy.platform} className="border rounded-lg p-4">
              <h4 className="font-medium capitalize mb-2">{strategy.platform}</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Posts/week:</span>
                  <span>{strategy.contentFrequency.posts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Stories/week:</span>
                  <span>{strategy.contentFrequency.stories}</span>
                </div>
                <div className="flex justify-between">
                  <span>Target Impressions:</span>
                  <span>{strategy.targetMetrics.impressions.toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ── Weekly Tab ────────────────────────────────────────────────────────────────

interface WeeklyTabProps {
  weeklyPlans: WeeklyPlan[];
  selectedWeek: number | null;
  onSelectWeek: (week: number | null) => void;
  onGenerateWeeklyPlan: (weekNumber: number) => void;
  onUpdateWeeklyPlan: (weekNumber: number, updates: Partial<WeeklyPlan>) => void;
}

export const WeeklyTab = React.memo(function WeeklyTab({
  weeklyPlans,
  selectedWeek,
  onSelectWeek,
  onGenerateWeeklyPlan,
  onUpdateWeeklyPlan,
}: WeeklyTabProps) {
  const weekCount = weeklyPlans.length || 12;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Content Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: weekCount }, (_, i) => i + 1).map(weekNumber => {
            const weekPlan = weeklyPlans.find(w => w.weekNumber === weekNumber);
            return (
              <div
                key={weekNumber}
                className={`border rounded-lg p-4 cursor-pointer transition-all ${
                  selectedWeek === weekNumber ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300'
                }`}
                onClick={() => onSelectWeek(selectedWeek === weekNumber ? null : weekNumber)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Week {weekNumber}</h4>
                  {weekPlan ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <Plus className="h-5 w-5 text-gray-400" />
                  )}
                </div>
                {weekPlan ? (
                  <div>
                    <p className="text-sm font-medium text-gray-900">{weekPlan.theme}</p>
                    <p className="text-xs text-gray-600">{weekPlan.focusArea}</p>
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${weekPlan.completionPercentage}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{weekPlan.completionPercentage}% Complete</p>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onGenerateWeeklyPlan(weekNumber); }}
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Sparkles className="h-3 w-3" />
                    Generate Plan
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selectedWeek && (() => {
        const weekPlan = weeklyPlans.find(w => w.weekNumber === selectedWeek);
        return (
          <div className="bg-white rounded-xl p-6 shadow-sm border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Week {selectedWeek} Details</h3>
              <button
                onClick={() => onGenerateWeeklyPlan(selectedWeek)}
                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                AI Enhance
              </button>
            </div>
            {!weekPlan ? (
              <p className="text-gray-500">No plan generated yet</p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
                    <input
                      type="text"
                      value={weekPlan.theme}
                      onChange={(e) => onUpdateWeeklyPlan(selectedWeek, { theme: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phase</label>
                    <select
                      value={weekPlan.phase}
                      onChange={(e) => onUpdateWeeklyPlan(selectedWeek, { phase: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="Foundation">Foundation & Discovery</option>
                      <option value="Growth">Growth & Momentum</option>
                      <option value="Consolidation">Consolidation & Amplification</option>
                      <option value="Sustain">Sustain & Scale</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Focus Area</label>
                  <textarea
                    value={weekPlan.focusArea}
                    onChange={(e) => onUpdateWeeklyPlan(selectedWeek, { focusArea: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Key Messaging</label>
                  <textarea
                    value={weekPlan.keyMessaging}
                    onChange={(e) => onUpdateWeeklyPlan(selectedWeek, { keyMessaging: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Target Metrics</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {(['impressions', 'engagements', 'conversions', 'ugcSubmissions'] as const).map((key) => (
                      <div key={key}>
                        <label className="block text-xs text-gray-500 mb-1 capitalize">
                          {key === 'ugcSubmissions' ? 'UGC Submissions' : key.charAt(0).toUpperCase() + key.slice(1)}
                        </label>
                        <input
                          type="number"
                          value={weekPlan.targetMetrics[key]}
                          onChange={(e) =>
                            onUpdateWeeklyPlan(selectedWeek, {
                              targetMetrics: { ...weekPlan.targetMetrics, [key]: parseInt(e.target.value) },
                            })
                          }
                          className="w-full p-2 border rounded"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
});

// ── Daily Tab ─────────────────────────────────────────────────────────────────

interface DailyTabProps {
  dailyPlans: DailyPlan[];
  selectedWeek: number | null;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  onGenerateAllDays: (weekNumber: number) => void;
  onUpdateDailyPlan: (id: string, updates: Partial<DailyPlan>) => void;
}

export const DailyTab = React.memo(function DailyTab({
  dailyPlans,
  selectedWeek,
  selectedDay,
  onSelectDay,
  onGenerateAllDays,
  onUpdateDailyPlan,
}: DailyTabProps) {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Daily Content Planning</h3>
        {selectedWeek ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-medium">Week {selectedWeek} - Daily Breakdown</h4>
              <button
                onClick={() => onGenerateAllDays(selectedWeek)}
                className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Generate All Days
              </button>
            </div>
            <div className="grid grid-cols-7 gap-4">
              {DAYS.map(day => {
                const dayPlan = dailyPlans.find(d => d.weekNumber === selectedWeek && d.dayOfWeek === day);
                return (
                  <div
                    key={day}
                    className={`border rounded-lg p-3 cursor-pointer transition-all ${
                      selectedDay === day ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300'
                    }`}
                    onClick={() => onSelectDay(selectedDay === day ? null : day)}
                  >
                    <h5 className="font-medium text-sm mb-2">{day}</h5>
                    {dayPlan ? (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-600">{dayPlan.platform}</p>
                        <p className="text-xs text-gray-600">{dayPlan.contentType}</p>
                        <div className="w-full bg-gray-200 rounded-full h-1">
                          <div className="bg-green-500 h-1 rounded-full w-full" />
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); onGenerateAllDays(selectedWeek); }}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                      >
                        <Plus className="h-3 w-3" />
                        Plan
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">Select a week to view daily planning</p>
        )}
      </div>

      {selectedDay && selectedWeek && (() => {
        const dayPlan = dailyPlans.find(d => d.weekNumber === selectedWeek && d.dayOfWeek === selectedDay);
        return (
          <div className="bg-white rounded-xl p-6 shadow-sm border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Week {selectedWeek} - {selectedDay}</h3>
              <button
                onClick={() => onGenerateAllDays(selectedWeek)}
                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                AI Enhance
              </button>
            </div>
            {!dayPlan ? (
              <p className="text-gray-500">No plan generated yet</p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
                    <select
                      value={dayPlan.platform}
                      onChange={(e) => onUpdateDailyPlan(dayPlan.id, { platform: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    >
                      {['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin'].map(p => (
                        <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}{p === 'twitter' ? '/X' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                    <select
                      value={dayPlan.contentType}
                      onChange={(e) => onUpdateDailyPlan(dayPlan.id, { contentType: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    >
                      {['post', 'story', 'reel', 'video', 'tweet', 'thread'].map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                  <input
                    type="text"
                    value={dayPlan.title}
                    onChange={(e) => onUpdateDailyPlan(dayPlan.id, { title: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    placeholder="Engaging title for your content"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
                  <textarea
                    value={dayPlan.content}
                    onChange={(e) => onUpdateDailyPlan(dayPlan.id, { content: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    rows={4}
                    placeholder="Write your content here..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Hashtags</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {dayPlan.hashtags.map((hashtag, index) => (
                      <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">
                        #{hashtag}
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Add hashtags (comma separated)"
                    className="w-full p-3 border rounded-lg"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        const input = e.target as HTMLInputElement;
                        const newHashtags = input.value.split(',').map(tag => tag.trim()).filter(tag => tag);
                        onUpdateDailyPlan(dayPlan.id, { hashtags: [...dayPlan.hashtags, ...newHashtags] });
                        input.value = '';
                      }
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Optimal Posting Time</label>
                    <input
                      type="time"
                      value={dayPlan.optimalPostingTime}
                      onChange={(e) => onUpdateDailyPlan(dayPlan.id, { optimalPostingTime: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                    <select
                      value={dayPlan.priority}
                      onChange={(e) => onUpdateDailyPlan(dayPlan.id, { priority: e.target.value as DailyPlan['priority'] })}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                    <select
                      value={dayPlan.status}
                      onChange={(e) => onUpdateDailyPlan(dayPlan.id, { status: e.target.value as DailyPlan['status'] })}
                      className="w-full p-3 border rounded-lg"
                    >
                      <option value="planned">Planned</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="published">Published</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
});

// ── Metrics Tab ───────────────────────────────────────────────────────────────

interface MetricsTabProps {
  campaignStrategy: CampaignStrategy;
  weeklyPlans: WeeklyPlan[];
}

export const MetricsTab = React.memo(function MetricsTab({ campaignStrategy, weeklyPlans }: MetricsTabProps) {
  const goals = campaignStrategy.overallGoals;
  const goalItems = [
    { label: 'Total Impressions', value: goals.totalImpressions, color: 'text-blue-600' },
    { label: 'Total Engagements', value: goals.totalEngagements, color: 'text-green-600' },
    { label: 'Follower Growth', value: goals.followerGrowth, color: 'text-purple-600' },
    { label: 'UGC Submissions', value: goals.ugcSubmissions, color: 'text-orange-600' },
    { label: 'Playlist Adds', value: goals.playlistAdds, color: 'text-red-600' },
    { label: 'Website Traffic', value: goals.websiteTraffic, color: 'text-indigo-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Campaign Goals & KPIs</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {goalItems.map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <div className={`text-3xl font-bold ${color} mb-2`}>{value.toLocaleString()}</div>
              <div className="text-sm text-gray-600">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Weekly Progress</h3>
        <div className="space-y-4">
          {weeklyPlans.map(week => (
            <div key={week.weekNumber} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">Week {week.weekNumber} - {week.theme}</h4>
                <span className="text-sm text-gray-500">{week.completionPercentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${week.completionPercentage}%` }}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {(['impressions', 'engagements', 'conversions', 'ugcSubmissions'] as const).map(key => (
                  <div key={key}>
                    <span className="text-gray-500 capitalize">{key === 'ugcSubmissions' ? 'UGC' : key}:</span>
                    <span className="ml-2 font-medium">{week.targetMetrics[key].toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
