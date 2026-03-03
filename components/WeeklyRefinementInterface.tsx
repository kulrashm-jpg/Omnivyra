import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Edit3, 
  CheckCircle, 
  Calendar, 
  Target, 
  Users, 
  TrendingUp,
  FileText,
  Image,
  Video,
  Mic,
  Loader2,
  X,
  Save,
  Send,
  Sparkles,
  Brain,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

interface WeeklyTheme {
  theme: string;
  focusArea: string;
  suggestions: string[];
}

interface WeeklyRefinement {
  id: string;
  campaign_id: string;
  week_number: number;
  theme: string;
  focus_area: string;
  ai_suggestions: string[];
  refinement_status: string;
  original_content: any;
  ai_enhanced_content: any;
  finalized_content: any;
  created_at: string;
  updated_at: string;
}

interface DailyPlan {
  id: string;
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  date: string;
  platform: string;
  content_type: string;
  title: string;
  content: string;
  scheduled_time: string;
  status: string;
}

interface WeeklyRefinementInterfaceProps {
  campaignId: string;
  campaignData: any;
  onWeekSelect?: (weekNumber: number) => void;
}

export default function WeeklyRefinementInterface({ 
  campaignId, 
  campaignData, 
  onWeekSelect 
}: WeeklyRefinementInterfaceProps) {
  const [weeklyRefinements, setWeeklyRefinements] = useState<WeeklyRefinement[]>([]);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [showDailyPlan, setShowDailyPlan] = useState(false);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAmending, setIsAmending] = useState<number | null>(null);
  const [amendmentText, setAmendmentText] = useState('');
  const [isProcessingAmendment, setIsProcessingAmendment] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    loadWeeklyRefinements();
  }, [campaignId]);

  const loadWeeklyRefinements = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/campaigns/weekly-refinements?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        setWeeklyRefinements(data.refinements || []);
      } else {
        // If no refinements exist, create a default structure
        console.log('No weekly refinements found, creating default structure');
        setWeeklyRefinements([]);
      }
    } catch (error) {
      console.error('Error loading weekly refinements:', error);
      setWeeklyRefinements([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDailyPlans = async (weekNumber: number) => {
    try {
      const response = await fetch(`/api/campaigns/daily-plans?campaignId=${campaignId}&weekNumber=${weekNumber}`);
      if (response.ok) {
        const data = await response.json();
        setDailyPlans(data.plans || []);
      }
    } catch (error) {
      console.error('Error loading daily plans:', error);
    }
  };

  const toggleWeekExpansion = (weekNumber: number) => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(weekNumber)) {
      newExpanded.delete(weekNumber);
    } else {
      newExpanded.add(weekNumber);
    }
    setExpandedWeeks(newExpanded);
  };

  const openDailyPlan = async (weekNumber: number) => {
    setSelectedWeek(weekNumber);
    await loadDailyPlans(weekNumber);
    setShowDailyPlan(true);
    if (onWeekSelect) {
      onWeekSelect(weekNumber);
    }
  };

  const startAmendment = (weekNumber: number) => {
    setIsAmending(weekNumber);
    setAmendmentText('');
  };

  const cancelAmendment = () => {
    setIsAmending(null);
    setAmendmentText('');
  };

  const processAmendment = async (weekNumber: number) => {
    if (!amendmentText.trim()) return;

    setIsProcessingAmendment(true);
    try {
      const response = await fetch('/api/ai/weekly-amendment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber,
          amendmentRequest: amendmentText,
          campaignData,
          currentWeekData: weeklyRefinements.find(w => w.week_number === weekNumber)
        })
      });

      if (response.ok) {
        const result = await response.json();
        await applyAmendment(weekNumber, result.amendment);
        notify('success', `Week ${weekNumber} updated with AI suggestions.`);
      }
    } catch (error) {
      console.error('Error processing amendment:', error);
      notify('error', 'Failed to process amendment. Please try again.');
    } finally {
      setIsProcessingAmendment(false);
      setIsAmending(null);
      setAmendmentText('');
    }
  };

  const commitWeeklyPlan = async (weekNumber: number) => {
    const weekData = weeklyRefinements.find(w => w.week_number === weekNumber);
    if (!weekData) return;

    try {
      const response = await fetch('/api/campaigns/commit-weekly-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber,
          weekData,
          commitType: 'finalize'
        })
      });

      if (response.ok) {
        const result = await response.json();
        notify('success', `Week ${weekNumber} plan submitted successfully.`);
        loadWeeklyRefinements();
      } else {
        throw new Error('Failed to submit plan');
      }
    } catch (error) {
      console.error('Error committing weekly plan:', error);
      notify('error', 'Failed to submit weekly plan. Please try again.');
    }
  };

  const applyAmendment = async (weekNumber: number, amendment: string) => {
    try {
      const response = await fetch('/api/campaigns/apply-weekly-amendment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber,
          amendment
        })
      });

      if (response.ok) {
        await loadWeeklyRefinements();
        notify('success', `Week ${weekNumber} has been updated successfully.`);
      }
    } catch (error) {
      console.error('Error applying amendment:', error);
      notify('error', 'Failed to apply amendment. Please try again.');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'finalized': return 'bg-green-100 text-green-800';
      case 'ai-enhanced': return 'bg-blue-100 text-blue-800';
      case 'manually-edited': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform.toLowerCase()) {
      case 'linkedin': return <FileText className="h-4 w-4" />;
      case 'instagram': return <Image className="h-4 w-4" />;
      case 'youtube': return <Video className="h-4 w-4" />;
      case 'twitter': return <FileText className="h-4 w-4" />;
      case 'facebook': return <FileText className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Loading weekly refinements...</span>
      </div>
    );
  }

  // Calculate progress statistics
  const totalWeeks = 12;
  const plannedWeeks = weeklyRefinements.length;
  const finalizedWeeks = weeklyRefinements.filter(w => w.refinement_status === 'finalized').length;
  const aiEnhancedWeeks = weeklyRefinements.filter(w => w.refinement_status === 'ai_enhanced').length;
  const progressPercentage = Math.round((plannedWeeks / totalWeeks) * 100);

  return (
    <div className="space-y-6">
      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-indigo-200 bg-indigo-50 text-indigo-800'
          }`}
          role="status"
          aria-live="polite"
        >
          {notice.message}
        </div>
      )}
      {/* Header with Progress Overview */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">12-Week Content Plan</h2>
            <p className="text-gray-600 mt-1">Comprehensive overview of your campaign strategy</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">{progressPercentage}%</div>
            <div className="text-sm text-gray-500">Complete</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Progress</span>
            <span>{plannedWeeks} of {totalWeeks} weeks planned</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div 
              className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
        </div>

        {/* Statistics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <Calendar className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-700">{plannedWeeks}</div>
                <div className="text-sm text-blue-600">Weeks Planned</div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500 rounded-lg">
                <CheckCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold text-green-700">{finalizedWeeks}</div>
                <div className="text-sm text-green-600">Finalized</div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500 rounded-lg">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-700">{aiEnhancedWeeks}</div>
                <div className="text-sm text-purple-600">AI Enhanced</div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500 rounded-lg">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold text-orange-700">{totalWeeks - plannedWeeks}</div>
                <div className="text-sm text-orange-600">Pending</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Cards */}
      <div className="grid gap-4">
        {Array.from({ length: weeklyRefinements.length || 12 }, (_, index) => {
          const weekNumber = index + 1;
          const weekData = weeklyRefinements.find(w => w.week_number === weekNumber);
          const isExpanded = expandedWeeks.has(weekNumber);
          const isAmendingThisWeek = isAmending === weekNumber;

          return (
            <div key={weekNumber} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              {/* Week Header */}
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleWeekExpansion(weekNumber)}
                      className="flex items-center gap-2 text-left hover:bg-gray-50 rounded-lg p-2 -m-2"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      )}
                      <div>
                        <h3 className="font-semibold text-gray-900">Week {weekNumber}</h3>
                        <p className="text-sm text-gray-600">
                          {weekData?.theme || `Week ${weekNumber} Theme`}
                        </p>
                      </div>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {weekData && (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(weekData.refinement_status)}`}>
                        {weekData.refinement_status}
                      </span>
                    )}
                    
                    <button
                      onClick={() => openDailyPlan(weekNumber)}
                      className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm font-medium"
                    >
                      View Daily Plan
                    </button>

                    <button
                      onClick={() => startAmendment(weekNumber)}
                      className="p-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors"
                      title="AI Amendment"
                    >
                      <Plus className="h-4 w-4" />
                    </button>

                    {weekData && weekData.refinement_status !== 'finalized' && (
                      <button
                        onClick={() => commitWeeklyPlan(weekNumber)}
                        className="px-3 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm font-medium"
                        title="Submit this week's plan"
                      >
                        Submit Plan
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Amendment Interface */}
              {isAmendingThisWeek && (
                <div className="p-4 bg-purple-50 border-b border-gray-100">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-purple-600" />
                      <span className="text-sm font-medium text-purple-900">AI Amendment Request</span>
                    </div>
                    <textarea
                      value={amendmentText}
                      onChange={(e) => setAmendmentText(e.target.value)}
                      placeholder="Describe what you'd like to change about this week's content plan..."
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={cancelAmendment}
                        className="px-3 py-1 text-gray-600 hover:text-gray-800 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => processAmendment(weekNumber)}
                        disabled={!amendmentText.trim() || isProcessingAmendment}
                        className="px-4 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        {isProcessingAmendment ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Brain className="h-3 w-3" />
                        )}
                        Process Amendment
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Expanded Content */}
              {isExpanded && weekData && (
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Focus Area */}
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Focus Area</h4>
                      <p className="text-sm text-gray-600">{weekData.focus_area}</p>
                    </div>

                    {/* AI Suggestions */}
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">AI Suggestions</h4>
                      <div className="space-y-1">
                        {weekData.ai_suggestions?.slice(0, 3).map((suggestion, idx) => (
                          <div key={idx} className="text-sm text-gray-600 flex items-center gap-2">
                            <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                            {suggestion}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Daily Plan Modal */}
      {showDailyPlan && selectedWeek && (
        <DailyPlanModal
          weekNumber={selectedWeek}
          dailyPlans={dailyPlans}
          campaignId={campaignId}
          campaignData={campaignData}
          onClose={() => setShowDailyPlan(false)}
          onRefresh={() => loadDailyPlans(selectedWeek)}
          onNotify={notify}
        />
      )}
    </div>
  );
}

// Daily Plan Modal Component
interface DailyPlanModalProps {
  weekNumber: number;
  dailyPlans: DailyPlan[];
  campaignId: string;
  campaignData: any;
  onClose: () => void;
  onRefresh: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

function DailyPlanModal({ weekNumber, dailyPlans, campaignId, campaignData, onClose, onRefresh, onNotify }: DailyPlanModalProps) {
  const [isAmending, setIsAmending] = useState(false);
  const [amendmentText, setAmendmentText] = useState('');
  const [isProcessingAmendment, setIsProcessingAmendment] = useState(false);

  const processDailyAmendment = async () => {
    if (!amendmentText.trim()) return;

    setIsProcessingAmendment(true);
    try {
      const response = await fetch('/api/ai/daily-amendment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber,
          amendmentRequest: amendmentText,
          campaignData,
          dailyPlans
        })
      });

      if (response.ok) {
        const result = await response.json();
        onRefresh();
        onNotify('success', 'Daily plan updated successfully.');
      }
    } catch (error) {
      console.error('Error processing daily amendment:', error);
      onNotify('error', 'Failed to process amendment. Please try again.');
    } finally {
      setIsProcessingAmendment(false);
      setIsAmending(false);
      setAmendmentText('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-4 rounded-t-2xl flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">Week {weekNumber} Daily Plan</h3>
            <p className="text-blue-100 text-sm">Review and refine your daily content schedule</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Amendment Interface */}
        {isAmending && (
          <div className="p-4 bg-purple-50 border-b border-gray-100">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-medium text-purple-900">AI Amendment Request</span>
              </div>
              <textarea
                value={amendmentText}
                onChange={(e) => setAmendmentText(e.target.value)}
                placeholder="Describe what you'd like to change about this week's daily plan..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAmending(false)}
                  className="px-3 py-1 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={processDailyAmendment}
                  disabled={!amendmentText.trim() || isProcessingAmendment}
                  className="px-4 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {isProcessingAmendment ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Brain className="h-3 w-3" />
                  )}
                  Process Amendment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Daily Plans Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid gap-4">
            {dailyPlans.map((plan, index) => (
              <div key={plan.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">{plan.day_of_week}</h4>
                      <p className="text-sm text-gray-600">{new Date(plan.date).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium">
                      {plan.platform}
                    </span>
                    <span className="px-2 py-1 bg-blue-200 text-blue-700 rounded text-xs font-medium">
                      {plan.content_type}
                    </span>
                  </div>
                </div>
                <div className="mt-2">
                  <h5 className="font-medium text-gray-900 mb-1">{plan.title}</h5>
                  <p className="text-sm text-gray-600">{plan.content}</p>
                  {plan.scheduled_time && (
                    <p className="text-xs text-gray-500 mt-1">
                      Scheduled: {plan.scheduled_time}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50 rounded-b-2xl">
          <div className="flex justify-between items-center">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => setIsAmending(true)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              AI Amendment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
