import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Calendar, 
  Plus,
  Edit3,
  Trash2,
  Clock,
  Users,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Filter,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export default function ContentCalendar() {
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [calendarData, setCalendarData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('campaignId');
    setCampaignId(id);
    
    if (id) {
      fetchCalendarData(id);
    }
  }, []);

  const fetchCalendarData = async (id: string) => {
    setIsLoading(true);
    try {
      // Simulate calendar data - in real implementation, this would fetch from API
      const mockData = {
        scheduledPosts: [
          {
            id: '1',
            title: 'LinkedIn Professional Post',
            content: 'Sharing insights about digital transformation...',
            platform: 'linkedin',
            scheduledTime: '2024-01-15T09:00:00Z',
            status: 'scheduled',
            engagement: { likes: 45, comments: 12, shares: 8 }
          },
          {
            id: '2',
            title: 'Instagram Story',
            content: 'Behind the scenes of our product development...',
            platform: 'instagram',
            scheduledTime: '2024-01-15T14:00:00Z',
            status: 'scheduled',
            engagement: { likes: 120, comments: 25, shares: 15 }
          },
          {
            id: '3',
            title: 'Twitter Thread',
            content: 'Thread about the future of AI in business...',
            platform: 'twitter',
            scheduledTime: '2024-01-16T10:00:00Z',
            status: 'scheduled',
            engagement: { likes: 89, comments: 18, shares: 22 }
          },
          {
            id: '4',
            title: 'Facebook Community Post',
            content: 'Engaging with our community about upcoming features...',
            platform: 'facebook',
            scheduledTime: '2024-01-16T16:00:00Z',
            status: 'scheduled',
            engagement: { likes: 156, comments: 34, shares: 19 }
          },
          {
            id: '5',
            title: 'YouTube Short',
            content: 'Quick tip about productivity hacks...',
            platform: 'youtube',
            scheduledTime: '2024-01-17T12:00:00Z',
            status: 'scheduled',
            engagement: { likes: 234, comments: 45, shares: 67 }
          }
        ]
      };
      
      setCalendarData(mockData);
    } catch (error) {
      console.error('Error fetching calendar data:', error);
    } finally {
      setIsLoading(false);
    }
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

  const getPostsForDate = (date: Date) => {
    if (!calendarData?.scheduledPosts) return [];
    
    const dateStr = date.toISOString().split('T')[0];
    return calendarData.scheduledPosts.filter((post: any) => 
      post.scheduledTime.startsWith(dateStr)
    );
  };

  const getPlatformColor = (platform: string) => {
    const colors: { [key: string]: string } = {
      linkedin: 'bg-blue-100 text-blue-700',
      facebook: 'bg-blue-100 text-blue-700',
      instagram: 'bg-pink-100 text-pink-700',
      twitter: 'bg-sky-100 text-sky-700',
      youtube: 'bg-red-100 text-red-700',
      tiktok: 'bg-gray-100 text-gray-700'
    };
    return colors[platform] || 'bg-gray-100 text-gray-700';
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Calendar className="w-8 h-8 animate-pulse text-purple-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading content calendar...</p>
        </div>
      </div>
    );
  }

  const days = getDaysInMonth(currentDate);
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.history.back()}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Campaign
            </button>
            
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Content Calendar</h1>
              <p className="text-gray-600">Schedule and manage your content</p>
            </div>
          </div>
          
          <button className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
            <Plus className="w-4 h-4" />
            Schedule Post
          </button>
        </div>

        {/* Calendar Navigation */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => navigateMonth('prev')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <button 
                onClick={() => navigateMonth('next')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Day Headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
                {day}
              </div>
            ))}
            
            {/* Calendar Days */}
            {days.map((day, index) => {
              if (!day) {
                return <div key={index} className="h-24"></div>;
              }
              
              const posts = getPostsForDate(day);
              const isToday = day.toDateString() === new Date().toDateString();
              const isSelected = selectedDate?.toDateString() === day.toDateString();
              
              return (
                <div
                  key={index}
                  onClick={() => setSelectedDate(day)}
                  className={`h-24 p-2 border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors ${
                    isToday ? 'bg-blue-50 border-blue-200' : ''
                  } ${isSelected ? 'bg-purple-50 border-purple-200' : ''}`}
                >
                  <div className="text-sm font-medium text-gray-900 mb-1">
                    {day.getDate()}
                  </div>
                  <div className="space-y-1">
                    {posts.slice(0, 2).map((post: any) => (
                      <div
                        key={post.id}
                        className={`text-xs px-1 py-0.5 rounded ${getPlatformColor(post.platform)}`}
                      >
                        {post.platform}
                      </div>
                    ))}
                    {posts.length > 2 && (
                      <div className="text-xs text-gray-500">
                        +{posts.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scheduled Posts List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Scheduled Posts</h2>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select className="text-sm border border-gray-300 rounded px-2 py-1">
                <option value="all">All Platforms</option>
                <option value="linkedin">LinkedIn</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="twitter">Twitter</option>
                <option value="youtube">YouTube</option>
              </select>
            </div>
          </div>

          <div className="space-y-4">
            {calendarData?.scheduledPosts?.map((post: any) => (
              <div key={post.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getPlatformColor(post.platform)}`}>
                    <span className="text-xs font-semibold">
                      {post.platform.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">{post.title}</h3>
                    <p className="text-sm text-gray-600">{post.content.substring(0, 100)}...</p>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(post.scheduledTime).toLocaleString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {post.engagement.likes} likes
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {post.engagement.comments} comments
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    post.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                    post.status === 'published' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {post.status}
                  </span>
                  <button className="p-1 hover:bg-gray-100 rounded text-gray-600">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button className="p-1 hover:bg-gray-100 rounded text-gray-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}





