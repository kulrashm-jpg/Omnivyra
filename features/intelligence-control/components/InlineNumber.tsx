export interface InlineNumberProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

export default function InlineNumber({ value, min, max, onChange }: InlineNumberProps) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={e => {
        const n = parseInt(e.target.value, 10);
        if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      className="w-20 px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
    />
  );
}
