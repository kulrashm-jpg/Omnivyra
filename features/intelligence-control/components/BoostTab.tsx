import { AlertCircle, Building2, CheckCircle2, Loader2, Search, X, Zap } from 'lucide-react';
import type { CompanyEntry, Msg } from '../types';

export interface BoostTabProps {
  companies: CompanyEntry[];
  search: string;
  selectedId: string;
  duration: number;
  action: 'apply' | 'remove';
  loading: boolean;
  msg: Msg;
  setSearch: (s: string) => void;
  setSelectedId: (id: string) => void;
  setDuration: (n: number) => void;
  setAction: (a: 'apply' | 'remove') => void;
  setMsg: (m: Msg) => void;
  submit: () => Promise<void>;
}

export default function BoostTab({
  companies,
  search,
  selectedId,
  duration,
  action,
  loading,
  msg,
  setSearch,
  setSelectedId,
  setDuration,
  setAction,
  setMsg,
  submit,
}: BoostTabProps) {
  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company_id.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedCompany = companies.find(c => c.company_id === selectedId);

  return (
    <div className="space-y-6 max-w-lg">
      {msg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.type === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Explainer */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Zap className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-violet-800">New Account Boost</p>
            <p className="text-xs text-violet-700 mt-0.5 leading-relaxed">
              Applies P1 priority + 2× frequency to all intelligence jobs for a new company, ensuring they get results fast. Boost expires automatically after the set duration.
            </p>
          </div>
        </div>
      </div>

      {/* Company select */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Company</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={selectedCompany ? selectedCompany.name : search}
            onChange={e => { setSearch(e.target.value); setSelectedId(''); }}
            placeholder="Search companies…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        {search && !selectedId && (
          <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden max-h-40 overflow-y-auto">
            {filtered.slice(0, 8).map(c => (
              <button
                key={c.company_id}
                onClick={() => { setSearch(c.name); setSelectedId(c.company_id); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50"
              >
                <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                <div>
                  <p className="font-medium text-gray-800">{c.name}</p>
                  <p className="text-[10px] text-gray-400">{c.company_id}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Action</label>
        <div className="flex gap-2">
          {(['apply', 'remove'] as const).map(a => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                action === a
                  ? a === 'apply' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-red-400 bg-red-50 text-red-600'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {a === 'apply' ? '⚡ Apply Boost' : '✕ Remove Boost'}
            </button>
          ))}
        </div>
      </div>

      {/* Duration (apply only) */}
      {action === 'apply' && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Duration
          </label>
          <div className="flex gap-2 flex-wrap">
            {[24, 48, 72, 168].map(h => (
              <button
                key={h}
                onClick={() => setDuration(h)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  duration === h
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-gray-200 text-gray-600 hover:border-indigo-300'
                }`}
              >
                {h < 48 ? `${h}h` : h === 48 ? '2d' : h === 72 ? '3d' : '1 week'}
              </button>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={168}
                value={duration}
                onChange={e => setDuration(Math.min(168, Math.max(1, Number(e.target.value) || 48)))}
                className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <span className="text-sm text-gray-500">h</span>
            </div>
          </div>
          {selectedId && (
            <p className="text-xs text-gray-500 mt-2">
              Boost will expire at: <strong>{new Date(Date.now() + duration * 3_600_000).toLocaleString()}</strong>
            </p>
          )}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={submit}
        disabled={!selectedId || loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
          : <><Zap className="h-4 w-4" /> {action === 'apply' ? `Apply ${duration}h Boost` : 'Remove Boost'}</>
        }
      </button>
    </div>
  );
}
