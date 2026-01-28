/**
 * Activity Feed Component
 * 
 * Displays user activity and system events in a feed format
 * - User actions (campaign creation, post scheduling, etc.)
 * - System events (publish success, errors, etc.)
 * - Filterable by type, user, date
 * - Real-time updates
 */

import { useState, useEffect } from 'react';
import {
  Calendar,
  User,
  FileText,
  Send,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Filter,
  RefreshCw,
} from 'lucide-react';

interface Activity {
  id: string;
  user_id: string;
  user_name?: string;
  action_type: string;
  entity_type: string;
  entity_id: string;
  description: string;
  metadata?: any;
  created_at: string;
}

interface ActivityFeedProps {
  userId?: string;
  campaignId?: string;
  limit?: number;
  showFilters?: boolean;
  className?: string;
}

export default function ActivityFeed({
  userId,
  campaignId,
  limit = 50,
  showFilters = true,
  className = '',
}: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterAction, setFilterAction] = useState<string>('all');

  useEffect(() => {
    loadActivities();
  }, [userId, campaignId, filterType, filterAction]);

  const loadActivities = async () => {
    // Get user_id if not provided
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      try {
        const userResponse = await fetch('/api/auth/me');
        if (userResponse.ok) {
          const userData = await userResponse.json();
          effectiveUserId = userData.user_id || process.env.DEFAULT_USER_ID;
        } else {
          effectiveUserId = process.env.DEFAULT_USER_ID || '';
        }
      } catch (error) {
        effectiveUserId = process.env.DEFAULT_USER_ID || '';
      }
    }

    if (!effectiveUserId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('user_id', effectiveUserId);
      if (campaignId) params.append('campaign_id', campaignId);
      params.append('limit', limit.toString());
      if (filterType !== 'all') params.append('entity_type', filterType);
      if (filterAction !== 'all') params.append('action_type', filterAction);

      const response = await fetch(`/api/activity/feed?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setActivities(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load activities:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (actionType: string) => {
    switch (actionType.toLowerCase()) {
      case 'create':
      case 'created':
        return <FileText className="w-4 h-4 text-blue-600" />;
      case 'update':
      case 'updated':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'publish':
      case 'published':
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'delete':
      case 'deleted':
      case 'error':
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'schedule':
      case 'scheduled':
        return <Calendar className="w-4 h-4 text-purple-600" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-600" />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const filteredActivities = activities;

  if (loading && activities.length === 0) {
    return (
      <div className={`${className} flex items-center justify-center py-12`}>
        <div className="text-gray-500">Loading activities...</div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header with Filters */}
      {showFilters && (
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Activity Feed</h3>
          <div className="flex items-center space-x-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="campaign">Campaigns</option>
              <option value="post">Posts</option>
              <option value="media">Media</option>
              <option value="template">Templates</option>
            </select>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Actions</option>
              <option value="create">Created</option>
              <option value="update">Updated</option>
              <option value="delete">Deleted</option>
              <option value="publish">Published</option>
              <option value="schedule">Scheduled</option>
            </select>
            <button
              onClick={loadActivities}
              className="p-1.5 text-gray-600 hover:text-gray-800"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Activities List */}
      <div className="space-y-3">
        {filteredActivities.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <AlertCircle className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p>No activities found</p>
          </div>
        ) : (
          filteredActivities.map((activity) => (
            <div
              key={activity.id}
              className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-1">
                  {getActionIcon(activity.action_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-900">
                      {activity.description}
                    </p>
                    <span className="text-xs text-gray-500 ml-2">
                      {formatTime(activity.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                    {activity.user_name && (
                      <span className="flex items-center space-x-1">
                        <User className="w-3 h-3" />
                        <span>{activity.user_name}</span>
                      </span>
                    )}
                    <span className="px-2 py-0.5 bg-gray-100 rounded capitalize">
                      {activity.action_type}
                    </span>
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded capitalize">
                      {activity.entity_type}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

