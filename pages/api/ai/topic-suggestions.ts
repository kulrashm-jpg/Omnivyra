// API endpoint for AI topic suggestions
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGetSuggestions(req, res);
  } else if (req.method === 'POST') {
    return handleSaveSuggestions(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGetSuggestions(req, res) {
  try {
    // Simulate AI topic suggestions
    const suggestions = [
      {
        id: '1',
        title: 'AI-Powered Content Creation',
        description: 'Explore how artificial intelligence is revolutionizing content creation and marketing strategies.',
        trending: true,
        platforms: ['LinkedIn', 'Twitter', 'YouTube'],
        suggestedContent: 'AI tools are transforming how we create content, from automated writing to personalized marketing campaigns.'
      },
      {
        id: '2',
        title: 'Remote Work Productivity',
        description: 'Tips and strategies for maintaining productivity in remote work environments.',
        trending: true,
        platforms: ['LinkedIn', 'Facebook', 'Instagram'],
        suggestedContent: 'Remote work has become the new normal. Here are proven strategies to stay productive and connected.'
      },
      {
        id: '3',
        title: 'Sustainable Business Practices',
        description: 'How businesses can implement sustainable practices for long-term success.',
        trending: false,
        platforms: ['LinkedIn', 'Twitter', 'Facebook'],
        suggestedContent: 'Sustainability isn\'t just good for the planet - it\'s good for business. Here\'s how to get started.'
      },
      {
        id: '4',
        title: 'Digital Marketing Trends 2024',
        description: 'Latest trends and predictions for digital marketing in 2024.',
        trending: true,
        platforms: ['LinkedIn', 'Twitter', 'YouTube', 'Facebook'],
        suggestedContent: '2024 is bringing exciting changes to digital marketing. Here are the trends you need to know.'
      },
      {
        id: '5',
        title: 'Personal Branding Strategies',
        description: 'Build a strong personal brand that stands out in today\'s competitive market.',
        trending: false,
        platforms: ['LinkedIn', 'Instagram', 'YouTube'],
        suggestedContent: 'Your personal brand is your most valuable asset. Here\'s how to build one that resonates.'
      },
      {
        id: '6',
        title: 'Mental Health in Tech',
        description: 'Addressing mental health challenges in the technology industry.',
        trending: true,
        platforms: ['LinkedIn', 'Twitter', 'Facebook'],
        suggestedContent: 'Tech industry mental health is a critical topic. Let\'s discuss how to create healthier work environments.'
      },
      // Add your custom topics here
      {
        id: '7',
        title: 'Your Custom Topic',
        description: 'Description of your custom topic here.',
        trending: false,
        platforms: ['LinkedIn', 'Twitter'],
        suggestedContent: 'Your suggested content approach here.'
      }
    ];

    res.status(200).json({
      success: true,
      suggestions: suggestions
    });
  } catch (error) {
    console.error('Error loading topic suggestions:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load topic suggestions' 
    });
  }
}

async function handleSaveSuggestions(req, res) {
  try {
    const { suggestions } = req.body;
    
    // In a real application, you would save this to a database
    // For now, we'll just return success
    console.log('Saving topics:', suggestions);
    
    res.status(200).json({
      success: true,
      message: 'Topics saved successfully',
      suggestions: suggestions
    });
  } catch (error) {
    console.error('Error saving topic suggestions:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to save topic suggestions' 
    });
  }
}
