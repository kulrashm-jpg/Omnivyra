import type {
  CalendarPlan,
  CompanyContextMode,
  FocusModule,
  IdeaSpine,
  PlatformContentRequests,
  StrategicThemeEntry,
  StrategyContext,
} from '../components/planner/plannerSessionStore';
import type { PlannerStrategicCard } from './plannerStrategicCard';

export interface PlannerExecutionHandoff {
  schema_type: 'planner_execution_handoff';
  schema_version: 1;
  skeleton_confirmed: boolean;
  strategy_confirmed: boolean;
  idea_spine: IdeaSpine | null;
  strategy_context: (Omit<StrategyContext, 'target_audience'> & { target_audience: string }) | null;
  strategic_card: PlannerStrategicCard | null;
  strategic_themes: StrategicThemeEntry[];
  company_context_mode: CompanyContextMode;
  focus_modules: FocusModule[];
  platform_content_requests: PlatformContentRequests | null;
  calendar_plan: CalendarPlan | null;
}

function normalizeTargetAudience(value: StrategyContext['target_audience'] | null | undefined): string {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ');
  }
  return value ?? '';
}

export function buildPlannerExecutionHandoff(input: {
  skeleton_confirmed?: boolean | null;
  strategy_confirmed?: boolean | null;
  idea_spine?: IdeaSpine | null;
  strategy_context?: StrategyContext | null;
  strategic_card?: PlannerStrategicCard | null;
  strategic_themes?: StrategicThemeEntry[] | null;
  company_context_mode?: CompanyContextMode | null;
  focus_modules?: FocusModule[] | null;
  platform_content_requests?: PlatformContentRequests | null;
  calendar_plan?: CalendarPlan | null;
}): PlannerExecutionHandoff {
  return {
    schema_type: 'planner_execution_handoff',
    schema_version: 1,
    skeleton_confirmed: input.skeleton_confirmed === true,
    strategy_confirmed: input.strategy_confirmed === true,
    idea_spine: input.idea_spine ?? null,
    strategy_context: input.strategy_context
      ? {
          ...input.strategy_context,
          target_audience: normalizeTargetAudience(input.strategy_context.target_audience),
        }
      : null,
    strategic_card: input.strategic_card ?? null,
    strategic_themes: input.strategic_themes ?? [],
    company_context_mode: input.company_context_mode ?? 'full_company_context',
    focus_modules: input.focus_modules ?? [],
    platform_content_requests: input.platform_content_requests ?? null,
    calendar_plan: input.calendar_plan ?? null,
  };
}

export function buildPlannerPrefilledPlanning(handoff: PlannerExecutionHandoff): Record<string, unknown> {
  return {
    strategic_themes: handoff.strategic_themes.map((theme) => theme.title).filter(Boolean),
    strategic_theme_entries: handoff.strategic_themes,
    strategic_card: handoff.strategic_card,
    target_audience: handoff.strategy_context?.target_audience ?? '',
    campaign_goal: handoff.strategy_context?.campaign_goal ?? '',
    content_mix: handoff.strategy_context?.content_mix ?? [],
    posting_frequency: handoff.strategy_context?.posting_frequency ?? {},
    platform_content_requests: handoff.platform_content_requests ?? undefined,
  };
}
