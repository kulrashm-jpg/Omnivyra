import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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






