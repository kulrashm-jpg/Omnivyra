import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { 
  ArrowLeft, 
  Calendar, 
  Target, 
  Plus, 
  Trash2, 
  Edit3, 
  Save, 
  CheckCircle,
  AlertCircle,
  Clock,
  Users,
  TrendingUp,
  FileText,
  Image,
  Video,
  Mic,
  Loader2,
  X,
  Sparkles
} from 'lucide-react';
import CampaignAIChat from '../components/CampaignAIChat';
import DailyPlanningInterface from '../components/DailyPlanningInterface';
import AIContentIntegration from '../components/AIContentIntegration';
import ContentCreationPanel from '../components/ContentCreationPanel';
import VoiceNotesComponent from '../components/VoiceNotesComponent';
import WeeklyRefinementInterface from '../components/WeeklyRefinementInterface';

export default function CampaignPlanning() {
  const [campaignData, setCampaignData] = useState({
    id: '',
    name: '',
    timeframe: 'quarter',
    startDate: '',
    endDate: '',
    description: '',
    goals: []
  });

  const [newGoal, setNewGoal] = useState({
    contentType: '',
    quantity: '',
    platform: '',
    timeline: '',
    priority: 'medium'
  });

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [aiProgram, setAiProgram] = useState<any>(null);
  const [showProgramCapture, setShowProgramCapture] = useState(false);
  const [programStartDate, setProgramStartDate] = useState('');
  const [selectedWeek, setSelectedWeek] = useState<any>(null);
  const [showDailyPlanning, setShowDailyPlanning] = useState(false);
  const [activePlanningTab, setActivePlanningTab] = useState<'overview' | 'content' | 'voice' | 'refinement'>('overview');
  const [showWeeklyRefinement, setShowWeeklyRefinement] = useState(false);
  const [hasExistingPlan, setHasExistingPlan] = useState(false);
  const [planDescription, setPlanDescription] = useState('');

  // Initialize campaign from URL params or load existing campaign
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    console.log('useEffect triggered - checking URL params');
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const existingCampaignId = urlParams.get('campaignId');
    console.log('URL params:', { mode, existingCampaignId, search: window.location.search });

    if (mode === 'create') {
      console.log('Create mode - starting fresh campaign');
      // Don't load any existing campaign, start fresh
      setCampaignId(null);
      setCampaignData({
        id: '',
        name: 'New Campaign',
        timeframe: 'quarter',
        startDate: '',
        endDate: '',
        description: '',
        goals: []
      });
      // Clear any existing campaign data and stop loading
      setIsLoading(false);
      console.log('Create mode initialized - campaignId:', null, 'campaignData:', {
        id: '',
        name: 'New Campaign',
        timeframe: 'quarter',
        startDate: '',
        endDate: '',
        description: '',
        goals: []
      });
    } else if (mode === 'edit' && existingCampaignId) {
      console.log('Edit mode - loading campaign with ID:', existingCampaignId);
      loadCampaign(existingCampaignId);
    } else if (existingCampaignId) {
      console.log('Loading campaign with ID:', existingCampaignId);
      loadCampaign(existingCampaignId);
    } else {
      console.log('No campaign ID found in URL, checking for existing campaigns');
      // If no campaign ID in URL, check if there's an existing campaign
      loadExistingCampaign();
    }
  }, []);

  // Initialize AI chat state based on URL params
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openAI') === 'true') {
      setIsChatOpen(true);
    }
  }, []);

  const createNewCampaign = async () => {
    setIsLoading(true);
    try {
      // Generate proper UUID for campaign ID
      const newCampaignId = uuidv4();
      console.log('Creating new campaign with ID:', newCampaignId);
      
      // Set campaign data
      setCampaignId(newCampaignId);
      setCampaignData(prev => ({
        ...prev,
        id: newCampaignId,
        name: 'New Campaign',
        description: '',
        timeframe: 'quarter',
        startDate: '',
        endDate: '',
        goals: []
      }));
      
      // Update URL to include the new campaign ID
      const newUrl = `${window.location.pathname}?campaignId=${newCampaignId}`;
      window.history.pushState({}, '', newUrl);
      
      // Start AI chat for campaign planning
      setIsChatOpen(true);
      
      console.log('Campaign created successfully:', newCampaignId);
      
      // Show success message
      alert('New campaign created! You can now start planning your content strategy.');
      
    } catch (error) {
      console.error('Error creating campaign:', error);
      alert('Error creating campaign. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const generate12WeekPlan = async () => {
    if (!campaignId) {
      alert('Please create a campaign first');
      return;
    }

    setIsLoading(true);
    try {
      console.log('Generating 12-week plan for campaign:', campaignId);
      
      const response = await fetch('/api/campaigns/create-12week-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          startDate: campaignData.startDate || new Date().toISOString().split('T')[0],
          aiContent: campaignData.description || 'Generate comprehensive 12-week content marketing plan',
          provider: 'demo'
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('12-week plan generated:', result);
        
        // Check for existing plan after generation
        await checkExistingPlan(campaignId);
        
        // Redirect to campaign details to view the generated plan
        window.location.href = `/campaign-details/${campaignId}`;
      } else {
        throw new Error('Failed to generate 12-week plan');
      }
    } catch (error) {
      console.error('Error generating 12-week plan:', error);
      alert('Error generating 12-week plan. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Check if 12-week plan exists and load description
  const checkExistingPlan = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/get-weekly-plans?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        console.log('Weekly plans data received:', data);
        const hasPlan = data && data.length > 0;
        setHasExistingPlan(hasPlan);
        
        if (hasPlan) {
          // Generate description from weekly plans
          const description = generatePlanDescription(data);
          console.log('Generated plan description:', description);
          setPlanDescription(description);
        } else {
          setPlanDescription('');
        }
      }
    } catch (error) {
      console.error('Error checking existing plan:', error);
      setHasExistingPlan(false);
      setPlanDescription('');
    }
  };

  // Generate comprehensive description from weekly plans
  const generatePlanDescription = (weeklyPlans: any[]) => {
    if (!weeklyPlans || weeklyPlans.length === 0) return '';
    
    console.log('Generating description from weekly plans:', weeklyPlans);
    
    const phases = [...new Set(weeklyPlans.map(plan => plan.phase))];
    const themes = weeklyPlans.map(plan => plan.theme).filter(Boolean);
    const contentTypes = [...new Set(weeklyPlans.flatMap(plan => plan.contentTypes || []))];
    
    console.log('Extracted data:', { phases, themes, contentTypes });
    
    let description = `A comprehensive ${weeklyPlans.length}-week content marketing plan structured across ${phases.length} distinct phases: ${phases.join(', ')}.\n\n`;
    
    // Add phase breakdown
    description += `**Phase Breakdown:**\n`;
    phases.forEach(phase => {
      const phaseWeeks = weeklyPlans.filter(plan => plan.phase === phase);
      description += `• ${phase}: Weeks ${phaseWeeks.map(w => w.weekNumber).join(', ')} (${phaseWeeks.length} weeks)\n`;
    });
    
    description += `\n**Weekly Themes:**\n`;
    weeklyPlans.forEach(plan => {
      description += `• Week ${plan.weekNumber}: ${plan.theme || 'Content Focus'}`;
      if (plan.focusArea) {
        description += ` - ${plan.focusArea}`;
      }
      description += `\n`;
    });
    
    if (contentTypes.length > 0) {
      description += `\n**Content Types:** ${contentTypes.join(', ')}\n`;
    }
    
    // Add key messaging summary
    const keyMessaging = weeklyPlans.map(plan => plan.keyMessaging).filter(Boolean);
    if (keyMessaging.length > 0) {
      description += `\n**Key Messaging Focus:**\n`;
      keyMessaging.slice(0, 5).forEach((msg, index) => {
        description += `• ${msg}\n`;
      });
    }
    
    // Add target metrics summary
    const totalMetrics = weeklyPlans.reduce((acc, plan) => {
      if (plan.targetMetrics) {
        acc.impressions += plan.targetMetrics.impressions || 0;
        acc.engagements += plan.targetMetrics.engagements || 0;
        acc.conversions += plan.targetMetrics.conversions || 0;
        acc.ugcSubmissions += plan.targetMetrics.ugcSubmissions || 0;
      }
      return acc;
    }, { impressions: 0, engagements: 0, conversions: 0, ugcSubmissions: 0 });
    
    if (totalMetrics.impressions > 0) {
      description += `\n**Target Metrics (12-week total):**\n`;
      description += `• Impressions: ${totalMetrics.impressions.toLocaleString()}\n`;
      description += `• Engagements: ${totalMetrics.engagements.toLocaleString()}\n`;
      description += `• Conversions: ${totalMetrics.conversions.toLocaleString()}\n`;
      description += `• UGC Submissions: ${totalMetrics.ugcSubmissions.toLocaleString()}\n`;
    }
    
    console.log('Final generated description:', description);
    return description;
  };

  const loadExistingCampaign = async () => {
    setIsLoading(true);
    try {
      console.log('Checking for existing campaigns...');
      const response = await fetch('/api/campaigns/list');
      
      if (response.ok) {
        const result = await response.json();
        console.log('Campaigns list response:', result);
        
        if (result.success && result.campaigns && result.campaigns.length > 0) {
          // If there's exactly one campaign, load it automatically
          if (result.campaigns.length === 1) {
            const campaign = result.campaigns[0];
            console.log('Found single campaign, loading:', campaign.id);
            setCampaignId(campaign.id);
            setCampaignData(prev => ({
              ...prev,
              id: campaign.id,
              name: campaign.name || 'Campaign ' + campaign.id,
              description: campaign.description || '',
              timeframe: 'quarter',
              startDate: '',
              endDate: '',
              goals: []
            }));
          } else {
            console.log('Multiple campaigns found, user needs to select one');
          }
        } else {
          console.log('No campaigns found');
        }
      } else {
        console.error('Failed to fetch campaigns list:', response.status);
      }
    } catch (error) {
      console.error('Error checking for existing campaigns:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCampaign = async (id: string) => {
    setIsLoading(true);
    try {
      // Always set the campaign ID from URL params first
      console.log('Setting campaign ID from URL:', id);
      setCampaignId(id);
      
      const response = await fetch(`/api/campaigns?type=campaign&campaignId=${id}`);
      console.log('Campaign API response status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('Campaign data received:', result);
        
        setCampaignData(prev => ({
          ...prev,
          id: result.campaign.id || id,
          name: result.campaign.name || 'Loading...',
          description: result.campaign.description || '',
          timeframe: result.campaign.timeframe || 'quarter',
          startDate: result.campaign.start_date || '',
          endDate: result.campaign.end_date || ''
        }));
        
        console.log('Campaign data set:', {
          name: result.campaign.name,
          description: result.campaign.description,
          startDate: result.campaign.start_date,
          endDate: result.campaign.end_date
        });
        
        // Check if 12-week plan exists
        await checkExistingPlan(id);

        // Load goals
        const goalsResponse = await fetch(`/api/campaigns?type=goals&campaignId=${id}`);
        if (goalsResponse.ok) {
          const goalsResult = await goalsResponse.json();
          setCampaignData(prev => ({
            ...prev,
            goals: goalsResult.goals.map((goal: any) => ({
              id: goal.id,
              contentType: goal.contentType,
              quantity: goal.quantity.toString(),
              platform: goal.platform,
              timeline: goal.frequency,
              priority: 'medium'
            }))
          }));
        }
      }
      } catch (error) {
        console.error('Error loading campaign:', error);
        // Set basic campaign data even if API fails
        setCampaignData(prev => ({
          ...prev,
          id: id,
          name: 'Campaign ' + id,
          description: '',
          timeframe: 'quarter',
          startDate: '',
          endDate: ''
        }));
      } finally {
        setIsLoading(false);
      }
    };

  const contentTypes = [
    { value: 'article', label: 'Article', icon: FileText, color: 'from-blue-500 to-cyan-600' },
    { value: 'video', label: 'Video', icon: Video, color: 'from-purple-500 to-violet-600' },
    { value: 'image', label: 'Image Post', icon: Image, color: 'from-green-500 to-emerald-600' },
    { value: 'podcast', label: 'Podcast', icon: Mic, color: 'from-orange-500 to-red-600' },
    { value: 'infographic', label: 'Infographic', icon: TrendingUp, color: 'from-pink-500 to-rose-600' }
  ];

  const platforms = [
    { value: 'linkedin', label: 'LinkedIn', color: 'bg-blue-600' },
    { value: 'twitter', label: 'Twitter', color: 'bg-sky-500' },
    { value: 'instagram', label: 'Instagram', color: 'bg-pink-500' },
    { value: 'youtube', label: 'YouTube', color: 'bg-red-600' },
    { value: 'facebook', label: 'Facebook', color: 'bg-blue-700' },
    { value: 'tiktok', label: 'TikTok', color: 'bg-black' }
  ];

  const priorities = [
    { value: 'high', label: 'High', color: 'from-red-500 to-pink-600' },
    { value: 'medium', label: 'Medium', color: 'from-yellow-500 to-orange-600' },
    { value: 'low', label: 'Low', color: 'from-green-500 to-emerald-600' }
  ];

  const addGoal = async () => {
    if (newGoal.contentType && newGoal.quantity && newGoal.platform && newGoal.timeline && campaignId) {
      try {
        const response = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'goal',
            data: {
              campaignId,
              contentType: newGoal.contentType,
              platform: newGoal.platform,
              quantity: parseInt(newGoal.quantity),
              frequency: newGoal.timeline,
              targetAudience: 'General',
              objectives: ['Engagement', 'Reach'],
              metrics: {
                engagement: 0,
                reach: 0,
                conversions: 0
              }
            }
          })
        });

        if (response.ok) {
          const result = await response.json();
          setCampaignData({
            ...campaignData,
            goals: [...campaignData.goals, { ...newGoal, id: result.goal.id }]
          });
          setNewGoal({
            contentType: '',
            quantity: '',
            platform: '',
            timeline: '',
            priority: 'medium'
          });
        }
      } catch (error) {
        console.error('Error adding goal:', error);
      }
    }
  };

  const removeGoal = async (id: number) => {
    try {
      const response = await fetch('/api/campaigns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'goal',
          id: id.toString()
        })
      });

      if (response.ok) {
        setCampaignData({
          ...campaignData,
          goals: campaignData.goals.filter(goal => goal.id !== id)
        });
      }
    } catch (error) {
      console.error('Error removing goal:', error);
    }
  };

  const saveCampaign = async () => {
    if (!campaignId) return;
    
    try {
      const response = await fetch('/api/campaigns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'campaign',
          data: {
            id: campaignId,
            name: campaignData.name,
            description: campaignData.description,
            timeframe: campaignData.timeframe,
            startDate: campaignData.startDate,
            endDate: campaignData.endDate
          }
        })
      });

      if (response.ok) {
        console.log('Campaign saved successfully');
      }
    } catch (error) {
      console.error('Error saving campaign:', error);
    }
  };

  const continueToMarketAnalysis = async () => {
    if (!campaignId) return;
    
    // Save campaign data first
    await saveCampaign();
    
    // Transition to market analysis stage
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'stage-transition',
          data: {
            campaignId,
            fromStage: 'planning',
            toStage: 'market-analysis',
            stageData: {
              goals: campaignData.goals,
              campaignDetails: campaignData,
              aiProgram
            }
          }
        })
      });

      if (response.ok) {
        // Navigate to market analysis with campaign ID
        window.location.href = `/market-analysis?campaignId=${campaignId}`;
      }
    } catch (error) {
      console.error('Error transitioning stage:', error);
    }
  };

  const captureAIProgram = (programData: any) => {
    setAiProgram(programData);
    setShowProgramCapture(true);
  };

  const organizeProgramIntoGoals = () => {
    if (!aiProgram) return;

    // Convert AI program into structured goals
    const goals = [];
    
    // Parse 12-week program structure
    if (aiProgram.weeks) {
      aiProgram.weeks.forEach((week: any, index: number) => {
        if (week.content) {
          week.content.forEach((content: any) => {
            goals.push({
              contentType: content.type || 'post',
              quantity: '1',
              platform: content.platform || 'linkedin',
              timeline: `Week ${index + 1}`,
              priority: content.priority || 'medium',
              description: content.description || content.topic || '',
              aiGenerated: true,
              weekNumber: index + 1
            });
          });
        }
      });
    }

    // Add goals to campaign
    goals.forEach(goal => {
      setNewGoal(goal);
      addGoal();
    });

    setShowProgramCapture(false);
  };

  const calculateWeekDates = (startDate: string, weekNumber: number) => {
    const start = new Date(startDate);
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + (weekNumber - 1) * 7);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    return {
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0],
      startFormatted: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      endFormatted: weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    };
  };

  const openDailyPlanning = (week: any) => {
    setSelectedWeek(week);
    setShowDailyPlanning(true);
  };

  const saveDailyPlan = async (weekData: any) => {
    if (!campaignId) return;
    
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'daily-plan',
          data: {
            campaignId,
            weekNumber: weekData.weekNumber,
            weekDates: calculateWeekDates(programStartDate, weekData.weekNumber),
            dailyActivities: weekData.dailyActivities,
            programStartDate
          }
        })
      });

      if (response.ok) {
        setShowDailyPlanning(false);
        // Update the week in aiProgram to show it's planned
        setAiProgram(prev => ({
          ...prev,
          weeks: prev.weeks.map((w: any) => 
            w.weekNumber === weekData.weekNumber 
              ? { ...w, dailyPlanned: true, dailyActivities: weekData.dailyActivities }
              : w
          )
        }));
      }
    } catch (error) {
      console.error('Error saving daily plan:', error);
    }
  };

  const getContentTypeIcon = (type: string) => {
    const contentType = contentTypes.find(ct => ct.value === type);
    return contentType ? contentType.icon : FileText;
  };

  const getContentTypeColor = (type: string) => {
    const contentType = contentTypes.find(ct => ct.value === type);
    return contentType ? contentType.color : 'from-gray-500 to-slate-600';
  };

  const getPlatformColor = (platform: string) => {
    const platformData = platforms.find(p => p.value === platform);
    return platformData ? platformData.color : 'bg-gray-500';
  };

  const getPriorityColor = (priority: string) => {
    const priorityData = priorities.find(p => p.value === priority);
    return priorityData ? priorityData.color : 'from-gray-500 to-slate-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = '/'}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Campaign Planning
                </h1>
                <p className="text-gray-600 mt-1">Define your campaign structure and content goals</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                // Check if we're on the client side before accessing window
                if (typeof window === 'undefined') {
                  // Server-side rendering - show create button by default
                  return (
                    <button 
                      onClick={createNewCampaign}
                      disabled={isLoading}
                      className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                    >
                      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                      Create New Campaign
                    </button>
                  );
                }

                const urlParams = new URLSearchParams(window.location.search);
                const mode = urlParams.get('mode');
                
                if (mode === 'create') {
                  // Create mode buttons
                  return (
                    <>
                      <button 
                        onClick={createNewCampaign}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                      >
                        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                        Create New Campaign
                      </button>
                      
                      {campaignId && (
                        <>
                          <button 
                            onClick={saveCampaign}
                            disabled={isLoading}
                            className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors disabled:opacity-50"
                          >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Draft'}
                          </button>
                          
                          <button 
                            onClick={generate12WeekPlan}
                            disabled={isLoading}
                            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors shadow-md flex items-center gap-2"
                          >
                            <Calendar className="h-4 w-4" />
                            Generate 12-Week Plan
                          </button>
                          
                          <button 
                            onClick={() => window.location.href = `/campaign-details/${campaignId}`}
                            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                          >
                            <Target className="h-5 w-5" />
                            View Campaign Details
                          </button>
                        </>
                      )}
                    </>
                  );
                } else if (mode === 'edit') {
                  // Edit mode buttons
                  return (
                    <>
                      <button 
                        onClick={saveCampaign}
                        disabled={isLoading}
                        className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors disabled:opacity-50"
                      >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
                      </button>
                      
                      <button 
                        onClick={() => window.location.href = `/campaign-details/${campaignId}`}
                        className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors shadow-md flex items-center gap-2"
                      >
                        <Calendar className="h-4 w-4" />
                        View 12-Week Plan
                      </button>
                      
                      <button 
                        onClick={() => window.location.href = '/campaigns'}
                        className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
                      >
                        Back to Campaigns
                      </button>
                    </>
                  );
                } else {
                  // Default mode - show create button
                  return (
                    <button 
                      onClick={createNewCampaign}
                      disabled={isLoading}
                      className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                    >
                      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                      Create New Campaign
                    </button>
                  );
                }
              })()}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Campaign Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg">
                  <Target className="h-6 w-6 text-white" />
                </div>
                Campaign Details
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Name</label>
                  <input
                    type="text"
                    value={campaignData.name}
                    onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    placeholder="Enter campaign name"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Timeframe</label>
                  <select
                    value={campaignData.timeframe}
                    onChange={(e) => setCampaignData({ ...campaignData, timeframe: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  >
                    <option value="week">1 Week</option>
                    <option value="month">1 Month</option>
                    <option value="quarter">1 Quarter</option>
                    <option value="year">1 Year</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={campaignData.startDate}
                    onChange={(e) => setCampaignData({ ...campaignData, startDate: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                  <input
                    type="date"
                    value={campaignData.endDate}
                    onChange={(e) => setCampaignData({ ...campaignData, endDate: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
              
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={campaignData.description}
                  onChange={(e) => setCampaignData({ ...campaignData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                  placeholder="Describe your campaign objectives and strategy"
                />
              </div>
            </div>

                {/* AI Program Capture Section */}
                {aiProgram && (
                  <div className="bg-gradient-to-br from-purple-100/80 via-indigo-100/80 to-blue-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-purple-300/50 p-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                      <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg">
                        <Target className="h-6 w-6 text-white" />
                      </div>
                      AI-Generated 12-Week Program
                    </h2>
                    
                    <div className="bg-white/70 backdrop-blur-sm rounded-xl p-6 border border-gray-200/50 mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Program Overview</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">12</div>
                          <div className="text-sm opacity-90">Weeks</div>
                        </div>
                        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">{aiProgram.totalContent || '0'}</div>
                          <div className="text-sm opacity-90">Content Pieces</div>
                        </div>
                        <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white p-4 rounded-lg">
                          <div className="text-2xl font-bold">{aiProgram.platforms?.length || '0'}</div>
                          <div className="text-sm opacity-90">Platforms</div>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-600">Program Description</label>
                          <div className="text-gray-800 mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {aiProgram.description || 'AI-generated 12-week content program'}
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-600">Target Platforms</label>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {(aiProgram.platforms || ['LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok']).map((platform: string) => (
                              <span key={platform} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                                {platform}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Weekly Breakdown */}
                    {aiProgram.weeks && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900">Weekly Breakdown</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {aiProgram.weeks.slice(0, 12).map((week: any, index: number) => (
                            <div 
                              key={index} 
                              onClick={() => openDailyPlanning(week)}
                              className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50 hover:shadow-lg hover:border-purple-300 cursor-pointer transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-gray-900">Week {week.weekNumber}</h4>
                                <div className="flex items-center gap-2">
                                  {week.dailyPlanned && (
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                  )}
                                  <span className="text-sm text-gray-500">{week.theme || 'Content Week'}</span>
                                </div>
                              </div>
                              
                              {/* Show actual dates if available */}
                              {week.dates && (
                                <div className="text-xs text-gray-600 mb-3 bg-gray-100 px-2 py-1 rounded">
                                  {week.dates.startFormatted} - {week.dates.endFormatted}
                                </div>
                              )}
                              
                              <div className="space-y-2">
                                {week.content?.slice(0, 3).map((content: any, contentIndex: number) => (
                                  <div key={contentIndex} className="flex items-center gap-2 text-sm">
                                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                                    <span className="text-gray-700">{content.type || 'Post'}</span>
                                    <span className="text-gray-500">•</span>
                                    <span className="text-gray-600">{content.platform || 'LinkedIn'}</span>
                                  </div>
                                ))}
                                {week.content?.length > 3 && (
                                  <div className="text-xs text-gray-500">+{week.content.length - 3} more</div>
                                )}
                              </div>
                              
                              {/* Click indicator */}
                              <div className="mt-3 text-xs text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                Click to plan daily activities →
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-4 mt-6">
                      <button
                        onClick={organizeProgramIntoGoals}
                        className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
                      >
                        <CheckCircle className="h-5 w-5" />
                        Organize into Goals
                      </button>
                      <button
                        onClick={() => setShowProgramCapture(false)}
                        className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200"
                      >
                        Edit Program
                      </button>
                    </div>
                  </div>
                )}

                {/* View 12-Week Plan Button */}
                <div className="bg-gradient-to-br from-blue-100/80 via-indigo-100/80 to-purple-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-300/50 p-6 mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg">
                      <Calendar className="h-6 w-6 text-white" />
                    </div>
                    12-Week Plan Management
                  </h2>
                  
                  {/* Plan Description */}
                  {planDescription ? (
                    <div className="bg-white/60 backdrop-blur-sm rounded-xl p-4 mb-6 border border-blue-200/50">
                      <h3 className="font-semibold text-gray-800 mb-3">Current Plan Description:</h3>
                      <div className="text-gray-700 text-sm leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap">
                        {planDescription.split('\n').map((line, index) => {
                          if (line.startsWith('**') && line.endsWith('**')) {
                            return (
                              <div key={index} className="font-semibold text-gray-800 mt-3 mb-2">
                                {line.replace(/\*\*/g, '')}
                              </div>
                            );
                          } else if (line.startsWith('•')) {
                            return (
                              <div key={index} className="ml-4 mb-1">
                                {line}
                              </div>
                            );
                          } else if (line.trim() === '') {
                            return <div key={index} className="mb-2"></div>;
                          } else {
                            return (
                              <div key={index} className="mb-1">
                                {line}
                              </div>
                            );
                          }
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-yellow-50/80 backdrop-blur-sm rounded-xl p-4 mb-6 border border-yellow-200/50">
                      <p className="text-yellow-800 text-sm">
                        <strong>No 12-week plan created yet.</strong> Generate a comprehensive content plan to get started.
                      </p>
                    </div>
                  )}
                  
                  <p className="text-gray-700 mb-6">
                    {hasExistingPlan 
                      ? 'Manage your existing 12-week content plan with AI-powered refinements and amendments.'
                      : 'Create a comprehensive 12-week content plan with AI-powered suggestions and optimizations.'
                    }
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                      <button
                        onClick={async () => {
                            if (campaignId) {
                              window.location.href = `/campaign-planning-hierarchical?campaignId=${campaignId}`;
                            } else {
                              // Try to load existing campaign first
                              await loadExistingCampaign();
                              if (campaignId) {
                                window.location.href = `/campaign-planning-hierarchical?campaignId=${campaignId}`;
                              } else {
                                alert('Please create a campaign first');
                              }
                            }
                          }}
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
                        >
                          <Calendar className="h-6 w-6" />
                          View 12-Week Plan
                        </button>
                    
                    <button
                      onClick={() => setIsChatOpen(true)}
                      className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-3"
                    >
                      <Sparkles className="h-6 w-6" />
                      {hasExistingPlan ? 'Edit 12 Week Plan' : 'Generate New Plan'}
                      </button>
                  </div>
                </div>

            {/* Content Goals Table */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
                Content Goals
              </h2>

              {/* Add New Goal Form */}
              <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-200/50 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Goal</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                    <select
                      value={newGoal.contentType}
                      onChange={(e) => setNewGoal({ ...newGoal, contentType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="">Select Type</option>
                      {contentTypes.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                    <input
                      type="number"
                      value={newGoal.quantity}
                      onChange={(e) => setNewGoal({ ...newGoal, quantity: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                      placeholder="10"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
                    <select
                      value={newGoal.platform}
                      onChange={(e) => setNewGoal({ ...newGoal, platform: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                    >
                      <option value="">Select Platform</option>
                      {platforms.map((platform) => (
                        <option key={platform.value} value={platform.value}>{platform.label}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Timeline</label>
                    <input
                      type="text"
                      value={newGoal.timeline}
                      onChange={(e) => setNewGoal({ ...newGoal, timeline: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
                      placeholder="Week 1-2"
                    />
                  </div>
                  
                  <div className="flex items-end">
                    <button
                      onClick={addGoal}
                      className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-4 py-2 rounded-lg font-medium shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Goals Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Content Type</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Quantity</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Platform</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Timeline</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Priority</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignData.goals.map((goal) => {
                      const Icon = getContentTypeIcon(goal.contentType);
                      return (
                        <tr key={goal.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg bg-gradient-to-r ${getContentTypeColor(goal.contentType)}`}>
                                <Icon className="h-4 w-4 text-white" />
                              </div>
                              <span className="font-medium text-gray-900 capitalize">{goal.contentType}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className="font-semibold text-gray-900">{goal.quantity}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium text-white ${getPlatformColor(goal.platform)}`}>
                              {goal.platform.charAt(0).toUpperCase() + goal.platform.slice(1)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-gray-700">{goal.timeline}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${getPriorityColor(goal.priority)} text-white`}>
                              {goal.priority.charAt(0).toUpperCase() + goal.priority.slice(1)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <button
                              onClick={() => removeGoal(goal.id)}
                              className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                
                {campaignData.goals.length === 0 && (
                  <div className="text-center py-12">
                    <div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                      <Target className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Goals Added Yet</h3>
                    <p className="text-gray-600">Add your first content goal to get started with campaign planning</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Content Integration Section */}
          {campaignId && aiProgram && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">AI Content Integration</h2>
                    <p className="text-orange-100 mt-1">Convert AI suggestions into weekly content plans</p>
                  </div>
                  <Sparkles className="h-8 w-8 text-orange-200" />
                </div>
              </div>
              
              <div className="p-6">
                <AIContentIntegration 
                  campaignId={campaignId}
                  aiContent={aiProgram}
                  onContentIntegrated={(weekNumber, content) => {
                    console.log(`Week ${weekNumber} content integrated:`, content);
                    // Optionally refresh the page or show success message
                  }}
                />
              </div>
            </div>
          )}

          {/* Enhanced Planning Interface */}
          {campaignId && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 overflow-hidden">
              <div className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Enhanced Campaign Planning</h2>
                    <p className="text-purple-100 mt-1">Create content and capture voice notes during planning</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mic className="h-6 w-6 text-purple-200" />
                    <FileText className="h-6 w-6 text-purple-200" />
                  </div>
                </div>
              </div>
              
              {/* Planning Tabs */}
              <div className="p-6">
                <div className="flex space-x-1 bg-gray-100 rounded-lg p-1 mb-6">
                  {[
                  { id: 'overview', label: 'Campaign Overview', icon: Target },
                  { id: 'content', label: 'Content Creation', icon: FileText },
                  { id: 'voice', label: 'Voice Notes', icon: Mic },
                  { id: 'refinement', label: 'Weekly Refinement', icon: Edit3 }
                  ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActivePlanningTab(tab.id as any)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                          activePlanningTab === tab.id
                            ? 'bg-white text-purple-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Tab Content */}
                {activePlanningTab === 'overview' && (
                  <div className="space-y-4">
                    <div className="text-center py-8">
                      <Target className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">Campaign Overview</h3>
                      <p className="text-gray-600 mb-6">Your campaign planning overview and weekly breakdown</p>
                      
                      {/* Action Buttons */}
                      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
                        <button
                          onClick={() => setActivePlanningTab('refinement')}
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                        >
                          <Calendar className="h-5 w-5" />
                          View 12-Week Plan
                        </button>
                        
                        <button
                          onClick={() => setIsChatOpen(true)}
                          className="bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105"
                        >
                          <Sparkles className="h-5 w-5" />
                          Generate New Plan
                        </button>
                      </div>

                      {/* Feature Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">12-Week Plan</h4>
                          <p className="text-sm text-blue-100">AI-generated strategic roadmap</p>
                        </div>
                        <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">Content Strategy</h4>
                          <p className="text-sm text-green-100">Platform-specific content plans</p>
                        </div>
                        <div className="bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg p-4 text-white">
                          <h4 className="font-semibold mb-2">AI Enhancement</h4>
                          <p className="text-sm text-purple-100">Smart suggestions and optimization</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activePlanningTab === 'content' && (
                  <ContentCreationPanel
                    context="campaign"
                    campaignId={campaignId}
                    onContentSave={(content) => {
                      console.log('Campaign content saved:', content);
                    }}
                  />
                )}

                {activePlanningTab === 'voice' && (
                  <VoiceNotesComponent
                    context="campaign"
                    campaignId={campaignId}
                    onTranscriptionComplete={(transcription) => {
                      console.log('Voice transcription completed:', transcription);
                    }}
                    onSuggestionApply={(suggestion) => {
                      console.log('Voice suggestion applied:', suggestion);
                    }}
                  />
                )}

                {activePlanningTab === 'refinement' && (
                  <WeeklyRefinementInterface
                    campaignId={campaignId}
                    campaignData={campaignData}
                    onWeekSelect={(weekNumber) => {
                      console.log('Week selected for refinement:', weekNumber);
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* AI Chat Sidebar */}
          <div className="space-y-6">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg">
                  <Users className="h-5 w-5 text-white" />
                </div>
                AI Assistant
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Get AI suggestions for your campaign goals and content strategy
              </p>
              <div className="space-y-3">
              <button 
                onClick={() => {
                  console.log('Campaign Planning AI Chat button clicked!');
                  // Generate new campaign ID if not exists
                  if (!campaignId) {
                    const newCampaignId = 'campaign-' + Date.now();
                    console.log('User initiated campaign creation:', newCampaignId);
                    setCampaignId(newCampaignId);
                    
                    // Update campaign data with new ID
                    setCampaignData(prev => ({
                      ...prev,
                      id: newCampaignId,
                      name: prev.name || 'New Campaign'
                    }));
                    
                    // DO NOT update URL to prevent loops
                  }
                  setIsChatOpen(true);
                }}
                className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                style={{ pointerEvents: 'auto', zIndex: 10 }}
              >
                Start AI Chat {!campaignId && <Sparkles className="w-4 h-4 ml-2 inline" />}
              </button>
                
                {campaignId && (
                  <button 
                    onClick={() => {
                      window.location.href = `/campaign-planning-hierarchical?campaignId=${campaignId}`;
                    }}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Calendar className="w-4 h-4" />
                    View 12-Week Plan
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                Campaign Summary
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Goals:</span>
                  <span className="font-semibold text-gray-900">{campaignData.goals.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Content Types:</span>
                  <span className="font-semibold text-gray-900">
                    {[...new Set(campaignData.goals.map(g => g.contentType))].length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Platforms:</span>
                  <span className="font-semibold text-gray-900">
                    {[...new Set(campaignData.goals.map(g => g.platform))].length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Content:</span>
                  <span className="font-semibold text-gray-900">
                    {campaignData.goals.reduce((sum, goal) => sum + parseInt(goal.quantity || '0'), 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

          {/* Campaign-Specific AI Chat Modal */}
          <CampaignAIChat 
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onMinimize={() => setIsChatOpen(false)}
            context="campaign-planning"
            campaignId={campaignId}
            campaignData={campaignData}
            onProgramGenerated={captureAIProgram}
          />

          {/* Daily Planning Modal */}
          {showDailyPlanning && selectedWeek && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold">Daily Planning - Week {selectedWeek.weekNumber}</h2>
                      <p className="text-purple-100 mt-1">
                        {selectedWeek.dates?.startFormatted} - {selectedWeek.dates?.endFormatted}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowDailyPlanning(false)}
                      className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                </div>

                <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                  <DailyPlanningInterface 
                    week={selectedWeek}
                    onSave={saveDailyPlan}
                    campaignId={campaignId}
                    campaignData={campaignData}
                  />
                </div>
              </div>
            </div>
          )}
    </div>
  );
}
