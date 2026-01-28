import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  TrendingUp, 
  Search, 
  Users, 
  Target, 
  BarChart3, 
  MessageCircle, 
  Send, 
  Mic, 
  MicOff,
  Upload,
  FileText,
  Image,
  Video,
  Link,
  CheckCircle,
  AlertCircle,
  Clock,
  Eye,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Filter,
  Download,
  Share2,
  Loader2
} from 'lucide-react';
import CampaignAIChat from '../components/CampaignAIChat';

export default function MarketAnalysis() {
  const [activeTab, setActiveTab] = useState('trends');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignData, setCampaignData] = useState<any>(null);
  const [marketAnalysis, setMarketAnalysis] = useState<any>(null);

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

      // Load market analysis if exists
      const analysisResponse = await fetch(`/api/campaigns?type=market-analysis&campaignId=${id}`);
      if (analysisResponse.ok) {
        const analysisResult = await analysisResponse.json();
        setMarketAnalysis(analysisResult.analysis);
      }
    } catch (error) {
      console.error('Error loading campaign data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runMarketAnalysis = async () => {
    if (!campaignId) return;
    
    setIsAnalyzing(true);
    try {
      // Simulate market analysis API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const analysisData = {
        campaignId,
        trends: [
          {
            topic: "AI Content Creation",
            trend: "rising",
            growth: "+45%",
            platforms: ["LinkedIn", "Twitter", "YouTube"],
            engagement: "High",
            relevance: "High"
          },
          {
            topic: "Sustainable Business",
            trend: "stable",
            growth: "+12%",
            platforms: ["LinkedIn", "Instagram"],
            engagement: "Medium",
            relevance: "Medium"
          }
        ],
        competitors: [
          {
            name: "TechCorp",
            platform: "LinkedIn",
            followers: "125K",
            engagement: "4.2%",
            contentTypes: ["Articles", "Videos"],
            lastPost: "2 hours ago"
          }
        ],
        opportunities: [
          "AI content creation tools are trending",
          "Video content performs better on LinkedIn",
          "Tuesday-Thursday posting times show higher engagement"
        ],
        insights: [
          "Your target audience is highly engaged with AI-related content",
          "Competitor analysis shows opportunity in thought leadership",
          "Cross-platform content strategy could increase reach by 30%"
        ],
        recommendations: [
          "Focus on AI content creation tutorials",
          "Create video series for LinkedIn",
          "Schedule posts for mid-week optimal times"
        ]
      };

      // Save market analysis
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'market-analysis',
          data: analysisData
        })
      });

      if (response.ok) {
        const result = await response.json();
        setMarketAnalysis(result.analysis);
      }
    } catch (error) {
      console.error('Error running market analysis:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const continueToContentCreation = async () => {
    if (!campaignId) return;
    
    // Transition to content creation stage
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'stage-transition',
          data: {
            campaignId,
            fromStage: 'market-analysis',
            toStage: 'content-creation',
            stageData: {
              marketAnalysis,
              campaignData
            }
          }
        })
      });

      if (response.ok) {
        // Navigate to content creation with campaign ID
        window.location.href = `/content-creation?campaignId=${campaignId}`;
      }
    } catch (error) {
      console.error('Error transitioning stage:', error);
    }
  };

  // Sample market data - will be populated from real API data
  const trendingTopics = [
    {
      id: 1,
      topic: "AI Content Creation",
      trend: "rising",
      growth: "+0%",
      platforms: ["LinkedIn", "Twitter", "YouTube"],
      engagement: "Low",
      color: "from-blue-500 to-cyan-600"
    },
    {
      id: 2,
      topic: "Sustainable Business",
      trend: "stable",
      growth: "+0%",
      platforms: ["Instagram", "Facebook"],
      engagement: "Low",
      color: "from-green-500 to-emerald-600"
    },
    {
      id: 3,
      topic: "Remote Work Tips",
      trend: "falling",
      growth: "0%",
      platforms: ["LinkedIn", "Twitter"],
      engagement: "Low",
      color: "from-red-500 to-pink-600"
    },
    {
      id: 4,
      topic: "Digital Marketing",
      trend: "rising",
      growth: "+0%",
      platforms: ["YouTube", "LinkedIn", "Twitter"],
      engagement: "Low",
      color: "from-purple-500 to-violet-600"
    }
  ];

  const competitorAnalysis = [
    {
      id: 1,
      name: "TechCorp",
      platform: "LinkedIn",
      followers: "0",
      engagement: "0%",
      topContent: "No data yet",
      lastPost: "No recent posts",
      color: "from-blue-500 to-cyan-600"
    },
    {
      id: 2,
      name: "InnovateNow",
      platform: "Twitter",
      followers: "0",
      engagement: "0%",
      topContent: "No data yet",
      lastPost: "No recent posts",
      color: "from-green-500 to-emerald-600"
    },
    {
      id: 3,
      name: "FutureBrand",
      platform: "Instagram",
      followers: "0",
      engagement: "0%",
      topContent: "No data yet",
      lastPost: "No recent posts",
      color: "from-purple-500 to-violet-600"
    }
  ];

  const audienceInsights = [
    {
      id: 1,
      segment: "Tech Professionals",
      size: "0%",
      interests: ["No data yet"],
      platforms: ["No data yet"],
      color: "from-blue-500 to-cyan-600"
    },
    {
      id: 2,
      segment: "Marketing Managers",
      size: "0%",
      interests: ["No data yet"],
      platforms: ["No data yet"],
      color: "from-green-500 to-emerald-600"
    },
    {
      id: 3,
      segment: "Entrepreneurs",
      size: "0%",
      interests: ["No data yet"],
      platforms: ["No data yet"],
      color: "from-purple-500 to-violet-600"
    }
  ];

  const startAnalysis = () => {
    setIsAnalyzing(true);
    setTimeout(() => {
      setIsAnalyzing(false);
    }, 3000);
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'rising': return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'falling': return <TrendingUp className="h-4 w-4 text-red-600 rotate-180" />;
      case 'stable': return <BarChart3 className="h-4 w-4 text-yellow-600" />;
      default: return <BarChart3 className="h-4 w-4 text-gray-600" />;
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'rising': return 'text-green-600 bg-green-100';
      case 'falling': return 'text-red-600 bg-red-100';
      case 'stable': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-purple-100 to-indigo-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-200/90 via-purple-200/90 to-indigo-200/90 backdrop-blur-sm border-b border-purple-300/50 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = `/campaign-planning?campaignId=${campaignId}`}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Market Analysis
                </h1>
                <p className="text-gray-600 mt-1">Analyze trends, competitors, and audience insights</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={startAnalysis}
                disabled={isAnalyzing}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Search className="h-5 w-5" />
                    Analyze Market
                  </>
                )}
              </button>
              <button 
                onClick={continueToContentCreation}
                disabled={isLoading || !campaignId}
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
              >
                <Target className="h-5 w-5" />
                Continue to Content Creation
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Navigation Tabs */}
            <div className="flex space-x-1 bg-gradient-to-r from-pink-200/60 via-purple-200/60 to-indigo-200/60 backdrop-blur-sm rounded-xl p-1 shadow-lg border border-purple-300/50">
              {[
                { id: 'trends', label: 'Trending Topics', icon: TrendingUp },
                { id: 'competitors', label: 'Competitors', icon: Target },
                { id: 'audience', label: 'Audience Insights', icon: Users }
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      activeTab === tab.id
                        ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white shadow-lg'
                        : 'text-purple-700 hover:text-purple-900 hover:bg-white/70'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Trending Topics */}
            {activeTab === 'trends' && (
              <div className="bg-gradient-to-br from-pink-100/80 via-purple-100/80 to-indigo-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-purple-300/50 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg">
                      <TrendingUp className="h-6 w-6 text-white" />
                    </div>
                    Trending Topics
                  </h2>
                  <div className="flex items-center gap-2">
                    <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                      <Filter className="h-4 w-4 text-gray-600" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                      <Download className="h-4 w-4 text-gray-600" />
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {trendingTopics.map((topic) => (
                    <div key={topic.id} className="bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50 rounded-xl p-6 border border-purple-200/50 hover:shadow-lg hover:scale-105 transition-all duration-300">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900">{topic.topic}</h3>
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${getTrendColor(topic.trend)}`}>
                          {getTrendIcon(topic.trend)}
                          <span className="ml-1">{topic.trend}</span>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Growth:</span>
                          <span className={`font-semibold ${topic.growth.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                            {topic.growth}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Engagement:</span>
                          <span className="font-semibold text-gray-900">{topic.engagement}</span>
                        </div>
                        
                        <div>
                          <span className="text-sm text-gray-600">Platforms:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {topic.platforms.map((platform) => (
                              <span key={platform} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md">
                                {platform}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Competitor Analysis */}
            {activeTab === 'competitors' && (
              <div className="bg-gradient-to-br from-blue-100/80 via-cyan-100/80 to-teal-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-blue-300/50 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg">
                      <Target className="h-6 w-6 text-white" />
                    </div>
                    Competitor Analysis
                  </h2>
                  <button className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-2">
                    <Share2 className="h-4 w-4" />
                    Export Report
                  </button>
                </div>
                
                <div className="space-y-4">
                  {competitorAnalysis.map((competitor) => (
                    <div key={competitor.id} className="bg-gradient-to-br from-blue-50 via-cyan-50 to-teal-50 rounded-xl p-6 border border-blue-200/50 hover:shadow-lg hover:scale-105 transition-all duration-300">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg bg-gradient-to-r ${competitor.color}`}>
                            <Users className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{competitor.name}</h3>
                            <p className="text-sm text-gray-600">{competitor.platform}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Last Post</p>
                          <p className="font-semibold text-gray-900">{competitor.lastPost}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <span className="text-sm text-gray-600">Followers:</span>
                          <p className="font-semibold text-gray-900">{competitor.followers}</p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600">Engagement:</span>
                          <p className="font-semibold text-gray-900">{competitor.engagement}</p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600">Top Content:</span>
                          <p className="font-semibold text-gray-900">{competitor.topContent}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audience Insights */}
            {activeTab === 'audience' && (
              <div className="bg-gradient-to-br from-emerald-100/80 via-green-100/80 to-lime-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-emerald-300/50 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg">
                      <Users className="h-6 w-6 text-white" />
                    </div>
                    Audience Insights
                  </h2>
                  <button className="text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    View Analytics
                  </button>
                </div>
                
                <div className="space-y-4">
                  {audienceInsights.map((segment) => (
                    <div key={segment.id} className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-200/50 hover:shadow-md transition-all duration-200">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg bg-gradient-to-r ${segment.color}`}>
                            <Users className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{segment.segment}</h3>
                            <p className="text-sm text-gray-600">Audience Size: {segment.size}</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <span className="text-sm text-gray-600">Interests:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {segment.interests.map((interest) => (
                              <span key={interest} className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded-md">
                                {interest}
                              </span>
                            ))}
                          </div>
                        </div>
                        
                        <div>
                          <span className="text-sm text-gray-600">Active Platforms:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {segment.platforms.map((platform) => (
                              <span key={platform} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md">
                                {platform}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI Chat Sidebar */}
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-purple-100/80 via-violet-100/80 to-indigo-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-purple-300/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg">
                  <MessageCircle className="h-5 w-5 text-white" />
                </div>
                AI Market Analyst
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Get AI suggestions for market analysis and competitor insights
              </p>
              <button 
                onClick={() => {
                  console.log('Button clicked!');
                  setIsChatOpen(true);
                }}
                className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                style={{ pointerEvents: 'auto', zIndex: 10 }}
              >
                Start AI Chat
              </button>
            </div>

            {/* Quick Actions */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <button className="w-full bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Analyze Trends
                </button>
                <button className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2">
                  <Target className="h-4 w-4" />
                  Competitor Research
                </button>
                <button className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2">
                  <Users className="h-4 w-4" />
                  Audience Analysis
                </button>
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
        context="market-analysis"
        campaignId={campaignId}
        campaignData={campaignData}
      />
    </div>
  );
}
