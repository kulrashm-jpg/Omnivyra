import { Eye, EyeOff } from 'lucide-react';
import { SECTIONS, type SectionKey } from '@/features/marketing-intel/components/SectionCard';

type Props = {
  visible: Set<SectionKey>;
  onChange: (key: SectionKey) => void;
  onClose: () => void;
};

export default function ConfigurePanel({ visible, onChange, onClose }: Props) {
  return (
    <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-700">Show / hide sections</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">Done</button>
      </div>
      <div className="space-y-1">
        {SECTIONS.map((s) => (
          <label key={s.key} className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={visible.has(s.key)}
              onChange={() => onChange(s.key)}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-[#0A66C2]"
            />
            <span className="text-xs text-gray-600 flex-1">{s.label}</span>
            {visible.has(s.key) ? <Eye className="h-3 w-3 text-gray-300" /> : <EyeOff className="h-3 w-3 text-gray-200" />}
          </label>
        ))}
      </div>
    </div>
  );
}
