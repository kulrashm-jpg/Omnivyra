/**
 * Predictive Intelligence business-impact configuration (Phase 36). Config only — the Platform
 * Business Impact Engine owns the machinery.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type PredictiveDimension = Extract<ImpactDimension, 'revenue' | 'pipeline' | 'conversion' | 'qualified_leads' | 'marketing' | 'leads'>;

export const PREDICTIVE_IMPACT_CONFIG: ImpactGraphConfig<PredictiveDimension> = {
  graph: {
    instrument_historical_snapshots: { dimensions: { revenue: 50, marketing: 50, pipeline: 45 }, cascade: ['No historical snapshots', 'No trend/momentum forecast', 'Reactive planning'] },
    increase_prediction_sample: { dimensions: { pipeline: 55, conversion: 45, leads: 45 }, cascade: ['Thin prediction sample', 'Low forecast confidence', 'Planning risk'] },
    improve_conversion_outlook: { dimensions: { conversion: 65, qualified_leads: 50, revenue: 45 }, cascade: ['Weak conversion forecast', 'Softer pipeline outlook', 'Lower revenue confidence'] },
    build_pipeline_for_forecast: { dimensions: { pipeline: 65, revenue: 50 }, cascade: ['Thin forecast pipeline', 'Volatile revenue outlook', 'Forecast risk'] },
  },
  moduleDimensions: {
    conversion_forecast: { conversion: 65, pipeline: 45 }, qualified_lead_forecast: { qualified_leads: 65, pipeline: 45 }, pipeline_forecast: { pipeline: 70, revenue: 45 },
    forecast_confidence: { revenue: 45, pipeline: 45 }, revenue_confidence: { revenue: 70 }, marketing_outlook: { marketing: 65 }, campaign_outlook: { marketing: 55 },
    readiness_outlook: { pipeline: 45, marketing: 40 }, predictive_health: { revenue: 50, marketing: 45 }, predictive_maturity: { revenue: 40, marketing: 40 },
    business_momentum: { revenue: 50, marketing: 45 }, growth_momentum: { marketing: 55 }, lead_forecast: { leads: 55 },
  },
  dimensionTail: { revenue: 'revenue outlook', pipeline: 'pipeline outlook', conversion: 'conversion outlook', qualified_leads: 'qualified pipeline', marketing: 'marketing trajectory', leads: 'lead trajectory' },
};

export const PREDICTIVE_LOW_EFFORT = new Set(['improve_conversion_outlook']);
export const PREDICTIVE_HIGH_EFFORT = new Set(['instrument_historical_snapshots', 'build_pipeline_for_forecast']);
