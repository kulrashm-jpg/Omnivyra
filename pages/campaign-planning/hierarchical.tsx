import React, { useState, useEffect } from 'react';
import { 
  TwelveWeekOverview, 
  WeekDetailView, 
  DayDetailView 
} from '../../components/HierarchicalNavigation';

type ViewType = 'overview' | 'week' | 'day';

interface NavigationState {
  currentView: ViewType;
  campaignId: string | null;
  weekNumber: number | null;
  day: string | null;
}

export default function HierarchicalCampaignPlanning() {
  const [navigationState, setNavigationState] = useState<NavigationState>({
    currentView: 'overview',
    campaignId: null,
    weekNumber: null,
    day: null
  });

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get campaign ID from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const campaignId = urlParams.get('campaignId');
    const week = urlParams.get('week');
    const day = urlParams.get('day');
    const convertAI = urlParams.get('convertAI');

    if (campaignId) {
      setNavigationState({
        currentView: day ? 'day' : week ? 'week' : 'overview',
        campaignId,
        weekNumber: week ? parseInt(week) : null,
        day: day || null
      });

      // If coming from AI conversion, show a success message
      if (convertAI) {
        setTimeout(() => {
          alert('AI content suggestions have been converted to weekly view! You can now navigate through the 12-week plan.');
        }, 1000);
      }
    }
    setIsLoading(false);
  }, []);

  const navigateToWeek = (weekNumber: number) => {
    setNavigationState(prev => ({
      ...prev,
      currentView: 'week',
      weekNumber,
      day: null
    }));
    
    // Update URL
    const newUrl = `/campaign-planning/hierarchical?campaignId=${navigationState.campaignId}&week=${weekNumber}`;
    window.history.pushState({}, '', newUrl);
  };

  const navigateToDay = (day: string) => {
    setNavigationState(prev => ({
      ...prev,
      currentView: 'day',
      day
    }));
    
    // Update URL
    const newUrl = `/campaign-planning/hierarchical?campaignId=${navigationState.campaignId}&week=${navigationState.weekNumber}&day=${day}`;
    window.history.pushState({}, '', newUrl);
  };

  const navigateBack = () => {
    if (navigationState.currentView === 'day') {
      setNavigationState(prev => ({
        ...prev,
        currentView: 'week',
        day: null
      }));
      
      const newUrl = `/campaign-planning/hierarchical?campaignId=${navigationState.campaignId}&week=${navigationState.weekNumber}`;
      window.history.pushState({}, '', newUrl);
    } else if (navigationState.currentView === 'week') {
      setNavigationState(prev => ({
        ...prev,
        currentView: 'overview',
        weekNumber: null,
        day: null
      }));
      
      const newUrl = `/campaign-planning/hierarchical?campaignId=${navigationState.campaignId}`;
      window.history.pushState({}, '', newUrl);
    }
  };

  const navigateToOverview = () => {
    setNavigationState({
      currentView: 'overview',
      campaignId: navigationState.campaignId,
      weekNumber: null,
      day: null
    });
    
    const newUrl = `/campaign-planning/hierarchical?campaignId=${navigationState.campaignId}`;
    window.history.pushState({}, '', newUrl);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-100 via-red-100 to-pink-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading campaign planning...</p>
        </div>
      </div>
    );
  }

  if (!navigationState.campaignId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-100 via-red-100 to-pink-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Campaign Not Found</h1>
          <p className="text-gray-600 mb-6">Please select a campaign to view the hierarchical planning.</p>
          <a 
            href="/campaign-planning"
            className="inline-flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
          >
            Go to Campaign Planning
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-100 via-red-100 to-pink-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Campaign Planning</h1>
              <p className="text-gray-600 mt-2">
                {navigationState.currentView === 'overview' && '12-Week Overview'}
                {navigationState.currentView === 'week' && `Week ${navigationState.weekNumber} Details`}
                {navigationState.currentView === 'day' && `${navigationState.day} - Week ${navigationState.weekNumber}`}
              </p>
            </div>
            
            {/* Navigation Controls */}
            <div className="flex items-center space-x-4">
              {navigationState.currentView !== 'overview' && (
                <button
                  onClick={navigateToOverview}
                  className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  Overview
                </button>
              )}
              
              <a 
                href={`/campaign-planning?campaignId=${navigationState.campaignId}`}
                className="flex items-center px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Planning
              </a>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {navigationState.currentView === 'overview' && (
            <TwelveWeekOverview 
              campaignId={navigationState.campaignId}
              onWeekSelect={navigateToWeek}
            />
          )}
          
          {navigationState.currentView === 'week' && navigationState.weekNumber && (
            <WeekDetailView 
              campaignId={navigationState.campaignId}
              weekNumber={navigationState.weekNumber}
              onDaySelect={navigateToDay}
              onBack={navigateBack}
            />
          )}
          
          {navigationState.currentView === 'day' && navigationState.weekNumber && navigationState.day && (
            <DayDetailView 
              campaignId={navigationState.campaignId}
              weekNumber={navigationState.weekNumber}
              day={navigationState.day}
              onBack={navigateBack}
            />
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>Hierarchical Campaign Planning • 12 Weeks → Week → Day Navigation</p>
        </div>
      </div>
    </div>
  );
}
