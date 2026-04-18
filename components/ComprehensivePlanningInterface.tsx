import React, { useState } from 'react';
import {
  BarChart3,
  Calendar,
  Clock,
  FileText,
  Loader2,
  Save,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useComprehensivePlan } from '../hooks/useComprehensivePlan';
import {
  OverviewTab,
  WeeklyTab,
  DailyTab,
  MetricsTab,
} from './planner/ComprehensivePlanCanvas';

interface ComprehensivePlanningInterfaceProps {
  campaignId: string;
  campaignData: any;
  onSave: (data: any) => void;
}

type TabId = 'overview' | 'strategy' | 'weekly' | 'daily' | 'metrics' | 'templates';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'weekly', label: 'Weekly Plans', icon: Calendar },
  { id: 'daily', label: 'Daily Plans', icon: Clock },
  { id: 'metrics', label: 'Metrics', icon: TrendingUp },
  { id: 'templates', label: 'Templates', icon: FileText },
];

export default function ComprehensivePlanningInterface({
  campaignId,
  campaignData,
  onSave,
}: ComprehensivePlanningInterfaceProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);

  const {
    isLoading,
    campaignStrategy,
    setCampaignStrategy,
    weeklyPlans,
    setWeeklyPlans,
    dailyPlans,
    setDailyPlans,
    platformStrategies,
    aiProvider,
    setAiProvider,
    handleGenerateContentPillars,
    handleSaveStrategy,
    handleGenerateWeeklyPlan,
    handleGenerateAllDaysForWeek,
  } = useComprehensivePlan(campaignId, campaignData, onSave);

  const handleUpdateWeeklyPlan = (weekNumber: number, updates: any) => {
    setWeeklyPlans((prev) =>
      prev.map((w) => (w.weekNumber === weekNumber ? { ...w, ...updates } : w))
    );
  };

  const handleUpdateDailyPlan = (id: string, updates: any) => {
    setDailyPlans((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...updates } : d))
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Comprehensive Content Planning</h1>
            <p className="text-gray-600 mt-1">Strategic campaign content marketing plan</p>
          </div>
          <button
            onClick={handleSaveStrategy}
            disabled={isLoading}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 hover:from-indigo-600 hover:to-purple-700 transition-all"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Strategy
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Navigation Tabs */}
        <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm border mb-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                activeTab === id
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-xl shadow-sm border">
          {(activeTab === 'overview' || activeTab === 'strategy') && (
            <OverviewTab
              campaignStrategy={campaignStrategy}
              platformStrategies={platformStrategies}
              onStrategyChange={(updates) =>
                setCampaignStrategy((prev) => ({ ...prev, ...updates }))
              }
              onOpenAIModal={() => setShowAIModal(true)}
            />
          )}
          {activeTab === 'weekly' && (
            <WeeklyTab
              weeklyPlans={weeklyPlans}
              selectedWeek={selectedWeek}
              onSelectWeek={setSelectedWeek}
              onGenerateWeeklyPlan={handleGenerateWeeklyPlan}
              onUpdateWeeklyPlan={handleUpdateWeeklyPlan}
            />
          )}
          {activeTab === 'daily' && (
            <DailyTab
              dailyPlans={dailyPlans}
              selectedWeek={selectedWeek}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onGenerateAllDays={handleGenerateAllDaysForWeek}
              onUpdateDailyPlan={handleUpdateDailyPlan}
            />
          )}
          {activeTab === 'metrics' && (
            <MetricsTab
              campaignStrategy={campaignStrategy}
              weeklyPlans={weeklyPlans}
            />
          )}
          {activeTab === 'templates' && (
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">Content Templates</h3>
              <p className="text-gray-500">Template management coming soon...</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Modal */}
      {showAIModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold mb-4">AI Content Generation</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">AI Provider</label>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value as any)}
                  className="w-full p-3 border rounded-lg"
                >
                  <option value="demo">Demo AI (Free Testing)</option>
                  <option value="gpt-4">GPT-4 (OpenAI)</option>
                  <option value="claude">Claude 3.5 (Anthropic)</option>
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowAIModal(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleGenerateContentPillars(() => setShowAIModal(false))}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-lg"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
