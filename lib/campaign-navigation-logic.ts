// LOGICAL CAMPAIGN FLOW IMPLEMENTATION
// This file contains the corrected navigation flow and button logic

// ==============================================
// NAVIGATION FLOW OVERVIEW
// ==============================================

/*
CURRENT FLOW (BROKEN):
Dashboard → Campaign Planning → Campaign Plan
Campaigns List → Campaign Planning → Campaign Plan

CORRECTED FLOW (LOGICAL):
1. Dashboard/Campaigns List → Shows all campaigns
2. "Create Campaign" → Opens NEW campaign creation
3. "View Campaign" → Opens existing campaign details
4. Campaign Details → Shows campaign plan summary
5. Each Week → Expandable with AI enhancement [+]

FLOW STRUCTURE:
- /campaigns (Campaign List) - Shows all campaigns
- /campaign-planning (Campaign Creation/Editing) - Create or edit campaigns
- /campaign-details/[id] (Campaign Overview) - View campaign with campaign plan
- /campaign-week/[id]/[week] (Week Details) - Individual week planning
*/

// ==============================================
// CORRECTED BUTTON LOGIC
// ==============================================

// 1. CAMPAIGN LIST PAGE (/campaigns)
const CampaignListButtons = {
  // Primary action - Create new campaign
  createCampaign: {
    text: "Create New Campaign",
    action: () => window.location.href = '/campaign-planner?mode=direct',
    style: "primary-green"
  },
  
  // Secondary action - View campaign details
  viewCampaign: (campaignId) => ({
    text: "View Campaign",
    action: () => window.location.href = `/campaign-details/${campaignId}`,
    style: "secondary-purple"
  }),
  
  // Tertiary action - open campaign details (edit entrypoint removed)
  editCampaign: (campaignId) => ({
    text: "View Campaign", 
    action: () => window.location.href = `/campaign-details/${campaignId}`,
    style: "tertiary-purple"
  })
};

// 2. CAMPAIGN PLANNING PAGE (/campaign-planning)
const CampaignPlanningButtons = {
  // When creating new campaign
  createMode: {
    saveDraft: {
      text: "Save Draft",
      action: "saveCampaign",
      style: "secondary-gray"
    },
    generate12Week: {
      text: "Generate Campaign Plan",
      action: "generate12WeekPlan", 
      style: "primary-orange"
    },
    continueToDetails: {
      text: "View Campaign Details",
      action: "continueToDetails",
      style: "primary-purple"
    }
  },
  
  // When editing existing campaign
  editMode: {
    saveChanges: {
      text: "Save Changes",
      action: "saveCampaign",
      style: "secondary-gray"
    },
    view12Week: {
      text: "View Campaign Plan", 
      action: "view12WeekPlan",
      style: "primary-orange"
    },
    backToCampaigns: {
      text: "Back to Campaigns",
      action: "backToCampaigns",
      style: "tertiary-gray"
    }
  }
};

// 3. CAMPAIGN DETAILS PAGE (/campaign-details/[id])
const CampaignDetailsButtons = {
  // Campaign overview actions
  editCampaign: {
    text: "Edit Campaign",
    action: "editCampaign",
    style: "secondary-blue"
  },
  
  // Campaign plan actions
  generateWeek: (weekNumber) => ({
    text: `Generate Week ${weekNumber}`,
    action: `generateWeek${weekNumber}`,
    style: "secondary-orange"
  }),
  
  // AI enhancement for weeks
  enhanceWeek: (weekNumber) => ({
    text: "[+] AI Enhance",
    action: `enhanceWeek${weekNumber}`,
    style: "ai-purple"
  }),
  
  // Navigation
  backToCampaigns: {
    text: "Back to Campaigns",
    action: "backToCampaigns", 
    style: "tertiary-gray"
  }
};

// ==============================================
// IMPLEMENTATION PLAN
// ==============================================

/*
STEP 1: Fix Campaign List Page (/campaigns)
- "Create Campaign" → Opens /campaign-planning?mode=create
- "View Campaign" → Opens /campaign-details/[id]
- Edit entrypoint removed from campaign list actions

STEP 2: Fix Campaign Planning Page (/campaign-planning)
- Mode=create: Show creation buttons (Save Draft, Generate Campaign Plan, View Details)
- Generate Campaign Plan → Creates campaign structure and links to campaign

STEP 3: Create Campaign Details Page (/campaign-details/[id])
- Shows campaign overview
- Shows campaign plan summary
- Each week expandable with AI enhancement [+]

STEP 4: Enhance Campaign Plan Integration
- Link AI chat to specific campaign
- Generate content for specific weeks
- Save improvements back to campaign
*/

// ==============================================
// ROUTE STRUCTURE
// ==============================================

const Routes = {
  // Main navigation
  dashboard: '/',
  campaigns: '/campaigns',
  
  // Campaign management
  createCampaign: '/campaign-planner?mode=direct',
  editCampaign: (id) => `/campaign-details/${id}`,
  viewCampaign: (id) => `/campaign-details/${id}`,
  
  // Week-specific planning
  weekDetails: (campaignId, weekNumber) => `/campaign-week/${campaignId}/${weekNumber}`,
  
  // AI integration
  aiChat: (campaignId, context) => `/ai-chat?campaignId=${campaignId}&context=${context}`
};

// ==============================================
// BUTTON COMPONENT LOGIC
// ==============================================

const ButtonLogic = {
  // Determine which buttons to show based on current state
  getButtonsForPage: (page, mode, campaignId) => {
    switch (page) {
      case 'campaigns':
        return CampaignListButtons;
        
      case 'campaign-planning':
        return mode === 'create' 
          ? CampaignPlanningButtons.createMode
          : CampaignPlanningButtons.editMode;
          
      case 'campaign-details':
        return CampaignDetailsButtons;
        
      default:
        return {};
    }
  },
  
  // Handle button clicks with proper navigation
  handleButtonClick: (buttonType, params) => {
    switch (buttonType) {
      case 'createCampaign':
        window.location.href = Routes.createCampaign;
        break;
        
      case 'viewCampaign':
        window.location.href = Routes.viewCampaign(params.campaignId);
        break;
        
      case 'editCampaign':
        window.location.href = Routes.editCampaign(params.campaignId);
        break;
        
      case 'generate12Week':
        // Generate campaign plan and link to campaign
        AIIntegration.generate12WeekPlan(params.campaignId);
        break;
        
      case 'enhanceWeek':
        // Open AI chat for specific week enhancement
        window.location.href = Routes.aiChat(params.campaignId, `week-${params.weekNumber}`);
        break;
        
      default:
        console.log('Unknown button type:', buttonType);
    }
  }
};

// ==============================================
// AI INTEGRATION LOGIC
// ==============================================

const AIIntegration = {
  // Link AI chat to specific campaign
  openAIChat: (campaignId, context) => {
    const aiUrl = Routes.aiChat(campaignId, context);
    window.open(aiUrl, '_blank', 'width=800,height=600');
  },
  
  // Generate campaign plan for campaign
  generate12WeekPlan: async (campaignId) => {
    try {
      const response = await fetch('/api/campaigns/create-12week-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          startDate: new Date().toISOString().split('T')[0],
          aiContent: 'Generate comprehensive content marketing plan',
          provider: 'demo'
        })
      });
      
      if (response.ok) {
        // Redirect to campaign details to view the generated plan
        window.location.href = Routes.viewCampaign(campaignId);
      }
    } catch (error) {
      console.error('Error generating campaign plan:', error);
    }
  },
  
  // Enhance specific week with AI
  enhanceWeek: async (campaignId, weekNumber) => {
    try {
      const response = await fetch('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          week: weekNumber,
          theme: `Week ${weekNumber} Theme`,
          contentFocus: `Week ${weekNumber} Content Focus`,
          targetAudience: 'General Audience'
        })
      });
      
      if (response.ok) {
        // Refresh the page to show enhanced content
        window.location.reload();
      }
    } catch (error) {
      console.error('Error enhancing week:', error);
    }
  }
};

export { 
  CampaignListButtons, 
  CampaignPlanningButtons, 
  CampaignDetailsButtons,
  Routes,
  ButtonLogic,
  AIIntegration 
};



