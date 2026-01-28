import { NextApiRequest, NextApiResponse } from 'next';

// In-memory storage for demo purposes
// In production, this would be a database
let campaignLearnings: any[] = [
  {
    campaignId: 'campaign-1',
    campaignName: 'Q4 2023 Brand Awareness',
    goals: [
      { contentType: 'article', quantity: 10, platform: 'linkedin' },
      { contentType: 'video', quantity: 5, platform: 'youtube' }
    ],
    performance: {
      engagement: 4.2,
      reach: 12500,
      conversions: 45,
      actualResults: [
        { platform: 'linkedin', engagement: 4.5, reach: 8500 },
        { platform: 'youtube', engagement: 3.8, reach: 4000 }
      ]
    },
    learnings: [
      'LinkedIn articles performed 25% better than expected',
      'Video content on YouTube had lower engagement but higher reach',
      'Tuesday-Thursday posting times generated 40% higher engagement'
    ],
    improvements: [
      'Focus more on LinkedIn content creation',
      'Optimize YouTube thumbnails for better engagement',
      'Schedule more content for mid-week posting'
    ]
  },
  {
    campaignId: 'campaign-2',
    campaignName: 'Product Launch 2024',
    goals: [
      { contentType: 'image', quantity: 15, platform: 'instagram' },
      { contentType: 'article', quantity: 8, platform: 'linkedin' }
    ],
    performance: {
      engagement: 5.8,
      reach: 18900,
      conversions: 67,
      actualResults: [
        { platform: 'instagram', engagement: 6.2, reach: 12000 },
        { platform: 'linkedin', engagement: 5.4, reach: 6900 }
      ]
    },
    learnings: [
      'Instagram image posts exceeded engagement targets by 30%',
      'LinkedIn articles generated high-quality leads',
      'Story content performed better than feed posts on Instagram'
    ],
    improvements: [
      'Increase Instagram story frequency',
      'Create more LinkedIn thought leadership content',
      'Cross-promote content between platforms'
    ]
  }
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Get all campaign learnings
    res.status(200).json({ learnings: campaignLearnings });
    
  } else if (req.method === 'POST') {
    // Add new campaign learning
    const { learning } = req.body;
    
    if (!learning) {
      return res.status(400).json({ error: 'Learning data is required' });
    }

    campaignLearnings.push(learning);
    
    res.status(200).json({ success: true });
    
  } else if (req.method === 'PUT') {
    // Update campaign learning with actual results
    const { campaignId, actualResults } = req.body;
    
    if (!campaignId || !actualResults) {
      return res.status(400).json({ error: 'Campaign ID and actual results are required' });
    }

    const learningIndex = campaignLearnings.findIndex(l => l.campaignId === campaignId);
    
    if (learningIndex === -1) {
      return res.status(404).json({ error: 'Campaign learning not found' });
    }

    // Update with actual results and generate new learnings
    const updatedLearning = {
      ...campaignLearnings[learningIndex],
      performance: {
        ...campaignLearnings[learningIndex].performance,
        ...actualResults
      },
      learnings: generateLearningsFromResults(campaignLearnings[learningIndex], actualResults),
      improvements: generateImprovementsFromResults(campaignLearnings[learningIndex], actualResults)
    };

    campaignLearnings[learningIndex] = updatedLearning;
    
    res.status(200).json({ success: true, learning: updatedLearning });
    
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

function generateLearningsFromResults(campaign: any, actualResults: any): string[] {
  const learnings = [];
  
  // Compare predicted vs actual performance
  if (actualResults.engagement > campaign.performance.engagement) {
    learnings.push(`Campaign exceeded engagement expectations by ${((actualResults.engagement / campaign.performance.engagement - 1) * 100).toFixed(1)}%`);
  } else {
    learnings.push(`Campaign engagement was ${((1 - actualResults.engagement / campaign.performance.engagement) * 100).toFixed(1)}% below expectations`);
  }

  if (actualResults.reach > campaign.performance.reach) {
    learnings.push(`Reach exceeded targets by ${((actualResults.reach / campaign.performance.reach - 1) * 100).toFixed(1)}%`);
  }

  // Platform-specific learnings
  if (actualResults.platformPerformance) {
    actualResults.platformPerformance.forEach((platform: any) => {
      if (platform.engagement > 5) {
        learnings.push(`${platform.platform} generated high engagement (${platform.engagement}%)`);
      }
    });
  }

  return learnings;
}

function generateImprovementsFromResults(campaign: any, actualResults: any): string[] {
  const improvements = [];
  
  // Suggest improvements based on performance
  if (actualResults.engagement < campaign.performance.engagement) {
    improvements.push('Focus on content quality and audience targeting');
  }

  if (actualResults.reach < campaign.performance.reach) {
    improvements.push('Increase content frequency and optimize posting times');
  }

  // Platform-specific improvements
  if (actualResults.platformPerformance) {
    actualResults.platformPerformance.forEach((platform: any) => {
      if (platform.engagement < 3) {
        improvements.push(`Optimize ${platform.platform} content strategy`);
      }
    });
  }

  return improvements;
}
