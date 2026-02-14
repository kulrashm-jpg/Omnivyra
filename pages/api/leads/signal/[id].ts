import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

type LeadStatus =
  | 'ACTIVE'
  | 'WATCHLIST'
  | 'OUTREACH_PLANNED'
  | 'OUTREACH_SENT'
  | 'ENGAGED'
  | 'CONVERTED'
  | 'DISMISSED'
  | 'ARCHIVED';

const VALID_STATUSES: LeadStatus[] = [
  'ACTIVE',
  'WATCHLIST',
  'OUTREACH_PLANNED',
  'OUTREACH_SENT',
  'ENGAGED',
  'CONVERTED',
  'DISMISSED',
  'ARCHIVED',
];

/** Matches UI: ACTIVE↔WATCHLIST, funnel flow, Any→DISMISSED|ARCHIVED */
const allowedTransitions: Record<string, string[]> = {
  ACTIVE: ['WATCHLIST', 'OUTREACH_PLANNED', 'DISMISSED', 'ARCHIVED'],
  WATCHLIST: ['ACTIVE', 'OUTREACH_PLANNED', 'DISMISSED', 'ARCHIVED'],
  OUTREACH_PLANNED: ['OUTREACH_SENT', 'DISMISSED', 'ARCHIVED'],
  OUTREACH_SENT: ['ENGAGED', 'DISMISSED', 'ARCHIVED'],
  ENGAGED: ['CONVERTED', 'DISMISSED', 'ARCHIVED'],
  CONVERTED: ['ARCHIVED'],
  DISMISSED: [],
  ARCHIVED: [],
};

function isValidStatus(s: unknown): s is LeadStatus {
  return typeof s === 'string' && VALID_STATUSES.includes(s as LeadStatus);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = (req.query.id ?? req.query.signalId) as string;
  if (!id) {
    return res.status(400).json({ error: 'Signal id is required' });
  }

  const newStatus = req.body?.status;
  if (!isValidStatus(newStatus)) {
    return res.status(400).json({ error: 'Invalid or missing status' });
  }

  const { data: signal, error: fetchError } = await supabase
    .from('lead_signals_v1')
    .select('id, company_id, status, platform')
    .eq('id', id)
    .single();

  if (fetchError || !signal) {
    return res.status(404).json({ error: 'Lead signal not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: signal.company_id,
    requireCampaignId: false,
  });
  if (!access) return;

  const currentStatus = (signal.status ?? 'ACTIVE') as string;
  if (!allowedTransitions[currentStatus]?.includes(newStatus)) {
    return res.status(400).json({ error: 'Invalid status transition.' });
  }

  const updatePayload: { status: LeadStatus; converted_at?: string } = {
    status: newStatus,
  };
  if (newStatus === 'CONVERTED') {
    updatePayload.converted_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from('lead_signals_v1')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update signal' });
  }

  if (newStatus === 'CONVERTED' && signal.company_id && signal.platform) {
    await supabase.rpc('lead_platform_increment_converted', {
      p_company_id: signal.company_id,
      p_platform: String(signal.platform).toLowerCase(),
    });
  }

  return res.status(200).json(updated);
}
