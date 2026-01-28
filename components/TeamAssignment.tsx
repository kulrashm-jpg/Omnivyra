/**
 * Team Assignment Component
 * 
 * Manage team assignments for campaigns, weeks, and tasks
 * - Assign users to campaign weeks
 * - View assignments
 * - Update assignment status
 * - Team member selection
 */

import { useState, useEffect } from 'react';
import { User, CheckCircle, Clock, AlertCircle, X, Save } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

interface Assignment {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  entity_type: 'week' | 'campaign' | 'task';
  entity_id: string;
  entity_name?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  assigned_at: string;
  due_date?: string;
}

interface TeamAssignmentProps {
  campaignId: string;
  weekNumber?: number;
  weekStartDate?: string;
  onAssignmentChange?: () => void;
  className?: string;
}

export default function TeamAssignment({
  campaignId,
  weekNumber,
  weekStartDate,
  onAssignmentChange,
  className = '',
}: TeamAssignmentProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUsers();
    loadAssignments();
  }, [campaignId, weekNumber]);

  const loadUsers = async () => {
    try {
      // TODO: Load team users from API
      // For now, using mock data
      const mockUsers: User[] = [
        { id: '1', name: 'John Doe', email: 'john@example.com', role: 'Content Creator' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com', role: 'Designer' },
        { id: '3', name: 'Bob Johnson', email: 'bob@example.com', role: 'Manager' },
      ];
      setUsers(mockUsers);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const loadAssignments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('campaign_id', campaignId);
      if (weekNumber) params.append('week_number', weekNumber.toString());

      const response = await fetch(`/api/team/assignments?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setAssignments(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedUserId) return;

    setSaving(true);
    try {
      const entityType = weekNumber ? 'week' : 'campaign';
      const entityId = weekNumber ? `week-${weekNumber}` : campaignId;

      const response = await fetch('/api/team/assign-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUserId,
          campaign_id: campaignId,
          week_number: weekNumber,
          week_start_date: weekStartDate,
          entity_type: entityType,
          entity_id: entityId,
        }),
      });

      if (response.ok) {
        setSelectedUserId('');
        loadAssignments();
        onAssignmentChange?.();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to assign');
      }
    } catch (error) {
      console.error('Assign error:', error);
      alert('Failed to assign user');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusUpdate = async (assignmentId: string, newStatus: string) => {
    try {
      // TODO: Create API endpoint for status update
      const response = await fetch(`/api/team/assignments/${assignmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        loadAssignments();
      }
    } catch (error) {
      console.error('Status update error:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-600" />;
      case 'blocked':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'blocked':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className={className}>
      <div className="bg-white border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            {weekNumber ? `Week ${weekNumber} Assignments` : 'Campaign Assignments'}
          </h3>
        </div>

        {/* Assign New */}
        <div className="mb-6 pb-6 border-b">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Assign Team Member
          </label>
          <div className="flex items-center space-x-2">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select team member...</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
            <button
              onClick={handleAssign}
              disabled={!selectedUserId || saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Assigning...' : 'Assign'}</span>
            </button>
          </div>
        </div>

        {/* Current Assignments */}
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading assignments...</div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <User className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p>No assignments yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center space-x-3 flex-1">
                  <User className="w-5 h-5 text-gray-400" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{assignment.user_name || 'Unknown User'}</p>
                    <p className="text-xs text-gray-500">{assignment.user_email}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <select
                    value={assignment.status}
                    onChange={(e) => handleStatusUpdate(assignment.id, e.target.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg border-0 ${getStatusColor(
                      assignment.status
                    )} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="blocked">Blocked</option>
                  </select>
                  <div className="flex items-center space-x-1 text-xs text-gray-500">
                    {getStatusIcon(assignment.status)}
                    <span className="capitalize">{assignment.status.replace('_', ' ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

