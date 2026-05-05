import { ArrowRight } from 'lucide-react';
import type { IntegrationAction } from '../types';

export interface CategoryActionProps {
  action: IntegrationAction;
}

export default function CategoryAction({ action }: CategoryActionProps) {
  if ('href' in action) {
    return (
      <a
        href={action.href}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        {action.label}
        <ArrowRight className="h-4 w-4" />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
        action.tone === 'secondary'
          ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          : 'bg-gray-900 text-white hover:bg-gray-800'
      }`}
    >
      {action.label}
    </button>
  );
}
