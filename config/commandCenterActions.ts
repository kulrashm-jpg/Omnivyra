/**
 * Canonical Command-Center Action Registry
 * -----------------------------------------
 * ONE registry for every "next action" navigation used by the Setup, Readiness,
 * and Mastery factor panels. Factors reference an action by `actionId` only —
 * no component or module registry contains a page URL, and no component appends
 * query parameters. The resolver owns destinations, required context params
 * (companyId / organizationId / tenantId), availability, and the action type.
 *
 * Future-proof: an action may be a page navigation, an external doc link, a
 * modal, or a workflow launcher. The panel renders from the resolved `kind`, so
 * new action types are added here (+ optionally an onAction dispatcher) WITHOUT
 * changing the panel components.
 */

export type ActionId =
  | 'profile.edit'
  | 'profile.ai_fill'
  | 'website.setup'
  | 'channels.connect'
  | 'apis.configure'
  | 'extension.install'
  | 'integrations.manage'
  | 'content.create'
  | 'creator.open'
  | 'campaign.create'
  | 'engagement.open'
  | 'reports.generate'
  | 'leads.setup'
  | 'team.manage'
  | 'billing.open';

export type ActionType = 'page' | 'external' | 'modal' | 'workflow';

/** Context params the resolver can inject. In this app org/tenant default to company. */
export type ActionParam = 'companyId' | 'organizationId' | 'tenantId';

export interface ActionContext {
  companyId?: string | null;
  organizationId?: string | null;
  tenantId?: string | null;
}

interface ActionDefinition {
  id: ActionId;
  type: ActionType;
  /** page/external: base path or URL (may carry a static query). modal/workflow: target id. */
  destination: string;
  /** Context params required to build a valid destination. */
  requiredParams: ActionParam[];
  /** Default label (a factor may override it, e.g. "Connect WhatsApp"). */
  label: string;
  /** Optional availability gate. Returns a reason string when unavailable, else null. */
  unavailable?: (ctx: ActionContext) => string | null;
}

export const COMMAND_CENTER_ACTIONS: Record<ActionId, ActionDefinition> = {
  'profile.edit':        { id: 'profile.edit',        type: 'page', destination: '/company-profile',                 requiredParams: ['companyId'], label: 'Edit company profile' },
  'profile.ai_fill':     { id: 'profile.ai_fill',     type: 'page', destination: '/company-profile?ai_refine=1',     requiredParams: ['companyId'], label: 'Complete with AI' },
  'website.setup':       { id: 'website.setup',       type: 'page', destination: '/website-setup',                   requiredParams: ['companyId'], label: 'Set up website' },
  'channels.connect':    { id: 'channels.connect',    type: 'page', destination: '/social-platforms',                requiredParams: ['companyId'], label: 'Connect channels' },
  'apis.configure':      { id: 'apis.configure',      type: 'page', destination: '/external-apis',                   requiredParams: ['companyId'], label: 'Configure APIs' },
  'extension.install':   { id: 'extension.install',   type: 'page', destination: '/integrations?focus=website',      requiredParams: ['companyId'], label: 'Install extension' },
  'integrations.manage': { id: 'integrations.manage', type: 'page', destination: '/integrations',                    requiredParams: ['companyId'], label: 'Manage integrations' },
  'content.create':      { id: 'content.create',      type: 'page', destination: '/command-center/content',          requiredParams: ['companyId'], label: 'Create content' },
  'creator.open':        { id: 'creator.open',        type: 'page', destination: '/command-center/creator-content',  requiredParams: ['companyId'], label: 'Open creator' },
  'campaign.create':     { id: 'campaign.create',     type: 'page', destination: '/command-center/campaigns',        requiredParams: ['companyId'], label: 'Create campaign' },
  'engagement.open':     { id: 'engagement.open',     type: 'page', destination: '/command-center/engagement',       requiredParams: ['companyId'], label: 'Open engagement' },
  'reports.generate':    { id: 'reports.generate',    type: 'page', destination: '/reports',                         requiredParams: ['companyId'], label: 'Generate report' },
  'leads.setup':         { id: 'leads.setup',         type: 'page', destination: '/lead-capture',                    requiredParams: ['companyId'], label: 'Set up lead capture' },
  'team.manage':         { id: 'team.manage',         type: 'page', destination: '/team-management',                 requiredParams: [],            label: 'Manage team' },
  'billing.open':        { id: 'billing.open',        type: 'page', destination: '/command-center/billing',          requiredParams: ['companyId'], label: 'View billing' },
};

/** Resolved, ready-to-render action. Discriminated by `kind`. */
export type ResolvedAction =
  | { kind: 'page'; actionId: ActionId; label: string; href: string }
  | { kind: 'external'; actionId: ActionId; label: string; href: string }
  | { kind: 'modal'; actionId: ActionId; label: string; target: string }
  | { kind: 'workflow'; actionId: ActionId; label: string; target: string }
  | { kind: 'disabled'; actionId: ActionId | null; label: string; reason: string };

function paramValue(ctx: ActionContext, param: ActionParam): string | null {
  // org/tenant default to company when not distinct (single-tenant-per-company here).
  if (param === 'companyId') return ctx.companyId ?? null;
  if (param === 'organizationId') return ctx.organizationId ?? ctx.companyId ?? null;
  return ctx.tenantId ?? ctx.companyId ?? null;
}

function buildHref(destination: string, ctx: ActionContext, requiredParams: ActionParam[]): string {
  let href = destination;
  for (const param of requiredParams) {
    const value = paramValue(ctx, param);
    if (!value) continue;
    const sep = href.includes('?') ? '&' : '?';
    // Canonical query name: companyId (org/tenant resolve to the same id here).
    href = `${href}${sep}${param}=${encodeURIComponent(value)}`;
  }
  return href;
}

/**
 * Resolve a factor action for the given context. Returns a `disabled` result
 * (with a canonical reason) when the action is unknown, gated unavailable, or
 * missing a required context param — the panel then renders a non-navigating
 * row instead of linking to a dead page. `labelOverride` (e.g. "Connect X")
 * replaces the action's default label.
 */
export function resolveActionNavigation(
  actionId: string | null | undefined,
  ctx: ActionContext,
  labelOverride?: string,
): ResolvedAction {
  const def = actionId ? COMMAND_CENTER_ACTIONS[actionId as ActionId] : undefined;
  if (!def) {
    return { kind: 'disabled', actionId: null, label: labelOverride ?? 'Unavailable', reason: 'This action is not available.' };
  }
  const label = labelOverride ?? def.label;

  const unavailableReason = def.unavailable?.(ctx) ?? null;
  if (unavailableReason) {
    return { kind: 'disabled', actionId: def.id, label, reason: unavailableReason };
  }

  // A required context param that can't be resolved → don't navigate to a dead page.
  const missing = def.requiredParams.find((p) => !paramValue(ctx, p));
  if (missing) {
    return { kind: 'disabled', actionId: def.id, label, reason: 'Select a company to continue.' };
  }

  if (def.type === 'page') return { kind: 'page', actionId: def.id, label, href: buildHref(def.destination, ctx, def.requiredParams) };
  if (def.type === 'external') return { kind: 'external', actionId: def.id, label, href: def.destination };
  if (def.type === 'modal') return { kind: 'modal', actionId: def.id, label, target: def.destination };
  return { kind: 'workflow', actionId: def.id, label, target: def.destination };
}
