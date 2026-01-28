import React from "react";
import { Card, CardContent } from "./card";

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: React.ReactNode;
  color: string;
  trend?: "up" | "down" | "stable";
  className?: string;
}

export function StatsCard({ 
  title, 
  value, 
  change, 
  changeType = "positive", 
  icon, 
  color, 
  trend = "up",
  className = ""
}: StatsCardProps) {
  const getChangeColor = () => {
    switch (changeType) {
      case "positive": return "text-green-600";
      case "negative": return "text-red-600";
      default: return "text-gray-600";
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case "up": return "↗";
      case "down": return "↘";
      default: return "→";
    }
  };

  return (
    <Card className={`group bg-white/80 backdrop-blur-sm border-white/20 shadow-lg hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-1 hover:scale-105 ${className}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600 mb-2">{title}</p>
            <p className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-1">
              {value}
            </p>
            {change && (
              <div className="flex items-center gap-1">
                <span className={`text-xs font-medium ${getChangeColor()}`}>
                  {getTrendIcon()} {change}
                </span>
              </div>
            )}
          </div>
          <div className={`p-4 bg-gradient-to-br ${color} rounded-2xl shadow-lg group-hover:shadow-xl transition-all duration-300 group-hover:scale-110`}>
            <div className="text-white">
              {icon}
            </div>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-4 w-full bg-gray-200 rounded-full h-1.5">
          <div className={`h-1.5 bg-gradient-to-r ${color} rounded-full transition-all duration-1000`} 
               style={{ width: `${Math.min(100, Math.random() * 30 + 60)}%` }}></div>
        </div>
      </CardContent>
    </Card>
  );
}























