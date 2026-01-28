import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Calendar, Clock, Send, AlertCircle, CheckCircle, Plus, Settings, Sparkles, Eye, EyeOff, Zap, TrendingUp, Users, BarChart3, Image, Video, FileText, Hash, Globe, Smartphone, Monitor, Wand2, Brain, Rocket, Star, Heart, MessageCircle, Share, Target, Activity, ExternalLink } from "lucide-react";

export default function CreativeScheduler() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [trendingData, setTrendingData] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [isLoadingTrends, setIsLoadingTrends] = useState(true);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [notification, setNotification] = useState<{type: 'success' | 'error', message: string} | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    hashtags: "",
    mediaType: "none",
    platforms: [] as string[],
    scheduledDate: "",
    scheduledTime: "",
  });

  const steps = [
    { id: 0, title: "Inspiration", icon: <Wand2 className="h-6 w-6" />, color: "from-purple-500 to-pink-500" },
    { id: 1, title: "Content", icon: <Brain className="h-6 w-6" />, color: "from-blue-500 to-cyan-500" },
    { id: 2, title: "Platforms", icon: <Rocket className="h-6 w-6" />, color: "from-green-500 to-emerald-500" },
    { id: 3, title: "Schedule", icon: <Clock className="h-6 w-6" />, color: "from-orange-500 to-red-500" },
  ];

  const creativePlatforms = [
    { 
      key: "linkedin", 
      name: "LinkedIn", 
      icon: <Globe className="h-8 w-8" />, 
      gradient: "from-blue-600 to-blue-800",
      bgPattern: "🔗",
      description: "Professional Network",
      stats: { reach: "2.4K", engagement: "8.2%" }
    },
    { 
      key: "twitter", 
      name: "Twitter/X", 
      icon: <Smartphone className="h-8 w-8" />, 
      gradient: "from-sky-500 to-blue-600",
      bgPattern: "🐦",
      description: "Real-time Updates",
      stats: { reach: "1.8K", engagement: "6.7%" }
    },
    { 
      key: "instagram", 
      name: "Instagram", 
      icon: <Image className="h-8 w-8" />, 
      gradient: "from-pink-500 to-purple-600",
      bgPattern: "📸",
      description: "Visual Stories",
      stats: { reach: "3.2K", engagement: "9.1%" }
    },
    { 
      key: "tiktok", 
      name: "TikTok", 
      icon: <Video className="h-8 w-8" />, 
      gradient: "from-black to-gray-800",
      bgPattern: "🎵",
      description: "Viral Content",
      stats: { reach: "5.1K", engagement: "12.3%" }
    },
  ];

  // Load trending data and connected accounts on component mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoadingTrends(true);
        
        // Skip OAuth handling in main data load - handled separately
        
        // Load connected accounts first
        const accountsResponse = await fetch('/api/accounts');
        const accounts = await accountsResponse.json();
        setConnectedAccounts(accounts);
        
        // Get connected platform names
        const connectedPlatforms = accounts
          .filter(account => account.is_active)
          .map(account => account.platform);
        
        // Load trending data with connected platforms
        const trendingResponse = await fetch(`/api/trending/current?platforms=${connectedPlatforms.join(',')}`);
        const trendingResult = await trendingResponse.json();
        
        setTrendingData(trendingResult.trending);
        setAiSuggestions(trendingResult.suggestions);
      } catch (error) {
        console.error('Error loading data:', error);
        // Fallback to static data if API fails
        setAiSuggestions([
          { type: "hook", text: "🚀 Ready to revolutionize your approach?", icon: "🚀", source: "Template" },
          { type: "question", text: "💭 What if I told you there's a better way?", icon: "💭", source: "Template" },
          { type: "stat", text: "📊 87% of professionals struggle with this...", icon: "📊", source: "Template" },
          { type: "story", text: "✨ Here's what happened when I tried this...", icon: "✨", source: "Template" },
        ]);
      } finally {
        setIsLoadingTrends(false);
      }
    };

    loadData();
  }, []);

  // Handle OAuth success/error from URL parameters
  useEffect(() => {
    if (router.query.connected && router.query.account) {
      const platform = router.query.connected as string;
      const accountName = router.query.account as string;
      const isMock = router.query.mock === 'true';
      const isSuccess = router.query.success === 'true';
      
      console.log('OAuth callback received:', { platform, accountName, isMock, isSuccess });
      
      // Add the connected account
      const newAccount = {
        id: `${platform}-${Date.now()}`,
        platform,
        account_name: accountName,
        is_active: true
      };
      
      setConnectedAccounts(prev => {
        const exists = prev.some(acc => acc.platform === platform);
        if (exists) return prev;
        return [...prev, newAccount];
      });
      
      // Show success message
      if (isSuccess) {
        console.log(`Successfully connected ${platform} account: ${accountName}`);
        setNotification({
          type: 'success',
          message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} account connected successfully!`
        });
        
        // Auto-hide notification after 5 seconds
        setTimeout(() => {
          setNotification(null);
        }, 5000);
      }
      
      // Clear URL parameters after a short delay to prevent flickering
      setTimeout(() => {
        router.replace('/creative-scheduler', undefined, { shallow: true });
      }, 1000);
    }
    
    // Handle OAuth errors
    if (router.query.error) {
      const error = router.query.error as string;
      const description = router.query.description as string;
      console.error('OAuth error:', error, description);
      
      setNotification({
        type: 'error',
        message: `Connection failed: ${error}${description ? ` - ${description}` : ''}`
      });
      
      // Auto-hide notification after 5 seconds
      setTimeout(() => {
        setNotification(null);
      }, 5000);
      
      // Clear URL parameters after showing error
      setTimeout(() => {
        router.replace('/creative-scheduler', undefined, { shallow: true });
      }, 3000);
    }
  }, [router.query]);

  const handleConnectAccount = (platform: string) => {
    console.log(`Initiating ${platform} OAuth connection...`);
    
    // Redirect to OAuth URL in the same window
    window.location.href = `/api/auth/${platform}`;
  };

  const handleDisconnectAccount = async (platform: string) => {
    try {
      // In production, call API to disconnect account
      console.log(`Disconnecting ${platform} account`);
      // Reload accounts after disconnection
      const accountsResponse = await fetch('/api/accounts');
      const accounts = await accountsResponse.json();
      setConnectedAccounts(accounts);
    } catch (error) {
      console.error('Error disconnecting account:', error);
    }
  };

  const handleStepChange = (step: number) => {
    setIsAnimating(true);
    setTimeout(() => {
      setActiveStep(step);
      setIsAnimating(false);
    }, 300);
  };

  const handlePlatformToggle = (platform: string) => {
    setFormData(prev => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter(p => p !== platform)
        : [...prev.platforms, platform]
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-md ${
          notification.type === 'success' 
            ? 'bg-green-500 text-white' 
            : 'bg-red-500 text-white'
        }`}>
          <div className="flex items-center gap-3">
            {notification.type === 'success' ? (
              <CheckCircle className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
            <span className="font-medium">{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              className="ml-auto text-white/80 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl animate-pulse delay-500"></div>
        
        {/* Floating Particles */}
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-white/20 rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`
            }}
          ></div>
        ))}
      </div>

      <div className="relative z-10 flex min-h-screen">
        {/* Creative Sidebar */}
        <aside className="w-80 bg-black/20 backdrop-blur-xl border-r border-white/10 shadow-2xl">
          <div className="p-8">
            <div className="flex items-center gap-4 mb-12">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <Sparkles className="h-7 w-7 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
              </div>
              <div>
                <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent">
                  Virality Engine
                </h2>
                <p className="text-purple-300 text-sm">Creative Studio</p>
              </div>
            </div>
            
            {/* Creative Navigation */}
            <nav className="space-y-3">
              {steps.map((step) => (
                <button
                  key={step.id}
                  onClick={() => handleStepChange(step.id)}
                  className={`group w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 ${
                    activeStep === step.id
                      ? `bg-gradient-to-r ${step.color} text-white shadow-lg shadow-purple-500/25 transform scale-105`
                      : 'hover:bg-white/10 text-gray-300 hover:text-white hover:scale-105'
                  }`}
                >
                  <div className={`p-3 rounded-xl ${
                    activeStep === step.id ? 'bg-white/20' : 'bg-white/10 group-hover:bg-white/20'
                  }`}>
                    {step.icon}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold">{step.title}</div>
                    <div className="text-xs opacity-70">
                      {step.id === 0 && "Find your inspiration"}
                      {step.id === 1 && "Craft your message"}
                      {step.id === 2 && "Choose platforms"}
                      {step.id === 3 && "Set timing"}
                    </div>
                  </div>
                  {activeStep === step.id && (
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main Creative Content */}
        <main className="flex-1 p-8 space-y-8">
          {/* Creative Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-5xl font-bold bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent mb-4">
                Creative Scheduler
              </h1>
              <p className="text-gray-300 text-xl">Transform ideas into viral content across platforms</p>
            </div>
            <div className="flex items-center gap-4">
              <Button className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/25 border-0">
                <Wand2 className="h-5 w-5 mr-2" />
                AI Generate
              </Button>
              <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                <Settings className="h-5 w-5 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {/* Creative Step Content */}
          <div className={`transition-all duration-500 ${isAnimating ? 'opacity-0 transform scale-95' : 'opacity-100 transform scale-100'}`}>
            {activeStep === 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Connected Accounts Status */}
                <Card className="bg-black/20 backdrop-blur-xl border-white/10 shadow-2xl mb-6">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-white">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl">
                          <Users className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <div className="text-lg font-semibold">Social Accounts</div>
                          <div className="text-sm text-gray-400">Connect your accounts to get personalized content</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-white">
                          {connectedAccounts.filter(acc => acc.is_active).length}
                        </div>
                        <div className="text-xs text-gray-400">of 5 connected</div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-4">
                      {['linkedin', 'twitter', 'instagram', 'facebook', 'youtube'].map(platform => {
                        const account = connectedAccounts.find(acc => acc.platform === platform);
                        const isConnected = account && account.is_active;
                        const platformIcons = {
                          linkedin: '💼',
                          twitter: '🐦',
                          instagram: '📸',
                          facebook: '👥',
                          youtube: '📺'
                        };
                        const platformColors = {
                          linkedin: 'blue',
                          twitter: 'sky',
                          instagram: 'pink',
                          facebook: 'indigo',
                          youtube: 'red'
                        };
                        
                        return (
                          <div
                            key={platform}
                            className={`p-4 rounded-xl border transition-all duration-300 ${
                              isConnected 
                                ? `bg-${platformColors[platform]}-500/20 border-${platformColors[platform]}-500/30 shadow-lg shadow-${platformColors[platform]}-500/10` 
                                : 'bg-gray-500/10 border-gray-500/20 hover:bg-gray-500/20'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${
                                  isConnected 
                                    ? `bg-${platformColors[platform]}-500/30` 
                                    : 'bg-gray-500/20'
                                }`}>
                                  <span className="text-2xl">{platformIcons[platform]}</span>
                                </div>
                                <div>
                                  <div className="text-lg font-semibold text-white capitalize">{platform}</div>
                                  <div className={`text-sm ${
                                    isConnected ? 'text-green-400' : 'text-gray-400'
                                  }`}>
                                    {isConnected ? account.account_name : 'Not connected'}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${
                                  isConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-400'
                                }`}></div>
                                {isConnected ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleDisconnectAccount(platform)}
                                    className="px-4 py-2 bg-red-500/20 border-red-500/30 text-red-400 hover:bg-red-500/30 hover:border-red-500/50 transition-all"
                                  >
                                    Disconnect
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={() => handleConnectAccount(platform)}
                                    className={`px-4 py-2 bg-gradient-to-r from-${platformColors[platform]}-500 to-${platformColors[platform]}-600 hover:from-${platformColors[platform]}-600 hover:to-${platformColors[platform]}-700 text-white border-0 shadow-lg transition-all`}
                                  >
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Connect
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* AI Inspiration Cards */}
                <Card className="bg-black/20 backdrop-blur-xl border-white/10 shadow-2xl">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-white">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
                          <Wand2 className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <div className="text-lg font-semibold">AI Inspiration</div>
                          <div className="text-sm text-gray-400">Trending content for your connected accounts</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 bg-purple-500/20 px-3 py-1 rounded-full">
                        Powered by real APIs
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingTrends ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
                          <span className="text-white text-lg">Loading trending data...</span>
                          <div className="text-gray-400 text-sm mt-2">Fetching personalized content</div>
                        </div>
                      </div>
                    ) : aiSuggestions.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="text-gray-400 text-lg mb-4">No suggestions available</div>
                        <div className="text-gray-500 text-sm">Connect your social accounts to see personalized trends</div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {aiSuggestions.map((suggestion, index) => (
                          <div
                            key={index}
                            className="group p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-300 cursor-pointer hover:scale-105 hover:shadow-lg"
                            onClick={() => {
                              // Auto-fill content when suggestion is clicked
                              setFormData(prev => ({
                                ...prev,
                                content: suggestion.text,
                                hashtags: suggestion.text.includes('#') ? suggestion.text.match(/#\w+/g)?.join(' ') || '' : ''
                              }));
                              setActiveStep(1); // Move to content step
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg">
                                  <span className="text-xl">{suggestion.icon}</span>
                                </div>
                                <div className="flex-1">
                                  <span className="text-white font-medium text-sm leading-relaxed">{suggestion.text}</span>
                                  <div className="flex items-center gap-3 mt-2">
                                    <span className="text-xs text-gray-400">Source: {suggestion.source}</span>
                                    {suggestion.platform && (
                                      <span className="text-xs text-blue-400">Platform: {suggestion.platform}</span>
                                    )}
                                    {suggestion.engagement && (
                                      <span className="text-xs text-green-400">+{suggestion.engagement}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <Plus className="h-5 w-5 text-purple-400" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Trending Topics */}
                <Card className="bg-black/20 backdrop-blur-xl border-white/10 shadow-2xl">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-white">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl">
                          <TrendingUp className="h-6 w-6 text-white" />
                        </div>
                        Trending Now
                      </div>
                      <div className="text-xs text-gray-400">
                        Real-time data
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingTrends ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
                        <span className="ml-3 text-white">Loading trends...</span>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {trendingData?.social?.map((trend, index) => (
                          <div
                            key={index}
                            className="group p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-300 cursor-pointer hover:scale-105"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                hashtags: trend.hashtag
                              }));
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-white font-medium">{trend.hashtag}</span>
                                <div className="text-xs text-gray-400 mt-1">
                                  {trend.platform} • {trend.posts} posts
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                <span className="text-green-400 text-sm">{trend.engagement}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                        
                        {/* Platform-Specific Trends */}
                        <div className="mt-6 space-y-4">
                          {/* LinkedIn Trends (Google Trends) - only if LinkedIn is connected */}
                          {trendingData?.linkedin?.length > 0 && connectedAccounts.some(acc => acc.platform === 'linkedin' && acc.is_active) && (
                            <div>
                              <h4 className="text-sm text-gray-400 mb-3">💼 LinkedIn Professional</h4>
                              {trendingData.linkedin.slice(0, 2).map((trend, index) => (
                                <div
                                  key={index}
                                  className="group p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all duration-300 cursor-pointer mb-2"
                                  onClick={() => {
                                    setFormData(prev => ({
                                      ...prev,
                                      title: trend.keyword,
                                      content: `Professional insight: ${trend.keyword} is trending in business`
                                    }));
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="text-white font-medium text-sm">{trend.keyword}</span>
                                      <div className="text-xs text-gray-400">{trend.searchVolume} search volume</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-blue-400">💼</span>
                                      <span className="text-blue-400 text-xs">{trend.trend}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Twitter Trends (Reddit) - only if Twitter is connected */}
                          {trendingData?.twitter?.length > 0 && connectedAccounts.some(acc => acc.platform === 'twitter' && acc.is_active) && (
                            <div>
                              <h4 className="text-sm text-gray-400 mb-3">🐦 Twitter Viral</h4>
                              {trendingData.twitter.slice(0, 2).map((trend, index) => (
                                <div
                                  key={index}
                                  className="group p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all duration-300 cursor-pointer mb-2"
                                  onClick={() => {
                                    setFormData(prev => ({
                                      ...prev,
                                      title: trend.keyword,
                                      content: `Viral topic: ${trend.keyword} trending on r/${trend.subreddit}`
                                    }));
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="text-white font-medium text-sm">{trend.keyword}</span>
                                      <div className="text-xs text-gray-400">r/{trend.subreddit}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-sky-400">🐦</span>
                                      <span className="text-sky-400 text-xs">{trend.upvotes}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Instagram Trends (YouTube) - only if Instagram is connected */}
                          {trendingData?.instagram?.length > 0 && connectedAccounts.some(acc => acc.platform === 'instagram' && acc.is_active) && (
                            <div>
                              <h4 className="text-sm text-gray-400 mb-3">📸 Instagram Visual</h4>
                              {trendingData.instagram.slice(0, 2).map((trend, index) => (
                                <div
                                  key={index}
                                  className="group p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all duration-300 cursor-pointer mb-2"
                                  onClick={() => {
                                    setFormData(prev => ({
                                      ...prev,
                                      title: trend.keyword,
                                      content: `Visual trend: ${trend.keyword} with ${trend.views} views`
                                    }));
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="text-white font-medium text-sm">{trend.keyword}</span>
                                      <div className="text-xs text-gray-400">{trend.views} views</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-pink-400">📸</span>
                                      <span className="text-pink-400 text-xs">{trend.growth}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Facebook Trends (Reddit) - only if Facebook is connected */}
                          {trendingData?.facebook?.length > 0 && connectedAccounts.some(acc => acc.platform === 'facebook' && acc.is_active) && (
                            <div>
                              <h4 className="text-sm text-gray-400 mb-3">👥 Facebook Community</h4>
                              {trendingData.facebook.slice(0, 2).map((trend, index) => (
                                <div
                                  key={index}
                                  className="group p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all duration-300 cursor-pointer mb-2"
                                  onClick={() => {
                                    setFormData(prev => ({
                                      ...prev,
                                      title: trend.keyword,
                                      content: `Community topic: ${trend.keyword} popular in groups`
                                    }));
                                  }}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="text-white font-medium text-sm">{trend.keyword}</span>
                                      <div className="text-xs text-gray-400">r/{trend.subreddit}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-indigo-400">👥</span>
                                      <span className="text-indigo-400 text-xs">{trend.upvotes}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeStep === 1 && (
              <Card className="bg-black/20 backdrop-blur-xl border-white/10 shadow-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-white">
                    <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl">
                      <Brain className="h-6 w-6 text-white" />
                    </div>
                    Content Creation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <label className="block text-white font-medium mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg">
                          <FileText className="h-3 w-3 text-white" />
                        </div>
                        Title
                      </div>
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                      placeholder="Craft a compelling headline..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-white font-medium mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg">
                          <MessageCircle className="h-3 w-3 text-white" />
                        </div>
                        Content
                      </div>
                    </label>
                    <textarea
                      value={formData.content}
                      onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                      className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                      rows={6}
                      placeholder="Tell your story..."
                    />
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-gray-400 text-sm">{formData.content.length} characters</span>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-green-400 text-sm">AI Enhanced</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1 bg-gradient-to-r from-teal-500 to-green-500 rounded-lg">
                          <Hash className="h-3 w-3 text-white" />
                        </div>
                        Hashtags
                      </div>
                    </label>
                    <input
                      type="text"
                      value={formData.hashtags}
                      onChange={(e) => setFormData(prev => ({ ...prev, hashtags: e.target.value }))}
                      className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                      placeholder="#innovation #future #technology"
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {activeStep === 2 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {creativePlatforms.map((platform) => {
                  const isSelected = formData.platforms.includes(platform.key);
                  return (
                    <div
                      key={platform.key}
                      className={`group cursor-pointer transition-all duration-500 transform hover:scale-105 ${
                        isSelected 
                          ? `bg-gradient-to-br ${platform.gradient} text-white shadow-2xl shadow-purple-500/25` 
                          : 'bg-black/20 backdrop-blur-xl border-white/10 hover:bg-white/10'
                      }`}
                      onClick={() => handlePlatformToggle(platform.key)}
                    >
                      <Card>
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-3 rounded-xl ${
                              isSelected ? 'bg-white/20' : 'bg-white/10'
                            }`}>
                              {platform.icon}
                            </div>
                            <div>
                              <h3 className="font-bold text-lg">{platform.name}</h3>
                              <p className={`text-sm ${
                                isSelected ? 'text-white/80' : 'text-gray-400'
                              }`}>{platform.description}</p>
                            </div>
                          </div>
                          <div className="text-4xl opacity-20">{platform.bgPattern}</div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className={`p-3 rounded-xl ${
                            isSelected ? 'bg-white/20' : 'bg-white/5'
                          }`}>
                            <div className={`text-sm ${
                              isSelected ? 'text-white/80' : 'text-gray-400'
                            }`}>Reach</div>
                            <div className="font-bold text-lg">{platform.stats.reach}</div>
                          </div>
                          <div className={`p-3 rounded-xl ${
                            isSelected ? 'bg-white/20' : 'bg-white/5'
                          }`}>
                            <div className={`text-sm ${
                              isSelected ? 'text-white/80' : 'text-gray-400'
                            }`}>Engagement</div>
                            <div className="font-bold text-lg">{platform.stats.engagement}</div>
                          </div>
                        </div>
                        
                        {isSelected && (
                          <div className="mt-4 flex items-center gap-2">
                            <CheckCircle className="h-5 w-5 text-white" />
                            <span className="text-white font-medium">Selected</span>
                          </div>
                        )}
                      </CardContent>
                      </Card>
                    </div>
                  );
                })}
              </div>
            )}

            {activeStep === 3 && (
              <Card className="bg-black/20 backdrop-blur-xl border-white/10 shadow-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 text-white">
                    <div className="p-3 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl">
                      <Clock className="h-6 w-6 text-white" />
                    </div>
                    Schedule & Launch
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-white font-medium mb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-lg">
                            <Calendar className="h-3 w-3 text-white" />
                          </div>
                          Date
                        </div>
                      </label>
                      <input
                        type="date"
                        value={formData.scheduledDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, scheduledDate: e.target.value }))}
                        className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                      />
                    </div>
                    <div>
                      <label className="block text-white font-medium mb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg">
                            <Clock className="h-3 w-3 text-white" />
                          </div>
                          Time
                        </div>
                      </label>
                      <input
                        type="time"
                        value={formData.scheduledTime}
                        onChange={(e) => setFormData(prev => ({ ...prev, scheduledTime: e.target.value }))}
                        className="w-full p-4 bg-white/10 border border-white/20 rounded-xl text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-6 bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-xl">
                    <div>
                      <h4 className="text-white font-bold text-lg">Ready to Schedule?</h4>
                      <p className="text-purple-200 text-sm">Continue to the main scheduler to set timing and publish</p>
                    </div>
                    <Button 
                      onClick={() => {
                        // Pass form data to main scheduler
                        router.push({
                          pathname: '/scheduler',
                          query: { 
                            title: formData.title,
                            content: formData.content,
                            hashtags: formData.hashtags,
                            platforms: formData.platforms.join(','),
                            mediaType: formData.mediaType
                          }
                        });
                      }}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 shadow-lg shadow-purple-500/25 border-0 text-lg px-8 py-4"
                    >
                      <Calendar className="h-6 w-6 mr-3" />
                      Continue to Schedule
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
