import React from 'react';

const roleOptions = [
  { id: 'COMPANY_ADMIN', name: 'Company Admin' },
  { id: 'CONTENT_CREATOR', name: 'Content Creator' },
  { id: 'CONTENT_REVIEWER', name: 'Content Reviewer' },
  { id: 'CONTENT_PUBLISHER', name: 'Content Publisher' },
  { id: 'VIEW_ONLY', name: 'View Only' },
];

interface CompanyAdminForm {
  email: string;
  companyId: string;
  role: string;
}

interface CompanyData {
  id: string;
  name: string;
}

interface CreateUserModalProps {
  companyAdminForm: CompanyAdminForm;
  companies: CompanyData[];
  isLoading: boolean;
  onChange: (form: CompanyAdminForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function CreateUserModal({ companyAdminForm, companies, isLoading, onChange, onSubmit, onClose }: CreateUserModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Company User</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={companyAdminForm.email}
                onChange={(e) => onChange({ ...companyAdminForm, email: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="admin@acme.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Company</label>
              <select
                value={companyAdminForm.companyId}
                onChange={(e) => onChange({ ...companyAdminForm, companyId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="">Select company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
              <select
                value={companyAdminForm.role}
                onChange={(e) => onChange({ ...companyAdminForm, role: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {roleOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
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
              {isLoading ? 'Creating...' : 'Create Admin'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
