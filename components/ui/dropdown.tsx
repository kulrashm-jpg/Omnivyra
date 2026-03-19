import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  color?: string;
  badge?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  variant?: "default" | "colored" | "glass";
  size?: "sm" | "md" | "lg";
}

export function Dropdown({ 
  options, 
  value, 
  onChange, 
  placeholder = "Select an option",
  className = "",
  variant = "default",
  size = "md"
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(option => option.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const sizeClasses = {
    sm: "px-3 py-2 text-sm",
    md: "px-4 py-3 text-base",
    lg: "px-5 py-4 text-lg"
  };

  const variantClasses = {
    default: "bg-white border-gray-200 hover:border-gray-300",
    colored: "bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 hover:border-blue-300",
    glass: "bg-white/80 backdrop-blur-sm border-white/20 hover:bg-white/90"
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full ${sizeClasses[size]} ${variantClasses[variant]} border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 flex items-center justify-between`}
      >
        <div className="flex items-center gap-3">
          {selectedOption?.icon && (
            <div className={`${selectedOption.color || 'text-gray-500'}`}>
              {selectedOption.icon}
            </div>
          )}
          <span className={`${selectedOption ? 'text-gray-900' : 'text-gray-500'}`}>
            {selectedOption?.label || placeholder}
          </span>
          {selectedOption?.badge && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-600 rounded-full text-xs font-medium">
              {selectedOption.badge}
            </span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="py-2">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full ${sizeClasses[size]} flex items-center gap-3 hover:bg-gray-50 transition-colors duration-150 ${
                  value === option.value ? 'bg-blue-50 text-blue-600' : 'text-gray-900'
                }`}
              >
                {option.icon && (
                  <div className={`${option.color || 'text-gray-500'}`}>
                    {option.icon}
                  </div>
                )}
                <span className="flex-1 text-left">{option.label}</span>
                {option.badge && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                    {option.badge}
                  </span>
                )}
                {value === option.value && (
                  <Check className="h-4 w-4 text-blue-600" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface MultiSelectDropdownProps {
  options: DropdownOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  maxSelections?: number;
  /** 'sm' uses compact py-1.5 padding to match small text inputs */
  size?: 'sm' | 'md';
}

export function MultiSelectDropdown({
  options,
  values,
  onChange,
  placeholder = "Select options",
  className = "",
  maxSelections,
  size = 'md',
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOptions = options.filter(option => values.includes(option.value));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleToggle = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter(v => v !== value));
    } else {
      if (!maxSelections || values.length < maxSelections) {
        onChange([...values, value]);
      }
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full ${size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-3'} bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 flex items-center justify-between hover:bg-gray-50`}
      >
        <div className="flex items-center gap-3">
          {selectedOptions.length > 0 ? (
            <div className="flex items-center gap-2">
              {selectedOptions.slice(0, 2).map((option) => (
                <div key={option.value} className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-600 rounded-lg text-sm">
                  {option.icon}
                  <span>{option.label}</span>
                </div>
              ))}
              {selectedOptions.length > 2 && (
                <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-sm">
                  +{selectedOptions.length - 2} more
                </span>
              )}
            </div>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="py-2">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => handleToggle(option.value)}
                disabled={!values.includes(option.value) && maxSelections && values.length >= maxSelections}
                className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors duration-150 ${
                  values.includes(option.value) ? 'bg-blue-50 text-blue-600' : 'text-gray-900'
                } ${!values.includes(option.value) && maxSelections && values.length >= maxSelections ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {option.icon && (
                  <div className={`${option.color || 'text-gray-500'}`}>
                    {option.icon}
                  </div>
                )}
                <span className="flex-1 text-left">{option.label}</span>
                {option.badge && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                    {option.badge}
                  </span>
                )}
                {values.includes(option.value) && (
                  <Check className="h-4 w-4 text-blue-600" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}























