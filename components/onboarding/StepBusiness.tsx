import React, { useState } from 'react';
import { Building2, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';

const INDUSTRIES = [
  'Technology & Software',
  'Marketing & Advertising',
  'E-commerce & Retail',
  'Finance & Banking',
  'Healthcare',
  'Education',
  'Media & Entertainment',
  'Professional Services',
  'Real Estate',
  'Food & Beverage',
  'Manufacturing',
  'Other',
];

const GOALS = [
  { value: 'traffic', label: 'Get more traffic', desc: 'Drive organic visitors to your site' },
  { value: 'leads', label: 'Generate leads', desc: 'Convert visitors into prospects' },
  { value: 'authority', label: 'Build authority', desc: 'Become a thought leader in your space' },
] as const;

interface StepBusinessProps {
  initialName: string;
  initialIndustry: string;
  initialGoal: string;
  isLoading: boolean;
  error: string | null;
  onSave: (name: string, industry: string, goal: string) => Promise<boolean>;
  onNext: () => void;
  onBack: () => void;
}

export default function StepBusiness({
  initialName,
  initialIndustry,
  initialGoal,
  isLoading,
  error,
  onSave,
  onNext,
  onBack,
}: StepBusinessProps) {
  const [name, setName] = useState(initialName);
  const [industry, setIndustry] = useState(initialIndustry);
  const [goal, setGoal] = useState(initialGoal);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !industry || !goal) return;
    const ok = await onSave(name.trim(), industry, goal);
    if (ok) onNext();
  };

  const isValid = name.trim() && industry && goal;

  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-5">
          <Building2 className="w-7 h-7 text-violet-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Tell us about your business
        </h2>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          This helps us generate relevant content ideas and strategies tailored to you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-4">
        {/* Company Name */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Company name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc."
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            disabled={isLoading}
          />
        </div>

        {/* Industry */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Industry</label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
            disabled={isLoading}
          >
            <option value="">Select industry</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>

        {/* Goal */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">Primary goal</label>
          <div className="space-y-2">
            {GOALS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGoal(g.value)}
                disabled={isLoading}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  goal === g.value
                    ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-400'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <span className={`text-sm font-medium ${goal === g.value ? 'text-violet-700' : 'text-gray-800'}`}>
                  {g.label}
                </span>
                <p className="text-xs text-gray-500 mt-0.5">{g.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            type="submit"
            disabled={!isValid || isLoading}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
