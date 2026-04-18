import React from 'react';

interface CompanyForm {
  name: string;
  website: string;
  industry: string;
}

interface CreateCompanyModalProps {
  companyForm: CompanyForm;
  isLoading: boolean;
  onChange: (form: CompanyForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function CreateCompanyModal({ companyForm, isLoading, onChange, onSubmit, onClose }: CreateCompanyModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Company</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
              <input
                type="text"
                value={companyForm.name}
                onChange={(e) => onChange({ ...companyForm, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="Acme Inc."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
              <input
                type="text"
                value={companyForm.website}
                onChange={(e) => onChange({ ...companyForm, website: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="acme.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Industry</label>
              <input
                type="text"
                value={companyForm.industry}
                onChange={(e) => onChange({ ...companyForm, industry: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="SaaS"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Create Company'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
