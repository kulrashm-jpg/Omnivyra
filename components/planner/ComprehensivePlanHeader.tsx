import React from 'react';
import { Save, Loader2, BarChart3, Target, Calendar, Clock, TrendingUp, FileText } from 'lucide-react';

type TabId = 'overview' | 'strategy' | 'weekly' | 'daily' | 'metrics' | 'templates';

interface ComprehensivePlanHeaderProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onSave: () => void;
  isLoading: boolean;
}

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'weekly', label: 'Weekly Plans', icon: Calendar },
  { id: 'daily', label: 'Daily Plans', icon: Clock },
  { id: 'metrics', label: 'Metrics', icon: TrendingUp },
  { id: 'templates', label: 'Templates', icon: FileText },
];

export const ComprehensivePlanHeader = React.memo(function ComprehensivePlanHeader({
  activeTab,
  onTabChange,
  onSave,
  isLoading,
}: ComprehensivePlanHeaderProps) {
  return (
    <>
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Comprehensive Content Planning</h1>
              <p className="text-gray-600 mt-1">Strategic campaign content marketing plan</p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={onSave}
                disabled={isLoading}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 hover:from-indigo-600 hover:to-purple-700 transition-all"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Strategy
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm border mb-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </>
  );
});
