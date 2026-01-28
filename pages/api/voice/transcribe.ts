import { NextApiRequest, NextApiResponse } from 'next';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

// Voice transcription API using Whisper (OpenAI) and AssemblyAI
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audioFile, provider = 'whisper', context = 'campaign-planning' } = req.body;

    if (!audioFile) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    let transcription;
    
    if (provider === 'whisper') {
      transcription = await transcribeWithWhisper(audioFile);
    } else if (provider === 'assemblyai') {
      transcription = await transcribeWithAssemblyAI(audioFile);
    } else {
      return res.status(400).json({ error: 'Invalid provider. Use "whisper" or "assemblyai"' });
    }

    // Process transcription for campaign planning context
    const processedTranscription = await processTranscriptionForCampaign(transcription, context);

    res.status(200).json({
      success: true,
      transcription: processedTranscription.text,
      confidence: processedTranscription.confidence,
      duration: processedTranscription.duration,
      keywords: processedTranscription.keywords,
      suggestions: processedTranscription.suggestions,
      provider: provider
    });

  } catch (error: any) {
    console.error('Voice transcription error:', error);
    res.status(500).json({ 
      error: 'Transcription failed',
      details: error.message 
    });
  }
}

async function transcribeWithWhisper(audioFile: any) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // Convert base64 to buffer if needed
  let audioBuffer;
  if (typeof audioFile === 'string' && audioFile.startsWith('data:')) {
    const base64Data = audioFile.split(',')[1];
    audioBuffer = Buffer.from(base64Data, 'base64');
  } else {
    audioBuffer = audioFile;
  }

  // Create form data for Whisper API
  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: 'voice-note.webm',
    contentType: 'audio/webm'
  });
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  formData.append('response_format', 'verbose_json');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
    },
    body: formData as any
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.statusText}`);
  }

  const result = await response.json();
  return {
    text: result.text,
    confidence: result.confidence || 0.95,
    duration: result.duration || 0,
    language: result.language || 'en'
  };
}

async function transcribeWithAssemblyAI(audioFile: any) {
  const assemblyApiKey = process.env.ASSEMBLYAI_API_KEY;
  
  if (!assemblyApiKey) {
    throw new Error('AssemblyAI API key not configured');
  }

  // Convert audio file to buffer
  let audioBuffer;
  if (typeof audioFile === 'string' && audioFile.startsWith('data:')) {
    const base64Data = audioFile.split(',')[1];
    audioBuffer = Buffer.from(base64Data, 'base64');
  } else {
    audioBuffer = audioFile;
  }

  // Upload audio file to AssemblyAI
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      'Authorization': assemblyApiKey,
      'Content-Type': 'application/octet-stream'
    },
    body: audioBuffer
  });

  if (!uploadResponse.ok) {
    throw new Error(`AssemblyAI upload error: ${uploadResponse.statusText}`);
  }

  const { upload_url } = await uploadResponse.json();

  // Start transcription
  const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': assemblyApiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'en_us',
      punctuate: true,
      format_text: true,
      auto_highlights: true,
      sentiment_analysis: true,
      entity_detection: true
    })
  });

  if (!transcriptResponse.ok) {
    throw new Error(`AssemblyAI transcript error: ${transcriptResponse.statusText}`);
  }

  const { id } = await transcriptResponse.json();

  // Poll for completion
  let completed = false;
  let attempts = 0;
  const maxAttempts = 30;

  while (!completed && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'Authorization': assemblyApiKey }
    });

    const statusData = await statusResponse.json();
    
    if (statusData.status === 'completed') {
      return {
        text: statusData.text,
        confidence: statusData.confidence || 0.95,
        duration: statusData.audio_duration || 0,
        language: statusData.language_code || 'en',
        highlights: statusData.auto_highlights_result?.results || [],
        sentiment: statusData.sentiment_analysis_results || [],
        entities: statusData.entities || []
      };
    } else if (statusData.status === 'error') {
      throw new Error(`AssemblyAI transcription failed: ${statusData.error}`);
    }
    
    attempts++;
  }

  throw new Error('Transcription timeout');
}

async function processTranscriptionForCampaign(transcription: any, context: string) {
  // Extract keywords and generate suggestions based on context
  const keywords = extractKeywords(transcription.text);
  
  let suggestions = [];
  
  if (context === 'campaign-planning') {
    suggestions = await generateCampaignSuggestions(transcription.text, keywords);
  } else if (context === 'weekly-planning') {
    suggestions = await generateWeeklySuggestions(transcription.text, keywords);
  } else if (context === 'daily-planning') {
    suggestions = await generateDailySuggestions(transcription.text, keywords);
  }

  return {
    text: transcription.text,
    confidence: transcription.confidence,
    duration: transcription.duration,
    keywords: keywords,
    suggestions: suggestions,
    highlights: transcription.highlights || [],
    sentiment: transcription.sentiment || [],
    entities: transcription.entities || []
  };
}

function extractKeywords(text: string): string[] {
  // Simple keyword extraction - in production, use NLP libraries
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  const stopWords = new Set(['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other', 'after', 'first', 'well', 'also', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall']);
  
  const wordCount = new Map();
  words.forEach(word => {
    if (!stopWords.has(word)) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
  });
  
  return Array.from(wordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

async function generateCampaignSuggestions(text: string, keywords: string[]): Promise<any[]> {
  // Generate campaign planning suggestions based on voice note
  const suggestions = [];
  
  // Look for campaign-related keywords
  const campaignKeywords = ['campaign', 'strategy', 'goal', 'target', 'audience', 'content', 'social', 'marketing'];
  const hasCampaignKeywords = campaignKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );
  
  if (hasCampaignKeywords) {
    suggestions.push({
      type: 'campaign-goal',
      title: 'Define Campaign Goals',
      description: 'Based on your voice note, consider defining specific, measurable goals for your campaign.',
      action: 'add-goal'
    });
  }
  
  // Look for content ideas
  if (text.toLowerCase().includes('content') || text.toLowerCase().includes('post')) {
    suggestions.push({
      type: 'content-idea',
      title: 'Content Ideas',
      description: 'Your voice note contains content ideas. Would you like to add them to your campaign?',
      action: 'add-content'
    });
  }
  
  // Look for platform mentions
  const platforms = ['linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'tiktok'];
  const mentionedPlatforms = platforms.filter(platform => 
    text.toLowerCase().includes(platform)
  );
  
  if (mentionedPlatforms.length > 0) {
    suggestions.push({
      type: 'platform-selection',
      title: 'Platform Strategy',
      description: `You mentioned ${mentionedPlatforms.join(', ')}. Consider focusing your campaign on these platforms.`,
      action: 'select-platforms',
      platforms: mentionedPlatforms
    });
  }
  
  return suggestions;
}

async function generateWeeklySuggestions(text: string, keywords: string[]): Promise<any[]> {
  const suggestions = [];
  
  // Look for weekly themes
  if (text.toLowerCase().includes('theme') || text.toLowerCase().includes('focus')) {
    suggestions.push({
      type: 'weekly-theme',
      title: 'Weekly Theme',
      description: 'Extract the weekly theme from your voice note and apply it to your content planning.',
      action: 'set-theme'
    });
  }
  
  // Look for content types
  const contentTypes = ['post', 'video', 'story', 'article', 'poll', 'live'];
  const mentionedTypes = contentTypes.filter(type => 
    text.toLowerCase().includes(type)
  );
  
  if (mentionedTypes.length > 0) {
    suggestions.push({
      type: 'content-types',
      title: 'Content Types',
      description: `Plan ${mentionedTypes.join(', ')} content for this week.`,
      action: 'plan-content-types',
      contentTypes: mentionedTypes
    });
  }
  
  return suggestions;
}

async function generateDailySuggestions(text: string, keywords: string[]): Promise<any[]> {
  const suggestions = [];
  
  // Look for daily activities
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const mentionedDays = days.filter(day => 
    text.toLowerCase().includes(day)
  );
  
  if (mentionedDays.length > 0) {
    suggestions.push({
      type: 'daily-activities',
      title: 'Daily Activities',
      description: `Schedule activities for ${mentionedDays.join(', ')} based on your voice note.`,
      action: 'schedule-activities',
      days: mentionedDays
    });
  }
  
  // Look for timing mentions
  const timeKeywords = ['morning', 'afternoon', 'evening', 'night', 'early', 'late'];
  const hasTimeKeywords = timeKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );
  
  if (hasTimeKeywords) {
    suggestions.push({
      type: 'timing-optimization',
      title: 'Posting Times',
      description: 'Consider optimizing posting times based on your voice note insights.',
      action: 'optimize-timing'
    });
  }
  
  return suggestions;
}
