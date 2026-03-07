// Creative Dashboard - Offshoot of Scheduling Dashboard
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Calendar,
  Clock,
  Send,
  AlertCircle,
  CheckCircle,
  Plus,
  Settings,
  Eye,
  Edit,
  Trash2,
  Play,
  Pause,
  BarChart3,
  Users,
  Hash,
  Image,
  Video,
  Globe,
  Zap,
  TrendingUp,
  Activity,
  Target,
  Rocket,
  Sparkles,
  Palette,
  Wand2,
  Lightbulb,
  Brain,
  PenTool,
  Layers,
  Filter,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import PostCreationForm from '@/components/PostCreationForm';
import PlatformIcon from '@/components/ui/PlatformIcon';

interface ScheduledPost {
  id: string;
  platform: 'linkedin' | 'twitter' | 'instagram' | 'youtube' | 'facebook';
  contentType: string;
  content: string;
  mediaUrls?: string[];
  hashtags?: string[];
  scheduledFor: Date;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';
  publishedAt?: Date;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CreativeStats {
  platform: string;
  posts: number;
  engagement: number;
  reach: number;
  creativity: number;
  color: string;
  icon: React.ReactNode;
}

const creativeStats: CreativeStats[] = [
  {
    platform: 'LinkedIn',
    posts: 15,
    engagement: 4.2,
    reach: 2500,
    creativity: 8.5,
    color: 'blue',
    icon: <Users className="h-4 w-4" />,
  },
  {
    platform: 'Twitter',
    posts: 45,
    engagement: 2.8,
    reach: 1800,
    creativity: 7.2,
    color: 'sky',
    icon: <Hash className="h-4 w-4" />,
  },
  {
    platform: 'Instagram',
    posts: 20,
    engagement: 6.5,
    reach: 3200,
    creativity: 9.1,
    color: 'pink',
    icon: <Image className="h-4 w-4" />,
  },
  {
    platform: 'YouTube',
    posts: 8,
    engagement: 8.1,
    reach: 5000,
    creativity: 8.8,
    color: 'red',
    icon: <Video className="h-4 w-4" />,
  },
  {
    platform: 'Facebook',
    posts: 18,
    engagement: 3.2,
    reach: 2100,
    creativity: 6.9,
    color: 'indigo',
    icon: <Globe className="h-4 w-4" />,
  },
];

export default function CreativeDashboard() {
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [creativeMode, setCreativeMode] = useState<'ai' | 'manual' | 'hybrid'>('hybrid');

  const handlePostSaved = (post: any) => {
    console.log('Post saved:', post);
    loadScheduledPosts();
  };

  // Load scheduled posts
  useEffect(() => {
    loadScheduledPosts();
    loadAnalytics();
  }, []);

  const loadScheduledPosts = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/schedule/posts');
      const data = await response.json();
      
      if (data.success) {
        setScheduledPosts(data.data.map((post: any) => ({
          ...post,
          scheduledFor: new Date(post.scheduledFor),
          publishedAt: post.publishedAt ? new Date(post.publishedAt) : undefined,
          createdAt: new Date(post.createdAt),
          updatedAt: new Date(post.updatedAt),
        })));
      }
    } catch (error) {
      console.error('Error loading scheduled posts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAnalytics = async () => {
    try {
      const response = await fetch('/api/analytics/posting');
      const data = await response.json();
      
      if (data.success) {
        setAnalytics(data.data);
      }
    } catch (error) {
      console.error('Error loading analytics:', error);
    }
  };

  const handlePublishNow = async (postId: string) => {
    try {
      const response = await fetch(`/api/schedule/posts/${postId}`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (data.success) {
        await loadScheduledPosts();
      } else {
        alert(`Failed to publish: ${data.error}`);
      }
    } catch (error) {
      console.error('Error publishing post:', error);
      alert('Failed to publish post');
    }
  };

  const handleCancelPost = async (postId: string) => {
    try {
      const response = await fetch(`/api/schedule/posts/${postId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      
      if (data.success) {
        await loadScheduledPosts();
      } else {
        alert(`Failed to cancel: ${data.error}`);
      }
    } catch (error) {
      console.error('Error cancelling post:', error);
      alert('Failed to cancel post');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'bg-green-500';
      case 'scheduled': return 'bg-blue-500';
      case 'publishing': return 'bg-yellow-500';
      case 'failed': return 'bg-red-500';
      case 'draft': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'published': return <CheckCircle className="h-4 w-4" />;
      case 'scheduled': return <Clock className="h-4 w-4" />;
      case 'publishing': return <Zap className="h-4 w-4" />;
      case 'failed': return <AlertCircle className="h-4 w-4" />;
      case 'draft': return <Edit className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const filteredPosts = scheduledPosts.filter(post => {
    const platformMatch = selectedPlatform === 'all' || post.platform === selectedPlatform;
    const statusMatch = selectedStatus === 'all' || post.status === selectedStatus;
    return platformMatch && statusMatch;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900 text-white p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => window.location.href = '/scheduling-dashboard'}
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Main Scheduler
            </Button>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
                Creative Dashboard
              </h1>
              <p className="text-gray-400 mt-2">
                AI-powered creative content scheduling with enhanced visual tools
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white/10 rounded-lg p-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <select
                value={creativeMode}
                onChange={(e) => setCreativeMode(e.target.value as 'ai' | 'manual' | 'hybrid')}
                className="bg-transparent text-white border-none outline-none"
              >
                <option value="ai">AI Mode</option>
                <option value="manual">Manual Mode</option>
                <option value="hybrid">Hybrid Mode</option>
              </select>
            </div>
            <Button
              onClick={() => setShowCreateForm(true)}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-lg shadow-purple-500/25"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Create Creative Post
            </Button>
            <Button
              onClick={loadScheduledPosts}
              className="bg-white/20 border-white/20 text-white hover:bg-white/30"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Creative Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        {creativeStats.map((stat) => (
          <Card key={stat.platform} className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl bg-${stat.color}-500/20`}>
                  {stat.icon}
                </div>
                <Badge variant="secondary" className="bg-white/10 text-white">
                  {stat.posts} posts
                </Badge>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">{stat.platform}</h3>
                <div className="space-y-2 mt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Engagement</span>
                    <span className="text-green-400">{stat.engagement}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Reach</span>
                    <span className="text-blue-400">{stat.reach.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Creativity</span>
                    <span className="text-purple-400">{stat.creativity}/10</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <Tabs defaultValue="creative" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 bg-gray-800/50 border-white/10">
          <TabsTrigger value="creative" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
            <Palette className="h-4 w-4 mr-2" />
            Creative Posts
          </TabsTrigger>
          <TabsTrigger value="scheduled" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
            <Clock className="h-4 w-4 mr-2" />
            Scheduled
          </TabsTrigger>
          <TabsTrigger value="published" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
            <CheckCircle className="h-4 w-4 mr-2" />
            Published
          </TabsTrigger>
          <TabsTrigger value="analytics" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="creative" className="space-y-6">
          {/* Creative Tools */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-gradient-to-br from-purple-800/50 to-pink-800/50 border-purple-500/20 shadow-lg backdrop-blur-xl">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl text-white">
                    <Brain className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">AI Content Generator</h3>
                    <p className="text-sm text-purple-200">Generate creative content with AI</p>
                  </div>
                </div>
                <Button className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white">
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate Content
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-800/50 to-cyan-800/50 border-blue-500/20 shadow-lg backdrop-blur-xl">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl text-white">
                    <PenTool className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Visual Editor</h3>
                    <p className="text-sm text-blue-200">Design and edit visual content</p>
                  </div>
                </div>
                <Button className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white">
                  <Layers className="h-4 w-4 mr-2" />
                  Open Editor
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-green-800/50 to-emerald-800/50 border-green-500/20 shadow-lg backdrop-blur-xl">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl text-white">
                    <Lightbulb className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Trending Ideas</h3>
                    <p className="text-sm text-green-200">Discover trending content ideas</p>
                  </div>
                </div>
                <Button className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Explore Trends
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-400" />
                Quick Creative Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Button className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white h-20 flex flex-col items-center justify-center">
                  <Brain className="h-6 w-6 mb-2" />
                  <span className="text-sm">AI Generate</span>
                </Button>
                <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white h-20 flex flex-col items-center justify-center">
                  <Image className="h-6 w-6 mb-2" />
                  <span className="text-sm">Add Media</span>
                </Button>
                <Button className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white h-20 flex flex-col items-center justify-center">
                  <Hash className="h-6 w-6 mb-2" />
                  <span className="text-sm">Hashtags</span>
                </Button>
                <Button className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white h-20 flex flex-col items-center justify-center">
                  <Filter className="h-6 w-6 mb-2" />
                  <span className="text-sm">Filters</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scheduled" className="space-y-6">
          {/* Filters */}
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-300">Platform:</label>
                  <select
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value)}
                    className="bg-white/10 border-white/20 text-white rounded-lg px-3 py-2"
                  >
                    <option value="all">All Platforms</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="twitter">Twitter</option>
                    <option value="instagram">Instagram</option>
                    <option value="youtube">YouTube</option>
                    <option value="facebook">Facebook</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-300">Status:</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="bg-white/10 border-white/20 text-white rounded-lg px-3 py-2"
                  >
                    <option value="all">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="publishing">Publishing</option>
                    <option value="published">Published</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Posts List */}
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto"></div>
                <p className="text-gray-400 mt-2">Loading posts...</p>
              </div>
            ) : filteredPosts.length === 0 ? (
              <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
                <CardContent className="p-8 text-center">
                  <Rocket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">No creative posts found</h3>
                  <p className="text-gray-400 mb-4">Get started by creating your first creative post</p>
                  <Button
                    onClick={() => setShowCreateForm(true)}
                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
                  >
                    <Wand2 className="h-4 w-4 mr-2" />
                    Create Creative Post
                  </Button>
                </CardContent>
              </Card>
            ) : (
              filteredPosts.map((post) => (
                <Card key={post.id} className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex items-center gap-2">
                            <PlatformIcon platform={post.platform} size={16} showLabel useBrandColor={true} className="text-white" />
                          </div>
                          <Badge className={`${getStatusColor(post.status)} text-white`}>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(post.status)}
                              {post.status}
                            </div>
                          </Badge>
                          <span className="text-sm text-gray-400">
                            {post.contentType}
                          </span>
                          <Badge variant="secondary" className="bg-purple-500/20 text-purple-300 border-purple-500/30">
                            <Sparkles className="h-3 w-3 mr-1" />
                            Creative
                          </Badge>
                        </div>
                        
                        <p className="text-gray-300 mb-3 line-clamp-2">
                          {post.content}
                        </p>
                        
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {post.scheduledFor.toLocaleString()}
                          </div>
                          {post.hashtags && post.hashtags.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Hash className="h-4 w-4" />
                              {post.hashtags.length} hashtags
                            </div>
                          )}
                          {post.mediaUrls && post.mediaUrls.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Image className="h-4 w-4" />
                              {post.mediaUrls.length} media
                            </div>
                          )}
                          {post.retryCount > 0 && (
                            <div className="flex items-center gap-1 text-yellow-400">
                              <AlertCircle className="h-4 w-4" />
                              {post.retryCount}/{post.maxRetries} retries
                            </div>
                          )}
                        </div>
                        
                        {post.errorMessage && (
                          <div className="mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                            <p className="text-red-300 text-sm">{post.errorMessage}</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        {post.status === 'scheduled' && (
                          <Button
                            onClick={() => handlePublishNow(post.id)}
                            size="sm"
                            className="bg-green-500 hover:bg-green-600 text-white"
                          >
                            <Play className="h-4 w-4 mr-1" />
                            Publish Now
                          </Button>
                        )}
                        {post.status === 'draft' && (
                          <Button
                            onClick={() => handlePublishNow(post.id)}
                            size="sm"
                            className="bg-blue-500 hover:bg-blue-600 text-white"
                          >
                            <Send className="h-4 w-4 mr-1" />
                            Publish
                          </Button>
                        )}
                        {(post.status === 'scheduled' || post.status === 'draft') && (
                          <Button
                            onClick={() => handleCancelPost(post.id)}
                            size="sm"
                            variant="outline"
                            className="border-red-500 text-red-400 hover:bg-red-500 hover:text-white"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-white/20 text-white hover:bg-white/10"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-purple-500/50 text-purple-300 hover:bg-purple-500/20"
                        >
                          <PenTool className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="published" className="space-y-6">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-8 text-center">
              <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Published Creative Posts</h3>
              <p className="text-gray-400">View your published creative content and performance analytics</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-8 text-center">
              <BarChart3 className="h-12 w-12 text-purple-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Creative Analytics Dashboard</h3>
              <p className="text-gray-400">Track your creative content performance and engagement metrics</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Post Creation Form Modal */}
      {showCreateForm && (
        <PostCreationForm
          onClose={() => setShowCreateForm(false)}
          onSave={handlePostSaved}
        />
      )}
    </div>
  );
}
