import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Users, 
  Plus, 
  Edit3, 
  Trash2,
  Mail,
  Phone,
  Calendar,
  Shield,
  UserPlus,
  Settings,
  Eye,
  EyeOff,
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react';

export default function TeamManagement() {
  const [activeTab, setActiveTab] = useState('members');
  const [isLoading, setIsLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'campaign_manager',
    permissions: []
  });

  // Sample team members data
  useEffect(() => {
    setTeamMembers([
      {
        id: '1',
        name: 'Sarah Johnson',
        email: 'sarah@drishiq.com',
        role: 'Campaign Manager',
        status: 'active',
        joinDate: '2024-01-15',
        permissions: ['create_campaigns', 'edit_content', 'schedule_posts'],
        avatar: '👩‍💼',
        lastActive: '2 hours ago'
      },
      {
        id: '2',
        name: 'Mike Chen',
        email: 'mike@drishiq.com',
        role: 'Content Creator',
        status: 'active',
        joinDate: '2024-02-01',
        permissions: ['edit_content', 'create_content'],
        avatar: '👨‍🎨',
        lastActive: '1 day ago'
      },
      {
        id: '3',
        name: 'Emily Rodriguez',
        email: 'emily@drishiq.com',
        role: 'Social Media Specialist',
        status: 'pending',
        joinDate: '2024-03-10',
        permissions: ['schedule_posts', 'view_analytics'],
        avatar: '👩‍💻',
        lastActive: 'Never'
      }
    ]);

    setInvitations([
      {
        id: 'inv1',
        email: 'alex@drishiq.com',
        role: 'Content Creator',
        status: 'pending',
        sentDate: '2024-03-15',
        expiresAt: '2024-03-22'
      }
    ]);
  }, []);

  const roles = [
    { id: 'campaign_manager', name: 'Campaign Manager', description: 'Full access to campaigns and team management' },
    { id: 'content_creator', name: 'Content Creator', description: 'Create and edit content, manage content calendar' },
    { id: 'social_specialist', name: 'Social Media Specialist', description: 'Schedule posts and manage social media' },
    { id: 'analyst', name: 'Analyst', description: 'View analytics and generate reports' },
    { id: 'viewer', name: 'Viewer', description: 'Read-only access to campaigns and content' }
  ];

  const permissions = [
    { id: 'create_campaigns', name: 'Create Campaigns', description: 'Create new marketing campaigns' },
    { id: 'edit_campaigns', name: 'Edit Campaigns', description: 'Modify existing campaigns' },
    { id: 'create_content', name: 'Create Content', description: 'Create new content pieces' },
    { id: 'edit_content', name: 'Edit Content', description: 'Modify existing content' },
    { id: 'schedule_posts', name: 'Schedule Posts', description: 'Schedule content for publishing' },
    { id: 'view_analytics', name: 'View Analytics', description: 'Access performance analytics' },
    { id: 'manage_team', name: 'Manage Team', description: 'Invite and manage team members' },
    { id: 'manage_settings', name: 'Manage Settings', description: 'Configure system settings' }
  ];

  const sendInvitation = async () => {
    if (!inviteForm.email || !inviteForm.role) return;

    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const newInvitation = {
        id: `inv${Date.now()}`,
        email: inviteForm.email,
        role: inviteForm.role,
        status: 'pending',
        sentDate: new Date().toISOString().split('T')[0],
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      };

      setInvitations(prev => [...prev, newInvitation]);
      setInviteForm({ email: '', role: 'campaign_manager', permissions: [] });
      setShowInviteModal(false);
    } catch (error) {
      console.error('Error sending invitation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const removeTeamMember = async (memberId: string) => {
    if (confirm('Are you sure you want to remove this team member?')) {
      setTeamMembers(prev => prev.filter(member => member.id !== memberId));
    }
  };

  const resendInvitation = async (invitationId: string) => {
    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setInvitations(prev => 
        prev.map(inv => 
          inv.id === invitationId 
            ? { ...inv, sentDate: new Date().toISOString().split('T')[0] }
            : inv
        )
      );
    } catch (error) {
      console.error('Error resending invitation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const cancelInvitation = async (invitationId: string) => {
    if (confirm('Are you sure you want to cancel this invitation?')) {
      setInvitations(prev => prev.filter(inv => inv.id !== invitationId));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-200/90 via-purple-200/90 to-pink-200/90 backdrop-blur-sm border-b border-purple-300/50 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => window.location.href = '/'}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Team Management
                </h1>
                <p className="text-gray-600 mt-1">Manage your team members and permissions</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.location.href = '/super-admin'}
                className="bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg"
              >
                <Shield className="h-4 w-4" />
                Super Admin
              </button>
              <button
                onClick={() => setShowInviteModal(true)}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 flex items-center gap-2"
              >
                <UserPlus className="h-5 w-5" />
                Invite Member
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="mb-8">
          <div className="flex space-x-1 bg-white/70 backdrop-blur-sm rounded-xl p-1 border border-gray-200/50">
            {[
              { id: 'members', label: 'Team Members', icon: Users },
              { id: 'invitations', label: 'Invitations', icon: Mail },
              { id: 'roles', label: 'Roles & Permissions', icon: Shield }
            ].map(tab => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <IconComponent className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Team Members Tab */}
        {activeTab === 'members' && (
          <div className="space-y-6">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Team Members ({teamMembers.length})</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {teamMembers.map(member => (
                  <div key={member.id} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50 hover:shadow-lg transition-all duration-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="text-2xl">{member.avatar}</div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{member.name}</h3>
                          <p className="text-sm text-gray-600">{member.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${
                          member.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'
                        }`}></div>
                        <span className="text-xs text-gray-500">{member.status}</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="h-4 w-4" />
                        {member.email}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Calendar className="h-4 w-4" />
                        Joined {new Date(member.joinDate).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Clock className="h-4 w-4" />
                        Last active {member.lastActive}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        {member.permissions.slice(0, 2).map(permission => (
                          <span key={permission} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                            {permission.replace('_', ' ')}
                          </span>
                        ))}
                        {member.permissions.length > 2 && (
                          <span className="text-xs text-gray-500">+{member.permissions.length - 2} more</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button className="p-1 hover:bg-gray-100 rounded text-gray-500">
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => removeTeamMember(member.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Invitations Tab */}
        {activeTab === 'invitations' && (
          <div className="space-y-6">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Pending Invitations ({invitations.length})</h2>
              
              <div className="space-y-4">
                {invitations.map(invitation => (
                  <div key={invitation.id} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-2xl">📧</div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{invitation.email}</h3>
                          <p className="text-sm text-gray-600">{invitation.role.replace('_', ' ')}</p>
                          <p className="text-xs text-gray-500">
                            Sent {new Date(invitation.sentDate).toLocaleDateString()} • 
                            Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4 text-yellow-500" />
                          <span className="text-sm text-yellow-600 font-medium">Pending</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => resendInvitation(invitation.id)}
                            disabled={isLoading}
                            className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors"
                          >
                            Resend
                          </button>
                          <button
                            onClick={() => cancelInvitation(invitation.id)}
                            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Roles & Permissions Tab */}
        {activeTab === 'roles' && (
          <div className="space-y-6">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200/50 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Roles & Permissions</h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Roles */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Roles</h3>
                  <div className="space-y-3">
                    {roles.map(role => (
                      <div key={role.id} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50">
                        <h4 className="font-semibold text-gray-900">{role.name}</h4>
                        <p className="text-sm text-gray-600 mt-1">{role.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Permissions */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Permissions</h3>
                  <div className="space-y-3">
                    {permissions.map(permission => (
                      <div key={permission.id} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-gray-200/50">
                        <h4 className="font-semibold text-gray-900">{permission.name}</h4>
                        <p className="text-sm text-gray-600 mt-1">{permission.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Invite Team Member</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="colleague@drishiq.com"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setShowInviteModal(false)}
                className="flex-1 px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendInvitation}
                disabled={isLoading || !inviteForm.email}
                className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200"
              >
                {isLoading ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
