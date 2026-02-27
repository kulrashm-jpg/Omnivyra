import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Calendar,
  Clock,
  Users,
  Hash,
  Image,
  Video,
  Facebook,
  Edit3,
  Trash2,
  Eye,
  Play,
  Pause,
  RotateCcw,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings,
  BarChart3,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  XCircle
} from 'lucide-react';

interface ScheduledPost {
  id: string;
  title: string;
  content: string;
  platform: string;
  contentType: string;
  scheduledFor: string;
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'todo';
  itemType?: 'post' | 'reminder' | 'task';
  assignedTo?: string;
  assignedBy?: string;
  reminderLabel?: string;
  hashtags: string[];
  media: any[];
  engagement?: {
    likes: number;
    shares: number;
    comments: number;
    views: number;
  };
}

export default function CalendarView() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddType, setQuickAddType] = useState<'reminder' | 'task'>('reminder');
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddContent, setQuickAddContent] = useState('');
  const [quickAddDateTime, setQuickAddDateTime] = useState('');
  const [quickAddAssignee, setQuickAddAssignee] = useState('Junior Team');

  // Mock scheduled posts data
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([
    {
      id: '1',
      title: 'DrishiQ - AI for Healthcare',
      content: 'Revolutionizing healthcare with AI-powered solutions...',
      platform: 'linkedin',
      contentType: 'post',
      scheduledFor: '2024-01-20T09:00:00Z',
      status: 'scheduled',
      hashtags: ['AI', 'Healthcare', 'Innovation'],
      media: []
    },
    {
      id: '2',
      title: 'Machine Learning in Medical Diagnosis',
      content: 'How machine learning algorithms are transforming...',
      platform: 'twitter',
      contentType: 'tweet',
      scheduledFor: '2024-01-20T10:30:00Z',
      status: 'scheduled',
      hashtags: ['MachineLearning', 'Medical'],
      media: []
    },
    {
      id: '3',
      title: 'AI Healthcare Success Story',
      content: 'Real-world example of AI improving patient outcomes...',
      platform: 'instagram',
      contentType: 'feed_post',
      scheduledFor: '2024-01-21T14:00:00Z',
      status: 'published',
      hashtags: ['AI', 'Success', 'Healthcare'],
      media: [],
      engagement: {
        likes: 45,
        shares: 12,
        comments: 8,
        views: 234
      }
    },
    {
      id: '4',
      title: 'Healthcare AI Tutorial',
      content: 'Step-by-step guide to implementing AI in healthcare...',
      platform: 'youtube',
      contentType: 'video',
      scheduledFor: '2024-01-22T16:00:00Z',
      status: 'draft',
      hashtags: ['Tutorial', 'AI', 'Healthcare'],
      media: []
    }
  ]);

  const platforms = [
    { key: 'linkedin', name: 'LinkedIn', icon: <Users className="h-4 w-4" />, color: 'blue' },
    { key: 'twitter', name: 'Twitter', icon: <Hash className="h-4 w-4" />, color: 'sky' },
    { key: 'instagram', name: 'Instagram', icon: <Image className="h-4 w-4" />, color: 'pink' },
    { key: 'youtube', name: 'YouTube', icon: <Video className="h-4 w-4" />, color: 'red' },
    { key: 'facebook', name: 'Facebook', icon: <Facebook className="h-4 w-4" />, color: 'indigo' }
  ];

  const statusColors = {
    draft: 'gray',
    scheduled: 'blue',
    publishing: 'yellow',
    published: 'green',
    failed: 'red',
    todo: 'orange',
  };

  const teamMembers = ['Junior Team', 'Junior Creator', 'Junior Analyst'];

  const getPlatformIcon = (platform: string) => {
    const platformData = platforms.find(p => p.key === platform);
    return platformData?.icon || <Users className="h-4 w-4" />;
  };

  const getPlatformColor = (platform: string) => {
    const platformData = platforms.find(p => p.key === platform);
    return platformData?.color || 'gray';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft': return <Edit3 className="h-4 w-4" />;
      case 'scheduled': return <Clock className="h-4 w-4" />;
      case 'publishing': return <RotateCcw className="h-4 w-4 animate-spin" />;
      case 'published': return <CheckCircle className="h-4 w-4" />;
      case 'failed': return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const filteredPosts = scheduledPosts.filter(post => {
    const matchesPlatform = filterPlatform === 'all' || post.platform === filterPlatform;
    const matchesStatus = filterStatus === 'all' || post.status === filterStatus;
    const matchesSearch = searchTerm === '' || 
      post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.content.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesPlatform && matchesStatus && matchesSearch;
  });

  const getPostsForDate = (date: Date) => {
    return filteredPosts.filter(post => {
      const postDate = new Date(post.scheduledFor);
      return postDate.toDateString() === date.toDateString();
    });
  };

  const getWeekDays = (date: Date) => {
    const base = new Date(date);
    const start = new Date(base);
    start.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(start);
      d.setDate(start.getDate() + idx);
      return d;
    });
  };

  const navigatePeriod = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (viewMode === 'month') {
        newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
      } else if (viewMode === 'week') {
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
      } else {
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
      }
      return newDate;
    });
  };

  const getItemClasses = (post: ScheduledPost) => {
    if (post.itemType === 'reminder') return 'bg-violet-500/20 text-violet-200 border border-violet-400/30';
    if (post.itemType === 'task') return 'bg-orange-500/20 text-orange-200 border border-orange-400/30';
    if (post.status === 'published') return 'bg-green-500/20 text-green-300';
    if (post.status === 'scheduled') return 'bg-blue-500/20 text-blue-300';
    if (post.status === 'draft') return 'bg-gray-500/20 text-gray-300';
    if (post.status === 'failed') return 'bg-red-500/20 text-red-300';
    return 'bg-yellow-500/20 text-yellow-300';
  };

  const addQuickCalendarItem = () => {
    if (!quickAddTitle.trim() || !quickAddDateTime) return;
    const now = Date.now();
    const item: ScheduledPost = {
      id: `${quickAddType}-${now}`,
      title: quickAddTitle.trim(),
      content: quickAddContent.trim() || (quickAddType === 'reminder' ? 'Reminder item' : 'Assigned task'),
      platform: 'internal',
      contentType: quickAddType === 'reminder' ? 'reminder' : 'task',
      scheduledFor: new Date(quickAddDateTime).toISOString(),
      status: quickAddType === 'task' ? 'todo' : 'scheduled',
      itemType: quickAddType,
      assignedBy: quickAddType === 'task' ? 'Manager' : undefined,
      assignedTo: quickAddType === 'task' ? quickAddAssignee : undefined,
      reminderLabel: quickAddType === 'reminder' ? 'Reminder' : undefined,
      hashtags: [],
      media: [],
    };
    setScheduledPosts(prev => [item, ...prev]);
    setShowQuickAdd(false);
    setQuickAddTitle('');
    setQuickAddContent('');
    setQuickAddDateTime('');
    setQuickAddAssignee('Junior Team');
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };

  const formatDate = (date: Date) => {
    if (viewMode === 'week') {
      const days = getWeekDays(date);
      return `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    if (viewMode === 'day') {
      return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl mb-8">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold">Content Calendar</div>
                <div className="text-sm opacity-90">View and manage all your scheduled content</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => router.push('/multi-platform-scheduler')}
                className="bg-white/20 border-white/20 text-white hover:bg-white/30"
              >
                <Plus className="h-4 w-4 mr-2" />
                Schedule New
              </Button>
              <Button
                onClick={() => router.push('/ai-content-generator')}
                className="bg-white/20 border-white/20 text-white hover:bg-white/30"
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                AI Generate
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Filters and Search */}
      <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl mb-6">
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search posts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value)}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
              >
                <option value="all">All Platforms</option>
                {platforms.map(platform => (
                  <option key={platform.key} value={platform.key}>{platform.name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
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

      {/* Calendar View */}
      <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">
              {formatDate(currentDate)}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigatePeriod('prev')}
                variant="outline"
                size="sm"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => setCurrentDate(new Date())}
                variant="outline"
                size="sm"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                Today
              </Button>
              <Button
                onClick={() => navigatePeriod('next')}
                variant="outline"
                size="sm"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="ml-2 flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
                {(['month', 'week', 'day'] as const).map(v => (
                  <Button
                    key={v}
                    onClick={() => setViewMode(v)}
                    variant="outline"
                    size="sm"
                    className={viewMode === v ? 'bg-purple-500 text-white border-purple-400' : 'bg-transparent border-transparent text-gray-300 hover:text-white'}
                  >
                    {v[0].toUpperCase() + v.slice(1)}
                  </Button>
                ))}
              </div>
              <Button
                onClick={() => {
                  setQuickAddType('reminder');
                  setShowQuickAdd(true);
                }}
                variant="outline"
                size="sm"
                className="bg-violet-500/20 border-violet-400/40 text-violet-200 hover:bg-violet-500/30"
              >
                Reminder
              </Button>
              <Button
                onClick={() => {
                  setQuickAddType('task');
                  setShowQuickAdd(true);
                }}
                variant="outline"
                size="sm"
                className="bg-orange-500/20 border-orange-400/40 text-orange-200 hover:bg-orange-500/30"
              >
                Assign Task
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === 'month' && (
            <>
              <div className="grid grid-cols-7 gap-1 mb-4">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="p-2 text-center text-sm font-medium text-gray-400">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {getDaysInMonth(currentDate).map((date, index) => (
                  <div
                    key={index}
                    className={`min-h-[120px] p-2 border border-white/10 rounded-lg ${
                      date ? 'bg-white/5 hover:bg-white/10' : 'bg-transparent'
                    }`}
                  >
                    {date && (
                      <>
                        <div className="text-sm font-medium mb-2">
                          {date.getDate()}
                        </div>
                        <div className="space-y-1">
                          {getPostsForDate(date).slice(0, 3).map(post => (
                            <div
                              key={post.id}
                              className={`p-1 rounded text-xs cursor-pointer transition-all duration-200 hover:scale-105 ${getItemClasses(post)}`}
                              onClick={() => setSelectedPost(post)}
                            >
                              <div className="flex items-center gap-1">
                                {post.platform === 'internal' ? <AlertCircle className="h-3 w-3" /> : getPlatformIcon(post.platform)}
                                <span className="truncate">{post.title}</span>
                              </div>
                              <div className="text-xs opacity-75">
                                {formatTime(post.scheduledFor)}
                              </div>
                            </div>
                          ))}
                          {getPostsForDate(date).length > 3 && (
                            <div className="text-xs text-gray-400 text-center">
                              +{getPostsForDate(date).length - 3} more
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {viewMode === 'week' && (
            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {getWeekDays(currentDate).map((date) => {
                const items = getPostsForDate(date).sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
                return (
                  <div key={date.toISOString()} className="min-h-[220px] rounded-lg border border-white/10 bg-white/5 p-2">
                    <div className="text-xs text-gray-300 mb-2">
                      <div className="font-semibold">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      <div>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    </div>
                    <div className="space-y-1">
                      {items.length === 0 && <div className="text-xs text-gray-500">No items</div>}
                      {items.map(post => (
                        <button
                          key={post.id}
                          onClick={() => setSelectedPost(post)}
                          className={`w-full text-left p-2 rounded text-xs ${getItemClasses(post)}`}
                        >
                          <div className="font-medium truncate">{post.title}</div>
                          <div className="opacity-80">{formatTime(post.scheduledFor)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'day' && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-sm text-gray-300 mb-3">Daily timeline</div>
              <div className="space-y-2">
                {getPostsForDate(currentDate)
                  .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
                  .map(post => (
                    <button
                      key={post.id}
                      onClick={() => setSelectedPost(post)}
                      className={`w-full text-left p-3 rounded-lg ${getItemClasses(post)}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{post.title}</div>
                        <div className="text-xs opacity-80">{formatTime(post.scheduledFor)}</div>
                      </div>
                      <div className="text-xs mt-1 opacity-90">
                        {post.itemType === 'task' && post.assignedTo
                          ? `Task for ${post.assignedTo}`
                          : post.itemType === 'reminder'
                            ? 'Reminder'
                            : `Platform: ${post.platform}`}
                      </div>
                    </button>
                  ))}
                {getPostsForDate(currentDate).length === 0 && (
                  <div className="text-sm text-gray-500">No items for this day.</div>
                )}
              </div>
            </div>
          )}
          <div className="mt-4 flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 text-violet-200"><span className="w-2 h-2 rounded-full bg-violet-400" /> Reminder</span>
            <span className="inline-flex items-center gap-1 text-orange-200"><span className="w-2 h-2 rounded-full bg-orange-400" /> Manager Task</span>
            <span className="inline-flex items-center gap-1 text-blue-200"><span className="w-2 h-2 rounded-full bg-blue-400" /> Scheduled Post</span>
          </div>
        </CardContent>
      </Card>

      {showQuickAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="bg-gradient-to-br from-gray-800/70 to-black/70 border-white/10 max-w-lg w-full">
            <CardHeader>
              <CardTitle>{quickAddType === 'reminder' ? 'Set Reminder' : 'Assign Task to Junior'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                type="text"
                value={quickAddTitle}
                onChange={(e) => setQuickAddTitle(e.target.value)}
                placeholder={quickAddType === 'reminder' ? 'Reminder title' : 'Task title'}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400"
              />
              <textarea
                value={quickAddContent}
                onChange={(e) => setQuickAddContent(e.target.value)}
                placeholder="Notes"
                rows={3}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400"
              />
              <input
                type="datetime-local"
                value={quickAddDateTime}
                onChange={(e) => setQuickAddDateTime(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
              />
              {quickAddType === 'task' && (
                <select
                  value={quickAddAssignee}
                  onChange={(e) => setQuickAddAssignee(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                >
                  {teamMembers.map(member => (
                    <option key={member} value={member}>{member}</option>
                  ))}
                </select>
              )}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowQuickAdd(false)}
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                >
                  Cancel
                </Button>
                <Button
                  onClick={addQuickCalendarItem}
                  className={quickAddType === 'reminder' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-orange-600 hover:bg-orange-700'}
                >
                  {quickAddType === 'reminder' ? 'Add Reminder' : 'Assign Task'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Selected Post Details Modal */}
      {selectedPost && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getPlatformIcon(selectedPost.platform)}
                  <span>{selectedPost.title}</span>
                  <Badge 
                    variant="secondary" 
                    className={`bg-${statusColors[selectedPost.status]}-500/20 text-${statusColors[selectedPost.status]}-300`}
                  >
                    {selectedPost.status}
                  </Badge>
                </div>
                <Button
                  onClick={() => setSelectedPost(null)}
                  variant="outline"
                  size="sm"
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                >
                  ×
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Content</h4>
                <p className="text-gray-300 text-sm">{selectedPost.content}</p>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Hashtags</h4>
                <div className="flex flex-wrap gap-1">
                  {selectedPost.hashtags.map(hashtag => (
                    <Badge key={hashtag} variant="outline" className="text-xs">
                      #{hashtag}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-2">Platform</h4>
                  <div className="flex items-center gap-2">
                    {getPlatformIcon(selectedPost.platform)}
                    <span className="capitalize">{selectedPost.platform}</span>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Content Type</h4>
                  <span className="capitalize">{selectedPost.contentType.replace('_', ' ')}</span>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Scheduled For</h4>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>{new Date(selectedPost.scheduledFor).toLocaleString()}</span>
                </div>
              </div>
              
              {selectedPost.engagement && (
                <div>
                  <h4 className="font-medium mb-2">Engagement</h4>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-blue-400">{selectedPost.engagement.likes}</div>
                      <div className="text-xs text-gray-400">Likes</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-green-400">{selectedPost.engagement.shares}</div>
                      <div className="text-xs text-gray-400">Shares</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-purple-400">{selectedPost.engagement.comments}</div>
                      <div className="text-xs text-gray-400">Comments</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-orange-400">{selectedPost.engagement.views}</div>
                      <div className="text-xs text-gray-400">Views</div>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex gap-2 pt-4">
                <Button
                  onClick={() => router.push(`/multi-platform-scheduler?edit=${selectedPost.id}`)}
                  className="flex-1 bg-purple-500 hover:bg-purple-600"
                >
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button
                  onClick={() => router.push(`/creative-scheduler?edit=${selectedPost.id}`)}
                  className="flex-1 bg-blue-500 hover:bg-blue-600"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  AI Edit
                </Button>
                <Button
                  variant="outline"
                  className="bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
