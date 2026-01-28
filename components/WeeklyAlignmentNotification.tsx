import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  Calendar, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Target, 
  TrendingUp,
  Eye,
  Edit3,
  Save,
  X,
  ArrowRight,
  RefreshCw,
  BarChart3
} from 'lucide-react';

interface WeeklyAlignment {
  id: string;
  campaignId: string;
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  theme: string;
  focusArea: string;
  contentTypes: string[];
  platforms: string[];
  objectives: string[];
  alignmentStatus: 'pending' | 'in-review' | 'aligned' | 'needs-adjustment' | 'completed';
  alignmentNotes?: string;
  plannedContentCount: number;
  createdContentCount: number;
  scheduledContentCount: number;
  publishedContentCount: number;
  engagementScore: number;
  reachScore: number;
  conversionScore: number;
}

interface WeeklyAlignmentNotificationProps {
  campaignId: string;
  onAlignmentComplete: (weekNumber: number) => void;
  onPlanReview: () => void;
}

export default function WeeklyAlignmentNotification({ 
  campaignId, 
  onAlignmentComplete, 
  onPlanReview 
}: WeeklyAlignmentNotificationProps) {
  const [currentWeek, setCurrentWeek] = useState<WeeklyAlignment | null>(null);
  const [upcomingWeeks, setUpcomingWeeks] = useState<WeeklyAlignment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showPlanReview, setShowPlanReview] = useState(false);
  const [alignmentNotes, setAlignmentNotes] = useState('');

  useEffect(() => {
    loadWeeklyAlignments();
  }, [campaignId]);

  const loadWeeklyAlignments = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/campaigns/weekly-alignments?campaignId=${campaignId}`);
      if (response.ok) {
        const data = await response.json();
        setCurrentWeek(data.currentWeek);
        setUpcomingWeeks(data.upcomingWeeks);
      }
    } catch (error) {
      console.error('Error loading weekly alignments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const alignWeek = async (weekNumber: number, status: string, notes?: string) => {
    try {
      const response = await fetch('/api/campaigns/weekly-alignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber,
          alignmentStatus: status,
          alignmentNotes: notes
        })
      });

      if (response.ok) {
        await loadWeeklyAlignments();
        onAlignmentComplete(weekNumber);
      }
    } catch (error) {
      console.error('Error aligning week:', error);
    }
  };

  const generateWeeklyNotification = async () => {
    try {
      const response = await fetch('/api/campaigns/weekly-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          weekNumber: currentWeek?.weekNumber,
          notificationType: 'alignment_reminder'
        })
      });

      if (response.ok) {
        // Show success message
        console.log('Weekly notification generated');
      }
    } catch (error) {
      console.error('Error generating notification:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'in-review': return 'text-blue-600 bg-blue-100';
      case 'aligned': return 'text-green-600 bg-green-100';
      case 'needs-adjustment': return 'text-orange-600 bg-orange-100';
      case 'completed': return 'text-purple-600 bg-purple-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="w-4 h-4" />;
      case 'in-review': return <Eye className="w-4 h-4" />;
      case 'aligned': return <CheckCircle className="w-4 h-4" />;
      case 'needs-adjustment': return <AlertCircle className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-orange-500" />
        <span className="ml-2 text-gray-600">Loading weekly alignments...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Week Alignment */}
      {currentWeek && (
        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-orange-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Bell className="w-6 h-6 text-orange-500" />
              <h3 className="text-lg font-semibold text-gray-900">
                Week {currentWeek.weekNumber} Alignment Required
              </h3>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(currentWeek.alignmentStatus)}`}>
                {getStatusIcon(currentWeek.alignmentStatus)}
                <span className="ml-1 capitalize">{currentWeek.alignmentStatus.replace('-', ' ')}</span>
              </span>
            </div>
            <div className="text-sm text-gray-500">
              {currentWeek.weekStartDate} - {currentWeek.weekEndDate}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h4 className="font-medium text-gray-900 mb-2">Theme & Focus</h4>
              <div className="space-y-2">
                <div>
                  <span className="text-sm font-medium text-gray-600">Theme:</span>
                  <span className="ml-2 text-sm text-gray-900">{currentWeek.theme}</span>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Focus:</span>
                  <span className="ml-2 text-sm text-gray-900">{currentWeek.focusArea}</span>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Objectives:</span>
                  <div className="mt-1">
                    {currentWeek.objectives.map((objective, index) => (
                      <span key={index} className="inline-block bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded mr-1 mb-1">
                        {objective}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-gray-900 mb-2">Content & Platforms</h4>
              <div className="space-y-2">
                <div>
                  <span className="text-sm font-medium text-gray-600">Content Types:</span>
                  <div className="mt-1">
                    {currentWeek.contentTypes.map((type, index) => (
                      <span key={index} className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded mr-1 mb-1">
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-600">Platforms:</span>
                  <div className="mt-1">
                    {currentWeek.platforms.map((platform, index) => (
                      <span key={index} className="inline-block bg-green-100 text-green-700 text-xs px-2 py-1 rounded mr-1 mb-1">
                        {platform}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Content Progress */}
          <div className="mb-6">
            <h4 className="font-medium text-gray-900 mb-3">Content Progress</h4>
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{currentWeek.plannedContentCount}</div>
                <div className="text-sm text-gray-600">Planned</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{currentWeek.createdContentCount}</div>
                <div className="text-sm text-gray-600">Created</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{currentWeek.scheduledContentCount}</div>
                <div className="text-sm text-gray-600">Scheduled</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{currentWeek.publishedContentCount}</div>
                <div className="text-sm text-gray-600">Published</div>
              </div>
            </div>
          </div>

          {/* Performance Scores */}
          <div className="mb-6">
            <h4 className="font-medium text-gray-900 mb-3">Performance Scores</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-xl font-bold text-purple-600">{currentWeek.engagementScore}%</div>
                <div className="text-sm text-gray-600">Engagement</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-blue-600">{currentWeek.reachScore}%</div>
                <div className="text-sm text-gray-600">Reach</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-green-600">{currentWeek.conversionScore}%</div>
                <div className="text-sm text-gray-600">Conversion</div>
              </div>
            </div>
          </div>

          {/* Alignment Actions */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="flex space-x-3">
                <button
                  onClick={() => alignWeek(currentWeek.weekNumber, 'aligned', alignmentNotes)}
                  className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Align Week
                </button>
                <button
                  onClick={() => alignWeek(currentWeek.weekNumber, 'needs-adjustment', alignmentNotes)}
                  className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  Needs Adjustment
                </button>
                <button
                  onClick={() => setShowPlanReview(true)}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Review Plan
                </button>
              </div>
              <button
                onClick={generateWeeklyNotification}
                className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                <Bell className="w-4 h-4 mr-1" />
                Generate Notification
              </button>
            </div>

            {/* Alignment Notes */}
            <div className="mt-4">
              <textarea
                value={alignmentNotes}
                onChange={(e) => setAlignmentNotes(e.target.value)}
                placeholder="Add alignment notes or adjustments..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                rows={3}
              />
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Weeks Preview */}
      {upcomingWeeks.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Weeks</h3>
          <div className="space-y-3">
            {upcomingWeeks.slice(0, 3).map((week) => (
              <div key={week.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Calendar className="w-5 h-5 text-gray-400" />
                  <div>
                    <div className="font-medium text-gray-900">Week {week.weekNumber}: {week.theme}</div>
                    <div className="text-sm text-gray-600">{week.focusArea}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(week.alignmentStatus)}`}>
                    {getStatusIcon(week.alignmentStatus)}
                    <span className="ml-1 capitalize">{week.alignmentStatus.replace('-', ' ')}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
