import { supabase } from '../db/supabaseClient';
import { fillOpportunitySlots, reopenScheduledOpportunitiesDue } from './opportunityService';

const OPPORTUNITY_TYPES = [
  'TREND',
  'LEAD',
  'PULSE',
  'SEASONAL',
  'INFLUENCER',
  'DAILY_FOCUS',
] as const;

/**
 * Get company IDs that have a company profile (same source as recommendation scheduler).
 */
async function getActiveCompanyIds(): Promise<string[]> {
  const { data, error } = await supabase.from('company_profiles').select('company_id');
  if (error) {
    console.warn('Opportunity slots scheduler: failed to load company profiles', error.message);
    return [];
  }
  return (data || []).map((row: { company_id: string }) => row.company_id).filter(Boolean);
}

/**
 * Scheduled task: for each company and each type call fillOpportunitySlots;
 * then reopen scheduled items where scheduled_for <= now() (status='NEW', slot_state='ACTIVE').
 * Call from cron, Vercel Cron, or POST /api/cron/opportunity-slots (or similar).
 */
export async function runOpportunitySlotsScheduler(): Promise<{
  reopened: number;
  companiesProcessed: number;
  typesProcessed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let companiesProcessed = 0;
  let typesProcessed = 0;

  // 1) Reopen scheduled items that are due
  let reopened = 0;
  try {
    reopened = await reopenScheduledOpportunitiesDue();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`reopen: ${msg}`);
  }

  // 2) Get companies and fill slots per (company, type)
  const companyIds = await getActiveCompanyIds();
  if (companyIds.length === 0) {
    return { reopened, companiesProcessed: 0, typesProcessed: 0, errors };
  }

  for (const companyId of companyIds) {
    for (const type of OPPORTUNITY_TYPES) {
      try {
        await fillOpportunitySlots(companyId, type);
        typesProcessed += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${companyId}/${type}: ${msg}`);
      }
    }
    companiesProcessed += 1;
  }

  return {
    reopened,
    companiesProcessed,
    typesProcessed,
    errors,
  };
}
