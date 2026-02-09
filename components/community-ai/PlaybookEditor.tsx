import React, { useEffect, useState } from 'react';
import type { EngagementPlaybook } from '../../backend/services/playbooks/playbookTypes';

type PlaybookEditorProps = {
  playbook?: EngagementPlaybook | null;
  onSave: (playbook: EngagementPlaybook) => void;
  onCancel: () => void;
};

const parseList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const joinList = (items?: string[]) => (items && items.length > 0 ? items.join(', ') : '');

const defaultPlaybook = (tenantId: string, organizationId: string): EngagementPlaybook => ({
  tenant_id: tenantId,
  organization_id: organizationId,
  name: '',
  description: '',
  scope: { platforms: [], content_types: [], intents: [] },
  tone: { style: 'professional', emoji_allowed: false, max_length: 280 },
  user_rules: {
    first_time_user: 'optional',
    influencer_user: 'require_approval',
    negative_sentiment: 'escalate',
    spam_user: 'ignore',
  },
  action_rules: {
    allow_reply: true,
    allow_like: true,
    allow_follow: false,
    allow_share: true,
    allow_dm: false,
  },
  automation_rules: {
    auto_execute_low_risk: false,
    require_human_approval_medium_risk: true,
    block_high_risk: true,
  },
  limits: {
    max_replies_per_hour: 10,
    max_follows_per_day: 25,
    max_actions_per_day: 100,
  },
  execution_modes: {
    api_allowed: true,
    rpa_allowed: false,
    manual_only: false,
  },
  conflict_policy: {
    primary_wins: true,
    max_secondary_playbooks: 1,
  },
  safety: {
    block_urls: true,
    block_sensitive_topics: true,
    prohibited_words: [],
  },
  status: 'active',
});

export default function PlaybookEditor({ playbook, onSave, onCancel }: PlaybookEditorProps) {
  const [draft, setDraft] = useState<EngagementPlaybook | null>(null);

  useEffect(() => {
    if (playbook) {
      setDraft(playbook);
    }
  }, [playbook]);

  if (!draft) return null;

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Name</label>
          <input
            className="border rounded px-3 py-2 text-sm"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Description</label>
          <input
            className="border rounded px-3 py-2 text-sm"
            value={draft.description || ''}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Platforms (comma separated)</label>
          <input
            className="border rounded px-3 py-2 text-sm"
            value={joinList(draft.scope.platforms)}
            onChange={(event) =>
              setDraft({ ...draft, scope: { ...draft.scope, platforms: parseList(event.target.value) } })
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Content Types</label>
          <input
            className="border rounded px-3 py-2 text-sm"
            value={joinList(draft.scope.content_types)}
            onChange={(event) =>
              setDraft({
                ...draft,
                scope: { ...draft.scope, content_types: parseList(event.target.value) },
              })
            }
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Intents</label>
          <input
            className="border rounded px-3 py-2 text-sm"
            value={joinList(draft.scope.intents)}
            onChange={(event) =>
              setDraft({ ...draft, scope: { ...draft.scope, intents: parseList(event.target.value) } })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Tone Style</label>
          <select
            className="border rounded px-3 py-2 text-sm"
            value={draft.tone.style}
            onChange={(event) =>
              setDraft({ ...draft, tone: { ...draft.tone, style: event.target.value as any } })
            }
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="empathetic">Empathetic</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.tone.emoji_allowed}
            onChange={(event) =>
              setDraft({ ...draft, tone: { ...draft.tone, emoji_allowed: event.target.checked } })
            }
          />
          <span className="text-xs text-gray-500">Emoji allowed</span>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Max Length</label>
          <input
            type="number"
            className="border rounded px-3 py-2 text-sm"
            value={draft.tone.max_length}
            onChange={(event) =>
              setDraft({ ...draft, tone: { ...draft.tone, max_length: Number(event.target.value) } })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Automation Rules</label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.automation_rules.auto_execute_low_risk}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  automation_rules: { ...draft.automation_rules, auto_execute_low_risk: event.target.checked },
                })
              }
            />
            Auto-execute low risk
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.automation_rules.require_human_approval_medium_risk}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  automation_rules: {
                    ...draft.automation_rules,
                    require_human_approval_medium_risk: event.target.checked,
                  },
                })
              }
            />
            Require approval (medium)
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.automation_rules.block_high_risk}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  automation_rules: { ...draft.automation_rules, block_high_risk: event.target.checked },
                })
              }
            />
            Block high risk
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Limits</label>
          <input
            type="number"
            className="border rounded px-3 py-2 text-sm"
            value={draft.limits.max_replies_per_hour}
            onChange={(event) =>
              setDraft({
                ...draft,
                limits: { ...draft.limits, max_replies_per_hour: Number(event.target.value) },
              })
            }
            placeholder="Replies per hour"
          />
          <input
            type="number"
            className="border rounded px-3 py-2 text-sm"
            value={draft.limits.max_follows_per_day}
            onChange={(event) =>
              setDraft({
                ...draft,
                limits: { ...draft.limits, max_follows_per_day: Number(event.target.value) },
              })
            }
            placeholder="Follows per day"
          />
          <input
            type="number"
            className="border rounded px-3 py-2 text-sm"
            value={draft.limits.max_actions_per_day}
            onChange={(event) =>
              setDraft({
                ...draft,
                limits: { ...draft.limits, max_actions_per_day: Number(event.target.value) },
              })
            }
            placeholder="Actions per day"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">Execution Modes</label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.execution_modes.api_allowed}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  execution_modes: { ...draft.execution_modes, api_allowed: event.target.checked },
                })
              }
            />
            API allowed
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.execution_modes.rpa_allowed}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  execution_modes: { ...draft.execution_modes, rpa_allowed: event.target.checked },
                })
              }
            />
            RPA allowed
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.execution_modes.manual_only}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  execution_modes: { ...draft.execution_modes, manual_only: event.target.checked },
                })
              }
            />
            Manual only
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className="px-3 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
          onClick={() => onSave(draft)}
        >
          Save
        </button>
        <button
          className="px-3 py-1 text-xs rounded border border-gray-300 text-gray-600"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export { defaultPlaybook };
