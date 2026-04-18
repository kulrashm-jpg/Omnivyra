import React from 'react';
import { type CompanyData } from '@/pages/super-admin.types';
import { Search, Users, XCircle, CheckCircle, Trash2 } from 'lucide-react';

interface CompaniesTableProps {
  companies: CompanyData[];
  filteredCompanies: CompanyData[];
  selectedCompanyId: string | null;
  companySearch: string;
  setSelectedCompanyId: (id: string | null) => void;
  setShowAllUsers: (v: boolean) => void;
  setCompanySearch: (v: string) => void;
  setShowCreateCompanyModal: (v: boolean) => void;
  handleCompanyStatusChange: (companyId: string, nextStatus: 'active' | 'inactive') => void;
  handleDeleteCompany: (companyId: string) => void;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'active': return 'bg-green-100 text-green-800';
    case 'pending': return 'bg-yellow-100 text-yellow-800';
    case 'suspended': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

export default function CompaniesTable({
  companies,
  filteredCompanies,
  selectedCompanyId,
  companySearch,
  setSelectedCompanyId,
  setShowAllUsers,
  setCompanySearch,
  setShowCreateCompanyModal,
  handleCompanyStatusChange,
  handleDeleteCompany,
}: CompaniesTableProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-lg flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            Companies <span className="text-sm text-slate-600">({filteredCompanies.length}/{companies.length})</span>
          </h3>
          <p className="text-xs text-slate-600">Select a company to manage its users.</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedCompanyId && (
            <button onClick={() => { setSelectedCompanyId(null); setShowAllUsers(true); }} className="text-xs text-slate-600 hover:text-slate-900">
              Clear selection
            </button>
          )}
          <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search companies..."
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              className="text-sm outline-none bg-white"
            />
          </div>
          <button onClick={() => setShowCreateCompanyModal(true)} className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
            Create Company
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Website</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Industry</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Created</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {filteredCompanies.map((company) => {
              const isSelected = selectedCompanyId === company.id;
              return (
                <tr key={company.id} className={`hover:bg-slate-50 ${isSelected ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                    <button
                      onClick={() => { setSelectedCompanyId(company.id); setShowAllUsers(false); }}
                      className={`text-left transition-colors ${isSelected ? 'text-blue-700 font-semibold' : 'hover:text-blue-600'}`}
                    >
                      {company.name}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{company.website}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{company.industry || '—'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(company.status)}`}>{company.status}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{new Date(company.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setSelectedCompanyId(company.id); setShowAllUsers(false); }} className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50" title="Manage Users">
                        <Users className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleCompanyStatusChange(company.id, company.status === 'active' ? 'inactive' : 'active')}
                        className="text-yellow-600 hover:text-yellow-900 p-1 rounded hover:bg-yellow-50"
                        title={company.status === 'active' ? 'Make Inactive' : 'Make Active'}
                      >
                        {company.status === 'active' ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                      </button>
                      <button onClick={() => handleDeleteCompany(company.id)} className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50" title="Delete Company">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
