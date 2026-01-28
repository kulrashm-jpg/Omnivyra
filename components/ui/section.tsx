import React from "react";

interface SectionProps {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  variant?: "default" | "card" | "glass";
}

export function Section({ 
  title, 
  subtitle, 
  icon, 
  children, 
  className = "",
  headerClassName = "",
  contentClassName = "",
  variant = "default"
}: SectionProps) {
  const baseClasses = "space-y-6";
  const variantClasses = {
    default: "",
    card: "bg-white/80 backdrop-blur-sm border border-white/20 rounded-2xl p-6 shadow-lg",
    glass: "bg-white/60 backdrop-blur-xl border border-white/30 rounded-2xl p-6 shadow-xl"
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {(title || subtitle || icon) && (
        <div className={`flex items-center gap-3 ${headerClassName}`}>
          {icon && (
            <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl text-white shadow-lg">
              {icon}
            </div>
          )}
          <div>
            {title && (
              <h3 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-gray-600 text-sm mt-1">{subtitle}</p>
            )}
          </div>
        </div>
      )}
      <div className={contentClassName}>
        {children}
      </div>
    </div>
  );
}

interface SectionGridProps {
  children: React.ReactNode;
  cols?: 1 | 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
  className?: string;
}

export function SectionGrid({ 
  children, 
  cols = 2, 
  gap = "md", 
  className = "" 
}: SectionGridProps) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
  };

  const gapClasses = {
    sm: "gap-4",
    md: "gap-6",
    lg: "gap-8"
  };

  return (
    <div className={`grid ${gridCols[cols]} ${gapClasses[gap]} ${className}`}>
      {children}
    </div>
  );
}























