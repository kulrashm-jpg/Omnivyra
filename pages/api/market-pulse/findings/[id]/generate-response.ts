/**
 * POST /api/market-pulse/findings/[id]/generate-response
 *
 * Phase 2: Build a generation context payload that the existing content
 * tools (campaign planner, BOLT creator, blog/post creators) can consume
 * via sessionStorage handoff. The endpoint does NOT call an LLM — it
 * assembles the structured context that a downstream content generator
 * will use as input.
 *
 * Returns:
 *   {
 *     handoff_token: string,        // sessionStorage key the client should set
 *     handoff_payload: { ... },     // the value to store under that key
 *     suggested_targets: { ... }    // recommended downstream URLs (relative)
 *   }
 *
 * Mirrors the V1 `pulse_topic_bridge` (localStorage) pattern but uses
 * sessionStorage scoped to the tab — the user navigates from this tab to
 * the content tool in the same tab.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../../../backend/services/contentArchitectService';
import { ownedDbTable } from '../../../../../backend/db/writeOwner';

const HANDOFF_TOKEN = 'market_pulse_finding_bridge';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const findingId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!findingId) return res.status(400).json({ error: 'finding id is required' });

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  type FindingRow = {
    id: string;
    run_id: string;
    title: string;
    summary: string | null;
    category: string;
    regions: string[] | null;
    impact_type: 'opportunity' | 'risk' | 'watch';
    priority_tier: 'P0' | 'P1' | 'P2' | null;
    confidence_score: number | null;
    evidence_strength: number | null;
    company_alignment_score: number | null;
    alert_class: string | null;
    cluster_role: string | null;
    escalation_level: string | null;
    trajectory: string | null;
    interpretation_text: string | null;
    strategic_implication: string | null;
    urgency_reason: string | null;
    opportunity_window: string | null;
    operational_impact: string | null;
    affected_business_areas: string[] | null;
    why_it_matters: string | null;
    recommended_action: string | null;
  };
  const { data: rawRow, error } = await ownedDbTable('market_pulse_findings')
    .select(
      'id, run_id, title, summary, category, regions, impact_type, priority_tier, ' +
      'confidence_score, evidence_strength, company_alignment_score, alert_class, ' +
      'cluster_role, escalation_level, trajectory, ' +
      'interpretation_text, strategic_implication, urgency_reason, opportunity_window, ' +
      'operational_impact, affected_business_areas, why_it_matters, recommended_action'
    )
    .eq('id', findingId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !rawRow) return res.status(404).json({ error: 'finding not found' });
  const row = rawRow as unknown as FindingRow;

  // Pull executor context off the run snapshot so the content tool has the
  // company-aware lens (named competitors, growth priorities, etc.)
  const { data: runRow } = await ownedDbTable('market_pulse_runs')
    .select('id, objective, market_direction, opportunity_pressure, risk_pressure, context_snapshot')
    .eq('id', row.run_id)
    .maybeSingle();

  const executorContext = (runRow as { context_snapshot?: Record<string, unknown> } | null)?.context_snapshot
    ? ((runRow as { context_snapshot: Record<string, unknown> }).context_snapshot.run_input as Record<string, unknown> | undefined)
    : undefined;

  const handoffPayload = {
    origin: 'market_pulse',
    finding_id: row.id,
    run_id: row.run_id,
    company_id: companyId,
    finding: {
      title: row.title,
      summary: row.summary,
      category: row.category,
      regions: row.regions,
      impact_type: row.impact_type,
      priority_tier: row.priority_tier,
      confidence_score: row.confidence_score,
      evidence_strength: row.evidence_strength,
      company_alignment_score: row.company_alignment_score,
      alert_class: row.alert_class,
      cluster_role: row.cluster_role,
      escalation_level: row.escalation_level,
      trajectory: row.trajectory,
    },
    interpretation: {
      interpretation_text: row.interpretation_text,
      strategic_implication: row.strategic_implication,
      urgency_reason: row.urgency_reason,
      opportunity_window: row.opportunity_window,
      operational_impact: row.operational_impact,
      affected_business_areas: row.affected_business_areas,
      why_it_matters: row.why_it_matters,
      recommended_action: row.recommended_action,
    },
    run_context: {
      objective: (runRow as { objective?: string } | null)?.objective ?? null,
      market_direction: (runRow as { market_direction?: string } | null)?.market_direction ?? null,
      opportunity_pressure: (runRow as { opportunity_pressure?: number } | null)?.opportunity_pressure ?? null,
      risk_pressure: (runRow as { risk_pressure?: number } | null)?.risk_pressure ?? null,
      executor_context_snapshot: executorContext ?? null,
    },
    /**
     * Suggested generation targets. The client decides which to navigate to
     * based on user choice (e.g., "Generate post" vs "Generate campaign").
     * The same handoff_token is consumed by all content tools that opt in.
     */
    suggested_generation_types: row.impact_type === 'opportunity'
      ? ['campaign', 'post', 'blog']
      : row.impact_type === 'risk'
        ? ['executive_summary', 'sales_messaging', 'positioning_response']
        : ['post', 'thread'],
    issued_at: new Date().toISOString(),
  };

  // Audit the intent — the user hasn't generated yet, but they've requested
  // the handoff. Useful for the learning loop to distinguish "looked at" vs
  // "actually generated".
  try {
    await ownedDbTable('market_pulse_finding_actions').insert({
      finding_id: findingId,
      company_id: companyId,
      run_id: row.run_id,
      action_type: 'feedback',
      payload: { intent: 'generate_response', handoff_token: HANDOFF_TOKEN },
      performed_by: typeof body.performed_by === 'string' ? body.performed_by : null,
    });
  } catch {
    /* non-blocking */
  }

  return res.status(200).json({
    ok: true,
    handoff_token: HANDOFF_TOKEN,
    handoff_payload: handoffPayload,
    suggested_targets: {
      campaign_planner: '/recommendations',
      bolt_creator: '/command-center/creator-content',
      post_creator: '/command-center/creator-content/post',
      blog_creator: '/blogs/new',
    },
  });
}
