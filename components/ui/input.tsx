import React from 'react';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  className?: string;
  size?: 'default' | 'sm' | 'lg';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', size = 'default', ...props }, ref) => {
    const sizeClasses = {
      default: 'h-10 px-3 py-2',
      sm: 'h-9 px-2 py-1 text-sm',
      lg: 'h-11 px-4 py-3 text-base'
    };
    return (
      <input
        ref={ref}
        className={`flex w-full rounded-md border border-slate-200 bg-white text-slate-900 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses[size]} ${className}`}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
