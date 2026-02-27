// Test Page for Scheduling System
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Clock,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Activity,
  CheckCircle,
  AlertCircle,
  Zap,
  BarChart3,
} from 'lucide-react';

interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface QueueJob {
  id: string;
  post: {
    platform: string;
    content: string;
    scheduledFor: string;
  };
  scheduledFor: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export default function QueueTestPage() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  const loadQueueStats = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/queue/stats');
      const data = await response.json();
      
      if (data.success) {
        setStats(data.data.stats);
        setJobs(data.data.jobs.all);
      }
    } catch (error) {
      console.error('Error loading queue stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const testSchedulePost = async () => {
    try {
      const response = await fetch('/api/schedule/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'linkedin',
          contentType: 'post',
          content: `Test post scheduled at ${new Date().toLocaleString()} - This is a test of the scheduling system! 🚀`,
          hashtags: ['#test', '#scheduling'],
          mediaUrls: [],
          scheduledFor: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 minutes from now
        }),
      });
      const data = await response.json();
      
      if (data.success) {
        notify('success', 'Test post scheduled successfully.');
        loadQueueStats();
      } else {
        notify('error', `Failed to schedule: ${data.error}`);
      }
    } catch (error) {
      console.error('Error scheduling test post:', error);
      notify('error', 'Failed to schedule test post.');
    }
  };

  const testImmediatePost = async () => {
    try {
      const response = await fetch('/api/schedule/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'twitter',
          contentType: 'tweet',
          content: `Immediate test post at ${new Date().toLocaleString()} - Testing immediate posting! ⚡`,
          hashtags: ['#immediate', '#test'],
          mediaUrls: [],
          scheduledFor: new Date().toISOString(), // Now
        }),
      });
      const data = await response.json();
      
      if (data.success) {
        notify('success', 'Immediate test post created.');
        loadQueueStats();
      } else {
        notify('error', `Failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Error creating immediate test post:', error);
      notify('error', 'Failed to create immediate test post.');
    }
  };

  useEffect(() => {
    loadQueueStats();
    // Refresh every 5 seconds
    const interval = setInterval(loadQueueStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'processing': return 'bg-yellow-500';
      case 'failed': return 'bg-red-500';
      case 'pending': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'processing': return <Zap className="h-4 w-4" />;
      case 'failed': return <AlertCircle className="h-4 w-4" />;
      case 'pending': return <Clock className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      {notice && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${notice.type === 'success' ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : notice.type === 'error' ? 'border-red-400/50 bg-red-500/20 text-red-200' : 'border-indigo-400/50 bg-indigo-500/20 text-indigo-200'}`} role="status" aria-live="polite">{notice.message}</div>
      )}
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          Queue Test Dashboard
        </h1>
        <p className="text-gray-400 mt-2">
          Test and monitor the scheduling and posting queue system
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-blue-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{stats.total}</p>
                  <p className="text-sm text-gray-400">Total Jobs</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-blue-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{stats.pending}</p>
                  <p className="text-sm text-gray-400">Pending</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Zap className="h-8 w-8 text-yellow-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{stats.processing}</p>
                  <p className="text-sm text-gray-400">Processing</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-8 w-8 text-green-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{stats.completed}</p>
                  <p className="text-sm text-gray-400">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-8 w-8 text-red-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{stats.failed}</p>
                  <p className="text-sm text-gray-400">Failed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Test Controls */}
      <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl mb-8">
        <CardHeader>
          <CardTitle className="text-xl text-white">Test Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Button
              onClick={testSchedulePost}
              className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white border-0"
            >
              <Clock className="h-4 w-4 mr-2" />
              Schedule Test Post (2 min)
            </Button>
            <Button
              onClick={testImmediatePost}
              className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white border-0"
            >
              <Zap className="h-4 w-4 mr-2" />
              Immediate Test Post
            </Button>
            <Button
              onClick={loadQueueStats}
              disabled={isLoading}
              className="bg-white/20 border-white/20 text-white hover:bg-white/30"
            >
              <Activity className="h-4 w-4 mr-2" />
              {isLoading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Jobs List */}
      <Card className="bg-gradient-to-br from-gray-800/50 to-black/50 border-white/10 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-xl text-white">Queue Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No jobs in queue</h3>
              <p className="text-gray-400">Create some test posts to see them here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="p-4 border border-gray-700 rounded-lg bg-white/5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className={`${getStatusColor(job.status)} text-white`}>
                          <div className="flex items-center gap-1">
                            {getStatusIcon(job.status)}
                            {job.status}
                          </div>
                        </Badge>
                        <span className="text-sm text-gray-400">
                          {job.post.platform.toUpperCase()}
                        </span>
                        <span className="text-sm text-gray-400">
                          Attempt {job.attempts}/{job.maxAttempts}
                        </span>
                      </div>
                      
                      <p className="text-gray-300 mb-2 line-clamp-2">
                        {job.post.content}
                      </p>
                      
                      <div className="flex items-center gap-4 text-sm text-gray-400">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {new Date(job.scheduledFor).toLocaleString()}
                        </div>
                        {job.nextRetryAt && (
                          <div className="flex items-center gap-1">
                            <RotateCcw className="h-4 w-4" />
                            Retry: {new Date(job.nextRetryAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}























