// Comprehensive Scheduling UI Component
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
  Zap,
  TrendingUp,
  Activity,
  Target,
  Rocket,
  Users,
  Hash,
  Image as ImageIcon,
  Video,
  Globe,
} from 'lucide-react';
import PlatformIcon from '@/components/ui/PlatformIcon';
import PostCreationForm from '@/components/PostCreationForm';

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

interface PlatformStats {
  platform: string;
  posts: number;
  engagement: number;
  reach: number;
  color: string;
  icon: React.ReactNode;
}

const platformStats: PlatformStats[] = [
  {
    platform: 'LinkedIn',
    posts: 15,
    engagement: 4.2,
    reach: 2500,
    color: 'blue',
    icon: <Users className="h-4 w-4" />,
  },
  {
    platform: 'Twitter',
    posts: 45,
    engagement: 2.8,
    reach: 1800,
    color: 'sky',
    icon: <Hash className="h-4 w-4" />,
  },
  {
    platform: 'Instagram',
    posts: 20,
    engagement: 6.5,
    reach: 3200,
    color: 'pink',
    icon: <ImageIcon className="h-4 w-4" />,
  },
  {
    platform: 'YouTube',
    posts: 8,
    engagement: 8.1,
    reach: 5000,
    color: 'red',
    icon: <Video className="h-4 w-4" />,
  },
  {
    platform: 'Facebook',
    posts: 18,
    engagement: 3.2,
    reach: 2100,
    color: 'indigo',
    icon: <Globe className="h-4 w-4" />,
  },
];

export default function SchedulingDashboard() {
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Content Scheduler
            </h1>
            <p className="text-gray-400 mt-2">
              Manage and schedule your social media content across all platforms
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              onClick={() => setShowCreateForm(true)}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0 shadow-lg shadow-purple-500/25"
            >
              <Plus className="h-4 w-4 mr-2" />
              Schedule Post
            </Button>
            <Button
              onClick={loadScheduledPosts}
              className="bg-white/20 border-white/20 text-white hover:bg-white/30"
            >
              <Activity className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Platform Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        {platformStats.map((stat) => (
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
                <div className="flex items-center gap-4 mt-2">
                  <div className="text-sm text-gray-400">
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {stat.engagement}%
                    </div>
                  </div>
                  <div className="text-sm text-gray-400">
                    <div className="flex items-center gap-1">
                      <Target className="h-3 w-3" />
                      {stat.reach.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <Tabs defaultValue="scheduled" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 bg-gray-800/50 border-white/10">
          <TabsTrigger value="scheduled" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
            <Clock className="h-4 w-4 mr-2" />
            Scheduled Posts
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
                  <h3 className="text-lg font-semibold text-white mb-2">No posts found</h3>
                  <p className="text-gray-400 mb-4">Get started by scheduling your first post</p>
                  <Button
                    onClick={() => setShowCreateForm(true)}
                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Schedule Post
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
                            <PlatformIcon platform={post.platform} size={14} showLabel />
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
                              <ImageIcon className="h-4 w-4" />
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
              <h3 className="text-lg font-semibold text-white mb-2">Published Posts</h3>
              <p className="text-gray-400">View your published content and analytics</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-8 text-center">
              <BarChart3 className="h-12 w-12 text-purple-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Analytics Dashboard</h3>
              <p className="text-gray-400">Track your content performance and engagement</p>
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
