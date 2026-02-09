import React from 'react';
import type { EngagementPlaybook } from '../../backend/services/playbooks/playbookTypes';

type PlaybookListProps = {
  playbooks: EngagementPlaybook[];
  onEdit: (playbook: EngagementPlaybook) => void;
  onToggleStatus: (playbook: EngagementPlaybook) => void;
};

const formatList = (items?: string[]) => (items && items.length > 0 ? items.join(', ') : '—');

export default function PlaybookList({ playbooks, onEdit, onToggleStatus }: PlaybookListProps) {
  if (playbooks.length === 0) {
    return <div className="text-sm text-gray-400">No playbooks created yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-left text-gray-700">
        <thead className="text-xs uppercase text-gray-500 border-b">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Platforms</th>
            <th className="px-3 py-2">Content Types</th>
            <th className="px-3 py-2">Intents</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {playbooks.map((playbook) => (
            <tr key={playbook.id} className="border-b">
              <td className="px-3 py-2">{playbook.name}</td>
              <td className="px-3 py-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    playbook.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-gray-100 text-gray-600 border border-gray-200'
                  }`}
                >
                  {playbook.status}
                </span>
              </td>
              <td className="px-3 py-2">{formatList(playbook.scope?.platforms)}</td>
              <td className="px-3 py-2">{formatList(playbook.scope?.content_types)}</td>
              <td className="px-3 py-2">{formatList(playbook.scope?.intents)}</td>
              <td className="px-3 py-2">
                <div className="flex gap-2">
                  <button
                    className="px-2 py-1 text-xs rounded border border-indigo-500 text-indigo-600"
                    onClick={() => onEdit(playbook)}
                  >
                    Edit
                  </button>
                  <button
                    className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600"
                    onClick={() => onToggleStatus(playbook)}
                  >
                    {playbook.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
