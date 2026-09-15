import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — voice_notes has exactly one ownership column,
 * `campaign_id` (no user_id / company_id). Every read, write and delete is
 * therefore bound to a campaign the caller may access (requireCampaignAccess,
 * which resolves the owner company server-side). A note with no campaign has
 * no owner and is not reachable through this API.
 */
function campaignIdOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Run a guard against a scratch response so its denial can be re-shaped. */
function captureResponse(): { res: NextApiResponse; denial: { status: number; body: unknown } } {
  const denial = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) { denial.status = code; return this; },
    json(body: unknown) { denial.body = body; return this; },
  } as unknown as NextApiResponse;
  return { res, denial };
}

/**
 * Authorize a DELETE by note id: authenticate first (so anonymous callers
 * learn nothing), load the note, then authorize against the note's campaign.
 * A note owned by another tenant answers exactly like a missing one (404).
 */
async function authorizeVoiceNoteDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  noteId: string
): Promise<{ id: string; campaignId: string } | null> {
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  const { data: note, error } = await supabase
    .from('voice_notes')
    .select('id, campaign_id')
    .eq('id', noteId)
    .maybeSingle();
  if (error) throw error;
  const campaignId = campaignIdOf(note?.campaign_id);
  if (!note || !campaignId) {
    res.status(404).json({ error: 'Voice note not found' });
    return null;
  }

  const probe = captureResponse();
  const access = await requireCampaignAccess(req, probe.res, campaignId);
  if (!access) {
    if (probe.denial.status === 401 || probe.denial.status >= 500) {
      res.status(probe.denial.status).json(probe.denial.body);
    } else {
      res.status(404).json({ error: 'Voice note not found' });
    }
    return null;
  }
  return { id: String(note.id), campaignId: access.campaignId };
}

async function getVoiceNotes(req: NextApiRequest, res: NextApiResponse) {
  const { context, campaignId, weekNumber, dayNumber } = req.query;

  if (!context) {
    return res.status(400).json({ error: 'Context is required' });
  }

  // ROUTE-AUTH-001: a campaign is required — without one this listed every
  // tenant's notes for the context.
  const access = await requireCampaignAccess(req, res, campaignIdOf(campaignId));
  if (!access) return;

  try {
    let query = supabase
      .from('voice_notes')
      .select('*')
      .eq('context', context)
      .eq('campaign_id', access.campaignId)
      .order('created_at', { ascending: false });

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

  // ROUTE-AUTH-001: the note is written under a campaign the caller may access.
  const access = await requireCampaignAccess(req, res, campaignIdOf(campaignId));
  if (!access) return;

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
        campaign_id: access.campaignId,
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
    const note = await authorizeVoiceNoteDelete(req, res, String(noteId));
    if (!note) return;

    const { error } = await supabase
      .from('voice_notes')
      .delete()
      .eq('id', note.id)
      .eq('campaign_id', note.campaignId);

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/voice/notes' });
