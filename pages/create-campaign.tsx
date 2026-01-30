import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { 
  ArrowLeft, 
  Plus, 
  Target, 
  Calendar,
  Save,
  Loader2,
  Sparkles,
  CheckCircle,
  MessageSquare,
  X
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import CampaignAIChat from '../components/CampaignAIChat';
import { useCompanyContext } from '../components/CompanyContext';

interface CampaignData {
  id: string;
  name: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  description: string;
  goals: string[];
}

export default function CreateCampaign() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();
  const [isLoading, setIsLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [aiGeneratedContent, setAiGeneratedContent] = useState<any>(null);
  const [campaignData, setCampaignData] = useState<CampaignData>({
    id: '',
    name: '',
    timeframe: 'quarter',
    startDate: '',
    endDate: '',
    description: '',
    goals: []
  });

  // Calculate end date based on start date and timeframe
  const calculateEndDate = (startDate: string, timeframe: string): string => {
    if (!startDate) return '';
    
    const start = new Date(startDate);
    const end = new Date(start);
    
    switch (timeframe) {
      case 'week':
        end.setDate(start.getDate() + 6); // 1 week = 7 days
        break;
      case 'month':
        end.setMonth(start.getMonth() + 1);
        break;
      case 'quarter':
        end.setMonth(start.getMonth() + 3); // 3 months = 1 quarter
        break;
      case 'year':
        end.setFullYear(start.getFullYear() + 1);
        break;
      default:
        end.setMonth(start.getMonth() + 3); // Default to quarter
    }
    
    return end.toISOString().split('T')[0];
  };

  // Update end date when start date or timeframe changes
  const updateEndDate = (startDate: string, timeframe: string) => {
    const calculatedEndDate = calculateEndDate(startDate, timeframe);
    setCampaignData(prev => ({ ...prev, endDate: calculatedEndDate }));
  };

  // Handle AI-generated content integration
  const handleAIProgramGenerated = (aiContent: any) => {
    console.log('AI content received:', aiContent);
    setAiGeneratedContent(aiContent);
    
    // Extract dates from AI content if available
    if (aiContent.startDate) {
      setCampaignData(prev => ({ ...prev, startDate: aiContent.startDate }));
      // Recalculate end date if start date changes
      updateEndDate(aiContent.startDate, campaignData.timeframe);
    }
    if (aiContent.endDate) {
      // Note: We don't update end date from AI since it's auto-calculated
      console.log('AI suggested end date ignored - using auto-calculated end date');
    }
    
    // Enhance description with AI content (append, don't replace)
    if (aiContent.description) {
      setCampaignData(prev => ({ 
        ...prev, 
        description: prev.description 
          ? `${prev.description}\n\n--- AI Enhancement ---\n${aiContent.description}`
          : aiContent.description 
      }));
    }
    
    // Extract campaign name if available
    if (aiContent.campaignName) {
      setCampaignData(prev => ({ ...prev, name: aiContent.campaignName }));
    }
  };

  // Save AI-generated content to database
  const saveAIGeneratedContent = async (campaignId: string, aiContent: any) => {
    try {
      // Save AI content to campaign_strategies table
      if (aiContent.description || aiContent.strategy) {
        await fetch('/api/campaigns/save-strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            strategy: {
              objectives: aiContent.objectives || [],
              targetAudience: aiContent.targetAudience || '',
              contentPillars: aiContent.contentPillars || [],
              description: aiContent.description || '',
              strategy: aiContent.strategy || ''
            }
          })
        });
      }

      // Save weekly plans if available
      if (aiContent.weeklyPlans && Array.isArray(aiContent.weeklyPlans)) {
        for (const weeklyPlan of aiContent.weeklyPlans) {
          await fetch('/api/campaigns/save-weekly-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaignId,
              weeklyPlan: {
                weekNumber: weeklyPlan.weekNumber,
                phase: weeklyPlan.phase,
                theme: weeklyPlan.theme,
                focusArea: weeklyPlan.focusArea,
                keyMessaging: weeklyPlan.keyMessaging,
                contentTypes: weeklyPlan.contentTypes,
                targetMetrics: weeklyPlan.targetMetrics,
                status: 'planned',
                completionPercentage: 0
              }
            })
          });
        }
      }

      console.log('AI-generated content saved successfully');
    } catch (error) {
      console.error('Error saving AI-generated content:', error);
    }
  };

  const createNewCampaign = async () => {
    if (!selectedCompanyId) {
      alert('Select a company first.');
      return;
    }
    if (!campaignData.name || campaignData.name.trim() === '') {
      alert('Please enter a campaign name first');
      return;
    }

    setIsLoading(true);
    try {
      // Generate proper UUID for campaign ID
      const newCampaignId = uuidv4();
      console.log('Creating new campaign with ID:', newCampaignId);
      
      // Create campaign data with proper name
      const campaignToCreate = {
        ...campaignData,
        id: newCampaignId,
        name: campaignData.name.trim(), // Ensure name is not empty
        status: 'planning',
        current_stage: 'planning',
        companyId: selectedCompanyId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('Campaign data being sent:', campaignToCreate);

      // Save campaign to database
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignToCreate)
      });

      console.log('API Response status:', response.status);
      console.log('API Response headers:', response.headers);

      if (response.ok) {
        const result = await response.json();
        console.log('Campaign created successfully:', result);
        
        // Save AI-generated content if available
        if (aiGeneratedContent) {
          await saveAIGeneratedContent(newCampaignId, aiGeneratedContent);
        }
        
        // Show success message
        alert(`Campaign "${campaignData.name}" created successfully! Redirecting to campaign details...`);
        
        // Redirect to campaign details page
        router.push(`/campaign-details/${newCampaignId}`);
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('API Error Response:', errorData);
        throw new Error(`Failed to create campaign: ${errorData.error || 'Unknown error'}`);
      }
      
    } catch (error) {
      console.error('Error creating campaign:', error);
      alert(`Error creating campaign: ${error.message || 'Please try again.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const generate12WeekPlan = async () => {
    if (!selectedCompanyId) {
      alert('Select a company first.');
      return;
    }
    if (!campaignData.name || campaignData.name.trim() === '') {
      alert('Please enter a campaign name first');
      return;
    }

    if (!campaignData.startDate) {
      alert('Please select a start date first');
      return;
    }

    setIsLoading(true);
    try {
      // Generate proper UUID for campaign ID
      const newCampaignId = uuidv4();
      console.log('Creating campaign with 12-week plan:', newCampaignId);
      
      // Create campaign data with proper name
      const campaignToCreate = {
        ...campaignData,
        id: newCampaignId,
        name: campaignData.name.trim(), // Ensure name is not empty
        status: 'planning',
        current_stage: 'planning',
        companyId: selectedCompanyId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('Campaign data being sent:', campaignToCreate);

      // Save campaign to database
      const campaignResponse = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignToCreate)
      });

      if (!campaignResponse.ok) {
        const errorData = await campaignResponse.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Campaign creation failed:', errorData);
        throw new Error(`Failed to create campaign: ${errorData.error || 'Unknown error'}`);
      }

      const campaignResult = await campaignResponse.json();
      console.log('Campaign created successfully:', campaignResult);

      // Generate 12-week plan
      const planResponse = await fetch('/api/campaigns/create-12week-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: newCampaignId,
          campaignName: campaignData.name, // Pass the campaign name
          startDate: campaignData.startDate,
          aiContent: campaignData.description || `Generate comprehensive 12-week content marketing plan for "${campaignData.name}"`,
          provider: 'demo'
        })
      });

      if (planResponse.ok) {
        const planResult = await planResponse.json();
        console.log('12-week plan generated successfully:', planResult);
        
        // Save AI-generated content if available
        if (aiGeneratedContent) {
          await saveAIGeneratedContent(newCampaignId, aiGeneratedContent);
        }
        
        // Show success message
        alert(`Campaign "${campaignData.name}" and 12-week plan created successfully! Redirecting to campaign details...`);
        
        // Redirect to campaign details page
        router.push(`/campaign-details/${newCampaignId}`);
      } else {
        const planErrorData = await planResponse.json().catch(() => ({ error: 'Unknown error' }));
        console.error('12-week plan generation failed:', planErrorData);
        throw new Error(`Failed to generate 12-week plan: ${planErrorData.error || 'Unknown error'}`);
      }
      
    } catch (error) {
      console.error('Error creating campaign with 12-week plan:', error);
      alert(`Error creating campaign: ${error.message || 'Please try again.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => router.push('/campaigns')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Campaigns
              </button>
              
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                  Create New Campaign
                </h1>
                <p className="text-gray-600 mt-1">Start building your content marketing strategy</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsChatOpen(true)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <MessageSquare className="h-4 w-4" />
                AI Assistant
              </button>
              
              <button 
                onClick={() => router.push('/campaigns')}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Campaign Form */}
        <div className="bg-white rounded-xl p-8 shadow-sm border mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg">
              <Target className="h-6 w-6 text-white" />
            </div>
            Campaign Details
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Name *</label>
              <input
                type="text"
                value={campaignData.name}
                onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                placeholder="Enter campaign name"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Timeframe</label>
              <select
                value={campaignData.timeframe}
                onChange={(e) => {
                  const newTimeframe = e.target.value;
                  setCampaignData({ ...campaignData, timeframe: newTimeframe });
                  if (campaignData.startDate) {
                    updateEndDate(campaignData.startDate, newTimeframe);
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
              >
                <option value="week">1 Week</option>
                <option value="month">1 Month</option>
                <option value="quarter">1 Quarter (12 weeks)</option>
                <option value="year">1 Year</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input
                type="date"
                value={campaignData.startDate}
                onChange={(e) => {
                  const newStartDate = e.target.value;
                  setCampaignData({ ...campaignData, startDate: newStartDate });
                  if (newStartDate) {
                    updateEndDate(newStartDate, campaignData.timeframe);
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date 
                <span className="text-xs text-gray-500 ml-1">(Auto-calculated)</span>
              </label>
              <input
                type="date"
                value={campaignData.endDate}
                readOnly
                className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-gray-50 text-gray-600 cursor-not-allowed"
                title="End date is automatically calculated based on start date and timeframe"
              />
            </div>
          </div>
          
          <div className="mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Campaign Description
              <span className="text-xs text-gray-500 ml-1">(Manual + AI Enhanced)</span>
            </label>
            <textarea
              value={campaignData.description}
              onChange={(e) => setCampaignData({ ...campaignData, description: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
              placeholder="Describe your campaign goals, target audience, and key messaging... (You can edit this manually and AI will enhance it)"
            />
            <p className="text-xs text-gray-500 mt-1">
              💡 Tip: Write your initial description here, then use AI Assistant to enhance and expand it
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="bg-white rounded-xl p-6 shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Next Steps</h3>
          <p className="text-gray-600 mb-6">Choose how you'd like to proceed with your campaign:</p>
          
          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={createNewCampaign}
              disabled={isLoading || !campaignData.name || campaignData.name.trim() === ''}
              className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center justify-center gap-3"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              Create Campaign
            </button>
            
            <button 
              onClick={generate12WeekPlan}
              disabled={isLoading || !campaignData.name || campaignData.name.trim() === '' || !campaignData.startDate}
              className="flex-1 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 disabled:opacity-50 text-white px-6 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center justify-center gap-3"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              Create + Generate 12-Week Plan
            </button>
          </div>
          
          <div className="mt-4 text-sm text-gray-500">
            <p><strong>Create Campaign:</strong> Creates the campaign and takes you to campaign details where you can plan content manually.</p>
            <p><strong>Create + Generate 12-Week Plan:</strong> Creates the campaign and automatically generates a comprehensive 12-week content plan using AI.</p>
            <p className="mt-2 text-orange-600"><strong>Requirements:</strong> Campaign name is mandatory. Start date is required for 12-week plan generation.</p>
          </div>
        </div>

        {/* AI Generated Content Display */}
        {aiGeneratedContent && (
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-6 border border-purple-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-purple-900 flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Generated Content
              </h3>
              <button 
                onClick={() => setAiGeneratedContent(null)}
                className="text-purple-600 hover:text-purple-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="space-y-3">
              {aiGeneratedContent.description && (
                <div>
                  <h4 className="font-medium text-purple-800 mb-1">AI Enhancement Added:</h4>
                  <p className="text-purple-700 text-sm">{aiGeneratedContent.description}</p>
                  <p className="text-purple-600 text-xs mt-1 italic">
                    ✨ This has been added to your campaign description above
                  </p>
                </div>
              )}
              
              {aiGeneratedContent.startDate && (
                <div>
                  <h4 className="font-medium text-purple-800 mb-1">Suggested Start Date:</h4>
                  <p className="text-purple-700 text-sm">{new Date(aiGeneratedContent.startDate).toLocaleDateString()}</p>
                </div>
              )}
              
              {aiGeneratedContent.endDate && (
                <div>
                  <h4 className="font-medium text-purple-800 mb-1">AI Suggested End Date:</h4>
                  <p className="text-purple-700 text-sm">{new Date(aiGeneratedContent.endDate).toLocaleDateString()}</p>
                  <p className="text-purple-600 text-xs mt-1 italic">
                    ℹ️ End date is auto-calculated based on your timeframe selection
                  </p>
                </div>
              )}
              
              {aiGeneratedContent.weeklyPlans && aiGeneratedContent.weeklyPlans.length > 0 && (
                <div>
                  <h4 className="font-medium text-purple-800 mb-1">Weekly Plans Generated:</h4>
                  <p className="text-purple-700 text-sm">{aiGeneratedContent.weeklyPlans.length} weeks planned</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI Chat Component */}
      {isChatOpen && (
        <CampaignAIChat
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          onMinimize={() => setIsChatOpen(false)}
          context="campaign-creation"
          campaignId={null}
          companyId={selectedCompanyId}
          campaignData={campaignData}
          onProgramGenerated={handleAIProgramGenerated}
        />
      )}
    </div>
  );
}
