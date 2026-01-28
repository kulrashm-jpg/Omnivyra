import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../utils/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get audit logs with user information
    const { data: auditLogs, error } = await supabase
      .from('deletion_audit_log')
      .select(`
        id,
        user_id,
        user_role,
        action,
        table_name,
        record_id,
        reason,
        ip_address,
        user_agent,
        created_at,
        users!inner(
          name,
          email
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching audit logs:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch audit logs',
        details: error.message 
      });
    }

    // Format the response
    const formattedLogs = auditLogs.map(log => ({
      id: log.id,
      user_id: log.user_id,
      user_name: log.users.name,
      user_role: log.user_role,
      action: log.action,
      table_name: log.table_name,
      record_id: log.record_id,
      reason: log.reason,
      ip_address: log.ip_address,
      user_agent: log.user_agent,
      created_at: log.created_at
    }));

    return res.status(200).json({
      success: true,
      logs: formattedLogs
    });

  } catch (error) {
    console.error('Error in audit-logs API:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}






