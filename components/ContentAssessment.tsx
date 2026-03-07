import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, 
  Target, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  BarChart3, 
  Zap, 
  Eye, 
  Star,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Lightbulb,
  Activity,
  Award
} from 'lucide-react';
import PlatformIcon from '@/components/ui/PlatformIcon';

interface ContentAssessmentProps {
  content: string;
  platforms: string[];
  topic?: string;
  hashtags?: string[];
  mediaType?: string;
  onAnalysisComplete?: (analysis: any) => void;
}

interface PlatformScore {
  platform: string;
  score: number;
  factors: {
    engagement: number;
    reach: number;
    competition: number;
    trending: number;
    uniqueness: number;
  };
  suggestions: string[];
}

interface AnalysisResult {
  topic: string;
  platforms: PlatformScore[];
  uniquenessScore: number;
  repetitionRisk: number;
  overallScore: number;
  recommendations: string[];
  trendingData: any;
  competitorAnalysis: any;
}

export default function ContentAssessment({ 
  content, 
  platforms, 
  topic, 
  hashtags = [], 
  mediaType = 'text',
  onAnalysisComplete 
}: ContentAssessmentProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeContent = async () => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/analyze/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content,
          platforms,
          topic,
          hashtags,
          mediaType
        }),
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const result = await response.json();
      setAnalysis(result);
      onAnalysisComplete?.(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-100';
    if (score >= 60) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  const getScoreIcon = (score: number) => {
    if (score >= 80) return <CheckCircle className="h-4 w-4" />;
    if (score >= 60) return <AlertTriangle className="h-4 w-4" />;
    return <AlertTriangle className="h-4 w-4" />;
  };

  const getUniquenessLevel = (score: number) => {
    if (score >= 80) return { level: 'Highly Unique', color: 'text-green-600', bg: 'bg-green-100' };
    if (score >= 60) return { level: 'Moderately Unique', color: 'text-yellow-600', bg: 'bg-yellow-100' };
    return { level: 'Low Uniqueness', color: 'text-red-600', bg: 'bg-red-100' };
  };

  const getRepetitionRisk = (score: number) => {
    if (score >= 80) return { level: 'High Risk', color: 'text-red-600', bg: 'bg-red-100' };
    if (score >= 60) return { level: 'Medium Risk', color: 'text-yellow-600', bg: 'bg-yellow-100' };
    return { level: 'Low Risk', color: 'text-green-600', bg: 'bg-green-100' };
  };

  return (
    <div className="space-y-6">
      {/* Analysis Button */}
      <Card className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Brain className="h-6 w-6" />
            </div>
            <div>
              <div className="text-xl font-bold">AI Content Assessment</div>
              <div className="text-sm opacity-90">Analyze uniqueness and platform optimization</div>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p>Content: {content.substring(0, 100)}...</p>
              <p>Platforms: {platforms.join(', ')}</p>
              {topic && <p>Topic: {topic}</p>}
            </div>
            <Button
              onClick={analyzeContent}
              disabled={isAnalyzing || !content.trim()}
              className="bg-white/20 border-white/20 text-white hover:bg-white/30"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-2" />
                  Analyze Content
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Analysis Failed</span>
            </div>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Analysis Results */}
      {analysis && (
        <div className="space-y-6">
          {/* Overall Scores */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6 text-center">
                <div className="flex items-center justify-center mb-2">
                  <Award className="h-6 w-6 text-blue-600" />
                </div>
                <div className="text-2xl font-bold text-blue-600">{analysis.overallScore}%</div>
                <div className="text-sm text-gray-600">Overall Score</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 text-center">
                <div className="flex items-center justify-center mb-2">
                  <Star className="h-6 w-6 text-green-600" />
                </div>
                <div className={`text-2xl font-bold ${getUniquenessLevel(analysis.uniquenessScore).color}`}>
                  {analysis.uniquenessScore}%
                </div>
                <div className="text-sm text-gray-600">Uniqueness</div>
                <Badge className={`mt-1 ${getUniquenessLevel(analysis.uniquenessScore).bg} ${getUniquenessLevel(analysis.uniquenessScore).color}`}>
                  {getUniquenessLevel(analysis.uniquenessScore).level}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 text-center">
                <div className="flex items-center justify-center mb-2">
                  <AlertTriangle className="h-6 w-6 text-orange-600" />
                </div>
                <div className={`text-2xl font-bold ${getRepetitionRisk(analysis.repetitionRisk).color}`}>
                  {analysis.repetitionRisk}%
                </div>
                <div className="text-sm text-gray-600">Repetition Risk</div>
                <Badge className={`mt-1 ${getRepetitionRisk(analysis.repetitionRisk).bg} ${getRepetitionRisk(analysis.repetitionRisk).color}`}>
                  {getRepetitionRisk(analysis.repetitionRisk).level}
                </Badge>
              </CardContent>
            </Card>
          </div>

          {/* Platform Scores */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Platform-Specific Scores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analysis.platforms.map((platformScore) => (
                  <div key={platformScore.platform} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <PlatformIcon platform={platformScore.platform} size={14} showLabel />
                        <Badge className={`${getScoreBgColor(platformScore.score)} ${getScoreColor(platformScore.score)}`}>
                          {platformScore.score}%
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {getScoreIcon(platformScore.score)}
                        <span className={`text-sm font-medium ${getScoreColor(platformScore.score)}`}>
                          {platformScore.score >= 80 ? 'Excellent' : 
                           platformScore.score >= 60 ? 'Good' : 'Needs Improvement'}
                        </span>
                      </div>
                    </div>

                    {/* Factor Breakdown */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
                      <div className="text-center">
                        <div className="text-lg font-semibold text-blue-600">{platformScore.factors.engagement}%</div>
                        <div className="text-xs text-gray-600">Engagement</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold text-green-600">{platformScore.factors.reach}%</div>
                        <div className="text-xs text-gray-600">Reach</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold text-orange-600">{platformScore.factors.competition}%</div>
                        <div className="text-xs text-gray-600">Competition</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold text-purple-600">{platformScore.factors.trending}%</div>
                        <div className="text-xs text-gray-600">Trending</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold text-indigo-600">{platformScore.factors.uniqueness}%</div>
                        <div className="text-xs text-gray-600">Uniqueness</div>
                      </div>
                    </div>

                    {/* Suggestions */}
                    {platformScore.suggestions.length > 0 && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                          <Lightbulb className="h-3 w-3" />
                          Suggestions for {platformScore.platform}
                        </h4>
                        <ul className="text-xs space-y-1">
                          {platformScore.suggestions.map((suggestion, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <span className="text-gray-500 mt-0.5">•</span>
                              {suggestion}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recommendations */}
          {analysis.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5" />
                  AI Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analysis.recommendations.map((recommendation, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                      <div className="p-1 bg-blue-100 rounded-full">
                        <ArrowUp className="h-3 w-3 text-blue-600" />
                      </div>
                      <span className="text-sm text-blue-800">{recommendation}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Topic Analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Topic Analysis: {analysis.topic}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-2">Uniqueness Analysis</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Content Uniqueness</span>
                      <span className={getScoreColor(analysis.uniquenessScore)}>
                        {analysis.uniquenessScore}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${getScoreColor(analysis.uniquenessScore).replace('text-', 'bg-')}`}
                        style={{ width: `${analysis.uniquenessScore}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Repetition Risk</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Competition Level</span>
                      <span className={getRepetitionRisk(analysis.repetitionRisk).color}>
                        {analysis.repetitionRisk}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${getRepetitionRisk(analysis.repetitionRisk).color.replace('text-', 'bg-')}`}
                        style={{ width: `${analysis.repetitionRisk}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}























