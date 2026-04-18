import type { CampaignLearning } from './types';

export function generateDemoResponse(
  userMessage: string,
  context: string,
  campaignData: any,
  learnings: CampaignLearning[]
): string {
  const responses = {
    'campaign-planning': [
      `Based on your campaign "${campaignData?.name || 'current campaign'}" and learnings from ${learnings.length} previous campaigns, I recommend focusing on high-engagement content types. Your past campaigns showed that video content performed 25% better than text posts.`,
      `Looking at your campaign goals and historical data, I suggest creating a content mix of 60% educational, 30% promotional, and 10% entertaining content. This ratio worked well in your previous campaigns.`,
      `I can see from your past campaigns that LinkedIn and Twitter performed best for your audience. Let me help you optimize your content strategy based on this data.`,
    ],
    'market-analysis': [
      `Analyzing trends for your campaign "${campaignData?.name || 'current campaign'}" and comparing with your ${learnings.length} previous campaigns, I see opportunities in AI content creation (+45% growth). Your past campaigns in this area showed 30% higher engagement.`,
      `Based on your campaign history, I notice that competitor analysis helped improve your reach by 40% in previous campaigns. Let me analyze current competitors for your industry.`,
      `Your past campaigns showed that posting on Tuesday-Thursday at 2-4 PM generated the highest engagement. I'll factor this into your current campaign analysis.`,
    ],
    'content-creation': [
      `For your campaign "${campaignData?.name || 'current campaign'}", I'll create content based on what worked in your ${learnings.length} previous campaigns. Your audience responded best to storytelling posts and how-to guides.`,
      `Looking at your campaign goals and past performance, I suggest creating 3 LinkedIn articles, 5 Twitter posts, and 2 Instagram stories. This mix generated 35% higher engagement in your previous campaigns.`,
      `Based on your campaign data, I'll adapt content for each platform using the strategies that worked best in your past campaigns.`,
    ],
    'schedule-review': [
      `Reviewing your campaign schedule against ${learnings.length} previous campaigns, I notice optimal posting times that could increase engagement by 25%. Your past campaigns showed best results on weekdays.`,
      `Based on your campaign history, I suggest adjusting Instagram posts to peak hours (2-4 PM) as this timing worked best in your previous campaigns.`,
      `Your past campaigns showed that spreading content across 3-4 days per week generated 40% higher reach. Let me optimize your current schedule accordingly.`,
    ],
    general: [
      `I'm here to help with your campaign "${campaignData?.name || 'current campaign'}" using insights from your ${learnings.length} previous campaigns. What specific area would you like assistance with?`,
      `I can help with campaign planning, market analysis, content creation, or scheduling optimization, all informed by your past campaign performance data.`,
      `Let me know what you'd like to work on, and I'll provide guidance based on your campaign history and proven strategies.`,
    ],
  };

  const contextResponses = responses[context as keyof typeof responses] || responses.general;
  return contextResponses[Math.floor(Math.random() * contextResponses.length)];
}
