import React, { useState, useEffect } from 'react';
import { 
  X, 
  Sparkles, 
  Save, 
  Upload, 
  Plus, 
  Trash2, 
  Edit3,
  Calendar,
  Target,
  TrendingUp,
  Loader2,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

interface WeekPlan {
  weekNumber: number;
  theme: string;
  focusArea: string;
  marketingChannels: string[];
  existingContent?: string;
  contentNotes?: string;
}

interface CampaignSummary {
  objective: string;
  targetAudience: string;
  keyMessages: string[];
  successMetrics: string[];
}

interface ComprehensivePlanEditorProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignData?: any;
  onSave: (plan: any) => void;
}

export default function ComprehensivePlanEditor({
  isOpen,
  onClose,
  campaignId,
  campaignData,
  onSave
}: ComprehensivePlanEditorProps) {
  const [campaignSummary, setCampaignSummary] = useState<CampaignSummary>({
    objective: '',
    targetAudience: '',
    keyMessages: [],
    successMetrics: []
  });

  const [weeklyPlans, setWeeklyPlans] = useState<WeekPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'weeks' | 'existing'>('summary');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const marketingChannels = ['LinkedIn', 'Twitter', 'Facebook', 'Instagram', 'YouTube', 'TikTok', 'Email', 'Blog', 'Podcast'];

  useEffect(() => {
    if (isOpen && campaignId) {
      loadExistingPlan();
    }
  }, [isOpen, campaignId]);

  const loadExistingPlan = async () => {
    setIsLoading(true);
    try {
      // Load campaign data
      const campaignRes = await fetch(`/api/campaigns?type=campaign&campaignId=${campaignId}`);
      const campaignResult = await campaignRes.json();
      
      if (campaignResult.campaign) {
        const camp = campaignResult.campaign;
        setCampaignSummary({
          objective: camp.objective || camp.description || '',
          targetAudience: camp.target_audience || '',
          keyMessages: camp.key_messages || [],
          successMetrics: camp.success_metrics || []
        });
      }

      // Load weekly plans
      const weeklyRes = await fetch(`/api/campaigns/weekly-refinement?campaignId=${campaignId}&weekNumber=all`);
      const weeklyResult = await weeklyRes.json();
      
      if (weeklyResult.weeklyRefinements && weeklyResult.weeklyRefinements.length > 0) {
        const plans = weeklyResult.weeklyRefinements.map((w: any) => ({
          weekNumber: w.week_number,
          theme: w.theme || `Week ${w.week_number} Theme`,
          focusArea: w.focus_area || `Week ${w.week_number} Focus Area`,
          marketingChannels: w.marketing_channels || [],
          existingContent: w.existing_content || '',
          contentNotes: w.content_notes || ''
        }));
        setWeeklyPlans(plans);
      } else {
        // Initialize empty plans for 12 weeks
        const emptyPlans = Array.from({ length: 12 }, (_, i) => ({
          weekNumber: i + 1,
          theme: '',
          focusArea: '',
          marketingChannels: [],
          existingContent: '',
          contentNotes: ''
        }));
        setWeeklyPlans(emptyPlans);
      }
    } catch (error) {
      console.error('Error loading plan:', error);
      // Initialize empty plans if loading fails
      const emptyPlans = Array.from({ length: 12 }, (_, i) => ({
        weekNumber: i + 1,
        theme: '',
        focusArea: '',
        marketingChannels: [],
        existingContent: '',
        contentNotes: ''
      }));
      setWeeklyPlans(emptyPlans);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummaryChange = (field: keyof CampaignSummary, value: any) => {
    setCampaignSummary(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleWeekChange = (weekNumber: number, field: keyof WeekPlan, value: any) => {
    setWeeklyPlans(prev => 
      prev.map(week => 
        week.weekNumber === weekNumber 
          ? { ...week, [field]: value }
          : week
      )
    );
  };

  const toggleChannel = (weekNumber: number, channel: string) => {
    setWeeklyPlans(prev =>
      prev.map(week => {
        if (week.weekNumber === weekNumber) {
          const channels = week.marketingChannels.includes(channel)
            ? week.marketingChannels.filter(c => c !== channel)
            : [...week.marketingChannels, channel];
          return { ...week, marketingChannels: channels };
        }
        return week;
      })
    );
  };

  const generateWithAI = async () => {
    if (!aiPrompt.trim()) {
      alert('Please enter a prompt for AI generation');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/ai/generate-comprehensive-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          campaignSummary,
          weeklyPlans,
          userPrompt: aiPrompt,
          campaignData
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.campaignSummary) {
          setCampaignSummary(result.campaignSummary);
        }
        
        if (result.weeklyPlans && result.weeklyPlans.length > 0) {
          setWeeklyPlans(result.weeklyPlans);
        }
        
        setAiPrompt('');
        alert('✅ Plan generated successfully! Review and save when ready.');
      } else {
        throw new Error('Failed to generate plan');
      }
    } catch (error) {
      console.error('Error generating plan:', error);
      alert('❌ Failed to generate plan. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/campaigns/save-comprehensive-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          campaignSummary,
          weeklyPlans
        })
      });

      if (response.ok) {
        const result = await response.json();
        onSave(result);
        alert('✅ 12-Week plan saved successfully!');
        onClose();
      } else {
        throw new Error('Failed to save plan');
      }
    } catch (error) {
      console.error('Error saving plan:', error);
      alert('❌ Failed to save plan. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-purple-600" />
            <h2 className="text-2xl font-bold text-gray-900">AI Assistant - 12-Week Plan Editor</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('summary')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'summary'
                ? 'border-b-2 border-purple-600 text-purple-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Campaign Summary
          </button>
          <button
            onClick={() => setActiveTab('weeks')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'weeks'
                ? 'border-b-2 border-purple-600 text-purple-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            12-Week Plan
          </button>
          <button
            onClick={() => setActiveTab('existing')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'existing'
                ? 'border-b-2 border-purple-600 text-purple-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Existing Content
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
            </div>
          ) : (
            <>
              {/* Campaign Summary Tab */}
              {activeTab === 'summary' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Campaign Objective
                    </label>
                    <textarea
                      value={campaignSummary.objective}
                      onChange={(e) => handleSummaryChange('objective', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      rows={4}
                      placeholder="Describe the main objective of this campaign..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Target Audience
                    </label>
                    <textarea
                      value={campaignSummary.targetAudience}
                      onChange={(e) => handleSummaryChange('targetAudience', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      rows={3}
                      placeholder="Describe your target audience..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Key Messages
                    </label>
                    <div className="space-y-2">
                      {campaignSummary.keyMessages.map((msg, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={msg}
                            onChange={(e) => {
                              const newMessages = [...campaignSummary.keyMessages];
                              newMessages[idx] = e.target.value;
                              handleSummaryChange('keyMessages', newMessages);
                            }}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            placeholder={`Key message ${idx + 1}`}
                          />
                          <button
                            onClick={() => handleSummaryChange('keyMessages', campaignSummary.keyMessages.filter((_, i) => i !== idx))}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => handleSummaryChange('keyMessages', [...campaignSummary.keyMessages, ''])}
                        className="flex items-center gap-2 text-purple-600 hover:text-purple-700"
                      >
                        <Plus className="h-4 w-4" />
                        Add Key Message
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Success Metrics
                    </label>
                    <div className="space-y-2">
                      {campaignSummary.successMetrics.map((metric, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={metric}
                            onChange={(e) => {
                              const newMetrics = [...campaignSummary.successMetrics];
                              newMetrics[idx] = e.target.value;
                              handleSummaryChange('successMetrics', newMetrics);
                            }}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                            placeholder={`Metric ${idx + 1}`}
                          />
                          <button
                            onClick={() => handleSummaryChange('successMetrics', campaignSummary.successMetrics.filter((_, i) => i !== idx))}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => handleSummaryChange('successMetrics', [...campaignSummary.successMetrics, ''])}
                        className="flex items-center gap-2 text-purple-600 hover:text-purple-700"
                      >
                        <Plus className="h-4 w-4" />
                        Add Success Metric
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 12-Week Plan Tab */}
              {activeTab === 'weeks' && (
                <div className="space-y-6">
                  {/* AI Generation Prompt */}
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Sparkles className="inline h-4 w-4 mr-1" />
                      AI Generation Prompt
                    </label>
                    <div className="flex gap-2">
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        rows={2}
                        placeholder="E.g., 'Generate themes focusing on product launches, user engagement, and thought leadership...'"
                      />
                      <button
                        onClick={generateWithAI}
                        disabled={isGenerating}
                        className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                      >
                        {isGenerating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        Generate
                      </button>
                    </div>
                  </div>

                  {/* Weekly Plans */}
                  <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                    {weeklyPlans.map((week) => (
                      <div key={week.weekNumber} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-4">
                          <Calendar className="h-5 w-5 text-purple-600" />
                          <h3 className="font-semibold text-lg">Week {week.weekNumber}</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Theme
                            </label>
                            <input
                              type="text"
                              value={week.theme}
                              onChange={(e) => handleWeekChange(week.weekNumber, 'theme', e.target.value)}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                              placeholder={`Week ${week.weekNumber} theme...`}
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Focus Area
                            </label>
                            <input
                              type="text"
                              value={week.focusArea}
                              onChange={(e) => handleWeekChange(week.weekNumber, 'focusArea', e.target.value)}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                              placeholder={`Week ${week.weekNumber} focus area...`}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Marketing Channels
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {marketingChannels.map((channel) => (
                              <button
                                key={channel}
                                onClick={() => toggleChannel(week.weekNumber, channel)}
                                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                                  week.marketingChannels.includes(channel)
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {channel}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Existing Content Tab */}
              {activeTab === 'existing' && (
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <AlertCircle className="h-5 w-5 text-blue-600 inline mr-2" />
                    <span className="text-sm text-blue-800">
                      Add existing content you already have for specific weeks. The AI will incorporate this into your plan.
                    </span>
                  </div>

                  <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                    {weeklyPlans.map((week) => (
                      <div key={week.weekNumber} className="border border-gray-200 rounded-lg p-4">
                        <h3 className="font-semibold mb-3">Week {week.weekNumber}</h3>
                        
                        <div className="space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Existing Content
                            </label>
                            <textarea
                              value={week.existingContent || ''}
                              onChange={(e) => handleWeekChange(week.weekNumber, 'existingContent', e.target.value)}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                              rows={4}
                              placeholder="Paste or describe existing content, posts, ideas, or assets you have for this week..."
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Content Notes
                            </label>
                            <textarea
                              value={week.contentNotes || ''}
                              onChange={(e) => handleWeekChange(week.weekNumber, 'contentNotes', e.target.value)}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                              rows={2}
                              placeholder="Any specific notes or requirements for this content..."
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save 12-Week Plan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


