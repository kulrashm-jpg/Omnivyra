import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Target, 
  Plus, 
  Edit3, 
  CheckCircle,
  Clock,
  Users,
  Calendar,
  Save,
  Play,
  Loader2,
  FileText,
  Image,
  Video,
  Mic,
  TrendingUp,
  Sparkles,
  Eye,
  Trash2,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import CampaignAIChat from '../components/CampaignAIChat';
import { isCreatorDependentContentType } from '../utils/contentTaxonomy';

export default function ContentCreation() {
  const [activeTab, setActiveTab] = useState('overview');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignData, setCampaignData] = useState<any>(null);
  const [contentPlans, setContentPlans] = useState<any[]>([]);
  const [campaignGoals, setCampaignGoals] = useState<any[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('');
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [expandedContent, setExpandedContent] = useState<{ [key: string]: boolean }>({});

  // Platform-specific content types (creator-dependent only: video, carousel, reel, etc.)
  const platformContentTypesRaw = {
    linkedin: [
      { type: 'article', label: 'Article', icon: FileText, color: 'from-blue-500 to-cyan-600' },
      { type: 'post', label: 'Post', icon: Edit3, color: 'from-blue-600 to-indigo-600' },
      { type: 'video', label: 'Video', icon: Video, color: 'from-purple-500 to-violet-600' },
      { type: 'carousel', label: 'Carousel', icon: Image, color: 'from-green-500 to-emerald-600' },
      { type: 'poll', label: 'Poll', icon: TrendingUp, color: 'from-orange-500 to-red-600' }
    ],
    facebook: [
      { type: 'post', label: 'Post', icon: Edit3, color: 'from-blue-600 to-indigo-600' },
      { type: 'video', label: 'Video', icon: Video, color: 'from-purple-500 to-violet-600' },
      { type: 'story', label: 'Story', icon: Image, color: 'from-pink-500 to-rose-600' },
      { type: 'reel', label: 'Reel', icon: Video, color: 'from-purple-600 to-violet-700' },
      { type: 'event', label: 'Event', icon: Calendar, color: 'from-green-500 to-emerald-600' }
    ],
    instagram: [
      { type: 'post', label: 'Post', icon: Image, color: 'from-pink-500 to-rose-600' },
      { type: 'story', label: 'Story', icon: Image, color: 'from-purple-500 to-violet-600' },
      { type: 'reel', label: 'Reel', icon: Video, color: 'from-orange-500 to-red-600' },
      { type: 'igtv', label: 'IGTV', icon: Video, color: 'from-blue-500 to-cyan-600' },
      { type: 'carousel', label: 'Carousel', icon: Image, color: 'from-green-500 to-emerald-600' }
    ],
    twitter: [
      { type: 'tweet', label: 'Tweet', icon: Edit3, color: 'from-blue-400 to-sky-500' },
      { type: 'thread', label: 'Thread', icon: FileText, color: 'from-blue-500 to-cyan-600' },
      { type: 'video', label: 'Video', icon: Video, color: 'from-purple-500 to-violet-600' },
      { type: 'poll', label: 'Poll', icon: TrendingUp, color: 'from-orange-500 to-red-600' },
      { type: 'space', label: 'Space', icon: Mic, color: 'from-green-500 to-emerald-600' }
    ],
    youtube: [
      { type: 'video', label: 'Video', icon: Video, color: 'from-red-500 to-pink-600' },
      { type: 'short', label: 'Short', icon: Video, color: 'from-red-600 to-rose-600' },
      { type: 'live', label: 'Live', icon: Play, color: 'from-red-700 to-pink-700' },
      { type: 'premiere', label: 'Premiere', icon: Calendar, color: 'from-purple-500 to-violet-600' },
      { type: 'community', label: 'Community Post', icon: Users, color: 'from-blue-500 to-cyan-600' }
    ],
    tiktok: [
      { type: 'video', label: 'Video', icon: Video, color: 'from-black to-gray-800' },
      { type: 'story', label: 'Story', icon: Image, color: 'from-pink-500 to-rose-600' },
      { type: 'live', label: 'Live', icon: Play, color: 'from-red-500 to-pink-600' }
    ]
  };
  const platformContentTypes = Object.fromEntries(
    Object.entries(platformContentTypesRaw).map(([k, arr]) => [
      k,
      arr.filter((t) => isCreatorDependentContentType(t.type)),
    ])
  );

  const platforms = [
    { id: 'linkedin', name: 'LinkedIn', color: 'bg-blue-600', icon: '💼' },
    { id: 'facebook', name: 'Facebook', color: 'bg-blue-700', icon: '👥' },
    { id: 'instagram', name: 'Instagram', color: 'bg-pink-500', icon: '📸' },
    { id: 'twitter', name: 'Twitter', color: 'bg-sky-500', icon: '🐦' },
    { id: 'youtube', name: 'YouTube', color: 'bg-red-600', icon: '📺' },
    { id: 'tiktok', name: 'TikTok', color: 'bg-black', icon: '🎵' }
  ];

  const daysOfWeek = [
    { id: 'monday', name: 'Monday', date: getDateForDay(1) },
    { id: 'tuesday', name: 'Tuesday', date: getDateForDay(2) },
    { id: 'wednesday', name: 'Wednesday', date: getDateForDay(3) },
    { id: 'thursday', name: 'Thursday', date: getDateForDay(4) },
    { id: 'friday', name: 'Friday', date: getDateForDay(5) },
    { id: 'saturday', name: 'Saturday', date: getDateForDay(6) },
    { id: 'sunday', name: 'Sunday', date: getDateForDay(0) }
  ];

  function getDateForDay(dayOfWeek: number): string {
    const today = new Date();
    const currentDay = today.getDay();
    const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntilTarget);
    return targetDate.toISOString().split('T')[0];
  }

  // Initialize campaign data from URL params ONLY if explicitly passed
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const existingCampaignId = urlParams.get('campaignId');
    
    if (existingCampaignId) {
      loadCampaignData(existingCampaignId);
    }
    // Don't generate campaign ID here - only use if passed from campaign flow
  }, []);

  const loadCampaignData = async (id: string) => {
    setIsLoading(true);
    try {
      // Load campaign data
      const campaignResponse = await fetch(`/api/campaigns?type=campaign&campaignId=${id}`);
      if (campaignResponse.ok) {
        const campaignResult = await campaignResponse.json();
        setCampaignData(campaignResult.campaign);
        setCampaignId(id);
      }

      // Load campaign goals
      const goalsResponse = await fetch(`/api/campaigns?type=goals&campaignId=${id}`);
      if (goalsResponse.ok) {
        const goalsResult = await goalsResponse.json();
        setCampaignGoals(goalsResult.goals || []);
      }

      // Load content plans
      const plansResponse = await fetch(`/api/campaigns?type=content-plan&campaignId=${id}`);
      if (plansResponse.ok) {
        const plansResult = await plansResponse.json();
        setContentPlans(plansResult.plans || []);
      }
    } catch (error) {
      console.error('Error loading campaign data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateContentPlan = async (day: string, platform: string, contentType: string) => {
    if (!campaignId) return;
    
    setIsGeneratingContent(true);
    try {
      const response = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          day,
          platform,
          contentType,
          campaignData,
          campaignGoals,
          brandVoice: 'DrishiQ - clarity engine that solves life miseries',
          useAI: true
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        // Create content plan
        const contentPlan = {
          campaignId,
          dayOfWeek: day,
          date: daysOfWeek.find(d => d.id === day)?.date,
          platform,
          contentType,
          topic: result.topic,
          content: result.content.text,
          hashtags: result.content.hashtags,
          status: 'created',
          aiGenerated: result.content.aiGenerated
        };

        // Save to database
        const saveResponse = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'content-plan',
            data: contentPlan
          })
        });

        if (saveResponse.ok) {
          const saveResult = await saveResponse.json();
          setContentPlans(prev => [...prev, saveResult.plan]);
        }
      }
    } catch (error) {
      console.error('Error generating content:', error);
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const updateContentPlan = async (planId: string, updates: any) => {
    try {
      const response = await fetch('/api/campaigns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'content-plan',
          data: { id: planId, ...updates }
        })
      });

      if (response.ok) {
        setContentPlans(prev => 
          prev.map(plan => plan.id === planId ? { ...plan, ...updates } : plan)
        );
      }
    } catch (error) {
      console.error('Error updating content plan:', error);
    }
  };

  const deleteContentPlan = async (planId: string) => {
    try {
      const response = await fetch('/api/campaigns', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'content-plan',
          id: planId
        })
      });

      if (response.ok) {
        setContentPlans(prev => prev.filter(plan => plan.id !== planId));
      }
    } catch (error) {
      console.error('Error deleting content plan:', error);
    }
  };

  const toggleContentExpansion = (planId: string) => {
    setExpandedContent(prev => ({
      ...prev,
      [planId]: !prev[planId]
    }));
  };

  const getContentForDay = (day: string) => {
    return contentPlans.filter(plan => plan.dayOfWeek === day);
  };

  const getContentStats = () => {
    const total = contentPlans.length;
    const completed = contentPlans.filter(plan => plan.status === 'created').length;
    const inProgress = contentPlans.filter(plan => plan.status === 'planned').length;
    const readyToSchedule = contentPlans.filter(plan => plan.status === 'created').length;
    
    return { total, completed, inProgress, readyToSchedule };
  };

  const continueToScheduleReview = async () => {
    if (!campaignId) return;
    
    // Transition to schedule review stage
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'stage-transition',
          data: {
            campaignId,
            fromStage: 'content-creation',
            toStage: 'schedule-review',
            stageData: {
              contentPlans,
              campaignData
            }
          }
        })
      });

      if (response.ok) {
        // Navigate to schedule review with campaign ID
        window.location.href = `/schedule-review?campaignId=${campaignId}`;
      }
    } catch (error) {
      console.error('Error transitioning stage:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-100 via-green-100 to-lime-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-200/90 via-green-200/90 to-lime-200/90 backdrop-blur-sm border-b border-green-300/50 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = `/market-analysis?campaignId=${campaignId}`}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
                  Content Creation
                </h1>
                <p className="text-gray-600 mt-1">Create content day-wise as planned</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors">
                Save Draft
              </button>
              <button 
                onClick={continueToScheduleReview}
                disabled={isLoading || !campaignId}
                className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
              >
                <Save className="h-5 w-5" />
                Continue to Schedule Review
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Day-wise Content Planning */}
            <div className="bg-gradient-to-br from-emerald-100/80 via-green-100/80 to-lime-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-green-300/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-emerald-500 to-green-600 rounded-lg">
                  <Calendar className="h-6 w-6 text-white" />
                </div>
                Day-wise Content Planning
              </h2>
              
              {/* Days Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {daysOfWeek.map((day) => {
                  const dayContent = getContentForDay(day.id);
                  const platform = platforms.find(p => p.id === selectedPlatform);
                  
                  return (
                    <div key={day.id} className="bg-white/70 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50 hover:shadow-lg transition-all duration-200">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-900">{day.name}</h3>
                        <span className="text-sm text-gray-500">{day.date}</span>
                      </div>
                      
                      {/* Content Count */}
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                        <span className="text-sm text-gray-600">{dayContent.length} content pieces</span>
                      </div>
                      
                      {/* Platform Selection */}
                      <div className="mb-3">
                        <select 
                          value={selectedPlatform}
                          onChange={(e) => setSelectedPlatform(e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white/80"
                        >
                          <option value="">Select Platform</option>
                          {platforms.map(p => (
                            <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* Content Type Selection */}
                      {selectedPlatform && (
                        <div className="mb-3">
                          <select 
                            onChange={(e) => {
                              if (e.target.value) {
                                generateContentPlan(day.id, selectedPlatform, e.target.value);
                                e.target.value = '';
                              }
                            }}
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white/80"
                            disabled={isGeneratingContent}
                          >
                            <option value="">Select Content Type</option>
                            {platformContentTypes[selectedPlatform as keyof typeof platformContentTypes]?.map(type => (
                              <option key={type.type} value={type.type}>{type.label}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      
                      {/* Existing Content */}
                      {dayContent.length > 0 && (
                        <div className="space-y-2">
                          {dayContent.map((content, index) => {
                            const platform = platforms.find(p => p.id === content.platform);
                            const contentType = platformContentTypes[content.platform as keyof typeof platformContentTypes]?.find(t => t.type === content.contentType);
                            const IconComponent = contentType?.icon || Edit3;
                            const isExpanded = expandedContent[content.id];
                            
                            return (
                              <div key={content.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <div className={`p-1 rounded ${platform?.color} text-white text-xs`}>
                                      {platform?.icon}
                                    </div>
                                    <div className={`p-1 rounded bg-gradient-to-r ${contentType?.color} text-white`}>
                                      <IconComponent className="h-3 w-3" />
                                    </div>
                                    <span className="text-sm font-medium text-gray-700">{contentType?.label}</span>
                                    {content.aiGenerated && (
                                      <div className="flex items-center gap-1">
                                        <Sparkles className="h-3 w-3 text-purple-500" />
                                        <span className="text-xs text-purple-600 font-medium">AI</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => toggleContentExpansion(content.id)}
                                      className="p-1 hover:bg-gray-200 rounded"
                                    >
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </button>
                                    <button
                                      onClick={() => deleteContentPlan(content.id)}
                                      className="p-1 hover:bg-red-100 rounded text-red-500"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                                
                                {isExpanded && (
                                  <div className="mt-3 space-y-3">
                                    <div>
                                      <label className="text-xs font-medium text-gray-600">Topic</label>
                                      <input
                                        type="text"
                                        value={content.topic || ''}
                                        onChange={(e) => updateContentPlan(content.id, { topic: e.target.value })}
                                        className="w-full text-sm border border-gray-200 rounded px-2 py-1 mt-1"
                                        placeholder="Enter topic..."
                                      />
                                    </div>
                                    <div>
                                      <label className="text-xs font-medium text-gray-600">Content</label>
                                      <textarea
                                        value={content.content || ''}
                                        onChange={(e) => updateContentPlan(content.id, { content: e.target.value })}
                                        className="w-full text-sm border border-gray-200 rounded px-2 py-1 mt-1 h-20 resize-none"
                                        placeholder="Enter content..."
                                      />
                                    </div>
                                    <div>
                                      <label className="text-xs font-medium text-gray-600">Hashtags</label>
                                      <input
                                        type="text"
                                        value={content.hashtags ? content.hashtags.join(' ') : ''}
                                        onChange={(e) => updateContentPlan(content.id, { hashtags: e.target.value.split(' ').filter(tag => tag.trim()) })}
                                        className="w-full text-sm border border-gray-200 rounded px-2 py-1 mt-1"
                                        placeholder="Enter hashtags separated by spaces..."
                                      />
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <select
                                        value={content.status || 'planned'}
                                        onChange={(e) => updateContentPlan(content.id, { status: e.target.value })}
                                        className="text-xs border border-gray-200 rounded px-2 py-1"
                                      >
                                        <option value="planned">Planned</option>
                                        <option value="created">Created</option>
                                        <option value="reviewed">Reviewed</option>
                                        <option value="scheduled">Scheduled</option>
                                      </select>
                                      <button
                                        onClick={() => updateContentPlan(content.id, { status: 'created' })}
                                        className="text-xs bg-emerald-500 text-white px-2 py-1 rounded hover:bg-emerald-600"
                                      >
                                        <CheckCircle className="h-3 w-3 inline mr-1" />
                                        Mark Ready
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Generate All Content Button */}
              <div className="text-center">
                <button
                  onClick={() => {
                    // Generate content for all days with alternating platforms
                    const platformOrder = ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'tiktok'];
                    daysOfWeek.forEach((day, index) => {
                      const platform = platformOrder[index % platformOrder.length];
                      const contentTypes = platformContentTypes[platform as keyof typeof platformContentTypes];
                      if (contentTypes && contentTypes.length > 0) {
                        generateContentPlan(day.id, platform, contentTypes[0].type);
                      }
                    });
                  }}
                  disabled={isGeneratingContent}
                  className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2 mx-auto"
                >
                  {isGeneratingContent ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Generating Content...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      Generate Weekly Content Plan
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* AI Chat Sidebar */}
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-emerald-100/80 via-green-100/80 to-lime-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-green-300/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-emerald-500 to-green-600 rounded-lg">
                  <Users className="h-5 w-5 text-white" />
                </div>
                AI Content Assistant
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Get AI help for content creation and optimization
              </p>
              <button 
                onClick={() => {
                  console.log('Content Creation AI Chat button clicked!');
                  setIsChatOpen(true);
                }}
                className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                style={{ pointerEvents: 'auto', zIndex: 10 }}
              >
                Start AI Chat
              </button>
            </div>

            <div className="bg-gradient-to-br from-emerald-100/80 via-green-100/80 to-lime-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-green-300/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-emerald-500 to-green-600 rounded-lg">
                  <Users className="h-5 w-5 text-white" />
                </div>
                Team Collaboration
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-lg">👩‍💼</div>
                    <span className="text-sm text-gray-600">Sarah Johnson</span>
                  </div>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Campaign Manager</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-lg">👨‍🎨</div>
                    <span className="text-sm text-gray-600">Mike Chen</span>
                  </div>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Content Creator</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-lg">👩‍💻</div>
                    <span className="text-sm text-gray-600">Emily Rodriguez</span>
                  </div>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Social Specialist</span>
                </div>
              </div>
              <button 
                onClick={() => window.location.href = '/team-management'}
                className="w-full mt-4 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 text-sm"
              >
                Manage Team
              </button>
            </div>

            <div className="bg-gradient-to-br from-emerald-100/80 via-green-100/80 to-lime-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-green-300/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Content Summary</h3>
              <div className="space-y-3">
                {(() => {
                  const stats = getContentStats();
                  return (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Content:</span>
                        <span className="font-semibold text-gray-900">{stats.total}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Completed:</span>
                        <span className="font-semibold text-emerald-600">{stats.completed}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">In Progress:</span>
                        <span className="font-semibold text-yellow-600">{stats.inProgress}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Ready to Schedule:</span>
                        <span className="font-semibold text-blue-600">{stats.readyToSchedule}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
              
              {/* Platform Distribution */}
              <div className="mt-6">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Platform Distribution</h4>
                <div className="space-y-2">
                  {platforms.map(platform => {
                    const platformContent = contentPlans.filter(plan => plan.platform === platform.id);
                    return (
                      <div key={platform.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{platform.icon}</span>
                          <span className="text-sm text-gray-600">{platform.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900">{platformContent.length}</span>
                      </div>
                    );
                  })}
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
        context="content-creation"
        campaignId={campaignId}
        campaignData={campaignData}
      />
    </div>
  );
}
