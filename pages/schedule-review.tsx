import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Target, 
  CheckCircle,
  Clock,
  Calendar,
  Save,
  Play,
  AlertCircle,
  Eye,
  Loader2
} from 'lucide-react';
import CampaignAIChat from '../components/CampaignAIChat';

export default function ScheduleReview() {
  const [activeTab, setActiveTab] = useState('overview');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignData, setCampaignData] = useState<any>(null);
  const [scheduleReview, setScheduleReview] = useState<any>(null);

  // Initialize campaign data from URL params ONLY if explicitly passed
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const existingCampaignId = urlParams.get('campaignId');
    
    if (existingCampaignId) {
      loadCampaignData(existingCampaignId);
    }
    // Don't generate campaign ID here - only use if passed from campaign flow
  }, []);

  const loadCampaignData = async (id: string) => {
    setIsLoading(true);
    try {
      // Load campaign data
      const campaignResponse = await fetch(`/api/campaigns?type=campaign&campaignId=${id}`);
      if (campaignResponse.ok) {
        const campaignResult = await campaignResponse.json();
        setCampaignData(campaignResult.campaign);
        setCampaignId(id);
      }

      // Load schedule review if exists
      const reviewResponse = await fetch(`/api/campaigns?type=schedule-review&campaignId=${id}`);
      if (reviewResponse.ok) {
        const reviewResult = await reviewResponse.json();
        setScheduleReview(reviewResult.review);
      }
    } catch (error) {
      console.error('Error loading campaign data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const launchCampaign = async () => {
    if (!campaignId) return;
    
    // Create schedule review
    try {
      const reviewData = {
        campaignId,
        reviewData: {
          approved: true,
          launchDate: new Date().toISOString(),
          status: 'active'
        },
        optimizations: [
          'Optimized posting times based on audience activity',
          'Cross-platform content distribution strategy',
          'AI-generated content quality review completed'
        ],
        finalSchedule: [],
        approved: true
      };

      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'schedule-review',
          data: reviewData
        })
      });

      if (response.ok) {
        // Update campaign status to active
        const updateResponse = await fetch('/api/campaigns', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'campaign',
            data: {
              id: campaignId,
              status: 'active',
              currentStage: 'active'
            }
          })
        });

        if (updateResponse.ok) {
          // Navigate back to main dashboard
          window.location.href = '/';
        }
      }
    } catch (error) {
      console.error('Error launching campaign:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-100 via-red-100 to-pink-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-200/90 via-red-200/90 to-pink-200/90 backdrop-blur-sm border-b border-orange-300/50 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = `/content-creation?campaignId=${campaignId}`}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                  Schedule Review
                </h1>
                <p className="text-gray-600 mt-1">Review and finalize your campaign schedule</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors">
                Save Draft
              </button>
              <button 
                onClick={launchCampaign}
                disabled={isLoading || !campaignId}
                className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
              >
                <Play className="h-5 w-5" />
                Launch Campaign
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Campaign Flow Review */}
            <div className="bg-gradient-to-br from-orange-100/80 via-red-100/80 to-pink-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-orange-300/50 p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-orange-500 to-red-600 rounded-lg">
                  <Eye className="h-6 w-6 text-white" />
                </div>
                Campaign Flow Review
              </h2>
              
              <div className="text-center py-12">
                <div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Schedule Review Coming Soon</h3>
                <p className="text-gray-600">This page will show your complete campaign flow and allow final tweaks before scheduling</p>
              </div>
            </div>
          </div>

          {/* AI Chat Sidebar */}
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-orange-100/80 via-red-100/80 to-pink-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-orange-300/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-orange-500 to-red-600 rounded-lg">
                  <Clock className="h-5 w-5 text-white" />
                </div>
                AI Schedule Optimizer
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Get AI suggestions for optimal scheduling and timing
              </p>
              <button className="w-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200">
                Optimize Schedule
              </button>
            </div>

            <div className="bg-gradient-to-br from-orange-100/80 via-red-100/80 to-pink-100/80 backdrop-blur-sm rounded-2xl shadow-lg border border-orange-300/50 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Schedule Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Posts:</span>
                  <span className="font-semibold text-gray-900">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Scheduled:</span>
                  <span className="font-semibold text-gray-900">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ready to Launch:</span>
                  <span className="font-semibold text-gray-900">0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Campaign Duration:</span>
                  <span className="font-semibold text-gray-900">0 days</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Campaign-Specific AI Chat Modal */}
      <CampaignAIChat 
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        onMinimize={() => setIsChatOpen(false)}
        context="schedule-review"
        campaignId={campaignId}
        campaignData={campaignData}
      />
    </div>
  );
}
