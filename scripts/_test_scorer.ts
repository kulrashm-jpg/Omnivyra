import { createClient } from '@supabase/supabase-js';
import { getProfile, shouldRefineProfile } from '../backend/services/companyProfileService';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false} });
(async () => {
  // pick a QA (disposable) company with an UNSCORED profile
  const { data: qa } = await db.from('customer_population_classification').select('company_id').eq('classification','QA').limit(40);
  const qaIds = (qa??[]).map((r:any)=>r.company_id);
  const { data: profs } = await db.from('company_profiles').select('company_id, overall_confidence, last_refined_at').in('company_id', qaIds).or('overall_confidence.eq.0,overall_confidence.is.null').limit(1);
  if (!profs || !profs.length) { console.log('RESULT: no unscored QA profile found'); return; }
  const id = profs[0].company_id;
  console.log('TEST_TARGET (QA, disposable):', id, 'before conf='+profs[0].overall_confidence+' refined='+(profs[0].last_refined_at?'Y':'N'), 'shouldRefine='+shouldRefineProfile(profs[0].last_refined_at));
  try {
    const t0 = Date.now();
    const p = await getProfile(id, { autoRefine: true });
    console.log('SCORER_RAN: ok in '+(Date.now()-t0)+'ms | after conf='+(p?.overall_confidence)+' refined='+(p?.last_refined_at?'Y':'N'));
  } catch (e:any) {
    console.log('SCORER_FAILED:', (e?.message||e).slice(0,200));
  }
})().catch(e=>{console.error('ERR',(e?.message||e));process.exit(1);});
