import type { IntegrationAction } from '../types';

export interface EmptyConnectionsProps {
  title: string;
  actions: IntegrationAction[];
}

export default function EmptyConnections({ title, actions }: EmptyConnectionsProps) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
      <p>{title}</p>
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          {actions.map((action) =>
            'href' in action ? (
              <a key={action.label} href={action.href} className="font-medium text-indigo-600 hover:text-indigo-700">
                {action.label} →
              </a>
            ) : (
              <button key={action.label} onClick={action.onClick} className="font-medium text-indigo-600 hover:text-indigo-700">
                {action.label} →
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
