import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';

/** Run a guard against a scratch response so its denial can be re-shaped. */
function captureResponse(): { res: NextApiResponse; denial: { status: number; body: unknown } } {
  const denial = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) { denial.status = code; return this; },
    json(body: unknown) { denial.body = body; return this; },
  } as unknown as NextApiResponse;
  return { res, denial };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { noteId } = req.query;

  if (!noteId) {
    return res.status(400).json({ error: 'Note ID is required' });
  }

  try {
    // ROUTE-AUTH-001 (STEP 3AH-85): authenticate BEFORE looking the note up, so
    // an anonymous caller learns nothing about which ids exist.
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    // voice_notes' only ownership column is campaign_id: load the note, then
    // authorize against ITS campaign. A note owned by another tenant (or with
    // no campaign, i.e. no owner) answers exactly like a missing one.
    const { data: note, error: lookupError } = await supabase
      .from('voice_notes')
      .select('id, campaign_id')
      .eq('id', String(noteId))
      .maybeSingle();
    if (lookupError) {
      throw lookupError;
    }
    const campaignId = typeof note?.campaign_id === 'string' ? note.campaign_id.trim() : '';
    if (!note || !campaignId) {
      return res.status(404).json({ error: 'Voice note not found' });
    }

    const probe = captureResponse();
    const access = await requireCampaignAccess(req, probe.res, campaignId);
    if (!access) {
      if (probe.denial.status === 401 || probe.denial.status >= 500) {
        return res.status(probe.denial.status).json(probe.denial.body);
      }
      return res.status(404).json({ error: 'Voice note not found' });
    }

    const { error } = await supabase
      .from('voice_notes')
      .delete()
      .eq('id', String(note.id))
      .eq('campaign_id', access.campaignId);

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
export default __createApiRoute(handler, { route: '/api/voice/notes/:noteId' });
