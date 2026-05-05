import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import type { Integration } from '../types';
import { STATUS_BADGE, TYPE_COLORS, TYPE_ICONS, TYPE_LABELS } from '../constants';

export interface ConnectionCardProps {
  integration: Integration;
  isAdmin: boolean;
  onEdit: (integration: Integration) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testing: boolean;
}

export default function ConnectionCard({ integration, isAdmin, onEdit, onDelete, onTest, testing }: ConnectionCardProps) {
  const badge = STATUS_BADGE[integration.status];
  const lastTested = integration.last_tested_at ? new Date(integration.last_tested_at).toLocaleString() : 'Never';

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`shrink-0 rounded-lg p-2 ${TYPE_COLORS[integration.type]}`}>{TYPE_ICONS[integration.type]}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">{integration.name}</div>
            <div className="text-xs text-gray-500">{TYPE_LABELS[integration.type]}</div>
          </div>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
          {badge.icon}
          {badge.label}
        </span>
      </div>

      <div className="space-y-0.5 text-xs text-gray-500">
        <div>Last tested: {lastTested}</div>
        {integration.last_error && integration.status === 'failed' && (
          <div className="truncate text-red-600" title={integration.last_error}>
            Error: {integration.last_error}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-1">
          <button
            onClick={() => onTest(integration.id)}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
            Test
          </button>
          <button
            onClick={() => onEdit(integration)}
            className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={() => onDelete(integration.id)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
