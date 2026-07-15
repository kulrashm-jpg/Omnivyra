import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { ContentAnalyzer } from '@/lib/content-analyzer';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { content, platforms, topic, hashtags, mediaType } = req.body;

    if (!content || !platforms || platforms.length === 0) {
      return res.status(400).json({ 
        error: 'Content and platforms are required' 
      });
    }

    console.log('Analyzing content:', { content: content.substring(0, 100), platforms, topic });

    // Analyze content using real APIs
    const analysis = await ContentAnalyzer.analyzeContent({
      content,
      platforms,
      topic,
      hashtags: hashtags || [],
      mediaType: mediaType || 'text'
    });

    console.log('Analysis completed:', {
      topic: analysis.topic,
      overallScore: analysis.overallScore,
      uniquenessScore: analysis.uniquenessScore,
      repetitionRisk: analysis.repetitionRisk
    });

    res.status(200).json(analysis);

  } catch (error: any) {
    console.error('Content analysis error:', error);
    res.status(500).json({ 
      error: 'Content analysis failed',
      details: error.message 
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analyze/content' });
