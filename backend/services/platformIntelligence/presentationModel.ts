/**
 * Platform Intelligence Presentation Model (Phase 21B, Phase I).
 *
 * The single, domain-agnostic render-ready model consumed by BOTH the platform React
 * renderer and the platform HTML renderer. No domain assumptions — each domain builds this
 * model from its own snapshot; the renderers never interpret raw repository objects.
 * Website Intelligence is Consumer #1.
 */
import { type StyleToken } from './styles';

export interface PMModule { key: string; label: string; score: number | null; scoreToken: StyleToken; status: string; statusToken: StyleToken; confidencePct: number; badge?: string; findings: string[]; updatedAt: string | null }
export interface PMRecommendation { recommendation: string; category: string; categoryToken: StyleToken; businessImpact: string; effort: string; roi: string; originEngine: string; affectedModules: string[]; impactSummary: string; priority: number }
export interface PMRoadmap { horizon: string; label: string; items: string[] }
export interface PMDimension { label: string; value: number }

export interface IntelligencePresentationModel {
  executiveSummary: {
    status: string; statusToken: StyleToken; score: number; scoreToken: StyleToken; headline: string;
    strengths: string[]; weaknesses: string[]; priorityFocus: string[]; businessImpactSummary: string;
    confidencePct: number; updatedAt: string | null;
  } | null;
  health: { overall: string; statusToken: StyleToken; score: number; scoreToken: StyleToken; trackingActive: boolean; trackingAt: string | null } | null;
  modules: PMModule[];
  recommendations: PMRecommendation[];
  roadmap: PMRoadmap[];
  businessImpact: { dimensions: PMDimension[]; summary: string };
  confidence: { pct: number; fresh: boolean; updatedAt: string | null; token: StyleToken };
}
