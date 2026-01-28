/**
 * Risk Assessment Component
 * 
 * Displays campaign risk score and factors
 * - Risk score (0-100)
 * - Risk factors list
 * - Mitigation suggestions
 * - Risk breakdown by category
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, XCircle, TrendingUp, Info } from 'lucide-react';

interface RiskFactor {
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: string;
  mitigation?: string;
}

interface RiskAssessmentData {
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  overall_status: string;
  recommendations: string[];
}

interface RiskAssessmentProps {
  campaignId: string;
  className?: string;
}

export default function RiskAssessment({ campaignId, className = '' }: RiskAssessmentProps) {
  const [riskData, setRiskData] = useState<RiskAssessmentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRiskAssessment();
  }, [campaignId]);

  const loadRiskAssessment = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/risk`);
      if (response.ok) {
        const data = await response.json();
        setRiskData(data.data || null);
      }
    } catch (error) {
      console.error('Failed to load risk assessment:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 75) return 'text-red-600 bg-red-50 border-red-200';
    if (score >= 50) return 'text-orange-600 bg-orange-50 border-orange-200';
    if (score >= 25) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-green-600 bg-green-50 border-green-200';
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'critical':
        return 'text-red-800 bg-red-100';
      case 'high':
        return 'text-orange-800 bg-orange-100';
      case 'medium':
        return 'text-yellow-800 bg-yellow-100';
      default:
        return 'text-green-800 bg-green-100';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'high':
        return <AlertTriangle className="w-5 h-5 text-orange-600" />;
      case 'medium':
        return <TrendingUp className="w-5 h-5 text-yellow-600" />;
      default:
        return <CheckCircle className="w-5 h-5 text-green-600" />;
    }
  };

  if (loading) {
    return (
      <div className={`${className} flex items-center justify-center py-12`}>
        <div className="text-gray-500">Loading risk assessment...</div>
      </div>
    );
  }

  if (!riskData) {
    return (
      <div className={`${className} text-center py-8 text-gray-500`}>
        <Info className="w-12 h-12 mx-auto mb-2 text-gray-400" />
        <p>No risk assessment available</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="bg-white border rounded-lg p-6">
        {/* Risk Score Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Risk Assessment</h3>
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getRiskLevelColor(
                riskData.risk_level
              )}`}
            >
              {riskData.risk_level} Risk
            </span>
          </div>

          {/* Risk Score */}
          <div className={`border-2 rounded-lg p-6 ${getRiskColor(riskData.risk_score)}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Risk Score</span>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="text-4xl font-bold mb-2">{riskData.risk_score}</div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  riskData.risk_score >= 75
                    ? 'bg-red-600'
                    : riskData.risk_score >= 50
                    ? 'bg-orange-600'
                    : riskData.risk_score >= 25
                    ? 'bg-yellow-600'
                    : 'bg-green-600'
                }`}
                style={{ width: `${riskData.risk_score}%` }}
              />
            </div>
            <p className="text-sm mt-2 opacity-80">{riskData.overall_status}</p>
          </div>
        </div>

        {/* Risk Factors */}
        {riskData.factors && riskData.factors.length > 0 && (
          <div className="mb-6">
            <h4 className="font-semibold mb-3">Risk Factors</h4>
            <div className="space-y-3">
              {riskData.factors.map((factor, index) => (
                <div
                  key={index}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {getSeverityIcon(factor.severity)}
                      <span className="font-medium capitalize">{factor.category}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${getRiskLevelColor(
                          factor.severity
                        )}`}
                      >
                        {factor.severity}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{factor.description}</p>
                  <p className="text-xs text-gray-600 mb-2">
                    <span className="font-medium">Impact:</span> {factor.impact}
                  </p>
                  {factor.mitigation && (
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs font-medium text-blue-700 mb-1">Mitigation:</p>
                      <p className="text-xs text-gray-600">{factor.mitigation}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {riskData.recommendations && riskData.recommendations.length > 0 && (
          <div>
            <h4 className="font-semibold mb-3">Recommendations</h4>
            <ul className="space-y-2">
              {riskData.recommendations.map((recommendation, index) => (
                <li key={index} className="flex items-start space-x-2 text-sm text-gray-700">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span>{recommendation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

