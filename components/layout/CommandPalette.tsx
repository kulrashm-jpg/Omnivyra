import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Search } from 'lucide-react';
import { COMMAND_ITEMS, getNextActionForPath } from './navigationConfig';

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

function scoreCommand(query: string, haystack: string): number {
  if (!query) return 1;
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedHaystack = haystack.toLowerCase();

  if (normalizedHaystack.startsWith(normalizedQuery)) return 100;
  if (normalizedHaystack.includes(normalizedQuery)) return 60;

  let score = 0;
  let qIndex = 0;
  for (let i = 0; i < normalizedHaystack.length && qIndex < normalizedQuery.length; i += 1) {
    if (normalizedHaystack[i] === normalizedQuery[qIndex]) {
      score += 5;
      qIndex += 1;
    }
  }
  return qIndex === normalizedQuery.length ? score : 0;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) onClose();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [onClose, open]);

  const suggestedNext = getNextActionForPath(router.pathname);

  const results = useMemo(() => {
    const items = [...COMMAND_ITEMS];
    if (suggestedNext) {
      items.unshift({
        id: `next-${suggestedNext.href}`,
        label: suggestedNext.label,
        description: suggestedNext.description,
        href: suggestedNext.href,
        icon: suggestedNext.icon,
        group: 'Create',
        keywords: ['next action', 'recommended', suggestedNext.label.toLowerCase()],
      });
    }

    return items
      .map((item) => ({
        item,
        score: scoreCommand(
          query,
          [item.label, item.description, item.href, item.group, ...item.keywords].join(' '),
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 9);
  }, [query, suggestedNext]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyboard = (event: KeyboardEvent) => {
      if (!results.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % results.length);
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((index) => (index - 1 + results.length) % results.length);
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const target = results[selectedIndex]?.item;
        if (target) {
          router.push(target.href);
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [onClose, open, results, router, selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/35 px-4 py-10 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages or actions"
            className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <span className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500">
            Esc
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="rounded-2xl px-4 py-8 text-center text-sm text-slate-500">
              No matches yet. Try “campaign”, “blog”, or “content”.
            </div>
          ) : (
            results.map(({ item }, index) => {
              const active = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    router.push(item.href);
                    onClose();
                  }}
                  className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                    active ? 'bg-sky-50 text-sky-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className={`rounded-xl p-2 ${active ? 'bg-white text-sky-600' : 'bg-slate-100 text-slate-500'}`}>
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{item.label}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {item.group}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
