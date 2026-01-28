import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Users, 
  TrendingUp, 
  MapPin, 
  Calendar,
  Target,
  RefreshCw,
  BarChart3
} from 'lucide-react';

export default function AudienceInsights() {
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [audienceData, setAudienceData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('campaignId');
    setCampaignId(id);
    
    if (id) {
      fetchAudienceData(id);
    }
  }, []);

  const fetchAudienceData = async (id: string) => {
    setIsLoading(true);
    try {
      // Simulate audience data - in real implementation, this would fetch from API
      const mockData = {
        totalAudience: 45000,
        demographics: {
          ageGroups: [
            { range: '18-24', percentage: 25, count: 11250 },
            { range: '25-34', percentage: 35, count: 15750 },
            { range: '35-44', percentage: 25, count: 11250 },
            { range: '45-54', percentage: 15, count: 6750 }
          ],
          genders: [
            { gender: 'Male', percentage: 55, count: 24750 },
            { gender: 'Female', percentage: 45, count: 20250 }
          ],
          locations: [
            { location: 'United States', percentage: 40, count: 18000 },
            { location: 'United Kingdom', percentage: 20, count: 9000 },
            { location: 'Canada', percentage: 15, count: 6750 },
            { location: 'Australia', percentage: 10, count: 4500 },
            { location: 'Other', percentage: 15, count: 6750 }
          ]
        },
        interests: [
          { interest: 'Technology', percentage: 30, count: 13500 },
          { interest: 'Business', percentage: 25, count: 11250 },
          { interest: 'Marketing', percentage: 20, count: 9000 },
          { interest: 'Entrepreneurship', percentage: 15, count: 6750 },
          { interest: 'Innovation', percentage: 10, count: 4500 }
        ],
        engagementPatterns: {
          peakHours: ['9:00 AM', '1:00 PM', '6:00 PM'],
          peakDays: ['Tuesday', 'Wednesday', 'Thursday'],
          deviceTypes: [
            { device: 'Mobile', percentage: 60, count: 27000 },
            { device: 'Desktop', percentage: 30, count: 13500 },
            { device: 'Tablet', percentage: 10, count: 4500 }
          ]
        }
      };
      
      setAudienceData(mockData);
    } catch (error) {
      console.error('Error fetching audience data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading audience insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
              <h1 className="text-2xl font-bold text-gray-900">Audience Insights</h1>
              <p className="text-gray-600">Target audience demographics and behavior</p>
            </div>
          </div>
        </div>

        {/* Total Audience */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="text-3xl font-bold text-gray-900">
                {audienceData?.totalAudience?.toLocaleString() || '0'}
              </div>
              <div className="text-sm text-gray-600">Total Audience Size</div>
            </div>
          </div>
        </div>

        {/* Demographics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Age Groups */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Age Groups</h3>
            <div className="space-y-3">
              {audienceData?.demographics?.ageGroups?.map((group: any, index: number) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{group.range} years</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full" 
                        style={{ width: `${group.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-12 text-right">
                      {group.percentage}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gender Distribution */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Gender Distribution</h3>
            <div className="space-y-3">
              {audienceData?.demographics?.genders?.map((gender: any, index: number) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{gender.gender}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-500 h-2 rounded-full" 
                        style={{ width: `${gender.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-12 text-right">
                      {gender.percentage}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Locations */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Locations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {audienceData?.demographics?.locations?.map((location: any, index: number) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-900">{location.location}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-purple-600">{location.percentage}%</div>
                  <div className="text-xs text-gray-500">{location.count.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Interests */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Interests</h3>
          <div className="space-y-3">
            {audienceData?.interests?.map((interest: any, index: number) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{interest.interest}</span>
                <div className="flex items-center gap-3">
                  <div className="w-40 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-orange-500 h-2 rounded-full" 
                      style={{ width: `${interest.percentage}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 w-12 text-right">
                    {interest.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Engagement Patterns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Peak Hours */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Peak Engagement Hours</h3>
            <div className="space-y-2">
              {audienceData?.engagementPatterns?.peakHours?.map((hour: string, index: number) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-900">{hour}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Device Types */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Device Usage</h3>
            <div className="space-y-3">
              {audienceData?.engagementPatterns?.deviceTypes?.map((device: any, index: number) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{device.device}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-purple-500 h-2 rounded-full" 
                        style={{ width: `${device.percentage}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 w-12 text-right">
                      {device.percentage}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}





