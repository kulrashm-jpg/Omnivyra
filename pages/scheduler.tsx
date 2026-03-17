import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Dropdown } from "../components/ui/dropdown";
import { Calendar, Clock, Send, AlertCircle, CheckCircle, Plus, Settings, Sparkles, Eye, EyeOff, Zap, TrendingUp, Users, BarChart3, Image, Video, FileText, Hash, Globe, Smartphone, Monitor, Wand2 } from "lucide-react";
import PreviewCard from "../components/PreviewCard";
import ContentRenderer from "../components/ContentRenderer";
import { PLATFORM_CONFIGS, getPlatformConfig } from "../lib/platforms";
import { supabase } from "../utils/supabaseClient";

interface ScheduledPost {
  id: string;
  content: string;
  platform: string;
  scheduled_for: string;
  status: string;
  account_name?: string;
  error_message?: string;
  platform_post_id?: string;
}

interface ConnectedAccount {
  id: string;
  platform: string;
  account_name: string;
  is_active: boolean;
}

interface PostFormData {
  title: string;
  body: string;
  hashtags: string;
  mediaType: "none" | "image" | "video";
  platforms: string[];
  scheduledDate: string;
  scheduledTime: string;
}

export default function SchedulerPage() {
  const router = useRouter();
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState<PostFormData>({
    title: "",
    body: "",
    hashtags: "",
    mediaType: "none",
    platforms: [],
    scheduledDate: "",
    scheduledTime: "",
  });
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Dropdown options
  const mediaTypeOptions = [
    { value: "none", label: "No Media", icon: <FileText className="h-4 w-4" />, color: "text-gray-500" },
    { value: "image", label: "Image", icon: <Image className="h-4 w-4" />, color: "text-blue-500" },
    { value: "video", label: "Video", icon: <Video className="h-4 w-4" />, color: "text-purple-500" },
  ];

  const platformOptions = PLATFORM_CONFIGS.map(platform => {
    const account = connectedAccounts.find(a => a.platform === platform.key && a.is_active);
    return {
      value: platform.key,
      label: platform.name,
      icon: platform.key === 'linkedin' ? <Globe className="h-4 w-4" /> : 
            platform.key === 'twitter' ? <Smartphone className="h-4 w-4" /> : 
            <Monitor className="h-4 w-4" />,
      color: platform.key === 'linkedin' ? 'text-blue-600' : 
             platform.key === 'twitter' ? 'text-sky-500' : 'text-gray-500',
      badge: account ? 'Connected' : 'Not Connected'
    };
  });

  // Load data
  useEffect(() => {
    loadScheduledPosts();
    loadConnectedAccounts();
  }, []);

  // Handle pre-filled data from creative scheduler
  useEffect(() => {
    if (router.query.title || router.query.content || router.query.hashtags || router.query.platforms) {
      setFormData(prev => ({
        ...prev,
        title: (router.query.title as string) || prev.title,
        body: (router.query.content as string) || prev.body,
        hashtags: (router.query.hashtags as string) || prev.hashtags,
        platforms: (router.query.platforms as string)?.split(',') || prev.platforms,
        mediaType: ((router.query.mediaType as string) || prev.mediaType) as 'image' | 'video' | 'none'
      }));
    }
  }, [router.query]);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadScheduledPosts = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/scheduler/posts', { headers });
      if (!response.ok) return;
      const data = await response.json();
      setScheduledPosts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading scheduled posts:', error);
    }
  };

  const loadConnectedAccounts = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/accounts', { headers });
      if (!response.ok) return;
      const data = await response.json();
      setConnectedAccounts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading connected accounts:', error);
    }
  };

  const handleInputChange = (field: keyof PostFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePlatformToggle = (platform: string) => {
    setFormData(prev => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter(p => p !== platform)
        : [...prev.platforms, platform]
    }));
  };

  const handleSchedulePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.body || !formData.platforms.length || !formData.scheduledDate || !formData.scheduledTime) {
      notify('info', 'Please fill in all required fields');
      return;
    }

    setIsLoading(true);
    
    try {
      const scheduledFor = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`);
      
      const authHeaders = await getAuthHeaders();

      // Schedule for each selected platform
      const promises = formData.platforms.map(async (platform) => {
        const account = connectedAccounts.find(a => a.platform === platform && a.is_active);
        if (!account) throw new Error(`No active account found for ${platform}`);

        const response = await fetch('/api/scheduler/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            title: formData.title,
            content: formData.body,
            hashtags: formData.hashtags,
            mediaType: formData.mediaType,
            scheduledFor: scheduledFor.toISOString(),
            platform: platform,
            accountId: account.id,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to schedule post for ${platform}`);
        }

        return response.json();
      });

      await Promise.all(promises);

      // Reset form
      setFormData({
        title: "",
        body: "",
        hashtags: "",
        mediaType: "none",
        platforms: [],
        scheduledDate: "",
        scheduledTime: "",
      });
      
      // Reload posts
      loadScheduledPosts();
      notify('success', 'Posts scheduled successfully.');
    } catch (error: any) {
      notify('error', error?.message || 'Failed to schedule posts');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'published':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'publishing':
        return <Clock className="h-4 w-4 text-blue-500" />;
      default:
        return <Calendar className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'publishing':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex min-h-screen">
        {notice && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 max-w-md w-full mx-4">
            <div className={`rounded-lg border px-3 py-2 text-sm shadow ${notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`} role="status" aria-live="polite">{notice.message}</div>
          </div>
        )}
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Modern Sidebar */}
        <aside className={`fixed md:static z-30 inset-y-0 left-0 w-64 bg-white border-r border-gray-200 shadow-sm transform transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
          <div className="p-5">
            <div className="flex items-center gap-3 mb-7">
              <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Calendar className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Virality Engine</h2>
                <p className="text-xs text-gray-500">Content Scheduler</p>
              </div>
            </div>

            <nav className="space-y-1">
              <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-medium">Dashboard</span>
              </Link>
              <Link href="/scheduler" className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-indigo-50 text-indigo-700">
                <Calendar className="h-4 w-4" />
                <span className="text-sm font-semibold">Scheduler</span>
              </Link>
              <Link href="/engagement" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors">
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">Engagement</span>
              </Link>
              <Link href="/analytics" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors">
                <BarChart3 className="h-4 w-4" />
                <span className="text-sm font-medium">Analytics</span>
              </Link>
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 sm:p-7 space-y-6 min-w-0">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Hamburger — mobile only */}
              <button
                className="md:hidden p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Content Scheduler</h1>
                <p className="text-sm text-gray-500 mt-1">Plan, customize, and schedule posts across platforms</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => router.push('/creative-scheduler')}
                className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 w-full sm:w-auto"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Get Inspiration
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowPreview(!showPreview)}
                className="bg-white border-gray-300 hover:bg-gray-50 w-full sm:w-auto"
              >
                {showPreview ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </Button>
              <Button variant="outline" className="bg-white border-gray-300 hover:bg-gray-50 w-full sm:w-auto">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
          
          {/* Enhanced Schedule New Post Form */}
          <div className="lg:col-span-2">
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardHeader className="pb-4 px-4 sm:px-6">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <div className="p-2 bg-indigo-50 rounded-lg">
                    <Plus className="h-5 w-5 text-indigo-600" />
                  </div>
                  Schedule New Post
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 sm:px-6">
                <form onSubmit={handleSchedulePost} className="space-y-6">
                  
                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-400" />
                        Title (Optional)
                      </div>
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => handleInputChange('title', e.target.value)}
                      className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-colors"
                      placeholder="Enter post title..."
                    />
                  </div>

                  {/* Content */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-400" />
                        Content *
                      </div>
                    </label>
                    <textarea
                      value={formData.body}
                      onChange={(e) => handleInputChange('body', e.target.value)}
                      className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-colors"
                      rows={6}
                      placeholder="What would you like to share?"
                      required
                    />
                    <p className="text-sm text-gray-500 mt-2">
                      {formData.body.length} characters
                    </p>
                  </div>

                  {/* Hashtags */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <Hash className="h-4 w-4 text-gray-400" />
                        Hashtags
                      </div>
                    </label>
                    <input
                      type="text"
                      value={formData.hashtags}
                      onChange={(e) => handleInputChange('hashtags', e.target.value)}
                      className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-colors"
                      placeholder="#hashtag1 #hashtag2 #hashtag3"
                    />
                  </div>

                  {/* Media Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <Hash className="h-4 w-4 text-gray-400" />
                        Media Type
                      </div>
                    </label>
                    <Dropdown
                      options={mediaTypeOptions}
                      value={formData.mediaType}
                      onChange={(value) => handleInputChange('mediaType', value)}
                      variant="glass"
                      size="md"
                    />
                  </div>

                  {/* Platform Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-gray-400" />
                        Platforms *
                      </div>
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {PLATFORM_CONFIGS.map(platform => {
                        const account = connectedAccounts.find(a => a.platform === platform.key && a.is_active);
                        const isSelected = formData.platforms.includes(platform.key);
                        const platformColors = {
                          linkedin: 'from-blue-500 to-blue-700',
                          twitter: 'from-sky-500 to-blue-600',
                          facebook: 'from-indigo-500 to-blue-600',
                          instagram: 'from-pink-500 to-purple-600'
                        };
                        
                        return (
                          <label 
                            key={platform.key} 
                            className={`group relative flex items-center space-x-3 p-4 border-2 rounded-xl transition-colors cursor-pointer ${
                              isSelected
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                                : account
                                  ? 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                                  : 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handlePlatformToggle(platform.key)}
                              disabled={!account}
                              className="sr-only"
                            />
                            <div className={`flex items-center justify-center w-5 h-5 rounded border-2 transition-colors ${
                              isSelected
                                ? 'border-indigo-500 bg-indigo-500'
                                : 'border-gray-300 group-hover:border-indigo-400'
                            }`}>
                              {isSelected && (
                                <CheckCircle className="h-3 w-3 text-white" />
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                {platform.key === 'linkedin' && <Globe className="h-4 w-4" />}
                                {platform.key === 'twitter' && <Smartphone className="h-4 w-4" />}
                                {platform.key === 'facebook' && <Monitor className="h-4 w-4" />}
                                {platform.key === 'instagram' && <Image className="h-4 w-4" />}
                                <span className="font-medium">{platform.name}</span>
                              </div>
                              <div className={`text-xs mt-1 ${
                                isSelected ? 'text-white/80' : account ? 'text-gray-600' : 'text-gray-400'
                              }`}>
                                {account ? `${account.account_name}` : 'Not connected'}
                              </div>
                            </div>
                            {account && (
                              <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                                isSelected
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : 'bg-green-100 text-green-600'
                              }`}>
                                ✓
                              </div>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Schedule Time */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-gray-400" />
                          Date *
                        </div>
                      </label>
                      <input
                        type="date"
                        value={formData.scheduledDate}
                        onChange={(e) => handleInputChange('scheduledDate', e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-colors"
                        min={new Date().toISOString().split('T')[0]}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          Time *
                        </div>
                      </label>
                      <input
                        type="time"
                        value={formData.scheduledTime}
                        onChange={(e) => handleInputChange('scheduledTime', e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition-colors"
                        required
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3"
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                        Scheduling...
                      </>
                    ) : (
                      <>
                        <Calendar className="h-5 w-5 mr-3" />
                        Schedule Post
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Enhanced Preview Panel */}
          {showPreview && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-indigo-600" />
                <h3 className="text-lg font-semibold text-gray-900">Platform Previews</h3>
              </div>
              {formData.platforms.map(platformKey => {
                const config = getPlatformConfig(platformKey);
                if (!config) return null;
                
                return (
                  <PreviewCard
                    key={platformKey}
                    cfg={config}
                    post={{
                      platform: platformKey,
                      title: formData.title,
                      body: formData.body,
                      hashtags: formData.hashtags,
                      mediaType: formData.mediaType,
                    }}
                  />
                );
              })}
            </div>
          )}
          </div>

          {/* Scheduled Posts */}
          <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader className="pb-4 px-4 sm:px-6">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <Clock className="h-5 w-5 text-indigo-600" />
              </div>
              Scheduled Posts
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 sm:px-6">
            {scheduledPosts.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calendar className="h-8 w-8 text-gray-400" />
                </div>
                <p className="text-gray-500 text-lg">No scheduled posts yet</p>
                <p className="text-gray-400 text-sm mt-2">Create your first scheduled post above</p>
              </div>
            ) : (
              <div className="space-y-4">
                {scheduledPosts.map(post => (
                  <div key={post.id} className="border border-gray-200 rounded-xl p-4 sm:p-5 bg-white hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3">
                          {getStatusIcon(post.status)}
                          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(post.status)}`}>
                            {post.status.toUpperCase()}
                          </span>
                          <span className="text-sm text-gray-500 font-medium">
                            {post.platform.toUpperCase()}
                          </span>
                        </div>
                        
                        <div className="mb-3">
                          <ContentRenderer
                            content={post.content}
                            platform={post.platform}
                            renderMode="social"
                          />
                        </div>
                        
                        <div className="text-sm text-gray-500 mb-2">
                          Scheduled for: {new Date(post.scheduled_for).toLocaleString()}
                        </div>
                        
                        {post.error_message && (
                          <div className="mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
                            <strong>Error:</strong> {post.error_message}
                          </div>
                        )}
                        
                        {post.platform_post_id && (
                          <div className="mt-3 text-sm text-green-600 bg-green-50 p-3 rounded-lg border border-green-200">
                            <strong>Published:</strong> {post.platform_post_id}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
} 
