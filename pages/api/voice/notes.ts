import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;

  try {
    switch (method) {
      case 'GET':
        return await getVoiceNotes(req, res);
      case 'POST':
        return await createVoiceNote(req, res);
      case 'DELETE':
        return await deleteVoiceNote(req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('Voice notes API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}

async function getVoiceNotes(req: NextApiRequest, res: NextApiResponse) {
  const { context, campaignId, weekNumber, dayNumber } = req.query;

  if (!context) {
    return res.status(400).json({ error: 'Context is required' });
  }

  try {
    let query = supabase
      .from('voice_notes')
      .select('*')
      .eq('context', context)
      .order('created_at', { ascending: false });

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    if (weekNumber) {
      query = query.eq('week_number', parseInt(weekNumber as string));
    }

    if (dayNumber) {
      query = query.eq('day_number', parseInt(dayNumber as string));
    }

    const { data: notes, error } = await query;

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      notes: notes || []
    });

  } catch (error: any) {
    console.error('Error fetching voice notes:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch voice notes',
      details: error.message 
    });
  }
}

async function createVoiceNote(req: NextApiRequest, res: NextApiResponse) {
  const {
    id,
    text,
    audioUrl,
    duration,
    confidence,
    keywords,
    suggestions,
    context,
    campaignId,
    weekNumber,
    dayNumber
  } = req.body;

  if (!text || !context) {
    return res.status(400).json({ 
      error: 'Text and context are required' 
    });
  }

  try {
    const { data: voiceNote, error } = await supabase
      .from('voice_notes')
      .insert({
        id: id || `voice_${Date.now()}`,
        text,
        audio_url: audioUrl,
        duration: duration || 0,
        confidence: confidence || 0.95,
        keywords: keywords || [],
        suggestions: suggestions || [],
        context,
        campaign_id: campaignId || null,
        week_number: weekNumber || null,
        day_number: dayNumber || null,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      voiceNote
    });

  } catch (error: any) {
    console.error('Error creating voice note:', error);
    return res.status(500).json({ 
      error: 'Failed to create voice note',
      details: error.message 
    });
  }
}

async function deleteVoiceNote(req: NextApiRequest, res: NextApiResponse) {
  const { noteId } = req.query;

  if (!noteId) {
    return res.status(400).json({ error: 'Note ID is required' });
  }

  try {
    const { error } = await supabase
      .from('voice_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: 'Voice note deleted successfully'
    });

  } catch (error: any) {
    console.error('Error deleting voice note:', error);
    return res.status(500).json({ 
      error: 'Failed to delete voice note',
      details: error.message 
    });
  }
}






