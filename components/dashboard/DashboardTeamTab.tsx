import React from 'react';
import { Users, CheckCircle, Calendar, UserPlus, Settings, Eye, Heart, ExternalLink, Share, BarChart3, TrendingUp } from 'lucide-react';
import { useRouter } from 'next/router';

export function DashboardTeamTab() {
  return (
    <div className="space-y-8">
      {/* Team Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm font-medium">Team Members</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">0</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-500">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm font-medium">Active Members</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">0</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-500">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm font-medium">Pending Invites</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">0</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-500">
              <Calendar className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Team Members */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-gray-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Team Members</h2>
            <button
              onClick={() => window.location.href = '/team-management'}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Users className="h-4 w-4" />
              Manage Team
            </button>
          </div>
        </div>
        <div className="p-4 sm:p-6 text-sm text-gray-600">
          Team data is available in Team Management.
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 border-l-4 border-l-indigo-500 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <UserPlus className="h-5 w-5 text-indigo-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Invite Team Member</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">Add new team members to collaborate on campaigns</p>
          <button
            onClick={() => window.location.href = '/team-management'}
            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Invite Now
          </button>
        </div>

        <div className="bg-white border border-gray-200 border-l-4 border-l-emerald-500 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-50 rounded-lg">
              <Settings className="h-5 w-5 text-emerald-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Team Settings</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">Manage roles, permissions, and team preferences</p>
          <button
            onClick={() => window.location.href = '/team-management'}
            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Manage Settings
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardIntegrationsTab() {
  const router = useRouter();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Integrations &amp; Lead Capture</h2>
        <p className="text-sm text-gray-500">Connect external tools, capture leads from your website, and manage webhook connections.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Lead Capture</h3>
              <p className="text-xs text-gray-500">Forms, embeds &amp; webhook connections</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">Build embeddable forms for your website, connect external forms via webhook, and view all captured leads in one place.</p>
          <button
            onClick={() => router.push('/leads')}
            className="mt-auto w-full px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Open Lead Capture →
          </button>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Integrations</h3>
              <p className="text-xs text-gray-500">WordPress, webhooks &amp; blog APIs</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">Connect WordPress, custom blog APIs, and outbound lead webhooks to automate publishing and data routing.</p>
          <button
            onClick={() => router.push('/integrations')}
            className="mt-auto w-full px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 transition-colors"
          >
            Open Integrations →
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardAnalyticsTab() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div><p className="text-gray-600 text-sm font-medium">Total Reach</p><p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">0</p></div>
            <div className="p-3 rounded-xl bg-blue-500"><Eye className="h-6 w-6 text-white" /></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div><p className="text-gray-600 text-sm font-medium">Total Engagement</p><p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">0</p></div>
            <div className="p-3 rounded-xl bg-rose-500"><Heart className="h-6 w-6 text-white" /></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div><p className="text-gray-600 text-sm font-medium">Total Clicks</p><p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">0</p></div>
            <div className="p-3 rounded-xl bg-emerald-500"><ExternalLink className="h-6 w-6 text-white" /></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between">
            <div><p className="text-gray-600 text-sm font-medium">Total Shares</p><p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">0</p></div>
            <div className="p-3 rounded-xl bg-violet-500"><Share className="h-6 w-6 text-white" /></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 border-l-4 border-l-blue-500 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3"><div className="p-2 bg-blue-50 rounded-lg"><BarChart3 className="h-5 w-5 text-blue-600" /></div><h3 className="text-base font-semibold text-gray-900">View Analytics</h3></div>
          <p className="text-sm text-gray-500 mb-4">Detailed performance metrics and insights</p>
          <button onClick={() => window.location.href = '/analytics'} className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Open Analytics</button>
        </div>
        <div className="bg-white border border-gray-200 border-l-4 border-l-emerald-500 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3"><div className="p-2 bg-emerald-50 rounded-lg"><TrendingUp className="h-5 w-5 text-emerald-600" /></div><h3 className="text-base font-semibold text-gray-900">Performance Report</h3></div>
          <p className="text-sm text-gray-500 mb-4">Generate comprehensive performance reports</p>
          <button onClick={() => window.location.href = '/analytics'} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Generate Report</button>
        </div>
      </div>
    </div>
  );
}
