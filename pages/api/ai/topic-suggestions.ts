
/**
 * Unified API for AI topic suggestions.
 * GET: load default suggestions
 * POST with suggestions: save (no-op in mock)
 * POST with count/category/platforms: generate new topics (parametric)
 */
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGetSuggestions(req, res);
  } else if (req.method === 'POST') {
    const body = req.body || {};
    if (Array.isArray(body.suggestions)) {
      return handleSaveSuggestions(req, res);
    }
    if (typeof body.count === 'number' || (body.category && Array.isArray(body.platforms))) {
      return handleGenerateTopics(req, res);
    }
    return handleSaveSuggestions(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGetSuggestions(req, res) {
  try {
    const suggestions = [
      { id: '1', title: 'AI-Powered Content Creation', description: 'Explore how artificial intelligence is revolutionizing content creation and marketing strategies.', trending: true, platforms: ['LinkedIn', 'Twitter', 'YouTube'], suggestedContent: 'AI tools are transforming how we create content.' },
      { id: '2', title: 'Remote Work Productivity', description: 'Tips and strategies for maintaining productivity in remote work environments.', trending: true, platforms: ['LinkedIn', 'Facebook', 'Instagram'], suggestedContent: 'Remote work has become the new normal.' },
      { id: '3', title: 'Sustainable Business Practices', description: 'How businesses can implement sustainable practices for long-term success.', trending: false, platforms: ['LinkedIn', 'Twitter', 'Facebook'], suggestedContent: 'Sustainability is good for business.' },
      { id: '4', title: 'Digital Marketing Trends 2024', description: 'Latest trends and predictions for digital marketing in 2024.', trending: true, platforms: ['LinkedIn', 'Twitter', 'YouTube', 'Facebook'], suggestedContent: '2024 is bringing exciting changes.' },
      { id: '5', title: 'Personal Branding Strategies', description: 'Build a strong personal brand that stands out.', trending: false, platforms: ['LinkedIn', 'Instagram', 'YouTube'], suggestedContent: 'Your personal brand is your most valuable asset.' },
      { id: '6', title: 'Mental Health in Tech', description: 'Addressing mental health challenges in the technology industry.', trending: true, platforms: ['LinkedIn', 'Twitter', 'Facebook'], suggestedContent: 'Tech industry mental health is critical.' },
      { id: '7', title: 'Your Custom Topic', description: 'Description of your custom topic here.', trending: false, platforms: ['LinkedIn', 'Twitter'], suggestedContent: 'Your suggested content approach here.' },
    ];
    res.status(200).json({ success: true, suggestions });
  } catch (error) {
    console.error('Error loading topic suggestions:', error);
    res.status(500).json({ success: false, error: 'Failed to load topic suggestions' });
  }
}

async function handleGenerateTopics(req, res) {
  try {
    const { count = 5, category = 'Technology', platforms = ['LinkedIn', 'Twitter'] } = req.body || {};
    const generatedTopics = generateAITopics(count, category, platforms);
    res.status(200).json({ success: true, topics: generatedTopics });
  } catch (error) {
    console.error('Error generating AI topics:', error);
    res.status(500).json({ success: false, error: 'Failed to generate AI topics' });
  }
}

function generateAITopics(count, category, platforms) {
  const topicTemplates = {
    Technology: [
      { title: 'The Future of {technology}', description: 'Exploring how {technology} is reshaping industries.', suggestedContent: 'As {technology} continues to evolve.' },
      { title: '{technology} Best Practices', description: 'Essential strategies for {technology}.', suggestedContent: 'Learn proven methods.' },
      { title: 'Common {technology} Mistakes to Avoid', description: 'Critical pitfalls in {technology}.', suggestedContent: 'Avoid costly mistakes.' },
    ],
    Business: [
      { title: 'Building a {business_type} Strategy', description: 'Guide to {business_type} strategies.', suggestedContent: 'Strategic approach.' },
      { title: 'Leadership in {industry}', description: 'Leadership for {industry}.', suggestedContent: 'Essential skills.' },
    ],
    Marketing: [
      { title: '{marketing_type} Trends 2024', description: 'Trends in {marketing_type}.', suggestedContent: 'Stay ahead.' },
      { title: 'ROI of {marketing_strategy}', description: 'Returns from {marketing_strategy}.', suggestedContent: 'Proven methods.' },
    ],
  };
  const technologies = ['AI', 'Blockchain', 'Cloud Computing', 'IoT', 'Machine Learning', 'Cybersecurity'];
  const businessTypes = ['Digital Transformation', 'Customer Experience', 'Innovation', 'Sustainability'];
  const industries = ['Tech', 'Healthcare', 'Finance', 'Retail', 'Manufacturing'];
  const marketingTypes = ['Digital', 'Content', 'Social Media', 'Email', 'Influencer'];
  const marketingStrategies = ['Content Marketing', 'Social Media', 'Email Campaigns', 'SEO', 'PPC'];
  const templates = topicTemplates[category] || topicTemplates.Technology;
  const topics = [];

  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length];
    let title = template.title;
    let description = template.description;
    let suggestedContent = template.suggestedContent;

    if (category === 'Technology') {
      const tech = technologies[Math.floor(Math.random() * technologies.length)];
      title = title.replace(/\{technology\}/g, tech);
      description = description.replace(/\{technology\}/g, tech);
      suggestedContent = suggestedContent.replace(/\{technology\}/g, tech);
    } else if (category === 'Business') {
      const bt = businessTypes[Math.floor(Math.random() * businessTypes.length)];
      const ind = industries[Math.floor(Math.random() * industries.length)];
      title = title.replace(/\{business_type\}/g, bt).replace(/\{industry\}/g, ind);
      description = description.replace(/\{business_type\}/g, bt).replace(/\{industry\}/g, ind);
      suggestedContent = suggestedContent.replace(/\{business_type\}/g, bt).replace(/\{industry\}/g, ind);
    } else if (category === 'Marketing') {
      const mt = marketingTypes[Math.floor(Math.random() * marketingTypes.length)];
      const ms = marketingStrategies[Math.floor(Math.random() * marketingStrategies.length)];
      title = title.replace(/\{marketing_type\}/g, mt).replace(/\{marketing_strategy\}/g, ms);
      description = description.replace(/\{marketing_type\}/g, mt).replace(/\{marketing_strategy\}/g, ms);
      suggestedContent = suggestedContent.replace(/\{marketing_type\}/g, mt).replace(/\{marketing_strategy\}/g, ms);
    }

    topics.push({
      title,
      description,
      trending: Math.random() > 0.6,
      platforms,
      suggestedContent,
      category,
      tags: [category.toLowerCase(), 'ai-generated'],
    });
  }
  return topics;
}

async function handleSaveSuggestions(req, res) {
  try {
    const { suggestions } = req.body;
    console.log('Saving topics:', suggestions);
    res.status(200).json({ success: true, message: 'Topics saved successfully', suggestions: suggestions || [] });
  } catch (error) {
    console.error('Error saving topic suggestions:', error);
    res.status(500).json({ success: false, error: 'Failed to save topic suggestions' });
  }
}
