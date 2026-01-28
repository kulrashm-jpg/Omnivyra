/**
 * Team Collaboration Page
 * 
 * Team collaboration hub with:
 * - Activity feed
 * - Team assignments
 * - Notifications
 * - Task management
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import { Users, Bell, Clipboard, Activity } from 'lucide-react';
import ActivityFeed from '../components/ActivityFeed';
import TeamAssignment from '../components/TeamAssignment';

export default function TeamCollaboration() {
  const router = useRouter();
  const { campaignId, id } = router.query;
  const campaignIdParam = (campaignId || id) as string; // Support both query param formats
  const [activeTab, setActiveTab] = useState<'activity' | 'assignments' | 'notifications'>('activity');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Team Collaboration</h1>
          <p className="text-gray-600">Manage team assignments and track activities</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('activity')}
              className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'activity'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Activity className="w-4 h-4 inline mr-2" />
              Activity Feed
            </button>
            <button
              onClick={() => setActiveTab('assignments')}
              className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'assignments'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Users className="w-4 h-4 inline mr-2" />
              Assignments
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'notifications'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Bell className="w-4 h-4 inline mr-2" />
              Notifications
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'activity' && (
          <div className="bg-white rounded-lg shadow p-6">
            {campaignIdParam ? (
              <ActivityFeed campaignId={campaignIdParam} showFilters={true} />
            ) : (
              <ActivityFeed showFilters={true} />
            )}
          </div>
        )}

        {activeTab === 'assignments' && (
          <div>
            {campaignIdParam ? (
              <TeamAssignment campaignId={campaignIdParam} />
            ) : (
              <div className="bg-white rounded-lg shadow p-6 text-center">
                <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600 mb-2">Please select a campaign to view assignments</p>
                <button
                  onClick={() => router.push('/campaigns')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  View Campaigns
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-center py-12">
              <Bell className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">Notifications feature coming soon</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

